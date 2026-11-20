// Chunk 51, round six's words (l5words#1, l5words#2): pins of which pool reads ask Koios again about a box it hasn't
// answered for, as the privacy policy's Lovejoin row, its Koios bullet and its 19 November entry now say it, with
// privacy.md's *Lovejoin* and architecture.md's *When it asks*. Only a pool read's own count, and the 1.9.1 once-more
// ask, keep a transaction as still asked of (`asking`), for every later pool read that counts the boxes (`sortOut`).
// A take's ask Koios doesn't answer (a box's own return, a Bring one back press, Mix my boxes again) isn't kept: the
// next take asks again. While a box waits for that answer in a current pool, with no due time, each such read asks
// about the pool's other boxes no record or answer names too, in the same request; in a retired pool, where nothing
// waits, it doesn't. Bring every box back now's run asks nothing. The lead's calls of round six: these are words, so
// the code stays as it is, and these tests hold it to what the words say.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { BRING_RUN_MS, LovejoinService } from "../src/background/lovejoin";
import { NETWORKS } from "../src/networks";
import { CHAINS, HOUR, lovejoinOf, POOL, publicFunded, withSession, type Tested } from "./chain-fixtures";
import { preprodAddress } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm } from "./fakes";
import { ADA, ADA_POOL, adaBox, madeByAdaMix, ownDatum, retiredAlready } from "./v2-pools";

const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
/** A box in the 5 ₳ pool that the wallet's Seedelf key owns, at `tx#0`. */
const adaOwned = async (t: Tested, tx: string) => adaBox(hash(tx), await ownDatum(t.wallet), t.clock.now, 5, 0);
/** A box in Lovejoin's classic pool, retired, that the wallet's Seedelf key owns, at `tx#0`. */
async function classicOwned(t: Tested, tx: string): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  return { ...POOL[0]!, tx_hash: hash(tx), tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
}
const input = (cred: string, bech32: string) => ({ payment_addr: { bech32, cred } });
/** A mix in the classic pool: a box spent at its mix_box, and whoever paid for it. */
const classicMix = () => [input(NETWORKS.preprod.lovejoin!.mixBox, POOL[0]!.address), input("ee".repeat(28), preprodAddress("ee".repeat(28)))];
/** A deposit someone else paid. */
const paidBy = (cred: string) => [input(cred, preprodAddress(cred))];
/** A schedule of `due` times for the 5 ₳ pool's boxes, and nothing else. */
const adaSchedule = (due: number[]) => ({ due: [], pools: { [ADA]: { due } }, chains: [] });
/** Every tx_info request Koios was asked, the hashes each asked for. */
const txInfoAsked = (t: Tested) => t.koios.calls.filter((c) => c.path === "tx_info").map((c) => [...(c.body._tx_hashes as string[])].sort());
const asking = async (t: Tested) => (await t.store.get<{ asking?: Record<string, number> }>("lovejoin.preprod"))?.asking;
/** The boxes a withdraw giveme.my was asked about spends. */
const withdrawn = (t: Tested) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));

/** Lovejoin with giveme.my's witness stood in for, as lovejoin-restore.test.ts's: its recorded answer is another transaction's. */
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
  });
}

/** Koios's tx_info fails with a 500 while `down.on`, and is counted. */
function flakyTxInfo(t: Tested) {
  const down = { on: true, asked: 0 };
  const fetch = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    if (url.includes("/tx_info")) {
      down.asked++;
      if (down.on) return new Response("upstream", { status: 500 });
    }
    return fetch(url, init);
  };
  return down;
}

/** A wallet in its steady state: B and C in the 5 ₳ pool, a due time each, no record of what made them, Koios down. */
async function steady() {
  const { t } = await withSession("40000000");
  const [B, C] = [hash("ba"), hash("ca")];
  t.koios.addedToAccounts.push(await adaOwned(t, B), await adaOwned(t, C));
  await t.store.set("lovejoin.preprod", adaSchedule([t.clock.now + HOUR, t.clock.now + 30 * HOUR]));
  return { t, B, C, koios: flakyTxInfo(t) };
}

/** Koios answers again, a mix made each of `txs`: how many tx_info requests opening Lovejoin's page then makes. */
async function pageAsks(t: Tested, koios: { on: boolean; asked: number }, ...txs: string[]) {
  koios.on = false;
  madeByAdaMix(t.koios, ...txs);
  const before = koios.asked;
  await t.lovejoin.status("preprod");
  return koios.asked - before;
}

