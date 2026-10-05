// Coin control: the UTxOs the user keeps out of every payment, on both
// sides, and the Cardano account's collateral.
//
// Locked  A locked UTxO is left out of everything that spends that side,
//         Max included: the builders only ever see what's unlocked.
// Collateral  One pure-ADA 5 ₳ UTxO under the account, put up by anything
//         the account signs that runs a script (an account-paid seedelf
//         mint, a Lovejoin mix from the account, a connected site's
//         transaction through getCollateral), and otherwise never spent. As in Lace, it's a UTxO set
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
// last balance reading and the contract scan, in session storage. A reading
// too large for session storage to keep (balances.ts) sums what's locked from
// its own UTxOs, and the lists then say why they can't be shown.
//
// Each private UTxO is listed with where its money came from, read from the
// sealed Seedelf history (activity.ts `classes`), so a lock that keeps one
// history apart is an informed choice (privacy review §2.3).

import { t } from "../i18n";
import type { NetworkName } from "../networks";
import type { Balances, CollateralStatus, Locked, UtxoInfo, UtxoLists, UtxoSide } from "../shared/rpc";
import type { PathedUtxo } from "./account";
import type { ActivityService } from "./activity";
import { CONTRACT_V1, type ContractConfig } from "./balances";
import { seedelfLabel, seedelfTokenOf, sumValue } from "./chain";
import { keptContractView } from "./contract-scan";
import { measurable, type KoiosUtxo } from "./koios";
import type { PrivateStore } from "./private-store";
import { outpoint, spentSet } from "./spent";
import type { Area } from "./storage";
import { SESSION_BALANCES_PREFIX, type Wallet } from "./wallet";

/** chrome.storage.session, per network: the account's UTxOs at the last balance reading, with their paths. */
export const SESSION_ACCOUNT_UTXOS_PREFIX = "seedelf.accountUtxos.";

/**
 * chrome.storage.session, per network: when the last balance reading was
 * made, set when it was too large to keep. Its UTxOs weren't kept, so the
 * lists say so rather than come back empty.
 */
export const SESSION_TOO_LARGE_PREFIX = "seedelf.readingTooLarge.";

/** What the lists say for a reading too large to keep. */
export const TOO_LARGE = () => t("worker.coins.tooMany");

/** A balance reading's own UTxOs, for one too large to keep: what's locked is summed from these. */
export interface ReadingUtxos {
  /** This wallet's contract UTxOs. */
  owned: KoiosUtxo[];
  /** The account's. */
  account: PathedUtxo[];
  /** When the reading was made (ms since the epoch). */
  updatedAt: number;
}

/** What a collateral holds: 5 ₳, as Lace and the CLI use. */
export const COLLATERAL_LOVELACE = 5_000_000n;

/** A collateral payment is waited for this long before the wallet stops expecting it. */
const WAIT_MS = 10 * 60_000;

/**
 * What the user chose on one network, for the public account the wallet is
 * working on: the shape every caller sees, flattened out of `Stored`.
 */
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

/** One public account's own choices: what it has locked, and its collateral. */
type Own = Pick<Choices, "cardano" | "collateral" | "collateralSentAt">;

/**
 * What is sealed as `coins.<network>` since chunk 18: the private side's
 * locks, which are shared because the private balance is one, and each public
 * account's own locks and collateral, by index.
 *
 * The collateral is the account's — each account sets its own, or the wallet
 * takes that account's oldest pure 5 ₳ UTxO, which is the existing rule
 * extended from "another wallet on this phrase" to "another account".
 *
 * `PRIVATE_RECORDS` is a fixed list, so this stays **one** record rather than
 * two per account: reshaping its contents leaves `KEPT_ON_RESET` and Remove
 * wallet untouched.
 */
interface Stored {
  seedelf: string[];
  accounts?: Record<string, Own>;
  /**
   * The shape sealed before chunk 18, when there was one public account.
   * Read as account 0's, and folded into `accounts` on the first write; never
   * written again. Dropping it instead would unlock every UTxO a user had
   * locked and lose their collateral choice.
   */
  cardano?: string[];
  collateral?: string | null;
  collateralSentAt?: number;
}

