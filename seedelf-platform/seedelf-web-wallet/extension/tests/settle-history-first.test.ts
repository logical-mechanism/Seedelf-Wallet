// A private payment Koios didn't answer, settled once it lands (chunk 51, l2time#4). settleNow dropped its watch and
// its sealed copy first, and only then wrote its Seedelf history, which waits its turn in the history's queue behind a
// reading's write, say. A lock in between (Lock, or the auto-lock deadline passing during a background look) failed the
// write, which was swallowed, and with no watch and no sealed copy nothing settled it again: the payment was missing from
// private Activity and the CSV for good, and its change read as a payment received, which a stealth mint or a funding
// takes first, tying them to the payment its payee saw. A worker stop in the gap did the same. Its history is written
// first now, and a lock there keeps the sealed copy, so the next unlock puts the watch back and its settle writes it.
// submitWatched's take, for a payment Koios answered, had the same gap: it unsealed the copy written ahead first.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { registerOf } from "../src/background/chain";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_MINT } from "../src/background/mint";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { WithdrawService } from "../src/background/withdraw";
import type { TxDetail } from "../src/shared/rpc";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;
const SEALED = `${PRIVATE_PREFIX}maybeSent.preprod`;
const HISTORY = `${PRIVATE_PREFIX}history.preprod`;
/** A private UTxO of the wallet's own, under a fresh register: what the Make public spends. */
const OLD = "b7".repeat(32);
/** pending.ts RESEND_MS: how long a maybe-sent payment waits before it's sent again. */
const RESEND_MS = 2 * 60_000;
const SLOW = { timeout: 180_000 };
type T = ReturnType<typeof testBalances>;

/** The withdraw service with giveme.my's witness and WebAssembly's signing stood in for (Rust tests cover them). */
function privately(t: T) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new WithdrawService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
  });
}

/** Koios passes the next submit on, and then doesn't answer: the 20 s timeout fires. */
function unanswered(t: T) {
  const real = t.koios.fetch;
  let left = 1;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (url.endsWith("/submittx") && left-- > 0) throw new DOMException("signal timed out", "TimeoutError");
    return answer;
  };
}

/** A Make public of 5 ₳ to someone else, reviewed: it spends OLD, and its change comes back to the private side. */
async function reviewedMakePublic() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  const wasm = loadTestWasm();
  const base = registerOf(ownedUtxos[0]!)!;
  const fresh = wasm.rerandomize(new wasm.Register(base.generator, base.publicValue));
  const datum = Buffer.from(wasm.registerToDatum(fresh)).toString("hex");
  t.koios.added.push({
    ...ownedUtxos[0]!,
    tx_hash: OLD,
    tx_index: 0,
    value: "40000000",
    asset_list: [],
    inline_datum: { bytes: datum, value: null },
  });
  await t.balances.get("preprod");
  const withdraw = privately(t);
  const summary = await withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
  return { t, withdraw, summary };
}

/** That Make public sent, Koios not answering: maybe sent, sealed, and nothing in its history yet. */
async function maybeSentMakePublic() {
  const { t, withdraw, summary } = await reviewedMakePublic();
  unanswered(t);
  expect(await withdraw.submit("preprod", summary.txHash)).toMatchObject({ kind: "withdraw", maybeSent: true });
  expect((await t.activity.seedelf("preprod")).map((e) => e.txHash)).not.toContain(summary.txHash);
  expect(t.local.data.has(SEALED)).toBe(true);
  return { t, summary };
}

/**
 * The history's queue busy, as a reading's write keeps it: another write into the history is held at its store write
 * until `release`. `holding` once it's held; `queued` once the payment `txHash`'s history write has joined the queue.
 */
