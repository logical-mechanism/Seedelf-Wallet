// 1.6.0's second fix round, the screens' side: the merged fixes' review (MERGED-2, MERGED-4, MERGED-1's words) and
// the preprod rehearsal (R9, R10, step 4's words). Each rendered as the page shows it, or, where a page's state
// decides it, the rule it follows, with the worker's call stubbed. Each failed before its fix.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "../src/i18n";
import { DEFAULT_PREFERENCES, type Preferences } from "../src/shared/preferences";
import type { LovejoinPublicSummary, SessionView } from "../src/shared/rpc";
import * as Pools from "../src/ui/lovejoin-pools";
import { groupPools, type ShownPool } from "../src/ui/lovejoin-pools";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import * as LovejoinScreen from "../src/ui/screens/Lovejoin";
import * as LaunchScreen from "../src/ui/screens/LovejoinLaunch";
import { Session } from "../src/ui/screens/Swaps";

// The worker, as the hub asks it: what each request answers, and every request asked.
const worker = vi.hoisted(() => ({
  asked: [] as Array<{ type: string; payload: unknown }>,
  answer: (type: string): Promise<unknown> => Promise.reject(new Error(`no answer for ${type}`)),
}));
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: (type: string, payload: unknown) => {
    worker.asked.push({ type, payload });
    return worker.answer(type);
  },
}));

const { AgainActions, HeldQuestion, PoolGroupList, PublicReview, lookForPools, unusableText } = LovejoinScreen;

/** A page's text, as a person reads it. */
const text = (element: ReactElement) => words(html(element));

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

/** A page's markup, on preprod. */
const html = (element: ReactElement) => renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));

/** `element` with the balances shown. */
const shown = (element: ReactElement, prefs: Partial<Preferences> = {}) =>
  createElement(
    PreferencesContext.Provider,
    { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false, ...prefs }, loaded: true, set: async () => undefined } },
    element,
  );

/** The tag of the button `testId` names, whole. */
const button = (markup: string, testId: string) => markup.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0];

