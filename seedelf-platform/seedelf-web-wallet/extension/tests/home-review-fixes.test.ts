// 1.6.0's release review, Home and its banner (lane S2, round 2): the Collateral page opened in place leaves its
// payment to Home's watch, and Home lets go of one another page saw land first (309#0); a Bootstrap from the public
// account is named one in Home's banner, its boxes held in the pool, never on their way back (318-worker#0). Each
// failed before its fix. The worker is the real one, through its handler, as Home's and the page's questions reach it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import type { KoiosUtxo } from "../src/background/koios";
import type { Message, PendingTx, RequestName, Requests } from "../src/shared/rpc";
import type { call } from "../src/ui/background";
import { PendingBanner } from "../src/ui/components/PendingBanner";
import { NetworkContext } from "../src/ui/network";
import { lookAgain } from "../src/ui/screens/Collateral";
import { unwatched } from "../src/ui/screens/Home";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
/** Home's hold on new payments while a sent one waits (Home.tsx HOLD_MS), and the worker's watch of a private one. */
const HOLD_MS = 10 * 60_000;

/** The banner's text, as a person reads it. */
function banner(pending: PendingTx, watching = true): string {
  return renderToStaticMarkup(
    createElement(NetworkContext.Provider, { value: "preprod" }, createElement(PendingBanner, { pending, watching, onDismiss: () => undefined })),
  )
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("a Bootstrap from the public account, in Home's banner (1.6.0's release review, 318-worker#0)", () => {
  // What publicSubmit hands Home, and Home's watch answers (lovejoin-flows.test.ts): a mix's kind, marked a Bootstrap.
  const hash = "ab".repeat(32);
  const sent = {
    kind: "lovejoin-mix",
    network: "preprod",
    txHash: hash,
    submittedAt: Date.now(),
    confirmations: null,
    chain: { first: hash, total: 1 },
    bootstrap: true,
  } as PendingTx;
  const { bootstrap: _bootstrap, ...mix } = sent;

  it("is named a Bootstrap while it's on its way, never mixes", () => {
    expect(banner(sent)).toContain("A Bootstrap sent. Waiting for the network…");
    expect(banner(sent)).not.toContain("Mixes into");
  });

  it("says its boxes are held in Lovejoin once its deposit is in, never on their way to the private balance", () => {
    const done = banner({ ...sent, confirmations: 1 }, false);
    expect(done).toContain("In Lovejoin, held there until you bring them back");
    expect(done).not.toContain("on their way to your private balance");
  });

  it("is named a Bootstrap in every other title the banner has for it", () => {
    expect(banner(sent, false)).toContain("A Bootstrap not confirmed yet");
    expect(banner({ ...sent, maybeSent: true })).toContain("A Bootstrap not confirmed yet: don't pay it again");
    expect(banner({ ...sent, dropped: "expired" }, false)).toContain("A Bootstrap expired: nothing was sent");
    expect(banner({ ...sent, dropped: "unseen" }, false)).toContain("A Bootstrap not seen on the network");
  });

  it("leaves a mix's words as they were", () => {
    expect(banner(mix)).toContain("Mixes into Lovejoin sent. Waiting for the network…");
    expect(banner({ ...mix, confirmations: 1 }, false)).toContain("In Lovejoin, on their way to your private balance");
  });
});

/** The 12-word phrase's wallet, unlocked, with no collateral: setting one is a payment of 5 ₳ to its own 0/0. */
async function unlocked() {
  const t = testBalances();
  await t.wallet.create(PHRASE.phrase, PASSWORD);
  return t;
}
type T = Awaited<ReturnType<typeof unlocked>>;

/** A context as the worker builds one: handlers.ts answers what the pages ask. */
function context(t: T): Context {
  return {
    ...(t as unknown as Context),
    wasm: loadTestWasm(),
    connector: async (on: boolean) => on,
    version: "1.6.0",
    network: "preprod",
    networks: ["preprod"],
  };
}

/** A page asking the worker, as `call` does, and what it asked, in order. */
function asker(ctx: Context) {
  const asked: RequestName[] = [];
  const ask = (async <K extends RequestName>(type: K, payload: Requests[K]["payload"]) => {
    asked.push(type);
    return handle({ type, ...payload } as Message, ctx);
  }) as typeof call;
  return { ask, asked };
}

/** Output 0 of collateral payment `txHash`, on chain: 5 ₳ at the account's own 0/0. */
function made(txHash: string): KoiosUtxo {
  const template = koiosPreprod.accounts[PHRASE.preprod.stake]!.account_utxos.find((u) => u.address === PHRASE.preprod.receive_0)!;
  return { ...template, tx_hash: txHash, tx_index: 0, value: "5000000", asset_list: [], block_height: 5_300_000 };
}

describe("a collateral payment while its page is open (1.6.0's release review, 309#0)", () => {
  it("opened in place from Home's row, the page leaves the payment to Home's watch, which is told it landed", async () => {
    const t = await unlocked();
    const ctx = context(t);
    const home = asker(ctx);
    const page = asker(ctx);
    await home.ask("balances", {});
    const built = await home.ask("collateral-build", {});
    // Sent from the page Home's row opened: the payment is Home's banner's, as `sent` hands it.
    expect(await home.ask("collateral-submit", { txHash: built.txHash })).toMatchObject({ kind: "collateral", confirmations: null });
    // The row says it's on its way, and is pressed again to follow it: the page opens in place, and looks at once.
    expect(await page.ask("collateral", {})).toEqual({ state: "waiting", txHash: built.txHash });
    await lookAgain(page.ask, built.txHash, true);

    // It lands, and the page's next look comes before Home's next tick, as about half of them do.
    t.koios.addedToAccounts.push(made(built.txHash));
    t.koios.confirmations = 1;
    t.clock.now += 15_000;
    await lookAgain(page.ask, built.txHash, true);
    // Home is told it landed, so its banner says the collateral is set and payments go again. The worker tells only
    // whoever asks first of a landing: the page's question took it, and Home held every payment for 10 minutes.
    expect(await home.ask("pending-tx", {})).toMatchObject({ kind: "collateral", txHash: built.txHash, confirmations: 1 });
    // Home reads the balances again (`load`), and the page's next look says it's set.
    await home.ask("balances", {});
    expect(await lookAgain(page.ask, built.txHash, true)).toMatchObject({ state: "set", by: "you", utxo: { txHash: built.txHash, index: 0 } });
    expect(page.asked).not.toContain("pending-tx");
  });

  it("from Settings, which replaces Home, the page asks about it as Home would, and says it's set once it lands", async () => {
    const t = await unlocked();
    const page = asker(context(t));
    await page.ask("balances", {});
    const built = await page.ask("collateral-build", {});
    await page.ask("collateral-submit", { txHash: built.txHash });
    expect(await lookAgain(page.ask, built.txHash, false)).toBeUndefined();
    t.koios.addedToAccounts.push(made(built.txHash));
    t.koios.confirmations = 1;
    expect(await lookAgain(page.ask, built.txHash, false)).toMatchObject({ state: "set", by: "you" });
    expect(page.asked.filter((a) => a === "pending-tx")).toHaveLength(2);
  });

  it("told nothing of a landing another window's page saw first, Home lets the payment go and reads the balances again", async () => {
    const t = await unlocked();
    const ctx = context(t);
    const home = asker(ctx);
    const tab = asker(ctx);
    await home.ask("balances", {});
    const built = await home.ask("collateral-build", {});
    const held = await home.ask("collateral-submit", { txHash: built.txHash });
    // Settings' Collateral page, in a tab, waits for it and asks about it, as it does from Settings.
    expect(await lookAgain(tab.ask, built.txHash, false)).toBeUndefined();
    t.koios.addedToAccounts.push(made(built.txHash));
    t.koios.confirmations = 1;
    t.clock.now += 60_000;
    expect(await lookAgain(tab.ask, built.txHash, false)).toMatchObject({ state: "set" });

    // Home's next tick, in the side panel: the worker watches nothing any more.
    expect(await home.ask("pending-tx", {})).toBeNull();
    // A minute after the send: it was seen land, so it holds nothing back, and the balances are read again, as its
    // landing would have them read. Home kept it on "sent", held every payment for 10 minutes, then said it may not
    // have been sent.
    expect(unwatched(held, t.clock.now)).toEqual({ pending: null, read: true });
    await home.ask("balances", {});
    expect(await home.ask("collateral", {})).toMatchObject({ state: "set", by: "you" });
  });

  it("past its hold says what it said before: one it no longer hears of isn't confirmed yet, and one that may have gone through goes", () => {
    const sent = { kind: "transfer", network: "preprod", txHash: "cd".repeat(32), submittedAt: 0, confirmations: null } as PendingTx;
    // Inside its 10 minutes the worker lets an ordinary one go only once it's seen land.
    expect(unwatched(sent, HOLD_MS - 1)).toEqual({ pending: null, read: true });
    // Past them, a private one stops being watched unseen (pending.ts WATCH_MS): it may still land.
    expect(unwatched(sent, HOLD_MS)).toEqual({ pending: sent, read: false });
    expect(unwatched({ ...sent, maybeSent: true }, 1)).toEqual({ pending: null, read: false });
    const landed = { ...sent, confirmations: 1 };
    expect(unwatched(landed, 1)).toEqual({ pending: landed, read: false });
    const dropped = { ...sent, dropped: "expired" as const };
    expect(unwatched(dropped, 1)).toEqual({ pending: dropped, read: false });
    expect(unwatched(null, 1)).toEqual({ pending: null, read: false });
  });
});
