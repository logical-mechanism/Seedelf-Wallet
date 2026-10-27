// Starting a Lovejoin pool (chunk 34's §5, as built in 34d). The wallet
// launches no pools of its own: a user does, paid from their private balance
// by default, or from their public account, their choice to show that link
// (session 1, 10). One transaction makes the whole pool: its NFT, its
// reference UTxO and its two scripts at the holder, and its mix_logic
// credential registered, so a pool started here is standard the moment it
// lands, and every wallet finds it there (lovejoin-pools.ts), this one too.
// None is read sooner from the launcher's own record, which would single out
// the launcher's IP (§3).
//
// Checked before anything is built:
// - a token pool's token is in the wallet's token list for this network
//   (round three, 20); an ADA pool names none, and is never the classic
//   pool's 10 ₳, whose copy no wallet shows (session 1, 17);
// - no shown pool has these values already (11), once discovery has looked
//   for pools launched since it last did: a copy is never shown, so it's
//   refused, and the form lists the pools there are to join (14); one of
//   these values the wallet started that no look has found yet is said on the
//   review, never refused, as the chain takes both (1.6.0's release review,
//   318-worker#1);
// - every box's ADA is at least what one needs to come back and pay part of
//   itself on its own under the live parameters (S0d's rule, worked out in
//   WebAssembly: lovejoinBoxValue), and at most 9 ₳ in a token pool (27).
// Then WebAssembly builds it twice, measures each in the wallet, and checks
// the pool each makes from its own bytes, as a stranger's would be checked:
// once registering mix_logic's credential, once without the certificate.
//
// Checked at Send, before anything is sent, so only a start the user sends
// names its pool to the Cardano server (34d's review 7; ours on mainnet,
// Koios on preprod or where ours can't answer): whether something registered
// mix_logic's credential already (whoever reads the seed can; account_info).
// The build without the certificate is sent then, and is still standard
// (34c). Built without the deposit, it may have picked another seed, so
// another pool: that one is sent only if its credential is registered too,
// never as a pool no wallet would show (34d's review 4).
//
// A token's supply isn't asked: a box of more than exists of it is the
// creator's to read on the review, nothing the contracts refuse, and the
// request would name the token (the owner, 2026-10-19).
//
// Koios requests: the protocol parameters and the contract or the account,
// as any spend reads them, and the holder, as every wallet's look reads it;
// at Send, one account_info, or two. Sent as any spend from its side is: a
// Seedelf spend with giveme.my's collateral, or the account's, signed at
// review.

import { t } from "../i18n";
import { lovejoinOn, type NetworkName } from "../networks";
import type { HistoryClass } from "../shared/histories";
import type { LovejoinLaunchSummary, LovejoinLaunchTerms, PendingTx, TokenQuantity } from "../shared/rpc";
import { nothingInAccount, readAccount, validUntil } from "./account";
import type { KoiosUtxo } from "./koios";
import { STARTED_SAID_MS, type LovejoinService } from "./lovejoin";
import { isListed, type FoundPool, type PoolDiscovery } from "./lovejoin-pools";
import { settleMaybeSent } from "./pending";
import { adaWords, privateShort } from "./short";
import {
  BUILT_TTL_MS,
  changeHistory,
  keep,
  measureLocally,
  nothingToSpend,
  readContract,
  send,
  spentHistories,
  type OutRef,
  type ScriptSpendDeps,
} from "./script-spend";
import { isTrap } from "./wasm";

/** chrome.storage.session: the pool's start built last, until it's sent or replaced. */
export const SESSION_LOVEJOIN_LAUNCH = "seedelf.lovejoin.launch";

/** The most a fee shard may pay a mix, as the datum names it: under the box's ADA, as one_shot_mint requires. */
const MAX_FEE = 1_500_000n;

/** The classic pool's box: an ADA pool on the new scripts at this value is a copy of it, never shown. */
const CLASSIC_LOVELACE = 10_000_000n;

/** The largest a token's quantity in a box may be: the ledger's ceiling on one asset in an output. */
const MAX_QUANTITY = 2n ** 64n - 1n;

/** A token as a launch names it. */
interface Token {
  policyId: string;
  assetName: string;
}

/** What WebAssembly says a box may hold (`lovejoin::BoxValueResult`). */
interface BoxValue {
  least: string;
  suggested: string;
  most?: string;
}

