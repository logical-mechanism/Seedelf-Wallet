// Copyright © 2021 IOHK. Licensed under the Apache License, Version 2.0; see
// LICENSE-APACHE-2.0 in this folder.
// Adapted from Lace (lace-extension@2.4.0) packages/lib/core/src/secret-box/kdf.ts
// and constants.ts.
// Changed by Logical Mechanism LLC: imports @noble/hashes directly; DERIVED_KEY_LEN
// moved here from constants.ts; shorter comments.

import { argon2idAsync } from "@noble/hashes/argon2.js";

/** Length of the derived ChaCha20-Poly1305 key. Fixed, so not stored in the envelope. */
export const DERIVED_KEY_LEN = 32;

/**
 * Fixed Argon2id cost parameters for `SBV1`: memory `m` in KiB, `t` passes,
 * parallelism `p`. These are the OWASP minimum for Argon2id. A change ships as
 * a new magic (`SBV2`).
 */
export const SBV1_ARGON2ID = { m: 19_456, t: 2, p: 1 } as const;

export type Argon2idParams = {
  readonly m: number;
  readonly t: number;
  readonly p: number;
  readonly dkLen: number;
};

/** An Argon2id (version 1.3) key derivation function. */
export type Argon2idImplementation = (
  password: Uint8Array,
  salt: Uint8Array,
  params: Argon2idParams,
) => Promise<Uint8Array>;

const jsArgon2id: Argon2idImplementation = async (password, salt, params) =>
  argon2idAsync(password, salt, params);

const active = { argon2id: jsArgon2id };

/**
 * Replaces the Argon2id implementation used by `seal` and `open`, for example
 * with a WebAssembly one. `undefined` restores the default.
 */
export const setArgon2idImplementation = (implementation?: Argon2idImplementation): void => {
  active.argon2id = implementation ?? jsArgon2id;
};

/**
 * Derives the 32-byte ChaCha20 key from a password and salt using Argon2id.
 * The caller zeroes the returned key after use.
 */
export const deriveKey = async (password: Uint8Array, salt: Uint8Array): Promise<Uint8Array> =>
  active.argon2id(password, salt, { ...SBV1_ARGON2ID, dkLen: DERIVED_KEY_LEN });
