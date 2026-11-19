// Chunk 51, e1a#1: a box someone else put in Lovejoin under the wallet's key. A Seedelf's register (g, u) is on chain
// for anyone to read, and anyone can re-randomize it with a d of their own, from those two points alone, and deposit a
// box under it: the wallet's ownership check is b = [x]·a alone (wasm lovejoin.rs owned_in, core PoolBox::is_owned), so
// it counts that box as its own. After a restore, or wherever no record accounts for a box, what made it is read from
// its transaction's inputs (madeBy): a deposit no key of the phrase paid, neither a public account's payment key nor a
// one-time account's, is someone else's, or another device's session the book doesn't know. Mix my boxes again from the
// private balance never takes such a box (its mix, its funding and its change would tell whoever put it in that they're
// the name's), never puts it first, and never makes itself the page's first button for it; Pay from my private balance
// anyway still takes it, saying what that ties. Home doesn't flag it, since there's nothing to do. Bring one back anyway
// stays its way out: what comes back is classed as money received, so the stealth mint and a funding take it as they
// take a payment from whoever put it in, never as a box back from Lovejoin, which the stealth mint takes first.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinHeld, LovejoinStatus } from "../src/shared/rpc";
import { groupPools, type ShownPool } from "../src/ui/lovejoin-pools";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { InLovejoin } from "../src/ui/screens/Home";
import { AgainActions, anywayTakes, anywayWarning, NotMixed, PoolGroupList, PrivateReview } from "../src/ui/screens/Lovejoin";
import { account, AGREES, atSession, CHAINS, lovejoinOf, PASSWORD, publicFunded, type Tested } from "./chain-fixtures";
import { preprodAddress } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, sessionSwap, testBalances, withdrawPreprod } from "./fakes";
import { ADA, ADA_ADDRESS, ADA_POOL, ADA_ROWS, ADA_VIEW, adaBox, ownDatum } from "./v2-pools";

const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
const ref = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;
const refs = (boxes: Array<{ txHash: string; txIndex: number }> | undefined) => (boxes ?? []).map(ref).sort();

/** Box `txHash#0` of the 5 ₳ pool, as the worker names it. */
const inAda = (txHash: string) => ({ txHash, txIndex: 0, pool: ADA });
/** The 5 ₳ pool's part of a status. */
const adaOf = (status: LovejoinStatus) => status.pools!.find((p) => p.id === ADA)!;
/** A box in the 5 ₳ pool under the wallet's key, at `tx#0`: whoever deposited it, the key's check counts it the wallet's. */
const ownBox = async (t: Tested, tx: string): Promise<KoiosUtxo> => adaBox(tx, await ownDatum(t.wallet), t.clock.now);
/** A deposit's inputs, as tx_info lists them: one UTxO at an address of payment key `cred`. */
const paidBy = (cred: string) => [{ payment_addr: { bech32: preprodAddress(cred), cred } }];
/** The phrase's one-time account `index`'s payment key: a private session's. */
const oneTimeKey = (t: Tested, index: number) => t.wallet.withKeys((k) => k.oneTime.keyHash(index));
/** How often Koios was asked what made a box (tx_info). */
const asked = (t: Tested) => t.koios.calls.filter((c) => c.path === "tx_info").length;
/** The private history's entry for `txHash`. */
const historyOf = async (t: Tested, txHash: string) =>
  (await t.store.get<{ entries: Array<{ txHash: string; origin?: { id: string; origin: string } }> }>("history.preprod"))!.entries.find(
    (e) => e.txHash === txHash,
  );

/** Koios's tx_info fails with a 500 while `down.on`. */
function flakyTxInfo(t: Tested) {
  const down = { on: true };
  const fetch = t.koios.fetch;
  t.koios.fetch = async (url, init) => (down.on && url.includes("/tx_info") ? new Response("upstream", { status: 500 }) : fetch(url, init));
  return down;
}

/** A page's markup, as a person reads it, on preprod, with the balances shown or hidden. */
function html(element: ReactElement, hidden = false): string {
  const prefs = { prefs: { ...DEFAULT_PREFERENCES, hideBalances: hidden }, loaded: true, set: async () => undefined };
  return renderToStaticMarkup(
    createElement(NetworkContext.Provider, { value: "preprod" }, createElement(PreferencesContext.Provider, { value: prefs }, element)),
  );
}
const text = (element: ReactElement, hidden = false) =>
  html(element, hidden)
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