describe("chunk 51, l5words#2: an ask Koios didn't answer is kept for the pool reads only where a pool read's count made it", CHAINS, () => {
  it("a box its own return asked about alone, which Koios didn't answer, isn't asked about again when Lovejoin's page opens", async () => {
    const { t, B, C, koios } = await steady();
    const lovejoin = witnessed(t);
    for (let run = 0; run * 2 < 6; run++) {
      await lovejoin.withdrawDue("preprod", run === 0);
      await busyFor(t, 2 * HOUR);
    }
    expect(t.collateral.asked).toEqual([]);
    expect(koios.asked).toBeGreaterThan(0);
    expect(await asking(t)).toBeUndefined();
    // The policy: "one the server doesn't answer for at these last three is asked about again at the next of them,
    // not at each pool read".
    expect(await pageAsks(t, koios, B, C)).toBe(0);
  });

  it("a box a Bring one back now press asked about, which Koios didn't answer, isn't asked about again when Lovejoin's page opens; the next press asks again", async () => {
    const { t, B, C, koios } = await steady();
    await expect(t.lovejoin.withdrawNow("preprod")).rejects.toThrow("The server hasn't said how some of your boxes went in");
    const pressed = koios.asked;
    expect(pressed).toBeGreaterThan(0);
    expect(await asking(t)).toBeUndefined();
    expect(await pageAsks(t, koios, B, C)).toBe(0);
    await busyFor(t, 60_000);
    await witnessed(t).withdrawNow("preprod");
    expect(koios.asked).toBeGreaterThan(pressed);
    expect(withdrawn(t)).toHaveLength(1);
  });

  it("a box Mix my boxes again's review asked about, which Koios didn't answer, isn't asked about again when Lovejoin's page opens", async () => {
    const { t, B, C, koios } = await steady();
    await expect(t.lovejoin.againBoxes("preprod", false, ADA)).rejects.toThrow("The server hasn't said how some of your boxes went in yet");
    expect(koios.asked).toBeGreaterThan(0);
    expect(await asking(t)).toBeUndefined();
    expect(await pageAsks(t, koios, B, C)).toBe(0);
  });

  it("control: boxes a restore's pool read asked about (no due times), which Koios didn't answer, are asked about again when Lovejoin's page opens next", async () => {
    const { t } = await withSession("40000000");
    const [B, C] = [hash("ba"), hash("ca")];
    t.koios.addedToAccounts.push(await adaOwned(t, B), await adaOwned(t, C));
    const koios = flakyTxInfo(t);
    await t.lovejoin.status("preprod");
    expect(Object.keys((await asking(t)) ?? {}).sort()).toEqual([B, C].sort());
    expect(await pageAsks(t, koios, B, C)).toBeGreaterThan(0);
  });

  for (const [button, pool] of [
    ["Bring every box back now", undefined],
    ["Bring every box in this pool back now", ADA],
  ] as const) {
    it(`${button}'s run takes a box a pool read is still asking about, and asks nothing`, async () => {
      const { t } = await withSession("40000000");
      const U = hash("e5");
      t.koios.addedToAccounts.push(await adaOwned(t, U));
      await t.lovejoin.status("preprod");
      expect(Object.keys((await asking(t)) ?? {})).toEqual([U]);
      const lovejoin = witnessed(t);
      await busyFor(t, 60_000);
      await lovejoin.bringAllBack("preprod", pool);
      const before = txInfoAsked(t).length;
      await lovejoin.withdrawDue("preprod");
      // The policy: "take a box without that question, and their own pool reads don't ask it either".
      expect(withdrawn(t)).toEqual([`${U}#0`]);
      expect(txInfoAsked(t).slice(before)).toEqual([]);
    });
  }
});

/**
 * After a restore: Koios says a mix made F and doesn't answer for U (or, with `told`, says something else of it). Then
 * someone else's mix moves F, leaving M3, with no record, F's due time kept. What the next read asks Koios.
 */
async function restoredThenMoved(told?: (t: Tested, U: string) => void) {
  const t = await publicFunded();
  const lj = lovejoinOf(t, { sessionIndices: async () => [0] });
  const [F, U, M3] = [hash("f4"), hash("e4"), hash("d4")];
  const f = await adaOwned(t, F);
  t.koios.addedToAccounts.push(f, await adaOwned(t, U));
  madeByAdaMix(t.koios, F);
  told?.(t, U);
  await lj.status("preprod");
  const waiting = Object.keys((await asking(t)) ?? {});
  const first = txInfoAsked(t).length;
  t.koios.addedToAccounts.splice(t.koios.addedToAccounts.indexOf(f), 1);
  t.koios.addedToAccounts.push(await adaOwned(t, M3));
  madeByAdaMix(t.koios, M3);
  await lj.status("preprod");
  return { asked: txInfoAsked(t).slice(first), waiting, U, M3 };
}

