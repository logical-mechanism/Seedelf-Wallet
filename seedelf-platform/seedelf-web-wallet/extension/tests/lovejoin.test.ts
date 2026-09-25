// Lovejoin in the worker (lovejoin.ts, and sessions.ts's return through it),
// with the real WebAssembly module, a recorded preprod pool, and fake Koios
// and giveme.my. Every chain is measured against the deployed scripts inside
// WebAssembly, as it is in the wallet.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LOVEJOIN_MIX_BOX, LovejoinService } from "../src/background/lovejoin";
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

describe("a session's return through Lovejoin", () => {
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
    const chain = t.koios.submitted.slice(submittedBefore);
    expect(chain).toHaveLength(10);
    expect(txIdOf(chain.at(-1)!)).toBe(review.txHash);

    // The session's record knows every one, in order: the deposit, the mixes, the return.
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ kind: string; txHash: string }> }> }>("sessions.preprod"))!;
    const kinds = book.sessions[0]!.txs.slice(1).map((x) => x.kind);
    expect(kinds).toEqual(["deposit", ...Array(8).fill("mix"), "back"]);
    expect(book.sessions[0]!.txs.slice(1).map((x) => x.txHash)).toEqual(chain.map((bytes) => txIdOf(bytes)));

    // Each box comes back on its own, 1 to 6 hours from now.
    const schedule = (await t.store.get<{ due: number[] }>("lovejoin.preprod"))!;
    expect(schedule.due).toHaveLength(2);
    for (const due of schedule.due) {
      expect(due).toBeGreaterThanOrEqual(t.clock.now + HOUR);
      expect(due).toBeLessThanOrEqual(t.clock.now + 6 * HOUR);
    }
    // Home shows them from the schedule, without asking Koios.
    const calls = t.koios.calls.length;
    expect(await t.lovejoin.held("preprod")).toEqual({ boxes: 2, lovelace: "20000000", next: Math.min(...schedule.due) });
    expect(t.koios.calls.length).toBe(calls);
    expect(await t.lovejoin.held("mainnet")).toEqual({ boxes: 0, lovelace: "0", next: null });
  });

  it("sends a transaction of the chain again when Koios didn't answer it, and finishes the chain", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    // The third submit (a mix) gets a 503 once, as a busy Koios answers.
    const fetch = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx") && ++submits === 3) return new Response("", { status: 503 });
      return fetch(url, init);
    };
    const before = t.koios.submitted.length;
    await sessions.backSubmit("preprod", review.txHash);
    expect(t.koios.submitted.slice(before)).toHaveLength(10);
    expect(txIdOf(t.koios.submitted.at(-1)!)).toBe(review.txHash);
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

describe("the network's check", () => {
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
});

describe("the boxes' withdraws", () => {
  /** A box of ours in the pool: a fresh re-randomization of the Seedelf key's register. */
  async function ownedBox(t: Awaited<ReturnType<typeof withSession>>["t"], tx: string): Promise<KoiosUtxo> {
    const wasm = loadTestWasm();
    const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
    return { ...POOL[0]!, tx_hash: tx.repeat(32), tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
  }

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

describe("mixing from the tile", () => {
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
    const pending = await t.lovejoin.publicSubmit("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "lovejoin-mix", txHash: summary.txHash });
    const sent = t.koios.submitted.slice(before);
    expect(sent).toHaveLength(5);
    expect(txIdOf(sent.at(-1)!)).toBe(summary.txHash);
    expect((await t.store.get<{ due: number[] }>("lovejoin.preprod"))!.due).toHaveLength(1);
    // Sent once.
    await expect(t.lovejoin.publicSubmit("preprod", summary.txHash)).rejects.toThrow("isn't ready to send");
  });
});
