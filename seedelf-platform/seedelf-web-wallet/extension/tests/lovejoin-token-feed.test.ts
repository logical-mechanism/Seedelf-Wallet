// Lovejoin's token pools as mainnet reads them, with the data layer up (1.6.0's release review): a chain's steps in
// a token pool are looked for on the token pools' feed (lovejoin/tokens/since), never on the classic pool's, which
// doesn't list them, and never named to tx_status (DATA-1 = PRIV-1); and the reads documented as asking nobody ask
// nobody (PRIV-4 = STATE-6 = UI-8). The data layer's client is the same on any network, so it's pointed at
// preprod's fixtures: PR #163's preprod token pool (2 ₳ and LJTEST a box) stands in for any token pool.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { DataParts } from "../src/background/data-layer";
import { noteCursor } from "../src/background/feed";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { PendingService } from "../src/background/pending";
import { privateIndexClient, type IndexRow } from "../src/background/private-index";
import { SessionService } from "../src/background/sessions";
import { NETWORKS } from "../src/networks";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { fakeIndex, indexRowOf, SLOT_TIME, stableSlot, type FakeIndex } from "./fake-index";
import { koiosPreprod, loadTestWasm, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
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
/** The classic pool's `mix_box`. */
const NETWORK_MIX_BOX = NETWORKS.preprod.lovejoin!.mixBox;
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
const ljtest = (quantity: bigint) => ({ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: quantity.toString() });

type T = ReturnType<typeof testBalances>;

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era: a transaction the account signs is valid until a while after it.
  t.koios.tip = 110_000_000;
  return t;
}

/** A register datum: the wallet's, or a stranger's. */
async function datum(t: T, ours: boolean): Promise<string> {
  const wasm = loadTestWasm();
  if (ours) return t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/** A stranger's box in the token pool. */
async function strangerBox(t: T, tx: string): Promise<KoiosUtxo> {
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    datum_hash: null,
    inline_datum: { bytes: await datum(t, false), value: {} },
    asset_list: [{ ...ljtest(Q), decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** One of the recorded account's UTxOs, made again as `tx`'s with `value` and `assets`. */
function atAccount(tx: string, value: string, assets: Array<ReturnType<typeof ljtest>> = []): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1test" })) as never };
}

/**
 * The data layer up: the classic pool and twelve strangers' boxes in the token pool on its feeds, each box with what
 * made it, and whatever the wallet submits landing at once, in the token pool (only lovejoin/tokens lists it).
 * `state.on`: whether the wallet reads it now (a session funded before it's read, say).
 */
async function dataLayer(t: T) {
  const index = fakeIndex();
  const at = index.tip - 100_000;
  const made = (cred: string): IndexRow["made_by"] => ({ mixed: true, inputs: [[cred, null]] });
  index.pool = POOL.map((u) => ({ row: { ...indexRowOf(u, at), made_by: made(NETWORK_MIX_BOX) } }));
  const strangers = await Promise.all(Array.from({ length: 12 }, (_, i) => strangerBox(t, (0x60 + i).toString(16))));
  index.tokens = strangers.map((u) => ({ row: { ...indexRowOf(u, at), made_by: made(VIEW.mixBoxHash) } }));
  index.tokenPools = [VIEW.mixBoxHash];
  const landed = new Set<string>();
  const fetch: FakeIndex["fetch"] = (url) => {
    for (const tx of t.koios.submitted) {
      const id = txIdOf(tx);
      if (landed.has(id)) continue;
      landed.add(id);
      const slot = index.tip - 3;
      const row = { ref: `${id}#0`, address: TOKEN_ADDRESS, lovelace: "2000000", created: { slot, time: slot + SLOT_TIME } };
      // In the token pool (a deposit, a mix), or into a Seedelf (a box brought back): each feed lists what's its.
      index.tokens.push({ row });
      index.contract.push({ row });
    }
    return index.fetch(url);
  };
  const parts = new DataParts(t.session, () => t.clock.now);
  const client = privateIndexClient({ koiosOnly: async () => false, parts, fetch, limits: {} }, () => "https://data.test");
  const state = { on: true };
  /** A box of the wallet's in the token pool, a mix having made it, as the token feed lists it. */
  const ours = async (tx: string) => {
    const box = { ...(await strangerBox(t, tx)), inline_datum: { bytes: await datum(t, true), value: {} } } as KoiosUtxo;
    index.tokens.push({ row: { ...indexRowOf(box, at), made_by: made(VIEW.mixBoxHash) } });
    return box;
  };
  return {
    index,
    parts,
    state,
    ours,
    client: (network: Parameters<typeof client>[0]) => (state.on ? client(network) : Promise.resolve(undefined)),
  };
}

/** Lovejoin reading the classic pool and the token pool through `index`, giveme.my's witness stood in for. */
function pooled(t: T, index: ReturnType<typeof privateIndexClient>, extra: Partial<ConstructorParameters<typeof LovejoinService>[0]> = {}) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
    ...t.deps,
    index,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [TOKEN_POOL],
    random: () => 0.5,
    ...extra,
  });
}

