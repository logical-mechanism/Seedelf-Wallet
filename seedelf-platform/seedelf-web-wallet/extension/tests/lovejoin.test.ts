// Lovejoin in the worker (lovejoin.ts, and sessions.ts's return through it),
// with the real WebAssembly module, a recorded preprod pool, and fake Koios
// and giveme.my. Every chain is measured against the deployed scripts inside
// WebAssembly, as it is in the wallet.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readAccount, readAccountUtxos } from "../src/background/account";
import { bodyOutpoints, txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { KoiosError, SpentInputError, type KoiosUtxo } from "../src/background/koios";
import {
  CHAIN_CUT,
  CHAIN_POLL_MS,
  CHAIN_PUMP_MS,
  CHAIN_RESEND_MS,
  CHAIN_WINDOW,
  chainRetryMs,
  LovejoinService,
  MAX_CHAIN_MIXES,
  MAX_DEPOSIT_BOXES,
  mixesPerBox,
  pumpChain,
  QUIET_AFTER_SEND_MS,
  QUIET_PUSH_MS,
  QUIET_PUSHES,
  secureRandom,
  SESSION_LOVEJOIN_PUBLIC,
  UNLOCK_WAIT_MS,
  unlockWait,
  WITHDRAW_SPREAD_MS,
  type ChainProgress,
} from "../src/background/lovejoin";
import { MAYBE_SENT_WAIT, pendingKey } from "../src/background/pending";
import { nothingToSpend, readContract } from "../src/background/script-spend";
import { outpoint, SESSION_SPENT } from "../src/background/spent";
import { SESSION_WITHDRAW } from "../src/background/withdraw";
import { Minswap } from "../src/background/minswap";
import { lovejoinOn, NETWORKS } from "../src/networks";
import { SESSION_CHAIN_PREFIX, SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { bytes, swapTx } from "./fixtures/swap-tx";
import { koiosPreprod, loadTestWasm, minswapEstimate, sessionSwap, testBalances, testWallet, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

/**
 * Each test builds and measures real transactions in WebAssembly (proofs and
 * script runs, about 110 ms a mix): a few seconds each here, and more than
 * twice that on CI's runners, past Vitest's 5 s.
 */
const CHAINS = { timeout: 30_000 };

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

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

/** An unlocked wallet with a site's private session 0 holding `lovelace` and its 5 ₳ collateral, and Lovejoin's pool. */
async function withSession(lovelace: string) {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
        site: { origin: "https://example.org" },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, lovelace), atSession("c2".repeat(32), 1, "5000000"), ...POOL);
  // The network measures a chain's first mix within what it declares.
  t.koios.evaluation = AGREES;
  const sessions = new SessionService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: t.lovejoin,
    sleep: async () => undefined,
  });
  return { t, sessions };
}

describe("where Lovejoin is", () => {
  it("is on both networks, from one source the worker and the UI read", () => {
    expect(lovejoinOn("preprod")).toBe(true);
    expect(lovejoinOn("mainnet")).toBe(true);
    const t = testBalances();
    expect(t.lovejoin.available("preprod")).toBe(true);
    expect(t.lovejoin.available("mainnet")).toBe(true);
  });

  it("sits at each network's own mix_box, with mainnet's pool floor at 30 and preprod's at none", () => {
    expect(NETWORKS.preprod.lovejoin).toMatchObject({ mixBox: "67ffe4ed7f0ccd0a3e3069fddc26d9bccde3fe63d3d58c5e84f7ecc5", poolFloor: 0 });
    expect(NETWORKS.mainnet.lovejoin).toMatchObject({ mixBox: "c145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad", poolFloor: 30 });
  });

  it("builds a mainnet funding as it does preprod's", () => {
    const wasm = loadTestWasm();
    const ask = (network: string) => JSON.parse(wasm.lovejoinFunding(JSON.stringify({ network, boxes: 1, depth: 2, again: false })));
    expect(ask("mainnet")).toEqual(ask("preprod"));
  });
});

describe("the wait after an unlock", () => {
  it("falls inside the stretch the auto-lock keeps the wallet open: 2 minutes on at least, at most 2 before it locks, and never past 20", () => {
    const min = 60_000;
    for (const [lock, most] of [
      [1, 2],
      [5, 3],
      [15, 13],
      [30, 20],
      [60, 20],
    ] as const) {
      expect(unlockWait(lock * min, () => 0)).toBe(2 * min);
      const high = unlockWait(lock * min, () => 1 - 2 ** -53);
      expect(high).toBeLessThanOrEqual(most * min);
      expect(high).toBeGreaterThan(most * min - 1_000);
    }
  });
});

describe("a box's delay", () => {
  it("is drawn from the secure random source, uniformly in [0, 1)", () => {
    const draws = Array.from({ length: 2000 }, secureRandom);
    expect(draws.every((d) => d >= 0 && d < 1)).toBe(true);
    expect(new Set(draws).size).toBe(draws.length);
    // Both halves of the range turn up about equally.
    const low = draws.filter((d) => d < 0.5).length;
    expect(low).toBeGreaterThan(800);
    expect(low).toBeLessThan(1200);
  });
});

describe("sending a chain a window at a time", () => {
  it("keeps at most four in the mempool, sends more as blocks take them, and leaves the rest for the next call", async () => {
    const txs = Array.from({ length: 10 }, (_, i) => ({ kind: "mix" as const, txCbor: "", txHash: `t${i}`, fee: "0" }));
    const chain = { txs, next: 0, flying: [] as string[] };
    const landed = new Set<string>();
    const sent: number[] = [];
    let most = 0;
    let sleeps = 0;
    const io = {
      send: async (i: number) => {
        sent.push(i);
        most = Math.max(most, chain.flying.length + 1);
      },
      onChain: async (hashes: string[]) => new Set(hashes.filter((h) => landed.has(h))),
      save: async () => undefined,
      sleep: async () => void sleeps++,
      now: () => 0,
    };
    // Nothing lands: four go, and the call ends after about a block of looking.
    expect(await pumpChain(chain, io, CHAIN_PUMP_MS)).toBe(false);
    expect(sent).toEqual([0, 1, 2, 3]);
    expect(sleeps).toBe(CHAIN_PUMP_MS / CHAIN_POLL_MS);
    // A block takes three: three more go.
    for (const h of ["t0", "t1", "t2"]) landed.add(h);
    expect(await pumpChain(chain, io, 0)).toBe(false);
    expect(sent).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // They all land: the rest go, and it's done.
    for (const t of txs) landed.add(t.txHash);
    expect(await pumpChain(chain, io, CHAIN_PUMP_MS)).toBe(true);
    expect(sent).toHaveLength(10);
    expect(most).toBe(CHAIN_WINDOW);
  });

  /** A chain of `n` and the clock its pump reads, moved on by each sleep. */
  function pumped(n: number) {
    const txs = Array.from({ length: n }, (_, i) => ({ kind: "mix" as const, txCbor: "", txHash: `t${i}`, fee: "0" }));
    const chain: ChainProgress = { txs, next: 0, flying: [] };
    const clock = { now: 0 };
    const sent: Array<[number, boolean]> = [];
    const io = {
      send: async (i: number, maybeSent: boolean) => void sent.push([i, maybeSent]),
      onChain: async (_hashes: string[]): Promise<Set<string>> => new Set(),
      save: async () => undefined,
      sleep: async (ms: number) => void (clock.now += ms),
      now: () => clock.now,
    };
    return { chain, clock, sent, io };
  }

  it("sees nothing yet when Koios doesn't answer the read of what's on chain, and goes on at the next call", async () => {
    const { chain, sent, io } = pumped(6);
    io.onChain = async () => {
      throw new KoiosError("Koios is having trouble right now (502 for tx_status). Try again in a minute.");
    };
    expect(await pumpChain(chain, io, CHAIN_PUMP_MS)).toBe(false);
    expect(chain.flying).toHaveLength(CHAIN_WINDOW);
    // Koios answers again, and the blocks have taken them.
    io.onChain = async (hashes) => new Set(hashes);
    expect(await pumpChain(chain, io, 0)).toBe(true);
    expect(sent.map(([i]) => i)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("still stops for what isn't Koios's", async () => {
    const { chain, io } = pumped(6);
    io.onChain = async () => {
      throw new Error("The wallet is locked.");
    };
    await expect(pumpChain(chain, io, CHAIN_PUMP_MS)).rejects.toThrow("locked");
  });

  it("sends the oldest again once it has waited a few blocks without landing, and not again sooner", async () => {
    const { chain, clock, sent, io } = pumped(6);
    expect(await pumpChain(chain, io, CHAIN_RESEND_MS - CHAIN_POLL_MS)).toBe(false);
    expect(sent).toEqual([0, 1, 2, 3].map((i) => [i, false]));
    // Three minutes on, still nothing: a node dropped it, and every one after it, which spends its change. They
    // all go again, in order, as maybe in already (independent review L25).
    expect(await pumpChain(chain, io, CHAIN_POLL_MS)).toBe(false);
    expect(sent.slice(4)).toEqual([0, 1, 2, 3].map((i) => [i, true]));
    expect(chain.sentAt).toEqual([clock.now, clock.now, clock.now, clock.now]);
    // It lands, and the rest go.
    io.onChain = async (hashes) => new Set(hashes.filter((h) => h === "t0"));
    await pumpChain(chain, io, 0);
    expect(sent.slice(8)).toEqual([[4, false]]);
  });

  it("marks a send before it begins, so one a stopped worker left unfinished counts as maybe in", async () => {
    const { chain, sent, io } = pumped(6);
    let saved = "";
    io.save = async () => void (saved = JSON.stringify(chain));
    // The worker stops while the deposit's send backs off.
    io.send = async () => {
      throw new Error("stopped");
    };
    await expect(pumpChain(chain, io, 0)).rejects.toThrow("stopped");
    const resumed = JSON.parse(saved) as ChainProgress;
    expect(resumed).toMatchObject({ next: 0, sending: 0 });
    io.send = async (i, maybeSent) => void sent.push([i, maybeSent]);
    await pumpChain(resumed, io, 0);
    expect(sent.slice(0, 2)).toEqual([
      [0, true],
      [1, false],
    ]);
    expect(resumed.sending).toBeUndefined();
  });

  it("tries a first transaction refused as spent again when it may be in already", () => {
    const refused = new SpentInputError("already spent");
    expect(chainRetryMs(0, { busy: 0, spent: 0 }, refused)).toBeUndefined();
    expect(chainRetryMs(0, { busy: 0, spent: 0, maybeSent: true }, refused)).toBeGreaterThan(0);
  });
});

describe("a session's return through Lovejoin", CHAINS, () => {
  it("sends the spare ADA through the mixer first, the whole chain in order, then sets the boxes' withdraws", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    // 40 ₳ spare pays for two boxes at depth 2: four mixes each.
    expect(review.lovejoin).toMatchObject({ boxes: 2, depth: 2, mixes: 8, txs: 10, delay: "1-6" });
    // One pool read for the chain.
    expect(t.koios.calls.filter((c) => c.path === "credential_utxos" && c.body._payment_credentials[0] === NETWORKS.preprod.lovejoin!.mixBox)).toHaveLength(1);
    // And one evaluate: the network measures the first mix, given the unsent deposit's three outputs.
    const checks = t.koios.calls.filter((c) => c.path === "ogmios");
    expect(checks).toHaveLength(1);
    expect(checks[0]!.body.params.additionalUtxo).toHaveLength(3);
    expect(checks[0]!.body.params.additionalUtxo[0]).toMatchObject({ index: 0, value: { ada: { lovelace: 10_000_000 } } });

    const submittedBefore = t.koios.submitted.length;
    const sent = await sessions.backSubmit("preprod", review.txHash);
    expect(sent).toMatchObject({ kind: "session-back", txHash: review.txHash });
    // Paced: four wait in the mempool, and no more go until a block takes some.
    expect(t.koios.submitted.length - submittedBefore).toBe(4);
    expect((await sessions.list("preprod"))[0]!.chain).toEqual({ total: 10, sent: 4, confirmed: 0, cut: false });
    await expect(sessions.backBuild("preprod", 0)).rejects.toThrow("still being sent");
    // Blocks take them: the alarm's next run sends the rest, a window at a time.
    t.koios.confirmations = 1;
    await sessions.runAll("preprod");
    const chain = t.koios.submitted.slice(submittedBefore);
    expect(chain).toHaveLength(10);
    expect(txIdOf(chain.at(-1)!)).toBe(review.txHash);

    // The session's record knows every one, in order: the deposit, the mixes, the return.
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ kind: string; txHash: string }> }> }>("sessions.preprod"))!;
    const kinds = book.sessions[0]!.txs.slice(1).map((x) => x.kind);
    expect(kinds).toEqual(["deposit", ...Array(8).fill("mix"), "back"]);
    expect(book.sessions[0]!.txs.slice(1).map((x) => x.txHash)).toEqual(chain.map((bytes) => txIdOf(bytes)));
    // Its progress: all ten sent and, read again, on chain.
    expect((await sessions.list("preprod", true))[0]!.chain).toEqual({ total: 10, sent: 10, confirmed: 10, cut: false });

    // Each box comes back on its own, 1 to 6 hours from now.
    const schedule = (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!;
    expect(schedule.due).toHaveLength(2);
    for (const due of schedule.due) {
      expect(due).toBeGreaterThanOrEqual(t.clock.now + HOUR);
      expect(due).toBeLessThanOrEqual(t.clock.now + 6 * HOUR);
    }
    // Home shows them from the schedule, without asking Koios.
    const calls = t.koios.calls.length;
    expect(await t.lovejoin.held("preprod")).toEqual({ boxes: 2, lovelace: "20000000", next: Math.min(...schedule.due), notMixed: 0, stopped: 0 });
    expect(t.koios.calls.length).toBe(calls);
    expect(await t.lovejoin.held("mainnet")).toEqual({ boxes: 0, lovelace: "0", next: null, notMixed: 0, stopped: 0 });
  });

  it("sends a transaction of the chain again when Koios didn't answer it, and finishes the chain", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    // Blocks take each window as it goes.
    t.koios.confirmations = 1;
    // The third submit (a mix) gets a 503 once, as a busy Koios answers.
    const fetch = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx") && ++submits === 3) return new Response("", { status: 503 });
      return fetch(url, init);
    };
    const before = t.koios.submitted.length;
    // Send sends the first four; the alarm's next run the rest.
    await sessions.backSubmit("preprod", review.txHash);
    await sessions.runAll("preprod");
    expect(t.koios.submitted.slice(before)).toHaveLength(10);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(review.txHash);
  });

  it("keeps the chain when Koios doesn't answer a read of what's on chain, and finishes it later", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    const before = t.koios.submitted.length;
    await sessions.backSubmit("preprod", review.txHash);
    // Blocks take them, but Koios answers every read of tx_status with a 502 for a while.
    t.koios.confirmations = 1;
    const fetch = t.koios.fetch;
    let down = true;
    t.koios.fetch = async (url, init) => (down && url.endsWith("/tx_status") ? new Response("", { status: 502 }) : fetch(url, init));
    await sessions.runAll("preprod");
    const view = (await sessions.list("preprod"))[0]!;
    expect(view.chain).toEqual({ total: 10, sent: 4, confirmed: 0, cut: false });
    // Koios is back: the alarm's next run sends the rest.
    down = false;
    await sessions.runAll("preprod");
    expect(t.koios.submitted.slice(before)).toHaveLength(10);
    expect((await sessions.list("preprod"))[0]!.chain).toMatchObject({ total: 10, sent: 10, cut: false });
  });

  it("carries on when a transaction Koios didn't answer went in anyway: its resends are refused as spent until it's on chain", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    // Found on preprod: the third goes in, but Koios's answer is lost (a 503 here, a 20 s timeout there). Sent
    // again, it's refused as spending what's spent: it's in the mempool. Six refusals later (a minute) it's in a block.
    const fetch = t.koios.fetch;
    let submits = 0;
    let third: string | undefined;
    let refused = 0;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx")) {
        const id = txIdOf(init!.body as Uint8Array);
        if (++submits === 3) {
          third = id;
          await fetch(url, init);
          return new Response("", { status: 503 });
        }
        if (id === third && t.koios.confirmations === null) {
          if (++refused === 6) t.koios.confirmations = 1;
          return new Response("TxValidationErrorInCardanoMode (BadInputsUTxO)", { status: 400 });
        }
      }
      return fetch(url, init);
    };
    const before = t.koios.submitted.length;
    await sessions.backSubmit("preprod", review.txHash);
    await sessions.runAll("preprod");
    expect(refused).toBe(6);
    expect(t.koios.submitted.slice(before)).toHaveLength(10);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(review.txHash);
    const chain = (await sessions.list("preprod"))[0]!.chain!;
    expect(chain).toMatchObject({ total: 10, sent: 10, cut: false });
    expect(chain.stopped).toBeUndefined();
  });

  it("counts a chain that stopped partway, says why, and brings the rest back directly", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    // The fourth transaction is refused for good: the chain stops there.
    const fetch = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx") && ++submits === 4) return new Response("ValueNotConservedUTxO", { status: 400 });
      return fetch(url, init);
    };
    await expect(sessions.backSubmit("preprod", review.txHash)).rejects.toThrow();
    // It says why, on the session, in full.
    expect((await sessions.list("preprod"))[0]!.chain).toEqual({
      total: 10,
      sent: 3,
      confirmed: 0,
      cut: false,
      stopped: "The network rejected the transaction: ValueNotConservedUTxO",
    });
    // Brought back again: what's left comes back directly, and the chain says it stopped.
    const direct = await sessions.backBuild("preprod", 0);
    expect(direct.lovejoin).toBeUndefined();
    await sessions.backSubmit("preprod", direct.txHash);
    expect((await sessions.list("preprod"))[0]!.chain).toMatchObject({ total: 10, sent: 3, confirmed: 0, cut: true });
  });

  it("lets a session whose chain went through whole, paid again later, come back through Lovejoin again", async () => {
    const whole = await withSession("40000000");
    const first = await whole.sessions.backBuild("preprod", 0);
    whole.t.koios.confirmations = 1;
    await whole.sessions.backSubmit("preprod", first.txHash);
    await whole.sessions.runAll("preprod");
    whole.t.clock.now += 60_000;
    whole.t.koios.spent.add(`${"c1".repeat(32)}#0`).add(`${"c2".repeat(32)}#1`);
    whole.t.koios.addedToAccounts.push(atSession("c3".repeat(32), 0, "40000000"), atSession("c4".repeat(32), 1, "5000000"));
    // The first chain took 16 of the 20 pool boxes: one wave deep, the 4 left mix two.
    await whole.t.deps.preferences.set({ lovejoinDepth: 1 });
    const again = await whole.sessions.backBuild("preprod", 0);
    expect(again.lovejoin).toMatchObject({ boxes: 2, depth: 1 });
  });

  it("never puts up a stranger's 5 ₳ carrying a reference script as the chain's collateral", async () => {
    const { t, sessions } = await withSession("40000000");
    // Listed first, it looks like the session's collateral; the wallet's evaluator can't take it.
    t.koios.addedToAccounts.unshift({
      ...atSession("c3".repeat(32), 0, "5000000"),
      reference_script: { hash: "ab".repeat(28), size: 3, type: "timelock", bytes: "820080" },
    });
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toMatchObject({ boxes: 2, depth: 2 });
    // It comes back with the return, which pays for its script's bytes.
    expect(review.leftOut).toEqual([]);
  });

  it("never sends a session's other kept return while its chain is on its way (final review lovejoin-4)", async () => {
    const { t, sessions } = await withSession("40000000");
    // Its page reviews a return, and Bring everything back reviews one too; that one is sent first.
    const first = await sessions.backBuild("preprod", 0);
    const { returns } = await sessions.claimBuild("preprod", [0]);
    expect((await sessions.claimSubmit("preprod", [returns[0]!.txHash])).sent).toHaveLength(1);
    const chain = returns[0]!.txHash;
    const progress = () => t.wallet.withKeys(() => t.session.get<{ txs: Array<{ txHash: string }> }>(`${SESSION_CHAIN_PREFIX}preprod.0`));
    expect((await progress())!.txs.at(-1)!.txHash).toBe(chain);

    // The page's Send, within its ten minutes: refused, and the chain on its way stays as it is.
    const before = t.koios.submitted.length;
    await expect(sessions.backSubmit("preprod", first.txHash)).rejects.toThrow("still being sent");
    expect(t.koios.submitted).toHaveLength(before);
    expect((await progress())!.txs.at(-1)!.txHash).toBe(chain);
    expect((await sessions.list("preprod"))[0]!.chain).toEqual({ total: 10, sent: 4, confirmed: 0, cut: false });
    const { chains } = await t.lovejoin.status("preprod");
    expect(chains).toHaveLength(1);
    expect(chains[0]).toMatchObject({ session: 0, total: 10, sent: 4 });
    expect(chains[0]!.stopped).toBeUndefined();

    // It goes on to the end.
    t.koios.confirmations = 1;
    await sessions.runAll("preprod");
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(chain);
  });

  it("comes back directly when asked, or when the spare ADA doesn't pay for a box", async () => {
    const { t, sessions } = await withSession("40000000");
    const direct = await sessions.backBuild("preprod", 0, true);
    expect(direct.lovejoin).toBeUndefined();
    expect(direct.inputs).toBe(2);

    const small = await withSession("8000000");
    const plain = await small.sessions.backBuild("preprod", 0);
    expect(plain.lovejoin).toBeUndefined();
    // No pool read: the plan said no box before anything was fetched.
    expect(small.t.koios.calls.some((c) => c.path === "credential_utxos" && c.body._payment_credentials[0] === NETWORKS.preprod.lovejoin!.mixBox)).toBe(false);
    void t;
  });
});

