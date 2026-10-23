// 1.6.0's review, a payment in parts as it's sent (background/parts.ts): what keeps the rest going once some went, and
// what Home's banner says of them. The parts that wait for the one before (10b) go while the wallet is unlocked
// whatever one look said; a wait is never a refusal, and a part that went already counts as went; a worker stopped
// mid-Send leaves nothing reserved that nobody owns; the review's age is checked once, at Send; a session's funding
// can say its parts mustn't go (`mayGo`). Then the guards no test pinned, each shown by taking it out. Through
// WebAssembly, on the 12-word phrase's register, as payment-parts-chain.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import { Koios, type KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { type MayGo, type OnStopped, PartsService, SESSION_WAITING_PREFIX, type Waiting, waitingPartKey } from "../src/background/parts";
import { pendingKey, PendingService, UNSEEN_AFTER_MS } from "../src/background/pending";
import { runNetworks } from "../src/background/runs";
import { BUILT_TTL_MS, readContract, type ScriptSpendDeps } from "../src/background/script-spend";
import { SESSION_RESERVED_PREFIX, reservedSet } from "../src/background/spent";
import type { Area } from "../src/background/storage";
import { SessionService } from "../src/background/sessions";
import { TransferService } from "../src/background/transfer";
import { WithdrawService } from "../src/background/withdraw";
import type { PendingTx } from "../src/shared/rpc";
import { PendingBanner } from "../src/ui/components/PendingBanner";
import { NetworkContext } from "../src/ui/network";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const SLOW = { timeout: 240_000 };
const v12 = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
const v15 = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!;
/** "This is a test.", a live preprod Seedelf the phrase doesn't own. */
const THEIRS = transferPreprod.to;
/** The 12-word phrase's own receive address: Make public's. */
const OWN = v12.preprod.receive_0 as string;
/** Another wallet's address, for a payment from the public account. */
const THEIR_ADDRESS = v15.preprod.receive_0 as string;

type T = ReturnType<typeof testBalances>;
type Fetch = T["koios"]["fetch"];

/** Token `i`: its own policy and a 32-byte name, as many bytes as a token takes. */
const token = (i: number) => ({
  policy_id: (0xabc00000 + i).toString(16).padStart(56, "0"),
  asset_name: (0x1000 + i).toString(16).padStart(64, "0"),
  quantity: "1000",
  decimals: 0,
  fingerprint: "",
});

/** Bundle `n` of 20 tokens holding `lovelace`, under the phrase's register, as a move-in leaves them. */
const bundle = (n: number, lovelace: string): KoiosUtxo => ({
  ...ownedUtxos[0]!,
  tx_hash: (0x100 + n).toString(16).padStart(64, "0"),
  value: lovelace,
  asset_list: Array.from({ length: 20 }, (_, k) => token(n * 20 + k)),
});

/** One big UTxO of ADA alone, the only one: parts that each spend their own can't share it. */
const bigAda = (): KoiosUtxo => ({ ...ownedUtxos[0]!, tx_hash: "ad".repeat(32), value: "409000000" });

/** WebAssembly, with its signing stood in for (Rust tests cover it): each transaction as it came. */
function wasmSigning(onSign?: (n: number) => void) {
  const wasm = loadTestWasm();
  let signed = 0;
  return {
    ...wasm,
    signScriptSpend: (_key: unknown, request: string) => {
      onSign?.(++signed);
      const { txCbor } = JSON.parse(request) as { txCbor: string };
      return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
    },
  } as typeof wasm;
}

/** What the history stub does as a transaction is written into it: nothing, unless a test holds it there. */
interface History {
  onSent: () => Promise<void>;
}

interface Options {
  /** The worker's session storage: a restarted worker's is the same storage under a new object. */
  session?: Area;
  /** Koios, as the worker's fetch reaches it. */
  fetch?: Fetch;
  mayGo?: MayGo;
  stopped?: OnStopped;
  history?: History;
  onSign?: (n: number) => void;
}

function services(t: T, o: Options = {}) {
  const deps: ScriptSpendDeps = {
    wasm: wasmSigning(o.onSign),
    wallet: t.wallet,
    session: o.session ?? t.session,
    koios: () => new Koios("https://preprod.koios.rest/api/v1", o.fetch ?? t.koios.fetch, async () => undefined),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    now: () => t.clock.now,
    coins: t.coins,
    store: t.store,
    activity: {
      sent: () => o.history?.onSent() ?? Promise.resolve(),
      classes: async () => new Map(),
      seedelf: async () => [],
    } as never,
  };
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return {
    deps,
    transfer: new TransferService(deps),
    withdraw: new WithdrawService(deps),
    parts: new PartsService({ ...deps, mayGo: o.mayGo, stopped: o.stopped }),
    pending: new PendingService(deps),
  };
}

