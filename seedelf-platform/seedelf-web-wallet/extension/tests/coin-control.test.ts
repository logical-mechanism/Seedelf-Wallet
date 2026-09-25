// Coin control: locked UTxOs are left out of every spend on their side, and
// the Cardano account's collateral is a 5 ₳ UTxO set aside (the oldest the
// account holds, unless the user chose or reclaimed one). Nothing here asks
// Koios anything, and the choices are sealed on the device.
import { describe, expect, it } from "vitest";

import { bodyOutpoints } from "../src/background/cbor";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { SESSION_MINT } from "../src/background/mint";
import { SESSION_COLLATERAL } from "../src/background/send";
import type { KoiosUtxo } from "../src/background/koios";
import { accountMintPreprod, koiosPreprod, ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = phrase(15).preprod.receive_0 as string;
const at = (u: { txHash: string; index: number } | KoiosUtxo) =>
  "txHash" in u ? `${u.txHash}#${u.index}` : `${u.tx_hash}#${u.tx_index}`;
const hexBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

async function unlocked(words: 12 | 24) {
  const t = testBalances();
  await t.wallet.create(phrase(words).phrase, PASSWORD);
  return t;
}

/** The 24-word phrase's recorded account: six pure 5 ₳ UTxOs among twelve of its own. */
const account24 = () => {
  const all = koiosPreprod.accounts[phrase(24).preprod.stake]!.account_utxos;
  const ours = all.filter((u) => !u.address.startsWith("addr_test1z"));
  const fives = ours
    .filter((u) => u.value === "5000000" && !u.asset_list?.length)
    .sort((a, b) => a.block_height! - b.block_height!);
  return { ours, fives };
};

describe("the collateral", () => {
  it("is the oldest pure 5 ₳ UTxO the account holds, kept out of every payment; the other 5 ₳ ones are spent", async () => {
    const t = await unlocked(24);
    const { ours, fives } = account24();
    const b = await t.balances.get("preprod");
    expect(b.cardano.locked).toEqual({ lovelace: "5000000", tokens: [], utxos: 1 });
    expect(b.cardano.utxos).toBe(ours.length); // still counted in the balance

    const status = await t.coins.collateral("preprod");
    expect(status).toMatchObject({ state: "set", by: "wallet", utxo: { txHash: fives[0]!.tx_hash, index: 0, locked: true, collateral: true } });

    const max = await t.send.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(max.inputs).toBe(ours.length - 1);
    const built = await t.session.get<{ txCbor: string }>("seedelf.send.built");
    const inputs = bodyOutpoints(hexBytes(built!.txCbor), 0)!;
    expect(inputs).not.toContain(at(fives[0]!));
    for (const five of fives.slice(1)) expect(inputs).toContain(at(five));
  });

  it("can be reclaimed, and set again from a 5 ₳ UTxO with no transaction", async () => {
    const t = await unlocked(24);
    const { ours, fives } = account24();
    await t.balances.get("preprod");
    const calls = t.koios.calls.length;

    expect(await t.coins.reclaim("preprod")).toMatchObject({ state: "none", reclaimed: true, candidate: { txHash: fives[0]!.tx_hash } });
    expect((await t.balances.get("preprod")).cardano.locked.utxos).toBe(0);
    expect((await t.send.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }])).inputs).toBe(ours.length);

    const chosen = at(fives[2]!);
    expect(await t.coins.use("preprod", chosen)).toMatchObject({ state: "set", by: "you", utxo: { txHash: fives[2]!.tx_hash } });
    await expect(t.coins.use("preprod", at(ours.find((u) => u.asset_list?.length)!))).rejects.toThrow("exactly 5 ₳");
    // The Max above read the account and its stake key again; reclaiming and choosing didn't.
    expect(t.koios.calls.length - calls).toBe(4);
  });

  it("is made by 5 ₳ paid to the account's own 0/0, waited for, then put up by an account-paid mint", async () => {
    const t = await unlocked(12);
    await t.balances.get("preprod");
    expect(await t.coins.collateral("preprod")).toEqual({ state: "none", reclaimed: false });

    const summary = await t.send.buildCollateral("preprod");
    expect(summary.payments).toMatchObject([{ address: phrase(12).preprod.receive_0, own: true, lovelace: "5000000", tokens: [] }]);
    expect(await t.session.get(SESSION_COLLATERAL)).toMatchObject({ txHash: summary.txHash });
    const pending = await t.send.submitCollateral("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "collateral", txHash: summary.txHash });
    expect(await t.coins.collateral("preprod")).toEqual({ state: "waiting", txHash: summary.txHash });
    expect((await t.activity.seedelf("preprod")).map((e) => e.txHash)).not.toContain(summary.txHash);

    // On chain: output 0 of that transaction, at 0/0.
    const template = koiosPreprod.accounts[phrase(12).preprod.stake]!.account_utxos.find(
      (u) => u.address === phrase(12).preprod.receive_0,
    )!;
    const made: KoiosUtxo = { ...template, tx_hash: summary.txHash, tx_index: 0, value: "5000000", asset_list: [], block_height: 5_300_000 };
    t.koios.addedToAccounts.push(made);
    await t.balances.get("preprod", true);
    expect(await t.coins.collateral("preprod")).toMatchObject({ state: "set", by: "you", utxo: { txHash: summary.txHash, index: 0 } });

    t.koios.evaluation = accountMintPreprod.evaluation;
    await t.mint.build("preprod", "", "account");
    const mint = (await t.session.get<{ txCbor: string }>(SESSION_MINT))!;
    expect(bodyOutpoints(hexBytes(mint.txCbor), 13)).toEqual([at(made)]);
    expect(bodyOutpoints(hexBytes(mint.txCbor), 0)).not.toContain(at(made));
  });

  it("stops being waited for after 10 minutes", async () => {
    const t = await unlocked(12);
    await t.balances.get("preprod");
    const summary = await t.send.buildCollateral("preprod");
    await t.send.submitCollateral("preprod", summary.txHash);
    t.clock.now += 11 * 60_000;
    expect(await t.coins.collateral("preprod")).toEqual({ state: "none", reclaimed: false });
  });
});

