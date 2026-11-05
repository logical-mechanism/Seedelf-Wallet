import Slice.Run
import Blaster

/-! Negative controls for the policy's rule: each changes the spec or cuts the step limit, and
Blaster must find a counterexample (`solve-result: 1`, "✅ Expected Falsified"). So the rule's
theorems hold because the bytes check what `policyAccepts` says, each check of it, and because
the runs end inside the limit. Z3's counterexamples are over the opaque builtins (any slice),
never a transaction run anywhere.

The spec controls are `policyAcceptsMutant`, `policyAccepts` with one check changed, which at
its defaults is `policyAccepts` itself (`policyAcceptsMutant_default`, `rfl`). Each is stated
at a concrete first-input index, as `Index0` to `Index3` state the rule: #0, or #256 for the
index's bound. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Integer (Integer equalsInteger)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.CekMachine (State cekExecuteProgram)
open PlutusCore.UPLC.Utils
open PlutusCore.UPLC.BuiltinFunctions.ByteString (sliceByteStringOpaque)

/-- `policyAccepts` with one check changed. `bound` off drops the index's bound: the name takes
any index, its byte wrapping (`toUInt8`), where V3's `consByteString` fails off a byte. `pre`
off drops the burn's prefix check, `len` is the length the burn slices for it, and `ownCheck`
off drops `pid = own` from both blocks. -/
def policyAcceptsMutant (bound pre : Bool) (len : Int) (ownCheck : Bool)
    (own pid tkn tag txid : ByteString) (amt idx : Integer) : Bool :=
  let burn :=
    (!ownCheck || equalsByteString pid own) &&
      ((!pre || equalsByteString ⟨sliceByteStringOpaque 0 len tkn.data⟩ seedelfPrefix) &&
        equalsInteger amt (-1))
  match (if bound then consByteStringV2 idx txid else .ok (ByteString.cons idx.toNat.toUInt8 txid)) with
  | .error _ => false
  | .ok indexed =>
    let name : ByteString :=
      ⟨sliceByteStringOpaque 0 32
        (appendByteString (appendByteString seedelfPrefix ⟨sliceByteStringOpaque 0 15 tag.data⟩)
          indexed).data⟩
    let mint :=
      (!ownCheck || equalsByteString own pid) && (equalsByteString name tkn && equalsInteger 1 amt)
    if burn || mint then !(burn && mint) else false

theorem policyAcceptsMutant_default (own pid tkn tag txid : ByteString) (amt idx : Integer) :
    policyAcceptsMutant true true 4 true own pid tkn tag txid amt idx =
      policyAccepts own pid tkn tag txid amt idx := rfl

-- C1 the index's bound dropped: off #256 the mutant takes the honest burn the bytes refuse
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString) (amt : Integer),
    isSuccessful (sliceRuleRun r sigs out rest own pid tkn tag txid amt 256) ↔
      policyAcceptsMutant false true 4 true own pid ⟨tkn⟩ tag txid amt 256 = true]

-- C2 the burn's prefix check dropped
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString) (amt : Integer),
    isSuccessful (sliceRuleRun r sigs out rest own pid tkn tag txid amt 0) ↔
      policyAcceptsMutant true false 4 true own pid ⟨tkn⟩ tag txid amt 0 = true]

-- C3 the prefix's length 3 for 4
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString) (amt : Integer),
    isSuccessful (sliceRuleRun r sigs out rest own pid tkn tag txid amt 0) ↔
      policyAcceptsMutant true true 3 true own pid ⟨tkn⟩ tag txid amt 0 = true]

-- C4 pid = own dropped
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString) (amt : Integer),
    isSuccessful (sliceRuleRun r sigs out rest own pid tkn tag txid amt 0) ↔
      policyAcceptsMutant true true 4 false own pid ⟨tkn⟩ tag txid amt 0 = true]

/-! ### The step limit -/

/-- `isExhausted`, as a `Bool`: the run is still going. -/
def stillRunning (s : State) : Bool :=
  match s with
  | .Eval .. | .Return .. => true
  | _ => false

/-- The rule's run off `#0`, prepared at a limit of its own. -/
def sliceCutArgs (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString) (amt : Integer) : List Term :=
  sliceRuleArgs r sigs out rest own pid ⟨tkn⟩ tag txid amt 0

-- One step short of the honest mint's run: Steps measures it returning unit after 1287 steps.
#prep_uplc appliedSliceCut seedelfSlicePolicy sliceCutArgs 1286

#guard stillRunning (appliedSliceCut.exec busyMint busySigs busyOut busyRest policyId policyId name0.data "" exampleTxid 1)
#guard endsWithUnit (cekExecuteProgram seedelfSlicePolicy.script
  (sliceRuleArgs busyMint busySigs busyOut busyRest policyId policyId name0 "" exampleTxid 1 0) 1287)

-- C5 at 1286 an accepted mint no longer returns unit
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString),
    policyAccepts own pid ⟨tkn⟩ tag txid 1 0 = true →
      returnsUnit (appliedSliceCut.prop r sigs out rest own pid tkn tag txid 1)]

-- C6 the off-byte theorems' limit: Steps measures the burn off #256 reaching Error after 1115
-- steps, so one step short, `policy_one_line_above_a_byte`'s failure no longer holds.
#guard stillRunning (cekExecuteProgram seedelfSlicePolicy.script
  (sliceRuleArgs busyMint busySigs busyOut busyRest policyId policyId name0 "" exampleTxid (-1) 256) 1114)
#guard endsInError (cekExecuteProgram seedelfSlicePolicy.script
  (sliceRuleArgs busyMint busySigs busyOut busyRest policyId policyId name0 "" exampleTxid (-1) 256) 1115)
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString) (amt idx : Integer),
    ¬ (idx ≤ 255) →
      isUnsuccessful (cekExecuteProgram seedelfSlicePolicy.script
        (sliceRuleArgs r sigs out rest own pid ⟨tkn⟩ tag txid amt idx) 1114)]

end Seedelf.V1
