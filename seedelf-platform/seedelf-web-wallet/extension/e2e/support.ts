// What the end-to-end tests and the store images share: launching Chromium
// with the built extension, a fake Koios and giveme.my over the recorded
// preprod fixtures, and the steps most tests start with.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, chromium, expect, type BrowserContext, type Locator, type Page, type Request } from "@playwright/test";

import { epochAt, NETWORKS, type NetworkName } from "../src/networks";
import { DAPP_ORIGINS } from "../src/shared/dapp";
import { LOCAL_NETWORK } from "../src/shared/preferences";
import { UI_PORT } from "../src/shared/rpc";
import { bech32, bech32Bytes } from "../tests/fixtures/bech32";
import { txIdOf } from "../tests/fixtures/cbor";
import { asAsked } from "../tests/fixtures/minswap-echo";
import { swapTx } from "../tests/fixtures/swap-tx";

export { expect };

export const dist = fileURLToPath(new URL("../dist", import.meta.url));

/** The ID the dev key in src/manifest.ts pins. A store build has no key, so Chrome picks its ID. */
export const PINNED_ID = "jfekiogplaamnceifeehipmomhojngcb";
export const PASSWORD = "correct horse battery";

const cardanoVectors = JSON.parse(
  readFileSync(new URL("../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url), "utf8"),
).vectors as Array<{
  phrase: string;
  account: number;
  preprod: { receive_0: string; stake: string };
  mainnet: { receive_0: string; stake: string };
}>;
export const vector = (words: number) =>
  cardanoVectors.find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/**
 * The same phrase's CIP-1852 account `index'`, for several accounts (chunk
 * 18). Only the 24-word vector phrase has account 1 recorded, and its values
 * come from `@cardano-sdk/key-management`.
 */
export const accountVector = (words: number, index: number) =>
  cardanoVectors.find((v) => v.account === index && v.phrase.split(" ").length === words)!;

/**
 * Chromium with the extension in `extension` (dist/ by default) loaded. It
 * waits for the service worker, which also learns the extension's ID.
 */
export async function launch(
  userDataDir: string,
  { extension = dist, scale = 1 }: { extension?: string; scale?: number } = {},
): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    deviceScaleFactor: scale,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await extensionId(context);
  return context;
}

/**
 * Puts the wallet in `context` on `network`, as Settings' switch does: the
 * worker reads `seedelf.network` at every request. Set before a page opens,
 * the wallet starts there. A preprod-only build has preprod alone, whatever
 * is set; a mainnet build (the store's) starts on mainnet unless told.
 */
export async function chooseNetwork(context: BrowserContext, network: NetworkName): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await worker.evaluate(([key, value]) => chrome.storage.local.set({ [key]: value }), [LOCAL_NETWORK, network] as const);
}

const ids = new WeakMap<BrowserContext, Promise<string>>();

/** The extension's ID in `context`, from its service worker's URL. */
export function extensionId(context: BrowserContext): Promise<string> {
  let id = ids.get(context);
  if (!id) {
    id = (async () => {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      return new URL(worker.url()).host;
    })();
    ids.set(context, id);
  }
  return id;
}

/** The wallet's page in `context`. */
export const appUrl = async (context: BrowserContext) => `chrome-extension://${await extensionId(context)}/index.html`;

// Koios answers from the recorded preprod fixtures (tests/fixtures), so no
// test touches the live network. Playwright sees the service worker's fetches.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url), "utf8"));
export const koiosPreprod = fixture("koios-preprod.json");
export const ownedUtxos = fixture("owned-utxos.json").owned_utxos;
export const mintPreprod = fixture("mint-preprod.json");
export const accountMintPreprod = fixture("account-mint-preprod.json");
export const transferPreprod = fixture("transfer-preprod.json");
/** Koios's `asset_info` for the 24-word account's NFTs, as recorded (chunk 20, record-nft-images.mjs). */
export const nftImagesPreprod: Array<{ policy_id: string; asset_name: string; answer: unknown[] }> = fixture("nft-images.json").preprod;
export const withdrawPreprod = fixture("withdraw-preprod.json");
export const activityPreprod = fixture("activity-preprod.json");
/** The recorded account's payment keys holding something: `credential_txs` lists its transactions when asked about one. */
const RECORDED_KEYS = new Set<string>(
  koiosPreprod.accounts[activityPreprod.stake].account_utxos.flatMap((u: { payment_cred: string | null }) => u.payment_cred ?? []),
);
export const stakingPreprod = fixture("staking-preprod.json");
/**
 * The recorded governance actions as they stood the day they were recorded, moved on to today's epoch: whether one is
 * open is read against the clock (Governance's `epochAt`), so as recorded they closed for good as time passed (1.6.0's
 * PR, 2026-10-23: preprod's epoch 321 closed the action the vote test opens).
 */
