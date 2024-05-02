////
////

use aiken/builtin

/// Alpha is the generator and beta is the public value. The pair forms the 
/// relationship a^z = a^r * b^c, where a = alpha and b = beta, respectively.
/// The value r is a random integer and the value c is the challenge.
pub type Register {
  // the generator
  alpha: ByteArray,
  // the public value
  beta: ByteArray,
}

/// The zero knowledge elements required for the proof. The c value will be
/// computed using the Fiat-Shamir heuristic.
pub type ZK {
  // this is z = r + c*x
  z: ByteArray,
  // this is the g^r compressed G1Element
  g_r: ByteArray,
}

/// This simulates re-randomizing a register into a new one. It is used for
/// testing purposes only. This function will be used in the off-chain as it
/// is the method for creating a new private address for some user.
pub fn rerandomizing(datum: Register, rng: Int) -> Register {
  // get the (g, u) element in their uncompressed form
  let g: G1Element = builtin.bls12_381_g1_uncompress(datum.alpha)
  let u: G1Element = builtin.bls12_381_g1_uncompress(datum.beta)
  // now rerandomize the register elements
  let g_d: G1Element = builtin.bls12_381_g1_scalar_mul(rng, g)
  let u_d: G1Element = builtin.bls12_381_g1_scalar_mul(rng, u)
  // recompress the new randomized elements
  Register {
    alpha: g_d |> builtin.bls12_381_g1_compress,
    beta: u_d |> builtin.bls12_381_g1_compress,
  }
}
