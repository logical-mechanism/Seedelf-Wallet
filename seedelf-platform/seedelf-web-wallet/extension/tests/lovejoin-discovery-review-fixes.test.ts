// 1.6.0's release review, 314-wasm#0: a launch can put any datum beside its scripts at the holder, as one_shot_mint
// checks only the reference output. WebAssembly decoding one a few thousand levels deep, as a listed or looked-up pool
// was verified, overflowed its stack; the next call trapped, and every wallet whose pool read took that pool in locked
// itself, again at each read. Such a row is no reference now, so the pool's scripts aren't all at the holder and it's
// never kept: not from the data layer's list (which leaves it out too), nor from Koios's holder. With the real
// WebAssembly, built with the fix (wasm/build.sh); a file of its own, so a module built without it breaks no other
// file's tests.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DataParts } from "../src/background/data-layer";
import { Koios, type KoiosLaunch, type KoiosUtxo } from "../src/background/koios";
import { HOLDER, PoolDiscovery, REFRESH_MS } from "../src/background/lovejoin-pools";
import { privateIndexClient } from "../src/background/private-index";
import { fakeIndex, indexRowOf } from "./fake-index";
import { loadTestWasm, memoryArea } from "./fakes";

/** PR #163's token pool on preprod, as Koios lists it: its scripts at a key address. */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};

const ID = "c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69";
const LJTEST = "02d597331203e9e2ec8b954b26a33503f044578c836407bf125f31fa" + Buffer.from("LJTEST").toString("hex");
const MIX_BOX = "b51f7e0331d32c706c0657a9ae28e5900e651d569d922b7093b52ea4";
const MIX_LOGIC = "ada2c293ad286873fb2d265b4a8597edc5271e927e13dc0496e7b953";
const LAUNCH = FOUND.reference.tx_hash;
const BLOCK = FOUND.reference.block_height!;
/** A datum 3,000 levels deep, about 3 KB on chain: the review's hostile launch. */
const DEEP = `${"81".repeat(3_000)}00`;

/** Its two scripts as its launch would have put them at the holder, outputs 1 and 2 of the same transaction, mix_box's under `datum` if given. */
function scripts(datum?: string): KoiosUtxo[] {
  return FOUND.scripts.map((s, i) => ({
    ...s,
    tx_hash: LAUNCH,
    tx_index: i + 1,
    address: FOUND.reference.address,
    payment_cred: HOLDER,
    stake_address: null,
    block_height: BLOCK,
    ...(i === 0 && datum ? { inline_datum: { bytes: datum, value: null } } : {}),
  }));
}

const wasm = loadTestWasm();

/** L's reward account: what a standard launch registers. */
const L_STAKE = (
  JSON.parse(wasm.lovejoinLaunchCheck(JSON.stringify({ network: "preprod", reference: FOUND.reference, inputs: [FOUND.seed], scripts: scripts() }))) as {
    mixLogicStake: string;
  }
).mixLogicStake;

/** Its launch's transaction as Koios's tx_info gives it: the seed among its inputs, L registered. */
const LAUNCH_TX: KoiosLaunch = {
  tx_hash: LAUNCH,
  block_height: BLOCK,
  tx_block_index: 3,
  tx_timestamp: FOUND.reference.block_time!,
  inputs: [
    { tx_hash: "00".repeat(32), tx_index: 0 },
    { tx_hash: FOUND.seed.txHash, tx_index: FOUND.seed.txIndex },
  ],
  certificates: [{ type: "stake_registration", info: { stake_address: L_STAKE } }],
};

/** The data layer's `lovejoin/pools` listing the pool, mix_box's row under `datum` if given (indexRowOf carries it). */
function listed(datum?: string) {
  const slot = 100_000_000;
  return {
    network: "mainnet",
    cursor: `${slot}.${"0".repeat(64)}`,
    classic: { crowd: { boxes: 80, deposits: 12, mixed: 70 } },
    pools: [
      {
        id: ID,
        seed: `${FOUND.seed.txHash}#${FOUND.seed.txIndex}`,
        reference: indexRowOf(FOUND.reference, slot),
        scripts: scripts(datum).map((s, i) => ({ ...indexRowOf(s, slot), script: true, script_hash: [MIX_BOX, MIX_LOGIC][i] })),
        launch: { tx: LAUNCH, block: BLOCK, index: 3, slot, time: slot + 1_591_566_291 },
        crowd: { boxes: 30, deposits: 1, mixed: 0 },
      },
    ],
  };
}

/** Discovery from the holder's start: Koios answering `holder` and the launch, and the data layer's `index` if given. */
function discovery(holder: KoiosUtxo[], index?: ReturnType<typeof fakeIndex>) {
  const fetch = async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.split("/").pop()!;
    const body = JSON.parse(String(init.body));
    if (path === "credential_utxos") return Response.json(holder.filter((r) => body._payment_credentials.includes(r.payment_cred)));
    if (path === "tx_info") return Response.json(body._tx_hashes.includes(LAUNCH) ? [LAUNCH_TX] : []);
    return Response.json([]);
  };
  const koios = new Koios("https://preprod.koios.rest/api/v1", fetch, async () => undefined);
  const clock = { now: 1_800_000_000_000 };
  const parts = new DataParts(memoryArea(), () => clock.now);
  const found = new PoolDiscovery({
    local: memoryArea(),
    wasm,
    koios: () => koios,
    ...(index ? { index: privateIndexClient({ koiosOnly: async () => false, parts, fetch: index.fetch, limits: {} }, () => "https://data.test") } : {}),
    now: () => clock.now,
    listed: () => new Set([LJTEST]),
    headStart: () => ({ height: 0, pools: [] }),
  });
  return { found, clock };
}

describe("a launch's script under a datum too deep to read (1.6.0's release review, 314-wasm#0)", () => {
  it("leaves its pool out of the data layer's list, and the module whole", async () => {
    const index = fakeIndex();
    index.poolList = listed(DEEP);
    const { found, clock } = discovery([], index);
    // Twice: a first overflow could pass, or only leak the stack.
    await found.refresh("preprod");
    clock.now += REFRESH_MS;
    await found.refresh("preprod");
    expect(await found.known("preprod")).toEqual([]);
    // The same pool listed with its scripts as a standard launch leaves them is kept: the module still answers.
    index.poolList = listed();
    clock.now += REFRESH_MS;
    await found.refresh("preprod");
    expect((await found.known("preprod")).map((p) => p.id)).toEqual([ID]);
  });

  it("leaves its pool out of a look at Koios's holder, and the module whole", async () => {
    const deep = discovery([FOUND.reference, ...scripts(DEEP)]);
    await deep.found.scan("preprod");
    await deep.found.scan("preprod");
    expect(await deep.found.known("preprod")).toEqual([]);
    const clean = discovery([FOUND.reference, ...scripts()]);
    await clean.found.scan("preprod");
    expect((await clean.found.known("preprod")).map((p) => p.id)).toEqual([ID]);
  });
});