describe("a session's collateral (privacy review §2.15)", CHAINS, () => {
  it("is the one its funding paid, before any other 5 ₳ at the account", async () => {
    const { t, sessions } = await withSession("40000000");
    // The funding's own, listed after a stranger's 5 ₳ (withSession's c2…#1).
    t.koios.addedToAccounts.push(atSession("ab".repeat(32), 1, "5000000"));
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toMatchObject({ boxes: 2 });
    const before = t.koios.submitted.length;
    await sessions.backSubmit("preprod", review.txHash);
    // The first mix, after the deposit, puts up the funding's collateral.
    expect(bodyOutpoints(t.koios.submitted[before + 1]!, 13)).toEqual([`${"ab".repeat(32)}#1`]);
  });

  it("gone, the return comes back directly and says why, when its spare ADA would have paid for a box", async () => {
    const { t, sessions } = await withSession("40000000");
    // Something the site signed spent the 5 ₳.
    t.koios.addedToAccounts = t.koios.addedToAccounts.filter((u) => u.tx_hash !== "c2".repeat(32));
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe("its 5 ₳ collateral isn't at its account anymore, and the mixes need it");
    await sessions.backSubmit("preprod", review.txHash);
    expect((await sessions.list("preprod"))[0]!.lovejoinSkipped).toBe(review.lovejoinSkipped);

    // Too little to pay for a box: nothing to say.
    const small = await withSession("8000000");
    small.t.koios.addedToAccounts = small.t.koios.addedToAccounts.filter((u) => u.tx_hash !== "c2".repeat(32));
    expect((await small.sessions.backBuild("preprod", 0)).lovejoinSkipped).toBeUndefined();
  });
});

describe("returns with Lovejoin turned off in Settings (privacy review §4.1)", CHAINS, () => {
  it("come back directly, without reading the pool or saying Lovejoin was left out", async () => {
    const { t, sessions } = await withSession("40000000");
    await t.deps.preferences.set({ lovejoinReturns: false });
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBeUndefined();
    expect(review.inputs).toBe(2);
    expect(t.koios.calls.some((c) => c.path === "credential_utxos" && c.body._payment_credentials[0] === NETWORKS.preprod.lovejoin!.mixBox)).toBe(false);
    // Bring everything back too.
    const claimed = await sessions.claimBuild("preprod", [0]);
    expect(claimed.returns[0]!.lovejoin).toBeUndefined();
    // Turned on again, the same return goes through it.
    await t.deps.preferences.set({ lovejoinReturns: true });
    expect((await sessions.backBuild("preprod", 0)).lovejoin).toMatchObject({ boxes: 2 });
  });
});

describe("the network's check", CHAINS, () => {
  it("leaves Lovejoin out, and brings it back directly, when the network measures the first mix above what it declares", async () => {
    const { t, sessions } = await withSession("40000000");
    t.koios.evaluation = {
      jsonrpc: "2.0",
      result: [{ validator: { purpose: "withdraw", index: 0 }, budget: { memory: 20_000_000, cpu: 10_000_000_000 } }],
    };
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe("the network measures its scripts above what the wallet declared");
    expect(review.inputs).toBe(2);
  });

  it("leaves it out too when the network refuses a script", async () => {
    const { t, sessions } = await withSession("40000000");
    t.koios.evaluation = { jsonrpc: "2.0", error: { code: 3010, message: "Some scripts of the transaction terminated with error(s).", data: [] } };
    expect((await sessions.backBuild("preprod", 0)).lovejoinSkipped).toMatch(/refused|couldn't evaluate/);
  });

  /** Ogmios's answer naming the first pool box a transaction spends as unknown: a pool read that was behind. */
  const unknownBox = (cbor: string) => {
    const poolRefs = new Set(POOL.map((u) => `${u.tx_hash}#${u.tx_index}`));
    const box = txInputs(Uint8Array.from(Buffer.from(cbor, "hex"))).find((o) => poolRefs.has(o))!;
    const [id, index] = box.split("#");
    return {
      box,
      answer: {
        jsonrpc: "2.0",
        method: "evaluateTransaction",
        error: { code: 3117, message: "Unknown transaction input", data: { unknownOutputReferences: [{ transaction: { id }, index: Number(index) }] } },
      },
    };
  };

  it("builds the chain again from a fresh read when the network doesn't know a pool box it drew, rather than leave Lovejoin out", async () => {
    const { t, sessions } = await withSession("40000000");
    let gone: string | undefined;
    t.koios.evaluation = (body: { params: { transaction: { cbor: string } } }) => {
      if (gone) return AGREES;
      const stale = unknownBox(body.params.transaction.cbor);
      gone = stale.box;
      return stale.answer;
    };
    // Koios still lists it: the backend answering is behind.
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBeUndefined();
    // Nineteen boxes left: still two boxes' worth.
    expect(review.lovejoin).toMatchObject({ boxes: 2 });
    expect(t.koios.calls.filter((c) => c.path === "ogmios")).toHaveLength(2);
    const kept = (await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txCbor: string }> }>("seedelf.session.back")))!;
    const spends = kept.chain.flatMap((x) => txInputs(Uint8Array.from(Buffer.from(x.txCbor, "hex"))));
    expect(spends).not.toContain(gone);
  });

  it("says to try again later, and doesn't leave Lovejoin out, when the pool stays behind", async () => {
    const { t, sessions } = await withSession("40000000");
    t.koios.evaluation = (body: { params: { transaction: { cbor: string } } }) => unknownBox(body.params.transaction.cbor).answer;
    await expect(sessions.backBuild("preprod", 0)).rejects.toThrow("Lovejoin's pool changed while the wallet read it");
    expect(t.koios.calls.filter((c) => c.path === "ogmios")).toHaveLength(3);
  });

  it("comes back directly when the chain can't be built, rather than stay stuck", async () => {
    const { t } = await withSession("40000000");
    const wasm = loadTestWasm();
    const lovejoin = new LovejoinService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      wasm: {
        ...wasm,
        buildLovejoinChain: () => {
          throw new Error("Something WebAssembly refuses.");
        },
      } as typeof wasm,
    });
    const direct = new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin,
      sleep: async () => undefined,
    });
    const review = await direct.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe("the wallet couldn't build its chain: something WebAssembly refuses");
  });

  it("says on the session when its return, sent, left Lovejoin out", async () => {
    const { t, sessions } = await withSession("40000000");
    t.koios.evaluation = { jsonrpc: "2.0", error: { code: 3010, message: "Some scripts of the transaction terminated with error(s).", data: [] } };
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBeDefined();
    // Only reviewed: nothing is said yet.
    expect((await sessions.list("preprod"))[0]!.lovejoinSkipped).toBeUndefined();
    await sessions.backSubmit("preprod", review.txHash);
    expect((await sessions.list("preprod"))[0]!.lovejoinSkipped).toBe(review.lovejoinSkipped);
  });

  it("leaves it out too when a UTxO at mix_box that isn't a box made the pool look big enough", async () => {
    const { t, sessions } = await withSession("40000000");
    // Seven boxes and 12 ₳ under a box's datum: eight at mix_box, and a box two waves deep takes eight others.
    const junk = { ...POOL[0]!, tx_hash: "e1".repeat(32), value: "12000000" };
    t.koios.addedToAccounts = [...t.koios.addedToAccounts.filter((u) => !POOL.slice(7).includes(u)), junk];
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    expect(review.lovejoinSkipped).toBe("Lovejoin's pool has 7 boxes to mix with, and this needs 8");
    expect(review.inputs).toBe(2);
  });
});

