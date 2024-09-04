use aiken/primitive/bytearray
use cardano/assets.{AssetName}
use cardano/transaction.{TransactionId}

/// Allows creating a personalized random token name. Each address has a 
/// username of sorts. After the 5eed0e1f prefix the next 30 characters
/// are allowed to be customized. This allows an address to be have a
/// personalized touch while still maintaining privacy.
///
///
/// ```aiken
/// create(tx_hash, index, prefixes.seed, redeemer)
/// ```
pub fn create(
  txid: TransactionId,
  idx: Int,
  prefix: ByteArray,
  personal: ByteArray,
) -> AssetName {
  // prefix the txid with the index
  let prepend_index: ByteArray = bytearray.push(txid, idx)
  // the personal part max length is 15
  let trimmed_personal: ByteArray = bytearray.slice(personal, 0, 14)
  // concat the name
  let prepend_prefix: ByteArray =
    prefix
      |> bytearray.concat(trimmed_personal)
      |> bytearray.concat(prepend_index)
  // slice off the first 32
  bytearray.slice(prepend_prefix, 0, 31)
}

test simple_token_name() {
  create(#"", 0, #"", #"") == #"00"
}

test realistic_token_name() {
  create(
    #"acabacabacabacabacabacabacabacabacabacabacabacabacabacab",
    69,
    #"5eed0e1f",
    // [AncientKraken] = 5b416e6369656e744b72616b656e5d
    #"5b416e6369656e744b72616b656e5d",
  ) == #"5eed0e1f5b416e6369656e744b72616b656e5d45acabacabacabacabacabacab"
}
