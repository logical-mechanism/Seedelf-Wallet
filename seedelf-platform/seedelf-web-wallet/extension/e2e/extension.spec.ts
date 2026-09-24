import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, chromium, expect, type BrowserContext, type Page } from "@playwright/test";

import { txIdOf } from "../tests/fixtures/cbor";

const dist = fileURLToPath(new URL("../dist", import.meta.url));

// Pinned by the dev key in src/manifest.ts.
const EXTENSION_ID = "jfekiogplaamnceifeehipmomhojngcb";
const APP = `chrome-extension://${EXTENSION_ID}/index.html`;
const PASSWORD = "correct horse battery";

const cardanoVectors = JSON.parse(
  readFileSync(new URL("../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url), "utf8"),
).vectors as Array<{ phrase: string; account: number; preprod: { receive_0: string; stake: string } }>;
const vector = (words: number) =>
  cardanoVectors.find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

function launch(userDataDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
}

// Koios answers from the recorded preprod fixtures (tests/fixtures), so no
// test touches the live network. Playwright sees the service worker's fetches.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url), "utf8"));
const koiosPreprod = fixture("koios-preprod.json");
const ownedUtxos = fixture("owned-utxos.json").owned_utxos;
const mintPreprod = fixture("mint-preprod.json");
const accountMintPreprod = fixture("account-mint-preprod.json");
const transferPreprod = fixture("transfer-preprod.json");
const withdrawPreprod = fixture("withdraw-preprod.json");
const epochParams = JSON.parse(
  readFileSync(new URL("../../../seedelf-core/tests/fixtures/epoch_params.json", import.meta.url), "utf8"),
);

interface KoiosFake {
  calls: string[];
  /** When set, every request fails with this status. */
  failWith?: number;
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
    const rows =
      path === "credential_utxos"
        ? [...koiosPreprod.contract_utxos, ...ownedUtxos]
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

const test = base.extend<{ userDataDir: string; koios: KoiosFake; context: BrowserContext }>({
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
  context: async ({ userDataDir, koios }, use) => {
    const context = await launch(userDataDir);
    await fakeKoios(context, koios);
    await use(context);
    await context.close();
  },
});

async function openApp(context: BrowserContext, view: "popup" | "tab" = "tab"): Promise<Page> {
  const page = await context.newPage();
  if (view === "popup") await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(view === "tab" ? `${APP}?view=tab` : APP);
  return page;
}

/** Restores `phrase` through the UI: paste into the first box, then set the password. */
async function restore(page: Page, phrase: string) {
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

async function setPassword(page: Page, submit: string) {
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: submit }).click();
}

test("the extension loads with the pinned ID and a module service worker", async ({ context }) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  expect(worker.url()).toBe(`chrome-extension://${EXTENSION_ID}/sw.js`);
});

test("the popup welcomes a new user and hands onboarding to a full tab", async ({ context }) => {
  const popup = await openApp(context, "popup");
  await expect(popup.getByTestId("network")).toHaveText("PREPROD");
  await expect(popup.getByRole("img", { name: "Seedelf Wallet" })).toBeVisible();
  await popup.screenshot({ path: "test-results/welcome.png" });

  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    popup.getByRole("button", { name: "Restore wallet" }).click(),
  ]);
  await expect(tab).toHaveURL(`${APP}?view=tab#restore`);
  await expect(tab.getByRole("heading", { name: "Restore a wallet" })).toBeVisible();
});

