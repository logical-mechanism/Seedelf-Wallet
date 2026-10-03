// Which translation keys are accuracy-critical — and it works it out from the
// source rather than from a list someone maintains.
//
// A string the wallet shows inside `<Callout tone="privacy">`, `<Callout
// tone="warn">` or anything with `role="alert"` is a privacy note, a warning
// or an error. Those are the strings where a wrong translation costs a user
// money or privacy rather than a moment's confusion, so they are the set that
// has to be checked by a person before it ships.
//
// Two sources, unioned, because each catches what the other misses:
//
//   1. **The component.** What is inside a privacy callout, a warning callout
//      or anything with `role="alert"`.
//   2. **The name.** Any key with `.privacy.` or `.warn.` in it. A privacy note
//      is sometimes a plain `<p className="note">` rather than a callout —
//      `accountRecipients.privacy.ownAccounts` is one, and source 1 alone would
//      not see it. The convention is therefore load-bearing, not decoration.
//
// Lace keeps the same idea as a hand-written glob list
// (`docs/i18n/critical-key-patterns.json`), and its own file records what that
// costs: Earn Rewards and ten cNIGHT keys shipped machine-translated and were
// "de-classified to keep main green at merge time", with a note saying they
// are still accuracy-critical. A list someone has to remember to add to drifts
// towards whatever makes the build pass. Deriving it means a new warning joins
// the set by being a warning.
//
//   node scripts/i18n-critical.mjs           # print the set
//   node scripts/i18n-critical.mjs --write   # update docs/i18n/critical-keys.json
//
// `tests/i18n.test.ts` regenerates it and fails if the checked-in file drifts.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseAst } from "vite";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
export const CRITICAL_FILE = fileURLToPath(new URL("../../docs/i18n/critical-keys.json", import.meta.url));

const sources = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const path = `${dir}/${f}`;
    return statSync(path).isDirectory() ? sources(path) : /\.tsx$/.test(f) ? [path] : [];
  });

/** An element that makes what's inside it a warning, a privacy note or an error. */
function isCriticalElement(node) {
  const open = node.openingElement;
  if (!open) return false;
  const name = open.name?.name;
  const attr = (want) => open.attributes?.find((a) => a.type === "JSXAttribute" && a.name?.name === want);
  const role = attr("role");
  if (role?.value?.type === "Literal" && role.value.value === "alert") return true;
  if (name !== "Callout") return false;
  const tone = attr("tone");
  // No tone is `info`, which is an explanation rather than a decision.
  return tone?.value?.type === "Literal" && (tone.value.value === "privacy" || tone.value.value === "warn");
}

/** Every key named by a string literal anywhere in a subtree. */
function keysIn(node, into) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((c) => keysIn(c, into));
  // Flat dot-notation, two segments at least: what a key looks like and a
  // sentence doesn't.
  if (node.type === "Literal" && typeof node.value === "string" && /^[a-z][\w]*(\.[\w]+){1,}$/.test(node.value)) {
    into.add(node.value);
  }
  for (const child of Object.values(node)) if (child && typeof child === "object") keysIn(child, into);
}

/** A key whose own name says it carries a privacy decision or a warning. */
export const criticalByName = (key) => /\.(privacy|warn)\./.test(key);

/** The accuracy-critical keys: what a critical component shows, and what a critical name declares. */
export function criticalKeys(allKeys = []) {
  const found = new Set(allKeys.filter(criticalByName));
  for (const file of sources(SRC)) {
    const source = readFileSync(file, "utf8");
    let ast;
    try {
      ast = parseAst(source, { lang: "tsx" });
    } catch {
      continue;
    }
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (node.type === "JSXElement" && isCriticalElement(node)) keysIn(node, found);
      for (const child of Object.values(node)) if (child && typeof child === "object") visit(child);
    };
    visit(ast);
  }
  return [...found].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const en = JSON.parse(readFileSync(new URL("../src/i18n/translations/en.json", import.meta.url), "utf8"));
  const keys = criticalKeys(Object.keys(en));
  if (process.argv.includes("--write")) {
    writeFileSync(CRITICAL_FILE, `${JSON.stringify(keys, null, 2)}\n`);
    console.log(`${CRITICAL_FILE}: ${keys.length} keys`);
  } else {
    console.log(keys.join("\n"));
    console.log(`\n${keys.length} accuracy-critical keys`);
  }
}
