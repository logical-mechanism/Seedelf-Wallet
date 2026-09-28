// Nothing goes out the moment the wallet unlocks (privacy review §3.1): a
// fresh draw from the unlock, whichever run or page gets there first. And no
// Lovejoin box goes back within minutes of the wallet's own send, one a lock
// or a closed browser made it forget included, while an unlock alone isn't a
// send (independent review M10, L10, L11, L12, L13). The real WebAssembly, a
// recorded preprod pool, and fakes of Koios, giveme.my and Minswap.
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, QUIET_AFTER_SEND_MS, QUIET_PUSH_MS, UNLOCK_WAIT_MS } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { runNetworks, type Runner } from "../src/background/runs";
import { SessionService } from "../src/background/sessions";
import { SESSION_SPENT } from "../src/background/spent";
import { noteStart, SESSION_SENDS, SESSION_UNLOCKED_AT } from "../src/background/wallet";
import type { NetworkName } from "../src/networks";
import { txIdOf } from "./fixtures/cbor";
import { bytes, swapTx } from "./fixtures/swap-tx";
import { busyFor, loadTestWasm, minswapEstimate, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
/** Each withdraw is built and measured in WebAssembly: past Vitest's 5 s on CI's runners. */
const SLOW = { timeout: 30_000 };

/** Lovejoin's preprod pool, as Koios lists it (2026-09-25). */
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

type T = ReturnType<typeof testBalances>;

/** A box of ours in the pool: a fresh re-randomization of the Seedelf key's register. */
async function ownedBox(t: T, tx: string): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  return { ...POOL[0]!, tx_hash: tx.repeat(32), tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
}

/** Lovejoin with giveme.my's witness stood in for, so a withdraw that goes is submitted; its draws `random`'s, if given. */
function witnessed(t: T, random?: () => number): LovejoinService {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
    ...t.deps,
    ...(random ? { random } : {}),
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

/** An unlocked wallet with Lovejoin's pool and one box of its own in it. */
async function withBox(random?: () => number) {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.addedToAccounts.push(...POOL, await ownedBox(t, "e1"));
  return { t, lovejoin: witnessed(t, random) };
}

const schedule = async (t: T) =>
  (await t.store.get<{ due: number[]; marks?: Record<string, { unlock?: true; pushes?: number }> }>("lovejoin.preprod"))!;

/** Koios answers `path` with a 502 until the undo. */
function failing(t: T, path: string) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => (url.includes(`/${path}`) ? new Response("bad gateway", { status: 502 }) : real(url, init));
  return () => {
    t.koios.fetch = real;
  };
}

describe("the quiet after the wallet's own send, across a lock or a closed browser (independent review M10)", SLOW, () => {
  /** The wallet pays at `paid`: what it spent says so. */
  const pays = (t: T, paid: number) => t.wallet.withKeys(() => t.session.set(SESSION_SPENT, { [`${"9a".repeat(32)}#0`]: paid }));

  it("notes the browser's start once, and a lock keeps it with the last send, and nothing else", async () => {
    const t = testBalances();
    // The worker's first start after the browser's.
    const started = t.clock.now;
    await noteStart(t.session, started);
    await t.wallet.create(PHRASE, PASSWORD);
    // A restarted worker doesn't move it.
    await busyFor(t, 60_000);
    await noteStart(t.session, t.clock.now);
    expect(await t.wallet.sends()).toEqual({ sent: 0, forgotten: started });
    const paid = t.clock.now;
    await pays(t, paid);
    await t.wallet.lock();
    expect([...t.session.data.keys()]).toEqual([SESSION_SENDS]);
    await t.wallet.unlock(PASSWORD);
    expect(await t.wallet.sends()).toEqual({ sent: paid, forgotten: started });
  });

  it("keeps a send's time across a lock: a box due minutes after it is pushed, not withdrawn", async () => {
    const { t, lovejoin } = await withBox();
    await busyFor(t, HOUR);
    // The wallet pays at T; a box is due four minutes on.
    const paid = t.clock.now;
    await t.store.set("lovejoin.preprod", { due: [paid + 4 * 60_000] });
    await pays(t, paid);
    // Half a minute later it locks; a minute after the payment it's unlocked again.
    t.clock.now += 30_000;
    await t.wallet.lock();
    t.clock.now += 30_000;
    await t.wallet.unlock(PASSWORD);
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_SPENT))).toBeUndefined();
    expect(await t.wallet.sends()).toEqual({ sent: paid, forgotten: 0 });
    expect(await lovejoin.withdrawDue("preprod", true)).toEqual([]);
    expect((await schedule(t)).due).toEqual([paid + 4 * 60_000]);

    // Its time comes, a minute short of the quiet after the payment: pushed a fresh few minutes.
    await busyFor(t, paid + 4 * 60_000 - t.clock.now);
    expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
    const [pushed] = (await schedule(t)).due;
    expect(pushed).toBeGreaterThanOrEqual(t.clock.now + QUIET_PUSH_MS[0]);
    expect(pushed).toBeLessThanOrEqual(t.clock.now + QUIET_PUSH_MS[1]);
    expect((await schedule(t)).marks?.[pushed!]).toEqual({ pushes: 1 });

    await busyFor(t, pushed! - t.clock.now);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.collateral.asked).toHaveLength(1);
  });

  it("counts a send a closed browser wiped as late as the browser's start", async () => {
    const { t, lovejoin } = await withBox();
    await busyFor(t, HOUR);
    const paid = t.clock.now;
    await t.store.set("lovejoin.preprod", { due: [paid + 4 * 60_000] });
    await pays(t, paid);
    // Half a minute later the browser closes, unlocked: session storage goes, unseen.
    t.clock.now += 30_000;
    t.session.data.clear();
    // Ten seconds on it starts again, and so does the worker; the wallet is unlocked twenty seconds later.
    t.clock.now += 10_000;
    const started = t.clock.now;
    await noteStart(t.session, started);
    t.clock.now += 20_000;
    await t.wallet.unlock(PASSWORD);
    expect(await t.wallet.sends()).toEqual({ sent: 0, forgotten: started });
    expect(await lovejoin.withdrawDue("preprod", true)).toEqual([]);

    // Its time comes: what the wallet sent is forgotten, and may have been as late as the browser's start.
    await busyFor(t, paid + 4 * 60_000 - t.clock.now);
    expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
    const [pushed] = (await schedule(t)).due;
    expect(pushed).toBeGreaterThanOrEqual(t.clock.now + QUIET_PUSH_MS[0]);

    // Once the browser's start is as far behind as a send would have to be, it goes.
    await busyFor(t, Math.max(pushed!, started + QUIET_AFTER_SEND_MS) - t.clock.now);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.collateral.asked).toHaveLength(1);
  });

  /**
   * The wallet on a 5-minute auto-lock, unlocked now and left alone: the
   * unlock's run, then the alarm's every minute until the lock at five
   * (the caller's). Returns how far into the unlock the box went, or
   * undefined if it didn't.
   */
  async function idleUnlock(t: T, lovejoin: LovejoinService): Promise<number | undefined> {
    await t.wallet.unlock(PASSWORD);
    const unlocked = t.clock.now;
    await lovejoin.withdrawDue("preprod", true);
    for (let minute = 1; minute <= 5; minute++) {
      t.clock.now = unlocked + minute * 60_000;
      await lovejoin.withdrawDue("preprod", false, t.clock.now);
      if (t.collateral.asked.length) return t.clock.now - unlocked;
    }
    return undefined;
  }

  it("never counts an unlock as a send: a box due while it was locked goes on its fresh draw, inside the first unlock", async () => {
    const { t, lovejoin } = await withBox(() => 0.5);
    await t.deps.preferences.set({ lockAfterMinutes: 5 });
    await busyFor(t, HOUR);
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + 30 * 60_000] });
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    const went = await idleUnlock(t, lovejoin);
    // Its draw is 2 to 3 minutes in, and the run a minute after takes it at the latest.
    expect(went).toBeGreaterThanOrEqual(UNLOCK_WAIT_MS[0]);
    expect(went).toBeLessThanOrEqual(4 * 60_000);
  });

  it("leaves the next unlock its draw when a send the browser forgot pushed the box past a short one", async () => {
    const { t, lovejoin } = await withBox(() => 0.5);
    await t.deps.preferences.set({ lockAfterMinutes: 5 });
    await busyFor(t, HOUR);
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + 30 * 60_000] });
    // The browser closes, unlocked; hours later it starts, and the wallet is unlocked half a minute on.
    t.session.data.clear();
    t.clock.now += 3 * HOUR;
    await noteStart(t.session, t.clock.now);
    t.clock.now += 30_000;
    // Its draw falls within minutes of the browser's start: pushed past this unlock, which locks at five.
    expect(await idleUnlock(t, lovejoin)).toBeUndefined();
    const [pushed] = (await schedule(t)).due;
    expect(pushed).toBeGreaterThan(t.clock.now);
    expect((await schedule(t)).marks?.[pushed!]).toEqual({ pushes: 1 });
    await t.wallet.lock();
    // Unlocked again an hour on: a fresh draw into it, not the first minute's run.
    t.clock.now += HOUR;
    const went = await idleUnlock(t, lovejoin);
    expect(went).toBeGreaterThanOrEqual(UNLOCK_WAIT_MS[0]);
    expect(went).toBeLessThanOrEqual(4 * 60_000);
  });
});

