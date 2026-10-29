# Verify x-priv#1 (label `v-x-priv-1-trace`)

**Finding:** a device that starts a pool is likely the first to ask Koios about that new pool. The new policy entry says the request "names nothing of yours".

**Verdict:** confirmed. **Severity:** low. It's a timing tell to a third party that the policy and privacy.md don't cover. The fix is the owner's call. (Same ground as pr336 F4, which `v-pr336-3-trace` confirmed separately. I traced it again on my own.)

## What I traced on HEAD (6bca8bec)

1. **Discovery can't tell the wallet's own pool from anyone else's.**
   - `submit` records the start only in the sealed Lovejoin record: `lovejoin-launch.ts:387-398` → `recordLaunch`, `lovejoin.ts:5953-5958`.
   - `PoolDiscovery` is wired with `{ local, wasm, koios, index, now }` (`sw.ts:236`). It has no input for launches.
   - `kept()` reads only `seedelf.lovejoinPools.<network>` and the head start (`lovejoin-pools.ts:348-372`).
   - This is the design: "None is read sooner from the launcher's own record, which would single out the launcher's IP (§3)" (`lovejoin-launch.ts:8-9`; plan `chunk-34-token-pools.md:307-309`).
2. **A new pool on the list goes to Koios, from the user's IP.**
   - `refresh` → `await this.keep(network, await this.confirmed(network, found))` (`lovejoin-pools.ts:454`).
   - `confirmed`: `fresh` = listed pools not yet kept (`:568`) → `this.deps.koios(network).koiosAlone()` (`:570`) → `launched` → `koios.launches([launch tx])` (`:527`).
   - That's a POST to `tx_info` with `_inputs` and `_certs` (`koios.ts:926-946`). On mainnet's `DataLayerKoios`, `koiosAlone()` is plain Koios (`data-layer.ts:213-225`), never our server.
   - Every non-quiet pool read gets there: the hub's `lovejoin-status` → `ours` → `readSet` → `serviceDeps.pools` → `refresh` (`lovejoin-pools.ts:597-601`). So does the page's look (`Lovejoin.tsx:1744` → `lookForPools` → `discovery.look`).
3. **Before #336, this path never asked Koios.**
   - `git diff 473b7f1a^1 473b7f1a`: `refresh` ended `await this.keep(network, found)`.
   - The PR's own test diff turns "Koios wasn't asked anything" (`expect(k.calls).toEqual([])`) into `["tx_info"]`.
   - The start's other requests (epoch params, Send's `account_info`, submit, the pending watch) go to our server first on mainnet.
4. **The starter is told to come back.**
   - `lovejoin.launch.sentNote` (en.json:1386): "It shows under Pools once a look finds it, about 10 minutes after its block".
   - `bootstrapNext` (:1387): "Then you can Bootstrap it from its page".
   - `lovejoin.pools.startedNotFound` (:1277), shown on the hub.
   - The starter needs the pool to show before they can Bootstrap it. Other devices have no reason to look.
5. **When the starter's request goes.**
   - `onSent` → `load()` (`Lovejoin.tsx:1859-1862`) reads the pools at Send. The pool isn't listed yet, and that read starts the 5-minute throttle (`REFRESH_MS`).
   - The data layer lists a pool once its block is under the stable cursor, 200 to 400 slots on (`seedelf-data/api/src/lovejoin/db.rs:343`, `cursor.rs`).
   - So the starter asks Koios at its first non-quiet pool read after the listing, typically 5 to 10 minutes after Send.
   - The throttle lives in memory. An MV3 worker restarted between visits asks at once.
6. **Who else asks.**
   - Only devices on 1.7.0, at a non-quiet pool read. Only the hub calls `lovejoin-status`. Other such reads are builds (`split`/`splitAll`), `poolNamed`, `madeBy`, and `withdrawDueNow`, which reads only with boxes due, or at unlock with something open.
   - So idle devices don't ask, and each device asks once per pool.
   - Whether the starter comes first depends on how many devices are active in Lovejoin in those minutes. Code can't decide that, which is why the finding says "likely". Early in 1.7.0's rollout, fewer devices ask at all.

