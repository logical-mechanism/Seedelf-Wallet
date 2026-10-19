// 1.6.0's release review, the rules of Lovejoin's token pools and Bootstrap where the steps met: a pool that takes no
// new box is refused it from every flow and said so on its page (MONEY-3 = UI-1); Home shows a Bootstrap's held boxes
// apart (MONEY-4 = UI-2 = STATE-3, D2); a box back that ties a public account to the private balance is recorded so
// (PRIV-3); both of a Bootstrap's ways back ask first, and say who pays (PRIV-5); a Bootstrap whose deposit never
// landed lets go of the boxes it held in its place (STATE-5); Bring one back now on a pool whose boxes a Bootstrap
// holds says so (UI-5); and the Bootstrap form's bounds are the worker's (MONEY-6 = UI-10). With the real WebAssembly,
// the classic pool's recorded preprod boxes, and PR #163's preprod token pool (2 ₳ and LJTEST a box).
import { readFileSync } from "node:fs";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { t as tr } from "../src/i18n";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { LovejoinHeld } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { InLovejoin, inLovejoinShown } from "../src/ui/screens/Home";
import { bootstrapLimits, HeldQuestion } from "../src/ui/screens/Lovejoin";
import { txIdOf } from "./fixtures/cbor";
import { bech32 } from "./fixtures/bech32";
import { koiosPreprod, loadTestWasm, madeByMix, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Real chains are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 120_000 };

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

/** PR #163's token pool on preprod, as Koios lists it (wasm/tests/fixtures). */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
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
const Q = BigInt(VIEW.token.quantity);
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

/** A price of a byte three times preprod's: a 2 ₳ LJTEST box is less than the network asks of one, and can't come back. */
const DEAR = { coins_per_utxo_size: "12930" };

type T = ReturnType<typeof testBalances>;

/** Lovejoin reading the classic pool and the token pool (none: the classic pool alone), giveme.my's witness stood in for. */
function pooled(t: T, pools: PoolRef[] = [TOKEN_POOL]): LovejoinService {
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
    pools: async () => pools,
    random: () => 0.5,
  });
}

/** The runner for mixes from the private balance, giveme.my and the one-time key's signatures stood in for. */
function runner(t: T, lj: LovejoinService): SessionService {
  const wasm = loadTestWasm();
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
    lovejoin: lj,
    sleep: async () => undefined,
  });
}

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  t.koios.tip = 110_000_000;
  return t;
}

/** One of the recorded account's UTxOs, made again as `tx`'s with `value` and `assets`. */
function atAccount(tx: string, value: string, assets: Array<{ policy_id: string; asset_name: string; quantity: string }> = []): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1test" })) as never };
}

const ljtest = (quantity: bigint) => ({ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: quantity.toString() });

