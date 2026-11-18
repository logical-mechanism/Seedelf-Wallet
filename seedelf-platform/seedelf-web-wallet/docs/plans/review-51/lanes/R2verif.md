# Lane R2verif

Returned by the workflow's agent `a85d2d17f801418ff`, written here by the lead from its structured answer.

## Findings (6)

### r2verif#1 · low · check.sh's new SORRY verdict depends on PlutusCoreBlaster's sorry sitting at CekMachine.lean:309; on IOG's main it is at 317, so every module reads SORRY and hides real Undetermined results

- **Where:** `seedelf-verification/check.sh:233`
- **Who:** nobody · **Since:** 40883a55 (the line filter itself dates from 83ae8c2c, where it only hid a console line) · **Confidence:** confirmed-by-run

**Scenario:**

Chunk 46 step 4 points `require PlutusCore` at IOG's main (with #77; #78 is already merged there), then runs ./check.sh, the Lovejoin families and audit-quick to compare counts. On IOG's main (upstream/main 79fce4a, as fetched in ../blaster-forks/PlutusCoreBlaster) the sorry'd `runStepsWithBudget` starts at CekMachine.lean:317 (its sorry is at 333), not 309. Lake replays PlutusCore.UPLC.CekMachine's `declaration uses 'sorry'` warning in the output of every `lake build` that imports it, which is every module. The filter no longer drops it, so unsound >= 1 everywhere: every module reads SORRY and check.sh exits 1. SORRY is tested before UNDETERM, so a module whose own Blaster check came back Undetermined also reads SORRY. A real sorry in our proofs looks the same as all the false ones. The blanket false alarm hides both.

**Evidence:**

FIXTREE check.sh:233 `grep -v -E 'Replayed|CekMachine.lean:309|Successfully decoded|^trace: \.> LEAN_PATH'`; :240 `unsound=$(grep -cE "^warning: .*declaration uses 'sorry'|...")`; :241-242 test SORRY before UNDETERM. README.md:198 states the same pin. Read-only git in ../blaster-forks/PlutusCoreBlaster, `show <rev>:PlutusCore/UPLC/CekMachine.lean`: 68c5399 (main pin), 96261cc (Slice pin) and local/pr77-test cae98df have the def at 309 and the sorry at 324; upstream/main 79fce4a has the def at 317 and the sorry at 333 (#78's 2396bfc touched the file). PlutusCore's trace holds 'PlutusCore/UPLC/CekMachine.lean:309:4: declaration uses 'sorry'' (Lean gives the declaration's line). Lake 4.24 prints every job whose log reaches info, replayed jobs included (Build/Run.lean:123-143; outLv = Verbosity.normal.minLogLv = info, Util/Log.lean:126-129). Run: check.sh lines 215-223, 233, 239-251 and 256-263, extracted verbatim from FIXTREE (sha 760776a7…), fed Lake-format console text. With the warning at :309 plus a module's own '⚠️ Undetermined': `UNDETERM`. The same at :317: `SORRY … (unsound=1, undet=1)`. At :317 with no Undetermined: `SORRY` for a good module. Chunk 46 step 4: 'require PlutusCore from IOG at that commit … After each one: run … ./check.sh … compare against chunk 40's baseline and today's counts'.

**Fix:**

Stop keying on the line number. Either drop every `declaration uses 'sorry'` warning whose file belongs to a dependency (its path under .lake/packages/, or a PlutusCore/, CardanoLedgerApi/ or Blaster/ prefix), or match `CekMachine.lean:[0-9]+:[0-9]+: declaration uses 'sorry'`. Better still, decide SORRY from the module's own trace log, as tally.py does, rather than from the console, which carries every import's replayed log. Report UNDETERM alongside SORRY rather than instead of it. Reword README.md:198 to match.

**Known check:**

Searched backlog.md, docs/archive/plans/, the chunk-46 and chunk-49 plans, Audit/review/findings.md, the verification READMEs and review-51's lanes/verify/fixes for 'CekMachine.lean:309', 'runStepsWithBudget' and '317'. Hits: README.md:198 (which states the pin) and verify/v5-2.md (a copy of check.sh). Chunk 46 records #78's change to the runner but not this line.

### r2verif#2 · low · check.sh reads #print axioms one line at a time, but Lean breaks a list over 120 columns into one axiom per line, so a native_decide (or a sorryAx listed after propext) reads ok

- **Where:** `seedelf-verification/check.sh:240`
- **Who:** nobody · **Since:** 40883a55 · **Confidence:** confirmed-by-run

**Scenario:**

A later edit closes a lemma under one of lovejoin-any-tx's bare-printed kernel theorems with native_decide, for example under Lovejoin.AnyTx.LogicCarrierPredicate.filter_quantities_ne_one (LogicCarrierPredicate.lean:147). Lean gives no warning for native_decide; its only trace is the #print axioms output. That list becomes [propext, Classical.choice, Lean.ofReduceBool, Lean.trustCompiler, Quot.sound], 161 columns, which Lean prints as `…depends on axioms: [propext,` followed by ` Classical.choice,`, ` Lean.ofReduceBool,` and so on, one per line. check.sh's regex needs the forbidden name on the same line as 'depends on axioms: [', so unsound = 0 and the module reads ok. check.sh's header and README.md:176 say such a module is SORRY. Of the 443 bare axiom prints in today's traces, 323 would hide a native_decide this way: all 134 in Lovejoin/AnyTx's modules, 187 of Audit/Checks' 307 and both of Audit/Gaps'. A sorryAx that reaches a theorem only through #print axioms (a sorry in a dependency's declaration, whose warning check.sh filters) lands on line 2, after propext, and is missed the same way. tally.py and count.py read whole messages and do catch both, so check.sh's summary and the readers disagree.

