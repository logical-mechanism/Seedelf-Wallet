// Records the Koios answers the NFT image tests use (chunk 20). Read-only:
//   node tests/fixtures/record-nft-images.mjs
//
// preprod   asset_info for the NFTs the 24-word test-vector phrase's account
//           holds (the e2e suite's Tokens test): one CIP-25 image
//           (HANOI15102024, its mediaType "image/jpg"), two CIP-68 ones,
//           one with no metadata at all, and one whose image is "ipfs://"
//           with no CID (Veil-Mesh-License), as real metadata has
// mainnet   SpaceBud #0 (CIP-25, its name the asset name as text) and an
//           ADA Handle (CIP-68 and CIP-25 both)
//
// Each with the two columns the wallet asks for (src/background/koios.ts),
// and its policy and name beside them so a test can find it. Writes
// nft-images.json.
import { readFileSync, writeFileSync } from "node:fs";

/** What the wallet asks for. */
const COLUMNS = "minting_tx_metadata,cip68_metadata";

const koiosPreprod = JSON.parse(readFileSync(new URL("koios-preprod.json", import.meta.url)));
const vectors = JSON.parse(
  readFileSync(new URL("../../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)),
).vectors;
const stake = vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 24).preprod.stake;

/** The account's NFTs, as the wallet tells them apart: a CIP-68 222 label, or a single unit. */
const held = koiosPreprod.accounts[stake].account_utxos
  .flatMap((u) => u.asset_list ?? [])
  .filter((a) => a.asset_name.startsWith("000de140") || a.quantity === "1")
  .map((a) => [a.policy_id, a.asset_name]);

const MAINNET = [
  ["d5e6bf0500378d4f0da4e8dde6becec7621cd8cbf5cbb9b87013d4cc", "537061636542756430"],
  ["f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a", "000de1402d2d302d2d"],
];

async function assetInfo(base, list) {
  const rows = [];
  for (const [policy, name] of list) {
    const r = await fetch(`${base}/asset_info?select=${COLUMNS}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ _asset_list: [[policy, name]] }),
    });
    if (!r.ok) throw new Error(`asset_info ${policy}.${name}: ${r.status} ${await r.text()}`);
    const [row] = await r.json();
    rows.push({ policy_id: policy, asset_name: name, answer: row ? [row] : [] });
  }
  return rows;
}

const out = {
  recorded: new Date().toISOString().slice(0, 10),
  preprod: await assetInfo("https://preprod.koios.rest/api/v1", held),
  mainnet: await assetInfo("https://api.koios.rest/api/v1", MAINNET),
};
writeFileSync(new URL("nft-images.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(`preprod ${out.preprod.length}, mainnet ${out.mainnet.length}`);
