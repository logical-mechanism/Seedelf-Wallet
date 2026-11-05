import Lovejoin.Owner
import Lovejoin.Steps
import Audit.Classic.MutantScripts
import Audit.Classic.Common
import Blaster

/-! Audit finding F-4's binding, with the input ref symbolic. In every classic Owner scenario the
inputs' refs are constants (`boxRef = ⟨"", 0⟩`; `OwnClassic*`'s `a0a0…#0`, `f0f0…#0`), so
`serialise(input refs)` is one fixed, unknown string to the solver: the theorems show the script
hashes that string, not that it reads the refs from the transaction. A script hashing the
literal `serialise([⟨"", 0⟩])` would pass them all. Here the box sits at any `⟨tx, ix⟩`.

Expected: 2 `#guard`s pass, **1 "✅ Expected Falsified" line and 2 "✅ Valid" lines**.

- [A-R0a..b] Concretely: the honest vector halts with the box at `⟨"", 0⟩`, the ref it was made
  for, and errors with the same box at `⟨"x", 0⟩`: the proof doesn't follow the box elsewhere.
- [A-R1] `owner_withdraws_iff_proof` for every box ref (generalization). Valid closes the gap.
- [A-R2] A withdrawal that succeeds with the box at `⟨tx, ix⟩` also succeeds at `⟨tx', ix⟩`,
  the same proof: Falsified on the deployed script. A Valid result would mean the input refs
  don't bind the proof, which is F-4's fix.
- [A-R3] The same on the mutant that leaves the refs out of `ctx`: Valid, since that script
  never looks at the refs. With [A-R2] it shows the solver sees exactly the refs' part of `ctx`. -/

namespace Audit.Classic
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (emptyTx g1 ofHex)
open Lovejoin.Classic (box mixDatum referenceInput mixLogicHash ownerContext wellFormed schnorrVerifies payout
  ownerVector)

/-- `Lovejoin.Classic.ownerCtx` with the box at `r`. -/
def ownerCtxAt (r : TxOutRef) (a b t z : ByteString) (out : TxOut) : ScriptContext :=
  let tx := { emptyTx with
    txInfoInputs          := [⟨r, box (.OutputDatum (mixDatum a b))⟩],
    txInfoReferenceInputs := [referenceInput],
    txInfoOutputs         := [out],
    txInfoWdrl            := [(.ScriptCredential mixLogicHash, 0)] }
  ⟨tx, .Constr 0 [.List [.Constr 0 [.B t, .B z]]], .RewardingScript (.ScriptCredential mixLogicHash)⟩

/-- `Lovejoin.Classic.ownerAccepts` with the box at `r`. -/
def ownerAcceptsAt (r : TxOutRef) (a b t z : ByteString) (out : TxOut) : Bool :=
  wellFormed a b &&
    match ownerContext (IsData.toData ([out] : List TxOut)) (Data.List [IsData.toData r]) with
    | some ctx => schnorrVerifies a b t z ctx
    | none => false

def ownerArgsAt (tx : ByteString) (ix : Integer) (a b t z pkh : ByteString) (amt : Integer) : List Term :=
  [toTerm (ownerCtxAt ⟨tx, ix⟩ a b t z (payout pkh amt))]

#prep_uplc auditClassicOwnerAnyRef mixLogic Audit.Classic.ownerArgsAt 10000
#prep_uplc auditClassicOwnerAnyRefNoRefs auditClassicMixLogicNoRefs Audit.Classic.ownerArgsAt 10000

def anyRefPkh0 : ByteString := ofHex "00112233445566778899aabbccddeeff00112233445566778899aabb"

-- [A-R0a] The honest vector, at the ref it was made for.
#guard match ownerVector with
  | some (b, t, z) => haltedUnitB (auditClassicOwnerAnyRef.exec "" 0 g1 b t z anyRefPkh0 9000000)
  | none => false

-- [A-R0b] The same proof with the box at another ref.
#guard match ownerVector with
  | some (b, t, z) => erroredB (auditClassicOwnerAnyRef.exec "x" 0 g1 b t z anyRefPkh0 9000000)
  | none => false

-- [A-R2] The proof carries over to the box at another transaction: expected Falsified.
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (tx tx' : ByteString) (ix : Integer) (a b t z pkh : ByteString)
    (amt : Integer),
  isSuccessful (auditClassicOwnerAnyRef.prop tx ix a b t z pkh amt) →
    isSuccessful (auditClassicOwnerAnyRef.prop tx' ix a b t z pkh amt)]

/-- [A-R1] `owner_withdraws_iff_proof`, for the box at any ref. -/
theorem audit_owner_iff_any_ref : ∀ (tx : ByteString) (ix : Integer) (a b t z pkh : ByteString) (amt : Integer),
    isSuccessful (auditClassicOwnerAnyRef.prop tx ix a b t z pkh amt) ↔
      ownerAcceptsAt ⟨tx, ix⟩ a b t z (payout pkh amt) = true := by
  blaster (timeout: 540)

/-- [A-R3] The no-refs mutant's acceptance doesn't depend on where the box is. -/
theorem audit_no_refs_mutant_ignores_the_ref :
    ∀ (tx tx' : ByteString) (ix : Integer) (a b t z pkh : ByteString) (amt : Integer),
      isSuccessful (auditClassicOwnerAnyRefNoRefs.prop tx ix a b t z pkh amt) →
        isSuccessful (auditClassicOwnerAnyRefNoRefs.prop tx' ix a b t z pkh amt) := by
  blaster (timeout: 540)

end Audit.Classic
