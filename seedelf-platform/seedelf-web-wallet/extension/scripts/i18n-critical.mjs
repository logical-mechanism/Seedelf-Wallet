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
// from a helper it calls, a const put together above it, a component it
// renders, a prop it is handed or a state it keeps. Source 1 reads only the
// element's own JSX, and the reviews of 2026-10-04 found warnings built that
// way shipping as unchecked machine drafts: a dApp's withdrawal, Remove
// wallet's list and a paused swap's reason first, then a sentence a return's
// privacy callout is handed as a prop, the errors a form's alert keeps in
// state, and the words a note named `.privacy.` puts in its placeholders.
// `keysThroughHelpers` below follows all of those, from each critical element
// and from each call of a key critical by name, and finds every key shown
// that way; `tests/i18n-critical-helpers.test.ts` fails on any that isn't in
// the set, so it gets its `.warn.` or `.privacy.`. What it still can't see is
// listed above it.
//
// The worker's own messages are outside the set: an error an alert shows from
// `e.message`, a refusal's detail, a skip's reason. They reach a screen at run
// time from src/background, about 300 of them, and every one was read in the
// whole-locale review of 2026-10-03; making them all critical is out of this
// set's scope. One that fills a warning's placeholder is named `.warn.` or
// `.privacy.` where the worker writes it, and so joins the set by its name;
// `tests/i18n-worker-reasons.test.ts` follows the worker's refusals and skip
// reasons to the fields warnings show, and fails on one that isn't named.
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

/** The files under `dir` whose names match `pattern`, .tsx unless told otherwise. */
const sources = (dir, pattern = /\.tsx$/) =>
  readdirSync(dir).flatMap((f) => {
    const path = `${dir}/${f}`;
    return statSync(path).isDirectory() ? sources(path, pattern) : pattern.test(f) ? [path] : [];
  });

/** The screens' code and what it shares: where a helper or a component can live. */
const CODE = /\.tsx?$/;

const TONES = new Set(["privacy", "warn"]);
const ALERT = new Set(["alert"]);

/**
 * An element that makes what's inside it a warning, a privacy note or an
 * error. `source` and `ctx` say where a name read in it is declared, so a
 * tone held in a const is read through it, and `<Note>` from `import {
 * Callout as Note }` is a Callout.
 */
function isCriticalElement(node, source, ctx) {
  const open = node.openingElement;
  if (!open) return false;
  const attr = (want) => open.attributes?.find((a) => a.type === "JSXAttribute" && a.name?.name === want)?.value;
  // A role handed in as a prop is judged where it's handed in: `<Callout
  // role="alert">` is a critical element itself, Callout's own `role={role}`
  // is not.
  const role = attr("role");
  if (role && canBe(expressionOf(role), ALERT, source.find, ctx, false)) return true;
  const name = open.name?.type === "JSXIdentifier" ? open.name.name : undefined;
  if (name !== "Callout" && (!name || source.importedAs(ctx.file, name) !== "Callout")) return false;
  const tone = attr("tone");
  // No tone is `info`, which is an explanation rather than a decision.
  if (!tone) return false;
  // A tone worked out as it renders counts when it can come out as one: the
  // dApp's staking callout (`own ? "warn" : "info"`), Remove Seedelf's
  // `note.tone`, and a `note.tone ?? "info"`, whose fallback alone is safe.
  return canBe(expressionOf(tone), TONES, source.find, ctx, true);
}

/** An attribute's value as an expression: `"warn"` and `{"warn"}` alike. */
const expressionOf = (value) => (value.type === "JSXExpressionContainer" ? value.expression : value);

/**
 * Whether `node` can come out as one of `wanted`. Only the places its value
 * can come from are read: a literal, a const's value, both branches of a
 * condition, either side of `||` and `??`, the right of `&&` (its left comes
 * out only when it's falsy, which no tone is), the last of a sequence. A
 * parameter is `param`; anything else (a member, a call, a `let`) may be
 * anything, so it can.
 */
function canBe(node, wanted, find, ctx, param, depth = 0) {
  if (depth > 8) return true;
  node = bare(node);
  if (!node) return false;
  const again = (next) => canBe(next, wanted, find, ctx, param, depth + 1);
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" && wanted.has(node.value);
    case "TemplateLiteral":
      return node.expressions.length > 0 || wanted.has(node.quasis[0]?.value.cooked);
    case "Identifier": {
      if (node.name === "undefined") return false;
      const found = find(node.name, ctx);
      const b = found?.binding;
      if (b?.kind === "param") return param;
      if (b?.kind === "var" && !b.mutable && b.init && !b.state && !b.path.length) {
        return canBe(b.init, wanted, find, found.ctx, param, depth + 1);
      }
      return true;
    }
    case "ConditionalExpression":
      return again(node.consequent) || again(node.alternate);
    case "LogicalExpression":
      return (node.operator !== "&&" && again(node.left)) || again(node.right);
    case "SequenceExpression":
      return again(node.expressions.at(-1));
    case "AssignmentExpression":
      return again(node.right);
    case "UnaryExpression":
      // `!x`, `typeof x`, `void 0`: never a tone.
      return false;
    case "BinaryExpression":
      // A comparison is a boolean; a concatenation could be anything.
      return node.operator === "+";
    default:
      return true;
  }
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
  const source = program({ follow: FOLLOWED, read: readSource });
  for (const file of sources(SRC)) {
    let ast;
    try {
      ({ ast } = source.load(file));
    } catch {
      continue;
    }
    traverse(ast, { file, chain: [], outer: 0 }, (node, ctx) => {
      if (node.type === "JSXElement" && isCriticalElement(node, source, ctx)) keysIn(node, found);
    });
  }
  return [...new Set([...found].map(baseOf))].sort();
}

// ---------------------------------------------------------------------------
// Names, and what they hold where they're read
// ---------------------------------------------------------------------------

/**
 * Where a name may be followed: the screens' own code. Not `src/i18n`, the
 * machinery (`t`, `joinList`, `joinSentences`), whose own keys are a
 * language's punctuation, held by tests/i18n-joins.test.ts; not React or any
 * other package; not the worker, which a screen reaches only by message.
 */
const FOLLOWED = [`${SRC}/ui/`, `${SRC}/shared/`];

const FUNCTION = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/;

/** What a translation is called where it's called: `t`, a screen's `tr`, Rich's `translate`. */
const TRANSLATE = new Set(["t", "tr", "translate"]);

const readSource = (path) => (existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : undefined);

/** An imported or exported name: an identifier, or a string (`import { "a-b" as c }`). */
const nameOf = (id) => id.name ?? id.value;

