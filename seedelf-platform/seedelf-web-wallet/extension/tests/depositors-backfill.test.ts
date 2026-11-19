// Chunk 51, round three's last look, l3time#2. 1.9.1 kept whose deposit a box was (`depositors`) for a public account
// alone, and dropped a private Bootstrap's record 3 h after it ended, its entry still open. Round three fills that in
// from the open entry (the session that paid), but only inside sortOut, which only some runs reach: a Bring every box
// back run asked before the update, a withdraw maybe-sent at the update that settles first, and a 1.7 profile's first
// run, the retired pools' run, each counted another box back to the released Bootstrap first. Its entry closed, and its
// own deposit's box came back as a box of unknown making, `box:<w>+unknown:<w>`, which a stealth mint takes before
// change and money made private, where it is session 4's money. The fill now runs on every write (update), keeping
// nothing new: the entry names that session already.
//
// Driven through the worker's services with the real WebAssembly, the classes it's sent all ones it already reads.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import type { HistoryClass } from "../src/shared/histories";
import { CHAINS, HOUR, POOL, withSession, type Tested } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm } from "./fakes";
import { ADA, ADA_POOL, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
const inAda = (txHash: string, txIndex = 0) => ({ txHash, txIndex, pool: ADA });
type Entry = { txHash: string; kind: string; lovelace: string; origin?: HistoryClass };
const entryOf = async (t: Tested, txHash: string) =>
  (await t.store.get<{ entries: Entry[] }>("history.preprod"))!.entries.find((e) => e.txHash === txHash);
type Kept = { chains: unknown[]; mixes?: Array<{ id: string }>; depositors?: Record<string, unknown>; withdrawing?: { txHash: string } };
const schedule = async (t: Tested) => (await t.store.get<Kept>("lovejoin.preprod"))!;
/** The withdraws sent that spend `box`, by transaction id, in the order sent. */
const withdrawOf = (t: Tested, box: string) =>
  t.koios.submitted.map((b) => ({ id: txIdOf(b), inputs: txInputs(b) })).filter((w) => w.inputs.includes(box));
const sentAt = (t: Tested, id: string) => t.koios.submitted.findIndex((b) => txIdOf(b) === id);
/** Session 4's money, the box its own deposit put in: what rule 1 (b) brings it back as. */
const session4 = (w: string): HistoryClass => ({ id: `box:${w}+session:4`, origin: "session" });

/** Lovejoin on `t`'s fakes, reading the 5 ₳ pool (and the classic pool), giveme.my's witness stood in for. */
function witnessed(t: Tested) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [ADA_POOL],
    sessionIndices: async () => [0],
  });
}

/**
 * As 1.9.1 leaves it: E, session 4's private Bootstrap, its record gone, its entry open with 1 box at its deposit D,
 * released, its leaf kept, and no depositor kept. X, a box another's mix made, is listed before D.
 */
async function as191(t: Tested, D: string, R: string, X: string, extra: Record<string, unknown> = {}) {
  const at = t.clock.now - 30 * HOUR;
  const entry = { id: R, deposit: D, at, session: 4, bootstrap: true, found: true, released: true, shares: [{ pool: ADA, boxes: 1 }] };
  const datum = await ownDatum(t.wallet);
  t.koios.addedToAccounts.push(adaBox(X, datum, t.clock.now), adaBox(D, datum, t.clock.now, 30));
  madeByAdaMix(t.koios, X);
  await t.store.set("lovejoin.preprod", {
    due: [],
    chains: [],
    retired: t.clock.now - 300 * HOUR,
    mixes: [entry],
    leaves: { [`${D}#0`]: "session.4" },
    ...extra,
  });
}

