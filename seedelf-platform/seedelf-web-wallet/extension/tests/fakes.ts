// Test doubles for the Chrome APIs the wallet uses.
import { readFileSync } from "node:fs";

import * as wasm from "@seedelf/wasm";

import { ActivityService } from "../src/background/activity";
import { BalanceService } from "../src/background/balances";
import { CoinControlService } from "../src/background/coin-control";
import { Collateral } from "../src/background/collateral";
import { ContactsService } from "../src/background/contacts";
import { DappService, type ApprovalWindow } from "../src/background/dapp";
import { Minswap, type Estimate, type PendingOrder } from "../src/background/minswap";
import { MintService } from "../src/background/mint";
import { MoveInService } from "../src/background/move-in";
import {
  Koios,
  type FetchLike,
  type KoiosAccountInfo,
  type KoiosDrepInfo,
  type KoiosDrepName,
  type KoiosPool,
  type KoiosPoolInfo,
  type KoiosTxInfo,
  type KoiosUtxo,
} from "../src/background/koios";
import { PendingService } from "../src/background/pending";
import { PreferencesService } from "../src/background/preferences";
import { PriceService } from "../src/background/prices";
import { SendService } from "../src/background/send";
import { LovejoinService } from "../src/background/lovejoin";
import { SessionService } from "../src/background/sessions";
import { StakingService } from "../src/background/staking";
import { PrivateStore } from "../src/background/private-store";
import { TransferService } from "../src/background/transfer";
import { WithdrawService } from "../src/background/withdraw";
import type { Area } from "../src/background/storage";
import type { SwapAsk } from "../src/shared/rpc";
import { txIdOf } from "./fixtures/cbor";
import { Wallet, type WalletDeps } from "../src/background/wallet";

/** An in-memory chrome.storage area. Values go through JSON, as Chrome's do. */
export type MemoryArea = Area & { data: Map<string, unknown> };

export function memoryArea(): MemoryArea {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) {
      const raw = data.get(key);
      return raw === undefined ? undefined : (JSON.parse(raw as string) as T);
    },
    async set(key, value) {
      data.set(key, JSON.stringify(value));
    },
    async remove(...keys) {
      for (const k of keys) data.delete(k);
    },
    async clear() {
      data.clear();
    },
  };
}

let wasmReady = false;

/** The real WebAssembly module, built by ../wasm/build.sh. */
export function loadTestWasm(): typeof wasm {
  if (!wasmReady) {
    wasm.initSync({ module: readFileSync(new URL("../../wasm/pkg/seedelf_wasm_bg.wasm", import.meta.url)) });
    wasmReady = true;
  }
  return wasm;
}

/** A wallet over fake storage and a controllable clock. */
export function testWallet(shared?: { local: MemoryArea; session: MemoryArea; clock: { now: number } }) {
  const local = shared?.local ?? memoryArea();
  const session = shared?.session ?? memoryArea();
  const clock = shared?.clock ?? { now: 1_800_000_000_000 };
  const events = { changed: 0, alarm: "stopped" as "started" | "stopped" };
  const deps: WalletDeps = {
    wasm: loadTestWasm(),
    local,
    session,
    now: () => clock.now,
    autoLock: {
      start: async () => void (events.alarm = "started"),
      stop: async () => void (events.alarm = "stopped"),
    },
    changed: () => void events.changed++,
  };
  return { wallet: new Wallet(deps), local, session, clock, events };
}

