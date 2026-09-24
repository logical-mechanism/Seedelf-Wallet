import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  accountMintPreprod,
  appUrl,
  cardanoTab,
  dist,
  expect,
  extensionId,
  koiosPreprod,
  launch,
  openApp,
  openReceive,
  ownedUtxos,
  PASSWORD,
  PINNED_ID,
  restore,
  setPassword,
  snap,
  test,
  transferPreprod,
  vector,
  withdrawPreprod,
} from "./support";

test("the extension loads with a module service worker, and a dev build with the pinned ID", async ({ context }) => {
  const id = await extensionId(context);
  expect(context.serviceWorkers().map((w) => w.url())).toContain(`chrome-extension://${id}/sw.js`);
  // A store build has no key, so Chrome derives the ID from the folder instead.
  const { key } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  if (key) expect(id).toBe(PINNED_ID);
  else expect(id).toMatch(/^[a-p]{32}$/);
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
  await expect(tab).toHaveURL(`${await appUrl(context)}?view=tab#restore`);
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
  await snap(page, "create-phrase");
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

  // Home opens on the Seedelf tab, with the first steps in the order that keeps them apart.
  await expect(page.getByTestId("getting-started")).toContainText("Fund your Cardano account");
  await snap(page, "home");

  // Step one's Receive shows the account's addresses.
  await page.getByTestId("getting-started").getByRole("button", { name: "Receive" }).click();
  await expect(page.getByTestId("receive-address")).toHaveText(/^addr_test1q/);
  await expect(page.getByTestId("stake-address")).toHaveText(/^stake_test1u/);
  const address = await page.getByTestId("receive-address").textContent();

  // Reopening the app keeps it unlocked, on the same wallet.
  const popup = await openApp(context, "popup");
  await expect(popup.getByTestId("getting-started")).toContainText("Fund your Cardano account");
  await snap(popup, "home-popup");
  await openReceive(popup);
  await expect(popup.getByTestId("receive-address")).toHaveText(address!);

  // Lock: every open page follows the worker.
  await page.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(popup.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByTestId("getting-started")).toBeVisible();
  await expect(popup.getByTestId("getting-started")).toBeVisible();
  await openReceive(popup);
  await expect(popup.getByTestId("receive-address")).toHaveText(address!);
});

