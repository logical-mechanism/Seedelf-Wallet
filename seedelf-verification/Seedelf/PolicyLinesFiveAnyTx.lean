import Seedelf.PolicyAnyTxSteps
import Blaster

/-! PolicyLinesAnyTx with five lines: its 16 layouts over policies, the compositions of 5, with
every policy id, name and amount symbolic and the rest any, as there. 1500 steps: the longest
run, five policies of one name each, errors after 1224 (PolicyAnyTxSteps). -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def polLines5Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2), (.B n3, .I a3), (.B n4, .I a4), (.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines5Args r sigs inputs rd own p1 n1 n2 n3 n4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2), (n3, a3), (n4, a4), (n5, a5)])])) rd own)] := rfl

def polLines14Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2), (.B n3, .I a3), (.B n4, .I a4), (.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines14Args r sigs inputs rd own p1 n1 p2 n2 n3 n4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2), (n3, a3), (n4, a4), (n5, a5)])])) rd own)] := rfl

def polLines23Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2)]), (.B p2, .Map [(.B n3, .I a3), (.B n4, .I a4), (.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines23Args r sigs inputs rd own p1 n1 n2 p2 n3 n4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2)]), (p2, [(n3, a3), (n4, a4), (n5, a5)])])) rd own)] := rfl

def polLines113Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2)]), (.B p3, .Map [(.B n3, .I a3), (.B n4, .I a4), (.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines113Args r sigs inputs rd own p1 n1 p2 n2 p3 n3 n4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2)]), (p3, [(n3, a3), (n4, a4), (n5, a5)])])) rd own)] := rfl

def polLines32Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 p2 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2), (.B n3, .I a3)]), (.B p2, .Map [(.B n4, .I a4), (.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 p2 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines32Args r sigs inputs rd own p1 n1 n2 n3 p2 n4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2), (n3, a3)]), (p2, [(n4, a4), (n5, a5)])])) rd own)] := rfl

def polLines122Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 p3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2), (.B n3, .I a3)]), (.B p3, .Map [(.B n4, .I a4), (.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 p3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines122Args r sigs inputs rd own p1 n1 p2 n2 n3 p3 n4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2), (n3, a3)]), (p3, [(n4, a4), (n5, a5)])])) rd own)] := rfl

def polLines212Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 p3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2)]), (.B p2, .Map [(.B n3, .I a3)]), (.B p3, .Map [(.B n4, .I a4), (.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 p3 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines212Args r sigs inputs rd own p1 n1 n2 p2 n3 p3 n4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2)]), (p2, [(n3, a3)]), (p3, [(n4, a4), (n5, a5)])])) rd own)] := rfl

def polLines1112Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 p4 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2)]), (.B p3, .Map [(.B n3, .I a3)]), (.B p4, .Map [(.B n4, .I a4), (.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 p4 n4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines1112Args r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2)]), (p3, [(n3, a3)]), (p4, [(n4, a4), (n5, a5)])])) rd own)] := rfl

def polLines41Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 n4 p2 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2), (.B n3, .I a3), (.B n4, .I a4)]), (.B p2, .Map [(.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 n4 p2 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines41Args r sigs inputs rd own p1 n1 n2 n3 n4 p2 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2), (n3, a3), (n4, a4)]), (p2, [(n5, a5)])])) rd own)] := rfl

def polLines131Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 n4 p3 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2), (.B n3, .I a3), (.B n4, .I a4)]), (.B p3, .Map [(.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 n4 p3 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines131Args r sigs inputs rd own p1 n1 p2 n2 n3 n4 p3 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2), (n3, a3), (n4, a4)]), (p3, [(n5, a5)])])) rd own)] := rfl

def polLines221Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 n4 p3 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2)]), (.B p2, .Map [(.B n3, .I a3), (.B n4, .I a4)]), (.B p3, .Map [(.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 n4 p3 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines221Args r sigs inputs rd own p1 n1 n2 p2 n3 n4 p3 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2)]), (p2, [(n3, a3), (n4, a4)]), (p3, [(n5, a5)])])) rd own)] := rfl

def polLines1121Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 n4 p4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2)]), (.B p3, .Map [(.B n3, .I a3), (.B n4, .I a4)]), (.B p4, .Map [(.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 n4 p4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines1121Args r sigs inputs rd own p1 n1 p2 n2 p3 n3 n4 p4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2)]), (p3, [(n3, a3), (n4, a4)]), (p4, [(n5, a5)])])) rd own)] := rfl

def polLines311Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 p2 n4 p3 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2), (.B n3, .I a3)]), (.B p2, .Map [(.B n4, .I a4)]), (.B p3, .Map [(.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 n3 p2 n4 p3 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines311Args r sigs inputs rd own p1 n1 n2 n3 p2 n4 p3 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2), (n3, a3)]), (p2, [(n4, a4)]), (p3, [(n5, a5)])])) rd own)] := rfl

