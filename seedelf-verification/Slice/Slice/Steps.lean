import Slice.Common

/-! Concrete runs of the policy's rule for one mint line, as `#guard`s: each must end as stated,
or the build fails. In a transaction busy in every field the policy doesn't read, they check
that the spec `policyAccepts` and the deployed bytes agree with each other, with token_name.ak's
vectors, and with Aiken's evaluator: honest mints and an honest burn pass; a wrong name, two of
a token, and a first input at #256 or -1 fail. The comment beside each guard is
`aiken uplc eval -f ../concrete/build/seedelf.flat` on the same context, which the `#eval` at
the end prints in Aiken's syntax. Compiled, the slice alias is the slice itself (Common), so
these runs compute what the chain does.

They size the rule's step limit too: every run ends well inside `Run`'s 1500. `Run` also guards
its own run at that limit, and `Controls` the honest mint's at 1286 and 1287 steps and the burn
off #256's at 1114 and 1115, with the values defined here. -/

namespace Seedelf.V1
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)

/-- The deployed policy's id, 84967d91…, as the purpose and its mint line carry it. -/
def policyId : ByteString := ofHex "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255"
/-- Another transaction's id, for the other input, the reference input and the TxInfo's id. -/
def otherTxid : ByteString := ofHex "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
/-- A signer, AnyTxSteps' `keyA`. -/
def signer : ByteString := ofHex "ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

/-- An address paying the key `k`, as an output encodes it. -/
def pkhAddr (k : ByteString) : Data := .Constr 0 [.Constr 0 [.B k], .Constr 1 []]
/-- `n` lovelace, as a value encodes it. -/
def ada (n : Integer) : Data := .Map [(.B "", .Map [(.B "", .I n)])]

/-- A transaction busy in every field the policy doesn't read: a reference input, an output, a
fee, a certificate, a withdrawal, a finite range, the policy's own redeemer, a datum, an id,
votes, proposals and treasury fields. The ledger's shapes, made-up contents. Its `inputs` and
`mint` aren't used: `withMint` puts the scenario's in their place. -/
def busyMint : TxRest :=
  { inputs := .List [],
    referenceInputs := .List [.Constr 0 [.Constr 0 [.B otherTxid, .I 1],
      .Constr 0 [.Constr 0 [.Constr 1 [.B "r"], .Constr 1 []], .Map [], .Constr 0 [], .Constr 0 [.B "script"]]]],
    outputs := .List [.Constr 0 [pkhAddr "k", ada 4800000, .Constr 0 [], .Constr 1 []]],
    fee := .I 200000,
    mint := .Map [],
    certs := .List [.Constr 0 [.Constr 0 [.B "k"], .Constr 1 []]],
    withdrawals := .Map [(.Constr 1 [.B "w"], .I 0)],
    validRange := .Constr 0 [.Constr 0 [.Constr 1 [.I 1000], .Constr 1 []], .Constr 0 [.Constr 1 [.I 2000], .Constr 0 []]],
    redeemers := .Map [(.Constr 0 [.B policyId], .B "")],
    datums := .Map [(.B "h", .I 1)],
    txId := .B otherTxid,
    votes := .Map [],
    proposals := .List [],
    treasury := .Constr 1 [],
    donation := .Constr 0 [.I 5] }

/-- The busy transaction's signatories. -/
def busySigs : Data := .List [.B signer]
/-- What its first input holds. -/
def busyOut : Data := .Constr 0 [pkhAddr "k", ada 5000000, .Constr 0 [], .Constr 1 []]
/-- Its other input. -/
def busyRest : List Data :=
  [.Constr 0 [.Constr 0 [.B otherTxid, .I 3], .Constr 0 [pkhAddr "j", ada 2000000, .Constr 0 [], .Constr 1 []]]]

/-- `Rule`'s context in the busy transaction: the policy runs as `own`, with the tag `tag`, on
one line `amt` of `pid.tkn`, the first input `txid#idx`. -/
def busyMintCtx (own pid tkn tag txid : ByteString) (amt idx : Integer) : Data :=
  mintIn (busyMint.withMint busySigs (inputsFrom txid idx busyOut busyRest) (oneLine pid tkn amt)) (.B tag) own

/-! ### token_name.ak's vectors -/

/-- `generate(4172bf…, 0, 5eed0e1f, "")` (`real_token_name1`). -/
def name0 : ByteString := ofHex "5eed0e1f004172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce2361"
/-- `generate(4172bf…, 0, 5eed0e1f, acab)` (`real_token_name2`). -/
def nameAcab : ByteString := ofHex "5eed0e1facab004172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce"
/-- A tag of 17 bytes, past the 15 a name keeps. -/
def tag17 : ByteString := ofHex "0102030405060708090a0b0c0d0e0f1011"
/-- `generate(4172bf…, 0, 5eed0e1f, tag17)`: the tag's first 15 bytes, the index, and the id's
first 12. -/
def nameLong : ByteString := ofHex "5eed0e1f0102030405060708090a0b0c0d0e0f004172bf875e341da9ecc0f1f8"
/-- `generate(4172bf…, 255, 5eed0e1f, "")`. -/
def name255 : ByteString := ofHex "5eed0e1fff4172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce2361"

