// Records the 12-word test-vector phrase's rewards history from preprod, as
// the wallet asks for it (src/background/koios.ts `rewardHistory`): every
// reward its stake key was paid, newest first, 1,000 a request. Read-only.
//   node tests/fixtures/record-rewards.mjs
//
// The stake key is the one staking-preprod.json was recorded for. Writes
// rewards-preprod.json.
import { readFileSync, writeFileSync } from "node:fs";

const KOIOS = "https://preprod.koios.rest/api/v1";
/** What the wallet asks for. */
const COLUMNS = "earned_epoch,spendable_epoch,amount,type,pool_id_bech32";
const ORDER = "spendable_epoch.desc,earned_epoch.desc,type.asc,pool_id_bech32.asc,amount.asc";

const { stake } = JSON.parse(readFileSync(new URL("staking-preprod.json", import.meta.url)));

const rows = [];
for (let offset = 0; ; offset += 1000) {
  const r = await fetch(`${KOIOS}/account_reward_history?select=${COLUMNS}&order=${ORDER}&offset=${offset}&limit=1000`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ _stake_addresses: [stake] }),
  });
  if (!r.ok) throw new Error(`account_reward_history: ${r.status} ${await r.text()}`);
  const page = await r.json();
  rows.push(...page);
  if (page.length < 1000) break;
}

// One reward a line keeps the list readable in a diff.
const list = `[\n${rows.map((row) => `    ${JSON.stringify(row)}`).join(",\n")}\n  ]`;
const out = `{\n  "recorded": ${JSON.stringify(new Date().toISOString())},\n  "stake": ${JSON.stringify(stake)},\n  "account_reward_history": ${list}\n}\n`;
writeFileSync(new URL("rewards-preprod.json", import.meta.url), out);
console.log(`${rows.length} rewards for ${stake}`);
