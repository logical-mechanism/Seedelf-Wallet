// No English left on a screen. Every word a person reads in src/ui comes from
// a translation key, so it follows the language they chose; the translation
// review found the Settings screen's own heading still saying "Settings" in
// Spanish and Japanese (`<Screen title="Settings">`), a Plutus map's entries
// called "0 key" and "0 value", and a vote's "yes" put into a Japanese
// sentence. This reads the source the way that review did, from the syntax
// tree as words.test.ts does, and fails on:
//
//   * JSX text, and a string literal put in JSX as a child;
//   * a string literal given to an attribute or a prop a screen shows or
//     speaks (a title, an aria-label, a placeholder, a label…);
//   * a string literal passed as a value into a sentence, `t(key, { what: "…" })`.
//
// A translation key passes, and so does what reads the same in every
// language: the names in ALLOWED, and anything without a letter (₳, ·, 10).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAst } from "vite";
import { describe, expect, it } from "vitest";

const UI = fileURLToPath(new URL("../src/ui", import.meta.url));
const EN: Record<string, string> = JSON.parse(readFileSync(new URL("../src/i18n/translations/en.json", import.meta.url), "utf8"));
/** Every key, a plural by its base: what a call site writes. */
const KEYS = new Set(Object.keys(EN).map((k) => k.replace(/_(few|many|one|other|two|zero)$/, "")));

/** Attributes and props whose string a person reads, or a screen reader says. */
const SHOWN = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "aside",
  "copyLabel",
  "error",
  "heading",
  "hint",
  "label",
  "name",
  "placeholder",
  "sub",
  "submitLabel",
  "title",
  "value",
  "what",
  "who",
]);
/** On an HTML element these belong to the form, not to the words: `<input name>`, `<option value>`. */
const FORM_ONLY = new Set(["name", "value"]);
/** A component's prop that picks something rather than saying it: ExplorerNote's `what` chooses its warning, a context's `value` is data. */
const NOT_SHOWN: Record<string, ReadonlySet<string>> = { ExplorerNote: new Set(["what"]), Provider: new Set(["value"]) };
/** What reads the same in every language: the names the glossary never translates, and two formats. */
const ALLOWED = new Set(["ADA", "Cardano", "Cardanoscan", "CBOR", "DRep", "JSON", "Koios", "Lovejoin", "Mainnet", "Minswap", "Preprod", "Seedelf", "Seedelf Wallet"]);
/** A hex or an address prefix shown as an example: "5eed0e1f…", "addr_test1…". */
const EXAMPLE = /^(?:[0-9a-f]+|addr(?:_test)?1)…$/;
/** An option of `t()` itself, not a word put into the sentence. */
const OPTIONS = new Set(["lng"]);
/** What `t()` is called in the screens. */
const TRANSLATE = new Set(["t", "tr"]);

type Node = { type: string; start: number; end: number; [key: string]: unknown };
type Found = { line: number; text: string };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const path = `${dir}/${f}`;
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(f) ? [path] : [];
  });
}

/** Whether `text` is words a person would read in English. */
function english(text: string): boolean {
  const words = text.trim();
  return /\p{L}/u.test(words) && !KEYS.has(words) && !ALLOWED.has(words) && !EXAMPLE.test(words);
}

/** The literal text an expression can come out as: a string, a template's own words, either side of a choice. */
function literals(node: Node | null | undefined): string[] {
  if (!node) return [];
  if (node.type === "Literal") return typeof node.value === "string" ? [node.value] : [];
  if (node.type === "TemplateLiteral") return (node.quasis as Array<{ value: { cooked: string | null } }>).map((q) => q.value.cooked ?? "");
  if (node.type === "ConditionalExpression") return [...literals(node.consequent as Node), ...literals(node.alternate as Node)];
  // `label ?? "Close"` can be either side; `shown && "Unknown"` is code on its left and text on its right.
  if (node.type === "LogicalExpression") {
    return node.operator === "&&" ? literals(node.right as Node) : [...literals(node.left as Node), ...literals(node.right as Node)];
  }
  return [];
}

/** An element's name as written: `Screen`, `button`, `Foo.Bar`'s `Bar`. */
function elementName(name: Node): string {
  if (name.type === "JSXIdentifier") return name.name as string;
  if (name.type === "JSXMemberExpression") return (name.property as Node).name as string;
  return "";
}

/** The English in one file of src/ui a person would read, each with its line. */
function englishIn(file: string): Found[] {
  const source = readFileSync(file, "utf8");
  const ast = parseAst(source, { lang: file.endsWith(".tsx") ? "tsx" : "ts" }) as unknown as Node;
  const found: Found[] = [];
  const add = (at: number, texts: string[]) => {
    for (const text of texts) if (english(text)) found.push({ line: source.slice(0, at).split("\n").length, text: text.trim() });
  };
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as Node;
    if (n.type === "JSXElement" || n.type === "JSXFragment") {
      if (n.type === "JSXElement") {
        const opening = n.openingElement as Node;
        const element = elementName(opening.name as Node);
        const intrinsic = /^[a-z]/.test(element);
        for (const attribute of opening.attributes as Node[]) {
          if (attribute.type === "JSXAttribute") {
            const prop = (attribute.name as Node).name as string;
            const value = attribute.value as Node | null;
            const shown = SHOWN.has(prop) && !(intrinsic && FORM_ONLY.has(prop)) && !NOT_SHOWN[element]?.has(prop);
            if (shown) add(attribute.start, literals(value?.type === "JSXExpressionContainer" ? (value.expression as Node) : value));
          }
          // Inside it, JSX of its own (a `foot`) and t() calls.
          visit(attribute);
        }
      }
      for (const child of n.children as Node[]) {
        if (child.type === "JSXText") add(child.start, [child.value as string]);
        if (child.type === "JSXExpressionContainer") add(child.start, literals(child.expression as Node));
        visit(child);
      }
      return;
    }
    if (n.type === "CallExpression") {
      const callee = n.callee as Node;
      const values = (n.arguments as Node[])[1];
      if (callee.type === "Identifier" && TRANSLATE.has(callee.name as string) && values?.type === "ObjectExpression") {
        for (const p of values.properties as Node[]) {
          const key = p.key as Node | undefined;
          const name = key ? String(key.name ?? key.value) : "";
          if (p.type === "Property" && !OPTIONS.has(name)) add(p.start, literals(p.value as Node));
        }
      }
    }
    for (const child of Object.values(n)) visit(child);
  };
  visit(ast);
  return found;
}

describe("the screens' words", () => {
  it("all come from the translations, in every file of src/ui", () => {
    const files = sources(UI);
    expect(files.length).toBeGreaterThan(50);
    const left = files.flatMap((file) => englishIn(file).map(({ line, text }) => `${file.slice(UI.length + 1)}:${line}: ${text}`));
    expect(left).toEqual([]);
  });

  it("would catch the Settings title the review found, and the rest of its kind", () => {
    const probe = fileURLToPath(new URL("./fixtures/shown-text-probe.tsx", import.meta.url));
    expect(englishIn(probe).map((f) => f.text)).toEqual(["Settings", "Your balance", "Close", "Address", "key", "Unknown", "stake pool"]);
  });
});
