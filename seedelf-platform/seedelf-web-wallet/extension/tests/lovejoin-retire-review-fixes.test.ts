// 1.8.0's release review, the retire lane: the first unlock's bring-back and the retired pools, as the owner's calls of
// 2026-11-05 and 2026-11-06 have them. The first run widens a retired pool's run 1.7 left going to the retired pools'
// (R1), marks the chains the update cut before it ends their tails (R2), and decides nothing on a read that lacks a
// pool a record names (R3). Settings' Try again asks the retired pools' run again, never every pool's (R4). Home no
// longer counts 1.7's boxes not mixed yet there (critic#3), and the run passes over a box someone else's mix moved only
// for a chain of the wallet's that mixes in its pool (critic#5). A mix from the public account in a retired pool is
// refused before anything is read (R8). And the guards no moved test reached, each failing under its mutant (R5, S3).
// With the real WebAssembly, the classic pool's recorded preprod boxes, PR #163's 8131b1d token pool, 1.7's 8131b1d
// 5 ₳ pool, and v2's 5 ₳ pool (v2-pools.ts).
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { handle, type Context } from "../src/background/handlers";
import type { KoiosUtxo } from "../src/background/koios";
import { BRING_FAILED_RUNS, CLASSIC, LovejoinService, type LovejoinDeps, type PoolRef } from "../src/background/lovejoin";
import { t as tr } from "../src/i18n";
import bundled from "../src/lovejoin-pools.json";
import { NETWORKS } from "../src/networks";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinHeld, Message } from "../src/shared/rpc";
import { BringAllBackQuestion, BringAllBackView, bringAsk, bringFollower, doneOf, doneShown } from "../src/ui/components/BringAllBack";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { InLovejoin } from "../src/ui/screens/Home";
import { account, AGREES, atSession, PASSWORD, POOL, publicFunded, sessionsOf } from "./chain-fixtures";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, epochParams, loadTestWasm, testBalances } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum, retiredAlready, strangerDatum } from "./v2-pools";

/** Real chains and withdraws are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 300_000 };

const HOUR = 3_600_000;
const CLASSIC_BOX = NETWORKS.preprod.lovejoin!.mixBox;

/** PR #163's token pool on preprod, on 8131b1d's scripts: retired. */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const OLD_TOKEN_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };
const OLD_VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: OLD_TOKEN_POOL }))) as {
  id: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const OLD_TOKEN = OLD_VIEW.id;
const OLD_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(OLD_VIEW.mixBoxHash, "hex")]));

/** Preprod's 5 ₳ ADA pool as 1.7 bundled it, on 8131b1d's scripts: retired. */
const OLD_FIVE = (bundled.preprod.pools.find((p) => p.boxLovelace === "5000000" && !("version" in p && p.version === "v2")) as unknown as { ref: PoolRef }).ref;
const OLD_FIVE_VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: OLD_FIVE }))) as {
  id: string;
  mixBoxHash: string;
  version: string;
};
const OLD_FIVE_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(OLD_FIVE_VIEW.mixBoxHash, "hex")]));

type T = ReturnType<typeof testBalances>;

/** Lovejoin reading `pools` beside the classic pool, giveme.my's witness stood in for. */
function pooled(t: T, pools: PoolRef[] = [ADA_POOL], extra: Partial<LovejoinDeps> = {}): LovejoinService {
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
    pools: async () => pools,
    random: () => 0.5,
    ...extra,
  });
}

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = AGREES;
  return t;
}

/** A box of the wallet's in the classic pool at `tx#index`, a mix there having made it `hours` ago. */
async function classicBox(t: T, tx: string, hours = 5, index = 0): Promise<KoiosUtxo> {
  const hash = tx.length === 64 ? tx : tx.repeat(32);
  t.koios.txSpends.set(hash, [{ payment_addr: { bech32: POOL[0]!.address, cred: CLASSIC_BOX } }]);
  return {
    ...POOL[0]!,
    tx_hash: hash,
    tx_index: index,
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    inline_datum: { bytes: await ownDatum(t.wallet), value: {} },
  } as KoiosUtxo;
}

/** A box of the wallet's in PR #163's 8131b1d token pool, a mix there having made it `hours` ago. */
async function oldTokenBox(t: T, tx: string, hours = 5): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: OLD_ADDRESS, cred: OLD_VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address: OLD_ADDRESS,
    payment_cred: OLD_VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: await ownDatum(t.wallet), value: {} },
    asset_list: [{ policy_id: OLD_VIEW.token.policyId, asset_name: OLD_VIEW.token.assetName, quantity: OLD_VIEW.token.quantity, decimals: 0, fingerprint: "" } as never],
  } as KoiosUtxo;
}

/** A box in 1.7's 8131b1d 5 ₳ pool: the wallet's (`datum` its own) or a stranger's, made `hours` before `now`. */
function oldFiveBox(tx: string, datum: string, now: number, hours = 5, index = 0): KoiosUtxo {
  return {
    ...POOL[0]!,
    tx_hash: tx.length === 64 ? tx : tx.repeat(32),
    tx_index: index,
    address: OLD_FIVE_ADDRESS,
    payment_cred: OLD_FIVE_VIEW.mixBoxHash,
    value: "5000000",
    block_time: Math.floor(now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: datum, value: {} },
    asset_list: [],
  } as KoiosUtxo;
}

