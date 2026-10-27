// 1.6.0's session 5, the screens' side of the owner's calls of 2026-10-19. Call 34: a mix that passes the logic is
// allowed, so a token pool whose boxes can't pay their own way back today takes new boxes from every way in, and its
// page says so before Review instead, whether or not the wallet has boxes there; only a box below the network's
// minimum, or a copy, turns those ways off. Call 36: wherever a box comes back paid, the private balance pays by
// default, and the public account is a button as visible as it. And a return's or a swap's token whose pool is such a
// pool says so on its row. Each rendered as the page shows it, its buttons clicked through their own handlers.
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "../src/i18n";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinTokenWay, SessionBackSummary } from "../src/shared/rpc";
import { TokenWays } from "../src/ui/components/LovejoinReturn";
import { Modal } from "../src/ui/components/Modal";
import { formatAda } from "../src/ui/format";
import { groupPools, type ShownPool } from "../src/ui/lovejoin-pools";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { ClaimReview } from "../src/ui/screens/ClaimAll";
import * as LovejoinScreen from "../src/ui/screens/Lovejoin";
import { withoutStop } from "../src/ui/sentence";

// The words without the redraw a language change asks for, so a question can be called as React calls it and its
// buttons' own handlers reached: there's no DOM here to click in.
vi.mock("../src/i18n", async (original) => {
  const real = await original<typeof import("../src/i18n")>();
  return { ...real, useT: () => real.t };
});
// And the accounts, one wallet's, for the same reason: a question names the public account a box is, where it's
// another's (1.6.0's release review, x-privacy#0).
vi.mock("../src/ui/accounts", async (original) => {
  const real = await original<typeof import("../src/ui/accounts")>();
  return {
    ...real,
    useAccounts: () => ({ accounts: [{ index: 0 }], active: 0, loaded: true, name: "Account 1", several: false, reload: async () => undefined }),
  };
});

const { AnywayQuestion, HeldQuestion, PaidQuestion, PoolGroupList, anywayRequest, heldRequest, hatchRequest } = LovejoinScreen;
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

/** The tag of the button `testId` names, whole. */
const button = (markup: string, testId: string) => markup.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0];

/** What the element `testId` names says. */
const said = (markup: string, testId: string) => words(markup.match(new RegExp(`data-testid="${testId}"[^>]*>([^<]*)`))?.[1] ?? "");

/**
 * The button `testId` names in `node`, each component on the way called as React calls it (a modal's body and foot
 * read as they are): what clicking it runs is its own `onClick`.
 */
function buttonIn(node: ReactNode, testId: string): ReactElement<{ onClick: () => void }> | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = buttonIn(n, testId);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const props = node.props as Record<string, unknown>;
  if (props["data-testid"] === testId) return node as ReactElement<{ onClick: () => void }>;
  if (node.type === Modal) return buttonIn([props.children as ReactNode, props.foot as ReactNode], testId);
  if (typeof node.type === "function") return buttonIn((node.type as (p: unknown) => ReactNode)(props), testId);
  return buttonIn(props.children as ReactNode, testId);
}

/** Clicks the button `testId` names in `question`; none there fails. */
function click(question: ReactElement, testId: string) {
  const found = buttonIn(question, testId);
  expect(found, `no button ${testId}`).toBeDefined();
  found!.props.onClick();
}

/** MIN, on preprod's token list. */
const MIN = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e" };
const A = "a1".repeat(28);
const B = "b2".repeat(28);
const MIN_100 = { lovelace: "4500000", token: { ...MIN, quantity: "100000000" } };
const at = (i: number) => ({ txHash: `${i}`.padStart(64, "0"), txIndex: 0, pool: A });
const nothing = () => undefined;

/** Today's fees leave a box of the pool 1.589324 ₳, and coming back needs 1.7232 ₳ (the escape hatch's case). */
const STUCK = { has: "1589324", needs: "1723200" };

