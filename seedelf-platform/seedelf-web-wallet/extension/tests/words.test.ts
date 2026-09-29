// How the wallet writes its name: always "Seedelf" (a Seedelf, Seedelfs, the
// Seedelf balance), and "Seedelf Wallet" for the app. Lowercase is for code
// only: identifiers, storage keys, test ids, the frozen derivation strings.
// Every piece of text in the extension's source that a person could read is
// checked: JSX text, the attributes a screen shows or speaks, and any string
// with a space in it (a message, a label), so an error can't slip through.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAst } from "vite";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const SHOWN_ATTRIBUTES = new Set(["title", "aria-label", "placeholder", "alt", "label", "name", "aside"]);
const WRONG = [/\bseedelfs?\b/, /\bSeedelf wallet\b/, /\bSEEDELF\b/];

type Node = { type: string; start: number; end: number; [key: string]: unknown };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const path = `${dir}/${f}`;
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(f) ? [path] : [];
  });
}

/** The text in `file` a person could read, with the line it's on. */
function readable(file: string): Array<{ line: number; text: string }> {
  const source = readFileSync(file, "utf8");
  const ast = parseAst(source, { lang: file.endsWith(".tsx") ? "tsx" : "ts" }) as unknown as Node;
  const found: Array<{ line: number; text: string }> = [];
  const visit = (node: unknown, parent?: Node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, parent));
    const n = node as Node;
    let text: string | undefined;
    if (n.type === "JSXText") text = n.value as string;
    else if (n.type === "Literal" && typeof n.value === "string") {
      const attribute = parent?.type === "JSXAttribute" && SHOWN_ATTRIBUTES.has((parent.name as { name: string }).name);
      const module = parent?.type === "ImportDeclaration" || parent?.type?.startsWith("Export");
      if (!module && (attribute || /\s/.test(n.value.trim()))) text = n.value;
    } else if (n.type === "TemplateElement") {
      const raw = (n.value as { raw: string }).raw;
      if (/\s/.test(raw.trim())) text = raw;
    }
    if (text?.trim()) found.push({ line: source.slice(0, n.start).split("\n").length, text: text.trim() });
    for (const child of Object.values(n)) if (child && typeof child === "object") visit(child, n);
  };
  visit(ast);
  return found;
}

describe("the wallet's name", () => {
  it("is Seedelf, and Seedelf Wallet for the app, in everything a person reads", () => {
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(50);
    const wrong = files.flatMap((file) =>
      readable(file)
        .filter(({ text }) => WRONG.some((w) => w.test(text)))
        .map(({ line, text }) => `${file.slice(SRC.length + 1)}:${line}: ${text}`),
    );
    expect(wrong).toEqual([]);
  });

  it("would catch a lowercase one", () => {
    // The check itself: a message, JSX text and a shown attribute.
    const probe = new URL("./fixtures/words-probe.tsx", import.meta.url);
    const texts = readable(fileURLToPath(probe)).map((t) => t.text);
    expect(texts.filter((t) => WRONG.some((w) => w.test(t)))).toEqual([
      "No seedelf with that name.",
      "Your seedelfs",
      "seedelf",
      "in a Seedelf wallet",
    ]);
  });
});
