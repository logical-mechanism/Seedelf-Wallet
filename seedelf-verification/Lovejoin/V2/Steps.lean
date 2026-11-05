import Lovejoin.V2.Logic
import Lovejoin.V2.MixSpec
import Lovejoin.Steps

/-! How many steps Blaster's CEK machine takes on concrete runs of v2 mix_logic, to size
the v2 modules' limits (see `Seedelf.Steps`).

- The KAT's Mix must halt: it's the passing run the Mix properties pair with (README
  rule 3), and it shows the scenario serialises the outputs as Lovejoin's prover did. Its
  first box a lovelace over must error, by the exact box-value rule.
- `outputsCtx` given the KAT's own fields must halt too: `MixOutputs`' and `MixDatums'`
  builder makes the KAT's outputs.
- A box out with no datum, first or second, must error.
- `mixAccepts` on the KAT's own proofs must be `true`: the spec computes the challenge as
  Lovejoin's prover did. With input 1's first `z` changed, the spec is `false` and the
  script errors.
- `MixFirst`'s first counterexample, every field of both proofs 32 zero bytes, must error
  with the spec `false`: it passed only by the solver's choice of the opaque functions.
- The Owner lines are `Lovejoin.Steps`' on v2: a real proof, made with the builtins' own
  implementations and bound to the same 9 ₳ payout, then the script and the spec on it,
  on a payout a lovelace more, and with z changed. -/

namespace Lovejoin.V2
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.Crypto.BLS12_381.G1
open PlutusCore.UPLC.BuiltinFunctions.Bitwise (byteStringToIntegerOpaque)
open Lovejoin.Classic (fsHashSchnorr q payout payout0 hexOf)
open Seedelf.V1 (stepsUsed g1)

def katBoxOut (a b : ByteString) : TxOut :=
  boxOut (.ScriptCredential mixBoxHash) none 10000000 (.OutputDatum (mixDatum a b)) none

def noDatumBox : TxOut := boxOut (.ScriptCredential mixBoxHash) none 10000000 .NoOutputDatum none

#eval s!"v2 mix_logic, Mix, the KAT:              {stepsUsed mixLogicV2 katMix 60000}"
#eval s!"v2 mix_logic, Mix, first box +1 lovelace: {stepsUsed mixLogicV2 (mixCtx katRedeemer (boxesOut 10000001 ++ [change])) 60000}"
#eval s!"v2 mix_logic, Mix, the builder on the KAT: {stepsUsed mixLogicV2 (outputsCtx (katBoxOut outA1 outB1) (katBoxOut outA2 outB2)) 60000}"
#eval s!"v2 mix_logic, Mix, first box no datum:   {stepsUsed mixLogicV2 (outputsCtx noDatumBox (katBoxOut outA2 outB2)) 60000}"
#eval s!"v2 mix_logic, Mix, second box no datum:  {stepsUsed mixLogicV2 (outputsCtx (katBoxOut outA1 outB1) noDatumBox) 60000}"

def zOne : ByteString := Seedelf.V1.ofHex "0000000000000000000000000000000000000000000000000000000000000001"

#eval s!"v2 mixAccepts, the KAT:                  {mixAccepts katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22}"
#eval s!"v2 mix_logic, Mix, z11 changed:          {stepsUsed mixLogicV2 (mixCtx (proofsRedeemer katT011 katT111 katC11 zOne katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22)) 60000}, spec {mixAccepts katT011 katT111 katC11 zOne katT012 katT112 katC12 katZ12 katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22}"

#eval s!"v2 mix_logic, Mix, every field zero:     {stepsUsed mixLogicV2 (mixCtx (proofsRedeemer zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32)) 60000}, spec {mixAccepts zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32 zero32}"

/-- A real Owner proof for the box `(g1, x·g1)` on v2: x = 0x5eed0e1f, nonce 0x1234567,
bound to `payout0`. Returns `(b, t, z)`. b and t are `Lovejoin.Steps`' (they don't depend
on the transaction); z differs, since v2's `ctx` hashes v2's mix_box and reference input. -/
def ownerVector : Option (ByteString × ByteString × ByteString) := do
  let G ← (bls12_381_G1_uncompress g1).toOption
  let x : Integer := 0x5eed0e1f
  let r : Integer := 0x1234567
  let b := bls12_381_G1_compress (bls12_381_G1_scalarMul x G)
  let t := bls12_381_G1_compress (bls12_381_G1_scalarMul r G)
  let ctx ← ownerContext (IsData.toData ([payout0] : List TxOut)) (Data.List [IsData.toData boxRef])
  let c := Int.fmod (.ofNat (byteStringToIntegerOpaque true (fsHashSchnorr g1 b t ctx).data)) q
  let z ← (PlutusCore.Bitwise.integerToByteString true 32 (Int.fmod (r + c * x) q)).toOption
  pure (b, t, ⟨z⟩)

#eval match ownerVector with
  | some (b, t, z) => s!"v2 owner vector: b {hexOf b} t {hexOf t} z {hexOf z}"
  | none => "v2 owner vector: none"
#eval match ownerVector with
  | some (b, t, z) => s!"v2 mix_logic, owner, valid:        {stepsUsed mixLogicV2 (ownerCtx g1 b t z payout0)}, spec {ownerAccepts g1 b t z payout0}"
  | none => "v2 owner vector: none"
#eval match ownerVector with
  | some (b, t, z) =>
      let other := payout (Seedelf.V1.ofHex "00112233445566778899aabbccddeeff00112233445566778899aabb") 9000001
      s!"v2 mix_logic, owner, other payout: {stepsUsed mixLogicV2 (ownerCtx g1 b t z other)}, spec {ownerAccepts g1 b t z other}"
  | none => "v2 owner vector: none"
#eval match ownerVector with
  | some (b, t, _) =>
      let z' := Seedelf.V1.ofHex "0000000000000000000000000000000000000000000000000000000000000001"
      s!"v2 mix_logic, owner, z changed:    {stepsUsed mixLogicV2 (ownerCtx g1 b t z' payout0)}, spec {ownerAccepts g1 b t z' payout0}"
  | none => "v2 owner vector: none"

end Lovejoin.V2
