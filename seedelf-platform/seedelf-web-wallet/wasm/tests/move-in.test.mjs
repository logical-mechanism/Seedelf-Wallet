// buildMoveIn through WebAssembly, on the 12-word phrase's real preprod
// UTxOs (recorded in the extension's test fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CardanoAccount, Network, SeedelfKey, buildAccountSend, buildMoveIn, checkPayableAddress } from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const phrase = json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
).phrase;
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const koios = json("../../extension/tests/fixtures/koios-preprod.json");

function pathedUtxos(account) {
  const paths = new Map();
  for (let i = 0; i < 20; i++) {
    paths.set(account.receiveAddress(Network.Preprod, i), [0, i]);
    paths.set(account.changeAddress(Network.Preprod, i), [1, i]);
  }
  const rows = koios.accounts[account.stakeAddress(Network.Preprod)].account_utxos;
  return rows.filter((u) => paths.has(u.address)).map((utxo) => ({ utxo, role: paths.get(utxo.address)[0], index: paths.get(utxo.address)[1] }));
}

test("builds and signs a move-in inside WebAssembly", () => {
  const account = CardanoAccount.fromPhrase(phrase, 0);
  const key = SeedelfKey.fromPhrase(phrase, 0);
  const utxos = pathedUtxos(account);
  const result = JSON.parse(
    buildMoveIn(account, key, JSON.stringify({ network: "preprod", params, utxos, lovelace: "10000000", tokens: [] })),
  );
  assert.equal(result.lovelace, "10000000");
  assert.match(result.txHash, /^[0-9a-f]{64}$/);
  assert.match(result.txCbor, /^84/); // a CBOR array of 4: body, witnesses, valid, aux
  assert.ok(Number(result.fee) > 150_000 && Number(result.fee) < 400_000, result.fee);
  assert.equal(result.depositOutputs, 1);
  assert.equal(result.tokens.length, 0);

  // Part of a token: 1 of the account's 3,000,000,000 tUSDM.
  const tusdm = { policyId: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9", assetName: "0014df10745553444d" };
  const some = JSON.parse(
    buildMoveIn(account, key, JSON.stringify({ network: "preprod", params, utxos, lovelace: "10000000", tokens: [{ ...tusdm, quantity: "1" }] })),
  );
  assert.deepEqual(some.tokens, [{ ...tusdm, quantity: "1" }]);

  // Only the token: the least ADA the deposit needs.
  const least = JSON.parse(
    buildMoveIn(account, key, JSON.stringify({ network: "preprod", params, utxos, lovelace: "0", tokens: [{ ...tusdm, quantity: "1" }] })),
  );
  assert.equal(least.lovelace, least.minimum);
  assert.ok(Number(least.minimum) > 1_000_000 && Number(least.minimum) < 2_000_000, least.minimum);

  const max = JSON.parse(buildMoveIn(account, key, JSON.stringify({ network: "preprod", params, utxos, lovelace: null, tokens: [] })));
  assert.equal(max.inputs, utxos.length);
  assert.equal(max.minimum, null);
  account.free();
  key.free();
});

test("sends from the Cardano account to an address inside WebAssembly", () => {
  const account = CardanoAccount.fromPhrase(phrase, 0);
  const utxos = pathedUtxos(account);
  const to = json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
    (v) => v.account === 0 && v.phrase.split(" ").length === 15,
  ).preprod.receive_0;
  const tusdm = { policyId: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9", assetName: "0014df10745553444d" };
  const sent = JSON.parse(
    buildAccountSend(
      account,
      JSON.stringify({ network: "preprod", params, utxos, payments: [{ to, lovelace: "0", tokens: [{ ...tusdm, quantity: "5" }] }] }),
    ),
  );
  const [paid] = sent.payments;
  assert.equal(paid.to, to);
  assert.equal(sent.max, false);
  assert.equal(paid.lovelace, paid.minimum);
  assert.deepEqual(paid.tokens, [{ ...tusdm, quantity: "5" }]);
  assert.match(sent.txHash, /^[0-9a-f]{64}$/);
  assert.match(sent.txCbor, /^84/);

  assert.throws(() => buildAccountSend(account, "{}"), /bad send request/);
  assert.throws(
    () =>
      buildAccountSend(account, JSON.stringify({ network: "preprod", params, utxos, payments: [{ to: "nope", lovelace: "0", tokens: [] }] })),
    /isn't a Cardano address/,
  );
  assert.throws(() => checkPayableAddress(account.stakeAddress(Network.Preprod), Network.Preprod), /normal preprod address/);
  account.free();
});

test("explains a bad request", () => {
  const account = CardanoAccount.fromPhrase(phrase, 0);
  const key = SeedelfKey.fromPhrase(phrase, 0);
  const utxos = pathedUtxos(account);
  assert.throws(() => buildMoveIn(account, key, "{}"), /bad move-in request/);
  assert.throws(
    () => buildMoveIn(account, key, JSON.stringify({ network: "preprod", params, utxos, lovelace: "999999999999999", tokens: [] })),
    /Not enough ADA/,
  );
  assert.throws(
    () => buildMoveIn(account, key, JSON.stringify({ network: "mainnet", params, utxos, lovelace: "5000000", tokens: [] })),
    /not under the account's payment key/,
  );
  account.free();
  key.free();
});
