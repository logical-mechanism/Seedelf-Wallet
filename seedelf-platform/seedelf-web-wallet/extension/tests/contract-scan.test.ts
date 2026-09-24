// The contract scan: in full after an unlock, every 30 minutes and after a
// refused input; otherwise only what's newer than the last block seen, one
// request. This wallet's own spends drop out as it makes them.
import { describe, expect, it } from "vitest";

import { FULL_EVERY_MS, forgetContractView, readContractView } from "../src/background/contract-scan";
import type { KoiosUtxo } from "../src/background/koios";
import { outpoint, SESSION_SPENT } from "../src/background/spent";
import { koiosPreprod, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const TOP = Math.max(...[...koiosPreprod.contract_utxos, ...ownedUtxos].map((u) => u.block_height ?? 0));

async function unlocked() {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances();
  await t.wallet.create(v.phrase, PASSWORD);
  return t;
}

/** The block filter of each contract read: null for a full one. */
const reads = (t: Awaited<ReturnType<typeof unlocked>>) =>
  t.koios.calls
    .filter((c) => c.path === "credential_utxos" && c.body._payment_credentials.includes(koiosPreprod.wallet_contract))
    .map((c) => new URLSearchParams(c.query).get("block_height"));

describe("the contract scan", () => {
  it("reads in full first, then only what's newer, in one request", async () => {
    const t = await unlocked();
    const first = await readContractView(t.deps, "preprod");
    expect(first.owned.map(outpoint).sort()).toEqual(ownedUtxos.map(outpoint).sort());
    expect(Object.keys(first.seedelfs).length).toBeGreaterThan(1);

    t.clock.now += 60_000;
    const again = await readContractView(t.deps, "preprod");
    expect(again).toEqual(first);
    expect(reads(t)).toEqual([null, `gt.${TOP - 2}`]);
  });

  it("finds a new UTxO of ours on the catch-up", async () => {
    const t = await unlocked();
    await readContractView(t.deps, "preprod");
    // Another payment to this wallet, as a later block brings it.
    const paid: KoiosUtxo = { ...ownedUtxos[0]!, tx_hash: "b1".repeat(32), block_height: TOP + 10 };
    t.koios.added.push(paid);
    const view = await readContractView(t.deps, "preprod");
    expect(view.owned.map(outpoint)).toContain(outpoint(paid));
    expect(view.owned).toHaveLength(ownedUtxos.length + 1);

    // The next catch-up starts after it.
    await readContractView(t.deps, "preprod");
    expect(reads(t).at(-1)).toBe(`gt.${TOP + 8}`);
  });

  it("drops what this wallet has spent", async () => {
    const t = await unlocked();
    await readContractView(t.deps, "preprod");
    await t.session.set(SESSION_SPENT, [outpoint(ownedUtxos[0]!)]);
    const view = await readContractView(t.deps, "preprod");
    expect(view.owned.map(outpoint)).not.toContain(outpoint(ownedUtxos[0]!));
    expect(view.owned).toHaveLength(ownedUtxos.length - 1);
  });

  it("reads in full again after 30 minutes, after a lock, and after the network refused an input", async () => {
    const t = await unlocked();
    await readContractView(t.deps, "preprod");
    // Half an hour of use: activity keeps the wallet from locking itself (15 minutes idle).
    for (let m = 0; m < FULL_EVERY_MS; m += 10 * 60_000) {
      t.clock.now += 10 * 60_000;
      await t.wallet.touch();
    }
    await readContractView(t.deps, "preprod");
    expect(reads(t)).toEqual([null, null]);

    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    await readContractView(t.deps, "preprod");
    expect(reads(t).at(-1)).toBeNull();

    await forgetContractView(t.deps, "preprod");
    await readContractView(t.deps, "preprod");
    expect(reads(t).at(-1)).toBeNull();
  });

  it("serves the balance, Send's lookup and a spend's build from one full read", async () => {
    const t = await unlocked();
    await t.balances.get("preprod");
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);
    const theirs = Object.keys((await readContractView(t.deps, "preprod")).seedelfs).find(
      (name) => !ownedUtxos.some((u) => u.asset_list?.some((a) => a.asset_name === name)),
    )!;
    await t.transfer.lookup("preprod", theirs);
    expect(reads(t)).toEqual([null, `gt.${TOP - 2}`, `gt.${TOP - 2}`, `gt.${TOP - 2}`]);
  });
});
