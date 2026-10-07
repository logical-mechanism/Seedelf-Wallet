// A release records what built it beside the zip's hash: wasm/build.sh ends
// with the C compiler blst went through, which nothing pins, and
// scripts/package.mjs with the Node and zlib that zipped it. Information, never
// a check: CI runs both, and a build that's done must not fail on the record.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

it("build.sh's compiler line says it doesn't know, rather than fail the build", () => {
  const script = readFileSync(new URL("../../wasm/build.sh", import.meta.url), "utf8");
  const line = script.split("\n").find((l) => l.startsWith('echo "C compiler: '));
  expect(line).toBeDefined();
  // Under the script's own settings, with no such compiler (a cached build never calls it).
  const out = execFileSync("bash", ["-c", `set -euo pipefail\n${line}\necho done`], {
    env: { ...process.env, CC_wasm32_unknown_unknown: "/nonexistent/clang" },
    encoding: "utf8",
  });
  expect(out).toBe("C compiler: unknown\ndone\n");
});
