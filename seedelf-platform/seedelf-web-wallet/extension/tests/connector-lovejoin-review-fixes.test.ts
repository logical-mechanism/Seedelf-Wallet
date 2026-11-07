// 1.8.0's release review, the connector's lane (O3, W5): a site's connect window and its funding's review promised a
// private session's spare ADA mixed through Lovejoin on Settings' switch alone, where 1.8.0 brings it back directly
// until v2's 5 ₳ pool takes a box of it (none shown, under the floor, too few boxes free). They now follow what the
// worker read of that pool, as a swap's approval does (Swaps.tsx, `skipped`):
// - the funding's review, from its own read at Review (siteOutBuild's `lovejoinRoom`, priced's rule, a failed read
//   counting as short): where none takes a box, a note hedged, never the direct words, which turn false once a pool
//   fills (o3-trace's "later" row);
// - the card, from a quiet read as the window opens, asking nobody (the connect approval's `lovejoinRoom`): where it
//   doesn't say the pool takes one, `swaps.lovejoin.privacy.onPoolShort` after its line.
// And W5: "the 5 ₳" (the collateral) next to "5 ₳ boxes" read as the boxes; it's "the 5 ₳ kept aside" now.
// Real WebAssembly, v2's 5 ₳ pool from v2-pools.ts, after o3-trace's scratch (tests/o3-trace-scratch.test.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The first useState that starts undefined starts as a seed's value: the connect window's choice, made on the page. */
const seam = vi.hoisted(() => {
  const state = {
    seeds: [] as Array<{ value: unknown; used?: true }>,
    seeded(initial: unknown): unknown {
      const seed = initial === undefined ? state.seeds.find((s) => !s.used) : undefined;
      if (!seed) return initial;
      seed.used = true;
      return seed.value;
    },
  };
  return state;
});
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial?: unknown) => react.useState(seam.seeded(initial)) };
});

import { Collateral } from "../src/background/collateral";
import { DappService } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, POOL_ROOM_MS, type PoolRef } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { t as tr } from "../src/i18n";
import { i18n } from "../src/i18n/core";
import { NETWORKS } from "../src/networks";
import { DEFAULT_PREFERENCES, type Preferences } from "../src/shared/preferences";
import type { DappApproval, SessionOutSummary } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { ConnectRequest, FundingWayBack } from "../src/ui/screens/DappApprovals";
import { account, AGREES, atSession, PASSWORD } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances } from "./fakes";
import { ADA_POOL, ADA_VIEW, adaStrangers } from "./v2-pools";

const SLOW = { timeout: 300_000 };
const ADA = 1_000_000n;
type T = ReturnType<typeof testBalances>;

/** What a person reads of markup. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The card's line, said with no hedge, and the hedge the swap's approval says where the pool takes nothing now. */
const SPARE_MIXED = "Spare ADA is mixed through Lovejoin so it's harder to tie to this session: about 4.1 ₳ a 5 ₳ box plus a fee, back hours later.";
const HEDGE = "Only if Lovejoin's pool has room when it comes back.";
/** The review's notes: the plain one, the one that mixes the collateral too, and the hedged one (O3, W5). */
const NOTE_PLAIN =
  "From the dApps page. Lovejoin mixes the spare ADA so it's harder to tie to this session, back in 5 ₳ boxes hours later. The rest and the 5 ₳ kept aside come back at once. Settings → Lovejoin turns that off.";
const NOTE_MIXED =
  "From the dApps page. Lovejoin mixes the spare ADA in 5 ₳ boxes, and the 5 ₳ kept aside in a box of its own, mixed once, only if enough is left, so they're harder to tie to this session; they come back hours later. The rest comes back at once. Settings → Lovejoin turns that off.";
const NOTE_HEDGED =
  "From the dApps page. Lovejoin mixes the spare ADA so it's harder to tie to this session, back in 5 ₳ boxes hours later, if its pool has room by then. What isn't mixed comes back at once. Settings → Lovejoin turns that off.";