/** Runs the due withdraws until D's has gone: X first, then D, as the run takes them. */
async function bothBack(t: Tested, lj: LovejoinService, X: string, D: string) {
  await lj.withdrawDue("preprod");
  if (!withdrawOf(t, `${D}#0`).length) await lj.withdrawDue("preprod");
  const [x] = withdrawOf(t, `${X}#0`);
  const [d] = withdrawOf(t, `${D}#0`);
  expect(x, "X's withdraw").toBeDefined();
  expect(d, "D's withdraw").toBeDefined();
  expect(sentAt(t, x!.id), "X's withdraw sent before D's").toBeLessThan(sentAt(t, d!.id));
  return d!.id;
}

describe("a released private Bootstrap's box, its entry still open as 1.9.1 left it (chunk 51, l3time#2)", CHAINS, () => {
  it("Bring every box back asked before the update, the run going on after it: D's way back is session 4's money", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const [D, R, X] = [hash("e5"), hash("e6"), hash("f7")];
    await as191(t, D, R, X, { bringing: { at: t.clock.now - 60_000, back: 0 } });
    const lj = witnessed(t);
    const d = await bothBack(t, lj, X, D);
    expect((await entryOf(t, d))!.origin).toEqual(session4(d));
  });

  it("a withdraw of X maybe-sent at the update settles first, in Bring one back: D's way back is session 4's money", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const [D, R, X] = [hash("e8"), hash("e9"), hash("f8")];
    await as191(t, D, R, X);
    const lj = witnessed(t);
    // X's withdraw reaches Koios, which answers 503: maybe sent, kept as such.
    const fetch = t.koios.fetch;
    let busy = true;
    t.koios.fetch = async (url, init) => {
      if (busy && url.endsWith("/submittx")) {
        busy = false;
        await fetch(url, init);
        return new Response("upstream", { status: 503 });
      }
      return fetch(url, init);
    };
    await expect(lj.withdrawNow("preprod", inAda(X))).rejects.toThrow();
    t.koios.fetch = fetch;
    expect((await schedule(t)).withdrawing?.txHash).toBeDefined();
    // As 1.9.1 left it: its read ran no sortOut of this release's, so no depositor was kept.
    const { depositors: _, ...was } = (await t.store.get<Record<string, unknown>>("lovejoin.preprod"))!;
    await t.store.set("lovejoin.preprod", was);
    t.koios.confirmations = 1;
    t.clock.now += 60_000;
    const back = await lj.withdrawNow("preprod", inAda(D));
    expect((await entryOf(t, back.txHash))!.origin).toEqual(session4(back.txHash));
  });

  it("a 1.7 profile, its first run the retired pools' run (retireOnce): the classic pool's D#0 is session 4's money", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const [D, R, X] = [hash("ec"), hash("ed"), hash("fa")];
    const at = t.clock.now - 30 * HOUR;
    const entry = { id: R, deposit: D, at, session: 4, bootstrap: true, found: true, shares: [{ boxes: 1 }] };
    const datum = await ownDatum(t.wallet);
    const row = (tx: string, hours: number) =>
      ({ ...POOL[0]!, tx_hash: tx, tx_index: 0, block_time: Math.floor(t.clock.now / 1000) - hours * 3600, inline_datum: { bytes: datum, value: {} } }) as KoiosUtxo;
    t.koios.addedToAccounts.push(...POOL, row(X, 5), row(D, 30));
    await t.store.set("lovejoin.preprod", { due: [], chains: [], mixes: [entry], leaves: { [`${D}#0`]: "session.4" } });
    const lj = witnessed(t);
    const d = await bothBack(t, lj, X, D);
    expect((await entryOf(t, d))!.origin).toEqual(session4(d));
  });

  it("the same state with the Lovejoin page opened first (status, which sorts out the record) is session 4's money (a pin)", async () => {
    const { t } = await withSession("40000000");
    await t.balances.get("preprod");
    const [D, R, X] = [hash("e2"), hash("e3"), hash("f2")];
    await as191(t, D, R, X, { bringing: { at: t.clock.now - 60_000, back: 0 } });
    const lj = witnessed(t);
    await lj.status("preprod");
    const d = await bothBack(t, lj, X, D);
    expect((await entryOf(t, d))!.origin).toEqual(session4(d));
  });
});
