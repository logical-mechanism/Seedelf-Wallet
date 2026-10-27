// The restore scan (O5, chunk 27): after a restore, or with the same phrase in
// another browser, the device has no record of its private sessions, so what
// their one-time accounts hold doesn't show. The scan walks the one-time stake
// keys 20 at a time, reads what the used ones the device doesn't know hold and
// the orders their swaps placed, and adds each that holds something, or has an
// order open, as a session found, brought back by hand. Session 0 of the
// 12-word phrase, the real WebAssembly, and fakes of Koios.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { txInputs } from "../src/background/cbor";
import { handle, type Context } from "../src/background/handlers";
import type { KoiosUtxo } from "../src/background/koios";
import { builtOutputs } from "../src/background/minswap";
import { NetworkChoice } from "../src/background/preferences";
import type { SessionService } from "../src/background/sessions";
import { WalletLocked } from "../src/background/wallet";
import type { NetworkName } from "../src/networks";
import type { Message, SessionView } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { toBringBack } from "../src/ui/screens/Home";
import { Session } from "../src/ui/screens/Swaps";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { bytes, ORDER_ADDRESS, ORDER_SCRIPT, SESSION_ADDRESS } from "./fixtures/swap-tx";
import { koiosPreprod, loadTestWasm, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";
import { atSession, busy, MIN, orderRow, PASSWORD, signing, started, SWAP_TX, unlocked, type T } from "./swap-session";

const FUNDING_TX = sessionSwap.utxo.tx_hash;
const ORDER_AT = bech32("addr_test", bytes(ORDER_ADDRESS));
/** The phrase `unlocked` makes the wallet of, and another (24 words) a wallet removed may be followed by. */
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
const OTHER = vectors("cardano_account.json").find((v) => v.phrase.split(" ").length === 24)!.phrase;

/** The worker's handlers over `sessions`, on a build with both networks, preprod first, as the fakes answer it. */
function context(t: T, sessions: SessionService): Context {
  const networks: NetworkName[] = ["preprod", "mainnet"];
  return {
    ...(t as unknown as Context),
    sessions,
    wasm: loadTestWasm(),
    connector: async (on) => on,
    version: "1.0.0",
    network: "preprod",
    networks,
    networkChoice: new NetworkChoice(t.local, networks),
  };
}

/** A request as the worker answers it, on `network`. */
const ask = (message: Message, ctx: Context, network: NetworkName = "preprod") => handle(message, { ...ctx, network });

/** A Koios backend behind the one that listed `txHash`: its `tx_info` has no row for it yet. Returns the undo. */
function noRowYet(t: T, txHash: string) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (!url.includes("/tx_info")) return answer;
    return Response.json(((await answer.json()) as Array<{ tx_hash: string }>).filter((r) => r.tx_hash !== txHash));
  };
  return () => {
    t.koios.fetch = real;
  };
}

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
        txs: [
          {
            kind: "out",
            txHash: FUNDING_TX,
            at: (1_700_000_000 + 5_000_000) * 1000,
            confirmed: true,
            // What the scan read at the account: nothing ends the session before Koios shows it spent (release review C02).
            outs: [`${FUNDING_TX}#1`, `${FUNDING_TX}#2`],
          },
        ],
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
      // The order output its key's swap paid, and its datum: whether it's still open is read off the same answer,
      // never asked again (release review C15).
      "utxo_info",
      "datum_info",
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

  it("puts 5 ₳ in for a found order's cancel when the account holds no ADA alone, then cancels with it", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await usedWith(t, 0, [
      [SWAP_TX, 5_000_100],
      [FUNDING_TX, 5_000_000],
    ]);
    swapped(t);
    // A return from before chunk 24 took everything while the order waited: the account is empty.
    t.koios.addedToAccounts.push(orderRow(SWAP_TX));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    await expect(sessions.cancelBuild("preprod", 0)).rejects.toThrow(
      "The wallet couldn't cancel the order: this session's account holds no UTxO of ADA alone to put up as collateral for cancelling the order.",
    );
    expect((await sessions.list("preprod"))[0]!.cancelCollateral).toBe("missing");

    // 5 ₳ from the private balance, to the session's account alone, recorded as a top-up and sent.
    const put = await sessions.cancelCollateralBuild("preprod", 0);
    expect(put.payments.map((p) => [p.address, p.lovelace, p.tokens.length])).toEqual([[sessionSwap.address, "5000000", 0]]);
    await sessions.topUpSubmit("preprod", put.txHash);
    const sent = t.koios.submitted.at(-1)!;
    expect(txIdOf(sent)).toBe(put.txHash);
    const outs = builtOutputs(sent).flatMap((o, i) => (o.address.slice(2, 58) === sessionSwap.keyHash ? [{ i, o }] : []));
    expect(outs.map(({ o }) => o.lovelace)).toEqual([5_000_000n]);
    expect((await bookOf(t))!.sessions[0]!.txs.at(-1)).toMatchObject({ kind: "out", txHash: put.txHash, outs: [`${put.txHash}#${outs[0]!.i}`] });

    // On its way: the page says so, and no second one is built.
    expect((await sessions.list("preprod"))[0]!.cancelCollateral).toBe("coming");
    await expect(sessions.cancelCollateralBuild("preprod", 0)).rejects.toThrow("The 5 ₳ for the cancel is on its way to the account.");

    // There: nothing more to put in, and the cancel puts it up, the account's only UTxO.
    t.koios.addedToAccounts.push(atSession(put.txHash, outs[0]!.i, "5000000"));
    const [view] = await sessions.list("preprod", true);
    expect(view!.cancelCollateral).toBeUndefined();
    expect(view!.txs.at(-1)).toMatchObject({ kind: "out", txHash: put.txHash, confirmed: true });
    await expect(sessions.cancelCollateralBuild("preprod", 0)).rejects.toThrow("The account already holds a UTxO of ADA alone");
    const review = await sessions.cancelBuild("preprod", 0);
    expect(review).toMatchObject({ kind: "cancel", index: 0, orders: 1 });
    await sessions.txSubmit("preprod", review.txHash, "cancel");
    expect((await bookOf(t))!.sessions[0]!.txs.at(-1)).toMatchObject({ kind: "cancel", txHash: review.txHash });
  });

  it("puts none in where no order of it is open, or for a session that isn't brought back by hand", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await usedWith(t, 0, [[FUNDING_TX, 5_000_000]]);
    t.koios.addedToAccounts.push(atSession(FUNDING_TX, 1, "20000000"));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    await expect(sessions.cancelCollateralBuild("preprod", 0)).rejects.toThrow("No order of this session is waiting");
    // A site's session takes a top-up of its own instead.
    const book = (await bookOf(t))!;
    await t.store.set("sessions.preprod", { ...book, sessions: [{ ...book.sessions[0]!, recovered: undefined, site: { origin: "https://a.example" } }] });
    await expect(sessions.cancelCollateralBuild("preprod", 0)).rejects.toThrow("Only a session you bring back by hand takes 5 ₳ for its cancel.");
    expect(t.koios.submitted).toEqual([]);
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
    // The spent order is read once, its being spent off that same answer (release review C15).
    expect(t.koios.calls.filter((c) => c.path === "utxo_info").map((c) => c.body._utxo_refs)).toEqual([[`${SWAP_TX}#0`]]);
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

  it("keeps the used accounts of every batch of 20", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // Account 3 holds 7 ₳; account 25, in the second batch, holds nothing.
    await usedWith(t, 3, [["c3".repeat(32), 5_000_300]]);
    await usedWith(t, 25, [["d5".repeat(32), 5_002_500]]);
    const key3 = await t.wallet.withKeys((k) => k.oneTime.keyHash(3));
    t.koios.addedToAccounts.push({ ...atSession("c3".repeat(32), 0, "7000000"), payment_cred: key3 });
    expect(await sessions.scan("preprod")).toEqual({ used: 2, found: [3] });
    expect((await bookOf(t))!.next).toBe(26);
  });

  it("brings back what a transaction its key signed left at the account as the session's own, its ADA paying their deposit", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const OUT = "01".repeat(32);
    const SITE = "5e".repeat(32);
    const at = { bech32: sessionSwap.address, cred: sessionSwap.keyHash };
    // Its funding, then a site's transaction its key signed: it spent the funding's #0, and paid the account 25 NFTs on
    // 3 ₳, too little for their deposit (#0), and 9 ₳ (#1). The funding's #1, 5 ₳, is still there.
    await usedWith(t, 0, [
      [SITE, 5_000_100],
      [OUT, 5_000_000],
    ]);
    t.koios.txSpends.set(SITE, [{ payment_addr: at, tx_hash: OUT, tx_index: 0 }]);
    t.koios.txOutputs.set(SITE, [
      { payment_addr: at, tx_index: 0 },
      { payment_addr: at, tx_index: 1 },
    ]);
    const nft = (i: number): [string, string] => [`${"cd".repeat(28)}${(i + 1).toString(16).padStart(24, "0")}`, "1"];
    const nfts = Array.from({ length: 25 }, (_, i) => nft(i));
    t.koios.addedToAccounts.push(atSession(OUT, 1, "5000000"), atSession(SITE, 0, "3000000", nfts));
    t.koios.addedToAccounts.push(atSession(SITE, 1, "9000000"));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    const [found] = (await bookOf(t))!.sessions;
    expect(found!.txs.map((x: { txHash: string }) => x.txHash)).toEqual([OUT]);
    expect(found!.recovered.own).toEqual([SITE]);

    const review = await sessions.backBuild("preprod", 0, true);
    expect(review.inputs).toBe(3);
    expect(review.leftOut ?? []).toEqual([]);
    expect(review.tokens.filter((x) => x.policyId === "cd".repeat(28))).toHaveLength(25);
  });

  it("fails, writing nothing, while the server lists money at a used account but none of its transactions", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // A backend behind the ones that showed account 0 used and holding 20 ₳: no transaction of it listed yet.
    t.koios.usedStakes.add(await reward(t, 0));
    t.koios.addedToAccounts.push(atSession(FUNDING_TX, 1, "20000000"));
    await expect(sessions.scan("preprod")).rejects.toThrow("The server hasn't caught up");
    expect(await bookOf(t)).toBeUndefined();
    // Caught up: found, its index never written as one used and empty.
    await usedWith(t, 0, [[FUNDING_TX, 5_000_000]]);
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
  });

  it("fails, writing nothing, while the server lists a used account's transaction but not what it spent and paid", async () => {
    // Its order open, with the swap's change at the account or with nothing there.
    for (const change of [true, false]) {
      const t = await unlocked();
      const sessions = signing(t);
      await usedWith(t, 0, [
        [SWAP_TX, 5_000_100],
        [FUNDING_TX, 5_000_000],
      ]);
      swapped(t);
      t.koios.addedToAccounts.push(orderRow(SWAP_TX), ...(change ? [atSession(SWAP_TX, 1, "131585414")] : []));
      const caughtUp = noRowYet(t, SWAP_TX);
      await expect(sessions.scan("preprod")).rejects.toThrow("The server hasn't caught up");
      expect(await bookOf(t)).toBeUndefined();
      // Caught up: found with its swap and its order, never without them.
      caughtUp();
      expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
      expect((await bookOf(t))!.sessions[0]!.txs.map((x: { kind: string }) => x.kind)).toEqual(["out", "swap"]);
    }
  });
});

