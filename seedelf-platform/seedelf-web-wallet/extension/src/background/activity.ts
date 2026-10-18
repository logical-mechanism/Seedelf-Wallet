// Activity: what happened in the wallet's two balances, newest first, after
// Lace's Activity tab. It's built to cost as little of Koios as it can.
//
// Seedelf: no requests at all, and never a question about one transaction,
// which would tell Koios which contract UTxOs are ours. The history is what
// this wallet sent (written when it's submitted, from the reviewed summary)
// and what arrived (new UTxOs of ours the contract scan found), kept sealed on
// the device (private-store.ts). It starts when this wallet first saw each UTxO.
//
// Cardano account: Koios knows the account already. `credential_txs` by the
// account's payment keys, newest first, and one batched `tx_info` per page of
// 20, only while Activity is open. The keys are the ones the last balance
// reading asked about (`credential_utxos`), so what's listed is what the
// balance counts, whatever an address's staking part: an enterprise address
// of the account, or its key under someone else's stake key, too, which
// `account_txs` by the stake key never listed (O7). No server learns anything
// new: it had the same keys from the balance. More than 75 keys go in groups,
// one request a group (pages). The pages are kept for the session, so opening
// it again asks only for what's newer, from a margin under the newest block
// read (CATCH_UP_MARGIN): one request a group. What's the account's in a
// transaction is matched by its keys, as the balance counts it. `tx_info` also
// says what each transaction did with the stake key (its certificates and
// withdrawals) and carries its note (CIP-20's message), at no extra request;
// a pool's ticker comes only from what's on the device. A transaction at
// Lovejoin's mix box with no one else's key in it is named for what it did
// there, read from the transaction alone (describe). A collateral payment is
// named from the account's sealed choices (coin-control.ts
// `collateralPayments`): to the chain it's only a payment to itself.
//
// Each entry keeps the tokens that moved, with signed quantities, for its
// details and the CSV export (older Seedelf entries have only a count).
//
// The Seedelf history also says where each private UTxO's money came from
// (`classes`, privacy review §2.3): a Seedelf entry keeps the history of what
// its transaction left in the private balance (`origin`), and coin selection
// keeps different ones apart. It's read from the device alone.

import { t } from "../i18n";
import { NETWORKS, type NetworkName } from "../networks";
import {
  boxFrom,
  isHistoryClass,
  madePrivate,
  readClass,
  merged,
  receivedIn,
  sessionClass,
  UNKNOWN,
  unknownIn,
  type HistoryClass,
} from "../shared/histories";
import { entrySession, type ActivityEntry, type ActivityStaking, type Balances, type PendingTx, type TokenQuantity } from "../shared/rpc";
import type * as Wasm from "@seedelf/wasm";

import type { PathedUtxo } from "./account";
import { CONTRACT_V1, type ContractConfig } from "./balances";
import { seedelfTokenOf } from "./chain";
import { collateralPayments, SESSION_ACCOUNT_UTXOS_PREFIX } from "./coin-control";
import { ownDrepId } from "./governance";
import { pendingEntries, rewardAccountHex } from "./incoming";
import { HOLDER, LOVEJOIN_NFT } from "./lovejoin-pools";
import { CREDENTIALS_PER_REQUEST, type Koios, type KoiosAccountTx, type KoiosTxInfo, type KoiosTxOut, type KoiosUtxo } from "./koios";
import { pendingKey } from "./pending";
import type { PrivateStore } from "./private-store";
import { heldSent } from "./sent-txs";
import { outpoint, reservedSet, spentSet } from "./spent";
import { knownPool } from "./staking";
import type { Area } from "./storage";
import { SESSION_BALANCES_PREFIX, type Wallet } from "./wallet";
import { isTrap } from "./wasm";

/** chrome.storage.session: the Cardano account's stake address and addresses, from the last balance reading. */
export const SESSION_ACCOUNT_ADDRESSES_PREFIX = "seedelf.accountAddresses.";
/** chrome.storage.session: the Cardano account's activity read so far. */
export const SESSION_ACCOUNT_ACTIVITY_PREFIX = "seedelf.accountActivity.";

/** Transactions a page of the Cardano account's activity reads. */
export const PAGE = 20;
/** The most entries and noted UTxOs the Seedelf history keeps: entries whose money is still held are kept on top. */
const KEEP_ENTRIES = 500;
const KEEP_SEEN = 2_000;
/**
 * How long after this device starts a history its first reading still takes
 * what it finds for money from before: the device's clock and the chain's
 * may differ by that much.
 */
const STARTED_MARGIN_MS = 60 * 60_000;

interface History {
  entries: ActivityEntry[];
  /** Outpoints already noted as arrived. */
  seen: string[];
  /**
   * Set when this device starts the history, until the first balance reading
   * notes what's already there (independent review L38). That came before
   * the history (a restore, the same phrase in another profile): who paid
   * for it isn't known, so it's noted with origin Unknown, never as a
   * payment received. A brand-new wallet's first reading finds nothing.
   */
  first?: true;
  /**
   * When this device started it, by its clock. What that first reading finds
   * made well after this (a payment while earlier readings failed) came after
   * the history began: it's received, as any later arrival is.
   */
  startedAt?: number;
}

export interface AccountAddresses {
  stake: string;
  /** The base addresses in range: matched only for a row Koios gives no payment key for. */
  addresses: string[];
  /** The account's payment key hashes in range (hex). */
  keys: string[];
}

/** An input or output as `tx_info` lists it: `cred` is its payment key or script hash (hex), null for a Byron address. */
type TxOut = KoiosTxOut & { payment_addr: { cred?: string | null } };

/**
 * Whether an input or output is the account's: under one of its payment
 * keys, whatever its staking part, as the balance counts it (account.ts).
 * Someone else's key paired with our stake key isn't: it proves nothing
 * about us.
 */
