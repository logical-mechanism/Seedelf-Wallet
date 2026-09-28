// A mix from the public account whose later transaction a try Koios didn't
// answer may have put in keeps knowing that across calls: a resend of the
// transactions before it (independent review L25) doesn't make the next
// call take it for one that never went. Refused again while it waits in a
// mempool, the mix stops as "may have gone through", what it spends stays
// held and counted as spent, and it's settled once the network shows it
// (independent review L5, final review F10).
import { describe, expect, it } from "vitest";

import { CHAIN_PUMP_MS, SESSION_LOVEJOIN_PUBLIC, SESSION_LOVEJOIN_SENDING } from "../src/background/lovejoin";
import { reservationOf, SESSION_RESERVED_PREFIX, spentSet } from "../src/background/spent";
import { txIdOf } from "./fixtures/cbor";
import { chainNet, CHAINS, lovejoinOf, publicFunded } from "./chain-fixtures";

describe("a public mix's later transaction a try may have put in (final review F10)", CHAINS, () => {
  it("stops as maybe gone through, holding what it spends, when it's refused again after its parents went again", async () => {
    const t = await publicFunded();
    let first = true;
    const lovejoin = lovejoinOf(t, {
      sleep: async (ms) => {
        // The first back-off: a block takes the three mixes before the last, which stays in the mempool.
        if (first) {
          first = false;
          net.block(3);
        }
        t.clock.now += ms;
        await t.wallet.touch();
      },
    });
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const summary = await lovejoin.publicBuild("preprod", 4);
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string; txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const chain = kept!.chain;
    const order = chain.map((c) => c.txHash);
    expect(order).toHaveLength(5);
    const net = chainNet(t, () => order);
    // The last mix's first submit reaches the node, and Koios's answer is lost.
    const inNet = t.koios.fetch;
    let lost = false;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx") && !lost && txIdOf(new Uint8Array(init!.body as Uint8Array)) === order[4]) {
        lost = true;
        await inNet(url, init);
        throw new TypeError("Failed to fetch");
      }
      return inNet(url, init);
    };
    await lovejoin.publicSubmit("preprod", summary.txHash);
    expect(net.mempool).toEqual(order.slice(0, 4));
    // A block takes the deposit. The next call sends the last mix: into the mempool, unanswered, then refused as it's
    // there while the three before it are taken as sent again (L25).
    net.block(1);
    expect(await lovejoin.pumpPublic("preprod", CHAIN_PUMP_MS)).toBe(true);
    expect(lost).toBe(true);
    expect(net.mempool).toEqual([order[4]]);
    const progress = await t.wallet.withKeys(() => t.session.get<{ next: number; sending?: number }>(SESSION_LOVEJOIN_SENDING + "preprod"));
    expect(progress).toMatchObject({ next: 4 });
    expect(progress?.sending).toBeUndefined();
    // The next call, the last mix still in the mempool and refused each time: it may have gone through.
    await expect(lovejoin.pumpPublic("preprod", CHAIN_PUMP_MS)).rejects.toThrow("may have gone through");
    expect(await lovejoin.progress("preprod")).toEqual({
      total: 5,
      sent: 4,
      stopped: "Koios didn't answer when its transaction 5 of 5 was sent, so it may have gone through. The wallet looks for it on chain before another mix from your public account is built.",
      maybeSent: true,
    });
    const last = reservationOf([chain[4]!]);
    const reserved = await t.wallet.withKeys(() => t.session.get<Record<string, { inputs: string[] }>>(SESSION_RESERVED_PREFIX + "preprod"));
    expect(reserved?.public?.inputs).toEqual(last.inputs);
    const spent = await t.wallet.withKeys(() => spentSet(t.session, t.clock.now));
    for (const o of last.inputs) expect(spent).toContain(o);
    const record = (await t.store.get<{ chains: Array<{ maybe?: { index: number }; unscheduled?: number }> }>("lovejoin.preprod"))!.chains.at(-1)!;
    expect(record.maybe).toMatchObject({ index: 4 });
    await expect(lovejoin.publicBuild("preprod", 1)).rejects.toThrow("may have gone through");
    // It lands: settled, it went, and nothing is held for it anymore.
    net.block();
    await lovejoin.publicBuild("preprod", 1).catch(() => undefined);
    expect((await t.lovejoin.progress("preprod"))?.maybeSent).toBeUndefined();
    const settled = (await t.store.get<{ chains: Array<{ maybe?: unknown; sent: number; stopped?: string }> }>("lovejoin.preprod"))!.chains.find(
      (c) => c.sent === 5,
    );
    expect(settled?.stopped).toBe("Koios didn't answer when its transaction 5 of 5 was sent. It went through, and the mix stopped there.");
  });
});
