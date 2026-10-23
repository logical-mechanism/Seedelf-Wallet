// Every Seedelf script spend (a stealth mint, a transfer; sweep and remove
// next) is built and sent the same way:
//
// build  reads the wallet contract (contract-scan.ts: in full when due,
//        otherwise only what's new) and the protocol parameters; the caller
//        makes the WebAssembly request from them. WebAssembly builds it
//        under a new one-time key and measures its scripts itself (uplc):
//        no draft goes to Koios, whose Ogmios would learn from its proofs
//        which contract UTxOs are this wallet's. The unsigned transaction
//        waits in session storage, with its one-time key's seed, until Send.
// send   giveme.my witnesses the collateral; WebAssembly checks that
//        signature and adds it with the one-time key's, re-derived from the
//        seed, so a restarted worker still signs. Koios submits exactly that
//        transaction, and the pending watch takes over (pending.ts). One
//        Koios didn't answer may have gone through: it's kept, signed, and
//        Send sends those very bytes again. One Koios took isn't kept any
//        more: Send again, from a page that missed the answer, hears it was
//        sent already, never that its review is stale (pending.ts
//        `refuseSent`, chunk 23's second review, fix round).
//
// A transaction WebAssembly signed at review (an account-paid mint, and the
// public account's send and staking) is kept without a seed, and Send only
// submits it.

import { type I18nKey, t } from "../i18n";
import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { merged, UNKNOWN, type HistoryClass } from "../shared/histories";
import type { PendingTx, TokenQuantity } from "../shared/rpc";
import { CONTRACT_V1, type ContractConfig } from "./balances";
import { txInputs } from "./cbor";
import { seedelfTokenOf } from "./chain";
import type { ActivityService } from "./activity";
import type { CoinControlService } from "./coin-control";
import { CollateralRefusedError, StaleReviewError, type Collateral } from "./collateral";
import { forgetContractView, readContractView, type ContractView } from "./contract-scan";
import type { Koios, KoiosUtxo } from "./koios";
import type { PreferencesService } from "./preferences";
import { refuseSent, settleMaybeSent, submitWatched } from "./pending";
import type { PrivateIndex } from "./private-index";
import type { PrivateStore } from "./private-store";
import type { Area } from "./storage";
import { outpoint, reservations, spentSet, type Reservation } from "./spent";
import type { Keys, Wallet } from "./wallet";

/** A built transaction is only sent within this long; after that, build again. */
export const BUILT_TTL_MS = 10 * 60_000;

/**
 * What a kept transaction is, as `send` names it when it refuses to send it.
 * Each refusal is a whole sentence per kind, never a noun put into one: each
 * language words the noun itself, with the gender and the pronoun it takes
 * ("Revísalo" for a payment, "Revísala" for a mix).
 */
export type SpendWhat = "payment" | "seedelf" | "staking" | "collateral" | "removal" | "mix" | "topUp" | "launch";

/** The one kept isn't the one reviewed, or none is. */
const NOT_READY: Record<SpendWhat, I18nKey> = {
  payment: "worker.spend.notReady.payment",
  seedelf: "worker.spend.notReady.seedelf",
  staking: "worker.spend.notReady.staking",
  collateral: "worker.spend.notReady.collateral",
  removal: "worker.spend.notReady.removal",
  mix: "worker.spend.notReady.mix",
  topUp: "worker.spend.notReady.topUp",
  launch: "worker.spend.notReady.launch",
};

/** Built more than BUILT_TTL_MS ago. */
const TOO_OLD: Record<SpendWhat, I18nKey> = {
  payment: "worker.spend.tooOld.payment",
  seedelf: "worker.spend.tooOld.seedelf",
  staking: "worker.spend.tooOld.staking",
  collateral: "worker.spend.tooOld.collateral",
  removal: "worker.spend.tooOld.removal",
  mix: "worker.spend.tooOld.mix",
  topUp: "worker.spend.tooOld.topUp",
  launch: "worker.spend.tooOld.launch",
};

