// Smoke test for the built WebAssembly package (run ./build.sh first):
//   node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"
// Checks that the JS-facing API works and matches native seedelf-crypto
// byte for byte on a pinned vector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  initSync,
  Register,
  SeedelfKey,
  isValidRegister,
  registerToDatum,
  rerandomize,
  verifyProof,
} from "../pkg/seedelf_wasm.js";

initSync({
  module: readFileSync(new URL("../pkg/seedelf_wasm_bg.wasm", import.meta.url)),
});

// Same vector as seedelf-crypto's `random_register` test: sk = 18446744073709551606.
const VECTOR_SK = "000000000000000000000000000000000000000000000000fffffffffffffff6";
const G1 =
  "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
const VECTOR_PUBLIC_VALUE =
  "82dcf46570656ca0d6fb143b8e7c2816b20cb1a6434ca4c8c95c624443c22c9e1d40ad0df5de088b19a4b44b685b8475";
const R = "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";
const VKH = "ab".repeat(28);

test("base register matches the native vector", () => {
  const key = SeedelfKey.fromHex(VECTOR_SK);
  const base = key.baseRegister();
  assert.equal(base.generator, G1);
  assert.equal(base.publicValue, VECTOR_PUBLIC_VALUE);
  key.free();
});

test("fromHex rejects zero, non-canonical and malformed keys", () => {
  assert.throws(() => SeedelfKey.fromHex("00".repeat(32)), /zero/);
  assert.throws(() => SeedelfKey.fromHex(R), /canonical/);
  assert.throws(() => SeedelfKey.fromHex("01".repeat(31)), /32 bytes/);
  assert.throws(() => SeedelfKey.fromHex("zz"), /hex/);
});

test("re-randomized registers stay owned by their key only", () => {
  const key = SeedelfKey.random();
  const other = SeedelfKey.random();
  const register = rerandomize(key.baseRegister());

  assert.notEqual(register.generator, G1);
  assert.ok(isValidRegister(register));
  assert.ok(key.isOwned(register));
  assert.ok(!other.isOwned(register));
  key.free();
  other.free();
});

test("proofs verify only against the vkh they were bound to", () => {
  const key = SeedelfKey.random();
  const register = rerandomize(key.baseRegister());
  const proof = key.createProof(register, VKH);

  assert.match(proof.z, /^[0-9a-f]{64}$/);
  assert.match(proof.gR, /^[0-9a-f]{96}$/);
  assert.ok(verifyProof(register, proof.z, proof.gR, VKH));
  assert.ok(!verifyProof(register, proof.z, proof.gR, "cd".repeat(28)));
  assert.throws(() => key.createProof(register, "ab".repeat(27)), /28-byte/);
  key.free();
});

test("invalid points are refused", () => {
  const bogus = new Register("00".repeat(48), "00".repeat(48));
  assert.throws(() => rerandomize(bogus));
  assert.throws(() => isValidRegister(bogus));
});

test("datum encodes as PlutusData constr 0 with two byte strings", () => {
  const key = SeedelfKey.fromHex(VECTOR_SK);
  const hex = Buffer.from(registerToDatum(key.baseRegister())).toString("hex");
  // tag 121 (constr 0), indefinite list, 48-byte string, 48-byte string, break
  assert.equal(hex, `d8799f5830${G1}5830${VECTOR_PUBLIC_VALUE}ff`);
  key.free();
});
