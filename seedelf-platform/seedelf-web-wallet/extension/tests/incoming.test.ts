// What the wallet's own sent transactions pay back before the chain shows them
// (chunk 23's second review, HM-1, HM-2): a payment's change and a Make
// private's deposit, from what the device keeps, with each side less what the
// wallet has spent since its reading (blind test §9.3). Never counted twice,
// the rewards a payment withdraws included (blind test §9.1), never for one
// that didn't go out, and no request.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { SESSION_CONTRACT_PREFIX } from "../src/background/contract-scan";
import { forgetSpent } from "../src/background/spent";
import { TransferService } from "../src/background/transfer";
import { pendingKey } from "../src/background/pending";
import { heldSent, rememberSent, SESSION_SENT_PREFIX, type SentTx } from "../src/background/sent-txs";
import { SESSION_PRIVATE_STALE_PREFIX } from "../src/background/wallet";
import type { Balances } from "../src/shared/rpc";
import { busyFor, koiosPreprod, loadTestWasm, memoryArea, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;

const TUSDM = { policyId: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9", assetName: "0014df10745553444d" };

/** On the device's real clock: what's sent is timed by it (sent-txs.ts), and a reading by the wallet's. */
async function unlocked() {
  const t = testBalances();
  t.clock.now = Date.now();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

/** The public account as Home shows it (Home.tsx shownAccountTotal): its UTxOs, its rewards and what's on its way. */
const publicShown = (b: Balances) =>
  BigInt(b.cardano.lovelace) + BigInt(b.cardano.staking.rewards) + BigInt(b.cardano.incoming?.lovelace ?? "0");
/** The private balance as Home shows it (privateTotal). */
const privateShown = (b: Balances) => BigInt(b.seedelf.lovelace) + BigInt(b.seedelf.incoming?.lovelace ?? "0");

describe("what the wallet's own transactions pay back", () => {
  it("counts a payment's change at once, with what it spent out of the reading, and only while it's on its way", async () => {
    const t = await unlocked();
    const before = await t.balances.get("preprod");
    expect(before.cardano.incoming).toBeUndefined();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    await t.send.submit("preprod", summary.txHash);
    const asked = t.koios.calls.length;
    const spends = txInputs(t.koios.submitted[0]!);

    // The reading from before the payment, less what the payment spent, and its change on its way: no request.
    const kept = await t.balances.get("preprod");
    expect(t.koios.calls).toHaveLength(asked);
    expect(kept.cardano.incoming!.utxos).toBe(1);
    expect(kept.cardano.utxos).toBe(before.cardano.utxos - spends.length);
    expect(publicShown(kept)).toBe(publicShown(before) - 2_000_000n - BigInt(summary.fee));

    // A reading after it leaves the spent UTxOs out, and the change is on its way back: the balance doesn't collapse.
    t.clock.now = Date.now() + 60_000;
    const after = await t.balances.get("preprod", true);
    const incoming = after.cardano.incoming!;
    expect(incoming.utxos).toBe(1);
    expect(BigInt(after.cardano.lovelace) + BigInt(incoming.lovelace)).toBe(
      BigInt(before.cardano.lovelace) + BigInt(summary.withdrawal ?? "0") - 2_000_000n - BigInt(summary.fee),
    );
    expect(publicShown(after)).toBe(publicShown(kept));
    // The tokens that came back with the change stay listed.
    const held = (b: typeof before) => new Map(b.cardano.tokens.map((x) => [`${x.policyId}.${x.assetName}`, BigInt(x.quantity)]));
    const was = held(before);
    const now = held(after);
    for (const token of incoming.tokens) now.set(`${token.policyId}.${token.assetName}`, (now.get(`${token.policyId}.${token.assetName}`) ?? 0n) + BigInt(token.quantity));
    expect(now).toEqual(was);
    expect(after.seedelf.incoming).toBeUndefined();

    // Freed, as one that never went out is: nothing is on its way, and the rewards count again.
    await t.wallet.withKeys(() => forgetSpent(t.session, spends));
    const freed = await t.balances.get("preprod");
    expect(freed.cardano.incoming).toBeUndefined();
    expect(freed.cardano.staking.rewards).toBe(before.cardano.staking.rewards);
  });

  it("counts a Make private's deposit on the private side at once, and the public side less what it spent", async () => {
    const t = await unlocked();
    const before = await t.balances.get("preprod");
    const summary = await t.moveIn.build("preprod", "5000000", []);
    await t.moveIn.submit("preprod", summary.txHash);
    const b = await t.balances.get("preprod");
    expect(b.seedelf.incoming).toEqual({ lovelace: "5000000", tokens: [], utxos: 1 });
    expect(b.seedelf.lovelace).toBe(before.seedelf.lovelace);
    // Not in both balances at once: the public side's reading is from before, less what the deposit spent.
    expect(b.cardano.incoming).toBeDefined();
    expect(publicShown(b)).toBe(publicShown(before) - 5_000_000n - BigInt(summary.fee));
  });
});

describe("Home's look right after a send (blind test §9.3)", () => {
  it("answers from the kept reading alone, asking Koios nothing, even with its private side behind", async () => {
    const t = await unlocked();
    // Nothing kept yet: nothing is read for it either.
    await expect(t.balances.get("preprod", false, { kept: true })).rejects.toThrow();
    expect(t.koios.calls).toHaveLength(0);
    await t.balances.get("preprod");
    const asked = t.koios.calls.length;
    // A private spend landed: the next ordinary request reads the contract, this one doesn't (privacy review §2.9).
    await t.session.set(`${SESSION_PRIVATE_STALE_PREFIX}preprod`, true);
    const b = await t.balances.get("preprod", false, { kept: true });
    expect(t.koios.calls).toHaveLength(asked);
    expect(privateShown(b)).toBe(28_000_000n);
  });
});

/** Puts `tx` in a block on the fake Koios: what it spent is gone, its outputs to the account listed, the rewards taken. */
function land(t: Awaited<ReturnType<typeof unlocked>>, tx: Uint8Array) {
  const wasm = loadTestWasm();
  const hex = Array.from(tx, (b) => b.toString(16).padStart(2, "0")).join("");
  for (const o of txInputs(tx)) t.koios.spent.add(o);
  const detail = JSON.parse(wasm.decodeTx(wasm.Network.Preprod, hex)) as {
    txHash: string;
    outputs: Array<{ index: number; address: { bech32: string; hex: string; payment: string | null }; lovelace: string }>;
    withdrawals: Array<{ address: string; lovelace: string }>;
  };
  const template = Object.values(koiosPreprod.accounts)[0]!.account_utxos[0]!;
  for (const o of detail.outputs) {
    if (o.address.payment !== "key") continue;
    t.koios.addedToAccounts.push({
      ...template,
      tx_hash: detail.txHash,
      tx_index: o.index,
      address: o.address.bech32,
      payment_cred: o.address.hex.slice(2, 58),
      value: o.lovelace,
      asset_list: [],
      block_height: (template.block_height ?? 0) + 1,
    });
  }
  for (const w of detail.withdrawals) {
    const info = t.koios.stakes.get(w.address);
    if (info) t.koios.stakes.set(w.address, { ...info, rewards_available: "0" });
  }
}

// T08: 25 ₳ sent from the public account, 10,408.014036 ₳ with 57.475311 ₳ of rewards, with "Use staking rewards
// when spending" on (the default): it spent one 3 ₳ UTxO, withdrew the rewards, and its change, 35.300614 ₳, held
// them. A Refresh while it waited read 10,440.31465 ₳ against the review's 10,382.839339 ₳ (blind test §9.1).
describe("a payment that collects the staking rewards (blind test §9.1, T08)", () => {
  /** On a chain tip like preprod's, as the test's was: the slot it's valid until takes four bytes, and the fee T08's. */
  const onPreprodTip = async () => {
    const t = await unlocked();
    t.koios.tip = 106_000_000;
    return t;
  };

  it("reads as the review's after while it waits, kept or read again, and as much once it lands", async () => {
    const t = await onPreprodTip();
    const before = await t.balances.get("preprod");
    expect(publicShown(before)).toBe(10_408_014_036n);
    expect(before.cardano.staking.rewards).toBe("57475311");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    expect(summary).toMatchObject({ withdrawal: "57475311", fee: "174697" });
    await t.send.submit("preprod", summary.txHash);
    const [tx] = t.koios.submitted;
    expect(txInputs(tx!)).toHaveLength(1);

    // Right after the send, Home's look: the kept reading alone, with no request.
    const asked = t.koios.calls.length;
    const kept = await t.balances.get("preprod", false, { kept: true });
    expect(t.koios.calls).toHaveLength(asked);
    expect(kept.cardano.lovelace).toBe("10347538725");
    expect(kept.cardano.incoming).toEqual({ lovelace: "35300614", tokens: [], utxos: 1 });
    // The rewards are in the change on its way: "Includes … of staking rewards" goes, and no form spends them again.
    expect(kept.cardano.staking.rewards).toBe("0");
    expect(publicShown(kept)).toBe(10_382_839_339n);

    // T08's Refresh: Koios still lists the coin it spent (it's read again, and left out) and still reports the rewards.
    t.clock.now = Date.now() + 60_000;
    const read = await t.balances.get("preprod", true);
    expect(read.cardano.lovelace).toBe("10347538725");
    expect(read.cardano.incoming!.lovelace).toBe("35300614");
    expect(read.cardano.staking.rewards).toBe("0");
    expect(publicShown(read)).toBe(10_382_839_339n);
    expect(publicShown(read)).not.toBe(10_440_314_650n);

    // It lands: Koios lists the change, not the coin, and reports no rewards. Nothing's on its way, nothing taken twice.
    land(t, tx!);
    t.clock.now = Date.now() + 120_000;
    const landed = await t.balances.get("preprod", true);
    expect(landed.cardano.incoming).toBeUndefined();
    expect(landed.cardano.staking.rewards).toBe("0");
    expect(publicShown(landed)).toBe(10_382_839_339n);
  });

  // The fix round's review: whether a reading has seen the withdrawal land can't always be told, and the rewards
  // shown then err low, never high.
  it("never shows the rewards a payment withdrew on top of its change, however the reading reads", async () => {
    const t = await onPreprodTip();
    await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", summary.txHash);
    land(t, t.koios.submitted[0]!);
    const stake = before12Stake();
    // account_info behind the UTxOs: the change is listed, the rewards it holds still reported. They come out.
    t.koios.stakes.set(stake, { ...t.koios.stakes.get(stake)!, rewards_available: "57475311" });
    t.clock.now = Date.now() + 60_000;
    const behind = await t.balances.get("preprod", true);
    expect(behind.cardano.incoming).toBeUndefined();
    expect(behind.cardano.staking.rewards).toBe("0");
    expect(publicShown(behind)).toBe(10_382_839_339n);
    // Landed, and an epoch's new rewards since, less than it took: the reading has seen it land, and they count.
    t.koios.stakes.set(stake, { ...t.koios.stakes.get(stake)!, rewards_available: "1000000" });
    t.clock.now = Date.now() + 120_000;
    expect((await t.balances.get("preprod", true)).cardano.staking.rewards).toBe("1000000");
  });

  it("takes all the rewards a reading from before an epoch's counts, when the payment took more", async () => {
    const t = await onPreprodTip();
    await t.balances.get("preprod");
    // An epoch paid 1 ₳ more after the reading: the payment withdraws 58.475311 ₳, all of it in its change.
    const stake = before12Stake();
    t.koios.stakes.set(stake, { ...t.koios.stakes.get(stake)!, rewards_available: "58475311" });
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    expect(summary.withdrawal).toBe("58475311");
    await t.send.submit("preprod", summary.txHash);
    const b = await t.balances.get("preprod", false, { kept: true });
    expect(b.cardano.staking.rewards).toBe("0");
    expect(b.cardano.withdrawing).toBe("57475311");
    expect(b.cardano.incoming!.lovelace).toBe("36300614");
    // What's there once it lands: the coins it didn't spend and its change, no rewards.
    expect(publicShown(b)).toBe(10_347_538_725n + 36_300_614n);
  });

  it("counts the rewards again once the payment is refused or let go", async () => {
    const t = await onPreprodTip();
    await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", summary.txHash);
    expect((await t.balances.get("preprod")).cardano.staking.rewards).toBe("0");
    await t.wallet.withKeys(() => forgetSpent(t.session, txInputs(t.koios.submitted[0]!)));
    const b = await t.balances.get("preprod");
    expect(b.cardano.staking.rewards).toBe("57475311");
    expect(b.cardano.incoming).toBeUndefined();
    expect(publicShown(b)).toBe(10_408_014_036n);
  });

  it("builds no second withdrawal of them while the first is on its way, as the forms offer none", async () => {
    const t = await onPreprodTip();
    await t.balances.get("preprod");
    const first = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", first.txHash);
    // Koios still reports the rewards; only one withdrawal of them could land.
    const second = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    expect(second.withdrawal ?? "0").toBe("0");
    // Freed, the first never went out: the next payment takes them again.
    await t.wallet.withKeys(() => forgetSpent(t.session, txInputs(t.koios.submitted[0]!)));
    expect((await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).withdrawal).toBe("57475311");
  });

  // The fix round's review: Withdraw was greyed out (Home's rewards read 0), but Stop staking built after the
  // 10-minute hold withdrew the 57.475311 ₳ again, and the ledger would refuse one of the two.
  it("has Stop staking and Withdraw rewards wait for a payment that withdrew the rewards", async () => {
    const t = await onPreprodTip();
    await t.balances.get("preprod");
    const first = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", first.txHash);
    await expect(t.staking.build("preprod", { kind: "stop" })).rejects.toThrow("collected these rewards and isn't confirmed yet");
    await expect(t.staking.build("preprod", { kind: "withdraw" })).rejects.toThrow("collected these rewards and isn't confirmed yet");
    // Freed, it never went out: they can be withdrawn.
    await t.wallet.withKeys(() => forgetSpent(t.session, txInputs(t.koios.submitted[0]!)));
    expect((await t.staking.build("preprod", { kind: "stop" })).withdrawal).toBe("57475311");
  });

  // The fix round's second review: once the payment has landed, an epoch's new rewards (here as much again, as for
  // someone who pays every epoch) were held back as on their way for the two hours it stays kept, and Withdraw and
  // Stop staking said it wasn't confirmed.
  it("lets the next payment, a withdrawal or a stop take an epoch's new rewards once the payment has landed", async () => {
    const t = await onPreprodTip();
    await t.balances.get("preprod");
    const first = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", first.txHash);
    land(t, t.koios.submitted[0]!);
    const stake = before12Stake();
    t.koios.stakes.set(stake, { ...t.koios.stakes.get(stake)!, rewards_available: "57475311" });
    for (let i = 0; i < 30; i++) await busyFor(t, 60_000);
    const second = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    expect(second.withdrawal).toBe("57475311");
    expect((await t.staking.build("preprod", { kind: "stop" })).withdrawal).toBe("57475311");
    expect((await t.staking.build("preprod", { kind: "withdraw" })).withdrawal).toBe("57475311");
    // The balance can't tell new rewards from an account_info behind the UTxOs: it never shows more than is there,
    // the coins, the change and the new rewards.
    const b = await t.balances.get("preprod", true);
    expect(b.cardano.incoming).toBeUndefined();
    expect(publicShown(b)).toBeLessThanOrEqual(10_347_538_725n + 35_300_614n + 57_475_311n);
  });

  // The fix round's review: two payments that spend the same coin (one let go unseen, one built again on it) were
  // left out of the guard, as only one of them can land; either may, and either withdraws.
  it("builds no third withdrawal while two that spend the same coin may still land", async () => {
    const t = await onPreprodTip();
    await t.balances.get("preprod");
    const first = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", first.txHash);
    const spends = txInputs(t.koios.submitted[0]!);
    await t.wallet.withKeys(() => forgetSpent(t.session, spends));
    const second = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    expect(second.withdrawal).toBe("57475311");
    await t.send.submit("preprod", second.txHash);
    expect(txInputs(t.koios.submitted[1]!).some((o) => spends.includes(o))).toBe(true);
    const third = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    expect(third.withdrawal ?? "0").toBe("0");
  });

  it("leaves another account's rewards alone", async () => {
    const t = await onPreprodTip();
    const before = await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", summary.txHash);
    // The account's stake key as some other account's would be: nothing it sent withdrew from that one.
    const kept = (await t.session.get<{ stake: string; addresses: string[]; keys: string[] }>("seedelf.accountAddresses.preprod"))!;
    await t.session.set("seedelf.accountAddresses.preprod", { ...kept, stake: account(15).preprod.stake });
    const b = await t.balances.get("preprod");
    expect(b.cardano.staking.rewards).toBe(before.cardano.staking.rewards);
  });

  // T07: 20 ₳ made private from the same account, rewards and all: Public 10,387.835687 ₳ and Private 48 ₳ after.
  it("shows a Make private's after on both sides at once, the rewards in the public side's change (T07)", async () => {
    const t = await onPreprodTip();
    const before = await t.balances.get("preprod");
    expect(privateShown(before)).toBe(28_000_000n);
    const summary = await t.moveIn.build("preprod", "20000000", []);
    expect(summary).toMatchObject({ withdrawal: "57475311", fee: "178349" });
    await t.moveIn.submit("preprod", summary.txHash);
    const b = await t.balances.get("preprod", false, { kept: true });
    expect(b.cardano.incoming!.lovelace).toBe("40296962");
    expect(b.cardano.staking.rewards).toBe("0");
    expect(publicShown(b)).toBe(10_387_835_687n);
    expect(b.seedelf.incoming!.lovelace).toBe("20000000");
    expect(privateShown(b)).toBe(48_000_000n);
  });

  // E04 and T13: withdrawing the rewards leaves the balance as it was but for the fee ("Your balance stays the same,
  // but for the fee"); stopping staking withdraws them too, and gives the 2 ₳ deposit back.
  it.each([
    ["withdraw", 0n],
    ["stop", 2_000_000n],
  ] as const)("reads a %s's after as its review says, while it waits", async (kind, back) => {
    const t = await onPreprodTip();
    const before = await t.balances.get("preprod");
    const summary = await t.staking.build("preprod", { kind });
    await t.staking.submit("preprod", summary.txHash);
    const b = await t.balances.get("preprod", false, { kept: true });
    expect(b.cardano.staking.rewards).toBe("0");
    expect(publicShown(b)).toBe(publicShown(before) + back - BigInt(summary.fee));
  });
});

// The fix round's review: a payment was counted as on its way for 20 minutes while what it spent stayed out of the
// balance for two hours. At minute 21 T08's change was gone and its rewards counted again: 10,405.014036 ₳.
describe("a payment still on its way past 20 minutes", () => {
  it("still counts its change, and not the rewards it took, while what it spent is held back", async () => {
    const t = await unlocked();
    t.koios.tip = 106_000_000;
    await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "25000000", tokens: [] }]);
    await t.send.submit("preprod", summary.txHash);
    const now = await t.balances.get("preprod", false, { kept: true });
    expect(publicShown(now)).toBe(10_382_839_339n);
    // 21 minutes on, not in a block, or in one no reading has seen.
    const key = `${SESSION_SENT_PREFIX}preprod`;
    const kept = (await t.session.get<SentTx[]>(key))!;
    await t.session.set(key, kept.map((s) => ({ ...s, sentAt: s.sentAt - 21 * 60_000 })));
    const later = await t.balances.get("preprod", false, { kept: true });
    expect(later.cardano.incoming!.lovelace).toBe("35300614");
    expect(later.cardano.staking.rewards).toBe("0");
    expect(publicShown(later)).toBe(10_382_839_339n);
    // Nor is a payment built meanwhile taking them again.
    expect((await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).withdrawal ?? "0").toBe("0");
  });

  it("keeps a payment of the wallet's however many steps a chain sends after it", async () => {
    const session = memoryArea();
    const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (h) => Number.parseInt(h, 16));
    const tx = (i: number) => bytes(`84a10081825820${i.toString(16).padStart(64, "0")}00a0f5f6`);
    await rememberSent(session, "preprod", tx(1), 1_000, 0);
    for (let i = 2; i < 40; i++) await rememberSent(session, "preprod", tx(i), 1_000 * i);
    const held = await heldSent(session, "preprod", 40_000);
    expect(held.filter((s) => s.account === 0)).toHaveLength(1);
    expect(held.filter((s) => s.account === undefined)).toHaveLength(16);
    // Two hours on, it's gone, as what it spent is no longer held back.
    expect((await heldSent(session, "preprod", 1_000 + 2 * 60 * 60_000)).filter((s) => s.account === 0)).toEqual([]);
    // Sent again, it keeps whose it is.
    await rememberSent(session, "preprod", tx(1), 41_000);
    expect((await heldSent(session, "preprod", 42_000)).find((s) => s.txHash === held[0]!.txHash)?.account).toBe(0);
  });

  it("has the next reading read the private side again once a private payment's 10-minute watch ends", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const summary = await t.transfer.build("preprod", [{ to: transferPreprod.to, lovelace: transferPreprod.lovelace, tokens: transferPreprod.tokens }]);
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const wasm = loadTestWasm();
    const transfer = new TransferService({
      ...t.deps,
      wasm: { ...wasm, signScriptSpend: (_key: unknown, r: string) => JSON.stringify({ txCbor: JSON.parse(r).txCbor, txHash: summary.txHash }) } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    });
    await transfer.submit("preprod", summary.txHash);
    expect(await t.session.get(`${SESSION_PRIVATE_STALE_PREFIX}preprod`)).toBeUndefined();
    // Not seen in a block for 10 minutes: no longer watched, and it may land unseen.
    t.clock.now += 11 * 60_000;
    await t.wallet.touch();
    expect(await t.pending.pending("preprod")).not.toBeNull();
    expect(await t.session.get(`${pendingKey("preprod")}`)).toBeUndefined();
    expect(await t.session.get(`${SESSION_PRIVATE_STALE_PREFIX}preprod`)).toBe(true);
  });
});

