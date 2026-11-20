// Chunk 51, round three's last look, l3time#3 and l3still#2: the escape hatch's private payer (lovejoin.ts withdrawOne,
// paid "private") took first any UTxO whose class reads origin lovejoin or mixed. Round three classes the way back of a
// box someone else put in under the wallet's key (a register copied as found, d = 1) as box:<w>+unknown:<w>, origin
// lovejoin, so the payer took it beside the boxes whose making the wallet knows, smallest first. A stuck token box's way
// back then spent a UTxO anyone can tie to Seedelf S1, where a box a mix moved was there to pay. It takes the boxes the
// wallet knows first now, and a box of unknown making with the rest (shared/histories.ts `knownBox`).
//
// Driven end to end through the worker's services with the real WebAssembly: Mallory's box planted and brought back
// anyway, a box another's mix moved brought back, both landing, then the token pool's box paid from the private balance.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import {
  boxFrom,
  knownBox,
  merged,
  mixedBox,
  receivedIn,
  sessionClass,
  UNKNOWN,
  unplacedBox,
  type HistoryClass,
} from "../src/shared/histories";
import { CHAINS, POOL, withSession, type Tested } from "./chain-fixtures";
import { bech32, preprodAddress } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, madeByMix, ownedUtxos } from "./fakes";
import { ADA, ADA_POOL, adaBox, ownDatum } from "./v2-pools";

const hash = (h: string) => (h.length === 64 ? h : h.repeat(32));
const ref = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;
const inAda = (txHash: string, txIndex = 0) => ({ txHash, txIndex, pool: ADA });
const inClassic = (txHash: string) => ({ txHash, txIndex: 0 });
const paidBy = (cred: string) => [{ payment_addr: { bech32: preprodAddress(cred), cred } }];
const unplaced = (w: string): HistoryClass => ({ id: `box:${w}+unknown:${w}`, origin: "lovejoin" });
const mixed = (w: string): HistoryClass => ({ id: `box:${w}`, origin: "mixed" });

/** PR #163's token pool, its scripts derived on v2 (wasm/tests/fixtures), as lovejoin-merged-review.test.ts reads it. */
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

/** A box of the wallet's in the token pool, a mix there having moved it `hours` ago (lovejoin-merged-review's tokenBox). */
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
 * Mallory's 5 ₳ box under S1's register as found (d = 1), brought back anyway; a 10 ₳ box of the wallet's another's mix
 * moved in the classic pool, brought back; both ways back landed. Then the token pool's box, stuck under the fees.
 */
