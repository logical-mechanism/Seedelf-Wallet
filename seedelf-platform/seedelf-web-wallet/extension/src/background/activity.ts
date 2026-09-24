// Activity: what happened in the wallet's two balances, newest first, after
// Lace's Activity tab. It's built to cost as little of Koios as it can.
//
// Seedelf: no requests at all, and never a question about one transaction,
// which would tell Koios which contract UTxOs are ours. The history is what
// this wallet sent (written when it's submitted, from the reviewed summary)
// and what arrived (new UTxOs of ours the contract scan found), kept sealed on
// the device (private-store.ts). It starts when this wallet first saw each UTxO.
//
// Cardano account: Koios knows the account already. `account_txs`, newest
// first, and one batched `tx_info` per page of 20, only while Activity is
// open. The pages are kept for the session, so opening it again asks only
// for what's newer: one request. The account's addresses come from the last
// balance reading.

import type { NetworkName } from "../networks";
import type { ActivityEntry, PendingTx } from "../shared/rpc";
import { CONTRACT_V1, type ContractConfig } from "./balances";
import { seedelfTokenOf } from "./chain";
import type { Koios, KoiosTxInfo, KoiosUtxo } from "./koios";
import type { PrivateStore } from "./private-store";
import { outpoint } from "./spent";
import type { Area } from "./storage";
import type { Wallet } from "./wallet";

/** chrome.storage.session: the Cardano account's stake address and addresses, from the last balance reading. */
export const SESSION_ACCOUNT_ADDRESSES_PREFIX = "seedelf.accountAddresses.";
/** chrome.storage.session: the Cardano account's activity read so far. */
export const SESSION_ACCOUNT_ACTIVITY_PREFIX = "seedelf.accountActivity.";

/** Transactions a page of the Cardano account's activity reads. */
export const PAGE = 20;
/** The most entries and noted UTxOs the Seedelf history keeps. */
const KEEP_ENTRIES = 500;
const KEEP_SEEN = 2_000;

interface History {
  entries: ActivityEntry[];
  /** Outpoints already noted as arrived. */
  seen: string[];
}

export interface AccountAddresses {
  stake: string;
  addresses: string[];
}

interface AccountPages {
  entries: ActivityEntry[];
  /** The newest block read. */
  top: number;
  /** How many of the account's transactions, newest first, have been read. */
  offset: number;
  more: boolean;
}

/** What the Seedelf history notes when it's sent: flows that touch the Seedelf balance or a seedelf. */
const SEEDELF_KINDS: ReadonlySet<PendingTx["kind"]> = new Set(["move-in", "transfer", "withdraw", "mint", "remove"]);

const newestFirst = (a: ActivityEntry, b: ActivityEntry) => b.at - a.at || a.txHash.localeCompare(b.txHash);
const shortHex = (hex: string) => (hex.length > 20 ? `${hex.slice(0, 12)}…${hex.slice(-6)}` : hex);
const feeOf = (fee: unknown) => (typeof fee === "string" ? fee : (fee as { total?: string } | undefined)?.total);

export interface ActivityDeps {
  wallet: Wallet;
  session: Area;
  store: PrivateStore;
  koios: (network: NetworkName) => Koios;
  contract?: ContractConfig;
}

