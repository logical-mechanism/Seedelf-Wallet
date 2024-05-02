////
////

use aiken/builtin

/// This is the g1 point from the zCash implementation.
pub fn g1() -> G1Element {
  builtin.bls12_381_g1_uncompress(
    #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
  )
}

/// This is mathematically equivalent to g^x mod q.
pub fn pk(sk: Int) -> G1Element {
  builtin.bls12_381_g1_scalar_mul(sk, g1())
}
