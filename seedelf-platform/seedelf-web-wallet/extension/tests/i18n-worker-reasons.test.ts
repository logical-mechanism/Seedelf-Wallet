// The worker's reasons, which warnings show. The worker speaks the user's
// language (sw.ts), so the reasons it writes reach the screens in it: a
// paused swap's warning says which check what Minswap built failed (a
// Refused's detail), a swap's approval why Lovejoin's pool takes no box (its
// quote's `skipped`), and a return's warning, a session's and Bring
// everything back's why Lovejoin was left out (`lovejoinSkipped`). The
// critical-set deriver reads the screens' JSX, and keysThroughHelpers
// follows the screens' own code (scripts/i18n-critical.mjs): neither sees
// what comes in at run time from src/background. That is how the review of
// 2026-10-04 found every one of these reasons an unchecked machine draft,
// inside warnings whose own words were checked. Each is named `.warn.`
// instead (`sess.refuse.warn.*`, `sess.skip.warn.*`, `lj.skip.warn.*`), and
// this holds it there: every key src/background gives a reason error,
// returns from a reason helper or writes to a field a warning shows must be
// accuracy-critical.
//
// What it can't see is a reason that arrives as an error's own words, so
// those routes are listed below by hand (RUNTIME). And the warnings that show
// these fields are listed too (SHOWN_IN), with a check that each still does,
// so a frame that stops taking the worker's words sends someone back here.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAst } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import { criticalByName, criticalKeys } from "../scripts/i18n-critical.mjs";
import { Refused } from "../src/background/sessions";
import { i18n, t as tr } from "../src/i18n/core";
import { NETWORKS } from "../src/networks";
import { pauseText } from "../src/ui/screens/Swaps";
import { withoutStop } from "../src/ui/sentence";
import { CHAINS, withSession } from "./chain-fixtures";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const BACKGROUND = `${SRC}/background`;
const en: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/i18n/translations/en.json", import.meta.url), "utf8"),
);
const CRITICAL = new Set(criticalKeys(Object.keys(en)));

/** The errors whose argument is the reason: a paused swap shows a Refused's, a return a LovejoinSkipped's. */
const REASON_ERRORS = new Set(["Refused", "LovejoinSkipped"]);
/** The helpers whose return is a reason: why a chain failed, a message made a clause of one, the pool too thin. */
const REASON_FUNCTIONS = new Set(["leftOut", "clauseOf", "poolShort", "floorShort"]);
/** The fields a warning shows as a reason: what's assigned to them, or given them in an object. */
const REASON_FIELDS = new Set(["skipped", "lovejoinSkipped"]);
/** A pause's own field: `paused = { …, detail }`. */
const PAUSED = { field: "paused", reason: "detail" };

/**
 * Words a reason takes from the rest of the wallet rather than words of its
 * own, as tests/i18n-critical-helpers.test.ts's SHARED_WORDS are for the
 * screens: each shows on its own elsewhere, where it warns of nothing, and
 * none can turn what a reason says around.
 */
const BORROWED: Record<string, string> = {
  "histories.list.and": "a list's punctuation: the DEXes Minswap now routes through, joined",
};

/**
 * Reasons that reach a warning as an error's own words, which the scan
 * can't follow: each is named, and the error still says it.
 */
const RUNTIME: Array<{ key: string; file: string; error: string; why: string }> = [
  {
    key: "sess.refuse.warn.wontSign",
    file: "background/sessions.ts",
    error: "Refused",
    why: "the review's alert shows a Refused's own words (swapBuild, inspect)",
  },
  {
    key: "worker.record.warn.unreadable",
    file: "background/private-store.ts",
    error: "UnreadableRecordError",
    why: "a chain that reads Lovejoin's record quotes it in sess.skip.warn.chainFailed (leftOut)",
  },
];

/**
 * The warnings that show the worker's reasons, each by the key that wraps
 * the reason and the placeholder it fills: what makes the fields above
 * the ones that matter.
 */
const SHOWN_IN: Array<{ field: string; frame: string; placeholder: string }> = [
  { field: "SessionPause.detail (a Refused's)", frame: "swaps.pause.warn.refused", placeholder: "detail" },
  { field: "SwapLovejoin.skipped (poolShort's)", frame: "swaps.lovejoin.warn.pool", placeholder: "why" },
  { field: "SessionBackSummary.lovejoinSkipped", frame: "lovejoin.warn.skippedThis", placeholder: "why" },
  { field: "SessionView.lovejoinSkipped", frame: "lovejoin.warn.skippedIts", placeholder: "why" },
  { field: "Bring everything back's lovejoinSkipped", frame: "claim.warn.skippedItem", placeholder: "why" },
];

type Node = { type: string; start: number; end: number; [key: string]: unknown };

/** A key the worker gives as a reason a warning shows. */
interface ReasonKey {
  /** The key, by its base. */
  key: string;
  /** Where it's given: `background/sessions.ts:2350`. */
  at: string;
  /** How: `new Refused`, `leftOut's return`, `skipped =`, `.skipped =`, `lovejoinSkipped:`, `paused.detail`. */
  sink: string;
  /** The names followed to it, outermost first. */
  via: string[];
}