describe("the pool the chains draw from", CHAINS, () => {
  /** Seven real boxes and one UTxO that isn't a box: 12 ₳ under a box's datum. */
  const junked = (t: ReturnType<typeof testBalances>) => {
    const junk = { ...POOL[0]!, tx_hash: "e1".repeat(32), value: "12000000" };
    t.koios.addedToAccounts = [...t.koios.addedToAccounts.filter((u) => !POOL.slice(7).includes(u)), junk];
  };

  it("counts only real boxes before a mix is funded, never what else sits at mix_box", async () => {
    const { t, sessions } = await withSession("40000000");
    junked(t);
    // A box two waves deep takes eight others, and only seven are boxes.
    await expect(sessions.mixOutBuild("preprod", 1)).rejects.toThrow("pool has 7 boxes to mix with, and a box 2 waves deep needs 8");
    // Nor are the boxes mixed again counted against the junk.
    t.koios.addedToAccounts.push(await ownedBox(t, "d9"));
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("pool has 7 boxes to mix with");
  });

  it("draws from a pool only once it holds the floor's worth of others' boxes, and says so", async () => {
    const { sessions } = await withSession("40000000");
    const preprod = NETWORKS.preprod.lovejoin!;
    const floor = preprod.poolFloor;
    preprod.poolFloor = 25;
    try {
      const review = await sessions.backBuild("preprod", 0);
      expect(review.lovejoin).toBeUndefined();
      expect(review.lovejoinSkipped).toBe(
        "Lovejoin's pool holds 20 boxes that aren't yours, and the wallet mixes only once it holds 25, so there's enough to mix with",
      );
      await expect(sessions.mixOutBuild("preprod", 1)).rejects.toThrow("holds 20 boxes that aren't yours");
    } finally {
      preprod.poolFloor = floor;
    }
  });

  it("on mainnet, reads mainnet's mix_box and holds its pool to a floor of 30", async () => {
    const { t } = await withSession("40000000");
    // The recorded pool's 20 boxes, as if they sat at mainnet's mix_box.
    const mainnetBox = NETWORKS.mainnet.lovejoin!.mixBox;
    t.koios.addedToAccounts.push(...POOL.map((u) => ({ ...u, tx_hash: `f${u.tx_hash.slice(1)}`, payment_cred: mainnetBox })));
    await expect(t.lovejoin.fits("mainnet", 1)).rejects.toThrow(
      "Lovejoin's pool holds 20 boxes that aren't yours, and the wallet mixes only once it holds 30, so there's enough to mix with. Try again later.",
    );
    expect(t.koios.calls.filter((c) => c.path === "credential_utxos").map((c) => c.body._payment_credentials[0])).toContain(mainnetBox);
    // Preprod's pool of the same size has no floor.
    await expect(t.lovejoin.fits("preprod", 1)).resolves.toBeUndefined();
  });

  it("makes one chain at most MAX_CHAIN_MIXES long, a return's too", async () => {
    const { t } = await withSession("40000000");
    await t.deps.preferences.set({ lovejoinDepth: 3 });
    const wasm = loadTestWasm();
    // The spare ADA would pay for 30 boxes, and the pool has others enough for 20.
    const others = Array.from({ length: 20 * 26 }, (_, i) => ({ txHash: i.toString(16).padStart(64, "0"), txIndex: 0 }));
    let asked: number | undefined;
    const lovejoin = new LovejoinService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      wasm: {
        ...wasm,
        planLovejoin: () => JSON.stringify({ boxes: 30, spare: "0", mixes: 390, mixFees: "0" }),
        lovejoinOwned: () => JSON.stringify({ boxes: [], lovelace: "0", others: others.length, otherBoxes: others }),
        buildLovejoinChain: (_one: unknown, _key: unknown, request: string) => {
          asked = (JSON.parse(request) as { boxes: number }).boxes;
          return JSON.stringify({ txs: [], boxes: asked, depth: 3, fees: "0", returned: "0", tokens: [], merged: 0, leaves: [], leftOut: [] });
        },
      } as typeof wasm,
    });
    await lovejoin.chain("preprod", 0, [atSession("c1".repeat(32), 0, "40000000")], atSession("c2".repeat(32), 1, "5000000"), {});
    expect(asked).toBe(MAX_CHAIN_MIXES / mixesPerBox(3));
  });

  it("puts no more boxes in one deposit than a transaction holds, and mixes as many again as one chain takes (final review lovejoin-5)", async () => {
    const { t } = await withSession("40000000");
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const wasm = loadTestWasm();
    // One wave deep, the spare ADA would pay for 150 boxes, and the pool has others enough for 200.
    const others = Array.from({ length: 400 }, (_, i) => ({ txHash: i.toString(16).padStart(64, "0"), txIndex: 0 }));
    const mine = Array.from({ length: 150 }, (_, i) => ({ txHash: i.toString(16).padStart(64, "a"), txIndex: 1 }));
    const asked: number[] = [];
    const lovejoin = new LovejoinService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      wasm: {
        ...wasm,
        planLovejoin: () => JSON.stringify({ boxes: 150, spare: "0", mixes: 150, mixFees: "0" }),
        lovejoinOwned: () => JSON.stringify({ boxes: mine, lovelace: "0", others: others.length, otherBoxes: others }),
        buildLovejoinChain: (_one: unknown, _key: unknown, request: string) => {
          asked.push((JSON.parse(request) as { boxes: number }).boxes);
          return JSON.stringify({ txs: [], boxes: asked.at(-1), depth: 1, fees: "0", returned: "0", tokens: [], merged: 0, leaves: [], leftOut: [] });
        },
      } as typeof wasm,
    });
    const rows = [atSession("c1".repeat(32), 0, "40000000")];
    const collateral = atSession("c2".repeat(32), 1, "5000000");
    await lovejoin.chain("preprod", 0, rows, collateral, {});
    await lovejoin.chain("preprod", 0, rows, collateral, {}, [], undefined, true);
    expect(asked).toEqual([MAX_DEPOSIT_BOXES, MAX_CHAIN_MIXES]);
  });

  it("takes a large return one wave deep through Lovejoin, its deposit within a transaction's size (final review lovejoin-5)", async () => {
    const { t } = await withSession("1600000000");
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    // 300 other people's boxes in the pool: registers of another wallet's key.
    const other = testWallet();
    await other.wallet.create(account(15).phrase, PASSWORD);
    const wasm = loadTestWasm();
    for (let i = 0; i < 300; i++) {
      const datum = await other.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
      const tx_hash = i.toString(16).padStart(4, "0").repeat(16);
      t.koios.addedToAccounts.push({ ...POOL[0]!, tx_hash, tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } });
    }
    const sessions = new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin: t.lovejoin,
      sleep: async () => undefined,
    });
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoinSkipped).toBeUndefined();
    expect(review.lovejoin).toMatchObject({ boxes: MAX_DEPOSIT_BOXES, depth: 1 });
  }, 120_000);
});

describe("chains the wallet sends at once", CHAINS, () => {
  const hexBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
  const poolRefs = new Set(POOL.map((u) => `${u.tx_hash}#${u.tx_index}`));
  /** The pool boxes a kept return's chain spends. */
  const picks = (chain: Array<{ txCbor: string }>) =>
    new Set(chain.flatMap((t) => txInputs(hexBytes(t.txCbor))).filter((o) => poolRefs.has(o)));

  it("never draws the same pool box twice: Bring everything back reserves each chain's before building the next", async () => {
    const { t, sessions } = await withSession("40000000");
    // A second site session, as much in it.
    const wasm = loadTestWasm();
    const second = await t.wallet.withKeys((keys) => ({ address: keys.oneTime.address(wasm.Network.Preprod, 1), keyHash: keys.oneTime.keyHash(1) }));
    const book = (await t.store.get<{ next: number; sessions: Array<Record<string, unknown>> }>("sessions.preprod"))!;
    await t.store.set("sessions.preprod", { next: 2, sessions: [...book.sessions, { ...book.sessions[0]!, index: 1 }] });
    const at = (tx: string, i: number, value: string) => ({ ...atSession(tx, i, value), address: second.address, payment_cred: second.keyHash });
    t.koios.addedToAccounts.push(at("c5".repeat(32), 0, "40000000"), at("c6".repeat(32), 1, "5000000"));

    // Twenty boxes: the first return's two boxes take 16, and leave the second only 4.
    const { returns } = await sessions.claimBuild("preprod", [0, 1]);
    expect(returns[0]!.lovejoin).toMatchObject({ boxes: 2 });
    expect(returns[1]!.lovejoin).toBeUndefined();
    expect(returns[1]!.lovejoinSkipped).toBe("Lovejoin's pool has 4 boxes to mix with, and this needs 8");
  });

  it("leaves a built chain's boxes out of the next chain's draw until it's sent or goes stale", async () => {
    const { t, sessions } = await withSession("40000000");
    await sessions.backBuild("preprod", 0);
    const kept = (await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txCbor: string }> }>("seedelf.session.back")))!;
    expect(picks(kept.chain).size).toBe(16);
    // A box one wave deep takes two others: of the twenty, the four the kept return doesn't spend mix two.
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    await expect(t.lovejoin.fits("preprod", 2)).resolves.toBeUndefined();
    await expect(t.lovejoin.fits("preprod", 3)).rejects.toThrow("pool has 4 boxes to mix with");
    // Not sent within ten minutes, it can't be anymore: its boxes are free again.
    t.clock.now += 10 * 60_000 + 1;
    await expect(t.lovejoin.fits("preprod", 3)).resolves.toBeUndefined();
  });

  it("keeps a public mix's change to come, and its collateral, from other payments and sites until it's all sent", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    t.koios.evaluation = AGREES;
    t.koios.addedToAccounts.push(...POOL);
    const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
    const keyHash = await t.wallet.withKeys((keys) => keys.cardano.paymentKeyHash(0, 0));
    const at = (tx: string, i: number, value: string) => ({ ...first!, tx_hash: tx, tx_index: i, value, payment_cred: keyHash, asset_list: [] });
    t.koios.addedToAccounts.push(at("e5".repeat(32), 0, "5000000"), at("e6".repeat(32), 0, "30000000"));
    const summary = await t.lovejoin.publicBuild("preprod", 1);
    await t.lovejoin.publicSubmit("preprod", summary.txHash);
    // Four went; the fifth pays from the fourth's change at the account, which a block has taken.
    const sending = (await t.wallet.withKeys(() => t.session.get<{ txs: Array<{ txHash: string; txCbor: string }> }>("seedelf.lovejoin.sending.preprod")))!;
    const change = txInputs(hexBytes(sending.txs[4]!.txCbor)).find((o) => o.startsWith(sending.txs[3]!.txHash))!;
    const [hash, index] = change.split("#");
    t.koios.addedToAccounts.push(at(hash!, Number(index), "12000000"), at("e7".repeat(32), 0, "12000000"));
    const listed = (await readAccountUtxos(t.deps, "preprod", new Set())).utxos.map((p) => `${p.utxo.tx_hash}#${p.utxo.tx_index}`);
    expect(listed).toContain(`${"e7".repeat(32)}#0`);
    expect(listed).not.toContain(change);
    const payable = (await readAccount(t.deps, "preprod")).utxos.map((p) => `${p.utxo.tx_hash}#${p.utxo.tx_index}`);
    expect(payable).not.toContain(change);
    // Its collateral isn't paid with either, but still backs the account's scripts.
    const paying = await readAccount(t.deps, "preprod");
    expect(paying.collateral?.utxo.tx_hash).toBe("e5".repeat(32));
    expect(payable).not.toContain(`${"e5".repeat(32)}#0`);
    // Once it's all sent, nothing is kept back.
    t.koios.confirmations = 1;
    await t.lovejoin.pumpPublic("preprod");
    const after = (await readAccountUtxos(t.deps, "preprod", new Set())).utxos.map((p) => `${p.utxo.tx_hash}#${p.utxo.tx_index}`);
    expect(after).toContain(change);
  });

  it("keeps a session's return chain's change to come from the site connected to it", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    await sessions.backSubmit("preprod", review.txHash);
    const pending = (await t.wallet.withKeys(() => t.session.get<{ txs: Array<{ txHash: string; txCbor: string }> }>("seedelf.session.chain.preprod.0")))!;
    const change = txInputs(hexBytes(pending.txs[4]!.txCbor)).find((o) => o.startsWith(pending.txs[3]!.txHash))!;
    const [hash, index] = change.split("#");
    t.koios.addedToAccounts.push(atSession(hash!, Number(index), "20000000"), atSession("c7".repeat(32), 0, "3000000"));
    const rows = (await sessions.accountUtxos("preprod", sessionSwap.keyHash)).map((u) => `${u.tx_hash}#${u.tx_index}`);
    expect(rows).toContain(`${"c7".repeat(32)}#0`);
    expect(rows).not.toContain(change);
  });

  it("keeps the funding's change a return chain merges into from the private balance's spends while it's sent (final review lovejoin-3)", async () => {
    const { t, sessions } = await withSession("40000000");
    // The session's funding made a1…#0, the private balance's largest UTxO: its return merges into it, at the chain's end.
    const funding = "a1".repeat(32);
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ txHash: string }> }> }>("sessions.preprod"))!;
    book.sessions[0]!.txs[0]!.txHash = funding;
    await t.store.set("sessions.preprod", book);
    const change = `${funding}#0`;
    const deps = { ...t.deps, collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch) };
    const review = await sessions.backBuild("preprod", 0);
    expect(review.merged).toBe(1);
    // Kept for Send, it holds nothing back.
    expect((await readContract(deps, "preprod")).utxos.map(outpoint)).toContain(change);

    // Being sent, no spend of the private balance takes it: Make public pays from the rest.
    await sessions.backSubmit("preprod", review.txHash);
    const read = await readContract(deps, "preprod");
    expect(read.utxos.map(outpoint)).not.toContain(change);
    expect(read.returning.map(outpoint)).toEqual([change]);
    const to = account(15).preprod.receive_0 as string;
    await t.withdraw.build("preprod", [{ to, lovelace: "1000000", tokens: [] }]);
    const kept = await t.wallet.withKeys(() => t.session.get<{ txCbor: string }>(SESSION_WITHDRAW));
    expect(txInputs(hexBytes(kept!.txCbor))).not.toContain(change);
    // Max says why it leaves it.
    const max = await t.withdraw.build("preprod", [{ to, lovelace: null, tokens: [] }]);
    expect(max.leftOut).toEqual([{ txHash: funding, txIndex: 0, reason: "returning" }]);

    // With the rest locked, nothing pays, and the error says what the private balance waits for.
    await t.coins.setLocked("preprod", "seedelf", `${"a2".repeat(32)}#0`, true);
    await expect(t.withdraw.build("preprod", [{ to, lovelace: "1000000", tokens: [] }])).rejects.toThrow(
      "Every UTxO in your private balance is locked, or waits for a return through Lovejoin that's still being sent.",
    );
    // And with nothing else in it, that it's all waiting for the return.
    const only = { ...read.view, owned: read.view.owned.filter((u) => outpoint(u) === change) };
    expect(nothingToSpend({}, only, "Your private balance is empty.", read.returning).message).toBe(
      "Your private balance waits for a return through Lovejoin that's still being sent: its last transaction adds to what's there, so nothing else spends it meanwhile. Try again once it's all sent.",
    );
  });
});

