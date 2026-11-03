<!-- New issue on https://github.com/input-output-hk/PlutusCoreBlaster -->

# [Feature]: let symbolic tools through `byteStringToInteger` and `sliceByteString` (opaque aliases, as #27)

## Description

Over a symbolic bytestring, the `ByteStringToInteger` and `SliceByteString` builtins can't be translated by Blaster: `PlutusCore.Bitwise.byteStringToInteger` folds `Char.toNat` over `s.data`, and `PlutusCore.ByteString.sliceByteString` is `(bs.data.toList.drop start).take count`. Both reach `Char`, whose `UInt32` is a `BitVec 32`, and Blaster rejects it (`Inductive datatype with instance parameters not supported: `BitVec`, Lean-blaster #153). Bytestring functions that don't look at characters translate to SMT strings and prove fine.

PR #27 solved the same problem for `serialiseData` by routing the builtin through an `opaque` alias: symbolic tools see an uninterpreted function, compiled evaluation is unchanged. This asks for the same, as a stopgap until Lean-blaster has `BitVec` support.

## Steps to Reproduce

Lean 4.24.0, Z3 5.3.1, PlutusCoreBlaster `1c23de8`, Lean-blaster `46c8479`:

```lean
import Blaster
import PlutusCore
open PlutusCore.ByteString
open PlutusCore.Bitwise

-- ✅ Valid: no character is looked at
theorem append_right_empty : ∀ (a b : ByteString),
    appendByteString a b = a → b = emptyByteString := by blaster
-- ✅ Valid: consByteString's byte is fine
theorem cons_front : ∀ (n : Nat) (bs : ByteString),
    n < 256 → (ByteString.cons n.toUInt8 bs).data.front.toNat = n := by blaster

-- ❌ BitVec
#blaster (solve-result: 1) [∀ (s : String), byteStringToInteger true s ≠ 258]
theorem slice_known_prefix : ∀ (rest : ByteString),
    sliceByteString 0 2 (appendByteString "ab" rest) = "ab" := by blaster
theorem slice_length : ∀ (bs : ByteString),
    lengthOfByteString (sliceByteString 0 4 bs) ≤ 4 := by blaster
```

## What would help

1. **`ByteStringToInteger` and `IntegerToByteString` through `opaque` aliases**, like #27. That's enough for properties that use the conversion the same way on both sides. A Schnorr verifier's "the proof's scalar is in range and g^z = g_r·u^c" is stated with the same `byteStringToInteger` the script runs, and Blaster can prove it with the function uninterpreted, as it already does for the hash and BLS12-381 builtins.
2. **`SliceByteString`**: an `opaque` alias would serve properties that slice the same way on both sides (a token name equals `generate`'s output), but not ones that need slicing's meaning (the first 4 bytes of `prefix ++ rest` are `prefix`). Blaster maps `String.append`, `String.length` and `String.replace` to SMT strings but no substring operation yet; with one (`str.substr`), `sliceByteString` could be defined on it and keep its meaning. An alias plus a few lemmas (length bound, slice of an append with a known prefix) would be a middle way.

## Why

We're proving properties of [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet)'s validators as deployed on mainnet, from their UPLC. The wallet (`94bca9c0…`) decodes its Schnorr scalar and challenge with `byteStringToInteger`; the minting policy (`84967d91…`) names tokens with `sliceByteString`. 29 properties of the same scripts prove; these two builtins block the rest, most of all the wallet's core property, that a Register UTxO moves only with a valid proof. (That one also needs a Lean-blaster fix for `Except`'s SMT declaration, filed separately.)

We can open a PR for (1) along the lines of #27 if that's welcome.
