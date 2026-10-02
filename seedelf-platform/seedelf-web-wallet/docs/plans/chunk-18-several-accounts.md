# Chunk 18 plan: several accounts

The public side gets more than account `0'`. A picker discovers the phrase's
Cardano accounts in order, the wallet works on one at a time, and money made
private from different accounts is kept apart in the private balance.

[P1](../post-release-roadmap.md#p1--several-accounts), the owner's first pick
after the release (2026-10-02). Branch `web-wallet/several-accounts`, from
`main`.

**The owner's reason:** a user restoring a phrase may hold funds on accounts
other than `0'` and want to move them into Seedelf, and **some people run
several accounts as a form of privacy in the first place** — so a wallet that
can only see one is both losing their money and working against the habit they
came with.

## Found before building (2026-10-02)

Four things about the code as it stands decide most of this plan's shape.

1. **Every key access already goes through `wallet.withKeys()`.** About 130
   call sites across 19 background modules take `Keys { seedelf, cardano,
   oneTime }` from it. So the active account is a property of `Wallet`, not a
   parameter to thread through the worker: make `keys.cardano` *the active
   account's* and every one of those call sites is right already. This is the
   whole reason the chunk is tractable.
2. **The Rust and WebAssembly layers need no change.**
   `CardanoAccount::from_entropy(entropy, account: u32)`
   ([cardano.rs:68](../../seedelf-crypto/src/cardano.rs)) and
   `WasmCardanoAccount::from_entropy`
   ([wasm/src/lib.rs:2870](../../wasm/src/lib.rs)) already take the index; the
   extension passes `0` at
   [wallet.ts:550](../extension/src/background/wallet.ts). The frozen vectors
   in `cardano_account.json` already cover accounts 0 **and 1**, on both
   networks, against `@cardano-sdk/key-management`. Nothing in the derivation
   is new work, and nothing frozen is touched.
3. **`Koios.usedStakeAddresses(stakeAddresses[])` already exists** — "which of
   these any address has ever used, empty ones included, registered or not: one
   request" — built for `SessionService.freshIndex`. It is exactly the
   discovery primitive, and **the plan deliberately does not use it for
   accounts.** See [Discovery](#discovery-one-account-at-a-time-and-only-when-asked).
4. **Session caches are keyed by network and nothing else**, which is why a
   network switch wipes nothing: the caches naturally stay apart. Accounts get
   the other treatment — a switch wipes the account's caches — for the reason
   under [What a switch does](#what-a-switch-does).

## Decided

### The Seedelf key stays on account 0 (the owner, 2026-10-02)

One private balance for the whole phrase. The derivation would allow one key
per account (`info = "seedelf-key" || u32_be(account)`), and it isn't needed:
**stealth addressing already unlinks the move-ins.** Two public accounts paying
the same Seedelf create re-randomized registers `(g^d1, u^d1)` and
`(g^d2, u^d2)`, which can't be tied to each other or back to `(g, u)` without
`d`. Account 0 is, in effect, the nonce.

### A connected site stays bound to the account it connected to

This settles the roadmap's open question — *what does the dApp connector offer
a site when there are several accounts* — and it settles it with no new user
choice, which is the right answer for a privacy wallet.

`DappSite` records `account`. The connector reads **that** account's keys, not
the active one's, so switching the active account never moves a connected site
and `stillConnected` refuses a request whose account no longer matches. The
alternative — a site following the active account — would hand a site that had
seen account 0's addresses account 1's as well, and teach it that the two are
one wallet's. That is the exact leak several accounts exist to prevent, so it
is not offered as an option.

A site connected while account 1 is active connects to account 1. The connect
window says which account it is connecting to.

### Discovery: one account at a time, and only when asked

`usedStakeAddresses` would discover twenty accounts in **one** request. It is
not used, because that one request tells Koios that those twenty stake
addresses are one wallet's — which works directly against the habit this
feature exists to respect. `sessions.ts` already reasons this way about
one-time accounts ("Asking about 20 at once tells Koios they're one wallet's,
so it's done only when a restore or another browser used the next one").

So: **`account_addresses` for one account's stake address at a time, in order,
stopping at the first never used.** The requests are separate, which is the
most the wallet can do; Koios still sees them from one IP seconds apart, and
the privacy docs say so in those words rather than claiming more.

**When it runs** — not on unlock, which would spend the budget on every open:

| When | Why |
|---|---|
| **A restore** | Where it matters: a restored phrase may hold funds past account 0. Runs once, after the first unlock, in the background. |
| **"Check for another account" in Settings** | On demand, one request, probing the next index after the highest known. |
| **Never on a create** | A new phrase has nothing anywhere; account 0 is written as known with no request at all. |

**Koios cost, stated as the rules require:** one `account_addresses` request
per account probed, and a restore probes until the first unused one — so a
phrase with two used accounts costs 3 requests, once. A switch costs one normal
balance reading (below). Nothing here is paged and nothing grows with the
contract.

### What a switch does

A switch **wipes the account-scoped session caches** and lets the next reading
be an ordinary full one. It does not key them per account.

Keying `seedelf.balances.<net>` per account would be faster to switch back and
forth, but that record holds **both** sides, and the private side is shared —
so a per-account copy goes stale in a way nothing currently marks, and the
existing `balancesPrivateStale` marker is per network. Wiping needs no new
staleness invariant, and the private side of the next reading comes from the
**shared** contract scan cache (`seedelf.contract.<net>`, a delta read), so the
cost is one account read, which is what a user pressing an account picker
expects anyway. Less at rest, too.

| Session key | On a switch |
|---|---|
| `seedelf.balances.<net>` | wiped — holds the account's side |
| `seedelf.accountUtxos.<net>` | wiped |
| `seedelf.accountAddresses.<net>` | wiped |
| `seedelf.accountActivity.<net>` | wiped |
| `seedelf.readingTooLarge.<net>` | wiped (belongs to the wiped reading) |
| `seedelf.balancesPrivateStale.<net>` | wiped (the next reading reads both sides) |
| `seedelf.contract.<net>` | **kept** — the private balance is shared |
| `seedelf.reserved.<net>`, `seedelf.sent.<net>` | **kept** — what the wallet spent protects every account from a double spend |
| `seedelf.pendingTx.<net>` | **kept** — a payment in flight is watched to the end, whichever account is active |
| `seedelf.session.chain.<net>.<i>`, `seedelf.poolRefs.<net>` | **kept** — not the account's |

A switch is **refused while something of the account's is in flight** (a
pending account payment, a public mix being sent): the same `atStake` reasoning
Remove wallet uses. Switching under a payment being watched is how a watcher
loses its account.

## Per-account history classes: the real work

**Today every move-in shares one class.** `MADE_PRIVATE` is the single constant
`{ id: "public", origin: "own" }`
([histories.ts:35](../extension/src/shared/histories.ts)), so money made
private from account 0 and from account 1 would be the *same* history, and
selection would co-spend them freely.

**Why that matters, and it is not a nicety.** Stealth addressing hides *who*
money went to, not where an input came from. A contract UTxO's creating
transaction is public, so one later private spend that takes a UTxO originating
from account 0 together with one from account 1 ties those two accounts to one
owner, in the open — undoing the separation the feature exists to respect. The
machinery to prevent it already exists (privacy review §2.3): each private UTxO
gets a `HistoryClass`, `seedelf-core`'s `build::Histories` keeps classes apart
where a choice that doesn't merge them pays, and the UTxOs screen tags each
UTxO's origin. It only needs the class to name the account.

**The canonical id becomes `public:<n>`.**

- `madePrivate(account)` replaces the `MADE_PRIVATE` constant.
- **Bare `public` is read as `public:0`.** Sealed history records on existing
  devices already hold `"public"`, and merged ids like `"public+session:1"` do
  too. They are canonicalized **on read**, before any dedupe or compare, so a
  device that made money private before this chunk and after sees **one**
  class, not two. Getting this wrong would have the wallet claim a spend ties
  two accounts together when both are account 0 — a privacy note that is
  simply false, which is worse than none.
- `originOf` compares the part's prefix, not `part === "public"` as it does
  today.
- No migration writes anything: canonicalization at the read is enough, and it
  leaves the old records readable by an older build.

**What the user is told.** `historyTags` says `Made private (account 2)`, so
the UTxOs screen names which account money came from; `historiesNote` names the
accounts when a spend merges two of them, in the same voice as the rest:
*"This spends money you made private from account 1 and money you made private
from account 2 together. Anyone can see they're one owner's, which ties those
accounts to each other."* Accounts are numbered **from 1** where a person reads
them, as private sessions already are, and from 0 in code.

## Per-account records

| Record | Scope | What changes |
|---|---|---|
| `accounts.<network>` | **new** | The known accounts, their names, and which is active. Sealed: how many accounts a user runs is about the user. |
| `coins.<network>` | mixed | `seedelf` locks stay shared; `cardano` locks and the collateral move under the account. One record, reshaped, with a read-time migration from the old shape. |
| `dapps` | per site | Each site records its `account` (above). |
| `history.<network>` | shared | Origins gain the account (`public:<n>`). |
| `mintedBy.<network>` | shared | Unchanged: who paid for a Seedelf is a Seedelf fact. |
| `sessions.<network>`, `lovejoin*`, `maybeSent.*` | shared | Unchanged — one-time accounts are account `24301'`, and the private balance is one. |

`PRIVATE_RECORDS` is a fixed list, so the collateral and the locks are **not**
split into per-account record names. Reshaping `coins.<network>`'s contents
keeps the list fixed, and keeps `KEPT_ON_RESET` and Remove wallet untouched.

**The collateral is the account's.** Each account sets its own, or the wallet
takes that account's oldest pure 5 ₳ UTxO, exactly as today — the existing rule
already keeps another wallet's collateral on the same phrase put, and this
extends it to another account's.

## Staking per account comes free

Each account has its own stake key (`2/0` under its own index), so several
accounts means stake spread across several pools with no change to
`staking.ts` — `keys.cardano` is the active account's and its `stakeAddress`
follows. **That is Lace's model after its multi→single migration**, reached
without multi-delegation and without touching one-pool-per-account. The
roadmap's public-side table already ticks it ✅ via P1; this plan is where it
actually happens, and the Staking screen needs only to say which account it is
delegating.

## Scope

1. **`Wallet`**: the active index; `derive` at it; `withAccount(index, fn)` for
   a specific account (the connector), with the derived accounts cached by
   index and every one freed on lock.
2. **`AccountsService`**: the sealed `accounts.<network>` record, discovery,
   naming, the switch and its refusals.
3. **Storage**: the session wipe list; `coins.<network>` reshaped with its
   read-time migration.
4. **Histories**: `madePrivate(account)`, canonicalization, `originOf`,
   `historyTags`, `historiesNote`.
5. **Connector**: `DappSite.account`, `holder`, `stillConnected`, the connect
   window's wording.
6. **UI**: the picker in the top bar (hidden with one account, as
   `NetworkPicker` hides with one network); `App`'s screen key gains the
   account so every screen starts afresh; Settings → Accounts for discovery,
   naming and the switch; Receive, Home, Staking, Activity and the UTxOs screen
   say which account.
7. **Tests**: unit tests for discovery, the switch's wipe and refusals, the
   `coins` migration, and the history canonicalization (the legacy `public`
   case is the one that must not regress); e2e for the picker; `words.test.ts`
   keeps passing.
8. **Docs**: `keys-and-accounts.md` (rule 1 stops saying account `0'` only),
   `architecture.md` (storage), `privacy.md` (what discovery tells Koios, and
   the co-spending rule), and a handoff note in `roadmap.md`.

## Not this chunk

- **A Seedelf key per account.** Decided against: one private balance.
- **Reading several accounts at once**, or showing a total across them. It
  would link them at Koios and on screen, which is the opposite of the point.
- **Folders or an account centre** (Lace has both). A picker and a name are
  what the parity gap actually is.
- **Per-account one-time accounts.** Sessions stay at `24301'`; they are the
  private balance's, and it is one.