/** MIN, on preprod's token list. */
const MIN = { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e" };
const A = "a1".repeat(28);
const B = "b2".repeat(28);
const MIN_100 = { lovelace: "4500000", token: { ...MIN, quantity: "100000000" } };
const at = (i: number) => ({ txHash: `${i}`.padStart(64, "0"), txIndex: 0, pool: A });
const nothing = () => undefined;

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

describe("Bring them all back, where the pool's boxes can't pay their own way back (MERGED-2)", () => {
  const ask = (props: Partial<Parameters<typeof HeldQuestion>[0]>) =>
    text(createElement(HeldQuestion, { all: true, stuck: false, fromAccount: false, onKeep: nothing, onConfirm: nothing, ...props }));

  it("says they wait in the pool until the fees allow, never only that each comes back by itself", () => {
    const stuck = ask({ stuck: true });
    expect(stuck).toContain(t("lovejoin.bootstrap.warn.allStuck"));
    expect(stuck).toMatch(/wait in the pool/);
    // Let go, they come back by themselves once the fees allow (the worker puts each off STUCK_WAIT_MS meanwhile):
    // the button still lets them go.
    expect(stuck).toContain(t("lovejoin.bootstrap.bringAll"));
    // A pool whose boxes pay their way: the question as it was.
    expect(ask({})).not.toContain(t("lovejoin.bootstrap.warn.allStuck"));
    // Bring one back's question in a stuck pool says who pays, either payer (the owner's call 36), and nothing of the
    // others waiting.
    const one = ask({ all: false, stuck: true });
    expect(one).toContain(t("lovejoin.stuck.privacy.private"));
    expect(one).toContain(t("lovejoin.stuck.privacy.public"));
    expect(one).not.toContain(t("lovejoin.bootstrap.warn.allStuck"));
  });
});

describe("Mix again, on a pool's page and the hub (MERGED-4)", () => {
  const page = (pool: ShownPool) =>
    html(
      shown(
        createElement(AgainActions, {
          pool,
          busy: false,
          mixingAgain: false,
          publicSending: false,
          onAgain: nothing,
          onAgainPublic: nothing,
          onNow: nothing,
          onAnyway: nothing,
        }),
      ),
    );

  it("offers no Mix again over boxes a Bootstrap holds, as the worker takes none of them", () => {
    // A private Bootstrap holds both of the wallet's boxes: the worker answers that there's nothing to mix again.
    const privately = page(poolOf({ boxes: [at(1), at(2)], bootstrap: [at(1), at(2)] }));
    expect(button(privately, "lovejoin-again")).toBeUndefined();
    // A public Bootstrap holds the account's: none came from a mix from it, as the worker says.
    const publicly = page(poolOf({ boxes: [at(1), at(2)], fromPublic: [at(1), at(2)], bootstrap: [at(1), at(2)] }));
    expect(button(publicly, "lovejoin-again-public")).toBeUndefined();
    expect(button(publicly, "lovejoin-again-anyway")).toBeUndefined();
    expect(button(publicly, "lovejoin-again")).toBeUndefined();
    // A box no Bootstrap holds, on either side: offered, as before.
    const both = page(poolOf({ boxes: [at(1), at(2), at(3), at(4)], fromPublic: [at(1), at(3)], bootstrap: [at(1), at(2)] }));
    expect(button(both, "lovejoin-again")).toBeDefined();
    expect(button(both, "lovejoin-again-public")).toBeDefined();
    expect(button(both, "lovejoin-again-anyway")).toBeDefined();
    // And the classic pool with no Bootstrap, as on main.
    const classic = page({ ...poolOf({ boxes: [{ ...at(1), pool: undefined }], lovelace: "10000000" }), id: undefined, box: { lovelace: "10000000" } });
    expect(button(classic, "lovejoin-again")).toBeDefined();
    expect(button(classic, "lovejoin-now")).toBeDefined();
  });

  it("turns every Mix again off in a pool that takes no new box, saying why under them as Mix does", () => {
    const off = page(poolOf({ boxes: [at(1), at(2)], fromPublic: [at(2)], unusable: { why: "belowMinimum" } }));
    for (const id of ["lovejoin-again", "lovejoin-again-public", "lovejoin-again-anyway"]) expect(button(off, id)).toContain('disabled=""');
    expect(words(off)).toContain(t("lj.unusable.warn.belowMinimum"));
    // Bringing a box back makes none: it stays on.
    expect(button(off, "lovejoin-now")).not.toContain("disabled");
    // A pool that takes boxes: on, and no word of it.
    const on = page(poolOf({ boxes: [at(1), at(2)], fromPublic: [at(2)] }));
    expect(button(on, "lovejoin-again")).not.toContain("disabled");
    expect(button(on, "lovejoin-again-public")).not.toContain("disabled");
    expect(words(on)).not.toContain(t("lj.unusable.warn.belowMinimum"));
  });

  it("flags a pool that takes no new box on the hub's row, in the page's words", () => {
    const rows = (pool: ShownPool) => text(shown(createElement(PoolGroupList, { group: groupPools([pool], [])[0]!, onOpen: nothing })));
    expect(rows(poolOf({ unusable: { why: "belowMinimum" } }))).toContain(t("lj.unusable.warn.belowMinimum"));
    expect(rows(poolOf())).not.toContain(t("lj.unusable.warn.belowMinimum"));
  });
});

describe("a copy pool's words (MERGED-1, the screens' side)", () => {
  it("says a copy pool takes no new box, apart from a box below the network's minimum", () => {
    // The key the worker refuses a new box with, added beside the others (BRIEF's contract).
    expect(t("lj.unusable.warn.superseded")).not.toBe("lj.unusable.warn.superseded");
    expect(unusableText({ why: "superseded" })).toBe(t("lj.unusable.warn.superseded"));
    expect(unusableText({ why: "belowMinimum" })).toBe(t("lj.unusable.warn.belowMinimum"));
  });

  it("lists a copy on the hub only while the wallet has boxes in it, flagged, and never offers it to join", () => {
    const copy = poolOf({ id: B, unusable: { why: "superseded" } });
    expect(Pools.shownOnHub(copy)).toBe(false);
    expect(Pools.shownOnHub({ ...copy, boxes: [at(1)] })).toBe(true);
    expect(Pools.shownOnHub({ ...copy, bootstrap: [at(1)] })).toBe(true);
    expect(Pools.shownOnHub(poolOf({ unusable: { why: "belowMinimum" } }))).toBe(true);
    expect(Pools.shownOnHub(poolOf({ cantComeBack: { has: "1589324", needs: "1723200" } }))).toBe(true);
    expect(Pools.shownOnHub(poolOf())).toBe(true);
    const rows = text(shown(createElement(PoolGroupList, { group: groupPools([{ ...copy, boxes: [at(1)] }], [])[0]!, onOpen: nothing })));
    expect(rows).toContain(t("lj.unusable.warn.superseded"));
    // Short of its floor, a copy is never said to be being started: it takes no box to start it with.
    const short = text(shown(createElement(PoolGroupList, { group: groupPools([{ ...copy, others: 3, boxes: [at(1)] }], [])[0]!, onOpen: nothing })));
    expect(short).not.toContain("Being started");
    expect(text(shown(createElement(PoolGroupList, { group: groupPools([poolOf({ others: 3 })], [])[0]!, onOpen: nothing })))).toContain(
      "Being started: 3 of 30 boxes",
    );
    // Start a pool's list of the pools to join rather than split: a 5 ₳ ADA pool, and a copy of its values.
    const shownFive = { ...poolOf({ id: A, box: { lovelace: "5000000" } }) };
    const copyFive = { ...poolOf({ id: B, box: { lovelace: "5000000" }, unusable: { why: "superseded" as const } }) };
    const form = html(
      createElement(LaunchScreen.LovejoinLaunch, {
        seedelf: { lovelace: "0", tokens: [] } as never,
        pools: [shownFive, copyFive],
        holdings: [],
        onBack: nothing,
        onOpenPool: nothing,
        onSent: nothing,
      }),
    );
    expect(form).toContain(`data-testid="lovejoin-launch-join-${A}"`);
    expect(form).not.toContain(`data-testid="lovejoin-launch-join-${B}"`);
  });
});

describe("the hub reads its pools again when its look found more (R10)", () => {
  it("reads again once, after its first read, when the look changed the pools; never when it didn't or failed", async () => {
    const order: string[] = [];
    let endFirst = nothing as () => void;
    const first = new Promise<void>((done) => {
      endFirst = () => {
        order.push("first");
        done();
      };
    });
    const again = vi.fn(async () => {
      order.push("again");
    });
    worker.asked = [];
    worker.answer = async () => ({ grew: true });
    const looking = lookForPools(first, again);
    // The look answered before the first read did: the read again waits for it, so the first can't overtake it.
    await new Promise((r) => setTimeout(r, 0));
    expect(worker.asked).toEqual([{ type: "lovejoin-look-for-pools", payload: {} }]);
    expect(again).not.toHaveBeenCalled();
    endFirst();
    await looking;
    expect(again).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["first", "again"]);

    const not = vi.fn(async () => undefined);
    worker.answer = async () => ({ grew: false });
    await lookForPools(Promise.resolve(), not);
    worker.answer = async () => {
      throw new Error("Koios didn't answer");
    };
    await lookForPools(Promise.resolve(), not);
    expect(not).not.toHaveBeenCalled();
  });
});

