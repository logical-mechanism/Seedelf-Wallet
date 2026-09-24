// Paying a seedelf through WebAssembly: draftTransfer → (Ogmios) →
// finishTransfer → (giveme.my) → signScriptSpend, on the 12-word phrase's
// synthetic owned UTxOs, a live preprod seedelf, and the real preprod
// evaluation recorded by the extension's tests/fixtures/record-transfer.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SeedelfKey, draftTransfer, finishTransfer, signScriptSpend } from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const phrase = json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
).phrase;
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const recorded = json("../../extension/tests/fixtures/transfer-preprod.json");
const owned = json("../../extension/tests/fixtures/owned-utxos.json").owned_utxos;
const request = {
  network: "preprod",
  params,
  utxos: owned.slice(0, 2),
  to: recorded.to,
  recipient: recorded.recipient,
  lovelace: recorded.lovelace,
  tokens: recorded.tokens,
};

test("drafts, finishes and prepares a transfer for signing", () => {
  const key = SeedelfKey.fromPhrase(phrase, 0);
  const draft = JSON.parse(draftTransfer(key, JSON.stringify(request)));
  assert.match(draft.seed, /^[0-9a-f]{64}$/);
  assert.match(draft.draftCbor, /^84/);
  assert.deepEqual(draft.inputs, recorded.draft.inputs);

  const final = JSON.parse(
    finishTransfer(key, JSON.stringify({ ...request, seed: draft.seed, evaluation: recorded.evaluation })),
  );
  assert.equal(final.seed, draft.seed);
  assert.equal(final.to, recorded.to);
  assert.equal(final.toSelf, false);
  assert.equal(final.lovelace, "5000000");
  assert.deepEqual(final.tokens, recorded.tokens);
  assert.equal(final.fee.total, recorded.final.fee.total);
  assert.equal(final.changeOutputs, 1);
  assert.equal(final.changeTokens, 1);

  // Signing checks giveme.my's signature first; a refusal says why.
  assert.throws(
    () => signScriptSpend(key, JSON.stringify({ txCbor: final.txCbor, seed: final.seed, collateral: recorded.collateral.answer })),
    /Transaction Fails Validation/,
  );
  key.free();
});

test("flags paying your own seedelf, and explains a bad transfer", () => {
  const key = SeedelfKey.fromPhrase(phrase, 0);
  const mine = owned[2];
  const own = { ...request, to: mine.asset_list[0].asset_name, recipient: mine, tokens: [] };
  const final = JSON.parse(finishTransfer(key, JSON.stringify({ ...own, seed: "42".repeat(32), evaluation: recorded.evaluation })));
  assert.equal(final.toSelf, true);

  // Too little ADA goes up to the least the payment needs.
  const short = JSON.parse(
    finishTransfer(key, JSON.stringify({ ...request, lovelace: "0", seed: "42".repeat(32), evaluation: recorded.evaluation })),
  );
  assert.equal(short.lovelace, short.minimum);
  assert.ok(Number(short.minimum) > 1_000_000 && Number(short.minimum) < 2_000_000, short.minimum);

  assert.throws(() => draftTransfer(key, "{}"), /bad transfer request/);
  assert.throws(() => draftTransfer(key, JSON.stringify({ ...request, to: "5eed0e1f" })), /64 hex characters/);
  assert.throws(() => draftTransfer(key, JSON.stringify({ ...request, utxos: owned })), /holds a seedelf/);
  assert.throws(() => finishTransfer(key, JSON.stringify(request)), /seed/);
  key.free();
});
