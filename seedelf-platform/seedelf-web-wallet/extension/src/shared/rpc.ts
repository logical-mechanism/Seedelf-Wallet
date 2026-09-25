// Typed request/response messages between the UI and the service worker.
// The service worker owns every secret; the UI only ever asks it to do work.

import type { NetworkName } from "../networks";
import type { Currency, Preferences } from "./preferences";

export type { Preferences };

export type WalletState = "no-wallet" | "locked" | "unlocked";

export interface Status {
  state: WalletState;
  version: string;
  network: NetworkName;
  networks: NetworkName[];
  /** When locked: how long until another unlock attempt is allowed (ms). */
  retryAfterMs: number;
}

export type UnlockResult =
  | { unlocked: true }
  /** `wrongPassword` is false when the attempt was refused for being too early. */
  | { unlocked: false; wrongPassword: boolean; retryAfterMs: number };

/** The unlocked wallet's public identifiers. */
export interface Account {
  /** Cardano account 0, receive address 0/0. */
  receiveAddress: string;
  stakeAddress: string;
  /** The Seedelf base register's public value (compressed G1, hex). */
  seedelfPublicValue: string;
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
  /** "received" and "sent" are anyone's; the rest are this wallet's own flows. */
  kind: "received" | "sent" | PendingTx["kind"];
  /** Into the balance, out of it, or neither (a seedelf's locked ADA). */
  direction: "in" | "out" | "none";
  /** ADA moved, as lovelace (a decimal string, no sign). */
  lovelace: string;
  /** How many kinds of token moved with it. */
  tokens: number;
  /** The network fee, when this wallet paid it (lovelace). */
  fee?: string;
  /** Who or where: a seedelf's tag, a $handle, an address. */
  detail?: string;
  /** The tokens that moved, each with a signed quantity (negative: out), when known. Older entries have only `tokens`. */
  assets?: TokenQuantity[];
  /** The Cardano account's only: a note on the transaction (CIP-20's message), in whoever wrote it's words. */
  note?: string;
  /** The Cardano account's only: what the transaction did with its stake key. */
  staking?: ActivityStaking;
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
}

/** ADA's value in the currency chosen, on mainnet: CoinGecko's, kept on the device five minutes. */
export interface AdaPrice {
  currency: Exclude<Currency, "off">;
  /** What one ADA is worth in it. */
  rate: number;
  /** When CoinGecko was read (ms since the epoch). */
  updatedAt: number;
}

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
  /** Rewards that can be withdrawn. */
  rewards: string;
  /** The deposit paid to register it: stopping staking gets it back. */
  deposit: string;
}

/** What the wallet holds on one network. Lovelace amounts are decimal strings. */
export interface Balances {
  network: NetworkName;
  /** When the chain was read (ms since the epoch). */
  updatedAt: number;
  /** UTxOs in the wallet contract this wallet owns, except those holding a seedelf (as in the CLI's `balance`). */
  seedelf: { lovelace: string; tokens: TokenAmount[]; utxos: number; seedelfs: SeedelfInfo[]; locked: Locked };
  /** The Cardano account (CIP-1852 account 0): `lovelace` is its UTxOs', without the rewards in `staking`. */
  cardano: {
    lovelace: string;
    tokens: TokenAmount[];
    utxos: number;
    addressesUsed: number;
    locked: Locked;
    staking: StakeInfo;
  };
}

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

/** A DRep (Koios's `drep_info`, and its name from `drep_metadata`). */
export interface DrepDetails {
  /** CIP-129. */
  id: string;
  name?: string;
  status: "registered" | "retired";
  /** Voted recently enough to count: an inactive DRep's votes don't. */
  active: boolean;
  expiresEpoch: number | null;
  /** The stake delegated to it (lovelace). */
  votingPower: string;
  delegators: number;
}

