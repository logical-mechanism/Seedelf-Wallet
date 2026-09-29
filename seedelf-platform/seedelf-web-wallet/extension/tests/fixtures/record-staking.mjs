// Records the Koios answers the staking tests use, from preprod. Read-only:
// nothing is submitted.   node tests/fixtures/record-staking.mjs
//
// account_info   the 12-word test-vector phrase's account: registered,
//                staking with LOGIC, voting always abstain, with rewards
// pool_list      every live pool, with only the columns the browser reads
// totals, epoch_params   the supply and `optimal_pool_count`, for saturation
// pool_info      LOGIC, and the largest live pool with a ticker
// drep_info, drep_metadata   Logical Mechanism's DRep (a script, expired),
//                and an active key DRep with metadata
//
// Writes staking-preprod.json.
import { readFileSync, writeFileSync } from "node:fs";

const KOIOS = "https://preprod.koios.rest/api/v1";
const LOGIC = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";
const LOGIC_DREP = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";
/** What the wallet asks for (src/background/koios.ts). */
const POOL_COLUMNS = "pool_id_bech32,ticker,margin,fixed_cost,pledge,active_stake,retiring_epoch";
const POOL_INFO_COLUMNS =
  "pool_id_bech32,meta_json,margin,fixed_cost,pledge,live_pledge,live_stake,live_saturation,live_delegators,block_count,pool_status,retiring_epoch";
const DREP_INFO_COLUMNS = "drep_id,drep_status,active,expires_epoch_no,amount,live_delegator_count";
/** CIP-119's name only: no images, which would be fetched from anywhere. */
const DREP_METADATA_COLUMNS = "drep_id,meta_json->body->givenName";

const vectors = JSON.parse(
  readFileSync(new URL("../../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)),
).vectors;
const stake = vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12).preprod.stake;

async function koios(path, { body, query = "" } = {}) {
  const r = await fetch(`${KOIOS}/${path}${query ? `?${query}` : ""}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const account_info = await koios("account_info", { body: { _stake_addresses: [stake] } });
const pool_list = [];
for (let offset = 0; ; offset += 1000) {
  const page = await koios("pool_list", {
    query: `pool_status=eq.registered&select=${POOL_COLUMNS}&order=pool_id_bech32.asc&offset=${offset}&limit=1000`,
  });
  pool_list.push(...page);
  if (page.length < 1000) break;
}
const totals = await koios("totals", { query: "select=epoch_no,supply&order=epoch_no.desc&limit=1" });
const [params] = await koios("epoch_params", { query: "limit=1" });
const largest = pool_list
  .filter((p) => p.ticker && p.pool_id_bech32 !== LOGIC)
  .sort((a, b) => Number(BigInt(b.active_stake ?? 0) - BigInt(a.active_stake ?? 0)))[0];
const pool_info = await koios("pool_info", {
  body: { _pool_bech32_ids: [LOGIC, largest.pool_id_bech32] },
  query: `select=${POOL_INFO_COLUMNS}`,
});

// An active key DRep with metadata, for a second, ordinary, case.
const keyDreps = (await koios("drep_list", { query: "registered=eq.true&has_script=eq.false&limit=60" })).map((d) => d.drep_id);
const active = (await koios("drep_info", { body: { _drep_ids: keyDreps } })).find((d) => d.active && d.meta_url);
const dreps = [LOGIC_DREP, active.drep_id];
const drep_info = await koios("drep_info", { body: { _drep_ids: dreps }, query: `select=${DREP_INFO_COLUMNS}` });
const drep_metadata = await koios("drep_metadata", { body: { _drep_ids: dreps }, query: `select=${DREP_METADATA_COLUMNS}` });

const out = new URL("staking-preprod.json", import.meta.url);
// One pool a line keeps the list readable in a diff.
const list = `[\n${pool_list.map((p) => JSON.stringify(p)).join(",\n")}\n]`;
const rest = JSON.stringify(
  {
    recorded: new Date().toISOString(),
    stake,
    account_info,
    totals,
    epoch_params: [{ epoch_no: params.epoch_no, optimal_pool_count: params.optimal_pool_count, key_deposit: params.key_deposit }],
    pool_info,
    drep_info,
    drep_metadata,
  },
  null,
  1,
);
writeFileSync(out, `${rest.slice(0, -2)},\n "pool_list": ${list}\n}\n`);
console.log(
  `account ${account_info[0]?.status} with ${account_info[0]?.delegated_pool}; ${pool_list.length} live pools; ` +
    `pool_info ${pool_info.map((p) => p.meta_json?.ticker).join(", ")}; DReps ${drep_info.map((d) => d.drep_id).join(", ")} -> ${out.pathname}`,
);
