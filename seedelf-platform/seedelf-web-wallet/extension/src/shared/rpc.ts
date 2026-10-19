// Typed request/response messages between the UI and the service worker.
// The service worker owns every secret; the UI only ever asks it to do work.

import type { NetworkName } from "../networks";
import type { HistoryClass } from "./histories";
import type { Currency, Preferences } from "./preferences";

export type { Preferences };

export type WalletState = "no-wallet" | "locked" | "unlocked";

export interface Status {
  state: WalletState;
  version: string;
  /** The network the wallet is on: the user's choice, among `networks` (Settings). */
  network: NetworkName;
  /** The networks this build has, its default first: preprod alone, or mainnet and preprod. */
  networks: NetworkName[];
  /** When locked: how long until another unlock attempt is allowed (ms). */
  retryAfterMs: number;
  /**
   * Set when the dApp connector can't be turned on, and why. "storage": this
   * Chrome won't keep sites' scripts out of the wallet's local storage
   * (`storage.local.setAccessLevel`), so the connector stays off; a newer
   * Chrome fixes it.
   */
  connectorBlocked?: "storage";
  /** When locked: why, if the wallet locked itself. "trap": its WebAssembly stopped working, so it dropped the keys. */
  lockedBy?: "trap";
}

export type UnlockResult =
  | { unlocked: true }
  /** `wrongPassword` is false when the attempt was refused for being too early. */
  | { unlocked: false; wrongPassword: boolean; retryAfterMs: number };

/** The unlocked wallet's public identifiers, for the account it is working on. */
export interface Account {
  /** The active Cardano account's receive address 0/0. */
  receiveAddress: string;
  stakeAddress: string;
  /** The Seedelf base register's public value (compressed G1, hex). */
  seedelfPublicValue: string;
  /** Which CIP-1852 account the two addresses are, as an index from 0. */
  account: number;
}

/** The public accounts the wallet knows of, and which one it is working on. */
export interface AccountList {
  accounts: KnownAccount[];
  active: number;
}

/**
 * A public account the phrase is known to have used (chunk 18). Shown as
 * "Account <index + 1>" with no name of its own, since people count from 1.
 */
export interface KnownAccount {
  index: number;
  /** What the user called it. */
  name?: string;
  /** When discovery first found it used (ms since the epoch); absent for account 0. */
  foundAt?: number;
}

/** A native token amount. `quantity` is the raw integer, as a decimal string. */
export interface TokenAmount {
  policyId: string;
  /** Hex. */
  assetName: string;
  quantity: string;
  /** From the token registry via Koios; 0 when unknown. */
  decimals: number;
  fingerprint: string;
}

/** Something that happened in one of the wallet's two balances, for Activity. */
export interface ActivityEntry {
  txHash: string;
  /** When: the block's time, or when this wallet sent it (ms since the epoch). */
  at: number;
  /**
   * "received" and "sent" are anyone's; the rest are this wallet's own flows. A transaction at Lovejoin's mix box
   * that the public account paid is its deposit ("lovejoin-deposit") or one of its mixes ("lovejoin-round"), read
   * from the transaction alone (background/activity.ts describe); one where it paid a box's way back into a
   * Seedelf is "lovejoin-back-paid" (chunk 34's escape hatch). A pool started is "lovejoin-launch", on either side.
   */
  kind: "received" | "sent" | "lovejoin-deposit" | "lovejoin-round" | "lovejoin-back-paid" | PendingTx["kind"];
  /** Into the balance, out of it, or neither (a seedelf's locked ADA). */
  direction: "in" | "out" | "none";
  /**
   * ADA moved, as lovelace (a decimal string, no sign), the fee apart: what was paid to others, or came in. On the
   * Cardano account's side, the balance as Home counts it, staking rewards included: rewards a payment withdrew
   * aren't money in (blind test §9.1, T08's "Sent +32.300614 ₳" for 25 ₳ paid).
   */
  lovelace: string;
  /** How many kinds of token moved with it. */
  tokens: number;
  /** The network fee, when this wallet paid it (lovelace). */
  fee?: string;
  /** Who or where: a seedelf's tag, a $handle, an address. Data, never the wallet's own words. */
  detail?: string;
  /**
   * How many more it paid beside `detail`, which is the first: a transfer or
   * a withdrawal to several. The page says "and 2 more" in its own language
   * (ui/activity.ts activityDetail). 1.1.0 kept "alice and 2 more" in
   * `detail`, in English: the worker reads that back as these two
   * (background/activity.ts withMore).
   */
  more?: number;
  /**
   * The private session (from 0) a funding, a top-up or a return was paid
   * for or by: its name is the page's to say. An entry from before has the
   * name in `detail` instead, in English (entrySession).
   */
  session?: number;
  /** The tokens that moved, each with a signed quantity (negative: out), when known. Older entries have only `tokens`. */
  assets?: TokenQuantity[];
  /** The Cardano account's only: a note on the transaction (CIP-20's message), in whoever wrote it's words. */
  note?: string;
  /** The Cardano account's only: what the transaction did with its stake key. */
  staking?: ActivityStaking;
  /**
   * The Cardano account's only: sent by this wallet and not on chain yet, read from what the device keeps (the
   * transaction itself, background/incoming.ts `pendingEntries`), until Koios lists it (blind test §9.3).
   */
  pending?: boolean;
  /**
   * The Seedelf history's only: the history of what the transaction left in
   * the private balance, its change included, for coin selection and the
   * UTxOs screen (shared/histories.ts). Absent, it's read from `kind`.
   */
  origin?: HistoryClass;
}

/**
 * The private session (from 0) whose funding, top-up or return `entry`
 * records, if it's one: its `session`, or, on an entry written before the
 * worker kept the number, the name its `detail` holds ("Private session 3").
 * The worker wrote that name in English then, the only language it had, so
 * this and 1.1.0's "and 2 more" (`more`) are the only English read back, and only for those.
 */
export function entrySession(entry: ActivityEntry): number | undefined {
  if (entry.kind !== "session-out" && entry.kind !== "session-back") return undefined;
  const kept = entry.session;
  if (typeof kept === "number" && Number.isInteger(kept) && kept >= 0) return kept;
  const n = /^Private session (\d+)$/.exec(entry.detail ?? "")?.[1];
  return n ? Number(n) - 1 : undefined;
}

/** What a transaction in the Cardano account's Activity did with its stake key. Lovelace amounts are decimal strings. */
export interface ActivityStaking {
  /** Staked with this pool (`pool1…`), and its ticker when the pool list on the device has it. */
  pool?: string;
  ticker?: string;
  /** Delegated the vote: a DRep's ID, `drep_always_abstain` or `drep_always_no_confidence`. */
  drep?: string;
  /** Paid to register the stake key. */
  deposit?: string;
  /** Returned by unregistering it. */
  refund?: string;
  /** Rewards withdrawn. */
  rewards?: string;
  /** Unregistered: staking stopped. */
  stopped?: boolean;
  /** What it did as the account's own DRep: registered it (`deposit` includes what that locked), updated, retired, or voted. */
  drepAction?: "register" | "update" | "retire" | "vote";
  /** How many governance actions the account's DRep voted on in it. */
  votes?: number;
}

/** ADA's value in the currency chosen, on mainnet: CoinGecko's, kept on the device five minutes. */
export interface AdaPrice {
  currency: Exclude<Currency, "off">;
  /** What one ADA is worth in it. */
  rate: number;
  /** When CoinGecko was read (ms since the epoch). */
  updatedAt: number;
}

/**
 * What showing an NFT's image found (chunk 20, background/nft-image.ts),
 * asked for by the user one NFT at a time. A failure to reach Koios or the
 * gateway is an error instead, in words.
 */
export type NftImage =
  /** The image, as a `data:` URI for the page to show: from IPFS through the gateway, or written on chain in its metadata. */
  | { image: string; from: "ipfs" | "chain" }
  /**
   * Nothing to show: Koios knows no metadata for it (`metadata`), its
   * metadata names no image the wallet can read (`image`), or it's a
   * Seedelf, which has none and is never asked about (`seedelf`).
   */
  | { none: "metadata" | "image" | "seedelf" }
  /** Its image is somewhere other than IPFS, at this address, which the wallet doesn't fetch. */
  | { elsewhere: string }
  /** The image is larger than the wallet shows: this many bytes at most. */
  | { tooLarge: number }
  /** The gateway answered with something that isn't an image. */
  | { notImage: true };

/** A name for a seedelf or an address this wallet pays, kept sealed on the device. */
export interface Contact {
  id: string;
  name: string;
  /** A seedelf's full name, or an address or `$handle` to withdraw to. */
  kind: "seedelf" | "address";
  value: string;
  network: NetworkName;
}

/** One of the user's seedelfs: a named token in a UTxO the wallet owns. */
export interface SeedelfInfo {
  /** The full token name, hex. */
  assetName: string;
  /** The personal tag, when it reads as text. */
  label?: string;
  /** ADA locked with the token (lovelace string); only `remove` gets it back. */
  lovelace: string;
  /**
   * Who paid for it, when the wallet knows (background/minted-by.ts):
   * Remove sends its ADA back to that side by default, and asks otherwise.
   */
  paidBy?: MintSource;
  /**
   * Which public account paid, when `paidBy` is "account" and the wallet
   * knows which (chunk 18). Removing to a *different* account links that one
   * to the Seedelf's name as well, and the mint already links the paying
   * one — so anyone can join them by the name. Remove warns.
   */
  paidByAccount?: number;
}

/** What's kept out of every payment on one side: locked UTxOs, and the Cardano account's collateral. */
export interface Locked {
  lovelace: string;
  tokens: TokenAmount[];
  utxos: number;
}

/** A stake pool, as far as the wallet knows it. */
export interface PoolRef {
  /** `pool1…`. */
  id: string;
  ticker?: string;
  name?: string;
}

/** Koios's names for the two pinned vote delegations, which the wallet uses too. */
export const ALWAYS_ABSTAIN = "drep_always_abstain";
export const ALWAYS_NO_CONFIDENCE = "drep_always_no_confidence";

/** Where the Cardano account's stake key stands (Koios's `account_info`). Lovelace amounts are decimal strings. */
export interface StakeInfo {
  /** Registered: it can be delegated, and earn rewards. */
  registered: boolean;
  /** The pool it's staked with. */
  pool: PoolRef | null;
  /** Its vote delegation: a DRep's ID (CIP-129), `drep_always_abstain` or `drep_always_no_confidence`; null for none. */
  drep: string | null;
  /**
   * Rewards that can be withdrawn: less what one of the wallet's own transactions on its way withdraws, which its
   * change holds (background/incoming.ts, blind test §9.1).
   */
  rewards: string;
  /** The deposit paid to register it: stopping staking gets it back. */
  deposit: string;
  /** Its vote goes to the account's own DRep (chunk 21): worked out from the key, asking no one. */
  ownDrep?: boolean;
  /**
   * It was ever paid a reward, so it has a rewards history, registered or not: from what `account_info` gives
   * (rewards available and withdrawn), asking no more (chunk 30).
   */
  rewarded?: boolean;
}

/**
 * What paid a reward: a pool's delegators (`member`), its operator (`leader`), a pool's deposit back (`refund`),
 * the reserves or the treasury, a governance proposal's deposit back, or something Koios names that the wallet
 * doesn't know.
 */
export type RewardKind = "member" | "leader" | "refund" | "reserves" | "treasury" | "proposal_refund" | "other";

/** One reward paid to the public account's stake key (chunk 30). Lovelace as a decimal string. */
export interface RewardRow {
  /** The epoch it's paid at the start of: in the rewards from then. A later one than now is on its way. */
  epoch: number;
  /** The epoch it was earned in: two before for a pool's rewards. */
  earned: number;
  amount: string;
  kind: RewardKind;
  /** The pool that paid it, with its ticker when the device knows it (none is asked for). */
  pool?: PoolRef;
}

/**
 * What one of the stake key's certificates did (chunk 36): registered it, staked it with a pool, delegated its vote,
 * or stopped staking, which deregisters it.
 */
export type DelegationKind = "registration" | "pool" | "vote" | "deregistration";

/**
 * One certificate naming the public account's stake key: a row of its delegation history (chunk 36, after Lace's).
 * One transaction can make several: the first stake registers the key, stakes it and delegates the vote.
 */
export interface DelegationRow {
  kind: DelegationKind;
  /** The transaction that made it. */
  txHash: string;
  /** When its block was made (ms since the epoch). */
  at: number;
  /** The epoch it was made in. */
  epoch: number;
  /** `pool`: the pool it's staked with, with its ticker when the device knows it (none is asked for). */
  pool?: PoolRef;
  /** `vote`: a DRep's ID (CIP-129), `drep_always_abstain` or `drep_always_no_confidence`. */
  drep?: string;
  /** `vote`: the DRep is the account's own (chunk 21), worked out from the key, asking no one. */
  ownDrep?: boolean;
  /** `registration`: the deposit it took; `deregistration`: the deposit back. Lovelace, when the chain says. */
  deposit?: string;
}

/** What the wallet holds on one network. Lovelace amounts are decimal strings. */
export interface Balances {
  network: NetworkName;
  /** When the chain was read (ms since the epoch). */
  updatedAt: number;
  /**
   * The last reading that failed since this one was made, when one did: Home's alert follows it, whichever page
   * asked and however Home came back, until a reading succeeds (background/balances.ts `readingNoted`, blind test
   * E05). `message`: its words, while the worker that failed still holds them.
   */
  failed?: { at: number; message?: string };
  /** UTxOs in the wallet contract this wallet owns, except those holding a seedelf (as in the CLI's `balance`). */
  seedelf: { lovelace: string; tokens: TokenAmount[]; utxos: number; seedelfs: SeedelfInfo[]; locked: Locked; incoming?: Incoming };
  /** The Cardano account (CIP-1852 account 0): `lovelace` is its UTxOs', without the rewards in `staking`. */
  cardano: {
    lovelace: string;
    tokens: TokenAmount[];
    utxos: number;
    addressesUsed: number;
    locked: Locked;
    staking: StakeInfo;
    incoming?: Incoming;
    /**
     * The rewards the wallet's own transactions on their way withdrew (lovelace): out of `staking.rewards`, as
     * what they pay back holds them (background/incoming.ts, blind test §9.1).
     */
    withdrawing?: string;
  };
}

/**
 * What the wallet's own sent transactions pay back to a side that no reading
 * lists yet: a payment's change, a Make private's deposit (background/incoming.ts,
 * chunk 23's second review, HM-1, HM-2). Not in `lovelace` or `tokens`, and
 * nothing a form may spend until the chain shows it.
 */
export type Incoming = Locked;

/** A live stake pool in the browser. Lovelace amounts are decimal strings. */
export interface PoolRow {
  id: string;
  ticker?: string;
  /** 0 to 1: the share of rewards the pool keeps, after its cost. */
  margin: number;
  /** What the pool takes each epoch before the margin. */
  cost: string;
  pledge: string;
  /** Stake in the current snapshot. */
  stake: string;
  /** A percentage: past 100, every delegator's rewards shrink. */
  saturation: number;
}

/** Every live pool, kept on the device for a day: it's the same for everyone. */
export interface PoolList {
  pools: PoolRow[];
  /** When it was read (ms since the epoch). */
  updatedAt: number;
}

