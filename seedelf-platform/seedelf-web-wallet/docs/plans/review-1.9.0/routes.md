# 1.9.0's release review: the routes lane's report

Round one, a finder. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read: chunk 47's plan; minswap.ts in full; the #375 and #377 diffs (TS, orders.json, orders.rs's V4 part, docs); sessions.ts: routeOf, quote, outBuild, swapBuild, order, cancel, cancelOf, cancelsChecked, referenceRows, inspect, checkOrder, directSpends, withinFunding, withinNet, refuseOddities, step and act, liveOrders, ordersSpent, placed, scan, scanNow, recoveredRecords and listing. Also sw.ts's Minswap factory, data-layer.ts, the data API's account_txs (account.rs), tx_info (tx.rs) and utxo_info (utxos.rs) sources, wasm read_dex_order and build_order_cancel, and the tests swap-routes, direct-swaps, order-cancel-check, sundae-orders and restore-scan.

Ran Vitest at 8d7c4b0c in the main tree, all passing: swap-routes, direct-swaps and order-cancel-check (72 tests); sessions (61); sundae-orders, swap-quote-ask, restore-scan, swap-order-open and minswap-refusals (81). In my own worktree (removed afterwards) I ran two scratch files: review-v4-stop.test.ts (3 tests) and review-reask-400.test.ts (2 tests). Copies are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/routes/. Made 5 read-only Minswap estimate calls (4 mainnet, 1 preprod); the answers are saved under …/routes/live/. No Koios calls, no cargo.

