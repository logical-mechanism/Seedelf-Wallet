// A restored wallet's Lovejoin boxes (independent review M14, the owner's
// option C). A restore (Remove wallet then the same phrase, Forgot password,
// another browser or device) has none of the sealed chain records that say
// which boxes aren't mixed yet or came from the public account. So a box no
// record accounts for, found when more boxes could come back than there are
// due times, is known by the transaction that made it (Koios's tx_info, with
// its inputs), asked once, and kept, sealed, by that transaction:
//   an input at mix_box    a mix made it: it comes back by itself
//   none                   a deposit made it: not mixed yet, held
//   the account's key      the public account's (fromPublic)
//   Koios can't say        held, and asked again at a later pool read
// A wallet in its steady state asks Koios nothing new.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { Koios, TXS_PER_REQUEST, type FetchLike, type KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { NETWORKS } from "../src/networks";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinHeld } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { InLovejoin } from "../src/ui/screens/Home";
import { anywayBox, NotMixed } from "../src/ui/screens/Lovejoin";
import { account, AGREES, atSession, CHAINS, HOUR, PASSWORD, POOL, publicFunded, withSession, type Tested } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";
import { busyFor, loadTestWasm, sessionSwap, testBalances, withdrawPreprod } from "./fakes";

const MIX_BOX = NETWORKS.preprod.lovejoin!.mixBox;
const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));

/** A box in Lovejoin's pool that the wallet's Seedelf key owns, at `tx#txIndex`. */
async function ownedBox(t: Tested, tx: string, txIndex = 0): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  return { ...POOL[0]!, tx_hash: hash(tx), tx_index: txIndex, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
}

/** Where a transaction's inputs sat, as tx_info lists them. */
const input = (cred: string | undefined, bech32 = "addr_test1") => ({ payment_addr: cred === undefined ? { bech32 } : { bech32, cred } });
/** A mix: a box spent at mix_box, and whoever paid for it. */
const mix = (payer = sessionSwap.keyHash) => [input(MIX_BOX, POOL[0]!.address), input(payer)];
/** A deposit from a private session's one-time account. */
const sessionDeposit = () => [input(sessionSwap.keyHash, sessionSwap.address)];
/** A deposit from the public account: its payment key's UTxO. */
const accountDeposit = async (t: Tested) => [input(await t.wallet.withKeys((k) => k.cardano.paymentKeyHash(0, 0)))];

/** Every tx_info request Koios was asked, the hashes each asked for. */
const txInfoAsked = (t: Tested) => t.koios.calls.filter((c) => c.path === "tx_info").map((c) => [...(c.body._tx_hashes as string[])].sort());

/** Lovejoin with giveme.my's witness stood in for: its recorded answer is another transaction's. */
function witnessed(t: Tested) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
  });
}

/** The boxes a withdraw giveme.my was asked about spends. */
const withdrawn = (t: Tested) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));

/** The alarm's runs for `hours`, two hours apart, each withdraw landing before the next: what came back. */
async function runsFor(t: Tested, lovejoin: LovejoinService, hours: number): Promise<string[]> {
  for (let run = 0; run * 2 < hours; run++) {
    await lovejoin.withdrawDue("preprod", run === 0);
    for (const o of withdrawn(t)) t.koios.spent.add(o);
    await busyFor(t, 2 * HOUR);
  }
  return withdrawn(t);
}

/** What the sealed schedule keeps of what made each box, by transaction. */
const origins = async (t: Tested) =>
  (await t.store.get<{ origins?: Record<string, { mixed: boolean; public?: true; seen: number }> }>("lovejoin.preprod"))?.origins;

/** Koios's tx_info fails with a 500 while `down.on`, and is counted. */
function flakyTxInfo(t: Tested) {
  const down = { on: true, asked: 0 };
  const fetch = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    if (url.includes("/tx_info")) {
      down.asked++;
      if (down.on) return new Response("upstream", { status: 500 });
    }
    return fetch(url, init);
  };
  return down;
}