/** A register datum: the wallet's, or a stranger's. */
async function datum(t: T, ours: boolean): Promise<string> {
  const wasm = loadTestWasm();
  if (ours) return t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/** A box in the token pool, the wallet's or a stranger's, a mix having moved it `hours` ago. */
async function tokenBox(t: T, tx: string, ours = true, hours = 5, index = 0): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: index,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: await datum(t, ours), value: {} },
    asset_list: [{ ...ljtest(Q), decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** Twelve strangers' boxes in the token pool: enough for one box two waves deep. */
const strangers = (t: T) => Promise.all(Array.from({ length: 12 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));

type Sealed = {
  due: number[];
  pools?: Record<string, { due: number[] }>;
  chains: Array<{ id: string; bootstrap?: true }>;
  mixes?: Array<{ id: string; bootstrap?: true; shares: Array<{ pool?: string; boxes: number; back?: number }> }>;
};
const sealed = async (t: T) => (await t.store.get<Sealed>("lovejoin.preprod"))!;

/** The private history's entry for `txHash`. */
const historyOf = async (t: T, txHash: string) =>
  (await t.store.get<{ entries: Array<{ txHash: string; origin?: { id: string; origin: string } }> }>("history.preprod"))!.entries.find(
    (e) => e.txHash === txHash,
  );

/** The wallet unlocked an hour ago, that unlock's draws made: a run then reads the pool as the alarm's does. */
async function unlockedAnHourAgo(t: T): Promise<void> {
  const at = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, at));
  const kept = await t.store.get<object>("lovejoin.preprod");
  if (kept) await t.store.set("lovejoin.preprod", { ...kept, unlock: at });
}

/** A Bootstrap from the public account recorded and all sent: `boxes` in pool `pool` (none: the classic pool) at `deposit`. */
async function bootstrapped(lj: LovejoinService, deposit: string, boxes: number, pool?: string): Promise<void> {
  const leaves = Array.from({ length: boxes }, (_, i) => ({ txHash: deposit, txIndex: i, ...(pool ? { pool } : {}) }));
  await lj.recordChain("preprod", {
    progress: `test.${deposit.slice(0, 4)}`,
    txs: [{ kind: "deposit", txCbor: "", txHash: deposit, fee: "0" }],
    leaves,
    boxes,
    ...(pool ? { pools: { [pool]: boxes } } : {}),
    bootstrap: true,
    account: 0,
  });
  await lj.chainSent("preprod", deposit, 0);
  await lj.chainEnded("preprod", deposit);
}

describe("a token pool that takes no new box (1.6.0's release review, MONEY-3)", SLOW, () => {
  it("is refused every new box, from either side, in words, before anything is built or giveme.my asked", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(
      atAccount("e1", "40000000", [ljtest(3n * Q)]),
      atAccount("e2", "30000000"),
      atAccount("e5", "5000000"),
      ...POOL,
      ...(await strangers(t)),
    );
    // Under preprod's parameters the pool takes a box: the checks before a mix pass.
    const fine = pooled(t);
    await fine.fits("preprod", 1, TOKEN);
    expect((await fine.status("preprod")).pools![0]!.unusable).toBeUndefined();

    // A byte costs three times as much: a 2 ₳ box is less than the network asks of one.
    t.koios.params = DEAR;
    const lj = pooled(t);
    const sessions = runner(t, lj);
    const words = tr("lj.unusable.warn.belowMinimum");
    await expect(lj.fits("preprod", 1, TOKEN)).rejects.toThrow(words);
    await expect(sessions.mixOutBuild("preprod", 1, { pool: TOKEN })).rejects.toThrow(words);
    await expect(sessions.mixOutBuild("preprod", 3, { pool: TOKEN, bootstrap: true })).rejects.toThrow(words);
    await expect(lj.publicBuild("preprod", 1, { pool: TOKEN })).rejects.toThrow(words);
    await expect(lj.publicBuild("preprod", 3, { pool: TOKEN, bootstrap: true })).rejects.toThrow(words);
    await expect(lj.againBoxes("preprod", false, TOKEN)).rejects.toThrow(words);
    await expect(lj.publicAgainBuild("preprod", TOKEN)).rejects.toThrow(words);
    expect(t.koios.submitted).toHaveLength(0);
    expect(t.collateral.asked).toHaveLength(0);
    // The classic pool takes one as it always did.
    await expect(lj.publicBuild("preprod", 1, { bootstrap: true })).resolves.toMatchObject({ bootstrap: true, boxes: 1 });
  });

  it("says why on the pool's status, whether or not the wallet has boxes there, and asks the classic pool's readers nothing more", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(...POOL, ...(await strangers(t)));
    t.koios.params = DEAR;
    const status = await pooled(t).status("preprod");
    expect(status.pools![0]!.boxes).toEqual([]);
    expect(status.pools![0]!.unusable).toEqual({ why: "belowMinimum" });
    // A wallet that reads the classic pool alone reads no parameters for it, as 1.5.0's didn't.
    const classic = await wallet();
    classic.koios.addedToAccounts.push(...POOL);
    await pooled(classic, []).status("preprod");
    expect(classic.koios.calls.filter((c) => c.path === "epoch_params")).toEqual([]);
  });
});

