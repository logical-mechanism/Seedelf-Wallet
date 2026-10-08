// The transaction view: the transaction the wallet is about to sign or send,
// or one of a chain through Lovejoin it's still sending, decoded from its own
// bytes (wasm/src/decode.rs `decodeTx`).
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
//
// It also says which outputs pay the user (blind test §9.9, T18): the change
// read only as "a key that stakes", so testers told their own outputs by an
// address's last letters. That is worked out from what the device knows, the
// wallet's own keys and its records, and asks nobody anything either: an
// output under one of the public accounts' payment keys (the first 20 of each
// chain, and those the last reading found, as balances count them), one under
// the user's own register in the wallet contract, or a private session's
// one-time account. A stake key alone doesn't make an output the user's: its
// payment key is someone else's, who can spend it.

import type * as Wasm from "@seedelf/wasm";

import { t } from "../i18n";
import type { NetworkName } from "../networks";
import type { TxAddress, TxDetail, TxOutput, TxRegister, TxView } from "../shared/rpc";
import { SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses } from "./activity";
import { CONTRACT_V1 } from "./balances";
import { GAP_LIMIT } from "./chain";
import { SESSION_MINT } from "./mint";
import { SESSION_BUILT } from "./move-in";
import { SESSION_LOVEJOIN_PUBLIC, SESSION_LOVEJOIN_SENDING } from "./lovejoin";
import { SESSION_COLLATERAL, SESSION_SEND } from "./send";
import {
  SESSION_BACK,
  SESSION_CHAIN_PREFIX,
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
import type { Keys, Wallet } from "./wallet";
import { isTrap } from "./wasm";

export interface TxViewDeps {
  wasm: typeof Wasm;
  wallet: Wallet;
  session: Area;
  /** The public accounts the wallet knows of, by index (accounts.ts): an output to any of them is the user's. */
  knownAccounts?: () => Promise<number[]>;
  /** The private sessions used on a network, by index (sessions.ts `indices`): so is one to their one-time accounts. */
  sessionIndices?: (network: NetworkName) => Promise<number[]>;
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

/**
 * Where a chain through Lovejoin waits while it's being sent, on `network`:
 * the public account's mix, and each session's return or mix (sessions.ts
 * `pendingKey`). Its transactions move there from the key it was kept for
 * Send under, and the Lovejoin page's row for it opens each (chunk 17's
 * handoff note: a chain in flight was invisible to the view).
 */
async function chainKeys(deps: TxViewDeps, network: NetworkName): Promise<string[]> {
  const indices = (await deps.sessionIndices?.(network).catch(() => [])) ?? [];
  return [SESSION_LOVEJOIN_SENDING + network, ...indices.map((i) => `${SESSION_CHAIN_PREFIX}${network}.${i}`)];
}

/** What the view says when it isn't holding the transaction asked for. */
export const NOT_HELD = () => t("worker.txView.notHeld");

/**
 * The transaction `txHash`, decoded. It looks in what the wallet built and is
 * holding for Send, and in a chain through Lovejoin being sent, then in what
 * a site is waiting for a signature on (`waiting`, the connector's queue).
 */
export async function txView(
  deps: TxViewDeps,
  network: NetworkName,
  txHash: string,
  waiting?: (txHash: string) => string | undefined,
): Promise<TxView> {
  const { wasm, wallet, session } = deps;
  const wanted = txHash.trim().toLowerCase();
  const chains = await chainKeys(deps, network);
  // The kept records are behind the keys, so a locked wallet reads none of
  // them. A site's own bytes aren't the wallet's secret, so a request waiting
  // in the connector's window can still be read while it's locked.
  const kept = await wallet
    .withKeys(async () => {
      for (const key of [...BUILT_KEYS, ...chains]) {
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
  const detail = JSON.parse(wasm.decodeTx(net, cbor)) as TxDetail;
  // Never in the way of the view: locked, or with nothing known, nothing is marked.
  await markYours(deps, network, detail).catch((e: unknown) => {
    if (isTrap(e)) throw e;
  });
  return { detail, cbor };
}

/** An address's payment key hash (hex), when a key and not a script pays it: none for a reward or Byron address. */
function paymentKey(address: TxAddress): string | undefined {
  if (address.payment !== "key" || !["base", "enterprise", "pointer"].includes(address.kind)) return undefined;
  const hash = address.hex.slice(2, 58);
  return hash.length === 56 ? hash.toLowerCase() : undefined;
}

/** An account's payment key hashes as balances count them: the first GAP_LIMIT of each chain, and `found`. */
function accountKeys(cardano: Wasm.CardanoAccount, found: readonly string[] = []): Set<string> {
  const keys = new Set(found.map((k) => k.toLowerCase()));
  for (let i = 0; i < GAP_LIMIT; i++) {
    keys.add(cardano.paymentKeyHash(0, i));
    keys.add(cardano.paymentKeyHash(1, i));
  }
  return keys;
}

/** Whether `register` is the user's: the Seedelf key's discrete log of it (balances.ts `ownedUtxos`). */
function ownRegister(wasm: typeof Wasm, keys: Keys, register: TxRegister): boolean {
  const r = new wasm.Register(register.generator, register.publicValue);
  try {
    return keys.seedelf.isOwned(r);
  } catch {
    // Points that don't decode, or aren't in the prime-order subgroup, can't be anyone's to spend.
    return false;
  } finally {
    r.free();
  }
}

/**
 * Marks each output of `d` (its collateral's return too) that pays the user,
 * with whose: the active account and the private balance in one turn of the
 * wallet's lock, then any other account the wallet knows, each in its own.
 */
async function markYours(deps: TxViewDeps, network: NetworkName, d: TxDetail): Promise<void> {
  const { wasm, wallet, session } = deps;
  const outputs: TxOutput[] = [...d.outputs, ...(d.collateralReturn ? [d.collateralReturn] : [])];
  if (!outputs.length) return;
  const [indices, known] = await Promise.all([
    deps.sessionIndices?.(network).catch(() => []) ?? [],
    deps.knownAccounts?.().catch(() => []) ?? [],
  ]);
  const active = await wallet.withKeys(async (keys) => {
    const found = await session.get<AccountAddresses>(SESSION_ACCOUNT_ADDRESSES_PREFIX + network);
    const account = accountKeys(keys.cardano, found?.keys);
    const sessions = new Map(indices.map((index) => [keys.oneTime.keyHash(index).toLowerCase(), index]));
    for (const o of outputs) {
      const key = paymentKey(o.address);
      if (key && account.has(key)) o.yours = { kind: "account", account: keys.account };
      else if (key && sessions.has(key)) o.yours = { kind: "session", index: sessions.get(key)! };
      else if (o.address.seedelf && o.register?.payable && ownRegister(wasm, keys, o.register)) {
        const seedelf = o.assets.some((a) => a.policyId === CONTRACT_V1.seedelfPolicyId);
        o.yours = { kind: seedelf ? "seedelf" : "private" };
      }
    }
    return keys.account;
  });
  for (const index of known) {
    const rest = outputs.filter((o) => !o.yours && paymentKey(o.address));
    if (!rest.length) return;
    if (index === active) continue;
    const theirs = await wallet.withAccount(index, (keys) => accountKeys(keys.cardano));
    for (const o of rest) if (theirs.has(paymentKey(o.address)!)) o.yours = { kind: "account", account: index };
  }
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