def polLines1211Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 p3 n4 p4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2), (.B n3, .I a3)]), (.B p3, .Map [(.B n4, .I a4)]), (.B p4, .Map [(.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 n3 p3 n4 p4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines1211Args r sigs inputs rd own p1 n1 p2 n2 n3 p3 n4 p4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2), (n3, a3)]), (p3, [(n4, a4)]), (p4, [(n5, a5)])])) rd own)] := rfl

def polLines2111Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 p3 n4 p4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1), (.B n2, .I a2)]), (.B p2, .Map [(.B n3, .I a3)]), (.B p3, .Map [(.B n4, .I a4)]), (.B p4, .Map [(.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 n2 p2 n3 p3 n4 p4 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines2111Args r sigs inputs rd own p1 n1 n2 p2 n3 p3 n4 p4 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1), (n2, a2)]), (p2, [(n3, a3)]), (p3, [(n4, a4)]), (p4, [(n5, a5)])])) rd own)] := rfl

def polLines11111Args (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 p4 n4 p5 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) : List Term :=
  [toTerm (mintIn (r.withMint sigs inputs (.Map [(.B p1, .Map [(.B n1, .I a1)]), (.B p2, .Map [(.B n2, .I a2)]), (.B p3, .Map [(.B n3, .I a3)]), (.B p4, .Map [(.B n4, .I a4)]), (.B p5, .Map [(.B n5, .I a5)])])) rd own)]
example (r : TxRest) (sigs inputs rd : Data) (own p1 n1 p2 n2 p3 n3 p4 n4 p5 n5 : ByteString) (a1 a2 a3 a4 a5 : Integer) :
    polLines11111Args r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 p5 n5 a1 a2 a3 a4 a5 =
      [toTerm (mintIn (r.withMint sigs inputs (mintOf [(p1, [(n1, a1)]), (p2, [(n2, a2)]), (p3, [(n3, a3)]), (p4, [(n4, a4)]), (p5, [(n5, a5)])])) rd own)] := rfl

#prep_uplc appliedPolLines5 seedelf polLines5Args 1500
#prep_uplc appliedPolLines14 seedelf polLines14Args 1500
#prep_uplc appliedPolLines23 seedelf polLines23Args 1500
#prep_uplc appliedPolLines113 seedelf polLines113Args 1500
#prep_uplc appliedPolLines32 seedelf polLines32Args 1500
#prep_uplc appliedPolLines122 seedelf polLines122Args 1500
#prep_uplc appliedPolLines212 seedelf polLines212Args 1500
#prep_uplc appliedPolLines1112 seedelf polLines1112Args 1500
#prep_uplc appliedPolLines41 seedelf polLines41Args 1500
#prep_uplc appliedPolLines131 seedelf polLines131Args 1500
#prep_uplc appliedPolLines221 seedelf polLines221Args 1500
#prep_uplc appliedPolLines1121 seedelf polLines1121Args 1500
#prep_uplc appliedPolLines311 seedelf polLines311Args 1500
#prep_uplc appliedPolLines1211 seedelf polLines1211Args 1500
#prep_uplc appliedPolLines2111 seedelf polLines2111Args 1500
#prep_uplc appliedPolLines11111 seedelf polLines11111Args 1500

-- The layouts above, in order: the compositions of 5, each once.
#guard compositions 5 == [[5], [1, 4], [2, 3], [1, 1, 3], [3, 2], [1, 2, 2], [2, 1, 2], [1, 1, 1, 2], [4, 1], [1, 3, 1], [2, 2, 1], [1, 1, 2, 1], [3, 1, 1], [1, 2, 1, 1], [2, 1, 1, 1], [1, 1, 1, 1, 1]]

