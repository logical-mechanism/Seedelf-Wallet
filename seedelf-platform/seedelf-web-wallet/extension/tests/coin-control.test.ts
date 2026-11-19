// Coin control: locked UTxOs are left out of every spend on their side, and
// the Cardano account's collateral is a 5 ₳ UTxO set aside (the oldest the
// account holds, unless the user chose or reclaimed one). Nothing here asks
// Koios anything, and the choices are sealed on the device.
import { describe, expect, it } from "vitest";

import { readAccount, readAccountUtxos, VALID_FOR_MS } from "../src/background/account";
import { bodyOutpoints } from "../src/background/cbor";
import { choicesOf, COLLATERAL_PAID_KEPT, collateralPayments } from "../src/background/coin-control";
import { forgetContractView } from "../src/background/contract-scan";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { SESSION_MINT } from "../src/background/mint";
import { SESSION_COLLATERAL } from "../src/background/send";
import { SESSION_SENT_PREFIX, type SentTx } from "../src/background/sent-txs";
import { SESSION_SPENT } from "../src/background/spent";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { t as tr } from "../src/i18n";
import { LOCAL_ACCOUNT } from "../src/shared/preferences";
import { spentRewards, unlocked as unlockedSide, withRewards } from "../src/ui/format";
import { account, AGREES, CHAINS, publicFunded, type Tested } from "./chain-fixtures";
import { accountMintPreprod, koiosPreprod, ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS } from "./v2-pools";

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
    await expect(t.coins.use("preprod", at(ours.find((u) => u.asset_list?.length)!))).rejects.toThrow("exactly 5\u00a0₳");
    // The Max above read the account, its stake key and the chain's tip again; reclaiming and choosing didn't.
    expect(t.koios.calls.length - calls).toBe(5);
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

  it("records the payments that set it, for Activity, never a UTxO already held", async () => {
    const t = await unlocked(24);
    const { fives } = account24();
    await t.balances.get("preprod");
    const hash = (n: number) => n.toString(16).padStart(64, "0");
    for (let n = 1; n <= COLLATERAL_PAID_KEPT + 2; n++) await t.coins.sent("preprod", `${hash(n)}#0`);
    const paid = await collateralPayments(t.store, "preprod", 0);
    expect(paid.size).toBe(COLLATERAL_PAID_KEPT); // the newest
    expect(paid.has(hash(COLLATERAL_PAID_KEPT + 2))).toBe(true);
    expect(paid.has(hash(2))).toBe(false);
    // Another account's are its own.
    expect((await collateralPayments(t.store, "preprod", 1)).size).toBe(0);

    // Reclaimed and chosen from a 5 ₳ UTxO already held: no transaction set it, and the record stays.
    await t.coins.reclaim("preprod");
    await t.coins.use("preprod", at(fives[1]!));
    const after = await collateralPayments(t.store, "preprod", 0);
    expect(after.size).toBe(COLLATERAL_PAID_KEPT);
    expect(after.has(fives[1]!.tx_hash)).toBe(false);

    // A wallet from before the record: its collateral, made by a payment, is named by that payment.
    await t.store.set("coins.preprod", { seedelf: [], accounts: { "0": { cardano: [], collateral: `${hash(99)}#0`, collateralSentAt: 1 } } });
    expect([...(await collateralPayments(t.store, "preprod", 0))]).toEqual([hash(99)]);
  });

  it("stops being waited for 10 minutes after it was sent, once nothing on the device holds it as on its way: after a lock", async () => {
    const t = await unlocked(12);
    await t.balances.get("preprod");
    const summary = await t.send.buildCollateral("preprod");
    await t.send.submitCollateral("preprod", summary.txHash);
    // A lock forgets what was sent, and the watch of a payment Koios took (pending.ts): only when it was sent is sealed.
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    await t.balances.get("preprod");
    t.clock.now += 9 * 60_000;
    expect(await t.coins.collateral("preprod")).toEqual({ state: "waiting", txHash: summary.txHash });
    t.clock.now += 2 * 60_000;
    expect(await t.coins.collateral("preprod")).toEqual({ state: "none", reclaimed: false });
  });
});