/** A box of the wallet's in v2's 5 ₳ pool, a mix there having made it `hours` ago. */
async function fiveBox(t: T, tx: string, hours = 5, index = 0): Promise<KoiosUtxo> {
  madeByAdaMix(t.koios, tx.length === 64 ? tx : tx.repeat(32));
  return adaBox(tx, await ownDatum(t.wallet), t.clock.now, hours, index);
}

/** The boxes the withdraws giveme.my was asked about spend, `txhash#index`. */
const withdrawn = (t: T) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));
const at = (u: KoiosUtxo) => `${u.tx_hash}#${u.tx_index}`;

/** What a withdraw sent spent no longer lists: on chain. */
function landed(t: T): void {
  const gone = new Set(withdrawn(t));
  const kept = t.koios.addedToAccounts.filter((u) => !gone.has(at(u)));
  t.koios.addedToAccounts.splice(0, t.koios.addedToAccounts.length, ...kept);
}

type Sealed = {
  due: number[];
  notMixed?: number;
  unsure?: number;
  recheck?: number;
  pools?: Record<string, { due: number[]; notMixed?: number; unsure?: number }>;
  retired?: number;
  bringing?: { at: number; back: number; pool?: string; retired?: true; waiting?: string; left?: number; stopped?: true };
  bringStopped?: { back: number; pool?: string; retired?: true };
  mixes?: Array<{ id: string; bootstrap?: true; released?: true; shares: Array<{ pool?: string; boxes: number }> }>;
  chains: Array<{ id: string; ended?: number; cut?: true; tail?: { over?: true } }>;
};
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

/** A 1.7 session's chain, its collateral's deposit in 1.7's 5 ₳ pool (`tail`) and its mix not sent, as its record has it. */
function tailChain(t: T, more: Record<string, unknown> = {}) {
  return {
    id: "e9".repeat(32),
    at: t.clock.now - 30 * 60_000,
    session: 0,
    progress: "seedelf.sessionChain.preprod.0",
    deposit: "a0".repeat(32),
    mixes: ["a1".repeat(32)],
    total: 4,
    sent: 3,
    boxes: 2,
    leaves: [
      { txHash: "a1".repeat(32), txIndex: 0 },
      { txHash: "a1".repeat(32), txIndex: 1 },
      { txHash: "e3".repeat(32), txIndex: 0, pool: OLD_FIVE_VIEW.id },
    ],
    scheduled: true,
    tail: {
      deposit: "e2".repeat(32),
      mix: "e3".repeat(32),
      pool: OLD_FIVE_VIEW.id,
      box: { txHash: "e2".repeat(32), txIndex: 0, pool: OLD_FIVE_VIEW.id },
      leaf: { txHash: "e3".repeat(32), txIndex: 0, pool: OLD_FIVE_VIEW.id },
      tries: 1,
      landed: t.clock.now - 10 * 60_000,
    },
    ...more,
  };
}

/** A Bootstrap of `boxes` boxes in pool `pool` (none: the classic pool), its deposit `deposit` in: its list entry. */
const bootstrapEntry = (t: T, deposit: string, boxes: number, pool?: string) => ({
  id: deposit,
  deposit,
  at: t.clock.now - HOUR,
  account: 0,
  bootstrap: true,
  found: true,
  shares: [{ ...(pool ? { pool } : {}), boxes }],
});

describe("1.8.0's first unlock while a run 1.7 left goes (1.8.0's release review, R1)", SLOW, () => {
  it("widens a retired pool's page's run to the retired pools', keeping when it was asked: each retired pool's box comes back at once, a v2 pool's waits", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL, OLD_TOKEN_POOL]);
    const classic = await classicBox(t, "c1");
    const token = await oldTokenBox(t, "d1");
    const kept = await fiveBox(t, "f1");
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, classic, token, kept);
    // 1.7's read: each box has its due time, hours away.
    await lj.status("preprod");
    // 1.7.2 was bringing back the old token pool's boxes from its page when the update came.
    const asked = t.clock.now - 60_000;
    await t.store.set("lovejoin.preprod", { ...(await sealed(t)), bringing: { at: asked, back: 0, pool: OLD_TOKEN } });
    await lj.withdrawDue("preprod", true);
    const after = await sealed(t);
    expect(after.retired).toBe(t.clock.now);
    expect(after.bringing).toMatchObject({ at: asked, retired: true, back: 2 });
    expect(after.bringing?.pool).toBeUndefined();
    expect(withdrawn(t).sort()).toEqual([at(classic), at(token)].sort());
    expect(after.pools?.[ADA]?.due).toHaveLength(1);
  });

  it("keeps every pool's run 1.7 left going as it is: it covers the retired pools, and the v2 pool's box comes back too", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const classic = await classicBox(t, "c1");
    const kept = await fiveBox(t, "f1");
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, classic, kept);
    await lj.status("preprod");
    await t.store.set("lovejoin.preprod", { ...(await sealed(t)), bringing: { at: t.clock.now - 60_000, back: 0 } });
    await lj.withdrawDue("preprod", true);
    const after = await sealed(t);
    expect(after.retired).toBe(t.clock.now);
    expect(after.bringing?.retired).toBeUndefined();
    expect(after.bringing?.pool).toBeUndefined();
    expect(withdrawn(t).sort()).toEqual([at(classic), at(kept)].sort());
  });

  it("leaves a v2 pool's run going as it is and retires nothing meanwhile: once it's over, the retired pools' run is asked", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const kept = await fiveBox(t, "f1");
    // Another device, still on 1.7, mixed into the classic pool: this one's read finds the box late.
    const classic = await classicBox(t, "c1");
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, kept, classic);
    await lj.status("preprod");
    // Asked from v2's 5 ₳ pool's page before the run that finds the classic box.
    await lj.bringAllBack("preprod", ADA);
    await lj.withdrawDue("preprod", true);
    let s = await sealed(t);
    expect(s.retired).toBeUndefined();
    expect(s.bringing).toMatchObject({ pool: ADA });
    expect(withdrawn(t)).toEqual([at(kept)]);
    // Its withdraw in, the v2 pool's run is over; the next run asks the retired pools': the classic box comes back.
    for (let run = 0; run < 4 && !withdrawn(t).includes(at(classic)); run++) {
      landed(t);
      await busyFor(t, 60_000);
      await lj.withdrawDue("preprod");
    }
    s = await sealed(t);
    expect(withdrawn(t)).toContain(at(classic));
    expect(s.retired).toBeDefined();
    expect(s.bringing).toMatchObject({ retired: true });
  });
});

