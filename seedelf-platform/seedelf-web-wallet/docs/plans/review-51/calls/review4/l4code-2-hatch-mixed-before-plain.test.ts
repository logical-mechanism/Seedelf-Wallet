// Chunk 51, round four's last look, l4code#2: the escape hatch's private payer (lovejoin.ts withdrawOne, paid
// "private") ranks a box the wallet knows is mixed (origin mixed) level with a plain box:<tx> (`knownBox` gives both 0,
// `another` both 0), then takes the smaller. A plain box:<tx> is how 1.9.1 sealed every way back the private balance
// didn't pay and no public account tied: a private session's unmixed seed brought back by Bring every box back now or
// the retired pools' run, and a box someone else put in under the wallet's key, among them (1.9.1's withdrawOne wrote
// no origin, its settle `tiedOrigin` none with nothing tied, and classOf reads that as boxFrom). Since round four core's
// Fund and Pay take the mixed box first (l3rank#3), and Mint always has: the hatch still flips on a few hundred
// lovelace.
//
// Driven end to end through the worker's services with the real WebAssembly: P, a way back as 1.9.1 kept it; X, a box
// another's mix moved, brought back after the update and marked mixed; both landed, P 300 lovelace smaller and then
// larger; then the token pool's box, stuck under the fees, paid from the private balance.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { boxFrom, type HistoryClass } from "../src/shared/histories";
import type { PendingTx } from "../src/shared/rpc";
import { CHAINS, POOL, withSession, type Tested } from "./chain-fixtures";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, madeByMix, ownedUtxos } from "./fakes";
import { ADA_POOL, ownDatum } from "./v2-pools";

const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
const inClassic = (txHash: string) => ({ txHash, txIndex: 0 });
const mixed = (w: string): HistoryClass => ({ id: `box:${w}`, origin: "mixed" });

/** PR #163's token pool, its scripts derived on v2 (wasm/tests/fixtures), as escape-hatch-unplaced-box.test.ts reads it. */
const FOUND_V2 = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const TOKEN_POOL: PoolRef = { reference: FOUND_V2.reference, seed: FOUND_V2.seed, scripts: FOUND_V2.scripts };
const VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: TOKEN_POOL }))) as {
  id: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN = VIEW.id;
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));
const ljtest = { policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: VIEW.token.quantity };

type Entry = { txHash: string; kind: string; lovelace: string; origin?: HistoryClass };
const entryOf = async (t: Tested, txHash: string) =>
  (await t.store.get<{ entries: Entry[] }>("history.preprod"))!.entries.find((e) => e.txHash === txHash);

/** A UTxO of the wallet's at the Seedelf contract, `txHash#0`, under a fresh re-randomization of its register. */
async function privateRow(t: Tested, txHash: string, lovelace: string): Promise<KoiosUtxo> {
  return { ...ownedUtxos[0]!, tx_hash: txHash, tx_index: 0, value: lovelace, asset_list: [], inline_datum: { bytes: await ownDatum(t.wallet), value: null }, block_height: 9_000_001 };
}