/** It spends what a chain through Lovejoin sent since will spend (refuseReserved). */
const CHAIN_CONFLICT: Record<SpendWhat, I18nKey> = {
  payment: "worker.spend.chainConflict.payment",
  seedelf: "worker.spend.chainConflict.seedelf",
  staking: "worker.spend.chainConflict.staking",
  collateral: "worker.spend.chainConflict.collateral",
  removal: "worker.spend.chainConflict.removal",
  mix: "worker.spend.chainConflict.mix",
  topUp: "worker.spend.chainConflict.topUp",
  launch: "worker.spend.chainConflict.launch",
};

/** It spends what a payment's parts still to go, sent since, will spend (refuseReserved). */
const PARTS_CONFLICT: Record<SpendWhat, I18nKey> = {
  payment: "worker.spend.partsConflict.payment",
  seedelf: "worker.spend.partsConflict.seedelf",
  staking: "worker.spend.partsConflict.staking",
  collateral: "worker.spend.partsConflict.collateral",
  removal: "worker.spend.partsConflict.removal",
  mix: "worker.spend.partsConflict.mix",
  topUp: "worker.spend.partsConflict.topUp",
  launch: "worker.spend.partsConflict.launch",
};

/**
 * How the reservation of a payment's parts still to go is named (parts.ts); every other chain being sent goes through
 * Lovejoin. Each is said as what it is: the parts read as a return through Lovejoin (1.6.0 review).
 */
export const PARTS_RESERVED = "parts.";

export interface ScriptSpendDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  session: Area;
  koios: (network: NetworkName) => Koios;
  collateral: (network: NetworkName) => Collateral;
  now: () => number;
  contract?: ContractConfig;
  /** Waits between reads of a Koios backend that's behind (spent.ts); tests don't. */
  sleep?: (ms: number) => Promise<void>;
  /** Writes each spend into the Seedelf history once it's submitted. */
  activity?: ActivityService;
  /** Leaves out what the user locked, on both sides. */
  coins: CoinControlService;
  /** Whether an account-paid spend (a mint, a send) spends staking rewards too. */
  preferences?: PreferencesService;
  /** Where a send that may still go through is sealed (pending.ts). */
  store: PrivateStore;  /** The private index, where it's read now (contract-scan.ts). */
  index?: (network: NetworkName) => Promise<PrivateIndex | undefined>;
}

/** A built transaction waiting in session storage for Send. */
export interface Kept {
  network: NetworkName;
  txHash: string;
  /** Unsigned when it has a `seed`; signed at review otherwise. */
  txCbor: string;
  /** The one-time key's seed. */
  seed?: string;
  builtAt: number;
  /** The slot it stops being valid at: the public account's (account.ts `validUntil`). */
  invalidHereafter?: number;
  /** Signed as sent, once a submit went unanswered: Send sends it again as it is (pending.ts). */
  sentCbor?: string;
  /** The history of what it leaves in the private balance, for the Seedelf history once it's sent (activity.ts). */
  origin?: HistoryClass;
  /** The public account active when it was built: the one a payment from the account spends (pending.ts `Sending`). */
  account?: number;
  /** A payment in several transactions: every part's hash, in order, kept with the first (keepParts). */
  partHashes?: string[];
}

/**
 * Each private UTxO's history (activity.ts `classes`), as WebAssembly takes
 * it: by outpoint, the known ones only. Coin selection keeps different ones
 * apart where it can (privacy review §2.3); with none, it picks as the CLI
 * does.
 */
export type Classes = Record<string, HistoryClass>;

/** An input a WebAssembly spend reports. */
export interface OutRef {
  txHash: string;
  txIndex: number;
}

const classOf = (classes: Classes, i: OutRef) => classes[`${i.txHash}#${i.txIndex}`] ?? UNKNOWN;

/** The history of what a spend of `inputs` leaves in the private balance, its change: theirs, merged. */
export function changeHistory(classes: Classes, inputs: OutRef[]): HistoryClass {
  return merged(inputs.map((i) => classOf(classes, i)));
}

