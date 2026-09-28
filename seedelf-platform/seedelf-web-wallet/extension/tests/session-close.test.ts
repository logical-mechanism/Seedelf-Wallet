// A session ends, and its record goes or closes, only on positive evidence
// that its account is empty (independent review M4): what its own fundings
// and top-ups paid the account, known to Koios and spent. Koios's gateway
// balances several backends, and one behind the funding reads the account
// empty, so an empty read alone isn't enough: Disconnect, Forget and the
// runner's close all wait for Koios to catch up. The 12-word phrase, the real
// WebAssembly, and fakes of Koios, giveme.my and Minswap's aggregator.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { builtOutputs, Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, minswapEstimate, ownedUtxos, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const ORIGIN = "https://a.example";
/** A funding the chain doesn't have after this long never reached it (sessions.ts). */
const FAILED_AFTER = 20 * 60_000 + 1;
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;

type T = Awaited<ReturnType<typeof unlocked>>;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(phrase, PASSWORD);
  // One spend: the funding takes the 25 ₳ UTxO alone.
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  // More of the private balance, so a top-up can be funded too.
  t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "01".repeat(32), block_height: 9_000_001 });
  return t;
}

/** The session service with giveme.my's witness and the one-time key's signature stood in for, as sessions.test.ts does. */
function signing(t: T, runner: { start(): Promise<void> } = { start: async () => undefined }) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    alarm: runner,
  });
}

/** A UTxO at session 0's account, as Koios lists it. */
function atSession(tx_hash: string, tx_index: number, value: string): KoiosUtxo {
  return {
    tx_hash,
    tx_index,
    address: sessionSwap.address,
    value,
    stake_address: null,
    payment_cred: sessionSwap.keyHash,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    is_spent: false,
    asset_list: [],
  } as KoiosUtxo;
}

/** What transaction `tx` paid session 0's account, as `txhash#index`: read from its bytes, as the wallet does. */
function paidToSession(tx: Uint8Array): string[] {
  const id = txIdOf(tx);
  return builtOutputs(tx).flatMap((o, i) => (o.address.slice(2, 58) === sessionSwap.keyHash ? [`${id}#${i}`] : []));
}

/** Koios's backends catch up with transaction `tx`: they list what it paid session 0's account (`spent`: and that it's spent since). */
function caughtUp(t: T, tx: Uint8Array, { spent }: { spent: boolean }) {
  for (const o of paidToSession(tx)) {
    const [hash, index] = o.split("#");
    if (!t.koios.addedToAccounts.some((u) => `${u.tx_hash}#${u.tx_index}` === o)) {
      t.koios.addedToAccounts.push(atSession(hash!, Number(index), "5000000"));
    }
    if (spent) t.koios.spent.add(o);
    else t.koios.spent.delete(o);
  }
}

/** The sealed record of session 0, as the worker keeps it. */
async function record(t: T) {
  const book = await t.store.get<{ next: number; sessions: Array<{ index: number; txs: Array<{ kind: string; outs?: string[] }> }> }>(
    "sessions.preprod",
  );
  return book?.sessions.find((s) => s.index === 0);
}

/** A site's session 0, funded, its funding confirmed by tx_status. */
async function siteSession(t: T, sessions: SessionService) {
  const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
  await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN);
  t.koios.confirmations = 1;
  return t.koios.submitted.at(-1)!;
}

describe("a session's funding", () => {
  it("records what it pays the session's account, before it's sent: the amount, and the collateral", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const funding = await siteSession(t, sessions);
    const outs = paidToSession(funding);
    expect(outs).toHaveLength(2);
    expect((await record(t))!.txs[0]).toMatchObject({ kind: "out", outs });
    // A top-up's too: its payment, and a collateral, since the account as
    // read here holds none it can put up (independent review M9).
    const more = await sessions.topUpBuild("preprod", 0, "3000000", []);
    await sessions.topUpSubmit("preprod", more.txHash);
    const topUp = t.koios.submitted.at(-1)!;
    expect(paidToSession(topUp)).toHaveLength(2);
    expect((await record(t))!.txs[1]).toMatchObject({ kind: "out", outs: paidToSession(topUp) });
    // Its page never shows them.
    expect((await sessions.list("preprod"))[0]!.txs[0]).not.toHaveProperty("outs");
  });
});

