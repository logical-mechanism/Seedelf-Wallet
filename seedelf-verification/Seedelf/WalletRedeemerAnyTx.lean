import Seedelf.Wallet
import Seedelf.AnyTx
import Seedelf.AnyTxSteps
import Blaster

/-! The wallet's redeemer in every transaction: anything but a proof, `Constr 0 [B _, B _, B _]`,
reaches `Error`, whatever the datum, the spent output's reference and the transaction around it.
The bytes check the redeemer's tag, its three fields and that each is a `B` before they read the
datum (`aiken uplc decode`), so here the TxInfo, the reference and the datum are each any `Data`.
With WalletAnyTx's, a Register UTxO moves only with a proof. One scenario per shape of a redeemer
that isn't a proof, which together are every one:

  B _ | I _ | List _ | Map _                    bytes, int, list, map
  Constr k _, k ≠ 0                             constrPos (k = n+1), constrNeg (k = -(n+1))
  Constr 0 fs, fs not three long                fields0, fields1, fields2, fields4 (four or more)
  Constr 0 [x, y, w], x not B                   first{Constr,Map,List,I}
  Constr 0 [B _, y, w], y not B                 second{Constr,Map,List,I}
  Constr 0 [B _, B _, w], w not B               third{Constr,Map,List,I}

800 steps, as WalletNoLock: each run errors within a few hundred. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- A spend of `ref`, whose datum is `d` (encoded), with the redeemer `rd`, in the transaction
`info`. -/
def anyRedeemerArgs (rd : Data) (info ref d : Data) : List Term :=
  [toTerm (spendIn info rd ref d)]

-- The builder makes a real spend (README rule 3): with a proof as its redeemer it's AnyTxSteps'
-- passing spend of a UTxO with no datum.
example : anyRedeemerArgs (proofWith z0) (.I 7) spentRef datumNone =
    [toTerm (spendIn (.I 7) (proofWith z0) spentRef datumNone)] := rfl

def anyRedeemerBytesArgs (b : ByteString) := anyRedeemerArgs (.B b)
def anyRedeemerIntArgs (i : Integer) := anyRedeemerArgs (.I i)
def anyRedeemerListArgs (l : List Data) := anyRedeemerArgs (.List l)
def anyRedeemerMapArgs (m : List (Data × Data)) := anyRedeemerArgs (.Map m)
def anyRedeemerConstrPosArgs (n : Nat) (fs : List Data) := anyRedeemerArgs (.Constr (Int.ofNat (n + 1)) fs)
def anyRedeemerConstrNegArgs (n : Nat) (fs : List Data) := anyRedeemerArgs (.Constr (Int.negSucc n) fs)
def anyRedeemerFields0Args := anyRedeemerArgs (.Constr 0 [])
def anyRedeemerFields1Args (x : Data) := anyRedeemerArgs (.Constr 0 [x])
def anyRedeemerFields2Args (x y : Data) := anyRedeemerArgs (.Constr 0 [x, y])
def anyRedeemerFields4Args (x y w v : Data) (rest : List Data) := anyRedeemerArgs (.Constr 0 (x :: y :: w :: v :: rest))
def anyRedeemerFirstConstrArgs (k : Integer) (fs : List Data) (y w : Data) := anyRedeemerArgs (.Constr 0 [.Constr k fs, y, w])
def anyRedeemerFirstMapArgs (m : List (Data × Data)) (y w : Data) := anyRedeemerArgs (.Constr 0 [.Map m, y, w])
def anyRedeemerFirstListArgs (l : List Data) (y w : Data) := anyRedeemerArgs (.Constr 0 [.List l, y, w])
def anyRedeemerFirstIArgs (i : Integer) (y w : Data) := anyRedeemerArgs (.Constr 0 [.I i, y, w])
def anyRedeemerSecondConstrArgs (a : ByteString) (k : Integer) (fs : List Data) (w : Data) := anyRedeemerArgs (.Constr 0 [.B a, .Constr k fs, w])
def anyRedeemerSecondMapArgs (a : ByteString) (m : List (Data × Data)) (w : Data) := anyRedeemerArgs (.Constr 0 [.B a, .Map m, w])
def anyRedeemerSecondListArgs (a : ByteString) (l : List Data) (w : Data) := anyRedeemerArgs (.Constr 0 [.B a, .List l, w])
def anyRedeemerSecondIArgs (a : ByteString) (i : Integer) (w : Data) := anyRedeemerArgs (.Constr 0 [.B a, .I i, w])
def anyRedeemerThirdConstrArgs (a b : ByteString) (k : Integer) (fs : List Data) := anyRedeemerArgs (.Constr 0 [.B a, .B b, .Constr k fs])
def anyRedeemerThirdMapArgs (a b : ByteString) (m : List (Data × Data)) := anyRedeemerArgs (.Constr 0 [.B a, .B b, .Map m])
def anyRedeemerThirdListArgs (a b : ByteString) (l : List Data) := anyRedeemerArgs (.Constr 0 [.B a, .B b, .List l])
def anyRedeemerThirdIArgs (a b : ByteString) (i : Integer) := anyRedeemerArgs (.Constr 0 [.B a, .B b, .I i])

