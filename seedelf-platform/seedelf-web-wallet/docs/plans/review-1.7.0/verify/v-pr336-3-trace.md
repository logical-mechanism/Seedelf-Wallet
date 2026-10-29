# Verify pr336#3 (label `v-pr336-3-trace`)

**Finding:** the device that started a pool is likely the first to ask Koios about it, and the policy doesn't cover that.

**Verdict:** confirmed. **Severity:** low (privacy: a timing tell the policy doesn't disclose; the fix is the owner's call).

## What I traced on HEAD (6bca8bec)

1. **Discovery never hears of the device's own launch.**
   - `lovejoin-launch.ts:387-398`: `submit` calls `lovejoin.recordLaunch`, which writes only the sealed Lovejoin record (`lovejoin.ts:5953-5958`, `this.update(network, …)`).
   - `PoolDiscovery`'s deps are `{ local, wasm, koios, index, now }` (`sw.ts:236`, `lovejoin-pools.ts:232-243`). There is no launch input.
   - `kept()` reads only `seedelf.lovejoinPools.<network>` and the head start (`lovejoin-pools.ts:348-372`).
   - This is the design: `lovejoin-launch.ts:7-9` says "None is read sooner from the launcher's own record, which would single out the launcher's IP (§3)". `LovejoinLaunch.tsx:15-16` says the same.
2. **The listed pool is fresh to the starter like any other.** At `lovejoin-pools.ts:566-568`, `fresh` is every listed pool not in the record.
3. **Fresh goes to Koios alone, from the user's IP.**
   - `confirmed()` → `this.deps.koios(network).koiosAlone()` (`:570`) → `launched()` → `koios.launches([launch tx])` (`:527`).
   - That's a POST to `tx_info` (`koios.ts:926-946`). On the worker's `DataLayerKoios`, `koiosAlone()` is a plain `Koios` at `NETWORKS[network].koios` (`data-layer.ts:213-225`), so `api.koios.rest` on mainnet.
4. **Before #336, Koios heard nothing of a launch on this path.**
   - `git diff 473b7f1a^1 473b7f1a`: `refresh` was `await this.keep(network, found)`. The PR's own test diff changes `expect(k.calls).toEqual([])` to `["tx_info"]`.
   - The launch's own requests all go to our server first on `DataLayerKoios`: `epochParams`, `accountInfo` (Send's `choose`), `submitTx`, `txStatus`, `tipSlot` (`data-layer.ts:297-299`, `:349-351`, `:361-363`, `:393-398`). The contract read goes to the private index.
5. **The starter is told to come back.**
   - en `lovejoin.launch.sentNote`: "It shows under Pools once a look finds it, about 10 minutes after its block, on every wallet."
   - `bootstrapNext`: "Then you can Bootstrap it from its page".
   - Opening the hub runs `lovejoin-look-for-pools` → `discovery.look` → `refresh` → `confirmed` (`handlers.ts:528-531`, `Lovejoin.tsx:2052`).
6. **Who else asks, and when.**
   - Any 1.7.0 device asks, but only at a non-quiet pool read: the hub's `status`, builds (`split`/`splitAll`), a named pool, `madeBy`, and `withdrawDueNow` (at unlock with something open in Lovejoin, or with boxes due).
   - Throttled to once per 5 minutes per worker life (`:409-418`). Each device asks once per pool.
   - So the starter is first only while few other devices are active in Lovejoin. That depends on how many people use it, which code can't decide. The finding hedges it as "likely", which fits a young user base.
7. **The words.**
   - Policy `:93` (the 28 October entry): "The same request for every wallet, only for pools new to the device, naming nothing of yours; … so it can tell you use Lovejoin."
   - Policy `:46`: "None of that names anything of yours, but one thing: …".
   - Policy `:28` lists "the pools you started" among what's sealed.
   - The policy does disclose tells like this elsewhere: "names the pool you're starting, seconds before the blockchain shows it" (`:46`, `:94`); "tells the Cardano server only that this device saw that pool first" (`:46`); "roughly when that was" (`:41`). This one is missing.
   - privacy.md `:200` ("Koios's requests name pools every wallet reads, never one of the wallet's") and `:203` ("No read names a pool the wallet uses or launched") are also inaccurate for the launcher.

## Scratch test

`extension/tests/zz-review-v-pr336-3-trace-1.test.ts` (deleted after the runs). Setup:
- One fake data layer (`fakeIndex`) and one Koios host, shared by two devices.
- Each device has its own `DataLayerKoios` with origin `https://data.test` and parts up, Koios-only off.
- Each has its own `PoolDiscovery`, read through `serviceDeps(...).pools`.

Steps:
1. Both devices read pools with an empty list. Koios gets nothing.
2. The list gains the started pool. Five minutes on, the starter reads.
3. Three minutes after that, the other device reads.
4. The assertion would hold if the finding were false: the starter names its own launch to Koios zero times.

**HEAD: fails.**
- `{"at":1800000300000,"device":"starter","host":"preprod.koios.rest","path":"tx_info","body":{"_tx_hashes":["7f767b3e…15e4"],"_inputs":true,…,"_certs":true,…}}`
- Data layer calls: `["lovejoin/pools","lovejoin/pools","lovejoin/pools"]`.
- The other device's request, 3 minutes later, has the same path and body. Only the time and the IP differ.

**Mutation, in a copy under `scratchpad/review/v-pr336-3-trace/`:** `refresh` back to `await this.keep(network, found)` (pre-#336). The test passes, and both devices' Koios logs are `[]`.

## Narrower than it reads, in two places

- **"Likely first" depends on the population.** Every active 1.7.0 device sends the identical request within about 5 minutes of the listing. So the tell is strong only while few devices are active in Lovejoin. Still real today, and Seedelf Wallet's distinctive `tx_info` body lets Koios pick these requests out.
- **"The same timing on the Koios path since 1.6.0" adds nothing on the full Koios path.** On preprod, with Koios-only, or with our server wholly down, Koios already gets the launch's submit, Send's `account_info` and the `tx_status` checks from that IP, which the policy covers. Only a partial outage (private part down, submit and public up) gives the 1.6.0 holder look the same tell. #336's data-layer path is the new, default-mainnet case.
- The harm on mainnet with our server up: Koios had nothing of the launcher before. Now it can guess that IP ↔ this pool's start, and through the launch, ↔ the private UTxOs it spent and its change register.

## Fix advice

- **Minimum (no code):** amend the unreleased 28 October entry and `:46`'s "Starting a pool" sentence.
  - Suggested words: "once our server lists the pool, your device's check of it with Koios comes from your IP address, likely before other wallets', so Koios can guess you started it".
  - Fix privacy.md `:200` and `:203` to match.
- **Owner's call: skip the check for the device's own launch.** Discovery would need a dep that reads the sealed launch record (by launch tx and pool id), wired in `sw.ts` from `lovejoin.launches`. While locked it's unreadable, so the check falls back to Koios. Caveats:
  - (a) That pool's on-chain status becomes our server's word again, the very thing #336 removed (low harm: a Bootstrap into a pool that isn't there is refused by the ledger, but the read set keeps it).
  - (b) It makes an absence tell: an IP that asks about every new pool but never this one. That's weaker (it needs a stable IP and history), but not none.
  - (c) After a restore the record is gone, and the device asks like any other.
  - So document it in either case.