/** One pool's details (Koios's `pool_info`). */
export interface PoolDetails extends PoolRef {
  homepage?: string;
  description?: string;
  margin: number;
  cost: string;
  pledge: string;
  /** What the owners actually hold staked: below `pledge`, the pool earns less. */
  livePledge: string;
  stake: string;
  saturation: number;
  delegators: number;
  blocks: number;
  status: "registered" | "retiring" | "retired";
  /** The epoch it retires in, when it's retiring. */
  retiringEpoch: number | null;
}

/** One of a pool's recent epochs (Koios's `pool_history`). */
export interface PoolEpoch {
  epoch: number;
  blocks: number;
  /**
   * What each ADA staked with it earned that epoch, after its fees, as a
   * yearly percentage. Absent when the server didn't say, or the pool had no
   * stake that epoch.
   */
  ros?: number;
}

/** A pool's recent epochs, newest first, and its return on stake over them. */
export interface PoolHistory {
  id: string;
  epochs: PoolEpoch[];
  /** The yearly percentage an ADA staked through every epoch with a `ros` earned: absent with none. */
  ros?: number;
}

/** A DRep (Koios's `drep_info`, and its name from `drep_metadata`). */
export interface DrepDetails {
  /** CIP-129. */
  id: string;
  name?: string;
  /** Koios's `drep_status`: `deregistered` has retired, `not_registered` never registered. */
  status: "registered" | "deregistered" | "not_registered";
  /** Voted recently enough to count: an inactive DRep's votes don't. */
  active: boolean;
  expiresEpoch: number | null;
  /** The stake delegated to it (lovelace). */
  votingPower: string;
  delegators: number;
}

/** Where a file is published, and the blake2b-256 hash of its exact bytes (hex). */
export interface Anchor {
  url: string;
  hash: string;
}

/** One vote as the account's DRep: a governance action by the transaction that proposed it and its index there. */
export interface Ballot {
  txHash: string;
  index: number;
  vote: GovVote;
}

export type GovVote = "yes" | "no" | "abstain";

/** Something to do with the Cardano account's stake key, or as its own DRep (CIP-105's key `3/0`). */
export type StakingAction =
  /** Stake with a pool (`pool1…`), registering first when needed. */
  | { kind: "delegate"; pool: string }
  /** Delegate the vote: a DRep's ID, `drep_always_abstain` or `drep_always_no_confidence`. */
  | { kind: "vote"; drep: string }
  | { kind: "withdraw" }
  /** Withdraw the rewards, unregister, and get the deposit back. */
  | { kind: "stop" }
  /** Register the account's own DRep, with its profile when there is one; `delegate` delegates the account's vote to it too. */
  | { kind: "drep-register"; anchor?: Anchor; delegate: boolean }
  /** Change the DRep's profile, or take it away. It keeps the DRep active, too. */
  | { kind: "drep-update"; anchor?: Anchor }
  /** Retire the DRep and get its deposit back; the account's own vote, if it was the DRep's, moves to always abstain. */
  | { kind: "drep-retire" }
  /** Vote as the DRep, with no rationale. */
  | { kind: "drep-vote"; votes: Ballot[] };

/** The account's own DRep: who it is (CIP-105's key `3/0`), and where it stands (Koios's `drep_info`). Lovelace amounts are decimal strings. */
export interface OwnDrep {
  /** CIP-129. */
  id: string;
  /** Koios's `drep_status`: `not_registered` never registered (or Koios has no row), `deregistered` retired. */
  status: "not_registered" | "registered" | "deregistered";
  /** The deposit it paid: what retiring returns. "0" when not registered. */
  deposit: string;
  /** What registering locks up now (`drep_deposit`), when it isn't registered and Koios said. */
  depositNow?: string;
  /** Voted or updated recently enough to count. */
  active: boolean;
  /** The last epoch it stays active in without voting or updating. */
  expiresEpoch: number | null;
  /** The stake delegated to it. */
  votingPower: string;
  delegators: number;
  /** Its profile, when it has one: where, and what Koios found there (`valid` null: Koios couldn't say). */
  profile: { url: string; hash: string; name?: string; valid: boolean | null } | null;
}

/** What a governance action does, as the ledger names it. */
export type GovActionType =
  | "ParameterChange"
  | "HardForkInitiation"
  | "TreasuryWithdrawals"
  | "NoConfidence"
  | "NewCommittee"
  | "NewConstitution"
  | "InfoAction";

/** A live governance action (Koios's `proposal_list`): its words are its own, from its anchor, as Koios read them. */
export interface GovAction {
  /** CIP-129 (`gov_action1…`). */
  id: string;
  txHash: string;
  index: number;
  /** A `GovActionType`, or a type the ledger added since, shown as Koios names it. */
  type: GovActionType | (string & {});
  title?: string;
  abstract?: string;
  proposedEpoch: number;
  /** When it was proposed (ms since 1970): its transaction's block time, when Koios gave it. */
  proposedAt?: number;
  /** A treasury withdrawal's payments, as the ledger holds them: each reward address, and the lovelace it gets. */
  withdrawals?: Array<{ to: string; amount: string }>;
  /** The last epoch it can be voted on in. */
  expiresEpoch: number;
  /** What its proposer locked up (lovelace). */
  deposit: string;
  anchor: Anchor | null;
  /** Koios read the anchor and its hash matched (true), didn't (false), or couldn't say (null). */
  anchorValid: boolean | null;
}

/** The live governance actions, kept on the device for an hour: they're the same for everyone. */
export interface GovActionList {
  actions: GovAction[];
  /** When it was read (ms since the epoch). */
  updatedAt: number;
}

/** The Governance actions screen: the live actions, the account's own DRep, and how it voted on each. */
export interface GovernanceView {
  list: GovActionList;
  drep: OwnDrep;
  /** This DRep's vote on each live action it voted on, by the action's ID. */
  votes: Record<string, GovVote>;
}

/** A DRep's profile, as the user writes it: CIP-119's fields. */
export interface DrepProfileRequest {
  givenName: string;
  objectives?: string;
  motivations?: string;
  qualifications?: string;
  /** CIP-119's `doNotList`: asks DRep directories not to list it. */
  doNotList: boolean;
}

/** The profile's file, to publish exactly as it is, and its hash (hex): what the registration's anchor carries. */
export interface DrepProfileFile {
  file: string;
  hash: string;
}

/** A built and signed staking transaction, waiting for the user to send it. Amounts are lovelace strings. */
export interface StakingSummary {
  network: NetworkName;
  txHash: string;
  action: StakingAction;
  /** The pool staked with, as `pool1…`. */
  pool: string | null;
  /** The vote, as Koios names it. */
  drep: string | null;
  fee: string;
  /** Paid to register the stake key, and a DRep: all of it. */
  deposit: string;
  /** Of `deposit`, what registering the account's DRep locks up: back when the DRep retires. Only for a DRep action. */
  drepDeposit?: string;
  /**
   * A retirement moves the account's own vote, which was on its DRep, to always abstain: from the build's own fresh
   * read, which the review says. Absent: it doesn't.
   */
  ownVoteMoves?: boolean;
  /** Returned by unregistering it. */
  refund: string;
  /** Rewards withdrawn. */
  withdrawal: string;
  /** Back to the Cardano account's receive address. */
  changeLovelace: string;
  changeTokens: number;
  inputs: number;
}

export type UtxoSide = "seedelf" | "cardano";

/** One UTxO of the wallet's, for the UTxOs screen. */
export interface UtxoInfo {
  txHash: string;
  index: number;
  lovelace: string;
  tokens: TokenAmount[];
  /** The block that made it, when known. */
  blockHeight?: number;
  /**
   * When it was made (ms), for one with no block height: a private coin read
   * from the private index, which gives slots and times, never heights
   * (chunk 26b).
   */
  madeAt?: number;
  /** The Cardano account's address holding it. */
  address?: string;
  /**
   * Where that address sits in the account: its chain (0 receive, 1 change)
   * and index, so the details can say it's the account's own (chunk 23's
   * second review, AC-4).
   */
  path?: { role: 0 | 1; index: number };
  /** Kept out of every payment (the collateral always is). */
  locked: boolean;
  /** The Cardano account's collateral. */
  collateral?: boolean;
  /** It holds one of your seedelfs: its full token name, and its tag when it reads as text. Only removing it spends the UTxO. */
  seedelf?: { name: string; label?: string };
  /** A private one's: where its money came from, as the sealed history says (shared/histories.ts). */
  history?: HistoryClass;
  /**
   * No transaction of this wallet can take it: `script`, it holds a
   * reference script. A private one: the wallet's script evaluator can't
   * spend one yet, so it isn't in the private balance. A public one: Koios
   * doesn't give the script, so its fee can't be priced. (A register's datum
   * is always flat, so an owned UTxO never has one too deep to read.)
   */
  unspendable?: "script";
}

/** Both sides' UTxOs, largest first. */
export interface UtxoLists {
  seedelf: UtxoInfo[];
  cardano: UtxoInfo[];
  /** When the balance reading they come from was made (ms since the epoch). */
  updatedAt?: number;
}

/** The Cardano account's collateral: 5 ₳ set aside for transactions that run a script. */
export type CollateralStatus =
  /** `by`: the wallet took a 5 ₳ UTxO the account held, or you set it. */
  | { state: "set"; utxo: UtxoInfo; by: "wallet" | "you" }
  /** The payment that makes it is on its way. */
  | { state: "waiting"; txHash: string }
  /** `reclaimed`: you returned it, so the wallet doesn't take one by itself. `candidate`: a 5 ₳ UTxO it can be, with no transaction. */
  | { state: "none"; reclaimed: boolean; candidate?: UtxoInfo };

/** A token, by its policy and hex name. */
export interface TokenRef {
  policyId: string;
  assetName: string;
}

/** A built and signed move-in, waiting for the user to confirm it. Amounts are lovelace strings. */
export interface MoveInSummary {
  network: NetworkName;
  txHash: string;
  fee: string;
  /** Into Seedelf. */
  lovelace: string;
  /** The least the deposit could carry: an amount below it was raised to it. Null for Max. */
  minimum: string | null;
  tokens: Array<TokenRef & { quantity: string }>;
  /** How many new contract UTxOs hold it. */
  depositOutputs: number;
  /** Staking rewards withdrawn to pay for it. */
  withdrawal?: string;
  /** Back to the Cardano account's receive address. */
  changeLovelace: string;
  changeTokens: number;
  inputs: number;
  /** Max's UTxOs it couldn't take with the rest, and why (empty for an amount). */
  leftOut?: LeftOutUtxo[];
}

/** What pays for a new seedelf: the Cardano account (mint first, then move in), or the Seedelf balance (a stealth mint). */
export type MintSource = "account" | "seedelf";

/** A finished seedelf mint, waiting for the user to send it. Amounts are lovelace strings. */
export interface MintSummary {
  network: NetworkName;
  txHash: string;
  from: MintSource;
  /** The personal tag, as sent ("" for none). */
  label: string;
  /** The new seedelf's token name, hex: prefix, tag, and the smallest input spent. */
  tokenName: string;
  /** Locked with the seedelf; only removing it gets this back. */
  lovelace: string;
  fee: { size: string; compute: string; scriptReference: string; total: string };
  /** Staking rewards withdrawn to pay for it (an account-paid mint only). */
  withdrawal?: string;
  /** Back to where it was paid from: the Cardano account's `0/0`, or the Seedelf balance. */
  changeLovelace: string;
  changeTokens: number;
  changeOutputs: number;
  /** How many UTxOs pay for it. */
  inputs: number;
  /** A stealth mint's: the histories of the private UTxOs it spends, each once, when known (shared/histories.ts). */
  histories?: HistoryClass[];
}

/** A token and an amount to send. `quantity` is the raw integer, as a decimal string. */
/**
 * A token and how many. `decimals`, where it's known: Koios's, as the last balance reading has them, on an
 * Activity entry's tokens (background/activity.ts, blind test E01).
 */
export type TokenQuantity = TokenRef & { quantity: string; decimals?: number };

/** A seedelf found on chain, for the forms that pay one: Send to a seedelf, and Send from the Cardano account. */
export interface SeedelfLookup {
  /** The full token name, hex. */
  name: string;
  /** Its personal tag, when it reads as text. */
  label?: string;
  /** One of this wallet's own seedelfs: paying it moves money in a circle. */
  own: boolean;
}

/** One recipient of a payment, as a form asks for it. `lovelace` null is Max (a single recipient only). */
export interface PaymentAsk<L extends string | null = string | null> {
  /** An address, a `$handle`, or a seedelf's full name, as the screen allows. */
  to: string;
  lovelace: L;
  tokens: TokenQuantity[];
}

/** What one recipient of a payment receives. Amounts are lovelace strings. */
export interface Paid {
  lovelace: string;
  /** The least the payment could carry: an amount below it was raised to it. Null for Max. */
  minimum: string | null;
  tokens: TokenQuantity[];
}

/** One seedelf a transfer pays. */
export interface SeedelfPaid extends Paid {
  /** Its full token name, and its tag when it reads as text. */
  to: string;
  label?: string;
  /** One of your own seedelfs: the payment comes back to your Seedelf balance. */
  toSelf: boolean;
}

/** A finished transfer, waiting for the user to send it. Amounts are lovelace strings. */
export interface TransferSummary {
  network: NetworkName;
  txHash: string;
  /** The seedelfs paid, in order. */
  payments: SeedelfPaid[];
  /** The most possible (Max) to a single Seedelf: all but the fee and what the tokens that stay need (blind test §9.6). */
  max: boolean;
  fee: { size: string; compute: string; scriptReference: string; total: string };
  /** Back into the Seedelf balance: for Max, only the tokens that stay, with the least ADA they need. */
  changeLovelace: string;
  changeTokens: number;
  changeOutputs: number;
  /** The least ADA what stays in the Seedelf balance needs: the tokens that stay, or with none an output of ADA alone. */
  changeMinimum: string;
  /** How many Seedelf UTxOs pay for it. */
  inputs: number;
  /** Seedelf UTxOs Max left for another payment: past the 20 it takes at most, or holding a token that would total more with the rest than an output can hold. */
  left: number;
  /** Max's: private UTxOs no payment takes (a reference script), or one a return through Lovejoin being sent spends. */
  leftOut?: LeftOutUtxo[];
  /** The histories of the private UTxOs it spends, each once, when known (shared/histories.ts). */
  histories?: HistoryClass[];
}

/** Where a withdrawal goes, as the wallet read it. */
export interface WithdrawDestination {
  /** The bech32 address paid. */
  address: string;
  /** The ADA Handle it was found by, without the "$". */
  handle?: string;
  /** It carries one of this wallet's Cardano accounts' keys: paying it re-links the money. */
  own: boolean;
  /**
   * Which of this wallet's public accounts it is, when `own` (chunk 18), so
   * a screen can name it rather than only say it is one of yours.
   *
   * Paying it is **allowed either way** — people do move money between their
   * own accounts, and accounts are not necessarily unlinked to begin with.
   * It is an ordinary Cardano payment, so anyone can see the two accounts
   * paying each other; the forms say that and the user decides, as every
   * known link is handled (docs/privacy.md).
   */
  ownAccount?: number;
}

