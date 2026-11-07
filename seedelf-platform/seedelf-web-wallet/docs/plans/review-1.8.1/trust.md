# 1.8.1 review · trust: what #368's proofs rest on

Reviewer `trust`, on `web-wallet/release-1.8.1` at `2a8060d3`. Scope: `seedelf-verification/Lovejoin/Every/` (all 25 `.lean` files and `tools/`), what they import, the bytes they read, the model they run on, and CLAIMS.md's limits.

**Summary.** The proofs are sound as far as the kernel goes. The 25 modules use no `sorry`, axiom, `native_decide`, `unsafe`, `partial`, `opaque`, `implemented_by`, `extern` or kernel bypass. The axiom guards ran in the lead's capped build, which built all 25 modules fresh, and they passed. Every loop is proved by list induction, with no step or length bound. The Lean hex files are byte for byte the bytes core pins as `Set::V2`. Applied as the Lean theorems apply them, they give mainnet's live v2 5 ₳ pool's on-chain hashes, checked with IOG's own `uplc` and one Koios read.

There are four findings, none high or medium:
- two test or record gaps in what ties the proved bytes to the bytes that run (trust#1, trust#2);
- a guard that covers the cited theorems only indirectly (trust#3, nit);
- CLAIMS.md's limits leave out three unproved links that the bytes claim rests on (trust#4).

## Findings

### trust#1 · low · cross · nothing ties the Lean hex the Every theorems read to core's `Set::V2` bytes

- **File:** `seedelf-platform/seedelf-core/src/lovejoin/templates.rs:334` (and `:25`). The test that should hold it is `seedelf-core/tests/lovejoin_pools_test.rs:272` (`v2_templates_are_frozen`).
- **What's wrong.** The rule is written in three places: templates.rs (":334 … byte for byte the `Lovejoin/Template/Scripts/mix_logic.hex` that `seedelf-verification` proves", ":25 Its bytes are the ones `seedelf-verification` proves") and seedelf-platform/CLAUDE.md ("the bytes `seedelf-verification` proves"). No test holds it. Two copies of the bytes exist, each pinned by hash somewhere else:
  - core's `MIX_LOGIC_V2`/`ONE_SHOT_MINT`, pinned by `v2_templates_are_frozen` (CI runs it);
  - `seedelf-verification/Lovejoin/Template/Scripts/{mix_logic,one_shot_mint}.hex`, pinned only by `extract-lovejoin-v2.sh`'s `UNAPPLIED` table, at extraction time. That script needs a Lovejoin checkout at 29573c5 and Aiken v1.1.24; neither `check.sh` nor any CI job runs it, and no CI job touches seedelf-verification at all.
- **Evidence.**
  - `git grep` finds no code outside Lean that reads the Lean hex files, only doc comments.
  - By hand (`SCRATCH/review/trust/cmp_templates.py`): the Lean `mix_logic.hex` equals core's `MIX_LOGIC_V2` (3439 bytes, 7fb45b75…), and `one_shot_mint.hex` equals `ONE_SHOT_MINT` (995 bytes, 6878ed6f…). mix_box and fee_contract match too.
  - Repro `CORE/tests/zz_r181_trust_1.rs`, deleted after the run; a copy is at `SCRATCH/review/trust/zz_r181_trust_1.rs`. It `include_str!`s both Lean files and asserts `script_hash(lean) == unapplied_hashes_in(Set::V2)[1]` and `[0]`. Both tests passed.
- **Failure.** Edit either copy and nothing goes red. Ways that happens: a re-extraction at another commit, a hand edit, or a new Lovejoin version made by editing V2 instead of adding a V3 beside it. core's tests and the wallet stay green while the kernel theorems are about other bytes. CLAIMS.md's "Lovejoin's are on v2's templates, at any pool's parameters" would then quietly stop describing the bytes the wallet trusts pools by.
- **Fix (test first).** Land the repro as a real core test: the two `include_str!`s and the two hash asserts. Optionally add its second test too, which pins mainnet's v2 pool from the same derivation: P fcb3f5ec…, L a6a85074…, M dd94113c…. CI's existing `cargo test --workspace --locked` then holds the tie.
- **Note for the owner (a CI change, so out of this review's scope).** web-wallet.yml's `changes` filter skips the `rust` job for a pull request that touches only `seedelf-verification/`. A hex-only edit would therefore fail main's post-merge run (push runs check everything), not the pull request. To catch it on the pull request, add `^seedelf-verification\/Lovejoin\/Template\/Scripts\/` to `covered`.

### trust#2 · low · 368 · the `.hex` files aren't Lake inputs, and the audit records that gap as closed by a lakefile change that never landed

- **File:** `seedelf-verification/Audit/review/findings.md:91` (and `seedelf-verification/lakefile.lean:22-35`).
- **What's wrong.**
  - findings.md:85-91 lists `script-hex-not-lake-inputs` (merged as **high**) with "**Closed by:** a lakefile change (input_dir + needs), at the final full re-run: it rebuilds everything once".
  - lakefile.lean has no `input_file`, no `input_dir` and no `needs`, and `git log -S input_dir` finds the phrase only in the audit's own files.
  - `.lake/build/lib/lean/Lovejoin/Template/Scripts.trace` lists only `Scripts.lean` and its deps as inputs. The `.hex` names appear only in its replayed log.
  - So the bytes `#import_uplc` reads at elaboration are invisible to Lake.
  - The two checks that would notice a stale olean, `Audit.Checks.ScriptsMatchHex` and `FlatDecodeCheck`, run only in `audit-quick`, and they replay the same way (their own headers say so).
- **Evidence.**
  - Not stale today. `mix_logic.hex` last changed in e6b58671 (2026-11-03 09:28) and `one_shot_mint.hex` in 35039b10 (2026-11-03 01:38). Both are clean against HEAD.
  - FlatDecodeCheck and ScriptsMatchHex were built at 2026-11-03 18:28, after those changes, and FlatDecodeCheck's log shows `true` for all 13 scripts.
  - The Template/Scripts olean was built at 2026-11-04 19:52.
  - The lead's run built all 25 Every modules fresh on top of it.
  - The `.hex` mtimes (2026-11-05 16:15) are newer than that olean only because of a checkout; their content is unchanged.
- **Failure.** If a `.hex` changes, `./check.sh lovejoin-every` on an existing `.lake` keeps the old `Lovejoin.Template.Scripts` olean and prints 25 `ok` for bytes no longer in the tree. This is exactly how chunk 45 was built ("`.lake` was copied from the main checkout, so nothing rebuilds the dependencies"). A fresh clone is unaffected. Meanwhile the audit tells readers the gap is closed.
- **Fix.** The smallest one, for 1.8.1:
  - mark the finding open in findings.md (and findings.json), with the manual step: after any extract run, `rm .lake/build/lib/lean/{Seedelf,Lovejoin,Lovejoin/V2,Lovejoin/Template}/Scripts.{olean,trace}`;
  - put that step in README's *Running it*.

  The real fix is the audit's own: one `input_file` per `.hex` (or an `input_dir` per Scripts folder) and `needs := #[…]` on `«Seedelf»` and `«Lovejoin»`. It changes every trace once, so everything rebuilds; save it for the next full run.

### trust#3 · nit · 368 · the theorems CLAIMS.md cites have no axiom guard of their own

- **File:** `seedelf-verification/Lovejoin/Every/Readable.lean:303-309`.
- **What's wrong.** The guards (`#guard_msgs in #print axioms`) cover these:
  - `mix_logic_accepts_iff_valid` and `one_shot_mint_accepts_iff_valid` (Readable);
  - `every_context_iff` (Typed, and again in MintTyped);
  - `mint_every_context_iff` (MintTyped);
  - `policy_search`, `name_search` (Lookup) and `reference_datum` (Carrier).

  CLAIMS.md and both READMEs cite `Readable.mix_logic_accepts_iff` and `one_shot_mint_accepts_iff` ("Lean's own axioms alone"), and those two aren't guarded by name.
- **Evidence.** Today they're covered, but only indirectly. Each `_valid` is proved by applying its base iff (Readable.lean:244, :298), so `#print axioms` of `_valid` already includes the base's axioms. The lead's log shows Readable built fresh (`✔ [638/638] Built Lovejoin.Every.Readable`) with no error.
- **Failure.** A later re-proof of a `_valid` form that doesn't go through its base iff (say, through `every_context_iff` directly) would silently stop guarding the theorems the claim names.
- **Fix.** Two more guards in Readable.lean: `#guard_msgs in #print axioms Lovejoin.Every.Readable.mix_logic_accepts_iff`, and the same for `one_shot_mint_accepts_iff`, each expecting `[propext, Classical.choice, Quot.sound]`.

### trust#4 · low · 368 · CLAIMS.md's *Where it stops* leaves out three unproved links that "on its compiled bytes" rests on

- **File:** `seedelf-verification/CLAIMS.md:21-23`.
- **What's wrong.** The limits list IOG's CEK model, the opaque builtins, the ledger's rules, 128 signatories, budgets and what's out of scope. They leave out:
  - **(a) The flat decoder.** `#import_uplc` turns each `.hex` into the Lean term every theorem is about. It runs PlutusCoreBlaster's flat decoder (`FlatEncoding/Basic.lean`, `partial def decodeTerm`, meta code; `FlatEncoding/Lemmas.lean` is empty). The audit's `flat-decoder-unchecked` notes that the conformance suite never runs it. The audit closed that finding with `Audit.Checks.FlatDecodeCheck`, a one-off, run 2026-11-03, outside `check.sh lovejoin-every` and CI. The README's wording ("tested against the Plutus conformance suite") wasn't changed, and CLAIMS.md repeats it.
  - **(b) CardanoLedgerApiBlaster's encoding of the typed context.** The headline iffs are over its `ScriptContext`/`TxInfo` types. The raw CEK theorems take any `Data`, but the readable statements are only as right as those `IsData` instances.
  - **(c) The pin is our fork.** The pin is `68c5399` (`opaque-xor`), not IOG's model as published. GitHub shows 0 check runs on that commit, so the conformance run belongs to upstream. The fork's three deltas from upstream main (#73's BLS operand order, #27's opaque `serialise_data`, the xor alias) are documented as evaluation-preserving, and I agree.
- **Evidence.** All three hold today, so this is a missing caveat, not a false result.
  - (a) FlatDecodeCheck's log has 13 `true`s and 3 `false` controls. Its `.uplc` texts are byte-identical to today's `aiken uplc decode` of the two template hex files.
  - (b) I spot-checked the encodings against Plutus V3: ScriptContext, the 16 TxInfo fields in order, V3 TxOutRef as bare bytes, ScriptInfo tags 0-5, TxCert tags 0-10 and GovernanceAction's 7 constructors. All right.
  - (c) The diff from upstream 1c23de8 touches four files under `PlutusCore/`: `G1.lean`'s `ToExpr`, `Bitwise.lean`, `Crypto.lean` and `Data.lean`.
- **Failure.** A reader of CLAIMS.md is told the only unproved part is the CEK machine. It isn't: a decoder slip (a builtin tag, a de Bruijn index, a constant) or a wrong encoding would make a ✅ about a program or a context that isn't on chain. Nothing in the build re-checks either; only the one-off audit check covers the decoder.
- **Fix.** One bullet in CLAIMS.md's *Where it stops*:

  > **The bytes and the context, as read.** PlutusCoreBlaster's flat decoder reads each script's bytes (cross-checked against Aiken's decode by `Audit.Checks.FlatDecodeCheck`), and CardanoLedgerApiBlaster's encodings read the typed context. The machine is our fork of PlutusCoreBlaster (README, *Running it*), whose changes don't change what a script evaluates to.

## Checked, and it held

- **No trust escapes in Every.** Grep over the 25 modules finds no `sorry`, `admit`, `axiom`, `native_decide`, `unsafe`, `partial`, `opaque`, `implemented_by`, `extern`, `skipKernelTC`, `ofReduceBool`/`trustCompiler`, `addDecl`, `#eval`, `Classical.choose` or `head!`/`get!`. What's left is harmless:
  - one kernel `decide` (`prefix01_eq`, ReadableOwner.lean:302);
  - `decide_eq_*` rewrites;
  - `set_option maxHeartbeats 0`, and `hygiene false` for one macro (MintRoot.lean:20).
- **The import closure.** It's 284 files with the packages; I recomputed it with guillemets stripped.
  - In-repo, no `sorry`, axiom or `native_decide`.
  - In the packages: Blaster's `axiom blasterProven`, used by `Template/AnyTxPurposes`' blaster theorems, which Typed imports only for `purposeCtx` and `isRegistrationData`; PlutusCore's one `sorry` (CekMachine.lean:324, `runStepsWithBudget`'s `decreasing_by`; check.sh's `CekMachine.lean:309` filter is that declaration); `native_decide` in `Cryptograph/BLS12_381` lemmas.
  - None of them is in the headline cone, by the guards.
- **The guards pass in the lead's run.** check.sh's `lovejoin-every` lists all 25 modules, and the lead's log shows each one `Built` (none replayed) and 25 `ok`. The only `declaration uses` warnings are AnyTxPurposes' `blasterProven`, with no `sorry` anywhere. `#guard_msgs` fails the build on a mismatch, and check.sh's exit code comes from `PIPESTATUS[0]`.
- **The CEK framework.**
  - `Ev`/`Ap`/`Reaches` are defined over the model's own `step`/`stepN`.
  - `exec_halt_of_ev`, `exec_error_of_ev` and `exec_never_halts` tie them to `cekExecuteProgram` (`runStepsPreservingState`).
  - Acceptance is `Halt (VCon Unit)`, V3's rule.
  - `safe_assumption` and `cek_rfl` only assign terms the kernel re-checks.
- **One region, one theorem; loops by induction.**
  - The 17 loop theorems (policy/name search, carriers, collect, len, pairs, refs, fold, merge, insert, walk, par, rev, the three redeemer walks, tokens, qty, seed, out) are each proved by list induction.
  - There's no length hypothesis or step count anywhere in Every.
  - `withdraw_root` (any `P info red cred`) and `launch_root` (any `seedTx seedIx rh info red P`) take no other hypotheses, so every region's closure and slot hypotheses are discharged.
- **The bytes.** The Lean `Template/Scripts/*.hex` files are byte for byte core's `MIX_LOGIC_V2`, `ONE_SHOT_MINT`, `MIX_BOX` and `FEE_CONTRACT`. `V2/Scripts/mix_logic.hex` hashes to 60294352…, and the classic files to 0dad3046… and f5592689….
- **The parameters.**
  - Lean runs `cekExecuteProgram t [toTerm P, toTerm nftName, toTerm ctx]`, which is `applyParams`, `Apply(Apply(Apply(body, Data B P), Data B "lovejoin"), Data ctx)`.
  - That is core's `apply_data` order (P, then `NFT_NAME`), and it's how the ledger applies the context.
  - one_shot_mint's `(Data B seedTx, Data I idx, Data B rh)` matches core's `one_shot_mint()`.
  - The name is fixed to `lovejoin`, which one_shot_mint enforces, so "any pool's parameters" holds.
- **On chain.** IOG's Haskell `uplc` 1.64 `apply-to-cbor-data` on the Lean hex files reproduces mainnet's v2 5 ₳ pool:
  - one_shot_mint at seed 6db8a313…#3 → fcb3f5ec… (P);
  - mix_logic at (P, `lovejoin`) → a6a85074… (3487 bytes);
  - mix_box at L → dd94113c… (629 bytes).

  One Koios `utxo_info` read of b1720b86…#0-#2 confirms the datum's M and L and both reference scripts' hashes and sizes. core's `derive_in(Set::V2)` gives the same (repro, deleted). The head-start Vitest verifies this pool in CI, and the baseline run passes.
- **The decoder.** `Audit.Checks.FlatDecodeCheck` (built after the hex's last change) found the flat decoder's reading equal to Aiken's text, through the conformance-tested parser, for all 13 scripts, with 3 controls false. It also found V2's applied script equal to the template applied to (abab…, `lovejoin`). Its texts match today's decode.
- **The pinned model.**
  - The lakefile, the manifest and `.lake/packages` agree: PlutusCoreBlaster 68c5399, Lean-blaster 25c0ee0, CardanoLedgerApiBlaster 9938562.
  - All three are fetchable: `git ls-remote` shows `opaque-xor` = 68c5399 and `seedelf` = 25c0ee0.
  - The fork's diff from upstream 1c23de8 is limited to the opaque aliases, the BLS operand order and `Fq1`'s `ToExpr`.
- **The opaque builtins really are opaque.** These are all Lean `opaque` constants: `blake2b_256`, `bls12_381_G1_{add,scalarMul,equal,compress,uncompress}`, `encodeDataOpaque`, `byteStringToIntegerOpaque` (Nat-valued, true of the real one) and `xorByteStringOpaque`.
  - No axiom, lemma or hypothesis gives them meaning.
  - The specs call them with the program's own arguments, in its order (the iffs couldn't be proved otherwise).
  - `branchHolds` keeps `uncompress(compress(·))`.
  - `integerToByteString` stays the builtin's own (`i2b`).
  - `q` unifies with the program's literal, and it is BLS12-381's r.
- **The model's assumptions.**
  - The default semantics variant is E. Only `consByteString` depends on the variant, and neither script uses it.
  - Neither script cases on a builtin value: all 127 + 37 `case` nodes are `case (constr 0 …) [λ…]` lets, so the model's newer case-on-builtins rules aren't relied on.
- **The typed layer.**
  - `every_context_iff` and `mint_every_context_iff` cover all six ScriptInfo cases. Other purposes go through `PurposesKernel`'s kernel `cek_v3`, and publish through `LogicPublishKernel`, both guarded.
  - The headline hypotheses are only these: `validTxOutValue` of reference inputs (mix_logic), and `validMintValue` plus outputs' `validTxOutValue` (one_shot_mint). All are rules the ledger enforces: positive ADA, sorted, non-zero or positive quantities, no ADA entry in a V3 mint.
- **The `_valid` forms.** `validScriptContext`'s `isBalanced` has no deposit or withdrawal term, as documented (the owner's call). A launch that registers mix_logic's credential carries a deposit, so `one_shot_mint_accepts_iff_valid` misses it too. The doc's "for the same reason" covers that.
- **The tools decide nothing.** `pseudo.py`, `uplc_tree.py`, `scope.py`, `freevars.py`, `lpath.py`, `pp.py` and `fillpaths.py` print views and paths or fill `PATH()` placeholders. Every path ends in a `sub`/`msub` term that the root theorems' kernel-checked composition must match. Nothing outside Lean decides anything the claim relies on.

## Repro and scratch

- `CORE/tests/zz_r181_trust_1.rs` ran with `cargo test -p seedelf-core --test zz_r181_trust_1`: 2 passed. It was deleted from the tree; a copy is at `SCRATCH/review/trust/zz_r181_trust_1.rs`.
- Byte comparison: `SCRATCH/review/trust/cmp_templates.py`.
- uplc applications: `SCRATCH/review/trust/apply/`.
- Decodes: `SCRATCH/review/trust/{ml,osm}.uplc`.
- Import closure: `SCRATCH/review/trust/closure.txt`.
- I ran no lake, lean or check.sh, nothing in seedelf-data, no e2e, and nothing was submitted. The network use was one Koios read, `git ls-remote` of two forks, and one GitHub check-runs read.
