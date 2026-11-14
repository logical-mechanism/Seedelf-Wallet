# r2-docs (r2-docs)

3 finding(s).

## r2-docs#1: architecture.md cites carry_kept's fix to chain-rust#1 only, and drops the note's 'or none'

- **Severity:** nit; **confidence:** traced
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/architecture.md:171`
- **Since:** new in the fixes

**What.** The new sentence in *Chains where needed* ends "no figure counted it, so a funding's privacy note named less private change tied to the one-time account than there was (1.9.1's release review, chain-rust#1)". The fix answers two findings: `carry_kept`'s own comment (wasm/src/lib.rs, above `fn carry_kept`) says "or none (1.9.1's release review, chain-rust#1 and ts-parts#1)", and FINDINGS.md's L1 row lists chain-rust#1 and ts-parts#1. With no change, the note was the other one (`fundingPrivacy` in DappApprovals.tsx:444 shows `fundingWithChange` only when changeLovelace > 0), so "less ... than there was" misses the case where the note said nothing about change at all.

**Scenario.** Someone tracing the 1.9.1 review from architecture.md finds chain-rust#1 but not ts-parts#1. The text also doesn't mention the case where the kept carry was the only change and the funding note left out the private-change sentence altogether.

**Evidence.** architecture.md (Chains line): "...than there was (1.9.1's release review, chain-rust#1)"; lib.rs carry_kept doc: "...named less private change tied to the one-time account than there was, or none (1.9.1's release review, chain-rust#1 and ts-parts#1)"; DappApprovals.tsx:445 `if (BigInt(changeLovelace) > 0n) return t("dappUi.privacy.fundingWithChange", ...)`.

**Suggestion.** "...than there was, or none (1.9.1's release review, chain-rust#1, ts-parts#1)."

## r2-docs#2: flows.md states the reserve as always applied; the code keeps the second plan only where it costs less

- **Severity:** nit; **confidence:** plausible
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/flows.md:370`
- **Since:** new in the fixes

**What.** flows.md now says "Where a part pays more than is owed it pays what leaves the parts of tokens after it their leasts" with no condition. `reserving` (lib.rs, `fn reserving`) keeps the replanned parts only `if again.len() <= first.len() && chains(&again) <= chains(&first) && takes(&again)? < takes(&first)?`. Otherwise it returns the first plan, which leaves one output's least (`keep = least(&later)?.max(0)`). architecture.md states that guard; flows.md doesn't. I found no shape that reaches the fallback: the lead's suite bound reports 0 overpaid after the fix. So the sentence holds wherever it has been tested.

**Scenario.** An amount whose replan needs one more part, or one more carry, than the first plan keeps the first plan's overpayment (one least per token part past the second), where flows.md says it doesn't. I haven't shown this is reachable.

**Evidence.** lib.rs reserving: `Ok(again) if again.len() <= first.len() && chains(&again) <= chains(&first) && takes(&again)? < takes(&first)? => again, _ => first`; architecture.md: "goes where that takes less from the Seedelf balance in no more parts or carries (`reserving`)".

**Suggestion.** Leave it, or add "where that costs no more" in flows.md, as architecture.md has it.

## r2-docs#3: backlog.md's two new lines split the 1.7.2 own#1/own#2 pair

- **Severity:** nit; **confidence:** traced
- **Where:** `seedelf-platform/seedelf-web-wallet/docs/backlog.md:136`
- **Since:** new in the fixes

