// The wallet's vault: the recovery phrase's BIP39 entropy, sealed with
// SecretBox (SBV1) under the user's password and kept in chrome.storage.local.
// Every key is re-derived from it on unlock; no derived key is ever stored.
// See docs/keys-and-accounts.md#password-and-vault.

import { SecretBox } from "./secret-box";
import { fromBase64, toBase64 } from "./storage";

/** chrome.storage.local key of the vault record. */
export const VAULT_KEY = "seedelf.vault";

export interface VaultRecord {
  version: 1;
  /** The SBV1 blob, base64. */
  blob: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
}

/** Opening the vault failed authentication: the password is wrong. */
export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password.");
  }
}

/** Seals `entropy` under `password`. The password's bytes are zeroed after use. */
export async function sealVault(entropy: Uint8Array, password: string, now: number): Promise<VaultRecord> {
  const secret = new TextEncoder().encode(password);
  try {
    return { version: 1, blob: toBase64(await SecretBox.seal(entropy, secret)), createdAt: now };
  } finally {
    secret.fill(0);
  }
}

/**
 * Opens the vault and returns the entropy; the caller zeroes it. A wrong
 * password throws {@link WrongPasswordError}; the AEAD tag is the password
 * check, so no separate sentinel is stored.
 */
export async function openVault(record: VaultRecord, password: string): Promise<Uint8Array> {
  if (record.version !== 1) throw new Error(`Unknown vault version ${String(record.version)}.`);
  const blob = fromBase64(record.blob);
  if (!SecretBox.isSealed(blob)) throw new Error("The vault is damaged.");
  const secret = new TextEncoder().encode(password);
  try {
    return await SecretBox.open(blob, secret);
  } catch {
    throw new WrongPasswordError();
  } finally {
    secret.fill(0);
  }
}