test("create: reveal, confirm three words, set a password, then lock and unlock", async ({ context }) => {
  const page = await openApp(context);
  await page.getByRole("button", { name: "Create new wallet" }).click();

  const phrase = page.getByTestId("recovery-phrase");
  await expect(phrase.locator(".word__text").first()).toHaveText("••••••");
  await expect(page.getByRole("button", { name: "I've written it down" })).toBeDisabled();
  await page.getByRole("button", { name: "Reveal phrase" }).click();
  const words = await phrase.locator(".word__text").allTextContents();
  expect(words).toHaveLength(24);
  await page.screenshot({ path: "test-results/create-phrase.png", fullPage: true });
  await page.getByRole("button", { name: "I've written it down" }).click();

  // Three random positions; a wrong word is caught.
  const boxes = page.getByRole("combobox");
  await expect(boxes).toHaveCount(3);
  const positions = await boxes.evaluateAll((els) =>
    els.map((el) => Number(el.getAttribute("aria-label")!.replace("Word ", ""))),
  );
  for (const p of positions) await page.getByLabel(`Word ${p}`, { exact: true }).fill(words[p - 1]!);
  await page.getByLabel(`Word ${positions[0]}`, { exact: true }).fill(words[positions[0]! - 1] === "zoo" ? "abandon" : "zoo");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alert")).toContainText(`Word ${positions[0]} doesn't match`);
  await page.getByLabel(`Word ${positions[0]}`, { exact: true }).fill(words[positions[0]! - 1]!);
  await page.getByRole("button", { name: "Confirm" }).click();

  // Password: too short, then mismatched, then good.
  await page.getByLabel("Password", { exact: true }).fill("short");
  await expect(page.getByTestId("password-hint")).toContainText("at least 12 characters");
  await expect(page.getByRole("button", { name: "Create wallet" })).toBeDisabled();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(`${PASSWORD}x`);
  await expect(page.getByText("The passwords don't match.")).toBeVisible();
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create wallet" }).click();

  await expect(page.getByTestId("receive-address")).toHaveText(/^addr_test1q/);
  await expect(page.getByTestId("stake-address")).toHaveText(/^stake_test1u/);
  await expect(page.getByTestId("seedelf-public-value")).toHaveText(/^[0-9a-f]{10}…[0-9a-f]{10}$/);
  const address = await page.getByTestId("receive-address").textContent();
  await page.screenshot({ path: "test-results/home.png", fullPage: true });

  // Reopening the app keeps it unlocked.
  const popup = await openApp(context, "popup");
  await expect(popup.getByTestId("receive-address")).toHaveText(address!);
  await popup.screenshot({ path: "test-results/home-popup.png", fullPage: true });

  // Lock: every open page follows the worker.
  await page.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(popup.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByTestId("receive-address")).toHaveText(address!);
  await expect(popup.getByTestId("receive-address")).toHaveText(address!);
});

test("restore: a pasted vector phrase gives its Lace-matching address", async ({ context }) => {
  const v = vector(15);
  const page = await openApp(context);
  await restore(page, v.phrase);
  await expect(page.getByTestId("receive-address")).toHaveText(v.preprod.receive_0);
  await expect(page.getByTestId("stake-address")).toHaveText(v.preprod.stake);
});

test("restore: per-word autocomplete and the Rust core's reasons", async ({ context }) => {
  const v = vector(12);
  const words = v.phrase.split(" ");
  const page = await openApp(context);
  await page.getByRole("button", { name: "Restore wallet" }).click();
  await page.getByRole("radio", { name: "12 words" }).click();
  await expect(page.getByRole("combobox")).toHaveCount(12);

  // Type a prefix and take the suggestion with Enter; focus moves on.
  const first = page.getByLabel("Word 1", { exact: true });
  await first.pressSequentially(words[0]!.slice(0, 3));
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.screenshot({ path: "test-results/restore-autocomplete.png", fullPage: true });
  await page.getByRole("option", { name: words[0]!, exact: true }).click();
  await expect(first).toHaveValue(words[0]!);
  await expect(page.getByLabel("Word 2", { exact: true })).toBeFocused();

  // Unknown words are flagged once the box loses focus.
  await page.getByLabel("Word 2", { exact: true }).fill("notaword");
  await page.getByLabel("Word 3", { exact: true }).focus();
  await expect(page.getByLabel("Word 2", { exact: true })).toHaveAttribute("aria-invalid", "true");

  // The rest, in the wrong order: the checksum fails with the core's reason.
  for (let i = 1; i < 12; i++) {
    await page.getByLabel(`Word ${i + 1}`, { exact: true }).fill(words[12 - i]!);
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("checksum");

  for (let i = 1; i < 12; i++) await page.getByLabel(`Word ${i + 1}`, { exact: true }).fill(words[i]!);
  await page.getByRole("button", { name: "Continue" }).click();
  await setPassword(page, "Restore wallet");
  await expect(page.getByTestId("receive-address")).toHaveText(v.preprod.receive_0);
});

test("a wrong password starts the back-off", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(24).phrase);
  await page.getByRole("button", { name: "Lock" }).click();

  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong password.");
  await expect(page.getByTestId("retry-after")).toContainText("Try again in");
  await page.getByLabel("Password").fill(PASSWORD);
  await expect(page.getByRole("button", { name: "Unlock" })).toBeDisabled();
  await page.screenshot({ path: "test-results/unlock-backoff.png", fullPage: true });

  // The countdown ends and the right password works.
  await expect(page.getByRole("button", { name: "Unlock" })).toBeEnabled({ timeout: 5000 });
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByTestId("receive-address")).toHaveText(vector(24).preprod.receive_0);
});

