// Lovejoin from the data layer's private index (chunk 26b, Step 5): the pool
// is its snapshot and what changed since, both answers every wallet shares,
// and what made each box comes with its row (`made_by`), so the wallet asks
// nobody about one box of its own. A box Kupo answered for, with no inputs,
// is held and asked of again at the next look, as one Koios didn't answer
// for is. Koios's listing and tx_info stay the fallback. A test of what made a
// box the wallet holds reads v2's 5 ₳ pool, on the token pools' feed: the
// classic pool, retired, holds none, its boxes coming back mixed or not
// (chunk 44).
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DataLayerKoios, DataParts } from "../src/background/data-layer";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import { privateIndexClient, type IndexRow } from "../src/background/private-index";
import { NETWORKS } from "../src/networks";
import type { LovejoinStatus } from "../src/shared/rpc";
import { CHAINS, POOL, withSession, type Tested } from "./chain-fixtures";
import { fakeIndex, indexRowOf } from "./fake-index";
import { loadTestWasm, sessionSwap } from "./fakes";
import { ADA, ADA_ADDRESS, ADA_POOL, ADA_ROWS, ADA_VIEW, adaBox, ownDatum } from "./v2-pools";

const MIX_BOX = NETWORKS.preprod.lovejoin!.mixBox;
const hash = (h: string) => h.repeat(32);

/** A box in the pool the wallet's Seedelf key owns. */
async function ownedBox(t: Tested, tx: string): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  return { ...POOL[0]!, tx_hash: tx, tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
}

/** A box in the 5 ₳ pool the wallet's Seedelf key owns. */
const adaOwned = async (t: Tested, tx: string) => adaBox(tx, await ownDatum(t.wallet), t.clock.now);

/** The 5 ₳ pool's part of a status. */
const adaOf = (status: LovejoinStatus) => status.pools!.find((p) => p.id === ADA)!;

/**
 * The pools on the index, `made` saying what made each box by its transaction; each box made at `slot`, or long ago.
 * The 5 ₳ pool's boxes are on the token pools' feed, which covers it; the classic pool's on its own.
 */
async function onIndex(t: Tested, boxes: KoiosUtxo[], made: Record<string, IndexRow["made_by"]>, slots: Record<string, number> = {}) {
  const index = fakeIndex();
  const row = (u: KoiosUtxo) => ({
    row: { ...indexRowOf(u, slots[u.tx_hash] ?? index.tip - 100_000), ...(made[u.tx_hash] ? { made_by: made[u.tx_hash] } : {}) },
  });
  const ada = (u: KoiosUtxo) => u.address === ADA_ADDRESS;
  index.pool = boxes.filter((u) => !ada(u)).map(row);
  index.tokens = boxes.filter(ada).map(row);
  index.tokenPools = [ADA_VIEW.mixBoxHash];
  const parts = new DataParts(t.session, () => t.clock.now);
  const lovejoin = new LovejoinService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    preferences: t.preferences,
    pools: async () => [ADA_POOL],
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
      [...POOL, ...ADA_ROWS, await adaOwned(t, M), await adaOwned(t, S)],
      {
        // Someone else's mix moved one; a cut chain's deposit from a session put the other in.
        [M]: { mixed: true, inputs: [[ADA_VIEW.mixBoxHash, null], ["ee".repeat(28), null]] },
        [S]: { mixed: false, inputs: [[sessionSwap.keyHash, null]] },
      },
      // The mix landed a few blocks ago: past the snapshot's cursor, so only the feed since it lists it.
      { [M]: fakeIndex().tip - 50 },
    );
    const status = adaOf(await lovejoin.status("preprod"));
    expect(status.notMixed).toEqual([{ txHash: S, txIndex: 0, pool: ADA }]);
    expect(status.due).toHaveLength(1);
    expect(index.calls.filter((c) => c.startsWith("lovejoin/"))).toEqual([
      "lovejoin/pool",
      expect.stringMatching(/^lovejoin\/since\//),
      "lovejoin/tokens",
      expect.stringMatching(/^lovejoin\/tokens\/since\//),
    ]);
    // Nobody was asked about a box: no tx_info, and no listing of either pool's mix box.
    expect(asked(t, "tx_info")).toBe(0);
    const listed = (box: string) => t.koios.calls.some((c) => c.path === "credential_utxos" && c.body._payment_credentials.includes(box));
    expect(listed(MIX_BOX)).toBe(false);
    expect(listed(ADA_VIEW.mixBoxHash)).toBe(false);
  });

  it("holds a box the index answered from Kupo for, with no inputs, and settles it at a later look", async () => {
    const { t } = await withSession("40000000");
    const M = hash("b4");
    const { index, lovejoin } = await onIndex(t, [...POOL, ...ADA_ROWS, await adaOwned(t, M)], { [M]: { mixed: true, inputs: null } });
    const first = adaOf(await lovejoin.status("preprod"));
    expect(first.unsure).toEqual([{ txHash: M, txIndex: 0, pool: ADA }]);
    expect(first.due).toEqual([]);
    // db-sync answers again: its inputs come with the row.
    index.tokens.find((r) => r.row.ref === `${M}#0`)!.row.made_by = { mixed: true, inputs: [[ADA_VIEW.mixBoxHash, null]] };
    const second = adaOf(await lovejoin.status("preprod"));
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
