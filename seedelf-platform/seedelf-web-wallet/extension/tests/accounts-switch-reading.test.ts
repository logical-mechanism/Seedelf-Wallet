// A switch between public accounts while a reading is still running (release
// review C11). A reading asks Koios outside the wallet's queue, so a switch can
// land partway. Kept or shared, the old account's balance, UTxOs and addresses
// read as the new one's until Refresh: Send then took a payment to the account
// left for one that comes straight back, and Activity listed the old account.
import { describe, expect, it, vi } from "vitest";

import { SESSION_ACCOUNT_ACTIVITY_PREFIX, SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses } from "../src/background/activity";
import { SESSION_ACCOUNT_UTXOS_PREFIX } from "../src/background/coin-control";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_BALANCES_PREFIX, SESSION_PRIVATE_STALE_PREFIX } from "../src/background/wallet";
import type { Balances } from "../src/shared/rpc";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** The one vector phrase with both accounts recorded (24 words), as accounts.test.ts uses it. */
const phrase = (account: 0 | 1) =>
  vectors("cardano_account.json").find((v) => v.account === account && v.phrase.split(" ").length === 24)!;

type T = ReturnType<typeof testBalances>;

/** A wallet on account 0 that knows account 1 too, which holds 7 ₳ at its 0/0, and 40 ₳ more at account 0's. */
async function twoAccounts(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(phrase(0).phrase, PASSWORD);
  await t.accounts.recordFirst();
  t.koios.usedStakes.add(phrase(1).preprod.stake as string);
  await t.accounts.discover("preprod");
  t.koios.addedToAccounts.push(await utxoAt(t, 0, "a0", "40000000"), await utxoAt(t, 1, "a1", "7000000"));
  return t;
}

/** A UTxO at account `index`'s receive address 0/0. */
async function utxoAt(t: T, index: number, hash: string, value: string): Promise<KoiosUtxo> {
  const [address, key] = await t.wallet.withAccount(index, ({ cardano }) => [
    cardano.receiveAddress(t.deps.wasm.Network.Preprod, 0),
    cardano.paymentKeyHash(0, 0),
  ]);
  return {
    tx_hash: hash.repeat(32),
    tx_index: 0,
    address,
    value,
    stake_address: null,
    payment_cred: key,
    block_height: 1,
    block_time: 1,
    inline_datum: null,
    asset_list: [],
    reference_script: null,
  };
}

/** Holds the device's read of who paid for each Seedelf: a reading's last step before it's kept, after Koios. */
function holdBeforeKeep(t: T) {
  const get = t.local.get.bind(t.local);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const hit = new Promise<void>((r) => (reached = r));
  let once = true;
  t.local.get = async <V,>(key: string) => {
    if (once && key === "seedelf.private.mintedBy.preprod") {
      once = false;
      reached();
      await gate;
    }
    return get<V>(key);
  };
  return { hit, release };
}

/** Holds the first Koios request to `path`. */
function holdKoios(t: T, path: string) {
  const real = t.koios.fetch;
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const hit = new Promise<void>((r) => (reached = r));
  let once = true;
  t.koios.fetch = async (url, init) => {
    if (once && new URL(url).pathname.endsWith(`/${path}`)) {
      once = false;
      reached();
      await gate;
    }
    return real(url, init);
  };
  return { hit, release };
}

const kept = <V,>(t: T, key: string) => t.wallet.withKeys(() => t.session.get<V>(key + "preprod"));
const stakeOf = (t: T, index: number) => t.wallet.withAccount(index, ({ cardano }) => cardano.stakeAddress(t.deps.wasm.Network.Preprod));

