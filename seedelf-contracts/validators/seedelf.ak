//// This is an open policy for minting and burning, but each token will always
//// be unique. The token acts as a locator for the root datum. A user can
//// display the token name as their address, then another user may locate the
//// UTxO that holds the nft and obtain the Register. This datum is then
//// used to produce a private address for the user. A single user may have
//// multiple 5eed0e1f addresses and can delete them whenever by simply burning
//// the 5eed0e1f token. This token is more convenient than mandatory for the wallet
//// to function properly, as any token can be the locator token.
////

use aiken/primitive/bytearray
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Input, OutputReference, Transaction, TransactionId}
use logic.{xor}
use token_name.{generate, seedelf}

validator contract(_any: Data) {
  mint(personal_tag: ByteArray, policy_id: PolicyId, self: Transaction) {
    //
    // Burn one xor mint one.
    //
    xor(
      {
        //
        // a single thing is being burned in this tx
        //
        expect [(pid, tkn, amt)]: List<(PolicyId, AssetName, Int)> =
          self.mint
            |> assets.flatten()
        //
        // Must burn one nft with the 5eed0e1f prefix.
        //
        and {
          // policy must match this pid
          (pid == policy_id)?,
          // token name doesn't matter, just use the prefix to match it
          (bytearray.take(tkn, 4) == seedelf)?,
          // a single burn
          (amt == -1)?,
        }
      },
      {
        //
        // we need the inputs and the mint value inside the transaction
        //
        let Transaction { inputs, mint, .. } = self
        //
        // a single thing is being minted in this tx
        //
        expect [(pid, tkn, amt)]: List<(PolicyId, AssetName, Int)> =
          mint
            |> assets.flatten()
        //
        // use the first input to generate a token name using the seedelf prefix
        //
        expect [input, ..]: List<Input> = inputs
        let id: TransactionId = input.output_reference.transaction_id
        let idx: Int = input.output_reference.output_index
        let token_name: AssetName = generate(id, idx, seedelf, personal_tag)
        //
        // Must mint one nft with the 5eed0e1f prefix.
        //
        and {
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
