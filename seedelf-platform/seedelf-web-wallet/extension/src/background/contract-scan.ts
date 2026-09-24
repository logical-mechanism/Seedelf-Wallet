// The wallet contract, read so it scales. Koios's public tier allows 5,000
// requests a day and 1,000 rows a request, and the contract only grows, so a
// full read costs a request per 1,000 UTxOs. So it's read in full only after
// an unlock, every 30 minutes, or after the network refused a spent input;
// otherwise only the UTxOs newer than the last block seen, usually one request.
//
// Koios is asked the same thing either way, the whole contract (from a block
// on), so it still can't tell which UTxOs are ours: that's decided here, in
// WebAssembly. What's kept, in chrome.storage.session (wiped on lock), is only
// this wallet's own UTxOs and where each seedelf is (Send's lookup), never the
// whole contract.
//
// This wallet's own spends drop out as it makes them (spent.ts). A spend made
// with the same phrase elsewhere, or a rollback, shows at the next full read.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { CONTRACT_V1, ownedUtxos, type ContractConfig } from "./balances";
import { seedelfTokenOf } from "./chain";
import type { Koios, KoiosUtxo } from "./koios";
import { outpoint, readFresh, spentSet } from "./spent";
import type { Area } from "./storage";
import type { Wallet } from "./wallet";

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
  /** Every seedelf in the contract: its token name, and the UTxO holding it. */
  seedelfs: Record<string, KoiosUtxo>;
}

interface Kept extends ContractView {
  /** The highest block a read has seen. */
  height: number;
  /** When the contract was last read in full (ms since the epoch); 0 forces the next read to be full. */
  fullAt: number;
}

/** chrome.storage.session, per network. */
export const SESSION_CONTRACT_PREFIX = "seedelf.contract.";

/** How long a full read stands before the next read is full again. */
export const FULL_EVERY_MS = 30 * 60_000;

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
  const [kept, spent] = await wallet.withKeys(
    async () => [await session.get<Kept>(key), await spentSet(session)] as const,
  );
  const catchUp = !full && kept !== undefined && now() - kept.fullAt < FULL_EVERY_MS;
  const after = catchUp ? Math.max(0, kept.height - OVERLAP) : undefined;

  // Read outside the wallet's queue, so it never holds up a lock.
  const koios = deps.koios(network);
  const read = () => koios.credentialUtxos([contract.walletContractHash], after);
  const rows = await readFresh(spent, read, (r) => r, deps.sleep);

  return wallet.withKeys(async (keys) => {
    const owned = new Map(catchUp ? kept.owned.map((u) => [outpoint(u), u]) : []);
    const seedelfs: Record<string, KoiosUtxo> = catchUp ? { ...kept.seedelfs } : {};
    for (const u of ownedUtxos(wasm, keys, rows)) owned.set(outpoint(u), u);
    for (const u of rows) {
      const name = seedelfTokenOf(u, contract.seedelfPolicyId);
      if (name) seedelfs[name] = u;
    }
    for (const [name, u] of Object.entries(seedelfs)) if (spent.has(outpoint(u))) delete seedelfs[name];
    let height = catchUp ? kept.height : 0;
    for (const u of rows) height = Math.max(height, u.block_height ?? 0);
    const view: Kept = {
      owned: [...owned.values()].filter((u) => !spent.has(outpoint(u))),
      seedelfs,
      height,
      fullAt: catchUp ? kept.fullAt : now(),
    };
    await session.set(key, view);
    return { owned: view.owned, seedelfs: view.seedelfs };
  });
}

/** Makes the next read full: the network refused an input the kept view had as unspent. */
export async function forgetContractView(deps: Pick<ScanDeps, "wallet" | "session">, network: NetworkName) {
  const key = SESSION_CONTRACT_PREFIX + network;
  await deps.wallet.withKeys(async () => {
    const kept = await deps.session.get<Kept>(key);
    if (kept) await deps.session.set(key, { ...kept, fullAt: 0 });
  });
}