describe("locked UTxOs", () => {
  it("are left out of the account's payments, and counted apart", async () => {
    const t = await unlocked(12);
    await t.balances.get("preprod");
    const { cardano } = await t.coins.lists("preprod");
    expect(cardano).toHaveLength(6);
    expect(cardano.map((u) => BigInt(u.lovelace))).toEqual(cardano.map((u) => BigInt(u.lovelace)).sort((a, b) => (b > a ? 1 : -1)));
    const biggest = cardano[0]!;

    const after = await t.coins.setLocked("preprod", "cardano", at(biggest), true);
    expect(after.cardano[0]).toMatchObject({ txHash: biggest.txHash, locked: true });
    const b = await t.balances.get("preprod");
    expect(b.cardano.locked).toMatchObject({ lovelace: biggest.lovelace, utxos: 1 });
    expect(b.cardano.locked.tokens).toEqual(biggest.tokens);

    // More than what's left, even with the staking rewards.
    await expect(t.send.build("preprod", [{ to: THEIRS, lovelace: "100000000", tokens: [] }])).rejects.toThrow("Not enough ADA");
    const max = await t.send.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(max.inputs).toBe(5);

    await t.coins.setLocked("preprod", "cardano", at(biggest), false);
    expect((await t.balances.get("preprod")).cardano.locked.utxos).toBe(0);
    expect((await t.send.build("preprod", [{ to: THEIRS, lovelace: "100000000", tokens: [] }])).inputs).toBeGreaterThan(0);
  });

  it("are left out of Seedelf spends; a Seedelf's UTxO can't be locked, and everything locked says so", async () => {
    const t = await unlocked(12);
    await t.balances.get("preprod");
    const { seedelf } = await t.coins.lists("preprod");
    expect(seedelf.map(at).sort()).toEqual(ownedUtxos.map(at).sort());
    const holder = seedelf.find((u) => u.seedelf)!;
    expect(holder).toMatchObject({ seedelf: { label: "web-wallet" }, locked: false, tokens: [] });
    await expect(t.coins.setLocked("preprod", "seedelf", at(holder), true)).rejects.toThrow("only removing it");

    const big = seedelf.find((u) => u.lovelace === "25000000")!;
    await t.coins.setLocked("preprod", "seedelf", at(big), true);
    expect((await t.balances.get("preprod")).seedelf.locked).toMatchObject({ lovelace: "25000000", utxos: 1 });
    t.koios.evaluation = withdrawPreprod.max.evaluation;
    const max = await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(max.inputs).toBe(1);

    const other = seedelf.find((u) => !u.seedelf && u !== big)!;
    await t.coins.setLocked("preprod", "seedelf", at(other), true);
    await expect(t.withdraw.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }])).rejects.toThrow("Every UTxO in your Seedelf balance is locked");
  });

  it("refuse the collateral and UTxOs not in the last reading, and forget spent ones", async () => {
    const t = await unlocked(24);
    await t.balances.get("preprod");
    const { fives } = account24();
    await expect(t.coins.setLocked("preprod", "cardano", at(fives[0]!), true)).rejects.toThrow("Reclaim it in Settings");
    await expect(t.coins.setLocked("preprod", "cardano", `${"00".repeat(32)}#0`, true)).rejects.toThrow("last reading");

    await t.coins.setLocked("preprod", "cardano", at(fives[1]!), true);
    t.koios.spent.add(at(fives[1]!));
    await t.balances.get("preprod", true);
    await t.coins.setLocked("preprod", "cardano", at(fives[2]!), true);
    expect((await t.coins.choices("preprod")).cardano).toEqual([at(fives[2]!)]);
  });

  it("are sealed on the device, unreadable while locked, and ask Koios nothing", async () => {
    const t = await unlocked(12);
    await t.balances.get("preprod");
    const calls = t.koios.calls.length;
    const { seedelf } = await t.coins.lists("preprod");
    await t.coins.setLocked("preprod", "seedelf", at(seedelf[0]!), true);
    await t.coins.collateral("preprod");
    expect(t.koios.calls.length).toBe(calls);

    const sealed = JSON.stringify(t.local.data.get(`${PRIVATE_PREFIX}coins.preprod`));
    expect(sealed).toBeDefined();
    expect(sealed).not.toContain(seedelf[0]!.txHash);
    await t.wallet.lock();
    await expect(t.coins.choices("preprod")).rejects.toThrow("locked");
  });
});
