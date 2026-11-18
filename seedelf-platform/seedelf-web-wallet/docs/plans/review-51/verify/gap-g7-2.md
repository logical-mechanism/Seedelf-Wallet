# gap-g7#2: verification

From lane gap-G7, graded low by its finder.

## Trace: confirmed, low

I traced it from the form to the vote page and found no guard the finder missed.

1. Become a DRep's profile form starts with doNotList on.
2. WebAssembly writes `"doNotList": true` into the CIP-119 body.
3. The release script `npm run dreps` asks Koios only for `givenName`, so it never sees doNotList, and it bundles every registered DRep that has a name.
4. The bundle holds `[id, name]` pairs only, so no runtime filter could act on the flag.
5. Voting's DrepSearch lists every bundled entry on an empty search.
6. The release step's "skim the diff" can't catch it, because the field is never fetched.

So a user's DRep whose profile asks DRep directories not to list it, as the wallet's own note promises ("Directories for delegators are asked not to list yours"), is listed by name in every Seedelf Wallet's directory after the next release. The same goes for every other DRep that set doNotList. The committed-name fallback (dreps.mjs:107-112) also keeps such a DRep listed later.

Grade: low.
- **Who:** the user, by an ordinary action. The profile is opt-in (off by default), and doNotList is the form's default inside it.
- **Cost:** no money moves and no address-to-address link is made, since the DRep, its name and its profile are public anyway (privacy.md:299). The cost is the user's stated listing preference overridden in the wallet's own directory: the DRep can be browsed and delegated to by anyone using the wallet.
- **Way out:** delegators need none. The DRep has none inside the wallet. Even dropping its profile later keeps the committed name while it stays registered (dreps.mjs:107-112), so only retiring, or the maintainer editing the list by hand, removes it.

Not known: nothing in the backlog, the Declined list, the archived reviews' Not fixed lists, the owner's rules or SECURITY.md covers the bundled list honouring doNotList.

**Evidence:**

The trace (TREE = /home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51, paths under seedelf-platform/seedelf-web-wallet/):

1. **The form's default.** extension/src/ui/screens/Governance.tsx:561 `const EMPTY_PROFILE: DrepProfileRequest = { givenName: "", objectives: "", motivations: "", qualifications: "", doNotList: true };`. The switch is at :685-697 and its note is en.json drep.form.doNotListOn: "Directories for delegators are asked not to list yours. Anyone can still look it up."
2. **The worker passes it unchanged.** Governance.tsx:624 `call("drep-profile", { profile })` goes to handlers.ts:342-343, then background/governance.ts:212 `JSON.parse(deps.wasm.drepProfile(JSON.stringify(profile)))`.
3. **WebAssembly writes the flag.** wasm/src/lib.rs:484-486 `if request.do_not_list { body.insert("doNotList".into(), true.into()); }`, and :514 maps `"doNotList": "CIP119:doNotList"`. rpc.ts:546 and lib.rs:440 define it as "asks DRep directories not to list it".
4. **The generator never reads it.** extension/scripts/dreps.mjs:80-81 lists every registered DRep (`registered=eq.true&select=drep_id`). :94-96 asks drep_metadata with `query: "select=drep_id,meta_json->body->givenName"`. :99-101 keeps every row that has a name. :107-112 keeps a committed name for any registered DRep no pass names. :120-125 writes `[id, name]` pairs to src/dreps/<network>.json. No line in the script mentions doNotList: `grep doNotList` over the tree finds only the form, rpc.ts, lib.rs, the translations and tests.
5. **The bundle is a browsable directory.** extension/src/ui/dreps.ts:7-8 imports the JSON, and :22-25 keeps only id and name. :36-38 `searchDreps`: `if (!q) return dreps;`. Voting.tsx:236-252: picking "A DRep" renders DrepSearch. :317-319 `found = searchDreps(dreps, query)`, shown 20 a page with Show more (:28-29, :363-368). The only consumers of the bundle are Voting.tsx:103 and :317 and activity.ts:119.
6. **The release step is blind to it.** docs/development.md:330, step 3: "rewrites src/dreps/<network>.json with every registered DRep that has a name … Skim the diff". The diff can't show doNotList because the field is never fetched.

Since: the generator came in e8e43ec7 (2026-09-24, chunk 13), and the form's `doNotList: true` default in 5969dd7a (2026-10-04, chunk 21; `git log -S'doNotList: true'`).

