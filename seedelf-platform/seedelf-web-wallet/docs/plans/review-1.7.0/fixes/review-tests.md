# Review of the merged fixes: the tests lens

Tree: `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0` (branch `web-wallet/release-1.7.0-fixes`, working changes on `6bca8bec`). Read-only: nothing in `W` was edited, no git state changed, no file added there.

## How it was checked

- **Copies only.** `seedelf-platform/` copied without `target/` and the extension's `node_modules`, `dist`, `release`, `test-results` to `scratchpad/fix/mut/rt/`, `node_modules` symlinked back. A second copy of HEAD's web wallet (`git archive 6bca8bec`) at `scratchpad/fix/mut/rt-head/`, for "did HEAD's test catch this".
  - The copy matched `W` byte for byte at about 21:15, and again after its re-sync at 21:26 (`diff -rq`).
  - The runner restores each file after its mutation and checks it against `W` (`scratchpad/fix/rt/mut.py`, `mut-rs.py`). The Rust copy's `target/` is deleted (it sat in the RAM-backed `/tmp`).
- **Baseline in the copy:** every test file below passes unmutated. `tsc --noEmit` is clean. `words`, `privacy-notes`, `i18n`, `i18n-critical-helpers`, `i18n-assembly`, `i18n-screens` and `handlers` pass. seedelf-wasm's `lovejoin_test` (23) and `lovejoin_flows_test` (14) pass. So do core's `eval_test`, `orders_test`, `apart_test`, `lovejoin_pools_test` and `wasm_profile_test`.
- **75 mutations:** 64 TypeScript and 11 Rust. Each takes one fix back out, or breaks a guard a test claims to pin. Each ran with its tests, one file at a time.
  - 69 failed the test meant to catch them.
  - 6 survived. 4 of them are the three findings below (F1 twice). The other 2 can't change behaviour, or tsc catches them.
