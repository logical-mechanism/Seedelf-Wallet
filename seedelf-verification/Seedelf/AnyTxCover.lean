import Seedelf.AnyTx

/-! Every V3 spend's context has the `…AnyTx` scenarios' form. A spend's context, as
CardanoLedgerApiBlaster encodes it, is `spendIn` of its TxInfo, its redeemer, its output's
reference and its datum, and its TxInfo is `TxRest.infoWith` of its 15 other fields and its
signatories. Each is `rfl`: the encoding unfolds to the same `Data`. Kernel-checked, no blaster.

So a theorem over every `TxRest`, `ref` and datum holds of every spend whose signatories,
redeemer and datum have the shape it fixes. For the wallet's spends that's none to 128
signatories, and each redeemer and datum shape its scenarios list. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (IsData)
open CardanoLedgerApi.V3
open PlutusCore.Data (Data)

/-- A TxInfo's 15 fields besides its signatories, as the ledger encodes them. -/
def TxRest.ofTxInfo (tx : TxInfo) : TxRest :=
  { inputs := IsData.toData tx.txInfoInputs,
    referenceInputs := IsData.toData tx.txInfoReferenceInputs,
    outputs := IsData.toData tx.txInfoOutputs,
    fee := Data.I tx.txInfoFee,
    mint := IsData.toData tx.txInfoMint,
    certs := IsData.toData tx.txInfoTxCerts,
    withdrawals := IsData.toData tx.txInfoWdrl,
    validRange := IsData.toData tx.txInfoValidRange,
    redeemers := IsData.toData tx.txInfoRedeemers,
    datums := IsData.toData tx.txInfoData,
    txId := IsData.toData tx.txInfoId,
    votes := IsData.toData tx.txInfoVotes,
    proposals := IsData.toData tx.txInfoProposalProcedures,
    treasury := IsData.toData tx.txInfoCurrentTreasuryAmount,
    donation := IsData.toData tx.txInfoTreasuryDonation }

/-- Every TxInfo is its 15 other fields with its signatories at index 8. -/
theorem TxRest.ofTxInfo_infoWith (tx : TxInfo) :
    IsData.toData tx = (TxRest.ofTxInfo tx).infoWith (IsData.toData tx.txInfoSignatories) := rfl

/-- Every spend's context is `spendIn` of its parts. -/
theorem spendIn_of_spend (tx : TxInfo) (redeemer : Data) (ref : TxOutRef) (datum : Option Data) :
    IsData.toData (⟨tx, redeemer, .SpendingScript ref datum⟩ : ScriptContext) =
      spendIn (IsData.toData tx) redeemer (IsData.toData ref) (IsData.toData datum) := rfl

/-- A spend's datum, encoded, is `datumSome` or `datumNone`. -/
theorem datum_encoding (d : Data) :
    IsData.toData (some d) = datumSome d ∧ IsData.toData (none : Option Data) = datumNone :=
  ⟨rfl, rfl⟩

end Seedelf.V1