**Test run on TREE** (`timeout 10m npx vitest run tests/r51-gap-g7-2.test.ts`, under a MemoryMax=8G scope): 2 failed. Both fail with `AssertionError: preprod: the vote page's list offers a doNotList DRep: expected [ …(32) ] to not include 'drep1yge35jc6a9mecapmgj6nqzuwdv3v73f4…'`. The earlier assertions passed: the wallet wrote `{givenName, objectives, doNotList: true}`, all 31 listable DReps came through by name, and only the two drep_* endpoints were asked. So the fake answers as Koios does, and the only failure is the doNotList DRep being listed.

**Fix check, in a copy** under ~/.cache/seedelf-review-51/ (removed afterwards; TREE's tracked files unchanged, per `git status`). I applied the finder's fix to the copy's dreps.mjs: select `meta_json->body->doNotList`, skip a DRep that says true, exclude it from later passes, from the committed fallback and from the loss count. Both tests pass. With the committed-fallback exclusion reverted, the second test fails again with the same message, so it catches a half fix.

`tsc --noEmit` reports no error in this file; the 11 errors it reports are all in other verifiers' r51 tests.

**Known:** None. I searched for 'doNotList', 'not to list', 'do not list', 'director', 'dreps.mjs', 'npm run dreps', 'drep list', 'profile' and 'drep' in:
- docs/backlog.md: none, including its Declined list and open calls.
- docs/archive/plans/: only usability-review.md GV-9, which fixed the switch's copy; privacy-review.md:907, where the DRep list shipping with the wallet is about reads, not listing; and chunk-13-staking.md:19 and :106, whose "bundles every registered DRep with a name" predates doNotList (chunk 21) and is a design line, not a leftover.
- docs/plans/: release-records.md only counts named DReps; review-51 has only this finding's own INDEX line and D1's checked line on the form's defaults.
- docs/privacy.md:299 (on by default), flows.md:315 and development.md:330: none says the wallet's own list honours it.
- SECURITY.md: no out-of-scope item applies. Koios answers truthfully; the script simply never asks for the field.

The owner's rules don't settle it either. The private default argues for honouring it, and leaving such a DRep off the list isn't a refusal, since a pasted ID is still looked up live (Voting.tsx:321).

**Fix notes:**

Fix it in scripts/dreps.mjs, as the finder sketched; my copy check confirms that fix works.
- Select `meta_json->body->doNotList` beside givenName, and read the JSON-LD `{"@value": true}` form as nameOf reads givenName.
- Keep a DRep that says true in its own set. Leave it out of later passes, out of the committed-name fallback at :107-112 (the trap the second test pins), and out of the MAX_LOSS count, so a refresh that drops one isn't refused as Koios failing.
- Factor the row filter into a pure exported function so a unit test can pin it beside this integration test.

After the fix:
- Run `npm run dreps` once and read the diff: it shows how many DReps in today's lists asked not to be listed. That's the lookup the finder couldn't make offline.
- Update the words: dreps.mjs's header ("every registered DRep whose CIP-119 metadata gives a name"), ui/dreps.ts's header and development.md:330, step 3.

A side effect for the owner: Activity (activity.ts:118-129) and Delegations (Delegations.tsx:68) name DReps from the same bundle. Once a doNotList DRep is dropped, a user's past delegation to it shows by short ID instead of its name. Shipping those names in a separate, never-browsed map would keep them, but that's a design call.

It needs the owner, because it changes what the vote page's list offers. Pasting an ID keeps working, since Voting.tsx:321 looks up any whole ID live.

I couldn't check CIP-119's own wording offline. The semantics rest on the wallet's own definition (rpc.ts:546, lib.rs:440, en.json drep.form.doNotListOn/Off, which names GovTool as such a directory).

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g7-2.test.ts`

Result: On TREE, it fails as expected. Command: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g7-2.test.ts`, from extension/.

```
 RUN  v5.0.3 .../Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension
 ❯ tests/r51-gap-g7-2.test.ts (2 tests | 2 failed) 297ms
   ❯ npm run dreps and CIP-119's doNotList (gap-g7#2) (2)
     × leaves out a DRep whose profile, as the wallet's form writes it by default, asks not to be listed 128ms
     × drops it from a committed list that named it, once a refresh reads its profile 127ms
 FAIL  ... > leaves out a DRep whose profile, as the wallet's form writes it by default, asks not to be listed
AssertionError: preprod: the vote page's list offers a doNotList DRep: expected [ …(32) ] to not include 'drep1yge35jc6a9mecapmgj6nqzuwdv3v73f4…'
 ❯ expectListedButMine tests/r51-gap-g7-2.test.ts:267:119
 FAIL  ... > drops it from a committed list that named it, once a refresh reads its profile
AssertionError: preprod: the vote page's list offers a doNotList DRep: expected [ …(32) ] to not include 'drep1yge35jc6a9mecapmgj6nqzuwdv3v73f4…'
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

Everything before the failing line passed: the script ran under the fake Koios, the wallet-written body is `{givenName, objectives, doNotList: true}`, and all 31 listable DReps are listed by name.

In a copy with the finder's fix applied to dreps.mjs (selecting `meta_json->body->doNotList`, skipping DReps that say true, excluding them from later passes, the committed fallback and the loss count), the result is `Test Files 1 passed (1) / Tests 2 passed (2)`.

With only the committed-fallback exclusion reverted in that copy, the result is `Tests 1 failed | 1 passed (2)`. The committed-list case fails with the same assertion.

The copy is removed. Only the test file is new in TREE, and it typechecks.

```
// Chunk 51, gap-g7#2: a DRep whose CIP-119 profile asks DRep directories not to list it is listed by name anyway in
// the wallet's own directory, the vote page's DRep list.
//
// The path. Become a DRep's profile form starts from EMPTY_PROFILE, `doNotList: true` (Governance.tsx:561), and says
// "Directories for delegators are asked not to list yours". The worker hands it to WebAssembly as it is
// (background/governance.ts:212), whose drepProfile writes `"doNotList": true` into the file's body (wasm
// lib.rs:484-486). Once the user publishes the file and registers, Koios's drep_metadata holds that document as
// meta_json. At the next release `npm run dreps` (scripts/dreps.mjs) asks drep_metadata for
// `meta_json->body->givenName` alone (:96) and writes every registered DRep with a name into
// src/dreps/<network>.json, and a DRep the committed list names keeps that name when no pass names it (:107-112).
// ui/dreps.ts bundles the file, and Voting's DrepSearch shows every entry on an empty search, 20 a page.
//
// Each case runs a copy of TREE's scripts/ (so nothing is written into the tree) in a fresh node whose fetch is a
// fake Koios: drep_list and drep_metadata answered from a fixture as PostgREST answers them, for whatever columns and
// filters the script asks for. Nothing leaves the machine: any other request is a 404, and the script stops. Timers
// fire at once, so the passes' 15 s gaps and the retries don't wait.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as wasm from "@seedelf/wasm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { searchDreps } from "../src/ui/dreps";

const extension = fileURLToPath(new URL("..", import.meta.url));
const NETWORKS = ["preprod", "mainnet"] as const;

/** The fake Koios, loaded before the script with `node --import`. */
const FAKE_KOIOS = String.raw`
import { appendFileSync, readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(process.env.R51_FAKE_KOIOS, "utf8"));
const BASES = ["https://preprod.koios.rest/api/v1/", "https://api.koios.rest/api/v1/"];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);

const textOf = (v) => (v === null ? null : typeof v === "string" ? v : JSON.stringify(v));
const not3 = (r) => (r === null ? null : !r);

// "alias:column->key->>key::cast", as PostgREST reads a select item or a filter's column.
function pathOf(item) {
  const m = /^(?:([A-Za-z_]\w*):(?!:))?(.+?)(?:::\w+)?$/.exec(item);
  const parts = m[2].split(/(->>|->)/);
  const steps = [];
  for (let i = 1; i < parts.length; i += 2) steps.push({ text: parts[i] === "->>", key: parts[i + 1] });
  return { name: m[1] ?? (steps.length ? steps[steps.length - 1].key : parts[0]), column: parts[0], steps };
}

function valueAt(row, { column, steps }) {
  let v = row[column] ?? null;
  for (const { text, key } of steps) {
    if (v === null || typeof v !== "object") return null;
    v = (Array.isArray(v) ? v[Number(key)] : v[key]) ?? null;
    if (text) v = textOf(v);
  }
  return v;
}

// One comparison, in SQL's three values: true, false and null (unknown).
function compare(v, op, operand) {
  switch (op) {
    case "is":
      if (operand === "null") return v === null;
      if (operand === "true" || operand === "false") return textOf(v) === operand;
      break;
    case "eq":
      return v === null ? null : textOf(v) === operand;
    case "neq":
      return v === null ? null : textOf(v) !== operand;
    case "isdistinct":
      return operand === "null" ? v !== null : v === null || textOf(v) !== operand;
    case "in":
      return v === null ? null : operand.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")).includes(textOf(v));
  }
  throw new Error("fake Koios: unsupported operator " + op + "." + operand);
}

function condition(row, column, expr) {
  const negate = expr.startsWith("not.");
  const rest = negate ? expr.slice(4) : expr;
  const dot = rest.indexOf(".");
  const r = compare(valueAt(row, pathOf(column)), rest.slice(0, dot), rest.slice(dot + 1));
  return negate ? not3(r) : r;
}

function splitTop(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

function logical(row, kind, inner) {
  const results = splitTop(inner).map((item) => {
    const m = /^(not\.)?(or|and)\((.*)\)$/.exec(item);
    if (m) return m[1] ? not3(logical(row, m[2], m[3])) : logical(row, m[2], m[3]);
    const dot = item.indexOf(".");
    return condition(row, item.slice(0, dot), item.slice(dot + 1));
  });
  if (kind === "or") return results.includes(true) ? true : results.includes(null) ? null : false;
  return results.includes(false) ? false : results.includes(null) ? null : true;
}

// PostgREST's horizontal filters, select, order, offset and limit, over whole rows.
function answer(rows, params) {
  let out = rows;
  for (const [key, value] of params) {
    if (["select", "order", "offset", "limit"].includes(key)) continue;
    const m = /^(not\.)?(or|and)$/.exec(key);
    out = out.filter((row) => {
      if (!m) return condition(row, key, value) === true;
      const r = logical(row, m[2], value.replace(/^\(|\)$/g, ""));
      return (m[1] ? not3(r) : r) === true;
    });
  }
  const order = params.get("order");
  if (order) {
    const keys = order.split(",").map((o) => {
      const [column, direction] = o.split(".");
      return { path: pathOf(column), sign: direction === "desc" ? -1 : 1 };
    });
    out = [...out].sort((a, b) => {
      for (const { path, sign } of keys) {
        const x = textOf(valueAt(a, path)) ?? "";
        const y = textOf(valueAt(b, path)) ?? "";
        if (x !== y) return (x < y ? -1 : 1) * sign;
      }
      return 0;
    });
  }
  const offset = Number(params.get("offset") ?? 0);
  out = out.slice(offset, params.has("limit") ? offset + Number(params.get("limit")) : undefined);
  const select = params.get("select");
  if (!select || select === "*") return out;
  const items = splitTop(select).map(pathOf);
  return out.map((row) => Object.fromEntries(items.map((item) => [item.name, valueAt(row, item)])));
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  appendFileSync(process.env.R51_FAKE_KOIOS_LOG, (init.method ?? "GET") + " " + url + "\n");
  const base = BASES.find((b) => url.startsWith(b));
  const { pathname, searchParams } = new URL(url);
  const endpoint = base ? pathname.slice(new URL(base).pathname.length) : undefined;
  try {
    if (endpoint === "drep_list") {
      return Response.json(answer(fixture.dreps.map((d) => ({ drep_id: d.id, has_script: false, registered: true, deposit: "500000000", active: true })), searchParams));
    }
    if (endpoint === "drep_metadata") {
      const wanted = new Set(JSON.parse(init.body)._drep_ids);
      const rows = fixture.dreps
        .filter((d) => wanted.has(d.id) && d.meta)
        .map((d) => ({ drep_id: d.id, has_script: false, meta_url: "ipfs://" + d.id, meta_hash: "00".repeat(32), meta_json: d.meta, is_valid: true }));
      return Response.json(answer(rows, searchParams));
    }
  } catch (e) {
    return new Response(String(e.message), { status: 400 });
  }
  return new Response("fake Koios: nothing here", { status: 404 });
};
`;

/** A CIP-129-shaped ID: the script treats IDs as opaque text, so no checksum is needed. */
function idOf(seed: string): string {
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const digest = [...createHash("sha256").update(seed).digest()];
  return `drep1y${[...digest, ...digest].slice(0, 52).map((b) => alphabet[b % 32]).join("")}`;
}

/** The profile file the wallet writes (WebAssembly's drepProfile), as Koios's meta_json holds it. */
const walletProfile = (request: object) =>
  JSON.parse((JSON.parse(wasm.drepProfile(JSON.stringify(request))) as { file: string }).file) as {
    body: Record<string, unknown>;
  };

interface Drep {
  id: string;
  name?: string;
  meta?: unknown;
}

let tmp = "";
let ordinary: Drep[] = [];
let mine: Drep = { id: "" };
let fixture: { dreps: Drep[] } = { dreps: [] };

beforeAll(() => {
  wasm.initSync({ module: readFileSync(new URL("../../wasm/pkg/seedelf_wasm_bg.wasm", import.meta.url)) });
  tmp = mkdtempSync(join(tmpdir(), "r51-gap-g7-2-"));
  // DReps whose profiles let directories list them: the wallet's form with the switch off, and another tool's
  // profile that says false outright.
  ordinary = Array.from({ length: 30 }, (_, i) => {
    const name = `Listed DRep ${String(i + 1).padStart(2, "0")}`;
    return { id: idOf(name), name, meta: walletProfile({ givenName: name, objectives: "Votes in the open", doNotList: false }) };
  });
  ordinary.push({
    id: idOf("Says false"),
    name: "Says false",
    meta: { hashAlgorithm: "blake2b-256", body: { givenName: "Says false", doNotList: false } },
  });
  // The user's own DRep, its profile written with the form's defaults.
  mine = { id: idOf("Private DRep"), meta: walletProfile({ givenName: "Private DRep", objectives: "My own stake", doNotList: true }) };
  // Registered with no profile: never named.
  const bare = [1, 2, 3].map((i) => ({ id: idOf(`no profile ${i}`) }));
  fixture = { dreps: [...ordinary, mine, ...bare] };
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** `npm run dreps` on a copy of scripts/ against the fake Koios, `committed` as the committed lists: what it wrote. */
function refresh(name: string, committed?: string[][]) {
  const root = join(tmp, name);
  cpSync(join(extension, "scripts"), join(root, "scripts"), { recursive: true });
  cpSync(join(extension, "package.json"), join(root, "package.json"));
  symlinkSync(join(extension, "node_modules"), join(root, "node_modules"), "dir");
  mkdirSync(join(root, "src", "dreps"), { recursive: true });
  for (const network of NETWORKS) {
    if (committed) writeFileSync(join(root, "src", "dreps", `${network}.json`), JSON.stringify({ recorded: "2026-11-10", dreps: committed }));
  }
  writeFileSync(join(root, "fake-koios.mjs"), FAKE_KOIOS);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(fixture));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    R51_FAKE_KOIOS: join(root, "fixture.json"),
    R51_FAKE_KOIOS_LOG: join(root, "requests.log"),
  };
  delete env.NODE_OPTIONS;
  const run = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(join(root, "fake-koios.mjs")).href, join(root, "scripts", "dreps.mjs")],
    { cwd: root, env, encoding: "utf8", timeout: 60_000 },
  );
  expect(run.status, `dreps.mjs under the fake Koios:\n${run.stdout}\n${run.stderr}`).toBe(0);
  const asked = readFileSync(join(root, "requests.log"), "utf8").trim().split("\n");
  // It asked only the two endpoints the fake answers, on both networks.
  expect(asked.every((line) => /^(GET|POST) https:\/\/(preprod\.koios\.rest|api\.koios\.rest)\/api\/v1\/drep_(list|metadata)\b/.test(line))).toBe(true);
  return Object.fromEntries(
    NETWORKS.map((network) => {
      const file = JSON.parse(readFileSync(join(root, "src", "dreps", `${network}.json`), "utf8")) as { dreps: string[][] };
      return [network, file.dreps];
    }),
  ) as Record<(typeof NETWORKS)[number], string[][]>;
}

