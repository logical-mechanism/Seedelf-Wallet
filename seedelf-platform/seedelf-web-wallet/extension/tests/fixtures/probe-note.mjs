// Checks a send with a note (CIP-20) against preprod without spending anything.
// Run from extension/ after `npm run build:wasm`:  node tests/fixtures/probe-note.mjs
//
// For the public 12-word test-vector phrase's account, from its live UTxOs:
// builds and signs a send to the 15-word phrase's address with a note, one
// with a note split over two lines (past 64 bytes), and one with the staking
// rewards riding along too, and has Koios's Ogmios evaluate each. Ogmios
// decodes a transaction with the node's own Conway decoder first (which
// holds metadata text to 64 bytes), so `[]` (no scripts to run) means it
// decoded. Nothing is submitted, and nothing is written. Five requests.
import { readFileSync } from "node:fs";

const wasmPkg = new URL("../../../wasm/pkg/", import.meta.url);
const wasm = await import(new URL("seedelf_wasm.js", wasmPkg));
wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", wasmPkg)) });

const KOIOS = "https://preprod.koios.rest/api/v1";

async function post(path, body) {
  const r = await fetch(`${KOIOS}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok && r.status !== 400) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
const evaluate = (cbor) => post("ogmios", { jsonrpc: "2.0", method: "evaluateTransaction", params: { transaction: { cbor } } });

const vectors = JSON.parse(
  readFileSync(new URL("../../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)),
).vectors;
const phrase = vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12).phrase;
const theirs = vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 15).preprod.receive_0;
const account = wasm.CardanoAccount.fromPhrase(phrase, 0);

const paths = new Map();
for (let i = 0; i < 20; i++) {
  paths.set(account.paymentKeyHash(0, i), [0, i]);
  paths.set(account.paymentKeyHash(1, i), [1, i]);
}
const utxos = (await post("credential_utxos", { _payment_credentials: [...paths.keys()], _extended: true })).map((utxo) => {
  const [role, index] = paths.get(utxo.payment_cred);
  return { utxo, role, index };
});
const [info] = await post("account_info", { _stake_addresses: [account.stakeAddress(wasm.Network.Preprod)] });
const [params] = await (await fetch(`${KOIOS}/epoch_params?limit=1`)).json();
console.log(`${utxos.length} UTxOs; rewards ${info?.rewards_available ?? 0}, vote ${info?.delegated_drep ?? "none"}`);

const payments = [{ to: theirs, lovelace: "3000000", tokens: [] }];
const cases = [
  ["a note", { note: "Invoice 42 · September" }],
  ["a note past 64 bytes, in two lines", { note: "ünïcödé wörds ünïcödé wörds ünïcödé wörds ünïcödé wörds ünï" }],
  ["a note and the rewards", { note: "with rewards", withdrawal: info?.delegated_drep ? info.rewards_available : undefined }],
];
for (const [name, extra] of cases) {
  const built = JSON.parse(wasm.buildAccountSend(account, JSON.stringify({ network: "preprod", params, utxos, payments, ...extra })));
  const answer = await evaluate(built.txCbor);
  console.log(`${name.padEnd(36)} fee ${built.fee}, note ${JSON.stringify(built.note)}:`, JSON.stringify(answer.result ?? answer.error));
}
account.free();
