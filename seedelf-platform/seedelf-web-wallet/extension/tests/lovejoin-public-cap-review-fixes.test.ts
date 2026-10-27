// 1.6.0's review of the fixes, R3-14: the public Mix form's stepper in a token pool offers as many boxes as WebAssembly's
// chain (chain_from_account_at) picks the account's UTxOs to pay for: the fewest holding the pool's token that hold
// the boxes' worth, the most first, less the least ADA of the output the tokens they hold beyond that go back in. It
// counted the ADA of every UTxO holding the token, and none of that output, so it offered boxes the build refused.
// With the real WebAssembly, the recorded public account, and PR #163's preprod token pool (2 ₳ and LJTEST a box), as
// lovejoin-flows.test.ts has them.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import * as LovejoinScreen from "../src/ui/screens/Lovejoin";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const { mixOffer, publicSideOf } = LovejoinScreen;

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Real chains are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 300_000 };

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
  boxLovelace: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN = VIEW.id;
const Q = BigInt(VIEW.token.quantity);
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));
/** A box's token, as the page has it (pool.box.token). */
const BOX_TOKEN = VIEW.token;

/**
 * The least ADA of the output that gives back Q of LJTEST to the account's own base address, as core prices it
 * (minimum_address_payment): 160 bytes and its own 116 at 4,310 lovelace a byte. A map of the 57-byte address and its
 * value, 5 ₳ staged and the one token: 68 bytes, and 48 for the token, whose six-byte name and 1e16 take 7 and 9.
 */
const LEAST_Q = (160n + 116n) * 4_310n;

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

type T = ReturnType<typeof testBalances>;

/** Lovejoin reading the classic pool and the token pool, giveme.my's witness stood in for. */
function pooled(t: T): LovejoinService {
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
    pools: async () => [TOKEN_POOL],
    random: () => 0.5,
  });
}

/** One of the recorded account's UTxOs, made again as `tx`'s with `value` and `assets`. */
function atAccount(tx: string, value: string, assets: Array<{ policy_id: string; asset_name: string; quantity: string }> = []): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return {
    ...first!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    value,
    asset_list: assets.map((a) => ({ ...a, decimals: 0, fingerprint: "asset1test" })) as never,
  };
}

const ljtest = (quantity: bigint) => ({ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: quantity.toString() });

/** A stranger's box in the token pool, a mix having moved it five hours ago. */
function strangerBox(t: T, n: number): KoiosUtxo {
  const wasm = loadTestWasm();
  const tx = (0x60 + n).toString(16).repeat(32);
  t.koios.txSpends.set(tx, [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const datum = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return {
    ...POOL[0]!,
    tx_hash: tx,
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: VIEW.boxLovelace,
    block_time: Math.floor(t.clock.now / 1000) - 5 * 3600,
    datum_hash: null,
    inline_datum: { bytes: datum, value: {} },
    asset_list: [{ ...ljtest(Q), decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/**
 * The recorded public account, Lovejoin one wave deep, with A (three boxes' worth of LJTEST beside `ada`), B (half a
 * box's worth beside 20 ₳, which a pick of three boxes or fewer never takes) and 3 ₳ of ADA alone, the UTxOs of ADA
 * alone it was recorded with kept out of payments; and twelve strangers' boxes in the token pool: room for six boxes.
 * What the page has of it: the UTxOs and Home's figure.
 */
async function account(ada: bigint) {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era: a transaction the account signs is valid until a while after it.
  t.koios.tip = 110_000_000;
  await t.deps.preferences.set({ lovejoinDepth: 1 });
  const lj = pooled(t);
  const ours = ["e1", "e2", "e3", "e5"].map((tx) => tx.repeat(32));
  t.koios.addedToAccounts.push(
    atAccount("e1", ada.toString(), [ljtest(3n * Q)]),
    atAccount("e2", "20000000", [ljtest(Q / 2n)]),
    atAccount("e3", "3000000"),
    // Its collateral, which every mix puts up.
    atAccount("e5", "5000000"),
    ...POOL,
    ...Array.from({ length: 12 }, (_, i) => strangerBox(t, i)),
  );
  const home = (await t.balances.get("preprod")).cardano;
  let { cardano: utxos } = await t.coins.lists("preprod");
  for (const u of utxos.filter((u) => !u.tokens.length && !u.collateral && !u.locked && !ours.includes(u.txHash))) {
    ({ cardano: utxos } = await t.coins.setLocked("preprod", "cardano", `${u.txHash}#${u.index}`, true));
  }
  return { lj, utxos, home };
}

describe("the public Mix form in a token pool offers what the chain's pick pays for (1.6.0's review of the fixes, R3-14)", SLOW, () => {
  it("offers two boxes where A's ADA pays the chain's pick of two exactly, the most building and one more refused; one lovelace less, one", async () => {
    const probe = await account(5_000_000n);
    const funding = await probe.lj.funding("preprod", 2, false, undefined, TOKEN);
    expect(funding.depth).toBe(1);
    // What the account's UTxOs of ADA alone hold that a mix can spend: never its collateral or one holding a token.
    const alone = probe.utxos.filter((u) => !u.locked && !u.collateral && !u.unspendable && !u.tokens.length).reduce((sum, u) => sum + BigInt(u.lovelace), 0n);
    // Two boxes take 2Q, so the chain picks A alone and gives Q back in an output of its own, whose least it adds: A's
    // ADA at which it pays them exactly.
    const exact = BigInt(funding.lovelace) + LEAST_Q - alone;
    const offered = async (ada: bigint) => {
      const { lj, utxos, home } = await account(ada);
      const side = publicSideOf(home, utxos, BOX_TOKEN, 1).side;
      return { lj, most: mixOffer("public", side, BOX_TOKEN, funding, BigInt(VIEW.boxLovelace), 10, 1, 0n, utxos).most };
    };

    const at = await offered(exact);
    expect(at.most).toBe(2);
    expect((await at.lj.publicBuild("preprod", 2, { pool: TOKEN })).boxes).toBe(2);
    // Three take A whole, nothing back, and B's 20 ₳ never: refused, and not offered.
    await expect((await account(exact)).lj.publicBuild("preprod", 3, { pool: TOKEN })).rejects.toThrow("doesn't pay for 3 boxes");

    const below = await offered(exact - 1n);
    expect(below.most).toBe(1);
    await expect(below.lj.publicBuild("preprod", 2, { pool: TOKEN })).rejects.toThrow("doesn't pay for 2 boxes");
    expect((await (await account(exact - 1n)).lj.publicBuild("preprod", 1, { pool: TOKEN })).boxes).toBe(1);
  });
});
