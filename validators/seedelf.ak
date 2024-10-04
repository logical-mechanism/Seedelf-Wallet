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

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference, Transaction, TransactionId}
use cardano/value
use seedelf/xor.{xor}
use types/prefixes
use types/registry.{Register}

/// The zero knowledge elements required for the proof. The c value will be
/// computed using the Fiat-Shamir heuristic.
pub type SeedElfRedeemer {
  // this is z = r + c*x as a bytearray
  z_b: ByteArray,
  // this is the g^r compressed G1Element
  g_r_b: ByteArray,
  // one time use signature
  sig: VerificationKeyHash,
}

validator contract(_random: ByteArray) {
  spend(
    maybe_datum: Option<Data>,
    redeemer: SeedElfRedeemer,
    _output_ref: OutputReference,
    transaction: Transaction,
  ) {
    when maybe_datum is {
      Some(datum) ->
        if datum is Register {
          //
          // Spend with Schnorr Proof if the datum is of type Register using a
          // random verification key hash as a one-time pad for the Fiat-Shamir
          // transform. With the one-time pad, the funds could be respendable
          // due to the tx being drop during a forking event.
          //
          and {
            // zk proof to spend the utxo
            registry.prove(datum, redeemer.z_b, redeemer.g_r_b, redeemer.sig)?,
            // forces one time use via a random key signature
            list.has(transaction.extra_signatories, redeemer.sig)?,
          }
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
          policy_id == pid,
          bytearray.take(tkn, 4) == prefixes.seed,
          -1 == amt,
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
        // Must be an nft with the unique token name.
        //
        and {
          policy_id == pid,
          token_name == tkn,
          1 == amt,
        }
      },
    )
  }

  else(_) {
    fail
  }
}

// Use this contract to store the script reference UTxO so they have to exist
validator always_false(_random: ByteArray) {
  else(_) {
    fail
  }
}