const NONE: Choices = { seedelf: [], cardano: [] };

/** The legacy flat fields, as account 0's own choices. */
const legacyOwn = (stored: Stored): Own => ({
  cardano: stored.cardano ?? [],
  ...(stored.collateral !== undefined ? { collateral: stored.collateral } : {}),
  ...(stored.collateralSentAt !== undefined ? { collateralSentAt: stored.collateralSentAt } : {}),
});

/** `stored` as account `account` sees it, reading the pre-chunk-18 shape as account 0's. */
export function choicesOf(stored: Stored | undefined, account: number): Choices {
  if (!stored) return NONE;
  const own = stored.accounts?.[String(account)] ?? (account === 0 ? legacyOwn(stored) : undefined);
  return {
    seedelf: stored.seedelf ?? [],
    cardano: own?.cardano ?? [],
    ...(own?.collateral !== undefined ? { collateral: own.collateral } : {}),
    ...(own?.collateralSentAt !== undefined ? { collateralSentAt: own.collateralSentAt } : {}),
  };
}

/** `stored` with `choices` put back as account `account`'s, and the private side as given. */
export function withChoices(stored: Stored | undefined, account: number, choices: Choices): Stored {
  const accounts: Record<string, Own> = { ...(stored?.accounts ?? {}) };
  // Account 0's legacy fields move into the map before they stop being read,
  // whichever account is being written: a user who locked UTxOs on account 0
  // keeps them locked after switching to another account and changing
  // something there.
  if (stored && !accounts["0"]) accounts["0"] = legacyOwn(stored);
  accounts[String(account)] = {
    cardano: choices.cardano,
    ...(choices.collateral !== undefined ? { collateral: choices.collateral } : {}),
    ...(choices.collateralSentAt !== undefined ? { collateralSentAt: choices.collateralSentAt } : {}),
  };
  return { seedelf: choices.seedelf, accounts };
}

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
  /** Which public account's locks and collateral these are (accounts.ts). Account 0 without it. */
  activeAccount?: () => number | Promise<number>;
  session: Area;
  store: PrivateStore;
  now: () => number;
  contract?: ContractConfig;
  /** Where each private UTxO came from, for the lists. */
  activity?: Pick<ActivityService, "classes">;
}

export class CoinControlService {
  /** Changes happen one at a time, so two can't overwrite each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: CoinControlDeps) {}

  /** Which public account the locks and the collateral below are. */
  private async activeIndex(): Promise<number> {
    return (await this.deps.activeAccount?.()) ?? 0;
  }

