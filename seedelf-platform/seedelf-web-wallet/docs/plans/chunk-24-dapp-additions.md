# Chunk 24 · dApp additions: more DEXes through Minswap's router

Branch `web-wallet/dapp-additions`, from `main`. **One long branch for all of it** (the owner, 2026-10-06), with a PR at the end.

## The owner's calls (2026-10-06)

- **DEXes, not lenders.** Lending is low priority; Djed is "a cool idea that doesn't really work" for how stablecoins are used. The dApps page stays swaps and the mixer, with lenders maybe later.
- **Through Minswap's router.** The swap screen already tries many paths: Minswap's aggregator splits a swap across DEXes and picks the best route. The work is to let more of the high-volume DEXes into that routing, on top of the private session flow that already exists.
- **Foundation first, then the swap parts.** First build what the session's checks are missing. Then turn each DEX on in routing and run its live swap.
- **SundaeSwap first, then Dano (Danogo).** WingRiders is already in: V1, V2 and StableV2 are on `MAINNET_PROTOCOLS`, and the research confirmed their orders read the way `checkOrder` expects. All it lacks is the live smoke test.

## What the research found (2026-10-06)

Checked against live chain data, APIs and repos.

- **Aggregators.** Minswap stays the only one.
  - Minswap was within 0.12% of the best quote at 500 ADA or more.
  - Steelswap's CORS refuses `chrome-extension://` origins, and it has no preprod.
  - DexHunter costs 0.25% plus 2–5 ₳, and makes the stake key a required signer.
  - No aggregator takes a receiver or receiver datum, so A2 ([O4](../post-release-roadmap.md#owed)) needs DEX-specific builders. That's not this chunk.
- **Volume.**
  - DefiLlama's "SundaeSwap V2" is Sundae's V1 contracts. Its $47M a month is Sundae's self-reported total across all versions. Pool-script transactions over a week: V3 ~3,480, Stableswaps 445, V4 237, V1 177.
  - "Dano Finance" is Danogo. Its TVL counts lending too; the concentrated-liquidity DEX (CLMM) holds about 2.87M ₳ on the ADA side.
- **Splash's stable pool validator was drained on 2026-09-13.** Its README now says DO NOT USE, and its three pools hold ≤70 ₳. `SplashStable` comes off `MAINNET_PROTOCOLS` (step 0).

## Step 0 · SplashStable out

Remove `SplashStable` from `MAINNET_PROTOCOLS` so mainnet routing leaves it out (`excludedProtocols`). Preprod already leaves it out (`PREPROD_BROKEN`).

## Foundation 1 · SundaeSwap V3 orders

**What Minswap builds.** Seen on chain, 25 open orders at V3's order script, 2026-10-06:

- **Single-hop.** The order sits at script `fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077` under Minswap's fixed staking part `f217f435f5f34dba69830d9ada013b5c290a4eee6078371cae55298b`. The same staking part is used for every sender and is unregistered.
  - Its inline datum is `[pool_ident?, owner, max_protocol_fee, destination, details, extension]`.
  - `owner = Signature(sender's stake key hash)`.
  - `destination = Fixed{sender's base address, NoDatum}`.
- **Multi-hop.**
  - When V3 is the first leg, the destination is Minswap's adapter script `0e56d46a…` with a datum hash, and the owner is one key shared by every such order (`cc7dfaef…`, Minswap's). **The session could never cancel it.**
  - One order chained into a Minswap V2 order: destination `c3e28c36…` with an inline datum, owner the sender's stake key.
- **The V3 contract, audited by TxPipe.**
  - Nothing checks an order when it's placed, and the pool doesn't check the order's address.
  - The scoop pays `destination` exactly.
  - Cancelling needs `owner`'s multisig to be satisfied, which here is the stake key's signature.
  - **V3 orders never expire.**
- **Stableswaps** (order script `6ab62945d0d8d6288e243b3b6437ff9c099a38e088288f5a6b7c5e8b`) uses the same datum layout. No Minswap-built one was found, so `SundaeSwapStable` stays out until one is seen.

**What the foundation adds:**

1. **The route rule.** V3 only as a path of its own, one leg. A path where `SundaeSwapV3` sits beside another leg is refused at the quote, and again when the order is placed, the same way an unchecked DEX is (`uncheckedProtocols`).
2. **`checkOrder` reads a V3 order exactly.** An output at the V3 order script counts as the session's order only if all of these hold:
   - It sits under the session's staking part, none, or Minswap's pinned `f217f435…`. That pinned part is accepted at this script alone.
   - Its datum's `owner` is `Signature` of the session's stake key hash.
   - Its `destination` is `Fixed{the session's address, NoDatum}`.
   Anything else at that script is refused, whatever `names` would say.
3. **Stop's cancel may be signed by the session's stake key too.** Only when the cancel spends a V3 order (an input at the V3 order script) and the session has its own stake key (`ownStake`). Otherwise `0/i` alone, as now. Everything else `refuseOddities` refuses still stands: certificates, withdrawals, votes, mints, other people's signatures. So a stake signature only meets a required signer.
   - `inspectSessionTx` already names the stake key as a signer when a required signer is its hash.
   - `signSessionTx` already signs with `2/i` (`stakeIndex`).
   - So no Rust change.
4. **A session from before `ownStake`** carries the shared Seedelf stake key, which is never signed with. A V3 order for such a session is refused.

## Foundation 2 · Direct swaps (Danogo CLMM)

Danogo has no order: Minswap's transaction swaps against its pools in the same transaction. On preprod in chunk 15b that meant:

- four pool UTxOs and their scripts;
- six reference inputs;
- a zero-ADA withdrawal from a script;
- 3 ₳ of someone else's collateral, signed by its owner already.

The session refuses all of it today. Chunk 15b listed what allowing it takes ([archive](../archive/plans/chunk-15b-swap-runner.md)). To be designed in detail from **a real Minswap-built Danogo transaction recorded first** (mainnet, read from chain):

- **Foreign script inputs**, accepted only at Danogo's pool script, pinned (mainnet `d8b69fc5…`, to be confirmed from the recorded transaction). Reference inputs are fine.
- **The zero-ADA withdrawal**, from Danogo's pinned script only.
- **The collateral**, someone else's and already witnessed. The session never puts up collateral of its own here.
- **A net-change limit** in place of `withinFunding`'s paid-out sum:
  - what leaves the session's UTxOs is no more than was funded;
  - what comes back to the session's address includes at least the approved minimum of the token bought.
- **Filled in the swap itself.** There's no order to wait for. Once the swap transaction lands, the runner goes straight to the return. Stop has nothing to cancel.
- **A direct swap fails rather than lands badly.** If a pool UTxO was spent first, the transaction is refused at submit. The runner should build it again, not pause.

## The swap parts (after the foundation)

1. `SundaeSwapV3` onto `MAINNET_PROTOCOLS`. **Owner:** one small mainnet swap that routes through it, then a Stop on a second one. Preprod may have no V3 pools.
2. WingRiders' smoke test (owner).
3. `DanogoCLMMV1` routed on mainnet, once Foundation 2 is in. **Owner:** one small swap.
4. Candidates, not committed:
   - `VyFinance`: its owner is a 56-byte field (payment key hash ‖ stake key hash), the datum travels by hash, and it uses 313 enterprise order scripts.
   - `SundaeSwapStable`, once a Minswap-built order is seen.
   - `CswapV1`: closed source, pinned staking part `ec39fae0…`.

## Start here

- [x] Branch `web-wallet/dapp-additions` from `main`.
- [x] Step 0: SplashStable out.
- [x] Foundation 1 (Sundae V3): route rule, `checkOrder`, the stake-signed cancel, tests.
- [x] Foundation 2 (Danogo): a real transaction read, the checks, the runner's fill, tests.
- [x] SundaeSwap V3's swap part: routed on mainnet, both networks pinned, the docs. **Owner: its live runs** (below).
- [ ] Danogo's swap part, and WingRiders' smoke test, with the owner's live runs.
- [ ] At the end: update [flows.md](../flows.md), [privacy.md](../privacy.md) and [architecture.md](../architecture.md) where a DEX is named or routing is described ("orders only"); then the post-release roadmap, the handoff note, and this plan to the archive.

## Built (2026-10-06)

Uncommitted on the branch until the owner says.

- **Mainnet routing:** SplashStable out. `DanogoCLMMV1` stays on `DIRECT_PROTOCOLS` until its swap part. SundaeSwap V3 went on in its own swap part (below).
- **Tests:**
  - The suites: Vitest 1,748 on both builds; Playwright 80 on the built `dist/`.
  - New files: `tests/sundae-orders.test.ts` (11) and `tests/direct-swaps.test.ts` (8).
  - Each new rule was mutation-checked: switched off, it fails the test meant to catch it.
- **Strings:** four new refusals, each back-translated blind (`docs/i18n/verified-critical-*.json`): `sundaeNotOurs`, `sundaeCancelKeys`, `notPool` and `tooLittle`.

**Sundae.**

- **The route rule.**
  - A route that puts V3 in a longer path, or Danogo beside anything else, isn't refused. It's asked for again without that DEX (`routeOf`, `outOfPlace`).
  - `build-tx` gets the same leave-out list (`avoid`), as Minswap routes it again.
  - `uncheckedProtocols` stays as the backstop, on both networks.
- **`checkOrder`** reads a V3 order with `sundaeV3Order`. Minswap's staking part is accepted only at V3's order script.
- **Stop's cancel:** `refuseOddities` takes exactly `["0/i", "stake"]` when the cancel spends an input at V3's order script and the session has `ownStake`. A V3 cancel that the stake key wouldn't sign is refused, since it couldn't work.

**Danogo.**

- **What Minswap's `build-tx` returns** (preprod, 2026-10-06):
  - It comes signed already by the collateral's owner (Minswap's 3 ₳ UTxO), and `attachWitnesses` keeps that signature.
  - Preprod's pool script is `04041c3c…`.
  - Each spent pool sits under its own staking script, and the swap withdraws zero from that script and from the pool script.
  - On the first try, Minswap's own evaluation crashed at `Withdraw[0]`; the second try built cleanly. Preprod's pools may be flaky.
