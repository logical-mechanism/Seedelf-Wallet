// Checks the DRep's transactions (chunk 21) against preprod without spending
// anything. Run from extension/ after `npm run build:wasm`:
//   node tests/fixtures/probe-governance.mjs
//
// For the public 12-word test-vector phrase's account: builds and signs every
// kind of DRep transaction (register with the account's own vote, and with a
// profile; update; retire; vote on preprod's live governance actions) and has
// Koios's Ogmios evaluate each. Ogmios decodes a transaction with the node's
// own Conway decoder first, so `[]` (no scripts to run) means it decoded. It
// checks the bytes, not the ledger's rules: whether the DRep is registered,
// the deposit, the witnesses. The account holds less than a DRep's 500 tADA
// deposit, so one input is made up and handed to Ogmios as `additionalUtxo`.
// Nothing is submitted, and nothing is written.
import { readFileSync } from "node:fs";

const wasmPkg = new URL("../../../wasm/pkg/", import.meta.url);
const wasm = await import(new URL("seedelf_wasm.js", wasmPkg));
wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", wasmPkg)) });

const KOIOS = "https://preprod.koios.rest/api/v1";

async function koios(path, { body, query = "" } = {}) {
  const r = await fetch(`${KOIOS}/${path}${query ? `?${query}` : ""}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!r.ok && r.status !== 400) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const phrase = JSON.parse(
  readFileSync(new URL("../../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)),
).vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12).phrase;
const account = wasm.CardanoAccount.fromPhrase(phrase, 0);
const me = JSON.parse(account.drepOf());

// A made-up 600 tADA UTxO at the account's receive address 0/0, in the shape of one of its real ones: not
// on chain, so Ogmios is told of it.
const receive = account.receiveAddress(wasm.Network.Preprod, 0);
const [real] = await koios("credential_utxos", { body: { _payment_credentials: [account.paymentKeyHash(0, 0)], _extended: true } });
const made = {
  ...real,
  tx_hash: "d1".repeat(32),
  tx_index: 0,
  address: receive,
  value: "600000000",
  asset_list: [],
  datum_hash: null,
  inline_datum: null,
  reference_script: null,
};
const additionalUtxo = [
  { transaction: { id: made.tx_hash }, index: 0, address: receive, value: { ada: { lovelace: 600_000_000 } } },
];
const evaluate = (cbor) =>
  koios("ogmios", { body: { jsonrpc: "2.0", method: "evaluateTransaction", params: { transaction: { cbor }, additionalUtxo } } });

const [info] = await koios("account_info", { body: { _stake_addresses: [account.stakeAddress(wasm.Network.Preprod)] } });
const [params] = await koios("epoch_params", { query: "limit=1" });
const live = await koios("proposal_list", {
  query: "ratified_epoch=is.null&enacted_epoch=is.null&dropped_epoch=is.null&expired_epoch=is.null&select=proposal_tx_hash,proposal_index,proposal_type",
});
const state = { registered: info.status === "registered", deposit: info.deposit, rewards: info.rewards_available, drep: info.delegated_drep };
const utxos = [{ utxo: made, role: 0, index: 0 }];
const registered = { registered: true, deposit: params.drep_deposit };
console.log(`DRep ${me.id}; ${live.length} live actions; drep_deposit ${params.drep_deposit}`);

const profile = JSON.parse(wasm.drepProfile(JSON.stringify({ givenName: "Seedelf probe", doNotList: true })));
const cases = [
  ["register, its own vote too", { kind: "drep-register", delegate: true }, undefined, state],
  [
    "register with a profile, alone",
    { kind: "drep-register", delegate: false, anchor: { url: "ipfs://bafkreigzvg5nbyngh2hfxrptxmh2jturifcsq5v2gbaz7hfg6ccvhlzgxu", hash: profile.hash } },
    undefined,
    state,
  ],
  ["register, its own vote registering the key", { kind: "drep-register", delegate: true }, undefined, { registered: false, deposit: "0", rewards: "0", drep: null }],
  ["update, no profile", { kind: "drep-update" }, registered, state],
  ["retire, its own vote to abstain", { kind: "drep-retire" }, registered, { ...state, drep: me.id }],
  [
    `vote on all ${live.length} live actions`,
    { kind: "drep-vote", votes: live.map((a, i) => ({ txHash: a.proposal_tx_hash, index: a.proposal_index, vote: ["yes", "no", "abstain"][i % 3] })) },
    registered,
    state,
  ],
];
let failed = 0;
for (const [name, action, drep, s] of cases) {
  const built = JSON.parse(wasm.buildStaking(account, JSON.stringify({ network: "preprod", params, utxos, action, state: s, drep })));
  const answer = await evaluate(built.txCbor);
  const ok = Array.isArray(answer.result) && answer.result.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? "ok " : "BAD"} ${name.padEnd(44)} fee ${built.fee}, deposit ${built.deposit}, refund ${built.refund}:`, JSON.stringify(answer.result ?? answer.error));
}
account.free();
if (failed) process.exit(1);
