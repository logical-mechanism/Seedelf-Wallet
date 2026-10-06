// What the wallet's own transactions pay back to it before the chain shows
// them (chunk 23's second review, HM-1, HM-2). A payment spends whole UTxOs and
// gets its change back in a new one, and Koios lists neither until the
// transaction is in a block, while the balance leaves out what the wallet spent
// at once (spent.ts). So 1 ₳ sent from 10,408 ₳ read as 69 ₳ for a while, the
// tokens that came back as change vanished, and a Make private showed no money
// on its way in.
//
// The wallet built those transactions, and keeps them whole for as long as
// what they spend is held back, two hours (sent-txs.ts), so it knows their
// outputs: one paying one of the account's own
// payment keys is on its way to the public account, one paying the wallet
// contract under the user's own register (and holding no Seedelf) to the
// private balance, until a reading lists it. Read from what the device keeps:
// nothing is asked of Koios.
//
// Not counted: an output of a transaction whose inputs aren't all still spent
// (it never went out: pending.ts freed them), one another of the wallet's
// transactions spends already or one a Lovejoin chain will spend (a mix's
// change, which the next mix takes: it never comes back), and one a reading
// already lists.
//
// A reading is answered less what the wallet has spent since it was made
// (balances.ts), as a reading made now would leave it out, so a transaction
// counts whole whenever the reading was made: what it spent out of the
// balance, what it pays back into it (blind test §9.3). Before, a reading
// made before a send still counted what the send spent, and its outputs
// counted only on a side that lost nothing to it: right after a Make private,
// its 20 ₳ were in both balances at once, and Home didn't read again after a
// send.
//
// Nor is what it withdraws counted twice (blind test §9.1, T08). Koios's
// account_info reports the account's rewards until the transaction is in a
// block, and its change already holds them: 25 ₳ sent from a public account
// with 57.475311 ₳ of rewards read 10,440.31465 ₳ while it waited, against the
// review's 10,382.839339 ₳. So what one takes comes out of the reading's
// rewards, at most what the reading counts, unless the reading has seen it
// land (it lists its change and counts less than was taken): they're in what's
// on its way. When that can't be told, the rewards shown err low, never high.
// The account's own stake key's alone: another account's sends take none of
// it. One that never went out, freed, takes nothing, and the rewards count
// again. They're kept as sent for as long as what they spend is held back,
// two hours (sent-txs.ts), not 20 minutes, after which a payment still
// waiting had its coin out of the balance and its change nowhere.
//
// The fix round of chunk 23's second review closed three ways to count twice.
// Two sent transactions spending the same UTxO (a payment let go unseen, or a
// session's step gone unseen, and the one built again on what it spent) can't
// both land, and nothing says which will: neither counts while both are kept.
// One that can't land (refused, or past its slot) is no longer kept as sent,
// so the one built after it counts alone. And a reading that began before a
// send and ended after it still lists what the send spent: that comes out of
// it now, as anything spent since a reading does, so the send's outputs count
// once. The private side is the kept view of the contract less what's spent;
// with no view kept to say what's listed already, it counts nothing.

import type * as Wasm from "@seedelf/wasm";

import type { NetworkName } from "../networks";
import type { ActivityEntry, ActivityStaking, Locked, TxDetail } from "../shared/rpc";
import type { ContractConfig } from "./balances";
import { txInputs, txWithdrawals } from "./cbor";
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

/** The wallet's own sent transactions against a reading. */
export interface InMotion {
  /** What each side has on its way. */
  incoming: Incoming;
  /** The account's rewards they withdraw that the reading still counts (lovelace): they're in what's on its way. */
  withdrawn: bigint;
}

export interface IncomingFrom {
  /**
   * The outpoints the reading lists on the public account's side (kept with it, so of the same moment). None kept:
   * nothing counts on that side.
   */
  account: ReadonlySet<string> | undefined;
  /** The outpoints the kept view of the contract lists; none kept, nothing private is counted. */
  owned: ReadonlySet<string> | undefined;
  /** Every outpoint the wallet (or a site through it) has spent lately. */
  spent: ReadonlySet<string>;
  /** What the Lovejoin chains will spend. */
  reserved: ReadonlySet<string>;
  /** The account's payment key hashes (hex), as the last reading found them. */
  keys: ReadonlySet<string>;
  /** The account's reward address, its bytes in hex: what its sends withdraw from. None known, none is taken out. */
  stake?: string;
  /** The rewards the reading counts (lovelace). */
  rewards: bigint;
  contract: ContractConfig;
  /** Which of these contract outputs carry the user's own register (balances.ts `ownedUtxos`). */
  ours: (utxos: KoiosUtxo[]) => KoiosUtxo[];
  /** Each token's decimals (`policy.asset`), as Koios gave them where the reading lists it: a transaction holds none. */
  decimals?: ReadonlyMap<string, number>;
}

