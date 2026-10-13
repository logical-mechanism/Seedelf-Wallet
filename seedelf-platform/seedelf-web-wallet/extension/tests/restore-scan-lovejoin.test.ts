// A session the restore scan found (O5, chunk 27) comes back through
// Lovejoin as Settings has it, on by default, as any session brought back by
// hand does: its chain built on its funding's 5 ₳ (a #304 top-up's once that's
// gone), sent and pumped by the runs, and the session closed once it lands;
// Bring everything back across found sessions draws no pool box twice. And what
// another browser's chain left at a found account goes in again, in a chain of
// its own, though that browser would have sent it back directly: the found
// record holds none of the chain's deposits or mixes (1.5.0's release review,
// C51, C52). Session 0 of the 12-word phrase, the real WebAssembly, the recorded
// preprod pool, and fakes of Koios.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bodyOutpoints, txInputs } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { builtOutputs } from "../src/background/minswap";
import { SESSION_CLAIM } from "../src/background/sessions";
import { WalletLocked } from "../src/background/wallet";
import { isClaimable } from "../src/ui/screens/ClaimAll";
import { chainGoing } from "../src/ui/screens/Swaps";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, sessionSwap } from "./fakes";
import { atSession, PASSWORD, signing, unlocked, type T } from "./swap-session";

const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;
const POOL_REFS = new Set(POOL.map((u) => `${u.tx_hash}#${u.tx_index}`));
/** Ogmios agrees with every evaluation: the mixes' scripts run as their budgets say. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
const FUNDING_TX = sessionSwap.utxo.tx_hash;
/** Building a chain runs the scripts of every mix in it. */
const CHAINS = { timeout: 300_000 };

/** One-time account `index`: its stake address, address and payment key hash. */
function account(t: T, index: number) {
  const net = loadTestWasm().Network.Preprod;
  return t.wallet.withKeys((keys) => ({
    reward: keys.oneTime.rewardAddress(net, index),
    address: keys.oneTime.address(net, index),
    keyHash: keys.oneTime.keyHash(index),
  }));
}

/** Account `index` was used: its stake key shows, with these transactions, newest first. */
async function usedWith(t: T, index: number, txs: Array<[string, number]>) {
  const { reward } = await account(t, index);
  t.koios.usedStakes.add(reward);
  t.koios.accountTxs.set(
    reward,
    txs.map(([tx_hash, block_height]) => ({ tx_hash, block_height, block_time: 1_700_000_000 + block_height })),
  );
}

/** The service with Lovejoin wired in, as the worker wires it; Ogmios agreeing, and the pool listed. */
async function throughLovejoin() {
  const t = await unlocked();
  t.koios.evaluation = AGREES;
  const sessions = signing(t, { lovejoin: t.lovejoin, sleep: async () => undefined });
  return { t, sessions };
}

/** Found session 0, its funding alone listed, holding `rows`. */
async function found(rows: KoiosUtxo[]) {
  const { t, sessions } = await throughLovejoin();
  await usedWith(t, 0, [[FUNDING_TX, 5_000_000]]);
  t.koios.addedToAccounts.push(...rows, ...POOL);
  expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
  return { t, sessions };
}

