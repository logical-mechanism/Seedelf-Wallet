# 1.9.0's review of its fixes: the docs lens

Round two, on the merged fixes at `204c7a93`. Verbatim from its structured report.

## Coverage

Read first: R2BRIEF.md, COMMON.md, FIXBRIEF.md, FINDINGS.md and fix-full.txt (all five lanes, the blind es/ja rounds), plus the verify-full.txt sections I needed (a-impact, dapp-ui#3, cross#1, the V4 cap bound).

Worktree: R/r2/docs/tree, detached at 204c7a93 (review-1.9.0/integrate). I used it read-only, apart from a node_modules symlink for Vitest. It was clean at the end: symlink unlinked, worktree removed with `git worktree remove --force`. The main tree is still clean at 8d7c4b0c and its node_modules is intact.

Docs read in the integration tree. Line numbers moved by 5, so the base's 646/660/665-669 are now 651/665/670-674:
- architecture.md 556-574 and 646-676
- flows.md 255-275, 430 and 466-476
- privacy.md 22-23, 177 and 186
- backlog.md: legend, sections, and every new or changed line (111-112, 139-146)
- wasm/README.md:92, releases.md:50, the chunk-46 plan's outline and diff
- docs/i18n: the provenance, critical-keys and verified-critical diffs, both reviewer notes, and glossary.md's recording rules
- store/README.md, store/privacy-policy.md, e2e/store-images.spec.ts

Code traced against them:
- cip30.rs: 437-492, 933-950, 1080-1136, 1235-1275, 1780-1890
- DappApprovals.tsx: 110-140, 270-315, 1055-1150, 1285-1310
- en/es/ja values for every changed key
- minswap.ts: 79-130, 270-360, 426-442
- sessions.ts: 205-216, 279-297, 820-930, 1590-1620, 3190-3212, 3640-3676, 4125-4195, 4349-4470, 6556-6583
- the tx-view.ts, TxDetail.tsx and Swaps.tsx diffs; Swaps.tsx 2600-2700; ui/swap.ts 60-110
- orders.rs: 15-25, 480-515
- lovejoin.ts: 3470-3500, 3770-3790, 6135-6300, 6905-6925; sessions.ts againBuild; dapp.ts 646-660

What I ran:
- My own link checker, R/r2/docs/scripts/links.py. I self-tested it first: it catches a bad anchor and a missing path, and skips links inside code spans.
  - Over the 7 changed docs: 186 links, 0 broken. The base had 183, with 1 broken (releases.md:50).
  - Over every tracked .md file: 1,502 links, 0 broken. The base had 1,499, with 1 broken.
- `npx vitest run tests/i18n.test.ts tests/words.test.ts tests/i18n-critical-helpers.test.ts` (8G cap): 3 files, 95 tests passed.
- A python3 -I cross-check of the provenance, critical and verified key sets.
- `git log` commit times, to check the house's date convention.

Not done:
- No network, so no `gh pr view 373`. The reviewer note's "five strings PR #373's body says" is unchecked against that body.
- The lead's blind rounds two and three for contractYours aren't in fix-full.txt. I only checked that the note's quoted es/ja values match es.json and ja.json.
- I didn't trace the public account's Mix my boxes again chain for a madeBy look. The private side holds (see checked_ok).
- No Vite, Playwright or cargo runs.
- docs-prep#1 and #2 (seedelf-verification tooling) left alone: a wallet pass is wallet-only.
- Code comments outside the docs were only spot-checked.

## Findings

### r2-docs#1 (low, traced): L6's DRep mark in Transaction details, and the half of L6 left unfixed, are recorded nowhere

**Files:** seedelf-platform/seedelf-web-wallet/docs/flows.md, seedelf-platform/seedelf-web-wallet/docs/backlog.md, seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts

**Claim.** The views lane now marks each account's DRep key as 'Must be signed by you' with no governance check. The sign window counts that key as the user's only when the site was given governance. The lead accepted that difference, but no doc states it: flows.md's Transaction details section has never listed which required signers it marks, not since #373. L6's other half (a dApp account's payment keys past its first 20: the window's, but a stranger's in details) was neither fixed nor given a backlog line. That breaks the house rule that a review leaving something open adds a line for it.

**Evidence.** Code at the integration tree:
- tx-view.ts:294 `const drep = d.requiredSigners.length ? drepKey(keys.cardano) : undefined;`, :296 `|| hash === drep ||`, :312 `drep: restSigners.length ? drepKey(keys.cardano) : undefined,`, :314 `|| h === theirs.drep`. None of these checks governance.
- cip30.rs:437-441: 'the DRep key (`3/0`) when the site was given governance … Without that grant the DRep key is a stranger's'; the code is at 466-470.
- TxDetail.tsx:664 picks `tx.mustBeSignedByYou` from yourSigners. DappApprovals.tsx:1296 shows dappUi.partial (en.json:448), 'You sign your part only. Others sign too before it's sent.', while that key is counted in othersSign.

Commands:
- `sed -n 255,275p docs/flows.md | grep -n -i 'must be signed\|required signer\|signer'` → no output.
- `grep -n -i 'dapp-ui#3\|past 20\|past its first 20\|discovered' docs/backlog.md` → no output.

The records:
- FINDINGS L6: 'Nor another account's payment keys past 20'.
- fix-full views: 'NOT FIXED L6 (dapp-ui#3), the other half', and note 3: 'No doc lists which signer keys Transaction details marks, so the DRep change (L6) needs no docs edit'.
- verify-full dapp-ui#3: 'Nothing documents or accepts leaving out the DRep key', plus the accepted nuance (details 'Must be signed by you' while the window counts the key among othersSign).
- backlog.md:7: 'a chunk or a review that leaves something open adds a line in its area, with the ID it's cited by.'

**Scenario.** 1. A site without governance names the account's DRep key as a required signer, with partialSign. The window's 'It signs for' row leaves the DRep out and says others sign too. Transaction details labels the same hash 'Must be signed by you'.
2. Account 2 is the dApp account and its 0/25 is a required signer. The window counts the key as the user's; details shows it as a stranger's.

Neither the accepted difference nor the open half is written down. The next review re-finds both as new, or the half drops out of the release record.

**Fix.** In flows.md's Transaction details, after the outputs bullet, add one sentence on which required signers read 'Must be signed by you':
- each known account's payment keys: the first 20 of each chain, and the active account's last reading's;
- its stake key;
- its DRep key, whatever the site was given (the window counts the DRep key only with governance);
- each session's keys.

In backlog.md, Signing and the connector, add: '⬜ **Transaction details doesn't mark a dApp account's payment keys past its first 20** (1.9.0's release review, dapp-ui#3): the window counts them; hash the dApp view's discovered paths (SESSION_DAPP_VIEW) in that account's turn.'

### r2-docs#2 (nit, traced): architecture.md:567 calls 10 ₳ 'over the most a fee can be', but no ledger rule caps a fee

**Files:** seedelf-platform/seedelf-web-wallet/docs/architecture.md

**Claim.** The new fee-credit bullet says MOST_FEE_ALLOWED is 'over the most a fee can be at today's parameters, about 8.9 ₳'. The ledger checks only that a fee meets the minimum. About 8.9 ₳ is the largest fee a transaction needs, not the most it can carry. The code's own comment says so, and the same sentence's 'a larger one's row reads up to 10 ₳ short' depends on fees above 10 ₳.

**Evidence.** - architecture.md:567: 'up to 10 ₳ (`MOST_FEE_ALLOWED`, over the most a fee can be at today's parameters, about 8.9 ₳): a contract holding up to 10 ₳ burnt as fee under the key shows only the note and the fee row, and a larger one's row reads up to 10 ₳ short'.
- cip30.rs:1099-1101: 'well over what the largest transaction costs. A fee can be set to anything, and a contract's money burned that way is still gone.' `const MOST_FEE_ALLOWED: u64 = 10_000_000;`
- The ledger's UTXO rule checks minfee ≤ txfee only (FeeTooSmallUTxO); nothing bounds it from above.
- The ~8.9 ₳ is the largest minimum fee at mainnet parameters: 16,384 B × 44 + 155,381, plus the max ex units, plus 200 KiB of reference scripts at the tiered 15 lovelace/B, ≈ 8.885 ₳.

**Scenario.** A reader takes the cap as covering any fee a transaction can carry. In fact it exists because a fee can be set higher: a site that burns a contract's 15 ₳ as a 15 ₳ fee makes the row read 5 ₳.

**Fix.** Change the clause to: 'over the largest fee a transaction needs at today's parameters, about 8.9 ₳, though a fee can be set higher'.

### r2-docs#3 (nit, traced): flows.md:430 says the warning names 'the account's key' after the lead moved the words to 'names you'; two type docs still say 'order or listing'

**Files:** seedelf-platform/seedelf-web-wallet/docs/flows.md, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs, seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts

**Claim.** After the blind round, the lead reworded contractYours away from 'key' in all three languages, and updated architecture.md:563 to match. flows.md:430 still paraphrases the warning as naming the account's key. Separately, cip30.rs:944 and shared/rpc.ts:1168 still describe namesKey as 'likely the user's own order or listing', the claim M1 found false on Indigo's positions.

**Evidence.** - flows.md:430: 'a warning before who it pays, naming the account's key when the contract UTxO's datum does'.
- en.json:514: 'Your signature releases funds from a contract that names you. They may be yours, but they don't come back to you.' es.json:538 says 'en el que figuras'; ja.json:490 says 'あなたが記載されている'.
- The verified-critical note gives the reason: 'menciona tu clave' read as 'your password', and 鍵が記載された as 'the secret key itself written into the contract'.
- `git diff --word-diff review-1.9.0/fix-docs review-1.9.0/integrate -- docs/architecture.md` → 'the contract names the [-account's key-]{+user+} and the funds may be [-the user's;-]{+theirs;+}'.
- `git diff --stat review-1.9.0/fix-docs review-1.9.0/integrate -- docs` lists architecture.md and docs/i18n only, so flows.md kept the docs lane's wording.
- cip30.rs:944 and rpc.ts:1168: 'A contract UTxO's datum names one of the account's keys: it's likely the user's own order or listing.'

**Scenario.** A reader of flows.md expects the warning to mention a key, when it avoids the word on purpose. A developer who words a new string from DappTxSummary.namesKey's doc writes 'order or listing' again, M1's false sentence for positions.

**Fix.** - flows.md:430: 'a warning before who it pays, saying the contract names the user when the contract UTxO's datum names the account's key'.
- cip30.rs:944 and rpc.ts:1168: '…names one of the account's keys: it may be the user's own (an order, a listing, a position).'

### r2-docs#4 (nit, traced): The new reviewer note is dated a day late and says 'Two keys are new' where three were added

**Files:** seedelf-platform/seedelf-web-wallet/docs/i18n/verified-critical-es.json, seedelf-platform/seedelf-web-wallet/docs/i18n/verified-critical-ja.json

**Claim.** Both verified-critical notes open this round's entry with '1.9.0's release review (2026-11-10)'. The round ran on 2026-11-09, local time, and the house dates its records by the local day. The same entry says 'Two keys are new here' and then names three. The keys list adds three.

**Evidence.** The note, in both files:
- '1.9.0's release review (2026-11-10): …'
- 'Two keys are new here: dappUi.warn.unknownInputsKeyReleases, …; and the contract notes, renamed critical, dappUi.note.warn.contractInputs and dappUi.note.warn.contractInputsTokens.'

`git diff 8d7c4b0c review-1.9.0/integrate -- docs/i18n/verified-critical-es.json` adds three keys: +dappUi.note.warn.contractInputs, +dappUi.note.warn.contractInputsTokens, +dappUi.warn.unknownInputsKeyReleases. The ja file adds the same three.

Dates:
- `date` → 2026-11-09 21:21 PST.
- The integration commit 204c7a93 is 2026-11-09 21:07:48 -0800; the words lane's commit is 20:51 -0800.
- The house convention: #373's 766e1c1d (2026-11-08 19:14:34 -0800, which is the 9th in UTC) is recorded as '2026-11-08' in the same note. 8d7c4b0c (2026-11-09 17:02:35 -0800, the 10th in UTC) wrote '2026-11-09' in backlog.md:110.

**Scenario.** The record says the back-translation was checked the day after it was. A reader matching the note against the keys list finds three keys and two accounted for.

**Fix.** In both files: '(2026-11-09)' and 'Three keys are new here'.

## What holds

- Q1, architecture.md:563: the row 'From a contract, not to you', the warning before Pays ('names you… may be yours') and the per-request switch 'I expect this not to come back to me' match en.json:511-514 and DappApprovals.tsx:122-126, 290-303 and 1106-1143.
- Q1, architecture.md:564: each case in the class follows from released_from_contracts (cip30.rs:1108-1136): money kept at the same contract counts as gone, only came_in is credited, each asset on its own. A repayment's 'ADA paid on… up to what the contract held' is min(held, paid) by that formula. The seven Indigo transactions and the 520,005 ₳ top figure match v-a-impact's run.
- Q1, architecture.md:565: namesKey reads only the spent UTxO's datum (cip30.rs:1083-1097, 1270), so a reprice and a relist render the same window, as stated.
- Q1, architecture.md:566: the native-script term is `contract_inputs > 0 && body.script_data_hash.is_none()` (cip30.rs:1839), and the four other proofs match the reworded comment at cip30.rs:1827-1832.
- Q1, architecture.md:567's mechanics hold: the fee less the account's net outflow, capped at 10 ₳ (cip30.rs:1101, 1114-1115, 1133). Only the fee-cap clause is wrong (r2-docs#2).
- Q1, architecture.md:568 matches DappApprovals.tsx:1301-1309 (the new key when keyReleases is set), cip30.rs:1273 (an unfound input never enters contract_held) and 1788-1801 (payment and DRep keys refuse). The es and ja values drop the stake-key sentence too.
- Q1, architecture.md:651: V4's reader takes fields 0, 1 and 5 and V3's fields 1 and 3 (orders.rs:488-515), so 'the wallet reads neither' holds. withinFunding is the runner's only bound (sessions.ts:4174, 6571-6583); Review it myself isn't held to it, which line 652 already says. SWAP_MARGIN's rest is counted as coming back (sessions.ts:211-216, ui/swap.ts:72-80). The backlog#swaps-and-dapps link resolves.
- Q1, architecture.md:665's added clause is right: the unchecked-DEX re-ask happens on mainnet only (minswap.ts:356-359).
- Q1, architecture.md:670 (the base's 665) holds:
- troubleOf gates name-refused to a 400 and no-route to a 404 (minswap.ts:436-442).
- routeOf keeps first and rethrows anything else (sessions.ts:891-904).
- A kept first always ends in routesThrough or routesOutOfPlace (quote, 1603-1610), nowRoutes* (swapBuild, 3202-3209), or a Refused pause (order 4145-4152, step 3665-3667).
- Any other error retries (3668-3673).
- Q2, outOfPlace: its re-ask now keeping the first answer is documented, in architecture.md:670's 'whether made for this or for outOfPlace (above)'. Lines 667-668 stay true.
- Q1, flows.md:262 and 275: the hint is `site || lookedUp` (TxDetail.tsx:377), and Swaps.tsx:2696 sets lookedUp for a cancel or a pool swap, exactly when inspect looks up `others` (sessions.ts:4371-4380). Lovejoin's madeBy look (the views lane's note 4) doesn't break this on the private side: Mix my boxes again's review shows the funding, whose inputs the wallet holds (sessions.ts againBuild, lovejoin.ts:3496).
- Q1, flows.md:430: the row, the switch, 'off for each request' and the class sentence match the code and architecture.md:564. Only the warning's paraphrase is off (r2-docs#3).
- Q1, privacy.md:186: inspect's utxo_info goes to the Cardano server (mainnet's data layer first), the house term (privacy.md:22-23), and the swap names the same pools and collateral once sent.
- Q1, wasm/README.md:92 names the seven fields as TxSummary serialises them (cip30.rs:933-946, 1875-1881), and its architecture.md#dapp-connector link resolves.
- Q1, releases.md:50 now points at archive/plans/chunk-44-lovejoin-v2.md, which exists.
- Q1, the chunk-46 plan: the status (line 5), the table row (17) and step 1 (47) agree with steps 1 ✅, 2 🚧 and 3 ✅. Only those three lines changed.
- Q1, backlog.md: the nine new lines and the updated DEX-name line are one line each, in the right sections, cited the house way. ❓ lines sit in their area sections, as Lovejoin's do. Their claims hold:
- dapp.ts reads no epoch params, so the connector doesn't have the cost models;
- seedelf-platform/CLAUDE.md:96 states the u128 rule;
- answer() takes no switch (dapp.ts:646-652);
- `names_key |=` runs once per input (cip30.rs:1270).
- Q1, docs/i18n:
- Every es value (3,369) and ja value (3,021) has a provenance entry, and none is stale.
- critical-keys.json adds the three new keys, and each verified list equals the critical set.
- The note's quoted es and ja values match es.json and ja.json.
- i18n, words and i18n-critical-helpers: 95 of 95 tests pass.
- Q2, apart from L6: L3's line (architecture.md:568), L7's hint (flows.md:262, 275), L8's codes outside routeOf (backlog.md:111) and L9's cap (architecture.md:651) are documented. L6 isn't (r2-docs#1).
- Q3: the owner's docs rules hold. No release date, store status or release notes were added. The only new dates are plan steps (chunk 46) and the note's review date (r2-docs#4), and every backlog entry is one line.
- Q4: no privacy-policy Changes entry is owed, because nothing sent, kept or revealed changes:
- the words and the inputs hint are text only;
- L6 derives the DRep key on the device (tx-view.ts:228, 294, 312), with no request and nothing stored;
- L8 stores a pause where it stored a retry, in the same sealed session record, and sends Minswap fewer requests;
- the Rust changes are tests and comments;
- privacy.md:186 states a lookup from chunk 24, of UTxOs the submitted swap names anyway.
The policy (privacy-policy.md:27, 52-54) makes no claim about Transaction details' lookups.
- Q5: the store images need no regenerating this round. store-images.spec.ts:218-247 shoots Home, Send privately, Create a Seedelf, Make public and the Cardano tab. Every changed translation key is a dappUi.* sign-window key, and the changed components (DappApprovals, TxDetail's inputs hint, Swaps' session review) are on none of those screens. docs/store is unchanged in the diff.
- Q6: no broken relative link in any changed doc. My own checker found 186 links in the 7 changed docs and 0 broken (the base: 183 links, 1 broken at releases.md:50, now fixed). Over all tracked Markdown: 1,502 links, 0 broken (the base: 1,499, 1 broken).
- No doc outside the verified-critical history quotes the old words ('Leaves a contract', 'leave the contract', 'own order or listing'), and neither does media/. The store listing's 'Nothing is looked up to show it' (store/README.md:60) still holds for the view itself, which asks nobody.
- L6 adds about 0.43 ms per account turn to cross#2's cost, and the backlog line's figures still hold.
