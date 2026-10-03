// Remove wallet, unlocked, first says what removing it would leave behind:
// a payment that may still go through, private sessions whose one-time
// accounts a restore doesn't find yet, a chain through Lovejoin being sent.
// With any, it takes a second yes, and the worker refuses without one. A
// payment that may still go through is kept, sealed, through the reset, so
// the same phrase restored here watches it again and nothing pays beside it;
// another phrase's wallet deletes it (independent review M2, M5).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { handle, RESET_AT_STAKE, type Context } from "../src/background/handlers";
import { MAYBE_SENT_WAIT, pendingKey } from "../src/background/pending";
import { NetworkChoice } from "../src/background/preferences";
import { spentSet } from "../src/background/spent";
import type { NetworkName } from "../src/networks";
import type { AtStake, Message, Status } from "../src/shared/rpc";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const MINE = account(12).phrase;
const OTHER = account(24).phrase;
const THEIRS = account(15).preprod.receive_0 as string;
const SEALED = "seedelf.private.maybeSent.preprod";

// The screens read the page's URL when they load (ui/view.ts).
beforeAll(() => {
  vi.stubGlobal("location", { search: "" });
});

function context(t: ReturnType<typeof testBalances>): Context {
  const networks: NetworkName[] = ["preprod", "mainnet"];
  return {
    ...(t as unknown as Context),
    wasm: loadTestWasm(),
    connector: async (on) => on,
    version: "1.0.0",
    network: "preprod",
    networks,
    networkChoice: new NetworkChoice(t.local, networks),
  };
}

const ask = (message: Message, ctx: Context) => handle(message, ctx);

async function wallet(phrase = MINE) {
  const t = testBalances();
  const ctx = context(t);
  await ask({ type: "restore-wallet", phrase, password: PASSWORD }, ctx);
  return { t, ctx };
}

type W = Awaited<ReturnType<typeof wallet>>;

/** A public payment whose submit Koios didn't answer: maybe sent. */
async function maybeSent({ t }: W) {
  const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
  const real = t.koios.fetch;
  let left = 1;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (url.endsWith("/submittx") && left-- > 0) throw new DOMException("signal timed out", "TimeoutError");
    return answer;
  };
  expect(await t.send.submit("preprod", summary.txHash)).toMatchObject({ maybeSent: true });
  return summary.txHash;
}

