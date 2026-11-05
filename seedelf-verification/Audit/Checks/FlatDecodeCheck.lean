import Seedelf.Scripts
import Lovejoin.Scripts
import Lovejoin.Template.Scripts
import Lovejoin.V2.Scripts

/-! Checker of audit finding `flat-decoder-unchecked` (not part of the repo).

Every theorem is about the `Program` that `#import_uplc … single_cbor_hex` built from a `.hex`
file with PlutusCoreBlaster's flat decoder (`FlatEncoding.decodeTerm`), which the Plutus
conformance suite never runs (its cases are textual). This reads each of the 13 scripts a
second way: Aiken v1.1.24's `aiken uplc decode --hex --cbor` of the same `.hex` file (each text
re-encodes with `aiken uplc encode` to the script's flat bytes exactly), read back through the
conformance-tested textual parser, and checks the two `Program`s are equal. It imports the
built oleans, so it also catches an olean older than its `.hex` (Lake doesn't track the files
`#import_uplc` reads). `#import_uplc` declares each script under its bare name, at the root
(`stx.getId`, not under the current namespace), so the 13 are `wallet`, …, `mixLogicV2`, as the
repo's own modules name them from other namespaces (e.g. `Lovejoin.V2.Own1` uses
`mixLogicTemplate`); `Seedelf.V1.wallet` doesn't exist.

Run with `./check.sh audit-quick`. Lake tracks neither the `.hex` nor the `.uplc` files, so
after one changes, delete this module's .olean (.lake/build/lib/lean/Audit/Checks/) to run it
again. The `.uplc` texts are in Audit/Checks/FlatDecode/: Lovejoin's are confidential, like the
branch.

Expected: 16 `Successfully decoded textual` infos; 13 `true`, then `false` three times (the
controls: the wallet with its one q constant changed to q - 1, always_false with one variable
index changed, and the wallet against the policy); `true` twice for the applied templates; no
error. A `false` among the first 13, or a failed `#guard`, names a script whose theorems are about
a program other than its bytes. A parse error is inconclusive (a text-syntax gap). -/

namespace CheckFlatDecoder

open PlutusCore.UPLC.Term

#import_uplc cfd_walletT           PlutusV3 textual "Audit/Checks/FlatDecode/Seedelf_Scripts_wallet.uplc"
#import_uplc cfd_seedelfT          PlutusV3 textual "Audit/Checks/FlatDecode/Seedelf_Scripts_seedelf.uplc"
#import_uplc cfd_alwaysFalseT      PlutusV3 textual "Audit/Checks/FlatDecode/Seedelf_Scripts_always_false.uplc"
#import_uplc cfd_mixBoxT           PlutusV3 textual "Audit/Checks/FlatDecode/Lovejoin_Scripts_mix_box.uplc"
#import_uplc cfd_mixLogicT         PlutusV3 textual "Audit/Checks/FlatDecode/Lovejoin_Scripts_mix_logic.uplc"
#import_uplc cfd_feeContractT      PlutusV3 textual "Audit/Checks/FlatDecode/Lovejoin_Scripts_fee_contract.uplc"
#import_uplc cfd_oneShotMintT      PlutusV3 textual "Audit/Checks/FlatDecode/Lovejoin_Scripts_one_shot_mint.uplc"
#import_uplc cfd_referenceHolderT  PlutusV3 textual "Audit/Checks/FlatDecode/Lovejoin_Scripts_reference_holder.uplc"
#import_uplc cfd_mixLogicTplT      PlutusV3 textual "Audit/Checks/FlatDecode/Lovejoin_Template_Scripts_mix_logic.uplc"
#import_uplc cfd_mixBoxTplT        PlutusV3 textual "Audit/Checks/FlatDecode/Lovejoin_Template_Scripts_mix_box.uplc"
#import_uplc cfd_oneShotMintTplT   PlutusV3 textual "Audit/Checks/FlatDecode/Lovejoin_Template_Scripts_one_shot_mint.uplc"
#import_uplc cfd_feeContractTplT   PlutusV3 textual "Audit/Checks/FlatDecode/Lovejoin_Template_Scripts_fee_contract.uplc"
#import_uplc cfd_mixLogicV2T       PlutusV3 textual "Audit/Checks/FlatDecode/Lovejoin_V2_Scripts_mix_logic.uplc"
-- Controls.
#import_uplc cfd_walletQm1T        PlutusV3 textual "Audit/Checks/FlatDecode/wallet_qm1.uplc"
#import_uplc cfd_alwaysFalseVarT   PlutusV3 textual "Audit/Checks/FlatDecode/af_var.uplc"
-- (the third control reuses cfd_seedelfT)
#import_uplc cfd_seedelfT2         PlutusV3 textual "Audit/Checks/FlatDecode/Seedelf_Scripts_seedelf.uplc"