describe("a restore's Lovejoin boxes (independent review M14)", CHAINS, () => {
  it("never brings back by itself the boxes a mix from the public account cut after its deposit left, after Remove wallet and the same phrase restored", async () => {
    const t = await publicFunded();
    // The mix was cut after its deposit: both its boxes are still the deposit's, which the account paid.
    const D = "d9".repeat(32);
    const cut = {
      id: "a9".repeat(32),
      progress: "seedelf.lovejoin.sending.preprod",
      deposit: D,
      mixes: ["a8".repeat(32), "a9".repeat(32)],
      leaves: [
        { txHash: "a8".repeat(32), txIndex: 0 },
        { txHash: "a9".repeat(32), txIndex: 0 },
      ],
      boxes: 2,
      total: 3,
      sent: 1,
      at: t.clock.now - 2 * HOUR,
      scheduled: true,
      stopped: "The wallet locked, or the browser closed, while its chain was being sent.",
      ended: t.clock.now - 2 * HOUR,
    };
    t.koios.addedToAccounts.push(await ownedBox(t, D, 0), await ownedBox(t, D, 1));
    t.koios.txSpends.set(D, await accountDeposit(t));
    await t.store.set("lovejoin.preprod", { due: [], chains: [cut] });
    const before = await t.lovejoin.status("preprod");
    expect(before).toMatchObject({ notMixed: [{ txHash: D, txIndex: 0 }, { txHash: D, txIndex: 1 }], due: [] });
    expect(before.fromPublic).toEqual(before.notMixed);
    // The records hold the answer: Koios isn't asked.
    expect(txInfoAsked(t)).toEqual([]);

    // Remove wallet, then the same phrase: the sealed records are gone.
    await t.wallet.reset();
    await t.wallet.create(account(12).phrase, PASSWORD);
    expect(await t.store.get("lovejoin.preprod")).toBeUndefined();

    // The tile opens: Koios says a deposit from the public account made them. Held, not mixed yet, and the account's.
    const after = await t.lovejoin.status("preprod");
    expect(after.notMixed).toEqual(before.notMixed);
    expect(after.fromPublic).toEqual(before.notMixed);
    expect(after.due).toEqual([]);
    expect(after.unsure).toBeUndefined();
    expect(txInfoAsked(t)).toEqual([[D]]);
    expect(await t.lovejoin.held("preprod")).toMatchObject({ boxes: 0, notMixed: 2 });
    // The private balance never pays to mix them unless asked (privacy review §2.10); the public account may.
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("came from a mix from your public account");
    expect(await t.lovejoin.againBoxes("preprod", true)).toEqual({ boxes: 2, owned: 2 });

    // No run brings either back by itself; bringing one back takes the warning's yes.
    const lovejoin = witnessed(t);
    expect(await runsFor(t, lovejoin, 16)).toEqual([]);
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow("weren't mixed yet");
    await expect(lovejoin.withdrawNow("preprod", { txHash: D, txIndex: 0 })).rejects.toThrow("wasn't mixed");
    await lovejoin.withdrawNow("preprod", { txHash: D, txIndex: 0 }, true);
    expect(withdrawn(t)).toEqual([`${D}#0`]);
    // Asked once all along.
    expect(txInfoAsked(t)).toEqual([[D]]);
  });

  it("brings back by itself a box a mix made, someone else's included, and holds one a session's deposit made for Mix my boxes again", async () => {
    const { t } = await withSession("40000000");
    const [M, S] = [hash("b1"), hash("c3")];
    t.koios.addedToAccounts.push(await ownedBox(t, M), await ownedBox(t, S));
    // Someone else's mix moved one; the other is still where a cut chain's deposit put it.
    t.koios.txSpends.set(M, mix("ee".repeat(28)));
    t.koios.txSpends.set(S, sessionDeposit());
    const status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toEqual([{ txHash: S, txIndex: 0 }]);
    expect(status.fromPublic).toEqual([]);
    // One due time: the mixed box's.
    expect(status.due).toHaveLength(1);
    expect(await origins(t)).toEqual({ [M]: { mixed: true, seen: t.clock.now }, [S]: { mixed: false, seen: t.clock.now } });
    // Mix my boxes again takes both, from the private balance: the deposit was a session's, not the account's.
    expect(await t.lovejoin.againBoxes("preprod")).toEqual({ boxes: 2, owned: 2 });

    const lovejoin = witnessed(t);
    expect(await runsFor(t, lovejoin, 16)).toEqual([`${M}#0`]);
    await expect(lovejoin.withdrawNow("preprod", { txHash: S, txIndex: 0 })).rejects.toThrow("wasn't mixed");
    expect(txInfoAsked(t)).toEqual([[M, S].sort()]);
  });

  it("counts a box a mix from the public account made as mixed, and as the account's", async () => {
    const t = await publicFunded();
    const P = hash("b2");
    t.koios.addedToAccounts.push(await ownedBox(t, P));
    // Paid from the account's key; its box input read from its address alone, as a Koios without `cred` gives it.
    const key = await t.wallet.withKeys((k) => k.cardano.paymentKeyHash(0, 0));
    t.koios.txSpends.set(P, [input(undefined, POOL[0]!.address), input(key)]);
    const status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toEqual([]);
    expect(status.fromPublic).toEqual([{ txHash: P, txIndex: 0 }]);
    expect(status.due).toHaveLength(1);
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("came from a mix from your public account");
  });

  it("holds every box while Koios doesn't say what made it, and asks again at the next pool read", async () => {
    const { t } = await withSession("40000000");
    const [M, S] = [hash("b4"), hash("c4")];
    t.koios.addedToAccounts.push(await ownedBox(t, M), await ownedBox(t, S));
    t.koios.txSpends.set(M, mix());
    t.koios.txSpends.set(S, sessionDeposit());
    const koios = flakyTxInfo(t);

    // Koios fails: both are held, listed as not mixed yet and unsure, and nothing is due or kept.
    const down = await t.lovejoin.status("preprod");
    expect(down.notMixed.map((b) => b.txHash).sort()).toEqual([M, S].sort());
    expect(down.unsure).toEqual(down.notMixed);
    expect(down.due).toEqual([]);
    expect(await origins(t)).toBeUndefined();
    // Home counts them as not on their way back, so the unlock's run reads the pool again.
    expect(await t.lovejoin.held("preprod")).toMatchObject({ boxes: 0, notMixed: 2 });
    const lovejoin = witnessed(t);
    await expect(lovejoin.withdrawNow("preprod", { txHash: M, txIndex: 0 })).rejects.toThrow("Koios hasn't said how that box went into the pool");
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow("Koios hasn't said yet how your boxes went into Lovejoin's pool");
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("Koios hasn't said how some of your boxes went into Lovejoin's pool");
    // The unlock's run reads the pool, the boxes being open in Lovejoin, and asks again.
    const tried = koios.asked;
    expect(await runsFor(t, lovejoin, 4)).toEqual([]);
    expect(t.collateral.asked).toEqual([]);
    expect(koios.asked).toBeGreaterThan(tried);

    // Koios answers at a later read: the mixed box is scheduled, the deposit's held.
    koios.on = false;
    const up = await t.lovejoin.status("preprod");
    expect(up.notMixed).toEqual([{ txHash: S, txIndex: 0 }]);
    expect(up.unsure).toBeUndefined();
    expect(up.due).toHaveLength(1);
    // And never again for either.
    const asked = koios.asked;
    await t.lovejoin.status("preprod");
    await t.lovejoin.againBoxes("preprod");
    expect(koios.asked).toBe(asked);
  });

  it("holds a box whose transaction Koios doesn't know, and asks of it alone again", async () => {
    const { t } = await withSession("40000000");
    const [M, N] = [hash("b5"), hash("c5")];
    t.koios.addedToAccounts.push(await ownedBox(t, M), await ownedBox(t, N));
    t.koios.txSpends.set(M, mix());
    const first = await t.lovejoin.status("preprod");
    expect(first.unsure).toEqual([{ txHash: N, txIndex: 0 }]);
    expect(first.notMixed).toEqual([{ txHash: N, txIndex: 0 }]);
    expect(first.due).toHaveLength(1);
    // Koios catches up: only the one it didn't know is asked of.
    t.koios.txSpends.set(N, mix());
    const second = await t.lovejoin.status("preprod");
    expect(second.notMixed).toEqual([]);
    expect(second.due).toHaveLength(2);
    expect(txInfoAsked(t)).toEqual([[M, N].sort(), [N]]);
  });

  it("asks once for the transactions of every box found, however many boxes one made or reads come at once", async () => {
    const { t } = await withSession("40000000");
    const [A, B] = [hash("b6"), hash("c6")];
    t.koios.addedToAccounts.push(await ownedBox(t, A, 0), await ownedBox(t, A, 1), await ownedBox(t, A, 2), await ownedBox(t, B));
    t.koios.txSpends.set(A, mix());
    t.koios.txSpends.set(B, mix());
    // The page and the alarm read the pool at once: one request, for the two transactions.
    const [one, two] = await Promise.all([t.lovejoin.status("preprod"), t.lovejoin.status("preprod")]);
    expect(txInfoAsked(t)).toEqual([[A, B].sort()]);
    expect(one.notMixed).toEqual([]);
    expect(two.notMixed).toEqual([]);
    expect((await t.lovejoin.held("preprod")).boxes).toBe(4);
  });

  it("asks Koios nothing new in its steady state: a due time for each box that can come back", async () => {
    const { t } = await withSession("40000000");
    // Two boxes other people's mixes moved since, no record of them left, and their due times.
    t.koios.addedToAccounts.push(await ownedBox(t, "b7"), await ownedBox(t, "c7"));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR, t.clock.now + 2 * HOUR], chains: [] });
    await t.lovejoin.status("preprod");
    await t.lovejoin.withdrawDue("preprod", true);
    await t.lovejoin.againBoxes("preprod");
    expect(txInfoAsked(t)).toEqual([]);
    expect(await origins(t)).toBeUndefined();
    // A third turns up with no due time (a restore elsewhere, say): only then is Koios asked, of them all, once.
    t.koios.addedToAccounts.push(await ownedBox(t, "d7"));
    for (const tx of ["b7", "c7", "d7"]) t.koios.txSpends.set(hash(tx), mix());
    await t.lovejoin.status("preprod");
    await t.lovejoin.status("preprod");
    expect(txInfoAsked(t)).toEqual([["b7", "c7", "d7"].map(hash).sort()]);
    expect((await t.lovejoin.held("preprod")).boxes).toBe(3);
  });

  it("keeps what Koios said while a read lists the box, and lets it go a while after the box left", async () => {
    const { t } = await withSession("40000000");
    const S = hash("c8");
    t.koios.addedToAccounts.push(await ownedBox(t, S));
    t.koios.txSpends.set(S, sessionDeposit());
    await t.lovejoin.status("preprod");
    expect(Object.keys((await origins(t))!)).toEqual([S]);
    // A read that doesn't list it (a Koios backend behind, or the box gone): kept for now.
    t.koios.spent.add(`${S}#0`);
    await busyFor(t, HOUR);
    await t.lovejoin.status("preprod");
    expect(Object.keys((await origins(t))!)).toEqual([S]);
    // Hours on, it's still gone: it goes too.
    await busyFor(t, 3 * HOUR);
    await t.lovejoin.status("preprod");
    expect(await origins(t)).toBeUndefined();
  });

  it("keeps nothing Koios said when the wallet locks while it answers, and asks again once it's unlocked", async () => {
    const { t } = await withSession("40000000");
    const S = hash("c9");
    t.koios.addedToAccounts.push(await ownedBox(t, S));
    t.koios.txSpends.set(S, sessionDeposit());
    const fetch = t.koios.fetch;
    let lockFirst = true;
    t.koios.fetch = async (url, init) => {
      if (url.includes("/tx_info") && lockFirst) {
        lockFirst = false;
        await t.wallet.lock();
      }
      return fetch(url, init);
    };
    await expect(t.lovejoin.status("preprod")).rejects.toThrow();
    await t.wallet.unlock(PASSWORD);
    expect(await origins(t)).toBeUndefined();
    const status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toEqual([{ txHash: S, txIndex: 0 }]);
    expect(status.due).toEqual([]);
    expect(txInfoAsked(t)).toEqual([[S], [S]]);
  });

  it("mixes again from the private balance a session deposit's box first, and leaves the public account's out (privacy review §2.10)", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const spend = withdrawPreprod.amount.evaluation as { result: unknown[] };
    t.koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
      body.params.additionalUtxo ? AGREES : { ...spend, result: spend.result.slice(0, 1) };
    // Ten others' boxes: two waves deep, one box of the wallet's is mixed again at a time.
    t.koios.addedToAccounts.push(...POOL.slice(0, 10));
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const [D, S, M] = [hash("d1"), hash("c1"), hash("b1")];
    t.koios.addedToAccounts.push(await ownedBox(t, M), await ownedBox(t, D, 1), await ownedBox(t, S));
    t.koios.txSpends.set(D, await accountDeposit(t));
    t.koios.txSpends.set(S, sessionDeposit());
    t.koios.txSpends.set(M, mix());
    const wasm = loadTestWasm();
    const collateral = () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch);
    const lovejoin: LovejoinService = new LovejoinService({
      ...t.deps,
      collateral,
      store: t.store,
      mixingAgain: (network) => sessions.mixingAgain(network),
    });
    const sessions: SessionService = new SessionService({
      ...t.deps,
      // giveme.my's witness and the one-time key's signature stood in for, as sessions.test.ts does.
      wasm: {
        ...wasm,
        signScriptSpend: (_key: unknown, request: string) => {
          const { txCbor } = JSON.parse(request) as { txCbor: string };
          return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
        },
      } as typeof wasm,
      collateral,
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin,
      sleep: async () => undefined,
    });
    const status = await lovejoin.status("preprod");
    expect(status.notMixed.map((b) => b.txHash).sort()).toEqual([D, S].sort());
    expect(status.fromPublic).toEqual([{ txHash: D, txIndex: 1 }]);

    // From the private balance: the session deposit's box and the mixed one, never the account's.
    const out = await sessions.againBuild("preprod");
    expect(out.mix).toMatchObject({ boxes: 1, again: true, owned: 2 });
    await sessions.mixOutSubmit("preprod", out.txHash);
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    t.koios.evaluation = AGREES;
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", 0, true);
    const spent = t.koios.submitted.slice(before).flatMap((tx) => txInputs(tx));
    // The one not mixed yet goes first.
    expect(spent).toContain(`${S}#0`);
    expect(spent).not.toContain(`${M}#0`);
    expect(spent).not.toContain(`${D}#1`);
  });

  it("keeps each network's answers to itself", async () => {
    const { t } = await withSession("40000000");
    const M = hash("ba");
    t.koios.addedToAccounts.push(await ownedBox(t, M));
    t.koios.txSpends.set(M, mix());
    await t.lovejoin.status("preprod");
    expect(Object.keys((await origins(t))!)).toEqual([M]);
    expect(await t.store.get("lovejoin.mainnet")).toBeUndefined();
  });

  it("asks again of a box Koios didn't answer for at each pool read, however many due times are left over, and never brings it back meanwhile", async () => {
    const { t } = await withSession("40000000");
    const [M, N] = [hash("bb"), hash("cb")];
    t.koios.addedToAccounts.push(await ownedBox(t, M), await ownedBox(t, N));
    // Koios knows a mix made M, and not yet what made N.
    t.koios.txSpends.set(M, mix());
    const first = await t.lovejoin.status("preprod");
    expect(first.unsure).toEqual([{ txHash: N, txIndex: 0 }]);
    expect(first.due).toHaveLength(1);
    expect((await asking(t))?.[N]).toBe(t.clock.now);

    // Mix my boxes again takes M: its first mix goes, taking M's due time and setting one afresh, and a lock cuts the
    // rest. Its box waits, not mixed yet, and the due time is left over: as many as the boxes that could come back.
    const [X, Y] = [hash("eb"), hash("fb")];
    const txs = [X, Y].map((txHash) => ({ kind: "mix" as const, txHash, txCbor: "", fee: "0" }));
    const leaves = [{ txHash: Y, txIndex: 0 }];
    await t.lovejoin.recordChain("preprod", { session: 0, progress: "seedelf.lovejoin.test", txs, leaves, boxes: 1, again: true });
    await t.lovejoin.chainSent("preprod", Y, 0);
    t.koios.spent.add(`${M}#0`);
    t.koios.addedToAccounts.push(await ownedBox(t, X));
    expect(await t.store.get<{ due: number[] }>("lovejoin.preprod")).toMatchObject({ due: [expect.any(Number)] });

    // Koios still doesn't know N: asked of again all the same, and held.
    const second = await t.lovejoin.status("preprod");
    expect(txInfoAsked(t)).toEqual([[M, N].sort(), [N]]);
    expect(second.unsure).toEqual([{ txHash: N, txIndex: 0 }]);
    expect(second.notMixed).toEqual([
      { txHash: X, txIndex: 0 },
      { txHash: N, txIndex: 0 },
    ]);
    expect(second.due).toEqual([]);
    expect(await t.lovejoin.held("preprod")).toMatchObject({ boxes: 0, notMixed: 2, unsure: 1 });
    // Nothing comes back by itself, nor as the box that has waited longest.
    const lovejoin = witnessed(t);
    expect(await runsFor(t, lovejoin, 16)).toEqual([]);
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow("weren't mixed yet");
    await expect(lovejoin.withdrawNow("preprod", { txHash: N, txIndex: 0 })).rejects.toThrow("Koios hasn't said how that box went into the pool");

    // Koios catches up: a session's deposit made N. Held, as not mixed yet, and never asked of again.
    t.koios.txSpends.set(N, sessionDeposit());
    const third = await t.lovejoin.status("preprod");
    expect(third.unsure).toBeUndefined();
    expect(third.notMixed).toEqual(second.notMixed);
    expect(third.due).toEqual([]);
    expect(await asking(t)).toBeUndefined();
    const asked = txInfoAsked(t).length;
    await t.lovejoin.status("preprod");
    expect(txInfoAsked(t)).toHaveLength(asked);
    expect(await runsFor(t, lovejoin, 16)).toEqual([]);
  });

  it("lets a transaction still asked of go a while after its box left the pool", async () => {
    const { t } = await withSession("40000000");
    const N = hash("cf");
    t.koios.addedToAccounts.push(await ownedBox(t, N));
    await t.lovejoin.status("preprod");
    expect(Object.keys((await asking(t))!)).toEqual([N]);
    // Gone from a read (a Koios backend behind, or the box gone): kept for now, and not asked of while it's unlisted.
    t.koios.spent.add(`${N}#0`);
    await busyFor(t, HOUR);
    await t.lovejoin.status("preprod");
    expect(Object.keys((await asking(t))!)).toEqual([N]);
    await busyFor(t, 3 * HOUR);
    await t.lovejoin.status("preprod");
    expect(await asking(t)).toBeUndefined();
    expect(txInfoAsked(t)).toEqual([[N]]);
  });

  it("looks up a box no record accounts for while a chain of the wallet's is being sent, as after a restore a swap's return went in first", async () => {
    const t = await publicFunded();
    // A box the public account's deposit made, before the wallet was restored.
    const P = hash("bc");
    t.koios.addedToAccounts.push(await ownedBox(t, P));
    t.koios.txSpends.set(P, await accountDeposit(t));
    // A swap's return goes through Lovejoin before the tile ever opened: its deposit is in, and its two boxes' due times set.
    const key = "seedelf.lovejoin.test";
    const D = await sendingChain(t, key, "c");
    const status = await t.lovejoin.status("preprod");
    expect(txInfoAsked(t)).toEqual([[P]]);
    // The account's, and not mixed yet: the private balance never pays to mix it unless asked (privacy review §2.10).
    expect(status.fromPublic).toEqual([{ txHash: P, txIndex: 0 }]);
    expect(status.notMixed).toEqual([{ txHash: P, txIndex: 0 }]);
    expect(status.boxes).toEqual(expect.arrayContaining([{ txHash: D, txIndex: 0 }]));
    expect(status.due).toHaveLength(2);
  });

  it("asks nothing while a chain is sent in the steady state: a box someone else's mix moved has its due time", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "bd"));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR], chains: [] });
    await sendingChain(t, "seedelf.lovejoin.test", "d");
    const status = await t.lovejoin.status("preprod");
    expect(status.due).toHaveLength(3);
    expect(status.notMixed).toEqual([]);
    expect(txInfoAsked(t)).toEqual([]);
  });

  it("counts a deposit paid from the account's address past the first twenty as the account's, by the stake key it carries", async () => {
    const t = await publicFunded();
    const P = hash("be");
    t.koios.addedToAccounts.push(await ownedBox(t, P));
    // No balance reading has found that address: its payment key alone isn't known.
    const far = await t.wallet.withKeys((k) => ({
      bech32: k.cardano.receiveAddress(t.deps.wasm.Network.Preprod, 40),
      cred: k.cardano.paymentKeyHash(0, 40),
    }));
    t.koios.txSpends.set(P, [{ payment_addr: far }]);
    const status = await t.lovejoin.status("preprod");
    expect(status.fromPublic).toEqual([{ txHash: P, txIndex: 0 }]);
    expect(status.notMixed).toEqual([{ txHash: P, txIndex: 0 }]);
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("came from a mix from your public account");
    expect(await origins(t)).toEqual({ [P]: { mixed: false, public: true, seen: t.clock.now } });
  });

  it("leaves a box Koios is still asked of out of a mix again from the private balance: it may be the account's (privacy review §2.10)", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const { lovejoin, sessions } = againRunner(t);
    const [N, M] = [hash("bf"), hash("cf")];
    // Listed first, N is the box the mix would take.
    t.koios.addedToAccounts.push(await ownedBox(t, N), await ownedBox(t, M));
    t.koios.txSpends.set(N, mix());
    t.koios.txSpends.set(M, mix());
    const out = await sessions.againBuild("preprod");
    expect(out.mix).toMatchObject({ boxes: 1, again: true, owned: 2 });
    await sessions.mixOutSubmit("preprod", out.txHash);
    // Before the mix is built, a read left N's making asked of, and Koios doesn't answer for it (as it might after a restore).
    const kept = (await t.store.get<{ origins: Record<string, unknown> }>("lovejoin.preprod"))!;
    delete kept.origins[N];
    await t.store.set("lovejoin.preprod", { ...kept, asking: { [N]: t.clock.now } });
    t.koios.txSpends.delete(N);
    expect((await lovejoin.status("preprod")).unsure).toEqual([{ txHash: N, txIndex: 0 }]);
    const spent = await advanceAgain(t, sessions, out);
    expect(spent).toContain(`${M}#0`);
    expect(spent).not.toContain(`${N}#0`);
  });
});

