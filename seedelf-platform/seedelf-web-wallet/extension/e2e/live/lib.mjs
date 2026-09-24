// The live preprod runs' plumbing (run.mjs, flows.mjs): the built extension
// (dist/) in Chromium against the real preprod Koios, Ogmios and giveme.my,
// with nothing intercepted, restored from the test wallet's phrase in
// .preprod-test-wallet.txt (gitignored).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const EXTENSION_ID = "jfekiogplaamnceifeehipmomhojngcb";
const PASSWORD = "live preprod test wallet";

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Launches the extension, restores the test wallet, and waits on Home for its balances. */
export async function openWallet() {
  const dist = fileURLToPath(new URL("../../dist", import.meta.url));
  const file = readFileSync(new URL("../../.preprod-test-wallet.txt", import.meta.url), "utf8");
  const phrase = /^phrase: (.+)$/m.exec(file)[1].trim();
  const dir = mkdtempSync(join(tmpdir(), "seedelf-live-"));
  const context = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const hosts = new Set();
  context.on("request", (r) => hosts.add(new URL(r.url()).host));

  const page = await context.newPage();
  await page.goto(`chrome-extension://${EXTENSION_ID}/index.html?view=tab`);
  await page.getByRole("button", { name: "Restore wallet" }).click();
  await page.getByRole("radio", { name: `${phrase.split(" ").length} words` }).click();
  await page.getByLabel("Word 1", { exact: true }).focus();
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text", text);
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, phrase);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Restore wallet" }).click();
  await page.getByTestId("updated").filter({ hasText: "Updated" }).waitFor({ timeout: 60_000 });

  return {
    page,
    /** Every host the extension contacted, other than itself. */
    hosts: () => [...hosts].filter((h) => h !== EXTENSION_ID),
    close: async () => {
      await context.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Home's balances and seedelfs, on one line. Leaves Home on the Seedelf tab. */
export async function balances(page) {
  await page.getByRole("tab", { name: "Seedelf" }).click();
  const seedelf = await page.getByTestId("seedelf-lovelace").textContent();
  const seedelfs = await page
    .getByTestId("seedelfs")
    .innerText({ timeout: 1000 })
    .catch(() => "(none)");
  await page.getByRole("tab", { name: "Cardano account" }).click();
  const cardano = await page.getByTestId("cardano-lovelace").textContent();
  await page.getByRole("tab", { name: "Seedelf" }).click();
  return `Seedelf ${seedelf} | Cardano ${cardano} | seedelfs: ${seedelfs.replace(/\n/g, " ")}`;
}

/** A seedelf's full name, from its row on Home, by its exact tag. */
export async function seedelfName(page, tag) {
  const row = page.getByTestId("seedelfs").getByRole("listitem").filter({ has: page.getByText(tag, { exact: true }) });
  if ((await row.count()) !== 1) throw new Error(`expected one seedelf tagged "${tag}", found ${await row.count()}`);
  return row.getAttribute("title");
}

/** Presses Review, logs the review and screenshots it, then presses Send. */
export async function reviewAndSend(page, testId, name) {
  await page.getByRole("button", { name: "Review" }).click();
  const review = page.getByTestId(testId);
  await review.waitFor({ timeout: 90_000 }).catch(async () => {
    throw new Error(`no review: ${await page.getByRole("alert").allTextContents()}`);
  });
  log("review:", (await review.innerText()).replace(/\n/g, " | "));
  await page.screenshot({ path: `test-results/live-${name}-review.png`, fullPage: true });
  await page.getByRole("button", { name: "Send" }).click();
}

/** Waits for the sent banner, then for the network to confirm (`text`) and the balances to be read again. */
export async function confirmed(page, text) {
  const banner = page.getByTestId("pending-tx");
  await banner.waitFor({ timeout: 90_000 }).catch(async () => {
    throw new Error(`not sent: ${await page.getByRole("alert").allTextContents()}`);
  });
  const txHash = (await banner.getByRole("link").getAttribute("href")).split("/").pop();
  log("submitted:", txHash);
  // The page asks every 15 s.
  await banner.filter({ hasText: text }).waitFor({ timeout: 10 * 60_000 });
  log("confirmed");
  await page.waitForTimeout(1500);
  await page.getByTestId("updated").filter({ hasText: "Updated" }).waitFor({ timeout: 60_000 });
  return txHash;
}
