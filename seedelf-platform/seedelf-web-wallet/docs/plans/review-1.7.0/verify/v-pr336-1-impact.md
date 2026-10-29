# v-pr336-1-impact: a mainnet pool read waits through Koios's retries while a new pool is unconfirmed

**Verdict: confirmed. Severity: low** (as filed).

- The wait is real. With the shipped client it measured **91.1 s of real time** while Koios hangs.
- It comes only in a narrow state: on mainnet, while a pool the data layer lists is new to the device and Koios can't answer.
- The finding overstates one thing. Only the **first** non-quiet pool read per network in each 5 minutes of a worker waits, not every one.
- **The fix:** its first option is the right one, applied to `confirmed()` alone, plus one addition: skip the check while Koios's shared hold runs. Its second option would drop a WebAssembly trap unless it gets a route to `wallet.trapped()`, and it breaks `lookForPools`' `grew`.

## Is it reachable in the shipped build?

Yes, on mainnet only, and only while three conditions hold together. I checked each link on HEAD (`6bca8bec`).

1. **Mainnet with the data layer up (the default).**
   - `sw.ts:181` `const koios = chainClient(dataDeps)`, and `data-layer.ts:437` `if (at) return new DataLayerKoios(network, at, deps)`.
   - Its `koiosAlone()` (`:223`) is `this.alone` (`:214`): a plain `Koios` with the default backend, `KOIOS_BACKEND` (`koios.ts:745`, 45 s and retries), under `KOIOS_LIMIT`.
   - On preprod, with Koios-only on, or with the private part down, `index` is undefined, so `refresh()` returns before `confirmed()`. The wait never happens there.
