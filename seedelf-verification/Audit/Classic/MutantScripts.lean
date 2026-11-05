import PlutusCore.UPLC

/-! The Classic audit's other scripts. No checks here: every module that runs one of these
imports this, so a failing check never stops another module from building.

**Mutants of the deployed mix_logic (0dad3046…).** Lovejoin c1239fb's `contracts/`, built
with Aiken v1.1.24 in a scratch copy and applied to the pool's NFT (`f5592689…`,
`lovejoin`), as the deployment did. Built that way without any change, it is the deployed
script byte for byte, so each mutant differs from the proved bytes by its one line alone:

- `mix_logic_no_refs.hex` (07a761ea…): validate_owner's `ctx_preimage` without
  `|> bytearray.concat(input_refs_bytes)`, the line audit finding F-4 added. Its `ctx` is
  `blake2b_256(serialise(outputs) ‖ mix_script_hash)`, and it never serialises the refs.
- `mix_logic_no_outputs.hex` (4a4a5cfd…): `let ctx_preimage = #""` in place of
  `outputs_bytes`, so `ctx = blake2b_256(#"" ‖ serialise(input refs) ‖ mix_script_hash)`, and
  it never serialises the outputs.

The decoded UPLC agrees: one `serialiseData` fewer in each, and in `no_refs` one
`appendByteString` fewer. The honest Owner vector (`concrete/lovejoin_owner.sh`'s) returns
unit on the deployed bytes and crashes on both mutants under Aiken's evaluator.

**A control script.** `always_true.uplc` is `(lam ctx (con unit ()))`: it accepts anything. -/

namespace Audit.Classic

#import_uplc auditClassicMixLogicNoRefs PlutusV3 single_cbor_hex "Audit/Classic/Scripts/mix_logic_no_refs.hex"
#import_uplc auditClassicMixLogicNoOutputs PlutusV3 single_cbor_hex "Audit/Classic/Scripts/mix_logic_no_outputs.hex"
#import_uplc auditClassicAlwaysTrue PlutusV3 textual "Audit/Classic/Scripts/always_true.uplc"

end Audit.Classic
