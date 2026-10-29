# v-pr336-1-trace: pr336#1, a pool read waits through Koios's retries while a newly listed pool is unconfirmed

**Verdict: confirmed. Severity: low (perf), as filed.** The mechanism, the timings and the pre-#336 baseline all hold on HEAD (`6bca8bec`). A scratch test fails on HEAD, and passes once the confirm is reverted in a copy. One part of the claim is worded too broadly, and the finding leaves out one impact. Both are covered under *Scope* below.

## The path on HEAD

- `lovejoin-pools.ts:597-601`: `serviceDeps(...).pools` runs `await discovery.refresh(network).catch(...)` before `handed(network)`. It is wired into the worker as is (`sw.ts:236`, `:246`), and `koios` there is `chainClient(dataDeps)` (`sw.ts:181`).
- `lovejoin-pools.ts:454`: `await this.keep(network, await this.confirmed(network, found));`. Before #336 this line was `await this.keep(network, found);`.
- `lovejoin-pools.ts:565-581`: `confirmed()` takes the listed pools the device doesn't hold yet (`fresh`). For those it calls `this.deps.koios(network).koiosAlone()`, then `launched()`, which runs `koios.launches()` (`tx_info`) and, for an L its launch didn't register, `firstRegistrations()` (`account_update_history`).
- `data-layer.ts:214`, `:223-225`: on mainnet `koiosAlone()` is `this.alone`, a plain `Koios` on `KOIOS_BACKEND` (`koios.ts:745`) with `KOIOS_LIMIT`. Its settings are `TIMEOUT_MS = 45_000` (`:429`) and `RETRY_DELAYS_MS = [1000, 3000]` (`:421`), with a single retry after a timeout (`:1373`). A 429 sets `hold()`, capped at `MAX_BACK_OFF_MS = 60_000` (`:498`, `:573-575`, `:1366-1368`).
- Before #336, `refresh()` waited on one network read only: `index.pools()`, a single GET with `DATA_READ_TIMEOUT_MS = 10_000` and no retry (`private-index.ts:327-336`, `data-layer.ts:49`).
- A classic-pool return reaches this path. `sessions.ts:3096-3099` runs `backBuild` inside `this.serial(...)`, then `buildBack` calls `lovejoin.chain(...)` (`sessions.ts:4456`). From there `unstale` calls `split()`, which runs `readSet(network)` (`lovejoin.ts:6814`), then `deps.pools` (`:2711`), `refresh`, and `confirmed`.
- The status read follows the same route (`ours()` calls `readSet` at `:3130`), as do mixes and splits through `split`/`splitAll`, and `madeBy` (`:5644`).

## Scratch test

The test was `tests/zz-review-v-pr336-1-trace-1.test.ts`, now deleted. It wired the worker's way: `PoolDiscovery` with `koios = chainClient({...}, () => "https://data.test")`, so `koiosAlone()` is the real `alone` client on `KOIOS_BACKEND`, plus the fake index listing PR #163's pool. Time was virtual: a timeout costs 45 s, and every sleep and cooldown advances a clock. Results on HEAD:

| Koios does | `pools()` waits | Koios requests | pool kept |
|---|---|---|---|
| times out | **91,000 ms** (45 s, a 1 s sleep, 45 s) | `tx_info` ×2 | no |
| answers 503, with Koios's real sleeps | **4,012 ms** of real time | `tx_info` ×3 | no |
| answers 429 with Retry-After 60, under a `RateLimit` | **120,000 ms** of cooldowns (`[60000, 60000]`) | `tx_info` ×3 | no |
| answers | one `tx_info` | ×1, then nothing at the next refresh | yes |

- The DESIRED case, "`pools()` resolves within `DATA_READ_TIMEOUT_MS`", **fails on HEAD**: `expected 91000 to be less than or equal to 10000`.
- With timeouts, a second read inside `REFRESH_MS` asks Koios nothing. After `REFRESH_MS` the next read waits the same 91 s again (182,000 ms in total). Once Koios answers, the next refresh keeps the pool.
- **Mutation check.** The copy was under `scratchpad/review/v-pr336-1-trace/`, with line 454 reverted to `await this.keep(network, found);`. There the DESIRED case passes: 0 ms virtual, 6 ms real in the 503 case, and no Koios request. Every HEAD-characterising case then fails on `expected [] to deeply equal ['tx_info', …]`. So #336 introduced the wait.

