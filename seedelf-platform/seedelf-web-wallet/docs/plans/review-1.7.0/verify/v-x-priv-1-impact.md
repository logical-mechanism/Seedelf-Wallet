# v-x-priv-1-impact: x-priv#1, impact and the fix

**Verdict: confirmed. Severity: low** (the finding's own). The fix is the owner's call. Option (a) is safe to ship in 1.7.0, but its list of places to change is short by two. Option (b) needs two corrections. Option (c) would break the hub's started-pool timing.

## What the code does on HEAD (6bca8bec)

- `lovejoin-pools.ts:454` `await this.keep(network, await this.confirmed(network, found));`
- `:565-584` `confirmed`: `fresh = found.filter((p) => !known.has(refOf(p.ref.reference)))`, then `this.deps.koios(network).koiosAlone()`, then `launched()`, then `koios.launches([...])` (`:527`). That is a Koios `tx_info` with `_tx_hashes: [launch]` (`koios.ts:926-946`). It adds `account_update_history` only for an L its launch didn't register.
- `data-layer.ts:298-306`: `launches` and `firstRegistrations` go to Koios even through the routed client. Every other public Koios method is overridden to ask our server first; I compared the two classes' method lists and none is left out. The holder look (`scan`) runs on mainnet only when our list didn't answer within REFRESH_MS (`look()`, `:404-409`). So with our server up, before #336 Koios got no request naming a launch from the launcher's IP. The submit and Send's `accountInfo` both go through our server.
- `PoolDiscovery` never reads the sealed launch record. `DiscoveryDeps` has no such dependency (`sw.ts:236`). So the launcher's device asks exactly as a stranger's does.
- **When a device reads pools:**
  - The hub reads on open and on Refresh (`Lovejoin.tsx:1699-1745`). It never polls `lovejoin-status`.
  - `lookForPools` calls `look()`.
  - Mixes, Bootstraps and returns read pools (`poolNamed`, `split`).
  - The alarm's `withdrawDue` reads them only when a box is due, or at an unlock with something open (`lovejoin.ts:6183-6187`).
  - So an idle wallet reads no pools in the background.
- The data layer lists a pool from a stable block 200 to 400 slots behind db-sync's tip (`seedelf-data/api/src/lovejoin/db.rs:343`), so about 3.3 to 6.7 minutes after its block. The hub tells the launcher the pool shows "about 10 minutes after its block" (`en.json:1277`, and `:1386` on the start's sent note).

**Scratch test:** `tests/zz-review-v-x-priv-1-impact-1.test.ts`, run alone, then deleted.
- **Setup:** two devices on the data layer's path, each with its own storage and data layer client, and one Koios observer that logs requests by device.
- **Before the listing:** both read the list, and Koios gets nothing.
- **After the listing:** the launcher refreshes at +10 minutes and the stranger at +50 minutes. Each sends exactly one `tx_info`. The two bodies are equal, and `_tx_hashes` is `[launch]` in both.
- **Later:** neither asks again, and both keep the pool.
- **Result:** it passed. The content is the same for every wallet, as the policy says; only the time and the IP tell the launcher apart.

## Is it reachable?

**Yes, on the store build's default:** mainnet with our server up, and a pool started from either side.
- From the private balance, the chain hides who paid. The launcher's first pool read after the listing then sends Koios the request.
- The hub invites the launcher back about 10 minutes after the block, and the launcher wants their pool in order to Bootstrap it. So they're among the first to ask. Today they're often the very first: 1.6.0's mainnet head start holds no token pools, the user base is small, and an idle wallet reads no pools on its own.
- It isn't certain. Any wallet that opens Lovejoin, reviews a swap or a return, runs a mix, or has a box come due in those minutes asks too.
- Koios would also have to log request timing by IP and correlate it with a rare event.

**A nuance in the finding's "before #336":** on mainnet while our server's private part is down but submit is up, the Koios holder look already asked Koios about a launch our server had sent, at the same moment. #336 makes that the default path.

## Severity: low