describe("Remove wallet's check", () => {
  it("finds nothing open on a wallet with nothing on its way, and removes it at the first yes", async () => {
    const w = await wallet();
    expect(await ask({ type: "reset-check" }, w.ctx)).toEqual([]);
    expect(await ask({ type: "reset-wallet" }, w.ctx)).toMatchObject({ state: "no-wallet" });
  });

  it("lists a payment that may still go through, and removes the wallet only at a second yes", async () => {
    const w = await wallet();
    const txHash = await maybeSent(w);
    const stake = (await ask({ type: "reset-check" }, w.ctx)) as AtStake[];
    expect(stake).toEqual([{ network: "preprod", maybeSent: expect.objectContaining({ txHash, maybeSent: true }), sessions: [], chainSending: false }]);
    await expect(ask({ type: "reset-wallet" }, w.ctx)).rejects.toThrow(RESET_AT_STAKE);
    expect(((await ask({ type: "status" }, w.ctx)) as Status).state).toBe("unlocked");
    expect(await ask({ type: "reset-wallet", force: true }, w.ctx)).toMatchObject({ state: "no-wallet" });
  });

  it("lists private sessions a restore doesn't find yet: open ones, and closed ones with something left, but not one never funded", async () => {
    const w = await wallet();
    const out = (n: number, extra = {}) => [{ kind: "out", txHash: n.toString(16).padStart(64, "0"), at: 1, ...extra }];
    await w.t.store.set("sessions.mainnet", {
      next: 5,
      sessions: [
        { index: 0, createdAt: 1, txs: out(1), site: { origin: "https://app.example" } },
        { index: 1, createdAt: 1, txs: out(2), mix: { boxes: 2 } },
        { index: 2, createdAt: 1, txs: out(3, { unsent: true }) },
        { index: 3, createdAt: 1, txs: out(4), closedAt: 2 },
        { index: 4, createdAt: 1, txs: out(5), closedAt: 2, leftBehind: [{ txHash: "ab".repeat(32), txIndex: 0, reason: "fee", lovelace: "1000000" }] },
      ],
    });
    const stake = (await ask({ type: "reset-check" }, w.ctx)) as AtStake[];
    expect(stake).toEqual([
      {
        network: "mainnet",
        sessions: [
          { index: 0, kind: "site", origin: "https://app.example" },
          { index: 1, kind: "mix" },
          { index: 4, kind: "swap", leftBehind: true },
        ],
        chainSending: false,
      },
    ]);
    await expect(ask({ type: "reset-wallet" }, w.ctx)).rejects.toThrow(RESET_AT_STAKE);
  });

  it("lists a chain through Lovejoin still being sent, and not one the lock cut", async () => {
    const w = await wallet();
    const id = "cd".repeat(32);
    const progress = "seedelf.lovejoin.sending.preprod";
    const chain = { id, progress, mixes: [], leaves: [], boxes: 1, total: 3, sent: 1, at: 1 };
    await w.t.store.set("lovejoin.preprod", { due: [], chains: [chain] });
    await w.t.wallet.withKeys(() => w.t.session.set(progress, { txs: [{ txHash: id, txCbor: "" }], next: 1, flying: [] }));
    expect(await ask({ type: "reset-check" }, w.ctx)).toEqual([{ network: "preprod", sessions: [], chainSending: true }]);
    // Its progress gone (a lock, a closed browser), it's stopped already: nothing is being sent.
    await w.t.wallet.withKeys(() => w.t.session.remove(progress));
    expect(await ask({ type: "reset-check" }, w.ctx)).toEqual([]);
  });

  it("says a network whose records won't open, rather than nothing", async () => {
    const w = await wallet();
    await w.t.local.set("seedelf.private.sessions.preprod", { v: 1, nonce: "AAAA", data: "AAAA" });
    expect(await ask({ type: "reset-check" }, w.ctx)).toEqual([{ network: "preprod", sessions: [], chainSending: false, unreadable: true }]);
  });
});

describe("a payment that may still go through, across Remove wallet", () => {
  it("is kept sealed, and watched again when the same phrase is restored here: nothing pays beside it", async () => {
    const w = await wallet();
    const txHash = await maybeSent(w);
    await ask({ type: "reset-wallet", force: true }, w.ctx);
    expect(w.t.local.data.has(SEALED)).toBe(true);

    await ask({ type: "restore-wallet", phrase: MINE, password: PASSWORD }, w.ctx);
    expect(await w.t.pending.pending("preprod")).toMatchObject({ txHash, maybeSent: true });
    expect((await spentSet(w.t.session)).size).toBeGreaterThan(0);
    await expect(w.t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT());
    // It lands: settled, the record goes.
    w.t.koios.confirmations = 1;
    expect(await w.t.pending.pending("preprod")).toMatchObject({ txHash, confirmations: 1 });
    expect(w.t.local.data.has(SEALED)).toBe(false);
  });

  it("is kept through Forgot password too, which can't read it", async () => {
    const w = await wallet();
    const txHash = await maybeSent(w);
    await w.t.wallet.lock();
    await ask({ type: "reset-wallet" }, w.ctx);
    expect(w.t.local.data.has(SEALED)).toBe(true);
    await ask({ type: "restore-wallet", phrase: MINE, password: PASSWORD }, w.ctx);
    expect(await w.t.session.get(pendingKey("preprod"))).toBeUndefined();
    await expect(w.t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT());
    expect(await w.t.pending.pending("preprod")).toMatchObject({ txHash, maybeSent: true });
  });

  it("is deleted when a wallet of another phrase is made, which can't open it", async () => {
    const w = await wallet();
    await maybeSent(w);
    await ask({ type: "reset-wallet", force: true }, w.ctx);
    await ask({ type: "restore-wallet", phrase: OTHER, password: PASSWORD }, w.ctx);
    expect(w.t.local.data.has(SEALED)).toBe(false);
    expect(await w.t.pending.pending("preprod")).toBeNull();
  });

  it("leaves nothing sealed once settled, so Remove wallet deletes everything else as before", async () => {
    const w = await wallet();
    const txHash = await maybeSent(w);
    w.t.koios.confirmations = 1;
    expect(await w.t.pending.pending("preprod")).toMatchObject({ txHash, confirmations: 1 });
    await ask({ type: "reset-wallet" }, w.ctx);
    expect([...w.t.local.data.keys()].filter((k) => k.startsWith("seedelf.private."))).toEqual([]);
  });
});

