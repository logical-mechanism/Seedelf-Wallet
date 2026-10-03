// The wallet contract, read so it scales. Koios's public tier allows 5,000
// requests a day and 1,000 rows a request, and the contract only grows, so a
// full read costs a request per 1,000 UTxOs. So it's read in full only after
// an unlock, every 30 minutes, or after the network refused a spent input;
// otherwise only the UTxOs newer than the last block seen, usually one request.
//
// Koios is asked the same thing either way, the whole contract (from a block
// on), so it still can't tell which UTxOs are ours: that's decided here, in
// WebAssembly, a batch of rows at a time so a lock or a page's request never
// waits for the whole contract. What's kept, in chrome.storage.session (wiped
// on lock), is only this wallet's own UTxOs and where each seedelf is (Send's
// lookup), never the whole contract.
//
// Session storage holds 10 MB for the whole extension, and anyone can add
// seedelfs to the contract, each in a UTxO with as many tokens as it holds.
// So another wallet's seedelf is kept as a few hundred bytes (a Locator: its
// outpoint, address and register), never as Koios's row. And a view that
// still can't be kept is used anyway: nothing is kept, and the next read is
// full.
//
// This wallet's own spends drop out as it makes them (spent.ts). A spend made
// with the same phrase elsewhere, or a rollback, shows at the next full read.

import { t } from "../i18n";
import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { CONTRACT_V1, ownedUtxos, type ContractConfig } from "./balances";
import { registerOf, seedelfTokenOf, type RegisterHex } from "./chain";
import type { Koios, KoiosUtxo } from "./koios";
import { outpoint, readFresh, spentSet, wait } from "./spent";
import type { Area } from "./storage";
import type { Keys, Wallet } from "./wallet";

export interface ScanDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  session: Area;
  koios: (network: NetworkName) => Koios;
  now: () => number;
  contract?: ContractConfig;
  sleep?: (ms: number) => Promise<void>;
}

/** What the wallet needs from the contract. */
export interface ContractView {
  /** This wallet's UTxOs in the contract (its register), less what it has spent. */
  owned: KoiosUtxo[];
  /**
   * Every seedelf in the contract: its token name, and the UTxO holding it.
   * This wallet's own come as their whole rows (Remove spends them); another
   * wallet's as only what paying it reads (`seedelfRow`).
   */
  seedelfs: Record<string, KoiosUtxo>;
}

/** Where a seedelf is: all Send needs to pay it. */
interface Locator {
  txHash: string;
  txIndex: number;
  address: string;
  /** Its register, when its datum is one; without it, it can't be paid. */
  register?: RegisterHex;
}

interface Kept {
  owned: KoiosUtxo[];
  seedelfs: Record<string, Locator>;
  /** The highest block a read has seen. */
  height: number;
  /** When the contract was last read in full (ms since the epoch); 0 forces the next read to be full. */
  fullAt: number;
}

/** chrome.storage.session, per network. */
export const SESSION_CONTRACT_PREFIX = "seedelf.contract.";

/** How long a full read stands before the next read is full again. */
export const FULL_EVERY_MS = 30 * 60_000;

/** Rows checked for ours in one turn of the wallet's queue: a few hundred milliseconds on a slow machine. */
export const OWNED_BATCH = 200;

/** Blocks read again on a catch-up, in case one was only part-read. */
const OVERLAP = 2;

