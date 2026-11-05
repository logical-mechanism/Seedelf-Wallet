import Seedelf.Scripts
import Lovejoin.Scripts
import Lovejoin.V2.Scripts
import Lovejoin.Template.Scripts

/-! Build-evidence check (scratch, not part of the repo): each script the oleans hold is the
script its .hex file holds now. Lake's trace for the four `Scripts` modules records only their
.lean text, imports and dynlibs, never the .hex files `#import_uplc` reads while elaborating,
so a changed .hex replays the old log and keeps the old bytes. This re-reads every .hex under
a new name and asks Lean for equality with the constant the olean holds.

Run with `./check.sh audit-quick` (the paths are relative to seedelf-verification/). This
module's own log replays the same way: after a .hex changes, delete its .olean
(.lake/build/lib/lean/Audit/Checks/) to run it again.
Expected: thirteen "Successfully decoded" infos and no error, exit code 0. A `type mismatch`
on an `example` means that olean's script isn't its .hex's bytes: rebuild that `Scripts`
module (delete its .olean: Lake keys on content hashes, so a touch rebuilds nothing) and every
theorem over it. -/

#import_uplc walletHexNow          PlutusV3 single_cbor_hex "Seedelf/Scripts/wallet.hex"
#import_uplc seedelfHexNow         PlutusV3 single_cbor_hex "Seedelf/Scripts/seedelf.hex"
#import_uplc alwaysFalseHexNow     PlutusV3 single_cbor_hex "Seedelf/Scripts/always_false.hex"
#import_uplc mixBoxHexNow          PlutusV3 single_cbor_hex "Lovejoin/Scripts/mix_box.hex"
#import_uplc mixLogicHexNow        PlutusV3 single_cbor_hex "Lovejoin/Scripts/mix_logic.hex"
#import_uplc feeContractHexNow     PlutusV3 single_cbor_hex "Lovejoin/Scripts/fee_contract.hex"
#import_uplc oneShotMintHexNow     PlutusV3 single_cbor_hex "Lovejoin/Scripts/one_shot_mint.hex"
#import_uplc referenceHolderHexNow PlutusV3 single_cbor_hex "Lovejoin/Scripts/reference_holder.hex"
#import_uplc mixLogicV2HexNow      PlutusV3 single_cbor_hex "Lovejoin/V2/Scripts/mix_logic.hex"
#import_uplc mixLogicTemplateHexNow    PlutusV3 single_cbor_hex "Lovejoin/Template/Scripts/mix_logic.hex"
#import_uplc mixBoxTemplateHexNow      PlutusV3 single_cbor_hex "Lovejoin/Template/Scripts/mix_box.hex"
#import_uplc oneShotMintTemplateHexNow PlutusV3 single_cbor_hex "Lovejoin/Template/Scripts/one_shot_mint.hex"
#import_uplc feeContractTemplateHexNow PlutusV3 single_cbor_hex "Lovejoin/Template/Scripts/fee_contract.hex"

-- `#import_uplc` names are global, whatever the namespace, so these are the root names.
example : wallet = walletHexNow := rfl
example : seedelf = seedelfHexNow := rfl
example : alwaysFalse = alwaysFalseHexNow := rfl
example : mixBox = mixBoxHexNow := rfl
example : mixLogic = mixLogicHexNow := rfl
example : feeContract = feeContractHexNow := rfl
example : oneShotMint = oneShotMintHexNow := rfl
example : referenceHolder = referenceHolderHexNow := rfl
example : mixLogicV2 = mixLogicV2HexNow := rfl
example : mixLogicTemplate = mixLogicTemplateHexNow := rfl
example : mixBoxTemplate = mixBoxTemplateHexNow := rfl
example : oneShotMintTemplate = oneShotMintTemplateHexNow := rfl
example : feeContractTemplate = feeContractTemplateHexNow := rfl
