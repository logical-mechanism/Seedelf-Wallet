// Records the Koios answers the activity tests use: the 12-word test-vector
// phrase's real preprod account, its transactions as Public activity asks for
// them (credential_txs by the payment keys the balance reading asks about,
// newest first) up to the block where the recording by the stake key it
// replaced ended (UNTIL), and their tx_info with only the fields Activity
// reads, each input's and output's payment key (`cred`) too: the account's
// are matched by it. That's later than koios-preprod.json's balance recording,
// so the two aren't one moment (UNTIL says how). Run from extension/ after
// `npm run build:wasm`:
//   node tests/fixtures/record-activity.mjs
// Writes activity-preprod.json; its rows stay under `account_txs`, the name
// from when Activity asked by the stake key, which the fakes read. Read-only:
// four requests, nothing is submitted.
import { readFileSync, writeFileSync } from "node:fs";

const wasmPkg = new URL("../../../wasm/pkg/", import.meta.url);
const wasm = await import(new URL("seedelf_wasm.js", wasmPkg));
wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", wasmPkg)) });

const KOIOS = "https://preprod.koios.rest/api/v1";
/**
 * The newest block the recording by the stake key (`account_txs`, 45 rows) read, kept so the tests' pages count as
 * they did. It's after koios-preprod.json's recording (2026-09-24 at 01:04:56Z, between blocks 5,211,212 and
 * 5,212,969): the five transactions here from block 5,212,969 on spend all six UTxOs that file says the account holds.
 */
const UNTIL = 5_214_888;
/** Enough rows for a first page, "Load more", and a short last page: every one back to block 4,923,417. */
const ROWS = 46;
/** How many unused addresses in a row end each chain's walk (chain.ts GAP_LIMIT). */
const GAP = 20;

const vector = JSON.parse(
  readFileSync(new URL("../../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)),
).vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12);
const stake = vector.preprod.stake;

// The keys the balance reading asks about over the recorded answers (account.ts discoverAccount): the receive chain,
// then the change chain, each walked until GAP addresses in a row are unused.
const recorded = JSON.parse(readFileSync(new URL("koios-preprod.json", import.meta.url))).accounts[stake];
const used = new Set(recorded.account_addresses[0].addresses);
const account = wasm.CardanoAccount.fromPhrase(vector.phrase, 0);
const keys = [];
for (const role of [0, 1]) {
  const address = (i) =>
    role === 0 ? account.receiveAddress(wasm.Network.Preprod, i) : account.changeAddress(wasm.Network.Preprod, i);
  for (let i = 0, last = -1; i - last <= GAP; i++) {
    if (used.has(address(i))) last = i;
    keys.push(account.paymentKeyHash(role, i));
  }
}
account.free();

async function post(path, body, query = "") {
  const r = await fetch(`${KOIOS}/${path}${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const txs = await post(
  "credential_txs",
  { _payment_credentials: keys },
  `order=block_height.desc,tx_hash.asc&block_height=lte.${UNTIL}&limit=${ROWS}`,
);
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
const io = (o) => ({
  payment_addr: { bech32: o.payment_addr.bech32, cred: o.payment_addr.cred },
  value: o.value,
  asset_list: o.asset_list,
});
const slim = info.map((t) => ({
  tx_hash: t.tx_hash,
  block_height: t.block_height,
  tx_timestamp: t.tx_timestamp,
  fee: t.fee,
  inputs: t.inputs.map(io),
  outputs: t.outputs.map(io),
}));
const out = new URL("activity-preprod.json", import.meta.url);
writeFileSync(out, `${JSON.stringify({ stake, account_txs: txs, tx_info: slim }, null, 1)}\n`);
console.log(`${keys.length} keys, ${txs.length} transactions, ${slim.length} tx_info rows -> ${out.pathname}`);
