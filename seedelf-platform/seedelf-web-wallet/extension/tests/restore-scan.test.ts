// The restore scan (O5, chunk 27): after a restore, or with the same phrase in
// another browser, the device has no record of its private sessions, so what
// their one-time accounts hold doesn't show. The scan walks the one-time stake
// keys 20 at a time, reads what the used ones the device doesn't know hold and
// the orders their swaps placed, and adds each that holds something, or has an
// order open, as a session found, brought back by hand. Session 0 of the
// 12-word phrase, the real WebAssembly, and fakes of Koios.
import { describe, expect, it } from "vitest";

import { bech32 } from "./fixtures/bech32";
import { bytes, ORDER_ADDRESS, ORDER_SCRIPT } from "./fixtures/swap-tx";
import { loadTestWasm, sessionSwap } from "./fakes";
import { atSession, orderRow, signing, SWAP_TX, unlocked, type T } from "./swap-session";

const FUNDING_TX = sessionSwap.utxo.tx_hash;
const ORDER_AT = bech32("addr_test", bytes(ORDER_ADDRESS));

/** One-time account `index`'s stake address, as Koios is asked about it. */
function reward(t: T, index: number) {
  const net = loadTestWasm().Network.Preprod;
  return t.wallet.withKeys((keys) => keys.oneTime.rewardAddress(net, index));
}

/** The sealed record of preprod's sessions, as the tests read it. */
async function bookOf(t: T) {
  return t.store.get<{ next: number; sessions: Array<Record<string, any>> }>("sessions.preprod");
}

/** Account `index` was used on chain: its stake key shows, and these are its transactions, newest first. */
async function usedWith(t: T, index: number, txs: Array<[string, number]>) {
  const stake = await reward(t, index);
  t.koios.usedStakes.add(stake);
  t.koios.accountTxs.set(
    stake,
    txs.map(([tx_hash, block_height]) => ({ tx_hash, block_height, block_time: 1_700_000_000 + block_height })),
  );
}

/** Session 0's swap: it spent the funding at the account, and placed the recorded order (#0), its change back (#1). */
function swapped(t: T) {
  t.koios.txSpends.set(SWAP_TX, [
    {
      payment_addr: { bech32: sessionSwap.address, cred: sessionSwap.keyHash },
      tx_hash: FUNDING_TX,
      tx_index: sessionSwap.utxo.tx_index,
    },
  ]);
  t.koios.txOutputs.set(SWAP_TX, [
    { payment_addr: { bech32: ORDER_AT, cred: ORDER_SCRIPT }, tx_index: 0 },
    { payment_addr: { bech32: sessionSwap.address, cred: sessionSwap.keyHash }, tx_index: 1 },
  ]);
}

const asked = (t: T) => t.koios.calls.map((c) => c.path);