function busyHistory(t: T, txHash: string) {
  const set = t.local.set.bind(t.local);
  let release!: () => void;
  let held!: () => void;
  let joined!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const holding = new Promise<void>((r) => (held = r));
  const queued = new Promise<void>((r) => (joined = r));
  let armed = true;
  t.local.set = async (key: string, value: unknown) => {
    if (armed && key === HISTORY) {
      armed = false;
      held();
      await gate;
    }
    return set(key, value);
  };
  const sent = t.activity.sent.bind(t.activity);
  t.activity.sent = (...args: Parameters<typeof sent>) => {
    const run = sent(...args);
    if (args[1].txHash === txHash) joined();
    return run;
  };
  void t.activity
    .signedInto("preprod", { txHash: "ee".repeat(32), outputs: [0], origin: { id: "unknown", origin: "unknown" } })
    .catch(() => undefined);
  return { holding, queued, release };
}

/**
 * The Make public lands: its outputs to the wallet's own registers are read, then a stealth mint is built. Returns its
 * history entry, its change as the UTxOs screen lists it, and the mint's inputs.
 */
async function landed(t: T, txHash: string) {
  const bytes = t.koios.submitted[0]!;
  const wasm = loadTestWasm();
  const detail = JSON.parse(wasm.decodeTx(wasm.Network.Preprod, Buffer.from(bytes).toString("hex"))) as TxDetail;
  const rows: KoiosUtxo[] = detail.outputs
    .filter((o) => o.register !== null)
    .map((o) => ({
      ...ownedUtxos[0]!,
      tx_hash: txHash,
      tx_index: o.index,
      value: o.lovelace,
      asset_list: o.assets.map((a) => ({
        ...ownedUtxos[1]!.asset_list![0]!,
        policy_id: a.policyId,
        asset_name: a.assetName,
        quantity: a.quantity,
      })),
      inline_datum: { bytes: o.inlineDatum!, value: null },
      block_height: 5_212_100,
      block_time: Math.floor(t.clock.now / 1000),
    }));
  expect(rows.length).toBeGreaterThan(0);
  for (const o of txInputs(bytes)) t.koios.spent.add(o);
  t.koios.added.push(...rows);
  t.clock.now += 60_000;
  await t.wallet.touch();
  await t.balances.get("preprod", true);
  const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === txHash);
  const change = (await t.coins.lists("preprod")).seedelf.filter((u) => u.txHash === txHash);
  await t.mint.build("preprod", "", "seedelf");
  const mint = txInputs(Uint8Array.from(Buffer.from((await t.session.get<{ txCbor: string }>(SESSION_MINT))!.txCbor, "hex")));
  return { entry, change, mint };
}

/** What a landed Make public must leave: its own entry, its change as its spend's, and a mint that takes other money. */
async function settledWhole(t: T, txHash: string) {
  expect
    .soft(
      (await t.activity.seedelf("preprod")).find((e) => e.txHash === txHash),
      "the Make public in private Activity, before any reading",
    )
    .toMatchObject({ kind: "withdraw" });
  const { entry, change, mint } = await landed(t, txHash);
  expect.soft(entry?.kind, "the landed Make public's entry").toBe("withdraw");
  // Its spend's change, never a payment received, which a stealth mint and a funding take first.
  expect
    .soft(change.map((u) => u.history?.id.split("+").includes(`change:${txHash}`)), "its change names its spend")
    .toEqual(change.map(() => true));
  expect.soft(change.map((u) => u.history?.origin), "its change's origin").not.toContain("received");
  expect.soft(mint.some((o) => o.startsWith(txHash)), "the stealth mint spends the Make public's change").toBe(false);
}