describe("a chain the update cut, its collateral's mix waiting in 1.7's 5 ₳ pool (1.8.0's release review, R2)", SLOW, () => {
  it("is marked cut before the first run retires the pools: its tail is over, its box comes back with the rest, and a v2 box's own withdraw never waits on it", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL, OLD_FIVE]);
    const boxes = await Promise.all([0, 1].map((i) => classicBox(t, "a1", 5, i)));
    const tailBox = oldFiveBox("e2", await ownDatum(t.wallet), t.clock.now, 0);
    const v2 = await fiveBox(t, "f6");
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, ...boxes, tailBox, v2);
    // 1.7 was sending the chain when the update came: its progress is gone, and nothing has marked it cut yet.
    await t.store.set("lovejoin.preprod", {
      due: [t.clock.now + 3 * HOUR, t.clock.now + 4 * HOUR],
      pools: { [ADA]: { due: [t.clock.now + HOUR] } },
      chains: [tailChain(t)],
    });
    await lj.withdrawDue("preprod", true);
    const after = await sealed(t);
    expect(after.retired).toBe(t.clock.now);
    expect(after.chains[0]).toMatchObject({ cut: true, tail: { over: true } });
    expect(withdrawn(t).sort()).toEqual([...boxes.map(at), at(tailBox)].sort());
    // The run is over once its withdraws are in; the v2 box comes back at its own time, never held up a day.
    let sent = 0;
    for (let run = 0; run < 12 && !withdrawn(t).includes(at(v2)); run++) {
      landed(t);
      await busyFor(t, 30 * 60_000);
      sent += (await lj.withdrawDue("preprod")).length;
      expect((await sealed(t)).bringing?.waiting).not.toBe("collateral");
    }
    expect(withdrawn(t)).toContain(at(v2));
    expect(sent).toBeGreaterThan(0);
  });

  it("never leaves a box in a retired pool to a collateral's mix there: Bring every box back takes it", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL, OLD_FIVE]);
    const tailBox = oldFiveBox("e2", await ownDatum(t.wallet), t.clock.now, 0);
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, tailBox);
    // Past the first run, its tail somehow not over: ended, its mix within its day and tries.
    await t.store.set("lovejoin.preprod", {
      due: [],
      retired: t.clock.now - 1,
      chains: [tailChain(t, { boxes: 0, mixes: [], leaves: [{ txHash: "e3".repeat(32), txIndex: 0, pool: OLD_FIVE_VIEW.id }], sent: 3, ended: t.clock.now - 20 * 60_000, stopped: "cut", cut: true })],
    });
    await lj.bringAllBack("preprod");
    await lj.withdrawDue("preprod");
    expect((await sealed(t)).bringing?.waiting).not.toBe("collateral");
    expect(withdrawn(t)).toEqual([at(tailBox)]);
  });
});

describe("a pool the read set lacks is undecided (1.8.0's release review, R3)", SLOW, () => {
  /** A Bootstrap of two boxes in v2's 5 ₳ pool, its deposit in: held. */
  async function bootstrapped(t: T): Promise<string> {
    const deposit = "b0".repeat(32);
    const held = await Promise.all([0, 1].map(async (i) => adaBox("b0", await ownDatum(t.wallet), t.clock.now, 5, i)));
    t.koios.addedToAccounts.push(...held);
    return deposit;
  }

  it("decides nothing on a run whose read of discovery's record failed: nothing is retired, and a v2 Bootstrap stays held", async () => {
    const t = await wallet();
    const deposit = await bootstrapped(t);
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS);
    await t.store.set("lovejoin.preprod", { due: [], chains: [], mixes: [bootstrapEntry(t, deposit, 2, ADA)] });
    const before = pooled(t, [ADA_POOL]);
    await before.status("preprod");
    expect((await before.held("preprod")).pools?.find((p) => p.id === ADA)?.bootstrap).toBe(2);
    // A worker started afresh, whose quiet read of discovery's record fails (chrome.storage refused it once).
    const after = pooled(t, [ADA_POOL], {
      known: async () => {
        throw new Error("storage");
      },
    });
    t.clock.now += 60_000;
    await after.withdrawDue("preprod");
    const s = await sealed(t);
    expect(s.retired).toBeUndefined();
    expect(s.bringing).toBeUndefined();
    expect(s.mixes?.find((e) => e.id === deposit)?.released).toBeUndefined();
    expect((await before.held("preprod")).pools?.find((p) => p.id === ADA)?.bootstrap).toBe(2);
  });

  it("retires the classic pool at the next run that reads the pools, a v2 Bootstrap held all the same", async () => {
    const t = await wallet();
    const deposit = await bootstrapped(t);
    const classic = await classicBox(t, "c1");
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, classic);
    await t.store.set("lovejoin.preprod", { due: [], chains: [], mixes: [bootstrapEntry(t, deposit, 2, ADA)] });
    await pooled(t, [ADA_POOL]).status("preprod");
    const failing = pooled(t, [ADA_POOL], {
      known: async () => {
        throw new Error("storage");
      },
    });
    await failing.withdrawDue("preprod", true);
    expect((await sealed(t)).retired).toBeUndefined();
    expect(withdrawn(t)).toEqual([]);
    // Read again: the classic pool's box comes back right away; the Bootstrap still holds its two.
    const reading = pooled(t, [ADA_POOL], { known: async () => [ADA_POOL] });
    await busyFor(t, 60_000);
    await reading.withdrawDue("preprod");
    const s = await sealed(t);
    expect(s.retired).toBeDefined();
    expect(withdrawn(t)).toEqual([at(classic)]);
    expect(s.mixes?.find((e) => e.id === deposit)?.released).toBeUndefined();
  });
});