export const vectors = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../seedelf-crypto/tests/vectors/${name}`, import.meta.url), "utf8"))
    .vectors as Array<Record<string, any>>;

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Record<string, any>;

/** Real preprod Koios responses (tests/fixtures/record-koios.mjs). */
export const koiosPreprod = fixture("koios-preprod.json") as {
  wallet_contract: string;
  contract_utxos: KoiosUtxo[];
  accounts: Record<string, { account_addresses: Array<{ addresses: string[] }>; account_utxos: KoiosUtxo[] }>;
};
/** Synthetic contract UTxOs owned by the 12-word vector phrase. */
export const ownedUtxos = fixture("owned-utxos.json").owned_utxos as KoiosUtxo[];
/** A real account-paid mint evaluated on preprod (tests/fixtures/record-account-mint.mjs). */
export const accountMintPreprod = fixture("account-mint-preprod.json") as { evaluation: unknown };
/** A real transfer on preprod: its request and Ogmios's evaluation (tests/fixtures/record-transfer.mjs). */
/** The 12-word phrase's real preprod account: its newest transactions and their tx_info. */
export const activityPreprod = fixture("activity-preprod.json") as {
  stake: string;
  account_txs: Array<{ tx_hash: string; block_height: number; block_time: number }>;
  tx_info: Array<{ tx_hash: string; block_height: number }>;
};

export const transferPreprod = fixture("transfer-preprod.json") as {
  to: string;
  lovelace: string;
  tokens: Array<{ policyId: string; assetName: string; quantity: string }>;
  evaluation: unknown;
  draft: { draftCbor: string; inputs: Array<{ txHash: string; txIndex: number }> };
  final: { fee: { total: string } };
};
/** Real withdrawals on preprod: an amount, Max and a removal (tests/fixtures/record-withdraw.mjs). */
export const withdrawPreprod = fixture("withdraw-preprod.json") as Record<
  "amount" | "max" | "remove",
  { request: Record<string, any>; evaluation: unknown; final: { fee: { total: string } } }
>;
/** The 12-word phrase's stake key, every live pool, and two DReps, on preprod (tests/fixtures/record-staking.mjs). */
export const stakingPreprod = fixture("staking-preprod.json") as {
  stake: string;
  account_info: KoiosAccountInfo[];
  totals: Array<{ epoch_no: number; supply: string }>;
  epoch_params: Array<{ optimal_pool_count: number }>;
  pool_list: KoiosPool[];
  pool_info: KoiosPoolInfo[];
  drep_info: KoiosDrepInfo[];
  drep_metadata: KoiosDrepName[];
};

/** A real mint round trip on preprod (tests/fixtures/record-mint.mjs). */
/** Minswap's recorded preprod quote: 10 ADA to MIN. */
export const minswapEstimate = fixture("minswap-estimate-preprod.json") as { ask: SwapAsk; estimate: Estimate };
/** Session 0 of the 12-word phrase, its UTxO, and a swap from it (wasm/tests/session_test.rs). */
export const sessionSwap = fixture("session-swap.json") as {
  address: string;
  keyHash: string;
  utxo: { tx_hash: string; tx_index: number; address: string; value: string };
  swapCbor: string;
};

export const mintPreprod = fixture("mint-preprod.json") as {
  evaluation: unknown;
  collateral: { status: number; answer: unknown };
};

export interface FakeKoios {
  fetch: FetchLike;
  calls: Array<{ path: string; query: string; body: any }>;
  /** While set, requests wait for it to resolve. */
  hold?: Promise<void>;
  /** Transactions submitted, as bytes. */
  submitted: Uint8Array[];
  /** When set, submits fail with this message. */
  rejectSubmit?: string;
  /** What `tx_status` reports for every transaction. */
  confirmations: number | null;
  /** Transactions `tx_status` doesn't know, whatever `confirmations` says: never on chain. */
  missing: Set<string>;
  /** Ogmios's answer to every evaluation: the recorded preprod mint's, unless replaced; or a function of the request. */
  evaluation: unknown;
  /** Who holds each NFT, by `policy.name`, for `asset_nft_address`. */
  nfts: Map<string, string>;
  /** Outpoints (`txhash#index`) this Koios has seen spent: left out of its UTxO answers. */
  spent: Set<string>;
  /** More wallet-contract UTxOs, as if added on chain since the fixtures were recorded. */
  added: KoiosUtxo[];
  /** More UTxOs under account payment keys: at an enterprise address, say. */
  addedToAccounts: KoiosUtxo[];
  /** Each stake key's `account_info`, by stake address: the recorded 12-word account's to begin with. */
  stakes: Map<string, KoiosAccountInfo>;
  /** More of a transaction's `tx_info`, by hash: its certificates, withdrawals or metadata, say. */
  txExtras: Map<string, Partial<KoiosTxInfo>>;
  /** Stake addresses some address has used, as far as `account_addresses` goes: one-time accounts used before, say. */
  usedStakes: Set<string>;
}

