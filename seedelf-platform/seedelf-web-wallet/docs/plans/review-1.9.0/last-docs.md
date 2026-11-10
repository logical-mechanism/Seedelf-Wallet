# 1.9.0's release review: the last look, docs

On the merged fixes and round two's fix-ups, at `b40c53b4`. Verbatim from its structured report. The lead fixed every finding before the commit.

## Coverage

Read: R2BRIEF, COMMON, FINDINGS, fix-full.txt (the docs lane in full, and the views lane's NOT FIXED note at :601), r2-full.txt (all 16 findings), folder/back-translation.md, and the PR #373 body saved by round one (v-cip30-lows/pr373-body.md).

The diff, word by word with my scripts:
- b40c53b4's docs and comment changes: architecture.md, flows.md, backlog.md, both verified-critical notes, cip30.rs:944, rpc.ts:1168, and the tx-view-screen.test.ts comment;
- the whole of 8d7c4b0c..b40c53b4 over architecture.md, flows.md, privacy.md, backlog.md, wasm/README.md, releases.md, the chunk 46 plan and docs/i18n.

Code traced against them:
- cip30.rs: Keys/keys_of 437-492, the TxSummary fields 925-946, datum_names_key 1080-1098, MOST_FEE_ALLOWED and released_from_contracts 1100-1137, the names_key loop 1255-1275, the unfound-input refusal 1780-1801, `tied` 1812-1819, key_releases 1828-1840;
- tx-view.ts 1-60 and 180-320 (markYours, drepKey);
- dapp.ts: view/read, dappAccount, publicKeys;
- balances.ts:394; shared/preferences.ts:171;
- DappApprovals.tsx 1060-1150 and 1285-1310; ui/dapp.ts releasesContractFunds; TxDetail.tsx:405;
- sessions.ts directSpends;
- lovejoin.ts: poolRows 3216-3265, againBoxes, fanOut, lookUp 6183-6213, inputsOf 6265-6300, the due box's made() at 6922;
- privacy.md:115, 186 and 236-238;
- the en/es/ja values of every changed key.

Ran in my own worktree, R/last/docs/tree, detached at b40c53b4 (node_modules symlinked, wasm/pkg copied):
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/last/docs/scripts/relinks.py: self-tested first, then over the 7 changed docs and all tracked .md, and again over a `git archive` of 8d7c4b0c;
- `npx vitest run` over the six i18n guards plus dapp-prompt, under MemoryMax=8G: 7 files, 182 passed;
- python3 -I checks: the verified and critical key lists against 8d7c4b0c, the new note segments extracted and every quote checked against the shipped values, provenance labels, every en/es/ja key changed since 8d7c4b0c, the NBSP in all 12 note values, and that the JSON files parse;
- addedwords.py scans of the added words only, for dates, store status, release notes and the Seedelf name style;
- `git diff --check`.

Cleanup: the symlink is unlinked and the worktree removed. The main tree is clean at 8d7c4b0c and its node_modules is intact. R/integrate/tree was only read through git (its untracked node_modules symlink was already there).

Not done:
- No network, so no `gh`: PR #373's body is the copy round one saved.
- No cargo, Vite or Playwright. The code and test fix-ups in b40c53b4 (the e2e, dapp-prompt's assertions, swap-routes) belong to the code lane: I read only their comments.
- The 8.9 ₳ figure is recomputed from the parameters r2-docs used, not fetched.
- No native speaker read anything.
- seedelf-verification's own docs are left alone: a wallet pass is wallet-only.

## Findings

### last-docs#1 (nit, traced): architecture.md:568's new sentence says a withdrawal or certificate proof sets no keyReleases, which holds only for an unfound input

**Files:** seedelf-platform/seedelf-web-wallet/docs/architecture.md, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs

**Claim.** r2-window#3's fix-up dropped the subject from the fix it was given ('an input the wallet couldn't find, released by…'). The sentence now states as a rule what is true only beside an unfound input, where there's no datum to read.

A found contract UTxO whose datum names the stake key does set keyReleases through namesKey when a zero withdrawal or a certificate is its proof. That is what 566 implies, since it says the note alone shows only when such a datum is withheld. It is also what the rust lane's comment says.

563's older parenthetical names only the owner's-input proof. So the paragraph now reads as though withdrawal and certificate proofs never get the warning.

**Evidence.** In the integration tree (b40c53b4):
- architecture.md:568: "A release proved by a withdrawal or a certificate of the stake key sets no `keyReleases`, so beside an unfound input the line stays: the window can't tell it from chunk 29's honest delegation (1.9.0's review of its fixes, r2-window#3)."
- architecture.md:566: "…and a contract taking a proof other than a required signer (the owner's own input spent, a withdrawal, a certificate, a vote) whose datum is kept by hash and left out."
- architecture.md:563, unchanged since #373: "or named by such a datum (for a contract that takes the owner's own input being spent as its proof)".
- cip30.rs:1828-1830: "A datum that names the account's key covers a contract that takes another proof of the owner, which needs no required signer: the owner's own input being spent, or a withdrawal, a certificate or a vote of the owner's key".
- Code: cip30.rs:1271 `names_key |= datum_names_key(row, &carried, &keys);` runs for every found script input, whatever its proof. 1834 `let key_releases = names_key || …`. Keys::of_hash (484-492) matches the stake key first.
- Round two's own run (r2-full.txt:151): the q3DatumNamesStake dump has keyReleases true beside an unfound input.

Commands: `git show b40c53b4 -- docs/architecture.md`, word-diffed with last/docs/scripts/wdshow.py; `sed -n 1225,1280p` and `sed -n 1820,1845p` of wasm/src/cip30.rs.

**Fix.** 568: "An unfound input released by a withdrawal or a certificate of the stake key sets no `keyReleases` (there's no datum to read and no required signer), so its line stays: the window can't tell it from chunk 29's honest delegation or zero withdrawal (1.9.0's review of its fixes, r2-window#3)."

563's parenthetical: "(for a contract that takes another proof of its owner: its own input spent, a withdrawal, a certificate or a vote)".

### last-docs#2 (nit, traced): flows.md:262 and backlog.md:148 say a dApp account's payment keys past its first 20 read as anyone's, but the active account's are marked from its reading

**Files:** seedelf-platform/seedelf-web-wallet/docs/flows.md, seedelf-platform/seedelf-web-wallet/docs/backlog.md, seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts

**Claim.** r2-docs#1's fix-up puts L6's open half on 'a dApp account'. But markYours adds the keys the active account's last reading found. So the dApp account's keys past 20 are marked whenever it is the account on screen, which is every one-account wallet: Settings' dApp account defaults to 0.

The gap is a dApp account other than the one on screen. That is how FINDINGS' L6 ('another account's payment keys past 20') and the views lane's own note put it. The bullet's '(…, and the active account's last reading's)' contradicts its own last sentence.

**Evidence.** - flows.md:262: "…each known public account's payment keys (the first 20 of each chain, and the active account's last reading's)… A dApp account's payment keys past its first 20 read as anyone's: a line in the backlog."
- backlog.md:148: "Transaction details doesn't mark a dApp account's payment keys past its first 20 (1.9.0's release review, dapp-ui#3): the sign window counts them as the user's, and details as anyone's; …"
- tx-view.ts:273-274: `const found = await session.get<AccountAddresses>(SESSION_ACCOUNT_ADDRESSES_PREFIX + network); const account = accountKeys(keys.cardano, found?.keys);`. At :296, `if (account.has(hash) || …)` pushes to yourSigners.
- balances.ts:394 keeps the walk's paths: `keys: [...account.paths.keys()]`.
- Every other account gets the first 20 alone: tx-view.ts:310 `accountKeys(keys.cardano)`.
- shared/preferences.ts:171: `dappAccount: 0`.
- fix-full.txt:601, the views lane: "markYours checks each other account's first 20 keys of each chain… only the active account adds the keys its last reading found."

**Fix.** - flows.md:262: "Another account's payment keys past its first 20 read as anyone's, the dApp account's too when it isn't the one on screen, though the sign window counts them: a line in the backlog."
- backlog.md:148's title: "…doesn't mark the dApp account's payment keys past its first 20 when it isn't the account on screen".

### last-docs#3 (nit, traced): flows.md:261 says the collateral ⓘ "doesn't say yet" whose a Danogo swap's collateral is, but it names the paying account's, which the wallet checks

**Files:** seedelf-platform/seedelf-web-wallet/docs/flows.md, seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx

**Claim.** r2-views#2's fix-up understates the defect. For this swap the ⓘ isn't silent: it says the paying account's collateral is put up and the wallet checks the contract first. Both are untrue for a swap against Danogo's pools. backlog.md:113 words it right.

**Evidence.** - flows.md:261: "A session's swap against a DEX's pools carries Minswap's, which the ⓘ doesn't say yet (1.9.0's review of its fixes, r2-views#2, a line in the backlog)."
- TxDetail.tsx:405: `hint={tr("tx.privacy.collateralHint")}`, with no condition.
- en.json:2810: "Collateral is taken only if a contract fails, which the wallet checks first. … Any other puts up the paying account's."
- sessions.ts:6728-6730: directSpends refuses the session's own collateral, "at stake on scripts the wallet never runs".
- backlog.md:113: "…call its collateral the paying account's … it's Minswap's, on scripts the wallet never runs."

**Fix.** "…carries Minswap's, which the ⓘ still calls the paying account's, and says the wallet checks the contract, though the wallet never runs Danogo's scripts (1.9.0's review of its fixes, r2-views#2, a line in the backlog)."

### last-docs#4 (nit, traced): r2-views#1's fix-up keeps the test comment's false premise, and its trigger lists are narrower than the code's

**Files:** seedelf-platform/seedelf-web-wallet/extension/tests/tx-view-screen.test.ts, seedelf-platform/seedelf-web-wallet/docs/flows.md, seedelf-platform/seedelf-web-wallet/docs/backlog.md

**Claim.** (a) The test comment. The fix-up appended the madeBy case but kept 'Its own builds spend what it holds'. r2-views#1 named that false for every mix, which spends strangers' boxes from a whole pool read. What sets the hint is a lookup by outpoint, not what the wallet holds.

(b) The trigger lists. flows.md:263 and backlog.md:149 name the case as 'on Koios alone (preprod, or mainnet with Koios only or the private index down), after a restore or for a box another mix moved'. The code is wider in two ways:
- lookUp asks Koios about any box whose pool the private index didn't list, and that includes a token pool the data layer doesn't cover while it is up;
- privacy.md:238 also counts a box from another device among the boxes no record accounts for.

**Evidence.** - tx-view-screen.test.ts:123-125: "Its own builds spend what it holds, bar a session's cancel and its swap against a DEX's pools (…cross#1), and a Lovejoin mix spending a box whose making it asked Koios about, which doesn't say so yet (r2-views#1, in the backlog)."
- r2-full.txt:309 (r2-views#1): "'Its own builds spend what it holds, bar a session's cancel and its swap against a DEX's pools'. Every mix also spends strangers' boxes."
- lovejoin.ts:6190-6192: `const covered = (pool) => (pool === CLASSIC ? p?.classic === true : p?.fed.has(pool) === true); const koios = new Set(ask.filter((b) => !covered(poolOf(b)))…)`.
- lovejoin.ts:3220-3222: "…for the pools it covers; a pool it doesn't, or every one while it can't answer, from Koios".
- privacy.md:238: "(after a restore, a box from another device, or after Mix my boxes again took boxes not mixed yet)".

**Fix.** - The comment: "Its own builds look up no input by outpoint (a Lovejoin pool is read whole, which names none), bar …".
- flows.md:263 and backlog.md:149: "…a box no record accounts for (after a restore, from another device, or one another mix moved), in a pool read from Koios…".

### last-docs#5 (nit, traced): The 'likely the user's' reading survives in datum_names_key's doc, one function below the comments r2-docs#3 reworded

**Files:** seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs

**Claim.** The fix-up changed namesKey's doc at cip30.rs:944-945 and rpc.ts:1168 to 'in whatever role: it may be the user's own (…), or not'. The function that computes namesKey still calls the matched key the contract's owner, and the UTxO likely the user's. The phrase wraps across a line break, so a one-line grep for it finds nothing.

**Evidence.** - cip30.rs:1080-1083: "Whether a contract UTxO's datum names one of the account's keys: its 28-byte hash anywhere in the datum's bytes, in whatever shape the contract keeps its owner (a canceller, a listing's seller, an owner's address). … Says which UTxO is likely the user's, not what the contract does with it."
- cip30.rs:944-945, by contrast: "…in whatever role: it may be the user's own (an order, a listing, a position), or not."
- `grep -rn -i "likely the user"` over wasm/src, extension/src and the docs found nothing; `grep -n likely wasm/src/cip30.rs` finds 1082.
- `git log -S` dates the text to #373 (766e1c1d).

**Fix.** "…anywhere in the datum's bytes, in whatever role the contract gives it (an owner, a canceller, a seller, a payee). It says the key is named, not whose the UTxO is or what the contract does with it."

### last-docs#6 (nit, traced): wasm/README.md's inspectDappTx row, extended this round, still lists only some of inspect's refusals (pre-existing)

**Files:** seedelf-platform/seedelf-web-wallet/wasm/README.md

**Claim.** The row now names the seven new fields correctly, but its last sentence still reads as the full list of what inspect throws. It leaves out three refusals:
- the DRep key's signature over an input inspect can't find;
- a signature over a transaction nothing ties to the network (chunk 29);
- a transaction over 64 KiB or nested past 128 levels.

The gap dates from chunk 22, not this round, so fixing it is optional.

**Evidence.** - wasm/README.md:92: "Throws for the other network, a collateral return to someone else, a transaction marked to fail, one that makes the stake key a pool's owner, an old deregistration without `stakeDeposit`, or a payment key's signature over an input it can't find."
- cip30.rs:1789-1791: `.any(|s| matches!(s, Signer::Payment(_) | Signer::Drep))`, the DRep half since 3e96a162.
- cip30.rs:1816: `if !tied && !signers.is_empty() { bail!(…)`.
- cip30.rs:1146: "it's far larger than Cardano allows"; architecture.md:569 has the 64 KiB and 128-level limits.
- `git log -S"or a payment key's signature over an input it can't find" -- wasm/README.md` gives 83880dd6, chunk 22.

**Fix.** "…or a payment key's or the DRep key's signature over an input it can't find, any signature over a transaction nothing ties to its network, or one over 64 KiB or nested past 128 levels." Optional, since it predates this round.

## What holds

- r2-docs#2: architecture.md:567 now reads "over the largest fee a transaction needs at today's parameters, about 8.9 ₳, though a fee can be set higher", which matches cip30.rs:1100-1102. The ≈8.885 ₳ arithmetic r2-docs gave reproduces: 16,384×44+155,381, plus 16.5M×0.0577 and 10G×0.0000721, plus 200 KiB of tiered reference scripts.
- r2-window#3: 568's mechanics hold beside an unfound input. key_releases has three sources only (cip30.rs:1834-1840), the unfound line takes the new key when keyReleases is set (DappApprovals.tsx:1305), and a payment or DRep signer over an unfound input is refused (1789-1801). Only the wording is off (last-docs#1).
- r2-docs#3/r2-window#4: flows.md:431 now says the warning names the user when the datum names one of the account's keys, which matches DappApprovals.tsx:1142 and en's "a contract that names you". namesKey's docs at cip30.rs:944-945 and rpc.ts:1168 are reworded. The third copy is last-docs#5.
- r2-docs#1: flows.md:262 matches markYours (tx-view.ts:252-317): each account's payment keys (the first 20 of each chain, plus the active account's reading), its stake key, its DRep key with no governance check (drepKey :228), and each session's one-time and stake keys. The window counts the DRep key only with governance (cip30.rs:437-441, 466-470). Only the last sentence is off (last-docs#2).
- r2-views#1: flows.md:263 and :276 name the case, and "It asks nobody anything" stays true of the view itself. backlog.md:149's mechanism matches lookUp→madeBy→inputsOf (lovejoin.ts:6183-6213, 6273-6300, koiosAlone().txSpends). The views that open it are ChainTxs :1025, the page's modal :1994 and the review's :3139.
- r2-views#2: backlog.md:113 is accurate. A swap against Danogo's pools never puts up the session's collateral (sessions.ts:6728-6730), and privacy.md:186 says it's Minswap's.
- r2-swaps#2: backlog.md:111 now says a name routeOf adds fails only the swaps routed through it, so the quote is refused and the runner pauses. That matches architecture.md:670 and the code r2-swaps traced.
- r2-docs#4/r2-window#5: both notes now say 2026-11-09 and "Three keys are new here". A python diff against 8d7c4b0c shows each verified list gaining exactly those three (482 to 485), equal to critical-keys.json. "in round one, and contractYours again in rounds two and three" matches folder/back-translation.md's rounds.
- The "Its notes hold" sentences keep only readings back-translation.md records: es 'no hacia ti' read as 'not meant for you', the subjectless 'Gasta' and 'UTxOs'; ja 使用する beside 消費します, 分 read as a shortfall, and 記載 as paper vocabulary. ja's 内容/中身 pair, from the same reading, is kept for the same reason and goes unnamed. That's fine.
- Every value the note quotes as shipped is in es.json or ja.json (script check). The old values it quotes (Sé que, menciona tu clave, te menciona, 想定どおりです, 鍵が記載された, あなたを指定した) appear in no shipped value. Its English quotes equal en's contractRow, contractAck and contractYours.
- contractMaybe and tx.privacy.inputsHintSite are unchanged in en, es and ja. "the five strings PR #373's body says" matches the saved body ("the five new critical strings") and #373's five added critical keys.
- The new key reuses unknownInputs' first sentence word for word (en one/other, es one/many/other, ja other), and unknownInputs was in both verified lists at 8d7c4b0c. All 12 note values carry U+00A0 before ₳.
- Provenance: the new and renamed keys are labelled machine and listed verified, as #373's were (house practice, i18n#6). No old dappUi.note.contractInputs* entry is left, and all five docs/i18n JSON files parse.
- In my worktree, the i18n guards plus dapp-prompt pass: 7 files, 182 tests.
- Link check, with my own relinks.py, self-tested on 6 good and 4 bad links: the 7 changed docs have 186 relative links and 0 broken (the base: 183, with 1 broken at releases.md:50). All 130 tracked .md files have 1,502 links and 0 broken (the base: 1,499, 1 broken). No heading changed.
- Docs rules hold. The only dates among the added words are a plan event (chunk 46, 2026-11-08) and the note's review date; the ChakraBondingCurve date was already there. No store status, no release notes. Each new backlog entry is one line in its area, cited the house way. `git diff --check` is clean.
- b40c53b4 changes no runtime code (its cip30.rs and rpc.ts edits are doc comments), so round two's checks of the docs against the code still stand. No privacy-policy Changes entry is owed, and the store images are unaffected.
- The rest of my part holds: architecture.md:563-567, 651, 665 and 670; privacy.md:186; wasm/README.md:92's seven fields, exactly the TxSummary fields added since f77aa5c1; releases.md:50's link; and chunk 46's status, table row and step 1, which agree with steps 1 ✅, 2 🚧 and 3 ✅.
