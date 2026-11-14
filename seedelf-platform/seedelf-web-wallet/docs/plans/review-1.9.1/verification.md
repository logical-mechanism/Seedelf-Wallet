# verification (find:verification)

5 finding(s).

## verification#1: README:7 says the kernel proves each script accepts "exactly when its Aiken source says it does"

- **Severity:** low; **confidence:** traced
- **Where:** `seedelf-verification/README.md:7`
- **Since:** new in 1.9.1

**What.** The theorems prove the bytes are equivalent to hand-written Lean predicates: `walletAccepts` (Seedelf/Every/Typed.lean:91) and `policyAccepts` (Seedelf/Every/PolicyTyped.lean:72). No proof checks that those predicates say what the Aiken source says. README:179 says so itself ('An outside read ... would check what no proof can', chunk 49), and README:3 says 'The proofs are about the scripts on chain, not their Aiken source'. CLAIMS.md:11-12 words it correctly ('`walletAccepts`, `wallet.ak`'s terms'). In substance the line is true: my own read finds the predicates match the 5b82530 source. The problem is that it's stated as proved.

**Scenario.** A stranger reads README:7 as a machine-checked equivalence between the bytes and the Aiken source. The owner's bar is that a claim says no more than its theorem, and this one says more.

**Evidence.** README.md:7 'For every typed V3 context, each accepts exactly when its Aiken source says it does'; README.md:3 'The proofs are about the scripts on chain, not their Aiken source'; README.md:179 'An outside read of those statements against wallet.ak, schnorr.ak, seedelf.ak and token_name.ak would check what no proof can'; Typed.lean:209 `theorem wallet_accepts_iff ... ↔ walletAccepts ctx`.

**Suggestion.** "each accepts exactly when `walletAccepts` / `policyAccepts` hold, readings of its Aiken source (chunk 49 has the outside read)".

## verification#2: README:39 says #73 hasn't merged, while README:182, CLAIMS:24 and chunk 46 say it has

- **Severity:** low; **confidence:** traced
- **Where:** `seedelf-verification/README.md:39`
- **Since:** unchanged from 1.9.0 (contradiction new in 1.9.1)

**What.** #381 updated README:182 and CLAIMS:24 to say PlutusCoreBlaster #73 has merged, and chunk 46's plan records the merge on 2026-11-08 (8f76ba5). Line 39 in the same README, unchanged since 1.9.0, still says it hasn't. The README now contradicts itself.

**Scenario.** A reader of the Running it section is told the operand-order fix is still only on our fork, and five sections later that it has merged.

**Evidence.** README.md:39 '#71 and #72 have merged since; the operand order (#73), `serialise_data` and xor haven't.' vs README.md:182 'Of our four PRs, #71, #72 and #73 have merged' and CLAIMS.md:24 '(merged upstream since, PlutusCoreBlaster #73)'; chunk-46-verification-on-upstream.md:18 'Merged 2026-11-08 (`8f76ba5`)', :129 '✅ #73 merged 2026-11-08'.

**Suggestion.** "#71, #72 and #73 have merged since; `serialise_data` and xor haven't."

## verification#3: CLAIMS:24 says the fork has "three changes beyond the `main` it forked", but it has five

- **Severity:** nit; **confidence:** traced
- **Where:** `seedelf-verification/CLAIMS.md:24`
- **Since:** new in 1.9.1

**What.** README:37 and lakefile.lean:8-12 list five changes beyond PlutusCoreBlaster main 1c23de8: the opaque ByteStringToInteger (#71), Fq1.t as a Nat (#72), the operand order (#73), serialise_data and xor. The Seedelf kernel proofs do use #71's alias. CLAIMS:26 already discloses `bytearray_to_integer` as opaque, so nothing is hidden. Only the count and the phrase 'beyond the main it forked' are wrong.

**Scenario.** A reader counts three changes to the machine model, and the one alias Seedelf's own kernel proofs rely on isn't among them.

**Evidence.** CLAIMS.md:24 'with three changes beyond the `main` it forked: the BLS12-381 operands in order (...), and an opaque `serialise_data` and an opaque xor'; README.md:37 '`main` `1c23de8` plus an `opaque` `ByteStringToInteger`, `Fq1.t` as a `Nat`, the BLS12-381 builtins' operands in order and #27's `opaque` `serialise_data` ... plus an `opaque` `XorByteString`'; Seedelf/Every/Scalar.lean:20 `abbrev bigEndian (b : ByteString) : Integer := .ofNat (byteStringToIntegerOpaque true b.data)`.

**Suggestion.** "two changes IOG's `main` doesn't have yet (an opaque `serialise_data` and xor, which only Lovejoin's proofs use), and the operand order and `ByteStringToInteger` alias, merged since (#73, #71)".

## verification#4: There are two `policyAccepts`, and README:117 describes the one CLAIMS doesn't cite

- **Severity:** nit; **confidence:** traced
- **Where:** `seedelf-verification/README.md:117`
- **Since:** new in 1.9.1

**What.** Slice/Slice/Common.lean:152 defines Blaster's `policyAccepts`, over the opaque slice. Seedelf/Every/PolicyTyped.lean:72 defines the kernel's, over the real `sliceByteString`. README:117 says a spec that slices (`policyAccepts`) 'calls the same alias the builtin runs'. That is true of Slice's and false of the kernel's, which CLAIMS:12 and README:71 cite by the same bare name.

**Scenario.** A reader takes the claimed `policyAccepts` to run over the opaque slice alias, which contradicts CLAIMS:26 ('the kernel's uses the real one').

**Evidence.** README.md:117 'Where a spec decodes a scalar (`scalarOf`) or slices (`policyAccepts`), it calls the same alias the builtin runs.'; grep: Slice/Slice/Common.lean:152 `def policyAccepts (own pid tkn tag txid : ByteString) ...`, Seedelf/Every/PolicyTyped.lean:72 `def policyAccepts (ctx : ScriptContext) : Prop`.

**Suggestion.** Write `Slice.policyAccepts` at README:117, or add '(Slice/'s; the kernel's uses the real slice)'.

## verification#5: Stale build and summary lines left beside #381's edits

- **Severity:** nit; **confidence:** traced
- **Where:** `seedelf-verification/check.sh:8`
- **Since:** unchanged from 1.9.0

**What.** These are unchanged from 1.9.0, in files #381 edited:
- check.sh:8 says plain `./check.sh` builds 'every Seedelf module', but its default list (check.sh:51-53) has no Seedelf.Every.*.
- check.sh:26-27 says naming a Lovejoin.Every module gives the whole run 16G. Seedelf.Every.* does the same now (check.sh:32).
- README:43's caps line names only lovejoin-every at 16 GB, not seedelf-every.
- README:57-58 says Undetermined warnings must be reviewed by hand. Since #372, check.sh:216-218 fails them as UNDETERM, nonzero.
- README:99's 'So, for every transaction' summary still bounds the wallet at 'up to 128' signatories. wallet_accepts_iff has no bound (README:123, CLAIMS:28).

**Scenario.** A reader runs plain ./check.sh expecting every Seedelf module, Seedelf/Every/ included, and never builds the kernel claims. Or a reader takes 128 signatories as the wallet's proved bound.

**Evidence.** check.sh:8 '#   ./check.sh                       every Seedelf module (Slice/ is its own: seedelf-slice)'; check.sh:26-27 '(naming a Lovejoin.Every one gives the whole run 16G, 30m)'; README.md:43 '(8 GB and 10 minutes; `lovejoin-every` and its modules 16 GB and 30 minutes; ...)'; README.md:57-58 'some Blaster checks can still be reported as undetermined warnings, so review the output'; README.md:99 '... for up to 128 of them, where a 16,384-byte transaction holds at most 125'. `git show c0b451a8:` shows each line present at 1.9.0.

**Suggestion.** A one-line fix for each: 'every Seedelf module but Seedelf/Every/ (seedelf-every) and Slice/'; 'a Lovejoin.Every or Seedelf.Every one'; add seedelf-every to README:43; 'check.sh fails them as UNDETERM'; 'for up to 128 of them (the kernel's wallet_accepts_iff: any number)'.

## Checked and holds

- The wallet: `walletAccepts` (Seedelf/Every/Typed.lean:91-103) matches wallet.ak and schnorr.ak at 5b82530, read side by side. A spend only (`else(_) { fail }`). A Proof is Constr 0 of exactly three B. None and a non-Register datum accept. A Register needs schnorr.prove and list.has(extra_signatories, vkh).
- `schnorrProve` (Typed.lean:69) matches `prove`. The challenge is blake2b_224(g ‖ g_r ‖ u ‖ vkh) (Prove.lean:22), fiat_shamir_heuristic's order. Both scalars are checked in [0, q). The check is g^z = g_r · u^c. A failed decompression is false in the spec and an error in the program, and both reject.
- The policy: `policyAccepts` (PolicyTyped.lean:72-84) matches seedelf.ak. A mint only, a bytestring redeemer, `expect [(pid,tkn,amt)] = flatten(mint)`, `expect [input, ..]`. generate fails past index 255 for a burn too, because xor evaluates both blocks. take(tkn,4) is sliceByteString 0 4, and xor is (b ∨ m) ∧ ¬(b ∧ m).
- Every Seedelf theorem CLAIMS.md:11-13 cites exists with the stated scope: wallet_accepts_iff and policy_accepts_iff over every typed V3 ScriptContext, always_false_errors over any Data. No signer bound, no mint or input bound, no ledger hypothesis.
- #guard_msgs on #print axioms (propext, Classical.choice, Quot.sound) covers wallet_accepts_iff, wallet_exec_error, policy_accepts_iff, policy_exec_error and always_false_errors. The exec_iff lemmas are covered through accepts_iff.
- There is no sorry, axiom or blaster call in Seedelf/Every/*.lean or the 14 modules they import (grep; the hits are comments only).
- There's no step limit. The theorems are `∃ n, cekExecuteProgram … = Halt (VCon Unit)`, and on failure `∃ m, … = Error` plus never Halt. They don't use isUnsuccessful, so PlutusCoreBlaster #78's change doesn't touch them.
- The bounds are stated next to the claims: no signer bound for the kernel, with Blaster's 128 against the size limit's 125 noted (CLAIMS:28, README:123); the typed context as CardanoLedgerApiBlaster's encoding (CLAIMS:25); no ledger rule in Seedelf's (CLAIMS:27), true of the kernel theorems; budgets not covered (CLAIMS:29); opaque crypto, including bytearray_to_integer (CLAIMS:26).
- The README's build steps go only through check.sh with its caps (README:15-26, :43 'Never build bare', :49). The full-suite chain adds ./check.sh seedelf-every before seedelf-slice and the nonzero ./check.sh. Seedelf/Every/README.md:9 and chunk 49 (a capped systemd-run scope for lake env lean) agree.
- check.sh's seedelf-every list (check.sh:57-62) has 14 imported modules, then the 14 of Seedelf/Every, in import order. I checked every module's imports: each dependency comes earlier, so each scope builds one module. seedelf-every and Seedelf.Every.* get 16G/30m (check.sh:32-33).
- check.sh's Undetermined handling is unchanged by #381 (check.sh:216-218 and :224: a module logging 'warning: … Undetermined' becomes UNDETERM, sets check_failed and exits nonzero). The kernel modules log no Blaster warnings.
- Plain ./check.sh builds modules by name, not the Seedelf root that now imports Seedelf.Every.*, so its 8G default never meets Root (~8.8 GB) or Mint (~9.5 GB).
- Chunk 46's plan (#382) agrees with README:181-185 and CLAIMS: #73 merged, #455 mergeable, the #78 isErrorState migration listed. On #77 the kernel families pass, and the Blaster symbolic-pool Mix that times out is called a lost cross-check, not a lost claim, which matches CLAIMS (the Lovejoin claim is the kernel's).

## Coverage

I read CLAIMS.md, README.md, Seedelf/Every/README.md, every Seedelf/Every/*.lean theorem statement and spec definition (walletBool, policyBool, proveOpt, challenge, scalarData, registerOpt, datumOpt, burnOpt, mintOpt, tokenName, walletAccepts, policyAccepts), check.sh in full, lakefile.lean, #382's chunk-46 diff and the start of chunk 49. I compared them against wallet.ak, seedelf.ak and schnorr.ak at 5b82530.

Not done:
- The proof bodies of the region lemmas (Root, Datum, Register, Signers, Burn, Mint, PolicyRoot) beyond their statements. The axiom guards are what certifies them.
- The archived chunk-48 record.
- The PlutusCoreBlaster pin's sources (its sliceByteString and builtin dispatch): .lake/packages is absent in the release tree, and the main checkout is off limits.
- Whether #prep_uplc needs Z3 (Seedelf/Every/README.md:10 says no Z3 is needed).

Nothing was built or run in seedelf-verification/. The harness refused the report.md write ('Subagents should return findings as text'), so this StructuredOutput is the report; no file exists at SCRATCH/review-1.9.1/verification/report.md.
