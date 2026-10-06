// The store zip's licenses/THIRD-PARTY.txt names the npm packages the bundle
// carries, and the same ones on any machine. i18next's optional peer on
// TypeScript once made it name TypeScript and the packaging machine's own
// native binary of it, so a Mac and Linux zipped the same commit differently
// (scripts/third-party.mjs).

import { describe, expect, it } from "vitest";

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