/** Something to do with the Cardano account's stake key. */
export type StakingAction =
  /** Stake with a pool (`pool1…`), registering first when needed. */
  | { kind: "delegate"; pool: string }
  /** Delegate the vote: a DRep's ID, `drep_always_abstain` or `drep_always_no_confidence`. */
  | { kind: "vote"; drep: string }
  | { kind: "withdraw" }
  /** Withdraw the rewards, unregister, and get the deposit back. */
  | { kind: "stop" };

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
  /** Paid to register the stake key. */
  deposit: string;
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
  /** The Cardano account's address holding it. */
  address?: string;
  /** Kept out of every payment (the collateral always is). */
  locked: boolean;
  /** The Cardano account's collateral. */
  collateral?: boolean;
  /** It holds one of your seedelfs: its full token name, and its tag when it reads as text. Only removing it spends the UTxO. */
  seedelf?: { name: string; label?: string };
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
}

/** A token and an amount to send. `quantity` is the raw integer, as a decimal string. */
export type TokenQuantity = TokenRef & { quantity: string };

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
  minimum: string;
}

/** A finished transfer, waiting for the user to send it. Amounts are lovelace strings. */
export interface TransferSummary {
  network: NetworkName;
  txHash: string;
  /** The seedelfs paid, in order. */
  payments: SeedelfPaid[];
  fee: { size: string; compute: string; scriptReference: string; total: string };
  /** Back into the Seedelf balance. */
  changeLovelace: string;
  changeTokens: number;
  changeOutputs: number;
  /** How many Seedelf UTxOs pay for it. */
  inputs: number;
}

/** Where a withdrawal goes, as the wallet read it. */
export interface WithdrawDestination {
  /** The bech32 address paid. */
  address: string;
  /** The ADA Handle it was found by, without the "$". */
  handle?: string;
  /** It carries this wallet's Cardano account's staking key: paying it re-links the money. */
  own: boolean;
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
  /** How many Seedelf UTxOs pay for it. */
  inputs: number;
  /** Seedelf UTxOs Max left for another withdrawal (it takes 20 at most). */
  left: number;
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
    | "session-out"
    | "session-swap"
    | "session-cancel"
    | "session-back";
  network: NetworkName;
  txHash: string;
  submittedAt: number;
  /** Null until it's on chain. */
  confirmations: number | null;
}

/** A token in a dApp transaction's summary; `quantity` is signed where it's a change. */
export interface DappToken {
  policyId: string;
  assetName: string;
  quantity: string;
}

/** What a dApp's transaction does to the public account (WebAssembly's `inspectDappTx`). Lovelace amounts are decimal strings. */
export interface DappTxSummary {
  txHash: string;
  fee: string;
  /** The account's change in ADA (signed) and each token that moved. */
  netLovelace: string;
  netTokens: DappToken[];
  spentLovelace: string;
  returnedLovelace: string;
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
    pool: string | null;
    drep: string | null;
    deposit: string | null;
    refund: string | null;
  }>;
  withdrawals: Array<{ address: string; lovelace: string; own: boolean }>;
  collateral: { own: number; lovelace: string; total: string | null; returnedLovelace: string | null; atRisk: string } | null;
  scripts: boolean;
  referenceInputs: number;
  votes: number;
  proposals: number;
  donation: string | null;
  /** CIP-20's message lines. */
  note: string[] | null;
  metadata: boolean;
  validFrom: number | null;
  validUntil: number | null;
  /** The account's keys that sign: `0/3`, `1/0`, `stake`. */
  signs: string[];
  unknownInputs: string[];
  othersSign: number;
  complete: boolean;
}

/**
 * What a site asks the user for. A signature's `password`: Sign needs the
 * password typed too (the `dappPassword` setting). Its `session`: the site is
 * connected to that private session, not the public account. A connect's
 * `funding`: the private session it chose is funded and on its way, and the
 * site connects once Koios sees it. `password` on a connect: sending a
 * private session's funding needs it.
 */
export type DappAsk =
  | { kind: "connect"; password: boolean; funding?: { index: number; txHash: string } }
  | { kind: "sign-tx"; partial: boolean; summary: DappTxSummary; password: boolean; session?: number }
  | {
      kind: "sign-data";
      session?: number;
      /** Bech32. */
      address: string;
      key: "payment" | "stake";
      payload: string;
      /** The payload as text, when it reads as UTF-8. */
      text?: string;
      password: boolean;
    };

/** Something a site asked for that waits for the user, in the connector's window. */
export type DappApproval = { id: string; origin: string; title?: string } & DappAsk;

