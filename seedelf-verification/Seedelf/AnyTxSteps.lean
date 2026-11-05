import Seedelf.AnyTx
import Seedelf.Steps

/-! Concrete runs in the `…AnyTx` scenarios' encoding, as `#guard`s: each must end as stated,
or the build fails. They check that encoding against a real spend, Steps.lean's valid Register
spend (`seedelf-crypto`'s proof for the secret 0x5eed0e1f, which Aiken's evaluator accepts on
the deployed bytes), here inside a transaction busy in every field. They size the step limits
too: every run ends well inside its module's. Each theorem module also guards its own
builder's `NAME.exec` at its own limit, with the values defined here. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)

/-- A transaction busy in every field: an input, a reference input, an output, a fee, a burn,
a certificate, a withdrawal, a finite range, a redeemer, a datum, an id, votes, proposals and
treasury fields. The ledger's shapes, made-up contents. -/
def busyTx : TxRest :=
  { inputs := .List [.Constr 0 [.Constr 0 [.B txid, .I 0],
      .Constr 0 [.Constr 0 [.Constr 1 [.B "s"], .Constr 1 []], .Map [(.B "", .Map [(.B "", .I 5000000)])],
        .Constr 2 [.Constr 0 [.B g1, .B u0]], .Constr 1 []]]],
    referenceInputs := .List [.Constr 0 [.Constr 0 [.B txid, .I 1],
      .Constr 0 [.Constr 0 [.Constr 1 [.B "r"], .Constr 1 []], .Map [], .Constr 0 [], .Constr 0 [.B "script"]]]],
    outputs := .List [.Constr 0 [.Constr 0 [.Constr 0 [.B "k"], .Constr 1 []],
      .Map [(.B "", .Map [(.B "", .I 4800000)])], .Constr 0 [], .Constr 1 []]],
    fee := .I 200000,
    mint := .Map [(.B "p", .Map [(.B "\x5e\xed\x0e\x1f", .I (-1))])],
    certs := .List [.Constr 0 [.Constr 0 [.B "k"], .Constr 1 []]],
    withdrawals := .Map [(.Constr 1 [.B "w"], .I 0)],
    validRange := .Constr 0 [.Constr 0 [.Constr 1 [.I 1000], .Constr 1 []], .Constr 0 [.Constr 1 [.I 2000], .Constr 0 []]],
    redeemers := .Map [(.Constr 1 [.Constr 0 [.B txid, .I 0]], .Constr 0 [.B z0, .B gr0, .B vkh0])],
    datums := .Map [(.B "h", .I 1)],
    txId := .B txid,
    votes := .Map [],
    proposals := .List [],
    treasury := .Constr 1 [],
    donation := .Constr 0 [.I 5] }

def spentRef : Data := .Constr 0 [.B txid, .I 0]
def registerDatum : Data := datumSome (.Constr 0 [.B g1, .B u0])
def proofWith (z : ByteString) : Data := .Constr 0 [.B z, .B gr0, .B vkh0]
/-- Steps.lean's `z0`, its last nibble changed. -/
def zChanged0 : ByteString := ofHex "056ef908426282c4880583e64182838825d5d1de34eef032d26ac5b4244ad9a7"
def keyA : ByteString := ofHex "ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
def keyB : ByteString := ofHex "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
def keyC : ByteString := ofHex "dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

def busySpend (z : ByteString) (sigs : List Data) : Data :=
  spendIn (busyTx.info sigs) (proofWith z) spentRef registerDatum

def showEnd (e : String × Nat) : String := s!"{e.1} after {e.2}"

-- WalletAnyTx, WalletAnyTxTwo, WalletAnyTxThree (2500 steps)
#guard (endOf wallet (busySpend z0 [.B vkh0])).1 == "unit"
#guard (endOf wallet (busySpend zChanged0 [.B vkh0])).1 == "error"
#guard (endOf wallet (busySpend z0 [.B keyA])).1 == "error"
#guard (endOf wallet (busySpend z0 [])).1 == "error"
#guard (endOf wallet (busySpend z0 [.B keyA, .B vkh0])).1 == "unit"
#guard (endOf wallet (busySpend z0 [.B vkh0, .B keyA])).1 == "unit"
#guard (endOf wallet (busySpend z0 [.B keyA, .B keyB])).1 == "error"
#guard (endOf wallet (busySpend z0 [.B keyA, .B keyB, .B vkh0])).1 == "unit"
#guard (endOf wallet (busySpend z0 [.B keyA, .B keyB, .B keyC])).1 == "error"
#guard (endOf wallet (busySpend z0 [.B keyA, .B keyB, .B keyC])).2 < 2500
#guard (endOf wallet (busySpend z0 [.B keyA, .B keyB, .B vkh0])).2 < 2500
#eval s!"any tx, valid, one signer:        {showEnd (endOf wallet (busySpend z0 [.B vkh0]))}"
#eval s!"any tx, valid, key third of three: {showEnd (endOf wallet (busySpend z0 [.B keyA, .B keyB, .B vkh0]))}"
#eval s!"any tx, valid, key not among three: {showEnd (endOf wallet (busySpend z0 [.B keyA, .B keyB, .B keyC]))}"

-- WalletNoLockAnyTx (800 steps): off the Register branch the TxInfo isn't read at all, so a
-- TxInfo that isn't one still passes.
#guard (endOf wallet (spendIn (.I 7) (proofWith z0) spentRef datumNone)).1 == "unit"
#guard (endOf wallet (spendIn (.I 7) (proofWith z0) spentRef (datumSome (.B "!0!")))).1 == "unit"
#guard (endOf wallet (spendIn (busyTx.info []) (proofWith z0) (.I 3) (datumSome (.Constr 0 [.B g1, .B g1, .B g1])))).1 == "unit"
#guard (endOf wallet (spendIn (.I 7) (proofWith z0) spentRef (datumSome (.Constr 0 [.B g1, .B g1, .B g1])))).2 < 800

-- WalletPurposeAnyTx (500 steps)
#guard (endOf wallet (.Constr 0 [.I 7, .I 0, .Constr 0 [.B ""]])).1 == "error"
#guard (endOf wallet (.Constr 0 [busyTx.info [.B vkh0], proofWith z0, .Constr 2 [.Constr 1 [.B "w"]]])).1 == "error"
#guard (endOf wallet (.Constr 0 [.I 7, .I 0, .Constr 0 [.B ""]])).2 < 500

-- AlwaysFalseAnyTx (500 steps): not even a context, or a valid spend's.
#guard (endOf alwaysFalse (.I 0)).1 == "error"
#guard (endOf alwaysFalse (busySpend z0 [.B vkh0])).1 == "error"
#guard (endOf alwaysFalse (busySpend z0 [.B vkh0])).2 < 500

end Seedelf.V1
