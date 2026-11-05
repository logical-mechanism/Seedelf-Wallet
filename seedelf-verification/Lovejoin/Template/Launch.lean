import Lovejoin.Template.Scripts
import Seedelf.Scenario

/-! one_shot_mint's template on a launch: a transaction with one input, a mint under the
policy P, and one output, the reference output. The template's parameters (the seed's
transaction and index, reference_holder's hash) come first, as the program's arguments.
mix_logic trusts whichever reference input holds the pool's NFT, so the policy is what
makes a pool's `ReferenceDatum` the only one. -/

namespace Lovejoin.Template
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3
open Seedelf.V1 (emptyTx someOutput)

/-- `one_shot_mint` allows no other name: ASCII `lovejoin`. -/
def nftName : ByteString := "lovejoin"

/-- A launch: one input at `inRef`, `mint` minted, `out` paid, run as P's policy. -/
def launchCtx (inRef : TxOutRef) (P : ByteString) (mint : Value) (out : TxOut) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs  := [⟨inRef, someOutput⟩],
    txInfoMint    := mint,
    txInfoOutputs := [out] }
  ⟨tx, Data.Constr 0 [], .MintingScript P⟩

/-- One token `(P, nm)`, `qty` of it. -/
def mintOf (P nm : ByteString) (qty : Integer) : Value := [(Data.B P, Data.Map [(Data.B nm, Data.I qty)])]

/-- `ReferenceDatum` as Data: the box lovelace; the token's policy, name and quantity; the
fee cap; then mix_box's, mix_logic's and fee_contract's hashes. -/
def refDatum (bl : Integer) (tp tn : ByteString) (tq mf : Integer) (m l f : ByteString) : Data :=
  .Constr 0 [.I bl, .B tp, .B tn, .I tq, .I mf, .B m, .B l, .B f]

/-- An ADA pool's datum, sane: 10 ₳ boxes, a 1 ₳ fee cap, and three stand-in hashes, which
the policy doesn't read. -/
def saneDatum : Data := refDatum 10000000 "" "" 0 1000000 "m" "l" "f"

/-- The reference output: 2 ₳ and the token `(P, nm)`, the datum `d` inline. -/
def refOut (cred : Credential) (stake : Option StakingCredential) (P nm : ByteString) (d : Data)
    (ref : Option ByteString) : TxOut :=
  ⟨⟨cred, stake⟩, [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B P, Data.Map [(Data.B nm, Data.I 1)])],
   .OutputDatum d, ref⟩

/-- The reference output at reference_holder `rh`, as a launch makes it. -/
def refAt (rh P : ByteString) (d : Data := saneDatum) : TxOut := refOut (.ScriptCredential rh) none P nftName d none

end Lovejoin.Template
