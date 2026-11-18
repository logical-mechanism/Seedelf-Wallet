# Lane V4b

Returned by the workflow's agent `a1d3854c459759a78`, written here by the lead from its structured answer.

## Findings (2)

### v4b#1 · low · AnyTx's output, reference and launch failure families have no passing control on their own builders

- **Where:** `seedelf-verification/Lovejoin/AnyTx/MixOutputControls.lean:124`
- **Who:** nobody · **Since:** a04ca256 (2026-11-05; in web-wallet/1.8.0 and later) · **Confidence:** traced

**Scenario:**

Say a later edit misplaces a field in one of these builders: `MixOutputs.output` (MixOutputs.lean:18-19), `MixAda3Output.badOut` (MixAda3Output.lean:18-20), `Reference.candidate` (Reference.lean:20-23) or `Launch.amountArgs`/`placeArgs`/`datumArgs` (Launch.lean:31-49). Every scenario built on that builder then errors for that reason alone, whatever the varied field holds. An always-erroring run satisfies every `isUnsuccessful`, so these theorems would all stay Valid: the 8 in MixOutputs (:78-109), MixTokenOutputs.wrong_token_value, the four MixAda/MixToken 3/4 Output wrong_value, Reference's foreign/name/quantity/datum failures (:67-80), and Launch's wrong_name_or_quantity, wrong_destination and invalid_reference_datum (:63-79). Every #guard in MixOutputControls, MixTokenOutputControls and MixAda3/4- and MixToken3/4OutputControls would still pass too, because each one asserts `endsInError`. `./check.sh lovejoin-any-tx` would stay green while those theorems say nothing about walk_outputs or the carrier and launch checks. README.md:244 says the `*Controls` modules 'run passing vectors and changed transactions', but the six Output control modules run only changed ones. Nothing is vacuous today: read out, each builder at its passing point equals a scenario whose honest run is guarded. For example, MixOutputs.valueArgs with bad = `.Map [(.B "", .Map [(.B "", .I bl)])]` and first = true is MixTwo.args, whose exec returns unit at MixTwoControls.lean:21.

**Evidence:**

MixOutputControls.lean:124-140 has eight `#guard endsInError (mixBad*.exec …)` lines and no `endsWithUnit`. MixTokenOutputControls.lean:55-60 has three `endsInError`. MixAda3OutputControls.lean:46-48 and MixAda4OutputControls.lean:62-65 (likewise MixToken3/4OutputControls) have `endsInError` only, with `(.Map [])` as the bad value. ReferenceControls.lean:117-148 passes only ownerOne, refOtherBefore and refOtherAfter, never refForeign, refName, refQty or refDatum at their honest arguments. LaunchControls.lean:94-99 passes only launchSeedAny. README rule 3 (seedelf-verification/README.md:215): 'Pair a failure property with a run that passes.' Ties checked by reading:
- `output cred stake value datum script := .Constr 0 [.Constr 0 [cred, stake], value, datum, script]` (MixOutputs.lean:18-19) equals `MixTwo.boxOut M bl a b` (MixTwo.lean:50-52) at cred = Constr 1 [B M], stake = Constr 1 [], value = the box value, script = Constr 1 [].
- `Reference.candidate P nftName 1 (datum M) f` equals OwnerOne's `carrierRef … P M 10000000 "" "" 0 800000 testL testL`.
- `Launch.datumArgs` at (10000000, "", "", 0, 1000000) is `refAt rh P saneDatum` (Template/Launch.lean:38, :47).
The audit's same-class findings were closed only for the modules it covered: out-builders-not-tied by Audit.Gaps.V2.GapOutTies, osm-fee-failure-only by Audit.Gaps.Template.AuditPasses. Audit/README.md:7 says the every-transaction (AnyTx) work came after it. I also regenerated the four AnyTx generators into scratch, and all 19 outputs match the tree byte for byte, so the gap is in the generator's design too (gen-lovejoin-anytx-mix-outputs.py writes only endsInError controls).

**Fix:**