export function accountMatcher(account: Pick<AccountAddresses, "addresses" | "keys">): (o: KoiosTxOut) => boolean {
  const keys = new Set(account.keys ?? []);
  const addresses = new Set(account.addresses);
  return (o) => {
    const cred = (o as TxOut).payment_addr.cred;
    return cred ? keys.has(cred) : addresses.has(o.payment_addr.bech32);
  };
}

interface AccountPages {
  entries: ActivityEntry[];
  /** The newest block the first page or a catch-up read: the next catch-up asks from a margin under it. */
  top: number;
  /** The payment keys they were read by: a reading that finds others starts the pages again. */
  keys: string[];
  /**
   * How many of each group of keys' transactions (`groups`), newest first, its pages have read: a position in its list
   * as it is now. One that lands since pushes the group's rows down, so its next page reads one again, which it leaves
   * out as listed: a short page, none skipped. A catch-up moves no offset: what it lists past the rows read comes back
   * on a page the same way (release review C03), and a page with nothing new reads on (`READ_ON`). Counting the hashes
   * each group had read instead went wrong for good once a server behind answered a Load more: every later page short
   * by what it skipped, and at 20, Load more never ended (cross-area review X08).
   */
  offsets: number[];
  more: boolean;
}

/**
 * How many blocks under the newest read a catch-up asks from. Each group's request goes to the data layer or Koios
 * on its own (data-layer.ts), and Koios's backends lag behind one another, so one read's groups can come from servers
 * at different tips: a transaction one group's answer lacked, under another group's newer one, is read again once its
 * server has caught up (release review C33). About half an hour of blocks, at no extra request; what's listed already
 * asks nothing more.
 */
export const CATCH_UP_MARGIN = 100;

/**
 * The most pages one press of Load more reads: a page that finds only rows listed already reads on to the next. What a
 * catch-up listed past the pages read comes back on them as listed, and a press that listed nothing, its button still
 * there, looked like the end of the list: five or six in a row after a public mix (the last review, L7). A page read on
 * asks a `credential_txs` only of the groups the one before moved on, no more than the press it saves would, and only
 * the one that finds something asks `tx_info`.
 */
const READ_ON = 10;

/** The account's keys in groups, one `credential_txs` each: Koios takes no more in a request. */
const groups = (keys: string[]) => {
  const out: string[][] = [];
  for (let i = 0; i < keys.length; i += CREDENTIALS_PER_REQUEST) out.push(keys.slice(i, i + CREDENTIALS_PER_REQUEST));
  return out;
};

/** Koios's order for an account's transactions: newest block first, then by hash. */
const koiosOrder = (a: KoiosAccountTx, b: KoiosAccountTx) =>
  b.block_height - a.block_height || (a.tx_hash < b.tx_hash ? -1 : a.tx_hash > b.tx_hash ? 1 : 0);

/**
 * A page from each group's page at its offset (`lists`, each in Koios's order): the newest PAGE of them not listed
 * yet, a transaction under keys in two groups once, and how many of each group's rows that reads (`read`), so the
 * group's next page starts after them and none is skipped. Rows past the page's last stay unread, to be asked for
 * again. `more` while a group gave a whole page or has rows left. With one group, its page as it came.
 *
 * None older than the last row of a group's whole page is taken (`cut`): that group's rows past its page, unread yet,
 * may be newer. It binds only once a group's whole page holds rows listed already, as what a catch-up listed past the
 * pages read makes it, and then the group that set it reads its whole page, so the next page goes on. Without it,
 * another group's older rows were listed ahead of that group's newer ones: a hole in the list (the last review, L8).
 */
export function takePage(
  lists: KoiosAccountTx[][],
  listed: ReadonlySet<string>,
): { rows: KoiosAccountTx[]; read: number[]; more: boolean } {
  const cut = lists.filter((list) => list.length === PAGE).map((list) => list[PAGE - 1]!).sort(koiosOrder)[0];
  const takes = (r: KoiosAccountTx) => !listed.has(r.tx_hash) && (!cut || koiosOrder(r, cut) <= 0);
  const fresh = [...new Map(lists.flat().filter(takes).map((r) => [r.tx_hash, r])).values()].sort(koiosOrder);
  const rows = fresh.slice(0, PAGE);
  const last = rows.length === PAGE ? rows[PAGE - 1] : cut;
  const read = lists.map((list) => (last ? list.filter((r) => koiosOrder(r, last) <= 0).length : list.length));
  return { rows, read, more: lists.some((list, i) => list.length === PAGE || read[i]! < list.length) };
}

/** What the Seedelf history notes when it's sent: flows that touch the Seedelf balance or a seedelf. */
const SEEDELF_KINDS: ReadonlySet<PendingTx["kind"]> = new Set([
  "move-in",
  "transfer",
  "withdraw",
  "mint",
  "remove",
  "session-out",
  "session-back",
  "lovejoin-withdraw",
  "lovejoin-launch",
]);

const newestFirst = (a: ActivityEntry, b: ActivityEntry) => b.at - a.at || a.txHash.localeCompare(b.txHash);
const shortHex = (hex: string) => (hex.length > 20 ? `${hex.slice(0, 12)}…${hex.slice(-6)}` : hex);
/**
 * Who was paid: the one, or the first and how many more. A count, not "and
 * 2 more": the history is sealed for good, and the page says it in whatever
 * language it's in by then (ui/activity.ts activityDetail).
 */
const several = (names: string[]): Pick<ActivityEntry, "detail" | "more"> =>
  names.length > 1 ? { detail: names[0], more: names.length - 1 } : { detail: names[0] };
