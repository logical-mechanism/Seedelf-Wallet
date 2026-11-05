<!-- Comment on https://github.com/input-output-hk/Lean-blaster/issues/153 -->

The rejection is still on `main` after #155 (`02c9566`, `Blaster/Smt/Translate/Quantifier.lean:941`). Two more PlutusCoreBlaster bytestring functions reach it on a symbolic input, with passing controls next to them.

Run on Lean 4.24.0, Z3 5.3.1, Lean-blaster `46c8479` (`beta-lambda-cache-optimization`, pinned by CardanoLedgerApiBlaster `9938562`), PlutusCoreBlaster `1c23de8`:

```lean
import Blaster
import PlutusCore
open PlutusCore.ByteString
open PlutusCore.Bitwise

-- Controls ✅
theorem append_right_empty : ∀ (a b : ByteString),
    appendByteString a b = a → b = emptyByteString := by blaster                     -- ✅ Valid
#blaster (solve-result: 1) [∀ (rest : ByteString),
    equalsByteString (appendByteString "ab" rest) "abc" = false]                       -- ✅ Expected Falsified (rest = "c")
theorem cons_front : ∀ (n : Nat) (bs : ByteString),
    n < 256 → (ByteString.cons n.toUInt8 bs).data.front.toNat = n := by blaster        -- ✅ Valid

-- byteStringToInteger (CIP-121): bstoi_be_loop folds Char.toNat
#blaster (solve-result: 1) [∀ (s : String), byteStringToInteger true s ≠ 258]          -- ❌ BitVec

-- sliceByteString: take/drop on the List Char
theorem slice_known_prefix : ∀ (rest : ByteString),
    sliceByteString 0 2 (appendByteString "ab" rest) = "ab" := by blaster              -- ❌ BitVec
#blaster (solve-result: 1) [∀ (rest : ByteString),
    sliceByteString 0 3 (appendByteString "ab" rest) ≠ "abc"]                          -- ❌ BitVec
theorem slice_length : ∀ (bs : ByteString),
    lengthOfByteString (sliceByteString 0 4 bs) ≤ 4 := by blaster                      -- ❌ BitVec
```

Each ❌ is `Inductive datatype with instance parameters not supported: `BitVec``. Whole bytestrings translate to SMT strings fine. Anything that looks at characters reaches `Char`, whose `val : UInt32` is a `BitVec 32` (so #67 and #69 too).

For us it's the last gap in proving [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet)'s deployed scripts from their compiled UPLC. An `opaque` alias gets around `byteStringToInteger` (input-output-hk/PlutusCoreBlaster#71, as #27 did for `serialiseData`), but an alias only proves a rule for every interpretation of the builtin, not for PlutusCore's own definition. With this fixed, the minting policy's token-name rule could be proved over the real `sliceByteString`, and we could drop the aliases.

Is the `BitVec`/indexed-type support from your July note still planned? We saw `feat/indexed-types`, last touched June 21. If there's a branch to try, our suite is a reproducible Lake package and we'll report back.