For each builder, add one `#guard endsWithUnit (NAME.exec …)` at its passing point, beside the failing lines:
- mixBadValue, mixTokenBadValue and anyTxMix{Ada,Token}{3,4}BadValue at bad = the box value;
- mixBadCredential at c = mixBoxHash;
- mixBadDatum at the honest inline datum;
- refForeign at Q = nftPolicy, refName at nftName, refQty at 1, refDatum at `datum mixBoxHash`;
- launchAmountAny at (nftName, 1), launchPlaceAny at (Script rhHash, none, none), launchDatumAny at a sane datum.
The builders that can never pass (mixBadStake, mixBadReference, mixBadKey, mixExtraBox, launchTwoNamesAny) get an `rfl` lemma instead, tying the builder with its varied field set honest to the guarded scenario, as GapOutTies does for V2. Put the passing lines into gen-lovejoin-anytx-mix-outputs.py so the generated controls carry them. Then README.md:244 is true as written.

**Known check:**

Searched Audit/review/findings.md and findings.json: out-builders-not-tied, osm-fee-failure-only and steps-runs-printed-not-guarded were each closed for V2 or Template modules, none for AnyTx. Also searched backlog.md, archive/plans/ (review-1.8.1.md's Left open names only the two orphan AnyTx modules; chunk-42 and chunk-45) and the chunk-46 and chunk-49 plans for 'Controls', 'passing control', 'MixOutputControls' and 'out-builders': nothing on AnyTx's controls.

### v4b#2 · nit · AnyTx README understates the ledger hypotheses of LogicBoxComposition and of the _valid forms

- **Where:** `seedelf-verification/Lovejoin/AnyTx/README.md:195`
- **Who:** nobody · **Since:** a04ca256 (LogicBoxComposition and its README paragraph, 2026-11-05); e6897cde (the isBalanced sentence, 2026-11-06) · **Confidence:** traced

**Scenario:**

Take a real v2 Owner or Mix that spends a well-formed box and also does one of these:
- withdraws a non-zero balance from mix_logic's reward account (a governance deposit can be refunded there);
- pays a certificate deposit;
- carries a treasury donation.
It fails CardanoLedgerApi's `isBalanced`, which is lovelace of inputs = lovelace of outputs + fee, with no withdrawal, deposit, refund or donation term. So its spending context's `validScriptContext` is false, and the four routed theorems in LogicBoxComposition (owner/mix_routed_box_spend_requires_nft and _value_one) say nothing about it. Yet README.md:195-199 states their result for any transaction where 'the explicitly assumed ledger routing executes the specified mix_logic template successfully', with no validity premise.
Separately, README.md:73-76 lists 'deposits, refunds or withdrawals' as what isBalanced lacks. A treasury donation is a fourth term, so a reader would take a donating Owner or Mix to be inside the `_valid` forms.
No funds depend on either: mix_logic_accepts_iff, the result CLAIMS.md cites, assumes only value rules.

**Evidence:**

LogicBoxComposition.lean:51-52 `(hValid : CardanoLedgerApi.V3.Contexts.validScriptContext (⟨tx, red, .SpendingScript ref resolved⟩ : ScriptContext) = true)`, and the same at :80, :109 and :137. It is used only at :65-68, to get `validReferenceInputs` through `LogicLedgerCarrier.valid_reference_inputs_of_valid_context` (LogicLedgerCarrier.lean:148-155). `.lake/packages/CardanoLedgerApi/CardanoLedgerApi/V3/Contexts.lean:1209-1213` is `isBalanced ctx := lovelaceOf sv = lovelaceOf pv + txInfoFee && …`, with valueSpent and valueProduced summing only inputs and outputs (:716-730). validTxInfo ends `&& isBalanced ctx` (:1270). LogicLedgerUniqueness.lean:181-235 states the same conclusions under `validReferenceInputs` alone.

**Fix:**

Weaken the four theorems' `hValid` to `validReferenceInputs ⟨tx, …⟩ = true`. That is all the proof uses, and LogicLedgerUniqueness already states its results this way, so the theorems would then cover every real transaction. Otherwise, say at README.md:195 that they hold only for contexts the ledger model fully accepts. At README.md:74, write 'deposits, refunds, withdrawals or donations'. The change is kernel-only: rebuild through `./check.sh lovejoin-any-tx`, and the axiom guards at LogicBoxComposition.lean's end stay as they are.

**Known check:**

Searched Audit/review/findings.md (the audit predates AnyTx; it never mentions validScriptContext or isBalanced), backlog.md, archive/plans/chunk-45-lovejoin-every-tx.md and review-1.8.1.md, and the chunk-46 and chunk-49 plans for 'isBalanced', 'validScriptContext', 'donation' and 'LogicBoxComposition'. The only hit is the README's own `_valid` caveat, which is what this corrects.

## Guards (11)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-verification/Lovejoin/AnyTx/BoxPurposesAll.lean:64` | A well-formed inline box at mix_box moving without a Script(L) withdrawal (so without mix_logic running), in every typed V3 context; also any non-spend purpose (on chain: Lovejoin 29573c5 mix_box.ak:52-70) | Kernel theorem every_context_iff (axiom-guarded). Blaster cross-checks BoxGate.lean:43/49 and BoxSuffix.lean:52. Controls BoxControls.lean:114-124 and BoxAllControls.lean:150-153 |
| `seedelf-verification/Lovejoin/AnyTx/BoxAll.lean:36` | Spending a box whose own reference isn't among the inputs (the own-input lookup fails closed) | missing_input_errors (kernel); BoxBoundary.lean:107 (Blaster); BoxControls.lean:123 |
| `seedelf-verification/Lovejoin/AnyTx/PurposesKernel.lean:135` | The pool's NFT and ReferenceDatum leaving reference_holder (288fea77, the same bytes for classic and v2) | reference_holder_every_context_errors (kernel, guarded); Template/AnyTxPurposes.lean:150; classic ReferenceHolder.lean:96; lovejoin_proven_bytes_test includes the hex |
| `seedelf-verification/Lovejoin/AnyTx/LogicPublishKernel.lean:61` | Unregistering, or any other certificate on, mix_logic's stake credential, which would freeze every box behind the withdraw-zero gate | publish_iff_registration (kernel, guarded); Template/AnyTxPurposes.lean:86 and its #guard at :177 |
| `seedelf-verification/Lovejoin/AnyTx/OwnerTwo.lean:100` | A well-formed box leaving an Owner withdrawal without its own Schnorr proof, bound to all outputs, all input references and M; and fewer proofs than boxes (:116) | OwnerOne.lean:48, OwnerTwo.lean:100-118, Owner3.lean:48-87, Owner4; V2 OwnAny*Boxes; controls OwnerControls.lean:97-110, OwnerMoreControls.lean:46-70, OwnerManyControls.lean:91-125 |
| `seedelf-verification/Lovejoin/AnyTx/MixTwo.lean:77` | A Mix moving a box without its sigma-OR proof: each box's challenge xor and every branch against every box out | MixTwo.lean:77-105, MixAda3/4, MixToken3/4 (generated, regenerated identical); V2 Mix*/MixAny*/MixTok* Box modules (126 pairings checked); controls MixTwoControls.lean:21-28, MixAda3Controls.lean:50-52 |
| `seedelf-verification/Lovejoin/AnyTx/MixOutputs.lean:78` | A Mix paying value out of the pool: a box out holding other than the exact box value, not at mix_box, with a stake part or reference script, with no or a hashed datum, or an extra stake-less box after the n | MixOutputs.lean:78-109, MixTokenOutputs.lean:30, MixAda3/4- and MixToken3/4Output wrong_value; V2 MixOutputs.lean:51-67, MixDatums.lean:33-44, MixAny*Outputs/Datums. Controls are endsInError only (v4b#1). A tail output at M with a stake part passes (audit tail-check-overstated) |
| `seedelf-verification/Lovejoin/V2/MixChallenges.lean:27` | A branch challenge other than 32 bytes, which xor_bytearray(False) would truncate (v2's xor32 fix) | mix_refuses_a_challenge_not_32_bytes (KAT layout only); Audit StepsGuards accepted point appliedChallenges.exec |
| `seedelf-verification/Lovejoin/AnyTx/LogicLedgerUniqueness.lean:181` | mix_logic trusting a forged ReferenceDatum: success needs exactly one reference input holding (P, lovejoin) at quantity 1, with an inline datum (LogicLedgerInline) | owner/mix_requires_unique_nft_reference (kernel, guarded); Reference.lean:64-83 (Blaster); ReferenceControls.lean, LogicWrongQuantityControls.lean:44-50 |
| `seedelf-verification/Lovejoin/AnyTx/LogicEmpty.lean:52` | A Mix of one box (no anonymity set) | mix_needs_two_boxes (one box, empty proofs only); kernel coverage in Every/ |
| `seedelf-verification/Lovejoin/AnyTx/Launch.lean:57` | A second pool NFT, or one minted without spending the seed, to the wrong place, under another name or quantity, or with an insane datum | needs_seed, wrong_name_or_quantity, second_name, wrong_destination, invalid_reference_datum; passing control only for launchSeedAny (LaunchControls.lean:94) |

## Checked and holds

- isUnsuccessful at the pin (PlutusCore 68c5399, Utils.lean:41) is isErrorState, Error only. cekExecuteProgram runs runStepsPreservingState (CekMachine.lean:256-262), so a run cut off at the limit is Eval/Return (isExhausted), not Error. #prep_uplc's .exec is cekExecuteProgram (PreProcess.lean:146) and .prop is its optimized form. PCB #78's change is chunk 46's.
- No theorem in the lane states failure as ¬ isSuccessful. Every failure is isUnsuccessful. AnyTx's successes are returnsUnit (Halt unit), so a too-small step limit gives Falsified, never a vacuous Valid.
- Bounded iffs all have Error-within-limit companions, or a kernel theorem supersedes them: MixBoxGate (:72 with :77), MixLogicPurpose (:234 with :238), BoxGate (:61 with :43), BoxDatum and BoxSuffix (BoxPurposesAll), v2_mix_logic_publishes_iff (with :86). The classic and V2 owner_withdraws_iff_proof are the audit's closed iff-failure-side-only-no-halt.
- The lane has no sorry, axiom, native_decide, implemented_by or unsafe (grep over Lovejoin/*.lean, V2, AnyTx). BoxPurposesAll.every_context_iff, PurposesKernel.reference_holder_every_context_errors and LogicPublishKernel.publish_iff_registration each carry #guard_msgs axiom checks for propext, Classical.choice and Quot.sound.
- #import_uplc names its constant from the raw identifier, ignoring the namespace (ScriptEncoding/Basic.lean:153-163). So PurposesKernel's referenceHolder is Lovejoin/Scripts/reference_holder.hex, hash-pinned at 288fea77, which extract-lovejoin-v2.sh also pins as v2's. lovejoin_proven_bytes_test include_str!s the same hex.
- every_context_iff says what CLAIMS.md and README.md:101 say. It finds the first input whose encoded reference matches. A missing match errors. No datum or a hash datum passes. An inline datum passes iff it isn't a well-formed box or a Script(L) withdrawal with any amount is present. The five other purposes error. It has no hypotheses and holds for any L.
- PurposesKernel's typed theorem covers all six ScriptInfo constructors by definitional encoding through purposeCtx. Its mix_logic, one_shot_mint and fee_contract non-handler theorems match AnyTx README:37-39.
- publish_iff_registration: a cert passes iff its constructor is 0 (V3 TxCertRegStaking). Unregistration, delegation and reg+deleg (constructor 3) error, for any raw cert data.
- toTerm applies template parameters as Data constants (CardanoLedgerApi IsData/Class.lean:56), the way aiken blueprint apply does: P and lovejoin for mix_logic, L for mix_box, seed, index and rh for one_shot_mint.
- I regenerated into scratch every generated instance whose generator writes without reading outside the tree: 19 AnyTx files (mixes, mix-outputs, owners, box-shapes) and 59 V2/classic files (gen-lovejoin-owner.py, gen-lovejoin-mix-outputs.py). All are byte-identical to the tree.
- In all V2 Mix families (Mix, Mix3, MixAny, MixAny3/4, MixTok2/3/4), every challenge theorem uses box i's points and branches, and every branch theorem pairs box in i with box out j (126 theorems checked by script). Each family has n(n+1) theorems plus Passes, so none is missing.
- Generated AnyTx n=4 Output builders select all four positions with two Booleans, and their controls hit all four (MixAda4Output.lean:24-27, MixAda4OutputControls).
- Passes and valid theorems' spec hypotheses are satisfiable. The honest .exec controls return unit at the KAT, and the per-check failure theorems would force Error there if the spec were false. Classic and V2 have the same pairing, through printed Steps runs (the audit's known steps-runs-printed).
- Classic MixBoxNoLock's 19 shapes plus MixBoxGate's Constr 0 [B, B] cover every Data datum, constructor by constructor.
- AnyTx's encoders match the V3 encodings: TxInfo's 16 fields in order, TxInInfo, TxOut, Address, Option, Rewarding = Constr 2, Spending = Constr 1, Owner = Constr 0, Mix = Constr 1 (Common.lean:38-100).
- The AnyTx README's New-scenario and Expanded-family table rows match their modules (theorem sets, layouts, hypotheses), except line 244's Controls sentence (v4b#1).
- LogicLedgerUniqueness and LogicLedgerInline need only validReferenceInputs, and LogicLedgerCarrier's validScriptContext variants are described as 'fully valid V3 contexts', both as the README says. LogicLength, LogicInputRefs and BoxSearch's loops are path-subterms of the imported script, not copies.
- check.sh's lovejoin, lovejoin-v2 and lovejoin-any-tx families build every lane module except LogicOwnerParserReach and LogicOwnerPrefix (known: review-1.8.1, Left as they are).

## Notes

- The audit closed steps-runs-printed-not-guarded with Audit.Checks.StepsGuards plus suite Guards and Concrete modules, but that closure is a sample. StepsGuards covers V2.Steps (the n=2 KAT and the test-launch modules). The suites cover MixAny, MixAny4, MixAnyOut, MixTok2, OwnAny1, OwnAny4, and classic Own1, Own3, Owner and Gate. Mix3 (n=3 KAT), MixAny3, MixTok3, MixTok4, MixAny3Out, MixAny4Out, MixTok2/3/4Out, OwnAny2, OwnAny3 and OwnClassic2 have only #eval prints, in the standard run and the audit alike. For the failure-only Out families those prints (and reading) are the only non-vacuity evidence. This is a new fact on a settled item.
- statements-over-optimizer-output was closed by the suites' *Exec modules, which don't cover AnyTx's Blaster families. Where a family has a returnsUnit Passes theorem (MixTwo, MixAda3/4, OwnerOne and the rest), a gross .prop/.exec divergence would still show as Falsified against the guarded honest exec run. The failure-only AnyTx families (Output, Reference failures, Launch failures, LogicEmpty) have no such check.
- names-broader-than-statements, a new instance: LogicEmpty.lean:51's docstring says 'Mix rejects a transaction containing at most one well-formed input box', but the theorem fixes one box (any bytes), an empty proof list and one carrier. The README row (AnyTx/README.md:232) is accurate.
- Audit wording items still present, all settled: V2/MixDatums.lean:5-6, V2/MixAnyDatums.lean:5-6 and the generated *Datums docs say 'So every box the pool pays out is one a key can later withdraw' (box-out-datum-shapes); V2/Owner.lean:6-7 and classic Owner.lean:4-8 say 'can't be replayed to pay someone else' (owner-non-replay-stated-as-proved); MixAnyFirst/Second docs state an unqualified 'succeeds iff' (passes-side-conditions-unstated); MixAnyOutputs.lean:58-59 says 'a box enters the pool only with a proof' (tail-check-overstated).
- V2/Scripts.lean:3-6 still says v2 is 'the local-only clone ../../lovejoin-v2 at 5cc3631'. extract-lovejoin-v2.sh now builds Lovejoin main 29573c5, pinned to the same hashes (7fb45b75, 60294352). This is the same kind as r2-docs#13 (Template/Scripts.lean), left because an edit rebuilds the family.
- Template/*.lean (about 860 lines of Blaster specs for the templates) is in no lane in LANES.md: V3 has only Template/Scripts/, and V4b's paths are classic, V2 and AnyTx. I read Template/Scripts, Launch, Steps and AnyTxPurposes, which my lane imports. MixBoxGate, MixBoxNoLock, MixBoxPurpose, OneShotMint, Fee and FeeContract are unread by me. The audit covered them on 2026-11-03.
- gen-lovejoin-mix.py couldn't be regenerated: it reads ../../lovejoin-v2/contracts/validators/mix_kat.test.ak, outside the tree. I checked its V2 outputs with the index-pairing script and the per-family counts instead.
- LogicLongControls.lean:35-36 passes six boxes with the same datum (g1, b) using one proof replicated six times. An Owner proof binds a box's points and the whole transaction, not that box's own input, so 'each box's own proof' can be one proof shared by boxes of one key. A Mix's ctx hashes no input references at all (V2/Mix.lean:14-15). Both are by design and documented; the note is only for anyone reading 'own proof' literally.
- Common.lean:136 testKey is 29 bytes, where a key hash is 28. It appears only in concrete controls, whose docs disclaim ledger validity.
- LogicWrongQuantityControls.lean:45/:48 passes with carriers at quantities 0 and 2 beside the one at 1: read_reference_datum ignores them. The trust anchor rests on one_shot_mint's supply of one, which the README says these results don't establish.

## Coverage

Read in full:
- All 25 classic top-level Lovejoin/*.lean files: Scripts, Box, Logic, Steps, Owner, ReferenceHolder, MixBox{Purpose,Gate,NoLock}, MixLogicPurpose, OwnClassic1-3 with Boxes, Passes, Spec and Steps.
- V2's hand-written files: Scripts, Logic, Steps, Owner, Mix, MixSpec, MixSplit, MixChallenges, MixFirst, MixSecond, MixPasses, MixOutputs, MixDatums, Mix3 with Spec, Steps, First, Second, Third and Passes, MixAny with Spec, First, Second, Passes and Steps, MixAny3 with Spec, Box1, Passes and Steps, MixAnyOut with Outputs, Datums and OutSteps, and MixTok2 with Spec, Passes and Steps.
- AnyTx: README.md, Common, CekCase, PurposesKernel, LogicPublishKernel, BoxPurposesAll, BoxSemantics, BoxCover, BoxInlineAll, BoxMalformed, BoxGate, BoxBoundary, BoxSuffix, BoxDatum, BoxControls, BoxAllControls, OwnerOne, OwnerControls, OwnerLayouts, OwnerTwo, Owner3, OwnerOtherInputs, OwnerIff, OwnerMoreControls, OwnerManyControls, OwnerOtherControls, Reference, ReferenceControls, MixTwo, MixTwoControls, MixIff, MixOutputs, MixOutputControls, MixTokenOutputs, MixTokenOutputControls, MixTokenControls, MixAda3Output and its controls, MixAda4OutputControls, Launch, LaunchControls, LogicEmpty, LogicControls, LogicLongControls, LogicWrongQuantityControls, LogicCarrierCoverControls, ReferenceHolderPersistence, LogicOwnerShape, LogicLength, LogicInputRefs (head).
- Template: Scripts, Launch, Steps, AnyTxPurposes.

Read partly:
- MixTokenTwo (scenario and first theorems), MixAda3 (structure and all theorem statements), MixAda4Output and MixToken4Output (builders).
- OwnAny2's family, read in full; OwnAny1, 3 and 4 and every generated V2 Out and Owner file were checked only by byte-identical regeneration.
- V2 Box files from gen-lovejoin-mix.py, checked by the pairing script.

Skimmed (statements and docstrings only, not proof bodies):
- The other ~55 Logic* kernel modules, BoxAll, BoxComplete, BoxGateAll, BoxSearch and WithdrawSearch.
- LogicLedgerUniqueness, LogicLedgerCarrier, LogicBoxComposition and LogicMixShape.
- FeeMix's theorem list.

Not read:
- Kernel proof bodies of the Logic* modules. They are kernel-checked, and I relied on the guards and statements.
- FeeSpend, FeeRecovery, FeePurpose, FeeControls and FeeMixControls (fee_contract is out of scope).
- The bodies of LaunchSeedSearch, LaunchOutputSearch and LaunchSeedSlots.
- The V2 MixAny4, MixTok3 and MixTok4 scenario files beyond their structure.
- Template's MixBoxGate, MixBoxNoLock, MixBoxPurpose, OneShotMint, Fee and FeeContract.

Built or ran no Lean. The only things I ran were the AnyTx, owner and mix-output generators, copied into scratch (python3 -I, capped), and a scratch pairing script.