/** A finished withdrawal, waiting for the user to send it. Amounts are lovelace strings. */
export interface WithdrawSummary {
  network: NetworkName;
  txHash: string;
  /** The addresses paid, in order, and what each receives. */
  payments: Array<WithdrawDestination & Paid>;
  /** Everything (Max) to a single address, rather than amounts. */
  max: boolean;
  fee: { size: string; compute: string; scriptReference: string; total: string };
  /** Back into the Seedelf balance: nothing, for Max. */
  changeLovelace: string;
  changeTokens: number;
  changeOutputs: number;
  /** The least ADA what stays in the Seedelf balance needs (`TransferSummary.changeMinimum`). */
  changeMinimum: string;
  /** How many Seedelf UTxOs pay for it. */
  inputs: number;
  /**
   * Seedelf UTxOs Max left for another withdrawal: past the 20 it takes at
   * most, or holding a token that would total more with the rest than an
   * output can hold.
   */
  left: number;
  /** Max's: private UTxOs no payment takes (a reference script), which the private balance leaves out, or one a return through Lovejoin being sent spends. */
  leftOut?: LeftOutUtxo[];
  /** The histories of the private UTxOs it spends, each once, when known (shared/histories.ts). */
  histories?: HistoryClass[];
}

/** One recipient of a send from the Cardano account: an address (found by `$handle`, maybe), or someone's seedelf. */
export interface SendPaid extends WithdrawDestination, Paid {
  /** Paying someone's seedelf: its full token name, and its tag when it reads as text. `address` is then the wallet contract's. */
  seedelf?: { name: string; label?: string };
}

/** A built and signed payment from the Cardano account, waiting for the user to send it. Amounts are lovelace strings. */
export interface SendSummary {
  network: NetworkName;
  txHash: string;
  /** Who's paid, in order, and what each receives. */
  payments: SendPaid[];
  /** The most possible (Max) to a single recipient, rather than amounts. */
  max: boolean;
  fee: string;
  /** Staking rewards withdrawn to pay for it. */
  withdrawal?: string;
  /** The note on it, as the transaction carries it. */
  note?: string | null;
  /** Back to the Cardano account's receive address. */
  changeLovelace: string;
  changeTokens: number;
  /** How many of the account's UTxOs pay for it. */
  inputs: number;
  /** Max's UTxOs it couldn't take with the rest, and why (empty for amounts). */
  leftOut?: LeftOutUtxo[];
}

/** Where a removed seedelf's ADA goes: the Cardano account's `0/0`, or back into the Seedelf balance. */
export type RemoveTo = "account" | "seedelf";

/** A finished seedelf removal, waiting for the user to send it. Amounts are lovelace strings. */
export interface RemoveSummary {
  network: NetworkName;
  txHash: string;
  /** The seedelf burned: its full token name, and its tag when it reads as text. */
  name: string;
  label?: string;
  to: RemoveTo;
  /** What comes back: the ADA locked with it, less the fee. */
  lovelace: string;
  fee: { size: string; compute: string; scriptReference: string; total: string };
}

/** A submitted transaction the wallet is watching. */
export interface PendingTx {
  kind:
    | "move-in"
    | "mint"
    | "transfer"
    | "withdraw"
    | "remove"
    | "send"
    | "collateral"
    | "stake"
    | "vote"
    | "withdraw-rewards"
    | "unstake"
    | "drep-register"
    | "drep-update"
    | "drep-retire"
    | "drep-vote"
    | "session-out"
    | "session-swap"
    | "session-cancel"
    | "session-back"
    | "lovejoin-withdraw"
    | "lovejoin-mix"
    | "lovejoin-launch";
  network: NetworkName;
  txHash: string;
  submittedAt: number;
  /** Null until it's on chain. */
  confirmations: number | null;
  /**
   * Koios didn't answer its submit, so it may or may not have gone through.
   * The wallet holds its UTxOs back, sends it again now and then (the network
   * takes it once), and watches until the chain shows it or it can't land;
   * until then it builds nothing new on that network. It's sealed on the
   * device meanwhile, so a lock or a closed browser doesn't forget it.
   */
  maybeSent?: boolean;
  /** The slot it can't land after: the public account's transactions carry one (account.ts). */
  invalidHereafter?: number;
  /**
   * Maybe sent, and sent again, the network refused it as spending what's
   * spent while the chain still showed every UTxO it spends, unspent: it's
   * waiting in a mempool, and may still land. A private one isn't let go on
   * age meanwhile, for two and a half hours at most from when it was sent
   * (pending.ts HELD_IN_MEMPOOL_MS). False: a look found one spent, or not
   * on chain at all.
   */
  inMempool?: boolean;
  /**
   * It never landed, and its UTxOs count in the balance again. `expired`:
   * the chain passed its slot, so nothing was sent. `unseen`: a private
   * payment Koios didn't answer, which the chain still hadn't shown 20
   * minutes on; it most likely never went out. With `inMempool`, one the
   * network said it had, held as long as it could be.
   */
  dropped?: "expired" | "unseen";
  /**
   * A chain through Lovejoin, which `txHash`, its last transaction, ends: its
   * first, the one its review showed and the first to land, and how many it
   * has. A mix from the public account's is in Home's watch (lovejoin.ts
   * publicSubmit, watchSent), and Home's banner names that first one until
   * the last lands, not a hash the user never saw (chunk 17's handoff note).
   * A session's return carries it too, but its page watches it, not Home's
   * banner (sessions.ts sendRecorded), and nothing reads it there (1.3.0's
   * release review, C45).
   */
  chain?: { first: string; total: number };
  /**
   * Watched on the private index's feed, which every wallet shares and names
   * no transaction (feed.ts): Home asks every 5 s, as the answer costs a unit
   * at the server's edge and nothing at home (chunk 26b, choice 5). Not kept:
   * each look says it again.
   */
  onFeed?: boolean;
}

/**
 * What removing the wallet would leave behind on one network, from what the
 * wallet keeps (no Koios request): Remove wallet lists it first, and asks
 * again (independent review M2, M5).
 */
export interface AtStake {
  network: NetworkName;
  /** A payment Koios didn't answer, which may still go through. */
  maybeSent?: PendingTx;
  /**
   * Private sessions whose one-time accounts may hold something: each one
   * open, or closed with something no return takes left there
   * (`leftBehind`). A restore's scan finds their money, but not what each
   * was for, nor a site's connection (`found`: one a scan found itself).
   */
  sessions: Array<{ index: number; kind: "swap" | "mix" | "site" | "found"; origin?: string; leftBehind?: boolean }>;
  /** A chain through Lovejoin is still being sent. */
  chainSending: boolean;
  /** A mix from the public account stopped at a transaction that may have gone through, unsettled yet (final review F1). */
  mixMaybeSent?: boolean;
  /** What the wallet keeps for this network couldn't be read: what's open there isn't known. */
  unreadable?: boolean;
}

/** A token in a dApp transaction's summary; `quantity` is signed where it's a change. */
export interface DappToken {
  policyId: string;
  assetName: string;
  quantity: string;
}

/**
 * Another of the wallet's accounts a site's transaction pays or spends from,
 * or whose stake key it carries, which signing ties on chain to the one the
 * site sees (independent review M12): a public account by index
 * (`{ account }`), or a private session by index. A site on the public
 * account is never tied to its own.
 */
export type DappTie = { account: number } | number;

/** What a dApp's transaction does to the public account (WebAssembly's `inspectDappTx`). Lovelace amounts are decimal strings. */
export interface DappTxSummary {
  txHash: string;
  fee: string;
  /**
   * The account's change in ADA (signed) and each token that moved: what
   * comes back less what it puts in, its staking's included.
   */
  netLovelace: string;
  netTokens: DappToken[];
  /** What the account's UTxOs put in, and what its own outputs get back. */
  spentLovelace: string;
  returnedLovelace: string;
  /** What the account puts in from its staking: its rewards withdrawn, and its stake key's deposit back. */
  stakingLovelace: string;
  ownInputs: number;
  /** Outputs to anyone else. */
  paid: Array<{
    address: string;
    lovelace: string;
    tokens: DappToken[];
    datum: "hash" | "inline" | null;
    /** A script's address: a contract holds what it's paid. */
    script: boolean;
    /** Into Seedelf Wallet's contract: under a register, or with none (anyone could take it). */
    seedelf: "register" | "none" | null;
    /**
     * The account's payment key under a stake part that isn't its own, or
     * none: spendable by the account, but its stake counts for someone else,
     * so it's paid, not change.
     */
    ownPaymentKey: boolean;
    /**
     * Another of the wallet's accounts that can spend it, by its payment key, as the worker found it for a site's
     * prompt (`DappTie`): never by its stake key alone, which anyone can pair with their own payment key (C01).
     */
    yours?: DappTie;
  }>;
  ownOutputs: Array<{
    txIndex: number;
    address: string;
    role: number;
    index: number;
    lovelace: string;
    tokens: DappToken[];
    inlineDatum: string | null;
    datumHash: string | null;
  }>;
  /** Minted (positive) or burned. */
  mint: DappToken[];
  certificates: Array<{
    kind: string;
    own: boolean;
    /** The pool it stakes with, or a stake pool's own certificate's pool (`pool1…`). */
    pool: string | null;
    /** A stake pool's own certificate (kind "pool"): it registers the pool (or new terms), or retires it. */
    poolAction: "register" | "retire" | null;
    drep: string | null;
    deposit: string | null;
    refund: string | null;
    /** A DRep's own certificate (kind "drep"): it registers the DRep, updates it, or retires it. `own` when it's the account's DRep (CIP-95). */
    drepAction?: "register" | "update" | "retire" | null;
    /** A DRep certificate's profile address, as text (C14). */
    anchor?: string | null;
    /**
     * The stake key it's about, its hash in hex, for the kinds that name one (a registration, a stop, a delegation,
     * alone or together, and a stake pool's registration's reward account), the account's own or anyone's; none for a
     * script's, a pool's retirement, a DRep's or the committee's (WebAssembly's, X05; the last review, L1).
     */
    credential?: string | null;
    /**
     * Another of the wallet's accounts or sessions whose stake key it names, as the worker found it for a site's
     * prompt (`DappTie`): WebAssembly's `own` is the signing account's alone (1.5.0's release review, X05).
     */
    yours?: DappTie;
  }>;
  withdrawals: Array<{
    address: string;
    lovelace: string;
    own: boolean;
    /** Another of the wallet's accounts or sessions whose reward address it is, as for a certificate (X05). */
    yours?: DappTie;
  }>;
  collateral: { own: number; lovelace: string; total: string | null; returnedLovelace: string | null; atRisk: string } | null;
  scripts: boolean;
  referenceInputs: number;
  votes: number;
  /** Of `votes`, those cast by the account's own DRep (CIP-95). */
  ownVotes?: number;
  /** Each vote the account's own DRep casts: which action, and how (C14). */
  ownBallots?: Array<{ txHash: string; index: number; vote: "yes" | "no" | "abstain" }>;
  proposals: number;
  donation: string | null;
  /** CIP-20's message lines. */
  note: string[] | null;
  metadata: boolean;
  validFrom: number | null;
  validUntil: number | null;
  /** The account's keys that sign: `0/3`, `1/0`, `stake`, `drep` (CIP-95). */
  signs: string[];
  unknownInputs: string[];
  othersSign: number;
  complete: boolean;
}

// ---------------------------------------------------------------------------
// The transaction itself (WebAssembly's `decodeTx`, wasm/src/decode.rs)
// ---------------------------------------------------------------------------

/** An input, as the body names it: nothing in the transaction says what it holds. */
export interface TxOutpoint {
  txHash: string;
  /** A decimal string, as every number from the bytes is: see `TxDetail`. */
  index: string;
}

/** A token in a transaction's bytes. `quantity` is signed in a mint. */
export interface TxAsset {
  policyId: string;
  assetName: string;
  /**
   * The name's bytes as text, when they read as UTF-8, with anything invisible
   * escaped. The screens show a token by `ui/tokens.ts`'s name, not by this.
   */
  nameText: string | null;
  quantity: string;
}

/** An address as an output's bytes have it. */
export interface TxAddress {
  /** Bech32 (base58 for a Byron address), or the bytes in hex when they're no address. */
  bech32: string;
  hex: string;
  /** "unreadable": the bytes are no address — the CDDL allows any bytes there. */
  kind: "base" | "enterprise" | "pointer" | "reward" | "byron" | "unreadable";
  payment: "key" | "script" | null;
  stake: "key" | "script" | "pointer" | null;
  network: "mainnet" | "testnet" | "other" | null;
  /** Seedelf Wallet's own contract, on the network the wallet is on. */
  seedelf: boolean;
}

/** The register a Seedelf UTxO's datum holds. */
export interface TxRegister {
  generator: string;
  publicValue: string;
  /** Whether a payment under it could be spent: an identity point fails. */
  payable: boolean;
}

/**
 * Plutus data — a datum, or a redeemer's argument — as the tree it is. There is
 * no schema to read it against: a contract's datum means whatever that contract
 * says it means, so what the view can honestly show is its shape.
 *
 * It is the whole datum: nothing is counted off, however big or deep it is. The
 * screen collapses it and draws only what has been opened, which is what lets all
 * of it through (components/PlutusTree.tsx).
 *
 * `constructorIndex` is the constructor's number (the CBOR tag carries it). It
 * isn't called `constructor`: every object in JavaScript has one of those
 * already, so the field gone missing would read as a function rather than as
 * nothing.
 */
export type TxPlutus =
  | { type: "constr"; constructorIndex: string; fields: TxPlutus[] }
  | { type: "int"; value: string }
  | { type: "bytes"; hex: string; text: string | null }
  | { type: "list"; items: TxPlutus[] }
  | { type: "map"; entries: Array<{ key: TxPlutus; value: TxPlutus }> };

/** A script the transaction carries. */
export interface TxScript {
  kind: "native" | "plutusV1" | "plutusV2" | "plutusV3";
  hash: string;
  size: number;
  source: "output" | "witnesses" | "metadata";
}

/** One output, in body order. */
export interface TxOutput {
  index: number;
  address: TxAddress;
  lovelace: string;
  assets: TxAsset[];
  /** The datum written into the output, as it was written (hex). */
  inlineDatum: string | null;
  /** That datum as the tree it is, whatever contract it is for. */
  datum: TxPlutus | null;
  datumHash: string | null;
  /**
   * The register the datum holds, and only where `address.seedelf`: anyone's
   * datum can be constructor 0 with two 48-byte fields, and what makes one a
   * register is the contract that will read it.
   */
  register: TxRegister | null;
  scriptRef: TxScript | null;
  /** How it's written: the CDDL's `alonzo_transaction_output` list, or Babbage's map. */
  form: "legacy" | "postAlonzo";
  /**
   * Whose it is, where it pays the user (blind test §9.9, T18): worked out on the device by the worker
   * (background/tx-view.ts), never by WebAssembly from the bytes alone, and never asked of anyone. None for anyone
   * else's, and none at all while the wallet is locked.
   */
  yours?: TxYours;
}

/**
 * An output that pays the user: one of the wallet's public accounts (by index), the private balance (the wallet
 * contract under the user's own register), a Seedelf of the user's (the same, holding its token), or a private
 * session's one-time account (by index).
 */
export type TxYours =
  | { kind: "account"; account: number }
  | { kind: "private" }
  | { kind: "seedelf" }
  | { kind: "session"; index: number };

export interface TxCredential {
  kind: "key" | "script";
  hash: string;
}

/** A link to off-chain text, with the hash that pins it. */
export interface TxAnchor {
  url: string;
  contentHash: string;
}

/** A governance action, by the transaction that made it. */
export interface TxActionId {
  txHash: string;
  index: number;
}