const governance = fixture("governance.json");
const governanceShift = epochAt("preprod", Date.now()) - epochAt("preprod", Date.parse(`${governance.recorded}T12:00:00Z`));
export const governancePreprod = governance.proposal_list.preprod.map((p: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, (k === "expiration" || k.endsWith("_epoch")) && typeof v === "number" ? v + governanceShift : v]),
  ),
);
export const minswapEstimate = fixture("minswap-estimate-preprod.json");
/** Session 0 of the 12-word phrase and its UTxO (wasm/tests/session_test.rs). */
export const sessionSwap = fixture("session-swap.json");
/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
export const lovejoinPool = fixture("lovejoin-pool-preprod.json").pool;

/**
 * A Lovejoin box of `phrase`'s Seedelf key in the pool, as Koios lists it: a
 * fresh copy of its register, made by the WebAssembly module (inWasm).
 */
export function ownedLovejoinBox(phrase: string, tx: string): { payment_cred: string } & Record<string, unknown> {
  const datum = inWasm(
    `const key = wasm.SeedelfKey.fromEntropy(wasm.phraseToEntropy(process.argv[1]), 0);
     process.stdout.write(Buffer.from(wasm.registerToDatum(wasm.rerandomize(key.baseRegister()))).toString("hex"));`,
    phrase,
  );
  return { ...lovejoinPool[0], tx_hash: tx.repeat(32), tx_index: 0, inline_datum: { bytes: datum, value: {} } };
}

/** Public account `account` of `phrase`: its stake address on preprod, as discovery asks Koios about it (chunk 18). */
export function accountStake(phrase: string, account: number): string {
  return inWasm(
    `process.stdout.write(wasm.CardanoAccount.fromPhrase(process.argv[1], Number(process.argv[2])).stakeAddress(wasm.Network.Preprod));`,
    phrase,
    String(account),
  );
}

/**
 * One-time account `index` of `phrase` (CIP-1852 account `24301'`, private
 * session `index`'s) on preprod: its address and payment key hash, which
 * credential_utxos finds what it holds by, and its own stake address, which
 * the restore's scan asks `account_addresses` about (chunk 27).
 */
export function oneTimeAccount(phrase: string, index: number): { address: string; keyHash: string; stake: string } {
  return JSON.parse(
    inWasm(
      `const keys = wasm.OneTimeAccounts.fromPhrase(process.argv[1]);
       const i = Number(process.argv[2]);
       const net = wasm.Network.Preprod;
       process.stdout.write(JSON.stringify({ address: keys.address(net, i), keyHash: keys.keyHash(i), stake: keys.rewardAddress(net, i) }));`,
      phrase,
      String(index),
    ),
  );
}

/**
 * What `code` writes to stdout, run with the WebAssembly module as `wasm` and
 * `args` in `process.argv` from 1, in a Node of its own, since Playwright's
 * loader can't load the module's ES code.
 */
function inWasm(code: string, ...args: string[]): string {
  const pkg = new URL("../../wasm/pkg/", import.meta.url);
  const script = `
    import { readFileSync } from "node:fs";
    const wasm = await import(${JSON.stringify(new URL("seedelf_wasm.js", pkg).href)});
    wasm.initSync({ module: readFileSync(new URL(${JSON.stringify(new URL("seedelf_wasm_bg.wasm", pkg).href)})) });
    ${code}
  `;
  return execFileSync(process.execPath, ["--input-type=module", "-e", script, ...args], {
    env: { ...process.env, NODE_OPTIONS: "" },
    encoding: "utf8",
  });
}
/**
 * Koios says a mix made each of `txs` (tx_info: one of its inputs sat at
 * Lovejoin's mix_box): a box the wallet finds with no record of its own, whose
 * making it asks of before it takes it (independent review M14).
 */
