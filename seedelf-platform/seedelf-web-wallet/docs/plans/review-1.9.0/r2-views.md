# 1.9.0's review of its fixes: the views lens

Round two, on the merged fixes at `204c7a93`. Verbatim from its structured report.

## Coverage

Read: R2BRIEF, COMMON, FINDINGS, FIXBRIEF, fix-full.txt (the views and docs lanes in full), and verify-full.txt's cross#1, cross#2 and dapp-ui#3. In the integration tree (204c7a93) I read:
- tx-view.ts, all of it;
- TxDetail.tsx 1-720;
- Swaps.tsx 920-940, 2225-2345 and 2590-2790;
- sessions.ts: swapBuild, cancelBuild, cancelOf, inspect, review, signAndSend, listing/utxosOf and directSpends;
- lovejoin.ts: againBoxes, fanOut, publicAgainBuild, the provenance set (3265), sortOut, found, made, lookUp, madeBy, inputsOf, status, chains, rows, chainTxs, split, withdrawNow and the Origin, knownOf and originOf helpers;
- Lovejoin.tsx 987-1043, 1693, 1970-1996 and 3079-3146;
- ClaimAll.tsx, handlers.ts (tx-detail and the Lovejoin RPCs), dapp.ts (publicKeys, drepKey, dappAccount), wallet.ts withAccount, private-index.ts:362-368, data-layer.ts chainClient/utxoInfo, rpc.ts (SessionTxReview, LovejoinChainTx, LovejoinPublicSummary), and the en/es/ja tx.* strings;
- docs: flows.md 254-275, privacy.md 22, 124, 175-195 and 233-238;
- the merged diff for the views files, en.json, sessions.ts, minswap.ts, flows.md and privacy.md.
`git diff review-1.9.0/fix-views review-1.9.0/integrate` over the five views files is empty.

