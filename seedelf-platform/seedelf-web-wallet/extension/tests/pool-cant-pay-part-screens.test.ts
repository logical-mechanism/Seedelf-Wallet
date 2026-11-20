// Chunk 51, gap-g5#1, the screens' side: a pool whose boxes come back but can't then pay out part of themselves on
// their own (its box under S0d's least) is used as any pool (the owner's call 34, "Treat it like any pool", with the
// review saying so), and one short warning says so wherever the worse case, a pool whose boxes can't come back, is said
// now: the hub's row, the pool's page before Review, a return's or a swap's token's row (TokenWays: a swap's approval,
// the return reviews, Stop, a site's session), Bring everything back (ClaimAll) and Change's list. Before, only the
// worse case was said, so such a pool was offered with no word. Each rendered as the page shows it.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "../src/i18n";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinTokenWay, SessionBackSummary } from "../src/shared/rpc";
import { TokenWays, wayOptionNote } from "../src/ui/components/LovejoinReturn";
import { groupPools, type ShownPool } from "../src/ui/lovejoin-pools";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { ClaimReview } from "../src/ui/screens/ClaimAll";
import * as LovejoinScreen from "../src/ui/screens/Lovejoin";
import { withoutStop } from "../src/ui/sentence";

// The words without the redraw a language change asks for, as lovejoin-session5-screens.test.ts has them.
vi.mock("../src/i18n", async (original) => {
  const real = await original<typeof import("../src/i18n")>();
  return { ...real, useT: () => real.t };
});
vi.mock("../src/ui/accounts", async (original) => {
  const real = await original<typeof import("../src/ui/accounts")>();
  return {
    ...real,
    useAccounts: () => ({ accounts: [{ index: 0 }], active: 0, loaded: true, name: "Account 1", several: false, reload: async () => undefined }),
  };
});

const { PoolGroupList } = LovejoinScreen;
const PoolPage = (LovejoinScreen as unknown as { PoolPage: (props: Record<string, unknown>) => ReactElement }).PoolPage;

/** Markup's text, as a person reads it. */
function words(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** A page's markup, on preprod, with the balances shown. */
const html = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } },
        element,
      ),
    ),
  );

/** MIN, on preprod's token list. */
const MIN = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e" };
const A = "a1".repeat(28);
const B = "b2".repeat(28);
/** A box of 900 MIN and 3 ₳: under S0d's least for it (3.82 ₳ under preprod's parameters), as the verifier's pool. */
const MIN_900 = { lovelace: "3000000", token: { ...MIN, quantity: "900000000" } };
const STUCK = { has: "1589324", needs: "1723200" };
const nothing = () => undefined;

