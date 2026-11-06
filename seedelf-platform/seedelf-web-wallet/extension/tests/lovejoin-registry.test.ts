// `npm run lovejoin-registry` names each mainnet pool the head start bundles for Cardanoscan, four entries a pool
// (scripts/lovejoin-registry.mjs). Once a head start bundles a v2 pool it threw at it, writing nothing for any pool; past
// that, it named v2's 5 ₳ pool's scripts as the 8131b1d 5 ₳ pool's, which the registry's file refuses twice, and linked
// 8131b1d's contracts for v2's mix_logic (1.8.0's release review, D3). Read as that review read it: the script is never
// run here, nor the owner's fork touched. Its naming is imported (the script runs only as node's main) and fed the views
// WebAssembly gives each set's 5 ₳ ADA pool.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { commitsOf, entriesOf, MAX_NAME, SETS, TEMPLATES, valueOf, type PoolView } from "../scripts/lovejoin-registry.mjs";
import bundled from "../src/lovejoin-pools.json";
import { loadTestWasm } from "./fakes";
import { ADA_POOL } from "./v2-pools";

const SCRIPT = readFileSync(new URL("../scripts/lovejoin-registry.mjs", import.meta.url), "utf8");
const commits = commitsOf(readFileSync(TEMPLATES, "utf8"));
const wasm = loadTestWasm();
const verify = (network: "preprod" | "mainnet", pool: unknown) =>
  JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network, pool }))) as PoolView;

// v2's 5 ₳ ADA pool (the tests' stand-in, on preprod), and mainnet's 5 ₳ ADA pool on 8131b1d's set, which the head
// start has bundled since 1.7.0 and whose four entries 1.7.0's run wrote into the fork.
const v2 = verify("preprod", ADA_POOL);
const old = verify("mainnet", bundled.mainnet.pools.find((p) => p.boxLovelace === "5000000")!.ref);
const names = (view: PoolView) => entriesOf(view, valueOf(view, {}), commits).map((c) => c.name);

describe("lovejoin-registry's entries (1.8.0's release review, D3)", () => {
  it("takes a v2 pool, and names its set in its four entries, so they never meet the 8131b1d pool of its value's", () => {
    expect([v2.version, old.version]).toEqual(["v2", "tokenV1"]);
    expect([valueOf(v2, {}), valueOf(old, {})]).toEqual(["5 ADA", "5 ADA"]);
    expect(names(v2)).toEqual(["Mix Box v2 (5 ADA)", "Mix Logic v2 (5 ADA)", "Fee Pool v2 (5 ADA)", "Reference Minter v2 (5 ADA)"]);
    // 8131b1d's keep the names its entries were written under.
    expect(names(old)).toEqual(["Mix Box (5 ADA)", "Mix Logic (5 ADA)", "Fee Pool (5 ADA)", "Reference Minter (5 ADA)"]);
    expect(names(v2).filter((n) => names(old).includes(n))).toEqual([]);
    for (const n of [...names(v2), ...names(old)]) expect(n.length).toBeLessThanOrEqual(MAX_NAME);
    // Each entry is the script it names: the pool's own four, as WebAssembly derived them from its seed.
    const hashes = entriesOf(v2, "5 ADA", commits).map((c) => c.scriptHash);
    expect(hashes).toEqual([v2.mixBoxHash, v2.mixLogicHash, v2.feeHash, v2.id]);
  });

  it("links each set's own contracts, at the commit core pins it to, under a registry version of its own", () => {
    expect(commits.v2.startsWith("29573c5")).toBe(true);
    expect(commits.tokenV1.startsWith("8131b1d")).toBe(true);
    const [newer, older] = [entriesOf(v2, "5 ADA", commits), entriesOf(old, "5 ADA", commits)];
    expect(new Set(newer.map((c) => c.github))).toEqual(new Set([`https://github.com/logical-mechanism/Lovejoin/tree/${commits.v2.slice(0, 12)}/contracts`]));
    expect(new Set(older.map((c) => c.github))).toEqual(new Set([`https://github.com/logical-mechanism/Lovejoin/tree/${commits.tokenV1.slice(0, 12)}/contracts`]));
    // The registry's link limit.
    for (const c of [...newer, ...older]) expect(c.github.length).toBeLessThanOrEqual(100);
    // The classic pool's are 1 and 8131b1d's 2, as the fork has them; v2's are a version apart.
    expect([newer[0]!.version, older[0]!.version]).toEqual([SETS.v2.version, SETS.tokenV1.version]);
    expect(SETS.v2.version).not.toBe(SETS.tokenV1.version);
    expect(SETS.tokenV1.version).toBe(2);
  });

  it("refuses a pool on a set it doesn't name, rather than name it as another's", () => {
    expect(() => entriesOf({ ...v2, version: "v3" }, "5 ADA", commits)).toThrow("Nothing written");
    expect(() => entriesOf({ ...v2, version: "toString" }, "5 ADA", commits)).toThrow("Nothing written");
    // The run's own check of each pool takes the same sets, and nothing else.
    expect(SCRIPT).toContain("!Object.hasOwn(SETS, view.version)) throw new Error(`${pool.id} verifies as");
  });

  it("runs nothing when it's imported: what reads WebAssembly, the bundled list or the fork is the run's alone", () => {
    const run = SCRIPT.indexOf("if (process.argv[1] === fileURLToPath(import.meta.url)) {");
    expect(run).toBeGreaterThan(0);
    for (const reads of ["await import(", "initSync", "readFileSync(POOLS", "readFileSync(TOKENS", "process.argv[2]", "writeFileSync(target"]) {
      expect(SCRIPT.indexOf(reads), reads).toBeGreaterThan(run);
    }
  });
});
