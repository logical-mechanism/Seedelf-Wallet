# v-x-priv-2-trace: verifying x-priv#2

**Finding:** "A new pool's Koios confirm holds every pool read on the data layer's path until Koios answers or gives up (about 91 s on a hung Koios)". Low, perf.

**Verdict: partly.** **Severity: low**, as filed.

The mechanism is real, and #336 introduced it. The timings are exact. Two parts are wrong:
- **Not every pool read waits.** Only the first non-quiet read of each refresh window does, except on a device that has no `listed` record yet.
- **The headline example doesn't happen in the tested interleavings.** The Lovejoin page's first read doesn't spin when the page opens: the page's look for pools takes the wait instead.

## The trace on HEAD (6bca8bec)

1. `serviceDeps(...).pools` awaits `refresh`. At lovejoin-pools.ts:597-601: `await discovery.refresh(network).catch(...)`, then `return handed(network)`.
2. `refresh` sets `asked` (:418) and reads the index. It sets `answered` (:432), then waits on the confirm at :454: `await this.keep(network, await this.confirmed(network, found));`.
3. `confirmed` (:565-584) does nothing for pools the device already holds. A pool new to the device goes to `launched()` on `this.deps.koios(network).koiosAlone()`.
4. On mainnet, `koiosAlone()` is a plain `Koios` (data-layer.ts:214, :223). It uses the default `KOIOS_BACKEND`, which is 45 s and retries (koios.ts:745), and the shared `KOIOS_LIMIT`.
5. The retry loop:
   - koios.ts:1345: `signal: AbortSignal.timeout(this.backend.readTimeoutMs)`.
   - :1373: `const delays = slow ? RETRY_DELAYS_MS.slice(0, 1) : RETRY_DELAYS_MS;`.
   - A 429 calls `limit.hold(retryAfterMs)`, capped at `MAX_BACK_OFF_MS = 60_000` (:498).
6. Before #336, `refresh` ended `await this.keep(network, found);` and asked Koios nothing (`git diff 473b7f1a^1 473b7f1a`). The pre-#336 test also asserted `expect(k.calls).toEqual([])`. So the claim "before #336 the data layer's path never waited on Koios for the pool list" holds.

**Non-quiet readers.** These reach `refresh` through `readSet(network)` (lovejoin.ts:2711):
- `status` → `ours` (:3130).
- `poolNamed`, `split` and `splitAll`.
- `fits`, `rooms`, `funding`, `chain`, `collateralPool`, `tailChain`, `publicBuild`, `publicAgainBuild` and `privateBootstrapMost`.
- `withdrawDue`, `withdrawNow` and `bringAllBack`.
- A swap's Review, through sessions.ts:1674 `poolsOf(network, unit, !pool)`.

Quiet reads (`known`) never reach `refresh`.

## Scratch tests (both deleted)

### `tests/zz-review-v-x-priv-2-trace-1.test.ts`

Discovery runs with the real `Koios` client, built as `koiosAlone()` builds it: default backend, default sleep, a `RateLimit`. It runs under fake timers, with `AbortSignal.timeout` moved onto the fake clock and the same `TimeoutError`. All 4 tests passed on HEAD:

| Case | Result |
|---|---|
| Hung Koios | `pools()` took **91,000 ms** of virtual time. `tx_info` was asked at 0 s and 46 s. It resolved with `[]`, without the new pool. |
| 429 with Retry-After 60 | It took **120,000 ms**. `tx_info` was asked at 0, 60 and 120 s. |
| Device whose record has `listed` | A second non-quiet read during the wait took **0 ms**, and so did a quiet `known`. A read after the first gave up, still inside the 5 minutes, took 0 ms. After `REFRESH_MS`, the next read asked the list again and waited **91,000 ms** again. |
| Fresh device, no `listed` yet | A second read, sent after the list answered, went through :412-416's restore branch (`answered.delete`). It asked the list again and ran **its own confirm**: 2 index calls, 2 concurrent `tx_info`. It waited until about 91 s too. |

### `tests/zz-review-v-x-priv-2-trace-2.test.ts`

A `LovejoinService` wired as sw.ts wires it: `...serviceDeps(discovery)` and `lookForPools: (n) => discovery.look(n)`. Discovery's Koios-alone is held on a gate; everything else answers. All 6 tests passed on HEAD:

