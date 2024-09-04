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

/// This simulates re-randomizing a register into a new one. It is used for
/// testing purposes only. This function will be used in the off-chain as it
/// is the method for creating a new private address for some register.
///
/// ```aiken
/// rerandomize(register, random_scaler)
/// ```
pub fn rerandomize(datum: Register, rng: Int) -> Register {
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
