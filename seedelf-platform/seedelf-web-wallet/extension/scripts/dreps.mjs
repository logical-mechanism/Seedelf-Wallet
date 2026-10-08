// The wallet's own list of DReps by name, per network, so the vote page can
// search them without asking anyone: every registered DRep whose CIP-119
// metadata gives a name, as the Koios server it reaches holds them. Run at
// each release, like `npm run tokens`; the DRep a user picks is then read
// live (drep_info, drep_metadata), so a list that has aged only misses DReps
// registered since, which a pasted ID finds.
//
// Koios's servers disagree about DRep metadata: 1.3.0's release prep had
// three runs name 371, 407 and 406 mainnet DReps against the committed 449,
// each missing a different set, and a minute later Koios had most of the
// missing ones. So a DRep left unnamed is asked for again, up to PASSES times
// in all. One the committed list names that's still registered but that no
// pass names keeps its committed name: CIP-119 requires a givenName, so a
// missing one almost always means the server reached lacks the metadata.
// A list that still loses more than MAX_LOSS of the committed one's DReps,
// which only deregistrations explain, is refused and nothing is written
// (../docs/development.md, Releasing to the Web Store, step 3).
//
//   node scripts/dreps.mjs      write src/dreps/<network>.json
//
// Koios has no list of names: drep_list has none, and drep_metadata answers
// only for the IDs it's given, at most 75 a request (the public tier refuses
// bodies over 5,120 bytes). Asking for the name alone keeps the answers small.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../src/dreps/", import.meta.url));
const KOIOS = { preprod: "https://preprod.koios.rest/api/v1", mainnet: "https://api.koios.rest/api/v1" };
/** DRep IDs in one drep_metadata request: 75 CIP-129 IDs are about 4.6 KB. */
const IDS_PER_REQUEST = 75;
const PAGE = 1000;
/** Passes over the DReps still unnamed, the first included: each may reach a Koios server that has their metadata. */
const PASSES = 3;
/** The wait before each pass after the first. */
const PASS_GAP_MS = 15_000;
/** The share of the committed list's DReps a refresh may lose before it's refused as Koios failing rather than DReps leaving. */
const MAX_LOSS = 0.05;

/** The committed list's names by DRep ID, empty when there's none yet. */
function committedOf(network) {
  const file = `${dir}${network}.json`;
  if (!existsSync(file)) return new Map();
  return new Map(JSON.parse(readFileSync(file, "utf8")).dreps);
}

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
  const committed = committedOf(network);
  const named = new Map();
  let requests = 0;
  let passes = 0;
  // Each pass asks only for the DReps no earlier pass named; the first name a pass gives is kept.
  for (let wanted = ids; passes < PASSES && wanted.length; wanted = ids.filter((id) => !named.has(id))) {
    if (passes++) await new Promise((r) => setTimeout(r, PASS_GAP_MS));
    for (let i = 0; i < wanted.length; i += IDS_PER_REQUEST) {
      const rows = await koios(network, "drep_metadata", {
        body: { _drep_ids: wanted.slice(i, i + IDS_PER_REQUEST) },
        query: "select=drep_id,meta_json->body->givenName",
      });
      requests++;
      for (const row of rows) {
        const name = nameOf(row.givenName);
        if (name && !named.has(row.drep_id)) named.set(row.drep_id, name);
      }
    }
  }
  const registered = new Set(ids);
  let kept = 0;
  for (const [id, name] of committed) {
    if (registered.has(id) && !named.has(id)) {
      named.set(id, name);
      kept++;
    }
  }
  const gone = [...committed.keys()].filter((id) => !registered.has(id)).length;
  if (committed.size && named.size < committed.size * (1 - MAX_LOSS)) {
    throw new Error(
      `${network}: ${named.size} named DReps against the committed ${committed.size}, ${gone} of them no longer ` +
        `registered: more than deregistrations explain, so Koios is likely failing. Nothing written; run it again later.`,
    );
  }
  const dreps = [...named];
  dreps.sort(([ia, a], [ib, b]) => a.localeCompare(b, "en", { sensitivity: "base" }) || ia.localeCompare(ib));
  const out = { recorded: new Date().toISOString().slice(0, 10), dreps };
  // One DRep a line keeps a release's changes readable in a diff.
  const body = `{\n  "recorded": "${out.recorded}",\n  "dreps": [\n${dreps.map((d) => `    ${JSON.stringify(d)}`).join(",\n")}\n  ]\n}\n`;
  writeFileSync(`${dir}${network}.json`, body);
  console.log(
    `${network}: ${ids.length} registered DReps, ${dreps.length} named (${requests} drep_metadata requests in ${passes} ` +
      `passes; ${kept} kept as committed, no Koios server naming them now; ${gone} committed no longer registered), ` +
      `${Math.round(body.length / 1024)} KB -> src/dreps/${network}.json`,
  );
}
