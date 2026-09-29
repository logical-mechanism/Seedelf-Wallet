// SecretBox (SBV1), checked against vectors made independently with Python's
// argon2-cffi and cryptography (tests/vectors/secret_box_sbv1.json).
import { readFileSync } from "node:fs";

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SecretBox } from "../src/background/secret-box";
import { HEADER_LEN } from "../src/background/secret-box/format";
import { deriveKey } from "../src/background/secret-box/kdf";

// Lets a test pin the "random" salt and nonce that seal draws.
const pinned: Uint8Array[] = [];
vi.mock("@noble/hashes/utils.js", async (original) => {
  const real = await original<typeof import("@noble/hashes/utils.js")>();
  return { ...real, randomBytes: (n: number) => pinned.shift() ?? real.randomBytes(n) };
});

const doc = JSON.parse(readFileSync(new URL("./vectors/secret_box_sbv1.json", import.meta.url), "utf8"));
const vectors = doc.vectors as Array<Record<string, string>>;
const utf8 = (s: string) => new TextEncoder().encode(s);

afterEach(() => void (pinned.length = 0));

describe("SecretBox SBV1", () => {
  it("has independent vectors", () => {
    expect(doc.spec).toBe("secret-box-sbv1");
    expect(vectors).toHaveLength(2);
  });

  it("derives the Argon2id key of each vector", async () => {
    for (const v of vectors) {
      const key = await deriveKey(utf8(v.password_utf8!), hexToBytes(v.salt!));
      expect(bytesToHex(key)).toBe(v.key);
    }
  });

  it("seals to each vector byte for byte with a pinned salt and nonce", async () => {
    for (const v of vectors) {
      pinned.push(hexToBytes(v.salt!), hexToBytes(v.nonce!));
      const blob = await SecretBox.seal(hexToBytes(v.plaintext!), utf8(v.password_utf8!));
      expect(bytesToHex(blob)).toBe(v.blob);
    }
  });

  it("opens each vector", async () => {
    for (const v of vectors) {
      const plaintext = await SecretBox.open(hexToBytes(v.blob!), utf8(v.password_utf8!));
      expect(bytesToHex(plaintext)).toBe(v.plaintext);
    }
  });

  it("round trips with fresh randomness each time", async () => {
    const secret = hexToBytes("00112233445566778899aabbccddeeff");
    const a = await SecretBox.seal(secret, utf8("a long enough password"));
    const b = await SecretBox.seal(secret, utf8("a long enough password"));
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
    expect(a).toHaveLength(HEADER_LEN + secret.length + 16);
    expect(SecretBox.isSealed(a)).toBe(true);
    expect(await SecretBox.open(a, utf8("a long enough password"))).toEqual(secret);
  });

  it("fails with a wrong password", async () => {
    const v = vectors[0]!;
    await expect(SecretBox.open(hexToBytes(v.blob!), utf8("correct horse battery stapler"))).rejects.toThrow();
  });

  it("fails if any header byte is flipped", async () => {
    const v = vectors[0]!;
    const blob = hexToBytes(v.blob!);
    for (let i = 0; i < HEADER_LEN; i++) {
      const tampered = blob.slice();
      tampered[i]! ^= 0x01;
      await expect(SecretBox.open(tampered, utf8(v.password_utf8!)), `byte ${i}`).rejects.toThrow();
    }
  }, 60_000);

  it("fails if the ciphertext or tag is changed", async () => {
    const v = vectors[0]!;
    const blob = hexToBytes(v.blob!);
    for (const i of [HEADER_LEN, blob.length - 17, blob.length - 1]) {
      const tampered = blob.slice();
      tampered[i]! ^= 0x80;
      await expect(SecretBox.open(tampered, utf8(v.password_utf8!))).rejects.toThrow();
    }
    await expect(SecretBox.open(blob.slice(0, HEADER_LEN + 15), utf8(v.password_utf8!))).rejects.toThrow();
  });

  it("only recognizes SBV1 blobs", () => {
    const blob = hexToBytes(vectors[0]!.blob!);
    expect(SecretBox.isSealed(blob)).toBe(true);
    expect(SecretBox.isSealed(blob.slice(0, HEADER_LEN - 1))).toBe(false);
    const wrongMagic = blob.slice();
    wrongMagic[3] = 0x32; // "SBV2"
    expect(SecretBox.isSealed(wrongMagic)).toBe(false);
  });
});