Ran in my own worktree (R/r2/views/tree at 204c7a93, node_modules symlinked, the main tree's wasm/pkg copied in, every run under systemd-run MemoryMax=8G):
- vitest tx-view + tx-view-screen: 59/59.
- 10 files that render TxDetail or Swaps' review (tx-view, tx-view-screen, dapp-prompt, swap-page-words, screens-wiring-review-fixes, i18n-screens, chain-in-view, direct-swaps, swap-page, screens): 306/306.
- `npx tsc --noEmit -p .`: exit 0.
- Seam check: zz-r2-nomock (the file without the seam and the new describe) passes 43/43 beside the seam file's 46/46. seam_mutants.py ran 4 TxDetail.tsx mutants with and without the seam.
- Probes:
  - zz-r2-views-lovejoin-hint: 2 tests;
  - zz-r2-views-moved-box;
  - zz-r2-views-drep-cost (100 accounts);
  - zz-r2-views-drep-locked.
- The probes derive keys from the public "abandon … about" phrase, never vectors().
- They're saved in R/r2/views/probes/, with the mutant script in R/r2/views/scripts/.
- Afterwards: the worktree removed, the symlink unlinked, and the main tree clean at 8d7c4b0c.

Not done:
- No Vite build or Playwright. The lead's checks.log has 109 e2e passed on the dev and store builds, and no e2e asserts on these hints.
- No network and no live run.
- The private mix-again chain's own row view wasn't run end to end. Its Koios lookup was run (moved-box probe), and its view goes through the same TxDetailModal path the public chain-list run took.
- The mainnet private-index path (provenance, no request) is traced, not run.

## Findings

### r2-views#1 (low, confirmed-by-run): A Lovejoin mix-again's Transaction details say "the wallet asks nobody" after the wallet asked Koios what made a box the mix spends

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx, seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts, seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts, seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx, seedelf-platform/seedelf-web-wallet/docs/flows.md, seedelf-platform/seedelf-web-wallet/extension/tests/tx-view-screen.test.ts

**Claim.** Q4. The wallet can ask Koios (tx_info, from the user's IP) what made one of its own boxes. A Lovejoin mix that spends that box still shows the inputs hint "…the wallet asks nobody: looking them up would tell whoever was asked which transaction you are reading."

Two views show it:
- Mix again from my public account: its review's button (the first mix's), Lovejoin.tsx:3139.
- A mix-again chain's row on the Lovejoin page while it's sent, from either side: ChainTxs, Lovejoin.tsx:1025, and the page-held TxDetailModal, :1994.

The condition has two parts:
- The box's pool came from Koios, not the private index. That is always on preprod; on mainnet, with Koios-only on or the private index down.
- No record of the wallet's accounts for the box: after a restore; or, for Mix my boxes again from the private balance, a box someone else's mix moved, with no restore at all.

The view the views lane's note named (lovejoin-tx on a mix from the private balance, :3137) is not affected. It opens the funding, whose inputs are the private balance's own.

flows.md:275's new sentence "the inputs' hint says when" and tx-view-screen.test.ts:123-124's new rule are therefore incomplete.

**Evidence.** Code (integration tree; paths under seedelf-platform/seedelf-web-wallet/extension/):
- TxDetail.tsx:377: `hint={tr(site || lookedUp ? "tx.privacy.inputsHintSite" : "tx.privacy.inputsHint")}`.
- Lovejoin.tsx:3139: `<TxDetailButton txHash={review.summary.entry} label={entryLabel(review.summary)} testId="lovejoin-tx" />`. Neither ChainTxs' button (:1025-1036) nor `<TxDetailModal txHash={opened.txHash} testId={`lovejoin-chain-tx-${opened.i}`} …/>` (:1994) passes site or lookedUp.
- publicAgainBuild sets the entry: `entry: chain.txs[0]!.txHash` (lovejoin.ts:5104), the first mix.
- lovejoin.ts:6190-6193, lookUp:
  `const covered = (pool: string) => (pool === CLASSIC ? p?.classic === true : p?.fed.has(pool) === true);`
  `const koios = new Set(ask.filter((b) => !covered(poolOf(b))).map((b) => b.txHash));`
  `const told = asked.length ? await this.madeBy(network, asked, koios) : …`
- lovejoin.ts:6291-6295, inputsOf: `const koios = this.deps.koios(network).koiosAlone(); … await koios.txSpends(unlisted.slice(i, i + TXS_PER_REQUEST))`.
- lookUp is reached three ways:
  - sortOut→found (:5979): the page's status read, at a restore (moreThanDue);
  - againBoxes made() (:3496);
  - fanOut made() (:3786).
- Provenance, which needs no request, exists only where the private index answered (:3265). private-index.ts:368 gives no client with Koios-only on or the private part down, and preprod has none.
- privacy.md:238 says this tx_info "tells Koios which of the pool's boxes are this wallet's".

Runs (`npx vitest run tests/zz-r2-views-lovejoin-hint.test.ts --silent=false`, preprod fakes, saved at R/r2/views/probes/):
- probe-status-tx_info [["d9d9d9d9"]]
- probe-fromPublic ["d9d9d9d9#0","d9d9d9d9#1"]
- probe-summary {"again":true,"boxes":2,"txs":2,"entryIsLast":false}
- probe-entry-inputs ["5a5e0005#0","5a5e000b#0","d9d9d9d9#1","e7e7e7e7#0"] boxes-from-D 1
- probe-hint What each one holds isn't in the transaction, and the wallet asks nobody: looking them up would tell whoever was asked which transaction you are reading.
- Chain row: probe-chain-summary {"boxes":2,"txs":8}; probe-chain-list ["mix:sent:50163de8",…,"mix:waiting:519f1113"]; probe-chain-view {"chain":true,"hint":"…the wallet asks nobody…"}.
- Tests 2 passed (2). The view itself made no Koios call.

No restore (zz-r2-views-moved-box): probe-moved {"afterRead":0,"afterAgain":[["4d4d4d4d"]],"again":{"boxes":1,"owned":1}}. The pool read asks nothing; Mix my boxes again from the private balance asks Koios tx_info of the mix that moved the box.

Docs it contradicts:
- flows.md:275 (new): "The review it opens from may have asked before it: the inputs' hint says when (above)."
- tx-view-screen.test.ts:123-124 (new): "Its own builds spend what it holds, bar a session's cancel and its swap against a DEX's pools". Every mix also spends strangers' boxes.

**Scenario.** (a) A restore. On preprod, or on mainnet with "Read Cardano through Koios only" on or the private index down:
1. Restore the phrase while the 5 ₳ pool holds boxes a public mix left.
2. Open Lovejoin. The status read asks Koios tx_info about the deposit D that made them.
3. Press Mix again from my public account. The review appears.
4. Open "the first mix's" Transaction details and its inputs ⓘ. It says the wallet asks nobody, though the mix spends D#1 and Koios was just asked, from this IP, what made it.
5. Once Send is pressed, the chain's row says the same for that mix.

(b) No restore:
1. Someone else's mix moved one of the wallet's boxes.
2. Mix my boxes again from the private balance asks Koios tx_info about that mix.
3. The session's chain spends the box. While the chain is sent (more than four transactions), its row's Transaction details for that mix say the same.

**Fix.** The owner's call.

Code: set lookedUp on a chain transaction that spends a box of the wallet's whose making Koios was asked about. It needs:
1. lovejoin.ts lookUp (6192-6195) keeps the source on Origin (1164-1191 keeps none), e.g. `koios: true` for each transaction in its `koios` set.
2. publicAgainBuild (5038-5121) and fanOut (3786-3830) flag each built transaction whose inputs (txInputs) include a box b with `!recorded(s)(b) && s.origins?.[b.txHash]?.koios`. The flags are kept in the kept chain and progress records.
3. rpc.ts gets `lookedUp?: true` on LovejoinPublicSummary (2248), for its entry, and on LovejoinChainTx (2544), which chainTxs (6671-6681) fills.
4. Lovejoin.tsx:
   - :3139 passes `lookedUp={review.summary.lookedUp === true}`;
   - ChainTxs :1025 passes `lookedUp={tx.lookedUp === true}`;
   - OpenChainTx (:987) and the `opened` state (:1693, :1973, :1989) carry it to the TxDetailModal at :1994.
5. Words: tx.privacy.inputsHintSite ("looked up the ones it doesn't hold") isn't what happened here, since Koios was asked what made boxes the wallet does hold. So either a new tx.privacy key, back-translated, or the site's words accepted as close.

Cheaper: name the case in flows.md:262/275 and fix the test comment at tx-view-screen.test.ts:123-124.

### r2-views#2 (nit, traced): A Danogo swap's Transaction details say its collateral is the paying account's, and checked by the wallet: it's Minswap's, on scripts the wallet never runs

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx, seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx, seedelf-platform/seedelf-web-wallet/docs/flows.md

**Claim.** The view L7 fixed shows a direct swap against Danogo's pools (session-tx-detail). Its Collateral ⓘ is the same for every transaction: "Collateral is taken only if a contract fails, which the wallet checks first. A payment from your private balance borrows giveme.my's own 5 ₳, free. Any other puts up the paying account's."

For this swap both claims are untrue:
- the collateral is Minswap's, not the session's;
- the wallet never runs Danogo's scripts.

flows.md:261 says the same: "the paying account's otherwise". The issue predates this round (chunk 24), and the L7 fix left it.

**Evidence.** - TxDetail.tsx:400-405: the collateral Section's `hint={tr("tx.privacy.collateralHint")}`, with no condition.
- sessions.ts:6728-6730, directSpends: "A collateral that's not anyone else's is the session's own: at stake on scripts the wallet never runs, …" and `if (at.collateral.some((r) => !at.others.includes(r))) throw new Refused(t("sess.refuse.warn.ownCollateral"))`. A direct swap's collateral is therefore always someone else's.
- privacy.md:186: "carries Minswap's own collateral, signed by Minswap".
- The page itself: swaps.tx.asidePools "Built by Minswap, read by the wallet, signed by this session's key and by its collateral's owner". Swaps.tsx:2688-2691 shows "Collateral at risk" only when `collateral.own > 0`.

**Scenario.** 1. A paused swap routed to Danogo.
2. Press Review it myself, then Transaction details.
3. The Collateral ⓘ says the paying account (the session) puts up collateral and the wallet checked the contract. The page's own aside names the collateral's owner. No money of the user's is at stake.

**Fix.** The owner's call: a pools-aware collateral hint (a new tx.privacy key, back-translated) passed the way lookedUp is; or one doc line at flows.md:261 naming the Danogo case; or leave it.

## What holds

- Q1: of the 23 TxDetail call sites in src, only Swaps.tsx:2696 passes lookedUp, and DappApprovals.tsx:1325 still passes only site. Every other caller defaults to false, so its hint is unchanged, and the signatures row still depends on site and chain alone (TxDetail.tsx:468).
- Q1: lookedUp equals inspect's others.length > 0 today (sessions.ts:4371-4377, 4438, 4468). A cancel's orders sit at DEX scripts, never in the session's credential_utxos rows (5945-5952); cancelBuild throws noOrderWaiting when there are none (3239); its collateral and funds come from the rows (4218-4219). A swap's againstPools is `direct`, which is swap && others.length > 0. Traced for a cancel of several orders (covers), a Splash part-fill's remnant at Splash's script, a Danogo swap (pools plus Minswap's collateral) and an order swap (nothing foreign: directSpends refuses any non-pool input).
- Q2: the react seam is a pass-through unless opened.view is set, and only the three new tests set it, resetting it in finally. With the seam removed, the earlier tests pass 43/43. Under 4 TxDetail.tsx mutants, the earlier tests' failures are identical with and without the seam (1, 1, 1 and 0). If the modal doesn't open, the new tests fail loudly (an undefined hint makes toContain throw). The CBOR-tab mutant is caught only by the new tests.
- Q3: markYours' DRep key is derived as dapp.ts publicKeys:2414 derives it (JSON.parse(cardano.drepOf()).hash, CIP-105 3/0 under each account), in the active turn (tx-view.ts:294) and in each known account's turn (:312). 100 accounts give 100 distinct hashes.
- Q3 cost: probe-cost-100 gave {turnMs:1021, drepMs:42, ratio:0.041}, so the DRep key adds 4% to turns that already run, and only while unmarked signers remain. Locked, nothing is derived: withKeys and withAccount throw first. probe-locked gave {unlocked:1, locked:[], ms:2} with no Koios call.
- Q3: no false "Must be signed by you": every key marked derives from the user's seed. A site without governance that names the DRep key reads "you" in details while the window counts that key among othersSign. That is true of ownership, and the lead accepted it.
- The tests do their job: the L6 test, the dapp-ui#4 extension and the three L7 screen tests fail on the base or under their mutants (fix/views/mut/l7-mutants-final.log: m1-m7 failed 2, 2, 2, 3, 1, 1, 1). The views lane's branch equals the integration for its five files.
- The integration tree: tsc --noEmit exits 0, and the 10 view-related test files pass 306/306.
- privacy.md:186 holds. inspect's utxoInfo(others) covers exactly the Danogo pool UTxOs and Minswap's collateral (directSpends allows nothing else), from both the runner's order() and Review it myself's swapBuild, through chainClient (data layer first on mainnet, Koios on preprod: "the Cardano server", privacy.md:22). The request carries outpoints only, and the sent swap spends both.
- flows.md:262 holds for the cases it names: the sign window (site, always), a session's cancel (its orders) and a Danogo swap (pools and collateral). The collateral isn't an input, so only privacy.md says it was looked up.
- flows.md:275's "It asks nobody anything. No Koios request, no storage write" holds for the view itself: no probe saw a Koios call across txView. Its time cost is backlog.md:145 (cross#2), unchanged.
- The signatures row under lookedUp reads "None yet" for a cancel or an order swap, which stay unsigned until Send. A Danogo swap's "1, made while preparing it" is Minswap's collateral owner's signature, and the line doesn't say whose. That predates this round, and the page's aside names the signer.
