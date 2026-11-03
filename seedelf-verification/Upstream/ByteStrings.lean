import Blaster
import PlutusCore

/-! Repro for PlutusCoreBlaster's bytestring functions over a symbolic input.
`ByteString` wraps a `String`, a `List Char`; a `Char` is a `UInt32`, a
`BitVec 32`. Where a function looks inside a symbolic bytestring it reaches
`Char`, and Blaster rejects `BitVec` ("Inductive datatype with instance
parameters not supported", Lean-blaster #153, #69, #67). Each false statement
expects `Falsified`, so the solver has to model the function; each true one
expects `Valid`. -/

namespace Upstream.ByteStrings
open PlutusCore.ByteString
open PlutusCore.Bitwise

-- Control: whole symbolic bytestrings, no look inside.
theorem append_right_empty : ∀ (a b : ByteString),
    appendByteString a b = a → b = emptyByteString := by blaster
#blaster (solve-result: 1) [∀ (a b : ByteString), appendByteString a b ≠ appendByteString b a]

-- byteStringToInteger (CIP-121): `bstoi_be_loop` folds `Char.toNat` over the chars.
#blaster (solve-result: 1) [∀ (s : String), byteStringToInteger true s ≠ 258]

-- consByteString: the index becomes a `UInt8`, then a `Char`.
theorem cons_front : ∀ (n : Nat) (bs : ByteString),
    n < 256 → (ByteString.cons n.toUInt8 bs).data.front.toNat = n := by blaster

-- sliceByteString: `take`/`drop` on the `List Char`.
theorem slice_known_prefix : ∀ (rest : ByteString),
    sliceByteString 0 2 (appendByteString "ab" rest) = "ab" := by blaster
#blaster (solve-result: 1) [∀ (rest : ByteString),
    sliceByteString 0 3 (appendByteString "ab" rest) ≠ "abc"]
theorem slice_length : ∀ (bs : ByteString),
    lengthOfByteString (sliceByteString 0 4 bs) ≤ 4 := by blaster

-- equalsByteString of a known prefix and a symbolic rest against a constant.
#blaster (solve-result: 1) [∀ (rest : ByteString),
    equalsByteString (appendByteString "ab" rest) "abc" = false]

end Upstream.ByteStrings
