import Lovejoin.Template.Scripts
import Lovejoin.Template.Launch
import Lovejoin.Scripts
import Seedelf.AnyTx
import Blaster

/-! Lovejoin v2's scripts outside their own handlers, and reference_holder, in every transaction.
Each purpose test reads only the purpose's tag, and publish reads only the certificate's tag
(v2's bytes, `aiken uplc decode`). So here the TxInfo and the redeemer are each one `Data`,
any value at all, and so is each purpose's payload. Every parameter is symbolic, as in the other
Template modules, so each theorem holds for every pool on v2's templates.

- mix_logic (7fb45b75…) publishes exactly a registration, `Constr 0 _` (any credential, any
  deposit), whatever the transaction. Every other certificate errors, an unregistration included,
  which the source says "would brick the protocol". Its other purposes error too: minting,
  spending, voting and proposing.
- mix_box (2365a62d…) is spend only, and one_shot_mint (6878ed6f…) mint only.
- reference_holder (288fea77…) errors on every input there is, so the pool's NFT and its datum
  never leave it.

Limits as `Template.MixBoxPurpose` and the audit's purpose modules: 500 for mix_box and
reference_holder, 1000 for mix_logic and one_shot_mint. -/

namespace Lovejoin.Template.AnyTx
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.PlutusScript (PlutusScript)
open PlutusCore.UPLC.Utils
open Lovejoin.Template (nftName)
open Seedelf.V1 (ofHex returnsUnit spendIn)

/-- A context in the transaction `info` with the redeemer `red` and the purpose `Constr k fs`. -/
def purposeCtx (k : Integer) (info red : Data) (fs : List Data) : Data :=
  .Constr 0 [info, red, .Constr k fs]

-- The builder makes real contexts (README rule 3): at the spending tag it's a spend.
example (info red ref d : Data) : purposeCtx 1 info red [ref, d] = spendIn info red ref d := rfl

/-! ### mix_logic -/

/-- mix_logic's template at the pool's NFT policy `P`, in a context with the purpose `Constr k fs`. -/
def logicPurposeArgs (k : Integer) (P : ByteString) (info red : Data) (fs : List Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (purposeCtx k info red fs)]

-- The V3 purposes mix_logic has no handler for, by their tags (2, rewarding, is its withdraw).
def logicMintingAnyTxArgs := logicPurposeArgs 0
def logicSpendingAnyTxArgs := logicPurposeArgs 1
def logicVotingAnyTxArgs := logicPurposeArgs 4
def logicProposingAnyTxArgs := logicPurposeArgs 5

/-- mix_logic's template at `P`, publishing the certificate `cert` (at index `idx`). -/
def logicPublishAnyTxArgs (P : ByteString) (info red : Data) (idx : Integer) (cert : Data) : List Term :=
  [toTerm P, toTerm nftName, toTerm (Data.Constr 0 [info, red, .Constr 3 [.I idx, cert]])]

/-- A certificate whose constructor is 0: V3's `TxCertRegStaking`, a registration. -/
def isRegistrationData : Data → Bool
  | .Constr 0 _ => true
  | _ => false

#prep_uplc appliedLogicMintingAnyTx mixLogicTemplate logicMintingAnyTxArgs 1000
#prep_uplc appliedLogicSpendingAnyTx mixLogicTemplate logicSpendingAnyTxArgs 1000
#prep_uplc appliedLogicVotingAnyTx mixLogicTemplate logicVotingAnyTxArgs 1000
#prep_uplc appliedLogicProposingAnyTx mixLogicTemplate logicProposingAnyTxArgs 1000
#prep_uplc appliedLogicPublishAnyTx mixLogicTemplate logicPublishAnyTxArgs 1000

theorem v2_mix_logic_fails_minting_any_tx : ∀ P info red fs,
    isUnsuccessful (appliedLogicMintingAnyTx.prop P info red fs) := by blaster
theorem v2_mix_logic_fails_spending_any_tx : ∀ P info red fs,
    isUnsuccessful (appliedLogicSpendingAnyTx.prop P info red fs) := by blaster
theorem v2_mix_logic_fails_voting_any_tx : ∀ P info red fs,
    isUnsuccessful (appliedLogicVotingAnyTx.prop P info red fs) := by blaster
theorem v2_mix_logic_fails_proposing_any_tx : ∀ P info red fs,
    isUnsuccessful (appliedLogicProposingAnyTx.prop P info red fs) := by blaster

/-- In every transaction, mix_logic publishes iff the certificate is a registration, and then it
returns unit. -/
theorem v2_mix_logic_publishes_iff_registration_any_tx : ∀ P info red idx cert,
    returnsUnit (appliedLogicPublishAnyTx.prop P info red idx cert) ↔ isRegistrationData cert = true := by
  blaster

/-- Every other certificate reaches `Error`: unregistration, delegation, a pool's, a DRep's. -/
theorem v2_mix_logic_refuses_other_certificates_any_tx : ∀ P info red idx cert,
    isRegistrationData cert = false → isUnsuccessful (appliedLogicPublishAnyTx.prop P info red idx cert) := by
  blaster

/-! ### mix_box and one_shot_mint -/

/-- mix_box's template at the pool's mix_logic hash `L`, in a context with the purpose `Constr k fs`. -/
def boxPurposeArgs (k : Integer) (L : ByteString) (info red : Data) (fs : List Data) : List Term :=
  [toTerm L, toTerm (purposeCtx k info red fs)]

def boxMintingAnyTxArgs := boxPurposeArgs 0
def boxRewardingAnyTxArgs := boxPurposeArgs 2
def boxCertifyingAnyTxArgs := boxPurposeArgs 3
def boxVotingAnyTxArgs := boxPurposeArgs 4
def boxProposingAnyTxArgs := boxPurposeArgs 5

#prep_uplc appliedBoxMintingAnyTx mixBoxTemplate boxMintingAnyTxArgs 500
#prep_uplc appliedBoxRewardingAnyTx mixBoxTemplate boxRewardingAnyTxArgs 500
#prep_uplc appliedBoxCertifyingAnyTx mixBoxTemplate boxCertifyingAnyTxArgs 500
#prep_uplc appliedBoxVotingAnyTx mixBoxTemplate boxVotingAnyTxArgs 500
#prep_uplc appliedBoxProposingAnyTx mixBoxTemplate boxProposingAnyTxArgs 500

theorem mix_box_fails_minting_any_tx : ∀ L info red fs, isUnsuccessful (appliedBoxMintingAnyTx.prop L info red fs) := by blaster
theorem mix_box_fails_rewarding_any_tx : ∀ L info red fs, isUnsuccessful (appliedBoxRewardingAnyTx.prop L info red fs) := by blaster
theorem mix_box_fails_certifying_any_tx : ∀ L info red fs, isUnsuccessful (appliedBoxCertifyingAnyTx.prop L info red fs) := by blaster
theorem mix_box_fails_voting_any_tx : ∀ L info red fs, isUnsuccessful (appliedBoxVotingAnyTx.prop L info red fs) := by blaster
theorem mix_box_fails_proposing_any_tx : ∀ L info red fs, isUnsuccessful (appliedBoxProposingAnyTx.prop L info red fs) := by blaster

/-- one_shot_mint's template at a launch's seed `s#i` and reference_holder `rh`, in a context
with the purpose `Constr k fs`. -/
def osmPurposeArgs (k : Integer) (s : ByteString) (i : Integer) (rh : ByteString) (info red : Data)
    (fs : List Data) : List Term :=
  [toTerm s, toTerm i, toTerm rh, toTerm (purposeCtx k info red fs)]

def osmSpendingAnyTxArgs := osmPurposeArgs 1
def osmRewardingAnyTxArgs := osmPurposeArgs 2
def osmCertifyingAnyTxArgs := osmPurposeArgs 3
def osmVotingAnyTxArgs := osmPurposeArgs 4
def osmProposingAnyTxArgs := osmPurposeArgs 5

#prep_uplc appliedOsmSpendingAnyTx oneShotMintTemplate osmSpendingAnyTxArgs 1000
#prep_uplc appliedOsmRewardingAnyTx oneShotMintTemplate osmRewardingAnyTxArgs 1000
#prep_uplc appliedOsmCertifyingAnyTx oneShotMintTemplate osmCertifyingAnyTxArgs 1000
#prep_uplc appliedOsmVotingAnyTx oneShotMintTemplate osmVotingAnyTxArgs 1000
#prep_uplc appliedOsmProposingAnyTx oneShotMintTemplate osmProposingAnyTxArgs 1000

theorem one_shot_mint_fails_spending_any_tx : ∀ s i rh info red fs,
    isUnsuccessful (appliedOsmSpendingAnyTx.prop s i rh info red fs) := by blaster
theorem one_shot_mint_fails_rewarding_any_tx : ∀ s i rh info red fs,
    isUnsuccessful (appliedOsmRewardingAnyTx.prop s i rh info red fs) := by blaster
theorem one_shot_mint_fails_certifying_any_tx : ∀ s i rh info red fs,
    isUnsuccessful (appliedOsmCertifyingAnyTx.prop s i rh info red fs) := by blaster
theorem one_shot_mint_fails_voting_any_tx : ∀ s i rh info red fs,
    isUnsuccessful (appliedOsmVotingAnyTx.prop s i rh info red fs) := by blaster
theorem one_shot_mint_fails_proposing_any_tx : ∀ s i rh info red fs,
    isUnsuccessful (appliedOsmProposingAnyTx.prop s i rh info red fs) := by blaster

/-! ### reference_holder -/

def refHolderAnyContextArgs (ctx : Data) : List Term := [toTerm ctx]

#prep_uplc appliedReferenceHolderAnyContext referenceHolder refHolderAnyContextArgs 500

/-- Whatever it's given, it reaches `Error`. -/
theorem reference_holder_fails_on_any_context :
    ∀ (ctx : Data), isUnsuccessful (appliedReferenceHolderAnyContext.prop ctx) := by blaster

/-! ### Concrete runs, at v2's test launch (P = abab…, L = 6666…), as `#guard`s -/

/-- How a concrete run of `s`, its parameters `params` applied first, ends on the context `ctx`:
"unit", "halt" (another value), "error" or "exhausted". The machine is `#prep_uplc`'s. -/
def endWith (s : PlutusScript) (params : List Term) (ctx : Data) (fuel : Nat := 20000) : String :=
  match s.script with
  | .Program _ body =>
    let rec go : Nat → State → String
      | 0, _ => "exhausted"
      | k + 1, st =>
        match st with
        | .Halt (.VCon .Unit) => "unit"
        | .Halt _ => "halt"
        | .Error => "error"
        | _ => go k (step default st)
    go fuel (initialState (applyParams body (params ++ [toTerm ctx])))

def testP : ByteString := ofHex "abababababababababababababababababababababababababababab"
def testL : ByteString := ofHex "66666666666666666666666666666666666666666666666666666666"
def testRh : ByteString := ofHex "288fea77a0f674c6080aadd8ed3ca42cd5a920bf1f00c0d3e63306e4"

-- mix_logic: a registration publishes even in a "transaction" that isn't one; an
-- unregistration and a minting purpose error.
#guard endWith mixLogicTemplate [toTerm testP, toTerm nftName] (.Constr 0 [.I 7, .I 0, .Constr 3 [.I 0, .Constr 0 [.Constr 1 [.B testL], .Constr 1 []]]]) == "unit"
#guard endWith mixLogicTemplate [toTerm testP, toTerm nftName] (.Constr 0 [.I 7, .I 0, .Constr 3 [.I 0, .Constr 1 [.Constr 1 [.B testL], .Constr 1 []]]]) == "error"
#guard endWith mixLogicTemplate [toTerm testP, toTerm nftName] (.Constr 0 [.I 7, .I 0, .Constr 0 [.B ""]]) == "error"
-- mix_box and one_shot_mint outside their handler; reference_holder on anything.
#guard endWith mixBoxTemplate [toTerm testL] (.Constr 0 [.I 7, .I 0, .Constr 0 [.B ""]]) == "error"
#guard endWith oneShotMintTemplate [toTerm testP, toTerm (0 : Integer), toTerm testRh] (.Constr 0 [.I 7, .I 0, .Constr 1 [.I 0, .Constr 1 []]]) == "error"
#guard endWith referenceHolder [] (.I 0) == "error"
#guard endWith referenceHolder [] (.Constr 0 [.I 7, .I 0, .Constr 1 [.Constr 0 [.B "", .I 0], .Constr 1 []]]) == "error"

end Lovejoin.Template.AnyTx