export function madeByMix(koios: Pick<KoiosFake, "txSpends">, ...txs: string[]): void {
  const input = { payment_addr: { bech32: "addr_test1", cred: NETWORKS.preprod.lovejoin!.mixBox } };
  for (const tx of txs) koios.txSpends.set(tx, [input]);
}

const epochParams = JSON.parse(
  readFileSync(new URL("../../../seedelf-core/tests/fixtures/epoch_params.json", import.meta.url), "utf8"),
);

export interface KoiosFake {
  calls: string[];
  /** When set, every request fails with this status. */
  failWith?: number;
  /** When set, every answer waits this long (ms), as a slow Koios would. */
  delayMs?: number;
  /** Transactions submitted, by id: each that reached the network. */
  submitted: string[];
  /**
   * How submittx answers the nth transaction sent (from 1), when not as
   * usual: `timeout` takes it and never answers, as a gateway that timed out
   * (it may have gone through); a status refuses it with `body`.
   */
  submitAnswer?: (n: number) => "timeout" | { status: number; body: string } | undefined;
  /** What tx_status reports: for every transaction, or for each by its id. */
  confirmations: number | null | ((txHash: string) => number | null);
  /** giveme.my's answer; by default its recorded refusal of a transaction it can't validate. */
  collateral: { status: number; body: unknown };
  /** Transactions giveme.my was asked to witness. */
  collateralAsked: number;
  /** What Ogmios answers every evaluation with; or a function of the request. */
  evaluation: unknown;
  /** Who holds each NFT, by `policy.name`, for asset_nft_address (ADA Handles). */
  nfts: Map<string, string>;
  /** Each stake key's account_info, by stake address: the recorded 12-word account's to begin with. */
  stakes: Map<string, Record<string, unknown>>;
  /**
   * Which stake addresses `account_addresses` answers as used, past the
   * recorded accounts, each one asked about in a request of several too, as
   * Koios answers: how a second public account is put on the chain for
   * discovery to find (chunk 18), or a private session's one-time account
   * for a restore's scan (chunk 27).
   */
  usedStakes: Set<string>;
  /**
   * The first stake address of every `account_addresses` request, in order: discovery asks one at a time, a
   * restore's scan 20 at a time, one-time account 0's first.
   */
  stakesAsked: string[];
  /**
   * Each stake key's transactions for `account_txs`, newest first, by stake address: a one-time account's, which
   * only a restore's scan asks for. `tx_info` has a row for each, as Koios always has, spending nothing the
   * fixtures know of unless `txSpends` says.
   */
  accountTxs: Map<string, Array<{ tx_hash: string; block_height: number; block_time: number }>>;
  /** UTxOs under other payment keys, as credential_utxos finds them: a private session's, say. */
  addedToAccounts: Array<{ payment_cred: string } & Record<string, unknown>>;
  /** More wallet-contract UTxOs: a private balance of many, as boxes brought back from Lovejoin leave it. */
  addedToContract: Array<{ tx_hash: string; tx_index: number; block_height?: number } & Record<string, unknown>>;
  /** Outpoints (`txhash#index`) the chain has spent, as utxo_info marks them: an order a batcher filled, say. */
  spent: Set<string>;
  /**
   * Every output the fixtures don't list is spent, as utxo_info answers once
   * a session's return landed: its funding's outputs among them (a session
   * ends only once Koios shows those spent, independent review M4).
   */
  unlistedSpent: boolean;
  /** What transactions the recordings don't hold spent, for `tx_info`, by hash: one that made a Lovejoin box, say. */
  txSpends: Map<string, Array<{ payment_addr: { bech32: string; cred?: string | null } }>>;
  /**
   * What mainnet's Koios lists in place of a recorded token, by its preprod
   * unit (`policy.name`): the store images show mainnet's tokens. Tokens not
   * named keep their preprod units.
   */
  mainnetTokens: Map<string, { policy_id: string; asset_name: string; fingerprint: string; decimals?: number }>;
  /** `asset_info`'s answer for each token, by `policy.name`: the recorded NFTs' metadata (chunk 20). */
  assets: Map<string, unknown[]>;
  /** More DReps for `drep_info`, by ID: the account's own, once registered, say (chunk 21). */
  dreps: Map<string, Record<string, unknown>>;
  /** Every DRep's votes, for `vote_list`. */
  votes: Array<{ voter_id: string; proposal_id: string; vote: string; block_time: number }>;
  /** Requests a page made instead of the worker (`byWorker`): there must be none. */
  strays: string[];
}