describe("Home and a Bootstrap's held boxes (1.6.0's release review, MONEY-4 = UI-2 = STATE-3)", SLOW, () => {
  it("held() counts each pool's boxes its open Bootstraps hold, from the record alone, until they're let go", async () => {
    const t = await wallet();
    const lj = pooled(t);
    await bootstrapped(lj, "b0".repeat(32), 3);
    await bootstrapped(lj, "b1".repeat(32), 2, TOKEN);
    const before = t.koios.calls.length;
    const held = await lj.held("preprod");
    expect(held).toMatchObject({ boxes: 0, notMixed: 0, bootstrap: 3 });
    expect(held.pools).toEqual([
      expect.objectContaining({ id: TOKEN, boxes: 0, notMixed: 0, bootstrap: 2, box: { lovelace: "2000000", token: VIEW.token } }),
    ]);
    // Nothing read for it: the pool's box is the read set's.
    expect(t.koios.calls.slice(before).filter((c) => c.path === "credential_utxos")).toEqual([]);
    // Bring them all back: they come back by themselves from then on, and aren't held.
    await lj.releaseBootstrap("preprod", TOKEN);
    const after = await lj.held("preprod");
    expect(after.bootstrap).toBe(3);
    expect(after.pools ?? []).toEqual([]);
  });
});

