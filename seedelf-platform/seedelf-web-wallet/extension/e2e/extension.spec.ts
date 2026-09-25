import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  accountMintPreprod,
  addTokens,
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
  stakingPreprod,
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

test("the side panel welcomes a new user and hands onboarding to a full tab", async ({ context }) => {
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("network")).toHaveText("PREPROD");
  await expect(panel.getByRole("img", { name: "Seedelf Wallet" })).toBeVisible();
  await panel.screenshot({ path: "test-results/welcome.png" });

  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    panel.getByRole("button", { name: "Restore wallet" }).click(),
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
  await expect(page.getByTestId("getting-started")).toContainText("Fund your public account");
  await snap(page, "home");

  // Step one's Receive shows the account's addresses.
  await page.getByTestId("getting-started").getByRole("button", { name: "Receive" }).click();
  await expect(page.getByTestId("receive-address")).toHaveText(/^addr_test1q/);
  await expect(page.getByTestId("stake-address")).toHaveText(/^stake_test1u/);
  const address = await page.getByTestId("receive-address").textContent();

  // Reopening the app keeps it unlocked, on the same wallet.
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("getting-started")).toContainText("Fund your public account");
  await snap(panel, "home-panel");
  await openReceive(panel);
  await expect(panel.getByTestId("receive-address")).toHaveText(address!);

  // Lock: every open page follows the worker.
  await page.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  // Show lets you check what you typed; Hide covers it again.
  const password = page.getByLabel("Password");
  await password.fill(PASSWORD);
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue(PASSWORD);
  await snap(page, "unlock-shown");
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByTestId("getting-started")).toBeVisible();
  await expect(panel.getByTestId("getting-started")).toBeVisible();
  await openReceive(panel);
  await expect(panel.getByTestId("receive-address")).toHaveText(address!);
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

test("home shows the private balance, Seedelfs and the public account", async ({ context, koios }) => {
  const v = vector(12);
  const page = await openApp(context);
  await restore(page, v.phrase);

  // Synthetic owned contract UTxOs: 25 + 3 ADA, a token, and a seedelf with 1.5 ADA.
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await expect(page.getByTestId("seedelf-tokens")).toContainText("tUSDM");
  await expect(page.getByTestId("seedelf-tokens")).toContainText("1,234.56");
  // Your seedelfs live in Receive, not on Home.
  await expect(page.getByTestId("seedelfs")).toHaveCount(0);

  // The real preprod account of this public test phrase: its UTxOs and its staking rewards.
  await cardanoTab(page);
  const account = koiosPreprod.accounts[v.preprod.stake];
  const rewards = BigInt(stakingPreprod.account_info[0].rewards_available);
  await expect(page.getByTestId("cardano-lovelace")).toHaveText(`${ada(BigInt(lovelaceOf(account.account_utxos)) + rewards)} ₳`);
  await expect(page.getByText("4 addresses used")).toBeVisible();
  await expect(page.getByTestId("cardano-tokens")).toContainText("LINK");
  await expect(page.getByTestId("staking-row")).toHaveText(`Staking with LOGIC${ada(rewards)} ₳ rewards`);
  await expect(page.getByTestId("updated")).toHaveText("Updated just now");
  // The account, the contract and the stake key; the pool's ticker the first time.
  expect(koios.calls.sort()).toEqual([
    "account_addresses",
    "account_info",
    "credential_utxos",
    "credential_utxos",
    "pool_info",
  ]);

  await snap(page, "home-cardano");

  await page.getByRole("button", { name: "Receive" }).click();
  const qr = page.getByRole("img", { name: "QR code of the receive address" });
  await expect(qr).toBeVisible();
  await qr.screenshot({ path: "test-results/receive-qr.png" });
  await snap(page, "receive");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("tab", { name: "Private", exact: true }).click();
  await expect(page.getByTestId("seedelf-lovelace")).toBeVisible();
  await snap(page, "home-balances");

  // Seedelf's Receive: your seedelfs, each with the ADA locked with it, Copy,
  // Remove, and its whole name on one line. No requests.
  const mine: string = ownedUtxos[2].asset_list[0].asset_name;
  await page.getByRole("button", { name: "Receive privately" }).click();
  const seedelfs = page.getByTestId("seedelfs");
  await expect(seedelfs).toContainText("web-wallet");
  await expect(seedelfs).toContainText("1.5 ₳");
  await expect(seedelfs.getByRole("button", { name: "Copy the name of web-wallet" })).toBeVisible();
  await expect(seedelfs.getByRole("button", { name: "Remove web-wallet" })).toBeEnabled();
  const name = page.getByTestId(`seedelf-name-${mine}`);
  await expect(name).toHaveText(mine);
  // At full size it all fits: nothing is cut.
  const cut = () => name.locator(".middle-ellipsis__head").evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(await cut()).toBe(false);
  await snap(page, "receive-seedelf");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // The panel opens from the worker's reading; Refresh reads the chain again.
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await snap(panel, "home-balances-panel");
  expect(koios.calls).toHaveLength(5);
  // The pool's ticker is remembered for the session.
  await panel.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => koios.calls.length).toBe(9);
  await expect(panel.getByTestId("updated")).toHaveText("Updated just now");

  // In the narrow panel the name is cut in the middle, keeping its start and end.
  await panel.getByRole("button", { name: "Receive privately" }).click();
  const narrow = panel.getByTestId(`seedelf-name-${mine}`);
  await expect(narrow).toHaveText(mine);
  expect(await narrow.locator(".middle-ellipsis__head").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(narrow.locator(".middle-ellipsis__tail")).toHaveText(mine.slice(-6));
});

test("receive into Seedelf without a Seedelf says to create one first", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(15).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Receive privately" }).click();
  await expect(page.getByTestId("receive-no-seedelf")).toContainText("you don't have a Seedelf yet");
  // This account is empty, so it can't pay for one yet.
  const create = page.getByRole("button", { name: "Create a Seedelf" });
  await expect(create).toBeDisabled();
  await expect(create).toHaveAttribute("title", /Fund your public account first/);
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
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("splash")).toBeVisible();
  await page.screenshot({ path: "test-results/splash.png" });
  await panel.screenshot({ path: "test-results/panel-splash.png" });

  await expect(page.getByTestId("splash")).toHaveCount(0);
  await expect(page.getByTestId("seedelf-lovelace")).toBeVisible();
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await expect(panel.getByTestId("splash")).toHaveCount(0);

  // The worker keeps the reading, so a side panel opened now goes straight to it.
  koios.delayMs = undefined;
  const again = await openApp(context, "panel");
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

  await expect(page.getByRole("heading", { name: "Public tokens" })).toBeVisible();
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

test("settings: the phrase behind the password, a new password, and removing the wallet", async ({ context, koios }) => {
  const v = vector(24);
  const page = await openApp(context);
  await restore(page, v.phrase);
  await expect(page.getByTestId("seedelf-lovelace")).not.toHaveText("— ₳");
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("about")).toContainText("Version0.1.0");
  await expect(page.getByTestId("about")).toContainText("NetworkPreprod");
  await snap(page, "settings");

  // The phrase, only after the password.
  await page.getByRole("button", { name: "Show recovery phrase" }).click();
  await expect(page.getByTestId("recovery-phrase")).toHaveCount(0);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Show phrase" }).click();
  await expect(page.getByTestId("recovery-phrase").locator(".word__text")).toHaveCount(24);
  const words = await page.getByTestId("recovery-phrase").locator(".word__text").allTextContents();
  expect(words.join(" ")).toBe(v.phrase);
  await snap(page, "settings-phrase");
  await page.getByRole("button", { name: "Done" }).click();

  // A new password: the old one no longer unlocks.
  const NEW = "a brand new passphrase";
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill(NEW);
  await page.getByLabel("Confirm password").fill(NEW);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByTestId("password-changed")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  expect(koios.calls).toHaveLength(reads); // Settings asks Koios nothing.

  await page.getByRole("button", { name: "Lock" }).click();
  await page.getByLabel("Password").fill(NEW);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByTestId("seedelf-lovelace")).toBeVisible();

  // Removing it needs the typed confirmation, then onboarding starts again.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Remove wallet" }).click();
  await expect(page.getByRole("button", { name: "Remove wallet" })).toBeDisabled();
  await page.getByLabel("Type delete wallet to confirm").fill("delete wallet");
  await page.getByRole("button", { name: "Remove wallet" }).click();
  await expect(page.getByRole("button", { name: "Create new wallet" })).toBeVisible();
});