- **A swap that spends anything not the session's is a direct one** (`inspect`). These all must hold:
  - `directSpends`: inputs only at `DANOGO_POOL[network]`; collateral only a key's UTxO whose signature `witnessedKeys` finds in the transaction; withdrawals only zero, from the pool script or a spent pool's staking script.
  - Signed with `partialSign`. `refuseOddities` lets `othersSign` be exactly the collateral owners counted.
  - `checkDirect`: outputs only to the session, to the pools, and at most one Minswap fee.
  - `checkProceeds`: the session's net gain of the token bought is at least the approved minimum. Bought ADA counts with the fee and Minswap's fee added back.
  - `withinNet`, in place of `withinFunding`: the session's net spend is within its funding.
- **Recording and the fill.**
  - The swap is recorded `direct`, with `orders: []`.
  - `act` counts it as filled once it lands, and brings everything back. Its proceeds are in its own transaction, which the order path would never count as arrived.
  - A pool UTxO spent before the swap lands gets the swap refused at submit. It's marked unsent and rebuilt after `RESEND_AFTER_MS`, as any refused step is.

**SundaeSwap V3's swap part (2026-10-06).**

- **Routed on mainnet:** `SundaeSwapV3` is on `MAINNET_PROTOCOLS`, off `MAINNET_REFUSED`.
- **Pinned by network** (`SUNDAE_V3`), each read from a build Minswap made:
  - mainnet: order script `fa6a58…`, Minswap's staking part `f217f435…`;
  - preprod: order script `a989aa2f…`, Minswap's staking part `c41401cd…`.
  - `checkOrder` takes the network from the session address's header.