/** Real preprod protocol parameters (the CLI's and core's test fixture). */
export const epochParams = JSON.parse(
  readFileSync(new URL("../../../seedelf-core/tests/fixtures/epoch_params.json", import.meta.url), "utf8"),
) as unknown[];

/** A fetch that answers from the fixtures, paging like Koios does. */
export function fakeKoios({ owned = true } = {}): FakeKoios {
  const fake: FakeKoios = {
    calls: [],
    submitted: [],
    confirmations: null,
    missing: new Set(),
    evaluation: mintPreprod.evaluation,
    nfts: new Map(),
    spent: new Set(),
    added: [],
    addedToAccounts: [],
    stakes: new Map(stakingPreprod.account_info.map((a) => [a.stake_address, a])),
    txExtras: new Map(),
    usedStakes: new Set(),
    fetch: async (url, init) => {
      const { pathname, searchParams } = new URL(url);
      const path = pathname.split("/").pop()!;
      if (path === "submittx") {
        const bytes = new Uint8Array(init.body as Uint8Array);
        fake.calls.push({ path, query: "", body: null });
        fake.submitted.push(bytes);
        if (fake.rejectSubmit) return new Response(fake.rejectSubmit, { status: 400 });
        return Response.json(txIdOf(bytes), { status: 202 });
      }
      const body = init.body ? JSON.parse(String(init.body)) : null;
      fake.calls.push({ path, query: searchParams.toString(), body });
      if (fake.hold) await fake.hold;
      let rows: unknown[];
      if (path === "ogmios") {
        const answer = typeof fake.evaluation === "function" ? (fake.evaluation as (body: any) => unknown)(body) : fake.evaluation;
        const failed = (answer as { error?: unknown }).error !== undefined;
        return Response.json(answer, { status: failed ? 400 : 200 });
      }
      if (path === "asset_nft_address") {
        const holder = fake.nfts.get(`${searchParams.get("_asset_policy")}.${searchParams.get("_asset_name")}`);
        rows = holder ? [{ payment_address: holder }] : [];
      } else if (path === "epoch_params") {
        rows = epochParams;
      } else if (path === "tx_status") {
        rows = body._tx_hashes.map((tx_hash: string) => ({
          tx_hash,
          num_confirmations: fake.missing.has(tx_hash) ? null : fake.confirmations,
        }));
      } else if (path === "credential_utxos") {
        // The wallet contract's, or the accounts' by payment key, whatever their staking part.
        const credentials: string[] = body._payment_credentials;
        const contract = [...koiosPreprod.contract_utxos, ...(owned ? ownedUtxos : []), ...fake.added];
        const accounts = [...Object.values(koiosPreprod.accounts).flatMap((a) => a.account_utxos), ...fake.addedToAccounts];
        rows = credentials.includes(koiosPreprod.wallet_contract)
          ? contract
          : accounts.filter((u) => u.payment_cred && credentials.includes(u.payment_cred));
        // PostgREST's filter, as the contract scan uses it: `block_height=gt.N`.
        const after = /^gt\.(\d+)$/.exec(searchParams.get("block_height") ?? "");
        if (after) rows = (rows as KoiosUtxo[]).filter((u) => (u.block_height ?? 0) > Number(after[1]));
      } else if (path === "account_txs") {
        // Newest first, as the recorded answer is; after a block, or a page of it.
        const all = body._stake_address === activityPreprod.stake ? activityPreprod.account_txs : [];
        const after = body._after_block_height;
        rows = after === undefined ? all : all.filter((t) => t.block_height > after);
      } else if (path === "tx_info") {
        rows = activityPreprod.tx_info
          .filter((t) => body._tx_hashes.includes(t.tx_hash))
          .map((t) => ({ ...t, ...fake.txExtras.get(t.tx_hash) }));
      } else if (path === "utxo_info") {
        // Any UTxO the fixtures know, spent or not, as Koios answers.
        const refs: string[] = body._utxo_refs;
        const every = [
          ...koiosPreprod.contract_utxos,
          ...ownedUtxos,
          ...fake.added,
          ...Object.values(koiosPreprod.accounts).flatMap((a) => a.account_utxos),
          ...fake.addedToAccounts,
        ];
        rows = every.filter((u) => refs.includes(`${u.tx_hash}#${u.tx_index}`));
      } else if (path === "account_addresses") {
        const asked: string[] = body._stake_addresses;
        rows = [
          ...(koiosPreprod.accounts[asked[0]!]?.account_addresses ?? []),
          ...asked.filter((a) => fake.usedStakes.has(a)).map((stake_address) => ({ stake_address, addresses: [`addr_of_${stake_address}`] })),
        ];
      } else if (path === "account_utxos") {
        rows = koiosPreprod.accounts[body._stake_addresses[0]]?.account_utxos ?? [];
      } else if (path === "account_info") {
        rows = body._stake_addresses.flatMap((s: string) => fake.stakes.get(s) ?? []);
      } else if (path === "pool_list") {
        rows = stakingPreprod.pool_list;
      } else if (path === "totals") {
        rows = stakingPreprod.totals;
      } else if (path === "pool_info") {
        rows = stakingPreprod.pool_info.filter((p) => body._pool_bech32_ids.includes(p.pool_id_bech32));
      } else if (path === "drep_info") {
        rows = stakingPreprod.drep_info.filter((d) => body._drep_ids.includes(d.drep_id));
      } else if (path === "drep_metadata") {
        rows = stakingPreprod.drep_metadata.filter((d) => body._drep_ids.includes(d.drep_id));
      } else {
        return new Response("not found", { status: 404 });
      }
      if (path === "credential_utxos" || path === "account_utxos") {
        rows = (rows as KoiosUtxo[]).filter((u) => !fake.spent.has(`${u.tx_hash}#${u.tx_index}`));
      }
      const offset = Number(searchParams.get("offset") ?? 0);
      const limit = Number(searchParams.get("limit") ?? 1000);
      return Response.json(rows.slice(offset, offset + limit));
    },
  };
  return fake;
}

