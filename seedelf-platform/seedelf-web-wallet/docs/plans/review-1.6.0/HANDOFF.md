# 1.6.0's review: handoff (2026-10-24)

**Work in progress.** Branch `web-wallet/review-1.6.0`, from `main` at `499768f6` (everything through PR #323). The review of every PR since 1.5.0 is done. Its fix round had just started when the laptop's editor crashed under the load, so it continues on the other computer. This folder is a working record: archive or remove it before the release PR merges.

## Read this first

- **`main`'s Web Wallet CI is red, and has been since PR #323.** Run 40109672647 on `a6ab608d` (its tree is `499768f6`'s) failed at *Extension unit tests*: 2 Vitest failures, so the build, e2e, `e2e:data` and the store package's e2e never ran. #323 merged 26 seconds after that run started, 12 minutes before it failed (corrected from "a minute later" by the docs check, `review/docs-check.md`). `web-wallet.yml` runs on `pull_request` only, so `main` looks green.
- **The cause is the release blocker:** `62162483` ("a Bootstrap is funded with no collateral") broke every private Bootstrap. Its session holds 1.5 ₳ beside the boxes, and the deposit's change, about 1.33 ₳, can't pay its sweep back (a Seedelf output's least is 1.456780 ₳, plus the fee). So the chain fails, the session comes back directly with a second fee, and no box goes in. Findings 318-rust#0, 323-rust#0 and x-scenarios-lj#0, the same bug found three times.
- **This commit's code is unfinished, and none of it was compiled or tested after the crash.** Start with `cargo fmt --all -- --check`, clippy and the tests below.

## What the review did

- **33 slices.** One reviewer for each small PR and two to five for each large one (#314, #317–#321, #323). Seven cross-cutting lenses: privacy, the 1.5.0 upgrade and the classic pool, release readiness, Spanish, Japanese, and two end-to-end scenario walks. A completeness critic then named three gaps, and each got a probe.
- **Verification.** A skeptic per slice tried to refute every finding. Each high and medium then got an independent reproduction, most by a throwaway test that failed on HEAD. That made 83 agents.
- **136 findings.**
  - 8 high and 8 medium, every one confirmed twice.
  - 78 low and 22 nits.
  - 16 owner's calls (the docs record each as the owner's choice).
  - 4 refuted.
- [FINDINGS.md](FINDINGS.md) has each finding with the reviewer's evidence, the skeptic's verdict, the reproduction and the fix notes (`grep -n '^## <id>'`). The index below groups them by fixer.

**The eight highs come down to three problems:**
1. **The private Bootstrap,** above (318-rust#0, 323-rust#0, x-scenarios-lj#0), and the two red tests it left (x-compat#0, docs-small#0, x-release#0; also 316#2 and 312#4, at lower severity).
2. **314-wasm#0, a hostile pool.** A launch whose script output at the holder carries a deeply nested datum (about 37 ₳ to make) overflows the WebAssembly's stack during pool verification. Every mainnet wallet whose read includes that pool then locks itself. The fix must change the shown-pool rule in core and the data layer together and re-record the shared vectors.
3. **316#0, two Bootstraps in one pool.** A box brought back by hand is credited to the oldest Bootstrap. That one's own boxes stop being held and come back by themselves, unmixed, tying its deposit to the private balance.

**The mediums:**
- **321-lj-worker#0:** Bring every box back now ends before a just-sent chain's boxes land. It says nothing was left and wipes their due times.
- **323-worker#1:** the swap and site approvals' totals leave out the collateral's mix and count its reserve as coming back.
- **gap-1#1:** Remove wallet goes ahead at the first yes while a payment's parts still wait. The recipient is left part-paid.
- **x-scenarios-sessions#0:** after a restore, a session funded in parts brings back only one part's tokens.
- **318-worker#0:** a public Bootstrap's banner says its boxes are on their way to the private balance.
- **316#1:** a public deposit's box comes back with no tie recorded, so a later private Send can spend it with others unwarned.
- **309#0:** the Collateral page opened from Home races Home's watch, and Home holds payments for up to 10 minutes.
- **x-release#1 (an owner's call):** the gate below.

## What this commit holds (unfinished)

Phase A's two fixers, interrupted:

- **bootstrap.**
  - Done:
    - core's `BOOTSTRAP_BACK_RESERVE` (1.5 ₳, beside `DEPOSIT_RESERVE`, never in `funding_for`, which the 1.5.0 gate pins);
    - `bootstrap_most` builds the deposit and the sweep back for each count;
    - tests in `seedelf-core/tests/lovejoin_pools_test.rs`, `wasm/tests/lovejoin_test.rs` and `wasm/tests/lovejoin_flows_test.rs`;
    - the `lovejoinBootstrapReserve` export in `wasm/src/lib.rs`. That was its last write, applied by hand from the temp file the crash left: byte for byte what it was writing.
  - Not yet:
    - the worker: `sessions.ts` `mixFunding` adds the reserve to a private Bootstrap's one payment, and `lovejoin.ts` `privateBootstrapMost` follows;
    - a mark on the record so a Bootstrap funded with no collateral never has one taken at its return (323-worker#4);
    - the screens: `Lovejoin.tsx` `BOOTSTRAP_RESERVE`, `bootstrapLimits`, the review's rows and words in three languages;
    - the two red tests: `tests/lovejoin.test.ts:1907`, and `tests/sessions-review-fixes.test.ts:435`, whose spread must again need more UTxOs than one transaction spends;
    - a Vitest test of the whole private Bootstrap;
    - the docs.
- **data** (`seedelf-data/` only).
  - Done, each with offline tests (five added):
    - 317-data#0, one deadline for `lovejoin/pools`;
    - 317-data#1, `lovejoin/tokens` always kept;
    - 317-data#2;
    - 321-lj-rust-data#0.
  - Not yet:
    - x-release#8, `data-layer.yml`'s paths;
    - the deploy runbook's stale rollback note (310#0, 311#1, x-compat#1, x-release#6). `.prev` is #311's build (`304f1d163`) since the 2026-10-23 deploy of `68150b39`, and it lacks the token-pool routes.
  - **`seedelf-data` changed, so the API must be deployed again after the merge, before the upload.**

## The fix plan

Each fixer writes its test first, sees it fail on the tree for the right reason, fixes, then mutation-checks it (undo the fix, the test fails, restore). Each fixer also:
- puts new or changed words into `en.json`, `es.json` and `ja.json` together;
- updates the design docs (`flows.md`, `architecture.md`, `privacy.md`) for any behaviour it changes.

Rust fixers go strictly one at a time: they share crates and a target directory, and one's half-done edit breaks the other's build. Run at most two fixers at once, paired as below so they don't share files.

| Phase | Fixers | Notes |
|---|---|---|
| A | **bootstrap** · **data** | Finish what's above. bootstrap owns the WebAssembly build. |
| B | **deep-datum** · **docs** | deep-datum covers core `eval.rs` `resolve_reference` and `pool.rs` `held()`, WebAssembly `protocol_of` skipping such a row, the data layer's `standard.rs` (the same rule), the vectors re-recorded on purpose, the worker's trap handling, and node tests at 3,000 and 100,000 levels. docs takes the doc-only findings. |
| C | **rust-rest** · **i18n-existing** | rust-rest rebuilds the WebAssembly at the end and runs the one whole Rust suite. i18n-existing covers the translation findings and `glossary.md`'s 1.6.0 words. |
| D | **worker-lj** · **worker-sess** | `lovejoin.ts` and the like · `sessions.ts`, `parts.ts`, `handlers.ts`, `activity.ts`, `coin-control.ts`, `send.ts`, `pending.ts`. Additive edits only to `rpc.ts` and the JSON locales. worker-sess also makes `lovejoin-funding` return the tail reserve the build would add, for 320-screens#2. |
| E | **screens** | After D, since several fixes need the worker's new fields. |
| F | **i18n-new** · **docs-2** | i18n-new reviews the Spanish and Japanese of every key this round added or changed. A fresh agent then back-translates the critical ones blind, and the result goes into `verified-critical-{es,ja}.json`. docs-2 brings the docs in line with every behaviour change, the privacy policy's 18 October entry included. |
| G | **review of the fixes** | Three lenses (money and state, privacy and words, tests: each fix's test fails without it), a skeptic per finding, then fix-ups. |

**Checks at the end** (CI's own, [web-wallet.yml](../../../../../.github/workflows/web-wallet.yml)):
- in `seedelf-platform`: `cargo fmt --all -- --check`, `cargo clippy --locked -p seedelf-crypto -p seedelf-wasm --all-targets -- -D warnings`, `cargo test --workspace --locked`, `wasm/build.sh`, `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"`;
- in `extension`: `npm run typecheck`, `npm test`, `VITE_ENABLE_MAINNET=false npm test`, `npm run build:ext`, `npm run e2e`, `npm run e2e:data`, and the store package with its e2e;
- in `seedelf-data`: fmt, clippy `-D warnings`, `cargo test`.

## Release prep, after the fixes

1. **A green Web Wallet check on the release PR**, every step, before merging. Making it a required check is the owner's call.
2. **Bump `vitest` from 5.0.1 to 5.0.3.** 5.0.1 has GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp (moderate, dev-only, nothing shipped). 5.0.3 was released 2026-09-30, and `npm audit` showed nothing else. Do it on the other computer: the laptop's npm 11.4.2 rewrites the lockfile's metadata.
3. **Refresh the lists:**
   - `npm run tokens`;
   - `npm run dreps`;
   - `npm run lovejoin-pools`, after `tokens`;
   - the data layer's decimals: `seedelf-data/scripts/token-decimals.py`.
4. **The live run 34g still owes** (x-release#1): a session's return with the collateral's mix, on preprod, through the real giveme.my, with one lock and unlock mid-chain.
   - It has never run. Only a fake giveme.my has signed a Lovejoin mix, so whether giveme.my backs that shape is unknown. If it refuses, every return through Lovejoin waits for it and then stops at the collateral's box.
   - On the laptop, don't restore wallet A (`extension/.preprod-test-wallet.txt`) on a fresh profile for this. A restore gives its 64 held Bootstrap boxes due times. Fund a fresh wallet from A and close A within minutes. The other computer has the 10,000 tADA test wallet.
5. **The owner's:**
   - the live db-sync tests (`cd seedelf-data && cargo test --test live_lovejoin -- --ignored --test-threads=1 --nocapture`);
   - after the merge, the API's deploy and `status`;
   - then check that `GET https://mainnet.seedelf.logicalmechanism.io/seedelf/v1/mainnet/lovejoin/pools` and `.../lovejoin/tokens` answer 200 with JSON. On 2026-10-24, against the `68150b39` deploy, both did, with no token pools yet on mainnet, and `/health` was all `ok`;
   - then the package and the upload.
6. **The privacy policy's date** (x-privacy#4, x-release#4). It says *Effective 18 October 2026* but describes changes through 24 October, and this round's. It's asked twice in the plan and never answered. Recommendation: re-date it to the merge day.
7. **Docs:** the handoff note in [roadmap.md](../../roadmap.md), 34g's record of this review in [chunk-34-token-pools.md](../chunk-34-token-pools.md), and post-release-roadmap's 1.6.0 line.

## The owner's calls

None blocks the release; each has a recommendation.

- **Four boxes a mix can cost a later token its box** in a return across pools: it comes back directly where three wide would mix it (319-rust#1, 319-worker#1; 34e's open call 8). *Leave for 1.6.0:* four wide is off by default, and mainnet has no token pools yet.
- **At one wave deep, a return carrying a token caps its deposit at 64 boxes,** so up to 33 more 10 ₳ boxes come back directly than in 1.5.0 (319-worker#2). *Accept:* only very large returns at depth 1.
- **A session's return can wait up to a day on giveme.my** for its collateral's mix, with no way to bring it back sooner (323-worker#3, x-scenarios-sessions#3). Session 11 chose this. The fix round corrects its words (323-worker#2) and lets withdraws go meanwhile (x-scenarios-lj#1). *Recommend* an "unmixed, now" way out after a few hours: soon after 1.6.0, or in it if the live run shows giveme.my slow.
- **A lock silently cuts a payment's waiting parts** (321-parts-worker#2; 10b's call 1). The fix round adds the warnings: the lock countdown and Remove wallet name them (gap-3#6, gap-1#1). And once the part watched lands after an unlock, Home says the payment went only in part, never that it's confirmed: the watch keeps how far it went, sealed (321-parts-worker#0). What waits still lives in session storage, so a lock still cuts it (wss-1).
- **Transaction details opens only a payment's first part** (321-parts-worker#5). *Later*, as recorded.
- **Bring every box back now can say Done** while a box someone else's mix moved after a later chain is left (321-lj-worker#3; item 5's call, "only what's there now"). *Leave.*
- **A session funded without the reserve pays its collateral's mix from what was coming back** (323-worker#7; Session 11's call 3). *Leave.*
- **A swap approved under 1.5.0 comes back with a collateral mix its approval never showed** (x-compat#3; Session 10's call 1). *Leave.*
- **Every private funding reads every Lovejoin pool again** to price the reserve (x-privacy#3; the five-minute cache was put after release). *Leave.*
- **The store's WebAssembly wraps a u64 overflow silently,** where test builds panic (x-release#7). No case is known on HEAD, and 314-core#1 checks the sums from a pool's datum. *Leave.*
- **The policy's date and the live run:** release prep 4 to 6 above.

## The index

Every finding and the fixer it goes to. "C+E" and "D+E" are split: the Rust or the worker first, then the screens' words.

| id | sev | status | group | title |
|---|---|---|---|---|
| 314-wasm#0 | high | confirmed | B deep-datum | A deeply nested datum on a launch's script output breaks the WebAssembly during pool verification, and the wallet then locks itself |
| 316#0 | high | confirmed | D worker-lj | Two Bootstraps in one pool: a box brought back by hand is credited to the oldest one, whose own boxes then stop being held and come back by themselves |
| 318-rust#0 | high | confirmed | A bootstrap | A Bootstrap from the private balance can never deposit: its chain's return can't be built from what the deposit leaves |
| 323-rust#0 | high | confirmed | A bootstrap | A private Bootstrap funded with no collateral can't build its return, so every one comes back without a box |
| docs-small#0 | high | confirmed | A bootstrap | CI fails on HEAD: two unit tests still expect a Bootstrap's 5 ₳ collateral, so no e2e has run on the release tree |
| x-compat#0 | high | confirmed | A bootstrap | HEAD's Vitest suite is red: two tests still expect a Bootstrap to pay its old 5 ₳ collateral |
| x-release#0 | high | confirmed | A bootstrap | main is red: two Vitest tests still expect a Bootstrap's 5 ₳ collateral, and CI's later steps never ran on that change |
| x-scenarios-lj#0 | high | confirmed | A bootstrap | A private Bootstrap never puts a box in: with no collateral, its deposit's change can't pay for the sweep back, so the chain fails and the session comes straight back |
| 309#0 | medium | confirmed | E screens | Opened from Home's row while waiting, the Collateral page competes with Home's watch; when the page sees the landing first, Home's banner stays on "sent" and Home holds payments for up to 10 minutes |
| 316#1 | medium | confirmed | D worker-lj | A box from a public account's deposit comes back recorded as tied to nothing once its chain record and mix entry are gone (a 1.5.0 public seed's, a released public Bootstrap's) |
| 316#2 | medium | confirmed | A bootstrap | Web Wallet CI is red on main's tree: two unit tests still expect a Bootstrap's 5 ₳ collateral (outside PR #316, found checking the gate's CI) |
| 318-worker#0 | medium | confirmed | D+E (worker, then words) | A Bootstrap from the public account: Home's banner says its boxes are on their way to the private balance |
| 321-lj-worker#0 | medium | confirmed | D worker-lj | Bring every box back now ends as soon as a chain of the wallet's finishes sending, before its boxes land: it says nothing was left, wipes their due times, and they don't come back by themselves until the next unlock or Lovejoin page read |
| 323-worker#1 | medium | confirmed | E screens | The swap and site approvals' cost totals leave the collateral's mix out and count its reserve as coming back |
| gap-1#1 | medium | confirmed | D worker-sess | Remove wallet goes ahead at the first yes while a payment's parts still wait, wiping them and leaving the recipient part-paid without a word |
| x-release#1 | medium | owner-call | owner's call | 34g's own pre-PR gate is still open: the collateral mix never ran live or through the real giveme.my, and the owner's live db-sync tests and calls are pending |
| x-scenarios-sessions#0 | medium | confirmed | D worker-sess | After a restore, a session funded in parts gets back only one part's tokens: the other parts' tokens are left at the one-time account for good |
| 309#1 | low | confirmed | D worker-sess | After 10 minutes, a collateral payment still on its way reads "Not set" on the new Home row, Lovejoin's form and a freshly opened page, which offer a second payment while Home's banner says the first can still land |
| 309#2 | low | confirmed | D worker-sess | A collateral payment is recorded on whichever account is active when its submit returns, not the account it was built on (pre-existing) |
| 310#0 | low | confirmed | A data | The rollback note never got chunk 36's line, and now describes a `.prev` two deploys old |
| 311#0 | low | confirmed | E screens | e2e's 'Back from its review asks neither again' can't catch a second pool_history read |
| 311#1 | low | confirmed | A data | Runbook's rollback note says .prev lacks pool_history: since the 2026-10-23 deploy it has it, and lacks the token pools' routes instead |
| 312#0 | low | confirmed | C rust-rest | Nothing tests the guard that refuses a mix over a transaction's CPU limit: the five-box test passes for another reason |
| 312#1 | low | confirmed | C rust-rest | The harness-vs-wallet check re-measures the wallet's mix instead of reading what it declares, and covers the classic pools only |
| 312#2 | low | confirmed | B docs | The width page and the README still say every mix takes three boxes, and the fallback paragraph doesn't match Mix my boxes again |
| 312#3 | low | confirmed | B docs | The width page's details that HEAD changed: the touch list and the token pool's measured shape |
| 312#4 | low | confirmed | A bootstrap | Outside this slice (PR #323): the Web Wallet CI is red on HEAD; two extension tests still expect a Bootstrap's 5 ₳ collateral |
| 314-core#0 | low | confirmed | C rust-rest | A private launch re-derives its pool and measures a whole withdraw for every input choice it tries |
| 314-core#1 | low | confirmed | C rust-rest | Planner and deposit sums on a pool's box ADA (taken from its datum) are unchecked and wrap in the WebAssembly build |
| 316#3 | low | confirmed | D worker-lj | A chain with no boxes of its own (a direct return's collateral mix, or a tail built again) gets no entry: Your mixes never shows it, and its box is counted against another mix |
| 317-data#0 | low | confirmed | A data | `lovejoin/pools` can take the wallet's whole 10 s read budget, and a read that times out marks the whole private index down |
| 317-data#1 | low | confirmed | A data | `lovejoin/tokens` isn't one of the always-kept answers, though every wallet reads it once a token pool is shown |
| 317-wallet#0 | low | confirmed | C rust-rest | A pool the data layer lists is taken on its word that it exists on chain: a Bootstrap or a session's 5 ₳ collateral can go into a pool whose NFT was never minted, and is locked for good |
| 318-rust#1 | low | confirmed | C rust-rest | A start from the public account can pick a UTxO carrying a reference script, which its own in-wallet measure then refuses |
| 318-worker#1 | low | confirmed | D worker-lj | Starting the same pool again before a look finds the first isn't refused: the second is a copy that's never shown, and its ~23 ₳ is locked for good |
| 318-worker#2 | low | confirmed | D worker-sess | Public activity calls a box the public account paid to bring back "Back from Lovejoin", and counts the account's change as money in while it's on its way |
| 319-rust#0 | low | confirmed | C rust-rest | plan_across fails the whole plan when a token leg gets no box and its token isn't held, beside another leg's held token |
| 319-rust#1 | low | owner-call | owner's call | Four wide across pools can leave a later leg (another token, or the ADA) with no box where three wide gives it one, and four still goes |
| 319-worker#0 | low | confirmed | D worker-lj | With four asked and the classic pool short at both widths, the swap approval and Stop's dialog say the ADA "mixes three at a time" beside the warning that it comes back directly |
| 319-worker#1 | low | owner-call | owner's call | Four boxes a mix can cost a later token its box: it comes back directly where three would have mixed it (34e's open call 8, still undecided) |
| 319-worker#2 | low | owner-call | owner's call | At depth 1, a return that takes a token into its pool caps the whole deposit at 64 boxes, so up to 33 more ADA boxes come back directly than 1.5.0 would have |
| 319-worker#3 | low | confirmed | D worker-lj | No test covers a return chain across pools stopped partway: the per-pool bookkeeping for its unmixed boxes is untested |
| 320-screens#0 | low | confirmed | E screens | A started pool that will never show is said to be 'on its way' for a day, then dropped without a word |
| 320-screens#1 | low | confirmed | E screens | Start a pool's amount fields skip the wallet's amount guard: in Spanish '1,125' becomes 1,125 and the review reads as 1.125 |
| 320-screens#2 | low | confirmed | E screens | The Mix form's figures leave out the collateral's mix that a private mix's funding now pays for |
| 320-screens#3 | low | confirmed | E screens | Start swap / Start mix / Send read 'Sending…' while the switch or Change only rebuilds the review |
| 320-screens#4 | low | confirmed | E screens | Mix again's Four boxes a mix switch stays turned when its rebuild fails, over a review built at the other width |
| 321-lj-rust-data#0 | low | confirmed | A data | Discovery's read on re-gathers every holder output above the last candidate that holds no `lovejoin` token, at every cursor |
| 321-lj-rust-data#2 | low | confirmed | C rust-rest | The WebAssembly README's export table is missing 1.6.0's collateral fields and new exports |
| 321-lj-screens#0 | low | confirmed | E screens | Bring every box back now can say "Done: N back" after the user pressed Stop |
| 321-lj-screens#1 | low | confirmed | E screens | The public Mix form's cap counts ADA the public chain never spends: staking rewards and ADA held with other tokens |
| 321-lj-screens#2 | low | confirmed | E screens | Mix my boxes again's Four boxes a mix switch keeps the new width after the rebuild fails, while the review and Send stay at the old width |
| 321-lj-screens#3 | low | confirmed | E screens | The private Mix form's totals leave out the 1.5 ₳ the funding now adds for the collateral's mix |
| 321-lj-screens#4 | low | owner-call | E, tail case only | "Comes back once it's mixed, about" counts the 5 ₳ collateral, which now goes into the 5 ₳ pool and comes back later as a box |
| 321-lj-screens#5 | low | confirmed | E screens | Bring every box back now's reason tells the user to "Pay from your public account", which that run never offers |
| 321-lj-worker#1 | low | confirmed | D worker-lj | Bring every box back now waits with no word of why; since #323, a session's collateral mix waiting on giveme.my can keep that wait up to a day |
| 321-lj-worker#2 | low | confirmed | D worker-lj | Bring every box back now's pay-from-the-private-balance branch for a stuck pool has no test |
| 321-lj-worker#3 | low | owner-call | owner's call | Done can be said while a box that was there at the ask is left behind: madeSince drops one someone else's mix moved after any later chain of the wallet's |
| 321-lj-worker#4 | low | confirmed | D+E (worker, then words) | 'Waiting for the chain to confirm', with no Stop, can last up to 2 h when a sent withdraw never lands |
| 321-parts-rust#0 | low | confirmed | C rust-rest | CLI sweep's default ADA for 21+ distinct tokens is now refused by the shared builder |
| 321-parts-worker#0 | low | confirmed | D worker-sess | After a lock, Home calls a payment in parts "confirmed" (a funding "funded") though its waiting parts were wiped and never go |
| 321-parts-worker#1 | low | confirmed | D worker-sess | Send again on a first part that may have gone says the rest didn't go and to review what's left, while the pump still sends it |
| 321-parts-worker#2 | low | owner-call | owner's call | A lock or auto-lock silently cuts a payment's waiting parts; the lock countdown warns only of Lovejoin chains |
| 321-parts-worker#3 | low | confirmed | D worker-sess | A later part's inputs are checked for "spent since" and reservations only as it goes, after earlier parts went |
| 321-parts-worker#5 | low | owner-call | owner's call | The review's Transaction details opens only the first part |
| 321-parts-worker#6 | low | confirmed | C+E (Rust reason, then words) | Max's "stays for another payment" line gives the wrong reason when Max in parts left UTxOs whose part couldn't pay its fee |
| 322#0 | low | confirmed | E screens | Details suggests "a report to Minswap" but never says the transaction ties whoever sends it to the swap's one-time account |
| 322#1 | low | confirmed | E screens | The CBOR sits inside the retry line's aria-live region, so with Details open each new failure reads thousands of hex characters aloud |
| 323-rust#1 | low | confirmed | C rust-rest | The 1.5 ₳ tail reserve covers the collateral's mix only on a chain; a direct return needs about 2.7 ₳ of ADA beside the collateral |
| 323-worker#0 | low | confirmed | D worker-sess | Where a 5 ₳ pool is shown, every funding takes 1.5 ₳ more than its form checks, and nothing falls back without it |
| 323-worker#2 | low | confirmed | D worker-lj | A return held back for its collateral's mix gives a false reason and "try again in a minute" for up to a day, with no way to bring it back directly |
| 323-worker#3 | low | owner-call | owner's call | While giveme.my is busy or out of reach, a session's return sits at its collateral's mix for up to a day, and no screen says why |
| 323-worker#4 | low | confirmed | A bootstrap | A Bootstrap whose one funding UTxO is exactly 5 ₳ of ADA is taken for its collateral, and comes back without going in |
| 323-worker#5 | low | confirmed | D worker-lj | A collateral box that has landed but isn't listed yet is taken for moved, and the return sweeps what pays for its mix |
| 323-worker#6 | low | confirmed | E screens | Funding reviews still say the 5 ₳ comes straight back |
| 323-worker#7 | low | owner-call | owner's call | A session funded without the reserve pays its collateral's mix from what was coming back |
| 323-worker#8 | low | confirmed | D worker-lj | The tail's give-up paths, which release the session's money, have no test |
| docs-small#1 | low | confirmed | B docs | Plan §2 still says L's registration is checked at each read: nothing checks it after discovery, and on mainnet the wallet takes the server's word |
| docs-small#2 | low | confirmed | B docs | keys-and-accounts.md wasn't updated for 1.6.0: it says only a mint, a public mix and a site put up the account's collateral |
| gap-1#0 | low | confirmed | D worker-lj | A private session's collateral mix waiting on giveme.my blocks switching public accounts for up to a day, and the refusal blames "this account" |
| gap-2#0 | low | confirmed | C rust-rest | Public docs on RestTo and account_send still say "in one output"; HEAD splits tokens 20 to an output |
| gap-3#0 | low | confirmed | B docs | flows.md's private-swap Back paragraph still describes #321's unmixed collateral box and its old setting name |
| gap-3#1 | low | confirmed | B docs | flows.md's session flows still bring the 5 ₳ back with the rest, though a shown 5 ₳ pool now takes it through the collateral's mix |
| gap-3#2 | low | confirmed | E screens | Reviews that show *For its collateral's mix* still say the 5 ₳ comes back at once, or with the next return |
| gap-3#3 | low | confirmed | B docs | flows.md says the web wallet's Max takes the 20 largest UTxOs; since 1.6.0 it spends every UTxO in parts |
| gap-3#5 | low | confirmed | B docs | flows.md says Settings asks Koios for nothing but three things; Bring every box back now reads every pool and asks giveme.my at once |
| gap-3#6 | low | confirmed | D worker-sess | Neither Remove wallet nor the lock countdown mentions a payment whose parts still wait, though a lock or removal stops them as it stops a Lovejoin chain |
| x-compat#1 | low | confirmed | A data | The deploy runbook's rollback note describes a .prev that's gone and never mentions the token-pool routes |
| x-compat#2 | low | confirmed | D worker-lj | The 1.5.0 gate never runs with a token pool shown, the state every preprod wallet starts in |
| x-compat#3 | low | owner-call | owner's call | A swap approved under 1.5.0 comes back with a collateral mix its approval never showed |
| x-i18n-es#0 | low | confirmed | C i18n-existing | lovejoin.pools.starting |
| x-i18n-es#1 | low | confirmed | C i18n-existing | settings.lovejoin.collateralOn |
| x-i18n-ja#0 | low | confirmed | C i18n-existing | worker.parts.partlyMaybe / worker.parts.fundingPartlyMaybe: "Koios didn't answer" names the wrong server on mainnet (en, es and ja) |
| x-i18n-ja#1 | low | confirmed | C i18n-existing | worker.parts.partlyMaybe |
| x-i18n-ja#2 | low | confirmed | C i18n-existing | lovejoin.ways.fundedInto |
| x-privacy#0 | low | confirmed | D worker-lj | A stuck pool's Bring one back can tie two public accounts with neither named |
| x-privacy#1 | low | confirmed | E screens | The swap approval and the Lovejoin tile's private mix reviews don't say giveme.my sees the collateral's mix |
| x-privacy#2 | low | confirmed | B docs | giveme.my's lists of what it sees leave out the session collateral's mix |
| x-privacy#3 | low | owner-call | owner's call | Private session fundings read every Lovejoin pool afresh to price the collateral's reserve |
| x-privacy#4 | low | owner-call | owner's call | The policy is dated 18 October, but its 1.6.0 entry includes changes from 19 to 23 October |
| x-release#2 | low | confirmed | B docs | The release procedure skips what 1.6.0 adds: no check of the token routes after the deploy, no 1.6.0 flow in the preprod checklist, and a live-run step that can't pass |
| x-release#3 | low | confirmed | B docs | The policy's and privacy.md's lists of what giveme.my sees leave out the collateral mix |
| x-release#4 | low | owner-call | owner's call | The policy says 'Effective 18 October 2026' but describes behaviour built up to 24 October, and goes live on main before 1.6.0 reaches users |
| x-release#5 | low | confirmed | B docs | The README feature lists still describe 1.5.0's Lovejoin, and the extension README lacks npm run lovejoin-pools |
| x-release#6 | low | confirmed | A data | deploy/README.md's rollback note describes a .prev two deploys out of date |
| x-release#7 | low | owner-call | owner's call | The store's WebAssembly wraps u64 overflow silently, where every test build panics |
| x-scenarios-lj#1 | low | confirmed | D worker-lj | While a collateral's mix waits on giveme.my or Koios (up to a day), no box in any pool comes back, and Bring one back and Bring every box back now are held |
| x-scenarios-sessions#1 | low | confirmed | C+E (Rust reason, then words) | Max's note on UTxOs left behind gives a false reason now that Max goes in parts |
| x-scenarios-sessions#2 | low | confirmed | D worker-sess | Two of Send's "partly sent" errors misstate what happens to the remaining parts |
| x-scenarios-sessions#3 | low | owner-call | owner's call | A session's whole return waits on giveme.my for its collateral's mix, up to a day, with no direct way out |
| 314-core#2 | nit | confirmed | C rust-rest | `with_staking` admits script-credential certificates that need a script witness the spend never adds |
| 316#4 | nit | confirmed | D worker-lj | rpc.ts: LovejoinChainTx's doc comment is stranded above LovejoinMixView's, and `cleared`'s comment shares a line with `chain` |
| 317-data#2 | nit | confirmed | A data | `lovejoin/pools` queries db-sync on every request, before it looks in its cache |
| 318-worker#3 | nit | confirmed | D worker-lj | A pool's start and a token-pool mix from the private balance read epoch_params twice in one review |
| 319-rust#2 | nit | confirmed | C rust-rest | Stale comments: the WebAssembly module still says 10 ₳ boxes three wide, and the width doc names the old core path |
| 320-screens#5 | nit | refuted | refuted | The hub's aside says 'A mixer for ADA and tokens' when the only other pools are ADA pools |
| 321-lj-rust-data#1 | nit | confirmed | C rust-rest | `external_sweep_with` outlived the collateral box it was written for: an unused public builder with a stale doc and an unchecked `extra` |
| 321-lj-screens#6 | nit | confirmed | E screens | Settings says "Nothing of yours was left in Lovejoin" after watching a single pool's run end with nothing sent |
| 321-parts-rust#1 | nit | confirmed | C rust-rest | Stale builder docs: 'in one output' after tokens went 20 to an output, and external_sweep_with describes a removed collateral box |
| 321-parts-rust#2 | nit | confirmed | C rust-rest | Max in parts over no UTxOs returns Ok with zero parts, where one transaction's Max refuses |
| 321-parts-worker#4 | nit | refuted | refuted | Once its parent shows, a waiting part is retried at every pump, up to every 5 s, against giveme.my |
| 322#2 | nit | refuted | refuted | The hex is cut only when it ends the message: anything after it puts the whole transaction back on the retry line, wrapped into a tall wall |
| 322#3 | nit | refuted | refuted | es: "de su lado" reads as "taking its side", not "on Minswap's servers" |
| 323-rust#2 | nit | confirmed | C rust-rest | Stale docs on the replaced collateral box and on the return spending the collateral |
| docs-small#3 | nit | confirmed | B docs | Plan §5: a private launch's change takes its inputs' merged history, not "a history class of its own" |
| gap-3#4 | nit | confirmed | B docs | seedelf-platform/CLAUDE.md tells agents Max takes at most 20 UTxOs and settle refuses only over 16 KiB; 1.6.0's output limit, typed errors and carry are missing |
| gap-3#7 | nit | confirmed | B docs | flows.md:521 says the collateral switch goes off with the returns switch; it's only greyed out, and a mix still mixes its collateral |
| x-i18n-es#2 | nit | confirmed | C i18n-existing | lovejoin.pools.flag.held |
| x-i18n-es#3 | nit | confirmed | C i18n-existing | lovejoin.launch.needBox |
| x-i18n-es#4 | nit | confirmed | C i18n-existing | worker.parts.partlyMaybe |
| x-i18n-es#5 | nit | confirmed | C i18n-existing | lovejoin.bootstrap.atMost |
| x-i18n-ja#3 | nit | confirmed | C i18n-existing | worker.parts.tooMany |
| x-i18n-ja#4 | nit | confirmed | C i18n-existing | lj.launch.otherPool |
| x-i18n-ja#5 | nit | confirmed | C i18n-existing | lovejoin.pools.starting |
| x-i18n-ja#6 | nit | confirmed | C i18n-existing | glossary.md records none of 1.6.0's new words |
| x-release#8 | nit | confirmed | A data | data-layer.yml doesn't run when networks.ts or seedelf-core's constants.rs change, though seedelf-data's tests read both |
