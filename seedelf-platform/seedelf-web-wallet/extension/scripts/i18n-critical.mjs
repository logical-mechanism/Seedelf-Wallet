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
//      or anything with `role="alert"`, a callout whose tone is worked out as
//      it renders included when it can come out as one.
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
// What source 1 can't see, the name has to carry: a warning whose words come
// from a helper it calls, a const put together above it, or a component it
// renders. Source 1 reads only the element's own JSX, and the review of
// 2026-10-04 found warnings built that way shipping as unchecked machine
// drafts: a dApp's withdrawal, Remove wallet's list, a paused swap's reason.
// `keysThroughHelpers` below follows those names and finds every key a
// critical element shows that way; `tests/i18n-critical-helpers.test.ts`
// fails on any that isn't in the set, so it gets its `.warn.` or `.privacy.`.
//
//   node scripts/i18n-critical.mjs           # print the set
//   node scripts/i18n-critical.mjs --write   # update docs/i18n/critical-keys.json
//
// `tests/i18n.test.ts` regenerates it and fails if the checked-in file drifts.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAst } from "vite";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
export const CRITICAL_FILE = fileURLToPath(new URL("../../docs/i18n/critical-keys.json", import.meta.url));

const sources = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const path = `${dir}/${f}`;
    return statSync(path).isDirectory() ? sources(path) : /\.tsx$/.test(f) ? [path] : [];
  });

const TONES = new Set(["privacy", "warn"]);

/** An element that makes what's inside it a warning, a privacy note or an error. */
function isCriticalElement(node) {
  const open = node.openingElement;
  if (!open) return false;
  const name = open.name?.name;
  const attr = (want) => open.attributes?.find((a) => a.type === "JSXAttribute" && a.name?.name === want);
  const role = attr("role");
  if (role?.value?.type === "Literal" && role.value.value === "alert") return true;
  if (name !== "Callout") return false;
  const tone = attr("tone")?.value;
  // No tone is `info`, which is an explanation rather than a decision.
  if (!tone) return false;
  if (tone.type === "Literal") return TONES.has(tone.value);
  // A tone worked out as it renders counts when it can come out as one: an
  // expression that names "warn" or "privacy" (the dApp's staking callout,
  // `own ? "warn" : "info"`), or one that names no tone at all (Remove
  // Seedelf's `note.tone`), since then the source can't say which it is.
  const named = stringsIn(tone.expression);
  return named.length === 0 || named.some((s) => TONES.has(s));
}

/** The string literals in an expression, wherever they sit in it. */
function stringsIn(node, into = []) {
  if (!node || typeof node !== "object") return into;
  if (Array.isArray(node)) {
    for (const child of node) stringsIn(child, into);
    return into;
  }
  if (node.type === "Literal" && typeof node.value === "string") into.push(node.value);
  for (const child of Object.values(node)) if (child && typeof child === "object") stringsIn(child, into);
  return into;
}

/**
 * Controls whose own label is navigation, not the message. A `role="alert"`
 * wrapper holds the warning *and* the buttons under it ("Try again", "Lock"),
 * and a button's label is not where a wrong translation costs money — the
 * sentence above it is. Their subtrees are skipped.
 */
const CONTROLS = new Set(["button", "a", "select", "input", "textarea", "label"]);

/** Flat dot-notation, two segments at least: what a key looks like and a sentence doesn't. */
const KEY = /^[a-z][\w]*(\.[\w]+){1,}$/;

/** Every key named by a string literal in a subtree, minus the controls' own labels. */
function keysIn(node, into) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((c) => keysIn(c, into));
  if (node.type === "JSXElement" && CONTROLS.has(node.openingElement?.name?.name)) return;
  if (node.type === "Literal" && typeof node.value === "string" && KEY.test(node.value)) into.add(node.value);
  for (const child of Object.values(node)) if (child && typeof child === "object") keysIn(child, into);
}

/** A key whose own name says it carries a privacy decision or a warning. */
export const criticalByName = (key) => /\.(privacy|warn)\./.test(key);