/** `x as T`, `x!`, `x satisfies T`: the expression inside. */
function bare(node) {
  while (node && typeof node.type === "string" && node.type.startsWith("TS") && node.expression) node = node.expression;
  return node;
}

/** A property's or a member's name where the source spells it out: `a`, `"a"`, `["a"]`. */
function keyName(key, computed) {
  if (key.type === "Literal") return String(key.value);
  return !computed && (key.type === "Identifier" || key.type === "JSXIdentifier") ? key.name : undefined;
}

/** What a call's callee is called: `f` in `f()` and `a.f()`. */
function calleeName(callee) {
  const c = bare(callee);
  if (c?.type === "Identifier") return c.name;
  return c?.type === "MemberExpression" && !c.computed ? c.property.name : undefined;
}

/** A callee as a route names it: `f`, `a.f`, `….f`. */
function calleeLabel(callee) {
  const c = bare(callee);
  if (c?.type === "Identifier") return c.name;
  if (c?.type !== "MemberExpression") return "…";
  const object = bare(c.object);
  return `${object?.type === "Identifier" ? object.name : "…"}.${c.computed ? "[…]" : c.property.name}`;
}

/** A component's name as written: `Screen`, `Ctx.Provider`. */
function jsxName(name) {
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return `${jsxName(name.object)}.${name.property.name}`;
  return `${name.namespace?.name}:${name.name?.name}`;
}

/** An element's attribute by name. */
const attributeOf = (element, name) =>
  element.openingElement.attributes.find((a) => a.type === "JSXAttribute" && a.name?.name === name);

/** `a.b`, `a["b"]` or `<a.b>`: the object's name and the member's, when both are spelt out. */
function memberOf(node) {
  if (node?.type === "MemberExpression") {
    const object = bare(node.object);
    const name = keyName(node.property, node.computed);
    return object?.type === "Identifier" && name !== undefined ? { object: object.name, name } : undefined;
  }
  if (node?.type === "JSXMemberExpression" && node.object.type === "JSXIdentifier") {
    return { object: node.object.name, name: node.property.name };
  }
  return undefined;
}

/**
 * The names a pattern binds, each with the member path it takes from the
 * value and the defaults on the way: `{ a, b: { c } = {} }` gives `a` as
 * `["a"]` and `c` as `["b", "c"]`. A rest, or a key worked out as it runs,
 * takes all of what's there.
 */
function named(pattern, path = [], defaults = []) {
  if (!pattern) return [];
  switch (pattern.type) {
    case "Identifier":
      return [{ name: pattern.name, path, defaults }];
    case "AssignmentPattern":
      return named(pattern.left, path, [...defaults, pattern.right]);
    case "ObjectPattern":
      return pattern.properties.flatMap((p) => {
        if (p.type === "RestElement") return named(p.argument, path, defaults);
        const key = keyName(p.key, p.computed);
        return named(p.value, key === undefined ? path : [...path, key], defaults);
      });
    case "ArrayPattern":
      return pattern.elements.flatMap((element, i) =>
        element?.type === "RestElement" ? named(element.argument, path, defaults) : named(element, [...path, String(i)], defaults),
      );
    case "RestElement":
      return named(pattern.argument, path, defaults);
    default:
      return [];
  }
}

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

// What a name holds, where it's declared — its binding:
//
//   decl       a function or a class declaration (`node`)
//   var        a variable: `init`, what it's given; `path`, the member of it
//              a destructuring takes (`const { a } = b` is `b`'s `["a"]`);
//              `defaults`, its pattern's; `mutable` for a let or a var;
//              `owner`, the node it's visible in, where what's later put in
//              it is looked for; for a `useState`'s value, `state` (the
//              setter's binding), and on the setter, `setterOf`
//   param      a parameter of `fn`, its `index`th: `prop`, the property of an
//              object parameter it was taken from, or "*" for all of it;
//              `rest` for `...args`; its `defaults`; `owner`, `fn`
//   each       a for…of or for…in variable: something in `of`
//   opaque     a caught error: it comes from a throw, which isn't followed
//   namespace  an `import * as`, the module `file`

/** What a `var`, `let` or `const` declares, into `scope`, each visible in `owner`. */
function declareVariables(declaration, scope, owner) {
  for (const d of declaration.declarations) {
    for (const { name, path, defaults } of named(d.id)) {
      scope.set(name, { kind: "var", init: d.init ?? null, path, defaults, mutable: declaration.kind !== "const", owner });
    }
    // `const [value, setValue] = useState(…)`: whatever the setter is handed is the value too.
    const init = bare(d.init);
    const hook = init?.type === "CallExpression" ? calleeName(init.callee) : undefined;
    if ((hook === "useState" || hook === "useReducer") && d.id.type === "ArrayPattern") {
      const [value, setter] = d.id.elements;
      if (value?.type === "Identifier" && setter?.type === "Identifier") {
        scope.get(value.name).state = scope.get(setter.name);
        scope.get(setter.name).setterOf = scope.get(value.name);
      }
    }
  }
}

/** A function's parameters, its `index`th as `pattern`, into `scope`. */
function declareParam(pattern, fn, index, scope) {
  let p = pattern.type === "TSParameterProperty" ? pattern.parameter : pattern;
  const defaults = [];
  if (p.type === "AssignmentPattern") {
    defaults.push(p.right);
    p = p.left;
  }
  const add = (names, prop, more = [], rest = false) => {
    for (const name of names) scope.set(name, { kind: "param", fn, index, prop, rest, defaults: [...defaults, ...more], owner: fn });
  };
  if (p.type === "RestElement") return add(bound(p.argument), "*", defaultsOf(p.argument), true);
  if (p.type !== "ObjectPattern") return add(bound(p), "*", defaultsOf(p));
  for (const property of p.properties) {
    if (property.type === "RestElement") add(bound(property.argument), "*");
    else add(bound(property.value), keyName(property.key, property.computed) ?? "*", defaultsOf(property.value));
  }
}

/** The `var`s anywhere in a function's body, outside the functions inside it: they belong to the whole function. */
function hoistVars(node, scope, fn) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((child) => hoistVars(child, scope, fn));
  if (FUNCTION.test(node.type)) return;
  if ((node.type === "ForOfStatement" || node.type === "ForInStatement") && node.left.type === "VariableDeclaration" && node.left.kind === "var") {
    for (const name of bound(node.left.declarations[0].id)) scope.set(name, { kind: "each", of: node.right });
    return hoistVars([node.right, node.body], scope, fn);
  }
  if (node.type === "VariableDeclaration" && node.kind === "var") declareVariables(node, scope, fn);
  for (const [field, child] of Object.entries(node)) if (field !== "type" && child && typeof child === "object") hoistVars(child, scope, fn);
}

