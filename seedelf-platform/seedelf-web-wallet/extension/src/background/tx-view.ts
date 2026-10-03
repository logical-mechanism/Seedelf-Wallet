// The transaction view: the transaction the wallet is about to sign or send,
// decoded from its own bytes (wasm/src/decode.rs `decodeTx`).
//
// It is the cheapest handler in the worker: no Koios request, no storage write,
// nothing kept. It finds the bytes the review is already about and hands them
// to WebAssembly, which reads them and nothing else — so opening the view
// tells nobody anything, and it can't be wrong about the account because it
// never sees one.
//
// The bytes are never in the UI's hands until it asks for them. Every flow
// parks its built transaction in session storage under its own key, and
// `script-spend.ts` strips the CBOR out of the summary the screen gets; a
// site's are in the connector's own queue (dapp.ts). So the view is asked by
// transaction hash, which every review already has, and the worker looks it up
// where it lives. Nothing else changes: the signed bytes still never live in a
// component, so opening or closing the view can't strand a signed transaction.

import type * as Wasm from "@seedelf/wasm";

import { t } from "../i18n";
import type { NetworkName } from "../networks";
import type { TxDetail, TxView } from "../shared/rpc";
import { SESSION_MINT } from "./mint";
import { SESSION_BUILT } from "./move-in";
import { SESSION_LOVEJOIN_PUBLIC } from "./lovejoin";
import { SESSION_COLLATERAL, SESSION_SEND } from "./send";
import {
  SESSION_BACK,
  SESSION_CLAIM,
  SESSION_MIX_OUT,
  SESSION_OUT,
  SESSION_SITE_OUT,
  SESSION_TOP_UP,
  SESSION_TX,
} from "./sessions";
import { SESSION_STAKE } from "./staking";
import { SESSION_TRANSFER } from "./transfer";
import { SESSION_REMOVE, SESSION_WITHDRAW } from "./withdraw";
import type { Area } from "./storage";
import type { Wallet } from "./wallet";

export interface TxViewDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  session: Area;
}

/**
 * Every session key a built transaction waits for Send under. Each holds a
 * record with `txCbor` and `txHash` — or, for Bring everything back and a mix
 * from the public account, several of them under one key — so they're all
 * looked through the same way (`cborOf`).
 */
export const BUILT_KEYS: readonly string[] = [
  SESSION_BUILT,
  SESSION_MINT,
  SESSION_TRANSFER,
  SESSION_WITHDRAW,
  SESSION_REMOVE,
  SESSION_SEND,
  SESSION_COLLATERAL,
  SESSION_STAKE,
  SESSION_OUT,
  SESSION_SITE_OUT,
  SESSION_TOP_UP,
  SESSION_TX,
  SESSION_BACK,
  SESSION_CLAIM,
  SESSION_MIX_OUT,
  SESSION_LOVEJOIN_PUBLIC,
];

/** What the view says when it isn't holding the transaction asked for. */
export const NOT_HELD = () => t("worker.txView.notHeld");

/**
 * The transaction `txHash`, decoded. It looks in what the wallet built and is
 * holding for Send, then in what a site is waiting for a signature on
 * (`waiting`, the connector's queue).
 */
export async function txView(
  deps: TxViewDeps,
  network: NetworkName,
  txHash: string,
  waiting?: (txHash: string) => string | undefined,
): Promise<TxView> {
  const { wasm, wallet, session } = deps;
  const wanted = txHash.trim().toLowerCase();
  // The kept records are behind the keys, so a locked wallet reads none of
  // them. A site's own bytes aren't the wallet's secret, so a request waiting
  // in the connector's window can still be read while it's locked.
  const kept = await wallet
    .withKeys(async () => {
      for (const key of BUILT_KEYS) {
        const found = cborOf(await session.get<unknown>(key), wanted, network);
        if (found) return found;
      }
      return undefined;
    })
    .catch((e: unknown) => {
      if (waiting?.(wanted) === undefined) throw e;
      return undefined;
    });
  const cbor = kept ?? waiting?.(wanted);
  if (!cbor) throw new Error(NOT_HELD());
  const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
  return { detail: JSON.parse(wasm.decodeTx(net, cbor)) as TxDetail, cbor };
}

/**
 * The CBOR of the transaction with this hash somewhere in a kept record: the
 * bytes as they would go out, so one a submit went unanswered on shows what
 * was signed and will be sent again (`sentCbor`), not what was built.
 *
 * It walks the record rather than knowing each key's shape: a return keeps its
 * chain's transactions inside it, Bring everything back keeps a list of them,
 * and a key whose shape changes later needs nothing here.
 */
function cborOf(kept: unknown, txHash: string, network: NetworkName, depth = 0): string | undefined {
  // A kept record is a handful of levels deep; this stops a cycle dead.
  if (depth > 8 || !kept || typeof kept !== "object") return undefined;
  if (Array.isArray(kept)) {
    for (const item of kept) {
      const found = cborOf(item, txHash, network, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = kept as Record<string, unknown>;
  const hash = typeof record.txHash === "string" ? record.txHash.toLowerCase() : undefined;
  const cbor = typeof record.sentCbor === "string" ? record.sentCbor : record.txCbor;
  // A record naming another network was built there: its Send refuses it too.
  const here = record.network === undefined || record.network === network;
  if (hash === txHash && typeof cbor === "string" && here) return cbor;
  for (const value of Object.values(record)) {
    const found = cborOf(value, txHash, network, depth + 1);
    if (found) return found;
  }
  return undefined;
}
