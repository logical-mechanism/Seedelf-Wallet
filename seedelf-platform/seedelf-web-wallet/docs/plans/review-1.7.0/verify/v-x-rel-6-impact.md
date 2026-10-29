# v-x-rel-6-impact: x-rel#6 (x-rel's F7), impact and fix

**Finding:** #336's check runs only on mainnet with the data layer up, so no preprod run or e2e test reaches it before mainnet's first new pool (low, tests).

**Verdict: partly. Severity: low.** The gap is real, and slightly wider than stated: no unit test runs `confirmed()` on mainnet either. But the risk behind it doesn't hold up. I ran the path on mainnet, wired as `sw.ts` wires it, and it works. The proposed e2e test is heavier than needed, and its fixture recipe needs two corrections. A short unit test closes the gap.

## What holds

- **Only one configuration reaches `confirmed()`:** mainnet, with the data layer up and Koios-only off.
  - `lovejoin-pools.ts:419-420`: `const index = await this.deps.index?.(network); if (!index) return;`
  - `private-index.ts:368`: `if (!at || (await deps.koiosOnly()) || !(await deps.parts.up("private"))) return undefined;`
  - `networks.ts:153-158`: `dataOrigin()` is undefined for preprod.
- **No e2e test lists a token pool.** `e2e/data-layer.ts` never sets `poolList`, and the fake then answers `pools: []` (`tests/fake-index.ts:89`).
- **Nothing on mainnet lists a pool yet.** The bundled head start has 0 mainnet pools, read to height 14110720.
- **Sharper than the finding:** every unit test that reaches `confirmed()` calls `refresh("preprod")` or `look("preprod")` with a data layer. Production never runs that configuration. No test in `tests/` runs discovery's data-layer path with `"mainnet"`. The one mainnet list (`lovejoin-screens-review.test.ts:461`) has `pools: []`, and its Koios is `() => undefined`.
- **It fails closed.** On any Koios error, `confirmed()` keeps only pools the device already holds (`:578-583`). No money, no privacy and no kept pool is at stake.

## What doesn't hold

- **"Only unit tests over fakes" undersells the coverage.** Those tests fake only `fetch`. They run:
  - the real `Koios` client (`lovejoin-discovery.test.ts:91`);
  - the real `privateIndexClient` (`:247`);
  - the real WebAssembly (`:45`).
  The pr336 report says the request shapes match recorded live Koios answers.
- **The premise is a glue defect that only mainnet would show.** The only mainnet-specific inputs are the network flag and the hosts:
  - `at_holder(&output.address, network_flag)` (`seedelf-core/src/lovejoin/pool.rs:331`);
  - L's reward-address header (`wasm/src/lovejoin.rs:730`, `0xf1` on mainnet);
  - `api.koios.rest` through `DataLayerKoios.koiosAlone()` (`data-layer.ts:223`).
  The scratch test below runs all three, and they work.

## Scratch test

