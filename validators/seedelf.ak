//// The minter is used to define a specific register in the wallet contract.
//// Its an open policy for minting and burning but each token will always
//// be unique. It use case is as a place holder for the address. A user can
//// display the token name as their address then another user may locate the
//// utxo that holds the nft and obtain the Register datum. This datum is then
//// used to produce a private address for the user. A single user may have
//// multiple 5eed0e1f addresses and can delete them whenever by simply burning
//// the 5eed0e1f token. This is more convenience then mandatory for the wallet
//// to function properly.
////

use aiken/collection/list
use aiken/primitive/bytearray
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference, Transaction, TransactionId}
use cardano/value
use seedelf/xor.{xor}
use types/prefixes

validator contract(_random: ByteArray) {
  mint(redeemer: ByteArray, policy_id: PolicyId, transaction: Transaction) {
    //
    // Burn one xor mint one.
    //
    xor(
      {
        expect [(pid, tkn, amt)]: List<(PolicyId, AssetName, Int)> =
          transaction.mint
            |> assets.flatten()
        //
        // Must burn one nft with the 5eed0e1f prefix.
        //
        and {
          (policy_id == pid)?,
          (bytearray.take(tkn, 4) == prefixes.seed)?,
          (-1 == amt)?,
        }
      },
      {
        let Transaction { inputs, mint, .. } = transaction
        expect [(pid, tkn, amt)]: List<(PolicyId, AssetName, Int)> =
          mint
            |> assets.flatten()
        expect Some(input) = list.head(inputs)
        let tx_hash: TransactionId = input.output_reference.transaction_id
        let index: Int = input.output_reference.output_index
        let token_name: AssetName =
          value.unique_token_name(tx_hash, index, prefixes.seed, redeemer)
        //
        // Must mint one nft with the 5eed0e1f prefix.
        //
        and {
          (policy_id == pid)?,
          (token_name == tkn)?,
          (1 == amt)?,
        }
      },
    )
  }

  else(_) {
    fail
  }
}
