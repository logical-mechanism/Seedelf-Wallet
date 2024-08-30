//// A UTxO may be spent if and only if a user can provide the proper ZK 
//// elements to prove that g^z = g^r * u^c for a given (g, u) Register.
//// It is assumed that the set of all elements (g, u) are unique such that
//// no two datums have the same hash. This should allow an arbitrary amount
//// of UTxOs to be spent inside a single tx, allowing the contract to act like
//// a wallet for some user who knows a secret value x. This user can always
//// find their UTxOs by searching all register's for a (g, u) element where
//// g^x = u. Another user can send a UTxO to the (g, u) element by selecting a 
//// large random integer d then doing the transformation, 
//// (g, u) -> (g^d, u^d). This perserves the g and u relationship while 
//// providing privacy as the new element, (g^d, u^d), can not be inverted into
//// the original (g, u) element.
////
//// The minter is used to define a specific register in the wallet contract.
//// Its an open policy for minting and burning but each token will always
//// be unique. It use case is as a place holder for the address. A user can
//// display the token name as their address then another user may locate the
//// utxo that holds the nft and obtain the Register datum. This datum is then
//// used to produce a private address for the user. A single user may have
//// multiple pointer addresses and can delete them whenever by simply burning
//// the pointer token. This is more convenience then mandatory for the wallet
//// to function properly.
////

use cardano/assets.{AssetName, PolicyId}
use cardano/minting
use cardano/transaction.{OutputReference, Transaction, TransactionId}
use seedelf/spending.{SchnorrRedeemer}
use seedelf/token_name
use seedelf/types/register.{Register}
use seedelf/xor.{xor}
use types/prefixes
use validation/find

validator wallet {
  spend(
    maybe_datum: Option<Data>,
    redeemer: SchnorrRedeemer,
    _output_ref: OutputReference,
    _transaction: Transaction,
  ) {
    when maybe_datum is {
      Some(datum) ->
        if datum is Register {
          spending.schnorr_proof(datum, redeemer)?
        } else {
          // incorrect data structures should be spendable
          True
        }
      // missing data structures should be spendable
      None -> True
    }
  }

  mint(redeemer: ByteArray, policy_id: PolicyId, transaction: Transaction) {
    //
    // Burn 1 by the seed prefix xor mint 1 with the token name.
    //
    xor(
      {
        // you can burn a token with 5eed0e1f prefix
        let Transaction { mint, .. } = transaction
        let minted_assets: List<(PolicyId, AssetName, Int)> =
          mint |> assets.flatten()
        minting.by_prefix(minted_assets, policy_id, prefixes.seed, -1)?
      },
      {
        // or mint one
        let Transaction { inputs, mint, .. } = transaction
        let minted_assets: List<(PolicyId, AssetName, Int)> =
          mint |> assets.flatten()
        let tx_hash: TransactionId = find.first_input_txid(inputs)
        let index: Int = find.first_input_index(inputs)
        let token_name: AssetName =
          token_name.create(tx_hash, index, prefixes.seed, redeemer)
        minting.exact(minted_assets, policy_id, token_name, 1)?
      },
    )
  }

  else(_ctx) {
    fail
  }
}
