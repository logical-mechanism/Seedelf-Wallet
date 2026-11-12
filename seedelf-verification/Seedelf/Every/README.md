# Seedelf in every transaction, kernel-checked

Kernel-checked proofs of exactly when each of Seedelf's three deployed scripts accepts, in every transaction: no Blaster, no step limit, any number of signatories, any mint, any inputs. They rest on Lean's own axioms alone (`propext`, `Classical.choice`, `Quot.sound`), and the `#guard_msgs` checks in `Typed`, `PolicyTyped` and `AlwaysFalse` fail the build otherwise. What they let us claim is in [CLAIMS.md](../../CLAIMS.md). How the work went, and the owner's calls, are in [chunk 48](../../../seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-48-seedelf-every-tx-kernel.md).

The method is chunk 45's for Lovejoin, so read [Lovejoin/Every/README.md](../../Lovejoin/Every/README.md) first: the spec is the compiled code read back as Lean over `Data`, and there's one `Ev` theorem per region, with induction for each loop. This page has what's different here.

## Building

- **`./check.sh seedelf-every`**, from `seedelf-verification/`, builds the 14 modules here after the 14 they import from elsewhere, one per scope at 16 GB and 30 minutes. A clean build of the 14 takes about four and a half minutes. Two of them pass the default 8 GB: `Root` peaks near 8.8 GB, and `Mint` near 9.5 GB.
- **No Z3 is needed.** Nothing here calls Blaster, though `LinesAllLoops`' import chain runs `#prep_uplc`.
- **The tactics are Lovejoin.Every.Base's, renamed** (`w_go`, `w_using`, `w_step`, `w_safe`), so that a module can import both families. `Base.lean` imports only `Lovejoin.AnyTx.CekCase`, which imports no Lovejoin script.

## The modules

| Module | Theorem | What it says |
|---|---|---|
| Scalar | `dec_ap`, `dec_some`, `dec_none_le`, `dec_none_lt` | i_45, `scalar.from_bytearray_big_endian`: `Some(n)` when `0 ≤ n < q`, else `None` |
| Prove | `prove_ev` | i_36 … i_41, `schnorr.prove` as compiled (`proveOpt`): z decodes, g decompresses, c decodes, g_r and u decompress, then g^z = g_r · u^c |
| Signers | `signer_loop` | i_51, `list.has(extra_signatories, vkh)`, by induction on the list: any length |
| Register | `register_ev` | the Register's spend (`registerOpt`): the proof, then field 8's signatories |
| Datum | `datum_ev` | `Some(d)`: exactly `Constr 0 [B g, B u]` is a Register, anything else accepts |
| Root | `wallet_root` | **the whole wallet on any context `Data`**: `unitIf (walletBool ctx)` |
| Typed | `wallet_exec_iff`, `wallet_exec_error`, `wallet_accepts_iff` | **the wallet for every typed V3 `ScriptContext`, in `wallet.ak`'s terms** (`walletAccepts`, `schnorrProve`) |
| AlwaysFalse | `always_false_errors` | always_false reaches `Error` on any argument, and never halts |
| PolicyBase | `ap_eqBS`, `ap_eqInt`, `ap_cons_ok`, `ap_cons_err` | the builtins at a cased result; the policy's spec (`burnOpt`, `mintOpt`, `tokenName`) |
| Burn | `burn_ev` | the burn block: one line, own policy, `slice(0, 4, tkn) = 5eed0e1f`, amount -1 |
| Mint | `mint_ev` | the mint block: one line, the first input's reference, `consByteString`, own policy, `token_name.generate`, amount 1 |
| PolicyRoot | `policy_root` | **the whole policy on any context `Data`**: `unitIf (policyBool ctx)`, the xor |
| PolicyTyped | `policy_exec_iff`, `policy_exec_error`, `policy_accepts_iff` | **the policy for every typed V3 `ScriptContext`, in `seedelf.ak`'s terms** (`policyAccepts`, `flatLine`, `seedelfName`) |