test("contacts: save a Seedelf from Send, pick it again, and keep them in Settings", async ({ context, koios }) => {
  const theirs: string = transferPreprod.to;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Send privately" }).click();

  // Saved from the form once the seedelf is found.
  await expect(page.getByRole("button", { name: "Contacts", exact: true })).toHaveCount(0);
  await page.getByLabel("Seedelf name").fill(theirs);
  const note = page.getByTestId("transfer-to-note");
  await expect(note).toContainText("Found: This is a test.");
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Save to contacts" }).click();
  const editor = page.getByRole("dialog", { name: "Save to contacts" });
  await editor.getByLabel("Name", { exact: true }).fill("Test friend");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(note).toContainText("your contact Test friend");

  // Picked the next time.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Send privately" }).click();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.getByRole("dialog", { name: "Contacts" }).getByRole("button", { name: "Test friend" }).click();
  await expect(page.getByLabel("Seedelf name")).toHaveValue(theirs);
  await expect(note).toContainText("your contact Test friend");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Settings: add one (checked), then delete another.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Contacts" }).click();
  const list = page.getByTestId("contacts");
  await expect(list).toContainText("Test friend");
  await page.getByRole("button", { name: "Add a contact" }).click();
  const add = page.getByRole("dialog", { name: "Add a contact" });
  await add.getByLabel("Name", { exact: true }).fill("Alice");
  await add.getByLabel("Seedelf name, address or $handle").fill("nope");
  await add.getByRole("button", { name: "Save" }).click();
  await expect(add.getByRole("alert")).toContainText("isn't a Seedelf's full name");
  await add.getByLabel("Seedelf name, address or $handle").fill(vector(15).preprod.receive_0);
  await add.getByRole("button", { name: "Save" }).click();
  await expect(list).toContainText("Alice");
  await snap(page, "contacts");
  await page.getByRole("button", { name: "Edit Test friend" }).click();
  await page.getByRole("dialog", { name: "Edit contact" }).getByRole("button", { name: "Delete" }).click();
  await expect(list).not.toContainText("Test friend");
  // Contacts ask Koios nothing (the second visit to Send made one small contract read).
  expect(koios.calls.slice(reads).filter((c) => c !== "credential_utxos")).toEqual([]);
});

test("activity: the private history from the device, the public account's from Koios", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");

  // Seedelf: what arrived, noted from the balance reading; Koios isn't asked.
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Private activity" })).toBeVisible();
  const list = page.getByTestId("activity");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("+25 ₳");
  await expect(list).toContainText("+3 ₳ and 1 token");
  expect(koios.calls).toHaveLength(reads);
  await snap(page, "activity-seedelf");
  await list.getByRole("button").first().click();
  const details = page.getByRole("dialog", { name: "Received" });
  await expect(details.getByRole("link", { name: "View on Cardanoscan" })).toHaveAttribute(
    "href",
    /^https:\/\/preprod\.cardanoscan\.io\/transaction\/[0-9a-f]{64}$/,
  );
  await page.keyboard.press("Escape");
  // Refresh reads the balances again, which is how arrivals are noted.
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("updated")).toHaveText("Updated just now");
  await expect
    .poll(() => koios.calls.slice(reads).sort())
    .toEqual(["account_addresses", "account_info", "credential_utxos", "credential_utxos"]);
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Cardano account: a page of 20 is two requests; Load more, two more.
  const before = koios.calls.length;
  await cardanoTab(page);
  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Public activity" })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(20);
  expect(koios.calls.slice(before)).toEqual(["account_txs", "tx_info"]);
  await snap(page, "activity-cardano");
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(40);
  expect(koios.calls.slice(before)).toEqual(["account_txs", "tx_info", "account_txs", "tx_info"]);
  // Refresh asks only for what's newer: nothing, so no tx_info.
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => koios.calls.slice(before)).toEqual(["account_txs", "tx_info", "account_txs", "tx_info", "account_txs"]);
  await expect(page.getByTestId("updated")).toHaveText("Updated just now");
  await expect(list.getByRole("listitem")).toHaveCount(40);

  // Save as CSV: what's listed, on the device, with no request.
  const calls = koios.calls.length;
  await expect(page.getByTestId("export-note")).toContainText("40 transactions read so far: Load more first");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save as CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^seedelf-wallet-public-activity-preprod-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8");
  const rows = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
  expect(rows[0]).toMatch(/^Date \(UTC\),Type,Direction,ADA,/);
  expect(rows).toHaveLength(41);
  expect(koios.calls).toHaveLength(calls);
});

test("move in: amount and a token, review, send, then watch it confirm", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Make private" }).click();

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
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("20,000");
  // The staking rewards (57.475311 ₳) ride along, so they count.
  await expect(page.getByText("₳ available, with 57.475311 ₳ of rewards")).toBeVisible();
  await expect(page.getByTestId("move-in-too-much")).toContainText("That's more than the 10,408.014036 ₳");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();

  // A non-round amount gets the privacy nudge; a round one doesn't.
  await page.getByLabel("Amount", { exact: true }).fill("25.5");
  await expect(page.getByTestId("move-in-amount-note")).toHaveCount(0);
  await expect(page.getByTestId("round-warning")).toContainText("Round amounts");
  await page.getByLabel("Amount", { exact: true }).fill("25");
  await expect(page.getByTestId("round-warning")).toHaveCount(0);
  // Tokens come from a picker: search, select what's found, and take one off again.
  await expect(page.getByLabel(/^Amount of /)).toHaveCount(0);
  await page.getByRole("button", { name: "Add tokens" }).click();
  const picker = page.getByRole("dialog", { name: "Add tokens" });
  await picker.getByLabel("Search tokens").fill("sirius");
  await expect(picker.getByTestId("token-picker").getByRole("listitem")).toHaveCount(2);
  await picker.getByRole("button", { name: "Select all found" }).click();
  await snap(page, "token-picker");
  await picker.getByRole("button", { name: "Add 2 tokens" }).click();
  await expect(page.getByLabel(/^Amount of /)).toHaveCount(2);
  await page.getByRole("button", { name: "Take SIRIUS-A off" }).click();
  await expect(page.getByLabel(/^Amount of /)).toHaveCount(1);
  await page.getByRole("button", { name: "Take SIRIUS-B off" }).click();
  await addTokens(page, ["tUSDM"]);

  // Any amount of a token: Max fills in all of it.
  const tusdm = page.getByLabel("Amount of tUSDM");
  await page.getByRole("button", { name: "All of tUSDM" }).click();
  await expect(tusdm).toHaveValue("3,000,000,000");
  // The commas regroup as digits go; Backspace on a comma takes the digit before it.
  await tusdm.press("End");
  await tusdm.press("Backspace");
  await expect(tusdm).toHaveValue("300,000,000");
  await tusdm.press("Home");
  for (let i = 0; i < 4; i++) await tusdm.press("ArrowRight");
  await tusdm.press("Backspace");
  await expect(tusdm).toHaveValue("30,000,000");
  // The caret stayed after "30": a digit typed now goes there.
  await tusdm.press("5");
  await expect(tusdm).toHaveValue("305,000,000");
  // No more than the account holds, as ADA's box takes no more than 45 billion.
  await tusdm.fill("3000000001");
  await expect(tusdm).toHaveValue("305,000,000");
  await expect(page.getByText("That's more than the 3,000,000,000 tUSDM you hold.")).toBeVisible();
  await tusdm.fill("");
  await tusdm.pressSequentially("30000000009");
  await expect(tusdm).toHaveValue("3,000,000,000");
  await tusdm.fill("1250000000");
  await expect(tusdm).toHaveValue("1,250,000,000");
  await snap(page, "move-in-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("move-in-review");
  await expect(review).toContainText("Into your private balance25 ₳");
  await expect(review).toContainText("1,250,000,000 tUSDM");
  await expect(review).toContainText("Network fee");
  await expect(review).toContainText("Staking rewards spent57.475311 ₳");
  await snap(page, "move-in-review");
  expect(koios.submitted).toHaveLength(0);
  await page.getByRole("button", { name: "Send" }).click();

  // Home shows the sent transaction, linked to the explorer.
  const banner = page.getByTestId("pending-tx");
  await expect(banner).toContainText("Payment into your private balance sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  const [txId] = koios.submitted;
  await expect(banner.getByRole("link")).toHaveAttribute("href", `https://preprod.cardanoscan.io/transaction/${txId}`);
  await expect(page.getByRole("button", { name: "Make private" })).toBeDisabled();
  await snap(page, "move-in-sent");

  // Reopening the wallet resumes the watch; once confirmed, balances are read again.
  koios.confirmations = 2;
  const readsBefore = koios.calls.filter((c) => c === "credential_utxos").length;
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("pending-tx")).toContainText("Made private");
  await expect(panel.getByRole("button", { name: "Dismiss" })).toBeVisible();
  await snap(panel, "pending-confirmed");
  await expect.poll(() => koios.calls.filter((c) => c === "credential_utxos").length).toBeGreaterThan(readsBefore);
  await panel.getByRole("button", { name: "Dismiss" }).click();
  await expect(panel.getByTestId("pending-tx")).toHaveCount(0);
});