describe("a session funded in parts, found by the restore scan (1.6.0's release review, x-scenarios-sessions#0)", () => {
  const PART1 = "a7".repeat(32);
  const PART2 = "a8".repeat(32);
  const OTHER_PAYER = "a9".repeat(32);
  const account = { bech32: sessionSwap.address, cred: sessionSwap.keyHash };
  /** An input at the wallet contract: outpoint `u`, one of this phrase's private UTxOs or a stranger's. */
  const fromContract = (u: KoiosUtxo) => ({
    payment_addr: { bech32: u.address!, cred: koiosPreprod.wallet_contract },
    tx_hash: u.tx_hash,
    tx_index: u.tx_index,
  });
  /** 25 NFTs, each of its own policy: more kinds than one output of the return holds (20). */
  const nfts = Array.from({ length: 25 }, (_, i): [string, string] => [`${(i + 0x10).toString(16).repeat(28)}4e4654`, "1"]);
  const policies = new Set(nfts.map(([id]) => id.slice(0, 56)));
  /** The NFTs a return brings back. */
  const nftsBack = (tokens: Array<{ policyId: string }>) => tokens.filter((x) => policies.has(x.policyId)).length;

  /**
   * Account 0 funded in two parts, each a Seedelf spend of this phrase's own private UTxOs that its key didn't sign:
   * the first paid 20 NFTs on 4.09 ₳ and the 5 ₳ collateral, the second 5 NFTs on the least those need at a key
   * address, too little for a deposit of their own. `order`: the parts as `account_txs` lists them, newest first.
   */
  async function fundedInParts(order: Array<[string, number]>) {
    const t = await unlocked();
    const sessions = signing(t);
    await usedWith(t, 0, order);
    t.koios.txSpends.set(PART1, [fromContract(ownedUtxos[0]!)]);
    t.koios.txSpends.set(PART2, [fromContract(ownedUtxos[1]!)]);
    t.koios.txOutputs.set(PART1, [
      { payment_addr: account, tx_index: 0 },
      { payment_addr: account, tx_index: 1 },
    ]);
    t.koios.txOutputs.set(PART2, [{ payment_addr: account, tx_index: 0 }]);
    t.koios.spent.add(`${ownedUtxos[0]!.tx_hash}#${ownedUtxos[0]!.tx_index}`);
    t.koios.spent.add(`${ownedUtxos[1]!.tx_hash}#${ownedUtxos[1]!.tx_index}`);
    t.koios.addedToAccounts.push(
      atSession(PART1, 0, "4090190", nfts.slice(0, 20)),
      atSession(PART1, 1, "5000000"),
      atSession(PART2, 0, "1762790", nfts.slice(20)),
    );
    return { t, sessions };
  }

  it("brings back every part's tokens as the session's own, whichever part the scan takes for its funding", async () => {
    // The parts a block apart, or in one block, the second sorting last: the scan takes it for the funding then.
    for (const [order, funding] of [
      [
        [
          [PART2, 5_000_100],
          [PART1, 5_000_000],
        ],
        PART1,
      ],
      [
        [
          [PART1, 5_000_000],
          [PART2, 5_000_000],
        ],
        PART2,
      ],
    ] as Array<[Array<[string, number]>, string]>) {
      const { t, sessions } = await fundedInParts(order);
      t.koios.calls.length = 0;
      expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
      const asked = t.koios.calls.filter((c) => c.path === "utxo_info").map((c) => c.body._utxo_refs);

      const review = await sessions.backBuild("preprod", 0, true);
      expect(review.leftOut ?? []).toEqual([]);
      expect(nftsBack(review.tokens)).toBe(25);
      expect(review.inputs).toBe(3);

      const [found] = (await bookOf(t))!.sessions;
      expect(found!.txs.map((x: { txHash: string }) => x.txHash)).toEqual([funding]);
      // The other part is the session's own, as what its key signed is: what it spent was this phrase's.
      expect(found!.recovered.own).toEqual([funding === PART1 ? PART2 : PART1]);
      // Only the other part's inputs at the wallet contract were asked about, never the funding's.
      const other = funding === PART1 ? ownedUtxos[1]! : ownedUtxos[0]!;
      expect(asked).toEqual([[`${other.tx_hash}#${other.tx_index}`]]);
    }
  });

  it("keeps a payment from someone else's Seedelf UTxOs a stranger's: its tokens come back only when they pay their own way", async () => {
    const { t, sessions } = await fundedInParts([
      [OTHER_PAYER, 5_000_100],
      [PART1, 5_000_000],
    ]);
    // Not the second part: a stranger paid the account the same 5 NFTs from a register this phrase doesn't own.
    const stranger = koiosPreprod.contract_utxos[0]!;
    t.koios.txSpends.set(OTHER_PAYER, [fromContract(stranger)]);
    t.koios.txOutputs.set(OTHER_PAYER, [{ payment_addr: account, tx_index: 0 }]);
    const at = t.koios.addedToAccounts.findIndex((u) => u.tx_hash === PART2);
    t.koios.addedToAccounts.splice(at, 1, atSession(OTHER_PAYER, 0, "1762790", nfts.slice(20)));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    expect((await bookOf(t))!.sessions[0]!.recovered.own).toEqual([]);

    // The session's ADA never pays for a stranger's tokens (final review F4).
    const review = await sessions.backBuild("preprod", 0, true);
    expect(review.leftOut).toEqual([{ txHash: OTHER_PAYER, txIndex: 0, reason: "cost" }]);
    expect(nftsBack(review.tokens)).toBe(20);
  });

  it("fails, writing nothing, while the server lists what a part spent but has no row of it", async () => {
    const { t, sessions } = await fundedInParts([
      [PART2, 5_000_100],
      [PART1, 5_000_000],
    ]);
    // A backend behind: utxo_info knows nothing of the second part's input yet.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (!url.includes("/utxo_info")) return answer;
      return Response.json(((await answer.json()) as Array<{ tx_hash: string }>).filter((r) => r.tx_hash !== ownedUtxos[1]!.tx_hash));
    };
    await expect(sessions.scan("preprod")).rejects.toThrow("The server hasn't caught up");
    expect(await bookOf(t)).toBeUndefined();
    // Caught up: found with the second part as its own.
    t.koios.fetch = real;
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    expect((await bookOf(t))!.sessions[0]!.recovered.own).toEqual([PART2]);
  });

  it("brings back every NFT a site's session was funded with in two real parts, after a restore on another device", { timeout: 180_000 }, async () => {
    const wasm = loadTestWasm();
    /** The private balance: 25 UTxOs of one NFT on 2 ₳ each, and 60 ₳ of ADA alone, all under this phrase's register. */
    const balance = (t: T) => {
      const base = ownedUtxos[0]!;
      t.koios.added.push(
        ...nfts.map(([id], i) => ({
          ...base,
          tx_hash: (i + 1).toString(16).padStart(64, "0"),
          value: "2000000",
          asset_list: [{ policy_id: id.slice(0, 56), asset_name: id.slice(56), quantity: "1", decimals: 0, fingerprint: "" }],
        })),
        { ...base, tx_hash: "ff".repeat(32), value: "60000000", asset_list: [] },
      );
    };
    // The device that funded it: a site's session for 10 ₳ and every NFT, which goes as two parts.
    const funder = testBalances({ owned: false });
    await funder.wallet.create(PHRASE, PASSWORD);
    balance(funder);
    const funding = signing(funder);
    const tokens = nfts.map(([id]) => ({ policyId: id.slice(0, 56), assetName: id.slice(56), quantity: "1" }));
    const out = await funding.siteOutBuild("preprod", "https://app.example.com", "10000000", tokens);
    expect(out.parts).toHaveLength(2);
    await funding.siteOutSubmit("preprod", out.txHash, "https://app.example.com");
    const parts = funder.koios.submitted.map((b) => ({ id: txIdOf(b), b }));
    expect(parts.map((p) => p.id)).toEqual(out.parts!.map((p) => p.txHash));

    // The same phrase restored on another device, the parts on chain: its scan finds the session.
    const t = testBalances({ owned: false });
    await t.wallet.create(PHRASE, PASSWORD);
    balance(t);
    const sessions = signing(t);
    await usedWith(
      t,
      0,
      parts.map((p, i) => [p.id, 5_000_000 + i] as [string, number]).reverse(),
    );
    const contract = { bech32: ownedUtxos[0]!.address!, cred: koiosPreprod.wallet_contract };
    for (const { id, b } of parts) {
      const spent = txInputs(b);
      for (const o of spent) t.koios.spent.add(o);
      t.koios.txSpends.set(
        id,
        spent.map((o) => ({ payment_addr: contract, tx_hash: o.split("#")[0]!, tx_index: Number(o.split("#")[1]) })),
      );
      const detail = JSON.parse(wasm.decodeTx(wasm.Network.Preprod, Buffer.from(b).toString("hex"))) as {
        outputs: Array<{ index: number; address: { hex: string }; lovelace: string; assets: Array<{ policyId: string; assetName: string; quantity: string }> }>;
      };
      for (const o of detail.outputs) {
        if (o.address.hex.slice(2, 58) !== sessionSwap.keyHash) continue;
        t.koios.addedToAccounts.push(atSession(id, o.index, o.lovelace, o.assets.map((a) => [`${a.policyId}${a.assetName}`, a.quantity])));
      }
    }
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });

    // Bring it back: every NFT, whichever part the scan took for the funding.
    const review = await sessions.backBuild("preprod", 0, true);
    expect(review.leftOut ?? []).toEqual([]);
    expect(nftsBack(review.tokens)).toBe(25);
  });
});

