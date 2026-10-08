// A chain through Lovejoin while it's being sent (chunk 17's handoff note,
// the post-release roadmap's O3). Its transactions move from the key they
// were kept for Send under to where the chain is sent from, which the
// transaction view didn't look in, and Home's banner named the last of them, a
// hash the user never saw and not on chain for minutes yet. Now the banner
// names the first, the one the review showed, until the last lands; the
// Lovejoin page's row lists each transaction and where it is; and Transaction
// details opens any of them.
import { describe, expect, it } from "vitest";

import { CHAIN_PUMP_MS, SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { SESSION_BACK } from "../src/background/sessions";
import { NOT_HELD, txView } from "../src/background/tx-view";
import { chainNet, CHAINS, lovejoinOf, publicFunded, sessionsOf, withSession, type Tested } from "./chain-fixtures";

/** Time passes as the chain waits on the network. */
const passing = (t: Tested) => async (ms: number) => {
  t.clock.now += ms;
  await t.wallet.touch();
};

/** The view's deps, knowing of the sessions `indices`. */
const viewOf = (t: Tested, indices: number[]) => ({
  wasm: t.deps.wasm,
  wallet: t.wallet,
  session: t.session,
  sessionIndices: async () => indices,
});

describe("a chain through Lovejoin being sent", CHAINS, () => {
  it("from the public account: the banner names its first, the page lists each where it is, and each opens", async () => {
    const t = await publicFunded();
    const lovejoin = lovejoinOf(t, { sleep: passing(t) });
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const summary = await lovejoin.publicBuild("preprod", 4);
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const order = kept!.chain.map((c) => c.txHash);
    expect(order).toHaveLength(5);
    const net = chainNet(t, () => order);

    const pending = await lovejoin.publicSubmit("preprod", summary.txHash);
    // The watch waits on the last; the banner names the first, as the review did.
    expect(pending.txHash).toBe(order[4]);
    expect(pending.chain).toEqual({ first: order[0], total: 5 });

    const sent = net.mempool.length;
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThan(5);
    // The page's section for the public mix reads them live, from its progress, as its count.
    const progress = await lovejoin.progress("preprod");
    expect(progress?.sent).toBe(sent);
    expect(progress?.txs?.map((tx) => tx.state)).toEqual(order.map((_, i) => (i < sent ? "sent" : "waiting")));
    const [row] = (await lovejoin.status("preprod")).chains;
    expect(row!.txs?.map((tx) => tx.txHash)).toEqual(order);
    expect(row!.txs?.map((tx) => tx.kind)).toEqual(["deposit", "mix", "mix", "mix", "mix"]);
    expect(row!.txs?.map((tx) => tx.state)).toEqual(order.map((_, i) => (i < sent ? "sent" : "waiting")));

    // Each opens in the view, sent or not: the one not sent yet too.
    for (const hash of [order[0]!, order[4]!]) {
      expect((await txView(viewOf(t, []), "preprod", hash)).detail.txHash).toBe(hash);
    }
    // Not on the other network, as a record kept for Send isn't.
    await expect(txView(viewOf(t, []), "mainnet", order[0]!)).rejects.toThrow(NOT_HELD());

    // All sent, it's no longer the wallet's to hold: the row goes, and the view has it no more.
    net.block(5);
    await lovejoin.pumpPublic("preprod", CHAIN_PUMP_MS);
    expect((await lovejoin.status("preprod")).chains).toEqual([]);
    await expect(txView(viewOf(t, []), "preprod", order[0]!)).rejects.toThrow(NOT_HELD());
  });

  it("a session's return: the same, found where that session's chain is sent from", async () => {
    const { t } = await withSession("40000000");
    const sessions = sessionsOf(t, passing(t));
    const review = await sessions.backBuild("preprod", 0);
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string }> }>(SESSION_BACK));
    const order = kept!.chain.map((c) => c.txHash);
    const net = chainNet(t, () => order);

    const pending = await sessions.backSubmit("preprod", review.txHash);
    expect(pending.txHash).toBe(order.at(-1));
    expect(pending.chain).toEqual({ first: order[0], total: order.length });

    let [row] = (await t.lovejoin.status("preprod")).chains;
    expect(row!.session).toBe(0);
    expect(row!.txs?.map((tx) => tx.kind)).toEqual(["deposit", ...order.slice(1, -1).map(() => "mix"), "back"]);
    expect(row!.txs?.[0]?.state).toBe("sent");

    // A block takes the deposit: the next look marks it on chain, and the rest go on as they were.
    net.block(1);
    await sessions.runAll("preprod");
    [row] = (await t.lovejoin.status("preprod")).chains;
    expect(row!.txs?.[0]?.state).toBe("landed");
    expect(row!.txs?.at(-1)?.state).toBe("waiting");

    // Found through the session it's the chain of; a view that knows of no session has nowhere to look.
    const middle = order[Math.floor(order.length / 2)]!;
    expect((await txView(viewOf(t, [0]), "preprod", middle)).detail.txHash).toBe(middle);
    await expect(txView(viewOf(t, []), "preprod", middle)).rejects.toThrow(NOT_HELD());
  });
});
