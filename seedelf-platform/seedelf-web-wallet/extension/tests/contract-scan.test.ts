// The contract scan: in full after an unlock, every 30 minutes and after a
// refused input; otherwise only what's newer than the last block seen, one
// request. This wallet's own spends drop out as it makes them.
// At scale: it fits session storage whatever the contract holds, and a lock
// or a page never waits for the whole contract to be checked.
import type * as Wasm from "@seedelf/wasm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FULL_EVERY_MS,
  forgetContractView,
  OWNED_BATCH,
  readContractView,
  SESSION_CONTRACT_PREFIX,
} from "../src/background/contract-scan";
import { type KoiosUtxo, trimmed } from "../src/background/koios";
import { outpoint, SESSION_SPENT } from "../src/background/spent";
import { koiosPreprod, loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors } from "./fakes";

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
    // A seedelf the last reading saw is found in the view it kept, with no request.
    await t.transfer.lookup("preprod", theirs);
    expect(reads(t)).toEqual([null, `gt.${TOP - 2}`, `gt.${TOP - 2}`]);
    // One it didn't see asks only for what's new.
    await expect(t.transfer.lookup("preprod", `5eed0e1f${"00".repeat(28)}`)).rejects.toThrow("No Seedelf with that name");
    expect(reads(t)).toEqual([null, `gt.${TOP - 2}`, `gt.${TOP - 2}`, `gt.${TOP - 2}`]);
  });
});

