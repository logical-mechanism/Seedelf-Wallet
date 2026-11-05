import Audit.Gaps.V2.GapOwn
import Lovejoin.V2.OwnAny1Steps

/-! `V2.GapOwn`'s withdrawals, concretely, on mix_logic's template at the test launch, with
honest proofs made as `V2.OwnAny1Steps` makes them (box i is `(g1, x·g1)`, x = 0x5eed0e1f + i):
`solo` and `first` must halt with the spec `true`, and `solo` with z changed must error with
the spec `false`; `twoOne`, two honest boxes and box 1's proof alone, must error. Aiken's
evaluator agrees on the same bytes and contexts (the audit's `run_owner_exact.py`). -/

namespace Lovejoin.V2.OwnGap
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Crypto.BLS12_381.G1
open Seedelf.V1 (g1 ofHex)
open Lovejoin.Template (stepsWith nftName)
open Lovejoin.V2.Own1 (prove kP kS kG kU zOneOwn)
open Lovejoin.Classic (wellFormed)

def gapAmt : Integer := 9500000

/-- Box 1's point and an honest proof bound to `ctx`, and box 2's point. -/
def honestFor (ctx : Option ByteString) : Option (List ByteString) := do
  let G ← (bls12_381_G1_uncompress g1).toOption
  let b1 := bls12_381_G1_compress (bls12_381_G1_scalarMul (0x5eed0e1f + 1) G)
  let b2 := bls12_381_G1_compress (bls12_381_G1_scalarMul (0x5eed0e1f + 2) G)
  let c ← ctx
  let (t1, z1) ← prove (0x5eed0e1f + 1) (0x1234567 + 1) b1 c
  pure [b1, t1, z1, b2]

def gapRun (ctx : ScriptContext) : String :=
  stepsWith mixLogicTemplate [toTerm nftPolicy, toTerm nftName] ctx 60000

#eval match honestFor (soloHash mixBoxHash kS kG kU gapAmt) with
  | some [b1, t1, z1, _] => s!"gap own, solo, honest:        {gapRun (soloCtx nftPolicy mixBoxHash g1 b1 t1 z1 kS kG kU gapAmt)}, spec {wellFormed g1 b1 && soloProof mixBoxHash kS kG kU gapAmt g1 b1 t1 z1}"
  | _ => "gap own: no honest proof"

#eval match honestFor (soloHash mixBoxHash kS kG kU gapAmt) with
  | some [b1, t1, _, _] => s!"gap own, solo, z changed:     {gapRun (soloCtx nftPolicy mixBoxHash g1 b1 t1 zOneOwn kS kG kU gapAmt)}, spec {wellFormed g1 b1 && soloProof mixBoxHash kS kG kU gapAmt g1 b1 t1 zOneOwn}"
  | _ => "gap own: no honest proof"

#eval match honestFor (firstHash mixBoxHash kS kG kU gapAmt) with
  | some [b1, t1, z1, _] => s!"gap own, first, a payer key:  {gapRun (firstCtx nftPolicy mixBoxHash g1 b1 t1 z1 (.PubKeyCredential kP) 3000000 kS kG kU gapAmt)}, spec {wellFormed g1 b1 && firstProof mixBoxHash kS kG kU gapAmt g1 b1 t1 z1}"
  | _ => "gap own: no honest proof"

#eval match honestFor (firstHash mixBoxHash kS kG kU gapAmt) with
  | some [b1, t1, z1, _] => s!"gap own, first, at mix_box:   {gapRun (firstCtx nftPolicy mixBoxHash g1 b1 t1 z1 (.ScriptCredential mixBoxHash) 1500000 kS kG kU gapAmt)}, spec {wellFormed g1 b1 && firstProof mixBoxHash kS kG kU gapAmt g1 b1 t1 z1}"
  | _ => "gap own: no honest proof"

#eval match honestFor (soloHash mixBoxHash kS kG kU gapAmt) with
  | some [b1, t1, z1, b2] => s!"gap own, two boxes, 1 proof:  {gapRun (twoOneCtx nftPolicy mixBoxHash g1 b1 g1 b2 t1 z1 kS kG kU gapAmt)}"
  | _ => "gap own: no honest proof"

end Lovejoin.V2.OwnGap