/** The least ADA a bundle of 20 tokens needs: what a payment of exactly them carries, as the review says it. */
let least: Promise<string> | undefined;
function bundleLeast(): Promise<string> {
  least ??= (async () => {
    const t = testBalances({ owned: false });
    await t.wallet.create(v12.phrase, PASSWORD);
    t.koios.added.push(bigAda(), bundle(0, "20000000"));
    const { transfer } = services(t);
    const tokens = bundle(0, "0").asset_list!.map((a) => ({ policyId: a.policy_id, assetName: a.asset_name, quantity: a.quantity }));
    return (await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }])).payments[0]!.minimum!;
  })();
  return least;
}

/** Test wallet A's shape: `n` bundles at exactly their least, and the one big UTxO of ADA (12: two parts, 20: three). */
async function walletA(n: number): Promise<{ t: T; tokens: Array<{ policyId: string; assetName: string; quantity: string }> }> {
  const bundles = Array.from({ length: n }, (_, i) => bundle(i, ""));
  const lovelace = await bundleLeast();
  const t = testBalances({ owned: false });
  await t.wallet.create(v12.phrase, PASSWORD);
  t.koios.added.push(bigAda(), ...bundles.map((b) => ({ ...b, value: lovelace })));
  const tokens = bundles.flatMap((b) => b.asset_list!.map((a) => ({ policyId: a.policy_id, assetName: a.asset_name, quantity: a.quantity })));
  return { t, tokens };
}

/** The wallet with `more` of its 25 ₳ Seedelf UTxO, each its own outpoint: parts that each pay their own way. */
async function spread(more: number): Promise<T> {
  const t = testBalances();
  await t.wallet.create(v12.phrase, PASSWORD);
  const base = ownedUtxos[0]!;
  t.koios.added.push(...Array.from({ length: more }, (_, i) => ({ ...base, tx_hash: (i + 1).toString(16).padStart(64, "0") })));
  return t;
}

const submittedIds = (t: T) => t.koios.submitted.map((b) => txIdOf(b));
const sending = (t: T) => t.wallet.withKeys(() => reservedSet(t.session, "preprod", { sending: true }));

/** Moves the clock on by `ms`, the user busy all along, so the wallet doesn't lock itself. */
async function busy(t: T, ms: number) {
  for (let left = ms; left > 0; left -= 60_000) {
    t.clock.now += Math.min(left, 60_000);
    await t.wallet.touch();
  }
}

/** The same storage under a new object: a restarted worker's, so every map kept by it starts empty. */
const restarted = (s: Area): Area => ({ get: (k) => s.get(k), set: (k, v) => s.set(k, v), remove: (...k) => s.remove(...k), clear: () => s.clear() });

/** Koios with its submit of `hash` taken but never answered: a worker stopped while it was asked. */
function hangingOn(t: T, hang: { hash?: string; any?: boolean }): Fetch {
  return async (url, init) => {
    if (String(url).endsWith("/submittx")) {
      const id = txIdOf(new Uint8Array((init as RequestInit).body as Uint8Array));
      if (hang.any || id === hang.hash) {
        await t.koios.fetch(url, init);
        return new Promise<Response>(() => undefined);
      }
    }
    return t.koios.fetch(url, init);
  };
}

async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 2000 && !(await check()); i++) await new Promise((r) => setTimeout(r, 5));
  expect(await check()).toBe(true);
}

