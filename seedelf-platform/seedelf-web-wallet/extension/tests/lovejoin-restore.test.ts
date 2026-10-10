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
import { chainOwner, LovejoinService } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { SESSION_SPENT } from "../src/background/spent";
import { NETWORKS } from "../src/networks";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinHeld } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { InLovejoin } from "../src/ui/screens/Home";
import { anywayBox, anywayWarning, NotMixed } from "../src/ui/screens/Lovejoin";
import { account, AGREES, atSession, CHAINS, HOUR, PASSWORD, POOL, publicFunded, withSession, type Tested } from "./chain-fixtures";
import { bech32Bytes, preprodAddress } from "./fixtures/bech32";
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
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("came from your public account: mixing them from your private balance would tie the two");
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
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("came from your public account: mixing them from your private balance would tie the two");
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
    await expect(lovejoin.withdrawNow("preprod", { txHash: M, txIndex: 0 })).rejects.toThrow("The server hasn't said how that box went in");
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow("The server hasn't said how your boxes went in, so none comes back yet");
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("The server hasn't said how some of your boxes went in yet");
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
    // Its pool reads (Mix my boxes again asks where it takes a box: "taking a box no record accounts for").
    await t.lovejoin.status("preprod");
    await t.lovejoin.withdrawDue("preprod", true);
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
    // Mix my boxes again refuses while Koios hasn't said of N, so the refusal says to mix them again once it has,
    // and says X, known not to be mixed, apart from N, which may be.
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow(
      "Some of your boxes weren't mixed yet, and the server hasn't said how the others went in. Mix them again once it has, or bring one back anyway.",
    );
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("The server hasn't said how some of your boxes went in yet");
    await expect(lovejoin.withdrawNow("preprod", { txHash: N, txIndex: 0 })).rejects.toThrow("The server hasn't said how that box went in");

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

  it("looks up a box no record accounts for while a chain's deposit is sent and Koios doesn't list it yet, so Mix my boxes again never pays to mix the account's box from the private balance (privacy review §2.10)", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const { lovejoin, sessions } = againRunner(t);
    // A box the public account's deposit made, before the wallet was restored.
    const P = hash("c4");
    t.koios.addedToAccounts.push(await ownedBox(t, P));
    t.koios.txSpends.set(P, await accountDeposit(t));
    // After the restore, a swap's return goes through Lovejoin: its deposit is sent, its boxes' due times set, and
    // Koios doesn't list them yet.
    await sendingChain(t, "seedelf.lovejoin.test", "4", { listed: false, session: 5 });
    await expect(sessions.againBuild("preprod")).rejects.toThrow("came from your public account: mixing them from your private balance would tie the two");
    expect(txInfoAsked(t)).toEqual([[P]]);
    const status = await lovejoin.status("preprod");
    expect(status.fromPublic).toEqual([{ txHash: P, txIndex: 0 }]);
    expect(status.notMixed).toEqual([{ txHash: P, txIndex: 0 }]);
    expect(status.due).toHaveLength(2);
    expect(txInfoAsked(t)).toEqual([[P]]);
  });

  it("looks up a box no record accounts for while a chain's mix is sent and not in yet, so Mix my boxes again leaves the account's box out (privacy review §2.10)", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    // Sixteen others' boxes: two of the wallet's can be mixed again at once.
    const { sessions } = againRunner(t, 16);
    const P = hash("c5");
    t.koios.addedToAccounts.push(await ownedBox(t, P));
    t.koios.txSpends.set(P, await accountDeposit(t));
    // The swap's return: its deposit is in, its first mix too (D#1's box is mixed, at A#0), and its second mix,
    // which spends D#0, is sent and not in yet: D#0 is still listed.
    const D = await sendingChain(t, "seedelf.lovejoin.test", "5", { session: 5 });
    const A = hash("a5");
    t.koios.spent.add(`${D}#1`);
    t.koios.addedToAccounts.push(await ownedBox(t, A));
    await t.wallet.withKeys(() => t.session.set(SESSION_SPENT, { [`${D}#0`]: t.clock.now }));
    const out = await sessions.againBuild("preprod");
    expect(txInfoAsked(t)).toEqual([[P]]);
    expect(out.mix).toMatchObject({ boxes: 1, again: true, owned: 1 });
    await sessions.mixOutSubmit("preprod", out.txHash);
    const spent = await advanceAgain(t, sessions, out);
    expect(spent.length).toBeGreaterThan(0);
    expect(spent).not.toContain(`${P}#0`);
  });

  it("asks nothing in the steady state while a chain's deposit isn't listed yet, or its mix is sent and not in yet, someone else's mix moving one of its boxes too: its due times wait for its boxes", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "b3"));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR], chains: [] });
    const koios = flakyTxInfo(t);
    const D = await sendingChain(t, "seedelf.lovejoin.test", "3", { listed: false });
    const reads = async () => {
      const status = await t.lovejoin.status("preprod");
      await t.lovejoin.withdrawDue("preprod", true);
      expect(koios.asked).toBe(0);
      expect(status.due).toHaveLength(3);
      expect(status.unsure).toBeUndefined();
      expect(await asking(t)).toBeUndefined();
      expect(await origins(t)).toBeUndefined();
    };
    await reads();
    // The deposit is in, then the chain's first mix (D#1's box is at A#0), and its second is sent: D#0 is still
    // listed, and spent by it.
    const A = hash("a3");
    t.koios.addedToAccounts.push(await ownedBox(t, D, 0), await ownedBox(t, A));
    await t.wallet.withKeys(() => t.session.set(SESSION_SPENT, { [`${D}#0`]: t.clock.now }));
    await reads();
    // Someone else's mix moves A#0's box meanwhile.
    t.koios.spent.add(`${A}#0`);
    t.koios.addedToAccounts.push(await ownedBox(t, hash("93")));
    await reads();
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

  it("asks nothing while a chain is sent in the steady state and someone else's mix moves one of the chain's boxes: its due time goes with the box", async () => {
    const { t } = await withSession("40000000");
    const B = hash("91");
    t.koios.addedToAccounts.push(await ownedBox(t, B));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR], chains: [] });
    const D = await sendingChain(t, "seedelf.lovejoin.test", "6");
    // Someone else's mix spends the deposit's second box: the wallet's box it made is where no record of its says.
    const Z = hash("92");
    t.koios.spent.add(`${D}#1`);
    t.koios.addedToAccounts.push(await ownedBox(t, Z));
    const status = await t.lovejoin.status("preprod");
    expect(txInfoAsked(t)).toEqual([]);
    expect(status.notMixed).toEqual([]);
    expect(status.unsure).toBeUndefined();
    expect(status.due).toHaveLength(3);
    expect(await origins(t)).toBeUndefined();
  });

  it("never holds a steady-state wallet's boxes while a chain is sent, someone else's mix moves one of the chain's boxes, and Koios fails", async () => {
    const { t } = await withSession("40000000");
    const B = hash("93");
    t.koios.addedToAccounts.push(await ownedBox(t, B));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR], chains: [] });
    const koios = flakyTxInfo(t);
    const D = await sendingChain(t, "seedelf.lovejoin.test", "7");
    const Z = hash("94");
    t.koios.spent.add(`${D}#1`);
    t.koios.addedToAccounts.push(await ownedBox(t, Z));
    const status = await t.lovejoin.status("preprod");
    expect(koios.asked).toBe(0);
    expect(status.unsure).toBeUndefined();
    expect(status.notMixed).toEqual([]);
    expect(await asking(t)).toBeUndefined();
    const held = await t.lovejoin.held("preprod");
    expect(held).toMatchObject({ boxes: 3, notMixed: 0 });
    expect(held.unsure).toBeUndefined();
    // Mix my boxes again asks what made the boxes no record accounts for before it takes one, and waits while Koios
    // can't say; the pool reads still hold nothing for it.
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("The server hasn't said how some of your boxes went in yet");
    expect(await asking(t)).toBeUndefined();
    expect((await t.lovejoin.status("preprod")).unsure).toBeUndefined();
  });

  it("counts a deposit paid from the account's address past the first twenty as the account's, by its payment key found further along: the stake key it carries only says to look", async () => {
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
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("came from your public account: mixing them from your private balance would tie the two");
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

  it("asks nothing while Mix my boxes again sends two of a steady-state wallet's boxes: the boxes it hasn't reached yet keep their due times", async () => {
    const { t } = await withSession("40000000");
    const [B, C, D] = [hash("b7"), hash("c7"), hash("d7")];
    t.koios.addedToAccounts.push(await ownedBox(t, B), await ownedBox(t, C), await ownedBox(t, D));
    for (const tx of [B, C, D]) t.koios.txSpends.set(tx, mix());
    await t.store.set("lovejoin.preprod", { due: [1, 2, 3].map((h) => t.clock.now + h * HOUR), chains: [] });
    // Mix my boxes again takes B and C: its first mix spends B and leaves its box mixed, C's mix isn't sent yet.
    const [X, Y] = [hash("e7"), hash("f7")];
    await againSending(t, "seedelf.lovejoin.test", [X, Y], B);
    t.koios.addedToAccounts.push(await ownedBox(t, X));
    const status = await t.lovejoin.status("preprod");
    expect(txInfoAsked(t)).toEqual([]);
    expect(status.notMixed).toEqual([]);
    expect(status.due).toHaveLength(3);
    // The chain ends: its two boxes are where it left them, and D where it was.
    await t.lovejoin.chainSent("preprod", Y, 1);
    await t.lovejoin.chainEnded("preprod", Y);
    t.koios.spent.add(`${C}#0`);
    t.koios.addedToAccounts.push(await ownedBox(t, Y));
    await t.lovejoin.status("preprod");
    await t.lovejoin.withdrawDue("preprod", true);
    expect(txInfoAsked(t)).toEqual([]);
    expect(await origins(t)).toBeUndefined();
  });

  it("never holds a steady-state wallet's boxes while Mix my boxes again sends two of them and Koios fails", async () => {
    const { t } = await withSession("40000000");
    const [B, C, D] = [hash("b8"), hash("c8"), hash("d8")];
    t.koios.addedToAccounts.push(await ownedBox(t, B), await ownedBox(t, C), await ownedBox(t, D));
    await t.store.set("lovejoin.preprod", { due: [1, 2, 3].map((h) => t.clock.now + h * HOUR), chains: [] });
    const koios = flakyTxInfo(t);
    const [X, Y] = [hash("e8"), hash("f8")];
    await againSending(t, "seedelf.lovejoin.test", [X, Y], B);
    t.koios.addedToAccounts.push(await ownedBox(t, X));
    const status = await t.lovejoin.status("preprod");
    expect(koios.asked).toBe(0);
    expect(status.unsure).toBeUndefined();
    expect(status.notMixed).toEqual([]);
    expect(await asking(t)).toBeUndefined();
    const held = await t.lovejoin.held("preprod");
    expect(held).toMatchObject({ boxes: 3, notMixed: 0 });
    expect(held.unsure).toBeUndefined();
  });

  it("never counts a deposit as the public account's when its input only carries the account's stake key under someone else's payment key", async () => {
    const t = await publicFunded();
    const P = hash("b9");
    t.koios.addedToAccounts.push(await ownedBox(t, P));
    // Anyone can pay from an address of their own payment key and the account's stake key, without the account.
    const stake = await t.wallet.withKeys((k) => Buffer.from(bech32Bytes(k.cardano.stakeAddress(t.deps.wasm.Network.Preprod)).slice(1)).toString("hex"));
    const stranger = "ee".repeat(28);
    t.koios.txSpends.set(P, [{ payment_addr: { bech32: preprodAddress(stranger, stake), cred: stranger } }]);
    const status = await t.lovejoin.status("preprod");
    expect(status.fromPublic).toEqual([]);
    expect(status.notMixed).toEqual([{ txHash: P, txIndex: 0 }]);
    expect(await origins(t)).toEqual({ [P]: { mixed: false, seen: t.clock.now } });
    // A deposit's box, mixed again from the private balance as any is.
    expect(await t.lovejoin.againBoxes("preprod")).toEqual({ boxes: 1, owned: 1 });
    // Read from its address alone, as a Koios without `cred` gives it: the same.
    const Q = hash("ba");
    t.koios.addedToAccounts.push(await ownedBox(t, Q));
    t.koios.txSpends.set(Q, [{ payment_addr: { bech32: preprodAddress(stranger, stake) } }]);
    expect((await t.lovejoin.status("preprod")).fromPublic).toEqual([]);
    expect((await origins(t))?.[Q]).toEqual({ mixed: false, seen: t.clock.now });
  });

  it("keeps what Koios said of the transactions it answered for when a later request of the same read fails", async () => {
    const { t } = await withSession("40000000");
    const txs = Array.from({ length: TXS_PER_REQUEST + 1 }, (_, i) => (0x40 + i).toString(16).padStart(64, "0"));
    for (const tx of txs) {
      t.koios.addedToAccounts.push(await ownedBox(t, tx));
      t.koios.txSpends.set(tx, mix());
    }
    // The request of the one left over after the first twenty fails.
    const fetch = t.koios.fetch;
    let down = true;
    t.koios.fetch = async (url, init) => {
      if (down && url.includes("/tx_info") && (JSON.parse(String(init.body)) as { _tx_hashes: string[] })._tx_hashes.length === 1) {
        return new Response("upstream", { status: 500 });
      }
      return fetch(url, init);
    };
    const first = await t.lovejoin.status("preprod");
    expect(Object.keys((await origins(t))!)).toHaveLength(TXS_PER_REQUEST);
    const [left] = Object.keys((await asking(t))!);
    expect(first.unsure).toEqual([{ txHash: left, txIndex: 0 }]);
    expect(first.due).toHaveLength(TXS_PER_REQUEST);
    // Koios answers at the next read: only that one is asked of.
    down = false;
    const asked = txInfoAsked(t).length;
    const second = await t.lovejoin.status("preprod");
    expect(txInfoAsked(t).slice(asked)).toEqual([[left]]);
    expect(second.unsure).toBeUndefined();
    expect(second.due).toHaveLength(TXS_PER_REQUEST + 1);
  });

  it("says a box a deposit made, found after a restore, as Koios said it: never the user's deposit, nor a stopped chain's", async () => {
    const { t } = await withSession("40000000");
    const S = hash("95");
    t.koios.addedToAccounts.push(await ownedBox(t, S));
    // Whose deposit it was, and why no mix followed it, the wallet can't know: someone else's may pay to its register.
    t.koios.txSpends.set(S, sessionDeposit());
    const status = await t.lovejoin.status("preprod");
    expect(status.deposits).toEqual([{ txHash: S, txIndex: 0 }]);
    expect(status.notMixed).toEqual(status.deposits);
    const lovejoin = witnessed(t);
    await expect(lovejoin.withdrawNow("preprod", { txHash: S, txIndex: 0 })).rejects.toThrow(
      "That box wasn't mixed: the server says a deposit put it in. Brought back now, it shows where it went in. Mix again first, or bring it back anyway.",
    );
    const page = text(createElement(NotMixed, { count: 1, deposits: 1, busy: false, onAnyway: () => undefined }));
    expect(page).toContain(
      "One of your boxes isn't mixed yet: the server says a deposit put it into the pool, and no mix has moved it since. It never comes back by itself, since each still shows where it went in.",
    );
    const warning = anywayWarning(status);
    expect(warning).toBe(
      "The server says a deposit put it in. Brought back now, anyone can tie that deposit to your private balance. Mix my boxes again hides it first.",
    );
    for (const said of [page, warning]) {
      expect(said).not.toContain("your deposit");
      expect(said).not.toContain("chain stopped");
    }
  });

  it("still says a recorded chain's box not mixed yet is its chain's, stopped", async () => {
    const { t } = await withSession("40000000");
    const D = hash("96");
    // A session's return, cut after its deposit.
    const cut = {
      id: hash("97"),
      session: 0,
      progress: "seedelf.lovejoin.test",
      deposit: D,
      mixes: [hash("97")],
      leaves: [{ txHash: hash("97"), txIndex: 0 }],
      boxes: 1,
      total: 2,
      sent: 1,
      at: t.clock.now - 2 * HOUR,
      scheduled: true,
      stopped: "The wallet locked, or the browser closed, while its chain was being sent.",
      ended: t.clock.now - 2 * HOUR,
    };
    t.koios.addedToAccounts.push(await ownedBox(t, D));
    await t.store.set("lovejoin.preprod", { due: [], chains: [cut] });
    const status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toEqual([{ txHash: D, txIndex: 0 }]);
    expect(status.deposits).toBeUndefined();
    await expect(witnessed(t).withdrawNow("preprod", { txHash: D, txIndex: 0 })).rejects.toThrow(
      "That box wasn't mixed: its chain stopped first.",
    );
    expect(anywayWarning(status)).toContain("Its chain stopped before mixing it. Brought back now, anyone can tie your deposit to your private balance.");
    expect(txInfoAsked(t)).toEqual([]);
  });
});

