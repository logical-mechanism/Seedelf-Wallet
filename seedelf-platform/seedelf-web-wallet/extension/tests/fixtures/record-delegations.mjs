// Records the 12-word test-vector phrase's delegation history from preprod,
// as the wallet asks for it (src/background/koios.ts `delegationHistory`):
// every certificate naming its stake key but its withdrawals, oldest first,
// 1,000 a request, kept as the server gave them; then the transactions that
// made them, as `tx_info` answers Activity's request, keeping only what the
// history reads (the time, the fee, the certificates and withdrawals: no
// inputs or outputs). Read-only: two requests.
//   node tests/fixtures/record-delegations.mjs
//
// The stake key is the one staking-preprod.json was recorded for. Writes
// delegations-preprod.json.
import { readFileSync, writeFileSync } from "node:fs";

const KOIOS = "https://preprod.koios.rest/api/v1";
/** What the wallet asks for. */
const COLUMNS = "action_type,tx_hash,epoch_no,absolute_slot,block_time";
const FILTER = "action_type=neq.withdrawal";
const ORDER = "absolute_slot.asc,tx_hash.asc,action_type.asc";

const { stake } = JSON.parse(readFileSync(new URL("staking-preprod.json", import.meta.url)));

async function post(path, query, body) {
  const r = await fetch(`${KOIOS}/${path}${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const rows = [];
for (let offset = 0; ; offset += 1000) {
  const page = await post("account_update_history", `select=${COLUMNS}&${FILTER}&order=${ORDER}&offset=${offset}&limit=1000`, {
    _stake_addresses: [stake],
  });
  rows.push(...page);
  if (page.length < 1000) break;
}

// Activity's request (koios.ts `txInfo`), 20 a request as the wallet asks.
const hashes = [...new Set(rows.map((r) => r.tx_hash))];
const txs = [];
for (let i = 0; i < hashes.length; i += 20) {
  txs.push(
    ...(await post("tx_info", "", {
      _tx_hashes: hashes.slice(i, i + 20),
      _inputs: true,
      _metadata: true,
      _assets: true,
      _withdrawals: true,
      _certs: true,
      _scripts: false,
      _bytecode: false,
      _governance: true,
    })),
  );
}
const kept = txs
  .map(({ tx_hash, block_height, tx_timestamp, fee, certificates, withdrawals }) => ({
    tx_hash,
    block_height,
    tx_timestamp,
    fee,
    inputs: [],
    outputs: [],
    certificates,
    withdrawals,
  }))
  .sort((a, b) => a.block_height - b.block_height);

writeFileSync(
  new URL("delegations-preprod.json", import.meta.url),
  `${JSON.stringify({ stake, account_update_history: rows, tx_info: kept }, null, 1)}\n`,
);
console.log(`${rows.length} certificates in ${kept.length} transactions`);