- **The docs:**
  - [architecture.md](../architecture.md)'s session section: what it signs, `checkOrder`, routing.
  - [flows.md](../flows.md)'s Stop.
  - [privacy.md](../privacy.md)'s session stake key: the cancel's signature shows nothing new.
- **No screen wording changed.** None promises that an order expires. "The order is waiting for a DEX's batcher to fill it. If it doesn't, cancel it." fits V3.
- **Owner: the live runs.** Preprod has V3 pools: Minswap's preprod aggregator routed ADA→USDRF through `SundaeSwapV3` alone on 2026-10-06.
  1. A small ADA→USDRF swap: it should quote with route SundaeSwapV3, place, fill and come back.
  2. A second one, stopped while its order waits: the cancel is signed by both keys, lands, and everything comes back.
  3. Then one small mainnet swap through V3. The fresh quote must show SundaeSwapV3 in its route; it depends on the pair and amount.

**Not done, for the swap parts.**

- **The swap page's timeline** for a direct swap. Between its send and its landing, the step is "ordering". Check what it says: it must not talk of an order or a batcher.
- **Settings' and the quote's wording** where they say Minswap places orders.
- **The docs for Danogo**, when it's routed. architecture.md describes its checks as built and not routed.
- **A question for the owner, found on the way:** any multi-hop route places its second leg's order from the first leg's batcher, so the session's check never sees it. If that order sat unfilled, could the session cancel it? This applies to the DEXes already on `MAINNET_PROTOCOLS`, not just V3. Worth a look at a real Minswap multi-hop order before launch.
