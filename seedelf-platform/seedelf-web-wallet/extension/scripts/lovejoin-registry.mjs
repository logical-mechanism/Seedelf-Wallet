// Cardanoscan's labels for Lovejoin's token pools. Cardanoscan names a script
// only by its hash, from Strica's cardano-contracts-registry, where Lovejoin's
// entries are `projects/lovejoin.json` (the owner's fork of it, beside this
// repository). Every token pool has four scripts of its own, made from the
// pinned templates (seedelf-core's lovejoin/templates.rs) and its launch's
// seed: its reference token's policy (P, the pool's id), mix_logic, mix_box and
// fee_contract. So a pool stays unnamed there until its four hashes are added.
// Run at each release, after `npm run lovejoin-pools`: it reads that bundled
// list, which holds only the pools the wallet shows, so only those are named.
//
//   node scripts/lovejoin-registry.mjs                  print the entries mainnet's pools make
//   node scripts/lovejoin-registry.mjs <lovejoin.json>  add the new ones to the fork's file
//
// Each pool is verified again through WebAssembly (lovejoinVerifyPool, so
// wasm/pkg must be built), which derives its four scripts from its seed. Its
// entries are named for its value, which no other shown pool has: the box's
// token and ADA ("Mix Box (1,000 SNEK + 4 ADA)"), or its ADA alone.
//
// The file is only added to. The entries written by hand (the project, the
// classic pool's, the reference holder's) are left alone, and an entry already
// there stays as it is, even once its pool is no longer listed (its token left
// the list): it's named in a warning, never removed, as its label is still
// true. With no new pool, the file isn't touched. A pool that doesn't verify,
// a token with no ticker, or a name over the registry's limits stops it with
// nothing written.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const NETWORK = "mainnet";
const POOLS = new URL("../src/lovejoin-pools.json", import.meta.url);
const TOKENS = new URL(`../src/tokens/registry.${NETWORK}.json`, import.meta.url);
const TEMPLATES = new URL("../../../seedelf-core/src/lovejoin/templates.rs", import.meta.url);
const PKG = new URL("../../wasm/pkg/", import.meta.url);
/** The token pools' scripts are version 2 in the registry; the classic pool's are 1. */
const VERSION = 2;
/** The registry's limits: its README's (its validator allows a 50-character name). */
const MAX_NAME = 45;
const MAX_DESCRIPTION = 140;

if (!existsSync(new URL("seedelf_wasm_bg.wasm", PKG))) throw new Error("wasm/pkg isn't built: run `npm run build` first.");
const wasm = await import(new URL("seedelf_wasm.js", PKG).href);
wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", PKG)) });

// The templates' source at the commit core pins them to. The full id would take the link past the registry's 100.
const commit = /pub const COMMIT: &str = "([0-9a-f]{40})"/.exec(readFileSync(TEMPLATES, "utf8"))?.[1];
if (!commit) throw new Error("No COMMIT in seedelf-core/src/lovejoin/templates.rs.");
const github = `https://github.com/logical-mechanism/Lovejoin/tree/${commit.slice(0, 12)}/contracts`;

/** `units` with `decimals` places, as the wallet writes amounts: en-US grouping, no trailing zeros. */
function amount(units, decimals) {
  const n = BigInt(units);
  const scale = 10n ** BigInt(decimals);
  const fraction = decimals ? (n % scale).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${(n / scale).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** What a pool's boxes each hold, by the ticker and decimals `npm run tokens` wrote. */
function valueOf(view, tokens) {
  const ada = `${amount(view.boxLovelace, 6)} ADA`;
  if (!view.token) return ada;
  const unit = `${view.token.policyId}.${view.token.assetName}`;
  const known = tokens[unit];
  if (!known?.ticker) throw new Error(`${view.id}: its token ${unit} has no ticker in src/tokens/registry.${NETWORK}.json. Nothing written.`);
  return `${amount(view.token.quantity, Number(known.decimals ?? 0))} ${known.ticker} + ${ada}`;
}

const contract = (name, scriptHash, description) => ({
  name,
  version: VERSION,
  language: "PLUTUS",
  languageVersion: 3,
  scriptHash,
  github,
  description,
});

/** A pool's four entries, worded as the classic pool's are. */
const entriesOf = (view, value) => [
  contract(`Mix Box (${value})`, view.mixBoxHash, "This contract holds this pool's mix boxes and defers validation to its mix logic."),
  contract(`Mix Logic (${value})`, view.mixLogicHash, "This contract verifies this pool's mix and withdraw proofs once per transaction."),
  contract(`Fee Pool (${value})`, view.feeHash, "This contract holds this pool's shared fee shards that pay for its mix transactions."),
  contract(`Reference Minter (${value})`, view.id, "This contract mints this pool's one-of-one reference token, from its launch's seed."),
];

const { height, pools } = JSON.parse(readFileSync(POOLS, "utf8"))[NETWORK];
const tokens = JSON.parse(readFileSync(TOKENS, "utf8"));
// In launch order, so each release's additions go at the end.
const launched = [...pools].sort((a, b) => a.launch.block - b.launch.block || a.launch.index - b.launch.index);
const wanted = launched.flatMap((pool) => {
  let view;
  try {
    view = JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network: NETWORK, pool: pool.ref })));
  } catch (e) {
    throw new Error(`${pool.id} doesn't verify: ${e?.message ?? e}. Nothing written.`);
  }
  if (view.id !== pool.id || view.version !== "tokenV1") throw new Error(`${pool.id} verifies as ${view.version} pool ${view.id}. Nothing written.`);
  return entriesOf(view, valueOf(view, tokens));
});
for (const c of wanted) {
  if (c.name.length > MAX_NAME) throw new Error(`"${c.name}" is over the registry's ${MAX_NAME} characters. Nothing written.`);
  if (c.description.length > MAX_DESCRIPTION) throw new Error(`${c.name}'s description is over ${MAX_DESCRIPTION} characters. Nothing written.`);
}

const target = process.argv[2];
const listed = `${NETWORK}: ${pools.length} pools in src/lovejoin-pools.json (to block ${height})`;
if (!target) {
  console.log(JSON.stringify(wanted, null, 2));
  console.log(`${listed}, ${wanted.length} entries. Give the fork's projects/lovejoin.json to add the new ones.`);
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
  const current = new Set(wanted.map((c) => c.scriptHash));
  const unlisted = registry.contracts.filter((c) => c.version === VERSION && !current.has(c.scriptHash));
  if (added.length) {
    registry.contracts.push(...added);
    writeFileSync(target, `${JSON.stringify(registry, null, 2)}\n`);
  }
  if (!added.length) console.log(`${listed}: no new pools, ${target} left as it was.`);
  else console.log(`${listed}: ${added.length} entries added, ${wanted.length - added.length} already there -> ${target}`);
  for (const c of added) console.log(`  + ${c.name}  ${c.scriptHash}`);
  for (const c of unlisted) console.warn(`  kept, its pool no longer listed: ${c.name}  ${c.scriptHash}`);
  if (added.length) console.log("Next, in the fork: npm run validate, commit, open the PR, and message Cardanoscan the link.");
}