/** Reads the contract: in full when due (or `full`), otherwise only what's new. Throws if locked. */
export async function readContractView(
  deps: ScanDeps,
  network: NetworkName,
  { full = false } = {},
): Promise<ContractView> {
  const { wasm, wallet, session, now, contract = CONTRACT_V1 } = deps;
  const key = SESSION_CONTRACT_PREFIX + network;
  // Every step runs with the keys it started with: a lock (or another wallet
  // restored) partway through ends the read, with nothing kept.
  let started: Keys | undefined;
  const same = (keys: Keys) => {
    started ??= keys;
    if (keys !== started) throw new Error(t("worker.locked"));
  };
  const [kept, spent] = await wallet.withKeys(async (keys) => {
    same(keys);
    return [await session.get<Kept>(key), await spentSet(session)] as const;
  });
  const catchUp = !full && kept !== undefined && now() - kept.fullAt < FULL_EVERY_MS;
  const after = catchUp ? Math.max(0, kept.height - OVERLAP) : undefined;

  // Read outside the wallet's queue, so it never holds up a lock.
  const koios = deps.koios(network);
  const read = () => koios.credentialUtxos([contract.walletContractHash], after);
  const rows = await readFresh(spent, read, (r) => r, deps.sleep);

  // Which rows are ours: a batch at a time, each its own turn in the queue,
  // with the worker's other events let in between.
  const mine: KoiosUtxo[] = [];
  for (let i = 0; i < rows.length; i += OWNED_BATCH) {
    if (i > 0) await wait(0);
    const batch = rows.slice(i, i + OWNED_BATCH);
    mine.push(
      ...(await wallet.withKeys((keys) => {
        same(keys);
        return ownedUtxos(wasm, keys, batch);
      })),
    );
  }

  return wallet.withKeys(async (keys) => {
    same(keys);
    const owned = new Map(catchUp ? kept.owned.map((u) => [outpoint(u), u]) : []);
    const seedelfs: Record<string, Locator> = catchUp ? { ...kept.seedelfs } : {};
    for (const u of mine) owned.set(outpoint(u), u);
    for (const u of rows) {
      const name = seedelfTokenOf(u, contract.seedelfPolicyId);
      if (name) seedelfs[name] = locatorOf(u);
    }
    for (const [name, at] of Object.entries(seedelfs)) if (spent.has(`${at.txHash}#${at.txIndex}`)) delete seedelfs[name];
    let height = catchUp ? kept.height : 0;
    for (const u of rows) height = Math.max(height, u.block_height ?? 0);
    const next: Kept = {
      owned: [...owned.values()].filter((u) => !spent.has(outpoint(u))),
      seedelfs,
      height,
      fullAt: catchUp ? kept.fullAt : now(),
    };
    await keep(session, key, next);
    return viewOf(next, contract);
  });
}

/** The view as the last read left it, without reading anything; undefined before the first. Call it while unlocked. */
export async function keptContractView(
  session: Area,
  network: NetworkName,
  contract: ContractConfig = CONTRACT_V1,
): Promise<ContractView | undefined> {
  const kept = await session.get<Kept>(SESSION_CONTRACT_PREFIX + network);
  return kept && viewOf(kept, contract);
}

/** Makes the next read full: the network refused an input the kept view had as unspent. */
export async function forgetContractView(deps: Pick<ScanDeps, "wallet" | "session">, network: NetworkName) {
  const key = SESSION_CONTRACT_PREFIX + network;
  await deps.wallet.withKeys(async () => {
    const kept = await deps.session.get<Kept>(key);
    if (kept) await keep(deps.session, key, { ...kept, fullAt: 0 });
  });
}

/**
 * Keeps the view for the next read. A write session storage refuses (it's
 * full) never fails the read: nothing is kept instead, so the next read is
 * full, and this one goes on with the view it has.
 */
async function keep(session: Area, key: string, kept: Kept): Promise<void> {
  try {
    await session.set(key, kept);
  } catch {
    await session.remove(key).catch(() => undefined);
  }
}

function locatorOf(u: KoiosUtxo): Locator {
  const register = registerOf(u);
  return { txHash: u.tx_hash, txIndex: u.tx_index, address: u.address, ...(register ? { register } : {}) };
}

function viewOf(kept: Kept, contract: ContractConfig): ContractView {
  const owned = new Map(kept.owned.map((u) => [outpoint(u), u]));
  const seedelfs: Record<string, KoiosUtxo> = {};
  for (const [name, at] of Object.entries(kept.seedelfs)) {
    seedelfs[name] = owned.get(`${at.txHash}#${at.txIndex}`) ?? seedelfRow(contract, name, at);
  }
  return { owned: kept.owned, seedelfs };
}

/**
 * Another wallet's seedelf as a Koios row again, with what paying it reads:
 * WebAssembly checks it's in the contract, holds that seedelf and sits under
 * a register (`recipient_register`), and Send shows its address. Its ADA and
 * any other tokens aren't kept: it's never an input.
 */
function seedelfRow(contract: ContractConfig, name: string, at: Locator): KoiosUtxo {
  const g = at.register?.generator;
  const u = at.register?.publicValue;
  const row = {
    tx_hash: at.txHash,
    tx_index: at.txIndex,
    address: at.address,
    value: "0",
    stake_address: null,
    payment_cred: contract.walletContractHash,
    block_height: 0,
    // Constructor 0 of two 48-byte fields, as Koios gives it: the CBOR, which WebAssembly reads, and the JSON.
    inline_datum:
      g && u ? { bytes: `d8799f5830${g}5830${u}ff`, value: { constructor: 0, fields: [{ bytes: g }, { bytes: u }] } } : null,
    asset_list: [{ policy_id: contract.seedelfPolicyId, asset_name: name, quantity: "1", decimals: 0, fingerprint: "" }],
    reference_script: null,
    // WebAssembly's row has these too; nothing here reads them.
    epoch_no: 0,
    block_time: 0,
    is_spent: false,
  };
  return row;
}