describe("a chain's resend while tx_status is down", CHAINS, () => {
  const BAD_INPUTS = "ConwayUtxowFailure (UtxoFailure (BadInputsUTxO (fromList [])))";

  /**
   * Koios where each transaction lands at its first submit (none does when
   * `lands` is false: a pool box someone else's mix took first), a submit of
   * one sent before is refused as spent, and tx_status answers 502 while
   * `down()`, while submits still go through.
   */
  function statusDown(t: ReturnType<typeof testBalances>, down: () => boolean, lands = true) {
    const fetch = t.koios.fetch;
    const sent = new Set<string>();
    const landed = new Set<string>();
    let refused = 0;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx")) {
        const id = txIdOf(new Uint8Array(init!.body as Uint8Array));
        if (sent.has(id)) {
          refused++;
          return new Response(BAD_INPUTS, { status: 400 });
        }
        sent.add(id);
        if (lands) landed.add(id);
        return fetch(url, init);
      }
      if (url.endsWith("/tx_status")) {
        if (down()) return new Response("", { status: 502 });
        const { _tx_hashes } = JSON.parse(String(init!.body)) as { _tx_hashes: string[] };
        return Response.json(_tx_hashes.map((tx_hash) => ({ tx_hash, num_confirmations: landed.has(tx_hash) ? 1 : null })));
      }
      return fetch(url, init);
    };
    return { landed, refused: () => refused };
  }

  /** A wait that lets time go by, the user still there. */
  const passing = (t: ReturnType<typeof testBalances>) => async (ms: number) => {
    t.clock.now += ms;
    await t.wallet.touch();
  };

  /** The sessions alarm, every minute, `minutes` times. */
  async function alarm(t: ReturnType<typeof testBalances>, sessions: SessionService, minutes: number) {
    for (let m = 0; m < minutes; m++) {
      t.clock.now += 60_000;
      await t.wallet.touch();
      await sessions.runAll("preprod");
    }
  }

  function runner(t: ReturnType<typeof testBalances>) {
    return new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin: t.lovejoin,
      sleep: passing(t),
    });
  }

  it("keeps a session's chain going when its resend is refused as spent while tx_status can't say (final review lovejoin-6)", async () => {
    const { t } = await withSession("40000000");
    const sessions = runner(t);
    const review = await sessions.backBuild("preprod", 0);
    let down = true;
    const net = statusDown(t, () => down);
    await sessions.backSubmit("preprod", review.txHash);
    // Blocks take the first window, and tx_status answers 502 for eight minutes: the oldest is sent again, and refused.
    await alarm(t, sessions, 8);
    expect(net.refused()).toBeGreaterThan(0);
    expect((await sessions.list("preprod"))[0]!.chain).toMatchObject({ total: 10, sent: 4 });
    expect((await sessions.list("preprod"))[0]!.chain?.stopped).toBeUndefined();
    // Nothing that went is marked as never sent.
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ unsent?: boolean }> }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.txs.filter((x) => x.unsent)).toEqual([]);
    // tx_status answers again: the rest goes.
    down = false;
    await alarm(t, sessions, 3);
    const view = (await sessions.list("preprod"))[0]!;
    expect(view.chain).toMatchObject({ total: 10, sent: 10 });
    expect(view.chain?.stopped).toBeUndefined();
    expect(net.landed.size).toBe(10);
  });

  it("still stops a session's chain whose resend is refused while tx_status says it isn't on chain", async () => {
    const { t } = await withSession("40000000");
    const sessions = runner(t);
    const review = await sessions.backBuild("preprod", 0);
    statusDown(t, () => false, false);
    await sessions.backSubmit("preprod", review.txHash);
    await alarm(t, sessions, 8);
    expect((await sessions.list("preprod"))[0]!.chain?.stopped).toMatch("already spent");
    expect((await t.lovejoin.held("preprod")).stopped).toBe(1);
  });

  it("keeps a mix from the public account going the same way (final review lovejoin-6)", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    t.koios.evaluation = AGREES;
    t.koios.addedToAccounts.push(...POOL);
    const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
    const at = (tx: string, value: string) => ({ ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] });
    t.koios.addedToAccounts.push(at("e5", "5000000"), at("e6", "30000000"));
    const lovejoin = new LovejoinService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      sleep: passing(t),
    });
    const summary = await lovejoin.publicBuild("preprod", 1);
    let down = true;
    const net = statusDown(t, () => down);
    await lovejoin.publicSubmit("preprod", summary.txHash);
    // Three minutes on, the four in the mempool are sent again, in order, and refused, while tx_status still can't say:
    // they're looked for again (independent review L25).
    t.clock.now += CHAIN_RESEND_MS;
    await t.wallet.touch();
    expect(await lovejoin.pumpPublic("preprod")).toBe(true);
    expect(net.refused()).toBe(4);
    expect(await lovejoin.progress("preprod")).toEqual({ total: 5, sent: 4 });
    // tx_status answers again: the last mix goes.
    down = false;
    expect(await lovejoin.pumpPublic("preprod")).toBe(false);
    expect(net.landed.size).toBe(5);
    expect(await lovejoin.progress("preprod")).toBeNull();
  });
});

/** A box of ours in the pool: a fresh re-randomization of the Seedelf key's register. */
async function ownedBox(t: ReturnType<typeof testBalances>, tx: string, txIndex = 0, blockTime?: number): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  return {
    ...POOL[0]!,
    tx_hash: tx.length === 64 ? tx : tx.repeat(32),
    tx_index: txIndex,
    ...(blockTime !== undefined ? { block_time: blockTime } : {}),
    inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} },
  };
}

/** Lovejoin with giveme.my's witness stood in for: its recorded answer is another transaction's. */
function witnessed(t: ReturnType<typeof testBalances>, extra: Partial<ConstructorParameters<typeof LovejoinService>[0]> = {}) {
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
    ...extra,
  });
}

/** The boxes a withdraw giveme.my was asked about spends. */
const withdrawn = (t: ReturnType<typeof testBalances>) => t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))));

