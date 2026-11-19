// `npm run lovejoin-registry` names each mainnet v2 pool the head start bundles for Cardanoscan, four entries a pool
// (scripts/lovejoin-registry.mjs); Strica's registry also tells cardano.org's leaderboard which transactions are
// Lovejoin's. Only v2's pools are named (the owner, 2026-11-19): the head start still lists 8131b1d's 5 ₳ pool, so wallets
// find their boxes there, and the run used to name it, so a release after Strica dropped it would have sent it back.
// Before that, v2's 5 ₳ pool took the 8131b1d 5 ₳ pool's names and linked 8131b1d's contracts (1.8.0's release review,
// D3), so v2's names keep their "v2". The script is never run here, nor the owner's fork touched. Its naming is imported
// (the script runs only as node's main) and fed the views WebAssembly gives mainnet's two bundled 5 ₳ pools.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { commitsOf, entriesOf, MAX_NAME, RETIRED, SETS, TEMPLATES, valueOf, type PoolView } from "../scripts/lovejoin-registry.mjs";
import bundled from "../src/lovejoin-pools.json";
import { loadTestWasm } from "./fakes";

const SCRIPT = readFileSync(new URL("../scripts/lovejoin-registry.mjs", import.meta.url), "utf8");
const commits = commitsOf(readFileSync(TEMPLATES, "utf8"));
const wasm = loadTestWasm();
const verify = (pool: unknown) =>
  JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network: "mainnet", pool }))) as PoolView;

// Mainnet's 5 ₳ ADA pools as the head start bundles them: v2's, and 8131b1d's, retired since 1.8.0.
const fivePools = bundled.mainnet.pools.filter((p) => p.boxLovelace === "5000000").map((p) => verify(p.ref));
const v2 = fivePools.find((view) => view.version === "v2")!;
const old = fivePools.find((view) => view.version === "tokenV1")!;
const names = (view: PoolView) => entriesOf(view, valueOf(view, {}), commits).map((c) => c.name);

describe("lovejoin-registry's entries: v2's pools alone (the owner, 2026-11-19)", () => {
  it("names a v2 pool's four scripts as Strica's file holds them: its set in each name, version 3", () => {
    expect(v2.id).toBe("fcb3f5ec5f58d8fc31cf60408b77a1fe4f431880dc810bd12e8a9aa2");
    expect(valueOf(v2, {})).toBe("5 ADA");
    expect(names(v2)).toEqual(["Mix Box v2 (5 ADA)", "Mix Logic v2 (5 ADA)", "Fee Pool v2 (5 ADA)", "Reference Minter v2 (5 ADA)"]);
    for (const n of names(v2)) expect(n.length).toBeLessThanOrEqual(MAX_NAME);
    // Each entry is the script it names: the pool's own four, as WebAssembly derived them from its seed, the four
    // Strica's PR #74 added.
    const entries = entriesOf(v2, "5 ADA", commits);
    expect(entries.map((c) => c.scriptHash)).toEqual([v2.mixBoxHash, v2.mixLogicHash, v2.feeHash, v2.id]);
    expect(entries.map((c) => c.scriptHash)).toEqual([
      "dd94113cc07cbe0f0c331c9ba10477795ca90bfb1e3e348b40d15a31",
      "a6a85074e56cf486a1c6620181902cf4726a7f5bb11878ae23eb99f5",
      "616001e596dd1559b7a03e588d5c252ae2c9b9bb3127b109fd90246a",
      "fcb3f5ec5f58d8fc31cf60408b77a1fe4f431880dc810bd12e8a9aa2",
    ]);
    expect(new Set(entries.map((c) => c.version))).toEqual(new Set([3]));
    expect(SETS.v2.version).toBe(3);
  });

  it("never names a pool on a retired set, though the head start lists 8131b1d's 5 ₳ pool for its boxes", () => {
    expect(old.id).toBe("dc6abe3b0b184e09d11cfa918f7b57cde9ea1f61c49700894d3fe117");
    expect(RETIRED).toEqual(["tokenV1"]);
    expect(Object.keys(SETS)).toEqual(["v2"]);
    expect(() => entriesOf(old, "5 ADA", commits)).toThrow("Nothing written");
    // The run skips such a pool before its check of the set, which would stop it, and adds nothing for it.
    const skip = SCRIPT.indexOf("if (view.id === pool.id && RETIRED.includes(view.version)) {");
    const stop = SCRIPT.indexOf("!Object.hasOwn(SETS, view.version)) throw new Error(`${pool.id} verifies as");
    expect(skip).toBeGreaterThan(0);
    expect(stop).toBeGreaterThan(skip);
    expect(SCRIPT.slice(skip, stop)).toContain("skipped.push(view);\n      return [];");
  });

  it("links v2's contracts, at the commit core pins it to", () => {
    expect(Object.keys(commits)).toEqual(["v2"]);
    expect(commits.v2.startsWith("29573c5")).toBe(true);
    const entries = entriesOf(v2, "5 ADA", commits);
    expect(new Set(entries.map((c) => c.github))).toEqual(new Set([`https://github.com/logical-mechanism/Lovejoin/tree/${commits.v2.slice(0, 12)}/contracts`]));
    // The registry's link limit.
    for (const c of entries) expect(c.github.length).toBeLessThanOrEqual(100);
  });

  it("refuses a pool on a set it doesn't name, rather than name it as another's", () => {
    expect(() => entriesOf({ ...v2, version: "v3" }, "5 ADA", commits)).toThrow("Nothing written");
    expect(() => entriesOf({ ...v2, version: "toString" }, "5 ADA", commits)).toThrow("Nothing written");
    expect(() => entriesOf({ ...v2, version: "tokenV1" }, "5 ADA", commits)).toThrow("Nothing written");
  });

  it("runs nothing when it's imported: what reads WebAssembly, the bundled list or the fork is the run's alone", () => {
    const run = SCRIPT.indexOf("if (process.argv[1] === fileURLToPath(import.meta.url)) {");
    expect(run).toBeGreaterThan(0);
    for (const reads of ["await import(", "initSync", "readFileSync(POOLS", "readFileSync(TOKENS", "process.argv[2]", "writeFileSync(target"]) {
      expect(SCRIPT.indexOf(reads), reads).toBeGreaterThan(run);
    }
  });
});
