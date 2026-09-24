// Checks the staking transactions against preprod without spending anything.
// Run from extension/ after `npm run build:wasm`:  node tests/fixtures/probe-staking.mjs
//
// For the public 12-word test-vector phrase's account, from its live UTxOs and
// account_info: builds and signs every kind of staking transaction, and has
// Koios's Ogmios evaluate each. Ogmios decodes a transaction with the node's
// own Conway decoder first, so `[]` (no scripts to run) means it decoded. Then
// an account-paid mint with the rewards riding along, whose seedelf policy
// really runs with the withdrawal in its context. Nothing is submitted, and
// nothing is written.
import { readFileSync } from "node:fs";

const wasmPkg = new URL("../../../wasm/pkg/", import.meta.url);
const wasm = await import(new URL("seedelf_wasm.js", wasmPkg));
wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", wasmPkg)) });

const KOIOS = "https://preprod.koios.rest/api/v1";
const LOGIC = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";
const TPREP = "pool1sh4cddrln788xmnjnsqhdwj9e7th3c3ck3zjk7ny9znwj44t8he";
const LOGIC_DREP = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";

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

const phrase = JSON.parse(
  readFileSync(new URL("../../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)),
).vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12).phrase;
const account = wasm.CardanoAccount.fromPhrase(phrase, 0);
const key = wasm.SeedelfKey.fromPhrase(phrase, 0);

// The account's UTxOs by payment key, each with its path, as the worker reads them.
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
const state = { registered: info.status === "registered", deposit: info.deposit, rewards: info.rewards_available, drep: info.delegated_drep };
const fresh = { registered: false, deposit: "0", rewards: "0", drep: null };
console.log(`${utxos.length} UTxOs;`, state);

const cases = [
  ["change pool", { kind: "delegate", pool: TPREP }, state],
  ["first delegation", { kind: "delegate", pool: LOGIC }, fresh],
  ["vote to a script DRep", { kind: "vote", drep: LOGIC_DREP }, state],
  ["vote no confidence, registering", { kind: "vote", drep: "drep_always_no_confidence" }, fresh],
  ["withdraw", { kind: "withdraw" }, state],
  ["stop", { kind: "stop" }, state],
];
for (const [name, action, s] of cases) {
  const built = JSON.parse(wasm.buildStaking(account, JSON.stringify({ network: "preprod", params, utxos, action, state: s })));
  const answer = await evaluate(built.txCbor);
  console.log(`${name.padEnd(34)} fee ${built.fee}:`, JSON.stringify(answer.result ?? answer.error));
}

const mint = { network: "preprod", params, utxos, label: "probe", withdrawal: info.rewards_available };
const draft = JSON.parse(wasm.draftAccountMint(account, key, JSON.stringify(mint)));
const evaluation = await evaluate(draft.draftCbor);
console.log("account mint with the rewards:", JSON.stringify(evaluation.result ?? evaluation.error));
const done = JSON.parse(wasm.finishAccountMint(account, key, JSON.stringify({ ...mint, evaluation })));
console.log(`  finished: fee ${done.fee.total}, withdrawal ${done.withdrawal}`);
account.free();
key.free();
