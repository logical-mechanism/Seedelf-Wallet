// Vault entropy and the BIP39 word list through WebAssembly: the vault
// stores a phrase's entropy, and unlock re-derives every key from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CardanoAccount,
  Network,
  SeedelfKey,
  bip39Wordlist,
  entropyToPhrase,
  phraseToEntropy,
} from "./wasm.mjs";

const vectors = (name) =>
  JSON.parse(readFileSync(new URL(`../../../seedelf-crypto/tests/vectors/${name}`, import.meta.url)))
    .vectors;

test("entropy round trips on every Seedelf key vector", () => {
  for (const v of vectors("seedelf_key_v1.json")) {
    const entropy = phraseToEntropy(v.phrase);
    assert.ok(entropy instanceof Uint8Array);
    assert.equal(entropy.length, (v.phrase.split(" ").length / 3) * 4);
    assert.equal(entropyToPhrase(entropy), v.phrase);
  }
});

test("keys from entropy match keys from the phrase", () => {
  for (const v of vectors("seedelf_key_v1.json")) {
    const key = SeedelfKey.fromEntropy(phraseToEntropy(v.phrase), v.account);
    assert.equal(key.baseRegister().publicValue, v.public_value);
    key.free();
  }
  for (const v of vectors("cardano_account.json")) {
    const account = CardanoAccount.fromEntropy(phraseToEntropy(v.phrase), v.account);
    assert.equal(account.receiveAddress(Network.Preprod, 0), v.preprod.receive_0);
    assert.equal(account.stakeAddress(Network.Mainnet), v.mainnet.stake);
    account.free();
  }
});

test("phraseToEntropy normalizes and explains bad phrases", () => {
  const [v] = vectors("seedelf_key_v1.json");
  const messy = `  ${v.phrase.toUpperCase().split(" ").join("  \n ")} `;
  assert.deepEqual(phraseToEntropy(messy), phraseToEntropy(v.phrase));
  assert.throws(() => phraseToEntropy("abandon abandon"), /12, 15 or 24 words, got 2/);
});

test("only 12-, 15- and 24-word entropy is accepted", () => {
  for (const len of [16, 20, 32]) {
    const phrase = entropyToPhrase(new Uint8Array(len).fill(0xa5));
    assert.equal(phrase.split(" ").length, (len / 4) * 3);
  }
  for (const len of [0, 24, 28, 33]) {
    assert.throws(() => entropyToPhrase(new Uint8Array(len)), /16, 20 or 32 bytes/);
    assert.throws(() => SeedelfKey.fromEntropy(new Uint8Array(len), 0), /16, 20 or 32 bytes/);
  }
});

test("the word list is BIP39 English", () => {
  const list = bip39Wordlist();
  assert.equal(list.length, 2048);
  assert.equal(list[0], "abandon");
  assert.equal(list[2047], "zoo");
  assert.equal(new Set(list.map((w) => w.slice(0, 4))).size, 2048);
});