describe("the contract scan at scale", () => {
  /** "This is a test.": a Seedelf the phrase doesn't own, whose register anyone can copy. */
  const THEIRS = koiosPreprod.contract_utxos.find((u) => u.asset_list?.some((a) => a.asset_name === transferPreprod.to))!;
  const hash = (i: number, tag: string) => `${tag}${i.toString(16).padStart(64 - tag.length, "0")}`;

  /**
   * A Seedelf parked with 1,200 junk tokens, as the review's attack has it:
   * about 220 KB of Koios JSON, near the most a UTxO's value may hold.
   */
  const junk = (i: number): KoiosUtxo => ({
    ...THEIRS,
    tx_hash: hash(i, "d0"),
    block_height: TOP + 1,
    asset_list: [
      { ...THEIRS.asset_list![0]!, asset_name: hash(i, "5eed0e1f") },
      ...Array.from({ length: 1_200 }, (_, n) => ({
        policy_id: "ab".repeat(28),
        asset_name: n.toString(16).padStart(4, "0"),
        fingerprint: `asset1${n.toString(36).padStart(38, "q")}`,
        decimals: 0,
        quantity: "1",
      })),
    ],
  });

  /**
   * Chrome's session storage: 10 MB for the whole extension, counted as it
   * measures values, about 2.5 times their JSON (measured in Chromium 153).
   */
  function withQuota(t: Awaited<ReturnType<typeof unlocked>>, quota = 10_485_760) {
    const size = (key: string, json: string) => (key.length + json.length) * 2.5;
    const set = t.session.set.bind(t.session);
    t.session.set = async (key, value) => {
      let used = size(key, JSON.stringify(value));
      for (const [k, v] of t.session.data) if (k !== key) used += size(k, v as string);
      if (used > quota) throw new Error("Session storage quota bytes exceeded. Values were not stored.");
      await set(key, value);
    };
  }

  it("keeps another wallet's Seedelf as where it is, so a contract full of junk still fits and still pays", async () => {
    const t = await unlocked();
    withQuota(t);
    t.koios.added.push(...Array.from({ length: 20 }, (_, i) => junk(i)));
    // 20 junk rows are about 4.4 MB of JSON: past the quota as Chrome counts them.
    expect(JSON.stringify(t.koios.added).length * 2.5).toBeGreaterThan(10_485_760);

    const b = await t.balances.get("preprod");
    expect(b.seedelf.utxos).toBe(2);
    expect(b.seedelf.seedelfs.map((s) => s.label)).toEqual(["web-wallet"]);
    expect((t.session.data.get(SESSION_CONTRACT_PREFIX + "preprod") as string).length).toBeLessThan(40_000);

    // A junk-laden Seedelf is found where the reading kept it, and paid under a new copy of its register.
    const name = junk(7).asset_list![0]!.asset_name;
    const before = reads(t).length;
    expect(await t.transfer.lookup("preprod", name)).toMatchObject({ name, own: false });
    expect(reads(t)).toHaveLength(before);
    const summary = await t.send.build("preprod", [{ to: name, lovelace: "5000000", tokens: [] }]);
    expect(summary.payments).toMatchObject([{ seedelf: { name }, address: THEIRS.address, own: false }]);

    // This wallet's own Seedelf is its whole row, as Koios's rows are kept (trimmed): Remove spends it.
    const view = await readContractView(t.deps, "preprod");
    const mine = ownedUtxos[2]!;
    expect(view.seedelfs[mine.asset_list![0]!.asset_name]).toEqual(trimmed(mine));
  });

  it("never fails a read it can't keep: it goes on with it, and reads in full next time", async () => {
    const t = await unlocked();
    await readContractView(t.deps, "preprod");
    const set = t.session.set.bind(t.session);
    t.session.set = async (key, value) => {
      if (key.startsWith(SESSION_CONTRACT_PREFIX)) throw new Error("Session storage quota bytes exceeded. Values were not stored.");
      await set(key, value);
    };

    const view = await readContractView(t.deps, "preprod");
    expect(view.owned.map(outpoint).sort()).toEqual(ownedUtxos.map(outpoint).sort());
    expect(t.session.data.has(SESSION_CONTRACT_PREFIX + "preprod")).toBe(false);
    await readContractView(t.deps, "preprod");
    expect(reads(t)).toEqual([null, `gt.${TOP - 2}`, null]);

    // Forgetting it can't be written either: it's gone, so the next read is full all the same.
    t.session.set = set;
    await readContractView(t.deps, "preprod");
    t.session.set = async () => {
      throw new Error("Session storage quota bytes exceeded. Values were not stored.");
    };
    await forgetContractView(t.deps, "preprod");
    expect(t.session.data.has(SESSION_CONTRACT_PREFIX + "preprod")).toBe(false);
  });

  describe("with many rows to check", () => {
    const wasm = loadTestWasm();
    const isOwned = wasm.SeedelfKey.prototype.isOwned;
    afterEach(() => vi.restoreAllMocks());

    /** Three batches of someone else's registers, and a hook into the first ownership check. */
    async function manyRows(first: (t: Awaited<ReturnType<typeof unlocked>>) => void) {
      const t = await unlocked();
      t.koios.added.push(
        ...Array.from({ length: 3 * OWNED_BATCH }, (_, i): KoiosUtxo => ({ ...THEIRS, tx_hash: hash(i, "c0"), asset_list: [] })),
      );
      const checks = vi.spyOn(wasm.SeedelfKey.prototype, "isOwned");
      checks.mockImplementationOnce(function (this: Wasm.SeedelfKey, register) {
        first(t);
        return isOwned.call(this, register);
      });
      return { t, checks };
    }

    it("checks them a batch at a time, so a page's request gets in between", async () => {
      let answeredAfter: number | undefined;
      const { t, checks } = await manyRows((t) => {
        void t.wallet.account("preprod").then(() => (answeredAfter = checks.mock.calls.length));
      });
      const view = await readContractView(t.deps, "preprod");
      expect(answeredAfter).toBeLessThanOrEqual(OWNED_BATCH);
      expect(checks.mock.calls.length).toBeGreaterThan(3 * OWNED_BATCH);
      expect(view.owned).toHaveLength(ownedUtxos.length);
    });

    it("ends cleanly when a lock gets in partway", async () => {
      let locked: Promise<void> | undefined;
      const { t, checks } = await manyRows((t) => void (locked = t.wallet.lock()));
      await expect(readContractView(t.deps, "preprod")).rejects.toThrow("locked");
      await locked;
      expect(checks.mock.calls.length).toBeLessThanOrEqual(OWNED_BATCH);
      expect(await t.wallet.state()).toBe("locked");
      expect(t.session.data.size).toBe(0);
    });
  });
});