describe("a session the restore scan found, once nothing of it would come back", () => {
  /** Account 0 used for a funding whose 20 ₳ and 5 ₳ are still there, found by a scan. */
  async function found() {
    const t = await unlocked();
    const sessions = signing(t);
    await usedWith(t, 0, [[FUNDING_TX, 5_000_000]]);
    t.koios.addedToAccounts.push(atSession(FUNDING_TX, 1, "20000000"), atSession(FUNDING_TX, 2, "5000000"));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    return { t, sessions };
  }

  /** Session `s`'s page as it's rendered: the one the dApps page's After a restore opens. */
  const markupOf = (s: SessionView) =>
    renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(Session, { session: s, reading: false, onRefresh: () => undefined, onBack: () => undefined, onChanged: () => undefined }),
      ),
    );

  /** Session `s`'s page as a person reads it. */
  const pageOf = (s: SessionView) =>
    markupOf(s)
      .replace(/<[^>]+>/g, " ")
      .replaceAll("&#x27;", "'")
      .replace(/\s+/g, " ");

  /** What its page says while it waits to end by itself, its order over and its account read empty (L4). */
  const SETTLING =
    "Nothing at its account was left to bring back when it was last read, and its order is over. Once that has held for 15 minutes, the next refresh ends it, unless something comes in first, which Bring it back then takes.";

  /** While it waits, Bring it back, which reads the account again, stays: not as the page's main button. */
  const settlingFoot = (s: SessionView) => {
    const markup = markupOf(s);
    expect(markup).toMatch(/<button[^>]*class="secondary"[^>]*>Bring it back</);
    expect(markup).not.toMatch(/class="primary"[^>]*>Bring it back</);
    expect(markup).not.toMatch(/disabled=""[^>]*>Bring it back</);
  };

  it("ends once Koios shows what the scan read there spent, emptied elsewhere, and goes from the book", async () => {
    const { t, sessions } = await found();
    // A backend behind the scan's lists the account empty, and knows nothing of what it held: the session stays.
    const there = t.koios.addedToAccounts.splice(0);
    expect((await sessions.list("preprod", true))[0]).toMatchObject({ index: 0, stage: "open", recovered: true });
    // The same phrase in another browser brought it back: Koios shows both spent.
    t.koios.addedToAccounts.push(...there);
    t.koios.spent.add(`${FUNDING_TX}#1`);
    t.koios.spent.add(`${FUNDING_TX}#2`);
    expect(await sessions.list("preprod", true)).toEqual([]);
    expect(await sessions.atStake("preprod")).toEqual([]);
    expect(await bookOf(t)).toEqual({ next: 1, sessions: [] });
    // Its index is never used again, and Find leftovers finds it again once money reaches it.
    t.koios.addedToAccounts.push(atSession("c4".repeat(32), 0, "7000000"));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
  });

  it("ends, closed with it left behind, once a return finds it holds only what no return takes", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const STRANGER = "ab".repeat(32);
    await usedWith(t, 0, [
      [STRANGER, 5_000_200],
      [FUNDING_TX, 5_000_000],
    ]);
    // A stranger's token on 1.2 ₳: it doesn't pay its own way back.
    t.koios.addedToAccounts.push(atSession(STRANGER, 0, "1200000", [[MIN, "1000"]]));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    // Until a return finds so, it's there to bring back.
    expect((await sessions.list("preprod", true))[0]).toMatchObject({ stage: "open" });
    await expect(sessions.backBuild("preprod", 0, true)).rejects.toThrow("too little to pay for its own way back");
    expect((await sessions.list("preprod", true))[0]).toMatchObject({
      index: 0,
      stage: "closed",
      recovered: true,
      leftBehind: [{ txHash: STRANGER, txIndex: 0, reason: "fee" }],
    });
    // Remove wallet names it as left behind, not as still open; Find leftovers doesn't add it again.
    expect(await sessions.atStake("preprod")).toEqual([{ index: 0, kind: "found", leftBehind: true }]);
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [] });
    // Its page says what stays, and that it's over here: never that everything came back, since nothing did from
    // here, nor that the account is never used again (cross-area review X09).
    const page = pageOf((await sessions.list("preprod"))[0]!);
    expect(page).toContain("One UTxO stays at the session's account");
    expect(page).toContain("It's over in this browser: nothing more at its account comes back from here.");
    expect(page).not.toContain("Everything came back");
    expect(page).not.toContain("never used again");
  });

  it("keeps only what's still there of what a return left behind, and goes from the book when none is (cross-area review X16)", async () => {
    const STRANGER = "ab".repeat(32);
    for (const taken of [[0], [0, 1]]) {
      const t = await unlocked();
      const sessions = signing(t);
      await usedWith(t, 0, [
        [STRANGER, 5_000_200],
        [FUNDING_TX, 5_000_000],
      ]);
      // Two of a stranger's tokens, each on 1.2 ₳: neither pays its own way back.
      t.koios.addedToAccounts.push(atSession(STRANGER, 0, "1200000", [[MIN, "1000"]]), atSession(STRANGER, 1, "1200000", [[MIN, "1000"]]));
      expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
      await expect(sessions.backBuild("preprod", 0, true)).rejects.toThrow("too little to pay for its own way back");
      // Taken elsewhere (the same phrase in another browser) before this device reads the account again.
      for (const i of taken) t.koios.spent.add(`${STRANGER}#${i}`);
      const views = await sessions.list("preprod", true);
      if (taken.length === 1) {
        // What's still there stays left behind, and holds the record, closed, to point to it.
        expect(views).toMatchObject([{ index: 0, stage: "closed", leftBehind: [{ txHash: STRANGER, txIndex: 1, reason: "fee" }] }]);
        expect((await bookOf(t))!.sessions[0]!.leftBehind).toEqual([{ txHash: STRANGER, txIndex: 1, reason: "fee", lovelace: "1200000" }]);
        continue;
      }
      // Nothing's left: the record goes, Remove wallet names nothing, and Find leftovers finds the account again.
      expect(views).toEqual([]);
      expect(await bookOf(t)).toEqual({ next: 1, sessions: [] });
      expect(await sessions.atStake("preprod")).toEqual([]);
      t.koios.addedToAccounts.push(atSession("c4".repeat(32), 0, "7000000"));
      expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    }
  });

  it("ends so too when what this device sent for it was turned away, which never went out, once its order's end has settled", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await usedWith(t, 0, [
      [SWAP_TX, 5_000_100],
      [FUNDING_TX, 5_000_000],
    ]);
    swapped(t);
    t.koios.addedToAccounts.push(orderRow(SWAP_TX));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    // 5 ₳ for its order's cancel, which the network turns away.
    const put = await sessions.cancelCollateralBuild("preprod", 0);
    t.koios.rejectSubmit = "ConwayUtxowFailure (UtxoFailure (FeeTooSmallUTxO))";
    await expect(sessions.topUpSubmit("preprod", put.txHash)).rejects.toThrow();
    expect((await bookOf(t))!.sessions[0]!.txs.at(-1)).toMatchObject({ kind: "out", txHash: put.txHash, unsent: true });
    // The other browser cancelled the order and brought everything back: the order spent, the account empty. An
    // order's end pays the account in that same transaction, which a listing read before it doesn't show: it waits
    // until nothing has come in 15 minutes after a refresh first read it so (cross-area review X01).
    t.koios.spent.add(`${SWAP_TX}#0`);
    const [waits] = await sessions.list("preprod", true);
    expect([waits!.index, waits!.stage]).toEqual([0, "open"]);
    // Meanwhile its page says so, never to bring back what isn't there, and Home's restore note doesn't count it
    // (the last review, L4).
    expect(waits!.settling).toBe(true);
    expect(toBringBack(waits!)).toBe(false);
    expect(pageOf(waits!)).toContain(SETTLING);
    expect(pageOf(waits!)).not.toContain("bring everything in the account back");
    settlingFoot(waits!);
    await busy(t, 14 * MINUTE);
    const later = (await sessions.list("preprod", true)).map((v) => [v.index, v.stage, v.settling]);
    expect(later).toEqual([[0, "open", true]]);
    await busy(t, MINUTE);
    expect(await sessions.list("preprod", true)).toEqual([]);
    expect(await bookOf(t)).toEqual({ next: 1, sessions: [] });
  });

  it("waits out a listing read before its order's fill, and keeps what the fill paid (cross-area review X01)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const FILL = "f1".repeat(32);
    await usedWith(t, 0, [
      [SWAP_TX, 5_000_100],
      [FUNDING_TX, 5_000_000],
    ]);
    swapped(t);
    // Its order waits, and the account is empty: nothing the scan read there holds its end back.
    t.koios.addedToAccounts.push(orderRow(SWAP_TX));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    expect((await bookOf(t))!.sessions[0]!.txs[0]!.outs).toBeUndefined();
    // The fill's block lands as a refresh has read the account and not yet the order: one server, read in turn.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (url.includes("/credential_utxos")) {
        t.koios.fetch = real;
        t.koios.spent.add(`${SWAP_TX}#0`);
        t.koios.addedToAccounts.push(atSession(FILL, 0, "30000000"));
      }
      return answer;
    };
    const [missed] = await sessions.list("preprod", true);
    expect([missed!.index, missed!.stage, missed!.settling]).toEqual([0, "open", true]);
    expect(t.koios.fetch).toBe(real);
    expect((await bookOf(t))!.sessions.map((s) => s.index)).toEqual([0]);
    // The next refresh lists what the fill paid: it's there to bring back, and its page says so again (the last
    // review, L4).
    const [view] = await sessions.list("preprod", true);
    expect(view).toMatchObject({ index: 0, stage: "open", recovered: true, holding: { lovelace: "30000000", utxos: 1 } });
    expect(view!.settling).toBeUndefined();
    expect(toBringBack(view!)).toBe(true);
    expect(pageOf(view!)).toContain("Nothing is waiting: bring everything in the account back into your private balance.");
    expect(markupOf(view!)).toMatch(/<button[^>]*class="primary"[^>]*>Bring it back</);
    // Brought back elsewhere long after: a fresh 15 minutes from the first refresh that reads it so, as before.
    await busy(t, 30 * MINUTE);
    t.koios.spent.add(`${FILL}#0`);
    expect((await sessions.list("preprod", true)).map((v) => [v.index, v.settling])).toEqual([[0, true]]);
    await busy(t, 15 * MINUTE);
    expect(await sessions.list("preprod", true)).toEqual([]);
    expect(await sessions.atStake("preprod")).toEqual([]);
  });

  it("waits to end by itself only while this device has sent nothing for it, though its record keeps the mark (the last review, L4)", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const FILL = "f1".repeat(32);
    await usedWith(t, 0, [
      [SWAP_TX, 5_000_100],
      [FUNDING_TX, 5_000_000],
    ]);
    swapped(t);
    t.koios.addedToAccounts.push(orderRow(SWAP_TX));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    // A refresh reads the account just before the fill's block lands, and the order just after.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (url.includes("/credential_utxos")) {
        t.koios.fetch = real;
        t.koios.spent.add(`${SWAP_TX}#0`);
        t.koios.addedToAccounts.push(atSession(FILL, 0, "30000000"));
      }
      return answer;
    };
    expect((await sessions.list("preprod", true))[0]!.settling).toBe(true);
    // Bring it back, pressed meanwhile, reads the account again: it takes the payout the refresh missed.
    const back = await sessions.backBuild("preprod", 0, true);
    expect(BigInt(back.lovelace)).toBeGreaterThan(29_000_000n);
    await sessions.backSubmit("preprod", back.txHash);
    // That return landed, and something reached the account since: open again, with that to bring back. Its record
    // still holds the mark, which no refresh clears once this device has sent something for it: it's no wait now.
    t.koios.spent.add(`${FILL}#0`);
    t.koios.addedToAccounts.push(atSession("c4".repeat(32), 0, "7000000"));
    t.koios.confirmations = 1;
    await busy(t, MINUTE);
    const [view] = await sessions.list("preprod", true);
    expect(view).toMatchObject({ index: 0, stage: "open", holding: { lovelace: "7000000", utxos: 1 } });
    expect((await bookOf(t))!.sessions[0]!.recovered.quietAt).toBeDefined();
    expect(view!.settling).toBeUndefined();
    expect(toBringBack(view!)).toBe(true);
    expect(pageOf(view!)).not.toContain(SETTLING);
  });

  it("ends only with its own return, once this device sent one, that return confirmed and its record kept", async () => {
    const { t, sessions } = await found();
    const back = await sessions.backBuild("preprod", 0, true);
    await sessions.backSubmit("preprod", back.txHash);
    // What it held spent and the account empty, but the return not on chain yet: on its way, not over.
    t.koios.spent.add(`${FUNDING_TX}#1`);
    t.koios.spent.add(`${FUNDING_TX}#2`);
    expect((await sessions.list("preprod", true))[0]).toMatchObject({ index: 0, stage: "returning" });
    t.koios.confirmations = 1;
    await busy(t, 60_000);
    expect((await sessions.list("preprod", true))[0]).toMatchObject({ index: 0, stage: "closed", recovered: true });
    expect(await sessions.atStake("preprod")).toEqual([]);
    // Its page says what came back and that it's over here: never that everything came back, nor that the account
    // is never used again, since another browser may still use it (C18; cross-area review X09).
    const [closed] = await sessions.list("preprod");
    const page = pageOf(closed!);
    expect(page).toContain("Received");
    expect(page).toContain("It's over in this browser: nothing more at its account comes back from here.");
    expect(page).not.toContain("Everything came back");
    expect(page).not.toContain("never used again");
    // A session from before swaps ran themselves, the same, says it as before.
    expect(pageOf({ ...closed!, recovered: undefined })).toContain(
      "Everything came back into your private balance. This account is never used again.",
    );
  });
});