/**
 * `classes` with each carry a payment's `parts` spend (parts.ts): a chained part spends what the part before it
 * carried forward, an output no history names at review. Its money is what that part spent, merged, as WebAssembly
 * builds the next part with it (lib.rs `Carried`). Read as Unknown, the review said the payment merged money the
 * wallet has no history for, and each later part's change was sealed with that for good (1.6.0 review). Money of no
 * history carried forward stays out, as `classesOf` leaves it out.
 */
export function carried(classes: Classes, parts: Array<{ txHash: string; inputs: OutRef[] }>): Classes {
  const all = { ...classes };
  for (const [i, part] of parts.entries()) {
    const origin = changeHistory(all, part.inputs);
    if (origin.id === UNKNOWN.id) continue;
    for (const carry of parts.slice(i + 1).flatMap((p) => p.inputs.filter((o) => o.txHash === part.txHash))) {
      all[`${carry.txHash}#${carry.txIndex}`] = origin;
    }
  }
  return all;
}

/**
 * The histories a spend's `inputs` have, each once, for its review: the
 * classes WebAssembly says it spent together (`mixed`), or the one they
 * share. None when the wallet knows nothing of them. Money with no history
 * merged from two transactions is said too: it's two classes only while
 * something else's is known (activity.ts `classes`, independent review L40).
 */
export function spentHistories(classes: Classes, inputs: OutRef[], mixed: string[] = []): HistoryClass[] | undefined {
  const all = inputs.map((i) => classOf(classes, i));
  const spent = mixed.length ? mixed.map((id) => all.find((c) => c.id === id) ?? UNKNOWN) : all.slice(0, 1);
  return spent.length > 1 || spent.some((c) => c.origin !== "unknown") ? spent : undefined;
}

/**
 * This wallet's view of the contract (contract-scan.ts), what a Seedelf
 * spend may pay with (`utxos`: owned, holding no seedelf, not locked, and
 * not `returning`), and the protocol parameters. `returning`: what a chain
 * being sent will spend, left out: a return through Lovejoin's, or a
 * payment's parts still to go (`waiting`, of those: parts.ts). A session's
 * return ends merged into its funding's change, many blocks after its chain
 * starts, so no other spend of the private balance takes that change
 * meanwhile (final review lovejoin-3). The view itself is left as it is.
 * `classes`: where each of `utxos` came from, from the sealed history alone
 * (Koios is asked nothing), for coin selection. `known`: the parameters, when
 * the caller read them already, so they're read once.
 */
export async function readContract(
  deps: ScriptSpendDeps,
  network: NetworkName,
  known?: Record<string, unknown>,
): Promise<{
  view: ContractView;
  utxos: KoiosUtxo[];
  params: Record<string, unknown>;
  returning: KoiosUtxo[];
  waiting: KoiosUtxo[];
  classes: Classes;
}> {
  const [view, params, sending] = await Promise.all([
    readContractView(deps, network),
    known ?? deps.koios(network).epochParams(),
    sendingChains(deps, network),
  ]);
  const reserved = new Set(sending.flatMap(([, r]) => r.inputs));
  const parted = new Set(sending.flatMap(([chain, r]) => (chain.startsWith(PARTS_RESERVED) ? r.inputs : [])));
  const all = spendable(deps, view);
  const returning = all.filter((u) => reserved.has(outpoint(u)));
  const waiting = returning.filter((u) => parted.has(outpoint(u)));
  const free = all.filter((u) => !reserved.has(outpoint(u)));
  const utxos = await deps.coins.seedelf(network, free);
  return { view, utxos, params, returning, waiting, classes: await classesOf(deps, network, utxos) };
}

/**
 * The chains being sent on `network`, by name (spent.ts reservations: none only kept for Send), but `except`. Call
 * it while unlocked.
 */
function sendingChains(
  deps: Pick<ScriptSpendDeps, "wallet" | "session" | "now">,
  network: NetworkName,
  except?: string,
): Promise<Array<[string, Reservation]>> {
  return deps.wallet.withKeys(async () =>
    Object.entries(await reservations(deps.session, network, deps.now())).filter(
      ([chain, r]) => chain !== except && r.until === undefined,
    ),
  );
}

/**
 * `readContract`'s `classes`. A history that won't open costs only the keeping apart: selection then picks as the CLI does.
 * Unknown money is left out, but for one kept apart by its transaction (independent review L40).
 */
