// Two chains built at the same time never draw the same pool box: a chain
// reserves what it spends as soon as WebAssembly has built it, before the
// network's check, and the one that reserves second, having read the pool
// before the first's reservation was there, is built again without those
// boxes (independent review L27).
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { SESSION_BACK } from "../src/background/sessions";
import { SESSION_RESERVED_PREFIX } from "../src/background/spent";
import { NETWORKS } from "../src/networks";
import { CHAINS, POOL, publicFunded, sessionsOf, withSession, atSession, type Tested } from "./chain-fixtures";

const hexBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const poolRefs = new Set(POOL.map((u) => `${u.tx_hash}#${u.tx_index}`));
/** The pool boxes a kept chain spends. */
const picks = (chain: Array<{ txCbor: string }>) => new Set(chain.flatMap((c) => txInputs(hexBytes(c.txCbor))).filter((o) => poolRefs.has(o)));

const MIX_BOX = NETWORKS.preprod.lovejoin!.mixBox;

/** Holds Koios's reads of Lovejoin's pool until `count` of them wait, then lets them all go at once. */
function poolReadsTogether(t: Tested, count: number) {
  const fetch = t.koios.fetch;
  let waiting = 0;
  let release!: () => void;
  const together = new Promise<void>((resolve) => (release = resolve));
  t.koios.fetch = async (url, init) => {
    const pool =
      new URL(url).pathname.endsWith("/credential_utxos") &&
      (JSON.parse(String(init!.body)) as { _payment_credentials: string[] })._payment_credentials.includes(MIX_BOX);
    if (pool) {
      if (++waiting >= count) release();
      await together;
    }
    return fetch(url, init);
  };
}

/** Holds Koios's Ogmios until `open` is called, and says when it's first asked. */
function ogmiosHeld(t: Tested) {
  const fetch = t.koios.fetch;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let asked!: () => void;
  const checking = new Promise<void>((resolve) => (asked = resolve));
  t.koios.fetch = async (url, init) => {
    if (url.endsWith("/ogmios")) {
      asked();
      await gate;
    }
    return fetch(url, init);
  };
  return { open, checking };
}

describe("chains built at the same time (independent review L27)", CHAINS, () => {
  it("never draw the same pool box: a session's return and a mix from the public account, their pool read at once", async () => {
    const t = await publicFunded();
    // Session 0 too, with 40 ₳ and its collateral.
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
    const sessions = sessionsOf(t);
    // Two waves deep, the return's two boxes take sixteen of the pool's twenty and the mix's one box eight: drawn
    // from the same read, they can't both have their own.
    poolReadsTogether(t, 2);
    const [back, mix] = await Promise.allSettled([sessions.backBuild("preprod", 0), t.lovejoin.publicBuild("preprod", 1)]);
    expect(back.status).toBe("fulfilled");
    const session = await t.wallet.withKeys(() => t.session.get<{ chain?: Array<{ txCbor: string }> }>(SESSION_BACK));
    const account = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const a = picks(session?.chain ?? []);
    const b = picks(account?.chain ?? []);
    // One of them was built again from what the other left, or found the pool too short, and says so.
    expect(a.size + b.size).toBeGreaterThan(0);
    expect([...a].filter((o) => b.has(o))).toEqual([]);
    if (mix.status === "rejected") expect(String(mix.reason)).toMatch(/boxes to mix with|pool/);
    if (!a.size) expect(back.status === "fulfilled" && back.value.lovejoinSkipped).toMatch("boxes to mix with");
    // What each reserved is apart too.
    const reserved = await t.wallet.withKeys(() => t.session.get<Record<string, { inputs: string[] }>>(SESSION_RESERVED_PREFIX + "preprod"));
    const kept = Object.values(reserved ?? {}).map((r) => r.inputs.filter((o) => poolRefs.has(o)));
    expect(new Set(kept.flat()).size).toBe(kept.flat().length);
  });

  it("keeps a chain's boxes from another's draw while the network checks it", async () => {
    const { t, sessions } = await withSession("40000000");
    const held = ogmiosHeld(t);
    const built = sessions.backBuild("preprod", 0);
    await held.checking;
    // The pool's twenty boxes: the return's two boxes take sixteen, reserved already.
    expect(await t.lovejoin.room("preprod")).toEqual({ others: 20, free: 4 });
    held.open();
    await built;
  });

  it("lets a mix's reservation go when the network's check refuses it", async () => {
    const t = await publicFunded();
    t.koios.evaluation = {
      jsonrpc: "2.0",
      method: "evaluateTransaction",
      error: { code: 3010, message: "Some scripts of the transactions terminated with error(s).", data: [] },
    };
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("so nothing was sent");
    const reserved = await t.wallet.withKeys(() => t.session.get<Record<string, unknown>>(SESSION_RESERVED_PREFIX + "preprod"));
    expect(reserved?.public).toBeUndefined();
    expect(await t.lovejoin.room("preprod")).toEqual({ others: 20, free: 20 });
  });
});