// Where the wallet takes a box, it knows what made it first, whatever the pool read's count of boxes against due
// times said (independent review M14): a recorded chain accounts for it, or Koios said. Mix my boxes again from the
// private balance, Bring one back now, and a box coming back by itself each ask of the rest then, in one request,
// each transaction once, and never take one Koios can't say of.
describe("taking a box no record accounts for (independent review M14)", CHAINS, () => {
  it("asks what made a box as Mix my boxes again is pressed while a chain is all sent and its last mixes aren't in yet, and never pays to mix the public account's box from the private balance (privacy review §2.10)", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const { lovejoin, sessions } = againRunner(t);
    // A box the public account's deposit made, before the wallet was restored.
    const P = hash("c6");
    t.koios.addedToAccounts.push(await ownedBox(t, P));
    t.koios.txSpends.set(P, await accountDeposit(t));
    // After the restore, a swap's return went through Lovejoin: all sent, its two mixes not in yet.
    await sentChain(t, "6");
    // The pool read counts as many boxes as due times, so it asks nothing, as a wallet in its steady state doesn't.
    const status = await lovejoin.status("preprod");
    expect(txInfoAsked(t)).toEqual([]);
    expect(status.due).toHaveLength(2);
    // Mix my boxes again asks what made P before it takes it: the account's deposit, so it refuses.
    await expect(sessions.againBuild("preprod")).rejects.toThrow("came from your public account: mixing them from your private balance would tie the two");
    expect(txInfoAsked(t)).toEqual([[P]]);
    // Known now: pressed again, it asks nothing more, and the page says P is the account's and not mixed yet.
    await expect(sessions.againBuild("preprod")).rejects.toThrow("came from your public account: mixing them from your private balance would tie the two");
    const after = await lovejoin.status("preprod");
    expect(after.fromPublic).toEqual([{ txHash: P, txIndex: 0 }]);
    expect(after.notMixed).toEqual([{ txHash: P, txIndex: 0 }]);
    expect(txInfoAsked(t)).toEqual([[P]]);
  });

  it("leaves the public account's box out of a mix again from the private balance while a chain's last mixes aren't in yet, and mixes the rest (privacy review §2.10)", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const { sessions } = againRunner(t, 16);
    // The account's deposit made P; someone else's mix moved M.
    const [P, M] = [hash("c7"), hash("b7")];
    t.koios.addedToAccounts.push(await ownedBox(t, P), await ownedBox(t, M));
    t.koios.txSpends.set(P, await accountDeposit(t));
    t.koios.txSpends.set(M, mix("ee".repeat(28)));
    await sentChain(t, "7");
    const out = await sessions.againBuild("preprod");
    expect(txInfoAsked(t)).toEqual([[M, P].sort()]);
    expect(out.mix).toMatchObject({ boxes: 1, again: true, owned: 1 });
    await sessions.mixOutSubmit("preprod", out.txHash);
    const spent = await advanceAgain(t, sessions, out);
    expect(spent).toContain(`${M}#0`);
    expect(spent).not.toContain(`${P}#0`);
    // Asked once all along: the chain's build knew both.
    expect(txInfoAsked(t)).toEqual([[M, P].sort()]);
  });

  it("asks, as Mix my boxes again's chain is built, what made a box that turned up after its review, and leaves it out while Koios can't say or it's the public account's", async () => {
    for (const koiosDown of [false, true]) {
      const t = testBalances();
      await t.wallet.create(account(12).phrase, PASSWORD);
      const { sessions } = againRunner(t, 16);
      const M = hash("b8");
      t.koios.addedToAccounts.push(await ownedBox(t, M));
      t.koios.txSpends.set(M, mix("ee".repeat(28)));
      const out = await sessions.againBuild("preprod");
      expect(out.mix).toMatchObject({ boxes: 1, again: true, owned: 1 });
      await sessions.mixOutSubmit("preprod", out.txHash);
      // Before the funding lands, a box the public account's deposit made turns up, listed first.
      const R = hash("c9");
      t.koios.addedToAccounts.unshift(await ownedBox(t, R));
      t.koios.txSpends.set(R, await accountDeposit(t));
      const koios = flakyTxInfo(t);
      koios.on = koiosDown;
      const spent = await advanceAgain(t, sessions, out);
      expect(spent).toContain(`${M}#0`);
      expect(spent).not.toContain(`${R}#0`);
      expect(koios.asked).toBeGreaterThan(0);
      expect(txInfoAsked(t)).toEqual(koiosDown ? [[M]] : [[M], [R]]);
    }
  });

  it("never brings back by itself a box a deposit made that a chain's dropped last mix left its due time to, and asks what made it first", async () => {
    const { t } = await withSession("40000000");
    const P = hash("c8");
    t.koios.addedToAccounts.push(await ownedBox(t, P));
    t.koios.txSpends.set(P, await accountDeposit(t));
    // The chain's first mix is in, and a node dropped its last after it was all sent: what that mix spends stays
    // spent by it for hours, its box never shows, and its due time is left over, as many as the boxes that can come
    // back. The pool read asks nothing.
    const { mixes } = await sentChain(t, "8", [0]);
    const lovejoin = witnessed(t);
    const back = await runsFor(t, lovejoin, 16);
    expect(back).not.toContain(`${P}#0`);
    // The chain's mixed box came back; P was asked of once, as it was about to go, and is held from then.
    expect(back).toEqual([`${mixes[0]}#0`]);
    expect(txInfoAsked(t)).toEqual([[P]]);
    const status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toContainEqual({ txHash: P, txIndex: 0 });
    expect(status.fromPublic).toEqual([{ txHash: P, txIndex: 0 }]);
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow("weren't mixed yet");
    expect(txInfoAsked(t)).toEqual([[P]]);
  });

  it("never brings back by itself a box Koios said a deposit made while the run was about to take it: Mix my boxes again pressed then asked, and the box stays held (privacy review §2.10)", async () => {
    const { t } = await withSession("40000000");
    const P = hash("cc");
    t.koios.addedToAccounts.push(await ownedBox(t, P));
    t.koios.txSpends.set(P, await accountDeposit(t));
    // As above: a chain's dropped last mix left its due time to P, and the pool read asks nothing.
    const { mixes } = await sentChain(t, "9", [0]);
    const lovejoin = witnessed(t);
    // The run where a due time came has sorted out the boxes, P among those free to come back, when Mix my boxes
    // again is pressed on the page: it asks what made P, and Koios says the account's deposit.
    const due = async () => ((await t.store.get<{ due: number[] }>("lovejoin.preprod"))?.due ?? []).some((d) => d <= t.clock.now);
    const pressed = pressedAsSorted(lovejoin, due, () => lovejoin.againBoxes("preprod"));
    const back = await runsFor(t, lovejoin, 16);
    expect(pressed()).toBe(true);
    // A deposit's box isn't taken as a mix's, whoever asked Koios: only the chain's mixed box came back.
    expect(back).toEqual([`${mixes[0]}#0`]);
    expect(txInfoAsked(t)).toEqual([[P]]);
    const status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toContainEqual({ txHash: P, txIndex: 0 });
    expect(status.fromPublic).toEqual([{ txHash: P, txIndex: 0 }]);
  });

  it("never brings back, as Bring one back now, a box Koios said a deposit made while it chose: Mix my boxes again pressed then asked, and it takes a box whose making is known (privacy review §2.10)", async () => {
    const { t } = await withSession("40000000");
    const [M, P] = [hash("b3"), hash("cd")];
    // M is where the wallet's own chain left it, hours ago. P, the account's deposit before a restore, went in just
    // now: Bring one back now puts it after M, so it asks nothing, and the pool read's count asks nothing either.
    const at = t.clock.now / 1000;
    t.koios.addedToAccounts.push({ ...(await ownedBox(t, M)), block_time: at - 3 * 3600 }, { ...(await ownedBox(t, P)), block_time: at });
    t.koios.txSpends.set(P, await accountDeposit(t));
    await t.store.set("lovejoin.preprod", {
      due: [t.clock.now + 30 * HOUR, t.clock.now + 40 * HOUR],
      chains: [],
      leaves: { [`${M}#0`]: chainOwner(0) },
    });
    const lovejoin = witnessed(t);
    // Once it has sorted out the boxes, time passes (P has waited the delay's least by the time it chooses, and goes
    // before M, still where the wallet's chain left it), and Mix my boxes again is pressed on the page: it asks what
    // made P, and Koios says the account's deposit.
    const pressed = pressedAsSorted(
      lovejoin,
      async () => true,
      async () => {
        await busyFor(t, 2 * HOUR);
        await lovejoin.againBoxes("preprod");
      },
    );
    await lovejoin.withdrawNow("preprod");
    expect(pressed()).toBe(true);
    expect(txInfoAsked(t)).toEqual([[P]]);
    expect(withdrawn(t)).toEqual([`${M}#0`]);
  });

  it("refuses to take a box no record accounts for while Koios can't say what made it, and keeps nothing for the pool reads, in a wallet's steady state", async () => {
    const { t } = await withSession("40000000");
    const B = hash("b9");
    t.koios.addedToAccounts.push(await ownedBox(t, B));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR], chains: [] });
    const koios = flakyTxInfo(t);
    const lovejoin = witnessed(t);
    // The pool read asks nothing: a due time for each box.
    await t.lovejoin.status("preprod");
    expect(koios.asked).toBe(0);
    // Each place that would take B asks, and refuses while Koios can't say.
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow(
      "The server hasn't said how some of your boxes went in yet. Try again in a minute.",
    );
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow(
      "The server hasn't said how some of your boxes went in, so the wallet can't tell if they were mixed. Try again in a minute.",
    );
    await expect(lovejoin.withdrawNow("preprod", { txHash: B, txIndex: 0 })).rejects.toThrow("The server hasn't said how that box went in");
    expect(koios.asked).toBeGreaterThan(0);
    expect(withdrawn(t)).toEqual([]);
    // Nothing kept for the pool reads: they still ask nothing and hold nothing.
    expect(await asking(t)).toBeUndefined();
    expect(await origins(t)).toBeUndefined();
    const asked = koios.asked;
    const status = await t.lovejoin.status("preprod");
    expect(koios.asked).toBe(asked);
    expect(status.unsure).toBeUndefined();
    expect(status.notMixed).toEqual([]);
    expect(await t.lovejoin.held("preprod")).toMatchObject({ boxes: 1, notMixed: 0 });
    // Koios answers: a mix made B. Bring one back now asks once more, and takes it.
    koios.on = false;
    t.koios.txSpends.set(B, mix());
    await lovejoin.withdrawNow("preprod");
    expect(withdrawn(t)).toEqual([`${B}#0`]);
    expect(txInfoAsked(t)).toEqual([[B]]);
  });

  it("asks, before a box no record accounts for comes back by itself, what made that box alone, and waits while Koios can't say", async () => {
    const { t } = await withSession("40000000");
    const [B, C] = [hash("ba"), hash("ca")];
    t.koios.addedToAccounts.push(await ownedBox(t, B), await ownedBox(t, C));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR, t.clock.now + 30 * HOUR], chains: [] });
    const koios = flakyTxInfo(t);
    const lovejoin = witnessed(t);
    // Koios can't say: nothing comes back, and nothing is kept for the pool reads.
    expect(await runsFor(t, lovejoin, 6)).toEqual([]);
    expect(koios.asked).toBeGreaterThan(0);
    expect(await asking(t)).toBeUndefined();
    expect((await t.store.get<{ due: number[] }>("lovejoin.preprod"))?.due).toHaveLength(2);
    // It answers: the box about to go comes back, asked of alone.
    koios.on = false;
    t.koios.txSpends.set(B, mix());
    t.koios.txSpends.set(C, mix());
    expect(await runsFor(t, lovejoin, 6)).toEqual([`${B}#0`]);
    expect(txInfoAsked(t)).toEqual([[B]]);
    // Known now: Bring one back now asks only of the other.
    await lovejoin.withdrawNow("preprod");
    expect(withdrawn(t)).toEqual([`${B}#0`, `${C}#0`]);
    expect(txInfoAsked(t)).toEqual([[B], [C]]);
  });

  it("has the pool read itself ask what made a box no record accounts for while a chain's deposit isn't listed yet, or its mix isn't in yet: the chain's due times wait for its boxes as Koios lists them", async () => {
    // Its deposit sent, and not listed yet.
    const { t } = await withSession("40000000");
    const P = hash("bd");
    t.koios.addedToAccounts.push(await ownedBox(t, P));
    t.koios.txSpends.set(P, await accountDeposit(t));
    await sendingChain(t, "seedelf.lovejoin.test", "d", { listed: false });
    const status = await t.lovejoin.status("preprod");
    expect(txInfoAsked(t)).toEqual([[P]]);
    expect(status.fromPublic).toEqual([{ txHash: P, txIndex: 0 }]);
    expect(status.notMixed).toEqual([{ txHash: P, txIndex: 0 }]);

    // Its deposit in, its first mix too (D#1's box is at A#0), and its second sent and not in yet: D#0 is still
    // listed, and spent by it.
    const { t: u } = await withSession("40000000");
    const Q = hash("be");
    u.koios.addedToAccounts.push(await ownedBox(u, Q));
    u.koios.txSpends.set(Q, await accountDeposit(u));
    const D = await sendingChain(u, "seedelf.lovejoin.test", "e");
    const A = hash("ae");
    u.koios.spent.add(`${D}#1`);
    u.koios.addedToAccounts.push(await ownedBox(u, A));
    await u.wallet.withKeys(() => u.session.set(SESSION_SPENT, { [`${D}#0`]: u.clock.now }));
    expect((await u.lovejoin.status("preprod")).fromPublic).toEqual([{ txHash: Q, txIndex: 0 }]);
    expect(txInfoAsked(u)).toEqual([[Q]]);
  });

  it("asks nothing of a box a recorded chain or Koios already accounts for, wherever it's taken", async () => {
    const { t } = await withSession("40000000");
    const [M, N] = [hash("bb"), hash("cb")];
    t.koios.addedToAccounts.push(await ownedBox(t, M), await ownedBox(t, N));
    t.koios.txSpends.set(M, mix());
    t.koios.txSpends.set(N, mix());
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR, t.clock.now + 30 * HOUR], chains: [] });
    // Mix my boxes again asks of both at once.
    expect(await t.lovejoin.againBoxes("preprod")).toEqual({ boxes: 2, owned: 2 });
    expect(txInfoAsked(t)).toEqual([[M, N].sort()]);
    // Then nothing is asked again: not by Mix my boxes again, a box coming back by itself, or Bring one back now.
    await t.lovejoin.againBoxes("preprod");
    const lovejoin = witnessed(t);
    expect(await runsFor(t, lovejoin, 4)).toEqual([`${M}#0`]);
    await lovejoin.withdrawNow("preprod");
    expect(withdrawn(t)).toEqual([`${M}#0`, `${N}#0`]);
    expect(txInfoAsked(t)).toEqual([[M, N].sort()]);
  });
});

