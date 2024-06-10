////
////

use aiken/builtin
use seedelf/bls12_381 as bls
use seedelf/types/zk.{Register}

pub type CypherText {
  c1: ByteArray,
  c2: ByteArray,
}

/// Encrypt a bls123-381 encoded message to some register using the ElGamal 
/// encryption scheme. The return type is the two-pair cypher text. These two
/// pieces of data make up the cypher to be passed to the owner of the regiser.
///
/// ```aiken
/// encryption.encrypt(msg, scaler, datum)
/// ```
pub fn encrypt(msg: ByteArray, scaler: Int, datum: Register) -> CypherText {
  //
  // the message element
  let m: G1Element = builtin.bls12_381_g1_uncompress(msg)
  //
  // generator element
  let g: G1Element = builtin.bls12_381_g1_uncompress(datum.alpha)
  //
  // public key element
  let u: G1Element = builtin.bls12_381_g1_uncompress(datum.beta)
  //
  // calculate the random scaler element as c1
  let c1: G1Element = builtin.bls12_381_g1_scalar_mul(scaler, g)
  //
  // calculate the s element to add to the message element
  let s: G1Element = builtin.bls12_381_g1_scalar_mul(scaler, u)
  //
  // add m and s together as c2
  let c2: G1Element = builtin.bls12_381_g1_add(m, s)
  //
  // Build the cypher text element consisting of c1 and c2
  CypherText {
    c1: c1 |> builtin.bls12_381_g1_compress,
    c2: c2 |> builtin.bls12_381_g1_compress,
  }
}

/// Decrypt a cypher text using a cypher key using the ElGamal encryption
/// scheme. The return type is the bls12-381 encoded message.
///
/// ```aiken
/// encryption.decrypt(cypher_text, cypher_key)
/// ```
pub fn decrypt(cypher_text: CypherText, cypher_key: ByteArray) -> ByteArray {
  // convert the cypher text elements
  let c2: G1Element = builtin.bls12_381_g1_uncompress(cypher_text.c2)
  // multiply c1 by the secret key
  let s: G1Element = builtin.bls12_381_g1_uncompress(cypher_key)
  //
  // Find the inverse of the s point
  let neg_s: G1Element = builtin.bls12_381_g1_neg(s)
  //
  // decrypt the msg
  builtin.bls12_381_g1_add(c2, neg_s) |> builtin.bls12_381_g1_compress
}

/// Have Alice encrypt a message and Bob decrypt it.
test encrypt_then_decrypt() {
  //
  // the message Alice wants to encrypt
  let msg: ByteArray = #"acab"
  // encode the message as a point on the curve
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
  // with the cypher text and cypher key, decrypt the secret message
  let decrypted_msg: ByteArray = decrypt(cypher_text, cypher_key)
  //
  // Still can't get the real msg from the point but it does prove that Bob can
  // decrypt Alices encoded msg.
  //
  // need a way to map decrypted message to the plain text message
  decrypted_msg == secret_msg
}