describe("a restore scan under way when the wallet is removed", () => {
  it("writes nothing into the next phrase's book, whose restore scans for itself", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const ctx = context(t, sessions);
    await usedWith(t, 0, [[FUNDING_TX, 5_000_000]]);
    t.koios.addedToAccounts.push(atSession(FUNDING_TX, 1, "20000000"), atSession(FUNDING_TX, 2, "5000000"));
    const real = t.koios.fetch;
    let removed = false;
    let second: Promise<unknown> | undefined;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    t.koios.fetch = async (url, init) => {
      // Removed while the scan reads the account's transactions; the other phrase made by the time it reads what they did.
      if (url.includes("/account_txs") && !removed) {
        removed = true;
        await ask({ type: "reset-wallet", force: true }, ctx);
      } else if (url.includes("/tx_info") && removed && !second) {
        await t.wallet.create(OTHER, PASSWORD);
        second = sessions.scan("preprod");
      } else if (url.includes("/account_addresses") && second) {
        // The other phrase's scan walks its one-time accounts only once the first has ended, past its own walk by then.
        await gate;
      }
      return real(url, init);
    };
    const first = sessions.scan("preprod");
    await expect(first).rejects.toThrow(WalletLocked);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    // The first, ending, let go of its own entry alone: the other phrase's scan still runs, and Find leftovers pressed
    // meanwhile shares it (cross-area review X14).
    expect(await sessions.scanDue("preprod")).toEqual({ due: false, scanning: true });
    expect(sessions.scan("preprod")).toBe(second);
    release();
    // The other phrase's own scan, on its own keys: none of its accounts used.
    expect(await second).toEqual({ used: 0, found: [] });
    expect(await bookOf(t)).toBeUndefined();
    expect(await sessions.list("preprod")).toEqual([]);
  });
});

