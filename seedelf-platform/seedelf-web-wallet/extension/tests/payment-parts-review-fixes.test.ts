// 1.6.0's review, a payment in parts: what its review says it ties together, the history each part's change is
// sealed with, and the tokens Max keeps. One transaction's review names the histories it spends together; the parts
// tie everything they spend as one transaction would (privacy.md), so their review names what any two parts spend,
// and a chained part's carry, an output of the part before that doesn't exist at review, has that part's history,
// never none. Through WebAssembly, on the 12-word phrase's register, each UTxO's history stood in for.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios, type KoiosUtxo } from "../src/background/koios";
import { partKey, type Kept } from "../src/background/script-spend";
import { SESSION_TRANSFER, TransferService } from "../src/background/transfer";
import { SESSION_WITHDRAW, WithdrawService } from "../src/background/withdraw";
import { historiesNote, type HistoryClass } from "../src/shared/histories";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const SLOW = { timeout: 300_000 };
const v12 = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
/** The 12-word phrase's own receive address: Make public's. */
const OWN = v12.preprod.receive_0 as string;
/** "This is a test.", a live preprod Seedelf the phrase doesn't own. */
const THEIRS = transferPreprod.to;

type T = ReturnType<typeof testBalances>;

const SESSION_6: HistoryClass = { id: "session:5", origin: "session" };
const ACCOUNT_1: HistoryClass = { id: "public:0", origin: "own" };
const ACCOUNT_2: HistoryClass = { id: "public:1", origin: "own" };

/** The services with WebAssembly's signing stood in for, and each UTxO's history `of` it (activity.ts `classes`). */
function services(t: T, of: (u: KoiosUtxo) => HistoryClass | undefined = () => undefined) {
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
    activity: {
      classes: async (_n: string, utxos: KoiosUtxo[]) =>
        new Map(utxos.flatMap((u) => {
          const c = of(u);
          return c ? [[`${u.tx_hash}#${u.tx_index}`, c] as const] : [];
        })),
    },
  };
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return { transfer: new TransferService(deps as never), withdraw: new WithdrawService(deps as never) };
}

async function empty(): Promise<T> {
  const t = testBalances({ owned: false });
  await t.wallet.create(v12.phrase, PASSWORD);
  return t;
}

/** `count` of the phrase's Seedelf UTxOs holding `lovelace`, their hashes from `prefix`. */
const utxos = (prefix: string, count: number, lovelace: string, asset_list: KoiosUtxo["asset_list"] = []): KoiosUtxo[] =>
  Array.from({ length: count }, (_, i) => ({
    ...ownedUtxos[0]!,
    tx_hash: (prefix + (i + 1).toString(16)).padStart(64, "0"),
    value: lovelace,
    asset_list,
  }));

/** Token `i`: its own policy and a 32-byte name. */
const token = (i: number) => ({
  policy_id: (0xabc00000 + i).toString(16).padStart(56, "0"),
  asset_name: (0x1000 + i).toString(16).padStart(64, "0"),
  quantity: "1000",
  decimals: 0,
  fingerprint: "",
});

/** Bundle `n` of 20 tokens holding `lovelace`, as a move-in leaves them. */
const bundle = (n: number, lovelace: string): KoiosUtxo => ({
  ...ownedUtxos[0]!,
  tx_hash: (0x100 + n).toString(16).padStart(64, "0"),
  value: lovelace,
  asset_list: Array.from({ length: 20 }, (_, k) => token(n * 20 + k)),
});

/** The 409 ₳ private session 6 left: parts that each spend their own can't share it, so they chain. */
const SESSION_TX = "ad".repeat(32);
const bigAda = (): KoiosUtxo => ({ ...ownedUtxos[0]!, tx_hash: SESSION_TX, value: "409000000" });
const tokensOf = (u: KoiosUtxo) => u.asset_list!.map((a) => ({ policyId: a.policy_id, assetName: a.asset_name, quantity: a.quantity }));

/**
 * Test wallet A's shape (payment-parts-chain.test.ts): 20 bundles made private at exactly the least a payment of them
 * carries (`to`, a Seedelf or an address), and session 6's ADA.
 */
async function walletA(to: "seedelf" | "address" = "seedelf"): Promise<{ t: T; bundles: KoiosUtxo[]; of: (u: KoiosUtxo) => HistoryClass }> {
  const probe = await empty();
  probe.koios.added.push(bigAda(), bundle(0, "20000000"));
  const asked = [{ to: to === "seedelf" ? THEIRS : OWN, lovelace: "0", tokens: tokensOf(bundle(0, "0")) }];
  const { transfer, withdraw } = services(probe);
  const least = (await (to === "seedelf" ? transfer.build("preprod", asked) : withdraw.build("preprod", asked))).payments[0]!.minimum!;
  const t = await empty();
  const bundles = Array.from({ length: 20 }, (_, i) => bundle(i, least));
  t.koios.added.push(bigAda(), ...bundles);
  return { t, bundles, of: (u) => (u.tx_hash === SESSION_TX ? SESSION_6 : ACCOUNT_1) };
}