/** A launch WebAssembly built (`api::LaunchResult`, `api::AccountLaunchResult`). */
interface Built {
  txCbor: string;
  txHash: string;
  /** The one-time key's seed: a launch from the private balance, unsigned. */
  seed?: string;
  pool: { id: string; boxLovelace: string; token?: { policyId: string; assetName: string; quantity: string } };
  locked: { reference: string; mixBox: string; mixLogic: string; deposit: string; total: string };
  fee: { total: string };
  changeLovelace: string;
  inputs: OutRef[];
  classesMixed?: string[];
  mixLogicStake: string;
}

/** One of a start's two builds, as Send needs it. */
interface Sendable {
  txHash: string;
  txCbor: string;
  seed?: string;
  pool: LovejoinLaunchSummary["pool"];
  locked: LovejoinLaunchSummary["locked"];
  fee: string;
  change: string;
  inputs: number;
  /** What leaves the balance for good, for the private history once it's sent: what the launch locks. */
  lovelace: string;
  /** L's reward account, which Send asks account_info of. */
  mixLogicStake: string;
  /** From the private balance: the history of what it leaves there, for the Seedelf history once it's sent. */
  origin?: HistoryClass;
}

/** A start as review keeps it for Send: its registering build, and what Send checks and may send instead. */
type KeptLaunch = Omit<LovejoinLaunchSummary, "locked" | "fee" | "change" | "pool" | "inputs"> &
  Sendable & {
    /** The hash the review showed: Send is asked for it, whichever build goes. */
    reviewed: string;
    /** Built without the certificate: sent instead when something registered L already. Gone once Send chose. */
    bare?: Sendable;
    invalidHereafter?: number;
    builtAt: number;
    account?: number;
    sentCbor?: string;
  };

export interface LaunchDeps extends ScriptSpendDeps {
  /**
   * Where the wallet keeps the pools it started, and reads them again (launches): a start of the same values says so,
   * and Send asked again for a start that went says it went already.
   */
  lovejoin: Pick<LovejoinService, "recordLaunch" | "launches">;
  /**
   * The pools shown on a network (lovejoin-pools.ts): a launch of their values would be a copy, never shown. Looked
   * for again before the check, as the Lovejoin page does as it opens.
   */
  discovery: Pick<PoolDiscovery, "known" | "look">;
  /** Whether a token has pools on a network: the wallet's list unless a test names others. */
  listed?: (network: NetworkName, token: Token) => boolean;
}

const sameToken = (a: Token | undefined, b: Token | undefined) =>
  a === undefined || b === undefined ? a === b : a.policyId === b.policyId && a.assetName === b.assetName;

/** A whole number of raw units from a request, or why not. */
function whole(text: string | undefined, why: () => string): bigint {
  if (typeof text !== "string" || !/^\d+$/.test(text)) throw new Error(why());
  return BigInt(text);
}

export class LovejoinLaunchService {
  /** What a box may hold, by network, token, quantity and epoch: about a dozen ways back to build, so worked out once. */
  private values = new Map<string, BoxValue>();

  constructor(private readonly deps: LaunchDeps) {}

  private listed(network: NetworkName, token: Token): boolean {
    return this.deps.listed?.(network, token) ?? isListed(network, token.policyId, token.assetName);
  }

  /** The token, if it may have a pool on `network`, or why not. */
  private check(network: NetworkName, token?: Token): void {
    if (!lovejoinOn(network)) throw new Error(t("lj.notOnNetwork"));
    if (token && !this.listed(network, token)) throw new Error(t("lj.launch.notListed"));
  }

  /**
   * What a box of a pool of `token` (none: an ADA pool) may hold under `params`, with `quantity` of it a box: the
   * least a box comes back from on its own, the suggestion, and a token pool's most. Without a quantity, the largest
   * a box can hold is assumed, so the least holds for any.
   */
  private async boxValue(network: NetworkName, params: Record<string, unknown>, token?: Token, quantity?: bigint): Promise<BoxValue> {
    const q = (quantity ?? MAX_QUANTITY).toString();
    const key = [network, token?.policyId ?? "", token?.assetName ?? "", token ? q : "", String(params.epoch_no ?? "")].join("|");
    const kept = this.values.get(key);
    if (kept) return kept;
    const request = { network, params, ...(token ? { token: { ...token, quantity: q } } : {}) };
    const value = JSON.parse(this.deps.wasm.lovejoinBoxValue(JSON.stringify(request))) as BoxValue;
    this.values.set(key, value);
    return value;
  }