export async function classesOf(
  deps: Pick<ScriptSpendDeps, "activity">,
  network: NetworkName,
  utxos: KoiosUtxo[],
): Promise<Classes> {
  const found = (await deps.activity?.classes(network, utxos).catch(() => undefined)) ?? new Map<string, HistoryClass>();
  return Object.fromEntries([...found].filter(([, c]) => c.id !== UNKNOWN.id));
}

/**
 * Why a Seedelf spend has nothing to pay with: `utxos` from readContract,
 * `empty` for an empty balance, and `returning` (readContract's) for what a
 * chain being sent holds; `waiting`, of those, a payment's parts still to go,
 * which are said as that when they're all it holds.
 */
export function nothingToSpend(
  deps: Pick<ScriptSpendDeps, "contract">,
  view: ContractView,
  empty: string,
  returning: KoiosUtxo[] = [],
  waiting: KoiosUtxo[] = [],
): Error {
  const all = spendable(deps, view);
  if (!all.length) return new Error(empty);
  const parts = waiting.length === returning.length;
  if (returning.length === all.length) {
    return new Error(
      t(parts ? "worker.spend.waitsForParts" : "worker.spend.waitsForReturn"),
    );
  }
  if (returning.length) {
    return new Error(
      t(parts ? "worker.spend.allLockedOrParts" : "worker.spend.allLockedOrWaiting"),
    );
  }
  return new Error(t("worker.spend.allLocked"));
}

/**
 * What the Seedelf balance counts: owned UTxOs that don't hold a seedelf, or a
 * reference script. Anyone can pay a Seedelf one carrying a script, and the
 * wallet's script evaluator can't spend it yet (`eval::refusal`).
 */
export function spendable(deps: Pick<ScriptSpendDeps, "contract">, view: ContractView): KoiosUtxo[] {
  const { contract = CONTRACT_V1 } = deps;
  return view.owned.filter((u) => !seedelfTokenOf(u, contract.seedelfPolicyId) && !u.reference_script);
}

/** The owned UTxOs `spendable` leaves out for a reference script: no Seedelf spend takes them yet. */
export function unspendable(deps: Pick<ScriptSpendDeps, "contract">, view: ContractView): KoiosUtxo[] {
  const { contract = CONTRACT_V1 } = deps;
  return view.owned.filter((u) => !seedelfTokenOf(u, contract.seedelfPolicyId) && !!u.reference_script);
}

/**
 * Builds a Seedelf spend with WebAssembly in one call: it proves the spend
 * and measures its scripts in the wallet, so nothing is sent before Send.
 * `build` is the WebAssembly call: JSON in, JSON out.
 */
export function measureLocally<F>(
  deps: Pick<ScriptSpendDeps, "wallet">,
  request: object,
  build: (keys: Keys, request: string) => string,
): Promise<F> {
  return deps.wallet.withKeys((keys) => JSON.parse(build(keys, JSON.stringify(request))) as F);
}

/**
 * Drafts with WebAssembly, has Ogmios measure the draft, and finishes it:
 * the account-paid mint, whose draft holds nothing private.
 * `draft` and `finish` are the WebAssembly calls: JSON in, JSON out. The
 * finish gets the request plus the draft's seed and Ogmios's evaluation.
 */
export async function measure<F>(
  deps: ScriptSpendDeps,
  network: NetworkName,
  request: object,
  draft: (keys: Keys, request: string) => string,
  finish: (keys: Keys, request: string) => string,
): Promise<F> {
  const { wallet } = deps;
  const drafted = await wallet.withKeys(
    (keys) => JSON.parse(draft(keys, JSON.stringify(request))) as { seed?: string; draftCbor: string },
  );
  const evaluation = await deps.koios(network).evaluate(drafted.draftCbor);
  return wallet.withKeys(
    (keys) => JSON.parse(finish(keys, JSON.stringify({ ...request, seed: drafted.seed, evaluation }))) as F,
  );
}