test("move in: Max, and an amount that's too big", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Make private" }).click();

  // Just under the balance and the rewards: the UI allows it, but the fee doesn't fit, and the builder says so.
  await page.getByLabel("Amount", { exact: true }).fill("10408");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("alert")).toContainText("Not enough ADA");

  await page.getByRole("button", { name: "Max" }).click();
  await expect(page.getByText("Your collateral and any UTxOs you locked stay put")).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("move-in-review")).toContainText("Back to your public account");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("cardano-lovelace")).toBeVisible();
  expect(koios.submitted).toHaveLength(0);
});

test("UTxOs: each balance's from the last reading, and a locked one kept out of its payments", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  const reads = koios.calls.length;

  // Seedelf: the two UTxOs the balance counts, and the seedelf's.
  await page.getByRole("button", { name: "UTxOs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Private UTxOs" })).toBeVisible();
  const list = page.getByTestId("utxos");
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list).toContainText("Seedelf");
  await snap(page, "utxos-seedelf");
  await list.getByRole("button", { name: /^25 ₳, a1a1/ }).click();
  const details = page.getByRole("dialog", { name: "25 ₳" });
  await expect(details.getByTestId("utxo-state")).toHaveText("Spent by payments as needed.");
  await details.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(details.getByTestId("utxo-state")).toHaveText("Locked: left out of every payment.");
  await details.getByRole("button", { name: "Close" }).click();
  await expect(list.getByRole("button", { name: /^25 ₳, Locked, a1a1/ })).toBeVisible();
  await expect(page.getByText("3 UTxOs · 1 locked")).toBeVisible();
  // A seedelf's UTxO only moves when the seedelf is removed: nothing to lock.
  await list.getByRole("button", { name: /Seedelf/ }).click();
  await expect(page.getByRole("dialog", { name: "1.5 ₳" })).toContainText("Only removing the Seedelf spends it");
  // Its name is cut to fit, with Copy for all of it; nothing spills out of the modal.
  const holder: string = ownedUtxos[2].asset_list[0].asset_name;
  await expect(page.getByTestId("utxo-seedelf-name")).toHaveAttribute("data-value", holder);
  await expect(page.getByTestId("utxo-seedelf-name")).not.toHaveText(holder);
  const body = page.getByRole("dialog").locator(".modal__body");
  expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Lock", exact: true })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Home still counts it, and says it's locked; Withdraw offers only the rest.
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await expect(page.getByTestId("seedelf-meta")).toHaveText("2 UTxOs · 25 ₳ locked");
  await page.getByRole("button", { name: "Make public" }).click();
  await expect(page.getByText("3 ₳ available · 25 ₳ locked")).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Cardano: lock the biggest from its row, and Send offers less.
  await cardanoTab(page);
  await page.getByRole("button", { name: "UTxOs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Public UTxOs" })).toBeVisible();
  const rows = page.getByTestId("utxos").getByRole("listitem");
  await expect(rows).toHaveCount(6);
  const quick = page.getByRole("button", { name: /^Lock 10,338\.538725 ₳/ });
  await expect(quick).toHaveAttribute("aria-pressed", "false");
  await quick.click();
  await expect(quick).toHaveAttribute("aria-pressed", "true");
  // It stays where it was, and its details say it's locked.
  await expect(rows.first()).toContainText("10,338.538725 ₳");
  await snap(page, "utxos-cardano");
  await rows.first().getByRole("button").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("utxo-address")).toBeVisible();
  await expect(dialog.getByTestId("utxo-tokens")).toBeVisible();
  await expect(dialog.getByTestId("utxo-state")).toHaveText("Locked: left out of every payment.");
  await expect(dialog.getByRole("button", { name: "Unlock" })).toBeVisible();
  await snap(page, "utxo-details");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("cardano-meta")).toHaveText("4 addresses used · 10,338.538725 ₳ locked");
  await page.getByRole("button", { name: "Send publicly" }).click();
  await expect(page.getByText(/₳ available, with 57\.475311 ₳ of rewards · 10,338\.538725 ₳ locked$/)).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // None of it asked Koios anything, or sent anything.
  expect(koios.calls).toHaveLength(reads);
  expect(koios.submitted).toHaveLength(0);

  // Refresh reads the balances again, as Home's does, and the lock holds.
  await page.getByRole("button", { name: "UTxOs", exact: true }).click();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect
    .poll(() => koios.calls.slice(reads).sort())
    .toEqual(["account_addresses", "account_info", "credential_utxos", "credential_utxos"]);
  await expect(page.getByTestId("updated")).toHaveText("Updated just now");
  await expect(quick).toHaveAttribute("aria-pressed", "true");
});

test("collateral: set in Settings by paying 5 ₳ to yourself, then watched on Home", async ({ context, koios }) => {
  // The 12-word phrase's account holds no 5 ₳ UTxO, so setting one is a payment.
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Collateral" }).click();
  await expect(page.getByTestId("collateral-none")).toContainText("pays 5 ₳ from your public account to itself");
  await snap(page, "collateral-none");
  await page.getByRole("button", { name: "Set collateral" }).click();
  const review = page.getByTestId("collateral-review");
  await expect(review).toContainText("ToYour public account");
  await expect(review).toContainText("Set aside5 ₳");
  await snap(page, "collateral-review");
  expect(koios.submitted).toHaveLength(0);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("collateral-waiting")).toBeVisible();
  expect(koios.submitted).toHaveLength(1);
  expect(koios.collateralAsked).toBe(0);
  await snap(page, "collateral-waiting");

  // Home watches it like any other transaction.
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByTestId("pending-tx")).toContainText("Collateral payment sent");
  koios.confirmations = 1;
  await expect(page.getByTestId("pending-tx")).toContainText("Collateral set", { timeout: 20_000 });
});