The file was `extension/tests/zz-review-v-x-rel-6-impact-1.test.ts`, deleted from the tree. A copy is at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-x-rel-6-impact/zz-review-v-x-rel-6-impact-1.test.ts.txt`.

**The wiring is `sw.ts:180-183` and `:236`:** one `DataDeps` shared by `chainClient(dataDeps, origin)` and `privateIndexClient(dataDeps, origin)`, then `new PoolDiscovery({ local, wasm, koios, index, now })`. There's no `headStart`, so the bundled mainnet head start applies. The pool's rows are PR #163's fixture pool, with each address set to the mainnet holder (`addr1…`, `71‖HOLDER`). All 11 cases pass on HEAD.

| # | Case | Result |
|---|---|---|
| 1 | Sanity checks | The mainnet holder is `71‖HOLDER`. L's mainnet address is `stake17…`, which decodes to `f1‖MIX_LOGIC`: the CIP-19 script reward address that Koios lists. |
| 2 | A listed pool, `look("mainnet")` | Kept. Requests: `["data.test/seedelf/v1/mainnet/lovejoin/pools","api.koios.rest/api/v1/tx_info"]`. `serviceDeps(d).pools("mainnet")` hands it over. |
| 3 | A launch whose L was registered in an earlier block | `tx_info` then `account_update_history`, both at `api.koios.rest`. Kept. |
| 4 | A launch Koios doesn't know | Never kept. Three lists over 3 × `REFRESH_MS` sent three `tx_info`, one per 5 minutes and only at a pool read. Reads within the 5 minutes ask nothing. |
| 5 | Control: the same list with preprod's addresses | Refused on mainnet before any Koios request (requests: `lovejoin/pools` only). So case 2 passes because of the mainnet re-tag. |
| 6 | The finding's recipe, with the real mainnet token list (no `listed` override) | Kept with token policy `29d222ce…`. The setup: preprod's MIN pool (`src/lovejoin-pools.json`), its datum's policy bytes changed from `e16c2dc8…` to mainnet MIN's `29d222ce…`, and its addresses moved to the mainnet holder. A re-tag of display units alone leaves the datum's preprod policy, which mainnet's list refuses. |
| 7–10 | Side effects (below) | Measured. |
| 11 | Koios-only on mainnet | `privateIndexClient` returns undefined, so `confirmed()` never runs. |

**Mutation check.** In a copy outside the tree, I changed `:454` to `await this.keep(network, found);`, which is 1.6.0's unchecked list. Five of 11 cases then fail, including 2 (no Koios request), 3 and 4 (the unconfirmed pool is kept). So the test I recommend fails without the fix.

## Impact

- **Can the scenario happen?**
  - It needs someone to launch a mainnet token pool. None has been launched yet.
  - It also needs the glue to be broken, and case 2 shows that it works.
  - Two things are still unexercised before mainnet's first pool:
    - Chrome's fetch from the worker to `api.koios.rest`. It's a declared host (x-rel's notes), and every mainnet Koios fallback uses it, which e2e:data covers.
    - The hub showing a token pool on mainnet. That's 1.6.0's code, and preprod's e2e covers it with the head start's MIN pool.
- **If it were broken anyway:**
  - 1.7.0 wallets wouldn't show the new pool while the data layer answers, because `look()` returns before `scan()` (`:392-396`).
  - The user who started the pool wouldn't see it either. A launch learns of its pool only through discovery (`lovejoin-launch.ts:243-244`).
  - No money would be lost, and no box would drop out of view, since a pool already handed over stays.
  - Koios's cost would be one `tx_info`, and rarely one `account_update_history`, per pool read, at most every 5 minutes. That's trivial against 40 requests every 10 s.
- **Severity: low** is right for a missing test on a minor path. Nothing points higher: the path fails closed and works when wired as the worker wires it. A lower rating would also be defensible.

## The fix

**The e2e:data case works, but it costs more than it adds, and its recipe as written would fail:**

1. **Re-tag the datum, not display units.** "As store-images re-tags tokens" changes display units. A pool's token lives in its reference datum (`inline_datum.bytes`).
   - Change the policy bytes from `e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72` to `29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6`. The name `4d494e` is the same, and so is the length.
   - Move the reference row and both script rows to the mainnet holder address.
   - The scripts derive from the seed alone (`templates.rs:120`, `pool.rs:373`), so the swapped datum still verifies (case 6).
   - The `tx_info` answer needs the seed among its inputs, and a `stake_registration` naming L's mainnet `stake17…` address.
2. **Count the right `tx_info`.** In e2e:data the public part answers 503, so Activity's own `tx_info` likely reaches the Koios fake too. "One `tx_info`" has to match on `_tx_hashes` containing the launch.
3. **The hub changes shape.** The mainnet hub becomes a grid once there's a second group (x-rel's F4: `Lovejoin.tsx:1995`), so the test has to open the token's tile.
4. **New e2e tests need the owner's stress run:** repeated under taskset 2-CPU load, on the dev and store builds, before CI.

What it would add over a unit test: Chrome's network stack and the hub's rendering. Both are 1.6.0's and covered elsewhere.

**Proposed instead: a unit test in `tests/lovejoin-discovery.test.ts`.** It's cases 2 and 4 of the scratch test, about 60 lines.
- `look("mainnet")` through `chainClient` and `privateIndexClient`, sharing one `DataDeps` as `sw.ts:180-183` does.
- The list's rows at the mainnet holder, and the bundled mainnet head start.
- Assert that the pool is kept and that the requests are exactly `lovejoin/pools` and one `tx_info` at `api.koios.rest`.
- The negative: a launch Koios doesn't know is never kept.
- Add case 5, the preprod-address control, so the test can't pass without the mainnet re-tag.

It's deterministic, runs in both Vitest builds, needs no stress run, and fails without `confirmed()`.

**Or accept the gap** and say so in the handoff note, as the finding offers. That's fine too. Either way, the release's `npm run lovejoin-pools` (x-rel's F4) is the first live run of the shared `launched()` against mainnet's real Koios, once a mainnet pool exists.

**Sequencing with pr336's F1.** F1 proposes reading the reference outpoint from Koios (`utxo_info`) and keeping Koios's row and position. That would change this glue's requests and which row is kept. So either write the test with F1's decision, or after it, or assert "kept, and every Koios request went to `api.koios.rest`" rather than an exact list. Under F1, the e2e recipe would also need the Koios fake to serve the re-tagged datum from `utxo_info`.

**The owner's rules:** this is a test only. It adds no guard, refusal or UI text, and changes no privacy behaviour.

## Side effects, already filed (pr336's F2 and F3)

I measured both independently. Neither is a new finding.
- **F2:** with a new pool listed, a pool read waited 421 ms on a Koios that took 400 ms. With Koios hanging, the bound is 45 s + 1 s + 45 s (`koios.ts:421`, `:429`).
- **F3:**
  - A read that starts 100 ms into the check, on a device with no record yet, sent 2 `lovejoin/pools` and 2 `tx_info`.
  - Three reads started together sent 1 and 1: the later two return before the data layer answers.
  - On a device with a record, 1 `tx_info`.

## Confidence

High. The scratch test runs the worker's wiring on mainnet with real components, and a control and a mutation check back it up.
