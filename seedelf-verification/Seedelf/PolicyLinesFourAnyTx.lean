import Seedelf.PolicyAnyTxSteps
import Blaster

/-! PolicyLinesAnyTx with four lines: its 8 layouts over policies, the compositions of 4, with
every policy id, name and amount symbolic and the rest any, as there. 1500 steps: the longest
run, four policies of one name each, errors after 1039 (PolicyAnyTxSteps). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def polLines4Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 n4 : ByteString) (a1 a2 a3 a4 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2), (.B n3, .I a3), (.B n4, .I a4)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 n4 : ByteString) (a1 a2 a3 a4 : Integer) :
    polLines4Args r sigs inputs rd own p1 n1 n2 n3 n4 a1 a2 a3 a4 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2), (n3, a3), (n4, a4)])])) rd own)] := rfl

def polLines13Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 n4 : ByteString) (a1 a2 a3 a4 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2), (.B n3, .I a3), (.B n4, .I a4)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 n4 : ByteString) (a1 a2 a3 a4 : Integer) :
    polLines13Args r sigs inputs rd own p1 n1 p2 n2 n3 n4 a1 a2 a3 a4 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2), (n3, a3), (n4, a4)])])) rd own)] := rfl

def polLines22Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 n4 : ByteString) (a1 a2 a3 a4 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2)]), (.B p2, .Map [(.B n3, .I a3), (.B n4, .I a4)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 n4 : ByteString) (a1 a2 a3 a4 : Integer) :
    polLines22Args r sigs inputs rd own p1 n1 n2 p2 n3 n4 a1 a2 a3 a4 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2)]), (p2, [(n3, a3), (n4, a4)])])) rd own)] := rfl

def polLines112Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 n4 : ByteString) (a1 a2 a3 a4 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2)]), (.B p3, .Map [(.B n3, .I a3), (.B n4, .I a4)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 n4 : ByteString) (a1 a2 a3 a4 : Integer) :
    polLines112Args r sigs inputs rd own p1 n1 p2 n2 p3 n3 n4 a1 a2 a3 a4 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2)]), (p3, [(n3, a3), (n4, a4)])])) rd own)] := rfl

def polLines31Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 p2 n4 : ByteString) (a1 a2 a3 a4 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2), (.B n3, .I a3)]), (.B p2, .Map [(.B n4, .I a4)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 p2 n4 : ByteString) (a1 a2 a3 a4 : Integer) :
    polLines31Args r sigs inputs rd own p1 n1 n2 n3 p2 n4 a1 a2 a3 a4 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2), (n3, a3)]), (p2, [(n4, a4)])])) rd own)] := rfl

def polLines121Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 p3 n4 : ByteString) (a1 a2 a3 a4 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2), (.B n3, .I a3)]), (.B p3, .Map [(.B n4, .I a4)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 p3 n4 : ByteString) (a1 a2 a3 a4 : Integer) :
    polLines121Args r sigs inputs rd own p1 n1 p2 n2 n3 p3 n4 a1 a2 a3 a4 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2), (n3, a3)]), (p3, [(n4, a4)])])) rd own)] := rfl

def polLines211Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 p3 n4 : ByteString) (a1 a2 a3 a4 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2)]), (.B p2, .Map [(.B n3, .I a3)]), (.B p3, .Map [(.B n4, .I a4)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 p3 n4 : ByteString) (a1 a2 a3 a4 : Integer) :
    polLines211Args r sigs inputs rd own p1 n1 n2 p2 n3 p3 n4 a1 a2 a3 a4 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2)]), (p2, [(n3, a3)]), (p3, [(n4, a4)])])) rd own)] := rfl

def polLines1111Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 p4 n4 : ByteString) (a1 a2 a3 a4 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2)]), (.B p3, .Map [(.B n3, .I a3)]), (.B p4, .Map [(.B n4, .I a4)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 p4 n4 : ByteString) (a1 a2 a3 a4 : Integer) :
    polLines1111Args r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 a1 a2 a3 a4 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2)]), (p3, [(n3, a3)]), (p4, [(n4, a4)])])) rd own)] := rfl

#prep_uplc appliedPolLines4 seedelf polLines4Args 1500
#prep_uplc appliedPolLines13 seedelf polLines13Args 1500
#prep_uplc appliedPolLines22 seedelf polLines22Args 1500
#prep_uplc appliedPolLines112 seedelf polLines112Args 1500
#prep_uplc appliedPolLines31 seedelf polLines31Args 1500
#prep_uplc appliedPolLines121 seedelf polLines121Args 1500
#prep_uplc appliedPolLines211 seedelf polLines211Args 1500
#prep_uplc appliedPolLines1111 seedelf polLines1111Args 1500

