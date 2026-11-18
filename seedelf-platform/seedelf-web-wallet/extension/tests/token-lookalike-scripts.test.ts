// The check for a token, a pool or a DRep named like another, across the scripts that draw Latin letters, and the
// blanks that push a name's last letters out of a list's row.
//
// Chunk 51, e9b#1 (its verifier's test, moved here): a letter of another script that draws a Latin one must fold to
// that Latin letter, capitals too. foldName lower-cased first and then mapped, so the Greek capitals Ν Μ Η Υ, which
// draw N M H Y, became ν μ η υ and then "v" "u" "n" "u"; and the Cherokee and Lisu letters that draw A and D weren't
// mapped at all. A stranger's token named "tUSDΜ" or "ᎪᎠᎪ" then kept its own name and wasn't marked as posing as tUSDM
// or ADA, in every text view, on Home and in a site's signing prompt; and a pool ticker so spelled wasn't flagged as
// shared. The confusables are Unicode's (UTS #39 confusables.txt): 039C→M, 039D→N, 0397→H, 03A5→Y, 13AA→A, 13A0→D,
// A4EE→A, A4D3→D.
//
// gap-g10#1: nine em spaces between "tUSDM" and an "x" are a name the lists cut to "tUSDM …", so a row read as the
// listed one; a run of blanks is one space now, in a token's name and in a DRep's or a pool's. And gap-g10#3: the Add
// tokens picker showed a lookalike's warning cut short, in grey.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DappTxSummary, TokenAmount } from "../src/shared/rpc";
import { nameSkeleton, oneSpaced, plainName, sharedNames, sharing } from "../src/ui/format";
import { NetworkContext } from "../src/ui/network";
import { SignTx } from "../src/ui/screens/DappApprovals";
import { TokenPicker } from "../src/ui/components/TokenAmounts";
import { tokenAmountText, tokenText, viewToken } from "../src/ui/tokens";

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
const named = (name: string) => ({ policyId: STRANGER, assetName: hex(name) });

// Greek capitals that draw Latin letters, and the Cherokee and Lisu letters that draw A and D.
const ALPHA = "Α"; // Α, draws A: folds right today (α → "a")
const EPSILON = "Ε"; // Ε, draws E
const ETA = "Η"; // Η, draws H
const IOTA = "Ι"; // Ι, draws I
const KAPPA = "Κ"; // Κ, draws K
const MU = "Μ"; // Μ, draws M
const NU = "Ν"; // Ν, draws N
const UPSILON = "Υ"; // Υ, draws Y
const CHEROKEE_ADA = "ᎪᎠᎪ"; // ᎪᎠᎪ: Cherokee GO, A, GO
const LISU_ADA = "ꓮꓓꓮ"; // ꓮꓓꓮ: Lisu A, DA, A

// Each fake beside the name it draws.
const GREEK: Array<[string, string]> = [
  [`tUSD${MU}`, "tUSDM"],
  [`${MU}${IOTA}${NU}`, "MIN"],
  [`S${NU}${EPSILON}${KAPPA}`, "SNEK"],
  [`${ETA}OSKY`, "HOSKY"],
  [`${IOTA}${NU}D${UPSILON}`, "INDY"],
  [`USD${MU}`, "USDM"],
  [`${NU}U${NU}${ALPHA}`, "NUNA"],
];

const summary = (over: Partial<DappTxSummary>): DappTxSummary => ({
  txHash: "ab".repeat(32),
  fee: "180000",
  netLovelace: "-500000000",
  netTokens: [],
  spentLovelace: "500180000",
  returnedLovelace: "0",
  stakingLovelace: "0",
  ownInputs: 1,
  paid: [],
  ownOutputs: [],
  mint: [],
  certificates: [],
  withdrawals: [],
  collateral: null,
  scripts: false,
  referenceInputs: 0,
  votes: 0,
  proposals: [],
  donation: null,
  note: null,
  metadata: false,
  validFrom: null,
  validUntil: null,
  signs: ["0/0"],
  unknownInputs: [],
  othersSign: 0,
  complete: true,
  ...over,
});
const ADDRESS = "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp";
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the lookalike check, its controls: what it caught already", () => {
  it("folds Cyrillic М and Greek Α, and marks the tokens so named", () => {
    expect(nameSkeleton("tUSDМ")).toBe(nameSkeleton("tUSDM"));
    expect(tokenText("preprod", named("tUSDМ")).posesAs).toBe("tUSDM");
    expect(tokenText("preprod", named(`${ALPHA}D${ALPHA}`)).posesAs).toBe("ADA");
  });
});