const keptParts = async (t: T, key: string, n: number) =>
  Promise.all(Array.from({ length: n }, (_, i) => t.session.get<Kept & { histories?: HistoryClass[] }>(partKey(key, i))));

describe("a chained part's carry (1.6.0 review: carry-has-no-history)", SLOW, () => {
  it("has the history of what the part before spent: the review names no unknown money, and each change is sealed so", async () => {
    const { t, bundles, of } = await walletA();
    const { transfer } = services(t, of);
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: "100000000", tokens: bundles.flatMap(tokensOf) }]);
    const all = summary.parts!;
    expect(all.slice(1).some((p) => p.waits)).toBe(true);
    expect(summary.histories?.map((c) => c.id).sort()).toEqual(["public:0", "session:5"]);
    expect(historiesNote(summary.histories)).not.toContain("no history");
    // Each part's change has what paid for it, the carry's included: the last ends with session 6's ADA.
    const kept = await keptParts(t, SESSION_TRANSFER, all.length);
    expect(kept.map((k) => k?.origin)).toEqual(all.map(() => ({ id: "public:0+session:5", origin: "session" })));
  });

  it("is read so in Make public's parts too", async () => {
    const { t, bundles, of } = await walletA("address");
    const { withdraw } = services(t, of);
    const summary = await withdraw.build("preprod", [{ to: OWN, lovelace: "0", tokens: bundles.flatMap(tokensOf) }]);
    const all = summary.parts!;
    expect(all.slice(1).some((p) => p.waits)).toBe(true);
    expect(summary.histories?.map((c) => c.id).sort()).toEqual(["public:0", "session:5"]);
    const kept = await keptParts(t, SESSION_WITHDRAW, all.length);
    expect(kept.every((k) => !k?.origin?.id.includes("unknown"))).toBe(true);
    expect(kept.at(-1)?.origin).toEqual({ id: "public:0+session:5", origin: "session" });
  });
});

describe("a review in parts (1.6.0 review: parts-review-misses-cross-part-ties)", SLOW, () => {
  it("names the histories different parts tie together, though each part spends one", async () => {
    const t = await empty();
    const one = utxos("e", 25, "10000000");
    const two = utxos("f", 25, "15000000");
    t.koios.added.push(...one, ...two);
    const { withdraw } = services(t, (u) => (two.some((v) => v.tx_hash === u.tx_hash) ? ACCOUNT_2 : ACCOUNT_1));
    const summary = await withdraw.build("preprod", [{ to: OWN, lovelace: "400000000", tokens: [] }]);
    expect(summary.parts?.length).toBeGreaterThan(1);
    expect(summary.histories?.map((c) => c.id).sort()).toEqual(["public:0", "public:1"]);
    expect(historiesNote(summary.histories)).toContain("accounts 1 and 2");
  });

  it("names the account's money Max spends beside boxes back from Lovejoin", async () => {
    const t = await empty();
    const boxes = utxos("1", 20, "20000000");
    const own = utxos("2", 20, "10000000");
    t.koios.added.push(...boxes, ...own);
    const { withdraw } = services(t, (u) =>
      boxes.some((b) => b.tx_hash === u.tx_hash) ? { id: `box:${u.tx_hash}`, origin: "lovejoin" } : ACCOUNT_1,
    );
    const summary = await withdraw.build("preprod", [{ to: OWN, lovelace: null, tokens: [] }]);
    expect(summary.parts?.length).toBeGreaterThan(1);
    expect(summary.histories?.map((c) => c.id)).toContain("public:0");
    expect(historiesNote(summary.histories, { max: true })).toContain("money you made private");
  });
});

describe("Max in parts (1.6.0 review: max-kept-tokens-overcount)", SLOW, () => {
  it("counts a token it keeps once, however many parts keep some", async () => {
    const t = await empty();
    const min = { policy_id: "abc0".padEnd(56, "0"), asset_name: "4d494e", quantity: "100000000", decimals: 0, fingerprint: "" };
    t.koios.added.push(...utxos("c", 42, "4500000", [min]));
    const { transfer } = services(t);
    const summary = await transfer.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(summary.parts?.length).toBeGreaterThan(1);
    expect(summary).toMatchObject({ max: true, changeTokens: 1 });
  });
});
