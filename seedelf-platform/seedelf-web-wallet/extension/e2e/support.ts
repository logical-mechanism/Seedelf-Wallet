// What the end-to-end tests and the store images share: launching Chromium
// with the built extension, a fake Koios and giveme.my over the recorded
// preprod fixtures, and the steps most tests start with.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";

import { txIdOf } from "../tests/fixtures/cbor";

export { expect } from "@playwright/test";

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
  /** What Ogmios answers every evaluation with. */
  evaluation: unknown;
  /** Who holds each NFT, by `policy.name`, for asset_nft_address (ADA Handles). */
  nfts: Map<string, string>;
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
    if (path === "ogmios") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(koios.evaluation) });
    }
    if (path === "asset_nft_address") {
      const query = new URL(request.url()).searchParams;
      const holder = koios.nfts.get(`${query.get("_asset_policy")}.${query.get("_asset_name")}`);
      const rows = holder ? [{ payment_address: holder }] : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    const body = request.postDataJSON();
    if (path === "tx_status") {
      const rows = body._tx_hashes.map((tx_hash: string) => ({ tx_hash, num_confirmations: koios.confirmations }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    const account = koiosPreprod.accounts[body._stake_addresses?.[0]];
    // PostgREST's filter, as the contract scan uses it: `block_height=gt.N`.
    const after = Number(/gt\.(\d+)/.exec(new URL(request.url()).searchParams.get("block_height") ?? "")?.[1] ?? -1);
    const rows =
      path === "credential_utxos"
        ? [...koiosPreprod.contract_utxos, ...ownedUtxos].filter((u) => (u.block_height ?? 0) > after)
        : path === "account_addresses"
          ? (account?.account_addresses ?? [])
          : path === "account_utxos"
            ? (account?.account_utxos ?? [])
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
  await context.route(/^https?:\/\/(?!preprod\.koios\.rest|www\.giveme\.my\/preprod\/collateral\/$)/, (route) =>
    route.abort(),
  );
}

export const test = base.extend<{ scale: number; userDataDir: string; koios: KoiosFake; context: BrowserContext }>({
  /** The device scale factor: 2 for the store images. */
  scale: [1, { option: true }],
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
    });
  },
  context: async ({ scale, userDataDir, koios }, use) => {
    const context = await launch(userDataDir, { scale });
    await fakeKoios(context, koios);
    await use(context);
    await context.close();
  },
});

export async function openApp(context: BrowserContext, view: "popup" | "tab" = "tab"): Promise<Page> {
  const page = await context.newPage();
  if (view === "popup") await page.setViewportSize({ width: 360, height: 640 });
  const app = await appUrl(context);
  await page.goto(view === "tab" ? `${app}?view=tab` : app);
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

/** Home's Cardano account tab. */
export async function cardanoTab(page: Page) {
  await page.getByRole("tab", { name: "Cardano", exact: true }).click();
}

/** Home → Cardano account → Receive: the receive and stake addresses. */
export async function openReceive(page: Page) {
  await cardanoTab(page);
  await page.getByRole("button", { name: "Receive" }).click();
}

export async function setPassword(page: Page, submit: string) {
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: submit }).click();
}
