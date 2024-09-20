use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}
use cardano/tx

pub type CollateralProdivderDatum {
  // pkh for building the tx
  pkh: VerificationKeyHash,
  // tx#idx for building the tx
  utxo: ByteArray,
  // the base url for the endpoint
  url: ByteArray,
}

validator contract(_random: ByteArray) {
  spend(
    maybe_datum: Option<Data>,
    _redeemer: Void,
    _output_ref: OutputReference,
    transaction: Transaction,
  ) {
    when maybe_datum is {
      Some(datum) ->
        if datum is CollateralProdivderDatum {
          // if batcher signs the tx then they can do whatever
          tx.verify_signature(transaction.extra_signatories, datum.pkh)
        } else {
          // incorrect data structures should be spendable
          True
        }
      // missing data structures should be spendable
      None -> True
    }
  }

  else(_) {
    fail
  }
}
