// Records the Koios answers the activity tests use: the 12-word test-vector
// phrase's real preprod account, its newest transactions (account_txs, newest
// first) and their tx_info, with only the fields Activity asks for.
//   node tests/fixtures/record-activity.mjs
// Writes activity-preprod.json. Read-only: nothing is submitted.
import { readFileSync, writeFileSync } from "node:fs";

const KOIOS = "https://preprod.koios.rest/api/v1";
/** Enough rows for a first page, "Load more", and a short last page. */
const ROWS = 45;

const vectors = JSON.parse(
  readFileSync(new URL("../../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)),
).vectors;
const stake = vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12).preprod.stake;

async function post(path, body, query = "") {
  const r = await fetch(`${KOIOS}/${path}${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const txs = await post("account_txs", { _stake_address: stake }, `order=block_height.desc,tx_hash.asc&limit=${ROWS}`);
const info = [];
for (let i = 0; i < txs.length; i += 20) {
  info.push(
    ...(await post("tx_info", {
      _tx_hashes: txs.slice(i, i + 20).map((t) => t.tx_hash),
      _inputs: true,
      _metadata: false,
      _assets: true,
      _withdrawals: false,
      _certs: false,
      _scripts: false,
      _bytecode: false,
    })),
  );
}
// Only what Activity reads, to keep the fixture small.
const slim = info.map((t) => ({
  tx_hash: t.tx_hash,
  block_height: t.block_height,
  tx_timestamp: t.tx_timestamp,
  fee: t.fee,
  inputs: t.inputs.map((i) => ({ payment_addr: { bech32: i.payment_addr.bech32 }, value: i.value, asset_list: i.asset_list })),
  outputs: t.outputs.map((o) => ({ payment_addr: { bech32: o.payment_addr.bech32 }, value: o.value, asset_list: o.asset_list })),
}));
const out = new URL("activity-preprod.json", import.meta.url);
writeFileSync(out, `${JSON.stringify({ stake, account_txs: txs, tx_info: slim }, null, 1)}\n`);
console.log(`${txs.length} transactions, ${slim.length} tx_info rows -> ${out.pathname}`);
