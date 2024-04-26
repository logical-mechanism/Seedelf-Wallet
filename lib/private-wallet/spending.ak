////
////

use aiken/builtin
use aiken/bytearray
use aiken/hash
use private_wallet/bls12_381 as bls
use private_wallet/types/zk.{Register, ZK}

/// A bytearray of a value for the challenge c. This process should act like a
/// random oracle providing a large challenge value for the user. The inputs
/// should be compressed g1 elements but they can also be compressed integers.
///
/// ```aiken
/// spending.fiat_shamir_transform(gb, grb, ub)
/// ```
pub fn fiat_shamir_transform(
  // compressed g element
  gb: ByteArray,
  // compressed g^r element
  grb: ByteArray,
  // compressed g^x element
  ub: ByteArray,
) -> ByteArray {
  // concat gb, grb, and ub together then hash the result
  // sha3_256 should be ok to use here
  gb
    |> bytearray.concat(grb)
    |> bytearray.concat(ub)
    |> hash.sha3_256()
}

test empty_fiat_shamir_transform() {
  fiat_shamir_transform(#"", #"", #"") == #"a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
}

test real_fiat_shamir_transform() {
  fiat_shamir_transform(
    #"86f0c64bd433568dd92751f0bee97feaaeee6f3c2144b210be68d2bc85253b1994703caf7f8361ccf246fef52c0ad859",
    #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
    #"a2cbc5c3c72a7bc9047971345df392a67279d2f32082891976d913c699885c3ff9a90a8ea942bef4729cf93f526521e4",
  ) == #"524fb8209e14641b3202adcab15bddae592b83fafc34d74abb79b572bd883930"
}

/// A variation of a Schnorr signature. Prove knowledge of the secret value x
/// without revealing the value in the process. This uses g^z = g^r * u^c, 
/// where z = r + c*x and u = g^x. This function uses the Fiat-Shamir transform
/// for non-interactivity.
///
/// ```aiken
/// spending.d_log(datum, redeemer)
/// ```
pub fn d_log(datum: Register, redeemer: ZK) -> Bool {
  //
  // get the z integer from the redeemer
  let z: Int = builtin.bytearray_to_integer(True, redeemer.z)
  //
  // generator element
  let g: G1Element = builtin.bls12_381_g1_uncompress(datum.alpha)
  // public key element
  let u: G1Element = builtin.bls12_381_g1_uncompress(datum.beta)
  //
  // the z computation: g^z = g^(r + c * x) = g^r * g^(c * x) = g^r * (g^x)^c
  let g_z: G1Element = builtin.bls12_381_g1_scalar_mul(z, g)
  //
  // the g^r term: off-chain computation, uncompress into an element
  let g_r: G1Element = builtin.bls12_381_g1_uncompress(redeemer.g_r)
  //
  // use the fiat-shamir transform to calculate c then convert it to an integer
  let cb: ByteArray =
    fiat_shamir_transform(datum.alpha, redeemer.g_r, datum.beta)
  let c: Int = builtin.bytearray_to_integer(True, cb)
  //
  // the u^c computation: u^c = (g^x)^c = g^(x * c)
  let u_c: G1Element = builtin.bls12_381_g1_scalar_mul(c, u)
  //
  // the product, g^r * u^c, becomes the sum, g_r + u_c, when using bls12-381
  let rhs: G1Element = builtin.bls12_381_g1_add(g_r, u_c)
  //
  // check if equation: g^z = g^r * u^c -> g^z = rhs, is true
  //
  builtin.bls12_381_g1_equal(g_z, rhs)?
}

test d_log_256_bit_secret() {
  // some secret x 
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  // the datum register using the g1 generator and the public value for x
  let a0: Register =
    Register {
      alpha: bls.g1() |> builtin.bls12_381_g1_compress,
      beta: bls.pk(x) |> builtin.bls12_381_g1_compress,
    }
  // a random number
  let r: Int =
    44421586105950619360037151099874190412588687312032470042646096642156420779682
  // calculate the g^r term
  let g: G1Element = builtin.bls12_381_g1_uncompress(a0.alpha)
  let g_r: G1Element = builtin.bls12_381_g1_scalar_mul(r, g)
  // the challenge number using a fiat shamir transform
  let cb: ByteArray =
    fiat_shamir_transform(
      a0.alpha,
      g_r |> builtin.bls12_381_g1_compress,
      a0.beta,
    )
  let c: Int = builtin.bytearray_to_integer(True, cb)
  // the z value
  let z: Int = r + c * x
  // build zk data
  let zk: ZK =
    ZK {
      z: builtin.integer_to_bytearray(True, 0, z),
      g_r: g_r |> builtin.bls12_381_g1_compress,
    }
  d_log(a0, zk)
}

test can_unlock_after_rerandomizing() {
  // some secret x
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  // the datum register
  let a0: Register =
    Register {
      alpha: bls.g1() |> builtin.bls12_381_g1_compress,
      beta: bls.pk(x) |> builtin.bls12_381_g1_compress,
    }
  // The re-randomizer number
  let d: Int =
    53767766789778895376051712452456827203944826866229066056242444673395870447090
  // rerandomizing the a0 register
  let a1: Register = zk.rerandomizing(a0, d)
  // a random number
  let r: Int =
    44421586105950619360037151099874190412588687312032470042646096642156420779682
  // calculate the g^r term off chain here
  let g: G1Element = builtin.bls12_381_g1_uncompress(a1.alpha)
  let g_r: G1Element = builtin.bls12_381_g1_scalar_mul(r, g)
  // the challenge number using a fiat shamir transform
  let cb: ByteArray =
    fiat_shamir_transform(
      a1.alpha,
      g_r |> builtin.bls12_381_g1_compress,
      a1.beta,
    )
  // convert to an integer and do the calculation
  let c: Int = builtin.bytearray_to_integer(True, cb)
  // the z value
  let z: Int = r + c * x
  // build zk data
  let zk: ZK =
    ZK {
      z: builtin.integer_to_bytearray(True, 0, z),
      g_r: g_r |> builtin.bls12_381_g1_compress,
    }
  d_log(a1, zk)
}

test cant_spend_good_verify_msg() fail {
  // some secret x 
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  // the datum register using the g1 generator and the public value for x
  let datum: Register =
    Register {
      alpha: bls.g1() |> builtin.bls12_381_g1_compress,
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
  let redeemer: ZK =
    ZK { z: builtin.integer_to_bytearray(True, 0, z), g_r: grb }
  d_log(datum, redeemer)
}

// This will check how many zk proofs can be inside one tx, its about 37 or so
test many_unlocks() {
  // some secret x
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  // the datum register
  let a0: Register =
    Register {
      alpha: bls.g1() |> builtin.bls12_381_g1_compress,
      beta: bls.pk(x) |> builtin.bls12_381_g1_compress,
    }
  // The re-randomizer number
  let d: Int =
    53767766789778895376051712452456827203944826866229066056242444673395870447090
  // rerandomizing the a0 register
  let a1: Register = zk.rerandomizing(a0, d)
  // a random number
  let r: Int =
    44421586105950619360037151099874190412588687312032470042646096642156420779682
  // calculate the g^r term off chain here
  let g: G1Element = builtin.bls12_381_g1_uncompress(a1.alpha)
  let g_r: G1Element = builtin.bls12_381_g1_scalar_mul(r, g)
  // the challenge number using a fiat shamir transform
  let cb: ByteArray =
    fiat_shamir_transform(
      a1.alpha,
      g_r |> builtin.bls12_381_g1_compress,
      a1.beta,
    )
  // convert to an integer and do the calculation
  let c: Int = builtin.bytearray_to_integer(True, cb)
  // the z value
  let z: Int = r + c * x
  // build zk data
  let zk: ZK =
    ZK {
      z: builtin.integer_to_bytearray(True, 0, z),
      g_r: g_r |> builtin.bls12_381_g1_compress,
    }
  and {
    // 1
    d_log(a1, zk),
    // 2
    d_log(a1, zk),
    // 3
    d_log(a1, zk),
    // 4
    d_log(a1, zk),
    // 5
    d_log(a1, zk),
    // 6
    d_log(a1, zk),
    // 7
    d_log(a1, zk),
    // 8
    d_log(a1, zk),
    // 9
    d_log(a1, zk),
    // 10
    d_log(a1, zk),
    // 11
    d_log(a1, zk),
    // 12
    d_log(a1, zk),
    // 13
    d_log(a1, zk),
    // 14
    d_log(a1, zk),
    // 15
    d_log(a1, zk),
    // 16
    d_log(a1, zk),
    // 17
    d_log(a1, zk),
    // 18
    d_log(a1, zk),
    // 19
    d_log(a1, zk),
    // 20
    d_log(a1, zk),
    // 21
    d_log(a1, zk),
    // 22
    d_log(a1, zk),
    // 23
    d_log(a1, zk),
    // 24
    d_log(a1, zk),
    // 25
    d_log(a1, zk),
    // 26
    d_log(a1, zk),
    // 27
    d_log(a1, zk),
    // 28
    d_log(a1, zk),
    // 29
    d_log(a1, zk),
    // 30
    d_log(a1, zk),
    // 31
    d_log(a1, zk),
    // 32
    d_log(a1, zk),
    // 33
    d_log(a1, zk),
    // 34
    d_log(a1, zk),
    // 35
    d_log(a1, zk),
    // 36
    d_log(a1, zk),
    // 37
    d_log(a1, zk),
  }
}
