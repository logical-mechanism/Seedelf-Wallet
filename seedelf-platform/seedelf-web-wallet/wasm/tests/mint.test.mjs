// Creating a seedelf through WebAssembly: draftMint → (Ogmios) → finishMint
// → (giveme.my) → signScriptSpend, on the 12-word phrase's synthetic owned
// UTxOs and the real preprod evaluation recorded by the extension's
// tests/fixtures/record-mint.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SeedelfKey, draftMint, finishMint, signScriptSpend } from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const phrase = json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
).phrase;
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const recorded = json("../../extension/tests/fixtures/mint-preprod.json");
const utxos = json("../../extension/tests/fixtures/owned-utxos.json").owned_utxos.slice(0, 2);

test("drafts, finishes and prepares a mint for signing", () => {
  const key = SeedelfKey.fromPhrase(phrase, 0);
  const request = { network: "preprod", params, utxos, label: "web-wallet" };
  const draft = JSON.parse(draftMint(key, JSON.stringify(request)));
  assert.match(draft.seed, /^[0-9a-f]{64}$/);
  assert.match(draft.draftCbor, /^84/);
  assert.deepEqual(draft.inputs, [{ txHash: "a1".repeat(32), txIndex: 0 }]);

  const final = JSON.parse(
    finishMint(key, JSON.stringify({ ...request, seed: draft.seed, evaluation: recorded.evaluation })),
  );
  assert.equal(final.seed, draft.seed);
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
  assert.throws(() => draftMint(key, "{}"), /bad mint request/);
  assert.throws(() => draftMint(key, JSON.stringify({ network: "preprod", params, utxos, label: "sixteen chars!!!" })), /at most 15/);
  assert.throws(() => draftMint(key, JSON.stringify({ network: "preprod", params, utxos: [], label: "" })), /Not enough ADA/);
  assert.throws(() => finishMint(key, JSON.stringify({ network: "preprod", params, utxos, label: "" })), /seed/);
  assert.throws(() => signScriptSpend(key, "{}"), /bad signing request/);
  key.free();
});