test("collateral: the wallet takes a 5 ₳ UTxO the account holds; reclaimed, it's set again with no transaction", async ({ context, koios }) => {
  // The 24-word phrase's account holds six UTxOs of exactly 5 ₳.
  const page = await openApp(context);
  await restore(page, vector(24).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-meta")).toHaveText("2 addresses used · 5 ₳ locked");
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Collateral" }).click();
  const set = page.getByTestId("collateral-set");
  await expect(set).toContainText("Collateral5 ₳");
  await expect(set).toContainText("Set byThe wallet: a 5 ₳ UTxO your account held");
  await snap(page, "collateral-set");
  await page.getByRole("button", { name: "Reclaim collateral" }).click();
  await expect(page.getByTestId("collateral-none")).toContainText("with no transaction");
  await expect(page.getByText("You reclaimed it")).toBeVisible();
  await page.getByRole("button", { name: "Set collateral" }).click();
  await expect(set).toContainText("Set byYou");
  expect(koios.submitted).toHaveLength(0);
  expect(koios.calls).toHaveLength(reads);

  // UTxOs lists it as the collateral, reclaimed only in Settings.
  await page.getByRole("button", { name: "Settings" }).click();
  await cardanoTab(page);
  await page.getByRole("button", { name: "UTxOs", exact: true }).click();
  await page.getByTestId("utxos").getByRole("button", { name: /Collateral/ }).click();
  await expect(page.getByTestId("utxo-collateral")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Lock", exact: true })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  // A UTxO with many tokens shows five, then all of them in a box that scrolls.
  await page.getByTestId("utxos").getByRole("button", { name: /^48\.442988 ₳/ }).click();
  const tokens = page.getByTestId("utxo-tokens");
  await expect(tokens).toContainText("8 tokens");
  await expect(tokens.locator(".review__row")).toHaveCount(5);
  await tokens.getByRole("button", { name: "Show all 8 tokens" }).click();
  await expect(tokens.locator(".review__row")).toHaveCount(8);
  await snap(page, "utxo-many-tokens");
  await tokens.getByRole("button", { name: "Show fewer" }).click();
  await expect(tokens.locator(".review__row")).toHaveCount(5);
});

test("send from the public account: a token with only the ADA it needs, review, send, then watch it confirm", async ({
  context,
  koios,
}) => {
  const theirs = vector(15).preprod.receive_0;
  koios.nfts.set(`f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a.${Buffer.from("bob").toString("hex")}`, theirs);
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Send publicly" }).click();

  // An address or a handle; the account's own address is flagged.
  const to = page.getByLabel("To", { exact: true });
  await to.fill(vector(12).preprod.receive_0);
  await expect(page.getByTestId("send-own")).toContainText("your own public account");
  await to.fill("$bob");
  await expect(page.getByTestId("send-to-note")).toContainText("$bob is");
  await expect(page.getByTestId("send-own")).toHaveCount(0);

  // Nothing to send yet. A token alone is enough: the amount can stay empty.
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await expect(page.getByTestId("minimum-hint")).toHaveCount(0);
  await addTokens(page, ["tUSDM"]);
  await page.getByLabel("Amount of tUSDM").fill("1000");
  await expect(page.getByTestId("minimum-hint")).toContainText("only the ADA they need");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveAttribute("placeholder", "Minimum");
  await snap(page, "send-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("send-review");
  await expect(review).toContainText("To$bob");
  await expect(review).toContainText("1,000 tUSDM");
  await expect(review).toContainText("Back to your public account");
  await expect(page.getByTestId("minimum-note")).toContainText("is the least ADA the network accepts with these tokens");
  await expect(page.getByTestId("minimum-note")).not.toContainText("Raised");
  await snap(page, "send-review");
  expect(koios.submitted).toHaveLength(0);

  // Too little ADA is raised to that least, and the review says from what.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("minimum-note")).toContainText("Raised from 0.5 ₳");

  // Signed at review: Send only submits, and giveme.my is never asked.
  await page.getByRole("button", { name: "Send" }).click();
  const banner = page.getByTestId("pending-tx");
  await expect(banner).toContainText("Payment sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  expect(koios.collateralAsked).toBe(0);
  await expect(page.getByRole("button", { name: "Send publicly" })).toBeDisabled();
  // Reading $bob once as typed; each review read it again, and the account and its stake key; then the submit.
  const review1 = ["asset_nft_address", "account_addresses", "account_info", "credential_utxos", "epoch_params"];
  const sent = koios.calls.slice(reads, koios.calls.indexOf("submittx") + 1);
  expect(sent.sort()).toEqual(["asset_nft_address", ...review1, ...review1, "submittx"].sort());

  koios.confirmations = 1;
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("pending-tx")).toContainText("Payment confirmed");
});

test("send from the public account to a Seedelf: paste its name, see it found, review, send", async ({ context, koios }) => {
  const theirs: string = transferPreprod.to;
  const mine: string = ownedUtxos[2].asset_list[0].asset_name;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Send publicly" }).click();

  // A whole name only; your own seedelf is Move in's.
  const to = page.getByLabel("To", { exact: true });
  const note = page.getByTestId("send-to-note");
  await expect(to).toHaveAttribute("placeholder", "addr_test1…, $handle or 5eed0e1f…");
  await to.fill(theirs.slice(0, 40));
  await expect(note).toContainText("64 hex characters starting 5eed0e1f");
  await to.fill(mine);
  await expect(note).toContainText("That Seedelf is yours. To put money into your private balance, use Make private.");
  await to.fill(` ${theirs.slice(0, 32).toUpperCase()} ${theirs.slice(32)} `);
  await expect(note).toContainText("Found: This is a test.");
  await expect(page.getByText("went to a private balance, though not whose")).toBeVisible();
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await snap(page, "send-seedelf-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("send-review");
  await expect(review).toContainText("ToThis is a test.");
  await expect(review).toContainText(`Seedelf name${theirs.slice(0, 16)}`);
  await expect(review).toContainText("Amount5 ₳");
  await expect(review).toContainText("Back to your public account");
  await expect(page.getByText("Only the owner of this Seedelf can spend the payment")).toBeVisible();
  // Found in the whole contract, never by asking Koios about the seedelf's token.
  expect(koios.calls.filter((c) => c.startsWith("asset"))).toEqual([]);
  await snap(page, "send-seedelf-review");

  // Signed at review, like any send: no giveme.my.
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("pending-tx")).toContainText("Payment sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  expect(koios.collateralAsked).toBe(0);
  // Both names were in the contract as Home's reading kept it: no requests. Review read what's new, and the account; then the submit.
  const contract = "credential_utxos";
  const account = ["account_addresses", "account_info", "credential_utxos", "epoch_params"];
  const sent = koios.calls.slice(reads, koios.calls.indexOf("submittx") + 1);
  expect(sent.sort()).toEqual([contract, ...account, "submittx"].sort());
});

test("several recipients: Send from the public account pays a handle and a Seedelf at once", async ({ context, koios }) => {
  const theirs = vector(15).preprod.receive_0;
  koios.nfts.set(`f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a.${Buffer.from("bob").toString("hex")}`, theirs);
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Send publicly" }).click();

  // One recipient looks as it always did, with Max; a second turns Max off and puts each in a card.
  await page.getByLabel("To", { exact: true }).fill("$bob");
  const max = page.getByRole("button", { name: "Max", exact: true });
  await max.click();
  await page.getByRole("button", { name: "Add recipient" }).click();
  await expect(max).toHaveCount(0);
  const first = page.getByRole("group", { name: "Recipient 1" });
  const second = page.getByRole("group", { name: "Recipient 2" });
  await expect(first.getByLabel("To", { exact: true })).toHaveValue("$bob");
  await expect(second.getByLabel("To", { exact: true })).toBeFocused();

  await first.getByLabel("Amount", { exact: true }).fill("3");
  await addTokens(page, ["tUSDM"], first);
  await first.getByLabel("Amount of tUSDM").fill("1000");
  // The second recipient's tUSDM box offers only what the first left.
  await addTokens(page, ["tUSDM"], second);
  await expect(second.getByText("of 2,999,999,000", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "Take tUSDM off" }).click();
  await second.getByLabel("To", { exact: true }).fill(transferPreprod.to);
  await expect(second.getByText("Found: This is a test.")).toBeVisible();
  await second.getByLabel("Amount", { exact: true }).fill("5");
  await expect(page.getByText("Paying several at once also shows they were paid together.")).toBeVisible();
  await snap(page, "send-several-form");
  await page.getByRole("button", { name: "Review" }).click();

  await expect(page.getByTestId("send-review-1")).toContainText("To$bob");
  await expect(page.getByTestId("send-review-1")).toContainText("Amount3 ₳");
  await expect(page.getByTestId("send-review-1")).toContainText("1,000 tUSDM");
  await expect(page.getByTestId("send-review-2")).toContainText("ToThis is a test.");
  await expect(page.getByTestId("send-review-2")).toContainText("Amount5 ₳");
  await expect(page.getByTestId("send-review")).toContainText("Total8 ₳ and 1 token");
  await expect(page.getByText("Only the owner of each Seedelf can spend the payment")).toBeVisible();
  await snap(page, "send-several-review");

  // Back keeps both, without reading $bob again; × takes one off, and Max is back.
  const handles = koios.calls.filter((c) => c === "asset_nft_address").length;
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(second.getByText("Found: This is a test.")).toBeVisible();
  expect(koios.calls.filter((c) => c === "asset_nft_address").length).toBe(handles);
  await page.getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("pending-tx")).toContainText("Payment sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
});

test("several recipients: Send to a Seedelf pays two, and Withdraw two addresses", async ({ context, koios }) => {
  koios.evaluation = transferPreprod.evaluation;
  const theirs = vector(15).preprod.receive_0;
  const mine: string = ownedUtxos[2].asset_list[0].asset_name;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");

  await page.getByRole("button", { name: "Send privately" }).click();
  await page.getByLabel("Seedelf name").fill(transferPreprod.to);
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Add recipient" }).click();
  const second = page.getByRole("group", { name: "Recipient 2" });
  await second.getByLabel("Seedelf name").fill(mine);
  await expect(second.getByTestId("transfer-own")).toContainText("This Seedelf is yours");
  await second.getByLabel("Amount", { exact: true }).fill("30");
  await expect(page.getByTestId("transfer-too-much")).toContainText("Together that's 35 ₳, more than the 28 ₳");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await second.getByLabel("Amount", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("transfer-review-1")).toContainText("ToThis is a test.");
  await expect(page.getByTestId("transfer-review-2")).toContainText("Toweb-wallet");
  await expect(page.getByTestId("transfer-review")).toContainText("Total7 ₳");
  await expect(page.getByTestId("transfer-to-self")).toContainText("One of these Seedelfs is yours");
  await snap(page, "transfer-several-review");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  koios.evaluation = withdrawPreprod.amount.evaluation;
  await page.getByRole("button", { name: "Make public" }).click();
  await page.getByLabel("To", { exact: true }).fill(theirs);
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Add recipient" }).click();
  await page.getByRole("group", { name: "Recipient 2" }).getByLabel("To", { exact: true }).fill(theirs);
  await page.getByRole("group", { name: "Recipient 2" }).getByLabel("Amount", { exact: true }).fill("2");
  await expect(page.getByText("Addresses paid in one payment can be seen to be paid together.")).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("withdraw-review-1")).toContainText("Amount5 ₳");
  await expect(page.getByTestId("withdraw-review-2")).toContainText("Amount2 ₳");
  await expect(page.getByTestId("withdraw-review")).toContainText("Total7 ₳");
  expect(koios.submitted).toHaveLength(0);
});

test("create a Seedelf from the public account: review, send, then watch it confirm", async ({ context, koios }) => {
  koios.evaluation = accountMintPreprod.evaluation;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Create a Seedelf" }).click();

  // The Cardano account pays by default, and says what that links.
  await expect(page.getByRole("button", { name: "Public account" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mint-from-note")).toContainText("create your Seedelf before making money private");
  await page.getByLabel("Personal tag (optional)").fill("first");
  await snap(page, "account-mint-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("mint-review");
  await expect(review).toContainText("Seedelffirst");
  await expect(review).toContainText("Paid fromPublic account");
  await expect(review).toContainText("Locked with it1.74986 ₳");
  await expect(review).toContainText("Back to your public account");
  await snap(page, "account-mint-review");
  expect(koios.submitted).toHaveLength(0);

  // Signed at review: Send only submits, and giveme.my is never asked.
  await page.getByRole("button", { name: "Send" }).click();
  const banner = page.getByTestId("pending-tx");
  await expect(banner).toContainText("Seedelf mint sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  expect(koios.collateralAsked).toBe(0);
  await expect(page.getByRole("button", { name: "Create a Seedelf" })).toBeDisabled();
  koios.confirmations = 1;
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("pending-tx")).toContainText("Seedelf created");
});

test("create a Seedelf from the private balance: tag rules, review, and nothing sent without giveme.my's real signature", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Create a Seedelf" }).click();
  await page.getByRole("button", { name: "Private balance" }).click();
  await expect(page.getByTestId("mint-from-note")).toContainText("A stealth mint");

  // The tag: printable ASCII, 15 characters at most, previewed as it will read.
  const tag = page.getByLabel("Personal tag (optional)");
  // With no tag there's no stand-in name: "Unnamed" could be someone's tag.
  await expect(page.getByTestId("mint-preview")).toContainText("With no tag, it's listed by its token name alone");
  await expect(page.getByTestId("mint-preview")).not.toContainText("Unnamed");
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
  await expect(review).toContainText("Back to your private balance22.99");
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
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
});

test("send to a Seedelf: paste its name, see it found, review, and nothing sent without giveme.my's real signature", async ({ context, koios }) => {
  koios.evaluation = transferPreprod.evaluation;
  const theirs: string = transferPreprod.to;
  const mine: string = ownedUtxos[2].asset_list[0].asset_name;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");

  // Each of your seedelfs has its full name in Receive, to give out or paste.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Receive privately" }).click();
  const copy = page.getByRole("button", { name: "Copy the name of web-wallet" });
  await copy.click();
  await expect(copy).toHaveText("Copied");
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  expect(await clipboard()).toBe(mine);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Send privately" }).click();

  // Only a whole name is looked up; pasted in capitals with spaces, it still is one.
  const name = page.getByLabel("Seedelf name");
  const note = page.getByTestId("transfer-to-note");
  await name.fill(theirs.slice(0, 40));
  await expect(note).toContainText("64 hex characters starting 5eed0e1f");
  await name.fill(`5eed0e1f${"00".repeat(28)}`);
  await expect(note).toContainText("No Seedelf with that name on preprod.");
  await name.fill(await clipboard());
  await expect(note).toContainText("Found: web-wallet");
  await expect(page.getByTestId("transfer-own")).toContainText("This Seedelf is yours");
  await name.fill(` ${theirs.slice(0, 32).toUpperCase()} ${theirs.slice(32)} `);
  await expect(note).toContainText("Found: This is a test.");
  await expect(page.getByTestId("transfer-own")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();

  // 5 ₳ and 1 tUSDM, of the 1,234.56 held.
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await addTokens(page, ["tUSDM"]);
  const tusdm = page.getByLabel("Amount of tUSDM");
  await tusdm.fill("2000");
  await expect(tusdm).toHaveValue("");
  await expect(page.getByText("That's more than the 1,234.56 tUSDM you hold.")).toBeVisible();
  await tusdm.fill("1234.561");
  await expect(tusdm).toHaveValue("");
  await tusdm.fill("1.1234567");
  await expect(tusdm).toHaveValue("1.123456");
  await expect(page.getByText("tUSDM has at most 6 decimal places")).toBeVisible();
  await tusdm.fill("1");
  await snap(page, "transfer-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("transfer-review");
  await expect(review).toContainText("ToThis is a test.");
  await expect(review).toContainText("Amount5 ₳");
  await expect(review).toContainText("1 tUSDM");
  await expect(review).toContainText("Network fee0.273922 ₳");
  await expect(review).toContainText("Back to your private balance22.726078 ₳ and 1 token");
  await expect(review).toContainText("Private UTxOs spent2");
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
  await page.getByRole("button", { name: "Make public" }).click();

  // The destination is read as it's typed: an address, or a handle through Koios.
  const to = page.getByLabel("To", { exact: true });
  const note = page.getByTestId("withdraw-to-note");
  await to.fill("nope");
  await expect(note).toContainText("isn't a Cardano address");
  await to.fill(vector(12).preprod.receive_0);
  await expect(note).toContainText("Sends to");
  await expect(page.getByTestId("withdraw-own")).toContainText("This is your own public account");
  await to.fill("$nobody");
  await expect(note).toContainText("No ADA Handle $nobody on preprod.");
  await to.fill("$bob");
  await expect(note).toContainText("$bob is");
  await expect(page.getByTestId("withdraw-own")).toHaveCount(0);

  // Max hides the token amounts; an amount brings them back.
  await addTokens(page, ["tUSDM"]);
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
  await expect(review).toContainText("Private UTxOs spent2");
  expect(koios.collateralAsked).toBe(0);
  await snap(page, "withdraw-review");

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("refused this transaction: Transaction Fails Validation");
  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't match this transaction, so it wasn't sent");
  expect(koios.submitted).toHaveLength(0);
});

test("remove a Seedelf: where its ADA goes, review, and nothing sent without giveme.my's real signature", async ({ context, koios }) => {
  koios.evaluation = withdrawPreprod.remove.evaluation;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Receive privately" }).click();
  await page.getByRole("button", { name: "Remove web-wallet" }).click();

  await expect(page.getByRole("heading", { name: "Remove web-wallet" })).toBeVisible();
  // Back returns to your seedelfs, and Remove again.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("seedelfs")).toContainText("web-wallet");
  await page.getByRole("button", { name: "Remove web-wallet" }).click();
  const note = page.getByTestId("remove-to-note");
  await expect(note).toContainText("links nothing new");
  await page.getByRole("button", { name: "Private balance" }).click();
  await expect(note).toContainText("ties the Seedelf's name to the new UTxO");
  await page.getByRole("button", { name: "Public account" }).click();
  await snap(page, "remove-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("remove-review");
  const fee = Number(withdrawPreprod.remove.final.fee.total);
  await expect(review).toContainText("Seedelfweb-wallet");
  await expect(review).toContainText(`Back to your public account${(1_500_000 - fee) / 1e6} ₳`);
  await expect(review).toContainText(`Network fee${fee / 1e6} ₳`);
  await snap(page, "remove-review");

  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't match this transaction, so it wasn't sent");
  expect(koios.submitted).toHaveLength(0);
});

const LOGIC_DREP = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";

test("staking: the page, the pool browser, a change of pool reviewed and sent, then watched", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("staking-row")).toContainText("Staking with LOGIC");

  // The page reads the pool's details, fresh: one request.
  let reads = koios.calls.length;
  await page.getByTestId("staking-row").click();
  await expect(page.getByRole("heading", { name: "Staking" })).toBeVisible();
  const pool = page.getByTestId("your-pool");
  await expect(pool).toContainText("LOGIC · Logical Mechanism");
  await expect(page.getByTestId("your-pool-facts")).toContainText("Saturation18.8%");
  await expect(page.getByTestId("your-pool-facts")).toContainText("Margin2%");
  await expect(page.getByTestId("staking-rewards")).toHaveText("57.475311 ₳");
  await expect(page.getByTestId("vote-now")).toContainText("Always abstain");
  await expect(page.getByTestId("rewards-locked")).toHaveCount(0);
  expect(koios.calls.slice(reads)).toEqual(["pool_info"]);
  await snap(page, "staking");

  // Every live pool: one page on preprod, with the supply and optimal_pool_count for saturation.
  reads = koios.calls.length;
  await page.getByRole("button", { name: "Change pool" }).click();
  await expect(page.getByText("559 live pools")).toBeVisible();
  expect(koios.calls.slice(reads).sort()).toEqual(["epoch_params", "pool_list", "totals"]);
  const results = page.getByTestId("pool-results");
  await expect(results.getByRole("listitem")).toHaveCount(50);
  await snap(page, "pools");
  await page.getByLabel("Search pools").fill("logic");
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results).toContainText("Yours");
  await page.getByLabel("Search pools").fill("tprep");
  await page.getByLabel("Sort pools").selectOption("saturation");
  await expect(results.getByRole("listitem")).toHaveCount(1);

  // A pool's details, fresh; its warnings; Stake builds and signs, for review.
  reads = koios.calls.length;
  await results.getByRole("button", { name: /^TPREP,/ }).click();
  await expect(page.getByTestId("pool-details")).toContainText("oversaturated");
  expect(koios.calls.slice(reads)).toEqual(["pool_info"]);
  await snap(page, "pool-details");
  reads = koios.calls.length;
  await page.getByRole("button", { name: "Stake with TPREP" }).click();
  const review = page.getByTestId("staking-review");
  await expect(review).toContainText("Stake withTPREP");
  await expect(review).not.toContainText("Deposit");
  await expect(review).not.toContainText("Rewards withdrawn");
  expect(koios.calls.slice(reads).sort()).toEqual(["account_addresses", "account_info", "credential_utxos", "epoch_params"]);
  await snap(page, "staking-review");
  expect(koios.submitted).toHaveLength(0);

  // Signed at review: Send only submits, and giveme.my is never asked.
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("pending-tx")).toContainText("Delegation sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  expect(koios.collateralAsked).toBe(0);
  koios.confirmations = 1;
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("pending-tx")).toContainText("Now staking");

  // The pool list is kept on the device: browsing again asks nothing.
  reads = koios.calls.length;
  await cardanoTab(panel);
  await panel.getByTestId("staking-row").click();
  await panel.getByRole("button", { name: "Change pool" }).click();
  await expect(panel.getByText("559 live pools")).toBeVisible();
  expect(koios.calls.slice(reads).filter((c) => ["pool_list", "totals", "epoch_params"].includes(c))).toEqual([]);
});

test("staking: the vote to a DRep by its ID, and the rewards withdrawn", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await page.getByTestId("staking-row").click();

  // DReps are searched by name in the wallet's own list, asking no one.
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Voting power" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Always abstain/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  const reads = koios.calls.length;
  await page.getByRole("radio", { name: /^A DRep/ }).click();
  const results = page.getByTestId("drep-results");
  await expect(results.getByRole("listitem")).toHaveCount(20);
  await expect(page.getByTestId("drep-list-note")).toContainText("61 DReps with a name");
  await page.getByLabel("Search DReps").fill("nobody by this name");
  await expect(page.getByText("No DRep on the wallet's list matches")).toBeVisible();
  await page.getByLabel("Search DReps").fill("logical");
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await snap(page, "voting-search");
  expect(koios.calls.slice(reads)).toEqual([]);

  // A pasted ID the list doesn't have is looked up as it is: Koios doesn't know this one.
  await page.getByLabel("Search DReps").fill("drep1yvquefnvtx57az5ajreyww993qvymgdcdgg4pw9uhg7uxmqcys6t5");
  await page.getByRole("button", { name: "Look up this ID" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't know that DRep");

  // The one picked is looked up live: two requests, its name from its metadata.
  await page.getByLabel("Search DReps").fill("logical");
  const lookups = koios.calls.length;
  await results.getByRole("button").filter({ hasText: "drep1ydmraa6…" }).click();
  const facts = page.getByTestId("drep-facts");
  await expect(facts).toContainText("NameLogical Mechanism dRep");
  await expect(facts).toContainText("StatusInactive since epoch 189");
  await expect(facts).toContainText("Voting power5,914,902.920642 ₳");
  await expect(page.getByTestId("drep-details")).toContainText("hasn't voted lately");
  expect(koios.calls.slice(lookups).sort()).toEqual(["drep_info", "drep_metadata"]);
  await snap(page, "voting");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("staking-review")).toContainText("Voting power toLogical Mechanism dRep");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Withdraw: the whole balance, back to the account.
  await page.getByRole("button", { name: "Withdraw rewards" }).click();
  const review = page.getByTestId("staking-review");
  await expect(review).toContainText("Rewards withdrawn57.475311 ₳");
  await expect(review).toContainText("Back to your public account");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("pending-tx")).toContainText("Reward withdrawal sent");
  expect(koios.submitted).toHaveLength(1);
});

test("staking: locked rewards send you to the vote; an account that isn't staking is offered a pool", async ({
  context,
  koios,
}) => {
  // The recorded account, as if its vote weren't delegated.
  const info = stakingPreprod.account_info[0];
  koios.stakes.set(info.stake_address, { ...info, delegated_drep: null });
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  const warning = page.getByTestId("home-rewards-locked");
  await expect(warning).toContainText("57.475311 ₳ of staking rewards are locked");
  await snap(page, "home-rewards-locked");
  await warning.getByRole("button", { name: "Delegate your vote" }).click();
  await expect(page.getByRole("heading", { name: "Voting power" })).toBeVisible();
  await expect(page.getByText("Now: Not delegated")).toBeVisible();
  await page.getByRole("radio", { name: /^Always abstain/ }).click();
  await expect(page.getByRole("button", { name: "Review" })).toBeEnabled();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  // Withdrawing and stopping wait for the vote.
  await expect(page.getByTestId("rewards-locked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw rewards" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop staking" })).toBeDisabled();
  // A payment goes ahead without them.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Send publicly" }).click();
  await expect(page.getByText("of rewards")).toHaveCount(0);

  // Never registered: not staking, and the deposit said up front.
  koios.stakes.clear();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("staking-row")).toContainText("Not staking");
  await page.getByTestId("staking-row").click();
  await expect(page.getByRole("heading", { name: "Not staking" })).toBeVisible();
  await expect(page.getByText("The first time takes a 2 ₳ deposit")).toBeVisible();
  await page.getByRole("button", { name: "Choose a pool" }).click();
  await page.getByLabel("Search pools").fill("logic");
  await page.getByTestId("pool-results").getByRole("button", { name: /^LOGIC,/ }).click();
  await page.getByRole("button", { name: "Stake with LOGIC" }).click();
  await expect(page.getByTestId("staking-review")).toContainText("Deposit2 ₳");
  expect(koios.submitted).toHaveLength(0);
});

test("settings: payments spend the staking rewards until switched off", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await page.getByRole("button", { name: "Send publicly" }).click();
  await expect(page.getByText("₳ available, with 57.475311 ₳ of rewards")).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", { name: "Use staking rewards when spending" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Rewards wait until you withdraw them")).toBeVisible();
  await snap(page, "settings-staking");
  await page.getByRole("button", { name: "Settings" }).click();

  // A new page reads the setting: the rewards are left out.
  const panel = await openApp(context, "panel");
  await cardanoTab(panel);
  await panel.getByRole("button", { name: "Send publicly" }).click();
  await expect(panel.getByText(/₳ available$/)).toBeVisible();
  await expect(panel.getByText("of rewards")).toHaveCount(0);
});

test("settings: the wallet opens in a tab until the side panel is chosen, and Chrome is told", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  const behavior = () => page.evaluate(() => chrome.sidePanel.getPanelBehavior());
  const kept = () => page.evaluate(() => chrome.storage.local.get("seedelf.openIn"));
  // A tab to begin with: the toolbar button reaches the worker, which opens or brings back the wallet's tab.
  expect(await behavior()).toMatchObject({ openPanelOnActionClick: false });

  const panel = await openApp(context, "panel");
  await panel.getByRole("button", { name: "Settings" }).click();
  const choice = panel.getByRole("group", { name: "Open Seedelf Wallet in" });
  await expect(choice.getByRole("button", { name: "A full tab" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByTestId("open-in-note")).toContainText("opens the wallet in a tab");
  await choice.getByRole("button", { name: "The side panel" }).click();
  await expect(choice.getByRole("button", { name: "The side panel" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByTestId("open-in-note")).toContainText("stays open as you browse");
  await expect.poll(behavior).toMatchObject({ openPanelOnActionClick: true });
  expect(await kept()).toEqual({ "seedelf.openIn": "panel" });
  await snap(panel, "settings-open-in");

  // Back to a tab, from the side panel: the wallet's tab already open comes
  // back, as the toolbar button brings it, and no second one opens.
  await Promise.all([panel.waitForEvent("close"), choice.getByRole("button", { name: "A full tab" }).click()]);
  await expect.poll(behavior).toMatchObject({ openPanelOnActionClick: false });
  expect(await kept()).toEqual({ "seedelf.openIn": "tab" });
  expect(context.pages().filter((p) => p.url().includes("view=tab"))).toEqual([page]);

  // With none open, it opens one.
  const again = await openApp(context, "panel");
  await page.close();
  const [tab] = await Promise.all([context.waitForEvent("page"), again.getByRole("button", { name: "Open in tab" }).click()]);
  await expect(tab).toHaveURL(`${await appUrl(context)}?view=tab`);

  // ADA's value: mainnet only, so a preprod wallet asks no one.
  await tab.getByRole("button", { name: "Settings" }).click();
  await expect(tab.getByTestId("currency-note")).toContainText("mainnet only");
  await expect(tab.getByLabel("Show ADA's value in")).toHaveValue("usd");
  await expect(tab.getByTestId("talks-to")).toHaveText(/only ever talks to Koios and giveme\.my\. It has/);
});

test("hide balances: the eye masks what the wallet holds, but not what a form sends, and stays", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Hide balances" }).click();
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("•••• ₳");
  await expect(page.getByTestId("seedelf-meta")).toHaveText("2 UTxOs");
  await expect(page.getByTestId("seedelf-tokens")).toContainText("••••");
  await snap(page, "home-hidden");
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).toHaveText("•••• ₳");
  await expect(page.getByTestId("staking-row")).toContainText("•••• ₳ rewards");
  // Hiding asks no one anything.
  expect(koios.calls).toHaveLength(reads);

  // Activity and UTxOs hide theirs too.
  await page.getByRole("button", { name: "UTxOs" }).click();
  await expect(page.getByTestId("utxos")).toContainText("•••• ₳");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // A form still says what it can send, and its review what it will.
  await page.getByRole("button", { name: "Send publicly" }).click();
  await expect(page.getByText(/^[\d,.]+ ₳ available, with 57\.475311 ₳ of rewards$/)).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // It's a setting: a new page opens hidden, and the eye shows them again.
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("seedelf-lovelace")).toHaveText("•••• ₳");
  await panel.getByRole("button", { name: "Show balances" }).click();
  await expect(panel.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await expect(panel.getByRole("button", { name: "Hide balances" })).toHaveAttribute("aria-pressed", "false");
  // The tab still open follows, with no reload.
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("•••• ₳");
});

test("settings: how long it stays unlocked, and a check of the written phrase", async ({ context, koios }) => {
  const v = vector(24);
  const page = await openApp(context);
  await restore(page, v.phrase);
  await expect(page.getByTestId("seedelf-lovelace")).not.toHaveText("— ₳");
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Settings" }).click();

  const lockAfter = page.getByLabel("Lock after");
  await expect(lockAfter).toHaveValue("15");
  // The open list is readable: an opaque dark behind the white text, not the
  // select's see-through surface, which the browser lays on white.
  await expect(lockAfter.locator("option").first()).toHaveCSS("background-color", "rgb(28, 34, 45)");
  await expect(page.getByLabel("Show ADA's value in").locator("option").first()).toHaveCSS(
    "background-color",
    "rgb(28, 34, 45)",
  );
  await lockAfter.selectOption("5");
  await expect
    .poll(() => page.evaluate(() => chrome.storage.local.get("seedelf.preferences")))
    .toMatchObject({ "seedelf.preferences": { lockAfterMinutes: 5 } });

  // The phrase as written down: pasted, it fills every box; the answer is yes or no.
  const paste = async (phrase: string) => {
    await page.getByLabel("Word 1", { exact: true }).focus();
    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData("text", text);
      document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    }, phrase);
  };
  await page.getByRole("button", { name: "Check recovery phrase" }).click();
  await expect(page.getByRole("heading", { name: "Check recovery phrase" })).toBeVisible();
  await paste(vector(12).phrase);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByTestId("phrase-differs")).toContainText("isn't this wallet's recovery phrase");
  await paste(v.phrase);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByTestId("phrase-matches")).toContainText("That's this wallet's recovery phrase");
  // Nothing kept: the boxes are empty again.
  await expect(page.getByLabel("Word 1", { exact: true })).toHaveValue("");
  await snap(page, "settings-check-phrase");
  expect(koios.calls).toHaveLength(reads);
});

