# v-pr336-3-impact: pr336#3, the device that started a pool is likely the first to ask Koios about it

**Verdict: confirmed. Severity: low** (the finding's own). The choice of fix is the owner's: (b), a docs change, is the minimal fix for 1.7.0, and (a) is the more private one, with pitfalls listed below.

## Is it reachable with the shipped build?

Yes, on the default path: mainnet, our server up, Koios-only off. I traced it on HEAD and ran a scratch test.

1. **Discovery isn't told about the wallet's own launch.**
   - `DiscoveryDeps` (`lovejoin-pools.ts:232-243`) holds `local`, `wasm`, `koios`, `index`, `now` and test hooks, and sw.ts builds it with exactly those (`sw.ts:236`, `new PoolDiscovery({ local, wasm, koios, index, now: Date.now })`).
   - `submit()` records the launch in the sealed Lovejoin record only (`lovejoin-launch.ts:387-398`, then `lovejoin.ts:5953-5958`, `recordLaunch`).
   - In `confirmed()` (`lovejoin-pools.ts:565-583`), `known` is the device's found pools, `was.pools`. So the launcher's own pool is `fresh`, like any other pool.
   - The finding cites `lovejoin-launch.ts:243` as evidence. That line is the build's look, which runs before the pool exists. The real evidence is the deps above. The claim holds either way.
2. **The request.** `launched()` → `koios.launches()` (`koios.ts:926-946`) sends `tx_info` with `_tx_hashes: [<launch>]`, `_inputs: true`, `_certs: true` and `select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates`. That shape is distinctive, and it goes to `koiosAlone()`, which is api.koios.rest.
3. **When the launcher asks.**
   - After Send, the screen says "It shows under Pools once a look finds it, about 10 minutes after its block" and "Then you can Bootstrap it from its page" (`en.json:1386-1387`). Its only button goes back to Lovejoin (`LovejoinLaunch.tsx:193-203`).
   - Every page open reads pools: `load` → `lovejoin-status` → `ours` → `readSet` → `pools` → `refresh`, at most every 5 minutes.
   - So the launcher's first page open after our server lists the pool sends the confirm. That's roughly 200 slots plus up to one 5-minute throttle after the block.
4. **When anyone else asks.** Another device refreshes only at its own pool reads: the page opening, boxes due (`withdrawDue` reads pools only when something is due, `lovejoin.ts:6186-6190`), mixes or reviews. Nothing makes other devices ask on a schedule tied to the new pool. With today's user base, the launcher is very likely the first, and often the only one, within the first window.
5. **What changed in #336.** Before #336, Koios heard nothing of a launch on this path:
   - submit goes through our server (`data-layer.ts:393-397`), and so do Send's `account_info`, the pending watch, and the build's look.
   - `refresh()` had no Koios call: the old line was `await this.keep(network, found)`.
6. **The Koios path since 1.6.0.** The finding's note that "the same timing has existed on the Koios path since 1.6.0" is true but harmless. Off the data layer, `submitTx` falls to Koios (`data-layer.ts:394`), so there Koios receives the launch transaction itself from the launcher's IP. The timing tell is new only on the data-layer path, and #336 made it.

**Scratch test** (`tests/zz-review-v-pr336-3-impact-1.test.ts`, now deleted). It sets up two devices on the data-layer path, the launcher's and a stranger's, on one clock. It **passed**:
- the launcher's Review look, before the list carries the pool, sends nothing to Koios;
- the launcher's first refresh after the list carries the pool sends `tx_info` naming the launch at once, with no delay or jitter;
- the stranger's later request has the same body and query, byte for byte;
- only the times differ (5 minutes after the launch against 45), and neither device asks again once the pool is kept.

## Impact

- **Who can learn it:** Koios's operators, a third party whose logging the wallet doesn't control. Our server and giveme.my already see the launch, and the policy says so.
- **What they can learn:** the first Seedelf-shaped `tx_info` for a new pool's launch is likely the launcher's IP.
  - A start from the private balance spends private UTxOs and pays its change into a new one. So Koios gets an anchor from the IP to those UTxOs, which the policy elsewhere says it can't learn from reads.
  - A start from the public account ties the IP to that account.
- **What the policy says now:**
  - `privacy-policy.md:46`: "None of that names anything of yours, but one thing: …". The timing tell isn't among the exceptions it lists.
  - `:93` (the 28 October entry): "The same request for every wallet, … naming nothing of yours; … so it can tell you use Lovejoin."
  - `:28` seals "the pools you started" on the device.
  - The policy's own standard is to disclose tells like this one: "seconds before the blockchain shows it to everyone"; "tells the Cardano server only that this device saw that pool first".
- **Why low, not medium:** the tell is probabilistic, it needs Koios to log and correlate, and it reaches only pool starters on mainnet with our server up. Pools launch rarely and cost about 23 ₳. No money, flow or lock is at risk. It's an undisclosed inference, not a direct leak, and the entry it amends hasn't shipped yet, so the fix is free before the upload.

## The fix

**(b), a docs change.** It's right, minimal and within every rule. Since the 28 October entry is in this release and hasn't shipped, amend it in place: no new date is needed. Three places:
- **Policy :46**, after "seconds before the blockchain shows it to everyone": "And on mainnet this device is likely the first to confirm your new pool with Koios, so Koios may guess you started it."
- **The 28 October entry**: "…so it can tell you use Lovejoin, and, for a pool you started, since this device is likely the first to ask, guess that you started it."
- **privacy.md:200**: "Koios's requests name pools every wallet reads, never one of the wallet's, and only as each is new" needs the same caveat, and so does :203's "No read names a pool the wallet uses or launched".

There's no UI text or i18n change: the account_info tell isn't in the UI either.

**(a), treating the wallet's own launch as known.** It's more private and saves a request, and it adds no guard, so it's within the rules. It's the owner's call, and it has pitfalls:
1. **Where the fact comes from.** It lives only in the sealed Lovejoin record. Pass it in memory from the Lovejoin service, through `serviceDeps.pools` and the launch's `discovery.look`. **Never** write it into discovery's unsealed `seedelf.lovejoinPools.<network>`: that would unseal "the pools you started" (:28), and `known()` would hand the pool over sooner, which breaks §3 (`chunk-34-token-pools.md:309`; `lovejoin-launch.ts:8-9`). When the wallet is locked, discovery has no record and asks Koios as now.
2. **What it skips.** It should skip only the confirm. The pool is still taken only once our server's list carries it.
3. **How it matches.** Match on both the recorded `txHash` and `id`, which are the sent build's after `choose()`.
4. **Batches.** `confirmed()` batches every fresh pool into one `tx_info` (20 a request). Dropping just the own pool's hash from a batch a stranger sends whole would be a content tell, worse than timing. So skip the request only when every fresh pool is the wallet's own; otherwise ask for all of them, as any device would.
5. **Leave the Koios holder look alone.** Koios already got the submission on that path, and the batch rule in 4 applies there too.
6. **What it gives up.** It drops #336's check for that one pool. The device built the launch, so it knows L is registered: the registering build registers it, and the bare build is sent only after `account_info` said so. Only "it landed" then rests on our server's word, as the pending watch already does. A deep rollback would leave the pool in the launcher's read set, where the ledger refuses a Bootstrap. The harm is small.
7. **Still needed:** one discovery test (own pool listed → kept with no Koios request; own plus a stranger's pool fresh → one `tx_info` with both), and the same three docs touched to say the device skips the pools it started.

Either way, the Koios path needs no change.

## Scratch files

`extension/tests/zz-review-v-pr336-3-impact-1.test.ts` was created, run alone (1 passed), and deleted. No tracked file was edited.
