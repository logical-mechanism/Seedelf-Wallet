// Chunk 51, time#2: the escape hatch asked again in a loop, with no word why. In a token pool whose boxes can't pay
// their own way back, the wallet on account 0 has two boxes there: a1, account 1's mixed leaf, known from its chain's
// record, and U, account 0's own leaf that someone else's mix moved 20 minutes ago, which no record names. The wallet
// has a due time for each, so the page's pool read asks Koios nothing about U, and Bring one back's question names
// nobody: U ties no account (hatchAccountOf). The worker asked Koios only about the boxes backOrder puts ahead of the
// first known one, but U had waited less than the delay's least, so backOrder put it last and nobody asked about it.
// Its pick (hatchOrder: the account on screen's own, and those no public account put in, before another account's)
// then had only a1, which the question didn't name, so it asked again, nothing sent. The page read again, the same
// question came back, and it went on so until U had waited the delay's least: an hour at Settings' default.
//
// The fix: paid for, the boxes it asks Koios about are those ahead of the first known one in hatchOrder's order, the
// order its pick takes. U is asked about at the first press and comes back. Where Koios says a deposit made it, the
// worker asks again once, and the page's fresh read names the account whose box it takes. With the real WebAssembly
// and PR #163's preprod token pool's v2 twin, as escape-hatch-reserved.test.ts has them (the trace verifier's scene).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { AskAgainError, LovejoinService, type PoolRef } from "../src/background/lovejoin";
import type { LovejoinPoolStatus } from "../src/shared/rpc";
import { hatchAccountOf, hatchRequest } from "../src/ui/screens/Lovejoin";
import { bech32, preprodAddress } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Real withdraws, built and measured in WebAssembly. */
const SLOW = { timeout: 300_000 };

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

/** PR #163's token pool's launch with its scripts derived on v2, never on chain (chunk 44, wasm/tests/fixtures). */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const TOKEN_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };
const VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: TOKEN_POOL }))) as {
  id: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN = VIEW.id;
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

const HOUR_S = 3600;

type T = ReturnType<typeof testBalances>;

const at = (tx: string, i: number) => ({ txHash: tx, txIndex: i, pool: TOKEN });
const key = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;

/** giveme.my's witness and the one-time key's signature stood in for: the transaction as built, its id its own. */
const signed = (request: string) => {
  const { txCbor } = JSON.parse(request) as { txCbor: string };
  return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
};

/** Lovejoin reading the classic pool and the token pool, giveme.my's witness stood in for. */
function pooled(t: T): LovejoinService {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
    ...t.deps,
    wasm: { ...wasm, finishLovejoinWithdraw: signed, signScriptSpend: (_key: unknown, request: string) => signed(request) } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [TOKEN_POOL],
    random: () => 0.5,
  });
}

/** A register datum: the wallet's, or a stranger's. */
async function datum(t: T, ours: boolean): Promise<string> {
  const wasm = loadTestWasm();
  if (ours) return t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const hex = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return hex;
}