**What.** The diff inserts the two 1.9.1 lines at @@ -135,0 +136,2 @@, between "A payment to the account's own key past what the balance reads" (1.7.2's release review, own#1) and "An address paid to one of the accounts' stake key hashes" (own#2). Those two are a related pair from the same lane. The section isn't otherwise ordered, so this only hurts reading.

**Scenario.** A reader of *Send and Make public* finds own#1 and own#2 separated by two items on the parts planner.

**Evidence.** git diff -U0 36d90389 23ca5f20 -- docs/backlog.md: hunk @@ -135,0 +136,2 @@; backlog.md lines 135-138.

**Suggestion.** Put the two parts lines after own#2.

## Checked and holds

- architecture.md *The plan*: 'planned again' where paid > max(asked, token parts' leasts) matches `reserving`'s `paid <= owed.max(leasts.iter().sum())` early return. 'each part leaving the leasts of the parts of tokens after it as the first plan made them' matches `reserve[n] = leasts[n+1..].sum()`, with ADA-alone parts at 0, and `keep = least(&later)?.max(reserved)` in in_parts. 'takes less ... in no more parts or carries' matches the guard (len, carries, `taken` = fee plus every payment).
- architecture.md shapes#1 figures (90 boxes plus 50 ₳ paid 54.88 ₳) match shapes.md (54.883230 to a Seedelf).
- architecture.md *Chains*: 'a chain's last part, over the carry and what's left, spends as few as pay' matches chained's `amount(carry + rest, ...)` last try. 'a chain its carries paid ends on one' matches chained's `if tokens.is_empty() && owed == 0 { return Ok(parts) }` after a carry. carry_kept adds an unspent carry's lovelace to change_lovelace, adds 1 to change_outputs and clears carry. It runs in both callers' plan (transfer and withdraw), after reserving.
- Max never leaves a carry unspent: max_chained's last part pays all of carry + rest. So keeping carry_kept off max_in_parts doesn't contradict the docs' general statement.
- architecture.md *The worker*: the minimum is summed only where every part has a minimum and sends tokens. This matches script-spend.ts whole(): `p.payments[0]!.minimum !== null && p.payments[0]!.tokens.length > 0`.
- privacy.md: a kept carry reaches the funding note. sessions.ts:3108 whole() sums changeLovelace, DappApprovals.tsx fundingPrivacy(review.changeLovelace) uses it, and en.json's fundingWithChange says '{{ada}} ₳ private change ... to the one-time account'.
- wasm/README.md: 'A carry no later part spends is its part's change (`changeLovelace`, `changeOutputs`)' holds. The result structs are camelCase serde, and `carry` is `#[serde(skip)]`, so TS never saw it and reads chains off `inputs`.
- backlog.md line 1: core build.rs:2949 `holding` sorts candidates by `Reverse(quantity_in(..))` per token, and `max_inputs_by` exists at build.rs:2894. The figures match shapes.md/tests.md: 1.165 rounds to 1.17 ₳, 0.263 to 0.26 ₳, extra fees up to 3.68 to 3.7 ₳.
- backlog.md line 2: 'two of the parts suite's 108 refused asks' and the fit_part-first remedy match tests#1 (e8 pays 2 more asks).
- chunk-48 record: #381 merged as 4e5ee500 (parents 14b24e59, 363acdf3). Its commits are 3b2e14d8, ab379990, 04b57c4a and 363acdf3, and 363acdf3 is 'chunk 49, what's left, and chunk 48 archived'.
- chunk-46: the proptest 'moved to chunk 49's step 3' matches chunk-49's '### 3. The Rust prover through the deployed bytes: a proptest'.
- chunk-50: the verification README has a '## Next' and no '## Status'. Every README phrase the chunk-50 table quotes is still in README.md ('chunk 48)', 'until upstream merges the fixes (chunk 41)', 'as WalletRegister's operand order was in chunk 41', 'Stop, and tell the owner only').
- Verification README line 7: Typed.lean `wallet_accepts_iff` (↔ walletAccepts), PolicyTyped.lean `policy_accepts_iff` (↔ policyAccepts) and AlwaysFalse.lean `always_false_errors` (Error on any Data, never halts) back 'exactly when its statement in its Aiken source's terms holds ... always_false never does'. Each has #print axioms limited to propext, Classical.choice and Quot.sound. 'a reading, not a proof (*Next*)' matches *Next*'s 'An outside read ... would check what no proof can'.
- Verification README: the kernel's policyAccepts (Seedelf/Every/PolicyTyped.lean:72) uses PlutusCoreBlaster's own `sliceByteString 0 4 tkn`, and Slice/Slice/Common.lean:152's policyAccepts uses `sliceByteStringOpaque`. The two-policyAccepts sentence is exact.
- Verification README and CLAIMS.md: the fork has five changes, and #71 (ByteStringToInteger), #72 (Fq1.t) and #73 (operand order) have merged. This agrees with lakefile.lean's comments, chunk 46's table (#73 merged as 8f76ba5) and *Next*. Slice/'s 'one more' gives six for that package, consistent with README's opaque-slice line.
- Verification README: 'however many' signatories matches wallet_accepts_iff's unbounded statement ('any number of signatories' in Typed.lean's header). Blaster's 128 bound matches Signers/modules.txt (Signers4 to Signers128).
- check.sh: the comments match the code. The CAP/LIMIT case covers `lovejoin-every|Lovejoin.Every.*|seedelf-every|Seedelf.Every.*` (16G, 30m for the whole run). The default list leaves out Seedelf.Every.* and Slice/, and every other Seedelf/*.lean is named or imported. An Undetermined warning sets rc=undetermined and check_failed=1, matching the README's 'fails too (`UNDETERM`)'.
- Relative links: round one's linkcheck.py over architecture.md, flows.md, privacy.md, backlog.md, wasm/README.md, the three chunk plans, seedelf-verification/README.md, CLAIMS.md and Seedelf/Every/README.md gives 'bad 0'.
- House rules on the added lines: no release dates and no store status (the only date in the touched region, chunk 48's '2026-11-12' upstream check, predates this round and isn't a release date). Seedelf is capitalised in prose, and lowercase appears only in paths and check.sh targets. No UI text changed.

## Coverage

I read every doc change in `git diff 36d90389 23ca5f20` (architecture.md, flows.md, privacy.md, backlog.md, wasm/README.md, the af32b1aa chunk plans, and 23ca5f20's README.md, CLAIMS.md and check.sh comments) and checked each against lib.rs (in_parts, chained, reserving, taken, carry_kept, max_chained, the result structs), script-spend.ts whole(), the funding note's path (sessions.ts, DappApprovals.tsx, en.json), core build.rs holding/max_inputs_by, the Lean statements in Seedelf/Every/ (Typed, PolicyTyped, AlwaysFalse) and Slice/Common.lean, lakefile.lean, check.sh, and the round-one reports' figures. Nothing was built or run except the link checker; no worktree was made. Not done: whether reserving's fallback to the first plan (r2-docs#2) is reachable in any shape. That belongs to the shapes and chain lanes. I also didn't re-measure backlog's 3.7 ₳ fee figure after c3d24629; it's a fee figure, which reserving doesn't target. My scratch folder (empty but for mods.txt) is SCRATCH/review-1.9.1/r2-docs/.
