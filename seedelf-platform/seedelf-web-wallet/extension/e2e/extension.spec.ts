import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, chromium, expect, type BrowserContext, type Page } from "@playwright/test";

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

const test = base.extend<{ userDataDir: string; context: BrowserContext }>({
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), "seedelf-e2e-"));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  context: async ({ userDataDir }, use) => {
    const context = await launch(userDataDir);
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
