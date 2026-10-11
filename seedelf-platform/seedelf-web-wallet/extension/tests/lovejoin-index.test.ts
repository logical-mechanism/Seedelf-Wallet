// Lovejoin from the data layer's private index (chunk 26b, Step 5): the pool
// is its snapshot and what changed since, both answers every wallet shares,
// and what made each box comes with its row (`made_by`), so the wallet asks
// nobody about one box of its own. A box Kupo answered for, with no inputs,
// is held and asked of again at the next look, as one Koios didn't answer
// for is. Koios's listing and tx_info stay the fallback.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DataLayerKoios, DataParts } from "../src/background/data-layer";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import { privateIndexClient, type IndexRow } from "../src/background/private-index";
import { NETWORKS } from "../src/networks";
import { CHAINS, POOL, withSession, type Tested } from "./chain-fixtures";
import { fakeIndex, indexRowOf } from "./fake-index";
import { loadTestWasm, sessionSwap } from "./fakes";

const MIX_BOX = NETWORKS.preprod.lovejoin!.mixBox;
const hash = (h: string) => h.repeat(32);

/** A box in the pool the wallet's Seedelf key owns. */
async function ownedBox(t: Tested, tx: string): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  return { ...POOL[0]!, tx_hash: tx, tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
}

/** The pool on the index, `made` saying what made each box by its transaction; each box made at `slot`, or long ago. */
async function onIndex(t: Tested, boxes: KoiosUtxo[], made: Record<string, IndexRow["made_by"]>, slots: Record<string, number> = {}) {
  const index = fakeIndex();
  index.pool = boxes.map((u) => ({
    row: { ...indexRowOf(u, slots[u.tx_hash] ?? index.tip - 100_000), ...(made[u.tx_hash] ? { made_by: made[u.tx_hash] } : {}) },
  }));
  const parts = new DataParts(t.session, () => t.clock.now);
  const lovejoin = new LovejoinService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    preferences: t.preferences,
    // Pointed at preprod's fixtures: the client is the same on any network it's given.
    index: privateIndexClient({ koiosOnly: async () => false, parts, fetch: index.fetch, limits: {} }, () => "https://data.test"),
  });
  return { index, lovejoin };
}

const asked = (t: Tested, path: string) => t.koios.calls.filter((c) => c.path === path).length;

describe("Lovejoin on the private index", CHAINS, () => {
  it("lists the pool at the tip and knows what made each box from its row, asking Koios nothing", async () => {
    const { t } = await withSession("40000000");
    const [M, S] = [hash("b1"), hash("c3")];
    const { index, lovejoin } = await onIndex(
      t,
      [...POOL, await ownedBox(t, M), await ownedBox(t, S)],
      {
        // Someone else's mix moved one; a cut chain's deposit from a session put the other in.
        [M]: { mixed: true, inputs: [[MIX_BOX, null], ["ee".repeat(28), null]] },
        [S]: { mixed: false, inputs: [[sessionSwap.keyHash, null]] },
      },
      // The mix landed a few blocks ago: past the snapshot's cursor, so only the feed since it lists it.
      { [M]: fakeIndex().tip - 50 },
    );
    const status = await lovejoin.status("preprod");
    expect(status.notMixed).toEqual([{ txHash: S, txIndex: 0 }]);
    expect(status.due).toHaveLength(1);
    expect(index.calls.filter((c) => c.startsWith("lovejoin/"))).toEqual([
      "lovejoin/pool",
      expect.stringMatching(/^lovejoin\/since\//),
    ]);
    // Nobody was asked about a box: no tx_info, and no listing of the mix box.
    expect(asked(t, "tx_info")).toBe(0);
    expect(t.koios.calls.some((c) => c.path === "credential_utxos" && c.body._payment_credentials.includes(MIX_BOX))).toBe(false);
  });

  it("holds a box the index answered from Kupo for, with no inputs, and settles it at a later look", async () => {
    const { t } = await withSession("40000000");
    const M = hash("b4");
    const { index, lovejoin } = await onIndex(t, [...POOL, await ownedBox(t, M)], { [M]: { mixed: true, inputs: null } });
    const first = await lovejoin.status("preprod");
    expect(first.unsure).toEqual([{ txHash: M, txIndex: 0 }]);
    expect(first.due).toEqual([]);
    // db-sync answers again: its inputs come with the row.
    index.pool.find((r) => r.row.ref === `${M}#0`)!.row.made_by = { mixed: true, inputs: [[MIX_BOX, null]] };
    const second = await lovejoin.status("preprod");
    expect(second.unsure).toBeUndefined();
    expect(second.due).toHaveLength(1);
    expect(asked(t, "tx_info")).toBe(0);
  });

  it("asks Koios alone, never the data layer, what made a box of the wallet's while only the index is down (the privacy policy)", async () => {
    const { t } = await withSession("40000000");
    const M = hash("b6");
    const box = await ownedBox(t, M);
    t.koios.addedToAccounts.push(box);
    t.koios.txSpends.set(M, [{ payment_addr: { bech32: POOL[0]!.address, cred: MIX_BOX } }]);
    const index = fakeIndex();
    index.fail = Response.json({ error: "behind" }, { status: 503 });
    const parts = new DataParts(t.session, () => t.clock.now);
    // The data layer's public part answers, as Koios's fake does, and every request is told by the host it went to.
    const hosts: Array<[string, string]> = [];
    const fetch = async (url: string, init: RequestInit) => {
      hosts.push([new URL(url).host, url.split("/").pop()!.split("?")[0]!]);
      return t.koios.fetch(url, init as never);
    };
    const deps = { koiosOnly: async () => false, parts, fetch, limits: {} };
    const lovejoin = new LovejoinService({
      ...t.deps,
      koios: (n) => new DataLayerKoios(n, "https://data.test", deps),
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      preferences: t.preferences,
      index: privateIndexClient({ ...deps, fetch: index.fetch }, () => "https://data.test"),
    });
    const status = await lovejoin.status("preprod");
    expect(status.due).toHaveLength(1);
    // The pool's listing is everyone's, from the data layer; what made the wallet's box, from Koios alone.
    expect(hosts.filter(([, path]) => path === "tx_info")).toEqual([["preprod.koios.rest", "tx_info"]]);
    expect(hosts).toContainEqual(["data.test", "credential_utxos"]);
  });

  it("reads Koios's listing and tx_info while the index is down", async () => {
    const { t } = await withSession("40000000");
    const M = hash("b5");
    const box = await ownedBox(t, M);
    t.koios.addedToAccounts.push(box);
    t.koios.txSpends.set(M, [{ payment_addr: { bech32: POOL[0]!.address, cred: MIX_BOX } }]);
    const { index, lovejoin } = await onIndex(t, [...POOL, box], {});
    index.fail = Response.json({ error: "behind" }, { status: 503 });
    const status = await lovejoin.status("preprod");
    expect(status.due).toHaveLength(1);
    expect(asked(t, "tx_info")).toBe(1);
  });
});