describe("Try again, once the retired pools' run stopped by itself (1.8.0's release review, R4)", SLOW, () => {
  it("asks the retired pools' run again: the rest of their boxes come back, a v2 pool's keep their waits", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const classic = await classicBox(t, "c1");
    const kept = await fiveBox(t, "f1");
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, classic, kept);
    await lj.status("preprod");
    // Koios won't list the pools: every run of the retired pools' sends nothing, and it stops by itself.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (new URL(String(url)).pathname.endsWith("/credential_utxos") ? new Response("down", { status: 500 }) : real(url, init));
    await lj.withdrawDue("preprod", true);
    for (let i = 1; i < BRING_FAILED_RUNS; i++) {
      await busyFor(t, 60_000);
      await lj.withdrawDue("preprod");
    }
    t.koios.fetch = real;
    expect((await lj.held("preprod")).bringing).toMatchObject({ retired: true, stopped: expect.any(String) });
    // Settings' Try again.
    await lj.bringAllBack("preprod", undefined, true);
    expect((await sealed(t)).bringing).toEqual({ at: t.clock.now, back: 0, retired: true });
    for (let run = 0; run < 4; run++) {
      await busyFor(t, 60_000);
      await lj.withdrawDue("preprod");
    }
    expect(withdrawn(t)).toContain(at(classic));
    expect(withdrawn(t)).not.toContain(at(kept));
  });

  it("widens a retired pool's run going to the retired pools', and is refused while a v2 pool's goes", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL, OLD_TOKEN_POOL]);
    await lj.bringAllBack("preprod", OLD_TOKEN);
    await lj.bringAllBack("preprod", undefined, true);
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 0, retired: true });
    // Every pool's, or the retired pools', covers them already.
    await lj.bringAllBack("preprod", undefined, true);
    expect((await sealed(t)).bringing).toEqual({ at: expect.any(Number), back: 0, retired: true });
    await lj.stopBringingAllBack("preprod");
    await lj.bringAllBack("preprod", ADA);
    await expect(lj.bringAllBack("preprod", undefined, true)).rejects.toThrow(tr("lj.bringOtherPool"));
    expect((await sealed(t)).bringing).toMatchObject({ pool: ADA });
  });

  it("is handed on by the worker's request, `retired` alone taken as it", async () => {
    const asked: unknown[][] = [];
    const ctx = {
      network: "preprod",
      lovejoin: {
        bringAllBack: async (...args: unknown[]) => void asked.push(args),
        withdrawDue: async () => [],
      },
    } as unknown as Context;
    await handle({ type: "lovejoin-bring-all-back", retired: true } as Message, ctx);
    await handle({ type: "lovejoin-bring-all-back", pool: CLASSIC } as Message, ctx);
    await handle({ type: "lovejoin-bring-all-back", retired: "yes" } as unknown as Message, ctx);
    expect(asked).toEqual([
      ["preprod", undefined, true],
      ["preprod", CLASSIC, false],
      ["preprod", undefined, false],
    ]);
  });

  it("is what Settings' Try again asks there, the page following that run, with no line on every pool beside it", async () => {
    const stopped = { back: 2, retired: true as const, stopped: "Koios didn't answer" };
    expect(bringAsk(undefined, stopped)).toEqual({ retired: true });
    // A stopped run of every pool's, a run going, a pool's page: as before.
    expect(bringAsk(undefined, { back: 2, stopped: "Koios didn't answer" })).toEqual({});
    expect(bringAsk(undefined, { back: 2, retired: true })).toEqual({});
    expect(bringAsk(CLASSIC, stopped)).toEqual({ pool: CLASSIC });
    // The page shows the run it asked until the next read.
    const { follower, shown } = page();
    follower.read()(held(stopped));
    await follower.press(false, async () => undefined, true);
    expect(shown.bringing.at(-1)).toEqual({ back: 0, retired: true });
    // Settings' words beside it: the stopped run's own, never "Every box in every pool".
    const settings = view({ bringing: stopped });
    expect(settings).toContain(tr("common.tryAgain"));
    expect(settings).toContain("Press Try again to bring back the rest.");
    expect(settings).not.toContain(tr("settings.lovejoin.bringNote"));
    expect(view({ bringing: { back: 2, stopped: "Koios didn't answer" } })).toContain(tr("settings.lovejoin.bringNote"));
  });

  it("asks its question there of the retired pools' boxes, never of every box (the retire lane's For the lead, 3)", () => {
    const stopped = { back: 2, retired: true as const, stopped: "Koios didn't answer" };
    // As the page asks it: whether its press asks the retired pools' run (bringAsk).
    const question = (pool: string | undefined, shown: Parameters<typeof bringAsk>[1]) =>
      words(
        createElement(BringAllBackQuestion, {
          pool: pool !== undefined,
          retired: !!bringAsk(pool, shown).retired,
          onKeep: () => undefined,
          onConfirm: () => undefined,
        }),
      );
    expect(question(undefined, stopped)).toContain("Bring the retired pools' boxes back now?");
    expect(question(undefined, stopped)).not.toContain("Bring every box back now?");
    // Its privacy note and its cost stay the question's own.
    expect(question(undefined, stopped)).toContain(tr("settings.lovejoin.privacy.bring"));
    // Settings' first press, a stopped run of every pool's, and a pool's page: as before.
    expect(question(undefined, undefined)).toContain("Bring every box back now?");
    expect(question(undefined, { back: 2, stopped: "Koios didn't answer" })).toContain("Bring every box back now?");
    expect(question(CLASSIC, stopped)).toContain("Bring this pool's boxes back now?");
  });
});