/** Keeps a built transaction, with its summary, for Send. Refused once locked. */
export function keep(deps: ScriptSpendDeps, key: string, built: Omit<Kept, "builtAt"> & object): Promise<void> {
  return deps.wallet.withKeys((keys) => deps.session.set(key, { ...built, builtAt: deps.now(), account: keys.account }));
}

/**
 * Sends the transaction kept under `key`, if it's the one reviewed (`txHash`
 * on `network`) and not too old. `what` says what it is in errors. One Koios
 * didn't answer comes back maybe sent (pending.ts), and stays kept: Send
 * again sends the same bytes, however old, and asks giveme.my nothing. One
 * sent already isn't kept any more, and says so (pending.ts `refuseSent`),
 * never that its review is stale. `waited`: a part of a payment that waited
 * for the part before it to be in a block (parts.ts), sent after Send was
 * pressed for the whole however long ago it was built, and spending what its
 * own reservation, so named, holds.
 */
export async function send(
  deps: ScriptSpendDeps,
  network: NetworkName,
  txHash: string,
  key: string,
  kind: PendingTx["kind"],
  what: SpendWhat,
  { chain, waited }: { chain?: PendingTx["chain"]; waited?: string } = {},
): Promise<PendingTx> {
  const { wasm, wallet, session, now } = deps;
  const built = await wallet.withKeys(() => session.get<Kept>(key));
  if (!built || built.txHash !== txHash || built.network !== network) {
    await refuseSent(deps, network, txHash);
    throw new StaleReviewError(t(NOT_READY[what]));
  }
  const again = built.sentCbor !== undefined;
  if (!again) {
    if (waited === undefined && now() - built.builtAt > BUILT_TTL_MS) {
      throw new StaleReviewError(t(TOO_OLD[what]));
    }
    await settleMaybeSent(deps, network);
  }

  let txCbor = built.sentCbor ?? built.txCbor;
  if (built.seed !== undefined && !again) {
    // Something it spends went out since the review, in another of this wallet's transactions (another page's
    // Send, say): said as that, before giveme.my is asked, so a refusal from giveme.my is never put down to the
    // user's own money when the device knows of nothing spent (blind test §9.5, T09).
    await refuseSpentSince(deps, network, txHash, built.txCbor);
    let collateral: unknown;
    try {
      collateral = await deps.collateral(network).witness(built.txCbor);
    } catch (e) {
      // giveme.my checks the chain first, so this refusal may be a UTxO the
      // kept view still has as ours: read the contract in full next time, as
      // the "refresh, then review it again" it asks for expects. Not for an
      // outage or a limit, which says nothing about the view: a full read on
      // every retry would only spend Koios's budget (cross-area review).
      if (e instanceof CollateralRefusedError && !e.busy) await forgetContractView(deps, network);
      throw e;
    }
    const signed = await wallet.withKeys(
      (keys) =>
        JSON.parse(
          wasm.signScriptSpend(keys.seedelf, JSON.stringify({ txCbor: built.txCbor, seed: built.seed, collateral })),
        ) as { txCbor: string; txHash: string },
    );
    if (signed.txHash !== txHash) throw new Error(t("worker.spend.signingChanged"));
    txCbor = signed.txCbor;
  }
  // Reviewed before a return through Lovejoin started being sent, it may take what that chain spends: the
  // funding change its last transaction merges into. Only one of the two could land, so this one waits for a
  // review that leaves it out (independent review L18). Checked last, just before it goes.
  if (!again) await refuseReserved(deps, network, built.txCbor, what, waited);
  const { txCbor: _txCbor, seed: _seed, sentCbor: _sentCbor, builtAt: _builtAt, account: _account, ...summary } = built;
  return submitWatched(deps, {
    network,
    txHash,
    kind,
    txCbor,
    key,
    kept: built,
    summary,
    // A transaction signed at review spends the account, not the contract.
    contract: built.seed !== undefined,
    invalidHereafter: built.invalidHereafter,
    again,
    ...(built.account !== undefined ? { account: built.account } : {}),
    ...(chain ? { chain } : {}),
  });
}