describe("disconnecting a site's session", () => {
  it("refuses while Koios reads the account empty but doesn't show its funding spent, and keeps its record", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const funding = await siteSession(t, sessions);
    // tx_status says the funding landed; the backend that answers for the account is behind it: it reads empty.
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("Koios hasn't caught up with this session yet");
    expect(await record(t)).toMatchObject({ index: 0, txs: [{ kind: "out" }] });
    expect(await t.store.get("sessions.preprod")).toMatchObject({ next: 1 });

    // Caught up: the money is there.
    caughtUp(t, funding, { spent: false });
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("Bring it back first");

    // A backend that knows the funding but not what's at the account now: it doesn't list it, and doesn't say it's spent.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.includes("/credential_utxos") ? Response.json([]) : real(url, init));
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("Koios hasn't caught up with this session yet");
    t.koios.fetch = real;

    // Spent (the site's own transaction took it all elsewhere), and the account is empty: disconnected, its record gone.
    caughtUp(t, funding, { spent: true });
    await sessions.disconnect("preprod", 0);
    expect(await t.store.get("sessions.preprod")).toEqual({ next: 1, sessions: [] });
  });

  it("waits for a top-up's outputs too, not only the funding's", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const funding = await siteSession(t, sessions);
    caughtUp(t, funding, { spent: true });
    const more = await sessions.topUpBuild("preprod", 0, "3000000", []);
    await sessions.topUpSubmit("preprod", more.txHash);
    const topUp = t.koios.submitted.at(-1)!;
    // The top-up landed; the account's read is behind it.
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("Koios hasn't caught up with this session yet");
    caughtUp(t, topUp, { spent: true });
    await sessions.disconnect("preprod", 0);
    expect(await record(t)).toBeUndefined();
  });

  it("ends a session whose funding never landed, unless Koios knows it did", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // Its funding went out more than twenty minutes ago, and tx_status has never shown it.
    const funding = "0a".repeat(32);
    const outs = [`${funding}#0`, `${funding}#1`];
    const at = t.clock.now - FAILED_AFTER;
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        { index: 0, ownStake: true, createdAt: at, txs: [{ kind: "out", txHash: funding, at, outs }], site: { origin: ORIGIN } },
      ],
    });
    expect((await sessions.list("preprod", true))[0]).toMatchObject({ stage: "failed" });

    // But Koios knows its outputs, unspent, though the account's read doesn't list them: it landed after all.
    t.koios.addedToAccounts.push(atSession(funding, 0, "15000000"), atSession(funding, 1, "5000000"));
    const real = t.koios.fetch;
    t.koios.fetch = hiding(t, outs);
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("Koios hasn't caught up with this session yet");
    expect(await record(t)).toBeDefined();

    // Unknown to Koios: it never landed, and the empty session ends.
    t.koios.fetch = real;
    t.koios.addedToAccounts.length = 0;
    await sessions.disconnect("preprod", 0);
    expect(await record(t)).toBeUndefined();
  });

  it("ends a session from before its outputs were recorded as it did: on the account's read", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const now = t.clock.now;
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [{ kind: "out", txHash: "0f".repeat(32), at: now, confirmed: true }],
          site: { origin: ORIGIN },
        },
      ],
    });
    await sessions.disconnect("preprod", 0);
    expect(await t.store.get("sessions.preprod")).toEqual({ next: 1, sessions: [] });
    expect(t.koios.calls.map((c) => c.path)).not.toContain("utxo_info");
  });
});