/** What a list of statements declares for itself: its functions, classes, lets and consts. */
function lexicalScope(statements, owner) {
  const scope = new Map();
  for (const s of statements) {
    if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) scope.set(s.id.name, { kind: "decl", node: s });
    else if (s.type === "VariableDeclaration" && s.kind !== "var") declareVariables(s, scope, owner);
  }
  return scope;
}

const scopes = new WeakMap();

/**
 * The scope `node` opens, if it opens one: a function's parameters and vars,
 * a block's own names, a loop's variable, a caught error. Cached, so a name
 * leads to the same binding however it's reached; and a block's names are
 * its own, so one declared in one block is never another's.
 */
function scopeOf(node) {
  if (scopes.has(node)) return scopes.get(node);
  let scope;
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      scope = new Map();
      node.params.forEach((p, index) => declareParam(p, node, index, scope));
      hoistVars(node.body, scope, node);
      if (node.type === "FunctionExpression" && node.id && !scope.has(node.id.name)) scope.set(node.id.name, { kind: "decl", node });
      break;
    case "BlockStatement":
    case "StaticBlock":
      scope = lexicalScope(node.body, node);
      break;
    case "SwitchStatement":
      scope = lexicalScope(node.cases.flatMap((c) => c.consequent), node);
      break;
    case "ForStatement":
      if (node.init?.type === "VariableDeclaration" && node.init.kind !== "var") declareVariables(node.init, (scope = new Map()), node);
      break;
    case "ForInStatement":
    case "ForOfStatement":
      if (node.left.type === "VariableDeclaration" && node.left.kind !== "var") {
        scope = new Map(bound(node.left.declarations[0].id).map((name) => [name, { kind: "each", of: node.right }]));
      }
      break;
    case "CatchClause":
      if (node.param) scope = new Map(bound(node.param).map((name) => [name, { kind: "opaque" }]));
      break;
  }
  scopes.set(node, scope);
  return scope;
}

/** `ctx` with `scope` inside it. */
const enter = (ctx, scope) => ({ file: ctx.file, chain: [...ctx.chain, scope], outer: ctx.outer });

/**
 * Every node under `node`, with the scopes around it: `visit(node, ctx)`,
 * where `false` skips what's under that node. `ctx` is `{ file, chain, outer
 * }`: the scopes, innermost last, and how many of them, from the outside,
 * hold the place a walk began (see `usedWith`).
 */
function traverse(node, ctx, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) traverse(child, ctx, visit);
    return;
  }
  const type = node.type;
  if (typeof type !== "string") return;
  // A type says nothing a user reads; `x as T` and `x!` still hold an expression.
  if (type.startsWith("TS")) return traverse(node.expression, ctx, visit);
  if (visit(node, ctx) === false) return;
  const opened = scopeOf(node);
  const inner = opened ? enter(ctx, opened) : ctx;
  for (const [field, child] of Object.entries(node)) {
    if (field !== "type" && child && typeof child === "object") traverse(child, inner, visit);
  }
}

/** The function a binding is, when it is one: declared, assigned, or handed to `memo`, `forwardRef` or `useCallback`. */
function functionOf(found) {
  const b = found?.binding;
  if (b?.kind === "decl") return FUNCTION.test(b.node.type) ? b.node : undefined;
  // A member a destructuring takes (`const { f } = …`) isn't its whole value.
  if (b?.kind !== "var" || !b.init || b.path.length) return undefined;
  const init = bare(b.init);
  if (FUNCTION.test(init.type)) return init;
  const first = init.type === "CallExpression" ? bare(init.arguments[0]) : undefined;
  return first && FUNCTION.test(first.type) ? first : undefined;
}

/** A member of an object literal or a class, by name. */
function propertyOf(b, name) {
  if (b?.kind === "var" && b.init) {
    const init = bare(b.init);
    if (init.type !== "ObjectExpression") return undefined;
    return bare(init.properties.find((p) => p.type === "Property" && keyName(p.key, p.computed) === name)?.value);
  }
  if (b?.kind === "decl" && /^Class/.test(b.node.type)) {
    const member = b.node.body.body.find(
      (m) => (m.type === "MethodDefinition" || m.type === "PropertyDefinition") && keyName(m.key, m.computed) === name,
    );
    return bare(member?.value);
  }
  return undefined;
}

/** `createContext(…)`. */
const isContext = (init) => {
  const call = bare(init);
  return call?.type === "CallExpression" && calleeName(call.callee) === "createContext";
};

const NAMESPACE = "*";

/**
 * The source as modules: each file parsed once, with its top-level names,
 * its imports and its re-exports, and `find`, which says where a name read
 * somewhere is declared. `follow`: the directories an import may be followed
 * into. `read`: a file's source, or undefined when there's none.
 */
