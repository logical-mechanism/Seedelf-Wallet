# v-x-merge-0-trace: x-merge#0, traced on HEAD (6bca8bec)

**Verdict: confirmed. Severity: medium (money).** Confidence: high on the mechanism (a scratch test fails on HEAD and passes on the pre-#336 file), medium on how often it's reached.

The finding: a launch's copy refusal misses a pool the data layer lists but Koios hasn't confirmed (#336 × chunk 34's launch).

## The path, on HEAD

1. `LovejoinLaunchService.build` (lovejoin-launch.ts:243-248) is the only copy guard. It reads discovery alone:
   `await this.deps.discovery.look(network); const known = await this.deps.discovery.known(network); const copy = known.find(...); if (copy) throw new Error(t("lj.launch.copy"));`
2. `look()` → `refresh()` (lovejoin-pools.ts:391-455). `this.answered.set(network, at)` is at line 432, **before** `await this.keep(network, await this.confirmed(network, found))` at line 454. So `look()` returns at line 395 without the holder scan, whatever `confirmed()` kept.
3. `confirmed()` (lovejoin-pools.ts:565-584) asks `this.deps.koios(network).koiosAlone()`, which on mainnet is a plain Koios client:
   - data-layer.ts:223-225 `override koiosAlone(): Koios { return this.alone; }`
   - data-layer.ts:288-295: `launches` and `firstRegistrations` go to `super`, i.e. Koios, even on the data-layer client.
   - Koios throws: `catch (e) { if (isTrap(e)) throw e; standard = []; }` (578-581).
   - Koios doesn't know the launch: it lands in `unknown` (532-535).
   - Either way, line 583 keeps only pools already held.
4. Everything else the launch needs goes to the data layer first on mainnet: `epochParams` (349), `credentialUtxos` (244), `accountInfo` (297, Send's `choose`), `tipSlot` (361), `submitTx` (393). So a launch builds and sends with Koios fully unreachable.
5. The form's own pre-Review copy hint and its join list are not `terms().pools`. They are `poolsOf(status)` (Lovejoin.tsx:1846 → LovejoinLaunch.tsx:147-148), the hub's read through `serviceDeps(discovery).pools`, which is `refresh` and then `known()`. Same blind spot.
6. Remove wallet deletes `seedelf.lovejoinPools.mainnet` (wallet.ts:33-41, `LOCAL_CACHES`), so a restore starts from the head start. The mainnet head start bundles **0** token pools today (`src/lovejoin-pools.json`).
7. `lovejoin-launch.ts` and `LovejoinLaunch.tsx` didn't change in `babb8e76..6bca8bec`. `lovejoin-pools.ts` changed only in #336 (`f40ed2fc`). #336's description never mentions the launch's copy check.
8. Both existing copy-refusal tests stub discovery: lovejoin-flows.test.ts:742 and lovejoin-merged-review.test.ts:406 use `discovery: { known: async () => … }`. No test runs the refusal through a real `PoolDiscovery`, which is why #336's CI passed.

## Repro: `extension/tests/zz-review-v-x-merge-0-trace-1.test.ts` (deleted after the run)

The test wires a real `PoolDiscovery` as sw.ts does: the fake data layer lists PR #163's token pool P, and the real WebAssembly verifies it. Koios, for the launch check, is in one of three states:
- **confirms:** `txRows` holds the launch.
- **unknown:** no `tx_info` row for the launch.
- **down:** a client answering 503.

Each run makes the hub's read, then `look`, then `terms()`, moves on five minutes, then calls `build()` for P's values, from the public account with 40 ₳ plus 5 ₳.

**HEAD: 2 failed**, exactly as the finding predicts.

| Koios | hub lists | `terms().pools` | Review | `known()` | holder asked | `tx_info` asked |
|---|---|---|---|---|---|---|
| confirms | P | P | `lj.launch.copy` | P | 0 | 1 |
| unknown | none | none | passes the copy check, stops at `lj.launch.tooLittle` | none | 0 | 2 |
| down | none | none | passes the copy check, stops at `lj.launch.tooLittle` | none | 0 | 0 on the fake (503 client) |

The fixture's 2 ₳ box is under today's least of 3.88 ₳, so the real-fixture run stops at `tooLittle` *after* the copy check.

The second test re-values P's view, in discovery's WebAssembly only, to MIN at 1,000 a box and 4.5 ₳:
- **confirms:** Review refuses with `lj.launch.copy`.
- **down:** `build` succeeds and `submit` sends: `{ kind: "lovejoin-launch", submitted: 1, locked: "23106070", pool: "bbc4e4b6…" }`. That is a new pool beside P's `c5852bb7…`, with 23.1 ₳ locked, matching `lovejoin.launch.warn.cost` ("About 23 ₳ never comes back").

**Mutation check, pre-#336:** a copy outside the tree (scratchpad `review/v-x-merge-0-trace/`), with `src/background/lovejoin-pools.ts` replaced by `git show babb8e76:…`. The diff vs HEAD is `await this.keep(network, found);` at 454, plus no `launched`/`confirmed`. Result: **2 passed**. In all three Koios states the hub lists P, `terms()` lists P, and Review refuses with `lj.launch.copy`, with no `tx_info` asked. So #336 is what opened it.

## What is narrower or different from the finding's text

- **The form's join list comes from the hub, not `terms()`.** `terms().pools` is built from `known()`, as claimed, but no screen reads it (no use in src/ui). The form's join list and copy hint are the hub's `poolsOf(status)`, which is just as blind, so "the form offers no pool to join" holds.
- **"At the suggested Q":** the form suggests the box's ADA (`terms.suggested`, in 0.5 ₳ steps), not Q, which the creator types. A collision needs the same Q, then the same suggested box value. That's plausible at round Qs, as the suggestion is a function of the parameters, the token and Q.
- **"Koios hasn't indexed the launch yet"** needs Koios more than about 200 slots behind, as the data layer lists from 200 slots back. That's rare. The common states are:
  - Koios down.
  - Koios's 429. Its public tier caps 100 requests every 10 s and 5,000 a day per IP, so it's shared behind a VPN.
  - A state the finding doesn't name, which makes the gap **persistent, not transient:** the user limited the wallet's site access in Chrome. The `alone` client keeps the default `chromeAllows` check (koios.ts:769, 1174, 1350, `KOIOS_NOT_ALLOWED`), while the data layer's client needs no grant (data-layer.ts:91, 213). Such a device keeps no new data-layer pool, ever.
- **Line drift:** the `keep(confirmed(...))` call is at lovejoin-pools.ts:454, not 450. The catch is at 578-581, and the return filter at 583.

## Severity

**Medium.** The money is real and irreversible: about 23 ₳ for a pool no wallet shows or reads. The data layer never lists a later launch of P's values, and `shown()` always picks P. But the user must meet a conjunction:
- Koios failing while the data layer answers.
- A device without P: a new install, a restore, or P listed since Koios began failing for it.
- P launched after the bundled head start.
- A launch of exactly P's values.

It's an owner-designed refusal (session 1, 11 and 14) silently weakened, not a new gap in the design.

## Fix advice (corrections to the proposed fix)

- **Widen only the copy refusal's input. Never the join list, the hub's read set or `known()`.**
  - In `refresh()`, keep the last answered list's offline-verified pools that `confirmed()` didn't take in memory, per network. Replace it at each answered refresh, and clear it where `crowds` is cleared (no index, `IndexDown`), so Koios-only is a way out of a false refusal.
  - Have `build()` refuse on `known` plus that list.
  - Optionally give the form those values in a separate field of `terms()`, so its `why` says it before Review.
- **The finding's "`terms()`' join list read it as well" is wrong.** No screen reads `terms().pools`. And offering an unconfirmed pool to *join* (the hub's list) would undo #336: it means depositing into a pool whose L may be unregistered or whose launch may not be on chain (pool-exists, docs-small#1).
- **Refuse or warn is the owner's call**, between two precedents:
  - Restoring the refusal from that list is the pre-#336 behaviour of an existing guard.
  - 318-worker#1 says the wallet's own start of the same values that no look found yet is "said on the review, never refused, as the chain takes both" (lovejoin-launch.ts:15-20, 286-291). A review warning for a pool the wallet can't confirm, beside `LaunchStartedBefore`, follows that.

  Either closes the silent loss. A "try again later" refusal while Koios is down would be a new refusal, also the owner's call.
- **Regression test:** the scratch test above, with a real `PoolDiscovery`, the data layer listing P, and Koios 503 or not knowing the launch. On HEAD it fails, and on babb8e76's `lovejoin-pools.ts` it passes.

## Commands run

- HEAD: `cd extension && npx vitest run tests/zz-review-v-x-merge-0-trace-1.test.ts` → 2 failed (the outcomes above).
- Pre-#336 copy: the same command with `--silent=false --reporter=verbose` → 2 passed.

## Cleanup

- `extension/tests/zz-review-v-x-merge-0-trace-1.test.ts` is deleted.
- The mutation copy under the scratchpad's `review/v-x-merge-0-trace/` is deleted. Its `node_modules`, `seedelf-core` and `seedelf-crypto` were symlinks back to the tree, used read-only.
- No tracked file was touched.