describe("a capital of another script that draws a Latin letter folds to it (chunk 51, e9b#1)", () => {
  it("gives Greek capitals the skeleton of the Latin name they draw", () => {
    expect(GREEK.map(([fake]) => [fake, nameSkeleton(fake)])).toEqual(GREEK.map(([fake, real]) => [fake, nameSkeleton(real)]));
  });

  it("gives Cherokee and Lisu ADA the skeleton of ADA", () => {
    expect([CHEROKEE_ADA, LISU_ADA].map((fake) => [fake, nameSkeleton(fake)])).toEqual([
      [CHEROKEE_ADA, nameSkeleton("ADA")],
      [LISU_ADA, nameSkeleton("ADA")],
    ]);
  });

  it("marks a stranger's tUSDΜ and ΜΙΝ as posing as the listed tUSDM and MIN, and names them by fingerprint", () => {
    const fakes: Array<[string, string]> = [
      [`tUSD${MU}`, "tUSDM"],
      [`${MU}${IOTA}${NU}`, "MIN"],
    ];
    expect(fakes.map(([fake]) => [fake, tokenText("preprod", named(fake)).posesAs])).toEqual(fakes);
    for (const [fake, real] of fakes) {
      const t = tokenText("preprod", named(fake));
      expect(tokenAmountText("preprod", { ...named(fake), quantity: "10000" }), fake).toBe(
        `10,000 ${t.id} (not on the wallet's list: it calls itself ${fake}, but it isn't the listed ${real})`,
      );
    }
  });

  it("marks a stranger's Cherokee or Lisu ADA as posing as ADA", () => {
    for (const fake of [CHEROKEE_ADA, LISU_ADA]) {
      const t = tokenText("preprod", named(fake));
      expect(t, fake).toMatchObject({ label: t.id, listed: false, posesAs: "ADA", own: fake });
      expect(tokenAmountText("preprod", { ...named(fake), quantity: "1000" }), fake).toBe(
        `1,000 ${t.id} (not on the wallet's list: it calls itself ${fake}, but it isn't ADA)`,
      );
    }
  });

  it("gives Home's row for tUSDΜ the warning line, in the warning's colour", () => {
    const fake: TokenAmount = { ...named(`tUSD${MU}`), quantity: "10000", decimals: 0, fingerprint: "" };
    const view = viewToken("preprod", fake);
    expect({ label: view.label, sub: view.sub, warn: view.warn }).toEqual({
      label: tokenText("preprod", fake).id,
      sub: `Calls itself tUSD${MU}, not on the wallet's list`,
      warn: true,
    });
  });

  it("warns in a site's signing prompt that a token it gets is named like tUSDM", () => {
    const fake = { ...named(`tUSD${MU}`), quantity: "10000" };
    const html = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(SignTx, {
          summary: summary({
            netTokens: [fake],
            paid: [{ address: ADDRESS, lovelace: "500000000", tokens: [], datum: null, script: false, seedelf: null, ownPaymentKey: false }],
          }),
          partial: false,
          session: false,
          collateralSpent: false,
        }),
      ),
    );
    const page = text(html);
    expect(page).not.toMatch(new RegExp(`Gets\\s+10,000 tUSD${MU}`));
    expect(html).toContain('data-testid="dapp-lookalike"');
  });

  it("counts a pool ticker in Greek capitals as sharing the Latin one's", () => {
    const pools = [{ ticker: "NUNA" }, { ticker: `${NU}U${NU}${ALPHA}` }];
    expect(sharing(sharedNames(pools, (p) => p.ticker), "NUNA")).toBe(2);
  });

  // Only a mainnet build carries the mainnet list (Vitest builds with the extension's own flags).
  (__MAINNET_ENABLED__ ? it : it.skip)("marks a stranger's SΝΕΚ, USDΜ and ΗOSKY as the listed mainnet tokens", () => {
    const fakes: Array<[string, string]> = [
      [`S${NU}${EPSILON}${KAPPA}`, "SNEK"],
      [`USD${MU}`, "USDM"],
      [`${ETA}OSKY`, "HOSKY"],
    ];
    expect(fakes.map(([fake]) => [fake, tokenText("mainnet", named(fake)).posesAs])).toEqual(fakes);
  });
});