/** A certificate: `kind` says which, and each kind carries its own fields. */
export type TxCert = { kind: string } & Partial<{
  credential: TxCredential;
  pool: string;
  drep: string;
  deposit: string;
  refund: string;
  epoch: string;
  vrfKeyHash: string;
  pledge: string;
  cost: string;
  margin: string;
  rewardAccount: string;
  owners: string[];
  relays: string[];
  metadata: TxAnchor | null;
  cold: TxCredential;
  hot: TxCredential;
  anchor: TxAnchor | null;
}>;

export interface TxWithdrawal {
  /** The reward address in bech32, or its bytes in hex when they're no address. */
  address: string;
  lovelace: string;
}

/** One vote on one governance action. */
export interface TxVote {
  voter: "committee" | "drep" | "pool";
  credential: TxCredential;
  action: TxActionId;
  vote: "yes" | "no" | "abstain";
  anchor: TxAnchor | null;
}

/** A governance proposal. */
export interface TxProposal {
  deposit: string;
  rewardAccount: string;
  action: string;
  follows: TxActionId | null;
  /** A parameter change's parameters, by the ledger's numbering, each as raw CBOR. */
  parameters: TxUnknown[];
  withdrawals: TxWithdrawal[];
  script: string | null;
  version: string | null;
  anchor: TxAnchor;
}

/** A redeemer: which script run, its argument, and the budget claimed. */
export interface TxRedeemer {
  /** "spend", "mint", "cert", "reward", "vote", "propose", or a number the wallet doesn't know. */
  tag: string;
  /** Which input, policy, certificate, withdrawal, vote or proposal. */
  index: string;
  /** The argument, as written (hex). */
  data: string;
  /** That argument as the tree it is. */
  argument: TxPlutus | null;
  /** The budget claimed, each `0 .. 2^63-1` in the CDDL, so decimal strings. */
  mem: string;
  steps: string;
}

/** A datum in the witness set, named by an output's `datumHash`. */
export interface TxDatum {
  hash: string;
  hex: string;
  /**
   * The data as the tree it is, and nothing more: a datum in the witness set
   * belongs to whichever output names its hash, which could be any contract at
   * all, so nothing here is read as a register or as anything else of one
   * contract's.
   */
  data: TxPlutus;
}

/** A signature already in the witness set. */
export interface TxSignature {
  publicKey: string;
  keyHash: string;
}

/** A metadatum, as the tree it is. */
export type TxMetadatum =
  | { type: "int"; value: string }
  | { type: "bytes"; hex: string; text: string | null }
  /** Whatever was written, with anything invisible escaped as `\u{...}`. */
  | { type: "text"; text: string }
  | { type: "list"; items: TxMetadatum[] }
  | { type: "map"; entries: Array<{ key: TxMetadatum; value: TxMetadatum }> };

/** One label of the metadata. The label is a decimal string: labels go past what JSON holds exactly. */
export interface TxMetadata {
  label: string;
  value: TxMetadatum;
}

/** Something in the bytes the wallet has no name for, rather than dropped. */
export interface TxUnknown {
  at: string;
  field: string;
  hex: string;
}

/**
 * Everything in a transaction's bytes, field by field (WebAssembly's
 * `decodeTx`, wasm/src/decode.rs, which has the reasons).
 *
 * **Every number the bytes decide is a decimal string**, not only the lovelace
 * ones: Conway's CDDL makes `coin`, `slot`, `epoch` and `ex_units` `uint` up to
 * 2^64-1, and `JSON.parse` rounds past 2^53, so a ttl of 2^60 would show as a
 * different number. Only counts the decoder works out itself — the size, an
 * output's position, how many witnesses — are numbers.
 *
 * **Text is whatever was written, with anything invisible escaped** as
 * `\u{...}`: a right-to-left override would otherwise rewrite the line it's on.
 */
export interface TxDetail {
  txHash: string;
  /** The whole transaction in bytes, and its body alone. */
  size: number;
  bodySize: number;
  networkId: number | null;
  /** False means it's meant to fail its scripts, and the collateral is taken. */
  valid: boolean;
  /** Whether the witness set holds anything at all; `signatures` says if anything signed it. */
  witnessed: boolean;
  inputs: TxOutpoint[];
  referenceInputs: TxOutpoint[];
  collateral: TxOutpoint[];
  outputs: TxOutput[];
  collateralReturn: TxOutput | null;
  totalCollateral: string | null;
  fee: string;
  /** The slots it's valid between, as decimal strings. */
  validFrom: string | null;
  validUntil: string | null;
  /** Minted (positive) or burned. */
  mint: TxAsset[];
  certificates: TxCert[];
  withdrawals: TxWithdrawal[];
  votes: TxVote[];
  proposals: TxProposal[];
  requiredSigners: string[];
  scriptDataHash: string | null;
  auxiliaryDataHash: string | null;
  /**
   * Whether the body's metadata hash is the hash of the metadata here; null
   * when it carries neither. False means the network would refuse it, and that
   * the metadata shown isn't what this transaction commits to.
   */
  metadataHashMatches: boolean | null;
  treasuryValue: string | null;
  donation: string | null;
  redeemers: TxRedeemer[];
  scripts: TxScript[];
  datums: TxDatum[];
  signatures: TxSignature[];
  bootstrapWitnesses: number;
  metadata: TxMetadata[];
  /** CIP-20's message (label 674), when there is one. */
  note: string[] | null;
  unknown: TxUnknown[];
}

/** A transaction the view can open, and the raw bytes it was read from. */
export interface TxView {
  detail: TxDetail;
  /** The transaction's CBOR, hex: the Raw CBOR tab, and a copy button. */
  cbor: string;
  /**
   * Found where a chain through Lovejoin is sent from (tx-view.ts
   * `chainKeys`): one being sent, or stopped partway, whose transactions the
   * wallet sends one after another with no confirm of their own. Its
   * signatures were made as the chain was prepared, and Transaction details
   * says so, never that it waits for a confirm (1.3.0's release review, C17).
   */
  chain?: true;
}

/**
 * What a site asks the user for. A signature's `password`: Sign needs the
 * password typed too (the `dappPassword` setting). Its `session`: the site is
 * connected to that private session, not the public account. A connect's
 * `funding`: the private session it chose is funded and on its way, and the
 * site connects once Koios sees it. `password` on a connect: sending a
 * private session's funding needs it. A session's signature's
 * `collateralSpent`: it spends the session's collateral as an ordinary input.
 */
export type DappAsk =
  | {
      kind: "connect";
      password: boolean;
      funding?: { index: number; txHash: string };
      /** It asks for governance too (CIP-95): the public account's DRep key, to register and vote with. */
      governance?: boolean;
      /** Connected already: it asks for governance alone. */
      connected?: boolean;
      /**
       * How long Decline, or closing the window, turns the site away: 10 s,
       * then a minute, then five for declines in a row (dapp.ts `REFUSE_MS`).
       * The window says it before either is done (blind test §9.2, T17).
       * Not for a site connected already, which a no leaves connected.
       */
      declineWaitMs?: number;
    }
  | {
      kind: "sign-tx";
      partial: boolean;
      summary: DappTxSummary;
      password: boolean;
      session?: number;
      collateralSpent?: boolean;
      /**
       * The wallet's other accounts it pays or spends from (`DappTie`), at
       * an address one of the wallet's keys spends: public accounts first,
       * then private sessions. Empty when none; missing when they couldn't
       * be checked (independent review M12).
       */
      ties?: DappTie[];
      /**
       * Those whose stake key alone is in it, at someone else's address or a
       * contract's, paid or spent from: not their money, but signing ties
       * them on chain all the same (1.5.0's release review, C01). Public
       * accounts first, as `ties`; missing with it.
       */
      staked?: DappTie[];
      /**
       * Those whose stake key a certificate or a withdrawal in it names: an
       * old-style registration of one needs no signature of that key's, and
       * signing ties them on chain all the same (1.5.0's release review,
       * X05). Public accounts first, as `ties`; missing with it.
       */
      certified?: DappTie[];
    }
  | {
      kind: "sign-data";
      session?: number;
      /** Bech32; the DRep's ID when it's the DRep key (CIP-95). */
      address: string;
      key: "payment" | "stake" | "drep";
      payload: string;
      /** The payload as text, when it reads as UTF-8. */
      text?: string;
      password: boolean;
    };

/** Something a site asked for that waits for the user, in the connector's window. */
export type DappApproval = { id: string; origin: string; title?: string } & DappAsk;

/**
 * A site connected to the wallet's **dApp account** (`Preferences.dappAccount`,
 * chunk 18) or to a private session. No account is recorded per site: every
 * public-account connection is to the one dApp account, which Settings
 * chooses and which does not follow the account picker.
 */
export interface DappSite {
  origin: string;
  connectedAt: number;
  /** Its page's title as it asked to connect: the site's own words, so shown after its address (blind test E03). */
  title?: string;
  /** Connected to this private session (private CIP-30), not a public account. */
  session?: number;
  /** Given governance (CIP-95, chunk 21): the dApp account's DRep key. Never with `session`. */
  cip95?: true;
  /** It asked for governance and the user said no: it isn't asked again until it connects anew. */
  cip95Declined?: true;
}

/**
 * A site the user declined, or closed the window on, turned away unasked
 * until `until` (the worker's clock, ms): the dApps page and Connected sites
 * list it, with Let it ask now (blind test §9.2, T17r). `retried`: it asked
 * again meanwhile, and was turned away.
 */
export interface DappDeclined {
  origin: string;
  until: number;
  title?: string;
  retried?: true;
}

/** "lovelace", or a token's policy ID and name in hex, run together (Minswap's form). */
export type SwapTokenId = string;

/** A swap as asked: `amount` in the input's smallest unit; `slippage` in percent. */
export interface SwapAsk {
  amount: string;
  tokenIn: SwapTokenId;
  tokenOut: SwapTokenId;
  slippage: number;
}

/** How one side of a swap is shown: a token's ticker or name, and its decimals. */
export interface SwapSide {
  label: string;
  decimals: number;
}

/** A token Minswap can swap, from its list. */
export interface SwapTokenInfo {
  id: SwapTokenId;
  ticker: string | null;
  name: string | null;
  decimals: number;
  verified: boolean;
}

/** Minswap's quote for a swap, and what a private session for it is funded with. Amounts are decimal strings in smallest units. */
export interface SwapQuote {
  network: NetworkName;
  ask: SwapAsk;
  amountIn: string;
  amountOut: string;
  /** Less than this and the order is refunded: the slippage allowed. */
  minAmountOut: string;
  /** The DEXes' batcher fees, in lovelace. */
  dexFee: string;
  /** ADA the orders lock and pay back with the proceeds. */
  deposits: string;
  aggregatorFee: string;
  /** Percent. */
  priceImpact: number;
  /** The DEXes it routes through, e.g. ["MinswapV2", "SundaeSwapV3"]. */
  route: string[];
  /** It swaps against a DEX's pools (Danogo's), with no order: filled in the swap itself (chunk 24). */
  againstPools?: boolean;
  /** Moved from the private balance to the session's account: the swap and its costs, with room for the swap's fee and change. */
  fund: { lovelace: string; tokens: TokenQuantity[] };
  /** Also moved: the account's own collateral, in lovelace. It comes back with the rest. */
  collateral: string;
  /**
   * Whether the token it gets is one the wallet swaps into: ADA, one on the
   * wallet's own list, or one Minswap's verified list has, by its ID. Anyone
   * can name a token like a known one: false, and the wallet won't fund it.
   */
  verified?: boolean;
  /** Where Lovejoin is on, what bringing the session back through it is expected to take. */
  lovejoin?: SwapLovejoin;
}

/**
 * What bringing a swap's session back through Lovejoin is expected to take
 * (Settings, Lovejoin): the 10 ₳ boxes its spare ADA pays for, the
 * proceeds' too when they're ADA, at most (the pool may take fewer, or
 * none); their `mixes` at `depth`, about `mixFees` all together; and about
 * `withdrawFees` for them all to come back, each after a wait in `delay`
 * (hours, "1-6"). Amounts in lovelace. No boxes: it all comes back at once.
 */
export interface SwapLovejoin {
  boxes: number;
  depth: number;
  mixes: number;
  mixFees: string;
  withdrawFees: string;
  delay: string;
  /**
   * Whether Settings brings private sessions back through Lovejoin: the
   * approval's switch starts there, and what it approves is kept (privacy
   * review §4.1).
   */
  on: boolean;
  /**
   * Read at Review, from Lovejoin's pool (privacy review §2.7): the boxes the
   * spare ADA pays for, when the pool has room for fewer (`boxes`).
   */
  of?: number;
  /**
   * Read at Review: why the pool takes no box now (under its floor, or too
   * few boxes to mix with), so the return would come back directly. It's
   * read again when the session comes back.
   */
  skipped?: string;
  /**
   * If the swap is stopped, or Minswap refunds or cancels its order, its
   * funding's ADA comes back instead of the proceeds: what that takes
   * through Lovejoin, when it's more boxes than the fill's (an ADA→token
   * swap's principal, privacy review §2.8).
   */
  ifStopped?: { boxes: number; mixes: number; mixFees: string; withdrawFees: string; of?: number; width?: number; fellBack?: string };
  /**
   * The token it gets, through a pool of it (chunk 34's 34e), when it buys one a shown pool takes: as many boxes as
   * the least it asks for makes, in the pool chosen (Change picks another of `pools`, or none). Its boxes' own ADA
   * and their mixes' fees are funded too (`fund`): the boxes' ADA comes back with each box, the fees don't.
   */
  ways?: Array<LovejoinTokenWay & { mixes: number; mixFees: string; withdrawFees: string }>;
  /** What the funding adds for `ways`' boxes, in lovelace, beside what the swap itself takes (`fund`). */
  fund?: string;
  /** Four boxes a mix (chunk 34's D3); none: three. Its approval keeps it, and its return goes no wider. */
  width?: number;
  /** Four was asked, and it goes three: why (34e's review, 5). */
  fellBack?: string;
  /** What a box holds in each pool `ways` names, by its id, so the approval can name them (34f). */
  values?: Record<string, LovejoinBoxValue>;
}

/** What every box in a pool holds: ADA, and a token pool's token. Amounts in raw units. */
export interface LovejoinBoxValue {
  lovelace: string;
  token?: TokenQuantity;
}

/** A transaction the wallet built or signed for a session. `confirmed` once the chain has it. */
export interface SessionTx {
  kind: "out" | "swap" | "cancel" | "back" | "deposit" | "mix";
  txHash: string;
  at: number;
  confirmed?: boolean;
}

/** Why a swap that runs itself waits for the user. */
export type SessionPause =
  /** The fresh quote expects `amountOut`, less than the least the user approved: the order couldn't fill. */
  | { at: number; why: "price"; amountOut: string }
  /** What Minswap built, or the wallet's own cancel after Stop, failed a check (`detail` says which), so the wallet didn't sign it. */
  | { at: number; why: "refused"; detail: string };

/**
 * Why a swap's step failed, as a code the page words (Swaps.tsx): Minswap or
 * Koios asked the wallet to slow down, or didn't answer, or Minswap hasn't
 * seen the funding yet. `other` for anything else, whose own words the page
 * shows. The worker tells it from what failed (sessions.ts retryReasonOf),
 * never from the message, which is in the language the worker had then.
 */
export type RetryReason =
  | "minswap-rate-limited"
  | "koios-rate-limited"
  | "minswap-silent"
  | "koios-silent"
  | "funding-unseen"
  | "other";

