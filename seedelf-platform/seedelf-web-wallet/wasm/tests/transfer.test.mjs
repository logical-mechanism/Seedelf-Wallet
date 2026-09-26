// Paying a seedelf through WebAssembly: buildTransfer (measured in the
// wallet) → (giveme.my) → signScriptSpend, on the 12-word phrase's synthetic
// owned UTxOs, a live preprod seedelf, and the fee of the real preprod
// transfer recorded by the extension's tests/fixtures/record-transfer.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SeedelfKey, buildTransfer, signScriptSpend } from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const phrase = json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
).phrase;
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const recorded = json("../../extension/tests/fixtures/transfer-preprod.json");
const owned = json("../../extension/tests/fixtures/owned-utxos.json").owned_utxos;
const payment = { to: recorded.to, recipient: recorded.recipient, lovelace: recorded.lovelace, tokens: recorded.tokens };
const request = { network: "preprod", params, utxos: owned.slice(0, 2), payments: [payment] };
/** The request, paying one Seedelf with `changes` made. */
const paying = (changes) => ({ ...request, payments: [{ ...payment, ...changes }] });

test("builds a transfer, measured in the wallet, and prepares it for signing", () => {
  const key = SeedelfKey.fromPhrase(phrase, 0);
  const final = JSON.parse(buildTransfer(key, JSON.stringify(request)));
  assert.match(final.seed, /^[0-9a-f]{64}$/);
  assert.deepEqual(final.inputs, recorded.draft.inputs);
  assert.equal(final.payments.length, 1);
  const [paid] = final.payments;
  assert.equal(paid.to, recorded.to);
  assert.equal(paid.toSelf, false);
  assert.equal(paid.lovelace, "5000000");
  assert.deepEqual(paid.tokens, recorded.tokens);
  // The wallet's own evaluator prices it as the chain did.
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
  const own = paying({ to: mine.asset_list[0].asset_name, recipient: mine, tokens: [] });
  const final = JSON.parse(buildTransfer(key, JSON.stringify(own)));
  assert.equal(final.payments[0].toSelf, true);

  // Too little ADA goes up to the least the payment needs.
  const short = JSON.parse(buildTransfer(key, JSON.stringify(paying({ lovelace: "0" })))).payments[0];
  assert.equal(short.lovelace, short.minimum);
  assert.ok(Number(short.minimum) > 1_000_000 && Number(short.minimum) < 2_000_000, short.minimum);

  assert.throws(() => buildTransfer(key, "{}"), /bad transfer request/);
  assert.throws(() => buildTransfer(key, JSON.stringify(paying({ to: "5eed0e1f" }))), /64 hex characters/);
  assert.throws(() => buildTransfer(key, JSON.stringify({ ...request, utxos: owned })), /holds a Seedelf/);
  key.free();
});