The flatten loops are `LinesAllLoops`' and `LinesAllAnyMint`'s (`flatten_apply_any`), which were already kernel-checked.

## Pitfalls already paid for

These are on top of Lovejoin's.

- **Never let anything reduce a comparison with `q` on `Int.ofNat k`.** Deciding `Int.ofNat k < q` unfolds `Nat.sub` from the 255-bit `q` one unit at a time: the elaborator stops at max recursion, and the kernel at "deep recursion detected". Four places reach it:
  - **simp's match reduction.** `simp only [f]`, where `f` matches on `proveOpt …` or `scalarOf …`, reduces the discriminant. So `registerOpt` is `afterProve info vkh (proveOpt …)`, and the proof rewrites `proveOpt …` with its cased value first.
  - **Unification.** A CEK step tries `some ?f =?= Option.map f (proveOpt …)` and reduces `proveOpt`. So `proveOpt` is `irreducible` once `prove_ev` is proved; `simp only [proveOpt]` still unfolds it by its equation.
  - **The kernel, on a match whose first discriminant is `scalarOf z`.** Unfolding `Seedelf.V1.schnorrAccepts` alone (by `unfold` or `delta`) fails the kernel check. That's why the readable `schnorrProve` matches on the three decompressions first, as Lovejoin's `schnorrVerifies` does, and why nothing here is stated over `schnorrAccepts`.
  - **Bridging to the source's terms.** First `generalize bigEndian z = zi`: a free integer stops every reduction (`proveOpt_true_iff`, as chunk 45's `ownerPred_typed` does).
- **The spec's specials are the program's own tests**, as Bool `if`s (`scalarData`, `proveOpt`). Case on each test, then pass an `ap_lessThan` or `ap_lessThanEquals` fact, so the machine never decides one.
- **No `try` catches a max-recursion error:** it's a runtime exception. A closing `all_goals try (… w_go …; done)` that reaches the goal a region lemma is meant for runs into the region with no lemma, and then decides `n < q`. Give that goal its own bullet.
- **Test a tag before splitting its fields,** as the program does. A spec that matched the redeemer's three fields before its tag needed 281 field shapes for the wrong-tag branch, and ran past 16 GB.
- **Cut the root where its branches fan out.** The datum's fifteen shapes each re-ran the program from its top, past 16 GB. `datum_ev` starts where `Some(d)` is known.
- **Split in evaluation order, inside a line too.** The program reads a line's name (`unBData` of field 1) before it finds no third field, so a two-field line needs field 1 split.
- **Compare against a program constant with an `ap_eq*` lemma, never a rewrite.** `5eed0e1f`, `-1` and `1` are the program's literals, and `rw` won't match a spec's spelling of them. `apply` unifies them by definition.
- **`consByteString` on a symbolic index reduces partway,** to `Int.decLe idx 255`, so a rewrite with `consByteStringV2 idx txid = …` finds nothing afterwards. Use `ap_cons_ok` or `ap_cons_err`.
- **`have h := lemma (x := …)` can't leave implicit arguments open.** The flatten closure's environment is explicit in `burn_ev'` and `mint_ev'`, and `apply` assigns it from the slot goal.
- **Typed lists:** Lean's compiled match for `[.List [.B pid, .B tkn, .I amt]]` looks into the first line before it checks the second. Split the first line's three fields in the two-line case too (`mem_flatPairs` says every line has three).
- **Lean core has no `not_and_or`** (it's Mathlib's), and `omega` doesn't see through `Integer`. Split by hand.

## Paths

`Base.lean`'s `regAt` is the Register check's delay. The other wallet paths are suffixes of it: the decode, the check and the loop. `Datum.lean`'s `datumAt` is where `Some(d)` is bound. The policy's `burnBody` and `mintBody` are the xor's two arguments. Generate any new path with `Lovejoin/Every/tools/` from `pseudo.py`'s printout, never by hand.
