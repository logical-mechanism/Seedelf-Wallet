import Lovejoin.AnyTx.MixTwo
import Blaster

/-! Two-box ADA Mix with the generalized inputs in `MixTwo`, varying either prefix
output. The Boolean chooses which output is changed. A key output follows the boxes. -/
namespace Lovejoin.AnyTx.MixOutputs
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.AnyTx.OwnerOne (Fields)
open Lovejoin.AnyTx.OwnerTwo (BoxFields)
open Lovejoin.AnyTx.MixTwo
open Lovejoin.V2.Any (boxValueAny)

def output (cred stake value datum script : Data) : Data :=
  .Constr 0 [.Constr 0 [cred, stake], value, datum, script]

def replaceOne (first : Bool) (bad good1 good2 tail : Data) : List Data :=
  if first then [bad, good2, tail] else [good1, bad, tail]

def valueArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (bad : Data) (first : Bool) : List Term :=
  let datum := if first then .Constr 2 [.Constr 0 [.B oa1, .B ob1]] else .Constr 2 [.Constr 0 [.B oa2, .B ob2]]
  let wrong := output (.Constr 1 [.B M]) (.Constr 1 []) bad datum (.Constr 1 [])
  argsWithOutputs P M bl a1 b1 a2 b2 key f b
    (replaceOne first wrong (boxOut M bl oa1 ob1) (boxOut M bl oa2 ob2) (keyOut o)) p

def credentialArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (c : ByteString) (first : Bool) : List Term :=
  let datum := if first then .Constr 2 [.Constr 0 [.B oa1, .B ob1]] else .Constr 2 [.Constr 0 [.B oa2, .B ob2]]
  let wrong := output (.Constr 1 [.B c]) (.Constr 1 []) (boxValueAny bl) datum (.Constr 1 [])
  argsWithOutputs P M bl a1 b1 a2 b2 key f b
    (replaceOne first wrong (boxOut M bl oa1 ob1) (boxOut M bl oa2 ob2) (keyOut o)) p

def datumArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (datum : Data) (first : Bool) : List Term :=
  let wrong := output (.Constr 1 [.B M]) (.Constr 1 []) (boxValueAny bl) datum (.Constr 1 [])
  argsWithOutputs P M bl a1 b1 a2 b2 key f b
    (replaceOne first wrong (boxOut M bl oa1 ob1) (boxOut M bl oa2 ob2) (keyOut o)) p

def stakeArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (stake : Data) (first : Bool) : List Term :=
  let datum := if first then .Constr 2 [.Constr 0 [.B oa1, .B ob1]] else .Constr 2 [.Constr 0 [.B oa2, .B ob2]]
  let wrong := output (.Constr 1 [.B M]) (.Constr 0 [stake]) (boxValueAny bl) datum (.Constr 1 [])
  argsWithOutputs P M bl a1 b1 a2 b2 key f b
    (replaceOne first wrong (boxOut M bl oa1 ob1) (boxOut M bl oa2 ob2) (keyOut o)) p

def scriptArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (script : Data) (first : Bool) : List Term :=
  let datum := if first then .Constr 2 [.Constr 0 [.B oa1, .B ob1]] else .Constr 2 [.Constr 0 [.B oa2, .B ob2]]
  let wrong := output (.Constr 1 [.B M]) (.Constr 1 []) (boxValueAny bl) datum (.Constr 0 [script])
  argsWithOutputs P M bl a1 b1 a2 b2 key f b
    (replaceOne first wrong (boxOut M bl oa1 ob1) (boxOut M bl oa2 ob2) (keyOut o)) p

def keyCredentialArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (c : ByteString) (first : Bool) : List Term :=
  let datum := if first then .Constr 2 [.Constr 0 [.B oa1, .B ob1]] else .Constr 2 [.Constr 0 [.B oa2, .B ob2]]
  let wrong := output (.Constr 0 [.B c]) (.Constr 1 []) (boxValueAny bl) datum (.Constr 1 [])
  argsWithOutputs P M bl a1 b1 a2 b2 key f b
    (replaceOne first wrong (boxOut M bl oa1 ob1) (boxOut M bl oa2 ob2) (keyOut o)) p

def extraArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key xa xb : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) : List Term :=
  argsWithOutputs P M bl a1 b1 a2 b2 key f b
    [boxOut M bl oa1 ob1, boxOut M bl oa2 ob2, boxOut M bl xa xb, keyOut o] p

#prep_uplc mixBadValue mixLogicTemplate valueArgs 30000
#prep_uplc mixBadCredential mixLogicTemplate credentialArgs 30000
#prep_uplc mixBadDatum mixLogicTemplate datumArgs 30000
#prep_uplc mixBadStake mixLogicTemplate stakeArgs 30000
#prep_uplc mixBadReference mixLogicTemplate scriptArgs 30000
#prep_uplc mixBadKey mixLogicTemplate keyCredentialArgs 30000
#prep_uplc mixExtraBox mixLogicTemplate extraArgs 35000

theorem wrong_value (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (bad : Data) (first : Bool) :
    bad ≠ boxValueAny bl →
    isUnsuccessful (mixBadValue.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p bad first) := by blaster (timeout: 540)

theorem wrong_script (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (c : ByteString) (first : Bool) :
    c ≠ M → isUnsuccessful (mixBadCredential.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p c first) := by blaster (timeout: 540)

theorem missing_datum (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (first : Bool) :
    isUnsuccessful (mixBadDatum.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p (.Constr 0 []) first) := by blaster (timeout: 540)

theorem hashed_datum (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (hash : Data) (first : Bool) :
    isUnsuccessful (mixBadDatum.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p (.Constr 1 [hash]) first) := by blaster (timeout: 540)

theorem stake_part_forbidden (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (stake : Data) (first : Bool) :
    isUnsuccessful (mixBadStake.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p stake first) := by blaster (timeout: 540)

theorem reference_script_forbidden (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (script : Data) (first : Bool) :
    isUnsuccessful (mixBadReference.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p script first) := by blaster (timeout: 540)

theorem key_credential_forbidden (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) (c : ByteString) (first : Bool) :
    isUnsuccessful (mixBadKey.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key f b o p c first) := by blaster (timeout: 540)

theorem extra_box_forbidden (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 key xa xb : ByteString)
    (f : Fields) (b : BoxFields) (o : Tail) (p : Proof) :
    isUnsuccessful (mixExtraBox.prop P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 key xa xb f b o p) := by blaster (timeout: 540)

end Lovejoin.AnyTx.MixOutputs
