import Lovejoin.V2.Mix
import Blaster

/-! A v2 Mix's boxes out carry well-formed inline `MixDatum`s, n = 2: `Constr 0 [B a, B b]`,
both 48 bytes, `a ≠ b`, as `decode_mix_datum_strict` requires. So every box the pool
pays out is one a key can later withdraw. The scenario is the KAT's Mix with the boxes'
datums given and everything else its own. No datum at all fails the same way: a concrete
run in `V2.Steps`. -/

namespace Lovejoin.V2
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- The KAT's two boxes out, with their datums' bytes given. -/
def datumArgs (a1 b1 a2 b2 : ByteString) : List Term :=
  [toTerm (outputsCtx (box a1 b1) (box a2 b2))]

/-- The KAT's Mix with one box out's datum by hash, `h`. -/
def boxByHash (h : ByteString) : TxOut :=
  boxOut (.ScriptCredential mixBoxHash) none 10000000 (.OutputDatumHash h) none

def hashFirstArgs (h : ByteString) : List Term := [toTerm (outputsCtx (boxByHash h) (box outA2 outB2))]
def hashSecondArgs (h : ByteString) : List Term := [toTerm (outputsCtx (box outA1 outB1) (boxByHash h))]

#prep_uplc appliedDatums mixLogicV2 datumArgs 30000
#prep_uplc appliedHashFirst mixLogicV2 hashFirstArgs 30000
#prep_uplc appliedHashSecond mixLogicV2 hashSecondArgs 30000

/-- A box out whose datum's bytes aren't a well-formed `MixDatum` fails the Mix. -/
theorem mix_boxes_carry_well_formed_datums : ∀ (a1 b1 a2 b2 : ByteString),
    (¬ (lengthOfByteString a1 = 48 ∧ lengthOfByteString b1 = 48 ∧ a1 ≠ b1) ∨
      ¬ (lengthOfByteString a2 = 48 ∧ lengthOfByteString b2 = 48 ∧ a2 ≠ b2)) →
      isUnsuccessful (appliedDatums.prop a1 b1 a2 b2) := by blaster

/-- A first box out with its datum by hash fails the Mix, whatever the hash. -/
theorem mix_first_box_datum_inline : ∀ (h : ByteString),
    isUnsuccessful (appliedHashFirst.prop h) := by blaster

/-- And a second. -/
theorem mix_second_box_datum_inline : ∀ (h : ByteString),
    isUnsuccessful (appliedHashSecond.prop h) := by blaster

end Lovejoin.V2