-- Each builder's own run at its own limit (README rule 3), in PolicyAnyTxSteps' busy transaction:
-- the honest mint's line, then `polLinesAs`' further names and policies, reaches Error.
#guard endsInError (appliedPolLines5.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "x2" "x3" "x4" 1 1 1 1 1)
#guard endsInError (appliedPolLines14.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "x1" "x2" "x3" 1 1 1 1 1)
#guard endsInError (appliedPolLines23.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "q1" "x0" "x1" "x2" 1 1 1 1 1)
#guard endsInError (appliedPolLines113.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" "x1" "x2" 1 1 1 1 1)
#guard endsInError (appliedPolLines32.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "x2" "q1" "x0" "x1" 1 1 1 1 1)
#guard endsInError (appliedPolLines122.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "x1" "q2" "x0" "x1" 1 1 1 1 1)
#guard endsInError (appliedPolLines212.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "q1" "x0" "q2" "x0" "x1" 1 1 1 1 1)
#guard endsInError (appliedPolLines1112.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" "q3" "x0" "x1" 1 1 1 1 1)
#guard endsInError (appliedPolLines41.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "x2" "x3" "q1" "x0" 1 1 1 1 1)
#guard endsInError (appliedPolLines131.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "x1" "x2" "q2" "x0" 1 1 1 1 1)
#guard endsInError (appliedPolLines221.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "q1" "x0" "x1" "q2" "x0" 1 1 1 1 1)
#guard endsInError (appliedPolLines1121.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" "x1" "q3" "x0" 1 1 1 1 1)
#guard endsInError (appliedPolLines311.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "x2" "q1" "x0" "q2" "x0" 1 1 1 1 1)
#guard endsInError (appliedPolLines1211.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "x1" "q2" "x0" "q3" "x0" 1 1 1 1 1)
#guard endsInError (appliedPolLines2111.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "x1" "q1" "x0" "q2" "x0" "q3" "x0" 1 1 1 1 1)
#guard endsInError (appliedPolLines11111.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" "q3" "x0" "q4" "x0" 1 1 1 1 1)

theorem policy_fails_lines_5 :
  ∀ r sigs inputs rd own p1 n1 n2 n3 n4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines5.prop r sigs inputs rd own p1 n1 n2 n3 n4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_14 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 n3 n4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines14.prop r sigs inputs rd own p1 n1 p2 n2 n3 n4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_23 :
  ∀ r sigs inputs rd own p1 n1 n2 p2 n3 n4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines23.prop r sigs inputs rd own p1 n1 n2 p2 n3 n4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_113 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 p3 n3 n4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines113.prop r sigs inputs rd own p1 n1 p2 n2 p3 n3 n4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_32 :
  ∀ r sigs inputs rd own p1 n1 n2 n3 p2 n4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines32.prop r sigs inputs rd own p1 n1 n2 n3 p2 n4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_122 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 n3 p3 n4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines122.prop r sigs inputs rd own p1 n1 p2 n2 n3 p3 n4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_212 :
  ∀ r sigs inputs rd own p1 n1 n2 p2 n3 p3 n4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines212.prop r sigs inputs rd own p1 n1 n2 p2 n3 p3 n4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_1112 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines1112.prop r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_41 :
  ∀ r sigs inputs rd own p1 n1 n2 n3 n4 p2 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines41.prop r sigs inputs rd own p1 n1 n2 n3 n4 p2 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_131 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 n3 n4 p3 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines131.prop r sigs inputs rd own p1 n1 p2 n2 n3 n4 p3 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_221 :
  ∀ r sigs inputs rd own p1 n1 n2 p2 n3 n4 p3 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines221.prop r sigs inputs rd own p1 n1 n2 p2 n3 n4 p3 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_1121 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 p3 n3 n4 p4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines1121.prop r sigs inputs rd own p1 n1 p2 n2 p3 n3 n4 p4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_311 :
  ∀ r sigs inputs rd own p1 n1 n2 n3 p2 n4 p3 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines311.prop r sigs inputs rd own p1 n1 n2 n3 p2 n4 p3 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_1211 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 n3 p3 n4 p4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines1211.prop r sigs inputs rd own p1 n1 p2 n2 n3 p3 n4 p4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_2111 :
  ∀ r sigs inputs rd own p1 n1 n2 p2 n3 p3 n4 p4 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines2111.prop r sigs inputs rd own p1 n1 n2 p2 n3 p3 n4 p4 n5 a1 a2 a3 a4 a5) := by blaster
theorem policy_fails_lines_11111 :
  ∀ r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 p5 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines11111.prop r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 p5 n5 a1 a2 a3 a4 a5) := by blaster

-- A negative control: one step short of its Error, after 1224 steps (PolicyAnyTxSteps), the
-- longest run here is still going, and the same theorem over it comes back Falsified. So the
-- theorems above hold because the runs reach Error inside the limit.
#prep_uplc appliedPolLines11111Cut seedelf polLines11111Args 1223
#guard stillRunning (appliedPolLines11111Cut.exec busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" "q3" "x0" "q4" "x0" 1 1 1 1 1)
#guard endsInError (cekExecuteProgram seedelf.script (polLines11111Args busyTx (.List [.B vkh0]) busyTx.inputs (.B polTag) polId polId polMintName "q1" "x0" "q2" "x0" "q3" "x0" "q4" "x0" 1 1 1 1 1) 1224)
#blaster (gen-cex: 0) (solve-result: 1)
  [∀ r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 p5 n5 a1 a2 a3 a4 a5,
    isUnsuccessful (appliedPolLines11111Cut.prop r sigs inputs rd own p1 n1 p2 n2 p3 n3 p4 n4 p5 n5 a1 a2 a3 a4 a5)]

end Seedelf.V1
