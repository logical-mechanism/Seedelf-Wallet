import Lovejoin.AnyTx.BoxMalformed
import Lovejoin.AnyTx.BoxMalformedShapes

/-! Assembly of all malformed inline datum shapes. The case split is exhaustive
for arbitrary Data, and each case uses the compiled validator and unbounded search. -/
namespace Lovejoin.AnyTx.BoxInlineAll
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Lovejoin.Classic (wellFormed)
open Lovejoin.AnyTx
open Lovejoin.AnyTx.BoxSearch (inputList)
open Lovejoin.AnyTx.BoxMalformed
open Lovejoin.AnyTx.BoxMalformedShapes

/-- Every inline datum that is not a well-formed box is recoverable, for arbitrary
input list lengths and arbitrary withdrawals. -/
theorem malformed_inline_recovers (L : ByteString) (r : TxRest)
    (sigs red ref rd wdrl addr value script : Data) (before after : List (Data × Data))
    (hBefore : ∀ pair ∈ before, pair.1 ≠ ref) (datum : Data) (hBad : isBoxDatum datum = false) :
    ∃ n, cekExecuteProgram mixBoxTemplate.script
      [toTerm L, toTerm (boxSpendCtx r
        (.List (inputList (before ++ (ref, .Constr 0 [addr, value, .Constr 2 [datum], script]) :: after)))
        wdrl sigs red ref rd)] n = .Halt (.VCon .Unit) := by
  cases datum with
  | B x => exact bytes_recovers L r sigs red ref rd wdrl addr value script before after hBefore x
  | I x => exact integer_recovers L r sigs red ref rd wdrl addr value script before after hBefore x
  | List xs => exact list_recovers L r sigs red ref rd wdrl addr value script before after hBefore xs
  | Map xs => exact map_recovers L r sigs red ref rd wdrl addr value script before after hBefore xs
  | Constr tag xs =>
    by_cases hTag : tag = 0
    · subst tag
      cases xs with
      | nil => exact no_fields_recovers L r sigs red ref rd wdrl addr value script before after hBefore
      | cons x rest =>
        cases rest with
        | nil => exact one_field_recovers L r sigs red ref rd wdrl addr value script before after hBefore x
        | cons y rest =>
          cases rest with
          | cons z zs => exact three_or_more_fields_recovers L r sigs red ref rd wdrl addr value script before after hBefore x y z zs
          | nil =>
            cases x with
            | I i => exact first_integer_recovers L r sigs red ref rd wdrl addr value script before after hBefore i y
            | List xs => exact first_list_recovers L r sigs red ref rd wdrl addr value script before after hBefore xs y
            | Map xs => exact first_map_recovers L r sigs red ref rd wdrl addr value script before after hBefore xs y
            | Constr k fs => exact first_constr_recovers L r sigs red ref rd wdrl addr value script before after hBefore k fs y
            | B a =>
              cases y with
              | I i => exact second_integer_recovers L r sigs red ref rd wdrl addr value script before after hBefore i a
              | List xs => exact second_list_recovers L r sigs red ref rd wdrl addr value script before after hBefore xs a
              | Map xs => exact second_map_recovers L r sigs red ref rd wdrl addr value script before after hBefore xs a
              | Constr k fs => exact second_constr_recovers L r sigs red ref rd wdrl addr value script before after hBefore k fs a
              | B b =>
                by_cases ha : lengthOfByteString a = 48
                · by_cases hb : lengthOfByteString b = 48
                  · by_cases hne : a ≠ b
                    · simp [isBoxDatum, wellFormed, ha, hb, hne] at hBad
                    · exact equal_points_recovers L a b r sigs red ref rd wdrl addr value script before after hBefore ha hb (Classical.not_not.mp hne)
                  · exact second_length_recovers L a b r sigs red ref rd wdrl addr value script before after hBefore ha hb
                · exact first_length_recovers L a b r sigs red ref rd wdrl addr value script before after hBefore ha
    · exact wrong_tag_recovers L r sigs red ref rd wdrl addr value script before after hBefore tag xs hTag

end Lovejoin.AnyTx.BoxInlineAll

#print axioms Lovejoin.AnyTx.BoxInlineAll.malformed_inline_recovers
