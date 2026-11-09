# Chunk 47 · Minswap's new routes: SundaeSwap V4, and Dano first

**Status: ⬜ not started.** Planned for 1.9.0. The owner, 2026-11-09: "write a chunk for the 1.9.0 work for the new stuff", after Minswap announced three additions to its aggregator. Their standing call from 2026-10-07 was to add SundaeSwap V4 "only when Minswap's router handles it": it does now.

Branch `web-wallet/minswap-new-routes` from `main`. Parts A and B are independent and can land as separate PRs.

## What Minswap added

| Addition | What it is to the wallet |
|---|---|
| SundaeSwap V4 in the aggregator, and cancelling V4 orders from Minswap | **Part A.** The route needs the wallet to read and cancel V4's orders itself. Minswap's cancel is never used: Stop builds every cancel itself ([chunk 24](../archive/plans/chunk-24-dapp-additions.md)) |
| A route swaps on Dano first, then places the next hop as an order on another DEX, in one transaction | **Part B.** The wallet asks for direct routes only, and `outOfPlace` refuses a Danogo swap beside anything else |
| Dano trades on Minswap's Orders page | **Nothing.** That's Minswap's site. The wallet finds its orders on chain and never asks Minswap for an account's orders ([keys-and-accounts.md](../keys-and-accounts.md)) |

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

1. ⬜ **Pin it.** Add V4 to `seedelf-core`'s `orders.json` with the reference above, re-checked on chain, and preprod's if there is one. `excludedProtocols("preprod")` keeps the name where there's none.
2. ⬜ **Read it** (`orders.rs`). A `Protocol::SundaeSwapV4`, with the `Constr 0 []` cancel and `signs_with_stake`. Owner is `Signature` of the key, destination `Fixed` with `None`. Any other `MultisigScript`, `Self`, or a `Some` datum reads as not the session's. The chained first leg above must be refused here.
3. ⬜ **Decide what "one fill" rests on.** Refuse an order unless `service_budget` equals `max_per_execution`, if a real fill or the script's behaviour confirms that means one execution. If it doesn't, partial fills become work of their own: the runner has never seen one live (backlog, Splash).
4. ⬜ **Route it.** `SundaeSwapV4` onto `MAINNET_PROTOCOLS`, off `NOT_READ_YET` where read. `checkOrder`'s staking rule already takes the session's own part, so V3's Minswap exception isn't needed. A session without its own stake key is already refused.
5. ⬜ **Check what's automatic.** `checkOrderCancels` running V4's script; `liveOrders` and the restore scan finding one through `orders.json`; `withinFunding` with V4's budget held in the order.
6. ⬜ **Test on real orders.** Rust and Vitest fixtures from a real Minswap-built V4 order, as for every routed DEX: the single-order form accepted, the chained form and an owner of another key refused, its cancel run through the script.
7. ⬜ **Live, for free.** On preprod with the dev wallet if V4 is there. On mainnet the dry-run cancel is the check, and the first real swaps are the live one: never a test spend on the owner's list.

**Done means:** a mainnet quote can route through V4 on its own, and Stop brings back any V4 order the session placed.

## Part B · Dano first, then an order

### What's known

- `allow_multi_hops` is `false` on every request, and it's tested. `DIRECT_CHECKED` keeps Danogo alone, because "an order beside it would be filled later, under a minimum the check never reads".
- Ordinary multi-hop stays refused: a later leg's order is placed by a batcher, or owned by Minswap's key. **Dano first may differ, since its order is in the transaction the session signs.** That isn't verified: no Dano-first route has been seen yet. With multi-hop allowed on 2026-11-09, 5,000 ₳ → MIN and → SUNDAE came back single-leg, and through neither Dano.
- Multi-hop can pay: 200k MIN → iUSD quoted 766 against 379 direct (2026-10-06), though that wasn't a Dano route.

### Steps

1. ⬜ **The gate: see one.** Find a Dano-first route, with `allow_multi_hops: true` over Danogo's pairs, and read a `build-tx` of it, unsigned. Who owns the order? It must be the session's key, or Stop can't bring it back and **Part B stops there**: say so in the backlog. Does it pay the session, and what's its minimum?
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

1. ❓ **A before B?** My recommendation: yes. A is small now that Minswap's orders are seen to be single-shot and under the sender's stake, and B's gate may close it.
2. ❓ **How much better must Dano first be?** It costs a second order's fee and the risk of holding the middle token if the order doesn't fill. My suggestion: at least 1% better than direct, and more for small amounts.
3. ❓ **Is V4 worth it yet?** Seen in use on stablecoin pairs. Sundae's list has no V4 ADA pool, so most of the wallet's pairs wouldn't route through it today. The audit's result is unpublished, and V3 had a published audit. Waiting costs nothing: the wallet routes around V4 meanwhile.