describe("a restore's scan that doesn't finish", () => {
  /**
   * Session 0 of the phrase used, holding 20 ₳, and the wallet removed again: what a restore then finds. `lovejoin`:
   * the sessions with Lovejoin wired in, as the worker has them, so a mix can start.
   */
  async function removedWithLeftovers(lovejoin = false) {
    const t = await unlocked();
    await usedWith(t, 0, [[FUNDING_TX, 5_000_000]]);
    t.koios.addedToAccounts.push(atSession(FUNDING_TX, 1, "20000000"));
    await t.wallet.reset();
    const sessions = signing(t, lovejoin ? { lovejoin: t.lovejoin, sleep: async () => undefined } : {});
    return { t, sessions, ctx: context(t, sessions) };
  }

  it("counts as under way from before the wallet exists, so a Home its state change opens never takes it for over", async () => {
    // The wallet's creation opens Home in every page at once, while the restore goes on to mark the networks and
    // start the scan: a Home that asked then heard "not due, none running" and never asked again (the release PR's
    // e2e, under load). Asked right after the wallet exists, it must hear that a scan is under way.
    const { ctx } = await removedWithLeftovers();
    const heard: unknown[] = [];
    const adoptKept = ctx.pending.adoptKept.bind(ctx.pending);
    ctx.pending.adoptKept = async (networks) => {
      heard.push(await ask({ type: "session-scan-due" }, ctx));
      return adoptKept(networks);
    };
    await ask({ type: "restore-wallet", phrase: PHRASE, password: PASSWORD }, ctx);
    expect(heard).toEqual([{ due: true, scanning: true }]);
    // And once the restore has answered, the scan it started is what's under way, then what's done.
    await vi.waitFor(async () => expect(await ask({ type: "session-scan-due" }, ctx)).toEqual({ due: false, scanning: false }));
  });

  it("leaves its network marked when a read fails, and the other network, until a scan finishes there", async () => {
    const { t, ctx } = await removedWithLeftovers();
    const real = t.koios.fetch;
    let refused = 0;
    let looked!: () => void;
    const looking = new Promise<void>((r) => (looked = r));
    t.koios.fetch = async (url, init) => {
      // The restore's look for public accounts (one stake key a request) waits, so what's asked meanwhile is asked
      // while it looks.
      if (url.includes("/account_addresses") && JSON.parse(String(init.body))._stake_addresses.length === 1) await looking;
      if (!url.includes("/account_txs")) return real(url, init);
      refused++;
      return new Response("", { status: 429 });
    };
    await ask({ type: "restore-wallet", phrase: PHRASE, password: PASSWORD }, ctx);
    // Looking from the restore on, its look for public accounts first: not a scan that didn't finish.
    expect(await ask({ type: "session-scan-due" }, ctx)).toEqual({ due: true, scanning: true });
    looked();
    await vi.waitFor(async () => expect(await ask({ type: "session-scan-due" }, ctx)).toEqual({ due: true, scanning: false }));
    // Its first try and the two retries.
    expect(refused).toBe(3);
    expect(await ask({ type: "session-scan-due" }, ctx, "mainnet")).toEqual({ due: true, scanning: false });

    // Find leftovers, with the server answering again: found, and the mark goes there alone.
    t.koios.fetch = real;
    expect(await ask({ type: "session-scan" }, ctx)).toEqual({ used: 1, found: [0] });
    expect(await ask({ type: "session-scan-due" }, ctx)).toEqual({ due: false, scanning: false });
    expect(await ask({ type: "session-scan-due" }, ctx, "mainnet")).toEqual({ due: true, scanning: false });
    // On the other network too, though it finds nothing there to write.
    expect(await ask({ type: "session-scan" }, ctx, "mainnet")).toEqual({ used: 0, found: [] });
    expect(await ask({ type: "session-scan-due" }, ctx, "mainnet")).toEqual({ due: false, scanning: false });
  });

  it("keeps the mark through a lock that cuts the scan off, and a restore's own scan that finishes clears it", async () => {
    const { t, sessions, ctx } = await removedWithLeftovers();
    const real = t.koios.fetch;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    t.koios.fetch = async (url, init) => {
      // The scan's first 20 one-time stake keys wait until the wallet locks.
      if (url.includes("/account_addresses") && JSON.parse(String(init.body))._stake_addresses.length === 20 && !held) {
        held = true;
        await gate;
      }
      return real(url, init);
    };
    await ask({ type: "restore-wallet", phrase: PHRASE, password: PASSWORD }, ctx);
    // Home says the restore with its Wallet restored note.
    expect(await ask({ type: "restored" }, ctx)).toBe(true);
    await vi.waitFor(() => expect(held).toBe(true));
    await ask({ type: "lock" }, ctx);
    release();
    // Its next key read, locked, ends it.
    await vi.waitFor(() => expect((sessions as unknown as { scanning: Map<string, unknown> }).scanning.size).toBe(0));
    await ask({ type: "unlock", password: PASSWORD }, ctx);
    expect(await ask({ type: "session-scan-due" }, ctx)).toEqual({ due: true, scanning: false });
    // The lock wiped that note, so Home has none to say the scan didn't finish: only the dApps page's After a restore,
    // read from the sealed mark, points to Find leftovers now (cross-area review X25).
    expect(await ask({ type: "restored" }, ctx)).toBe(false);
    expect((await sessions.list("preprod")).filter((s) => s.recovered)).toEqual([]);

    // Restored again where nothing fails: its own scan clears it.
    await ask({ type: "reset-wallet", force: true }, ctx);
    await ask({ type: "restore-wallet", phrase: PHRASE, password: PASSWORD }, ctx);
    await vi.waitFor(async () => expect(await ask({ type: "session-scan-due" }, ctx)).toEqual({ due: false, scanning: false }));
    expect((await bookOf(t))!.sessions.map((s) => s.index)).toEqual([0]);
  });

  it("keeps its network marked through a new session's funding, until Find leftovers runs there (cross-area review X02)", async () => {
    const fundings: Array<[string, (sessions: SessionService) => Promise<unknown>]> = [
      ["a swap", (sessions) => started(sessions)],
      [
        "a site's private session",
        async (sessions) => {
          const out = await sessions.siteOutBuild("preprod", "https://a.example", "15000000", []);
          await sessions.siteOutSubmit("preprod", out.txHash, "https://a.example");
        },
      ],
      [
        "a mix (a Bootstrap's, which draws nothing from the pool)",
        async (sessions) => {
          const out = await sessions.mixOutBuild("preprod", 1, { bootstrap: true });
          await sessions.mixOutSubmit("preprod", out.txHash);
        },
      ],
    ];
    for (const [what, fund] of fundings) {
      const { t, sessions, ctx } = await removedWithLeftovers(true);
      const real = t.koios.fetch;
      t.koios.fetch = async (url, init) => (url.includes("/account_txs") ? new Response("", { status: 429 }) : real(url, init));
      await ask({ type: "restore-wallet", phrase: PHRASE, password: PASSWORD }, ctx);
      await vi.waitFor(async () => expect(await ask({ type: "session-scan-due" }, ctx)).toEqual({ due: true, scanning: false }));
      t.koios.fetch = real;
      // Started on the network the restore's scan didn't finish on: still marked, and the other network too.
      await fund(sessions);
      expect(await ask({ type: "session-scan-due" }, ctx), what).toEqual({ due: true, scanning: false });
      expect(await ask({ type: "session-scan-due" }, ctx, "mainnet"), what).toEqual({ due: true, scanning: false });
      // Find leftovers finds the session from before the restore, beside the new one, and the mark goes.
      expect(await ask({ type: "session-scan" }, ctx), what).toEqual({ used: 1, found: [0] });
      expect(await ask({ type: "session-scan-due" }, ctx), what).toEqual({ due: false, scanning: false });
    }
    // Three restores and three fundings, each through WebAssembly: about 4 s alone, so a loaded run went past 5 s.
  }, 20_000);

  it("marks nothing for a new phrase, which has nothing anywhere", async () => {
    const t = (await removedWithLeftovers()).t;
    const ctx = context(t, signing(t));
    await ask({ type: "create-wallet", phrase: OTHER, password: PASSWORD }, ctx);
    expect(await ask({ type: "session-scan-due" }, ctx)).toEqual({ due: false, scanning: false });
    expect(await ask({ type: "session-scan-due" }, ctx, "mainnet")).toEqual({ due: false, scanning: false });
  });
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** What each transaction submitted paid session 0's account. */
function paidToSession(t: T): bigint[][] {
  return t.koios.submitted.map((tx) => builtOutputs(tx).flatMap((o) => (o.address.slice(2, 58) === sessionSwap.keyHash ? [o.lovelace] : [])));
}

/**
 * Found session 0, whose swap's order (Minswap V1's, of `order` lovelace) still waits, with `held` at its account;
 * and a second 25 ₳ in the private balance, so it could pay a second 5 ₳.
 */
async function foundOrder(order = "14000000", held: KoiosUtxo[] = []) {
  const t = await unlocked();
  t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "b1".repeat(32), tx_index: 0 });
  const sessions = signing(t);
  await usedWith(t, 0, [
    [SWAP_TX, 5_000_100],
    [FUNDING_TX, 5_000_000],
  ]);
  swapped(t);
  t.koios.addedToAccounts.push(orderRow(SWAP_TX, 0, order), ...held);
  expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
  return { t, sessions };
}