/** What Home's banner says of `pending`, as a person reads it. */
function banner(pending: PendingTx, watching = false): string {
  return renderToStaticMarkup(
    createElement(NetworkContext.Provider, { value: "preprod" }, createElement(PendingBanner, { pending, watching, onDismiss: () => undefined })),
  )
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** What Home's poll hears (handlers.ts "pending-tx"): the watch, with its payment's parts; or the parts' own. */
async function homeHears(s: ReturnType<typeof services>): Promise<PendingTx | null> {
  const pending = await s.pending.pending("preprod");
  if (!pending) return (await s.parts.shown("preprod")) ?? null;
  const first = pending.chain?.first;
  const parts = first ? await s.parts.of("preprod", first) : undefined;
  return parts ? { ...pending, parts } : pending;
}

/** A runner of the worker's runs with only the parts: what the alarm does after one run. */
async function oneRun(t: T, parts: Pick<PartsService, "pump">) {
  const alarm = { started: 0, stopped: 0, start: async () => void alarm.started++, stop: async () => void alarm.stopped++ };
  const ctx = {
    wallet: t.wallet,
    sessions: { runAll: async () => false },
    lovejoin: { pumpPublic: async () => false, withdrawDue: async () => undefined, returning: async () => false },
    pending: { watch: async () => false },
    parts,
    networks: ["preprod"],
  } as unknown as Parameters<typeof runNetworks>[0];
  await runNetworks(ctx, { start: alarm.start, stop: alarm.stop, starts: () => alarm.started });
  return alarm;
}

describe("a payment in parts as it's sent: the review's fixes (1.6.0)", SLOW, () => {
  it("keeps the sessions alarm going while parts wait, when a look for the part before fails", async () => {
    const { t, tokens } = await walletA(12);
    const down = { on: false };
    const fetch: Fetch = async (url, init) => {
      if (down.on && String(url).includes("tx_status")) throw new TypeError("Failed to fetch");
      return t.koios.fetch(url, init);
    };
    const { transfer, parts } = services(t, { fetch });
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    await transfer.submit("preprod", summary.txHash);
    // The device is offline as Chrome fires the alarm: the look fails, and the part still waits.
    down.on = true;
    await busy(t, 30_000);
    expect(await parts.pump("preprod")).toBe(true);
    await busy(t, 30_000);
    expect(await oneRun(t, parts)).toMatchObject({ started: 1, stopped: 0 });
    // A pump that fails as a whole never reads as nothing waiting either.
    expect(await oneRun(t, { pump: () => Promise.reject(new Error("storage")) })).toMatchObject({ started: 1, stopped: 0 });
    // Back online, and the part before is in a block: the rest goes.
    down.on = false;
    t.koios.confirmations = 1;
    await busy(t, 30_000);
    expect(await parts.pump("preprod")).toBe(false);
    expect(submittedIds(t)).toEqual(all.map((p) => p.txHash));
  });

  it("says a chain whose later part never showed went in part, not that the payment never went out", async () => {
    const { t, tokens } = await walletA(20);
    const s = services(t);
    const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    expect(all.length).toBe(3);
    await s.transfer.submit("preprod", summary.txHash);
    // The first lands; the second goes, and never shows.
    t.koios.confirmations = 1;
    for (const p of all.slice(1)) t.koios.missing.add(p.txHash);
    await busy(t, 30_000);
    await s.parts.pump("preprod");
    expect(submittedIds(t)).toEqual(all.slice(0, 2).map((p) => p.txHash));
    await busy(t, UNSEEN_AFTER_MS + 60_000);
    expect(await s.parts.pump("preprod")).toBe(false);
    expect(await s.parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 2, total: 3, stopped: "unseen" });
    // The watch let the second go: Home hears it from the parts' record. The first is on chain, so it's said as parts
    // that stopped, the unseen one among those that didn't go.
    await t.session.remove(pendingKey("preprod"));
    const heard = (await homeHears(s))!;
    const said = banner(heard);
    expect(said).not.toMatch(/never went out|not seen on the network/);
    expect(said).toContain("Private payment only partly sent");
    expect(said).toContain("2 of 3 didn't go.");
    // The watch letting it go as unseen itself (one Koios didn't answer), named by the first: the same.
    const dropped: PendingTx = {
      kind: "transfer",
      network: "preprod",
      txHash: all[1]!.txHash,
      submittedAt: t.clock.now,
      confirmations: null,
      dropped: "unseen",
      chain: { first: all[0]!.txHash, total: 3 },
    };
    for (const parts of [{ sent: 2, total: 3 }, { sent: 2, total: 3, stopped: "unseen" as const }]) {
      expect(banner({ ...dropped, parts })).toContain("2 of 3 didn't go.");
      expect(banner({ ...dropped, parts })).not.toMatch(/never went out/);
    }
    // Parts that all went now (item 8): the last, unseen, is the one that didn't.
    expect(banner({ ...dropped, chain: { first: all[0]!.txHash, total: 2 } })).toContain("1 of 2 didn't go.");
    // The first never showing is still a payment that most likely never went out.
    expect(banner({ ...dropped, txHash: all[0]!.txHash, parts: { sent: 1, total: 3, stopped: "unseen" } })).toMatch(/most likely never went out/);
    // And a public mix's chain through Lovejoin, named by its first too, isn't a payment in parts.
    expect(banner({ ...dropped, kind: "lovejoin-mix", chain: { first: all[0]!.txHash, total: 14 } })).toMatch(/not seen on the network/);
  });

  it("never titles parts that stopped confirmed, nor a short funding funded", () => {
    const landed: PendingTx = {
      kind: "transfer",
      network: "preprod",
      txHash: "ee".repeat(32),
      submittedAt: 0,
      confirmations: 1,
      chain: { first: "11".repeat(32), total: 3 },
      parts: { sent: 1, total: 3, stopped: "refused" },
    };
    expect(banner(landed)).not.toMatch(/confirmed/i);
    expect(banner(landed)).toContain("Private payment only partly sent");
    expect(banner(landed)).toContain("2 of 3 didn't go.");
    const funding = banner({ ...landed, kind: "session-out", parts: { sent: 1, total: 2, stopped: "cancelled" } });
    expect(funding).not.toMatch(/funded/i);
    expect(funding).toContain("Payment into a private session only partly sent");
    expect(funding).toContain("1 of 2 didn't go.");
    // Every part went: confirmed, as ever.
    expect(banner({ ...landed, parts: undefined })).toContain("Private payment confirmed");
  });

  it("says a payment whose later part was refused at Send went in part, once what went lands", async () => {
    const t = await spread(40);
    const s = services(t, {
      onSign: (n) => {
        // The second, signed, is refused when it's submitted.
        if (n === 2) t.koios.rejectSubmit = "Transaction Fails Validation";
      },
    });
    const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "600000000", tokens: [] }]);
    const all = summary.parts!;
    expect(all).toHaveLength(2);
    await expect(s.transfer.submit("preprod", summary.txHash)).rejects.toThrow(/^1 of 2 transactions went\./);
    t.koios.rejectSubmit = undefined;
    // On its way: the one that went, and that the other didn't go.
    expect(banner((await homeHears(s))!, true)).toContain("1 of 2 didn't go.");
    t.koios.confirmations = 1;
    const said = banner((await homeHears(s))!);
    expect(said).not.toMatch(/confirmed/i);
    expect(said).toContain("Private payment only partly sent");
    expect(said).toContain("1 of 2 didn't go.");
    // Nothing waits, and nothing's held.
    expect(await s.parts.pump("preprod")).toBe(false);
    expect((await sending(t)).inputs.size).toBe(0);
  });

  it("lets a waiting part wait while another payment, written ahead meanwhile, may still go through", async () => {
    const { t, tokens } = await walletA(12);
    let writeOther = false;
    const fetch: Fetch = async (url, init) => t.koios.fetch(url, init);
    const s = services(t, { fetch });
    const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    await s.transfer.submit("preprod", summary.txHash);
    // While giveme.my is asked for the second, a site's funding is written ahead: maybe sent until Koios answers.
    const giveme = t.collateral.fetch;
    t.collateral.fetch = async (url, init) => {
      if (writeOther) {
        writeOther = false;
        await t.session.set(pendingKey("preprod"), {
          kind: "withdraw",
          network: "preprod",
          txHash: "ee".repeat(32),
          submittedAt: t.clock.now,
          confirmations: null,
          maybeSent: true,
          inputs: [],
        });
      }
      return giveme(url, init);
    };
    writeOther = true;
    t.koios.confirmations = 1;
    await busy(t, 30_000);
    expect(await s.parts.pump("preprod")).toBe(true);
    // A wait, not a refusal: nothing stopped, and the part is kept to go.
    expect(await s.parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 1, total: 2 });
    expect(await t.session.get(waitingPartKey(all[1]!.txHash))).toBeDefined();
    expect(submittedIds(t)).toEqual([all[0]!.txHash]);
    // The other settles: the part goes.
    await t.session.remove(pendingKey("preprod"));
    await busy(t, 30_000);
    expect(await s.parts.pump("preprod")).toBe(false);
    expect(submittedIds(t)).toEqual(all.map((p) => p.txHash));
  });

  it("counts a part a stopped worker sent, and the watch settled since, as went, and sends the rest", async () => {
    const { t, tokens } = await walletA(20);
    const hang: { hash?: string } = {};
    const one = services(t, { fetch: hangingOn(t, hang) });
    const summary = await one.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    expect(all.length).toBe(3);
    await one.transfer.submit("preprod", summary.txHash);
    t.koios.confirmations = 1;
    t.koios.missing.add(all[1]!.txHash);
    t.koios.missing.add(all[2]!.txHash);
    await busy(t, 30_000);
    // The worker stops while Koios is asked for the second.
    hang.hash = all[1]!.txHash;
    void one.parts.pump("preprod");
    await until(() => submittedIds(t).length === 2);
    hang.hash = undefined;
    // It reached the chain; a fresh worker's watch settles it, and its pump goes on from there.
    t.koios.missing.delete(all[1]!.txHash);
    await busy(t, 60_000);
    const two = services(t, { session: restarted(t.session) });
    await two.parts.pump("preprod");
    expect(await two.parts.of("preprod", all[0]!.txHash)).toBeUndefined();
    expect(submittedIds(t)).toEqual(all.map((p) => p.txHash));
  });

  it("leaves nothing reserved that nobody owns when the worker stops while Send sends the parts that go now", async () => {
    const { t, tokens } = await walletA(12);
    const hang = { any: true };
    const one = services(t, { fetch: hangingOn(t, hang) });
    const summary = await one.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    expect(all.length).toBe(2);
    // Send: the first's submit, and the worker stops while Koios is asked.
    void one.transfer.submit("preprod", summary.txHash).catch(() => undefined);
    await until(() => submittedIds(t).length === 1);
    hang.any = false;
    // A fresh worker: the first reached the chain; its watch settles it, and its pump sends the rest.
    const two = services(t, { session: restarted(t.session) });
    t.koios.confirmations = 1;
    await busy(t, 3 * 60_000);
    await two.pending.pending("preprod");
    await two.parts.pump("preprod");
    expect(submittedIds(t)).toEqual(all.map((p) => p.txHash));
    expect(await two.parts.pump("preprod")).toBe(false);
    expect((await sending(t)).inputs.size).toBe(0);
  });

  it("leaves what waits to Send while Send still sends the parts that go now", async () => {
    const { t, tokens } = await walletA(12);
    const hang = { any: true };
    const s = services(t, { fetch: hangingOn(t, hang) });
    const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    void s.transfer.submit("preprod", summary.txHash).catch(() => undefined);
    await until(() => submittedIds(t).length === 1);
    // Home's poll meanwhile: the rest wait, and nothing is asked of the chain for them until Send is done.
    const asked = t.koios.calls.filter((c) => c.path === "tx_status").length;
    expect(await s.parts.pump("preprod")).toBe(true);
    expect(t.koios.calls.filter((c) => c.path === "tx_status")).toHaveLength(asked);
    expect(await s.parts.of("preprod", summary.txHash)).toEqual({ sent: 1, total: 2 });
  });

  it("frees what a stopped worker's Send held once the first never shows", async () => {
    const { t, tokens } = await walletA(12);
    const hang = { any: true };
    const one = services(t, { fetch: hangingOn(t, hang) });
    const summary = await one.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    void one.transfer.submit("preprod", summary.txHash).catch(() => undefined);
    await until(() => submittedIds(t).length === 1);
    hang.any = false;
    expect((await sending(t)).inputs.size).toBeGreaterThan(0);
    const two = services(t, { session: restarted(t.session) });
    t.koios.missing.add(summary.txHash);
    await busy(t, UNSEEN_AFTER_MS + 60_000);
    expect(await two.parts.pump("preprod")).toBe(false);
    expect(await two.parts.of("preprod", summary.txHash)).toMatchObject({ stopped: "unseen" });
    expect((await sending(t)).inputs.size).toBe(0);
  });

  it("leaves the parts that wait as they are when Send is pressed again on a first part that may have gone", async () => {
    const { t, tokens } = await walletA(12);
    const s = services(t);
    const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    // Koios takes the first and doesn't answer: it may have gone, and the second waits for it all the same.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      if (String(url).endsWith("/submittx")) throw new DOMException("signal timed out", "TimeoutError");
      return answer;
    };
    expect(await s.transfer.submit("preprod", summary.txHash)).toMatchObject({ maybeSent: true, parts: { sent: 1, total: 2 } });
    const held = (await sending(t)).inputs.size;
    // Send again: the first goes again as it was; the second isn't Send's to send any more.
    await s.transfer.submit("preprod", summary.txHash).catch(() => undefined);
    t.koios.fetch = real;
    expect(await s.parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 1, total: 2 });
    expect((await sending(t)).inputs.size).toBe(held);
    // The first lands: the second goes.
    t.koios.confirmations = 1;
    await busy(t, 3 * 60_000);
    await s.parts.pump("preprod");
    expect(submittedIds(t).filter((h) => h === all[1]!.txHash)).toHaveLength(1);
    expect(await s.parts.of("preprod", all[0]!.txHash)).toBeUndefined();
  });

  it("checks the review's age once, at Send, for every part that goes then", async () => {
    for (const make of ["withdraw", "transfer"] as const) {
      const t = await spread(40);
      // Pressed just before the review is too old to send: the second part is signed a moment after it is.
      const s = services(t, { onSign: (n) => void (n === 1 && (t.clock.now += 2_000)) });
      const summary =
        make === "withdraw"
          ? await s.withdraw.build("preprod", [{ to: OWN, lovelace: "600000000", tokens: [] }])
          : await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "600000000", tokens: [] }]);
      expect(summary.parts).toHaveLength(2);
      await busy(t, BUILT_TTL_MS - 1_000);
      await (make === "withdraw" ? s.withdraw : s.transfer).submit("preprod", summary.txHash);
      expect(submittedIds(t)).toEqual(summary.parts!.map((p) => p.txHash));
    }
  });

  it("asks a session's funding whether each waiting part may go, and stops the rest when it mustn't (mayGo)", async () => {
    const { t, tokens } = await walletA(20);
    let may = true;
    const asked: Waiting[] = [];
    const told: Waiting[] = [];
    const s = services(t, {
      mayGo: async (_n, w) => {
        asked.push(w);
        return may;
      },
      stopped: async (_n, w) => void told.push(w),
    });
    const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    expect(all.length).toBe(3);
    await s.transfer.submit("preprod", summary.txHash);
    // Not asked while the part before isn't in a block.
    t.koios.missing.add(all[0]!.txHash);
    await busy(t, 30_000);
    await s.parts.pump("preprod");
    expect(asked).toEqual([]);
    // The first lands; asked, it may go: it does.
    t.koios.missing.delete(all[0]!.txHash);
    t.koios.missing.add(all[1]!.txHash);
    t.koios.missing.add(all[2]!.txHash);
    t.koios.confirmations = 1;
    await busy(t, 30_000);
    await s.parts.pump("preprod");
    expect(submittedIds(t)).toEqual(all.slice(0, 2).map((p) => p.txHash));
    expect(asked.map((w) => [w.hashes[0], w.sent])).toEqual([[all[0]!.txHash, 1]]);
    // The session stops meanwhile: the second lands, and the third mustn't go.
    may = false;
    t.koios.missing.clear();
    await busy(t, 30_000);
    expect(await s.parts.pump("preprod")).toBe(false);
    expect(submittedIds(t)).toEqual(all.slice(0, 2).map((p) => p.txHash));
    expect(await s.parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 2, total: 3, stopped: "cancelled" });
    expect(told.map((w) => [w.stopped, w.sent])).toEqual([["cancelled", 2]]);
    expect(await t.session.get(waitingPartKey(all[2]!.txHash))).toBeUndefined();
    expect((await sending(t)).inputs.size).toBe(0);
  });
});

