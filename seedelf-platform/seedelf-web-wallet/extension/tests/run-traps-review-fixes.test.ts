// 1.6.0's release review, 314-wasm#0's defence in depth (its fix note 5): a trap leaves the WebAssembly instance broken
// for good, so the worker hands it on to where the wallet locks, as a page's request does (sw.ts answerUi) and a
// session's step does (sessions.ts). Two catches took everything, traps too: the pool read's, which read the pools
// discovery handed over before in place of one that trapped, and the worker's runs', around Lovejoin's boxes due back
// (runs.ts), where nothing locks. So did the catches on that run's own way: Bring every box back now's pool read and
// its withdraws, and a box's own withdraw. The broken instance stayed in use, and the wallet locked later, at some other
// call. With the real WebAssembly, the classic pool's recorded preprod boxes, and fakes of Koios. Round 3b's L3: the
// catches left that took every failure, traps too (watchOf's and mixBoxes' pool reads, Activity's over mixBoxes, the
// Lovejoin page's progress, a withdraw's bookkeeping after its submit, and the collateral's 5 ₳ pool's read, in Lovejoin
// and in a funding's reserve).
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { ActivityService } from "../src/background/activity";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, SESSION_LOVEJOIN_SENDING, type PoolRef } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { pendingKey } from "../src/background/pending";
import { runNetworks, type Runner } from "../src/background/runs";
import { SessionService } from "../src/background/sessions";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import bundled from "../src/lovejoin-pools.json";
import { NETWORKS, type NetworkName } from "../src/networks";
import { publicFunded } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;
const SLOW = { timeout: 120_000 };

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

/** PR #163's token pool on preprod (wasm/tests/fixtures): a pool discovery hands over, which WebAssembly verifies. */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const TOKEN_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

/** A WebAssembly function that calls itself for good, `(module (func $f (export "f") (call $f)))` (wasm-review-fixes.test.ts). */
function overflowing(): () => void {
  const module = new WebAssembly.Module(
    new Uint8Array([
      ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
      ...[0x01, 0x04, 0x01, 0x60, 0x00, 0x00],
      ...[0x03, 0x02, 0x01, 0x00],
      ...[0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00],
      ...[0x0a, 0x06, 0x01, 0x04, 0x00, 0x10, 0x00, 0x0b],
    ]),
  );
  return new WebAssembly.Instance(module).exports.f as () => void;
}

/** The two kinds of trap: one V8 calls one, and a stack that ran out inside WebAssembly, which V8 throws as a RangeError. */
function traps(): Array<[string, Error]> {
  let overflow: Error | undefined;
  try {
    overflowing()();
  } catch (e) {
    overflow = e as Error;
  }
  expect(overflow).toBeInstanceOf(RangeError);
  return [
    ["a trap", new WebAssembly.RuntimeError("unreachable")],
    ["a stack run out inside WebAssembly", overflow!],
  ];
}

type T = ReturnType<typeof testBalances>;

/** A wallet, unlocked an hour ago, with the first run after the unlock done (independent review L10). */
async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const at = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, at));
  return t;
}

/** Lovejoin reading the classic pool and what discovery hands over (`pools`), WebAssembly's calls as `wasm` changes them. */
function lovejoin(t: T, pools: () => Promise<PoolRef[]>, wasm: Partial<ReturnType<typeof loadTestWasm>> = {}): LovejoinService {
  const real = loadTestWasm();
  return new LovejoinService({
    ...t.deps,
    wasm: {
      ...real,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
      ...wasm,
    } as typeof real,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools,
    random: () => 0.5,
  });
}

/** A box of the wallet's in the classic pool, a mix having moved it 5 hours ago (Koios says a mix made it). */
async function classicBox(t: T, tx: string): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: POOL[0]!.address, cred: POOL[0]!.payment_cred! } }]);
  const datum = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    block_time: Math.floor(t.clock.now / 1000) - 5 * 3600,
    inline_datum: { bytes: datum, value: {} },
  } as KoiosUtxo;
}

