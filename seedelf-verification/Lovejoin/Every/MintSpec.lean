import Lovejoin.Every.Mint

/-! # one_shot_mint's launch, from the program's root

one_shot_mint applied to the seed's transaction id and index, the reference holder's hash and
a minting context (`Constr 0 [B P]`, `P` its own policy), for any TxInfo and redeemer `Data`. -/

namespace Lovejoin.Every
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open PlutusCore.Data (Data)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term Const)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx.CekCase
open Lovejoin.Template.AnyTx (purposeCtx)

set_option maxHeartbeats 0

/-- The only name the policy mints, ASCII `lovejoin`, as the program holds it. -/
abbrev lovejoinName : ByteString := ⟨"lovejoin"⟩

theorem lovejoinName_shape : msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,
    0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,
    0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,1] = .Const (.ByteString lovejoinName) := rfl
theorem lovejoinName_eq : lovejoinName = Lovejoin.Template.nftName := rfl

/-- The found output's datum: inline, `Constr 0` of the eight fields typed `I, B, B, I, I, B, B, B`
(`refFields`, the reference datum's own decode). -/
def outDatum : Data → Option Data
  | .Constr _ (_ :: _ :: .Constr dt dfs :: _) =>
    if PlutusCore.Integer.equalsInteger 2 dt then
      match dfs with
      | .Constr xt xs :: _ =>
        if PlutusCore.Integer.equalsInteger 0 xt then refFields (.Constr xt xs) xs else none
      | _ => none
    else none
  | _ => none

/-- The reference datum's ranges: the box's ADA above 0, the fee above 0 and below it, and the
token either absent (empty policy and name, quantity 0) or a 28-byte policy, a name of at most
32 bytes and a quantity in `1 ..= 2^64 - 1`. -/
def launchDatumOk : Data → Bool
  | .Constr _ [.I bl, .B pol, .B tnm, .I tq, .I f4, _, _, _] =>
    PlutusCore.Integer.lessThanInteger 0 bl &&
    (PlutusCore.Integer.lessThanInteger 0 f4 &&
    (PlutusCore.Integer.lessThanInteger f4 bl &&
    (if PlutusCore.ByteString.equalsByteString ⟨""⟩ pol then
      PlutusCore.ByteString.equalsByteString ⟨""⟩ tnm && PlutusCore.Integer.equalsInteger 0 tq
    else
      PlutusCore.Integer.equalsInteger 28 (PlutusCore.ByteString.lengthOfByteString pol) &&
      (PlutusCore.Integer.lessThanEqualsInteger (PlutusCore.ByteString.lengthOfByteString tnm) 32 &&
      (PlutusCore.Integer.lessThanInteger 0 tq &&
        PlutusCore.Integer.lessThanEqualsInteger tq 18446744073709551615)))))
  | _ => false

/-- The conditions after the datum decodes to `x`: the seed spent (the TxInfo's first field, its
inputs), the name `lovejoin`, the quantity 1, then the datum's ranges. -/
def launchConds (seed : Data) (nm : ByteString) (v info x : Data) : Option Bool :=
  match info with
  | .Constr _ (.List ins :: _) =>
    match seedIn seed ins with
    | some true =>
      if PlutusCore.ByteString.equalsByteString lovejoinName nm then
        match v with
        | .I q => if PlutusCore.Integer.equalsInteger 1 q then some (launchDatumOk x) else some false
        | _ => none
      else some false
    | some false => some false
    | none => none
  | _ => none

/-- The check once the output `o` is found: its datum decoded, then `launchConds`. -/
def launchCheck (seed : Data) (nm : ByteString) (v o info : Data) : Option Bool :=
  match outDatum o with
  | some x => launchConds seed nm v info x
  | none => none

/-- The launch: the mint under `P` exactly one token, an output to the reference holder with
exactly one of it, then `launchCheck`. -/
def launchResult (seedTx : ByteString) (seedIx : Integer) (rh : ByteString) (info : Data) (P : ByteString) :
    Option Bool :=
  match info with
  | .Constr _ (_ :: _ :: i2 :: _ :: .Map mint :: _) =>
    match tokensOf P mint with
    | some [(.B nm, v)] =>
      match i2 with
      | .List outs =>
        match findOut rh P nm outs with
        | some (some o) => launchCheck (.Constr 0 [.B seedTx, .I seedIx]) nm v o info
        | _ => none
      | _ => none
    | _ => none
  | _ => none

/-- The check's region, once the output is found. -/
def checkTerm : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,
    0,0,0,0,0,0,0]
/-- The conditions' region, once the datum decodes. -/
def condsTerm : Term := msub [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,
    0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,
    0,0,0,0,0,1,0]

end Lovejoin.Every