/**
 * A payment to several from 1.1.0, which kept "alice and 2 more" in English, read as the first and a count, so the
 * page says it in its own language: only as read, the sealed entry is never written again (release review C33).
 */
const withMore = (e: ActivityEntry): ActivityEntry => {
  if ((e.kind !== "transfer" && e.kind !== "withdraw") || e.more !== undefined) return e;
  const m = /^(.+) and (\d+) more$/.exec(e.detail ?? "");
  return m ? { ...e, detail: m[1], more: Number(m[2]) } : e;
};
const feeOf = (fee: unknown) => (typeof fee === "string" ? fee : (fee as { total?: string } | undefined)?.total);

export interface ActivityDeps {
  wallet: Wallet;
  session: Area;
  store: PrivateStore;
  koios: (network: NetworkName) => Koios;
  contract?: ContractConfig;
  /** chrome.storage.local, where the pool list is kept: a staking entry's ticker is looked up there. */
  local?: Area;
  /** The clock a new history's start is read from: `Date.now` unless given. */
  now?: () => number;
  /** Reads the account's transactions on their way (incoming.ts `pendingEntries`); without it, none are listed. */
  wasm?: typeof Wasm;
  /**
   * Every Lovejoin pool's `mix_box` the wallet reads on a network (lovejoin.ts `mixBoxes`, chunk 34): a token pool's
   * deposits and mixes are named as the classic pool's are. Without it, the classic pool's alone.
   */
  mixBoxes?: (network: NetworkName) => Promise<string[]>;
}

/** Each token's quantity, signed by `sign`, from anything listing tokens. */
function signedAssets(tokens: Array<{ policyId: string; assetName: string; quantity: string }>, sign: 1n | -1n): TokenQuantity[] {
  const sums = new Map<string, bigint>();
  for (const t of tokens) {
    const key = `${t.policyId}.${t.assetName}`;
    sums.set(key, (sums.get(key) ?? 0n) + BigInt(t.quantity));
  }
  return [...sums].map(([key, q]) => {
    const [policyId, assetName] = key.split(".") as [string, string];
    return { policyId, assetName, quantity: (sign * q).toString() };
  });
}