/** A box in the token pool, the wallet's or a stranger's, made `seconds` ago by a mix there, as Koios would say. */
async function tokenBox(t: T, tx: string, ours: boolean, seconds: number): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - seconds,
    datum_hash: null,
    inline_datum: { bytes: await datum(t, ours), value: {} },
    asset_list: [{ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: VIEW.token.quantity, decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** Twelve strangers' boxes in the token pool, five hours old: enough for one box two waves deep. */
const strangers = (t: T) => Promise.all(Array.from({ length: 12 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false, 5 * HOUR_S)));

/** One of the recorded account's (account 0's) UTxOs, made again as `tx`'s with `value` and no token. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] } as KoiosUtxo;
}

/** A Seedelf UTxO of ADA alone at the contract, the wallet's: `value` lovelace. */
async function privateUtxo(t: T, tx: string, value: string): Promise<KoiosUtxo> {
  return { ...ownedUtxos[0]!, tx_hash: tx.repeat(32), tx_index: 0, value, inline_datum: { bytes: await datum(t, true), value: {} }, asset_list: [] } as KoiosUtxo;
}

/** A mix from public account `account` into the token pool, recorded and all sent: deposit, then `mixes`, its box at the last's output. */
async function publicMix(lj: LovejoinService, account: number, deposit: string, mixes: string[]): Promise<void> {
  const txs = [
    { kind: "deposit" as const, txCbor: "", txHash: deposit, fee: "0" },
    ...mixes.map((txHash) => ({ kind: "mix" as const, txCbor: "", txHash, fee: "0" })),
  ];
  const id = txs.at(-1)!.txHash;
  await lj.recordChain("preprod", { progress: `test.${id.slice(0, 4)}`, txs, leaves: [at(id, 0)], boxes: 1, pools: { [TOKEN]: 1 }, account });
  for (let i = 0; i < txs.length; i++) await lj.chainSent("preprod", id, i);
  await lj.chainEnded("preprod", id);
}

/**
 * The scene, on account 0, in a token pool whose boxes can't pay their own way back: account 1's mix left its box a1
 * there 9 hours ago; account 0's left c1, which someone else's mix moved into U 20 minutes ago (`made`: or a stranger's
 * deposit made U, under the wallet's key). Account 0 holds a 5 ₳ collateral and 60 ₳ of ADA alone; the private
 * balance, 50 ₳.
 */
async function scene(made: "mix" | "deposit" = "mix") {
  const t = testBalances({ owned: false });
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  t.koios.tip = 110_000_000;
  // The token pool's boxes can't pay their own way back (lovejoin-crediting-review-fixes.test.ts's stuckPool).
  t.koios.params = { coins_per_utxo_size: "4800" };
  const [a0, a1, c0, c1] = ["a0", "a1", "c0", "c1"].map((x) => x.repeat(32)) as [string, string, string, string];
  const u = await tokenBox(t, "b7", true, 20 * 60);
  const U = u.tx_hash;
  if (made === "deposit") t.koios.txSpends.set(U, [{ payment_addr: { bech32: preprodAddress("ee".repeat(28)), cred: "ee".repeat(28) } }]);
  t.koios.addedToAccounts.push(
    atAccount("e5", "5000000"),
    atAccount("e6", "60000000"),
    ...POOL,
    await tokenBox(t, "a1", true, 9 * HOUR_S),
    u,
    ...(await strangers(t)),
  );
  t.koios.added.push(await privateUtxo(t, "d1", "50000000"));
  const lj = pooled(t);
  await publicMix(lj, 1, a0, [a1]);
  await publicMix(lj, 0, c0, [c1]);
  const page = async (): Promise<LovejoinPoolStatus> => (await lj.status("preprod")).pools!.find((p) => p.id === TOKEN)!;
  /** How often Koios was asked what made U. */
  const askedOfU = () => t.koios.calls.filter((c) => c.path === "tx_info" && JSON.stringify(c.body ?? {}).includes(U)).length;
  return { t, lj, page, a1, U, askedOfU };
}

/**
 * Bring one back, as the pool's page presses it (Lovejoin.tsx `paid`): the escape hatch's request from the page's read
 * (hatchRequest); asked again, the pool read again and the same question asked, up to three presses.
 */
async function press(s: Awaited<ReturnType<typeof scene>>, paid: true | "private", first: LovejoinPoolStatus) {
  const rounds: Array<{ named?: number; outcome: "sent" | "askAgain" }> = [];
  let pool = first;
  for (let i = 0; i < 3; i++) {
    const request = hatchRequest(pool, paid);
    try {
      await s.lj.withdrawNow("preprod", undefined, false, request.paid, request.pool, request.account);
      rounds.push({ ...(request.account !== undefined ? { named: request.account } : {}), outcome: "sent" });
      break;
    } catch (e) {
      if (!(e instanceof AskAgainError)) throw e;
      rounds.push({ ...(request.account !== undefined ? { named: request.account } : {}), outcome: "askAgain" });
      pool = await s.page();
    }
  }
  return rounds;
}

describe("the escape hatch where the account on screen's box is one someone else's mix moved minutes ago (chunk 51, time#2)", SLOW, () => {
  for (const paid of [true, "private"] as const) {
    const payer = paid === true ? "the public account" : "the private balance";
    it(`asks Koios about it at the first press and brings it back, paid from ${payer}`, async () => {
      const s = await scene();
      const first = await s.page();
      // The page's read: the pool is stuck, U is listed, a1 is account 1's, nothing is held, and each box has its due
      // time, so the read asked Koios nothing about U, and the question names nobody.
      expect(first.cantComeBack).toBeDefined();
      expect(first.boxes.map(key).sort()).toEqual([`${s.U}#0`, `${s.a1}#0`].sort());
      expect(first.otherAccounts).toEqual([{ ...at(s.a1, 0), account: 1 }]);
      expect([...first.notMixed, ...(first.unsure ?? []), ...(first.reserved ?? []), ...(first.bootstrap ?? [])]).toEqual([]);
      expect(first.due).toHaveLength(2);
      expect(s.askedOfU()).toBe(0);
      expect(hatchAccountOf(first)).toBeUndefined();

      const submitted = s.t.koios.submitted.length;
      const rounds = await press(s, paid, first);
      // One press: Koios is asked about U once, and U comes back, as the question said (no other account's box).
      expect(rounds).toEqual([{ outcome: "sent" }]);
      expect(s.t.koios.submitted.length).toBe(submitted + 1);
      expect(s.askedOfU()).toBe(1);
      const spent = txInputs(s.t.koios.submitted.at(-1)!);
      expect(spent).toContain(`${s.U}#0`);
      expect(spent).not.toContain(`${s.a1}#0`);
    });
  }

  it("asks again once where Koios says a deposit made it, the page's fresh read naming the account whose box it takes", async () => {
    const s = await scene("deposit");
    const first = await s.page();
    expect(hatchAccountOf(first)).toBeUndefined();
    const rounds = await press(s, true, first);
    // The first press asks about U: a stranger's deposit made it, never taken here. a1 is account 1's, which the
    // question didn't name: asked again, nothing sent. The fresh read holds U as not mixed yet, so the question names
    // account 1, and the second press brings a1 back, paid from account 0, as it said.
    expect(rounds).toEqual([{ outcome: "askAgain" }, { named: 1, outcome: "sent" }]);
    expect(s.askedOfU()).toBe(1);
    const spent = txInputs(s.t.koios.submitted.at(-1)!);
    expect(spent).toContain(`${s.a1}#0`);
    expect(spent).not.toContain(`${s.U}#0`);
  });

  it("once U has waited the delay's least, takes it, never a1, as it did before (the loop's bound)", async () => {
    const s = await scene();
    // Settings' default delay, 1-6: its least is an hour, 40 minutes on from U's move.
    s.t.clock.now += 41 * 60_000;
    await s.t.wallet.unlock(PASSWORD);
    const again = hatchRequest(await s.page(), true);
    expect(again.account).toBeUndefined();
    await s.lj.withdrawNow("preprod", undefined, false, again.paid, again.pool, again.account);
    const spent = txInputs(s.t.koios.submitted.at(-1)!);
    expect(spent).toContain(`${s.U}#0`);
    expect(spent).not.toContain(`${s.a1}#0`);
  });
});
