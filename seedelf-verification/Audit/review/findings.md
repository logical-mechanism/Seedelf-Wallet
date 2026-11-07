# The review's findings (2026-11-03)

Every finding from the twelve review lanes, merged, and checked by skeptics (critical and high: an evidence and an impact skeptic each; medium: one). Low and info passed through unchecked. Severity is after the skeptics. Full evidence: findings.json beside this file. None is a contract bug, and no ✅ is false: these are what the proofs and their docs leave out.

## PolicyAmount's and PolicyForeign's scenarios name the token 5eed0e1f01, not the 5eed0e1f0001 that generate gives for input 01#0, so no mint in them can pass: the mint halves of both ✅ are vacuous

`policy-mint-scenarios-misnamed` · **critical**

README:38 reads as 'a mint of two or more copies of a Seedelf name fails', the one-token-per-name uniqueness the policy exists for. For mints the ✅ supports nothing: only the burn half (-1) is tested. With PolicyMint unproved, 'Seedelf's on-chain contracts are formally verified' covers no mint condition of the policy, and the limits don't say so. The deployed bytes do enforce `1 == amt` and the pid check (the Aiken runs), so this is a gap in the proof, not an on-chain bug.

**Closed by:** Audit.Seedelf.PolicyAmount, PolicyForeign, PolicyAmountGood, PolicyForeignGood, GuardsCheap

## Blaster asserts lambda definitions and recursive-function equations unguarded over the whole SMT sort: upstream #194's false-Valid class, unfixed at the pin, plus a recursive-function site no upstream issue covers. Whether any ✅ relies on it has never been measured

`blaster-unguarded-axioms-unmeasured` · **high**

A ✅ may rest on an SMT background that contradicts itself, and then proves nothing about the script. 'What a ✅ is worth' gives no hint that this class exists at the pin, and chunk-42's 'a term the solver can't reduce … never a false Valid' holds only if the encoding is sound.

**Closed by:** Audit/diag (run-diag.sh quick, then modules, then all)

## Token pools: no ✅ says a box out must hold the pool's own token. The builders fix its policy and name, so a box out with the token withheld, swapped or renamed, or beside a token sorting before it, is outside every theorem

`token-pool-token-identity-unproved` · **high**

chunk-42:35 claims a Mix fails if a box out 'holds other than exactly the box value (its lovelace, or a token pool's token quantity), or holds any other token beside it'. For token pools the plain way to take a pool's tokens in a Mix, box outs that keep the ADA but drop or swap the token, is in no theorem: the ✅ cover a wrong quantity, wrong lovelace, or an extra token after the right one. ADA pools are fully covered, since "" sorts first. The bytes refuse every case, so the gap is in the formal claim, not in the contract.

**Closed by:** Audit.Gaps.V2.MixTok{2,3,4}Values*

## No ✅ covers a box out whose inline datum isn't Constr 0 [B _, B _]: the …Datums theorems vary only the two bytestrings, though any other shape would make the box sweepable by anyone

`box-out-datum-shapes-unproved` · **high**

'Every box paid out can be withdrawn' is the claim MixDatums is cited for. A Mix that paid a box out in a shape mix_box treats as outside the pool would hand that box to anyone, and no ✅ covers those shapes. The bytes refuse them, so the gap is in the proof.

**Closed by:** Audit.Gaps.V2.GapMixShapes*

## No ✅ says a well-formed box among the inputs can't leave without its own proof: every Mix and Owner scenario has exactly its n boxes, n proofs and n branches each

`uncounted-box-and-proof-counts-unproved` · **high**

Mixer safety rests on one property: no box leaves the pool without its own proof. Today that is proved only for transactions whose inputs are exactly the proved boxes. Anyone can build a transaction that adds one more box, and that case is outside every ✅. The bytes refuse it.

**Closed by:** Audit.Gaps.V2.GapMixIns, GapMixCount, GapMixRedeemer, GapOwn*

## No theorem varies the pool's trust anchor: read_reference_datum's policy and one-carrier checks, or one_shot_mint's 'seed spent, not merely referenced'

`trust-anchor-unpinned` · **high**

