// A chain whose transactions a node dropped from its mempool (independent
// review L25): every transaction of the chain in the mempool goes again, in
// order, before the next is sent, since each spends the change of the one
// before; and a next one refused because what it builds on is gone has
// those sent again first, rather than stop the chain.
import { describe, expect, it } from "vitest";

import { SpentInputError } from "../src/background/koios";
import {
  CHAIN_POLL_MS,
  CHAIN_PUMP_MS,
  CHAIN_RESEND_MS,
  pumpChain,
  SESSION_LOVEJOIN_PUBLIC,
  type ChainProgress,
} from "../src/background/lovejoin";
import { SESSION_BACK } from "../src/background/sessions";
import { chainNet, CHAINS, lovejoinOf, publicFunded, withSession } from "./chain-fixtures";

/**
 * A chain of `n` and a mempool: a transaction goes in unless the one before
 * it is neither there nor on chain (refused as spent); one there already, or
 * on chain, counts as sent (the ledger took it once). `refuse`: a
 * transaction refused whatever happens (a pool box someone else spent).
 */
function modelled(n: number, refuse?: number) {
  const txs = Array.from({ length: n }, (_, i) => ({ kind: "mix" as const, txCbor: "", txHash: `t${i}`, fee: "0" }));
  const chain: ChainProgress = { txs, next: 0, flying: [] };
  const clock = { now: 0 };
  const net = { mempool: [] as string[], landed: new Set<string>() };
  const there = (h: string) => net.landed.has(h) || net.mempool.includes(h);
  const sent: Array<[number, boolean]> = [];
  const io = {
    send: async (i: number, maybeSent: boolean) => {
      sent.push([i, maybeSent]);
      const hash = txs[i]!.txHash;
      if (there(hash)) return;
      if (i === refuse || (i > 0 && !there(txs[i - 1]!.txHash))) throw new SpentInputError("already spent");
      net.mempool.push(hash);
    },
    onChain: async (hashes: string[]) => new Set(hashes.filter((h) => net.landed.has(h))),
    save: async () => undefined,
    sleep: async (ms: number) => void (clock.now += ms),
    now: () => clock.now,
  };
  const block = (count = 3) => {
    for (const h of net.mempool.splice(0, count)) net.landed.add(h);
  };
  return { chain, clock, net, sent, io, block };
}

