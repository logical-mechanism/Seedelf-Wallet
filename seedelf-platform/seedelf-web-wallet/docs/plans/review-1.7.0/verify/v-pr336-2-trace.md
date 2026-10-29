# v-pr336-2-trace: pr336#2, verified by trace

**Verdict: confirmed, low (perf).** The mechanism is exactly as the finding says, and the scratch test reproduces its counts on HEAD (data layer 3, Koios `tx_info` ×3). The scenario reaches less far than it's written: one of its triggers can't happen in the states it names, and its precondition is latent until a mainnet token pool is launched after 1.7.0's head start. Details are below. Confidence: high.

## The path on HEAD (`6bca8bec`)

1. **The exception.** `refresh()` (`lovejoin-pools.ts:409-417`): within REFRESH_MS of the last ask, a call returns, unless `answered` is set and the device's record has no `listed`. Then it deletes `answered` and asks again. The premise is in the comment at :412: "An answer is always kept with the list it was read under (keep's first write)".
2. **The window.** `:432 this.answered.set(network, at);`, then `:454 await this.keep(network, await this.confirmed(network, found));`.
   - PR #336 (`f40ed2fc`, the only commit to this file in `babb8e76..6bca8bec`) put `confirmed()` there. Before it, the line was `await this.keep(network, found);`, with no network wait in between.
   - `confirmed()` (:565-584) asks Koios `tx_info` for every listed pool that is in neither the head start nor the record (`launched()` :527), and `account_update_history` when the launch didn't register L (:551).
3. **The writer of `listed`.** `keep()` (:374-384) is the only code that writes it. `known()` (:289) and `copiesRead()` (:322) only carry it over. So a device with no record keeps one without `listed` until the first check ends:
   - on a fresh install;
   - after Remove wallet, which deletes `seedelf.lovejoinPools.<network>` (`wallet.ts:33-41`, :477).
   - Until then, every non-quiet pool read asks the data layer again and runs its own `confirmed()`, with its own retries.
4. **How long a check can take.** `TIMEOUT_MS = 45_000` (`koios.ts:429`), and a timed-out read gets one retry (`:1373 const delays = slow ? RETRY_DELAYS_MS.slice(0, 1) : RETRY_DELAYS_MS;`, 1 s). That's about 91 s per `tx_info`, and more with `account_update_history` or a 429 hold.
5. **Why each read is held.** `serviceDeps().pools` (:597-602) awaits `refresh` before it hands the pools over, so each such read waits for its own check.

## Scratch test (`tests/zz-review-v-pr336-2-trace-1.test.ts`, run alone, deleted)

The setup:
- the real WebAssembly and `fake-index`'s data layer;
- a Koios whose `tx_info` waits on a gate;
- the head start `{ height: 0, pools: [] }`, as mainnet's bundled one;
- every read through `serviceDeps(discovery).pools`, as `sw.ts:246` wires it.

| Case on HEAD | Data layer | Koios |
|---|---|---|
| No record. The first read is held at `tx_info`, then 2 more reads, one after another | 3 | `tx_info` ×3 (both later reads asked again) |
| No record. The first read is held, then 2 reads in the same tick | 3 | `tx_info` ×3 |
| The page's open pair: the status read is held at `tx_info`, then `look()` | 2 | `tx_info` ×2 (the look doesn't scan) |
| Control: a record with `listed` | 1 | `tx_info` ×1 (the later reads return at once) |
| After the first check has kept its answer | 1 | `tx_info` ×1 (the exception has closed) |

When only the first check was released, the first read handed over 1 pool, and the second read was still held by its own check.

## Mutation checks (a copy under the scratchpad, `review/v-pr336-2-trace/`)

- **Fix B**: `await this.keep(network, []);` inserted right after `this.crowds.set(...)` (:453), before the confirmed keep.
  - Scratch cases: 1 and 1, and the later reads return at once.
  - These six test files pass: `lovejoin-discovery`, `-discovery-review-fixes`, `-merged-review`, `-pools-head-start`, `-crediting-review-fixes` and `-screens-review`. The count is 109 passed and 2 skipped, the same as HEAD's baseline in the copy.
- **Fix A**: one refresh in flight per network, awaited the way `scan()` awaits `looking`.
  - Scratch cases: 1 and 1, and the same files pass.
  - But in the control case (a record with `listed`), the later reads now stay "pending" behind the in-flight refresh, where HEAD returns them at once.

## Where the scenario is narrower than written

1. **Mainnet only**, with the data layer up and *Read Cardano through Koios only* off. On preprod, `index` is undefined and the refresh returns at :419-420.
2. **It needs a listed pool the device doesn't know**: in neither the bundled head start nor its record.
   - The release refreshes the head start (`docs/development.md:276`). 1.6.0's (`8cd8ce08`) holds 0 mainnet pools at height 14110720.
   - So the window is latent until a mainnet token pool is launched after 1.7.0's head start is written. From then on it opens once on every fresh install and every Remove wallet, until a release bundles that pool.
3. **The window lasts until the first check ends**, because `keep()` then writes `listed` (case 5). Most requests are in the slow-Koios case.
4. **Some of the scenario's triggers aren't reachable:**
   - **"A running mix's session-advance (every 20 s)" can't happen in the stated states.** The page's timer runs only for running mixes (`Lovejoin.tsx:1752-1757`). Remove wallet deletes the private records (`wallet.ts:475-477`), and a fresh install has no mix.
   - **Refresh is disabled while the hub's read is pending** (`RefreshRow.tsx:42 disabled={reading}`), and the pools section waits for the first status (`Lovejoin.tsx:1976`). So when the status read is the one held at the check, neither Refresh nor a token pool's page can be reached.
   - **The classic pool's page opens with quiet reads.** Funding reads `readSet(network, true)` (`lovejoin.ts:3403`), and `poolNamed` runs only for a token pool's id (:3390).
   - **The real triggers:**
     - the page's own open pair, when the look's refresh comes after the list has answered (2 and 2 above);
     - leaving Lovejoin and opening it again (a status read and a look each time);
     - the hub's Refresh, when the look's refresh was the held one;
     - a swap's review (`sessions.ts:1674`, non-quiet when `pool` is set).
5. **No correctness harm.** Writes go one at a time (`serially`), and the extra checks write nothing more. Nothing is lost or locked: the cost is the extra requests to the data layer and Koios's shared tier, and each later read waiting for its own check.

## Corrections to the fix and its test

- **Prefer B.** It makes the comment at :412 true again, because keep's first write comes right after the answer. It changes nothing on a device whose record has `listed` (keep returns early at :380), and every discovery test passes with it in the copy.
- **A has a cost.** It also passes, but it holds every device's pool reads behind any refresh in flight. That includes the data layer's own fetch (`DATA_READ_TIMEOUT_MS = 10_000`, `data-layer.ts:49`), which HEAD doesn't wait on.
- **The proposed test passes on HEAD as worded.** "Three concurrent serviceDeps(d).pools() calls with Koios's tx_info held" gives data layer 1 and `tx_info` 1 when all three start in the same tick: the later two return at `!this.answered.has(network)` before any answer. The later reads must start after the first read has asked for `tx_info`, which means after its list has answered. Case 2 above does this, and it fails on HEAD with 3 and 3.

## Aside: pre-existing, not this finding and not a 1.7.0 change

When the look's refresh comes while the status read's list is still in flight, `refresh()` returns at `!answered.has`. `look()` (:391-397, unchanged since 1.6.0) then finds no answer and reads Koios's holder. The scratch run got `credential_utxos` with 0 data layer calls at that moment. Fix A would remove this too.
