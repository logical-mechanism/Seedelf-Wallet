<!-- Comment on https://github.com/input-output-hk/Lean-blaster/issues/153 -->

Two PlutusCoreBlaster bytestring functions hit this on a symbolic input, with controls next to them that pass. It's what stands between us and the rest of a minting policy deployed on mainnet.

Lean 4.24.0, Z3 5.3.1, Lean-blaster `46c8479` (`beta-lambda-cache-optimization`, pinned by CardanoLedgerApiBlaster `9938562`), PlutusCoreBlaster `1c23de8`:

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

Each ❌ is `Inductive datatype with instance parameters not supported: `BitVec`. Whole bytestrings go to SMT strings fine; anything that looks at characters reaches `Char`, whose `val : UInt32` is a `BitVec 32` (so #67 and #69 too).

What it blocks for us, on [Seedelf](https://github.com/logical-mechanism/Seedelf-Wallet)'s deployed contracts, proving properties of the compiled UPLC:

- the minting policy (`84967d91…`) derives token names with `sliceByteString`, so neither its naming rule nor a successful burn can be proved over a symbolic name;
- the wallet validator (`94bca9c0…`) decodes its Schnorr scalar and challenge with `byteStringToInteger`. An `opaque` alias gets around that, input-output-hk/PlutusCoreBlaster#71 (as #27 did for `serialiseData`), and with it, #455, input-output-hk/PlutusCoreBlaster#72 and #73, the wallet's core property proves. A slice has no such way around: an alias loses what slicing means.

30 properties of the same scripts prove, so it's this gap, not the scripts' size. Is the `BitVec`/indexed-type support from your July note still on the way (we saw `feat/indexed-types`, last touched in June), and is there a branch we could run against? Our suite is a reproducible Lake package and we're glad to report back.
