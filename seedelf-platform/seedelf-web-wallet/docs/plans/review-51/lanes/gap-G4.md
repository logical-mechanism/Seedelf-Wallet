# Lane gap G4

Returned by the workflow's agent `a72e3e58fa1b78d82`, written here by the lead from its structured answer.

## Findings (2)

### gap-g4#1 · medium · A split route's leg paid between the runner's two reads of the account comes back alone, in a later return, directly, though its approval sent it through Lovejoin

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3904`
- **Who:** user · **Since:** 19b1a7ed (2026-09-27, independent review M18's fix, which reads the account again for the outcome label only); in every tagged release, web-wallet/1.6.0 to 1.9.1 · **Confidence:** traced

**Scenario:**

The user sells 10,000 MIN for about 500 ₳ with the swap approved through Lovejoin. The approval says 'Its spare ADA is mixed with other people's on the way back' and shows about 49 boxes of the 5 ₳ pool. Minswap splits the swap into two single-leg orders, say Minswap V2 and SundaeSwap V3 (outOfPlace refuses only a path of more than one leg). Leg 1 fills, and its 300 ₳ arrives and is listed. Leg 2 fills a block later.

In the run where that block lands between the runner's listing of the account (act 3770) and its orders' lookup (liveOrders 3841, utxo_info), both orders read spent. act then reads the account a second time for the outcome (`since`, 3880), and that reading holds leg 2's 200 ₳. But it builds the return from the first reading (3904), which doesn't. That return goes through Lovejoin with the 5 ₳ collateral, the change and leg 1's 300 ₳, about 29 boxes.

Once it lands, leg 2's 200 ₳ is all the account holds, and the next run builds a second return. No exact 5 ₳ is left. The spare pays for a box, so collateralWanted is true and the return skips Lovejoin with NO_COLLATERAL ('its 5 ₳ collateral isn't at its account anymore, and the mixes need it'). The 200 ₳ is swept into a new private UTxO, tied on chain to the session and, through its funding, to the private UTxOs that paid it. The page then says Lovejoin was left out of its return, e2b#2's overwrite.

- An ADA→token swap whose approval put the token into its pool loses the late leg's tokens the same way: noBox, and they come back directly.
- A Splash order's last fill landing in that window does the same.
- Worse but rare: alone at the account, a token fill is a stranger's to plan_return, so it must pay for a whole return plus 0.05 ₳. That is about 1.88 ₳ for a 3-byte name and 2.01 ₳ for a 32-byte one. A 2 ₳ fill of a token whose name is 30 bytes or more is left behind for cost, though sweeping it alone needs about 1.94 ₳. The session then closes Done. Its page lists a 2 ₳ UTxO as 'too little, with what else is left there, to pay for its own way back', without naming the token (`holding` leaves left-behind rows out), and nothing on screen brings it back.

Reach: the window is the gap between the listing and the lookup inside one run, about 0.5 to 2 s of a 15 to 60 s cycle. It is wider where the listing's backend is behind the lookup's. That is a few percent of split-route swaps.

**Evidence:**

- sessions.ts:3770: `const { listed, rows } = await this.listing(network, keyHash);`. It is a const, never reassigned.
- 3841: `const orders = await this.liveOrders(network, s, address, true);`, a utxo_info of the recorded orders. 3872: `if (!(await this.ordersSpent(network, s)))`.
- 3877-3883: 'read again now that every order is known spent: a split route's legs are paid in different blocks, and one may have come since the reading above. What either reading holds counts.' `const since = returnable(s, (await this.listing(network, keyHash)).rows).filter(...)`, then `outcomeOf(s, [...arrived, ...since])` and `fillsOf(s, [...arrived, ...since])`.
- 3904: `await go(() => this.bringBack(network, s.index, rows));`, the first reading. bringBack (4324-4334) passes it to buildBack as `held`, and buildBack (4502-4821) reads no account itself.

The second return:
- act 3816 (`kinds.has("deposit") || kinds.has("mix")`) after a chain, or 3868 letting `kinds.has("back") && auto.filled` through to 3904.
- chainSoFar (1303-1311) makes `started` false for a finished chain, so buildBack 4616-4640 tries Lovejoin again. 4623-4625 finds no collateralFits row. collateralWanted (4918-4930) returns true when the spare pays for one 5 ₳ box, so `skipped = NO_COLLATERAL()` and no chain is built.
- intoPool (4565-4568) needs `rows.some(collateralFits)`, so there is no collateral tail either.

The lone fill:
- The direct return's `own` (4549) is record.txs, siteOuts and recovered.own.
- lib.rs:1202-1214 makes a token row not in `own` a stranger. With no own row, `Draft::needs` is 0 (1138-1139), so 1279-1283 asks the fill for a whole return plus STRANGER_MARGIN.
- My figures come from a Python model of deposit_measure and Draft::needs with mainnet parameters (scratch g4_threshold.py). It reproduces transaction_test.rs:37's 1,456,780.

The case is already in the tests. swap-runner.test.ts:925-933 lands leg 2 'as the orders are looked up' (its `late`) and asserts only `filled`.

19b1a7ed's message: 'The fill-or-refund label was decided from the listing read before utxo_info found every order spent ... The account is read again once the orders are known spent'. The return kept the first reading.

C12's `unlisted` (3818-3827) guards this same harm for a cancel and a swap against the pools: 'A return now would take the 5 ₳ collateral alone, and the rest would come back later without it, so never through Lovejoin.'

**Fix:**

Build the return from what the second reading found. Either call `bringBack(network, s.index, [...rows, ...since])` at 3904 (`since` holds only rows the first reading lacked), or return without building when `since` is non-empty, so the next run's listing holds both legs. Either way the first return takes every leg, and the collateral and the chain go once.

A Splash order's last fill is covered by the same change. It is the same family as C12's `unlisted` (3824), which covers a cancel's and a pool swap's own payout.

Test: extend swap-runner.test.ts:925's first case to read the return the runner sent. Its inputs must include bb…#0, and there must be no second back.

**Known check:**

Searched backlog.md, docs/archive/plans/*.md, architecture.md and flows.md for 'leg paid', 'paid in different blocks', 'read again', 'second read', 'come back later without it', 'split route' and 'M18'.

- architecture.md:647 says the outcome is decided from both readings.
- :648 (C12) guards the same harm for a cancel.
- Independent review M18's fix (19b1a7ed) fixed the label only.
- INDEX's e2b#2 covers the display side of a second return (the Received figure, the skip text) from other causes: a stranger's payment, a missed part, a copy given up.

Nothing covers the split route's late leg coming back unmixed.

### gap-g4#2 · medium · Nothing stops a swap Minswap builds from spending the session's 5 ₳ collateral, and then its return leaves out Lovejoin and the collateral's mix (NO_COLLATERAL)

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4170`
- **Who:** user · **Since:** unknown (the runner has signed Minswap's input choice since chunk 15b; NO_COLLATERAL's skip since privacy review §2.15) · **Confidence:** plausible
- **Needs the owner:** A fix either pauses or refuses a swap Minswap built, which the ledger takes, or changes how a return finds its collateral. And whether it's needed at all turns on one chain lookup.

