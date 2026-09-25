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
// balance reading. `tx_info` also says what each transaction did with the
// stake key (its certificates and withdrawals) and carries its note
// (CIP-20's message), at no extra request; a pool's ticker comes only from
// what's on the device.
//
// Each entry keeps the tokens that moved, with signed quantities, for its
// details and the CSV export (older Seedelf entries have only a count).

import type { NetworkName } from "../networks";
import type { ActivityEntry, ActivityStaking, PendingTx, TokenQuantity } from "../shared/rpc";
import { CONTRACT_V1, type ContractConfig } from "./balances";
import { seedelfTokenOf } from "./chain";
import type { Koios, KoiosTxInfo, KoiosUtxo } from "./koios";
import type { PrivateStore } from "./private-store";
import { outpoint } from "./spent";
import { knownPool } from "./staking";
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
const SEEDELF_KINDS: ReadonlySet<PendingTx["kind"]> = new Set([
  "move-in",
  "transfer",
  "withdraw",
  "mint",
  "remove",
  "session-out",
  "session-back",
  "lovejoin-withdraw",
]);

const newestFirst = (a: ActivityEntry, b: ActivityEntry) => b.at - a.at || a.txHash.localeCompare(b.txHash);
const shortHex = (hex: string) => (hex.length > 20 ? `${hex.slice(0, 12)}…${hex.slice(-6)}` : hex);
/** Who was paid: the one, or the first and how many more. */
const several = (names: string[]) => (names.length > 1 ? `${names[0]} and ${names.length - 1} more` : names[0]);
const feeOf = (fee: unknown) => (typeof fee === "string" ? fee : (fee as { total?: string } | undefined)?.total);

export interface ActivityDeps {
  wallet: Wallet;
  session: Area;
  store: PrivateStore;
  koios: (network: NetworkName) => Koios;
  contract?: ContractConfig;
  /** chrome.storage.local, where the pool list is kept: a staking entry's ticker is looked up there. */
  local?: Area;
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
    // A transfer or a withdrawal pays one or more; the rest pay one amount.
    const paid: Array<Record<string, any>> = Array.isArray(s.payments) ? s.payments : [s];
    const lovelace = paid.reduce((sum, p) => sum + BigInt(p.lovelace ?? "0"), 0n).toString();
    const moved = paid.flatMap((p) => (Array.isArray(p.tokens) ? p.tokens : []));
    const into = pending.kind === "move-in" || pending.kind === "session-back";
    const assets = signedAssets(moved, into ? 1n : -1n);
    const shared = {
      txHash: pending.txHash,
      at: pending.submittedAt,
      lovelace,
      tokens: assets.length,
      fee: feeOf(s.fee),
      ...(assets.length ? { assets } : {}),
    };
    // A session is shown by its number, from 1; its address says nothing to the user.
    const session = typeof s.index === "number" ? `Private session ${s.index + 1}` : undefined;
    const entry: ActivityEntry =
      pending.kind === "move-in"
        ? { ...shared, kind: "move-in", direction: "in" }
        : pending.kind === "session-out"
          ? { ...shared, kind: "session-out", direction: "out", detail: session }
          : pending.kind === "session-back"
            ? { ...shared, kind: "session-back", direction: "in", detail: session }
            : pending.kind === "lovejoin-withdraw"
              ? { ...shared, kind: "lovejoin-withdraw", direction: "in", detail: "Lovejoin" }
            : pending.kind === "transfer"
              ? { ...shared, kind: "transfer", direction: "out", detail: several(paid.map((p) => p.label ?? shortHex(String(p.to)))) }
              : pending.kind === "withdraw"
                ? {
                    ...shared,
                    kind: "withdraw",
                    direction: "out",
                    detail: several(paid.map((p) => (p.handle ? `$${p.handle}` : shortHex(String(p.address))))),
                  }
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
        const came = (u.asset_list ?? []).map((a) => ({ policyId: a.policy_id, assetName: a.asset_name, quantity: a.quantity }));
        // Everything here arrived: the quantities are all positive.
        const assets = signedAssets([...(entry.assets ?? []), ...came], 1n);
        entry.tokens = assets.length;
        if (assets.length) entry.assets = assets;
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
    const read = async (txs: KoiosTxInfo[]) => this.tickers(network, describe(txs, ours, own, stake));

