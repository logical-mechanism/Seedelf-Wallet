import Lovejoin.Template.Launch
import Blaster

/-! one_shot_mint's template, for every launch: the seed's transaction `s` and index `i`,
reference_holder's hash `rh` and the policy `P` all symbolic. A mint succeeds only with the
seed spent, exactly one token, named `lovejoin`, and that token at reference_holder, with
no stake part or reference script, under a sane inline `ReferenceDatum`.

A seed can be spent once (the ledger's rule), and each mint makes exactly one token, so a
pool's NFT can exist only once. reference_holder fails for every purpose
(`Lovejoin.ReferenceHolder`), so it never moves, and the pool's `ReferenceDatum` is
fixed. That's what mix_logic's reference lookup leans on. The scenario has one input and
one output. The step limit sits above `Template.Steps`' launch. -/

namespace Lovejoin.Template
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- The template's parameters, then the launch. -/
def launchArgs (s : ByteString) (i : Integer) (rh : ByteString) (ctx : ScriptContext) : List Term :=
  [toTerm s, toTerm i, toTerm rh, toTerm ctx]

def nftAmountArgs (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer) : List Term :=
  launchArgs s i rh (launchCtx ⟨s, i⟩ P (mintOf P nm qty) (refOut (.ScriptCredential rh) none P nm saneDatum none))

def nftSeedArgs (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer) : List Term :=
  launchArgs s i rh (launchCtx ⟨s', i'⟩ P (mintOf P nftName 1) (refAt rh P))

def nftTwoNamesArgs (s : ByteString) (i : Integer) (rh P n1 n2 : ByteString) (q1 q2 : Integer) : List Term :=
  launchArgs s i rh (launchCtx ⟨s, i⟩ P [(Data.B P, Data.Map [(Data.B n1, Data.I q1), (Data.B n2, Data.I q2)])] (refAt rh P))

def nftPlaceArgs (s : ByteString) (i : Integer) (rh P : ByteString) (c : Credential) (st : Option StakingCredential)
    (r : Option ByteString) : List Term :=
  launchArgs s i rh (launchCtx ⟨s, i⟩ P (mintOf P nftName 1) (refOut c st P nftName saneDatum r))

def nftDatumArgs (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer) (tp tn : ByteString)
    (tq mf : Integer) : List Term :=
  launchArgs s i rh (launchCtx ⟨s, i⟩ P (mintOf P nftName 1) (refAt rh P (refDatum bl tp tn tq mf "m" "l" "f")))

#prep_uplc appliedNftAmount oneShotMintTemplate nftAmountArgs 5000
#prep_uplc appliedNftSeed oneShotMintTemplate nftSeedArgs 5000
#prep_uplc appliedNftTwoNames oneShotMintTemplate nftTwoNamesArgs 5000
#prep_uplc appliedNftPlace oneShotMintTemplate nftPlaceArgs 5000
#prep_uplc appliedNftDatum oneShotMintTemplate nftDatumArgs 5000

/-- A mint of any other name, or of any other quantity (two, or a burn), fails. -/
theorem nft_is_one_token_named_lovejoin : ∀ (s : ByteString) (i : Integer) (rh P nm : ByteString) (qty : Integer),
    (nm ≠ nftName ∨ qty ≠ 1) → isUnsuccessful (appliedNftAmount.prop s i rh P nm qty) := by blaster

/-- A mint without the seed spent fails. -/
theorem nft_needs_the_seed : ∀ (s : ByteString) (i : Integer) (rh P s' : ByteString) (i' : Integer),
    (s' ≠ s ∨ i' ≠ i) → isUnsuccessful (appliedNftSeed.prop s i rh P s' i') := by blaster

/-- So does a mint of two names under the policy, whatever they and their quantities are. -/
theorem nft_is_alone_under_its_policy : ∀ (s : ByteString) (i : Integer) (rh P n1 n2 : ByteString) (q1 q2 : Integer),
    isUnsuccessful (appliedNftTwoNames.prop s i rh P n1 n2 q1 q2) := by blaster

/-- And one whose token lands anywhere but reference_holder, or there with a stake part or
a reference script. -/
theorem nft_lands_at_reference_holder : ∀ (s : ByteString) (i : Integer) (rh P : ByteString) (c : Credential)
    (st : Option StakingCredential) (r : Option ByteString),
    (c ≠ .ScriptCredential rh ∨ st ≠ none ∨ r ≠ none) → isUnsuccessful (appliedNftPlace.prop s i rh P c st r) := by blaster

/-- And one whose `ReferenceDatum` isn't sane: boxes of some lovelace, a fee cap above 0 and
below a box, and either no token or a real one (a 28-byte policy, a name of at most 32
bytes, a quantity in a u64). -/
theorem nft_needs_a_sane_datum : ∀ (s : ByteString) (i : Integer) (rh P : ByteString) (bl : Integer)
    (tp tn : ByteString) (tq mf : Integer),
    ¬ (bl > 0 ∧ mf > 0 ∧ mf < bl ∧
        ((tp = "" ∧ tn = "" ∧ tq = 0) ∨
          (tp ≠ "" ∧ lengthOfByteString tp = 28 ∧ lengthOfByteString tn ≤ 32 ∧ tq > 0 ∧ tq ≤ 18446744073709551615))) →
      isUnsuccessful (appliedNftDatum.prop s i rh P bl tp tn tq mf) := by blaster

end Lovejoin.Template
