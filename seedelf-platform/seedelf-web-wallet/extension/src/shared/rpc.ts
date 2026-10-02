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
  /**
   * The Seedelf history's only: the history of what the transaction left in
   * the private balance, its change included, for coin selection and the
   * UTxOs screen (shared/histories.ts). Absent, it's read from `kind`.
   */
  origin?: HistoryClass;
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
  /**
   * Who paid for it, when the wallet knows (background/minted-by.ts):
   * Remove sends its ADA back to that side by default, and asks otherwise.
   */
  paidBy?: MintSource;
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
  /** The histories of the private UTxOs it spends, each once, when known (shared/histories.ts). */
  histories?: HistoryClass[];
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
    | "session-out"
    | "session-swap"
    | "session-cancel"
    | "session-back"
    | "lovejoin-withdraw"
    | "lovejoin-mix";
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
   * Private sessions whose one-time accounts may hold something, which a
   * restore doesn't find yet: each one open, or closed with something no
   * return takes left there (`leftBehind`).
   */
  sessions: Array<{ index: number; kind: "swap" | "mix" | "site"; origin?: string; leftBehind?: boolean }>;
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
     * Another of the wallet's accounts, as the worker found it for a site's
     * prompt (independent review M12): the public account ("account"), or a
     * private session, by index. Paying it ties the two on chain.
     */
    yours?: "account" | number;
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
}

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
  | { kind: "connect"; password: boolean; funding?: { index: number; txHash: string } }
  | {
      kind: "sign-tx";
      partial: boolean;
      summary: DappTxSummary;
      password: boolean;
      session?: number;
      collateralSpent?: boolean;
      /**
       * The wallet's other accounts it pays or spends from, which signing
       * ties on chain to the one the site sees: the public account
       * ("account", for a session's), and private sessions by index. Empty
       * when none; missing when they couldn't be checked (independent
       * review M12).
       */
      ties?: Array<"account" | number>;
    }
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
  ifStopped?: { boxes: number; mixes: number; mixFees: string; withdrawFees: string; of?: number };
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
  /** The order was filled: `partly`, part of it (a split route), the rest refunded. */
  filled: boolean;
  partly?: boolean;
  /** The order was refunded, none of it filled: what it gave came back (independent review M18). */
  refunded?: boolean;
  /**
   * Stopped, but an order of the swap is still open at a DEX, and Minswap
   * doesn't list it, so it can't be cancelled yet: when the runner first
   * found it so (ms). What's left waits at the account until that order is
   * filled or refunded, or Minswap lists it and it's cancelled (independent
   * review L16).
   */
  orderOpen?: number;
  /** The least the user approved receiving. */
  approvedMinOut: string;
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
  mix?: { boxes: number; again?: boolean; skipped?: string };
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
}

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

/** What mixing a number of boxes takes, before anything is built. Amounts in lovelace. */
export interface LovejoinFunding {
  boxes: number;
  /** A seed: the deposit alone, no mixes, so it draws nothing from the pool. */
  seed?: boolean;
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
}

/** A mix from the public account, built and signed, waiting for Send. Amounts in lovelace. */
export interface LovejoinPublicSummary {
  /** A seed: the deposit alone, no mixes, so it hides nothing of its own. */
  seed?: boolean;
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
}

