// Cardanoscan's labels for Lovejoin's token pools. Cardanoscan names a script
// only by its hash, from Strica's cardano-contracts-registry, where Lovejoin's
// entries are `projects/lovejoin.json` (the owner's fork of it, beside this
// repository). The same registry tells cardano.org's transaction leaderboard
// which transactions are Lovejoin's. Every token pool has four scripts of its
// own, made from one of the pinned template sets (seedelf-core's
// lovejoin/templates.rs) and its launch's seed: its reference token's policy
// (P, the pool's id), mix_logic, mix_box and fee_contract. So a pool stays
// unnamed there until its four hashes are added.
// Run at each release, after `npm run lovejoin-pools`: it reads that bundled
// list, which holds only the pools the wallet shows.
//
//   node scripts/lovejoin-registry.mjs                  print the entries mainnet's pools make
//   node scripts/lovejoin-registry.mjs <lovejoin.json>  add the new ones to the fork's file
//
// Only v2's pools (29573c5, chunk 44) are named: the registry tracks the pools
// people should use, and every new pool is v2 (the owner, 2026-11-19). A pool on
// a retired set (8131b1d's, `tokenV1`) is skipped, and a line says so. The head
// start still lists one, so a wallet finds its boxes there to bring them back,
// but the registry never names it. Strica's file dropped the classic pool's
// entries and never took the 8131b1d pool's (Strica's PR #74, 2026-11-19). It
// keeps the reference holder, which holds every pool's reference token, v2's
// included.
//
// Each pool is verified again through WebAssembly (lovejoinVerifyPool, so
// wasm/pkg must be built), which derives its four scripts from its seed on the
// set its datum names. Its entries are named for its value, with v2's: the
// box's token and ADA ("Mix Box v2 (1,000 SNEK + 4 ADA)"), or its ADA alone
// ("Mix Box v2 (5 ADA)"), as version 3 in the registry, and link 29573c5's
// contracts. The "v2" and the version 3 are what Strica's file already holds,
// from when 8131b1d's pools were named too (1.8.0's release review, D3).
//
// The file is only added to. The entries written by hand (the project and the
// reference holder) are left alone, and an entry already there stays as it
// is, even once its pool is no longer listed (its token left the list): it's
// named in a warning, never removed, as its label is still true. With no new
// pool, the file isn't touched. A pool that doesn't verify, one on a set this
// neither names nor knows as retired, a token with no ticker, or a name over
// the registry's limits stops it with nothing written.
//
// What names a pool is exported for tests/lovejoin-registry.test.ts, which
// never runs this: the rest runs only when node runs this file.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const NETWORK = "mainnet";
const POOLS = new URL("../src/lovejoin-pools.json", import.meta.url);
const TOKENS = new URL(`../src/tokens/registry.${NETWORK}.json`, import.meta.url);
export const TEMPLATES = new URL("../../../seedelf-core/src/lovejoin/templates.rs", import.meta.url);
const PKG = new URL("../../wasm/pkg/", import.meta.url);
/** The registry's limits: its README's (its validator allows a 50-character name). */
export const MAX_NAME = 45;
export const MAX_DESCRIPTION = 140;

/**
 * The template sets whose pools are named, by the version WebAssembly verifies a pool as (`lovejoin::PoolView`): the
 * constant in templates.rs that pins its commit, what its entries' names add to the pool's value, and its version in
 * the registry. v2's alone.
 */
export const SETS = {
  v2: { commit: "COMMIT_V2", label: " v2", version: 3 },
};

/** The retired sets: a pool on one is skipped, never named. 8131b1d's, withdraw-only since 1.8.0. */
export const RETIRED = ["tokenV1"];

/** Each set's commit, by set, read from templates.rs's source (`source`). */
export function commitsOf(source) {
  return Object.fromEntries(
    Object.entries(SETS).map(([set, { commit }]) => {
      const found = new RegExp(`pub const ${commit}: &str = "([0-9a-f]{40})"`).exec(source)?.[1];
      if (!found) throw new Error(`No ${commit} in seedelf-core/src/lovejoin/templates.rs.`);
      return [set, found];
    }),
  );
}

