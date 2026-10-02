#!/usr/bin/env node
// Records decode-txs.json: the transactions the transaction view's tests read,
// each with what `cardano-cli debug transaction view` makes of it.
//
// The point of the cardano-cli pass is that the expected values aren't our own
// decoder's output frozen: a tool that shares no code with this wallet says
// what is in the bytes, and `wasm/tests/decode_test.rs` checks our reading
// against it, field by field.
//
// Two kinds of transaction go in:
//
//   - real ones, taken from the fixtures already checked in: the wallet's own
//     Seedelf transfer, stealth mint and remove, recorded on preprod, and
//     Minswap's aggregator's swap and a session's swap, which the wallet did
//     not build. Nothing is invented for these.
//   - ones cardano-cli builds here (`transaction build-raw`, no node needed),
//     for what no recording covers: a plain payment with a reference input,
//     collateral and a reference script, certificates with a withdrawal and
//     metadata, a mint and a burn under a native script, and a governance
//     proposal with a vote.
//
// Needs `cardano-cli` on PATH (any node-less build; 11.0.0.0 recorded this).
// Run from this folder:  node record-decode.mjs
//
// The keys it generates are fresh each run, so the built transactions' bytes
// change: that's fine, the views are recorded with them. The recorded fixture
// is what the tests read; this script is how to make another.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = import.meta.dirname;
const out = join(here, "decode-txs.json");
const work = mkdtempSync(join(tmpdir(), "seedelf-decode-"));
const cli = (...args) => execFileSync("cardano-cli", args, { encoding: "utf8" }).trim();
const at = (name) => join(work, name);
const PREPROD = ["--testnet-magic", "1"];

/** The hex at `path` (dot-separated) in a checked-in fixture, named from seedelf-web-wallet. */
function fixture(file, path) {
  const doc = JSON.parse(readFileSync(join(here, "..", "..", "..", file), "utf8"));
  return path.split(".").reduce((o, k) => o[k], doc);
}

/** What cardano-cli makes of a transaction's bytes, and the id it gives it. */
function read(cborHex) {
  const file = at("view.tx");
  writeFileSync(file, JSON.stringify({ type: "Tx ConwayEra", description: "", cborHex }));
  return {
    txId: JSON.parse(cli("conway", "transaction", "txid", "--tx-file", file, "--output-json")).txhash,
    view: JSON.parse(cli("debug", "transaction", "view", "--tx-file", file, "--output-json")),
  };
}

/** A transaction cardano-cli builds here, as hex. */
function build(...args) {
  cli("conway", "transaction", "build-raw", ...args, "--out-file", at("built.body"));
  return JSON.parse(readFileSync(at("built.body"), "utf8")).cborHex;
}