/** A token pool as the page reads it. */
const poolOf = (extra: Partial<ShownPool> = {}): ShownPool => ({
  id: A,
  box: MIN_900,
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

/** A pool's page as it opens. */
const open = (pool: ShownPool) =>
  html(
    createElement(PoolPage, {
      pool,
      seedelf: {
        lovelace: "500000000",
        tokens: [{ ...MIN, quantity: "100000000000", fingerprint: "", decimals: 6 }],
        utxos: 3,
        seedelfs: [],
        locked: { lovelace: "0", tokens: [], utxos: 0 },
      },
      reading: false,
      readFailed: false,
      mixingAgain: false,
      sending: null,
      onSendingPublic: nothing,
      onSending: nothing,
      onRefresh: async () => undefined,
      onBack: nothing,
      onPending: nothing,
    }),
  );

const line = () => t("lovejoin.pools.warn.cantPayPart");

describe("a pool whose boxes can't pay out part of themselves on their own is said wherever it's offered (chunk 51, gap-g5#1)", () => {
  it("flags it on the hub's row, in the warning's colour, whether or not the wallet has boxes there", () => {
    const row = (pool: ShownPool) => html(createElement(PoolGroupList, { group: groupPools([pool], [])[0]!, onOpen: nothing }));
    const flagged = row(poolOf({ cantPayPart: true }));
    expect(words(flagged)).toContain(withoutStop(line()));
    expect(flagged).not.toContain("token-row__detail--plain");
    expect(words(row(poolOf({ cantPayPart: true, boxes: [{ txHash: "01".repeat(32), txIndex: 0, pool: A }] })))).toContain(withoutStop(line()));
    // Nothing to say of one whose boxes pay part of themselves.
    expect(words(row(poolOf()))).not.toContain(withoutStop(line()));
  });

  it("says so on its page before Review, and only the worse where its boxes can't come back at all", () => {
    const page = open(poolOf({ cantPayPart: true }));
    expect(page).toContain('data-testid="lovejoin-part-short"');
    expect(words(page)).toContain(line());
    expect(page.indexOf('data-testid="lovejoin-part-short"')).toBeLessThan(page.indexOf('data-testid="lovejoin-mix"'));
    // Mix stays on: it's used as any pool.
    expect(page).not.toContain('data-testid="lovejoin-mix-why"');
    expect(open(poolOf())).not.toContain('data-testid="lovejoin-part-short"');
    const stuck = open(poolOf({ cantComeBack: STUCK, cantPayPart: true }));
    expect(stuck).toContain('data-testid="lovejoin-stuck"');
    expect(stuck).not.toContain('data-testid="lovejoin-part-short"');
  });

  const way = (extra: Partial<LovejoinTokenWay> = {}): LovejoinTokenWay => ({
    ...MIN,
    pool: A,
    quantity: MIN_900.token.quantity,
    boxes: 2,
    pools: [A, B],
    ...extra,
  });

  it("says so under a return's or a swap's token going into it, as a warning", () => {
    const row = (ways: LovejoinTokenWay[], funded = false) => html(createElement(TokenWays, { ways, values: { [A]: MIN_900 }, busy: false, funded, onChange: nothing }));
    const part = row([way({ cantPayPart: true })]);
    expect(part).toMatch(/class="token-row__sub wrap token-row__sub--warn" data-testid="lovejoin-token-way-part"/);
    expect(words(part)).toContain(line());
    // Still through Lovejoin, as chosen: the pool is treated as any pool.
    expect(words(part)).toContain("Through Lovejoin: 2 boxes of 900 MIN + 3 ₳");
    // A swap's approval too.
    expect(row([way({ cantPayPart: true })], true)).toContain('data-testid="lovejoin-token-way-part"');
    // Not where it comes back directly, nor beside the worse case, which says more.
    expect(row([way({ cantPayPart: true, pool: undefined, boxes: 0, direct: true })])).not.toContain("lovejoin-token-way-part");
    expect(row([way()])).not.toContain("lovejoin-token-way-part");
    const both = row([way({ stuck: true, cantPayPart: true })]);
    expect(both).toContain('data-testid="lovejoin-token-way-stuck"');
    expect(both).not.toContain("lovejoin-token-way-part");
  });

  it("says so beside each pool Change's list offers, as the review would once it's chosen", () => {
    expect(wayOptionNote({ ...MIN_900, cantPayPart: true })).toEqual({ testId: "lovejoin-way-option-part", text: withoutStop(line()) });
    expect(wayOptionNote({ ...MIN_900, stuck: true })).toEqual({ testId: "lovejoin-way-option-stuck", text: t("lovejoin.pools.warn.stuck") });
    expect(wayOptionNote(MIN_900)).toBeUndefined();
    expect(wayOptionNote(undefined)).toBeUndefined();
  });

  it("says so on Bring everything back, under the token's name, once however many returns take it there", () => {
    const back = (index: number, ways: LovejoinTokenWay[]): SessionBackSummary => ({
      network: "preprod",
      index,
      txHash: "ab".repeat(32),
      fee: "300000",
      lovelace: "5200000",
      tokens: [],
      depositOutputs: 1,
      inputs: 2,
      lovejoin: { boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: "11".repeat(32), parts: [{ pool: A, boxes: 2 }], values: { [A]: MIN_900 }, ways },
    });
    const review = (returns: SessionBackSummary[]) =>
      html(
        createElement(ClaimReview, {
          built: { returns, skipped: [] },
          chosen: new Set(returns.map((r) => r.index)),
          sessions: [],
          direct: false,
          busy: false,
          onToggle: nothing,
          onDirect: nothing,
        }),
      );
    const item = t("claim.warn.skippedItem", { name: "MIN", why: withoutStop(line()) });
    const two = review([back(3, [way({ cantPayPart: true })]), back(4, [way({ cantPayPart: true })])]);
    expect(two).toContain('data-testid="claim-lovejoin-part"');
    expect(words(two).split(item).length - 1).toBe(1);
    expect(review([back(3, [way()])])).not.toContain("claim-lovejoin-part");
    expect(review([back(3, [way({ stuck: true, cantPayPart: true })])])).not.toContain("claim-lovejoin-part");
  });
});