/** The wallet: a private balance of one 60 ₳ UTxO, `strangers` boxes in v2's 5 ₳ pool, Settings as it starts or `prefs`. */
async function wallet(strangers: number, prefs: Partial<Preferences> = {}): Promise<T> {
  const t = testBalances({ owned: false });
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = AGREES;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  await t.deps.preferences.set({ dappConnector: true, ...prefs });
  t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: (60n * ADA).toString() } as KoiosUtxo);
  t.koios.addedToAccounts.push(...adaStrangers(strangers));
  return t;
}

/** Lovejoin, discovery handing over what `pools()` says at each read (a pool can turn up later), and `over`'s. */
function lovejoinOf(t: T, pools: () => PoolRef[], over: Partial<ConstructorParameters<typeof LovejoinService>[0]> = {}): LovejoinService {
  return new LovejoinService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => pools(),
    random: () => 0.5,
    ...over,
  });
}

/** The sessions over `lj`, the one-time key's signature stood in for. */
function sessionsOver(t: T, lj: LovejoinService): SessionService {
  const wasm = loadTestWasm();
  return new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: lj,
    sleep: async () => undefined,
    alarm: { start: async () => undefined },
  });
}

/** A site's private session funded with 15 ₳: what the connect window's review shows. */
const funding = (sessions: SessionService) => sessions.siteOutBuild("preprod", "https://example.org", (15n * ADA).toString(), []);

/** The funding's review's way back, as ConnectRequest renders it, Settings bringing sessions back through Lovejoin. */
const wayBack = (summary: Pick<SessionOutSummary, "collateralReserve" | "collateralMix" | "lovejoinRoom"> & { fee?: { total: string } }, lovejoin = true) =>
  text(renderToStaticMarkup(createElement(FundingWayBack, { fee: summary.fee?.total ?? "233208", lovejoin, perBox: "4.1", summary })));

/** Session 0 recorded as the site's, its funding on chain, its account holding 40 ₳ and its 5 ₳ collateral. */
async function funded(t: T): Promise<void> {
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
        site: { origin: "https://example.org" },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"), atSession("c2".repeat(32), 1, "5000000"));
}

/** Every read of v2's 5 ₳ pool's boxes fails, as a Koios timing out on the pools' read does. */
function poolDown(t: T): void {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    const asked = init?.body ? (JSON.parse(String(init.body)) as { _payment_credentials?: string[] }) : undefined;
    if (String(url).includes("/credential_utxos") && asked?._payment_credentials?.includes(ADA_VIEW.mixBoxHash)) {
      return new Response("gateway timeout", { status: 504 });
    }
    return real(url, init);
  };
}

/** Whether the pool's boxes were asked of Koios since call `from`. */
const poolRead = (t: T, from = 0) =>
  t.koios.calls.slice(from).some((c) => c.path === "credential_utxos" && (c.body as { _payment_credentials?: string[] } | null)?._payment_credentials?.includes(ADA_VIEW.mixBoxHash));