/** Flat dot-notation, two segments at least: what a key looks like and a sentence doesn't. */
const KEY = /^[a-z][\w]*(\.[\w]+){1,}$/;
const baseOf = (key: string) => key.replace(/_(few|many|one|other|two|zero)$/, "");
const FUNCTION = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/;

/** Every file under `dir` whose name `matches`. */
const sources = (dir: string, matches = /\.ts$/): string[] =>
  readdirSync(dir).flatMap((f) => {
    const path = `${dir}/${f}`;
    return statSync(path).isDirectory() ? sources(path, matches) : matches.test(f) ? [path] : [];
  });

const readSource = (path: string) =>
  existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : undefined;

/** A node's children: every field but its type that holds a node or a list of them. */
const childrenOf = (n: Node): unknown[] =>
  Object.entries(n).flatMap(([field, child]) => (field !== "type" && child && typeof child === "object" ? [child] : []));

/** The names a declaration or a parameter binds: `x`, `{ a, b: c }`, `[d, ...e]`, `f = 1`. */
function bound(pattern: Node | null | undefined): string[] {
  if (!pattern) return [];
  if (pattern.type === "Identifier") return [pattern.name as string];
  if (pattern.type === "ArrayPattern") return (pattern.elements as Array<Node | null>).flatMap(bound);
  if (pattern.type === "ObjectPattern") {
    return (pattern.properties as Node[]).flatMap((p) => bound((p.value ?? p.argument) as Node));
  }
  if (pattern.type === "AssignmentPattern") return bound(pattern.left as Node);
  if (pattern.type === "RestElement") return bound(pattern.argument as Node);
  return [];
}

/** A property's name as written, `{ skipped }` or `{ "skipped": … }`; none for a computed one. */
function propertyName(p: Node): string | undefined {
  if (p.computed) return undefined;
  const key = p.key as Node;
  return key.type === "Identifier" ? (key.name as string) : typeof key.value === "string" ? key.value : undefined;
}

/** What `fn` can return: its return statements' values, not a nested function's, or an arrow's expression. */
function returnsOf(fn: Node): Node[] {
  const body = fn.body as Node;
  if (body.type !== "BlockStatement") return [body];
  const found: Node[] = [];
  const scan = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(scan);
    const n = node as Node;
    if (FUNCTION.test(n.type) || n.type === "ClassBody") return;
    if (n.type === "ReturnStatement" && n.argument) found.push(n.argument as Node);
    scan(childrenOf(n));
  };
  scan(body);
  return found;
}

/** Every string literal under `node`, into `into`. */
function literalsIn(node: unknown, into: string[] = []): string[] {
  if (!node || typeof node !== "object") return into;
  if (Array.isArray(node)) {
    for (const child of node) literalsIn(child, into);
    return into;
  }
  const n = node as Node;
  if (n.type === "Literal" && typeof n.value === "string") into.push(n.value);
  literalsIn(childrenOf(n), into);
  return into;
}

/**
 * Every key src/background gives as a reason a warning shows: the argument
 * of a reason error (REASON_ERRORS), what a reason helper returns
 * (REASON_FUNCTIONS), and what's written to a reason field (REASON_FIELDS,
 * a pause's `detail`). From each, it follows what the expression reads, as
 * keysThroughHelpers does for the screens: a function it calls, a const or a
 * variable (every value it's given), a method on `this`, an import from
 * another file under `follow`, and a key put into a key (a filler). What
 * decides between values (a condition's test) isn't followed: it shows
 * nothing. `files`, `read` and `root` are keysThroughHelpers' own, so a test
 * can hand it files of its own.
 */
