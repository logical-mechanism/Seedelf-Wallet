// Records the Koios answers the governance tests use (chunk 21). Read-only:
// nothing is submitted.   node tests/fixtures/record-governance.mjs
//
// proposal_list   every live governance action, on preprod (no metadata:
//                 Koios hasn't read their anchors) and on mainnet (titles and
//                 abstracts), with only the columns the wallet asks for
// drep_info, drep_metadata, vote_list   a registered key DRep on mainnet
//                 with a profile, and its votes on those live actions
//
// Writes governance.json.
import { writeFileSync } from "node:fs";

const KOIOS = { preprod: "https://preprod.koios.rest/api/v1", mainnet: "https://api.koios.rest/api/v1" };
/** What the wallet asks for (src/background/koios.ts). */
const LIVE =
  "ratified_epoch=is.null&enacted_epoch=is.null&dropped_epoch=is.null&expired_epoch=is.null";
const PROPOSAL_COLUMNS =
  "proposal_id,proposal_tx_hash,proposal_index,proposal_type,proposed_epoch,expiration,deposit,meta_url,meta_hash,meta_is_valid,title:meta_json->body->>title,abstract:meta_json->body->>abstract,block_time,withdrawal";
const DREP_STANDING_COLUMNS =
  "drep_id,drep_status,active,expires_epoch_no,amount,live_delegator_count,deposit,meta_url,meta_hash";
const DREP_PROFILE_COLUMNS = "drep_id,is_valid,meta_json->body->givenName";
/** A registered key DRep with a profile, which votes. */
const DREP = "drep1yfzzwr8jznn02mzepvs6y9n4329eskzpgygjdh4ew28szpcd5hr4f";

async function koios(network, path, { body, query = "" } = {}) {
  const r = await fetch(`${KOIOS[network]}/${path}${query ? `?${query}` : ""}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${network} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proposals = async (network) =>
  koios(network, "proposal_list", {
    query: `${LIVE}&select=${PROPOSAL_COLUMNS}&order=proposed_epoch.desc,proposal_id.asc&offset=0&limit=1000`,
  });

const preprod = await proposals("preprod");
const mainnet = await proposals("mainnet");
const drep_info = await koios("mainnet", "drep_info", {
  body: { _drep_ids: [DREP] },
  query: `select=${DREP_STANDING_COLUMNS}`,
});
const drep_metadata = await koios("mainnet", "drep_metadata", {
  body: { _drep_ids: [DREP] },
  query: `select=${DREP_PROFILE_COLUMNS}`,
});
const ids = mainnet.map((p) => p.proposal_id).join(",");
const vote_list = await koios("mainnet", "vote_list", {
  query: `voter_id=eq.${DREP}&proposal_id=in.(${ids})&select=proposal_id,vote,block_time&order=block_time.desc`,
});

const out = {
  recorded: new Date().toISOString().slice(0, 10),
  drep: DREP,
  proposal_list: { preprod, mainnet },
  drep_info,
  drep_metadata,
  vote_list,
};
writeFileSync(new URL("governance.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(`preprod ${preprod.length} live, mainnet ${mainnet.length} live, ${vote_list.length} votes`);