describe("Lovejoin's public reviews say what the public account holds after (R9)", () => {
  const summary = {
    network: "preprod",
    txHash: "ab".repeat(32),
    entry: "cd".repeat(32),
    boxes: 2,
    depth: 2,
    delay: "1-6",
    mixes: 8,
    txs: 9,
    fees: "6852214",
    change: "0",
  } as LovejoinPublicSummary;
  const review = (s: LovejoinPublicSummary, before?: string, box?: ShownPool["box"]) =>
    text(shown(createElement(PublicReview, { summary: s, ...(box ? { box } : {}), ...(before ? { before } : {}) } as Parameters<typeof PublicReview>[0])));

  it("on a mix, a Bootstrap and a mix again from it, from Home's figure for the account", () => {
    // 100 ₳ on Home, two 10 ₳ boxes and 6.852214 ₳ of fees leaving.
    expect(review(summary, "100000000")).toContain("Public account after 73.147786 ₳");
    // Thirty boxes of 100 MIN + 4.5 ₳ and 0.3 ₳ of fees, from 200 ₳.
    const bootstrap = { ...summary, bootstrap: true, boxes: 30, mixes: 0, txs: 1, fees: "300000", pool: A, token: { ...MIN, quantity: "3000000000" } };
    expect(review(bootstrap, "200000000", MIN_100)).toContain("Public account after 64.7 ₳");
    // Mixing its own boxes again: the fees alone leave.
    expect(review({ ...summary, again: true }, "100000000")).toContain("Public account after 93.147786 ₳");
    // No figure handed down: no after line, as before.
    expect(review(summary)).not.toContain("Public account after");
  });

  it("on a pool's start paid from the public account, as from the private balance", () => {
    const { LaunchTotals } = LaunchScreen;
    const start = { from: "public" as const, locked: { reference: "0", mixBox: "0", mixLogic: "0", deposit: "0", total: "23110000" }, fee: "480000" };
    const seedelf = { lovelace: "300000000", locked: { lovelace: "0", tokens: [], utxos: 0 } } as never;
    const totals = (props: object) => text(shown(createElement(LaunchTotals, { review: start, seedelf, ...props } as Parameters<typeof LaunchTotals>[0])));
    expect(totals({ publicTotal: "50000000" })).toContain("Public account after 26.41 ₳");
    expect(totals({})).not.toContain("after");
    // The private balance's, as before: Home's figure from what the page has.
    expect(totals({ review: { ...start, from: "private" } })).toContain("Private balance after 276.41 ₳");
  });
});