describe("the rest of the class, beside the Greek capitals (chunk 51, e9b#1)", () => {
  it("folds the small letters of Cherokee and Coptic, Latin's small capitals and Armenian as they draw", () => {
    // Cherokee's small letters draw what its capitals do; small capitals draw what capitals do.
    expect(nameSkeleton("\uAB7A\uAB70\uAB7A")).toBe(nameSkeleton("ADA"));
    expect(nameSkeleton("\uA731\u0274\u1D07\u1D0B")).toBe(nameSkeleton("SNEK"));
    expect(nameSkeleton("\u2C98\u2C92\u2C9A")).toBe(nameSkeleton("MIN"));
    expect(nameSkeleton("\u2C99\u2C93\u2C9B")).toBe(nameSkeleton("MIN"));
    expect(nameSkeleton("\u0555\u054D")).toBe(nameSkeleton("OU"));
  });

  it("leaves a capital that draws no Latin letter as itself, never its small letter's", () => {
    // Greek Γ and Ω, and Cyrillic Г and П, draw no Latin letter, though γ, ω, г and п pass for y, w, r and n.
    expect(nameSkeleton("\u0393")).not.toBe(nameSkeleton("y"));
    expect(nameSkeleton("\u03A9")).not.toBe(nameSkeleton("w"));
    expect(nameSkeleton("\u0413")).not.toBe(nameSkeleton("r"));
    expect(nameSkeleton("\u041FIN")).not.toBe(nameSkeleton("NIN"));
  });

  it("still tells real names apart", () => {
    for (const name of ["8Ball", "Adamant", "Canada", "Lovelaced", "\u03A9mega", "\u0393\u039D\u03A9\u03A3\u0397"]) {
      expect(tokenText("preprod", named(name)).posesAs, name).toBeUndefined();
    }
  });
});

describe("a name padded with blanks before its last letters (chunk 51, gap-g10#1)", () => {
  const EM = "\u2003";
  const IDEOGRAPHIC = "\u3000";
  const NBSP = "\u00A0";

  it("is shown with each run of blanks as one space, so its last letters stay in the row", () => {
    for (const blank of [EM, IDEOGRAPHIC, NBSP, " "]) {
      const own = `tUSDM${blank.repeat(9)}x`;
      const text = tokenText("preprod", named(own));
      expect(text.label, JSON.stringify(own)).toBe("tUSDM x");
      // It's its own name, which isn't tUSDM's: unlisted, never named as the listed one.
      expect(text.listed).toBe(false);
      expect(text.posesAs).toBeUndefined();
      expect(tokenAmountText("preprod", { ...named(own), quantity: "1000000" })).toBe(
        `1,000,000 tUSDM x (not on the wallet's list, ${text.id})`,
      );
    }
  });

  it("keeps one blank as it is, and a name of nothing but blanks goes by its fingerprint", () => {
    expect(oneSpaced(`${NBSP}000 ADA`)).toBe(`${NBSP}000 ADA`);
    expect(oneSpaced(`a${EM}b`)).toBe(`a${EM}b`);
    const blank = tokenText("preprod", named("\u2800\u2800\u2800"));
    expect(blank.label).toBe(blank.id);
  });

  it("is a DRep's or a pool's name as a list shows it, a run of blanks one space", () => {
    expect(plainName(`8Ball${EM.repeat(40)}x`)).toBe("8Ball x");
    expect(plainName(`  NUNA${IDEOGRAPHIC.repeat(5)}2 `)).toBe("NUNA 2");
  });
});

describe("the Add tokens picker's row of a token passing for another (chunk 51, gap-g10#3)", () => {
  it("shows its warning whole, in the warning's colour, as Home's row does, and reads it out", () => {
    const fake: TokenAmount = { ...named("TUSDM"), quantity: "1000000", decimals: 0, fingerprint: "" };
    const plain: TokenAmount = { ...named("FOO"), quantity: "5", decimals: 0, fingerprint: "" };
    const html = renderToStaticMarkup(
      createElement(NetworkContext.Provider, { value: "preprod" }, createElement(TokenPicker, { tokens: [fake, plain], onClose: () => {}, onPick: () => {} })),
    ).replace(/&#x27;/g, "'");
    const view = viewToken("preprod", fake);
    expect(view.warn).toBe(true);
    expect(html).toContain(`<span class="token-row__sub wrap token-row__sub--warn">${view.sub}</span>`);
    expect(html).toContain(`aria-label="${view.label}, ${view.sub}"`);
    // One that only isn't listed keeps the plain line.
    expect(html).toContain(`<span class="token-row__sub">${viewToken("preprod", plain).sub}</span>`);
  });
});
