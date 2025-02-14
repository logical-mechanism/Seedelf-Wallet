use aiken/collection/list
use aiken/primitive/bytearray
use cardano/assets.{AssetName}
use cardano/transaction.{TransactionId}

/// The default seed elf token name prefix.
///
/// ```aiken
/// token_name.seedelf
/// ```
pub const seedelf: ByteArray = #"5eed0e1f"

/// Generate a unique token name from a `TxId#Idx`, personal tag, and a prefix.
///
/// ```aiken
/// token_name.generate(tx_id, tx_idx, #"", personal_tag)
/// ```
pub fn generate(
  txid: TransactionId,
  idx: Int,
  prefix: ByteArray,
  personal: ByteArray,
) -> AssetName {
  // prefix the txid with the index
  let prepend_index: ByteArray = bytearray.push(txid, idx)
  // the personal part max length is 15
  let trimmed_personal: ByteArray = bytearray.slice(personal, 0, 14)
  // concat the name then slice off the first 32 bytes ( length 64 tkn)
  prefix
    |> bytearray.concat(trimmed_personal)
    |> bytearray.concat(prepend_index)
    |> bytearray.slice(0, 31)
}

test no_prefix_token_name() {
  // the zero becomes the prefix
  generate(
    #"4172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce23617fc1641880",
    0,
    #"",
    #"",
  ) == #"004172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce23617fc16418"
}

test real_token_name1() {
  let tkn: AssetName =
    generate(
      #"4172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce23617fc1641880",
      0,
      seedelf,
      #"",
    )
  and {
    bytearray.take(tkn, 4) == seedelf,
    tkn == #"5eed0e1f004172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce2361",
    bytearray.length(tkn) == 32,
  }
}

test real_token_name2() {
  let tkn: AssetName =
    generate(
      #"4172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce23617fc1641880",
      0,
      seedelf,
      #"acab",
    )
  and {
    bytearray.take(tkn, 4) == seedelf,
    tkn == #"5eed0e1facab004172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce",
    bytearray.length(tkn) == 32,
  }
}

test rollover_attack() fail {
  let tkn1: AssetName =
    generate(
      #"4172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce23617fc1641880",
      0,
      seedelf,
      #"acab",
    )
  let tkn2: AssetName =
    generate(
      #"4172bf875e341da9ecc0f1f84bfb7b6e6bb8b022b17205b5ce23617fc1641880",
      256,
      seedelf,
      #"acab",
    )
  tkn1 == tkn2
}

test expect_head() {
  let x: List<Int> = [0, 1, 2, 3]
  expect Some(int) = list.head(x)
  int == 0
}

test force_head() {
  let x: List<Int> = [0, 1, 2, 3]
  // this is cheaper
  expect [int, ..] = x
  int == 0
}