export interface FakeCollateral {
  fetch: FetchLike;
  /** The transactions giveme.my was asked to witness (CBOR hex). */
  asked: string[];
  /** Its answer: status and JSON body. */
  answer: { status: number; body: unknown };
}

/** giveme.my: by default it refuses, as it did the recorded mint (inputs it can't find). */
export function fakeCollateral(): FakeCollateral {
  const fake: FakeCollateral = {
    asked: [],
    answer: { status: mintPreprod.collateral.status, body: mintPreprod.collateral.answer },
    fetch: async (_url, init) => {
      fake.asked.push(JSON.parse(String(init.body)).tx);
      return Response.json(fake.answer.body, { status: fake.answer.status });
    },
  };
  return fake;
}

export interface FakeMinswap {
  fetch: FetchLike;
  calls: Array<{ path: string; body: any }>;
  /** `estimate`'s answer. */
  estimate: Estimate;
  /** `build-tx`'s transaction. */
  swapCbor: string;
  /** `pending-orders`' answer. */
  orders: PendingOrder[];
  /** `cancel-tx`'s transaction. */
  cancelCbor: string;
}

/** Minswap's aggregator: the recorded quote, and the session's swap. */
export function fakeMinswap(): FakeMinswap {
  const fake: FakeMinswap = {
    calls: [],
    estimate: minswapEstimate.estimate,
    swapCbor: sessionSwap.swapCbor,
    orders: [],
    cancelCbor: "",
    fetch: async (url, init) => {
      const path = new URL(url).pathname.split("/").pop()!;
      fake.calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
      if (path === "estimate") return Response.json(fake.estimate);
      if (path === "build-tx") return Response.json({ cbor: fake.swapCbor });
      if (path === "pending-orders") return Response.json({ orders: fake.orders, amount_in_decimal: false });
      if (path === "cancel-tx") return Response.json({ cbor: fake.cancelCbor });
      return new Response("not found", { status: 404 });
    },
  };
  return fake;
}