**Scenario:**

A swap sells MIN for about 500 ₳, approved through Lovejoin. Its funding pays the one-time account two outputs: output 0 is the swap with its costs and 2 ₳ of room, output 1 is exactly 5 ₳. The runner asks Minswap's build-tx with the account's address alone, and Minswap picks the inputs.

If Minswap's coin selection takes both outputs, the wallet signs anyway. Every check passes: the inputs are the session's, and the 5 ₳ rejoins the change at the session's address.

After the fill, the account holds the swap's change (about 6.8 ₳, not exactly 5) and the 500 ₳. buildBack finds no exact 5 ₳ (collateralFits). collateralWanted says the 500 ₳ pays for boxes, so Lovejoin is left out with 'its 5 ₳ collateral isn't at its account anymore, and the mixes need it'. With no 5 ₳ there is no collateral's mix either. All 500 ₳ come back directly, merged into the funding's change, tied on chain to the session and its funding.

The approval priced about 49 boxes and the collateral's mix, and said the collateral is 'mixed' (its fill is ADA, so keepsReserve holds). Every swap Minswap builds that way loses its Lovejoin return.

privacy.md:458 lists how a session's collateral goes (a site's transaction, an earlier return, a Stop's cancel). It doesn't name the swap itself.

Whether Minswap ever takes the 5 ₳ can't be checked offline. The funding's output 0 covers the swap alone by design (quoteOf 908-912: amount + DEX fee + deposits + Minswap's fee + 2 ₳). A largest-first selection would never take the 5 ₳; a random one could.

**Evidence:**

- minswap.ts:8-9: '`build-tx` takes only a sender: it picks the sender's UTxOs from its own view of the chain'. buildTx (389-397) sends sender, min_amount_out and estimate, and nothing naming inputs.
- outBuild (1932-1948) pays the account two outputs: quote.fund (plus any token boxes' ADA and the 1.5 ₳ reserve), and `{ to: address, lovelace: SESSION_COLLATERAL }`.
- order() (4167-4175) signs what inspect passes. inspect's only rule on inputs is that each is the session's (4372-4377, `own` = the listing's rows, the 5 ₳ among them).
- checkOrder (6672) skips outputs at the session's address.
- withinFunding (6571-6578) counts only what leaves the session's address, plus the fee, against approved.fund, so the 5 ₳ rejoining the change passes.

After the fill:
- buildBack 4623-4625: `rows.find((u) => collateralFits(u) && u.tx_hash === funding) ?? rows.find(collateralFits)`. collateralFits (1052-1054) wants exactly 5 ₳ of ADA alone.
- With none found, 4629-4640 calls collateralWanted(…, true). It returns true where the spare pays for a box (4918-4930), so `skipped = NO_COLLATERAL()` (781). The direct return then merges everything.
- intoPool (4565-4573) needs `rows.some(collateralFits)`, so there is no tail.
- The approval's 'mixed' comes from outBuild 2018, `reserve && keepsReserve(quote, lovejoin)`, where keepsReserve (1076-1078) holds for a fill of ADA.

Privacy and tests:
- privacy.md:458's list of how a session's collateral is spent leaves the swap out.
- No test has a swap spend its own 5 ₳: tests/fixtures/swap-tx.ts' swap spends one funding UTxO, and minswap-swap-preprod.json's sender had one UTxO.
- E7a raised the doubt without the trace (lanes/E7a.md:161).

What to look up: the inputs of the swaps the runner has sent, for example the owner's 2026-10-07 mainnet runs (chunk-24 plan, 'Mainnet runs') and chunk 34's preprod 8e7fea0d…. Does any of them spend its funding's 5 ₳ output?

**Fix:**

First, the lookup above. If any session swap spent its 5 ₳:
- Read it before signing: does inspect's spends hold a collateralFits row of `rows`?
- Then, the owner's choice:
  - Ask build-tx again naming only the funding's swap output, if Minswap's API takes inputs.
  - Or let the return's chain put up any ADA-only UTxO of 5 ₳ or more for its mixes, and pay an exact 5 ₳ out of it for the collateral's tail first (the tail's deposit wants exactly 5 ₳, a pool box).
  - Or pause the swap with a reason.
- Add the swap to privacy.md:458's list in any case.

Test (Vitest): the fake aggregator answers a swap spending both funding outputs. After the fill, the runner's return has lovejoinSkipped = sess.skip.warn.noCollateral and no chain.

**Known check:**

Searched backlog.md and docs/archive/plans/*.md for 'coin selection', 'build-tx picks', 'picks the sender', 'spends the 5 ₳', 'spent the collateral' and 'collateral' beside 'Minswap'. Found only Danogo's own collateral (C21; backlog line 114), privacy review §2.15's skip reason and E7a's unverified note (lanes/E7a.md:161). privacy.md:458 and architecture.md:641 don't list a swap among what spends the collateral.

## Guards (18)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3841` | A return or close while an order of the swap, or a Splash remnant that a fill of the session's own order left (remnantsFrom 4087), may still pay the account | tests/swap-order-open.test.ts; tests/swap-runner.test.ts 308-370 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3872` | Anyone's payment taken for the fill before every order of the landed copy is spent (ordersSpent) | tests/swap-runner.test.ts 850-975 ("a swap's order found spent") |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3824` | A return before a cancel's or a pool swap's payout is listed, which would take the 5 ₳ alone and bring the rest back later, unmixed (C12) | tests/pool-swap-landing.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4195` | Stop's cancel paying anyone but the session, or a cancel fee over 3 ₳ | none found by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4288` | Signing a swap whose order the wallet's own cancel can't build or run, or would pay over 3 ₳ for (cancelsChecked) | tests/order-cancel-check.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6571` | The runner's order swap paying out more ADA (its fee included) or more tokens than approved.fund (withinFunding) | tests/sessions.test.ts, tests/direct-swaps.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6659` | An order at a script not pinned in orders.json, made out to anyone else, or under another staking part (checkOrder) | tests/sessions.test.ts, tests/sundae-orders.test.ts, tests/order-cancel-check.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6807` | A swap against the pools giving less than the approved minimum (checkProceeds) | tests/direct-swaps.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6826` | A swap against the pools netting out more than was funded, or its fees eating what it swaps (withinNet) | tests/direct-swaps.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:6443` | A stranger's token riding into a token deposit on the user's ADA: a transaction paying any token beside the swap's own isn't a fill (fillsOf) | tests/swap-runner.test.ts 964 ("takes as its fill only what holds ADA and the swap's own tokens") |
| `seedelf-platform/seedelf-core/src/orders.rs:302` | An order whose canceller isn't the session's key, or with any payee (refund or success receiver) other than the session's own address; this is also why every fill and refund comes to the account | seedelf-core/tests/orders_test.rs an_order_is_the_sessions_only_when_its_canceller_and_every_payee_are |
| `seedelf-platform/seedelf-core/src/orders.rs:955` | A cancel that must spend the collateral for its fee leaving no exact 5 ₳ for the return's Lovejoin, where what's left allows one | seedelf-core/tests/orders_test.rs a_larger_collateral_spent_leaves_an_exact_one_behind, a_splash_cancel_spends_the_collateral_only_when_nothing_else_can_pay |
| `seedelf-platform/seedelf-core/src/orders.rs:1022` | A cancel's collateral return below an output's minimum | seedelf-core/tests/orders_test.rs the_collateral_return_is_held_to_the_least_an_output_holds |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:1279` | The session's ADA paying for a stranger's tokens' deposit: a stranger's token UTxO is taken only when its own ADA pays what it adds plus 0.05 ₳ | wasm/src/lib.rs return_plan_tests (5390+) |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:1023` | The session's own money waiting on a stranger's row whose return won't build (without_strangers, built_or_without_strangers) | lib.rs return_plan_tests strangers_alone_go_one_at_a_time_never_all_of_them, with_the_sessions_own_every_stranger_goes_at_once |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:1409` | A session return spending a UTxO that isn't under the session's payment key | none found by name |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:1039` | A stranger's token UTxO going into a token pool's deposit: only the session's own UTxOs and its fills' (own_and_fills, 1313) do | wasm/tests/lovejoin_across_test.rs |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:441` | The direct return's collateral tail spending a token UTxO (a fill): it pays only from ADA-only, evaluable UTxOs beside the collateral | none found by name |

## Checked and holds

- Every order the runner signs pays only the session: Session::owns (orders.rs:302-310) wants the canceller to be the session's key and every payee to be the session's own address. That covers Minswap V1's and MinswapStable's sender and receiver, MinswapV2's refund and success receivers, WingRiders V2's beneficiary and owner, and SundaeSwap V3's and V4's Fixed destination with no datum. So every fill and refund comes to the account.
- In the 15 real order datums (seedelf-core/tests/fixtures/order_cancels.json, decoded), every fill brings the bought token with 2 ₳ beside it:
- Minswap V1 and MinswapStable: batcher fee 2 ₳, deposit 2 ₳.
- MinswapV2: max batcher fee 0.7 to 0.9 ₳, deposit 2 ₳ (preprod's 4.7 ₳ = 2 swapped + 0.7 + 2).
- SundaeSwap V1: scooper fee 2.5 ₳, deposit 2 ₳.
- SundaeSwap V3, Stableswaps and V4: 1.28 ₳ fee, 2 ₳ deposit.
- WingRiders V1: 4 ₳ (2 ₳ oil).
- WingRiders V2: oil 2 ₳.
- No DEX the runner routes to pays a fill or refund that falls short of plan_return's stranger rule in an ordinary return. Beside the session's own UTxOs, a fill's one token adds 0.23 to 0.37 ₳ (mainnet parameters, by name length, lib.rs:1279-1283), against a fill of 2 ₳ or more. Merged into a funding change of exactly 20 tokens it's 1.70 to 1.83 ₳, still under 2 ₳.
- Every return path classes a fill alike, as architecture.md:635 and flows.md:478 document ('a DEX's fill ... goes in only when its own ADA pays'). buildBack is the only builder (backBuild 3282, claimBuild 3337, the runner 4327). The direct, merged, sweep, chain (with_return, lovejoin.rs:1872) and direct_tail returns all take its `own`.
- Through Lovejoin, a fill's token goes into its approved pool and no further. wayOf passes auto.fills with `only` and `most` (6414-6422). holdings_of takes own_and_fills (lovejoin.rs:1039, 1313). acrossOf's mayGo (lovejoin.ts:3913) and collateralWanted (4934) count fills.
- A Danogo swap's proceeds sit in the session's own swap output, which is own on every path. act marks it filled (3850-3858) without fills, which it doesn't need.
- After Stop, the wallet's cancel pays everything back to the session's address (own): a Splash order's value exactly as output 0, everything else as change. It keeps an exact 5 ₳ where its fee had to spend the collateral (orders.rs:955-973). The return then waits for every order to be spent and for the cancel's payout to be listed (3824-3827, 3893-3899).
- No return or close happens while an order or a Splash remnant of the session's own order is open (liveOrders 4032-4072, remnantsFrom 4087-4133). A stranger's output at Splash's address naming the session, with a reference script or not traced to the session's order, doesn't hold the swap open.
- direct_tail (lovejoin.rs:426-477) spends only ADA-only, evaluable UTxOs beside the collateral, never a fill's token. The return after it sweeps the mix's change (own) first, so the fill joins it at the small 'beside own' cost.
- session_return refuses any UTxO not under the session's payment key (lib.rs:1409-1418). plan_return never takes an unpriceable reference script (`script`).
- check_cancels (orders.rs:1231-1270) dry-runs each order's own cancel with 20 ₳ stand-in funds and a 5 ₳ stand-in collateral before the swap is signed. cancelsChecked holds the fee to 3 ₳.
- builtOutputs (minswap.ts:508-555) reads a datum-by-hash order's datum from the witness set, and marks the inline and script-ref forms for the cancel check.

## Notes

- **For the owner (settled H1/H2 design, new fact).** A fill alone at the account (gap-g4#1's late leg, or any later return) is a stranger's to plan_return. It must pay for a whole return plus 0.05 ₳: about 1.88 ₳ (3-byte name), 1.91 ₳ (10 bytes), 1.97 ₳ (24 bytes) and 2.01 ₳ (32 bytes). The model reproduces transaction_test.rs:37's 1,456,780, but its figures were computed by hand (scratch g4_threshold.py), not by running plan_return.

So a 2 ₳ fill of a token whose name is 30 bytes or more is left behind, though a sweep of it alone needs about 1.94 ₳. Two reasons: SWEEP_OVERHEAD_BYTES is 500 against the 160 measured, and STRANGER_MARGIN pays for scripts a sweep doesn't run.

Once left behind, the closed swap's page names only the UTxO's ADA ('(2 ₳) is too little, with what else is left there, to pay for its own way back'). `holding` drops left-behind rows, so the bought token is named nowhere, and a closed auto session offers no Bring it back (claimBuild skips auto and closed sessions).

Counting auto.fills in buildBack's `own` (4549) would end it; it reaches with_return through the chain request's own.
- Splash: the ADA beside each partial fill's reward isn't in the datum (tag, beacon, input, tradable 1e9, cost per step 1 ₳, least output, output, price, fee 2 ₳, redeemer, canceller, executors), so it can't be read offline. To look up: a real Splash partial fill's output to the redeemer address (backlog: Splash is very low priority; a partial fill has never run live).
- The WingRidersStableV2 order in order_cancels.json (#8, someone else's) has oil 0. If Minswap builds such orders, a fill carries only what the ledger's minimum forces (about 1.2 ₳ with one token). That still clears the 'beside own' rule, but not the lone one.
- In gap-g4#2's case, a Splash cancel takes the swap's change as collateral and has to spend it for the fee. cancel_orders' `keep` then needs refund + 1 ₳ + 5 ₳ ≤ inputs with the rest a valid output, so there is often no exact 5 ₳ afterwards either. It is the same class, and Splash is very low priority.
- e2b#2 (INDEX) is the display side of gap-g4#1's second return: the Received figure shows only it, and its NO_COLLATERAL or noBox reason replaces the main return's. gap-g4#1 is its cause on the swap's own proceeds, plus the unmixed leg.
- outcomeOf counts any arrived UTxO's tokenIn and tokenOut, so a stranger paying the account the swap's token while it waits can turn the label to 'partly' or 'filled'. This is display only; the money follows `rows`.
- A by-hand session (no auto) re-reads the account at each press (backBuild, utxosOf), so a leg listed late there is offered again on its open page. gap-g4#1 is the runner's alone.

## Coverage

**Read in full:**\n- sessions.ts:\n  - 3380-4840: advance, stop, stopCost, resume, runAll, settleReturns, markCut, step, act, noteOrderOpen, waits, ordersSpent, placed, ordersOpen, liveOrders, remnantsFrom, order, cancel, cancelOf, cancelsChecked, referenceRows, bringBack, inspect, review, signAndSend, buildBack, collateralIntoPool.\n  - 4884-5160: throughLovejoin, collateralWanted, lovejoinWantsCollateral, nothingBack, leaveBehind, leftBy, fundingChange, sendBack, noteLanded, refuseParts.\n  - 5170-5270: sendChain's head.\n  - 5621-6000: listNow, view, listing, utxosOf, spentStates, landed.\n  - 6395-6872: spareOf, wayOf, pricedClassic, fillsOf, leftBehindView, chainView, autoView, outcomeOf, paidOut, withinFunding, dexOrderAt, checkOrder, directSpends, checkDirect, checkProceeds, withinNet, refuseOddities.\n  - Helpers 180-300, 880-1110, 1303-1312, 1880-2025 (outBuild).\n- minswap.ts, all 630 lines.\n- seedelf-core orders.rs 1-1466 (tests not read).\n- orders.json, every entry, by script.\n- order_cancels.json: all 15 orders' values and datums decoded by script (scratch g4_cbor.py, g4_orders.py).\n- session-swap.json.\n- wasm lib.rs 880-1534 (SessionReturnRequest through planned_return).\n- wasm lovejoin.rs 400-540 (DirectTail, direct_tail, ReturnTail), 890-1150 (Holdings, holdings_of, Across), 1780-2007 (with_return).\n- Swaps.tsx 1555-1656 (LovejoinChoice), 2100-2601 (the session page: Received row, LovejoinSkipped, LeftBehindNote, Stop wiring) and 2820-3079 (StopDialog, backStepText).\n- SessionLeft.tsx.\n\n**Followed out, read in the parts that matter:**\n- lovejoin.ts 3880-4180 (acrossOf, planAcross).\n- data-layer.ts 200-300.\n- transaction.rs' minimum helpers.\n- tests: swap-runner.test.ts 845-975, fixtures/swap-tx.ts, pool-swap-landing.test.ts' head, orders_test.rs' test names.\n- docs: architecture.md 620-674, privacy.md 352-375 and 440-460, flows.md 475-479, the backlog's swaps lines, chunk-24's mainnet runs, E7a's and E2b's lane notes.\n\n**Not reached:** lovejoin.ts chain() itself (3642-3880), the WebAssembly chain_at, fan_out and CollateralTail internals, and the swap approval's body beyond LovejoinChoice.\n\n**Run:** Python by hand for the CBOR decodes and the threshold model. No tests, no builds, no network.\n\nWhether Minswap's build-tx ever spends the 5 ₳ collateral can't be decided offline (gap-g4#2's lookup).