describe("what the first run's bring-back leaves Home (1.8.0's release review, critic#3)", SLOW, () => {
  /** Two classic boxes a deposit made, held by 1.7 as not mixed yet (a restore's), its count kept. */
  async function heldBy17(t: T): Promise<KoiosUtxo[]> {
    const boxes = [];
    for (const tx of ["c1", "c2"]) {
      const box = await classicBox(t, tx, 10);
      t.koios.txSpends.set(box.tx_hash, [{ payment_addr: { bech32: "addr_test1", cred: "ab".repeat(28) } }]);
      boxes.push(box);
    }
    const seen = t.clock.now - HOUR;
    await t.store.set("lovejoin.preprod", {
      due: [],
      chains: [],
      notMixed: 2,
      origins: Object.fromEntries(boxes.map((b) => [b.tx_hash, { mixed: false, seen }])),
    });
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, ...boxes);
    return boxes;
  }

  it("drops 1.7's count of boxes not mixed yet in a retired pool at once: Home never says they wait, while the run takes them nor after a Stop", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const boxes = await heldBy17(t);
    expect((await lj.held("preprod")).notMixed).toBe(2);
    expect(await lj.withdrawDue("preprod", true)).toHaveLength(2);
    const during = await lj.held("preprod");
    expect(during.bringing).toMatchObject({ retired: true, back: 2 });
    expect(during.notMixed).toBe(0);
    const home = words(createElement(InLovejoin, { held: during, now: t.clock.now, onOpen: () => undefined }));
    expect(home).not.toContain(tr("home.lovejoin.notBack"));
    // Stopped while their withdraws land: Home says none of them is in Lovejoin.
    await lj.stopBringingAllBack("preprod");
    landed(t);
    for (let run = 0; run < 3; run++) {
      await busyFor(t, 60_000);
      await lj.withdrawDue("preprod");
      expect((await lj.held("preprod")).notMixed).toBe(0);
    }
    expect(withdrawn(t).sort()).toEqual(boxes.map(at).sort());
  });

  it("has the pools read all the same where the run stops before it takes them: they come back by themselves", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const boxes = await heldBy17(t);
    // Koios won't list the pools for the run's three tries: it stops by itself, having sent nothing.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (new URL(String(url)).pathname.endsWith("/credential_utxos") ? new Response("down", { status: 500 }) : real(url, init));
    await lj.withdrawDue("preprod", true);
    for (let i = 1; i < BRING_FAILED_RUNS; i++) {
      await busyFor(t, 60_000);
      await lj.withdrawDue("preprod");
    }
    t.koios.fetch = real;
    expect((await lj.held("preprod")).bringing).toMatchObject({ retired: true, back: 0, stopped: expect.any(String) });
    // Unlocked through it, then the next unlock: each gets its own wait, and comes back by itself.
    for (let run = 0; run < 24 && withdrawn(t).length < 2; run++) {
      landed(t);
      await busyFor(t, 30 * 60_000);
      await lj.withdrawDue("preprod", run === 8);
    }
    expect(withdrawn(t).sort()).toEqual(boxes.map(at).sort());
  });
});

