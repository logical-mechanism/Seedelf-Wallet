// A mix from the public account being sent keeps its progress and its
// reservation, whatever another page does meanwhile: a Send waits for the
// one before, a Review whose build ends after a Send began never takes that
// mix's reservation, and a Send whose review lost its reservation to a later
// build is refused (independent review L30).
import { describe, expect, it } from "vitest";

import { SESSION_LOVEJOIN_PUBLIC, SESSION_LOVEJOIN_SENDING } from "../src/background/lovejoin";
import { SESSION_RESERVED_PREFIX } from "../src/background/spent";
import { NETWORKS } from "../src/networks";
import { CHAINS, publicFunded, type Tested } from "./chain-fixtures";

const MIX_BOX = NETWORKS.preprod.lovejoin!.mixBox;

const sendingNow = (t: Tested) =>
  t.wallet.withKeys(() => t.session.get<{ txs: Array<{ txHash: string }>; next: number }>(SESSION_LOVEJOIN_SENDING + "preprod"));
const publicReservation = async (t: Tested) =>
  (await t.wallet.withKeys(() => t.session.get<Record<string, { until?: number }>>(SESSION_RESERVED_PREFIX + "preprod")))?.public;

/** Holds the next read of Lovejoin's pool until `open` is called; `reading` says when it's asked. */
function poolReadHeld(t: Tested) {
  const fetch = t.koios.fetch;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let asked!: () => void;
  const reading = new Promise<void>((resolve) => (asked = resolve));
  let held = false;
  t.koios.fetch = async (url, init) => {
    const pool =
      new URL(url).pathname.endsWith("/credential_utxos") &&
      (JSON.parse(String(init!.body)) as { _payment_credentials: string[] })._payment_credentials.includes(MIX_BOX);
    if (!held && pool) {
      held = true;
      asked();
      await gate;
    }
    return fetch(url, init);
  };
  return { open, reading };
}

/** Holds Koios's next Ogmios check until `open` is called; `checking` says when it's asked. */
function ogmiosHeld(t: Tested) {
  const fetch = t.koios.fetch;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let asked!: () => void;
  const checking = new Promise<void>((resolve) => (asked = resolve));
  let held = false;
  t.koios.fetch = async (url, init) => {
    if (!held && url.endsWith("/ogmios")) {
      held = true;
      asked();
      await gate;
    }
    return fetch(url, init);
  };
  return { open, checking };
}

describe("two pages and a mix from the public account (independent review L30)", CHAINS, () => {
  it("never lets a Review that ends after a Send began take the mix being sent's reservation", async () => {
    const t = await publicFunded("120000000");
    // Page A reviews a mix.
    const first = await t.lovejoin.publicBuild("preprod", 1);
    // Page B presses Review: it reads the pool…
    const held = poolReadHeld(t);
    const second = t.lovejoin.publicBuild("preprod", 1);
    await held.reading;
    // …while page A presses Send.
    await t.lovejoin.publicSubmit("preprod", first.txHash);
    const sending = (await sendingNow(t))!;
    expect(sending.txs.at(-1)!.txHash).toBe(first.txHash);
    held.open();
    // B's review is refused: it would have taken the reservation of the mix being sent.
    await expect(second).rejects.toThrow("still being sent");
    expect((await publicReservation(t))?.until).toBeUndefined();
    expect((await sendingNow(t))!.txs.at(-1)!.txHash).toBe(first.txHash);
  });

  it("refuses a Send whose review another page's Review has since taken the place of", async () => {
    const t = await publicFunded("120000000");
    const first = await t.lovejoin.publicBuild("preprod", 1);
    // Page B's Review reserves its own mix, and the network is still checking it when page A presses Send.
    const held = ogmiosHeld(t);
    const second = t.lovejoin.publicBuild("preprod", 1);
    await held.checking;
    const submits = t.koios.submitted.length;
    await expect(t.lovejoin.publicSubmit("preprod", first.txHash)).rejects.toThrow("isn't ready to send");
    expect(t.koios.submitted.length).toBe(submits);
    expect(await sendingNow(t)).toBeUndefined();
    // Nothing is recorded as sent or stopped for it.
    expect((await t.lovejoin.held("preprod")).stopped).toBe(0);
    held.open();
    // B's goes as reviewed.
    const summary = await second;
    await t.lovejoin.publicSubmit("preprod", summary.txHash);
    expect((await sendingNow(t))!.txs.at(-1)!.txHash).toBe(summary.txHash);
  });

  it("never sends a mix kept for Send in place of one still being sent", async () => {
    const t = await publicFunded("120000000");
    // A mix reviewed earlier, as another page kept it.
    const earlier = await t.lovejoin.publicBuild("preprod", 1);
    const kept = await t.wallet.withKeys(() => t.session.get(SESSION_LOVEJOIN_PUBLIC));
    const first = await t.lovejoin.publicBuild("preprod", 1);
    await t.lovejoin.publicSubmit("preprod", first.txHash);
    await t.wallet.withKeys(() => t.session.set(SESSION_LOVEJOIN_PUBLIC, kept));
    const submits = t.koios.submitted.length;
    await expect(t.lovejoin.publicSubmit("preprod", earlier.txHash)).rejects.toThrow("still being sent");
    expect(t.koios.submitted.length).toBe(submits);
    expect((await sendingNow(t))!.txs.at(-1)!.txHash).toBe(first.txHash);
    expect((await publicReservation(t))?.until).toBeUndefined();
  });

  it("never holds every mix back for a reservation a stopped mix left as being sent (a write that failed)", async () => {
    const t = await publicFunded();
    await t.wallet.withKeys(() =>
      t.session.set(SESSION_RESERVED_PREFIX + "preprod", { public: { inputs: [`${"e6".repeat(32)}#0`], collateral: [`${"e5".repeat(32)}#0`] } }),
    );
    // Nothing is being sent from the account: the reservation goes, and the review is built.
    await t.lovejoin.publicBuild("preprod", 1);
    expect((await publicReservation(t))?.until).toBeDefined();
  });

  it("sends a mix once when its Send is pressed on two pages at once", async () => {
    const t = await publicFunded();
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    const submits = t.koios.submitted.length;
    const [a, b] = await Promise.allSettled([t.lovejoin.publicSubmit("preprod", mix.txHash), t.lovejoin.publicSubmit("preprod", mix.txHash)]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(String((a.status === "rejected" ? a : (b as PromiseRejectedResult)).reason)).toMatch("isn't ready to send");
    expect(t.koios.submitted.length - submits).toBe(4);
    expect(await t.lovejoin.progress("preprod")).toEqual({ total: 5, sent: 4, txs: expect.any(Array) });
  });
});