  /**
   * The launch form's terms (session 1, 14): what a box may hold, and the pools of this token (or of ADA) shown
   * already, each with its box value, so a creator can join one rather than split it.
   */
  async terms(network: NetworkName, token?: Token, quantity?: string): Promise<LovejoinLaunchTerms> {
    this.check(network, token);
    const q = quantity === undefined ? undefined : whole(quantity, () => t("lj.launch.quantity"));
    // None of the token is refused here as Review refuses it, before WebAssembly (1.6.0's release review, MONEY-2).
    if (q !== undefined && q < 1n) throw new Error(t("lj.launch.quantity"));
    const params = await this.deps.koios(network).epochParams();
    const value = await this.boxValue(network, params, token, q);
    // Never a copy, which takes no new box, to join: only the earliest launch of its values (the merged fixes' review,
    // MERGED-1).
    const pools = (await this.deps.discovery.known(network))
      .filter((p) => !p.copy && sameToken(p.token, token))
      .map((p) => ({ id: p.id, boxLovelace: p.boxLovelace, ...(p.token ? { token: p.token } : {}) }));
    return { ...value, pools };
  }

  /**
   * Builds a pool's start, from `from`'s side: a token pool of `quantity` (raw) of `token` a box, or an ADA pool, with
   * `boxLovelace` of ADA a box. Every check that asks Koios nothing it wouldn't for any spend first (see the top of
   * this file), then both builds, kept for Send.
   */
  async build(
    network: NetworkName,
    { from, token, quantity, boxLovelace }: { from: "private" | "public"; token?: Token; quantity?: string; boxLovelace: string },
  ): Promise<LovejoinLaunchSummary> {
    // Never the public account by default: who pays is said, or nothing is built (34d's review 8).
    if (from !== "private" && from !== "public") throw new Error(t("lj.launch.from"));
    this.check(network, token);
    await settleMaybeSent(this.deps, network);
    const box = whole(boxLovelace, () => t("lj.launch.boxLovelace"));
    let tokenQuantity: TokenQuantity | undefined;
    if (token) {
      const q = whole(quantity, () => t("lj.launch.quantity"));
      // A box of them must fit what an output may hold: the ledger's limit, the only one on Q.
      if (q < 1n || q > MAX_QUANTITY) throw new Error(t("lj.launch.quantity"));
      tokenQuantity = { ...token, quantity: q.toString() };
    } else if (box === CLASSIC_LOVELACE) {
      throw new Error(t("lj.launch.classicCopy"));
    }
    // A copy of a shown pool's values is never shown: the form lists the pools there are to join instead (11, 14).
    // Read once discovery has looked for pools launched since (34d's review 5): the request every wallet makes. A copy
    // handed over has a shown pool's values too, so either refuses it (MERGED-1).
    await this.deps.discovery.look(network);
    const known = await this.deps.discovery.known(network);
    const copy = known.find(
      (p) => BigInt(p.boxLovelace) === box && sameToken(p.token, token) && (!p.token || p.token.quantity === tokenQuantity?.quantity),
    );
    if (copy) throw new Error(t("lj.launch.copy"));
    const before = await this.startedBefore(network, known, box, tokenQuantity);
    const koios = this.deps.koios(network);
    const params = await koios.epochParams();
    const value = await this.boxValue(network, params, token, tokenQuantity ? BigInt(tokenQuantity.quantity) : undefined);
    if (box < BigInt(value.least)) throw new Error(t("lj.launch.tooLittle", { least: adaWords(value.least) }));
    if (value.most !== undefined && box > BigInt(value.most)) throw new Error(t("lj.launch.tooMuch", { most: adaWords(value.most) }));
    const maxFee = (box - 1n < MAX_FEE ? box - 1n : MAX_FEE).toString();
    const terms = { ...(tokenQuantity ? { token: tokenQuantity } : {}), boxLovelace: box.toString(), maxFee };

    // Built under the parameters its box's least and most were checked under: one read, never two that could straddle
    // an epoch's end (1.6.0's release review, 318-worker#3).
    const launch = from === "private" ? await this.fromPrivate(network, terms, params) : await this.fromPublic(network, terms, params);
    const { built, bare, origins, histories, invalidHereafter } = launch;
    const summary: LovejoinLaunchSummary = {
      network,
      txHash: built.txHash,
      from,
      pool: poolOf(built),
      locked: built.locked,
      fee: built.fee.total,
      change: built.changeLovelace,
      inputs: built.inputs.length,
      ...(histories ? { histories } : {}),
      ...(before ? { startedBefore: { txHash: before.txHash, at: before.at } } : {}),
    };
    const kept: Omit<KeptLaunch, "builtAt"> = {
      ...summary,
      ...sendable(built, origins?.built),
      reviewed: built.txHash,
      bare: sendable(bare, origins?.bare),
      ...(invalidHereafter !== undefined ? { invalidHereafter } : {}),
    };
    await keep(this.deps, SESSION_LOVEJOIN_LAUNCH, kept);
    return summary;
  }

