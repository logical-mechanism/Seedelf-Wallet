# v-pr336-6-trace: verifying pr336#6

**Finding:** the privacy policy's summary lines still say Koios is asked on mainnet only for "anything our server can't answer". Since #336, Koios is also asked while our server answers, to confirm a new Lovejoin pool our server lists.

**Verdict: confirmed. Severity: low.** Tree `6bca8bec`.

## The code path on HEAD

- **The worker's client.** `sw.ts:181` sets `const koios = chainClient(dataDeps)`. On mainnet that is a `DataLayerKoios`. Its `koiosAlone()` (`data-layer.ts:223-225`) returns `alone`, a plain `Koios` at `NETWORKS[network].koios` (`data-layer.ts:214`). On mainnet that is `https://api.koios.rest/api/v1` (`networks.ts:64`). `sw.ts:236` hands this `koios`, and the data layer's `index`, to `PoolDiscovery`.
- **The pool read.** Every pool read goes `readSet` (`lovejoin.ts:2711`) → `serviceDeps.pools` → `discovery.refresh` (`lovejoin-pools.ts:598`). While our server answers, `refresh` ends at `lovejoin-pools.ts:454`: `await this.keep(network, await this.confirmed(network, found));`.
- **The confirmation.** `confirmed()` (`lovejoin-pools.ts:565-584`) takes any listed pool the device doesn't hold yet. For those it calls `this.deps.koios(network).koiosAlone()` and then `launched()`, which sends:
  - `tx_info` (`koios.ts:926-946`);
  - `account_update_history`, where the launch didn't register L (`koios.ts:954-966`).
- **Pinned to Koios.** `DataLayerKoios` sends both of those calls to Koios whatever the data layer is doing (`data-layer.ts:287-295`).
- **A deliberate check.** The doc comment says so: "Koios rather than the data layer, which listed it: the check is one no single operator answers" (`lovejoin-pools.ts:562-563`). This is a cross-check made while our server is up and answering. It is not the fallback.

## What the policy says

| Line | Text |
|---|---|
| `:5` (In short) | "on mainnet for anything our server can't answer, or for everything if you turn our server off in Settings" |
| `:7` | "on mainnet ours, and Koios for anything ours can't answer, or for everything if you turn ours off" |
| `:40` (the Koios bullet) | "on mainnet whatever ours can't answer, or everything with that switch on" |

The policy's own meaning of "can't answer" is a fallback:

- `:39`: "Whatever part it can't answer, the wallet asks Koios instead, for five minutes, then ours again."
- `privacy.md:113` says "can't answer" covers two cases: a part that's down (a 5-minute hold), or a request too large for our server.

The confirmation is neither of these. `:46`, the 28 October entry (`:93`) and the Effective line do describe it.

## Scratch test

`extension/tests/zz-review-v-pr336-6-trace-1.test.ts`, deleted after the run.

- **Wiring.** It builds discovery the way `sw.ts` does: `chainClient` plus `privateIndexClient`, sharing one fetch that records every request. The data layer is at a fake origin, and Koios-only is off.
- **Why preprod.** The bundled mainnet head start has no pools, and the preprod fixture pool doesn't verify as a mainnet pool. Nothing from `refresh()` to `koiosAlone()` branches on the network, so the test runs on preprod with the data origin forced. The only network-specific part is `NETWORKS[n].koios`.
- **Guard.** Test 1 also checks that the pool was kept, so it can't pass by skipping the path. It did skip the path on the first try, on mainnet.

**On HEAD:**

| Test | What it asserts | Result |
|---|---|---|
| 1 | What the summary promises: a pool read our server answers asks Koios nothing | **Fails, as expected if the finding is real.** Our server answered `lovejoin/pools`, and both its parts stayed up. Requests made: `['https://data.test pools', 'https://preprod.koios.rest tx_info']` |
| 2 | Koios is asked only for a pool new to the device; once it's kept, the next list asks Koios nothing | Passes |
| 3 | A pool Koios can't confirm yet is asked about again at every list, every `REFRESH_MS` | Passes |
| 4 | With Koios-only on, our server isn't asked | Passes |

**Mutation check** (in a copy under the scratchpad, since deleted): with line 454 put back to `await this.keep(network, found)`, as before #336, test 1 passes. Only tests 2 and 3 fail. So before #336, a pool read our server answered asked Koios nothing, and #336 added this contact.

## Nuances (none of them refutes the finding)

- **Copies, since 1.6.0.** `:44` (commit `030fdcf0`) already says Koios is asked "even while ours answers" in one case. That case is what made a box in a copy, "which ours doesn't cover" (`lovejoin.ts:5602-5603`, where `covered()` is false). The summary lines were never changed for it, so "can't answer" already took in "ours doesn't cover". #336's case is different in kind: our server lists that pool and covers it, and Koios is asked to check our server's own answer.
- **The literal defence.** Our server's `tx_info` answers only the wallet's two other shapes, and refuses a query string (`seedelf-data/api/src/public/tx.rs:29-30, 312-314`). So it would refuse the launch request as it's sent. That's a side effect of sending the request to Koios on purpose. Our server has the data: it lists each launch's transaction, block and position. `:46` and `:93` also present the request as a check of our server. A reader can't see request shapes.
- **Reach.** Pool reads come from Lovejoin use: the Lovejoin page, mixes, returns, which go through Lovejoin by default, a swap's review, and the alarm's box returns. Each device asks Koios:
  - once for each pool new to it;
  - again at every list while Koios can't confirm a pool (test 3);
  - after Remove wallet and a restore, about every token pool our server lists, because the bundled mainnet head start holds none (`src/lovejoin-pools.json`: 0 mainnet pools).
- **`:7` is the weakest of the three.** It defines the term "the Cardano server", and `:46` names Koios outright for this request. The clear gaps are `:5` and `:40`.
- **The design doc.** `privacy.md:22` uses the same summary wording.
- **Why low.** The same document discloses it in full (`:46`, `:93`, the Effective line). The request is the same for every wallet and names nothing of the user's. What Koios learns from the IP address is that it uses Lovejoin. It's a summary that now leaves one case out, not a contact the policy hides.

## Fix (docs only)

- **`:40`:** "…and on mainnet whatever ours can't answer, and a Lovejoin pool ours lists that this device hasn't seen, to confirm it, or everything with that switch on."
- **`:5`:** "…and on mainnet for anything our server can't answer, and to confirm a new Lovejoin pool it lists, or for everything if…"
- **`:7`:** can stay as a definition.
- **`privacy.md:22`:** could get the same words.
- **Copies' case:** whether the summary should also name it ("a later pool ours doesn't list") is the owner's call.
- **No new Changes entry is needed.** The 28 October entry already covers the change, and this is wording.