function reasonKeys({
  keys,
  files = sources(BACKGROUND),
  follow = [`${BACKGROUND}/`],
  read = readSource,
  root = SRC,
}: {
  keys: string[];
  files?: string[];
  follow?: string[];
  read?: (path: string) => string | undefined;
  root?: string;
}): ReasonKey[] {
  const known = new Set(keys.map(baseOf));
  const texts = new Map<string, string | undefined>();
  const text = (file: string) => {
    if (!texts.has(file)) texts.set(file, read(file));
    return texts.get(file);
  };
  const resolveImport = (from: string, spec: string) => {
    if (!spec.startsWith(".")) return undefined;
    const base = resolve(dirname(from), spec);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
    return candidates.find((p) => text(p) !== undefined);
  };

  /** Each name, to the values it's given; null for one whose value comes from elsewhere (a parameter). */
  type Scope = Map<string, Node[] | null>;
  type Declared = { file: string; values: Node[]; scopes: Node[] };

  /** What each name in `scope` is given anywhere under `body`, a nested function included: `x = …`. */
  const assignedIn = (body: unknown, scope: Scope) => {
    const scan = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(scan);
      const n = node as Node;
      if (n.type === "AssignmentExpression" && (n.left as Node).type === "Identifier") {
        scope.get((n.left as Node).name as string)?.push(n.right as Node);
      }
      scan(childrenOf(n));
    };
    scan(body);
  };

  /** What a statement declares, into `scope`: a function or a class by itself, a variable by what it's given. */
  const declare = (statement: Node | null | undefined, scope: Scope) => {
    if (!statement) return;
    if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id) {
      scope.set((statement.id as Node).name as string, [statement]);
    }
    if (statement.type === "VariableDeclaration") {
      for (const d of statement.declarations as Node[]) {
        for (const name of bound(d.id as Node)) {
          const values = scope.get(name) ?? [];
          if (d.init) values.push(d.init as Node);
          scope.set(name, values);
        }
      }
    }
  };

  interface Module {
    source: string;
    ast: Node;
    top: Scope;
    imports: Map<string, { from: string | undefined; name: string }>;
    methods: Map<string, Node[]>;
  }
  const modules = new Map<string, Module>();
  /** A file's top-level names, what it imports and its classes' methods, parsed once. */
  const load = (file: string): Module => {
    const kept = modules.get(file);
    if (kept) return kept;
    const source = text(file) ?? "";
    const ast = parseAst(source, { lang: file.endsWith(".tsx") ? "tsx" : "ts" }) as unknown as Node;
    const top: Scope = new Map();
    const imports = new Map<string, { from: string | undefined; name: string }>();
    const methods = new Map<string, Node[]>();
    const nameOf = (id: Node) => (id.name ?? id.value) as string;
    for (const statement of ast.body as Node[]) {
      const importing = statement.type === "ImportDeclaration";
      if (importing || (statement.type === "ExportNamedDeclaration" && statement.source)) {
        // `import { a as b }` names a b here; `export { a as b } from` offers a as b.
        const from = resolveImport(file, (statement.source as Node).value as string);
        for (const s of (statement.specifiers as Node[] | undefined) ?? []) {
          if (s.type === "ImportNamespaceSpecifier") continue;
          const here = nameOf((importing ? s.local : s.exported) as Node);
          const there =
            s.type === "ImportDefaultSpecifier" ? "default" : nameOf((importing ? s.imported : s.local) as Node);
          imports.set(here, { from, name: there });
        }
        continue;
      }
      declare(((statement.declaration as Node | null | undefined) ?? statement) as Node, top);
    }
    assignedIn(ast.body, top);
    const scan = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(scan);
      const n = node as Node;
      if ((n.type === "MethodDefinition" || n.type === "PropertyDefinition") && n.value) {
        const value = n.value as Node;
        const name = propertyName(n);
        if (name && FUNCTION.test(value.type)) methods.set(name, [...(methods.get(name) ?? []), value]);
      }
      scan(childrenOf(n));
    };
    scan(ast);
    const mod = { source, ast, top, imports, methods };
    modules.set(file, mod);
    return mod;
  };

  const locals = new WeakMap<Node, Scope>();
  /** A function's own names: its parameters, which can't be followed, and what its body declares. */
  const localsOf = (fn: Node): Scope => {
    const kept = locals.get(fn);
    if (kept) return kept;
    const scope: Scope = new Map();
    for (const p of fn.params as Node[]) for (const name of bound(p)) scope.set(name, null);
    const scan = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(scan);
      const n = node as Node;
      if (FUNCTION.test(n.type)) {
        // A function declared here is a name here; what it declares is its own.
        if (n.type === "FunctionDeclaration") declare(n, scope);
        return;
      }
      if (n.type === "VariableDeclaration") declare(n, scope);
      // A caught error is the run time's.
      if (n.type === "CatchClause") for (const name of bound(n.param as Node)) scope.set(name, null);
      scan(childrenOf(n));
    };
    scan(fn.body);
    assignedIn(fn.body, scope);
    locals.set(fn, scope);
    return scope;
  };

  /** Where `name`, read in `file` inside `scopes`, is declared: the innermost scope, then the file, then its imports. */
  const lookup = (name: string, file: string, scopes: Node[]): Declared | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const scope = localsOf(scopes[i]!);
      if (!scope.has(name)) continue;
      const values = scope.get(name);
      return values ? { file, values, scopes: scopes.slice(0, i + 1) } : undefined;
    }
    return declaredIn(file, name);
  };
  const declaredIn = (file: string | undefined, name: string, depth = 0): Declared | undefined => {
    if (!file || depth > 8) return undefined;
    const mod = load(file);
    const values = mod.top.get(name);
    if (values) return { file, values, scopes: [] };
    const imported = mod.imports.get(name);
    const from = imported?.from;
    if (!imported || !from || !follow.some((dir) => from.startsWith(dir))) return undefined;
    return declaredIn(from, imported.name, depth + 1);
  };

  type Found = { key: string; via: string[] };
  const memo = new Map<Node, Found[]>();
  /** The keys a value shows: a function's by what it returns, anything else by itself. */
  const valueKeys = (file: string, value: Node, scopes: Node[]): Found[] => {
    const kept = memo.get(value);
    if (kept) return kept;
    memo.set(value, []); // a value that leads back to itself finds nothing more there
    const inner: Found[] = [];
    if (FUNCTION.test(value.type)) walk(file, returnsOf(value), [...scopes, value], inner);
    else if (value.type !== "ClassDeclaration") walk(file, value, scopes, inner);
    const best = shortest(inner);
    memo.set(value, best);
    return best;
  };
  const named = (name: string, found: Found[]) => shortest(found).map((e) => ({ key: e.key, via: [name, ...e.via] }));
  const through = (name: string, file: string, scopes: Node[]): Found[] => {
    const declared = lookup(name, file, scopes);
    if (!declared) return [];
    return named(name, declared.values.flatMap((v) => valueKeys(declared.file, v, declared.scopes)));
  };
  const method = (name: string, file: string): Found[] =>
    named(name, (load(file).methods.get(name) ?? []).flatMap((fn) => valueKeys(file, fn, [])));

  /** Every key `node` can show, and what the names it reads show, into `out`. */
  const walk = (file: string, node: unknown, scopes: Node[], out: Found[]): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(file, child, scopes, out);
      return;
    }
    const n = node as Node;
    // A type says nothing a user reads; `x as T` and `x!` still hold an expression.
    if (n.type.startsWith("TS")) return walk(file, n.expression, scopes, out);
    switch (n.type) {
      case "Literal":
        if (typeof n.value === "string" && KEY.test(n.value) && known.has(baseOf(n.value))) {
          out.push({ key: baseOf(n.value), via: [] });
        }
        return;
      case "TemplateLiteral":
        return walk(file, n.expressions, scopes, out);
      case "Identifier":
        out.push(...through(n.name as string, file, scopes));
        return;
      case "ThisExpression":
        return;
      case "MemberExpression": {
        const property = n.property as Node;
        if ((n.object as Node).type === "ThisExpression" && !n.computed && property.type === "Identifier") {
          out.push(...method(property.name as string, file));
          return;
        }
        walk(file, n.object, scopes, out);
        if (n.computed) walk(file, property, scopes, out);
        return;
      }
      case "CallExpression":
        return walk(file, [n.callee, n.arguments], scopes, out);
      case "NewExpression":
        return walk(file, n.arguments, scopes, out);
      case "ConditionalExpression":
        // Its test picks a value and shows nothing (clauseOf reads sess.skip.warn.chainFailed's first letter there).
        return walk(file, [n.consequent, n.alternate], scopes, out);
      case "BinaryExpression":
        // Only `+` makes a string of its sides: a comparison shows neither.
        if (n.operator === "+") walk(file, [n.left, n.right], scopes, out);
        return;
      case "UnaryExpression":
      case "UpdateExpression":
        return;
      case "AssignmentExpression":
        return walk(file, n.right, scopes, out);
      case "ObjectExpression":
        for (const p of n.properties as Node[]) {
          if (p.type === "SpreadElement") walk(file, p.argument, scopes, out);
          else walk(file, [p.computed ? p.key : null, p.value], scopes, out);
        }
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        // Written inline: its body runs here, with its own names.
        return walk(file, returnsOf(n), [...scopes, n], out);
      case "FunctionDeclaration":
      case "ClassDeclaration":
      case "ClassExpression":
        return;
      default:
        walk(file, childrenOf(n), scopes, out);
    }
  };

  const found: ReasonKey[] = [];
  for (const file of files) {
    const { ast, source } = load(file);
    const record = (at: Node, sink: string, value: unknown, scopes: Node[]) => {
      const out: Found[] = [];
      walk(file, value, scopes, out);
      const where = `${relative(root, file)}:${source.slice(0, at.start).split("\n").length}`;
      for (const { key, via } of shortest(out)) found.push({ key, at: where, sink, via });
    };
    /** A pause's object: its `detail` is the reason. */
    const paused = (object: Node, scopes: Node[]) => {
      for (const p of object.properties as Node[]) {
        if (p.type !== "Property" || propertyName(p) !== PAUSED.reason) continue;
        record(p, `${PAUSED.field}.${PAUSED.reason}`, p.value, scopes);
      }
    };
    /** A reason helper: what it returns, with its own names. */
    const helper = (at: Node, name: string | undefined, fn: Node | null | undefined, scopes: Node[]) => {
      if (!name || !REASON_FUNCTIONS.has(name) || !fn || !FUNCTION.test(fn.type)) return;
      record(at, `${name}'s return`, returnsOf(fn), [...scopes, fn]);
    };
    const visit = (node: unknown, scopes: Node[]): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach((child) => visit(child, scopes));
      const n = node as Node;
      switch (n.type) {
        case "FunctionDeclaration":
          helper(n, (n.id as Node | null)?.name as string | undefined, n, scopes);
          break;
        case "MethodDefinition":
        case "PropertyDefinition":
          helper(n, propertyName(n), n.value as Node | null, scopes);
          break;
        case "VariableDeclarator": {
          const id = n.id as Node;
          const init = n.init as Node | null;
          if (id.type !== "Identifier") break;
          const name = id.name as string;
          helper(n, name, init, scopes);
          if (REASON_FIELDS.has(name) && init) record(n, `${name} =`, init, scopes);
          if (name === PAUSED.field && init?.type === "ObjectExpression") paused(init, scopes);
          break;
        }
        case "NewExpression": {
          const callee = n.callee as Node;
          const name = callee.type === "Identifier" ? (callee.name as string) : undefined;
          if (name && REASON_ERRORS.has(name)) record(n, `new ${name}`, n.arguments, scopes);
          break;
        }
        case "AssignmentExpression": {
          // `skipped = …` is a variable's, `r.mix.skipped = …` a field's.
          const left = n.left as Node;
          const member = left.type === "MemberExpression" && !left.computed;
          const name = (left.type === "Identifier" ? left.name : member ? (left.property as Node).name : undefined) as
            | string
            | undefined;
          if (name && REASON_FIELDS.has(name)) record(n, `${member ? "." : ""}${name} =`, n.right, scopes);
          if (name === PAUSED.field && (n.right as Node).type === "ObjectExpression") paused(n.right as Node, scopes);
          break;
        }
        case "ObjectExpression":
          for (const p of n.properties as Node[]) {
            if (p.type !== "Property") continue;
            const name = propertyName(p);
            if (name && REASON_FIELDS.has(name)) record(p, `${name}:`, p.value, scopes);
            if (name === PAUSED.field && (p.value as Node).type === "ObjectExpression") paused(p.value as Node, scopes);
          }
          break;
      }
      if (FUNCTION.test(n.type)) {
        const inner = [...scopes, n];
        visit(n.params, inner);
        visit(n.body, inner);
        return;
      }
      visit(childrenOf(n), scopes);
    };
    visit(ast, []);
  }
  return found;
}