describe("disconnecting a site's session with something left behind (independent review L19)", () => {
  /** A site's session 0, its funding in and brought back, that recorded `left` as left behind at its account. */
  async function leftBehind(t: T, left: Array<[string, "fee" | "script"]>) {
    const now = t.clock.now;
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [{ kind: "out", txHash: "0f".repeat(32), at: now, confirmed: true }],
          site: { origin: ORIGIN },
          leftBehind: left.map(([h, reason]) => ({ txHash: h.repeat(32), txIndex: 0, reason, lovelace: "1200000" })),
        },
      ],
    });
  }

  it("forgets what a transaction took since, and the record with it when nothing's left", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // Too little to pay its way back, once; a later return (or the site) took it after all.
    await leftBehind(t, [["e3", "fee"]]);
    t.koios.addedToAccounts.push(atSession("e3".repeat(32), 0, "1200000"));
    t.koios.spent.add(`${"e3".repeat(32)}#0`);
    await sessions.disconnect("preprod", 0);
    // Nothing points anywhere: the record goes, the site's origin with it.
    expect(await t.store.get("sessions.preprod")).toEqual({ next: 1, sessions: [] });
  });

  it("keeps the record, closed, for what's still at the account, and only that", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await leftBehind(t, [
      ["e3", "fee"],
      ["e4", "script"],
    ]);
    t.koios.addedToAccounts.push(atSession("e3".repeat(32), 0, "1200000"), atSession("e4".repeat(32), 0, "1200000"));
    t.koios.spent.add(`${"e3".repeat(32)}#0`);
    await sessions.disconnect("preprod", 0);
    const [view] = await sessions.list("preprod");
    expect(view).toMatchObject({ stage: "closed", leftBehind: [{ txHash: "e4".repeat(32), reason: "script" }] });
    const kept = await t.store.get<{ sessions: Array<{ leftBehind: unknown[] }> }>("sessions.preprod");
    expect(kept!.sessions[0]!.leftBehind).toHaveLength(1);
  });

  it("waits for Koios, rather than forget it, when it's the session's own and the read doesn't list it", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // The funding's leftover, too little to pay its way back: left behind. Koios knows it, unspent.
    const now = t.clock.now;
    const funding = "0a".repeat(32);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [{ kind: "out", txHash: funding, at: now, confirmed: true, outs: [`${funding}#0`] }],
          site: { origin: ORIGIN },
          leftBehind: [{ txHash: funding, txIndex: 0, reason: "fee", lovelace: "1200000" }],
        },
      ],
    });
    t.koios.addedToAccounts.push(atSession(funding, 0, "1200000"));
    // A read behind it doesn't list it: refused, never taken for gone.
    const real = t.koios.fetch;
    t.koios.fetch = hiding(t, [`${funding}#0`]);
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("Koios hasn't caught up with this session yet");
    // Listed: the record stays, closed, for it.
    t.koios.fetch = real;
    await sessions.disconnect("preprod", 0);
    expect((await sessions.list("preprod"))[0]).toMatchObject({ stage: "closed", leftBehind: [{ txHash: funding }] });
  });
});

describe("forgetting a swap whose funding never showed", () => {
  it("won't, once Koios knows its funding landed: the swap goes on", async () => {
    const t = await unlocked();
    const runner = { on: false, start: async () => void (runner.on = true) };
    const sessions = signing(t, runner);
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    const out = await sessions.outBuild("preprod", quote);
    await sessions.outSubmit("preprod", out.txHash);
    const funding = t.koios.submitted.at(-1)!;
    // Twenty minutes, and neither tx_status nor the account's read shows it: the runner finds it never funded.
    await busy(t, FAILED_AFTER);
    expect((await sessions.advance("preprod", 0)).stage).toBe("failed");
    runner.on = false;

    // Koios knows its outputs, though the backend that reads the account is behind.
    caughtUp(t, funding, { spent: false });
    t.koios.fetch = hiding(t, paidToSession(funding));
    await expect(sessions.forget("preprod", 0)).rejects.toThrow("Its funding reached the chain after all");
    // Not forgotten: its funding counts as landed, and the swap runs again.
    const [view] = await sessions.list("preprod");
    expect(view).toMatchObject({ index: 0, stage: "open", auto: { step: "ordering" } });
    expect(view!.txs[0]).toMatchObject({ kind: "out", confirmed: true });
    expect(runner.on).toBe(true);
  });

  it("forgets one whose funding Koios knows landed once all it paid is spent: resumed, it would wait for good", async () => {
    const t = await unlocked();
    const runner = { on: false, start: async () => void (runner.on = true) };
    const sessions = signing(t, runner);
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", minswapEstimate.ask));
    await sessions.outSubmit("preprod", out.txHash);
    const funding = t.koios.submitted.at(-1)!;
    await busy(t, FAILED_AFTER);
    expect((await sessions.advance("preprod", 0)).stage).toBe("failed");
    runner.on = false;

    // Koios knows its outputs, both spent (another browser's session on the same account swept them, say).
    caughtUp(t, funding, { spent: true });
    expect(await sessions.forget("preprod", 0)).toEqual([]);
    expect(await record(t)).toBeUndefined();
    expect(runner.on).toBe(false);
  });

  it("forgets one Koios knows nothing of, and one never sent without asking", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    const out = await sessions.outBuild("preprod", quote);
    await sessions.outSubmit("preprod", out.txHash);
    await busy(t, FAILED_AFTER);
    expect((await sessions.advance("preprod", 0)).stage).toBe("failed");
    const asked = () => t.koios.calls.filter((c) => c.path === "utxo_info").flatMap((c) => c.body._utxo_refs as string[]);
    expect(await sessions.forget("preprod", 0)).toEqual([]);
    expect(asked()).toEqual(paidToSession(t.koios.submitted.at(-1)!));

    // Turned away: it never went out, so there's nothing to ask about.
    t.koios.rejectSubmit = "ValueNotConservedUTxO";
    const next = await sessions.outBuild("preprod", quote);
    await expect(sessions.outSubmit("preprod", next.txHash)).rejects.toThrow();
    expect((await sessions.list("preprod", true))[0]).toMatchObject({ index: 1, stage: "failed", unsent: true });
    const before = asked().length;
    expect(await sessions.forget("preprod", 1)).toEqual([]);
    expect(asked()).toHaveLength(before);
  });
});

