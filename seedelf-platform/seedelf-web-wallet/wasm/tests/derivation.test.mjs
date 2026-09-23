// The v1 Seedelf key derivation through WebAssembly, checked against the
// same frozen vectors seedelf-crypto's Rust tests use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SeedelfKey, generatePhrase, rerandomize, validatePhrase } from "./wasm.mjs";

const { spec, vectors } = JSON.parse(
  readFileSync(
    new URL("../../../seedelf-crypto/tests/vectors/seedelf_key_v1.json", import.meta.url),
  ),
);

test("frozen v1 vectors match through WebAssembly", () => {
  assert.equal(spec, "seedelf-key-v1");
  assert.equal(vectors.length, 7);
  for (const v of vectors) {
    const key = SeedelfKey.fromPhrase(v.phrase, v.account);
    assert.equal(key.baseRegister().publicValue, v.public_value, `${v.phrase} / ${v.account}`);
    key.free();
  }
});

test("a phrase key owns registers re-randomized from its base", () => {
  const [v] = vectors;
  const key = SeedelfKey.fromPhrase(v.phrase, v.account);
  const other = SeedelfKey.fromPhrase(v.phrase, v.account + 1);
  const register = rerandomize(key.baseRegister());
  assert.ok(key.isOwned(register));
  assert.ok(!other.isOwned(register));
  key.free();
  other.free();
});

test("typed phrases are normalized", () => {
  const [v] = vectors;
  const messy = `  ${v.phrase.toUpperCase().split(" ").join("   ")}\n`;
  const key = SeedelfKey.fromPhrase(messy, v.account);
  assert.equal(key.baseRegister().publicValue, v.public_value);
  key.free();
});

test("validatePhrase explains what is wrong", () => {
  const [v] = vectors;
  assert.doesNotThrow(() => validatePhrase(v.phrase));
  assert.throws(() => validatePhrase(v.phrase.split(" ").slice(0, 12).join(" ")), /24 words/);
  assert.throws(() => validatePhrase(v.phrase.replace(/ art$/, " abandon")), /checksum/);
  assert.throws(() => validatePhrase(v.phrase.replace(/^abandon/, "notaword")), /word 1/);
});

test("generated phrases are 24 valid, distinct words", () => {
  const a = generatePhrase();
  const b = generatePhrase();
  assert.notEqual(a, b);
  assert.equal(a.split(" ").length, 24);
  assert.doesNotThrow(() => validatePhrase(a));
  SeedelfKey.fromPhrase(a, 0).free();
});