describe("1.8.0's release review: a site's funding review says the spare ADA is mixed only where v2's 5 ₳ pool takes a box now (O3)", SLOW, () => {
  const floor = NETWORKS.preprod.lovejoin!.poolFloor;
  afterEach(() => {
    NETWORKS.preprod.lovejoin!.poolFloor = floor;
  });

  it("a pool that takes a box: marked, the plain words, and the return mixes as they say", async () => {
    const t = await wallet(20);
    const sessions = sessionsOver(t, lovejoinOf(t, () => [ADA_POOL]));
    const summary = await funding(sessions);
    expect(summary.lovejoinRoom).toBe(true);
    // Its collateral's mix too, only if enough is left (1.6.0's review of the fixes, fx-promise).
    expect(summary.collateralMix).toBe("ifLeft");
    expect(wayBack(summary)).toContain(NOTE_MIXED);
    expect(wayBack(summary)).not.toContain("if its pool has room by then");
    await funded(t);
    const back = await sessions.backBuild("preprod", 0);
    expect(back.lovejoinSkipped).toBeUndefined();
    expect(back.lovejoin!.boxes).toBeGreaterThan(0);
  });

  it("no 5 ₳ pool known: hedged, never promised, and the return comes back directly", async () => {
    const t = await wallet(20);
    const sessions = sessionsOver(t, lovejoinOf(t, () => []));
    const summary = await funding(sessions);
    expect(summary.lovejoinRoom).toBeUndefined();
    expect(wayBack(summary)).toContain(NOTE_HEDGED);
    // The rows stay, each "about": what it costs if it does go through Lovejoin.
    expect(wayBack(summary)).toContain("Through Lovejoin first, about 4.1 ₳ a 5 ₳ box");
    expect(wayBack(summary)).not.toContain("back in 5 ₳ boxes hours later. The rest");
    await funded(t);
    const back = await sessions.backBuild("preprod", 0);
    expect(back.lovejoin).toBeUndefined();
    expect(back.lovejoinSkipped).toBe(tr("sess.skip.warn.noAdaPool"));
  });

  it("a pool discovery hadn't kept, found as Review asks for it, as a return's build asks: marked", async () => {
    // Kept: none; asked (the data layer's list, and from the find lane's fix Koios's holder too): v2's 5 ₳ pool.
    const t = await wallet(20);
    const summary = await funding(sessionsOver(t, lovejoinOf(t, () => [ADA_POOL], { known: async () => [] })));
    expect(summary.lovejoinRoom).toBe(true);
    // Its collateral's look asks for that pool first (collateralRoom's ask): its mix's reserve is set aside, the 5 ₳
    // mixed only if enough is left. Without that ask only the mark came, from the later one, and the note said the 5 ₳
    // kept aside comes back at once, where its return mixes it if it can (1.8.0's release review, last-code#0).
    expect(summary.collateralMix).toBe("ifLeft");
    expect(summary.collateralReserve).toBe("2800000");
  });

  it("a pool under the network's floor (mainnet's 30, set on preprod): hedged", async () => {
    NETWORKS.preprod.lovejoin!.poolFloor = 30;
    const t = await wallet(22);
    const summary = await funding(sessionsOver(t, lovejoinOf(t, () => [ADA_POOL])));
    expect(summary.lovejoinRoom).toBeUndefined();
    // Nor is its collateral's mix: nothing set aside for it, nor said, as its return brings the 5 ₳ back directly under
    // the floor (collateralRoom's floor, as collateralPool's at the build; 1.8.0's release review, last-code#0).
    expect(summary.collateralReserve).toBeUndefined();
    expect(summary.collateralMix).toBeUndefined();
    expect(wayBack(summary)).toContain(NOTE_HEDGED);
  });

  it("a pool with room for the collateral's mix but not for a box of the spare ADA: hedged, by the spare ADA's rule", async () => {
    // Five strangers' boxes: the collateral's mix draws two, a box two waves deep three a mix needs eight.
    const t = await wallet(5);
    const summary = await funding(sessionsOver(t, lovejoinOf(t, () => [ADA_POOL])));
    expect(summary.collateralMix).toBe("ifLeft");
    expect(summary.lovejoinRoom).toBeUndefined();
    expect(wayBack(summary)).toContain(NOTE_HEDGED);
    expect(wayBack(summary)).not.toContain("Lovejoin mixes the spare ADA in 5 ₳ boxes");
  });

  it("a pool that takes no new box now (usableNow): hedged", async () => {
    const t = await wallet(20);
    const wasm = loadTestWasm();
    const below = { ...wasm, lovejoinUsable: () => JSON.stringify({ usable: false, why: "belowMinimum" }) } as typeof wasm;
    const summary = await funding(sessionsOver(t, lovejoinOf(t, () => [ADA_POOL], { wasm: below })));
    expect(summary.lovejoinRoom).toBeUndefined();
    // Nor its collateral's mix, by the same rule (collateralRoom's usableNow; 1.8.0's release review, last-code#0).
    expect(summary.collateralReserve).toBeUndefined();
    expect(summary.collateralMix).toBeUndefined();
    expect(wayBack(summary)).toContain(NOTE_HEDGED);
  });

  it("a read of the pool that fails counts as short, never as taking a box", async () => {
    const t = await wallet(20);
    poolDown(t);
    const summary = await funding(sessionsOver(t, lovejoinOf(t, () => [ADA_POOL])));
    // The collateral's maybe, as before (fx-may): the pool may still take it as the session comes back.
    expect(summary.collateralMix).toBe("ifLeft");
    expect(summary.lovejoinRoom).toBeUndefined();
    expect(wayBack(summary)).toContain(NOTE_HEDGED);
  });

  it("with Settings' collateral switch off, a pool that takes a box and none hand the review different words", async () => {
    const prefs = { lovejoinCollateral: false };
    const t = await wallet(20, prefs);
    const takes = await funding(sessionsOver(t, lovejoinOf(t, () => [ADA_POOL])));
    expect(takes.collateralMix).toBeUndefined();
    expect(takes.lovejoinRoom).toBe(true);
    expect(wayBack(takes)).toContain(NOTE_PLAIN);
    const u = await wallet(20, prefs);
    const none = await funding(sessionsOver(u, lovejoinOf(u, () => [])));
    expect(none.lovejoinRoom).toBeUndefined();
    expect(wayBack(none)).toContain(NOTE_HEDGED);
  });

  it("with Settings bringing sessions back directly, Review reads no pool for it", async () => {
    const t = await wallet(20, { lovejoinReturns: false });
    const from = t.koios.calls.length;
    const summary = await funding(sessionsOver(t, lovejoinOf(t, () => [ADA_POOL])));
    expect(summary.lovejoinRoom).toBeUndefined();
    expect(poolRead(t, from)).toBe(false);
    expect(wayBack(summary, false)).toContain("From the dApps page, straight into your private balance, the 5 ₳ kept aside too.");
  });

  it("a trap in that read is handed on, never built on", async () => {
    // The collateral switch off, so the collateral's own read (tailReserve) isn't the one that meets it.
    const t = await wallet(20, { lovejoinCollateral: false });
    const lj = lovejoinOf(t, () => {
      throw new WebAssembly.RuntimeError("unreachable");
    });
    await expect(funding(sessionsOver(t, lj))).rejects.toBeInstanceOf(WebAssembly.RuntimeError);
  });

  it("later: no pool at Review, one with room by the return: the hedge said held, where the direct words wouldn't have", async () => {
    const t = await wallet(0);
    let now: PoolRef[] = [];
    const sessions = sessionsOver(t, lovejoinOf(t, () => now));
    const summary = await funding(sessions);
    expect(wayBack(summary)).toContain(NOTE_HEDGED);
    now = [ADA_POOL];
    t.koios.addedToAccounts.push(...adaStrangers(20, 100));
    await funded(t);
    const back = await sessions.backBuild("preprod", 0);
    expect(back.lovejoinSkipped).toBeUndefined();
    expect(back.lovejoin!.boxes).toBeGreaterThan(0);
  });
});