  /** What the user chose on `network`, for the account the wallet is working on. Throws if locked. */
  async choices(network: NetworkName): Promise<Choices> {
    const [stored, account] = await Promise.all([this.deps.store.get<Stored>(`coins.${network}`), this.activeIndex()]);
    return choicesOf(stored, account);
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

  /** What's kept out of payments on each side, from the last reading, or `from` one too large to keep. */
  async locked(network: NetworkName, from?: ReadingUtxos): Promise<{ seedelf: Locked; cardano: Locked }> {
    const lists = await this.lists(network, from, false);
    const sum = (list: UtxoInfo[]): Locked => {
      const kept = list.filter((u) => u.locked && !u.seedelf);
      const { lovelace, tokens } = sumValue(kept.map(asKoios));
      return { lovelace: lovelace.toString(), tokens, utxos: kept.length };
    };
    return { seedelf: sum(lists.seedelf), cardano: sum(lists.cardano) };
  }

  /**
   * Both sides' UTxOs, from the last reading, or `from` one too large to
   * keep: largest first. Throws when the last reading was too large to keep.
   * `histories`: each private UTxO's too, for the UTxOs screen.
   */
  async lists(network: NetworkName, from?: ReadingUtxos, histories = true): Promise<UtxoLists> {
    const { wallet, session, contract = CONTRACT_V1 } = this.deps;
    const [owned, account, spent, updatedAt] = await wallet.withKeys(async () => {
      if (from) return [from.owned, from.account, await spentSet(session), from.updatedAt] as const;
      if ((await session.get(SESSION_TOO_LARGE_PREFIX + network)) !== undefined) throw new Error(TOO_LARGE());
      return [
        (await keptContractView(session, network, contract))?.owned ?? [],
        (await session.get<PathedUtxo[]>(SESSION_ACCOUNT_UTXOS_PREFIX + network)) ?? [],
        await spentSet(session),
        (await session.get<Balances>(SESSION_BALANCES_PREFIX + network))?.updatedAt,
      ] as const;
    });
    const choices = await this.choices(network);
    const lockedSeedelf = new Set(choices.seedelf);
    const lockedCardano = new Set(choices.cardano);
    const fresh = account.filter((p) => !spent.has(outpoint(p.utxo)));
    const collateral = collateralOf(choices, fresh)?.utxo;

    // A Seedelf spend can't take a UTxO holding a reference script yet (script-spend.ts `spendable`),
    // and the account can't price one whose script Koios doesn't give (`measurable`).
    const script = { unspendable: "script" } as const;
    const classes = histories ? await this.deps.activity?.classes(network, owned).catch(() => undefined) : undefined;
    const seedelf = owned.map((u): UtxoInfo => {
      const name = seedelfTokenOf(u, contract.seedelfPolicyId);
      const unspendable = u.reference_script ? script : {};
      const history = classes?.get(outpoint(u));
      if (!name) return { ...info(u), locked: lockedSeedelf.has(outpoint(u)), ...unspendable, ...(history ? { history } : {}) };
      // The seedelf is named, not counted among the tokens.
      const tokens = info(u).tokens.filter((t) => !(t.policyId === contract.seedelfPolicyId && t.assetName === name));
      const label = seedelfLabel(name);
      return { ...info(u), tokens, locked: false, seedelf: { name, ...(label ? { label } : {}) }, ...unspendable };
    });
    const cardano = fresh.map(
      (p): UtxoInfo => ({
        ...info(p.utxo),
        address: p.utxo.address,
        locked: p === collateral || lockedCardano.has(outpoint(p.utxo)),
        ...(p === collateral ? { collateral: true } : {}),
        ...(measurable(p.utxo) ? {} : script),
      }),
    );
    return {
      seedelf: seedelf.sort(largestFirst),
      cardano: cardano.sort(largestFirst),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    };
  }

  /** Locks or unlocks one UTxO. A seedelf's UTxO and the collateral aren't locked this way. */
  setLocked(network: NetworkName, side: UtxoSide, utxo: string, locked: boolean): Promise<UtxoLists> {
    return this.serial(async () => {
      const lists = await this.lists(network);
      const found = lists[side].find((u) => `${u.txHash}#${u.index}` === utxo);
      if (!found) throw new Error(t("worker.coins.notInReading"));
      if (found.seedelf) throw new Error(t("worker.coins.seedelfUtxo"));
      if (found.collateral) throw new Error(t("worker.coins.isCollateral"));
      const choices = await this.choices(network);
      // The others stay as they are, listed in this reading or not: a
      // backend that's behind, or a page read twice, can leave out a UTxO
      // that's still there, and its lock must hold when it shows up again.
      // One that's spent matches nothing; the list grows only by clicks.
      const next = new Set(choices[side]);
      if (locked) next.add(utxo);
      else next.delete(utxo);
      await this.save(network, { ...choices, [side]: [...next] });
      return this.lists(network);
    });
  }

  /** The collateral, from the last reading. */
  async collateral(network: NetworkName): Promise<CollateralStatus> {
    const choices = await this.choices(network);
    const lists = await this.lists(network, undefined, false);
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
      const found = (await this.lists(network, undefined, false)).cardano.find((u) => `${u.txHash}#${u.index}` === utxo);
      if (!found || !isCollateralShaped(asKoios(found))) {
        throw new Error(t("worker.coins.exactlyFive"));
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

  private async save(network: NetworkName, choices: Choices): Promise<void> {
    const [stored, account] = await Promise.all([this.deps.store.get<Stored>(`coins.${network}`), this.activeIndex()]);
    await this.deps.store.set(`coins.${network}`, withChoices(stored, account, choices));
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