/** A swap that runs itself, after one approval: where it's at, for its timeline. */
export interface SessionAuto {
  /** Each step waits for the one before: the funding, the order, its fill (or cancel), the return. */
  step: "funding" | "ordering" | "filling" | "cancelling" | "returning" | "done";
  paused?: SessionPause;
  /**
   * The last step failed (Koios or Minswap didn't answer): it's tried again
   * at `at`. `reason`: why, as a code; none on a retry recorded before the
   * codes, whose `error` is English, the one language the worker wrote then.
   */
  retry?: { at: number; error: string; reason?: RetryReason };
  /**
   * The user pressed Stop: any order is cancelled, then everything comes
   * back. A swap against a DEX's pools that went out first has no order to
   * cancel: it lands as it is or not at all, then everything comes back.
   */
  stopping: boolean;
  /** The order was filled: `partly`, part of it (a split route), the rest refunded. */
  filled: boolean;
  partly?: boolean;
  /** The order was refunded, none of it filled: what it gave came back (independent review M18). */
  refunded?: boolean;
  /**
   * Stopped, but an order of the swap is still open at a DEX, and Koios
   * can't find it yet, so the wallet can't cancel it yet: when the runner
   * first found it so (ms). What's left waits at the account until that
   * order is filled or refunded, or found and cancelled (independent review
   * L16, chunk 24 Step 3).
   */
  orderOpen?: number;
  /** The least the user approved receiving. */
  approvedMinOut: string;
  /** Its swap went against a DEX's pools (Danogo's), with no order: filled in the swap itself (chunk 24). */
  againstPools?: boolean;
  /**
   * Approved against a DEX's pools, and no swap sent yet: words alone, the
   * timeline's for a swap the runner places against the pools or not at
   * all (release review C09, C13). Never what Stop reads: Stop stays until
   * the swap goes out (`againstPools`).
   */
  approvedPools?: boolean;
  /**
   * The least the order placed asks for, once one is: Review it myself, or
   * a fresh quote above the approved least, asks for other than was
   * approved (independent review L24).
   */
  placedMinOut?: string;
  /**
   * Its next step, found as the wallet unlocked, waits until then (ms), so
   * it doesn't go out the moment the wallet unlocks (privacy review §3.1).
   */
  waitsUntil?: number;
  /**
   * How it comes back, as the user approved it or chose at Stop (privacy
   * review §4.1): true, directly; false, through Lovejoin. None on a swap
   * from before: as Settings has it.
   */
  direct?: boolean;
}

/**
 * A private session: a one-time account (account 24301', key 0/index) funded
 * from the private balance, used for a swap, and brought back into it.
 * `failed`: its funding never reached the chain.
 */
export interface SessionView {
  index: number;
  network: NetworkName;
  address: string;
  createdAt: number;
  stage: "funding" | "open" | "returning" | "closed" | "failed";
  txs: SessionTx[];
  /** The swap it's for, as last quoted, and how its two sides are shown. */
  swap?: SwapAsk & { amountOut: string; minAmountOut: string; display?: { in: SwapSide; out: SwapSide } };
  /** What its account holds, from Koios; null when it wasn't read. */
  holding: { lovelace: string; tokens: TokenQuantity[]; utxos: number } | null;
  /** Set when the swap runs itself; a session from before (every step a button) has none. */
  auto?: SessionAuto;
  /** A site's private session (private CIP-30): the site it's connected to, rather than a swap. */
  site?: { origin: string };
  /**
   * A mix from the Lovejoin tile, rather than a swap: the boxes it puts
   * through Lovejoin once funded, then everything else comes back. `again`:
   * the wallet's boxes in the pool mixed again, with no deposit. `skipped`:
   * why Lovejoin was left out, when it was.
   */
  mix?: { boxes: number; again?: boolean; skipped?: string; bootstrap?: boolean; pool?: string };
  /**
   * A return through Lovejoin: its chain's transactions (the return last),
   * how many are sent and how many are on chain, as the runner last read
   * them, and `cut`: it stopped partway, and what was left came back
   * directly. `stopped`: why a transaction of it couldn't be sent.
   */
  chain?: { total: number; sent: number; confirmed: number; cut: boolean; stopped?: string };
  /**
   * Why its latest return came back directly, leaving Lovejoin out, though
   * its spare ADA would have paid for a box: a swap that runs itself says so
   * here (a mix, in `mix.skipped`).
   */
  lovejoinSkipped?: string;
  /**
   * What's at its account that no return takes, as the last reading found
   * it: it stays there, and doesn't hold the session open. `holding` leaves
   * it out.
   */
  leftBehind?: LeftBehindUtxo[];
  /**
   * With stage `failed`: its funding was turned away when it was sent, so it
   * never went out. Without it, a failed funding is one the chain hasn't
   * shown in 20 minutes (Koios didn't answer its submit, or it's slow), which
   * may still land: Try again looks for it again.
   */
  unsent?: boolean;
  /** With `unsent`: why it was turned away, when that's known (chunk 23's second review, DX-5). */
  unsentWhy?: UnsentWhy;
  /**
   * Once it's over: what its last return brought back at once, as that
   * return's review said (a chain's boxes come back later). None on a
   * session from before it was kept (DX-5).
   */
  received?: { lovelace: string; tokens: TokenQuantity[] };
  /**
   * Found by the restore scan (O5, chunk 27): a one-time account this
   * phrase used that the device had no record of. What it was for isn't
   * known, so it has no swap, site or mix, and it's brought back by hand.
   */
  recovered?: true;
  /**
   * Found by the restore scan, with nothing sent for it from this device,
   * and waiting to end by itself: a refresh found its order over and nothing
   * at its account a return takes. It ends at a refresh once that has held
   * 15 minutes, unless something comes in first, which a refresh can read
   * late and Bring it back takes (cross-area review X01). Its page says so,
   * rather than to bring it back, and Home's restore note doesn't count it
   * (the last review, L4).
   */
  settling?: true;
  /**
   * A session brought back by hand whose account, as last read, holds no
   * UTxO of ADA alone of 5 ₳ or more for a cancel's collateral: `missing`,
   * or `coming` while a top-up is on its way. While an order of it is open,
   * its page offers 5 ₳ from the private balance for the cancel
   * (`session-cancel-collateral-build`, sent as a top-up is). None while a
   * cancel of it is on its way (`cancelling`).
   */
  cancelCollateral?: "missing" | "coming";
  /**
   * A session brought back by hand with a cancel of its order sent and not
   * on chain yet: the order reads open until it lands, and what it spends,
   * 5 ₳ put in for it among them, as gone. No 5 ₳ goes in meanwhile, and its
   * page says the cancel is on its way (1.5.0's release review, C04).
   */
  cancelling?: true;
  /**
   * A session brought back by hand whose return would go through Lovejoin
   * but for the collateral its mixes put up: its account, as last read,
   * holds no UTxO of exactly 5 ₳ of ADA alone, and its spare ADA pays for a
   * box, as the return itself decides it. `missing`, or `coming` while a
   * top-up is on its way. While no order of it waits, its page offers 5 ₳
   * from the private balance for it (`session-back-collateral-build`, sent
   * as a top-up is; 1.5.0's release review, C53).
   */
  backCollateral?: "missing" | "coming";
}

/** What the restore scan found on a network (`session-scan`). */
export interface SessionScan {
  /** The one-time accounts the chain shows this phrase used. */
  used: number;
  /** The sessions it added, by index: each holds something, or has an order open. */
  found: number[];
}

/**
 * Why a session's funding was turned away, as a code the page words:
 * `changed`, something it spends changed since the review; `unreachable`,
 * the collateral service couldn't be reached; `refused`, it answered and
 * didn't lend its collateral, with nothing the device knows of spent (blind
 * test §9.5); `givemeBusy`, it answered with an outage or a limit; `busy`,
 * the network turned it away for now; `network`, the network refused it.
 */
export type UnsentWhy = "changed" | "unreachable" | "refused" | "givemeBusy" | "busy" | "network";

/**
 * A UTxO at a session's account that no return of the wallet's takes:
 * `script`, it holds a reference script the wallet can't measure, so it
 * can't price spending it; `fee`, it doesn't pay for its own way back into
 * the private balance: a stranger's tokens whose own ADA doesn't cover their
 * deposit, or what's left there, all together, too little. A `fee` one is
 * tried again with the rest when more arrives. Its `lovelace`, as it was
 * found.
 */
export interface LeftBehindUtxo {
  txHash: string;
  txIndex: number;
  reason: "script" | "fee";
  lovelace: string;
}

/** A funding payment into a new session, built and waiting for Send. */
export interface SessionOutSummary extends WithdrawSummary {
  index: number;
  address: string;
}

/** A swap Minswap built for a session, or the wallet's own cancel of its orders, read by WebAssembly and waiting for Send. */
export interface SessionTxReview {
  network: NetworkName;
  index: number;
  kind: "swap" | "cancel";
  txHash: string;
  summary: DappTxSummary;
  /** A swap's fresh quote. */
  quote?: SwapQuote;
  /** A cancel's orders. */
  orders?: number;
  /**
   * A swap built against a DEX's pools (Danogo, chunk 24), read from the
   * transaction itself: no order, no fill to wait for and no Stop once sent.
   * Its outputs at the pools' script hold the pools' own reserves.
   */
  againstPools?: boolean;
}

/** Bringing a session back into the private balance, built and signed, waiting for Send. Amounts in lovelace. */
export interface SessionBackSummary {
  network: NetworkName;
  index: number;
  txHash: string;
  fee: string;
  lovelace: string;
  tokens: TokenQuantity[];
  depositOutputs: number;
  inputs: number;
  /**
   * How many of the Seedelf UTxOs the session's funding made (its change)
   * the return merges into: what comes back joins them rather than making
   * new ones. 0 when they've been spent.
   */
  merged?: number;
  /**
   * When the spare ADA goes through Lovejoin first: its boxes (10 ₳ each),
   * the fan-out, and every fee of the chain. `lovelace` is then what comes
   * back at once; each box comes back later, after a random wait in `delay`
   * (hours, "1-6").
   */
  lovejoin?: {
    boxes: number;
    depth: number;
    mixes: number;
    fees: string;
    txs: number;
    delay: string;
    again?: boolean;
    /** A Bootstrap's deposit, its boxes held in the pool until brought back by hand (chunk 34). */
    bootstrap?: boolean;
    /** The token pool its boxes go into, by its id; none for the classic pool. */
    pool?: string;
    /**
     * Across pools (chunk 34's 34e): each pool's boxes, the classic pool's with no `pool`. `boxes` is their sum, and
     * `pool` none.
     */
    parts?: Array<{ pool?: string; boxes: number }>;
    /** Its tokens, and what becomes of each: the pool each goes into, or why it comes back directly. */
    ways?: LovejoinTokenWay[];
    /** Four boxes a mix (chunk 34's D3); none: three. */
    width?: number;
    /** Four was asked, and it goes three: why. */
    fellBack?: string;
    /** What a box holds in each token pool `parts` and `ways` name, by its id, so the review can name them (34f). */
    values?: Record<string, LovejoinBoxValue>;
    /**
     * The chain's first transaction: the deposit, or the first mix where its own
     * boxes are mixed again. `txHash` is the return, the last of the chain; this
     * is the one the review shows, where the session's money goes in.
     */
    entry: string;
  };
  /**
   * Why the spare ADA doesn't go through Lovejoin this time, though it would
   * pay for a box: the network measured its scripts differently from the
   * wallet, so the chain doesn't start, and it all comes back directly.
   */
  lovejoinSkipped?: string;
  /** The session's UTxOs this return leaves at its account, and why. */
  leftOut?: LeftOutUtxo[];
}

/**
 * A UTxO a transaction that takes everything leaves where it is, and why:
 * `tokens`, one of its tokens would total more with the rest than an output
 * can hold, so a later transaction takes it; `script`, it holds a reference
 * script the wallet can't measure, so it can't price spending it, and no
 * transaction of this wallet takes it; `returning`, a return through
 * Lovejoin that's still being sent spends it (a private one, Make public's
 * Max). A session's return only (independent review H1, H2): `cost`, a
 * stranger's token UTxO whose own ADA doesn't pay for the deposit its
 * tokens need, so it stays (and is left behind); `size`, one transaction
 * can't hold it with the rest, so the next return takes it.
 */
export interface LeftOutUtxo {
  txHash: string;
  txIndex: number;
  reason: "tokens" | "script" | "returning" | "cost" | "size";
}

/**
 * A token's way back through Lovejoin on a return (chunk 34's 34e): the token pool it goes into, as many whole boxes
 * as the return holds of it and pays for, or none. `pools`: its pools that can take a box now, the most used first,
 * for Change. A session's return reviews it; a swap's approval keeps the pool chosen.
 */
export interface LovejoinTokenWay {
  policyId: string;
  assetName: string;
  /** The pool it goes into, by its id; none when it comes back directly. */
  pool?: string;
  /** Its boxes there (none until a chain is built: a swap's review says how many it's funded for). */
  boxes: number;
  /** How much of it each box holds, in that pool. */
  quantity?: string;
  /** The user chose to have it come back directly (Change, then none). */
  direct?: true;
  pools: string[];
  /** Why it comes back directly though a pool was meant to take it: none of its pools can take a box now, or not the one chosen. */
  skipped?: string;
  /**
   * The pool chosen for it can't have its boxes pay their own way back today: they wait there until the fees allow, or
   * come back by Bring one back. Chosen as any pool, and said (the owner's call 34, 2026-10-19).
   */
  stuck?: true;
}

/** What mixing a number of boxes takes, before anything is built. Amounts in lovelace. */
export interface LovejoinFunding {
  boxes: number;
  /** A seed: the deposit alone, no mixes, so it draws nothing from the pool. Only a session from before Bootstrap (chunk 34). */
  seed?: boolean;
  /**
   * Bootstrap (chunk 34's session 1, 6 and 18): the deposit alone, no mixes, whose boxes stay in the pool for other
   * people to mix with until the user brings them back by hand. It replaces the seed.
   */
  bootstrap?: boolean;
  /** The token pool it goes into, by its id; none for the classic pool. */
  pool?: string;
  /** A token pool's: how much of its token the boxes take, which goes with the ADA. */
  token?: TokenQuantity;
  /** The wallet's boxes in the pool, mixed again: no deposit, and no box to pay for. */
  again?: boolean;
  /** Mixing again: how many boxes the wallet has in the pool (`boxes` is how many go this time). */
  owned?: number;
  /**
   * Mixing again from the private balance takes the boxes a mix from the
   * public account put in too: the user asked, knowing it ties the private
   * balance to the account (privacy review §2.10).
   */
  publicToo?: boolean;
  /** What pays for the boxes, every mix, and the deposit and its change: what the mixes don't use comes back. */
  lovelace: string;
  mixes: number;
  /** About what the mixes cost, all together. */
  mixFees: string;
  depth: number;
  /** Each box's wait before it comes back, in hours ("1-6"). */
  delay: string;
  /** Four boxes a mix (chunk 34's D3); none: three. */
  width?: number;
  /** Four was asked, and it goes three: why. */
  fellBack?: string;
}

