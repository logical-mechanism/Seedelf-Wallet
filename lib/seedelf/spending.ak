use aiken/builtin
use aiken/crypto
use aiken/primitive/bytearray
use seedelf/bls
use seedelf/types/register.{Register}

/// The zero knowledge elements required for the proof. The c value will be
/// computed using the Fiat-Shamir heuristic.
pub type SchnorrRedeemer {
  // this is z = r + c*x
  z: ByteArray,
  // this is the g^r compressed G1Element
  g_r: ByteArray,
}

/// A bytearray of a value for the challenge c. This process should act like a
/// random oracle providing a large challenge value for the user. The inputs
/// should be compressed g1 elements but they can also be compressed integers.
///
/// ```aiken
/// fiat_shamir_heuristic(gb, grb, ub)
/// ```
pub fn fiat_shamir_heuristic(
  // compressed g element
  gb: ByteArray,
  // compressed g^r element
  grb: ByteArray,
  // compressed g^x element
  ub: ByteArray,
) -> ByteArray {
  // concat gb, grb, and ub together then hash the result
  // blake2b_256 is the cheapest on chain
  gb
    |> bytearray.concat(grb)
    |> bytearray.concat(ub)
    |> crypto.blake2b_256()
}

test empty_fiat_shamir_transform() {
  fiat_shamir_heuristic(#"", #"", #"") == #"0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8"
}

test real_fiat_shamir_transform1() {
  fiat_shamir_heuristic(
    #"86f0c64bd433568dd92751f0bee97feaaeee6f3c2144b210be68d2bc85253b1994703caf7f8361ccf246fef52c0ad859",
    #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
    #"a2cbc5c3c72a7bc9047971345df392a67279d2f32082891976d913c699885c3ff9a90a8ea942bef4729cf93f526521e4",
  ) == #"446cc50b0fb56f2b4ad46319e628566838622640baddd9b7df31f690b38c1410"
}

test real_fiat_shamir_transform2() {
  fiat_shamir_heuristic(
    #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
    #"81b223cea171a87feba9b7749a2df7601c5a75ae01155fadc124a2ac49099a514cf1e7d9cdc769dceab14a95bd6cb0bd",
    #"a09d99e02f7200526dc55ef722cc171e7aa14fc732614c02ac58d59d7026a7eb18d8798f6928ea2b513f3a4feb0c94d1",
  ) == #"f8624d457933fab54654902f296a22b15e4062da7bba8ae2ba0bc15dec4d096b"
}

/// A Schnorr proof. Prove knowledge of the secret value x without revealing 
/// the value in the process. The proof uses, in multiplicative form, 
/// g^z = g^r * u^c, where z = r + c*x and u = g^x. This function uses the 
/// Fiat-Shamir heuristic for non-interactivity.
///
/// ```aiken
/// schnorr_proof(datum, redeemer)
/// ```
pub fn schnorr_proof(datum: Register, redeemer: SchnorrRedeemer) -> Bool {
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
    fiat_shamir_heuristic(datum.alpha, redeemer.g_r, datum.beta)
  let c: Int = builtin.bytearray_to_integer(True, cb)
  //
  // the u^c computation: u^c = (g^x)^c = g^(x * c)
  let u_c: G1Element = builtin.bls12_381_g1_scalar_mul(c, u)
  //
  // the product, g^r * u^c, becomes the sum, g_r + u_c because bls12-381
  let rhs: G1Element = builtin.bls12_381_g1_add(g_r, u_c)
  //
  // check if equation: g^z = g^r * u^c -> g^z = rhs, is true
  //
  builtin.bls12_381_g1_equal(g_z, rhs)?
}

test schnorr_proof_256_bit_secret() {
  // some secret x 
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  // the datum register using the g1 generator and the public value for x
  let a0: Register =
    Register {
      alpha: bls.g1 |> builtin.bls12_381_g1_compress,
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
    fiat_shamir_heuristic(
      a0.alpha,
      g_r |> builtin.bls12_381_g1_compress,
      a0.beta,
    )
  let c: Int = builtin.bytearray_to_integer(True, cb)
  // the z value
  let z: Int = r + c * x
  // build zk data
  let zk: SchnorrRedeemer =
    SchnorrRedeemer {
      z: builtin.integer_to_bytearray(True, 0, z),
      g_r: g_r |> builtin.bls12_381_g1_compress,
    }
  schnorr_proof(a0, zk)
}

test can_unlock_after_rerandomize() {
  // some secret x
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  // the datum register
  let a0: Register =
    Register {
      alpha: bls.g1 |> builtin.bls12_381_g1_compress,
      beta: bls.pk(x) |> builtin.bls12_381_g1_compress,
    }
  // The re-randomizer number
  let d: Int =
    53767766789778895376051712452456827203944826866229066056242444673395870447090
  // rerandomize the a0 register
  let a1: Register = register.rerandomize(a0, d)
  // a random number
  let r: Int =
    44421586105950619360037151099874190412588687312032470042646096642156420779682
  // calculate the g^r term off chain here
  let g: G1Element = builtin.bls12_381_g1_uncompress(a1.alpha)
  let g_r: G1Element = builtin.bls12_381_g1_scalar_mul(r, g)
  // the challenge number using a fiat shamir transform
  let cb: ByteArray =
    fiat_shamir_heuristic(
      a1.alpha,
      g_r |> builtin.bls12_381_g1_compress,
      a1.beta,
    )
  // convert to an integer and do the calculation
  let c: Int = builtin.bytearray_to_integer(True, cb)
  // the z value
  let z: Int = r + c * x
  // build zk data
  let zk: SchnorrRedeemer =
    SchnorrRedeemer {
      z: builtin.integer_to_bytearray(True, 0, z),
      g_r: g_r |> builtin.bls12_381_g1_compress,
    }
  schnorr_proof(a1, zk)
}

test can_unlock_after_rerandomize_without_calc() {
  // rerandomize the a0 register
  let a1: Register =
    Register {
      alpha: #"852ed39c8a452bfaad484794323f2bce378fe4be4cf1c06be8cf81fe8749b15e9359e44241b6e016b29de4f18ec3a1de",
      beta: #"88912c6e654e5fd4039658928e5697cd9c3728f20b7ecc579193f0912a2c6c10686d050c70af19c2b65554713c29ea2e",
    }
  // build zk data
  let zk: SchnorrRedeemer =
    SchnorrRedeemer {
      z: #"19e586706d70fc9b9392d49a803e7f6c5a20d744982ad399664c7bb7cc561b03921ade05c1eaa6b5b6d442e9afab49bb5c172a643796a4bdc267fea5ec64ffc9",
      g_r: #"b9976d292b39f82aef6a7129343de416e790a04f8cad025077bde44b466017ef70dc774fad368723a7c1aa4903aefa0f",
    }
  schnorr_proof(a1, zk)
}

test cant_spend_good_verify_msg() fail {
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
  let h: ByteArray = crypto.sha3_256(m)
  // construct the e integer
  let eb: ByteArray = crypto.sha3_256(bytearray.concat(h, grb))
  let e: Int = builtin.bytearray_to_integer(True, eb)
  // calculate z
  let z: Int = r + x * e
  // build zk data
  let redeemer: SchnorrRedeemer =
    SchnorrRedeemer { z: builtin.integer_to_bytearray(True, 0, z), g_r: grb }
  schnorr_proof(datum, redeemer)
}

// This will check how many zk proofs can be inside one tx, its about 37 or so
test many_unlocks() {
  // rerandomize the a0 register
  let a1: Register =
    Register {
      alpha: #"852ed39c8a452bfaad484794323f2bce378fe4be4cf1c06be8cf81fe8749b15e9359e44241b6e016b29de4f18ec3a1de",
      beta: #"88912c6e654e5fd4039658928e5697cd9c3728f20b7ecc579193f0912a2c6c10686d050c70af19c2b65554713c29ea2e",
    }
  // build zk data
  let zk: SchnorrRedeemer =
    SchnorrRedeemer {
      z: #"19e586706d70fc9b9392d49a803e7f6c5a20d744982ad399664c7bb7cc561b03921ade05c1eaa6b5b6d442e9afab49bb5c172a643796a4bdc267fea5ec64ffc9",
      g_r: #"b9976d292b39f82aef6a7129343de416e790a04f8cad025077bde44b466017ef70dc774fad368723a7c1aa4903aefa0f",
    }
  and {
    // 1
    schnorr_proof(a1, zk),
    // 2
    schnorr_proof(a1, zk),
    // 3
    schnorr_proof(a1, zk),
    // 4
    schnorr_proof(a1, zk),
    // 5
    schnorr_proof(a1, zk),
    // 6
    schnorr_proof(a1, zk),
    // 7
    schnorr_proof(a1, zk),
    // 8
    schnorr_proof(a1, zk),
    // 9
    schnorr_proof(a1, zk),
    // 10
    schnorr_proof(a1, zk),
    // 11
    schnorr_proof(a1, zk),
    // 12
    schnorr_proof(a1, zk),
    // 13
    schnorr_proof(a1, zk),
    // 14
    schnorr_proof(a1, zk),
    // 15
    schnorr_proof(a1, zk),
    // 16
    schnorr_proof(a1, zk),
    // 17
    schnorr_proof(a1, zk),
    // 18
    schnorr_proof(a1, zk),
    // 19
    schnorr_proof(a1, zk),
    // 20
    schnorr_proof(a1, zk),
    // 21
    schnorr_proof(a1, zk),
    // 22
    schnorr_proof(a1, zk),
    // 23
    schnorr_proof(a1, zk),
    // 24
    schnorr_proof(a1, zk),
    // 25
    schnorr_proof(a1, zk),
    // 26
    schnorr_proof(a1, zk),
    // 27
    schnorr_proof(a1, zk),
    // 28
    schnorr_proof(a1, zk),
    // 29
    schnorr_proof(a1, zk),
  }
}

test cheapest_hash() {
  // PASS [mem:    805, cpu:    2467639] expensive hash
  // crypto.keccak_256(#"") == #"c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  //
  // PASS [mem:    805, cpu:    1663641] cheap hash
  // crypto.sha3_256(#"") == #"a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
  //
  // PASS [mem:    805, cpu:     434990] cheaper hash
  // crypto.sha2_256(#"") == #"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  //
  // PASS [mem:    805, cpu:     351411] cheapest hash
  crypto.blake2b_256(#"") == #"0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8"
  //
}