/** What the sealed schedule keeps of the transactions still asked of. */
const asking = async (t: Tested) => (await t.store.get<{ asking?: Record<string, number> }>("lovejoin.preprod"))?.asking;

/**
 * A session's chain being sent through Lovejoin, recorded and its progress
 * where it waits: its deposit is in (two boxes, listed, their due times
 * set), its mixes not yet. Returns its deposit's hash.
 */
async function sendingChain(t: Tested, key: string, tag: string): Promise<string> {
  const [D, A, B] = ["d", "a", "e"].map((h) => hash(h + tag));
  const txs = [
    { kind: "deposit" as const, txHash: D!, txCbor: "", fee: "0" },
    { kind: "mix" as const, txHash: A!, txCbor: "", fee: "0" },
    { kind: "mix" as const, txHash: B!, txCbor: "", fee: "0" },
  ];
  const leaves = [0, 1].map((txIndex) => ({ txHash: B!, txIndex }));
  await t.lovejoin.recordChain("preprod", { session: 0, progress: key, txs, leaves, boxes: 2 });
  await t.wallet.withKeys(() => t.session.set(key, { txs, next: 1, flying: [] }));
  await t.lovejoin.chainSent("preprod", B!, 0);
  t.koios.addedToAccounts.push(await ownedBox(t, D!, 0), await ownedBox(t, D!, 1));
  return D!;
}

