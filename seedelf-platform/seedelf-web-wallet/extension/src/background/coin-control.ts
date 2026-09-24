// Coin control: the UTxOs the user keeps out of every payment, on both
// sides, and the Cardano account's collateral.
//
// Locked  A locked UTxO is left out of everything that spends that side,
//         Max included: the builders only ever see what's unlocked.
// Collateral  One pure-ADA 5 ₳ UTxO under the account, put up by anything
//         the account signs that runs a script (an account-paid seedelf
//         mint), and otherwise never spent. As in Lace, it's a UTxO set
//         aside, not an amount. With none chosen, the wallet takes the
//         oldest pure 5 ₳ UTxO the account holds, so a UTxO another wallet
//         with the same phrase uses as its collateral stays put. Reclaiming
//         it returns it to the balance, and then the wallet takes none by
//         itself until one is set again. Seedelf spends never use it:
//         giveme.my lends theirs (privacy rule 2).
//
// The choices say which UTxOs are the user's (a Seedelf UTxO's outpoint is
// exactly what the contract hides), so they're sealed in the private store,
// per network. Nothing here asks Koios anything: the lists come from the
// last balance reading and the contract scan, in session storage.

import type { NetworkName } from "../networks";
import type { Balances, CollateralStatus, Locked, UtxoInfo, UtxoLists, UtxoSide } from "../shared/rpc";
import type { PathedUtxo } from "./account";
import { CONTRACT_V1, type ContractConfig } from "./balances";
import { seedelfLabel, seedelfTokenOf, sumValue } from "./chain";
import { keptContractView } from "./contract-scan";
import type { KoiosUtxo } from "./koios";
import type { PrivateStore } from "./private-store";
import { outpoint, spentSet } from "./spent";
import type { Area } from "./storage";
import { SESSION_BALANCES_PREFIX, type Wallet } from "./wallet";

/** chrome.storage.session, per network: the account's UTxOs at the last balance reading, with their paths. */
export const SESSION_ACCOUNT_UTXOS_PREFIX = "seedelf.accountUtxos.";

/** What a collateral holds: 5 ₳, as Lace and the CLI use. */
export const COLLATERAL_LOVELACE = 5_000_000n;

/** A collateral payment is waited for this long before the wallet stops expecting it. */
const WAIT_MS = 10 * 60_000;

/** What the user chose on one network, sealed as `coins.<network>`. */
export interface Choices {
  /** Locked outpoints (`txhash#index`), per side. */
  seedelf: string[];
  cardano: string[];
  /**
   * The collateral the user chose. Null once reclaimed: the wallet then
   * takes none by itself. Absent: it takes the oldest pure 5 ₳ UTxO.
   */
  collateral?: string | null;
  /** When the payment making `collateral` was sent (ms since the epoch), while it's on its way. */
  collateralSentAt?: number;
}

const NONE: Choices = { seedelf: [], cardano: [] };

/** A pure-ADA UTxO of exactly 5 ₳: what can be the collateral. */
export const isCollateralShaped = (u: KoiosUtxo) => BigInt(u.value) === COLLATERAL_LOVELACE && !u.asset_list?.length;

/** Oldest first, then by outpoint, so the wallet's pick doesn't change between readings. */
const oldestFirst = (a: KoiosUtxo, b: KoiosUtxo) =>
  (a.block_height ?? 0) - (b.block_height ?? 0) || outpoint(a).localeCompare(outpoint(b));

/** The account's collateral among `utxos`, and who chose it. */
export function collateralOf(
  choices: Choices,
  utxos: PathedUtxo[],
): { utxo: PathedUtxo; by: "you" | "wallet" } | undefined {
  if (choices.collateral === null) return undefined;
  if (choices.collateral) {
    const chosen = utxos.find((p) => outpoint(p.utxo) === choices.collateral);
    if (chosen) return { utxo: chosen, by: "you" };
  }
  const oldest = utxos.map((p) => p.utxo).filter(isCollateralShaped).sort(oldestFirst)[0];
  const utxo = oldest && utxos.find((p) => p.utxo === oldest);
  return utxo ? { utxo, by: "wallet" } : undefined;
}

export interface CoinControlDeps {
  wallet: Wallet;
  session: Area;
  store: PrivateStore;
  now: () => number;
  contract?: ContractConfig;
}