describe("a maybe-sent Make public that lands keeps its Seedelf history across a lock (chunk 51, l2time#4)", () => {
  it("control: with no lock, its entry is written and its change is its spend's", SLOW, async () => {
    const { t, summary } = await maybeSentMakePublic();
    t.koios.confirmations = 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: 1 });
    await settledWhole(t, summary.txHash);
  });

  const locks: Array<[string, (t: T) => Promise<void>]> = [
    ["Lock pressed", (t) => t.wallet.lock()],
    // A background look past the auto-lock deadline: the next turn of the wallet's queue wipes the keys.
    ["the auto-lock deadline passing", async (t) => void (t.clock.now += 16 * 60_000)],
  ];
  it.each(locks)("%s while its history waits in a busy queue: the next unlock settles it again, and writes it", SLOW, async (_, lock) => {
    const { t, summary } = await maybeSentMakePublic();
    t.koios.confirmations = 1;
    const busy = busyHistory(t, summary.txHash);
    await busy.holding;
    const look = t.pending.pending("preprod");
    look.catch(() => undefined);
    await busy.queued;
    await lock(t);
    busy.release();
    await look.catch(() => undefined);
    await t.wallet.unlock(PASSWORD);
    // Put back from its sealed copy, and seen on chain again.
    expect.soft(await t.pending.pending("preprod"), "the watch put back after the unlock").toMatchObject({
      txHash: summary.txHash,
      confirmations: 1,
    });
    // Settled whole this time: nothing of it is left to put back.
    expect(await t.pending.pending("preprod")).toBeNull();
    expect(t.local.data.has(SEALED)).toBe(false);
    await settledWhole(t, summary.txHash);
  });

  // Written first now, a history that can't be written, by any throw but a lock's, one before the write's first await
  // too, must never hold the watch, or every payment on that network would wait for good. (Written after the turn, such
  // a throw failed the look, though the watch was gone.)
  it("a history that can't be written, even by a throw before its first await, never holds the watch", SLOW, async () => {
    const { t, summary } = await maybeSentMakePublic();
    t.koios.confirmations = 1;
    t.activity.sent = (() => {
      throw new TypeError("a summary the history can't read");
    }) as typeof t.activity.sent;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: 1 });
    expect(await t.pending.pending("preprod")).toBeNull();
    expect(t.local.data.has(SEALED)).toBe(false);
  });

  // Sent again and taken, its history is written before the turn that unseals it, but a lock there was let go: a lock
  // and an unlock both landing before that turn unsealed it with nothing written.
  it("sent again and taken: a lock and an unlock around its history's write never unseal it unwritten", SLOW, async () => {
    const { t, summary } = await maybeSentMakePublic();
    t.clock.now += RESEND_MS + 1_000;
    const sent = t.activity.sent.bind(t.activity);
    let once = true;
    t.activity.sent = async (...args: Parameters<typeof sent>) => {
      if (!once || args[1].txHash !== summary.txHash) return sent(...args);
      once = false;
      // The wallet locks as the history's write begins, and is unlocked again before the settle's next turn.
      await t.wallet.lock();
      try {
        return await sent(...args);
      } finally {
        await t.wallet.unlock(PASSWORD);
      }
    };
    const submits = t.koios.submitted.length;
    await t.pending.pending("preprod").catch(() => undefined);
    expect(t.koios.submitted.length, "sent again").toBe(submits + 1);
    expect(once, "its history's write reached").toBe(false);
    t.activity.sent = sent;
    t.koios.confirmations = 1;
    await t.pending.pending("preprod").catch(() => undefined);
    expect(t.local.data.has(SEALED)).toBe(false);
    await settledWhole(t, summary.txHash);
  });

  it("and one Koios answered: a lock between its take and its history leaves it sealed, and its settle writes it", SLOW, async () => {
    const { t, withdraw, summary } = await reviewedMakePublic();
    const busy = busyHistory(t, summary.txHash);
    await busy.holding;
    const sending = withdraw.submit("preprod", summary.txHash);
    sending.catch(() => undefined);
    await busy.queued;
    await t.wallet.lock();
    busy.release();
    await sending.catch(() => undefined);
    await t.wallet.unlock(PASSWORD);
    t.koios.confirmations = 1;
    await t.pending.pending("preprod").catch(() => undefined);
    expect(t.local.data.has(SEALED)).toBe(false);
    await settledWhole(t, summary.txHash);
  });
});
