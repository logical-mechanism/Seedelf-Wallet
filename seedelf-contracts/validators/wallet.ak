//// A UTxO may be spent if and only if a user can provide the proper NIZK 
//// elements to prove that g^z = g^r * u^c for a given (g, u) register.
//// It is assumed that the set of all elements (g, u) is unique such that
//// no two datums have the same hash. This should allow an arbitrary amount
//// of UTxOs to be spent inside a single TX, allowing the contract to act like
//// a wallet for some user who knows a secret value x. A user can always
//// find their UTxOs by searching all Register datums for a (g, u) element where
//// g^x = u. Another user can send a UTxO to the (g, u) element by selecting a 
//// large random integer d then doing the transformation, 
//// (g, u) -> (g^d, u^d). This preserves the g and u relationship while 
//// providing privacy as the new element, (g^d, u^d), can not be inverted into
//// the original (g, u) element.
////

use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction}
use schnorr.{Proof, Register}

validator contract(_any: Data) {
  spend(
    maybe_register: Option<Data>,
    proof: Proof,
    _output_reference: OutputReference,
    transaction: Transaction,
  ) {
    //
    // first do a data structure check
    when maybe_register is {
      Some(register) ->
        if register is Register {
          //
          // Spend with Schnorr's Σ-protocol if the datum is of type Register using a
          // random verification key hash as a one-time pad.
          //
          // Without the one-time pad, the funds could be respendable
          // due to the tx being dropped during a rollback event!
          //
          and {
            // zk proof to spend the utxo
            schnorr.prove(
              register.generator,
              register.public_value,
              proof.z_b,
              proof.g_r_b,
              proof.vkh,
            )?,
            // forces a one time pad via a random key signature
            list.has(transaction.extra_signatories, proof.vkh)?,
          }
        } else {
          //
          // incorrect data structures should be spendable
          //
          True
        }
      //
      // missing data structures should be spendable
      //
      None -> True
    }
  }

  // Spend Only
  else(_) {
    fail
  }
}
