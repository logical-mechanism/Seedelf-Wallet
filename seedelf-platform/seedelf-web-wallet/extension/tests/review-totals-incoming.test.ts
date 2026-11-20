// A review's "… after" is Home's figure less what leaves (chunk 23's review,
// S-1), and Home's figure counts what the wallet's own sent transactions pay
// back before a reading lists it (HM-1): a payment's change, a session's or a
// swap's return. The reviews' figures left that out, so while anything was on
// its way every "… after" read short of Home by all of it, down to 0 ₳.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { Balances } from "../src/shared/rpc";
import { homeBalance, TotalRows } from "../src/ui/components/ReviewTotals";
import { unlocked } from "../src/ui/format";
import { PreferencesContext } from "../src/ui/preferences";
import { reviewTotals } from "../src/ui/screens/Home";

const none = { lovelace: "0", tokens: [], utxos: 0 };
const on = (lovelace: string) => ({ lovelace, tokens: [], utxos: 1 });

/** 10 ₳ private with 500 ₳ coming back, and 100 ₳ public with 2 ₳ of rewards and 10,338 ₳ of change coming back. */
const balances = (incoming = true): Balances => ({
  network: "preprod",
  updatedAt: 1,
  seedelf: {
    lovelace: "10000000",
    tokens: [],
    utxos: 1,
    seedelfs: [],
    locked: none,
    ...(incoming ? { incoming: on("500000000") } : {}),
  },
  cardano: {
    lovelace: "100000000",
    tokens: [],
    utxos: 1,
    addressesUsed: 1,
    locked: none,
    staking: { registered: true, pool: null, drep: null, rewards: "2000000", deposit: "2000000" },
    ...(incoming ? { incoming: on("10338000000") } : {}),
  },
});

const after = (side: "public" | "private", leaving: bigint, before: string) =>
  renderToStaticMarkup(
    createElement(
      PreferencesContext.Provider,
      { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
      createElement(TotalRows, { side, leaving, before }),
    ),
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("a review's balance after", () => {
  it("starts from Home's figures, what's on its way back included", () => {
    expect(reviewTotals(balances())).toEqual({ public: "10440000000", private: "510000000" });
    // Nothing on its way, as every reading from 1.1.0 is: the UTxOs, and the rewards on the public side.
    expect(reviewTotals(balances(false))).toEqual({ public: "102000000", private: "10000000" });
  });

  it("reads Home's figure less what leaves, not 0 ₳", () => {
    // A private Send of 5 ₳ and its fee, while a swap's 500 ₳ return is on its way: 504.7 ₳ after, not 4.7 ₳.
    expect(after("private", 5_300_000n, reviewTotals(balances()).private)).toContain("Private balance after 504.7 ₳");
    // The public account, right after a Send whose change Koios doesn't list yet: not 0 ₳.
    expect(after("public", 150_000_000n, reviewTotals(balances()).public)).toContain("Public account after 10,290 ₳");
  });

  it("from a spendable side, as the dApps page, a site's session and the connect window give it", () => {
    const seedelf = { ...balances().seedelf, locked: on("3000000"), lovelace: "13000000" };
    // Spendable 10 ₳, 3 ₳ locked, 500 ₳ on its way: Home shows 513 ₳.
    expect(homeBalance(unlocked(seedelf))).toBe("513000000");
    const { incoming: _, ...read } = seedelf;
    expect(homeBalance(unlocked(read))).toBe("13000000");
  });
});

// Chunk 51's T1 lens over the screens (lane T1l): two of these rules a revert passed with every test green.
describe("what a form may send, and what a review says is left (chunk 51, T1l)", () => {
  const MIN = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e", decimals: 0, fingerprint: "" };
  const X = { policyId: "ab".repeat(28), assetName: "58", decimals: 0, fingerprint: "" };

  it("keeps a locked UTxO's tokens out of what a form may send (t1l#5)", () => {
    const side = (locked: string) =>
      unlocked({
        lovelace: "10000000",
        tokens: [{ ...MIN, quantity: "100" }, { ...X, quantity: "5" }],
        utxos: 2,
        locked: { lovelace: "2000000", tokens: [{ ...MIN, quantity: locked }], utxos: 1 },
      }).tokens;
    // The only 100 MIN in the locked UTxO: none is offered, and X's 5 are.
    expect(side("100")).toEqual([{ ...X, quantity: "5" }]);
    // 40 of the 100 locked: 60 are offered.
    expect(side("40")).toEqual([{ ...MIN, quantity: "60" }, { ...X, quantity: "5" }]);
  });

  it("says 0 ₳ after, never less, where what leaves is more than the figure it was handed (t1l#6)", () => {
    expect(after("private", 3_000_000n, "1000000")).toContain("Private balance after 0 ₳");
    expect(after("private", 3_000_000n, "1000000")).not.toContain("-");
  });
});
