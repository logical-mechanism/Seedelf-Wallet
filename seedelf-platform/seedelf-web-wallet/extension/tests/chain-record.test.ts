// A chain is recorded, sealed, before its progress is where the Lovejoin
// page, the alarm or the runner can send it from, and before anything of it
// is reserved: so no chain is ever sent without a record, and one whose
// record can't be written never starts (independent review L28).
import { describe, expect, it } from "vitest";

import { CHAIN_CUT, SESSION_LOVEJOIN_SENDING } from "../src/background/lovejoin";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { SESSION_CHAIN_PREFIX } from "../src/background/sessions";
import { SESSION_RESERVED_PREFIX } from "../src/background/spent";
import { CHAINS, lovejoinOf, publicFunded, withSession, type Tested } from "./chain-fixtures";

/** The sealed Lovejoin record on preprod can't be written while `failing()`: local storage refuses it (its quota). */
function sealedRefused(t: Tested, failing: () => boolean) {
  const set = t.local.set.bind(t.local);
  t.local.set = async (key, value) => {
    if (key === `${PRIVATE_PREFIX}lovejoin.preprod` && failing()) throw new Error("QUOTA_BYTES quota exceeded");
    return set(key, value);
  };
}

const reserved = (t: Tested) => t.wallet.withKeys(() => t.session.get<Record<string, { until?: number }>>(SESSION_RESERVED_PREFIX + "preprod"));
const chains = async (t: Tested) => (await t.store.get<{ chains: Array<{ id: string; stopped?: string }> }>("lovejoin.preprod"))?.chains ?? [];

