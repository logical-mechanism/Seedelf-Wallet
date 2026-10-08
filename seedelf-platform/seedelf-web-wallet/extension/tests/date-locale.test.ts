// Dates follow the language on, through dateLocale() (the post-release
// roadmap's O8, chunk 25), and numbers stay en-US (the owner's call). Every
// date was "en-GB" before chunk 25, the test suite runs in English, where
// dateLocale() is "en-GB" too, and the e2e never changes language: a site put
// back to "en-GB", or to no locale (the browser's), would show English months
// on a Spanish or Japanese screen and fail nothing (1.3.0's release review, C40).
// format.test.ts checks the dates format.ts writes and those Activity's
// headings and Home's banner write; this checks Voting's note, which a render
// reaches, and scans the source for the rest, the Activity's When row among
// them, which only a click shows.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAst } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import { i18n } from "../src/i18n/core";
import { drepList } from "../src/ui/dreps";
import { NetworkContext } from "../src/ui/network";
import { Voting } from "../src/ui/screens/Voting";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

type Node = { type: string; start: number; end: number; [key: string]: unknown };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const path = `${dir}/${f}`;
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(f) ? [path] : [];
  });
}

const DATE_METHODS = new Set(["toLocaleDateString", "toLocaleTimeString"]);
const isDateLocale = (arg: Node | undefined) =>
  arg?.type === "CallExpression" && (arg.callee as Node).type === "Identifier" && (arg.callee as Node).name === "dateLocale";
const isNewDate = (node: Node) =>
  node.type === "NewExpression" && (node.callee as Node).type === "Identifier" && (node.callee as Node).name === "Date";

/**
 * Each date or time `source` writes in anything but dateLocale(): a fixed
 * locale, or none (the browser's). A date's own methods, a Date made where
 * it's written (`new Date(…).toLocaleString(…)`) and Intl.DateTimeFormat; a
 * number's toLocaleString, which stays en-US, isn't one.
 */
function datesNotInLanguage(file: string, source: string): string[] {
  const ast = parseAst(source, { lang: file.endsWith(".tsx") ? "tsx" : "ts" }) as unknown as Node;
  const found: string[] = [];
  const at = (n: Node, what: string) => found.push(`${source.slice(0, n.start).split("\n").length}: ${what}`);
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as Node;
    if ((n.type === "CallExpression" || n.type === "NewExpression") && (n.callee as Node).type === "MemberExpression") {
      const member = n.callee as Node;
      const method = (member.property as Node).name as string;
      const object = member.object as Node;
      const first = (n.arguments as Node[])[0];
      const dated = DATE_METHODS.has(method) || (method === "toLocaleString" && isNewDate(object));
      const intl = object.type === "Identifier" && object.name === "Intl" && method === "DateTimeFormat";
      if ((dated || intl) && !isDateLocale(first)) at(n, intl ? "Intl.DateTimeFormat" : method);
    }
    for (const child of Object.values(n)) visit(child);
  };
  visit(ast);
  return found;
}

describe("dates in the language on, where the screens write them (O8; 1.3.0's release review, C40)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("says the day Voting's DRep list was recorded the language's way", async () => {
    const { recorded } = drepList("preprod");
    expect(recorded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const day = (locale: string) =>
      new Date(`${recorded}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const note = () => {
      const html = renderToStaticMarkup(
        createElement(
          NetworkContext.Provider,
          { value: "preprod" },
          createElement(Voting, {
            current: null,
            registered: true,
            busy: false,
            onBack: () => undefined,
            onVote: () => undefined,
            onBecome: () => undefined,
            view: { pick: "drep", query: "" },
          }),
        ),
      );
      return /data-testid="drep-list-note">([^<]*)</.exec(html)?.[1] ?? "";
    };
    expect(note()).toContain(day("en-GB"));
    for (const [language, locale] of [
      ["es", "es-ES"],
      ["ja", "ja-JP"],
    ] as const) {
      await i18n.changeLanguage(language);
      expect(note()).toContain(day(locale));
      expect(note()).not.toContain(day("en-GB"));
    }
  });

  it("writes every date and time in src through dateLocale(), never a fixed locale or the browser's", () => {
    const found = sources(SRC).flatMap((file) =>
      datesNotInLanguage(file, readFileSync(file, "utf8")).map((line) => `${file.slice(SRC.length + 1)}:${line}`),
    );
    expect(found).toEqual([]);
  });

  it("would catch each of chunk 25's sites put back as it was, or given no locale, and leaves numbers alone", () => {
    const sites: Array<[string, string, string]> = [
      ["ui/screens/Activity.tsx", "toLocaleDateString(dateLocale(), { day:", 'toLocaleDateString("en-GB", { day:'],
      ["ui/screens/Activity.tsx", "new Date(open.at).toLocaleString(dateLocale())", "new Date(open.at).toLocaleString()"],
      ["ui/screens/Voting.tsx", "toLocaleDateString(dateLocale(), { day:", 'toLocaleDateString("en-GB", { day:'],
      ["ui/components/PendingBanner.tsx", "d.toLocaleDateString(dateLocale(),", 'd.toLocaleDateString("en-GB",'],
    ];
    for (const [rel, from, to] of sites) {
      const file = `${SRC}/${rel}`;
      const source = readFileSync(file, "utf8");
      expect(source.split(from).length - 1, `${rel}: ${from}`).toBe(1);
      expect(datesNotInLanguage(file, source.replace(from, to)), `${rel}: ${to}`).toHaveLength(1);
    }
    // A number's grouping, en-US by the owner's call, and a date made elsewhere: neither is flagged.
    expect(datesNotInLanguage("x.ts", 'const a = (1234).toLocaleString("en-US"); const b = when.toLocaleString("en-US");')).toEqual([]);
    expect(datesNotInLanguage("x.ts", 'new Intl.DateTimeFormat("en-GB").format(d); Intl.DateTimeFormat(dateLocale());')).toEqual([
      "1: Intl.DateTimeFormat",
    ]);
  });
});