describe("a chain's boxes", CHAINS, () => {
  /** A wallet with collateral and 60 ₳ in its public account, and Lovejoin's pool. */
  async function funded() {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    t.koios.evaluation = AGREES;
    t.koios.addedToAccounts.push(...POOL);
    const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
    const keyHash = await t.wallet.withKeys((keys) => keys.cardano.paymentKeyHash(0, 0));
    const at = (tx: string, value: string) => ({ ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, payment_cred: keyHash, asset_list: [] });
    t.koios.addedToAccounts.push(at("e5", "5000000"), at("e6", "60000000"));
    return t;
  }

  it("never brings back by itself a box a public mix cut by a lock left unmixed, and says the mix stopped", async () => {
    const t = await funded();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const summary = await t.lovejoin.publicBuild("preprod", 4);
    expect(summary).toMatchObject({ boxes: 4, mixes: 4, txs: 5 });
    await t.lovejoin.publicSubmit("preprod", summary.txHash);
    // Recorded, sealed, before the deposit went: the deposit, each mix and the leaves.
    const [record] = (await t.store.get<{ chains: Array<{ deposit: string; mixes: string[]; leaves: Array<{ txHash: string; txIndex: number }> }> }>("lovejoin.preprod"))!.chains;
    expect(record!.mixes).toHaveLength(4);
    expect(record!.leaves).toHaveLength(4);

    // The deposit and three mixes went; the wallet locks before the fourth, and unlocks hours later.
    await t.wallet.lock();
    t.clock.now += 7 * HOUR;
    await t.wallet.unlock(PASSWORD);
    expect(await t.lovejoin.progress("preprod")).toEqual({ total: 5, sent: 4, stopped: CHAIN_CUT });
    // Home counts the three it mixed all the way as on their way back, not the fourth.
    expect(await t.lovejoin.held("preprod")).toMatchObject({ boxes: 3, stopped: 1 });
    // On chain: three boxes mixed all the way, and one still the deposit's.
    const sent = record!.leaves.filter((l) => record!.mixes.slice(0, 3).includes(l.txHash));
    t.koios.addedToAccounts.push(await ownedBox(t, record!.deposit, 3), ...(await Promise.all(sent.map((l) => ownedBox(t, l.txHash, l.txIndex)))));

    // Every due time runs out: the three mixed come back one a run, and the deposit's box never does.
    const lovejoin = witnessed(t);
    for (let run = 0; run < 8; run++) {
      await lovejoin.withdrawDue("preprod", run === 0);
      // Each withdraw lands before the next run.
      for (const o of withdrawn(t)) t.koios.spent.add(o);
      t.clock.now += 2 * HOUR;
      await t.wallet.unlock(PASSWORD);
    }
    const out = withdrawn(t);
    expect(out).toHaveLength(3);
    expect(out).not.toContain(`${record!.deposit}#3`);
    for (const l of sent) expect(out).toContain(`${l.txHash}#${l.txIndex}`);

    // The page shows it as not mixed yet, and the stopped mix; Home counts both.
    const status = await lovejoin.status("preprod");
    expect(status.notMixed).toEqual([{ txHash: record!.deposit, txIndex: 3 }]);
    expect(status.chains).toEqual([{ boxes: 4, total: 5, sent: 4, at: expect.any(Number), stopped: CHAIN_CUT }]);
    expect(await lovejoin.held("preprod")).toMatchObject({ notMixed: 1, stopped: 1 });
    // Brought back by hand only when asked anyway.
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow("weren't mixed yet");
    await expect(lovejoin.withdrawNow("preprod", { txHash: record!.deposit, txIndex: 3 })).rejects.toThrow("wasn't mixed");
    await lovejoin.withdrawNow("preprod", { txHash: record!.deposit, txIndex: 3 }, true);
    expect(withdrawn(t).at(-1)).toBe(`${record!.deposit}#3`);
  });

  it("mixes again from the public account the boxes a mix from it left, which ties nothing new, and keeps the private balance out of it (privacy review §2.10)", async () => {
    const t = await funded();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    // A mix from the public account a lock cut after its deposit: both its boxes are still the deposit's.
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
      stopped: CHAIN_CUT,
      ended: t.clock.now - 2 * HOUR,
    };
    t.koios.addedToAccounts.push(await ownedBox(t, D, 0), await ownedBox(t, D, 1));
    await t.store.set("lovejoin.preprod", { due: [], chains: [cut] });
    const status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toHaveLength(2);
    expect(status.fromPublic).toEqual(status.notMixed);
    // The private balance won't pay for their mixes: that would tie it to the account.
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("came from a mix from your public account");
    expect(await t.lovejoin.againBoxes("preprod", true)).toEqual({ boxes: 2, owned: 2 });

    // The account pays: no deposit, every mix signed by its keys, the change left in it.
    const summary = await t.lovejoin.publicAgainBuild("preprod");
    expect(summary).toMatchObject({ again: true, boxes: 2, depth: 1, mixes: 2, txs: 2 });
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ kind: string; txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    expect(kept!.chain.map((c) => c.kind)).toEqual(["mix", "mix"]);
    const inputs = kept!.chain.map((c) => txInputs(bytes(c.txCbor)));
    expect(inputs.map((i) => i.filter((o) => o.startsWith(D)).length)).toEqual([1, 1]);
    // The first is paid from the account, the next from its change.
    const account = new Set((await readAccountUtxos(t.deps, "preprod", new Set())).utxos.map((p) => `${p.utxo.tx_hash}#${p.utxo.tx_index}`));
    expect(inputs[0]!.some((o) => account.has(o))).toBe(true);
    expect(inputs[1]).toContain(`${txIdOf(bytes(kept!.chain[0]!.txCbor))}#3`);

    // Sent as a mix from the account is, and recorded as its boxes mixed again: they wait afresh once its first mix is in.
    await t.lovejoin.publicSubmit("preprod", summary.txHash);
    const { chains, due } = (await t.store.get<{ chains: Array<{ again?: boolean; session?: number }>; due: number[] }>("lovejoin.preprod"))!;
    expect(chains.find((c) => c.again)).toMatchObject({ again: true });
    expect(chains.find((c) => c.again)!.session).toBeUndefined();
    expect(due).toHaveLength(2);
  });

  it("counts on Home only boxes that can come back: none of a mix that stopped after its deposit", async () => {
    const t = await funded();
    const summary = await t.lovejoin.publicBuild("preprod", 1);
    // The deposit goes in, and the network turns the first mix away: the mix stops.
    const fetch = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) =>
      url.endsWith("/submittx") && ++submits > 1
        ? new Response("ConwayUtxowFailure (ScriptWitnessNotValidatingUTXOW)", { status: 400 })
        : fetch(url, init);
    await expect(t.lovejoin.publicSubmit("preprod", summary.txHash)).rejects.toThrow();
    // Its box never comes back by itself: nothing is on its way back, and the mix stopped.
    expect(await t.lovejoin.held("preprod")).toEqual({ boxes: 0, lovelace: "0", next: null, notMixed: 0, stopped: 1 });
    // The pool lists the deposit's box: not mixed yet, and still none on its way back.
    const [record] = (await t.store.get<{ chains: Array<{ deposit: string }> }>("lovejoin.preprod"))!.chains;
    t.koios.addedToAccounts.push(await ownedBox(t, record!.deposit, 0));
    const status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toEqual([{ txHash: record!.deposit, txIndex: 0 }]);
    expect(status.due).toEqual([]);
    expect(await t.lovejoin.held("preprod")).toEqual({ boxes: 0, lovelace: "0", next: null, notMixed: 1, stopped: 1 });
  });

  it("drops the due time of a box a chain that was all sent left not mixed, once a pool read finds it", async () => {
    const { t } = await withSession("40000000");
    // All sent an hour ago, but a node dropped its last mix: the box is still at the first mix's output.
    const [D, m1, m2] = ["d0", "e1", "e2"].map((h) => h.repeat(32));
    const done = {
      id: m2,
      progress: "seedelf.lovejoin.sending.preprod",
      deposit: D,
      mixes: [m1, m2],
      leaves: [{ txHash: m2!, txIndex: 0 }],
      boxes: 1,
      total: 3,
      sent: 3,
      at: t.clock.now - HOUR,
      scheduled: true,
      done: true,
      ended: t.clock.now - HOUR,
    };
    // And a box of an older mix that can come back, due in two hours.
    t.koios.addedToAccounts.push(await ownedBox(t, m1!, 1), await ownedBox(t, "f5", 0));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + 2 * HOUR, t.clock.now + 3 * HOUR], chains: [done] });
    const status = await t.lovejoin.status("preprod");
    expect(status.notMixed).toEqual([{ txHash: m1, txIndex: 1 }]);
    expect(status.due).toEqual([t.clock.now + 2 * HOUR]);
    expect(await t.lovejoin.held("preprod")).toMatchObject({ boxes: 1, next: t.clock.now + 2 * HOUR, notMixed: 1 });
    // Read again, nothing more goes.
    await t.lovejoin.status("preprod");
    expect((await t.lovejoin.held("preprod")).boxes).toBe(1);
  });

  it("keeps a stopped chain's record while a spend that may never land hides its box, so the box never comes back by itself (final review lovejoin-1)", async () => {
    const { t } = await withSession("40000000");
    const lovejoin = witnessed(t);
    // A chain cut a day ago, after its deposit: its box is still the deposit's own output.
    const D = "d0".repeat(32);
    t.koios.addedToAccounts.push(await ownedBox(t, D, 3, t.clock.now / 1000 - 24 * 3600));
    const S = {
      id: "5e".repeat(32),
      session: 0,
      progress: "seedelf.session.chain.preprod.0",
      deposit: D,
      mixes: ["a1".repeat(32), "a2".repeat(32)],
      leaves: [{ txHash: "a2".repeat(32), txIndex: 0 }],
      boxes: 1,
      total: 4,
      sent: 1,
      at: t.clock.now - 24 * HOUR,
      scheduled: true,
      stopped: CHAIN_CUT,
      ended: t.clock.now - 24 * HOUR,
    };
    await t.store.set("lovejoin.preprod", { due: [], chains: [S] });
    expect((await lovejoin.status("preprod")).notMixed).toEqual([{ txHash: D, txIndex: 3 }]);
    const kept = async () => (await t.store.get<{ chains: Array<{ id: string }> }>("lovejoin.preprod"))!.chains.map((c) => c.id);

    // Mix my boxes again's first mix spends it, and the Lovejoin page reads the pool meanwhile: the record stays.
    await t.wallet.withKeys(() => t.session.set(SESSION_SPENT, { [`${D}#3`]: Date.now() }));
    await lovejoin.status("preprod");
    expect(await kept()).toEqual([S.id]);

    // That mix never lands, and a lock forgets the spend: the box shows again, not mixed yet, and hours of runs never bring it back.
    await t.wallet.lock();
    t.clock.now += HOUR;
    await t.wallet.unlock(PASSWORD);
    for (let run = 0; run < 6; run++) {
      await lovejoin.withdrawDue("preprod", run === 0);
      t.clock.now += 2 * HOUR;
      await t.wallet.unlock(PASSWORD);
    }
    expect(withdrawn(t)).toEqual([]);
    expect((await lovejoin.status("preprod")).notMixed).toEqual([{ txHash: D, txIndex: 3 }]);

    // Once the box has really left the pool, the record goes.
    t.koios.spent.add(`${D}#3`);
    await lovejoin.status("preprod");
    expect(await kept()).toEqual([]);
  });

  it("withdraws nothing while a chain is being sent, and the box that has waited longest once it's done", async () => {
    const { t } = await withSession("40000000");
    // Two boxes of ours, both due: one five hours in the pool, and one two hours that sorts first.
    const since = (hours: number) => t.clock.now / 1000 - hours * 3600;
    t.koios.addedToAccounts.push(await ownedBox(t, "0a", 0, since(2)), await ownedBox(t, "f1", 0, since(5)));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now - HOUR, t.clock.now - HOUR] });
    const lovejoin = witnessed(t);
    const runner = new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin,
      sleep: async () => undefined,
    });
    const review = await runner.backBuild("preprod", 0);
    await runner.backSubmit("preprod", review.txHash);
    // Four of ten sent: no box comes back, not even by hand.
    expect(await lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow("being sent through Lovejoin");
    // It's all sent: the box that came into the pool first goes, not the first by hash.
    t.koios.confirmations = 1;
    await runner.runAll("preprod");
    await lovejoin.withdrawDue("preprod");
    expect(withdrawn(t)).toEqual([`${"f1".repeat(32)}#0`]);
  });

  it("brings no box back before it has waited the delay's least in the pool", async () => {
    const { t } = await withSession("40000000");
    // A box a mix moved ten minutes ago, and a due time from long before.
    t.koios.addedToAccounts.push(await ownedBox(t, "d1", 0, t.clock.now / 1000 - 600));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now - HOUR] });
    const lovejoin = witnessed(t);
    expect(await lovejoin.withdrawDue("preprod")).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
    // Its time moves past when it will have waited an hour, by a fresh draw, so it isn't that very moment either.
    const [due] = (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due;
    const [low, high] = WITHDRAW_SPREAD_MS;
    expect(due).toBeGreaterThanOrEqual(t.clock.now - 600_000 + HOUR + low);
    expect(due).toBeLessThanOrEqual(t.clock.now - 600_000 + HOUR + high);
  });

  it("brings back first a box someone else's mix has moved since, and keeps a chain's leaves once its record goes (privacy review §3.6)", async () => {
    const { t } = await withSession("40000000");
    const since = (hours: number) => t.clock.now / 1000 - hours * 3600;
    // A mix from the public account that ended a day ago left a box at its
    // last mix, five hours in the pool; another box of the wallet's, someone
    // else's mix moved two hours ago.
    const leaf = { txHash: "e7".repeat(32), txIndex: 0 };
    const done = {
      id: leaf.txHash,
      progress: "seedelf.lovejoin.sending.preprod",
      deposit: "d7".repeat(32),
      mixes: [leaf.txHash],
      leaves: [leaf],
      boxes: 1,
      total: 2,
      sent: 2,
      at: t.clock.now - 24 * HOUR,
      scheduled: true,
      done: true,
      ended: t.clock.now - 24 * HOUR,
    };
    t.koios.addedToAccounts.push(await ownedBox(t, "e7", 0, since(5)), await ownedBox(t, "b7", 0, since(2)));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now - HOUR, t.clock.now + 3 * HOUR], chains: [done] });
    const lovejoin = witnessed(t);
    // The chain's record goes; its leaf, still where the mix put it, is kept, and whose.
    await lovejoin.status("preprod");
    const kept = async () => (await t.store.get<{ chains: unknown[]; leaves?: Record<string, string> }>("lovejoin.preprod"))!;
    expect((await kept()).chains).toEqual([]);
    expect((await kept()).leaves).toEqual({ [`${leaf.txHash}#0`]: "public" });
    // The box someone else moved goes first, though the leaf has waited longer.
    await lovejoin.withdrawDue("preprod");
    expect(withdrawn(t)).toEqual([`${"b7".repeat(32)}#0`]);
    // Once someone else's mix moves the leaf too, it isn't kept anymore.
    t.koios.spent.add(`${"b7".repeat(32)}#0`).add(`${leaf.txHash}#0`);
    await lovejoin.status("preprod");
    expect((await kept()).leaves).toBeUndefined();
  });

  it("brings one back now in the same turn: one that has waited the delay's least first, then one someone else has moved since", async () => {
    const { t } = await withSession("40000000");
    const since = (hours: number) => t.clock.now / 1000 - hours * 3600;
    // A leaf of a chain still recorded, five hours in the pool; a box someone
    // else's mix moved two hours ago; and one it moved ten minutes ago.
    const leaf = { txHash: "e8".repeat(32), txIndex: 0 };
    const done = {
      id: leaf.txHash,
      progress: "seedelf.lovejoin.sending.preprod",
      deposit: "d8".repeat(32),
      mixes: [leaf.txHash],
      leaves: [leaf],
      boxes: 1,
      total: 2,
      sent: 2,
      at: t.clock.now - HOUR,
      scheduled: true,
      done: true,
      ended: t.clock.now - HOUR,
    };
    t.koios.addedToAccounts.push(
      await ownedBox(t, "e8", 0, since(5)),
      await ownedBox(t, "c8", 0, since(2)),
      await ownedBox(t, "b8", 0, since(0.2)),
    );
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR, t.clock.now + 2 * HOUR, t.clock.now + 3 * HOUR], chains: [done] });
    const lovejoin = witnessed(t);
    // The one moved since that has waited, then the leaf, and the one moved minutes ago last.
    await lovejoin.withdrawNow("preprod");
    await lovejoin.withdrawNow("preprod");
    await lovejoin.withdrawNow("preprod");
    expect(withdrawn(t)).toEqual([`${"c8".repeat(32)}#0`, `${leaf.txHash}#0`, `${"b8".repeat(32)}#0`]);
  });

  it("withdraws one box a run, however many runs overlap", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "d1"), await ownedBox(t, "d2"));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now - HOUR] });
    t.clock.now += 7 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const lovejoin = witnessed(t);
    const [a, b] = await Promise.all([lovejoin.withdrawDue("preprod"), lovejoin.withdrawDue("preprod")]);
    expect([...a, ...b]).toHaveLength(1);
    expect(t.collateral.asked).toHaveLength(1);
  });

  it("counts a withdraw Koios didn't answer as maybe sent: its time goes, and no other box comes back until it's found", async () => {
    const { t } = await withSession("40000000");
    const since = (hours: number) => t.clock.now / 1000 - hours * 3600;
    t.koios.addedToAccounts.push(await ownedBox(t, "d1", 0, since(5)), await ownedBox(t, "d2", 0, since(5)));
    // One box due an hour ago, the other in five minutes.
    await t.store.set("lovejoin.preprod", { due: [t.clock.now - HOUR, t.clock.now + 5 * 60_000] });
    const lovejoin = witnessed(t);
    // The submit times out, but the withdraw reached the mempool.
    const fetch = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => (url.endsWith("/submittx") && ++submits === 1 ? new Response("", { status: 504 }) : fetch(url, init));
    expect(await lovejoin.withdrawDue("preprod")).toEqual([]);
    const kept = (await t.store.get<{ due: number[]; withdrawing?: { txHash: string } }>("lovejoin.preprod"))!;
    // Its due time went, as a sent one's does, and it's kept, sealed, to be looked for.
    expect(kept.due).toEqual([t.clock.now + 5 * 60_000]);
    expect(kept.withdrawing?.txHash).toBeDefined();
    // Ten minutes on, the other box is due too: nothing is built while the first may be on its way.
    t.clock.now += 10 * 60_000;
    await t.wallet.unlock(PASSWORD);
    expect(await lovejoin.withdrawDue("preprod")).toEqual([]);
    expect(t.collateral.asked).toHaveLength(1);
    // Not seen for a while: it's sent again, as it was.
    expect(submits).toBe(2);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(kept.withdrawing!.txHash);
    // Found on chain: in the history, and the next box goes.
    t.koios.confirmations = 1;
    await lovejoin.withdrawDue("preprod");
    expect((await t.store.get<{ withdrawing?: unknown }>("lovejoin.preprod"))!.withdrawing).toBeUndefined();
    expect(t.collateral.asked).toHaveLength(2);
    expect((await t.activity.seedelf("preprod")).some((e) => e.txHash === kept.withdrawing!.txHash)).toBe(true);
  });

  it("counts a chain as stopped when another is sent in its place, or its progress says it stopped", async () => {
    const { t } = await withSession("40000000");
    const txs = (h: string) =>
      (["deposit", "mix"] as const).map((kind, i) => ({ kind, txCbor: "", txHash: h.repeat(31) + `0${i}`, fee: "0" }));
    const key = "seedelf.lovejoin.sending.preprod";
    await t.lovejoin.recordChain("preprod", { progress: key, txs: txs("a1"), leaves: [], boxes: 1 });
    await t.wallet.withKeys(() => t.session.set(key, { txs: txs("b1"), next: 1, flying: [], stopped: "The network rejected the transaction: X" }));
    await t.lovejoin.recordChain("preprod", { progress: key, txs: txs("b1"), leaves: [], boxes: 1 });
    const { chains } = await t.lovejoin.status("preprod");
    expect(chains.map((c) => c.stopped)).toEqual([CHAIN_CUT, "The network rejected the transaction: X"]);
    expect(await t.lovejoin.progress("preprod")).toEqual({ total: 2, sent: 1, stopped: "The network rejected the transaction: X" });
  });

  it("says a session's chain a lock cut stopped, as soon as the wallet unlocks", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    await sessions.backSubmit("preprod", review.txHash);
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    await sessions.runAll("preprod");
    expect((await sessions.list("preprod"))[0]!.chain).toEqual({ total: 10, sent: 4, confirmed: 0, cut: false, stopped: CHAIN_CUT });
    expect((await t.lovejoin.status("preprod")).chains).toEqual([
      { session: 0, boxes: 2, total: 10, sent: 4, at: expect.any(Number), stopped: CHAIN_CUT },
    ]);
  });
});

