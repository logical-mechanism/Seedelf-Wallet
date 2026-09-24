// Withdrawing through WebAssembly: an amount or everything to an address, and
// removing a seedelf, on the 12-word phrase's synthetic owned UTxOs with the
// real preprod evaluations recorded by the extension's
// tests/fixtures/record-withdraw.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CardanoAccount,
  SeedelfKey,
  draftRemove,
  draftWithdraw,
  finishRemove,
  finishWithdraw,
  signScriptSpend,
} from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const vectors = json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors;
const vector = (words) => vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === words);
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const recorded = json("../../extension/tests/fixtures/withdraw-preprod.json");
const owned = json("../../extension/tests/fixtures/owned-utxos.json").owned_utxos;
const to = vector(15).preprod.receive_0;

test("withdraws an amount, or everything, to an address", () => {
  const key = SeedelfKey.fromPhrase(vector(12).phrase, 0);
  const amount = { ...recorded.amount.request, params };
  const draft = JSON.parse(draftWithdraw(key, JSON.stringify(amount)));
  assert.deepEqual(draft.inputs, recorded.amount.draft.inputs);
  const final = JSON.parse(
    finishWithdraw(key, JSON.stringify({ ...amount, seed: draft.seed, evaluation: recorded.amount.evaluation })),
  );
  assert.equal(final.to, to);
  assert.equal(final.max, false);
  assert.equal(final.lovelace, "5000000");
  assert.equal(final.fee.total, recorded.amount.final.fee.total);
  assert.throws(
    () => signScriptSpend(key, JSON.stringify({ txCbor: final.txCbor, seed: final.seed, collateral: recorded.collateral.answer })),
    /Transaction Fails Validation/,
  );

  const max = { ...recorded.max.request, params };
  const all = JSON.parse(finishWithdraw(key, JSON.stringify({ ...max, seed: "42".repeat(32), evaluation: recorded.max.evaluation })));
  assert.equal(all.max, true);
  assert.equal(all.lovelace, String(28_000_000 - Number(all.fee.total)));
  assert.equal(all.changeOutputs, 0);
  assert.equal(all.left, 0);
  key.free();
});

test("removes a seedelf, and refuses what it must", () => {
  const key = SeedelfKey.fromPhrase(vector(12).phrase, 0);
  const request = { network: "preprod", params, utxo: owned[2], to };
  const draft = JSON.parse(draftRemove(key, JSON.stringify(request)));
  assert.match(draft.draftCbor, /^84/);
  const final = JSON.parse(finishRemove(key, JSON.stringify({ ...request, seed: draft.seed, evaluation: recorded.remove.evaluation })));
  assert.ok(final.name.startsWith(`5eed0e1f${Buffer.from("web-wallet").toString("hex")}`));
  assert.equal(final.lovelace, String(1_500_000 - Number(final.fee.total)));

  assert.throws(() => draftWithdraw(key, "{}"), /bad withdrawal request/);
  assert.throws(() => draftWithdraw(key, JSON.stringify({ ...recorded.amount.request, params, to: "nope" })), /isn't a Cardano address/);
  assert.throws(() => draftRemove(key, JSON.stringify({ ...request, utxo: owned[0] })), /exactly one seedelf/);
  assert.throws(() => draftRemove(key, "{}"), /bad removal request/);
  key.free();
});

test("knows the account's own addresses", () => {
  const account = CardanoAccount.fromPhrase(vector(12).phrase, 0);
  assert.equal(account.isOwnAddress(vector(12).preprod.receive_0), true);
  assert.equal(account.isOwnAddress(to), false);
  assert.equal(account.isOwnAddress("nope"), false);
  account.free();
});
