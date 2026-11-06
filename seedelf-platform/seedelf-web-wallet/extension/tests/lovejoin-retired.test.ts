// Chunk 44b: the classic pool and every pool on 8131b1d's scripts are retired
// (the owner's calls of 2026-11-05). They take no new box and mix none again,
// from either side; their boxes come back, right away from the first run that
// finds them, by Bring every box back over the retired pools alone, once a
// network. A return's spare ADA, and its session's collateral, go into v2's
// 5 ₳ pool, or come back directly while none is shown. And the screens list a
// retired pool only while the wallet has boxes there. With the real
// WebAssembly, the classic pool's recorded preprod boxes, the 8131b1d token
// pool PR #163 launched, and v2's 5 ₳ pool (v2-pools.ts).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { CLASSIC, isRetired, LovejoinService, type LovejoinDeps, type PoolRef } from "../src/background/lovejoin";
import { t as tr } from "../src/i18n";
import bundled from "../src/lovejoin-pools.json";
import { NETWORKS } from "../src/networks";
import type { LovejoinHeld } from "../src/shared/rpc";
import { doneOf } from "../src/ui/components/BringAllBack";
import { isRetired as shownRetired, poolsOf, shownOnHub } from "../src/ui/lovejoin-pools";
import { account, AGREES, atSession, PASSWORD, POOL, publicFunded, sessionsOf } from "./chain-fixtures";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { epochParams, loadTestWasm, testBalances } from "./fakes";
import { ADA, ADA_ADDRESS, ADA_BOX, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

/** Real chains and withdraws are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 180_000 };

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
const OLD_FIVE = (bundled.preprod.pools.find((p) => p.boxLovelace === "5000000") as unknown as { ref: PoolRef }).ref;

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

/** A box of the wallet's in the classic pool, a mix there having made it `hours` ago. */
async function classicBox(t: T, tx: string, hours = 5): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: POOL[0]!.address, cred: CLASSIC_BOX } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    inline_datum: { bytes: await ownDatum(t.wallet), value: {} },
  } as KoiosUtxo;
}

/** A box of the wallet's in v2's 5 ₳ pool, a mix there having made it `hours` ago. */
async function fiveBox(t: T, tx: string, hours = 5): Promise<KoiosUtxo> {
  madeByAdaMix(t.koios, tx.repeat(32));
  return adaBox(tx, await ownDatum(t.wallet), t.clock.now, hours);
}

/** The boxes the withdraws giveme.my was asked about spend, `txhash#index`. */
const withdrawn = (t: T) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));

type Sealed = {
  due: number[];
  pools?: Record<string, { due: number[] }>;
  retired?: number;
  bringing?: { at: number; back: number; pool?: string; retired?: true };
  mixes?: Array<{ id: string; bootstrap?: true; released?: true; shares: Array<{ pool?: string; boxes: number }> }>;
  chains: Array<{ id: string; tail?: { over?: true } }>;
};
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