## Scope: where the finding is too broad, and what it misses

- **"Every non-quiet pool read waits" is true only for a device with no record yet.** On a device that holds a record with `listed`, only the read that starts a refresh waits. That is the first non-quiet read after 5 minutes, or the first after the worker starts. `asked` (`:418`) and `answered` (`:432`) are set before `confirmed` runs, and `:415` then returns early. Test: with a record seeded, a second read during the hang returned at once, with one `tx_info`.
- **With no record yet, every concurrent read waits.** This covers a new install, and a device after Remove wallet. `:415` reads the stored `listed`, which isn't written until `keep` runs after the check. Each concurrent non-quiet read then clears `answered`, reads the list again and starts its own Koios check. Test: two reads, two `lovejoin/pools` reads, two `tx_info` in flight, both reads still pending. A restore, which makes several pool reads at once, would hit this.
- **`poolNamed` reads nothing for the classic pool.** It returns at `lovejoin.ts:2905` before any read. Only a token pool's id goes through `readSet`.
- **Missing from the finding: the wait holds the sessions queue.** A return's build runs inside `SessionService.serial`, the queue shared by the runner and the user (`sessions.ts:1443`, `:3099`). While the build waits on Koios, every other session step waits behind it: the runner's steps, pumps, the list read with refresh (`:1503`), and other builds and sends.
- **Reachability.** The wait needs mainnet, the data layer's private part up and Koios-only off. Preprod and Koios-only never call `refresh`'s list. The bundled head start lists **no mainnet pools** (`src/lovejoin-pools.json`: mainnet `pools: 0`), so the first pool launched on mainnet, token or 5 ₳ ADA, is new to every device. If Koios is down or hanging when it appears, each device's refresh waits as above until Koios answers. With Koios healthy, the cost is one `tx_info` round trip, once per device for each new pool.
- **Unverified, not part of the finding.** Chrome's MV3 lifecycle documents that a worker can be stopped when a `fetch()` response takes more than 30 s. If that applies, a hanging Koios could cut the worker before the 45 s timeout, so the page would get "no answer" instead of a slow answer. This would affect any 45 s Koios read, not only this one. I didn't test it.

## Fix advice

- **(b) is the better of the two proposed fixes: run the check in the background, one at a time per network.**
  - `refresh()` keeps the list's known pools at once.
  - It starts `confirmed()` for the new ones without awaiting it, tracked in a per-network map such as `confirming`, the way `scan()` keeps `looking`.
  - The background task ends in `keep(network, standard)`. `keep` already runs through `serially` and never removes a pool, so the order of writes doesn't matter.
  - The single flight also stops the stacked checks on a device with no record.
  - **Keep `look()` awaiting the in-flight check.** The hub's `lookForPools` reports `grew` from it, and `lovejoin-merged-review.test.ts` ("a look for pools says whether what the wallet reads changed") expects `grew: true` once the pool is confirmed. Only the `serviceDeps.pools` path should skip the wait.
  - If the worker stops mid-check, nothing breaks: a new worker starts with an empty `asked`, and its first refresh checks again.
- **(a), a client with no retries and a short timeout, needs care.** In `Koios.send`, a `retries: false` backend throws before the 429 `hold()` (`koios.ts:1355-1361`). A 429 from Koios would then no longer set the shared cooldown that `RateLimit` relies on. Also, `take()` still waits out any existing cooldown, up to 60 s, before the first attempt. So (a) bounds the timeout case at the new timeout but not the cooldown case. If (a) is chosen, it needs its own backend that keeps the hold, or a deadline around the check.
- **Test.** The finding's proposed test is right. Add a case with no stored record and two concurrent `pools()` reads: one Koios check in flight, and both reads resolving within the data layer's bound.