describe("the restore scan", () => {
  it("asks about 20 one-time accounts once, and writes nothing, when the phrase never used one", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    t.koios.calls.length = 0;
    expect(await sessions.scan("preprod")).toEqual({ used: 0, found: [] });
    expect(asked(t)).toEqual(["account_addresses"]);
    expect(t.koios.calls[0]!.body._stake_addresses).toHaveLength(20);
    expect(t.koios.calls[0]!.body._stake_addresses[0]).toBe(await reward(t, 0));
    expect(await bookOf(t)).toBeUndefined();
  });

  it("finds an account that holds money, as a session brought back by hand", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await usedWith(t, 0, [[FUNDING_TX, 5_000_000]]);
    t.koios.addedToAccounts.push(atSession(FUNDING_TX, 1, "20000000"), atSession(FUNDING_TX, 2, "5000000"));
    t.koios.calls.length = 0;

    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    // A run of 20 with one used, then a run with none; what it holds; its transactions, and what they spent and paid.
    expect(asked(t)).toEqual(["account_addresses", "account_addresses", "credential_utxos", "account_txs", "tx_info"]);
    expect(t.koios.calls[3]!.body).toEqual({ _stake_address: await reward(t, 0), _after_block_height: 0 });
    const book = (await bookOf(t))!;
    expect(book.next).toBe(1);
    expect(book.sessions).toEqual([
      {
        index: 0,
        ownStake: true,
        createdAt: (1_700_000_000 + 5_000_000) * 1000,
        txs: [{ kind: "out", txHash: FUNDING_TX, at: (1_700_000_000 + 5_000_000) * 1000, confirmed: true }],
        recovered: { at: t.clock.now, own: [] },
      },
    ]);

    // Listed with what it holds, before any refresh, and found: no swap, site or mix, its next step the user's.
    const [view] = await sessions.list("preprod");
    expect(view).toMatchObject({ index: 0, stage: "open", recovered: true, holding: { lovelace: "25000000", utxos: 2 } });
    expect(view!.swap).toBeUndefined();
    expect(view!.auto).toBeUndefined();

    // It comes back as any session's money does, its key signing for it.
    const back = await sessions.backBuild("preprod", 0, true);
    expect(back.inputs).toBe(2);
    expect(back.lovelace).not.toBe("0");
    // Bring everything back takes it too.
    const claim = await sessions.claimBuild("preprod", [0], true);
    expect(claim.skipped).toEqual([]);
    expect(claim.returns.map((r) => r.index)).toEqual([0]);
    // Removing the wallet names it as found.
    expect(await sessions.atStake("preprod")).toEqual([{ index: 0, kind: "found" }]);
  });

  it("finds an order still open through the swap that placed it, with nothing left at the account", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await usedWith(t, 0, [
      [SWAP_TX, 5_000_100],
      [FUNDING_TX, 5_000_000],
    ]);
    swapped(t);
    // The order waits at Minswap V1's script, its datum by hash; the swap's change was brought back long ago.
    t.koios.addedToAccounts.push(orderRow(SWAP_TX));
    t.koios.calls.length = 0;

    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    expect(asked(t)).toEqual([
      "account_addresses",
      "account_addresses",
      "credential_utxos",
      "account_txs",
      "tx_info",
      // The order output its key's swap paid, and its datum; then whether it's still open.
      "utxo_info",
      "datum_info",
      "utxo_info",
    ]);
    // Only the output at an order script is asked about, never the change at the account.
    expect(t.koios.calls[5]!.body._utxo_refs).toEqual([`${SWAP_TX}#0`]);
    const [found] = (await bookOf(t))!.sessions;
    expect(found!.txs).toEqual([
      { kind: "out", txHash: FUNDING_TX, at: (1_700_000_000 + 5_000_000) * 1000, confirmed: true },
      { kind: "swap", txHash: SWAP_TX, at: (1_700_000_000 + 5_000_100) * 1000, confirmed: true, orders: [`${SWAP_TX}#0`] },
    ]);
    expect(found!.recovered.own).toEqual([SWAP_TX]);
    // Its page lists the order, and nothing comes back while it waits.
    expect((await sessions.orders("preprod", 0)).map((o) => o.txIn)).toEqual([`${SWAP_TX}#0`]);
    const claim = await sessions.claimBuild("preprod", [0]);
    expect(claim.returns).toEqual([]);
    expect(claim.skipped).toEqual([{ index: 0, reason: "An order of this session is still waiting." }]);
  });

  it("cancels a found order with the account's own ADA as collateral", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await usedWith(t, 0, [
      [SWAP_TX, 5_000_100],
      [FUNDING_TX, 5_000_000],
    ]);
    swapped(t);
    t.koios.addedToAccounts.push(orderRow(SWAP_TX), atSession(SWAP_TX, 1, "131585414"));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    const review = await sessions.cancelBuild("preprod", 0);
    expect(review).toMatchObject({ kind: "cancel", index: 0, orders: 1 });
    await sessions.txSubmit("preprod", review.txHash, "cancel");
    expect((await bookOf(t))!.sessions[0]!.txs.at(-1)).toMatchObject({ kind: "cancel", txHash: review.txHash });
  });

  it("leaves out an account that holds nothing and has no order open, but never uses its index again", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // Session 0's swap, its order filled since and everything brought back; session 2's, a funding long gone.
    await usedWith(t, 0, [
      [SWAP_TX, 5_000_100],
      [FUNDING_TX, 5_000_000],
    ]);
    swapped(t);
    t.koios.addedToAccounts.push(orderRow(SWAP_TX));
    t.koios.spent.add(`${SWAP_TX}#0`);
    await usedWith(t, 2, [["c2".repeat(32), 5_000_200]]);
    expect(await sessions.scan("preprod")).toEqual({ used: 2, found: [] });
    expect(await bookOf(t)).toEqual({ next: 3, sessions: [] });
    // A new session starts past them, asking about the next alone.
    t.koios.calls.length = 0;
    const out = await sessions.siteOutBuild("preprod", "https://a.example", "15000000", []);
    expect(out.index).toBe(3);
    expect(t.koios.calls.filter((c) => c.path === "account_addresses").map((c) => c.body._stake_addresses)).toEqual([
      [await reward(t, 3)],
    ]);
  });

  it("skips the accounts the device knows, and keeps a session started while it read", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [{ index: 0, ownStake: true, createdAt: 1, txs: [{ kind: "out", txHash: FUNDING_TX, at: 1, confirmed: true }] }],
    });
    await usedWith(t, 0, [[FUNDING_TX, 5_000_000]]);
    await usedWith(t, 1, [["c1".repeat(32), 5_000_100]]);
    t.koios.addedToAccounts.push(
      atSession(FUNDING_TX, 1, "20000000"),
      { ...atSession("c1".repeat(32), 0, "7000000"), payment_cred: await t.wallet.withKeys((k) => k.oneTime.keyHash(1)) },
    );
    // Session 2 starts on this device while the scan reads.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (url.includes("/account_txs")) {
        const book = (await bookOf(t))!;
        await t.store.set("sessions.preprod", {
          next: 3,
          sessions: [...book.sessions, { index: 2, ownStake: true, createdAt: 2, txs: [{ kind: "out", txHash: "c3".repeat(32), at: 2 }] }],
        });
        t.koios.fetch = real;
      }
      return real(url, init);
    };
    expect(await sessions.scan("preprod")).toEqual({ used: 2, found: [1] });
    const book = (await bookOf(t))!;
    expect(book.next).toBe(3);
    expect(book.sessions.map((s) => [s.index, !!s.recovered])).toEqual([
      [0, false],
      [2, false],
      [1, true],
    ]);
    // Only account 1's transactions were asked about.
    expect(t.koios.calls.filter((c) => c.path === "account_txs").map((c) => c.body._stake_address)).toEqual([await reward(t, 1)]);
  });

  it("runs once at a time: a restore's and Find leftovers' share one", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    t.koios.calls.length = 0;
    const [a, b] = await Promise.all([sessions.scan("preprod"), sessions.scan("preprod")]);
    expect(a).toEqual(b);
    expect(asked(t)).toEqual(["account_addresses"]);
  });
});