/** The hashes tx_status was asked about. */
const named = (t: T) => t.koios.calls.filter((c) => c.path === "tx_status").flatMap((c) => c.body._tx_hashes as string[]);

describe("a token pool's chain, watched on the data layer's token feed (1.6.0's release review, DATA-1)", SLOW, () => {
  it("sends all of a mix from the public account into a token pool, and Home's banner sees it, naming none of it to tx_status", async () => {
    const t = await wallet();
    const { client } = await dataLayer(t);
    const lj = pooled(t, client);
    t.koios.addedToAccounts.push(atAccount("e1", "3000000", [ljtest(2n * Q)]), atAccount("e5", "5000000"));
    const summary = await lj.publicBuild("preprod", 1, { pool: TOKEN });
    expect(summary).toMatchObject({ pool: TOKEN, boxes: 1 });
    await lj.publicSubmit("preprod", summary.txHash);
    // Were tx_status asked, it would say everything's in: the feed alone must carry the chain.
    t.koios.confirmations = 1;
    let more = true;
    for (let calls = 0; more && calls < 12; calls++) more = await lj.pumpPublic("preprod");
    expect(more).toBe(false);
    const chain = t.koios.submitted.map(txIdOf);
    // A deposit and four mixes: more than the window, so its last went only once the feed showed the first in.
    expect(chain).toHaveLength(5);
    expect(t.koios.submitted.flatMap((tx) => txInputs(tx)).filter((o) => POOL.some((u) => o === `${u.tx_hash}#${u.tx_index}`))).toEqual([]);
    // Home's banner, which watches its last mix, sees it there too.
    const pending = new PendingService({ ...t.deps, index: client });
    expect(await pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: 1 });
    expect(named(t).filter((h) => chain.includes(h))).toEqual([]);
  });

  it("watches a token pool's box brought back on the contract's feed, where it lands, for Home's banner", async () => {
    const t = await wallet();
    const { client, ours } = await dataLayer(t);
    const lj = pooled(t, client);
    const mine = await ours("f1");
    // The wallet's last private reading noted the contract's cursor a minute ago.
    await noteCursor(t.session, "preprod", "contract", `${stableSlot(fakeIndex().tip)}.${"ab".repeat(32)}`, t.clock.now - 60_000, t.clock.now);
    const sent = await lj.withdrawNow("preprod", { txHash: mine.tx_hash, txIndex: 0, pool: TOKEN });
    expect(txInputs(t.koios.submitted.at(-1)!)).toContain(`${mine.tx_hash}#0`);
    t.koios.confirmations = 1;
    const pending = new PendingService({ ...t.deps, index: client });
    expect(await pending.pending("preprod")).toMatchObject({ txHash: sent.txHash, confirmations: 1 });
    expect(named(t)).not.toContain(sent.txHash);
  });

  it("sends all of a mix from the private balance into a token pool, and its session sees each step land", async () => {
    const t = await wallet();
    const { client, state } = await dataLayer(t);
    const lj = pooled(t, client);
    const wasm = loadTestWasm();
    const sessions = new SessionService({
      ...t.deps,
      index: client,
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
    // Funded from the private balance as Koios lists it: the data layer is read from the chain on.
    state.on = false;
    t.koios.added.push({
      ...ownedUtxos[0]!,
      tx_hash: "d1".repeat(32),
      tx_index: 0,
      value: "30000000",
      inline_datum: { bytes: await datum(t, true), value: {} },
      asset_list: [{ ...ljtest(2n * Q), decimals: 0, fingerprint: "asset1ljtest" } as never],
    } as KoiosUtxo);
    t.koios.addedToAccounts.push(...POOL, ...(await Promise.all(Array.from({ length: 12 }, (_, i) => strangerBox(t, (0x60 + i).toString(16))))));
    const out = await sessions.mixOutBuild("preprod", 1, { pool: TOKEN });
    await sessions.mixOutSubmit("preprod", out.txHash);
    const atSession = (tx_index: number, value: string, assets: Array<ReturnType<typeof ljtest>> = []) =>
      ({
        tx_hash: out.txHash,
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
        asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1ljtest" })),
      }) as unknown as KoiosUtxo;
    t.koios.addedToAccounts.push(atSession(0, out.mix.lovelace, [ljtest(Q)]), atSession(1, "5000000"));
    t.koios.confirmations = 1;
    state.on = true;
    const before = t.koios.submitted.length;
    await sessions.advance("preprod", 0, true);
    const chain = t.koios.submitted.slice(before).map(txIdOf);
    // The deposit, one box two waves deep, and the rest back: all of it, past the window.
    expect(chain).toHaveLength(6);
    // The next step reads what landed: every deposit and mix on the token feed.
    await sessions.advance("preprod", 0, true);
    const book = (await t.store.get<{ sessions: Array<{ txs: Array<{ kind: string; txHash: string; confirmed?: boolean }> }> }>("sessions.preprod"))!;
    const steps = book.sessions[0]!.txs.filter((x) => x.kind === "deposit" || x.kind === "mix");
    expect(steps).toHaveLength(5);
    expect(steps.every((x) => x.confirmed)).toBe(true);
    expect(named(t).filter((h) => steps.some((x) => x.txHash === h))).toEqual([]);
  });
});

describe("reads documented as asking nobody (1.6.0's release review, PRIV-4 = STATE-6 = UI-8)", SLOW, () => {
  /** Lovejoin on Koios, counting how often it asks discovery for its list (the data layer's lovejoin/pools on mainnet). */
  function counted(t: T) {
    const asked = { pools: 0 };
    const lj = pooled(t, async () => undefined, {
      pools: async () => {
        asked.pools++;
        return [TOKEN_POOL];
      },
      known: async () => [TOKEN_POOL],
    });
    return { lj, asked };
  }

  it("leaves discovery alone in Home's held() and Activity's pool list: what it last kept, from the device", async () => {
    const t = await wallet();
    const { lj, asked } = counted(t);
    await t.store.set("lovejoin.preprod", { due: [], chains: [], pools: { [TOKEN]: { due: [t.clock.now + 3_600_000] } } });
    const held = await lj.held("preprod");
    expect(held.pools).toMatchObject([{ id: TOKEN, boxes: 1, lovelace: "2000000" }]);
    expect(await lj.mixBoxes("preprod")).toEqual([NETWORK_MIX_BOX, VIEW.mixBoxHash]);
    expect(asked.pools).toBe(0);
    expect(t.koios.calls).toEqual([]);
  });

  it("reads the parameters for the hub's status whether or not the wallet holds a token box: the same reads for everyone", async () => {
    const t = await wallet();
    const { lj } = counted(t);
    t.koios.addedToAccounts.push(...POOL, ...(await Promise.all(Array.from({ length: 12 }, (_, i) => strangerBox(t, (0x60 + i).toString(16))))));
    await lj.status("preprod");
    expect(t.koios.calls.filter((c) => c.path === "epoch_params")).toHaveLength(1);
  });
});

describe("how each chain transaction is watched (1.6.0's release review, DATA-1)", () => {
  it("names the feeds its chain's pools show in: the classic pool's, the token pools', or both across pools", async () => {
    const t = await wallet();
    const { client } = await dataLayer(t);
    const lj = pooled(t, client);
    const h = (x: string) => x.repeat(32);
    const record = (id: string, boxes: number, pools?: Record<string, number>) =>
      lj.recordChain("preprod", {
        progress: `test.${id}`,
        txs: [
          { kind: "deposit", txCbor: "", txHash: h(`${id[0]}0`), fee: "0" },
          { kind: "mix", txCbor: "", txHash: h(id), fee: "0" },
        ],
        leaves: [],
        boxes,
        ...(pools ? { pools } : {}),
        session: 0,
      });
    await record("a1", 2);
    await record("b1", 1, { [TOKEN]: 1 });
    await record("c1", 3, { [TOKEN]: 1 });
    // A pool the read set doesn't have now: named by its id, which no feed's answer covers, so tx_status says.
    const gone = "ee".repeat(28);
    await record("d1", 1, { [gone]: 1 });
    const how = await lj.watchOf("preprod", [h("a1"), h("a0"), h("b1"), h("b0"), h("c1"), h("d1"), h("f9")]);
    expect(how.get(h("a1"))).toEqual({ feed: "lovejoin" });
    expect(how.get(h("a0"))).toEqual({ feed: "lovejoin" });
    expect(how.get(h("b1"))).toEqual({ feed: "tokens", pools: [VIEW.mixBoxHash] });
    expect(how.get(h("b0"))).toEqual({ feed: "tokens", pools: [VIEW.mixBoxHash] });
    expect(how.get(h("c1"))).toEqual({ feed: "lovejoin", pools: [VIEW.mixBoxHash] });
    expect(how.get(h("d1"))).toEqual({ feed: "tokens", pools: [gone] });
    // One no record names: the classic pool's, as before chunk 34.
    expect(how.get(h("f9"))).toEqual({ feed: "lovejoin" });
  });
});
