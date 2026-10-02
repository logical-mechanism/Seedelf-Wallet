# Post-release roadmap

[roadmap.md](roadmap.md) is closed. Every chunk in it is done, v1.0.0 reached the Chrome Web Store on 2026-09-28, and **1.1.0 — the transaction view — is with the store now**. This file is what comes after it.

**Why a second file.** The roadmap's job was to get a wallet built, in order, to a line where it could ship. That job is finished. From here the work isn't a sequence: it's a set of candidates with different claims on us — things already promised, things the owner wants, things that would be good, and things we have decided against. So this file is buckets, not an order. The roadmap stays the record of what *happened*; this one is the record of what *might*, and it's what a new chunk is chosen from.

## How this file works

- **Buckets by claim, not by order:** [Owed](#owed) · [Needs](#needs--the-style-and-flow-pass-round-three) · [Wants](#wants) · [Nice to have](#nice-to-have) · [Not planned](#not-planned).
- **A line becomes a chunk when the owner picks it.** It takes the next number after the roadmap's (18 onwards), a branch `web-wallet/<topic>` from `main`, a plan in [plans/](plans/), and a handoff note in [roadmap.md](roadmap.md#handoff-notes) when it lands. Tick it here and link its plan.
- **Status:** ✅ done · 🚧 in progress · ⬜ not started · ⛔ blocked · ❓ needs the owner's call
- **The rules from chunks 11–17 still hold** ([chunk 14's list](plans/chunk-14-style-flow-2.md#rules-that-still-hold)): Lace is inspiration for look and flow, never a brand to copy; **every privacy note stays** — a redesign may move or shorten one, never drop it; correctness UX is always in scope; nothing new phones home without its own decision; every feature states its Koios cost, and anything paged scales with the contract's size; a renamed control updates the e2e tests in the same commit; the name is Seedelf.
- **Demand decides.** The web wallet's [README](../README.md) says features are added only if there's demand. A line here is a candidate, not a commitment.

## Where Cardano parity stands

Measured against **Lace 2.4.2** (`_reference/lace` at `e431933`, pulled 2026-10-02), the reference since chunk 11a. For what a Cardano wallet does with one account, parity holds. What's left is either a deliberate no or a *later, maybe* — not an unfinished edge.

| Lace's surface | Seedelf Wallet | |
|---|---|---|
| Portfolio: tokens, NFTs, search, sort | Tokens, with search, sort, NFTs split out, logos from the bundled registry | matched — but **no NFT images** |
| Send, several recipients, a note | Send on both sides, up to 20 recipients, CIP-20 note on a public send | matched — and it pays **Seedelfs** as well as addresses |
| Receive, QR, your ADA Handles | All three, plus the handle-in-Seedelf warning | matched |
| Activity, detail per transaction | Activity on both sides, with CSV (after Eternl's) | matched |
| Staking: one pool, pool browser, rewards, stop | All four; Stop staking returns the 2 ₳ deposit | matched |
| Governance: DRep delegation, DRep browser | Both, from a DRep list that ships with the wallet | matched |
| dApp connector (CIP-30), authorized dApps, sign tx, sign data | All, **off until turned on**, nothing injected before that | matched — and it has **private CIP-30** too |
| dApp explorer | The dApps page; a small catalogue | matched in kind |
| Swap center | Minswap's aggregator | matched — and swaps can run **privately**, through a one-time account |
| Collateral | Settings → Collateral, 5 ₳ reserved locally, as Lace does it | matched |
| Contacts / address book | Contacts, offering addresses and Seedelf names | matched |
| App lock, lock timeout, default open mode | All three; tab by default, side panel by choice, no popup | matched |
| Fiat value | Eight currencies or nothing, mainnet only | matched |
| Review a transaction before signing | **Transaction details** everywhere: the CBOR decoded by us, plus the raw bytes | ahead — Lace resolves and prices the transaction; what we add is **the bytes themselves**, decoded and raw |
| Several accounts, folders, account center | Account `0'` only | **gap** — *later, maybe*; the groundwork is in |
| Several wallets (more than one phrase) | One phrase | **gap** — ❓ never asked |
| Theme selection | Dark only | **gap** — *later, maybe* |
| Language (i18n) | English only | **gap** — nice to have |
| Notification center | None | **gap** — needs background chain reading |
| QR scanner (camera) | None | **gap** — a new permission, so its own decision |
| Several pools per account | One pool | **no** — and Lace is coming the same way: `migrate-multi-delegation` at tip is a *multi→single* migration |
| Hardware wallets (Ledger, Trezor, Keystone, SeedSigner, air-gapped QR) | None | **no** — README's *Not planned* |
| Buy (on-ramp) | None | **no** |
| Identity centre, KYC | None | **never** — see [Not planned](#not-planned) |
| Analytics (PostHog) | None | **never** |
| Earn / RealFi USDr staking, CIP-99 claims | None | **no** |
| Bitcoin, Midnight, mobile | None | **no** — one chain, one browser |

**The honest summary:** the public side is a Cardano wallet of the same shape as Lace's, and the private side has no equivalent there. The three real gaps a user could notice are **several accounts**, **NFT images** and **a light theme** — all three already written down as *later, maybe* before this file existed.

## Owed

Promises the repo has already made. These come before anything new.

| # | Item | Status |
|---|---|---|
| O1 | **Tag the releases.** No `web-wallet/*` tag exists — not 1.0.0, not 1.1.0 — though [development.md](development.md#branching) requires the slash form and the handoff notes name the commit and the zip's SHA-256 for each. Nothing in git says which commit a store upload was built from. Tag both retroactively, on the commits the notes name. | ⬜ |
| O2 | **1.1.0 goes live, and is recorded.** When the store publishes it, add the handoff note: the date, and anything the dashboard asked that the docs don't cover (1.0.0 turned up two such things). | 🚧 with the store |
| O3 | **The by-hand mainnet checks still open** in [plans/launch-review.md](plans/launch-review.md)'s *Still open*: `exclude_protocols` with VyFinance and MuesliSwap, one swap through each remaining route in `MAINNET_PROTOCOLS` (one is proven so far), and Stop or a refund on a swap. The owner's, since they spend real ADA. | ⬜ owner's |
| O4 | **A chain in flight is invisible to the transaction view.** Its transactions move to `seedelf.session.chain.<network>.<index>`, which `BUILT_KEYS` doesn't name, so the audit view wants that prefix scan. And **Home's banner watches the chain's last transaction**, so it shows a hash the user never saw — it may want to say "the chain" instead. Both from chunk 17's handoff note. | ⬜ |
| O5 | **A2, the contract round trip:** a Minswap V2 order paying straight to a Seedelf. Designed in [plans/chunk-15-dapp-connector.md](plans/chunk-15-dapp-connector.md); waiting on a batcher test. | ⛔ blocked |

## Needs — the style and flow pass, round three

**The one the owner asked for after the roadmap.** Chunks [12](plans/chunk-12-style-flow.md) and [14](plans/chunk-14-style-flow-2.md) were rounds one and two; 11a was only half-Lace. It runs the same way both of those did: **the owner tests the built wallet and sends findings; each finding goes in a table with what was decided**, and batches land with tab and side-panel screenshots to check before the next rebuild.

**The owner's list goes here.** ❓ asked for — nothing below is a substitute for it.

Known candidates, carried from earlier chunks:

- **About 150 plain note paragraphs could become ⓘ hints.** Chunk 17 built `components/Hint.tsx` and moved the transaction view's six paragraphs behind icons; the owner's wider point was that "a lot of the paragraphs we have could be like that". Which ones is theirs to pick. **Privacy callouts and warnings stay where they are** — those are decisions, not explanations. ❓
- **The splash reaches its 8 s cap on mainnet.** That's Koios being slow, not the splash (chunk 17's note). Worth asking whether a first reading can show something sooner — a balance that fills in — rather than a cap that expires. ⬜
- **1.1.0 itself is a fair thing to put in front of the pass.** The transaction view is new and has never been through a findings round.

## Wants

| # | Item | What it needs | |
|---|---|---|---|
| W1 | **Your own Koios endpoint.** Every transaction goes through Koios and every private spend through giveme.my, both from the user's IP, so either can group one person's private spends — the root [README](../../../README.md#de-anonymizing-via-ip-tracking) calls this out and says Tor access is being explored. A field for a self-hosted or paid Koios instance is the one thing the wallet can do about it without a new dependency, and it would lift the public tier's budget at the same time. | A Settings field, the host permission problem (Chrome needs the origin at install, or an optional-host grant at the moment it's set), and a decision on what a wrong endpoint may be allowed to do. | ❓ |
| W2 | **Several accounts.** README's *later, maybe*. The groundwork is in: every function already takes the account index, and a picker would discover accounts in order the way BIP44 does, stopping at the first never used. | Discovery cost against the Koios budget, and what the private side does — the Seedelf key stays on its own account 0 whichever Cardano account is in use ([keys-and-accounts.md](keys-and-accounts.md#the-cardano-account)). | ⬜ |
| W3 | **Word of an incoming payment without opening the wallet.** README's *later, maybe*; Lace has a notification centre. | Reading the chain in the background, which is exactly what the Koios budget makes hard (5,000 a day, 40 per 10 s shared) — and it must not change what Koios can tell about a locked wallet. | ⬜ |
| W4 | **NFT images.** Deferred in chunk 14 pending "a better way to fetch them first", and that's still the open question: fetching per asset tells whoever serves the image what this wallet holds. | A fetch design that doesn't leak holdings — a proxy, a cache, or off by default with the trade-off stated. | ❓ |
| W5 | **A light theme.** Deferred in chunk 14. The colours are already 44 CSS custom properties on `:root` in `ui/styles.css` (chunk 11a took Lace's dark token structure, not its brand), which is the layer a second theme redefines. | A second token set and a Settings choice; every screen re-checked, since contrast was tuned for dark only. | ⬜ |

## Nice to have

- **Language support (i18n).** No strings are externalised today, and `tests/words.test.ts` reads English text to enforce the Seedelf spelling — that check would need to move with them. ⬜
- **A QR scanner for an address**, as Lace has. Needs the camera permission, so a new store justification and its own decision. ⬜
- **`web+cardano` payment links** (CIP-13), so a link can open Send with the recipient filled in. ⬜
- **A wider dApp catalogue** on the dApps page. Each entry is a claim that the dApp works privately, so each needs a test run first. ⬜
- **More than one phrase in one extension**, as Lace's wallet repo allows. Never asked for; listed because Lace has it. ❓

## Not planned

From the web wallet's [README](../README.md) — **proposal voting, registering as a DRep, several pools per account, hardware wallets, other chains, mobile** — plus the ones Lace ships and we won't:

- **Analytics of any kind.** Lace has eight analytics and PostHog packages. A wallet whose point is that nobody can group a user's actions cannot ship a telemetry client.
- **An identity centre or KYC.** Same reason, more so: it would publish exactly what the wallet exists to keep apart.
- **An on-ramp (Buy).** It would tie a funded account to a real identity at the moment of funding, and we'd be sending the user to a third party to do it.
- **Hardware wallets.** Already declined; worth recording *why* it stays declined: a Ledger or Trezor can't produce the BLS12-381 Schnorr proof a Seedelf spend needs, so hardware could only ever cover the public side — a wallet that is half secured by a device is a worse thing to explain than one that isn't.

A line here moves only on real demand, and then as its own decision with the reason written down.

## Open questions for the owner

1. **The findings list for round three** — the pass can't start without it.
2. **W1, your own Koios endpoint:** is the IP-linkage worth a Settings field, and should a wrong endpoint be able to do anything but fail?
3. **W2 and W5, several accounts and a light theme:** which, if either, is wanted first?
4. **W4, NFT images:** off by default with the leak stated, or wait for a proxy?
5. **More than one phrase** (Nice to have): wanted at all?
6. **O1, the tags:** retro-tag 1.0.0 and 1.1.0 on the commits the handoff notes name?
