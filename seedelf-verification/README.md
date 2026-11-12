# seedelf-verification

Formal verification of the deployed contracts' bytes, with IOG's [Blaster](https://github.com/input-output-hk/Lean-blaster): Lean 4 with Z3 behind it, over [PlutusCoreBlaster](https://github.com/input-output-hk/PlutusCoreBlaster)'s model of UPLC and the CEK machine, and [CardanoLedgerApiBlaster](https://github.com/input-output-hk/CardanoLedgerApiBlaster)'s ledger types. The proofs are about the scripts on chain, not their Aiken source: variant 1, the bytes commit `5b82530`'s `seedelf-contracts/contracts/` holds, which `extract.sh` checks against the on-chain hashes.

[CLAIMS.md](CLAIMS.md) says, in a page, what all this lets us claim and where it stops.

**All three Seedelf scripts are also proved in Lean's kernel, with no Blaster** ([`Seedelf/Every/`](Seedelf/Every/README.md), chunk 48). For every typed V3 context, each accepts exactly when its Aiken source says it does, with no step limit, any number of signatories and any mint. The Blaster modules below stay as a cross-check, by another route, of the same properties.

Lovejoin's proofs are here too, in `Lovejoin/`: its classic mainnet pool, and v2, the token-pool templates with xor32's two length checks (Lovejoin `main` `29573c5`, PRs #165 and #166). [CLAIMS.md](CLAIMS.md) and [Lovejoin/AnyTx/README.md](Lovejoin/AnyTx/README.md) say what they cover and what they leave out; [chunk 42](../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-42-lovejoin-verification.md) is the record. `Audit/` is a review of the proofs as they stood on 2026-11-03, before the every-transaction modules ([its README](Audit/README.md)).

## Running it

Needs [elan](https://github.com/leanprover/elan) (it installs the Lean that `lean-toolchain` pins, 4.24.0) and **Z3 5.3.1 or later** on `PATH`. The Blaster commit `lake-manifest.json` pins sends Z3 a simplifier (`recfun-finder`) that 5.3.0 introduced; PlutusCoreBlaster's README still says 4.15.2, which fails every proof that reaches Z3.

```bash
./extract.sh            # the deployed scripts, hash-checked, into Seedelf/Scripts/ and concrete/build/
./check.sh              # standard Seedelf modules, cheapest first; or ./check.sh Seedelf.PolicyBurn
./check.sh seedelf-any-tx     # the every-transaction modules alone
./check.sh seedelf-signers    # the wallet with 4 to 128 signatories (python3 -I gen-seedelf-signers.py writes them)
./check.sh seedelf-policy-any-tx   # the policy in every transaction, where it needs no slice
./check.sh seedelf-slice      # the policy's one-line rule, in its own package (python3 -I gen-seedelf-slice.py)
./check.sh seedelf-every      # all three scripts in every transaction, kernel-checked: no Z3 (16 GB, 30 min a module)
./concrete/wallet_datums.sh   # cross-checks with Aiken's evaluator
./concrete/policy_burns.sh
./concrete/wallet_register.sh
```

**After an extract run, delete the Scripts modules' builds.** Lake doesn't track the `.hex` files `#import_uplc` reads, so a changed script rebuilds nothing and `check.sh` replays the old results as `ok` (the audit's `script-hex-not-lake-inputs`, still open):

```bash
rm -f .lake/build/lib/lean/{Seedelf,Lovejoin,Lovejoin/V2,Lovejoin/Template}/Scripts.{olean,trace} Slice/.lake/build/lib/lean/Slice/Scripts.{olean,trace}
```

**Lake pins two of our forks** in `lakefile.lean`, above CardanoLedgerApiBlaster's own requirements, until upstream merges the fixes (chunk 41):

- [logicalmechanism/Lean-blaster](https://github.com/logicalmechanism/Lean-blaster) `25c0ee0`: beta `46c8479` plus the fix for [#454](https://github.com/input-output-hk/Lean-blaster/issues/454).
- [logicalmechanism/PlutusCoreBlaster](https://github.com/logicalmechanism/PlutusCoreBlaster) `68c5399`, its `opaque-xor` branch: the `seedelf` branch (`main` `1c23de8` plus an `opaque` `ByteStringToInteger`, `Fq1.t` as a `Nat`, the BLS12-381 builtins' operands in order and #27's `opaque` `serialise_data`, with the #71 and #72 review rounds), plus an `opaque` `XorByteString` for Lovejoin's xor32.

As each fix lands upstream, its `require` comes out. #71 and #72 have merged since; the operand order (#73), `serialise_data` and xor haven't.

**`Slice/` is a package of its own,** with the same pins but one: the fork's `opaque-slice` (`96261cc`), which is the main package's pin plus an `opaque` `SliceByteString` (see *What a ✅ is worth*). So the alias changes no other proof.

**Never build bare** (`lake build`). `check.sh` builds each module in its own memory-capped scope (8 GB and 10 minutes; `lovejoin-every` and its modules 16 GB and 30 minutes; `CAP=` and `LIMIT=` to change), which the kernel kills past the cap. One preparation step over a fully symbolic transaction took 52 GB before it was killed by hand. The first build fetches and compiles the dependencies and takes a while.

To check the standard Lovejoin and Seedelf proof suites, including the separate Slice
package, from this directory:

```bash
./check.sh lovejoin && ./check.sh lovejoin-v2 && ./check.sh lovejoin-any-tx && ./check.sh lovejoin-every && ./check.sh seedelf-every && ./check.sh seedelf-slice && ./check.sh
```

`lovejoin-every` builds the 51 modules its theorems import from elsewhere first, then its own 25, at
16 GB and 30 minutes a module. `./check.sh` goes last: PolicyBurn and PolicyMint fail on `BitVec`
(*Not proved*), so it ends nonzero, and nothing after it would run.

The runner uses `systemd-run --user` for its memory caps and returns a nonzero status
if any module fails. It checks Lake builds; some Blaster checks can still be reported as
undetermined warnings, so review the output. This command excludes the separate audit
and upstream reproductions. For the longer audit and its warning counts, see
[`Audit/README.md`](Audit/README.md).

## What's proved

### In Lean's kernel

On the same bytes, for every typed V3 `ScriptContext`, and for any context `Data` at all. Each theorem is about the deployed program's own run (`cekExecuteProgram`): it returns `()` for some fuel exactly when the condition holds, and otherwise reaches `Error` and never halts. No step limit, no layout, no ledger hypothesis, Lean's own axioms alone. [Seedelf/Every/README.md](Seedelf/Every/README.md) has the modules.

| Script | Theorem | Accepts exactly when |
|---|---|---|
| wallet | `Seedelf.Every.wallet_accepts_iff` | `walletAccepts`, `wallet.ak`: a spend, the redeemer a `Proof { z_b, g_r_b, vkh }`, and then no datum, any datum that isn't a `Register`, or a `Register` for which `schnorr.prove` holds (`schnorrProve`) and `vkh` is among the signatories, however many there are |
| policy | `Seedelf.Every.policy_accepts_iff` | `policyAccepts`, `seedelf.ak`: a mint, the redeemer a bytestring, the mint flattened to exactly one line, an input; then the xor of the burn (own policy, `take(tkn, 4) = 5eed0e1f`, -1) and the mint (own policy, `token_name.generate` of the first input and the tag, 1). An index past 255 fails, for a burn too. The slice is PlutusCoreBlaster's own |
| always_false | `Seedelf.Every.always_false_errors` | never: any argument reaches `Error` |

`wallet_exec_iff` and `policy_exec_iff` state the same of any context `Data` (`walletBool`, `policyBool`, the compiled code read back).

### By Blaster

On the bytes of `94bca9c0…` (wallet), `84967d91…` (policy) and `6777ba4d…` (always_false), **in every transaction**. Every field a script doesn't read is any `Data`, values the ledger never produces included (`AnyTx.lean`). Only what a script walks or takes apart is fixed, one scenario per shape. `AnyTxShapes` and `PolicyShapes` prove, kernel-checked, that the scenarios are every V3 context there is.

| Module | Property | Theorems |
|---|---|---|
| `AlwaysFalseAnyTx` | always_false reaches `Error` whatever its argument: every V3 context, and any other `Data` | 1 |
| `WalletPurposeAnyTx` | The wallet is spend-only, with any TxInfo, redeemer and purpose payload | 5 |
| `WalletRedeemerAnyTx` | A redeemer that isn't a proof, `Constr 0 [B _, B _, B _]`, reaches `Error`, with any TxInfo, output reference and datum. 22 shapes | 22 |
| `WalletNoLockAnyTx` | No accidental locks: a UTxO whose datum isn't a Register returns unit, which the ledger accepts, with any well-formed proof, TxInfo and output reference. 18 shapes | 18 |
| `WalletAnyTx`, `…Two`, `…Three`, `Signers/Signers4` to `Signers128` | **The wallet's core property:** a Register UTxO moves iff the Schnorr check holds and `vkh` is among the signatories, for every count of them from none to 128, every other field any `Data`. Every run returns unit or reaches `Error` | 13, 250 |
| `AnyTxShapes` | Every V3 context is one of the wallet's scenarios: another purpose, a redeemer that isn't a proof, a datum that isn't a Register, or a Register with k signatories. Kernel-checked | 10 |
| `PolicyPurposeAnyTx` | The policy is mint-only, with any TxInfo, redeemer and purpose payload | 5 |
| `PolicyRedeemerAnyTx` | A redeemer that isn't a `B` (the personal tag) reaches `Error`, with any TxInfo and policy id | 4 |
| `PolicyLinesAll`, `LinesAllAnyMint` | A mint of two lines or more fails, at **every length**. So does any mint `Data` that doesn't flatten to exactly one line, and any redeemer that isn't a `B`. Any other field, inputs, signatories and policy id. Kernel-checked, by induction over the mint (`LinesAllLoops`, on `LinesAllCek`'s evaluator), with no step limit | 15 |
| `PolicyLinesAnyTx`, `…FourAnyTx`, `…FiveAnyTx` | The same by Blaster, as a cross-check: no lines, and 2 to 5 lines in every arrangement over policies | 31 |
| `Slice/`'s `Rule` | **The policy's rule** for one line: it passes iff the first input's index is a byte, the line is the policy's own, and it burns one token whose first four bytes are 5eed0e1f, or mints one token named as `token_name.generate` names the first input and the tag. Every run returns unit or reaches `Error`. Every value symbolic, every unread field any `Data` | 258, put together in 2 |
| `PolicyShapes` | Every V3 context with an input and a mint the ledger accepts is one of the policy's scenarios. Kernel-checked | 15 |

**Lovejoin v2,** kernel-checked in every transaction ([`Lovejoin/AnyTx/README.md`](Lovejoin/AnyTx/README.md)): mix_box (`BoxPurposesAll.every_context_iff`), reference_holder (`reference_holder_every_context_errors`), mix_logic (`Lovejoin.Every.Readable.mix_logic_accepts_iff`: both withdrawals, the Owner and the Mix, and its publish) and one_shot_mint (`Lovejoin.Every.Readable.one_shot_mint_accepts_iff`: the launch). Each characterizes its script in every typed V3 context, any list length, no step limit, Lean's own axioms alone: reference_holder errors in all of them, mix_box's is an iff with no hypothesis, and mix_logic's and one_shot_mint's are iffs under the ledger's value rules, mix_logic's on the reference inputs' values and one_shot_mint's on the mint and the outputs' (CLAIMS.md, *Where it stops*). mix_logic's and one_shot_mint's are stated in the Aiken source's terms (`validate_owner`, `walk_outputs`, `verify_pre`, `datum_sane`, …), each proved equal to what the bytes do. fee_contract is out of scope: no Seedelf transaction uses it.

So, for every transaction:
- always_false never passes.
- The wallet passes only a spend, and a redeemer that isn't a proof fails. With a proof, a UTxO whose datum isn't a Register moves. A Register UTxO moves exactly when the Schnorr check holds and `vkh` is among the signatories, for up to 128 of them, where a 16,384-byte transaction holds at most 125: each needs its 30-byte hash and a 101-byte witness.
- The policy passes only a mint whose redeemer is a bytestring and whose mint is exactly one line, by its rule above.

The scenarios they grew from fix the fields their script never reads (an empty transaction from `Scenario.lean`). The modules above restate each of them in every transaction. `PolicyBurn` and `PolicyMint` fail on `BitVec` (see *Not proved*); `Slice/` proves their success directions over the slice alias instead.

| Module | Property | Theorems |
|---|---|---|
| `AlwaysFalse` | always_false reaches `Error`, for any purpose and redeemer | 1 |
| `WalletPurpose` | The wallet is spend-only: minting, rewarding, certifying, voting and proposing reach `Error` | 5 |
| `WalletNoLock` | No accidental locks: a UTxO whose datum isn't exactly `Some(Constr 0 [B _, B _])` is spendable with any well-formed proof. 18 datum shapes, which together cover every datum but a Register (listed in the module) | 18 |
| `WalletRegister` | **The wallet's core property:** a Register UTxO moves iff the Schnorr check holds and `vkh` signed. The check is the Aiken source's `prove`, in its order: z and c = blake2b_224(g ‖ g_r ‖ u ‖ vkh) decode into the scalar field, and g^z = g_r · u^c. One input and one signer; g, u, z, g_r, `vkh` and the signer all symbolic | 1 |
| `PolicyAmount` | Any amount other than ±1 fails | 1 |
| `PolicyForeign` | A mint or burn whose one line is another policy's fails | 2 |
| `PolicyBurn` | No 5eed0e1f token burns off a first input at #256 or -1 | 2 |

What a ✅ is worth:

- **Z3's word, or Lean's kernel.** Blaster closes a goal with `axiom blasterProven : ∀ {α}, α` once Z3 finds no counterexample (proof reconstruction is a TODO upstream), hence the `declaration uses 'blasterProven'` warnings. The kernel-checked modules use no Z3: `Seedelf/Every/` (every Seedelf script, every transaction), `AnyTxCover`, `PolicyAnyTx`'s `rfl`s, `AnyTxShapes`, `PolicyShapes` and the `LinesAll` ones. Their `#print axioms` lists Lean's own alone, and the `LinesAll` theorems hold with no step limit and over every Lean string.
- **IOG's model of the machine.** PlutusCoreBlaster's CEK machine and builtins are working toward conformance with the node's, its README says: a conformance suite run apart from its CI, leaving out what it doesn't implement yet. They aren't proved equal to the node's, and that suite never runs the flat decoder that reads each script's bytes (the audit checked its reading of all 13 scripts against Aiken's once: `Audit.Checks.FlatDecodeCheck`). We run our fork of it (see *Running it*); its changes don't change what any script evaluates to. It runs the post-Conway V3 builtin semantics (`defaultFunSemanticsVariantE`). The crypto builtins (BLS12-381, the hashes) are `opaque`, and so is `ByteStringToInteger` (#71's alias, on our PlutusCoreBlaster fork and upstream since), and `SliceByteString` in `Slice/`. A property holds for any interpretation of them, so it says what the bytes check, not that the check is hard to fool. Where a spec decodes a scalar (`scalarOf`) or slices (`policyAccepts`), it calls the same alias the builtin runs.
- **Strings over the solver's alphabet.** Blaster gives a `String` the SMT string sort, whose characters are `0x0`–`0x2FFFF` where Lean's are scalar values up to `0x10FFFF` ([Lean-blaster #389](https://github.com/input-output-hk/Lean-blaster/issues/389), which shows it proving `False`). A `ByteString` is a `String` of characters `0`–`255`, inside both, so a theorem over bytestrings covers every bytestring; it says nothing about strings with characters above `0x2FFFF`, which no script sees.
- **Every transaction, by layout.** Each Blaster module fixes only what its script walks or takes apart:
  - the wallet's signatories (one module a count, none to 128) and the shapes of its redeemer and datum;
  - the policy's purpose, its redeemer, its mint (one line, or one arrangement of up to five) and its first input.
- **The covers tie those layouts to every context.** The wallet's needs no ledger hypothesis. The policy's assumes CardanoLedgerApiBlaster's model of two ledger rules: a transaction has an input, and its mint is well formed (`validMintValue`). `policy_ledger_hypotheses` derives both from its `validTxInfo`. The kernel theorems need neither a cover nor a hypothesis: they're stated over every typed context.
- **More than 128 signatories** is ruled out by the transaction size limit (`maxTxSize`, 16,384), not by a theorem, for the Blaster modules. If the parameter rises past what 128 covers, they must grow with it. `wallet_accepts_iff` has no bound.
- **Bounded runs.** A Blaster property holds for runs within its module's step limit. Each limit sits above the longest concrete run that `Steps.lean`, `AnyTxSteps.lean` and the generators measure. Each family's returns-unit-or-error theorem shows that no symbolic run reaches it either.
- **The slice package.** `Slice/` runs the same hex, `../Seedelf/Scripts/seedelf.hex`. Its builders are word-for-word copies of `PolicyAnyTx`'s, so `PolicyShapes` covers its layout too. Two workarounds shape it (see *Found along the way*):
  - each first-input index from 0 to 255 is a theorem of its own (`gen-seedelf-slice.py`), with two more off a byte, put together in the kernel;
  - the token name is quantified over its `String`, then restated over `ByteString` by structure eta.

## Not proved, and why

By Blaster, these need Blaster or PlutusCoreBlaster to change, not our scripts. **In the kernel, nothing is left:** `Seedelf/Every/` proves the row below over PlutusCoreBlaster's own slice, since the kernel never has to decide anything about a slice, only carry it. `Upstream/` holds a minimal reproduction of each, with controls (`./check.sh upstream`); the related upstream issues are Lean-blaster [#153](https://github.com/input-output-hk/Lean-blaster/issues/153), [#69](https://github.com/input-output-hk/Lean-blaster/issues/69) and [#67](https://github.com/input-output-hk/Lean-blaster/issues/67) (`BitVec`, `Char`), [#138](https://github.com/input-output-hk/Lean-blaster/issues/138) and [#233](https://github.com/input-output-hk/Lean-blaster/issues/233) (`#prep_uplc` cost, symbolic list tails), and PlutusCoreBlaster [#27](https://github.com/input-output-hk/PlutusCoreBlaster/pull/27) (an `opaque` builtin as the stopgap).

| Property | Blocked by |
|---|---|
| By Blaster, the policy's rule over PlutusCoreBlaster's own slice rather than the alias (`PolicyBurn`'s and `PolicyMint`'s success directions). Proved in the kernel: `policy_accepts_iff` | `sliceByteString` is `take`/`drop` on the `List Char`, so any slice of a symbolic bytestring reaches `Char`'s `BitVec`, even `lengthOfByteString (sliceByteString 0 4 bs) ≤ 4` (`Upstream/ByteStrings`). `Slice/` proves the rule over the `opaque` alias instead, which says what the bytes check for any interpretation of the slice |


## Found along the way

- **PlutusCoreBlaster applied six BLS12-381 builtins' operands swapped:** G1 and G2 `add` and `equal`, `mulMlResult` and `finalVerify`. The CEK machine hands a builtin its arguments last-first, and these six didn't undo it.
  - All six are commutative or symmetric on real points, so no evaluation shows it.
  - Over the `opaque` builtins, though, the script's `equal(g^z, add(g_r, u^c))` was the model's `equal(add(u^c, g_r), g^z)`, so WalletRegister was Falsified.
  - Fixed in our fork (`BuiltinOperandOrder` test), and offered upstream.
- **A symbolic first-input index breaks `#prep_uplc`.** `consByteString idx txid` makes the index's byte a `Char` from a `UInt8`, which is a `BitVec`.
  - Blaster rejects it over a symbolic index.
  - The prepared prop came back holding 18 `sorryAx` in the `Char`'s proofs (`declaration uses 'sorry'`). A prop like that must never be used.
  - `Slice/` proves each index apart instead, and no module here logs a `sorry`: every trace was checked.
  - Chunk 40's "`consByteString`'s byte isn't a blocker" held for its own control, `cons_front`, alone.
- **A symbolic `ByteString` token name blew the policy's run past 8 GB,** even with every other value concrete. The same name as its `String`, or as `a ++ b`, took 280 MB in two seconds, and it branches no more either way. The cause isn't isolated; `Slice/` quantifies over the `String`. This and the index both want minimal upstream reproductions.
- **A burn fails when the transaction's first input is output #256 or later.** `xor(burn, mint)` takes both blocks, so a burn builds the mint's token name too, and `consByteString` refuses an index past a byte (`PolicyBurn`, `concrete/policy_burns.sh`). seedelf-core refuses such an input for a mint (`seedelf_token_name`), not for Remove's burn; local evaluation fails before submit, so nothing is lost, and the same Seedelf burns with other inputs. AUDIT.md §3.4 (on the later revision) covers mints only, and a 16 KB transaction fits about 400 small outputs, so #256 is reachable.

## Writing a property

What a run teaches the hard way:

1. **Measure steps first.** Blaster's machine counts return steps too, so it takes about twice what the chain's cost model charges (wallet: 409 steps against a cost-model 233). Add the scenario's concrete run to `Steps.lean` and set the limit above it.
2. **Failure is `isUnsuccessful`, never `¬ isSuccessful`.** A run cut off by the step limit is neither (`isExhausted`), so `¬ isSuccessful` holds for nothing when the limit is too small. Two of the first "proofs" here did.
3. **Pair a failure property with a run that passes.** A malformed scenario fails for its own reasons; `Steps.lean` shows the same context halting when it's valid.
4. **Symbolic only what the property needs.** Every symbolic value the script branches on splits the symbolic run, and the splits multiply. Never symbolic: a list the script walks, or a bytestring it slices (keep the branch out of the scenario: a hypothesis excluding it still leaves it in the run). An opaque call doesn't split: WalletRegister's six symbolic bytestrings, through the scalar decode and the crypto builtins, take about a second.
5. **Small modules.** A module killed at the cap loses all its messages, including the ✅ before it.
6. **Read a result through a match, never a whole `State`.** `prop … = State.Halt (…)` makes Blaster declare the CEK datatype, constants and all. Match on the halted value, as `isSuccessful` does.
7. **A spec over opaque builtins must call them exactly as the script does:** the same function, the same arguments, in the same order. Commutativity is lost on the solver. `Steps.lean`'s concrete check of the spec (`schnorrAccepts` on a real proof) catches a wrong spec, but not a wrong order.

## When a Lovejoin property comes back Falsified

Chunk 42's rule, for every Lovejoin proof:

- **First, run the counterexample concretely,** with Aiken's evaluator on the deployed bytes, as `concrete/` does.
- **If Aiken agrees, it may be a flaw in a live pool.**
  - Stop, and tell the owner only.
  - Nothing that hints at it gets pushed or posted: no fork branch, no upstream comment, no PR text.
  - The owner decides on disclosure; Lovejoin has its own `SECURITY.md`.
  - The pool's scripts are frozen, so a fix is a new pool beside it.
- **If Aiken disagrees, it's a gap in our spec or in the tools,** as WalletRegister's operand order was in chunk 41. Fix that, the same way.
- **Tool fixes that say nothing about Lovejoin can go public,** for example #27's `serialise_data` alias on our forks and upstream. A fix that a finding motivated waits with the finding.

## Next

- **Seedelf, in the kernel.** All three scripts are characterized in every transaction, in their Aiken sources' terms (`walletAccepts`, `policyAccepts`; the record is [chunk 48](../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-48-seedelf-every-tx-kernel.md)). An outside read of those statements against `wallet.ak`, `schnorr.ak`, `seedelf.ak` and `token_name.ak` would check what no proof can: that they say what Seedelf means. That read, and no locked Register UTxOs (completeness in the kernel, plus a Rust proptest through the deployed bytes), are [chunk 49](../seedelf-platform/seedelf-web-wallet/docs/plans/chunk-49-no-locked-funds.md).
- **Lovejoin.** Every script in scope is characterized in every transaction, mix_logic's and one_shot_mint's in the Aiken source's terms (above; the record is [chunk 45](../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-45-lovejoin-every-tx.md)). An outside read of the readable statements against the source would check what no proof can: that they say what Lovejoin means.
- **Get the fixes upstream, so the forks can go.** The plan is [chunk 46](../seedelf-platform/seedelf-web-wallet/docs/plans/chunk-46-verification-on-upstream.md); chunks 40 and 41 are its archived record.
  - Of our four PRs, #71, #72 and #73 have merged, and Lean-blaster #455 is open.
  - PlutusCoreBlaster #77 (mpetruska's, open) defines the byte builtins so Blaster can read them. It would make our `serialise_data`, xor and slice aliases redundant, and remove #71's.
  - `BitVec` itself is Lean-blaster #153's. Without #77, it still blocks the policy's success directions over the real slice, by Blaster; the kernel proves them without it.
  - PlutusCoreBlaster #78 makes `isUnsuccessful` hold for a run cut off by the step limit. Before we move onto IOG's `main`, the failure theorems must state `isErrorState`, and `LinesAllCek`'s program lemmas must follow `cekExecuteProgram` onto `runSteps` (chunk 46).