/** A box of the wallet's in the token pool, a mix there having moved it `hours` ago. */
async function tokenBox(t: Tested, tx: string, datum: string, hours = 7): Promise<KoiosUtxo> {
  t.koios.txSpends.set(hash(tx), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: hash(tx),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: datum, value: {} },
    asset_list: [{ ...ljtest, decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** Lovejoin reading the classic pool, v2's 5 ₳ pool and the token pool; giveme.my and the one-time key stood in for. */
function lovejoin(t: Tested) {
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
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [ADA_POOL, TOKEN_POOL],
    sessionIndices: async () => [0],
  });
}

/**
 * P: a way back as 1.9.1 kept it, a lovejoin-withdraw entry with no origin (a session's unmixed seed its Bring every
 * box back now brought back, say). X: a box another's mix moved, brought back now, marked mixed. Both landed, P 300
 * lovelace smaller (`pSmaller`) or larger. Then the wallet's token pool box, stuck under the fees.
 */
async function plainAndMixedThenStuck(pSmaller: boolean) {
  const { t } = await withSession("40000000");
  await t.balances.get("preprod");
  const X = hash("9a");
  madeByMix(t.koios, X);
  t.koios.addedToAccounts.push(...POOL, {
    ...POOL[0]!,
    tx_hash: X,
    tx_index: 0,
    block_time: Math.floor(t.clock.now / 1000) - 7 * 3600,
    inline_datum: { bytes: await ownDatum(t.wallet), value: {} },
  } as KoiosUtxo);
  const lj = lovejoin(t);
  await lj.status("preprod");
  const wx = await lj.withdrawNow("preprod", inClassic(X));
  const ex = (await entryOf(t, wx.txHash))!;
  expect(ex.origin, "the mixed box's way back").toEqual(mixed(wx.txHash));

  // P, as 1.9.1's settle wrote a way back the box paid for itself, nothing tied (`tiedOrigin` gave no origin).
  const P = hash("5e");
  const pLovelace = (BigInt(ex.lovelace) + (pSmaller ? -300n : 300n)).toString();
  const back: PendingTx = { kind: "lovejoin-withdraw", network: "preprod", txHash: P, submittedAt: t.clock.now - 3 * 86_400_000, confirmations: null };
  await t.activity.sent("preprod", back, { lovelace: pLovelace });
  expect((await entryOf(t, P))?.origin, "1.9.1 kept no origin").toBeUndefined();

  const [rp, rx] = [await privateRow(t, P, pLovelace), await privateRow(t, wx.txHash, ex.lovelace)];
  t.koios.added.push(rp, rx);
  t.clock.now += 60_000;
  await t.balances.get("preprod", true);
  const classes = await t.activity.classes("preprod", [rp, rx]);
  expect(classes.get(`${P}#0`), "P reads as a plain box").toEqual(boxFrom(P));
  expect(classes.get(`${rx.tx_hash}#0`), "X reads as mixed").toEqual(mixed(wx.txHash));

  const B2 = await tokenBox(t, "f1", await ownDatum(t.wallet));
  t.koios.addedToAccounts.push(B2);
  t.koios.params = { coins_per_utxo_size: "4800" };
  // A fresh worker instance, as after a restart: what a pool's way back costs is measured once an epoch per instance.
  return { t, lj: lovejoin(t), p: `${P}#0`, x: `${rx.tx_hash}#0`, B2, sizes: `P ${rp.value}, X ${rx.value}` };
}

const which = (spent: string[], p: string, x: string) =>
  spent.includes(p) && !spent.includes(x) ? "P" : spent.includes(x) && !spent.includes(p) ? "X" : JSON.stringify(spent);

describe("the escape hatch's private payer takes a box the wallet knows is mixed before a 1.9.1 plain box (chunk 51, l4code#2)", CHAINS, () => {
  it("Bring one back's question, paid from the private balance (the default)", async () => {
    const picks: string[] = [];
    for (const pSmaller of [true, false]) {
      const { t, lj, p, x, B2, sizes } = await plainAndMixedThenStuck(pSmaller);
      const stuck = (await lj.status("preprod")).pools!.find((q) => q.id === TOKEN)!;
      expect(stuck.cantComeBack, "the token pool's boxes can't pay their own way back").toBeTruthy();
      const pending = await lj.withdrawNow("preprod", { txHash: B2.tx_hash, txIndex: 0, pool: TOKEN }, false, "private");
      const inputs = txInputs(t.koios.submitted.find((b) => txIdOf(b) === pending.txHash)!);
      expect(inputs).toContain(`${B2.tx_hash}#0`);
      picks.push(`${pSmaller ? "P smaller" : "X smaller"} (${sizes}): spent ${which(inputs, p, x)}`);
    }
    expect(picks.map((s) => s.replace(/ \(.*\)/, "")), picks.join("; ")).toEqual(["P smaller: spent X", "X smaller: spent X"]);
  });

  it("Bring every box back now's stuck path (paid: private)", async () => {
    const picks: string[] = [];
    for (const pSmaller of [true, false]) {
      const { t, lj, p, x, B2, sizes } = await plainAndMixedThenStuck(pSmaller);
      await lj.bringAllBack("preprod");
      const sent = await lj.withdrawDue("preprod");
      const back = sent.find((q) => txInputs(t.koios.submitted.find((b) => txIdOf(b) === q.txHash)!).includes(`${B2.tx_hash}#0`));
      expect(back, `sent ${JSON.stringify(sent.map((q) => q.txHash))}`).toBeDefined();
      const inputs = txInputs(t.koios.submitted.find((b) => txIdOf(b) === back!.txHash)!);
      picks.push(`${pSmaller ? "P smaller" : "X smaller"} (${sizes}): spent ${which(inputs, p, x)}`);
    }
    expect(picks.map((s) => s.replace(/ \(.*\)/, "")), picks.join("; ")).toEqual(["P smaller: spent X", "X smaller: spent X"]);
  });
});