/** A page's text, as a person reads it. */
function text(element: ReactElement, hidden = false): string {
  const prefs = { prefs: { ...DEFAULT_PREFERENCES, hideBalances: hidden }, loaded: true, set: async () => undefined };
  return renderToStaticMarkup(
    createElement(NetworkContext.Provider, { value: "preprod" }, createElement(PreferencesContext.Provider, { value: prefs }, element)),
  )
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** MIN, on preprod's token list, 100 a box. */
const MIN_100 = { lovelace: "4500000", token: { policyId: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72", assetName: "4d494e", quantity: "100000000" } };
const A = "a1".repeat(28);

describe("Home's In Lovejoin shows a Bootstrap's boxes apart (D2; MONEY-4)", () => {
  const empty: LovejoinHeld = { boxes: 0, lovelace: "0", next: null, notMixed: 0, stopped: 0 };
  const held: LovejoinHeld = { ...empty, bootstrap: 30, pools: [{ id: A, boxes: 0, lovelace: "0", next: null, notMixed: 0, bootstrap: 2, box: MIN_100 }] };

  it("is shown for held boxes alone", () => {
    expect(inLovejoinShown({ ...empty, bootstrap: 3 })).toBe(true);
    expect(inLovejoinShown({ ...empty, pools: [{ id: A, boxes: 0, lovelace: "0", next: null, notMixed: 0, bootstrap: 1 }] })).toBe(true);
  });

  it("says each pool's held boxes, what they hold, and that they stay until brought back", () => {
    const row = text(createElement(InLovejoin, { held, now: Date.now(), onOpen: () => undefined }));
    expect(row).toContain(`30 boxes of 10 ₳ 300 ₳ ${tr("home.lovejoin.bootstrapping", { count: 30 })}`);
    expect(row).toContain(`2 boxes of 100 MIN + 4.5 ₳ 9 ₳ ${tr("home.lovejoin.bootstrapping", { count: 2 })}`);
    // No "Your mixes" row in their place.
    expect(row).not.toContain(tr("home.lovejoin.yourMixes"));
    // Beside boxes on their way back, and a mix stopped partway, on the first row.
    const both = text(createElement(InLovejoin, { held: { ...held, boxes: 2, lovelace: "20000000", next: Date.now() + HOUR, stopped: 1 }, now: Date.now(), onOpen: () => undefined }));
    expect(both.indexOf("2 boxes of 10 ₳ 20 ₳")).toBeLessThan(both.indexOf("30 boxes of 10 ₳ 300 ₳"));
    expect(both.match(/stopped partway/g)).toHaveLength(1);
  });

  it("hides how many with the balances", () => {
    const row = text(createElement(InLovejoin, { held, now: Date.now(), onOpen: () => undefined }), true);
    expect(row).not.toMatch(/\b30\b|300|\b9 ₳/);
    expect(row).toContain(tr("home.lovejoin.bootstrapping", { count: 2 }));
  });
});

describe("a box back that ties a public account to the private balance (1.6.0's release review, PRIV-3)", SLOW, () => {
  it("records a box the public account paid to bring back as that account's too", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const mine = await tokenBox(t, "f1", true, 7);
    t.koios.addedToAccounts.push(atAccount("e1", "20000000"), atAccount("e5", "5000000"), ...POOL, mine, ...(await strangers(t)));
    t.koios.params = DEAR;
    await t.balances.get("preprod");
    const pending = await lj.withdrawNow("preprod", { txHash: mine.tx_hash, txIndex: 0, pool: TOKEN }, false, true);
    expect((await historyOf(t, pending.txHash))?.origin).toEqual({ id: `box:${pending.txHash}+public:0`, origin: "own" });
  });

  it("records a public Bootstrap's box brought back from where its deposit put it as the account's too", async () => {
    const t = await wallet();
    const lj = pooled(t, []);
    t.koios.addedToAccounts.push(atAccount("e1", "30000000"), atAccount("e5", "5000000"), ...POOL);
    const summary = await lj.publicBuild("preprod", 1, { bootstrap: true });
    await lj.publicSubmit("preprod", summary.txHash);
    t.koios.confirmations = 1;
    await lj.pumpPublic("preprod");
    // Its box, where the deposit put it, hours ago.
    const box = { ...POOL[0]!, tx_hash: summary.entry, tx_index: 0, block_time: Math.floor(t.clock.now / 1000) - 7 * 3600, inline_datum: { bytes: await datum(t, true), value: {} } } as KoiosUtxo;
    t.koios.addedToAccounts.push(box);
    t.clock.now += 10 * 60_000;
    expect((await lj.status("preprod")).bootstrap).toEqual([{ txHash: summary.entry, txIndex: 0 }]);
    const pending = await lj.withdrawNow("preprod", { txHash: summary.entry, txIndex: 0 });
    expect(txInputs(t.koios.submitted.at(-1)!)).toContain(`${summary.entry}#0`);
    expect((await historyOf(t, pending.txHash))?.origin).toEqual({ id: `box:${pending.txHash}+public:0`, origin: "own" });
  });
});

describe("a Bootstrap whose deposit never landed (1.6.0's release review, STATE-5)", SLOW, () => {
  it("lets go of the wallet's other box it held in its place once its record goes, and that box comes back", async () => {
    const t = await wallet();
    const lj = pooled(t);
    // A box of the wallet's no record accounts for (a restore's, or moved since its chain's record went): a mix made it.
    const f1 = await tokenBox(t, "f1");
    t.koios.addedToAccounts.push(...POOL, f1, ...(await strangers(t)));
    await lj.status("preprod");
    // A Bootstrap from the public account: its deposit sent, the chain all sent, and it never lands.
    await bootstrapped(lj, "b0".repeat(32), 2, TOKEN);
    for (const h of [4, 8, 24, 48]) {
      t.clock.now += h * HOUR;
      await t.wallet.unlock(PASSWORD);
      await unlockedAnHourAgo(t);
      await lj.status("preprod");
      await lj.withdrawDue("preprod");
    }
    const status = await lj.status("preprod");
    expect(status.pools![0]!.bootstrap ?? []).toEqual([]);
    expect((await sealed(t)).mixes!.find((e) => e.bootstrap)).toBeUndefined();
    // f1 came back by itself, as any box does.
    expect(t.collateral.asked.flatMap((tx) => txInputs(Uint8Array.from(Buffer.from(tx, "hex"))))).toContain(`${f1.tx_hash}#0`);
  });

  it("keeps holding a box someone else's mix moved, once a read listed its deposit, after its record goes", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const deposit = "b0".repeat(32);
    const there = await tokenBox(t, "b0", true, 1);
    t.koios.addedToAccounts.push(...POOL, there, ...(await strangers(t)));
    await bootstrapped(lj, deposit, 1, TOKEN);
    expect((await lj.status("preprod")).pools![0]!.bootstrap).toEqual([{ txHash: deposit, txIndex: 0, pool: TOKEN }]);
    // Someone else's mix moved it: it's the wallet's box at another mix's output now.
    t.koios.addedToAccounts.splice(t.koios.addedToAccounts.indexOf(there), 1);
    const moved = await tokenBox(t, "f9", true, 7);
    madeByMix(t.koios, moved.tx_hash);
    t.koios.addedToAccounts.push(moved);
    for (const h of [4, 24]) {
      t.clock.now += h * HOUR;
      await t.wallet.unlock(PASSWORD);
      await unlockedAnHourAgo(t);
      await lj.status("preprod");
      await lj.withdrawDue("preprod");
    }
    expect((await lj.status("preprod")).pools![0]!.bootstrap).toEqual([{ txHash: moved.tx_hash, txIndex: 0, pool: TOKEN }]);
    expect(t.collateral.asked).toHaveLength(0);
  });
});

describe("a private Bootstrap's entry kept before it kept its deposit (STATE-1's last gap)", SLOW, () => {
  it("learns its deposit while its chain's record has it, and holds its box once the record goes", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const [deposit, back] = ["d0".repeat(32), "d1".repeat(32)];
    // A session's chain: its deposit, then its return, whose hash is the chain's id.
    await lj.recordChain("preprod", {
      session: 0,
      progress: "test.d0",
      txs: [
        { kind: "deposit", txCbor: "", txHash: deposit, fee: "0" },
        { kind: "back", txCbor: "", txHash: back, fee: "0" },
      ],
      leaves: [{ txHash: deposit, txIndex: 0, pool: TOKEN }],
      boxes: 1,
      pools: { [TOKEN]: 1 },
      bootstrap: true,
    });
    await lj.chainSent("preprod", back, 0);
    await lj.chainSent("preprod", back, 1);
    await lj.chainEnded("preprod", back);
    // Its entry as the rehearsal's wallets kept it, before entries kept their deposit.
    const kept = (await t.store.get<Sealed & { mixes: Array<Record<string, unknown>> }>("lovejoin.preprod"))!;
    for (const e of kept.mixes) delete e.deposit;
    await t.store.set("lovejoin.preprod", kept);
    const there = await tokenBox(t, "d0", true, 1);
    t.koios.addedToAccounts.push(...POOL, there, ...(await strangers(t)));
    expect((await lj.status("preprod")).pools![0]!.bootstrap).toEqual([{ txHash: deposit, txIndex: 0, pool: TOKEN }]);
    t.clock.now += 4 * HOUR;
    await t.wallet.unlock(PASSWORD);
    await unlockedAnHourAgo(t);
    await lj.status("preprod");
    expect((await sealed(t)).chains.find((c) => c.id === back)).toBeUndefined();
    expect((await lj.status("preprod")).pools![0]!.bootstrap).toEqual([{ txHash: deposit, txIndex: 0, pool: TOKEN }]);
  });
});

