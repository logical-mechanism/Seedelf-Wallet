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

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}
use types/registry.{Register}

/// The zero knowledge elements required for the proof. The c value will be
/// computed using the Fiat-Shamir heuristic. The vkh is used as a one time
/// pad for the proof to prevent rollback attacks.
///
pub type WalletRedeemer {
  // this is z = r + c * x as a bytearray
  z_b: ByteArray,
  // this is the g^r compressed G1Element
  g_r_b: ByteArray,
  // one time use signature
  sig: VerificationKeyHash,
}

validator contract(_random: ByteArray) {
  spend(
    maybe_datum: Option<Data>,
    redeemer: WalletRedeemer,
    _output_ref: OutputReference,
    transaction: Transaction,
  ) {
    when maybe_datum is {
      Some(datum) ->
        if datum is Register {
          //
          // Spend with Schnorr Proof if the datum is of type Register using a
          // random verification key hash as a one-time pad for the Fiat-Shamir
          // transform. Without the one-time pad, the funds could be respendable
          // due to the tx being drop during a rollback event.
          //
          and {
            // zk proof to spend the utxo
            registry.prove(datum, redeemer.z_b, redeemer.g_r_b, redeemer.sig)?,
            // forces a one time pad via a random key signature
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

  else(_) {
    fail
  }
}