/** Minswap's aggregator, for swaps in private sessions. */
export interface MinswapFake {
  calls: Array<{ path: string; body: any }>;
  /** Its token list, searched by ticker. */
  tokens: Array<Record<string, unknown>>;
  estimate: unknown;
  swapCbor: string;
  orders: unknown[];
  /** While set, quotes and builds answer 429, as Minswap's rate limit does. */
  limited?: boolean;
  /** Requests a page made instead of the worker (`byWorker`): there must be none. */
  strays: string[];
}

/**
 * Who asked: the worker, or a page. Only the worker talks to Koios, giveme.my
 * and Minswap. A page that does is running the worker's code itself (a page
 * chunk that imports sw.js runs all of it), a second worker beside the real
 * one; `strays` keeps its requests, and the test fails.
 */
function byWorker(request: Request, strays: string[]): boolean {
  if (request.serviceWorker()) return true;
  strays.push(request.url());
  return false;
}

/**
 * `text` as `to` writes it, when it's a Shelley address or a stake address:
 * the same keys, with the other network's prefix and network tag
 * (`addr_test1…` is `addr1…`, `stake_test1…` is `stake1…`). Anything else
 * comes back as it is.
 */
function retag(text: string, to: NetworkName): string {
  const prefixes: Record<string, string> =
    to === "mainnet" ? { addr_test: "addr", stake_test: "stake" } : { addr: "addr_test", stake: "stake_test" };
  const prefix = prefixes[text.slice(0, text.lastIndexOf("1"))];
  if (!prefix) return text;
  let bytes: Uint8Array;
  try {
    bytes = bech32Bytes(text);
  } catch {
    return text;
  }
  bytes[0] = (bytes[0]! & 0xf0) | (to === "mainnet" ? 1 : 0);
  return bech32(prefix, bytes);
}

/** `value` with every address in it retagged for `to`, and each token `tokens` names swapped for its stand-in. */
function onNetwork(value: unknown, to: NetworkName, tokens?: KoiosFake["mainnetTokens"]): unknown {
  if (typeof value === "string") return retag(value, to);
  if (Array.isArray(value)) return value.map((v) => onNetwork(v, to, tokens));
  if (!value || typeof value !== "object") return value;
  const row = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, onNetwork(v, to, tokens)]));
  const token = tokens?.get(`${row.policy_id}.${row.asset_name}`);
  return token ? { ...row, ...token } : row;
}