describe("the boxes' withdraws", CHAINS, () => {
  it("finds ours in the pool, wherever mixes moved them", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "d1"));
    const status = await t.lovejoin.status("preprod");
    expect(status).toMatchObject({ available: true, lovelace: "10000000", boxes: [{ txHash: "d1".repeat(32), txIndex: 0 }] });
  });

  it("withdraws a due box through giveme.my, and keeps it due when that fails", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "d2"));
    // Nothing due yet: no pool read.
    await t.lovejoin.schedule("preprod", 1);
    const calls = t.koios.calls.length;
    expect(await t.lovejoin.withdrawDue("preprod")).toEqual([]);
    expect(t.koios.calls.length).toBe(calls);

    // Due: the withdraw is built, measured and handed to giveme.my, whose
    // recorded answer is another transaction's, so it isn't sent.
    // Hours later the wallet locked itself; the withdraw runs at the next unlock.
    t.clock.now += 7 * HOUR;
    await t.wallet.unlock(PASSWORD);
    expect(await t.lovejoin.withdrawDue("preprod")).toEqual([]);
    expect(t.collateral.asked).toHaveLength(1);
    expect((await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due).toHaveLength(1);
  });

  it("sends no box back the moment the wallet unlocks: each due waits a fresh draw inside the unlocked stretch, then one comes back a run, the others each a fresh delay later (privacy review §3.1)", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "e1"), await ownedBox(t, "e2"), await ownedBox(t, "e3"));
    await t.lovejoin.schedule("preprod", 3);
    // Locked through all three delays: at unlock, none is tried. Each waits a
    // fresh draw of its own, 2 minutes on at least, and 2 before the
    // 15-minute auto-lock at most.
    t.clock.now += 7 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const now = t.clock.now;
    expect(await t.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
    const due = async () => (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due.sort((a, b) => a - b);
    const drawn = await due();
    expect(drawn).toHaveLength(3);
    for (const d of drawn) {
      expect(d).toBeGreaterThanOrEqual(now + UNLOCK_WAIT_MS[0]);
      expect(d).toBeLessThanOrEqual(now + 13 * 60_000);
    }
    expect(new Set(drawn).size).toBe(3);

    // The alarm's run once all three have come: one is tried (giveme.my's
    // recorded answer is another transaction's, so it isn't sent), not
    // three, and the other two each wait again, apart.
    t.clock.now = drawn[2]!;
    await t.wallet.touch();
    await t.lovejoin.withdrawDue("preprod");
    expect(t.collateral.asked).toHaveLength(1);
    const after = await due();
    const [low, high] = WITHDRAW_SPREAD_MS;
    expect(after[0]).toBeLessThanOrEqual(t.clock.now);
    for (const d of after.slice(1)) {
      expect(d).toBeGreaterThanOrEqual(t.clock.now + low);
      expect(d).toBeLessThanOrEqual(t.clock.now + high);
    }
    expect(after[1]).not.toBe(after[2]);

    // The next minute's alarm tries the one still due, and nothing else.
    t.clock.now += 60_000;
    await t.lovejoin.withdrawDue("preprod");
    expect(t.collateral.asked).toHaveLength(2);

    // The wallet locks with the other two waiting their fresh delays, and unlocks hours later: they were drawn
    // afresh since the last unlock, so this one draws them again rather than let them go a minute in.
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const unlocked = t.clock.now;
    await t.lovejoin.withdrawDue("preprod", true);
    const redrawn = (await due()).filter((d) => d !== after[0]);
    expect(redrawn).toHaveLength(2);
    for (const d of redrawn) expect(d).toBeGreaterThanOrEqual(unlocked + UNLOCK_WAIT_MS[0]);
  });

  it("draws a box's wait at one unlock only: locked before it went, it goes at the run after the next unlock's", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "e4"));
    await t.lovejoin.schedule("preprod", 1);
    t.clock.now += 7 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await t.lovejoin.withdrawDue("preprod", true);
    const due = async () => (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due;
    const [drawn] = await due();
    // The wallet locks before it went. Unlocked hours on, it isn't drawn again, nor sent at that unlock.
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    expect(await t.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
    expect(await due()).toEqual([drawn]);
    // The next minute's run tries it.
    t.clock.now += 60_000;
    await t.lovejoin.withdrawDue("preprod");
    expect(t.collateral.asked).toHaveLength(1);
  });

  it("brings no box back in a run that sent something else, nor minutes after the wallet's own send: it's pushed a fresh few minutes, a few times at most", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "e6"));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now - HOUR] });
    // What the wallet's last send spent, and when.
    const sent = (at: number) => t.wallet.withKeys(() => t.session.set(SESSION_SPENT, { [`${"9a".repeat(32)}#0`]: at }));
    const due = async () => (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due;

    // This run sent a payment a moment ago: nothing goes, and nothing's pushed; the next run takes it.
    await sent(t.clock.now - 5_000);
    expect(await t.lovejoin.withdrawDue("preprod", false, t.clock.now - 10_000)).toEqual([]);
    expect(await due()).toEqual([t.clock.now - HOUR]);

    // At each run after, the send was a minute before: the box waits a fresh 3 to 10 minutes.
    for (let push = 1; push <= QUIET_PUSHES; push++) {
      t.clock.now = Math.max(t.clock.now + 60_000, (await due())[0]!);
      await t.wallet.touch();
      await sent(t.clock.now - 60_000);
      await t.lovejoin.withdrawDue("preprod", false, t.clock.now);
      expect(t.collateral.asked).toHaveLength(0);
      const [pushed] = await due();
      expect(pushed).toBeGreaterThanOrEqual(t.clock.now + QUIET_PUSH_MS[0]);
      expect(pushed).toBeLessThanOrEqual(t.clock.now + QUIET_PUSH_MS[1]);
    }
    // Pushed as often as it may be, it goes anyway, so it never waits for good.
    t.clock.now = (await due())[0]!;
    await t.wallet.touch();
    await sent(t.clock.now - 60_000);
    await t.lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.collateral.asked).toHaveLength(1);
  });

  it("brings a box back once the wallet's last send is a few minutes behind", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "e9"));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now - HOUR] });
    await t.wallet.withKeys(() => t.session.set(SESSION_SPENT, { [`${"9b".repeat(32)}#0`]: t.clock.now - QUIET_AFTER_SEND_MS }));
    await t.lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.collateral.asked).toHaveLength(1);
  });

  it("only looks for a withdraw that may have gone through at unlock, and sends it again at the next run", async () => {
    const { t } = await withSession("40000000");
    const cbor = swapTx();
    const at = t.clock.now - 10 * 60_000;
    const withdrawing = { txHash: txIdOf(bytes(cbor)), txCbor: cbor, lovelace: "9700000", fee: "300000", at, sentAt: at };
    await t.store.set("lovejoin.preprod", { due: [], chains: [], withdrawing });
    // Koios says it isn't on chain yet.
    const submits = t.koios.submitted.length;
    expect(await t.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.koios.submitted).toHaveLength(submits);
    t.clock.now += 60_000;
    await t.wallet.touch();
    await t.lovejoin.withdrawDue("preprod");
    expect(t.koios.submitted).toHaveLength(submits + 1);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(withdrawing.txHash);
  });

  it("watches a box brought back now in Home's banner, as every send the user makes", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "d5"));
    await t.lovejoin.schedule("preprod", 1);
    // giveme.my's witness stood in for: its recorded answer is another transaction's.
    const wasm = loadTestWasm();
    const lovejoin = new LovejoinService({
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
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const pending = await lovejoin.withdrawNow("preprod");
    expect(pending).toMatchObject({ kind: "lovejoin-withdraw", confirmations: null });
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(pending.txHash);
    expect(await t.wallet.withKeys(() => t.session.get(pendingKey("preprod")))).toEqual(pending);
    // Its due time went with it.
    expect((await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due).toHaveLength(0);
  });

  it("reads the pool at unlock only on a wallet that has used Lovejoin here", async () => {
    const { t } = await withSession("40000000");
    const calls = t.koios.calls.length;
    expect(await t.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.koios.calls.length).toBe(calls);
  });

  it("reads no pool at unlock where nothing is open: the tile opened with nothing there keeps no record, and an emptied one asks nothing (privacy review §2.18)", async () => {
    const { t } = await withSession("40000000");
    // Opening the tile reads the pool, finds nothing of the wallet's, and keeps nothing.
    await t.lovejoin.status("preprod");
    expect(await t.store.get("lovejoin.preprod")).toBeUndefined();
    let calls = t.koios.calls.length;
    expect(await t.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.koios.calls.length).toBe(calls);
    // A record from before, everything back since: nothing either.
    await t.store.set("lovejoin.preprod", { due: [], chains: [], notMixed: 0 });
    expect(await t.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.koios.calls.length).toBe(calls);
    // A box on its way back, not due yet: the unlock reads the pool, so its due time follows it.
    calls = t.koios.calls.length;
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR], chains: [] });
    await t.lovejoin.withdrawDue("preprod", true);
    expect(t.koios.calls.slice(calls).map((c) => c.path)).toContain("credential_utxos");
  });

  it("gives a box found with no due time one (a restore), when the tile opens", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "d3"), await ownedBox(t, "d4"));
    expect((await t.lovejoin.status("preprod")).boxes).toHaveLength(2);
    const due = (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due;
    expect(due).toHaveLength(2);
    expect(Math.min(...due)).toBeGreaterThanOrEqual(t.clock.now + HOUR);
  });
});