describe("a retired pool takes no new box (chunk 44, the owner's call 2)", SLOW, () => {
  it("is the classic pool and every pool on 8131b1d's scripts, never a v2 pool", () => {
    expect(isRetired({ id: CLASSIC })).toBe(true);
    expect(isRetired({ id: OLD_TOKEN })).toBe(true);
    expect(isRetired({ id: ADA, version: "v2" })).toBe(false);
  });

  it("refuses a mix, a Bootstrap and mixing again in the classic pool, from either side, in words, before anything is built", async () => {
    const t = await publicFunded();
    const lj = t.lovejoin;
    const retired = tr("lj.unusable.warn.retired");
    // A request that names no pool is the classic pool's, as every record before chunk 34 names it.
    await expect(lj.publicBuild("preprod", 1)).rejects.toThrow(retired);
    await expect(lj.publicBuild("preprod", 1, { bootstrap: true })).rejects.toThrow(retired);
    await expect(lj.publicAgainBuild("preprod")).rejects.toThrow(retired);
    await expect(lj.fits("preprod", 1)).rejects.toThrow(retired);
    await expect(lj.againBoxes("preprod")).rejects.toThrow(retired);
    await expect(lj.privateBootstrapMost("preprod")).rejects.toThrow(retired);
    // Nothing was built: no transaction measured, none sent.
    expect(t.koios.calls.filter((c) => c.path === "ogmios")).toHaveLength(0);
    expect(t.koios.submitted).toHaveLength(0);
    // v2's 5 ₳ pool takes them.
    const mix = await lj.publicBuild("preprod", 1, { pool: ADA });
    expect(mix).toMatchObject({ pool: ADA, boxes: 1 });
  });

  it("refuses them in an 8131b1d pool too, and offers none of its pools to a swap's token", async () => {
    const t = await publicFunded();
    const lj = pooled(t, [ADA_POOL, OLD_TOKEN_POOL]);
    const retired = tr("lj.unusable.warn.retired");
    await expect(lj.fits("preprod", 1, OLD_TOKEN)).rejects.toThrow(retired);
    await expect(lj.publicBuild("preprod", 1, { pool: OLD_TOKEN })).rejects.toThrow(retired);
    await expect(lj.privateBootstrapMost("preprod", OLD_TOKEN)).rejects.toThrow(retired);
    const pool = await lj.poolNamed("preprod", OLD_TOKEN);
    const unit = pool.token!.policyId + pool.token!.assetName;
    expect(await lj.poolsOf("preprod", unit)).toEqual([]);
    expect(await lj.usable("preprod", [pool])).toEqual([]);
  });

  it("says so on its status: the classic pool always, an 8131b1d pool listed only while the wallet has a box there", async () => {
    const t = await wallet();
    const lj = pooled(t, [ADA_POOL, OLD_TOKEN_POOL]);
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS);
    const empty = await lj.status("preprod");
    expect(empty.unusable).toEqual({ why: "retired" });
    expect(empty.pools?.map((p) => p.id)).toEqual([ADA]);
    expect(empty.pools?.[0]?.unusable).toBeUndefined();
    // A box of the wallet's in the old token pool, a mix there having made it: listed, withdraw-only.
    t.koios.txSpends.set("d1".repeat(32), [{ payment_addr: { bech32: OLD_ADDRESS, cred: OLD_VIEW.mixBoxHash } }]);
    t.koios.addedToAccounts.push({
      ...(await classicBox(t, "d1")),
      address: OLD_ADDRESS,
      payment_cred: OLD_VIEW.mixBoxHash,
      value: "2000000",
      asset_list: [{ policy_id: OLD_VIEW.token.policyId, asset_name: OLD_VIEW.token.assetName, quantity: OLD_VIEW.token.quantity, decimals: 0, fingerprint: "" } as never],
    });
    const held = await lj.status("preprod");
    const old = held.pools?.find((p) => p.id === OLD_TOKEN);
    expect(old?.boxes).toHaveLength(1);
    expect(old?.unusable).toEqual({ why: "retired" });
  });
});