async function fakeKoios(context: BrowserContext, koios: KoiosFake) {
  let submits = 0;
  // Mainnet's Koios answers from the same recordings: a phrase's keys are the same on both networks, so a test
  // that switches to mainnet sees the recorded account there too. Its requests' addresses are read as preprod's,
  // and its answers' written as mainnet's (onNetwork).
  await context.route(/^https:\/\/(preprod|api)\.koios\.rest\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split("/").pop()!;
    const mainnet = new URL(request.url()).host === "api.koios.rest";
    const fulfill = (answer: { status: number; contentType?: string; body: string }) =>
      route.fulfill(
        mainnet && answer.contentType === "application/json"
          ? { ...answer, body: JSON.stringify(onNetwork(JSON.parse(answer.body), "mainnet", koios.mainnetTokens)) }
          : answer,
      );
    if (byWorker(request, koios.strays)) koios.calls.push(path);
    if (koios.delayMs) await new Promise((resolve) => setTimeout(resolve, koios.delayMs));
    if (koios.failWith) return fulfill({ status: koios.failWith, body: "" });
    if (path === "submittx") {
      const id = txIdOf(new Uint8Array(request.postDataBuffer()!));
      const answer = koios.submitAnswer?.(++submits);
      if (answer !== undefined && answer !== "timeout") {
        return fulfill({ status: answer.status, contentType: "text/plain", body: answer.body });
      }
      koios.submitted.push(id);
      if (answer === "timeout") return route.abort("timedout");
      return fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(id) });
    }
    if (path === "epoch_params") {
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(epochParams) });
    }
    if (path === "tip") {
      // The chain's slot now: a second each since preprod's start, or mainnet's Shelley start.
      const since = new URL(request.url()).host.startsWith("preprod.") ? 1_655_683_200 : 1_591_566_291;
      const rows = [{ abs_slot: Math.floor(Date.now() / 1000) - since }];
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    if (path === "proposal_list" || path === "vote_list") {
      // vote_list's filters, as the wallet uses them: `voter_id=eq.X&proposal_id=in.(a,b)`.
      const query = new URL(request.url()).searchParams;
      const voter = query.get("voter_id")?.replace(/^eq\./, "");
      const rows =
        path === "proposal_list"
          ? governancePreprod
          : koios.votes.filter((v) => v.voter_id === voter).map(({ voter_id: _voter, ...v }) => v);
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    if (path === "pool_list" || path === "totals") {
      const rows = path === "pool_list" ? stakingPreprod.pool_list : stakingPreprod.totals;
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    if (path === "ogmios") {
      const answer =
        typeof koios.evaluation === "function" ? (koios.evaluation as (body: any) => unknown)(request.postDataJSON()) : koios.evaluation;
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
    }
    if (path === "asset_nft_address") {
      const query = new URL(request.url()).searchParams;
      const holder = koios.nfts.get(`${query.get("_asset_policy")}.${query.get("_asset_name")}`);
      const rows = holder ? [{ payment_address: holder }] : [];
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    const body = mainnet ? (onNetwork(request.postDataJSON(), "preprod") as any) : request.postDataJSON();
    if (path === "account_txs" || path === "credential_txs" || path === "tx_info") {
      const query = new URL(request.url()).searchParams;
      // Activity asks by the account's payment keys: the recorded account's when one of them holds something. Only a
      // restore's scan asks by a stake key, about one-time accounts: theirs are what the tests add.
      const listed: Array<{ tx_hash: string; block_height: number }> =
        path === "credential_txs"
          ? (body._payment_credentials as string[]).some((c) => RECORDED_KEYS.has(c))
            ? activityPreprod.account_txs
            : []
          : (koios.accountTxs.get(body._stake_address) ?? []);
      const all: Array<{ tx_hash: string; block_height?: number }> =
        path === "tx_info"
          ? [
              ...activityPreprod.tx_info.filter((t: { tx_hash: string }) => body._tx_hashes.includes(t.tx_hash)),
              // And a row for every transaction a one-time account's `account_txs` lists, as Koios has: a restore's scan
              // fails without it (1.5.0's release review, C14).
              ...[...new Set([...koios.txSpends.keys(), ...[...koios.accountTxs.values()].flat().map((t) => t.tx_hash)])]
                .filter((h) => body._tx_hashes.includes(h))
                .map((tx_hash) => ({ tx_hash, inputs: koios.txSpends.get(tx_hash) ?? [] })),
            ]
          : // From `_after_block_height`'s own block on, as Koios and the data layer answer (1.5.0's release review, C03).
            listed.filter((t) => body._after_block_height === undefined || t.block_height >= body._after_block_height);
      const offset = Number(query.get("offset") ?? 0);
      const rows = path === "tx_info" ? all : all.slice(offset, offset + Number(query.get("limit") ?? 1000));
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    if (path === "tx_status") {
      const confirmations = (tx: string) => (typeof koios.confirmations === "function" ? koios.confirmations(tx) : koios.confirmations);
      const rows = body._tx_hashes.map((tx_hash: string) => ({ tx_hash, num_confirmations: confirmations(tx_hash) }));
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    const staking: Record<string, (b: any) => unknown[]> = {
      account_info: (b) => b._stake_addresses.flatMap((s: string) => koios.stakes.get(s) ?? []),
      pool_info: (b) => stakingPreprod.pool_info.filter((p: any) => b._pool_bech32_ids.includes(p.pool_id_bech32)),
      drep_info: (b) => [...stakingPreprod.drep_info, ...koios.dreps.values()].filter((d: any) => b._drep_ids.includes(d.drep_id)),
      drep_metadata: (b) => stakingPreprod.drep_metadata.filter((d: any) => b._drep_ids.includes(d.drep_id)),
    };
    if (staking[path]) {
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(staking[path]!(body)) });
    }
    if (path === "asset_info") {
      const rows = (body._asset_list as string[][]).flatMap(([policy, name]) => koios.assets.get(`${policy}.${name}`) ?? []);
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    if (path === "utxo_info") {
      // Any UTxO the fixtures know, spent or not, as Koios answers; one known only as spent, by its outpoint alone.
      const refs: string[] = body._utxo_refs;
      const ref = (u: { tx_hash: string; tx_index: number }) => `${u.tx_hash}#${u.tx_index}`;
      const known = [
        ...koiosPreprod.contract_utxos,
        ...ownedUtxos,
        ...Object.values(koiosPreprod.accounts as Record<string, { account_utxos: unknown[] }>).flatMap((a) => a.account_utxos),
        ...koios.addedToAccounts,
        ...koios.addedToContract,
      ] as Array<{ tx_hash: string; tx_index: number }>;
      const spent = (r: string) => koios.spent.has(r) || (koios.unlistedSpent && !known.some((u) => ref(u) === r));
      const found = known.filter((u) => refs.includes(ref(u))).map((u) => ({ ...u, is_spent: spent(ref(u)) }));
      const gone = refs
        .filter((r) => spent(r) && !found.some((u) => ref(u) === r))
        .map((r) => ({ tx_hash: r.split("#")[0], tx_index: Number(r.split("#")[1]), is_spent: true }));
      return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([...found, ...gone]) });
    }
    // One a request, whatever its size: the tests count requests by it.
    if (path === "account_addresses" && body._stake_addresses?.[0]) koios.stakesAsked.push(body._stake_addresses[0]);
    // PostgREST's filter, as the contract scan uses it: `block_height=gt.N`.
    const after = Number(/gt\.(\d+)/.exec(new URL(request.url()).searchParams.get("block_height") ?? "")?.[1] ?? -1);
    // credential_utxos: the wallet contract's, or the accounts' by payment key. The recorded account's are
    // koios-preprod.json's `account_utxos`, read by its stake key on 2026-09-24 at 01:04Z: they lack its outputs under
    // no stake key or another's (38ccfdf0#0, 0e8d3924#1, 84d3e93a#0), and activity-preprod.json, recorded to a later
    // block, goes on to transactions that spend all six (tests/fixtures/record-activity.mjs UNTIL).
    const credentials: string[] = body?._payment_credentials ?? [];
    const byKey = [
      ...Object.values(koiosPreprod.accounts as Record<string, { account_utxos: Array<{ payment_cred: string }> }>).flatMap(
        (a) => a.account_utxos,
      ),
      ...koios.addedToAccounts,
    ].filter((u) => credentials.includes(u.payment_cred));
    const rows =
      path === "credential_utxos"
        ? credentials.includes(koiosPreprod.wallet_contract)
          ? [...koiosPreprod.contract_utxos, ...ownedUtxos, ...koios.addedToContract].filter((u) => (u.block_height ?? 0) > after)
          : byKey
        : path === "account_addresses"
          ? // A row for every stake address asked about that some address used, as Koios answers a batch of them.
            (body._stake_addresses as string[]).flatMap(
              (stake_address) =>
                koiosPreprod.accounts[stake_address]?.account_addresses ??
                (koios.usedStakes.has(stake_address) ? [{ stake_address, addresses: [`addr_of_${stake_address}`] }] : []),
            )
          : null;
    if (!rows) return fulfill({ status: 404, body: "" });
    return fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  await context.route("https://www.giveme.my/preprod/collateral/", async (route) => {
    if (byWorker(route.request(), koios.strays)) koios.collateralAsked++;
    return route.fulfill({
      status: koios.collateral.status,
      contentType: "application/json",
      body: JSON.stringify(koios.collateral.body),
    });
  });
  // Nothing else leaves the browser.
  await context.route(
    /^https?:\/\/(?!(preprod|api)\.koios\.rest\/|www\.giveme\.my\/preprod\/collateral\/$|aggr\.monorepo-testnet-preprod\.minswap\.org)/,
    (route) => route.abort(),
  );
}

async function fakeMinswap(context: BrowserContext, swaps: MinswapFake) {
  await context.route("https://aggr.monorepo-testnet-preprod.minswap.org/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split("/").pop()!;
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    if (byWorker(request, swaps.strays)) swaps.calls.push({ path, body });
    const answer = (value: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "tokens") {
      const q = String(body.query).toLowerCase();
      return answer({ tokens: swaps.tokens.filter((t) => String(t.ticker).toLowerCase().includes(q)), search_after: [] });
    }
    if (swaps.limited && (path === "estimate" || path === "build-tx")) {
      return route.fulfill({ status: 429, body: "Rate limit exceeded, retry in 50 seconds" });
    }
    if (path === "estimate") return answer(asAsked(swaps.estimate, body));
    if (path === "build-tx") return answer({ cbor: swaps.swapCbor });
    if (path === "pending-orders") return answer({ orders: swaps.orders, amount_in_decimal: false });
    return route.fulfill({ status: 404, body: "" });
  });
}

/**
 * A copy of the build that Chrome lets onto sites from install: the dApp
 * connector's optional host permissions made required. Chrome asks the user
 * for them in a dialog of its own, which automation can't answer, so the
 * connector's tests start past it; everything after it is the real build.
 */
function withSiteAccess(extension: string, into: string): string {
  cpSync(extension, into, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(into, "manifest.json"), "utf8"));
  manifest.host_permissions = [...manifest.host_permissions, ...DAPP_ORIGINS];
  writeFileSync(join(into, "manifest.json"), JSON.stringify(manifest, null, 2));
  return into;
}

