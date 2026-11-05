import Lovejoin.Logic
import Lovejoin.Template.Launch
import Blaster

/-! OPTIONAL, an auditor's suggestion (not part of the suite). It runs with
`./check.sh audit-gaps` (alone, `./check.sh Audit.Gaps.Classic.ClassicMint`).

The classic pool's own NFT policy, f5592689… (`Lovejoin.Classic.oneShotMint`, Lovejoin
c1239fb, fully applied at the seed ba815aa5…#2 and reference_holder 288fea77…), which the
`Lovejoin.Template` theorems don't cover: its source predates 8131b1d's (a five-field
`ReferenceDatum`, no `token_sane`). The launch is `Lovejoin.Template.launchCtx`'s shape,
one input, one mint, one output, with the deployed five-field datum. The policy is fully
applied, so the context is its only argument.

`classic_nft_launch_halts` keeps the others from being vacuous: the honest launch halts. -/

namespace Lovejoin.Classic
open CardanoLedgerApi.IsData.Class (toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils
open Seedelf.V1 (ofHex)
open Lovejoin.Template (launchCtx mintOf refAt refOut nftName)

/-- The classic pool's seed transaction; the seed is its output 2. -/
def classicSeedTx : ByteString := ofHex "ba815aa54b022a347a3e5e84d5491334cf6f878916eebeeb7f9014da9dc369bb"

/-- A launch spending `⟨s', i'⟩` alone: one `lovejoin` under the classic policy, to
reference_holder, under the deployed datum. -/
def classicNftLaunchArgs (s' : ByteString) (i' : Integer) : List Term :=
  [toTerm (launchCtx ⟨s', i'⟩ nftPolicy (mintOf nftPolicy nftName 1)
    (refAt referenceHolderHash nftPolicy referenceDatum))]

/-- The seed spent, `qty` of the name `nm` minted and held at reference_holder. -/
def classicNftAmountArgs (nm : ByteString) (qty : Integer) : List Term :=
  [toTerm (launchCtx ⟨classicSeedTx, 2⟩ nftPolicy (mintOf nftPolicy nm qty)
    (refOut (.ScriptCredential referenceHolderHash) none nftPolicy nm referenceDatum none))]

/-- The seed spent, two names minted under the policy. -/
def classicNftTwoNamesArgs (n1 n2 : ByteString) (q1 q2 : Integer) : List Term :=
  [toTerm (launchCtx ⟨classicSeedTx, 2⟩ nftPolicy
    [(Data.B nftPolicy, Data.Map [(Data.B n1, Data.I q1), (Data.B n2, Data.I q2)])]
    (refAt referenceHolderHash nftPolicy referenceDatum))]

/-- The seed spent, the NFT paid to credential `c`, stake `st`, reference script `r`. -/
def classicNftPlaceArgs (c : Credential) (st : Option StakingCredential) (r : Option ByteString) :
    List Term :=
  [toTerm (launchCtx ⟨classicSeedTx, 2⟩ nftPolicy (mintOf nftPolicy nftName 1)
    (refOut c st nftPolicy nftName referenceDatum r))]

/-- The seed spent, the NFT at reference_holder under the five-field datum
`Constr 0 [d, mf, m, l, f]`. -/
def classicNftDatumArgs (d mf : Integer) (m l f : ByteString) : List Term :=
  [toTerm (launchCtx ⟨classicSeedTx, 2⟩ nftPolicy (mintOf nftPolicy nftName 1)
    (refAt referenceHolderHash nftPolicy (.Constr 0 [.I d, .I mf, .B m, .B l, .B f])))]

#prep_uplc classicNftLaunch oneShotMint classicNftLaunchArgs 5000
#prep_uplc classicNftAmount oneShotMint classicNftAmountArgs 5000
#prep_uplc classicNftTwoNames oneShotMint classicNftTwoNamesArgs 5000
#prep_uplc classicNftPlace oneShotMint classicNftPlaceArgs 5000
#prep_uplc classicNftDatum oneShotMint classicNftDatumArgs 5000

/-- The honest launch, the seed spent, halts. -/
theorem classic_nft_launch_halts : isSuccessful (classicNftLaunch.prop classicSeedTx 2) := by blaster

/-- A mint without the classic seed spent fails: with the seed spent on chain, the
classic policy can never mint again. -/
theorem classic_nft_needs_the_seed : ∀ (s' : ByteString) (i' : Integer),
    (s' ≠ classicSeedTx ∨ i' ≠ 2) → isUnsuccessful (classicNftLaunch.prop s' i') := by blaster

/-- A mint of any other name, or any other quantity, fails. -/
theorem classic_nft_is_one_token_named_lovejoin : ∀ (nm : ByteString) (qty : Integer),
    (nm ≠ nftName ∨ qty ≠ 1) → isUnsuccessful (classicNftAmount.prop nm qty) := by blaster

/-- So does a mint of two names under the policy. -/
theorem classic_nft_is_alone_under_its_policy : ∀ (n1 n2 : ByteString) (q1 q2 : Integer),
    isUnsuccessful (classicNftTwoNames.prop n1 n2 q1 q2) := by blaster

/-- And one whose token lands anywhere but reference_holder, or there with a stake part
or a reference script. -/
theorem classic_nft_lands_at_reference_holder : ∀ (c : Credential)
    (st : Option StakingCredential) (r : Option ByteString),
    (c ≠ .ScriptCredential referenceHolderHash ∨ st ≠ none ∨ r ≠ none) →
      isUnsuccessful (classicNftPlace.prop c st r) := by blaster

/-- And one whose five-field datum isn't sane (c1239fb: denom > 0, fee cap > 0, cap < denom). -/
theorem classic_nft_needs_a_sane_datum : ∀ (d mf : Integer) (m l f : ByteString),
    ¬ (d > 0 ∧ mf > 0 ∧ mf < d) → isUnsuccessful (classicNftDatum.prop d mf m l f) := by blaster

end Lovejoin.Classic
