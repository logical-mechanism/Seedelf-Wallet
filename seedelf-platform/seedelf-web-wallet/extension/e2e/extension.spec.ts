import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { test as base, chromium, expect, type BrowserContext } from "@playwright/test";

const dist = fileURLToPath(new URL("../dist", import.meta.url));

// Pinned by the dev key in src/manifest.ts.
const EXTENSION_ID = "jfekiogplaamnceifeehipmomhojngcb";

const cardanoVectors = JSON.parse(
  readFileSync(new URL("../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url), "utf8"),
).vectors as Array<{ phrase: string; account: number; preprod: { receive_0: string; stake: string } }>;

const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    await use(context);
    await context.close();
  },
});

test("the extension loads with the pinned ID and a module service worker", async ({ context }) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  expect(worker.url()).toBe(`chrome-extension://${EXTENSION_ID}/sw.js`);
});

test("the popup derives Lace-matching keys in the service worker", async ({ context }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`chrome-extension://${EXTENSION_ID}/index.html`);

  await expect(page.getByTestId("network")).toHaveText("PREPROD");

  // A typed phrase gives the same addresses Lace's library does.
  const vector = cardanoVectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 24)!;
  await page.getByLabel("Recovery phrase").fill(vector.phrase);
  await page.getByRole("button", { name: "Derive" }).click();
  await expect(page.getByTestId("receive-address")).toHaveText(vector.preprod.receive_0);
  await expect(page.getByTestId("stake-address")).toHaveText(vector.preprod.stake);

  // A generated phrase fills the box and derives preprod keys.
  await page.getByRole("button", { name: "Generate test phrase" }).click();
  await expect(page.getByTestId("receive-address")).toHaveText(/^addr_test1q/);
  await expect(page.getByLabel("Recovery phrase")).toHaveValue(/^(\S+ ){23}\S+$/);
  await page.screenshot({ path: "test-results/popup.png", fullPage: true });

  // Bad input shows the Rust core's reason.
  await page.getByLabel("Recovery phrase").fill("abandon abandon");
  await page.getByRole("button", { name: "Derive" }).click();
  await expect(page.getByRole("alert")).toContainText("12, 15 or 24 words");
});

test("the full-tab view renders the same app", async ({ context }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${EXTENSION_ID}/index.html?view=tab`);
  await expect(page.getByTestId("network")).toHaveText("PREPROD");
  await expect(page.getByRole("button", { name: "Open in tab" })).toHaveCount(0);
  await page.getByRole("button", { name: "Generate test phrase" }).click();
  await expect(page.getByTestId("receive-address")).toHaveText(/^addr_test1q/);
  await page.screenshot({ path: "test-results/tab.png", fullPage: true });
});