The uniqueness and lookup argument ('a pool's NFT exists once'; the policy is what makes a pool's ReferenceDatum the only one) holds by reading the source, not by proof. A lookup without the policy check, or a policy that also accepted a referenced seed, would let a forged ReferenceDatum in, for example one naming another mix_box hash; mix_box's gate (only L's withdrawal must be present) would then release every real box while mix_logic validated none. The suite can't tell those scripts from the real ones, yet readers take '276 ✅, formally verified' to cover this anchor.

**Closed by:** Audit.Gaps.Template.AuditFeeTrust, AuditOneShot; Audit.Gaps.V2.AuditOwnRef; Audit.Gaps.Classic.AuditClassicRef

## FeeContract never varies the checks that keep a shard's value in the contract (one fee input, the fee output's address, its unit datum), so 'donations can't leave except as a Mix's fee' isn't what its 5 theorems show

`fee-value-retention-unpinned` · **high**

**Out of scope** (owner, 2026-11-03): fee_contract isn't used in practice, since Seedelf and one-time accounts make it useless. Its modules stay in the tree, out of the run.

Remove any one of these checks and every FeeContract run is unchanged, so all five theorems still pass, yet each removal would be a theft: without `fee_input_count == 1`, two equal shards pay one output and a whole shard leaves as change (Replenish leaks the same way); without the address check the 'fee output' can sit at any key; without the unit-datum check the shard is paid back as a Rule 2 UTxO anyone sweeps. The source has every check; the ✅ don't show it, though the module presents its conclusion as following from them.

**Closed by:** Audit.Gaps.Template.AuditFeeOutputs

## fee_contract's Mix recognition is only half pinned: no theorem puts the Mix redeemer under another credential, or the counted boxes at another address

`fee-mix-recognition-partial` · **high**

**Out of scope** (owner, 2026-11-03): fee_contract isn't used in practice, since Seedelf and one-time accounts make it useless. Its modules stay in the tree, out of the run.

A fee_contract that took any withdrawal's Mix-shaped redeemer, or counted any non-own input as a box, passes all five; such a script would let anyone spend shards on fees, up to the cap per transaction, with no Mix at all. The real source keys on the datum's L and M; the proofs don't show it.

**Closed by:** Audit.Gaps.Template.AuditFeeKey

## v2's mix_logic outside its withdrawal (publish, spend, mint, vote, propose) has no theorem, and chunk 42 doesn't say so

`v2-mix-logic-purposes-unproved` · **high**

Nothing on v2's bytes says that an UnregisterCredential of a pool's L fails.

Every v2 box move, Owner or Mix, needs mix_box's gate to see L's withdrawal, and that needs L registered. If an unregistration were accepted, anyone could freeze every pool on the template and keep the deposit refund, and could repeat it after any re-registration.

Two claims rest on this handler without saying so: the claim at :28 that v2's contracts are verified on their bytes, and :185's 'every box paid out can be withdrawn'.

The bytes are in fact right: they are alpha-equal to the proven classic outside the withdraw handler, and Aiken agrees. So this is a missing theorem under a public claim, not a contract bug, and a Valid result is expected.

## The .hex files #import_uplc reads aren't Lake inputs: a re-extracted script rebuilds nothing, and check.sh replays the old ✅ as ok

`script-hex-not-lake-inputs` · **medium** (merged as high)