/** A wallet plus the balance, move-in, mint, transfer, withdraw, send and pending services over the fake Koios and giveme.my. */
export function testBalances(options?: { owned?: boolean; sleep?: (ms: number) => Promise<void> }) {
  const t = testWallet();
  const koios = fakeKoios(options);
  const collateral = fakeCollateral();
  const store = new PrivateStore({ wallet: t.wallet, local: t.local });
  let ids = 0;
  const koiosFor = () => new Koios("https://preprod.koios.rest/api/v1", koios.fetch, async () => undefined);
  const activity = new ActivityService({ wallet: t.wallet, session: t.session, store, koios: koiosFor, local: t.local });
  const coins = new CoinControlService({ wallet: t.wallet, session: t.session, store, now: () => t.clock.now });
  const preferences = new PreferencesService(t.local);
  const coingecko = fakeCoinGecko();
  const minswap = fakeMinswap();
  const dappWindow = fakeWindow();
  let dappChanged = 0;
  const deps = {
    wasm: loadTestWasm(),
    wallet: t.wallet,
    session: t.session,
    local: t.local,
    koios: koiosFor,
    now: () => t.clock.now,
    sleep: options?.sleep ?? (async () => undefined),
    activity,
    coins,
    preferences,
  };
  const sessions = new SessionService({
    ...deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", collateral.fetch),
    store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", minswap.fetch),
  });
  // Lovejoin on its own: the default sessions above come back plainly, as
  // their tests expect; lovejoin.test.ts wires one in.
  const lovejoin = new LovejoinService({
    ...deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", collateral.fetch),
    store,
    preferences,
  });
  return {
    ...t,
    koios,
    collateral,
    deps,
    lovejoin,
    balances: new BalanceService(deps),
    moveIn: new MoveInService(deps),
    mint: new MintService({
      ...deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", collateral.fetch),
    }),
    transfer: new TransferService({
      ...deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", collateral.fetch),
    }),
    withdraw: new WithdrawService({
      ...deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", collateral.fetch),
    }),
    send: new SendService({
      ...deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", collateral.fetch),
    }),
    staking: new StakingService({
      ...deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", collateral.fetch),
    }),
    pending: new PendingService(deps),
    minswap,
    sessions,
    store,
    activity,
    coins,
    preferences,
    coingecko,
    prices: new PriceService({ local: t.local, preferences, now: () => t.clock.now, fetch: coingecko.fetch }),
    contacts: new ContactsService({ wasm: deps.wasm, store, random: () => `c${++ids}` }),
    dappWindow,
    dappChanged: () => dappChanged,
    dapp: new DappService({
      ...deps,
      store,
      sessions,
      fundingPollMs: 1,
      network: "preprod",
      window: dappWindow,
      changed: () => void dappChanged++,
    }),
  };
}

/** The connector's window: counts how often it's shown, and whether it's open. */
export function fakeWindow(): ApprovalWindow & { shown: number; open: boolean } {
  const fake = {
    shown: 0,
    open: false,
    async show() {
      fake.shown++;
      fake.open = true;
    },
    async isOpen() {
      return fake.open;
    },
  };
  return fake;
}

/** CoinGecko's simple price, answering ADA in every currency asked; `fail` makes it refuse. */
export function fakeCoinGecko(rates: Record<string, number> = { usd: 0.25, eur: 0.22, gbp: 0.19, jpy: 39.65 }) {
  const state = { urls: [] as string[], fail: false, rates };
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    state.urls.push(url);
    if (state.fail) return new Response("rate limited", { status: 429 });
    const asked = new URL(url).searchParams.get("vs_currencies")?.split(",") ?? [];
    const cardano = Object.fromEntries(asked.filter((c) => c in state.rates).map((c) => [c, state.rates[c]]));
    return new Response(JSON.stringify({ cardano }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { ...state, state, fetch };
}