/** `units` with `decimals` places, as the wallet writes amounts: en-US grouping, no trailing zeros. */
export function amount(units, decimals) {
  const n = BigInt(units);
  const scale = 10n ** BigInt(decimals);
  const fraction = decimals ? (n % scale).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${(n / scale).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** What a pool's boxes each hold, by the ticker and decimals `npm run tokens` wrote. */
export function valueOf(view, tokens) {
  const ada = `${amount(view.boxLovelace, 6)} ADA`;
  if (!view.token) return ada;
  const unit = `${view.token.policyId}.${view.token.assetName}`;
  const known = tokens[unit];
  if (!known?.ticker) throw new Error(`${view.id}: its token ${unit} has no ticker in src/tokens/registry.${NETWORK}.json. Nothing written.`);
  return `${amount(view.token.quantity, Number(known.decimals ?? 0))} ${known.ticker} + ${ada}`;
}

/**
 * A pool's four entries, worded as the classic pool's are: named for `value` and the pool's set, at that set's
 * version, linked to its contracts at the commit core pins it to (`commits`, commitsOf's). The full id would take the
 * link past the registry's 100. A pool on a set SETS doesn't name stops it, a retired one too: the run skips those
 * before it gets here.
 */
export function entriesOf(view, value, commits) {
  const set = Object.hasOwn(SETS, view.version) ? SETS[view.version] : undefined;
  if (!set) throw new Error(`${view.id} verifies as ${view.version} pool ${view.id}, a set with no registry entries. Nothing written.`);
  const github = `https://github.com/logical-mechanism/Lovejoin/tree/${commits[view.version].slice(0, 12)}/contracts`;
  const contract = (script, scriptHash, description) => ({
    name: `${script}${set.label} (${value})`,
    version: set.version,
    language: "PLUTUS",
    languageVersion: 3,
    scriptHash,
    github,
    description,
  });
  return [
    contract("Mix Box", view.mixBoxHash, "This contract holds this pool's mix boxes and defers validation to its mix logic."),
    contract("Mix Logic", view.mixLogicHash, "This contract verifies this pool's mix and withdraw proofs once per transaction."),
    contract("Fee Pool", view.feeHash, "This contract holds this pool's shared fee shards that pay for its mix transactions."),
    contract("Reference Minter", view.id, "This contract mints this pool's one-of-one reference token, from its launch's seed."),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(new URL("seedelf_wasm_bg.wasm", PKG))) throw new Error("wasm/pkg isn't built: run `npm run build` first.");
  const wasm = await import(new URL("seedelf_wasm.js", PKG).href);
  wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", PKG)) });

  // The templates' source at the commits core pins each set to.
  const commits = commitsOf(readFileSync(TEMPLATES, "utf8"));
  const { height, pools } = JSON.parse(readFileSync(POOLS, "utf8"))[NETWORK];
  const tokens = JSON.parse(readFileSync(TOKENS, "utf8"));
  // In launch order, so each release's additions go at the end.
  const launched = [...pools].sort((a, b) => a.launch.block - b.launch.block || a.launch.index - b.launch.index);
  // The pools on a retired set: listed so wallets find their boxes, never named.
  const skipped = [];
  const wanted = launched.flatMap((pool) => {
    let view;
    try {
      view = JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network: NETWORK, pool: pool.ref })));
    } catch (e) {
      throw new Error(`${pool.id} doesn't verify: ${e?.message ?? e}. Nothing written.`);
    }
    if (view.id === pool.id && RETIRED.includes(view.version)) {
      skipped.push(view);
      return [];
    }
    if (view.id !== pool.id || !Object.hasOwn(SETS, view.version)) throw new Error(`${pool.id} verifies as ${view.version} pool ${view.id}. Nothing written.`);
    return entriesOf(view, valueOf(view, tokens), commits);
  });
  const skips = () => {
    for (const view of skipped) console.log(`  skipped, a retired ${view.version} pool, never named: ${view.id}`);
  };
  for (const c of wanted) {
    if (c.name.length > MAX_NAME) throw new Error(`"${c.name}" is over the registry's ${MAX_NAME} characters. Nothing written.`);
    if (c.description.length > MAX_DESCRIPTION) throw new Error(`${c.name}'s description is over ${MAX_DESCRIPTION} characters. Nothing written.`);
  }

  const target = process.argv[2];
  const listed = `${NETWORK}: ${pools.length} pools in src/lovejoin-pools.json (to block ${height})`;
  if (!target) {
    console.log(JSON.stringify(wanted, null, 2));
    console.log(`${listed}, ${wanted.length} entries. Give the fork's projects/lovejoin.json to add the new ones.`);
    skips();
  } else {
    if (!existsSync(target)) throw new Error(`No ${target}: the owner's fork of StricaHQ/cardano-contracts-registry isn't there.`);
    const registry = JSON.parse(readFileSync(target, "utf8"));
    if (registry.projectName !== "Lovejoin") throw new Error(`${target} isn't Lovejoin's registry file.`);
    const hashes = new Set(registry.contracts.map((c) => c.scriptHash));
    const names = new Set(registry.contracts.map((c) => c.name));
    const added = wanted.filter((c) => !hashes.has(c.scriptHash));
    for (const c of added) {
      if (names.has(c.name)) throw new Error(`"${c.name}" already labels another script in ${target}. Nothing written.`);
      names.add(c.name);
    }
    // The named sets' entries: those of a pool no longer listed are named here, never removed.
    const versions = new Set(Object.values(SETS).map((s) => s.version));
    const current = new Set(wanted.map((c) => c.scriptHash));
    const unlisted = registry.contracts.filter((c) => versions.has(c.version) && !current.has(c.scriptHash));
    if (added.length) {
      registry.contracts.push(...added);
      writeFileSync(target, `${JSON.stringify(registry, null, 2)}\n`);
    }
    if (!added.length) console.log(`${listed}: no new pools, ${target} left as it was.`);
    else console.log(`${listed}: ${added.length} entries added, ${wanted.length - added.length} already there -> ${target}`);
    for (const c of added) console.log(`  + ${c.name}  ${c.scriptHash}`);
    for (const c of unlisted) console.warn(`  kept, its pool no longer listed: ${c.name}  ${c.scriptHash}`);
    skips();
    if (added.length) console.log("Next, in the fork: npm run validate, commit, open the PR, and message Cardanoscan the link.");
  }
}
