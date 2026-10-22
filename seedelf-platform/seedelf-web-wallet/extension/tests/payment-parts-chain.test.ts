// 1.6.0, item 10b: a payment in parts where a part of tokens has no ADA of its own to pay its fee (a move-in's bundles
// hold exactly their least, and one big UTxO of ADA can't be shared by parts that each spend their own: test wallet A's
// 400 tokens were refused with 409 ₳ in the balance). WebAssembly chains those parts, each spending what the one before
// carried forward; giveme.my witnesses only what's on the ledger, so each waits for the one before to be in a block
// (the owner, 2026-10-21: "chain where needed"). Send sends the parts that pay their own way at once and holds the
// rest (parts.ts), which the sessions alarm and Home's poll send once their parent shows. Through WebAssembly, on the
// 12-word phrase's register.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { txInputs } from "../src/background/cbor";
import { Koios, type KoiosUtxo } from "../src/background/koios";
import { GIVEME_BEHIND_MS, LOOK_EVERY_MS, PartsService, SESSION_WAITING_PREFIX, waitingPartKey } from "../src/background/parts";
import { pendingKey, UNSEEN_AFTER_MS } from "../src/background/pending";
import { partKey, readContract } from "../src/background/script-spend";
import { reservedSet } from "../src/background/spent";
import { SESSION_TRANSFER, TransferService } from "../src/background/transfer";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const SLOW = { timeout: 180_000 };
const v12 = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
/** "This is a test.", a live preprod Seedelf the phrase doesn't own. */
const THEIRS = transferPreprod.to;

type T = ReturnType<typeof testBalances>;

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

/** The services with WebAssembly's signing stood in for (Rust tests cover it): each transaction as it came. */
function services(t: T) {
  const wasm = loadTestWasm();
  const deps = {
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    wallet: t.wallet,
    session: t.session,
    koios: () => new Koios("https://preprod.koios.rest/api/v1", t.koios.fetch, async () => undefined),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    now: () => t.clock.now,
    coins: t.coins,
    store: t.store,
  };
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return { deps, transfer: new TransferService(deps), parts: new PartsService(deps) };
}

/** The least ADA a bundle of 20 tokens needs: what a payment of exactly them carries, as the review says it. */
async function bundleLeast(): Promise<string> {
  const t = testBalances({ owned: false });
  await t.wallet.create(v12.phrase, PASSWORD);
  t.koios.added.push(bigAda(), bundle(0, "20000000"));
  const { transfer } = services(t);
  const tokens = bundle(0, "0").asset_list!.map((a) => ({ policyId: a.policy_id, assetName: a.asset_name, quantity: a.quantity }));
  const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
  return summary.payments[0]!.minimum!;
}

/** Test wallet A's shape: `n` bundles at exactly their least, and the one big UTxO of ADA. */
async function walletA(n: number): Promise<{ t: T; tokens: Array<{ policyId: string; assetName: string; quantity: string }> }> {
  const least = await bundleLeast();
  const t = testBalances({ owned: false });
  await t.wallet.create(v12.phrase, PASSWORD);
  const bundles = Array.from({ length: n }, (_, i) => bundle(i, least));
  t.koios.added.push(bigAda(), ...bundles);
  const tokens = bundles.flatMap((b) => b.asset_list!.map((a) => ({ policyId: a.policy_id, assetName: a.asset_name, quantity: a.quantity })));
  return { t, tokens };
}

const submittedIds = (t: T) => t.koios.submitted.map((b) => txIdOf(b));