2. **A pool the data layer lists that the device hasn't kept.**
   - The bundled head start lists **0 mainnet pools** at height 14,110,720 (1.6.0's refresh, `8cd8ce08`), and the roadmap still says "mainnet has no token pools yet".
   - Bundled pools are `known` (`kept()` merges `head.pools`), so they are never checked. The 1.7.0 list refresh bundles whatever exists at packaging time.
   - So the first trigger is the first mainnet pool launched after 1.7.0's refresh. After that, it's each later launch, on each device that hasn't kept the pool: one that never saw it, a new install, or a device after Remove wallet, which deletes the record.
   - A device that kept a pool under 1.6.0, unchecked, never asks about it.
3. **Koios not answering at that refresh.**
   - With Koios healthy, the check is one fast `tx_info`, and the pool is kept for good. No later wait follows.
   - Koios not knowing the launch yet isn't a wait either: an empty answer comes back fast.

**How long one pool read waits.** I measured this through `DataLayerKoios`'s own `koiosAlone()` and `RateLimit`, on a virtual clock. Row one I also ran in real time.

| Koios | Attempts | Wait |
|---|---|---|
| hangs (each request times out) | 2 × `tx_info`, sleep 1 s | **91 s** (real time: 91,113 ms, attempts at 37 ms and 46,068 ms) |
| 503, or connection refused | 3, sleeps 1 s + 3 s | 4 s |
| timeout, 503, timeout | 3 | 94 s |
| 429 with `Retry-After: 60` | 3, held twice | 120 s |
| `tx_info` answers, L not registered by the launch, `account_update_history` hangs | 1 + 2 | 91 s more |
| nothing new listed, or the pool already kept | 0 | 0 (as before #336) |

Before #336, `refresh()`'s only wait was the data layer's one request: `private-index.ts:335` `AbortSignal.timeout(DATA_READ_TIMEOUT_MS)` (10 s), with no retry.

**How often the wait comes.**
- **Once per network per `REFRESH_MS` per worker.** `this.asked.set(network, at)` (`lovejoin-pools.ts:418`) comes before the awaits, and `:415` returns early on a device with a record.
  - A second read during the wait answered at once.
  - A read right after the failed check: 0 ms.
  - 5 minutes later: 91 s again.
  - A worker started again: 91 s at its first read.
- **Chrome stops the worker after about 30 s idle,** so in practice the wait comes at the first Lovejoin action after each pause. It keeps coming until Koios answers.
- **On a device with no record yet** (a new install, or after Remove wallet), a second read during the wait re-asks the data layer and Koios, and waits too (`lovejoin/pools` ×2, `tx_info` ×2). The first failed check's `keep()` then writes the record.

**What the user sees.**
- The flows that wait are those whose first non-quiet pool read falls in that window:
  - the hub's status read (`ours()`);
  - a swap's or a return's review (`rooms()` → `splitAll`, `lovejoin.ts:3255`);
  - a mix, return or Bootstrap's review and build (`split` / `splitAll`, `:6814`, `:6831`, and `poolNamed` for a token pool);
  - the collateral's mix, but only once a 5 ₳ pool is kept (`:3971`);
  - the alarm's withdrawal runs, which nobody watches.
- `call()` (`ui/background.ts`) has no timeout, so the page shows its spinner for the whole wait, then goes on with the pools kept before.
- I did not verify whether Chrome ends a worker whose fetch hangs past 30 s. If it does, the page says the worker didn't answer instead. The same holds for every existing 45 s Koios read the wallet makes, so it isn't this finding's.
- **The persistent case:** a network that black-holes Koios (a firewall) but lets our server through. That pays about 91 s on every first read after a pause, until the next release bundles the pool. A Koios blocked by DNS fails fast, and costs 4 s.

## Severity

**Low:** an edge case with a small UX cost.
- Nothing gets stuck: the read goes on with what was kept before, and it ends on its own.
- No money is touched, and nothing changes for privacy (the same requests go out, as the policy now says).
- It isn't medium, which in the brief needs real harm or a stuck state. It doesn't block the release: mainnet has had no token pools, and with Koios healthy the state never shows.

## The fix

**Option (a), a Koios client with no retries and a short timeout: right and minimal, with these changes.**
- **For `confirmed()` alone.** `holder()`'s look (`:485`) must keep the retrying 45 s client: it pages `credential_utxos` and is the Lovejoin page's. `launched()` already takes the client as a parameter, so only `:570` changes, plus an accessor beside `koiosAlone()` (`koios.ts:776`, `data-layer.ts:223`) and the `Pick` in `DiscoveryDeps.koios`.
- **It still waits out `KOIOS_LIMIT`'s hold.**
  - `take()` at `koios.ts:1334` comes before any attempt, and the hold is kept across a restart (`sessionHoldStore`).
  - In my test, a no-retry 10 s client under a 60 s hold took **70 s**.
  - To keep the read inside the data layer's bound, skip the check while `holding() > 0` and leave the pool for the next list, as a failed check does now. That skips no user action, so it isn't a new guard.
- **With `retries: false`, a 429 sets no hold:** the branch at `:1355` throws before `:1367`. That's acceptable for one request, but keeping the hold on a 429 is kinder to the public tier.
- **It sends fewer Koios requests on a failure** (1 instead of 2 or 3), within rule 8. The requests are the same ones, so the privacy policy's new entry and `privacy.md` stay accurate. No UI text changes.
- **The existing discovery tests should still pass.** Their 503 case asserts nothing about attempts, and the unknown-launch case asserts one `tx_info`.

**Option (b), the check started without awaiting it: it takes the wait off the read completely, but it needs three more things.**
- **A trap route.** A WebAssembly trap in `launched()` (`lovejoinLaunchCheck` or `lovejoinVerifyPool` through `tried`, which rethrows traps, `:250`) today reaches the caller that locks the wallet: `confirmed()` `:579` → `serviceDeps.pools` `:599` → `readSet`'s `kept`. My test saw the pool read reject with the `RuntimeError`.
  - Detached, the trap would be dropped. That's the very class #330 fixed for 1.7.0 (`unawaited` in `handlers.ts`).
  - So `PoolDiscovery` needs a `trapped` route in its deps from `sw.ts`, or the next `refresh()` must rethrow a settled trap.
- **`look()` must await the check under way.** Otherwise `lookForPools`' before-and-after `grew` misses the pool, and the hub doesn't show it until a later read.
- **The discovery tests must await the check too.** Those that assert the pool kept after `refresh()` resolves would otherwise fail.

**The test.** Use a virtual clock, as below: a fake fetch that throws `TimeoutError` and a sleep that records what it's asked. Assert one attempt, no sleep, and a bounded wait, and that a later read keeps the pool once Koios answers. Real sleeps would add seconds to the suite.

## Repro

Two scratch files, run alone and since deleted.

**`tests/zz-review-v-pr336-1-impact-1.test.ts`, 10 tests, all passed.**
- The setup is the real `DataLayerKoios("mainnet", …)`, with Koios faked per step on a virtual clock, and the real WebAssembly. Each case went through `serviceDeps(found).pools("preprod")`.
- Timeout ×2: 91,000 ms, `[tx_info, tx_info]`, sleeps `[1000]`, nothing handed over.
- 503 ×3: 4,000 ms, sleeps `[1000, 3000]`.
- Timeout, 503, timeout: 94,000 ms.
- 429 ×3 with `Retry-After: 60`: 120,000 ms, sleeps `[60000, 60000]`.
- `tx_info` with no L certificate, then `account_update_history` timing out ×2: 91,000 ms.
- No new pool, or one already kept: 0 ms, no request.
- Throttle: 91 s, then 0 ms, then 91 s five minutes on, then 91 s in a new worker; 6 `tx_info` in all.
- Concurrency:
  - with a record, the second read "answered";
  - with none, it was "waiting", with `lovejoin/pools` ×2 and `tx_info` ×2.
- Fix (a), no retries and a 10 s timeout: 10,000 ms, and 70,000 ms under a 60 s hold.
- A trap in `lovejoinLaunchCheck`: `pools()` rejects with `WebAssembly.RuntimeError`.

**`tests/zz-review-v-pr336-1-impact-2.test.ts`, real time, passed.**
- A Koios fetch that never answers until the client's own `AbortSignal.timeout` fires.
- `real wait 91113 attempts at [ 37, 46068 ]`, and `pools()` returned `[]`.