describe("1.8.0's release review: the connect window's card says the spare ADA is mixed plainly only where the wallet last read room for a box (O3)", SLOW, () => {
  const floor = NETWORKS.preprod.lovejoin!.poolFloor;
  afterEach(() => {
    NETWORKS.preprod.lovejoin!.poolFloor = floor;
  });
  let sites = 0;

  /** A site asks to connect: the approval the window shows, and that its build asked Koios nothing. Declined after. */
  async function approvalOf(t: T, sessions: SessionService): Promise<Extract<DappApproval, { kind: "connect" }>> {
    const dapp = new DappService({ ...t.deps, store: t.store, sessions, lovejoin: t.lovejoin, network: () => t.networkChoice.get(), window: t.dappWindow, changed: () => undefined });
    const from = t.koios.calls.length;
    const origin = `https://site${++sites}.example`;
    const asking = dapp.call({ id: `page${sites}`, origin, title: "Example" }, "enable", []).catch(() => undefined);
    for (let i = 0; i < 200 && !dapp.approvals().length; i++) await new Promise((r) => setTimeout(r, 0));
    const [approval] = dapp.approvals();
    expect(approval?.kind).toBe("connect");
    // A connect ties no read to itself (o3-trace, o-design §3 step 6).
    expect(t.koios.calls.slice(from)).toEqual([]);
    await dapp.answer(approval!.id, false);
    await asking;
    return approval as Extract<DappApproval, { kind: "connect" }>;
  }

  it("with nothing read of the pool lately, it isn't marked, and its build asks nobody", async () => {
    const t = await wallet(20);
    const approval = await approvalOf(t, sessionsOver(t, lovejoinOf(t, () => [ADA_POOL])));
    expect(approval).not.toHaveProperty("lovejoinRoom");
  });

  it("after a review's read that found room, marked, still asking nobody; that read gone stale, not", async () => {
    const t = await wallet(20);
    const sessions = sessionsOver(t, lovejoinOf(t, () => [ADA_POOL]));
    expect((await funding(sessions)).lovejoinRoom).toBe(true);
    expect((await approvalOf(t, sessions)).lovejoinRoom).toBe(true);
    t.clock.now += POOL_ROOM_MS;
    expect(await approvalOf(t, sessions)).not.toHaveProperty("lovejoinRoom");
  });

  it("a read kept that has room for the collateral's mix but not for a box: not marked", async () => {
    const t = await wallet(5);
    const sessions = sessionsOver(t, lovejoinOf(t, () => [ADA_POOL]));
    expect((await funding(sessions)).collateralMix).toBe("ifLeft");
    expect(await approvalOf(t, sessions)).not.toHaveProperty("lovejoinRoom");
  });

  it("a read kept under the network's floor: not marked", async () => {
    NETWORKS.preprod.lovejoin!.poolFloor = 30;
    const t = await wallet(22);
    const sessions = sessionsOver(t, lovejoinOf(t, () => [ADA_POOL]));
    await funding(sessions);
    expect(await approvalOf(t, sessions)).not.toHaveProperty("lovejoinRoom");
  });

  it("no 5 ₳ pool shown: not marked", async () => {
    const t = await wallet(20);
    const sessions = sessionsOver(t, lovejoinOf(t, () => []));
    await funding(sessions);
    expect(await approvalOf(t, sessions)).not.toHaveProperty("lovejoinRoom");
  });

  it("a pool discovery hasn't kept: not marked, and discovery isn't asked as a site connects", async () => {
    // Asking it is what the find lane's fix makes a look at Koios's holder: never tied to a site's connect.
    const t = await wallet(20);
    let asked = 0;
    const sessions = sessionsOver(
      t,
      lovejoinOf(
        t,
        () => {
          asked++;
          return [ADA_POOL];
        },
        { known: async () => [] },
      ),
    );
    expect(await approvalOf(t, sessions)).not.toHaveProperty("lovejoinRoom");
    expect(asked).toBe(0);
  });
});

