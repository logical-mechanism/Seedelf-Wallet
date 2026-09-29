// Writes the third-party notices for everything the extension ships that we
// didn't write: the Rust crates compiled into the WebAssembly, the npm
// packages bundled into the JavaScript, and SecretBox (adapted from Lace).
// Inter's and Lucide's licences already ship next to it (public/licenses/).
//
// Needs cargo, and the crates' sources, which the WebAssembly build fetches.
// A component without a licence file falls back on its declared licence:
// Apache-2.0 joins that text, MIT gets its text with the authors from
// Cargo.toml, and CC0 needs no notice. Anything else fails, naming it.
//
//   node scripts/third-party.mjs <out-file>

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const extension = fileURLToPath(new URL("..", import.meta.url));
const workspace = join(extension, "../..");

const LICENCE_FILE = /^(licen[cs]e|copying|notice|copyright)([-._].*)?$/i;

/** The licence files in a package's folder, as [name, text] pairs. */
function licenceFiles(dir) {
  return readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => [f, readFileSync(join(dir, f), "utf8")]);
}

/** Crates linked into seedelf-wasm for the browser: normal dependencies, no proc macros. */
function crates() {
  const tree = execFileSync(
    "cargo",
    ["tree", "-p", "seedelf-wasm", "--target", "wasm32-unknown-unknown", "-e", "normal,no-proc-macro"]
      .concat(["--prefix", "none", "--format", "{p}|{l}"]),
    { cwd: workspace, encoding: "utf8" },
  );
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--filter-platform", "wasm32-unknown-unknown"], {
      cwd: workspace,
      encoding: "utf8",
      maxBuffer: 64 << 20,
    }),
  );
  const members = new Set(metadata.workspace_members);
  const byKey = new Map(metadata.packages.map((p) => [`${p.name} v${p.version}`, p]));

  const seen = new Map();
  for (const line of tree.split("\n")) {
    const [spec, licence] = line.replace(" (*)", "").split("|");
    if (!spec) continue;
    const key = spec.replace(/ \(.*\)$/, "");
    const pkg = byKey.get(key);
    if (!pkg) throw new Error(`cargo metadata doesn't know ${key}`);
    if (members.has(pkg.id) || seen.has(key)) continue; // ours: MIT, this repository
    const dir = dirname(pkg.manifest_path);
    seen.set(key, { name: key, licence: licence || pkg.license, dir, authors: pkg.authors });
  }
  return [...seen.values()];
}

/** npm packages the build bundles: everything in the lockfile that isn't a dev dependency. */
function npmPackages() {
  const lock = JSON.parse(readFileSync(join(extension, "package-lock.json"), "utf8"));
  return Object.entries(lock.packages)
    .filter(([path, p]) => path.startsWith("node_modules/") && !p.dev)
    .map(([path, p]) => ({
      name: `${path.slice("node_modules/".length)} v${p.version}`,
      licence: p.license,
      dir: join(extension, path),
    }));
}

function secretBox() {
  const dir = join(extension, "src/background/secret-box");
  return {
    name: "SecretBox, adapted from Lace (lace-extension@2.4.0), Copyright © 2021 IOHK",
    licence: "Apache-2.0",
    dir,
    note: "Changed by Logical Mechanism LLC: imports @noble/* directly, no legacy EMIP-003 path, shorter comments.",
  };
}

const tidy = (text) => text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
/** Texts that differ only in line wrapping or spacing count as the same. */
const sameness = (text) => text.replace(/\s+/g, " ").trim();

const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/**
 * For a component that ships no licence file: which of its declared licences
 * we take, and its text ("apache" for the shared Apache-2.0 text, null for
 * none needed).
 */