/** Lovejoin and the sessions that mix the wallet's boxes again, with ten others' boxes in the pool (as sessions.test.ts has them). */
function againRunner(t: Tested) {
  const spend = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
    body.params.additionalUtxo ? AGREES : { ...spend, result: spend.result.slice(0, 1) };
  // Ten others' boxes: two waves deep, one box of the wallet's is mixed again at a time.
  t.koios.addedToAccounts.push(...POOL.slice(0, 10));
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const wasm = loadTestWasm();
  const collateral = () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch);
  const lovejoin: LovejoinService = new LovejoinService({
    ...t.deps,
    collateral,
    store: t.store,
    mixingAgain: (network) => sessions.mixingAgain(network),
  });
  const sessions: SessionService = new SessionService({
    ...t.deps,
    // giveme.my's witness and the one-time key's signature stood in for, as sessions.test.ts does.
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral,
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin,
    sleep: async () => undefined,
  });
  return { lovejoin, sessions };
}

/** The mix session's funding lands, and its chain is built and sent: the outpoints its transactions spend. */
async function advanceAgain(t: Tested, sessions: SessionService, out: { txHash: string; mix: { lovelace: string } }): Promise<string[]> {
  t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace), atSession(out.txHash, 1, "5000000"));
  t.koios.confirmations = 1;
  t.koios.evaluation = AGREES;
  const before = t.koios.submitted.length;
  await sessions.advance("preprod", 0, true);
  return t.koios.submitted.slice(before).flatMap((tx) => txInputs(tx));
}