describe("mixing from the tile", CHAINS, () => {
  /** An unlocked wallet whose network agrees with every chain's first mix, and measures a Seedelf spend as recorded. */
  async function wallet() {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const spend = withdrawPreprod.amount.evaluation as { result: unknown[] };
    t.koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
      body.params.additionalUtxo ? AGREES : { ...spend, result: spend.result.slice(0, 1) };
    t.koios.addedToAccounts.push(...POOL);
    return t;
  }

  it("mixes from the private balance through a one-time account that runs itself once funded", async () => {
    const t = await wallet();
    const wasm = loadTestWasm();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const alarm = { on: false, start: async () => void (alarm.on = true), stop: async () => void (alarm.on = false) };
    const sessions = new SessionService({
      ...t.deps,
      // giveme.my's witness and the one-time key's signature stood in for, as sessions.test.ts does.
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
      lovejoin: t.lovejoin,
      alarm,
      sleep: async () => undefined,
    });

    // One box at depth 2: the box, four mixes and the deposit's change, and 5 ₳ of collateral.
    const out = await sessions.mixOutBuild("preprod", 1);
    expect(out.mix).toMatchObject({ boxes: 1, depth: 2, mixes: 4, lovelace: "15300000" });
    expect(out.payments.map((p) => p.lovelace)).toEqual(["15300000", "5000000"]);
    const { index, pending } = await sessions.mixOutSubmit("preprod", out.txHash);
    expect(index).toBe(0);
    expect(pending.kind).toBe("session-out");
    expect(alarm.on).toBe(true);
    let [view] = await sessions.list("preprod");
    expect(view).toMatchObject({ stage: "funding", mix: { boxes: 1 } });

    // The funding lands; the runner takes the whole chain at once.
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, "15300000"), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    const before = t.koios.submitted.length;
    view = await sessions.advance("preprod", 0, true);
    const chain = t.koios.submitted.slice(before);
    expect(chain).toHaveLength(6);
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ kind: string }> }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.txs.map((x) => x.kind)).toEqual(["out", "deposit", "mix", "mix", "mix", "mix", "back"]);
    expect((await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due).toHaveLength(1);
    expect(view.auto?.step).toBe("returning");

    // Once it's all in and the account is empty, the mix is over; a swap list doesn't show it.
    t.koios.spent.add(`${out.txHash}#0`).add(`${out.txHash}#1`);
    [view] = await sessions.list("preprod", true);
    expect(view).toMatchObject({ stage: "closed", mix: { boxes: 1 } });
    expect(view!.mix!.skipped).toBeUndefined();
  });

  /**
   * The runner for mixes from the private balance, with its own Lovejoin
   * wired to it, as the worker wires them: no box is withdrawn while a chain
   * mixing them again may spend it.
   */
  function mixRunner(t: ReturnType<typeof testBalances>) {
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

  it("mixes the wallet's boxes again, with no deposit, and withdraws none of them until the chain is sent", async () => {
    const t = await wallet();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    t.koios.addedToAccounts.push(await ownedBox(t, "d6"), await ownedBox(t, "d7"));
    // One box was due a minute ago, the other in half an hour.
    await t.store.set("lovejoin.preprod", { due: [t.clock.now - 60_000, t.clock.now + 30 * 60_000] });
    const { lovejoin, sessions } = mixRunner(t);

    // Both boxes at depth 2: eight mixes and the change they leave, and 5 ₳ of collateral. No box to pay for.
    const out = await sessions.againBuild("preprod");
    expect(out.mix).toMatchObject({ boxes: 2, again: true, depth: 2, mixes: 8, lovelace: "9100000" });
    expect(out.payments.map((p) => p.lovelace)).toEqual(["9100000", "5000000"]);
    expect(await sessions.mixingAgain("preprod")).toBe(false);
    await sessions.mixOutSubmit("preprod", out.txHash);

    // Until its chain is sent, no box is withdrawn, not even the due one, and there's no second mix of them.
    expect(await sessions.mixingAgain("preprod")).toBe(true);
    const calls = t.koios.calls.length;
    expect(await lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.koios.calls.length).toBe(calls);
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow("Your boxes are being mixed again");
    await expect(sessions.againBuild("preprod")).rejects.toThrow("being mixed again already");

    // The funding lands; the runner fans both boxes out again, and the rest comes back.
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, "9100000"), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    t.koios.evaluation = AGREES;
    const before = t.koios.submitted.length;
    const view = await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted.slice(before)).toHaveLength(9);
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ kind: string }> }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.txs.map((x) => x.kind)).toEqual(["out", ...Array(8).fill("mix"), "back"]);
    // The network measured the first mix with nothing extra: its inputs are all on chain.
    const check = t.koios.calls.filter((c) => c.path === "ogmios").at(-1)!;
    expect(check.body.params.additionalUtxo).toBeUndefined();
    // Both boxes wait again, each a fresh delay: the one that was due isn't anymore.
    const due = (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due;
    expect(due).toHaveLength(2);
    for (const d of due) expect(d).toBeGreaterThanOrEqual(t.clock.now + HOUR);
    expect(view).toMatchObject({ mix: { boxes: 2, again: true }, auto: { step: "returning" } });
    // Sent: the boxes may be withdrawn again, when they're due.
    expect(await sessions.mixingAgain("preprod")).toBe(false);
  });

  it("leaves the boxes a mix from the public account put in out of Mix my boxes again, unless asked (privacy review §2.10)", async () => {
    const t = await wallet();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    // A box a cut mix from the public account left at its deposit, not mixed yet, and a leaf of a session's chain.
    const [D, S] = ["d9", "f9"].map((h) => h.repeat(32));
    const cut = {
      id: "a9".repeat(32),
      progress: "seedelf.lovejoin.sending.preprod",
      deposit: D,
      mixes: ["a9".repeat(32)],
      leaves: [{ txHash: "a9".repeat(32), txIndex: 0 }],
      boxes: 1,
      total: 2,
      sent: 1,
      at: t.clock.now - 2 * HOUR,
      scheduled: true,
      stopped: CHAIN_CUT,
      ended: t.clock.now - 2 * HOUR,
    };
    const done = {
      id: S!,
      session: 3,
      progress: "seedelf.session.chain.preprod.3",
      deposit: "c9".repeat(32),
      mixes: [S!],
      leaves: [{ txHash: S!, txIndex: 0 }],
      boxes: 1,
      total: 3,
      sent: 3,
      at: t.clock.now - HOUR,
      scheduled: true,
      done: true,
      ended: t.clock.now - HOUR,
    };
    t.koios.addedToAccounts.push(await ownedBox(t, D!, 1), await ownedBox(t, S!, 0));
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR], chains: [cut, done] });
    const { lovejoin, sessions } = mixRunner(t);
    expect((await lovejoin.status("preprod")).fromPublic).toEqual([{ txHash: D, txIndex: 1 }]);
    expect(await lovejoin.againBoxes("preprod", true)).toEqual({ boxes: 2, owned: 2 });

    // From the private balance: the session's box alone.
    const out = await sessions.againBuild("preprod");
    expect(out.mix).toMatchObject({ boxes: 1, again: true, owned: 1 });
    expect(out.mix.publicToo).toBeUndefined();
    await sessions.mixOutSubmit("preprod", out.txHash);
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    t.koios.evaluation = AGREES;
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", 0, true);
    const spent = t.koios.submitted.slice(before).flatMap((tx) => txInputs(tx));
    expect(spent).toContain(`${S}#0`);
    expect(spent).not.toContain(`${D}#1`);
  });

  it("mixes the public account's boxes again from the private balance only when asked, and records that it was", async () => {
    const t = await wallet();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const D = "d9".repeat(32);
    const cut = {
      id: "a9".repeat(32),
      progress: "seedelf.lovejoin.sending.preprod",
      deposit: D,
      mixes: ["a9".repeat(32)],
      leaves: [{ txHash: "a9".repeat(32), txIndex: 0 }],
      boxes: 1,
      total: 2,
      sent: 1,
      at: t.clock.now - 2 * HOUR,
      scheduled: true,
      stopped: CHAIN_CUT,
      ended: t.clock.now - 2 * HOUR,
    };
    t.koios.addedToAccounts.push(await ownedBox(t, D, 1));
    await t.store.set("lovejoin.preprod", { due: [], chains: [cut] });
    const { sessions } = mixRunner(t);
    await expect(sessions.againBuild("preprod")).rejects.toThrow("Mix them again from your public account instead");
    const out = await sessions.againBuild("preprod", true);
    expect(out.mix).toMatchObject({ boxes: 1, again: true, publicToo: true });
    await sessions.mixOutSubmit("preprod", out.txHash);
    const book = (await t.store.get<{ sessions: Array<{ mix?: unknown }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.mix).toEqual({ boxes: 1, again: true, publicToo: true });
  });

  it("mixes whatever Settings says of a session's return: a mix is what was asked for (privacy review §4.1)", async () => {
    const t = await wallet();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    await t.deps.preferences.set({ lovejoinReturns: false });
    const { sessions } = mixRunner(t);
    const out = await sessions.mixOutBuild("preprod", 1);
    await sessions.mixOutSubmit("preprod", out.txHash);
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    await sessions.advance("preprod", 0, true);
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ kind: string }> }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.txs.map((x) => x.kind)).toEqual(["out", "deposit", "mix", "mix", "mix", "mix", "back"]);
  });

  it("brings a mix back directly when it's stopped, the way out of one whose chain can't go", async () => {
    const t = await wallet();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const { sessions } = mixRunner(t);
    const out = await sessions.mixOutBuild("preprod", 1);
    await sessions.mixOutSubmit("preprod", out.txHash);
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    // Koios's view of the pool stays behind: the chain can't be built, and the runner tries again later.
    t.koios.evaluation = (body: { params: { transaction: { cbor: string } } }) => {
      const poolRefs = new Set(POOL.map((u) => `${u.tx_hash}#${u.tx_index}`));
      const [id, index] = txInputs(Uint8Array.from(Buffer.from(body.params.transaction.cbor, "hex"))).find((o) => poolRefs.has(o))!.split("#");
      return { jsonrpc: "2.0", error: { code: 3117, message: "Unknown", data: { unknownOutputReferences: [{ transaction: { id }, index: Number(index) }] } } };
    };
    let view = await sessions.advance("preprod", 0, true);
    expect(view.auto?.retry?.error).toMatch("pool changed");
    // Stop: it all comes back directly, and says Lovejoin was left out.
    const before = t.koios.submitted.length;
    view = await sessions.stop("preprod", 0);
    expect(t.koios.submitted.slice(before)).toHaveLength(1);
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ kind: string }> }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.txs.map((x) => x.kind)).toEqual(["out", "back"]);
    expect(view.mix).toEqual({ boxes: 1, skipped: "you stopped it before its boxes went in" });
  });

  it("mixes what a deposit Koios never answered spent, once it's gone unseen, rather than bring back only the collateral (final review sessions-1)", async () => {
    const t = await wallet();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const { sessions } = mixRunner(t);
    const out = await sessions.mixOutBuild("preprod", 1);
    await sessions.mixOutSubmit("preprod", out.txHash);
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    t.koios.evaluation = AGREES;
    // Every try of the chain's deposit gets a 503, and none reaches a node: the chain stops.
    const fetch = t.koios.fetch;
    const lost = new Set<string>();
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx")) return fetch(url, init);
      lost.add(txIdOf(init!.body as Uint8Array));
      return new Response("", { status: 503 });
    };
    const before = t.koios.submitted.length;
    let view = await sessions.advance("preprod", 0, true);
    t.koios.fetch = fetch;
    expect(lost.size).toBe(1);
    for (const h of lost) t.koios.missing.add(h);
    expect(view.chain?.stopped).toBeTruthy();

    // Sixteen minutes on, unseen: dropped, and what it spent is free again. It goes through Lovejoin again, funding and all.
    for (const step of [8, 8]) {
      t.clock.now += step * 60_000;
      await t.wallet.touch();
    }
    view = await sessions.advance("preprod", 0, true);
    const sent = t.koios.submitted.slice(before);
    expect(sent.length).toBeGreaterThan(1);
    expect(txInputs(sent[0]!)).toContain(`${out.txHash}#0`);
    expect(view.mix!.skipped).toBeUndefined();
  });

  it("brings a mix-again back directly when its boxes have left the pool since", async () => {
    const t = await wallet();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    t.koios.addedToAccounts.push(await ownedBox(t, "d8"));
    const { sessions } = mixRunner(t);
    const out = await sessions.againBuild("preprod");
    expect(out.mix).toMatchObject({ boxes: 1, again: true, mixes: 4 });
    await sessions.mixOutSubmit("preprod", out.txHash);
    // Withdrawn from another device before the funding landed.
    t.koios.spent.add(`${"d8".repeat(32)}#0`);
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, out.mix.lovelace), atSession(out.txHash, 1, "5000000"));
    t.koios.confirmations = 1;
    const before = t.koios.submitted.length;
    const view = await sessions.advance("preprod", 0, true);
    expect(t.koios.submitted.slice(before)).toHaveLength(1);
    expect(view.mix).toEqual({ boxes: 1, again: true, skipped: "none of your boxes is in Lovejoin's pool anymore" });
    expect(await sessions.mixingAgain("preprod")).toBe(false);
  });

  it("mixes as many of the wallet's boxes again as the pool has others for, past ten", async () => {
    const t = await wallet();
    // Forty other boxes, and twelve of ours.
    const others = [...POOL, ...POOL.map((b, i) => ({ ...b, tx_hash: (i % 2 ? "e1" : "e2").repeat(31) + i.toString(16).padStart(2, "0") }))];
    t.koios.addedToAccounts.splice(0, t.koios.addedToAccounts.length, ...others);
    for (let i = 0; i < 12; i++) t.koios.addedToAccounts.push(await ownedBox(t, (0xa0 + i).toString(16)));
    // One wave deep, 40 others mix twenty: all twelve go.
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    expect(await t.lovejoin.againBoxes("preprod")).toEqual({ boxes: 12, owned: 12 });
    // Two waves deep, each box takes eight others: five of the twelve go.
    await t.deps.preferences.set({ lovejoinDepth: 2 });
    expect(await t.lovejoin.againBoxes("preprod")).toEqual({ boxes: 5, owned: 12 });
  });

  it("won't mix again with no box of the wallet's in the pool", async () => {
    const t = await wallet();
    const { sessions } = mixRunner(t);
    await expect(sessions.againBuild("preprod")).rejects.toThrow("None of your boxes is in Lovejoin's pool");
  });

  it("won't fund a mix the pool can't take, or more boxes than it mixes at once", async () => {
    const t = await wallet();
    const sessions = new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin: t.lovejoin,
    });
    // Twenty pool boxes: three boxes at depth 2 need 24.
    await expect(sessions.mixOutBuild("preprod", 3)).rejects.toThrow("pool has 20 boxes to mix with, and 3 boxes 2 waves deep need 24");
    await expect(sessions.mixOutBuild("preprod", 11)).rejects.toThrow("Mix 1 to 10 boxes");
    await expect(t.lovejoin.publicBuild("preprod", 0)).rejects.toThrow("Mix 1 to 10 boxes");
  });

  it("mixes from the public account straight in, its collateral backing every mix", async () => {
    const t = await wallet();
    // The recorded account holds no collateral and little ADA alone: it's asked for, then paid in.
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("Set it aside in Settings, Collateral");
    const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
    const at = (tx: string, value: string) => ({ ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] });
    t.koios.addedToAccounts.push(at("e5", "5000000"));
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("doesn't pay for a box of 10 ₳ and its mixes: that takes 16 ₳");
    t.koios.addedToAccounts.push(at("e6", "30000000"));
    const summary = await t.lovejoin.publicBuild("preprod", 1);
    expect(summary).toMatchObject({ boxes: 1, depth: 2, mixes: 4, txs: 5 });
    expect(BigInt(summary.change)).toBeGreaterThan(1_000_000n);
    const before = t.koios.submitted.length;
    // Its Send button counts the transactions as they go in.
    const counted: Array<{ total: number; sent: number } | null> = [];
    const fetch = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx")) counted.push(await t.lovejoin.progress("preprod"));
      return fetch(url, init);
    };
    // Paced: four go, then the fifth once a block has taken some.
    const pending = await t.lovejoin.publicSubmit("preprod", summary.txHash);
    expect(t.koios.submitted.length - before).toBe(4);
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("still being sent");
    t.koios.confirmations = 1;
    expect(await t.lovejoin.pumpPublic("preprod")).toBe(false);
    expect(counted).toEqual([0, 1, 2, 3, 4].map((sent) => ({ total: 5, sent })));
    expect(await t.lovejoin.progress("preprod")).toBeNull();
    expect(pending).toMatchObject({ kind: "lovejoin-mix", txHash: summary.txHash });
    const sent = t.koios.submitted.slice(before);
    expect(sent).toHaveLength(5);
    expect(txIdOf(sent.at(-1)!)).toBe(summary.txHash);
    expect((await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due).toHaveLength(1);
    // Sent once.
    await expect(t.lovejoin.publicSubmit("preprod", summary.txHash)).rejects.toThrow("isn't ready to send");
  });
});