/** The wallet's boxes in Lovejoin's pool, and when each is due back (ms). */
export interface LovejoinStatus {
  /** Real boxes in the pool that aren't this wallet's: what the floor counts. */
  others: number;
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
   * Its boxes a mix from the public account put where they are: the
   * account's, which paid for it in the open. Mixed again, the account pays,
   * or the private balance ties itself to it (privacy review §2.10).
   */
  fromPublic: Array<{ txHash: string; txIndex: number }>;
  /** Its chains that aren't all sent: being sent (no withdraw meanwhile), or stopped partway. */
  chains: LovejoinChainView[];
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
  /**
   * When auto-lock locks the wallet (ms since the epoch), null when it isn't
   * unlocked, and how long it waits without activity. Asking isn't activity:
   * past the deadline, asking locks it.
   */
  "lock-deadline": { payload: None; result: { at: number | null; lockAfterMs: number } };
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
  /**
   * Puts the wallet on another of the build's networks (Settings): every
   * page follows (state-changed), and what sites were asking on the other
   * network is declined.
   */
  "network-set": { payload: { network: NetworkName }; result: Status };
  /** ADA's value in the chosen currency, read again once it's five minutes old. Null off mainnet, with the currency off, or when CoinGecko can't be read. */
  price: { payload: None; result: AdaPrice | null };
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
  "session-out-build": {
    payload: { quote: SwapQuote; display?: { in: SwapSide; out: SwapSide } };
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
  /** Has Minswap build a cancel of the session's open orders, and reads it. */
  "session-cancel-build": { payload: { index: number }; result: SessionTxReview };
  "session-cancel-submit": { payload: { txHash: string }; result: PendingTx };
  /** Builds and signs the return of everything at the session's account into the private balance. */
  /** `direct`: straight back, not through Lovejoin. */
  "session-back-build": { payload: { index: number; direct?: boolean }; result: SessionBackSummary };
  "session-back-submit": { payload: { txHash: string }; result: PendingTx };
  /** Forgets a session whose funding never reached the chain. */
  "session-forget": { payload: { index: number }; result: SessionView[] };
  /** Builds another funding payment into a site's private session. */
  "session-top-up-build": { payload: { index: number; lovelace: string; tokens: TokenQuantity[] }; result: SessionOutSummary };
  /** Sends the top-up built last. */
  "session-top-up-submit": { payload: { txHash: string }; result: PendingTx };
  /**
   * Bring everything back: a return for each of these sessions that holds
   * something, each its own transaction; `skipped` says why a session wasn't.
   */
  "session-claim-build": {
    payload: { indexes: number[]; direct?: boolean };
    result: { returns: SessionBackSummary[]; skipped: Array<{ index: number; reason: string }> };
  };
  /** Sends the chosen returns Bring everything back built, one after another. */
  "session-claim-submit": {
    payload: { txHashes: string[] };
    result: { sent: Array<{ index: number; txHash: string }>; failed: Array<{ index: number; error: string }> };
  };
  /** The wallet's boxes in Lovejoin's pool (a pool read), and when they're due back. */
  "lovejoin-status": { payload: Record<string, never>; result: LovejoinStatus };
  /** The boxes on their way back, from this device's schedule alone: no Koios request. */
  "lovejoin-held": { payload: Record<string, never>; result: LovejoinHeld };
  /** What mixing `boxes` boxes at the set depth takes. */
  "lovejoin-funding": { payload: { boxes: number }; result: LovejoinFunding };
  /** Builds the funding of a new one-time account that mixes `boxes` boxes from the private balance, and runs itself once sent. */
  /** `seed`: boxes in with no mixes, which an empty pool takes (see the public build). */
  "lovejoin-mix-private-build": { payload: { boxes: number; seed?: boolean }; result: SessionOutSummary & { mix: LovejoinFunding } };
  /**
   * Builds the funding of a new one-time account that mixes every box of the
   * wallet's in the pool again (as many as the pool has others for), with no
   * deposit, and runs itself once sent. Sent with lovejoin-mix-private-submit.
   */
  /** `anyway`: the boxes a mix from the public account put in too, paid from the private balance (privacy review §2.10). */
  "lovejoin-again-build": { payload: { anyway?: boolean }; result: SessionOutSummary & { mix: LovejoinFunding } };
  /** Builds the mixes of the boxes a mix from the public account put in, paid by the account: sent as a mix from it is. */
  "lovejoin-again-public-build": { payload: None; result: LovejoinPublicSummary };
  /** Records the mix session, then sends its funding. */
  "lovejoin-mix-private-submit": { payload: { txHash: string }; result: { index: number; pending: PendingTx } };
  /** Builds `boxes` boxes from the public account straight into Lovejoin: the deposit and every mix. */
  /**
   * `seed`: put boxes in with no mixes at all (depth 0), which needs no
   * other boxes and so is the only thing an empty pool takes. It hides
   * nothing of its own; it gives other people boxes to mix with.
   */
  "lovejoin-mix-public-build": { payload: { boxes: number; seed?: boolean }; result: LovejoinPublicSummary };
  /** Sends the public mix built last, in order. */
  "lovejoin-mix-public-submit": { payload: { txHash: string }; result: PendingTx };
  /**
   * How far the public mix being sent has got (transactions sent of its
   * total, and why it stopped, if it did), or null when none is. `advance`:
   * send more of it first, if there's room (the Lovejoin page, while open).
   */
  "lovejoin-mix-public-progress": {
    payload: { advance?: boolean };
    /** `maybeSent`: it stopped at a transaction that may have gone through, not seen yet (independent review L5). */
    result: { total: number; sent: number; stopped?: string; maybeSent?: true } | null;
  };
  /**
   * Withdraws one of the wallet's boxes now, whatever its wait (`box`, or the
   * one that has waited longest). One not mixed yet only with `anyway`.
   */
  "lovejoin-withdraw-now": { payload: { box?: { txHash: string; txIndex: number }; anyway?: boolean }; result: PendingTx };
  /** Takes the session's next step, if it's time (`now`: whatever the last reading), and returns it. */
  "session-advance": { payload: { index: number; now?: boolean }; result: SessionView };
  /**
   * Stops the swap: its order is cancelled, then everything comes back into
   * the private balance (`direct`: not through Lovejoin, whatever was approved).
   * `ordered`: an order had gone out, or may have, when Stop took effect.
   */
  "session-stop": { payload: { index: number; direct?: boolean }; result: SessionView & { ordered?: boolean } };
  /** What Stop would bring back through Lovejoin, for its dialog; null when it comes back directly. */
  "session-stop-cost": { payload: { index: number }; result: SwapLovejoin | null };
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

const REQUEST_LIST = [
  "status",
  "generate-phrase",
  "validate-phrase",
  "create-wallet",
  "restore-wallet",
  "unlock",
  "lock",
  "activity",
  "lock-deadline",
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
  "network-set",
  "price",
  "tx-detail",
  "dapp-approvals",
  "dapp-unlocking",
  "dapp-close",
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
  "session-claim-build",
  "session-claim-submit",
  "session-advance",
  "session-stop",
  "session-stop-cost",
  "session-resume",
  "lovejoin-status",
  "lovejoin-withdraw-now",
  "lovejoin-held",
  "lovejoin-funding",
  "lovejoin-mix-private-build",
  "lovejoin-again-build",
  "lovejoin-again-public-build",
  "lovejoin-mix-private-submit",
  "lovejoin-mix-public-build",
  "lovejoin-mix-public-submit",
  "lovejoin-mix-public-progress",
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