/** A mix from the public account, built and signed, waiting for Send. Amounts in lovelace. */
export interface LovejoinPublicSummary {
  /** A seed: the deposit alone, no mixes, so it hides nothing of its own. Never built since Bootstrap (chunk 34). */
  seed?: boolean;
  /** Bootstrap: the deposit alone, its boxes held in the pool until brought back by hand (LovejoinFunding `bootstrap`). */
  bootstrap?: boolean;
  /** The token pool it goes into, by its id; none for the classic pool. */
  pool?: string;
  /** A token pool's: how much of its token the deposit takes from the account. */
  token?: TokenQuantity;
  network: NetworkName;
  /** The last mix's: Send names it, and Home's banner watches it. */
  txHash: string;
  /**
   * The chain's first transaction: the deposit, or, mixing its own boxes again,
   * the first mix. The one the review shows — it's where the account's money
   * goes in, and the rest of the chain only moves what it put there (the owner,
   * 2026-10-01).
   */
  entry: string;
  boxes: number;
  depth: number;
  delay: string;
  mixes: number;
  txs: number;
  /** Every fee of the chain. */
  fees: string;
  /** What stays in the public account after the last mix. */
  change: string;
  /** Its own boxes a mix from it put in, mixed again: no deposit (privacy review §2.10). */
  again?: boolean;
  /** Four boxes a mix (chunk 34's D3); none: three. */
  width?: number;
  /** Four was asked, and it goes three: why. */
  fellBack?: string;
}

/** The wallet's boxes in Lovejoin's pool, and when each is due back (ms). */
export interface LovejoinStatus {
  /** Real boxes in the pool that aren't this wallet's: what the floor counts. */
  others: number;
  /**
   * Of `others`, those no chain of the wallet's will spend: what a new mix
   * draws from, so the page says before Review whether one fits (chunk 23's
   * second review, LJ-1). None from a worker before it was counted.
   */
  free?: number;
  /** The fewest others the wallet mixes with on this network; 0 where there's no floor. */
  floor: number;
  available: boolean;
  boxes: Array<{ txHash: string; txIndex: number }>;
  lovelace: string;
  due: number[];
  /**
   * Its boxes a chain of its own made and didn't finish mixing (a chain cut
   * by a lock, a closed browser or a failed send), or, after a restore, that
   * a deposit made, as Koios said: they never come back by themselves, since
   * each still shows where it went in. Mix my boxes again takes them first;
   * bringing one back takes `anyway`.
   */
  notMixed: Array<{ txHash: string; txIndex: number }>;
  /**
   * Of `notMixed`, listed last: boxes after a restore, with no record of the
   * chain that made them, whose making Koios hasn't said of yet. Held until
   * it does, as a deposit's are: the wallet asks again at a later pool read
   * (independent review M14).
   */
  unsure?: Array<{ txHash: string; txIndex: number }>;
  /**
   * Of `notMixed`: boxes after a restore, with no record of the chain that
   * made them, that Koios said a deposit made. Whose deposit it was, and why
   * no mix followed it, the wallet can't know, so they're never said to be
   * the user's deposit or a stopped chain's (independent review M14).
   */
  deposits?: Array<{ txHash: string; txIndex: number }>;
  /**
   * Its boxes a mix from any of its public accounts put where they are: that
   * account's, which paid for it in the open. Mixed again, that account pays,
   * or the private balance ties itself to it (privacy review §2.10).
   */
  fromPublic: Array<{ txHash: string; txIndex: number }>;
  /**
   * Of `fromPublic`, those a mix from a public account other than the active
   * one put in, and which account (its index): that account mixes them again.
   * Paid from this one, they'd tie the two accounts together.
   */
  otherAccounts?: Array<{ txHash: string; txIndex: number; account: number }>;
  /**
   * Of `boxes`, those a Bootstrap holds (chunk 34): they never come back by
   * themselves, and come back by hand. The classic pool's; each token pool's
   * in its own `pools` entry.
   */
  bootstrap?: Array<{ txHash: string; txIndex: number }>;
  /** Its chains that aren't all sent: being sent (no withdraw meanwhile), or stopped partway. */
  chains: LovejoinChainView[];
  /**
   * Every token pool the wallet reads, beside the classic pool, whose figures
   * are the fields above (chunk 34): each one's own. None while the wallet
   * reads the classic pool alone.
   */
  pools?: LovejoinPoolStatus[];
  /** The classic pool's crowd, as the data layer last counted it (chunk 34's 34c); none on Koios. */
  crowd?: LovejoinCrowd;
  /**
   * Pools this wallet started that no look has found yet (chunk 34's 34d): the hub says each shows once found. The
   * device's own record, no request.
   */
  started?: Array<{ id: string; txHash: string; at: number }>;
}

/**
 * A pool's crowd as the data layer counts it (chunk 34's session 1, 16, and 34c, 31): its boxes, everyone's; the
 * deposits they could have come from, worked back through each mix; and how many of them a mix made.
 */
export interface LovejoinCrowd {
  boxes: number;
  deposits: number;
  mixed: number;
}

/** A token pool, as the wallet read it (chunk 34): the fields LovejoinStatus has for the classic pool, its own. */
export interface LovejoinPoolStatus {
  /** Its NFT's policy: the pool's id. */
  id: string;
  /** What every box holds. */
  box: { lovelace: string; token?: TokenQuantity };
  others: number;
  free: number;
  floor: number;
  /** The wallet's boxes in it, each named by the pool. */
  boxes: Array<{ txHash: string; txIndex: number; pool?: string }>;
  /** Their ADA, and their token. */
  lovelace: string;
  token?: TokenQuantity;
  due: number[];
  notMixed: Array<{ txHash: string; txIndex: number; pool?: string }>;
  unsure?: Array<{ txHash: string; txIndex: number; pool?: string }>;
  deposits?: Array<{ txHash: string; txIndex: number; pool?: string }>;
  fromPublic: Array<{ txHash: string; txIndex: number; pool?: string }>;
  otherAccounts?: Array<{ txHash: string; txIndex: number; pool?: string; account: number }>;
  bootstrap?: Array<{ txHash: string; txIndex: number; pool?: string }>;
  /**
   * A box of it can't pay its own way back under today's parameters (chunk 34's escape hatch): what's left after
   * the withdraw's fee, and what the Seedelf output needs. Said whether or not the wallet has boxes there: a new box
   * still goes in, with this said first (the owner's call 34). Its boxes don't come back by themselves meanwhile;
   * Bring one back, paid from the private balance or the public account, does (`lovejoin-withdraw-now`'s `paid`).
   */
  cantComeBack?: { has: string; needs: string };
  /**
   * It takes no new box under today's parameters, and why (chunk 34's §2, usable): a mix, a Bootstrap and mixing again
   * into it are refused, from either side, whether or not the wallet has boxes there. Measured once an epoch (1.6.0's
   * release review, MONEY-3; since the owner's call 34, only a box below the network's minimum, or a copy).
   */
  unusable?: LovejoinUnusable;
  /** Its crowd, as the data layer last counted it; none on Koios. */
  crowd?: LovejoinCrowd;
  /** Its launch transaction, as discovery found it. */
  launch?: string;
  /** This wallet started it (the device's own record). */
  mine?: true;
}

/**
 * Why a token pool takes no new box (WebAssembly's usable): a box holds less ADA than the network now asks of one
 * (`belowMinimum`), so nothing can be built. Or it's a copy (`superseded`): an earlier launch of its values turned up
 * after this device read it, so it's read for the boxes already in it and takes no new one, for good (decision 30; the
 * merged fixes' review, MERGED-1). A box that couldn't pay its own way back, or a check that couldn't be made, is no
 * reason since the owner's call 34 (`cantComeBack` on the pool says the first). Words are the screens' to choose;
 * nothing here is translated.
 */
export interface LovejoinUnusable {
  why: "belowMinimum" | "superseded";
  /**
   * In a copy (`superseded`), why mixing again its boxes is refused too, if it is: mixing again makes no deposit, so a
   * copy alone doesn't refuse it, but a box's minimum does (fix round two's last review, R3-2).
   */
  again?: "belowMinimum";
}

/**
 * What the launch form shows before anything is built (chunk 34's session 1, 14): what a box may hold under the
 * live parameters, and the pools of these values' kind already shown, so a creator can join one rather than split
 * it. Amounts in lovelace.
 */
export interface LovejoinLaunchTerms {
  /** The least a box may hold: one comes back and pays part of itself on its own. */
  least: string;
  /** What the form suggests: the least with a margin, rounded up to 0.5 ₳. */
  suggested: string;
  /** The most a token pool's box may hold; none for an ADA pool. */
  most?: string;
  /** The shown pools of this token (or of ADA), each with its box value. */
  pools: Array<{ id: string; boxLovelace: string; token?: TokenQuantity }>;
}

/** A pool's start, built, waiting for Send. Amounts in lovelace. */
export interface LovejoinLaunchSummary {
  network: NetworkName;
  txHash: string;
  /** Who pays: the private balance (the default), or the public account, which shows that link. */
  from: "private" | "public";
  /** The pool it makes, as checked from its own bytes. */
  pool: { id: string; boxLovelace: string; token?: TokenQuantity };
  /**
   * What never comes back: the reference UTxO, the two scripts at the holder, and the stake deposit. At most: when
   * Send finds something registered mix_logic's credential already, the start it sends pays no deposit, and its total
   * is that much less (lovejoin-launch.ts).
   */
  locked: { reference: string; mixBox: string; mixLogic: string; deposit: string; total: string };
  fee: string;
  /** Back into the balance it was paid from. */
  change: string;
  /** How many UTxOs it spends. */
  inputs: number;
  /** From the private balance: the histories the UTxOs it spends have, when known. */
  histories?: HistoryClass[];
}

/** A chain through Lovejoin the wallet sent that isn't all sent. */
export interface LovejoinChainView {
  /** A session's return or mix (its index); none for a mix from the public account. */
  session?: number;
  boxes: number;
  /** Its transactions, and how many were sent. */
  total: number;
  sent: number;
  /** When it began to be sent (ms). */
  at: number;
  /** Why it stopped partway; none while it's being sent. */
  stopped?: string;
  /** It stopped at a transaction that may have gone through, not seen yet: none from the account is built meanwhile. */
  maybeSent?: true;
  /** Its mixes took four boxes each (chunk 34's D3); none: three. */
  width?: 4;
  /**
   * Its transactions in order, while it's being sent and the wallet holds
   * them: what each is, and whether it's on chain, sent and not seen yet,
   * being sent, or not sent yet. Each opens in Transaction details
   * (tx-view.ts).
   */
  txs?: LovejoinChainTx[];
}

/** One transaction of a chain through Lovejoin, as its row on the Lovejoin page lists it. */
/**
 * One mix in Lovejoin's list (chunk 34's session 1, 5): every mix, from
 * either side and in any pool, followed until its last box is back. Its
 * chain's view while the wallet still keeps its record.
 */
export interface LovejoinMixView {
  /** Its chain's last transaction: the return, or a mix from the public account's last mix. */
  id: string;
  /** When it began to be sent (ms). */
  at: number;
  /** A session's return or mix (its index), or the public account that paid (its index). */
  session?: number;
  account?: number;
  again?: true;
  seed?: true;
  bootstrap?: true;
  /** Bring them all back was pressed: its boxes come back by themselves. */
  released?: true;
  /** Its boxes in each pool (none: the classic pool), how many are back, and how many a later mix took. */
  shares: Array<{ pool?: string; boxes: number; back: number; moved: number }>;
  /** Its chain, while the wallet keeps its record: how far it was sent, how it ended, and four boxes a mix (`width`). */
  chain?: { total: number; sent: number; done?: true; stopped?: string; maybeSent?: true; width?: 4 };
}

export interface LovejoinChainTx {
  txHash: string;
  kind: "deposit" | "mix" | "back";
  /**
   * On chain; sent and not seen yet; being sent: its send began and hasn't
   * finished, or a try Koios didn't answer may have put it in, so it may be in
   * a mempool already, and is never said not to be sent (the release review,
   * C29); or not sent yet.
   */
  state: "landed" | "sent" | "sending" | "waiting";
}

/**
 * The boxes on their way back, as this device's schedule has them (no pool
 * read): how many, what they hold, and when the next is due (ms), for Home.
 * `notMixed`: how many the last pool read found not mixed yet (they wait for
 * Mix my boxes again); `unsure`: of those, how many only because Koios
 * hasn't said yet how they went in, after a restore (independent review
 * M14); `stopped`: how many chains stopped partway.
 */
export interface LovejoinHeld {
  boxes: number;
  lovelace: string;
  next: number | null;
  notMixed: number;
  unsure?: number;
  stopped: number;
  /**
   * How many of the wallet's boxes its open Bootstraps hold in the pool (chunk 34's D2: Home shows them apart): they
   * have no due time, and stay until brought back by hand. From the list of mixes alone; none when none (1.6.0's
   * release review, MONEY-4).
   */
  bootstrap?: number;
  /**
   * Each token pool's own figures, as the fields above are the classic
   * pool's (chunk 34): its boxes on their way back, their ADA and token, and
   * its boxes not mixed yet. Only pools with something there.
   */
  pools?: Array<{
    id: string;
    boxes: number;
    lovelace: string;
    token?: TokenQuantity;
    next: number | null;
    notMixed: number;
    unsure?: number;
    /** Its boxes a Bootstrap holds, as `bootstrap` is the classic pool's. */
    bootstrap?: number;
    /** What each of its boxes holds, as the read set has it; none when the pool isn't read this time (34f). */
    box?: LovejoinBoxValue;
  }>;
}

/** A session's order not filled yet, read from chain (chunk 24, Step 3). */
export interface SessionOrder {
  /** The DEX's, by the name Minswap gives it. */
  protocol: string;
  /** `txhash#index` */
  txIn: string;
  /** Milliseconds since 1970: its block's. */
  createdAt: number;
}

/** A part of the data layer (background/data-layer.ts): one user's reads, the private index, submits. */
export type DataPart = "public" | "private" | "submit";

/** The parts on Koios now, each until when (ms since 1970): a part not named goes to the data layer. */
export type DataHolds = Partial<Record<DataPart, number>>;

type None = Record<never, never>;