function expectListedButMine(lists: Record<(typeof NETWORKS)[number], string[][]>) {
  for (const network of NETWORKS) {
    const entries = lists[network].map(([id, name]) => ({ id: id!, name: name! }));
    // Every DRep whose profile lets directories list it is there by its name: the fake answers as Koios does.
    expect(entries).toEqual(expect.arrayContaining(ordinary.map(({ id, name }) => ({ id, name }))));
    // The one whose profile asks directories not to list it isn't: not on an empty search, not by its name.
    expect(searchDreps(entries, "").map((d) => d.id), `${network}: the vote page's list offers a doNotList DRep`).not.toContain(mine.id);
    expect(searchDreps(entries, "Private DRep"), `${network}: a search by name finds a doNotList DRep`).toEqual([]);
    expect(entries).toHaveLength(ordinary.length);
  }
}

describe("npm run dreps and CIP-119's doNotList (gap-g7#2)", () => {
  it("leaves out a DRep whose profile, as the wallet's form writes it by default, asks not to be listed", { timeout: 90_000 }, () => {
    // What Become a DRep's profile writes with its switch as it starts.
    expect((mine.meta as { body: Record<string, unknown> }).body).toEqual({ givenName: "Private DRep", objectives: "My own stake", doNotList: true });
    expectListedButMine(refresh("fresh"));
  });

  it("drops it from a committed list that named it, once a refresh reads its profile", { timeout: 90_000 }, () => {
    // A release before the fix listed it; a refresh must not keep it as committed.
    const committed = [...ordinary.map(({ id, name }) => [id, name!]), [mine.id, "Private DRep"]];
    expectListedButMine(refresh("committed", committed));
  });
});
```
