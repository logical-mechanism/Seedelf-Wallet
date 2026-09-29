// The wallet's own list of DReps by name, per network, so the vote page can
// search them without asking anyone: every registered DRep whose CIP-119
// metadata gives a name. Run at each release, like `npm run tokens`; the
// DRep a user picks is then read live (drep_info, drep_metadata), so a list
// that has aged only misses DReps registered since, which a pasted ID finds.
//
//   node scripts/dreps.mjs      write src/dreps/<network>.json
//
// Koios has no list of names: drep_list has none, and drep_metadata answers
// only for the IDs it's given, at most 75 a request (the public tier refuses
// bodies over 5,120 bytes). Asking for the name alone keeps the answers small.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../src/dreps/", import.meta.url));
const KOIOS = { preprod: "https://preprod.koios.rest/api/v1", mainnet: "https://api.koios.rest/api/v1" };
/** DRep IDs in one drep_metadata request: 75 CIP-129 IDs are about 4.6 KB. */
const IDS_PER_REQUEST = 75;
const PAGE = 1000;

async function koios(network, path, { body, query = "" } = {}) {
  const url = `${KOIOS[network]}/${path}${query ? `?${query}` : ""}`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.ok) return response.json();
    if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${url}: ${response.status} ${await response.text()}`);
  }
}

/** A name as the wallet shows it: CIP-119's `givenName` as text (or JSON-LD's `@value`), without control characters, at most 64 characters. The worker's drepName. */
function nameOf(givenName) {
  const text =
    typeof givenName === "string"
      ? givenName
      : typeof givenName?.["@value"] === "string"
        ? givenName["@value"]
        : undefined;
  const clean = text?.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return clean ? clean.slice(0, 64) : undefined;
}

mkdirSync(dir, { recursive: true });
for (const network of Object.keys(KOIOS)) {
  const ids = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await koios(network, "drep_list", {
      query: `registered=eq.true&select=drep_id&order=drep_id.asc&offset=${offset}&limit=${PAGE}`,
    });
    ids.push(...page.map((d) => d.drep_id));
    if (page.length < PAGE) break;
  }
  const dreps = [];
  let requests = 0;
  for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
    const rows = await koios(network, "drep_metadata", {
      body: { _drep_ids: ids.slice(i, i + IDS_PER_REQUEST) },
      query: "select=drep_id,meta_json->body->givenName",
    });
    requests++;
    for (const row of rows) {
      const name = nameOf(row.givenName);
      if (name) dreps.push([row.drep_id, name]);
    }
  }
  dreps.sort(([ia, a], [ib, b]) => a.localeCompare(b, "en", { sensitivity: "base" }) || ia.localeCompare(ib));
  const out = { recorded: new Date().toISOString().slice(0, 10), dreps };
  // One DRep a line keeps a release's changes readable in a diff.
  const body = `{\n  "recorded": "${out.recorded}",\n  "dreps": [\n${dreps.map((d) => `    ${JSON.stringify(d)}`).join(",\n")}\n  ]\n}\n`;
  writeFileSync(`${dir}${network}.json`, body);
  console.log(
    `${network}: ${ids.length} registered DReps, ${dreps.length} named (${requests} drep_metadata requests), ` +
      `${Math.round(body.length / 1024)} KB -> src/dreps/${network}.json`,
  );
}