**Evidence:**

FIXTREE check.sh:240 `unsound=$(grep -cE "…|depends on axioms: \[.*(sorryAx|Lean\.ofReduceBool|Lean\.trustCompiler)" "$outf")`; grep matches one line at a time. Lean 4.24: Elab/Print.lean:229 `logInfo m!"'{constName}' depends on axioms: {axioms.qsort Name.lt |>.toList}"`; Message.lean:354-356 `ofList … sbracket <| joinSep xs (ofFormat "," ++ Format.line)`; :342 `bracket … := group (nest …)`. It is a single group, so past the width every separator breaks. Name.lean:61-78: Name.cmp compares prefixes first, so propext and sorryAx sort before two-part names, with propext first. Read-only scan of FIXTREE's traces: the longest one-line axiom message is 120 columns and the shortest wrapped one is 121; 223 of the 443 lists are already wrapped, e.g. "'Lovejoin.AnyTx.LogicCarrierPredicate.filter_quantities_ne_one' depends on axioms: [propext,\n Classical.choice,\n Quot.sound]". Recomputing each bare print with native_decide's two axioms added, sorted as Lean sorts them and broken at 120, then applying check.sh's regex line by line: 323 of 443 missed (Lovejoin/AnyTx 134 of 134). Run of check.sh's extracted lines: the v5-2 verifier's short case ('R51V52Demo.nativeThm' depends on axioms: [Lean.ofReduceBool, Lean.trustCompiler]) gives SORRY; the wrapped five-axiom message above gives ok. README.md:176: 'as does one whose log shows a `sorry` or a `native_decide` (`SORRY`)'; check.sh:7-9 says the same.

**Fix:**

Match each message whole. Either join a 'depends on axioms' message's continuation lines (the ones that start with a space) before matching, for instance with a small awk pass, or decide SORRY from the module's own trace JSON as tally.py does: its COMPILER and sorry checks already read whole messages. Do it in the same change as r2verif#1's.

**Known check:**

