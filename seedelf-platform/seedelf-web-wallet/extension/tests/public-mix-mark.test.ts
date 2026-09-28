// A mix from the public account's first transaction spends the account: its
// record says, sealed, that it may have gone from just before it's first sent
// until it's known. So a lock or a closed browser while it's sent, which
// wipes the progress, the spent cache and the reservation, never leaves a
// mix that says nothing went while its deposit lands: no other mix from the
// account is built until the network settles it (independent review L5).
import { describe, expect, it } from "vitest";

import { CHAIN_CUT } from "../src/background/lovejoin";
import { CHAINS, lovejoinOf, PASSWORD, publicFunded, type Tested } from "./chain-fixtures";

const DEPOSIT_INPUT = `${"e6".repeat(32)}#0`;

type Chain = { sent: number; stopped?: string; done?: boolean; maybe?: { index: number; unanswered?: true } };
const record = async (t: Tested) => (await t.store.get<{ chains: Chain[] }>("lovejoin.preprod"))!.chains.at(-1)!;

describe("a mix from the public account's first transaction, marked while it's sent (independent review L5)", CHAINS, () => {
  it("is looked for after a lock while it waited to be tried again, and no other mix is built until it's settled", async () => {
    const t = await publicFunded("60000000", ["60000000"]);
    const locking = lovejoinOf(t, { sleep: () => t.wallet.lock() });
    const mix = await locking.publicBuild("preprod", 1);
    // Its deposit's first submit reaches the node, and Koios's answer is lost; the wallet locks while the send
    // waits to try it again.
    const fetch = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx") && submits++ === 0) {
        await fetch(url, init);
        throw new TypeError("Failed to fetch");
      }
      return fetch(url, init);
    };
    await expect(locking.publicSubmit("preprod", mix.txHash)).rejects.toThrow(/locked/i);
    expect(submits).toBe(1);
    await t.wallet.unlock(PASSWORD);

    // It says the deposit may have gone through, and no mix from the account is built meanwhile.
    expect(await t.lovejoin.progress("preprod")).toEqual({ total: 5, sent: 0, stopped: CHAIN_CUT, maybeSent: true });
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("may have gone through");
    expect((await t.lovejoin.status("preprod")).chains).toEqual([expect.objectContaining({ sent: 0, maybeSent: true })]);

    // It lands: the mix says its deposit went, and another may be built from what's left.
    t.koios.spent.add(DEPOSIT_INPUT);
    t.koios.confirmations = 1;
    await t.lovejoin.publicBuild("preprod", 1);
    expect(await record(t)).toMatchObject({
      sent: 1,
      stopped: "The wallet locked, or the browser closed, as its deposit was sent. It went through, and the mix stopped there.",
    });
    expect((await record(t)).maybe).toBeUndefined();
  });

  it("is looked for when the wallet locked as its deposit's answer came in", async () => {
    const t = await publicFunded();
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    // Its deposit goes, and the wallet locks before the answer is taken in: a closed browser leaves the same.
    const fetch = t.koios.fetch;
    let locked = false;
    t.koios.fetch = async (url, init) => {
      const answer = await fetch(url, init);
      if (url.endsWith("/submittx") && !locked) {
        locked = true;
        await t.wallet.lock();
      }
      return answer;
    };
    await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow(/locked/i);
    await t.wallet.unlock(PASSWORD);
    expect(await t.lovejoin.progress("preprod")).toEqual({ total: 5, sent: 0, stopped: CHAIN_CUT, maybeSent: true });
    await expect(t.lovejoin.publicAgainBuild("preprod")).rejects.toThrow("may have gone through");
    t.koios.confirmations = 1;
    expect(await t.lovejoin.progress("preprod")).toMatchObject({ sent: 1 });
    expect((await t.lovejoin.progress("preprod"))?.maybeSent).toBeUndefined();
  });

  it("goes once its deposit went: nothing is held back while the rest is sent, or after", async () => {
    const t = await publicFunded();
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    await t.lovejoin.publicSubmit("preprod", mix.txHash);
    expect((await record(t)).maybe).toBeUndefined();
    t.koios.confirmations = 1;
    while (await t.lovejoin.pumpPublic("preprod", 0));
    expect(await record(t)).toMatchObject({ done: true, sent: 5 });
    expect((await record(t)).maybe).toBeUndefined();
    await t.lovejoin.publicAgainBuild("preprod").catch((e: unknown) => expect(String(e)).not.toMatch("may have gone through"));
  });

  it("goes when the network refused its deposit outright: another may be built at once", async () => {
    const t = await publicFunded();
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    t.koios.rejectSubmit = "ConwayUtxowFailure (UtxoFailure (FeeTooSmallUTxO))";
    await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow();
    delete t.koios.rejectSubmit;
    expect((await record(t)).maybe).toBeUndefined();
    const progress = await t.lovejoin.progress("preprod");
    expect(progress).toMatchObject({ total: 5, sent: 0 });
    expect(progress?.maybeSent).toBeUndefined();
    await t.lovejoin.publicBuild("preprod", 1);
  });
});
