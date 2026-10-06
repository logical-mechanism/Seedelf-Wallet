// Public activity's pending rows (blind test §9.3), as the fix round's review
// of the merged tree found them wrong: another account's transaction listed as
// the active account's own, at a wrong amount, from the watch (the network's)
// or the private history (every account's); and a public mix's transactions,
// all sent and not in a block, listed as money received at their change's
// whole amount.
import { describe, expect, it } from "vitest";

import { SESSION_ACCOUNT_ADDRESSES_PREFIX, SESSION_ACCOUNT_ACTIVITY_PREFIX } from "../src/background/activity";
import { SESSION_ACCOUNT_UTXOS_PREFIX } from "../src/background/coin-control";
import { SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { SESSION_SENT_PREFIX, type SentTx } from "../src/background/sent-txs";
import { reservedSet } from "../src/background/spent";
import { LOCAL_ACCOUNT } from "../src/shared/preferences";
import { CHAINS, chainNet, lovejoinOf, publicFunded } from "./chain-fixtures";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;

/** On a chain tip like preprod's and the device's real clock, by which a send is kept. */
async function onPreprod() {
  const t = testBalances();
  t.koios.tip = 106_000_000;
  t.clock.now = Date.now();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

/** As if the user switched to another public account and Home read it: its keys, its stake address, no UTxOs. */
async function anotherAccountActive(t: Awaited<ReturnType<typeof onPreprod>>) {
  const kept = await t.session.get<Record<string, unknown>>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`);
  await t.session.set(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`, {
    ...kept,
    stake: account(15).preprod.stake,
    addresses: [account(15).preprod.receive_0],
    keys: ["77".repeat(28)],
  });
  await t.session.set(`${SESSION_ACCOUNT_UTXOS_PREFIX}preprod`, []);
  await t.session.remove(`${SESSION_ACCOUNT_ACTIVITY_PREFIX}preprod`);
  await t.local.set(LOCAL_ACCOUNT, 1);
}

describe("another account's transaction on its way", () => {
  it("isn't listed as the active account's: a Send, watched", async () => {
    const t = await onPreprod();
    await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", summary.txHash);
    // The account that sent it lists it.
    expect((await t.activity.cardano("preprod")).entries.filter((e) => e.pending)).toHaveLength(1);
    // Account 1's didn't, and read "Sent −60.300614 ₳ to … and 1 more".
    await anotherAccountActive(t);
    expect((await t.activity.cardano("preprod")).entries.filter((e) => e.pending)).toEqual([]);
  });

  it("isn't listed as the active account's: a Make private, which the shared private history has", async () => {
    const t = await onPreprod();
    await t.balances.get("preprod");
    const summary = await t.moveIn.build("preprod", "20000000", []);
    await t.moveIn.submit("preprod", summary.txHash);
    await anotherAccountActive(t);
    // It read "Made private −60.296962 ₳", for the 20 minutes it was kept.
    expect((await t.activity.cardano("preprod")).entries.filter((e) => e.pending)).toEqual([]);
  });
});

// The fix round's second review: whose a Send is was the account active when it went, not the one its review spent
// from. Reviewed on account 0 and sent after another window moved the picker to account 1, it was account 1's.
describe("a Send reviewed on one account and sent from another window's switch", () => {
  it("is the account it spends from", async () => {
    const t = await onPreprod();
    await t.balances.get("preprod");
    const addresses = await t.session.get(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`);
    const utxos = await t.session.get(`${SESSION_ACCOUNT_UTXOS_PREFIX}preprod`);
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.local.set(LOCAL_ACCOUNT, 1);
    await t.send.submit("preprod", summary.txHash);
    const sent = (await t.wallet.withKeys(() => t.session.get<SentTx[]>(`${SESSION_SENT_PREFIX}preprod`)))!;
    expect(sent.find((s) => s.txHash === summary.txHash)?.account).toBe(0);
    // Account 1, read as Home would: not its own.
    await anotherAccountActive(t);
    expect((await t.activity.cardano("preprod")).entries.filter((e) => e.pending)).toEqual([]);
    // Back on account 0: its own, pending.
    await t.local.set(LOCAL_ACCOUNT, 0);
    await t.session.set(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`, addresses);
    await t.session.set(`${SESSION_ACCOUNT_UTXOS_PREFIX}preprod`, utxos);
    await t.session.remove(`${SESSION_ACCOUNT_ACTIVITY_PREFIX}preprod`);
    expect((await t.activity.cardano("preprod")).entries.filter((e) => e.pending).map((e) => e.txHash)).toEqual([summary.txHash]);
  });
});

describe("a public mix, all sent, not in a block yet", CHAINS, () => {
  it("lists none of its transactions as received: Koios lists them once they land", async () => {
    const t = await publicFunded();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    await t.balances.get("preprod");
    const passing = async (ms: number) => {
      t.clock.now += ms;
      await t.wallet.touch();
    };
    const lovejoin = lovejoinOf(t, { sleep: passing });
    const summary = await lovejoin.publicBuild("preprod", 4);
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const order = kept!.chain.map((c) => c.txHash);
    const net = chainNet(t, () => order);
    await lovejoin.publicSubmit("preprod", summary.txHash);
    net.block();
    await lovejoin.pumpPublic("preprod", 0);
    // All sent, so nothing's reserved any more, and two still wait for a block.
    expect(await lovejoin.progress("preprod")).toBeNull();
    expect((await t.wallet.withKeys(() => reservedSet(t.session, "preprod"))).inputs.size).toBe(0);
    expect(net.mempool.length).toBeGreaterThan(0);
    // They read "+19.81 ₳", "+18.99 ₳"… and the watched mix "+16.52 ₳".
    const { entries } = await t.activity.cardano("preprod");
    expect(entries.filter((e) => e.pending)).toEqual([]);
  });
});
