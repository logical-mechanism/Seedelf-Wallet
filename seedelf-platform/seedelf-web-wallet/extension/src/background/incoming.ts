// What the wallet's own transactions pay back to it before the chain shows
// them (chunk 23's second review, HM-1, HM-2). A payment spends whole UTxOs and
// gets its change back in a new one, and Koios lists neither until the
// transaction is in a block, while the balance leaves out what the wallet spent
// at once (spent.ts). So 1 ₳ sent from 10,408 ₳ read as 69 ₳ for a while, the
// tokens that came back as change vanished, and a Make private showed no money
// on its way in.
//
// The wallet built those transactions, and keeps them whole for 20 minutes
// (sent-txs.ts), so it knows their outputs: one paying one of the account's own
// payment keys is on its way to the public account, one paying the wallet
// contract under the user's own register (and holding no Seedelf) to the
// private balance, until a reading lists it. Read from what the device keeps:
// nothing is asked of Koios.
//
// Not counted: an output of a transaction whose inputs aren't all still spent
// (it never went out: pending.ts freed them), one another of the wallet's
// transactions spends already or one a Lovejoin chain will spend (a mix's
// change, which the next mix takes: it never comes back), and one a reading
// already lists. Nor what would be counted twice: a reading made before the
// transaction was sent still counts what it spent, so its outputs are added
// to a side only when that side lost nothing to it (a Make private's deposit,
// a Make public to the account) or the reading came after it.
//
// The fix round of chunk 23's second review closed three ways to count twice.
// Two sent transactions spending the same UTxO (a payment let go unseen, or a
// session's step gone unseen, and the one built again on what it spent) can't
// both land, and nothing says which will: neither counts while both are kept.
// One that can't land (refused, or past its slot) is no longer kept as sent,
// so the one built after it counts alone. The account's side is told by what
// the reading lists alone: one that began before a send and ended after it
// still lists, and counts, what it spent, so "after" is never enough there.
// And the private side, told by time, counts from when the reading began, not
// when it ended; with no view of the contract kept to say what's listed
// already, it counts nothing.

import type * as Wasm from "@seedelf/wasm";

import type { Locked } from "../shared/rpc";
import type { ContractConfig } from "./balances";
import { txInputs } from "./cbor";
import { seedelfTokenOf, sumValue } from "./chain";
import type { KoiosUtxo } from "./koios";
import type { SentTx } from "./sent-txs";
import { outpoint } from "./spent";
import { isTrap } from "./wasm";

/** What each side has on its way; a side with nothing isn't there. */
export interface Incoming {
  seedelf?: Locked;
  cardano?: Locked;
}

export interface IncomingFrom {
  /**
   * When the reading began (ms since the epoch), before it took what the wallet had spent to leave out (balances.ts
   * `spentAsOf`): one that began after a transaction was sent left its inputs out. Only the private side reads it.
   */
  startedAt: number;
  /**
   * The outpoints the reading lists on the public account's side (kept with it, so of the same moment). None kept:
   * nothing counts on that side.
   */
  account: ReadonlySet<string> | undefined;
  /** The outpoints the last read of the contract lists; none kept, nothing private is counted. */
  owned: ReadonlySet<string> | undefined;
  /** Every outpoint the wallet (or a site through it) has spent lately. */
  spent: ReadonlySet<string>;
  /** What the Lovejoin chains will spend. */
  reserved: ReadonlySet<string>;
  /** The account's payment key hashes (hex), as the last reading found them. */
  keys: ReadonlySet<string>;
  contract: ContractConfig;
  /** Which of these contract outputs carry the user's own register (balances.ts `ownedUtxos`). */
  ours: (utxos: KoiosUtxo[]) => KoiosUtxo[];
  /** Each token's decimals (`policy.asset`), as Koios gave them where the reading lists it: a transaction holds none. */
  decimals?: ReadonlyMap<string, number>;
}

