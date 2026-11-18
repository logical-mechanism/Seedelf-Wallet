// The store zip's licenses/THIRD-PARTY.txt names the npm packages the bundle
// carries, and the same ones on any machine. i18next's optional peer on
// TypeScript once made it name TypeScript and the packaging machine's own
// native binary of it, so a Mac and Linux zipped the same commit differently
// (scripts/third-party.mjs).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { npmPackages } from "../scripts/third-party.mjs";

/** The packages' names without their versions, sorted. */
const names = (list: Array<{ name: string }>) => list.map((c) => c.name.replace(/ v[^ ]*$/, "")).sort();

describe("the notices' npm packages", () => {
  it("are package.json's dependencies and theirs, whatever this machine installed", () => {
    const bundled = ["@noble/ciphers", "@noble/hashes", "i18next", "react", "react-dom", "scheduler", "uqr"];
    expect(names(npmPackages())).toEqual(bundled);
    // Every platform's optional binaries installed, or none: the same list.
    expect(names(npmPackages(undefined, () => true))).toEqual(bundled);
    expect(names(npmPackages(undefined, () => false))).toEqual(bundled);
  });

  it("are what node would load: the nearest copy, a peer that's needed, an optional one that's installed", () => {
    const lock = {
      packages: {
        "": { dependencies: { app: "^1" }, devDependencies: { types: "^1" } },
        "node_modules/app": {
          version: "1.0.0",
          dependencies: { util: "^2" },
          optionalDependencies: { "app-linux": "1.0.0", "app-darwin": "1.0.0" },
          peerDependencies: { runtime: "^1", types: "^1" },
          peerDependenciesMeta: { types: { optional: true } },
        },
        // app's own copy is where node looks first; the outer one is a tool's.
        "node_modules/app/node_modules/util": { version: "2.0.0" },
        "node_modules/util": { version: "1.0.0", dev: true },
        "node_modules/app-darwin": { version: "1.0.0", optional: true },
        "node_modules/app-linux": { version: "1.0.0", optional: true },
        "node_modules/runtime": { version: "1.0.0", peer: true },
        // Like TypeScript: a dev dependency that app can use, and doesn't need.
        "node_modules/types": { version: "1.0.0", devOptional: true },
      },
    };
    const installed = (path: string) => path !== "node_modules/app-darwin";
    expect(npmPackages(lock, installed).map((c) => c.name)).toEqual([
      "app v1.0.0",
      "util v2.0.0",
      "app-linux v1.0.0",
      "runtime v1.0.0",
    ]);
  });

  it("fail on a dependency the lockfile doesn't have", () => {
    const lock = { packages: { "": { dependencies: { gone: "^1" } } } };
    expect(() => npmPackages(lock, () => true)).toThrow("package.json needs gone");
  });
});

// Chunk 51, b1#1. The notices are one of the store zip's files, and releases.md says the same commit gives the same
// zip. Each group was sorted with localeCompare and no locale, which takes the packaging shell's (LC_ALL, then
// LC_MESSAGES, then LANG): in Estonian z sorts before t, in Lithuanian y before j, in Czech ch after h, so a checker
// whose shell spoke one of those got another zip from the same commit. The sort is the one step of the notices that
// reads the locale. Each case sorts every crate in Cargo.lock and every package in package-lock.json, named as the
// notices name them, in a fresh node with that locale, as `npm run package` would run.

const script = pathToFileURL(fileURLToPath(new URL("../scripts/third-party.mjs", import.meta.url))).href;

/** "<name> v<version>" for every package in Cargo.lock and in package-lock.json, as the notices name a component. */
function everyName(): string[] {
  const cargo = readFileSync(new URL("../../../Cargo.lock", import.meta.url), "utf8");
  const crates = [...cargo.matchAll(/^name = "([^"]+)"\nversion = "([^"]+)"$/gm)].map(([, n, v]) => `${n} v${v}`);
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const tail = (path: string) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  const packages = Object.entries(lock.packages as Record<string, { name?: string; version?: string }>)
    .filter(([path]) => path)
    .map(([path, p]) => `${p.name ?? tail(path)} v${p.version}`);
  return [...crates, ...packages];
}

/** `names` sorted in a fresh node in `locale`: by the notices' `byName`, or `bare`, localeCompare with no locale. */
function sortedIn(locale: string, names: string[], order: "byName" | "bare" = "byName"): string[] {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: locale };
  delete env.NODE_OPTIONS;
  const code = [
    `import { readFileSync } from "node:fs";`,
    `import { byName } from ${JSON.stringify(script)};`,
    `const bare = (a, b) => a.name.localeCompare(b.name);`,
    `const sorted = JSON.parse(readFileSync(0, "utf8")).map((name) => ({ name })).sort(${order});`,
    `process.stdout.write(JSON.stringify(sorted.map((c) => c.name)));`,
  ].join("\n");
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    env,
    input: JSON.stringify(names),
    encoding: "utf8",
    timeout: 60_000,
  });
  return JSON.parse(out);
}

describe("the notices' order", () => {
  const all = everyName();
  let reference: string[] = [];
  beforeAll(() => {
    reference = sortedIn("C", all);
  }, 60_000);

  it("is tried on names a locale reorders: those of every crate and package the notices can name", () => {
    expect(all.length).toBeGreaterThan(400);
    expect(sortedIn("et_EE.UTF-8", all, "bare")).not.toEqual(sortedIn("C", all, "bare"));
  }, 60_000);

  it.each([
    "en_US.UTF-8",
    "et_EE.UTF-8",
    "lt_LT.UTF-8",
    "lv_LV.UTF-8",
    "cs_CZ.UTF-8",
    "sk_SK.UTF-8",
    "cy_GB.UTF-8",
    "th_TH.UTF-8",
    "haw_US.UTF-8",
    "az_AZ.UTF-8",
  ])(
    "is the same in %s as in C",
    (locale) => {
      expect(sortedIn(locale, all)).toEqual(reference);
    },
    60_000,
  );
});
