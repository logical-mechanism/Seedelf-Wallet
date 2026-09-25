// What the end-to-end tests and the store images share: launching Chromium
// with the built extension, a fake Koios and giveme.my over the recorded
// preprod fixtures, and the steps most tests start with.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, chromium, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { DAPP_ORIGINS } from "../src/shared/dapp";
import { txIdOf } from "../tests/fixtures/cbor";

export { expect };

export const dist = fileURLToPath(new URL("../dist", import.meta.url));

/** The ID the dev key in src/manifest.ts pins. A store build has no key, so Chrome picks its ID. */
export const PINNED_ID = "jfekiogplaamnceifeehipmomhojngcb";
export const PASSWORD = "correct horse battery";

const cardanoVectors = JSON.parse(
  readFileSync(new URL("../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url), "utf8"),
).vectors as Array<{ phrase: string; account: number; preprod: { receive_0: string; stake: string } }>;
export const vector = (words: number) =>
  cardanoVectors.find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

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
export const withdrawPreprod = fixture("withdraw-preprod.json");
export const activityPreprod = fixture("activity-preprod.json");
export const stakingPreprod = fixture("staking-preprod.json");
export const minswapEstimate = fixture("minswap-estimate-preprod.json");
/** Session 0 of the 12-word phrase, its UTxO, and a swap from it (wasm/tests/session_test.rs). */
export const sessionSwap = fixture("session-swap.json");
/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
export const lovejoinPool = fixture("lovejoin-pool-preprod.json").pool;
const epochParams = JSON.parse(
  readFileSync(new URL("../../../seedelf-core/tests/fixtures/epoch_params.json", import.meta.url), "utf8"),
);

export interface KoiosFake {
  calls: string[];
  /** When set, every request fails with this status. */
  failWith?: number;
  /** When set, every answer waits this long (ms), as a slow Koios would. */
  delayMs?: number;
  /** Transactions submitted, by id. */
  submitted: string[];
  /** What tx_status reports. */
  confirmations: number | null;
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
  /** UTxOs under other payment keys, as credential_utxos finds them: a private session's, say. */
  addedToAccounts: Array<{ payment_cred: string } & Record<string, unknown>>;
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
}

async function fakeKoios(context: BrowserContext, koios: KoiosFake) {
  await context.route("https://preprod.koios.rest/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split("/").pop()!;
    koios.calls.push(path);
    if (koios.delayMs) await new Promise((resolve) => setTimeout(resolve, koios.delayMs));
    if (koios.failWith) return route.fulfill({ status: koios.failWith, body: "" });
    if (path === "submittx") {
      const id = txIdOf(new Uint8Array(request.postDataBuffer()!));
      koios.submitted.push(id);
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(id) });
    }
    if (path === "epoch_params") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(epochParams) });
    }
    if (path === "pool_list" || path === "totals") {
      const rows = path === "pool_list" ? stakingPreprod.pool_list : stakingPreprod.totals;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    if (path === "ogmios") {
      const answer =
        typeof koios.evaluation === "function" ? (koios.evaluation as (body: any) => unknown)(request.postDataJSON()) : koios.evaluation;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
    }
    if (path === "asset_nft_address") {
      const query = new URL(request.url()).searchParams;
      const holder = koios.nfts.get(`${query.get("_asset_policy")}.${query.get("_asset_name")}`);
      const rows = holder ? [{ payment_address: holder }] : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    const body = request.postDataJSON();
    if (path === "account_txs" || path === "tx_info") {
      const query = new URL(request.url()).searchParams;
      const all: Array<{ tx_hash: string; block_height: number }> =
        path === "tx_info"
          ? activityPreprod.tx_info.filter((t: { tx_hash: string }) => body._tx_hashes.includes(t.tx_hash))
          : body._stake_address === activityPreprod.stake
            ? activityPreprod.account_txs.filter(
                (t: { block_height: number }) =>
                  body._after_block_height === undefined || t.block_height > body._after_block_height,
              )
            : [];
      const offset = Number(query.get("offset") ?? 0);
      const rows = path === "tx_info" ? all : all.slice(offset, offset + Number(query.get("limit") ?? 1000));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    if (path === "tx_status") {
      const rows = body._tx_hashes.map((tx_hash: string) => ({ tx_hash, num_confirmations: koios.confirmations }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    const staking: Record<string, (b: any) => unknown[]> = {
      account_info: (b) => b._stake_addresses.flatMap((s: string) => koios.stakes.get(s) ?? []),
      pool_info: (b) => stakingPreprod.pool_info.filter((p: any) => b._pool_bech32_ids.includes(p.pool_id_bech32)),
      drep_info: (b) => stakingPreprod.drep_info.filter((d: any) => b._drep_ids.includes(d.drep_id)),
      drep_metadata: (b) => stakingPreprod.drep_metadata.filter((d: any) => b._drep_ids.includes(d.drep_id)),
    };
    if (staking[path]) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(staking[path]!(body)) });
    }
    const account = koiosPreprod.accounts[body._stake_addresses?.[0]];
    // PostgREST's filter, as the contract scan uses it: `block_height=gt.N`.
    const after = Number(/gt\.(\d+)/.exec(new URL(request.url()).searchParams.get("block_height") ?? "")?.[1] ?? -1);
    // credential_utxos: the wallet contract's, or the accounts' by payment key.
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
          ? [...koiosPreprod.contract_utxos, ...ownedUtxos].filter((u) => (u.block_height ?? 0) > after)
          : byKey
        : path === "account_addresses"
          ? (account?.account_addresses ?? [])
          : null;
    if (!rows) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  await context.route("https://www.giveme.my/preprod/collateral/", async (route) => {
    koios.collateralAsked++;
    return route.fulfill({
      status: koios.collateral.status,
      contentType: "application/json",
      body: JSON.stringify(koios.collateral.body),
    });
  });
  // Nothing else leaves the browser.
  await context.route(
    /^https?:\/\/(?!preprod\.koios\.rest|www\.giveme\.my\/preprod\/collateral\/$|aggr\.monorepo-testnet-preprod\.minswap\.org)/,
    (route) => route.abort(),
  );
}

async function fakeMinswap(context: BrowserContext, swaps: MinswapFake) {
  await context.route("https://aggr.monorepo-testnet-preprod.minswap.org/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split("/").pop()!;
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    swaps.calls.push({ path, body });
    const answer = (value: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "tokens") {
      const q = String(body.query).toLowerCase();
      return answer({ tokens: swaps.tokens.filter((t) => String(t.ticker).toLowerCase().includes(q)), search_after: [] });
    }
    if (swaps.limited && (path === "estimate" || path === "build-tx")) {
      return route.fulfill({ status: 429, body: "Rate limit exceeded, retry in 50 seconds" });
    }
    if (path === "estimate") return answer(swaps.estimate);
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
  userDataDir: string;
  koios: KoiosFake;
  swaps: MinswapFake;
  context: BrowserContext;
}>({
  /** The device scale factor: 2 for the store images. */
  scale: [1, { option: true }],
  /** Chrome's access to sites granted from install, for the dApp connector's tests. */
  siteAccess: [false, { option: true }],
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
      addedToAccounts: [],
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
      swapCbor: sessionSwap.swapCbor,
      orders: [],
    });
  },
  context: async ({ scale, siteAccess, userDataDir, koios, swaps }, use) => {
    const extension = siteAccess ? withSiteAccess(dist, `${userDataDir}-extension`) : dist;
    const context = await launch(userDataDir, { scale, extension });
    await fakeKoios(context, koios);
    await fakeMinswap(context, swaps);
    await use(context);
    await context.close();
    if (siteAccess) rmSync(extension, { recursive: true, force: true });
  },
});

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
