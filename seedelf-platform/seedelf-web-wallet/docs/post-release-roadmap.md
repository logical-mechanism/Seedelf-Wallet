# Post-release roadmap

[roadmap.md](roadmap.md) is closed. Every chunk in it is done, v1.0.0 reached the Chrome Web Store on 2026-09-28, and **1.1.0 — the transaction view — is with the store now**. This file is what comes after it.

**Why a second file.** The roadmap's job was to get a wallet built, in order, to a line where it could ship. That job is finished. From here the work is a short sequence with a set of candidates hanging off it — things already promised, the last of Cardano parity, then a pass over how all of it looks and feels. The roadmap stays the record of what *happened* and still takes the handoff notes; this one is the record of what *might*, and it's what a new chunk is chosen from.

## How this file works

- **A line becomes a chunk when the owner picks it.** It takes the next number after the roadmap's (18 onwards), a branch `web-wallet/<topic>` from `main`, a plan in [plans/](plans/), and a handoff note in [roadmap.md](roadmap.md#handoff-notes) when it lands. Tick it here and link its plan.
- **Status:** ✅ done · 🚧 in progress · ⬜ not started · ⛔ blocked · ❓ needs the owner's call
- **The rules from chunks 11–17 still hold** ([chunk 14's list](plans/chunk-14-style-flow-2.md#rules-that-still-hold)): Lace is inspiration for look and flow, never a brand to copy; **every privacy note stays** — a redesign may move or shorten one, never drop it; correctness UX is always in scope; nothing new phones home without its own decision; every feature states its Koios cost, and anything paged scales with the contract's size; a renamed control updates the e2e tests in the same commit; the name is Seedelf.
- **Releases aren't tagged, and that's not an oversight.** No `web-wallet/*` tag exists for 1.0.0 or 1.1.0: a release is recorded by its handoff note, which names the commit and the zip's SHA-256. The version is decided when enough has accumulated to be worth one — a `1.x.0` bump for features, `1.x.y` for a fix. If a tag is ever cut it **must** carry the slash, or [release.yml](../../../.github/workflows/release.yml) ships signed CLI binaries off it ([development.md](development.md#branching)).
- **Demand decides.** The web wallet's [README](../README.md) says features are added only if there's demand. A line here is a candidate, not a commitment.

## The order

**The owner's call (2026-10-02): feature parity first, the look and feel after it.** The wallet can be feature-complete bar the dApp additions, and it's a better thing to put a style pass in front of once it is.

1. **[Owed](#owed)** — promises the repo has already made.
2. **[Feature parity: what's left](#feature-parity-whats-left)** — several accounts, language, NFT images. At the end of this, the wallet is feature-complete for Cardano.
3. **[The data layer](#the-data-layer)** — its own question, and the thing several other items are waiting on.
4. **[Then the UX and UI pass](#then-the-ux-and-ui-pass)** — round three, after parity.
5. **[dApp additions](#dapp-additions)** run alongside all of it, and are not counted in parity.

## Where Cardano parity stands

Measured against **Lace 2.4.2** (`_reference/lace` at `e431933`, pulled 2026-10-02), the reference since chunk 11a. For what a Cardano wallet does with one account, parity holds already; three things are left, and the rest is a deliberate no.

| Lace's surface | Seedelf Wallet | |
|---|---|---|
| Portfolio: tokens, NFTs, search, sort | Tokens, with search, sort, NFTs split out, logos from the bundled registry | matched — **bar NFT images** |
| Send, several recipients, a note | Send on both sides, up to 20 recipients, CIP-20 note on a public send | matched — and it pays **Seedelfs** as well as addresses |
| Receive, QR, your ADA Handles | All three, plus the handle-in-Seedelf warning | matched |
| Activity, detail per transaction | Activity on both sides, with CSV (after Eternl's) | matched |
| Staking: one pool, pool browser, rewards, stop | All four; Stop staking returns the 2 ₳ deposit | matched |
| Governance: DRep delegation, DRep browser | Both, from a DRep list that ships with the wallet | matched |
| dApp connector (CIP-30), authorized dApps, sign tx, sign data | All, **off until turned on**, nothing injected before that | matched — and it has **private CIP-30** too |
| dApp explorer | The dApps page; a small catalogue | matched in kind; see [dApp additions](#dapp-additions) |
| Swap center | Minswap's aggregator | matched — and swaps can run **privately**, through a one-time account |
| Collateral | Settings → Collateral, 5 ₳ reserved locally, as Lace does it | matched |
| Contacts / address book | Contacts, offering addresses and Seedelf names | matched |
| App lock, lock timeout, default open mode | All three; tab by default, side panel by choice, no popup | matched |
| Fiat value | Eight currencies or nothing, mainnet only | matched |
| Review a transaction before signing | **Transaction details** everywhere: the CBOR decoded by us, plus the raw bytes | ahead — Lace resolves and prices the transaction; what we add is **the bytes themselves**, decoded and raw |
| Several accounts, folders, account center | Account `0'` only | **doing it — [P1](#feature-parity-whats-left)** |
| Language (i18n) | English only | **doing it — [P2](#feature-parity-whats-left)**, Lace's way |
| NFT images | Logos only | **doing it — [P3](#feature-parity-whats-left)**, click to show |
| Notification center | None | **kept in mind, not this round** — it needs [the data layer](#the-data-layer) first |
| Several pools per account | One pool | **one pool per account** is the model — and Lace is coming the same way: `migrate-multi-delegation` at tip is a *multi→single* migration |
| Hardware wallets | None | **can't be done** — see [the proof](#why-hardware-wallets-cant-cover-seedelf) |
| Earn / RealFi USDr staking, CIP-99 claims | None | **no** — likely AML/KYC, which doesn't align with Seedelf |
| Bitcoin, Midnight, mobile | None | **Cardano only for now**; others maybe much later |

**Dark only**, by the owner's call — there is no light theme and no theme picker, and that isn't a gap. **One recovery phrase**, likewise: not a gap, not wanted.

## Owed

Promises the repo has already made. These come before anything new.

| # | Item | Status |
|---|---|---|
| O1 | **1.1.0 goes live, and is recorded.** When the store publishes it, add the handoff note: the date, and anything the dashboard asked that the docs don't cover (1.0.0 turned up two such things). | 🚧 with the store |
| O2 | **The by-hand mainnet checks still open** in [plans/launch-review.md](plans/launch-review.md)'s *Still open*: `exclude_protocols` with VyFinance and MuesliSwap, one swap through each remaining route in `MAINNET_PROTOCOLS` (one is proven so far), and Stop or a refund on a swap. The owner's, since they spend real ADA. | ⬜ owner's |
| O3 | **A chain in flight is invisible to the transaction view.** Its transactions move to `seedelf.session.chain.<network>.<index>`, which `BUILT_KEYS` doesn't name, so the audit view wants that prefix scan. And **Home's banner watches the chain's last transaction**, so it shows a hash the user never saw — it may want to say "the chain" instead. Both from chunk 17's handoff note. | ⬜ |
| O4 | **A2, the contract round trip:** a Minswap V2 order paying straight to a Seedelf. Designed in [plans/chunk-15-dapp-connector.md](plans/chunk-15-dapp-connector.md); waiting on a batcher test. | ⛔ blocked |

## Feature parity: what's left

Three items. At the end of them the wallet is feature-complete for Cardano, bar [dApp additions](#dapp-additions).

### P1 · Several accounts

**The owner's reason (2026-10-02):** a user restoring a phrase may hold funds on accounts other than `0'` and want to move them into Seedelf, and **some people run several accounts as a form of privacy in the first place** — so a wallet that can only see one is both losing their money and working against the habit they came with.

The groundwork is in: every function already takes the account index, and a picker would discover accounts in order the way BIP44 does, stopping at the first never used ([keys-and-accounts.md](keys-and-accounts.md#the-cardano-account)).

**The decision the plan has to make, and it's a privacy one.** The Seedelf key derivation already takes an account index — `info = "seedelf-key" || u32_be(account)` in [derivation.rs](../../seedelf-crypto/src/derivation.rs) — but the wallet pins it to 0, so one private balance sits behind whichever Cardano account is in use. With several accounts that's a fork:

- **One private balance for the whole phrase** (pin stays at 0): simpler, and money from any account lands in one place. But a user keeping accounts apart for privacy now has them meeting in the private balance.
- **One Seedelf key per account index** (the derivation already allows it): keeps the separation the user came with, at the cost of several private balances to scan, show and explain — and the scan cost is per balance, against the Koios budget.

❓ **The owner's call.** It can't be changed later without moving funds: a Seedelf key is where money lives.

Also to settle: discovery cost against the Koios budget, and what the dApp connector offers a site when there are several accounts (chunk 15's connect window chooses nothing by design — Lace's default-account setting was declined in the privacy review).

### P2 · Language

**Copy what Lace does** (the owner's call), which is a good fit for our rules because **every locale is bundled — nothing is fetched, so no new host and nothing phones home**:

- **i18next**, with one flat JSON per locale in `contract/i18n/src/translations/` — Lace ships `en`, `es`, `ja`.
- **The picker derives its own list from the bundled files.** Each locale file carries `translation.language.name` and `translation.language.code`, so the languages are a single source of truth and adding one is: write the JSON mirroring `en.json`'s keys, register it, and i18next and the picker pick it up (their `translations/index.ts` says exactly this at the top).
- **Default `en`**, with the system locale used when it's one we ship (`getSystemLanguage()`).

**What it costs us, specifically:**

- **No strings are externalised today.** This is the bulk of the work, and it touches every screen.
- **`tests/words.test.ts` has to move with them.** It parses source files for a lowercase "seedelf" in anything a person reads; once the text is in JSON it must check the locale files' values instead — and **Seedelf stays Seedelf in every language**, so it can check them all, not just English.
- **A missing translation must fall back to English, never vanish** — i18next's `fallbackLng` does this, and it matters most for the privacy notes, which the rules say may never be dropped.
- **Who translates.** A machine translation of a privacy warning is a correctness problem, not a cosmetic one. ❓

### P3 · NFT images

**The owner's design (2026-10-02): click to show, and the image downloads to that browser.** No image host or proxy of ours — serving image data for every asset needs serious hardware, and a proxy would be one more service that sees what a wallet holds.

- **Off until clicked**, per image, so nothing is fetched for a wallet merely opening Tokens.
- **The residual leak, stated where it's chosen:** the click tells whoever serves that image (an IPFS gateway, usually) that this IP wants that asset. That's the trade-off being accepted — user-initiated, one image at a time, instead of a page that quietly fetches everything a wallet holds.
- Deferred in chunk 14 pending "a better way to fetch them first"; this is it.

## The data layer

**The owner is weighing a purpose-built data layer in Rust** (2026-10-02): a service on a cloud server querying a db-sync, with queries written for this wallet rather than general-purpose like Koios. ❓

**Why it keeps coming up.** Koios is the sole data layer today, on the public tier, and it's the ceiling under several things at once:

- **The contract scan pages.** Preprod's shared contract has already grown past one page of 1,000 rows, so a reading takes two requests — and that grows with the contract, for every user.
- **The budget is tight and shared:** 5,000 requests a day, 40 every 10 seconds, a 30 s timeout. Chunk 14's rules make every feature state its cost because of this.
- **It's what the notification centre is waiting on.** Word of an incoming payment without opening the wallet means reading the chain in the background, which the budget above forbids. That's the thing that "does not exist at the moment".
- **IP linkage.** Every transaction goes through Koios and every private spend through giveme.my, both from the user's IP, so either can group one person's private spends — the root [README](../../../README.md#de-anonymizing-via-ip-tracking) says so, and says Tor access is being explored. `koios.rest` doesn't offer Tor. **A service we run could.**

**The constraint that has to hold whatever gets built: the ownership check stays in the wallet.** Matching a contract UTxO to a Seedelf needs the secret scalar, so the server must never be asked "which of these are mine" — it serves contract UTxOs, and the wallet matches them locally, as it does now. A data layer that answered that question would be a service that knows every user's private balance.

**Open, if it goes ahead:** what it costs to run; whether it's the default or a choice, with Koios as the fallback; whether a user can point the wallet at their own instance; and the host-permission problem in Chrome (a new origin at install, or an optional grant when it's set). **It replaces nothing about the wallet's own privacy rules** — being ours makes it answerable, not blind.

## Then the UX and UI pass

**Round three, after parity** (the owner's call). Chunks [12](plans/chunk-12-style-flow.md) and [14](plans/chunk-14-style-flow-2.md) were rounds one and two; 11a was only half-Lace. It runs the way both of those did: **the owner tests the built wallet and sends findings; each goes in a table with what was decided**, and batches land with tab and side-panel screenshots to check before the next rebuild.

The list is the owner's to write when parity lands. Carried candidates:

- **About 150 plain note paragraphs could become ⓘ hints.** Chunk 17 built `components/Hint.tsx` and moved the transaction view's six paragraphs behind icons; the owner's wider point was that "a lot of the paragraphs we have could be like that". Which ones is theirs to pick. **Privacy callouts and warnings stay where they are** — those are decisions, not explanations. ❓
- **The splash reaches its 8 s cap on mainnet.** That's Koios being slow, not the splash (chunk 17's note) — and possibly [the data layer](#the-data-layer)'s to fix rather than the splash's. Worth asking whether a first reading can show something sooner, a balance that fills in, rather than a cap that expires.
- **Everything parity adds** — the account picker, the language picker, images on Tokens — reaches the pass having never been through a findings round. So does the transaction view.

## dApp additions

**Not counted in parity, and ongoing.** The dApps page's catalogue is the one part of the wallet that grows after feature-complete: each entry is a claim that the dApp works *privately*, through a one-time account with the money coming back, so each needs its own test run before it ships. Minswap is the first, Lovejoin is in, and A2 ([O4](#owed)) is the next shape of it.

## Kept in mind

- **A notification centre** — word of an incoming payment without opening the wallet. Not this round: it needs [the data layer](#the-data-layer), and it must not change what a backend can tell about a locked wallet. ⬜
- **`web+cardano` payment links** (CIP-13), so a link can open Send with the recipient filled in. ⬜

## Not planned

From the web wallet's [README](../README.md): **voting on proposals, registering as a DRep, several pools per account, hardware wallets, other chains, mobile**. With the reasons worth keeping:

- **One pool per account** is the model, not a limitation — and Lace is migrating from multi-delegation to single at tip.
- **Earn / RealFi USDr staking, and CIP-99 claims:** likely AML/KYC, which doesn't align with Seedelf.
- **Cardano only for now.** Other chains, and mobile, maybe much later; nothing is designed for them.
- **Nothing that reports on the user or ties them to an identity** — analytics, KYC, an on-ramp. Lace ships all three; they're the opposite of what this wallet is for.

### Why hardware wallets can't cover Seedelf

Not declined for effort — it doesn't work, and the reason is one line of the derivation.

**The Seedelf secret scalar comes from the BIP39 seed** ([derivation.rs](../../seedelf-crypto/src/derivation.rs), v1, frozen):

```text
seed = BIP39 seed of the phrase          PBKDF2-HMAC-SHA512, 2048 rounds
okm  = HKDF-SHA-256(ikm = seed, salt = "seedelf-wallet-v1",
                    info = "seedelf-key" || u32_be(account), L = 64)
x    = int_be(okm) mod r
```

1. **A hardware wallet's one guarantee is that the seed never leaves it.** So outside the device there is no seed, and without the seed there is no `x`.
2. **Inside the device there is no path either.** A Cardano app would have to implement Seedelf's HKDF *and* then the BLS12-381 Schnorr proof over it (`z = r + c·x`, with `c` binding the one-time key hash). The Cardano apps sign Ed25519 over a transaction hash; none exposes arbitrary BLS12-381 scalar work, and none ever will on our ask.
3. **So hardware could only ever hold the public account's CIP-1852 keys** — half the wallet — while the private side still needs the phrase in the browser. A wallet that is half secured by a device is a worse thing to explain than one that isn't.
4. **And it's structural.** The v1 derivation is frozen, because every existing phrase depends on it; there's no redesign that reaches a device without being a v2 scheme no device implements either.

The same argument rules out air-gapped QR signing for the private side, for the same reason.

## Open questions for the owner

1. **[P1](#p1-several-accounts) — one private balance for the whole phrase, or one per Cardano account?** The derivation already allows either, and it can't be changed later without moving funds. The privacy reason given for several accounts argues for per-account; simplicity and one balance to scan argue against.
2. **[The data layer](#the-data-layer)** — go ahead? If so: default or a choice with Koios as the fallback, and can a user point at their own instance?
3. **[P2](#p2-language) — which languages, and who translates?** Lace ships English, Spanish and Japanese. A machine-translated privacy warning is a correctness problem.
4. **Anything in [Not planned](#not-planned) you'd rather not have written down at all** — analytics, KYC and the on-ramp are kept there as one line, so a future session doesn't propose them afresh.