describe("Koios's tx_info for what a transaction spent", () => {
  it("asks for the inputs alone, 20 transactions a request", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      return Response.json(body._tx_hashes.map((tx_hash: string) => ({ tx_hash, inputs: [] })));
    };
    const koios = new Koios("https://preprod.koios.rest/api/v1", fetchFn, async () => undefined);
    const hashes = Array.from({ length: 45 }, (_, i) => i.toString(16).padStart(64, "0"));
    expect(await koios.txSpends(hashes)).toHaveLength(45);
    expect(TXS_PER_REQUEST).toBe(20);
    expect(calls.map((c) => c.body._tx_hashes.length)).toEqual([20, 20, 5]);
    expect(calls[0]!.url).toBe("https://preprod.koios.rest/api/v1/tx_info");
    expect(calls[0]!.body).toMatchObject({
      _inputs: true,
      _metadata: false,
      _assets: false,
      _withdrawals: false,
      _certs: false,
      _scripts: false,
      _bytecode: false,
    });
  });
});

/** A page's text, as a person reads it, with the balances shown or hidden. */
function text(element: ReactElement, hidden = false): string {
  const prefs = { prefs: { ...DEFAULT_PREFERENCES, hideBalances: hidden }, loaded: true, set: async () => undefined };
  return renderToStaticMarkup(
    createElement(NetworkContext.Provider, { value: "preprod" }, createElement(PreferencesContext.Provider, { value: prefs }, element)),
  )
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("Lovejoin's page after a restore (independent review M14)", () => {
  const notMixed = (count: number, unsure: number, hidden = false) =>
    text(createElement(NotMixed, { count, unsure, busy: false, onAnyway: () => undefined }), hidden);

  it("says plainly when Koios hasn't said what made a box, and that the wallet asks again", () => {
    expect(notMixed(1, 1)).toContain(
      "One of your boxes isn't known to be mixed yet: Koios hasn't said how it went into the pool. It doesn't come back by itself meanwhile. The wallet asks Koios again at the next read, and Mix my boxes again waits until it has.",
    );
    // How many is hidden with the balances (privacy review §2.16).
    expect(notMixed(1, 1, true)).toContain(
      "Some of your boxes aren't known to be mixed yet: Koios hasn't said how they went into the pool. They don't come back by themselves meanwhile.",
    );
    // Those Koios hasn't said of are said apart, never as a stopped chain's.
    expect(notMixed(3, 1)).toContain(
      "2 of your boxes aren't mixed yet: a chain stopped before mixing them. They never come back by themselves, since each still shows where it went in. Mix my boxes again takes them first. Koios hasn't said yet how one more went in: it doesn't come back by itself meanwhile. The wallet asks Koios again at the next read, and Mix my boxes again waits until it has.",
    );
    expect(notMixed(3, 2)).toContain(
      "One of your boxes isn't mixed yet: a chain stopped before mixing it. It never comes back by itself, since each still shows where it went in. Mix my boxes again takes it first. Koios hasn't said yet how 2 more went in: they don't come back by themselves meanwhile.",
    );
    expect(notMixed(3, 1, true)).toContain(
      "Some of your boxes aren't mixed yet: a chain stopped before mixing them. They never come back by themselves, since each still shows where it went in. Mix my boxes again takes them first. Koios hasn't said yet how some more went in: they don't come back by themselves meanwhile.",
    );
    expect(notMixed(3, 1, true)).not.toMatch(/\d/);
    // A deposit's boxes, found after a restore, read as a stopped chain's do.
    expect(notMixed(2, 0)).toBe(
      "2 of your boxes aren't mixed yet: a chain stopped before mixing them. They never come back by themselves, since each still shows where it went in. Mix my boxes again takes them first. Bring one back anyway",
    );
    // The public account's are the ones known: Koios can't have said an unsure one was the account's.
    expect(text(createElement(NotMixed, { count: 2, fromPublic: 1, unsure: 1, busy: false, onAnyway: () => undefined }))).toContain(
      "It came from your public account, so Mix again from my public account takes it first: paid by the account, which ties nothing new. Koios hasn't said yet how one more went in",
    );
  });

  it("brings back anyway one Koios hasn't said the making of first: it may well be mixed, while the others surely aren't", () => {
    const [D, U] = [{ txHash: hash("d0"), txIndex: 0 }, { txHash: hash("c0"), txIndex: 1 }];
    expect(anywayBox({ notMixed: [D, U], unsure: [U] })).toEqual(U);
    expect(anywayBox({ notMixed: [D] })).toEqual(D);
    expect(anywayBox(undefined)).toBeUndefined();
  });
});

describe("Home's Lovejoin row after a restore (independent review M14)", () => {
  const held: LovejoinHeld = { boxes: 0, lovelace: "0", next: null, notMixed: 3, unsure: 1, stopped: 0 };
  const row = (h: LovejoinHeld, hidden = false) => text(createElement(InLovejoin, { held: h, now: 0, onOpen: () => undefined }), hidden);

  it("says apart the boxes Koios hasn't said the making of, which may be mixed", () => {
    expect(row(held)).toContain("2 not mixed yet, and 1 not known to be mixed yet: open Lovejoin to see what to do.");
    expect(row({ ...held, notMixed: 1 })).toContain("1 not known to be mixed yet: open Lovejoin to see what to do.");
    expect(row({ ...held, notMixed: 1 })).not.toContain("not mixed yet");
    expect(row(held, true)).toContain("Some not mixed yet, and some not known to be mixed yet");
    // Kept before this was counted: all of them not mixed yet, as before.
    expect(row({ ...held, unsure: undefined })).toContain("3 not mixed yet: open Lovejoin");
  });
});
