// A token's second line is words when it's a lookalike's warning ("Calls itself ₳, not on the wallet's list"), and
// the lists keep their views in a memo (release review C45). Another page's switch of language redraws the list, so a
// memo whose words change with the language has to be made again then: the language is among what it depends on, or
// the warning stays in the language before. Each list is rendered in English and in Japanese with the same tokens,
// and every memo whose value changed has to have a dependency that changed too, as React compares them.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const memos = vi.hoisted(() => ({ seen: [] as Array<{ deps: readonly unknown[]; value: unknown }> }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useMemo: <T>(make: () => T, deps: readonly unknown[]): T => {
      const value = react.useMemo(make, deps);
      memos.seen.push({ deps, value });
      return value;
    },
  };
});

const { i18n } = await import("../src/i18n/core");
const { TokenPicker } = await import("../src/ui/components/TokenAmounts");
const { TokenList } = await import("../src/ui/components/TokenList");
const { NetworkContext } = await import("../src/ui/network");
const { TokenSelect } = await import("../src/ui/screens/Swaps");
const { Tokens } = await import("../src/ui/screens/Tokens");
const { UtxoDetails } = await import("../src/ui/screens/Utxos");

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
// One that calls itself ₳, and one that's only not on the list: both get words for a second line.
const tokens = [
  { policyId: STRANGER, assetName: hex("₳"), quantity: "5", decimals: 0, fingerprint: "" },
  { policyId: STRANGER, assetName: hex("FOO"), quantity: "700", decimals: 0, fingerprint: "" },
];
const noop = () => undefined;
const seedelf = { lovelace: "50000000", utxos: 1, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 }, tokens };
const utxo = { txHash: "ab".repeat(32), index: 0, lovelace: "2000000", tokens, locked: false };

/** The memos `element` makes, rendered in `code`. */
async function memosIn(element: ReactElement, code: "en" | "ja") {
  await i18n.changeLanguage(code);
  memos.seen = [];
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));
  return memos.seen;
}

describe("a list's token views after another page switches the language", () => {
  const lists: Array<[string, ReactElement]> = [
    ["Home's list", createElement(TokenList, { tokens, of: "seedelf", testId: "tokens", onViewAll: noop })],
    ["View all", createElement(Tokens, { tokens, of: "seedelf", onBack: noop })],
    ["Add tokens", createElement(TokenPicker, { tokens, onClose: noop, onPick: noop })],
    ["a UTxO's tokens", createElement(UtxoDetails, { of: "seedelf", utxo, busy: false, onLock: noop, onClose: noop })],
    ["a swap's picker", createElement(TokenSelect, { which: "pay", seedelf, onPick: noop, onClose: noop })],
  ];

  for (const [name, element] of lists) {
    it(`are made again in ${name}`, async () => {
      const en = await memosIn(element, "en");
      const ja = await memosIn(element, "ja");
      expect(ja).toHaveLength(en.length);
      let worded = 0;
      en.forEach((before, i) => {
        const after = ja[i]!;
        if (JSON.stringify(before.value) === JSON.stringify(after.value)) return;
        worded++;
        const again = before.deps.some((d, j) => !Object.is(d, after.deps[j]));
        expect(again, `${name}: memo ${i} changed with the language, but none of what it depends on did`).toBe(true);
      });
      // Not a test of nothing: the list's warning is words, in each language its own.
      expect(worded, name).toBeGreaterThan(0);
    });
  }
});