- **Why it's small:**
  - It affects launchers only. Starting a pool is rare and locks about 23 ₳.
  - The inference is probabilistic and needs Koios to correlate timing.
  - The request's content is the same for every wallet, as the policy says.
  - Our server and giveme.my already see the launch with the IP, and that's disclosed. Koios is the only new party.
- **Why it's still a defect:** for a launcher, the docs promise more than holds:
  - `privacy-policy.md:93`: "naming nothing of yours"
  - `privacy-policy.md:46`: "None of that names anything of yours, but one thing"
  - `privacy.md:200`: "never one of the wallet's"
  - `privacy.md:203`: "No read names a pool the wallet uses or launched"

  The launcher's confirm names their own launch, and its timing can point Koios at them. That's a misleading doc in an edge case.
- **When it would be medium:** only if the owner reads those lines as promising no timing hint. The policy's 26 October entry used the same wording for the holder look and never meant that.

## The fix

### (a) Disclose

It needs no code and can ship in 1.7.0. Two corrections:
- **Two more places to change.** The finding lists the 28 October entry (`:93`) and `privacy.md:200`. `privacy-policy.md:46` and `privacy.md:203` make the same claim and need the same change.
- **"Usually first" overstates it.** Something like: "for a pool you started, this device's request often comes among the first, minutes after its block, which can suggest to Koios that you started it."

No UI text is needed. The start's privacy notes (`en.json:1364`, `:1382`) cover what anyone sees on chain, not network observers.

### (b) Skip the Koios ask for the device's own launch

This is more private and within the owner's rules: it removes a request and adds no guard. It needs two corrections:

1. **Keep the Koios ask for a bare build.** Skipping the ask drops the check (on chain, L registered) for the launcher's own pool.
   - **Cert build:** a lying server or a deep rollback could leave a phantom pool in the launcher's read set for good. No money is at stake: a deposit into it is refused at submit.
   - **Bare build** (the record has `reviewed`): L's registration was our server's word at Send, because `choose` calls `koios.accountInfo`, which is routed to our server. So apply (b) only to records without `reviewed`, where the launch registered L itself.
2. **Defer the ask; don't drop it.** Dropped, it swaps the timing tell for an absence tell.
   - Suppose another pool is listed before the next release bundles the launcher's pool. Every other device's first ask after the listing includes the launcher's pool; the launcher's own next batch lacks it.
   - That tell is rarer than the timing one: it needs another listing in that window, a stable IP and per-IP histories at Koios. But it's certain when it fires.
   - The fix: keep the own pool at its listing without asking, and add its launch to the device's next Koios confirm of other new pools. Koios can't tell that apart from a device that didn't read pools between the two listings, since pool reads go to our server.
   - The "still owes an ask" mark names the launcher's pool, so it must be sealed (in the launch record), never in the unsealed `seedelf.lovejoinPools.<network>`.

**Wiring:** `PoolDiscovery` needs a late-bound dependency on `lovejoin.launches(network)` (sealed). When that can't be read (locked, or the store throws), it should fall back to today's ask, or keep nothing new until the unlock.

**Docs:** amend the unreleased 28 October entry, `privacy-policy.md:46` and `privacy.md:200`/`:203`.

**Tests:**
- The finding's: an own record means the pool is kept with no `tx_info`; no record means one ask.
- A bare-build record still asks.
- A record that can't be read asks as now.
- With the deferral: the own launch rides in the next fresh batch.

### (c) Wait a random while before a first confirm

This is the worst of the three:
- It delays every new pool on every device, which breaks "about 10 minutes after its block" in en, es and ja.
- A wait past `STARTED_FOUND_MS` (30 minutes, `Lovejoin.tsx:2063`) would show the launcher the critical `lovejoin.pools.warn.startedCopy` warning falsely: "Its start may not have gone through…".
- It only dilutes the early bias; it doesn't remove it.

### Recommendation

At minimum, (a) for 1.7.0, changing all four places. If the owner wants the leak prevented rather than disclosed, (b) with both corrections fits private by default, as their call.
