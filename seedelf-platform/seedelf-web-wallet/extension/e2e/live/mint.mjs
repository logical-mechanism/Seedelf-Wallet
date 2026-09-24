// Live preprod run: drive the built extension (dist/) against the real
// preprod Koios, Ogmios and giveme.my, with nothing intercepted, and create
// a seedelf from the test wallet's Seedelf balance. It submits a REAL
// preprod transaction. Run move-in.mjs first: the mint is paid from Seedelf.
//
//   npm run build && node e2e/live/mint.mjs [tag]      (default tag "live-mint")
//
// Reads the test wallet's phrase from .preprod-test-wallet.txt (gitignored).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const tag = process.argv[2] ?? "live-mint";
const dist = fileURLToPath(new URL("../../dist", import.meta.url));
const wallet = readFileSync(new URL("../../.preprod-test-wallet.txt", import.meta.url), "utf8");
const phrase = /^phrase: (.+)$/m.exec(wallet)[1].trim();
const APP = "chrome-extension://jfekiogplaamnceifeehipmomhojngcb/index.html";
const PASSWORD = "live preprod test wallet";

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "seedelf-live-")), {
  channel: "chromium",
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const hosts = new Set();
context.on("request", (r) => hosts.add(new URL(r.url()).host));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

try {
  const page = await context.newPage();
  await page.goto(`${APP}?view=tab`);
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
  const seedelfsBefore = await page.getByTestId("seedelfs").innerText().catch(() => "(none)");
  log("before:", "seedelf", await page.getByTestId("seedelf-lovelace").textContent(), "| seedelfs", seedelfsBefore.replace(/\n/g, " "));

  await page.getByRole("button", { name: "Create a seedelf" }).click();
  await page.getByLabel("Personal tag (optional)").fill(tag);
  await page.getByRole("button", { name: "Review" }).click();
  const review = page.getByTestId("mint-review");
  await review.waitFor({ timeout: 60_000 }).catch(async () => {
    throw new Error(`no review: ${await page.getByRole("alert").allTextContents()}`);
  });
  log("review:", (await review.innerText()).replace(/\n/g, " | "));
  await page.screenshot({ path: "test-results/live-mint-review.png", fullPage: true });
  await page.getByRole("button", { name: "Send" }).click();

  const banner = page.getByTestId("pending-tx");
  await banner.waitFor({ timeout: 60_000 }).catch(async () => {
    throw new Error(`not sent: ${await page.getByRole("alert").allTextContents()}`);
  });
  const txHash = (await banner.getByRole("link").getAttribute("href")).split("/").pop();
  log("submitted:", txHash);

  // The page asks every 15 s; wait for it to see the confirmation.
  await banner.filter({ hasText: "Seedelf created" }).waitFor({ timeout: 10 * 60_000 });
  log("confirmed");
  await page.getByTestId("seedelfs").filter({ hasText: tag }).waitFor({ timeout: 60_000 });
  log("after:", "seedelf", await page.getByTestId("seedelf-lovelace").textContent(), "| seedelfs", (await page.getByTestId("seedelfs").innerText()).replace(/\n/g, " "));
  await page.screenshot({ path: "test-results/live-mint-after.png", fullPage: true });
  log("hosts contacted:", [...hosts].filter((h) => !h.startsWith("jfek")).join(", "));
  console.log(`https://preprod.cardanoscan.io/transaction/${txHash}`);
} finally {
  await context.close();
}
