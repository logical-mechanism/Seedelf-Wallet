// Every Seedelf script spend (a stealth mint, a transfer; sweep and remove
// next) is built and sent the same way:
//
// build  reads the wallet contract (contract-scan.ts: in full when due,
//        otherwise only what's new) and the protocol parameters; the caller
//        makes the WebAssembly request from them. WebAssembly drafts
//        it under a new one-time key, Ogmios (through Koios) measures the
//        scripts, and WebAssembly finishes it. The unsigned transaction waits
//        in session storage, with its one-time key's seed, until Send.
// send   giveme.my witnesses the collateral; WebAssembly checks that
//        signature and adds it with the one-time key's, re-derived from the
//        seed, so a restarted worker still signs. Koios submits exactly that
//        transaction, and the pending watch takes over.
//
// A transaction WebAssembly signed at review (an account-paid mint) is kept
// without a seed, and Send only submits it.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { PendingTx } from "../shared/rpc";
import { CONTRACT_V1, type ContractConfig } from "./balances";
import { seedelfTokenOf } from "./chain";
import type { ActivityService } from "./activity";
import type { Collateral } from "./collateral";
import { forgetContractView, readContractView, type ContractView } from "./contract-scan";
import { SpentInputError, type Koios, type KoiosUtxo } from "./koios";
import { SESSION_PENDING } from "./pending";
import { rememberSpent } from "./spent";
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
}

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** This wallet's view of the contract (contract-scan.ts), and the protocol parameters. */
export async function readContract(
  deps: ScriptSpendDeps,
  network: NetworkName,
): Promise<{ view: ContractView; params: Record<string, unknown> }> {
  const [view, params] = await Promise.all([readContractView(deps, network), deps.koios(network).epochParams()]);
  return { view, params };
}

/** What the Seedelf balance counts, and a Seedelf spend may pay with: owned UTxOs that don't hold a seedelf. */
export function spendable(deps: ScriptSpendDeps, view: ContractView): KoiosUtxo[] {
  const { contract = CONTRACT_V1 } = deps;
  return view.owned.filter((u) => !seedelfTokenOf(u, contract.seedelfPolicyId));
}

/**
 * Drafts with WebAssembly, has Ogmios measure the draft, and finishes it.
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
 * on `network`) and not too old. `what` names it in errors.
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
  if (now() - built.builtAt > BUILT_TTL_MS) {
    throw new Error(`That ${what} was built more than 10 minutes ago. Review it again.`);
  }

  let txCbor = built.txCbor;
  if (built.seed !== undefined) {
    const collateral = await deps.collateral(network).witness(built.txCbor);
    const signed = await wallet.withKeys(
      (keys) =>
        JSON.parse(
          wasm.signScriptSpend(keys.seedelf, JSON.stringify({ txCbor: built.txCbor, seed: built.seed, collateral })),
        ) as { txCbor: string; txHash: string },
    );
    if (signed.txHash !== txHash) throw new Error("Signing changed the transaction, so it wasn't sent.");
    txCbor = signed.txCbor;
  }
  const bytes = hexBytes(txCbor);
  let submitted: string;
  try {
    submitted = await deps.koios(network).submitTx(bytes);
  } catch (e) {
    // The kept view had a spent UTxO as ours: read the contract in full next
    // time. (A transaction signed at review spends the account, not the contract.)
    if (e instanceof SpentInputError && built.seed !== undefined) await forgetContractView(deps, network);
    throw e;
  }
  if (submitted !== txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);

  const pending: PendingTx = { kind, network, txHash, submittedAt: now(), confirmations: null };
  await wallet.withKeys(async () => {
    await rememberSpent(session, bytes);
    await session.remove(key);
    await session.set(SESSION_PENDING, pending);
  });
  await deps.activity?.sent(network, pending, built).catch(() => undefined);
  return pending;
}
