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
//        Send sends those very bytes again.
//
// A transaction WebAssembly signed at review (an account-paid mint, and the
// public account's send and staking) is kept without a seed, and Send only
// submits it.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import { merged, UNKNOWN, type HistoryClass } from "../shared/histories";
import type { PendingTx } from "../shared/rpc";
import { CONTRACT_V1, type ContractConfig } from "./balances";
import { seedelfTokenOf } from "./chain";
import type { ActivityService } from "./activity";
import type { CoinControlService } from "./coin-control";
import { CollateralRefusedError, type Collateral } from "./collateral";
import { forgetContractView, readContractView, type ContractView } from "./contract-scan";
import type { Koios, KoiosUtxo } from "./koios";
import type { PreferencesService } from "./preferences";
import { settleMaybeSent, submitWatched } from "./pending";
import type { PrivateStore } from "./private-store";
import type { Area } from "./storage";
import { outpoint, reservedSet } from "./spent";
import type { Keys, Wallet } from "./wallet";

/** A built transaction is only sent within this long; after that, build again. */
const BUILT_TTL_MS = 10 * 60_000;

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
  store: PrivateStore;
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
 * The histories a spend's `inputs` have, each once, for its review: the
 * classes WebAssembly says it spent together (`mixed`), or the one they
 * share. None when the wallet knows nothing of them.
 */
export function spentHistories(classes: Classes, inputs: OutRef[], mixed: string[] = []): HistoryClass[] | undefined {
  const all = inputs.map((i) => classOf(classes, i));
  const spent = mixed.length ? mixed.map((id) => all.find((c) => c.id === id) ?? UNKNOWN) : all.slice(0, 1);
  return spent.some((c) => c.origin !== "unknown") ? spent : undefined;
}

/**
 * This wallet's view of the contract (contract-scan.ts), what a Seedelf
 * spend may pay with (`utxos`: owned, holding no seedelf, not locked, and
 * not `returning`), and the protocol parameters. `returning`: what a return
 * through Lovejoin being sent will spend, left out. A session's return ends
 * merged into its funding's change, many blocks after its chain starts, so
 * no other spend of the private balance takes that change meanwhile (final
 * review lovejoin-3). The view itself is left as it is. `classes`: where
 * each of `utxos` came from, from the sealed history alone (Koios is asked
 * nothing), for coin selection.
 */
export async function readContract(
  deps: ScriptSpendDeps,
  network: NetworkName,
): Promise<{
  view: ContractView;
  utxos: KoiosUtxo[];
  params: Record<string, unknown>;
  returning: KoiosUtxo[];
  classes: Classes;
}> {
  const [view, params, reserved] = await Promise.all([
    readContractView(deps, network),
    deps.koios(network).epochParams(),
    deps.wallet.withKeys(() => reservedSet(deps.session, network, { sending: true })),
  ]);
  const all = spendable(deps, view);
  const returning = all.filter((u) => reserved.inputs.has(outpoint(u)));
  const free = all.filter((u) => !reserved.inputs.has(outpoint(u)));
  const utxos = await deps.coins.seedelf(network, free);
  return { view, utxos, params, returning, classes: await classesOf(deps, network, utxos) };
}

/** `readContract`'s `classes`. A history that won't open costs only the keeping apart: selection then picks as the CLI does. */
export async function classesOf(
  deps: Pick<ScriptSpendDeps, "activity">,
  network: NetworkName,
  utxos: KoiosUtxo[],
): Promise<Classes> {
  const found = (await deps.activity?.classes(network, utxos).catch(() => undefined)) ?? new Map<string, HistoryClass>();
  return Object.fromEntries([...found].filter(([, c]) => c.origin !== "unknown"));
}

/**
 * Why a Seedelf spend has nothing to pay with: `utxos` from readContract,
 * `empty` for an empty balance, and `returning` (readContract's) for what a
 * return through Lovejoin being sent holds.
 */
export function nothingToSpend(
  deps: Pick<ScriptSpendDeps, "contract">,
  view: ContractView,
  empty: string,
  returning: KoiosUtxo[] = [],
): Error {
  const all = spendable(deps, view);
  if (!all.length) return new Error(empty);
  if (returning.length === all.length) {
    return new Error(
      "Your private balance waits for a return through Lovejoin that's still being sent: its last transaction adds to what's there, so nothing else spends it meanwhile. Try again once it's all sent.",
    );
  }
  if (returning.length) {
    return new Error(
      "Every UTxO in your private balance is locked, or waits for a return through Lovejoin that's still being sent. Unlock one on its UTxOs screen, or try again once the return is all sent.",
    );
  }
  return new Error("Every UTxO in your private balance is locked. Unlock one on its UTxOs screen first.");
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
  return deps.wallet.withKeys(() => deps.session.set(key, { ...built, builtAt: deps.now() }));
}

/**
 * Sends the transaction kept under `key`, if it's the one reviewed (`txHash`
 * on `network`) and not too old. `what` names it in errors. One Koios didn't
 * answer comes back maybe sent (pending.ts), and stays kept: Send again sends
 * the same bytes, however old, and asks giveme.my nothing.
 */
export async function send(
  deps: ScriptSpendDeps,
  network: NetworkName,
  txHash: string,
  key: string,
  kind: PendingTx["kind"],
  what: string,
): Promise<PendingTx> {
  const { wasm, wallet, session, now } = deps;
  const built = await wallet.withKeys(() => session.get<Kept>(key));
  if (!built || built.txHash !== txHash || built.network !== network) {
    throw new Error(`That ${what} isn't ready to send. Review it again.`);
  }
  const again = built.sentCbor !== undefined;
  if (!again) {
    if (now() - built.builtAt > BUILT_TTL_MS) {
      throw new Error(`That ${what} was built more than 10 minutes ago. Review it again.`);
    }
    await settleMaybeSent(deps, network);
  }

  let txCbor = built.sentCbor ?? built.txCbor;
  if (built.seed !== undefined && !again) {
    let collateral: unknown;
    try {
      collateral = await deps.collateral(network).witness(built.txCbor);
    } catch (e) {
      // giveme.my checks the chain first, so this refusal may be a UTxO the
      // kept view still has as ours: read the contract in full next time, as
      // the "refresh, then review it again" it asks for expects.
      if (e instanceof CollateralRefusedError) await forgetContractView(deps, network);
      throw e;
    }
    const signed = await wallet.withKeys(
      (keys) =>
        JSON.parse(
          wasm.signScriptSpend(keys.seedelf, JSON.stringify({ txCbor: built.txCbor, seed: built.seed, collateral })),
        ) as { txCbor: string; txHash: string },
    );
    if (signed.txHash !== txHash) throw new Error("Signing changed the transaction, so it wasn't sent.");
    txCbor = signed.txCbor;
  }
  const { txCbor: _txCbor, seed: _seed, sentCbor: _sentCbor, builtAt: _builtAt, ...summary } = built;
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
  });
}