  /**
   * The wallet's own start of a pool of these values (`box` of ADA, and `token`'s quantity) that no look has found yet,
   * if it sent one within STARTED_SAID_MS: a look takes a launch only once it's settled, ten minutes or so after its
   * block, and on mainnet the data layer's list is asked every few minutes, so the copy check above can't see it yet.
   * Sent again, one of the two lands after the other, a copy no wallet shows, what it locks gone for good. The chain
   * takes both, so nothing is refused (the owner's rule): its review says so (1.6.0's release review, 318-worker#1).
   * From the device alone, asking no one.
   */
  private async startedBefore(network: NetworkName, known: FoundPool[], box: bigint, token?: TokenQuantity) {
    const now = this.deps.now();
    const same = (b: { lovelace: string; token?: TokenQuantity }) =>
      b.lovelace === box.toString() && sameToken(b.token, token) && (!token || b.token?.quantity === token.quantity);
    return (await this.deps.lovejoin.launches(network))
      .filter((l) => !!l.box && same(l.box) && now - l.at < STARTED_SAID_MS && !known.some((p) => p.id === l.id))
      .at(-1);
  }

  /**
   * Built twice, for Send to choose between: registering mix_logic's credential, which the review shows, and without
   * the certificate. `only`: the second may spend these alone, the first's inputs.
   */
  private async both(build: (register: boolean, only?: OutRef[]) => Promise<Built>): Promise<{ built: Built; bare: Built }> {
    const built = await build(true);
    return { built, bare: await build(false, built.inputs) };
  }

  private async fromPrivate(
    network: NetworkName,
    terms: { token?: TokenQuantity; boxLovelace: string; maxFee: string },
    known: Record<string, unknown>,
  ): Promise<{
    built: Built;
    bare: Built;
    origins: { built: HistoryClass; bare: HistoryClass };
    histories?: HistoryClass[];
    invalidHereafter?: number;
  }> {
    const { wasm } = this.deps;
    const { view, utxos, params, returning, waiting, classes } = await readContract(this.deps, network, known);
    if (!utxos.length) throw nothingToSpend(this.deps, view, t("lj.launch.privateEmpty"), returning, waiting);
    // Without the certificate, from what the review showed it spends alone: coin selection keeps histories apart
    // (launch_apart), and needing 2 ₳ less it could pick UTxOs, and ties, the review never showed.
    const { built, bare } = await this.both((register, only) => {
      const request = { network, params, utxos: only ? utxos.filter(among(only)) : utxos, classes, ...terms, register };
      return measureLocally<Built>(this.deps, request, (keys, r) => wasm.buildLovejoinLaunch(keys.seedelf, r)).catch(
        (e: unknown) => {
          if (isTrap(e)) throw e;
          throw privateShort(e);
        },
      );
    });
    return {
      built,
      bare,
      origins: { built: changeHistory(classes, built.inputs), bare: changeHistory(classes, bare.inputs) },
      // The registering build's, the one reviewed: the most the start can tie together.
      histories: spentHistories(classes, built.inputs, built.classesMixed),
    };
  }

  private async fromPublic(
    network: NetworkName,
    terms: { token?: TokenQuantity; boxLovelace: string; maxFee: string },
    known: Record<string, unknown>,
  ): Promise<{ built: Built; bare: Built; origins?: undefined; histories?: undefined; invalidHereafter: number }> {
    const { wasm, wallet } = this.deps;
    const [{ params, utxos, collateral, held }, invalidHereafter] = await Promise.all([
      readAccount(this.deps, network, { params: known }),
      validUntil(this.deps.koios(network)),
    ]);
    if (!utxos.length) throw nothingInAccount(held, t("lj.launch.accountEmpty"));
    const request = { network, params, utxos, collateral, ...terms, invalidHereafter };
    // The account's UTxOs in the same order each time (pure ADA, the largest first): the second spends a first part
    // of the first's, the same seed among them.
    const { built, bare } = await this.both((register) =>
      wallet.withKeys(
        (keys) => JSON.parse(wasm.buildLovejoinLaunchFromAccount(keys.cardano, JSON.stringify({ ...request, register }))) as Built,
      ),
    );
    return { built, bare, invalidHereafter };
  }

