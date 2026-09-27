// Lovejoin in the worker (lovejoin.ts, and sessions.ts's return through it),
// with the real WebAssembly module, a recorded preprod pool, and fake Koios
// and giveme.my. Every chain is measured against the deployed scripts inside
// WebAssembly, as it is in the wallet.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readAccount, readAccountUtxos } from "../src/background/account";
import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { KoiosError, SpentInputError, type KoiosUtxo } from "../src/background/koios";
import {
  CHAIN_CUT,
  CHAIN_POLL_MS,
  CHAIN_PUMP_MS,
  CHAIN_RESEND_MS,
  CHAIN_WINDOW,
  chainRetryMs,
  LOVEJOIN_MIX_BOX,
  LovejoinService,
  MAX_CHAIN_MIXES,
  mixesPerBox,
  POOL_FLOOR,
  pumpChain,
  secureRandom,
  WITHDRAW_SPREAD_MS,
  type ChainProgress,
} from "../src/background/lovejoin";
import { SESSION_PENDING } from "../src/background/pending";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

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
    // Three minutes on, still nothing: a node dropped it. The first goes again, as maybe in already.
    expect(await pumpChain(chain, io, CHAIN_POLL_MS)).toBe(false);
    expect(sent.slice(4)).toEqual([[0, true]]);
    expect(chain.sentAt![0]).toBe(clock.now);
    // It lands, and the rest go.
    io.onChain = async (hashes) => new Set(hashes.filter((h) => h === "t0"));
    await pumpChain(chain, io, 0);
    expect(sent.slice(5)).toEqual([[4, false]]);
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
    expect(t.koios.calls.filter((c) => c.path === "credential_utxos" && c.body._payment_credentials[0] === LOVEJOIN_MIX_BOX.preprod)).toHaveLength(1);
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

  it("comes back directly when asked, or when the spare ADA doesn't pay for a box", async () => {
    const { t, sessions } = await withSession("40000000");
    const direct = await sessions.backBuild("preprod", 0, true);
    expect(direct.lovejoin).toBeUndefined();
    expect(direct.inputs).toBe(2);

    const small = await withSession("8000000");
    const plain = await small.sessions.backBuild("preprod", 0);
    expect(plain.lovejoin).toBeUndefined();
    // No pool read: the plan said no box before anything was fetched.
    expect(small.t.koios.calls.some((c) => c.path === "credential_utxos" && c.body._payment_credentials[0] === LOVEJOIN_MIX_BOX.preprod)).toBe(false);
    void t;
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
    const floor = POOL_FLOOR.preprod;
    POOL_FLOOR.preprod = 25;
    try {
      const review = await sessions.backBuild("preprod", 0);
      expect(review.lovejoin).toBeUndefined();
      expect(review.lovejoinSkipped).toBe(
        "Lovejoin's pool holds 20 boxes that aren't yours, and the wallet mixes only once it holds 25, so yours hide among enough others",
      );
      await expect(sessions.mixOutBuild("preprod", 1)).rejects.toThrow("holds 20 boxes that aren't yours");
    } finally {
      POOL_FLOOR.preprod = floor;
    }
    expect(POOL_FLOOR.mainnet).toBe(30);
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
    // Its time moves to when it will have waited an hour.
    expect((await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due).toEqual([t.clock.now - 600_000 + HOUR]);
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

  it("brings boxes due together back one a run, the others each a fresh delay later", async () => {
    const { t } = await withSession("40000000");
    t.koios.addedToAccounts.push(await ownedBox(t, "e1"), await ownedBox(t, "e2"), await ownedBox(t, "e3"));
    await t.lovejoin.schedule("preprod", 3);
    // Locked through all three delays: at unlock, one is tried (giveme.my's
    // recorded answer is another transaction's, so it isn't sent), not three.
    t.clock.now += 7 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const now = t.clock.now;
    expect(await t.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.collateral.asked).toHaveLength(1);
    const due = (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due.sort((a, b) => a - b);
    expect(due).toHaveLength(3);
    // The one tried stays due; the other two each wait again, apart.
    const [low, high] = WITHDRAW_SPREAD_MS;
    expect(due[0]).toBeLessThanOrEqual(now);
    for (const d of due.slice(1)) {
      expect(d).toBeGreaterThanOrEqual(now + low);
      expect(d).toBeLessThanOrEqual(now + high);
    }
    expect(due[1]).not.toBe(due[2]);

    // The next minute's alarm tries the one still due, and nothing else.
    t.clock.now += 60_000;
    await t.lovejoin.withdrawDue("preprod");
    expect(t.collateral.asked).toHaveLength(2);
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
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_PENDING))).toEqual(pending);
    // Its due time went with it.
    expect((await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due).toHaveLength(0);
  });

  it("reads the pool at unlock only on a wallet that has used Lovejoin here", async () => {
    const { t } = await withSession("40000000");
    const calls = t.koios.calls.length;
    expect(await t.lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect(t.koios.calls.length).toBe(calls);
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
