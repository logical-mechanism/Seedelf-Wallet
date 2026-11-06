# 1.8.0's release review: the fixers' brief

You're one of eight fixers of 1.8.0's release review. Each fixer has one lane: its findings, and the files it owns. Read this brief all through first. Then read:
- the reviewers' brief, [REVIEWBRIEF.md](REVIEWBRIEF.md): the owner's calls, the rules, the severity scale, and the never-do list, which binds you too;
- [FINDINGS.md](FINDINGS.md), the clustered findings;
- each finding of your lane, in full, in its finder's report under [find/](find/);
- its verdict, if it has one, in [verify/](verify/). The verifiers re-traced the mediums and the single-lens lows, and some changed the fix.

## The base and your worktree

- **The base:** `web-wallet/release-1.8.0` at `1beba3fb`. That's `a6c94743` (main after #364) plus the release prep: 1.8.0, the DRep lists, the token decimals, and preprod's v2 5 ₳ pool `47bece42…` bundled in `src/lovejoin-pools.json`. Two tests fail there by design: `lovejoin-1-5-0`'s head-start case, which is the e2e lane's to rework.
- **Your worktree** is `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/fix/<lane>`, on the branch `review-1.8.0/fix-<lane>`. `extension/node_modules` and `wasm/pkg` are copied in.
- **Git:** commit there, on your branch, as often as you like:
  - stage by path (`git add <paths>`, never `-A` or a folder);
  - messages in the house style: `fix(web-wallet): …`, a body saying what and why, and the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line;
  - no push, no other branch, no rebase, nothing in the main tree.
- **The main tree** (`/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`) is read-only for you, except your report.

## The owner's call of 2026-11-06 (the find and connector lanes')

"We need it to work since that if no 5 ada pool exists, or really any pool, then no mix happens. Then when it exists it uses it." The pool is launched from the wallet, before or after the release.

- **No head-start gate, and no floor gate.**
- **No pool means no mix, said truthfully:** a return comes back directly, and every screen says so. The connector's approval is one of those screens.
- **A pool launched later is found and used on both networks without Lovejoin's page opening:** on preprod, on mainnet with the data layer up, and on mainnet with Koios-only on or the data layer down.

## How to fix

- **Test-first, each fix:**
  1. Write the test.
  2. Run it at your base, and see it fail for the finding's reason.
  3. Fix.
  4. See it pass.
  5. Revert the fix alone and see the test fail again.

  Put each step's command and result in your report. A finding that's only a test (an untested guard) gets the same check: the test fails under the finding's mutant.
- **New tests go in a new file of your lane's,** named in your lane's row below, so no two lanes edit one test file. The exceptions are the existing files your lane's row names: their tests pin what your fix changes.
- **Match the code around you:**
  - this codebase's long comments say why, and cite the review that asked, e.g. `(1.8.0's release review, retire#0)`;
  - match their density and voice;
  - no formatter: no prettier, and no `cargo fmt` that writes.
- **Keep each change to its finding.** If a fix needs a file outside your lane, don't edit it: say what and why in your report, and the lead does it at the merge.
- **The rules that bit before:**
  - No paternalistic guards: refuse only what the ledger, the contracts or an owner's call refuses.
  - Private by default.
  - Sum outside values checked, or in u128 or BigInt.
  - A trap is handed on, never swallowed (`unlessTrap`, `isTrap`).
  - The worker never compares, parses or saves translated text it didn't make. A reason it saves is the `t()` of a key, read later in its frame.
- **Words:**
  - UI text is short: one line, no essays around buttons.
  - Always *Seedelf*, and *Seedelf Wallet* for the app.
  - A module-level `const X = t("key")` binds English at import.
  - en, es and ja together, every plural form (es has `_many`).
  - A value in es or ja identical to English needs its provenance.
  - **A new or changed critical value** (a key with `.warn.` or `.privacy.` in its name):
    1. Write the es and ja drafts, `machine` in `docs/i18n/{es,ja}-provenance.json`.
    2. Add the key to `docs/i18n/verified-critical-{es,ja}.json`'s `keys`, provisionally, so the gate passes. Don't touch `reviewer`.
    3. Run `node scripts/i18n-critical.mjs --write`.
    4. List the key in your report under **Awaiting blind back-translation**, with every frame it's shown in. The lead's translation step back-translates it blind and records it.
  - A changed value: grep the tests for the key and its words, the saved worker reasons, and the negation word lists (the i18n tests name them).
