// Withdrawing through WebAssembly: an amount or everything to an address, and
// removing a seedelf, measured in the wallet, on the 12-word phrase's
// synthetic owned UTxOs and the requests and fees recorded on preprod by the
// extension's tests/fixtures/record-withdraw.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CardanoAccount,
  SeedelfKey,
  buildRemove,
  buildWithdraw,
  signScriptSpend,
} from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const vectors = json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors;
const vector = (words) => vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === words);
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const recorded = json("../../extension/tests/fixtures/withdraw-preprod.json");
const owned = json("../../extension/tests/fixtures/owned-utxos.json").owned_utxos;
const to = vector(15).preprod.receive_0;

/** A recorded request, which paid one address, with `changes` to its payment. */
function withdrawal(which, changes = {}) {
  const { to, lovelace, tokens, ...rest } = recorded[which].request;
  return { ...rest, params, payments: [{ to, lovelace, tokens, ...changes }] };
}

test("withdraws an amount, or everything, to an address", () => {
  const key = SeedelfKey.fromPhrase(vector(12).phrase, 0);
  const amount = withdrawal("amount");
  const final = JSON.parse(buildWithdraw(key, JSON.stringify(amount)));
  assert.deepEqual(final.inputs, recorded.amount.draft.inputs);
  assert.equal(final.payments[0].to, to);
  assert.equal(final.max, false);
  assert.equal(final.payments[0].lovelace, "5000000");
  // Measured on the finished transaction, within a hair of Ogmios's measure of a draft.
  const fee = Number(final.fee.total);
  assert.ok(Math.abs(fee - Number(recorded.amount.final.fee.total)) < fee / 100, final.fee.total);
  assert.throws(
    () => signScriptSpend(key, JSON.stringify({ txCbor: final.txCbor, seed: final.seed, collateral: recorded.collateral.answer })),
    /Transaction Fails Validation/,
  );

  const max = withdrawal("max");
  const all = JSON.parse(buildWithdraw(key, JSON.stringify(max)));
  assert.equal(all.max, true);
  assert.equal(all.payments[0].lovelace, String(28_000_000 - Number(all.fee.total)));
  assert.equal(all.changeOutputs, 0);
  assert.equal(all.left, 0);
  key.free();
});

test("removes a seedelf, and refuses what it must", () => {
  const key = SeedelfKey.fromPhrase(vector(12).phrase, 0);
  const request = { network: "preprod", params, utxo: owned[2], to };
  const final = JSON.parse(buildRemove(key, JSON.stringify(request)));
  assert.match(final.txCbor, /^84/);
  assert.ok(final.name.startsWith(`5eed0e1f${Buffer.from("web-wallet").toString("hex")}`));
  assert.equal(final.lovelace, String(1_500_000 - Number(final.fee.total)));

  assert.throws(() => buildWithdraw(key, "{}"), /bad withdrawal request/);
  assert.throws(() => buildWithdraw(key, JSON.stringify(withdrawal("amount", { to: "nope" }))), /isn't a Cardano address/);
  assert.throws(() => buildRemove(key, JSON.stringify({ ...request, utxo: owned[0] })), /exactly one Seedelf/);
  assert.throws(() => buildRemove(key, "{}"), /bad removal request/);
  key.free();
});

test("knows the account's own addresses", () => {
  const account = CardanoAccount.fromPhrase(vector(12).phrase, 0);
  assert.equal(account.isOwnAddress(vector(12).preprod.receive_0), true);
  assert.equal(account.isOwnAddress(to), false);
  assert.equal(account.isOwnAddress("nope"), false);
  account.free();
});