describe("Remove wallet's screen", () => {
  it("promises back only what a restore finds, and says private sessions' accounts aren't found yet", async () => {
    const { RemoveWallet } = await import("../src/ui/screens/Settings");
    const html = renderToStaticMarkup(createElement(RemoveWallet, { onBack: () => undefined, onRemoved: () => undefined }))
      .replace(/<[^>]+>/g, " ")
      .replaceAll("&#x27;", "'")
      .replace(/\s+/g, " ");
    expect(html).not.toContain("your recovery phrase brings them back");
    expect(html).toContain("your recovery phrase brings back your public account, your private balance and your Lovejoin boxes");
    expect(html).toContain("What private sessions' one-time accounts hold doesn't show after a restore yet: bring it back first.");
    // Until the worker says what's open, it can't be removed.
    expect(html).toContain("Checking…");
  });

  it("lists what's left behind in plain words", async () => {
    const { atStakeLines } = await import("../src/ui/screens/Settings");
    const lines = atStakeLines([
      {
        network: "mainnet",
        maybeSent: { kind: "send", network: "mainnet", txHash: "ab".repeat(32), submittedAt: 0, confirmations: null, maybeSent: true },
        sessions: [
          { index: 0, kind: "site", origin: "https://app.example" },
          { index: 2, kind: "swap" },
          { index: 3, kind: "mix", leftBehind: true },
        ],
        chainSending: true,
      },
      { network: "preprod", sessions: [], chainSending: false, unreadable: true },
    ]);
    expect(lines).toEqual([
      "Mainnet: a payment Koios didn't answer may still go through. An encrypted record of it stays in this browser: restoring this same recovery phrase here watches it again, but making or restoring another wallet here first deletes that record. While nothing watches it, a payment made here or elsewhere could pay twice.",
      "Mainnet: 2 private sessions still open: private session 1 (app.example), private session 3 (a swap). What their one-time accounts hold doesn't show after a restore yet: bring it back first, with Bring everything back on the dApps page, or a running swap's Stop.",
      "Mainnet: something no return takes is left at the account of private session 4 (a mix), and it doesn't show after a restore yet.",
      "Mainnet: a chain through Lovejoin is still being sent. Removing the wallet stops it partway, its boxes less mixed.",
      "Preprod: Seedelf Wallet couldn't read what's still open there.",
    ]);
  });

  it("Forgot password says what the phrase brings back, and what it doesn't yet", async () => {
    const { Reset } = await import("../src/ui/screens/Unlock");
    const html = renderToStaticMarkup(createElement(Reset, { onCancel: () => undefined, onReset: () => undefined }))
      .replace(/<[^>]+>/g, " ")
      .replaceAll("&#x27;", "'")
      .replace(/\s+/g, " ");
    expect(html).toContain("The phrase brings back your public account, your private balance and your Lovejoin boxes.");
    expect(html).toContain("What private sessions' one-time accounts hold doesn't show after a restore yet.");
    // It runs locked, and keeps a payment that may still go through: it says so, and what brings it back.
    expect(html).toContain(
      "If a payment may still go through, an encrypted record of it stays in this browser: restoring this same phrase here watches it again, and making or restoring another wallet deletes that record.",
    );
  });
});
