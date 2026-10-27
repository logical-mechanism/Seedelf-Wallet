// 1.6.0's review of the fixes, round 3b's nits on the screens. A private Bootstrap's review hint said its deposit
// went in now, in one transaction, where it's funded first (R3-21). The public Mix form worded its figure as what a
// mix can spend over Home's figure before the account's UTxOs answered, and labelled what a mix can spend as what the
// account holds once they had (R3-26, R3-27). And Home's banner called one box of a public mix or Bootstrap "them"
// (the review's screens-states question). Each failed before its fix.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "../src/i18n";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { PendingTx, UtxoInfo } from "../src/shared/rpc";
import { PendingBanner } from "../src/ui/components/PendingBanner";
import { formatAda } from "../src/ui/format";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import * as LovejoinScreen from "../src/ui/screens/Lovejoin";

vi.mock("../src/i18n", async (original) => {
  const real = await original<typeof import("../src/i18n")>();
  return { ...real, useT: () => real.t };
});

const { HeldOnSide, reviewHint } = LovejoinScreen;
// The two helpers the page words its public figure by, looked up by name so this file loads before they exist.
const { publicSideOf, cantAffordPublic } = LovejoinScreen as unknown as {
  publicSideOf: (
    cardano: { lovelace: string; tokens: [] } | undefined,
    utxos: UtxoInfo[] | undefined,
  ) => { side?: { lovelace: string }; mixable: boolean };
  cantAffordPublic: (first: string, held: string, mixable: boolean) => string;
};

/** Markup's text, as a person reads it. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

const html = (element: Parameters<typeof renderToStaticMarkup>[0], hideBalances = false) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances }, loaded: true, set: async () => undefined } },
        element,
      ),
    ),
  );

describe("a Bootstrap's review hint (1.6.0's review of the fixes, R3-21)", () => {
  const hint = (source: "private" | "public", summary: unknown) => reviewHint({ source, summary } as Parameters<typeof reviewHint>[0]);
  const privately = { mix: { bootstrap: true }, bootstrapReserve: "1500000" };

  it("from the private balance says it's funded first, never that the deposit goes now, in one transaction", () => {
    // Three transactions: the funding at Send, the deposit once it lands, then the way back of what's left.
    const said = hint("private", privately)!;
    expect(said).not.toContain("in one transaction");
    expect(said).toBe(t("lovejoin.review.bootstrapNotePrivate"));
    expect(said).toMatch(/^Once funded, the account deposits the boxes, and what's left comes back\./);
    // What follows stays true there: the boxes stay until brought back by hand.
    expect(said).toContain("until you bring them back");
  });

  it("from the public account keeps its note, which is so there: its deposit goes at Send, alone", () => {
    expect(hint("public", { bootstrap: true })).toBe(t("lovejoin.review.bootstrapNote"));
    expect(t("lovejoin.review.bootstrapNote")).toContain("The deposit goes in now, in one transaction.");
  });
});

describe("the public Mix form's figure, worded by which one feeds it (1.6.0's review of the fixes, R3-26, R3-27)", () => {
  /** Home's figure: rewards and ADA held with tokens in it, as a payment may spend. */
  const home = { lovelace: "10408014036", tokens: [] as [] };
  const utxo = (lovelace: string, extra: Partial<UtxoInfo> = {}): UtxoInfo => ({
    txHash: "cd".repeat(32),
    index: 0,
    lovelace,
    tokens: [],
    locked: false,
    ...extra,
  });
  const utxos = [utxo("9000000"), utxo("5000000", { index: 1, locked: true, collateral: true })];

  it("is what a mix can spend once the account's UTxOs answer, and Home's figure before they do", () => {
    expect(publicSideOf(home, utxos)).toEqual({ side: { lovelace: "9000000", tokens: [] }, mixable: true });
    // Before the answer, or a reading too large to keep: Home's figure, as before.
    expect(publicSideOf(home, undefined)).toEqual({ side: home, mixable: false });
    expect(publicSideOf(undefined, utxos)).toEqual({ side: undefined, mixable: false });
  });

  it("says a mix can spend it only when it's what a mix can spend, and what the account holds otherwise", () => {
    const first = formatAda("15300000");
    expect(cantAffordPublic(first, "9", true)).toBe(t("lovejoin.mix.cantAffordPublic", { first, held: "9" }));
    expect(cantAffordPublic(first, "9", true)).toContain("Your public account has 9\u00a0₳ a mix can spend.");
    // Over Home's figure, 1.5.0's words: the account holds it.
    expect(cantAffordPublic(first, "10,408.014036", false)).toContain("Your public account holds 10,408.014036\u00a0₳.");
    expect(cantAffordPublic(first, "10,408.014036", false)).not.toContain("a mix can spend");
  });

  it("labels it, for a screen reader and the tooltip, by the same rule; the private side as it was", () => {
    const label = (source: "private" | "public", mixable?: boolean) => {
      const markup = html(createElement(HeldOnSide, { source, side: { lovelace: "9000000", tokens: [] }, testId: "held", ...(mixable ? { mixable } : {}) }));
      return markup.match(/title="([^"]*)"/)![1]!.replaceAll("&#x27;", "'");
    };
    expect(label("public", true)).toBe(t("lovejoin.mix.inPublicSpendable"));
    expect(label("public", true)).not.toBe(t("lovejoin.mix.inPublic"));
    expect(label("public")).toBe(t("lovejoin.mix.inPublic"));
    expect(label("private", true)).toBe(t("lovejoin.mix.inPrivate"));
    expect(label("private")).toBe(t("lovejoin.mix.inPrivate"));
  });
});

