# v-x-rel-6-trace: x-rel#6, the skeptic's trace

**Finding:** "#336's check runs only on mainnet with the data layer up, so no preprod run or e2e reaches it before mainnet's first new pool" (low, tests).

**Verdict: partly. Severity: nit.** Confidence: high.

The coverage statement is literally true, but the gap is much narrower than "has run only in unit tests over fakes" suggests. The scenario needs a defect in #336's glue that nothing catches before mainnet. I found none on HEAD:
- The glue's logic: the existing unit tests, with the real WebAssembly, catch a defect there (mutation A breaks 9 of them).
- The worker's own mainnet wiring: a scratch test over the same fakes passes on HEAD.
- Routing the check to Koios: guarded twice (tsc, and `DataLayerKoios`).

The proposed e2e uses the same fakes, so it couldn't catch the one risk that's left (the real servers' answers). It would add only the hub's rendering, and the hub renders a pool the same way whichever path found it.

## What's true (checked on HEAD 6bca8bec)

- **`confirmed()` sits only on the data layer's path.**
  - Its only caller is `lovejoin-pools.ts:454`, `await this.keep(network, await this.confirmed(network, found));`, inside `refresh()`, after `index.pools()` answered.
- **Preprod never takes it.**
  - `networks.ts:153-158` `dataOrigin()` returns undefined when `NETWORKS[network].data` is undefined, which it is for preprod, even with a VITE_DATA_ORIGIN override.
  - Then `refresh()` returns at `:419-420` (`if (!index) return;`), and `look()` goes to `scan()`, the holder path.
- **The e2e lists no token pool.**
  - `tests/fake-index.ts:89` answers `pools: []` unless `poolList` is set.
  - `e2e/data-layer.ts` never sets it, and no `e2e/` file does (grep `poolList`).
  - `e2e/data-layer.spec.ts` never opens the Lovejoin hub.
  - PR #336's own text says: "No e2e test lists a token pool through the data layer."
- **Mainnet's head start holds no pool.**
  - `src/lovejoin-pools.json` has mainnet `height 14110720`, 0 pools (written 2026-10-25, 8cd8ce08).
  - "The live server lists none" was not checked: the brief forbids touching mainnet.
- **The failure mode is closed.**
  - A Koios error is caught at `:578-581` (`standard = []`, traps rethrown), and `:583` keeps only `known` or confirmed pools.

## Where it's narrower

1. **The glue is unit-tested with the real WebAssembly, the real clients and a real chain pool.**
   - `tests/lovejoin-discovery.test.ts:270-422` takes PR #163's preprod pool (`wasm/tests/fixtures/lovejoin-token-pool-preprod.json`) and serves it as `lovejoin/pools` serialises it (`indexRowOf` plus `script`/`script_hash`).
   - That shape matches the server's `seedelf-data/api/src/lovejoin/routes.rs:62-81` and `row.rs:45-69` field for field.
   - It runs through the real `privateIndexClient` and `DataParts`, the real `Koios` class, and `loadTestWasm()`.
   - It covers:
     - confirm and keep with one `tx_info`;
     - an unknown launch, kept later once Koios knows it;
     - L registered after the launch (refused) and by an earlier block (kept);
     - Koios down: nothing new kept, nothing kept lost.
   - **Mutation A** (copy only): with `scripts: []` in `confirmed()`'s candidates, 9 tests in `lovejoin-discovery.test.ts` fail, and so does my scratch test. A logic defect in the glue fails CI long before mainnet's first pool.
2. **The WebAssembly half adds nothing new about the data layer's rows.**
   - `wasm/src/lovejoin.rs:705-737` `launch_check` is `candidate()` + `find_seed` (over Koios's inputs) + `protocol_of`.
   - `verify_pool`, which 1.6.0's path already runs on the same rows at `lovejoin-pools.ts:450`, is `candidate()` + `protocol_of` too (`seedelf-core/src/lovejoin/pool.rs:326-372`).
   - Core tests the mainnet flag: `lovejoin_pools_test.rs:1280-1311` verifies a token pool with `verify_pool(false, …)`.
3. **The Koios half is the holder path's `launched()`, run against the real Koios.**
   - #336 moved it out of `holder()` so that both paths share it.
   - `npm run lovejoin-pools` (`tests/lovejoin-pools-head-start.test.ts:56-79`) runs "the very look the wallet makes … against the real Koios" from height 0 at each release. That run found preprod's three holder launches.
   - The `LIVE_KOIOS` case (`:79-111`) checks `launches()` and `firstRegistrations()` against the real preprod Koios.
4. **The routing to Koios is guarded twice.**
   - `DiscoveryDeps.koios` is typed `Pick<Koios, "koiosAlone">` (`lovejoin-pools.ts:235`).
     - **Mutation D** (drop `.koiosAlone()` in `confirmed()`): `tsc` fails, `lovejoin-pools.ts(575,9): error TS2740`.
   - `DataLayerKoios.launches` and `firstRegistrations` go to Koios alone whatever `koiosAlone()` returns (`data-layer.ts:287-295`).
     - **Mutation C** (`koiosAlone()` returns `this`): the check still reaches only `api.koios.rest`.
     - `lovejoin-index.test.ts` "asks Koios alone, never the data layer…" fails on it anyway.
5. **The mainnet wiring works.**
   - Scratch test `extension/tests/zz-review-v-x-rel-6-trace-1.test.ts` (deleted; a copy is kept at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-x-rel-6-trace/zz-review-v-x-rel-6-trace-1.test.ts.kept`).
   - It wires discovery exactly as sw.ts:178-182 and :236 do: `chainClient(dataDeps)`, `privateIndexClient(dataDeps)`, then `new PoolDiscovery({ local, wasm, koios, index, now })`, with the bundled head start, on **mainnet**.
   - The pool: preprod's real 5 ₳ ADA pool from the head start (launched at the holder, block 5308081), its rows moved to the holder's mainnet address (`addr1w…`). L is `stake1…`.
   - One fetch routes by host, as the e2e's `context.route` would.
   - What it asserts:
     - `serviceDeps(discovery).pools("mainnet")` hands the pool over.
     - Exactly one request reaches `api.koios.rest`, `/api/v1/tx_info`, and the data layer gets only `/seedelf/v1/mainnet/lovejoin/pools`.
     - The handed ref verifies on mainnet (`lovejoinVerifyPool`, as `readSet` does).
     - The hub's facts (launch, crowd) are there.
     - `look()` (the hub opening) asks nothing.
     - After REFRESH_MS the list is asked again, and Koios isn't.
     - Negative control: no launch at Koios means nothing kept, and one `tx_info` per list.
   - **Result on HEAD: 3/3 pass.** Under mutation A it fails.

## The scenario's specifics

- **"1.7.0 wallets never show it while 1.6.0 wallets do."** This needs a defect in what #336 added. #336 adds no new handling of the data layer's rows (point 2), and its Koios requests are the holder path's (point 3).
  - A real-server mismatch in the list's shape would break 1.6.0 too.
  - "Never" is too strong even then. With Koios-only on, or the token routes down (`TokensDown`, `:425-429`, no `answered`), `look()` (`:391-397`) takes the holder path, and that path's `launched()` finds the pool.
- **"Asks Koios again every five minutes."** It does, as the negative control shows, but at most every REFRESH_MS and only at a non-quiet pool read (`lovejoin.ts:2709-2711`).
  - That's one `tx_info`, plus one `account_update_history` only where the launch didn't register L.
  - It is the same while Koios merely lags a launch.
- **The head start.** `npm run lovejoin-pools` rewrites it at packaging. A mainnet pool launched before that is bundled, counts as `known` in `confirmed()`, and is never asked about. Only pools launched after packaging go through the check, as the finding says.

## What's left, and the advice

- **Left:** only the real servers' answers to this one combination are untried: the data layer's rows of a real mainnet pool, fed to `launched()` beside Koios's mainnet `tx_info`. No e2e over `fake-index.ts` and `support.ts`'s Koios fake can try them.
- **No e2e is needed.** The proposed one would add the hub's rendering, which reads `known()` the same whatever path found a pool. It would also add the bundle's Chrome fetch, which `e2e/data-layer.spec.ts` already covers for mainnet reads.
- **The narrower real gap:** every data-layer case in `lovejoin-discovery.test.ts` runs on `"preprod"`, a network that never takes this path in production.
  - If the lead wants it, the cheap fix is to promote the scratch test's mainnet case into `lovejoin-discovery.test.ts`. It covers the mainnet flag, the `stake1` L, `utxoOf(…, "mainnet")` and the host.
  - Otherwise, add a one-line handoff note: `confirmed()` first meets the real servers at mainnet's first pool after packaging, and fails closed.

## Cleanup

- The scratch test is deleted from the tree.
- The mutation copy under `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-x-rel-6-trace/` is removed; only the `.kept` copy of the test stays.
- No tracked file was touched.