/**
 * The most transactions one payment goes out as (WebAssembly's `MAX_PARTS`): 20 UTxOs each, 500 in all, the boxes
 * of pools brought back all at once (the owner's test of 1.6.0).
 */
export const MAX_PARTS = 25;

/** One part of a payment WebAssembly built as several transactions (`buildTransferParts`, `buildWithdrawParts`). */
export interface PartBuilt {
  txHash: string;
  max: boolean;
  payments: Array<{ lovelace: string; minimum: string | null; tokens: TokenQuantity[] }>;
  fee: { size: string; compute: string; scriptReference: string; total: string };
  changeLovelace: string;
  changeTokens: number;
  changeOutputs: number;
  changeMinimum: string;
  inputs: OutRef[];
  left: number;
  classesMixed: string[];
}

/**
 * A payment's parts as one, for its review (the owner's test of 1.6.0: "spending more than the max amount of utxos
 * does not create two healthy tx"): one recipient, paid what they all pay, with the tokens of each; the least they
 * carry, their fees and change added up; every UTxO they spend; Max only where every part is (an amount's parts but
 * its last may pay all their UTxOs hold); what Max left, the last's. One part is itself.
 *
 * `read`: readContract's `classes`, each carry's with them (`carried`), and `utxos`. The parts tie everything they
 * spend as one transaction would (privacy.md), so the histories merged are those of every UTxO any part spends, two
 * or more of them; and a token kept in several parts is kept once (1.6.0 review). Without it, each part's own, added
 * up, which is all a shortfall's `most` asks of it.
 */
export function whole<P extends PartBuilt>(parts: P[], read?: { classes: Classes; utxos: KoiosUtxo[] }): P {
  const [first] = parts;
  if (parts.length === 1) return first!;
  const last = parts.at(-1)!;
  const sum = (of: (p: P) => string) => parts.reduce((n, p) => n + BigInt(of(p)), 0n).toString();
  const tokens = new Map<string, TokenQuantity>();
  for (const token of parts.flatMap((p) => p.payments[0]!.tokens)) {
    const key = `${token.policyId}.${token.assetName}`;
    const had = tokens.get(key);
    tokens.set(key, had ? { ...had, quantity: (BigInt(had.quantity) + BigInt(token.quantity)).toString() } : token);
  }
  // The least they carry, added up, so the review says when that's all they pay; none where a part is Max's.
  const minimum = parts.every((p) => p.payments[0]!.minimum !== null) ? sum((p) => p.payments[0]!.minimum!) : null;
  return {
    ...first!,
    max: parts.every((p) => p.max),
    payments: [{ ...last.payments[0]!, lovelace: sum((p) => p.payments[0]!.lovelace), minimum, tokens: [...tokens.values()] }],
    fee: {
      size: sum((p) => p.fee.size),
      compute: sum((p) => p.fee.compute),
      scriptReference: sum((p) => p.fee.scriptReference),
      total: sum((p) => p.fee.total),
    },
    changeLovelace: sum((p) => p.changeLovelace),
    changeTokens: read ? tokensKept(read.utxos, parts) : parts.reduce((n, p) => n + p.changeTokens, 0),
    changeOutputs: parts.reduce((n, p) => n + p.changeOutputs, 0),
    changeMinimum: last.changeMinimum,
    inputs: parts.flatMap((p) => p.inputs),
    left: last.left,
    classesMixed: read ? spentTogether(read.classes, parts) : [...new Set(parts.flatMap((p) => p.classesMixed))],
  };
}

/** The histories a payment's parts spend, each once, when they're more than one: a carry's is the part before's. */
function spentTogether(classes: Classes, parts: PartBuilt[]): string[] {
  const made = new Set(parts.map((p) => p.txHash));
  const own = parts.flatMap((p) => p.inputs).filter((i) => !made.has(i.txHash));
  const ids = [...new Set(own.map((i) => classOf(classes, i).id))];
  return ids.length > 1 ? ids : [];
}