describe("a box someone else put in under the wallet's key (chunk 51, e1a#1)", CHAINS, () => {
  // The trace verifier's test (verify/e1a-1.md, chunk 51), driven through the worker with the real WebAssembly, as
  // lovejoin-restore.test.ts's "mixes again from the private balance a session deposit's box first" is. Mallory
  // re-randomizes Alice's Seedelf register and deposits one 5 ₳ box under it into v2's 5 ₳ pool, paid from her own
  // address. Before the fix, Mix my boxes again counted it, sorted it first, and a mix its new one-time account paid,
  // funded from Alice's private balance, spent it beside two others' boxes, leaving the wallet's own box out: Mallory,
  // watching her box, learned that account, its funding's private UTxOs and its change were the name's owner's.
  it("Mix my boxes again from the private balance never spends a box a stranger's deposit put in", async () => {
    const t = testBalances({ pools: [ADA_POOL] });
    await t.wallet.create(account(12).phrase, PASSWORD);
    const spend = withdrawPreprod.amount.evaluation as { result: unknown[] };
    t.koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
      body.params.additionalUtxo ? AGREES : { ...spend, result: spend.result.slice(0, 1) };
    // Ten others' boxes in the 5 ₳ pool: two waves deep, one box of the wallet's is mixed again at a time.
    const others = ADA_ROWS.slice(0, 10);
    t.koios.addedToAccounts.push(...others);
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };

    const wasm = loadTestWasm();
    // The Seedelf name's register, as anyone reads it from the name's UTxO: two public points, nothing secret.
    const name = await t.wallet.withKeys((keys) => {
      const r = wasm.rerandomize(keys.seedelf.baseRegister());
      return { generator: r.generator, publicValue: r.publicValue };
    });
    // Mallory's box: that register re-randomized with her own d, from the points alone.
    const planted = Buffer.from(wasm.registerToDatum(wasm.rerandomize(new wasm.Register(name.generator, name.publicValue)))).toString(
      "hex",
    );
    const [P, M] = [hash("e1"), hash("b1")];
    t.koios.addedToAccounts.push(adaBox(P, planted, t.clock.now), adaBox(M, await ownDatum(t.wallet), t.clock.now));
    // Her deposit, paid from her own address: a key no account or session of the phrase holds.
    const mallory = "ee".repeat(28);
    t.koios.txSpends.set(P, [{ payment_addr: { bech32: preprodAddress(mallory), cred: mallory } }]);
    // The wallet's own box, which a mix in the pool made.
    t.koios.txSpends.set(M, [
      { payment_addr: { bech32: ADA_ADDRESS, cred: ADA_VIEW.mixBoxHash } },
      { payment_addr: { bech32: sessionSwap.address, cred: sessionSwap.keyHash } },
    ]);

    const collateral = () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch);
    const lovejoin: LovejoinService = new LovejoinService({
      ...t.deps,
      collateral,
      store: t.store,
      mixingAgain: (network) => sessions.mixingAgain(network),
      sessionIndices: (network) => sessions.indices(network),
      pools: async () => [ADA_POOL],
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

    // The pool read the Lovejoin page makes: Koios is asked what made each box.
    const status = (await lovejoin.status("preprod")).pools!.find((p) => p.id === ADA)!;

    // Mix my boxes again, from the private balance: its funding pays a new one-time account.
    const out = await sessions.againBuild("preprod", false, ADA);
    await sessions.mixOutSubmit("preprod", out.txHash);
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.payments[0]!.lovelace), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    t.koios.evaluation = AGREES;
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", 0, true);
    const chain = t.koios.submitted.slice(before).map((tx) => ({ hash: txIdOf(tx), inputs: txInputs(tx) }));
    expect(chain.length).toBeGreaterThan(0);

    // Each input of a transaction the session sent, by whose it is.
    const theirs = new Set(others.map((u) => `${u.tx_hash}#${u.tx_index}`));
    const label = (i: string) =>
      i === `${P}#0`
        ? "Mallory's box"
        : i === `${M}#0`
          ? "the wallet's own box"
          : i.startsWith(`${out.txHash}#`)
            ? "the one-time account's funding, paid from the private balance"
            : chain.some((tx) => i.startsWith(`${tx.hash}#`))
              ? "the one-time account's change from an earlier mix"
              : theirs.has(i)
                ? "another's box"
                : i;
    const takers = chain.filter((tx) => tx.inputs.includes(`${P}#0`)).map((tx) => tx.inputs.map(label).sort());
    // No transaction the one-time account pays spends Mallory's box...
    expect(takers).toEqual([]);
    // ...and the wallet's own box is still mixed again.
    expect(chain.flatMap((tx) => tx.inputs.map(label))).toContain("the wallet's own box");
    // Its funding paid for the wallet's own box alone. Mallory's is held, not mixed yet, said to be someone else's on
    // the page, and no public account's.
    expect(out.mix).toMatchObject({ boxes: 1, owned: 1 });
    expect(status.notMixed).toEqual([{ txHash: P, txIndex: 0, pool: ADA }]);
    expect(status.someoneElse).toEqual([{ txHash: P, txIndex: 0, pool: ADA }]);
    expect(status.fromPublic).toEqual([]);
  });

  it("tells the phrase's own deposits from someone else's by the keys they spent, a session's as far as 20 past the book's", async () => {
    const t = await publicFunded();
    const book = { indices: [0] };
    const lj = lovejoinOf(t, { sessionIndices: async () => book.indices });
    const [A, B, C, D] = ["a5", "b5", "c5", "d5"].map(hash) as [string, string, string, string];
    for (const tx of [A, B, C, D]) t.koios.addedToAccounts.push(await ownBox(t, tx));
    // Deposits from session 3's one-time account, from session 25's, from a stranger's key, and from the public account.
    t.koios.txSpends.set(A, paidBy(await oneTimeKey(t, 3)));
    t.koios.txSpends.set(B, paidBy(await oneTimeKey(t, 25)));
    t.koios.txSpends.set(C, paidBy("ee".repeat(28)));
    t.koios.txSpends.set(D, paidBy(await t.wallet.withKeys((k) => k.cardano.paymentKeyHash(0, 0))));
    const first = adaOf(await lj.status("preprod"));
    // The book knows session 0 alone: 25 is past the 20 looked at beyond it, as a restore's scan doesn't reach it, so
    // its box reads as someone else's too, which only leaves it out of Mix my boxes again (fails safe).
    expect(await lj.againBoxes("preprod", false, ADA)).toMatchObject({ owned: 1 });
    expect(refs(first.notMixed)).toEqual(refs([A, B, C, D].map(inAda)));
    expect(refs(first.fromPublic)).toEqual([ref(inAda(D))]);
    expect(refs(first.someoneElse)).toEqual(refs([B, C].map(inAda)));
    // The book's sessions run to 9: 25 is within 20 of them, its deposit the phrase's own.
    book.indices = Array.from({ length: 10 }, (_, i) => i);
    expect(refs(adaOf(await lj.status("preprod")).someoneElse)).toEqual([ref(inAda(C))]);
    expect(await lj.againBoxes("preprod", false, ADA)).toMatchObject({ owned: 2 });
    // Asked to (Pay from my private balance anyway), the private balance takes them all.
    expect(await lj.againBoxes("preprod", true, ADA)).toMatchObject({ owned: 4 });
  });

  it("holds someone else's box as not mixed yet: Home shows it, and flags only the wallet's own", async () => {
    const t = await publicFunded();
    const lj = lovejoinOf(t, { sessionIndices: async () => [0] });
    const [A, C] = [hash("a6"), hash("c6")];
    t.koios.addedToAccounts.push(await ownBox(t, C));
    t.koios.txSpends.set(C, paidBy("ee".repeat(28)));
    const row = (held: LovejoinHeld) => text(createElement(InLovejoin, { held, now: 0, onOpen: () => undefined }));
    await lj.status("preprod");
    const alone = await lj.held("preprod");
    // Its row is there, never on its way back, with nothing to do: no flag.
    expect(row(alone)).toContain("Not on their way back");
    expect(row(alone)).not.toContain("open Lovejoin to see what to do");
    expect(alone.pools?.find((p) => p.id === ADA)).toMatchObject({ boxes: 0, notMixed: 1, someoneElse: 1 });
    // A deposit of the wallet's own session beside it: that one is flagged, alone.
    t.koios.addedToAccounts.push(await ownBox(t, A));
    t.koios.txSpends.set(A, paidBy(await oneTimeKey(t, 0)));
    await lj.status("preprod");
    expect(row(await lj.held("preprod"))).toContain("1 not mixed yet: open Lovejoin to see what to do.");
  });

  it("brings someone else's box back, asked to, as money received; the wallet's own deposit's as a box back from Lovejoin", async () => {
    const t = await publicFunded();
    const wasm = loadTestWasm();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const lj = lovejoinOf(t, {
      sessionIndices: async () => [0],
      // giveme.my's witness stood in for: its recorded answer is another transaction's.
      wasm: {
        ...wasm,
        finishLovejoinWithdraw: (request: string) => {
          const { txCbor } = JSON.parse(request) as { txCbor: string };
          return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
        },
      } as typeof wasm,
    });
    const [A, C] = [hash("a7"), hash("c7")];
    t.koios.addedToAccounts.push(await ownBox(t, A), await ownBox(t, C));
    t.koios.txSpends.set(A, paidBy(await oneTimeKey(t, 0)));
    t.koios.txSpends.set(C, paidBy("ee".repeat(28)));
    // The page's pool read: Koios is asked what made each box.
    await lj.status("preprod");
    // Whoever put it in can follow it, as a payer can a payment: the stealth mint takes it as it takes such a payment,
    // never as a box back from Lovejoin, which it takes first (gap-g1#1's part b).
    const theirs = await lj.withdrawNow("preprod", inAda(C), true);
    expect((await historyOf(t, theirs.txHash))?.origin).toEqual({ id: `received:${theirs.txHash}`, origin: "received" });
    const own = await lj.withdrawNow("preprod", inAda(A), true);
    expect((await historyOf(t, own.txHash))?.origin).toBeUndefined();
  });

  it("asks once more what made a deposit's box whose answer an earlier version kept without its inputs, holding it meanwhile", async () => {
    const t = await publicFunded();
    const lj = lovejoinOf(t, { sessionIndices: async () => [0] });
    const [A, C] = [hash("a8"), hash("c8")];
    t.koios.addedToAccounts.push(await ownBox(t, A), await ownBox(t, C));
    t.koios.txSpends.set(A, paidBy(await oneTimeKey(t, 0)));
    t.koios.txSpends.set(C, paidBy("ee".repeat(28)));
    // As 1.9.1 kept them: a deposit made each, no account named, nothing that says whose deposit.
    await t.store.set("lovejoin.preprod", {
      due: [],
      chains: [],
      origins: { [A]: { mixed: false, seen: t.clock.now }, [C]: { mixed: false, seen: t.clock.now } },
    });
    // Koios down: neither can be told yet, so both are held, and Mix my boxes again waits for the answer.
    const down = flakyTxInfo(t);
    const held = adaOf(await lj.status("preprod"));
    expect(refs(held.unsure)).toEqual(refs([A, C].map(inAda)));
    // Neither is called someone else's while the answer is awaited: A, the usual case, is the phrase's own (chunk 51,
    // time#4, the path kept).
    expect(refs(held.someoneElse)).toEqual([]);
    await expect(lj.againBoxes("preprod", false, ADA)).rejects.toThrow("The server hasn't said how some of your boxes went in yet");
    // Koios answers: each is told apart by the keys it spent, once.
    down.on = false;
    expect(refs(adaOf(await lj.status("preprod")).someoneElse)).toEqual([ref(inAda(C))]);
    expect(await lj.againBoxes("preprod", false, ADA)).toMatchObject({ owned: 1 });
    const asks = asked(t);
    await lj.status("preprod");
    expect(asked(t)).toBe(asks);
  });
});

