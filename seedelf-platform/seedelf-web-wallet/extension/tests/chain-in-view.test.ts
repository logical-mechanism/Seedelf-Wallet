// A chain through Lovejoin while it's being sent (chunk 17's handoff note,
// the post-release roadmap's O3). Its transactions move from the key they
// were kept for Send under to where the chain is sent from, which the
// transaction view didn't look in, and Home's banner named the last of a mix
// from the public account, a hash the user never saw and not on chain for
// minutes yet. Now the banner names its first, the one the review showed,
// until the last lands (a session's return is watched on its page, not by
// Home's banner); the Lovejoin page's row lists each transaction of either,
// and where it is, read again as the page stays open; and Transaction details
// opens any of them, as a chain's being sent (1.3.0's release review, C17, C28,
// C29, C45).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CHAIN_PUMP_MS,
  CHAIN_SPENT_TRIES,
  chainTxsOf,
  type LovejoinService,
  SESSION_LOVEJOIN_PUBLIC,
  SESSION_LOVEJOIN_SENDING,
} from "../src/background/lovejoin";
import { SESSION_BACK } from "../src/background/sessions";
import { CHAIN_MOVED, NOT_HELD, txView } from "../src/background/tx-view";
import type { TxView } from "../src/shared/rpc";
import { TxDetailBody } from "../src/ui/components/TxDetail";
import { NetworkContext } from "../src/ui/network";
import { chainNet, CHAINS, lovejoinOf, publicFunded, sessionsOf, withSession, type Tested } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";

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

/** The same, asking `lovejoin` whether a hash it doesn't hold is one of a chain's, as the worker's tx-detail does. */
const viewWith = (t: Tested, indices: number[], lovejoin: LovejoinService) => ({
  ...viewOf(t, indices),
  inChain: (network: "preprod" | "mainnet", txHash: string) => lovejoin.inChain(network, txHash),
});

/** Counts every request to Koios from here on, those chainNet answers itself included. */
function counting(t: Tested) {
  const inner = t.koios.fetch;
  const asked = { n: 0 };
  t.koios.fetch = async (url, init) => {
    asked.n++;
    return inner(url, init);
  };
  return asked;
}

