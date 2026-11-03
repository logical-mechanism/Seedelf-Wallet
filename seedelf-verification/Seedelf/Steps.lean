import Seedelf.Wallet
import Seedelf.Policy

/-! How many steps Blaster's CEK machine takes on concrete runs of each
scenario, to size the `#prep_uplc` limits. The chain's cost model charges only
compute steps; this machine also counts returns, so `aiken uplc eval`'s budget
undercounts it. A run cut off by the limit is neither a success nor a failure
(`isExhausted`), so a limit too small fails a success property and makes a
`¬ isSuccessful` one hold for nothing. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term Program)
open PlutusCore.UPLC.CekMachine
open PlutusCore.UPLC.PlutusScript (PlutusScript)

/-- Steps until the run halts or fails, or where it stood after `fuel`. -/
def stepsUsed (s : PlutusScript) (ctx : ScriptContext) (fuel : Nat := 20000) : String :=
  match s.script with
  | .Program _ body =>
    let rec go : Nat → State → Nat → String
      | 0, _, n => s!"exhausted at {n}"
      | k + 1, st, n =>
        match st with
        | .Halt _ => s!"halt after {n}"
        | .Error => s!"error after {n}"
        | _ => go k (step default st) (n + 1)
    go fuel (initialState (applyParams body [toTerm ctx])) 0

/-- The G1 generator, compressed (schnorr.ak's tests). -/
def g1 : ByteString := ofHex "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
def txid : ByteString := ofHex "4172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce23617fc1641880"
def nameAt0 : ByteString := (seedelfName txid 0 "").getD ""

-- always_false: any purpose
#eval s!"always_false, minting:      {stepsUsed alwaysFalse ⟨emptyTx, Data.I 0, .MintingScript ""⟩}"
-- wallet: purpose, then the datum shapes
#eval s!"wallet, minting purpose:    {stepsUsed wallet ⟨emptyTx, Data.Constr 0 [Data.B "", Data.B "", Data.B ""], .MintingScript ""⟩}"
#eval s!"wallet, no datum:           {stepsUsed wallet (spendCtx none "\x01" g1 "k" "k")}"
#eval s!"wallet, datum B \"!0!\":      {stepsUsed wallet (spendCtx (some (.B "!0!")) "\x01" g1 "k" "k")}"
#eval s!"wallet, datum I 7:          {stepsUsed wallet (spendCtx (some (.I 7)) "\x01" g1 "k" "k")}"
#eval s!"wallet, datum Constr 0 [B,B,B]: {stepsUsed wallet (spendCtx (some (.Constr 0 [.B g1, .B g1, .B g1])) "\x01" g1 "k" "k")}"
#eval s!"wallet, Register, bad proof: {stepsUsed wallet (spendCtx (some (.Constr 0 [.B g1, .B g1])) "\x01" g1 "k" "k")}"
-- policy: a valid mint and burn at #0, a burn at #256, a wrong amount
#eval s!"policy, mint #0:            {stepsUsed seedelf (mintCtx "p" "p" nameAt0 txid "" 0 1)}"
#eval s!"policy, burn #0:            {stepsUsed seedelf (mintCtx "p" "p" "\x5e\xed\x0e\x1f\x01" txid "" 0 (-1))}"
#eval s!"policy, burn #256:          {stepsUsed seedelf (mintCtx "p" "p" "\x5e\xed\x0e\x1f\x01" txid "" 256 (-1))}"
#eval s!"policy, amount 7:           {stepsUsed seedelf (mintCtx "p" "p" nameAt0 txid "" 0 7)}"

end Seedelf.V1
