// Every request of Seedelf Messaging has a caller in the screens, and none is the worker's own (the 1.10.0 gate's
// round 5, the §20 freeze review's fix B). At 48480cf8 nothing in src/ui sent messaging-check-reveal, -resend,
// -answer-at, -retry or -clear: a trap stopped a network's Messages for good, a refused message couldn't be sent again
// and a reveal never verified. Each request starts at a user's press, or a page's read: nothing an envelope holds starts
// one, so the worker never sends one to itself.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isMessage } from "../src/shared/rpc";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** Every .ts and .tsx file under `dir`, with its text. */
function sources(dir: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name)) out.push({ path, text: readFileSync(path, "utf8") });
  }
  return out;
}

/** The messaging requests `shared/rpc.ts` declares (its `Requests` interface): `messaging` and every `messaging-*`. */
function requests(): string[] {
  const rpc = readFileSync(join(SRC, "shared/rpc.ts"), "utf8");
  const body = rpc.slice(rpc.indexOf("export interface Requests {"));
  const names = [...body.slice(0, body.indexOf("\n}\n")).matchAll(/^ {2}"?(messaging(?:-[a-z]+)*)"?: \{/gm)].map((m) => m[1]!);
  return [...new Set(names)];
}

/** The requests `files` send: each name in a line of code that calls `call(`, as `call("name"` or a choice of names in it. */
const calledIn = (files: Array<{ text: string }>) =>
  new Set(
    files.flatMap((f) =>
      f.text
        .split("\n")
        .filter((line) => /\bcall\(/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line))
        .flatMap((line) => [...line.matchAll(/"([a-z]+(?:-[a-z]+)*)"/g)].map((m) => m[1]!)),
    ),
  );

describe("Seedelf Messaging's requests and their callers (the freeze's fix B)", { timeout: 20_000 }, () => {
  const names = requests();
  const ui = sources(join(SRC, "ui"));
  const worker = sources(join(SRC, "background"));
  const called = calledIn(ui);

  it("reads every messaging request the worker answers, each a request rpc.ts lists", () => {
    expect(names).toContain("messaging");
    expect(names).toContain("messaging-check-reveal");
    expect(names.length).toBeGreaterThanOrEqual(19);
    for (const name of names) expect(isMessage({ type: name }), name).toBe(true);
    // The worker routes each.
    const handlers = readFileSync(join(SRC, "background/handlers.ts"), "utf8");
    for (const name of names) expect(handlers, name).toContain(`case "${name}":`);
  });

  it("has a caller in src/ui for every one", () => {
    const missing = names.filter((n) => !called.has(n));
    expect(missing).toEqual([]);
    // Round 5's last: the dropped-unread line's Dismiss (round 4's #6), the screens' only `messaging-seen`.
    expect(called.has("messaging-seen")).toBe(true);
  });

  it("is never the worker's own: nothing under src/background sends a messaging request", () => {
    const own = [...calledIn(worker)].filter((n) => names.includes(n));
    expect(own).toEqual([]);
    for (const file of worker) expect(/\bcall\(\s*"messaging/.test(file.text), file.path).toBe(false);
  });
});
