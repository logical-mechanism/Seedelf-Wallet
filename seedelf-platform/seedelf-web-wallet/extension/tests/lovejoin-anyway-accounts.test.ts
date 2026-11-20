// Pay from my private balance anyway, on a wallet with several public accounts (chunk 51's e8a#3, from its trace
// verifier). The worker's anyway (againBoxes with publicToo) takes every box of the wallet's in the pool, whichever
// public account's mix put it there, and the private balance pays for their mixes. On Account 2, with boxes a mix from
// Account 1 put in, the question said "Some boxes came from your public account ... ties the private UTxOs it spends to
// that account", and its review the same, which read as the one on screen, as x-privacy#0 found for Bring one back
// anyway's (lovejoin-accounts-review-fixes.test.ts). Both name the accounts whose boxes it takes now; with one public
// account, or none but the one on screen's boxes, they say what they always did.
//
// No DOM: the real pool page rendered once, as the house's screen tests render it, its link pressed inside the render
// (the seam of lovejoin-screens-review-fixes-1-8-0.test.ts: an element's props taken as it's made, `on`). No effect
// runs, and no request answers.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShownPool } from "../src/ui/lovejoin-pools";

const seam = vi.hoisted(() => {
  const state = {
    /** Done once, inside the render that makes the first element of component `name`: with its props. */
    ons: [] as Array<{ name: string; act: (props: Record<string, unknown>) => void; done?: true }>,

    /** The JSX runtime's element factories, with `on` in them. */
    runtime<R extends Record<string, unknown>>(runtime: R): R {
      const wrap =
        (create: (...args: unknown[]) => unknown) =>
        (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
          const name = typeof type === "function" ? type.name : "";
          for (const on of state.ons) {
            if (on.done || on.name !== name) continue;
            on.done = true;
            on.act(props ?? {});
          }
          return create(type, props, ...rest);
        };
      const out: Record<string, unknown> = { ...runtime };
      for (const key of ["jsx", "jsxs", "jsxDEV"]) if (typeof runtime[key] === "function") out[key] = wrap(runtime[key] as (...args: unknown[]) => unknown);
      return out as R;
    },
  };
  return state;
});

vi.mock("react/jsx-runtime", async (original) => seam.runtime(await original<Record<string, unknown>>()));
vi.mock("react/jsx-dev-runtime", async (original) => seam.runtime(await original<Record<string, unknown>>()));
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: () => new Promise(() => undefined),
}));

const { t } = await import("../src/i18n");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { AccountsContext } = await import("../src/ui/accounts");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { anywayAccountsOf, PoolPage, PrivateReview } = await import("../src/ui/screens/Lovejoin");

afterEach(() => {
  seam.ons = [];
});

const nothing = () => undefined;
const seedelf = { lovelace: "500000000", tokens: [], utxos: 3, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } };

/** v2's 5 ₳ ADA pool, past its floor: one that takes boxes, so mixing again is on. */
const FIVE = "f5".repeat(28);
const box = (i: number) => ({ txHash: `${i}`.padStart(64, "0"), txIndex: 0, pool: FIVE });
const A = box(1);
const B = box(2);
const C = box(3);
const poolOf = (extra: Partial<ShownPool>): ShownPool => ({
  id: FIVE,
  version: "v2",
  box: { lovelace: "5000000" },
  others: 40,
  free: 40,
  floor: 30,
  boxes: [],
  lovelace: "0",
  due: [],
  notMixed: [],
  fromPublic: [],
  ...extra,
});

/** What a person reads of markup. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

/** `node` with the wallet's public accounts 1 to `count` (indexes from 0), on account `active`. */
const withAccounts = (node: ReactElement, active: number, count = 3) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        AccountsContext.Provider,
        {
          value: {
            accounts: Array.from({ length: count }, (_, index) => ({ index })),
            active,
            loaded: true,
            name: "",
            several: count > 1,
            reload: async () => undefined,
          },
        },
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
          node,
        ),
      ),
    ),
  );

/**
 * `pool`'s page on a wallet with public accounts 1 to `count` on account `active` (from 0), Pay from my private balance
 * anyway pressed: the page's markup, and its question as a person reads it (undefined where none opened).
 */
function pressed(pool: ShownPool, active: number, count = 3): { markup: string; question?: string } {
  seam.ons = [{ name: "AgainActions", act: (props) => (props.onAnyway as () => void)() }];
  const page: ReactElement = createElement(PoolPage, {
    pool,
    pools: [pool],
    seedelf,
    reading: false,
    readFailed: false,
    mixingAgain: false,
    sending: null,
    onSendingPublic: nothing,
    onSending: nothing,
    onRefresh: async () => undefined,
    onBack: nothing,
    onPending: nothing,
  } as never);
  const markup = withAccounts(page, active, count);
  const dialog = /<dialog[^>]*aria-labelledby="lovejoin-again-anyway-title"[^>]*>([\s\S]*?)<\/dialog>/.exec(markup)?.[1];
  return { markup, question: dialog === undefined ? undefined : words(dialog) };
}

/** Whether the button `testId` is there and can be pressed. */
const pressable = (markup: string, testId: string) => new RegExp(`<button(?![^>]*disabled)[^>]*data-testid="${testId}"`).test(markup);

const TODAY = "Some boxes came from your public account. Paying their mixes from your private balance ties the private UTxOs it spends to that account. Mix again from my public account doesn't.";