describe("Bring one back now where a Bootstrap holds every box (1.6.0's release review, UI-5)", SLOW, () => {
  it("says the Bootstrap holds them, never that the pool has none of the wallet's", async () => {
    const t = await wallet();
    const lj = pooled(t);
    const boxes = await Promise.all([0, 1].map((i) => tokenBox(t, "b0", true, 7, i)));
    t.koios.addedToAccounts.push(...POOL, ...boxes, ...(await strangers(t)));
    await bootstrapped(lj, "b0".repeat(32), 2, TOKEN);
    t.clock.now += 10 * 60_000;
    expect((await lj.status("preprod")).pools![0]!.bootstrap).toHaveLength(2);
    await expect(lj.withdrawNow("preprod", undefined, false, false, TOKEN)).rejects.toThrow(tr("lj.bootstrapHolds"));
  });
});

describe("the questions before a Bootstrap's boxes come back (1.6.0's release review, PRIV-5)", () => {
  const ask = (props: Partial<Parameters<typeof HeldQuestion>[0]>) =>
    renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(HeldQuestion, { all: false, stuck: false, fromAccount: false, onKeep: () => undefined, onConfirm: () => undefined, ...props }),
      ),
    );

  it("asks before Bring them all back, saying what an unmixed box ties, and the public account's part", () => {
    const all = ask({ all: true });
    expect(all).toContain(tr("lovejoin.bootstrap.allTitle"));
    expect(all).toContain(tr("lovejoin.bootstrap.privacy.all").replaceAll("'", "&#x27;"));
    expect(all).toContain(tr("lovejoin.bootstrap.bringAll"));
    expect(all).not.toContain(tr("lovejoin.bootstrap.privacy.account").replaceAll("'", "&#x27;"));
    expect(ask({ all: true, fromAccount: true })).toContain(tr("lovejoin.bootstrap.privacy.account").replaceAll("'", "&#x27;"));
    expect(ask({ fromAccount: true })).toContain(tr("lovejoin.bootstrap.privacy.account").replaceAll("'", "&#x27;"));
  });

  it("names who pays, the private balance first, in a pool whose boxes can't pay their own way back", () => {
    const one = ask({});
    expect(one).toMatch(/class="primary"[^>]*>[^<]*Bring one back/);
    // The owner's call 36: the private balance by default, `danger` as this confirm was, the public account a button
    // below it.
    const paying = ask({ stuck: true });
    expect(paying).toMatch(new RegExp(`class="danger"[^>]*>${tr("lovejoin.stuck.confirmPrivate")}<`));
    expect(paying).toMatch(new RegExp(`class="secondary"[^>]*>${tr("lovejoin.stuck.confirm")}<`));
    expect(paying.indexOf(tr("lovejoin.stuck.confirmPrivate"))).toBeLessThan(paying.indexOf(tr("lovejoin.stuck.confirm")));
    expect(paying).toContain(tr("lovejoin.stuck.privacy.private").replaceAll("'", "&#x27;"));
    expect(paying).toContain(tr("lovejoin.stuck.privacy.public").replaceAll("'", "&#x27;"));
  });
});