After any re-extraction (the Lovejoin PR changes the xor32 fix, a v2 launch's parameters, any contract edit), the new .hex lands and concrete/*.sh evaluates the new .flat, but every olean stays up to date and check.sh prints the old ✅ and 'ok' for bytes no longer there. Readers would take those ✅ to be about the hash-checked .hex in the repo. A clean clone is unaffected; the owner's incremental builds are.

**Open** (found again by 1.8.1's release review): the lakefile change meant to close it (input_dir + needs, at the final full re-run, since it rebuilds everything once) never landed. Until it does, after any extract run, delete the Scripts modules' builds by hand, as README's *Running it* says: `rm -f .lake/build/lib/lean/{Seedelf,Lovejoin,Lovejoin/V2,Lovejoin/Template}/Scripts.{olean,trace} Slice/.lake/build/lib/lean/Slice/Scripts.{olean,trace}`

## The concrete runs that keep the failure-only theorems from being vacuous are printed, never checked: a scenario that stopped passing would leave every ✅ on it green

`steps-runs-printed-not-guarded` · **medium** (merged as high)

If a re-pin or a builder edit made one of these scenarios fail for its own reasons, every failure theorem on it would stay ✅ and the build green; only someone reading the log would see. Rule 3, the guard against vacuous failure properties, and rule 1's limit measurements rest on eyes, while the README says the build catches a wrong spec.

**Closed by:** the suites' *Guards / *Concrete modules, Audit.Checks.StepsGuards

## Every theorem is stated over NAME.prop, Blaster's optimizer's rewrite of the CEK run, which nothing ties to NAME.exec, and the optimizer can close goals with no Z3 run; the docs call a ✅ 'Z3's word' about 'the scripts on chain'

`statements-over-optimizer-output` · **medium** (merged as high)

A reader takes a ✅ to mean a mature SMT solver checked the CEK run of the bytes. It means: Blaster's unverified optimizer (~15k lines, with weekly soundness fixes) rewrote the run into .prop, so it is trusted in each statement and not only in its proof; it simplified the goal; its encoding translated what was left; and Z3 5.3.1 found no model, when the goal reached Z3 at all. The documented 'SMT-verified, not kernel-checked' doesn't say this.

**Closed by:** the *Exec modules of each suite (Audit.Seedelf.ExecCheap, RegisterExec; Audit.V2.*Exec; Audit.Classic.*Exec)

## isSuccessful accepts any halted value, though V3 passes only on unit, and nothing checks that a module applies its script to the right number of arguments

`success-is-any-halt` · **medium**

An off-by-one in an argument function, for instance in a generator writing dozens of modules, would make every one-directional success theorem it produces (or every failure theorem, if over-applied) hold vacuously, still printing ✅, with no paired Steps run to notice. The no-lock and passes claims rest on 'halt = unit', read from the bytes.

**Closed by:** the suites' unit-result checks; Audit.Checks.ExecThroughArgs

## Open upstream soundness bugs present at the pin go unrecorded (#413, #225, #196, #195, #226, #368, #43); each was assessed unreachable for today's goals, but nothing warns a new theorem off them

`open-upstream-soundness-unlisted` · **medium**

The docs' soundness record is incomplete. A later bump, or a new theorem that is universe-polymorphic, quantifies over a function, or uses a structure with proof fields, would walk into a known false-Valid bug with nothing to warn of it.

## chunk 42's 'What the claim can say' claims more than is proved, leaves out the scope limits, and mixes property bullets into its limits list

`what-the-claim-can-say` · **medium**

This paragraph is the source of the public claim. 'Seedelf's contracts are formally verified' includes a policy whose mint conditions are unproved; 'on-chain' includes a v2 that isn't on chain; a reader can't tell limits from properties.

## Nothing ties a future v2 pool's scripts to the verified template bytes, while chunk 42 says both that the template theorems 'already hold' for the launch and that every v2 theorem is re-run on it

`v2-launch-not-tied-to-proved-templates` · **medium**

If the upstream PR lands a different xor32, or the wallet's v2 template is rebuilt from another commit or toolchain, the launched pool runs unverified bytes while docs and marketing call it verified. v2's proofs are what make it shippable, so this tie is the security claim.

## Owner withdrawals: the docs say 'every field symbolic', 'any v2 pool' and '1.8.0's returns', but every scenario fixes the transaction's shape, and the wallet's own return shape is in no theorem

`owner-scenario-shape-overclaimed` · **medium**

A reader takes ✅ to mean the transactions the wallet sends from 1.8.0, the classic pool's only remaining use, are proved with every field symbolic. The refs, box values and addresses, the reference-input list, the withdrawal list, the output count and shapes and the redeemer length are fixed; the wallet's actual shape, and any shape beyond n boxes plus a payer plus two outputs, rests on reading the compiled code and on concrete runs. The 'any v2 pool' theorems fix an ADA pool's datum.

**Closed by:** Audit.Gaps.Classic.OwnWallet1*; Audit.Gaps.V2.GapOwn*

## The Mix theorems fix one transaction shape no real Mix has (only the boxes in, one reference input, the boxes then one change out), while their docs say 'any v2 ADA pool succeeds iff' and 'every pool parameter … symbolic'

`mix-scenario-shape-overclaimed` · **medium**

'A Mix of two in any v2 ADA pool succeeds iff mixAcceptsAny' is proved for a transaction no wallet or Lovejoin builder sends. Real Mix shapes (a fee shard, a payer, reference scripts, more outputs) carry over only by reading the filters, and chunk-42's claim list, the source of the public claim, omits the bound.

**Closed by:** Audit.Gaps.V2.GapMixOther*, GapMixDatumBetween*, GapMixRefs, GapMixTail, ChkMixAnyLaunch*

## mix_box's theorems hold only with the box as the transaction's only input and one withdrawal, so the own-input lookup audit F-2 rests on is never exercised; the bound is missing from the claim list and v2's template bullet

`mix-box-gate-single-input` · **medium**

A mix_box that read the first (or last) input's datum instead of its own passes all 29 template theorems. In a real Mix or Owner withdrawal, where the box is never alone, such a script would let well-formed boxes go without mix_logic whenever another input has no datum, e.g. the payer's key input. The gate's security claim covers no real transaction until a multi-input scenario is proved; the deployed bytes behave right (Aiken).

**Closed by:** Audit.Gaps.Template.AuditGateInputs, CheckGateShapes; Audit.Gaps.Classic.Gate2*

## 'Only for a Mix of three boxes or more' overstates fee_contract: it counts inputs at mix_box's address whatever their datum, while mix_logic mixes only well-formed boxes

`fee-floor-counts-by-address` · **medium**

**Out of scope** (owner, 2026-11-03): fee_contract isn't used in practice, since Seedelf and one-time accounts make it useless. Its modules stay in the tree, out of the run.

A Mix of two well-formed boxes plus one input at mix_box with a malformed or missing datum has its fee paid by a shard. The anonymity floor fee_contract's own comment describes can be met cheaply, and self-mixing to drain shards needs two boxes rather than three. Funds per Mix stay capped either way; the theorems are true, but the wording promises more.

## Step 6's '✅ for every pool' and 'each deployed script is its template applied' read as covering the classic pool's fee_contract and one_shot_mint, which aren't verified

`classic-fee-and-mint-not-verified` · **medium**

A reader takes the classic pool's fee shards and NFT policy as verified. The NFT can't mint again (its seed is spent, a ledger fact) and the shards matter only until 1.8.0 (after which the wallet uses the classic pool only for Owner withdrawals), but neither script is proved.

**Closed by:** Audit.Gaps.Classic.ClassicMint (the NFT policy); docs for the fee contract

## The classic pool's NFT policy (f5592689) and fee_contract (a072c7e8) aren't the templates applied, and no theorem runs them; chunk 42 :164 pairs the classic seed with 'the theorem'

`classic-nft-policy-and-fee-contract-unverified` · **medium**

The classic Owner theorems (step 4 and OwnClassic*, used for 1.8.0's returns) fix the one reference input as it sits on chain. That is sound only if no second (f5592689..., lovejoin) token can exist, which rests on the classic policy requiring its spent seed. No theorem checks that on its bytes, though row 6 and :164 read as if the template theorem covers it.

The gap is narrow:
- the classic pool holds about 30 ADA, is retiring, and is outside the claim at :28;
- the classic fee_contract guards only fee shards and isn't on the Owner path.

This overlaps the lovejoin-classic and templates lanes.

## PolicyBurn's two counted ✅ have no recorded build and PolicyMint's theorems aren't in the README: both modules always fail, so the default run can't pass and a regression would look the same

`policyburn-policymint-no-trace` · **low** (merged as medium)

The README's PolicyBurn 2, and the Seedelf total of 30 (28 traced + 2), rest on someone reading console output from a failed build. If either counted theorem went Undetermined or Falsified after a re-pin, the summary would still read 'FAILED Seedelf.PolicyBurn', exactly as expected. The default run always ends with 2 FAILED, which hides any new failure in those modules and contradicts 'everything passes'.

## Every proof loads its script through PlutusCoreBlaster's flat decoder, which no conformance or independent test checks, and 5 of the 13 scripts (v2 and the templates) have no Aiken cross-check in concrete/

`flat-decoder-unchecked` · **low** (merged as medium)

A decoder slip in a constant, a builtin tag or a de Bruijn index, in a branch no concrete run reaches, would make the ✅ about a program that isn't on chain, and nothing would show it. Unlikely given the checks above, but README presents the machine model as conformance-tested without saying the path the proofs use isn't in that suite.

**Closed by:** Audit.Checks.FlatDecodeCheck, ScriptsMatchHex

## The README on this branch still describes the Seedelf-only build: no Lovejoin, the old pin, 'three changes', two opaque builtins missing, and a conformance claim the pinned model never ran

`readme-stale-on-branch` · **low** (merged as medium)

Merged as is (the plan's next step), the public README would name a pin that isn't the one built, imply the pinned model was conformance-tested, hide that serialise_data (in every Lovejoin ctx) and xor (the builtin behind v2's fix) are uninterpreted, and say nothing about what Lovejoin's proofs cover. These are documented caveats misstated where they are published.

## The core property and both one-box Owner iffs prove their security direction only as ¬ isSuccessful within the step limit, the form README rule 2 rules out; none has an isUnsuccessful companion

`iff-failure-side-only-no-halt` · **low**

'A Register UTxO moves iff …' is shown for runs that end within 2500 steps; that a failing run actually errors rests on step counts and reading. Nothing is false today, but it is the one Seedelf security claim that doesn't follow the README's own rule 2, and it is cheap to close.

**Closed by:** Audit.Seedelf.GapRegisterFails, RegisterBounds; Audit.Gaps.*.AuditOwnerFails*, OwnerErrors

## Each Mix family's iff is assembled in prose over separate #prep_uplc constants; no Lean theorem states the iff or that the constants are one term

`mix-iff-composed-in-prose` · **low**

'A Mix of n succeeds iff mixAccepts…' (chunk-42:41; every Box/First doc) is a sound argument across distinct constants, not a theorem: if two #prep_uplc runs of one program produced different terms, the build wouldn't notice. It sits on top of statements-over-optimizer-output without addressing it.

**Closed by:** Audit.Gaps.V2.AuditMixIff, AuditComposeAny

## The Mix iffs' success side holds only under P ≠ "", bl ≠ 0 (tp ≠ "", tq ≠ 0 for tokens) and every box well-formed; chunk 42 and the Box/First docs state the iff unqualified

`passes-side-conditions-unstated` · **low**

Small: the security direction (success ⇒ spec) is unconditional for every pool and field; the unqualified 'iff' says slightly more than was proved.

## 'No value leaves the pool' holds only for boxes in that hold exactly the box value: validate_mix never reads a box in's value, and the tail outputs are bound by no check or hash

`no-value-leaves-pool-overstates` · **low**

An over-funded box (a non-wallet depositor's mistake) loses its excess at its first Mix, and since the tail isn't bound, whoever submits that Mix decides where the excess goes. With exact-value boxes nothing is at stake, but the phrase reads as box-by-box conservation the theorems don't give.

## 'A box enters the pool only with a proof' and 'a later output is another box at mix_box' overstate the tail check: a mix_box output with a stake part passes it

`tail-check-overstated` · **low**

No value risk: the builder pays for that output, as for a deposit. But the wording claims an invariant the bytes don't have.

**Closed by:** Audit.Gaps.V2.GapMixTail

## mixCtxOuts_is_the_mix ties mixCtxOuts to the scenario, not to the builders the Outputs theorems actually run

`out-builders-not-tied` · **low**

'Each theorem changes one thing' rests on reading the builders. True today, but nothing would catch a future edit to boxPairs or outWith.

**Closed by:** Audit.Gaps.V2.GapOutTies

## Several theorem names and docs state a general rule where the ✅ covers one instance

`names-broader-than-statements` · **low**

Each name or doc reads as a general rule while the ✅ covers one instance. The code makes the general rule likely; the proof doesn't show it.

## mix_box docs: 'holds for any redeemer', 'whatever its witness says' and 'symbolic everywhere else' are true by reading the bytes, not by the theorems

`mix-box-redeemer-witness-wording` · **low**

A reader takes 'for any redeemer, any witness' as a theorem; it is a fact about the bytes, confirmed by reading them and on Aiken.

## one_shot_mint and fee_contract have only failure theorems: their passing run is one printed #eval each, at another datum for one_shot_mint, and some one_shot_mint checks never vary

`osm-fee-failure-only` · **low**

If the theorems' own scenario failed for an unrelated reason, every failure theorem would hold vacuously, and only a reading of saneDatum rules that out: the pattern that made PolicyAmount's mint half vacuous. The strong forms ('pays iff it loses exactly the fee within the cap', 'replenish passes iff it grows') aren't proved, and the three unvaried one_shot_mint checks guard launch integrity (the wallet's pool.rs re-checks them, but the wallet's code isn't covered).

**Closed by:** Audit.Gaps.Template.AuditPasses, AuditOneShot; Audit.Template.OneShotIff, FeeIff

## The Owner docs say a proof 'can't be replayed to pay someone else' as if proved; with the hash and serialiser opaque, the theorems also hold for a constant hash

`owner-non-replay-stated-as-proved` · **low**

The sentence would be quoted as proved; it is true under the crypto assumptions the README documents, not by the theorems.

## README's WalletRegister row says 'One input and one signer': the scenario lists no inputs, and with one signer the signer walk never passes the head

`wallet-register-scenario-row` · **low**

'One input' is wrong (no inputs are listed), and the carry-over to many inputs, many signers or any validity range is an argument from the bytes, not a proof: no theorem exercises list.has past the head. Harmless today (same cost, same verdicts).

**Closed by:** Audit.Seedelf.RegisterTwoSigners

## The README doesn't say what the core property means for degenerate registers: an identity public value is anyone's, and undecodable points lock forever

`degenerate-register-reading` · **low**

A reader may take WalletRegister plus 'No accidental locks' to mean only the owner can move a Register UTxO and nothing locks by accident. A sender's malformed Register is locked for good, and a Register with an identity public value is anyone's; both follow from the very bytes the ✅ describes.

## PolicyForeign's contexts are ones the ledger never builds, so its row has no on-chain reading; the reachable property, another policy's line beside the policy's own, is stated nowhere

`policy-foreign-context-unreachable` · **low**

README:39's property has no on-chain reading. No security claim depends on it.

## 52 of the 276 Lovejoin ✅ sit on traces older than the tree: the template mix_box, OneShotMint and FeeContract modules (39) and the n = 3 Mix (13)

`lovejoin-traces-predate-edits` · **low**

The template claims (mix_box 29, one_shot_mint 5, fee_contract 5) and the n = 3 iff, counted among the 230 that make v2 shippable, rest on builds older than the tree. The diffs are additive or cosmetic on the same pin, so a changed result is very unlikely.

## The Upstream reproductions were recorded on older pins; ByteStrings never builds, by design

`upstream-repros-stale` · **low**

These back the upstream issue and PR texts, not contract claims. A statement like 'the Fq1 point cases now pass' isn't shown on 68c5399 (Fq1Fin uses only x.t, so the private Fq1 constructor shouldn't break it).

## check.sh's 'ok' can't tell a replay from a build and never lists out-of-date modules, which is how the stale traces went unnoticed

`checksh-cannot-tell-replay` · **low**

A clean summary reads as 'everything was just proved on the current tree'; it means 'everything named either replayed a matching older log or rebuilt'.

## Any z3 on PATH is trusted: Blaster never checks its version, and neither a trace nor check.sh records which binary answered

`z3-binary-unpinned` · **low**

A ✅ is only as good as an unrecorded solver binary, and 'or later' lets results depend on whichever z3 comes first on PATH.

## Fix 1's negative control and the expected-Falsified controls in Upstream/ would pass silently if Z3 answered unknown

`expected-falsified-controls-soft` · **low**

A control that guards Fix 1 against regressions could silently stop testing anything.

## concrete/*.sh build their own contexts, some with malformed fields, and none uses Lean's serialisation of the scenarios

`concrete-contexts-not-lean-bytes` · **low**

The Seedelf cross-checks confirm verdicts on hand-built contexts whose malformed fields the scripts happen never to read; they don't test CardanoLedgerApi's encoding of the Lean scenarios. No verdict differs today.

## The ✅ counts in chunk 41 and chunk 42 disagree with each other and with the traces

`counts-inconsistent` · **low**

Small, but these numbers go public.

## No theorem says v2 fee_contract, v2 one_shot_mint or the Seedelf policy fail outside their own handler

`non-handler-purposes-fee-osm-policy` · **low**

The claim at chunk-42:28 ('Seedelf's and Lovejoin v2's [contracts] are formally verified on their compiled bytes') reads as covering every handler.

No funds or tokens depend on these handlers:
- only a policy's minting purpose authorizes a mint under it;
- nothing is locked at these scripts' addresses outside their own handler;
- no Seedelf or Lovejoin check reads tokens under fee_contract's hash, or a withdrawal or certificate of these credentials.

They belong in the claim's scope only because its wording includes them, and closing them is cheap.

## fee_contract's 'only for a Mix' rests on a ledger rule the docs don't state, and the fee scenario holds a redeemer without its withdrawal

`fee-ledger-redeemer-rule` · **info**

**Out of scope** (owner, 2026-11-03): fee_contract isn't used in practice, since Seedelf and one-time accounts make it useless. Its modules stay in the tree, out of the run.

No false ✅ (fee_contract never reads txInfoWdrl), but 'only for a Mix' means 'only when mix_logic's Mix passes' through a ledger fact the reader isn't told about.

## Blaster takes every Prop axiom declared in a proof module as a premise, and 'Writing a property' doesn't forbid declaring one

`local-axioms-become-premises` · **info**

An axiom added to a proof module would silently become a hypothesis of every theorem in that file.

## extract.sh checks Seedelf's bytes only against its own copy of the hashes, not against the reference outputs seedelf-core holds

`extract-sh-own-pins-only` · **info**

None today: variant 1 is frozen and the bytes match.

## Optional: replace the README's 'checked by reading' for WalletNoLock's 18 shapes with Lean's exhaustiveness check

`nolock-cover-lemma` · **info**

Removes one 'by reading' caveat from the claims.

**Closed by:** Audit.Seedelf.NoLockCover

## Stale explanations in the Seedelf module comments

`stale-seedelf-module-docs` · **info**

Wording only; a reader sizing a new policy property from the comment would pick a limit below the real run.

## Two of chunk 42's descriptions of the concrete runs say slightly more than the traces show

`steps-wording` · **info**

Wording only; every number quoted is right.

## Proposal: record every theorem's axioms after the re-runs, to rule out sorryAx and friends

`print-axioms-check` · **info**

Turns 'no sorry anywhere' from an inference into a recorded, kernel-level result per theorem.

**Closed by:** Audit.Checks.PrintAxioms (audit-last)

## Validator × handler table for the 13 scripts, with the theorem behind each handler

`handler-table-13-scripts` · **info**

Within the claim's scope (Seedelf and v2), the only undocumented hole that funds depend on is v2 mix_logic's publish handler. Its other purposes are in the same module.

The other NONEs are:
- handlers nothing depends on: v2 fee_contract, v2 one_shot_mint and the Seedelf policy outside their handlers;
- or the classic pool's own policy and fee_contract, outside :28 but under 1.8.0's classic Owner returns.

## No Seedelf ✅ in this tree was built on its pins: all 28 recorded Valid predate the 68c5399 repin and Wallet.lean's scalarOf change, and the run the docs cite left no artifact

`seedelf-evidence-predates-pin` · **refuted** (merged as medium)

Readers take the Seedelf ✅, WalletRegister above all, as checked on the tools this branch pins and on the current spec. The only artifacts show them on another PlutusCoreBlaster and another scalarOf. Published as is, the branch would ship a README naming one pin (c7d8741), a lakefile another (68c5399), and Seedelf evidence from a third.