/** A site connected to the public account. */
export interface DappSite {
  origin: string;
  connectedAt: number;
  /** Connected to this private session (private CIP-30), not the public account. */
  session?: number;
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
  /** Moved from the private balance to the session's account: the swap and its costs, with room for the swap's fee and change. */
  fund: { lovelace: string; tokens: TokenQuantity[] };
  /** Also moved: the account's own collateral, in lovelace. It comes back with the rest. */
  collateral: string;
}

/** A transaction the wallet built or signed for a session. `confirmed` once the chain has it. */
export interface SessionTx {
  kind: "out" | "swap" | "cancel" | "back";
  txHash: string;
  at: number;
  confirmed?: boolean;
}

/** Why a swap that runs itself waits for the user. */
export type SessionPause =
  /** The fresh quote expects `amountOut`, less than the least the user approved: the order couldn't fill. */
  | { at: number; why: "price"; amountOut: string }
  /** What Minswap built failed a check (`detail` says which), so the wallet didn't sign it. */
  | { at: number; why: "refused"; detail: string };

/** A swap that runs itself, after one approval: where it's at, for its timeline. */
export interface SessionAuto {
  /** Each step waits for the one before: the funding, the order, its fill (or cancel), the return. */
  step: "funding" | "ordering" | "filling" | "cancelling" | "returning" | "done";
  paused?: SessionPause;
  /** The last step failed (Koios or Minswap didn't answer): it's tried again at `at`. */
  retry?: { at: number; error: string };
  /** The user pressed Stop: any order is cancelled, then everything comes back. */
  stopping: boolean;
  /** The order was filled. */
  filled: boolean;
  /** The least the user approved receiving. */
  approvedMinOut: string;
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
}

/** A funding payment into a new session, built and waiting for Send. */
export interface SessionOutSummary extends WithdrawSummary {
  index: number;
  address: string;
}

/** A transaction Minswap built for a session (a swap, a cancel), read by WebAssembly and waiting for Send. */
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
}

/** A session's order not filled yet, from Minswap. */
export interface SessionOrder {
  protocol: string;
  /** `txhash#index` */
  txIn: string;
  amountIn: string;
  minAmountOut: string;
  createdAt: number;
}

type None = Record<never, never>;

