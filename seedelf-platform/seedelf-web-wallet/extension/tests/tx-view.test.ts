// The transaction view's worker side (background/tx-view.ts): the transaction
// the review or a site's prompt is about, found where it waits and decoded
// from its own bytes. Nothing is asked of Koios and nothing is kept, and a
// hash the wallet isn't holding has no answer.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SESSION_SEND } from "../src/background/send";
import { SESSION_CLAIM } from "../src/background/sessions";
import { BUILT_KEYS, NOT_HELD, txView } from "../src/background/tx-view";
import { transferPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

type T = Awaited<ReturnType<typeof unlocked>>;
const deps = (t: T) => ({ wasm: t.deps.wasm, wallet: t.wallet, session: t.session });

/** A payment from the public account, built and signed, waiting for Send. */
async function built(t: T) {
  return t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
}

describe("the transaction view", () => {
  it("looks under every key a built transaction waits for Send under", () => {
    // `seedelf.<flow>.built` is the convention for one: a flow added without
    // its key here would have a review the view couldn't open.
    const dir = fileURLToPath(new URL("../src/background", import.meta.url));
    const named = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      for (const match of readFileSync(`${dir}/${file}`, "utf8").matchAll(/"(seedelf\.[\w.]*built)"/g)) {
        named.add(match[1]!);
      }
    }
    expect(named.size).toBeGreaterThan(5);
    expect([...named].filter((key) => !BUILT_KEYS.includes(key))).toEqual([]);
    // The private sessions' keys don't follow that convention, so they're named here.
    expect(BUILT_KEYS.filter((key) => key.startsWith("seedelf.session.")).sort()).toEqual([
      "seedelf.session.back",
      "seedelf.session.claim",
      "seedelf.session.mix-out",
      "seedelf.session.out",
      "seedelf.session.site-out",
      "seedelf.session.top-up",
      "seedelf.session.tx",
    ]);
  });

  it("reads the transaction the review is about, and asks nobody anything", async () => {
    const t = await unlocked();
    const summary = await built(t);
    const before = t.koios.calls.length;
    const { detail, cbor } = await txView(deps(t), "preprod", summary.txHash);

    expect(detail.txHash).toBe(summary.txHash);
    expect(detail.fee).toBe(summary.fee);
    expect(detail.size).toBe(cbor.length / 2);
    // It's signed at review, so the witness set already holds a signature.
    expect(detail.witnessed).toBe(true);
    expect(detail.signatures.length).toBeGreaterThan(0);
    // What it pays is there, with its own address.
    const paid = detail.outputs.find((o) => o.address.bech32 === THEIRS);
    expect(paid?.lovelace).toBe("3000000");
    expect(paid?.address.kind).toBe("base");
    expect(paid?.address.payment).toBe("key");
    expect(detail.inputs.length).toBeGreaterThan(0);
    expect(detail.unknown).toEqual([]);

    // Nothing was read and nothing written: the cheapest handler in the worker.
    expect(t.koios.calls.length).toBe(before);
    expect(t.koios.submitted).toHaveLength(0);
    expect(t.collateral.asked).toHaveLength(0);
  });

  it("refuses a hash it isn't holding, and one built on another network", async () => {
    const t = await unlocked();
    const summary = await built(t);
    await expect(txView(deps(t), "preprod", "ab".repeat(32))).rejects.toThrow(NOT_HELD());
    await expect(txView(deps(t), "mainnet", summary.txHash)).rejects.toThrow(NOT_HELD());
  });

  it("reads nothing while the wallet is locked", async () => {
    const t = await unlocked();
    const summary = await built(t);
    await t.wallet.lock();
    await expect(txView(deps(t), "preprod", summary.txHash)).rejects.toThrow();
  });

  it("finds a transaction kept inside a list, as Bring everything back keeps them", async () => {
    const t = await unlocked();
    const summary = await built(t);
    const kept = await t.session.get<object>(SESSION_SEND);
    // Bring everything back keeps one record a session, each with its chain inside.
    await t.session.remove(SESSION_SEND);
    await t.session.set(SESSION_CLAIM, [{ index: 0, chain: [kept] }]);
    expect((await txView(deps(t), "preprod", summary.txHash)).detail.txHash).toBe(summary.txHash);
  });

  it("shows the bytes that would go out, so a resend shows what was signed", async () => {
    const t = await unlocked();
    const summary = await built(t);
    const kept = await t.session.get<{ txCbor: string }>(SESSION_SEND);
    // A submit Koios didn't answer leaves the signed bytes as sent (pending.ts);
    // Send sends those again, so those are the ones the view shows.
    await t.session.set(SESSION_SEND, { ...kept, sentCbor: transferPreprod.final.txCbor });
    const view = await txView(deps(t), "preprod", summary.txHash);
    expect(view.cbor).toBe(transferPreprod.final.txCbor);
    // The id is of the bytes shown, worked out from them, so the two can never
    // disagree: the screen shows this one, not the hash it asked with.
    expect(view.detail.txHash).toBe(transferPreprod.final.txHash);
    expect(view.detail.txHash).not.toBe(summary.txHash);
  });

  it("reads a site's transaction while it waits for a signature, and only while it does", async () => {
    const t = await unlocked();
    await t.preferences.set({ dappConnector: true });
    const site = { id: "s1", origin: "https://app.example.com", title: "Example" };
    // Connected, as the user saying yes does.
    const enabling = t.dapp.call(site, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);

    // The site asks for a signature on bytes the wallet didn't build: here it
    // is the wallet's own earlier payment, which the site could have built on.
    const summary = await built(t);
    const sent = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
    await t.session.remove(SESSION_SEND);
    const signing = t.dapp.call(site, "signTx", [sent, false]);
    await until(() => t.dapp.approvals().length === 1);
    const waiting = t.dapp.approvals()[0]!;
    if (waiting.kind !== "sign-tx") throw new Error(waiting.kind);

    const view = await txView(deps(t), "preprod", summary.txHash, (h) => t.dapp.waitingCbor(h));
    expect(view.cbor).toBe(sent);
    expect(view.detail.txHash).toBe(summary.txHash);

    // Declined: the bytes go with the request, and nothing is left to read.
    await t.dapp.answer(waiting.id, false);
    await expect(signing).rejects.toBeDefined();
    expect(t.dapp.waitingCbor(summary.txHash)).toBeUndefined();
    await expect(txView(deps(t), "preprod", summary.txHash, (h) => t.dapp.waitingCbor(h))).rejects.toThrow(NOT_HELD());
  });

  it("opening it can't strand a signed transaction: the submit still goes", async () => {
    const t = await unlocked();
    const summary = await built(t);
    // Opened and closed on the signed transaction, as the modal does.
    await txView(deps(t), "preprod", summary.txHash);
    const pending = await t.send.submit("preprod", summary.txHash);
    expect(pending.txHash).toBe(summary.txHash);
    expect(t.koios.submitted).toHaveLength(1);
  });
});
