// The balance service over recorded preprod Koios responses: which contract
// UTxOs the wallet owns, the Cardano account with the gap limit, the cache,
// the lock, and a reading too large for session storage to keep.
import { describe, expect, it } from "vitest";

import { SESSION_ACCOUNT_ADDRESSES_PREFIX } from "../src/background/activity";
import { SESSION_ACCOUNT_UTXOS_PREFIX, TOO_LARGE } from "../src/background/coin-control";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_BALANCES_PREFIX } from "../src/background/wallet";
import { preprodAddress } from "./fixtures/bech32";
import { koiosPreprod, loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase = (words: number) =>
  vectors("cardano_account.json").find(
    (v) => v.account === 0 && v.phrase.split(" ").length === words && (words !== 24 || v.phrase.endsWith(" art")),
  )!;
const lovelaceOf = (utxos: Array<{ value: string }>) => utxos.reduce((n, u) => n + BigInt(u.value), 0n).toString();

describe("balances", () => {
  it("finds the 12-word phrase's contract UTxOs, Seedelf and Cardano account", async () => {
    const v = phrase(12);
    const t = testBalances();
    await t.wallet.create(v.phrase, PASSWORD);
    const b = await t.balances.get("preprod");

    expect(b).toMatchObject({ network: "preprod", updatedAt: t.clock.now });
    // Two owned UTxOs count; the one holding a seedelf is listed instead.
    expect(b.seedelf).toEqual({
      lovelace: "28000000",
      utxos: 2,
      tokens: [
        {
          policyId: "c0".repeat(28),
          assetName: Buffer.from("tUSDM").toString("hex"),
          quantity: "1234560000",
          decimals: 6,
          fingerprint: "asset1synthetictusdm",
        },
      ],
      seedelfs: [{ assetName: ownedUtxos[2]!.asset_list![0]!.asset_name, label: "web-wallet", lovelace: "1500000" }],
      locked: { lovelace: "0", tokens: [], utxos: 0 },
    });

    // Real preprod: this account has used 0/0, 0/1, 0/2 and 1/0.
    const account = koiosPreprod.accounts[v.preprod.stake]!;
    expect(b.cardano).toMatchObject({ utxos: 6, addressesUsed: 4, lovelace: lovelaceOf(account.account_utxos) });
  });

  it("owns none of the real contract UTxOs, or another phrase's", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(24).phrase, PASSWORD);
    const b = await t.balances.get("preprod");
    expect(b.seedelf).toEqual({ lovelace: "0", utxos: 0, tokens: [], seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 } });
  });

  it("ignores UTxOs that only borrow the account's stake key", async () => {
    const v = phrase(24);
    const t = testBalances();
    await t.wallet.create(v.phrase, PASSWORD);
    const b = await t.balances.get("preprod");

    // A script address on preprod carries this well-known phrase's stake key.
    const all = koiosPreprod.accounts[v.preprod.stake]!.account_utxos;
    const ours = all.filter((u) => !u.address.startsWith("addr_test1z"));
    expect(ours.length).toBe(all.length - 1);
    expect(b.cardano).toMatchObject({ utxos: ours.length, addressesUsed: 2, lovelace: lovelaceOf(ours) });
  });

  it("counts and spends everything under the account's payment keys, whatever the staking part", async () => {
    const v = phrase(12);
    const t = testBalances();
    await t.wallet.create(v.phrase, PASSWORD);
    // Receive key 0/0 at an enterprise address (no staking part), and paired with someone else's stake key.
    const key = loadTestWasm().CardanoAccount.fromPhrase(v.phrase, 0).paymentKeyHash(0, 0);
    const account = koiosPreprod.accounts[v.preprod.stake]!;
    // Koios rows like the recorded ones, but at these addresses.
    const stray = (n: string, address: string, value: string): KoiosUtxo => ({
      ...account.account_utxos[0]!,
      tx_hash: n.repeat(64),
      tx_index: 0,
      address,
      value,
      payment_cred: key,
      stake_address: null,
      asset_list: [],
    });
    t.koios.addedToAccounts.push(
      stray("e", preprodAddress(key), "40000000"),
      stray("f", preprodAddress(key, "ab".repeat(28)), "30000000"),
    );

    const b = await t.balances.get("preprod");
    expect(b.cardano).toMatchObject({
      utxos: account.account_utxos.length + 2,
      lovelace: (BigInt(lovelaceOf(account.account_utxos)) + 70_000_000n).toString(),
    });
    // They're spendable: WebAssembly signs for them with 0/0's key.
    const max = await t.moveIn.build("preprod", null, []);
    expect(max.inputs).toBe(account.account_utxos.length + 2);
  });

  it("serves the cached reading until asked to refresh", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(12).phrase, PASSWORD);
    const first = await t.balances.get("preprod");
    // The account, the contract and the stake key; the first time, the pool's ticker too.
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual([
      "account_addresses",
      "account_info",
      "credential_utxos",
      "credential_utxos",
      "pool_info",
    ]);

    t.clock.now += 5 * 60_000;
    expect(await t.balances.get("preprod")).toEqual(first);
    expect(t.koios.calls).toHaveLength(5);

    // The ticker is remembered for the session.
    const fresh = await t.balances.get("preprod", true);
    expect(fresh.updatedAt).toBe(t.clock.now);
    expect(t.koios.calls).toHaveLength(9);
  });

  it("shares one reading between pages asking at once", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(12).phrase, PASSWORD);
    const [a, b] = await Promise.all([t.balances.get("preprod", true), t.balances.get("preprod", true)]);
    expect(a).toEqual(b);
    expect(t.koios.calls).toHaveLength(5);
  });

  it("needs the wallet unlocked, and lock wipes the cache", async () => {
    const t = testBalances();
    await expect(t.balances.get("preprod")).rejects.toThrow("locked");
    await t.wallet.create(phrase(12).phrase, PASSWORD);
    await t.balances.get("preprod");
    expect(await t.session.get(`${SESSION_BALANCES_PREFIX}preprod`)).toBeDefined();

    await t.wallet.lock();
    expect(await t.session.get(`${SESSION_BALANCES_PREFIX}preprod`)).toBeUndefined();
    await expect(t.balances.get("preprod")).rejects.toThrow("locked");
  });

  it("drops a reading that finishes after a lock", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(12).phrase, PASSWORD);
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    const reading = t.balances.get("preprod", true);
    await new Promise((r) => setTimeout(r, 10));
    await t.wallet.lock();
    release();
    await expect(reading).rejects.toThrow("locked");
    expect(await t.session.get(`${SESSION_BALANCES_PREFIX}preprod`)).toBeUndefined();
  });
});