describe("the unlock's fresh draws, whichever run gets there first (independent review L10, L13)", SLOW, () => {
  it("draws a box's wait though the unlock's pool read fails, so the next run doesn't send it a minute in", async () => {
    const { t, lovejoin } = await withBox();
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR] });
    await t.wallet.lock();
    t.clock.now += 7 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const unlocked = t.clock.now;
    // Koios fails the unlock's pool read.
    const undo = failing(t, "credential_utxos");
    await expect(lovejoin.withdrawDue("preprod", true)).rejects.toThrow();
    undo();
    const kept = await schedule(t);
    expect(kept.due).toHaveLength(1);
    expect(kept.due[0]).toBeGreaterThanOrEqual(unlocked + UNLOCK_WAIT_MS[0]);
    expect(kept.marks?.[kept.due[0]!]?.unlock).toBe(true);
    // The alarm's run a minute in reads the pool fine, and sends nothing.
    await busyFor(t, 60_000);
    expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
  });

  it("draws it at the first run after the unlock when the unlock's own run never came, and sends it after", async () => {
    const { t, lovejoin } = await withBox();
    await t.store.set("lovejoin.preprod", { due: [t.clock.now + HOUR] });
    await t.wallet.lock();
    t.clock.now += 7 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const unlocked = t.clock.now;
    // A page's or the alarm's run gets here before the unlock's.
    await busyFor(t, 30_000);
    expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
    const [drawn] = (await schedule(t)).due;
    expect(drawn).toBeGreaterThanOrEqual(t.clock.now + UNLOCK_WAIT_MS[0]);
    // The unlock's run, late, draws nothing more.
    await lovejoin.withdrawDue("preprod", true);
    expect((await schedule(t)).due).toEqual([drawn]);
    // Its time comes, past the unlock's quiet: it goes.
    await busyFor(t, Math.max(drawn!, unlocked + QUIET_AFTER_SEND_MS) - t.clock.now);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.collateral.asked).toHaveLength(1);
  });

  it("draws one too for a box that comes due in the first minute after the unlock (L13)", async () => {
    const { t, lovejoin } = await withBox();
    // Due three hours on, and half a minute: the wallet locks, and unlocks three hours on.
    const due = t.clock.now + 3 * HOUR + 30_000;
    await t.store.set("lovejoin.preprod", { due: [due] });
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await lovejoin.withdrawDue("preprod", true);
    const [drawn] = (await schedule(t)).due;
    expect(drawn).toBeGreaterThanOrEqual(t.clock.now + UNLOCK_WAIT_MS[0]);
    // The first minute's run finds nothing due.
    await busyFor(t, 60_000);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.collateral.asked).toHaveLength(0);
  });

  it("leaves a box due later than the least of a fresh wait as it was", async () => {
    const { t, lovejoin } = await withBox();
    const due = t.clock.now + 3 * HOUR + UNLOCK_WAIT_MS[0] + 60_000;
    await t.store.set("lovejoin.preprod", { due: [due] });
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await lovejoin.withdrawDue("preprod", true);
    expect((await schedule(t)).due).toEqual([due]);
  });
});