describe("a private swap's session page, at its last step, says where its money goes (the rehearsal's step 4)", () => {
  const TUSDM = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";
  const swap = (over: Partial<SessionView> = {}): SessionView => ({
    index: 2,
    network: "preprod",
    address: "addr_test1" + "q".repeat(50),
    createdAt: 0,
    stage: "open",
    txs: [
      { kind: "out", txHash: "ab".repeat(32), at: 0, confirmed: true },
      { kind: "swap", txHash: "cd".repeat(32), at: 1, confirmed: true },
    ],
    swap: {
      amount: "10000000",
      tokenIn: "lovelace",
      tokenOut: TUSDM,
      slippage: 1,
      amountOut: "4200000",
      minAmountOut: "4158000",
      display: { in: { label: "₳", decimals: 6 }, out: { label: "tUSDM", decimals: 6 } },
    },
    holding: { lovelace: "17000000", tokens: [], utxos: 1 },
    auto: { step: "filling", stopping: false, filled: true, approvedMinOut: "4158000", direct: false },
    ...over,
  });
  const page = (s: SessionView) => text(createElement(Session, { session: s, reading: false, onRefresh: nothing, onBack: nothing, onChanged: nothing }));
  const FRESH = "Everything at the account, under fresh registers";
  const back = (kind: "deposit" | "mix" | "back", i: number) => ({ kind, txHash: `${i}`.padStart(64, "e"), at: 10 + i, confirmed: true });

  it("says what goes into Lovejoin's boxes comes back later, once its return goes through Lovejoin", () => {
    // Its proceeds' boxes into the token's pool, mixed, and the return: all on chain.
    const done = swap({
      stage: "closed",
      txs: [...swap().txs, back("deposit", 1), back("mix", 2), back("back", 3)],
      auto: { ...swap().auto!, step: "done" },
      chain: { total: 3, sent: 3, confirmed: 3, cut: false },
    });
    expect(page(done)).toContain(t("swaps.step.throughLovejoin"));
    expect(page(done)).not.toContain(FRESH);
    // Being sent, the same.
    const sending = swap({ txs: [...swap().txs, back("deposit", 1)], auto: { ...swap().auto!, step: "returning" }, chain: { total: 3, sent: 1, confirmed: 1, cut: false } });
    expect(page(sending)).toContain(t("swaps.step.throughLovejoin"));
    // Approved through Lovejoin, its return not built yet: what goes into boxes comes back later.
    expect(page(swap())).toContain(t("swaps.step.throughLovejoin"));
    expect(page(swap())).not.toContain(FRESH);
  });

  it("says a chain cut short brought the rest back directly", () => {
    const cut = swap({
      txs: [...swap().txs, back("deposit", 1), back("back", 4)],
      auto: { ...swap().auto!, step: "done" },
      chain: { total: 3, sent: 1, confirmed: 1, cut: true },
    });
    expect(page(cut)).toContain("Stopped after 1 of 3 transactions; what was left came back directly");
    expect(page(cut)).not.toContain(FRESH);
  });

  it("keeps its words where nothing went into a box: direct, as chosen, left out, or too little for one", () => {
    expect(page(swap({ auto: { ...swap().auto!, direct: true } }))).toContain("Directly, as you chose");
    expect(page(swap({ lovejoinSkipped: "too few boxes" }))).toContain("Directly: Lovejoin was left out");
    // Its return went directly with no chain: nothing paid for a box.
    const direct = swap({ stage: "closed", txs: [...swap().txs, back("back", 3)], auto: { ...swap().auto!, step: "done" } });
    expect(page(direct)).toContain(FRESH);
    // A swap from before the switch, its return not built: as Settings has it, said as it was.
    const before = swap({ auto: { step: "filling", stopping: false, filled: true, approvedMinOut: "4158000" } });
    expect(page(before)).toContain(FRESH);
  });
});