describe("a swap that runs itself", () => {
  it("is over only once Koios shows its funding spent, whatever an empty read of its account says", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", minswapEstimate.ask));
    await sessions.outSubmit("preprod", out.txHash);
    const funding = t.koios.submitted.at(-1)!;
    await sessions.stop("preprod", 0);
    // The funding lands (the recorded swap's UTxO stands in for it at the account), and comes back.
    t.koios.confirmations = 1;
    t.koios.addedToAccounts.push(atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value));
    await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted).toHaveLength(2);
    t.koios.spent.add(`${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`);

    // The return landed and the account reads empty, but Koios doesn't know what the funding paid it yet.
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("open");
    expect((await sessions.list("preprod", true))[0]!.stage).toBe("open");
    // Known, and not spent: still not over.
    caughtUp(t, funding, { spent: false });
    t.koios.fetch = hiding(t, paidToSession(funding));
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("open");
    expect((await sessions.list("preprod", true))[0]!.stage).toBe("open");
    // Spent: over.
    caughtUp(t, funding, { spent: true });
    expect((await sessions.advance("preprod", 0, true)).stage).toBe("closed");
  });

  it("isn't closed by a page's reading until Koios shows its funding spent, and a failed look leaves it for the next", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const now = t.clock.now;
    const funding = "0a".repeat(32);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [
            { kind: "out", txHash: funding, at: now, confirmed: true, outs: [`${funding}#0`, `${funding}#1`] },
            { kind: "back", txHash: "0b".repeat(32), at: now, confirmed: true },
          ],
        },
      ],
    });
    expect((await sessions.list("preprod", true))[0]!.stage).toBe("open");
    // Koios can't be asked now: the reading still answers, and the session waits.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.includes("/utxo_info") ? new Response("", { status: 400 }) : real(url, init));
    expect((await sessions.list("preprod", true))[0]!.stage).toBe("open");
    t.koios.fetch = real;
    t.koios.addedToAccounts.push(atSession(funding, 0, "15000000"), atSession(funding, 1, "5000000"));
    t.koios.spent.add(`${funding}#0`).add(`${funding}#1`);
    expect((await sessions.list("preprod", true))[0]!.stage).toBe("closed");
  });
});

/** Moves the clock on by `ms`, the user busy all along, so the wallet doesn't lock itself. */
async function busy(t: T, ms: number) {
  for (let left = ms; left > 0; left -= 10 * 60_000) {
    t.clock.now += Math.min(left, 10 * 60_000);
    await t.wallet.touch();
  }
}

/** A backend behind the account's read: `credential_utxos` doesn't list `outs`, which `utxo_info` knows. */
function hiding(t: T, outs: string[]) {
  const real = t.koios.fetch;
  return async (url: string, init: RequestInit) => {
    const answer = await real(url, init);
    if (!url.includes("/credential_utxos")) return answer;
    const rows = (await answer.json()) as KoiosUtxo[];
    return Response.json(rows.filter((u) => !outs.includes(`${u.tx_hash}#${u.tx_index}`)));
  };
}