/** Every request the service worker answers: its payload and its result. */
export interface Requests {
  status: { payload: None; result: Status };
  "generate-phrase": { payload: None; result: { phrase: string } };
  /** Checks a typed phrase; fails with a reason to show the user. */
  "validate-phrase": { payload: { phrase: string }; result: null };
  "create-wallet": { payload: { phrase: string; password: string }; result: Status };
  "restore-wallet": { payload: { phrase: string; password: string }; result: Status };
  /**
   * Whether a restore made this wallet and Home is still to say so (blind test T20a, T20b): a mark in session
   * storage, the fact alone, which a lock or Remove wallet wipes. `seen` takes it away: Home has shown the note with
   * a reading, or it was dismissed.
   */
  restored: { payload: { seen?: boolean }; result: boolean };
  unlock: { payload: { password: string }; result: UnlockResult };
  lock: { payload: None; result: Status };
  activity: { payload: None; result: null };
  /**
   * When auto-lock locks the wallet (ms since the epoch), null when it isn't
   * unlocked, and how long it waits without activity. Asking isn't activity:
   * past the deadline, asking locks it.
   */
  "lock-deadline": { payload: None; result: { at: number | null; lockAfterMs: number } };
  /** Whether a chain through Lovejoin is being sent on any network: locking stops it partway. Read from the device; not activity. */
  "chains-sending": { payload: None; result: boolean };
  account: { payload: None; result: Account };
  /** The last reading, or a new one if there is none or `refresh` is set. */
  /** `kept`: the worker's kept reading alone, never read again: Home's look right after a send (blind test §9.3). */
  balances: { payload: { refresh?: boolean; kept?: boolean }; result: Balances };
  wordlist: { payload: None; result: string[] };
  /** Builds and signs a move-in without submitting it. `lovelace` null moves the most possible; below what the deposit needs, it's raised to that. */
  "move-in-build": { payload: { lovelace: string | null; tokens: TokenQuantity[] }; result: MoveInSummary };
  /** Submits the move-in built last, if its hash matches. */
  "move-in-submit": { payload: { txHash: string }; result: PendingTx };
  /** Builds a seedelf mint (Ogmios measures its scripts) without sending it. */
  "mint-build": { payload: { label: string; from: MintSource }; result: MintSummary };
  /** Submits the mint built last, if its hash matches: an account-paid one as signed, a stealth one once giveme.my has witnessed it. */
  "mint-submit": { payload: { txHash: string }; result: PendingTx };
  /** Finds a seedelf by its full name in the wallet contract, as read from Koios. */
  "seedelf-lookup": { payload: { to: string }; result: SeedelfLookup };
  /** Builds a transfer to one or more seedelfs (measured in the wallet) without sending it. A `lovelace` below what a payment needs is raised to that; null is Max, to one. */
  "transfer-build": { payload: { payments: PaymentAsk[] }; result: TransferSummary };
  /** Submits the transfer built last, if its hash matches, once giveme.my has witnessed it. */
  "transfer-submit": { payload: { txHash: string }; result: PendingTx };
  /** Reads a withdrawal's or a send's destination: an address, or `$handle` looked up through Koios. */
  "resolve-destination": { payload: { to: string }; result: WithdrawDestination };
  /** Builds a withdrawal to one or more addresses (`lovelace` null sends everything, to one; below what a payment needs, it's raised to that) without sending it. */
  "withdraw-build": { payload: { payments: PaymentAsk[] }; result: WithdrawSummary };
  /** Submits the withdrawal built last, if its hash matches, once giveme.my has witnessed it. */
  "withdraw-submit": { payload: { txHash: string }; result: PendingTx };
  /** Builds the removal of one of this wallet's seedelfs without sending it. */
  "remove-build": { payload: { name: string; to: RemoveTo }; result: RemoveSummary };
  /** Submits the removal built last, if its hash matches, once giveme.my has witnessed it. */
  "remove-submit": { payload: { txHash: string }; result: PendingTx };
  /** Builds and signs a payment from the Cardano account to one or more recipients without submitting it: each an address, a `$handle`, or someone's seedelf by its full name. `lovelace` as for a move-in. */
  "send-build": { payload: { payments: PaymentAsk[]; note?: string }; result: SendSummary };
  /** Submits the payment built last, if its hash matches. */
  "send-submit": { payload: { txHash: string }; result: PendingTx };
  /** The submitted transaction being watched, with fresh confirmations; null when there's none. */
  "pending-tx": { payload: None; result: PendingTx | null };
  /**
   * Deletes the wallet from this browser. Unlocked, it's refused while
   * something is still open (`reset-check`), unless `force`: the user saw
   * the list and asked again.
   */
  "reset-wallet": { payload: { force?: boolean }; result: Status };
  /** What removing the wallet would leave behind, each network with something; none, nothing. Unlocked only. */
  "reset-check": { payload: None; result: AtStake[] };
  /** The recovery phrase's words, for Settings; the password again, even while unlocked. */
  "reveal-phrase": { payload: { password: string }; result: { words: string[] } };
  /** Whether a typed phrase is this wallet's, for Settings' check: yes or no, never which words differ. */
  "check-phrase": { payload: { phrase: string }; result: { matches: boolean } };
  /** How many words this wallet's phrase has, so Settings' check opens on that many boxes. Unlocked only. */
  "phrase-words": { payload: None; result: { words: number } };
  /** Seals the vault under a new password. */
  "change-password": { payload: { current: string; next: string }; result: None };
  /** This network's contacts, by name. */
  contacts: { payload: None; result: Contact[] };
  /** Adds a contact, or changes the one with `id`; returns the contacts. */
  "contact-save": { payload: { id?: string; name: string; value: string }; result: Contact[] };
  "contact-remove": { payload: { id: string }; result: Contact[] };
  /**
   * One balance's activity, newest first; `more` reads the next page (the
   * Cardano account only). `refresh` reads the balances again first, for the
   * Seedelf side's arrivals; the Cardano side asks Koios for what's newer
   * every time. `updatedAt`: when what's shown was read.
   */
  history: {
    payload: { of: "seedelf" | "cardano"; more?: boolean; refresh?: boolean };
    result: { entries: ActivityEntry[]; more: boolean; updatedAt?: number };
  };
  /** Both sides' UTxOs, from the last reading, or a new one with `refresh`. */
  utxos: { payload: { refresh?: boolean }; result: UtxoLists };
  /** Locks or unlocks one UTxO (`txhash#index`): a locked one is left out of every payment. */
  "utxo-lock": { payload: { of: UtxoSide; utxo: string; locked: boolean }; result: UtxoLists };
  /** The Cardano account's collateral, from the last reading. */
  collateral: { payload: None; result: CollateralStatus };
  /** Makes a 5 ₳ UTxO the account holds its collateral, with no transaction. */
  "collateral-use": { payload: { utxo: string }; result: CollateralStatus };
  /** Returns the collateral to the balance. */
  "collateral-reclaim": { payload: None; result: CollateralStatus };
  /** Builds and signs a 5 ₳ payment to the account's own `0/0`, whose output becomes the collateral. */
  "collateral-build": { payload: None; result: SendSummary };
  /** Submits the collateral payment built last, if its hash matches. */
  "collateral-submit": { payload: { txHash: string }; result: PendingTx };
  /** Every live pool: kept on the device for a day, or read again with `refresh`. */
  pools: { payload: { refresh?: boolean }; result: PoolList };
  /** One pool's details, fresh. */
  pool: { payload: { id: string }; result: PoolDetails };
  /** One pool's recent epochs and its return on stake over them, fresh (chunk 37). */
  "pool-history": { payload: { id: string }; result: PoolHistory };
  /** A DRep by its ID (CIP-129 or CIP-105): its standing and name. */
  drep: { payload: { id: string }; result: DrepDetails };
  /** The account's own DRep, read fresh. */
  "drep-own": { payload: None; result: OwnDrep };
  /** Every reward paid to the public account's stake key, newest first, read fresh (chunk 30). */
  "reward-history": { payload: None; result: RewardRow[] };
  /** Every certificate naming the public account's stake key, newest first, read fresh (chunk 36). */
  "delegation-history": { payload: None; result: DelegationRow[] };
  /** The live governance actions (kept on the device for an hour, or read again with `refresh`), with the account's DRep and its votes. */
  governance: { payload: { refresh?: boolean }; result: GovernanceView };
  /** Writes a DRep's profile as CIP-119 metadata and hashes it, asking no one. */
  "drep-profile": { payload: { profile: DrepProfileRequest }; result: DrepProfileFile };
  /** Builds and signs a staking transaction without submitting it. */
  "stake-build": { payload: { action: StakingAction }; result: StakingSummary };
  /** Submits the staking transaction built last, if its hash matches. */
  "stake-submit": { payload: { txHash: string }; result: PendingTx };
  preferences: { payload: None; result: Preferences };
  "preferences-set": { payload: Partial<Preferences>; result: Preferences };
  /**
   * Puts the wallet on another of the build's networks (Settings): every
   * page follows (state-changed), and what sites were asking on the other
   * network is declined.
   */
  "network-set": { payload: { network: NetworkName }; result: Status };
  /**
   * Which of the data layer's parts are on Koios for now, after it didn't
   * answer (Settings' status line). Asks no one: the worker's own record.
   */
  "data-layer": { payload: None; result: DataHolds };
  /** The public accounts the phrase has used, and which one the wallet works on. */
  accounts: { payload: None; result: AccountList };
  /**
   * Puts the wallet on another of its public accounts: every page starts
   * afresh on it, and what the account it left read is dropped. Refused while
   * something of that account's is in flight — a payment Koios didn't answer,
   * or a mix being sent — since switching under a watch is how a watch loses
   * its account.
   */
  "account-use": { payload: { index: number }; result: AccountList };
  /** Names an account, or clears the name with an empty one. */
  "account-rename": { payload: { index: number; name: string }; result: AccountList };
  /**
   * Looks for accounts past the ones the wallet knows, in order, stopping at
   * the first never used. One Koios `account_addresses` request per account
   * probed, never a batch: see accounts.ts. `limit` bounds one run; the
   * picker's own button passes 1, so it costs one request.
   */
  "account-discover": { payload: { limit?: number }; result: AccountList & { found: number[] } };
  /**
   * Looks up **one** account by number, whatever its index: the way to reach
   * a custom or non-sequential account (1337, say), which the sequential look
   * can never find because it stops at the first unused one. One Koios
   * `account_addresses` request. It is added to the list if it has been used;
   * if it hasn't, `used` is false and adding it is the user's call.
   */
  "account-check": { payload: { index: number }; result: AccountList & { index: number; used: boolean } };
  /**
   * Adds an account by number, **whether or not it has ever been used**: the
   * way to start a custom-numbered account. Asks nobody anything.
   */
  "account-add": { payload: { index: number }; result: AccountList };
  /**
   * Each known account with its receive address `0/0`, so Send can offer
   * them as recipients (chunk 18). Derived on the device; asks nobody
   * anything.
   */
  "account-addresses": { payload: None; result: Array<KnownAccount & { address: string }> };
  /** ADA's value in the chosen currency, read again once it's five minutes old. Null off mainnet, with the currency off, or when CoinGecko can't be read. */
  price: { payload: None; result: AdaPrice | null };
  /**
   * One NFT's image, which the user asked to see (chunk 20): one Koios
   * `asset_info` request for its metadata, then one fetch from the IPFS
   * gateway, unless the image is written on chain. Nothing is kept: the page
   * holds what it shows until the wallet locks.
   */
  "nft-image": { payload: { policyId: string; assetName: string }; result: NftImage };
  /**
   * The transaction with this hash, decoded, for the transaction view: one the
   * wallet built and is holding for Send, or one a site is waiting for a
   * signature on. It reads nothing but those bytes — no Koios request, no
   * storage write — and refuses a hash it isn't holding.
   */
  "tx-detail": { payload: { txHash: string }; result: TxView };
  /** What sites are waiting for the user to answer, oldest first. */
  "dapp-approvals": { payload: None; result: DappApproval[] };
  /** The sites waiting for the wallet to be unlocked, by origin: the connector's window names them on its Unlock screen. */
  "dapp-unlocking": { payload: None; result: string[] };
  /** The connector's window has nothing left: the worker closes it, or answers false when something came in meanwhile. */
  "dapp-close": { payload: None; result: boolean };
  /**
   * Answers one: `error` says why an approved one couldn't be done (the site hears it too).
   * A signature that needs the password takes it here; a wrong one leaves it waiting.
   */
  "dapp-answer": {
    /** `governance`: a connect that asked for CIP-95, connected with it (the window's switch, off by default). */
    payload: { id: string; approve: boolean; password?: string; fund?: { txHash: string }; governance?: boolean };
    /**
     * `code`, as a refused request's reply carries it (`ReplyCode`): a private session's funding that building
     * again fixes. Whether one that failed otherwise is built again, the window reads from its session (DX-1).
     * `waitMs`: a connect declined, how long its site is turned away (blind test T17).
     * `by`: who refused a stale one, as a reply says it (`RefusedBy`, blind test §9.5).
     */
    result: { error?: string; code?: ReplyCode; by?: RefusedBy; waitMs?: number };
  };
  /** Ends a site's private session, once its account is empty, and disconnects the site that has it. */
  "dapp-disconnect-session": { payload: { index: number }; result: null };
  /** Builds the funding of a private session for the site a waiting connect is from. `fund` in `dapp-answer` sends it. */
  "dapp-private-build": {
    payload: { id: string; lovelace: string; tokens: TokenQuantity[] };
    result: SessionOutSummary;
  };
  /** The sites connected to the public account on this network. */
  "dapp-sites": { payload: None; result: DappSite[] };
  /** Disconnects a site; returns the rest. */
  "dapp-forget": { payload: { origin: string }; result: DappSite[] };
  /** The sites turned away unasked now, after the user declined them; in the worker's memory only. Throws if locked. */
  "dapp-declined": { payload: None; result: DappDeclined[] };
  /** Lets a declined site ask again now (Let it ask now); returns the rest. Throws if locked. */
  "dapp-let-ask": { payload: { origin: string }; result: DappDeclined[] };
  /** This network's private sessions, newest first; `refresh` reads their accounts (one Koios request, two with a transaction waiting). */
  sessions: { payload: { refresh?: boolean }; result: SessionView[] };
  /** Tokens on Minswap's list matching `query` (a ticker, a name or an ID); Minswap sees what's searched for. */
  "swap-tokens": { payload: { query: string }; result: SwapTokenInfo[] };
  /** Minswap's quote for a swap, with what a session for it is funded with. */
  "swap-quote": { payload: SwapAsk; result: SwapQuote };
  /** Builds the payment that funds a new session for `quote`, from the private balance, without sending it. */
  "session-out-build": {
    /**
     * `pools`: Change on its review, the pool for the token it gets by the token's unit, null for none (chunk 34's 34e).
     * `through`: the approval's switch, built the way it's set (chunk 34's 34f): off, the token's boxes aren't funded,
     * as it all comes back directly. None: Settings'.
     */
    payload: { quote: SwapQuote; display?: { in: SwapSide; out: SwapSide }; pools?: Record<string, string | null>; through?: boolean };
    /** `lovejoin`: the quote's, checked against Lovejoin's pool as it is now (privacy review §2.7). */
    result: SessionOutSummary & { lovejoin?: SwapLovejoin };
  };
  /**
   * Records the session, then submits its funding payment, if its hash
   * matches. `direct`: the approval's choice to bring it back without
   * Lovejoin (true) or through it (false); Settings' when it's left out.
   */
  "session-out-submit": { payload: { txHash: string; direct?: boolean }; result: PendingTx };
  /** Has Minswap build the session's swap, freshly quoted, and reads it. */
  "session-swap-build": { payload: { index: number }; result: SessionTxReview };
  /** Signs the swap built last with the session's key and submits it. */
  "session-swap-submit": { payload: { txHash: string }; result: PendingTx };
  /** The session's orders that aren't filled yet. */
  "session-orders": { payload: { index: number }; result: SessionOrder[] };
  /** Builds the wallet's own cancel of the session's open orders (chunk 24), and reads it. */
  "session-cancel-build": { payload: { index: number }; result: SessionTxReview };
  "session-cancel-submit": { payload: { txHash: string }; result: PendingTx };
  /** Builds and signs the return of everything at the session's account into the private balance. */
  /** `direct`: straight back, not through Lovejoin. */
  /**
   * `pools`: Change on its review (chunk 34's 34e), the pool for each of its tokens by the token's unit, null for back
   * directly; a token it doesn't name goes into its most used pool that can take a box.
   */
  "session-back-build": { payload: { index: number; direct?: boolean; pools?: Record<string, string | null> }; result: SessionBackSummary };
  "session-back-submit": { payload: { txHash: string }; result: PendingTx };
  /** Forgets a session whose funding never reached the chain. */
  "session-forget": { payload: { index: number }; result: SessionView[] };
  /** Builds another funding payment into a site's private session. */
  "session-top-up-build": { payload: { index: number; lovelace: string; tokens: TokenQuantity[] }; result: SessionOutSummary };
  /** Sends the top-up built last. */
  "session-top-up-submit": { payload: { txHash: string }; result: PendingTx };
  /** 5 ₳ into a session brought back by hand, for its open order's cancel; sent by `session-top-up-submit`. */
  "session-cancel-collateral-build": { payload: { index: number }; result: SessionOutSummary };
  /** 5 ₳ into a session brought back by hand, for its return through Lovejoin; sent by `session-top-up-submit`. */
  "session-back-collateral-build": { payload: { index: number }; result: SessionOutSummary };
  /**
   * Bring everything back: a return for each of these sessions that holds
   * something, each its own transaction; `skipped` says why a session wasn't.
   */
  "session-claim-build": {
    payload: { indexes: number[]; direct?: boolean };
    result: { returns: SessionBackSummary[]; skipped: Array<{ index: number; reason: string }> };
  };
  /**
   * The restore scan, Find leftovers: the one-time accounts this phrase used
   * that the device has no record of, each that holds something or has an
   * order open added as a session found. Asks the server about them together.
   */
  "session-scan": { payload: None; result: SessionScan };
  /**
   * Whether a restore's scan hasn't finished on this network since the
   * restore (`due`): a restore marks every network, and a scan that finishes
   * there, its own or Find leftovers', clears it; a read that fails, a lock
   * or a worker stop leaves it, and so does the network a restore doesn't
   * look at. `scanning`: a scan runs on it now, a restore's from its look for
   * public accounts on. From the device's record alone: no Koios request.
   */
  "session-scan-due": { payload: None; result: { due: boolean; scanning: boolean } };
  /** Sends the chosen returns Bring everything back built, one after another. */
  "session-claim-submit": {
    payload: { txHashes: string[] };
    result: { sent: Array<{ index: number; txHash: string }>; failed: Array<{ index: number; error: string }> };
  };
  /** The wallet's boxes in Lovejoin's pool (a pool read), and when they're due back. */
  "lovejoin-status": { payload: Record<string, never>; result: LovejoinStatus };
  /** The boxes on their way back, from this device's schedule alone: no Koios request. */
  "lovejoin-held": { payload: Record<string, never>; result: LovejoinHeld };
  /**
   * The chains lovejoin-status lists (its `chains`), read again from this
   * device alone: no Koios request. The Lovejoin page asks every few seconds
   * while one is being sent, so a chain all sent or stopped since leaves its
   * row, or says so (1.3.0's release review, C28).
   */
  "lovejoin-chains": { payload: None; result: LovejoinChainView[] };
  /**
   * Looks for Lovejoin token pools launched since the wallet last did, as the
   * Lovejoin page opens (chunk 34's 34c): the data layer's list, or Koios's
   * holder where there's none. The next pool read reads what's found. `grew`: the pools the wallet reads changed
   * with this look, so a page that read them before it ended reads them again (1.6.0's rehearsal: a wallet restored
   * opened the hub to no pools and "None" of its boxes until Refresh).
   */
  "lovejoin-look-for-pools": { payload: None; result: { grew: boolean } };
  /**
   * What mixing `boxes` boxes at the set depth takes, in the classic pool or token pool `pool`. `width`: three, where
   * the form says four falls back (34f); none, Settings'.
   */
  "lovejoin-funding": { payload: { boxes: number; pool?: string; width?: 3 }; result: LovejoinFunding };
  /**
   * Builds the funding of a new one-time account that mixes `boxes` boxes from the private balance, and runs itself
   * once sent. `pool`: a token pool's id (none: the classic pool), whose boxes take its token too. `bootstrap`: boxes
   * in with no mixes, held in the pool until brought back by hand (chunk 34: it replaces the seed).
   */
  "lovejoin-mix-private-build": {
    payload: { boxes: number; pool?: string; bootstrap?: boolean };
    result: SessionOutSummary & { mix: LovejoinFunding };
  };
  /**
   * Builds the funding of a new one-time account that mixes every box of the
   * wallet's in the pool again (as many as the pool has others for), with no
   * deposit, and runs itself once sent. Sent with lovejoin-mix-private-submit.
   */
  /** `anyway`: the boxes a mix from the public account put in too, paid from the private balance (privacy review §2.10). */
  "lovejoin-again-build": { payload: { anyway?: boolean; pool?: string }; result: SessionOutSummary & { mix: LovejoinFunding } };
  /** Builds the mixes of the boxes a mix from the public account put in, paid by the account: sent as a mix from it is. */
  "lovejoin-again-public-build": { payload: { pool?: string }; result: LovejoinPublicSummary };
  /** Records the mix session, then sends its funding. */
  "lovejoin-mix-private-submit": { payload: { txHash: string }; result: { index: number; pending: PendingTx } };
  /** Builds `boxes` boxes from the public account straight into Lovejoin: the deposit and every mix. */
  /**
   * `bootstrap`: put boxes in with no mixes at all (depth 0), which needs no other boxes and so is the only thing an
   * empty pool takes, held there until brought back by hand (chunk 34: it replaces the seed). It hides nothing of its
   * own; it gives other people boxes to mix with. `pool`: a token pool's id; none for the classic pool.
   */
  "lovejoin-mix-public-build": { payload: { boxes: number; pool?: string; bootstrap?: boolean }; result: LovejoinPublicSummary };
  /** Sends the public mix built last, in order. */
  "lovejoin-mix-public-submit": { payload: { txHash: string }; result: PendingTx };
  /**
   * How far the public mix being sent has got (transactions sent of its
   * total, and why it stopped, if it did), or null when none is. `advance`:
   * send more of it first, if there's room (the Lovejoin page, while open).
   */
  "lovejoin-mix-public-progress": {
    payload: { advance?: boolean };
    /**
     * `maybeSent`: it stopped at a transaction that may have gone through, not seen yet (independent review L5).
     * `txs`: while it's being sent, each transaction and where it is (chunk 25).
     */
    result: { total: number; sent: number; stopped?: string; maybeSent?: true; txs?: LovejoinChainTx[] } | null;
  };
  /**
   * Withdraws one of the wallet's boxes now, whatever its wait (`box`, or the
   * one that has waited longest). One not mixed yet only with `anyway`.
   * `paid`, for a box that can't pay its own way back (chunk 34's escape
   * hatch): `"private"`, one of the private balance's UTxOs of ADA alone pays
   * its fee and comes back with it, which ties that UTxO to the box (the
   * owner's call 36, the default on the page); `true`, the public account
   * pays, which ties the box to the account.
   */
  /** `pool`: with no `box`, the one of this pool's boxes that has waited longest (none: any pool's). */
  "lovejoin-withdraw-now": {
    payload: { box?: { txHash: string; txIndex: number; pool?: string }; anyway?: boolean; paid?: boolean | "private"; pool?: string };
    result: PendingTx;
  };
  /** Every mix in Lovejoin's list, from the device alone (chunk 34's session 1, 5): the hub's (34f). */
  "lovejoin-mixes": { payload: None; result: LovejoinMixView[] };
  /**
   * Bring them all back, for pool `pool`'s Bootstraps (none: the classic pool's): their boxes come back by
   * themselves from here, one a run, at random delays (chunk 34's round three, 24).
   */
  "lovejoin-bootstrap-release": { payload: { pool?: string }; result: None };
  /**
   * The most boxes a Bootstrap paid from the private balance puts into pool `pool` (none: the classic pool) at once:
   * what its funding's reserve pays the deposit for, as the worker holds it (privateBootstrapMost), for the form's
   * bound (1.6.0's release review, MONEY-6). It reads the parameters, as any build does.
   */
  "lovejoin-bootstrap-most": { payload: { pool?: string }; result: { most: number } };
  /** What a pool of `token` (none: an ADA pool) may hold a box, and the pools of its kind already shown. */
  /** `quantity`: Q, raw, once chosen; without it the least holds for any. */
  "lovejoin-launch-terms": {
    payload: { token?: { policyId: string; assetName: string }; quantity?: string };
    result: LovejoinLaunchTerms;
  };
  /**
   * Builds a pool's start (chunk 34's §5): `token` and `quantity` (Q, raw) for a token pool, none for an ADA pool;
   * every box's ADA; paid from the private balance or, the user's choice, the public account.
   */
  "lovejoin-launch-build": {
    payload: { from: "private" | "public"; token?: { policyId: string; assetName: string }; quantity?: string; boxLovelace: string };
    result: LovejoinLaunchSummary;
  };
  /** Sends the pool's start built last. */
  "lovejoin-launch-submit": { payload: { txHash: string }; result: PendingTx };
  /** Takes the session's next step, if it's time (`now`: whatever the last reading), and returns it. */
  "session-advance": { payload: { index: number; now?: boolean }; result: SessionView };
  /**
   * Stops the swap: its order is cancelled, then everything comes back into
   * the private balance (`direct`: not through Lovejoin, whatever was approved).
   * `ordered`: an order had gone out, or may have, when Stop took effect.
   * `orderedPools`: the latest swap that had, shown or given up, went against
   * a DEX's pools, so it isn't an order the wallet cancels.
   */
  "session-stop": { payload: { index: number; direct?: boolean }; result: SessionView & { ordered?: boolean; orderedPools?: boolean } };
  /** What Stop would bring back through Lovejoin, for its dialog; null when it comes back directly. */
  "session-stop-cost": { payload: { index: number }; result: SwapLovejoin | null };
  /** Goes on after a pause or a failure: the step is tried again now. */
  "session-resume": { payload: { index: number }; result: SessionView };
}