export class CoinControlService {
  /** Changes happen one at a time, so two can't overwrite each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: CoinControlDeps) {}

  /** What the user chose on `network`. Throws if locked. */
  async choices(network: NetworkName): Promise<Choices> {
    return { ...NONE, ...(await this.deps.store.get<Choices>(`coins.${network}`)) };
  }

  /** The account's UTxOs that may be spent, and its collateral (never among them). */
  async account(
    network: NetworkName,
    utxos: PathedUtxo[],
  ): Promise<{ spendable: PathedUtxo[]; collateral?: PathedUtxo }> {
    const choices = await this.choices(network);
    const collateral = collateralOf(choices, utxos)?.utxo;
    const locked = new Set(choices.cardano);
    const spendable = utxos.filter((p) => p !== collateral && !locked.has(outpoint(p.utxo)));
    return { spendable, collateral };
  }

  /** The Seedelf UTxOs that may be spent. */
  async seedelf(network: NetworkName, utxos: KoiosUtxo[]): Promise<KoiosUtxo[]> {
    const locked = new Set((await this.choices(network)).seedelf);
    return utxos.filter((u) => !locked.has(outpoint(u)));
  }

  /** What's kept out of payments on each side, from the last reading. */
  async locked(network: NetworkName): Promise<{ seedelf: Locked; cardano: Locked }> {
    const lists = await this.lists(network);
    const sum = (list: UtxoInfo[]): Locked => {
      const kept = list.filter((u) => u.locked && !u.seedelf);
      const { lovelace, tokens } = sumValue(kept.map(asKoios));
      return { lovelace: lovelace.toString(), tokens, utxos: kept.length };
    };
    return { seedelf: sum(lists.seedelf), cardano: sum(lists.cardano) };
  }

  /** Both sides' UTxOs, from the last reading: largest first. */
  async lists(network: NetworkName): Promise<UtxoLists> {
    const { wallet, session, contract = CONTRACT_V1 } = this.deps;
    const [view, account, spent, reading] = await wallet.withKeys(
      async () =>
        [
          await keptContractView(session, network),
          (await session.get<PathedUtxo[]>(SESSION_ACCOUNT_UTXOS_PREFIX + network)) ?? [],
          await spentSet(session),
          await session.get<Balances>(SESSION_BALANCES_PREFIX + network),
        ] as const,
    );
    const choices = await this.choices(network);
    const lockedSeedelf = new Set(choices.seedelf);
    const lockedCardano = new Set(choices.cardano);
    const fresh = account.filter((p) => !spent.has(outpoint(p.utxo)));
    const collateral = collateralOf(choices, fresh)?.utxo;

    const seedelf = (view?.owned ?? []).map((u): UtxoInfo => {
      const name = seedelfTokenOf(u, contract.seedelfPolicyId);
      if (!name) return { ...info(u), locked: lockedSeedelf.has(outpoint(u)) };
      // The seedelf is named, not counted among the tokens.
      const tokens = info(u).tokens.filter((t) => !(t.policyId === contract.seedelfPolicyId && t.assetName === name));
      return { ...info(u), tokens, locked: false, seedelf: seedelfLabel(name) ?? name };
    });
    const cardano = fresh.map(
      (p): UtxoInfo => ({
        ...info(p.utxo),
        address: p.utxo.address,
        locked: p === collateral || lockedCardano.has(outpoint(p.utxo)),
        ...(p === collateral ? { collateral: true } : {}),
      }),
    );
    return {
      seedelf: seedelf.sort(largestFirst),
      cardano: cardano.sort(largestFirst),
      ...(reading ? { updatedAt: reading.updatedAt } : {}),
    };
  }

  /** Locks or unlocks one UTxO. A seedelf's UTxO and the collateral aren't locked this way. */
  setLocked(network: NetworkName, side: UtxoSide, utxo: string, locked: boolean): Promise<UtxoLists> {
    return this.serial(async () => {
      const lists = await this.lists(network);
      const found = lists[side].find((u) => `${u.txHash}#${u.index}` === utxo);
      if (!found) throw new Error("That UTxO isn't in your last reading. Refresh, then try again.");
      if (found.seedelf) throw new Error("A seedelf's UTxO is never spent by a payment: only removing it does.");
      if (found.collateral) throw new Error("That's your collateral. Reclaim it in Settings, under Collateral.");
      const choices = await this.choices(network);
      // Only what's still there is kept, so the record doesn't grow with spent UTxOs.
      const present = new Set(lists[side].map((u) => `${u.txHash}#${u.index}`));
      const next = new Set(choices[side].filter((o) => present.has(o)));
      if (locked) next.add(utxo);
      else next.delete(utxo);
      await this.save(network, { ...choices, [side]: [...next] });
      return this.lists(network);
    });
  }

