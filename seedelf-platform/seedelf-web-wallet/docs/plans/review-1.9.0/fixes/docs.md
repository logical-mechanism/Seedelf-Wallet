# 1.9.0's release review: the docs fixer

A fix lane, in a worktree of `8d7c4b0c`, test first. Verbatim from its structured report.

**Branch:** `review-1.9.0/fix-docs`, commit `4ad78f3c`.

**Files:** `seedelf-platform/seedelf-web-wallet/docs/architecture.md`, `seedelf-platform/seedelf-web-wallet/docs/flows.md`, `seedelf-platform/seedelf-web-wallet/docs/privacy.md`, `seedelf-platform/seedelf-web-wallet/docs/backlog.md`, `seedelf-platform/seedelf-web-wallet/docs/releases.md`, `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-46-verification-on-upstream.md`, `seedelf-platform/seedelf-web-wallet/wasm/README.md`

## Fixed

### M1 (cip30-rust#1, dapp-ui#2, i18n#1, i18n#2): the class and the new words in the docs

**What.** architecture.md:563 (dApp connector, Signing): the window's new words are quoted: the row "From a contract, not to you", the switch "I expect this not to come back to me", and the namesKey warning saying the contract names the key and the funds may be the user's. A new sub-bullet (564) names the honest class that gets the row and switch: a position's top-up, withdrawal or repayment, and a staking position's; a shared UTxO re-created beside it (Indigo's, up to 520,005 ₳ in the seven transactions read); partial cancels and withdrawals; any repayment whatever the net (the fungibility rule, moved here from the old sentence); a close that burns a position or auth token. It says why the switch words hold for honest flows and still stop a redirected cancel. Sub-bullet 565 says why the class can't be narrowed: an honest reprice and a relist under another datum render the same window, and a datum naming the key proves nothing (any 28 bytes). flows.md:430: the window's new words, plus a sentence after the list naming the class and linking architecture.md#dapp-connector.

**Tests.** No test reads these docs (words.test.ts scans src/ only; i18n.test.ts reads docs/i18n). The lane's check is the relative-link check over every touched file.

**Evidence.** Every claim was traced at 8d7c4b0c: cip30.rs:1099-1135 (released_from_contracts: no credit for outputs to contracts, came_in only, fee credit), 1264-1270 (contract_held, names_key), 1832-1838 (key_releases); ui/dapp.ts:33-35; DappApprovals.tsx:121-126, 290-303, 1060-1144. The words are the lead's table in FIXBRIEF.md. The figures are the verifiers' runs (v-a-impact, v-a-trace). Link check: base 1 broken (releases.md:50), after 0 broken.

### L2 (cip30-rust#2, critic#1): the documented limits

**What.** architecture.md:566 (new sub-bullet "Only the note shows what the wallet can't tie to the account's key"): the native-script limit now says any body with a script data hash, which a site can give any transaction (one datum in the witness set calls for it, with no Plutus run). The old text said "a transaction that also runs Plutus". The owner-proof limit now covers any proof other than a required signer (the owner's own input spent, a withdrawal, a certificate, a vote), with the datum kept by hash and left out. The two no-request code options go in the backlog (below).

**Tests.** Relative-link check only (docs).

**Evidence.** cip30.rs:1838 `(contract_inputs > 0 && body.script_data_hash.is_none())`; the ledger citations and 5 real transactions in verify-full.txt cip30-rust#2; the key_releases sources at cip30.rs:1832-1838 and critic#1's p8-p11 renders.

### L3 (cip30-rust#4): an unfound input under a key that releases

**What.** architecture.md:568 (new sub-bullet): an unfound input isn't in contract*/released*. Only the stake key ever signs over one. With keyReleases, its line says only that what it holds can't be shown, without "Only your stake key signs here". This follows the words lane's change as the brief decides it (the new key, picked when s.keyReleases is set).

**Tests.** Relative-link check only (docs).

**Evidence.** cip30.rs:1273 (an unknown input never reaches contract_held), 1792-1806 (payment/DRep refuse unknown inputs); DappApprovals.tsx:1301-1303; the brief's L3 key decision.

### L4 (cip30-rust#6): the fee credit

**What.** architecture.md:567 (new sub-bullet): the fee comes off what's released as far as the account didn't pay it, up to 10 ₳ (MOST_FEE_ALLOWED, above the largest fee at today's parameters, about 8.9 ₳). A contract holding up to 10 ₳ burnt as fee under the key shows only the note and the fee row, and a larger one's row reads up to 10 ₳ short.

**Tests.** Relative-link check only (docs).

**Evidence.** cip30.rs:1101 `MOST_FEE_ALLOWED: u64 = 10_000_000` and 1133 `.saturating_sub(fee.min(MOST_FEE_ALLOWED).saturating_sub(went_out))`; the v6 runs in verify-full.txt (5/5 ₳ note only, 15/15 ₳ shows 5 ₳).

### L7 (cross#1): the session reviews' lookups

**What.** flows.md:262: where the review itself looked inputs up, the hint under the inputs says so. That covers the connector's sign window (inputs the site's account or session doesn't hold), a private session's own cancel (its orders), and its swap against a DEX's pools (the pools and Minswap's collateral). This follows the views lane's lookedUp prop. flows.md:275: the view itself still asks nobody, but the review it opens from may have, and the inputs' hint says when. privacy.md:186: reading a Danogo swap before signing (by the runner or Review it myself) asks the Cardano server about the pools' UTxOs and Minswap's collateral (utxo_info). Neither names the account, and the swap names both once sent. This was already the behaviour, now stated: no new request, so no policy entry.

**Tests.** Relative-link check only (docs).

**Evidence.** sessions.ts:4356-4362 (others = refs not in the session's rows; utxoInfo(others); direct = swap && others.length); inspect is called from both order() (4157) and review(); dapp.ts resolve() (1792-1823) looks up what the holder's view and signed outputs miss; data-layer.ts:431-439 (mainnet's utxoInfo goes to the data layer first, hence "the Cardano server").

### L8 (routes#1 and its 404 neighbour) + the routes cost line

**What.** architecture.md:665 (end): when Minswap refuses routeOf's second ask (made for an unchecked DEX or for outOfPlace), the first answer stands. The trigger is a name its validator won't take (name-refused, matched on its 400's words) or nothing left to route (no-route, its 404's "Quote not found."). The quote and Review it myself then refuse in the wallet's words and the runner pauses. Any other failure still throws and is retried. architecture.md:660 cost line: the third Minswap request also covers, on mainnet, a DEX the wallet doesn't check. backlog.md "A DEX name Minswap stops taking…": it now says this is about a name on the wallet's own list, and that a name routeOf adds no longer fails the quote.

**Tests.** Relative-link check only (docs).

**Evidence.** R/v-routes/fix-routes1b.diff (the swaps lane's fix as decided); I traced that keeping first ends in a refusal: quote() 1587-1595 (routesThrough, then routesOutOfPlace), order() 4126-4137 (Refused nowRoutes / nowOutOfPlace, i.e. a pause), swapBuild() 3185-3193 (nowRoutesThrough / nowRoutesOutOfPlace). avoid is non-empty only when first has an unchecked or out-of-place leg, so keeping first always reaches one of these refusals.

### L9 (v4-orders#1): V4's cap, in the docs

**What.** architecture.md:646 (the trust line): V4's max_per_execution is the fee a fill takes whole, where V3's max fee is only a ceiling over what a scoop charges, and the wallet reads neither. So the DEX's fee, like the minimum, is what Minswap writes, bounded only by withinFunding: a cap over the quoted fee would come out of the 2 ₳ of room (SWAP_MARGIN). Every Minswap build seen writes the quoted fee. The line links the backlog entry, which holds the code option.

**Tests.** Relative-link check only (docs).

**Evidence.** orders.rs:500-515 (V4 reads fields 0, 1, 5), 486-499 (V3 skips 'max fee'); sessions.ts:216 SWAP_MARGIN, 893 costs; the chain measurements and SDK quote in verify-full.txt v4-orders#1 (11/11 fills kept exactly the cap; V3 took 0.974 ₳ under a 1.28 ₳ max).

### cross#4

**What.** wasm/README.md:92 (inspectDappTx row): names the seven new fields: contractInputs with contractLovelace/contractTokens, releasedLovelace/releasedTokens, keyReleases, namesKey. It says what each means and links ../docs/architecture.md#dapp-connector.

**Tests.** Relative-link check (the new link resolves, anchor included).

**Evidence.** cip30.rs:933-946 (the TxSummary fields and their doc comments), 1877-1883 (filled).

### docs-prep#3

**What.** plans/chunk-46-verification-on-upstream.md: the status line (5) now reads "steps 1 and 3 done 2026-11-08; step 2 in progress". The table row (17) reads "Open, and MERGEABLE since the rebase was force-pushed on 2026-11-08 (step 1), waiting on its reviewers. `main`'s line 928 still has the bug". Step 1's stale sentence "Then the owner force-pushes, PATCHes the body and posts the comment (…)" is dropped. Nothing else changed.

**Tests.** Relative-link check.

**Evidence.** The plan's own steps: step 1 ✅ with "Posted (2026-11-08) … #455 shows MERGEABLE", step 2 🚧, step 3 ✅ merged 2026-11-08.

### docs-prep#4

**What.** releases.md:50: the chunk 44 link now points to archive/plans/chunk-44-lovejoin-v2.md.

**Tests.** Relative-link check: python3 -I linkcheck.py over the 7 touched files.

**Evidence.** Before (main tree at 8d7c4b0c, read only): "seedelf-platform/seedelf-web-wallet/docs/releases.md:50: plans/chunk-44-lovejoin-v2.md (no such path) / 1 broken". After (my worktree): "0 broken".

### backlog (L1, L2, L9, M1's info row, cip30-rust#5, #8, #9, cross#2, dapp-ui#1)

**What.** backlog.md, "Signing and the connector" (top of the section) gets eight lines: ⬜ L1, the burn credit, with the guarded rule (only the burn beyond the account's net put-in and the found others' inputs of that asset, none with an unfound input); ❓ L2, the two no-lookup options (verify the script data hash against the shown witness set, noting that with redeemers the cost models aren't read on the connector path today; or count an uncarried by-hash contract input as key-released); ⬜ M1, the optional "Goes back to the same contract" row, switch kept, with its fungibility caveat; ⬜ cip30-rust#5, the memoised datum scan; ⬜ cip30-rust#8, a key split across chunks; ⬜ cip30-rust#9, u128 totals; ⬜ cross#2, markYours' cost (cache each account's key set until lock); ⬜ dapp-ui#1, the worker checking the switch. "Swaps and dApps" gets ❓ L9, holding the sum of the V4 caps to an approved dexFee recorded at Start swap. The ❓ marks follow FINDINGS' "owner's call".

**Tests.** Relative-link check.

**Evidence.** Each line was checked against the verifiers' runs in verify-full.txt and the code they cite (cip30.rs:1093-1096, 1270, 157-162; tx-view.ts:280-303; dapp.ts:646-701; sessions.ts:394). The format follows the house's `- ⬜ **Title** (1.9.0's release review, id): …`.

## Commands

Relative-link check (R/docs-prep/linkcheck.py, copied to R/fix/docs/scripts/, read only):
- before, on the main tree at 8d7c4b0c (read only): `cd R/fix/docs/scripts && python3 -I linkcheck.py /home/logic/Documents/LogicalMechanism/Seedelf-Wallet <the 7 files>` → "releases.md:50: plans/chunk-44-lovejoin-v2.md (no such path)", "1 broken".
- after, on my worktree: `python3 -I linkcheck.py <worktree> <the 7 files>` → "0 broken", run again after the last edit → "0 broken".
- `git diff --check` → clean.
- The edits were applied by R/fix/docs/scripts/apply.py, which asserts each old string occurs exactly once.
- Commit 4ad78f3c "review-1.9.0 fix: docs", 7 files, 28 insertions, 14 deletions.
- No Vitest, cargo, Vite or Playwright: no test reads these docs (words.test.ts scans src/; i18n.test.ts reads docs/i18n only). I never created the node_modules symlink, so there is none to unlink.

## Notes for the lead

1. A git-stash slip, already undone. To get the before-state link check, I tried `git stash push -- $FILES` in my worktree. zsh didn't word-split $FILES, so the push never ran, but the chained `git stash pop` did. refs/stash is shared across all worktrees, so the pop tried to apply someone else's old stash@{0} ("WIP on bump-aiken-1.1.10", 6 seedelf-contracts files) into my worktree. It conflicted on 4 files and kept the entry. I restored those 4 files to HEAD in my worktree only (`git checkout HEAD -- …`). Afterwards: stash@{0} and stash@{1} are both still listed and unchanged, my worktree held only my 7 docs files before the commit, and the main tree is clean at 8d7c4b0c. Nothing outside my worktree changed. I then took the before-state check by reading the main tree instead. Never use git stash in these worktrees.
2. The docs describe the other lanes' fixes as the brief decides them, so they depend on what lands:
   - words: the en values and the L3 key, picked when s.keyReleases is set;
   - views: the lookedUp prop on session-tx-detail for a cancel or againstPools;
   - swaps: the name-refused and no-route codes, with routeOf keeping first.
   If a lane's merged result differs (for example a different trouble-code name), adjust architecture.md:563-568 and 665, flows.md:262/430, and the backlog's L8 line.
3. I quoted only the row's and the switch's English in architecture.md and flows.md, plus a paraphrase of contractYours. I didn't name the renamed `dappUi.note.warn.contractInputs*` keys (L11 isn't in my lane).
4. Left as is: flows.md:275 "Opening it leaks nothing and costs nothing". The house means no request or fee by "cost", and cross#2's time cost is in the backlog. tx-view.ts:5 ("the cheapest handler") is the views lane's file if you want it touched.
5. The backlog marks L2 and L9 ❓ (the owner's call, per FINDINGS) and the rest ⬜.
6. Two figures in the docs come from the verifiers' runs, not from code: 520,005 ₳ (Indigo) and about 8.9 ₳ (the largest fee at epoch 658's parameters).