/**
 * The kept transactions that went out as far as the device knows, each with what it spends: everything it spends
 * still held back (it wasn't freed), and nothing another of them spends too (only one of those can land). With
 * `either`, those too: either may land, which is what a guard against a second withdrawal must assume.
 */
export function goingOut(
  sent: SentTx[],
  spent: ReadonlySet<string>,
  { either = false }: { either?: boolean } = {},
): Array<{ s: SentTx; inputs: string[] }> {
  const spending = sent.map((s) => ({ s, inputs: inputsOf(s.txCbor) }));
  // How many of the kept transactions spend each UTxO: one spent by two, only one of them can land.
  const spenders = new Map<string, number>();
  for (const { inputs } of spending) for (const o of new Set(inputs)) spenders.set(o, (spenders.get(o) ?? 0) + 1);
  return spending.filter(
    ({ inputs }) =>
      inputs.length > 0 && inputs.every((o) => spent.has(o)) && (either || !inputs.some((o) => spenders.get(o)! > 1)),
  );
}

/** What `sent` pays back to each side that the reading doesn't show yet, and the rewards it takes that it still does. */
export function incomingOf(wasm: typeof Wasm, sent: SentTx[], from: IncomingFrom): InMotion {
  const cardano: KoiosUtxo[] = [];
  const contract: KoiosUtxo[] = [];
  const { account, owned } = from;
  let rewards = from.rewards;
  let withdrawn = 0n;
  for (const { s } of goingOut(sent, from.spent)) {
    // The reading lists an output it pays the account: it was read after this landed, rewards taken and all.
    let landed = false;
    for (const u of outputsOf(wasm, s.txCbor)) {
      const o = outpoint(u);
      const payment = paymentOf(wasm, u.address);
      if (!payment) continue;
      const toAccount = !payment.script && from.keys.has(payment.hash);
      if (toAccount && account?.has(o)) landed = true;
      if (account?.has(o) || owned?.has(o) || from.spent.has(o) || from.reserved.has(o)) continue;
      if (toAccount) {
        if (account) cardano.push(u);
      } else if (owned && payment.script && payment.hash === from.contract.walletContractHash && !seedelfTokenOf(u, from.contract.seedelfPolicyId)) {
        contract.push(u);
      }
    }
    // Not with no reading of the account kept: what it pays back there isn't counted either. Never more than the
    // reading counts: one from before an epoch's rewards came counts less than was taken, and all of it is in the
    // change. A reading that lists the change and counts less than was taken has seen it land; one that lists the
    // change yet still counts all of it was read from an account_info behind its UTxOs, or after more rewards came,
    // and they come out all the same: an amount too low until the next reading, never one too high (the fix round's
    // review of blind test §9.1).
    const takes = account && from.stake ? withdrawalOf(s.txCbor, from.stake) : 0n;
    const take = takes === 0n || (landed && rewards < takes) ? 0n : rewards < takes ? rewards : takes;
    rewards -= take;
    withdrawn += take;
  }
  const seedelf = contract.length ? from.ours(contract) : [];
  const sum = (utxos: KoiosUtxo[]) => summed(utxos, from.decimals);
  return {
    incoming: { ...(seedelf.length ? { seedelf: sum(seedelf) } : {}), ...(cardano.length ? { cardano: sum(cardano) } : {}) },
    withdrawn,
  };
}

/**
 * What the wallet's own transactions on their way withdraw from the reward address `stake` (its bytes, hex), the
 * most any of them does: a payment built meanwhile leaves those rewards alone, as Home's forms do (account.ts), and
 * Withdraw and Stop staking wait (staking.ts), since the ledger takes one withdrawal of them and the change on its
 * way holds them. Two that spend the same coin count too: either may land.
 */
export function withdrawingOf(sent: SentTx[], spent: ReadonlySet<string>, stake: string | undefined): bigint {
  if (!stake) return 0n;
  return goingOut(sent, spent, { either: true }).reduce((most, { s }) => {
    const takes = withdrawalOf(s.txCbor, stake);
    return takes > most ? takes : most;
  }, 0n);
}

/** What a side of the reading counts: `utxos` less what's spent since, summed, with each token's decimals as Koios gave them. */
export function lessSpent(utxos: KoiosUtxo[], spent: ReadonlySet<string>): Locked {
  const left = utxos.filter((u) => !spent.has(outpoint(u)));
  const { lovelace, tokens } = sumValue(left);
  return { lovelace: lovelace.toString(), tokens, utxos: left.length };
}