-- The reference `seedelfName` gives each, and nothing past a byte (`rollover_attack`'s #256).
#guard seedelfName exampleTxid 0 "" == some name0
#guard seedelfName exampleTxid 0 (ofHex "acab") == some nameAcab
#guard seedelfName exampleTxid 0 tag17 == some nameLong
#guard seedelfName exampleTxid 255 "" == some name255
#guard seedelfName exampleTxid 256 "" == none
#guard seedelfName exampleTxid (-1) "" == none

/-! ### The spec, the bytes and Aiken -/

/-- A run of the policy (as `policyId`) on one line of its own, `amt` of `tkn`, with the tag
`tag` and the first input `exampleTxid#idx`, in the busy transaction. -/
structure MintCase where
  tkn : ByteString
  tag : ByteString
  amt : Integer
  idx : Integer

def MintCase.ctx (c : MintCase) : Data := busyMintCtx policyId policyId c.tkn c.tag exampleTxid c.amt c.idx
/-- What the spec says of it. -/
def MintCase.accepted (c : MintCase) : Bool := policyAccepts policyId policyId c.tkn c.tag exampleTxid c.amt c.idx
/-- How the deployed bytes end on it, and after how many steps. -/
def MintCase.ending (c : MintCase) : String × Nat := endOf seedelfSlicePolicy c.ctx

def mintAt0 : MintCase := ⟨name0, "", 1, 0⟩
def mintAcab : MintCase := ⟨nameAcab, ofHex "acab", 1, 0⟩
def mintLongTag : MintCase := ⟨nameLong, tag17, 1, 0⟩
def mintAt255 : MintCase := ⟨name255, "", 1, 255⟩
def burnAt0 : MintCase := ⟨name0, "", -1, 0⟩
/-- `name0` minted with the tag acab, whose name is `nameAcab`. -/
def mintWrongName : MintCase := ⟨name0, ofHex "acab", 1, 0⟩
def mintTwo : MintCase := ⟨name0, "", 2, 0⟩
def burnAt256 : MintCase := ⟨name0, "", -1, 256⟩
def burnAtNeg1 : MintCase := ⟨name0, "", -1, -1⟩

-- Honest mints and an honest burn: the bytes return unit and the spec accepts.
#guard mintAt0.ending.1 == "unit" && mintAt0.accepted         -- aiken: (con unit ()), cpu 21395834, mem 72834
#guard mintAcab.ending.1 == "unit" && mintAcab.accepted       -- aiken: (con unit ()), cpu 21395834, mem 72834
#guard mintLongTag.ending.1 == "unit" && mintLongTag.accepted -- aiken: (con unit ()), cpu 21396357, mem 72837
#guard mintAt255.ending.1 == "unit" && mintAt255.accepted     -- aiken: (con unit ()), cpu 21395834, mem 72834
#guard burnAt0.ending.1 == "unit" && burnAt0.accepted         -- aiken: (con unit ()), cpu 21395834, mem 72834
-- A wrong name and two of a token: `xor` is false, the final `error`. Off a byte, the mint's
-- block fails at consByteString, the burn's own checks passing.
#guard mintWrongName.ending.1 == "error" && !mintWrongName.accepted -- aiken: Error, "the validator crashed / exited prematurely"
#guard mintTwo.ending.1 == "error" && !mintTwo.accepted       -- aiken: Error, "the validator crashed / exited prematurely"
#guard burnAt256.ending.1 == "error" && !burnAt256.accepted   -- aiken: Error, "attempt to consByteString something than isn't a byte between [0-255]"
#guard burnAtNeg1.ending.1 == "error" && !burnAtNeg1.accepted -- aiken: Error, "attempt to consByteString something than isn't a byte between [0-255]"

def cases : List (String × MintCase) :=
  [("mint #0, no tag", mintAt0), ("mint #0, tag acab", mintAcab), ("mint #0, 17-byte tag", mintLongTag),
   ("mint #255, no tag", mintAt255), ("burn #0", burnAt0), ("mint #0, wrong name", mintWrongName),
   ("mint #0, amount 2", mintTwo), ("burn #256", burnAt256), ("burn #-1", burnAtNeg1)]

-- Every run ends inside `Run`'s limit.
#guard cases.all fun c => c.2.ending.2 < 1500
#eval do
  for (label, c) in cases do
    IO.println s!"{label}: {c.ending.1} after {c.ending.2}"

/-! ### Each context in Aiken's syntax -/

def commas (xs : List String) : String := ", ".intercalate xs

/-- Two hex digits a byte. -/
def hexOf (b : ByteString) : String :=
  let d := "0123456789abcdef".toList
  String.join (b.data.toList.map fun c => String.mk [d[c.toNat / 16]!, d[c.toNat % 16]!])

/-- `d` as `aiken uplc eval` reads a `data` constant. -/
partial def aikenText : Data → String
  | .Constr n fs => s!"Constr {n} [{commas (fs.map aikenText)}]"
  | .Map kvs => s!"Map [{commas (kvs.map fun kv => s!"({aikenText kv.1}, {aikenText kv.2})")}]"
  | .List xs => s!"List [{commas (xs.map aikenText)}]"
  | .I i => s!"I {i}"
  | .B b => s!"B #{hexOf b}"

-- `aiken uplc eval -f ../concrete/build/seedelf.flat '(con data (…))'`, one context a line.
#eval do
  for (label, c) in cases do
    IO.println s!"{label}: (con data ({aikenText c.ctx}))"

end Seedelf.V1