test("forgot password: reset, then restore from the phrase", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(24).phrase);
  await page.getByRole("button", { name: "Lock" }).click();
  await page.getByRole("button", { name: "Forgot password? Restore from your phrase" }).click();
  await expect(page.getByRole("button", { name: "Delete and restore" })).toBeDisabled();
  await page.getByLabel("Type delete wallet to confirm").fill("delete wallet");
  await page.getByRole("button", { name: "Delete and restore" }).click();
  await expect(page.getByRole("heading", { name: "Restore a wallet" })).toBeVisible();
});

test("a browser restart comes back locked; unlock takes well under 1.5 s", async ({ context, userDataDir }) => {
  const page = await openApp(context);
  await restore(page, vector(24).phrase);
  await expect(page.getByTestId("receive-address")).toHaveText(vector(24).preprod.receive_0);
  await context.close();

  const restarted = await launch(userDataDir);
  try {
    const again = await openApp(restarted);
    await expect(again.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    // Time the worker's unlock: Argon2id (pure JS) plus key derivation (WASM).
    const millis = await again.evaluate(async (password) => {
      const started = performance.now();
      const reply = await chrome.runtime.sendMessage({ type: "unlock", password });
      if (!reply?.ok || !reply.value.unlocked) throw new Error(JSON.stringify(reply));
      return performance.now() - started;
    }, PASSWORD);
    test.info().annotations.push({ type: "unlock-ms", description: String(Math.round(millis)) });
    console.log(`unlock in the service worker: ${Math.round(millis)} ms`);
    expect(millis).toBeLessThan(1500);
    await expect(again.getByTestId("receive-address")).toHaveText(vector(24).preprod.receive_0);
  } finally {
    await restarted.close();
  }
});

const lovelaceOf = (utxos: Array<{ value: string }>) => utxos.reduce((n, u) => n + BigInt(u.value), 0n);
const ada = (lovelace: bigint) => {
  const whole = (lovelace / 1_000_000n).toLocaleString("en-US");
  const fraction = (lovelace % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

test("home shows the Seedelf balance, seedelfs and the Cardano account", async ({ context, koios }) => {
  const v = vector(12);
  const page = await openApp(context);
  await restore(page, v.phrase);

  // Synthetic owned contract UTxOs: 25 + 3 ADA, a token, and a seedelf with 1.5 ADA.
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await expect(page.getByTestId("seedelf-tokens")).toContainText("tUSDM");
  await expect(page.getByTestId("seedelf-tokens")).toContainText("1,234.56");
  await expect(page.getByTestId("seedelfs")).toContainText("web-wallet");
  await expect(page.getByTestId("seedelfs")).toContainText("1.5 ₳");

  // The real preprod account of this public test phrase.
  const account = koiosPreprod.accounts[v.preprod.stake];
  await expect(page.getByTestId("cardano-lovelace")).toHaveText(`${ada(lovelaceOf(account.account_utxos))} ₳`);
  await expect(page.getByText("4 addresses used")).toBeVisible();
  await expect(page.getByTestId("cardano-tokens")).toContainText("LINK");
  await expect(page.getByTestId("updated")).toHaveText("Updated just now");
  expect(koios.calls.sort()).toEqual(["account_addresses", "account_utxos", "credential_utxos"]);

  await page.getByRole("button", { name: "Show QR code" }).click();
  const qr = page.getByRole("img", { name: "QR code of the receive address" });
  await expect(qr).toBeVisible();
  await qr.screenshot({ path: "test-results/receive-qr.png" });
  await page.screenshot({ path: "test-results/home-balances.png", fullPage: true });

  // The popup opens from the worker's reading; Refresh reads the chain again.
  const popup = await openApp(context, "popup");
  await expect(popup.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await popup.screenshot({ path: "test-results/home-balances-popup.png", fullPage: true });
  expect(koios.calls).toHaveLength(3);
  await popup.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => koios.calls.length).toBe(6);
  await expect(popup.getByTestId("updated")).toHaveText("Updated just now");
});

test("home says so when Koios can't be read", async ({ context, koios }) => {
  koios.failWith = 400;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByRole("alert")).toContainText("Koios refused the request (400");
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("— ₳");

  koios.failWith = undefined;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("move in: amount and a token, review, send, then watch it confirm", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Move in" }).click();

  // ADA has 6 decimal places: extra digits are dropped, with a note; letters are refused.
  await page.getByLabel("Amount").fill("10.1234567890");
  await expect(page.getByLabel("Amount")).toHaveValue("10.123456");
  await expect(page.getByTestId("move-in-amount-note")).toContainText("at most 6 decimal places");
  await page.getByLabel("Amount").pressSequentially("9");
  await expect(page.getByLabel("Amount")).toHaveValue("10.123456");
  await page.getByLabel("Amount").fill("abc");
  await expect(page.getByLabel("Amount")).toHaveValue("10.123456");
  await expect(page.getByTestId("move-in-amount-note")).toContainText("Enter an amount in ADA");

  // No more than all the ADA there is; no more than the account holds.
  await page.getByLabel("Amount").fill("99999999999999999999999999999999999999999");
  await expect(page.getByLabel("Amount")).toHaveValue("10.123456");
  await expect(page.getByTestId("move-in-amount-note")).toContainText("45 billion");
  await page.getByLabel("Amount").fill("20000");
  await expect(page.getByTestId("move-in-too-much")).toContainText("That's more than the 10,350.538725 ₳");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();

  // A non-round amount gets the privacy nudge; a round one doesn't.
  await page.getByLabel("Amount").fill("25.5");
  await expect(page.getByTestId("move-in-amount-note")).toHaveCount(0);
  await expect(page.locator(".callout--warn")).toContainText("Round amounts");
  await page.getByLabel("Amount").fill("25");
  await expect(page.locator(".callout--warn")).toHaveCount(0);
  await page.getByRole("checkbox", { name: /tUSDM/ }).check();
  await page.screenshot({ path: "test-results/move-in-form.png", fullPage: true });
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("move-in-review");
  await expect(review).toContainText("Into Seedelf25 ₳");
  await expect(review).toContainText("3,000,000,000 tUSDM");
  await expect(review).toContainText("Network fee");
  await page.screenshot({ path: "test-results/move-in-review.png", fullPage: true });
  expect(koios.submitted).toHaveLength(0);
  await page.getByRole("button", { name: "Send" }).click();

  // Home shows the sent transaction, linked to the explorer.
  const banner = page.getByTestId("pending-tx");
  await expect(banner).toContainText("Move-in sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  const [txId] = koios.submitted;
  await expect(banner.getByRole("link")).toHaveAttribute("href", `https://preprod.cardanoscan.io/transaction/${txId}`);
  await expect(page.getByRole("button", { name: "Move in" })).toBeDisabled();
  await page.screenshot({ path: "test-results/move-in-sent.png", fullPage: true });

  // Reopening the wallet resumes the watch; once confirmed, balances are read again.
  koios.confirmations = 2;
  const readsBefore = koios.calls.filter((c) => c === "credential_utxos").length;
  const popup = await openApp(context, "popup");
  await expect(popup.getByTestId("pending-tx")).toContainText("Move-in confirmed");
  await expect.poll(() => koios.calls.filter((c) => c === "credential_utxos").length).toBeGreaterThan(readsBefore);
  await popup.getByRole("button", { name: "Dismiss" }).click();
  await expect(popup.getByTestId("pending-tx")).toHaveCount(0);
});

test("move in: Max, and an amount that's too big", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Move in" }).click();

  // Just under the balance: the UI allows it, but the fee doesn't fit, and the builder says so.
  await page.getByLabel("Amount").fill("10350.5");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("alert")).toContainText("Not enough ADA");

  await page.getByRole("button", { name: "Max" }).click();
  await expect(page.getByText("UTxOs of exactly 5 ₳ stay put")).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("move-in-review")).toContainText("Back to your Cardano account");
  await page.getByRole("button", { name: "← Back" }).click();
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.getByTestId("seedelf-lovelace")).toBeVisible();
  expect(koios.submitted).toHaveLength(0);
});