describe("a switch while a reading is still running", () => {
  it("never keeps the reading as the new account's, nor hands it to the new account's Home", async () => {
    const t = await twoAccounts();
    const first = (await t.balances.get("preprod")).cardano.lovelace;
    const hold = holdBeforeKeep(t);
    // Home on account 0 reads (a Refresh, or a kept reading over a minute old)...
    const left = t.balances.get("preprod", true);
    await hold.hit;
    // ...and the user picks Account 2 before it ends. Home remounts on it and asks again, as App's account key makes it.
    await t.accounts.use(1, ["preprod"]);
    const shown = t.balances.get("preprod");
    hold.release();
    expect((await left).cardano.lovelace).toBe(first);
    const b = await shown;

    // Account 2's own: its 7 ₳, never account 1's.
    expect(b.cardano).toMatchObject({ lovelace: "7000000", utxos: 1 });
    // And what's kept is account 2's, so the next look, the UTxOs screen and Activity read it too.
    expect((await kept<AccountAddresses>(t, SESSION_ACCOUNT_ADDRESSES_PREFIX))?.stake).toBe(await stakeOf(t, 1));
    expect((await kept<Array<{ utxo: KoiosUtxo }>>(t, SESSION_ACCOUNT_UTXOS_PREFIX))?.map((p) => p.utxo.tx_hash)).toEqual(["a1".repeat(32)]);
    expect((await t.balances.get("preprod")).cardano.lovelace).toBe("7000000");

    // A payment to account 1 from account 2 is to another of the user's accounts, which ties the two on chain: never
    // "your own public account: it comes back, less the fee".
    const other = phrase(0).preprod.receive_0 as string;
    expect(await t.withdraw.resolve("preprod", other)).toMatchObject({ own: true, ownAccount: 0 });
  });

  it("gives the new account its own reading when the switch lands while the contract is read, never 'locked'", async () => {
    const t = await twoAccounts();
    const hold = holdKoios(t, "credential_utxos");
    const left = t.balances.get("preprod", true);
    await hold.hit;
    await t.accounts.use(1, ["preprod"]);
    const shown = t.balances.get("preprod");
    hold.release();
    // The reading the user left ends, as a lock partway ends one, and only the Home that left awaits it.
    await left.catch(() => undefined);
    const b = await shown;
    expect(b.cardano).toMatchObject({ lovelace: "7000000", utxos: 1 });
    expect(b.failed).toBeUndefined();
    expect(await t.wallet.state()).toBe("unlocked");
  });

  it("never keeps the private side read again for the account left as the new account's", async () => {
    const t = await twoAccounts();
    const first = (await t.balances.get("preprod")).cardano.lovelace;
    // A private spend landed: the next reading reads the contract alone, and keeps the account's side as it was.
    await t.wallet.withKeys(() => t.session.set(SESSION_PRIVATE_STALE_PREFIX + "preprod", true));
    const hold = holdBeforeKeep(t);
    const left = t.balances.get("preprod");
    await hold.hit;
    await t.accounts.use(1, ["preprod"]);
    hold.release();
    expect((await left).cardano.lovelace).toBe(first);
    // Nothing of account 1's is written back after the switch wiped it.
    expect(await kept<Balances>(t, SESSION_BALANCES_PREFIX)).toBeUndefined();
    expect((await t.balances.get("preprod")).cardano).toMatchObject({ lovelace: "7000000", utxos: 1 });
  });

  it("never tells the new account's Home that a reading of the account left failed", async () => {
    const t = await twoAccounts();
    await t.balances.get("preprod");
    // The account left's first request is held, then refused; its contract read lands and is kept meanwhile.
    const real = t.koios.fetch;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    t.koios.fetch = async (url, init) => {
      if (held || !url.includes("/account_addresses")) return real(url, init);
      held = true;
      await gate;
      return new Response("{}", { status: 400 });
    };
    let contractKept = false;
    const set = t.session.set.bind(t.session);
    t.session.set = async (key, value) => {
      if (key === "seedelf.contract.preprod") contractKept = true;
      await set(key, value);
    };
    const left = t.balances.get("preprod", true);
    await vi.waitFor(() => expect(held && contractKept).toBe(true));
    await t.accounts.use(1, ["preprod"]);
    expect((await t.balances.get("preprod")).cardano.lovelace).toBe("7000000");
    t.clock.now += 5_000;
    release();
    await expect(left).rejects.toThrow("refused the request (400");
    expect((await t.balances.get("preprod")).failed).toBeUndefined();
  });

  it("never keeps Public activity read for the account left as the new account's", async () => {
    const t = await twoAccounts();
    await t.balances.get("preprod");
    const hold = holdKoios(t, "account_txs");
    const left = t.activity.cardano("preprod");
    await hold.hit;
    await t.accounts.use(1, ["preprod"]);
    hold.release();
    await left;
    expect(await kept(t, SESSION_ACCOUNT_ACTIVITY_PREFIX)).toBeUndefined();
  });
});