/** The 5 ₳ for its cancel, put in and sent, then listed at the account as the page reads it: its output, `txhash#index`. */
async function putIn(t: T, sessions: SessionService): Promise<string> {
  const put = await sessions.cancelCollateralBuild("preprod", 0);
  await sessions.topUpSubmit("preprod", put.txHash);
  const i = builtOutputs(t.koios.submitted.at(-1)!).findIndex((o) => o.address.slice(2, 58) === sessionSwap.keyHash);
  t.koios.addedToAccounts.push(atSession(put.txHash, i, "5000000"));
  expect((await sessions.list("preprod", true))[0]!.cancelCollateral).toBeUndefined();
  return `${put.txHash}#${i}`;
}

describe("a found session's 5 ₳ for its order's cancel", () => {
  it("puts in none while the cancel it was for is on its way, though that cancel spent it (1.5.0's release review, C04)", async () => {
    for (const wait of [10 * MINUTE, 2 * HOUR + MINUTE]) {
      // A 1 ₳ order: its ADA can't pay the cancel's fee and change, as a Splash order's never can (its refund is the
      // whole order), so the cancel spends the 5 ₳ too.
      const { t, sessions } = await foundOrder("1000000");
      const topUp = await putIn(t, sessions);
      await busy(t, wait);
      const review = await sessions.cancelBuild("preprod", 0);
      await sessions.txSubmit("preprod", review.txHash, "cancel");
      expect(txInputs(t.koios.submitted.at(-1)!)).toContain(topUp);
      // The order reads open until the cancel lands, and the 5 ₳ as spent: what's on its way is the cancel.
      const [view] = await sessions.list("preprod", true);
      expect(await sessions.orders("preprod", 0)).toHaveLength(1);
      expect(view!.cancelCollateral).toBeUndefined();
      expect(view!.cancelling).toBe(true);
      await expect(sessions.cancelCollateralBuild("preprod", 0)).rejects.toThrow("The order's cancel is on its way, so it needs no 5 ₳.");
      expect(paidToSession(t)).toHaveLength(2);
    }
  });

  it("stops counting its cancel as on its way once it's on chain, turned away, or unseen for 2 hours (C04; cross-area review X13)", async () => {
    // On chain: tx_status shows it.
    let { t, sessions } = await foundOrder("1000000");
    await putIn(t, sessions);
    let review = await sessions.cancelBuild("preprod", 0);
    await sessions.txSubmit("preprod", review.txHash, "cancel");
    expect((await sessions.list("preprod", true))[0]!.cancelling).toBe(true);
    t.koios.confirmations = 1;
    let [view] = await sessions.list("preprod", true);
    expect(view!.txs.at(-1)).toMatchObject({ kind: "cancel", txHash: review.txHash, confirmed: true });
    expect(view!.cancelling).toBeUndefined();

    // Turned away: it never went out. The account's own ADA alone is its collateral.
    ({ t, sessions } = await foundOrder(undefined, [atSession(SWAP_TX, 1, "131585414")]));
    review = await sessions.cancelBuild("preprod", 0);
    t.koios.rejectSubmit = "ConwayUtxowFailure (UtxoFailure (FeeTooSmallUTxO))";
    await expect(sessions.txSubmit("preprod", review.txHash, "cancel")).rejects.toThrow();
    t.koios.rejectSubmit = undefined;
    expect((await bookOf(t))!.sessions[0]!.txs.at(-1)).toMatchObject({ kind: "cancel", txHash: review.txHash, unsent: true });
    expect((await sessions.list("preprod", true))[0]!.cancelling).toBeUndefined();

    // Sent, and never seen on chain: on its way for 2 hours, as a copy given up is looked for, then no more.
    ({ t, sessions } = await foundOrder("1000000"));
    await putIn(t, sessions);
    review = await sessions.cancelBuild("preprod", 0);
    await sessions.txSubmit("preprod", review.txHash, "cancel");
    t.koios.missing.add(review.txHash);
    await busy(t, 2 * HOUR - MINUTE);
    expect((await sessions.list("preprod", true))[0]!.cancelling).toBe(true);
    await busy(t, 2 * MINUTE);
    [view] = await sessions.list("preprod", true);
    expect(view!.cancelling).toBeUndefined();
  });

  it("refuses 5 ₳ while its cancel is on its way: at Send for one built before, and for Lovejoin (C29, C53; cross-area review X13)", async () => {
    // 4.999999 ₳ of ADA alone: 5 ₳ is offered (C41), and the cancel puts that UTxO up all the same.
    let { t, sessions } = await foundOrder(undefined, [atSession("e3".repeat(32), 0, "4999999")]);
    const put = await sessions.cancelCollateralBuild("preprod", 0);
    let review = await sessions.cancelBuild("preprod", 0);
    await sessions.txSubmit("preprod", review.txHash, "cancel");
    await expect(sessions.topUpSubmit("preprod", put.txHash)).rejects.toThrow("The order's cancel is on its way, so it needs no 5 ₳.");
    expect(t.koios.submitted.map(txIdOf)).toEqual([review.txHash]);

    // Not for Lovejoin's collateral either: refused for the cancel, before the order it may yet leave open.
    ({ t, sessions } = await foundOrder(undefined, [atSession(SWAP_TX, 1, "131585414")]));
    review = await sessions.cancelBuild("preprod", 0);
    await sessions.txSubmit("preprod", review.txHash, "cancel");
    await expect(sessions.backCollateralBuild("preprod", 0)).rejects.toThrow("The order's cancel is on its way, so it needs no 5 ₳.");
  });

  it("counts 5 ₳ that landed and were spent since as gone, not on its way, and puts in another (C04)", async () => {
    const { t, sessions } = await foundOrder();
    const topUp = await putIn(t, sessions);
    // Spent with the order still open: the same phrase's other browser brought it back, say.
    t.koios.spent.add(topUp);
    await busy(t, 30 * MINUTE);
    expect((await sessions.list("preprod", true))[0]!.cancelCollateral).toBe("missing");
    const again = await sessions.cancelCollateralBuild("preprod", 0);
    expect(again.payments.map((p) => [p.address, p.lovelace])).toEqual([[sessionSwap.address, "5000000"]]);
  });

  it("waits for 5 ₳ tx_status shows on chain until a listing of the account shows it there: a backend behind (C04)", async () => {
    const { t, sessions } = await foundOrder();
    const put = await sessions.cancelCollateralBuild("preprod", 0);
    await sessions.topUpSubmit("preprod", put.txHash);
    t.koios.confirmations = 1;
    const [view] = await sessions.list("preprod", true);
    expect(view!.txs.at(-1)).toMatchObject({ kind: "out", txHash: put.txHash, confirmed: true });
    expect(view!.cancelCollateral).toBe("coming");
    await expect(sessions.cancelCollateralBuild("preprod", 0)).rejects.toThrow("The 5 ₳ for the cancel is on its way to the account.");
  });

  it("offers 5 ₳ where the account's ADA alone is each under 5 ₳, or holds tokens, and none over 5 ₳ or more (C41, C47)", async () => {
    for (const held of [
      atSession("e1".repeat(32), 0, "1500000"),
      atSession("e2".repeat(32), 0, "2000000"),
      atSession("e3".repeat(32), 0, "4999999"),
      atSession("e4".repeat(32), 0, "10000000", [[MIN, "1"]]),
    ]) {
      const { sessions } = await foundOrder(undefined, [held]);
      expect((await sessions.list("preprod", true))[0]!.cancelCollateral).toBe("missing");
      const put = await sessions.cancelCollateralBuild("preprod", 0);
      expect(put.payments.map((p) => [p.address, p.lovelace])).toEqual([[sessionSwap.address, "5000000"]]);
    }
    for (const value of ["5000000", "6000000"]) {
      const { t, sessions } = await foundOrder(undefined, [atSession("e5".repeat(32), 0, value)]);
      expect((await sessions.list("preprod", true))[0]!.cancelCollateral).toBeUndefined();
      await expect(sessions.cancelCollateralBuild("preprod", 0)).rejects.toThrow("The account already holds a UTxO of ADA alone");
      expect(t.koios.submitted).toEqual([]);
    }
  });

  it("offers 5 ₳ again once one sent hasn't landed in 2 hours, and at once when one was turned away (C41)", async () => {
    let { t, sessions } = await foundOrder();
    const put = await sessions.cancelCollateralBuild("preprod", 0);
    await sessions.topUpSubmit("preprod", put.txHash);
    expect((await sessions.list("preprod", true))[0]!.cancelCollateral).toBe("coming");
    await busy(t, 2 * HOUR - MINUTE);
    expect((await sessions.list("preprod", true))[0]!.cancelCollateral).toBe("coming");
    await expect(sessions.cancelCollateralBuild("preprod", 0)).rejects.toThrow("The 5 ₳ for the cancel is on its way to the account.");
    await busy(t, 2 * MINUTE);
    expect((await sessions.list("preprod", true))[0]!.cancelCollateral).toBe("missing");
    expect((await sessions.cancelCollateralBuild("preprod", 0)).payments.map((p) => p.lovelace)).toEqual(["5000000"]);

    ({ t, sessions } = await foundOrder());
    const refused = await sessions.cancelCollateralBuild("preprod", 0);
    t.koios.rejectSubmit = "BadInputsUTxO";
    await expect(sessions.topUpSubmit("preprod", refused.txHash)).rejects.toThrow();
    t.koios.rejectSubmit = undefined;
    expect((await bookOf(t))!.sessions[0]!.txs.at(-1)).toMatchObject({ kind: "out", txHash: refused.txHash, unsent: true });
    expect((await sessions.list("preprod", true))[0]!.cancelCollateral).toBe("missing");
    expect((await sessions.cancelCollateralBuild("preprod", 0)).payments.map((p) => p.lovelace)).toEqual(["5000000"]);
  });

  it("sends one 5 ₳ where another window built a second while the first was sent (1.5.0's release review, C29)", async () => {
    const { t, sessions } = await foundOrder();
    const a = await sessions.cancelCollateralBuild("preprod", 0);
    // Window B presses Put in 5 ₳ to cancel as window A presses Send: B reads the account until A's Send is done.
    let reached!: () => void;
    let release!: () => void;
    const hit = new Promise<void>((r) => (reached = r));
    const gate = new Promise<void>((r) => (release = r));
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (url.includes("/credential_utxos") && String(init.body).includes(sessionSwap.keyHash)) {
        t.koios.fetch = real;
        reached();
        await gate;
      }
      return real(url, init);
    };
    const building = sessions.cancelCollateralBuild("preprod", 0);
    await hit;
    await sessions.topUpSubmit("preprod", a.txHash);
    release();
    // B's review shows, from what it read before A's top-up was in the record; its Send goes no further.
    const b = await building;
    expect(b.txHash).not.toBe(a.txHash);
    await expect(sessions.topUpSubmit("preprod", b.txHash)).rejects.toThrow("Another 5 ₳ for this session is already on its way");
    expect(paidToSession(t)).toEqual([[5_000_000n]]);
  });

  it("puts in none for an order the wallet's own cancel can't spend, which no return would take back (1.5.0's release review, C30)", async () => {
    // A SundaeSwap V3 order made out to session 0 (the owner's stuck preprod order, seedelf-core's order_cancels.json),
    // its Swap details changed to a constructor V3's script can't decode: the reader calls it the session's, as a
    // swap from before 1.3.0 checked no more (release review C05), and the script refuses its cancel.
    const stuck = (
      JSON.parse(readFileSync(new URL("../../../seedelf-core/tests/fixtures/order_cancels.json", import.meta.url), "utf8")) as Array<{
        stuck?: boolean;
        order: KoiosUtxo & { inline_datum: { bytes: string } };
      }>
    ).find((f) => f.stuck)!.order;
    const V3_SCRIPT = "a989aa2fe6e3866688631162d8ccc830d39ce38b3f11acd3880c165f";
    const OWNER = { stake: "92dcefd51649d9b7a190f6700827d3265d52fb8bfb7fadcfd7a58dec", pay: "eb75b215293795911d97734c3a3901f0586395567380b1e8ddd2e76f" };
    const datum = stuck.inline_datum.bytes.replaceAll(OWNER.stake, SESSION_ADDRESS.slice(58)).replaceAll(OWNER.pay, sessionSwap.keyHash);
    for (const [details, cancels] of [
      [datum.replace("d87a9f9f581cf0f2", "d87f9f9f581cf0f2"), false],
      [datum, true],
    ] as const) {
      expect(details.includes("d87f9f9f581cf0f2")).toBe(!cancels);
      const t = await unlocked();
      const sessions = signing(t);
      await usedWith(t, 0, [
        [SWAP_TX, 5_000_100],
        [FUNDING_TX, 5_000_000],
      ]);
      t.koios.txSpends.set(SWAP_TX, [
        { payment_addr: { bech32: sessionSwap.address, cred: sessionSwap.keyHash }, tx_hash: FUNDING_TX, tx_index: sessionSwap.utxo.tx_index },
      ]);
      t.koios.txOutputs.set(SWAP_TX, [{ payment_addr: { bech32: stuck.address, cred: V3_SCRIPT }, tx_index: 0 }]);
      const token = stuck.asset_list![0]!;
      t.koios.addedToAccounts.push({
        ...atSession(SWAP_TX, 0, stuck.value, [[`${token.policy_id}${token.asset_name}`, token.quantity]]),
        address: stuck.address,
        payment_cred: V3_SCRIPT,
        inline_datum: { bytes: details, value: {} },
      });
      expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
      expect((await sessions.orders("preprod", 0)).map((o) => o.protocol)).toEqual(["SundaeSwapV3"]);
      if (cancels) {
        // Its own details: the cancel runs, and the 5 ₳ for it is built.
        expect((await sessions.cancelCollateralBuild("preprod", 0)).payments.map((p) => p.lovelace)).toEqual(["5000000"]);
        continue;
      }
      // Its cancel run first, against a stand-in 5 ₳: refused in the cancel's own words, and nothing paid.
      await expect(sessions.cancelCollateralBuild("preprod", 0)).rejects.toThrow(
        "The wallet couldn't cancel the order: the DEX's order script refused the wallet's cancel",
      );
      expect(t.koios.submitted).toEqual([]);
    }
  });

  it("takes the session's own private money for the 5 ₳ first, which after a restore no history names (1.5.0's release review, C36)", async () => {
    // What its funding left in the private balance, and what a transaction its key signed paid there: each 10 ₳ beside
    // the private balance's 25 ₳ of other origin, which the CLI's order would take first, the largest.
    for (const own of [`${FUNDING_TX}#7`, `${SWAP_TX}#3`]) {
      const t = await unlocked();
      const sessions = signing(t);
      await usedWith(t, 0, [
        [SWAP_TX, 5_000_100],
        [FUNDING_TX, 5_000_000],
      ]);
      swapped(t);
      t.koios.addedToAccounts.push(orderRow(SWAP_TX));
      const [tx, index] = own.split("#") as [string, string];
      const change = { ...ownedUtxos[0]!, tx_hash: tx, tx_index: Number(index), value: "10000000" };
      t.koios.added.push(change);
      // The restore's first reading of the private balance: everything held, no history known.
      await t.activity.arrived("preprod", [...ownedUtxos, change]);
      expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
      const put = await sessions.cancelCollateralBuild("preprod", 0);
      await sessions.topUpSubmit("preprod", put.txHash);
      expect(txInputs(t.koios.submitted.at(-1)!)).toEqual([own]);
      // The session's own: nothing new tied, so the review names no other history.
      expect(put.histories).toEqual([{ id: "session:0", origin: "session" }]);
    }
  });
});