describe("a mix from the public account and its record (independent review L28)", CHAINS, () => {
  it("never starts when its record can't be written: nothing is left for the page or the alarm to send", async () => {
    const t = await publicFunded();
    const summary = await t.lovejoin.publicBuild("preprod", 1);
    let failing = true;
    sealedRefused(t, () => failing);
    const submits = t.koios.submitted.length;
    await expect(t.lovejoin.publicSubmit("preprod", summary.txHash)).rejects.toThrow("QUOTA_BYTES");
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_LOVEJOIN_SENDING + "preprod"))).toBeUndefined();
    expect(await t.lovejoin.pumpPublic("preprod")).toBe(false);
    expect(await t.lovejoin.progress("preprod", true)).toBeNull();
    expect(t.koios.submitted.length).toBe(submits);
    // Only the review's own reservation, kept for Send: nothing held as being sent.
    expect(Object.values((await reserved(t)) ?? {}).every((r) => r.until !== undefined)).toBe(true);
    // The review is still there: sent again once storage takes it, it goes, recorded.
    failing = false;
    await t.lovejoin.publicSubmit("preprod", summary.txHash);
    expect(t.koios.submitted.length).toBe(submits + 4);
    expect((await chains(t)).map((c) => c.id)).toEqual([summary.txHash]);
  });

  it("takes its record back, and lets go of what it reserved, when its progress can't be kept", async () => {
    const t = await publicFunded();
    const summary = await t.lovejoin.publicBuild("preprod", 1);
    const set = t.session.set.bind(t.session);
    t.session.set = async (key, value) => {
      if (key === SESSION_LOVEJOIN_SENDING + "preprod") throw new Error("QUOTA_BYTES quota exceeded");
      return set(key, value);
    };
    await expect(t.lovejoin.publicSubmit("preprod", summary.txHash)).rejects.toThrow("QUOTA_BYTES");
    expect(await chains(t)).toEqual([]);
    expect((await reserved(t))?.public).toBeUndefined();
    expect((await t.lovejoin.held("preprod")).stopped).toBe(0);
  });

  /** A chain of two, recorded as the public account's, whose progress `start` puts where it waits. */
  const chainOf = (h: string) => (["deposit", "mix"] as const).map((kind, i) => ({ kind, txCbor: "", txHash: h.repeat(31) + `0${i}`, fee: "0" }));
  const KEY = SESSION_LOVEJOIN_SENDING + "preprod";

  it("isn't taken for a chain a lock cut while its progress is being put where it waits", async () => {
    const t = await publicFunded();
    const txs = chainOf("a1");
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let entered!: () => void;
    const starting = new Promise<void>((resolve) => (entered = resolve));
    const recorded = t.lovejoin.recordChain("preprod", { progress: KEY, txs, leaves: [], boxes: 1 }, async () => {
      entered();
      await gate;
      await t.wallet.withKeys(() => t.session.set(KEY, { txs, next: 0, flying: [] }));
    });
    await starting;
    // Home asks meanwhile: the chain is recorded, being sent, and not cut.
    expect(await t.lovejoin.held("preprod")).toMatchObject({ stopped: 0 });
    open();
    await recorded;
    expect(await t.lovejoin.held("preprod")).toMatchObject({ stopped: 0 });
    expect(await t.lovejoin.progress("preprod")).toEqual({ total: 2, sent: 0, txs: expect.any(Array) });
  });

  it("lists none of an older chain's transactions under a newer one whose progress isn't where it waits yet", async () => {
    const t = await publicFunded();
    // An older mix, stopped, its progress still where the public account's mix waits.
    const older = chainOf("a1");
    await t.lovejoin.recordChain("preprod", { progress: KEY, txs: older, leaves: [], boxes: 1 });
    await t.wallet.withKeys(() => t.session.set(KEY, { txs: older, next: 1, flying: [], stopped: "The network rejected the transaction: X" }));
    const newer = chainOf("b1");
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let entered!: () => void;
    const starting = new Promise<void>((resolve) => (entered = resolve));
    const recorded = t.lovejoin.recordChain("preprod", { progress: KEY, txs: newer, leaves: [], boxes: 1 }, async () => {
      entered();
      await gate;
      await t.wallet.withKeys(() => t.session.set(KEY, { txs: newer, next: 0, flying: [] }));
    });
    await starting;
    // Meanwhile the slot holds the older chain's progress: the newer chain's row lists none of it (lovejoin.ts
    // chainTxs, 1.3.0's release review, C30).
    const rows = (await t.lovejoin.status("preprod")).chains;
    expect(rows.map((c) => [c.stopped === undefined ? "sending" : "stopped", c.txs])).toEqual([
      ["stopped", undefined],
      ["sending", undefined],
    ]);
    open();
    await recorded;
    expect((await t.lovejoin.chains("preprod")).at(-1)!.txs?.map((tx) => tx.txHash)).toEqual(newer.map((tx) => tx.txHash));
  });

  it("is taken for one a lock cut once the worker that was putting its progress there has stopped", async () => {
    const t = await publicFunded();
    const txs = chainOf("b1");
    let entered!: () => void;
    const starting = new Promise<void>((resolve) => (entered = resolve));
    void t.lovejoin.recordChain("preprod", { progress: KEY, txs, leaves: [], boxes: 1 }, () => {
      entered();
      return new Promise<void>(() => undefined);
    });
    await starting;
    // A new worker (the old one stopped here) finds the record and no progress: cut.
    const restarted = lovejoinOf(t);
    expect(await restarted.held("preprod")).toMatchObject({ stopped: 1 });
    expect((await chains(t)).map((c) => c.stopped)).toEqual([CHAIN_CUT()]);
  });
});

describe("a session's return chain and its record (independent review L28)", CHAINS, () => {
  it("never starts when its record can't be written: the runner finds nothing to send", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    sealedRefused(t, () => true);
    const submits = t.koios.submitted.length;
    await expect(sessions.backSubmit("preprod", review.txHash)).rejects.toThrow("QUOTA_BYTES");
    expect(await t.wallet.withKeys(() => t.session.get(`${SESSION_CHAIN_PREFIX}preprod.0`))).toBeUndefined();
    expect((await reserved(t))?.["session.0"]?.until).toBeDefined();
    // The session doesn't show a chain on its way.
    expect((await sessions.list("preprod"))[0]!.chain).toBeUndefined();
    await sessions.runAll("preprod");
    expect(t.koios.submitted.length).toBe(submits);
  });
});