/** Every request the service worker answers: its payload and its result. */
export interface Requests {
  status: { payload: None; result: Status };
  "generate-phrase": { payload: None; result: { phrase: string } };
  /** Checks a typed phrase; fails with a reason to show the user. */
  "validate-phrase": { payload: { phrase: string }; result: null };
  "create-wallet": { payload: { phrase: string; password: string }; result: Status };
  "restore-wallet": { payload: { phrase: string; password: string }; result: Status };
  unlock: { payload: { password: string }; result: UnlockResult };
  lock: { payload: None; result: Status };
  activity: { payload: None; result: null };
  account: { payload: None; result: Account };
  /** The last reading, or a new one if there is none or `refresh` is set. */
  balances: { payload: { refresh?: boolean }; result: Balances };
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
  /** Builds a transfer to one or more seedelfs (Ogmios measures its spends) without sending it. A `lovelace` below what a payment needs is raised to that. */
  "transfer-build": { payload: { payments: PaymentAsk<string>[] }; result: TransferSummary };
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
  "reset-wallet": { payload: None; result: Status };
  /** The recovery phrase's words, for Settings; the password again, even while unlocked. */
  "reveal-phrase": { payload: { password: string }; result: { words: string[] } };
  /** Whether a typed phrase is this wallet's, for Settings' check: yes or no, never which words differ. */
  "check-phrase": { payload: { phrase: string }; result: { matches: boolean } };
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
  /** A DRep by its ID (CIP-129 or CIP-105): its standing and name. */
  drep: { payload: { id: string }; result: DrepDetails };
  /** Builds and signs a staking transaction without submitting it. */
  "stake-build": { payload: { action: StakingAction }; result: StakingSummary };
  /** Submits the staking transaction built last, if its hash matches. */
  "stake-submit": { payload: { txHash: string }; result: PendingTx };
  preferences: { payload: None; result: Preferences };
  "preferences-set": { payload: Partial<Preferences>; result: Preferences };
  /** ADA's value in the chosen currency, read again once it's five minutes old. Null off mainnet, with the currency off, or when CoinGecko can't be read. */
  price: { payload: None; result: AdaPrice | null };
  /** What sites are waiting for the user to answer, oldest first. */
  "dapp-approvals": { payload: None; result: DappApproval[] };
  /**
   * Answers one: `error` says why an approved one couldn't be done (the site hears it too).
   * A signature that needs the password takes it here; a wrong one leaves it waiting.
   */
  "dapp-answer": {
    payload: { id: string; approve: boolean; password?: string; fund?: { txHash: string } };
    result: { error?: string };
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
  /** This network's private sessions, newest first; `refresh` reads their accounts (one Koios request, two with a transaction waiting). */
  sessions: { payload: { refresh?: boolean }; result: SessionView[] };
  /** Tokens on Minswap's list matching `query` (a ticker, a name or an ID); Minswap sees what's searched for. */
  "swap-tokens": { payload: { query: string }; result: SwapTokenInfo[] };
  /** Minswap's quote for a swap, with what a session for it is funded with. */
  "swap-quote": { payload: SwapAsk; result: SwapQuote };
  /** Builds the payment that funds a new session for `quote`, from the private balance, without sending it. */
  "session-out-build": { payload: { quote: SwapQuote; display?: { in: SwapSide; out: SwapSide } }; result: SessionOutSummary };
  /** Records the session, then submits its funding payment, if its hash matches. */
  "session-out-submit": { payload: { txHash: string }; result: PendingTx };
  /** Has Minswap build the session's swap, freshly quoted, and reads it. */
  "session-swap-build": { payload: { index: number }; result: SessionTxReview };
  /** Signs the swap built last with the session's key and submits it. */
  "session-swap-submit": { payload: { txHash: string }; result: PendingTx };
  /** The session's orders that aren't filled yet. */
  "session-orders": { payload: { index: number }; result: SessionOrder[] };
  /** Has Minswap build a cancel of the session's open orders, and reads it. */
  "session-cancel-build": { payload: { index: number }; result: SessionTxReview };
  "session-cancel-submit": { payload: { txHash: string }; result: PendingTx };
  /** Builds and signs the return of everything at the session's account into the private balance. */
  "session-back-build": { payload: { index: number }; result: SessionBackSummary };
  "session-back-submit": { payload: { txHash: string }; result: PendingTx };
  /** Forgets a session whose funding never reached the chain. */
  "session-forget": { payload: { index: number }; result: SessionView[] };
  /** Builds another funding payment into a site's private session. */
  "session-top-up-build": { payload: { index: number; lovelace: string; tokens: TokenQuantity[] }; result: SessionOutSummary };
  /** Sends the top-up built last. */
  "session-top-up-submit": { payload: { txHash: string }; result: PendingTx };
  /** Takes the session's next step, if it's time (`now`: whatever the last reading), and returns it. */
  "session-advance": { payload: { index: number; now?: boolean }; result: SessionView };
  /** Stops the swap: its order is cancelled, then everything comes back into the private balance. */
  "session-stop": { payload: { index: number }; result: SessionView };
  /** Goes on after a pause or a failure: the step is tried again now. */
  "session-resume": { payload: { index: number }; result: SessionView };
}

export type RequestName = keyof Requests;

export type Message = {
  [K in RequestName]: { type: K } & Requests[K]["payload"];
}[RequestName];

export type Reply<K extends RequestName> =
  | { ok: true; value: Requests[K]["result"] }
  | { ok: false; error: string };

const REQUESTS: ReadonlySet<string> = new Set<RequestName>([
  "status",
  "generate-phrase",
  "validate-phrase",
  "create-wallet",
  "restore-wallet",
  "unlock",
  "lock",
  "activity",
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
  "reveal-phrase",
  "check-phrase",
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
  "drep",
  "stake-build",
  "stake-submit",
  "preferences",
  "preferences-set",
  "price",
  "dapp-approvals",
  "dapp-answer",
  "dapp-private-build",
  "dapp-disconnect-session",
  "dapp-sites",
  "dapp-forget",
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
  "session-advance",
  "session-stop",
  "session-resume",
]);

export function isMessage(value: unknown): value is Message {
  const type = (value as { type?: unknown } | null)?.type;
  return typeof type === "string" && REQUESTS.has(type);
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
