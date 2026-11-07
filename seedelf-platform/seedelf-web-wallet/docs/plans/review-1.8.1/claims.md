# 1.8.1 review · claims (what #368 says)

Reviewer `claims`. Scope: `seedelf-verification/CLAIMS.md`, `README.md` (#368's additions), `Lovejoin/AnyTx/README.md`, `check.sh` (`lovejoin-every`, the default-cap line), `Lovejoin/Every/tools/*.py`, the chunk-45 plan, chunk 42's one-line change. Read on `2a8060d3` (the release branch; #368 merged as `d190f717`).

Nothing was built (rule 5). The lead's capped build finished: 25 `ok`, no `sorry`. No repro sits in the tree. Scratch work is in `SCRATCH/review/claims/`: the import-closure and per-scope scripts, a parse-only copy of `check.sh` cut before its build loop, the decoded templates, and the blueprint applies against the live v2 pool.

**Verdict.** No theorem is misnamed, the hypotheses are real ledger rules, and "on the deployed bytes" holds for the live v2 pool: I applied the proofs' own templates to its parameters (claims#2). One medium: CLAIMS.md's trust-base line says more about the machine model than its maintainers do, and it never mentions the fork. The rest is low or nit: the build family's prerequisites, two plans that should be archived, and one test gap.

## Findings

### claims#1 · medium · CLAIMS.md's machine caveat overstates the model and omits the fork
`seedelf-verification/CLAIMS.md:23` (also `:5`, and `Lovejoin/AnyTx/README.md:104`)

- **What's wrong.** CLAIMS.md:5 says "The proofs use IOG's model of the Plutus machine". Line 23 says "**The machine is IOG's model.** PlutusCoreBlaster's CEK machine is tested against the Plutus conformance suite, not proved equal to the node's."
- **The evidence:**
  - `lakefile.lean` pins `logicalmechanism/PlutusCoreBlaster @ 68c5399` and `logicalmechanism/Lean-blaster @ 25c0ee0`.
  - Chunk 45's plan, line 238: "Our pin's library (68c5399) differs from upstream main only by #73, #27 and the xor alias."
  - PlutusCoreBlaster's README, both the pinned one and upstream `main` `6b4260a` (read on GitHub), says: "The project is working toward conformance with the Haskell reference implementation". The suite "runs separately from the normal CI", "Categories that rely on features not yet implemented can be excluded", and "A passing `lake test` does not imply that all conformance cases pass". Changes "affecting reference behavior may also need a conformance run".
  - Chunk 41, line 179, asks for exactly that run on the fork's operand-order change ("BLS conformance must still pass: run the `ci-conformance` workflow by hand"). No record says it ran.
  - README.md:90 is careful: "We run our fork of it … its three changes don't change what any script evaluates to". CLAIMS.md drops this.
  - The AnyTx README (line 104) says "`byteStringToInteger` and `xorByteString` opaque (the last two through our PlutusCoreBlaster fork's aliases)". But byteStringToInteger's alias has been upstream since #71 merged (2026-11-05, plan line 234). serialise_data's alias (#27, unmerged) is the fork's own.
- **The failure.** The one page meant to say where the claim stops makes the trust base sound better than IOG's own README does, and never mentions the fork. Anyone who opens the lakefile, IOG or an auditor, finds a fork the claim doesn't name. The theorems themselves are unaffected:
  - the fork's changes don't change evaluation;
  - the crypto is opaque;
  - the scripts use only implemented builtins.
- **The fix (wording, no test).**
  - CLAIMS.md:23 → "**The machine is IOG's model, on our fork.** PlutusCoreBlaster's CEK machine, which its README says is working toward conformance with the node (a suite it runs apart from its CI, unimplemented builtins excluded), not proved equal to it. We pin our fork (README, *Running it*): three changes upstream doesn't have yet (the BLS operands in order, an opaque serialise_data and xor), none changing what a script evaluates to."
  - CLAIMS.md:5 → "IOG's model of the Plutus machine (our fork of it)".
  - AnyTx README:104 → "(serialise_data and xorByteString through our fork's aliases)".

### claims#2 · low · Nothing in seedelf-verification ties the proven templates to the live v2 pool
`seedelf-verification/extract-lovejoin-v2.sh:11` (#368's claim, with the release prep's pool)

- **What's wrong.** CLAIMS.md:3 claims "on the deployed bytes" for the Lovejoin v2 contracts too. `extract-lovejoin-v2.sh` checks each template against a deployed script, but:
  - one_shot_mint and fee_contract only at "the mainnet 5 ₳ pool's seed" (`dc6abe3b…`, `20aae476…`). That is `lovejoin-pools.json`'s `mainnet.pools[0]`, the retired 8131b1d pool.
  - mix_logic, the one template v2 changed, only at Lovejoin's test launch (`abab…` → `60294352…`).
- **The evidence (repro, in scratch).** The live pool is `fcb3f5ec…` (`pools[1]`, `version: v2`, block 14167059, added by `2a8060d3`). Its datum names mix_box `dd94113c…` and mix_logic `a6a85074…`; its reference scripts are those two (629 and 3,487 bytes). I ran `aiken blueprint apply` v1.1.24 over a minimal blueprint wrapping the proofs' own `Lovejoin/Template/Scripts/*.hex`:
  - mix_logic at `581cfcb3f5ec…`, then `486c6f76656a6f696e` (lovejoin) → `a6a85074e56cf486a1c6620181902cf4726a7f5bb11878ae23eb99f5`, matching.
  - mix_box at `581ca6a85074…` → `dd94113cc07cbe0f0c331c9ba10477795ca90bfb1e3e348b40d15a31`, matching.
  - one_shot_mint at `5820 6db8a313…`, `03`, `581c288fea77…` → `fcb3f5ec5f58d8fc31cf60408b77a1fe4f431880dc810bd12e8a9aa2`, matching.
  - Decoded, the applied mix_logic is exactly `[[template (con data (B #fcb3…))] (con data (B #6c6f76656a6f696e))]`. That is the term `mix_logic_accepts_iff` runs (`applyParams` over `toTerm P`, `toTerm nftName`).
- **The failure.** None today: the claim holds. But its only standing tie is the wallet's runtime derive. If a template file or the pin drifted, seedelf-verification would still pass while the proven bytes stopped being the live pool's.
- **The fix.** Add the three applies above to `extract-lovejoin-v2.sh`, with their expected hashes as constants, and call `dc6abe3b…` the retired pool. The script exits 1 on a mismatch, so the check is its own test. CLAIMS.md:19 can then say the live mainnet pool's scripts are these templates applied.

### claims#3 · low · README's "standard suites" command never builds CLAIMS.md's two Lovejoin headline theorems
`seedelf-verification/README.md:40`

- **What's wrong.** "To check the standard Lovejoin and Seedelf proof suites": `./check.sh lovejoin && ./check.sh lovejoin-v2 && ./check.sh lovejoin-any-tx && ./check.sh seedelf-slice && ./check.sh`.
- **The evidence.** No family but `lovejoin-every` lists a `Lovejoin.Every.*` module (`check.sh:43–153`). `Lovejoin.lean` imports 201 modules and none of the 25.
- **The failure.** Running the README's command comes back all `ok` without ever building `Lovejoin.Every.Readable`. That is CLAIMS.md's mix_logic and one_shot_mint rows.
- **The fix.** Append `&& ./check.sh lovejoin-every`. Put it last, so the other families have built its prerequisites (claims#4).

### claims#4 · low · `lovejoin-every` lists none of the 51 in-project modules its theorems import from outside `Lovejoin/Every/`
`seedelf-verification/check.sh:147`

- **The evidence.** My import-closure script finds 76 in-project modules behind `Lovejoin.Every.Readable`, 51 of them outside `Lovejoin/Every/`. On a tree without those 51, each family scope also builds the following before its own module:
  - Base: 9 (`Lovejoin.Logic`, `Lovejoin.Scripts`, `Lovejoin.Box`, `Template.Scripts`, `Template.Launch`, `AnyTx.CekCase`, `AnyTx.BoxSearch`, `Seedelf.LinesAllCek`, `Seedelf.Scenario`).
  - Withdraw: 3 (`Template.AnyTxPurposes`, which makes 17 `blaster` calls, plus `Seedelf.AnyTx` and `Seedelf.Scripts`).
  - Typed: 2 (`LogicPublishKernel`, `PurposesKernel`).
  - Readable: 37 (the AnyTx `Logic*` and `Box*` modules, plus `Seedelf.Wallet`, `Policy`, `Steps`, `AnyTxSteps`, `AnyTxCover`).
  - The lead's log agrees: job counts jump +4 at Withdraw, +3 at Typed and +39 at Readable. Those were replays there, because the lead's tree already had the 51 built.
  - The plan's "about 11 minutes" run was "from an empty build" (line 9), yet line 11 says "`.lake` was copied from the main checkout, so nothing rebuilds the dependencies". Line 12 warns that "one scope building several modules in parallel passes 16 GB".
- **The failure.** Run alone, as the AnyTx README says, on a fresh clone:
  - Readable's single 16 GB scope builds 37 modules in parallel, and could be killed by the very effect line 12 warns about.
  - Withdraw's scope runs Blaster, in a family described as having none.
  - The summary books the 51 modules' time and peak under Every modules' names.
  - The 11 minutes doesn't hold.
- **The fix.** Prepend the 51 to `every`, in import order. My per-scope script confirms that order: 76 scopes, each building only its own module.
  - `Seedelf.LinesAllCek Lovejoin.AnyTx.CekCase Lovejoin.Template.Scripts Lovejoin.AnyTx.BoxSearch Lovejoin.Scripts Seedelf.Scenario Lovejoin.Box Lovejoin.Logic Lovejoin.Template.Launch Seedelf.Scripts Seedelf.AnyTx Lovejoin.Template.AnyTxPurposes Lovejoin.AnyTx.PurposesKernel Lovejoin.AnyTx.LogicPublishKernel Lovejoin.AnyTx.LogicLength Seedelf.Wallet Seedelf.Policy Seedelf.Steps Seedelf.AnyTxSteps Lovejoin.AnyTx.Common Lovejoin.AnyTx.BoxAll Lovejoin.AnyTx.WithdrawSearch Lovejoin.AnyTx.BoxGateAll Lovejoin.AnyTx.BoxMalformed Lovejoin.AnyTx.BoxMalformedShapes Lovejoin.AnyTx.BoxInlineAll Lovejoin.AnyTx.BoxComplete Seedelf.AnyTxCover Lovejoin.AnyTx.BoxCover Lovejoin.AnyTx.LogicInputRefs Lovejoin.AnyTx.LogicReferenceFilter Lovejoin.AnyTx.LogicPolicyLookup Lovejoin.AnyTx.LogicNameLookup Lovejoin.AnyTx.LogicCarrierPredicate Lovejoin.AnyTx.LogicCarrierFilterExact Lovejoin.AnyTx.LogicCarrierVariable Lovejoin.AnyTx.LogicAbsentName Lovejoin.AnyTx.LogicAbsentNameAfter Lovejoin.AnyTx.LogicAbsentPolicy Lovejoin.AnyTx.LogicAbsentPolicyAfter Lovejoin.AnyTx.LogicCarrierCover Lovejoin.AnyTx.LogicOwnerParse Lovejoin.AnyTx.LogicMixParse Lovejoin.AnyTx.LogicProofBoundary Lovejoin.AnyTx.LogicOwnerMalformed Lovejoin.AnyTx.LogicNoReference Lovejoin.AnyTx.LogicNoReferenceMany Lovejoin.AnyTx.LogicOwnerNoCarrier Lovejoin.AnyTx.LogicCarrierCoverSafety Lovejoin.AnyTx.LogicLedgerValueCover Lovejoin.AnyTx.LogicLedgerCarrier`
  - Or have the AnyTx README name the families to run first.

### claims#5 · low · Every modules named on their own get the 8 GB/10 min default; 6 of the 25 are killed
`seedelf-verification/check.sh:25`

- **What's wrong.** `[ "${1:-}" = lovejoin-every ] && { CAP=${CAP:-16G}; LIMIT=${LIMIT:-30m}; }` raises the defaults only for the family keyword. But naming modules is documented usage (line 21, and README:15).
- **The evidence.** A parse-only copy of `check.sh` (cut before the build loop) gives:
  - `lovejoin-every` → `CAP=16G LIMIT=30m n=25`;
  - `Lovejoin.Every.Collect` → `CAP=8G LIMIT=10m`.
  - Six peaks in the lead's log exceed 8 GiB: Carrier 8,459, Collect 12,782, Walk 8,563, Withdraw 8,379, MintCheck 8,386 and MintRoot 8,307 MB.
  - The plan's line 12 names "Carrier, Collect, Walk, MixPred 6.7 GB" as killed. MixPred isn't, and Withdraw, MintCheck and MintRoot are missing. README:34 still says the cap is 8 GB.
- **The failure.** Rebuilding one edited module the documented way (`./check.sh Lovejoin.Every.Collect`) ends in `KILLED … (over 8G…)`.
- **The fix (tested in the parse-only copy).**
  - Line 25 → `for a in "$@"; do case $a in lovejoin-every|Lovejoin.Every.*) CAP=${CAP:-16G}; LIMIT=${LIMIT:-30m} ;; esac; done`. Every modules named singly then get 16G/30m; `Seedelf.PolicyMint` keeps 8G/10m; `CAP=12G` still wins.
  - README:34 → "8 GB; `lovejoin-every` and its modules 16 GB".

### claims#6 · low · Chunk 45's plan stays in docs/plans/, still saying nothing is committed
`seedelf-platform/seedelf-web-wallet/docs/plans/chunk-45-lovejoin-every-tx.md:8`

- **What the rules say.** `docs/plans/README.md`:
  - :3 "if a file is here, it's live";
  - :21 "What still holds moves into the design docs for its area";
  - :23 "The plan moves to ../archive/plans/, ending with a record of what its PR did … none stays here once it's done".
- **The evidence.**
  - The plan's line 3 says "**Done**".
  - Line 8 says "**Nothing is committed or pushed.** … Ask the owner before committing."
  - Line 229 says "Then ask the owner about committing, the PR, and where the claim goes".
  - #368 is merged (`d190f717`, on `origin/main`), and no section names it.
  - Chunk 43's PR archived its own plan (`85811605`) and named #367 in a "What its PR did" section (`12e4f6d6`).
  - The proof method, its pitfalls and the only documentation of `tools/*.py` are this plan's lines 33–71: nothing in seedelf-verification mentions the tools.
  - Its dates (Done, the owner's call) are 2026-11-07, which is UTC. The commits were made 2026-11-06 20:47 −0800, and the file's other dates for the owner are local.
- **The failure.** A later session reads a live plan telling it to ask before committing work that is already on main. That is the failure mode the README names. And archiving the file as it stands would leave the tools documented only in the archive.
- **The fix.**
  - Move "The method", "Pitfalls" and "The tools" into seedelf-verification (say `Lovejoin/Every/README.md`, linked from the AnyTx README).
  - Move the "Upstream" items to chunk 41's plan.
  - `git mv` the plan to `docs/archive/plans/`, ending with "What its PR did: #368 (`d190f717`)", the stale "Where things are" lines rewritten, and the dates as the owner's.

### claims#7 · low · Chunk 42's plan contradicts CLAIMS.md after #368, and the README sends readers there for the limits
`seedelf-platform/seedelf-web-wallet/docs/plans/chunk-42-lovejoin-verification.md:18`

- **The evidence.**
  - Row 10, the line #368 edited, still opens "In part." even though it lists everything as done (README.md:139 says "Every script in scope is characterized").
  - Row 9 says "⬜ waits on step 8 and a v2 launch". 1.8.0 shipped it (`releases.md:40`, #363).
  - Next steps 2–4 (lines 23–25) are done.
  - Line 43: "**Not lifted: the Mix, Owner withdrawals and mix_box's spend.** … they're the owner's".
  - Lines 47–50: "What the claim can say … Up to 4 boxes … only in their scenarios' layouts".
  - README.md:7: "[Chunk 42] says what they cover and what they leave out."
- **The failure.** Someone who follows README:7 for the limits reads "up to 4 boxes" and "only in their scenarios' layouts", contradicting CLAIMS.md one link away. A session reads steps 9 and 10 as open work.
- **The fix.**
  - Mark rows 9 and 10 ✅ (1.8.0 with chunk 44; chunk 45).
  - Replace "Not lifted" and "What the claim can say" with a pointer to CLAIMS.md.
  - Archive the plan with its record.
  - README:7 → "CLAIMS.md and Lovejoin/AnyTx/README.md say what they cover and leave out; chunk 42 is the record".

### claims#8 · low · README's *Next* says every script is characterized "in the Aiken source's terms"
`seedelf-verification/README.md:139`

- **The evidence.** README:68 and CLAIMS.md:19 limit the source's terms to mix_logic and one_shot_mint. mix_box's `contextPasses` (`BoxPurposesAll.lean:53–61`) is stated over raw `Data`: `inputPairs … = before ++ (IsData.toData ref, .Constr 0 [addr, value, IsData.toData datum, script]) :: after`, with `isBoxDatum d = false`.
- **The failure.** An outside reader asked to "read the readable statements against the source" finds mix_box's in raw `Data`.
- **The fix.** "Every script in scope is characterized in every transaction; mix_logic's and one_shot_mint's in the Aiken source's terms".

### claims#9 · nit · The axiom guards sit on the `_valid` forms, not on the iffs CLAIMS.md cites
`seedelf-verification/Lovejoin/Every/Readable.lean:303`

- **The evidence.** Lines 303–309 guard `mix_logic_accepts_iff_valid` and `one_shot_mint_accepts_iff_valid`. The cited base iffs are covered only because the `_valid` proofs call them (lines 244 and 298).
- **The failure.** If the `_valid` forms are ever proved another way, the cited theorems lose their guard and the build stays green.
- **The fix.** Add `#guard_msgs in #print axioms` for `mix_logic_accepts_iff` and `one_shot_mint_accepts_iff`, expecting `[propext, Classical.choice, Quot.sound]`.

### claims#10 · nit · The hypotheses are summarized more narrowly than they are
`seedelf-verification/CLAIMS.md:25`

- **The evidence.**
  - CLAIMS.md:25: "Sorted values and maps, a well-formed mint, an input in every transaction. Nothing else about the transaction is assumed." But `validTxOutValue` (CardanoLedgerApi `V1/Contexts.lean:808`) also requires the ADA entry first, alone and positive, every quantity positive, and no empty policy.
  - README:68 says "Each is an iff over every typed V3 context". Two of the four take the value rules as hypotheses, and reference_holder's result is an error in every context, not an iff.
  - All of these are guarantees the ledger gives, so the claims hold.
- **The fix.**
  - CLAIMS.md:25 → "values and the mint as the ledger forms them (ADA first, sorted, positive)".
  - README:68 → "each over every typed V3 context, under the ledger's value rules where stated".

### claims#11 · nit · The tools' path parsers break on `(n)` path components
`seedelf-verification/Lovejoin/Every/tools/fillpaths.py:15`

- **The evidence.**
  - `pseudo.py` prints `(n)` for n ≥ 10 (its docstring).
  - `fillpaths.py:15`'s `@([0-9]+)` stops at the first `(`.
  - `pp.py:11` and `lpath.py:4` split `(12)` into separate characters.
  - Neither template has such a path today: none in mix_logic's 1,129 pseudo lines or one_shot_mint's 346. Lean refuses a wrong path, so the bug fails safe.
- **The fix.** Parse paths with `\(\d+\)|\d`, as `scope.py`'s `P` does.

## Checked, and it held

- **Every cited name exists.** Grepped in the sources:
  - `BoxPurposesAll.every_context_iff`, `PurposesKernel.reference_holder_every_context_errors`, `Readable.mix_logic_accepts_iff`, `Readable.one_shot_mint_accepts_iff`;
  - `every_context_iff` (`Typed.lean:63`), `mint_every_context_iff`, `publish_iff_registration`, `walkOutputs_eq`;
  - `withdrawResult`, `launchResult`, `branchHolds`, `launchOk`, `datumSane`, `validateOwner`, `validateMix`, `verifyPre`, `walkOutputs`, `readReferenceDatum`, `collectWellFormedMixInputs`, `outputAtScript`, `outputAtReferenceHolder`, `RefDatum.boxValue`;
  - `length_all`, `ledger_refs`;
  - the Seedelf modules: `AlwaysFalseAnyTx`, the six `Wallet*AnyTx`, `Signers/`, `AnyTxShapes`, `PolicyPurposeAnyTx`, `PolicyRedeemerAnyTx`, `PolicyLinesAll`, `LinesAllAnyMint`, `Slice.Rule`, `PolicyShapes`.
  - `token_sane` is the Aiken name; `datumSane` is the Lean definition that carries it.
- **The statements say what CLAIMS.md and the READMEs say.**
  - mix_logic: at any P, with the name `lovejoin`; withdraw by `withdrawOk`, publish only `TxCertRegStaking`, every other purpose `False`; one hypothesis, the reference inputs' values.
  - one_shot_mint: at any seed and holder; `launchOk`; the mint and output values as hypotheses.
  - mix_box: no hypothesis, at any L.
  - reference_holder: an error in every context.
  - `validateMix` and `walkOutputs_eq` read as the AnyTx README paraphrases them.
  - `datumSane` equals `one_shot_mint.ak`'s `datum_sane` and `token_sane`, the 2^64 − 1 bound included.
- **Kernel-checked.** Guards in Readable, Typed, MintTyped, BoxPurposesAll and PurposesKernel expect `[propext, Classical.choice, Quot.sound]`. The lead's log: 25 `ok`, no `sorry`, no warnings from `Readable*`. Blaster appears only in imported modules (Template.AnyTxPurposes, Seedelf.AnyTxCover) that the guarded theorems don't depend on.
- **The model.**
  - `cekExecuteProgram` runs `runStepsPreservingState`, so running out of fuel is never an `Error`, and it uses the default `defaultFunSemanticsVariantE` (V3 after Conway).
  - The BLS12-381 builtins, the hashes, `encodeDataOpaque`, `xorByteStringOpaque` and `byteStringToIntegerOpaque` are all `opaque`.
- **The hypotheses are real and satisfiable.** V1's `validTxOutValue` (ADA first and positive, sorted, positive quantities) and V3's `validMintValue` (no ADA, sorted, non-zero) hold for every real V3 context, so neither theorem is vacuous. The Seedelf policy's cover takes only an input and a valid mint; the wallet's takes none.
- **The `_valid` caveat** is stated in the AnyTx README, in Readable.lean and in the plan. CLAIMS.md and the README cite the base iffs.
- **On the deployed bytes.**
  - Seedelf's tracked hex files hash to `94bca9c0…`, `84967d91…` and `6777ba4d…`, which are core's constants.
  - Lovejoin's template hex files hash to core's V2 pins (`7fb45b75…`, `2365a62d…`, `6878ed6f…`, `3698bbfd…`), and reference_holder to `288fea77…`.
  - The live v2 pool's three scripts are those templates applied (claims#2).
- **check.sh.**
  - The family's 25 entries are exactly `Lovejoin/Every/`'s 25 files, each listed after the Every modules it imports.
  - A caller's `CAP` or `LIMIT` is respected, and an empty `CAP=` falls back to 16G.
  - Arguments after `lovejoin-every` are dropped, as with every other family.
- **The numbers.** The lead's run: Collect peaks at 12,782 MB ("near 13 GB"); Carrier, Walk, MixPred and MintCheck match the plan; 25 modules, 20 CEK and 5 readable. The whole run took about 820 s (13.7 min), against "about 11 minutes", on a machine shared with the review's other jobs.
- **The tools.** They run as the plan documents: `pseudo.py` reproduces the plan's path `B` for `i_30`, and `scope.py`, `pp.py`, `lpath` and `fillpaths.py` work. None hardcodes a path, and each adds its own folder to the import path, so `-I` works.
- **The docs claim nothing outside seedelf-verification.**
  - #367's doc changes don't mention verification.
  - The web wallet README's line 59 ("the bytes seedelf-verification proves") is from before 1.8.1.
  - SECURITY.md, the root README and the store listing say nothing about it.
  - `lovejoin.warn.unaudited` is still true.
- **`Lovejoin.lean`** imports none of the Every modules. That's harmless: no tool reads it, and bare builds are banned.