Not done: a deep review of the Rust V4 reader and cancel (orders.rs, the other lane); an unsigned V4 build-tx (my brief allows estimate calls only, see routes#4); finding the 4 live Minswap names the wallet doesn't know; checking whether preprod routes through any direct-swap DEX; how Swaps.tsx renders a 1,250-character Minswap refusal.

## Findings

### routes#1 (low, #375, confirmed-by-run): routeOf's second ask sends Minswap's own path names back unchecked; a name the validator refuses turns 1.8.1's clean refusal into a raw 400 and an endless retry

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:883, seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3645, seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts:405, seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts:422, seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:3049

**Claim.** Since #375, routeOf adds every protocol name in the first estimate's paths that MAINNET_PROTOCOLS lacks to exclude_protocols for a second estimate. Nothing guarantees that Minswap's validator takes those names. Its published schema says one Protocol enum serves both fields, but that schema is already out of date. It lists ChakraBondingCurve, which the live API refuses, and omits WingRidersStableV1, which it takes (19 names documented, 23 accepted live). If the router ever names a DEX the validator refuses, the second ask fails with Fastify's validation 400. The quote and Review it myself then show about 1,250 characters of 'must be equal to constant' instead of the wallet's sentence. A funded swap's runner retries every 30 s, backing off to 5 min, for as long as the route stays, where 1.8.1 paused it in words. Nothing is locked: Stop still brings everything back. I saw no trigger: every name the wallet sends, Minswap's own included, is accepted live today.

**Evidence.** sessions.ts:883-888: `const first = await minswap.estimate(ask); const avoid = [...new Set([...outOfPlace(first), ...uncheckedProtocols(network, first)])]; const est = avoid.length ? await minswap.estimate(ask, avoid) : first;`. At web-wallet/1.8.1 (sessions.ts:880-886) it was only `const avoid = outOfPlace(first);`, so an unchecked DEX reached quote's `sess.routesThrough` refusal or the runner's Refused(nowRoutes) pause (sessions.ts:4130-4133).

A validation 400 becomes MinswapError with no trouble code (minswap.ts:409-413). refusalOf keeps a JSON message whole (minswap.ts:433). step() therefore retries rather than pausing (sessions.ts:3653-3657, reason 'other'), and Swaps.tsx:3049 shows the raw error for 'other'.

Live, mainnet estimate with exclude_protocols ["OpenDjedV1","ChakraBondingCurve"]: HTTP 400 {"code":"FST_ERR_VALIDATION","message":"body/exclude_protocols/1 must be equal to constant, …(23×)…, body/exclude_protocols/1 must match a schema in anyOf"}, a 1,249-character message. docs.minswap.org/developer/aggregator-api: a 19-value Protocol enum, including ChakraBondingCurve, applies to include/exclude_protocols and to `protocol` in paths.

Scratch test (worktree at 8d7c4b0c; uncheckedProtocols mocked to mainnet as swap-routes.test.ts does):
```ts
function routesThroughUnnameable(t: T, dex: string) {
  const answer = t.minswap.fetch;
  t.minswap.fetch = async (url, init) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const left: string[] = body.exclude_protocols ?? body.estimate?.exclude_protocols ?? [];
    if (left.includes(dex)) return new Response(AJV(left.indexOf(dex)), { status: 400, headers: { "content-type": "application/json" } });
    t.minswap.estimate = via(dex);
    return answer(url, init);
  };
}
// quote("mainnet") rejects /^Minswap refused it \(400\): body\/exclude_protocols\/1 must be equal to constant/
// started; funded; routesThroughUnnameable(t, "ChakraBondingCurve"); advance -> paused undefined, retry { reason: "other" }
// resume -> the same; swapBuild rejects /^Minswap refused it \(400\)/; stop -> txs ["out","back"]
```
Output: `quote: Minswap refused it (400): body/exclude_protocols/1 must be equal to constant, … length 1275`; `runner: {"retry":{"at":1800000030000,…,"reason":"other"}}`; `after stop: {"kinds":["out","back"]}`. 2 passed.

**Scenario.** Mainnet. Minswap's router names a DEX, for example ChakraBondingCurve if it still routes through it under that name, that its request validator no longer takes. First case: the user asks for a quote on a pair that DEX wins. They get 'Minswap refused it (400): body/exclude_protocols/7 must be equal to constant, …' in place of 1.8.1's 'Minswap routes this swap through X, which the wallet can't check yet…'. Second case: a funded swap reaches its order step. It shows 'Retrying' with that text, retrying every few minutes indefinitely, instead of pausing. Stop works.

**Fix.** Give minswap.ts a trouble code for the validator's refusal of a name, matched on Minswap's own words (/exclude_protocols\/\d+ must be equal to constant/), as FUNDING_UNSEEN does. When routeOf's second ask fails with that code, keep `first`, so the quote refuses and the runner pauses in the wallet's words as 1.8.1 did. This is the backlog's 'retry without a refused name', applied to routeOf's names too.

### routes#2 (low, #375, traced): Preprod: a direct-swap DEX the wallet can't name is quoted, funded, then paused (DIRECT_PROTOCOLS' purpose), with ChakraBondingCurve now unnameable

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts:133, seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts:325, seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts:338, seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6728

**Claim.** DIRECT_PROTOCOLS kept DEXes that swap against their pools out of routing so that a swap would never be funded and then paused. ChakraBondingCurve had to leave it, since Minswap refuses the name. On preprod nothing asks again for an unchecked DEX: uncheckedProtocols returns [] there, and outOfPlace only catches multi-leg paths or Danogo beside another DEX. So a single-leg preprod route through any direct-swap DEX the wallet doesn't name gets a quote and is funded. That covers ChakraBondingCurve under that name or a new one, and any of the 4 live names the wallet doesn't know. The runner then pauses at directSpends ('it spends something that isn't this session's'), and the user pays two fees to get the money back. The PR accepted this ('the session's own check still pauses any DEX that swaps against its pools'). Reachability isn't shown: I saw no preprod route through such a DEX. On mainnet, routeOf asks again without such a DEX and works whenever the validator takes its name. A path still naming ChakraBondingCurve would hit routes#1 instead, and the validator does refuse that name (live 400).

**Evidence.** minswap.ts:133 `export const DIRECT_PROTOCOLS = ["OpenDjedV1"];`. minswap.ts:325 the preprod list is `[...DIRECT_PROTOCOLS, ...PREPROD_BROKEN, ...PREPROD_NOT_PINNED]`. minswap.ts:339 `if (network !== "mainnet") return [];`.

swap-routes.test.ts:147-152 asserts a preprod quote through CswapV1 resolves after one estimate. direct-swaps.test.ts:177-181 shows a direct swap spending a non-Danogo script UTxO pausing as refused, with only the funding submitted. directSpends refuses any spend not at DANOGO_POOL (sessions.ts:6727-6728).

Live: the wallet's preprod list ["OpenDjedV1","Splash","SplashStable","SundaeSwapV4"] answered 200 (MinswapV2 route). A mainnet exclude naming ChakraBondingCurve answered 400.

**Scenario.** A preprod tester asks for a pair whose best route Minswap sends through a bonding curve or another pool-swapping DEX under a name the wallet doesn't know. The quote shows that DEX. They approve and the session is funded. The runner's build spends that DEX's pool UTxO, and the swap pauses with 'it spends something that isn't this session's.' The tester has to Stop, which costs the funding's fee and the return's.

**Fix.** Optional, preprod only: in routeOf, also ask again without names that aren't in MINSWAP_PROTOCOLS (names the wallet has never seen), as mainnet does for every unchecked name. The known-but-unread DEXes stay with the session's check, as designed.

### routes#3 (low, #377, confirmed-by-run): No Vitest runs V4's Stop, its restore-scan find or its fill; only placement and the dry run are covered (all three work, shown by a scratch run)

**Files:** seedelf-platform/seedelf-web-wallet/extension/tests/order-cancel-check.test.ts:61, seedelf-platform/seedelf-web-wallet/extension/tests/sundae-orders.test.ts:270, seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4390

**Claim.** V4 appears in the extension tests only as a REAL placement in order-cancel-check: checkOrder plus the checkOrderCancels dry run. Chunk 47's 'Done means … Stop brings back any V4 order' has no Vitest through the runner, and no live run either ('Left open: V4's first live mainnet swap and Stop'). That leaves the TS side's Stop unexercised for V4: cancelOf reading V4's reference row, the stake key allowed by inspect's stakeSigns, signing with both keys. So is the restore scan finding a V4 order. That case differs from V3: the order sits under the session's own stake part, so its fill and cancel also show in the session's account_txs. A scratch run shows all of this works at 8d7c4b0c.

**Evidence.** `grep -rn SundaeSwapV4 tests/` finds only order-cancel-check.test.ts:61 (REAL placement), swap-routes.test.ts:72-75 and sessions.test.ts:341 (lists). V3's Stop has a test at sundae-orders.test.ts:270-281. inspect allows the stake key only when `foreign.some((r) => dexOrder(wasm, network, r, bech32).stakeSigns)` (sessions.ts:4390).

Scratch file review-v4-stop.test.ts (3 passed, real WASM, mainnet, worktree at 8d7c4b0c):
```ts
// order_cancels.json's SundaeSwapV4 datum, owner 511097cf…/903ac01d… -> session 0's keys, at `11${V4_SCRIPT}${STAKE}`
await t.store.set("sessions.mainnet", { next: 1, sessions: [{ index: 0, ownStake: true, createdAt: now,
  txs: [{ kind: "out", txHash: sessionSwap.utxo.tx_hash, at: now, confirmed: true }],
  swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
  auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } } } }] });
// + funding row at the mainnet address, mainnet reference rows in utxo_info, t.minswap.swapCbor = swapPlacing(order)
let view = await sessions.advance("mainnet", 0, true);            // ["out","swap"]
t.koios.spent.add(FUNDING); t.koios.addedToAccounts.push(change(SWAP#1), orderRowAt(SWAP, order)); // inline datum
expect((await sessions.cancelBuild("mainnet", 0)).summary.signs).toEqual(["0/0", "stake"]);
view = await sessions.stop("mainnet", 0);                          // ["out","swap","cancel"], no pause
expect(cancelRequests.at(-1)!.references.map(r => `${r.tx_hash}#${r.tx_index}`)).toEqual([V4_REFERENCE]);
expect(witnesses.at(-1)).toMatch(/^a100(d90102)?82/);             // two vkey witnesses
expect(builtOutputs(t.koios.submitted.at(-1)!).every(o => o.address === MAINNET_SESSION)).toBe(true);
// scan: usedStakes + accountTxs(rewardAddress(Mainnet,0)) [swap, funding]; txSpends(swap) = funding input at the session;
// txOutputs(swap) = [V4 order #0, change #1]; order row -> scan("mainnet") == { used: 1, found: [0] };
// record's swap orders [`${SWAP}#0`]; orders() -> "SundaeSwapV4"; cancelBuild signs ["0/0","stake"]; txSubmit records the cancel
// fill: spent order + token at the session -> advance -> filled: true, txs ["out","swap","back"]
```
Output: `cancel outputs 1 pays session 13768794` (the 14 ₳ order less a 231,206-lovelace fee) and `after fill {"filled":true,"kinds":["out","swap","back"]}`.

**Scenario.** A later change to cancelOf, inspect's stakeSigns rule, the scan's candidate read or the V4 entry breaks a V4 Stop or a V4 restore-scan find. No test catches it before release, and no live V4 Stop has run, so the first user to press Stop on a V4 order finds it.

**Fix.** Add the scratch tests (the Stop, the scan find, the fill) to order-cancel-check.test.ts or sundae-orders.test.ts. They need only fixtures already in the repo.

### routes#4 (low, #377, plausible): V4 wins live mainnet routes today, but no build-tx of a V4 order for a sender has been read; a different shape pauses every V4 swap after funding

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6674, seedelf-platform/seedelf-core/src/orders.rs:504, seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-47-minswap-new-routes.md:28

**Claim.** With the wallet's exact mainnet list, Minswap now routes USDr → sUSDr through SundaeSwapV4, so 1.9.0's stablecoin swaps will take V4 at once. Every check of a V4 order's shape runs on a build, which exists only after funding: the staking part (checkOrder's type-1 rule has no fixed-part exception for V4), Signature(stake) as owner, Fixed with no datum, and exactly the two basic-order modules. Part A's evidence is ten Minswap orders read from chain, not a build-tx answer for a sender. If the API builds V4 orders in any other shape, for example with a third constraint or under a fixed staking part as it does for V3, every V4-routed swap is funded, then paused, and costs the user two fees. No money is lost. The PR lists 'no live V4 swap' as accepted. What it doesn't mention is a free check that fits the no-test-spend rule.

**Evidence.** Live, mainnet estimate with the wallet's list (USDr 7d9e4a0e…55534472 → sUSDr …7355534472, 1,000,000): `{"total_dex_fee":"1280000","deposits":"2000000","aggregator_fee":"1000000","paths":[[{"protocol":"SundaeSwapV4",…}]]}`.

sessions.ts:6674-6678: `const minswaps = o.address.slice(2, 58) === sundae.order && part === sundae.stake; if (!(type === 7 || (type === 1 && (part === stake || minswaps)))) throw new Refused(t("sess.refuse.warn.contractOtherStake"));`. sundae is SUNDAE_V3 only. orders.rs:504-514: V4 reads only with destination datum None and fills_once (exactly SUNDAE_V4_ONE_FILL).

The runner builds only after funding (sessions.ts:4152). Plan line 28: the evidence is six Minswap V4 orders from chain. Plan line 99: 'Left open: V4's first live mainnet swap and Stop'. PR #377: 'No live V4 swap or Stop has run … The first real swaps are the live run.'

**Scenario.** A user swaps USDr for sUSDr on 1.9.0. The quote goes through SundaeSwapV4 and the session is funded. If Minswap's build-tx makes the order in a shape the reader doesn't take, the runner pauses ('it places a SundaeSwap order this session couldn't cancel…' or 'it pays a contract under someone else's staking part'). The user Stops and pays the funding's fee and the return's. Every V4-routed swap does the same until a fix ships.

**Fix.** A free check: ask build-tx (unsigned, never signed or sent) for a V4 route, with sender set to a public base address holding USDr. Run the CBOR through builtOutputs and checkOrder in a scratch test, with that address as the session. That settles the one unseen step without a mainnet spend.

## What holds

- Every Minswap estimate goes through routeOf (sessions.ts:884,886), called with the caller's own network at quote (1587), Review it myself (3185) and the runner's order (4126). build-tx is called only at 3195 and 4152, each with routeOf's avoid. The client is built per network with excludedProtocols(network) (sw.ts:233).
- The avoid list reaches build-tx's nested estimate, minswap.ts:375 `estimate: routed(ask, [...this.exclude, ...avoid])`, tested for the quote and the runner (swap-routes.test.ts:118-145, sundae-orders.test.ts:169-204) and for Review it myself (sessions.test.ts ~1378-1404, Danogo).
- No duplicate names: routeOf dedups avoid (sessions.ts:885) and routed dedups the union (minswap.ts:448).
- Live, 2026-11-09: the wallet's exact mainnet list [OpenDjedV1, VyFinance, MuesliSwap, SplashStable, SundaeSwapStable, CswapV1, WingRidersStableV1] answered 200 (route through 'Minswap'). The preprod list [OpenDjedV1, Splash, SplashStable, SundaeSwapV4] answered 200 (MinswapV2). Minswap, MinswapV2 and MinswapStable are taken in exclude_protocols but ignored (the route stayed through 'Minswap'), so outOfPlace's re-ask for a Minswap leg never draws a 400.
- Live: a V4 route quotes dex_fee 1,280,000 and deposits 2,000,000. The real V4 order in order_cancels.json holds exactly 3,280,000 lovelace plus the token, so withinFunding's bound (fund = dex fee + deposits + aggregator fee + 2 ₳ SWAP_MARGIN) leaves about 2 ₳ for the network fee. withinNet applies only to Danogo's direct swaps, not to V4.
- checkOrder takes a V4 order at header 0x11 only under the session's own staking part, or 0x71 with none. Minswap's fixed-part exception is pinned to V3's script alone (sessions.ts:6674-6678). stakeSigns without ownStake is refused (6673). For V4 that can't happen: every mainnet session has ownStake (outApprove at 3146, the scan at 2793), and V4 is excluded on preprod.
- A V4 order built under a fixed staking part of Minswap's would be refused (contractOtherStake) only once built, which is after funding. The quote can't see a build. Stop then brings the funding back, since nothing was placed (see routes#4).
- Stop on a V4 order (scratch run, real WASM, mainnet): cancelOf reads V4's reference c1ecddd6…#0, buildOrderCancel builds the cancel, inspect allows ['0/0','stake'], two vkey witnesses are attached, and the cancel's one output pays the session 13,768,794 lovelace.
- Restore scan and Find leftovers (scratch run) find a V4 order through the swap its key signed. The path: account_txs by stake address, then the tx_info outputs (read with an empty datum, `known` by script hash), then utxo_info (inline datum, is_spent), with liveOrders working off the same rows. A found session's cancel signs with both keys.
- The data layer answers the scan as Koios does. account_txs gathers outputs at every address of the stake key (account.rs Whose::Stake). tx_info returns outputs with payment_addr bech32 and cred in the txSpends shape too (tx.rs reads OUTS unconditionally). utxo_info returns is_spent, inline_datum and reference_script bytes for any outpoint.
- A V4 order sits under the session's stake part, so its fill and cancel also show in that stake key's account_txs. The scan still takes the oldest unsigned transaction as the funding, and a fill spends nothing at the wallet contract, so it isn't counted as the phrase's own payment (sessions.ts:2903-2914, 2960).
- A V4 fill is noticed as any order's is: the recorded outpoint's is_spent (liveOrders, ordersSpent), then outcomeOf on what reached the session's payment key. In the scratch run, filled became true and the return started. Session listings go by payment credential (sessions.ts:5934), so a V4 order under the session's stake part never reads as the session's money.
- V4 needs nothing V4-specific in the UI or i18n: no per-DEX display map, and the SundaeSwap refusal strings are generic.
- Vitest at 8d7c4b0c, all passing: swap-routes, direct-swaps and order-cancel-check (72); sessions (61); sundae-orders, swap-quote-ask, restore-scan, swap-order-open and minswap-refusals (81).