/**
 * `x.y_one` → `x.y`. The set is kept in base keys only: a plural is named by
 * its base at the call site, so a set holding `_one` and `_other` separately
 * would not match the base a source literal gives, and the gate would miss it.
 */
const baseOf = (key) => key.replace(/_(few|many|one|other|two|zero)$/, "");

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
  return [...new Set([...found].map(baseOf))].sort();
}

// ---------------------------------------------------------------------------
// What a critical element shows from outside its own JSX
// ---------------------------------------------------------------------------

/**
 * Where a name may be followed: the screens' own code. Not `src/i18n`, the
 * machinery (`t`, `joinList`, `joinSentences`), whose own keys are a
 * language's punctuation, held by tests/i18n-joins.test.ts; not React or any
 * other package; not the worker, which a screen reaches only by message.
 */
const FOLLOWED = [`${SRC}/ui/`, `${SRC}/shared/`];

const FUNCTION = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/;

const readSource = (path) => (existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : undefined);

/** An imported or exported name: an identifier, or a string (`import { "a-b" as c }`). */
const nameOf = (id) => id.name ?? id.value;

/** The names a declaration or a parameter binds: `x`, `{ a, b: c }`, `[d, ...e]`, `f = 1`. */
function bound(pattern) {
  if (!pattern) return [];
  if (pattern.type === "Identifier") return [pattern.name];
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(bound);
  if (pattern.type === "ObjectPattern") return pattern.properties.flatMap((p) => bound(p.value ?? p.argument));
  if (pattern.type === "AssignmentPattern") return bound(pattern.left);
  if (pattern.type === "RestElement") return bound(pattern.argument);
  return [];
}

/** The default values in a pattern, `f = t("x")`: the only part of one that is an expression. */
function defaultsOf(pattern) {
  if (!pattern) return [];
  if (pattern.type === "AssignmentPattern") return [pattern.right, ...defaultsOf(pattern.left)];
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(defaultsOf);
  if (pattern.type === "ObjectPattern") return pattern.properties.flatMap((p) => defaultsOf(p.value ?? p.argument));
  if (pattern.type === "RestElement") return defaultsOf(pattern.argument);
  return [];
}

/** What a statement declares, into `scope`: each name to its function, or to the expression it was given. */
function declare(statement, scope) {
  if (statement?.type === "FunctionDeclaration" && statement.id) scope.set(statement.id.name, statement);
  if (statement?.type === "VariableDeclaration") {
    for (const d of statement.declarations) for (const name of bound(d.id)) scope.set(name, d.init ?? null);
  }
}

/**
 * `createContext(…)`: its argument is what a component sees with no provider
 * above it. No screen renders without one, so none of it shows; a hook that
 * hands out the context's booleans would otherwise bring the default's words.
 */
const isContextDefault = (node) =>
  node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "createContext";

/**
 * Every key a critical element can show through something other than its own
 * JSX, which is all `criticalKeys` reads: a function it calls, a name it reads
 * (a const put together above it, an object of getters, a function handed to
 * `map`), a component it renders, and theirs in turn. A name is followed to
 * where it is declared, in a scope around its use or at the top of its file,
 * or through an import into a file under `follow`.
 *
 * Left out, because none of it shows inside the element: an event handler (it
 * runs on a click), a control's own label (as `keysIn` skips it), a type, and
 * a context's default value.
 *
 * Not reached either: words a caller hands a component as a prop, and the
 * worker's own messages (an error a screen's alert shows, a refusal's
 * detail), which come in at run time from src/background.
 *
 * `keys` are the real ones, en.json's: a literal counts when it names one.
 * `files`, where to look for critical elements; `read`, a file's source or
 * undefined when there is none, so a test can hand it files of its own.
 * Returns, for each critical element, an entry per key by its shortest route:
 * `key` (its base), `at` (the element, `ui/screens/X.tsx:12`) and `via` (the
 * names followed, outermost first).
 */