/**
 * Runs `press` once, the first time `when` holds as `lovejoin` has sorted out
 * the wallet's boxes in the pool, before it takes one: a press on the page
 * (Mix my boxes again) landing between a withdraw's pool read and the box it
 * takes. Says whether it ran.
 */
function pressedAsSorted(lovejoin: LovejoinService, when: () => Promise<boolean>, press: () => Promise<unknown>): () => boolean {
  const sorting = lovejoin as unknown as { sortOut: (...args: unknown[]) => Promise<unknown> };
  const sortOut = sorting.sortOut.bind(lovejoin);
  let pressed = false;
  sorting.sortOut = async (...args) => {
    const sorted = await sortOut(...args);
    if (!pressed && (await when())) {
      pressed = true;
      await press();
    }
    return sorted;
  };
  return () => pressed;
}

/** What the sealed schedule keeps of the transactions still asked of. */
const asking = async (t: Tested) => (await t.store.get<{ asking?: Record<string, number> }>("lovejoin.preprod"))?.asking;

/**
 * Session 0's chain through Lovejoin, all sent, `tag` naming its hashes: its
 * deposit is in (two boxes, their due times set), and each of its two mixes
 * takes one of its boxes (D#0, then D#1) and leaves it mixed at the mix's #0.
 * The mixes in `landed` (by their order) are in; the others are sent and not
 * in yet, or a node dropped them: the box each spends is still listed, spent
 * by it, and the box it makes isn't. Returns the deposit's hash and the mixes'.
 */
