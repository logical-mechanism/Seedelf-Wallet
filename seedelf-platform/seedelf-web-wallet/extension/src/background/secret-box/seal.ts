// Copyright © 2021 IOHK. Licensed under the Apache License, Version 2.0; see
// LICENSE-APACHE-2.0 in this folder.
// Adapted from Lace (lace-extension@2.4.0) packages/lib/core/src/secret-box/seal.ts.
// Changed by Logical Mechanism LLC: imports @noble/* directly; shorter comments.

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";

import { encodeHeader, HEADER_LEN, NONCE_LEN, SALT_LEN } from "./format";
import { deriveKey } from "./kdf";

/**
 * Encrypts a secret under a password, producing an `SBV1` envelope:
 * MAGIC + salt + nonce + ciphertext + 16-byte Poly1305 tag.
 *
 * A fresh random salt and nonce are drawn per call, so sealing the same
 * plaintext twice gives different blobs and a nonce is never reused under a
 * derived key. The derived key is zeroed before returning.
 */
export const seal = async (plaintext: Uint8Array, password: Uint8Array): Promise<Uint8Array> => {
  const salt = randomBytes(SALT_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const header = encodeHeader(salt, nonce);
  const key = await deriveKey(password, salt);
  try {
    const body = chacha20poly1305(key, nonce, header).encrypt(plaintext);
    const blob = new Uint8Array(HEADER_LEN + body.length);
    blob.set(header, 0);
    blob.set(body, HEADER_LEN);
    return blob;
  } finally {
    key.fill(0);
  }
};
