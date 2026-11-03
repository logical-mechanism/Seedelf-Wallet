import Lovejoin.V2.Mix
import Blaster

/-! No value leaves the pool in a v2 Mix, n = 2: its two boxes out are each at mix_box,
with no stake credential or reference script, and hold exactly the box value. The scenario
is the KAT's Mix with the field in question symbolic and everything else its own,
including the proofs. A Mix that pays otherwise errors, whatever the proofs say.

That's one direction, so the crypto stays opaque and unread. The boxes' datums are
`MixDatums`'. The step limit sits above the KAT's run in `V2.Steps`, where the same
builder, given the KAT's own fields, halts. -/

namespace Lovejoin.V2
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- The KAT's two boxes out, with their addresses and reference scripts given. -/
def addressArgs (c1 c2 : Credential) (s1 s2 : Option StakingCredential) (r1 r2 : Option ByteString) : List Term :=
  [toTerm (outputsCtx (boxOut c1 s1 10000000 (.OutputDatum (mixDatum outA1 outB1)) r1)
                      (boxOut c2 s2 10000000 (.OutputDatum (mixDatum outA2 outB2)) r2))]

/-- The KAT's two boxes out, with their lovelace given. -/
def amountArgs (n1 n2 : Integer) : List Term :=
  [toTerm (outputsCtx (boxOut (.ScriptCredential mixBoxHash) none n1 (.OutputDatum (mixDatum outA1 outB1)) none)
                      (boxOut (.ScriptCredential mixBoxHash) none n2 (.OutputDatum (mixDatum outA2 outB2)) none))]

/-- A box out holding 10 ₳ and `qty` of the token `(p, nm)` too. -/
def tokenBox (a b p nm : ByteString) (qty : Integer) : TxOut :=
  ⟨⟨.ScriptCredential mixBoxHash, none⟩,
   [(Data.B "", Data.Map [(Data.B "", Data.I 10000000)]), (Data.B p, Data.Map [(Data.B nm, Data.I qty)])],
   .OutputDatum (mixDatum a b), none⟩

def tokenFirstArgs (p nm : ByteString) (qty : Integer) : List Term :=
  [toTerm (outputsCtx (tokenBox outA1 outB1 p nm qty) (box outA2 outB2))]

def tokenSecondArgs (p nm : ByteString) (qty : Integer) : List Term :=
  [toTerm (outputsCtx (box outA1 outB1) (tokenBox outA2 outB2 p nm qty))]

#prep_uplc appliedAddress mixLogic addressArgs 30000
#prep_uplc appliedAmount mixLogic amountArgs 30000
#prep_uplc appliedTokenFirst mixLogic tokenFirstArgs 30000
#prep_uplc appliedTokenSecond mixLogic tokenSecondArgs 30000

/-- A box out anywhere but mix_box, or with a stake credential or a reference script,
fails the Mix: a key's address, another script's, mix_box's with a stake part. -/
theorem mix_pays_its_boxes_to_mix_box : ∀ (c1 c2 : Credential) (s1 s2 : Option StakingCredential)
    (r1 r2 : Option ByteString),
    (c1 ≠ .ScriptCredential mixBoxHash ∨ s1 ≠ none ∨ r1 ≠ none ∨
      c2 ≠ .ScriptCredential mixBoxHash ∨ s2 ≠ none ∨ r2 ≠ none) →
      isUnsuccessful (appliedAddress.prop c1 c2 s1 s2 r1 r2) := by blaster

/-- A box out holding anything but the box value in lovelace fails the Mix. -/
theorem mix_boxes_hold_the_box_value : ∀ (n1 n2 : Integer),
    (n1 ≠ 10000000 ∨ n2 ≠ 10000000) → isUnsuccessful (appliedAmount.prop n1 n2) := by blaster

/-- So does a first box out holding any token beside its 10 ₳. -/
theorem mix_first_box_holds_no_token : ∀ (p nm : ByteString) (qty : Integer),
    isUnsuccessful (appliedTokenFirst.prop p nm qty) := by blaster

/-- And a second. -/
theorem mix_second_box_holds_no_token : ∀ (p nm : ByteString) (qty : Integer),
    isUnsuccessful (appliedTokenSecond.prop p nm qty) := by blaster

end Lovejoin.V2
