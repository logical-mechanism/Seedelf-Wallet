# Lane critic

Returned by the workflow's agent `a9fdc49516d44affa`, written here by the lead from its structured answer.

## Findings (0)

None.

## Other fields

```json
{
 "gaps": [
  {
   "id": "G1",
   "title": "Received money a payer can tag, taken first by default",
   "paths": [
    "seedelf-platform/seedelf-web-wallet/extension/src/background/mint.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts (lines 2031-2451: siteOutBuild, mixOutBuild, againBuild, mixFunding, topUpBuild; lines 3026-3127: buildFunding)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/activity.ts (arrived, classes, classOf)",
    "seedelf-platform/seedelf-web-wallet/extension/src/shared/histories.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/balances.ts (ownedUtxos, spendableOwned)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/chain.ts (registerOf)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts (readContract, spendable)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts (the Mix and Bootstrap funding from the private balance, privateBootstrapMost)",
    "seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs (lines 2080-2440: histories, Carried, classes_mixed, check_spendable; lines 3640-3905: Worth, by_history_first, same_order)",
    "seedelf-platform/seedelf-core/src/build.rs (lines 2320-2980: Histories, select_script_inputs, apart, max_inputs_by, holding)",
    "seedelf-platform/seedelf-crypto/src/register.rs (is_owned, rerandomize)",
    "seedelf-platform/seedelf-web-wallet/docs/privacy.md (Co-spending, Creating a Seedelf, private sessions, Lovejoin) and README.md (De-Anonymizing Attacks)"
   ],
   "focus": "A payer always knows which UTxO it paid a Seedelf. With d = 1 (the register as found in the Seedelf token's own UTxO), or a re-sent copy of one of the user's own UTxO datums, everyone can tell. Such a UTxO is owned (is_owned holds) and is classed 'received:<tx>'. By default, selection takes received money first for a stealth mint and for a session's funding (privacy.md:81, :107, :170; flows.md:356; W1a's note says a stranger's bundle ranks first for a funding). Trace which flows take it first: the stealth mint; site, swap and Lovejoin-mix fundings; top-ups; the private Bootstrap and launch. For each, say what the chain then ties against what privacy.md claims: the new Seedelf to the paid one (and through it, by the default mint, to the public account), a site's one-time account to that Seedelf, a Lovejoin deposit to it. Check whether anything compares an incoming register with the registers contract-scan keeps for the user's Seedelfs, or with another owned UTxO's register, and whether the review's histories note says anything. Also confirm no output the wallet makes ever repeats a register across transactions. Who: stranger, or any payer, a site included. Settled, don't report: the README's 'bad d value', and the flood attack (privacy.md:218). The question is the wallet's own default ordering and wording.",
   "why": "X1a's notes raised exactly this shape ('A stranger can pay the user's Seedelf under that Seedelf's own register as found ... mint.ts's header says a stealth mint takes received money first, so this UTxO may be exactly what ties a new stealth Seedelf to the one the stranger paid') and handed it 'For X2 and the owner (private side, not traced through select_script_inputs' order)'. X2's coverage never takes it up. The privacy review's §2.3 built 'received money first' on the premise that received money hides the payer, and nothing in backlog.md or the archive considers a payer who reveals d. The Lovejoin side of the class was found (e1a#1, and R3a's note on a copied box datum), but nobody traced it on the private balance."
  },
  {
   "id": "G2",
   "title": "Lovejoin from the public account, and with several accounts: shown against signed",
   "paths": [
    "seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx (publicPick/accountLeast 400-470, the public Mix, Mix again and Bootstrap reviews, the privateAnyway/held/paid questions 2700-3760, publicAfter 3990-4125)",
    "seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/LovejoinLaunch.tsx",
    "seedelf-platform/seedelf-web-wallet/extension/src/ui/components/ReviewTotals.tsx",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts (againBoxes, chain, fanOut 3476-3900; publicBuild, publicAgainBuild, publicStart, checked, keep, pumpPublicNow 4845-5450; madeBy, accountKeys, keysOf 6227-6356; withdrawOne's paid paths 7542-7760)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/spent.ts (reservationOf, reservedSet)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts (heldForLovejoin, chainHeld 1896-1925)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/account.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/coin-control.ts (collateralOf)",
    "seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs (chain_from_account_at 2183, again_from_account_at 2453, withdraw_paid_in 2755, Holdings)",
    "seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs (launch builders 2470-2780)",
    "seedelf-platform/seedelf-core/src/lovejoin/launch.rs",
    "seedelf-platform/seedelf-core/src/lovejoin/mod.rs (deposit_across, chain_across, collateral_mix, withdraw_with)",
    "seedelf-platform/seedelf-web-wallet/docs/privacy.md (Lovejoin; Several public accounts)"
   ],
   "focus": "Cover every flow the public account pays for: a public mix, Mix my boxes again from the account, a Bootstrap from it, a box brought back paid by the account, and a pool's start from the account or the private balance. For each, compare every figure and sentence on its review with what the signed transactions do: boxes and box value, each fee, the collateral put up and returned, the mix_logic reward balance taken and where it lands, change and its address, and the cert-0 deposit when a launch's Send goes without it. Then repeat with two or three public accounts that hold boxes and chains. Look for a default that ties two accounts, a review that names the wrong account, a reservation made or released across accounts, or a build that takes another account's UTxOs. For each state the build can reach, say which buttons still work.",
   "why": "X1's charge covers 'a Lovejoin mix or return', but X1a's coverage lists CardanoSend, MoveIn, CreateSeedelf, Collateral, Staking and the sign window, and nothing from Lovejoin.tsx. X1b's says 'Not reached: ... Lovejoin.tsx's public reviews (X1a's side)'. So no lens traced these flows end to end. E8a, E1b, W3, W1b, R3a and R3b each checked one layer. The several-accounts seam is where three findings already came from, each from one side: e3a#1 (the 'public' reservation isn't per account), e8a#3 (Pay anyway names the wrong account), and E1a's note that againBoxes with publicToo ties two accounts in words that name neither."
  },
  {
   "id": "G3",
   "title": "Lovejoin and session chains across time",
   "paths": [
    "seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts (pumpChain 462-640; chain, fanOut 3642-3900; tailOf, tailChain, tailWitness, tailHeld, tailOver 4310-4590; pumpPublicNow 5280-5450; schedule, recordChain, chainSent, chainEnded, restBack, chainMarked, publicUnsettled, keptMaybe, keepOnReset, adoptKept 5450-5884; cuts, chainsSending, sortOut 5884-6510; bringAllBackNow 7212-7466)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts (buildBack through noteLanded and refuseParts 4502-5158; sendChain, pump, sendStep, witnessTail and the pending-chain helpers 5170-5480; sendRecorded, submit 5490-5619)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/spent.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts (writeAhead, settleMaybeSent, mempool)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/wallet.ts (lock, open, wipe)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/runs.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/sw.ts (the alarms)"
   ],
   "focus": "Take each chain a user can start: a session's return through Lovejoin, a tile Mix's chain, Mix my boxes again, a public mix sent by pumpPublicNow, and the collateral's tail. Between each pair of steps, put a lock and unlock, a worker restart, a second page pressing Send, Remove wallet, a network switch, a one- or two-block rollback of the parent, and a 'behind' refusal from giveme.my or Koios. Look for: a pre-signed step sent twice or skipped; a step sent before its parent lands; steps sent in a burst at or soon after an unlock, against the unlock's wait and privacy.md's timing promises; a reservation released while a step may still land, so a later Send double-spends it; a chain record lost, so its boxes' due times or its tail are never set; a tail sent or kept wrongly; and what Home and the Lovejoin page say meanwhile. Also check x4#1's class in every automatic sender here (a timing gate read before the network waits, never again before the submit): the chain pumps, pumpPublicNow, the tail, and Bring every box back's loop.",
   "why": "X4's coverage says: 'Not reached or only skimmed: lovejoin.ts's chain, fanOut, pumpChain, recordChain and sortOut bodies; sessions.ts's buildBack, sendChain, pump and sendStep bodies'. X1b's says 'Not reached: sessions.ts' runner (step, act, order, cancel, pump)'. E1a and E2b read these line by line within their halves, but no lens applied lock, restart, rollback and two-page timing to them. They are the wallet's longest-running automatic senders, and every mix's privacy rests on their timing. X4 found its two timing-gate findings (x4#1, x4#2) in the parts of the worker it did reach."
  },
  {
   "id": "G4",
   "title": "A swap's proceeds on every return path",
   "paths": [
    "seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts (step, act, waits, ordersSpent, placed, liveOrders, remnantsFrom, order, cancel, cancelOf, inspect 3636-4500; buildBack's own list and its Lovejoin skip reasons 4502-4800; spareOf, wayOf, fillsOf, outcomeOf, autoView, withinFunding, checkProceeds 6400-6872)",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/minswap.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx (the Received row, left-behind and skip words, Stop's dialog)",
    "seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs (SessionReturnRequest, session_collateral, plan_return, built_or_without_strangers, merged_return, session_return, planned_return 900-1560)",
    "seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs (direct_tail 426-520, with_return 1842-1990)",
    "seedelf-platform/seedelf-core/src/orders.rs (read, read_order, Session::owns, cancel_orders)",
    "seedelf-platform/seedelf-core/src/orders.json",
    "seedelf-platform/seedelf-core/tests/fixtures/order_cancels.json",
    "seedelf-platform/seedelf-web-wallet/extension/tests/fixtures/session-swap.json"
   ],
   "focus": "For each DEX the runner routes to, work out what a fill, a partial fill (a Splash remnant), a refund and a cancel pay the session's account. That is the ADA beside the token, from the datum fields the aggregator writes (deposit, oil, receiver), read from the real order datums in the fixtures. Then check whether every return path takes all of it back as the session's own: direct, through Lovejoin, merged, the plain sweep, by hand, and after Stop. The direct return's `own` (sessions.ts:4549) is record.txs, siteOuts and recovered.own, without auto.fills, so plan_return treats a fill as a stranger's. A stranger's row comes back only if its own ADA covers what it adds plus 50,000 lovelace (lib.rs:1272-1283). Find any DEX whose fill or refund falls short of that, and leaves the bought token behind, or any path where the proceeds come back unmixed although the approval said through Lovejoin. That includes Minswap's build spending the session's 5 ₳ collateral, which sends the return direct with NO_COLLATERAL. Also check what Swaps then shows against what is at the account.",
   "why": "Three lanes stopped at the same doubt. W3's note: 'with_return's own is request.own without fills, so a fill's UTxO holding a token with no leg is classed as a stranger's ... the swap lane may want to confirm'. X2 confirmed the code path ('the direct return's own (sessions.ts:4553, passed at 4763) lacks auto.fills ... A DEX that returns tokens with only the key address's minimum would leave them at the one-time account. That is not traced to a real DEX, so no finding'). E7a's note couldn't check offline whether Minswap's coin selection spends the session's 5 ₳ collateral and forces the direct path. Nobody read the DEX side, and the money at stake is the swap's proceeds."
  },
  {
   "id": "G5",
   "title": "A hostile pool launcher, end to end",
   "paths": [
    "seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/lovejoin-pools.json",
    "seedelf-platform/seedelf-web-wallet/extension/src/ui/lovejoin-pools.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts",
    "seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts (readSet, verifiedPool, listing, poolRows 2811-3410; cantComeBack, stuck 3101-3200; usableNow, takesNewBoxes, adaPool, retiredIds 4143-4310)",
    "seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx (the hub's and pool page's states and figures) and LovejoinLaunch.tsx",
    "seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts (the lookalike fold and plainName, as applied to pool names)",
    "seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs (protocol_of, PoolView 150-320 and 660-700)",
    "seedelf-platform/seedelf-core/src/lovejoin/pool.rs",
    "seedelf-platform/seedelf-core/src/lovejoin/launch.rs",
    "seedelf-platform/seedelf-core/src/lovejoin/value.rs and box_value.rs",
    "seedelf-platform/seedelf-core/src/lovejoin/mod.rs (least_box_lovelace, way_back, withdraw_with's fee, the reserves)",
    "Lovejoin 29573c5 via git show: contracts/validators/one_shot_mint.ak, contracts/validators/mix_logic.ak, contracts/lib/lovejoin/reference.ak"
   ],
   "focus": "List everything a launcher chooses: the seed and its timing (the first launch for a token users hold, a launch racing a listed pool's values), box_lovelace, the token's policy, name and quantity (up to 2^64-1), max_fee, the reference output's extra tokens and datum spelling, scripts inline or by reference, extra rows at the holder, and front-running the user's own launch by registering its L first. Trace each to every consumer: discovery and its shown, copy and handed-over rules; verify_pool and PoolView; the funding sums and every figure Lovejoin.tsx shows; the mix and withdraw fee loops; the way back (comes_back, least_box_lovelace); and the retire rules. Look for a pool that verifies and is offered but takes the place of the pool a user meant (including a lookalike token's name on the hub, e9b#1's fold), divides or overflows, shows a figure wrong by real money, or forces a paid way back that ties an account without the review saying so first. Settled, don't report: a pool whose boxes can't come back by themselves still takes boxes (the owner's call 34, lovejoin.ts:2616-2619), and the flood attack (privacy.md:218). The question is what the user is told before a mix into such a pool.",
   "why": "X2's lens names 'a crafted Lovejoin pool', but its coverage says 'Not reached: ... Lovejoin launch and discovery (lovejoin-pools.ts), and pool copies'. COMMON.md names the pool launcher as one of five actors, and no lens followed one. The pieces were checked from separate sides: R3b (verify_pool, the launch builder), E1a (discovery), E8a (the pool page's states) and E2a (one division in tokenAt). Nobody followed a launcher's choices through all of them."
  }
 ],
 "uncovered": [
  "Files in no lane: seedelf-web-wallet/extension/src/networks.ts (203 lines). Only parts were checked: origins (B1), the mixBox hashes (X3), the pool floor (D1) and the epoch and slot math (E7b, E9b). Nobody read it whole.",
  "Bundled data in no lane: src/lovejoin-pools.json (V3 checked only the mainnet v2 pool's entry; it is a head start, never a gate, since every pool is verified), src/dreps/{mainnet,preprod}.json (the names Voting shows; E7b didn't reach the generator), src/tokens/*.json (B1 and E9b checked counts and decimals), docs/i18n/*.json.",
  "ui/styles.css (4,179 lines) wasn't read. W2 looked at one rule (unicode-bidi on the sign window's note). text-overflow: ellipsis sits on list names, token rows, amount boxes and the swap card's output. A spot-check found no review address cut, but no lane checked it.",
  "Verification: Lovejoin/Template/{MixBoxGate,MixBoxNoLock,MixBoxPurpose,OneShotMint}.lean (and Fee, FeeContract, which are out of scope) are in no lane (V4b's note). None of them is cited in CLAIMS.md or the READMEs. Upstream/ (9 files) and concrete/ (5) weren't reached by V3 or V4a. About 55 Lovejoin/AnyTx/Logic* kernel modules were skimmed, statements only (V4b). The Audit suites' closures are a sample, so Mix3, MixAny3, MixTok3/4 and the Out families have only #eval prints (V4b's note). No CI job builds the proofs (V5).",
  "Records an older release wrote, read by today's code after an extension update: no lane or lens. X4 covered lock and restart, not version skew. sessions.ts and lovejoin.ts changed in 12 and 14 commits since 1.6.0 (their sealed sessions.<net> and lovejoin.<net> records); pending.ts (maybeSent) hasn't changed. Each gate review ran one live update, so the risk is lower, but nobody diffed each record's shape across tags against its reader.",
  "Translations: E9b read only the 485 critical bases. The 2,710 other keys weren't read for meaning. Review labels such as review.total.publicNamed, review.after.publicNamed, review.rewardsCollected and most of LovejoinReturn.tsx's keys sit outside the critical set; a spot-check found es and ja correct. e9b#2's class (money or privacy words outside the set) wasn't swept beyond its one family.",
  "Refusals of what the ledger accepts were found lane by lane, with no sweep against the owner's 2026-10-19 rule: r2a#1, r2a#2, w2#6, e7b#1, e7b#2, check_label's printable-ASCII rule for a Seedelf's tag (the policy takes any bytes), Send's refusal of the user's own Seedelf (E5), contacts refusing every script address (E6), cbor.ts refusing an indefinite outer array or body map (E5), the Seedelf minimum's 0.12 ₳ (R2b), and the CLI fund's exact-5 ₳ rule (R2b, R4).",
  "Two profiles of one phrase running at once: the session indices are documented. Nobody traced the per-device timing rules that privacy rests on (the five-minute quiet rule, one box a run, the unlock's waits, due times per pool) when two devices run them independently, nor E9a's note that a conflicting spend from the other device leaves a payment in Private activity that never happened.",
  "A stranger's CIP-20 note in public Activity (activity.ts noteOf, Activity.tsx:365) is shown raw: no invisible-character or bidi cleaning, unlike plainName and shownText elsewhere. Nothing is signed on it, so a nit at most; it is e3a#3's class outside the sign window.",
  "The CLI's test harness (seedelf-cli/tests/cli/harness.rs) wasn't reached (R4). T1b didn't run the CLI's 4 ignored live Koios tests. The other T1 agents are still running.",
  "seedelf-data (out of the chunk) holds copies that lanes named questions for: whether its depth walk and register reader take tag-102 box and register datums (r3a#1, x3#1); whether its credential index filters key-H and key-M rows (X2's note: if not, x2#1 reaches every mainnet user); and whether it lists CLI-era UTxOs at the contract's staked address (X3).",
  "E2a's new fact on a settled item: each Send turned away burns a session index, so 20 to 39 failed Sends in a row (during a giveme.my outage, say) hide every later session from a restore's scan. Their money becomes invisible to the wallet. It's in E2a's notes for the owner; no finder needed.",
  "E9b's new fact on settled C22: the recovery phrase grid has no translate=\"no\". With 'Always translate English' on in a language the wallet doesn't speak, Chrome sends the 24 words to Google. Settings' Show recovery phrase has no confirm step, so a backup copied from translated words would be wrong. A secret leak, in notes for the owner.",
  "CLAIMS.md:29 discloses that CardanoLedgerApiBlaster's encodings aren't proved to match the node. V1 checked the encodings for the fields the definitions read, but not TxCert, governance or TxOut. Nobody checked whether every real context lies in the image of toData."
 ],
 "weak_claims": [
  "W2: 'Conway refuses a repeated body key, unknown body keys, and duplicate map keys and set elements from protocol 9, so none of these readings reaches the chain'. This is from memory: W2 says it couldn't fetch cardano-ledger-binary, and none is on this machine. Pallas reads a repeated body key last-wins, and cip30's of_value sums duplicate multiasset entries, so the sign window's figures are right only if the node refuses those shapes. W2's own worst case ({A:100, A:1} shown as 101) would be critical. Confirm against the ledger's decoders, or by submitting such a transaction on preprod.",
  "The 'no reachable trap' claims for nested data (W2's checked list; W3's and R1's similar lines) rest on the 128-level guard and on native tests with 2 MB+ stacks. wasm/tests/deep.test.mjs runs LEVELS = 100,000, which the guard refuses. No WebAssembly test runs data just under the guard (127 levels, which it accepts) through the recursive consumers inside the module's 1 MiB stack: inspect, then decode_tx's plutus_tree and serde_json (W2's own note). 1.6.0's 314-wasm#0 trap shows this stack is the limit that bites, and a trap locks the wallet.",
  "X2: 'W1b's direct_tail pointer holds as written ... The privacy cost is marginal next to a direct return's rest'. That is a judgment, not a trace. On the default path (through Lovejoin), the first exact-5 ₳ row, a stranger's at base(session key, stranger's stake), is mixed in place of the session's own collateral. The session's own collateral then comes back under the session's history, which is the link privacy.md:429 says the collateral's mix avoids, and the tail's change sits under the stranger's stake key until the return sweeps it (W1b's note). Three different rules pick 'the session's collateral' (fits_collateral first row, Holdings, session_collateral).",
  "E5's note: 'isCollateralShaped ... I found no harm: Conway doesn't charge collateral inputs' reference scripts'. e8b#1, confirmed, shows the harm: a stranger's reference-script or deep-datum 5 ₳ made the account's collateral blocks every public Lovejoin build, because Coin::from_row goes through eval::resolve_row.",
  "E2a: 'Nobody else knows a fresh one-time address before its funding, so a stranger can't pre-seed it'. The argument names strangers only. The site learns the session's address once connected, and E3a notes the connection is recorded when the funding is sent, before it lands. fundingState counts a single-part funding as landed once anything is at the account. No harm is traced, but the claim's premise leaves out the actor who knows the address.",
  "E3b: 'signingTies ... never says the private balance isn't in it when a Seedelf is paid' holds only when the datum is spelled with tag 121 (X3's note; x3#1).",
  "E6 and X3: 'registerOf (chain.ts) and register_of_datum accept the same shapes'. True, but both refuse the indefinite pair 102([_ 0, fields]), which r3a#1's verifier showed the node accepts. 'The same' isn't 'right', and no shared vector holds the two readers together (X3).",
  "E4a: 'Heuristic scans ... found no wallet-queue call nested inside a withKeys, withAccount or withStoreKey task'. This rests on two regex scans of the source (e4a_nested_scan2.py, e4a_network_in_queue.py), not a call graph. A nested queue call through an indirect helper or a callback wouldn't match, and one would deadlock the queue and with it auto-lock.",
  "X1a: 'Public Send to a Seedelf: ... the chain doesn't show it's theirs holds for the wallet's own payments'. The qualifier carries the claim: a payment the wallet didn't make (d = 1 from a stranger) does show whose it is, and is then spent by default (G1)."
 ],
 "summary": "All 34 lanes read the paths LANES.md gave them, by their own coverage lines. They only skimmed frozen or decorative files (references.rs and templates.rs hex were compared by script; static/index.css and Icons.tsx were skimmed), and E9b didn't read the non-critical translations for meaning. Files in no lane are minor: extension/src/networks.ts (only parts checked), the bundled pool, token and DRep JSON, styles.css, and in the proofs Lovejoin/Template's four in-scope modules (none cited), Upstream/ and concrete/.\n\nThe real gaps are in the cross lenses:\n- X1 left out the public-account Lovejoin reviews and the pool launch.\n- X2 traced stranger UTxOs well but skipped its 'crafted pool' charge, and never took up X1a's stranger-tagged register.\n- X4 didn't reach the bodies of the chain machinery.\n- Three lanes (W3, X2, E7a) stopped at the same doubt about a swap's fills on the direct return, and nobody traced the DEX side.\n\nFive gap finders, in priority order:\n- G1: received money a payer can tag (d = 1, or a copied register). It is owned and classed received, and taken first by stealth mints and session fundings. Privacy, stranger-caused, made by default; the privacy review never considered a hostile payer.\n- G2: public-account Lovejoin and the launch, shown against signed, plus the several-accounts seam that already gave e3a#1 and e8a#3.\n- G3: Lovejoin and session chains across locks, restarts, rollbacks, two pages and 'behind' refusals, including x4#1's timing class in every automatic sender.\n- G4: a swap's proceeds on every return path. The direct return's own list leaves out auto.fills, so a fill with little ADA could be left behind.\n- G5: a hostile pool launcher end to end. Stuck pools taking boxes (the owner's call 34) and the flood attack are settled.\n\nSpot-checks I made and found holding, so nothing was sent for them:\n- The extension pages Koios by keyset with a fixed order, so r1#1 is CLI-only.\n- A stranger's arrival is always classed received, so no history class can be forged.\n- The public Lovejoin builds and the launch carry no rewards withdrawal, so e8b#2's class ends at Collateral.\n- E3a's 'a parse difference can't bypass keptApart' holds, because WebAssembly gets rows only for the inputs the TypeScript reader found.\n- settle holds outputs to 5,000 bytes and the fee to MAX_FEE.\n- Pool copies are still read for the wallet's boxes.\n- The sampled es and ja review labels read correctly.\n\nThe weakest standing claim is W2's: that the node refuses repeated body keys and duplicate multiasset entries. It comes from memory, there's no ledger source here to check it, and the sign window's sums depend on it. It needs a check against the ledger source or a preprod submit, not a reading finder."
}
```