export class ActivityService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ActivityDeps) {}

  /** The Seedelf history, newest first. */
  async seedelf(network: NetworkName): Promise<ActivityEntry[]> {
    const history = await this.deps.store.get<History>(`history.${network}`);
    return [...(history?.entries ?? [])].sort(newestFirst);
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
    const tokens = Array.isArray(s.tokens) ? s.tokens.length : 0;
    const shared = { txHash: pending.txHash, at: pending.submittedAt, lovelace: String(s.lovelace ?? "0"), tokens, fee: feeOf(s.fee) };
    const entry: ActivityEntry =
      pending.kind === "move-in"
        ? { ...shared, kind: "move-in", direction: "in" }
        : pending.kind === "transfer"
          ? { ...shared, kind: "transfer", direction: "out", detail: s.label ?? shortHex(String(s.to)) }
          : pending.kind === "withdraw"
            ? { ...shared, kind: "withdraw", direction: "out", detail: s.handle ? `$${s.handle}` : shortHex(String(s.address)) }
            : pending.kind === "mint"
              ? { ...shared, kind: "mint", direction: "none", detail: s.label || undefined }
              : { ...shared, kind: "remove", direction: "none", detail: s.label ?? shortHex(String(s.name)) };
    return this.update(network, (h) => ({ ...h, entries: [...h.entries.filter((e) => e.txHash !== entry.txHash), entry] }));
  }

  /**
   * Notes this wallet's contract UTxOs it hasn't seen before as arrivals, one
   * entry per transaction. Its own transactions' change isn't an arrival, and
   * a UTxO holding a seedelf is a name, not a payment.
   */
  arrived(network: NetworkName, owned: KoiosUtxo[]): Promise<void> {
    const { contract = CONTRACT_V1 } = this.deps;
    return this.update(network, (h) => {
      const seen = new Set(h.seen);
      const ours = new Set(h.entries.filter((e) => e.kind !== "received").map((e) => e.txHash));
      const fresh = owned.filter((u) => !seen.has(outpoint(u)));
      if (!fresh.length) return undefined;
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
        };
        entry.lovelace = (BigInt(entry.lovelace) + BigInt(u.value)).toString();
        entry.tokens += u.asset_list?.length ?? 0;
        byTx.set(u.tx_hash, entry);
      }
      const known = new Set(h.entries.map((e) => e.txHash));
      const added = [...byTx.values()].filter((e) => !known.has(e.txHash));
      return {
        entries: [...h.entries, ...added].sort(newestFirst).slice(0, KEEP_ENTRIES),
        seen: [...h.seen, ...fresh.map(outpoint)].slice(-KEEP_SEEN),
      };
    });
  }

  /** The Cardano account's activity: the first page, what's newer since, or (`more`) the next page. */
  async cardano(network: NetworkName, more = false): Promise<{ entries: ActivityEntry[]; more: boolean }> {
    const { wallet, session } = this.deps;
    const key = SESSION_ACCOUNT_ACTIVITY_PREFIX + network;
    const [account, kept] = await wallet.withKeys(
      async () =>
        [
          await session.get<AccountAddresses>(SESSION_ACCOUNT_ADDRESSES_PREFIX + network),
          await session.get<AccountPages>(key),
        ] as const,
    );
    if (!account) throw new Error("Read the balances first: open Home, then Activity.");
    const { stake } = account;
    const koios = this.deps.koios(network);
    const ours = new Set(account.addresses);
    const own = new Map((await this.seedelf(network)).map((e) => [e.txHash, e]));

    let pages: AccountPages;
    if (!kept) {
      const rows = await koios.accountTxs(stake, { offset: 0, limit: PAGE });
      // tx_info doesn't answer in the order asked: every page is sorted newest first.
      const entries = merge([], describe(await koios.txInfo(rows.map((r) => r.tx_hash)), ours, own));
      pages = { entries, top: Math.max(0, ...rows.map((r) => r.block_height)), offset: rows.length, more: rows.length === PAGE };
    } else if (more) {
      const rows = await koios.accountTxs(stake, { offset: kept.offset, limit: PAGE });
      const entries = describe(await koios.txInfo(rows.map((r) => r.tx_hash)), ours, own);
      pages = { ...kept, entries: merge(kept.entries, entries), offset: kept.offset + rows.length, more: rows.length === PAGE };
    } else {
      const rows = await koios.accountTxs(stake, { after: kept.top });
      const fresh = rows.filter((r) => !kept.entries.some((e) => e.txHash === r.tx_hash));
      const entries = describe(await txInfoPaged(koios, fresh.map((r) => r.tx_hash)), ours, own);
      pages = {
        ...kept,
        entries: merge(kept.entries, entries),
        top: Math.max(kept.top, ...rows.map((r) => r.block_height)),
        offset: kept.offset + fresh.length,
      };
    }
    await wallet.withKeys(() => session.set(key, pages));
    return { entries: pages.entries, more: pages.more };
  }

  private update(network: NetworkName, change: (h: History) => History | undefined): Promise<void> {
    const run = this.queue.then(async () => {
      const name = `history.${network}` as const;
      const history = (await this.deps.store.get<History>(name)) ?? { entries: [], seen: [] };
      const next = change(history);
      if (next) await this.deps.store.set(name, next);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** tx_info, 20 at a time. */
async function txInfoPaged(koios: Koios, hashes: string[]): Promise<KoiosTxInfo[]> {
  const rows: KoiosTxInfo[] = [];
  for (let i = 0; i < hashes.length; i += PAGE) rows.push(...(await koios.txInfo(hashes.slice(i, i + PAGE))));
  return rows;
}

const merge = (a: ActivityEntry[], b: ActivityEntry[]) =>
  [...new Map([...a, ...b].map((e) => [e.txHash, e])).values()].sort(newestFirst);

/**
 * What each transaction did to the account: its outputs to the account's
 * addresses less its inputs from them, in ADA, and how many kinds of token
 * changed. One of this wallet's own flows (a move-in, an account-paid mint, a
 * withdrawal to the account) is named as such.
 */
export function describe(
  txs: KoiosTxInfo[],
  ours: ReadonlySet<string>,
  own: ReadonlyMap<string, ActivityEntry>,
): ActivityEntry[] {
  return txs.map((tx) => {
    let net = 0n;
    const assets = new Map<string, bigint>();
    const add = (o: KoiosTxInfo["outputs"][number], sign: 1n | -1n) => {
      if (!ours.has(o.payment_addr.bech32)) return;
      net += sign * BigInt(o.value);
      for (const a of o.asset_list ?? []) {
        const k = `${a.policy_id}.${a.asset_name}`;
        assets.set(k, (assets.get(k) ?? 0n) + sign * BigInt(a.quantity));
      }
    };
    for (const i of tx.inputs) add(i, -1n);
    for (const o of tx.outputs) add(o, 1n);
    const spent = tx.inputs.some((i) => ours.has(i.payment_addr.bech32));
    const mine = own.get(tx.tx_hash);
    const direction = net > 0n ? "in" : net < 0n ? "out" : "none";
    return {
      txHash: tx.tx_hash,
      at: tx.tx_timestamp * 1000,
      kind: mine ? mine.kind : direction === "in" && !spent ? "received" : "sent",
      direction,
      lovelace: (net < 0n ? -net : net).toString(),
      tokens: [...assets.values()].filter((q) => q !== 0n).length,
      ...(spent ? { fee: tx.fee } : {}),
      ...(mine?.detail ? { detail: mine.detail } : {}),
    };
  });
}
