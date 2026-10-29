# v-pr337-6-trace: pr337#6, traced on HEAD (6bca8bec)

**Verdict: refuted.** Severity: nit (the finding's own). Confidence: high.

## The finding

"No offer where the deposit's landing was never recorded and the 5 ₳ pool drops out of the read set." The claim: a lock cuts a session's return chain while its collateral's deposit is in flight, so `Tail.landed` is unset. After a worker restart, discovery's `known()` fails and `readSet` falls back to the empty in-memory `handed`. Every return build then gets `lj.tail.noPool`, `tailHeld` returns undefined, and no *Bring the rest back now* button shows for up to `TAIL_KEEP_MS`.

## What's true

The code facts it cites hold on HEAD:

- `tailChain` returns `"noPool"` at `lovejoin.ts:4040-4041`. That's before either `tailLanded` call (4056, 4063).
- `tailHeld` returns undefined while `c.tail.landed === undefined` (`lovejoin.ts:4130`).
- `landed` is unset after a lock in flight. Only three places write it: `witnessTail`'s `tailLanded` (`sessions.ts:5146`), `tailChain`'s two calls, and the copy into a chain built again (`lovejoin.ts:4966`). `pumpChain` calls `witness` only once nothing is flying (`chain.flying.length` must be 0). The existing `cutAfterDeposit` helper in `lovejoin-planner.test.ts` reaches exactly that state.

## Why the scenario can't happen

The scenario depends on its trigger: "after a worker restart, discovery's `known()` fails, so `readSet` falls back to the empty in-memory `handed`." That doesn't happen.

1. **A restart doesn't empty the quiet read.** `readSet(network, true)` calls `this.deps.known(network)` (`lovejoin.ts:2709-2710`). That's `serviceDeps`' `known: handed` (`lovejoin-pools.ts:594,604`), which is `PoolDiscovery.known()`. `known()` reads `kept()`: the bundled head start plus the device's record `seedelf.lovejoinPools.<network>` in `chrome.storage.local` (`lovejoin-pools.ts:278-298, 348-374`). No request is made, and nothing is held in memory. `handed` is only the `.catch(kept)` fallback.
2. **The pool can't leave that record.** The 5 ₳ pool was in the read set when the chain was built, because `collateralPool` found it there (`lovejoin.ts:3968-3969`). Handing it over writes it into `shown` for good (`lovejoin-pools.ts:281-297`, STATE-2). An earlier launch of the same values turning up later makes it a copy (`handedOf`), and a copy keeps its `ref`. `tailChain` looks it up by id alone, so a copy passes the `pool?.ref` check. PR #336's `confirmed()` only filters pools new to the device. Remove wallet deletes this record, but it also deletes the sealed `lovejoin.<network>` schedule and the sessions (`wallet.ts:476-477`, `KEPT_ON_RESET` keeps neither), so no tail is left to hold anything. On preprod, the only network where a collateral tail can happen in 1.7.0 (#337's description says it "stays dormant" on mainnet), the 5 ₳ pool `18c4df77…` is also in the bundled head start that `kept()` merges in.
3. **`known()` fails only if storage can't be read, and the return reads that same storage first.** Without a trap (which is rethrown, not swallowed), `known()` can reject only when `local.get` or `local.set` does. In production `local` is `chromeArea(chrome.storage.local)` (`sw.ts:149`). The sealed schedule lives in the same area (`sw.ts:184` `new PrivateStore({ wallet, local })`, `sw.ts:236` `new PoolDiscovery({ local, … })`). Before `readSet`, the return already reads that area several times:
   - `buildBack` reads the session's record (`live`, `book`).
   - `tailOf` reads the schedule twice (`cuts`, `read`).

   A failing `chrome.storage.local` fails the return on those reads with its own error, never `noPool`. A quota-full area fails writes, not reads, and `known()` writes only for a pool not yet in `shown`, which this one is (point 2).
4. **Even the contrived case heals itself and stays bounded.** Suppose discovery's key alone failed. One attempt says `noPool`, and the next readable attempt records `landed`, so the offer follows. If it failed for good, `tailBuildable` still counts the day from `c.tail.landed ?? c.ended` (`lovejoin.ts:1341`). The return then goes directly at `ended + TAIL_KEEP_MS`, which is what `lj.tail.noPool` says: "a day at most". No state is stuck.

The other states where `landed` is unset and the return is held are bounded or are outages:

- **Deposit not on chain:** the return shows `"unlisted"` for `TAIL_UNLANDED_MS` (1 h from the chain's end, the same length as `TAIL_OFFER_MS`) and then goes by itself (`lovejoin.ts:4046-4049`).
- **Koios can't answer `tx_status`:** each build fails with that error until it can.

## The fix it proposes

It isn't needed. `offerAt = c.tail.landed ?? c.ended` changes nothing reachable:

- With the deposit not known in, `TAIL_UNLANDED_MS` already releases the return at the same hour.
- With `noPool`, the state isn't reachable (above).

It would also offer the skip before the deposit is known in, against #337's stated rule: "an hour after the mix's deposit went in".

## Scratch test (deleted)

`extension/tests/zz-review-v-pr337-6-trace-1.test.ts`, run alone. **3 passed** on HEAD (6.6 s).

It uses production's wiring:
- `serviceDeps(new PoolDiscovery({ local: t.local, … }))`, on the same `MemoryArea` that `t.store` (the `PrivateStore`) uses.
- `headStart` empty, so the 5 ₳ pool is known only from the device's record, mainnet-like.
- A real 5 ₳ ADA pool launched as `lovejoin-planner.test.ts`'s `adaPool` does.

`cutThenRestart`:
1. The return is built with `collateralTail.pool` equal to the 5 ₳ pool, read through `known()`.
2. It's sent, and the collateral's deposit is submitted with `landed` unset.
3. A lock wipes the chain's progress.
4. **The worker restarts:** a new `PoolDiscovery`, `LovejoinService` and `SessionService` over the same storage, with `handed` empty.

| Test | Result |
|---|---|
| The deposit lands, then a return build after the restart | Says `lj.tail.waiting`, **not** `lj.tail.noPool`. `landed = now`. `tailHeld` and the session view give `offerAt = landed + TAIL_OFFER_MS`, so the scenario does not occur. |
| The whole area's `get` throws | The return fails with `"storage down"`, never `noPool`. |
| Only discovery's key throws | `noPool`, `landed` unset, `tailHeld` undefined. This is the finding's state, but only under a per-key failure `chrome.storage.local` doesn't have. With the read restored, the very next build records `landed` and `tailHeld` offers. |
| Discovery's key unreadable for good, the chain's `ended` moved back past `TAIL_KEEP_MS` | The return builds directly (`collateralTail` undefined) and the tail is over. Bounded by the day. |

Test 2's per-key case also shows the tests are sensitive: if the restart really dropped the pool, test 1 would fail with `noPool`.