Searched backlog.md, archive/plans/, the chunk-46 and chunk-49 plans, Audit/review/findings.md, the verification READMEs and review-51's lanes/verify for 'format.width', 'wrap', 'one per line', 'native_decide' and 'Lean.ofReduceBool'. Hits: chunk 41's rfl note, review-1.8.1's 'no native_decide in the 25 modules', and v5-2's run, whose demo used a short name that didn't wrap.

### r2verif#3 · low · A failed rebuild still reads ok when the module that fails is in a dependency package: check.sh removes nothing, and tally.py and count.py count the old builds

- **Where:** `seedelf-verification/check.sh:250`
- **Who:** nobody · **Since:** 40883a55 · **Confidence:** confirmed-by-run

**Scenario:**

Chunk 46 step 4 moves `require PlutusCore` and `require Blaster` to IOG's main one at a time; the plan notes that PlutusCoreBlaster's and CardanoLedgerApiBlaster's main now require Lean-blaster main. Say one of PlutusCore's or CardanoLedgerApi's modules then fails to compile. Every module check.sh builds fails with lake's exit 1, and Lake prints one line for that job, `✖ [57/130] Building PlutusCore.UPLC.CekMachine`. check.sh picks up the name; forget() finds no PlutusCore/UPLC/CekMachine.lean in seedelf-verification and returns. Because a ✖ name was found, the module asked for isn't forgotten either, so nothing is removed. tally.py and count.py then find every module's trace from the previous pin's build, newer than its unchanged source, with every in-package import traced. They call every module ok and count its old ✅ (in the run below, tally.py reported '0 not ok' and count.py '2 ok'), while check.sh's summary says FAILED for all of them. That is v3#1's case with the failure one package over. The commit message ('a failed rebuild never reads as ok'), README.md:176 ('A module whose build fails, times out or is killed loses its old build files'), Audit/README.md:46, tally.py:14-17 and count.py:16-19 all say otherwise.

**Evidence:**

FIXTREE check.sh:249 `failed=$(grep -aoE '✖ \[[0-9]+/[0-9]+\] Building [A-Za-z0-9_.]+' "$outf" | awk '{print $NF}')`; :250 `[ "$rc" = 1 ] && [ -n "$failed" ] || failed="$failed $m"`; :218 `[ -f "$p.lean" ] || return 0`. Lake 4.24 registers a module's job under its bare name in any package (Build/Module.lean:660 `withRegisterJob mod.name.toString`), and its verb is 'Building' when it ran Lean and failed (Build/Job/Basic.lean:52). A dependency's failed module therefore prints exactly that line, and a dependent that never started is shown as 'Running' or not at all, never 'Building'. The readers follow only imports whose .lean is in the package (tally.py:80, count.py:85) and test only that a trace exists (tally.py:81, count.py:86); neither forget() nor Lake touches the dependency's own old trace. Run: check.sh's lines 215-223 and 239-251, extracted verbatim from FIXTREE, in a fake package under ~/.cache/seedelf-review-51/R2verif (removed since) with FIXTREE's tally.py and count.py copied in. Demo.Top imports PlutusCore.UPLC.CekMachine and Demo.Down imports Demo.Top; both had old good traces, .olean, .ilean and ir .c files. Console with the dependency's ✖ line, exit 1, m=Demo.Down: verdict `FAILED Demo.Down`, the file lists before and after identical, `tally.py Demo` printed '== Demo: 2 modules, 2 Valid, 0 Expected Falsified, 0 not ok', count.py printed '== 2 ok'. Control, the same with `✖ … Building Demo.Top`: Top's four files removed; tally.py printed 'Demo.Top: no trace' and 'Demo.Down: rests on Demo.Top, which has no trace'; count.py printed '1 NO TRACE, 1 STALE'.

**Fix:**

When lake exits nonzero, always forget the module that was asked for unless an in-package module named in a ✖ line accounts for the failure. Either make forget() report whether it removed anything, or simply forget $m on every nonzero rc; that costs nothing, since Lake rebuilds it anyway. More robust is the verifier's option (c): check.sh writes each run's verdict per module, and tally.py and count.py refuse a module whose last verdict wasn't ok. That also covers a timeout while Lake was building an import inside another module's scope. Then correct README.md:176, Audit/README.md:46 and both docstrings.

