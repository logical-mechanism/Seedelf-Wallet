// How every text view names a token (launch review #18): a listed token by
// its ticker; any other marked as not on the wallet's list, with its
// fingerprint; and one named like ADA or a listed token never by that name.
// Plus the one rule for a token's decimals (#55).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TokenAmount } from "../src/shared/rpc";
import { nameSkeleton } from "../src/ui/format";
import { assetFingerprint, tokenAmountText, tokenDecimals, tokenLabel, tokenMark, tokenText, viewToken } from "../src/ui/tokens";
import { TokenAmountText } from "../src/ui/components/TokenList";

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");

// The real preprod tUSDM (6 decimals) on the wallet's list, and a stranger's policy.
const TUSDM = { policyId: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde", assetName: "0014df10745553444d" };
const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
const named = (name: string) => ({ policyId: STRANGER, assetName: hex(name) });

describe("a token's fingerprint", () => {
  it("is CIP-14's", () => {
    // The CIP's own test vectors.
    expect(assetFingerprint({ policyId: "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373", assetName: "" })).toBe(
      "asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3",
    );
    expect(
      assetFingerprint({ policyId: "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373", assetName: "504154415445" }),
    ).toBe("asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92");
    expect(
      assetFingerprint({ policyId: "1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209", assetName: "504154415445" }),
    ).toBe("asset1hv4p5tv2a837mzqrst04d0dcptdjmluqvdx9k3");
  });
});

describe("tokenText", () => {
  it("names a listed token by its ticker, and marks nothing", () => {
    const text = tokenText("preprod", TUSDM);
    expect(text).toMatchObject({ label: "tUSDM", listed: true });
    expect(tokenMark(text)).toBeUndefined();
    expect(tokenAmountText("preprod", { ...TUSDM, quantity: "1500000" })).toBe("1.5 tUSDM");
  });

  it("marks one that isn't listed, with its fingerprint", () => {
    const foo = named("FOO");
    const text = tokenText("preprod", foo);
    expect(text).toMatchObject({ label: "FOO", listed: false, fingerprint: assetFingerprint(foo) });
    expect(text.id).toMatch(/^asset1\w{4}…\w{6}$/);
    expect(tokenAmountText("preprod", { ...foo, quantity: "500" })).toBe(`500 FOO (not on the wallet's list, ${text.id})`);
    expect(tokenMark(text, true)).toBe(`not on the wallet's list, ${text.fingerprint}`);
  });

  it("never lets one named ₳ or ADA read as ADA", () => {
    for (const name of ["₳", "ADA", "ada", "tADA", "Lovelace", "₳ bonus", "Ａ Ｄ Ａ", "ΑDΑ"]) {
      const token = named(name);
      const text = tokenText("preprod", token);
      expect(text, name).toMatchObject({ label: text.id, listed: false, posesAs: "ADA", own: name });
      const line = tokenAmountText("preprod", { ...token, quantity: "1000" });
      expect(line, name).toBe(`1,000 ${text.id} (not on the wallet's list: it calls itself ${name}, but it isn't ADA)`);
      expect(line.startsWith("1,000 ₳")).toBe(false);
    }
  });

  it("never lets one named like a listed token read as it: its ticker, its name, or a lookalike", () => {
    for (const name of ["tUSDM", "TUSDM", "t USDM", "tUSDМ", "tU​SDM", "Minswap (preprod)", "MIN"]) {
      const text = tokenText("preprod", named(name));
      expect(text.label, name).toBe(text.id);
      expect(text.label, name).not.toContain("USDM");
    }
    // A zero-width space hides characters: shown by its fingerprint, with no name.
    const hidden = tokenText("preprod", named("tU​SDM"));
    expect(tokenMark(hidden)).toBe("not on the wallet's list");
    const spoof = tokenText("preprod", named("TUSDM"));
    expect(tokenMark(spoof)).toBe("not on the wallet's list: it calls itself TUSDM, but it isn't the listed tUSDM");
    // The CIP-68 label is dropped before comparing: 333 + "tUSDM" is the listed one's name.
    expect(tokenText("preprod", { policyId: STRANGER, assetName: TUSDM.assetName }).posesAs).toBe("tUSDM");
  });

  it("never lets digits or separators before ADA or a listed token's name join the amount before it", () => {
    const cases: Array<[string, string]> = [
      ["000 ADA", "ADA"],
      [",000 ADA", "ADA"],
      [",000,000 ADA", "ADA"],
      [" 000 ADA", "ADA"],
      [" 000 ADA", "ADA"],
      ["’000 ADA", "ADA"],
      ["000 tADA", "ADA"],
      ["000 Lovelace", "ADA"],
      ["000 tUSDM", "tUSDM"],
      [",000 MIN", "MIN"],
      ["000tUSDM", "tUSDM"],
      // Letters that pass for the digits: Latin O, Cyrillic О.
      ["OOO tUSDM", "tUSDM"],
      ["О,ООО MIN", "MIN"],
    ];
    for (const [name, posesAs] of cases) {
      const token = named(name);
      const text = tokenText("preprod", token);
      expect(text, name).toMatchObject({ label: text.id, listed: false, posesAs, own: name });
      const real = posesAs === "ADA" ? "ADA" : `the listed ${posesAs}`;
      expect(tokenAmountText("preprod", { ...token, quantity: "1" }), name).toBe(
        `1 ${text.id} (not on the wallet's list: it calls itself ${name}, but it isn't ${real})`,
      );
    }
  });

  it("never lets one with ADA as one of its words read as an amount of ADA", () => {
    for (const name of ["ADA bonus", "Bonus ADA", "ADA-bonus", "free lovelace", "000ADA bonus", "ΑDΑ airdrop"]) {
      const text = tokenText("preprod", named(name));
      expect(text, name).toMatchObject({ label: text.id, posesAs: "ADA", own: name });
    }
  });

  it("keeps an unlisted name that only starts with digits, or has ADA inside a word, as it is", () => {
    for (const name of ["8Ball", "4EVER", "8 BALL", "1st place", "Adamant", "Lovelaced", "Canada"]) {
      const text = tokenText("preprod", named(name));
      expect(text, name).toMatchObject({ label: name, listed: false });
      expect(text.posesAs, name).toBeUndefined();
    }
  });

  // Vitest builds with the extension's own flags: CI runs it both ways (`VITE_ENABLE_MAINNET=true npm test`).
  const mainnetCase = __MAINNET_ENABLED__
    ? "never lets digits before a mainnet ticker join the amount"
    : "has no mainnet tickers to guard unless it's a mainnet build";
  it(mainnetCase, () => {
    for (const network of ["mainnet", "preprod"] as const) {
      const text = tokenText(network, named("000 SNEK"));
      if (__MAINNET_ENABLED__) expect(text, network).toMatchObject({ label: text.id, posesAs: "SNEK", own: "000 SNEK" });
      else expect(text, network).toMatchObject({ label: "000 SNEK" });
    }
  });

  it("names one it can't read, or with a name that hides characters, by its fingerprint", () => {
    for (const assetName of ["", "ff00", hex("‮KENS")]) {
      const text = tokenText("preprod", { policyId: STRANGER, assetName });
      expect(text.label).toBe(text.id);
      expect(tokenMark(text)).toBe("not on the wallet's list");
    }
    // An emoji's own joiners and selectors aren't hiding anything.
    expect(tokenText("preprod", named("🐍\u{FE0F}")).label).toBe("🐍\u{FE0F}");
  });

  it("gives the lists the same names: tokenLabel and viewToken", () => {
    const fake: TokenAmount = { ...named("₳"), quantity: "5", decimals: 0, fingerprint: "asset1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" };
    const view = viewToken("preprod", fake);
    expect(view.label).toBe("asset1qqqq…qqqqqq");
    expect(view.sub).toBe("Calls itself ₳, not on the wallet's list");
    expect(tokenLabel("preprod", fake)).toBe(view.label);
  });

  it("shows a review's line with its mark, in the page's words", () => {
    const foo = renderToStaticMarkup(createElement(TokenAmountText, { token: named("FOO"), amount: "500" }));
    expect(foo).toMatch(/^500 FOO<span class="token-mark"[^>]*>Not on the wallet&#x27;s list, asset1\w{4}…\w{6}\.<\/span>$/);
    const spoof = renderToStaticMarkup(createElement(TokenAmountText, { token: named("TUSDM"), amount: "500" }));
    expect(spoof).toMatch(/^500 asset1\w{4}…\w{6}<span class="token-mark token-mark--warn"/);
    expect(spoof).toContain("it calls itself TUSDM, but it isn&#x27;t the listed tUSDM.");
    const listed = renderToStaticMarkup(createElement(TokenAmountText, { token: TUSDM, amount: "1.5" }));
    expect(listed).toBe("1.5 tUSDM");
  });
});

describe("tokenDecimals", () => {
  it("takes the wallet's list's decimals over Koios's, then Koios's, then none", () => {
    // Koios said 0 for a listed token with 6 (preprod MIN, say): the list wins.
    expect(tokenDecimals("preprod", { ...TUSDM, decimals: 0 })).toBe(6);
    expect(tokenDecimals("preprod", { ...named("FOO"), decimals: 4 })).toBe(4);
    expect(tokenDecimals("preprod", named("FOO"))).toBe(0);
    const held: TokenAmount = { ...TUSDM, quantity: "100000000", decimals: 0, fingerprint: "" };
    expect(viewToken("preprod", held).amount).toBe("100");
  });
});

describe("nameSkeleton", () => {
  it("folds what only looks different", () => {
    expect(nameSkeleton("8Ball")).toBe(nameSkeleton("8 BALL"));
    expect(nameSkeleton("SNEK")).toBe(nameSkeleton("ЅNЕK"));
    expect(nameSkeleton("SNEK")).toBe(nameSkeleton("5NEK"));
    expect(nameSkeleton("SNEK")).toBe(nameSkeleton("𝐒𝐍𝐄𝐊"));
    expect(nameSkeleton("iBTC")).toBe(nameSkeleton("1BTC"));
    expect(nameSkeleton("Café")).toBe(nameSkeleton("cafe"));
    expect(nameSkeleton("SNEK")).not.toBe(nameSkeleton("SNAKE"));
  });
});