- **Checks before you report**, from your worktree's `extension/`:
  - `npx tsc --noEmit -p .`;
  - every test file your change can reach, both builds: `npx vitest run <files> --maxWorkers=2`, and the same with `VITE_ENABLE_MAINNET=false`;
  - the i18n and words files: `tests/i18n*.test.ts tests/words.test.ts tests/worker-words.test.ts`.
  - Eight lanes share 12 CPUs: run targeted files, never the whole suite at once.
- **Rust** (the v44a lane only), from `seedelf-platform`:
  - `CARGO_TARGET_DIR=/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/target-pr363 cargo test -p <crate> --test <name>`;
  - the data layer from `seedelf-data`, with `CARGO_TARGET_DIR=…/target-pr363-data`, offline `cargo test` only;
  - `cargo clippy` with `-D warnings` on what you touched; `cargo fmt --check`, never a write.
- **Playwright** (the connector and e2e lanes only): `npm run build:ext` in your worktree, then `npx playwright test --project=extension -g "<pattern>" --workers=2`.

## The lanes

Eight lanes. The fix for each finding is the one its verifier settled, where one did. The verifiers' reports and prototypes:
- `verify/o-design.md` (O1, O4, O5, O6, with the whole change set) and its prototype diffs, `o-design-full-patch-lovejoin.diff` and `o-design-full-patch-sessions.diff`;
- `verify/o2-trace.md` (O2), `verify/o3-trace.md` (O3);
- `verify/p1-trace.md` and `verify/p1-impact.md` (P1), and `p1-impact-prototype.diff`;
- `verify/lows-a.md` (P2, O5, V1, S1), `verify/lows-b.md` (W3, W4, W5, W8, W9);
- `verify/critic.md` (critic#0 to #7).

The diffs are in the scratchpad: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/`. The verifiers' and finders' scratch tests are in their sandboxes, `…/scratchpad/wt/<lens>/seedelf-platform/seedelf-web-wallet/extension/tests/`. Each is a ready start for a test of yours: read it first, and move it, don't copy it blind.

| Lane | Findings | Files it owns | Its new test file |
|---|---|---|---|
| **find** | O1, O2 (with critic#1), O4 (with critic#0), `room()`'s dead default (adapool#6), critic#7 | `lovejoin.ts`: `adaPool`, `room()`, `LovejoinDeps`, the comments by `adaPoolOf`/`retiredOf`. `lovejoin-pools.ts`: `refresh`, `look`, `serviceDeps`, and a throttled look for an ask. `sw.ts`, if the wiring needs it. `sessions.ts`: `priced`, `collateralWanted`, `buildBack`'s no-collateral branch, `backCollateralBuild`. `Swaps.tsx`: when the approval shows its Lovejoin choice for `skipped` (`any`). i18n: the values of `sess.skip.warn.noAdaPool` and `lj.skip.warn.floorShort`. `tests/lovejoin-1-5-0.test.ts`: its `NO_ADA_POOL` pin (`:420`) alone | `tests/lovejoin-found-later.test.ts` |
| **chain** | O5, critic#4 | `lovejoin.ts`: `chain()`'s no-pool throw and its call to `acrossOf`, `acrossOf`'s ADA leg made optional, and the count of a return's ADA boxes (`countAt`). `sessions.ts`: the approval's record (a marker on `auto.lovejoin`), and what `buildBack` passes to `chain()` for a swap's return | `tests/lovejoin-chain-review-fixes.test.ts` |
| **share** | P1 (with P1-onebox), P2, P4 | `lovejoin.ts`: `fits`, `againBoxes`, `chain()`'s `holdTail` line (`:3551`), `fanOut`, `roomIn`, `collateralPool`'s return, `TAIL_DRAWS`'s export. `sessions.ts`: `mixFunding`, `tailReserve`, `stopCost`'s `collateralMix`, `buildBack`'s tail branch, `claimBuildNow`. `Lovejoin.tsx`: `mixOffer`, `tailReserveOf` and the Mix form's call to them. `tests/lovejoin.test.ts`: the count at `:2342` | `tests/lovejoin-share-review-fixes.test.ts` |
| **retire** | R1–R8, W2, critic#3, critic#5, S3's BringAllBack half (screens#7, words#9) | `lovejoin.ts`: `retireOnce`, `retiredIds`, `tailBoxes`, `tailBuildable`, `madeSince`, `bringAllBack`, `bringAllBackNow`, `held`, `publicBuild`, `publicAgainBuild`. `handlers.ts`: the `lovejoin-bring-all-back` case. `rpc.ts`: that request's payload. `BringAllBack.tsx`. `tests/run-traps-review-fixes.test.ts` (R6); `tests/lovejoin-restore.test.ts` and `tests/lovejoin-flows.test.ts` (R7) | `tests/lovejoin-retire-review-fixes.test.ts` |
| **connector** | O3, W5; `DappApprovals.tsx`'s stale comments (W10) | `DappApprovals.tsx`. `sessions.ts`: the site's funding (`siteOutBuild`) and its summary's mark of the 5 ₳ pool. Wherever the connect approval is built, for the card's mark. `rpc.ts`: those fields. i18n: `dappUi.back.privacy.*`, `dappUi.private.privacy.*` and the new hedged note. `e2e/extension.spec.ts`: the connect test's Lovejoin assertions (around `:5090–5130`) and a sibling of it. The unit pins of those words (o3-trace and lows-b name them) | `tests/connector-lovejoin-review-fixes.test.ts` |
| **screens** | W1, W3 with W4, W7, W8, W9, S1, S2, O6, the rest of W10, S3's screens half (screens#8, screens#10, words#10, tests-e2e#2's unit half), screens#9 | `Swaps.tsx` (but find's `any`), `Lovejoin.tsx` (but share's `mixOffer` and `tailReserveOf`), `LovejoinReturn.tsx`, `Home.tsx` and `preferences.tsx` (comments alone). `rpc.ts`: `LovejoinChainView` and its comments. `lovejoin.ts`: the chains' view (W8's flag) alone. i18n: the `swaps.*` box words and `lj.unusable.warn.retired`. `tests/screens.test.ts` (W1's pins); `tests/i18n-worker-reasons.test.ts` (W7) | `tests/lovejoin-screens-review-fixes-1-8-0.test.ts` |
| **e2e** | D6, tests-e2e#1, tests-e2e#3, the e2e half of tests-e2e#2, and o-design's mainnet "found later" e2e | `tests/lovejoin-1-5-0.test.ts`: the head-start case (but find's pin at `:420`). `e2e/extension.spec.ts`: everything but the connect test's Lovejoin lines | — |
| **v44a** | V1–V6, pr363#4's comments | `lovejoin-launch.ts`. `lovejoin.ts`: `LaunchRecord` and `recordLaunch` alone. `lovejoin-pools.ts`: its header comment alone. `seedelf-core/src/lovejoin/pool.rs` (its doc comment). `seedelf-core/tests/lovejoin_width_test.rs`. The data layer's `standard.rs`, `routes.rs` and `templates.rs` tests. `wasm/tests/lovejoin_v2_fixture_test.rs` and its two fixtures (V6, only if every test that reads them still passes). `tests/lovejoin-discovery.test.ts` (V2) | `tests/lovejoin-v2-review-fixes.test.ts` |

**Where lanes meet:**
- **`lovejoin.ts`:** each lane owns the functions in its row. Edit nothing else in it. `chain()` is shared:
  - chain owns its no-pool throw, its call to `acrossOf` and `countAt`;
  - share owns its `holdTail` line;
  - nobody else edits it.
- **`sessions.ts`:**
  - `buildBack`: find owns its no-collateral branch, share its tail branch, and chain what it passes to `chain()`.
  - `priced` is find's. `stopCost` is share's, which calls `priced`.
  - `siteOutBuild` is connector's.
- **`rpc.ts`:** retire, connector and screens each own one shape.
- **i18n:**
  - find, connector and screens each change their own keys, next to related keys.
  - The lead merges the JSON and the provenance files, and runs `i18n-critical.mjs --write` again.
- **`tests/lovejoin-1-5-0.test.ts`:** find edits the `NO_ADA_POOL` pin alone; e2e owns the rest.
- **`e2e/extension.spec.ts`:** connector owns the connect test's Lovejoin lines; e2e owns the rest.
- **Order.** Each lane runs at `1beba3fb`'s behaviour for every other lane's code:
  - The connector lane's mark reads the 5 ₳ pool as `priced` does. It gets the find lane's ask at the merge. Write to the rule (the pool known, and taking a box now), not to how the ask is built.
  - The e2e lane's mainnet "found later" test is written to fail at the base. It passes once the find lane's look is merged, and the lead checks that.
  - With the look merged, a return may find a pool the e2e expects only the page to find. Note any test that depends on that.

## Each lane's fixes

**find:**
- **O1.** Follow `verify/o-design.md` §3, steps 1 and 8:
  - `adaPool`'s ask looks at Koios's holder when no 5 ₳ pool is kept after the refresh: on preprod, with Koios-only on, and with the data layer down. At most every `REFRESH_MS` a network.
  - Hardening (a): the throttle lives in discovery (a `lookSoon` that joins a scan under way and skips one within `REFRESH_MS` of any scan, the page's too), handed to the service through `serviceDeps`.
  - Hardening (b): an in-flight refresh is shared.
  - A look that fails finds none, and a trap is handed on.
  - The tests are §5's items 1–8 and 11. Wire discovery as `sw.ts` does, with an injected head start holding no v2 pool (§5 says why).
- **O2.**
  - `priced` asks at Review and in Stop's dialog (`adaPool(network, pool)`), and stays quiet as the user types.
  - `collateralWanted` takes an `ask`:
    - `buildBack`'s no-collateral branch and `backCollateralBuild` ask; the list (`backWantsCollateral`) doesn't;
    - with no ADA pool after the ask and no token's pool wanting the collateral, the reason is `noAdaPool`, never `noBox`;
    - critic#1: under the floor, it reads the kept room (`room`, asking nobody within `POOL_ROOM_MS`) and says no, so the return gives the floor's reason and offers no 5 ₳.
  - The approval's choice (`Swaps.tsx`, `any`): shown for `skipped` only where the ADA would pay for a box. With no pool shown, `priced` reports `of` at a 5 ₳ box's own price (o2-trace's narrowing). Its corner probe must still pass.
- **O4 with critic#0.**
  - Reword `sess.skip.warn.noAdaPool` and `lj.skip.warn.floorShort` so that each reads true in every frame it's shown in, now and later. Each says what the wallet found when it read, not what is so now: e.g. "the wallet knew of no Lovejoin pool of 5 ₳ boxes to take it", and "Lovejoin's pool held {{count}} boxes not yours when the wallet read it, and the wallet mixes only from {{floor}}".
  - The frames: the return's review, the swap's `swaps.lovejoin.warn.pool` and `swaps.stop.poolShort`, which open with `{{why}}` (capitalise as `sentence.ts` does, or start the value right), `lovejoin.warn.skippedIts`, `claim.warn.skippedItem`, and the Mix form's refusal.
  - Both keys are critical: follow the critical-value steps.
- **W10:** `room()`'s dead default; critic#7, `adaPoolOf`'s doc comment moved to it.

**chain:**
- **O5.** Follow `verify/o-design.md` §3 step 4, prototyped in `o-design-full-patch-lovejoin.diff` (take its O5 hunks alone; its `adaPool` hunk is the find lane's).
  - With no 5 ₳ pool shown, a return's tokens still go into their usable v2 pools: `acrossOf` runs with no ADA leg.
  - `noAdaPool` is thrown only when no token goes.
  - Tests: lows-a's and cross's token case, and o-design's swap case (`o-design-planner-noada.test.ts`).
- **critic#4.** A swap approved on 1.7.2 has its funding priced in the classic pool's 10 ₳ boxes. Coming back on 1.8.0 by itself, with no review, it takes no more ADA boxes than that pricing counted for its ADA (`funding(…, undefined)` prices the classic pool, as 1.7.2's `priced` did). So its mixes and fees stay within what its approval showed, and the rest comes back at once.
  - A swap approved on 1.8.0 records a marker on `auto.lovejoin` (the box value it was priced at, say), and isn't capped.
  - Tests: critic#4's scratch case (`critic-scratch.test.ts`, "classic pool's price"), its fill and its refund, and a 1.8.0 approval left uncapped.

**share:**
- **P1.** p1-impact's (c), with its pins A–E and its prototype (`p1-impact-prototype.diff`):
  - Mix my boxes again holds the collateral's two draws, where Settings' collateral is on and the pool is the collateral's (`againBoxes` through `roomIn`, and `holdTail` for again in `chain()`). Its count is the wallet's, so this refuses nothing.
  - The tile's Mix keeps the user's count. Where its boxes leave fewer than two free, the review says `ifLeft` with the plain hint, and the form shows its existing `CollateralIfLeft` (`mixOffer`'s `left`).
  - Update `lovejoin.test.ts:2342`'s count (5 → 4).
- **P1-onebox** (p1-trace's question 2): Stop's dialog says `ifLeft` where the ADA pool's room, less the return's boxes' draws, leaves fewer than `TAIL_DRAWS`. A swap's approval stays as it is: it's a forecast.
- **P2.** lows-a's fix: reserve a direct return's collateral tail when it's built, as a chain is reserved. Handle a `StalePool` at that reserve by dropping the tail or building again.
- **P4.** The tests in tests-unit#2, tests-unit#3 and adapool#5 (items 4–8), each failing under its mutant.

**retire:**
- **R1–R4** as FINDINGS.md says. For R3, a pool missing from the read set is undecided: `retireOnce` decides nothing that run.
- **R5–R8** as FINDINGS.md says, from the finders' scratch tests and mutants (retire#3–#5, cross#1–#2, tests-unit#1, #4, #5, #7, #8, #10).
- **W2:** `goingText`.
- **critic#3:** `retireOnce` drops the retired pools' `notMixed` and `unsure`, as the run's end does.
- **critic#5:** `madeSince` passes over a box only for a chain that mixes in its pool.
- **S3's BringAllBack half:** screens#7 and words#9.

**connector:**
- **O3.** o3-trace's "What the approval should say":
  - The card adds the verified `swaps.lovejoin.privacy.onPoolShort` wherever the worker's mark doesn't say the 5 ₳ pool takes a box of the spare ADA now. The mark is a quiet read: never a look tied to a site's connect.
  - The funding review keeps its rows, and its note becomes a hedged one: one new critical key.
  - Never the direct words: they go false once a pool fills.
  - The worker hands the funding summary `priced`'s rule at Review (`skipped`: no pool, the floor, the room; a failed read counts as short).
  - The e2e: the hedge in the connect test's no-pool world, and the plain words in a world where the pool takes boxes.
- **W5:** neither note leaves "the 5 ₳" next to "5 ₳ boxes". Fold it into the hedged note's wording, and fix `noteLovejoinMixed`.

**screens:**
- **W1:** the swap's box words name the pool's box value (5 ₳, or `{{box}}`); update `screens.test.ts`' pins.
- **W3 with W4:** drop "Your boxes in it come back by themselves." from `lj.unusable.warn.retired` in en, es and ja (lows-b): a critical value.
- **W7:** `unusableReason` in `REASON_FUNCTIONS`.
- **W8:** `LovejoinChainView.retired`, and the row says the existing `lovejoin.detail.whyStopped` there (lows-b).
- **W9:** `OtherAccounts` only where Mix again isn't refused.
- **S1:** search only while the box shows, and the empty line reads the same value.
- **S2:** the page keeps its last read while it holds a `done`.
- **O6:** o-design §3 step 7. Keep `tokenPools` for the cost note.
- **W10:** the comments.
- **S3's screens half** and screens#9.

**e2e:**
- **D6 and tests-e2e#1:**
  - `lovejoin-1-5-0`'s head-start case compares the retired pools alone, and asserts the bundled v2 pools apart.
  - The e2e's boxes go to the bundled pool's mix_box where one is bundled (preprod), and `fivePool` is kept where none is (mainnet).
  - Mix my boxes again isn't run on a copy.
- **tests-e2e#3:** a token's list of pools, opened and gone back from.
- **tests-e2e#2's e2e half:** a retired pool's page with the wallet's box, where Bring one back now works.
- **o-design §5's e2e:** mainnet, Koios-only, `fivePool`, no `lookedForFive`. A site session's Bring it back finds the pool, giving the floor's reason with 20 strangers or mixing with 30 or more, with one holder read at the build. It fails at the base.
- Stress every new or changed test: `taskset -c 0,1 … --repeat-each=3`, dev build and store build (`VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true npm run build:ext`, never `npm run package`).

**v44a:** V1 to V6 as FINDINGS.md says, with lows-a's check of V1's fix. V6 only if every reader of the two fixtures still passes after the re-record.

**For the lead, at the merge:** critic#2. Settings' Bring every box back, asked with no pool named, looks first (the find lane's throttled look), so a Koios-only device restored after its boxes went into a v2 pool finds them without Lovejoin's page.

## Your report

Write it to `docs/plans/review-1.8.0/fix/<lane>.md` in the main tree before you return. For each finding of your lane:
- what changed (files, functions);
- the test, with its failure at the base, its pass, and the revert check (commands and results);
- or why it isn't fixed: refuted by its verifier, needs another lane's file, or needs the owner.

Then:
- **Awaiting blind back-translation:** each new or changed critical key, with its frames;
- **For the lead:** what another lane or the merge must know, and the edits outside your lane you'd make;
- **Checks run:** tsc and the test files, both builds, with their counts.

Return the same as your structured output, with your branch's head commit.