export const test = base.extend<{
  scale: number;
  siteAccess: boolean;
  network: NetworkName;
  userDataDir: string;
  koios: KoiosFake;
  swaps: MinswapFake;
  context: BrowserContext;
}>({
  /** The device scale factor: 2 for the store images. */
  scale: [1, { option: true }],
  /** Chrome's access to sites granted from install, for the dApp connector's tests. */
  siteAccess: [false, { option: true }],
  /**
   * The network the wallet starts on, set before any page opens. Preprod, as
   * the fakes answer: the suite runs on a dev build and on the store's
   * mainnet build alike.
   */
  network: ["preprod", { option: true }],
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), "seedelf-e2e-"));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  koios: async ({}, use) => {
    await use({
      calls: [],
      submitted: [],
      confirmations: null,
      collateral: { status: mintPreprod.collateral.status, body: mintPreprod.collateral.answer },
      collateralAsked: 0,
      // The real preprod evaluation of a stealth mint of the 12-word phrase's 25 ₳ UTxO.
      evaluation: mintPreprod.evaluation,
      nfts: new Map(),
      stakes: new Map(stakingPreprod.account_info.map((a: { stake_address: string }) => [a.stake_address, a])),
      usedStakes: new Set<string>(),
      stakesAsked: [],
      accountTxs: new Map(),
      addedToAccounts: [],
      addedToContract: [],
      spent: new Set(),
      unlistedSpent: false,
      txSpends: new Map(),
      mainnetTokens: new Map(),
      assets: new Map(nftImagesPreprod.map((r) => [`${r.policy_id}.${r.asset_name}`, r.answer])),
      dreps: new Map(),
      votes: [],
      strays: [],
    });
  },
  swaps: async ({}, use) => {
    await use({
      calls: [],
      tokens: [
        {
          token_id: minswapEstimate.ask.tokenOut,
          ticker: "MIN",
          project_name: "Minswap",
          decimals: 6,
          is_verified: true,
          logo: null,
          price_by_ada: null,
        },
      ],
      estimate: minswapEstimate.estimate,
      // Its order carries the datum it names by hash, as Minswap's do: the runner won't sign one that doesn't.
      swapCbor: swapTx(),
      orders: [],
      strays: [],
    });
  },
  context: async ({ scale, siteAccess, network, userDataDir, koios, swaps }, use) => {
    const extension = siteAccess ? withSiteAccess(dist, `${userDataDir}-extension`) : dist;
    const context = await launch(userDataDir, { scale, extension });
    await chooseNetwork(context, network);
    await fakeKoios(context, koios);
    await fakeMinswap(context, swaps);
    await use(context);
    await context.close();
    if (siteAccess) rmSync(extension, { recursive: true, force: true });
    expect([...koios.strays, ...swaps.strays], "only the worker asks Koios, giveme.my and Minswap").toEqual([]);
  },
});