/** The 12-word phrase's stake address on preprod. */
const before12Stake = () => account(12).preprod.stake as string;

describe("what's never counted twice (chunk 23's second review, fix round)", () => {
  /** Holds every Koios answer but a submit's until `release`: a reading that waits on Koios while a payment goes. */
  const held = (t: Awaited<ReturnType<typeof unlocked>>) => {
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    return async () => {
      release();
      t.koios.hold = undefined;
    };
  };
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it("counts neither of two sent transactions that spend the same UTxO: only one of them can land", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const first = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    await t.send.submit("preprod", first.txHash);
    // Let go unseen, its UTxOs freed and kept as sent, and a second payment built on them.
    const spends = txInputs(t.koios.submitted[0]!);
    await t.wallet.withKeys(() => forgetSpent(t.session, spends));
    const second = await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    await t.send.submit("preprod", second.txHash);
    expect(txInputs(t.koios.submitted[1]!).some((o) => spends.includes(o))).toBe(true);

    t.clock.now = Date.now() + 60_000;
    const after = await t.balances.get("preprod", true);
    expect(after.cardano.incoming).toBeUndefined();
  });

  it("takes what a payment spent out of a reading that began before it, however late that reading ended", async () => {
    const t = await unlocked();
    const before = await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    const release = held(t);
    const reading = t.balances.get("preprod", true);
    await tick();
    // Sent while the reading waits on Koios: it took what's spent before, so it still lists what this spent. That
    // comes out of it now, and the change counts once.
    await t.send.submit("preprod", summary.txHash);
    t.clock.now = Date.now() + 60_000;
    await release();
    const b = await reading;
    const spends = txInputs(t.koios.submitted[0]!);
    expect(b.cardano.utxos).toBe(before.cardano.utxos - spends.length);
    expect(b.cardano.incoming!.utxos).toBe(1);
    expect(publicShown(b)).toBe(publicShown(before) - 2_000_000n - BigInt(summary.fee));
  });

  it("counts the private side's change once, whenever the reading began", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const summary = await t.transfer.build("preprod", [{ to: transferPreprod.to, lovelace: transferPreprod.lovelace, tokens: transferPreprod.tokens }]);
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const wasm = loadTestWasm();
    const transfer = new TransferService({
      ...t.deps,
      wasm: { ...wasm, signScriptSpend: (_key: unknown, r: string) => JSON.stringify({ txCbor: JSON.parse(r).txCbor, txHash: summary.txHash }) } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    });
    const release = held(t);
    const reading = t.balances.get("preprod", true);
    await tick();
    await transfer.submit("preprod", summary.txHash);
    t.clock.now = Date.now() + 60_000;
    await release();
    // It began before the transfer went and still lists what the transfer spent: that comes out of it, and the
    // change is on its way.
    const b = await reading;
    expect(b.seedelf.incoming).toMatchObject({ utxos: 1 });
    expect(privateShown(b)).toBeLessThan(28_000_000n - BigInt(transferPreprod.lovelace));
    // A reading that began after it leaves those out, and says the same.
    t.clock.now = Date.now() + 120_000;
    const after = await t.balances.get("preprod", true);
    expect(after.seedelf.incoming).toMatchObject({ lovelace: b.seedelf.incoming!.lovelace, utxos: 1 });
    expect(privateShown(after)).toBe(privateShown(b));
  });

  it("counts nothing on the private side with no view of the contract kept to say what's listed", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    const summary = await t.moveIn.build("preprod", "5000000", []);
    await t.moveIn.submit("preprod", summary.txHash);
    expect((await t.balances.get("preprod")).seedelf.incoming).toMatchObject({ lovelace: "5000000" });
    // Session storage was full when the view was kept: whether a reading lists the deposit isn't known. The side
    // is left as read.
    await t.session.remove(`${SESSION_CONTRACT_PREFIX}preprod`);
    const b = await t.balances.get("preprod");
    expect(b.seedelf.incoming).toBeUndefined();
    expect(b.seedelf.lovelace).toBe("28000000");
  });

  it("gives a token on its way the decimals a reading lists it with", async () => {
    const t = await unlocked();
    const rows = Object.values(koiosPreprod.accounts).flatMap((a) => a.account_utxos.flatMap((u) => u.asset_list ?? []));
    const row = rows.find((a) => a.policy_id === TUSDM.policyId && a.asset_name === TUSDM.assetName)!;
    const was = row.decimals;
    row.decimals = 6;
    try {
      await t.balances.get("preprod");
      const summary = await t.moveIn.build("preprod", "5000000", [{ ...TUSDM, quantity: "1000000" }]);
      await t.moveIn.submit("preprod", summary.txHash);
      const { incoming } = (await t.balances.get("preprod")).seedelf;
      expect(incoming!.tokens).toEqual([expect.objectContaining({ ...TUSDM, quantity: "1000000", decimals: 6 })]);
    } finally {
      row.decimals = was;
    }
  });
});