describe("the Bootstrap form's bounds are the worker's (1.6.0's release review, MONEY-6 = UI-10)", () => {
  const ada = (lovelace: bigint) => ({ lovelace: lovelace.toString(), tokens: [] });
  it("caps every pool but the classic at a token deposit's 64, and the private side at what its reserve pays for", () => {
    expect(bootstrapLimits({ id: undefined, box: { lovelace: "10000000" } }, "public", ada(10_000_000_000n)).most).toBe(96);
    expect(bootstrapLimits({ id: A, box: { lovelace: "25000000" } }, "public", ada(10_000_000_000n)).most).toBe(64);
    expect(bootstrapLimits({ id: A, box: MIN_100 }, "public", ada(10_000_000_000n)).most).toBe(64);
    expect(bootstrapLimits({ id: undefined, box: { lovelace: "10000000" } }, "private", ada(10_000_000_000n), 53).most).toBe(53);
    expect(bootstrapLimits({ id: undefined, box: { lovelace: "10000000" } }, "public", ada(10_000_000_000n), 53).most).toBe(96);
  });

  it("counts the funding's 1.5 ₳ reserve in what the private balance must hold", () => {
    // 30 boxes of 10 ₳, the 5 ₳ collateral and the fee's room: 306 ₳. The reserve makes it 307.5.
    const box = { id: undefined, box: { lovelace: "10000000" } };
    expect(bootstrapLimits(box, "private", ada(307_000_000n), 53, 30).short).toBe(true);
    expect(bootstrapLimits(box, "private", ada(307_500_000n), 53, 30).short).toBe(false);
    expect(bootstrapLimits(box, "public", ada(0n), undefined, 30).short).toBe(false);
  });
});