/** What `sent` pays back to each side that the reading doesn't show yet. */
export function incomingOf(wasm: typeof Wasm, sent: SentTx[], from: IncomingFrom): Incoming {
  const cardano: KoiosUtxo[] = [];
  const contract: KoiosUtxo[] = [];
  const { account, owned } = from;
  const spending = sent.map((s) => ({ s, inputs: inputsOf(s.txCbor) }));
  // How many of the kept transactions spend each UTxO: one spent by two, only one of them can land.
  const spenders = new Map<string, number>();
  for (const { inputs } of spending) for (const o of new Set(inputs)) spenders.set(o, (spenders.get(o) ?? 0) + 1);
  for (const { s, inputs } of spending) {
    // Freed: it never went out.
    if (!inputs.length || !inputs.every((o) => from.spent.has(o))) continue;
    // Another spends what it spends: which of the two lands isn't known, so neither counts.
    if (inputs.some((o) => spenders.get(o)! > 1)) continue;
    // A reading that lists any of what it spent from the account still counts that, whenever it was made; the
    // private side's spends are known only by time, from when the reading began.
    const fromAccount = account ? inputs.filter((o) => account.has(o)).length : 0;
    const toAccount = !!account && fromAccount === 0;
    const toPrivate = !!owned && (from.startedAt > s.sentAt || fromAccount === inputs.length);
    for (const u of outputsOf(wasm, s.txCbor)) {
      const o = outpoint(u);
      if (account?.has(o) || owned?.has(o) || from.spent.has(o) || from.reserved.has(o)) continue;
      const payment = paymentOf(wasm, u.address);
      if (!payment) continue;
      if (!payment.script) {
        if (toAccount && from.keys.has(payment.hash)) cardano.push(u);
      } else if (toPrivate && payment.hash === from.contract.walletContractHash && !seedelfTokenOf(u, from.contract.seedelfPolicyId)) {
        contract.push(u);
      }
    }
  }
  const seedelf = contract.length ? from.ours(contract) : [];
  const sum = (utxos: KoiosUtxo[]) => summed(utxos, from.decimals);
  return { ...(seedelf.length ? { seedelf: sum(seedelf) } : {}), ...(cardano.length ? { cardano: sum(cardano) } : {}) };
}

function summed(utxos: KoiosUtxo[], decimals?: ReadonlyMap<string, number>): Locked {
  const { lovelace, tokens } = sumValue(utxos);
  const known = tokens.map((x) => ({ ...x, decimals: decimals?.get(`${x.policyId}.${x.assetName}`) ?? x.decimals }));
  return { lovelace: lovelace.toString(), tokens: known, utxos: utxos.length };
}

/** A transaction's inputs; none if it can't be read. */
function inputsOf(txCbor: string): string[] {
  try {
    return txInputs(Uint8Array.from(txCbor.match(/../g) ?? [], (h) => Number.parseInt(h, 16)));
  } catch {
    return [];
  }
}

/**
 * An address's payment credential (CIP-19's header and the 28 bytes after it),
 * a key's or a script's; none for a reward or Byron address, or one that can't
 * be read.
 */
function paymentOf(wasm: typeof Wasm, address: string): { hash: string; script: boolean } | undefined {
  let hex: string;
  try {
    hex = wasm.cip30Address(address);
  } catch (e) {
    if (isTrap(e)) throw e;
    return undefined;
  }
  const kind = Number.parseInt(hex.slice(0, 1), 16);
  const hash = hex.slice(2, 58);
  if (!(kind < 8) || hash.length !== 56) return undefined;
  // Odd header types (1, 3, 5, 7) pay a script.
  return { hash, script: kind % 2 === 1 };
}

/** A transaction's output, as WebAssembly's `ogmiosUtxos` gives it (Ogmios v6), as dapp.ts reads it too. */
interface OgmiosUtxo {
  transaction: { id: string };
  index: number;
  address: string;
  /** `ada.lovelace`, and each policy's tokens by name. */
  value: Record<string, Record<string, number | string>>;
  datum?: string;
}

/** A transaction's outputs, as Koios lists UTxOs; none if it can't be read. */
function outputsOf(wasm: typeof Wasm, txCbor: string): KoiosUtxo[] {
  let rows: OgmiosUtxo[];
  try {
    // Amounts past 2^53 would lose digits as JSON numbers: read as text.
    rows = JSON.parse(wasm.ogmiosUtxos(txCbor).replace(/:(\d{16,})([,}])/g, ':"$1"$2')) as OgmiosUtxo[];
  } catch (e) {
    if (isTrap(e)) throw e;
    return [];
  }
  return rows.map(({ transaction, index, address, value, datum }) => ({
    tx_hash: transaction.id,
    tx_index: index,
    address,
    value: String(value.ada?.lovelace ?? 0),
    stake_address: null,
    payment_cred: null,
    block_height: null,
    inline_datum: datum ? { bytes: datum, value: null } : null,
    asset_list: Object.entries(value)
      .filter(([policy]) => policy !== "ada")
      .flatMap(([policy, names]) =>
        Object.entries(names).map(([name, quantity]) => ({
          policy_id: policy,
          asset_name: name,
          quantity: String(quantity),
          decimals: 0,
          fingerprint: "",
        })),
      ),
  }));
}
