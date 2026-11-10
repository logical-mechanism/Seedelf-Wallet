# Chunk 47 · Minswap's new routes: SundaeSwap V4, and Dano first

**Status: Part A ✅ built for 1.9.0. Part B ⛔ not built, its gate unmet ([backlog.md](../../backlog.md)).** The owner, 2026-11-09: "write a chunk for the 1.9.0 work for the new stuff", after Minswap announced three additions to its aggregator, then "lets get this setup right and do it right now". Their standing call from 2026-10-07 was to add SundaeSwap V4 "only when Minswap's router handles it": it does now.

Branch `web-wallet/minswap-new-routes` from `main`. [What was built](#what-was-built) is at the end.

## What Minswap added

| Addition | What it is to the wallet |
|---|---|
| SundaeSwap V4 in the aggregator, and cancelling V4 orders from Minswap | **Part A.** The route needs the wallet to read and cancel V4's orders itself. Minswap's cancel is never used: Stop builds every cancel itself ([chunk 24](chunk-24-dapp-additions.md)) |
| A route swaps on Dano first, then places the next hop as an order on another DEX, in one transaction | **Part B.** The wallet asks for direct routes only, and `outOfPlace` refuses a Danogo swap beside anything else |
| Dano trades on Minswap's Orders page | **Nothing.** That's Minswap's site. The wallet finds its orders on chain and never asks Minswap for an account's orders ([keys-and-accounts.md](../../keys-and-accounts.md)) |

**Where it starts from.** The PR that added this plan stopped sending `ChakraBondingCurve`, whose refusal failed every quote, and left `SundaeSwapV4` out of routing on both networks (`excludedProtocols`, `NOT_READ_YET` in `minswap.ts`). `routeOf` now asks once more without a DEX the wallet doesn't check. So V4 stays out until Part A puts it in.

## Part A · SundaeSwap V4

### What's known (all seen 2026-11-09)

| Fact | Where from |
|---|---|
| Minswap's API takes `SundaeSwapV4`, on both networks | Live |
| Mainnet's order script is `07eb2fb09d9dd6603870ce6f84c8f8506249152173ddf0c77f1f07ec` | `api.sundae.fi/graphql`, `protocols`. Its V3 hash there is the one `SUNDAE_V3` pins |
| Its reference is `c1ecddd68eaa61a3fb4c7af2fac6388d7c8fe0065da359943bdfb976e0f4be9a#0`: unspent, Plutus V3, 3,128 bytes, of that hash | Koios `utxo_info` |
| The datum is `[owner, destination, service_budget, max_per_execution, config_token, constraints, extension]`. `owner` is a `MultisigScript`. `destination` is `Fixed { address, datum: Option }` or `Self` | `sundae-sdk`, `Contract.v4.ts` |
| A cancel spends the order with redeemer `Constr 0 []` (as Splash's, where every other DEX's is `Constr 1 []`), by reference script, signed by the owner | `sundae-sdk`, `TxBuilder.V4.class.ts`, `cancel` |
| Six of Minswap's market orders for V4, among the last 30 transactions at the script: under the **sender's own** staking part (header `0x11`), unlike V3's fixed one; owner `Signature` of the **sender's stake key**; five pay `Fixed` to the sender with no datum, and one pays a script with a datum (a chained first leg) | Koios, read from chain |
| In all ten Minswap orders seen, `service_budget` = `max_per_execution` = 1,280,000, and the two constraints are `basic_order.withdraw` (`30f1fac0…`) and `fee_constraint.withdraw` (`267eabb9…`) | Koios, `datum_info` |
| "A basic order settles single-shot to a `Fixed` destination (no partial fills)". V4's default budget, unlike Minswap's, funds a partial fill | `sundae-sdk`, `TxBuilder.V4.class.ts` |
| 1,000+ transactions at the script since 2026-10-09 (one Koios page), two open orders. Minswap's were USDR → USDCx | Koios |
| Sundae's API lists 32 V3 and 18 V1 ADA pools and no V4 one. With V4 allowed, ADA → SUNDAE and ADA → MIN didn't take it | `api.sundae.fi/graphql`, Minswap's `estimate` |

**Not known.** V4's validators aren't public: the SDK cites a `sundae-v4` repository that isn't among SundaeSwap-finance's public ones. Sundae's July announcement said the audit was nearly finished, and no result turned up. Whether preprod has V4 at all.

Two traps. Excluding every DEX but V4 doesn't isolate it: Minswap's own pools came back anyway. And Koios's `tx_info` gave these orders no inline datum bytes, while `datum_info` by the output's hash did.

### Steps

1. ✅ **Pin it.** In `orders.json`, the reference re-checked on chain 2026-11-09. Preprod has none to pin: two stray transactions at Sundae's test deployment's script, last in September, and no reference UTxO. `excludedProtocols("preprod")` keeps the name out (`PREPROD_NOT_PINNED`).
2. ✅ **Read it** (`orders.rs`). `Protocol::SundaeSwapV4`, with the `Constr 0 []` cancel and `signs_with_stake`. Owner is `Signature` of the key, destination `Fixed` with `None`. Any other `MultisigScript`, `Self` or a `Some` datum doesn't read, so the chained first leg is refused here.
3. ✅ **Decide what "one fill" rests on: the order's modules, not its budget.** The reader takes only `basic_order.withdraw` then `fee_constraint.withdraw`, by hash. The SDK says a basic order "settles single-shot". Of the last 350 transactions at the script, 174 were fills and none left an order behind, 33 of those with a budget of 3 ₳ against a 1.28 ₳ cap, so equal budgets would have refused good orders. One order in the sample named another module (`35a9eebb…`): that form doesn't read.
4. ✅ **Route it.** On `MAINNET_PROTOCOLS`. `checkOrder`'s staking rule took the session's own part already, and a session without its own stake key is already refused.
5. ✅ **Check what's automatic.** All of it, through the table. `checkOrderCancels` runs V4's script. `liveOrders` and the restore scan go by `orders.json`, and the data layer names no order script. `withinFunding` holds: Minswap quotes V4 at a 1.28 ₳ fee and a 2 ₳ deposit, the 3.28 ₳ a real order holds (USDCx → USDr, 2026-11-09).
6. ✅ **Test on real orders.** The one owner cancel in the sample was of an order Minswap built (`8dc9ee14…`), now in `order_cancels.json`, so every test over the fixtures runs it: Rust's, and Vitest's through the real runner. Variants for another owner or destination, a chained leg, `Self`, every other `MultisigScript`, another module, a missing or third constraint.
7. ⛔ **Live, for free.** Preprod can't: it has no V4. On mainnet the dry-run cancel is the check, and the first real swaps are the live one: never a test spend on the owner's list.

V4's cancel reads the owner alone: an extra datum field and a budget written as bytes both still cancelled, so nothing else in the datum can stop one.

**Done means:** a mainnet quote can route through V4 on its own, and Stop brings back any V4 order the session placed.

## Part B · Dano first, then an order

### What's known

- `allow_multi_hops` is `false` on every request, and it's tested. `DIRECT_CHECKED` keeps Danogo alone, because "an order beside it would be filled later, under a minimum the check never reads".
- Ordinary multi-hop stays refused: a later leg's order is placed by a batcher, or owned by Minswap's key. **Dano first may differ, since its order is in the transaction the session signs.** That isn't verified: no Dano-first route has been seen yet. With multi-hop allowed on 2026-11-09, 5,000 ₳ → MIN and → SUNDAE came back single-leg, and through neither Dano.
- Multi-hop can pay: 200k MIN → iUSD quoted 766 against 379 direct (2026-10-06), though that wasn't a Dano route.

### Steps

1. ⛔ **The gate: see one.** Find a Dano-first route, with `allow_multi_hops: true` over Danogo's pairs, and read a `build-tx` of it, unsigned. Who owns the order? It must be the session's key, or Stop can't bring it back and **Part B stops there**: say so in the backlog. Does it pay the session, and what's its minimum? **Not seen, 2026-11-09:** six more quotes (USDCx → ADA and SNEK, USDM → ADA and NIGHT, USDA → MIN, ADA → USDCx) came back single-leg, through MinswapV2 twice, or through Danogo twice. None was Dano and then another DEX. So nothing below was built.
2. ⬜ **Ask for it.** A second `estimate` per quote, multi-hop allowed, taken only when it's exactly `[DanogoCLMMV1, X]`, X is a DEX the wallet reads, and it beats the direct route by the margin of question 2.
3. ⬜ **Let the shape through.** `outOfPlace` allows that one shape and nothing else.
4. ⬜ **Check it** (`inspect`). `directSpends` holds. `checkDirect` says "No order" today, and needs the order's outputs. `checkProceeds` doesn't apply, as the proceeds go into the order, so the wallet must **read the order's minimum** itself: new per DEX. Start with one X, whichever step 1 shows most.
5. ⬜ **Run it.** `againstPools` today means filled in the swap itself (`sessions.ts`: `order`, and the Stop and return paths reading `againstPools`). This shape is half that: Stop is possible, and **brings back the middle token, not what was funded**. The return handles that token, through Lovejoin where it can.
6. ⬜ **Say it.** Review shows both legs, keeps the relies-on-Minswap minimum, and says what Stop returns. One short line each. New strings in en, es and ja, critical ones named `.warn.`, back-translated.
7. ⬜ **Test and run it live.** Preprod has Danogo's pools. Live with the dev wallet before reporting, as far as preprod's routes reach.

**Done means:** a route that is Dano then an order goes through when it's better, is checked as tightly as each half is today, and Stop returns what's left.

## Costs and privacy

- **Part A:** no new request. The stake key signing a V4 cancel is what V3's already does (privacy.md).
- **Part B:** one more `estimate` per quote, the same fields to the same service, so no new data. Its privacy notes extend Danogo's in privacy.md: Minswap's collateral and note tie the account to the aggregator, as now. If a build shows anything new reaching Minswap, it needs a dated entry in the privacy policy.

## Not in this chunk

- Ordinary multi-hop, through Minswap's adapter.
- SundaeSwapStable, VyFinance and CswapV1 (backlog).
- A retry when Minswap stops taking a name (backlog).

## For the owner

1. ✅ **A before B?** Yes, and A alone for 1.9.0: B's gate is unmet.
2. ⬜ **How much better must Dano first be?** Open until a route is seen. It costs a second order's fee and the risk of holding the middle token if the order doesn't fill. The suggestion was at least 1% better than direct, and more for small amounts.
3. ✅ **Is V4 worth it yet?** The owner, 2026-11-09: do it now, in 1.9.0. It's in use on stablecoin pairs, and Sundae's list has no V4 ADA pool, so most of the wallet's pairs won't route through it today. Its audit's result is unpublished, where V3 had a published one.

## What was built

Part A, in the PR that archived this plan, for 1.9.0: V4 pinned, read, routed and tested on mainnet, off preprod. Rust's order tests went from 24 to 26 with V4's real order running through every test over the fixtures, and Vitest's real-order list gained it, through the runner.

Left open: V4's first live mainnet swap and Stop (no test spend asked of the owner), and Part B (backlog).
