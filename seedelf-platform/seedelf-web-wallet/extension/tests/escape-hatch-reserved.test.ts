// Chunk 51, gap-g2#2: the escape hatch's question and the worker's pick disagreed while a kept review reserved the
// boxes of the account on screen. In a token pool whose boxes can't pay their own way back, Bring one back names
// another public account only where every box it can take is that account's (hatchAccountOf, 1.6.0's release review
// R3-3), and the worker takes the account on screen's own first (hatchOrder). A public Mix again's review, built and
// left with Back, keeps the account's boxes reserved for Send for ten minutes (BUILT_TTL_MS). The worker left those
// boxes out (free(…, reserved)), but the page's status still listed them, so the question named nobody and the worker
// took the other account's box, paid by the account on screen. privacy.md: "another account's only where nothing else
// is, the lowest first, and its question then names that account".
//
// The fix, as the re-check amended it: (b) status hands the page the boxes a reservation holds, and the question
// leaves them out, so it names the other account; (a) the request carries the account its question named, and a pick
// that would tie one it didn't name is asked again, never sent. With the real WebAssembly and PR #163's preprod token
// pool's v2 twin, as the verifier's test had them (lovejoin-crediting-review-fixes.test.ts's R3-3 case is this one
// with no reservation).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { AskAgainError, LovejoinService, SESSION_LOVEJOIN_PUBLIC, type PoolRef } from "../src/background/lovejoin";
import { SESSION_RESERVED_PREFIX, type Reservation } from "../src/background/spent";
import { hatchAccountOf, hatchRequest } from "../src/ui/screens/Lovejoin";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** A real public chain and a real withdraw, built and measured in WebAssembly. */
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

type T = ReturnType<typeof testBalances>;

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const at = (tx: string, i: number) => ({ txHash: tx, txIndex: i, pool: TOKEN });

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

/** A register datum: the wallet's, or a stranger's. */
async function datum(t: T, ours: boolean): Promise<string> {
  const wasm = loadTestWasm();
  if (ours) return t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const hex = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return hex;
}

/** A box in the token pool, the wallet's or a stranger's, made `hours` ago by a mix there, as Koios would say. */
async function tokenBox(t: T, tx: string, ours = true, hours = 5): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: await datum(t, ours), value: {} },
    asset_list: [{ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: VIEW.token.quantity, decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** Twelve strangers' boxes in the token pool: enough for one box two waves deep. */
const strangers = (t: T) => Promise.all(Array.from({ length: 12 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));

/** One of the recorded account's (account 0's) UTxOs, made again as `tx`'s with `value` and no token. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] } as KoiosUtxo;
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

describe("the escape hatch while a kept public Mix again holds the account on screen's own boxes (chunk 51, gap-g2#2)", SLOW, () => {
  it("names the account whose box it takes, and never pays for one its question didn't name", async () => {
    const t = testBalances({ owned: false });
    await t.wallet.create(PHRASE, PASSWORD);
    t.koios.evaluation = AGREES;
    t.koios.tip = 110_000_000;
    // The token pool's boxes can't pay their own way back (lovejoin-crediting-review-fixes.test.ts's stuckPool).
    t.koios.params = { coins_per_utxo_size: "4800" };
    const [a0, a1, c0, c1] = ["a0", "a1", "c0", "c1"].map((x) => x.repeat(32)) as [string, string, string, string];
    // Account 0, on screen: a 5 ₳ collateral and 60 ₳ of ADA alone beside the fixture's own UTxOs. Account 1's mix
    // left its box a1 in the pool, account 0's its box c1.
    t.koios.addedToAccounts.push(
      atAccount("e5", "5000000"),
      atAccount("e6", "60000000"),
      ...POOL,
      await tokenBox(t, "a1", true, 9),
      await tokenBox(t, "c1", true, 5),
      ...(await strangers(t)),
    );
    const lj = pooled(t);
    await publicMix(lj, 1, a0, [a1]);
    await publicMix(lj, 0, c0, [c1]);

    // Before any review: the pool is stuck, a1 is account 1's, and the question rightly names nobody, since the worker
    // takes c1, account 0's own (the R3-3 case).
    const before = (await lj.status("preprod")).pools!.find((p) => p.id === TOKEN)!;
    expect(before.cantComeBack).toBeDefined();
    expect(before.otherAccounts).toEqual([{ ...at(a1, 0), account: 1 }]);
    expect(before.reserved).toBeUndefined();
    expect(hatchAccountOf(before)).toBeUndefined();

    // Mix again from my public account, reviewed, then Back: kept for Send, and its reservation holds c1 for ten
    // minutes.
    expect(await lj.publicAgainBuild("preprod", TOKEN)).toMatchObject({ again: true, boxes: 1, owned: 1, pool: TOKEN });
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const reviewSpends = kept!.chain.flatMap((c) => txInputs(bytes(c.txCbor)));
    expect(reviewSpends).toContain(`${c1}#0`);
    expect(reviewSpends).not.toContain(`${a1}#0`);
    const reserved = await t.wallet.withKeys(() => t.session.get<Record<string, Reservation>>(`${SESSION_RESERVED_PREFIX}preprod`));
    expect(reserved?.public?.inputs).toContain(`${c1}#0`);

    // A minute on, still within the ten: the page's status says c1 is held, so the question names account 1, whose box
    // is the only one the worker can take (b).
    t.clock.now += 60_000;
    const page = (await lj.status("preprod")).pools!.find((p) => p.id === TOKEN)!;
    expect(page.boxes.map((b) => `${b.txHash}#${b.txIndex}`)).toContain(`${c1}#0`);
    expect(page.reserved).toEqual([at(c1, 0)]);
    expect(hatchAccountOf(page)).toBe(1);
    expect(hatchRequest(page, true)).toEqual({ pool: TOKEN, paid: true, account: 1 });

    // A press whose question named nobody, from a read made before the review (a): asked again, nothing sent.
    const sent = t.koios.submitted.length;
    await expect(lj.withdrawNow("preprod", undefined, false, true, TOKEN)).rejects.toBeInstanceOf(AskAgainError);
    expect(t.koios.submitted.length).toBe(sent);

    // Pay from my public account, after the question that named account 1: a1 comes back, paid from account 0, as it
    // said.
    await lj.withdrawNow("preprod", undefined, false, true, TOKEN, 1);
    const spent = txInputs(t.koios.submitted.at(-1)!);
    expect(spent).toContain(`${a1}#0`);
    expect(spent).not.toContain(`${c1}#0`);
  });
});