describe("a copy pool's page offers Mix again, which makes no deposit, and nothing that does (round two's review, R2-2)", () => {
  // PoolPage, as it opens on a pool (nothing built, nothing asked yet): its effects don't run here.
  const PoolPage = (LovejoinScreen as unknown as { PoolPage: (props: Record<string, unknown>) => ReactElement }).PoolPage;
  const open = (pool: ShownPool) =>
    html(
      shown(
        createElement(PoolPage, {
          pool,
          seedelf: { lovelace: "500000000", tokens: [{ ...MIN, quantity: "100000000000", fingerprint: "", decimals: 6 }], utxos: 3, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } },
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
      ),
    );
  // Two of the wallet's boxes a chain cut short left not mixed yet, in a pool with room for a mix.
  const unmixed = (extra: Partial<ShownPool>) => poolOf({ boxes: [at(1), at(2)], notMixed: [at(1), at(2)], due: [], ...extra });

  it("offers Mix again for boxes not mixed yet, as its callout says, while Mix and Bootstrap stay off", () => {
    const page = open(unmixed({ id: B, unusable: { why: "superseded" } }));
    // Mix again: on, with no reason under it; and the callout's way out is that button.
    expect(button(page, "lovejoin-again")).toBeDefined();
    expect(button(page, "lovejoin-again")).not.toContain("disabled");
    expect(page).not.toContain('data-testid="lovejoin-again-why"');
    expect(words(page)).toContain("Mix my boxes again takes them first");
    // Mix: off, saying why under Review.
    expect(button(page, "lovejoin-mix")).toContain('disabled=""');
    expect(words(page.match(/data-testid="lovejoin-mix-why"[^>]*>[^<]*/)?.[0] ?? "")).toContain(t("lj.unusable.warn.superseded"));
    // Bootstrap puts new boxes in, which a copy never takes: not offered at all, nor said to start the pool.
    expect(page).not.toContain('data-testid="lovejoin-bootstrap-open"');
    expect(page).not.toContain('data-testid="lovejoin-bootstrap"');
    expect(words(page)).not.toContain("Help start");
  });

  it("never leads a copy short of its floor with Bootstrap, or says to help start it", () => {
    const page = open(unmixed({ id: B, others: 3, free: 3, unusable: { why: "superseded" } }));
    expect(page).not.toContain('data-testid="lovejoin-bootstrap-lead"');
    expect(page).not.toContain('data-testid="lovejoin-bootstrap"');
    expect(words(page)).not.toContain("Help start");
    expect(button(page, "lovejoin-mix")).toContain('disabled=""');
    expect(button(page, "lovejoin-again")).not.toContain("disabled");
    // A pool short of its floor that isn't a copy still leads with Bootstrap, as before.
    expect(open(unmixed({ others: 3, free: 3 }))).toContain('data-testid="lovejoin-bootstrap-lead"');
  });

  it("keeps Mix again on where its boxes couldn't pay their own way back, and off, saying why, below the minimum", () => {
    // The owner's call 34: a pool whose boxes can't pay their own way back takes new boxes, said in its callout.
    const stuck = open(unmixed({ cantComeBack: { has: "1589324", needs: "1723200" } }));
    expect(button(stuck, "lovejoin-again")).not.toContain("disabled");
    expect(stuck).not.toContain('data-testid="lovejoin-again-why"');
    expect(stuck).toContain('data-testid="lovejoin-stuck"');
    expect(words(stuck)).toContain("Mix my boxes again takes them first");
    // A box below the network's minimum: nothing can be built, so off, saying why (MONEY-3).
    const page = open(unmixed({ unusable: { why: "belowMinimum" } }));
    expect(button(page, "lovejoin-again")).toContain('disabled=""');
    expect(words(page)).toContain(t("lj.unusable.warn.belowMinimum"));
    expect(page).toContain('data-testid="lovejoin-again-why"');
    // Its Bootstrap is offered, and off, as any pool that takes no new box today (MONEY-3).
    expect(page).toContain('data-testid="lovejoin-bootstrap-open"');
  });
});

describe("a copy's Mix again, where the pool's other reasons refuse it too (the last review, R3-2)", () => {
  const PoolPage = (LovejoinScreen as unknown as { PoolPage: (props: Record<string, unknown>) => ReactElement }).PoolPage;
  const open = (pool: ShownPool) =>
    html(
      shown(
        createElement(PoolPage, {
          pool,
          seedelf: { lovelace: "500000000", tokens: [], utxos: 3, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } },
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
      ),
    );
  // A copy holding one box of the wallet's not mixed yet, and one an account's mix put in: every Mix again shows.
  const copyOf = (unusable: ShownPool["unusable"]) =>
    poolOf({ id: B, boxes: [at(1), at(2)], notMixed: [at(1)], fromPublic: [at(2)], unusable });

  it("turns every Mix again off, in that reason's words, where the status says mixing again is refused there", () => {
    const page = open(copyOf({ why: "superseded", again: "belowMinimum" } as ShownPool["unusable"]));
    for (const id of ["lovejoin-again", "lovejoin-again-public", "lovejoin-again-anyway"]) expect(button(page, id)).toContain('disabled=""');
    expect(words(page.match(/data-testid="lovejoin-again-why"[^>]*>[^<]*/)?.[0] ?? "")).toContain(t("lj.unusable.warn.belowMinimum"));
    // Mix, which makes a deposit, still says the copy's reason, and the hub's flag too.
    expect(words(page.match(/data-testid="lovejoin-mix-why"[^>]*>[^<]*/)?.[0] ?? "")).toContain(t("lj.unusable.warn.superseded"));
    const row = text(shown(createElement(PoolGroupList, { group: groupPools([copyOf({ why: "superseded", again: "belowMinimum" })], [])[0]!, onOpen: nothing })));
    expect(row).toContain(t("lj.unusable.warn.superseded"));
    expect(row).not.toContain(t("lj.unusable.warn.belowMinimum"));
    // Bringing a box back makes none: on.
    expect(button(page, "lovejoin-now")).not.toContain("disabled");
  });

  it("keeps them on with the copy's reason alone", () => {
    const page = open(copyOf({ why: "superseded" }));
    for (const id of ["lovejoin-again", "lovejoin-again-public", "lovejoin-again-anyway"]) expect(button(page, id)).not.toContain("disabled");
    expect(page).not.toContain('data-testid="lovejoin-again-why"');
  });
});

// 34g's last review: a box not mixed yet in a token pool whose boxes can't pay their own way back had no way out the
// page offered (SCREENS-1); boxes another account's Bootstrap holds named that account as the one to mix them again
// (SCREENS-2); and where mixing again is refused, the words around it still sent the user there (SCREENS-3).
describe("a pool's page where mixing again is refused (34g's last review, SCREENS-1 to 3)", () => {
  const PoolPage = (LovejoinScreen as unknown as { PoolPage: (props: Record<string, unknown>) => ReactElement }).PoolPage;
  const open = (pool: ShownPool) =>
    html(
      shown(
        createElement(PoolPage, {
          pool,
          seedelf: { lovelace: "500000000", tokens: [], utxos: 3, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } },
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
      ),
    );
  const again = (pool: ShownPool) =>
    html(
      shown(
        createElement(AgainActions, {
          pool,
          busy: false,
          mixingAgain: false,
          publicSending: false,
          onAgain: nothing,
          onAgainPublic: nothing,
          onNow: nothing,
          onAnyway: nothing,
        }),
      ),
    );
  // A token pool whose box can't pay its own way back today, as status says it (the escape hatch's case). Since the
  // owner's call 34 it takes new boxes, so status names no reason it doesn't.
  const stuck = (extra: Partial<ShownPool>) => poolOf({ cantComeBack: { has: "1589324", needs: "1723200" }, ...extra });

  it("brings a box not mixed yet back paid in a stuck pool, saying who pays first (SCREENS-1; the owner's call 36)", () => {
    const pool = stuck({ boxes: [at(1)], notMixed: [at(1)] });
    expect(LovejoinScreen.anywayRequest(pool, true)).toEqual({ box: at(1), anyway: true, paid: true });
    expect(LovejoinScreen.anywayRequest(pool, "private")).toEqual({ box: at(1), anyway: true, paid: "private" });
    expect(LovejoinScreen.anywayRequest(pool)).toEqual({ box: at(1), anyway: true });
    const ask = (paying: boolean) => text(createElement(LovejoinScreen.AnywayQuestion, { pool, stuck: paying, onKeep: nothing, onConfirm: nothing }));
    expect(ask(true)).toContain(t("lovejoin.stuck.privacy.private"));
    expect(ask(true)).toContain(t("lovejoin.stuck.privacy.public"));
    expect(ask(true)).toContain(t("lovejoin.stuck.confirmPrivate"));
    expect(ask(true)).toContain(t("lovejoin.stuck.confirm"));
    expect(ask(false)).not.toContain(t("lovejoin.stuck.privacy.public"));
    expect(ask(false)).toContain(t("lovejoin.anyway.confirm"));
    // The escape hatch takes a box known to be mixed: with none, it's not offered only to be refused.
    const page = open(pool);
    expect(page).toContain('data-testid="lovejoin-stuck"');
    expect(page).not.toContain('data-testid="lovejoin-paid"');
    expect(page).toContain('data-testid="lovejoin-anyway"');
    expect(open(stuck({ boxes: [at(1), at(2)], notMixed: [at(1)] }))).toContain('data-testid="lovejoin-paid"');
    // Nor where a Bootstrap holds every box: its own Bring one back pays there.
    expect(open(stuck({ boxes: [at(1)], bootstrap: [at(1)] }))).not.toContain('data-testid="lovejoin-paid"');
  });

  it("names no other account to switch to for boxes its Bootstrap holds (SCREENS-2)", () => {
    const theirs = [at(1), at(2)];
    const pool = poolOf({ boxes: theirs, fromPublic: theirs, otherAccounts: theirs.map((b) => ({ ...b, account: 1 })), bootstrap: theirs });
    expect(again(pool)).not.toContain('data-testid="lovejoin-other-account"');
    // One of that account's boxes no Bootstrap holds: named, as before.
    expect(again({ ...pool, bootstrap: [at(1)] })).toContain('data-testid="lovejoin-other-account"');
  });

  it("never sends the user to Mix again where it's refused (SCREENS-3)", () => {
    const takes = t("lovejoin.warn.notMixed.takes.private", { count: 2 });
    const off = open(poolOf({ boxes: [at(1), at(2)], notMixed: [at(1), at(2)], unusable: { why: "belowMinimum" } }));
    expect(words(off)).not.toContain(takes);
    // Bring one back now would be refused with "Mix them again first": not offered. Bring one back anyway stays.
    expect(off).not.toContain('data-testid="lovejoin-now"');
    expect(off).toContain('data-testid="lovejoin-anyway"');
    // Where mixing again is on, as before.
    const on = open(poolOf({ boxes: [at(1), at(2)], notMixed: [at(1), at(2)] }));
    expect(words(on)).toContain(takes);
    expect(on).toContain('data-testid="lovejoin-now"');
  });

  it("warns before a copy's launch link, as for a pool the wallet started (PRIVACY-3)", () => {
    // A copy is listed only while the wallet has something in it: its launch is of interest here, as a started pool's.
    const launch = "1a".repeat(32);
    const copy = open(poolOf({ id: B, launch, boxes: [at(1)], unusable: { why: "superseded" } }));
    expect(copy).toContain('data-testid="explorer-note"');
    // A shown pool's, which anyone browses: plain, as before.
    expect(open(poolOf({ launch, boxes: [at(1)] }))).not.toContain('data-testid="explorer-note"');
  });
});
