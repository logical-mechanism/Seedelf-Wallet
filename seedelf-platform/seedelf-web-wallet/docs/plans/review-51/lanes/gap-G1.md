# Lane gap G1

Returned by the workflow's agent `a3373795594ec7885`, written here by the lead from its structured answer.

## Findings (2)

### gap-g1#1 · medium · A stranger's payment under a register already on chain (a Seedelf's own, d = 1, or a copied datum) is classed Received, and the stealth mint, every session funding and the private pool start take it first, tying them publicly to that Seedelf and, by the default mint, to the public account

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/activity.ts:389`
- **Who:** stranger · **Since:** d5710a24 / 366cd5c6 (2026-09-27, privacy review §2.3: history classes, and Mint and Fund ranking Received first), before web-wallet/1.0.0; the mint form's words since 1211a5d2. In every tag from web-wallet/1.6.0 to 1.9.1. · **Confidence:** traced
- **Needs the owner:** It changes what selection takes first for the stealth mint and the fundings (a privacy default), adds a tag and review words, and changes privacy.md's and the README's claims about received money. Reordering Mint (a box ahead of received money) is a design call.

**Scenario:**

The user's first Seedelf A was paid for by the public account ω, the default (privacy.md:80, :106), so A is tied to ω in the open. The user also holds 30 ₳ and 50 ₳ that Bob and Carol paid A correctly, and 500 ₳ made private from ω. Mallory, a stranger, reads the inline datum of the UTxO holding A's token. Receive hands out A's name, and the contract is public. She pays the Seedelf contract 4 ₳ under that datum byte for byte (d = 1), at a cost of about 4.2 ₳ that the user keeps. Instead she can copy the datum of any contract UTxO she can tie to the user, such as a Make private output in ω's own transaction.

The wallet counts it as the user's (is_owned holds) and notes it as a payment received, class received:<tx>, tagged Received on the UTxOs screen. Nothing compares its register with A's, though the kept view holds both.

(1) The user creates a stealth Seedelf B from the private balance. That's the default when the public account is empty. The form says "Only money others paid you keeps the Seedelf apart from your public account." Purpose::Mint ranks Received first, and step 1 takes the smallest received UTxO that pays alone. Mallory's 4 ₳ pays it (about 1.75 ₳ locked, 0.26 ₳ fee, the rest change), so it is taken ahead of Bob's 30 ₳. The review has no histories note, since there is one class. On chain, B's mint spends an input whose datum equals A's, and B's name even carries that input's outpoint. Anyone can see A's owner made B, and A's mint was ω's: B is tied to ω, which is exactly what a stealth mint is for avoiding. Bob's 30 ₳ would have tied it to nothing public.

(2) Every session funding uses Purpose::Fund, which ranks Received first after a top-up's own session. If Mallory sends, say, 30 ₳ under A's register and it is the smallest received UTxO that pays a funding alone, the funding takes it: a swap, a site's private session (where the site watches its funding), a private Lovejoin mix, Mix my boxes again, a top-up, or Put in 5 ₳. The one-time account, its swap or site activity, every mix it pays and a new mix's deposit are then publicly tied to A and to ω. privacy.md:356/:378 and the swap and dApps notes say only money made private yourself leads back to the public account. privacy.md:454 says Mix my boxes again pays from the private balance so as not to tie the boxes to the account.

(3) A pool started from the private balance (the default) also uses Purpose::Mint. Its review says "Anyone can see a spend from the Seedelf contract started a pool, but not whose spend it was", but the spend is A's owner's for anyone.

After a restore, every older UTxO is Unknown, so Mallory's is the only one classed received and goes first for any mint or funding it pays alone. More generally, any payer knows which UTxO it paid, so it can tie whatever that UTxO later pays for to the Seedelf it paid. It can make that public by writing d = 1, a small d, or by publishing its d. Only the exact copy can be spotted on the device.

**Evidence:**

Trace:
1. chain.ts:84-114 registerOf reads the copied datum's two points. balances.ts:489-506 ownedUtxos asks only keys.seedelf.isOwned. register.rs:176-197 is_owned holds because R_A = (g^d, (g^x)^d) (lib.rs:2811 account mint: Register::create(sk)?.rerandomize()). Nothing else is checked. `grep -rn registerOf background/` gives only contract-scan.ts:401 (locatorOf), balances.ts:491 and tx-view.ts:280 (ownership for display). No code anywhere compares two registers. The kept view has what a check needs: contract-scan.ts:78-84 Locator.register for every Seedelf, and view.owned with the user's own Seedelf UTxOs and their datums (contract-scan.ts:167-184, :331-342).
2. activity.ts:427-470 arrived: the tx isn't the wallet's (:431 `ours`) and holds no Seedelf token (:441), so it gets kind "received" with no origin. classes (:389-420) calls classOf, and :656-657 returns receivedIn(tx), origin "received". script-spend.ts:261-268 classesOf hands it to WebAssembly. check_spendable (lib.rs:2316-2341) checks only ownership, the Seedelf token and the evaluator.
3. Mint: mint.ts:106-133 (header :10-14: "takes received money first"). lib.rs:2396-2417 mint_spend calls build::mint_apart(…, histories(Purpose::Mint, …)). build.rs:2394-2400 ranks Received 0, Lovejoin 1, Unknown 2, Own 3, Session 4. :2564 means not blind, so apart runs. :2709-2712 and :2608 one_more sorts by (rank, lovelace), smallest first, and the first that pays alone is taken. Pinned as designed by seedelf-core/tests/mint_test.rs:2671 a_stealth_mint_takes_received_money_before_money_moved_in (20 ₳ received beats 1,000 ₳ moved in).
4. Fundings: sessions.ts:3050-3075 buildFunding sends `funding: { session: sessionClass(index).id }`. lib.rs:3506-3511 and :4808-4813 turn that into Purpose::Fund, and build.rs:2401-2412 ranks the session's own 0 and Received 1. Callers: outBuild :1911/1933 (swap), siteOutBuild :2031-2074, mixFunding :2236-2316 (a private mix, Mix my boxes again via againBuild :2198-2225, a private Bootstrap), topUpBuild :2364-2392, collateralTopUp :2502-2511.
5. Launch: lovejoin-launch.ts:320-352 fromPrivate, then lib.rs:2680-2697 build_launch with histories(Purpose::Mint).
6. Review: script-spend.ts:201-205 spentHistories gives one class. shared/histories.ts:193 says nothing for one class, so HistoriesNote (CreateSeedelf.tsx:156) renders nothing.
7. Name: transaction.rs:114-141 seedelf_token_name names the Seedelf after its smallest input (index ‖ tx id).

Claims contradicted: privacy.md:81 ("hides the payer only when that balance came from other people's payments … takes received money first"), :107 ("out of money you received: hides the payer … what its coin selection takes first"), :170, :356, :378, :454. en.json:1442 mint.privacy.fromPrivate, :1385 lovejoin.launch.privacy.fromPrivate, :1403 lovejoin.launch.privacy.private, :2445 swaps.privacy.oneTime, :551 dapps.privacy.oneTime. README.md:193 (σ' has no link to ω if paid from other people's payments).

The wallet's own outputs never do this: build.rs:336 deposit_output re-randomizes each output, pinned by api_test.rs:1941. So the shape is only ever someone else's.

**Fix:**

Two parts, and the owner decides the second.

(a) Spot the shapes the device can see, with no request. In activity.ts classes (or readContract, which has the view), key each spendable UTxO by its register (registerOf's hex). Compare that key with every other row of the kept view: the user's own Seedelf UTxOs and other owned UTxOs in view.owned, and every Seedelf's Locator.register in view.seedelfs. A match means the chain already ties the UTxO. Give it the matched row's history merged with its own:
- one of the user's Seedelfs: who paid for it, from minted-by's record (madePrivate(account), or the mint's inputs' class);
- another owned UTxO: that UTxO's class;
- someone else's Seedelf: a class of its own ranked last.
Mint and Fund then take it last. The UTxOs screen tags it, and the review says what it ties (new .privacy. keys). Keeping a digest of every register the history has seen would also catch copies of spent UTxOs.

(b) The words. Wherever received money is said to hide the payer, say that whoever paid it knows which UTxO it is, can tie what it pays for to the Seedelf they paid, and can make that public. That covers privacy.md:81, :107, :170, :356, :378, :454, the en.json keys above, flows.md:356 and README.md:193.

For the owner: whether the stealth mint should rank a box back from Lovejoin ahead of received money, since no payer knows a box.

Same class: e1a#1 (a stranger's Lovejoin deposit under the wallet's register, taken first by Mix my boxes again) and gap-g1#2 (the wallet's own site-signed payments classed received).

Tests:
- Vitest, in history-classes.test.ts' style: a kept view with the user's Seedelf UTxO (datum D) and a stranger's UTxO from another transaction with datum D. activity.classes gives origin "received" today.
- Rust, in mint_test.rs' style: mint_apart over 500 ₳ public:0, 30 ₳ received:a and 4 ₳ received:b (datum = the Seedelf output's) takes the 4 ₳ today.

**Known check:**

Searched backlog.md (every ⬜, ❓ and Declined line), every docs/archive/plans/*.md, privacy.md, flows.md and architecture.md for: as found, d = 1, bad d, copied, copy of, same register, duplicate, dusting, taint, payer knows, who paid you, the payer can, received first, takes received.

Hits:
- chunk-09-transfer.md:70 and privacy.md:77: the wallet's own rule to re-randomize.
- README.md:167: the bad d value (settled as an attack; this finding is the ordering and the words).
- independent-review.md:52: the dusting tracer is a session's tokens.
- review-1.7.1.md:60: "a payer knows theirs", about media/, out of scope.
- privacy-review.md §2.3 (173-240): builds received-first on the premise that received money hides the payer, and never considers a payer who reveals d.

INDEX: x1a#2 is the sign window's words for a site's payment written as found. Its note handed this private-side shape to X2, which didn't take it up. e1a#1 is the Lovejoin-pool sibling. r2a#3 is a stranger's token bundle. None covers the private balance's selection order.

### gap-g1#2 · low · A payment the user's own public account, or a private session, makes into the user's Seedelf through a site is classed Received, so the stealth mint and fundings take it as money others paid

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2644`
- **Who:** site · **Since:** d5710a24 (2026-09-27, history classes), over the connector from chunk 15; before web-wallet/1.0.0 · **Confidence:** traced
- **Needs the owner:** It keeps a new kind of record (a site's transaction) in the sealed Seedelf history, a data-handling change with a privacy-policy entry, and it changes the UTxOs screen's tags.

**Scenario:**

The user connects a Seedelf-aware site on the public account ω. Examples are a page that pays a Seedelf name, or the CLI's own fund page at 127.0.0.1:44203, which the connector serves. The user signs its transaction paying 20 ₳ into their own Seedelf, and the sign window says "It pays a Seedelf. Nothing on chain says whose, but it comes from your public account in the open." The connector sends it and writes nothing into the Seedelf history. When the contract scan finds the UTxO, it is noted as a payment received, class received:<tx>, and tagged Received on the UTxOs screen.

The private balance also holds 40 ₳ that Bob paid and 500 ₳ made private. The user then creates a stealth Seedelf from the private balance. Purpose::Mint takes received money first, smallest first, so the 20 ₳ goes ahead of Bob's 40 ₳. The mint spends an output of ω's own transaction: the new Seedelf is tied to ω in the open. There is no histories note (one class), and the form says only money others paid keeps it apart. The same goes for any later session funding (Received ranks 1, money made private 4).

The same holds for a site on a private session that pays the user's Seedelf from its one-time account. The output is tied on chain to that session. Read as received rather than session money, the next swap's or site's funding takes it first rather than last (privacy.md:170: 'another session's money last'). The two sessions are tied, and the funding's review names no other session.

