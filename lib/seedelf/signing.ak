////
////

use aiken/builtin
use aiken/bytearray
use aiken/hash
use seedelf/bls
use seedelf/types/register.{Register}

/// The zero knowledge elements required for the proof.
pub type FiatShamirRedeemer {
  // this is z = r + c*x
  z: ByteArray,
  // this is the g^r compressed G1Element
  g_r: ByteArray,
}

/// A variation of a Fiat-Shamir signature scheme. Sign some message m using
/// a secret key but without revealing the value in the process. This uses 
/// g^z = g^r * u^c, where z = r + c*x and u = g^x.
///
/// ```aiken
/// signing.verify(msg, datum, redeemer)
/// ```
pub fn verify(m: ByteArray, datum: Register, redeemer: FiatShamirRedeemer) -> Bool {
  //
  // hash the message and produce the challenge value e
  let h: ByteArray = hash.sha3_256(m)
  let eb: ByteArray = hash.sha3_256(bytearray.concat(h, redeemer.g_r))
  let e: Int = builtin.bytearray_to_integer(True, eb)
  //
  // generator element
  let g: G1Element = builtin.bls12_381_g1_uncompress(datum.alpha)
  // public key element
  let u: G1Element = builtin.bls12_381_g1_uncompress(datum.beta)
  //
  // get the z integer from the redeemer
  let z: Int = builtin.bytearray_to_integer(True, redeemer.z)
  // the z computation: g^z = g^(r + e * x) = g^r * g^(e * x) = g^r * (g^x)^e
  let g_z: G1Element = builtin.bls12_381_g1_scalar_mul(z, g)
  //
  // the g^r term: off-chain computation, uncompress into an element
  let g_r: G1Element = builtin.bls12_381_g1_uncompress(redeemer.g_r)
  //
  //the u^e computation: u^e = (g^x)^e = g^(x * e)
  let u_e: G1Element = builtin.bls12_381_g1_scalar_mul(e, u)
  //
  // the product, g^r * u^e, becomes the sum, g_r + u_e, when using bls12-381
  let rhs: G1Element = builtin.bls12_381_g1_add(g_r, u_e)
  //
  // check if equation: g^z = g^r * u^e -> g^z = rhs, is true
  //
  builtin.bls12_381_g1_equal(g_z, rhs)?
}

test good_verify() {
  // some secret x 
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  // the datum register using the g1 generator and the public value for x
  let datum: Register =
    Register {
      alpha: bls.g1 |> builtin.bls12_381_g1_compress,
      beta: bls.pk(x) |> builtin.bls12_381_g1_compress,
    }
  // this message to sign
  let m: ByteArray = #"acab"
  // a random number
  let r: Int =
    44421586105950619360037151099874190412588687312032470042646096642156420779682
  let g: G1Element = builtin.bls12_381_g1_uncompress(datum.alpha)
  let g_r: G1Element = builtin.bls12_381_g1_scalar_mul(r, g)
  let grb: ByteArray = g_r |> builtin.bls12_381_g1_compress
  // hash the message
  let h: ByteArray = hash.sha3_256(m)
  // construct the e integer
  let eb: ByteArray = hash.sha3_256(bytearray.concat(h, grb))
  let e: Int = builtin.bytearray_to_integer(True, eb)
  // calculate z
  let z: Int = r + x * e
  // build zk data
  let redeemer: FiatShamirRedeemer =
    FiatShamirRedeemer { z: builtin.integer_to_bytearray(True, 0, z), g_r: grb }
  verify(m, datum, redeemer)
}

test rerandomized_good_verify() {
  // some secret x 
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  // the datum register using the g1 generator and the public value for x
  let a0: Register =
    Register {
      alpha: bls.g1 |> builtin.bls12_381_g1_compress,
      beta: bls.pk(x) |> builtin.bls12_381_g1_compress,
    }
  // The re-randomizer number
  let d: Int =
    53767766789778895376051712452456827203944826866229066056242444673395870447090
  // rerandomize the a0 register
  let datum: Register = register.rerandomize(a0, d)
  // this message to sign
  let m: ByteArray = #"acab"
  // a random number
  let r: Int =
    44421586105950619360037151099874190412588687312032470042646096642156420779682
  let g: G1Element = builtin.bls12_381_g1_uncompress(datum.alpha)
  let g_r: G1Element = builtin.bls12_381_g1_scalar_mul(r, g)
  let grb: ByteArray = g_r |> builtin.bls12_381_g1_compress
  // hash the message
  let h: ByteArray = hash.sha3_256(m)
  // construct the e integer
  let eb: ByteArray = hash.sha3_256(bytearray.concat(h, grb))
  let e: Int = builtin.bytearray_to_integer(True, eb)
  // calculate z
  let z: Int = r + x * e
  // build zk data
  let redeemer: FiatShamirRedeemer =
    FiatShamirRedeemer { z: builtin.integer_to_bytearray(True, 0, z), g_r: grb }
  verify(m, datum, redeemer)
}

test bad_verify() fail {
  // some secret x 
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  // the datum register using the g1 generator and the public value for x
  let datum: Register =
    Register {
      alpha: bls.g1 |> builtin.bls12_381_g1_compress,
      beta: bls.pk(x) |> builtin.bls12_381_g1_compress,
    }
  // this message to sign
  let m: ByteArray = #"acab"
  // a random number
  let r: Int =
    44421586105950619360037151099874190412588687312032470042646096642156420779682
  let g: G1Element = builtin.bls12_381_g1_uncompress(datum.alpha)
  let g_r: G1Element = builtin.bls12_381_g1_scalar_mul(r, g)
  let grb: ByteArray = g_r |> builtin.bls12_381_g1_compress
  // hash the message
  let h: ByteArray = hash.sha3_256(m)
  // construct the e integer
  let eb: ByteArray = hash.sha3_256(bytearray.concat(h, grb))
  let e: Int = builtin.bytearray_to_integer(True, eb)
  // calculate z
  let z: Int = r + x * e
  // build zk data
  let redeemer: FiatShamirRedeemer =
    FiatShamirRedeemer { z: builtin.integer_to_bytearray(True, 0, z), g_r: grb }
  verify(#"beef", datum, redeemer)
}
