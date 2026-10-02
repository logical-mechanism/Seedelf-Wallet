// The transaction view's export through WebAssembly: `decodeTx(network, cbor)`
// hands JavaScript the whole transaction as JSON, and throws in words for bytes
// it can't read. The reading itself is checked against cardano-cli in
// decode_test.rs; this checks the binding, the JSON it answers with, and that
// the same bytes read the same on either network but for one thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Network, decodeTx } from "./wasm.mjs";

const recorded = JSON.parse(readFileSync(new URL("./fixtures/decode-txs.json", import.meta.url)));
const cborOf = (name) => recorded.txs.find((tx) => tx.name === name).cbor;
const read = (name, network = Network.Preprod) => JSON.parse(decodeTx(network, cborOf(name)));

test("answers the whole transaction as JSON, in camelCase for the extension", () => {
  const transfer = recorded.txs.find((tx) => tx.name === "transfer");
  const detail = JSON.parse(decodeTx(Network.Preprod, transfer.cbor));
  assert.equal(detail.txHash, transfer.txId);
  assert.equal(detail.size, transfer.cbor.length / 2);
  assert.equal(detail.inputs.length, 2);
  assert.equal(detail.inputs[0].index, "0", "an index is a decimal string, not a number");
  assert.equal(detail.outputs.length, 2);
  assert.equal(detail.redeemers.length, 2);
  // A budget is `0 .. 2^63-1` in the CDDL, so a string too.
  assert.match(detail.redeemers[0].mem, /^\d+$/);
  assert.match(detail.redeemers[0].steps, /^\d+$/);
  // A datum and a redeemer's argument come as the trees they are, for any
  // contract: here a register, and a Schnorr proof's three byte strings.
  assert.equal(detail.outputs[0].datum.type, "constr");
  // Not `.constructor`: every JavaScript object has one of those already, which
  // is why the field is named this way (see rpc.ts's TxPlutus).
  assert.equal(detail.outputs[0].datum.constructorIndex, "0");
  assert.deepEqual(
    detail.outputs[0].datum.fields.map((f) => f.type),
    ["bytes", "bytes"],
  );
  assert.equal(detail.redeemers[0].argument.fields.length, 3);
  assert.equal(detail.referenceInputs.length, 1);
  assert.equal(detail.collateral.length, 1);
  assert.ok(detail.collateralReturn.lovelace > "0");
  assert.equal(detail.valid, true);
  assert.equal(detail.witnessed, true);
  assert.deepEqual(detail.unknown, []);
  // Each output's address is read from its own bytes, and both go to the contract.
  for (const out of detail.outputs) {
    assert.match(out.address.bech32, /^addr_test1/);
    assert.equal(out.address.seedelf, true);
    assert.equal(out.register.payable, true);
    assert.equal(out.register.generator.length, 96);
  }
  // Hex and whitespace are both taken, as a site's CBOR arrives.
  assert.deepEqual(JSON.parse(decodeTx(Network.Preprod, `  ${transfer.cbor}\n`)), detail);
});

test("the network only names Seedelf Wallet's own contract", () => {
  const preprod = read("transfer");
  const mainnet = read("transfer", Network.Mainnet);
  assert.ok(preprod.outputs.every((o) => o.address.seedelf));
  assert.ok(mainnet.outputs.every((o) => !o.address.seedelf));
  // Everything else is the same: an address says which network it is for.
  assert.deepEqual(
    mainnet.outputs.map((o) => o.address.bech32),
    preprod.outputs.map((o) => o.address.bech32),
  );
  assert.equal(mainnet.txHash, preprod.txHash);
});

test("reads a certificate transaction's certificates, note and metadata", () => {
  const detail = read("certificates");
  assert.deepEqual(
    detail.certificates.map((c) => c.kind),
    ["registration", "stakeDelegation", "voteDelegation"],
  );
  assert.equal(detail.certificates[1].pool, "pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy");
  assert.deepEqual(detail.note, ["Seedelf Wallet", "a note anyone can read"]);
  assert.deepEqual(
    detail.metadata.map((m) => m.label).sort(),
    ["1", "674"],
  );
  // Every number the bytes decide is a decimal string: the CDDL lets a slot go
  // past what JSON.parse holds exactly (see rpc.ts's TxDetail).
  assert.equal(detail.validFrom, "100");
  assert.equal(detail.validUntil, "99999999");
  assert.equal(detail.withdrawals.length, 1);
});

test("throws in words for bytes it can't read, rather than answering nothing", () => {
  for (const [what, bytes] of [
    ["not hex", "not hex at all"],
    ["cut short", cborOf("payment").slice(0, 40)],
    ["nothing", ""],
  ]) {
    assert.throws(() => decodeTx(Network.Preprod, bytes), /./, what);
  }
  assert.throws(
    () => decodeTx(Network.Preprod, "00".repeat(200 * 1024)),
    /far larger than Cardano allows/,
  );
});