async function sentChain(t: Tested, tag: string, landed: number[] = []): Promise<{ D: string; mixes: string[] }> {
  const [D, A, B] = ["d", "a", "e"].map((h) => hash(h + tag)) as [string, string, string];
  const key = "seedelf.lovejoin.test";
  const txs = [
    { kind: "deposit" as const, txHash: D, txCbor: "", fee: "0" },
    { kind: "mix" as const, txHash: A, txCbor: "", fee: "0" },
    { kind: "mix" as const, txHash: B, txCbor: "", fee: "0" },
  ];
  const leaves = [A, B].map((txHash) => ({ txHash, txIndex: 0 }));
  await t.lovejoin.recordChain("preprod", { session: 0, progress: key, txs, leaves, boxes: 2 });
  await t.wallet.withKeys(() => t.session.set(key, { txs, next: 3, flying: [A, B] }));
  for (const i of [0, 1, 2]) await t.lovejoin.chainSent("preprod", B, i);
  await t.lovejoin.chainEnded("preprod", B);
  const flying: Record<string, number> = {};
  for (const [k, made] of [A, B].entries()) {
    if (landed.includes(k)) {
      t.koios.addedToAccounts.push(await ownedBox(t, made));
    } else {
      t.koios.addedToAccounts.push(await ownedBox(t, D, k));
      flying[`${D}#${k}`] = t.clock.now;
    }
  }
  await t.wallet.withKeys(() => t.session.set(SESSION_SPENT, flying));
  return { D, mixes: [A, B] };
}