async function twoWaysBackThenStuck() {
  const { t } = await withSession("40000000");
  await t.balances.get("preprod");
  const s1 = ownedUtxos.find((u) => (u.asset_list ?? []).some((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId))!;
  const C = hash("c9");
  t.koios.addedToAccounts.push(adaBox(C, s1.inline_datum!.bytes, t.clock.now));
  t.koios.txSpends.set(C, paidBy("ee".repeat(28)));
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
  const pool = (await lj.status("preprod")).pools!.find((p) => p.id === ADA)!;
  expect((pool.someoneElse ?? []).map(ref)).toEqual([ref(inAda(C))]);

  // Bring one back anyway, on Mallory's box: its withdraw spends a box carrying S1's register byte for byte.
  const w1 = await lj.withdrawNow("preprod", inAda(C), true);
  const e1 = (await entryOf(t, w1.txHash))!;
  expect(txInputs(t.koios.submitted.find((b) => txIdOf(b) === w1.txHash)!)).toContain(`${C}#0`);
  expect(e1.origin, "Mallory's box's way back").toEqual(unplaced(w1.txHash));
  // A box another's mix moved, its making asked of and told: marked as one a mix moved.
  const wx = await lj.withdrawNow("preprod", inClassic(X));
  const ex = (await entryOf(t, wx.txHash))!;
  expect(ex.origin, "the mixed box's way back").toEqual(mixed(wx.txHash));

  const [r1, rx] = [await privateRow(t, w1.txHash, e1.lovelace), await privateRow(t, wx.txHash, ex.lovelace)];
  expect(BigInt(r1.value) < BigInt(rx.value), "Mallory's way back is the smaller").toBe(true);
  t.koios.added.push(r1, rx);
  t.clock.now += 60_000;
  await t.balances.get("preprod", true);
  const classes = await t.activity.classes("preprod", [r1, rx]);
  expect(classes.get(`${r1.tx_hash}#0`)).toEqual(unplaced(w1.txHash));
  expect(classes.get(`${rx.tx_hash}#0`)).toEqual(mixed(wx.txHash));

  // Later: the wallet's box in the token pool, which can't pay its own way back under the fees.
  const B2 = await tokenBox(t, "f1", await ownDatum(t.wallet));
  t.koios.addedToAccounts.push(B2);
  t.koios.params = { coins_per_utxo_size: "4800" };
  // A fresh worker instance, as after a restart: what a pool's way back costs is measured once an epoch per instance.
  return { t, lj: lovejoin(t), r1, rx, B2 };
}

describe("the escape hatch's private payer and a box of unknown making (chunk 51, l3time#3, l3still#2)", CHAINS, () => {
  it("a stuck token box's way back, paid from the private balance (the default), takes the box a mix moved, never Mallory's", async () => {
    const { t, lj, r1, rx, B2 } = await twoWaysBackThenStuck();
    const stuck = (await lj.status("preprod")).pools!.find((p) => p.id === TOKEN)!;
    expect(stuck.cantComeBack, "the token pool's boxes can't pay their own way back").toBeTruthy();
    const pending = await lj.withdrawNow("preprod", { txHash: B2.tx_hash, txIndex: 0, pool: TOKEN }, false, "private");
    const inputs = txInputs(t.koios.submitted.find((b) => txIdOf(b) === pending.txHash)!);
    expect(inputs).toContain(`${B2.tx_hash}#0`);
    expect(
      inputs,
      `spent ${JSON.stringify(inputs)}: ${r1.tx_hash}#0 (${r1.value}) is the way back of a box carrying S1's register, ${rx.tx_hash}#0 (${rx.value}) a mixed box's`,
    ).not.toContain(`${r1.tx_hash}#0`);
    expect(inputs).toContain(`${rx.tx_hash}#0`);
  });

  it("Bring every box back now's stuck path (paid: private) does the same", async () => {
    const { t, lj, r1, rx, B2 } = await twoWaysBackThenStuck();
    await lj.bringAllBack("preprod");
    const sent = await lj.withdrawDue("preprod");
    const back = sent.find((p) => txInputs(t.koios.submitted.find((b) => txIdOf(b) === p.txHash)!).includes(`${B2.tx_hash}#0`));
    expect(back, `sent ${JSON.stringify(sent.map((p) => p.txHash))}`).toBeDefined();
    const inputs = txInputs(t.koios.submitted.find((b) => txIdOf(b) === back!.txHash)!);
    expect(inputs, `spent ${JSON.stringify(inputs)}: ${r1.tx_hash}#0 is the way back of a box carrying S1's register`).not.toContain(`${r1.tx_hash}#0`);
    expect(inputs).toContain(`${rx.tx_hash}#0`);
  });

  // The classes the payer takes first: a box whose making the wallet knows, alone or merged with boxes, and never one
  // with a part of unknown making, its own unknown:<w> or a bare unknown it was merged with (lovejoin-merged-review's).
  it("takes first a box whose making the wallet knows, never one with a part of unknown making", () => {
    const [w, x, r] = [hash("31"), hash("32"), hash("33")];
    expect(knownBox(mixedBox(x))).toBe(true);
    expect(knownBox(boxFrom(w))).toBe(true);
    expect(knownBox(merged([boxFrom(w), mixedBox(x)]))).toBe(true);
    expect(knownBox(unplacedBox(w))).toBe(false);
    expect(knownBox(merged([boxFrom(w), UNKNOWN]))).toBe(false);
    expect(knownBox(merged([mixedBox(x), unplacedBox(w)]))).toBe(false);
    expect(knownBox(merged([boxFrom(w), receivedIn(r)]))).toBe(false);
    expect(knownBox(merged([boxFrom(w), sessionClass(4)]))).toBe(false);
    expect(knownBox(undefined)).toBe(false);
  });
});
