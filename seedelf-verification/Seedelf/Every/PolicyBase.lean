import Seedelf.Every.Base
import Seedelf.LinesAllAnyMint

/-! # The policy in every transaction: what its modules share

The policy (84967d91…) as compiled (`aiken uplc decode`, `pseudo.py`): a mint, its redeemer a
bytestring `tag`, the mint flattened (`LinesAllLoops`' `flatPairs`), then two checks that both
always run, as the xor's strict arguments:
- the burn (`burnOpt`): exactly one line, the policy's own, a name starting `5eed0e1f`, amount -1;
- the mint (`mintOpt`): exactly one line, the policy's own, the name `token_name.generate` makes
  of the first input and the tag, amount 1.
The answer is their xor. Either check's error is the program's: `consByteString` refuses a first
input past #255, so a burn off such an input fails too (README, *Found along the way*).

The slices are PlutusCoreBlaster's own `sliceByteString`, not an alias: the kernel never decides
anything about a slice, it carries it. -/

namespace Seedelf.Every
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString appendByteString sliceByteString equalsByteString consByteStringV2)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open Seedelf.V1.LinesAll

/-- The policy as deployed, its seed applied. -/
def pBody : Term := Seedelf.V1.LinesAll.policyBody

/-- The subterm at a path, in the policy. -/
def psub (p : List Nat) : Term := subterm pBody p

/-- The burn check, the xor's first argument (`let i_19 …`), over levels i_16 to i_0. -/
def burnBody : Term :=
  psub [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1]

/-- The mint check, its second (`let i_24 …`), over the same levels. -/
def mintBody : Term :=
  psub [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1]

/-! ### The spec -/

/-- The mint's one line, its fields: the TxInfo's field 4 a map whose flattening is exactly one
line, a `List`. Anything else is an error. -/
def lineFields (info : Data) : Option (List Data) :=
  match info with
  | .Constr _ (_ :: _ :: _ :: _ :: .Map ps :: _) =>
    match flatPairs ps with
    | some [.List l] => some l
    | _ => none
  | _ => none

/-- The burn: the line `[B pid, B tkn, I amt, …]`, else an error; then pid is the policy's own,
the name starts `5eed0e1f`, and the amount is -1. -/
def burnOpt (info : Data) (own : ByteString) : Option Bool :=
  match lineFields info with
  | some (.B pid :: .B tkn :: .I amt :: _) =>
    some (if equalsByteString pid own then
      (if equalsByteString (sliceByteString 0 4 tkn) Seedelf.V1.seedelfPrefix then
        PlutusCore.Integer.equalsInteger amt (-1) else false) else false)
  | _ => none

/-- `token_name.generate` as the bytes build it: `5eed0e1f ‖ tag[0..14] ‖ (idx ⊳ txid)`, its first
32 bytes, `c` being `consByteString idx txid`. -/
def tokenName (tag c : ByteString) : ByteString :=
  sliceByteString 0 32 (appendByteString (appendByteString Seedelf.V1.seedelfPrefix (sliceByteString 0 15 tag)) c)

/-- The mint: the inputs a list, the line as for the burn, the first input's reference
`Constr _ [B txid, I idx, …]` (else an error), `consByteString idx txid` (an error past a byte);
then pid is the policy's own, the name is `tokenName`, and the amount is 1. -/
def mintOpt (info : Data) (own tag : ByteString) : Option Bool :=
  match info with
  | .Constr _ (.List ins :: _) =>
    match lineFields info, ins with
    | some (.B pid :: .B tkn :: .I amt :: _), .Constr _ (.Constr _ (.B txid :: .I idx :: _) :: _) :: _ =>
      match consByteStringV2 idx txid with
      | .ok c => some (if equalsByteString own pid then
          (if equalsByteString (tokenName tag c) tkn then PlutusCore.Integer.equalsInteger 1 amt else false)
          else false)
      | .error _ => none
    | _, _ => none
  | _ => none

/-! ### Builtins at a result the proof has cased on -/

theorem ap_eqBS (a b : ByteString) (r : Bool) (h : equalsByteString a b = r) :
    Ap default (.VBuiltin .EqualsByteString [.VCon (.ByteString a)] (.One .ArgV)) (.VCon (.ByteString b))
      (some (.VCon (.Bool r))) := by
  subst h
  exact ap_builtin rfl

theorem ap_eqInt (a b : Integer) (r : Bool) (h : PlutusCore.Integer.equalsInteger a b = r) :
    Ap default (.VBuiltin .EqualsInteger [.VCon (.Integer a)] (.One .ArgV)) (.VCon (.Integer b))
      (some (.VCon (.Bool r))) := by
  subst h
  exact ap_builtin rfl

theorem ap_cons_ok (n : Integer) (bs c : ByteString) (h : consByteStringV2 n bs = .ok c) :
    Ap default (.VBuiltin .ConsByteString [.VCon (.Integer n)] (.One .ArgV)) (.VCon (.ByteString bs))
      (some (.VCon (.ByteString c))) := by
  apply ap_builtin
  simp [PlutusCore.UPLC.BuiltinFunctions.Evaluate.evaluateBuiltinFunction,
    PlutusCore.UPLC.BuiltinFunctions.ByteString.consByteString, h,
    PlutusCore.UPLC.BuiltinFunctions.Utils.tryCatchSome]

theorem ap_cons_err (n : Integer) (bs : ByteString) (e : String) (h : consByteStringV2 n bs = .error e) :
    Ap default (.VBuiltin .ConsByteString [.VCon (.Integer n)] (.One .ArgV)) (.VCon (.ByteString bs)) none := by
  apply ap_builtin
  simp [PlutusCore.UPLC.BuiltinFunctions.Evaluate.evaluateBuiltinFunction,
    PlutusCore.UPLC.BuiltinFunctions.ByteString.consByteString, h,
    PlutusCore.UPLC.BuiltinFunctions.Utils.tryCatchSome]

end Seedelf.Every