describe("a payment whose later parts have no ADA of their own (1.6.0, item 10b)", SLOW, () => {
  it("chains them on review, sends what pays its own way, and each of the rest once the one before shows", async () => {
    // A's own: 20 bundles, three parts.
    const { t, tokens } = await walletA(20);
    const { transfer, parts, deps } = services(t);
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    expect(all.length).toBe(3);
    // The first pays its own way; every one after it spends what the one before carried forward.
    expect(all[0]!.waits).toBeUndefined();
    expect(all.slice(1).every((p) => p.waits)).toBe(true);
    expect(summary.payments[0]!.tokens).toHaveLength(400);

    const sent = await transfer.submit("preprod", summary.txHash);
    // Only the first went: the rest wait for it to be in a block, kept apart from Send's own keys.
    expect(submittedIds(t)).toEqual([all[0]!.txHash]);
    expect(sent).toMatchObject({ txHash: all[0]!.txHash, chain: { first: all[0]!.txHash, total: all.length }, parts: { sent: 1, total: all.length } });
    for (const [i, p] of all.entries()) {
      if (i === 0) continue;
      expect(await t.session.get(partKey(SESSION_TRANSFER, i))).toBeUndefined();
      expect(await t.session.get<{ txHash: string }>(waitingPartKey(p.txHash))).toMatchObject({ txHash: p.txHash });
    }
    // What they spend is reserved: nothing built meanwhile takes it.
    const reserved = await t.wallet.withKeys(() => reservedSet(t.session, "preprod", { sending: true }));
    expect(reserved.inputs.size).toBeGreaterThan(0);
    const { utxos } = await readContract(deps, "preprod");
    expect(utxos.some((u) => reserved.inputs.has(`${u.tx_hash}#${u.tx_index}`))).toBe(false);

    // Its parent isn't on chain yet: nothing goes, and it's still waiting.
    expect(await parts.pump("preprod")).toBe(true);
    expect(submittedIds(t)).toHaveLength(1);
    expect(await parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 1, total: all.length });

    // The first shows, the second doesn't yet: the second goes, and the third, if any, waits for it.
    t.koios.confirmations = 1;
    for (const p of all.slice(1)) t.koios.missing.add(p.txHash);
    t.clock.now += 30_000;
    await parts.pump("preprod");
    expect(submittedIds(t)).toEqual(all.slice(0, 2).map((p) => p.txHash));
    // Watched as the payment's, named by its first.
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: all[1]!.txHash, chain: { first: all[0]!.txHash, total: all.length } });

    // Looked for again no sooner than LOOK_EVERY_MS (Koios's budget): then each shows in turn, every part goes, and
    // nothing is left waiting or reserved.
    t.koios.missing.clear();
    const asked = t.koios.calls.filter((c) => c.path === "tx_status").length;
    await parts.pump("preprod");
    expect(t.koios.calls.filter((c) => c.path === "tx_status")).toHaveLength(asked);
    expect(submittedIds(t)).toHaveLength(2);
    t.clock.now += LOOK_EVERY_MS;
    await parts.pump("preprod");
    expect(submittedIds(t)).toEqual(all.map((p) => p.txHash));
    expect(await parts.pump("preprod")).toBe(false);
    expect(await parts.of("preprod", all[0]!.txHash)).toBeUndefined();
    expect((await t.wallet.withKeys(() => reservedSet(t.session, "preprod", { sending: true }))).inputs.size).toBe(0);
    expect(await t.session.get(SESSION_WAITING_PREFIX + "preprod")).toEqual({});
  });

  it("sends nothing as the wallet unlocks, and a lock leaves the rest unsent, what they'd spend still private", async () => {
    const { t, tokens } = await walletA(12);
    const { transfer, parts } = services(t);
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    await transfer.submit("preprod", summary.txHash);
    t.koios.confirmations = 1;
    // The unlock's run sends nothing (privacy review §3.1).
    expect(await parts.pump("preprod", true)).toBe(true);
    expect(submittedIds(t)).toHaveLength(1);
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    expect(await parts.pump("preprod")).toBe(false);
    expect(submittedIds(t)).toHaveLength(1);
  });

  it("waits a while for giveme.my to see the part before, then stops the rest and says so", async () => {
    const { t, tokens } = await walletA(12);
    const { transfer, parts } = services(t);
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    await transfer.submit("preprod", summary.txHash);
    t.koios.confirmations = 1;
    // giveme.my hasn't seen the part before yet.
    t.collateral.answer = { status: 400, body: { detail: "input not found" } };
    expect(await parts.pump("preprod")).toBe(true);
    expect(submittedIds(t)).toHaveLength(1);
    expect(await parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 1, total: all.length });
    // Still turned away once it should have: the rest stop, freed, and Home says how many didn't go.
    t.clock.now += GIVEME_BEHIND_MS + 1;
    expect(await parts.pump("preprod")).toBe(false);
    expect(await parts.of("preprod", all[0]!.txHash)).toEqual({ sent: 1, total: all.length, stopped: "refused" });
    expect((await t.wallet.withKeys(() => reservedSet(t.session, "preprod", { sending: true }))).inputs.size).toBe(0);
    expect(await t.session.get(waitingPartKey(all[1]!.txHash))).toBeUndefined();
    // Once the watch has let the first go, Home still hears it: landed, and the rest didn't go.
    await t.session.remove(pendingKey("preprod"));
    expect(await parts.shown("preprod")).toMatchObject({
      txHash: all[0]!.txHash,
      confirmations: 1,
      parts: { sent: 1, total: all.length, stopped: "refused" },
    });
  });

  it("stops the rest when the part before never shows, and frees what they'd have spent", async () => {
    const { t, tokens } = await walletA(12);
    const { transfer, parts, deps } = services(t);
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    await transfer.submit("preprod", summary.txHash);
    const held = await t.wallet.withKeys(() => reservedSet(t.session, "preprod", { sending: true }));
    // Sent longer ago than a part is looked for (the clock itself would lock the wallet first).
    const key = SESSION_WAITING_PREFIX + "preprod";
    const waiting = (await t.session.get<Record<string, { at: number }>>(key))!;
    waiting[summary.txHash]!.at -= UNSEEN_AFTER_MS + 1;
    await t.session.set(key, waiting);
    expect(await parts.pump("preprod")).toBe(false);
    expect(await parts.of("preprod", summary.txHash)).toMatchObject({ stopped: "unseen" });
    expect(submittedIds(t)).toHaveLength(1);
    // Nothing is held for parts that will never go: the next review can spend what they would have (1.6.0's review).
    expect((await t.wallet.withKeys(() => reservedSet(t.session, "preprod", { sending: true }))).inputs.size).toBe(0);
    const listed = new Set((await readContract(deps, "preprod")).utxos.map((u) => `${u.tx_hash}#${u.tx_index}`));
    const own = [...held.inputs].filter((o) => !summary.parts!.some((p) => o.startsWith(`${p.txHash}#`)));
    expect(own.length).toBeGreaterThan(0);
    expect(own.filter((o) => !listed.has(o))).toEqual([]);
  });

  it("keeps its waiting parts when the next payment is reviewed under the same keys, which leaves what they spend out", async () => {
    const { t, tokens } = await walletA(12);
    const { transfer, parts } = services(t);
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "0", tokens }]);
    const all = summary.parts!;
    await transfer.submit("preprod", summary.txHash);
    const reserved = await t.wallet.withKeys(() => reservedSet(t.session, "preprod", { sending: true }));
    // More ADA arrives, and another payment is reviewed: it spends none of what the waiting parts will.
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "be".repeat(32), value: "50000000" });
    await transfer.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
    const next = await t.session.get<{ txCbor: string }>(partKey(SESSION_TRANSFER, 0));
    expect(txInputs(Uint8Array.from(Buffer.from(next!.txCbor, "hex"))).some((o) => reserved.inputs.has(o))).toBe(false);
    expect(await t.session.get<{ txHash: string }>(waitingPartKey(all[1]!.txHash))).toMatchObject({ txHash: all[1]!.txHash });
    t.koios.confirmations = 1;
    await parts.pump("preprod");
    expect(submittedIds(t)).toEqual(all.map((p) => p.txHash));
  });
});
