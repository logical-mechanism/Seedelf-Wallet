// The Cardano account through WebAssembly, checked against the same
// compatibility vectors as seedelf-crypto (verified with @cardano-sdk, the
// library Lace uses).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CardanoAccount, Network } from "./wasm.mjs";

const { spec, vectors } = JSON.parse(
  readFileSync(
    new URL("../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url),
  ),
);

const NETWORKS = { preprod: Network.Preprod, mainnet: Network.Mainnet };

test("addresses match cardano-sdk through WebAssembly", () => {
  assert.equal(spec, "cardano-account-cip1852");
  assert.equal(vectors.length, 8);
  for (const v of vectors) {
    const account = CardanoAccount.fromPhrase(v.phrase, v.account);
    const label = `${v.phrase.split(" ")[0]} / ${v.account}`;
    assert.equal(account.accountPublicKey(), v.account_public_key, `account key: ${label}`);
    for (const [name, network] of Object.entries(NETWORKS)) {
      const want = v[name];
      assert.equal(account.receiveAddress(network, 0), want.receive_0, `${name} receive_0: ${label}`);
      assert.equal(account.receiveAddress(network, 1), want.receive_1, `${name} receive_1: ${label}`);
      assert.equal(account.changeAddress(network, 0), want.change_0, `${name} change_0: ${label}`);
      assert.equal(account.stakeAddress(network), want.stake, `${name} stake: ${label}`);
    }
    account.free();
  }
});

test("bad input throws", () => {
  const [v] = vectors;
  assert.throws(() => CardanoAccount.fromPhrase("abandon abandon", 0), /12, 15 or 24 words/);
  assert.throws(() => CardanoAccount.fromPhrase(v.phrase, 2 ** 31), /below 2\^31/);
  const account = CardanoAccount.fromPhrase(v.phrase, 0);
  assert.throws(() => account.receiveAddress(Network.Preprod, 2 ** 31), /below 2\^31/);
  account.free();
});