**Evidence:**

- dapp.ts:2583-2618 send, then :2644-2680 keepSent. These keep only what the transaction spends (rememberSiteSpent), its outputs for the site (SESSION_DAPP_SIGNED) and a stale mark. Nothing goes into the Seedelf history.
- sessions.ts:2639-2663 siteSigned records only what pays the session's own account (paysAccount(…, keyHash)) into siteOuts.
- activity.ts:207-217: SEEDELF_KINDS excludes site transactions, and :309 returns for them.
- activity.ts:427-470 arrived: the tx isn't in `ours` (:431), so it gets kind "received", and :656-657 gives receivedIn.
- Ranks: build.rs:2394-2412 (Mint: Received 0, Own 3; Fund: Received 1, Own 4, another session last via tier 1).
- The wallet already knows the output is its own when it signs: tx-view.ts:280-283 ownRegister marks it 'yours' for Transaction details.
- The class is already handled for one path: sessions.ts:1240-1249 ownClassed and :2496-2511 collateralTopUp treat outputs of a transaction the session's key signed as the session's (`recovered.own`, 'tied to the session on chain already', 1.5.0 review C36). That covers only a restored session's 5 ₳ top-up.
- privacy.md:165 says money 'made private from a public account' gets that account's history.

**Fix:**

When the connector submits a site's transaction it signed (dapp.ts send/keepSent, or at signTx), note every output under the wallet's own register in the Seedelf history: origin madePrivate(account) for the public account, sessionClass(index) for a private session. tx-view.ts ownRegister already finds them. arrived then skips them as the wallet's own, and classes ranks them as own or session money. That widens ownClassed/recovered.own from collateralTopUp to every funding and the stealth mint.

