import Seedelf.AnyTxSteps

/-! The other signatories in the `Signers…` modules' `#guard`s (gen-seedelf-signers.py writes
this file): `signerKey i` is 28 bytes, each `i`, for `i` from 1 to 128. No two are equal and
none is AnyTxSteps' `vkh0`, as the guards below check. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)

/-- 28 bytes, each `i`. -/
def signerKey (i : Nat) : ByteString := ⟨String.mk (List.replicate 28 (Char.ofNat i))⟩

/-- `signerKey 1` to `signerKey n`, as signatories. -/
def otherSigners (n : Nat) : List Data := (List.range n).map fun i => .B (signerKey (i + 1))

#guard (List.range 128).all fun i => (signerKey (i + 1)).data.length == 28
#guard (List.range 128).all fun i => signerKey (i + 1) != vkh0
#guard ((List.range 128).map fun i => signerKey (i + 1)).eraseDups.length == 128

end Seedelf.V1