  /**
   * Sends the pool's start reviewed as `txHash`, as any spend from its side is sent, then keeps, sealed, that the
   * wallet started it (lovejoin.ts recordLaunch). The pool is read from when discovery finds it, as every wallet's.
   * First, at its first Send, what only a start the user sends asks Koios (see the top of this file).
   */
  async submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wallet, session } = this.deps;
    let kept = await wallet.withKeys(() => session.get<KeptLaunch>(SESSION_LOVEJOIN_LAUNCH));
    const ours = kept?.network === network && (kept.txHash === txHash || kept.reviewed === txHash);
    // Not for a review too old to send, which Send refuses as it is (send).
    const fresh = !!kept && this.deps.now() - kept.builtAt <= BUILT_TTL_MS;
    // Send asked again for a review whose start went as the build without the certificate (choose): its kept copy went
    // once Koios took it, and no record of what's sent has the review's hash. Said as sent, never as a review to build
    // again, which would make a copy of the pool sent (1.6.0's release review, 318-worker#1).
    if (!(kept && ours) && (await this.deps.lovejoin.launches(network)).some((l) => l.reviewed === txHash)) {
      throw new Error(t("worker.spend.sentAlready"));
    }
    if (kept && ours && fresh && kept.sentCbor === undefined && kept.bare) kept = await this.choose(network, kept);
    const sending = kept && ours ? kept.txHash : txHash;
    const pending = await send(this.deps, network, sending, SESSION_LOVEJOIN_LAUNCH, "lovejoin-launch", "launch");
    if (kept && ours) {
      await this.deps.lovejoin
        .recordLaunch(network, {
          id: kept.pool.id,
          txHash: kept.txHash,
          from: kept.from,
          ...(kept.from === "public" && kept.account !== undefined ? { account: kept.account } : {}),
          // Its values, so a start of the same ones before a look finds this one says so (startedBefore).
          box: { lovelace: kept.pool.boxLovelace, ...(kept.pool.token ? { token: kept.pool.token } : {}) },
          ...(kept.reviewed !== kept.txHash ? { reviewed: kept.reviewed } : {}),
        })
        .catch(() => undefined);
    }
    return pending;
  }

  /**
   * Send's check on the start `kept`: which build goes. Kept again as it will be sent, the other build gone, so Send
   * again sends it as it is. Nothing is sent when it refuses.
   */
  private async choose(network: NetworkName, kept: KeptLaunch): Promise<KeptLaunch> {
    const koios = this.deps.koios(network);
    const { bare, ...rest } = kept;
    let chosen: KeptLaunch = rest;
    // A read that fails keeps the certificate: a start whose credential was registered meanwhile is refused at
    // submit, and built again.
    const registered = async (stake: string) => (await koios.accountInfo(stake).catch(() => undefined))?.status === "registered";
    if (bare && (await registered(kept.mixLogicStake))) {
      // Built without the deposit, it may spend another seed: another pool, whose credential nothing registered.
      // Never sent so: no wallet would show it, its ADA locked for good (34d's review 4).
      if (bare.pool.id !== kept.pool.id && !(await registered(bare.mixLogicStake))) throw new Error(t("lj.launch.otherPool"));
      chosen = { ...rest, ...bare };
    }
    await this.deps.wallet.withKeys(() => this.deps.session.set(SESSION_LOVEJOIN_LAUNCH, chosen));
    return chosen;
  }
}

/** Whether a UTxO is one of `refs`. */
const among = (refs: OutRef[]) => (u: KoiosUtxo) => refs.some((r) => r.txHash === u.tx_hash && r.txIndex === u.tx_index);

/** The pool a build makes, as a summary shows it. */
function poolOf(built: Built): LovejoinLaunchSummary["pool"] {
  return { id: built.pool.id, boxLovelace: built.pool.boxLovelace, ...(built.pool.token ? { token: built.pool.token } : {}) };
}

/** What Send needs of a build. */
function sendable(built: Built, origin?: HistoryClass): Sendable {
  return {
    txHash: built.txHash,
    txCbor: built.txCbor,
    ...(built.seed !== undefined ? { seed: built.seed } : {}),
    pool: poolOf(built),
    locked: built.locked,
    fee: built.fee.total,
    change: built.changeLovelace,
    inputs: built.inputs.length,
    lovelace: built.locked.total,
    mixLogicStake: built.mixLogicStake,
    ...(origin ? { origin } : {}),
  };
}