/** What Transaction details says of the view's answer, as its modal passes it on (TxDetail.tsx TxDetailModal). */
const signatures = (view: TxView) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(TxDetailBody, { detail: view.detail, network: "preprod", testId: "tx", chain: view.chain }),
    ),
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

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
    // Before Send, its review's first transaction is one the wallet holds for Send, not one of a chain being sent.
    expect((await txView(viewOf(t, []), "preprod", order[0]!)).chain).toBeUndefined();

    const pending = await lovejoin.publicSubmit("preprod", summary.txHash);
    // The watch waits on the last; the banner names the first, as the review did.
    expect(pending.txHash).toBe(order[4]);
    expect(pending.chain).toEqual({ first: order[0], total: 5 });
    // That's what Home's banner reads: the watch pending-tx answers with.
    expect((await t.pending.pending("preprod"))?.chain).toEqual({ first: order[0], total: 5 });

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
    // The page reads its rows again as it stays open, from the device alone: no Koios request (1.3.0's release
    // review, C28), so a row never lists what's gone since the page opened.
    const asked = counting(t);
    expect(await lovejoin.chains("preprod")).toEqual([row]);
    expect(asked.n).toBe(0);

    // Each opens in the view, sent or not: the one not sent yet too. The view knows it's a chain's being sent, and
    // so never says its signatures wait for a confirm: Send was pressed, and the list beside it says where each is
    // (1.3.0's release review, C17).
    for (const hash of [order[0]!, order[4]!]) {
      const view = await txView(viewOf(t, []), "preprod", hash);
      expect(view.detail.txHash).toBe(hash);
      expect(view.chain).toBe(true);
      const page = signatures(view);
      expect(page).toContain("Signatures 1, made when the chain was prepared");
      expect(page).not.toContain("not sent until you confirm");
    }
    // Not on the other network, as a record kept for Send isn't.
    await expect(txView(viewOf(t, []), "mainnet", order[0]!)).rejects.toThrow(NOT_HELD());

    // All sent, it's no longer the wallet's to hold: the row goes, and the view has it no more.
    net.block(5);
    await lovejoin.pumpPublic("preprod", CHAIN_PUMP_MS);
    expect((await lovejoin.status("preprod")).chains).toEqual([]);
    expect(await lovejoin.chains("preprod")).toEqual([]);
    await expect(txView(viewOf(t, []), "preprod", order[0]!)).rejects.toThrow(NOT_HELD());
    // Opened from a list read before it went, it says its chain moved on, not "Review it again" (C28).
    await expect(txView(viewWith(t, [], lovejoin), "preprod", order[0]!)).rejects.toThrow(CHAIN_MOVED());
  });

  it("a chain of four or fewer, all sent at Send: never listed, and each of its transactions says its chain moved on", async () => {
    const t = await publicFunded();
    const lovejoin = lovejoinOf(t, { sleep: passing(t) });
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const summary = await lovejoin.publicBuild("preprod", 2);
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const order = kept!.chain.map((c) => c.txHash);
    expect(order).toHaveLength(3);
    const net = chainNet(t, () => order);
    await lovejoin.publicSubmit("preprod", summary.txHash);
    // All three wait in the mempool, and the wallet holds none of them: the view shows only what it holds.
    expect(net.mempool).toEqual(order);
    expect(await lovejoin.progress("preprod")).toBeNull();
    expect(await lovejoin.chains("preprod")).toEqual([]);
    for (const hash of order) {
      await expect(txView(viewOf(t, []), "preprod", hash)).rejects.toThrow(NOT_HELD());
      await expect(txView(viewWith(t, [], lovejoin), "preprod", hash)).rejects.toThrow(CHAIN_MOVED());
    }
    // Anything else it doesn't hold is still for a review to build again.
    await expect(txView(viewWith(t, [], lovejoin), "preprod", "ab".repeat(32))).rejects.toThrow(NOT_HELD());
    await expect(txView(viewWith(t, [], lovejoin), "mainnet", order[0]!)).rejects.toThrow(NOT_HELD());
  });

  it("a session's return: its row lists each where it is, and each opens, found where that session's chain is sent from", async () => {
    const { t } = await withSession("40000000");
    const sessions = sessionsOf(t, passing(t));
    const review = await sessions.backBuild("preprod", 0);
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string }> }>(SESSION_BACK));
    const order = kept!.chain.map((c) => c.txHash);
    const net = chainNet(t, () => order);

    const pending = await sessions.backSubmit("preprod", review.txHash);
    expect(pending.txHash).toBe(order.at(-1));
    expect(pending.chain).toEqual({ first: order[0], total: order.length });
    // But its page watches it, not Home's banner: Home's watch holds nothing of it (sessions.ts sendRecorded; 1.3.0's
    // release review, C45).
    expect(await t.pending.pending("preprod")).toBeNull();

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
    const view = await txView(viewOf(t, [0]), "preprod", middle);
    expect(view.detail.txHash).toBe(middle);
    expect(view.chain).toBe(true);
    expect(signatures(view)).not.toContain("not sent until you confirm");
    await expect(txView(viewOf(t, []), "preprod", middle)).rejects.toThrow(NOT_HELD());

    // All sent, its row goes from the rows the page reads again; one of its transactions, opened from the list
    // read before, says its chain moved on, not "Review it again" (1.3.0's release review, C28).
    for (let i = 0; i < 10 && (await t.lovejoin.chains("preprod")).length; i++) {
      net.block(3);
      await sessions.runAll("preprod");
    }
    expect(await t.lovejoin.chains("preprod")).toEqual([]);
    await expect(txView(viewOf(t, [0]), "preprod", middle)).rejects.toThrow(NOT_HELD());
    await expect(txView(viewWith(t, [0], t.lovejoin), "preprod", middle)).rejects.toThrow(CHAIN_MOVED());
  });
});

// A transaction whose send began, or a try of which may have reached a node, is never listed "Not sent yet": it
// may be in a mempool, or on chain, already (1.3.0's release review, C29; independent review L5's rule). It isn't
// "Sent" either: the count beside the list ("4 of 5 transactions sent") counts only sends that finished.
describe("a chain's transaction whose send began", () => {
  const txs = ["a1", "b2", "c3"].map((h) => ({ kind: "mix" as const, txHash: h.repeat(32), txCbor: "", fee: "0" }));
  const states = (progress: Parameters<typeof chainTxsOf>[0]) => chainTxsOf(progress).map((tx) => tx.state);

  it("is being sent, from when its send begins, and while a try Koios didn't answer may have put it in", () => {
    expect(states({ txs, next: 1, flying: [txs[0]!.txHash], sending: 1 })).toEqual(["sent", "sending", "waiting"]);
    expect(states({ txs, next: 1, flying: [txs[0]!.txHash], reached: 1 })).toEqual(["sent", "sending", "waiting"]);
    // Sending one in the mempool again (pumpChain's resend) changes nothing: it's sent, and the next isn't begun.
    expect(states({ txs, next: 1, flying: [txs[0]!.txHash], sending: 0 })).toEqual(["sent", "waiting", "waiting"]);
    expect(states({ txs, next: 2, flying: [txs[1]!.txHash] })).toEqual(["landed", "sent", "waiting"]);
  });
});