describe("a found session's 5 ₳ for its return through Lovejoin (1.5.0's release review, C53)", () => {
  const POOL = (
    JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
  ).pool;
  /** Ogmios agrees with every evaluation: the mixes' scripts run as their budgets say. */
  const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
  /** What reached the account after its return took everything, its collateral too: a site's refund, say. */
  const REFUND_TX = "e7".repeat(32);
  /** Building a chain runs the scripts of every mix in it. */
  const CHAINS = { timeout: 300_000 };

  /** Found session 0, holding `held`, with Lovejoin wired in as the worker has it and its pool listed. */
  async function foundHolding(held: KoiosUtxo[], order = false) {
    const t = await unlocked();
    t.koios.evaluation = AGREES;
    const sessions = signing(t, { lovejoin: t.lovejoin, sleep: async () => undefined });
    await usedWith(t, 0, [
      [order ? SWAP_TX : REFUND_TX, 5_000_100],
      [FUNDING_TX, 5_000_000],
    ]);
    if (order) swapped(t);
    t.koios.addedToAccounts.push(...held, ...(order ? [orderRow(SWAP_TX)] : []), ...POOL);
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    return { t, sessions };
  }

  it("puts 5 ₳ in where its account holds none the mixes can put up, and its return then goes through Lovejoin", CHAINS, async () => {
    const { t, sessions } = await foundHolding([atSession(REFUND_TX, 0, "40000000")]);
    // As it is, its return leaves Lovejoin out for want of the collateral alone, and says so.
    const direct = await sessions.backBuild("preprod", 0);
    expect(direct.lovejoin).toBeUndefined();
    expect(direct.lovejoinSkipped).toMatch(/collateral isn.t at its account anymore/);
    expect((await sessions.list("preprod", true))[0]!.backCollateral).toBe("missing");

    // 5 ₳ from the private balance, to the account alone, sent as a top-up is.
    const put = await sessions.backCollateralBuild("preprod", 0);
    expect(put.payments.map((p) => [p.address, p.lovelace, p.tokens.length])).toEqual([[sessionSwap.address, "5000000", 0]]);
    await sessions.topUpSubmit("preprod", put.txHash);
    expect((await sessions.list("preprod", true))[0]!.backCollateral).toBe("coming");
    await expect(sessions.backCollateralBuild("preprod", 0)).rejects.toThrow("The 5 ₳ for Lovejoin's collateral is on its way");
    // Brought back before it's there, the return comes back directly, and says the 5 ₳ wasn't there yet rather than
    // gone; so does Bring everything back's (cross-area review X20). In the past tense: the reason is saved with the
    // session and shown after the 5 ₳ has landed, in its page's "Lovejoin was left out of its return: …" (the last
    // review, L9).
    const early = await sessions.backBuild("preprod", 0);
    expect(early.lovejoin).toBeUndefined();
    expect(early.lovejoinSkipped).toMatch(/^the 5 ₳ you put in for its collateral wasn.t at its account yet, and the mixes need it$/);
    expect((await sessions.claimBuild("preprod", [0])).returns[0]!.lovejoinSkipped).toBe(early.lovejoinSkipped);

    // There: nothing more to put in, and the return goes through Lovejoin on it.
    const i = builtOutputs(t.koios.submitted.at(-1)!).findIndex((o) => o.address.slice(2, 58) === sessionSwap.keyHash);
    t.koios.addedToAccounts.push(atSession(put.txHash, i, "5000000"));
    expect((await sessions.list("preprod", true))[0]!.backCollateral).toBeUndefined();
    const through = await sessions.backBuild("preprod", 0);
    expect(through.lovejoinSkipped).toBeUndefined();
    expect(through.lovejoin!.boxes).toBeGreaterThan(0);
  });

  it("puts none in where its return wouldn't take it, an order of it waits, or for a site's session", CHAINS, async () => {
    const refused = async (sessions: SessionService, words: string) => {
      expect((await sessions.list("preprod", true))[0]!.backCollateral).toBeUndefined();
      await expect(sessions.backCollateralBuild("preprod", 0)).rejects.toThrow(words);
    };
    // Settings brings returns back directly.
    let { t, sessions } = await foundHolding([atSession(REFUND_TX, 0, "40000000")]);
    await t.deps.preferences.set({ lovejoinReturns: false });
    await refused(sessions, "Its return needs no 5 ₳");
    // Spare ADA that pays for no box: it comes back directly whatever's at the account.
    ({ t, sessions } = await foundHolding([atSession(REFUND_TX, 0, "10000000")]));
    await refused(sessions, "Its return needs no 5 ₳");
    // Its 5 ₳ there already.
    ({ t, sessions } = await foundHolding([atSession(REFUND_TX, 0, "40000000"), atSession("d4".repeat(32), 0, "5000000")]));
    await refused(sessions, "The account already holds a UTxO of exactly 5 ₳ of ADA alone");
    expect(t.koios.submitted).toEqual([]);

    // An order of it waits: its cancel comes first, then the 5 ₳ for the return, once the order is spent.
    ({ t, sessions } = await foundHolding([atSession(SWAP_TX, 1, "131585414")], true));
    expect((await sessions.list("preprod", true))[0]!.backCollateral).toBe("missing");
    await expect(sessions.backCollateralBuild("preprod", 0)).rejects.toThrow("An order of this session is still waiting.");
    t.koios.spent.add(`${SWAP_TX}#0`);
    expect((await sessions.backCollateralBuild("preprod", 0)).payments.map((p) => p.lovelace)).toEqual(["5000000"]);

    // A site's session takes a top-up of its own instead.
    ({ t, sessions } = await foundHolding([atSession(REFUND_TX, 0, "40000000")]));
    const book = (await bookOf(t))!;
    await t.store.set("sessions.preprod", { ...book, sessions: [{ ...book.sessions[0]!, recovered: undefined, site: { origin: "https://a.example" } }] });
    await expect(sessions.backCollateralBuild("preprod", 0)).rejects.toThrow("Only a session you bring back by hand takes 5 ₳ for its return");
  });
});