describe("a payment in parts' guards no test pinned (1.6.0's review)", SLOW, () => {
  it("refuses Send on a review in parts whose kept parts are another review's, and sends nothing", async () => {
    const t = await spread(40);
    const { withdraw } = services(t);
    const a = await withdraw.build("preprod", [{ to: OWN, lovelace: "600000000", tokens: [] }]);
    // Another window reviews another amount under the same keys, then Send is pressed on the first.
    const b = await withdraw.build("preprod", [{ to: OWN, lovelace: "550000000", tokens: [] }]);
    expect(a.parts).toHaveLength(2);
    expect(b.parts).toHaveLength(2);
    await expect(withdraw.submit("preprod", a.txHash)).rejects.toThrow();
    expect(t.koios.submitted).toEqual([]);
  });

  it("frees what the waiting parts held when the first is turned away at Send", async () => {
    const { t, tokens } = await walletA(20);
    const { transfer, deps } = services(t);
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    expect(summary.parts!.length).toBe(3);
    t.collateral.answer = { status: 400, body: { detail: "busy elsewhere" } };
    await expect(transfer.submit("preprod", summary.txHash)).rejects.toThrow();
    expect(t.koios.submitted).toEqual([]);
    expect(Object.keys((await t.session.get<Record<string, Waiting>>(SESSION_WAITING_PREFIX + "preprod")) ?? {})).toEqual([]);
    expect((await sending(t)).inputs.size).toBe(0);
    // The next review sees every UTxO: the big one of ADA and the 20 bundles.
    expect((await readContract(deps, "preprod")).utxos).toHaveLength(21);
  });

  it("frees what a site's chained funding's waiting parts held when its first is turned away at Send", async () => {
    const lovelace = await bundleLeast();
    const t = testBalances({ owned: false });
    await t.wallet.create(v12.phrase, PASSWORD);
    await t.preferences.set({ dappConnector: true, spendRewards: false });
    // 60 UTxOs, each holding one token the site asks for and 19 it doesn't, at exactly their least; one UTxO of ADA.
    const bundles = Array.from({ length: 60 }, (_, i) => ({ ...bundle(i, ""), value: lovelace }));
    t.koios.added.push(bigAda(), ...bundles);
    const tokens = bundles.map((b) => b.asset_list![0]!).map((a) => ({ policyId: a.policy_id, assetName: a.asset_name, quantity: a.quantity }));
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const deps = { ...t.deps, wasm: wasmSigning(), collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch), store: t.store };
    const sessions = new SessionService({
      ...deps,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      alarm: { start: async () => undefined },
    });
    const dapp = new DappService({ ...deps, sessions, fundingPollMs: 1, network: () => "preprod", window: t.dappWindow, changed: () => undefined });
    const site: DappSession = { id: "review", origin: "https://app.example.com", title: "Example" };
    void dapp.call(site, "enable", []).catch(() => undefined);
    await until(() => dapp.approvals().length === 1);
    const out = await dapp.privateBuild(dapp.approvals()[0]!.id, "2000000", tokens);
    expect(out.parts!.length).toBeGreaterThanOrEqual(2);
    expect(out.parts!.some((p) => p.waits)).toBe(true);
    t.collateral.answer = { status: 400, body: { detail: "busy elsewhere" } };
    await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD, { txHash: out.txHash }).catch(() => undefined);
    expect(t.koios.submitted).toEqual([]);
    expect((await sending(t)).inputs.size).toBe(0);
    expect((await readContract(deps as ScriptSpendDeps, "preprod")).utxos).toHaveLength(61);
  });

  it("waits for a payment that may still go through before it sends a waiting part, then sends it", async () => {
    for (const lookFails of [false, true]) {
      const { t, tokens } = await walletA(12);
      const down = { on: false, hash: "" };
      const s = services(t, {
        fetch: async (url, init) => {
          // Koios can't say where the other payment is.
          if (down.on && String(url).includes("tx_status") && String((init as RequestInit).body).includes(down.hash)) {
            throw new TypeError("Failed to fetch");
          }
          return t.koios.fetch(url, init);
        },
      });
      const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
      const all = summary.parts!;
      await s.transfer.submit("preprod", summary.txHash);
      // A payment from the public account that Koios took but didn't answer: it may still go through.
      const other = await t.send.build("preprod", [{ to: THEIR_ADDRESS, lovelace: "2000000", tokens: [] }]);
      down.hash = other.txHash;
      const real = t.koios.fetch;
      let left = 1;
      t.koios.fetch = async (url, init) => {
        const answer = await real(url, init);
        if (String(url).endsWith("/submittx") && left-- > 0) throw new DOMException("signal timed out", "TimeoutError");
        return answer;
      };
      expect(await t.send.submit("preprod", other.txHash)).toMatchObject({ maybeSent: true });
      t.koios.fetch = real;
      // The first part shows; the other payment doesn't yet.
      t.koios.confirmations = 1;
      t.koios.missing.add(other.txHash);
      await busy(t, 30_000);
      expect(await s.parts.pump("preprod")).toBe(true);
      expect(await s.parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 1, total: 2 });
      if (lookFails) {
        // Nor can Koios be asked about it: still a wait.
        down.on = true;
        await busy(t, 30_000);
        expect(await s.parts.pump("preprod")).toBe(true);
        expect(await s.parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 1, total: 2 });
      }
      expect(submittedIds(t)).not.toContain(all[1]!.txHash);
      // It shows: the waiting part goes.
      down.on = false;
      t.koios.missing.delete(other.txHash);
      await busy(t, 30_000);
      await s.parts.pump("preprod");
      expect(submittedIds(t)).toContain(all[1]!.txHash);
    }
  });

  it("takes a Koios 429 at a waiting part's submit for busy, not a refusal: it goes at the next look", async () => {
    const { t, tokens } = await walletA(12);
    let limited = 1;
    const s = services(t, {
      fetch: async (url, init) => {
        if (String(url).endsWith("/submittx") && limited-- > 0) return new Response("Too Many Requests", { status: 429 });
        return t.koios.fetch(url, init);
      },
    });
    const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    limited = 0;
    await s.transfer.submit("preprod", summary.txHash);
    limited = 1;
    t.koios.confirmations = 1;
    await busy(t, 30_000);
    expect(await s.parts.pump("preprod")).toBe(true);
    expect(await s.parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 1, total: 2 });
    await busy(t, 30_000);
    await s.parts.pump("preprod");
    expect(submittedIds(t)).toEqual(all.map((p) => p.txHash));
  });

  it("runs one pump at a time: Home's poll while the alarm's run sends a part stops nothing", async () => {
    const { t, tokens } = await walletA(20);
    const history: History = { onSent: async () => undefined };
    const s = services(t, { history });
    const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    expect(all.length).toBe(3);
    await s.transfer.submit("preprod", summary.txHash);
    // The first shows; giveme.my doesn't see it yet, so the second's parent is marked seen and it waits.
    t.koios.confirmations = 1;
    for (const p of all.slice(1)) t.koios.missing.add(p.txHash);
    t.collateral.answer = { status: 400, body: { detail: "input not found" } };
    await busy(t, 30_000);
    expect(await s.parts.pump("preprod")).toBe(true);
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    // The alarm's run sends the second: Koios took it, and its history is being written when Home's poll pumps too.
    let reached!: () => void;
    const atHistory = new Promise<void>((r) => (reached = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    history.onSent = async () => {
      if (held) return;
      held = true;
      reached();
      await gate;
    };
    await busy(t, 30_000);
    const alarmRun = s.parts.pump("preprod");
    await atHistory;
    let homeDone = false;
    const homePoll = s.parts.pump("preprod").then((busy) => ((homeDone = true), busy));
    // Home's poll waits for the run that's going, rather than running beside it.
    for (let i = 0; i < 500 && !homeDone; i++) await new Promise((r) => setTimeout(r, 0));
    expect(homeDone).toBe(false);
    release();
    await Promise.all([alarmRun, homePoll]);
    history.onSent = async () => undefined;
    expect(submittedIds(t)).toEqual(all.slice(0, 2).map((p) => p.txHash));
    expect(await s.parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 2, total: 3 });
    // The second shows: the third goes, and nothing was stopped.
    t.koios.missing.delete(all[1]!.txHash);
    await busy(t, 30_000);
    await s.parts.pump("preprod");
    expect(submittedIds(t)).toEqual(all.map((p) => p.txHash));
  });

  it("sends a part whose parent shows more than 10 minutes after the review was built", async () => {
    const { t, tokens } = await walletA(12);
    const { transfer, parts } = services(t);
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    await transfer.submit("preprod", summary.txHash);
    // The first takes a while to be in a block, as Koios sees it.
    await busy(t, BUILT_TTL_MS + 60_000);
    t.koios.confirmations = 1;
    await parts.pump("preprod");
    expect(await parts.of("preprod", all[0]!.txHash)).toBeUndefined();
    expect(submittedIds(t)).toEqual(all.map((p) => p.txHash));
  });

  it("doesn't send a waiting part that spends what another chain of the wallet's reserved since", async () => {
    const { t, tokens } = await walletA(12);
    const { transfer, parts } = services(t);
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    await transfer.submit("preprod", summary.txHash);
    // A chain started since (a session's return, which ends merged into what it reserves) holds a UTxO the second
    // part spends, one that was on chain at the review.
    const { txCbor } = (await t.session.get<{ txCbor: string }>(waitingPartKey(all[1]!.txHash)))!;
    const spends = txInputs(Uint8Array.from(Buffer.from(txCbor, "hex"))).filter((o) => !o.startsWith(all[0]!.txHash));
    expect(spends.length).toBeGreaterThan(0);
    const key = SESSION_RESERVED_PREFIX + "preprod";
    const had = (await t.session.get<Record<string, unknown>>(key)) ?? {};
    await t.session.set(key, { ...had, "return.test": { inputs: [spends[0]!], collateral: [] } });
    t.koios.confirmations = 1;
    await busy(t, 30_000);
    await parts.pump("preprod");
    // Not sent beside that chain: only one of the two could land.
    expect(submittedIds(t)).toEqual([all[0]!.txHash]);
  });
});

