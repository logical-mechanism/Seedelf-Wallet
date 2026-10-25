// e2e/live/ sends real preprod transactions from the built extension, by hand before a release (development.md), so
// CI never runs it, and it rotted unnoticed: chunk 23 renamed the mint's tag label, made who pays a mint and where a
// removal's ADA goes radio cards, put Remove behind Manage and renamed the vote's Change, and chunk 14's renames
// reached run.mjs's own preset, so `node e2e/live/run.mjs all` stopped at its first step (1.6.0's release review,
// x-release#2). This holds what it fills, presses and waits for to the wallet's own English, as
// store-images-copy.test.ts does for the store images' spec.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LABEL_MAX } from "../src/shared/label";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const harness = ["../e2e/live/lib.mjs", "../e2e/live/flows.mjs"].map(read).join("\n");
const runner = read("../e2e/live/run.mjs");
const en = JSON.parse(read("../src/i18n/translations/en.json")) as Record<string, string>;
const values = Object.values(en);

const PLACEHOLDER = /\{\{[^}]+\}\}/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A value with its placeholders filled any way, if enough of it is its own words to tell ("{{a}} ({{b}})" isn't). */
const renders = (text: string) =>
  values.some(
    (v) =>
      v.replace(PLACEHOLDER, "").trim().length >= 4 &&
      new RegExp(`^${v.split(PLACEHOLDER).map(escape).join(".+")}$`).test(text),
  );
/** How a value starts, up to its first placeholder: `filter({ hasText })` matches part of an element's text. */
const starts = (text: string) => values.some((v) => v.split("{{")[0]!.startsWith(text));
/** `key`'s value, its placeholders filled with `fill`. */
const shown = (key: string, fill = "MIN") => {
  expect(en[key], key).toBeDefined();
  return en[key]!.replace(PLACEHOLDER, fill);
};

/**
 * Each `getByRole`/`getByLabel`/`getByText` call: its role, whether it's exact, the strings its name may be (a `${…}`
 * in one as X), and the regular expressions it may be.
 */
function calls() {
  const found: Array<{ role: string; exact: boolean; names: string[]; patterns: RegExp[] }> = [];
  for (const m of harness.matchAll(/getBy(Role|Label|Text)\(([^\n]*)/g)) {
    const [, by, rest] = m as unknown as [string, string, string];
    const role = by === "Role" ? /^"(\w+)"/.exec(rest)?.[1] ?? "" : by.toLowerCase();
    const exact = /^[^)]*exact: true/.test(rest.replace(/"[^"]*"|`[^`]*`/g, '""'));
    // A role's name option; a label's or a text's first argument, a literal or a variable (`tag`).
    const name = by === "Role" ? /\{ name: (.*?)(?:, exact: true)? \}\)/.exec(rest)?.[1] : /^("[^"]*"|`[^`]*`|\w+)/.exec(rest)?.[1];
    if (!name || name.startsWith("new RegExp")) {
      found.push({ role, exact, names: [], patterns: [] });
      continue;
    }
    // A string the name is compared with (`from === "account" ? …`) isn't one it can be: matched whole, and dropped.
    const names = [...name.matchAll(/===\s*"[^"]*"|"([^"]+)"|`([^`]+)`/g)]
      .filter((s) => s[1] !== undefined || s[2] !== undefined)
      .map((s) => s[1] ?? s[2]!.replace(/\$\{[^}]+\}/g, "X"));
    // Each regular expression in it, the whole name or a branch of one (`… ? /^Public account/ : …`).
    const patterns = [...name.matchAll(/(?:^|[?:]\s*)\/((?:\\.|[^/\\\n])+)\/([dgimsuy]*)/g)].map((p) => new RegExp(p[1]!, p[2]));
    found.push({ role, exact, names, patterns });
  }
  return found;
}

describe("1.6.0's release review, x-release#2: the live runs", () => {
  it("fill, press and wait for English the wallet still shows", () => {
    // A name that's all variable (`${said}`) is the page's own words, read off it.
    const named = calls().flatMap((c) => c.names.filter((n) => n !== "X"));
    const texts = [...harness.matchAll(/hasText: "([^"]+)"|confirmed\(page, "([^"]+)"\)/g)].map((m) => m[1] ?? m[2]!);
    expect(named.length + texts.length, "it still finds what the harness looks for").toBeGreaterThanOrEqual(40);
    const fix = "change e2e/live/ to the English en.json has now";
    expect(named.filter((n) => !values.includes(n) && !renders(n)), fix).toEqual([]);
    expect(texts.filter((t) => !starts(t)), fix).toEqual([]);
  });

  it("press each button they find by a pattern by what it says now", () => {
    const patterns = [
      ...calls().flatMap((c) => c.patterns),
      ...[...harness.matchAll(/hasText: \/(.+?)\/([a-z]*) \}/g)].map((m) => new RegExp(m[1]!, m[2])),
    ];
    const pressed = [
      // stake: the pool's button, whether staking or not, and the pool's own.
      shown("staking.changePool"),
      shown("staking.choosePool"),
      shown("pools.stakeWith", "LOGIC"),
      // vote: the voting power's button, delegated or not, and the choice.
      shown("staking.change"),
      shown("staking.delegate"),
      `${shown("vote.abstain.title")} ${shown("vote.abstain.text")}`,
      // move-in: the token picker, and each token's amount.
      shown("token.selectAll"),
      shown("token.addCount_one", "1"),
      shown("token.addCount_other", "2"),
      shown("token.allOf"),
      // withdraw: the destination read, to an address or a handle.
      `${shown("destination.sendsTo")} addr_test1qz…`,
      `${shown("destination.handleIs", "logic")} addr_test1qz…`,
    ];
    expect(patterns.length).toBeGreaterThanOrEqual(8);
    expect(pressed.filter((label) => !patterns.some((p) => p.test(label)))).toEqual([]);
  });

  it("choose who pays a mint, and where a removal's ADA goes, on their radio cards, each card alone", () => {
    const cards = [shown("mint.source.account"), shown("mint.source.seedelf")];
    // Each name a call may take, matched as Playwright matches it: a string anywhere in the name, in any case, unless
    // exact; an expression as it says.
    const matchers = calls().flatMap((c) => [
      ...c.names.map((n) => ({ role: c.role, test: (t: string) => (c.exact ? t === n : t.toLowerCase().includes(n.toLowerCase())) })),
      ...c.patterns.map((p) => ({ role: c.role, test: (t: string) => p.test(t) })),
    ]);
    const onCards = matchers.filter((m) => cards.some((card) => m.test(card)));
    expect(onCards.length, "the mint's and the removal's").toBeGreaterThanOrEqual(2);
    expect(onCards.filter((m) => m.role !== "radio").map((m) => m.role)).toEqual([]);
    // A removal's card says what it ties under its name ("Ties this ADA, once private, to your public account …").
    const lines = Object.entries(en).flatMap(([k, v]) => (/^remove\.(privacy|warn)\.option\./.test(k) ? [v.replace(PLACEHOLDER, "MIN")] : []));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const card of cards) {
      const others = cards.filter((o) => o !== card).flatMap((o) => [o, ...lines.map((l) => `${o}${l}`)]);
      const mine = onCards.filter((m) => m.test(card));
      expect(mine.length, card).toBeGreaterThanOrEqual(1);
      expect(others.filter((o) => mine.some((m) => m.test(o))), `${card} picks its own card alone`).toEqual([]);
    }
  });

  it("name in their presets only flows there are, with the words those flows take", () => {
    const flows = new Set([...read("../e2e/live/flows.mjs").matchAll(/^ {2}async "?([\w-]+)"?\(/gm)].map((m) => m[1]!));
    expect(flows).toEqual(new Set(["mint", "move-in", "transfer", "withdraw", "stake", "vote", "withdraw-rewards", "unstake", "remove"]));
    // A preset in quotes, or a template with this run's own tags in it (`live1-${stamp}`).
    const raw = [...runner.matchAll(/^const [A-Z]+ = (["`])(.+)\1;$/gm)].map((m) => m[2]!);
    expect(raw.length, "all and staking").toBe(2);
    const steps = raw.flatMap((p) => p.split("+").map((s) => s.trim().split(/\s+/)));
    expect(steps.filter(([name]) => !flows.has(name!))).toEqual([]);
    // Each Seedelf a preset mints is this run's own: an earlier run's first Seedelf stays, and a tag two share finds
    // neither (seedelfName). Its tag fits the wallet's limit with the stamp's four characters in.
    const tags = steps.filter(([name]) => name === "mint").map((s) => s[1]!);
    expect(tags.length, "the account's mint and the stealth one").toBe(2);
    expect(tags.filter((t) => !/\$\{\w+\}/.test(t))).toEqual([]);
    expect(tags.map((t) => t.replace(/\$\{\w+\}/, "abcd")).filter((t) => t.length > LABEL_MAX)).toEqual([]);
    // mint [tag] [account|seedelf] and remove [tag] [account|seedelf], as flows.mjs checks them.
    const payers = steps.filter(([name]) => name === "mint" || name === "remove").map((s) => s[2] ?? "account");
    expect(payers.filter((p) => p !== "account" && p !== "seedelf")).toEqual([]);
  });
});
