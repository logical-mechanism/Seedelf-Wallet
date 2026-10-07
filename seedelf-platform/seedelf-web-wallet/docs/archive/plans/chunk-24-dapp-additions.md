# Chunk 24 · dApp additions: more DEXes through Minswap's router

Branch `web-wallet/dapp-additions`, from `main`. **One long branch for all of it** (the owner, 2026-10-06), with a PR at the end.

**Status: built and run live (2026-10-06 and 07).** SundaeSwap V3 and Danogo are routed, routes are direct, and Stop cancels every order itself. The owner ran every DEX the wallet routes on mainnet but Splash and Spectrum, and two Stops there cancelled, and the stuck preprod V3 order cancelled live ([*Mainnet runs*](#mainnet-runs-the-pairs-2026-10-07), [Step 3](#step-3--stops-own-cancel-2026-10-07)). It goes out in 1.3.0 (the owner, 2026-10-07). What's still open is in [post-release-roadmap.md](../../post-release-roadmap.md)'s *Owed* (O2, O4) and *Kept in mind*.

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
  - No aggregator takes a receiver or receiver datum, so A2 ([O4](../../post-release-roadmap.md#owed)) needs DEX-specific builders. That's not this chunk.
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

The session refuses all of it today. Chunk 15b listed what allowing it takes ([archive](chunk-15b-swap-runner.md)). To be designed in detail from **a real Minswap-built Danogo transaction recorded first** (mainnet, read from chain):

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
   - `SundaeSwapV4`: **when Minswap routes it** (the owner, 2026-10-07). On 2026-10-07 Minswap's router didn't name it on either network. Sundae's SDK 3.0.0 builds its orders: `owner` and a `destination` as V3's, plus a service budget (3 ₳), partial fills (`max_per_execution`) and its batcher's own two-pool routes. Partial fills need the runner to follow an order a fill leaves behind; a two-pool route meets the one-leg rule. Its contracts are private, and no audit is published.
   - `VyFinance`: its owner is a 56-byte field (payment key hash ‖ stake key hash), the datum travels by hash, and it uses 313 enterprise order scripts.
   - `SundaeSwapStable`, once a Minswap-built order is seen.
   - `CswapV1`: closed source, pinned staking part `ec39fae0…`.

## Start here

- [x] Branch `web-wallet/dapp-additions` from `main`.
- [x] Step 0: SplashStable out.
- [x] Foundation 1 (Sundae V3): route rule, `checkOrder`, the stake-signed cancel, tests.
- [x] Foundation 2 (Danogo): a real transaction read, the checks, the runner's fill, tests.
- [x] SundaeSwap V3's swap part: routed on mainnet, both networks pinned, the docs. **Owner: its live runs** (below).
- [x] Danogo's swap part: routed on both networks, the swap page's words, the docs. **Owner: its live runs** (below).
- [x] The multi-hop question: routes are direct, asked so explicitly, with any longer path refused. The Danogo approval's cost rows: checked and fixed (below, *Direct routes and Danogo's costs*).
- [x] [flows.md](../../flows.md), [privacy.md](../../privacy.md) and [architecture.md](../../architecture.md) where a DEX is named or routing is described: the last "orders only" (flows.md's quote) is gone.
- [x] **Step 3: Stop's own cancel** (below), built and tested 2026-10-07. The stuck preprod V3 order cancelled live and its money came back, and two Stops on mainnet cancelled (the owner, 2026-10-07).
- [x] WingRiders' smoke test and the owner's live runs: on mainnet, 2026-10-07 (*Mainnet runs*, below).
- [x] At the end: the post-release roadmap, the handoff note, and this plan to the archive.

## Mainnet runs: the pairs (2026-10-07)

The DEX runs are mainnet's: preprod's pools route almost nothing the wallet can buy. Minswap's mainnet estimate, asked as the wallet asks it (its exclusions, `allow_multi_hops: false`), routed each of these through one DEX alone, every token on the wallet's list. A route moves with the pools: the approval names the DEX to check before approving.

| DEX | Pair | Notes |
|---|---|---|
| SundaeSwap V3 | 20 ₳ → SUNDAE, then SUNDAE → ₳ | 0.3% impact each way; INDY too |
| Danogo | 20 ₳ → NIGHT, then NIGHT → ₳ | 0.3–0.4%; USDM both ways, and USDM ↔ USDA, too |
| Minswap V2 | 20 ₳ → NTX, then NTX → ₳ | 0.3%; HOSKY too |
| Minswap (V1) | 20 ₳ → MIN | Plutus V1: the order's script and datum go in its cancel |
| SundaeSwap (V1) | MIN → ₳ (3,294 MIN) | Plutus V1; 3% impact |
| WingRiders V2 | 50 ₳ → USDA, IAG or COPI | at 20 ₳, IAG goes through SundaeSwap V3 |
| WingRiders (V1) | 50 ₳ → LQ | Plutus V1; at 20 ₳ it goes through SundaeSwap V3 |
| MinswapStable | USDM → DJED, DJED → iUSD, iUSD → USDM (12 each) | |
| WingRiders StableV2 | iUSD → DJED (12) | 0.06% |
| Spectrum | IAG → ₳ (5.9%), ₳ → iBTC (33%) | only at a bad price: skip |
| Splash | none found | its cancel is tested in Rust only |

Minswap charges its aggregator fee (0.85 ₳; 1 ₳ for a stablecoin pair) on every route but its own pools.

**Run (the owner, 2026-10-07): "everything works."** Every pair above but Spectrum's and Splash's, on a mainnet test wallet: each order placed, filled and its money back, Danogo's filled in the swap itself; and a Stop on an NTX swap (Minswap V2) and a MIN one (Minswap V1), each cancelled before its fill and the money back. The MIN one is the first live Plutus V1 cancel: the order's script and datum in the transaction, and its script data hash `with_integrity`'s, which the node took. With the WingRiders runs, that's the smoke test. Splash and Spectrum stay open ([O2](../../post-release-roadmap.md#owed)).

## Step 3 · Stop's own cancel (2026-10-07)

**Why.** The owner's preprod Stop of a SundaeSwap V3 order (`70773ee9…#0`, 14 USDR) never cancelled it:

- **Minswap's `POST /aggregator/cancel-tx` answers 404, "Route … not found", on mainnet and preprod.** Its documentation still lists it. `build-tx`, `pending-orders` and `finalize-and-submit-tx` still answer. That's what the research's probes saw; the owner has seen 1.2.0's Stop cancel some orders through it and not others (2026-10-07), so released wallets' Stop is partly broken, not wholly.
- **Minswap's `pending-orders` doesn't list every order.** On preprod it lists nothing for that session; on mainnet it listed one of two V3 orders Minswap built.
- **The page said nothing.** Stopped, with no order listed and nothing arrived, the runner returned before noting the order open, so the swap sat on "cancelling".
- Minswap's own app still cancels, through a route the wallet doesn't know (37 "Minswap: Aggregator Cancel Order" transactions at Splash's script in the week to 2026-10-07).

**The owner's call (2026-10-07):** Stop must bring the money back. "No one is going to take a wallet seriously that gets the funds effectively stuck." So the wallet builds every cancel itself, from the session's own keys and collateral, and asks Minswap for nothing to get money back.

**What every DEX's cancel needs** (four research passes, 2026-10-07: real owner cancels decoded from chain, checked against each DEX's source or bytecode; the SundaeSwap V3 cancel of the stuck order dry-run through Ogmios):

| Minswap's name | Order script, Plutus | Script | Cancel redeemer | Signer | Notes |
|---|---|---|---|---|---|
| `Minswap` (V1) | `a65ca58a…`, V1, both networks | in the transaction (335 B) | `d87a80` | the datum's sender's payment key | datum by hash: the original bytes go in the witness set |
| `MinswapV2` | mainnet `c3e28c36…`, preprod `da952546…1b7a`; V2 | reference | `d87a80` | `canceller = OAMSignature(payment key)`, field 0 | the order's own staking part is the sender's |
| `MinswapStable` | one per pool: 13 mainnet, 3 preprod; V2 | reference, per pool | `d87a80` | the sender's payment key, field 0 | Minswap's SDK lists the wrong reference for 4 mainnet pools; the table has the on-chain ones |
| `SundaeSwap` (V1) | `ba158766…`, V1, mainnet | in the transaction (2,121 B) | `d87a80` | the destination's payment key (`alternate` unset) | datum by hash; closed source, the rule found by Ogmios dry runs |
| `SundaeSwapV3` | mainnet `fa6a58bb…`, preprod `a989aa2f…`; **V2** | reference | `d87a80` | `owner = Signature(stake key)`: **2/i** | mainnet's reference sits at Sundae's own key |
| `SundaeSwapStable` | mainnet `6ab62945…`, preprod `eff5be0d…`; V3 | reference | `d87a80` | as V3 | not routed on mainnet; preprod has no scooper |
| `WingRiders` (V1) | `86ae9eeb…`, V1, mainnet | in the transaction (883 B) | `d87a80` | the owner's payment key | datum by hash; Minswap's orders expire in about 8 h, then only the owner can reclaim |
| `WingRidersV2`, `WingRidersStableV2` | mainnet `c134d839…`, `23680ea6…`; preprod `c25f7962…`, `acefcfe8…`; V2 | reference | `d87a80` | the owner's payment key, field 2 | references held by a script that can never spend them |
| `Splash`, `Spectrum` | both `464eeee8…` (Splash's limit order), V2, mainnet | reference | **`d87980`** | `cancellation_pkh` (field 10), the payment key | **output 0 must be the exact refund to the order's redeemer address: one order a transaction.** Partial fills recreate the order at a new outpoint. |

- No cancel needs a validity interval, a withdrawal or a mint. Every key that signs must be a required signer (body key 14): the scripts read it there.
- The full table, with each reference UTxO, is `seedelf-core/src/orders.json`. Every reference was checked on chain on 2026-10-07: unspent, holding a script of the expected hash. The three V1 scripts are bundled, checked by hash.
- **A Plutus V1 script** goes in the transaction, with its order's original datum bytes. One cancel transaction takes one Plutus version (Pallas stages one language view), and a V1 one carries no reference inputs and no inline datums.
- **What Minswap's own cancel does that the wallet's can't:** it refunds Minswap's aggregator fee too, signed by Minswap's key. The wallet's cancel leaves that fee with Minswap.

**The design.**

1. **The cost models.** `ProtocolParameters` carries Plutus V1 and V2's too, and the local evaluator (`eval.rs`) takes all three.
2. **The table and the readers** (`seedelf-core` `orders.rs`): for an order output, which DEX's it is, who must sign its cancel, and where it pays, read exactly from each DEX's datum.
3. **The builder** (`cancel_orders`): one group of orders (one Plutus version; a Splash order alone), the session's own UTxOs for the fee, the session's collateral with its return, every signer a required signer, the scripts by reference (V1's in the transaction), budgets measured in the wallet, the fee settled. Everything goes back to the session, a Splash order's exact refund first.
4. **WebAssembly:** `read_dex_order` and `build_order_cancel`.
5. **The order check** (`checkOrder`): every order sits at a script the table knows, owned by the session's own key, paying the session's address. Anything else is refused before it's signed. **So every order the wallet places is one it can cancel itself.**
6. **Stop:** the orders to cancel are the swap's recorded ones that are still unspent, and any order under the session's stake key (a partial fill's), from Koios, never Minswap's list. One group a transaction, then the return. A swap waiting on an order it can't cancel says so.
7. **Tests:** for each DEX, a real order cancelled through its real script in the local evaluator, and refused with the wrong key.
8. **Live:** the stuck preprod V3 order first; then a preprod Minswap V1 order (tADA→MIN, the only preprod pair the wallet can buy that routes to a batcher that fills: tADA→tUSDM has no route, 2026-10-07), stopped before its fill; then the owner's mainnet runs, Minswap V2's cancel among them.

**Built (2026-10-07).**

- **seedelf-core** `orders.rs` and `orders.json`: the table, each DEX's reader (`read`, `read_order`, `Session::owns`), and `cancel_orders`. `ProtocolParameters` carries the V1 and V2 cost models (empty when Koios leaves them out), and `eval::evaluate_with` measures any Plutus version; `resolve_reference` hands it a reference script.
- **A bug in Pallas, worked around:** `pallas-txbuilder` hashes witness datums as a plain list but writes them as a tagged set, so a cancel carrying a datum (any Plutus V1 order's) would be refused at submit. `with_integrity` recomputes the script data hash from the transaction's own witness bytes (`integrity_hash`, V1's legacy language view included).
- **WebAssembly:** `readDexOrder` and `buildOrderCancel`.
- **The worker:**
  - `checkOrder` asks `readDexOrder`; any contract the table doesn't hold is refused (`sess.refuse.warn.notCancellable`).
  - `liveOrders` replaces Minswap's `pending-orders` everywhere: Stop, the runner's wait, the close, the manual return and Bring everything back.
  - `cancel` and the manual `cancelBuild` build the wallet's own cancel (`cancelOf`), checked by `inspect` as before; the stake key signs only where a spent order is SundaeSwap V3's or Stableswaps', as `readDexOrder` says.
  - The client lost `pendingOrders` and `cancelTx`; Koios's gained `datumInfo` and `addressUtxos`.
- **The "Order open" state** now means an order Koios can't find yet; its two lines say so (`swaps.now.orderOpen`, `swaps.step.openAtDex`, `mtpe`). A 1.2.0 record that says it is cleared at its next run, and the order cancelled.
- **Strings:** `sess.refuse.warn.notCancellable` and `sess.refuse.warn.noCollateral`, back-translated blind twice; the first pass changed the Japanese "can't cancel" (the wallet read as placing the order) and the Spanish "no collateral" (it lost the ADA-only UTxO).
- **Tests:**
  - Rust (`seedelf-core/tests/orders_test.rs`, 7): for each DEX (Minswap V1, V2 on both networks, Stable; SundaeSwap V1, V3 on both networks, Stableswaps; WingRiders V1, V2 on both networks, StableV2; Splash), a real order from chain cancelled through its real script in the wallet's evaluator, and refused by that script without the canceller's signature; the script data hash recomputed for real V1, V2 and V3 cancels from chain, and matched by every cancel the wallet builds; the owner's stuck order cancelled with exactly the budget every real single-key V3 cancel used. Mutation-checked: without the integrity patch, the V1 cancel's hash is wrong.
  - The preprod MinswapV2 fixture is synthetic in one way: the real order's owner had an enterprise address, which no session has, so its two receivers were given a staking part. The script reads only the canceller.
  - Vitest 1,755 on both builds; Playwright 80. The swap tests now drive the wallet's own cancel through the worker: a Minswap V1 order (the fixtures' order moved to Minswap V1's real script) and a SundaeSwap V3 order with Sundae's real reference script, signed by both keys.
- **Not tested in the worker:** a Splash order's partial fill (`liveOrders`' `address_utxos` look). Splash is mainnet only, and the worker's tests run on preprod. The Rust side cancels a real Splash order.
- **Live (the owner, 2026-10-07):** the stuck preprod V3 order (`70773ee9…#0`, 14 USDR) cancelled at Refresh, and its money came back: the first cancel the wallet built itself, through a reference script, signed by both keys.
- **Released wallets** (1.2.0 and before) still ask Minswap's `cancel-tx`, which cancels some orders and not others (the owner, 2026-10-07). This is the fix; when it ships is the owner's call.

## Built (2026-10-06)

Committed and pushed: the foundation (7886971), SundaeSwap V3's swap part (29777c2), Danogo's (04d0022), and *Direct routes and Danogo's costs* (below, 00fde82).

- **Mainnet routing:** SplashStable out. SundaeSwap V3 and Danogo went on in their own swap parts (below).
- **Tests:**
  - The suites: Vitest 1,756 on both builds; Playwright 80 on the built `dist/`.
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
  - [architecture.md](../../architecture.md)'s session section: what it signs, `checkOrder`, routing.
  - [flows.md](../../flows.md)'s Stop.
  - [privacy.md](../../privacy.md)'s session stake key: the cancel's signature shows nothing new.
- **No screen wording changed.** None promises that an order expires. "The order is waiting for a DEX's batcher to fill it. If it doesn't, cancel it." fits V3.
- **Owner: the live runs.**
  - **Preprod's V3 pools quote, but nothing fills them** (read from preprod's chain, 2026-10-07). Since about 2026-09-10 every spend of a V3 order there has been its owner's cancel, and 93 orders sit open. Minswap's preprod router sends tADA→USDRF, tADA→USDCx (policy `31dde3db…`) and tADA→PPEE through `SundaeSwapV3` alone, at 10, 50 and 200 tADA.
  - **The wallet can't buy any of those three on preprod**: it swaps only into tADA, a token on its own list (preprod's holds tUSDM and MIN, neither routed through V3) or one Minswap verifies (on preprod, only MIN). Selling into tADA needs no verification: USDR (`f0f202a8…55534472`), USDRF and PPEE all sell to tADA through `SundaeSwapV3` alone, at 1 to 20.
  1. On preprod, the Stop run, with USDR:
     - From another preprod wallet (Eternl or Lace) on Minswap's preprod site, swap about 10 tADA for USDR. It routes through Minswap V2, whose preprod batcher filled orders on 2026-10-07.
     - Send the USDR to the public account, then Make private.
     - Swap 1–5 USDR for tADA: the route says SundaeSwapV3. It places and waits. Stop: the cancel is signed by both keys, lands, and everything comes back.
  2. On mainnet, the fill: one small swap whose fresh quote shows SundaeSwapV3 in its route (it depends on the pair and amount). It should place, fill and come back.

**Danogo's swap part (2026-10-06).**

- **Routed on both networks:** `DanogoCLMMV1` is on `MAINNET_PROTOCOLS`, off `DIRECT_PROTOCOLS`. Chakra's bonding curve and Djed's minting stay out.
- **The flag:** the quote and the session's view carry `againstPools` (`SwapQuote`, `SessionAuto`). The recorded swap's flag was renamed `againstPools` too, as `auto.direct` already means a return that skips Lovejoin.
- **The swap page:**
  - The approval's plan and the timeline say **Swapped against the DEX's pools** for the order step.
  - The fill step reads **In the swap itself: no order to wait for**.
  - The row's line says **Swapping** while it's on its way.
  - **No Stop once it has gone out.** There's no order to cancel, and the dialog would speak of one. A copy the network refuses (its pool taken first) is dropped from the view, and Stop is back while it's built again.
  - Three new strings, `mtpe`; not critical.
- **The docs:**
  - [architecture.md](../../architecture.md): routing and `MAINNET_PROTOCOLS`.
  - [flows.md](../../flows.md): the swap's run.
  - [privacy.md](../../privacy.md): Minswap's collateral in the transaction ties it to Minswap's aggregator, which its note already does, and to nothing of the user's.
  - No privacy-policy entry: no new service is asked, and nothing new is sent.
- **Owner: the live runs.**
  - On preprod (2026-10-07), in two swaps:
    1. tADA→MIN first: 10 tADA buys about 900 MIN through Minswap's own V1 pool, an ordinary order. Minswap's preprod batcher filled every V1 order on 2026-09-25 within about a minute.
    2. Then MIN→tADA through Danogo: 10–50 MIN goes through one Danogo pool, 100–200 MIN through two, 400 or more through four. Start with one pool. Preprod's prices make no sense (50 MIN quotes about 38 tADA); ignore them.
    - Danogo's preprod pools once failed Minswap's own evaluation, and the next build was clean.
  - Then one small mainnet swap whose quote shows DanogoCLMMV1. ADA→USDCx at 1,000 ₳ went through Danogo alone in the research.
  - Watch for:
    - the timeline's words;
    - no Stop after the send;
    - the swap landing as **Filled** with no wait;
    - everything coming back;
    - the swap transaction's real fee beside the review's "about 0.75 ₳" (*Direct routes and Danogo's costs*, below).

**Wording outside the swap page:** checked. Two lines on the approval were wrong for a pool swap, and are fixed:

- the warning that the wallet relies on Minswap for the minimum is hidden, since the wallet checks it itself;
- "Stop works until the order fills" reads "until the swap goes out" (`swaps.review.approvesPools`).

**Direct routes and Danogo's costs (2026-10-06).**

- **The multi-hop question, answered: the wallet's routes never had a second leg.**
  - Minswap's `estimate` and `build-tx` route through more than one pool only when asked with `allow_multi_hops: true`, which the wallet never sent. Its documentation gives no default.
  - Seen on both networks. Mainnet NIGHT→STRIKE has no direct pool: no route without the flag, MinswapV2→MinswapV2 with it. Mainnet 200,000 MIN→iUSD: one pool without it, two with it.
  - Excluding Minswap's own pools (`exclude_protocols: ["MinswapV2"]`) is ignored, with no error.
- **Now asked explicitly** (`routed` in `minswap.ts`: `allow_multi_hops: false`, in every estimate and build), so it doesn't rest on a default nobody wrote down.
- **The route rule widened from V3 to every DEX** (`outOfPlace`): any DEX in a path of more than one leg is asked for again without, and refused at the quote and before the order if Minswap still routes so, on either network. It reuses the existing "routes this swap through …" refusal, so no new strings. `ONE_LEG_ONLY` is gone.
- **What it costs:** some pairs quote worse. 200,000 MIN→iUSD quoted 379 iUSD through the one pool and 766 through two. That was already so; turning multi-hop on would need its own research: each later leg's order, who owns it, and whether the session could cancel it, Minswap's adapter `0e56d46a…` included.
- **The Danogo approval's cost rows, checked** against Minswap's estimates (mainnet ADA→USDCx, USDCx→ADA; preprod MIN→ADA) and over the e2e fakes at 360×640:
  - **DEX fee:** 0.1 ₳ a pool, as Minswap's estimate says. Fine.
  - **Order deposit:** 0, and the row spoke of an order. Now hidden when it's 0, in the quote's details and the funding's parts, as Minswap's fee row already was. The parts still add up: the room shows the 2 ₳.
  - **Network fees:** the note priced the swap's transaction as an order's, about 0.25 ₳. A swap against Danogo's pools runs their scripts: 0.48 ₳ for one pool to 0.92 ₳ for four, in six swaps Minswap built on mainnet, and 0.64 ₳ in a preprod build. Now about 0.75 ₳ (`POOL_SWAP_FEE_ESTIMATE` in `ui/swap.ts`), and the note says "about 0.75 ₳ for the swap against the DEX's pools and 0.25 ₳ for the return". Two new strings, `mtpe`; not critical.
- **Tests:** `tests/swap-routes.test.ts` (both routing rules), `tests/swap-form.test.ts` and `tests/screens.test.ts` (the cost rows). The routing rules and the hidden deposit row were each mutation-checked.
- **A flake, not chased:** one run of the preprod-only Vitest build failed one test, unnamed; three reruns passed in full.
- **For the owner's preprod runs:** preprod leaves out fewer DEXes than mainnet, as only the check stands there. Preprod USDCx→USDRF routes through SundaeSwapStable, whose orders the check doesn't read, so that pair may pause after funding (Stop brings it back). The live runs above don't use it.
