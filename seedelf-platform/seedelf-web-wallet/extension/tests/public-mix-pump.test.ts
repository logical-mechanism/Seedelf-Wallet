// The public account's mix is pumped by its Send, the Lovejoin page's poll
// and the alarm, and only ever by one of them at a time on a network: the
// guard is claimed before anything is awaited, and is the network's own
// (independent review L26).
import { describe, expect, it } from "vitest";

import { SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { chainNet, CHAINS, lovejoinOf, publicFunded } from "./chain-fixtures";

describe("pumping a mix from the public account (independent review L26)", CHAINS, () => {
  async function sending() {
    const t = await publicFunded();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const passing = async (ms: number) => {
      t.clock.now += ms;
      await t.wallet.touch();
    };
    const lovejoin = lovejoinOf(t, { sleep: passing });
    const summary = await lovejoin.publicBuild("preprod", 4);
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const order = kept!.chain.map((c) => c.txHash);
    const net = chainNet(t, () => order);
    await lovejoin.publicSubmit("preprod", summary.txHash);
    return { t, lovejoin, net, order };
  }

  it("sends each transaction once when the alarm and the page's poll pump it at the same moment", async () => {
    const { lovejoin, net, order } = await sending();
    expect(net.submits).toEqual(order.slice(0, 4));
    net.block();
    const [alarm] = await Promise.all([lovejoin.pumpPublic("preprod", 0), lovejoin.progress("preprod", true)]);
    expect(alarm).toBe(false);
    // One of them sent the last mix, once; the other left it alone.
    expect(net.submits).toEqual(order);
    expect(net.refused).toBe(0);
    expect(await lovejoin.progress("preprod")).toBeNull();
    net.block(10);
    expect([...net.landed]).toEqual(order);
    expect((await lovejoin.held("preprod")).stopped).toBe(0);
  });

  it("keeps each network's pump its own: one waiting for blocks on preprod never holds mainnet's back", async () => {
    const { t, net } = await sending();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let entered!: () => void;
    const asleep = new Promise<void>((resolve) => (entered = resolve));
    // The alarm's pump on preprod looks for blocks, and waits.
    const waiting = lovejoinOf(t, {
      sleep: () => {
        entered();
        return gate;
      },
    });
    const preprod = waiting.pumpPublic("preprod");
    await asleep;
    // Mainnet has nothing being sent: its pump says so, rather than that one is running.
    expect(await waiting.pumpPublic("mainnet")).toBe(false);
    // And preprod's own is running already.
    expect(await waiting.pumpPublic("preprod")).toBe(true);
    net.block(10);
    open();
    expect(await preprod).toBe(false);
  });
});
