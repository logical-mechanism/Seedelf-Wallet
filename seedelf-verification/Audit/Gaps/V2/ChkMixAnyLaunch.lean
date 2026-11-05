import Lovejoin.V2.MixAnySpec
import Lovejoin.Template.Steps

/-! Audit check (mix-scenario-shape, not part of the suite): `V2.MixAny`'s Mix with the rest
of the pool's launch symbolic too. `V2.MixAny` fixes the reference datum's fee cap and its
mix_logic and fee_contract hashes at the test launch's (800000, `6666…`, `7777…`), and the
reference UTxO's 2 ₳ and holder `cdcd…`; a real v2 launch has its own. Here they are `fc`,
`hl`, `hf`, `rv` and `rh`. At the test launch's values this is `mixCtxAny`
(`chkLaunchCtx_is_the_mix`, by `rfl`). Aiken's evaluator on 60294352… gives the KAT the same
cost at both launches below (2,745,703,846 CPU), so both runs must halt after 11497 steps. -/

namespace Lovejoin.V2.Any
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open Seedelf.V1 (emptyTx ofHex)
open Lovejoin.Template (nftName stepsWith)

/-- An ADA pool's `ReferenceDatum`, every field a parameter but the (absent) token. -/
def chkRefDatum (bl : Integer) (M : ByteString) (fc : Integer) (hl hf : ByteString) : Data :=
  .Constr 0 [.I bl, .B "", .B "", .I 0, .I fc, .B M, .B hl, .B hf]

/-- The pool's reference UTxO: `rv` lovelace and its NFT `(P, lovejoin)` at `rh`. -/
def chkRefInput (P : ByteString) (bl : Integer) (M : ByteString) (fc rv : Integer) (hl hf rh : ByteString) : TxInInfo :=
  ⟨⟨ofHex "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 0⟩,
   ⟨⟨.ScriptCredential rh, none⟩,
    [(Data.B "", Data.Map [(Data.B "", Data.I rv)]), (Data.B P, Data.Map [(Data.B nftName, Data.I 1)])],
    .OutputDatum (chkRefDatum bl M fc hl hf), none⟩⟩

/-- `mixCtxAny`'s Mix, reading `chkRefInput`. -/
def chkLaunchCtx (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString)
    (fc rv : Integer) (hl hf rh : ByteString) (redeemer : Data) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨⟨ofHex "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", 0⟩, boxAny M bl a1 b1⟩,
                              ⟨⟨ofHex "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", 0⟩, boxAny M bl a2 b2⟩],
    txInfoReferenceInputs := [chkRefInput P bl M fc rv hl hf rh],
    txInfoOutputs         := [boxAny M bl oa1 ob1, boxAny M bl oa2 ob2, change],
    txInfoFee             := 200000,
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, redeemer, .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- At the test launch's values it is the scenario's Mix. -/
theorem chkLaunchCtx_is_the_mix (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 : ByteString) (redeemer : Data) :
    chkLaunchCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 800000 2000000 mixLogicHash feeHash referenceHolderHash redeemer =
      mixCtxAny P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 redeemer := rfl

/-- mix_logic's template's arguments: the pool's NFT, then the Mix. -/
def chkLaunchArgs (P M : ByteString) (bl : Integer) (a1 b1 a2 b2 oa1 ob1 oa2 ob2 t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22 : ByteString)
    (fc rv : Integer) (hl hf rh : ByteString) : List Term :=
  [toTerm P, toTerm nftName, toTerm (chkLaunchCtx P M bl a1 b1 a2 b2 oa1 ob1 oa2 ob2 fc rv hl hf rh
    (proofsRedeemer t011 t111 c11 z11 t012 t112 c12 z12 t021 t121 c21 z21 t022 t122 c22 z22))]

/-- Another launch's values: a 1 ₳ fee cap, other hashes, 3 ₳ at another holder. -/
def chkHl : ByteString := ofHex "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
def chkHf : ByteString := ofHex "cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
def chkRh : ByteString := ofHex "dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

def chkLaunch := [toTerm nftPolicy, toTerm nftName]

#eval s!"chk launch, the KAT at the test launch:  {stepsWith mixLogicTemplate chkLaunch (chkLaunchCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 800000 2000000 mixLogicHash feeHash referenceHolderHash katRedeemer) 30000}"
#eval s!"chk launch, the KAT at another launch:   {stepsWith mixLogicTemplate chkLaunch (chkLaunchCtx nftPolicy mixBoxHash 10000000 inA1 inB1 inA2 inB2 outA1 outB1 outA2 outB2 1000000 3000000 chkHl chkHf chkRh katRedeemer) 30000}"

end Lovejoin.V2.Any
