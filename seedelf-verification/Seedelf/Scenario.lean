import CardanoLedgerApi.V3

/-! A transaction with nothing in it, for the scenarios to fill in. Fields a
script never reads stay concrete, so the symbolic run has nothing to branch on
there. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)
open CardanoLedgerApi.V3

def ofHex (h : String) : ByteString :=
  let digit (c : Char) : Nat :=
    if c.isDigit then c.toNat - '0'.toNat else c.toLower.toNat - 'a'.toNat + 10
  let rec go : List Char → List Char
    | a :: b :: rest => Char.ofNat (digit a * 16 + digit b) :: go rest
    | _ => []
  ⟨String.mk (go h.toList)⟩

def someOutput : TxOut := ⟨⟨.PubKeyCredential "", none⟩, [], .NoOutputDatum, none⟩

def emptyTx : TxInfo :=
  { txInfoInputs                := []
  , txInfoReferenceInputs       := []
  , txInfoOutputs               := []
  , txInfoFee                   := 0
  , txInfoMint                  := []
  , txInfoTxCerts               := []
  , txInfoWdrl                  := []
  , txInfoValidRange            := Data.Constr 0 [ Data.Constr 0 [Data.Constr 0 [], Data.Constr 1 []]
                                                 , Data.Constr 0 [Data.Constr 2 [], Data.Constr 1 []] ]
  , txInfoSignatories           := []
  , txInfoRedeemers             := []
  , txInfoData                  := []
  , txInfoId                    := ""
  , txInfoVotes                 := []
  , txInfoProposalProcedures    := []
  , txInfoCurrentTreasuryAmount := Data.Constr 1 []
  , txInfoTreasuryDonation      := Data.Constr 1 []
  }

end Seedelf.V1