    let pages: AccountPages;
    if (!kept) {
      const rows = await koios.accountTxs(stake, { offset: 0, limit: PAGE });
      // tx_info doesn't answer in the order asked: every page is sorted newest first.
      const entries = merge([], await read(await koios.txInfo(rows.map((r) => r.tx_hash))));
      pages = { entries, top: Math.max(0, ...rows.map((r) => r.block_height)), offset: rows.length, more: rows.length === PAGE };
    } else if (more) {
      const rows = await koios.accountTxs(stake, { offset: kept.offset, limit: PAGE });
      const entries = await read(await koios.txInfo(rows.map((r) => r.tx_hash)));
      pages = { ...kept, entries: merge(kept.entries, entries), offset: kept.offset + rows.length, more: rows.length === PAGE };
    } else {
      const rows = await koios.accountTxs(stake, { after: kept.top });
      const fresh = rows.filter((r) => !kept.entries.some((e) => e.txHash === r.tx_hash));
      const entries = await read(await txInfoPaged(koios, fresh.map((r) => r.tx_hash)));
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

/** The most of someone's note an entry keeps. */
const NOTE_MAX = 500;

/** CIP-20's message in a transaction's metadata (label 674, `msg`): its lines joined, as other wallets show it. */
export function noteOf(metadata: KoiosTxInfo["metadata"]): string | undefined {
  const message = metadata?.["674"] as { msg?: unknown } | undefined;
  const msg = message?.msg;
  const lines = Array.isArray(msg) ? msg : typeof msg === "string" ? [msg] : [];
  const text = lines
    .filter((l): l is string => typeof l === "string")
    .join(" ")
    .trim();
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
export function stakingOf(tx: KoiosTxInfo, stake: string): ActivityStaking | undefined {
  const s: ActivityStaking = {};
  for (const c of tx.certificates ?? []) {
    const info = c.info ?? {};
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
  return Object.keys(s).length ? s : undefined;
}

/**
 * What each transaction did to the account: its outputs to the account's
 * addresses less its inputs from them, in ADA, and which tokens changed.
 * One of this wallet's own flows (a move-in, an account-paid mint, a
 * withdrawal to the account) is named as such; otherwise a transaction that
 * staked, delegated the vote, stopped staking, or only withdrew the rewards
 * is named for that, from its certificates and withdrawals (`stake`: the
 * account's stake address). A payment that also spent the rewards stays
 * "Sent", with the rewards in its `staking`.
 */
export function describe(
  txs: KoiosTxInfo[],
  ours: ReadonlySet<string>,
  own: ReadonlyMap<string, ActivityEntry>,
  stake?: string,
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
    const staking = stake ? stakingOf(tx, stake) : undefined;
    const paysOthers = tx.outputs.some((o) => !ours.has(o.payment_addr.bech32));
    const kind: ActivityEntry["kind"] = mine
      ? mine.kind
      : staking?.stopped
        ? "unstake"
        : staking?.pool
          ? "stake"
          : staking?.drep
            ? "vote"
            : staking?.rewards && !paysOthers
              ? "withdraw-rewards"
              : direction === "in" && !spent
                ? "received"
                : "sent";
    const moved = [...assets].filter(([, q]) => q !== 0n);
    const note = noteOf(tx.metadata);
    return {
      txHash: tx.tx_hash,
      at: tx.tx_timestamp * 1000,
      kind,
      direction,
      lovelace: (net < 0n ? -net : net).toString(),
      tokens: moved.length,
      ...(spent ? { fee: tx.fee } : {}),
      ...(mine?.detail ? { detail: mine.detail } : {}),
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
  });
}
