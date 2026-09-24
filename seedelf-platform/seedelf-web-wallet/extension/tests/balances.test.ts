// The balance service over recorded preprod Koios responses: which contract
// UTxOs the wallet owns, the Cardano account with the gap limit, the cache,
// and the lock.
import { describe, expect, it } from "vitest";

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
  it("finds the 12-word phrase's contract UTxOs, seedelf and Cardano account", async () => {
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
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["account_addresses", "credential_utxos", "credential_utxos"]);

    t.clock.now += 5 * 60_000;
    expect(await t.balances.get("preprod")).toEqual(first);
    expect(t.koios.calls).toHaveLength(3);

    const fresh = await t.balances.get("preprod", true);
    expect(fresh.updatedAt).toBe(t.clock.now);
    expect(t.koios.calls).toHaveLength(6);
  });

  it("shares one reading between pages asking at once", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(12).phrase, PASSWORD);
    const [a, b] = await Promise.all([t.balances.get("preprod", true), t.balances.get("preprod", true)]);
    expect(a).toEqual(b);
    expect(t.koios.calls).toHaveLength(3);
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