/** One route per key, the shortest, as keysThroughHelpers keeps them. */
function shortest<T extends { key: string; via: string[] }>(entries: T[]): T[] {
  const best = new Map<string, T>();
  for (const e of entries) if (!best.has(e.key) || e.via.length < best.get(e.key)!.via.length) best.set(e.key, e);
  return [...best.values()];
}

/** What the guard fails on: a reason's key neither in the set nor a word it borrows, where it's given. */
const unnamed = (found: ReasonKey[], critical: (key: string) => boolean) => {
  const lines = found
    .filter(({ key }) => !critical(key) && !(key in BORROWED))
    .map(({ key, at, sink, via }) => `${key}: ${at}, ${sink}${via.length ? ` through ${via.join(" → ")}` : ""}`);
  return [...new Set(lines)].sort();
};

/** Parsed once: it reads every file under src/background and follows what each reason reads. */
const FOUND = reasonKeys({ keys: Object.keys(en) });

describe("a reason the worker gives a warning", () => {
  it("is accuracy-critical, or a word it borrows", () => {
    expect(
      unnamed(FOUND, (key) => CRITICAL.has(key)),
      "the worker gives these as a reason a warning shows, where the critical-set deriver can't see them: give " +
        "each a `.warn.` segment (sess.refuse.warn.*, sess.skip.warn.*, lj.skip.warn.*), run " +
        "`node scripts/i18n-critical.mjs --write`, and back-translate it into verified-critical-es.json and -ja.json",
    ).toEqual([]);
  });

  // A guard that follows nothing passes everything: these are the routes the
  // review found, each reached as the worker gives it and so held by name.
  // "-": given there itself, nothing followed.
  it.each([
    ["sess.refuse.warn.otherAddress", "new Refused", "-", "background/sessions.ts"],
    ["sess.refuse.warn.moreAda", "new Refused", "-", "background/sessions.ts"],
    ["sess.refuse.warn.nowRoutes", "new Refused", "-", "background/sessions.ts"],
    ["lj.skip.warn.floorShort", "new LovejoinSkipped", "short", "background/lovejoin.ts"],
    ["lj.skip.warn.needsMore", "new LovejoinSkipped", "-", "background/lovejoin.ts"],
    ["lj.skip.warn.measuredDifferently", "new LovejoinSkipped", "-", "background/lovejoin.ts"],
    ["sess.skip.warn.noCollateral", "skipped =", "NO_COLLATERAL", "background/sessions.ts"],
    ["sess.skip.warn.restNotBack", "skipped =", "REST_NOT_BACK", "background/sessions.ts"],
    ["sess.skip.warn.chainFailed", "skipped =", "leftOut", "background/sessions.ts"],
    ["sess.skip.warn.mixStopped", "skipped =", "-", "background/sessions.ts"],
    ["sess.skip.warn.mixCannotPay", "lovejoinSkipped:", "skipped", "background/sessions.ts"],
    ["sess.skip.warn.poolFloor", "skipped:", "skipped", "background/sessions.ts"],
    ["sess.skip.warn.deep", "poolShort's return", "-", "background/sessions.ts"],
  ])("%s is given as %s, through %s, in %s, and is critical", (key, sink, first, file) => {
    const routes = FOUND.filter((r) => r.key === key);
    expect(
      routes.some((r) => r.sink === sink && (r.via[0] ?? "-") === first && r.at.startsWith(`${file}:`)),
      JSON.stringify(routes),
    ).toBe(true);
    expect(CRITICAL.has(key)).toBe(true);
  });

  it.each(Object.keys(BORROWED))("%s, borrowed, is still given that way and still not critical", (key) => {
    expect(en[key] ?? en[`${key}_other`], "no such key: take it off the list").toBeDefined();
    expect(FOUND.some((r) => r.key === key), "no reason borrows it any more: take it off the list").toBe(true);
    expect(CRITICAL.has(key), "it is critical now: take it off the list").toBe(false);
  });

  it.each(RUNTIME)("$key reaches a warning at run time ($why), and is critical", ({ key, file, error }) => {
    expect(CRITICAL.has(key)).toBe(true);
    // The error still says it: a literal its constructor hands `super`.
    const ast = parseAst(readFileSync(`${SRC}/${file}`, "utf8"), { lang: "ts" }) as unknown as Node;
    const said: string[] = [];
    const visit = (node: unknown, inside: boolean): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach((child) => visit(child, inside));
      const n = node as Node;
      const here = inside || (n.type === "ClassDeclaration" && (n.id as Node | null)?.name === error);
      if (here && n.type === "CallExpression" && (n.callee as Node).type === "Super") literalsIn(n.arguments, said);
      visit(childrenOf(n), here);
    };
    visit(ast, false);
    expect(said, `${error} no longer says ${key}: find where its words reach a warning now`).toContain(key);
  });

  it.each(SHOWN_IN)("$frame still shows $field, as {{$placeholder}}, and is critical", ({ frame, placeholder }) => {
    expect(CRITICAL.has(frame)).toBe(true);
    expect(en[frame]).toContain(`{{${placeholder}}}`);
    // A screen still hands the frame something for it: a call `t("frame", { placeholder: … })` under src/ui.
    const fills = (file: string) => {
      const source = readFileSync(file, "utf8");
      if (!source.includes(`"${frame}"`)) return false;
      const ast = parseAst(source, { lang: file.endsWith(".tsx") ? "tsx" : "ts" }) as unknown as Node;
      let hit = false;
      const visit = (node: unknown): void => {
        if (hit || !node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        const n = node as Node;
        if (n.type === "CallExpression") {
          const [key, values] = n.arguments as Array<Node | undefined>;
          if (key?.type === "Literal" && key.value === frame && values?.type === "ObjectExpression") {
            hit = (values.properties as Node[]).some((p) => p.type === "Property" && propertyName(p) === placeholder);
          }
        }
        visit(childrenOf(n));
      };
      visit(ast);
      return hit;
    };
    expect(
      sources(`${SRC}/ui`, /\.tsx?$/).some(fills),
      `no screen fills ${frame}'s {{${placeholder}}} any more: take it off SHOWN_IN, and check the reasons it showed`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The guard on files of its own
// ---------------------------------------------------------------------------

const ROOT = "/fixture/src";

/** reasonKeys over `files` alone, every one under background/ and followable. */
function scan(files: Record<string, string>, keys: string[]): ReasonKey[] {
  const follow = [`${ROOT}/background/`];
  return reasonKeys({ keys, files: Object.keys(files), follow, read: (path) => files[path], root: ROOT });
}

/** Each key found, by its file (its line aside), how it's given and the names followed to it. */
const routes = (found: ReasonKey[]) => {
  const lines = found.map(({ key, at, sink, via }) => {
    const file = at.replace(/:\d+$/, "");
    return `${key} @${file} ${sink}${via.length ? ` ${via.join(">")}` : ""}`;
  });
  return [...new Set(lines)].sort();
};

/**
 * The worker's reasons as they were before this round named them: the shape
 * of sessions.ts and lovejoin.ts at 795c271, cut down.
 */
const BEFORE = {
  [`${ROOT}/background/lovejoin.ts`]: `
    import { t } from "../i18n";
    export class LovejoinSkipped extends Error {
      constructor(readonly reason: string) {
        super(t("lj.leftOut", { reason }));
      }
    }
    export class Lovejoin {
      private floorShort(others: number): string | undefined {
        return others < 30 ? t("lj.floorShort", { count: others, floor: 30 }) : undefined;
      }
      fanOut(others: number, untold: number): void {
        const short = this.floorShort(others);
        if (short) throw new LovejoinSkipped(short);
        if (!others) throw new LovejoinSkipped(untold ? t("lj.untoldAll") : t("lj.noneLeft"));
        throw new Error(t("lj.notOnNetwork"));
      }
    }`,
  [`${ROOT}/background/reasons.ts`]: `
    import { t } from "../i18n";
    export const MEASURED = () => t("lj.measuredDifferently");
    export const WHY: Record<string, string> = { other: "sess.refuse.otherAddress", ada: "sess.refuse.moreAda" };`,
  [`${ROOT}/background/sessions.ts`]: `
    import { t } from "../i18n";
    import { LovejoinSkipped } from "./lovejoin";
    import { MEASURED, WHY } from "./reasons";
    export class Refused extends Error {
      constructor(readonly detail: string) {
        super(t("sess.refused", { detail }));
      }
    }
    const NO_COLLATERAL = () => t("sess.noCollateral");
    function leftOut(e: unknown): string {
      if (e instanceof LovejoinSkipped) return e.reason;
      return t("sess.chainFailed", { reason: clauseOf(String(e)) });
    }
    function clauseOf(message: string): string {
      const start = t("sess.chainFailed", { reason: "" }).charAt(0);
      return start === start.toUpperCase() ? message : message.toLowerCase();
    }
    function poolShort(free: number, depth: number): string | undefined {
      return free < 8 ? t("sess.poolFree", { count: free, deep: t("sess.deep", { count: depth }), needs: 8 }) : undefined;
    }
    export class Sessions {
      step(r: { auto: { paused?: unknown } }, e: unknown): void {
        if (e instanceof Refused) r.auto.paused = { why: "refused", detail: e.detail };
      }
      check(paid: number, kind: string): void {
        if (paid > 5) throw new Refused(t(WHY[kind] as "sess.refuse.moreAda"));
        if (paid > 9) throw new LovejoinSkipped(MEASURED());
      }
      back(collateral: boolean, record: { mix?: { skipped?: string } }) {
        let skipped: string | undefined;
        if (!collateral) skipped = NO_COLLATERAL();
        try {
          this.chain();
        } catch (e) {
          skipped = leftOut(e);
        }
        if (record.mix) record.mix.skipped = skipped ?? t("sess.mixStopped");
        return { ...(skipped ? { lovejoinSkipped: skipped } : {}) };
      }
      quote(free: number) {
        const skipped = poolShort(free, 2);
        return { ...(skipped ? { skipped } : {}) };
      }
      chain(): void {
        throw new Error(t("sess.chainSending"));
      }
    }`,
};
const BEFORE_KEYS = [
  "lj.floorShort",
  "lj.leftOut",
  "lj.measuredDifferently",
  "lj.noneLeft",
  "lj.notOnNetwork",
  "lj.untoldAll",
  "sess.chainFailed",
  "sess.chainSending",
  "sess.deep",
  "sess.mixStopped",
  "sess.noCollateral",
  "sess.poolFree",
  "sess.refuse.moreAda",
  "sess.refuse.otherAddress",
  "sess.refused",
];

describe("reasonKeys", () => {
  it("finds every reason as the worker gave it before this round named them, and so would have failed", () => {
    const found = scan(BEFORE, BEFORE_KEYS);
    expect(routes(found)).toEqual([
      "lj.floorShort @background/lovejoin.ts floorShort's return",
      "lj.floorShort @background/lovejoin.ts new LovejoinSkipped short>floorShort",
      "lj.measuredDifferently @background/sessions.ts new LovejoinSkipped MEASURED",
      "lj.noneLeft @background/lovejoin.ts new LovejoinSkipped",
      "lj.untoldAll @background/lovejoin.ts new LovejoinSkipped",
      "sess.chainFailed @background/sessions.ts .skipped = skipped>leftOut",
      "sess.chainFailed @background/sessions.ts leftOut's return",
      "sess.chainFailed @background/sessions.ts lovejoinSkipped: skipped>leftOut",
      "sess.chainFailed @background/sessions.ts skipped = leftOut",
      "sess.deep @background/sessions.ts poolShort's return",
      "sess.deep @background/sessions.ts skipped = poolShort",
      "sess.deep @background/sessions.ts skipped: skipped>poolShort",
      "sess.mixStopped @background/sessions.ts .skipped =",
      "sess.noCollateral @background/sessions.ts .skipped = skipped>NO_COLLATERAL",
      "sess.noCollateral @background/sessions.ts lovejoinSkipped: skipped>NO_COLLATERAL",
      "sess.noCollateral @background/sessions.ts skipped = NO_COLLATERAL",
      "sess.poolFree @background/sessions.ts poolShort's return",
      "sess.poolFree @background/sessions.ts skipped = poolShort",
      "sess.poolFree @background/sessions.ts skipped: skipped>poolShort",
      "sess.refuse.moreAda @background/sessions.ts new Refused WHY",
      "sess.refuse.otherAddress @background/sessions.ts new Refused WHY",
    ]);
    // Under their old names none declared anything, so the guard fails on every reason, and on nothing else: not
    // a plain error's words, a reason error's own message, nor clauseOf's look at chainFailed's first letter.
    expect([...new Set(unnamed(found, criticalByName).map((line) => line.split(":")[0]))]).toEqual([
      "lj.floorShort",
      "lj.measuredDifferently",
      "lj.noneLeft",
      "lj.untoldAll",
      "sess.chainFailed",
      "sess.deep",
      "sess.mixStopped",
      "sess.noCollateral",
      "sess.poolFree",
      "sess.refuse.moreAda",
      "sess.refuse.otherAddress",
    ]);
  });

  it("passes the same reasons once each is named `.warn.`", () => {
    const renamed: Record<string, string> = {
      "lj.floorShort": "lj.skip.warn.floorShort",
      "lj.measuredDifferently": "lj.skip.warn.measuredDifferently",
      "lj.noneLeft": "lj.skip.warn.noneLeft",
      "lj.untoldAll": "lj.skip.warn.untoldAll",
      "sess.chainFailed": "sess.skip.warn.chainFailed",
      "sess.deep": "sess.skip.warn.deep",
      "sess.mixStopped": "sess.skip.warn.mixStopped",
      "sess.noCollateral": "sess.skip.warn.noCollateral",
      "sess.poolFree": "sess.skip.warn.poolFree",
      "sess.refuse.moreAda": "sess.refuse.warn.moreAda",
      "sess.refuse.otherAddress": "sess.refuse.warn.otherAddress",
    };
    const swap = (source: string) =>
      source.replace(/"([a-z][\w.]+)"/g, (whole, key: string) => (renamed[key] ? `"${renamed[key]}"` : whole));
    const after = Object.fromEntries(Object.entries(BEFORE).map(([path, source]) => [path, swap(source)]));
    const found = scan(after, BEFORE_KEYS.map((k) => renamed[k] ?? k));
    expect(found.length).toBeGreaterThan(0);
    expect(unnamed(found, criticalByName)).toEqual([]);
  });

  it("leaves out what no warning shows: a field none reads, a plain error, a test that picks a value, a type", () => {
    const files = {
      [`${ROOT}/background/quiet.ts`]: `
        import { t } from "../i18n";
        type Shape = { skipped?: "y.typeOnly" };
        export class Quiet {
          run(chain: { stopped?: string }, shape: Shape): Shape {
            chain.stopped = t("y.stopped");
            if (!shape) throw new Error(t("y.plain"));
            const skipped = t("y.picks") === "x" ? undefined : undefined;
            return { ...(skipped ? {} : {}) };
          }
        }`,
    };
    expect(scan(files, ["y.typeOnly", "y.stopped", "y.plain", "y.picks"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What the back-translation corrected, as the worker and its warnings say it
// ---------------------------------------------------------------------------

describe("what the back-translation of these reasons corrected, as the worker says them", CHAINS, () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("says in Spanish that what Minswap built isn't signed, agreeing with what that is", async () => {
    await i18n.changeLanguage("es");
    // What isn't signed is "lo que construyó Minswap": "firmada" agreed with no noun the sentence has.
    const refused = new Refused(tr("sess.refuse.warn.notOnlyKey"));
    expect(refused.message).toBe("La billetera no firmará lo que construyó Minswap: no está firmado solo por la clave de esta sesión.");
    expect(pauseText({ at: 0, why: "refused", detail: refused.detail }, "1")).toBe(
      "La billetera no firmará lo que construyó Minswap: no está firmado solo por la clave de esta sesión. " +
        "Volver a intentarlo le pide a Minswap que lo construya de nuevo.",
    );
  });

  it("says in Japanese that the pool's boxes aren't yours, with the negation English has", async () => {
    const { sessions } = await withSession("40000000");
    const preprod = NETWORKS.preprod.lovejoin!;
    const floor = preprod.poolFloor;
    preprod.poolFloor = 25;
    try {
      await i18n.changeLanguage("ja");
      // "Other than yours" (あなた以外) said the same, but with no negation for the critical set's check to read.
      const review = await sessions.backBuild("preprod", 0);
      expect(review.lovejoinSkipped).toBe(
        "Lovejoin のプールにはあなたのものではないボックスが 20 件あり、ウォレットがミックスするのは 25 件からです",
      );
      expect(tr("lovejoin.warn.skippedThis", { why: withoutStop(review.lovejoinSkipped!) })).toContain(
        "この返却では Lovejoin が除外されます: Lovejoin のプールにはあなたのものではないボックスが 20 件あり、",
      );
      // A swap's approval, as its pool reading says it.
      expect(tr("swaps.lovejoin.warn.pool", { why: tr("sess.skip.warn.poolFloor", { count: 12, floor: 30 }) })).toContain(
        "現在 Lovejoin のプールにはあなたのものではないボックスが 12 件あり、必要な 30 件を下回っています。そのため",
      );
    } finally {
      preprod.poolFloor = floor;
    }
  });

  it("says in Japanese that the wallet can't find the UTxOs Minswap's transaction spends, with a negation", async () => {
    await i18n.changeLanguage("ja");
    // 見つけられなかった said it too, in a past tense the critical set's negation check doesn't read.
    expect(new Refused(tr("sess.refuse.warn.unknownInputs")).message).toBe(
      "ウォレットは Minswap が作成したものに署名しません: ウォレットが見つけられない UTxO を使用します。",
    );
  });
});