describe("the retired pools' run passes over a box someone else's mix moved (1.8.0's release review, critic#5)", SLOW, () => {
  /** A chain of the wallet's recorded at `at`, all sent and in: `more` says where it put its boxes. */
  const chainAt = (at: number, more: Record<string, unknown>) => ({
    id: "e9".repeat(32),
    at,
    session: 0,
    progress: "done",
    deposit: "ea".repeat(32),
    mixes: ["eb".repeat(32)],
    total: 3,
    sent: 3,
    done: true,
    scheduled: true,
    ended: at + 60_000,
    landed: true,
    ...more,
  });

  it("takes a retired box someone else's mix moved after a v2 chain of the wallet's went: that chain mixes in no retired pool", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const asked = t.clock.now - 10 * 60_000;
    const moved = await classicBox(t, "c7", 2 / 60);
    const still = await classicBox(t, "c8", 5);
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, moved, still);
    await t.store.set("lovejoin.preprod", {
      due: [t.clock.now + 3 * HOUR, t.clock.now + 4 * HOUR],
      chains: [chainAt(t.clock.now - 5 * 60_000, { leaves: [{ txHash: "eb".repeat(32), txIndex: 0, pool: ADA }], boxes: 1, pools: { [ADA]: 1 } })],
      retired: asked,
      bringing: { at: asked, back: 0, retired: true },
    });
    await lj.withdrawDue("preprod");
    expect(withdrawn(t).sort()).toEqual([at(moved), at(still)].sort());
  });

  it("still passes over a box of a pool such a chain mixes in, its collateral's included: it may be that chain's", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const asked = t.clock.now - 10 * 60_000;
    const moved = await fiveBox(t, "f7", 2 / 60);
    const still = await fiveBox(t, "f8", 5);
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, moved, still);
    // A site's return with no box of its own: only its collateral went into the 5 ₳ pool, and was mixed there.
    const tail = { deposit: "ec".repeat(32), mix: "ed".repeat(32), pool: ADA, box: { txHash: "ec".repeat(32), txIndex: 0, pool: ADA }, leaf: { txHash: "ed".repeat(32), txIndex: 0, pool: ADA }, tries: 1, scheduled: true, over: true, landed: asked };
    await t.store.set("lovejoin.preprod", {
      due: [],
      pools: { [ADA]: { due: [t.clock.now + 3 * HOUR, t.clock.now + 4 * HOUR] } },
      chains: [chainAt(t.clock.now - 5 * 60_000, { deposit: undefined, mixes: [], leaves: [tail.leaf], boxes: 0, tail })],
      retired: asked,
      bringing: { at: asked, back: 0 },
    });
    await lj.withdrawDue("preprod");
    expect(withdrawn(t)).toEqual([at(still)]);
  });
});

describe("a mix from the public account in a retired pool (1.8.0's release review, R8)", SLOW, () => {
  it("is refused before anything is read: a mix, a Bootstrap and mixing again in the classic pool ask Koios nothing", async () => {
    const t = await publicFunded();
    const from = t.koios.calls.length;
    const retired = tr("lj.unusable.warn.retired");
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow(retired);
    await expect(t.lovejoin.publicBuild("preprod", 1, { bootstrap: true })).rejects.toThrow(retired);
    await expect(t.lovejoin.publicAgainBuild("preprod")).rejects.toThrow(retired);
    expect(t.koios.calls.slice(from).map((c) => c.path)).toEqual([]);
  });
});

