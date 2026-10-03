// What holds three locale files together. The shape of this is Lace's
// `translationKeyParity.test.ts`, and so is its reasoning: these guards catch
// *mangling* — a dropped key, a renamed placeholder, an emptied value — while
// whether a sentence is good Spanish is a person's judgement and deliberately
// not CI's. What is ours is the last three: the name, the negation, and the
// gate that stops an unchecked machine draft shipping as a warning.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { criticalKeys } from "../scripts/i18n-critical.mjs";

const DIR = fileURLToPath(new URL("../src/i18n/translations", import.meta.url));
const DOCS = fileURLToPath(new URL("../../docs/i18n", import.meta.url));

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const locale = (file: string): Record<string, string> => read(join(DIR, file));
const localeFiles = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();
const others = localeFiles.filter((f) => f !== "en.json");
const codeOf = (file: string) => file.replace(/\.json$/, "");

const en = locale("en.json");
/** Derived once: it parses every .tsx under src/, which is not a per-key cost. */
const CRITICAL = criticalKeys(Object.keys(en));
const isCritical = (key: string) => CRITICAL.includes(baseOf(key));

/** i18next's plural suffixes. */
const PLURAL = /_(few|many|one|other|two|zero)$/;
const baseOf = (key: string) => key.replace(PLURAL, "");
/** The plural categories a language actually has, from the browser's own CLDR data. */
const categoriesOf = (code: string) => new Set<string>(new Intl.PluralRules(code).resolvedOptions().pluralCategories);

/** `{{token}}` names, sorted, as one string. */
const tokensOf = (value: string) =>
  [...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]).sort().join("|");

