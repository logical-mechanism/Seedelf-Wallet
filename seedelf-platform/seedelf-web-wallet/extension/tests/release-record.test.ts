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

// Chunk 51, b1#2. The record said "the pinned Rust", and nothing showed which rustc built the module: a
// RUSTUP_TOOLCHAIN or RUSTC left in the release shell builds with another, past rust-toolchain.toml. So build.sh says
// which, beside the C compiler: the release and the commit `rustc -vV` gives, of the rustc cargo runs.
it("build.sh says which Rust built the module, or that it doesn't know, rather than fail the build", () => {
  const script = readFileSync(new URL("../../wasm/build.sh", import.meta.url), "utf8");
  const line = script.split("\n").find((l) => l.startsWith('echo "Rust: '));
  expect(line).toBeDefined();
  const env = { ...process.env };
  delete env.RUSTC;
  const run = (before: string, over: NodeJS.ProcessEnv = {}) =>
    execFileSync("bash", ["-c", `set -euo pipefail\n${before}\n${line}\necho done`], { env: { ...env, ...over }, encoding: "utf8" });
  // A rustc answering -vV as rustc 1.98.1 does (a function here, which bash finds before PATH).
  const rustc = [
    "rustc() {",
    "  [ \"$1\" = -vV ] || return 2",
    "  printf '%s\\n' 'rustc 1.98.1 (a5d0b1f2c 2026-10-29)' 'binary: rustc' \\",
    "    'commit-hash: a5d0b1f2c3e4d5f60718293a4b5c6d7e8f901234' 'commit-date: 2026-10-29' \\",
    "    'host: x86_64-unknown-linux-gnu' 'release: 1.98.1' 'LLVM version: 21.1.2'",
    "}",
  ].join("\n");
  expect(run(rustc)).toBe("Rust: 1.98.1 (a5d0b1f2c3e4d5f60718293a4b5c6d7e8f901234)\ndone\n");
  // The one cargo runs: RUSTC, where it's set. None there, under the script's own settings: it says so and goes on.
  expect(run(rustc, { RUSTC: "/nonexistent/rustc" })).toBe("Rust: unknown\ndone\n");
});