Money another wallet or browser with the same phrase makes private after this device's history began also reads as received. The device can't tell without asking, so privacy.md:173 should say so.

Test: in dapp.test.ts, a signed and submitted site transaction pays the contract under a fresh re-randomization of the wallet's register. After the scan, activity.classes gives received:<tx> today; it should give public:<account>.

**Known check:**

Searched backlog.md, archive/plans/*.md (independent-review M4/M8, chunk-15/15c, review-1.5.0's C36 via sessions.ts) and privacy.md for: received, siteOuts, own register, a site's payment, Seedelf history and dapp, classed. C36 fixed only collateralTopUp's restored-session case, and M8 is about read timing. Nothing records a site-signed payment's history. INDEX: x1a#2 covers the window's words for a site's Seedelf payment, not its class afterwards.

## Guards (11)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:2316` | check_spendable stops a Seedelf spend (mint, transfer, withdraw, launch, return merge) from paying with a UTxO that isn't the wallet's (is_owned), holds a Seedelf token (it would go out as change), or carries something the evaluator refuses. | wasm/tests/api_test.rs:1045 ('holds a Seedelf'), :1053 ("isn't this wallet's") |
| `seedelf-platform/seedelf-crypto/src/register.rs:190` | is_owned is false for an identity generator or public value. Every key would 'own' (identity, identity), and anyone can spend it. | seedelf-crypto/tests/register_test.rs:64, :74, :84 |
| `seedelf-platform/seedelf-crypto/src/register.rs:141` | rerandomize refuses points outside the prime-order subgroup, so no deposit, change or Seedelf output is written under a register the validator would never accept (locked for good). | seedelf-crypto/tests/proptest_crypto.rs:40 (positive only; no negative test found by name) |
| `seedelf-platform/seedelf-core/src/build.rs:336` | Every contract output the wallet makes (move-in, Send to a Seedelf, change, merged return, Remove) goes under its own fresh re-randomization, never a register as found or one reused across outputs. | wasm/tests/api_test.rs:1941; seedelf-core/tests/mint_test.rs:381, :1501 ('fresh register') |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:2405` | A stealth mint's Seedelf output sits under a fresh re-randomization of the base register, never the base register itself (lib.rs:2811 does the same for the account mint). | seedelf-core/tests/mint_test.rs:373-381 |
| `seedelf-platform/seedelf-core/src/build.rs:3048` | mint_from refuses a Seedelf register that doesn't decode, has torsion or is the identity, which would lose the Seedelf and anything sent to it. | none found that isolates the identity half (t1b#10) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1433` | A Lovejoin withdraw refuses a destination register that isn't payable, so a box never comes back under a register nobody, or anybody, can spend. | none found by name |
| `seedelf-platform/seedelf-core/src/build.rs:2152` | A script spend's change into the contract below its minimum is refused as short (not enough), never written as an unspendable dust output. | seedelf-core/tests/mint_test.rs (shortfall cases; not isolated by name) |
| `seedelf-platform/seedelf-core/src/transaction.rs:130` | seedelf_token_name refuses to name a Seedelf after an output index over 255, which the policy's one-byte index can't express (the mint would fail on chain). | none found by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/balances.ts:499` | ownedUtxos rethrows a WebAssembly trap instead of taking the row for someone else's, which the private index's sealed record would keep for good. | none found by name |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:299` | spendable keeps Seedelf-holding UTxOs and UTxOs carrying a reference script out of every private spend and the balance, so neither is taken as change or sent into a spend the evaluator can't build. | none found by name |

## Checked and holds

- No output the wallet builds repeats a register across transactions, or within one:
- deposit_output re-randomizes each output (build.rs:330-348).
- mint_from writes the Seedelf under a register re-randomized fresh for each build (lib.rs:2404-2405, :2811).
- Each Lovejoin withdraw draws a fresh destination (wasm lovejoin.rs:2691, :2793, :2892).
- Deposits draw one fresh owner per box (:1655-1658, :1755-1760, :2320-2322), and the collateral tail one per build (:291).
- Mixes draw a fresh nonzero y per output box (core lovejoin/mod.rs:996-1002).
The only fixed registers (pool.rs:620, box_value.rs:275, mod.rs:2111) are in measuring probes that are never sent. The CLI's util mint -g -p is r4#8.
- Nothing compares an incoming register with another. registerOf is used only by contract-scan's locatorOf, balances.ts ownedUtxos and tx-view's ownership mark. check_spendable checks only is_owned, the Seedelf token and the evaluator. The kept view holds every Seedelf's register (Locator.register) and the user's own Seedelf rows, so a check needs no request.
- The histories note says nothing for a spend of one class: a lone received:<tx> input gets no note (histories.ts:193; spentHistories at script-spend.ts:201-205).
- Purpose ranks match privacy.md:170:
- Mint: Received 0, Lovejoin 1, Unknown 2, Own 3, Session 4.
- Fund: the session's own 0, Received 1, then Lovejoin, Unknown and Own, with another session's money in tier 1.
- Pay: Own first.
Step 1 takes the smallest UTxO that pays alone, by rank (build.rs:2384-2420, :2600-2632, :2709).
- A funding goes as one transaction first and in parts only when one can't take it (lib.rs build_withdraw_parts tries build_withdraw first). Both use Purpose::Fund, and by_history_first/Worth::apart order the parts by the same ranks.
- arrived() skips the wallet's own sends and every Seedelf-holding UTxO. What the first reading finds is Unknown, except UTxOs made well after the history began (activity.ts:427-470, L38). classes() makes a session's entries one class and splits Unknown by transaction while anything is known (activity.ts:389-420, L40/L41).
- TS merged and Rust merged_class give the same ids and the same origin (REACH: session > own > received > lovejoin > unknown). A spend's change keeps its inputs' merged history (changeHistory), a part's carry the part before's (carried, Carried).
- registerOf (chain.ts:84-114) reads exactly constructor 0 (121, or 102 [0, …] with a definite pair) with two 48-byte strings and nothing after, and leaves validity to WebAssembly's is_owned, which refuses points that don't decode, have torsion or are the identity.
- A stealth mint's change goes back under fresh re-randomizations of the base register, and its Seedelf is named after the smallest input by outpoint, as the policy checks (transaction.rs:114-141).
- The private Bootstrap's own review already says it hides nothing of the user's and ties the private UTxOs it spends to the boxes (en.json:1185, :1210).

## Notes

- For the owner (gap-g1#1): only an exact copy of a register can be spotted on the device. A payer who uses d = 2 and publishes it, or a small d (the README's bad d value), ties the UTxO just as publicly, and the wallet can't afford to search d. Any payer always knows its own UTxO. So the wording fix carries the rest. For the stealth mint, a box back from Lovejoin (Mint rank 1) is known to no payer; whether it should come before received money is a design call.
- Make public and Send (Purpose::Pay) rank Received 2, after own money and session money, so a tagged UTxO is taken there less often. When it is, the recipient's address is tied to the public account through the Seedelf the payer tagged. privacy.md doesn't claim otherwise for Make public.
- Bring one back now paid from the private balance (withdraw_private's payer: a box first, then the smallest that pays) can take a tagged UTxO too, but its question already says it ties that UTxO, and where it came from, to the box (privacy.md:422).
- Money that another browser or device with the same phrase makes private after this device's history began is noted as received (activity.ts:449, pinned by tests/history-classes.test.ts:31 'what arrives after as received'). Mint and Fund then take it first though it's the public account's. The device can't tell without asking the server, and privacy.md:173 says only that the first reading's finds are Unknown. For the owner: wording.
- The stealth mint names the new Seedelf after its smallest input (transaction.rs:114-141). The payer of that input recognises the new Seedelf from its name alone, before reading the mint transaction.
- Put in 5 ₳ for Lovejoin (collateralTopUp) takes the session's own transactions' outputs first (ownClassed), then received money, so a tagged UTxO can fund it. Its review already says it ties the private UTxOs it spends to the session.

## Coverage

Read in full: the brief (COMMON.md), INDEX.md and LANES.md; X1a's report, E1a's e1a#1, and the parts of RESUME.md and FIX.md that bear on this lane. Code read in full:
- extension/src/shared/histories.ts, background/mint.ts, background/chain.ts, background/contract-scan.ts;
- seedelf-crypto/src/register.rs;
- seedelf-core/src/build.rs 2290-3100 (Histories, Purpose ranks and tiers, select_script_inputs, one_more, grow, apart, max_inputs_by, holding, the mint builders), plus 320-480 (deposit_output(s), change_outputs), 2085-2175 (remainder, stage) and 3427-3450 (sweep_many_apart);
- wasm/src/lib.rs 2080-2480 (ClassIn, histories, origin_of, merged_class, Carried, classes_mixed, MintRequest, check_spendable, mint_spend, build_mint, mint_result) and 3640-3905 (Worth, by_history_first, same_order).

Read in the ranges named or needed:
- activity.ts 1-260 (header and types, skimmed past the account half's helpers), 260-480 (sent, classes, arrived), 600-660 (update, classOf). The Cardano-account half (480-600, 700-920) was not read.
- script-spend.ts 1-420 (readContract, sendingChains, classesOf, nothingToSpend, spendable, measureLocally, keep, the head of send).
- balances.ts 395-506 (seedelfSide, keep, spendableOwned, ownedUtxos).
- sessions.ts 2025-2460 (siteOutBuild through cancelCollateralBuild's head) and 3000-3135 (accountUtxos, markUnsent, buildFunding, keepFunding), plus 1240-1250 (ownClassed), 560-600 (record fields), 2470-2520 (backCollateralBuild, collateralTopUp), 2630-2665 (siteSigned) and outBuild's head.
- lovejoin.ts 3120-3175 (privateBootstrapMost, privateBootstrapBounds) and 3575-3650 (funding). The private Bootstrap's return and withdraw_private's payer were not read.
- lovejoin-launch.ts (grep of fromPrivate).
- lib.rs 2670-2720 (build_launch), 3025-3080 (transfer_plan), 3280-3310 and 3490-3530 (WithdrawRequest, withdraw_spend's purposes) and 4740-4980 (build_withdraw_parts, withdraw_result).
- Core lovejoin/mod.rs 670-700, 976-1030 and 1280-1520; wasm lovejoin.rs 270-310, 1640-1670, 1745-1770, 2305-2330 and 2640-2700.
- transaction.rs 114-142 and 195-260.
- dapp.ts 2556-2700 and tx-view.ts 265-300.

Docs read:
- privacy.md: all of it but Staking/Network detail;
- the root README.md 104-200;
- flows.md 340-360;
- privacy-review.md §2.3;
- en.json's mint, launch, session and Bootstrap privacy keys;
- the backlog and archive searches as listed.

I ran nothing but reads and greps, and built nothing.