describe("the guards no moved test reached (1.8.0's release review, R5)", SLOW, () => {
  it("brings a 1.7 Mix my boxes again session back directly, saying the classic pool is retired, spending none of its boxes", async () => {
    const t = await wallet();
    const box = await classicBox(t, "d6");
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
          // As 1.7 recorded Mix my boxes again from the private balance: no pool named, the classic pool's.
          mix: { boxes: 1, again: true },
        },
      ],
    });
    t.koios.addedToAccounts.push(atSession("ab".repeat(32), 0, "20000000"), atSession("ab".repeat(32), 1, "5000000"), ...POOL, ...ADA_ROWS, box);
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const review = await sessionsOf(t, undefined, pooled(t)).backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe(tr("lj.unusable.warn.retired"));
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain?: Array<{ txCbor: string }> }>("seedelf.session.back"));
    const classic = new Set([...POOL.map(at), at(box)]);
    expect((kept?.chain ?? []).flatMap((x) => txInputs(Uint8Array.from(Buffer.from(x.txCbor, "hex")))).filter((o) => classic.has(o))).toEqual([]);
  });

  it("ends a 1.7 collateral's mix left to build in 1.7's 5 ₳ pool, never building it there", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL, OLD_FIVE]);
    const tailBox = oldFiveBox("e2", await ownDatum(t.wallet), t.clock.now, 0);
    // Other people's boxes there for the mix's two draws.
    const others = Array.from({ length: 6 }, (_, i) => oldFiveBox(`5c${i}`.padEnd(4, "0").repeat(16), strangerDatum(), t.clock.now, 2));
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, tailBox, ...others);
    await t.store.set("lovejoin.preprod", {
      due: [],
      retired: t.clock.now - 1,
      chains: [tailChain(t, { boxes: 0, mixes: [], leaves: [{ txHash: "e3".repeat(32), txIndex: 0, pool: OLD_FIVE_VIEW.id }], total: 2, sent: 1, ended: t.clock.now - 20 * 60_000, stopped: "cut" })],
    });
    const resumed = await lj.tailChain("preprod", 0, [atSession("e2".repeat(32), 1, "4000000")], epochParams[0], ["e2".repeat(32)]);
    expect(resumed).toBeUndefined();
    expect((await sealed(t)).chains[0]!.tail?.over).toBe(true);
  });

  it("asks the retired pools' run afresh over a run 1.7 stopped, and says 1.7's Stop no more", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const classic = await classicBox(t, "c1");
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, classic);
    await lj.status("preprod");
    await t.store.set("lovejoin.preprod", {
      ...(await sealed(t)),
      bringing: { at: t.clock.now - HOUR, back: 0, why: "giveme.my busy", fails: 3, stopped: true },
      bringStopped: { back: 1 },
    });
    await lj.withdrawDue("preprod", true);
    const s = await sealed(t);
    expect(s.bringing).toMatchObject({ at: t.clock.now, retired: true, back: 1 });
    expect(s.bringing?.stopped).toBeUndefined();
    expect(s.bringStopped).toBeUndefined();
    expect(withdrawn(t)).toEqual([at(classic)]);
  });

  it("fired late (another device's classic mix), lets no v2 Bootstrap go, ends no v2 collateral's mix, and keeps the v2 pool's due times", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const deposit = "b0".repeat(32);
    const held = await Promise.all([0, 1].map(async (i) => adaBox("b0", await ownDatum(t.wallet), t.clock.now, 5, i)));
    const tailBox = adaBox("e2", await ownDatum(t.wallet), t.clock.now, 0);
    const mixed = await fiveBox(t, "f1");
    const due = t.clock.now + 3 * HOUR;
    const tail = { deposit: "e2".repeat(32), mix: "e3".repeat(32), pool: ADA, box: { txHash: "e2".repeat(32), txIndex: 0, pool: ADA }, leaf: { txHash: "e3".repeat(32), txIndex: 0, pool: ADA }, tries: 1, landed: t.clock.now - 25 * 60_000 };
    await t.store.set("lovejoin.preprod", {
      due: [],
      pools: { [ADA]: { due: [due] } },
      chains: [{ id: "e9".repeat(32), at: t.clock.now - 30 * 60_000, session: 0, progress: "x", total: 2, sent: 1, boxes: 0, mixes: [], leaves: [tail.leaf], ended: t.clock.now - 20 * 60_000, stopped: "cut", tail }],
      mixes: [bootstrapEntry(t, deposit, 2, ADA)],
    });
    const classic = await classicBox(t, "c1");
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, ...held, tailBox, mixed, classic);
    await lj.status("preprod");
    expect((await sealed(t)).retired).toBeUndefined();
    await lj.withdrawDue("preprod", true);
    const after = await sealed(t);
    expect(after.retired).toBe(t.clock.now);
    expect(after.mixes?.find((e) => e.id === deposit)?.released).toBeUndefined();
    expect(after.chains.find((c) => c.id === "e9".repeat(32))?.tail?.over).toBeUndefined();
    expect(withdrawn(t)).toEqual([at(classic)]);
    // The classic box back, the run ends: the v2 pool's due time stays as it was.
    landed(t);
    for (let run = 0; run < 6 && (await sealed(t)).bringing; run++) {
      await busyFor(t, 3 * 60_000);
      await lj.withdrawDue("preprod");
    }
    const end = await sealed(t);
    expect(end.bringing).toBeUndefined();
    expect(end.pools?.[ADA]?.due).toEqual([due]);
  });

  it("ends a collateral's mix left to build in a retired pool though nothing else of the wallet's is there, and asks the run", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL, OLD_FIVE]);
    const tailBox = oldFiveBox("e2", await ownDatum(t.wallet), t.clock.now, 0);
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, tailBox);
    await t.store.set("lovejoin.preprod", {
      due: [],
      chains: [tailChain(t, { boxes: 0, mixes: [], leaves: [{ txHash: "e3".repeat(32), txIndex: 0, pool: OLD_FIVE_VIEW.id }], ended: t.clock.now - 20 * 60_000, stopped: "cut", cut: true })],
    });
    await lj.withdrawDue("preprod", true);
    const s = await sealed(t);
    expect(s.retired).toBe(t.clock.now);
    expect(s.chains[0]!.tail?.over).toBe(true);
    expect(withdrawn(t)).toEqual([at(tailBox)]);
  });

  it("marks a retired pool's figures retired on Home, never a v2 pool's", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL, OLD_TOKEN_POOL]);
    await retiredAlready(t.store);
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, await oldTokenBox(t, "d1"), await fiveBox(t, "f1"));
    await lj.status("preprod");
    const pools = (await lj.held("preprod")).pools ?? [];
    expect(pools.find((p) => p.id === OLD_TOKEN)).toMatchObject({ boxes: 1, retired: true });
    expect(pools.find((p) => p.id === ADA)).toMatchObject({ boxes: 1 });
    expect(pools.find((p) => p.id === ADA)?.retired).toBeUndefined();
  });

  it("holds nothing in a retired pool: a cut chain's boxes, one Koios can't say the making of, and a Bootstrap's get due times", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // A chain 1.7 stopped partway: its deposit's two boxes still where it put them, never mixed.
    const left = await Promise.all([0, 1].map((i) => classicBox(t, "a0", 3, i)));
    // A box Koios doesn't know the making of.
    const unknown = await classicBox(t, "c7", 6);
    t.koios.txSpends.delete(unknown.tx_hash);
    // A Bootstrap's box there, its deposit in.
    const boot = await classicBox(t, "b0", 6);
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, ...left, unknown, boot);
    await t.store.set("lovejoin.preprod", {
      due: [],
      chains: [
        {
          id: "a9".repeat(32),
          at: t.clock.now - 3 * HOUR,
          progress: "x",
          deposit: "a0".repeat(32),
          mixes: ["a1".repeat(32), "a2".repeat(32)],
          total: 3,
          sent: 1,
          boxes: 2,
          account: 0,
          leaves: [
            { txHash: "a2".repeat(32), txIndex: 0 },
            { txHash: "a2".repeat(32), txIndex: 1 },
          ],
          scheduled: true,
          ended: t.clock.now - 2 * HOUR,
          stopped: "cut",
          cut: true,
        },
      ],
      mixes: [bootstrapEntry(t, boot.tx_hash, 1)],
    });
    await retiredAlready(t.store, "preprod", t.clock.now);
    const status = await lj.status("preprod");
    expect(status.notMixed).toEqual([]);
    expect(status.unsure ?? []).toEqual([]);
    expect(status.bootstrap ?? []).toEqual([]);
    expect(status.due).toHaveLength(4);
  });

  it("brings one back now, with no box named, whatever made it there: a deposit, or what Koios can't say", async () => {
    for (const koiosSays of ["deposit", "nothing"] as const) {
      const t = await wallet();
      const lj = pooled(t);
      // A box no record accounts for, with its due time: no read holds it, and Bring one back now asks what made it.
      await t.store.set("lovejoin.preprod", { due: [t.clock.now + 3 * HOUR], chains: [], retired: t.clock.now });
      const box = await classicBox(t, "c8", 6);
      if (koiosSays === "deposit") t.koios.txSpends.set(box.tx_hash, [{ payment_addr: { bech32: "addr_test1", cred: "ab".repeat(28) } }]);
      else t.koios.txSpends.delete(box.tx_hash);
      t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, box);
      const pending = await lj.withdrawNow("preprod");
      expect(pending.kind, koiosSays).toBe("lovejoin-withdraw");
      expect(withdrawn(t), koiosSays).toEqual([at(box)]);
    }
  });
});

