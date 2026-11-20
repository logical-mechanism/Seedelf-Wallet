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
import { CONTRACT_V1, ownedUtxos as ownedOf } from "../src/background/balances";
import { registerOf } from "../src/background/chain";
import { type KoiosUtxo, trimmed } from "../src/background/koios";
import { outpoint, SESSION_SPENT } from "../src/background/spent";
import { WalletLocked } from "../src/background/wallet";
import { bech32Bytes, preprodAddress } from "./fixtures/bech32";
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

    // Chunk 51, t1k#3: a lock alone ends the read by itself (a locked wallet's turn throws), so the case above passes
    // without `same`'s check. A lock and an unlock between two batches give the next batch other keys, as Remove wallet
    // and a restore of another phrase do: the read ends, nothing of it kept, rather than judge some rows with one set of
    // keys and the rest with another.
    it("ends cleanly when the keys change between its batches: nothing of it kept", async () => {
      const { t, checks } = await manyRows((t) => {
        void t.wallet.lock();
        void t.wallet.unlock(PASSWORD);
      });
      await expect(readContractView(t.deps, "preprod")).rejects.toBeInstanceOf(WalletLocked);
      expect(checks.mock.calls.length).toBeLessThanOrEqual(OWNED_BATCH);
      expect(await t.wallet.state()).toBe("unlocked");
      expect(await t.session.get(SESSION_CONTRACT_PREFIX + "preprod")).toBeUndefined();
    });
  });
});

// Chunk 51, x2#2 (the trace verifier's test, and its class). Every Seedelf's register is public: its datum is on
// chain. A stranger re-randomizes one of the user's, (g^d, u^d), and pays about 1.34 ₳ (the least that output holds) to
// the enterprise KEY address whose key hash is the wallet contract's script hash, with that register as its inline
// datum. No key has that hash, so nobody can ever spend it: the stranger's 1.34 ₳ is burnt. Koios's credential_utxos
// takes bare 28-byte hashes, key or script alike, so asked for the contract's it lists this UTxO too, and the scan,
// judging a row by its register alone, kept it: the private balance counted 1.34 ₳ that can never move, and a Seedelf
// spend that takes it can't be built (the builder gives every input a Spend redeemer, and the wallet's evaluator, uplc's
// phase one, refuses one on a key-locked input), so Max, which takes every UTxO of a balance of 20 or fewer, was refused
// outright. A contract row is the wallet's only at the contract's SCRIPT (balances.ts `atContract`).
describe("a row at a KEY address with the contract's hash (chunk 51, x2#2)", () => {
  /** "This is a test.", a live preprod Seedelf the phrase doesn't own. */
  const THEIRS = transferPreprod.to;
  const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

  /**
   * The stranger's output, as Koios's credential_utxos lists it for the contract's hash: 1.34 ₳ at the enterprise KEY
   * address with that hash, under a fresh re-randomization of the user's register (read off the user's own UTxO).
   */
  function planted(): KoiosUtxo {
    const wasm = loadTestWasm();
    const found = registerOf(ownedUtxos[0]!)!;
    const base = new wasm.Register(found.generator, found.publicValue);
    const fresh = wasm.rerandomize(base);
    const datum = `d8799f5830${fresh.generator}5830${fresh.publicValue}ff`;
    base.free();
    fresh.free();
    return {
      ...ownedUtxos[0]!,
      tx_hash: "b2".repeat(32),
      tx_index: 0,
      address: preprodAddress(CONTRACT_V1.walletContractHash),
      value: "1340000",
      // The 28 bytes the endpoint matched, as Koios fills it whatever the credential's kind.
      payment_cred: CONTRACT_V1.walletContractHash,
      block_height: 9_000_000,
      inline_datum: { bytes: datum, value: null },
      asset_list: [],
    };
  }

  it("isn't the wallet's: the private balance doesn't count it, and Max still pays what the wallet can spend", async () => {
    const t = await unlocked();
    t.koios.evaluation = transferPreprod.evaluation;
    const row = planted();
    // The contract's preprod address is header 0x70 (enterprise, SCRIPT payment part); the stranger's is the same 28
    // bytes under header 0x60 (enterprise, KEY payment part), which no key spends.
    expect(hex(bech32Bytes(ownedUtxos[0]!.address))).toBe(`70${CONTRACT_V1.walletContractHash}`);
    expect(hex(bech32Bytes(row.address))).toBe(`60${CONTRACT_V1.walletContractHash}`);
    // Its register is the user's, re-randomized: what the wallet's ownership check accepts.
    const wasm = loadTestWasm();
    const reg = registerOf(row)!;
    const asRegister = new wasm.Register(reg.generator, reg.publicValue);
    let owned = false;
    await t.wallet.withKeys((keys) => void (owned = keys.seedelf.isOwned(asRegister)));
    asRegister.free();
    expect(owned).toBe(true);

    // Before it lands: 25 ₳, and 3 ₳ holding tUSDM, and Max spends both (as transfer.test.ts has it).
    const before = await t.balances.get("preprod");
    expect(before.seedelf).toMatchObject({ lovelace: "28000000", utxos: 2 });
    expect(await t.transfer.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }])).toMatchObject({ max: true, inputs: 2, left: 0 });

    // The stranger's output lands, and Koios lists it beside the contract's own.
    t.koios.added.push(row);
    const after = await t.balances.get("preprod", true);
    expect.soft(after.seedelf, "the private balance, with the stranger's unspendable 1.34 ₳ beside it").toMatchObject({
      lovelace: "28000000",
      utxos: 2,
    });
    const max = await t.transfer
      .build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }])
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(max, "Max, with the stranger's output beside the wallet's two").toMatchObject({ max: true, inputs: 2, left: 0 });
  });

  it("is never the user's, wherever a row is judged by its register: the same register at the contract is", async () => {
    const t = await unlocked();
    const row = planted();
    const atScript = { ...row, address: ownedUtxos[0]!.address, tx_hash: "b3".repeat(32) };
    const mine = await t.wallet.withKeys((keys) => ownedOf(loadTestWasm(), keys, [row, atScript]));
    expect(mine.map(outpoint)).toEqual([outpoint(atScript)]);
  });

  it("is no Seedelf's place either, so a name isn't looked for there", async () => {
    const t = await unlocked();
    const name = `5eed0e1f${"77".repeat(8)}`;
    t.koios.added.push({ ...planted(), asset_list: [{ policy_id: CONTRACT_V1.seedelfPolicyId, asset_name: name, quantity: "1", decimals: 0, fingerprint: "" }] });
    const view = await readContractView(t.deps, "preprod");
    expect(view.seedelfs[name]).toBeUndefined();
    expect(view.owned.map(outpoint)).not.toContain(`${"b2".repeat(32)}#0`);
  });
});