describe("a found session's return through Lovejoin", () => {
  it("builds the chain on its funding's 5 ₳, sends it all, and the session closes once it lands", CHAINS, async () => {
    // A stranger's plain 5 ₳ listed first, the funding's own after it.
    const { t, sessions } = await found([
      atSession("c2".repeat(32), 1, "5000000"),
      atSession(FUNDING_TX, 1, "40000000"),
      atSession(FUNDING_TX, 2, "5000000"),
    ]);
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBeUndefined();
    expect(review.lovejoin!.boxes).toBeGreaterThan(0);
    const before = t.koios.submitted.length;
    await sessions.backSubmit("preprod", review.txHash);
    // The first mix, after the deposit, puts up the funding's collateral (the body's key 13).
    expect(bodyOutpoints(t.koios.submitted[before + 1]!, 13)).toEqual([`${FUNDING_TX}#2`]);
    // The runs send the rest, the return last.
    t.koios.confirmations = 1;
    for (let i = 0; i < 6 && (await sessions.runAll("preprod")); i++);
    expect(t.koios.submitted.length - before).toBe(review.lovejoin!.txs);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(review.txHash);
    // Koios shows what the chain spent at the account spent: the session is over, its record kept.
    for (const tx of t.koios.submitted) for (const o of txInputs(tx)) t.koios.spent.add(o);
    t.clock.now += 60_000;
    expect((await sessions.list("preprod", true))[0]).toMatchObject({ index: 0, stage: "closed", recovered: true });
  });

  it("puts up a #304 top-up's 5 ₳ once the funding's is gone", CHAINS, async () => {
    const top = "d4".repeat(32);
    const { t, sessions } = await found([atSession(FUNDING_TX, 1, "40000000"), atSession(top, 0, "5000000")]);
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin!.boxes).toBeGreaterThan(0);
    const before = t.koios.submitted.length;
    await sessions.backSubmit("preprod", review.txHash);
    expect(bodyOutpoints(t.koios.submitted[before + 1]!, 13)).toEqual([`${top}#0`]);
  });

  it("offers no 5 ₳ for Lovejoin once a chain of it went in partly: the rest comes back directly (cross-area review X15)", CHAINS, async () => {
    const { t, sessions } = await found([atSession(FUNDING_TX, 1, "40000000"), atSession(FUNDING_TX, 2, "5000000")]);
    const review = await sessions.backBuild("preprod", 0);
    const before = t.koios.submitted.length;
    await sessions.backSubmit("preprod", review.txHash);
    // Its first block's worth lands: what it spent at the account spent, its latest change there, the funding's 5 ₳
    // too, which the mixes put up and none spends.
    const sent = t.koios.submitted.slice(before);
    expect(sent.length).toBeLessThan(review.lovejoin!.txs);
    for (const tx of sent) for (const o of txInputs(tx)) t.koios.spent.add(o);
    const change: string[] = [];
    for (const tx of sent) {
      const id = txIdOf(tx);
      builtOutputs(tx).forEach((o, i) => {
        if (o.address.slice(2, 58) !== sessionSwap.keyHash || t.koios.spent.has(`${id}#${i}`)) return;
        t.koios.addedToAccounts.push(atSession(id, i, o.lovelace.toString()));
        change.push(`${id}#${i}`);
      });
    }
    t.koios.confirmations = 1;
    // The wallet locks partway: nothing sends the rest.
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    await expect(sessions.backCollateralBuild("preprod", 0)).rejects.toThrow("The account already holds a UTxO of exactly 5 ₳");
    // The same phrase's other browser brought back everything there, the 5 ₳ too; then 40 ₳ came in, a refund say. Its
    // spare ADA would pay for a box, but the rest of a chain that went in comes back directly: no 5 ₳ buys anything.
    t.koios.spent.add(`${FUNDING_TX}#2`);
    for (const o of change) t.koios.spent.add(o);
    t.koios.addedToAccounts.push(atSession("e7".repeat(32), 0, "40000000"));
    expect((await sessions.list("preprod", true))[0]!.backCollateral).toBeUndefined();
    await expect(sessions.backCollateralBuild("preprod", 0)).rejects.toThrow("Its return needs no 5 ₳");
    const rest = await sessions.backBuild("preprod", 0);
    expect(rest.lovejoin).toBeUndefined();
    expect(rest.lovejoinSkipped).toBeUndefined();
  });

  it("draws no pool box twice when Bring everything back takes several", CHAINS, async () => {
    const { t, sessions } = await throughLovejoin();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    for (const i of [0, 1, 2]) {
      const a = await account(t, i);
      const funding = `f${i}`.repeat(32);
      await usedWith(t, i, [[funding, 5_000_000 + i]]);
      const at = (n: number, value: string): KoiosUtxo => ({
        ...atSession(funding, n, value),
        address: a.address,
        payment_cred: a.keyHash,
      });
      t.koios.addedToAccounts.push(at(1, "40000000"), at(2, "5000000"));
    }
    t.koios.addedToAccounts.push(...POOL);
    expect(await sessions.scan("preprod")).toEqual({ used: 3, found: [0, 1, 2] });
    const { returns, skipped } = await sessions.claimBuild("preprod", [0, 1, 2]);
    expect(skipped).toEqual([]);
    expect(returns.every((r) => (r.lovejoin?.boxes ?? 0) > 0)).toBe(true);
    const kept = (await t.session.get<Array<{ chain?: Array<{ txCbor: string }> }>>(SESSION_CLAIM))!;
    const drawn = kept.flatMap((k) => [
      ...new Set((k.chain ?? []).flatMap((x) => txInputs(Buffer.from(x.txCbor, "hex")).filter((o) => POOL_REFS.has(o)))),
    ]);
    expect(drawn.length).toBeGreaterThan(0);
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});

describe("a found session's return chain a lock cut off before any of it went (cross-area review X03)", () => {
  /**
   * Found session 0 holding 40 ₳ and its 5 ₳, its return built through Lovejoin and sent, and the wallet locking
   * between the chain's record and its first send: as Lovejoin reserves for it (before its progress is saved), or as
   * the runs' alarm starts (after). Nothing of it goes, and the lock keeps the record from saying so. `earlier`: the
   * session's record holds a chain that finished before, a site's session paid again, say.
   */
  async function stranded(at: "reserve" | "alarm", earlier = false) {
    const t = await unlocked();
    t.koios.evaluation = AGREES;
    let armed = false;
    const lock = async () => {
      if (!armed) return;
      armed = false;
      await t.wallet.lock();
    };
    const lovejoin = Object.create(t.lovejoin) as typeof t.lovejoin;
    lovejoin.reserve = async (...args) => {
      if (at === "reserve") await lock();
      return t.lovejoin.reserve(...args);
    };
    const sessions = signing(t, {
      lovejoin,
      sleep: async () => undefined,
      alarm: { start: () => (at === "alarm" ? lock() : Promise.resolve()) },
    });
    await usedWith(t, 0, [[FUNDING_TX, 5_000_000]]);
    t.koios.addedToAccounts.push(atSession(FUNDING_TX, 1, "40000000"), atSession(FUNDING_TX, 2, "5000000"), ...POOL);
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    if (earlier) {
      const book = (await t.store.get<{ next: number; sessions: Array<Record<string, any>> }>("sessions.preprod"))!;
      const when = t.clock.now - 24 * 60 * 60_000;
      const [deposit, mix, back] = ["a1", "a2", "a3"].map((x) => x.repeat(32));
      const record = book.sessions[0]!;
      record.txs.push(
        { kind: "deposit", txHash: deposit, at: when, confirmed: true },
        { kind: "mix", txHash: mix, at: when, confirmed: true },
        { kind: "back", txHash: back, at: when, confirmed: true },
      );
      record.chain = { total: 3, last: back, at: when };
      await t.store.set("sessions.preprod", book);
    }
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin!.boxes).toBeGreaterThan(0);
    const before = t.koios.submitted.length;
    armed = true;
    await expect(sessions.backSubmit("preprod", review.txHash)).rejects.toThrow(WalletLocked);
    expect(t.koios.submitted.length).toBe(before);
    await t.wallet.unlock(PASSWORD);
    return { t, sessions, review };
  }

  it("says the chain stopped, and offers its return again, once the unlock's run reads it", CHAINS, async () => {
    const { sessions, review } = await stranded("alarm");
    await sessions.runAll("preprod", true);
    const [view] = await sessions.list("preprod");
    expect(view).toMatchObject({
      index: 0,
      stage: "open",
      chain: { total: review.lovejoin!.txs, sent: 0, stopped: "The wallet locked, or the browser closed, while its chain was being sent." },
    });
    // Its page offers Bring it back again, and so does Bring everything back: never "Coming back" for good.
    expect(chainGoing(view!)).toBe(false);
    expect(isClaimable(view!)).toBe(true);
    // None of it went in, so its next return goes through Lovejoin as this one would have.
    expect((await sessions.backBuild("preprod", 0)).lovejoin!.boxes).toBeGreaterThan(0);
  });

  it("says so too at a refresh, the lock having come before the chain's progress was saved", CHAINS, async () => {
    const { sessions } = await stranded("reserve");
    const [view] = await sessions.list("preprod", true);
    expect(view!.chain).toMatchObject({ sent: 0, stopped: "The wallet locked, or the browser closed, while its chain was being sent." });
    expect(chainGoing(view!)).toBe(false);
    expect(isClaimable(view!)).toBe(true);
  });

  it("keeps the chain on record, so a session whose earlier chain finished still comes back through Lovejoin", CHAINS, async () => {
    const { sessions } = await stranded("alarm", true);
    await sessions.runAll("preprod", true);
    expect(isClaimable((await sessions.list("preprod", true))[0]!)).toBe(true);
    // Only the latest chain counts (independent review L17): its record gone, the earlier chain's deposit and mix
    // would read as one that went in partly, and everything would come back directly, with nothing said.
    const again = await sessions.backBuild("preprod", 0);
    expect(again.lovejoinSkipped).toBeUndefined();
    expect(again.lovejoin).toBeDefined();
    expect(again.lovejoin!.boxes).toBeGreaterThan(0);
  });
});

