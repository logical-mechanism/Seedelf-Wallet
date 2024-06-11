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

use aiken/transaction.{ScriptContext, Spend}
use seedelf/spending.{SchnorrRedeemer}
use seedelf/types/register.{Register}

validator(
  // this allows many wallet contracts to exist
  _random_string: ByteArray,
) {
  fn params(
    datum: Register,
    redeemer: SchnorrRedeemer,
    context: ScriptContext,
  ) -> Bool {
    expect Spend(_) = context.purpose
    spending.d_log(datum, redeemer)?
  }
}