/** A chain of the wallet's in the classic pool, recorded and sent whole: its leaf is `leaf`, due an hour ago. */
async function dueBox(t: T, lj: LovejoinService, leaf: string): Promise<void> {
  const txs = [
    { kind: "deposit" as const, txCbor: "", txHash: "d0".repeat(32), fee: "0" },
    { kind: "mix" as const, txCbor: "", txHash: "d1".repeat(32), fee: "0" },
  ];
  await lj.recordChain("preprod", { progress: "test.d1", txs, leaves: [{ txHash: leaf.repeat(32), txIndex: 0 }], boxes: 1, account: 0 });
  for (const i of txs.keys()) await lj.chainSent("preprod", txs.at(-1)!.txHash, i);
  await lj.chainEnded("preprod", txs.at(-1)!.txHash);
  // The unlock an hour ago drew its fresh waits already (unlockDraws), as wallet() has it.
  const kept = (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!;
  await t.store.set("lovejoin.preprod", { ...kept, due: [t.clock.now - HOUR], unlock: t.clock.now - HOUR });
}

/** Bring every box back now's sealed record. */
const bringing = async (t: T) =>
  (await t.store.get<{ bringing?: { why?: string; fails?: number; back: number } }>("lovejoin.preprod"))?.bringing;

/** The sessions alarm, counting its starts as sw.ts does. */
function sessionsAlarm() {
  let starts = 0;
  const alarm = {
    on: false,
    start: vi.fn(async () => {
      starts++;
      alarm.on = true;
    }),
    stop: vi.fn(async () => {
      alarm.on = false;
    }),
    starts: () => starts,
  };
  return alarm;
}

describe("a trap under the worker's runs (1.6.0's release review, 314-wasm#0)", () => {
  /** A run's step, by its name in `asked`. */
  type Step = "runAll" | "pumpPublic" | "watch" | "pump" | "withdrawDue" | "returning";
  /** The run's steps in the order it takes them: every network's first four, then every network's boxes due back. */
  const ORDER = [
    ...["mainnet", "preprod"].flatMap((n) => (["runAll", "pumpPublic", "watch", "pump"] as const).map((s) => `${s} ${n}`)),
    ...["mainnet", "preprod"].flatMap((n) => (["withdrawDue", "returning"] as const).map((s) => `${s} ${n}`)),
  ];

  /**
   * A run's services on both networks, each with nothing to do, the wallet's trap handling counted, and each step it
   * asks in `asked`, in order. `trap`: what step `at` throws on mainnet.
   */
  function runner(at?: Step, trap?: Error) {
    const trapped = vi.fn(async () => undefined);
    const asked: string[] = [];
    const step = <T>(name: Step, answer: T) =>
      vi.fn(async (network: NetworkName): Promise<T> => {
        asked.push(`${name} ${network}`);
        if (name === at && network === "mainnet") throw trap;
        return answer;
      });
    const ctx = {
      networks: ["mainnet", "preprod"],
      wallet: { state: async () => "unlocked", unlockedAt: async () => 1_800_000_000_000, trapped },
      sessions: { runAll: step("runAll", true) },
      lovejoin: { pumpPublic: step("pumpPublic", false), withdrawDue: step("withdrawDue", []), returning: step("returning", true) },
      pending: { watch: step("watch", false) },
      parts: { pump: step("pump", false) },
    } as unknown as Runner;
    return { ctx, trapped, asked, alarm: sessionsAlarm() };
  }

  it("locks the wallet, as a page's request does, and runs nothing more on the broken instance, whichever step traps (R3-19)", async () => {
    // The boxes due back and a payment's watch, and the four catches the review of the fixes found untested: a swap's
    // run, a public mix's sending, a payment's parts and the boxes on their way (1.6.0's review of the fixes, R3-19).
    for (const [, trap] of traps()) {
      for (const at of ["runAll", "pumpPublic", "watch", "pump", "withdrawDue", "returning"] as const) {
        const { ctx, trapped, asked, alarm } = runner(at, trap);
        await alarm.start();
        await runNetworks(ctx, alarm);
        expect(trapped, at).toHaveBeenCalledTimes(1);
        // The run ends there: nothing else is asked of the instance, and the alarm stops as it does for a locked wallet.
        expect(asked, at).toEqual(ORDER.slice(0, ORDER.indexOf(`${at} mainnet`) + 1));
        expect(alarm.on, at).toBe(false);
      }
    }
  });

  it("goes on past a refusal, or JavaScript's own stack running out, which leave WebAssembly as it was", async () => {
    const recurse = (n: number): number => recurse(n + 1) + 1;
    let own: unknown;
    try {
      recurse(0);
    } catch (e) {
      own = e;
    }
    expect(own).toBeInstanceOf(RangeError);
    for (const failure of [new Error("The server didn't answer."), own]) {
      const { ctx, trapped, alarm } = runner();
      vi.mocked(ctx.lovejoin.withdrawDue).mockImplementation(async (n) => {
        if (n === "mainnet") throw failure;
        return [];
      });
      await runNetworks(ctx, alarm);
      expect(trapped).not.toHaveBeenCalled();
      expect(vi.mocked(ctx.lovejoin.withdrawDue).mock.calls.map((c) => c[0])).toEqual(["mainnet", "preprod"]);
      expect(alarm.on).toBe(true);
    }
  });
});

describe("a trap in Lovejoin's pool read and withdraws (1.6.0's release review, 314-wasm#0)", SLOW, () => {
  it("hands a trap from discovery on, where discovery failing reads the pools it handed over before", async () => {
    for (const [what, trap] of traps()) {
      const t = await wallet();
      t.koios.addedToAccounts.push(...POOL);
      let calls = 0;
      const lj = lovejoin(t, async () => {
        if (++calls > 1) throw trap;
        return [];
      });
      await lj.status("preprod");
      await expect(lj.status("preprod"), what).rejects.toBe(trap);
    }
    // Discovery failing is no pool gone: the pools it handed over before are read, as ever.
    const t = await wallet();
    t.koios.addedToAccounts.push(...POOL);
    let calls = 0;
    const lj = lovejoin(t, async () => {
      if (++calls > 1) throw new Error("discovery isn't answering");
      return [TOKEN_POOL];
    });
    await lj.status("preprod");
    const reads = () => t.koios.calls.filter((c) => c.path === "credential_utxos").map((c) => (c.body._payment_credentials as string[]).length);
    expect((await lj.status("preprod")).available).toBe(true);
    expect(reads()).toEqual([2, 2]);
  });

  it("hands a trap in Bring every box back now's pool read on, never keeping it as the run's reason", async () => {
    for (const [what, trap] of traps()) {
      const t = await wallet();
      t.koios.addedToAccounts.push(...POOL);
      // A pool discovery hands over whose verification traps.
      const lj = lovejoin(t, async () => [TOKEN_POOL], {
        lovejoinVerifyPool: () => {
          throw trap;
        },
      });
      await lj.bringAllBack("preprod");
      await expect(lj.withdrawDue("preprod"), what).rejects.toBe(trap);
      expect(await bringing(t)).toEqual({ at: expect.any(Number), back: 0 });
    }
  });

  it("hands a trap in a box's withdraw on, in its own run and in Bring every box back now's", async () => {
    for (const [what, trap] of traps()) {
      for (const bring of [false, true]) {
        const t = await wallet();
        const box = await classicBox(t, "c1");
        t.koios.addedToAccounts.push(...POOL, box);
        const lj = lovejoin(t, async () => [], {
          finishLovejoinWithdraw: () => {
            throw trap;
          },
        });
        await dueBox(t, lj, "c1");
        if (bring) await lj.bringAllBack("preprod");
        await expect(lj.withdrawDue("preprod"), `${what}, ${bring ? "brought back" : "its own run"}`).rejects.toBe(trap);
        expect(t.koios.submitted).toHaveLength(0);
        if (bring) expect(await bringing(t)).toMatchObject({ back: 0 });
        if (bring) expect((await bringing(t))?.why).toBeUndefined();
      }
    }
  });

  it("locks the wallet when a pool read traps in the unlock's run, as it would under a page's request", async () => {
    for (const [what, trap] of traps()) {
      const t = await wallet();
      t.koios.addedToAccounts.push(...POOL);
      // Discovery hands a trap on (lovejoin-pools.ts serviceDeps), as a hostile launch's datum made it before the
      // Rust half of the fix.
      const lj = lovejoin(t, async () => {
        throw trap;
      });
      // Something open in Lovejoin: the unlock's run reads the pools.
      await lj.schedule("preprod", 1);
      const ctx = {
        networks: ["preprod"],
        wallet: t.wallet,
        sessions: { runAll: async () => false },
        lovejoin: lj,
        pending: { watch: async () => false },
      } as unknown as Runner;
      const alarm = sessionsAlarm();
      await runNetworks(ctx, alarm, true);
      expect(await t.wallet.state(), what).toBe("locked");
      expect(t.wallet.lockReason()).toBe("trap");
      expect(alarm.on).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Round 3b, L3: the catches left that took every failure, traps too. Each hands a trap on now, as runs.ts' unlessTrap
// does, and keeps its meaning for every other failure. A withdraw's bookkeeping after its submit runs first.

/** PR #163's token pool's id, as WebAssembly verifies it. */
const TOKEN = (JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: TOKEN_POOL }))) as { id: string }).id;

/** Preprod's 5 ₳ pool, as the wallet bundles it: the one a session's collateral goes into. */
const FIVE = (bundled.preprod.pools.find((p) => p.boxLovelace === "5000000")! as unknown as { ref: PoolRef }).ref;

/** WebAssembly's check of the pools discovery hands over, failing with `failure` on PR #163's token pool alone. */
function onToken(failure: unknown): Partial<ReturnType<typeof loadTestWasm>> {
  const real = loadTestWasm();
  return {
    lovejoinVerifyPool: (request: string) => {
      if ((JSON.parse(request) as { pool: PoolRef }).pool.seed.txHash === TOKEN_POOL.seed.txHash) throw failure;
      return real.lovejoinVerifyPool(request);
    },
  };
}

/** Lovejoin's pool read itself, failing with `failure`: what each catch around it is for. */
function readFails(lj: LovejoinService, failure: unknown): void {
  vi.spyOn(lj as unknown as { readSet: () => Promise<unknown> }, "readSet").mockRejectedValue(failure);
}

const D0 = "d0".repeat(32);
const D1 = "d1".repeat(32);

/**
 * A mix from the public account into the token pool, deposit d0 and mix d1, recorded; `maybe`: stopped at its deposit,
 * which may have gone through, as a send Koios didn't answer leaves it (pumpPublic).
 */
async function tokenMix(t: T, lj: LovejoinService, maybe = false): Promise<void> {
  const txs = [
    { kind: "deposit" as const, txCbor: "", txHash: D0, fee: "0" },
    { kind: "mix" as const, txCbor: "", txHash: D1, fee: "0" },
  ];
  await lj.recordChain("preprod", { progress: "test.d1", txs, leaves: [{ txHash: D1, txIndex: 0, pool: TOKEN }], boxes: 1, pools: { [TOKEN]: 1 }, account: 0 });
  if (maybe) await lj.chainEnded("preprod", D1, "Koios didn't answer.", { index: 0, txHash: D0, inputs: [], at: t.clock.now });
}

describe("a trap under a catch that takes any failure (1.6.0's release review, L3)", SLOW, () => {
  it("hands a trap in the read of a chain's pools for its watch on, a read that fails still naming each by its id", async () => {
    for (const [what, trap] of traps()) {
      const t = await wallet();
      const lj = lovejoin(t, async () => [TOKEN_POOL], onToken(trap));
      await tokenMix(t, lj);
      await expect(lj.watchOf("preprod", [D1]), what).rejects.toBe(trap);
    }
    const t = await wallet();
    const lj = lovejoin(t, async () => [TOKEN_POOL]);
    await tokenMix(t, lj);
    readFails(lj, new Error("The record won't open."));
    expect((await lj.watchOf("preprod", [D1])).get(D1)).toEqual({ feed: "tokens", pools: [TOKEN] });
  });

  it("hands a trap in the read of the pools' mix boxes for Activity on, as Activity does, a read that fails still naming the classic pool's", async () => {
    for (const [what, trap] of traps()) {
      const t = await wallet();
      await expect(lovejoin(t, async () => [TOKEN_POOL], onToken(trap)).mixBoxes("preprod"), what).rejects.toBe(trap);
      // Activity's list of the public account's transactions, over the same read.
      await t.balances.get("preprod");
      const activity = new ActivityService({
        wasm: loadTestWasm(),
        wallet: t.wallet,
        session: t.session,
        store: t.store,
        koios: t.deps.koios,
        local: t.local,
        now: () => t.clock.now,
        mixBoxes: async () => {
          throw trap;
        },
      });
      await expect(activity.cardano("preprod"), what).rejects.toBe(trap);
    }
    const t = await wallet();
    const lj = lovejoin(t, async () => [TOKEN_POOL]);
    readFails(lj, new Error("The record won't open."));
    expect(await lj.mixBoxes("preprod")).toEqual([NETWORKS.preprod.lovejoin!.mixBox]);
    await t.balances.get("preprod");
    const activity = new ActivityService({
      wasm: loadTestWasm(),
      wallet: t.wallet,
      session: t.session,
      store: t.store,
      koios: t.deps.koios,
      local: t.local,
      now: () => t.clock.now,
      mixBoxes: async () => {
        throw new Error("The record won't open.");
      },
    });
    expect((await activity.cardano("preprod")).entries.length).toBeGreaterThan(0);
  });

  it("hands a trap on from the Lovejoin page's progress: sending more of a mix, or looking for a transaction that may have gone through", async () => {
    for (const [what, trap] of traps()) {
      // Sending more of the public account's mix.
      const sending = await wallet();
      const pumped = lovejoin(sending, async () => []);
      vi.spyOn(pumped, "pumpPublic").mockRejectedValue(trap);
      await expect(pumped.progress("preprod", true), `${what}, sending`).rejects.toBe(trap);
      // Looking for where its deposit stands, on its pool's feed (watchOf), with its progress gone, then kept.
      for (const kept of [false, true]) {
        const t = await wallet();
        const lj = lovejoin(t, async () => [TOKEN_POOL], onToken(trap));
        await tokenMix(t, lj, true);
        if (kept) {
          await t.wallet.withKeys(() =>
            t.session.set(SESSION_LOVEJOIN_SENDING + "preprod", {
              network: "preprod",
              boxes: 1,
              txs: [{ txHash: D0 }, { txHash: D1 }],
              next: 0,
              flying: [],
              stopped: "Koios didn't answer.",
              maybe: 0,
            }),
          );
        }
        await expect(lj.progress("preprod"), `${what}, ${kept ? "its progress kept" : "its progress gone"}`).rejects.toBe(trap);
      }
    }
    // Sending that fails otherwise is said where the mix stopped, as ever: the page's progress reads on.
    const t = await wallet();
    const lj = lovejoin(t, async () => []);
    vi.spyOn(lj, "pumpPublic").mockRejectedValue(new Error("The server didn't answer."));
    expect(await lj.progress("preprod", true)).toBeNull();
  });

  it("keeps Home's watch of a mix from the public account it sent before it hands on a trap in the read of its feed", async () => {
    for (const [what, trap] of traps()) {
      const t = await publicFunded();
      const mix = await t.lovejoin.publicBuild("preprod", 1);
      vi.spyOn(t.lovejoin, "watchOf").mockRejectedValue(trap);
      await expect(t.lovejoin.publicSubmit("preprod", mix.txHash), what).rejects.toBe(trap);
      expect(t.koios.submitted.length, what).toBeGreaterThan(0);
      // Home's banner watches it all the same, on the classic pool's feed, where this mix is.
      const watched = await t.wallet.withKeys(() => t.session.get<{ txHash: string; kind: string }>(pendingKey("preprod")));
      expect(watched, what).toMatchObject({ txHash: mix.txHash, kind: "lovejoin-mix" });
    }
  });

  it("keeps a withdraw sent as sent, its box counted back, before it hands on a trap in what comes after its submit", async () => {
    for (const [what, trap] of traps()) {
      const t = await wallet();
      const box = await classicBox(t, "c1");
      t.koios.addedToAccounts.push(...POOL, box);
      const lj = lovejoin(t, async () => []);
      await dueBox(t, lj, "c1");
      // Its history's entry, written after its submit.
      t.activity.sent = async () => {
        throw trap;
      };
      await expect(lj.withdrawDue("preprod"), what).rejects.toBe(trap);
      expect(t.koios.submitted, what).toHaveLength(1);
      // Gone from what's looked for, and its box counted back against its mix: the list of mixes has nothing open.
      const sealed = (await t.store.get<{ withdrawing?: unknown; mixes?: unknown[] }>("lovejoin.preprod"))!;
      expect(sealed.withdrawing, what).toBeUndefined();
      expect(sealed.mixes, what).toEqual([]);
    }
  });

  it("hands a trap in the read of the 5 ₳ pool's boxes on, a read that fails still leaving the collateral out", async () => {
    const params = async (t: T) => (await t.deps.koios().epochParams()) as unknown;
    for (const [what, trap] of traps()) {
      const t = await wallet();
      // The pool read the collateral's pool is looked for in, then the one its boxes are read in, which a pool discovery
      // has found since is in.
      let reads = 0;
      const lj = lovejoin(t, async () => (++reads > 1 ? [FIVE, TOKEN_POOL] : [FIVE]), onToken(trap));
      await expect(lj.collateralPool("preprod", await params(t)), what).rejects.toBe(trap);
    }
    const t = await wallet();
    const lj = lovejoin(t, async () => [FIVE]);
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (String(url).includes("/credential_utxos") ? new Response("down", { status: 500 }) : real(url, init));
    expect(await lj.collateralPool("preprod", await params(t))).toBeUndefined();
  });

  it("hands a trap in a funding's look for the 5 ₳ pool on, the funding going on without its reserve where that look fails otherwise", async () => {
    const funded = async (failure: unknown) => {
      const t = testBalances({ owned: false });
      await t.wallet.create(PHRASE, PASSWORD);
      t.koios.evaluation = AGREES;
      t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: "40000000" } as KoiosUtxo);
      const lj = lovejoin(t, async () => [FIVE]);
      vi.spyOn(lj, "collateralPool").mockRejectedValue(failure);
      const sessions = new SessionService({
        ...t.deps,
        collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
        store: t.store,
        minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
        lovejoin: lj,
        sleep: async () => undefined,
        alarm: { start: async () => undefined },
      });
      return sessions.siteOutBuild("preprod", "https://example.org", "10000000", []);
    };
    for (const [what, trap] of traps()) await expect(funded(trap), what).rejects.toBe(trap);
    expect((await funded(new Error("The server didn't answer."))).collateralReserve).toBeUndefined();
  });
});