function program({ follow, read }) {
  const texts = new Map();
  const text = (file) => {
    if (!texts.has(file)) texts.set(file, read(file));
    return texts.get(file);
  };
  const followed = (file) => !!file && follow.some((dir) => file.startsWith(dir));
  const resolveImport = (from, spec) => {
    if (!spec.startsWith(".")) return undefined;
    const base = resolve(dirname(from), spec);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
    return candidates.find((p) => text(p) !== undefined);
  };

  const modules = new Map();
  /** A file's top-level names, what it imports and what it passes on, parsed once. */
  const load = (file) => {
    if (modules.has(file)) return modules.get(file);
    const source = text(file);
    const ast = parseAst(source, { lang: file.endsWith(".tsx") ? "tsx" : "ts" });
    const top = new Map();
    const imports = new Map(); // a name here → { from, name }, NAMESPACE for `* as`
    const aliases = new Map(); // `export { a as b }`: b → a
    const stars = []; // `export * from`
    const declare = (s) => {
      if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) top.set(s.id.name, { kind: "decl", node: s });
      else if (s.type === "VariableDeclaration") declareVariables(s, top, ast);
    };
    for (const statement of ast.body) {
      switch (statement.type) {
        case "ImportDeclaration": {
          const from = resolveImport(file, statement.source.value);
          for (const s of statement.specifiers) {
            const there = s.type === "ImportNamespaceSpecifier" ? NAMESPACE : s.type === "ImportDefaultSpecifier" ? "default" : nameOf(s.imported);
            imports.set(nameOf(s.local), { from, name: there });
          }
          break;
        }
        case "ExportAllDeclaration": {
          const from = resolveImport(file, statement.source.value);
          if (statement.exported) imports.set(nameOf(statement.exported), { from, name: NAMESPACE });
          else stars.push(from);
          break;
        }
        case "ExportNamedDeclaration":
          if (statement.source) {
            // `export { a as b } from`: offers a as b, as an import would bring it.
            const from = resolveImport(file, statement.source.value);
            for (const s of statement.specifiers) imports.set(nameOf(s.exported), { from, name: nameOf(s.local) });
            break;
          }
          for (const s of statement.specifiers) {
            if (nameOf(s.exported) !== nameOf(s.local)) aliases.set(nameOf(s.exported), nameOf(s.local));
          }
          if (statement.declaration) declare(statement.declaration);
          break;
        case "ExportDefaultDeclaration": {
          const d = statement.declaration;
          if (d.type === "Identifier") {
            aliases.set("default", d.name);
            break;
          }
          const binding =
            FUNCTION.test(d.type) || /^Class/.test(d.type)
              ? { kind: "decl", node: d }
              : { kind: "var", init: d, path: [], defaults: [], mutable: false, owner: ast };
          top.set("default", binding);
          if (d.id) top.set(d.id.name, binding);
          break;
        }
        default:
          declare(statement);
      }
    }
    const mod = { source, ast, top, imports, aliases, stars };
    modules.set(file, mod);
    return mod;
  };

  const namespaces = new Map();
  const namespaceOf = (file) => {
    if (!namespaces.has(file)) namespaces.set(file, { kind: "namespace", file });
    return namespaces.get(file);
  };

  /** Where `name` is declared at the top of `file`, through its imports and what it passes on. */
  const declaredIn = (file, name, depth = 0) => {
    if (!file || depth > 8 || text(file) === undefined) return undefined;
    const mod = load(file);
    if (mod.top.has(name)) return { binding: mod.top.get(name), ctx: { file, chain: [], outer: 0 } };
    if (mod.aliases.has(name)) return declaredIn(file, mod.aliases.get(name), depth + 1);
    const imported = mod.imports.get(name);
    if (imported) {
      if (!followed(imported.from)) return undefined;
      if (imported.name === NAMESPACE) return { binding: namespaceOf(imported.from), ctx: { file: imported.from, chain: [], outer: 0 } };
      return declaredIn(imported.from, imported.name, depth + 1);
    }
    // `export *` passes on every name but the default.
    if (name === "default") return undefined;
    for (const star of mod.stars) {
      const found = followed(star) ? declaredIn(star, name, depth + 1) : undefined;
      if (found) return found;
    }
    return undefined;
  };

  /**
   * Where `name`, read at `ctx`, is declared: the innermost scope first, then
   * the file, then its imports. The answer's ctx is the scopes around the
   * declaration, with `outer` cut to those of them that hold the place a walk
   * began.
   */
  const find = (name, ctx) => {
    const { chain } = ctx;
    for (let i = chain.length - 1; i >= 0; i--) {
      const binding = chain[i].get(name);
      if (binding) return { binding, ctx: { file: ctx.file, chain: chain.slice(0, i + 1), outer: Math.min(ctx.outer, i + 1) } };
    }
    return declaredIn(ctx.file, name);
  };

  /** The name `name` has where `file` imports it from, if it imports it: `Callout` for `import { Callout as Note }`. */
  const importedAs = (file, name) => (text(file) === undefined ? undefined : load(file).imports.get(name)?.name);

  return { load, find, declaredIn, importedAs };
}

// ---------------------------------------------------------------------------
// What a critical element shows from outside its own JSX
// ---------------------------------------------------------------------------

/** Ways an array, a Map or a Set is filled after it's declared. */
const MUTATORS = new Set(["push", "unshift", "splice", "set", "add", "fill"]);

/** A member read by an index or a key worked out as it runs (`a[i]`): any of them. */
const ANY = "[…]";

/** Methods whose answer is a yes or a number, whatever the callback says: `.some(…)`, `.includes(…)`. */
const COUNTS = new Set([
  "some",
  "every",
  "includes",
  "indexOf",
  "lastIndexOf",
  "findIndex",
  "findLastIndex",
  "has",
  "test",
  "startsWith",
  "endsWith",
]);

/** Methods whose answer is some of the receiver, which the callback only chooses or orders: `.filter(…)`. */
const PICKS = new Set(["filter", "find", "findLast", "sort", "toSorted"]);

/** React hooks whose answer is nothing a screen shows (an effect), or what their first argument returns (a memo). */
const EFFECTS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
const MEMOS = new Set(["useMemo", "useCallback"]);

/**
 * Every key a critical element can show through something other than its own
 * JSX, which is all `criticalKeys` reads, and every key a call of a key
 * critical by name puts in its placeholders. Followed:
 *
 *   - a function it calls (what the function returns), a name it reads (a
 *     const put together above it, an object of getters, a function handed
 *     to `map`), a component it renders, and theirs in turn;
 *   - a prop it shows: what each `<C prop={…}>` in `files` hands it,
 *     `children` and a render prop included; for a plain function's
 *     parameter, each call's argument; for a callback's, the call it's
 *     written into (`items.map((item) => …)`: `items`);
 *   - a state it shows: what its `useState` starts with and every call of its
 *     setter in the scope that declares it, a handler's and an effect's too;
 *   - a variable's later values, in the scope that declares it: a `let`
 *     assigned again, an array or a Map filled by `push` or `set`;
 *   - names through `export *`, `export { a as b }`, `import * as ns` and a
 *     class's members, and block by block: a name one block declares is not
 *     another block's;
 *   - of a name read by a member (`a.b`, `const { b } = a`), only that member,
 *     where the source says which it is.
 *
 * The starts: each critical element in `files`; and each `t()`, `tr()` or
 * `translate()` call, and each `<Rich k>`, whose key is critical by name, for
 * the values it's handed, which `criticalKeys` never reads — a privacy note
 * can be a plain `<p className="note">`, with no critical element around it.
 *
 * Left out, because none of it shows: an event handler (it runs on a click;
 * a state it sets is followed from the state), what a function throws or
 * does without returning it, what a call hands a function whose answer reads
 * none of its parameters (`call(…)`'s request to the worker), a count
 * (`.length`), a yes or a no (`.some(…)`), what a `.filter(…)` callback says,
 * a control's own label (as `keysIn` skips it), a type, and a context's
 * default value (no screen renders without a provider, whose `value` is
 * followed instead).
 *
 * What it can't see, so a key that reaches a warning only this way needs its
 * `.warn.` or `.privacy.` by hand:
 *
 *   - **The worker's messages.** An error an alert shows from `e.message`, a
 *     refusal's detail, a skip's reason: they come from src/background at run
 *     time, by message, not by a name a screen's code can follow. There are
 *     about 300, every one read in the whole-locale review of 2026-10-03, and
 *     making all of them critical is beyond this guard. One that fills a
 *     warning's placeholder is named for it where it's written (`lj.privacy.*`,
 *     a refusal's and a skip's reasons), and `tests/i18n-worker-reasons.test.ts`
 *     holds the refusals and skip reasons to that.
 *   - A setter, or a function that sets state, handed to another component or
 *     function and called there; a component used through a variable (`const
 *     C = a ? A : B`) or handed on as a value.
 *   - A namespace used whole (`ns[name]`); an object filled through another
 *     name (`const a = lines; a.push(…)`) or from another module; a key put
 *     together at run time (`` `x.${y}` ``).
 *   - A helper outside src/ui and src/shared. src/networks.ts and
 *     src/manifest.ts hold no words: tests/import-boundaries.test.ts keeps
 *     i18next out of what the content scripts and Vite's config import.
 *
 * Past what the source says, it never asks which branch runs or which use is
 * meant: a helper counts with every key it can return, and a prop with
 * whatever any use hands it.
 *
 * `keys` are the real ones, en.json's: a literal counts when it names one.
 * `files`: where to look, for the starts and for where each component and
 * function is used; every .ts and .tsx under src/ui and src/shared by
 * default. `follow`: where a name may be followed. `read`: a file's source,
 * or undefined when there is none, so a test can hand it files of its own.
 * Returns, for each start, an entry per key by its shortest route: `key` (its
 * base), `at` (the start, `ui/screens/X.tsx:12`) and `via` (the names
 * followed, outermost first; for a call, its key comes first).
 */
