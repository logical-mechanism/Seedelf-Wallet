// A site that sends again a transaction the wallet keeps as sent for it
// hears its id whatever Koios answers the resend: a 429, a node Koios
// couldn't reach, a refusal other than spent inputs, or the site's own
// submit limit. Told it failed, the site would build the payment again from
// other UTxOs, and both could land (independent review M3, final review
// F12). Nothing new is kept of it. One the wallet doesn't keep as sent for
// that site hears the failure, as ever.
import { describe, expect, it } from "vitest";

import { SESSION_DAPP_SIGNED, type DappSession } from "../src/background/dapp";
import { SESSION_SEND } from "../src/background/send";
import { SESSION_SPENT_SITES } from "../src/background/spent";
import { TxSendError } from "../src/shared/dapp";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `resend${++pages}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function connect(t: ReturnType<typeof testBalances>, s: DappSession) {
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  await enabling;
}

/** A connected site, and a payment from the account the site is about to send (the wallet's own Send built it). */
async function ready() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const s = site();
  await connect(t, s);
  const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
  const tx = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
  return { t, s, tx, id: summary.txHash };
}

type T = Awaited<ReturnType<typeof ready>>["t"];
type How = "taken-504" | "ok" | "in-mempool" | "429" | "outside-validity" | "no-node";

const BAD_INPUTS = '{"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["BadInputsUTxO"]}}}}';
const OUTSIDE_VALIDITY = "ConwayUtxowFailure (UtxoFailure (OutsideValidityIntervalUTxO (ValidityInterval {invalidBefore = SNothing, invalidHereafter = SJust 1}) 2))";

/** Koios's submits go as `answer` says; everything else as the fake answers. */
function submits(t: T, answer: (n: number) => How) {
  const real = t.koios.fetch;
  let n = 0;
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx")) return real(url, init);
    const how = answer(n++);
    if (how === "ok") return real(url, init);
    if (how === "429") return new Response("slow down", { status: 429 });
    if (how === "in-mempool") return new Response(BAD_INPUTS, { status: 400 });
    if (how === "outside-validity") return new Response(OUTSIDE_VALIDITY, { status: 400 });
    // A Koios backend whose own node is down, every time it's asked.
    if (how === "no-node") return new Response("TxSubmitConnectionError", { status: 400 });
    // The node took it; the gateway's answer never came back whole.
    await real(url, init);
    return new Response("gateway timeout", { status: 504 });
  };
  return () => n;
}

/** What the wallet keeps of the site's sends: nothing new is kept of a resend. */
const kept = async (t: T) => ({
  signed: await t.session.get(SESSION_DAPP_SIGNED + "preprod"),
  spent: await t.session.get(SESSION_SPENT_SITES),
});

describe("a site sending again a transaction the wallet keeps as sent for it", () => {
  for (const [what, how] of [
    ["a 429", "429"],
    ["a refusal other than spent inputs", "outside-validity"],
    ["a node Koios couldn't reach", "no-node"],
  ] as const) {
    it(`hears its id on ${what}, and nothing new is kept`, async () => {
      const { t, s, tx, id } = await ready();
      // Koios didn't answer for the first; the wallet's resends are refused: it's in a mempool.
      submits(t, (n) => (n === 0 ? "taken-504" : n < 4 ? "in-mempool" : how));
      expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
      const before = await kept(t);
      // The site's own timeout fired: it sends the same transaction again a minute on.
      t.clock.now += 60_000;
      expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
      expect(await kept(t)).toEqual(before);
    });
  }

  it("hears its id on a 429 when the first was taken at once, too", async () => {
    const { t, s, tx, id } = await ready();
    submits(t, (n) => (n === 0 ? "ok" : "429"));
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
  });

  it("hears its id past the site's submit limit, and Koios isn't asked", async () => {
    const { t, s, tx, id } = await ready();
    const tried = submits(t, (n) => (n === 0 ? "ok" : "in-mempool"));
    for (let i = 0; i < 10; i++) expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    expect(tried()).toBe(10);
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    expect(tried()).toBe(10);
  });

  it("hears the failure once the wallet no longer keeps it as sent", async () => {
    const { t, s, tx } = await ready();
    submits(t, (n) => (n === 0 ? "ok" : "429"));
    await t.dapp.call(s, "submitTx", [tx]);
    // Sent two hours ago: what it spent isn't held any more.
    const key = SESSION_DAPP_SIGNED + "preprod";
    const signed = (await t.session.get<Array<{ submittedAt: number }>>(key))!;
    await t.session.set(key, signed.map((x) => ({ ...x, submittedAt: t.clock.now - 2 * 60 * 60_000 - 1 })));
    await expect(t.dapp.call(s, "submitTx", [tx])).rejects.toMatchObject({
      failure: { code: TxSendError.Failure, info: expect.stringContaining("limiting requests") },
    });
  });

  it("is a failure for another site: only the site it was sent for hears its id", async () => {
    const { t, s, tx } = await ready();
    const other = site("https://other.example");
    await connect(t, other);
    submits(t, (n) => (n === 0 ? "ok" : "429"));
    await t.dapp.call(s, "submitTx", [tx]);
    await expect(t.dapp.call(other, "submitTx", [tx])).rejects.toMatchObject({ failure: { code: TxSendError.Failure } });
  });
});

describe("a site's transaction the wallet never sent", () => {
  it("is a failure on a 429, as ever", async () => {
    const { t, s, tx } = await ready();
    submits(t, () => "429");
    await expect(t.dapp.call(s, "submitTx", [tx])).rejects.toMatchObject({ failure: { code: TxSendError.Failure } });
    expect(await t.session.get(SESSION_DAPP_SIGNED + "preprod")).toBeUndefined();
  });

  it("is refused past the site's submit limit, as ever", async () => {
    const { t, s, tx } = await ready();
    submits(t, () => "429");
    for (let i = 0; i < 10; i++) await expect(t.dapp.call(s, "submitTx", [tx])).rejects.toMatchObject({ failure: { code: TxSendError.Failure } });
    await expect(t.dapp.call(s, "submitTx", [tx])).rejects.toMatchObject({ failure: { code: TxSendError.Refused } });
  });
});
