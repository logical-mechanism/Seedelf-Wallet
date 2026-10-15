// Records Koios's `pool_history` as the wallet asks for it (src/background/koios.ts `poolHistory`): a pool's newest
// 18 epochs, newest first. Read-only.   node tests/fixtures/record-pool-history.mjs
//
// preprod   LOGIC, which made no blocks in some of them, and the largest live pool with a ticker
//           (staking-preprod.json's two pool_info pools)
// mainnet   OctasPool, whose answer leaves out every other epoch's rewards (deleg_rewards null with blocks made):
//           mainnet Koios's cache skips them (grest.pool_history_cache_update, seen 2026-10-15)
//
// Writes pool-history.json.
import { writeFileSync } from "node:fs";

const KOIOS = { preprod: "https://preprod.koios.rest/api/v1", mainnet: "https://api.koios.rest/api/v1" };
const POOLS = {
  preprod: ["pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg", "pool1sh4cddrln788xmnjnsqhdwj9e7th3c3ck3zjk7ny9znwj44t8he"],
  mainnet: ["pool1z5uqdk7dzdxaae5633fqfcu2eqzy3a3rgtuvy087fdld7yws0xt"],
};
/** What the wallet asks for. */
const COLUMNS = "epoch_no,active_stake,block_cnt,deleg_rewards";
const EPOCHS = 18;

async function history(network, pool) {
  const query = `_pool_bech32=${pool}&select=${COLUMNS}&order=epoch_no.desc&limit=${EPOCHS}`;
  const r = await fetch(`${KOIOS[network]}/pool_history?${query}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${network} ${pool}: ${r.status} ${await r.text()}`);
  return r.json();
}

const out = { recorded: new Date().toISOString() };
for (const network of ["preprod", "mainnet"]) {
  out[network] = {};
  for (const pool of POOLS[network]) out[network][pool] = await history(network, pool);
}
// One epoch a line keeps the answers readable in a diff.
const text = JSON.stringify(out, null, 2).replace(/\{\s+("epoch_no"[^}]*?)\s+\}/g, (_, body) => `{ ${body.replace(/\s*\n\s*/g, " ")} }`);
writeFileSync(new URL("pool-history.json", import.meta.url), `${text}\n`);
console.log("wrote pool-history.json");
