// What the tests of Lovejoin's chains share (chain-*.test.ts, public-mix-*.test.ts):
// an unlocked wallet with a session holding ADA, or a public account with
// collateral, Lovejoin's recorded preprod pool, and a model of the network's
// mempool that refuses a chain's transaction whose parent it doesn't have.
import { readFileSync } from "node:fs";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, sessionSwap, testBalances, vectors } from "./fakes";

export const PASSWORD = "correct horse battery";
export const HOUR = 3_600_000;
export const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
export const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

/** Real chains are built and measured in WebAssembly: a few seconds each, more on CI. */
export const CHAINS = { timeout: 60_000 };

/** Ogmios's answer when the network measures no more than a transaction declares. */
export const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

export type Tested = ReturnType<typeof testBalances>;

/** A UTxO at session 0's account, as Koios lists it. */
export function atSession(tx_hash: string, tx_index: number, value: string): KoiosUtxo {
  return {
    tx_hash,
    tx_index,
    address: sessionSwap.address,
    value,
    stake_address: null,
    payment_cred: sessionSwap.keyHash,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    is_spent: false,
    asset_list: [],
  } as KoiosUtxo;
}

/** Sessions wired to `t`'s Lovejoin, sleeping with `sleep`. */
export function sessionsOf(t: Tested, sleep: (ms: number) => Promise<void> = async () => undefined, lovejoin = t.lovejoin) {
  return new SessionService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin,
    sleep,
  });
}

/** An unlocked wallet with a site's private session 0 holding `lovelace` and its 5 ₳ collateral, and Lovejoin's pool. */
export async function withSession(lovelace: string) {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
        site: { origin: "https://example.org" },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, lovelace), atSession("c2".repeat(32), 1, "5000000"), ...POOL);
  t.koios.evaluation = AGREES;
  return { t, sessions: sessionsOf(t) };
}

/**
 * An unlocked wallet with collateral and `lovelace` in its public account
 * (`e6…#0`), and Lovejoin's pool. `more`: another UTxO of ADA alone in it
 * for each, `e7…#0` on.
 */
export async function publicFunded(lovelace = "60000000", more: string[] = []) {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = AGREES;
  t.koios.addedToAccounts.push(...POOL);
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  const keyHash = await t.wallet.withKeys((keys) => keys.cardano.paymentKeyHash(0, 0));
  const at = (tx: string, value: string) => ({ ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, payment_cred: keyHash, asset_list: [] });
  t.koios.addedToAccounts.push(at("e5", "5000000"), at("e6", lovelace), ...more.map((value, k) => at((0xe7 + k).toString(16), value)));
  return t;
}

/** Lovejoin on `t`'s fakes, with its own `sleep` and whatever else a test changes. */
export function lovejoinOf(t: Tested, extra: Partial<ConstructorParameters<typeof LovejoinService>[0]> = {}) {
  return new LovejoinService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    ...extra,
  });
}

const BAD_INPUTS = "ConwayUtxowFailure (UtxoFailure (BadInputsUTxO (fromList [])))";

/**
 * The network as a chain meets it: a transaction of `order()` (the chain's
 * hashes, in order) goes in the mempool at its submit, unless it's there or
 * on chain already, or the one before it is neither: then it's refused as
 * spending what's spent, as a node refuses it. A block takes the mempool's
 * oldest few; a node can drop the rest. tx_status knows only what's on
 * chain. Everything else goes to the fake as it was.
 */
export function chainNet(t: Tested, order: () => string[]) {
  const fetch = t.koios.fetch;
  const net = {
    mempool: [] as string[],
    landed: new Set<string>(),
    submits: [] as string[],
    refused: 0,
    /** The oldest `n` in the mempool land. */
    block(n = 3) {
      for (const h of net.mempool.splice(0, n)) net.landed.add(h);
    },
    /** A node drops what's in the mempool. */
    drop() {
      net.mempool.length = 0;
    },
  };
  t.koios.fetch = async (url, init) => {
    if (url.endsWith("/submittx")) {
      const id = txIdOf(new Uint8Array(init!.body as Uint8Array));
      const chain = order();
      const k = chain.indexOf(id);
      if (k >= 0) {
        net.submits.push(id);
        const there = (h: string) => net.landed.has(h) || net.mempool.includes(h);
        if (there(id) || (k > 0 && !there(chain[k - 1]!))) {
          net.refused++;
          return new Response(BAD_INPUTS, { status: 400 });
        }
        net.mempool.push(id);
      }
      return fetch(url, init);
    }
    if (url.endsWith("/tx_status")) {
      const { _tx_hashes } = JSON.parse(String(init!.body)) as { _tx_hashes: string[] };
      return Response.json(_tx_hashes.map((tx_hash) => ({ tx_hash, num_confirmations: net.landed.has(tx_hash) ? 1 : null })));
    }
    return fetch(url, init);
  };
  return net;
}