describe("the pool's page, its hub row and Home, of a box someone else put in (chunk 51, e1a#1)", () => {
  const [P, A, M] = ["e1", "a1", "b1"].map((h) => ({ txHash: h.repeat(32), txIndex: 0 })) as Array<{ txHash: string; txIndex: number }>;
  const nothing = () => undefined;
  /** A 5 ₳ pool as the page reads it. */
  const poolOf = (extra: Partial<ShownPool> = {}): ShownPool => ({
    id: "ad".repeat(28),
    box: { lovelace: "5000000" },
    others: 40,
    free: 40,
    floor: 30,
    boxes: [],
    lovelace: "0",
    due: [],
    notMixed: [],
    fromPublic: [],
    ...extra,
  });
  /** The tag of the button `testId` names, whole. */
  const button = (markup: string, testId: string) => markup.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0];

  it("says someone else's box in a sentence of its own, never as one Mix my boxes again takes first", () => {
    const notMixed = (props: Partial<Parameters<typeof NotMixed>[0]>, hidden = false) =>
      text(createElement(NotMixed, { count: 0, busy: false, onAnyway: nothing, ...props }), hidden);
    const alone = notMixed({ count: 1, deposits: 1, someoneElse: 1 });
    expect(alone).toBe(
      "Someone else, or another device, put one box in under your Seedelf key. Mix my boxes again leaves it out, and it never comes back by itself. Bring one back anyway",
    );
    // Beside a box a deposit of the wallet's own put in: that one is said as before, and taken first.
    const both = notMixed({ count: 2, deposits: 2, someoneElse: 1 });
    expect(both).toContain("One of your boxes isn't mixed yet: the server says a deposit put it into the pool, and no mix has moved it since.");
    expect(both).toContain("Mix my boxes again takes it first.");
    expect(both).toContain("Someone else, or another device, put one box in under your Seedelf key.");
    // How many is hidden with the balances (privacy review §2.16).
    expect(notMixed({ count: 2, deposits: 2, someoneElse: 2 }, true)).toContain("Someone else, or another device, put some boxes in under your Seedelf key.");
  });

  it("never makes Mix my boxes again the first button for someone else's box, and offers Pay from my private balance anyway for it", () => {
    const page = (pool: ShownPool) =>
      html(
        createElement(AgainActions, {
          pool,
          busy: false,
          mixingAgain: false,
          publicSending: false,
          onAgain: nothing,
          onAgainPublic: nothing,
          onNow: nothing,
          onAnyway: nothing,
        }),
      );
    // Someone else's box alone: nothing for Mix my boxes again to take; Pay from my private balance anyway takes it.
    const alone = page(poolOf({ boxes: [P!], notMixed: [P!], deposits: [P!], someoneElse: [P!] }));
    expect(button(alone, "lovejoin-again")).toBeUndefined();
    expect(button(alone, "lovejoin-again-anyway")).toBeDefined();
    // Beside a mixed box of the wallet's: Mix my boxes again is there, for that one, and not the first button.
    expect(button(page(poolOf({ boxes: [M!, P!], notMixed: [P!], deposits: [P!], someoneElse: [P!] })), "lovejoin-again")).toContain(
      'class="secondary"',
    );
    // Beside the wallet's own deposit's box: that one makes it the first button.
    expect(button(page(poolOf({ boxes: [A!, P!], notMixed: [A!, P!], deposits: [A!, P!], someoneElse: [P!] })), "lovejoin-again")).toContain(
      'class="primary"',
    );
  });

  it("says nothing hides someone else's box first in Bring it back anyway's question", () => {
    expect(anywayWarning({ notMixed: [P!], deposits: [P!], fromPublic: [], someoneElse: [P!] })).toBe(
      "The server says a deposit put it in. Brought back now, anyone can tie that deposit to your private balance.",
    );
    expect(anywayWarning({ notMixed: [A!], deposits: [A!], fromPublic: [] })).toContain("Mix my boxes again hides it first.");
  });

  it("says what Pay from my private balance anyway ties where it takes someone else's boxes, and a public account's only where it takes those", () => {
    expect(anywayTakes(poolOf({ boxes: [P!], someoneElse: [P!] }))).toEqual({ accounts: false, someoneElse: true });
    expect(anywayTakes(poolOf({ boxes: [A!], fromPublic: [A!] }))).toEqual({ accounts: true, someoneElse: false });
    // A Bootstrap holds it: no way of mixing again takes it.
    expect(anywayTakes(poolOf({ boxes: [P!], someoneElse: [P!], bootstrap: [P!] }))).toEqual({ accounts: false, someoneElse: false });
    const payments = [
      { to: "addr_test1", lovelace: "9100000", tokens: [] },
      { to: "addr_test1", lovelace: "5000000", tokens: [] },
    ];
    const summary = { index: 4, address: "addr_test1" + "q".repeat(50), payments, fee: { total: "200000" }, changeLovelace: "1000000" };
    const mix = { boxes: 2, again: true, owned: 2, lovelace: "9100000", mixes: 8, mixFees: "6600000", depth: 2, delay: "1-6", publicToo: true };
    const review = (anyway: { accounts: boolean; someoneElse: boolean }) =>
      text(createElement(PrivateReview, { summary: { ...summary, mix } as never, anyway }));
    const theirs = review({ accounts: false, someoneElse: true });
    expect(theirs).toContain(
      "Someone else, or another device, put some of these boxes in under your Seedelf key: mixing them ties this mix, and the private UTxOs it spends, to whoever did.",
    );
    expect(theirs).not.toContain("came from your public account");
    expect(review({ accounts: true, someoneElse: false })).toContain("Some of these boxes came from your public account");
    expect(review({ accounts: true, someoneElse: false })).not.toContain("Someone else");
  });

  it("flags no box someone else put in on its pool's hub row", () => {
    const row = (pool: ShownPool) => text(createElement(PoolGroupList, { group: groupPools([pool], [])[0]!, onOpen: nothing }));
    expect(row(poolOf({ boxes: [P!], notMixed: [P!], deposits: [P!], someoneElse: [P!] }))).not.toContain("not mixed yet");
    expect(row(poolOf({ boxes: [A!, P!], notMixed: [A!, P!], deposits: [A!, P!], someoneElse: [P!] }))).toContain("1 not mixed yet");
  });
});
