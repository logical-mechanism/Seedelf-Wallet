// A balance reading still running when the wallet is removed and another phrase restored (chunk 51, e4a#1, reported
// again as e6#2). A reading asks Koios outside the wallet's queue, and the BalanceService, with the readings it has in
// flight, outlives the reset. Its last step checked only the public account's index, 0 for both phrases. So a reading
// begun under phrase A was handed to phrase B's Home and kept as B's reading, whose keys then made A's addresses read
// as B's own; A's private UTxOs went into B's sealed history, and used up its first-reading mark, so B's own UTxO from
// before was noted as a payment received. Each reading is now tied to the phrase it began under (wallet.ts
// `phrasePin`): another phrase's Home never joins it, and it ends as a lock ends one, nothing kept. The same phrase,
// across a lock, still keeps its reading.
import { describe, expect, it, vi } from "vitest";

import { SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses } from "../src/background/activity";
import { handle, type Context } from "../src/background/handlers";
import type { KoiosUtxo } from "../src/background/koios";
import { NetworkChoice } from "../src/background/preferences";
import { SESSION_BALANCES_PREFIX, SESSION_PRIVATE_STALE_PREFIX } from "../src/background/wallet";
import type { NetworkName } from "../src/networks";
import { UNKNOWN } from "../src/shared/histories";
import type { ActivityEntry, Balances, Message, Status } from "../src/shared/rpc";
import { koiosPreprod, loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** Each case reads the contract in WebAssembly for both phrases, and restores one. */
const SLOW = { timeout: 120_000 };
const vector = (words: number, last: string) =>
  vectors("cardano_account.json").find(
    (v) => v.account === 0 && v.phrase.split(" ").length === words && v.phrase.endsWith(` ${last}`),
  )!;
/** Owns owned-utxos.json's contract UTxOs (28 ₳ counted, and a Seedelf), and a recorded preprod account. */
const A = vector(12, "about").phrase as string;
/** A's first receiving address. */
const A_RECEIVE = vector(12, "about").preprod.receive_0 as string;
/** No account on preprod, and one contract UTxO of its own (`contractUtxoOf`). */
const B = vector(24, "title").phrase as string;
/** A's private UTxOs: 25 ₳, and 3 ₳ with tUSDM. */
const A_PRIVATE = ["a1".repeat(32), "a2".repeat(32)];

type T = ReturnType<typeof testBalances>;

function context(t: T): Context {
  const networks: NetworkName[] = ["preprod", "mainnet"];
  return {
    ...(t as unknown as Context),
    wasm: loadTestWasm(),
    connector: async (on) => on,
    version: "1.0.0",
    network: "preprod",
    networks,
    networkChoice: new NetworkChoice(t.local, networks),
  };
}

const ask = (message: Message, ctx: Context) => handle(message, ctx);

/** A contract UTxO under a fresh re-randomization of `words`' Seedelf register: 9 ₳, made long before this device. */
function contractUtxoOf(words: string, txHash: string): KoiosUtxo {
  const wasm = loadTestWasm();
  const entropy = wasm.phraseToEntropy(words);
  const key = wasm.SeedelfKey.fromEntropy(entropy, 0);
  try {
    const datum = Buffer.from(wasm.registerToDatum(wasm.rerandomize(key.baseRegister()))).toString("hex");
    return { ...ownedUtxos[0]!, tx_hash: txHash, tx_index: 0, value: "9000000", asset_list: [], inline_datum: { bytes: datum, value: {} } };
  } finally {
    key.free();
    entropy.fill(0);
  }
}

/** A gate that holds the first request it's asked about until released. */
function gate() {
  let release!: () => void;
  let reached!: () => void;
  const open = new Promise<void>((r) => (release = r));
  const hit = new Promise<void>((r) => (reached = r));
  return { open, hit, release, reached };
}

/** Holds the first `credential_utxos` asking for the account's payment keys, not the contract's: Koios slow on it. */
function holdAccountUtxos(t: T) {
  const real = t.koios.fetch;
  const g = gate();
  let once = true;
  t.koios.fetch = async (url, init) => {
    if (once && new URL(url).pathname.endsWith("/credential_utxos")) {
      const asked: string[] = JSON.parse(String(init.body))._payment_credentials;
      if (!asked.includes(koiosPreprod.wallet_contract)) {
        once = false;
        g.reached();
        await g.open;
      }
    }
    return real(url, init);
  };
  return g;
}

/** Holds the first `account_addresses`, then answers it as Koios would, or (`refused`) refuses it. */
function holdAccountAddresses(t: T, { refused = false } = {}) {
  const real = t.koios.fetch;
  const g = gate();
  let once = true;
  t.koios.fetch = async (url, init) => {
    if (once && new URL(url).pathname.endsWith("/account_addresses")) {
      once = false;
      g.reached();
      await g.open;
      if (refused) return new Response("{}", { status: 400 });
    }
    return real(url, init);
  };
  return g;
}

/** Holds the device's read of who paid for each Seedelf: a reading's last step before it's kept, after Koios. */
function holdBeforeKeep(t: T) {
  const get = t.local.get.bind(t.local);
  const g = gate();
  let once = true;
  t.local.get = async <V,>(key: string) => {
    if (once && key === "seedelf.private.mintedBy.preprod") {
      once = false;
      g.reached();
      await g.open;
    }
    return get<V>(key);
  };
  return g;
}

/** Marks when the contract's part of a reading has been kept. */
function watchContractKept(t: T): () => boolean {
  let kept = false;
  const set = t.session.set.bind(t.session);
  t.session.set = async (key, value) => {
    if (key === "seedelf.contract.preprod") kept = true;
    await set(key, value);
  };
  return () => kept;
}

/** Phrase A's wallet, made here, with phrase B's own contract UTxO on chain too. */
async function walletA() {
  const t = testBalances();
  const ctx = context(t);
  const bOwn = contractUtxoOf(B, "b1".repeat(32));
  t.koios.added.push(bOwn);
  expect(((await ask({ type: "create-wallet", phrase: A, password: PASSWORD }, ctx)) as Status).state).toBe("unlocked");
  return { t, ctx, bOwn };
}

/** Settings' Remove wallet, then a restore of phrase B, which starts on account 0 as A was. */
async function removeAndRestoreB(ctx: Context) {
  expect(((await ask({ type: "reset-wallet", force: true }, ctx)) as Status).state).toBe("no-wallet");
  expect(((await ask({ type: "restore-wallet", phrase: B, password: PASSWORD }, ctx)) as Status).state).toBe("unlocked");
}

const keptOf = <V,>(t: T, key: string) => t.wallet.withKeys(() => t.session.get<V>(key + "preprod"));
const historyOf = async (ctx: Context) => ((await ask({ type: "history", of: "seedelf" }, ctx)) as { entries: ActivityEntry[] }).entries;

describe("a balance reading still running when the wallet is removed and another phrase restored (chunk 51, e4a#1, e6#2)", () => {
  it("is never the new phrase's: not handed to its Home, not kept as its reading, not sealed into its history", SLOW, async () => {
    const { t, ctx, bOwn } = await walletA();
    // The contract's part ends first and is kept; the account's UTxOs are slow at Koios.
    const contractKept = watchContractKept(t);
    const hold = holdAccountUtxos(t);
    // A's Home asks for its first reading.
    const left = ask({ type: "balances" }, ctx);
    await hold.hit;
    await vi.waitFor(() => expect(contractKept()).toBe(true), { timeout: 10_000 });
    // The stake key's standing, asked beside them, answers meanwhile (in memory here: a few turns of the event loop).
    await vi.waitFor(() => expect(t.koios.calls.some((c) => c.path === "account_info")).toBe(true), { timeout: 10_000 });
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));

    await removeAndRestoreB(ctx);
    // B's Home asks while A's reading is still out; then Koios answers A's.
    const shown = ask({ type: "balances" }, ctx);
    hold.release();
    await left.catch(() => undefined);
    const b = (await shown) as Balances;
    const bStake = await t.wallet.withKeys(({ cardano }) => cardano.stakeAddress(t.deps.wasm.Network.Preprod));

    // B's Home shows B's money: its own 9 ₳ private UTxO and an empty account. Never A's 28 ₳, A's Seedelf, A's account.
    expect.soft(b.seedelf, "B's Home: private side").toMatchObject({ lovelace: "9000000", utxos: 1, seedelfs: [] });
    expect.soft(b.cardano, "B's Home: public side").toMatchObject({ lovelace: "0", utxos: 0 });
    // What's kept for B's next look (Home, the UTxOs screen, Public activity) is B's, never A's reading or addresses.
    expect.soft((await keptOf<Balances>(t, SESSION_BALANCES_PREFIX))?.seedelf.lovelace, "kept reading: private side").toBe("9000000");
    expect.soft((await keptOf<AccountAddresses>(t, SESSION_ACCOUNT_ADDRESSES_PREFIX))?.stake, "kept addresses: stake key").toBe(bStake);
    // The kept keys also say which addresses are the account's (destination.ts ownAccount, the wasm is_own_address):
    // Send and Make public never call an address of A's this account's own, "it comes back, less the fee".
    const destination = (await ask({ type: "resolve-destination", to: A_RECEIVE }, ctx)) as { own: boolean };
    expect.soft(destination.own, "Send: A's address as B's own").toBe(false);

    // After a Refresh, B's private Activity lists B's own UTxO alone, as one from before this device's history began
    // (the restore's rule): none of A's payments, which a sealed history keeps for good.
    await ask({ type: "balances", refresh: true }, ctx);
    const entries = await historyOf(ctx);
    expect.soft(entries.map((e) => e.txHash), "B's private Activity: transactions").toEqual([bOwn.tx_hash]);
    expect.soft(entries.find((e) => e.txHash === bOwn.tx_hash)?.origin, "B's own UTxO: its history").toEqual(UNKNOWN);
  });

  it("nor is the private side read again after a landing: never kept as B's, nor sealed into B's history", SLOW, async () => {
    const { t, ctx, bOwn } = await walletA();
    // A's Home keeps a reading; then a private spend lands, and only the private side is read again (pending.ts).
    await ask({ type: "balances" }, ctx);
    await t.wallet.withKeys(() => t.session.set(SESSION_PRIVATE_STALE_PREFIX + "preprod", true));
    const hold = holdBeforeKeep(t);
    const left = ask({ type: "balances" }, ctx);
    await hold.hit;

    await removeAndRestoreB(ctx);
    hold.release();
    await left.catch(() => undefined);

    // Nothing of A's is kept for B's Home: its first look reads B's own.
    expect.soft(await keptOf<Balances>(t, SESSION_BALANCES_PREFIX), "kept reading").toBeUndefined();
    expect.soft((await historyOf(ctx)).map((e) => e.txHash), "B's sealed history").toEqual([]);
    const b = (await ask({ type: "balances" }, ctx)) as Balances;
    expect.soft(b.seedelf, "B's Home: private side").toMatchObject({ lovelace: "9000000", utxos: 1, seedelfs: [] });
    expect.soft((await historyOf(ctx)).find((e) => e.txHash === bOwn.tx_hash)?.origin, "B's own UTxO: its history").toEqual(UNKNOWN);
  });

  it("never tells B's Home that it failed", SLOW, async () => {
    const { t, ctx } = await walletA();
    const contractKept = watchContractKept(t);
    // Koios holds A's account read, then refuses it.
    const hold = holdAccountAddresses(t, { refused: true });
    const left = ask({ type: "balances" }, ctx);
    left.catch(() => undefined);
    await hold.hit;
    await vi.waitFor(() => expect(contractKept()).toBe(true), { timeout: 10_000 });

    await removeAndRestoreB(ctx);
    try {
      // B's Home reads its own, never waiting on A's, and it's kept.
      const joined = new Promise((r) => setTimeout(() => r("still waiting on A's reading"), 10_000));
      expect(await Promise.race([ask({ type: "balances" }, ctx), joined])).toMatchObject({ seedelf: { lovelace: "9000000" } });
    } finally {
      // A's reading is refused after B's was made.
      t.clock.now += 5_000;
      hold.release();
    }
    await expect(left).rejects.toThrow("refused the request (400");
    expect(((await ask({ type: "balances" }, ctx)) as Balances).failed).toBeUndefined();
  });

  it("never asks Koios about B's keys beside A's stake address", SLOW, async () => {
    const { t, ctx } = await walletA();
    // A's account read is held at its first request, the addresses A's stake key has used.
    const hold = holdAccountAddresses(t);
    const left = ask({ type: "balances" }, ctx);
    await hold.hit;

    await removeAndRestoreB(ctx);
    const bKey = await t.wallet.withKeys(({ cardano }) => cardano.paymentKeyHash(0, 0));
    const from = t.koios.calls.length;
    hold.release();
    await expect(left).rejects.toThrow("The wallet is locked.");
    // B's Home hasn't asked anything: whatever asks about B's payment keys now is A's reading, carried on under B's.
    const asked = t.koios.calls
      .slice(from)
      .filter((c) => c.path === "credential_utxos" && (c.body._payment_credentials as string[]).includes(bKey));
    expect(asked).toEqual([]);
    expect(await keptOf<Balances>(t, SESSION_BALANCES_PREFIX)).toBeUndefined();
  });

  it("control: one across a lock and an unlock of the same phrase is kept, as before", SLOW, async () => {
    const { t, ctx } = await walletA();
    const contractKept = watchContractKept(t);
    const hold = holdAccountUtxos(t);
    const left = ask({ type: "balances" }, ctx);
    await hold.hit;
    await vi.waitFor(() => expect(contractKept()).toBe(true), { timeout: 10_000 });

    await ask({ type: "lock" }, ctx);
    expect(await t.wallet.unlock(PASSWORD)).toMatchObject({ unlocked: true });
    hold.release();
    const a = (await left) as Balances;
    expect(a.seedelf).toMatchObject({ lovelace: "28000000", utxos: 2 });
    expect((await keptOf<Balances>(t, SESSION_BALANCES_PREFIX))?.seedelf.lovelace).toBe("28000000");
    expect((await historyOf(ctx)).map((e) => e.txHash).sort()).toEqual(A_PRIVATE);
  });
});