test("restore: a pasted vector phrase gives its Lace-matching address", async ({ context }) => {
  const v = vector(15);
  const page = await openApp(context);
  await restore(page, v.phrase);
  await openReceive(page);
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
  await snap(page, "restore-autocomplete");
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
  await openReceive(page);
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
  await snap(page, "unlock-backoff");

  // The countdown ends and the right password works.
  await expect(page.getByRole("button", { name: "Unlock" })).toBeEnabled({ timeout: 5000 });
  await page.getByRole("button", { name: "Unlock" }).click();
  await openReceive(page);
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
  await openReceive(page);
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
    await openReceive(again);
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
  await cardanoTab(page);
  const account = koiosPreprod.accounts[v.preprod.stake];
  await expect(page.getByTestId("cardano-lovelace")).toHaveText(`${ada(lovelaceOf(account.account_utxos))} ₳`);
  await expect(page.getByText("4 addresses used")).toBeVisible();
  await expect(page.getByTestId("cardano-tokens")).toContainText("LINK");
  await expect(page.getByTestId("updated")).toHaveText("Updated just now");
  expect(koios.calls.sort()).toEqual(["account_addresses", "account_utxos", "credential_utxos"]);

  await snap(page, "home-cardano");

  await page.getByRole("button", { name: "Receive" }).click();
  const qr = page.getByRole("img", { name: "QR code of the receive address" });
  await expect(qr).toBeVisible();
  await qr.screenshot({ path: "test-results/receive-qr.png" });
  await snap(page, "receive");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("tab", { name: "Seedelf" }).click();
  await expect(page.getByTestId("seedelfs")).toBeVisible();
  await snap(page, "home-balances");

  // The popup opens from the worker's reading; Refresh reads the chain again.
  const popup = await openApp(context, "popup");
  await expect(popup.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await snap(popup, "home-balances-popup");
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

test("the first reading shows the splash, which fades into the wallet; a kept reading doesn't", async ({ context, koios }) => {
  koios.delayMs = 1500;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("splash")).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading your wallet" })).toBeVisible();
  const popup = await openApp(context, "popup");
  await expect(popup.getByTestId("splash")).toBeVisible();
  await page.screenshot({ path: "test-results/splash.png" });
  await popup.screenshot({ path: "test-results/popup-splash.png" });

  await expect(page.getByTestId("splash")).toHaveCount(0);
  await expect(page.getByTestId("seedelf-lovelace")).toBeVisible();
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await expect(popup.getByTestId("splash")).toHaveCount(0);

  // The worker keeps the reading, so a popup opened now goes straight to it.
  koios.delayMs = undefined;
  const again = await openApp(context, "popup");
  await expect(again.getByTestId("seedelf-lovelace")).toBeVisible();
  await expect(again.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await expect(again.getByTestId("splash")).toHaveCount(0);
});

test("a splash left waiting on a slow Koios gives way to the wallet", async ({ context, koios }) => {
  koios.delayMs = 15_000;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("splash")).toBeVisible();
  await expect(page.getByTestId("splash")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("updated")).toHaveText("Reading the chain…");
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
});

test("tokens: Home shows five, View all has tokens and NFTs, a search, a sort and each token's details", async ({ context }) => {
  // The 24-word phrase's real preprod account: 8 fungible tokens and 5 NFTs, none in the wallet's list.
  // (A sixth NFT sits at a script address with this stake key: not the account's to spend.)
  const page = await openApp(context);
  await restore(page, vector(24).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-tokens").getByRole("listitem")).toHaveCount(5);
  await page.getByRole("button", { name: "View all 13 tokens" }).click();

  await expect(page.getByRole("heading", { name: "Cardano account tokens" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tokens (8)" })).toHaveAttribute("aria-selected", "true");
  const rows = page.getByTestId("token-results").getByRole("listitem");
  await expect(rows).toHaveCount(8);
  await snap(page, "tokens");

  // Search: a name, a policy ID, then nothing.
  const search = page.getByLabel("Search tokens");
  await search.fill("alp");
  await expect(rows).toHaveCount(2);
  await search.fill("22691D3D");
  await expect(rows).toHaveCount(2);
  await search.fill("zzz");
  await expect(page.getByText("No tokens match “zzz”.")).toBeVisible();
  await search.fill("");

  // Largest first: the two aLP holdings.
  await page.getByRole("button", { name: "Amount" }).click();
  await expect(rows.first()).toContainText("aLP");
  await expect(rows.first()).toContainText("10,178,074");

  // NFTs: CIP-68 label 222, or a single unit.
  await page.getByRole("tab", { name: "NFTs (5)" }).click();
  await expect(rows).toHaveCount(5);
  await search.fill("hanoi");
  await expect(rows).toHaveCount(4);
  await search.fill("");

  // Details: every id, with Copy; this one isn't in the wallet's list.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("tab", { name: "Tokens (8)" }).click();
  await page.getByRole("button", { name: "MyLittleToken, 10" }).click();
  const sheet = page.getByRole("dialog", { name: "MyLittleToken" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("token-amount")).toHaveText("10");
  await expect(sheet).toContainText("Not in the wallet's token list");
  const policy = await sheet.getByTestId("token-policy").getAttribute("data-value");
  expect(policy).toMatch(/^6024bbf2/);
  await sheet.getByRole("button", { name: "Copy the policy id" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(policy);
  await snap(page, "token-details");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("cardano-tokens")).toBeVisible();
});

test("move in: amount and a token, review, send, then watch it confirm", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Move in" }).click();

  // ADA has 6 decimal places: extra digits are dropped, with a note; letters are refused.
  await page.getByLabel("Amount", { exact: true }).fill("10.1234567890");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("10.123456");
  await expect(page.getByTestId("move-in-amount-note")).toContainText("at most 6 decimal places");
  await page.getByLabel("Amount", { exact: true }).pressSequentially("9");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("10.123456");
  await page.getByLabel("Amount", { exact: true }).fill("abc");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("10.123456");
  await expect(page.getByTestId("move-in-amount-note")).toContainText("Enter an amount in ADA");

  // No more than all the ADA there is; no more than the account holds.
  await page.getByLabel("Amount", { exact: true }).fill("99999999999999999999999999999999999999999");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("10.123456");
  await expect(page.getByTestId("move-in-amount-note")).toContainText("45 billion");
  await page.getByLabel("Amount", { exact: true }).fill("20000");
  await expect(page.getByTestId("move-in-too-much")).toContainText("That's more than the 10,350.538725 ₳");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();

  // A non-round amount gets the privacy nudge; a round one doesn't.
  await page.getByLabel("Amount", { exact: true }).fill("25.5");
  await expect(page.getByTestId("move-in-amount-note")).toHaveCount(0);
  await expect(page.getByTestId("round-warning")).toContainText("Round amounts");
  await page.getByLabel("Amount", { exact: true }).fill("25");
  await expect(page.getByTestId("round-warning")).toHaveCount(0);
  // Any amount of a token: Max fills in all of it; more than that is refused.
  const tusdm = page.getByLabel("Amount of tUSDM");
  await page.getByRole("button", { name: "All of tUSDM" }).click();
  await expect(tusdm).toHaveValue("3,000,000,000");
  await tusdm.fill("3000000001");
  await expect(page.getByText("That's more than the 3,000,000,000 you hold.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await tusdm.fill("1250000000");
  await snap(page, "move-in-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("move-in-review");
  await expect(review).toContainText("Into Seedelf25 ₳");
  await expect(review).toContainText("1,250,000,000 tUSDM");
  await expect(review).toContainText("Network fee");
  await snap(page, "move-in-review");
  expect(koios.submitted).toHaveLength(0);
  await page.getByRole("button", { name: "Send" }).click();

  // Home shows the sent transaction, linked to the explorer.
  const banner = page.getByTestId("pending-tx");
  await expect(banner).toContainText("Move-in sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  const [txId] = koios.submitted;
  await expect(banner.getByRole("link")).toHaveAttribute("href", `https://preprod.cardanoscan.io/transaction/${txId}`);
  await expect(page.getByRole("button", { name: "Move in" })).toBeDisabled();
  await snap(page, "move-in-sent");

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
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Move in" }).click();

  // Just under the balance: the UI allows it, but the fee doesn't fit, and the builder says so.
  await page.getByLabel("Amount", { exact: true }).fill("10350.5");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("alert")).toContainText("Not enough ADA");

  await page.getByRole("button", { name: "Max" }).click();
  await expect(page.getByText("UTxOs of exactly 5 ₳ stay put")).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("move-in-review")).toContainText("Back to your Cardano account");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("cardano-lovelace")).toBeVisible();
  expect(koios.submitted).toHaveLength(0);
});

test("create a seedelf from the Cardano account: review, send, then watch it confirm", async ({ context, koios }) => {
  koios.evaluation = accountMintPreprod.evaluation;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Create a seedelf" }).click();

  // The Cardano account pays by default, and says what that links.
  await expect(page.getByRole("button", { name: "Cardano account" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mint-from-note")).toContainText("create your seedelf before moving money in");
  await page.getByLabel("Personal tag (optional)").fill("first");
  await snap(page, "account-mint-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("mint-review");
  await expect(review).toContainText("Seedelffirst");
  await expect(review).toContainText("Paid fromCardano account");
  await expect(review).toContainText("Locked with it1.74986 ₳");
  await expect(review).toContainText("Back to your Cardano account");
  await snap(page, "account-mint-review");
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
  await snap(page, "mint-form");
  await page.getByRole("button", { name: "Review" }).click();

  // Ogmios measured it; giveme.my hasn't heard of it yet.
  const review = page.getByTestId("mint-review");
  await expect(review).toContainText("Seedelfmy tag");
  await expect(review).toContainText("Locked with it1.74986 ₳");
  await expect(review).toContainText("Network fee0.2");
  await expect(review).toContainText("Back to your Seedelf balance22.99");
  expect(koios.calls).toContain("ogmios");
  expect(koios.collateralAsked).toBe(0);
  await snap(page, "mint-review");

  // giveme.my refuses (its answer to a transaction it can't validate).
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("refused this transaction: Transaction Fails Validation");
  // A witness that isn't giveme.my's key over this transaction is caught in WebAssembly.
  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't match this transaction, so it wasn't sent");
  expect(koios.collateralAsked).toBe(2);
  expect(koios.submitted).toHaveLength(0);
  await snap(page, "mint-refused");

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
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
  await snap(page, "transfer-form");
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
  await snap(page, "transfer-review");

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
  await snap(page, "withdraw-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("withdraw-review");
  await expect(review).toContainText("To$bob");
  await expect(review).toContainText("Amount5 ₳");
  await expect(review).toContainText("1 tUSDM");
  await expect(review).toContainText(`Network fee${Number(withdrawPreprod.amount.final.fee.total) / 1e6} ₳`);
  await expect(review).toContainText("Seedelf UTxOs spent2");
  expect(koios.collateralAsked).toBe(0);
  await snap(page, "withdraw-review");

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
  await snap(page, "remove-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("remove-review");
  const fee = Number(withdrawPreprod.remove.final.fee.total);
  await expect(review).toContainText("Seedelfweb-wallet");
  await expect(review).toContainText(`Back to your Cardano account${(1_500_000 - fee) / 1e6} ₳`);
  await expect(review).toContainText(`Network fee${fee / 1e6} ₳`);
  await snap(page, "remove-review");

  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't match this transaction, so it wasn't sent");
  expect(koios.submitted).toHaveLength(0);
});

test("every wallet screen in the popup, for the look", async ({ context, koios }) => {
  // Restoring happens in a tab; the popup then opens on the unlocked wallet.
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.close();

  const popup = await openApp(context, "popup");
  const shot = (name: string) => snap(popup, `popup-${name}`);
  const back = () => popup.getByRole("button", { name: "Back", exact: true }).click();
  await expect(popup.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await shot("home-seedelf");

  await cardanoTab(popup);
  await expect(popup.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await shot("home-cardano");
  await popup.getByRole("button", { name: "View all 6 tokens" }).click();
  await expect(popup.getByRole("heading", { name: "Cardano account tokens" })).toBeVisible();
  await shot("tokens");
  await popup.getByRole("button", { name: "LINK, 550,999,000" }).click();
  await expect(popup.getByRole("dialog", { name: "LINK" })).toBeVisible();
  await popup.screenshot({ path: "test-results/popup-token-details.png", animations: "disabled" });
  await popup.getByRole("button", { name: "Close" }).click();
  await back();
  await popup.getByRole("button", { name: "Receive" }).click();
  await expect(popup.getByRole("img", { name: "QR code of the receive address" })).toBeVisible();
  await shot("receive");
  await back();
  await popup.getByRole("button", { name: "Move in" }).click();
  await popup.getByLabel("Amount", { exact: true }).fill("25.5");
  await popup.getByLabel("Amount of tUSDM").fill("1000");
  await shot("move-in");
  await popup.getByRole("button", { name: "Review" }).click();
  await expect(popup.getByTestId("move-in-review")).toBeVisible();
  await shot("move-in-review");
  await back();
  await back();

  await popup.getByRole("tab", { name: "Seedelf" }).click();
  for (const [button, name] of [
    ["Send to a seedelf", "transfer"],
    ["Withdraw", "withdraw"],
    ["Create a seedelf", "create-seedelf"],
    ["Remove web-wallet", "remove"],
  ] as const) {
    await popup.getByRole("button", { name: button }).click();
    await expect(popup.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(name);
    await back();
  }
  expect(koios.submitted).toHaveLength(0);

  await popup.getByRole("button", { name: "Lock" }).click();
  await expect(popup.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await shot("unlock");
});

test("a worker that lost its WASM file explains itself and recovers", async ({ userDataDir }) => {
  // A rebuild under a running extension: the old worker asks for a deleted file.
  const copy = mkdtempSync(join(tmpdir(), "seedelf-dist-"));
  cpSync(dist, copy, { recursive: true });
  const context = await launch(userDataDir, { extension: copy });
  try {
    const assets = join(copy, "assets");
    const wasm = readdirSync(assets).find((f) => f.endsWith(".wasm"))!;
    renameSync(join(assets, wasm), join(assets, "moved.wasm"));

    const page = await openApp(context);
    await expect(page.getByRole("heading", { name: "The wallet couldn't start" })).toBeVisible();
    await expect(page.getByTestId("startup-error")).toContainText("The wallet's core didn't load");
    await expect(page.getByTestId("startup-error")).toContainText("reload it");
    await expect(page.getByRole("button", { name: "Reload the extension" })).toBeVisible();
    await snap(page, "startup-error");

    // The failed load isn't cached: once the file is back, Try again works.
    renameSync(join(assets, "moved.wasm"), join(assets, wasm));
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("button", { name: "Create new wallet" })).toBeVisible();
  } finally {
    await context.close();
    rmSync(copy, { recursive: true, force: true });
  }
});