describe("Home's banner for one box of Lovejoin's (1.6.0's review of the fixes, the screens' question)", () => {
  const hash = "ab".repeat(32);
  const done = {
    kind: "lovejoin-mix",
    network: "preprod",
    txHash: hash,
    submittedAt: Date.now(),
    confirmations: 1,
    chain: { first: hash, total: 1 },
  } as PendingTx;
  const banner = (pending: PendingTx, hidden = false) =>
    words(html(createElement(PendingBanner, { pending, watching: false, onDismiss: () => undefined }), hidden));

  it("says a Bootstrap's one box is held, and its boxes so", () => {
    expect(banner({ ...done, bootstrap: true, boxes: 1 } as PendingTx)).toContain("In Lovejoin, held there until you bring it back");
    expect(banner({ ...done, bootstrap: true, boxes: 3 } as PendingTx)).toContain("In Lovejoin, held there until you bring them back");
  });

  it("says a mix's one box is on its way, and its boxes so", () => {
    expect(banner({ ...done, boxes: 1 } as PendingTx)).toContain("In Lovejoin, on its way to your private balance");
    expect(banner({ ...done, boxes: 2 } as PendingTx)).toContain("In Lovejoin, on their way to your private balance");
  });

  it("says them, as it did, for a watch from before the count", () => {
    expect(banner({ ...done, bootstrap: true })).toContain("In Lovejoin, held there until you bring them back");
    expect(banner(done)).toContain("In Lovejoin, on their way to your private balance");
  });

  // A count of boxes is an amount (useAmounts' count): with balances hidden, "it" would tell an onlooker it was one box,
  // 10 ₳ in the classic pool (the last look, LW-2).
  it("says them while balances are hidden, one box or more, as every count of boxes is said then", () => {
    expect(banner({ ...done, boxes: 1 } as PendingTx, true)).toContain("In Lovejoin, on their way to your private balance");
    expect(banner({ ...done, bootstrap: true, boxes: 1 } as PendingTx, true)).toContain("In Lovejoin, held there until you bring them back");
    expect(banner({ ...done, boxes: 1 } as PendingTx, true)).not.toContain("on its way");
    expect(banner({ ...done, boxes: 3 } as PendingTx, true)).toContain("In Lovejoin, on their way to your private balance");
  });
});
