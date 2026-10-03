# Chunk 18 plan: several accounts

The public side gets more than account `0'`. A picker discovers the phrase's
Cardano accounts in order, the wallet works on one at a time, and money made
private from different accounts is kept apart in the private balance.

[P1](../post-release-roadmap.md#p1--several-accounts), the owner's first pick
after the release (2026-10-02). Branch `web-wallet/several-accounts`, from
`main`.

**Status: built (2026-10-02).** What landed, and where it differs from this
plan, is at the end under [*What was built*](#what-was-built).

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
addresses are one wallet's — which the wallet shouldn't volunteer on the
user's behalf, whether or not they keep their accounts apart.
`sessions.ts` already reasons this way about
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
owner, in the open — **and the user never chose that**, which is the part that
matters. A link they make themselves is their business (see
[*Sending between your own accounts*](#sending-between-your-own-accounts-said-not-refused));
one coin selection makes for them, silently, is not. The
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

## What was built

Four commits on `web-wallet/several-accounts`, in the order of the scope above.
1,156 unit tests and the whole Playwright suite pass; the extension builds.

### Where it matched the plan

The three load-bearing guesses held. `keys.cardano` becoming the active
account's left about 130 call sites right as they stood; the Rust and
WebAssembly layers needed **no change at all**; and reading the active index
inside `load()` — which every `withKeys` already goes through, inside
`serial()` — made the switch race-free with no explicit re-derive step. The
`coins.<network>` reshape, the `public:<n>` classes, discovery one account at a
time, and the site binding all landed as written.

Staking per account fell out for free, as the plan said: `staking.ts` is
untouched.

### Three bugs the tests caught, all worth recording

1. **`historiesNote` gated on its argument's raw length.** Its contract says
   "each class once", which callers honoured — until canonicalization made a
   legacy `public` and a fresh `public:0` the *same* class while still arriving
   as two array entries. The note then said a spend merged histories when it
   merged none. It dedupes by canonical id now, which makes the "says nothing
   when the money spent shares one history" promise hold literally.
2. **`sitesOn` projected `account` away.** The site record carried it, but the
   projection handed `holder` a `DappSite` without it — so every public site
   read as account 0's, and the refusal fired for the wrong sites and not for
   the right ones. A test asserting a site connected *on account 1* keeps
   working is what found it; the two tests either side of it passed by
   accident.
3. **The accounts provider was below the top bar.** `AccountsProvider` wrapped
   `<main>`, and the picker lives in `<header>`, so it read the default
   context and never rendered. The e2e found it; no unit test could, because
   the picker's own test supplies the context directly.

### Three things found and fixed beyond the plan

- **`destination.ts`'s own-account warning covered only the active account.**
  It flags paying your own public account from Seedelf, because that re-links
  the money (privacy review §2.17) — and that is as true of Account 2 as of
  the account you are looking at, so with several accounts the warning would
  have gone missing in exactly the case several accounts create. `ownAccount`
  checks the active account first, then every other the wallet knows, deriving
  their keys on the device. A one-account wallet does no extra work.
- **Removing a Seedelf could tie two accounts together, and the default would
  have done it quietly.** `MintSource` recorded only which *side* paid, so
  "the public account paid for it" became "the account you happen to be on".
  The mint is public and already links the Seedelf's name to the account that
  paid; sending the freed ADA to a different account links that one to the
  same name, and anyone can join the two through it. The record now keeps
  `account:<n>` (a bare `account` reads as account 0's, as the history classes
  do), and Remove warns with both account numbers and a way out. One snag
  along the way: `held()` runs **inside** `withKeys`, so reading the active
  account there with another `withKeys` deadlocked the whole balance
  reading — it is passed in from the enclosing callback instead.
- **A create or restore has to put the account choice back to 0 *before* the
  keys are derived.** The choice is unsealed and outlives a Remove wallet, as
  the network does, so a new phrase would otherwise derive whatever account
  the last one was left on. Hence `useFirst()` (no key, before) and
  `recordFirst()` (sealed, after) rather than one method.

### Where it differs from the plan

- **A switch from Settings → Public accounts lands back on the Settings menu**,
  because `App` keys every screen by the account. That is the same thing the
  network switch does, and it is the behaviour the keying exists for, so it
  was left as it is rather than special-cased. The top-bar picker is the
  switch that doesn't move you.
- **The connector refuses rather than follows.** The plan said a site stays
  bound to its account and the connector "reads that account's keys". It
  refuses instead: `Wallet.withAccount` is built and used (discovery and the
  own-address check use it), but threading a specific account through
  `dapp.ts`'s public-account path means touching `holder`, `view`,
  `paysHolder`, `receiveAddress`, `ties` and the four sign/inspect paths
  across 96 KB of a file where every one of them is written as
  `holder ? session : account`. Refusing is strictly safe, consistent with
  chunk 15's "the connect window chooses nothing by design", and testable;
  serving is a later round's if anyone asks for it. The refusal names the
  account and says how to get back to it.
- **`accounts` is not per network.** The plan's record table said
  `accounts.<network>`. An account is a fact about the phrase, not about a
  network, and keying it per network means a phrase that used Account 2 on
  mainnet loses it on preprod — where the account still exists, just empty.
  One record, and `list()` always offers the active account even where
  discovery hasn't seen it used.
- **The active index is unsealed, and that is a trade-off the plan did not
  name.** `Wallet` reads it while deriving the keys, before anything is
  unlocked, so it cannot live in a sealed record without a fragile
  re-apply step that a request could race. It sits in `chrome.storage.local`
  beside the network, and `LOCAL_ACCOUNT`'s comment says what that leaks:
  which account is active, to someone who already sees the vault, the
  network and every setting. *How many* accounts the phrase has, and what
  they are called, stay sealed.

### The Koios cost, as the rules ask

| What | Requests |
|---|---|
| A restore | one `account_addresses` per account probed, stopping at the first never used: 3 for a phrase with two used accounts. Background; nothing waits on it. |
| "Check for another account" | exactly 1 |
| A switch | one ordinary balance reading of the new account. The contract scan cache is shared, so the private side is a delta read. |
| Unlock, or anything else | **0.** Discovery never runs on unlock. |

Nothing here is paged, and nothing grows with the contract.

## The owner's two corrections (2026-10-02, after the first push)

### Custom and non-sequential accounts were unreachable

**The owner:** *"so I cant tell the wallet what account to use it will just find it, hiding any custom number accounts like 1337 from being checked … this will allow a user to use another account even if it never was used and can be used to find high or custom accounts that are non sequential."*

Right, and it was two gaps, not one:

1. **`MAX_ACCOUNTS = 25` capped the index, not the count.** CIP-1852's account component is hardened, so `seedelf-crypto`'s `check_account` allows 0 … 2^31 - 1. The cap was mine and arbitrary, and it made 1337 impossible to name at all. It is now `MAX_INDEX` (the derivation's own bound) and `MAX_KEPT` (100, a list length).
2. **Even uncapped, nothing could reach a custom account.** Sequential discovery stops at the first unused account — BIP44's rule, and the right default — so 1337 is unreachable by it even when it *has* been used. And `use()` refused an account discovery hadn't seen, so a never-used account could not be *started* either.

So Settings → Public accounts gets an account-number entry:

- **Check it** — one `account_addresses` request about that one account, whatever its index. Adds it if it has been used; reports it if not.
- **Add it** — **no request at all**, and it adds the account whether or not it has ever been used. This is the one that lets a user *start* a custom-numbered account: it exists in the phrase either way and holds nothing until something is put there. It is also the more private of the two, since checking tells Koios that this IP is interested in that account.

**And a bug in the sequential look, found writing this:** it probed from `highest + 1`, so adding account 1337 would have stopped it ever reaching account 2. It carries on from the **first gap in the run up from 0** now.

### Sending between your own accounts: said, not refused

**The owner, first:** *"we do not allow the public send to be able to send to another account nor someone from our contact list that is public."*

I read that as a prohibition and built one: `send.ts` refused a recipient belonging to another account, and the form kept Review shut.

**The owner, correcting it:** *"I mean, in the contacts there could be base addresses that are public or seedelfs. And a user may want to use the wallet to send between accounts too. We are making a lot of assumptions about accounts not being linked when they in fact can and in some cases that was encouraged."*

That is the better frame, and the refusal was wrong. **Accounts are not necessarily unlinked**, several things the wallet already does link them — a move-in, Make public back to an account, a Seedelf the account paid for — and in some cases that is the point. And people do want to move money between their own accounts.

So it works the way every other entry in [privacy.md](../privacy.md#known-links)'s *Known links* works, which is what that section says it is for: **the wallet cannot prevent the link, so it makes it visible.**

- `WithdrawDestination` carries `ownAccount`, so a destination says *which* of the wallet's accounts it is rather than only that it is one.
- The Send form names the account and says what the payment reveals — *"anyone can see your two accounts paying each other and tell they're one wallet's"* — and the payment goes through.
- **It reads the resolved address, so it reads the same however the address arrived** — typed, pasted, an ADA Handle, or picked from Contacts. No contact is hidden or filtered: a contact may hold a public address or a seedelf, and either is the user's to pay.
- **Paying *this* account** says what it always said (the money comes straight back less the fee); the collateral payment is exactly that.

**It did fix something my earlier change had broken.** Making `own` true for every known account left the public Send's note saying *"the payment comes back to it, less the fee"* for an address belonging to a *different* account — which is false. The note distinguishes this account from another now, and Make public's warning names the account too.

**And then offered, not merely allowed.** The owner asked, a step later, whether the Send and the contact book were leaving accounts out *because it doesn't provide privacy*. They weren't — it simply had not been built — and by the rule just set, "it doesn't provide privacy" would have been the wrong reason to withhold it. So the To field has **Your accounts** beside **Contacts**, listing every account but the one you are on. Picking one fills the field and nothing else: the destination is read and said exactly as a typed address is. The contact book is left alone — nothing auto-populates your own accounts into it, which would duplicate the picker and be one more thing to keep in sync.

**The lesson, for the rest of the chunk.** Privacy-by-default means the most private option is the *default*, with a control to turn it down — not that the wallet forbids what a user may legitimately want. Selection *preferring* to keep accounts apart and *saying* when it can't is the right shape; a refusal is not. The prose in `privacy.md` and `keys-and-accounts.md` was rewritten for the same reason: it had started claiming accounts were unlinked rather than that the wallet avoids linking them on its own.

**Still a hard refusal, and worth the owner's call:** the dApp connector refuses a site bound to another account instead of serving it. That one is a different case — a third party silently learning two accounts are one wallet's, which the user never asked for, rather than a link the user chose — so it was left as it is. If it should ask instead of refuse, that is the `dapp.ts` threading noted under *Where it differs from the plan*.

## After the owner looked at it (2026-10-02)

Three rounds of their findings on the built wallet, in order. None changed a
decision above; all three were things only looking at it would catch.

- **"We need to make the switch to it button smaller."** It was a 48px
  `.secondary` next to each account's name. `.chip` is the house small-button
  style already used for Copy and Max, so it needed no new CSS and now matches
  *Name it* beside it.
- **"Needs proper spacing between. This is not going to scale well for
  wallets with a lot of accounts."** `.list` is a bare flex column, so the
  rows had no padding and no separation at all. They take the same vertical
  rhythm as `.menu-row` and `.token-row` now, with a hairline between; the
  list scrolls at about eight rows rather than pushing the number entry and
  the notes off the screen; the active account is tinted; and the heading
  carries the count, because a row cut off at the scroll edge otherwise reads
  as clipped rather than as more below. The e2e adds eight accounts and
  snapshots the list at that size, so the next change to it is looked at with
  a wallet that has more than two.
  - **Then: "now its not aligned."** The tint was drawn with a negative margin
    and its own inline padding, which moved that one row out of line with the
    others. Every row carries the same horizontal padding now and the tint
    paints only the row's own box.
- **"Can we get a clear button... right now you have to select all and
  delete."** `Clearable` floats a × over the field's right edge on all three
  destination fields, so the input keeps its own styling. It shows only when
  there is something to clear and returns focus to the input.
  - **Its label must not repeat the field's own.** "Clear the Seedelf name"
    beside a field labelled *Seedelf name* makes that string match two
    elements — for a screen reader looking for the field as much as for the
    test locator that caught it. The existing × buttons label by action
    ("Take recipient 2 off"), and these now do too.

## The owner's answers to what was left open (2026-10-02)

Tested against a **real many-account wallet on preprod**, everything working.
Their calls on the five things that were still mine to guess at:

- **The dApp connector: Eternl's model, which is better than the refusal.**
  *"Eternl does it by actually selecting what account is the dapp account.
  Then no matter what it always uses that account even if you select another.
  Then you can just manually change it later."* So there is now one
  `dappAccount` setting (Settings → Sites) and sites always use it, whichever
  account the picker is on.
  - **This removes the refusal entirely**, and with it the per-site `account`
    on `DappSite`: there is nothing to be on the wrong side of. Switching
    accounts is invisible to a site; changing the dApp account is the
    deliberate act, and Settings says it shows every connected site the new
    account.
  - It needed the `dapp.ts` threading the earlier plan deferred, but **one
    value made it small**: `withDappKeys(holder, task)` resolves to the dApp
    account's keys for every public-account path (seven call sites), and
    `readAccountUtxos` takes an `account` so the connector reads that
    account's UTxOs. Per-*site* accounts would have been the hard version.
  - Default 0, the one account every wallet from before this had, so nothing
    a site already sees changes.
- **Make public gets the account picker too**, as Send has.
- **A filter on the accounts list**, from eight accounts — the point the list
  starts scrolling. By number or by the name the user gave it.
- ***Check it* / *Add it* become chips**, matching *Switch to it* and *Name
  it* above them: they sit inline with a field, not at the foot of a form.
- **`MAX_KEPT`**: see [below](#how-many-accounts-to-keep).

### How many accounts to keep

The owner asked whether 100 is a good value. It is arbitrary, and worth
saying what actually bounds it:

- **Nothing in the derivation or the protocol.** CIP-1852's account index runs
  to 2^31 - 1, and the wallet reaches any of them by number.
- **The sealed record.** 100 accounts with names is a few KB, padded to the
  next power of two — nothing next to the Seedelf history.
- **The two lists.** The top bar is a native `select`, which handles hundreds
  with type-ahead; Settings scrolls and, since this round, filters.

So the cap is a guard against a runaway loop writing junk, not a considered
limit on the user. 100 is well past any realistic wallet while keeping both
lists usable. If anyone ever wants more, raising it is one constant and no
other change.

**What a real user would still find.** The things most likely to come back:
whether the top-bar picker needs more than a native select past a dozen
accounts, and whether the dApp account wants to be visible somewhere other
than Settings — a site talking to an account the picker isn't on is correct
but invisible.
