// Chunk 43's refusal, as sw.ts wires it: a site's transaction that pays into a Lovejoin pool's `mix_logic` reward
// account is never signed, nor asked about, for every pool the wallet knows. That's the classic pool and every pool
// discovery keeps (serviceDeps): the head start's on each network, the retired ones among them, one found since, and
// every copy, read or not. So which copy holds the wallet's boxes never changes what a site hears, and nobody is asked,
// the data layer included (1.8.1's release review, guard#1, guard#3 and v-guard#1). With the real WebAssembly, and
// PR #163's preprod token pool launched on v2's scripts, never on chain (wasm/tests/fixtures).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { HOLDER, LOCAL_LOVEJOIN_POOLS_PREFIX, PoolDiscovery, serviceDeps, type FoundPool, type Kept } from "../src/background/lovejoin-pools";
import { t as tr } from "../src/i18n";
import bundled from "../src/lovejoin-pools.json";
import type { NetworkName } from "../src/networks";
import { TxSignError } from "../src/shared/dapp";
import { bech32 } from "./fixtures/bech32";
import { loadTestWasm, memoryArea, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;
const wasm = loadTestWasm();

const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const VIEW = JSON.parse(
  wasm.lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts } })),
) as { id: string; boxLovelace: string; token: { policyId: string; assetName: string; quantity: string } };

/** The token pool as `network`'s discovery keeps it, found after the head start: on mainnet, its rows at the holder there. */
function found(network: NetworkName): FoundPool {
  const holder = network === "mainnet" ? bech32("addr", Uint8Array.from([0x71, ...Buffer.from(HOLDER, "hex")])) : FOUND.reference.address;
  const at = (r: KoiosUtxo) => ({ ...r, address: holder });
  return {
    id: VIEW.id,
    version: "v2",
    boxLovelace: VIEW.boxLovelace,
    token: VIEW.token,
    ref: { reference: at(FOUND.reference), seed: FOUND.seed, scripts: FOUND.scripts.map(at) },
    launch: { block: FOUND.reference.block_height!, index: 3, tx: FOUND.reference.tx_hash },
  };
}
const REAL = found("preprod");
/**
 * An earlier launch of its values, which makes it a copy: one WebAssembly won't verify (its seed isn't the one its NFT's
 * policy comes from), as lovejoin-merged-review.test.ts has it.
 */
const EARLIER: FoundPool = {
  ...REAL,
  id: "aa".repeat(28),
  ref: { reference: { ...FOUND.reference, tx_hash: "aa".repeat(32) }, seed: { txHash: "aa".repeat(32), txIndex: 0 } },
  launch: { block: REAL.launch.block - 10, index: 0, tx: "aa".repeat(32) },
};
const NO_HEAD_START: Kept = { height: 0, pools: [] };

/** A pool's `mix_logic` hash on `network`, the classic pool's where none is named, as WebAssembly derives it. */
const mixLogicOf = (network: NetworkName, ref?: PoolRef) =>
  (JSON.parse(wasm.lovejoinMixLogic(JSON.stringify({ network, ...(ref ? { poolRef: ref } : {}) }))) as { hash: string }).hash;

async function on() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}
type T = Awaited<ReturnType<typeof on>>;

/**
 * As sw.ts wires them: discovery over the device's record on `network` (`pools`) and the bundled head start, unless
 * one is given, its data layer counted and never answering; Lovejoin on serviceDeps; the connector given that service.
 */
async function wired(t: T, network: NetworkName, pools: FoundPool[], headStart?: Kept) {
  const local = memoryArea();
  await local.set(LOCAL_LOVEJOIN_POOLS_PREFIX + network, { height: 0, pools });
  const asked = { index: 0 };
  const discovery = new PoolDiscovery({
    local,
    wasm,
    koios: t.deps.koios,
    index: async () => (asked.index++, undefined),
    now: () => t.clock.now,
    ...(headStart ? { headStart: () => headStart } : {}),
  });
  const lj = new LovejoinService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    ...serviceDeps(discovery),
  });
  const dapp = new DappService({
    ...t.deps,
    store: t.store,
    sessions: t.sessions,
    lovejoin: lj,
    network: () => network,
    window: t.dappWindow,
    changed: () => undefined,
  });
  return { discovery, lj, dapp, asked };
}

/** What the one-time read keeps sealed once it finds the wallet's boxes in copy `ref` (lovejoin.ts ours; R2-4). */
const holdsOurBoxes = (t: T, ref: PoolRef) => t.store.set("lovejoin.preprod", { due: [], chains: [], copies: [ref] });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