export function keysThroughHelpers({
  keys,
  files = [...sources(`${SRC}/ui`, CODE), ...sources(`${SRC}/shared`, CODE)],
  follow = FOLLOWED,
  read = readSource,
  root = SRC,
}) {
  const known = new Set(keys.map(baseOf));
  const source = program({ follow, read });
  const { load, find, declaredIn } = source;
  const where = (file, node) => `${relative(root, file)}:${load(file).source.slice(0, node.start).split("\n").length}`;
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };

  /** The function a callee or a component's name is, where the source says. */
  const functionAt = (node, ctx) => {
    node = bare(node);
    if (node.type === "Identifier" || node.type === "JSXIdentifier") {
      return node.type === "JSXIdentifier" && !/^[A-Z]/.test(node.name) ? undefined : functionOf(find(node.name, ctx));
    }
    const member = memberOf(node);
    const object = member && find(member.object, ctx);
    if (!object) return undefined;
    if (object.binding.kind === "namespace") return functionOf(declaredIn(object.binding.file, member.name));
    const value = propertyOf(object.binding, member.name);
    return value && FUNCTION.test(value.type) ? value : undefined;
  };
  /** The context a `<Ctx.Provider>` (or a bare `<Ctx>`) provides. */
  const contextAt = (name, ctx) => {
    const target = name.type === "JSXMemberExpression" && name.property.name === "Provider" ? name.object : name;
    if (target.type !== "JSXIdentifier" || !/^[A-Z]/.test(target.name)) return undefined;
    const found = find(target.name, ctx);
    return found?.binding.kind === "var" && isContext(found.binding.init) ? found.binding : undefined;
  };

  // Every file, once: where the walks start, and where each function and
  // component is used, for what its parameters are handed.
  const elements = [];
  const calls = [];
  const riches = [];
  const uses = new Map(); // a function → each call of it and each <Component> of it
  const handedTo = new Map(); // a function written as a call's argument → that call
  const providers = new Map(); // a context's binding → each of its providers
  // Functions whose answer reads a parameter of theirs, so what a call hands
  // them can show; and those whose answer is being worked out, which might
  // (how many times over, as one can be reached again from inside itself).
  const passes = new Set();
  const running = new Map();
  for (const file of files) {
    traverse(load(file).ast, { file, chain: [], outer: 0 }, (node, ctx) => {
      if (node.type !== "JSXElement" && node.type !== "CallExpression") return;
      // Every scope around a start holds it: its functions' parameters are followed out to what they're handed.
      const here = { file, chain: ctx.chain, outer: ctx.chain.length };
      if (node.type === "JSXElement") {
        const name = node.openingElement.name;
        if (isCriticalElement(node, source, here)) elements.push({ node, ctx: here });
        if (name.type === "JSXIdentifier" && name.name === "Rich") riches.push({ node, ctx: here });
        const fn = functionAt(name, here);
        if (fn) add(uses, fn, { node, ctx: here });
        const context = contextAt(name, here);
        if (context) add(providers, context, { node, ctx: here });
        return;
      }
      if (TRANSLATE.has(calleeName(node.callee)) && node.arguments.length > 1) calls.push({ node, ctx: here });
      const fn = functionAt(node.callee, here);
      if (fn) add(uses, fn, { node, ctx: here });
      for (const argument of node.arguments) {
        const a = bare(argument);
        if (a && FUNCTION.test(a.type)) handedTo.set(a, node);
      }
    });
  }

  // What following a binding finds, by the binding, the member of it that's
  // read, and how much of the scope around it holds the walk's start. A cycle
  // back to a binding still being followed is cut there: what was found
  // inside it then is short of that binding's own keys, so it's kept for this
  // walk only (`partial`), and found whole by the next walk to reach it.
  const ids = new WeakMap();
  let nextId = 0;
  const memoKey = (o, outer, path = []) => {
    if (!ids.has(o)) ids.set(o, nextId++);
    return `${ids.get(o)}:${outer}:${path.join("\u0000")}`;
  };
  const done = new Map();
  const partial = new Map();
  const open = new Map();
  let lowest = Infinity;

  /** The keys `found` holds (its member `path`, when one is read), each with the route to it, `label` first. */
  const trace = (found, label, path = []) => {
    const memo = memoKey(found.binding, found.ctx.outer, path);
    let result = done.get(memo) ?? partial.get(memo);
    if (!result) {
      if (open.has(memo)) {
        lowest = Math.min(lowest, open.get(memo));
        return [];
      }
      const depth = open.size;
      open.set(memo, depth);
      const saved = lowest;
      lowest = Infinity;
      const inner = [];
      expand(found, inner, path);
      result = shortest(inner);
      open.delete(memo);
      (lowest < depth ? partial : done).set(memo, result);
      lowest = Math.min(saved, lowest);
    }
    return result.map((e) => ({ key: e.key, via: [label, ...e.via] }));
  };
  const through = (name, ctx, label, path = []) => {
    const found = find(name, ctx);
    return found ? trace(found, label, path) : [];
  };
  /** What `run` finds, into `out`, each route starting `label`. */
  const into = (out, label, run) => {
    const inner = [];
    run(inner);
    for (const e of inner) out.push({ key: e.key, via: [label, ...e.via] });
  };

  /** Everything that can end up in a binding, or in its member `path` when one is read. */
  const expand = ({ binding: b, ctx }, out, path) => {
    switch (b.kind) {
      case "decl": {
        // A function shows what it returns; a class, what its members do.
        if (FUNCTION.test(b.node.type)) return results(b.node, ctx, out, path);
        const member = path.length ? propertyOf(b, path[0]) : undefined;
        return member ? pick(member, path.slice(1), ctx, out) : walk(b.node.body, ctx, out);
      }
      case "var":
        if (isContext(b.init)) {
          // A context shows what its providers hand down, never its default.
          for (const p of providers.get(b) ?? []) {
            const value = attributeOf(p.node, "value")?.value;
            into(out, `<${jsxName(p.node.openingElement.name)}> at ${where(p.ctx.file, p.node)}`, (inner) =>
              pick(value && expressionOf(value), path, p.ctx, inner),
            );
          }
          return;
        }
        for (const d of b.defaults) pick(d, path, ctx, out);
        if (b.state) {
          // `useState(initial)`: the value starts as that, then is whatever the setter is handed.
          const hook = bare(b.init);
          if (calleeName(hook.callee) === "useReducer") walk(hook.arguments, ctx, out);
          else pick(hook.arguments[0], path, ctx, out);
        } else pick(b.init, [...b.path, ...path], ctx, out);
        for (const change of changesOf(b, ctx)) changed(change, path, out);
        return;
      case "param":
        passes.add(b.fn);
        for (const d of b.defaults) pick(d, path, ctx, out);
        for (const change of changesOf(b, ctx)) changed(change, path, out);
        // A callback written into a call is called by that call, and by nothing else.
        if (handedTo.has(b.fn)) return handed(b, ctx, out);
        // Any other function's, only where it holds the walk's start. Anywhere
        // else the call that led into the function was walked already, with
        // what it hands this parameter.
        if (ctx.outer === ctx.chain.length) usedWith(b, out, path);
        return;
      case "each":
        return walk(b.of, ctx, out);
      case "namespace": {
        // `ns.f`: f, in that module. A namespace used whole isn't followed.
        const found = path.length ? declaredIn(b.file, path[0]) : undefined;
        if (found) out.push(...trace(found, path[0], path.slice(1)));
        return;
      }
      default:
        // A caught error came from a throw.
        return;
    }
  };

  /** What a function returns (its member `path`, when one is read), each value read in the scopes it's returned from. */
  const results = (fn, ctx, out, path = []) => {
    const inner = enter(ctx, scopeOf(fn));
    running.set(fn, (running.get(fn) ?? 0) + 1);
    if (fn.body.type !== "BlockStatement") pick(fn.body, path, inner, out);
    else {
      traverse(fn.body, inner, (node, here) => {
        if (FUNCTION.test(node.type) || /^Class/.test(node.type)) return false;
        if (node.type !== "ReturnStatement") return;
        pick(node.argument, path, here, out);
        return false;
      });
    }
    if (running.get(fn) === 1) running.delete(fn);
    else running.set(fn, running.get(fn) - 1);
  };

  /**
   * What a change puts in the member `path` of what it changes: all of the
   * value it's given for an assignment or a setter's call; the value itself
   * for `x.p = v` when p is what's read; all of it for a `push` or anything
   * else that fills it without saying where.
   */
  const changed = (change, path, out) =>
    into(out, change.label, (inner) => {
      if (change.whole) return walk(change.values, change.ctx, inner);
      if (change.member === undefined) {
        for (const v of change.values) pick(v, path, change.ctx, inner);
        return;
      }
      if (!path.length) return walk(change.values, change.ctx, inner);
      if (path[0] === change.member) for (const v of change.values) pick(v, path.slice(1), change.ctx, inner);
    });

  /** Whether what a use of `fn` hands it can show: unless `fn` is known and its answer reads none of its parameters. */
  const shows = (fn) => !fn || passes.has(fn) || running.has(fn);

  const changes = new Map();
  /**
   * What else is put in a variable or a parameter, in the scope it's visible
   * in: an assignment, `push`, `set` and the like on it, `Object.assign` into
   * it, a `for…of` that assigns it; and for a `useState`'s value, every call
   * of its setter. Each with the scopes it's written in.
   */
  const changesOf = (b, ctx) => {
    const { owner } = b;
    if (!owner) return [];
    const start =
      owner.type === "Program" ? { file: ctx.file, chain: [], outer: 0 } : { file: ctx.file, chain: ctx.chain.slice(0, -1), outer: ctx.outer };
    const memo = memoKey(owner, start.outer);
    if (!changes.has(memo)) {
      const index = new Map();
      const put = (binding, change) => {
        if (!binding) return;
        if (!index.has(binding)) index.set(binding, []);
        index.get(binding).push(change);
      };
      // `x = v`, `x.p = v`, `x.p.q = v`, `x[k] = v`: what x is, and which member of it v is, where that's said.
      const assigned = (target, here, label, values, whole = false) => {
        let node = bare(target);
        let member;
        while (node?.type === "MemberExpression") {
          const object = bare(node.object);
          member = object?.type === "Identifier" ? keyName(node.property, node.computed) : undefined;
          whole ||= object?.type !== "Identifier" || member === undefined;
          node = object;
        }
        if (node?.type !== "Identifier") return;
        const found = find(node.name, here);
        if (found?.binding.kind !== "var" && found?.binding.kind !== "param") return;
        put(found.binding, { label: label(node.name), values, ctx: here, member, whole });
      };
      traverse(owner, start, (node, here) => {
        if (node.type === "AssignmentExpression") assigned(node.left, here, (name) => `${name} =`, [node.right]);
        else if ((node.type === "ForOfStatement" || node.type === "ForInStatement") && node.left.type !== "VariableDeclaration") {
          assigned(node.left, here, (name) => `${name} of`, [node.right], true);
        } else if (node.type === "CallExpression") {
          const callee = bare(node.callee);
          if (callee.type === "Identifier") {
            const setter = find(callee.name, here)?.binding;
            if (setter?.setterOf) put(setter.setterOf, { label: callee.name, values: node.arguments, ctx: here });
          } else if (callee.type === "MemberExpression" && !callee.computed) {
            const method = callee.property.name;
            if (MUTATORS.has(method)) assigned(callee.object, here, (name) => `${name}.${method}`, node.arguments, true);
            else if (method === "assign" && bare(callee.object)?.name === "Object" && node.arguments.length > 1) {
              assigned(node.arguments[0], here, (name) => `Object.assign(${name})`, node.arguments.slice(1));
            }
          }
        }
      });
      changes.set(memo, index);
    }
    return changes.get(memo).get(b) ?? [];
  };

  /**
   * What a callback's parameter is handed, by the call it's written into
   * (`items.map((item) => …)`, `reading.then((r) => …)`): something of that
   * call's receiver or of its other arguments, read where the call is, in the
   * scopes the walk reached the callback through.
   */
  const handed = (b, ctx, out) => {
    const call = handedTo.get(b.fn);
    const around = { file: ctx.file, chain: ctx.chain.slice(0, -1), outer: Math.min(ctx.outer, ctx.chain.length - 1) };
    into(out, `${calleeLabel(call.callee)}() at ${where(ctx.file, call)}`, (inner) => {
      const callee = bare(call.callee);
      if (callee.type === "MemberExpression") walk(callee.object, around, inner);
      walk(
        call.arguments.filter((a) => bare(a) !== b.fn),
        around,
        inner,
      );
    });
  };

  /**
   * What a parameter (its member `path`, when one is read) is handed, by each
   * use of its function: the attribute of each `<C …>` (each of them, and the
   * children, for a whole props object read whole), and the argument of each
   * call.
   */
  const usedWith = (b, out, path) => {
    const { fn, index, rest } = b;
    // `function C(props)` read as `props.after`: the `after` attribute, as `{ after }` would be.
    const [prop, member] = b.prop === "*" && path.length ? [path[0], path.slice(1)] : [b.prop, path];
    for (const { node, ctx } of uses.get(fn) ?? []) {
      if (node.type === "JSXElement") {
        if (index !== 0) continue;
        into(out, `<${jsxName(node.openingElement.name)}> at ${where(ctx.file, node)}`, (inner) => {
          for (const a of node.openingElement.attributes) {
            if (a.type === "JSXSpreadAttribute") pick(a.argument, prop === "*" ? member : [prop, ...member], ctx, inner);
            else if (prop === "*") walk(a, ctx, inner);
            else if (a.name?.name === prop && !/^(on[A-Z]|key$|ref$)/.test(prop)) pick(a.value && expressionOf(a.value), member, ctx, inner);
          }
          if (prop === "*" || prop === "children") walk(node.children, ctx, inner);
        });
        continue;
      }
      into(out, `${calleeLabel(node.callee)}() at ${where(ctx.file, node)}`, (inner) => {
        const args = node.arguments;
        const spread = args.findIndex((a) => a.type === "SpreadElement");
        if (rest || (spread !== -1 && spread <= index)) return walk(args.slice(spread === -1 ? index : Math.min(index, spread)), ctx, inner);
        pick(args[index], prop === "*" ? member : [prop, ...member], ctx, inner);
      });
    }
  };

  /**
   * What `node`'s member `path` holds — `a.b` is `a`'s `["b"]`, `a[i]` is
   * `a`'s `[ANY]` — wherever the source says which member it is: an object's
   * property, an array's element, a name's, a function's answer's, either
   * branch's, a `map` callback's answer. Where it doesn't say, all of `node`.
   */
  const pick = (node, path, ctx, out) => {
    if (!path.length) return walk(node, ctx, out);
    node = bare(node);
    if (!node) return;
    const [first, ...rest] = path;
    switch (node.type) {
      case "Identifier":
        out.push(...through(node.name, ctx, node.name, path));
        return;
      case "ObjectExpression":
        for (const p of node.properties) {
          if (p.type === "SpreadElement") {
            pick(p.argument, path, ctx, out);
            continue;
          }
          const name = keyName(p.key, p.computed);
          if (name !== undefined && first !== ANY && name !== first) continue;
          if (p.computed) walk(p.key, ctx, out);
          // A getter's value is what it returns.
          if (p.kind === "get") results(p.value, ctx, out, rest);
          else pick(p.value, rest, ctx, out);
        }
        return;
      case "ArrayExpression": {
        // An element: by its index, or any of them for an index worked out as it runs. Anything else of an
        // array (`.join`, `.map`) is made of all of them.
        if (first === ANY) {
          for (const e of node.elements) pick(e?.type === "SpreadElement" ? e.argument : e, e?.type === "SpreadElement" ? path : rest, ctx, out);
          return;
        }
        const element = /^\d+$/.test(first) && !node.elements.some((e) => e?.type === "SpreadElement") ? node.elements[Number(first)] : undefined;
        return element === undefined ? walk(node, ctx, out) : pick(element, rest, ctx, out);
      }
      case "ConditionalExpression":
        pick(node.consequent, path, ctx, out);
        return pick(node.alternate, path, ctx, out);
      case "LogicalExpression":
        // `a && b` is a only when a is falsy, which has no members.
        if (node.operator !== "&&") pick(node.left, path, ctx, out);
        return pick(node.right, path, ctx, out);
      case "SequenceExpression":
        return pick(node.expressions.at(-1), path, ctx, out);
      case "AwaitExpression":
      case "ChainExpression":
        return pick(node.argument ?? node.expression, path, ctx, out);
      case "MemberExpression": {
        if (!node.computed && (node.property.name === "length" || node.property.name === "size")) return;
        const name = keyName(node.property, node.computed);
        if (name === undefined) walk(node.property, ctx, out);
        return pick(node.object, [name ?? ANY, ...path], ctx, out);
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        // A member of a function's, read as a value: of what it returns (a setter's update, a memo's function).
        return results(node, ctx, out, path);
      case "CallExpression": {
        const callee = bare(node.callee);
        const hook = callee?.type === "Identifier" ? callee.name : undefined;
        // `useMemo(fn)`: what fn returns. `useContext(Ctx)`: what its providers hand down.
        if (MEMOS.has(hook) || hook === "useContext") return pick(node.arguments[0], path, ctx, out);
        const method = callee?.type === "MemberExpression" && !callee.computed ? callee.property.name : undefined;
        const element = first === ANY || /^\d+$/.test(first);
        const callback = bare(node.arguments[0]);
        // `items.map((item) => …)[i]`: what the callback returns. `items.find(…).name`: an item's name.
        if ((method === "map" || method === "flatMap") && element && callback && FUNCTION.test(callback.type)) {
          return results(callback, ctx, out, method === "map" ? rest : [ANY, ...rest]);
        }
        if (method === "find" || method === "findLast") return pick(callee.object, [ANY, ...path], ctx, out);
        if (PICKS.has(method)) return element ? pick(callee.object, [ANY, ...rest], ctx, out) : walk(callee.object, ctx, out);
        if (COUNTS.has(method)) return;
        const fn = functionAt(node.callee, ctx);
        if (!fn) return walk(node, ctx, out);
        // A function the source knows: that member of what it returns.
        pick(node.callee, path, ctx, out);
        if (shows(fn)) walk(node.arguments, ctx, out);
        return;
      }
      default:
        return walk(node, ctx, out);
    }
  };

  /** A component a walk renders: what it returns. */
  const component = (name, ctx) => {
    if (name.type === "JSXIdentifier") return /^[A-Z]/.test(name.name) ? through(name.name, ctx, `<${name.name}>`) : [];
    const member = memberOf(name);
    const object = member && find(member.object, ctx);
    if (object?.binding.kind !== "namespace") return []; // `<Ctx.Provider>` shows its children, walked with it
    const found = declaredIn(object.binding.file, member.name);
    return found ? trace(found, `<${member.object}.${member.name}>`) : [];
  };

  /** Every key `node` names, and what the names it reads hold, into `out`. */
  const walk = (node, ctx, out) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, ctx, out);
      return;
    }
    const type = node.type;
    if (typeof type !== "string") return;
    // A type says nothing a user reads; `x as T` and `x!` still hold an expression.
    if (type.startsWith("TS")) return walk(node.expression, ctx, out);
    switch (type) {
      case "Literal":
        if (typeof node.value === "string" && KEY.test(node.value) && known.has(baseOf(node.value))) {
          out.push({ key: baseOf(node.value), via: [] });
        }
        return;
      case "Identifier":
        out.push(...through(node.name, ctx, node.name));
        return;
      case "JSXElement": {
        const name = node.openingElement.name;
        if (name.type === "JSXIdentifier" && CONTROLS.has(name.name)) return;
        out.push(...component(name, ctx));
        // A component shows its props only where what it returns reads them; an element of the page's own, always.
        const fn = name.type === "JSXIdentifier" && !/^[A-Z]/.test(name.name) ? undefined : functionAt(name, ctx);
        if (shows(fn)) walk([node.openingElement.attributes, node.children], ctx, out);
        return;
      }
      case "JSXAttribute":
        // A handler runs on a click, and a key or a ref is React's: none of them shows here.
        if (/^(on[A-Z]|key$|ref$)/.test(node.name?.name ?? "")) return;
        return walk(node.value, ctx, out);
      case "CallExpression":
      case "NewExpression": {
        const callee = bare(node.callee);
        const method = callee?.type === "MemberExpression" && !callee.computed ? callee.property.name : undefined;
        // `.some(…)` is a yes or a no; `.filter(…)` is some of what it's called on, whatever its callback says.
        if (COUNTS.has(method)) return;
        if (PICKS.has(method)) return walk(callee.object, ctx, out);
        const hook = callee?.type === "Identifier" ? callee.name : undefined;
        if (EFFECTS.has(hook)) return;
        if (MEMOS.has(hook)) return walk(node.arguments[0], ctx, out);
        walk(node.callee, ctx, out);
        // What a call hands a function shows only through its parameters.
        if (shows(functionAt(node.callee, ctx))) walk(node.arguments, ctx, out);
        return;
      }
      case "MemberExpression": {
        // A count is a number, whatever it counts.
        if (!node.computed && (node.property.name === "length" || node.property.name === "size")) return;
        // `a.b`: b, of a (`ns.f` from `import * as ns` too); `a[i]`, any member of a.
        const name = keyName(node.property, node.computed);
        if (name === undefined) walk(node.property, ctx, out);
        return pick(node.object, [name ?? ANY], ctx, out);
      }
      case "Property":
      case "MethodDefinition":
      case "PropertyDefinition":
        if (node.computed) walk(node.key, ctx, out);
        return walk(node.value, ctx, out);
      case "FunctionDeclaration":
        // It shows only where it is used, and is followed from there.
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        // Written in place (a `map` callback, a getter): what it returns shows here.
        return results(node, ctx, out);
      case "ClassDeclaration":
      case "ClassExpression":
        return walk(node.body, ctx, out);
      case "VariableDeclarator":
        return walk([...defaultsOf(node.id), node.init], ctx, out);
      case "LabeledStatement":
        return walk(node.body, ctx, out);
      case "BreakStatement":
      case "ContinueStatement":
        return;
      default: {
        const opened = scopeOf(node);
        const inner = opened ? enter(ctx, opened) : ctx;
        for (const [field, child] of Object.entries(node)) {
          if (field !== "type" && child && typeof child === "object") walk(child, inner, out);
        }
      }
    }
  };

  /** The keys an expression can be, by its literals and the names it reads: a `t()` call's first argument. */
  const keysOf = (node, ctx) => {
    const out = [];
    walk(node, ctx, out);
    return [...new Set(out.map((e) => e.key))];
  };

  const found = [];
  const begin = () => partial.clear();
  const record = (entries, at, label) => {
    for (const { key, via } of shortest(entries)) found.push({ key, at, via: label ? [label, ...via] : via });
  };
  for (const { node, ctx } of elements) {
    begin();
    const out = [];
    walk(node, ctx, out);
    // What its own JSX names is criticalKeys' to read; this is the rest.
    record(
      out.filter((e) => e.via.length),
      where(ctx.file, node),
    );
  }
  // A key critical by name is critical wherever it's said, and so is what
  // fills its placeholders; criticalKeys reads none of those values, so every
  // key in them counts, a literal written straight in included.
  for (const { node, ctx } of calls) {
    begin();
    const named = keysOf(node.arguments[0], ctx).filter(criticalByName);
    if (!named.length) continue;
    const out = [];
    walk(node.arguments.slice(1), ctx, out);
    record(out, where(ctx.file, node), `${calleeName(node.callee)}("${named[0]}")`);
  }
  for (const { node, ctx } of riches) {
    begin();
    const k = attributeOf(node, "k");
    const named = k ? keysOf(k.value, ctx).filter(criticalByName) : [];
    if (!named.length) continue;
    const out = [];
    walk(
      node.openingElement.attributes.filter((a) => a !== k),
      ctx,
      out,
    );
    record(out, where(ctx.file, node), `<Rich k="${named[0]}">`);
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
