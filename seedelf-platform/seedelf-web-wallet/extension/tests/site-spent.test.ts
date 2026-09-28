// What sites' own transactions spend, sent through the connector, is kept
// apart from what the wallet spent itself, under a cap of its own, and a
// site resending one already on chain leaves nothing behind (independent
// review L7): a site can't flush the wallet's memory of its own spends, or
// of its own sends that other sites chain on.
import { describe, expect, it } from "vitest";

import { SESSION_DAPP_SIGNED, type DappSession } from "../src/background/dapp";
import { recentlySent, rememberSent } from "../src/background/sent-txs";
import {
  lastSpentAt,
  rememberSiteSpent,
  rememberSpent,
  SESSION_SPENT,
  SESSION_SPENT_SITES,
  spentSet,
} from "../src/background/spent";
import { SESSION_BALANCES_PREFIX } from "../src/background/wallet";
import { memoryArea, testBalances, vectors } from "./fakes";
import { txIdOf } from "./fixtures/cbor";

const PASSWORD = "correct horse battery";
const account = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;

/** A transaction spending `count` inputs of transaction `seed`, nothing else: enough to read its inputs and id. */
function spending(seed: number, count: number): Uint8Array {
  const head = count < 24 ? (0x80 + count).toString(16) : count < 256 ? `98${count.toString(16).padStart(2, "0")}` : `99${count.toString(16).padStart(4, "0")}`;
  const index = (k: number) => (k < 24 ? k.toString(16).padStart(2, "0") : k < 256 ? `18${k.toString(16).padStart(2, "0")}` : `19${k.toString(16).padStart(4, "0")}`);
  const inputs = Array.from({ length: count }, (_, k) => `825820${seed.toString(16).padStart(64, "0")}${index(k)}`).join("");
  return Uint8Array.from(Buffer.from(`84a100d90102${head}${inputs}a0f5f6`, "hex"));
}
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `spent${++pages}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function connected() {
  const t = testBalances();
  await t.wallet.create(account.phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const s = site();
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  await enabling;
  return { t, s };
}

describe("what sites' transactions spend", () => {
  it("is kept apart from the wallet's own, under a cap of its own, and counts all the same", async () => {
    const session = memoryArea();
    const at = 1_800_000_000_000;
    const own = spending(1, 3);
    await rememberSpent(session, "preprod", own, at);
    // Far more than either cap, from sites, after it.
    for (let i = 0; i < 30; i++) await rememberSiteSpent(session, spending(100 + i, 400), at + 1_000 + i);
    const spent = await spentSet(session, at + 60_000);
    expect(spent.has(`${"1".padStart(64, "0")}#0`)).toBe(true);
    expect(Object.keys((await session.get<Record<string, number>>(SESSION_SPENT))!)).toHaveLength(3);
    expect(Object.keys((await session.get<Record<string, number>>(SESSION_SPENT_SITES))!)).toHaveLength(5_000);
    // The newest sites' spends are the ones kept, and they count as spent, and as the last send.
    expect(spent.has(`${(129).toString(16).padStart(64, "0")}#0`)).toBe(true);
    expect(spent.has(`${(100).toString(16).padStart(64, "0")}#0`)).toBe(false);
    expect(await lastSpentAt(session, at + 60_000)).toBe(at + 1_029);
    // Never among the wallet's own sends, which other sites chain on.
    expect(await recentlySent(session, "preprod", at + 60_000)).toHaveLength(1);
  });

  it("never pushes out the wallet's own spends or sends, however much a site sends through it", async () => {
    const { t, s } = await connected();
    const own = spending(1, 2);
    await t.wallet.withKeys(() => rememberSpent(t.session, "preprod", own));
    for (let i = 0; i < 20; i++) {
      if (i && i % 10 === 0) t.clock.now += 61_000;
      const tx = spending(200 + i, 400);
      expect(await t.dapp.call(s, "submitTx", [hex(tx)])).toBe(txIdOf(tx));
    }
    const spent = await t.wallet.withKeys(() => spentSet(t.session));
    expect(spent.has(`${"1".padStart(64, "0")}#1`)).toBe(true);
    expect(spent.has(`${(219).toString(16).padStart(64, "0")}#399`)).toBe(true);
    const sent = await t.wallet.withKeys(() => recentlySent(t.session, "preprod"));
    expect(sent.map((x) => x.txHash)).toEqual([txIdOf(own)]);
    expect(Object.keys((await t.session.get<Record<string, number>>(SESSION_SPENT))!)).toHaveLength(2);
  });

  it("isn't kept at all for a transaction already on chain that a site sends again", async () => {
    const { t, s } = await connected();
    const tx = spending(7, 2);
    // A send of the wallet's own, for the sites to chain on.
    await t.wallet.withKeys(() => rememberSent(t.session, "preprod", spending(8, 1)));
    await t.session.set(SESSION_BALANCES_PREFIX + "preprod", { kept: true });
    t.koios.rejectSubmit = '{"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["BadInputsUTxO"]}}}}';
    t.koios.confirmations = 12;
    expect(await t.dapp.call(s, "submitTx", [hex(tx)])).toBe(txIdOf(tx));
    expect(t.session.data.has(SESSION_SPENT_SITES)).toBe(false);
    expect(t.session.data.has(SESSION_SPENT)).toBe(false);
    expect(await t.session.get(SESSION_DAPP_SIGNED + "preprod")).toBeUndefined();
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toEqual({ kept: true });
    expect(await t.wallet.withKeys(() => recentlySent(t.session, "preprod"))).toHaveLength(1);

    // One the network hasn't got is refused as ever, and nothing is kept either.
    t.koios.confirmations = null;
    await expect(t.dapp.call(s, "submitTx", [hex(spending(9, 1))])).rejects.toMatchObject({ failure: { code: 2 } });
    expect(t.session.data.has(SESSION_SPENT_SITES)).toBe(false);
  });
});