#prep_uplc appliedAnyRedeemerBytes wallet anyRedeemerBytesArgs 800
#prep_uplc appliedAnyRedeemerInt wallet anyRedeemerIntArgs 800
#prep_uplc appliedAnyRedeemerList wallet anyRedeemerListArgs 800
#prep_uplc appliedAnyRedeemerMap wallet anyRedeemerMapArgs 800
#prep_uplc appliedAnyRedeemerConstrPos wallet anyRedeemerConstrPosArgs 800
#prep_uplc appliedAnyRedeemerConstrNeg wallet anyRedeemerConstrNegArgs 800
#prep_uplc appliedAnyRedeemerFields0 wallet anyRedeemerFields0Args 800
#prep_uplc appliedAnyRedeemerFields1 wallet anyRedeemerFields1Args 800
#prep_uplc appliedAnyRedeemerFields2 wallet anyRedeemerFields2Args 800
#prep_uplc appliedAnyRedeemerFields4 wallet anyRedeemerFields4Args 800
#prep_uplc appliedAnyRedeemerFirstConstr wallet anyRedeemerFirstConstrArgs 800
#prep_uplc appliedAnyRedeemerFirstMap wallet anyRedeemerFirstMapArgs 800
#prep_uplc appliedAnyRedeemerFirstList wallet anyRedeemerFirstListArgs 800
#prep_uplc appliedAnyRedeemerFirstI wallet anyRedeemerFirstIArgs 800
#prep_uplc appliedAnyRedeemerSecondConstr wallet anyRedeemerSecondConstrArgs 800
#prep_uplc appliedAnyRedeemerSecondMap wallet anyRedeemerSecondMapArgs 800
#prep_uplc appliedAnyRedeemerSecondList wallet anyRedeemerSecondListArgs 800
#prep_uplc appliedAnyRedeemerSecondI wallet anyRedeemerSecondIArgs 800
#prep_uplc appliedAnyRedeemerThirdConstr wallet anyRedeemerThirdConstrArgs 800
#prep_uplc appliedAnyRedeemerThirdMap wallet anyRedeemerThirdMapArgs 800
#prep_uplc appliedAnyRedeemerThirdList wallet anyRedeemerThirdListArgs 800
#prep_uplc appliedAnyRedeemerThirdI wallet anyRedeemerThirdIArgs 800

-- Their own runs at their own limit, on a Register UTxO in the busy transaction with the right
-- signer: the honest proof with a fourth field, or its last field an integer, reaches Error.
#guard endsInError (appliedAnyRedeemerFields4.exec (.B z0) (.B gr0) (.B vkh0) (.B vkh0) [] (busyTx.info [.B vkh0]) spentRef registerDatum)
#guard endsInError (appliedAnyRedeemerThirdI.exec z0 gr0 0 (busyTx.info [.B vkh0]) spentRef registerDatum)
#guard endsInError (appliedAnyRedeemerFields2.exec (.B z0) (.B gr0) (busyTx.info [.B vkh0]) spentRef registerDatum)

