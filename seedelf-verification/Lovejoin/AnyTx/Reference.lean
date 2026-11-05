import Lovejoin.AnyTx.OwnerOne
import Blaster

/-! mix_logic's reference-NFT boundary on the one-box Owner layout, with arbitrary
outputs, input references and all uninspected transaction fields. These cases isolate
one or two reference inputs, not arbitrary-length reference lists. -/
namespace Lovejoin.AnyTx.Reference
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (returnsUnit)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Template (nftName)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.OwnerOne (Fields)

def candidate (Q name : ByteString) (qty : Integer) (od : Data) (f : Fields) : Data :=
  .Constr 0 [f.carrierRef, .Constr 0 [f.carrierAddr,
    .Map [(.B "", .Map [(.B "", .I 2000000)]), (.B Q, .Map [(.B name, .I qty)])],
    od, f.carrierScript]]

def datum (M : ByteString) : Data :=
  .Constr 2 [.Constr 0 [.I 10000000, .B "", .B "", .I 0, .I 800000, .B M, .B testL, .B testL]]

def build (P M a b t z key : ByteString) (f : Fields) (refs : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (ownerCtx f.tx
    (.List [boxIn f.boxRef M f.boxStake f.boxValue f.boxScript a b,
      otherIn f.keyRef 0 key f.keyStake f.keyValue f.keyDatum f.keyScript])
    (.List refs) f.sigs f.acct [proofData t z])]

def absentArgs (P M a b t z key : ByteString) (f : Fields) : List Term := build P M a b t z key f []
def foreignArgs (P M a b t z key Q : ByteString) (f : Fields) : List Term :=
  build P M a b t z key f [candidate Q nftName 1 (datum M) f]
def nameArgs (P M a b t z key name : ByteString) (f : Fields) : List Term :=
  build P M a b t z key f [candidate P name 1 (datum M) f]
def qtyArgs (P M a b t z key : ByteString) (qty : Integer) (f : Fields) : List Term :=
  build P M a b t z key f [candidate P nftName qty (datum M) f]
def datumArgs (P M a b t z key : ByteString) (od : Data) (f : Fields) : List Term :=
  build P M a b t z key f [candidate P nftName 1 od f]
def doubleArgs (P M a b t z key : ByteString) (f : Fields) (secondRef : Data) : List Term :=
  build P M a b t z key f [candidate P nftName 1 (datum M) f,
    candidate P nftName 1 (datum M) { f with carrierRef := secondRef }]

/-- A reference-script input with only ADA, before or after the pool carrier. -/
def otherBeforeArgs (P M a b t z key : ByteString) (f : Fields) (nref naddr nd nrs : Data) : List Term :=
  build P M a b t z key f [otherRef nref naddr (.Map [(.B "", .I 3000000)]) nd nrs,
    candidate P nftName 1 (datum M) f]
def otherAfterArgs (P M a b t z key : ByteString) (f : Fields) (nref naddr nd nrs : Data) : List Term :=
  build P M a b t z key f [candidate P nftName 1 (datum M) f,
    otherRef nref naddr (.Map [(.B "", .I 3000000)]) nd nrs]

#prep_uplc refAbsent mixLogicTemplate absentArgs 7000
#prep_uplc refForeign mixLogicTemplate foreignArgs 7000
#prep_uplc refName mixLogicTemplate nameArgs 7000
#prep_uplc refQty mixLogicTemplate qtyArgs 7000
#prep_uplc refDatum mixLogicTemplate datumArgs 7000
#prep_uplc refDouble mixLogicTemplate doubleArgs 7000
#prep_uplc refOtherBefore mixLogicTemplate otherBeforeArgs 12000
#prep_uplc refOtherAfter mixLogicTemplate otherAfterArgs 12000

theorem absent_fails (P M a b t z key : ByteString) (f : Fields) :
  isUnsuccessful (refAbsent.prop P M a b t z key f) := by blaster

theorem foreign_policy_fails (P M a b t z key Q : ByteString) (f : Fields) :
  Q ≠ P → isUnsuccessful (refForeign.prop P M a b t z key Q f) := by blaster

theorem wrong_name_fails (P M a b t z key name : ByteString) (f : Fields) :
  name ≠ nftName → isUnsuccessful (refName.prop P M a b t z key name f) := by blaster

theorem wrong_quantity_fails (P M a b t z key : ByteString) (qty : Integer) (f : Fields) :
  qty ≠ 1 → isUnsuccessful (refQty.prop P M a b t z key qty f) := by blaster

theorem no_datum_fails (P M a b t z key : ByteString) (f : Fields) :
  isUnsuccessful (refDatum.prop P M a b t z key (.Constr 0 []) f) := by blaster

theorem datum_hash_fails (P M a b t z key : ByteString) (hash : Data) (f : Fields) :
  isUnsuccessful (refDatum.prop P M a b t z key (.Constr 1 [hash]) f) := by blaster

theorem two_carriers_fail (P M a b t z key : ByteString) (f : Fields) (secondRef : Data) :
  isUnsuccessful (refDouble.prop P M a b t z key f secondRef) := by blaster

theorem other_before_preserves_proof (P M a b t z key : ByteString) (f : Fields) (nref naddr nd nrs : Data) :
  P ≠ "" → wellFormed a b = true → ownProof M f.tx.outputs [f.boxRef, f.keyRef] a b t z = true →
  returnsUnit (refOtherBefore.prop P M a b t z key f nref naddr nd nrs) := by blaster (timeout: 540)

theorem other_after_preserves_proof (P M a b t z key : ByteString) (f : Fields) (nref naddr nd nrs : Data) :
  P ≠ "" → wellFormed a b = true → ownProof M f.tx.outputs [f.boxRef, f.keyRef] a b t z = true →
  returnsUnit (refOtherAfter.prop P M a b t z key f nref naddr nd nrs) := by blaster (timeout: 540)

theorem other_before_needs_proof (P M a b t z key : ByteString) (f : Fields) (nref naddr nd nrs : Data) :
  wellFormed a b = true → ownProof M f.tx.outputs [f.boxRef, f.keyRef] a b t z = false →
  isUnsuccessful (refOtherBefore.prop P M a b t z key f nref naddr nd nrs) := by blaster (timeout: 540)

theorem other_after_needs_proof (P M a b t z key : ByteString) (f : Fields) (nref naddr nd nrs : Data) :
  wellFormed a b = true → ownProof M f.tx.outputs [f.boxRef, f.keyRef] a b t z = false →
  isUnsuccessful (refOtherAfter.prop P M a b t z key f nref naddr nd nrs) := by blaster (timeout: 540)

end Lovejoin.AnyTx.Reference
