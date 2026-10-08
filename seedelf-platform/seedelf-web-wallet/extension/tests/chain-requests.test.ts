// The worker's answers about a chain through Lovejoin that the pages ask for
// again and again, from the device alone (1.3.0's release review, C28, C30): the
// Lovejoin page's rows, read again while a chain is sent; Transaction details
// of one of a chain's transactions once the chain has moved on; and the lock
// countdown's question, whether any chain on any network is being sent.
import { describe, expect, it } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import { SESSION_LOVEJOIN_SENDING } from "../src/background/lovejoin";
import { NetworkChoice } from "../src/background/preferences";
import { CHAIN_MOVED, NOT_HELD } from "../src/background/tx-view";
import type { NetworkName } from "../src/networks";
import type { Message } from "../src/shared/rpc";
import { account, PASSWORD } from "./chain-fixtures";
import { loadTestWasm, testBalances } from "./fakes";

/** A context as the worker builds one, on `network`, for a build with `networks`. */
function context(t: ReturnType<typeof testBalances>, network: NetworkName, networks: NetworkName[]): Context {
  return {
    ...t,
    wasm: loadTestWasm(),
    connector: async (on) => on,
    version: "1.3.0",
    network,
    networks,
    networkChoice: new NetworkChoice(t.local, networks),
  } as Context;
}

const ask = <M extends Message>(message: M, ctx: Context) => handle(message, ctx);

/** A chain of two (a deposit and a mix), recorded on preprod, whose progress is where a public mix's waits. */
const chainOf = (h: string) => (["deposit", "mix"] as const).map((kind, i) => ({ kind, txCbor: "", txHash: h.repeat(31) + `0${i}`, fee: "0" }));
const KEY = SESSION_LOVEJOIN_SENDING + "preprod";

async function sending(t: ReturnType<typeof testBalances>, txs = chainOf("a1")) {
  await t.lovejoin.recordChain("preprod", { progress: KEY, txs, leaves: [], boxes: 1 }, async () => {
    await t.wallet.withKeys(() => t.session.set(KEY, { txs, next: 1, flying: [txs[0]!.txHash] }));
  });
  return txs;
}

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

describe("a chain's rows, read again (lovejoin-chains)", () => {
  it("lists the chain being sent and where each transaction is, from the device alone, and none once it's all sent", async () => {
    const t = await unlocked();
    const ctx = context(t, "preprod", ["preprod"]);
    const txs = await sending(t);
    const asked = t.koios.calls.length;
    const rows = await ask({ type: "lovejoin-chains" }, ctx);
    expect(rows).toEqual([
      {
        boxes: 1,
        total: 2,
        sent: 0,
        at: expect.any(Number),
        txs: [
          { txHash: txs[0]!.txHash, kind: "deposit", state: "sent" },
          { txHash: txs[1]!.txHash, kind: "mix", state: "waiting" },
        ],
      },
    ]);
    // No Koios request: the page asks every few seconds while a chain is sent.
    expect(t.koios.calls.length).toBe(asked);

    // All sent: its progress goes, as pumpPublicNow leaves it, and so does its row.
    await t.lovejoin.chainEnded("preprod", txs.at(-1)!.txHash);
    await t.wallet.withKeys(() => t.session.remove(KEY));
    expect(await ask({ type: "lovejoin-chains" }, ctx)).toEqual([]);
    expect(t.koios.calls.length).toBe(asked);
  });
});

describe("Transaction details of a chain's transaction after the chain moved on (tx-detail)", () => {
  it("says its chain moved on, not to review it again; anything else the wallet doesn't hold, as before", async () => {
    const t = await unlocked();
    const ctx = context(t, "preprod", ["preprod"]);
    const txs = await sending(t);
    await t.lovejoin.chainEnded("preprod", txs.at(-1)!.txHash);
    await t.wallet.withKeys(() => t.session.remove(KEY));
    for (const tx of txs) {
      await expect(ask({ type: "tx-detail", txHash: tx.txHash.toUpperCase() }, ctx)).rejects.toThrow(CHAIN_MOVED());
    }
    await expect(ask({ type: "tx-detail", txHash: "ab".repeat(32) }, ctx)).rejects.toThrow(NOT_HELD());
    // A chain on another network isn't this one's.
    await expect(ask({ type: "tx-detail", txHash: txs[0]!.txHash }, context(t, "mainnet", ["mainnet", "preprod"]))).rejects.toThrow(
      NOT_HELD(),
    );
  });
});

describe("whether a chain is being sent, for the lock countdown (chains-sending)", () => {
  it("says so for a chain on a network the wallet isn't showing, and asks every network", async () => {
    const t = await unlocked();
    await sending(t);
    // The wallet shows mainnet; the chain is preprod's. Locking stops it all the same.
    expect(await ask({ type: "chains-sending" }, context(t, "mainnet", ["mainnet", "preprod"]))).toBe(true);
    expect(await t.lovejoin.chainsSending("mainnet")).toBe(false);
    expect(await ask({ type: "chains-sending" }, context(t, "preprod", ["preprod"]))).toBe(true);
  });

  it("says nothing with no chain being sent, nor once it's all sent, nor while locked", async () => {
    const t = await unlocked();
    const ctx = context(t, "preprod", ["mainnet", "preprod"]);
    expect(await ask({ type: "chains-sending" }, ctx)).toBe(false);
    const txs = await sending(t);
    expect(await ask({ type: "chains-sending" }, ctx)).toBe(true);
    await t.lovejoin.chainEnded("preprod", txs.at(-1)!.txHash);
    await t.wallet.withKeys(() => t.session.remove(KEY));
    expect(await ask({ type: "chains-sending" }, ctx)).toBe(false);
    // Locked, nothing is read, and there's no chain to stop: a chain is sent only while the wallet is unlocked.
    await sending(t, chainOf("b2"));
    await t.wallet.lock();
    expect(await ask({ type: "chains-sending" }, ctx)).toBe(false);
  });
});