theorem wallet_fails_redeemer_bytes : ∀ b info ref d, isUnsuccessful (appliedAnyRedeemerBytes.prop b info ref d) := by blaster
theorem wallet_fails_redeemer_int : ∀ i info ref d, isUnsuccessful (appliedAnyRedeemerInt.prop i info ref d) := by blaster
theorem wallet_fails_redeemer_list : ∀ l info ref d, isUnsuccessful (appliedAnyRedeemerList.prop l info ref d) := by blaster
theorem wallet_fails_redeemer_map : ∀ m info ref d, isUnsuccessful (appliedAnyRedeemerMap.prop m info ref d) := by blaster
theorem wallet_fails_redeemer_constr_pos : ∀ n fs info ref d, isUnsuccessful (appliedAnyRedeemerConstrPos.prop n fs info ref d) := by blaster
theorem wallet_fails_redeemer_constr_neg : ∀ n fs info ref d, isUnsuccessful (appliedAnyRedeemerConstrNeg.prop n fs info ref d) := by blaster
theorem wallet_fails_redeemer_fields0 : ∀ info ref d, isUnsuccessful (appliedAnyRedeemerFields0.prop info ref d) := by blaster
theorem wallet_fails_redeemer_fields1 : ∀ x info ref d, isUnsuccessful (appliedAnyRedeemerFields1.prop x info ref d) := by blaster
theorem wallet_fails_redeemer_fields2 : ∀ x y info ref d, isUnsuccessful (appliedAnyRedeemerFields2.prop x y info ref d) := by blaster
theorem wallet_fails_redeemer_fields4 : ∀ x y w v rest info ref d, isUnsuccessful (appliedAnyRedeemerFields4.prop x y w v rest info ref d) := by blaster
theorem wallet_fails_redeemer_first_constr : ∀ k fs y w info ref d, isUnsuccessful (appliedAnyRedeemerFirstConstr.prop k fs y w info ref d) := by blaster
theorem wallet_fails_redeemer_first_map : ∀ m y w info ref d, isUnsuccessful (appliedAnyRedeemerFirstMap.prop m y w info ref d) := by blaster
theorem wallet_fails_redeemer_first_list : ∀ l y w info ref d, isUnsuccessful (appliedAnyRedeemerFirstList.prop l y w info ref d) := by blaster
theorem wallet_fails_redeemer_first_i : ∀ i y w info ref d, isUnsuccessful (appliedAnyRedeemerFirstI.prop i y w info ref d) := by blaster
theorem wallet_fails_redeemer_second_constr : ∀ a k fs w info ref d, isUnsuccessful (appliedAnyRedeemerSecondConstr.prop a k fs w info ref d) := by blaster
theorem wallet_fails_redeemer_second_map : ∀ a m w info ref d, isUnsuccessful (appliedAnyRedeemerSecondMap.prop a m w info ref d) := by blaster
theorem wallet_fails_redeemer_second_list : ∀ a l w info ref d, isUnsuccessful (appliedAnyRedeemerSecondList.prop a l w info ref d) := by blaster
theorem wallet_fails_redeemer_second_i : ∀ a i w info ref d, isUnsuccessful (appliedAnyRedeemerSecondI.prop a i w info ref d) := by blaster
theorem wallet_fails_redeemer_third_constr : ∀ a b k fs info ref d, isUnsuccessful (appliedAnyRedeemerThirdConstr.prop a b k fs info ref d) := by blaster
theorem wallet_fails_redeemer_third_map : ∀ a b m info ref d, isUnsuccessful (appliedAnyRedeemerThirdMap.prop a b m info ref d) := by blaster
theorem wallet_fails_redeemer_third_list : ∀ a b l info ref d, isUnsuccessful (appliedAnyRedeemerThirdList.prop a b l info ref d) := by blaster
theorem wallet_fails_redeemer_third_i : ∀ a b i info ref d, isUnsuccessful (appliedAnyRedeemerThirdI.prop a b i info ref d) := by blaster

end Seedelf.V1