/**
 * The IPFS gateway an NFT's image comes from (chunk 20), answering every file
 * with `file`. Keeps each request: its path, and the headers it went out with.
 * Only the worker may ask it, as every service.
 */
export async function fakeGateway(context: BrowserContext, file: Buffer, contentType = "image/png") {
  const asked: Array<{ path: string; headers: Record<string, string> }> = [];
  const strays: string[] = [];
  await context.route("https://ipfs.blockfrost.dev/**", async (route) => {
    const request = route.request();
    if (byWorker(request, strays)) asked.push({ path: new URL(request.url()).pathname, headers: await request.allHeaders() });
    return route.fulfill({ status: 200, contentType, body: file });
  });
  return { asked, strays };
}

/** A dApp's page, served at https://dapp.example/ (the only site the tests reach). */
export async function openDapp(context: BrowserContext): Promise<Page> {
  await context.route("https://dapp.example/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Test dApp</title><p>A dApp</p>",
    }),
  );
  const page = await context.newPage();
  await page.goto("https://dapp.example/");
  return page;
}

/** The app in a full tab, or narrow as the side panel shows it (360 px, Chrome's default width). */
export async function openApp(context: BrowserContext, view: "panel" | "tab" = "tab"): Promise<Page> {
  const page = await context.newPage();
  if (view === "panel") await page.setViewportSize({ width: 360, height: 640 });
  const app = await appUrl(context);
  await page.goto(`${app}?view=${view}`);
  return page;
}