export function keysThroughHelpers({
  keys,
  files = sources(`${SRC}/ui`),
  follow = FOLLOWED,
  read = readSource,
  root = SRC,
}) {
  const known = new Set(keys.map(baseOf));
  const texts = new Map();
  const text = (file) => {
    if (!texts.has(file)) texts.set(file, read(file));
    return texts.get(file);
  };
  const resolveImport = (from, spec) => {
    if (!spec.startsWith(".")) return undefined;
    const base = resolve(dirname(from), spec);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
    return candidates.find((p) => text(p) !== undefined);
  };

  const modules = new Map();
  /** A file's top-level names and what it imports, parsed once. */
  const load = (file) => {
    if (modules.has(file)) return modules.get(file);
    const source = text(file);
    const ast = parseAst(source, { lang: file.endsWith(".tsx") ? "tsx" : "ts" });
    const top = new Map();
    const imports = new Map();
    for (const statement of ast.body) {
      const importing = statement.type === "ImportDeclaration";
      if (importing || (statement.type === "ExportNamedDeclaration" && statement.source)) {
        // `import { a as b }` names a b here; `export { a as b } from` offers a as b.
        const from = resolveImport(file, statement.source.value);
        for (const s of statement.specifiers ?? []) {
          if (s.type === "ImportNamespaceSpecifier") continue;
          const here = nameOf(importing ? s.local : s.exported);
          const there = s.type === "ImportDefaultSpecifier" ? "default" : nameOf(importing ? s.imported : s.local);
          imports.set(here, { from, name: there });
        }
        continue;
      }
      if (statement.type === "ExportDefaultDeclaration") top.set("default", statement.declaration);
      declare(statement.declaration ?? statement, top);
    }
    const mod = { source, ast, top, imports };
    modules.set(file, mod);
    return mod;
  };

  /**
   * Where `name`, read in `file` inside `scopes`, is declared: the innermost
   * scope first, then the file, then its imports.
   */
  const lookup = (name, file, scopes) => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (!scopes[i].has(name)) continue;
      const node = scopes[i].get(name);
      // A parameter, or a name declared with nothing given: what it holds comes from elsewhere.
      return node ? { file, node, scopes: scopes.slice(0, i + 1) } : undefined;
    }
    return declaredIn(file, name);
  };
  const declaredIn = (file, name, depth = 0) => {
    if (!file || depth > 8) return undefined;
    const mod = load(file);
    const node = mod.top.get(name);
    if (node) return { file, node, scopes: [] };
    const imported = mod.imports.get(name);
    if (!imported?.from || !follow.some((dir) => imported.from.startsWith(dir))) return undefined;
    return declaredIn(imported.from, imported.name, depth + 1);
  };

  const locals = new WeakMap();
  /** A function's own names: its parameters, which can't be followed, and what its body declares. */
  const localsOf = (fn) => {
    if (locals.has(fn)) return locals.get(fn);
    const scope = new Map();
    for (const p of fn.params) for (const name of bound(p)) scope.set(name, null);
    const scan = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(scan);
      if (FUNCTION.test(node.type)) {
        // A function declared here is a name here; what it declares is its own.
        if (node.type === "FunctionDeclaration" && node.id) scope.set(node.id.name, node);
        return;
      }
      if (node.type === "VariableDeclaration") declare(node, scope);
      for (const child of Object.values(node)) if (child && typeof child === "object") scan(child);
    };
    scan(fn.body);
    locals.set(fn, scope);
    return scope;
  };

  const memo = new Map();
  /** The keys following `name` from here shows, each with the route to it. */
  const through = (name, file, scopes, label) => {
    const declared = lookup(name, file, scopes);
    if (!declared) return [];
    const { node } = declared;
    if (!memo.has(node)) {
      memo.set(node, []); // a name that leads back to itself finds nothing more there
      const inner = [];
      if (FUNCTION.test(node.type)) {
        const scope = [...declared.scopes, localsOf(node)];
        walk(declared.file, [node.params.flatMap(defaultsOf), node.body], scope, inner);
      } else if (!isContextDefault(node)) {
        walk(declared.file, node, declared.scopes, inner);
      }
      memo.set(node, shortest(inner));
    }
    return memo.get(node).map((e) => ({ key: e.key, via: [label, ...e.via] }));
  };

  /** Every key `node` names, and what the names it uses show, into `out`. */
  const walk = (file, node, scopes, out) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(file, child, scopes, out);
      return;
    }
    const type = node.type;
    // A type says nothing a user reads; `x as T` and `x!` still hold an expression.
    if (typeof type === "string" && type.startsWith("TS")) return walk(file, node.expression, scopes, out);
    switch (type) {
      case "Literal":
        if (typeof node.value === "string" && KEY.test(node.value) && known.has(baseOf(node.value))) {
          out.push({ key: baseOf(node.value), via: [] });
        }
        return;
      case "Identifier":
        out.push(...through(node.name, file, scopes, node.name));
        return;
      case "JSXElement": {
        const name = node.openingElement.name;
        if (name.type === "JSXIdentifier" && CONTROLS.has(name.name)) return;
        if (name.type === "JSXIdentifier" && /^[A-Z]/.test(name.name)) {
          out.push(...through(name.name, file, scopes, `<${name.name}>`));
        }
        walk(file, [node.openingElement.attributes, node.children], scopes, out);
        return;
      }
      case "JSXAttribute":
        // A handler runs on a click, and a key or a ref is React's: none of them shows here.
        if (/^(on[A-Z]|key$|ref$)/.test(node.name?.name ?? "")) return;
        return walk(file, node.value, scopes, out);
      case "MemberExpression":
        walk(file, node.object, scopes, out);
        if (node.computed) walk(file, node.property, scopes, out);
        return;
      case "Property":
        if (node.computed) walk(file, node.key, scopes, out);
        return walk(file, node.value, scopes, out);
      case "VariableDeclarator":
        return walk(file, [...defaultsOf(node.id), node.init], scopes, out);
      case "FunctionDeclaration":
        // It shows only where it is used, and is followed from there.
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        // Written inline (a `map` callback, a getter): its body runs here, with its own names.
        const scope = [...scopes, localsOf(node)];
        walk(file, [node.params.flatMap(defaultsOf), node.body], scope, out);
        return;
      }
      case "LabeledStatement":
        return walk(file, node.body, scopes, out);
      case "BreakStatement":
      case "ContinueStatement":
        return;
      case "CatchClause":
        return walk(file, node.body, scopes, out);
      default:
        for (const [field, child] of Object.entries(node)) {
          if (field !== "type" && child && typeof child === "object") walk(file, child, scopes, out);
        }
    }
  };

  const found = [];
  for (const file of files) {
    const { ast, source } = load(file);
    const at = (node) => `${relative(root, file)}:${source.slice(0, node.start).split("\n").length}`;
    // Down to each critical element, keeping the scopes around it.
    const visit = (node, scopes) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach((child) => visit(child, scopes));
      if (FUNCTION.test(node.type)) return visit(node.body, [...scopes, localsOf(node)]);
      if (node.type === "JSXElement" && isCriticalElement(node)) {
        const out = [];
        walk(file, node, scopes, out);
        // What its own JSX names is criticalKeys' to read; this is the rest.
        for (const { key, via } of shortest(out.filter((e) => e.via.length))) found.push({ key, at: at(node), via });
      }
      for (const [field, child] of Object.entries(node)) {
        if (field !== "type" && child && typeof child === "object") visit(child, scopes);
      }
    };
    visit(ast, []);
  }
  return found;
}

/**
 * One route per key, the shortest: enough to say where a key comes from, and
 * a helper reached a dozen ways (a token's name is) stays one entry, not a
 * dozen multiplied at every step out.
 */
function shortest(entries) {
  const best = new Map();
  for (const e of entries) if (!best.has(e.key) || e.via.length < best.get(e.key).via.length) best.set(e.key, e);
  return [...best.values()];
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
