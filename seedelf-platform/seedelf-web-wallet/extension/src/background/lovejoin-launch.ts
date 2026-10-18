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
// - 30 boxes' worth fit in the token's total supply (Koios's asset_info);
// - no shown pool has these values already (11): a copy is never shown, so
//   it's refused, and the form lists the pools there are to join (14);
// - every box's ADA is at least what one needs to come back and pay part of
//   itself on its own under the live parameters (S0d's rule, worked out in
//   WebAssembly: lovejoinBoxValue), and at most 9 ₳ in a token pool (27).
// Then WebAssembly builds it, measures it in the wallet, and checks the pool
// it makes from its own bytes, as a stranger's would be checked. mix_logic's
// credential is registered in the launch unless account_info says something
// registered it already (whoever reads the seed can): it's built again
// without the certificate then, and is still standard (34c).
//
// Koios requests: the protocol parameters and the contract or the account,
// as any spend reads them; asset_info for a token pool's supply; one
// account_info. Sent as any spend from its side is: a Seedelf spend with
// giveme.my's collateral, or the account's, signed at review.

import { t } from "../i18n";
import { lovejoinOn, type NetworkName } from "../networks";
import type { HistoryClass } from "../shared/histories";
import type { LovejoinLaunchSummary, LovejoinLaunchTerms, PendingTx, TokenQuantity } from "../shared/rpc";
import { nothingInAccount, readAccount, validUntil } from "./account";
import type { LovejoinService } from "./lovejoin";
import { isListed, type PoolDiscovery } from "./lovejoin-pools";
import { settleMaybeSent } from "./pending";
import { adaWords, privateShort } from "./short";
import {
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

/** How many boxes' worth of its token a token's total supply must hold (session 1, 14). */
export const LAUNCH_SUPPLY_BOXES = 30n;

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

export interface LaunchDeps extends ScriptSpendDeps {
  lovejoin: Pick<LovejoinService, "recordLaunch">;
  /** The pools shown on a network (lovejoin-pools.ts): a launch of their values would be a copy, never shown. */
  discovery: Pick<PoolDiscovery, "known">;
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
    const params = await this.deps.koios(network).epochParams();
    const value = await this.boxValue(network, params, token, q);
    const pools = (await this.deps.discovery.known(network))
      .filter((p) => sameToken(p.token, token))
      .map((p) => ({ id: p.id, boxLovelace: p.boxLovelace, ...(p.token ? { token: p.token } : {}) }));
    return { ...value, pools };
  }

  /**
   * Builds a pool's start, from `from`'s side: a token pool of `quantity` (raw) of `token` a box, or an ADA pool, with
   * `boxLovelace` of ADA a box. Every check first (see the top of this file), then the build, kept for Send.
   */
  async build(
    network: NetworkName,
    { from, token, quantity, boxLovelace }: { from: "private" | "public"; token?: Token; quantity?: string; boxLovelace: string },
  ): Promise<LovejoinLaunchSummary> {
    this.check(network, token);
    await settleMaybeSent(this.deps, network);
    const box = whole(boxLovelace, () => t("lj.launch.boxLovelace"));
    let tokenQuantity: TokenQuantity | undefined;
    if (token) {
      const q = whole(quantity, () => t("lj.launch.quantity"));
      if (q < 1n || q > MAX_QUANTITY) throw new Error(t("lj.launch.quantity"));
      // Thirty boxes' worth must exist (session 1, 14), and a box of them must fit what an output may hold.
      if (q * LAUNCH_SUPPLY_BOXES > MAX_QUANTITY) throw new Error(t("lj.launch.quantity"));
      const supply = await this.deps.koios(network).assetSupply(token.policyId, token.assetName);
      if (supply === undefined) throw new Error(t("lj.launch.unknownToken"));
      if (q * LAUNCH_SUPPLY_BOXES > supply) throw new Error(t("lj.launch.supply", { boxes: Number(LAUNCH_SUPPLY_BOXES) }));
      tokenQuantity = { ...token, quantity: q.toString() };
    } else if (box === CLASSIC_LOVELACE) {
      throw new Error(t("lj.launch.classicCopy"));
    }
    // A copy of a shown pool's values is never shown: the form lists the pools there are to join instead (11, 14).
    const copy = (await this.deps.discovery.known(network)).find(
      (p) => BigInt(p.boxLovelace) === box && sameToken(p.token, token) && (!p.token || p.token.quantity === tokenQuantity?.quantity),
    );
    if (copy) throw new Error(t("lj.launch.copy"));
    const koios = this.deps.koios(network);
    const params = await koios.epochParams();
    const value = await this.boxValue(network, params, token, tokenQuantity ? BigInt(tokenQuantity.quantity) : undefined);
    if (box < BigInt(value.least)) throw new Error(t("lj.launch.tooLittle", { least: adaWords(value.least) }));
    if (value.most !== undefined && box > BigInt(value.most)) throw new Error(t("lj.launch.tooMuch", { most: adaWords(value.most) }));
    const maxFee = (box - 1n < MAX_FEE ? box - 1n : MAX_FEE).toString();
    const terms = { ...(tokenQuantity ? { token: tokenQuantity } : {}), boxLovelace: box.toString(), maxFee };

    const launch = from === "private" ? await this.fromPrivate(network, terms) : await this.fromPublic(network, terms);
    const { built, origin, histories, invalidHereafter } = launch;
    const summary: LovejoinLaunchSummary = {
      network,
      txHash: built.txHash,
      from,
      pool: {
        id: built.pool.id,
        boxLovelace: built.pool.boxLovelace,
        ...(built.pool.token ? { token: built.pool.token } : {}),
      },
      locked: built.locked,
      fee: built.fee.total,
      change: built.changeLovelace,
      inputs: built.inputs.length,
      ...(histories ? { histories } : {}),
    };
    // What leaves the balance for good, for the private history once it's sent: what the launch locks.
    const kept = {
      ...summary,
      lovelace: built.locked.total,
      txCbor: built.txCbor,
      ...(built.seed !== undefined ? { seed: built.seed } : {}),
      ...(invalidHereafter !== undefined ? { invalidHereafter } : {}),
      ...(origin ? { origin } : {}),
    };
    await keep(this.deps, SESSION_LOVEJOIN_LAUNCH, kept);
    return summary;
  }

  /**
   * Built twice at most: once registering mix_logic's credential, and again without the certificate when
   * account_info says something registered it already. A read that fails keeps the certificate: a launch whose
   * credential was registered meanwhile is refused at submit, and built again.
   */
  private async registered(network: NetworkName, build: (register: boolean) => Promise<Built>): Promise<Built> {
    const first = await build(true);
    const info = await this.deps
      .koios(network)
      .accountInfo(first.mixLogicStake)
      .catch(() => undefined);
    return info?.status === "registered" ? build(false) : first;
  }

  private async fromPrivate(
    network: NetworkName,
    terms: { token?: TokenQuantity; boxLovelace: string; maxFee: string },
  ): Promise<{ built: Built; origin: HistoryClass; histories?: HistoryClass[]; invalidHereafter?: number }> {
    const { wasm } = this.deps;
    const { view, utxos, params, returning, classes } = await readContract(this.deps, network);
    if (!utxos.length) throw nothingToSpend(this.deps, view, t("lj.launch.privateEmpty"), returning);
    const built = await this.registered(network, (register) =>
      measureLocally<Built>(this.deps, { network, params, utxos, classes, ...terms, register }, (keys, r) =>
        wasm.buildLovejoinLaunch(keys.seedelf, r),
      ).catch((e: unknown) => {
        if (isTrap(e)) throw e;
        throw privateShort(e);
      }),
    );
    return {
      built,
      origin: changeHistory(classes, built.inputs),
      histories: spentHistories(classes, built.inputs, built.classesMixed),
    };
  }

  private async fromPublic(
    network: NetworkName,
    terms: { token?: TokenQuantity; boxLovelace: string; maxFee: string },
  ): Promise<{ built: Built; origin?: undefined; histories?: undefined; invalidHereafter: number }> {
    const { wasm, wallet } = this.deps;
    const [{ params, utxos, collateral, held }, invalidHereafter] = await Promise.all([
      readAccount(this.deps, network),
      validUntil(this.deps.koios(network)),
    ]);
    if (!utxos.length) throw nothingInAccount(held, t("lj.launch.accountEmpty"));
    const request = { network, params, utxos, collateral, ...terms, invalidHereafter };
    const built = await this.registered(network, (register) =>
      wallet.withKeys(
        (keys) => JSON.parse(wasm.buildLovejoinLaunchFromAccount(keys.cardano, JSON.stringify({ ...request, register }))) as Built,
      ),
    );
    return { built, invalidHereafter };
  }

  /**
   * Sends the pool's start built last (`txHash`), as any spend from its side is sent, then keeps, sealed, that the
   * wallet started it (lovejoin.ts recordLaunch). The pool is read from when discovery finds it, as every wallet's.
   */
  async submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wallet, session } = this.deps;
    const kept = await wallet.withKeys(() => session.get<LovejoinLaunchSummary & { account?: number }>(SESSION_LOVEJOIN_LAUNCH));
    const pending = await send(this.deps, network, txHash, SESSION_LOVEJOIN_LAUNCH, "lovejoin-launch", "launch");
    if (kept?.txHash === txHash && kept.network === network) {
      await this.deps.lovejoin
        .recordLaunch(network, {
          id: kept.pool.id,
          txHash,
          from: kept.from,
          ...(kept.from === "public" && kept.account !== undefined ? { account: kept.account } : {}),
        })
        .catch(() => undefined);
    }
    return pending;
  }
}