  /** The collateral, from the last reading. */
  async collateral(network: NetworkName): Promise<CollateralStatus> {
    const choices = await this.choices(network);
    const lists = await this.lists(network);
    const set = lists.cardano.find((u) => u.collateral);
    if (set) {
      const by = choices.collateral === `${set.txHash}#${set.index}` ? "you" : "wallet";
      return { state: "set", utxo: set, by };
    }
    if (choices.collateral && choices.collateralSentAt && this.deps.now() - choices.collateralSentAt < WAIT_MS) {
      return { state: "waiting", txHash: choices.collateral.slice(0, choices.collateral.indexOf("#")) };
    }
    const candidate = lists.cardano.filter((u) => isCollateralShaped(asKoios(u))).sort(oldestInfoFirst)[0];
    return { state: "none", reclaimed: choices.collateral === null, ...(candidate ? { candidate } : {}) };
  }

  /** Makes a pure 5 ₳ UTxO the account already holds its collateral: no transaction. */
  use(network: NetworkName, utxo: string): Promise<CollateralStatus> {
    return this.serial(async () => {
      const found = (await this.lists(network)).cardano.find((u) => `${u.txHash}#${u.index}` === utxo);
      if (!found || !isCollateralShaped(asKoios(found))) {
        throw new Error("Only a UTxO of exactly 5 ₳ and nothing else can be the collateral.");
      }
      const choices = await this.choices(network);
      await this.save(network, {
        ...choices,
        cardano: choices.cardano.filter((o) => o !== utxo),
        collateral: utxo,
        collateralSentAt: undefined,
      });
      return this.collateral(network);
    });
  }

  /** The payment making a new collateral was sent: its 5 ₳ output is the collateral from now on. */
  sent(network: NetworkName, utxo: string): Promise<void> {
    return this.serial(async () => {
      const choices = await this.choices(network);
      await this.save(network, { ...choices, collateral: utxo, collateralSentAt: this.deps.now() });
    });
  }

  /** Returns the collateral to the balance; the wallet then takes none by itself. */
  reclaim(network: NetworkName): Promise<CollateralStatus> {
    return this.serial(async () => {
      const choices = await this.choices(network);
      await this.save(network, { ...choices, collateral: null, collateralSentAt: undefined });
      return this.collateral(network);
    });
  }

  private save(network: NetworkName, choices: Choices): Promise<void> {
    return this.deps.store.set(`coins.${network}`, choices);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function info(u: KoiosUtxo): Omit<UtxoInfo, "locked"> {
  return {
    txHash: u.tx_hash,
    index: u.tx_index,
    lovelace: u.value,
    tokens: sumValue([u]).tokens,
    ...(u.block_height ? { blockHeight: u.block_height } : {}),
  };
}

/** Back to the shape sumValue and isCollateralShaped read. */
function asKoios(u: UtxoInfo): KoiosUtxo {
  return {
    tx_hash: u.txHash,
    tx_index: u.index,
    address: u.address ?? "",
    value: u.lovelace,
    stake_address: null,
    payment_cred: null,
    block_height: u.blockHeight ?? null,
    inline_datum: null,
    asset_list: u.tokens.map((t) => ({
      policy_id: t.policyId,
      asset_name: t.assetName,
      quantity: t.quantity,
      decimals: t.decimals,
      fingerprint: t.fingerprint,
    })),
  };
}

const largestFirst = (a: UtxoInfo, b: UtxoInfo) =>
  Number(BigInt(b.lovelace) - BigInt(a.lovelace)) || `${a.txHash}#${a.index}`.localeCompare(`${b.txHash}#${b.index}`);

const oldestInfoFirst = (a: UtxoInfo, b: UtxoInfo) => oldestFirst(asKoios(a), asKoios(b));
