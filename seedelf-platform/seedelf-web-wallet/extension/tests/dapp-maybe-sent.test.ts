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
function submits(t: T, answer: (n: number) => "taken-504" | "timeout" | "429" | "in-mempool" | "ok") {
  const real = t.koios.fetch;
  let n = 0;
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx")) return real(url, init);
    const how = answer(n++);
    if (how === "ok") return real(url, init);
    if (how === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
    if (how === "429") return new Response("slow down", { status: 429 });
    // Taken before, and in a mempool: the node refuses it as spending what it spends itself.
    if (how === "in-mempool") return new Response(BAD_INPUTS, { status: 400 });
    // The node took it; the gateway's answer never came back whole.
    await real(url, init);
    return new Response("gateway timeout", { status: 504 });
  };
  return () => n;
}

const statusChecks = (t: T) => t.koios.calls.filter((c) => c.path === "tx_status").length;
const BAD_INPUTS = '{"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["BadInputsUTxO"]}}}}';
const REFUSED = { failure: { code: TxSendError.Failure, info: expect.stringContaining("already spent") } };

/** A transaction spending `count` inputs of transaction `seed`, nothing else: one the wallet didn't sign. */
function spending(seed: number, count: number): string {
  const inputs = Array.from({ length: count }, (_, k) => `825820${seed.toString(16).padStart(64, "0")}${k.toString(16).padStart(2, "0")}`).join("");
  return `84a100d90102${(0x80 + count).toString(16)}${inputs}a0f5f6`;
}

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

describe("a site sending again a transaction the wallet sent for it", () => {
  it("hears its id while it's in a mempool, though tx_status doesn't know it yet, and nothing new is kept", async () => {
    const { t, s, tx, id } = await ready();
    // Koios didn't answer for the first; the resends, and the site's own, are refused: it's in a mempool.
    const tried = submits(t, (n) => (n === 0 ? "taken-504" : "in-mempool"));
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    expect(tried()).toBe(4);
    const kept = { signed: await t.session.get(SESSION_DAPP_SIGNED + "preprod"), spent: await t.session.get(SESSION_SPENT_SITES) };
    // Its own timeout, or Submit pressed again, a minute on.
    t.clock.now += 60_000;
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    expect(tried()).toBe(5);
    expect(await t.session.get(SESSION_DAPP_SIGNED + "preprod")).toEqual(kept.signed);
    expect(await t.session.get(SESSION_SPENT_SITES)).toEqual(kept.spent);
  });

  it("hears its id when the first was taken at once, too", async () => {
    const { t, s, tx, id } = await ready();
    submits(t, (n) => (n === 0 ? "ok" : "in-mempool"));
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
  });

  it("hears the refusal once the wallet no longer keeps it as sent, unless the chain shows it", async () => {
    const { t, s, tx, id } = await ready();
    submits(t, (n) => (n === 0 ? "ok" : "in-mempool"));
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    // Sent two hours ago: what it spent isn't held any more.
    const key = SESSION_DAPP_SIGNED + "preprod";
    const signed = (await t.session.get<Array<{ submittedAt: number }>>(key))!;
    await t.session.set(key, signed.map((x) => ({ ...x, submittedAt: t.clock.now - 2 * 60 * 60_000 - 1 })));
    await expect(t.dapp.call(s, "submitTx", [tx])).rejects.toMatchObject(REFUSED);
    t.koios.confirmations = 3;
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
  });

  it("is a refusal for another site: only the site it was sent for hears its id", async () => {
    const { t, s } = await ready();
    const other = site("https://other.example");
    const enabling = t.dapp.call(other, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    await enabling;
    const tx = spending(5, 1);
    submits(t, (n) => (n === 0 ? "ok" : "in-mempool"));
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(txIdOf(Uint8Array.from(Buffer.from(tx, "hex"))));
    await expect(t.dapp.call(other, "submitTx", [tx])).rejects.toMatchObject(REFUSED);
    // One nobody sent through the wallet is refused as ever.
    await expect(t.dapp.call(s, "submitTx", [spending(6, 1)])).rejects.toMatchObject(REFUSED);
  });

  it("while the wallet is still sending it, has the first one's answer, and it goes out once", async () => {
    const { t, s, tx, id } = await ready();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const tried = submits(t, (n) => (n === 0 ? "ok" : "in-mempool"));
    const answer = t.koios.fetch;
    let sending = false;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx")) {
        sending = true;
        await held;
      }
      return answer(url, init);
    };
    const first = t.dapp.call(s, "submitTx", [tx]);
    await until(() => sending);
    const second = t.dapp.call(s, "submitTx", [tx]);
    // The second is on its way to Koios by now, but for the first.
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
    release();
    expect(await Promise.all([first, second])).toEqual([id, id]);
    expect(tried()).toBe(1);
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