**Known check:**

Searched backlog.md, archive/plans/, the chunk-46 and chunk-49 plans, Audit/review/findings.md, the READMEs and review-51's lanes/verify/fixes for 'dependency package', 'packages/', 'failed rebuild' and 'NO TRACE'. v3#1 and its verification (verify/v3-1.md) consider only an in-package module failing (in the repro the dependency itself never fails). The verifier noted that option (b) would miss a path-required dependency's change, but not this case.

### r2verif#4 · low · run-all.sh's new failure list can never name `diag` for a LOOK or INCONCLUSIVE replay, because scan-diag.py exits 0 whatever it finds

- **Where:** `seedelf-verification/Audit/run-all.sh:28`
- **Who:** nobody · **Since:** 40883a55 (scan-diag.py's exit behaviour is older) · **Confidence:** traced

**Scenario:**

The audit's diag family replays Blaster's dumped queries and flags LOOK (for example a background that is unsat with no goal: the #194 vacuous ✅) or INCONCLUSIVE. run-diag.sh's last command is scan-diag.py, which prints '{flags} flagged; {incon} inconclusive' and ends without sys.exit, so run-diag.sh exits 0. run-all.sh now takes each family's PIPESTATUS[0], writes '== check.sh or run-diag.sh failed: …' into count.txt and exits nonzero only for nonzero statuses. Its header and Audit/README.md:56 say count.txt carries 'the families whose run failed' and that run-all.sh then exits nonzero. A diag run that found a contradictory background therefore leaves count.txt with no failure line, and run-all.sh exits 0. The audit's last word reads clean on the one family whose job is to catch a vacuous ✅. Before the fix, count.txt claimed nothing about families.

**Evidence:**

FIXTREE Audit/run-all.sh:27-28 `bash Audit/diag/run-diag.sh quick 2>&1 | tee Audit/logs/diag-quick.log` then `rc=${PIPESTATUS[0]}`; :36 `[ "$rc" = 0 ] || failed+=("$f (exit $rc)")`; :41 and :43 `[ ${#failed[@]} -eq 0 ]`; header :4-5. run-diag.sh exits nonzero only for a missing list, a failed cd or no z3 (:19-22), and its last line runs scan-diag.py. scan-diag.py:282-297 counts LOOK and INCONCLUSIVE, :298-300 prints them, :302 is a bare `main()`. Its only sys.exit calls are for a missing z3 (:211, :223).

**Fix:**

End scan-diag.py with `sys.exit(1 if flags or incon else 0)` (or return that from main), so that run-diag.sh's status carries its verdict and run-all.sh lists diag. Alternatively, have run-all.sh grep diag's log for LOOK or INCONCLUSIVE.

**Known check:**

Searched Audit/README.md, Audit/review/findings.md (blaster-unguarded-axioms-unmeasured, closed by Audit/diag), the chunk-46 and chunk-49 plans and review-51 for 'scan-diag', 'run-diag', 'INCONCLUSIVE' and 'exit'. Only v4a-1's note that no full diag run's outcome is recorded; nothing on scan-diag's exit status.

### r2verif#5 · low · README's new Controls bullet says each every-transaction family has a control over its own builder, but most builders have none, and Template.AnyTxPurposes has none and isn't listed as an exception

- **Where:** `seedelf-verification/README.md:95`
- **Who:** nobody · **Since:** 40883a55 · **Confidence:** traced

**Scenario:**

README.md:95 says a contradictory background (#194) 'would make every ✅ over it say nothing. So the every-transaction families have negative controls … each over the family's own builder'. The only exceptions it names are Signers' other 121 lengths, Lovejoin's Mix families and its three- and four-box Owners. But each control probes only the one `#prep_uplc` builder it names, and a family with several builders has one probed:
- WalletPurposeAnyTx: 1 of 5
- WalletNoLockAnyTx: 1 of 18
- WalletRedeemerAnyTx: 1 of 22
So 42 of those three families' 45 ✅ are over builders no control touches; across the wallet families, 8 of 50 builders are probed. In Lovejoin:
- BoxGate, BoxBoundary, BoxSuffix and LogicEmpty: 1 of 3 each
- Reference: 1 of 8
- Launch: 1 of 5
- OwnerTwo and OwnerLayouts: 1 of 2 each
That is 11 of the controlled families' 32 builders. Lovejoin.Template.AnyTxPurposes (16 builders, 15 Blaster checks, in lovejoin-any-tx and in lovejoin-every's imports) has no control at all and isn't among the exceptions. Neither are fee_contract's four families, which the AnyTx README does name. The verifier's own fix note for v4a#1 was that a control probes a theorem's background only when it shares that theorem's .prop. Nothing rests on these modules, since CLAIMS cites the kernel; what's overstated is how far the #194 probe reaches.

**Evidence:**

FIXTREE README.md:95, quoted above. Builders per module (`grep -c '^#prep_uplc'`): WalletPurposeAnyTx 5, WalletNoLockAnyTx 18, WalletRedeemerAnyTx 22, BoxGate 3, BoxBoundary 3, BoxSuffix 3, LogicEmpty 3, Reference 8, Launch 5, OwnerTwo 2, OwnerLayouts 2, Template/AnyTxPurposes 16. Builders the controls name: AnyTxControls.lean:22-31 (appliedAlwaysFalseAnyContext, appliedAnyTxMinting, appliedAnyTxNoDatum, appliedAnyRedeemerThirdI); FalsifiedBox.lean:29-115 (boxNone, boxMissing, boxSuffixAfter, boxInlineAny, emptyOwner, refAbsent, launchSeedAny); FalsifiedOwner.lean:27-74 (ownerOne, twoOwners, soloOwner, ownerOtherInputs). A scan of every `#blaster … (solve-result: 1)` block's `.prop` names under Lovejoin/AnyTx and Template found none over AnyTxPurposes' builders or over FeePurpose, FeeSpend, FeeRecovery or FeeMix. verify/v4a-1.md fix note 2: 'a spec mutant over the same builder. It shares the theorem's own .prop, so it probes the same script background, which a cut query doesn't'.

**Fix:**

Say what's probed: one builder per family, with counts given the way the bullet already gives them for Signers (e.g. one of NoLock's 18 datum shapes has a control). Add Template.AnyTxPurposes and fee_contract's families to the exceptions. Or add a turned-around control per builder: for NoLock and Redeemer that is one mechanical line each, and AnyTxPurposes' 15 failure theorems flip the same way.

**Known check:**

Searched backlog.md, archive/plans/, the chunk-46 and chunk-49 plans, Audit/review/findings.md and review-51 for 'AnyTxPurposes', 'own builder', 'one builder' and 'control'. Found: v4a-1's and v4b-1's fix notes (per-family controls) and chunk 42's AnyTxPurposes record (17 ✅). Nothing on this bullet, which this round added.

### r2verif#6 · nit · AnyTx README's new sentence says LogicLedgerUniqueness needs only the reference inputs' value rule, but its theorems take validReferenceInputs, which also requires them strictly ascending

- **Where:** `seedelf-verification/Lovejoin/AnyTx/README.md:203`
- **Who:** nobody · **Since:** 40883a55 · **Confidence:** traced

**Scenario:**

A reader takes owner/mix_requires_unique_nft_reference and the two _value_one forms to hold for any reference inputs with well-formed values. Their hypothesis is CardanoLedgerApi's V3 validReferenceInputs: every reference input's value well formed and the list strictly ascending by out-ref. The ledger sorts reference inputs, so every real context qualifies; only the wording is narrower than the hypothesis.

**Evidence:**

FIXTREE Lovejoin/AnyTx/README.md:203-204: '`LogicLedgerUniqueness` states the NFT condition under the reference inputs' value rule alone'. LogicLedgerUniqueness.lean:181-184, 198-200, 215-217 and 235-237 take `(hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs …)`. .lake/packages/CardanoLedgerApi/CardanoLedgerApi/V3/Contexts.lean:1122-1131 defines it as `prevTxOutRef < x.txInInfoOutRef && V2.validTxOutValue … && visit …`. The proofs use only the value part (valid_reference_inputs_values), but the statements take the whole predicate.

**Fix:**

Reword to 'under the ledger's rules for reference inputs (sorted, each value well formed)', or restate the four theorems over `∀ i ∈ refs, validTxOutValue i.value`, which is all their proofs use.

**Known check:**

lanes/V4b.md (v4b#2) says these theorems hold 'under validReferenceInputs alone', which the fixer paraphrased. Searched backlog.md, archive/plans/ and the chunk-46 and chunk-49 plans for 'validReferenceInputs': no hits.

## Guards (6)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-verification/check.sh:248` | Claim guard, not a money guard. When a package module fails, times out or is killed, its old build files are removed, so tally.py and count.py read it as unbuilt rather than as this run's ok (r2verif#3 is its gap). | none in CI (no Rust or Vitest test runs Lake); verify/v3-1.md's scratch repro r51_v3_1_repro.sh exercises it |
| `seedelf-verification/check.sh:240` | Claim guard. A module whose console shows `declaration uses 'sorry'`, or a one-line #print axioms naming sorryAx, Lean.ofReduceBool or Lean.trustCompiler, exits nonzero as SORRY (r2verif#1 and r2verif#2 are its gaps). | none found (verify/v5-2.md's scratch run covers its logic) |
| `seedelf-verification/Seedelf/PolicyLinesAll.lean:176` | Claim guard. #guard_msgs holds the five PolicyLinesAll kernel theorems to propext, Classical.choice and Quot.sound, as do LinesAllAnyMint.lean:204-208 (three), LinesAllLoops.lean:157 and PolicyLinesAnyTx's minting_context_layout. A sorry, native_decide or blasterProven beneath any of them fails the build. | the Lean build itself (the fixer's traces show no message); no Rust or Vitest test |
| `seedelf-verification/Seedelf/WalletAnyTxControls.lean:23` | Claim guard. Expected-Falsified twins of the Register families' iffs (and AnyTxControls.lean:21-31's four, Control4/64/127): a contradictory solver background over those builders would print '❌ Unexpected Valid' and fail the build. | the Lean build (5, 4 and 1 Expected Falsified in the fixer's traces) |
| `seedelf-verification/Lovejoin/AnyTx/FalsifiedBox.lean:28` | Claim guard. Expected-Falsified twins of seven box, reference, launch and empty-Mix families' first theorems; FalsifiedOwner.lean:26-74 does the same for four Owner families. | the Lean build (7 and 4 Expected Falsified in the fixer's traces) |
| `seedelf-verification/tally.py:75` | Claim guard. hole(): a module resting on an in-package import with no trace reads not ok; count.py:79 has the same rule. | none found |

## Checked and holds

- All 11 new Lovejoin Falsified controls (FalsifiedBox 7, FalsifiedOwner 4) twin their family's first theorem: same builder, binders and hypotheses, with only the outcome flipped (BoxDatum: the iff's datum test reversed). The fixer's traces hold exactly 7 and 4 '✅ Expected Falsified' and no other message.
- AnyTxControls' 4 and WalletAnyTxControls' 5 controls twin their theorems exactly. Two drop a condition from WalletAnyTx's iff (`vkh = signer`, then the Schnorr check), one turns no-signer into 'returns unit', and Two/Three each drop the last signer. Each is Falsified for the dropped condition; the traces show 4 and 5 Expected Falsified.
- Control4, Control64 and Control127 drop exactly the last disjunct, over Signers{k}'s own appliedSig{k}. gen-seedelf-signers.py, run from a scratch copy, reproduces all 130 generated files byte for byte (Control128 is hand-written). modules.txt and Signers.lean list the controls last, after the modules they import. Each trace shows 1 Expected Falsified.
- gen-lovejoin-anytx-mix-outputs.py, run from a scratch copy, reproduces its 8 files byte for byte; the new passing guards use boxValuePool at every position.
- The passing controls follow v4b-1's fix notes, each at its honest point: mixBadValue at adaValue 10000000 at both positions, mixBadCredential at mixBoxHash, mixBadDatum at box 2's inline datum, mixTokenBadValue at the pool value, refForeign/refName/refQty/refDatum at the pool's own values, and Launch's amount, place and datum at seedArgs' launch. Builders that can't pass get rfl ties. All of them built with no message.
- The ten new #guard_msgs axiom guards (PolicyLinesAll 5, LinesAllAnyMint 3, LinesAllLoops 1, minting_context_layout 1) built clean, so their expected texts are what Lean printed. README.md:86's new sentence holds: every lemma under a cited kernel theorem (LinesAllCek's exec lemmas, policy_fails_redeemer_not_B) sits beneath a guarded one.
- No false SORRY today. check.sh's new regex matches no message in any trace of the root package or its three dependency packages; the only sorry is CekMachine.lean:309, which is filtered. Blaster's 'declaration uses 'blasterProven'' warning doesn't match, at the pin or on Lean-blaster's main. No proof, Audit or Upstream source holds a sorry, admit or native_decide outside comments.
- forget()'s name filter and `$p.*` globs remove only the named module's files (.olean, .ilean, .trace, hashes, ir .c and .setup.json). They never touch a sibling (Owner vs Owner3), an aggregator's folder or a dependency's files, and they remove the outputs Lake would otherwise accept as up to date by mtime when the trace is gone.
- The in-package failure path works end to end on check.sh's own lines: the failed module reads NO TRACE in count.py and 'no trace' in tally.py, and its dependents read STALE / 'rests on' (harness control).
- tally.py's and count.py's hole() is sound on Lean's acyclic imports (its cycle guard only fires on a cycle); a trace whose JSON doesn't read is reported not ok.
- tally.py's changed no-trace rule does what v5-2's note 4 asked: Seedelf/Every's unbuilt kernel modules now read NOT OK instead of skipped. Old and new tally.py give identical results on Lovejoin.
- run-all.sh takes PIPESTATUS[0] inside each branch, lists failed check.sh families in count.txt and exits nonzero for them.
- CLAIMS.md's new lines match the theorems. mix_logic's only hypothesis is validTxOutValue on the reference inputs; one_shot_mint's are validTxOutValue on the outputs plus validMintValue; mix_box's and reference_holder's have none. PolicyShapes' cover takes exactly an input and validMintValue. Blaster's bounds (no lines or 2 to 5 lines, up to 128 signatories) are what its modules prove.
- The new isBalanced wording (deposits, refunds, withdrawals and donations) in Readable.lean, Every/README and the AnyTx README matches CardanoLedgerApi's isBalanced, which is ADA in = ADA out + fee.
- Lake 4.24 captions a module job with its bare name in any package, and uses the verb 'Building' only for a job that ran Lean. So check.sh's ✖ regex picks up exactly the modules whose own compile failed.
- This round changed no .hex, templates.rs, constants.rs, references.rs or lovejoin_proven_bytes_test.rs, and the workflow change is action pins only, so CLAIMS.md's tie to the live pool is unchanged.

