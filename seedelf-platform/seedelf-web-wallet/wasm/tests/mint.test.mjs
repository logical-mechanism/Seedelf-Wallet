// Creating a seedelf through WebAssembly: buildMint (measured in the wallet)
// → (giveme.my) → signScriptSpend, on the 12-word phrase's synthetic owned
// UTxOs; and the account-paid mint, draftAccountMint → (Ogmios) →
// finishAccountMint, with a recorded Ogmios evaluation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CardanoAccount,
  Network,
  SeedelfKey,
  buildMint,
  draftAccountMint,
  finishAccountMint,
  signScriptSpend,
} from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const phrase = json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
).phrase;
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const recorded = json("../../extension/tests/fixtures/mint-preprod.json");
const utxos = json("../../extension/tests/fixtures/owned-utxos.json").owned_utxos.slice(0, 2);

test("builds a mint, measured in the wallet, and prepares it for signing", () => {
  const key = SeedelfKey.fromPhrase(phrase, 0);
  const request = { network: "preprod", params, utxos, label: "web-wallet" };
  const final = JSON.parse(buildMint(key, JSON.stringify(request)));
  assert.match(final.seed, /^[0-9a-f]{64}$/);
  assert.deepEqual(final.inputs, [{ txHash: "a1".repeat(32), txIndex: 0 }]);
  assert.match(final.txHash, /^[0-9a-f]{64}$/);
  assert.equal(final.tokenName, `5eed0e1f${Buffer.from("web-wallet").toString("hex")}00${"a1".repeat(32)}`.slice(0, 64));
  assert.ok(Number(final.fee.total) > 200_000 && Number(final.fee.total) < 400_000, final.fee.total);
  assert.equal(Number(final.fee.total) % 2, 0);
  assert.equal(final.changeOutputs, 1);
  assert.equal(final.changeTokens, 0);

  // Signing checks giveme.my's signature first; a refusal says why.
  assert.throws(
    () => signScriptSpend(key, JSON.stringify({ txCbor: final.txCbor, seed: final.seed, collateral: recorded.collateral.answer })),
    /Transaction Fails Validation/,
  );
  assert.throws(
    () =>
      signScriptSpend(key, JSON.stringify({ txCbor: final.txCbor, seed: final.seed, collateral: { witness: "ab".repeat(100) } })),
    /doesn't match this transaction/,
  );
  key.free();
});

test("explains a bad mint", () => {
  const key = SeedelfKey.fromPhrase(phrase, 0);
  assert.throws(() => buildMint(key, "{}"), /bad mint request/);
  assert.throws(() => buildMint(key, JSON.stringify({ network: "preprod", params, utxos, label: "sixteen chars!!!" })), /at most 15/);
  assert.throws(() => buildMint(key, JSON.stringify({ network: "preprod", params, utxos: [], label: "" })), /Not enough ADA/);
  assert.throws(() => signScriptSpend(key, "{}"), /bad signing request/);
  key.free();
});

test("mints a seedelf paid by the Cardano account, signed inside WebAssembly", () => {
  const account = CardanoAccount.fromPhrase(phrase, 0);
  const key = SeedelfKey.fromPhrase(phrase, 0);
  const paths = new Map();
  for (let i = 0; i < 20; i++) {
    paths.set(account.receiveAddress(Network.Preprod, i), [0, i]);
    paths.set(account.changeAddress(Network.Preprod, i), [1, i]);
  }
  const koios = json("../../extension/tests/fixtures/koios-preprod.json");
  const accountUtxos = koios.accounts[account.stakeAddress(Network.Preprod)].account_utxos
    .filter((u) => paths.has(u.address))
    .map((utxo) => ({ utxo, role: paths.get(utxo.address)[0], index: paths.get(utxo.address)[1] }));
  const request = { network: "preprod", params, utxos: accountUtxos, label: "first" };

  const draft = JSON.parse(draftAccountMint(account, key, JSON.stringify(request)));
  assert.match(draft.draftCbor, /^84/);
  assert.ok(draft.inputs.length >= 1);
  const evaluation = json("../../../seedelf-core/tests/fixtures/ogmios/account_mint.json");
  const final = JSON.parse(finishAccountMint(account, key, JSON.stringify({ ...request, evaluation })));
  assert.deepEqual(final.inputs, draft.inputs);
  assert.deepEqual(final.collateral, draft.collateral);
  assert.match(final.txHash, /^[0-9a-f]{64}$/);
  assert.ok(final.tokenName.startsWith(`5eed0e1f${Buffer.from("first").toString("hex")}`));
  assert.equal(final.lovelace, "1749860");
  assert.ok(Number(final.fee.total) > 200_000 && Number(final.fee.total) < 300_000, final.fee.total);
  assert.throws(() => draftAccountMint(account, key, "{}"), /bad mint request/);
  account.free();
  key.free();
});
