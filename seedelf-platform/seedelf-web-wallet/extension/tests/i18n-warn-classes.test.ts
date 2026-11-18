// A warning shown in the warning's colour through a `--warn` class, with no callout or alert around it, is
// accuracy-critical, as one in a callout is (chunk 51, e9b#2, its verifier's test, moved here): an unlisted token
// passing for ADA or a listed token, in every review and site sign window and on Home; a pool that keeps all its
// rewards or is oversaturated; a pool's ticker or a DRep's name that another one uses too. scripts/i18n-critical.mjs
// (isCriticalElement) read only callouts and alerts, and none of these keys was named `.warn.`, so they weren't in
// docs/i18n/critical-keys.json, and tests/i18n.test.ts's verified-critical and negation gates never looked at them.
// Each element is rendered here with every English value marked by the key that made it, and every key with words of
// its own inside a `--warn` element has to be in the derived set. The deriver reads the class now; a key it reaches
// only through a helper carries `.warn.`.
import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";

import { criticalKeys } from "../scripts/i18n-critical.mjs";
import { i18n } from "../src/i18n/core";
import type { PoolRow, TokenAmount } from "../src/shared/rpc";
import { TokenAmountText, TokenRow } from "../src/ui/components/TokenList";
import { NetworkContext } from "../src/ui/network";
import { PoolListRow } from "../src/ui/screens/Pools";
import { DrepRow } from "../src/ui/screens/Voting";
import { viewToken } from "../src/ui/tokens";

const en: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/i18n/translations/en.json", import.meta.url), "utf8"),
);
const CRITICAL = new Set(criticalKeys(Object.keys(en)));
const baseOf = (key: string) => key.replace(/_(few|many|one|other|two|zero)$/, "");

// A language whose every value is English's, wrapped in its own key with its placeholders kept: ⟦key¦value⟧.
const MARKED = "x-keys";
i18n.addResourceBundle(
  MARKED,
  "translation",
  Object.fromEntries(Object.entries(en).map(([k, v]) => [k, `⟦${k}¦${v}⟧`])),
);
const KEY_MARK = /⟦([^¦⟧]+)¦/g;

afterAll(async () => {
  await i18n.changeLanguage("en");
});

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
const named = (name: string) => ({ policyId: STRANGER, assetName: hex(name) });
const noop = () => undefined;
const pool: PoolRow = {
  id: "pool1abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklm",
  ticker: "LOGIC",
  margin: 1,
  cost: "340000000",
  pledge: "1000000000",
  stake: "5000000000000",
  saturation: 120,
};
const fakeAda: TokenAmount = { ...named("₳"), quantity: "5", decimals: 0, fingerprint: "" };

/** What shows each warning, made in the language that's on: a token's view takes its words when it's made. */
const elements = (): Array<[string, ReactElement]> => [
  ["a review's token passing for a listed one", createElement(TokenAmountText, { token: named("TUSDM"), amount: "500" })],
  ["a review's token passing for ADA", createElement(TokenAmountText, { token: named("₳"), amount: "5" })],
  ["Home's row of a token passing for ADA", createElement(TokenRow, { view: viewToken("preprod", fakeAda), onOpen: noop })],
  ["a pool's row in the list", createElement(PoolListRow, { pool, current: false, shared: true, onOpen: noop })],
  [
    "a DRep's row in the list",
    createElement(DrepRow, {
      drep: { id: "drep1y296z8tm7y7elwsmsewn4q2tdr5gu0fqztq97yttlpv7zycvsl554", name: "8Ball" },
      shared: true,
      disabled: false,
      onPick: noop,
    }),
  ],
];

/** Each element whose class has a `--warn` modifier: the warning's colour, with no callout or alert around it. */
const WARN = /<(\w+) class="([^"]*--warn\b[^"]*)"[^>]*>([^<]*)<\/\1>/g;
const decode = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const warningsIn = (element: ReactElement) =>
  [...renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element)).matchAll(WARN)].map(
    (m) => ({ cls: m[2]!, text: decode(m[3]!) }),
  );

/** A key with words of its own, not a frame such as `{{text}}.` whose words are all its values'. */
const hasWords = (key: string) => /\p{L}/u.test((en[key] ?? "").replace(/\{\{[^}]*\}\}/g, ""));

describe("a warning in the warning's colour, with no callout around it (chunk 51, e9b#2)", () => {
  it("is what each of these elements shows", async () => {
    await i18n.changeLanguage("en");
    expect(elements().map(([what, element]) => [what, warningsIn(element).map((w) => w.text)])).toEqual([
      ["a review's token passing for a listed one", ["Not on the wallet's list: it calls itself TUSDM, but it isn't the listed tUSDM."]],
      ["a review's token passing for ADA", ["Not on the wallet's list: it calls itself ₳, but it isn't ADA."]],
      ["Home's row of a token passing for ADA", ["Calls itself ₳, not on the wallet's list"]],
      ["a pool's row in the list", ["Shared ticker", "Keeps all rewards", "Oversaturated"]],
      ["a DRep's row in the list", ["Shared name"]],
    ]);
  });

  it("has every key with words of its own in the accuracy-critical set, so no draft of it ships unchecked", async () => {
    await i18n.changeLanguage(MARKED);
    const shown: string[] = [];
    const unchecked: string[] = [];
    for (const [what, element] of elements()) {
      for (const { cls, text } of warningsIn(element)) {
        for (const [, key] of text.matchAll(KEY_MARK)) {
          shown.push(key!);
          if (hasWords(key!) && !CRITICAL.has(baseOf(key!))) unchecked.push(`${baseOf(key!)}: ${what}, class "${cls}"`);
        }
      }
    }
    // Seven warnings, and every one read through its key: a test that reads nothing can't pass.
    expect(shown.filter(hasWords).length, JSON.stringify(shown)).toBeGreaterThanOrEqual(7);
    expect([...new Set(unchecked)].sort()).toEqual([]);
  });
});


describe("the deriver reads a warning's class (chunk 51, e9b#2)", () => {
  it("puts a key a `--warn` element says in the set by the element alone, as a callout's", () => {
    // Neither is named `.warn.`: the pool's and the DRep's shared-name tags are critical by where they're shown.
    expect(CRITICAL.has("pools.sharedTickerTag")).toBe(true);
    expect(CRITICAL.has("vote.sharedNameTag")).toBe(true);
    // A hand-made `callout--warn` is a warning too: the auto-lock's countdown.
    expect(CRITICAL.has("lock.idle")).toBe(true);
    // And a class put together without a `--warn` it can come out with is none: a row's avatar is no warning.
    expect(CRITICAL.has("tokenList.onItsWay")).toBe(false);
  });
});
