import Lovejoin.Template.Fee
import Blaster

/-! fee_contract's template, for every pool: the pool's NFT policy `P`, its fee cap and the
amounts symbolic. A shard pays a Mix's fee, exactly, and at most the cap: it loses the
transaction's fee to its one fee output and nothing else. It pays only for a Mix
(mix_logic's `Mix`, not `Owner`) of three boxes or more. Replenished, it only grows. So
the pool's donations can't leave the contract except as a Mix's fee.

The scenario spends one shard (`fee_input_count == 1`) with one fee output. The step limit
sits above `Template.Steps`' runs. -/

namespace Lovejoin.Template
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

def feeArgs (P : ByteString) (ctx : CardanoLedgerApi.V3.ScriptContext) : List Term :=
  [toTerm P, toTerm nftName, toTerm ctx]

def feePayArgs (P : ByteString) (cap fi fo f : Integer) : List Term :=
  feeArgs P (feeCtx P cap fi threeBoxes fo f (some mixRedeemerData) payMixFee)
def feeTwoBoxesArgs (P : ByteString) (cap fi fo f : Integer) : List Term :=
  feeArgs P (feeCtx P cap fi twoBoxes fo f (some mixRedeemerData) payMixFee)
def feeOwnerArgs (P : ByteString) (cap fi fo f : Integer) : List Term :=
  feeArgs P (feeCtx P cap fi threeBoxes fo f (some ownerRedeemerData) payMixFee)
def feeNoMixArgs (P : ByteString) (cap fi fo f : Integer) : List Term :=
  feeArgs P (feeCtx P cap fi threeBoxes fo f none payMixFee)
def feeReplenishArgs (P : ByteString) (fi fo : Integer) : List Term :=
  feeArgs P (feeCtx P 1000000 fi [] fo 0 none replenish)

#prep_uplc appliedFeePay feeContractTemplate feePayArgs 8000
#prep_uplc appliedFeeTwoBoxes feeContractTemplate feeTwoBoxesArgs 8000
#prep_uplc appliedFeeOwner feeContractTemplate feeOwnerArgs 8000
#prep_uplc appliedFeeNoMix feeContractTemplate feeNoMixArgs 8000
#prep_uplc appliedFeeReplenish feeContractTemplate feeReplenishArgs 8000

/-- A shard that loses anything but the transaction's fee, or a fee above the cap, fails. -/
theorem shard_pays_exactly_the_fee : ∀ (P : ByteString) (cap fi fo f : Integer),
    (fi - fo ≠ f ∨ f > cap) → isUnsuccessful (appliedFeePay.prop P cap fi fo f) := by blaster

/-- It pays for no Mix of fewer than three boxes. -/
theorem shard_needs_three_boxes : ∀ (P : ByteString) (cap fi fo f : Integer),
    isUnsuccessful (appliedFeeTwoBoxes.prop P cap fi fo f) := by blaster

/-- Nor for an Owner withdrawal. -/
theorem shard_pays_no_withdrawal : ∀ (P : ByteString) (cap fi fo f : Integer),
    isUnsuccessful (appliedFeeOwner.prop P cap fi fo f) := by blaster

/-- Nor without mix_logic running at all. -/
theorem shard_needs_mix_logic : ∀ (P : ByteString) (cap fi fo f : Integer),
    isUnsuccessful (appliedFeeNoMix.prop P cap fi fo f) := by blaster

/-- Replenished, a shard that doesn't grow fails. -/
theorem shard_only_grows : ∀ (P : ByteString) (fi fo : Integer),
    fo ≤ fi → isUnsuccessful (appliedFeeReplenish.prop P fi fo) := by blaster

end Lovejoin.Template