export class ActivityService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ActivityDeps) {}

  /** The Seedelf history, newest first. */
  async seedelf(network: NetworkName): Promise<ActivityEntry[]> {
    const history = await this.deps.store.get<History>(`history.${network}`);
    return this.withDecimals(network, (history?.entries ?? []).map(withMore).sort(newestFirst));
  }

  /**
   * `entries` with each token's decimals as the last balance reading has them from Koios, read on the device: a
   * token off the wallet's list read "1,234.56" on Home and "+1,234,560,000" in Activity (blind test E01, §7). Not
   * kept with the entries, which are sealed for good: a token no longer held keeps its whole units.
   */
  private async withDecimals(network: NetworkName, entries: ActivityEntry[]): Promise<ActivityEntry[]> {
    if (!entries.some((e) => e.assets?.length)) return entries;
    const { wallet, session } = this.deps;
    const reading = await wallet.withKeys(() => session.get<Balances>(SESSION_BALANCES_PREFIX + network)).catch(() => undefined);
    const known = new Map<string, number>();
    for (const x of [...(reading?.seedelf.tokens ?? []), ...(reading?.cardano.tokens ?? [])]) {
      if (x.decimals) known.set(`${x.policyId}.${x.assetName}`, x.decimals);
    }
    if (!known.size) return entries;
    const of = (a: TokenQuantity) => known.get(`${a.policyId}.${a.assetName}`);
    return entries.map((e) =>
      e.assets?.some((a) => of(a) !== undefined) ? { ...e, assets: e.assets.map((a) => (of(a) !== undefined ? { ...a, decimals: of(a) } : a)) } : e,
    );
  }

  /**
   * Notes a transaction this wallet just submitted, from the summary the user
   * reviewed. Its change and deposits, when the scan finds them, aren't
   * counted again as arrivals.
   */
  sent(network: NetworkName, pending: PendingTx, summary: object): Promise<void> {
    // A payment or a staking change on the Cardano account isn't Seedelf's: its Activity comes from Koios.
    if (!SEEDELF_KINDS.has(pending.kind)) return Promise.resolve();
    const s = summary as Record<string, any>;
    // A Lovejoin pool the public account paid to start is that account's too (lovejoin-launch.ts).
    if (pending.kind === "lovejoin-launch" && s.from !== "private") return Promise.resolve();
    // A transfer or a withdrawal pays one or more; the rest pay one amount.
    const paid: Array<Record<string, any>> = Array.isArray(s.payments) ? s.payments : [s];
    const lovelace = paid.reduce((sum, p) => sum + BigInt(p.lovelace ?? "0"), 0n).toString();
    const moved = paid.flatMap((p) => (Array.isArray(p.tokens) ? p.tokens : []));
    // A box back from Lovejoin brings its pool's token in with its ADA (a token pool's, chunk 34).
    const into = pending.kind === "move-in" || pending.kind === "session-back" || pending.kind === "lovejoin-withdraw";
    const assets = signedAssets(moved, into ? 1n : -1n);
    const shared = {
      txHash: pending.txHash,
      at: pending.submittedAt,
      lovelace,
      tokens: assets.length,
      fee: feeOf(s.fee),
      ...(assets.length ? { assets } : {}),
    };
    // A session is shown by its number, from 1; its address says nothing to the user. Kept as its index: the
    // page names it, in its own language (entrySession).
    const session = typeof s.index === "number" ? s.index : undefined;
    const ofSession = session !== undefined ? { session } : {};
    // What it leaves in the private balance: the history its review worked out (the inputs' own; a session's
    // funding's, with the session's), or a session's funding change and return, which are that session's.
    const origin: HistoryClass | undefined =
      readClass(s.origin) ??
      ((pending.kind === "session-out" || pending.kind === "session-back") && typeof s.index === "number"
        ? sessionClass(s.index)
        : undefined);
    const entry: ActivityEntry =
      pending.kind === "move-in"
        ? { ...shared, kind: "move-in", direction: "in" }
        : pending.kind === "session-out"
          ? { ...shared, kind: "session-out", direction: "out", ...ofSession }
          : pending.kind === "session-back"
            ? { ...shared, kind: "session-back", direction: "in", ...ofSession }
            : pending.kind === "lovejoin-withdraw"
              ? { ...shared, kind: "lovejoin-withdraw", direction: "in", detail: "Lovejoin" }
            : pending.kind === "transfer"
              ? { ...shared, kind: "transfer", direction: "out", ...several(paid.map((p) => p.label ?? shortHex(String(p.to)))) }
              : pending.kind === "withdraw"
                ? {
                    ...shared,
                    kind: "withdraw",
                    direction: "out",
                    ...several(paid.map((p) => (p.handle ? `$${p.handle}` : shortHex(String(p.address))))),
                  }
                : pending.kind === "mint"
                  ? { ...shared, kind: "mint", direction: "none", detail: s.label || undefined }
                  : pending.kind === "lovejoin-launch"
                    ? // What it locks for good left the balance, as what a payment pays does.
                      { ...shared, kind: "lovejoin-launch", direction: "out" }
                    : { ...shared, kind: "remove", direction: "none", detail: s.label ?? shortHex(String(s.name)) };
    return this.update(network, (h) => {
      // A return's money came from the session's account, which its fundings paid: it carries what they
      // spent, as their change does, and keeps it should their entries age out. `classes` reads all of a
      // session's entries as one history (independent review L41).
      const back =
        pending.kind === "session-back" && !isHistoryClass(s.origin) && session !== undefined
          ? h.entries
              .filter((e) => e.kind === "session-out" && entrySession(e) === session && isHistoryClass(e.origin))
              .map((e) => e.origin!)
          : [];
      const o = back.length && origin ? merged([origin, ...back]) : origin;
      if (o) entry.origin = o;
      return { ...h, entries: [...h.entries.filter((e) => e.txHash !== entry.txHash), entry] };
    });
  }

  /**
   * Where each of `utxos` came from, by outpoint (privacy review §2.3): read
   * from the sealed history alone, matched by the transaction that made it.
   * A UTxO it has nothing on is Unknown. While any of the others' history is
   * known, each transaction's Unknown money is a class of its own, so two
   * are kept apart, and merging them is said, as for payments received
   * (independent review L40). With none known, all of it is one Unknown, and
   * selection picks as the CLI does. A private session's money, what each
   * of its fundings left and its return, is one class.
   */
  async classes(network: NetworkName, utxos: KoiosUtxo[]): Promise<Map<string, HistoryClass>> {
    const history = await this.deps.store.get<History>(`history.${network}`);
    const entries = history?.entries ?? [];
    const byTx = new Map(entries.map((e) => [e.txHash, e]));
    // Every funding and top-up of a session paid its account, and its return came from there: on chain, what
    // each funding's change and the return carry is already one owner's. So they're one history, all of theirs
    // merged: spending two of them together ties nothing new, and selection takes them together before it
    // merges anything else (independent review L41).
    const bySession = new Map<number, HistoryClass[]>();
    for (const e of entries) {
      const n = entrySession(e);
      if (n === undefined) continue;
      const classes = bySession.get(n) ?? [];
      classes.push(classOf(e));
      bySession.set(n, classes);
    }
    const sessions = new Map([...bySession].map(([n, classes]) => [n, merged(classes)]));
    const of = (e: ActivityEntry | undefined) => {
      const n = e && entrySession(e);
      return n !== undefined ? sessions.get(n)! : classOf(e);
    };
    const found = utxos.map((u) => [u, of(byTx.get(u.tx_hash))] as const);
    const known = found.some(([, c]) => c.origin !== "unknown");
    return new Map(
      found.map(([u, c]): [string, HistoryClass] => {
        if (c.origin !== "unknown") return [outpoint(u), c];
        if (!known) return [outpoint(u), UNKNOWN];
        return [outpoint(u), c.id === UNKNOWN.id ? unknownIn(u.tx_hash) : c];
      }),
    );
  }

  /**
   * Notes this wallet's contract UTxOs it hasn't seen before as arrivals, one
   * entry per transaction. Its own transactions' change isn't an arrival, and
   * a UTxO holding a seedelf is a name, not a payment. What the history's
   * first reading finds was there before it: its origin is Unknown.
   */
  arrived(network: NetworkName, owned: KoiosUtxo[]): Promise<void> {
    const { contract = CONTRACT_V1 } = this.deps;
    return this.update(network, (h) => {
      const seen = new Set(h.seen);
      const ours = new Set(h.entries.filter((e) => e.kind !== "received").map((e) => e.txHash));
      const fresh = owned.filter((u) => !seen.has(outpoint(u)));
      // The first reading is written even when it finds nothing: what comes after it arrived.
      if (!fresh.length && !h.first) return undefined;
      // What the first reading finds was there before the history began, unless its block came well after
      // that: then it arrived since, while earlier readings failed (independent review L38).
      const before = (u: KoiosUtxo) =>
        h.startedAt === undefined || u.block_time === undefined || u.block_time * 1000 < h.startedAt + STARTED_MARGIN_MS;
      const byTx = new Map<string, ActivityEntry>();
      for (const u of fresh) {
        if (ours.has(u.tx_hash) || seedelfTokenOf(u, contract.seedelfPolicyId)) continue;
        const entry = byTx.get(u.tx_hash) ?? {
          txHash: u.tx_hash,
          at: (u.block_time ?? 0) * 1000,
          kind: "received" as const,
          direction: "in" as const,
          lovelace: "0",
          tokens: 0,
          ...(h.first && before(u) ? { origin: UNKNOWN } : {}),
        };
        entry.lovelace = (BigInt(entry.lovelace) + BigInt(u.value)).toString();
        const came = (u.asset_list ?? []).map((a) => ({ policyId: a.policy_id, assetName: a.asset_name, quantity: a.quantity }));
        // Everything here arrived: the quantities are all positive.
        const assets = signedAssets([...(entry.assets ?? []), ...came], 1n);
        entry.tokens = assets.length;
        if (assets.length) entry.assets = assets;
        byTx.set(u.tx_hash, entry);
      }
      const known = new Set(h.entries.map((e) => e.txHash));
      const added = [...byTx.values()].filter((e) => !known.has(e.txHash));
      // The newest, but never one whose transaction made money still in the private balance: its history is
      // what keeps that money apart, a box's from another's (independent review L40).
      const holding = new Set(owned.map((u) => u.tx_hash));
      const all = [...h.entries, ...added].sort(newestFirst);
      let room = KEEP_ENTRIES - all.filter((e) => holding.has(e.txHash)).length;
      return {
        entries: all.filter((e) => holding.has(e.txHash) || room-- > 0),
        seen: [...h.seen, ...fresh.map(outpoint)].slice(-KEEP_SEEN),
      };
    });
  }

  /** The Cardano account's activity: the first page, what's newer since, or (`more`) the next page. */
  async cardano(network: NetworkName, more = false): Promise<{ entries: ActivityEntry[]; more: boolean }> {
    const { wallet, session } = this.deps;
    const key = SESSION_ACCOUNT_ACTIVITY_PREFIX + network;
    // Which public account these are, read with them: a switch is one turn of the wallet's queue too (accounts.ts `use`).
    const [index, account, kept] = await wallet.withKeys(
      async (keys) =>
        [
          keys.account,
          await session.get<AccountAddresses>(SESSION_ACCOUNT_ADDRESSES_PREFIX + network),
          await session.get<AccountPages>(key),
        ] as const,
    );
    if (!account?.keys?.length) throw new Error(t("worker.activity.readFirst"));
    const { stake, keys } = account;
    const koios = this.deps.koios(network);
    const ours = accountMatcher(account);
    // What the private side noted as received says nothing of what the account did in it: after a restore,
    // that's also the account's own move-ins from before (independent review L38).
    const own = new Map((await this.seedelf(network)).filter((e) => e.kind !== "received").map((e) => [e.txHash, e]));
    // The account's DRep, from its key: its certificates and votes are named for what they did.
    const drep = await ownDrepId(this.deps).catch(() => undefined);
    // Every pool's mix box the wallet reads, the classic pool's at least (chunk 34): from the device, no request.
    const classic = NETWORKS[network].lovejoin?.mixBox;
    const read_ = await this.deps.mixBoxes?.(network).catch(() => undefined);
    const mixBox = new Set([...(classic ? [classic] : []), ...(read_ ?? [])]);
    // This account's collateral payments, which only the device knows are: a name, never worth failing the list for.
    const collateral = await collateralPayments(this.deps.store, network, index).catch(() => new Set<string>());
    const read = async (txs: KoiosTxInfo[]) => this.tickers(network, describe(txs, ours, own, stake, drep, mixBox, collateral));
    const sets = groups(keys);
    // Read by these keys, or begun again: a group's offset says nothing of another set's.
    const from = kept && kept.offsets?.length === sets.length && kept.keys?.join() === keys.join() ? kept : undefined;

    let pages: AccountPages;
    if (!from || more) {
      // The first page, or the next: each group's page at its offset, the newest of them taken.
      const listed = new Set(from?.entries.map((e) => e.txHash));
      // Each group's page as asked at its offset: a page that reads on asks again only the groups it moved on.
      const asked: Array<{ offset: number; list: KoiosAccountTx[] }> = [];
      const pageAt = async (at: number[]) => {
        for (const [i, set] of sets.entries()) {
          const offset = at[i]!;
          if (asked[i]?.offset !== offset) asked[i] = { offset, list: await koios.credentialTxs(set, { offset, limit: PAGE }) };
        }
        return takePage(asked.map((a) => a.list), listed);
      };
      let offsets = from?.offsets ?? sets.map(() => 0);
      let page = await pageAt(offsets);
      // Rows a catch-up listed past the pages read come back on them, listed already: a page with nothing new reads on,
      // in the same press, from where it ended (READ_ON).
      for (let passed = 1; !page.rows.length && page.more && passed < READ_ON; passed++) {
        offsets = offsets.map((o, i) => o + page.read[i]!);
        page = await pageAt(offsets);
      }
      // tx_info doesn't answer in the order asked: every page is sorted newest first.
      const entries = await read(await koios.txInfo(page.rows.map((r) => r.tx_hash)));
      pages = {
        entries: merge(from?.entries ?? [], entries),
        // Kept by Load more: a group's newer transaction a page took isn't all that's newer, and a catch-up asks every
        // group from under it (release review C03).
        top: from ? from.top : Math.max(0, ...page.rows.map((r) => r.block_height)),
        keys,
        // Every row up to the page's last, one listed already too: positions in each group's list as it is now.
        offsets: offsets.map((o, i) => o + page.read[i]!),
        more: page.more,
      };
    } else {
      // What's newer: each group's from a margin under the newest block read. Koios and the data layer take that block
      // too, and what's listed already is asked about no more. The offsets stay: what's newer pushed each group's rows
      // down by as many as its next page reads again, and what this lists that the pages hadn't reached comes back on
      // one, listed (cross-area review X08).
      const lists: KoiosAccountTx[][] = [];
      const after = Math.max(0, from.top - CATCH_UP_MARGIN);
      for (const set of sets) lists.push(await koios.credentialTxs(set, { after }));
      const listed = new Set(from.entries.map((e) => e.txHash));
      const fresh = [...new Map(lists.flat().filter((r) => !listed.has(r.tx_hash)).map((r) => [r.tx_hash, r])).values()];
      const entries = await read(await txInfoPaged(koios, fresh.map((r) => r.tx_hash)));
      pages = {
        ...from,
        entries: merge(from.entries, entries),
        top: Math.max(from.top, ...lists.flat().map((r) => r.block_height)),
      };
    }
    // Not kept once the user has switched account while Koios answered: they'd be listed as the new account's.
    await wallet.withKeys(async (keys) => (keys.account === index ? session.set(key, pages) : undefined));
    // Ahead of them, what the wallet sent that Koios doesn't list yet, as Private activity lists its own at once.
    const pending = await this.pendingOf(network, account, own, collateral, new Set(pages.entries.map((e) => e.txHash)));
    const entries = pending.length ? [...pending, ...pages.entries].sort(newestFirst) : pages.entries;
    return { entries: await this.withDecimals(network, entries), more: pages.more };
  }

  /**
   * The account's transactions the wallet sent that Koios doesn't list yet, marked pending: from the transactions
   * the device keeps (sent-txs.ts) and the last reading, asking no one (blind test §9.3, T07, T08: Public activity
   * showed nothing until the block). Not kept with the pages: each read works them out again, so one Koios lists
   * gives way to its confirmed entry, and one that never went out, freed, goes. It never breaks the list.
   */
  private async pendingOf(
    network: NetworkName,
    account: AccountAddresses,
    own: ReadonlyMap<string, ActivityEntry>,
    collateral: ReadonlySet<string>,
    listed: ReadonlySet<string>,
  ): Promise<ActivityEntry[]> {
    const { wasm, wallet, session } = this.deps;
    if (!wasm) return [];
    try {
      const entries = await wallet.withKeys(async (keys) => {
        const sent = await heldSent(session, network);
        if (!sent.length) return [];
        const utxos = (await session.get<PathedUtxo[]>(SESSION_ACCOUNT_UTXOS_PREFIX + network)) ?? [];
        const watched = await session.get<PendingTx>(pendingKey(network));
        return pendingEntries(wasm, network, sent, {
          active: keys.account,
          keys: new Set(account.keys ?? []),
          stake: account.stake,
          stakeKey: rewardAccountHex(wasm, account.stake)?.slice(2),
          account: new Set(utxos.map((p) => outpoint(p.utxo))),
          spent: await spentSet(session),
          reserved: (await reservedSet(session, network)).inputs,
          listed,
          own,
          collateral,
          ...(watched ? { watched: { txHash: watched.txHash, kind: watched.kind } } : {}),
        });
      });
      // Outside the wallet's lock, which the pool lookup takes itself.
      return await this.tickers(network, entries);
    } catch (e) {
      if (isTrap(e)) throw e;
      return [];
    }
  }

  /** Staking entries' pool tickers, from what's on the device only. */
  private async tickers(network: NetworkName, entries: ActivityEntry[]): Promise<ActivityEntry[]> {
    const { wallet, session, local } = this.deps;
    // Each pool is looked up once: the pool list on the device is long, and a page often names the same pool.
    const tickers = new Map<string, string | undefined>();
    for (const e of entries) {
      const pool = e.staking?.pool;
      if (!pool) continue;
      if (!tickers.has(pool)) tickers.set(pool, (await knownPool({ wallet, session, local }, network, pool))?.ticker);
      const ticker = tickers.get(pool);
      if (ticker) e.staking = { ...e.staking, ticker };
    }
    return entries;
  }

  private update(network: NetworkName, change: (h: History) => History | undefined): Promise<void> {
    const run = this.queue.then(async () => {
      const name = `history.${network}` as const;
      // One this device starts now: its first reading notes what was there before it.
      const history = (await this.deps.store.get<History>(name)) ?? {
        entries: [],
        seen: [],
        first: true,
        startedAt: (this.deps.now ?? Date.now)(),
      };
      const next = change(history);
      if (next) await this.deps.store.set(name, next);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** The history of what the transaction `entry` records made, if any. */
function classOf(entry: ActivityEntry | undefined): HistoryClass {
  if (!entry) return UNKNOWN;
  const stored = readClass(entry.origin);
  if (stored) return stored;
  switch (entry.kind) {
    // A move-in records which account it came from (move-in.ts, mint.ts), so
    // this is only ever reached for one written before several accounts —
    // when there was one public account, and it was account 0.
    case "move-in":
      return madePrivate(0);
    case "received":
      return receivedIn(entry.txHash);
    case "lovejoin-withdraw":
      return boxFrom(entry.txHash);
    case "session-out":
    case "session-back": {
      // Written before `origin` was: the session is its number, or, older still, the name in its detail.
      const n = entrySession(entry);
      return n !== undefined ? sessionClass(n) : UNKNOWN;
    }
    default:
      // A payment's change from before the history kept where money came from: its inputs aren't known.
      return UNKNOWN;
  }
}

/** tx_info, 20 at a time. */
export async function txInfoPaged(koios: Koios, hashes: string[]): Promise<KoiosTxInfo[]> {
  const rows: KoiosTxInfo[] = [];
  for (let i = 0; i < hashes.length; i += PAGE) rows.push(...(await koios.txInfo(hashes.slice(i, i + PAGE))));
  return rows;
}

const merge = (a: ActivityEntry[], b: ActivityEntry[]) =>
  [...new Map([...a, ...b].map((e) => [e.txHash, e])).values()].sort(newestFirst);

/** The most of someone's note an entry keeps. */
const NOTE_MAX = 500;

/** CIP-20's message in a transaction's metadata (label 674, `msg`): its lines joined, as other wallets show it. */
export function noteOf(metadata: KoiosTxInfo["metadata"]): string | undefined {
  const message = metadata?.["674"] as { msg?: unknown } | undefined;
  const msg = message?.msg;
  const lines = Array.isArray(msg) ? msg : typeof msg === "string" ? [msg] : [];
  // The sender's words, in whatever language they wrote, cut into CIP-20's lines: never the wallet's sentences,
  // so a space joins them in every language (tests/i18n-assembly.test.ts lets this name through).
  const noteLines = lines.filter((l): l is string => typeof l === "string");
  const text = noteLines.join(" ").trim();
  if (!text) return undefined;
  return text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX)}…` : text;
}

/** A certificate's field as a string (Koios gives amounts as strings, or now and then as numbers). */
const field = (info: Record<string, unknown>, key: string): string | undefined => {
  const v = info[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
};
const plus = (a: string | undefined, b: string | undefined) => (b === undefined ? a : (BigInt(a ?? "0") + BigInt(b)).toString());

/** What a transaction did with the account's stake key: its certificates naming it, and its withdrawal. */
export function stakingOf(tx: KoiosTxInfo, stake: string, drep?: string): ActivityStaking | undefined {
  const s: ActivityStaking = {};
  for (const c of tx.certificates ?? []) {
    const info = c.info ?? {};
    // The account's own DRep's certificates (chunk 21), named by its ID.
    if (drep && info.drep_id === drep && c.type.startsWith("drep_")) {
      if (c.type === "drep_registration") {
        s.drepAction = "register";
        s.deposit = plus(s.deposit, field(info, "deposit"));
      } else if (c.type === "drep_retire" || c.type === "drep_deregistration") {
        s.drepAction = "retire";
      } else if (c.type === "drep_update") {
        s.drepAction ??= "update";
      }
      continue;
    }
    if (info.stake_address !== stake) continue;
    switch (c.type) {
      case "stake_registration":
        s.deposit = plus(s.deposit, field(info, "deposit"));
        break;
      // Koios's documentation spells it both ways.
      case "stake_deregistration":
      case "stake_deregistraion":
        s.stopped = true;
        s.refund = plus(s.refund, field(info, "refund") ?? field(info, "deposit"));
        break;
      case "pool_delegation":
      case "delegation":
        s.pool = field(info, "pool_id_bech32") ?? field(info, "pool");
        break;
      case "vote_delegation":
        s.drep = field(info, "drep_id");
        break;
    }
  }
  const rewards = (tx.withdrawals ?? []).filter((w) => w.stake_addr === stake).reduce((sum, w) => sum + BigInt(w.amount), 0n);
  if (rewards > 0n) s.rewards = rewards.toString();
  const votes = drep ? (tx.voting_procedures ?? []).filter((v) => v.voter === drep).length : 0;
  if (votes > 0) {
    s.votes = votes;
    s.drepAction ??= "vote";
  }
  return Object.keys(s).length ? s : undefined;
}

/** What each of the account's own DRep's transactions is called. */
const DREP_KIND = {
  register: "drep-register",
  update: "drep-update",
  retire: "drep-retire",
  vote: "drep-vote",
} as const satisfies Record<NonNullable<ActivityStaking["drepAction"]>, ActivityEntry["kind"]>;

/**
 * What each transaction did to the account: its outputs to the account's
 * keys (`ours`) less its inputs from them, less the rewards it withdrew and
 * with the fee it paid said apart, in ADA, and which tokens changed. The
 * rewards are in the balance as Home counts it, so collecting them is no
 * money in: a 25 ₳ payment whose change held 57.475311 ₳ of rewards read
 * "Sent +32.300614 ₳", the change less the coin it spent (blind test §9.1,
 * T08). It's "Sent −25 ₳", the 25 ₳ paid, with the fee and the rewards
 * collected in its details, as the launch review's H1 counted the rewards in
 * a site's signing prompt. A deposit is money out, and one back money in.
 * One of this wallet's own flows (a move-in, an account-paid mint, a
 * withdrawal to the account) is named as such, and so is one of the account's
 * collateral payments (`collateral`, by transaction), which the chain shows as
 * a payment to itself, costing the fee; otherwise a transaction that
 * staked, delegated the vote, stopped staking, or only withdrew the rewards
 * is named for that, from its certificates and withdrawals (`stake`: the
 * account's stake address), and one of its own DRep's (`drep`: its ID) for
 * what that did. A payment that also spent the rewards stays
 * "Sent", with the rewards in its `staking`. A transaction with nothing of
 * the account's in it (someone paying their own key under our stake key) is
 * left out: it isn't the account's activity, and its note isn't to us.
 *
 * One at Lovejoin's mix box (`mixBox`, its script hash) with no one else's
 * key in it is named for what it did there, from the transaction alone, since
 * a chain's record goes about an hour after its mix ends and a restore has
 * none (O7): paid by the account, boxes made and none spent is its deposit (or
 * a seed), and boxes spent and made one of its mixes, which pays the account
 * its change back, so it's the fee alone; a box spent into the account and
 * none made is a box back (the account's own, through another app with its
 * phrase, or one someone paid from their own box: the chain can't tell them
 * apart). With someone else's key beside the box, it's a payment, named with
 * who it paid or who paid it, never the box (release review C22).
 *
 * Every pool the wallet reads is named so (chunk 34): `mixBox` is the classic
 * pool's mix box, or every pool's. A box spent into a Seedelf with the
 * account's money beside it is a box it paid to bring back ("lovejoin-back-
 * paid", the escape hatch); and one that left the `lovejoin` NFT at
 * Lovejoin's holder, paid by the account, started a pool ("lovejoin-launch").
 */
export function describe(
  txs: KoiosTxInfo[],
  ours: (o: KoiosTxOut) => boolean,
  own: ReadonlyMap<string, ActivityEntry>,
  stake?: string,
  drep?: string,
  mixBox?: string | ReadonlySet<string>,
  collateral: ReadonlySet<string> = new Set(),
): ActivityEntry[] {
  const boxes = typeof mixBox === "string" ? new Set([mixBox]) : (mixBox ?? new Set<string>());
  const atBox = (o: KoiosTxOut) => {
    const cred = (o as TxOut).payment_addr.cred;
    return !!cred && boxes.has(cred);
  };
  // A launch's reference UTxO: the pool's `lovejoin` NFT at the holder, for good.
  const launched = (o: KoiosTxOut) =>
    (o as TxOut).payment_addr.cred === HOLDER && (o.asset_list ?? []).some((a) => a.asset_name === LOVEJOIN_NFT && a.quantity === "1");
  // Someone else's key: not the account's, not the box, and not a script (Lovejoin's fee shard is one), which the
  // address's header says: a payment script's addresses go on from addr1 (addr_test1) with z, x, 2 or w.
  const someoneElse = (o: KoiosTxOut) => !ours(o) && !atBox(o) && !/^addr(_test)?1[zx2w]/.test(o.payment_addr.bech32);
  return txs.flatMap((tx): ActivityEntry[] => {
    let net = 0n;
    const assets = new Map<string, bigint>();
    const add = (o: KoiosTxOut, sign: 1n | -1n) => {
      if (!ours(o)) return;
      net += sign * BigInt(o.value);
      for (const a of o.asset_list ?? []) {
        const k = `${a.policy_id}.${a.asset_name}`;
        assets.set(k, (assets.get(k) ?? 0n) + sign * BigInt(a.quantity));
      }
    };
    for (const i of tx.inputs) add(i, -1n);
    for (const o of tx.outputs) add(o, 1n);
    const spent = tx.inputs.some(ours);
    const mine = own.get(tx.tx_hash);
    const staking = stake ? stakingOf(tx, stake, drep) : undefined;
    // What the balance did but for the fee: the account's own coins less the rewards withdrawn into them.
    const change = net - BigInt(staking?.rewards ?? "0") + (spent ? BigInt(tx.fee) : 0n);
    const direction = change > 0n ? "in" : change < 0n ? "out" : "none";
    if (!spent && !tx.outputs.some(ours) && !staking && !mine) return [];
    const paysOthers = tx.outputs.some((o) => !ours(o));
    const [boxIn, boxOut] = [tx.inputs.some(atBox), tx.outputs.some(atBox)];
    // Beside the box, a payment to someone, or someone paying for their own box's withdrawal: a payment, saying who.
    const besideBox = (boxIn || boxOut) && [...tx.inputs, ...tx.outputs].some(someoneElse);
    const lovejoin: ActivityEntry["kind"] | undefined = spent && tx.outputs.some(launched)
      ? "lovejoin-launch"
      : besideBox
        ? undefined
        : spent && boxOut
          ? boxIn
            ? "lovejoin-round"
            : "lovejoin-deposit"
          : boxIn && !boxOut
            ? direction === "in"
              ? "lovejoin-withdraw"
              : spent
                ? "lovejoin-back-paid"
                : undefined
            : undefined;
    const kind: ActivityEntry["kind"] = mine
      ? mine.kind
      : collateral.has(tx.tx_hash)
        ? "collateral"
      : lovejoin
        ? lovejoin
      : staking?.drepAction
        ? DREP_KIND[staking.drepAction]
        : staking?.stopped
        ? "unstake"
        : staking?.pool
          ? "stake"
          : staking?.drep
            ? "vote"
            : staking?.rewards && !paysOthers
              ? "withdraw-rewards"
              : // One that left the account better off isn't "Sent", even when it spent some of its coins to.
                direction === "in"
                ? "received"
                : "sent";
    const moved = [...assets].filter(([, q]) => q !== 0n);
    const note = noteOf(tx.metadata);
    // Who, for a payment this device didn't make: the addresses it paid, or that paid it, read from the transaction
    // already in hand, no request (chunk 23's review, A-1: "where did my 100 ₳ go?" had no answer). Never the mix
    // box: who's beside it is.
    const counterparts =
      mine || (kind !== "sent" && kind !== "received")
        ? []
        : [
            ...new Set(
              (kind === "sent" ? tx.outputs : tx.inputs).filter((o) => !ours(o) && !atBox(o)).map((o) => o.payment_addr.bech32),
            ),
          ];
    const who = mine?.detail ? { detail: mine.detail, ...(mine.more ? { more: mine.more } : {}) } : counterparts.length ? several(counterparts) : {};
    const entry: ActivityEntry = {
      txHash: tx.tx_hash,
      at: tx.tx_timestamp * 1000,
      kind,
      direction,
      lovelace: (change < 0n ? -change : change).toString(),
      tokens: moved.length,
      ...(spent ? { fee: tx.fee } : {}),
      ...who,
      ...(mine?.session !== undefined ? { session: mine.session } : {}),
      ...(moved.length
        ? {
            assets: moved.map(([key, q]) => {
              const [policyId, assetName] = key.split(".") as [string, string];
              return { policyId, assetName, quantity: q.toString() };
            }),
          }
        : {}),
      ...(note ? { note } : {}),
      ...(staking ? { staking } : {}),
    };
    return [entry];
  });
}