describe("a session's return (chunk 44, the owner's call 4)", SLOW, () => {
  /** A site's private session 0 holding `lovelace` and its 5 ₳ collateral, Lovejoin reading `pools`. */
  async function session(lovelace: string, pools: PoolRef[]) {
    const t = await wallet();
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
    t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, lovelace), atSession("c2".repeat(32), 1, "5000000"), ...POOL, ...ADA_ROWS);
    const lj = pooled(t, pools);
    return { t, sessions: sessionsOf(t, undefined, lj) };
  }

  it("takes its spare ADA into v2's 5 ₳ pool, named and valued for its review, never the classic pool", async () => {
    const { t, sessions } = await session("40000000", [ADA_POOL]);
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBeUndefined();
    expect(review.lovejoin).toMatchObject({ pool: ADA, values: { [ADA]: { lovelace: ADA_BOX.toString() } } });
    expect(review.lovejoin!.boxes).toBeGreaterThan(0);
    // The network measures its first mix given the deposit's outputs: 5 ₳ boxes at the 5 ₳ pool's mix_box.
    const [check] = t.koios.calls.filter((c) => c.path === "ogmios");
    expect(check!.body.params.additionalUtxo[0]).toMatchObject({ address: ADA_ADDRESS, value: { ada: { lovelace: Number(ADA_BOX) } } });
    // Sent, no transaction of it spends a classic box.
    await sessions.backSubmit("preprod", review.txHash);
    const classic = new Set(POOL.map((u) => `${u.tx_hash}#${u.tx_index}`));
    expect(t.koios.submitted.length).toBeGreaterThan(0);
    expect(t.koios.submitted.flatMap((tx) => txInputs(tx)).filter((o) => classic.has(o))).toEqual([]);
  });

  it("comes back directly while no 5 ₳ pool is shown, and says why", async () => {
    // Only 1.7's 5 ₳ pool, on 8131b1d's scripts, retired: no pool takes the ADA.
    const { sessions } = await session("40000000", [OLD_FIVE]);
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe(tr("sess.skip.warn.noAdaPool"));
  });

  it("comes back directly from a 1.7 mix session into the classic pool, saying the pool is retired", async () => {
    const { t, sessions } = await session("40000000", [ADA_POOL]);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [{ kind: "out", txHash: "c1".repeat(32), at: t.clock.now, confirmed: true }],
          mix: { boxes: 2 },
        },
      ],
    });
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe(tr("lj.unusable.warn.retired"));
  });

  it("leaves its collateral's mix two boxes of the 5 ₳ pool, never at the cost of its one box (chunk 44)", async () => {
    // Sixteen strangers' boxes: two boxes two waves deep would take every one, and the collateral would come back
    // unmixed. One goes, and the collateral's mix draws two of the eight left.
    const { t, sessions } = await session("40000000", [ADA_POOL]);
    t.koios.addedToAccounts.splice(0, t.koios.addedToAccounts.length, ...t.koios.addedToAccounts.filter((u) => !ADA_ROWS.slice(16).includes(u)));
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toMatchObject({ boxes: 1, depth: 2 });
    expect(review.collateralTail).toMatchObject({ pool: ADA, txs: 2 });
    // With nine, two boxes don't fit at all: the one box goes, though the collateral's mix then has one to draw.
    const nine = await session("40000000", [ADA_POOL]);
    nine.t.koios.addedToAccounts.splice(0, nine.t.koios.addedToAccounts.length, ...nine.t.koios.addedToAccounts.filter((u) => !ADA_ROWS.slice(9).includes(u)));
    const one = await nine.sessions.backBuild("preprod", 0);
    expect(one.lovejoin).toMatchObject({ boxes: 1 });
  });

  it("mixes its collateral in v2's 5 ₳ pool alone, never 1.7's", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(...ADA_ROWS);
    const params = epochParams[0];
    expect((await pooled(t, [OLD_FIVE, ADA_POOL]).collateralPool("preprod", params))?.pool.id).toBe(ADA);
    expect(await pooled(t, [OLD_FIVE]).collateralPool("preprod", params)).toBeUndefined();
    expect(await pooled(t, [OLD_FIVE]).collateralPoolTakes("preprod")).toBe("no");
  });
});