function summed(utxos: KoiosUtxo[], decimals?: ReadonlyMap<string, number>): Locked {
  const { lovelace, tokens } = sumValue(utxos);
  const known = tokens.map((x) => ({ ...x, decimals: decimals?.get(`${x.policyId}.${x.assetName}`) ?? x.decimals }));
  return { lovelace: lovelace.toString(), tokens: known, utxos: utxos.length };
}

const bytesOf = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** A transaction's inputs; none if it can't be read. */
function inputsOf(txCbor: string): string[] {
  try {
    return txInputs(bytesOf(txCbor));
  } catch {
    return [];
  }
}

/** What a transaction withdraws from the reward address `stake` (its bytes, hex); nothing if it can't be read. */
function withdrawalOf(txCbor: string, stake: string): bigint {
  try {
    return txWithdrawals(bytesOf(txCbor))
      .filter((w) => w.account === stake.toLowerCase())
      .reduce((sum, w) => sum + w.lovelace, 0n);
  } catch {
    return 0n;
  }
}

/** A reward address's bytes, hex, from its bech32; none if it can't be read. */
export function rewardAccountHex(wasm: typeof Wasm, stake: string | undefined): string | undefined {
  if (!stake) return undefined;
  try {
    return wasm.cip30Address(stake).toLowerCase();
  } catch (e) {
    if (isTrap(e)) throw e;
    return undefined;
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

/** What a pending entry needs to know of the account, from the last reading and the device's records. */
export interface PendingFrom {
  /** The public account active now: only its own Sends are listed as paid by it (sent-txs.ts `account`). */
  active: number;
  /** The account's payment key hashes (hex), its stake address (bech32), and its stake key's hash (hex). */
  keys: ReadonlySet<string>;
  stake: string;
  stakeKey?: string;
  /** The outpoints the last reading lists on the account's side: what a transaction spent there, when it predates it. */
  account: ReadonlySet<string>;
  spent: ReadonlySet<string>;
  /** What the Lovejoin chains will spend: a chain's transactions aren't listed here. */
  reserved: ReadonlySet<string>;
  /** Transactions already in the activity read from Koios: those are on chain, and listed as they are there. */
  listed: ReadonlySet<string>;
  /** The private history's own entries, by transaction: a Make private, a mint the account paid for, and what it names. */
  own: ReadonlyMap<string, ActivityEntry>;
  /** The transaction the wallet watches on this network and what it is (pending.ts), when there's one. */
  watched?: { txHash: string; kind: ActivityEntry["kind"] };
}

/** One kept transaction, read. */
type Read = { s: SentTx; inputs: string[]; d: TxDetail };

/**
 * The account's activity the chain doesn't list yet: each of the wallet's own transactions on its way that the
 * active account sent, or that pays it from the private balance, from what the device keeps (blind test §9.3, T07,
 * T08). Asks no one. An entry says what the confirmed one will: what left besides the fee (paid to others, a
 * deposit), what came in, the fee and the rewards it collected. One the account pays for is worked out from its
 * outputs alone, as its inputs are all the account's (its value is the outputs', the fee and any deposit, less the
 * rewards and any refund); one paid from the private balance, from what it pays the account. Gone once Koios lists
 * it.
 *
 * Whose it is comes from Send's own record (`SentTx.account`), or from the coins the device knows are this
 * account's; never from the watch, which is the network's, or the private history, which every account shares: from
 * those, account 1 listed account 0's 25 ₳ payment as its own, at "−60.300614 ₳" (the fix round's review). And one
 * a chain sent (a Lovejoin mix, its deposit) is listed only by Koios: with no slot, it read as received, at its
 * change's whole amount.
 */
export function pendingEntries(wasm: typeof Wasm, network: NetworkName, sent: SentTx[], from: PendingFrom): ActivityEntry[] {
  const net = network === "mainnet" ? wasm.Network.Mainnet : wasm.Network.Preprod;
  const ours = (o: TxDetail["outputs"][number]) => o.address.payment === "key" && from.keys.has(o.address.hex.slice(2, 58));
  const decoded = goingOut(sent, from.spent).flatMap(({ s, inputs }): Read[] => {
    try {
      return [{ s, inputs, d: JSON.parse(wasm.decodeTx(net, s.txCbor)) as TxDetail }];
    } catch (e) {
      if (isTrap(e)) throw e;
      return [];
    }
  });
  // The account's coins as far as the device knows them: those the reading lists, and change on its way to it.
  const coins = new Set(from.account);
  for (const { d } of decoded) for (const o of d.outputs) if (ours(o)) coins.add(`${d.txHash}#${o.index}`);
  return decoded.flatMap(({ s, inputs, d }): ActivityEntry[] => {
    if (from.listed.has(s.txHash)) return [];
    // A Lovejoin chain's: its page follows it, and a mix spends the pool's boxes as well as the account's coins.
    if (inputs.some((o) => from.reserved.has(o))) return [];
    const rewards = d.withdrawals.filter((w) => w.address === from.stake).reduce((n, w) => n + BigInt(w.lovelace), 0n);
    const own = d.outputs.filter(ours);
    const others = d.outputs.filter((o) => !ours(o));
    const mine = from.own.get(s.txHash);
    // The active account pays for one that carries a slot (account.ts) when Send sent it from this account, or,
    // with no such record, when every coin it spends is one the device knows is this account's.
    const paid = d.validUntil !== null && (s.account !== undefined ? s.account === from.active : inputs.every((o) => coins.has(o)));
    if (d.validUntil !== null && !paid) return [];
    // Otherwise one the private history wrote down at Send (a Make public, a Seedelf removed) is listed if it pays
    // this account; a chain's isn't.
    if (!paid && (!mine || own.length === 0)) return [];
    const watched = from.watched?.txHash === s.txHash ? from.watched.kind : undefined;
    const deposits = d.certificates.reduce((n, c) => n + BigInt(c.deposit ?? "0"), 0n);
    const refunds = d.certificates.reduce((n, c) => n + BigInt(c.refund ?? "0"), 0n);
    const sum = (list: typeof d.outputs) => list.reduce((n, o) => n + BigInt(o.lovelace), 0n);
    // Paid by the account: what left it besides the fee. Paid from the private balance: what came in.
    const moved = paid ? refunds - deposits - sum(others) : sum(own);
    const assets = new Map<string, bigint>();
    const add = (list: Array<{ policyId: string; assetName: string; quantity: string }>, sign: 1n | -1n) => {
      for (const a of list) assets.set(`${a.policyId}.${a.assetName}`, (assets.get(`${a.policyId}.${a.assetName}`) ?? 0n) + sign * BigInt(a.quantity));
    };
    if (paid) {
      // Whatever the account's inputs held and isn't paid to others comes back, but for what's minted or burned.
      add(d.mint, 1n);
      for (const o of others) add(o.assets, -1n);
    } else {
      for (const o of own) add(o.assets, 1n);
    }
    const tokens = [...assets].filter(([, q]) => q !== 0n);
    // What it does with the account's stake key, as the confirmed entry's details will say (activity.ts stakingOf).
    const mineCerts = d.certificates.filter((c) => !!from.stakeKey && c.credential?.hash === from.stakeKey);
    const pool = mineCerts.find((c) => c.pool)?.pool;
    const drep = mineCerts.find((c) => c.drep)?.drep;
    const staking: ActivityStaking = {
      ...(pool ? { pool } : {}),
      ...(drep ? { drep } : {}),
      ...(deposits > 0n ? { deposit: deposits.toString() } : {}),
      ...(refunds > 0n ? { refund: refunds.toString() } : {}),
      ...(mineCerts.some((c) => /^(stakeD|d)eregistration$/.test(c.kind)) ? { stopped: true } : {}),
      ...(rewards > 0n ? { rewards: rewards.toString() } : {}),
    };
    // Named as the confirmed entry will be, as far as the transaction says: a public Send is "sent" there.
    // Never "Sent" with a plus: one that leaves the account better off is received.
    const kind: ActivityEntry["kind"] = mine?.kind ?? (watched && watched !== "send" ? watched : paid && moved <= 0n ? "sent" : "received");
    const counterparts = [...new Set(others.map((o) => o.address.bech32))];
    const who = mine?.detail
      ? { detail: mine.detail, ...(mine.more ? { more: mine.more } : {}) }
      : kind === "sent" && counterparts.length
        ? counterparts.length > 1
          ? { detail: counterparts[0], more: counterparts.length - 1 }
          : { detail: counterparts[0] }
        : {};
    return [
      {
        txHash: s.txHash,
        at: s.sentAt,
        kind,
        direction: moved > 0n ? "in" : moved < 0n ? "out" : "none",
        lovelace: (moved < 0n ? -moved : moved).toString(),
        tokens: tokens.length,
        ...(paid ? { fee: d.fee } : {}),
        ...who,
        ...(tokens.length
          ? {
              assets: tokens.map(([key, q]) => {
                const [policyId, assetName] = key.split(".") as [string, string];
                return { policyId, assetName, quantity: q.toString() };
              }),
            }
          : {}),
        ...(Object.keys(staking).length ? { staking } : {}),
        pending: true,
      },
    ];
  });
}