-- The layouts above, in order: the compositions of 4, each once.
#guard compositions 4 == [[4], [1, 3], [2, 2], [1, 1, 2], [3, 1], [1, 2, 1], [2, 1, 1], [1, 1, 1, 1]]

-- Each builder's own run at its own limit (README rule 3), in PolicyAnyTxSteps' busy transaction:
-- the honest mint's line, then `polLinesAs`' further names and policies, reaches Error.
#guard endsInError (appliedPolLines4.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "x2" "x3" 1 1 1 1)
#guard endsInError (appliedPolLines13.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "x1" "x2" 1 1 1 1)
#guard endsInError (appliedPolLines22.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "q1" "x0" "x1" 1 1 1 1)
#guard endsInError (appliedPolLines112.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" "x1" 1 1 1 1)
#guard endsInError (appliedPolLines31.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "x2" "q1" "x0" 1 1 1 1)
#guard endsInError (appliedPolLines121.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "x1" "q2" "x0" 1 1 1 1)
#guard endsInError (appliedPolLines211.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "q1" "x0" "q2" "x0" 1 1 1 1)
#guard endsInError (appliedPolLines1111.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" "q3" "x0" 1 1 1 1)

theorem policy_fails_lines_4 :
  ∀ r sigs inputs rd own p1 n1 n2 n3 n4 a1 a2 a3 a4,
    isUnsuccessful (appliedPolLines4.prop r sigs inputs rd own p1 n1 n2 n3 n4 a1 a2 a3 a4) := by blaster
theorem policy_fails_lines_13 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 n3 n4 a1 a2 a3 a4,
    isUnsuccessful (appliedPolLines13.prop r sigs inputs rd own p1 n1 p2 n2 n3 n4 a1 a2 a3 a4) := by blaster
theorem policy_fails_lines_22 :
  ∀ r sigs inputs rd own p1 n1 n2 p2 n3 n4 a1 a2 a3 a4,
    isUnsuccessful (appliedPolLines22.prop r sigs inputs rd own p1 n1 n2 p2 n3 n4 a1 a2 a3 a4) := by blaster
theorem policy_fails_lines_112 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 p3 n3 n4 a1 a2 a3 a4,
    isUnsuccessful (appliedPolLines112.prop r sigs inputs rd own p1 n1 p2 n2 p3 n3 n4 a1 a2 a3 a4) := by blaster
theorem policy_fails_lines_31 :
  ∀ r sigs inputs rd own p1 n1 n2 n3 p2 n4 a1 a2 a3 a4,
    isUnsuccessful (appliedPolLines31.prop r sigs inputs rd own p1 n1 n2 n3 p2 n4 a1 a2 a3 a4) := by blaster
theorem policy_fails_lines_121 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 n3 p3 n4 a1 a2 a3 a4,
    isUnsuccessful (appliedPolLines121.prop r sigs inputs rd own p1 n1 p2 n2 n3 p3 n4 a1 a2 a3 a4) := by blaster
theorem policy_fails_lines_211 :
  ∀ r sigs inputs rd own p1 n1 n2 p2 n3 p3 n4 a1 a2 a3 a4,
    isUnsuccessful (appliedPolLines211.prop r sigs inputs rd own p1 n1 n2 p2 n3 p3 n4 a1 a2 a3 a4) := by blaster
theorem policy_fails_lines_1111 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 a1 a2 a3 a4,
    isUnsuccessful (appliedPolLines1111.prop r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 a1 a2 a3 a4) := by blaster

-- A negative control: one step short of its Error, after 1039 steps (PolicyAnyTxSteps), the
-- longest run here is still going, and the same theorem over it comes back Falsified. So the
-- theorems above hold because the runs reach Error inside the limit.
#prep_uplc appliedPolLines1111Cut seedelf polLines1111Args 1038
#guard stillRunning (appliedPolLines1111Cut.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" "q3" "x0" 1 1 1 1)
#guard endsInError (cekExecuteProgram seedelf.script (polLines1111Args busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" "q3" "x0" 1 1 1 1) 1039)
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 a1 a2 a3 a4,
    isUnsuccessful (appliedPolLines1111Cut.prop r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 a1 a2 a3 a4)]

end Seedelf.V1