describe("a reading too large to keep", () => {
  const TOP = Math.max(...[...koiosPreprod.contract_utxos, ...ownedUtxos].map((u) => u.block_height ?? 0));
  const at = (u: KoiosUtxo) => `${u.tx_hash}#${u.tx_index}`;

  /**
   * `row` again with 1,200 tokens of a policy of its own, near the most a
   * UTxO's value may hold: what anyone can pay this wallet, on either side.
   * Twelve are past session storage's quota, counted once in the kept rows
   * and again in the balances.
   */
  const junk = (row: KoiosUtxo, i: number): KoiosUtxo => ({
    ...row,
    tx_hash: `e0${i.toString(16).padStart(62, "0")}`,
    tx_index: 0,
    block_height: TOP + 1,
    asset_list: Array.from({ length: 1_200 }, (_, n) => ({
      policy_id: i.toString(16).padStart(56, "ab"),
      asset_name: n.toString(16).padStart(4, "0"),
      fingerprint: `asset1${n.toString(36).padStart(38, "q")}`,
      decimals: 0,
      quantity: "1",
    })),
  });

  /** Chrome's session storage, as contract-scan.test.ts models it: 10 MB, counted as about 2.5 times the JSON. */
  function withQuota(t: ReturnType<typeof testBalances>, quota = 10_485_760) {
    const size = (key: string, json: string) => (key.length + json.length) * 2.5;
    const set = t.session.set.bind(t.session);
    t.session.set = async (key, value) => {
      let used = size(key, JSON.stringify(value));
      for (const [k, v] of t.session.data) if (k !== key) used += size(k, v as string);
      if (used > quota) throw new Error("Session storage quota bytes exceeded. Values were not stored.");
      await set(key, value);
    };
  }

  /** Which of the reading's large keys session storage holds. */
  const kept = (t: ReturnType<typeof testBalances>) =>
    [SESSION_BALANCES_PREFIX, SESSION_ACCOUNT_UTXOS_PREFIX].filter((prefix) => t.session.data.has(`${prefix}preprod`));

  it("is used anyway on the Seedelf side, with what's locked summed from it, and nothing older kept", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(12).phrase, PASSWORD);
    withQuota(t);
    // A UTxO the user locked, before anyone paid in junk.
    await t.balances.get("preprod");
    await t.coins.setLocked("preprod", "seedelf", at(ownedUtxos[0]!), true);
    expect(kept(t)).toHaveLength(2);

    t.koios.added.push(...Array.from({ length: 12 }, (_, i) => junk(ownedUtxos[0]!, i)));
    const b = await t.balances.get("preprod", true);
    expect(b.seedelf.utxos).toBe(14);
    expect(b.seedelf.tokens).toHaveLength(12 * 1_200 + 1);
    expect(b.seedelf.locked).toEqual({ lovelace: ownedUtxos[0]!.value, tokens: [], utxos: 1 });
    // The last reading's balances and UTxOs are gone, not left to be served in its place.
    expect(kept(t)).toEqual([]);
    expect(await t.balances.lastRead("preprod")).toBeUndefined();
    // The UTxOs and collateral screens say why they can't list them, rather than showing none.
    await expect(t.coins.lists("preprod")).rejects.toThrow(TOO_LARGE);
    await expect(t.coins.collateral("preprod")).rejects.toThrow(TOO_LARGE);

    // Asked again, it reads again; after a lock and an unlock too.
    const calls = t.koios.calls.length;
    await expect(t.balances.get("preprod")).resolves.toMatchObject({ seedelf: { utxos: 14 } });
    expect(t.koios.calls.length).toBeGreaterThan(calls);
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    await expect(t.balances.get("preprod")).resolves.toMatchObject({ seedelf: { utxos: 14, locked: { utxos: 1 } } });
    expect(kept(t)).toEqual([]);
  });

  it("is used anyway on the public side, where anyone can pay the account, and kept again once it fits", async () => {
    const v = phrase(24);
    const t = testBalances();
    await t.wallet.create(v.phrase, PASSWORD);
    withQuota(t);
    const before = await t.balances.get("preprod");
    // The collateral the wallet took is locked.
    expect(before.cardano.locked.utxos).toBe(1);

    const ours = koiosPreprod.accounts[v.preprod.stake]!.account_utxos.filter((u) => !u.address.startsWith("addr_test1z"));
    t.koios.addedToAccounts.push(...Array.from({ length: 12 }, (_, i) => junk(ours[0]!, i)));
    const b = await t.balances.get("preprod", true);
    expect(b.cardano.utxos).toBe(before.cardano.utxos + 12);
    expect(b.cardano.locked).toEqual(before.cardano.locked);
    expect(kept(t)).toEqual([]);
    // Activity's addresses are kept: they're small, and go first.
    expect(t.session.data.has(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`)).toBe(true);
    await expect(t.coins.lists("preprod")).rejects.toThrow(TOO_LARGE);

    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    await expect(t.balances.get("preprod")).resolves.toMatchObject({ cardano: { utxos: before.cardano.utxos + 12 } });

    // Once it fits again, it's kept, and the lists are back.
    t.koios.addedToAccounts.length = 0;
    const after = await t.balances.get("preprod", true);
    expect(after.cardano).toMatchObject({ utxos: before.cardano.utxos, locked: before.cardano.locked });
    expect(kept(t)).toHaveLength(2);
    expect((await t.coins.lists("preprod")).cardano).toHaveLength(before.cardano.utxos);
  });

  it("is dropped when it finishes after a lock, as any reading is", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(12).phrase, PASSWORD);
    withQuota(t);
    t.koios.added.push(...Array.from({ length: 12 }, (_, i) => junk(ownedUtxos[0]!, i)));
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    const reading = t.balances.get("preprod", true);
    await new Promise((r) => setTimeout(r, 10));
    await t.wallet.lock();
    release();
    await expect(reading).rejects.toThrow("locked");
    expect(t.session.data.size).toBe(0);
  });
});