let pages = 0;
/** A site the user connected. */
async function connected(dapp: DappService): Promise<DappSession> {
  const s = { id: `rewards${++pages}`, origin: "https://app.example.com", title: "Example" };
  const enabling = dapp.call(s, "enable", []);
  await until(() => dapp.approvals().length === 1);
  await dapp.answer(dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);

/**
 * A site's transaction: it spends `input` (`txhash#index`), pays 4 ₳ to someone else, and registers a stake pool whose
 * reward account is `reward` (29 bytes, hex). Nothing balances it: the wallet only reads it.
 */
function registersPool(input: string, reward: string) {
  const pool = `8a03581c${"77".repeat(28)}5820${"88".repeat(32)}001a0a21fe80d81e820001581d${reward}81581c${"99".repeat(28)}80f6`;
  const spends = `81825820${input.slice(0, 64)}${uint(Number(input.slice(65)))}`;
  return `84a400${spends}0181825839${wasm.cip30Address(THEIRS)}1a003d0900021a000298100481${pool}a0f5f6`;
}

/** What a site hears of its signTx: refused unasked, or asked (and declined here). */
async function heard(dapp: DappService, s: DappSession, tx: string) {
  let failure: unknown;
  let settled = false;
  const signing = dapp
    .call(s, "signTx", [tx, true])
    .catch((e: { failure?: unknown }) => void (failure = e.failure))
    .finally(() => (settled = true));
  await until(() => settled || dapp.approvals().length === 1);
  const asked = dapp.approvals().length === 1;
  for (const a of dapp.approvals()) await dapp.answer(a.id, false);
  await signing;
  return { asked, failure };
}
const REFUSED = { asked: false, failure: { code: TxSignError.ProofGeneration, info: tr("dapp.lovejoinRewards") } };

describe("the pools whose reward account a site's transaction may never pay into (chunk 43), as sw.ts wires them", () => {
  it("are the classic pool, the head start's, the retired ones among them, and one found since, on each network, asking nobody", async () => {
    const t = await on();
    const from = t.koios.calls.length;
    for (const network of ["preprod", "mainnet"] as const) {
      const { lj, asked } = await wired(t, network, [found(network)]);
      const kept = [...(bundled as unknown as Record<NetworkName, Kept>)[network].pools, found(network)];
      const expected = [mixLogicOf(network), ...kept.map((p) => mixLogicOf(network, p.ref))].sort();
      expect([...(await lj.mixLogicHashes(network))].sort(), network).toEqual(expected);
      // Never discovery's list, while a site waits for its signature.
      expect(asked.index, network).toBe(0);
    }
    expect(t.koios.calls.slice(from)).toEqual([]);
  });

  it("are every copy discovery keeps too, read or not, whichever holds the wallet's boxes (v-guard#1)", async () => {
    const t = await on();
    const { discovery, lj } = await wired(t, "preprod", [EARLIER, REAL], NO_HEAD_START);
    const from = t.koios.calls.length;
    const expected = [mixLogicOf("preprod"), mixLogicOf("preprod", REAL.ref)].sort();
    // Kept, never handed over, and not read yet.
    expect((await discovery.copiesUnread("preprod")).map((p) => p.id)).toEqual([REAL.id]);
    expect([...(await lj.mixLogicHashes("preprod"))].sort(), "unread").toEqual(expected);
    // Read once and found empty: discovery's record says only that it was read (MERGED-1).
    await discovery.copiesRead("preprod", [`${REAL.ref.reference.tx_hash}#${REAL.ref.reference.tx_index}`]);
    expect([...(await lj.mixLogicHashes("preprod"))].sort(), "read, empty").toEqual(expected);
    // Read once and found holding the wallet's boxes.
    await holdsOurBoxes(t, REAL.ref);
    expect([...(await lj.mixLogicHashes("preprod"))].sort(), "holding the wallet's boxes").toEqual(expected);
    expect(t.koios.calls.slice(from)).toEqual([]);
  });

  it("are the pools the wallet reads still, where discovery's record can't be read; a trap is handed on", async () => {
    const t = await on();
    const unreadable = (e: Error) =>
      new LovejoinService({
        ...t.deps,
        collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
        store: t.store,
        known: async () => [REAL.ref],
        everyKept: async () => {
          throw e;
        },
      });
    expect([...(await unreadable(new Error("unreadable")).mixLogicHashes("preprod"))].sort()).toEqual(
      [mixLogicOf("preprod"), mixLogicOf("preprod", REAL.ref)].sort(),
    );
    await expect(unreadable(new WebAssembly.RuntimeError("unreachable")).mixLogicHashes("preprod")).rejects.toThrow(WebAssembly.RuntimeError);
  });

  it("refuse a site's payment into a copy's account unasked, so its answer never says whether the wallet's boxes are there", async () => {
    const t = await on();
    const { discovery, dapp } = await wired(t, "preprod", [EARLIER, REAL], NO_HEAD_START);
    const s = await connected(dapp);
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const into = registersPool(`${own!.txHash}#${own!.index}`, `f0${mixLogicOf("preprod", REAL.ref)}`);
    await discovery.copiesRead("preprod", [`${REAL.ref.reference.tx_hash}#${REAL.ref.reference.tx_index}`]);
    expect(await heard(dapp, s, into), "read, empty").toEqual(REFUSED);
    await holdsOurBoxes(t, REAL.ref);
    expect(await heard(dapp, s, into), "holding the wallet's boxes").toEqual(REFUSED);
  });
});