/** How many tokens a payment's parts keep in the private balance, each once: what their UTxOs hold past what's paid. */
function tokensKept(utxos: KoiosUtxo[], parts: PartBuilt[]): number {
  const at = new Map(utxos.map((u) => [outpoint(u), u]));
  const left = new Map<string, bigint>();
  const add = (policyId: string, assetName: string, quantity: bigint) => {
    const key = `${policyId}.${assetName}`;
    left.set(key, (left.get(key) ?? 0n) + quantity);
  };
  // A carry isn't among `utxos`, and holds ADA alone (core's `carried`).
  for (const i of parts.flatMap((p) => p.inputs)) {
    for (const a of at.get(`${i.txHash}#${i.txIndex}`)?.asset_list ?? []) {
      add(a.policy_id, a.asset_name, BigInt(a.quantity));
    }
  }
  for (const token of parts.flatMap((p) => p.payments.flatMap((q) => q.tokens))) {
    add(token.policyId, token.assetName, -BigInt(token.quantity));
  }
  return [...left.values()].filter((q) => q > 0n).length;
}

/** Where part `i` of a payment is kept: the first where a single transaction is, so Send finds it as ever. */
export const partKey = (key: string, i: number) => (i === 0 ? key : `${key}.${i}`);

/**
 * Keeps each part of a payment for Send, under its own key (`partKey`), the first with every part's hash; and forgets
 * the parts an earlier review kept past these. One part is kept as a single transaction always was.
 */
export async function keepParts(deps: ScriptSpendDeps, key: string, parts: Array<Omit<Kept, "builtAt" | "account">>): Promise<void> {
  const hashes = parts.map((p) => p.txHash);
  for (const [i, part] of parts.entries()) {
    await keep(deps, partKey(key, i), i === 0 && parts.length > 1 ? { ...part, partHashes: hashes } : part);
  }
  await deps.wallet.withKeys(async () => {
    for (let i = Math.max(1, parts.length); i < MAX_PARTS; i++) await deps.session.remove(partKey(key, i));
  });
}

/**
 * Refuses, as a stale review, a kept transaction that spends what this wallet
 * has spent since it was built (spent.ts: what it submitted lately, kept
 * until a refusal takes it back). The build leaves out what was spent then,
 * so one here went out after the review. Asks nobody anything.
 *
 * Unless what spent it is this very transaction: another Send of the same
 * review (a second page, or a submit put back as it was after the first went)
 * holds its inputs as spent from the moment it's written ahead, and a stale
 * review's "Refresh and review again" would build a second payment beside it.
 * That one is refused as sent already (pending.ts `refuseSent`, cross-area
 * review of the blind test's fix round), as a missing review is.
 */
async function refuseSpentSince(
  deps: ScriptSpendDeps,
  network: NetworkName,
  txHash: string,
  txCbor: string,
): Promise<void> {
  const inputs = txInputs(Uint8Array.from(txCbor.match(/../g) ?? [], (h) => Number.parseInt(h, 16)));
  const spent = await deps.wallet.withKeys(() => spentSet(deps.session, deps.now()));
  if (!inputs.some((o) => spent.has(o))) return;
  await refuseSent(deps, network, txHash);
  throw new StaleReviewError(t("worker.spend.spentSince"));
}

/**
 * Refuses a kept transaction that spends what a chain being sent will spend
 * (spent.ts reservations: a session's return through Lovejoin, whose last
 * transaction merges into its funding's change, a mix from the public
 * account, or a payment's parts still to go): readContract leaves those out,
 * but only of what's built after the chain started.
 */
async function refuseReserved(
  deps: ScriptSpendDeps,
  network: NetworkName,
  txCbor: string,
  what: SpendWhat,
  except?: string,
): Promise<void> {
  const inputs = new Set(txInputs(Uint8Array.from(txCbor.match(/../g) ?? [], (h) => Number.parseInt(h, 16))));
  const holding = (await sendingChains(deps, network, except)).filter(([, r]) => r.inputs.some((o) => inputs.has(o)));
  if (!holding.length) return;
  // Held by a payment's parts still to go alone, it's said as that, not as a chain through Lovejoin.
  const parts = holding.every(([chain]) => chain.startsWith(PARTS_RESERVED));
  throw new StaleReviewError(t((parts ? PARTS_CONFLICT : CHAIN_CONFLICT)[what]));
}