## Notes

- The CekMachine.lean:309 filter predates the fix (83ae8c2c), where it only kept one warning out of the console. This round made it decide verdicts (r2verif#1).
- SORRY, like UNDETERM before it, is counted over the whole console, and that carries every import's replayed log, since Lake prints every job at info or above. So a sorry in one in-package module would mark every module that imports it SORRY, each summary line attributing it there. And SORRY wins over UNDETERM, so a module's own Undetermined stays hidden while any import carries a sorry. Nothing matches today.
- `python3 -I tally.py Upstream`, an invocation the docs don't mention, now reports Upstream/blaster-main/lakefile.lean, a Lake config file and not a module, as a standing NOT OK; the old rule skipped it. It also reads BlasterMain's modules against the root package's traces (that part is older).
- A timeout or kill while Lake is building an import inside another module's scope forgets only the module asked for; the import keeps its old trace and reads ok. The window is narrow, since every family lists imports first in their own scopes. The verifier's option (c), per-module verdicts, would close it along with r2verif#3.
- v4a-1's first fix note (add the every-transaction theorems to Audit/diag's #194 replay, the direct measurement) wasn't done this round. The new controls are the indirect probe, and an 'outcome turned around' control only shows that the background has a model meeting the hypotheses; it doesn't test the theorem's content. That is by design under README rule 8.
- README.md:176's 'A module whose build fails … loses its old build files' is also imprecise for a module whose in-package import failed. check.sh keeps that module's build by design (check.sh:244-247), and the readers catch it through hole().
- FIXTREE's .lake has no Seedelf/Every, Slice/ or Upstream/blaster-main builds, and the worktree checkout made every source newer than its trace, so tally.py there reads most modules STALE. I used only the touched modules' fresh traces (11-18 03:2x-03:50) for the build evidence.
- The harness ran check.sh's own lines (extracted with sed from FIXTREE) and copies of tally.py and count.py on synthetic console text and a fake package in ~/.cache/seedelf-review-51/R2verif. No Lean or lake ran and nothing was built; the folder has been removed. FIXTREE's git status is clean.

## Coverage

Read in full: COMMON.md, FIX.md, fix-branches.md; lanes V3, V4a, V4b and V5; verify v3-1, v4a-1, v4b-1, v5-2 and v5-1's head; the fixer reports' heads (no verification fixer report exists in fixes/).

From 40883a55, read in full:
- the whole diff under seedelf-verification;
- check.sh, tally.py and Audit/count.py as files;
- AnyTxControls, WalletAnyTxControls, Control4, Control64, FalsifiedBox and FalsifiedOwner.

Read the diffs of: run-all.sh, the Audit README, CLAIMS.md, the README (plus README lines 20-66 and 186-204), the AnyTx and Every READMEs, the three Readable docstrings, the six Output, Reference and Launch control modules, both generators, the LinesAll modules, PolicyLinesAnyTx and PolicyShapes (plus PolicyShapes 236-268).

Read where it mattered:
- the statement of every twinned theorem; WalletAnyTx, Two and Three; Signers4; Control128's head;
- LogicLedgerUniqueness' and LogicBoxComposition's hypotheses;
- the three lakefiles and manifests; CardanoLedgerApi's validReferenceInputs and validMintValue;
- Lean 4.24's Print.lean, Message.lean and Name.lean;
- Lake 4.24's Build/Run.lean, Build/Job/Basic.lean, Build/Module.lean and Util/Log.lean;
- Blaster's Tactic.lean at 25c0ee0, a16614e and upstream main;
- PlutusCore's CekMachine.lean at 68c5399, 96261cc, cae98df and upstream/main;
- chunk 46's plan; run-diag.sh and the end of scan-diag.py.

Ran, all read-only or in scratch:
- both generators (byte-identical output);
- trace scans over the root and dependency packages;
- old and new tally.py over FIXTREE;
- the harness described in the notes.

Control127 was checked only by regeneration, not by eye.

Not reached:
- Lean's real console output from an actual failing dependency build: the format is inferred from Lake's source, and nothing was built;
- Slice/ and Seedelf/Every build logs (no .lake for them here);
- the Audit modules' content beyond the sorry grep;
- the fixer's statement that the three- and four-box Owner controls came back Undetermined in 540 s;
- every original finding outside v3#1, v4a#1, v4b#1/#2, v5#1-#3 and v2#1/#2.
