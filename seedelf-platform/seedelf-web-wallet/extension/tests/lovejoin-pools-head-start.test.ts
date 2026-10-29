// The bundled head start of Lovejoin's token pools (chunk 34's 34c,
// `src/lovejoin-pools.json`): every pool shown on each network when it was
// written, and the block Koios's holder was read to. Checked here on every
// run: each pool verifies from the bundled templates, with its scripts at the
// holder, and none is a copy. Written at each release, with the very look the
// wallet makes, from the holder's start, against the real Koios, and after
// any change to `src/tokens/list.json` (the check below fails until it is):
//   npm run lovejoin-pools          (LOVEJOIN_POOLS_WRITE=1 npx vitest run tests/lovejoin-pools-head-start.test.ts)
// Koios's answers to discovery's own requests, against the real preprod Koios:
//   LIVE_KOIOS=1 npx vitest run tests/lovejoin-pools-head-start.test.ts
import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Koios, type KoiosUtxo } from "../src/background/koios";
import { HOLDER, PoolDiscovery, listFingerprint, shown, type Kept } from "../src/background/lovejoin-pools";
import { NETWORKS, type NetworkName } from "../src/networks";
import { loadTestWasm, memoryArea } from "./fakes";

const FILE = new URL("../src/lovejoin-pools.json", import.meta.url);
const NETS: NetworkName[] = ["preprod", "mainnet"];
type HeadStart = Record<NetworkName, Kept> & { "//": string };
const read = () => JSON.parse(readFileSync(FILE, "utf8")) as HeadStart;

describe("the bundled head start", () => {
  it("holds only pools the wallet would show, each verified from the bundled templates", () => {
    const wasm = loadTestWasm();
    const file = read();
    for (const network of NETS) {
      const { height, pools } = file[network];
      expect(Number.isInteger(height) && height >= 0, network).toBe(true);
      expect(shown(pools), network).toEqual(pools);
      for (const p of pools) {
        const view = JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network, pool: p.ref }))) as { id: string; scriptsInline: number };
        expect([view.id, view.scriptsInline], `${network} ${p.id}`).toEqual([p.id, 0]);
      }
    }
  });

  // Not while writing: `npm run lovejoin-pools` is how a stale one is fixed, and it would fail on the file it replaces.
  it.skipIf(process.env.LOVEJOIN_POOLS_WRITE === "1")("was written under the token list it's bundled with", () => {
    // A device whose list changed looks again from the head start's height, so the head start must hold every pool of
    // this list below it (1.6.0's release review, STATE-4). One written before the list was recorded passes.
    const file = read();
    for (const network of NETS) {
      if (file[network].listed !== undefined) expect(file[network].listed, `${network}: run npm run lovejoin-pools`).toBe(listFingerprint(network));
    }
  });
});

describe.skipIf(process.env.LOVEJOIN_POOLS_WRITE !== "1")("writing the head start", () => {
  it(
    "looks at each network's whole holder under this release's token list, and writes what it found",
    async () => {
      const file = read();
      for (const network of NETS) {
        const local = memoryArea();
        // From the holder's start, not the last head start's height: a token listed since may have pools below it,
        // which every look before refused (STATE-4). Each pool is found and verified again.
        const found = new PoolDiscovery({
          local,
          wasm: loadTestWasm(),
          koios: () => new Koios(NETWORKS[network].koios),
          wallet: { trapped: async () => undefined },
          now: Date.now,
          headStart: () => ({ height: 0, pools: [] }),
        });
        await found.scan(network);
        const kept = await local.get<{ height: number }>(`seedelf.lovejoinPools.${network}`);
        file[network] = { height: kept?.height ?? 0, pools: await found.known(network), listed: listFingerprint(network) };
      }
      file["//"] =
        "Lovejoin's token pools shown on each network when this was written, the block Koios's holder was read to from its start, and the token list it was read under (`listed`): a new device's head start, and where a device looks from again when an update changes its list (chunk 34's 34c). Written at each release by `npm run lovejoin-pools`; never a gate, as the wallet verifies every pool and looks on from the height.";
      writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
    },
    300_000,
  );
});

describe.skipIf(!process.env.LIVE_KOIOS)("discovery's requests on the real preprod Koios", () => {
  it("reads the holder, a launch's transaction and a reward account's registrations as discovery reads them", async () => {
    const koios = new Koios(NETWORKS.preprod.koios);
    const holder = await koios.credentialUtxos([HOLDER]);
    // PR #163's launch: its reference UTxO is at the holder, its scripts aren't.
    const lj = holder.find((r: KoiosUtxo) => r.asset_list?.some((a) => a.policy_id === "c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69"));
    expect(lj).toBeDefined();
    const [launch] = await koios.launches([lj!.tx_hash]);
    expect(launch).toMatchObject({ tx_hash: lj!.tx_hash, block_height: lj!.block_height });
    expect(Number.isInteger(launch!.tx_block_index)).toBe(true);
    expect(launch!.inputs).toEqual(
      expect.arrayContaining([{ tx_hash: "5c6f327e511818805adb6b4e055a6b222f9f8706cfda3540bdb0e9bb0f6acc0b", tx_index: 2 }].map((i) => expect.objectContaining(i))),
    );
    // A well-known registered key's first registration is in the past; one never registered has none.
    const wasm = loadTestWasm();
    const check = JSON.parse(
      wasm.lovejoinLaunchCheck(
        JSON.stringify({
          network: "preprod",
          reference: lj,
          inputs: launch!.inputs!.map((i) => ({ txHash: i.tx_hash, txIndex: i.tx_index })),
          scripts: [],
        }),
      ),
    ) as { mixLogicStake: string; pool: { scriptsInline: number } };
    expect(check.pool.scriptsInline).toBe(2);
    // A key the recorded delegation history registered has a first registration in the past; L's may have none.
    const registered = (JSON.parse(readFileSync(new URL("./fixtures/delegations-preprod.json", import.meta.url), "utf8")) as { stake: string }).stake;
    const first = await koios.firstRegistrations([check.mixLogicStake, registered]);
    expect(first.get(registered)).toBeLessThan(Date.now() / 1000);
    expect([...first.keys()].every((k) => k === check.mixLogicStake || k === registered)).toBe(true);
  }, 120_000);
});