describe("Pay from my private balance anyway, with several public accounts (chunk 51, e8a#3)", () => {
  it("on Account 2, with only boxes a mix from Account 1 put in, names Account 1, never 'your public account'", () => {
    // Account 1's public mix left two boxes in the pool; Account 2 is on screen. Its own Mix again isn't offered (none
    // is its own), nor Mix my boxes again (none is private): Pay from my private balance anyway is, and takes both.
    const pool = poolOf({ boxes: [A, B], lovelace: "10000000", fromPublic: [A, B], otherAccounts: [{ ...A, account: 0 }, { ...B, account: 0 }] });
    const { markup, question } = pressed(pool, 1);
    expect(pressable(markup, "lovejoin-again-anyway")).toBe(true);
    expect(markup).not.toContain('data-testid="lovejoin-again-public"');
    // The page itself names Account 1 above the link (OtherAccounts): the question it opens is what's checked.
    expect(words(markup)).toContain(t("lovejoin.otherAccount", { account: "Public account 1" }));
    expect(question, "the question opened").toBeDefined();
    expect(question).toContain(t("lovejoin.privateAnyway.title"));
    // The tie it makes is to Account 1: said as that account's, by name, as Bring one back anyway's is (x-privacy#0).
    expect(question).toMatch(/\baccount 1\b/i);
    expect(question).not.toMatch(/your public account/i);
    expect(question).toContain(
      "Some boxes came from Account 1. Paying their mixes from your private balance ties the private UTxOs it spends to that account. On Account 1, Mix again from my public account doesn't.",
    );
  });

  it("on Account 2, with its own boxes and Account 1's, names Account 1, whose boxes it takes too", () => {
    // One funding from the private balance pays for both accounts' boxes' mixes: the private UTxOs it spends are tied
    // to both accounts, and so the two accounts to each other. The question named neither.
    const pool = poolOf({ boxes: [A, C], lovelace: "10000000", fromPublic: [A, C], otherAccounts: [{ ...A, account: 0 }] });
    const { markup, question } = pressed(pool, 1);
    expect(pressable(markup, "lovejoin-again-anyway")).toBe(true);
    expect(pressable(markup, "lovejoin-again-public")).toBe(true);
    expect(question, "the question opened").toBeDefined();
    expect(question).toMatch(/\baccount 1\b/i);
    expect(question).toContain(
      "Some boxes came from Account 1 and Account 2. Paying their mixes from your private balance ties the private UTxOs it spends to those accounts, and so the accounts to each other. On each of them, Mix again from my public account doesn't.",
    );
  });

  it("says what it always did with one public account, or with none but the one on screen's boxes in the pool", () => {
    const own = poolOf({ boxes: [A, C], lovelace: "10000000", fromPublic: [A, C] });
    expect(pressed(own, 0, 1).question).toContain(TODAY);
    expect(pressed(own, 1).question).toContain(TODAY);
    // A box another account's Bootstrap holds is never taken: it names no one either.
    const held = poolOf({ boxes: [A, C], lovelace: "10000000", fromPublic: [A, C], bootstrap: [A], otherAccounts: [{ ...A, account: 0 }] });
    expect(anywayAccountsOf(held, 1)).toEqual([]);
    expect(pressed(held, 1).question).toContain(TODAY);
  });

  it("which accounts it takes boxes of: the one on screen's with the others', each once, by number", () => {
    const pool = poolOf({ fromPublic: [A, B, C], otherAccounts: [{ ...B, account: 2 }, { ...A, account: 0 }] });
    expect(anywayAccountsOf(pool, 1)).toEqual([0, 1, 2]);
    expect(anywayAccountsOf(poolOf({ fromPublic: [A], otherAccounts: [{ ...A, account: 2 }] }), 1)).toEqual([2]);
  });

  describe("its review", () => {
    const payments = [
      { to: "addr_test1", lovelace: "9100000", tokens: [] },
      { to: "addr_test1", lovelace: "5000000", tokens: [] },
    ];
    const funding = { boxes: 2, again: true, owned: 2, lovelace: "9100000", mixes: 8, mixFees: "6600000", depth: 2, delay: "1-6", publicToo: true };
    const summary = { index: 4, address: "addr_test1" + "q".repeat(50), payments, fee: { total: "200000" }, changeLovelace: "1000000", mix: funding };
    const review = (anywayAccounts: number[] | undefined, active = 1, count = 3) =>
      words(withAccounts(createElement(PrivateReview, { summary, anywayAccounts } as never), active, count));

    it("names the accounts whose boxes it takes, and that one funding ties them to each other", () => {
      expect(review([0])).toContain("Some of these boxes came from Account 1, so this ties the private UTxOs it spends to that account.");
      expect(review([0])).not.toMatch(/your public account, so/);
      expect(review([0, 1])).toContain(
        "Some of these boxes came from Account 1 and Account 2, so this ties the private UTxOs it spends to those accounts, and so the accounts to each other.",
      );
      expect(review([0, 1, 2])).toContain("Some of these boxes came from Account 1, Account 2 and Account 3, so");
    });

    it("says 'your public account' as before where no other account's box goes in", () => {
      const before = "Some of these boxes came from your public account, so this ties the private UTxOs it spends to that account.";
      expect(review([])).toContain(before);
      expect(review(undefined, 0, 1)).toContain(before);
    });
  });
});