- **`status` alone** (the hub's Refresh, or any `status` that is first in its window) stayed pending while Koios was held, and resolved when the gate opened.
- **A swap:** typing (`poolsOf(..., true)`) resolved at once. Review (`poolsOf(..., false)`) stayed pending.
- **The hub's open:** `handle("lovejoin-status")` and `handle("lovejoin-look-for-pools")` were sent together, as Lovejoin.tsx:1743-1744 sends them. In all four combinations (either order, record with or without `listed`):
  - **`status` finished.**
  - **The look was the one held.**
  - Index calls: 1.

  The look reaches `refresh` first, and `status`'s `refresh` returns early at :415 with the pools already held. `status`'s path to `refresh` is longer: `cuts` → `PrivateStore.get` → `withStoreKey`, which is the wallet's `serial` queue (wallet.ts), behind the `sessions` request the page sends first. Then a session read, HKDF and a decrypt. The look's path is two plain `local.get`s. So Chrome most likely gives the same order, though it's a race rather than a guarantee.

## What is real, exactly

When a listed pool is new to the device and Koios hangs (or 429s), some reads wait: about 91 s on a hang, up to about 120 s on 429s. Then they go on without the new pool.

**Which reads wait:**
- The first non-quiet pool read of each window waits.
- `asked` and `answered` are in-memory fields, created per worker start (sw.ts:236). So the window resets each time Chrome restarts the idle worker, not only every 5 minutes.

**The user-visible cases, when one is first in its window:**
- the hub's Refresh,
- a token swap's Review,
- a mix, a funding step, a Bootstrap form or a session's return,
- the alarm's `withdrawDue`.

**Narrower than claimed:**
- Other reads in the same window go on at once, and so do all quiet reads.
- Opening the Lovejoin page doesn't spin in the tested interleavings: the look takes the wait, in the background. Its `grew` comes back false, so there is no extra read.

**Wider than claimed:**
- **A fresh or restored device.** Until the first keep writes `listed`, each non-quiet read made after the list answered starts its own confirm and waits. Each one also sends Koios its own `tx_info`.
- **A Withdraw now can queue behind the alarm.** This is from reading the code, not tested. `withdrawDue` and `withdrawNow` share `inTurn("withdraw.<network>")` (lovejoin.ts:6164, :6372). If the alarm's run is the window's first non-quiet read, a Withdraw now pressed during its confirm waits behind it.

**How likely it is:**
- Mainnet's bundled head start has **no token pool** (`src/lovejoin-pools.json`). So the first mainnet token pool will be new to every device.
- Once Koios answers once, the pool is kept and never asked about again. The harm needs Koios to be down while that is still pending.
- No money, privacy or lock is at stake. **Low** stands.

## Fix advice

- **Prefer the finding's first option, with care.** Keep what's already held at once, and don't hold `serviceDeps.pools` on the confirm. But:
  1. **Traps.** `launched` runs WebAssembly (`lovejoinLaunchCheck`, `lovejoinVerifyPool`). A trap in a detached promise would no longer reach the lock (1.6.0's 314-wasm#0). Detach only the Koios fetch and cache its rows. Run the WebAssembly checks inside the next `refresh`'s own call, or route a detached trap to `wallet.trapped()`.
  2. **Keep `look()` awaiting the confirm.** It is already the call that takes the wait on the hub's open, and R10's `grew` re-read depends on it.
  3. **Add a per-network in-flight guard**, like `looking`. That stops duplicate confirms, and duplicate `tx_info` requests, from the restore branch at :412-416.
  4. **Tests.** Add the finding's proposed test: `tx_info` never answers, `pools()` resolves with the held pools, and the pool is kept once `tx_info` answers. Add a trap-in-confirm test too.
- **Not the second option.** A short-timeout client with `retries: false` still holds the read, for up to its timeout. With `retries: false`, a 429 throws before `limit.hold` (koios.ts:1355-1368), so Koios's Retry-After would stop holding the wallet's other Koios requests, against rule 8. A slow but working mainnet `tx_info` would also never confirm.

## Not verified

Chrome's MV3 lifetime rules may stop a worker whose own `fetch()` waits more than 30 s. If so, the outcome would be a dropped request rather than a 91 s spinner. This can't be checked offline, it applies equally to every 45 s Koios read the wallet already makes, and it doesn't change the verdict.