describe("a run under way across a lock and an unlock (independent review L11)", () => {
  /** The worker's services, faked, logging what each network is asked and whether as the unlock's run. */
  function runner(changeDuring: "step mainnet" | "withdraw mainnet") {
    let unlockedAt = 1_800_000_000_000;
    const log: string[] = [];
    const change = (what: string) => {
      // The wallet locks, and is unlocked again, while this part of the run reads Koios.
      if (what === changeDuring) unlockedAt += 60_000;
    };
    const ctx = {
      networks: ["mainnet", "preprod"],
      wallet: { state: async () => "unlocked", unlockedAt: async () => unlockedAt },
      sessions: {
        runAll: vi.fn(async (n: NetworkName, unlock: boolean) => {
          log.push(`step ${n} ${unlock}`);
          change(`step ${n}`);
          return false;
        }),
      },
      lovejoin: {
        pumpPublic: async () => false,
        withdrawDue: vi.fn(async (n: NetworkName, unlock: boolean) => {
          log.push(`withdraw ${n} ${unlock}`);
          change(`withdraw ${n}`);
          return [];
        }),
        returning: async () => false,
      },
      pending: { watch: async () => false },
    } as unknown as Runner;
    const alarm = { start: async () => undefined, stop: async () => undefined, starts: () => 0 };
    return { ctx, alarm, log };
  }

  it("carries on as the unlock's run, which sends nothing, from the first network after it", async () => {
    const { ctx, alarm, log } = runner("step mainnet");
    await runNetworks(ctx, alarm);
    expect(log).toEqual(["step mainnet false", "step preprod true", "withdraw mainnet true", "withdraw preprod true"]);
  });

  it("brings back no box on the other network once it has", async () => {
    const { ctx, alarm, log } = runner("withdraw mainnet");
    await runNetworks(ctx, alarm);
    expect(log).toEqual(["step mainnet false", "step preprod false", "withdraw mainnet false", "withdraw preprod true"]);
  });

  it("sends no Lovejoin box in the rest of a run that began before the unlock, and pushes none", SLOW, async () => {
    const { t, lovejoin } = await withBox();
    await busyFor(t, HOUR);
    // A box drawn at an unlock before, and due: the next unlock won't draw it again.
    const due = t.clock.now - 60_000;
    await t.store.set("lovejoin.preprod", { due: [due], marks: { [due]: { unlock: true } } });
    // The run begins; the wallet locks and unlocks while it reads Koios.
    const since = t.clock.now;
    await t.wallet.lock();
    t.clock.now += 20_000;
    await t.wallet.unlock(PASSWORD);
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_UNLOCKED_AT))).toBe(t.clock.now);
    expect(await lovejoin.withdrawDue("preprod", false, since)).toEqual([]);
    expect(t.collateral.asked).toHaveLength(0);
    expect((await schedule(t)).due).toEqual([due]);
  });
});