try {
  cli("conway", "address", "key-gen", "--verification-key-file", at("pay.vkey"), "--signing-key-file", at("pay.skey"));
  cli("conway", "stake-address", "key-gen", "--verification-key-file", at("stake.vkey"), "--signing-key-file", at("stake.skey"));
  cli("conway", "governance", "drep", "key-gen", "--verification-key-file", at("drep.vkey"), "--signing-key-file", at("drep.skey"));

  const base = cli("conway", "address", "build", "--payment-verification-key-file", at("pay.vkey"), "--stake-verification-key-file", at("stake.vkey"), ...PREPROD);
  const enterprise = cli("conway", "address", "build", "--payment-verification-key-file", at("pay.vkey"), ...PREPROD);
  const reward = cli("conway", "stake-address", "build", "--stake-verification-key-file", at("stake.vkey"), ...PREPROD);
  const keyHash = cli("conway", "address", "key-hash", "--payment-verification-key-file", at("pay.vkey"));

  // A native script policy: a signature and a deadline, so the view names both.
  writeFileSync(
    at("policy.json"),
    JSON.stringify({ type: "all", scripts: [{ type: "sig", keyHash }, { type: "before", slot: 99_999_999 }] }),
  );
  const policy = cli("conway", "transaction", "policyid", "--script-file", at("policy.json"));

  // A payment with everything a plain transaction can carry: a reference input
  // it only reads, collateral and what comes back from it, a token whose name
  // isn't text, an output naming a datum by its hash, and one carrying a script.
  const payment = build(
    "--tx-in", "5555555555555555555555555555555555555555555555555555555555555555#0",
    "--read-only-tx-in-reference", "6666666666666666666666666666666666666666666666666666666666666666#2",
    "--tx-in-collateral", "7777777777777777777777777777777777777777777777777777777777777777#3",
    "--tx-out", `${base}+3000000+7 ${policy}.00ff10`,
    "--tx-out", `${enterprise}+1200000`,
    "--tx-out-datum-hash", "1111111111111111111111111111111111111111111111111111111111111111",
    "--tx-out", `${base}+9000000`,
    "--tx-out-reference-script-file", at("policy.json"),
    "--tx-out-return-collateral", `${enterprise}+4500000`,
    "--tx-total-collateral", "5000000",
    "--required-signer-hash", keyHash,
    "--fee", "210000",
  );

  // Certificates, a withdrawal, a validity range, and metadata: CIP-20's note
  // beside a label holding each kind of metadatum (a number, bytes, a list, a map).
  for (const [file, ...args] of [
    ["reg.cert", "registration-certificate", "--key-reg-deposit-amt", "2000000"],
    ["deleg.cert", "stake-delegation-certificate", "--stake-pool-id", "pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy"],
    ["vote.cert", "vote-delegation-certificate", "--always-abstain"],
  ]) {
    cli("conway", "stake-address", args[0], "--stake-verification-key-file", at("stake.vkey"), ...args.slice(1), "--out-file", at(file));
  }
  writeFileSync(
    at("meta.json"),
    JSON.stringify({
      674: { msg: ["Seedelf Wallet", "a note anyone can read"] },
      1: { n: 42, b: "0xdeadbeef", list: [1, 2, 3], map: { k: "v" } },
    }),
  );
  const certificates = build(
    "--tx-in", "1111111111111111111111111111111111111111111111111111111111111111#0",
    "--tx-out", `${base}+5000000`,
    "--fee", "200000",
    "--invalid-before", "100",
    "--invalid-hereafter", "99999999",
    "--certificate-file", at("reg.cert"),
    "--certificate-file", at("deleg.cert"),
    "--certificate-file", at("vote.cert"),
    "--withdrawal", `${reward}+0`,
    "--metadata-json-file", at("meta.json"),
  );

  // A mint and a burn under one native script, which goes in the witness set.
  const mint = build(
    "--tx-in", "2222222222222222222222222222222222222222222222222222222222222222#1",
    "--tx-out", `${base}+2000000+5 ${policy}.53656564656c66`,
    "--mint", `5 ${policy}.53656564656c66 + -3 ${policy}.6f6c64`,
    "--mint-script-file", at("policy.json"),
    "--fee", "180000",
  );

  // Governance: a proposal, a vote on another action, and the treasury fields.
  cli(
    "conway", "governance", "action", "create-info", "--testnet",
    "--governance-action-deposit", "100000000000",
    "--deposit-return-stake-verification-key-file", at("stake.vkey"),
    "--anchor-url", "https://example.com/info",
    "--anchor-data-hash", "0".repeat(64),
    "--out-file", at("info.action"),
  );
  cli(
    "conway", "governance", "vote", "create", "--yes",
    "--governance-action-tx-id", "3333333333333333333333333333333333333333333333333333333333333333",
    "--governance-action-index", "0",
    "--drep-verification-key-file", at("drep.vkey"),
    "--out-file", at("vote.gov"),
  );
  const governance = build(
    "--tx-in", "4444444444444444444444444444444444444444444444444444444444444444#0",
    "--tx-out", `${base}+1500000`,
    "--fee", "250000",
    "--proposal-file", at("info.action"),
    "--vote-file", at("vote.gov"),
    "--treasury-donation", "1000000",
    "--current-treasury-value", "500000000",
  );

  const txs = [
    {
      name: "transfer",
      what: "the wallet's own Seedelf transfer on preprod: a script spend with redeemers, collateral and register datums",
      from: "extension/tests/fixtures/transfer-preprod.json final.txCbor",
      cbor: fixture("extension/tests/fixtures/transfer-preprod.json", "final.txCbor"),
    },
    {
      name: "stealth-mint",
      what: "the wallet's own stealth mint on preprod: a script spend that also mints a seedelf",
      from: "extension/tests/fixtures/mint-preprod.json final.txCbor",
      cbor: fixture("extension/tests/fixtures/mint-preprod.json", "final.txCbor"),
    },
    {
      name: "remove",
      what: "the wallet's own remove on preprod: a script spend that burns a seedelf",
      from: "extension/tests/fixtures/withdraw-preprod.json remove.final.txCbor",
      cbor: fixture("extension/tests/fixtures/withdraw-preprod.json", "remove.final.txCbor"),
    },
    {
      name: "minswap-swap",
      what: "Minswap's aggregator's real preprod swap, which this wallet did not build",
      from: "wasm/tests/fixtures/minswap-swap-preprod.json cbor",
      cbor: fixture("wasm/tests/fixtures/minswap-swap-preprod.json", "cbor"),
    },
    {
      name: "session-swap",
      what: "a private session's swap, as the extension's fixture recorded it",
      from: "extension/tests/fixtures/session-swap.json swapCbor",
      cbor: fixture("extension/tests/fixtures/session-swap.json", "swapCbor"),
    },
    { name: "payment", what: "built here: a plain payment with a reference input, collateral, a datum hash and a reference script", from: "cardano-cli transaction build-raw", cbor: payment },
    { name: "certificates", what: "built here: stake and vote certificates, a withdrawal, a validity range and metadata", from: "cardano-cli transaction build-raw", cbor: certificates },
    { name: "mint", what: "built here: a mint and a burn under a native script", from: "cardano-cli transaction build-raw", cbor: mint },
    { name: "governance", what: "built here: a proposal, a vote, and the treasury fields", from: "cardano-cli transaction build-raw", cbor: governance },
  ];

  writeFileSync(
    out,
    `${JSON.stringify(
      {
        recorded: new Date().toISOString(),
        recorder: "wasm/tests/fixtures/record-decode.mjs",
        tool: cli("--version").split("\n")[0],
        network: "preprod",
        txs: txs.map((tx) => ({ ...tx, ...read(tx.cbor) })),
      },
      null,
      1,
    )}\n`,
  );
  console.log(`wrote ${out}: ${txs.length} transactions`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
