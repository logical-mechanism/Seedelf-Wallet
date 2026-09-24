// Create a seedelf: the stealth mint (the CLI's `util mint`), paid from the
// Seedelf balance and never the Cardano account (privacy rule 5). Built by
// seedelf-core `build::mint` through WebAssembly.
//
// build   reads the contract and the protocol parameters. WebAssembly picks
//         the UTxOs that pay, proves them under a new one-time key and drafts
//         the transaction; Ogmios (through Koios) measures its scripts; then
//         WebAssembly finishes it with the real budgets and fee. The unsigned
//         transaction and its one-time key's seed wait in session storage
//         until Send. Nothing has gone to giveme.my yet.
// submit  giveme.my witnesses the collateral; WebAssembly checks that
//         signature and adds it with the one-time key's; Koios submits
//         exactly that transaction, and the pending watch takes over.
//
// The one-time key is re-derived inside WebAssembly from the Seedelf key and
// the seed, so a worker restarted between review and Send still signs, and
// the key never reaches JavaScript.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { MintSummary, PendingTx } from "../shared/rpc";
import { CONTRACT_V1, ownedUtxos, type ContractConfig } from "./balances";
import { seedelfTokenOf } from "./chain";
import type { Collateral } from "./collateral";
import type { Koios, KoiosUtxo } from "./koios";
import { SESSION_PENDING } from "./pending";
import type { Area } from "./storage";
import type { Wallet } from "./wallet";

/** chrome.storage.session: the mint built last, until it's sent or replaced. */
export const SESSION_MINT = "seedelf.mint.built";

/** A built mint is only sent within this long; after that, build again. */
const BUILT_TTL_MS = 10 * 60_000;

interface Built extends MintSummary {
  /** Unsigned. */
  txCbor: string;
  /** The one-time key's seed. */
  seed: string;
  builtAt: number;
}

interface MintRequest {
  network: NetworkName;
  params: Record<string, unknown>;
  utxos: KoiosUtxo[];
  label: string;
}

interface MintDraft {
  seed: string;
  draftCbor: string;
}

type MintResult = Omit<MintSummary, "network" | "label" | "inputs"> & {
  txCbor: string;
  seed: string;
  inputs: unknown[];
};

export interface MintDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  session: Area;
  koios: (network: NetworkName) => Koios;
  collateral: (network: NetworkName) => Collateral;
  now: () => number;
  contract?: ContractConfig;
}

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

export class MintService {
  constructor(private readonly deps: MintDeps) {}

  async build(network: NetworkName, label: string): Promise<MintSummary> {
    const { wasm, wallet, session, now, contract = CONTRACT_V1 } = this.deps;
    const koios = this.deps.koios(network);

    // Fresh chain state, read outside the wallet's queue.
    const [contractUtxos, params] = await Promise.all([
      koios.credentialUtxos([contract.walletContractHash]),
      koios.epochParams(),
    ]);
    const request: MintRequest = await wallet.withKeys((keys) => ({
      network,
      params,
      label,
      // What the Seedelf balance counts: owned UTxOs that don't hold a seedelf.
      utxos: ownedUtxos(wasm, keys, contractUtxos).filter((u) => !seedelfTokenOf(u, contract.seedelfPolicyId)),
    }));
    if (request.utxos.length === 0) {
      throw new Error("Your Seedelf balance is empty. Move some ADA in first; the seedelf is paid from there.");
    }

    const draft = await wallet.withKeys(
      (keys) => JSON.parse(wasm.draftMint(keys.seedelf, JSON.stringify(request))) as MintDraft,
    );
    const evaluation = await koios.evaluate(draft.draftCbor);

    return wallet.withKeys(async (keys) => {
      const finished = JSON.parse(
        wasm.finishMint(keys.seedelf, JSON.stringify({ ...request, seed: draft.seed, evaluation })),
      ) as MintResult;
      const { txCbor, seed, inputs, ...rest } = finished;
      const summary: MintSummary = { ...rest, network, label, inputs: inputs.length };
      await session.set(SESSION_MINT, { ...summary, txCbor, seed, builtAt: now() } satisfies Built);
      return summary;
    });
  }

  async submit(network: NetworkName, txHash: string): Promise<PendingTx> {
    const { wasm, wallet, session, now } = this.deps;
    const built = await wallet.withKeys(() => session.get<Built>(SESSION_MINT));
    if (!built || built.txHash !== txHash || built.network !== network) {
      throw new Error("That seedelf isn't ready to send. Review it again.");
    }
    if (now() - built.builtAt > BUILT_TTL_MS) {
      throw new Error("That seedelf was built more than 10 minutes ago. Review it again.");
    }

    const collateral = await this.deps.collateral(network).witness(built.txCbor);
    const signed = await wallet.withKeys(
      (keys) =>
        JSON.parse(
          wasm.signScriptSpend(
            keys.seedelf,
            JSON.stringify({ txCbor: built.txCbor, seed: built.seed, collateral }),
          ),
        ) as { txCbor: string; txHash: string },
    );
    if (signed.txHash !== txHash) throw new Error("Signing changed the transaction, so it wasn't sent.");
    const submitted = await this.deps.koios(network).submitTx(hexBytes(signed.txCbor));
    if (submitted !== txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);

    const pending: PendingTx = { kind: "mint", network, txHash, submittedAt: now(), confirmations: null };
    await wallet.withKeys(async () => {
      await session.remove(SESSION_MINT);
      await session.set(SESSION_PENDING, pending);
    });
    return pending;
  }
}