/** A token pool as the page reads it. */
const poolOf = (extra: Partial<ShownPool> = {}): ShownPool => ({
  id: A,
  box: MIN_100,
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

/** A pool's page as it opens (nothing built, nothing asked yet), the private balance holding plenty of MIN. */
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

const lead = () => t("lovejoin.stuck.warn.lead", { has: formatAda(STUCK.has), needs: formatAda(STUCK.needs) });

describe("a token pool whose boxes can't pay their own way back today takes new boxes, said first (the owner's call 34)", () => {
  it("says so on its page before Review where the wallet has no box there, with no Bring one back", () => {
    const page = open(poolOf({ cantComeBack: STUCK }));
    expect(page).toContain('data-testid="lovejoin-stuck"');
    expect(words(page)).toContain(lead());
    // Nothing of the wallet's to bring back there.
    expect(page).not.toContain('data-testid="lovejoin-paid"');
    // Before Review: the callout comes before Mix's button.
    expect(page.indexOf('data-testid="lovejoin-stuck"')).toBeLessThan(page.indexOf('data-testid="lovejoin-mix"'));
    // A pool whose boxes pay their own way: no word of it.
    expect(open(poolOf())).not.toContain('data-testid="lovejoin-stuck"');
  });

  it("leaves Mix and Bootstrap on there, with no reason under them", () => {
    const page = open(poolOf({ cantComeBack: STUCK }));
    expect(page).not.toContain('data-testid="lovejoin-mix-why"');
    // Short of its floor, Bootstrap leads, on, saying nothing against it.
    const short = open(poolOf({ cantComeBack: STUCK, others: 3, free: 3 }));
    expect(short).toContain('data-testid="lovejoin-stuck"');
    expect(button(short, "lovejoin-bootstrap")).not.toContain("disabled");
    expect(short).not.toContain('data-testid="lovejoin-bootstrap-why"');
    // A box below the network's minimum: both off, saying why, as before.
    const below = open(poolOf({ unusable: { why: "belowMinimum" }, others: 3, free: 3 }));
    expect(button(below, "lovejoin-bootstrap")).toContain('disabled=""');
    expect(said(below, "lovejoin-bootstrap-why")).toBe(t("lj.unusable.warn.belowMinimum"));
    expect(said(open(poolOf({ unusable: { why: "belowMinimum" } })), "lovejoin-mix-why")).toBe(t("lj.unusable.warn.belowMinimum"));
  });

  it("leaves both Mix again on there, and the words around them send the user to them", () => {
    const pool = poolOf({ cantComeBack: STUCK, boxes: [at(1), at(2), at(3)], notMixed: [at(1), at(2)], fromPublic: [at(3)] });
    const page = open(pool);
    for (const id of ["lovejoin-again", "lovejoin-again-public"]) expect(button(page, id)).not.toContain("disabled");
    expect(page).not.toContain('data-testid="lovejoin-again-why"');
    expect(words(page)).toContain(t("lovejoin.warn.notMixed.takes.private", { count: 2 }));
    // A box-paid withdraw fails there: Bring one back now stays hidden; Bring one back takes a mixed box, paid.
    expect(page).not.toContain('data-testid="lovejoin-now"');
    expect(page).toContain('data-testid="lovejoin-paid"');
    expect(said(page, "lovejoin-paid")).toBe(t("lovejoin.stuck.bring"));
    expect(page).toContain('data-testid="lovejoin-anyway"');
    // Below the minimum: off, and no word sends the user to them.
    const below = open({ ...pool, unusable: { why: "belowMinimum" } });
    expect(button(below, "lovejoin-again")).toContain('disabled=""');
    expect(words(below)).not.toContain(t("lovejoin.warn.notMixed.takes.private", { count: 2 }));
    // A copy whose boxes can't pay their way back: its boxes mixed again, as in any copy; Mix says the copy's reason.
    const copy = open({ ...pool, id: B, unusable: { why: "superseded" } });
    expect(copy).toContain('data-testid="lovejoin-stuck"');
    expect(button(copy, "lovejoin-again")).not.toContain("disabled");
    expect(said(copy, "lovejoin-mix-why")).toBe(t("lj.unusable.warn.superseded"));
  });

  it("offers a Bootstrap's held boxes their own Bring one back there, and no other", () => {
    const page = open(poolOf({ cantComeBack: STUCK, boxes: [at(1)], bootstrap: [at(1)] }));
    expect(page).toContain('data-testid="lovejoin-stuck"');
    expect(page).not.toContain('data-testid="lovejoin-paid"');
    expect(page).toContain('data-testid="lovejoin-held-one"');
  });

  it("flags the pool on the hub's row whether or not the wallet has boxes there, and never as one that takes no box", () => {
    const row = (pool: ShownPool) => words(html(createElement(PoolGroupList, { group: groupPools([pool], [])[0]!, onOpen: nothing })));
    expect(row(poolOf({ cantComeBack: STUCK }))).toContain(t("lovejoin.pools.warn.stuck"));
    expect(row(poolOf({ cantComeBack: STUCK, boxes: [at(1)] }))).toContain(t("lovejoin.pools.warn.stuck"));
    expect(html(createElement(PoolGroupList, { group: groupPools([poolOf({ cantComeBack: STUCK })], [])[0]!, onOpen: nothing }))).not.toContain(
      "lovejoin-pool-unusable",
    );
    expect(row(poolOf())).not.toContain(t("lovejoin.pools.warn.stuck"));
  });
});

describe("Bring it back anyway's question says a way out only where it works (session 5, which button still works)", () => {
  const pool = poolOf({ boxes: [at(1)], notMixed: [at(1)] });
  const ask = (props: Partial<Parameters<typeof AnywayQuestion>[0]>) =>
    words(html(createElement(AnywayQuestion, { pool, stuck: false, onKeep: nothing, onConfirm: nothing, ...props })));

  it("says mixing again hides the box first where mixing again is on, a stuck pool's too, and not where it's off", () => {
    const hides = t("lovejoin.anyway.privacy.hides");
    expect(ask({})).toContain(hides);
    expect(ask({ stuck: true })).toContain(hides);
    expect(ask({ againOff: true })).not.toContain(hides);
    expect(ask({ againOff: true })).toContain(t("lovejoin.anyway.privacy.stopped"));
    // A box a mix from the public account put in: its own button, the same way.
    const theirs = { ...pool, fromPublic: [at(1)] };
    expect(ask({ pool: theirs })).toContain(t("lovejoin.anyway.privacy.hidesPublic"));
    expect(ask({ pool: theirs, againOff: true })).not.toContain(t("lovejoin.anyway.privacy.hidesPublic"));
    // Joined, it reads as the one sentence it was.
    expect(LovejoinScreen.anywayWarning(pool)).toBe(`${t("lovejoin.anyway.privacy.stopped")} ${hides}`);
  });
});

describe("a box that comes back paid: the private balance by default, the public account a button below it (the owner's call 36)", () => {
  /** Each question's payers, as rendered, and what clicking each hands its caller. */
  function payers(question: (onConfirm: (paid?: LovejoinScreen.Payer) => void, onKeep: () => void) => ReactElement, testId: string) {
    const got: Array<LovejoinScreen.Payer | undefined | "kept"> = [];
    const element = question(
      (paid) => got.push(paid),
      () => got.push("kept"),
    );
    const markup = html(element);
    click(element, `${testId}-private`);
    click(element, `${testId}-public`);
    click(element, `${testId}-keep`);
    return { markup, text: words(markup), got };
  }

  function expectBoth({ markup, text, got }: ReturnType<typeof payers>, testId: string) {
    // Both, private first and the default, styled as these confirms always were (`danger`: it shows what it ties);
    // the public account a button, never a link (the cross-area review, L1).
    expect(button(markup, `${testId}-private`)).toContain('class="danger"');
    expect(button(markup, `${testId}-public`)).toContain('class="secondary"');
    expect(markup.indexOf(`${testId}-private`)).toBeLessThan(markup.indexOf(`${testId}-public`));
    expect(said(markup, `${testId}-private`)).toBe(t("lovejoin.stuck.confirmPrivate"));
    expect(said(markup, `${testId}-public`)).toBe(t("lovejoin.stuck.confirm"));
    // What each ties, private first.
    expect(text).toContain(t("lovejoin.stuck.privacy.private"));
    expect(text).toContain(t("lovejoin.stuck.privacy.public"));
    expect(text.indexOf(t("lovejoin.stuck.privacy.private"))).toBeLessThan(text.indexOf(t("lovejoin.stuck.privacy.public")));
    // What a click hands the page: `paid` as the worker takes it, or leaving it.
    expect(got).toEqual(["private", true, "kept"]);
  }

  it("asks the escape hatch's question with both payers", () => {
    const asked = payers((onConfirm, onKeep) => createElement(PaidQuestion, { account: undefined, onConfirm, onKeep }), "lovejoin-paid");
    expectBoth(asked, "lovejoin-paid");
    expect(asked.text).toContain(t("lovejoin.stuck.keep"));
    // What the page asks the worker for, by the payer chosen.
    expect(hatchRequest(poolOf(), "private")).toEqual({ pool: A, paid: "private" });
    expect(hatchRequest(poolOf(), true)).toEqual({ pool: A, paid: true });
  });

  it("asks Bring one back of a Bootstrap's box in a stuck pool with both payers, and elsewhere as before", () => {
    const asked = payers(
      (onConfirm, onKeep) => createElement(HeldQuestion, { all: false, stuck: true, fromAccount: false, onConfirm, onKeep }),
      "lovejoin-held",
    );
    expectBoth(asked, "lovejoin-held");
    expect(asked.text).toContain(t("lovejoin.bootstrap.privacy.one"));
    // A pool whose boxes pay their own way: one button, and nobody pays.
    const got: unknown[] = [];
    const plain = createElement(HeldQuestion, { all: false, stuck: false, fromAccount: false, onConfirm: (paid?: unknown) => got.push(paid), onKeep: nothing });
    expect(html(plain)).not.toContain("lovejoin-held-private");
    expect(words(html(plain))).not.toContain(t("lovejoin.stuck.privacy.public"));
    click(plain, "lovejoin-held-confirm");
    expect(got).toEqual([undefined]);
    // Bring them all back pays nothing, stuck or not: no payer offered.
    expect(html(createElement(HeldQuestion, { all: true, stuck: true, fromAccount: false, onConfirm: nothing, onKeep: nothing }))).not.toContain(
      "lovejoin-held-private",
    );
    // What the page asks the worker for: the Bootstrap's last box, paid as chosen.
    const held = poolOf({ boxes: [at(1), at(2)], bootstrap: [at(1), at(2)] });
    expect(heldRequest(held, "private")).toEqual({ box: at(2), paid: "private" });
    expect(heldRequest(held, true)).toEqual({ box: at(2), paid: true });
    expect(heldRequest(held)).toEqual({ box: at(2) });
    expect(heldRequest(poolOf())).toBeUndefined();
  });

  it("asks Bring it back anyway in a stuck pool with both payers, and elsewhere as before", () => {
    const pool = poolOf({ cantComeBack: STUCK, boxes: [at(1)], notMixed: [at(1)] });
    const asked = payers((onConfirm, onKeep) => createElement(AnywayQuestion, { pool, stuck: true, onConfirm, onKeep }), "lovejoin-anyway");
    expectBoth(asked, "lovejoin-anyway");
    expect(asked.text).toContain(t("lovejoin.anyway.privacy.stopped"));
    // A pool whose boxes pay their own way: its one button, as e2e presses it.
    const got: unknown[] = [];
    const plain = createElement(AnywayQuestion, { pool, stuck: false, onConfirm: (paid?: unknown) => got.push(paid), onKeep: nothing });
    expect(html(plain)).not.toContain("lovejoin-anyway-private");
    click(plain, "lovejoin-anyway-confirm");
    expect(got).toEqual([undefined]);
    // What the page asks the worker for: the box as it is, paid as chosen.
    expect(anywayRequest(pool, "private")).toEqual({ box: at(1), anyway: true, paid: "private" });
    expect(anywayRequest(pool, true)).toEqual({ box: at(1), anyway: true, paid: true });
    expect(anywayRequest(pool)).toEqual({ box: at(1), anyway: true });
  });

  it("names no payer on the stuck callout's link", () => {
    expect(t("lovejoin.stuck.bring")).toBe("Bring one back");
    expect(t("lovejoin.bootstrap.warn.allStuck")).not.toMatch(/public account paying/);
  });
});

describe("a return's or a swap's token whose pool can't have its boxes pay their own way back (the owner's call 34)", () => {
  const values = { [A]: MIN_100 };
  const way = (extra: Partial<LovejoinTokenWay> = {}): LovejoinTokenWay => ({ ...MIN, pool: A, quantity: MIN_100.token.quantity, boxes: 2, pools: [A], ...extra });
  const row = (ways: LovejoinTokenWay[], funded = false) => html(createElement(TokenWays, { ways, values, busy: false, funded, onChange: nothing }));

  it("says so under its row, as a warning, where its boxes go into that pool", () => {
    const stuck = row([way({ stuck: true })]);
    expect(said(stuck, "lovejoin-token-way-stuck")).toBe(t("lovejoin.ways.warn.stuck"));
    expect(stuck).toMatch(/class="token-row__sub wrap token-row__sub--warn" data-testid="lovejoin-token-way-stuck"/);
    // Still through Lovejoin, as chosen: the pool is treated as any pool.
    expect(words(stuck)).toContain("Through Lovejoin: 2 boxes of 100 MIN + 4.5 ₳");
    // A swap's approval too.
    expect(row([way({ stuck: true })], true)).toContain('data-testid="lovejoin-token-way-stuck"');
    // A pool whose boxes pay their own way, or a token that comes back directly: no word of it.
    expect(row([way()])).not.toContain("lovejoin-token-way-stuck");
    expect(row([way({ stuck: true, pool: undefined, boxes: 0, direct: true })])).not.toContain("lovejoin-token-way-stuck");
  });
});

// The cross-area review of session 5. Review is reachable in a stuck pool now (call 34), and its reviews and form said
// each box comes back after its wait (M1); Bring everything back said nothing of a return's token going into such a
// pool (M2); and the pool page and the hub gave its boxes a time back, and Bring them all back's note said they come
// back by themselves (L2). Each failed before its fix.

/** A mix from the private balance as the worker builds it: one box of 10 ₳ in the classic pool, unless `mix` says. */
const privateMix = (mix: Record<string, unknown> = {}) =>
  ({
    network: "preprod",
    txHash: "ab".repeat(32),
    index: 0,
    address: "addr_test1" + "q".repeat(50),
    payments: [
      { address: "a", own: false, lovelace: "12450000", minimum: null, tokens: [] },
      { address: "a", own: false, lovelace: "5000000", minimum: null, tokens: [] },
    ],
    max: false,
    fee: { size: "0", compute: "0", scriptReference: "0", total: "300000" },
    changeLovelace: "0",
    changeTokens: 0,
    changeOutputs: 1,
    changeMinimum: "0",
    inputs: 1,
    left: 0,
    mix: { boxes: 1, lovelace: "12450000", mixes: 4, mixFees: "3800000", depth: 2, delay: "1-6", ...mix },
  }) as unknown as Parameters<typeof LovejoinScreen.PrivateReview>[0]["summary"];

/** A mix from the public account as the worker builds it. */
const publicMix = (extra: Record<string, unknown> = {}) =>
  ({
    network: "preprod",
    txHash: "ab".repeat(32),
    entry: "cd".repeat(32),
    boxes: 2,
    depth: 1,
    delay: "1-6",
    mixes: 2,
    txs: 3,
    fees: "2000000",
    change: "0",
    ...extra,
  }) as unknown as Parameters<typeof LovejoinScreen.PublicReview>[0]["summary"];

describe("a stuck pool's reviews never promise a box back after its wait (the cross-area review, M1)", () => {
  const { PrivateReview, PublicReview, EachBoxBackRow, reviewHint } = LovejoinScreen;
  const STUCK_NOTE = 'data-testid="lovejoin-review-stuck"';
  const reviews = (cantComeBack?: typeof STUCK, box?: ShownPool["box"]) => ({
    mix: html(createElement(PrivateReview, { summary: privateMix(), box, cantComeBack })),
    again: html(createElement(PrivateReview, { summary: privateMix({ again: true, owned: 2 }), box, cantComeBack })),
    publicMix: html(createElement(PublicReview, { summary: publicMix(), box, cantComeBack })),
    publicAgain: html(createElement(PublicReview, { summary: publicMix({ again: true }), box, cantComeBack })),
    bootstrap: html(createElement(PrivateReview, { summary: privateMix({ bootstrap: true, mixes: 0, mixFees: "0" }), box, cantComeBack })),
    publicBootstrap: html(createElement(PublicReview, { summary: publicMix({ bootstrap: true, mixes: 0 }), box, cantComeBack })),
  });

  it("says the pool's callout on every review there, and drops each Back later row that promised a return", () => {
    const stuck = reviews(STUCK, MIN_100);
    for (const [name, markup] of Object.entries(stuck)) {
      expect(markup, name).toContain(STUCK_NOTE);
      expect(words(markup), name).toContain(lead());
    }
    for (const markup of [stuck.mix, stuck.again, stuck.publicMix, stuck.publicAgain]) expect(words(markup)).not.toContain(t("lovejoin.backLater"));
    // A Bootstrap's row says they come back only when brought back by hand: still true, so it stays.
    expect(words(stuck.bootstrap)).toContain(t("lovejoin.review.bootstrapBack"));
    expect(words(stuck.publicBootstrap)).toContain(t("lovejoin.review.bootstrapBack"));
  });

  it("keeps the classic pool's reviews as they were: never stuck, no callout, its Back later rows", () => {
    const classic = reviews();
    for (const markup of Object.values(classic)) expect(markup).not.toContain(STUCK_NOTE);
    for (const markup of [classic.mix, classic.again, classic.publicMix, classic.publicAgain]) expect(words(markup)).toContain(t("lovejoin.backLater"));
    // What the page hands them for the classic pool, none, renders them byte for byte as no prop at all.
    expect(classic.mix).toBe(html(createElement(PrivateReview, { summary: privateMix() })));
    expect(classic.publicMix).toBe(html(createElement(PublicReview, { summary: publicMix() })));
  });

  it("drops the hint's last sentence's promise there, the whole hint, rather than say what isn't so", () => {
    const of = (summary: unknown, source: "private" | "public", cantComeBack?: typeof STUCK) =>
      reviewHint({ source, summary } as Parameters<typeof reviewHint>[0], cantComeBack);
    expect(of(privateMix(), "private")).toBe(t("lovejoin.review.privateNote"));
    expect(of(privateMix(), "private", STUCK)).toBeUndefined();
    expect(of(privateMix({ again: true }), "private")).toBe(t("lovejoin.review.againNote"));
    expect(of(privateMix({ again: true }), "private", STUCK)).toBeUndefined();
    expect(of(publicMix(), "public")).toBe(t("lovejoin.review.publicNote"));
    expect(of(publicMix(), "public", STUCK)).toBeUndefined();
    expect(of(publicMix({ again: true }), "public")).toBe(t("lovejoin.review.publicAgainNote"));
    expect(of(publicMix({ again: true }), "public", STUCK)).toBeUndefined();
    // A Bootstrap's note says its boxes stay until brought back by hand: kept. From the private balance, its own, as
    // it's funded first (1.6.0's review of the fixes, R3-21).
    expect(of(privateMix({ bootstrap: true }), "private", STUCK)).toBe(t("lovejoin.review.bootstrapNotePrivate"));
    expect(of(publicMix({ bootstrap: true }), "public", STUCK)).toBe(t("lovejoin.review.bootstrapNote"));
  });

  it("drops the Mix form's each-box-back row there, and keeps it elsewhere", () => {
    const row = (cantComeBack?: typeof STUCK) =>
      words(html(createElement(EachBoxBackRow, { funding: { boxes: 2, delay: "1-6" }, later: 19_000_000n, cantComeBack })));
    expect(row()).toContain(t("lovejoin.backLater"));
    expect(row(STUCK)).toBe("");
  });
});

describe("a stuck pool's boxes are given no time back (the cross-area review, L2)", () => {
  const due = [Date.now() + 3_600_000];
  const mine = poolOf({ boxes: [at(1)], due, lovelace: "4500000" });

  it("on the pool's page and the hub's rows, where the worker only puts their time off", () => {
    expect(words(open(mine))).toContain(t("lovejoin.row.nextBack"));
    expect(words(open({ ...mine, cantComeBack: STUCK }))).not.toContain(t("lovejoin.row.nextBack"));
    const hub = (pools: ShownPool[]) => words(html(createElement(LovejoinScreen.YourBoxes, { pools })));
    expect(hub([mine])).toContain(t("lovejoin.row.nextBack"));
    expect(hub([{ ...mine, cantComeBack: STUCK }])).not.toContain(t("lovejoin.row.nextBack"));
    // Another pool's next box still comes back when it says.
    const classic = { ...poolOf({ boxes: [{ ...at(2), pool: undefined }], due, lovelace: "10000000" }), id: undefined, box: { lovelace: "10000000" } };
    expect(hub([classic, { ...mine, cantComeBack: STUCK }])).toContain(t("lovejoin.row.nextBack"));
  });

  it("never says a Bootstrap's boxes, let go, come back by themselves from then on", () => {
    const held = (stuck?: boolean) =>
      words(html(createElement(LovejoinScreen.BootstrapHeld, { count: 1, busy: false, stuck, onOne: nothing, onAll: nothing })));
    expect(held()).toContain(t("lovejoin.bootstrap.allNote"));
    expect(held(true)).not.toContain(t("lovejoin.bootstrap.allNote"));
    // Its page, as it hands the callout the pool's state.
    const page = (extra: Partial<ShownPool>) => words(open(poolOf({ boxes: [at(1)], bootstrap: [at(1)], ...extra })));
    expect(page({})).toContain(t("lovejoin.bootstrap.allNote"));
    expect(page({ cantComeBack: STUCK })).not.toContain(t("lovejoin.bootstrap.allNote"));
  });
});

describe("Bring everything back says where a return's token goes into a stuck pool (the cross-area review, M2)", () => {
  const way = (extra: Partial<LovejoinTokenWay> = {}): LovejoinTokenWay => ({ ...MIN, pool: A, quantity: MIN_100.token.quantity, boxes: 2, pools: [A], ...extra });
  const back = (index: number, ways: LovejoinTokenWay[]): SessionBackSummary => ({
    network: "preprod",
    index,
    txHash: "ab".repeat(32),
    fee: "300000",
    lovelace: "5200000",
    tokens: [],
    depositOutputs: 1,
    inputs: 2,
    lovejoin: { boxes: 2, depth: 2, mixes: 8, fees: "8000000", txs: 10, delay: "1-6", entry: "11".repeat(32), parts: [{ pool: A, boxes: 2 }], values: { [A]: MIN_100 }, ways },
  });
  const review = (returns: SessionBackSummary[], chosen = returns.map((r) => r.index)) =>
    html(
      createElement(ClaimReview, {
        built: { returns, skipped: [] },
        chosen: new Set(chosen),
        sessions: [],
        direct: false,
        busy: false,
        onToggle: nothing,
        onDirect: nothing,
      }),
    );
  const item = () => t("claim.warn.skippedItem", { name: "MIN", why: withoutStop(t("lovejoin.ways.warn.stuck")) });

  it("warns under the token's name, once however many returns take it there", () => {
    const one = review([back(3, [way({ stuck: true })])]);
    expect(one).toContain('data-testid="claim-lovejoin-stuck"');
    expect(words(one)).toContain(item());
    const two = words(review([back(3, [way({ stuck: true })]), back(4, [way({ stuck: true })])]));
    expect(two.split(item()).length - 1).toBe(1);
  });

  it("says nothing of a pool whose boxes pay their own way, a token back directly, or a return left out", () => {
    expect(review([back(3, [way()])])).not.toContain("claim-lovejoin-stuck");
    expect(review([back(3, [way({ stuck: true, pool: undefined, boxes: 0, direct: true })])])).not.toContain("claim-lovejoin-stuck");
    expect(review([back(3, [way({ stuck: true })])], [])).not.toContain("claim-lovejoin-stuck");
  });
});
