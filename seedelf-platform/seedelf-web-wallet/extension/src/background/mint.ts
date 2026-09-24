// Create a seedelf. A mint links the seedelf to whatever pays for it
// (privacy.md, Known links), so there are two ways to pay:
//
// account  The Cardano account pays (the CLI's `create`, `build::account_mint`).
//          The default: minted before any move-in, the seedelf is linked to
//          the account openly, and money moved in afterwards looks like
//          paying anyone's seedelf. Its own UTxO is the collateral, and
//          WebAssembly signs it with the account's keys at review, like a
//          move-in; Send only submits.
// seedelf  A stealth mint from the Seedelf balance (the CLI's `util mint`,
//          `build::mint`). It only hides the payer when that balance came
//          from other people's Seedelf payments.
//
// build   reads the chain and the protocol parameters; WebAssembly picks the
//         UTxOs and drafts; Ogmios (through Koios) measures the scripts; then
//         WebAssembly finishes it. The transaction waits in session storage
//         until Send: signed for the account, unsigned for a stealth mint,
//         with its one-time key's seed.
// submit  for a stealth mint, giveme.my first witnesses the collateral, and
//         WebAssembly checks that signature and adds it with the one-time
//         key's (re-derived from the seed, so a restarted worker still signs).
//         Then Koios submits exactly that transaction, and the pending watch
//         takes over.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { MintSource, MintSummary, PendingTx } from "../shared/rpc";
import { CONTRACT_V1, ownedUtxos, pathedUtxos, type ContractConfig } from "./balances";
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
  /** Signed when the account pays; unsigned for a stealth mint. */
  txCbor: string;
  /** A stealth mint's one-time key's seed. */
  seed?: string;
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

type MintResult = Omit<MintSummary, "network" | "label" | "inputs" | "from"> & {
  txCbor: string;
  seed: string;
  inputs: unknown[];
};

type AccountMintResult = Omit<MintSummary, "network" | "label" | "inputs" | "from"> & {
  txCbor: string;
  inputs: unknown[];
  collateral: unknown;
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

  build(network: NetworkName, label: string, from: MintSource): Promise<MintSummary> {
    return from === "account" ? this.buildFromAccount(network, label) : this.buildStealth(network, label);
  }

  private async buildFromAccount(network: NetworkName, label: string): Promise<MintSummary> {
    const { wasm, wallet, session, now } = this.deps;
    const koios = this.deps.koios(network);
    const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;

    // Fresh chain state, read outside the wallet's queue.
    const stake = await wallet.withKeys(({ cardano }) => cardano.stakeAddress(net));
    const [used, utxos, params] = await Promise.all([
      koios.accountAddresses(stake),
      koios.accountUtxos(stake),
      koios.epochParams(),
    ]);
    const request = await wallet.withKeys((keys) => ({
      network,
      params,
      label,
      utxos: pathedUtxos(keys, net, new Set(used), utxos),
    }));
    if (request.utxos.length === 0) {
      throw new Error("Your Cardano account is empty. Fund it first; the seedelf is paid from there.");
    }

    const draft = await wallet.withKeys(
      (keys) => JSON.parse(wasm.draftAccountMint(keys.cardano, keys.seedelf, JSON.stringify(request))) as MintDraft,
    );
    const evaluation = await koios.evaluate(draft.draftCbor);

    return wallet.withKeys(async (keys) => {
      const finished = JSON.parse(
        wasm.finishAccountMint(keys.cardano, keys.seedelf, JSON.stringify({ ...request, evaluation })),
      ) as AccountMintResult;
      const { txCbor, inputs, collateral: _collateral, ...rest } = finished;
      const summary: MintSummary = { ...rest, network, label, from: "account", inputs: inputs.length };
      await session.set(SESSION_MINT, { ...summary, txCbor, builtAt: now() } satisfies Built);
      return summary;
    });
  }

  private async buildStealth(network: NetworkName, label: string): Promise<MintSummary> {
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
      const summary: MintSummary = { ...rest, network, label, from: "seedelf", inputs: inputs.length };
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

    // The account signed at review; a stealth mint needs giveme.my's witness and the one-time key's.
    let txCbor = built.txCbor;
    if (built.from !== "account") {
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
      txCbor = signed.txCbor;
    }
    const submitted = await this.deps.koios(network).submitTx(hexBytes(txCbor));
    if (submitted !== txHash) throw new Error(`Koios answered with another transaction id (${submitted}).`);

    const pending: PendingTx = { kind: "mint", network, txHash, submittedAt: now(), confirmations: null };
    await wallet.withKeys(async () => {
      await session.remove(SESSION_MINT);
      await session.set(SESSION_PENDING, pending);
    });
    return pending;
  }
}