describe("a mix from the public account whose transaction may be in already", CHAINS, () => {
  /** A public mix of 5 (depth 1, 4 boxes) whose transaction 1 the node takes on its first try, while Koios loses the answer. */
  async function lostAnswer(sleep: (t: Tested, lovejoin: () => LovejoinService, ms: number) => Promise<void>) {
    const t = await publicFunded();
    let lovejoin!: LovejoinService;
    let order: string[] = [];
    lovejoin = lovejoinOf(t, { sleep: (ms) => sleep(t, () => lovejoin, ms) });
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const summary = await lovejoin.publicBuild("preprod", 4);
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    order = kept!.chain.map((c) => c.txHash);
    const net = chainNet(t, () => order);
    const inner = t.koios.fetch;
    let lost = false;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx") && !lost && txIdOf(new Uint8Array(init!.body as Uint8Array)) === order[1]) {
        lost = true;
        await inner(url, init);
        return new Response("upstream request timeout", { status: 504 });
      }
      return inner(url, init);
    };
    return { t, lovejoin, order, net, send: () => lovejoin.publicSubmit("preprod", summary.txHash) };
  }

  it("lists it as being sent while its send waits to try again, not as not sent yet", async () => {
    const seen: Array<{ states: string[]; sent?: number; inMempool: boolean }> = [];
    let net!: ReturnType<typeof chainNet>;
    let order: string[] = [];
    const mix = await lostAnswer(async (t, lovejoin, ms) => {
      // What the page's poll reads meanwhile (without advance), and whether tx 1 is in the mempool.
      const progress = await lovejoin().progress("preprod");
      seen.push({ states: progress?.txs?.map((tx) => tx.state) ?? [], sent: progress?.sent, inMempool: net.mempool.includes(order[1]!) });
      // A block takes the mempool during the second back-off: the next try finds tx 1 on chain, and it's sent.
      if (seen.length === 2) net.block(5);
      t.clock.now += ms;
      await t.wallet.touch();
    });
    ({ net, order } = mix);
    await mix.send();
    expect(seen[0]).toEqual({ states: ["sent", "sending", "waiting", "waiting", "waiting"], sent: 1, inMempool: true });
    // Once its send has gone, it's sent, as the count says.
    expect((await mix.lovejoin.progress("preprod"))?.txs?.[1]?.state).toBe("sent");
  });

  it("lists it as being sent between calls, once a try that may have put it in was kept with the progress (reached)", async () => {
    let sleeps = 0;
    let net!: ReturnType<typeof chainNet>;
    const mix = await lostAnswer(async (t, _lovejoin, ms) => {
      // One busy back-off and every spent one for tx 1; then the deposit is sent again, and only it lands.
      if (++sleeps === CHAIN_SPENT_TRIES + 2) net.block(1);
      t.clock.now += ms;
      await t.wallet.touch();
    });
    ({ net } = mix);
    await mix.send();
    const kept = await mix.t.wallet.withKeys(() =>
      mix.t.session.get<{ next: number; sending?: number; reached?: number; stopped?: string }>(SESSION_LOVEJOIN_SENDING + "preprod"),
    );
    expect(kept).toMatchObject({ next: 1, reached: 1 });
    expect(kept?.sending).toBeUndefined();
    expect(kept?.stopped).toBeUndefined();
    expect(net.mempool).toContain(mix.order[1]);
    const progress = await mix.lovejoin.progress("preprod");
    expect(progress?.sent).toBe(1);
    // The deposit landed, though nothing has looked for it since (a full window would): still sent, as far as the list knows.
    expect(progress?.txs?.map((tx) => tx.state)).toEqual(["sent", "sending", "waiting", "waiting", "waiting"]);
  });
});