describe("chunk 51, l5words#1: while a box waits for Koios's answer, each pool read asks about the pool's other unrecorded boxes with it", CHAINS, () => {
  it("U waits, with no due time: the next read sends M3 with U, in one request, as the policy's row, Koios bullet and entry say", async () => {
    const { asked, waiting, U, M3 } = await restoredThenMoved();
    expect(waiting).toEqual([U]);
    expect(asked).toEqual([[M3, U].sort()]);
  });

  it("control: U answered (a deposit someone else paid, held with no due time too), the same move asks nothing", async () => {
    const { asked, waiting } = await restoredThenMoved((t, U) => t.koios.txSpends.set(U, paidBy("ee".repeat(28))));
    expect(waiting).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("Bring one back anyway's press while N waits: its pool read sends M3 with N, as every later pool read does", async () => {
    const { t } = await withSession("40000000");
    const [M, N, M3] = [hash("b5"), hash("c5"), hash("a5")];
    const m = await adaOwned(t, M);
    t.koios.addedToAccounts.push(m, await adaOwned(t, N));
    madeByAdaMix(t.koios, M);
    await t.lovejoin.status("preprod");
    expect(Object.keys((await asking(t)) ?? {})).toEqual([N]);
    t.koios.addedToAccounts.splice(t.koios.addedToAccounts.indexOf(m), 1);
    t.koios.addedToAccounts.push(await adaOwned(t, M3));
    madeByAdaMix(t.koios, M3);
    await busyFor(t, 60_000);
    const before = txInfoAsked(t).length;
    await witnessed(t).withdrawNow("preprod", { txHash: N, txIndex: 0, pool: ADA }, true);
    expect(txInfoAsked(t).slice(before)).toEqual([[M3, N].sort()]);
    expect(withdrawn(t)).toEqual([`${N}#0`]);
  });

  it("in a retired pool, where nothing waits, a box Koios hasn't answered for gets a due time, and the next read asks about it alone", async () => {
    const { t } = await withSession("40000000");
    await retiredAlready(t.store);
    const [F, U, M3] = [hash("f6"), hash("e6"), hash("d6")];
    const f = await classicOwned(t, F);
    t.koios.addedToAccounts.push(f, await classicOwned(t, U));
    t.koios.txSpends.set(F, classicMix());
    await t.lovejoin.status("preprod");
    expect(Object.keys((await asking(t)) ?? {})).toEqual([U]);
    const first = txInfoAsked(t).length;
    t.koios.addedToAccounts.splice(t.koios.addedToAccounts.indexOf(f), 1);
    t.koios.addedToAccounts.push(await classicOwned(t, M3));
    t.koios.txSpends.set(M3, classicMix());
    await t.lovejoin.status("preprod");
    // The policy: "while it waits for that answer in one of Lovejoin's current pools": a retired pool's sweeps nothing.
    expect(txInfoAsked(t).slice(first)).toEqual([[U]]);
  });
});

/** When the pools are owed a read (`recheck`), if they are. */
const recheckOf = async (t: Tested) => (await t.store.get<{ recheck?: number }>("lovejoin.preprod"))?.recheck;

/** giveme.my's first witness takes a whole run (BRING_RUN_MS): a run of Bring every box back sends one box and ends there. */
function slowFirstWitness(t: Tested) {
  const fetch = t.collateral.fetch;
  let first = true;
  t.collateral.fetch = async (url, init) => {
    if (first) {
      first = false;
      t.clock.now += BRING_RUN_MS;
    }
    return fetch(url, init);
  };
}

// Chunk 51, l6words#4: the policy's lists of the pool reads that ask again left out the Lovejoin page's Refresh and its
// read after each thing done there (Lovejoin.tsx `load`, the only `lovejoin-status` caller), and the read the alarm owes
// once a run of Bring every box back stops (`recheck`, withdrawDueNow's `sortOut`), which asks as every pool read does.
describe("chunk 51, l6words#4: the Lovejoin page's every read and the read owed once a run stops ask again", CHAINS, () => {
  it("the Lovejoin page's Refresh, its next read, asks again about a box its first read asked about", async () => {
    const { t } = await withSession("40000000");
    const U = hash("e8");
    t.koios.addedToAccounts.push(await adaOwned(t, U));
    await t.lovejoin.status("preprod");
    expect(Object.keys((await asking(t)) ?? {})).toEqual([U]);
    const opened = txInfoAsked(t).length;
    await busyFor(t, 60_000);
    await t.lovejoin.status("preprod");
    expect(txInfoAsked(t).slice(opened)).toEqual([[U]]);
  });

  for (const [run, pool, retired] of [
    ["Bring every box back now", undefined, false],
    ["Bring every box in this pool back now, the classic pool's", "classic", false],
    ["the retired pools' run", undefined, true],
  ] as const) {
    it(`${run}, stopped after one withdraw: its own reads ask nothing, and the read owed 2 hours on asks again`, async () => {
      const { t } = await withSession("40000000");
      await retiredAlready(t.store);
      // U waits for Koios's answer in the 5 ₳ pool. Beside it, for every pool's run, V waits too, so whichever the run
      // leaves is asked of; for the classic pool's run and the retired pools', W, in the classic pool, a mix made.
      const [U, V, W] = [hash("e9"), hash("d9"), hash("c9")];
      t.koios.addedToAccounts.push(await adaOwned(t, U));
      if (pool === undefined && !retired) t.koios.addedToAccounts.push(await adaOwned(t, V));
      else {
        t.koios.addedToAccounts.push(await classicOwned(t, W));
        t.koios.txSpends.set(W, classicMix());
      }
      await t.lovejoin.status("preprod");
      const waiting = Object.keys((await asking(t)) ?? {}).sort();
      expect(waiting).toEqual(pool === undefined && !retired ? [U, V].sort() : [U]);
      const lovejoin = witnessed(t);
      await busyFor(t, 60_000);
      await lovejoin.bringAllBack("preprod", pool, retired);
      const before = txInfoAsked(t).length;
      slowFirstWitness(t);
      await lovejoin.withdrawDue("preprod");
      const sent = withdrawn(t);
      expect(sent).toHaveLength(1);
      if (pool !== undefined || retired) expect(sent).toEqual([`${W}#0`]);
      const left = waiting.filter((x) => `${x}#0` !== sent[0]);
      expect(left).toHaveLength(1);
      // The policy: "take a box without that question, and their own pool reads don't ask it either".
      expect(txInfoAsked(t).slice(before)).toEqual([]);
      await lovejoin.stopBringingAllBack("preprod");
      expect(await recheckOf(t)).toBeGreaterThan(t.clock.now);
      for (const box of sent) t.koios.spent.add(box);
      for (let minute = 0; minute < 3; minute++) {
        await busyFor(t, 60_000);
        await lovejoin.withdrawDue("preprod");
      }
      expect(txInfoAsked(t).slice(before)).toEqual([]);
      // No box due anywhere, and no unlock: only the read owed once the run stopped, which asks again, as every pool
      // read that counts the boxes does (the policy's "2 hours after **Bring every box back now**, **Bring every box in
      // this pool back now** or the retired pools' run stops having sent a box"; chunk 51, l8words#8).
      await busyFor(t, 2 * HOUR);
      await lovejoin.withdrawDue("preprod");
      expect(txInfoAsked(t).slice(before)).toEqual([left]);
      expect(await recheckOf(t)).toBeUndefined();
    });
  }
});

type Sealed = { asking?: Record<string, number>; bringing?: { back: number; retired?: true }; due?: number[] };
const sealed = async (t: Tested) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

/** Three hours of the alarm's runs, one every ten minutes, with no unlock among them. */
async function threeHours(t: Tested, lovejoin: LovejoinService) {
  for (let run = 0; run < 18; run++) {
    await busyFor(t, 10 * 60_000);
    await lovejoin.withdrawDue("preprod");
  }
}

// Chunk 51, l7words#2: the policy's list of the reads that ask again named reads that come only sometimes as if they
// always came. Those the wallet owes once a run of Bring every box back is over come only where the list now says: 2
// hours after a run that sent a box stops (l6words#4's pins, above), but for the retired pools' run where it let go
// 1.7's count of boxes not mixed yet, or a 1.7 Bootstrap, at the next run once it ends or stops instead, whatever it
// sent (retireOnce's `recheck`, owed at once). Elsewhere none is owed. The cases below end by themselves, and their
// read is asked for at the next run, not only within three hours (chunk 51, l8words#3); a stop's is
// lovejoin-round2-retire's (r2-critic#0).
describe("chunk 51, l7words#2: a read owed once a run of Bring every box back is over comes only where the list says", CHAINS, () => {
  it("Bring every box back now, stopped having sent nothing: no read is owed, and none asks in the 3 hours after", async () => {
    const { t } = await withSession("40000000");
    await retiredAlready(t.store);
    const [U, V] = [hash("e9"), hash("d9")];
    t.koios.addedToAccounts.push(await adaOwned(t, U), await adaOwned(t, V));
    await t.lovejoin.status("preprod");
    expect(Object.keys((await asking(t)) ?? {}).sort()).toEqual([U, V].sort());
    const lovejoin = witnessed(t);
    // giveme.my at its limit: the run sends nothing.
    t.collateral.answer = { status: 429, body: {} };
    await busyFor(t, 60_000);
    await lovejoin.bringAllBack("preprod");
    const before = txInfoAsked(t).length;
    await lovejoin.withdrawDue("preprod");
    expect((await sealed(t)).bringing?.back).toBe(0);
    await lovejoin.stopBringingAllBack("preprod");
    expect(await recheckOf(t)).toBeUndefined();
    await threeHours(t, lovejoin);
    expect(txInfoAsked(t).slice(before)).toEqual([]);
  });

  for (const letGo of ["nothing", "count", "bootstrap"] as const) {
    const owed = letGo !== "nothing";
    const what = letGo === "count" ? "1.7's count of boxes not mixed yet" : "a 1.7 Bootstrap";
    it(`the retired pools' run, ${owed ? `where it let go ${what}: the read comes at the next run once it ends, asks again, and nothing more asks in the 3 hours after` : "where it let go nothing of 1.7's: no read is owed as it ends, and none asks in the 3 hours after"}`, async () => {
      const { t } = await withSession("40000000");
      // U waits for Koios's answer in the 5 ₳ pool. W, in the retired classic pool, has its due time: a mix made it,
      // or it's a 1.7 Bootstrap's deposit's box (lovejoin-round2-retire's bootstrapBy17), which a retired pool doesn't
      // hold (sortOut's `waits`), though the Bootstrap isn't let go until the first run.
      const [U, W] = [hash("e7"), hash("c7")];
      t.koios.addedToAccounts.push(await adaOwned(t, U), await classicOwned(t, W));
      if (letGo === "bootstrap") {
        t.koios.txSpends.set(W, paidBy("ab".repeat(28)));
        await t.store.set("lovejoin.preprod", {
          due: [],
          chains: [],
          mixes: [{ id: W, deposit: W, at: t.clock.now - HOUR, account: 0, bootstrap: true, found: true, shares: [{ boxes: 1 }] }],
        });
      } else t.koios.txSpends.set(W, classicMix());
      await t.lovejoin.status("preprod");
      const read = await sealed(t);
      expect(Object.keys(read.asking ?? {})).toEqual([U]);
      expect(read.due).toHaveLength(1);
      if (letGo === "count") await t.store.set("lovejoin.preprod", { ...read, notMixed: 1 });
      const lovejoin = witnessed(t);
      await busyFor(t, 60_000);
      const before = txInfoAsked(t).length;
      // The first run on 1.8.0 or later retires the classic pool and brings W back.
      await lovejoin.withdrawDue("preprod");
      expect((await sealed(t)).bringing).toMatchObject({ retired: true, back: 1 });
      expect(withdrawn(t)).toEqual([`${W}#0`]);
      // retireOnce owes the read at once where it let go 1.7's, and none where it didn't.
      if (owed) expect(await recheckOf(t)).toBeLessThanOrEqual(t.clock.now);
      else expect(await recheckOf(t)).toBeUndefined();
      t.koios.spent.add(`${W}#0`);
      for (let run = 0; run < 5 && (await sealed(t)).bringing; run++) {
        await busyFor(t, 60_000);
        await lovejoin.withdrawDue("preprod");
      }
      expect((await sealed(t)).bringing).toBeUndefined();
      // Its own reads asked nothing. The read owed comes at the next run, a minute after it ended, not 2 hours on.
      expect(txInfoAsked(t).slice(before)).toEqual([]);
      await busyFor(t, 60_000);
      await lovejoin.withdrawDue("preprod");
      expect(txInfoAsked(t).slice(before)).toEqual(owed ? [[U]] : []);
      expect(await recheckOf(t)).toBeUndefined();
      await threeHours(t, lovejoin);
      expect(txInfoAsked(t).slice(before)).toEqual(owed ? [[U]] : []);
    });
  }
});
