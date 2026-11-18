# Lane gap G5

Returned by the workflow's agent `a330f85ac94e60ee4`, written here by the lead from its structured answer.

## Findings (1)

### gap-g5#1 · medium · A pool someone else launched with a box under S0d's least is shown, picked by default and offered with no word, and what comes back from it can't pay part of itself without other money, so spending it undoes the mix

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:530`
- **Who:** pool-launcher · **Since:** 1772c96f (2026-10-17, chunk 34c: discovery shows standard pools), first in web-wallet/1.6.0 · **Confidence:** traced
- **Needs the owner:** Either fix changes what discovery shows (a pool every coded rule calls standard), or it adds a warning to the hub, the pool page, the swap approval and the return reviews. Decision 22 ('not shown') and call 34 ('treat it like any pool, with the review saying so') point different ways.

**Scenario:**

Mainnet. Someone launches the first pool for a listed token, say SNEK. They don't use Seedelf Wallet: they use Lovejoin's own scripts, whose default box is 2 ₳, or any tool. The launch puts mix_box and mix_logic at the holder and registers L, so the pool is standard. Each box holds 3 ₳ + 1,000 SNEK. The launcher Bootstraps 30 boxes to meet the floor: 90 ₳ of capital, which they can take back. The pool is verified and kept. usableNow refuses only a box under its own min-UTxO, and cantComeBack measures the withdraw alone, so the pool is neither unusable nor stuck. Alice swaps 100 ₳ for SNEK, with Bring it back through Lovejoin on as it is by default. At Review, tokenPool picks this pool, the most used one that takes a box: 30 free boxes at depth 2 give room for 3 boxes. The approval says 'Through Lovejoin: 3 boxes of 1,000 SNEK + 3 ₳, funded now', with nothing more. Each box comes back by itself as one private UTxO of about 2.70 ₳ + 1,000 SNEK. Later Alice sends 400 SNEK privately. Paying part of the token from that UTxO alone needs the recipient's output, the token's change and the fee, about 3.39 ₳ (the owner's own call-2 figures for a 3 ₳ box). So the wallet spends a second private UTxO with it, and the review's HistoriesNote says it 'undoes some of what Lovejoin did for the box'. At Lovejoin's 2 ₳ default, about 1.70 ₳ comes back. That can't even move whole into a Seedelf (about 1.66 ₳ for the output plus about 0.3 ₳ fee). On its own it can only be made public, whole. The same holds on the hub and pool page: a user who opens the token's group, or an ADA pool at 2 to 3.4 ₳ (ADA's least is 3.45 ₳), and presses Mix, Bootstrap, a return or Change is told nothing. The wallet's own launch form can never make such a pool.

**Evidence:**

1. Discovery holds a found pool to no box-value bound. lovejoin-pools.ts:530: `if (!view || view.scriptsInline !== 0 || !this.listedValue(network, view)) return undefined;`. listedValue (:542-546) checks only that the token is listed, or that an ADA pool isn't 10 ₳. The Koios path is the same (:583-587, :617-623).
2. The datum's only floor is the contract's. pool.rs:175-184 holds box_lovelace > 0 and 0 < max_fee < box_lovelace.
3. usable and comes_back measure the withdraw alone. pool.rs:553-562 and :570-575 call measured(), which checks the box's own min-UTxO (:600-606), builds one withdraw (:624-631), and fails only with CantPayBack, from the output's minimum after the fee (mod.rs:1652-1665). The later steps that box_value.rs:8-23 lists are never run for a found pool: 'from what came back alone, a payment of part of it ... What comes back is then spent ... on its own, since spending it with another would tie the two histories together and undo the mixing'.
4. The worker. lovejoin.ts:4209: `if (!usable.usable && usable.why === "belowMinimum") why = usable.why;` is the only refusal, and cantComeBack (:3109) asks `backOnly: true`, which is comes_back.
5. The S0d bound exists, but only for the wallet's own launch. lovejoin-launch.ts:21-23 and :258: `if (box < BigInt(value.least)) throw new Error(t("lj.launch.tooLittle", ...))`, from wasm box_value (lovejoin.rs:2959: 'no launch goes below it'). The form at LovejoinLaunch.tsx:177-178 does the same. `rg lovejoinBoxValue|least` over extension/src finds no other user.
6. It's picked by default. sessions.ts:1713-1724 tokenPool takes the candidates, keeps those usable() passes, filters by floor and room, sorts by others, and takes `works[0]`. A return does the same: lovejoin.ts:3962-3986 acrossOf takes the most used pool that usableNow passes. The hub sorts a group's pools by most used (ui/lovejoin-pools.ts:129), and parked boxes count.
7. What the screens say. LovejoinReturn.tsx:241-244 shows en.json:1412 'Through Lovejoin: {{boxes}}', and adds :1417's warning only `into && w.stuck` (:270). The hub's flags (Lovejoin.tsx:2297-2302) and the pool page's callout (:3537) show only for cantComeBack.
8. The repo's own records:
- chunk-34-token-pools.md:149: 'a 3 ₳ box comes back as about 2.70 ₳ plus Q, which can't pay for a partial token send on its own (about 3.39 ₳), so the send would co-spend another UTxO'.
- :524: 'Lovejoin's own 2 ₳ pool is usable by §2's rules ... What comes back can't pay alone for part of its token, though. Session 1 settled it: with its scripts at a key address, the pool isn't shown at all (22)'. So only that pool's key-address scripts kept it off the hub.
- :296 names Lovejoin's 2 ₳ bootstrap default.
- :85 (decision 14): 'The lower bound is S0d's: a box must come back and then pay part of its token on its own'.
- :113 (decision 22): 'A user not following this standard should not be shown ... The extension is the guardrail for how pools are made'. The standard, as coded, leaves the bound out.
- seedelf-core/tests/lovejoin_box_value_test.rs:23-31 gives the least by reference: 3.83 ₳ for a typical token, 4.11 ₳ at worst. :78 gives an ADA pool's, 3.45 ₳.
9. At spend, en.json:756 HistoriesNote: ', and undoes some of what Lovejoin did for the box', a plain note (HistoriesNote.tsx:1-6). privacy.md:439 says only 'a payment above one box's worth from money that's all boxes' can't be kept apart. Here a payment of part of one box can't be kept apart either.
No command was run. A verifier's core test could call `way_back(&Probe::new(false, true)?, &mainnet_params, &BoxValue { lovelace: 3_000_000, token: Some(typical) })`. It should err with words starting 'part of it to a Seedelf', which shows the withdraw step built, while `least_box_lovelace` for that token is above 3 ₳. A Vitest status read of such a pool should show neither cantComeBack nor unusable.

**Fix:**

Hold every found pool to S0d's rule at its own value, measured as the way back is now: once an epoch per pool, cached beside comeBack. That means a way_back-style check of the pool's actual box value and token through its own Protocol, or least_box_lovelace for its token shape, cached by shape and epoch. Which way to apply it is the owner's call:
(a) Make it part of 'standard', so discovery doesn't show such a pool, as decision 22 has it for pools that don't follow the standard.
(b) Flag it as call 34 flags a stuck pool: a hub row flag, the pool page's callout before Review, a line beside the token in TokenWays (swap approval, return reviews, Stop), ClaimAll's list and the Change list. Each would say that what comes back can't pay part of itself without other money, and that spending it ties it.
The class: every reader that assumes a found pool follows the wallet's own launch rules. ADA pools at 1.63 to 3.44 ₳ are in it too (hub and pool page). The 9 ₳ token-box cap is the same kind of rule, but going over it only locks capital, and the review shows it.

**Known check:**

backlog.md: searched 'S0d', 'least', 'box value', "box's ada", 'pay part', 'on its own' and 'alone', and read its whole Lovejoin section and chunk 34's leftovers: nothing. archive/plans: searched 'S0d', 'least box', 'below/under the least', "can't pay alone", 'part of itself on its own', 'launched elsewhere/outside' and "Lovejoin's own app". The only hits are chunk 34's design records (call 2, decision 14, S0d's table, LJTEST's 2 ₳ note, §2). They apply the bound to the wallet's own launch form, and none decides that a found pool below it is shown without a word. Session 5's calls 34-36 and the 'For the owner' lists cover only stuck pools (CantComeBack). No review's Not fixed list has it. INDEX.md: nothing for least or S0d. E8a, E1a, R3a and R3b checked the decode ranges, BelowMinimum and CantComeBack only.

## Guards (19)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:530` | A data-layer or Koios pool being kept unless WebAssembly verifies it, its scripts are read from the holder (scriptsInline 0), and its value is a listed token's or an ADA pool's other than 10 ₳ | tests/lovejoin-discovery.test.ts:183, :314 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:509` | Building on a data-layer pool whose reference UTxO, scripts and launch aren't one transaction | tests/lovejoin-discovery.test.ts:322 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:670` | holdsNft: a holder row being a candidate unless it holds exactly one 'lovejoin' token (quantity 1) and ADA, has no reference script and has an inline datum. A fake costs a request only once its datum names scripts that its own transaction put at the holder (:584-587) | tests/lovejoin-discovery.test.ts:159 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:579` | Taking a launch younger than SETTLE_MS (one rolled back or made again elsewhere). The next look's height stops short of its block | tests/lovejoin-discovery.test.ts:227 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:632` | A pool being standard unless its launch registers L or an earlier block did (`<` on block seconds) | tests/lovejoin-discovery.test.ts:195 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:182` | shown(): two pools of one value (set, box ADA, token, Q) both being shown. Only the earliest by block, index and id is | tests/lovejoin-discovery.test.ts:142, :249 |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:411` | Trusting a pool whose NFT policy isn't one_shot_mint(seed), or whose datum's M/L/F aren't the scripts derived from that seed | seedelf-core/tests/lovejoin_pools_test.rs:470 |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:175` | A datum outside one_shot_mint's ranges: box_lovelace 0, max_fee not under the box, Q of 0, which would make tokenAt and tokenBoxes divide by zero, a name over 32 bytes | seedelf-core/tests/lovejoin_pools_test.rs:649 |
| `seedelf-platform/seedelf-core/src/lovejoin/pool.rs:602` | A new box in a pool whose box is under the ledger's minimum (BelowMinimum). And :637, CantComeBack: a box whose withdraw can't pay its own Seedelf output, which is said, not refused, since call 34 | seedelf-core/tests/lovejoin_pools_test.rs:2491, :2563 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4198` | usableNow: a new box in a retired pool, a copy (superseded) or a pool below the minimum, refused before anything is funded | tests/lovejoin-retired.test.ts:233; tests/lovejoin-merged-review.test.ts:1049 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:701` | adaPoolOf: a return's ADA or collateral going into any ADA pool but the earliest v2 5 ₳ one, never a copy, so a launcher's ADA pool at another value never takes them | none found by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:2934` | verifiedPool: the classic pool's own scripts being read as a token pool. Also readSet (:2902), which keeps one pool per id or mix_box | none found by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:258` | The wallet's own launch below S0d's least (a box that can't pay part of itself back alone), or a token box over 9 ₳ (:259) | tests/lovejoin-flows.test.ts:847 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:253` | Launching a copy of a shown or handed-over v2 pool's values (23 ₳ locked for a pool no wallet shows) | tests/lovejoin-merged-review.test.ts:436, :593 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:426` | choose(): a start whose L someone registered first being sent with cert 0 (refused), or sent without it as a different pool whose L nothing registered (lj.launch.otherPool) | tests/lovejoin-flows.test.ts:941 |
| `seedelf-platform/seedelf-core/src/lovejoin/value.rs:124` | k boxes' token total past 2^64-1 (a Q near u64::MAX) wrapping a deposit's or withdraw's token amount | wasm lovejoin-pools.test.mjs (the message, per R3a) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1912` | funding and per_box_in (:1934) overflowing on a launcher's huge box ADA. deposit_across's boxed sum (:789) and the change after the fee (:806) are checked the same way: refused as MORE_THAN_THERE_IS | none found by name (314-core#1's fix) |
| `seedelf-platform/seedelf-core/src/lovejoin/box_value.rs:191` | check_token: a token box of Q 0 reaching pallas, which panics, a WebAssembly trap | seedelf-core/tests/lovejoin_box_value_test.rs (MONEY-2) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/LovejoinReturn.tsx:270` | A return's or swap's token going into a pool whose boxes can't pay their own way back with no word beside it (call 34's warning) | tests/lovejoin-planner.test.ts (a return through LJTEST at 4,800 a byte, per session 5) |

## Checked and holds

- Only listed tokens' pools (and ADA pools other than 10 ₳) are kept (listedValue, launch check). A Lovejoin pool is therefore named everywhere (hub group title, pool page, TokenWays, swap approval) by tokenText's listed ticker. e9b#1's fold and plainName never apply to a Lovejoin pool's name: plainName and sharedNames are used only for stake pools and DReps (Pools.tsx, Voting.tsx). If an update delists a token, its kept pools' group title carries tokenMark.
- A launcher controls only the seed and the values (box ADA, token, Q, max_fee). Every script, address and reward account the wallet uses is derived from the seed (verify_pool/derived_from, protocol_of fills data-layer script rows from its own derivation).
- max_fee is used only by the datum's range check (0 < max_fee < box). No consumer reads it, and the shown rule ignores it (valuesOf).
- A reference output carrying extra tokens, or a datum in tag-102 or bignum form, hides the pool (holdsNft, nft_policy, ReferenceDatum::decode). The wallet's shown rule runs only over kept pools, so a hidden pool never takes a value's shown slot on the device.
- Scripts inline or by reference: a pool is shown only with both scripts at the holder in its launch transaction (verified's scriptsInline 0; holder()'s has(M) && has(L) within byTx; refresh()'s every-script-in-the-launch-tx check). A script row with an over-deep datum is no reference, so that pool isn't shown.
- Extra rows at the holder: fakes are dropped by the cheap checks or the launch check, at about 1.8-4 ₳ burned each. Only the launch transaction's own rows are taken as a pool's scripts.
- Front-running the user's launch by registering L: choose() sends the bare build once account_info says L is registered, and a pool whose L an earlier block registered is standard on the Koios rule (first < launch time). A front-run between check and landing gets the launch refused in phase 1, losing nothing.
- A launch racing a shown pool's values can't displace it after the fact. A pool handed over becomes a copy only if an earlier launch turns up, and it stays read. A race for the user's own start costs the user its about 23 ₳ at worst, and the hub's startedCopy line says so.
- Q extremes: decode refuses 0; token_total refuses k×Q past u64; the TS figures are BigInt. The only Number() conversions are of quotients capped by small constants (sessions.ts:1745, Lovejoin.tsx:3706), and of a sort key (lovejoin.ts:7607).
- A small Q: the swap approval's tokenRest line (Swaps.tsx:1295, :1628) says how much of the token comes back directly beside the boxes. Box counts are capped by one deposit, one chain and the pool's room.
- Huge box ADA: per_box_in, funding, deposit_across and withdraw_with's `coming` are checked. withdraw_with's unchecked `denom * len` (mod.rs:1453) would overflow only on boxes holding more than the ADA supply. formatAda is exact (5.000001 ₳ shows as such), so a near-5 ₳ ADA pool isn't a lookalike of the 5 ₳ pool.
- Divisions: boxesAffordable and perBox divide by the funding's count (at least 1, from the stepper). poolRoom and tokenAt divide by perBox (at least 2 at depth 1 or more). bootstrapProgress guards a floor of 0. plan_across uses Q.max(1).
- Retire rules: isRetired is by version. A launcher's pool on 8131b1d's set is derived as TokenV1, retired, takes no box, and is never a copy of a v2 value.
- Stuck pools (call 34) are said wherever a box goes in: the hub row's flag, the pool page's callout before Review, the reviews' StuckReviewNote, TokenWays beside the token (swap approval, return reviews, SiteSessions, Stop), ClaimAll, and Bring every box back's question (the private balance pays, and what that ties).
- An approved or reviewed pool is never swapped for another at the return: acrossOf takes the named pool or sends the token back directly ('poolCant').
- Figures on the hub and pool page that depend on a launcher's values (boxText, valueOfBoxes, the stepper, MixMoves, TokenBoxesRows, LaunchTotals) are BigInt and add up as E8a found.

## Notes

- How the launcher gets the default pool, for gap-g5#1: tokenPool and acrossOf pick the most used pool that meets the floor, and the launcher's own parked boxes count. The hub's comment admits 'parked boxes can buy rank'. With their boxes alone in the pool, the launcher traces the user's boxes: that is the flood attack (privacy.md:218, settled). It's the value the launcher chose (sub-S0d) that's new. Lovejoin's own app defaults to 2 ₳ boxes (chunk-34:296), so any Lovejoin-app launch that publishes its scripts at the holder makes such a pool without hostile intent.
- D1's pool-spam threat ('the costs and the threat still stand'), a new fact. status() measures every listed token pool with a synchronous WebAssembly withdraw build: usableNow and cantComeBack, at lovejoin.ts:6421-6470. The caches (usables, comeBack, verified) are in memory only, so this repeats at the hub's first read after every worker start and every epoch. Chunk 16 timed 16-68 ms per evaluation in Node, and a withdraw's fee loop runs 2-3 of them. ADA pools at any amount but 10 ₳ are shown, so the listed-token defence doesn't bound them: at about 23 ₳ a pool, 100 pools would add roughly 5-15 s, during which the worker answers nothing. Not measured: a verifier could time lovejoinUsable in Node before the owner weighs it.
- Data-layer consistency (outside the chunk; seedelf-data wasn't read). The wallet hides pools that one_shot_mint would mint: tag-102 or bignum datums, extra tokens at the reference output. It also counts an L registration only from an earlier block (`<` on block seconds). If the data layer's own rule is laxer on either, mainnet's data-layer path could treat such a pool as a value's earliest and leave out the later standard one. Then mainnet wallets would show no pool for that value, and Koios-path devices another. That would undo a user's 23 ₳ launch of it. Worth confirming in tests/fixtures/lovejoin-shown.json's shared vectors (R3b raised the datum half).
- A doubt on R3b's cert-0 front-run, not traced. After a phase-1 refusal, choose() sends the bare build. Built without the 2 ₳ deposit, that build may pick another seed (lovejoin-launch.ts:427-429 says so). If it does, every review from the same UTxOs ends in 'lj.launch.otherPool', whose words say 'Review it again later'. I didn't trace whether select_script_inputs' smallest-first apart() can pick a different first input from the registering build's inputs. Each round costs the front-runner 2 ₳ for good, and paying from the public account or changing the UTxOs gets past it.
- Found pools aren't held to the 9 ₳ cap either (decision 27 is the creator's). A token pool with 1,000 ₳ boxes is shown and picked as any other. The approval shows the boxes' ADA as funded and coming back, so no money goes unsaid, but the capital sits in an unaudited contract for hours.

## Coverage

Read in full, every line:
- background/lovejoin-pools.ts (687)
- ui/lovejoin-pools.ts (182)
- background/lovejoin-launch.ts (460)
- seedelf-core lovejoin/pool.rs (645), box_value.rs (403) and value.rs (131)
- src/lovejoin-pools.json, decoded pool by pool with one python3 -I summary
- Lovejoin 29573c5 via git show: one_shot_mint.ak, mix_logic.ak and lib/lovejoin/reference.ak, plus types.ak, value.ak, mixbox.ak, mix_box.ak and reference_holder.ak

Read in the ranges named:
- lovejoin.ts: 600-940 (isRetired, adaPoolOf, valuesOf, poolChoice); 2800-3420 (readSet, verifiedPool, unreadCopies, progress, watchOf, poolNamed, cantComeBack, privateBootstrapMost/Bounds, poolsOf, usable, stuck, mixBoxes, listing, poolRows, lookForPools, wouldRead, ours, plan, fits' head); 3905-4000 (acrossOf's token pool choice); 4140-4380 (planAcross, usableNow, takesNewBoxes, adaPool, retiredIds, retireOnce, collateralPool's head); 4610-4650 (mixLogicHashes); 6395-6500 (status's per-pool view)
- wasm lovejoin.rs: 140-330 (mix_logic, protocol_of, CollateralTail), 600-910 (PoolView, verify_pool, candidate, launch_check, usable) and 2930-3038 (box_value, finish)
- core mod.rs: 120-470 (Protocol, PoolBox), 660-870 (deposits), 1220-1750 (withdraw, withdraw_paid, withdraw_private, withdraw_with's fee loop) and 1750-2200 (estimates, reserves, funding, plan_across, bootstrap_most)
- launch.rs: 1-420. The rest is R3b's.
- Lovejoin.tsx: 120-520 (constants, poolRoom, formRoom, boxesAffordable, mixMost, mixOffer, publicPick), 1925-2010 (hub), 2240-2350 (PoolGroupList), 3150-3420 (pool page form state, cost rows) and 3770-3790, plus greps of every state (cantComeBack, unusable, copy, retired) and every Number() conversion
- LovejoinLaunch.tsx: 1-200
- format.ts: 1-140 and 440-479
- sessions.ts: 1600-1800 (quote, lovejoinCost, tokenPool, tokenAt)
- LovejoinReturn.tsx TokenWays (215-300); Swaps.tsx 1280-1300 and 1575-1800
- koios.ts: credentialUtxos, launches, firstRegistrations
- tokens.ts: tokenText, lookalikeOf
- dapp.ts: 2090-2120

Docs read: COMMON.md, INDEX.md, lanes R3b, E1a, E8a, X2 and E9b; chunk-34-token-pools.md (design sessions 1-3, decisions 30-33, §2-§7, S0d, session 5, D1, For the owner, Still open); privacy.md's Lovejoin section (395-440); backlog.md's Lovejoin section and chunk 34's leftovers.

Not reached:
- LovejoinLaunch.tsx 200-460 (review and sent states; E8a read them)
- Lovejoin.tsx's other parts line by line (E8a's)
- launch.rs 420-796 (R3b's)
- select_script_inputs' apart() ordering (the cert-0 doubt in notes)
- seedelf-data, by the brief

Nothing was built or tested. The only runs were reads, git log/blame and the one python3 -I summary of the bundled JSON.
