// Copyright © 2021 IOHK. Licensed under the Apache License, Version 2.0; see
// LICENSE-APACHE-2.0 in this folder.
// Adapted from Lace (lace-extension@2.4.0) packages/lib/core/src/secret-box/open.ts.
// Changed by Logical Mechanism LLC: imports @noble/ciphers directly; the legacy
// EMIP-003 path is removed, so only SBV1 blobs open.

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";

import { decodeEnvelope, headerAad } from "./format";
import { deriveKey } from "./kdf";

/**
 * Decrypts an `SBV1` envelope. A wrong password or a tampered blob fails
 * authentication and throws rather than returning corrupt plaintext. The
 * derived key is zeroed before returning.
 */
export const open = async (blob: Uint8Array, password: Uint8Array): Promise<Uint8Array> => {
  const { salt, nonce, body } = decodeEnvelope(blob);
  const key = await deriveKey(password, salt);
  try {
    return chacha20poly1305(key, nonce, headerAad(blob)).decrypt(body);
  } finally {
    key.fill(0);
  }
};