describe("a payment in parts as Home tells it, after the merged fixes' review (1.6.0)", SLOW, () => {
  it("stops saying a payment went in part once a later payment was sent", async () => {
    const t = await spread(40);
    const s = services(t, {
      onSign: (n) => {
        // The second, signed, is refused when it's submitted.
        if (n === 2) t.koios.rejectSubmit = "Transaction Fails Validation";
      },
    });
    const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "600000000", tokens: [] }]);
    await expect(s.transfer.submit("preprod", summary.txHash)).rejects.toThrow(/^1 of 2 transactions went\./);
    t.koios.rejectSubmit = undefined;
    t.koios.confirmations = 1;
    expect(banner((await homeHears(s))!)).toContain("1 of 2 didn't go.");
    // The user reviews what's left again, as the error says, and sends it; it lands.
    await busy(t, 60_000);
    t.koios.confirmations = 0;
    const again = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "100000000", tokens: [] }]);
    await s.transfer.submit("preprod", again.txHash);
    t.koios.confirmations = 1;
    expect(banner((await homeHears(s))!)).toContain("Private payment confirmed");
    // Home opens again later: what was left went since, so nothing says it stays in the private balance.
    await busy(t, 60_000);
    expect(await homeHears(s)).toBeNull();
  });

  it("lets a Send the worker stopped in before anything went go at once: nothing said, nothing held", async () => {
    const { t, tokens } = await walletA(12);
    // giveme.my is asked for the first and never answers: the worker stops then, before anything is written ahead.
    const giveme = t.collateral.fetch;
    const hang = { on: true };
    t.collateral.fetch = async (url, init) => (hang.on ? new Promise<Response>(() => undefined) : giveme(url, init));
    const one = services(t);
    const summary = await one.transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    void one.transfer.submit("preprod", summary.txHash).catch(() => undefined);
    await until(async () => (await one.parts.of("preprod", summary.txHash)) !== undefined);
    hang.on = false;
    const told: Waiting[] = [];
    const two = services(t, { session: restarted(t.session), stopped: async (_n, w) => void told.push(w) });
    t.koios.missing.add(summary.txHash);
    await busy(t, 60_000);
    // Before its pump: Home says nothing of a Send that may still be going.
    expect(await homeHears(two)).toBeNull();
    // Its pump: nothing went, so nothing waits, nothing's held, and a funding would hear it at once.
    expect(await two.parts.pump("preprod")).toBe(false);
    expect(await two.parts.of("preprod", summary.txHash)).toBeUndefined();
    expect((await sending(t)).inputs.size).toBe(0);
    expect(told.map((w) => [w.stopped, w.sent])).toEqual([["refused", 0]]);
    expect(await homeHears(two)).toBeNull();
    expect(submittedIds(t)).toEqual([]);
  });

  it("says a part Koios never answered at Send, which never landed, never went; one that landed did", async () => {
    for (const lands of [false, true]) {
      const t = await spread(40);
      const s = services(t);
      const summary = await s.transfer.build("preprod", [{ to: THEIRS, lovelace: "600000000", tokens: [] }]);
      const all = summary.parts!;
      expect(all).toHaveLength(2);
      const real = t.koios.fetch;
      t.koios.fetch = async (url, init) => {
        // Koios never answers the first: it may have gone.
        if (String(url).endsWith("/submittx") && txIdOf(new Uint8Array((init as RequestInit).body as Uint8Array)) === all[0]!.txHash) {
          throw new DOMException("signal timed out", "TimeoutError");
        }
        return real(url, init);
      };
      await expect(s.transfer.submit("preprod", summary.txHash)).rejects.toThrow(/Koios didn't answer/);
      if (lands) t.koios.confirmations = 1;
      else t.koios.missing.add(all[0]!.txHash);
      // The watch settles it: seen, or let go unseen 20 minutes on.
      for (let k = 0; k < 22; k++) {
        await busy(t, 60_000);
        await s.pending.watch("preprod");
      }
      const heard = (await homeHears(s))!;
      if (lands) {
        expect(banner(heard)).toContain("Private payment only partly sent");
        expect(banner(heard)).toContain("1 of 2 didn't go.");
      } else {
        expect(banner(heard)).not.toContain("only partly sent");
        expect(banner(heard)).toMatch(/most likely never went out/);
      }
    }
  });
});
