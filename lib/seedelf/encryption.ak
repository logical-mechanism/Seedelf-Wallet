use aiken/builtin
use seedelf/bls12_381 as bls
use seedelf/types/zk.{Register}

pub type CypherText {
  c1: ByteArray,
  c2: ByteArray,
}

pub fn encrypt(msg: ByteArray, scaler: Int, datum: Register) -> CypherText {
  // the message element
  let m: G1Element = builtin.bls12_381_g1_uncompress(msg)
  // generator element
  let g: G1Element = builtin.bls12_381_g1_uncompress(datum.alpha)
  // public key element
  let u: G1Element = builtin.bls12_381_g1_uncompress(datum.beta)
  // calculate the random scaler element as c1
  let c1: G1Element = builtin.bls12_381_g1_scalar_mul(scaler, g)
  // calculate the s element to add to the message element
  let s: G1Element = builtin.bls12_381_g1_scalar_mul(scaler, u)
  // add m and s together as c2
  let c2: G1Element = builtin.bls12_381_g1_add(m, s)
  // Build the cypher text element
  let c: CypherText =
    CypherText {
      c1: c1 |> builtin.bls12_381_g1_compress,
      c2: c2 |> builtin.bls12_381_g1_compress,
    }
  c
}

pub fn decrypt(cypher: CypherText, cypher_key: ByteArray) -> ByteArray {
  // convert the cypher text elements
  let c2: G1Element = builtin.bls12_381_g1_uncompress(cypher.c2)
  // multiply c1 by the secret key
  let s: G1Element = builtin.bls12_381_g1_uncompress(cypher_key)
  //
  // Find the inverse of the s point
  let neg_s: G1Element = builtin.bls12_381_g1_neg(s)
  //
  // decrypt the msg
  let decrypt_msg: G1Element = builtin.bls12_381_g1_add(c2, neg_s)
  decrypt_msg |> builtin.bls12_381_g1_compress
}

test encrypt_then_decrypt() {
  //
  // the message Alice wants to encrypt
  let msg: ByteArray = #"acabcafe"
  let secret_msg: ByteArray =
    bls.pk(builtin.bytearray_to_integer(True, msg))
      |> builtin.bls12_381_g1_compress
  // a random scaler
  let scaler: Int =
    44421586105950619360037151099874190412588687312032470042646096642156420779682
  //
  // Bob's Registry Datum
  //
  // Bob's secret x 
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  // the datum register using the g1 generator and the public value for x
  let datum: Register =
    Register {
      alpha: bls.g1() |> builtin.bls12_381_g1_compress,
      beta: bls.pk(x) |> builtin.bls12_381_g1_compress,
    }
  // encrypt the secret msg
  let cypher_text: CypherText = encrypt(secret_msg, scaler, datum)
  // now decrypt the message
  let c1: G1Element = builtin.bls12_381_g1_uncompress(cypher_text.c1)
  // this would be done off chain to keep x private
  let cypher_key: ByteArray =
    builtin.bls12_381_g1_scalar_mul(x, c1)
      |> builtin.bls12_381_g1_compress
  let decrypted_msg: ByteArray = decrypt(cypher_text, cypher_key)
  //
  // Still can get the real msg from the point
  decrypted_msg == secret_msg
}

test simple_elgamal_encryption() {
  //
  // the message Alice wants to encrypt
  let secret_msg: ByteArray = #"acabcafe"
  //
  // we need a way to encode it to a point on the curve
  let msg: G1Element = bls.pk(builtin.bytearray_to_integer(True, secret_msg))
  //
  // Bob's secret
  let x: Int =
    86478456268645743314319142250097583782656584143510069178425111699273215020899
  //
  // Bob's Public key
  let y: G1Element = bls.pk(x)
  //
  // Alice will encrypt the secret msg
  //
  // a random scaler
  let k: Int =
    44421586105950619360037151099874190412588687312032470042646096642156420779682
  // calculate the random point on the curve
  let c1: G1Element = bls.pk(k)
  // use Bob's public key with the random scaler
  let s: G1Element = builtin.bls12_381_g1_scalar_mul(k, y)
  // add the msg point and Bob's scaled public key
  let encrypt_msg: G1Element = builtin.bls12_381_g1_add(msg, s)
  // (c1, encrypt_msg) is the cipher text to pass to Bob
  //
  // now Bob will decrypt the encrypted msg
  //
  // multiply c1 by Bob's secret
  let sd: G1Element = builtin.bls12_381_g1_scalar_mul(x, c1)
  //
  // Find the inverse of this point
  let inverse_sd: G1Element = builtin.bls12_381_g1_neg(sd)
  //
  // decrypt the msg
  let decrypt_msg: G1Element = builtin.bls12_381_g1_add(encrypt_msg, inverse_sd)
  // now we can prove that the msg is the same point on the curve
  // but we can't get the actually msg since it has to be encoded onto the curve
  //
  // This happens because scaler multiplication of a curve on bls12-381 ought
  // to be a one-way function and can not be inversed.
  msg == decrypt_msg
}
