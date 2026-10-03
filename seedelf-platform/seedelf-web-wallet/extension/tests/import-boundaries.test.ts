// Two module graphs that must stay free of the wallet's UI layer, both of which
// chunk 19 broke and only a build or the e2e suite noticed.
//
// 1. The content scripts. `content/page.ts` runs in the
// page's own world, where `chrome` is undefined, so a module that touches
// `chrome` as it loads kills the whole script — and with it `window.cardano`,
// which is how a site finds the wallet at all. That failure is silent in the
// unit tests and only the e2e suite sees it (chunk 19 shipped it for one
// commit: `shared/dapp.ts` gained a `t()` call, both content scripts import
// that module, and every dApp connector test failed with
// `Cannot read properties of undefined (reading 'seedelf')`).
//
// 2. What `vite.config.ts` imports. It builds the manifest from
// `src/manifest.ts`, which reads `networks.ts` and `shared/dapp.ts`, and Vite
// loads that graph with Node — so a `t()` in one of them pulls i18next and all
// three locale files into the build's own config. `networks.ts` had one, for
// `POOL_SEEDABLE`, and Vite said so in seven `configLoader: 'native'` warnings.
//
// So this walks the static import graph from each entry and holds the rules: no
// i18next in either, and nothing that reads `chrome` at import in the page's.
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../src");
const ENTRIES = ["content/bridge.ts", "content/page.ts"];
/**
 * `page.ts` is the one injected into the page's own world. `bridge.ts` runs in
 * the isolated content-script world, which does have `chrome.runtime` — that's
 * how it reaches the worker — so only `page.ts` is held to the `chrome` rule.
 */
const PAGE_WORLD = "content/page.ts";

/** Every `src/` file an entry point pulls in, by following static imports. */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [join(SRC, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    // `import … from "x"` and `export … from "x"`, type-only imports included:
    // a bundler drops those, but naming one is still a sign of coupling we want
    // to see, and `verbatimModuleSyntax` keeps them honest in the source.
    for (const m of text.matchAll(/^(?:import|export)[\s\S]*?from\s+"([^"]+)";/gm)) {
      const spec = m[1]!;
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(file), spec);
      const found = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((p) => {
        try {
          readFileSync(p);
          return true;
        } catch {
          return false;
        }
      });
      if (found) queue.push(found);
    }
  }
  return [...seen].map((f) => relative(SRC, f)).sort();
}

describe("what a content script is allowed to import", () => {
  it.each(ENTRIES)("%s reaches no i18n module", (entry) => {
    const i18n = reachable(entry).filter((f) => f.startsWith("i18n/"));
    expect(i18n, `${entry} would carry i18next into the page's world, where chrome is undefined`).toEqual([]);
  });

  it(`${PAGE_WORLD} reaches nothing that reads chrome as it loads`, () => {
    const entry = PAGE_WORLD;
    // Inside a function is fine: the page script simply never calls it. At the
    // top level it runs on import, in a world that has no `chrome`.
    const bad: string[] = [];
    for (const file of reachable(entry)) {
      const text = readFileSync(join(SRC, file), "utf8");
      const top = text
        .split("\n")
        // A line that starts at column 0 and isn't a declaration's body is
        // module-level code; anything indented is inside something.
        .filter((l) => /^\S/.test(l) && !/^(import|export (type|interface)|\/\/|\/\*|\s*\*)/.test(l));
      if (top.some((l) => /\bchrome\./.test(l))) bad.push(file);
    }
    expect(bad, `${entry} pulls in a module that touches chrome at import`).toEqual([]);
  });

  it("the entries are the ones the build injects", () => {
    // vite.config.ts builds exactly these two as the connector's scripts: if it
    // gains a third, this list has to know about it.
    const config = readFileSync(resolve(SRC, "../vite.config.ts"), "utf8");
    for (const entry of ENTRIES) expect(config).toContain(`src/${entry}`);
  });
});

describe("what the build's own config is allowed to import", () => {
  // Read from the config rather than listed here: a new `./src/…` import in it
  // joins this check by itself.
  const config = readFileSync(resolve(SRC, "../vite.config.ts"), "utf8");
  const entries = [...config.matchAll(/from "\.\/src\/([^"]+)"/g)].map((m) => m[1]!);

  it("imports something from src/ at all, so this check isn't vacuous", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("src/%s reaches no i18n module", (entry) => {
    const i18n = reachable(entry).filter((f) => f.startsWith("i18n/"));
    expect(i18n, `vite.config.ts would load i18next and every locale to build the manifest`).toEqual([]);
  });
});