test("send from the public account with a note: its count, the review, and what it tells", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await page.getByRole("button", { name: "Send publicly" }).click();
  await page.getByLabel("To", { exact: true }).fill(vector(15).preprod.receive_0);
  await page.getByLabel("Amount", { exact: true }).fill("3");
  const note = page.getByLabel("Note (optional)");
  await note.fill("Invoice 42");
  await expect(page.getByTestId("send-note-hint")).toHaveText("10/64. Anyone can read it, for good.");
  // At most 64 characters.
  await note.fill("x".repeat(80));
  await expect(note).toHaveValue("x".repeat(64));
  await note.fill("Invoice 42");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("send-review")).toContainText("NoteInvoice 42");
  await snap(page, "send-review-note");
});

test("every wallet screen in the side panel, for the look", async ({ context, koios }) => {
  // Restoring happens in a tab; the side panel then opens on the unlocked wallet.
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.close();

  const panel = await openApp(context, "panel");
  const shot = (name: string) => snap(panel, `panel-${name}`);
  const back = () => panel.getByRole("button", { name: "Back", exact: true }).click();
  await expect(panel.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await shot("home-seedelf");

  await cardanoTab(panel);
  await expect(panel.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await shot("home-cardano");
  await panel.getByRole("button", { name: "View all 6 tokens" }).click();
  await expect(panel.getByRole("heading", { name: "Public tokens" })).toBeVisible();
  await shot("tokens");
  await panel.getByRole("button", { name: "LINK, 550,999,000" }).click();
  await expect(panel.getByRole("dialog", { name: "LINK" })).toBeVisible();
  await panel.screenshot({ path: "test-results/panel-token-details.png", animations: "disabled" });
  await panel.getByRole("button", { name: "Close" }).click();
  await back();
  await panel.getByRole("button", { name: "Receive" }).click();
  await expect(panel.getByRole("img", { name: "QR code of the receive address" })).toBeVisible();
  await shot("receive");
  await back();
  await panel.getByRole("button", { name: "Make private" }).click();
  await panel.getByLabel("Amount", { exact: true }).fill("25.5");
  await addTokens(panel, ["tUSDM"]);
  await panel.getByLabel("Amount of tUSDM").fill("1000");
  await shot("move-in");
  await panel.getByRole("button", { name: "Review" }).click();
  await expect(panel.getByTestId("move-in-review")).toBeVisible();
  await shot("move-in-review");
  await back();
  await back();
  await panel.getByRole("button", { name: "Send publicly" }).click();
  await addTokens(panel, ["tUSDM"]);
  await panel.getByLabel("Amount of tUSDM").fill("1000");
  await shot("send");
  await back();
  await panel.getByTestId("staking-row").click();
  await expect(panel.getByTestId("your-pool-facts")).toBeVisible();
  await shot("staking");
  await panel.getByRole("button", { name: "Change pool" }).click();
  await expect(panel.getByTestId("pool-results")).toBeVisible();
  await shot("pools");
  await panel.getByLabel("Search pools").fill("tprep");
  await panel.getByTestId("pool-results").getByRole("button").first().click();
  await expect(panel.getByTestId("pool-details-facts")).toBeVisible();
  await shot("pool-details");
  await back();
  await back();
  await panel.getByRole("button", { name: "Change", exact: true }).click();
  await panel.getByRole("radio", { name: /^A DRep/ }).click();
  await expect(panel.getByTestId("drep-results")).toBeVisible();
  await shot("voting-search");
  await panel.getByLabel("Search DReps").fill(LOGIC_DREP);
  await panel.getByTestId("drep-results").getByRole("button").click();
  await expect(panel.getByTestId("drep-details")).toBeVisible();
  await shot("voting");
  await back();
  await back();

  await panel.getByRole("tab", { name: "Private", exact: true }).click();
  for (const [button, name] of [
    ["Receive privately", "receive-seedelf"],
    ["Send privately", "transfer"],
    ["Make public", "withdraw"],
    ["Create a Seedelf", "create-seedelf"],
  ] as const) {
    await panel.getByRole("button", { name: button }).click();
    await expect(panel.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(name);
    await back();
  }
  await panel.getByRole("button", { name: "Receive privately" }).click();
  await panel.getByRole("button", { name: "Remove web-wallet" }).click();
  await expect(panel.getByRole("heading", { level: 1 })).toBeVisible();
  await shot("remove");
  await back();
  await back();
  expect(koios.submitted).toHaveLength(0);

  await panel.getByRole("button", { name: "Activity" }).click();
  await expect(panel.getByTestId("activity")).toBeVisible();
  await shot("activity");
  await back();
  await panel.getByRole("button", { name: "UTxOs", exact: true }).click();
  await expect(panel.getByTestId("utxos")).toBeVisible();
  await shot("utxos");
  await back();

  await panel.getByRole("button", { name: "Settings" }).click();
  await expect(panel.getByRole("heading", { name: "Settings" })).toBeVisible();
  await shot("settings");
  await panel.getByRole("button", { name: "Collateral" }).click();
  await expect(panel.getByTestId("collateral-none")).toBeVisible();
  await shot("collateral");
  await back();
  await panel.getByRole("button", { name: "Settings" }).click();

  await panel.getByRole("button", { name: "Lock" }).click();
  await expect(panel.getByRole("heading", { name: "Welcome back" })).toBeVisible();
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