/**
 * Mix my boxes again being sent: a chain of `mixes`, one of the wallet's
 * boxes each, each leaving its box mixed (at its #0), recorded and its
 * progress where it waits. Its first mix is in, having spent `first`.
 */
async function againSending(t: Tested, key: string, mixes: string[], first: string): Promise<void> {
  const txs = mixes.map((txHash) => ({ kind: "mix" as const, txHash, txCbor: "", fee: "0" }));
  const leaves = mixes.map((txHash) => ({ txHash, txIndex: 0 }));
  await t.lovejoin.recordChain("preprod", { session: 0, progress: key, txs, leaves, boxes: mixes.length, again: true });
  await t.wallet.withKeys(() => t.session.set(key, { txs, next: 1, flying: [] }));
  await t.lovejoin.chainSent("preprod", mixes.at(-1)!, 0);
  t.koios.spent.add(`${first}#0`);
}

/**
 * Session `session`'s chain being sent through Lovejoin (session 0's
 * unless said), recorded and its progress where it waits: its deposit is
 * sent (two boxes, their due times set), its mixes not yet. `listed`: Koios
 * lists the deposit's boxes (it's in), unless false. Returns its deposit's hash.
 */
async function sendingChain(
  t: Tested,
  key: string,
  tag: string,
  { listed = true, session = 0 }: { listed?: boolean; session?: number } = {},
): Promise<string> {
  const [D, A, B] = ["d", "a", "e"].map((h) => hash(h + tag));
  const txs = [
    { kind: "deposit" as const, txHash: D!, txCbor: "", fee: "0" },
    { kind: "mix" as const, txHash: A!, txCbor: "", fee: "0" },
    { kind: "mix" as const, txHash: B!, txCbor: "", fee: "0" },
  ];
  const leaves = [0, 1].map((txIndex) => ({ txHash: B!, txIndex }));
  await t.lovejoin.recordChain("preprod", { session, progress: key, txs, leaves, boxes: 2 });
  await t.wallet.withKeys(() => t.session.set(key, { txs, next: 1, flying: [] }));
  await t.lovejoin.chainSent("preprod", B!, 0);
  if (listed) t.koios.addedToAccounts.push(await ownedBox(t, D!, 0), await ownedBox(t, D!, 1));
  return D!;
}