describe("what another browser's chain left at a found session's account", () => {
  const DEPOSIT = "d2".repeat(32);
  const MIX1 = "e2".repeat(32);

  it("goes through Lovejoin again, in a chain of its own, and its switch brings it back directly", CHAINS, async () => {
    const { t, sessions } = await throughLovejoin();
    const at = { bech32: sessionSwap.address, cred: sessionSwap.keyHash };
    const box = { bech32: POOL[0]!.address, cred: POOL[0]!.payment_cred! };
    // The other browser's chain: its deposit spent the funding's #1 and paid two boxes and change; one mix spent the
    // change and a box, paying boxes and change again. Then it stopped (a lock, a closed browser), and that browser
    // never came back to it. What it left is at the account: the last change, 25 ₳, and the funding's 5 ₳.
    await usedWith(t, 0, [
      [MIX1, 5_000_200],
      [DEPOSIT, 5_000_100],
      [FUNDING_TX, 5_000_000],
    ]);
    t.koios.txSpends.set(DEPOSIT, [{ payment_addr: at, tx_hash: FUNDING_TX, tx_index: 1 }]);
    t.koios.txOutputs.set(DEPOSIT, [
      { payment_addr: box, tx_index: 0 },
      { payment_addr: box, tx_index: 1 },
      { payment_addr: at, tx_index: 2 },
    ]);
    t.koios.txSpends.set(MIX1, [
      { payment_addr: at, tx_hash: DEPOSIT, tx_index: 2 },
      { payment_addr: box, tx_hash: DEPOSIT, tx_index: 0 },
    ]);
    t.koios.txOutputs.set(MIX1, [
      { payment_addr: box, tx_index: 0 },
      { payment_addr: box, tx_index: 1 },
      { payment_addr: at, tx_index: 2 },
    ]);
    t.koios.addedToAccounts.push(atSession(MIX1, 2, "25000000"), atSession(FUNDING_TX, 2, "5000000"), ...POOL);
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    // Its record holds the funding alone: the chain's deposit and mix are only among what its key signed.
    const record = (await t.store.get<{ sessions: Array<Record<string, any>> }>("sessions.preprod"))!.sessions[0]!;
    expect(record.txs.map((x: { kind: string }) => x.kind)).toEqual(["out"]);
    expect(record.chain).toBeUndefined();
    expect(record.recovered.own).toEqual([MIX1, DEPOSIT]);

    // So it goes in again, as Settings has it, in a deposit chain of its own: the browser that ran it would have sent
    // it back directly.
    const through = await sessions.backBuild("preprod", 0);
    expect(through.lovejoin).toMatchObject({ boxes: 1 });
    expect(through.lovejoinSkipped).toBeUndefined();
    // Its review's switch brings it all back directly.
    const direct = await sessions.backBuild("preprod", 0, true);
    expect(direct.lovejoin).toBeUndefined();
    expect(direct.lovelace).toBe("29827855");
  });
});
