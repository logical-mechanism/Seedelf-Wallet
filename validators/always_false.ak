//// Always false to hold the seedelf script utxo.
////

validator contract(_random: ByteArray) {
  spend(
    _maybe_datum: Option<Data>,
    _redeemer: Data,
    _output_ref: Data,
    _transaction: Data,
  ) {
    False
  }

  else(_) {
    fail
  }
}