/** Restores `phrase` through the UI: paste into the first box, then set the password. */
export async function restore(page: Page, phrase: string) {
  await page.getByRole("button", { name: "Restore wallet" }).click();
  await page.getByLabel("Word 1", { exact: true }).focus();
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text", text);
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, phrase);
  await page.getByRole("button", { name: "Continue" }).click();
  await setPassword(page, "Restore wallet");
}

/**
 * Waits until the restore of a phrase that used nothing past account 0 has
 * asked Koios all it asks unprompted: three `account_addresses`, the balance
 * reading's for account 0, then in the background the look for a second
 * public account's (chunk 18), and after its answer the scan's of the first
 * 20 one-time accounts (chunk 27). A test that counts requests from here
 * can't count one of those (1.5.0's release review, C44).
 */
export async function lookedAfterRestore(koios: KoiosFake): Promise<void> {
  await expect.poll(() => koios.calls.filter((c) => c === "account_addresses")).toHaveLength(3);
}

/**
 * A full-page screenshot, for looking at: transitions finished, and each
 * screen's foot in the flow instead of stuck over what scrolls under it.
 * (The page's CSP refuses an injected stylesheet, so the foot is moved
 * through the CSSOM, which CSP allows.)
 */
export async function snap(page: Page, name: string) {
  const feet = (position: string) =>
    page.evaluate((p) => {
      for (const el of document.querySelectorAll<HTMLElement>(".screen__foot")) el.style.position = p;
    }, position);
  await feet("static");
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true, animations: "disabled" });
  await feet("");
}

/** Picks tokens in a form's "Add tokens" picker: the ones named, or every one. */
export async function addTokens(page: Page, names?: string[], within: Page | Locator = page) {
  await within.getByRole("button", { name: /^Add (more )?tokens$/ }).click();
  const picker = page.getByRole("dialog", { name: "Add tokens" });
  if (names) for (const name of names) await picker.getByRole("button", { name, exact: true }).click();
  else await picker.getByRole("button", { name: /^Select all/ }).click();
  await picker.getByRole("button", { name: /^Add \d+ tokens?$/ }).click();
  await expect(picker).toHaveCount(0);
}

/** Home's Public tab (the Cardano account). */
export async function cardanoTab(page: Page) {
  await page.getByRole("tab", { name: "Public", exact: true }).click();
}

/** Home → Public → Receive: the receive and stake addresses. */
export async function openReceive(page: Page) {
  await cardanoTab(page);
  await page.getByRole("button", { name: "Receive" }).click();
}

export async function setPassword(page: Page, submit: string) {
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: submit }).click();
}

/**
 * Asks the worker from a wallet page as the UI does, on a port of its own
 * (ui/background.ts): its reply, and how long it took in the page (ms).
 */
export function askWorker(page: Page, message: { type: string } & Record<string, unknown>): Promise<{ reply: any; ms: number }> {
  return page.evaluate(
    ([m, name]) =>
      new Promise<{ reply: any; ms: number }>((resolve, reject) => {
        const started = performance.now();
        const port = chrome.runtime.connect({ name });
        port.onMessage.addListener((reply) => {
          // A build says what it's doing on this same port before it answers
          // (background/ui-port.ts). Those aren't the reply: waiting for the
          // reply is the whole point, and disconnecting here would drop it.
          if (reply && typeof reply === "object" && "stage" in reply && !("ok" in reply)) return;
          port.disconnect();
          resolve({ reply, ms: performance.now() - started });
        });
        port.onDisconnect.addListener(() => reject(new Error("The worker didn't answer.")));
        port.postMessage(m);
      }),
    [message, UI_PORT] as const,
  );
}