test("create a seedelf from the Cardano account: review, send, then watch it confirm", async ({ context, koios }) => {
  koios.evaluation = accountMintPreprod.evaluation;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Create a seedelf" }).click();

  // The Cardano account pays by default, and says what that links.
  await expect(page.getByRole("button", { name: "Cardano account" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mint-from-note")).toContainText("create your seedelf before moving money in");
  await page.getByLabel("Personal tag (optional)").fill("first");
  await page.screenshot({ path: "test-results/account-mint-form.png", fullPage: true });
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("mint-review");
  await expect(review).toContainText("Seedelffirst");
  await expect(review).toContainText("Paid fromCardano account");
  await expect(review).toContainText("Locked with it1.74986 ₳");
  await expect(review).toContainText("Back to your Cardano account");
  await page.screenshot({ path: "test-results/account-mint-review.png", fullPage: true });
  expect(koios.submitted).toHaveLength(0);

  // Signed at review: Send only submits, and giveme.my is never asked.
  await page.getByRole("button", { name: "Send" }).click();
  const banner = page.getByTestId("pending-tx");
  await expect(banner).toContainText("Seedelf mint sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  expect(koios.collateralAsked).toBe(0);
  await expect(page.getByRole("button", { name: "Create a seedelf" })).toBeDisabled();
  koios.confirmations = 1;
  const popup = await openApp(context, "popup");
  await expect(popup.getByTestId("pending-tx")).toContainText("Seedelf created");
});

test("create a seedelf from the Seedelf balance: tag rules, review, and nothing sent without giveme.my's real signature", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Create a seedelf" }).click();
  await page.getByRole("button", { name: "Seedelf balance" }).click();
  await expect(page.getByTestId("mint-from-note")).toContainText("A stealth mint");

  // The tag: printable ASCII, 15 characters at most, previewed as it will read.
  const tag = page.getByLabel("Personal tag (optional)");
  await expect(page.getByTestId("mint-preview")).toContainText("Listed as Unnamed");
  await tag.fill("héllo");
  await expect(page.getByRole("alert")).toContainText("not “é”");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await tag.fill("a tag far too long for it");
  await expect(tag).toHaveValue("a tag far too l");
  await tag.fill("my tag");
  await expect(page.getByTestId("mint-preview")).toContainText("Listed as my tag");
  await expect(page.getByTestId("mint-preview")).toContainText("5eed0e1f6d7920746167…");
  await page.screenshot({ path: "test-results/mint-form.png", fullPage: true });
  await page.getByRole("button", { name: "Review" }).click();

  // Ogmios measured it; giveme.my hasn't heard of it yet.
  const review = page.getByTestId("mint-review");
  await expect(review).toContainText("Seedelfmy tag");
  await expect(review).toContainText("Locked with it1.74986 ₳");
  await expect(review).toContainText("Network fee0.2");
  await expect(review).toContainText("Back to your Seedelf balance22.99");
  expect(koios.calls).toContain("ogmios");
  expect(koios.collateralAsked).toBe(0);
  await page.screenshot({ path: "test-results/mint-review.png", fullPage: true });

  // giveme.my refuses (its answer to a transaction it can't validate).
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("refused this transaction: Transaction Fails Validation");
  // A witness that isn't giveme.my's key over this transaction is caught in WebAssembly.
  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't match this transaction, so it wasn't sent");
  expect(koios.collateralAsked).toBe(2);
  expect(koios.submitted).toHaveLength(0);
  await page.screenshot({ path: "test-results/mint-refused.png", fullPage: true });

  await page.getByRole("button", { name: "← Back" }).click();
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.getByTestId("seedelfs")).toContainText("web-wallet");
});

test("send to a seedelf: paste its name, see it found, review, and nothing sent without giveme.my's real signature", async ({ context, koios }) => {
  koios.evaluation = transferPreprod.evaluation;
  const theirs: string = transferPreprod.to;
  const mine: string = ownedUtxos[2].asset_list[0].asset_name;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");

  // Each of your seedelfs has its full name one click away, to give out or paste.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const copy = page.getByRole("button", { name: "Copy the name of web-wallet" });
  await copy.click();
  await expect(copy).toHaveText("Copied");
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  expect(await clipboard()).toBe(mine);
  await page.getByRole("button", { name: "Send to a seedelf" }).click();

  // Only a whole name is looked up; pasted in capitals with spaces, it still is one.
  const name = page.getByLabel("Seedelf name");
  const note = page.getByTestId("transfer-to-note");
  await name.fill(theirs.slice(0, 40));
  await expect(note).toContainText("64 hex characters starting 5eed0e1f");
  await name.fill(`5eed0e1f${"00".repeat(28)}`);
  await expect(note).toContainText("No seedelf with that name on preprod.");
  await name.fill(await clipboard());
  await expect(note).toContainText("Found: web-wallet");
  await expect(page.getByTestId("transfer-own")).toContainText("This seedelf is yours");
  await name.fill(` ${theirs.slice(0, 32).toUpperCase()} ${theirs.slice(32)} `);
  await expect(note).toContainText("Found: This is a test.");
  await expect(page.getByTestId("transfer-own")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();

  // 5 ₳ and 1 tUSDM, of the 1,234.56 held.
  await page.getByLabel("Amount", { exact: true }).fill("5");
  const tusdm = page.getByLabel("Amount of tUSDM");
  await tusdm.fill("2000");
  await expect(page.getByText("That's more than the 1,234.56 you hold.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await tusdm.fill("1");
  await page.screenshot({ path: "test-results/transfer-form.png", fullPage: true });
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("transfer-review");
  await expect(review).toContainText("ToThis is a test.");
  await expect(review).toContainText("Amount5 ₳");
  await expect(review).toContainText("1 tUSDM");
  await expect(review).toContainText("Network fee0.273922 ₳");
  await expect(review).toContainText("Back to your Seedelf balance22.726078 ₳ and 1 token");
  await expect(review).toContainText("Seedelf UTxOs spent2");
  expect(koios.calls).toContain("ogmios");
  expect(koios.collateralAsked).toBe(0);
  // Koios was only ever asked about the whole contract, never the recipient's token.
  expect(koios.calls.filter((c) => c.startsWith("asset"))).toEqual([]);
  await page.screenshot({ path: "test-results/transfer-review.png", fullPage: true });

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("refused this transaction: Transaction Fails Validation");
  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't match this transaction, so it wasn't sent");
  expect(koios.collateralAsked).toBe(2);
  expect(koios.submitted).toHaveLength(0);
});

test("withdraw: a handle or an address, own-account warning, review, and nothing sent without giveme.my's real signature", async ({ context, koios }) => {
  koios.evaluation = withdrawPreprod.amount.evaluation;
  const theirs: string = vector(15).preprod.receive_0;
  koios.nfts.set(`f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a.${Buffer.from("bob").toString("hex")}`, theirs);
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Withdraw" }).click();

  // The destination is read as it's typed: an address, or a handle through Koios.
  const to = page.getByLabel("To", { exact: true });
  const note = page.getByTestId("withdraw-to-note");
  await to.fill("nope");
  await expect(note).toContainText("isn't a Cardano address");
  await to.fill(vector(12).preprod.receive_0);
  await expect(note).toContainText("Sends to");
  await expect(page.getByTestId("withdraw-own")).toContainText("This is your own Cardano account");
  await to.fill("$nobody");
  await expect(note).toContainText("No ADA Handle $nobody on preprod.");
  await to.fill("$bob");
  await expect(note).toContainText("$bob is");
  await expect(page.getByTestId("withdraw-own")).toHaveCount(0);

  // Max hides the token amounts; an amount brings them back.
  await page.getByRole("button", { name: "Max" }).click();
  await expect(page.getByTestId("withdraw-max-note")).toContainText("up to 20 UTxOs");
  await expect(page.getByLabel("Amount of tUSDM")).toHaveCount(0);
  await page.getByRole("button", { name: "Max" }).click();
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await page.getByLabel("Amount of tUSDM").fill("1");
  await page.screenshot({ path: "test-results/withdraw-form.png", fullPage: true });
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("withdraw-review");
  await expect(review).toContainText("To$bob");
  await expect(review).toContainText("Amount5 ₳");
  await expect(review).toContainText("1 tUSDM");
  await expect(review).toContainText(`Network fee${Number(withdrawPreprod.amount.final.fee.total) / 1e6} ₳`);
  await expect(review).toContainText("Seedelf UTxOs spent2");
  expect(koios.collateralAsked).toBe(0);
  await page.screenshot({ path: "test-results/withdraw-review.png", fullPage: true });

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("refused this transaction: Transaction Fails Validation");
  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't match this transaction, so it wasn't sent");
  expect(koios.submitted).toHaveLength(0);
});

test("remove a seedelf: where its ADA goes, review, and nothing sent without giveme.my's real signature", async ({ context, koios }) => {
  koios.evaluation = withdrawPreprod.remove.evaluation;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelfs")).toContainText("web-wallet");
  await page.getByRole("button", { name: "Remove web-wallet" }).click();

  await expect(page.getByRole("heading", { name: "Remove web-wallet" })).toBeVisible();
  const note = page.getByTestId("remove-to-note");
  await expect(note).toContainText("links nothing new");
  await page.getByRole("button", { name: "Seedelf balance" }).click();
  await expect(note).toContainText("ties the seedelf's name to the new UTxO");
  await page.getByRole("button", { name: "Cardano account" }).click();
  await page.screenshot({ path: "test-results/remove-form.png", fullPage: true });
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("remove-review");
  const fee = Number(withdrawPreprod.remove.final.fee.total);
  await expect(review).toContainText("Seedelfweb-wallet");
  await expect(review).toContainText(`Back to your Cardano account${(1_500_000 - fee) / 1e6} ₳`);
  await expect(review).toContainText(`Network fee${fee / 1e6} ₳`);
  await page.screenshot({ path: "test-results/remove-review.png", fullPage: true });

  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't match this transaction, so it wasn't sent");
  expect(koios.submitted).toHaveLength(0);
});

test("a worker that lost its WASM file explains itself and recovers", async ({ userDataDir }) => {
  // A rebuild under a running extension: the old worker asks for a deleted file.
  const copy = mkdtempSync(join(tmpdir(), "seedelf-dist-"));
  cpSync(dist, copy, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`],
  });
  try {
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const assets = join(copy, "assets");
    const wasm = readdirSync(assets).find((f) => f.endsWith(".wasm"))!;
    renameSync(join(assets, wasm), join(assets, "moved.wasm"));

    const page = await openApp(context);
    await expect(page.getByRole("heading", { name: "The wallet couldn't start" })).toBeVisible();
    await expect(page.getByTestId("startup-error")).toContainText("The wallet's core didn't load");
    await expect(page.getByTestId("startup-error")).toContainText("reload it");
    await expect(page.getByRole("button", { name: "Reload the extension" })).toBeVisible();
    await page.screenshot({ path: "test-results/startup-error.png", fullPage: true });

    // The failed load isn't cached: once the file is back, Try again works.
    renameSync(join(assets, "moved.wasm"), join(assets, wasm));
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("button", { name: "Create new wallet" })).toBeVisible();
  } finally {
    await context.close();
    rmSync(copy, { recursive: true, force: true });
  }
});