export type RequestName = keyof Requests;

export type Message = {
  [K in RequestName]: { type: K } & Requests[K]["payload"];
}[RequestName];

/**
 * What a refusal is, where a screen acts on it rather than only saying it.
 * `stale`: a reviewed transaction that building again from the chain fixes
 * (background/collateral.ts StaleReviewError).
 */
export type ReplyCode = "stale";

/**
 * Who turned a `stale` refusal away, where the device can tell (blind test
 * §9.5): `giveme`, giveme.my refused it and nothing the device knows of spent
 * what it spends; `givemeBusy`, giveme.my answered with an outage or a limit.
 * Without it, something it spends was spent or changed since the review, or
 * it waited too long (background/collateral.ts `refusedBy`).
 */
export type RefusedBy = "giveme" | "givemeBusy";

export type Reply<K extends RequestName> =
  | { ok: true; value: Requests[K]["result"] }
  | { ok: false; error: string; code?: ReplyCode; by?: RefusedBy };

const REQUEST_LIST = [
  "status",
  "generate-phrase",
  "validate-phrase",
  "create-wallet",
  "restore-wallet",
  "restored",
  "unlock",
  "lock",
  "activity",
  "lock-deadline",
  "chains-sending",
  "account",
  "balances",
  "wordlist",
  "move-in-build",
  "move-in-submit",
  "mint-build",
  "mint-submit",
  "seedelf-lookup",
  "transfer-build",
  "transfer-submit",
  "resolve-destination",
  "withdraw-build",
  "withdraw-submit",
  "remove-build",
  "remove-submit",
  "send-build",
  "send-submit",
  "pending-tx",
  "reset-wallet",
  "reset-check",
  "reveal-phrase",
  "check-phrase",
  "phrase-words",
  "change-password",
  "contacts",
  "contact-save",
  "contact-remove",
  "history",
  "utxos",
  "utxo-lock",
  "collateral",
  "collateral-use",
  "collateral-reclaim",
  "collateral-build",
  "collateral-submit",
  "pools",
  "pool",
  "pool-history",
  "drep",
  "drep-own",
  "reward-history",
  "delegation-history",
  "governance",
  "drep-profile",
  "stake-build",
  "stake-submit",
  "preferences",
  "preferences-set",
  "network-set",
  "data-layer",
  "accounts",
  "account-use",
  "account-rename",
  "account-discover",
  "account-check",
  "account-add",
  "account-addresses",
  "price",
  "nft-image",
  "tx-detail",
  "dapp-approvals",
  "dapp-unlocking",
  "dapp-close",
  "dapp-answer",
  "dapp-private-build",
  "dapp-disconnect-session",
  "dapp-sites",
  "dapp-forget",
  "dapp-declined",
  "dapp-let-ask",
  "sessions",
  "swap-tokens",
  "swap-quote",
  "session-out-build",
  "session-out-submit",
  "session-swap-build",
  "session-swap-submit",
  "session-orders",
  "session-cancel-build",
  "session-cancel-submit",
  "session-back-build",
  "session-back-submit",
  "session-forget",
  "session-top-up-build",
  "session-top-up-submit",
  "session-cancel-collateral-build",
  "session-back-collateral-build",
  "session-claim-build",
  "session-claim-submit",
  "session-scan",
  "session-scan-due",
  "session-advance",
  "session-stop",
  "session-stop-cost",
  "session-resume",
  "lovejoin-status",
  "lovejoin-withdraw-now",
  "lovejoin-held",
  "lovejoin-chains",
  "lovejoin-look-for-pools",
  "lovejoin-funding",
  "lovejoin-mix-private-build",
  "lovejoin-again-build",
  "lovejoin-again-public-build",
  "lovejoin-mix-private-submit",
  "lovejoin-mix-public-build",
  "lovejoin-mix-public-submit",
  "lovejoin-mix-public-progress",
  "lovejoin-mixes",
  "lovejoin-bootstrap-release",
  "lovejoin-bootstrap-most",
  "lovejoin-launch-terms",
  "lovejoin-launch-build",
  "lovejoin-launch-submit",
] as const satisfies readonly RequestName[];

/** Every request is listed: one left out would be dropped as unknown. A missing name fails the typecheck here. */
type Unlisted = Exclude<RequestName, (typeof REQUEST_LIST)[number]>;
const everyRequestListed: [Unlisted] extends [never] ? true : Unlisted = true;
void everyRequestListed;

const REQUESTS: ReadonlySet<string> = new Set(REQUEST_LIST);

export function isMessage(value: unknown): value is Message {
  const type = (value as { type?: unknown } | null)?.type;
  return typeof type === "string" && REQUESTS.has(type);
}

/**
 * The port each UI request travels on (ui/background.ts): only the worker
 * listens for it, so no other page sees a password or the phrase in one.
 */
export const UI_PORT = "seedelf.ui";

/**
 * What a build is doing, sent along its own request's port as it goes
 * (ui-port.ts), so the wallet says more than "Building…". The order below is
 * the order they happen in; a build skips the ones it doesn't need.
 */
export type BuildStage = "checking" | "reading" | "building" | "measuring" | "collateral";

/** One stage, on the request's own port: it arrives before that request's reply. */
export interface BuildProgress {
  stage: BuildStage;
}

export function isBuildProgress(value: unknown): value is BuildProgress {
  const stage = (value as { stage?: unknown } | null)?.stage;
  return (
    typeof stage === "string" && ["checking", "reading", "building", "measuring", "collateral"].includes(stage)
  );
}

/** Broadcast by the worker to open UI pages when the wallet state changes. */
export const STATE_CHANGED = { event: "state-changed" } as const;

export function isStateChanged(value: unknown): boolean {
  return (value as { event?: unknown } | null)?.event === STATE_CHANGED.event;
}

/** Broadcast by the worker when what sites are waiting for changes. */
export const DAPP_CHANGED = { event: "dapp-changed" } as const;

export function isDappChanged(value: unknown): boolean {
  return (value as { event?: unknown } | null)?.event === DAPP_CHANGED.event;
}
