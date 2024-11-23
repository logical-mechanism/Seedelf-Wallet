//// The minter is used to define a specific registry in the wallet contract.
//// Its an open policy for minting and burning but each token will always
//// be unique. Its use case is as a locator for the root datum. A user can
//// display the token name as their address then another user may locate the
//// UTxO that holds the nft and obtain the Registry datum. This datum is then
//// used to produce a private address for the user. A single user may have
//// multiple 5eed0e1f addresses and can delete them whenever by simply burning
//// the 5eed0e1f token. This is more convenience then mandatory for the wallet
//// to function properly as any token may be used as the locator token.
////

use aiken/collection/list
use aiken/primitive/bytearray
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference, Transaction, TransactionId}
use token_name.{generate, seedelf}
use xor.{xor}

validator contract(_any: Data) {
  mint(personal_tag: ByteArray, policy_id: PolicyId, transaction: Transaction) {
    //
    // Burn one xor mint one.
    //
    xor(
      {
        //
        // a single thing is being burned in this tx
        //
        expect [(pid, tkn, amt)]: List<(PolicyId, AssetName, Int)> =
          transaction.mint
            |> assets.flatten()
        //
        // Must burn one nft with the 5eed0e1f prefix.
        //
        and {
          // policy must match this pid
          (policy_id == pid)?,
          // token name doesn't matter, just use the prefix to match it
          (bytearray.take(tkn, 4) == seedelf)?,
          // a single burn
          (-1 == amt)?,
        }
      },
      {
        //
        // we need the inputs and the mint value inside the transaction
        //
        let Transaction { inputs, mint, .. } = transaction
        //
        // a single thing is being minted in this tx
        //
        expect [(pid, tkn, amt)]: List<(PolicyId, AssetName, Int)> =
          mint
            |> assets.flatten()
        //
        // use the first input to generate a token name using the seedelf prefix
        //
        expect Some(input) = list.head(inputs)
        let id: TransactionId = input.output_reference.transaction_id
        let idx: Int = input.output_reference.output_index
        let token_name: AssetName = generate(id, idx, seedelf, personal_tag)
        //
        // Must mint one nft with the 5eed0e1f prefix.
        //
        and {
          // prevent roll over
          (idx < 256)?,
          // policy must match this pid
          (policy_id == pid)?,
          // the token name must match this tkn
          (token_name == tkn)?,
          // a single mint
          (1 == amt)?,
        }
      },
    )
  }

  // Mint Only
  else(_) {
    fail
  }
}