describe("1.8.0's release review: what the connect window and its review say, by the worker's mark (O3, W5)", () => {
  afterEach(async () => {
    seam.seeds = [];
    await i18n.changeLanguage("en");
  });

  /** The private session's card, chosen, as ConnectRequest renders it for `approval`, with Settings' `prefs`. */
  function card(approval: Partial<Extract<DappApproval, { kind: "connect" }>> = {}, prefs: Partial<Preferences> = {}): string {
    seam.seeds = [{ value: "private" }];
    const html = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(
          PreferencesContext.Provider,
          { value: { prefs: { ...DEFAULT_PREFERENCES, ...prefs }, loaded: true, set: async () => undefined } },
          createElement(ConnectRequest, {
            approval: { kind: "connect", id: "a1", origin: "https://example.org", title: "Example", password: false, ...approval },
            busy: false,
            held: false,
            onError: () => undefined,
            onAnswer: async () => false,
          }),
        ),
      ),
    );
    const line = /data-testid="dapp-private-way-back"[^>]*>(.*?)<\/li>/s.exec(html);
    expect(line, "the private session's card wasn't chosen").not.toBeNull();
    return text(line![1]!);
  }

  it("the card: its line alone where the worker's mark says the pool takes a box, the swap's hedge after it everywhere else", () => {
    expect(card({ lovejoinRoom: true })).toBe(`Bring it back from the dApps page. ${SPARE_MIXED}`);
    expect(card()).toBe(`Bring it back from the dApps page. ${SPARE_MIXED} ${HEDGE}`);
    // Settings bringing sessions back directly: the direct line, with nothing of Lovejoin's pool.
    expect(card({}, { lovejoinReturns: false })).toBe("Bring it back from the dApps page, straight into your private balance, for one network fee.");
  });

  it("the card in Spanish and Japanese: the hedge after the line, joined as each language joins sentences", async () => {
    for (const code of ["es", "ja"] as const) {
      await i18n.changeLanguage(code);
      const line = tr("dappUi.private.privacy.staysLovejoin", { box: "4.1" });
      const hedge = tr("swaps.lovejoin.privacy.onPoolShort");
      expect(card({ lovejoinRoom: true }), code).toBe(text(line));
      expect(card(), code).toBe(text(code === "ja" ? `${line}${hedge}` : `${line} ${hedge}`));
    }
  });

  it("the review: the plain notes where the mark says the pool takes a box, the hedged one everywhere else, the direct one with Settings' switch off", () => {
    expect(wayBack({ lovejoinRoom: true, collateralMix: "ifLeft" })).toContain(NOTE_MIXED);
    expect(wayBack({ lovejoinRoom: true })).toContain(NOTE_PLAIN);
    // No mark, the collateral's mix said or not: never "Lovejoin mixes the spare ADA" with nothing to qualify it.
    for (const summary of [{}, { collateralMix: "ifLeft" as const }, { collateralMix: "ifLeft" as const, collateralReserve: "2800000" }]) {
      const said = wayBack(summary);
      expect(said, JSON.stringify(summary)).toContain(NOTE_HEDGED);
      expect(said, JSON.stringify(summary)).not.toContain("hours later. The rest");
      expect(said, JSON.stringify(summary)).not.toContain("Lovejoin mixes the spare ADA in 5 ₳ boxes");
    }
    expect(wayBack({}, false)).toContain("From the dApps page, straight into your private balance, the 5 ₳ kept aside too.");
    expect(wayBack({ lovejoinRoom: true }, false)).not.toContain("Lovejoin mixes");
  });

  it("W5: no note leaves the collateral's \"5 ₳\" next to \"5 ₳ boxes\", in any language", async () => {
    // As a person reads them: the values hold "5 ₳" with a no-break space.
    const kept = { en: "the 5 ₳ kept aside", es: "los 5 ₳ apartados", ja: "確保分の 5 ₳" } as const;
    for (const code of ["en", "es", "ja"] as const) {
      await i18n.changeLanguage(code);
      for (const key of ["dappUi.back.privacy.noteLovejoin", "dappUi.back.privacy.noteLovejoinMixed"] as const) {
        expect(text(tr(key)), `${code} ${key}`).toContain(kept[code]);
      }
      // The hedged note names no collateral at all: one "5 ₳", its boxes'.
      expect(text(tr("dappUi.back.privacy.noteLovejoinPoolShort")).split("5 ₳").length - 1, code).toBe(1);
    }
  });

  it("says the 5 ₳ kept aside is mixed once, never that it's kept aside once, in any language", async () => {
    // W5 put "kept aside" before the mix's "once", which then read first as kept aside one time (1.8.0's review of its
    // fixes, r2-screens#2). Japanese keeps the count with its verb, as it did.
    const once: Record<"en" | "es" | "ja", { said: string; never?: string }> = {
      en: { said: "kept aside in a box of its own, mixed once", never: "kept aside once" },
      es: { said: "mezcla una vez los 5 ₳ apartados", never: "apartados una vez" },
      ja: { said: "専用のボックスで 1 回ミックスします" },
    };
    for (const code of ["en", "es", "ja"] as const) {
      await i18n.changeLanguage(code);
      const note = text(tr("dappUi.back.privacy.noteLovejoinMixed"));
      expect(note, code).toContain(once[code].said);
      if (once[code].never) expect(note, code).not.toContain(once[code].never);
    }
  });
});
