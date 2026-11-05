import PlutusCore.UPLC

/-! The Template audit's mutant templates. No checks here (see `Audit.Classic.MutantScripts`).

Lovejoin v2 (`../lovejoin-v2` 5cc3631) `contracts/`, built with Aiken v1.1.24 in a scratch
copy. Unchanged, that build reproduces every `Lovejoin/Template/Scripts/*.hex` byte for byte
(one_shot_mint 6878ed6f…, fee_contract 3698bbfd…, mix_box 2365a62d…, mix_logic 7fb45b75…),
so each mutant is the proved template with one line changed, and unapplied, like the
templates the theorems run:

- `one_shot_mint_no_seed.hex` (fbf509a0…): the final `and` without `seed_consumed,`.
- `fee_contract_no_cap.hex` (875e9471…): validate_pay_mix_fee's `and` without
  `self.fee <= reference_datum.max_fee_per_mix_lovelace,`.
- `fee_contract_two_boxes.hex` (68e282f0…): `expect mix_input_count >= 2` for `>= 3`. -/

namespace Audit.Template

#import_uplc auditTemplateOneShotMintNoSeed PlutusV3 single_cbor_hex "Audit/Template/Scripts/one_shot_mint_no_seed.hex"
#import_uplc auditTemplateFeeNoCap PlutusV3 single_cbor_hex "Audit/Template/Scripts/fee_contract_no_cap.hex"
#import_uplc auditTemplateFeeTwoBoxes PlutusV3 single_cbor_hex "Audit/Template/Scripts/fee_contract_two_boxes.hex"

end Audit.Template