describe("a chain a node dropped (independent review L25)", () => {
  it("sends every one in the mempool again, in order, once the oldest has waited a few blocks, and finishes", async () => {
    const { chain, net, sent, io, block } = modelled(8);
    expect(await pumpChain(chain, io, 0)).toBe(false);
    expect(net.mempool).toEqual(["t0", "t1", "t2", "t3"]);
    // The node that had them restarts: all four are gone.
    net.mempool.length = 0;
    expect(await pumpChain(chain, io, CHAIN_RESEND_MS)).toBe(false);
    expect(sent.slice(4)).toEqual([0, 1, 2, 3].map((i) => [i, true]));
    expect(net.mempool).toEqual(["t0", "t1", "t2", "t3"]);
    // Blocks take them, and the rest go on their change.
    for (let run = 0; run < 5 && chain.next < 8; run++) {
      block();
      await pumpChain(chain, io, 0);
    }
    block(8);
    expect(chain.next).toBe(8);
    expect(net.landed.size).toBe(8);
  });

  it("sends the ones after a landed transaction again when the next is refused for want of them, then the next", async () => {
    const { chain, net, sent, io, block } = modelled(8);
    await pumpChain(chain, io, 0);
    // A block takes the first; the node drops the three after it (a rollback's revalidation, say).
    block(1);
    net.mempool.length = 0;
    expect(await pumpChain(chain, io, 0)).toBe(false);
    // The next is refused (its parent is gone); the three go again in order, then it does.
    expect(sent.slice(4)).toEqual([
      [4, false],
      [1, true],
      [2, true],
      [3, true],
      [4, false],
    ]);
    expect(net.mempool).toEqual(["t1", "t2", "t3", "t4"]);
    expect(chain.flying).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("still stops at a next refused again after those went again: something else spent what it takes", async () => {
    const { chain, sent, io, block } = modelled(8, 4);
    await pumpChain(chain, io, 0);
    block(1);
    await expect(pumpChain(chain, io, 0)).rejects.toThrow(SpentInputError);
    // Tried twice, with the ones in the mempool sent again between (there already: the ledger has them once).
    expect(sent.slice(4).map(([i]) => i)).toEqual([4, 1, 2, 3, 4]);
  });

  it("stops at once for a refusal that isn't a spent input", async () => {
    const { chain, sent, io, block } = modelled(8);
    await pumpChain(chain, io, 0);
    block(1);
    io.send = async (i, maybeSent) => {
      sent.push([i, maybeSent]);
      throw new Error("The network rejected the transaction: ValueNotConservedUTxO");
    };
    await expect(pumpChain(chain, io, 0)).rejects.toThrow("ValueNotConserved");
    expect(sent.slice(4)).toEqual([[4, false]]);
  });

  it("never sends the next on a window the node dropped, when nothing has landed yet", async () => {
    const { chain, clock, sent, io } = modelled(8);
    await pumpChain(chain, io, 0);
    // Short of the resend's wait, nothing goes again, and nothing more is sent.
    await pumpChain(chain, io, CHAIN_RESEND_MS - CHAIN_POLL_MS);
    expect(sent).toHaveLength(4);
    expect(clock.now).toBe(CHAIN_RESEND_MS - CHAIN_POLL_MS);
  });
});

describe("a chain a node dropped, sent for real", CHAINS, () => {
  it("keeps a session's return going when a node drops the mixes after its deposit landed", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string }> }>(SESSION_BACK));
    const order = kept!.chain.map((c) => c.txHash);
    const net = chainNet(t, () => order);
    await sessions.backSubmit("preprod", review.txHash);
    expect(net.mempool).toEqual(order.slice(0, 4));
    // A block takes the deposit; the node drops the three mixes after it.
    net.block(1);
    net.drop();
    await sessions.runAll("preprod");
    // The fifth was refused for want of its parent: the three went again, in order, then it did.
    expect(net.mempool).toEqual(order.slice(1, 5));
    for (let run = 0; run < 6; run++) {
      net.block();
      await sessions.runAll("preprod");
    }
    net.block(10);
    expect([...net.landed]).toEqual(order);
    const view = (await sessions.list("preprod"))[0]!;
    expect(view.chain).toMatchObject({ total: 10, sent: 10 });
    expect(view.chain?.stopped).toBeUndefined();
    expect((await t.lovejoin.held("preprod")).stopped).toBe(0);
  });

  it("keeps a mix from the public account going when a node drops its whole first window", async () => {
    const t = await publicFunded();
    const lovejoin = lovejoinOf(t, {
      sleep: async (ms) => {
        t.clock.now += ms;
        await t.wallet.touch();
      },
    });
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const summary = await lovejoin.publicBuild("preprod", 4);
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const order = kept!.chain.map((c) => c.txHash);
    const net = chainNet(t, () => order);
    await lovejoin.publicSubmit("preprod", summary.txHash);
    expect(net.mempool).toEqual(order.slice(0, 4));
    // The node restarts before passing them on: all four are gone. Three minutes on, they all go again, in order.
    net.drop();
    t.clock.now += CHAIN_RESEND_MS;
    await t.wallet.touch();
    expect(await lovejoin.pumpPublic("preprod", 0)).toBe(true);
    expect(net.mempool).toEqual(order.slice(0, 4));
    // A block takes three, and the last mix goes on the fourth's change.
    net.block();
    expect(await lovejoin.pumpPublic("preprod", CHAIN_PUMP_MS)).toBe(false);
    net.block(10);
    expect([...net.landed]).toEqual(order);
    expect(await lovejoin.progress("preprod")).toBeNull();
    expect((await lovejoin.held("preprod")).stopped).toBe(0);
  });
});
