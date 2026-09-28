// A site's transaction that Koios didn't answer for, with it sent, may land
// (independent review M3): the site hears its id, never "failed", so it
// doesn't build the payment again from other UTxOs; what it spends is kept
// as spent, it's kept as sent for the site to build on, and it's looked for
// and sent again a few times first. The bridge says a send cut off by a
// worker restart may have gone through.
import { describe, expect, it } from "vitest";

import { SESSION_DAPP_SIGNED, type DappSession } from "../src/background/dapp";
import { txInputs } from "../src/background/cbor";
import { SESSION_SEND } from "../src/background/send";
import { SESSION_SPENT_SITES, spentSet } from "../src/background/spent";
import { cutOff, TxSendError } from "../src/shared/dapp";
import { testBalances, vectors } from "./fakes";
import { txIdOf } from "./fixtures/cbor";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `maybe${++pages}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

/** A connected site, and a payment from the account the site is about to send (the wallet's own Send built it). */
async function ready() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const s = site();
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  await enabling;
  const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
  const tx = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
  const bytes = Uint8Array.from(Buffer.from(tx, "hex"));
  return { t, s, tx, id: summary.txHash, inputs: txInputs(bytes) };
}

type T = Awaited<ReturnType<typeof ready>>["t"];

/**
 * Koios's submits go as `answer` says, the node taking the transaction or
 * not; everything else as the fake answers.
 */
function submits(t: T, answer: (n: number) => "taken-504" | "timeout" | "429" | "ok") {
  const real = t.koios.fetch;
  let n = 0;
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx")) return real(url, init);
    const how = answer(n++);
    if (how === "ok") return real(url, init);
    if (how === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
    if (how === "429") return new Response("slow down", { status: 429 });
    // The node took it; the gateway's answer never came back whole.
    await real(url, init);
    return new Response("gateway timeout", { status: 504 });
  };
  return () => n;
}

const statusChecks = (t: T) => t.koios.calls.filter((c) => c.path === "tx_status").length;

describe("a site's transaction Koios didn't answer for", () => {
  it("is answered with its id, kept as sent, and sent again until a submit is taken", async () => {
    const { t, s, tx, id, inputs } = await ready();
    const offered = (await t.dapp.call(s, "getUtxos", [])) as string[];
    const tried = submits(t, (n) => (n === 0 ? "taken-504" : "ok"));

    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    // Looked for once, then sent again, the same bytes, and taken.
    expect(tried()).toBe(2);
    expect(statusChecks(t)).toBe(1);
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual([id, id]);

    // What it spends is spent, as far as every reading goes: a site building again gets other UTxOs, not these.
    const spent = await t.wallet.withKeys(() => spentSet(t.session));
    for (const o of inputs) expect(spent.has(o)).toBe(true);
    expect(Object.keys((await t.session.get<Record<string, number>>(SESSION_SPENT_SITES))!).sort()).toEqual([...inputs].sort());
    // Kept as sent: the site can build on it before it's on chain.
    expect(await t.session.get(SESSION_DAPP_SIGNED + "preprod")).toMatchObject([{ txHash: id, submittedAt: expect.any(Number) }]);
    t.clock.now += 31_000;
    const after = (await t.dapp.call(s, "getUtxos", [])) as string[];
    expect(after.length).toBeLessThan(offered.length);
  });

  it("is answered with its id even when Koios never answers again, after a few looks", async () => {
    const { t, s, tx, id } = await ready();
    const tried = submits(t, () => "timeout");
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    expect(tried()).toBe(4);
    expect(statusChecks(t)).toBe(3);
    expect(await t.session.get(SESSION_DAPP_SIGNED + "preprod")).toMatchObject([{ txHash: id }]);
  });

  it("isn't sent again once the chain shows it", async () => {
    const { t, s, tx, id } = await ready();
    const tried = submits(t, () => "taken-504");
    t.koios.confirmations = 1;
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    expect(tried()).toBe(1);
    expect(statusChecks(t)).toBe(1);
  });

  it("is a failure when Koios turned it away unsent (429): nothing is kept, and the site may send it again", async () => {
    const { t, s, tx } = await ready();
    submits(t, () => "429");
    await expect(t.dapp.call(s, "submitTx", [tx])).rejects.toMatchObject({
      failure: { code: TxSendError.Failure, info: expect.stringContaining("limiting requests") },
    });
    expect(statusChecks(t)).toBe(0);
    expect(t.session.data.has(SESSION_SPENT_SITES)).toBe(false);
    expect(await t.session.get(SESSION_DAPP_SIGNED + "preprod")).toBeUndefined();
  });
});

describe("a call the worker stopped under", () => {
  it("says a send may have gone through, and a signature that nothing was signed", () => {
    expect(cutOff("submitTx")).toBe(
      "Seedelf Wallet stopped before answering, and the transaction may have gone through. Check for it on chain before you send it again.",
    );
    expect(cutOff("signTx")).toBe("Seedelf Wallet stopped before answering, so nothing was signed. Try again.");
  });
});
