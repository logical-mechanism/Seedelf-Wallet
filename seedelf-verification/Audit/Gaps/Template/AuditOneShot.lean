import Lovejoin.Template.Launch
import Blaster

/-! Audit (templates), not part of the suite: one_shot_mint's checks that
`Template.OneShotMint` never varies, each on `launchCtx` with one thing changed:

- the seed referenced, not spent (`self.inputs |> list.any(…)`: a seed can be referenced by any
  number of transactions, so this is what the spend-once argument rests on; no scenario has a
  reference input);
- the reference output's datum isn't inline (`expect InlineDatum(datum_data) = target.datum`);
- three names under the policy (`expect [Pair(asset_name, quantity)]`; the suite has two);
- the NFT itself paid elsewhere while reference_holder gets another policy's `lovejoin`
  (`output_at_reference_holder` reads the running policy, not just the name).

Built in place as `Audit.Gaps.Template.AuditOneShot`, in `./check.sh audit-gaps`, or alone,
`./check.sh Audit.Gaps.Template.AuditOneShot`. Expected: five `✅ Valid`. The passing run they pair with is
`AuditPasses.nft_launch_halts`. -/

namespace Lovejoin.Template.AuditOneShot
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Lovejoin.Template

/-- `launchCtx` with the outputs `outs`. -/
def launchCtxO (inRef : TxOutRef) (P : ByteString) (mint : Value) (outs : List TxOut) : ScriptContext :=
  let tx := { Seedelf.V1.emptyTx with
    txInfoInputs  := [⟨inRef, Seedelf.V1.someOutput⟩],
    txInfoMint    := mint,
    txInfoOutputs := outs }
  ⟨tx, Data.Constr 0 [], .MintingScript P⟩

/-- `launchCtx` with the input `inRef` spent and the reference inputs `refs`. -/
def launchCtxR (inRef : TxOutRef) (refs : List TxInInfo) (P : ByteString) (mint : Value) (out : TxOut) : ScriptContext :=
  let tx := { Seedelf.V1.emptyTx with
    txInfoInputs          := [⟨inRef, Seedelf.V1.someOutput⟩],
    txInfoReferenceInputs := refs,
    txInfoMint            := mint,
    txInfoOutputs         := [out] }
  ⟨tx, Data.Constr 0 [], .MintingScript P⟩

def args (s : ByteString) (i : Integer) (rh : ByteString) (ctx : ScriptContext) : List Term :=
  [toTerm s, toTerm i, toTerm rh, toTerm ctx]

/-- `refAt`'s output with the datum `d` as it's stored. -/
def refStored (rh P : ByteString) (d : OutputDatum) : TxOut :=
  ⟨⟨.ScriptCredential rh, none⟩, [(Data.B "", Data.Map [(Data.B "", Data.I 2000000)]), (Data.B P, Data.Map [(Data.B nftName, Data.I 1)])],
   d, none⟩

/-- The seed `(s, i)` as a reference input; the one input spent is `(s', i')`. -/
def seedReferencedArgs (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer) : List Term :=
  args s i rh (launchCtxR ⟨s', i'⟩ [⟨⟨s, i⟩, Seedelf.V1.someOutput⟩] P (mintOf P nftName 1) (refAt rh P))
def byHashArgs (s : ByteString) (i : Integer) (rh P h : ByteString) : List Term :=
  args s i rh (launchCtxO ⟨s, i⟩ P (mintOf P nftName 1) [refStored rh P (.OutputDatumHash h)])
def noDatumArgs (s : ByteString) (i : Integer) (rh P : ByteString) : List Term :=
  args s i rh (launchCtxO ⟨s, i⟩ P (mintOf P nftName 1) [refStored rh P .NoOutputDatum])
def threeNamesArgs (s : ByteString) (i : Integer) (rh P n1 n2 n3 : ByteString) (q1 q2 q3 : Integer) : List Term :=
  args s i rh (launchCtxO ⟨s, i⟩ P [(Data.B P, Data.Map [(Data.B n1, Data.I q1), (Data.B n2, Data.I q2), (Data.B n3, Data.I q3)])]
    [refAt rh P])
/-- The NFT `(P, lovejoin)` to the key `k`, and reference_holder given `(Q, lovejoin)`. -/
def nftElsewhereArgs (s : ByteString) (i : Integer) (rh P Q k : ByteString) : List Term :=
  args s i rh (launchCtxO ⟨s, i⟩ P (mintOf P nftName 1)
    [refOut (.ScriptCredential rh) none Q nftName saneDatum none, refOut (.PubKeyCredential k) none P nftName saneDatum none])

#prep_uplc appliedAuditNftSeedReferenced oneShotMintTemplate seedReferencedArgs 5000
#prep_uplc appliedAuditNftByHash oneShotMintTemplate byHashArgs 5000
#prep_uplc appliedAuditNftNoDatum oneShotMintTemplate noDatumArgs 5000
#prep_uplc appliedAuditNftThreeNames oneShotMintTemplate threeNamesArgs 5000
#prep_uplc appliedAuditNftElsewhere oneShotMintTemplate nftElsewhereArgs 5000

/-- A seed that's only referenced isn't spent: the mint fails. -/
theorem nft_needs_the_seed_spent_not_referenced : ∀ (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer),
    (s' ≠ s ∨ i' ≠ i) → isUnsuccessful (appliedAuditNftSeedReferenced.prop s i rh P s' i') := by blaster

theorem nft_needs_an_inline_datum_not_a_hash : ∀ (s : ByteString) (i : Integer) (rh P h : ByteString),
    isUnsuccessful (appliedAuditNftByHash.prop s i rh P h) := by blaster

theorem nft_needs_a_datum : ∀ (s : ByteString) (i : Integer) (rh P : ByteString),
    isUnsuccessful (appliedAuditNftNoDatum.prop s i rh P) := by blaster

theorem nft_is_alone_under_its_policy_of_three : ∀ (s : ByteString) (i : Integer) (rh P n1 n2 n3 : ByteString)
    (q1 q2 q3 : Integer), isUnsuccessful (appliedAuditNftThreeNames.prop s i rh P n1 n2 n3 q1 q2 q3) := by blaster

theorem nft_itself_lands_at_reference_holder : ∀ (s : ByteString) (i : Integer) (rh P Q k : ByteString),
    Q ≠ P → isUnsuccessful (appliedAuditNftElsewhere.prop s i rh P Q k) := by blaster

end Lovejoin.Template.AuditOneShot