function fallback(c) {
  const options = c.licence.split(/\s+OR\s+|\//).map((s) => s.trim());
  if (options.includes("Apache-2.0")) return { note: "Apache-2.0 (the crate ships no licence file)", text: "apache" };
  if (options.includes("MIT") && c.authors?.length) {
    const who = c.authors.map((a) => a.replace(/\s*<.*>/, "")).join(", ");
    return {
      note: "MIT (the crate ships no licence file; the authors are from its Cargo.toml)",
      text: `MIT License\n\nCopyright (c) ${who}\n\n${MIT}`,
    };
  }
  if (options.includes("CC0-1.0")) {
    return { note: "CC0-1.0, a public-domain dedication: no notice required", text: null };
  }
  return null;
}

/** Wraps a line at 78 columns, at spaces. */
function wrap(line) {
  const lines = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current && current.length + 1 + word.length > 78) {
      lines.push(current);
      current = `  ${word}`;
    } else current = current ? `${current} ${word}` : word;
  }
  return [...lines, current];
}

export function thirdParty(version) {
  const groups = [
    ["Rust crates compiled into the WebAssembly module (assets/seedelf_wasm_bg-*.wasm)", crates()],
    ["npm packages bundled into the JavaScript", npmPackages()],
    ["Source files adapted from other projects", [secretBox()]],
  ];

  // Identical licence texts are printed once, with everyone who uses them.
  const texts = new Map(); // sameness → { text, users }
  const use = (text, name) => {
    const key = sameness(text);
    if (!texts.has(key)) texts.set(key, { text: tidy(text), users: [] });
    texts.get(key).users.push(name);
  };
  const missing = [];
  const apacheUsers = [];
  for (const [, components] of groups) {
    for (const c of components) {
      const files = licenceFiles(c.dir);
      for (const [, text] of files) use(text, c.name);
      if (files.length) continue;
      const f = fallback(c);
      if (!f) {
        missing.push(`${c.name}: ${c.licence} (${relative(workspace, c.dir)})`);
        continue;
      }
      c.note = f.note;
      if (f.text === "apache") apacheUsers.push(c.name);
      else if (f.text) use(f.text, c.name);
    }
  }
  if (missing.length) throw new Error(`No licence file, and no fallback, for:\n  ${missing.join("\n  ")}`);
  if (apacheUsers.length) {
    const apache = [...texts.keys()].find((t) => /^Apache License\s+Version 2\.0, January 2004/.test(t));
    if (!apache) throw new Error(`No Apache-2.0 text to point ${apacheUsers.join(", ")} at`);
    texts.get(apache).users.push(...apacheUsers);
  }

  const rule = "=".repeat(78);
  const out = [
    `Third-party notices for Seedelf Wallet ${version}`,
    "",
    "Seedelf Wallet itself is MIT licensed, Copyright (c) Logical Mechanism LLC.",
    "It includes the software below. Inter (inter-OFL-1.1.txt) and Lucide's",
    "icons (lucide-ISC.txt) have their licences next to this file.",
    "",
  ];
  for (const [title, components] of groups) {
    out.push(rule, title, rule, "");
    for (const c of components.sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`${c.name}: ${c.licence}`);
      if (c.note) out.push(`  ${c.note}`);
    }
    out.push("");
  }
  out.push(rule, "Licence texts", rule, "");
  for (const { text, users } of texts.values()) {
    out.push("-".repeat(78), ...wrap(`Used by: ${users.join(", ")}`), "-".repeat(78), "", text, "");
  }
  return { text: `${out.join("\n")}\n`, components: groups.reduce((n, [, c]) => n + c.length, 0), texts: texts.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [outFile] = process.argv.slice(2);
  if (!outFile) throw new Error("usage: node scripts/third-party.mjs <out-file>");
  const pkg = JSON.parse(readFileSync(join(extension, "package.json"), "utf8"));
  const { text, components, texts } = thirdParty(pkg.version);
  writeFileSync(outFile, text);
  console.log(`${outFile}: ${components} components, ${texts} licence texts, ${Math.round(text.length / 1024)} KB`);
}
