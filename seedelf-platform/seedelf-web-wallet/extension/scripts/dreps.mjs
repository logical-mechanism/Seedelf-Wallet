// The wallet's own list of DReps by name, per network, so the vote page can
// search them without asking anyone: every registered DRep whose CIP-119
// metadata gives a name and doesn't ask directories not to list it
// (`doNotList`, the default in the wallet's own DRep form), as the Koios
// server it reaches holds them. Run at each release, like `npm run tokens`;
// the DRep a user picks is then read live (drep_info, drep_metadata), so a
// list that has aged only misses DReps registered since, which a pasted ID
// finds, as it finds one that asked not to be listed (chunk 51, gap-g7#2).
//
// Koios's servers disagree about DRep metadata: 1.3.0's release prep had
// three runs name 371, 407 and 406 mainnet DReps against the committed 449,
// each missing a different set, and a minute later Koios had most of the
// missing ones. So a DRep left unnamed is asked for again, up to PASSES times
// in all. One the committed list names that's still registered but that no
// pass names keeps its committed name: CIP-119 requires a givenName, so a
// missing one almost always means the server reached lacks the metadata.
// One that asks not to be listed is out of the list, out of later passes and
// out of that fallback, and its leaving isn't a loss. A list that still loses
// more than MAX_LOSS of the committed one's other DReps, which only
// deregistrations explain, is refused and nothing is written
// (../docs/development.md, Releasing to the Web Store, step 3).
//
//   node scripts/dreps.mjs      write src/dreps/<network>.json
//
// Koios has no list of names: drep_list has none, and drep_metadata answers
// only for the IDs it's given, at most 75 a request (the public tier refuses
// bodies over 5,120 bytes). Asking for the name and doNotList alone keeps the
// answers small.

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
export const MAX_LOSS = 0.05;

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
export function nameOf(givenName) {
  const text =
    typeof givenName === "string"
      ? givenName
      : typeof givenName?.["@value"] === "string"
        ? givenName["@value"]
        : undefined;
  const clean = text?.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return clean ? clean.slice(0, 64) : undefined;
}

/**
 * Whether a DRep's CIP-119 `doNotList` asks directories not to list it: true, or JSON-LD's `{"@value": true}`, read as
 * nameOf reads a name; the text "true" too, which says the same.
 */
export function asksNotToBeListed(doNotList) {
  const value =
    doNotList !== null && typeof doNotList === "object" && "@value" in doNotList ? doNotList["@value"] : doNotList;
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

/** The query each drep_metadata request selects by: the name, and whether the DRep asks not to be listed. */
export const METADATA_SELECT = "select=drep_id,meta_json->body->givenName,meta_json->body->doNotList";

/**
 * What one pass's drep_metadata rows add: to `named`, DRep ID to name, the first name a pass gives; to `unlisted`, each
 * DRep whose profile asks directories not to list it, which no name of it outlasts.
 */
export function readRows(rows, named, unlisted) {
  for (const row of rows) {
    if (asksNotToBeListed(row.doNotList)) {
      unlisted.add(row.drep_id);
      named.delete(row.drep_id);
      continue;
    }
    const name = nameOf(row.givenName);
    if (name && !named.has(row.drep_id) && !unlisted.has(row.drep_id)) named.set(row.drep_id, name);
  }
}

/** The DReps a pass after the first asks for: those no earlier pass named, or found asking not to be listed. */
export const stillWanted = (ids, named, unlisted) => ids.filter((id) => !named.has(id) && !unlisted.has(id));

/**
 * The list a refresh writes, by name, from the registered DReps' `ids`, what the passes `named`, those `unlisted`
 * (asking not to be listed) and the `committed` list: a registered DRep no pass named keeps its committed name, unless
 * it asks not to be listed. Throws, so nothing is written, when it still loses more than MAX_LOSS of the committed
 * list's other DReps: one that asks not to be listed left by its own ask, not by Koios failing. `left`: how many of
 * the committed list's DReps that is.
 */
export function listOf(network, { ids, named, unlisted, committed }) {
  const all = new Map([...named].filter(([id]) => !unlisted.has(id)));
  const registered = new Set(ids);
  let kept = 0;
  for (const [id, name] of committed) {
    if (registered.has(id) && !all.has(id) && !unlisted.has(id)) {
      all.set(id, name);
      kept++;
    }
  }
  const gone = [...committed.keys()].filter((id) => !registered.has(id)).length;
  const left = [...committed.keys()].filter((id) => unlisted.has(id)).length;
  const others = committed.size - left;
  if (others && all.size < others * (1 - MAX_LOSS)) {
    throw new Error(
      `${network}: ${all.size} named DReps against the committed ${committed.size}, ${gone} of them no longer ` +
        `registered and ${left} asking not to be listed: more than deregistrations explain, so Koios is likely ` +
        `failing. Nothing written; run it again later.`,
    );
  }
  const dreps = [...all];
  // Ties by ID in en-US, never the shell's locale: a refresh's diff is the same on any machine (G8's notes).
  dreps.sort(([ia, a], [ib, b]) => a.localeCompare(b, "en", { sensitivity: "base" }) || ia.localeCompare(ib, "en-US"));
  return { dreps, kept, gone, left };
}

// Run as node's main only: tests/dreps.test.ts imports the list's rules above, and asks no one.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
    const unlisted = new Set();
    let requests = 0;
    let passes = 0;
    // Each pass asks only for the DReps no earlier pass named or found asking not to be listed.
    for (let wanted = ids; passes < PASSES && wanted.length; wanted = stillWanted(ids, named, unlisted)) {
      if (passes++) await new Promise((r) => setTimeout(r, PASS_GAP_MS));
      for (let i = 0; i < wanted.length; i += IDS_PER_REQUEST) {
        const rows = await koios(network, "drep_metadata", {
          body: { _drep_ids: wanted.slice(i, i + IDS_PER_REQUEST) },
          query: METADATA_SELECT,
        });
        requests++;
        readRows(rows, named, unlisted);
      }
    }
    const { dreps, kept, gone, left } = listOf(network, { ids, named, unlisted, committed });
    const out = { recorded: new Date().toISOString().slice(0, 10), dreps };
    // One DRep a line keeps a release's changes readable in a diff.
    const body = `{\n  "recorded": "${out.recorded}",\n  "dreps": [\n${dreps.map((d) => `    ${JSON.stringify(d)}`).join(",\n")}\n  ]\n}\n`;
    writeFileSync(`${dir}${network}.json`, body);
    console.log(
      `${network}: ${ids.length} registered DReps, ${dreps.length} named (${requests} drep_metadata requests in ${passes} ` +
        `passes; ${kept} kept as committed, no Koios server naming them now; ${gone} committed no longer registered; ` +
        `${unlisted.size} asking not to be listed, left out, ${left} of them committed), ` +
        `${Math.round(body.length / 1024)} KB -> src/dreps/${network}.json`,
    );
  }
}