/** What lovejoin-held answers: nothing of the wallet's anywhere but `pools`, and the run as `bringing` has it. */
const held = (bringing?: LovejoinHeld["bringing"], more: Partial<LovejoinHeld> = {}): LovejoinHeld => ({
  boxes: 0,
  lovelace: "0",
  next: null,
  notMixed: 0,
  stopped: 0,
  ...more,
  ...(bringing ? { bringing } : {}),
});

/** A page following the runs (`pool`, a pool's page's; `retired`, a retired pool's), and what it showed. */
function page(pool?: string, retired = false) {
  const shown = {
    bringing: [] as Array<LovejoinHeld["bringing"]>,
    done: [] as Array<{ count?: number; pool?: string; stopped?: true; retired?: true }>,
    overs: 0,
  };
  const follower = bringFollower(
    pool,
    {
      bringing: (b) => shown.bringing.push(b),
      done: (count, of, stopped, old) => shown.done.push({ count, pool: of, stopped, retired: old }),
      over: () => (shown.overs += 1),
    },
    retired,
  );
  return { follower, shown };
}

function words(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(PreferencesContext.Provider, { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined } }, element),
    ),
  )
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The part of the page as a person reads it: Settings' (`pool` false) or a pool's page's. */
const view = (props: Partial<Parameters<typeof BringAllBackView>[0]>) =>
  words(createElement(BringAllBackView, { bringing: undefined, busy: false, onAsk: () => undefined, onStop: () => undefined, ...props }));

describe("the retired pools' run on its pages (1.8.0's release review, W2 and S3's half)", () => {
  const going = { back: 5, left: 3, retired: true as const };

  it("a retired pool's page says the retired pools' run as theirs, with their count, never 'every box in this pool'", () => {
    const words = view({ pool: true, bringing: going });
    expect(words).toContain(tr("settings.lovejoin.bringingRetired", { count: 5, boxes: "5 boxes" }));
    expect(words).not.toContain("Bringing every box in this pool back");
  });

  it("Settings says it in the retired pools' words, keeps its button to make it every pool's, and says none was left in them", () => {
    const settings = view({ bringing: going });
    expect(settings).toContain(tr("settings.lovejoin.bringingRetired", { count: 5, boxes: "5 boxes" }));
    expect(settings).toContain(tr("settings.lovejoin.bringNote"));
    expect(settings).toContain(tr("settings.lovejoin.bring"));
    expect(view({ done: 0, doneRetired: true })).toContain(tr("settings.lovejoin.bringNoneRetired"));
    expect(view({ done: 0 })).toContain(tr("settings.lovejoin.bringNone"));
  });

  it("is followed on a retired pool's page and in Settings, never taken for a v2 pool's page's own", () => {
    for (const [pool, retired, follows] of [
      [CLASSIC, true, true],
      [undefined, false, true],
      [ADA, false, false],
    ] as const) {
      const { follower, shown } = page(pool, retired);
      follower.read()(held(going));
      follower.read()(held());
      expect(shown.done.length > 0, `${pool ?? "Settings"}`).toBe(follows);
    }
  });

  it("says its end as the retired pools', over or stopped, and keeps it so for the page", () => {
    const over = page();
    over.follower.read()(held(going));
    over.follower.read()(held());
    expect(over.shown.done.at(-1)).toMatchObject({ retired: true });
    const stopped = page();
    stopped.follower.read()(held(going));
    stopped.follower.read()(held(undefined, { bringStopped: { back: 5, retired: true } }));
    expect(stopped.shown.done.at(-1)).toMatchObject({ count: 5, stopped: true, retired: true });
    expect(doneShown(0, undefined, undefined, true)).toEqual({ count: 0, retired: true });
    expect(doneShown(undefined)).toBeUndefined();
  });

  it("is widened by Settings' press to every pool's, `retired` dropped", async () => {
    const { follower, shown } = page();
    follower.read()(held(going));
    await follower.press(false, async () => undefined);
    expect(shown.bringing.at(-1)).toEqual({ back: 5, left: 3 });
  });

  it("says none was left in the retired pools only where the classic pool's figures say so too", () => {
    expect(doneOf({ back: 0, retired: true }, held(undefined, { boxes: 1, lovelace: "10000000" }))).toBeUndefined();
    expect(doneOf({ back: 0, retired: true }, held())).toBe(0);
  });
});