describe("a collateral payment on its way (1.6.0's release review, 309#1, 309#2)", () => {
  it("stays on its way past 10 minutes while it can still land, as Home's banner says, and is not set once it can't", async () => {
    const t = await unlocked(12);
    await t.balances.get("preprod");
    const summary = await t.send.buildCollateral("preprod");
    await t.send.submitCollateral("preprod", summary.txHash);
    // A congested mempool: not in a block 11 minutes on, and the watch still has it, as it can land for two hours.
    t.clock.now += 11 * 60_000;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: null });
    // Late, so the page offers to pay it again anyway (1.6.0's review of the fixes, 309#1's leftover).
    expect(await t.coins.collateral("preprod")).toEqual({ state: "waiting", txHash: summary.txHash, late: true });
    // Past its slot, by the chain's clock too: let go, nothing was sent, and setting it is offered again.
    for (let left = VALID_FOR_MS; left > 0; left -= 10 * 60_000) {
      // The user busy all along, so the wallet doesn't lock itself.
      await t.wallet.touch();
      t.clock.now += 10 * 60_000;
    }
    t.koios.tip = 10 ** 12;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, dropped: "expired" });
    expect(await t.coins.collateral("preprod")).toEqual({ state: "none", reclaimed: false });
  });

  it("stays on its way while another payment from the account takes Home's watch, until it can't land", async () => {
    const t = await unlocked(12);
    await t.balances.get("preprod");
    const summary = await t.send.buildCollateral("preprod");
    await t.send.submitCollateral("preprod", summary.txHash);
    t.clock.now += 11 * 60_000;
    // Home's hold is over: the user sends something else from the account, and the watch follows that one.
    const other = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    await t.send.submit("preprod", other.txHash);
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: other.txHash });
    expect(await t.coins.collateral("preprod")).toEqual({ state: "waiting", txHash: summary.txHash, late: true });
    // Two hours after it was sent it can't land (account.ts VALID_FOR_MS), and the balance stops counting it.
    const key = `${SESSION_SENT_PREFIX}preprod`;
    const sent = (await t.session.get<SentTx[]>(key))!;
    await t.session.set(
      key,
      sent.map((s) => (s.txHash === summary.txHash ? { ...s, sentAt: s.sentAt - VALID_FOR_MS } : s)),
    );
    expect(await t.coins.collateral("preprod")).toEqual({ state: "none", reclaimed: false });
  });

  it("is recorded on the account it was built on, and pays, whichever is active when Send returns", async () => {
    const t = await unlocked(12);
    await t.balances.get("preprod");
    const summary = await t.send.buildCollateral("preprod");
    // Another window switched to the second account meanwhile.
    await t.local.set(LOCAL_ACCOUNT, 1);
    await t.send.submitCollateral("preprod", summary.txHash);
    const stored = await t.store.get<Parameters<typeof choicesOf>[0]>("coins.preprod");
    expect(choicesOf(stored, 0)).toMatchObject({
      collateral: `${summary.txHash}#0`,
      collateralSentAt: t.clock.now,
      collateralPaid: [summary.txHash],
    });
    expect(choicesOf(stored, 1)).toEqual({ seedelf: [], cardano: [] });
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
    await expect(t.withdraw.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }])).rejects.toThrow("Every UTxO in your private balance is locked");
  });

  it("say where each private UTxO's money came from, read from the sealed history alone (privacy review §2.3)", async () => {
    const t = await unlocked(12);
    // The private history started before this money arrived: its first reading found none (independent review L38).
    await t.activity.arrived("preprod", []);
    // Money the wallet made private itself; the reading notes the rest as received.
    const moved = ownedUtxos[0]!;
    await t.activity.sent(
      "preprod",
      { kind: "move-in", network: "preprod", txHash: moved.tx_hash, submittedAt: 1, confirmations: null },
      { lovelace: moved.value },
    );
    await t.balances.get("preprod");
    const asked = t.koios.calls.length;
    const { seedelf, cardano } = await t.coins.lists("preprod");
    expect(t.koios.calls).toHaveLength(asked);
    const of = (u: KoiosUtxo) => seedelf.find((x) => x.txHash === u.tx_hash)!;
    expect(of(moved).history).toEqual({ id: "public:0", origin: "own" });
    expect(of(ownedUtxos[1]!).history).toEqual({ id: `received:${ownedUtxos[1]!.tx_hash}`, origin: "received" });
    // A Seedelf's own UTxO is never spent by a payment, and the public side has no such history.
    expect(of(ownedUtxos[2]!)).not.toHaveProperty("history");
    expect(cardano.some((u) => u.history)).toBe(false);
  });

  it("aren't offered for a UTxO no payment can take: one holding a reference script Koios doesn't give (launch review #12)", async () => {
    const t = await unlocked(12);
    const template = koiosPreprod.accounts[phrase(12).preprod.stake]!.account_utxos[0]!;
    const script = { hash: "cd".repeat(28), size: 900, type: "plutusV3", bytes: null };
    const measured = { hash: "ab".repeat(28), size: 3, type: "timelock", bytes: "820080" };
    t.koios.addedToAccounts.push(
      { ...template, tx_hash: "d1".repeat(32), tx_index: 0, value: "3000000", asset_list: [], reference_script: script },
      { ...template, tx_hash: "d2".repeat(32), tx_index: 0, value: "3000000", asset_list: [], reference_script: measured },
    );
    await t.balances.get("preprod");
    const { cardano } = await t.coins.lists("preprod");
    expect(cardano.filter((u) => u.unspendable).map(at)).toEqual([`${"d1".repeat(32)}#0`]);
    // One whose script the wallet can measure is spent, and priced, as any other.
    expect(cardano.find((u) => u.txHash === "d2".repeat(32))).not.toHaveProperty("unspendable");
    // Max says what it left out, and why (launch review H6, #12).
    const max = await t.send.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(max.leftOut).toEqual([{ txHash: "d1".repeat(32), txIndex: 0, reason: "script" }]);
    const moveIn = await t.moveIn.build("preprod", null, []);
    expect(moveIn.leftOut).toEqual([{ txHash: "d1".repeat(32), txIndex: 0, reason: "script" }]);
  });

  it("refuse the collateral and UTxOs not in the last reading", async () => {
    const t = await unlocked(24);
    await t.balances.get("preprod");
    const { fives } = account24();
    await expect(t.coins.setLocked("preprod", "cardano", at(fives[0]!), true)).rejects.toThrow("Reclaim it in Settings");
    await expect(t.coins.setLocked("preprod", "cardano", `${"00".repeat(32)}#0`, true)).rejects.toThrow("last reading");
  });

  it("hold when a reading leaves their UTxO out and another lock changes: a backend behind, say", async () => {
    const t = await unlocked(24);
    await t.balances.get("preprod");
    const { fives } = account24();
    await t.coins.setLocked("preprod", "cardano", at(fives[1]!), true);
    // A lagging backend's reading doesn't list it; the user then locks and unlocks another.
    t.koios.spent.add(at(fives[1]!));
    await t.balances.get("preprod", true);
    await t.coins.setLocked("preprod", "cardano", at(fives[2]!), true);
    await t.coins.setLocked("preprod", "cardano", at(fives[2]!), false);
    expect((await t.coins.choices("preprod")).cardano).toEqual([at(fives[1]!)]);

    // Listed again, it's still locked, and Max leaves it out.
    t.koios.spent.delete(at(fives[1]!));
    await t.balances.get("preprod", true);
    expect((await t.coins.lists("preprod")).cardano.find((u) => at(u) === at(fives[1]!))).toMatchObject({ locked: true });
    await t.send.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    const built = await t.session.get<{ txCbor: string }>("seedelf.send.built");
    expect(bodyOutpoints(hexBytes(built!.txCbor), 0)).not.toContain(at(fives[1]!));
  });

  it("hold on the private side too, when a full read of the contract leaves their UTxO out", async () => {
    const t = await unlocked(12);
    await t.balances.get("preprod");
    const [p, q] = (await t.coins.lists("preprod")).seedelf.filter((u) => !u.seedelf);
    await t.coins.setLocked("preprod", "seedelf", at(p!), true);
    t.koios.spent.add(at(p!));
    await forgetContractView(t.deps, "preprod");
    await t.balances.get("preprod", true);
    await t.coins.setLocked("preprod", "seedelf", at(q!), true);
    expect((await t.coins.choices("preprod")).seedelf.sort()).toEqual([at(p!), at(q!)].sort());
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

// The UTxOs screen during a pending spend: what the wallet has spent since the reading is off both lists, as the
// balances count it, so the line saying what's on its way back adds up with them (pass two of the blind test's fix
// round, its cross-area review: the private list kept a spent input the kept contract view still held).
describe("the lists while a spend is on its way", () => {
  it("leave out what the wallet has spent since the reading, on the private side as on the public", async () => {
    const t = await unlocked(12);
    const before = await t.balances.get("preprod");
    const listed = await t.coins.lists("preprod");
    const spentPrivate = ownedUtxos.find((u) => !u.asset_list?.some((a) => a.asset_name.startsWith("5eed0e1f")))!;
    const spentPublic = listed.cardano[0]!;
    // As rememberSpent writes it when a transaction is submitted.
    await t.session.set(SESSION_SPENT, { [at(spentPrivate)]: t.clock.now, [at(spentPublic)]: t.clock.now });

    const after = await t.balances.get("preprod");
    const { seedelf, cardano } = await t.coins.lists("preprod");
    expect(seedelf.some((u) => at(u) === at(spentPrivate))).toBe(false);
    expect(cardano.some((u) => at(u) === at(spentPublic))).toBe(false);
    expect(seedelf).toHaveLength(listed.seedelf.length - 1);
    // What the list holds besides a Seedelf's own UTxO is what the balance counts, the spent input left out of both.
    expect(after.seedelf.utxos).toBe(before.seedelf.utxos - 1);
    const counted = seedelf.filter((u) => !u.seedelf).reduce((sum, u) => sum + BigInt(u.lovelace), 0n);
    expect(counted).toBe(BigInt(after.seedelf.lovelace));
  });
});

// Chunk 51, e8b#1: a stranger's 5 ₳ of ADA alone at the public account's 0/0 that carries a reference script, or an
// inline datum nested past core's cbor::MAX_DEPTH (128), or a datum by hash, was the collateral-shaped UTxO the wallet
// took by itself: with no collateral chosen, collateralOf took it as the oldest pure 5 ₳, and after a reclaim it was
// the Collateral page's candidate, the only UTxO its Set offers. Every Lovejoin build from the public account then
// failed: WebAssembly's Coin::from_row puts the collateral through eval::resolve_row, which refuses those shapes. The
// wallet's own pick and the page's candidate now take only what a session's chain would put up (`collateralFits`).
describe("a stranger's 5 ₳ the wallet can't put up (chunk 51, e8b#1)", CHAINS, () => {
  const STRANGER = "d7".repeat(32);
  const OWN_FIVE = `${"e5".repeat(32)}#0`; // publicFunded's own 5 ₳

  /** What a stranger can put on an output of 5 ₳ alone: a reference script (one the wallet can measure), or a deep datum. */
  const SHAPES: Array<[string, Partial<KoiosUtxo>]> = [
    ["a reference script", { reference_script: { hash: "ab".repeat(28), size: 3, type: "timelock", bytes: "820080" } }],
    ["an inline datum 200 levels deep", { inline_datum: { bytes: `${"81".repeat(200)}00`, value: null } }],
  ];

  /** The stranger's 5 ₳ at the 12-word account's 0/0, a block older than publicFunded's own 5 ₳. */
  async function strangers(t: Tested, shape: Partial<KoiosUtxo>): Promise<void> {
    const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
    const keyHash = await t.wallet.withKeys((keys) => keys.cardano.paymentKeyHash(0, 0));
    t.koios.addedToAccounts.push({
      ...first!,
      tx_hash: STRANGER,
      tx_index: 0,
      address: account(12).preprod.receive_0,
      value: "5000000",
      payment_cred: keyHash,
      asset_list: [],
      block_height: first!.block_height! - 1,
      ...shape,
    });
  }

  /** A wallet with no 5 ₳ of its own, the stranger's read. */
  async function strangersOnly(shape: Partial<KoiosUtxo>): Promise<Tested> {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    await strangers(t, shape);
    await t.balances.get("preprod");
    // It was read: the account's list holds it.
    expect((await t.coins.lists("preprod")).cardano.some((u) => u.txHash === STRANGER)).toBe(true);
    return t;
  }

  it.each([...SHAPES, ["a datum by hash", { datum_hash: "ab".repeat(32) }] as [string, Partial<KoiosUtxo>]])(
    "with %s is neither the account's collateral nor the Collateral page's candidate",
    async (_, shape) => {
      const t = await strangersOnly(shape);
      // The wallet takes none by itself: there's no 5 ₳ a public mix could put up, so Set pays 5 ₳ to 0/0.
      expect(await t.coins.collateral("preprod")).toEqual({ state: "none", reclaimed: false });
      // Nor is it offered after a reclaim, where Set takes the candidate (Collateral.tsx).
      expect(await t.coins.reclaim("preprod")).toEqual({ state: "none", reclaimed: true });
    },
  );

  // Chunk 51, t1j#5: a 5 ₳ UTxO that holds a token too is no collateral: the ledger takes a collateral of ADA alone
  // unless the transaction returns the rest, which a site's doesn't, so neither the wallet's pick, the page's candidate
  // nor a choice may be one.
  const TOKENED: Partial<KoiosUtxo> = {
    asset_list: [{ policy_id: "aa".repeat(28), asset_name: "6a756e6b", quantity: "1", decimals: 0, fingerprint: "" }],
  };

  it("holding a token too, is never the collateral, nor offered, nor taken as a choice", async () => {
    const t = await strangersOnly(TOKENED);
    expect(await t.coins.collateral("preprod")).toEqual({ state: "none", reclaimed: false });
    await expect(t.coins.use("preprod", `${STRANGER}#0`)).rejects.toThrow(tr("worker.coins.exactlyFive"));
  });

  it("holding a token too, and older, leaves the account's own pure 5 ₳ the collateral", async () => {
    const t = await publicFunded();
    await strangers(t, TOKENED);
    await t.balances.get("preprod", true);
    expect(await t.coins.collateral("preprod")).toMatchObject({ state: "set", by: "wallet", utxo: { txHash: OWN_FIVE.slice(0, 64), index: 0 } });
  });

  it("chosen by the user, is what a site gets all the same: the ledger takes it", async () => {
    const t = await strangersOnly(SHAPES[0]![1]);
    await t.coins.use("preprod", `${STRANGER}#0`);
    expect((await t.coins.choices("preprod")).collateral).toBe(`${STRANGER}#0`);
    const rows = (await readAccountUtxos(t.deps, "preprod", new Set())).utxos;
    const site = await t.coins.account("preprod", rows, 0);
    expect(site.collateral && at(site.collateral.utxo)).toBe(`${STRANGER}#0`);
    // The wallet's own builds can't put it up, so for them it's no choice, and for the page, which says what they keep
    // aside: none is set, and Set pays a new 5 ₳, as a public mix's refusal says (chunk 51, money#4).
    expect(await t.coins.collateral("preprod")).toEqual({ state: "none", reclaimed: false });
  });

  it.each(SHAPES)("with %s leaves a public mix the account's own 5 ₳ to put up", async (_, shape) => {
    const t = await publicFunded();
    await strangers(t, shape);
    const mix = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    expect(mix.mixes).toBeGreaterThan(0);
    const kept = await t.wallet.withKeys(() =>
      t.session.get<{ chain: Array<{ kind: string; txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC),
    );
    for (const tx of kept!.chain.filter((x) => x.kind === "mix")) {
      expect(bodyOutpoints(hexBytes(tx.txCbor), 13)).toEqual([OWN_FIVE]);
    }
  });

  // Chunk 51, e8b#1's residue: 1.9.1's Set took the page's candidate, which could be such a 5 ₳, and saved it as the
  // user's choice. The fix stops the page offering one, but a choice saved before stays the account's collateral, and
  // every public Lovejoin build kept failing on it. For the wallet's own builds (readAccount), a choice that doesn't fit
  // counts as none: they put up the oldest that does, and spend the choice as any other UTxO, so one 5 ₳ is held, not
  // two (chunk 51, money#4, still#6). A site still gets what the user chose: the ledger takes it.
  it.each(SHAPES)("with %s, chosen before 1.9.2, leaves a public mix the account's own 5 ₳ and a site the choice", async (_, shape) => {
    const t = await publicFunded();
    await strangers(t, shape);
    await t.balances.get("preprod", true);
    // As 1.9.1's Set saved it: use() takes any 5 ₳ of ADA alone, as the ledger does.
    await t.coins.use("preprod", `${STRANGER}#0`);
    expect((await t.coins.choices("preprod")).collateral).toBe(`${STRANGER}#0`);

    // The wallet's own builds: the account's own 5 ₳, never a payment's input, as the page says of the collateral. The
    // choice is no choice for them, so a payment may spend it.
    const own = await readAccount(t.deps, "preprod");
    expect(own.collateral && `${own.collateral.utxo.tx_hash}#${own.collateral.utxo.tx_index}`).toBe(OWN_FIVE);
    const inputs = own.utxos.map((p) => `${p.utxo.tx_hash}#${p.utxo.tx_index}`);
    expect(inputs).not.toContain(OWN_FIVE);
    expect(inputs).toContain(`${STRANGER}#0`);
    const mix = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    expect(mix.mixes).toBeGreaterThan(0);
    const kept = await t.wallet.withKeys(() =>
      t.session.get<{ chain: Array<{ kind: string; txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC),
    );
    for (const tx of kept!.chain.filter((x) => x.kind === "mix")) {
      expect(bodyOutpoints(hexBytes(tx.txCbor), 13)).toEqual([OWN_FIVE]);
    }

    // A site's: the user's choice, as it was.
    const rows = (await readAccountUtxos(t.deps, "preprod", new Set())).utxos;
    const site = await t.coins.account("preprod", rows, 0);
    expect(site.collateral && `${site.collateral.utxo.tx_hash}#${site.collateral.utxo.tx_index}`).toBe(`${STRANGER}#0`);
    // The Collateral page says what the wallet keeps aside, which payments leave alone: the 5 ₳ its builds put up, as
    // the wallet set it (chunk 51, money#4, still#6).
    expect(await t.coins.collateral("preprod")).toMatchObject({ state: "set", by: "wallet", utxo: { txHash: OWN_FIVE.slice(0, 64), index: 0 } });
  });

  // Chunk 51, money#4 and still#6: with such a choice, Home's locked figure and the forms' "Max, up to" counted the
  // choice as the one 5 ₳ held and the 5 ₳ the builds put up as free, while the builds held both: Max paid 5 ₳ less
  // than the form said, and an amount between the two passed the form to be refused. They count what the builds keep.
  it.each(SHAPES)("with %s, chosen before 1.9.2, has Home and the forms count what the wallet's own builds spend", async (_, shape) => {
    const t = await publicFunded();
    await strangers(t, shape);
    await t.balances.get("preprod", true);
    await t.coins.use("preprod", `${STRANGER}#0`);
    const b = await t.balances.get("preprod");
    // What the public forms may spend, as Home.tsx works it out: CardanoSend's and MoveIn's "Max, up to".
    const prefs = await t.deps.preferences.get();
    const forms = BigInt(withRewards(unlockedSide(b.cardano), spentRewards(b.cardano.staking, prefs.spendRewards)).lovelace);
    // What the wallet's own builds may spend (readAccount), with the rewards they withdraw.
    const own = await readAccount(t.deps, "preprod");
    const builds = own.utxos.reduce((sum, p) => sum + BigInt(p.utxo.value), BigInt(own.withdrawal ?? "0"));
    expect.soft(forms, "the forms' figure").toBe(builds);
    // One 5 ₳ held: the one the builds put up, the collateral, which the Mix form leaves out of its count too.
    expect.soft(b.cardano.locked).toMatchObject({ lovelace: "5000000", utxos: 1 });
    const listed = (await t.coins.lists("preprod")).cardano;
    expect.soft(listed.filter((u) => u.locked).map(at), "held").toEqual([OWN_FIVE]);
    expect.soft(listed.filter((u) => u.collateral).map(at), "the collateral").toEqual([OWN_FIVE]);
    // Max spends every UTxO the builds may: what it pays, its fee and its change are that figure.
    const max = await t.send.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(max.inputs).toBe(own.utxos.length);
    expect(BigInt(max.payments[0]!.lovelace) + BigInt(max.fee) + BigInt(max.changeLovelace)).toBe(builds);
    // An amount 4 ₳ under the forms' figure goes, on Send and on Make private alike.
    const asked = (forms - 4_000_000n).toString();
    expect((await t.send.build("preprod", [{ to: THEIRS, lovelace: asked, tokens: [] }])).payments[0]!.lovelace).toBe(asked);
    expect((await t.moveIn.build("preprod", asked, [])).lovelace).toBe(asked);
  });

  it("chosen before 1.9.2, with no 5 ₳ that fits beside it, has a public mix say it needs the account's collateral", async () => {
    // publicFunded's 60 ₳ of ADA alone and none of its own 5 ₳, the stranger's, and the 5 ₳ pool.
    const t = testBalances({ pools: [ADA_POOL] });
    await t.wallet.create(account(12).phrase, PASSWORD);
    t.koios.evaluation = AGREES;
    t.koios.addedToAccounts.push(...ADA_ROWS);
    const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
    const keyHash = await t.wallet.withKeys((keys) => keys.cardano.paymentKeyHash(0, 0));
    t.koios.addedToAccounts.push({ ...first!, tx_hash: "e6".repeat(32), tx_index: 0, value: "60000000", payment_cred: keyHash, asset_list: [] });
    await strangers(t, SHAPES[0]![1]);
    await t.balances.get("preprod", true);
    await t.coins.use("preprod", `${STRANGER}#0`);
    // Named as the collateral it can't put up, never as a UTxO WebAssembly can't evaluate.
    await expect(t.lovejoin.publicBuild("preprod", 1, { pool: ADA })).rejects.toThrow(tr("lj.needCollateral"));
    // The Collateral page, where that refusal sends the user, says so too: none set, so Set pays a new 5 ₳. It said
    // the choice was set, which no build of the wallet's puts up. Nothing is held (chunk 51, money#4).
    expect(await t.coins.collateral("preprod")).toEqual({ state: "none", reclaimed: false });
    expect((await t.balances.get("preprod")).cardano.locked.utxos).toBe(0);
  });
});