describe("right away (chunk 44, the owner's call 3)", SLOW, () => {
  it("brings the retired pools' boxes back from the first run that finds them, never a v2 pool's, once", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const old = await classicBox(t, "c1");
    const kept = await fiveBox(t, "f1");
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, old, kept);
    // The Lovejoin page's read: each box gets its due time, its pool's own.
    await lj.status("preprod");
    expect((await sealed(t)).due).toHaveLength(1);
    expect((await sealed(t)).pools?.[ADA]?.due).toHaveLength(1);
    expect((await sealed(t)).retired).toBeUndefined();

    // The unlock's run: the classic box goes at once, though nothing's due and an unlock's run sends nothing else.
    const sent = await lj.withdrawDue("preprod", true);
    expect(sent).toHaveLength(1);
    expect(withdrawn(t)).toContain(`${old.tx_hash}#0`);
    expect(withdrawn(t)).not.toContain(`${kept.tx_hash}#0`);
    const after = await sealed(t);
    expect(after.retired).toBe(t.clock.now);
    expect(after.bringing).toMatchObject({ retired: true, back: 1 });
    expect(after.bringing?.pool).toBeUndefined();
    expect(after.pools?.[ADA]?.due).toHaveLength(1);
    expect((await lj.held("preprod")).bringing).toMatchObject({ retired: true, back: 1 });

    // While it goes: a v2 pool's is refused, a retired pool's is in it already, and every pool's widens it.
    await expect(lj.bringAllBack("preprod", ADA)).rejects.toThrow(tr("lj.bringOtherPool"));
    await lj.bringAllBack("preprod", CLASSIC);
    expect((await sealed(t)).bringing).toMatchObject({ retired: true });
    await lj.bringAllBack("preprod");
    expect((await sealed(t)).bringing?.retired).toBeUndefined();
    await lj.stopBringingAllBack("preprod");

    // Once a network: a classic box found later comes back at its own time, as any pool's does.
    t.koios.addedToAccounts.splice(t.koios.addedToAccounts.indexOf(old), 1);
    t.koios.addedToAccounts.push(await classicBox(t, "c2"));
    await lj.status("preprod");
    t.clock.now += 60_000;
    expect(await lj.withdrawDue("preprod", true)).toEqual([]);
    expect((await sealed(t)).bringing).toBeUndefined();
  });

  it("lets go of a Bootstrap's hold and a collateral's mix in a retired pool, and asks for their boxes", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const old = "cc".repeat(28);
    await t.store.set("lovejoin.preprod", {
      due: [],
      chains: [
        {
          id: "e1".repeat(32),
          at: t.clock.now - 3_600_000,
          session: 0,
          total: 4,
          sent: 2,
          boxes: 0,
          mixes: [],
          leaves: [],
          ended: t.clock.now - 3_600_000,
          tail: {
            deposit: "e2".repeat(32),
            mix: "e3".repeat(32),
            pool: old,
            box: { txHash: "e2".repeat(32), txIndex: 0 },
            leaf: { txHash: "e3".repeat(32), txIndex: 0 },
            tries: 0,
          },
        },
      ],
      mixes: [{ id: "b0".repeat(32), deposit: "b0".repeat(32), at: t.clock.now, bootstrap: true, found: true, shares: [{ boxes: 2 }] }],
    });
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS);
    await lj.withdrawDue("preprod", true);
    const s = await sealed(t);
    expect(s.retired).toBe(t.clock.now);
    expect(s.mixes?.find((e) => e.bootstrap)?.released).toBe(true);
    expect(s.chains[0]?.tail?.over).toBe(true);
  });

  it("writes nothing for a wallet with nothing in a retired pool", async () => {
    const t = await wallet();
    const lj = pooled(t);
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, await fiveBox(t, "f1"));
    await lj.status("preprod");
    await lj.withdrawDue("preprod", true);
    const s = await sealed(t);
    expect(s.retired).toBeUndefined();
    expect(s.bringing).toBeUndefined();
    expect(s.pools?.[ADA]?.due).toHaveLength(1);
  });
});

describe("the screens list a retired pool only while the wallet has boxes there (chunk 44, the owner's call 1)", () => {
  const status = (boxes: number) => ({
    available: true,
    others: 20,
    free: 20,
    floor: 0,
    boxes: Array.from({ length: boxes }, (_, i) => ({ txHash: "c1".repeat(32), txIndex: i })),
    lovelace: String(boxes * 10_000_000),
    due: [],
    notMixed: [],
    fromPublic: [],
    chains: [],
    unusable: { why: "retired" as const },
    pools: [
      {
        id: ADA,
        version: "v2" as const,
        box: { lovelace: ADA_BOX.toString() },
        others: 20,
        free: 20,
        floor: 0,
        boxes: [],
        lovelace: "0",
        due: [],
        notMixed: [],
        fromPublic: [],
      },
    ],
  });

  it("hides the classic pool with nothing of the wallet's in it, and shows it, retired, with a box there", () => {
    const [classic, five] = poolsOf(status(0));
    expect(shownRetired(classic!)).toBe(true);
    expect(shownOnHub(classic!)).toBe(false);
    expect(shownOnHub(five!)).toBe(true);
    const [held] = poolsOf(status(1));
    expect(shownOnHub(held!)).toBe(true);
    expect(held!.unusable).toEqual({ why: "retired" });
  });

  it("says nothing was left only where the retired pools' run ran", () => {
    const held: LovejoinHeld = {
      boxes: 0,
      lovelace: "0",
      next: null,
      notMixed: 0,
      stopped: 0,
      pools: [
        { id: ADA, boxes: 2, lovelace: "10000000", next: 1, notMixed: 0 },
        { id: OLD_TOKEN, boxes: 0, lovelace: "0", next: null, notMixed: 0, retired: true },
      ],
    };
    // The retired pools held nothing of the wallet's: none left there, though the 5 ₳ pool has boxes.
    expect(doneOf({ back: 0, retired: true }, held)).toBe(0);
    // Every pool's: the 5 ₳ pool's boxes are still there.
    expect(doneOf({ back: 0 }, held)).toBeUndefined();
    // A box of the old token pool's still there: nothing said.
    expect(doneOf({ back: 0, retired: true }, { ...held, pools: [{ ...held.pools![1]!, boxes: 1 }] })).toBeUndefined();
  });
});
