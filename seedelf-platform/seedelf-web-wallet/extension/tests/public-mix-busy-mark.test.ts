// A mix from the public account's first transaction is marked as maybe gone
// before it's sent. While every answer so far says it never went (Koios
// asked the wallet to slow down), the mark goes as the send waits to try it
// again, and is back before the next try: a lock meanwhile then holds no
// other mix from the account back for two hours, while one after a try that
// may have reached a node still does (independent review L5).
import { describe, expect, it } from "vitest";

import { CHAIN_CUT } from "../src/background/lovejoin";
import { CHAINS, lovejoinOf, PASSWORD, publicFunded, type Tested } from "./chain-fixtures";

/** Koios's submits, each answered by the next of `answers` (the last, again and again): a 429, or a try that reaches the node and is never answered. */
function submits(t: Tested, answers: Array<"slow down" | "unanswered">) {
  const fetch = t.koios.fetch;
  const seen = { submits: 0 };
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx")) return fetch(url, init);
    const answer = answers[Math.min(seen.submits++, answers.length - 1)];
    if (answer === "slow down") return new Response("", { status: 429 });
    await fetch(url, init);
    throw new TypeError("Failed to fetch");
  };
  return { seen, restore: () => (t.koios.fetch = fetch) };
}

describe("a mix from the public account's deposit Koios asked the wallet to send more slowly (independent review L5)", CHAINS, () => {
  it("holds nothing back after a lock while it waited to try again: nothing went", async () => {
    const t = await publicFunded("60000000", ["60000000"]);
    const lovejoin = lovejoinOf(t, { sleep: () => t.wallet.lock() });
    const mix = await lovejoin.publicBuild("preprod", 1);
    const net = submits(t, ["slow down"]);
    await expect(lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow(/locked/i);
    expect(net.seen.submits).toBe(1);
    await t.wallet.unlock(PASSWORD);
    const progress = await t.lovejoin.progress("preprod");
    expect(progress).toEqual({ total: 5, sent: 0, stopped: CHAIN_CUT() });
    net.restore();
    await t.lovejoin.publicBuild("preprod", 1);
  });

  it("holds nothing back after a lock and an unlock while it waited", async () => {
    const t = await publicFunded("60000000", ["60000000"]);
    const lovejoin = lovejoinOf(t, {
      sleep: async () => {
        await t.wallet.lock();
        await t.wallet.unlock(PASSWORD);
      },
    });
    const mix = await lovejoin.publicBuild("preprod", 1);
    const net = submits(t, ["slow down"]);
    await expect(lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow(CHAIN_CUT());
    expect(await t.lovejoin.progress("preprod")).toEqual({ total: 5, sent: 0, stopped: CHAIN_CUT() });
    net.restore();
    await t.lovejoin.publicBuild("preprod", 1);
  });

  it("marks it again before the next try: one that may have reached a node is looked for after a lock", async () => {
    const t = await publicFunded("60000000", ["60000000"]);
    let waits = 0;
    const lovejoin = lovejoinOf(t, { sleep: async () => void (waits++ === 1 && (await t.wallet.lock())) });
    const mix = await lovejoin.publicBuild("preprod", 1);
    // A 429, then a try that reaches the node, unanswered; the wallet locks while the send waits after it.
    const net = submits(t, ["slow down", "unanswered"]);
    await expect(lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow(/locked/i);
    expect(net.seen.submits).toBe(2);
    await t.wallet.unlock(PASSWORD);
    expect(await t.lovejoin.progress("preprod")).toEqual({ total: 5, sent: 0, stopped: CHAIN_CUT(), maybeSent: true });
    net.restore();
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("may have gone through");
  });
});
