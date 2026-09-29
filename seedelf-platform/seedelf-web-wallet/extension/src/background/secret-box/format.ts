// Copyright © 2021 IOHK. Licensed under the Apache License, Version 2.0; see
// LICENSE-APACHE-2.0 in this folder.
// Adapted from Lace (lace-extension@2.4.0) packages/lib/core/src/secret-box/format.ts.
// Changed by Logical Mechanism LLC: shorter comments, no EMIP-003 references.

/**
 * Binary envelope format for the `SBV1` Secret Box scheme.
 *
 * ```
 * | offset | size | field            |
 * |--------|------|------------------|
 * | 0      | 4    | MAGIC ("SBV1")   |
 * | 4      | 32   | salt             |
 * | 36     | 12   | nonce            |
 * | 48     | N    | ciphertext+tag   |  (Poly1305 tag = last 16 bytes)
 * ```
 *
 * The magic identifies the scheme in full: Argon2id with the fixed `SBV1` cost
 * parameters followed by ChaCha20-Poly1305 (IETF). A change to the scheme ships
 * as a new magic (`SBV2`), never as a mutated `SBV1` blob. The entire 48-byte
 * header is bound as associated data, so tampering with the magic, salt, or
 * nonce fails authentication on open.
 */

/** The 4-byte magic prefixing every `SBV1` envelope: ASCII "SBV1". */
export const MAGIC = Uint8Array.from([0x53, 0x42, 0x56, 0x31]);

/** Length, in bytes, of the random salt fed to Argon2id. */
export const SALT_LEN = 32;

/** Length, in bytes, of the ChaCha20-Poly1305 (IETF) nonce. */
export const NONCE_LEN = 12;

const MAGIC_LEN = 4;
const OFF_MAGIC = 0;
const OFF_SALT = OFF_MAGIC + MAGIC_LEN;
const OFF_NONCE = OFF_SALT + SALT_LEN;

/** Total length, in bytes, of the fixed `SBV1` header (MAGIC + salt + nonce). */
export const HEADER_LEN = OFF_NONCE + NONCE_LEN;

/** The decoded, non-secret header components plus the ciphertext body. */
export interface DecodedEnvelope {
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
  /** The ciphertext with the 16-byte Poly1305 tag appended. */
  readonly body: Uint8Array;
}

const hasMagic = (blob: Uint8Array): boolean => {
  if (blob.length < MAGIC_LEN) return false;
  for (let index = 0; index < MAGIC_LEN; index++) {
    if (blob[index] !== MAGIC[index]) return false;
  }
  return true;
};

/** Whether a blob is an `SBV1` envelope. Performs no cryptography and never throws. */
export const isSealed = (blob: Uint8Array): boolean =>
  blob.length >= HEADER_LEN && hasMagic(blob);

/**
 * Builds the fixed 48-byte `SBV1` header, which is both the blob's prefix and
 * the AEAD associated data.
 *
 * @throws RangeError If `salt` or `nonce` is not its canonical length.
 */
export const encodeHeader = (salt: Uint8Array, nonce: Uint8Array): Uint8Array => {
  if (salt.length !== SALT_LEN) {
    throw new RangeError(`salt must be ${SALT_LEN} bytes, got ${salt.length}`);
  }
  if (nonce.length !== NONCE_LEN) {
    throw new RangeError(`nonce must be ${NONCE_LEN} bytes, got ${nonce.length}`);
  }
  const header = new Uint8Array(HEADER_LEN);
  header.set(MAGIC, OFF_MAGIC);
  header.set(salt, OFF_SALT);
  header.set(nonce, OFF_NONCE);
  return header;
};

/**
 * Splits an `SBV1` envelope into salt, nonce and body (defensive copies).
 * A forged ciphertext is rejected later, by the authentication tag.
 *
 * @throws Error If the blob lacks the magic or is shorter than the header.
 */
export const decodeEnvelope = (blob: Uint8Array): DecodedEnvelope => {
  if (!isSealed(blob)) {
    throw new Error("not an SBV1 Secret Box envelope");
  }
  return {
    salt: blob.slice(OFF_SALT, OFF_SALT + SALT_LEN),
    nonce: blob.slice(OFF_NONCE, OFF_NONCE + NONCE_LEN),
    body: blob.slice(HEADER_LEN),
  };
};

/** A copy of the header bytes, used as associated data when opening. */
export const headerAad = (blob: Uint8Array): Uint8Array => blob.slice(0, HEADER_LEN);