## Scratch test

`extension/tests/zz-review-v-x-priv-1-trace-1.test.ts`, run alone, then deleted. Setup:
- Two devices, each with its own `PoolDiscovery` wired as `sw.ts` wires it, read through `serviceDeps(...).pools` and `look`.
- One fake data layer whose `lovejoin/pools` lists the pool from minute 5.
- One Koios log across both devices.

Test 1 traces the scenario, and **passes**:
1. The other device reads at t−1 min, and the starter at t0 (Send's `load()`). Koios gets nothing.
2. The starter opens the hub at t+10 min. The other device reads at t+40 min.
3. The `tx_info` calls naming the launch are `[["launcher", 10], ["other", 40]]`.
4. The two requests have identical bodies and queries. Only the time and the IP differ, and nothing else goes to Koios.

Test 2 states the docs' property: the starter's device sends no request naming its own launch. **It fails on HEAD.** It received `{device: "launcher", path: "tx_info", body: {_tx_hashes: ["7f767b3e…15e4"], _inputs: true, _certs: true, …}}`.

## Where the finding is a little off

- **"Likely first" depends on the population.** In code, every active 1.7.0 device sends the same request within about 5 minutes of the listing. The tell weakens as more devices are active. It's real today, and the wallet's distinctive `tx_info` body and `select` let Koios pick these requests out.
- **"The same timing existed only on the Koios holder look (preprod, Koios-only)" leaves out one case.** A partial outage (private index down, submit up) sent mainnet's 1.6.0 holder look to Koios with the same tell, while the submit went through our server. Rare, and it doesn't change the finding: #336 made this the default on mainnet.
- **The docs aren't newly wrong in what they literally say.** On preprod and Koios-only, the holder look's `tx_info` always named the starter's launch, the same for every wallet. What they miss is the order, which matters only where Koios didn't already get the submit: mainnet with our server up.

## The harm

On mainnet with our server up, Koios learned nothing of a start before. Now it can guess that an IP started a pool, and through the start's transaction, tie that IP to the private UTxOs it spent and its change register. That's exactly what starting from the private balance hides on chain. Our server and giveme.my already know, and the policy says so. Koios is the new party.

Text the starter-first case contradicts or doesn't mention:
- policy :93 ("naming nothing of yours")
- policy :46 ("None of that names anything of yours, but one thing")
- privacy.md :200 ("never one of the wallet's")
- privacy.md :203 ("No read names a pool the wallet uses or launched")

## The fix options

- **(a) Disclose.** This is the minimum, and the policy already discloses smaller tells ("tells the Cardano server only that this device saw that pool first"). The 28 October entry hasn't shipped, so amend it in place, along with :46 and privacy.md :200 and :203. For example: "For a pool you started, this device asks too, likely among the first, minutes after its block, so Koios may guess you started it."
- **(b) Skip Koios for the device's own start.** Skip the Koios confirm where the sealed `launches` record has the listed pool's `launch.tx` as its `txHash`.
  - The pool still joins only once the data layer lists it, so `lovejoin-launch.ts:8-9` holds.
  - Discovery needs a lazily wired `launches` callback, because `sw.ts` builds discovery before `LovejoinService`. The record is sealed: while locked, it can't be read, so fall back to asking.
  - The starter then trusts our server for its own pool. The harm is low: a deposit into a pool that isn't there is refused by the ledger.
  - A missing ask is a far weaker tell: it needs Koios to track which IPs ask about every new pool.
  - The finding's suggested test fits this option.
- **(c) A random wait.** Weak. It delays every device's first use and the starter's Bootstrap, and the starter still looks first by motive.