describe("the locale files", () => {
  it("are three, and not trivially small (so these checks can't pass on nothing)", () => {
    expect(localeFiles).toContain("en.json");
    expect(localeFiles.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(en).length).toBeGreaterThan(50);
    expect(others.length).toBeGreaterThanOrEqual(2);
  });

  it.each(others)("%s carries exactly en.json's keys, counting a plural as one", (file) => {
    const bases = (keys: string[]) => new Set(keys.map(baseOf));
    const want = bases(Object.keys(en));
    const got = bases(Object.keys(locale(file)));
    expect([...want].filter((k) => !got.has(k)).sort(), `keys of en.json missing from ${file}`).toEqual([]);
    expect([...got].filter((k) => !want.has(k)).sort(), `keys in ${file} that en.json hasn't`).toEqual([]);
  });

  // NOT Lace's identical-key-set rule. Intl.PluralRules gives English
  // `one, other`, Spanish `one, many, other` and Japanese `other` alone, so an
  // identical set would leave Spanish without the form it needs for a million
  // and give Japanese one its language never uses.
  it.each(localeFiles)("%s has every plural form its own language has, and no others", (file) => {
    const code = codeOf(file);
    const want = categoriesOf(code);
    const keys = Object.keys(locale(file));
    const wrong: string[] = [];
    for (const base of new Set(keys.filter((k) => PLURAL.test(k)).map(baseOf))) {
      const have = new Set(
        keys.filter((k) => baseOf(k) === base && PLURAL.test(k)).map((k) => k.slice(base.length + 1)),
      );
      for (const c of want) if (!have.has(c)) wrong.push(`${base}: ${code} needs _${c}`);
      for (const c of have) if (!want.has(c)) wrong.push(`${base}: ${code} has no _${c}`);
    }
    expect(wrong.sort()).toEqual([]);
  });

  it.each(localeFiles)("%s has no empty value", (file) => {
    const empty = Object.entries(locale(file))
      .filter(([, v]) => typeof v !== "string" || v.trim() === "")
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it.each(others)("%s keeps every {{token}} en.json has", (file) => {
    const got = locale(file);
    const wrong = Object.keys(got)
      .filter((k) => en[baseOf(k)] !== undefined || en[k] !== undefined)
      .map((k) => {
        // A plural form is compared against English's own form, or its base.
        const source = en[k] ?? en[`${baseOf(k)}_other`] ?? en[`${baseOf(k)}_one`] ?? en[baseOf(k)];
        if (source === undefined) return "";
        const want = tokensOf(source);
        const have = tokensOf(got[k]!);
        if (want === have) return "";
        // A plural form may write a fixed count out in words and drop {{count}}.
        if (PLURAL.test(k)) {
          const less = want.split("|").filter((t) => t !== "count").join("|");
          if (have === less) return "";
        }
        return `${k}: en=[${want}] ${file}=[${have}]`;
      })
      .filter(Boolean);
    expect(wrong.sort()).toEqual([]);
  });
});

describe("the wallet's name, in every language", () => {
  // words.test.ts checks the source; these are the strings themselves, and
  // Seedelf is Seedelf in Spanish and Japanese too.
  const WRONG = [/\bseedelfs?\b/, /\bSeedelf wallet\b/, /\bSEEDELF\b/];
  it.each(localeFiles)("%s writes Seedelf as Seedelf", (file) => {
    const bad = Object.entries(locale(file))
      .filter(([, v]) => WRONG.some((w) => w.test(v)))
      .map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });
});

describe("a translation that quietly says the opposite", () => {
  // The failure a confident wrong translation actually looks like: a dropped
  // clause or an inverted negation, as in "anyone can see money went into
  // Seedelf, though not whose Seedelf it is". A language may legitimately
  // recast a sentence so the negation moves or goes, so this is a warning for
  // most keys — and a hard failure for an accuracy-critical one.
  const NEGATED: Record<string, RegExp> = {
    en: /\b(not|never|no|none|nothing|nobody|cannot|can't|isn't|aren't|won't|don't|doesn't|didn't|wouldn't|couldn't|shouldn't|hasn't|haven't|without)\b/i,
    es: /\b(no|ni|nunca|nada|nadie|ningún|ninguna|ninguno|sin|tampoco)\b/i,
    // Japanese negates in more than one shape: the plain ない/ません, the
    // classical ず, and なし for English's "without". Each one here was added
    // because a real sentence used it and this check flagged it wrongly.
    ja: /(ない|ません|ありませ|せず|ずに|なく|なし|不可|決して)/,
  };

  it.each(others)("%s keeps a negation where English has one, for every critical key", (file) => {
    const code = codeOf(file);
    const test = NEGATED[code];
    if (!test) return;
    const got = locale(file);
    const lost: string[] = [];
    for (const [key, value] of Object.entries(got)) {
      const source = en[key] ?? en[`${baseOf(key)}_other`] ?? en[`${baseOf(key)}_one`];
      if (source === undefined) continue;
      if (!NEGATED.en!.test(source) || test.test(value)) continue;
      if (isCritical(key)) lost.push(`${key}: ${value}`);
    }
    expect(lost.sort()).toEqual([]);
  });
});

describe("a value that is still English", () => {
  it.each(others)("%s only repeats English where its provenance says so", (file) => {
    const code = codeOf(file);
    const prov: Record<string, string> = read(join(DOCS, `${code}-provenance.json`));
    const got = locale(file);
    const unexplained = Object.entries(got)
      .filter(([k, v]) => en[k] !== undefined && en[k] === v)
      .filter(([k]) => !["exact-reuse", "verbatim", "human"].includes(prov[k] ?? ""))
      .map(([k]) => k);
    expect(unexplained.sort(), `identical to English with no reason recorded in ${code}-provenance.json`).toEqual([]);
  });
});

describe("which keys are accuracy-critical", () => {
  it("is derived from the source, and the checked-in list matches", () => {
    const checkedIn: string[] = read(join(DOCS, "critical-keys.json"));
    expect(CRITICAL, "run `node scripts/i18n-critical.mjs --write`").toEqual(checkedIn);
    expect(CRITICAL.length).toBeGreaterThan(0);
  });

  it.each(others)("%s has no unchecked machine draft among them", (file) => {
    const code = codeOf(file);
    const prov: Record<string, string> = read(join(DOCS, `${code}-provenance.json`));
    const verified: { reviewer: string; keys: string[] } = read(join(DOCS, `verified-critical-${code}.json`));
    expect(verified.reviewer, "a verification with no reviewer named isn't one").toMatch(/\S{20,}/);
    const ok = new Set(verified.keys);
    const unchecked = Object.keys(locale(file))
      .filter(isCritical)
      .filter((k) => !["human", "mtpe", "exact-reuse", "verbatim"].includes(prov[k] ?? "machine"))
      .filter((k) => !ok.has(baseOf(k)))
      .map((k) => `${k} (${prov[k] ?? "unrecorded"})`);
    expect(
      unchecked.sort(),
      `accuracy-critical in ${file} with an unchecked draft: back-translate it and list it in verified-critical-${code}.json`,
    ).toEqual([]);
  });

  it.each(others)("%s records a provenance for every key it has", (file) => {
    const code = codeOf(file);
    const prov: Record<string, string> = read(join(DOCS, `${code}-provenance.json`));
    const missing = Object.keys(locale(file)).filter((k) => !(k in prov));
    expect(missing.sort(), `no provenance recorded in ${code}-provenance.json`).toEqual([]);
  });
});