/**
 * Lovejoin and the sessions that mix the wallet's boxes again, with `others`
 * others' boxes in the pool (ten, as sessions.test.ts has them, unless said).
 */
function againRunner(t: Tested, others = 10) {
  const spend = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
    body.params.additionalUtxo ? AGREES : { ...spend, result: spend.result.slice(0, 1) };
  // Ten others' boxes: two waves deep, one box of the wallet's is mixed again at a time; sixteen, two.
  t.koios.addedToAccounts.push(...POOL.slice(0, others));
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
      "The server hasn't said how one of your boxes went in, so it may not be mixed. It doesn't come back on its own until the server says. The wallet asks the server again at the next refresh. Until it answers, Mix my boxes again can't run.",
    );
    // How many is hidden with the balances (privacy review §2.16).
    expect(notMixed(1, 1, true)).toContain(
      "The server hasn't said how some of your boxes went in, so they may not be mixed. None comes back on its own until the server says.",
    );
    // Those Koios hasn't said of are said apart, never as a stopped chain's.
    expect(notMixed(3, 1)).toContain(
      "2 of your boxes aren't mixed yet: a chain stopped before mixing them. They never come back by themselves, since each still shows where it went in. Mix my boxes again takes them first. The server hasn't said how one more went in; it won't come back on its own until the server says. The wallet asks the server again at the next refresh. Until it answers, Mix my boxes again can't run.",
    );
    expect(notMixed(3, 2)).toContain(
      "One of your boxes isn't mixed yet: a chain stopped before mixing it. It never comes back by itself, since each still shows where it went in. Mix my boxes again takes it first. The server hasn't said how 2 more went in; they won't come back on their own until the server says.",
    );
    expect(notMixed(3, 1, true)).toContain(
      "Some of your boxes aren't mixed yet: a chain stopped before mixing them. They never come back by themselves, since each still shows where it went in. Mix my boxes again takes them first. The server hasn't said how some more went in; they won't come back on their own until the server says.",
    );
    expect(notMixed(3, 1, true)).not.toMatch(/\d/);
    // A stopped chain's boxes, as the records say.
    expect(notMixed(2, 0)).toBe(
      "2 of your boxes aren't mixed yet: a chain stopped before mixing them. They never come back by themselves, since each still shows where it went in. Mix my boxes again takes them first. Bring one back anyway",
    );
    // The public account's are the ones known: Koios can't have said an unsure one was the account's.
    expect(text(createElement(NotMixed, { count: 2, fromPublic: 1, unsure: 1, busy: false, onAnyway: () => undefined }))).toContain(
      "It came from your public account: Mix again from my public account takes it first, and ties nothing new. The server hasn't said how one more went in",
    );
  });

  it("brings back anyway one Koios hasn't said the making of first: it may well be mixed, while the others surely aren't", () => {
    const [D, U] = [{ txHash: hash("d0"), txIndex: 0 }, { txHash: hash("c0"), txIndex: 1 }];
    expect(anywayBox({ notMixed: [D, U], unsure: [U] })).toEqual(U);
    expect(anywayBox({ notMixed: [D] })).toEqual(D);
    expect(anywayBox(undefined)).toBeUndefined();
  });

  it("says the boxes a deposit made as Koios said it, apart from a stopped chain's: whose deposit, and why, the wallet can't know", () => {
    const said = (count: number, deposits: number, unsure = 0, hidden = false) =>
      text(createElement(NotMixed, { count, deposits, unsure, busy: false, onAnyway: () => undefined }), hidden);
    expect(said(2, 2)).toBe(
      "2 of your boxes aren't mixed yet: the server says a deposit put them into the pool, and no mix has moved them since. They never come back by themselves, since each still shows where it went in. Mix my boxes again takes them first. Bring one back anyway",
    );
    // Some a recorded chain stopped before mixing, some a deposit made: each said as it is.
    expect(said(3, 1)).toContain(
      "3 of your boxes aren't mixed yet: a chain stopped before mixing 2, and the server says a deposit put the other into the pool, with no mix since.",
    );
    expect(said(3, 2)).toContain(
      "3 of your boxes aren't mixed yet: a chain stopped before mixing one, and the server says a deposit put the others into the pool, with no mix since.",
    );
    expect(said(3, 1, 0, true)).toContain(
      "Some of your boxes aren't mixed yet: a chain stopped before mixing some, and the server says a deposit put the others into the pool, with no mix since.",
    );
    expect(said(3, 1, 0, true)).not.toMatch(/\d/);
    // With one Koios hasn't said of: the known one is the deposit's.
    expect(said(2, 1, 1)).toContain(
      "One of your boxes isn't mixed yet: the server says a deposit put it into the pool, and no mix has moved it since. It never comes back by itself, since each still shows where it went in. Mix my boxes again takes it first. The server hasn't said how one more went in",
    );
    for (const text of [said(2, 2), said(3, 1), said(2, 1, 1), said(1, 1, 0, true)]) expect(text).not.toContain("your deposit");
  });

  it("warns of bringing back a box a deposit made as Koios said it: the public account's paid for, or anyone's", () => {
    const box = (tx: string) => ({ txHash: hash(tx), txIndex: 0 });
    const [D, P, U, C] = [box("d1"), box("e1"), box("c1"), box("a1")];
    // The public account paid the deposit that made it.
    expect(anywayWarning({ notMixed: [P], deposits: [P], fromPublic: [P] })).toBe(
      "The server says your public account deposited it. Brought back now, anyone can tie your public account to your private balance. Mix again from my public account hides it first.",
    );
    // Some other deposit.
    expect(anywayWarning({ notMixed: [D], deposits: [D], fromPublic: [] })).toBe(
      "The server says a deposit put it in. Brought back now, anyone can tie that deposit to your private balance. Mix my boxes again hides it first.",
    );
    // One Koios hasn't said of is taken first, and warned of as such.
    expect(anywayWarning({ notMixed: [D, U], deposits: [D], unsure: [U], fromPublic: [] })).toContain("The server hasn't said how it went in, so it may not be mixed");
    // A recorded chain's, as before.
    expect(anywayWarning({ notMixed: [C], fromPublic: [] })).toContain("Its chain stopped before mixing it. Brought back now, anyone can tie your deposit to your private balance.");
    expect(anywayWarning({ notMixed: [C], fromPublic: [C] })).toContain("Its mix from your public account stopped before mixing it");
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