- **`W` moved while I worked.** My copy is from 20:57, and `diff -rq` showed `W` unchanged until about 21:15. From 21:23 a further round ("1.7.0's review of the fixes", worker#0 and worker#1) edited `sessions.ts`, `lovejoin.ts`, `session-trap.test.ts`, a comment in `lovejoin-pools.ts`, and three docs.
  - I re-synced the copy at 21:26.
  - I mutation-checked that round's two code changes (last rows of the table).
  - I re-ran F1, F2 and F3 on the 21:26 state. All three still hold.
- **CI lane:** I re-ran its harness (`scratchpad/ci-lane/test_web_wallet_ci.py`) myself. The fixed `web-wallet.yml` passes 78 of 78. HEAD's fails 16, each for its finding's reason. Its HEAD copy is byte-identical to `git show 6bca8bec:.github/workflows/web-wallet.yml`.

**Verdict:** every code fix of this round has a test that fails without it. No lane changed or dropped an existing assertion's meaning by editing it. One existing assertion went vacuous, because the pools lane's design change made the code under it asynchronous (F2). The guard for critical translations can't see a changed value (F1). Nothing found is a behaviour defect in the shipped code.

## Findings

### F1 (low): the critical-translation guard checks keys by name, so this round's four changed critical values pass CI with no back-translation

- **Evidence:** `extension/tests/i18n.test.ts:199-203`, `const ok = new Set(verified.keys); … .filter((k) => !ok.has(baseOf(k)))`.
  - A key listed once in `docs/i18n/verified-critical-{es,ja}.json` counts as verified whatever its value becomes.
  - Both changed keys were listed before this round, and both are `machine` in the provenance files.
- **What changed this round:**
  - `lj.tail.privacy.wayOut` (tail lane): `es.json:969`, `ja.json:875`.
  - `settings.koiosOnly.privacy.off` (docs-design lane): `es.json:2171`, `ja.json:1901`.
- **Shown in the copy:** I replaced es `lj.tail.privacy.wayOut`'s first sentence with "La mezcla del colateral ya se hizo." ("the collateral's mix is done already", the opposite). I replaced ja `settings.koiosOnly.privacy.off`'s new sentence with "the wallet asks Koios nothing".
  - `i18n.test.ts` still passes 24 of 24, and `i18n-critical-helpers.test.ts` 62 of 62.
- **Scenario:** the lead commits, CI is green, and 1.7.0 ships these four critical privacy values never back-translated, against the owner's rule 6. The FIXBRIEF says "A test will fail until that's done". It won't. The tail and docs-design lanes each say so in their reports, but nothing on CI will.
- **Fix:**
  - For this release: back-translate the four values blind and record the round in `verified-critical-{es,ja}.json`.
  - For the guard, later: record what each verification saw (a hash of the value beside its key), and have the test treat a key whose value no longer matches as unchecked.
- **Note:** the gap predates this round. It's reported because this round leans on it.

### F2 (low): the 314-wasm#0 test's "left out of the data layer's list" assertion went vacuous when refresh() stopped waiting for Koios's check

- **Evidence:**
  - `extension/tests/lovejoin-discovery-review-fixes.test.ts:124-127` reads `found.known()` right after `refresh()`.
  - Since the pools lane's pr336#1 fix, `refresh()` starts the check without waiting for it (`lovejoin-pools.ts:485-489`: `this.lists.set`, `await this.keep(network, [])`, then `this.confirm(network, found)`, not awaited).
  - The fake's `utxo_info` (`:98`) answers the chain's clean rows, so whatever passes the offline check is kept later, after the assertion has read.
  - The pools lane changed the test's second half to `look()`, not this first half.
- **Shown:** I emulated an offline check that lets the deep-datum pool through, by dropping the script rows' `inline_datum` before `lovejoinVerifyPool` (`lovejoin-pools.ts:476-478`).
  - The merged tree's test passes, 4 runs of 4.
  - HEAD's test against HEAD's code with the same change fails: "expected [ { …(5) } ] to deeply equal []".
- **Scenario:** a later change makes the worker's offline check pass a listed pool whose script row carries a datum too deep to read, for example by stopping passing the list's script datum, or a depth-walk change that doesn't trap. The test stays green.
  - The trap half of 314-wasm#0 is still pinned: a trap rejects `refresh()`.
  - Koios's check reads the chain's rows through `launched()`, which the same file's holder-scan test covers with a deep datum. So production stays guarded by the check. The worker's own filter, which feeds `lastListed`, isn't.
- **Fix (verified in the copy):** `:126`, `await found.refresh("preprod")` → `await found.look("preprod")`. It passes on the merged code and fails under the change above.

### F3 (nit): 317-wallet#0's list-contradiction check can be deleted with every test green; the pools lane's new comment states what the test doesn't check

- **Evidence:** `extension/tests/lovejoin-discovery.test.ts:342-348` runs on `koiosOf([], [])`: no launch, so nothing could be kept anyway.
  - Deleting `lovejoin-pools.ts:471` (`if (p.launch.tx !== launched || p.scripts.some(…)) continue;`) leaves all 27 tests green, on HEAD and on the merged tree alike.
  - The lane rewrote the comment at `:335` to say "nothing is asked of Koios about it". Nothing asserts that.
- **Scenario:** the check goes in a refactor. A self-contradicting list is then asked of Koios (`utxo_info`, `tx_info`) for every device, and no test notices.
- **Fix (verified in the copy):** in the loop, `const k = koiosOf([], [launch()])`, then `await found.look("preprod")`, and `expect(k.calls).toEqual([])` beside the `known` check. It passes on the merged code and fails with `:471` deleted.

## Each fix, taken back out in the copy

All caught unless marked. The test named is the one that failed.

| Lane / finding | Mutation | Failed |
|---|---|---|
| pools x-merge#0 | copy check without `lastListed` (`lovejoin-launch.ts:251`) | merged-review "is refused as a copy…" |
| pools x-merge#0 | `lists.set` never called | discovery "holds the data layer's last list…", merged-review copy test |
| pools pr336#0 | HEAD's `confirmed()` (the list's rows, and the list's pool kept) | discovery "keeps a new pool as Koios's chain data has it…" (+3) |
| pools pr336#0 | Koios's rows read, the list's FoundPool kept | same |
| pools pr336#0 | Koios's reference row, the list's script places | same |
| pools pr336#0 | the `payment_cred === HOLDER` filter dropped | **survived, equivalent**: core's `candidate()` refuses `NotAtHolder` and `pool_of` reads scripts only at the holder (`seedelf-core/src/lovejoin/pool.rs:332`, `:447`), so a non-holder row can't make a pool either way |
| pools pr336#1 | `refresh()` awaits the check | discovery "holds no pool read while Koios checks…" |
| pools pr336#2 | no `keep(network, [])` before the check | discovery "asks for the list and Koios once…" (+3) |
| pools pr336#2 | no one-check-at-a-time guard | same |
| pools pr336#4, x-mut-ts#0 | `confirm()` doesn't call `wallet.trapped` | discovery "locks the wallet when WebAssembly traps under the check…" |
| pools pr336#4, x-mut-ts#0 | `confirmed()` swallows a trap | same |
| pools (design) | `look()` doesn't wait for the check | 11 discovery, 1 merged-review, 1 review-fixes |
| pools (1.6.0 guard) | `serially` removed | discovery "keeps what a refresh and a look found at the same time…", 3 of 3 runs |
| tail pr337#0 | `view()` without the `cut` rule | planner "holds nothing once the rest came back directly…" |
| tail pr337#3, x-scen#0 | HEAD's `skipCollateralMix` | planner "never loses a press…" |
| tail x-mut-ts#7 | the press's pump swallows a trap | planner "hands on a trap under the press's pump…" |
| tail pr337#2 | the press doesn't step | planner "brings a mix's rest back directly…" (+1) |
| tail pr337#2 (M2) | `tailHeld` without `tailBuildable` | planner "offers the way out once a lock cut the chain…" (+2) |
| tail x-mut-ts#1 | `one()` drops `tailHeld` | same |
| tail x-mut-ts#2 | waits-or-buildable check deleted; landed check deleted; both closed guards dropped | planner "holds nothing once its mix was sent…" (each) |
| tail x-priv#3 etc. | en wayOut back to HEAD's | planner "says the collateral's mix hasn't gone…", collateral-held "names no cause…" |
| tail x-priv#3 etc. | es back to HEAD's; ja back to HEAD's | collateral-held "names no cause…" (each) |
| tail x-ui#3 | en's U+00A0 before ₳ back to U+0020 | same |
| tail x-scen#1 | `lj.tail.skipped` back to HEAD's | planner "says the user chose not to wait…" |
| tail pr337#1 | SiteSessions opens no review; Swaps opens no review | wiring "on a site's session…"; "on a swap brought back by hand…" |
| tail pr337#1 | `reviewAfterSkip` ignores `auto` | wiring "on a swap that runs itself…", collateral-held "never where it runs itself…" |
| tail pr337#1 | `reviewAfterSkip` without the page's reading | collateral-held "opens on a site's session…" |
| tail x-ui#2 | MixCard as HEAD's; its class alone; its render deleted | collateral-held "adds nothing before the hour…" / "offers it from the hour…", wiring "on a mix's card…" |
| tail x-mut-ts#3 | either Swaps render deleted alone; SiteSessions' render fed nothing | the matching wiring test (each) |
| tail x-mut-ts#3 | the Lovejoin page's `onSkipCollateral` hand-off dropped | **survives Vitest**; tsc's `noUnusedLocals` refuses it (TS6133), and CI runs tsc |
| stepper pr335#0 | no clamp; functional arrows; no `key` | wiring "never stands past its last part…", "steps back from there…", "opens a review built again…" |
| stepper pr335#3, x-mut-ts#6 | the view not tied to its hash | wiring "asks for the next as it steps…" |
| stepper pr335#2, x-mut-ts#5 | `parts` dropped from Transfer, Withdraw, DappApprovals, Swaps; Lovejoin given `parts.slice(1)` | the matching "handed on by each review in parts" case (each) |
| traps x-merge#1 | `runAll` swallows traps (both loops; pump's alone; settle's alone) | session-trap 1 and 3; 1; 3 |
| traps x-merge#1 | `pump` records before rethrowing | session-trap 1 and 2 |
| traps pr330#0 | `hexOf` swallows; `recoveredRecords`' read swallows; `liveOrders`' read swallows; `unawaited` doesn't lock | restore-scan cip30Address + end-to-end; readDexOrder; splash-remnant; end-to-end |
| bootstrap x-mut-ts#4 | the handler answers `{ most }` alone | lovejoin-flows "caps a Bootstrap…" |
| bootstrap pr333#1 | the page doesn't store `back` | wiring "holds the Bootstrap form… to the way back's reserve…" |
| rust x-overflow#0 | eval.rs back to `+=`; or `wrapping_add` | eval_test and orders_test reference-row tests (panic at `eval.rs:152`; wrong outcome) |
| rust (sweep) | each of `apart`'s three sums back to u64, one at a time | apart_test (panics at `accum.rs:206`, `build.rs:2681`, `accum.rs:206`) |
| rust (sweep) | orders.rs cancel back to HEAD's | orders_test "an order reported near…" (panic `orders.rs:904`) |
| rust (sweep) | `withdraw_with` back to HEAD's | lovejoin_pools_test "a private payer holding more ADA…" (panic `mod.rs:1394`) |
| rust pr332#1, x-mut-rs#2 | core's override deleted; set to `false` | wasm_profile_test |
| bootstrap x-mut-rs#0 | `bootstrap_most` returns what's asked | lovejoin_pools_test "the most a private Bootstrap puts in…" |
| bootstrap x-mut-rs#1 | the reserve on fixed fees | both Bootstrap tests in lovejoin_pools_test |
| ci (all seven) | re-run of the lane's harness | 78/78 fixed; HEAD 62/16 |
| review of the fixes, worker#0 (21:23) | `claimSubmit` lists a trap as one failed return again | session-trap "ends Bring everything back's Send with a trap…" |
| review of the fixes, worker#1 (21:24) | `pumpPublicNow` records before rethrowing a trap | session-trap "locks it when a mix from the public account traps…" |

Two ran outside the table:
- `wasm/tests/lovejoin-reserve.test.mjs` (x-mut-rs#3) passes on today's `wasm/pkg`.
- `wasm/tests/lovejoin-pools.test.mjs`'s new x-overflow#0 test fails on today's `pkg` with `RuntimeError: unreachable`, as the rust lane said. `pkg` is from 15:57, before the Rust fixes. The lead's rebuild must turn it green before the commit.

## Existing assertions: did any lane weaken one?

Every removed or changed assertion line in the round's test diff:

- **`e2e/extension.spec.ts:2666-2677`:** reordered, not weakened. "Pays" and Next's disabled state now follow the second part's read (`withdraw-tx-loading` count 0). Not run here. The lead runs it.
- **`lovejoin-discovery.test.ts`:** `toEqual(["tx_info"])` became `["utxo_info", "tx_info"]` twice, which is stronger. The `refresh()`→`look()` changes keep each test's meaning, except as in F2 and F3.
- **`lovejoin_pools_test.rs`:** LJTEST's dear-byte `bootstrap_most == 64` and its build were replaced (pr333#4). The old assertion built boxes the ledger refuses at 6,465. The new one pins LJTEST as `BelowMinimum` there, and a 4.5 ₳ token pool's cap and build. Not weaker.
- **wasm `lovejoin_test.rs` and `lovejoin_flows_test.rs`:** now fund `bootstrap_back_reserve(params)`. At the fixture that's the same 1.5 ₳, so nothing new is caught there. Core's tests catch a mispriced reserve.

## The original findings this lens covers, on the merged tree

**Fixed, each by a test that fails without its fix:**
- pr333#1, x-mut-ts#4, x-mut-rs#0, x-mut-rs#1, x-mut-rs#3 (its node test passes on today's `pkg`; the binding itself can't be mutated without a WebAssembly build, which the brief forbids), x-mut-rs#4, pr333#4.
- pr336#4, x-mut-ts#0.
- pr332#1, x-mut-rs#2.
- pr335#2, x-mut-ts#5, x-mut-ts#6.
- pr337#2, x-scen#6, x-mut-ts#1, x-mut-ts#2, x-mut-ts#3, x-mut-ts#7.
- pr330#0.

**Still open, as their lanes reported:**
- x-rel#6: no e2e reaches #336's check.
- x-rel#4: the way out has never run against a chain.
- These are the lead's to run or record.

## Already reported, not new, still true on the merged tree

- **`tests/lovejoin-1-5-0.test.ts` fails on this tree:** "plans every return and mix as 1.5.0 did…": `mainnet 1: expected 'dc6abe3b…' to be undefined`. The cause is the release prep's `src/lovejoin-pools.json`, which bundles mainnet's 5 ₳ pool. `e2e/extension.spec.ts:3204`'s "Mainnet bundles none" is stale for the same reason (x-rel#3). CI's Vitest and e2e go red until the release prep updates both.
- **`claimSubmit`:** the traps lane's gap is closed in `W` since 21:23 (worker#0, `sessions.ts:3211`), and its new test fails without it.
  - At 21:27, `docs/post-release-roadmap.md:390` still says "Left: Bring everything back's send (`claimSubmit`) lists a trap as one return that failed and sends the next on the broken module…". That's no longer true.
  - The docs-roadmap lane's report said to drop that sentence if the rethrow went in.

## Scratch

- **Runners:** `scratchpad/fix/rt/mut.py`, `scratchpad/fix/rt/mut-rs.py`, `scratchpad/fix/rt/muts-ts*.py`, `scratchpad/fix/rt/muts-ts*.json`.
- **Outputs:** `scratchpad/fix/rt/muts-ts.out`, `muts-ts2.out`, `muts-rs.out`, `wasm-native.out`, and the per-run JSON in `scratchpad/fix/rt/out/`.
- **Copies:** `scratchpad/fix/mut/rt/` (the merged tree) and `scratchpad/fix/mut/rt-head/` (HEAD's web wallet).
- All paths are under `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/`.