-- The flat decoder's reading equals the textual parser's, script by script (13 × true).
#eval decide (wallet.script = cfd_walletT.script)
#eval decide (seedelf.script = cfd_seedelfT.script)
#eval decide (alwaysFalse.script = cfd_alwaysFalseT.script)
#eval decide (mixBox.script = cfd_mixBoxT.script)
#eval decide (mixLogic.script = cfd_mixLogicT.script)
#eval decide (feeContract.script = cfd_feeContractT.script)
#eval decide (oneShotMint.script = cfd_oneShotMintT.script)
#eval decide (referenceHolder.script = cfd_referenceHolderT.script)
#eval decide (mixLogicTemplate.script = cfd_mixLogicTplT.script)
#eval decide (mixBoxTemplate.script = cfd_mixBoxTplT.script)
#eval decide (oneShotMintTemplate.script = cfd_oneShotMintTplT.script)
#eval decide (feeContractTemplate.script = cfd_feeContractTplT.script)
#eval decide (mixLogicV2.script = cfd_mixLogicV2T.script)

-- Controls: the comparison can say no (3 × false).
#eval decide (wallet.script = cfd_walletQm1T.script)
#eval decide (alwaysFalse.script = cfd_alwaysFalseVarT.script)
#eval decide (wallet.script = cfd_seedelfT2.script)

/-- A program applied to `Data` constants, as `aiken blueprint apply` builds an applied script. -/
def applyData (p : Program) (ds : List PlutusCore.Data.Data) : Program :=
  match p with
  | .Program v t => .Program v (ds.foldl (fun acc d => .Apply acc (.Const (.Data d))) t)

def abab : PlutusCore.ByteString.ByteString :=
  ⟨String.mk (List.replicate 28 (Char.ofNat 0xab))⟩
def classicL : PlutusCore.ByteString.ByteString :=
  ⟨String.mk ([0x0d, 0xad, 0x30, 0x46, 0xf9, 0x0d, 0x9c, 0xf8, 0x35, 0x4e, 0xb8, 0xb7, 0x43, 0xd5,
     0x0f, 0xb2, 0xc2, 0x5d, 0x58, 0x12, 0x69, 0xb9, 0x4f, 0xfc, 0xdf, 0x59, 0x49, 0x9e].map Char.ofNat)⟩

-- The applied scripts are their templates applied to the parameters (2 × true).
#eval decide (mixLogicV2.script =
  applyData mixLogicTemplate.script [.B abab, .B ⟨"lovejoin"⟩])
#eval decide (mixBox.script =
  applyData mixBoxTemplate.script [.B classicL])

-- The same as hard checks: any failure is an error here.
#guard decide (wallet.script = cfd_walletT.script)
#guard decide (seedelf.script = cfd_seedelfT.script)
#guard decide (alwaysFalse.script = cfd_alwaysFalseT.script)
#guard decide (mixBox.script = cfd_mixBoxT.script)
#guard decide (mixLogic.script = cfd_mixLogicT.script)
#guard decide (feeContract.script = cfd_feeContractT.script)
#guard decide (oneShotMint.script = cfd_oneShotMintT.script)
#guard decide (referenceHolder.script = cfd_referenceHolderT.script)
#guard decide (mixLogicTemplate.script = cfd_mixLogicTplT.script)
#guard decide (mixBoxTemplate.script = cfd_mixBoxTplT.script)
#guard decide (oneShotMintTemplate.script = cfd_oneShotMintTplT.script)
#guard decide (feeContractTemplate.script = cfd_feeContractTplT.script)
#guard decide (mixLogicV2.script = cfd_mixLogicV2T.script)
#guard !decide (wallet.script = cfd_walletQm1T.script)
#guard !decide (alwaysFalse.script = cfd_alwaysFalseVarT.script)
#guard !decide (wallet.script = cfd_seedelfT2.script)
#guard decide (mixLogicV2.script =
  applyData mixLogicTemplate.script [.B abab, .B ⟨"lovejoin"⟩])
#guard decide (mixBox.script =
  applyData mixBoxTemplate.script [.B classicL])

end CheckFlatDecoder