describe("a swap's way back (privacy review §2.7, §2.8, §4.1)", CHAINS, () => {
  const ASK = minswapEstimate.ask;
  const poolReads = (t: ReturnType<typeof testBalances>) =>
    t.koios.calls.filter((c) => c.path === "credential_utxos" && c.body._payment_credentials[0] === NETWORKS.preprod.lovejoin!.mixBox).length;

  /** A wallet that can fund a 10 ₳ swap (one Seedelf spend), Lovejoin's pool, and sessions that use it. */
  async function swapping() {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const spend = withdrawPreprod.amount.evaluation as { result: unknown[] };
    t.koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
      body.params.additionalUtxo ? AGREES : { ...spend, result: spend.result.slice(0, 1) };
    t.koios.addedToAccounts.push(...POOL);
    const sessions = new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin: t.lovejoin,
      sleep: async () => undefined,
    });
    return { t, sessions };
  }

  /** A swap that runs itself, approved `direct` or not (none: from before), funded, its account holding 40 ₳ and its 5 ₳ collateral. */
  async function approved(direct?: boolean) {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: {
            approved: { minAmountOut: "902083681", fund: { lovelace: "40000000", tokens: [] } },
            ...(direct === undefined ? {} : { direct }),
          },
        },
      ],
    });
    t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"), atSession("c2".repeat(32), 1, "5000000"), ...POOL);
    t.koios.evaluation = AGREES;
    t.koios.confirmations = 1;
    const sessions = new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin: t.lovejoin,
      sleep: async () => undefined,
    });
    return { t, sessions };
  }

  const kinds = async (t: ReturnType<typeof testBalances>) =>
    (await t.store.get<{ sessions: Array<{ txs: Array<{ kind: string }> }> }>("sessions.preprod"))!.sessions[0]!.txs.map((x) => x.kind);

  it("reads the pool once, at Review, and says the ADA would come back directly while the pool is under its floor", async () => {
    const { t, sessions } = await swapping();
    // As the user types, no pool read. The proceeds are tokens: only a stop's 16 ₳ pays for a box.
    const quote = await sessions.quote("preprod", ASK);
    expect(quote.lovejoin).toMatchObject({ on: true, boxes: 0, ifStopped: { boxes: 1, mixes: 4 } });
    expect(poolReads(t)).toBe(0);
    const preprod = NETWORKS.preprod.lovejoin!;
    const floor = preprod.poolFloor;
    preprod.poolFloor = 25;
    try {
      const out = await sessions.outBuild("preprod", quote);
      expect(out.lovejoin).toMatchObject({
        on: true,
        boxes: 0,
        skipped: "Right now Lovejoin's pool holds 20 boxes that aren't yours, under the 25 it needs",
        ifStopped: { boxes: 0, of: 1 },
      });
      expect(poolReads(t)).toBe(1);
      // Reviewed again within five minutes: the same reading.
      await sessions.outBuild("preprod", quote);
      expect(poolReads(t)).toBe(1);
    } finally {
      preprod.poolFloor = floor;
    }
  });

  it("says a pool with too few boxes free takes none, and reads it again after five minutes", async () => {
    const { t, sessions } = await swapping();
    const all = [...t.koios.addedToAccounts];
    t.koios.addedToAccounts = all.filter((u) => !POOL.slice(7).includes(u));
    const quote = await sessions.quote("preprod", ASK);
    expect((await sessions.outBuild("preprod", quote)).lovejoin).toMatchObject({
      skipped: "Right now Lovejoin's pool has 7 boxes to mix with, and a box 2 waves deep needs 8",
    });
    t.koios.addedToAccounts = all;
    t.clock.now += 6 * 60_000;
    await t.wallet.touch();
    const again = (await sessions.outBuild("preprod", quote)).lovejoin!;
    expect(again.skipped).toBeUndefined();
    expect(again.ifStopped).toEqual({ boxes: 1, mixes: 4, mixFees: "3800000", withdrawFees: "300000" });
    expect(poolReads(t)).toBe(2);
  });

  it("reads no pool at Review when Settings brings sessions back directly, and keeps what the approval chose", async () => {
    const { t, sessions } = await swapping();
    await t.deps.preferences.set({ lovejoinReturns: false });
    const quote = await sessions.quote("preprod", ASK);
    const out = await sessions.outBuild("preprod", quote);
    expect(out.lovejoin).toMatchObject({ on: false, ifStopped: { boxes: 1 } });
    expect(poolReads(t)).toBe(0);
    // The approval's switch, turned on: kept with the swap, recorded before its funding is sent.
    await sessions.outSubmit("preprod", out.txHash, false).catch(() => undefined);
    const book = (await t.store.get<{ sessions: Array<{ auto: { direct?: boolean } }> }>("sessions.preprod"))!;
    expect(book.sessions[0]!.auto.direct).toBe(false);

    // No choice sent: Settings' is kept.
    const other = await swapping();
    await other.t.deps.preferences.set({ lovejoinReturns: false });
    const next = await other.sessions.outBuild("preprod", await other.sessions.quote("preprod", ASK));
    await other.sessions.outSubmit("preprod", next.txHash).catch(() => undefined);
    expect((await other.sessions.list("preprod"))[0]!.auto?.direct).toBe(true);
  });

  it("comes back as approved: directly though Settings sends returns through Lovejoin", async () => {
    const { t, sessions } = await approved(true);
    expect(await sessions.stopCost("preprod", 0)).toBeNull();
    const view = await sessions.stop("preprod", 0);
    expect(await kinds(t)).toEqual(["out", "back"]);
    expect(view.auto?.direct).toBe(true);
    expect(view.lovejoinSkipped).toBeUndefined();
    expect(poolReads(t)).toBe(0);
  });

  it("comes back as approved: through Lovejoin though Settings has turned it off since", async () => {
    const { t, sessions } = await approved(false);
    await t.deps.preferences.set({ lovejoinReturns: false });
    await sessions.stop("preprod", 0);
    expect((await kinds(t)).slice(0, 3)).toEqual(["out", "deposit", "mix"]);
  });

  it("says what Stop brings back through Lovejoin, as the pool has room for, and stops directly when asked", async () => {
    const { t, sessions } = await approved(false);
    await sessions.list("preprod", true);
    // 40 ₳ at the account, its collateral aside: two boxes, four mixes each.
    expect(await sessions.stopCost("preprod", 0)).toEqual({
      boxes: 2,
      mixes: 8,
      mixFees: "7600000",
      withdrawFees: "600000",
      depth: 2,
      delay: "1-6",
      on: true,
    });
    // Stop, bring it back directly: one return, and the swap says so.
    const view = await sessions.stop("preprod", 0, true);
    expect(await kinds(t)).toEqual(["out", "back"]);
    expect(view.auto?.direct).toBe(true);

    // A pool with room for one box: one of the two.
    const small = await approved(false);
    small.t.koios.addedToAccounts = small.t.koios.addedToAccounts.filter((u) => !POOL.slice(9).includes(u));
    await small.sessions.list("preprod", true);
    expect(await small.sessions.stopCost("preprod", 0)).toMatchObject({ boxes: 1, of: 2, mixes: 4 });
  });
});

describe("a payment that may still go through", CHAINS, () => {
  it("stops a box brought back now and a mix from the public account, and Home's banner keeps watching it (final review lovejoin-2)", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    t.koios.evaluation = AGREES;
    const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
    const keyHash = await t.wallet.withKeys((keys) => keys.cardano.paymentKeyHash(0, 0));
    const at = (tx: string, value: string) => ({ ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, payment_cred: keyHash, asset_list: [] });
    t.koios.addedToAccounts.push(...POOL, await ownedBox(t, "d5"), at("e5", "5000000"), at("e6", "30000000"));
    await t.lovejoin.schedule("preprod", 1);
    // A mix from the public account reviewed in one window, then a payment in another that Koios doesn't answer.
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    const payment = await t.send.build("preprod", [{ to: account(15).preprod.receive_0 as string, lovelace: "2000000", tokens: [] }]);
    const fetch = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const answer = await fetch(url, init);
      if (!url.endsWith("/submittx")) return answer;
      t.koios.fetch = fetch;
      throw new DOMException("signal timed out", "TimeoutError");
    };
    expect(await t.send.submit("preprod", payment.txHash)).toMatchObject({ maybeSent: true });
    const watched = await t.wallet.withKeys(() => t.session.get(pendingKey("preprod")));
    const submitted = t.koios.submitted.length;

    const lovejoin = witnessed(t);
    await expect(lovejoin.withdrawNow("preprod")).rejects.toThrow(MAYBE_SENT_WAIT);
    await expect(lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow(MAYBE_SENT_WAIT);
    await expect(lovejoin.publicBuild("preprod", 1)).rejects.toThrow(MAYBE_SENT_WAIT);
    // Nothing went beside it: giveme.my wasn't asked, and none of the mix was sent, recorded or taken as being sent.
    expect(t.koios.submitted).toHaveLength(submitted);
    expect(t.collateral.asked).toEqual([]);
    expect(await lovejoin.progress("preprod")).toBeNull();
    expect((await t.store.get<{ chains?: unknown[] }>("lovejoin.preprod"))?.chains ?? []).toEqual([]);
    const reserved = await t.wallet.withKeys(() => t.session.get<Record<string, { until?: number }>>("seedelf.reserved.preprod"));
    expect(reserved?.public?.until).toBeDefined();
    expect(await t.wallet.withKeys(() => t.session.get(pendingKey("preprod")))).toEqual(watched);

    // Once it lands, the box comes back, and the banner watches that.
    t.koios.confirmations = 1;
    t.clock.now += 10 * 60_000 + 1;
    const back = await lovejoin.withdrawNow("preprod");
    expect(back).toMatchObject({ kind: "lovejoin-withdraw" });
    expect(await t.wallet.withKeys(() => t.session.get(pendingKey("preprod")))).toEqual(back);
  });
});
