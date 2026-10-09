// Private watches on the private index's feed (chunk 26b, Step 6): a
// transaction that spends or pays a Seedelf or a Lovejoin box is looked for in
// the feed since a cursor from before it went out, an answer every wallet
// shares, never by asking tx_status about it. What touches only key addresses
// still asks tx_status, and so does a private one while the feed can't say.
import { describe, expect, it } from "vitest";

import { DataParts, DOWN_MS } from "../src/background/data-layer";
import { chainStatus, CURSOR_SPACING_MS, CURSORS_FOR_MS, feedOfTx, noteCursor, SESSION_FEED_PREFIX } from "../src/background/feed";
import { pendingKey, PendingService } from "../src/background/pending";
import { privateIndexClient } from "../src/background/private-index";
import { fakeIndex, indexRowOf } from "./fake-index";
import { bytes, recordedSwap } from "./fixtures/swap-tx";
import { ownedUtxos, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** Preprod's slot 0 in Unix seconds (Shelley on), so the fake's slots meet the test clock. */
const PREPROD_SLOT_TIME = 1_655_769_600;
const NOW_SLOT = 1_800_000_000 - PREPROD_SLOT_TIME;
const TX = "fe".repeat(32);
const OTHER = "fd".repeat(32);
const cursorAt = (slot: number) => `${slot}.${"ab".repeat(32)}`;

/** The 12-word wallet, the feed's index pointed at preprod's fixtures, and a cursor from 20 minutes ago kept. */
async function watching() {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances();
  await t.wallet.create(v.phrase, PASSWORD);
  const index = fakeIndex(NOW_SLOT);
  index.contract = ownedUtxos.map((u) => ({ row: indexRowOf(u, NOW_SLOT - 100_000) }));
  index.pool = [];
  const parts = new DataParts(t.session, () => t.clock.now);
  const deps = {
    ...t.deps,
    index: privateIndexClient({ koiosOnly: async () => false, parts, fetch: index.fetch, limits: {} }, () => "https://data.test"),
  };
  const before = NOW_SLOT - 1_200;
  await noteCursor(t.session, "preprod", "contract", cursorAt(before), t.clock.now);
  await noteCursor(t.session, "preprod", "lovejoin", cursorAt(before), t.clock.now);
  const asked = () => t.koios.calls.filter((c) => c.path === "tx_status").length;
  return { t, index, deps, parts, asked };
}

describe("the cursors a watch reads from", () => {
  it("keeps one every few minutes for six hours, in slot order, an older one put in its place", async () => {
    const t = testBalances();
    const now = 1_800_000_000_000;
    const slot = (msAgo: number) => Math.floor((now - msAgo) / 1000) - PREPROD_SLOT_TIME;
    for (const ago of [70, 60, 58, 50, 2].map((m) => m * 60_000)) await noteCursor(t.session, "preprod", "contract", cursorAt(slot(ago)), now);
    // One from before a lock, older than every one kept: in its place, not at the end.
    await noteCursor(t.session, "preprod", "contract", cursorAt(slot(90 * 60_000)), now);
    // One from before six hours ago: not kept.
    await noteCursor(t.session, "preprod", "contract", cursorAt(slot(CURSORS_FOR_MS + 60_000)), now);
    const kept = (await t.session.get<{ contract: Array<{ cursor: string; at: number }> }>(SESSION_FEED_PREFIX + "preprod"))!.contract;
    expect(kept.map((c) => Math.round((now - c.at) / 60_000))).toEqual([90, 70, 60, 50, 2]);
    expect(kept.every((c, i) => i === 0 || c.at - kept[i - 1]!.at >= CURSOR_SPACING_MS || i === kept.length - 1)).toBe(true);
  });
});

describe("a private transaction's watch", () => {
  it("is looked for in the feed, and never named to tx_status", async () => {
    const { t, index, deps, asked } = await watching();
    const sentAt = t.clock.now - 60_000;
    const before = await chainStatus(deps, "preprod", [{ txHash: TX, feed: "contract", sentAt }]);
    expect(before).toMatchObject({ fed: true, tip: NOW_SLOT });
    expect(before.statuses.get(TX)).toBeNull();
    // It lands: it spends one of the contract's rows.
    index.contract[0]!.spent = { slot: NOW_SLOT - 5, by: TX };
    const after = await chainStatus(deps, "preprod", [{ txHash: TX, feed: "contract", sentAt }]);
    expect(after.statuses.get(TX)).toBe(1);
    expect(asked()).toBe(0);
    expect(index.calls.every((c) => c.startsWith("contract/since/"))).toBe(true);
  });

  it("sees one that pays the contract or a box by the rows it made", async () => {
    const { t, index, deps } = await watching();
    index.contract.push({ row: { ...indexRowOf(ownedUtxos[0]!, NOW_SLOT - 3), ref: `${TX}#1` } });
    index.pool.push({ row: { ...indexRowOf(ownedUtxos[1]!, NOW_SLOT - 3), ref: `${OTHER}#0` } });
    const { statuses } = await chainStatus(deps, "preprod", [
      { txHash: TX, feed: "contract", sentAt: t.clock.now },
      { txHash: OTHER, feed: "lovejoin", sentAt: t.clock.now },
    ]);
    expect([statuses.get(TX), statuses.get(OTHER)]).toEqual([1, 1]);
  });

  it("asks tx_status for what touches only key addresses, beside the feed", async () => {
    const { t, deps, asked } = await watching();
    t.koios.confirmations = 3;
    const { statuses } = await chainStatus(deps, "preprod", [
      { txHash: TX, feed: "contract", sentAt: t.clock.now },
      { txHash: OTHER, sentAt: t.clock.now },
    ]);
    expect([statuses.get(TX), statuses.get(OTHER)]).toEqual([null, 3]);
    expect(t.koios.calls.filter((c) => c.path === "tx_status").map((c) => c.body._tx_hashes)).toEqual([[OTHER]]);
    expect(asked()).toBe(1);
  });

  it("asks tx_status as before while the private part is down, and with no cursor from before it went out", async () => {
    const { t, index, deps, asked } = await watching();
    // Sent before the oldest cursor kept: the feed since it can't say it isn't there.
    await chainStatus(deps, "preprod", [{ txHash: TX, feed: "contract", sentAt: t.clock.now - 60 * 60_000 }]);
    expect(asked()).toBe(1);
    index.fail = Response.json({ error: "behind" }, { status: 503 });
    const down = await chainStatus(deps, "preprod", [{ txHash: TX, feed: "contract", sentAt: t.clock.now }]);
    expect(down.fed).toBe(false);
    expect(asked()).toBe(2);
    // Down for 5 minutes: not even asked.
    index.calls.length = 0;
    await chainStatus(deps, "preprod", [{ txHash: TX, feed: "contract", sentAt: t.clock.now }]);
    expect(index.calls).toEqual([]);
    index.fail = undefined;
    t.clock.now += DOWN_MS;
    expect((await chainStatus(deps, "preprod", [{ txHash: TX, feed: "contract", sentAt: t.clock.now - DOWN_MS }])).fed).toBe(true);
  });

  it("watches a Seedelf spend on the feed for Home, every 5 s, and settles it there", async () => {
    const { t, index, deps, asked } = await watching();
    const pending = new PendingService(deps);
    await t.session.set(pendingKey("preprod"), {
      kind: "transfer",
      network: "preprod",
      txHash: TX,
      submittedAt: t.clock.now,
      confirmations: null,
      contract: true,
    });
    expect(await pending.pending("preprod")).toMatchObject({ txHash: TX, confirmations: null, onFeed: true });
    index.contract[1]!.spent = { slot: NOW_SLOT - 2, by: TX };
    expect(await pending.pending("preprod")).toMatchObject({ txHash: TX, confirmations: 1 });
    expect(asked()).toBe(0);
  });
});

describe("which feed a signed transaction shows in", () => {
  it("is the contract's for one that pays a Seedelf, and none for one that pays only key addresses and a DEX", () => {
    expect(feedOfTx(bytes(transferPreprod.final.txCbor), "preprod")).toBe("contract");
    expect(feedOfTx(bytes(recordedSwap.cbor), "preprod")).toBeUndefined();
    expect(feedOfTx(new Uint8Array([0x80]), "preprod")).toBeUndefined();
  });
});