describe("a swap's step at the unlock (independent review L10, L12)", SLOW, () => {
  const SWAP = swapTx();
  const SWAP_TX = txIdOf(bytes(SWAP));

  async function unlocked() {
    const t = testBalances();
    await t.wallet.create(PHRASE, PASSWORD);
    // One spend: the funding takes the 25 ₳ UTxO alone.
    const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
    t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
    return t;
  }

  /** The session service with giveme.my's witness and the one-time key's signature stood in for. */
  function signing(t: T) {
    const wasm = loadTestWasm();
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    t.minswap.swapCbor = SWAP;
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
      alarm: { start: async () => undefined },
    });
  }

  /** Session 0's funding sent, and landed: Koios confirms it, and the account holds what the recorded swap spends. */
  async function funded(t: T, sessions: SessionService) {
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", minswapEstimate.ask));
    await sessions.outSubmit("preprod", out.txHash);
    t.koios.confirmations = 1;
    t.koios.addedToAccounts.push({
      ...POOL[0]!,
      tx_hash: sessionSwap.utxo.tx_hash,
      tx_index: sessionSwap.utxo.tx_index,
      address: sessionSwap.address,
      value: sessionSwap.utxo.value,
      payment_cred: sessionSwap.keyHash,
      inline_datum: null,
      asset_list: [],
    } as KoiosUtxo);
  }

  const waitsUntil = async (sessions: SessionService) => (await sessions.list("preprod"))[0]!.auto!.waitsUntil;

  it("draws its wait when the unlock's run couldn't read it, rather than send it at the next run", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await funded(t, sessions);
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const sent = t.koios.submitted.length;
    // Koios fails the unlock's reads: its run reads nothing, and draws nothing.
    const undo = failing(t, "tx_status");
    await sessions.runAll("preprod", true);
    undo();
    expect(await waitsUntil(sessions)).toBeUndefined();
    // The next run a minute later finds the order to place: it waits a fresh draw, and Minswap isn't asked to build it.
    await busyFor(t, 60_000);
    await sessions.runAll("preprod");
    expect(t.koios.submitted).toHaveLength(sent);
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("build-tx");
    const until = (await waitsUntil(sessions))!;
    expect(until).toBeGreaterThanOrEqual(t.clock.now + UNLOCK_WAIT_MS[0]);
    // Once it's past, the order goes.
    await busyFor(t, until - t.clock.now);
    await sessions.runAll("preprod");
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(SWAP_TX);
  });

  it("draws its wait when its page asks before the unlock's run reaches it, and the unlock's run keeps it", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await funded(t, sessions);
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const sent = t.koios.submitted.length;
    // The swap's page, opened first, advances it.
    await sessions.advance("preprod", 0);
    expect(t.koios.submitted).toHaveLength(sent);
    const until = (await waitsUntil(sessions))!;
    expect(until).toBeGreaterThanOrEqual(t.clock.now + UNLOCK_WAIT_MS[0]);
    await busyFor(t, 20_000);
    await sessions.runAll("preprod", true);
    await sessions.advance("preprod", 0);
    expect(t.koios.submitted).toHaveLength(sent);
    expect(await waitsUntil(sessions)).toBe(until);
  });

  it("draws its wait when it comes back from a retry after the unlock", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await funded(t, sessions);
    // A read fails just before the wallet locks: the step waits 30 s to try again.
    const undo = failing(t, "tx_status");
    await sessions.advance("preprod", 0);
    undo();
    expect((await sessions.list("preprod"))[0]!.auto!.retry).toBeDefined();
    await t.wallet.lock();
    t.clock.now += 10_000;
    await t.wallet.unlock(PASSWORD);
    const sent = t.koios.submitted.length;
    // The unlock's run finds it waiting its retry, and passes it by.
    await sessions.runAll("preprod", true);
    expect(await waitsUntil(sessions)).toBeUndefined();
    // The retry's run finds the order to place, a minute into the unlock: it waits a fresh draw.
    await busyFor(t, 60_000);
    await sessions.runAll("preprod");
    expect(t.koios.submitted).toHaveLength(sent);
    expect(await waitsUntil(sessions)).toBeGreaterThanOrEqual(t.clock.now + UNLOCK_WAIT_MS[0]);
  });

  it("draws no wait after the user's own ask since the unlock: its next step goes when it comes", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await funded(t, sessions);
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    const sent = t.koios.submitted.length;
    // Before any run gets to it, the user presses Try now: it goes at once, but Minswap can't build the order.
    const minswap = t.minswap.fetch;
    t.minswap.fetch = async (url, init) => (url.includes("build-tx") ? new Response("busy", { status: 503 }) : minswap(url, init));
    await sessions.advance("preprod", 0, true);
    t.minswap.fetch = minswap;
    expect(t.koios.submitted).toHaveLength(sent);
    expect((await sessions.list("preprod"))[0]!.auto!.retry).toBeDefined();
    // Its retry, a minute into the unlock: the user's ask took the unlock's draw, so it goes.
    await busyFor(t, 60_000);
    await sessions.runAll("preprod");
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(SWAP_TX);
    expect(await waitsUntil(sessions)).toBeUndefined();
  });

  it("holds back no swap started since the unlock: that was the user's own doing", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await t.wallet.lock();
    t.clock.now += 3 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await busyFor(t, 60_000);
    await funded(t, sessions);
    await sessions.advance("preprod", 0);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(SWAP_TX);
    expect(await waitsUntil(sessions)).toBeUndefined();
  });
});
