import Lovejoin.Box
import Seedelf.Steps

/-! How many steps Blaster's CEK machine takes on concrete runs of each Lovejoin
scenario, to size the `#prep_uplc` limits (see `Seedelf.Steps`). Each mix_box line
pairs with a case in `concrete/lovejoin_mix_box.sh`, which Aiken's evaluator agrees
with. -/

namespace Lovejoin.Classic
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx stepsUsed g1)

def notG1 : PlutusCore.ByteString.ByteString :=
  Seedelf.V1.ofHex "a09d99e02f7200526dc55ef722cc171e7aa14fc732614c02ac58d59d7026a7eb18d8798f6928ea2b513f3a4feb0c94d1"

-- reference_holder: a spend, and another purpose
#eval s!"reference_holder, spend:     {stepsUsed referenceHolder ⟨emptyTx, Data.I 0, .SpendingScript boxRef none⟩}"
#eval s!"reference_holder, minting:   {stepsUsed referenceHolder ⟨emptyTx, Data.I 0, .MintingScript ""⟩}"
-- mix_box: another purpose, then the box's datum and the withdrawals
#eval s!"mix_box, minting purpose:    {stepsUsed mixBox ⟨emptyTx, Data.Constr 0 [], .MintingScript ""⟩}"
#eval s!"mix_box, well-formed, none:  {stepsUsed mixBox (inlineBoxCtx (mixDatum g1 notG1) [])}"
#eval s!"mix_box, well-formed, logic: {stepsUsed mixBox (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential mixLogicHash, 0)])}"
#eval s!"mix_box, well-formed, other: {stepsUsed mixBox (inlineBoxCtx (mixDatum g1 notG1) [(.ScriptCredential "o", 0)])}"
#eval s!"mix_box, a = b:              {stepsUsed mixBox (inlineBoxCtx (mixDatum g1 g1) [])}"
#eval s!"mix_box, Constr 0 [B,B,B]:   {stepsUsed mixBox (inlineBoxCtx (.Constr 0 [.B g1, .B notG1, .B g1]) [])}"
#eval s!"mix_box, no datum:           {stepsUsed mixBox (spendBoxCtx .NoOutputDatum none [])}"
#eval s!"mix_box, by hash (F-2):      {stepsUsed mixBox (spendBoxCtx (.OutputDatumHash "h") (some (mixDatum g1 notG1)) [])}"
-- mix_logic: another purpose, then publish with its own registration and with another certificate
#eval s!"mix_logic, minting purpose:  {stepsUsed mixLogic ⟨emptyTx, Data.Constr 0 [], .MintingScript ""⟩}"
#eval s!"mix_logic, registration:     {stepsUsed mixLogic ⟨emptyTx, Data.Constr 0 [], .CertifyingScript 0 (.TxCertRegStaking (.ScriptCredential mixLogicHash) none)⟩}"
#eval s!"mix_logic, unregistration:   {stepsUsed mixLogic ⟨emptyTx, Data.Constr 0 [], .CertifyingScript 0 (.TxCertUnRegStaking (.ScriptCredential mixLogicHash) none)⟩}"

end Lovejoin.Classic
