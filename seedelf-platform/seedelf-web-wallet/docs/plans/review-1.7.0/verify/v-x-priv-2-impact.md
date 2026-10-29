# v-x-priv-2-impact: x-priv#2, a new pool's Koios confirm holds the data layer path's pool reads

**Verdict: confirmed. Severity: low** (as filed), at the top of low. Confidence: high.

This is the same defect as `pr336#1` (see `v-pr336-1-impact.md` and `v-pr336-1-trace.md`, which measured the 91 s wait). This report adds three things:

- **Chrome doesn't let the wait run to 91 s.** In a real Chrome, unless something else reaches the worker, the read fails after about 30 s.
- **That makes it a repeating failure,** not one wait per five minutes.
- **A built and tested comparison of the fixes.**

## What Chrome actually does with the wait

I checked this with a probe extension in Chrome for Testing 153 (Playwright's binary, launched directly with no DevTools attached; details under *Repro*).

- The page asks the way `ui/background.ts` `call()` does: its own port, one message, held open until the reply.
- The worker then makes Koios's pattern against a localhost URL that never answers: fetch with `AbortSignal.timeout(45000)`, sleep 1 s, fetch again.

| Case | What happened |
|---|---|
| Nothing else reaches the worker | **Chrome stopped the worker at 30.0 s.** The hanging socket closed after 30.0 s, and the page's port disconnected at 30,004 ms. The 45 s timeout never fired. |
| The page pings the worker every 10 s | The worker lived: `TimeoutError` at 45,001 ms, the second at 91,002 ms, then the reply at 91,003 ms, on the same boot. |

So the 30 s stop is Chrome's idle timer. A pending `fetch` doesn't keep an extension worker alive, and neither does an open port with no traffic.

**The wallet sends nothing on its own during that wait:**
- The worker has no keep-alive. Its only timers are two 1-minute alarms (`sw.ts:74`, `:87`), and two 1-minute alarms always leave a gap of 30 s or more.
- The page reports activity only on `pointerdown` or `keydown` (`App.tsx:95`), at most every 30 s.
- The hub polls only while a chain or a mix is being sent (`Lovejoin.tsx:1756`, `:1791`, `:1800`).

**On HEAD, while Koios hangs and the data layer lists a pool this device hasn't kept:**
- A user watching the spinner gets **"The wallet's background service didn't answer."** (`worker.noAnswer`, `en.json:3037`; `ui/background.ts:73`) after about 30 s. It's up to about 60 s if an alarm fires in between.
- **It doesn't wait for the next five minutes.** The throttle lives in the worker's memory (`asked`, `answered`: `lovejoin-pools.ts:415`, `:418`, `:432`), and the stopped attempt kept nothing: `keep` comes after the confirm (`:454`). So the next worker's first non-quiet pool read asks the list and Koios again at once, and fails the same way.
  - My scratch test showed it: a second `PoolDiscovery` on the same storage, 31 s later, well inside `REFRESH_MS`. That's `lovejoin/pools` ×3 and `tx_info` ×2, and the record still holds no pool.
- **With traffic** (a running mix polls every 2 s, the user clicks, a dApp polls the connector), the worker lives. The read then waits the finding's 91 s, or about 2 minutes on 429s, and goes on with the pools already held.

It ends when Koios answers: the next read's `tx_info` confirms the pool, and it's kept for good.

## Is it reachable in the shipped build?

Yes, on mainnet, when three conditions hold at once. Each one is checked on HEAD (`6bca8bec`).

1. **Mainnet with the data layer's private part up and Koios-only off,** the defaults.
   - `confirmed()` uses `koiosAlone()`, a plain Koios client: the 45 s timeout and retries (`data-layer.ts:214`, `:223`; `koios.ts:745`).
   - On preprod, with Koios-only on, or with the private part down, `index` is undefined, so `refresh()` returns before the confirm.
2. **A pool the data layer lists that this device hasn't kept.**
   - The bundled head start lists **no mainnet pools** (`src/lovejoin-pools.json`, height 14,110,720).
   - So the trigger is the first mainnet pool launched after 1.7.0's list refresh, and each launch after it.
   - It applies on every device that hasn't kept the pool yet, a new install or a device after Remove wallet included.
3. **Koios hanging, not failing fast.**
   - A 503, a refused connection or a DNS block fails in about 4 s.
   - Koios answering confirms the pool in one fast `tx_info`, and the state never comes back for that pool.

**The flows that make a non-quiet pool read,** and so wait or fail:
- **The hub's status read** (`ours()`, `lovejoin.ts:3130`).
  - On open it races the page's `lovejoin-look-for-pools`. Whichever reaches `refresh()` first does the confirm, and the other returns at once (`:415`).
  - If the look wins, the hub's first read is quick, and the look, which the page doesn't wait on, takes the failure.
  - **Refresh always hits it** in a new worker.
- **A swap's Review through a token pool:** `poolsOf(…, false)`, `sessions.ts:1674`.
- **A token pool's mix funding** and the Bootstrap form's bound: `poolNamed`, `lovejoin.ts:2948`, `:3390`.
- **Every mix, return and session build** through `split` or `splitAll` (`:6814`, `:6831`). These read the whole set, so classic-pool work stops too.
- **The alarm's due withdrawals:** `runs.ts:95` → `withdrawDueNow` → `ours()` (`lovejoin.ts:6195`). With no page open, each run dies with the worker, and boxes due back wait until Koios answers.

**Who can bring it about:**
- **A user:** yes, as above.
- **An attacker can't make Koios hang.** A junk pool with Koios healthy costs one fast `tx_info` at each refresh, with no stall.
- **An on-path network attacker** who black-holes `api.koios.rest` but lets our server through stops Lovejoin on mainnet. That's a denial of service only.
- **The persistent variant:** a network that drops Koios's packets but not our server's. That user's Lovejoin on mainnet stays broken from the first new pool until a release bundles it. It's rare.

## Severity: low, at the top of low

**Why not medium:**
- It needs an outage of a third party, of the hanging kind, while a listed pool is unconfirmed on the device. Mainnet has none bundled yet, and pools launch rarely.
- With Koios healthy, the first read after a listing closes the window in about a second.
- Nothing is lost or locked: boxes stay in their pools, and nothing is sent wrongly.
- It heals on its own when Koios answers.

**Why the top of low:**
- In the state, it isn't a 91 s delay. It's repeated failures of every mainnet Lovejoin read, the classic pool included, and of due withdrawals.
- The user has no way out: Koios-only reads the same hanging Koios.
- And it undoes, for Lovejoin, the decoupling from Koios that the data layer was built for (the 1.4.0 must-fix).
- The fix is small and fully tested (below), so it's worth doing before 1.7.0 is packaged.

## The fix

### Recommended: the finding's first option, with four details

**The change:** don't hold the read on the confirm. Built in a copy outside the tree: 22 changed lines in `lovejoin-pools.ts` and 1 in `sw.ts`.

1. **A `wait` flag on `refresh()`.** It's `refresh(network, wait = true)`, and only `serviceDeps.pools` passes `false`. `look()` and the tests that call `refresh()` keep awaiting, so they're unchanged.
2. **Keep the answer's list at once,** with `await this.keep(network, [])` before the confirm starts. A read during the confirm then returns inside the five minutes. Without it, a device with no record yet (a new install, or after Remove wallet) re-asks the list and starts a second confirm (`:415`).
3. **`look()` awaits the confirm under way,** `await this.confirming.get(network)`, tracked in a per-network map. Otherwise `lookForPools`' before-and-after `grew` misses the pool, and the hub doesn't re-read it (1.6.0's R10). `lovejoin-merged-review.test.ts`'s `grew: true` case holds this.
4. **A route for a trap.** A detached confirm's WebAssembly trap (`lovejoinLaunchCheck`/`lovejoinVerifyPool` through `tried`) would otherwise be dropped: the class #330 fixed (`unawaited`, `handlers.ts:48`).
   - Add `trapped?: () => Promise<void>` to `DiscoveryDeps`, wired in `sw.ts` as `trapped: () => wallet.trapped()`.
   - Then `void confirm.catch(async (e) => { if (isTrap(e)) await this.deps.trapped?.().catch(() => undefined); })`.

**Results in the copy:**
- `tsc` is clean.
- The 16 test files that wire discovery pass **unchanged: 346 passed, 2 skipped**, the same as the unmodified copy's baseline.
- New behaviours, all passing:
  - a read answers with the held pools while `tx_info` hangs, asking the list and Koios once;
  - a second read in the five minutes asks nobody;
  - the pool is kept once Koios answers, and the next read has it;
  - a look waits on a read's confirm, and sees the pool;
  - a trap in the detached confirm reaches `trapped()` once;
  - a restarted worker's read answers at once too.

**What it changes:**
- A new pool is used from the read after its confirm, not the one that started it. That is what #336 promised ("If Koios can't confirm a pool yet, or is down, the pool waits for the next list").
- The hub still shows a new pool at once on open, through the look.
- **What's sent stays the same:** the confirm still starts at the first pool read after the listing, one `tx_info` per new pool per worker start until it's confirmed. The policy's pools paragraph (`privacy-policy.md:46`), its 28 October entry (`:93`) and `privacy.md:200` stay accurate.
- Rule 8's Koios cost is unchanged.
- There's no UI text and no new guard.
- Worker stops are now harmless. A stop mid-confirm loses only the background request, and the next read starts it again.

### The finding's second option: smaller, but only a mitigation

**Built in a copy:** a `KOIOS_QUICK` backend (`readTimeoutMs: 10_000`, `retries: false`), `quick()` and `holding()` on `Koios`, and in `confirmed()`, a skip while `holding() > 0`.

**Results:**
- `tsc` is clean, and the 16 files pass unchanged.
- The read waited **10,042 ms** while Koios hung.
- During a cooldown the read answered at once, with no request.
- A 429 on the confirm left **`holding()` at 0**: `retries: false` throws before `hold()` (`koios.ts:1355` vs `:1367`).

**Caveats:**
- **The wait comes back with every worker start** during the outage. Chrome stops idle workers after 30 s, so that's most first reads after a pause.
- **The timeout must stay well under 30 s.**
- **`holding()` reads only the in-memory cooldown.** A new worker restores a saved one lazily, at its first `take()`. So a new worker can still wait up to 60 s in `take()` and be stopped.
- **The 429 cooldown is lost** for this request.

### Not for 1.7.0: confirm only in `look()`

This mirrors the Koios path, which finds pools only as the Lovejoin page opens. No pool read would ask Koios.

But it's a contract change:
- **9 existing tests fail** (8 in `lovejoin-discovery.test.ts`, 1 in `lovejoin-discovery-review-fixes.test.ts`): they expect `refresh()` to keep a new pool.
- **A new token pool goes unused** in swaps until the page is opened.

### The test

The finding's test is right: Koios's `tx_info` never answers, `serviceDeps(found).pools()` resolves with the held pools, and the new pool is kept once a later `tx_info` answers. On HEAD it fails: the read stays pending. Add three cases:

- **A look waits on the confirm a read started,** and sees the pool (R10).
- **A trap in the detached confirm reaches `trapped`.**
- **No second confirm on a device with no record:** a second read inside the five minutes asks nobody.

My copy's file had all four, and each passes only with the fix.

## Corrections to the finding

- **"About 91 s":** only while something else reaches the worker. Otherwise the request fails at about 30 s (up to about 60 s) with the worker's no-answer message, and the next worker's first read repeats it.
- **"The first pool read of each 5-minute window":** it's each worker's first non-quiet read, or each five minutes in a worker kept alive. The throttle doesn't survive Chrome's restarts.
- **"The Lovejoin hub's first read":** on open it races the look. Refresh, a swap's Review, mixes, returns and due withdrawals are where it reliably lands.
- **"Before #336, the data layer's path never waited on Koios for the pool list":** right. #336 changed `:454` from `await this.keep(network, found);`.

## Repro

**The Chrome probe** (scratchpad `review/v-x-priv-2-impact/chrome-sw/`, deleted).
- An MV3 extension with a `sw.js` and a page as described above, and a Node server whose `/hang` never answers.
- Chrome for Testing 153.0.8010.12 was launched directly: `--headless=new --load-extension`. Its socket lived in the system temp folder, and no CDP was attached, since Playwright's auto-attach can suspend the idle timeout.
- No ping:

  ```
  0.3s hang open /hang?a=1
  30.3s hang socket closed /hang?a=1 after 30.0s
  {"from":"page","ev":"disconnect","ms":30004}
  ```
- Ping every 10 s:

  ```
  {"ev":"first","r":"TimeoutError","ms":45001}
  {"ev":"second","r":"TimeoutError","ms":91002}
  {"ev":"reply",…,"ms":91003}
  ```

**`tests/zz-review-v-x-priv-2-impact-1.test.ts`** (deleted). Two tests, both passing on HEAD:
- the read stays pending after `lovejoin/pools` answered and Koios was asked `tx_info`, and resolves once it answers;
- a worker stopped mid-wait keeps nothing, and the next worker 31 s on asks again: `lovejoin/pools` ×3 (one before the launch) and `tx_info` ×2, with both reads pending.

Both fail under fixes A and C.

**Three copies** (scratchpad `copy-a`, `copy-b`, `copy-c`, deleted). Each was a copy of `seedelf-web-wallet/` with `node_modules` linked back, and `seedelf-core` and `seedelf-crypto` linked read-only for their fixtures.
- **Baseline:** the 16 files that wire discovery, 346 passed, 2 skipped.
- **A:** the same, plus 4 new tests passing.
- **B:** the same, plus 3 new tests passing.
- **C:** 9 failed.
- `tsc --noEmit` was clean in all three.
