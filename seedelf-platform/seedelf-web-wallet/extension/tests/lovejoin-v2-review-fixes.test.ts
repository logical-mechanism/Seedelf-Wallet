// 1.8.0's release review, what it found in #363 (chunk 44a), the worker's
// half: a start's record names the set it ran, so a start on v2's scripts is
// never told it copies one 1.7 made on 8131b1d's (pr363#0); and the status
// names each pool's set, the only thing Start a pool joins v2 pools by
// (pr363#3). With the real WebAssembly.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { LovejoinLaunchService } from "../src/background/lovejoin-launch";
import tokenList from "../src/tokens/list.json";
import { account, AGREES, PASSWORD, POOL } from "./chain-fixtures";
import { bech32 } from "./fixtures/bech32";
import { koiosPreprod, loadTestWasm, testBalances } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, ownDatum } from "./v2-pools";

/** Starts are built twice and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 120_000 };

const MINUTE = 60_000;

/** MIN, on preprod's token list: a token that may have a pool. */
const MIN = tokenList.preprod.find((x) => x.ticker === "MIN")!;
const min = { policyId: MIN.policy, assetName: MIN.name };

/** PR #163's token pool on preprod, on 8131b1d's scripts: retired, listed only where the wallet has a box there. */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const OLD_TOKEN_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };
const OLD_VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: OLD_TOKEN_POOL }))) as {
  id: string;
  version: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const OLD_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(OLD_VIEW.mixBoxHash, "hex")]));

type T = ReturnType<typeof testBalances>;

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era: a start the account signs is valid until a while after it.
  t.koios.tip = 110_000_000;
  return t;
}

/** One of the recorded account's UTxOs, made again as `tx`'s with `value`. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] };
}

/** The launch service, no pool shown or found by a look, and the pool each start WebAssembly built makes, as it says. */
function launching(t: T) {
  const wasm = loadTestWasm();
  const pools: Array<{ id: string; version: string }> = [];
  const kept = (made: string) => {
    pools.push((JSON.parse(made) as { pool: { id: string; version: string } }).pool);
    return made;
  };
  const service = new LovejoinLaunchService({
    ...t.deps,
    wasm: {
      ...wasm,
      buildLovejoinLaunchFromAccount: (key: Parameters<typeof wasm.buildLovejoinLaunchFromAccount>[0], request: string) =>
        kept(wasm.buildLovejoinLaunchFromAccount(key, request)),
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    lovejoin: t.lovejoin,
    discovery: { known: async () => [], look: async () => undefined },
  });
  return Object.assign(service, { pools });
}

/** A pool of 4.5 ₳ and 1,000 MIN a box, started from the public account. */
const terms = { from: "public" as const, token: min, quantity: "1000", boxLovelace: "4500000" };

describe("a start's set (1.8.0's release review, pr363#0)", SLOW, () => {
  it("isn't told it makes a copy of a start of its values that 1.7 recorded, which ran 8131b1d's scripts", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t);
    // 1.7.2 started a pool of these values, on 8131b1d's scripts as its every start was, and recorded it as it
    // recorded every start: no set named. No look has found it yet. Then the wallet updated to 1.8.0.
    await t.lovejoin.recordLaunch("preprod", {
      id: "ce".repeat(28),
      txHash: "ab".repeat(32),
      from: "public",
      account: 0,
      box: { lovelace: "4500000", token: { ...min, quantity: "1000" } },
    });
    t.clock.now += 5 * MINUTE;
    const review = await launch.build("preprod", terms);
    // The start runs v2's scripts, as WebAssembly reads the pool back from its own bytes, and a v2 pool is never a
    // copy of an 8131b1d pool: it's shown, so "the later one is a copy: never shown" would be false.
    expect(launch.pools.map((p) => p.version)).toEqual(["v2", "v2"]);
    expect(review.startedBefore).toBeUndefined();
  });

  it("names it on the record of each start it sends, and still says a v2 start of the same values not found yet", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e2", "40000000"), atAccount("e5", "5000000"));
    const launch = launching(t);
    const first = await launch.build("preprod", terms);
    await launch.submit("preprod", first.txHash);
    const sentAt = t.clock.now;
    expect(await t.lovejoin.launches("preprod")).toEqual([
      {
        id: first.pool.id,
        txHash: first.txHash,
        version: "v2",
        from: "public",
        account: 0,
        at: sentAt,
        box: { lovelace: "4500000", token: { ...min, quantity: "1000" } },
      },
    ]);
    // Started again on v2 before a look finds the first, one of the two is a copy: said, nothing refused
    // (1.6.0's release review, 318-worker#1).
    t.clock.now += 5 * MINUTE;
    expect((await launch.build("preprod", terms)).startedBefore).toEqual({ txHash: first.txHash, at: sentAt });
  });
});

describe("each pool's set on the status (1.8.0's release review, pr363#3)", SLOW, () => {
  it("is v2 on a v2 pool, and none on an 8131b1d pool listed for the wallet's box there", async () => {
    // Start a pool joins, and flags a copy of, only the pools whose status names v2 (LovejoinLaunch.tsx): the
    // worker's status is where that comes from, and nothing else in ui/ reads a pool's set.
    const t = await wallet();
    const lj = new LovejoinService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      pools: async () => [ADA_POOL, OLD_TOKEN_POOL],
      random: () => 0.5,
    });
    // A box of the wallet's in the 8131b1d pool, a mix there having made it: the status lists that pool for it.
    const tx = "d1".repeat(32);
    t.koios.txSpends.set(tx, [{ payment_addr: { bech32: OLD_ADDRESS, cred: OLD_VIEW.mixBoxHash } }]);
    t.koios.addedToAccounts.push(...POOL, ...ADA_ROWS, {
      ...POOL[0]!,
      tx_hash: tx,
      tx_index: 0,
      address: OLD_ADDRESS,
      payment_cred: OLD_VIEW.mixBoxHash,
      value: "2000000",
      block_time: Math.floor(t.clock.now / 1000) - 5 * 3600,
      inline_datum: { bytes: await ownDatum(t.wallet), value: {} },
      asset_list: [{ policy_id: OLD_VIEW.token.policyId, asset_name: OLD_VIEW.token.assetName, quantity: OLD_VIEW.token.quantity, decimals: 0, fingerprint: "" } as never],
    } as KoiosUtxo);
    const status = await lj.status("preprod");
    expect(OLD_VIEW.version).toBe("tokenV1");
    expect(status.pools?.map((p) => p.id).sort()).toEqual([ADA, OLD_VIEW.id].sort());
    expect(status.pools!.find((p) => p.id === ADA)!.version).toBe("v2");
    expect(status.pools!.find((p) => p.id === OLD_VIEW.id)).not.toHaveProperty("version");
  });
});
