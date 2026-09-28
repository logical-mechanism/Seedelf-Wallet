// Where each private UTxO's money came from, as the sealed history says
// (independent review): what a restored wallet's history finds already there
// is Unknown, not a payment received (L38).
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { historyTags } from "../src/shared/histories";
import type { PendingTx } from "../src/shared/rpc";
import { activityTitle } from "../src/ui/activity";
import { ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";

async function unlocked(options?: { owned?: boolean }) {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances(options);
  await t.wallet.create(v.phrase, PASSWORD);
  return t;
}

/** One of the wallet's contract UTxOs, made by the transaction `hex` repeated. */
const at = (hex: string, index = 0): KoiosUtxo => ({ ...ownedUtxos[0]!, tx_hash: hex.repeat(32), tx_index: index, block_height: 9_000_001 });
const [a1, a2] = [ownedUtxos[0]!, ownedUtxos[1]!];

describe("a private history this device starts (independent review L38)", () => {
  it("notes what its first reading finds as already there, from no one known, and what arrives after as received", async () => {
    const t = await unlocked();
    // A restore: the private balance holds money from before.
    await t.balances.get("preprod");
    const found = await t.activity.seedelf("preprod");
    expect(found).toHaveLength(2);
    expect(found.every((e) => e.kind === "received" && e.origin?.origin === "unknown")).toBe(true);
    expect(found.map(activityTitle)).toEqual(["Already in your private balance", "Already in your private balance"]);
    const before = await t.activity.classes("preprod", [a1, a2]);
    expect([...before.values()].map((c) => c.origin)).toEqual(["unknown", "unknown"]);
    // The UTxOs screen says Unknown, never Received.
    const { seedelf } = await t.coins.lists("preprod");
    const tags = seedelf.filter((u) => u.history).map((u) => historyTags(u.history!));
    expect(tags).toEqual([["Unknown"], ["Unknown"]]);

    // Someone pays after it started: that's a payment received.
    const paid = at("77");
    t.koios.added.push(paid);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const [latest] = await t.activity.seedelf("preprod");
    expect(latest).toMatchObject({ txHash: paid.tx_hash, kind: "received" });
    expect(latest!.origin).toBeUndefined();
    expect(activityTitle(latest!)).toBe("Received");
    const after = await t.activity.classes("preprod", [paid]);
    expect([...after.values()]).toEqual([{ id: `received:${paid.tx_hash}`, origin: "received" }]);
  });

  it("changes nothing for a brand-new wallet: its first reading finds nothing, and every arrival is received", async () => {
    const t = await unlocked({ owned: false });
    await t.balances.get("preprod");
    expect(await t.activity.seedelf("preprod")).toEqual([]);
    const paid = at("78");
    t.koios.added.push(paid);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const entries = await t.activity.seedelf("preprod");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "received" });
    expect(entries[0]!.origin).toBeUndefined();
  });

  it("keeps what the wallet sent before its first reading, and the rest was there before it", async () => {
    const t = await unlocked();
    const moved: PendingTx = { kind: "move-in", network: "preprod", txHash: a2.tx_hash, submittedAt: 1, confirmations: null };
    await t.activity.sent("preprod", moved, { lovelace: a2.value });
    await t.balances.get("preprod");
    const classes = await t.activity.classes("preprod", [a1, a2]);
    expect(classes.get(`${a2.tx_hash}#0`)).toEqual({ id: "public", origin: "own" });
    expect(classes.get(`${a1.tx_hash}#0`)?.origin).toBe("unknown");
  });

  it("leaves a history kept from before as it was: what arrives is received", async () => {
    const t = await unlocked();
    // Written by a build without the first-reading mark.
    await t.deps.store.set("history.preprod", { entries: [], seen: [] });
    await t.balances.get("preprod");
    const entries = await t.activity.seedelf("preprod");
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === "received" && e.origin === undefined)).toBe(true);
  });

  it("names an account's transaction by what the account did, never by what the private side noted arriving", async () => {
    // Where one of the account's own transactions paid the private balance (a move-in from before a
    // restore, or from another profile), the private side noted it arriving.
    const plain = await unlocked();
    await plain.balances.get("preprod");
    const { entries } = await plain.activity.cardano("preprod");
    const sent = entries.find((e) => e.kind === "sent")!;
    expect(sent).toBeDefined();

    const t = await unlocked();
    await t.balances.get("preprod");
    await t.activity.arrived("preprod", [{ ...at("79"), tx_hash: sent.txHash }]);
    expect((await t.activity.seedelf("preprod")).some((e) => e.txHash === sent.txHash && e.kind === "received")).toBe(true);
    const account = await t.activity.cardano("preprod");
    expect(account.entries.find((e) => e.txHash === sent.txHash)).toMatchObject({ kind: "sent", direction: sent.direction });
  });
});
