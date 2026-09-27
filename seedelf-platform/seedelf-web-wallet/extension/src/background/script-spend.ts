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
import type { Area } from "./storage";
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
}

/**
 * This wallet's view of the contract (contract-scan.ts), what a Seedelf
 * spend may pay with (`utxos`: owned, holding no seedelf, and not locked),
 * and the protocol parameters.
 */
export async function readContract(
  deps: ScriptSpendDeps,
  network: NetworkName,
): Promise<{ view: ContractView; utxos: KoiosUtxo[]; params: Record<string, unknown> }> {
  const [view, params] = await Promise.all([readContractView(deps, network), deps.koios(network).epochParams()]);
  return { view, utxos: await deps.coins.seedelf(network, spendable(deps, view)), params };
}

/** Why a Seedelf spend has nothing to pay with: `utxos` from readContract, `empty` for an empty balance. */
export function nothingToSpend(deps: Pick<ScriptSpendDeps, "contract">, view: ContractView, empty: string): Error {
  return new Error(
    spendable(deps, view).length
      ? "Every UTxO in your private balance is locked. Unlock one on its UTxOs screen first."
      : empty,
  );
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
