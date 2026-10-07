import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import type { BrowserContext, Page } from "@playwright/test";

import {
  accountMintPreprod,
  accountVector,
  addTokens,
  appUrl,
  askWorker,
  cardanoTab,
  dist,
  expect,
  extensionId,
  fakeGateway,
  koiosPreprod,
  type KoiosFake,
  launch,
  lovejoinPool,
  chooseNetwork,
  madeByMix,
  ownedLovejoinBox,
  openApp,
  openDapp,
  openReceive,
  ownedUtxos,
  PASSWORD,
  PINNED_ID,
  restore,
  sessionSwap,
  setPassword,
  snap,
  stakingPreprod,
  test,
  transferPreprod,
  vector,
  withdrawPreprod,
} from "./support";

// Neither tUSDM the recordings hold is the one on the wallet's list: the account's (0 decimals) and the private
// balance's synthetic one (6 decimals) are the same name under other policies. So the wallet names each by its
// fingerprint, and says what it calls itself.
const TUSDM = "asset13vxx…6fmzjw";
const PRIVATE_TUSDM = "asset1synt…ctusdm";

test("the extension loads with a module service worker, and a dev build with the pinned ID", async ({ context }) => {
  const id = await extensionId(context);
  expect(context.serviceWorkers().map((w) => w.url())).toContain(`chrome-extension://${id}/sw.js`);
  // A store build has no key, so Chrome derives the ID from the folder instead.
  const { key } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  if (key) expect(id).toBe(PINNED_ID);
  else expect(id).toMatch(/^[a-p]{32}$/);
  // The worker alone answers the pages' ports: no page runs its code (vite.config.ts `workerAlone`).
  const page = await openApp(context);
  await expect(page.getByRole("button", { name: "Restore wallet" })).toBeVisible();
  expect(await page.evaluate(() => chrome.runtime.onConnect.hasListeners())).toBe(false);
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
  // Hide covers the words again, and having seen them still counts (chunk 23's second review, FR-5).
  await page.getByRole("button", { name: "Hide phrase" }).click();
  await expect(phrase.locator(".word__text").first()).toHaveText("••••••");
  await expect(page.getByRole("button", { name: "Reveal phrase" })).toBeVisible();
  await page.getByRole("button", { name: "I've written it down" }).click();

  // Three random positions; a wrong word is caught.
  const boxes = page.getByRole("combobox");
  await expect(boxes).toHaveCount(3);
  const positions = await boxes.evaluateAll((els) =>
    els.map((el) => Number(el.getAttribute("aria-label")!.replace("Word ", ""))),
  );
  for (const p of positions) await page.getByLabel(`Word ${p}`, { exact: true }).fill(words[p - 1]!);
  // A word no list word starts with is said at once, under its box, before Confirm (chunk 23's second review, FR-6).
  await page.getByLabel(`Word ${positions[0]}`, { exact: true }).fill("jokes");
  await expect(page.getByText("Not on the list of recovery phrase words.")).toBeVisible();
  await expect(page.getByLabel(`Word ${positions[0]}`, { exact: true })).toHaveAttribute("aria-invalid", "true");
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
  // A new wallet isn't told it was restored: Get started is its welcome (blind test T20a's note is a restore's alone).
  await expect(page.getByTestId("home-restored")).toHaveCount(0);
  // The actions say their side on the page, not in their accessible names alone (the owner's call on blind test T03).
  await expect(page.getByRole("button", { name: "Receive privately" })).toHaveText("Receive privately");
  await expect(page.getByRole("button", { name: "Create a Seedelf" })).toHaveText("Create a Seedelf");

  // Step one's button shows the account's addresses. It isn't called Receive: the action row's Receive, above it,
  // goes to the private side (chunk 23's review, H-2).
  await expect(page.getByTestId("getting-started-intro")).toContainText("your public account and private balance");
  // One reason for all three actions, Get started's first step, naming each: Send's own sent a new wallet to make ADA
  // private before creating its Seedelf (chunk 23's second review, GS-1), and Send and Make public's reason was a
  // tooltip alone (blind test T03).
  await expect(page.getByTestId("seedelf-reason")).toHaveText(
    "Fund your public account first: your Seedelf, Send privately and Make public need it",
  );
  // And the way to do it, under the reason, above the fold: Get started's own button sat below it at 360×640 (the
  // pass-two visual check).
  await expect(page.getByTestId("seedelf-fund")).toHaveText("Show my public address");
  // It's the first step's one button: Get started's own would be a second, below the fold (the pass-two visual check).
  await expect(page.getByTestId("getting-started").getByRole("button")).toHaveCount(0);
  await page.getByTestId("seedelf-fund").click();
  await expect(page.getByTestId("receive-address")).toHaveText(/^addr_test1q/);
  await expect(page.getByTestId("stake-address")).toHaveText(/^stake_test1u/);
  const address = await page.getByTestId("receive-address").textContent();
  // Back comes back to the steps, on the tab they're on: it used to switch Home to Public unsaid (blind test T03).
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Private", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("getting-started")).toBeVisible();

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

test("restore: per-word autocomplete and the reasons a phrase is refused", async ({ context }) => {
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

  // The rest, in the wrong order: the checksum fails, said without the word (chunk 23's review, R-2).
  for (let i = 1; i < 12; i++) {
    await page.getByLabel(`Word ${i + 1}`, { exact: true }).fill(words[12 - i]!);
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("These words don't make a valid phrase. Check the spelling and the order.");

  // An edit makes that message stale, so it goes; a word off the list is named.
  await page.getByLabel("Word 12", { exact: true }).fill("abount");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Word 12 isn't on the list of recovery phrase words. Check its spelling.");

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
    const { reply, ms: millis } = await askWorker(again, { type: "unlock", password: PASSWORD });
    if (!reply?.ok || !reply.value.unlocked) throw new Error(JSON.stringify(reply));
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
  // Its tUSDM isn't the listed one: named by its fingerprint, with what it calls itself under.
  await expect(page.getByTestId("seedelf-tokens")).toContainText(PRIVATE_TUSDM);
  await expect(page.getByTestId("seedelf-tokens")).toContainText("Calls itself tUSDM, not on the wallet's list");
  await expect(page.getByTestId("seedelf-tokens")).toContainText("1,234.56");
  // Your seedelfs live in Receive, not on Home.
  await expect(page.getByTestId("seedelfs")).toHaveCount(0);

  // The real preprod account of this public test phrase: its UTxOs and its staking rewards. The Private tab Home opens
  // on names it, with that balance and what it's for, and its row opens the Public tab (blind test §9.4).
  const account = koiosPreprod.accounts[v.preprod.stake];
  const rewards = BigInt(stakingPreprod.account_info[0].rewards_available);
  const publicTotal = `${ada(BigInt(lovelaceOf(account.account_utxos)) + rewards)} ₳`;
  await expect(page.getByTestId("home-public-row-lovelace")).toHaveText(publicTotal);
  // The restore is confirmed at the top, with what the phrase holds on each side, read with no request of its own
  // (blind test T20a, T20b: restore and create led to the same Home, with nothing to say it had worked).
  await expect(page.getByTestId("home-restored")).toContainText("Wallet restored");
  await expect(page.getByTestId("home-restored-detail")).toHaveText(
    `This phrase holds ${publicTotal} in its public account and 28 ₳ in its private balance.`,
  );
  await expect(page.getByTestId("home-public-row")).toContainText("Pay any address, get paid by any wallet, stake and vote");
  await page.getByTestId("home-public-row").click();
  await expect(page.getByRole("tab", { name: "Public", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Public", exact: true })).toBeFocused();
  await expect(page.getByTestId("cardano-lovelace")).toHaveText(publicTotal);
  // And the Public tab names the private balance, where swaps and mixing are (blind test T10).
  await expect(page.getByTestId("home-private-row-lovelace")).toHaveText("28 ₳");
  await expect(page.getByTestId("cardano-tokens")).toContainText("LINK");
  // The rewards are in the balance, said under it; the staking row no longer shows them as if on top (chunk 23's
  // second review, ST-6).
  await expect(page.getByTestId("cardano-rewards")).toHaveText(`Includes ${ada(rewards)} ₳ of staking rewards`);
  await expect(page.getByTestId("staking-row")).toHaveText("Staking and governanceStaking with LOGICVoting power: Always abstain");
  await expect(page.getByTestId("updated")).toHaveText("Updated just now");
  // The account, the contract and the stake key; the pool's ticker the first
  // time; and the one `account_addresses` a restore spends looking for a
  // second public account (chunk 18), which this phrase has never used.
  // Discovery's ask is the one about a stake address that isn't account 0's.
  await expect.poll(() => koios.stakesAsked.filter((a) => a !== v.preprod.stake)).not.toHaveLength(0);
  expect(koios.calls.sort()).toEqual([
    "account_addresses",
    "account_addresses",
    "account_info",
    "credential_utxos",
    "credential_utxos",
    "pool_info",
  ]);

  await snap(page, "home-cardano");
  // This tab's actions say their side too.
  await expect(page.getByRole("button", { name: "Send publicly" })).toHaveText("Send publicly");
  // Dismissed, the restore's note goes.
  await page.getByTestId("home-restored").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("home-restored")).toHaveCount(0);

  await page.getByRole("button", { name: "Receive" }).click();
  const qr = page.getByRole("img", { name: "QR code of the receive address" });
  await expect(qr).toBeVisible();
  await qr.screenshot({ path: "test-results/receive-qr.png" });
  await snap(page, "receive");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("tab", { name: "Private", exact: true }).click();
  await expect(page.getByTestId("seedelf-lovelace")).toBeVisible();
  await snap(page, "home-balances");

  // Seedelf's Receive: your Seedelfs, each a card whose whole name is the thing to share, with Copy and its QR
  // code; its tag, said to be anyone's to choose, and the ADA locked with it; and Remove, apart from Copy
  // (chunk 23's review, SE-1, SE-2). No requests.
  const mine: string = ownedUtxos[2].asset_list[0].asset_name;
  await page.getByRole("button", { name: "Receive privately" }).click();
  const seedelfs = page.getByTestId("seedelfs");
  await expect(seedelfs).toContainText("Its whole name: share this to be paid privately");
  await expect(page.getByTestId(`seedelf-about-${mine}`)).toHaveText(
    "Tag “web-wallet”: public, and anyone can choose the same one · 1.5 ₳ locked with it, back when you remove it",
  );
  await expect(seedelfs.getByRole("button", { name: "Copy the name of web-wallet" })).toBeVisible();
  await expect(seedelfs.getByRole("img", { name: "QR code of the name of web-wallet" })).toBeVisible();
  // Who can pay it, first; Remove behind Manage (chunk 23's second review, RX-1, RX-2).
  await expect(page.getByTestId("receive-who-can-pay")).toContainText("Only someone using Seedelf Wallet can pay this.");
  await expect(seedelfs.getByRole("button", { name: "Remove web-wallet" })).toHaveCount(0);
  await seedelfs.getByText("Manage", { exact: true }).click();
  await expect(seedelfs.getByRole("button", { name: "Remove web-wallet" })).toBeEnabled();
  const name = page.getByTestId(`seedelf-name-${mine}`);
  await expect(name).toHaveText(mine);
  await snap(page, "receive-seedelf");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // The panel opens from the worker's reading; Refresh reads the chain again.
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await snap(panel, "home-balances-panel");
  // Six, not five: the restore's one look for a second public account is among them (chunk 18).
  expect(koios.calls).toHaveLength(6);
  // The pool's ticker is remembered for the session.
  await panel.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => koios.calls.length).toBe(10);
  await expect(panel.getByTestId("updated")).toHaveText("Updated just now");

  // In the narrow panel the whole name still shows, wrapped: it's the thing to share, never cut.
  await panel.getByRole("button", { name: "Receive privately" }).click();
  const narrow = panel.getByTestId(`seedelf-name-${mine}`);
  await expect(narrow).toHaveText(mine);
  expect(await narrow.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("receive into Seedelf without a Seedelf says to create one first", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(15).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Receive privately" }).click();
  await expect(page.getByTestId("receive-no-seedelf")).toContainText("To be paid privately you need a Seedelf.");
  // This account is empty, so it can't pay for one yet: said under the button, with the way to fund it
  // (chunk 23's review, H-3).
  const create = page.getByRole("button", { name: "Create a Seedelf" });
  await expect(create).toBeDisabled();
  await expect(page.getByTestId("receive-create-reason")).toHaveText("Fund your public account first: it pays for your Seedelf");
  await page.getByRole("button", { name: "Show my public address" }).click();
  await expect(page.getByTestId("receive-address")).toHaveText(/^addr_test1/);
  // Back returns to where the address was offered (chunk 23's second review, GS-5).
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("receive-no-seedelf")).toBeVisible();

  // The Public tab's Create a Seedelf, with nothing to pay with: the public account is chosen, and Review waits with
  // the real blocker and the way to fund it, where it used to build and say to make ADA private first (GS-2).
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await cardanoTab(page);
  await page.getByTestId("mint-first").getByRole("button", { name: "Create a Seedelf" }).click();
  await expect(page.getByRole("radio", { name: "Public account" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await expect(page.getByTestId("mint-blocked")).toHaveText("Fund your public account first: it pays for your Seedelf");
  await page.getByRole("button", { name: "Show my public address" }).click();
  await expect(page.getByTestId("receive-address")).toHaveText(/^addr_test1/);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("mint-blocked")).toBeVisible();
});

test("home says so when Koios can't be read", async ({ context, koios }) => {
  koios.failWith = 400;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  // Said in the screen's terms; the service's own words wait under Details (chunk 23's review, L-2).
  await expect(page.getByRole("alert")).toContainText("Couldn't read your balances");
  await expect(page.getByTestId("home-read-failed")).toContainText("Koios refused the request (400");
  // What's true when it keeps failing: only reading failed (blind test §4 entry 25).
  await expect(page.getByTestId("home-read-failed")).toContainText("Your money is safe on chain: only reading it failed");
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("— ₳");
  // The restore's note doesn't say it's reading, under an alert that says reading failed (blind test T20a).
  await expect(page.getByTestId("home-restored-detail")).toHaveText("A phrase you've used shows its balances once they're read.");

  koios.failWith = undefined;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("home-restored-detail")).toContainText("28 ₳ in its private balance.");

  // A refresh that fails over a reading a few seconds old: the alert follows the worker's last reading, so a trip to
  // Settings, which replaces Home, doesn't drop it; a good reading does (blind test E05).
  koios.failWith = 400;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("home-read-failed")).toContainText("Couldn't refresh: these are your balances as last read");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("home-read-failed")).toContainText("Couldn't refresh: these are your balances as last read");
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  // Seen once it said what was read, the restore's note doesn't come back with a new Home.
  await expect(page.getByTestId("home-restored")).toHaveCount(0);
  koios.failWith = undefined;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the browser's Back is the screen's own Back (chunk 23's review, N-1)", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Send privately" }).click();
  await expect(page.getByLabel("Seedelf name")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("seedelf-lovelace")).toBeVisible();

  // Two deep: Settings, then its Sites page, and back one at a time.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /^Sites/ }).click();
  await expect(page.getByRole("heading", { name: "Sites", level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("seedelf-lovelace")).toBeVisible();
  // Left by its own button, a screen takes its history entry with it: Back on Home is never a press that does nothing.
  await page.getByRole("button", { name: "Send privately" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("seedelf-lovelace")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (history.state as { seedelfBack?: boolean } | null)?.seedelfBack ?? false)).toBe(false);
});

test("every screen opens at its top, Back finds a list where it was left, and Home comes back at its top (blind test §9.10)", async ({
  context,
}) => {
  // The side panel's size: screens swap inside one page that scrolls, and each kept the last one's offset.
  const page = await openApp(context);
  await page.setViewportSize({ width: 360, height: 640 });
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  const offset = () => page.evaluate(() => window.scrollY);

  // An action opened from the foot of the list starts at its title, where the list's offset hid its title and
  // amount (T14r).
  await page.getByTestId("home-public-row").click();
  await page.getByTestId("staking-row").click();
  await page.getByTestId("drep-card").getByRole("button", { name: "Governance actions" }).click();
  const rows = page.getByTestId("gov-action-row");
  await expect(rows).toHaveCount(7);
  await rows.last().scrollIntoViewIfNeeded();
  const listAt = await offset();
  expect(listAt).toBeGreaterThan(0);
  await rows.last().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
  expect(await offset()).toBe(0);

  // Back leads to the list where it was left, not to its top, where the reader had to find their place again (pass
  // two of the blind test's fix round; pass one opened it at its top), nor to the offset the browser kept for it:
  // the browser's Back, then the screen's own.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.goBack();
  await expect(rows).toHaveCount(7);
  await expect.poll(offset).toBe(listAt);
  await rows.last().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
  expect(await offset()).toBe(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(rows).toHaveCount(7);
  await expect.poll(offset).toBe(listAt);

  // And Home, left from far down a screen, comes back at its top, where a sent transaction's banner is (T03).
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Staking and governance", level: 1 })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await offset()).toBeGreaterThan(0);
  await page.goBack();
  await expect(page.getByTestId("cardano-lovelace")).toBeInViewport();
  expect(await offset()).toBe(0);
});

test("a token's details start a payment with it (chunk 23's review, T-1)", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-tokens")).toContainText("LINK");
  await page.getByTestId("cardano-tokens").getByRole("button", { name: /^LINK/ }).click();
  const sheet = page.getByRole("dialog", { name: "LINK" });
  await sheet.getByTestId("token-actions").getByRole("button", { name: "Send" }).click();
  // Send opens with LINK picked, asking for its amount before anything can be reviewed (MP-3): said under Review,
  // not in red on a box nobody has touched yet (chunk 23's second review, PY-9).
  await expect(page.getByLabel("Amount of LINK")).toBeVisible();
  await expect(page.getByText("Enter an amount, or take it off.")).toHaveCount(0);
  await expect(page.getByTestId("review-wait")).toHaveText("Enter who it goes to.");
  await page.getByLabel("To", { exact: true }).fill(vector(15).preprod.receive_0);
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await expect(page.getByTestId("review-wait")).toHaveText("Give each token an amount, or take it off.");
  await page.getByLabel("Amount of LINK").fill("1");
  await expect(page.getByRole("button", { name: "Review" })).toBeEnabled();
  await expect(page.getByTestId("review-wait")).toHaveCount(0);
});

test("Send from the private balance offers both ways to pay an ordinary address (chunk 23's review, P-1; blind test §9.7)", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Send privately" }).click();
  // What a Seedelf's name is, behind the label's ⓘ: two testers stopped at the word (T04b, T06).
  await page.getByTestId("transfer-to-name-hint-hint").click();
  await expect(page.getByTestId("transfer-to-name-hint")).toContainText("The 64-character name, starting 5eed0e1f");
  const address = vector(15).preprod.receive_0;
  const pasteIt = async () => {
    await page.getByLabel("Seedelf name").fill(address);
    await page.getByLabel("Amount", { exact: true }).fill("12");
    await expect(page.getByTestId("transfer-to-note")).toContainText("That's an ordinary address, not a Seedelf's name");
  };
  await pasteIt();
  // Two buttons, each saying what it shows, the private one first.
  const routes = page.getByTestId("transfer-to-routes");
  await expect(routes.getByRole("button")).toHaveText(["Pay from your private balance", "Pay from your public account"]);
  await expect(routes).toContainText("Through Make public: it shows as coming from the Seedelf contract.");
  await expect(routes).toContainText("it shows as coming from your public account.");
  // From the private balance: Make public, which says what it does and shows, with the address and the amount.
  await routes.getByRole("button", { name: "Pay from your private balance" }).click();
  await expect(page.getByTestId("withdraw-lead")).toHaveText(
    "Pays any address or $handle from your private balance. It shows as coming from the Seedelf contract.",
  );
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(address);
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("12");
  await expect(page.getByText("Paying money back where it came from, such as the account that made it private")).toBeVisible();
  // From the public account: its own Send, with the same.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Send privately" }).click();
  await pasteIt();
  await page.getByTestId("transfer-to-routes").getByRole("button", { name: "Pay from your public account" }).click();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(address);
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("12");
  await expect(page.getByTestId("send-to-note")).toContainText("Sends to");
  // With Max on, the 12 typed before it stays in the box, unused: it isn't handed on, and the other form asks.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Send privately" }).click();
  await pasteIt();
  await page.getByRole("button", { name: "Max", exact: true }).click();
  await page.getByTestId("transfer-to-routes").getByRole("button", { name: "Pay from your private balance" }).click();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(address);
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("");
});

test("Send from the private balance has a Max: all but the fee and what the token kept needs (blind test §9.6)", async ({ context, koios }) => {
  koios.evaluation = transferPreprod.evaluation;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Send privately" }).click();
  await page.getByLabel("Seedelf name").fill(transferPreprod.to);
  await expect(page.getByTestId("transfer-to-note")).toContainText("Found: This is a test.");
  await page.getByRole("button", { name: "Max", exact: true }).click();
  await expect(page.getByTestId("transfer-max-note")).toContainText("up to 20 private UTxOs");
  await expect(page.getByTestId("transfer-max-note")).toContainText("Anyone can see UTxOs spent together are one owner's.");
  await page.getByRole("button", { name: "Review" }).click();
  // The 1,234.56 tUSDM stays, with the least ADA the network accepts with it; everything else goes.
  await expect(page.getByTestId("transfer-max-kept")).toHaveText(
    "1.64642 ₳ stays in your private balance with the token you keep, the least ADA it needs.",
  );
  await expect(page.getByTestId("transfer-review")).toContainText(/Private balance after1\.64642\s₳/);
  expect(koios.calls).not.toContain("ogmios");
});

test("the dApps page says when sites can't see the wallet, with the switch's own note (chunk 23's review, D-1)", async ({ context }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "dApps", exact: true }).click();
  const off = page.getByTestId("dapp-sites-off");
  await expect(off).toContainText("Off: sites can't see Seedelf Wallet");
  await expect(off.getByRole("button", { name: "Let sites connect" })).toBeVisible();
  // The placeholder is a line now, not a tile that looked like a dApp.
  await expect(page.getByTestId("dapps").getByRole("button")).toHaveCount(2);
});

test("the first reading shows the splash, which fades into the wallet; a kept reading doesn't", async ({ context, koios }) => {
  koios.delayMs = 1500;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("splash")).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading your wallet" })).toBeVisible();
  // In words, not a ring alone (chunk 23's second review, FR-2).
  await expect(page.getByTestId("splash")).toContainText("Reading your balances…");
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
  await expect(page.getByTestId("updated")).toHaveText("Updating…");
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  // The restore is confirmed meanwhile, and says what it's waiting for (blind test T20a, T20b).
  await expect(page.getByTestId("home-restored")).toContainText("Wallet restored");
  await expect(page.getByTestId("home-restored-detail")).toHaveText(
    "Reading what this phrase holds. A phrase you've used shows its balances once they're read.",
  );
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
  await expect(sheet).toContainText("Not on the wallet's token list, so its name proves nothing.");
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

/**
 * A real PNG, `size` pixels square, teal fading to navy: an image for the
 * page to decode and the screenshot to show, as the gateway would send one.
 */
function png(size: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(8 + body.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 4 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per sample
  header[9] = 2; // RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const f = (x + y) / (2 * size);
      row[1 + x * 3] = Math.round(0x01 * f);
      row[2 + x * 3] = Math.round(0xc4 * (1 - f) + 0x18 * f);
      row[3 + x * 3] = Math.round(0xbc * (1 - f) + 0x33 * f);
    }
    rows.push(row);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

test.describe("an NFT's image", () => {
  // The first Show image asks Chrome for the gateway, in a dialog of its own
  // that automation can't answer, so this build has Chrome's access to sites
  // from install (support.ts `withSiteAccess`): the grant that dialog gives.
  test.use({ siteAccess: true });

  test("is asked for only from its details: one Koios request, one fetch from the gateway, and it's gone once the wallet locks", async ({
    context,
    koios,
  }) => {
    const gateway = await fakeGateway(context, png(160));
    const page = await openApp(context);
    await restore(page, vector(24).phrase);
    await cardanoTab(page);
    await page.getByRole("button", { name: "View all 13 tokens" }).click();
    await page.getByRole("tab", { name: "NFTs (5)" }).click();
    const rows = page.getByTestId("token-results").getByRole("listitem");
    await expect(rows).toHaveCount(5);

    // HANOI15102024: CIP-25, its image on IPFS. Opening its details asks nothing.
    const assetInfo = () => koios.calls.filter((c) => c === "asset_info").length;
    await page.getByRole("button", { name: "HANOI15102024, 1" }).click();
    const sheet = page.getByRole("dialog", { name: "HANOI15102024" });
    await expect(sheet.getByTestId("nft-image-privacy")).toContainText("see your IP address asking about this NFT.");
    await expect(sheet.getByTestId("nft-image-privacy")).toContainText("Nothing is asked until you show its image.");
    expect(assetInfo()).toBe(0);
    expect(gateway.asked).toEqual([]);
    await snap(page, "nft-image-ask");

    await sheet.getByRole("button", { name: "Show image" }).click();
    const image = sheet.getByTestId("nft-image");
    await expect(image).toBeVisible();
    // Decoded, not a broken icon: the page shows what came, as data.
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(160);
    expect(await image.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    await expect(sheet.getByTestId("nft-image-from")).toHaveText(
      "From IPFS, through ipfs.blockfrost.dev. Kept in this window until the wallet locks, never saved.",
    );
    expect(assetInfo()).toBe(1);
    expect(gateway.asked.map((a) => a.path)).toEqual(["/ipfs/QmQ6C7C5V5ghPHqLLvsr7r27GTmbUeae9QwhUL2ZDUC4dE"]);
    // No cookie and no referrer go with it.
    expect(gateway.asked[0]!.headers).not.toHaveProperty("cookie");
    expect(gateway.asked[0]!.headers).not.toHaveProperty("referer");
    await snap(page, "nft-image");

    // Closed and opened again, it's there, and it's the NFT's avatar in the list: nothing more is asked.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("button", { name: "HANOI15102024, 1" }).locator("img.avatar--image")).toBeVisible();
    await page.getByRole("button", { name: "HANOI15102024, 1" }).click();
    await expect(sheet.getByTestId("nft-image")).toBeVisible();
    expect(assetInfo()).toBe(1);
    expect(gateway.asked).toHaveLength(1);
    await page.keyboard.press("Escape");

    // A CIP-68 NFT with no metadata at all: Koios is asked, the gateway isn't.
    await page.getByTestId("token-results").getByRole("button").filter({ hasText: "HANOI001" }).click();
    const bare = page.getByRole("dialog");
    await bare.getByRole("button", { name: "Show image" }).click();
    await expect(bare.getByTestId("nft-image-none")).toHaveText("Koios has no metadata for this NFT, so there's no image to show.");
    expect(assetInfo()).toBe(2);
    expect(gateway.asked).toHaveLength(1);
    await page.keyboard.press("Escape");

    // Locked and unlocked, it's forgotten: Show image again, and nothing was asked meanwhile.
    await page.getByRole("button", { name: "Lock" }).click();
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Unlock" }).click();
    await cardanoTab(page);
    await page.getByRole("button", { name: "View all 13 tokens" }).click();
    await page.getByRole("tab", { name: "NFTs (5)" }).click();
    await page.getByRole("button", { name: "HANOI15102024, 1" }).click();
    await expect(sheet.getByRole("button", { name: "Show image" })).toBeVisible();
    await expect(sheet.getByTestId("nft-image")).toHaveCount(0);
    expect(assetInfo()).toBe(2);
    expect(gateway.asked).toHaveLength(1);
    expect(gateway.strays, "only the worker asks the gateway").toEqual([]);
  });
});

/**
 * The version the build under test carries, from the same `package.json` the
 * manifest takes it from. Written out here, it broke this test at every release
 * instead of the release's own checks (found bumping to 1.1.0, 2026-10-01).
 */
const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

test("settings: the phrase behind the password, a new password, and removing the wallet", async ({ context, koios }) => {
  const v = vector(24);
  const page = await openApp(context);
  await restore(page, v.phrase);
  await expect(page.getByTestId("seedelf-lovelace")).not.toHaveText("— ₳");
  // A restore looks for a second public account in the background (chunk 18):
  // one request, for the next account, which this phrase has never used. It
  // has to have landed before anything is counted, or "Settings asks Koios
  // nothing" would be racing it.
  const second = accountVector(24, 1).preprod.stake;
  await expect.poll(() => koios.stakesAsked).toContain(second);
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("about")).toContainText(`Version${VERSION}`);
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
  // Said, not left to be guessed from the welcome screen (chunk 23's review, SET-6).
  await expect(page.getByTestId("wallet-removed")).toHaveText("Wallet removed from this browser.");
});

test("a tab opened on #restore drops it once the wallet exists, so Remove wallet lands on the welcome", async ({ context }) => {
  // Create and Restore open a tab at #create or #restore. Kept, the hash sent a later Remove wallet back to that
  // start screen, a new phrase on Create's, with no word of the removal (chunk 23's second review, FR-8).
  const app = await appUrl(context);
  const page = await context.newPage();
  await page.goto(`${app}?view=tab#restore`);
  await expect(page.getByRole("heading", { name: "Restore a wallet" })).toBeVisible();
  await page.getByLabel("Word 1", { exact: true }).focus();
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text", text);
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, vector(24).phrase);
  await page.getByRole("button", { name: "Continue" }).click();
  await setPassword(page, "Restore wallet");
  await expect(page.getByTestId("seedelf-lovelace")).toBeVisible();
  await expect(page).toHaveURL(`${app}?view=tab`);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Remove wallet" }).click();
  await page.getByLabel("Type delete wallet to confirm").fill("delete wallet");
  await page.getByRole("button", { name: "Remove wallet" }).click();
  await expect(page.getByTestId("wallet-removed")).toHaveText("Wallet removed from this browser.");
  await expect(page.getByRole("button", { name: "Create new wallet" })).toBeVisible();
});

test("check recovery phrase: the wallet's own word count, and a wrong phrase said without “checksum”", async ({ context }) => {
  const words = vector(12).phrase.split(" ");
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Check recovery phrase" }).click();
  // A 12-word wallet's check opened on 24 boxes (chunk 23's second review, FR-11).
  await expect(page.getByRole("radio", { name: "12 words" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("combobox")).toHaveCount(12);
  // Its words out of order: said as Restore says it, never the core's "checksum" (FR-7).
  await page.getByLabel("Word 1", { exact: true }).focus();
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text", text);
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, [words[0], ...words.slice(1).reverse()].join(" "));
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("These words don't make a valid phrase. Check the spelling and the order.");
});

test("several accounts: find one, switch to it, and the screens follow", async ({ context, koios }) => {
  const v = vector(24);
  const second = accountVector(24, 1);
  const page = await openApp(context);
  await restore(page, v.phrase);
  await expect(page.getByTestId("seedelf-lovelace")).not.toHaveText("— ₳");

  // One account: nothing to choose between, so the picker isn't there and the
  // wallet looks exactly as it did before this chunk.
  await expect.poll(() => koios.stakesAsked).toContain(second.preprod.stake);
  await expect(page.getByTestId("account-picker")).toHaveCount(0);
  await cardanoTab(page);
  await expect(page.locator("#cardano-account")).toHaveText("Public account");
  await page.getByRole("tab", { name: "Private", exact: true }).click();

  // Account 1 has used an address now. Settings looks for it, one account at a time.
  koios.usedStakes.add(second.preprod.stake);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Public accounts" }).click();
  await expect(page.getByTestId("accounts-cost-note")).toContainText("ask Koios about one account at a time");
  await expect(page.getByTestId("accounts-cost-note")).toContainText("Koios can still guess your accounts are one wallet's");
  await expect(page.getByTestId("accounts-cost-note")).toContainText("Add it");
  const asked = koios.stakesAsked.length;
  await page.getByRole("button", { name: "Look for the next account" }).click();
  await expect(page.getByTestId("accounts-found")).toContainText("Found Account 2");
  expect(koios.stakesAsked.length).toBe(asked + 1);
  await snap(page, "settings-accounts");
  // Looked for again, the next one has never been used: adding it is the main button, with no number to type
  // (chunk 23's second review, PA-1). Not pressed here: the picker below lists the accounts as they are.
  await page.getByRole("button", { name: "Look for the next account" }).click();
  await expect(page.getByTestId("accounts-found")).toContainText("Account 3, the next in order, has never been used");
  await expect(page.getByTestId("accounts-add-next").getByRole("button", { name: "Add Account 3" })).toBeVisible();

  // Switch to it from the list. A switch starts every screen afresh on the new
  // account, as a network switch does, so Settings comes back at its menu.
  await page.getByRole("button", { name: "Switch to it" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  // No picker on every screen any more: it's the Public tab's heading on Home (the owner, 2026-10-06).
  await expect(page.getByTestId("account-picker")).toHaveCount(0);
  // And the list says which one the wallet is working on.
  await page.getByRole("button", { name: "Public accounts" }).click();
  await expect(page.getByTestId("account-active-1")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();

  // The Private tab names the public account as public, as the Public tab names the private balance.
  await page.getByRole("tab", { name: "Private", exact: true }).click();
  await expect(page.getByTestId("account-picker")).toHaveCount(0);
  await expect(page.getByTestId("home-public-row")).toContainText("Public account 2");

  // Home's public tab, and Receive, are account 2's now: the heading is the picker, on the account just chosen.
  await cardanoTab(page);
  await expect(page.locator("#cardano-account")).toHaveText("Public account 2");
  await expect(page.getByLabel("Public account")).toHaveValue("1");
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByTestId("receive-address")).toContainText(second.preprod.receive_0.slice(0, 20));

  // And back to account 1 from the picker alone.
  await page.getByRole("button", { name: "Back" }).click();
  await cardanoTab(page);
  await page.getByLabel("Public account").selectOption("0");
  await expect(page.getByLabel("Public account")).toHaveValue("0");
  await cardanoTab(page);
  await expect(page.locator("#cardano-account")).toHaveText("Public account 1");
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByTestId("receive-address")).toContainText(v.preprod.receive_0.slice(0, 20));
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // The public Send offers the wallet's other accounts, and picking one says
  // what the payment reveals rather than refusing it (the owner, 2026-10-02).
  await cardanoTab(page);
  await page.getByRole("button", { name: "Send publicly" }).click();
  // Only the other account is offered: paying the one you're on sends the
  // money straight back, which is the collateral payment's job.
  await page.getByRole("button", { name: "Your accounts" }).click();
  await expect(page.getByTestId("account-recipients").getByRole("button")).toHaveCount(1);
  await snap(page, "send-account-picker");
  await page.getByTestId("account-recipients").getByRole("button", { name: "Account 2" }).click();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(second.preprod.receive_0);
  // Read like any other address, and said: named, not refused, and Review opens.
  await expect(page.getByTestId("send-other-account")).toContainText("This is your own Account 2");
  await expect(page.getByTestId("send-other-account")).toContainText("tell they're one wallet's");
  await snap(page, "send-to-own-account");
  await expect(page.getByTestId("send-own")).toHaveCount(0);
  await page.getByLabel("Amount").fill("2");
  await expect(page.getByRole("button", { name: "Review" })).toBeEnabled();
  // The × empties the field and puts the cursor back in it (the owner, 2026-10-02).
  await page.getByRole("button", { name: "Clear the recipient" }).click();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("To", { exact: true })).toBeFocused();
  // Gone once there is nothing to clear, so an empty field looks as it did.
  await expect(page.getByRole("button", { name: "Clear the recipient" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // A custom number the sequential look can never reach (the owner,
  // 2026-10-02): checked by number, then added even though it has never been
  // used, which is how a user starts one.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Public accounts" }).click();
  // Folded under its own button since chunk 23's second review (PA-1).
  await page.getByRole("button", { name: "Use an account number of your own" }).click();
  await page.getByLabel("Account number").fill("1338");
  const before = koios.stakesAsked.length;
  await page.getByRole("button", { name: "Check it" }).click();
  await expect(page.getByTestId("accounts-found")).toContainText("Account 1338 has never been used");
  expect(koios.stakesAsked.length).toBe(before + 1);
  // Adding it asks nobody anything at all.
  await page.getByRole("button", { name: "Add Account 1338 anyway" }).click();
  await expect(page.getByTestId("accounts-found")).toContainText("Account 1338 is in the list now");
  expect(koios.stakesAsked.length).toBe(before + 1);
  await expect(page.getByTestId("accounts-list")).toContainText("Account 1338");

  // And it is in the picker like any other, never having been on chain: the Public tab's heading on Home.
  // (A select's option text isn't its own text content, so the options are read.)
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await cardanoTab(page);
  await expect(page.getByLabel("Public account").locator("option")).toHaveText([
    "Public account 1",
    "Public account 2",
    "Public account 1338",
  ]);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Public accounts" }).click();
  await page.getByRole("button", { name: "Use an account number of your own" }).click();
  // A wallet with a lot of accounts: the rows keep their rhythm and the list
  // scrolls rather than pushing the rest of the screen away.
  for (const n of [4, 5, 6, 7, 8, 9, 42]) {
    await page.getByLabel("Account number").fill(String(n));
    await page.getByRole("button", { name: "Add it" }).click();
    await expect(page.getByTestId("accounts-found")).toContainText(`Account ${n} is in the list now`);
  }
  // The filter arrives once the list scrolls, and narrows by number or name.
  await expect(page.getByTestId("accounts-filter")).toBeVisible();
  await snap(page, "settings-accounts-many");
  await page.getByLabel("Find an account").fill("42");
  await expect(page.getByTestId("accounts-list").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: /Accounts/ })).toContainText("1 of 10");
  await page.getByLabel("Find an account").fill("nothing");
  await expect(page.getByTestId("accounts-none")).toBeVisible();
  await page.getByLabel("Find an account").fill("");

  // The account sites use is chosen on Settings → Sites, and doesn't follow the picker.
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: /^Sites/ }).click();
  await expect(page.getByTestId("dapp-account-note")).toContainText("Sites always get this account, whichever you're using.");
  await expect(page.getByLabel("The account sites use")).toHaveValue("0");
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
  // It says the public account's payments are in a list of their own, with a row to it, which reads nothing until
  // it's pressed (blind test E01; privacy review §2.9).
  await expect(page.getByTestId("activity-other")).toHaveText("Public activityPayments to and from your public account");
  expect(koios.calls).toHaveLength(reads);
  await snap(page, "activity-seedelf");
  await list.getByRole("button").first().click();
  // Found by a restored wallet's first reading: who paid isn't known (independent review L38).
  const details = page.getByRole("dialog", { name: "Already in your private balance" });
  await expect(details.getByRole("link", { name: "View on Cardanoscan" })).toHaveAttribute(
    "href",
    /^https:\/\/preprod\.cardanoscan\.io\/transaction\/[0-9a-f]{64}$/,
  );
  // A private one says what opening it tells (privacy review §3.4).
  await expect(details.getByTestId("explorer-note")).toHaveText(
    "Opening this tells Cardanoscan and your browser history that this transaction is yours.",
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
  // It says it saved, and that it's the rows read so far (chunk 23's second review, AC-3).
  await expect(page.getByTestId("export-saved")).toHaveText("Saved the 40 transactions read so far to a file on this device.");

  // Public activity's row opens the private list, from the device, with no request; Back comes back to the public
  // list, then to Home on the tab it was opened from (blind test E01).
  const across = koios.calls.length;
  await page.getByTestId("activity-other").click();
  await expect(page.getByRole("heading", { name: "Private activity" })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  expect(koios.calls).toHaveLength(across);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Public activity" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Public", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("move in: amount and a token, review, send, then watch it confirm", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Make private" }).click();

  // ADA has 6 decimal places: extra digits are dropped, with a note. Letters stay as typed, with a note, and aren't
  // an amount: Review waits, saying why (chunk 23's second review, PY-9: it went on with the number typed over).
  await page.getByLabel("Amount", { exact: true }).fill("10.1234567890");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("10.123456");
  await expect(page.getByTestId("move-in-amount-note")).toContainText("at most 6 decimal places");
  await page.getByLabel("Amount", { exact: true }).pressSequentially("9");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("10.123456");
  await page.getByLabel("Amount", { exact: true }).fill("abc");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("abc");
  await expect(page.getByTestId("move-in-amount-note")).toContainText("Enter an amount in ADA");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await expect(page.getByTestId("review-wait")).toHaveText("The amount isn't a number.");
  await page.getByLabel("Amount", { exact: true }).fill("10.123456");
  await expect(page.getByTestId("review-wait")).toHaveCount(0);

  // No more than all the ADA there is; no more than the account holds.
  await page.getByLabel("Amount", { exact: true }).fill("99999999999999999999999999999999999999999");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("10.123456");
  await expect(page.getByTestId("move-in-amount-note")).toContainText("45 billion");
  await page.getByLabel("Amount", { exact: true }).fill("20000");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("20,000");
  // The staking rewards (57.475311 ₳) ride along, so they count.
  await expect(page.getByText("₳ available (includes 57.475311 ₳ of rewards)")).toBeVisible();
  await expect(page.getByTestId("move-in-too-much")).toContainText("That's more than the 10,408.014036 ₳");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();

  // An amount within 6 decimals is taken as typed, with nothing said about it:
  // the nudge towards round amounts was dropped (the owner, 2026-09-28) since
  // it was advice on hiding, which belongs in the docs, not in the form.
  await page.getByLabel("Amount", { exact: true }).fill("25.5");
  await expect(page.getByTestId("move-in-amount-note")).toHaveCount(0);
  await expect(page.getByTestId("round-warning")).toHaveCount(0);
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
  await addTokens(page, [TUSDM]);

  // Any amount of a token: Max fills in all of it.
  const tusdm = page.getByLabel(`Amount of ${TUSDM}`);
  await page.getByRole("button", { name: `All of ${TUSDM}` }).click();
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
  await expect(page.getByText(`That's more than the 3,000,000,000 ${TUSDM} you hold.`)).toBeVisible();
  await tusdm.fill("");
  await tusdm.pressSequentially("30000000009");
  await expect(tusdm).toHaveValue("3,000,000,000");
  await tusdm.fill("1250000000");
  await expect(tusdm).toHaveValue("1,250,000,000");
  await snap(page, "move-in-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("move-in-review");
  await expect(review).toContainText("Into your private balance25 ₳");
  await expect(review).toContainText(`1,250,000,000 ${TUSDM}`);
  await expect(review).toContainText("it calls itself tUSDM, but it isn't the listed tUSDM");
  await expect(review).toContainText("Network fee");
  // Collected into the account, whose balance on Home counts them already: not spent (chunk 23's review, S-2).
  // Moved into it, not "collected", which beside a payment read as a charge; and the setting that does it (PY-6).
  // Which balance, and that nothing extra leaves: "moved into your balance" read as rewards moving away (blind test
  // §9.9, T07).
  // The amount as the row's value, what it means across the row under it (the visual review of pass two).
  await expect(review.getByTestId("review-rewards")).toContainText("Staking rewards57.475311 ₳");
  await expect(review.getByTestId("review-rewards")).toContainText("Already in your public account's balance: nothing extra leaves.");
  await expect(page.getByTestId("rewards-setting")).toContainText("turn off “Use staking rewards when spending” in Settings");
  // The total counts the token going with the ADA (PY-5).
  await expect(review.getByTestId("review-total")).toContainText(/₳ and 1\stoken$/);
  await snap(page, "move-in-review");
  const publicAfter = /([\d,.]+)\s₳/.exec((await review.getByTestId("review-after-public").textContent()) ?? "")?.[1];
  const beforeSend = koios.calls.length;
  expect(koios.submitted).toHaveLength(0);
  // The button names the token too: "Make 25 ₳ private" left it out (chunk 23's second review, PY-5).
  await page.getByRole("button", { name: "Make 25 ₳ and 1 token private" }).click();

  // Home shows the sent transaction, linked to the explorer.
  const banner = page.getByTestId("pending-tx");
  await expect(banner).toContainText("Payment into your private balance sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  const [txId] = koios.submitted;
  await expect(banner.getByRole("link")).toHaveAttribute("href", `https://preprod.cardanoscan.io/transaction/${txId}`);
  // The public account signed it in the open: its link stays plain.
  await expect(banner.getByTestId("explorer-note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Make private" })).toBeDisabled();
  await snap(page, "move-in-sent");
  // Home reads again at once, from the worker's kept reading with no balance request: the review's after, the change
  // on its way back to the public account with the rewards it collected in it, which no longer count on top (blind
  // test §9.1, §9.3).
  expect(publicAfter).toBeDefined();
  await expect(page.getByTestId("cardano-lovelace")).toHaveText(`${publicAfter} ₳`);
  await expect(page.getByTestId("cardano-incoming")).toContainText("on its way to this balance, with 57.475311 ₳ of collected staking rewards");
  await expect(page.getByTestId("cardano-rewards")).toHaveCount(0);
  expect(koios.calls.slice(beforeSend).filter((c) => ["credential_utxos", "account_addresses", "account_info"].includes(c))).toEqual([]);
  // The public UTxOs say what's on its way back to them, from Home's reading: the list had dropped the UTxO spent and
  // lacked the change, with nothing to say why (blind test T08).
  await page.getByRole("button", { name: "UTxOs", exact: true }).click();
  await expect(page.getByTestId("utxos-incoming")).toContainText("on its way here, in");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("cardano-incoming")).toBeVisible();

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
  // In the wallet's words, with how much can go (chunk 23's second review, PY-10: core's said "Cardano account").
  await expect(page.getByRole("alert")).toContainText(/^Not enough ADA: with the fee, your public account can make up to [\d,.]+\s₳ private\. Use Max/);

  await page.getByRole("button", { name: "Max" }).click();
  await expect(page.getByText("Collateral and locked UTxOs stay put")).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("move-in-review")).toContainText("Total leaving your public account");
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
  // Each row names where its money came from (privacy review §2.3) before its outpoint.
  await list.getByRole("button", { name: /^25 ₳, (?:[^,]+, )?a1a1/ }).click();
  const details = page.getByRole("dialog", { name: "25 ₳" });
  await expect(details.getByTestId("utxo-state")).toHaveText("Spent by payments as needed.");
  await details.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(details.getByTestId("utxo-state")).toHaveText("Locked: left out of every payment.");
  await details.getByRole("button", { name: "Close" }).click();
  await expect(list.getByRole("button", { name: /^25 ₳, Locked, (?:[^,]+, )?a1a1/ })).toBeVisible();
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
  await expect(page.getByTestId("seedelf-meta")).toHaveText("25 ₳ locked");
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
  await expect(page.getByTestId("cardano-meta")).toHaveText("10,338.538725 ₳ locked");
  await page.getByRole("button", { name: "Send publicly" }).click();
  await expect(page.getByText(/₳ available \(includes 57\.475311\s₳ of rewards\) · 10,338\.538725\s₳ locked$/)).toBeVisible();
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
  // Status and purpose first, the cost after it (chunk 23's second review, CW-8).
  await expect(page.getByTestId("collateral-status")).toHaveText(
    "Not set. Some sites need it to run their contracts.",
  );
  await expect(page.getByTestId("collateral-none")).toContainText("pays 5 ₳ to your own account");
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
  await expect(page.getByTestId("cardano-meta")).toHaveText("5 ₳ locked");
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Collateral" }).click();
  const set = page.getByTestId("collateral-set");
  await expect(page.getByTestId("collateral-status")).toHaveText(
    "Set: 5 ₳ kept aside for running contracts.",
  );
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

  // Nothing to send yet, and Review says so (PY-9). A token alone is enough: the amount can stay empty.
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await expect(page.getByTestId("review-wait")).toHaveText("Enter an amount.");
  await expect(page.getByTestId("minimum-hint")).toHaveCount(0);
  await addTokens(page, [TUSDM]);
  await page.getByLabel(`Amount of ${TUSDM}`).fill("1000");
  await expect(page.getByTestId("minimum-hint")).toContainText("only the ADA the tokens need");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveAttribute("placeholder", "Minimum");
  await snap(page, "send-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("send-review");
  await expect(review).toContainText("To$bob");
  await expect(review).toContainText(`1,000 ${TUSDM}`);
  await expect(review).toContainText("Total leaving your public account");
  await expect(page.getByTestId("minimum-note")).toContainText("is the least ADA the network accepts with these tokens");
  await expect(page.getByTestId("minimum-note")).not.toContainText("Raised");
  await snap(page, "send-review");
  expect(koios.submitted).toHaveLength(0);

  // In a short window Send follows the review's rows, so "Total leaving" and "… after" come before it: kept in view
  // there, it sat over them, clickable (blind test T04, §9.10).
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 360, height: 480 });
  const after = (await page.getByTestId("review-after-public").boundingBox())!;
  const sendButton = (await page.getByRole("button", { name: "Send", exact: true }).boundingBox())!;
  expect(sendButton.y).toBeGreaterThanOrEqual(after.y + after.height);
  await page.setViewportSize(size);

  // Too little ADA is raised to that least, and the review says from what.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("minimum-note")).toContainText("Raised from 0.5 ₳");
  // On the amount's own row too, not only in the grey line under the summary (PY-4).
  await expect(page.getByTestId("send-review")).toContainText(/Amount[\d.]+\s₳, raised from 0\.5\s₳/);

  // Signed at review: Send only submits, and giveme.my is never asked.
  await page.getByRole("button", { name: "Send" }).click();
  const banner = page.getByTestId("pending-tx");
  await expect(banner).toContainText("Payment sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  expect(koios.collateralAsked).toBe(0);
  await expect(page.getByRole("button", { name: "Send publicly" })).toBeDisabled();
  // Reading $bob once as typed; each review read it again, and the account and its stake key; then the submit.
  const review1 = ["asset_nft_address", "account_addresses", "account_info", "credential_utxos", "epoch_params", "tip"];
  const sent = koios.calls.slice(reads, koios.calls.indexOf("submittx") + 1);
  expect(sent.sort()).toEqual(["asset_nft_address", ...review1, ...review1, "submittx"].sort());

  koios.confirmations = 1;
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("pending-tx")).toContainText("Payment confirmed");
});

test("the transaction view: the bytes under a review, their CBOR, and the payment still sends after it's closed", async ({
  context,
  koios,
}) => {
  const theirs = vector(15).preprod.receive_0;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Send publicly" }).click();
  await page.getByLabel("To", { exact: true }).fill(theirs);
  await page.getByLabel("Amount", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("send-review")).toContainText("Amount4 ₳");

  // The way in is on the review itself, and nothing has been asked of Koios for it.
  const reads = koios.calls.length;
  await page.getByTestId("send-tx-open").click();
  const view = page.getByTestId("send-tx");
  await expect(view).toContainText("Pays");
  await expect(view).toContainText("Spends");
  // Where the value goes, with the recipient's whole address.
  await expect(view.locator(`[data-value="${theirs}"]`)).toBeVisible();
  await expect(view).toContainText("Network fee");
  // Signed while it was prepared, and said so without reading as consent given (blind test §4 entry 16).
  await expect(view).toContainText("made while preparing it: not sent until you confirm");
  expect(koios.calls.length).toBe(reads);
  await snap(page, "tx-detail");

  // The explanations sit behind icons rather than under the rows (the owner,
  // 2026-10-01): on hover through the title, and on the page when clicked.
  const inputs = view.getByTestId("send-tx-inputs-hint");
  const explains = "looking them up would tell whoever was asked which transaction you are reading";
  await expect(inputs).toHaveAttribute("title", new RegExp(explains));
  await expect(view).not.toContainText(explains);
  await expect(inputs).toHaveAttribute("aria-expanded", "false");
  await inputs.click();
  await expect(view.getByTestId("send-tx-inputs-hint-text")).toContainText(explains);
  await expect(inputs).toHaveAttribute("aria-expanded", "true");
  // And away again, so it never takes the room for good.
  await inputs.click();
  await expect(view.getByTestId("send-tx-inputs-hint-text")).toHaveCount(0);

  // The raw bytes, as hex, with nothing asked of anyone to show them.
  await view.getByRole("tab", { name: "Raw CBOR" }).click();
  const cbor = view.getByTestId("send-tx-cbor");
  await expect(cbor).toBeVisible();
  const hex = (await cbor.getAttribute("data-value"))!;
  expect(hex).toMatch(/^84[0-9a-f]+$/);
  await expect(view).toContainText(`${hex.length / 2} bytes of CBOR`);
  await expect(view).not.toContainText("The exact bytes the wallet would sign");
  await view.getByTestId("send-tx-cbor-hint").click();
  await expect(view.getByTestId("send-tx-cbor-note")).toContainText("The exact bytes the wallet would sign");
  await snap(page, "tx-detail-cbor");

  // Closed with Escape, as a dialog closes; the review is where it was.
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  await expect(page.getByTestId("send-review")).toContainText("Amount4 ₳");

  // The guarantee: the signed transaction was never in the view's hands, so
  // opening and closing it can't strand it. Send still sends those very bytes.
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("pending-tx")).toContainText("Payment sent. Waiting for the network");
  expect(koios.submitted).toEqual([expect.any(String)]);
  expect(koios.collateralAsked).toBe(0);
});

test("the transaction view on a Seedelf payment: the contract, the register, and why the inputs say nothing", async ({
  context,
  koios,
}) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  // Make private is on the public side: it moves the account's ADA into Seedelf.
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Make private" }).click();
  await page.getByLabel("Amount", { exact: true }).fill("6");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("move-in-review")).toContainText("6 ₳");

  await page.getByTestId("move-in-tx-open").click();
  const view = page.getByTestId("move-in-tx");
  // It pays Seedelf Wallet's own contract, under a register only its owner can spend.
  await expect(view).toContainText("Seedelf Wallet's contract");
  await expect(view).toContainText("under a register");
  // And the datum itself, as a tree that opens: its two points are under a
  // constructor, and the first couple of levels start open, so a small datum
  // reads without a click.
  await expect(view).toContainText("Its datum, 104 bytes · 3 nodes");
  const datum = view.locator(".plutus").first();
  await expect(datum.getByRole("button", { name: /Constructor 0/ })).toHaveAttribute("aria-expanded", "true");
  await expect(datum).toContainText("48 bytes");

  // It closes, and what's closed isn't on the page at all: that's what lets a
  // datum of any size through.
  await datum.getByRole("button", { name: /Constructor 0/ }).click();
  await expect(datum.getByRole("button", { name: /Constructor 0/ })).toHaveAttribute("aria-expanded", "false");
  await expect(datum).not.toContainText("48 bytes");
  // Expand all brings back the lot, and says it can put it away again.
  await datum.getByRole("button", { name: "Expand all" }).click();
  await expect(datum).toContainText("48 bytes");
  await expect(datum.getByRole("button", { name: "Collapse all" })).toBeVisible();
  // The bytes and the JSON can both be taken away.
  await expect(datum.getByRole("button", { name: /as CBOR/ })).toBeVisible();
  await expect(datum.getByRole("button", { name: /as JSON/ })).toBeVisible();
  await snap(page, "tx-detail-datum");
  // And the icon beside Spends says why it holds nothing about what they hold.
  await expect(view.getByTestId("move-in-tx-inputs-hint")).toHaveAttribute(
    "title",
    /looking them up would tell whoever was asked/,
  );
  expect(koios.submitted).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
});

test("a payment Koios didn't answer may have gone through: Home waits for it, with no Dismiss, and new payments wait too", async ({
  context,
  koios,
}) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Send publicly" }).click();
  await page.getByLabel("To", { exact: true }).fill(vector(15).preprod.receive_0);
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("send-review")).toContainText("Amount5 ₳");

  // Koios takes it, then never answers: it may be on its way, so it isn't a failure.
  koios.submitAnswer = () => "timeout";
  await page.getByRole("button", { name: "Send" }).click();
  const banner = page.getByTestId("pending-tx");
  // What to do first, then why; how long it can still land, with its date past midnight, under Details (chunk 23's
  // second review, HM-4).
  await expect(banner).toContainText("Payment not confirmed yet: don't pay it again");
  await expect(banner).toContainText("Koios didn't answer, so it may have gone through");
  await expect(banner.getByRole("button", { name: "Check now" })).toBeVisible();
  await expect(banner).toContainText(/It can land until about (\d+ \w+, )?\d\d:\d\d/);
  await expect(banner.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
  expect(koios.submitted).toHaveLength(1);
  // New payments wait for it, on either side, and say why.
  const waits = /^Your last payment may still go through/;
  for (const name of ["Send publicly", "Make private"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("title", waits);
  }
  await page.getByRole("tab", { name: "Private", exact: true }).click();
  for (const name of ["Send privately", "Make public"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await snap(page, "maybe-sent");

  // The worker keeps it: a page opened now shows it the same way.
  koios.submitAnswer = undefined;
  await page.close();
  const panel = await openApp(context, "panel");
  const again = panel.getByTestId("pending-tx");
  await expect(again).toContainText("Payment not confirmed yet: don't pay it again");
  await expect(again.getByRole("button", { name: "Dismiss" })).toHaveCount(0);

  // The chain shows it: confirmed, and only now can it be dismissed.
  koios.confirmations = 1;
  await expect(again).toContainText("Payment confirmed", { timeout: 20_000 });
  await expect(again.getByRole("button", { name: "Dismiss" })).toBeVisible();
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
  await expect(to).toHaveAttribute("placeholder", "addr_test1…, $handle or a Seedelf name");
  await to.fill(theirs.slice(0, 40));
  await expect(note).toContainText("64 characters long, only 0–9 and a–f, and starts 5eed0e1f");
  await to.fill(mine);
  await expect(note).toContainText("That Seedelf is yours. To put money into your private balance, use Make private.");
  await to.fill(` ${theirs.slice(0, 32).toUpperCase()} ${theirs.slice(32)} `);
  await expect(note).toContainText("Found: This is a test.");
  await expect(page.getByText("went from your public account to a private balance, though not whose")).toBeVisible();
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await snap(page, "send-seedelf-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("send-review");
  await expect(review).toContainText("ToThis is a test.");
  await expect(review).toContainText(`Seedelf name${theirs.slice(0, 16)}`);
  await expect(review).toContainText("Amount5 ₳");
  await expect(review).toContainText("Total leaving your public account");
  await expect(page.getByText("Only this Seedelf's owner can spend it")).toBeVisible();
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
  const account = ["account_addresses", "account_info", "credential_utxos", "epoch_params", "tip"];
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
  await addTokens(page, [TUSDM], first);
  await first.getByLabel(`Amount of ${TUSDM}`).fill("1000");
  // The second recipient's tUSDM box offers only what the first left.
  await addTokens(page, [TUSDM], second);
  await expect(second.getByText("of 2,999,999,000", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: `Take ${TUSDM} off` }).click();
  await second.getByLabel("To", { exact: true }).fill(transferPreprod.to);
  await expect(second.getByText("Found: This is a test.")).toBeVisible();
  await second.getByLabel("Amount", { exact: true }).fill("5");
  await expect(page.getByText("though not whose, and were paid together.")).toBeVisible();
  await snap(page, "send-several-form");
  await page.getByRole("button", { name: "Review" }).click();

  await expect(page.getByTestId("send-review-1")).toContainText("To$bob");
  await expect(page.getByTestId("send-review-1")).toContainText("Amount3 ₳");
  await expect(page.getByTestId("send-review-1")).toContainText(`1,000 ${TUSDM}`);
  await expect(page.getByTestId("send-review-2")).toContainText("ToThis is a test.");
  await expect(page.getByTestId("send-review-2")).toContainText("Amount5 ₳");
  await expect(page.getByTestId("send-review")).toContainText("To all recipients8 ₳ and 1 token");
  await expect(page.getByText("Only each Seedelf's owner can spend their payment")).toBeVisible();
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
  await expect(page.getByTestId("transfer-review")).toContainText("To all recipients7 ₳");
  await expect(page.getByTestId("transfer-to-self")).toContainText("Recipient 2's Seedelf is yours");
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
  await expect(page.getByText("Anyone can see these were paid together.")).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("withdraw-review-1")).toContainText("Amount5 ₳");
  await expect(page.getByTestId("withdraw-review-2")).toContainText("Amount2 ₳");
  await expect(page.getByTestId("withdraw-review")).toContainText("To all recipients7 ₳");
  expect(koios.submitted).toHaveLength(0);
});

test("create a Seedelf from the public account: review, send, then watch it confirm", async ({ context, koios }) => {
  koios.evaluation = accountMintPreprod.evaluation;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).not.toHaveText("— ₳");
  await page.getByRole("button", { name: "Create a Seedelf" }).click();

  // The Cardano account pays by default, and says what that links.
  await expect(page.getByRole("radio", { name: "Public account" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("mint-from-note")).toContainText("create it before making money private");
  await page.getByLabel("Tag (optional, anyone can read it)").fill("first");
  await snap(page, "account-mint-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("mint-review");
  await expect(review).toContainText("Seedelffirst");
  await expect(review).toContainText("Paid fromPublic account");
  await expect(review).toContainText("Locked with it1.74986 ₳");
  await expect(review).toContainText("Total leaving your public account");
  await snap(page, "account-mint-review");
  expect(koios.submitted).toHaveLength(0);

  // Signed at review: Send only submits, and giveme.my is never asked.
  await page.getByRole("button", { name: "Create Seedelf" }).click();
  const banner = page.getByTestId("pending-tx");
  await expect(banner).toContainText("Seedelf creation sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  expect(koios.collateralAsked).toBe(0);
  // Home is back on the side that paid, the public account (chunk 23's second review, HM-6).
  await expect(page.getByRole("tab", { name: "Public", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Private", exact: true }).click();
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
  await page.getByRole("radio", { name: "Private balance" }).click();
  await expect(page.getByTestId("mint-from-note")).toContainText("Only money others paid you keeps the Seedelf apart from your public account");

  // The tag: printable ASCII, 15 characters at most, previewed as it will read.
  const tag = page.getByLabel("Tag (optional, anyone can read it)");
  // With no tag there's no stand-in name: "Unnamed" could be someone's tag.
  await expect(page.getByTestId("mint-preview")).toContainText("With no tag, it's listed by its name alone");
  await expect(page.getByTestId("mint-preview")).not.toContainText("Unnamed");
  await tag.fill("héllo");
  await expect(page.getByRole("alert")).toContainText("A tag can't use “é”");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await tag.fill("a tag far too long for it");
  await expect(tag).toHaveValue("a tag far too l");
  await tag.fill("my tag");
  await expect(page.getByTestId("mint-preview")).toContainText("Listed as my tag");
  await expect(page.getByTestId("mint-preview")).toContainText("5eed0e1f6d7920746167…");
  await snap(page, "mint-form");
  await page.getByRole("button", { name: "Review" }).click();

  // Measured in the wallet: neither Ogmios nor giveme.my has heard of it yet.
  const review = page.getByTestId("mint-review");
  await expect(review).toContainText("Seedelfmy tag");
  await expect(review).toContainText("Locked with it1.74986 ₳");
  await expect(review).toContainText("Network fee0.2");
  // What leaves the private balance, and what it holds after, not the change (chunk 23's review, S-1).
  await expect(review).toContainText("Total leaving your private balance");
  await expect(review).toContainText(/Private balance after25\.99\d*\s₳/);
  expect(koios.calls).not.toContain("ogmios");
  expect(koios.collateralAsked).toBe(0);
  await snap(page, "mint-review");

  // giveme.my refuses (its answer to a transaction it can't validate): nothing is sent, and Create gives way to
  // building it again from the chain, giveme.my's words under Details (chunk 23's review, P-3).
  await page.getByRole("button", { name: "Create Seedelf" }).click();
  // Said as giveme.my's refusal, with the money unmoved, not a guess at something it spends (blind test §9.5).
  await expect(page.getByRole("alert")).toContainText(
    "Nothing was sent, so none of your money moved: giveme.my, which lends the collateral, turned it down",
  );
  await expect(page.getByTestId("review-stale")).toContainText("refused this transaction: Transaction Fails Validation");
  await expect(page.getByRole("button", { name: "Create Seedelf" })).toHaveCount(0);
  // A witness that isn't giveme.my's key over this transaction is caught in WebAssembly.
  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Refresh and review again" }).click();
  // The new review says it's new, over its button (chunk 23's second review, PY-1).
  await expect(page.getByTestId("review-renewed")).toHaveText("Review updated just now. Check it again.");
  await page.getByRole("button", { name: "Create Seedelf" }).click();
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
  await expect(note).toContainText("64 characters long, only 0–9 and a–f, and starts 5eed0e1f");
  await name.fill(`5eed0e1f${"00".repeat(28)}`);
  await expect(note).toContainText("No Seedelf with that name on preprod.");
  await name.fill(await clipboard());
  await expect(note).toContainText("Found: web-wallet");
  await expect(page.getByTestId("transfer-own")).toContainText("This Seedelf is yours");
  await name.fill(` ${theirs.slice(0, 32).toUpperCase()} ${theirs.slice(32)} `);
  await expect(note).toContainText("Found: This is a test.");
  await expect(page.getByTestId("transfer-own")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();

  // 5 ₳ and 1 of the private tUSDM, of the 1,234.56 held.
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await addTokens(page, [PRIVATE_TUSDM]);
  const tusdm = page.getByLabel(`Amount of ${PRIVATE_TUSDM}`);
  await tusdm.fill("2000");
  await expect(tusdm).toHaveValue("");
  await expect(page.getByText(`That's more than the 1,234.56 ${PRIVATE_TUSDM} you hold.`)).toBeVisible();
  await tusdm.fill("1234.561");
  await expect(tusdm).toHaveValue("");
  await tusdm.fill("1.1234567");
  await expect(tusdm).toHaveValue("1.123456");
  await expect(page.getByText(`${PRIVATE_TUSDM} has at most 6 decimal places`)).toBeVisible();
  await tusdm.fill("1");
  await snap(page, "transfer-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("transfer-review");
  await expect(review).toContainText("ToThis is a test.");
  await expect(review).toContainText("Amount5 ₳");
  await expect(review).toContainText(`1 ${PRIVATE_TUSDM}`);
  // About 0.2739 ₳, measured in the wallet (a hair less when the new one-time
  // key's hash sorts before giveme.my's among the signers the script searches).
  await expect(review).toContainText("Network fee0.273");
  // The amount and the fee leave the private balance; Home will show 28 ₳ less that (chunk 23's review, S-1, S-3).
  await expect(review).toContainText(/Total leaving your private balance5\.27\d*\s₳ and 1\stokenPrivate balance after22\.72[67]\d*\s₳/);
  // Measured in the wallet, to the recorded fee: no draft went to Ogmios.
  expect(koios.calls).not.toContain("ogmios");
  expect(koios.collateralAsked).toBe(0);
  // Koios was only ever asked about the whole contract, never the recipient's token.
  expect(koios.calls.filter((c) => c.startsWith("asset"))).toEqual([]);
  // Who giveme.my is, whose the collateral is and what it costs, on the review (blind test §9.5).
  await expect(page.getByTestId("giveme-note")).toContainText("giveme.my lends the collateral, free: 5 ₳ of its own.");
  await expect(page.getByTestId("giveme-note")).toContainText("with your IP address");
  await snap(page, "transfer-review");

  // giveme.my refuses: nothing is sent, and Send gives way to building it again (chunk 23's review, P-3). The
  // headline names giveme.my, not something it spends, since the device knows of nothing spent (blind test §9.5).
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("Nothing was sent");
  await expect(page.getByRole("alert")).toContainText("giveme.my, which lends the collateral, turned it down");
  await expect(page.getByTestId("review-stale")).toContainText("refused this transaction: Transaction Fails Validation");
  await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0);
  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Refresh and review again" }).click();
  // The new review says it's new, over Send (chunk 23's second review, PY-1).
  await expect(page.getByTestId("review-renewed")).toHaveText("Review updated just now. Check it again.");
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
  await addTokens(page, [PRIVATE_TUSDM]);
  await page.getByRole("button", { name: "Max" }).click();
  await expect(page.getByTestId("withdraw-max-note")).toContainText("up to 20 UTxOs");
  await expect(page.getByLabel(`Amount of ${PRIVATE_TUSDM}`)).toHaveCount(0);
  await page.getByRole("button", { name: "Max" }).click();
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await page.getByLabel(`Amount of ${PRIVATE_TUSDM}`).fill("1");
  await snap(page, "withdraw-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("withdraw-review");
  await expect(review).toContainText("To$bob");
  await expect(review).toContainText("Amount5 ₳");
  await expect(review).toContainText(`1 ${PRIVATE_TUSDM}`);
  // The recorded fee (0.27027 ₳), or 602 lovelace less when the new one-time
  // key's hash sorts before giveme.my's among the signers the script searches.
  // \s: the ₳ keeps to its number with a no-break space (chunk 23's second review, V-7).
  await expect(review).toContainText(/Network fee0\.(27027|269668)\s₳/);
  await expect(review).toContainText(/Total leaving your private balance5\.2(7027|69668)\s₳/);
  expect(koios.collateralAsked).toBe(0);
  await snap(page, "withdraw-review");

  // giveme.my refuses: nothing is sent, and Send gives way to building it again (chunk 23's review, P-3).
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("review-stale")).toContainText("refused this transaction: Transaction Fails Validation");
  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Refresh and review again" }).click();
  // The new review says it's new, over Send (chunk 23's second review, PY-1).
  await expect(page.getByTestId("review-renewed")).toHaveText("Review updated just now. Check it again.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't match this transaction, so it wasn't sent");
  expect(koios.submitted).toHaveLength(0);
});

test("a private swap: Minswap's quote, a one-time account funded, and then it runs itself: the order, the fill, everything back", async ({
  context,
  koios,
  swaps,
}) => {
  // One spend: the funding takes the 25 ₳ UTxO alone.
  koios.evaluation = { ...withdrawPreprod.amount.evaluation, result: withdrawPreprod.amount.evaluation.result.slice(0, 1) };
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  // The dApp browser: Minswap's tile opens its swaps.
  await page.getByRole("button", { name: "dApps", exact: true }).click();
  await snap(page, "dapps");
  await page.getByTestId("dapps").getByRole("button", { name: /Minswap/ }).click();
  await expect(page.getByTestId("swaps-empty")).toBeVisible();
  await page.getByRole("button", { name: "New swap" }).click();

  // Minswap's shape: You pay, You receive, and the button says what's missing.
  await expect(page.getByRole("button", { name: "Select a token" })).toBeDisabled();
  await expect(page.getByTestId("swap-held")).toHaveText("28");
  await snap(page, "swap-form-empty");
  await page.getByLabel("You pay", { exact: true }).fill("30");
  await page.getByTestId("swap-to").click();

  // MIN, found on the wallet's own list: Minswap isn't asked what was searched for (privacy review §3.11).
  const picker = page.getByRole("dialog", { name: "You receive" });
  await expect(picker.getByTestId("swap-own-tokens")).toContainText("ADA");
  await picker.getByLabel("Search tokens").fill("MIN");
  await expect(picker.getByTestId("swap-listed-tokens")).toContainText("MIN");
  await expect(picker.getByTestId("swap-search-minswap")).toHaveText("Search Minswap for “MIN”");
  await snap(page, "swap-picker");
  await picker.getByTestId("swap-listed-tokens").getByRole("button", { name: /MIN/ }).click();
  expect(swaps.calls.map((c) => c.path)).not.toContain("tokens");
  await expect(picker).toBeHidden();
  await expect(page.getByTestId("swap-to")).toContainText("MIN");
  await expect(page.getByRole("button", { name: "Not enough ADA" })).toBeDisabled();
  await expect(page.getByTestId("swap-short")).toContainText("That's more than the 28 ₳ in your private balance");
  // Minswap quotes it all the same.
  await expect(page.getByTestId("swap-out")).toHaveText("906.5941");

  // 10 ₳: the quote fills in what's received, the rate turns around, and the details open.
  await page.getByLabel("You pay", { exact: true }).fill("10");
  // The last quote stays, dimmed, until the new one comes.
  await expect(page.getByRole("button", { name: "Review swap" })).toBeEnabled();
  await expect(page.getByTestId("swap-out")).toHaveText("906.5941");
  await expect(page.getByTestId("swap-rate")).toHaveText("1 ADA ≈ 90.6594 MIN");
  await page.getByTestId("swap-rate").click();
  await expect(page.getByTestId("swap-rate")).toHaveText("1 MIN ≈ 0.01103 ADA");
  await page.getByRole("button", { name: "The quote's details" }).click();
  const quote = page.getByTestId("swap-quote-rows");
  await expect(quote).toContainText("Asks for at least902.083681 MIN");
  await expect(quote).toContainText("Price impact0.34%");
  await expect(quote).toContainText("Slippage1%");
  await expect(quote).toContainText("RouteMinswap");
  await snap(page, "swap-form");

  // Slippage: its own setting, and a quote to match.
  await page.getByRole("button", { name: "Slippage: 1%" }).click();
  const settings = page.getByRole("dialog", { name: "Slippage" });
  await settings.getByLabel("Your own").fill("30");
  await expect(settings).toContainText("Between 0.1% and 20%");
  await settings.getByLabel("Your own").fill("2");
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(quote).toContainText("Slippage2%");
  await expect(page.getByRole("button", { name: "Review swap" })).toBeEnabled();
  await expect.poll(() => swaps.calls.filter((c) => c.path === "estimate").at(-1)?.body.slippage).toBe(2);

  // The funding: the swap and its costs, and the account's own collateral.
  await page.getByRole("button", { name: "Review swap" }).click();
  const summary = page.getByTestId("swap-summary");
  await expect(summary).toContainText("You pay10 ₳");
  await expect(summary).toContainText("You receive≈ 906.5941 MIN");
  // What Send approves: the four steps it then takes by itself; the least it may give is the summary's, said once.
  await expect(page.getByTestId("swap-steps")).toContainText("Built by Minswap");
  await expect(summary).toContainText("Asks for at least 902.083681 MIN");
  const fund = page.getByTestId("swap-fund-review");
  await expect(fund).toContainText("ToPrivate session 1");
  await expect(fund).toContainText("The swap and its costs16 ₳");
  await expect(fund).toContainText("Kept aside for contracts5 ₳, comes back");
  // What the swap and its costs pay for adds up to it, and the slippage and the minimum's trust in Minswap are said
  // (chunk 23's second review, DX-2, DX-3).
  await expect(fund).toContainText("The swap10 ₳");
  // What leaves the 28 ₳ now, 16 + 5 + the fee, and the balance after, as every other review says them; then what the
  // whole swap costs, about 0.25 ₳ for each later fee, and what comes back: the 5 ₳, the 2 ₳ deposit and the room's
  // rest, 8.5 ₳ whatever this payment's fee (blind test §9.8, T10).
  await expect(fund).toContainText(/Total leaving your private balance21\.\d+\s₳/);
  await expect(fund).toContainText(/Private balance after6\.\d+\s₳/);
  const costs = page.getByTestId("swap-costs");
  await expect(costs).toContainText("DEX fee2 ₳");
  await expect(costs).toContainText(/Costs in all, about2\.7\d\s₳/);
  await expect(costs).toContainText("Comes back, about906.5941 MIN and 8.5 ₳");
  await expect(page.getByTestId("swap-costs-note")).toContainText("about 0.25 ₳ each for the order and the return");
  await expect(summary).toContainText("2% slippage");
  await expect(page.getByTestId("swap-minimum-trust")).toContainText("The wallet relies on Minswap for the minimum of 902.083681 MIN");
  await snap(page, "swap-fund-review");
  // giveme.my refuses (its recorded answer): nothing is sent, but the session keeps its account. Start swap gives
  // way to building it again, on a fresh account, giveme.my's words under Details (chunk 23's second review, DX-1).
  await page.getByRole("button", { name: "Start swap", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Nothing was sent");
  await expect(page.getByTestId("review-stale")).toContainText("refused this transaction");
  await expect(page.getByRole("button", { name: "Start swap", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Build it again" })).toBeEnabled();
  expect(koios.submitted).toHaveLength(0);

  // Say it reached the chain anyway, and the account holds it: from here the swap runs itself.
  koios.confirmations = 1;
  koios.addedToAccounts.push({
    ...sessionSwap.utxo,
    payment_cred: sessionSwap.keyHash,
    stake_address: null,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    asset_list: [],
    is_spent: false,
  });
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Back", exact: true }).click();
  // In progress, with its pair and a tag for how it's doing.
  await expect(page.getByRole("region", { name: "In progress" })).toContainText("10 ₳ → MINRunning");
  // Minswap's rate limit, first: the timeline says so in plain words, and when it tries again.
  swaps.limited = true;
  await page.getByTestId("swaps").getByRole("button").first().click();
  const timeline = page.getByTestId("session-timeline");
  const retry = page.getByTestId("session-retry");
  await expect(retry).toContainText("Minswap is limiting requests from this connection for a minute. Trying again in under a minute.");
  await expect(retry).toContainText("Minswap is limiting requests from your connection");
  await expect(timeline.locator('[data-state="paused"]')).toHaveCount(1);
  await snap(page, "swap-retry");

  // Try now: the order, from a fresh quote, for at least what was approved, signed by the session's key alone.
  swaps.limited = false;
  await retry.getByRole("button", { name: "Try now" }).click();
  await expect(page.getByTestId("session-now")).toContainText("The order is on its way");
  expect(swaps.calls.find((c) => c.path === "build-tx")?.body).toMatchObject({
    sender: sessionSwap.address,
    min_amount_out: "902083681",
  });
  expect(koios.submitted).toHaveLength(1);
  const swapTx = koios.submitted[0]!;
  await expect(timeline.locator('[data-state="done"]')).toHaveCount(1);
  await snap(page, "swap-running");

  // The dApp browser and Home both show it running; Home's row opens its page.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("dapps")).toContainText("1 running");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  // Running; the dApps page read the chain on its way, so it may already know the order landed.
  await expect(page.getByTestId("swaps-running")).toContainText("10 ₳ → MINRunning");
  await snap(page, "home-swaps-running");
  await page.getByTestId("swaps-running").getByRole("button").click();
  await expect(timeline).toBeVisible();

  // Filled: a batcher spent the order, the change and the proceeds are at the account, and it all comes back by itself.
  koios.spent.add(`${swapTx}#0`);
  const funded = koios.addedToAccounts[0]!;
  koios.addedToAccounts.splice(0, 1, { ...funded, tx_hash: swapTx, tx_index: 1, value: "131585414" }, {
    ...funded,
    tx_hash: "aa".repeat(32),
    tx_index: 0,
    value: "2000000",
    asset_list: [
      {
        policy_id: "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72",
        asset_name: "4d494e",
        quantity: "906594100",
        decimals: 0,
        fingerprint: "",
      },
    ],
  });
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("session-now")).toContainText("Coming back into your private balance");
  await expect(timeline.locator('[data-state="done"]')).toHaveCount(3);
  await expect(page.getByTestId("session-rows")).toContainText("906.5941 MIN");
  expect(koios.submitted).toHaveLength(2);

  // The return lands and the account is empty, and Koios shows the funding's outputs spent: done, in the success colour.
  koios.addedToAccounts.splice(0);
  koios.unlistedSpent = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("session-now")).toHaveText("Done: the swap is in your private balance.");
  await expect(timeline).toHaveClass(/timeline--done/);
  await expect(timeline.locator('[data-state="done"]')).toHaveCount(4);
  await snap(page, "swap-done");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("region", { name: "Past swaps" })).toContainText("10 ₳ → MINDone");
  await expect(page.getByRole("region", { name: "In progress" })).toHaveCount(0);
  await snap(page, "swaps");
  // MIN is on the wallet's own list, so Minswap is never asked to search (privacy review §3.11). One quote for
  // 30 ₳, one for 10 ₳, one at 2% slippage, the order's fresh one refused by the rate limit, then again; never a
  // cancel, and never its list of orders: the wallet reads the order from chain (chunk 24, Step 3).
  const paths = swaps.calls.map((c) => c.path);
  expect(paths).not.toContain("tokens");
  expect(paths.slice(0, 6)).toEqual(["estimate", "estimate", "estimate", "estimate", "estimate", "build-tx"]);
  expect(paths).not.toContain("pending-orders");
  expect(paths).not.toContain("cancel-tx");
});

test("Lovejoin: mix in 10 ₳ boxes from either side, with what it costs; a public mix is sent, and Home shows the box on its way", async ({
  context,
  koios,
}) => {
  koios.addedToAccounts.push(...lovejoinPool);
  // The network agrees with each chain's first mix; a Seedelf spend is measured as recorded.
  const spend = { ...withdrawPreprod.amount.evaluation, result: withdrawPreprod.amount.evaluation.result.slice(0, 1) };
  koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
    body.params.additionalUtxo ? { jsonrpc: "2.0", method: "evaluateTransaction", result: [] } : spend;
  // The public account: a collateral, and ADA alone to mix.
  const [rich] = (Object.values(koiosPreprod.accounts)[0] as { account_utxos: Array<Record<string, any>> }).account_utxos.filter(
    (u) => BigInt(u.value) > 1_000_000_000n,
  );
  const at = (tx: string, value: string) => ({ ...rich!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] }) as never;
  koios.addedToAccounts.push(at("e5", "5000000"), at("e6", "30000000"));

  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "dApps", exact: true }).click();
  await page.getByTestId("dapps").getByRole("button", { name: /Lovejoin/ }).click();
  await expect(page.getByTestId("lovejoin-status")).toContainText("Your boxes in the poolNone");

  // One box at depth 2 (the default): the box, four mixes, and the deposit's change, into a one-time account.
  await expect(page.getByTestId("lovejoin-boxes")).toHaveText("1 box, 10 ₳");
  const cost = page.getByTestId("lovejoin-mix-cost");
  await expect(cost).toContainText("Mixed2 waves deep, 4 mixes");
  // What it costs, all told, and the rows under it add up to it: the four mixes at about 0.95 ₳, three network fees
  // (this payment, the deposit, the return) at about 0.25 ₳, and 0.3 ₳ to bring the box back (blind test §9.8, T11).
  await expect(cost).toContainText("Mixing 10 ₳ costs about4.85 ₳ (48.5%)");
  await expect(cost).toContainText("Mix fees, about3.8 ₳");
  await expect(cost).toContainText("Network fees, about0.75 ₳");
  await expect(cost).toContainText("Bringing it back, about0.3 ₳");
  // What leaves now and what comes back: 15.3 ₳ is the box, its mixes and a 1.5 ₳ reserve, named; 5 ₳ kept aside.
  const moves = page.getByTestId("lovejoin-mix-moves");
  await expect(moves).toContainText(
    "Into a one-time account15.3 ₳The box10 ₳Mix fees, about3.8 ₳Room for network fees1.5 ₳, what's left comes back",
  );
  await expect(moves).toContainText("Kept aside for contracts5 ₳, comes back");
  await expect(moves).toContainText("Total leaving your private balance, about20.55 ₳");
  await expect(moves).toContainText("Comes back once it's mixed, about6 ₳");
  // What "waves deep" means, behind its ⓘ on the page, where a short pool never reaches the review (T11).
  await page.getByTestId("lovejoin-waves-hint").click();
  await expect(page.getByTestId("lovejoin-waves")).toContainText("yours is one of up to 9");
  // Whether the pool has others enough, before Review; and 28 ₳ pays for one box, so the stepper stops there, and
  // says why (chunk 23's second review, LJ-1, LJ-3).
  await expect(cost).toContainText(/Lovejoin's pool\d+ other boxes to mix with: enough/);
  await expect(page.getByRole("button", { name: "One box more" })).toBeDisabled();
  await expect(page.getByTestId("lovejoin-boxes-cap")).toContainText("Your private balance pays for 1 box at most");
  // When it comes back, and less what bringing it back costs: only while the wallet is unlocked (LJ-2).
  await expect(moves).toContainText("Back laterThe box, about 9.7 ₳ once brought back, after 1 to 6 hours");
  await expect(page.getByTestId("lovejoin-mix-rest")).toContainText("only while Seedelf Wallet is unlocked");
  // The public account's balance isn't capped here: two boxes, eight mixes.
  await page.getByRole("tab", { name: "Public account" }).click();
  await page.getByRole("button", { name: "One box more" }).click();
  await expect(page.getByTestId("lovejoin-boxes")).toHaveText("2 boxes, 20 ₳");
  await expect(cost).toContainText("Mixed2 waves deep, 8 mixes");
  await page.getByRole("button", { name: "One box fewer" }).click();
  await page.getByRole("tab", { name: "Private balance" }).click();
  await snap(page, "lovejoin-mix");

  // From the private balance: the one-time account's funding, then what runs by itself.
  await page.getByTestId("lovejoin-mix").click();
  const funding = page.getByTestId("lovejoin-private-review");
  await expect(funding).toContainText("ToPrivate session 1");
  await expect(funding).toContainText("For the boxes, their mixes and network fees15.3 ₳");
  await expect(funding).toContainText("Kept aside for contracts5 ₳, comes back");
  // What leaves the 28 ₳ and what it holds after, not the change (blind test §9.8).
  await expect(funding).toContainText(/Total leaving your private balance20\.\d+\s₳/);
  await expect(funding).toContainText(/Private balance after7\.\d+\s₳/);
  await expect(page.getByTestId("lovejoin-private-then")).toContainText("Into Lovejoin1 box of 10 ₳");
  await snap(page, "lovejoin-private-review");
  // giveme.my refuses (its recorded answer): nothing is sent, Start mix gives way to building it again (chunk 23's
  // second review, DX-1), and the mix says its funding didn't go through, and why.
  await expect(page.getByTestId("lovejoin-send")).toHaveText("Start mix");
  await page.getByTestId("lovejoin-send").click();
  await expect(page.getByRole("alert")).toContainText("Nothing was sent");
  await expect(page.getByTestId("review-stale")).toContainText("refused this transaction");
  await expect(page.getByTestId("lovejoin-send")).toHaveCount(0);
  expect(koios.submitted).toHaveLength(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("lovejoin-mixes")).toContainText("1 box of 10 ₳Not fundedIts funding didn't go through");
  // Why: giveme.my turned it away, said as that, not as something the user's money did (blind test §9.5).
  await expect(page.getByTestId("lovejoin-mixes")).toContainText("giveme.my, the service that lends its collateral, turned it down.");

  // From the public account: the deposit and every mix, sent one after another.
  await page.getByRole("tab", { name: "Public account" }).click();
  await expect(page.getByTestId("lovejoin-mix-moves")).toContainText(
    "From your public accountNeeds 15.3 ₳ in ADA alone, plus collateral for the mixes; what isn't used stays",
  );
  // The box, its mixes and the deposit's fee leave it; nothing else comes back but the box.
  await expect(page.getByTestId("lovejoin-mix-moves")).toContainText("Total leaving your public account, about14.05 ₳");
  await expect(cost).toContainText("Mixing 10 ₳ costs about4.35 ₳ (43.5%)");
  await page.getByTestId("lovejoin-mix").click();
  const review = page.getByTestId("lovejoin-public-review");
  await expect(review).toContainText("Into Lovejoin1 box of 10 ₳");
  await expect(review).toContainText("Transactions5");
  await snap(page, "lovejoin-public-review");
  await page.getByTestId("lovejoin-send").click();
  await expect(page.getByRole("heading", { name: "Lovejoin", level: 1 })).toBeVisible();
  // Paced: four go now, and no more until a block takes some. The page shows it on its way, as Home does.
  await expect.poll(() => koios.submitted.length).toBe(4);
  await expect(page.getByTestId("lovejoin-public-sending")).toContainText("4 of 5 transactions sent");
  await expect(page.getByTestId("pending-tx")).toContainText("Mixes into Lovejoin sent. Waiting for the network…");
  // A block takes them: the open page sends the last, and the banner sees it in.
  koios.confirmations = 1;
  await expect.poll(() => koios.submitted.length, { timeout: 20_000 }).toBe(5);
  await expect(page.getByTestId("lovejoin-public-sending")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId("pending-tx")).toContainText("In Lovejoin, on their way to your private balance", { timeout: 20_000 });

  // Home shows the box on its way back, from the device's own schedule; its row opens Lovejoin's page.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const held = page.getByTestId("in-lovejoin");
  await expect(held).toContainText("1 box of 10 ₳");
  await expect(held).toContainText("10 ₳");
  await snap(page, "home-in-lovejoin");
  await held.click();
  await expect(page.getByRole("heading", { name: "Lovejoin", level: 1 })).toBeVisible();
});

test("Lovejoin: mix my boxes again, paid from the private balance: the review says what it takes, and the mix shows as mixed again", async ({
  context,
  koios,
}) => {
  const phrase = vector(12).phrase;
  koios.addedToAccounts.push(...lovejoinPool, ownedLovejoinBox(phrase, "d6"), ownedLovejoinBox(phrase, "d7"), ownedLovejoinBox(phrase, "d8"));
  // A restored wallet has no record of them: Koios says mixes made them (independent review M14).
  madeByMix(koios, "d6".repeat(32), "d7".repeat(32), "d8".repeat(32));
  koios.evaluation = { ...withdrawPreprod.amount.evaluation, result: withdrawPreprod.amount.evaluation.result.slice(0, 1) };
  const page = await openApp(context);
  await restore(page, phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "dApps", exact: true }).click();
  await page.getByTestId("dapps").getByRole("button", { name: /Lovejoin/ }).click();
  await expect(page.getByTestId("lovejoin-status")).toContainText("Your boxes in the pool3 boxes, 30 ₳");

  // Two waves deep, the pool's 20 other boxes mix two of the three: eight mixes and the change they leave, into a
  // one-time account. No box to pay for.
  await page.getByTestId("lovejoin-again").click();
  await expect(page.getByRole("heading", { name: "Review mixing again" })).toBeVisible();
  const funding = page.getByTestId("lovejoin-again-review");
  await expect(funding).toContainText("ToPrivate session 1");
  await expect(funding).toContainText("For the mixes and network fees9.1 ₳");
  await expect(funding).toContainText("Kept aside for contracts5 ₳");
  const then = page.getByTestId("lovejoin-again-then");
  await expect(then).toContainText("Mixed again2 of your 3 boxes in the pool");
  await expect(page.getByTestId("lovejoin-again-rest")).toContainText("The pool has room for 2 boxes at this depth now");
  await expect(then).toContainText("Mixed2 waves deep, 8 mixes, about 7.6 ₳");
  await expect(then).toContainText("Back laterEach box on its own, after 1 to 6 hours from the mixes");
  await snap(page, "lovejoin-again-review");

  // giveme.my refuses (its recorded answer): nothing is sent, and the mix says its funding didn't go through.
  await page.getByTestId("lovejoin-send").click();
  await expect(page.getByTestId("review-stale")).toContainText("refused this transaction");
  expect(koios.submitted).toHaveLength(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("lovejoin-mixes")).toContainText("2 boxes mixed againNot fundedIts funding didn't go through");
  // Nothing is mixing them: both buttons stay.
  await expect(page.getByTestId("lovejoin-again")).toBeEnabled();
  await expect(page.getByTestId("lovejoin-now")).toBeEnabled();
  await expect(page.getByTestId("lovejoin-again-running")).toHaveCount(0);
});

/**
 * A mix from the public account that stopped partway: the deposit went in,
 * the network turned the first mix away, and the pool lists the deposit's
 * box under the wallet's key. Lovejoin's page, read again, is open.
 */
async function stoppedPublicMix(context: BrowserContext, koios: KoiosFake): Promise<Page> {
  const phrase = vector(12).phrase;
  koios.addedToAccounts.push(...lovejoinPool);
  const spend = { ...withdrawPreprod.amount.evaluation, result: withdrawPreprod.amount.evaluation.result.slice(0, 1) };
  koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
    body.params.additionalUtxo ? { jsonrpc: "2.0", method: "evaluateTransaction", result: [] } : spend;
  // The public account: a collateral, and ADA alone to mix.
  const [rich] = (Object.values(koiosPreprod.accounts)[0] as { account_utxos: Array<Record<string, any>> }).account_utxos.filter(
    (u) => BigInt(u.value) > 1_000_000_000n,
  );
  const at = (tx: string, value: string) => ({ ...rich!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] }) as never;
  koios.addedToAccounts.push(at("e5", "5000000"), at("e6", "30000000"));
  // The deposit goes in, and the network turns the first mix away: the chain stops with its box not mixed.
  koios.submitAnswer = (n) => (n > 1 ? { status: 400, body: "ConwayUtxowFailure (ScriptWitnessNotValidatingUTXOW)" } : undefined);

  const page = await openApp(context);
  await restore(page, phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "dApps", exact: true }).click();
  await page.getByTestId("dapps").getByRole("button", { name: /Lovejoin/ }).click();
  await page.getByRole("tab", { name: "Public account" }).click();
  await page.getByTestId("lovejoin-mix").click();
  await expect(page.getByTestId("lovejoin-public-review")).toContainText("Transactions5");
  await page.getByTestId("lovejoin-send").click();
  // The review says why it stopped: the deposit went in, and nothing after it.
  await expect(page.getByRole("alert")).toContainText("The network rejected the transaction");
  expect(koios.submitted).toHaveLength(1);
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // The pool lists the deposit's box, under the wallet's key.
  const [deposit] = koios.submitted;
  koios.addedToAccounts.push({ ...ownedLovejoinBox(phrase, "00"), tx_hash: deposit, tx_index: 0 });
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("lovejoin-status")).toContainText("Not mixed yet1 box");
  return page;
}

test("Lovejoin: a mix that stopped partway leaves its box not mixed yet, said so, and Bring one back anyway asks first", async ({
  context,
  koios,
}) => {
  const page = await stoppedPublicMix(context, koios);
  await expect(page.getByTestId("lovejoin-status")).toContainText("Your boxes in the pool1 box, 10 ₳");
  // It never comes back by itself: no next one back.
  await expect(page.getByTestId("lovejoin-status")).not.toContainText("Next one back");
  const chains = page.getByTestId("lovejoin-chains");
  await expect(chains).toContainText("From your public account, 1 boxStopped");
  await expect(chains).toContainText("Stopped after 1 of 5 transactions");
  await expect(chains).toContainText("Why it stopped: The network rejected the transaction");
  const notMixed = page.getByTestId("lovejoin-not-mixed");
  await expect(notMixed).toContainText("One of your boxes isn't mixed yet");
  // Mixing it again comes first, paid by the public account that put it in: never the private balance unless asked (privacy review §2.10).
  await expect(notMixed).toContainText("It came from your public account: Mix again from my public account takes it first");
  await expect(page.getByTestId("lovejoin-again-public")).toHaveClass(/primary/);
  await expect(page.getByTestId("lovejoin-again")).toHaveCount(0);
  await expect(page.getByTestId("lovejoin-again-anyway")).toBeVisible();
  await snap(page, "lovejoin-not-mixed");

  // Bring one back anyway asks first: it shows where the box went in. Keep it keeps it.
  const asked = koios.collateralAsked;
  await notMixed.getByTestId("lovejoin-anyway").click();
  const ask = page.getByRole("dialog", { name: "Bring back a box that wasn't mixed?" });
  await expect(ask).toContainText("anyone can tie your public account to your private balance");
  await snap(page, "lovejoin-anyway");
  await ask.getByRole("button", { name: "Keep it" }).click();
  await expect(ask).toHaveCount(0);
  expect(koios.collateralAsked).toBe(asked);
  // Said yes, the worker builds the withdraw of that box as it is; giveme.my refuses it (its recorded answer).
  await notMixed.getByTestId("lovejoin-anyway").click();
  await page.getByTestId("lovejoin-anyway-confirm").click();
  await expect(page.getByRole("alert")).toContainText("refused this transaction");
  expect(koios.collateralAsked).toBe(asked + 1);
  expect(koios.submitted).toHaveLength(1);

  // Home's In Lovejoin row flags it too, and opens Lovejoin.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("in-lovejoin-flag")).toHaveText("1 not mixed yet, and a mix stopped partway: open Lovejoin to see what to do.");
  await page.getByTestId("in-lovejoin").click();
  await expect(page.getByRole("heading", { name: "Lovejoin", level: 1 })).toBeVisible();
});

// The deposit set its box's withdraw time as it went in. The chain stopped, so
// the box never comes back by itself, and its time went with the stop
// (lovejoin.ts unschedule): Home's row counts the box, not mixed yet, and
// no next one back.
test("Lovejoin: a pool under its floor offers to seed it, and says the seed hides nothing", async ({ context, koios }) => {
  // No pool at all, and mainnet's floor of 30: nothing can be mixed, and a mix
  // is what puts boxes in, so the page has to offer the way to start one.
  const [rich] = (Object.values(koiosPreprod.accounts)[0] as { account_utxos: Array<Record<string, any>> }).account_utxos.filter(
    (u) => BigInt(u.value) > 1_000_000_000n,
  );
  const at = (tx: string, value: string) => ({ ...rich!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] }) as never;
  koios.addedToAccounts.push(at("e5", "5000000"), at("e6", "30000000"));

  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await chooseNetwork(context, "mainnet");
  await page.reload();
  await expect(page.getByTestId("network")).toHaveText("MAINNET");
  await page.getByRole("button", { name: "dApps", exact: true }).click();
  await page.getByTestId("dapps").getByRole("button", { name: /Lovejoin/ }).click();

  // Mix says, before Review and with Review off, that the pool is under its floor (chunk 23's second review,
  // LJ-1, LJ-6); seeding sits under it, behind its own link, still saying it hides nothing.
  await expect(page.getByTestId("lovejoin-mix")).toBeDisabled();
  await expect(page.getByTestId("lovejoin-mix-why")).toContainText("pool holds 30 boxes not yours. It holds 0");
  await expect(page.getByTestId("lovejoin-seed-offer")).toHaveCount(0);
  await expect(page.getByTestId("lovejoin-seed-open")).toHaveText("Help start the pool");
  await expect(page.getByTestId("lovejoin-seed-short")).toContainText("It hides nothing of yours");
  await page.getByTestId("lovejoin-seed-open").click();
  const offer = page.getByTestId("lovejoin-seed-offer");
  await expect(offer).toContainText("holds 0 boxes not yours");
  await expect(offer).toContainText("the wallet mixes only from 30");
  await expect(offer).toContainText("Seeding hides nothing of yours");
  await expect(offer).toContainText("so seeding won't let this wallet mix");
  // The count is typed, and starts at what the pool still needs: the whole
  // floor goes in one transaction, not thirty presses of a stepper.
  await expect(page.getByTestId("lovejoin-seed-boxes")).toHaveValue("30");
  await expect(page.getByTestId("lovejoin-seed")).toContainText("Seed the pool with 30 boxes");
  // It seeds from whichever side is chosen, as a mix does, and says which pays.
  await expect(page.getByTestId("lovejoin-seed-cost")).toContainText("30 boxes, 300 ₳ from your private balance");
  await expect(offer).toContainText("Paid from your private balance, it ties the private UTxOs it spends to the boxes");
  // 300 ₳ is more than the private balance's 28 ₳: said up front, in its own words (LJ-6).
  await expect(page.getByTestId("lovejoin-seed")).toBeDisabled();
  await expect(page.getByTestId("lovejoin-seed-why")).toContainText("not enough for that many");
  await page.getByRole("tab", { name: "Public account" }).click();
  await expect(page.getByTestId("lovejoin-seed-cost")).toContainText("30 boxes, 300 ₳ from your public account");
  await expect(offer).toContainText("It's paid from your public account, in one transaction.");
  // The count is typed, so the whole floor isn't thirty presses of a stepper.
  await page.getByTestId("lovejoin-seed-boxes").fill("12");
  await expect(page.getByTestId("lovejoin-seed-cost")).toContainText("12 boxes, 120 ₳");
  await expect(page.getByTestId("lovejoin-seed")).toContainText("Seed the pool with 12 boxes");
});

test("Lovejoin: Home's row doesn't count a box not mixed yet as on its way back", async ({ context, koios }) => {
  const page = await stoppedPublicMix(context, koios);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const held = page.getByTestId("in-lovejoin");
  await expect(held).toContainText("1 box of 10 ₳");
  await expect(held).toContainText("Not on their way back");
  await expect(held).not.toContainText("Next back");
});

test("auto-lock counts down its last minutes on any screen: Stay unlocked puts it off, and at 0:00 the wallet locks", async ({
  context,
}) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Settings" }).click();
  const countdown = page.getByTestId("lock-countdown");
  await expect(countdown).toHaveCount(0);

  // The last activity was 13 minutes and 20 seconds ago (the lock is 15 minutes): asking, the page shows the countdown.
  const idle = (ms: number) =>
    page.evaluate(async (at) => {
      await chrome.storage.session.set({ "seedelf.lastActivity": at });
      window.dispatchEvent(new Event("focus"));
    }, Date.now() - ms);
  await idle(15 * 60_000 - 100_000);
  await expect(countdown).toContainText(/Locking in 1:[34]\d/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await snap(page, "lock-countdown");

  // Stay unlocked is activity: the lock is 15 minutes off again.
  await page.getByTestId("lock-stay").click();
  await expect(countdown).toHaveCount(0);
  const last = await page.evaluate(async () => (await chrome.storage.session.get("seedelf.lastActivity"))["seedelf.lastActivity"] as number);
  expect(Date.now() - last).toBeLessThan(10_000);

  // Left alone to 0:00, the wallet locks.
  await idle(15 * 60_000 - 3_000);
  await expect(countdown).toContainText(/Locking in 0:0\d/);
  await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible({ timeout: 10_000 });
  await expect(countdown).toHaveCount(0);
});

test("a private swap paused by a price move, then stopped: everything comes back and nothing is ordered", async ({
  context,
  koios,
  swaps,
}) => {
  koios.evaluation = { ...withdrawPreprod.amount.evaluation, result: withdrawPreprod.amount.evaluation.result.slice(0, 1) };
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "dApps", exact: true }).click();
  await page.getByTestId("dapps").getByRole("button", { name: /Minswap/ }).click();
  await page.getByRole("button", { name: "New swap" }).click();
  await page.getByLabel("You pay", { exact: true }).fill("10");
  await page.getByTestId("swap-to").click();
  const picker = page.getByRole("dialog", { name: "You receive" });
  await picker.getByLabel("Search tokens").fill("MIN");
  await picker.getByTestId("swap-listed-tokens").getByRole("button", { name: /MIN/ }).click();
  await page.getByRole("button", { name: "Review swap" }).click();
  // giveme.my refuses, as recorded: say the funding reached the chain anyway.
  await page.getByRole("button", { name: "Start swap", exact: true }).click();
  await expect(page.getByTestId("review-stale")).toContainText("refused this transaction");
  koios.confirmations = 1;
  koios.addedToAccounts.push({
    ...sessionSwap.utxo,
    payment_cred: sessionSwap.keyHash,
    stake_address: null,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    asset_list: [],
    is_spent: false,
  });
  // Meanwhile the price moved: Minswap now expects less than the least approved.
  swaps.estimate = { ...(swaps.estimate as object), amount_out: "900000000", min_amount_out: "891000000" };
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByTestId("swaps").getByRole("button").first().click();

  // It pauses rather than place the order, and says why.
  const paused = page.getByTestId("session-paused");
  await expect(paused).toContainText("The price moved: an order now would give about 900 MIN, under the 902.083681 MIN minimum you approved");
  await expect(paused.getByRole("button", { name: "Review it myself" })).toBeVisible();
  await expect(page.getByTestId("session-timeline").locator('[data-state="paused"]')).toHaveCount(1);
  await snap(page, "swap-paused");
  // The list says it needs you, and why, in the warning colour.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("region", { name: "In progress" })).toContainText("10 ₳ → MINNeeds youThe price moved");
  await page.getByTestId("swaps").getByRole("button").first().click();

  // Stop, always there: one confirmation.
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Stop this swap?" });
  await expect(confirm).toContainText("If no order has gone out yet, none will");
  await snap(page, "swap-stop");
  await confirm.getByRole("button", { name: "Stop the swap" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId("session-now")).toContainText("Coming back into your private balance");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
  expect(koios.submitted).toHaveLength(1);

  // The return lands, and Koios shows the funding's outputs spent: stopped, everything back, and nothing was ever ordered.
  koios.addedToAccounts.splice(0);
  koios.unlistedSpent = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("session-now")).toHaveText("Stopped: everything is back in your private balance.");
  await expect(page.getByTestId("session-timeline").locator('[data-state="skipped"]')).toHaveCount(2);
  await snap(page, "swap-stopped");
  expect(swaps.calls.map((c) => c.path)).not.toContain("build-tx");
});

test("a private swap into a token neither listed nor verified by Minswap: the picker keeps it apart, and it can't be reviewed", async ({
  context,
  koios,
  swaps,
}) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "dApps", exact: true }).click();
  await page.getByTestId("dapps").getByRole("button", { name: /Minswap/ }).click();
  await page.getByRole("button", { name: "New swap" }).click();
  await page.getByLabel("You pay", { exact: true }).fill("10");
  await page.getByTestId("swap-to").click();

  // The private balance's tUSDM isn't the listed one: it's kept apart, after what Minswap lists, and says why.
  const picker = page.getByRole("dialog", { name: "You receive" });
  await expect(picker.getByTestId("swap-own-tokens")).toContainText("ADA");
  await expect(picker.getByTestId("swap-own-tokens")).not.toContainText(PRIVATE_TUSDM);
  await expect(picker.getByTestId("swap-unverified-note")).toContainText("anyone can copy a known token's name");
  const held = picker.getByTestId("swap-unverified-tokens").getByRole("button", { name: PRIVATE_TUSDM });
  await expect(held).toContainText("it calls itself tUSDM, but it isn't the listed tUSDM");
  await snap(page, "swap-picker-unverified");
  await held.click();

  // Minswap's verified list doesn't have it by its ID: the quote says so, and Review stays off.
  const unverified = page.getByTestId("swap-unverified");
  await expect(unverified).toContainText("Not verified by Minswap");
  await expect(unverified).toContainText("so the wallet won't swap into it");
  await expect(page.getByTestId("swap-out")).not.toBeEmpty();
  await expect(page.getByRole("button", { name: "Not verified by Minswap" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Review swap" })).toHaveCount(0);
  await snap(page, "swap-unverified");
  // Asked about by its ID alone; nothing was built or sent.
  const id = `${ownedUtxos[1].asset_list[0].policy_id}${ownedUtxos[1].asset_list[0].asset_name}`;
  expect(swaps.calls.filter((c) => c.path === "tokens").map((c) => c.body.query)).toContain(id);
  expect(swaps.calls.map((c) => c.path)).not.toContain("build-tx");
  expect(koios.submitted).toHaveLength(0);
});

test("remove a Seedelf: where its ADA goes, review, and nothing sent without giveme.my's real signature", async ({ context, koios }) => {
  koios.evaluation = withdrawPreprod.remove.evaluation;
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await page.getByRole("button", { name: "Receive privately" }).click();
  // Behind each card's Manage, with what removing does (chunk 23's second review, RX-2).
  await page.getByText("Manage", { exact: true }).click();
  await page.getByRole("button", { name: "Remove web-wallet" }).click();

  await expect(page.getByRole("heading", { name: "Remove web-wallet" })).toBeVisible();
  // Back returns to your seedelfs, and Remove again.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("seedelfs")).toContainText("web-wallet");
  await page.getByText("Manage", { exact: true }).click();
  await page.getByRole("button", { name: "Remove web-wallet" }).click();
  // Found after a restore: the wallet doesn't know who paid for it, so nothing is chosen and Review waits, since
  // either side can make a link the user didn't choose (privacy review §3.2). The note says which is the safer guess,
  // and each card says in a line what it links (chunk 23's second review, RX-3).
  const note = page.getByTestId("remove-to-note");
  await expect(note).toContainText("doesn't know who paid for this Seedelf");
  await expect(note).toContainText("If unsure, choose your private balance");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Private balance" })).toContainText("Links nothing new only if your private balance paid for it");
  await page.getByRole("radio", { name: "Private balance" }).click();
  await expect(note).toContainText("this ties the account to the new UTxO");
  await page.getByRole("radio", { name: "Public account" }).click();
  // The card says when it links nothing new; the note, only what the other case would tie (the copy-trim pass).
  await expect(page.getByRole("radio", { name: "Public account" })).toContainText("Links nothing new only if your public account paid for it");
  await expect(note).toContainText("If your private balance paid for it, this ties your public account to the Seedelf's name");
  await snap(page, "remove-form");
  await page.getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("remove-review");
  await expect(review).toContainText("Seedelfweb-wallet");
  // Measured in the wallet: the recorded fee, or a hair less when the new
  // one-time key's hash sorts before giveme.my's among the signers the scripts search.
  const shown = /Network fee(0\.\d+)\s₳/.exec((await review.textContent()) ?? "");
  const fee = Math.round(Number(shown![1]) * 1e6);
  const short = Number(withdrawPreprod.remove.final.fee.total) - fee;
  expect(short).toBeGreaterThanOrEqual(0);
  expect(short).toBeLessThan(1_000);
  await expect(review).toContainText(`Comes back to your public account${(1_500_000 - fee) / 1e6} ₳`);
  await snap(page, "remove-review");

  koios.collateral = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
  await page.getByRole("button", { name: "Remove Seedelf" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't match this transaction, so it wasn't sent");
  expect(koios.submitted).toHaveLength(0);
});

const LOGIC_DREP = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";

test("staking: the page, the pool browser, a change of pool reviewed and sent, then watched", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await expect(page.getByTestId("staking-row-pool")).toHaveText("Staking with LOGIC");

  // The page reads the pool's details and the account's DRep, fresh: never registered, so what registering costs too.
  let reads = koios.calls.length;
  await page.getByTestId("staking-row").click();
  await expect(page.getByRole("heading", { name: "Staking and governance" })).toBeVisible();
  // The DRep card's note on private money merged into this one: it still says it (chunk 23's second review, ST-7).
  await expect(page.getByText(/Private money can't be staked: it earns nothing and has no voting power/)).toBeVisible();
  const pool = page.getByTestId("your-pool");
  await expect(pool).toContainText("LOGIC · Logical Mechanism");
  await expect(page.getByTestId("your-pool-facts")).toContainText("Saturation18.8%");
  await expect(page.getByTestId("your-pool-facts")).toContainText("Margin2%");
  await expect(page.getByTestId("staking-rewards")).toHaveText("57.475311 ₳");
  // When withdrawing by hand matters, under the setting that decides it, whose switch is here too: the note named it
  // "in Settings" with no way there (blind test §9.9, E04).
  await expect(page.getByRole("switch", { name: "Use staking rewards when spending" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Each payment from your public account also withdraws your rewards.")).toBeVisible();
  await expect(page.getByTestId("staking-rewards-note")).toContainText("Withdraw them only for a site");
  await expect(page.getByTestId("vote-now")).toContainText("Always abstain");
  await expect(page.getByTestId("rewards-locked")).toHaveCount(0);
  await expect(page.getByTestId("drep-deposit-note")).toContainText("Registering locks up 500 ₳");
  expect(koios.calls.slice(reads).sort()).toEqual(["drep_info", "epoch_params", "pool_info"]);
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
  expect(koios.calls.slice(reads).sort()).toEqual(["account_addresses", "account_info", "credential_utxos", "epoch_params", "tip"]);
  await snap(page, "staking-review");
  expect(koios.submitted).toHaveLength(0);
  // An oversaturated pool's warning stays on its review, in numbers (chunk 23's second review, ST-8).
  await expect(page.getByText(/oversaturated, about [\d.]+ times its limit/)).toBeVisible();

  // Signed at review: the button says the act and only submits, and giveme.my is never asked (ST-2).
  await page.getByRole("button", { name: "Stake with TPREP" }).click();
  await expect(page.getByTestId("pending-tx")).toContainText("Delegation sent. Waiting for the network");
  expect(koios.submitted).toHaveLength(1);
  expect(koios.collateralAsked).toBe(0);
  koios.confirmations = 1;
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("pending-tx")).toContainText("Now staking");

  // The pool list is kept on the device: browsing again asks nothing. (Staking itself reads epoch_params again,
  // for what registering a DRep costs, so the browser's own read is the pool list and the supply.)
  reads = koios.calls.length;
  await cardanoTab(panel);
  await panel.getByTestId("staking-row").click();
  await panel.getByRole("button", { name: "Change pool" }).click();
  await expect(panel.getByText("559 live pools")).toBeVisible();
  expect(koios.calls.slice(reads).filter((c) => ["pool_list", "totals"].includes(c))).toEqual([]);
});

/** The 12-word phrase's own DRep: CIP-105's key 3/0 of its account 0 (seedelf-crypto's cardano.rs). */
const OWN_DREP = "drep1y2e20afmrjh8wz02w92880qwdqephacyqlahqyp5n6rgnhg2egjc8";

test("governance: the live actions, then be your own DRep, with the account's own vote", async ({ context, koios }) => {
  // 600 ADA more in the account, for the DRep's 500 ADA deposit.
  const [some] = (Object.values(koiosPreprod.accounts)[0] as { account_utxos: Array<Record<string, any>> }).account_utxos;
  koios.addedToAccounts.push({ ...some!, tx_hash: "d1".repeat(32), tx_index: 0, value: "600000000", asset_list: [] } as never);
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await page.getByTestId("staking-row").click();
  const card = page.getByTestId("drep-card");
  await expect(card).toContainText("Be your own DRep");
  await expect(card).toContainText("Registering locks up 500 ₳, which comes back when you retire it.");

  // The live actions, read-only for an account that isn't a DRep: one proposal_list and its DRep's drep_info.
  let reads = koios.calls.length;
  await card.getByRole("button", { name: "Governance actions" }).click();
  await expect(page.getByRole("heading", { name: "Governance actions" })).toBeVisible();
  await expect(page.getByTestId("gov-action-row")).toHaveCount(7);
  await expect(page.getByTestId("gov-not-drep")).toContainText("Only DReps vote on these.");
  expect(koios.calls.slice(reads).sort()).toEqual(["drep_info", "proposal_list"]);
  await snap(page, "governance-actions");

  // Become a DRep: the account's own vote goes with it, by default, and the review says what that costs and shows.
  await page.getByTestId("gov-not-drep").getByRole("button", { name: "Become a DRep" }).click();
  await expect(page.getByRole("heading", { name: "Become a DRep" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Delegate this account's voting power to it" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("drep-public")).toContainText("A DRep is public");
  await snap(page, "drep-register");
  reads = koios.calls.length;
  await page.getByRole("button", { name: "Review" }).click();
  const review = page.getByTestId("staking-review");
  await expect(review).toContainText("Your voting powerDelegated to your DRep");
  await expect(review).toContainText("DRep deposit500 ₳");
  await expect(review).not.toContainText("Stake key deposit");
  expect(koios.calls.slice(reads).sort()).toEqual(["account_addresses", "account_info", "credential_utxos", "drep_info", "epoch_params", "tip"]);
  await snap(page, "drep-register-review");
  expect(koios.submitted).toHaveLength(0);

  // Signed at review: the button says the act, and only submits.
  await page.getByRole("button", { name: "Register as a DRep" }).click();
  await expect(page.getByTestId("pending-tx")).toContainText("DRep registration sent");
  expect(koios.submitted).toHaveLength(1);
  koios.confirmations = 1;
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("pending-tx")).toContainText("Now a DRep");
});

test("governance: a DRep votes on a live action, and the vote is its own pending kind", async ({ context, koios }) => {
  // Already this account's own DRep, with its own vote behind it.
  koios.dreps.set(OWN_DREP, {
    drep_id: OWN_DREP,
    drep_status: "registered",
    active: true,
    expires_epoch_no: 340,
    amount: "61211118",
    live_delegator_count: 1,
    deposit: "500000000",
    meta_url: null,
    meta_hash: null,
  });
  const info = stakingPreprod.account_info[0];
  koios.stakes.set(info.stake_address, { ...info, delegated_drep: OWN_DREP });
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await page.getByTestId("staking-row").click();
  await expect(page.getByTestId("drep-card")).toContainText("Your DRep");
  await expect(page.getByTestId("vote-now")).toContainText("Your own DRep");
  await expect(page.getByTestId("drep-facts")).toContainText("Active until");
  await expect(page.getByTestId("drep-facts")).toContainText("(epoch 340)");
  await snap(page, "drep-card");

  // A DRep's votes come with the list: one vote_list besides.
  let reads = koios.calls.length;
  await page.getByTestId("drep-card").getByRole("button", { name: "Governance actions" }).click();
  await expect(page.getByTestId("gov-your-vote").first()).toHaveText("Not voted");
  expect(koios.calls.slice(reads).sort()).toEqual(["drep_info", "proposal_list", "vote_list"]);
  // The short ID the row gives the action, which its vote's review names it by too (blind test T14).
  const actionId = (await page.getByTestId("gov-action-when").first().textContent())!.split(" · ")[0]!;
  await page.getByTestId("gov-action-row").first().click();
  await expect(page.getByTestId("gov-vote-public")).toContainText("Every vote is public and stays on chain for good, even one you replace");
  await snap(page, "gov-action");
  reads = koios.calls.length;
  await page.getByTestId("gov-vote-buttons").getByRole("button", { name: "No" }).click();
  const review = page.getByTestId("staking-review");
  await expect(review).toContainText("Your voteNo");
  await expect(review).toContainText("Governance actionInfo action");
  await expect(review.getByTestId("staking-review-action")).toContainText(`Info action · ${actionId}`);
  expect(koios.calls.slice(reads).sort()).toEqual(["account_addresses", "account_info", "credential_utxos", "drep_info", "epoch_params", "tip"]);
  await snap(page, "drep-vote-review");
  await page.getByRole("button", { name: "Cast No vote" }).click();
  // Sent, it stays on the action, which says so, and the list marks it while Koios doesn't list it yet; Home's
  // banner watches it as its own pending kind (chunk 23's second review, GV-6).
  await expect(page.getByTestId("gov-vote-sent")).toContainText("Your No vote is on its way");
  expect(koios.submitted).toHaveLength(1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("gov-your-vote").first()).toHaveText("Your vote: No, on its way");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("pending-tx")).toContainText("Vote sent");
});

test("governance: a DRep whose vote is elsewhere moves it to itself, from Voting power or the DRep card", async ({ context, koios }) => {
  // This account's own DRep, registered, with its voting power on Logical Mechanism's DRep.
  koios.dreps.set(OWN_DREP, {
    drep_id: OWN_DREP,
    drep_status: "registered",
    active: true,
    expires_epoch_no: 340,
    amount: "0",
    live_delegator_count: 0,
    deposit: "500000000",
    meta_url: null,
    meta_hash: null,
  });
  const info = stakingPreprod.account_info[0];
  koios.stakes.set(info.stake_address, { ...info, delegated_drep: "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z" });
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await page.getByTestId("staking-row").click();

  // The DRep card says the vote goes elsewhere, and moves it in one tap.
  const card = page.getByTestId("drep-not-own-vote");
  await expect(card).toContainText("so your own stake isn't behind your DRep's votes");
  await card.getByRole("button", { name: "Delegate your voting power to it" }).click();
  await expect(page.getByTestId("staking-review")).toContainText("Your own DRep");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Or from Voting power: Your own DRep, between the pinned two and A DRep, no search.
  await page.getByRole("button", { name: "Change who votes for you", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Voting power" })).toBeVisible();
  const own = page.getByRole("radio", { name: /^Your own DRep/ });
  await expect(own).toHaveAttribute("aria-checked", "false");
  await own.click();
  await expect(page.getByTestId("own-drep-facts")).toContainText("Active");
  await expect(page.getByTestId("own-drep-id")).toHaveText(OWN_DREP);
  await snap(page, "voting-own-drep");
  await page.getByRole("button", { name: "Review" }).click();
  const review = page.getByTestId("staking-review");
  await expect(review).toContainText("Your own DRep");
  await page.getByRole("button", { name: "Delegate your vote" }).click();
  await expect(page.getByTestId("pending-tx")).toContainText("Vote delegation sent");
  expect(koios.submitted).toHaveLength(1);
});

test("governance: Your own DRep, before the account is one, says what it costs and opens Become a DRep", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await page.getByTestId("staking-row").click();
  await expect(page.getByTestId("drep-card")).toContainText("Be your own DRep");
  await page.getByRole("button", { name: "Change who votes for you", exact: true }).click();
  await page.getByRole("radio", { name: /^Your own DRep/ }).click();
  await expect(page.getByTestId("own-drep-not-yet")).toContainText("Registering locks up 500 ₳");
  // The foot opens Become a DRep, where it was a Review that couldn't be pressed (chunk 23's second review, GV-3).
  await expect(page.getByRole("button", { name: "Review" })).toHaveCount(0);
  await page.getByRole("button", { name: "Become a DRep" }).click();
  await expect(page.getByRole("heading", { name: "Become a DRep" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Delegate this account's voting power to it" })).toHaveAttribute("aria-checked", "true");
  expect(koios.submitted).toHaveLength(0);
});

test("staking: the vote to a DRep by its ID, and the rewards withdrawn", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await cardanoTab(page);
  await page.getByTestId("staking-row").click();

  // DReps are searched by name in the wallet's own list, asking no one.
  await page.getByRole("button", { name: "Change who votes for you", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Voting power" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Always abstain/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  const reads = koios.calls.length;
  await page.getByRole("radio", { name: /^A DRep/ }).click();
  const results = page.getByTestId("drep-results");
  await expect(results.getByRole("listitem")).toHaveCount(20);
  await expect(page.getByTestId("drep-list-note")).toContainText("Searching asks no one.");
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
  // Each row shows the first 16 characters of its ID and the last 6.
  await results.getByRole("button").filter({ hasText: `${LOGIC_DREP.slice(0, 16)}…${LOGIC_DREP.slice(-6)}` }).click();
  const facts = page.getByTestId("drep-facts");
  await expect(facts).toContainText("NameLogical Mechanism dRep");
  await expect(facts).toContainText("StatusInactive since epoch 189");
  await expect(facts).toContainText("Voting power5,914,902.920642 ₳");
  await expect(page.getByTestId("drep-details")).toContainText("hasn't voted lately");
  expect(koios.calls.slice(lookups).sort()).toEqual(["drep_info", "drep_metadata"]);
  await snap(page, "voting");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("staking-review")).toContainText("Voting power toLogical Mechanism dRep");
  // The DRep's inactive warning stays on its review (GV-5), and Back finds the choice as it was (ST-11).
  await expect(page.getByTestId("drep-inactive-review")).toContainText("hasn't voted lately");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("drep-details")).toContainText("Logical Mechanism dRep");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Withdraw: the whole balance, back to the account.
  await page.getByRole("button", { name: "Withdraw rewards" }).click();
  const review = page.getByTestId("staking-review");
  await expect(review).toContainText("Rewards withdrawn57.475311 ₳");
  await expect(review).toContainText("Public account after");
  await expect(page.getByTestId("staking-withdraw-note")).toContainText("Your balance stays the same");
  await page.getByRole("button", { name: /^Withdraw 57\.475311/ }).click();
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
  // Locked, the note that payments take them along would be wrong: the warning says what's true.
  await expect(page.getByTestId("staking-rewards-note")).toHaveCount(0);
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
  await expect(page.getByText("₳ available (includes 57.475311 ₳ of rewards)")).toBeVisible();
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
});

test("hide balances: the eye masks what the wallet holds, but not what a form sends, and stays", async ({ context, koios }) => {
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  const reads = koios.calls.length;
  await page.getByRole("button", { name: "Hide balances" }).click();
  await expect(page.getByTestId("seedelf-lovelace")).toHaveText("•••• ₳");
  // Nothing's locked, so there's no line under the balance (chunk 23's review, H-5: no UTxO count).
  await expect(page.getByTestId("seedelf-meta")).toHaveCount(0);
  await expect(page.getByTestId("seedelf-tokens")).toContainText("••••");
  // The other side's row too, on each tab (blind test §9.4).
  await expect(page.getByTestId("home-public-row-lovelace")).toHaveText("•••• ₳");
  await snap(page, "home-hidden");
  await cardanoTab(page);
  await expect(page.getByTestId("cardano-lovelace")).toHaveText("•••• ₳");
  await expect(page.getByTestId("cardano-rewards")).toHaveText("Includes •••• ₳ of staking rewards");
  await expect(page.getByTestId("home-private-row-lovelace")).toHaveText("•••• ₳");
  // Hiding asks no one anything.
  expect(koios.calls).toHaveLength(reads);

  // Activity and UTxOs hide theirs too.
  await page.getByRole("button", { name: "UTxOs" }).click();
  await expect(page.getByTestId("utxos")).toContainText("•••• ₳");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // A form's lines about the balance hide with it, Max's most included (chunk 23's second review, HM-9: they
  // showed it, on a screen being shared). What's typed, and a review, still show what's sent: it's read first.
  await page.getByRole("button", { name: "Send publicly" }).click();
  await expect(page.getByText("•••• ₳ available (includes •••• ₳ of rewards)")).toBeVisible();
  await page.getByRole("button", { name: "Max" }).click();
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("Max, up to ••••");
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
  // At most 64 characters, and a longer one pasted says it was cut (chunk 23's second review, PY-12).
  await note.fill("x".repeat(80));
  await expect(note).toHaveValue("x".repeat(64));
  await expect(page.getByTestId("send-note-cut")).toHaveText("Cut to 64 characters, the most a note can hold.");
  await note.fill("Invoice 42");
  await expect(page.getByTestId("send-note-cut")).toHaveCount(0);
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
  await addTokens(panel, [TUSDM]);
  await panel.getByLabel(`Amount of ${TUSDM}`).fill("1000");
  await shot("move-in");
  await panel.getByRole("button", { name: "Review" }).click();
  await expect(panel.getByTestId("move-in-review")).toBeVisible();
  await shot("move-in-review");
  await back();
  await back();
  await panel.getByRole("button", { name: "Send publicly" }).click();
  await addTokens(panel, [TUSDM]);
  await panel.getByLabel(`Amount of ${TUSDM}`).fill("1000");
  await shot("send");
  await back();
  await panel.getByTestId("staking-row").click();
  // The status leads; the figures are under Pool details (chunk 23's second review, ST-7).
  await expect(panel.getByTestId("your-pool")).toBeVisible();
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
  await panel.getByRole("button", { name: "Change who votes for you", exact: true }).click();
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
  await panel.getByText("Manage", { exact: true }).click();
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
    await expect(page.getByTestId("startup-error")).toContainText("Reload the extension");
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

test("the connector off keeps Chrome's access to Koios; without it, the wallet says so and asks Chrome again", async ({
  context,
}) => {
  // Koios's public tier sends browsers no CORS headers (since 2026-09-25):
  // the wallet reads it only through Chrome's grant for its host.
  const page = await openApp(context);
  const services = ["https://preprod.koios.rest/*", "https://www.giveme.my/*"];
  const granted = () => page.evaluate(async () => (await chrome.permissions.getAll()).origins ?? []);
  expect(await granted()).toEqual(expect.arrayContaining(services));

  // Off, as at every start: the scripts go, Chrome's access stays. Taking
  // back the optional https://*/* would take Koios's host with it.
  const { reply } = await askWorker(page, { type: "preferences-set", dappConnector: false });
  expect(reply).toMatchObject({ ok: true });
  expect(await granted()).toEqual(expect.arrayContaining(services));
  await expect(page.getByTestId("service-access")).toHaveCount(0);

  // The user limits the wallet's site access in Chrome. Here that's Chrome's
  // own rule: taking back https://*/* takes every https host under it.
  await page.evaluate(() => chrome.permissions.remove({ origins: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"] }));
  expect(await granted()).toEqual([]);
  const notice = page.getByTestId("service-access");
  await expect(notice).toContainText("Chrome is blocking Seedelf Wallet from Koios");
  await snap(page, "service-access");
  // It asks Chrome from the click; Chrome's dialog can't be answered from here.
  await notice.getByRole("button", { name: "Ask Chrome again" }).click();
  await expect(notice.locator(".error")).toHaveCount(0);
});

test.describe("the dApp connector", () => {
  // Chrome's own dialog for the access to sites can't be answered here, so
  // this build has it from install (support.ts `withSiteAccess`).
  test.use({ siteAccess: true });

  /** CIP-30 on the dApp's page: a call's answer, or its error's code and info. */
  const cip30 = (dapp: Page, method: string, ...args: unknown[]) =>
    dapp.evaluate(
      async ([method, args]) => {
        const api = await (window as any).cardano.seedelf.enable();
        try {
          return { value: await api[method as string](...(args as unknown[])) };
        } catch (e) {
          return { error: { code: (e as { code?: number }).code, info: (e as { info?: string }).info } };
        }
      },
      [method, args] as const,
    );

  /** The connector's window, once a site's call opens it. */
  const connectorWindow = async (context: BrowserContext) => {
    const page = await context.waitForEvent("page", (p) => p.url().includes("view=dapp"));
    await page.setViewportSize({ width: 400, height: 640 });
    return page;
  };

  test("off, sites see nothing; on, a site connects, reads, and has things signed only by the user", async ({
    context,
    koios,
  }) => {
    const dapp = await openDapp(context);
    expect(await dapp.evaluate(() => typeof (window as any).cardano?.seedelf)).toBe("undefined");

    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await page.getByRole("button", { name: "Settings" }).click();
    // Sites has a page of its own (chunk 23's review, SET-1).
    await page.getByRole("button", { name: /^Sites/ }).click();
    const toggle = page.getByRole("switch", { name: "Let sites connect to Seedelf Wallet" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("dapp-connector-note")).toContainText("you choose what each sees, and nothing is signed without you");
    // A site's signature needs the password too, until the user says otherwise.
    await expect(page.getByRole("switch", { name: "Ask for your password to sign for a site" })).toHaveAttribute("aria-checked", "true");
    // The page open before it was turned on sees the wallet too, with no reload (blind test §9.2, T15), and the switch
    // says to reload a site that looked for wallets only as it loaded.
    await expect.poll(() => dapp.evaluate(() => typeof (window as any).cardano?.seedelf)).toBe("object");
    await expect(page.getByTestId("dapp-connector-open-pages")).toContainText("Pages already open see Seedelf Wallet too.");

    await dapp.reload();
    expect(await dapp.evaluate(() => (window as any).cardano.seedelf.name)).toBe("Seedelf Wallet");
    expect(await dapp.evaluate(() => (window as any).cardano.seedelf.isEnabled())).toBe(false);

    // Connecting asks the user, in the connector's window.
    const opened = connectorWindow(context);
    const enabling = dapp.evaluate(() => (window as any).cardano.seedelf.enable().then(() => true));
    const connect = await opened;
    await expect(connect.getByRole("heading", { name: "Connect a site" })).toBeVisible();
    await expect(connect.getByTestId("dapp-origin")).toContainText("dapp.example");
    // Nothing is chosen for the user: each says what it costs, and Connect waits for a choice.
    await expect(connect.getByTestId("dapp-connect-costs")).toContainText("and keeps them");
    await expect(connect.getByText("Choose what the site sees")).toBeVisible();
    await expect(connect.getByRole("radio", { name: "Your public account" })).toHaveAttribute("aria-checked", "false");
    await expect(connect.getByRole("radio", { name: "A private session" })).toHaveAttribute("aria-checked", "false");
    await expect(connect.getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
    await connect.getByRole("radio", { name: "Your public account" }).click();
    await expect(connect.getByTestId("dapp-connect-privacy")).toContainText("The site never sees your private balance");
    await snap(connect, "dapp-connect");
    const closed = connect.waitForEvent("close");
    await connect.getByRole("button", { name: "Connect", exact: true }).click();
    expect(await enabling).toBe(true);
    await closed;
    expect(await dapp.evaluate(() => (window as any).cardano.seedelf.isEnabled())).toBe(true);

    // Reads: the public account, in CIP-30's encodings.
    expect(await cip30(dapp, "getNetworkId")).toEqual({ value: 0 });
    const used = (await cip30(dapp, "getUsedAddresses")).value as string[];
    expect(used[0]).toMatch(/^00[0-9a-f]{112}$/); // a preprod base address
    expect(await cip30(dapp, "getChangeAddress")).toEqual({ value: used[0] });
    expect(((await cip30(dapp, "getUtxos")).value as string[]).length).toBe(koiosPreprod.accounts[vector(12).preprod.stake].account_utxos.length);
    expect((await cip30(dapp, "getBalance")).value).toMatch(/^82/); // ADA and tokens
    // The recorded account has no pure 5 ₳ UTxO, so no collateral.
    expect(await cip30(dapp, "getCollateral")).toEqual({ value: null });

    // A transaction to sign: the wallet's own Send builds one to someone else.
    await askWorker(page, { type: "send-build", payments: [{ to: vector(15).preprod.receive_0, lovelace: "3000000", tokens: [] }] });
    const tx = await page.evaluate(async () => {
      const kept = await chrome.storage.session.get("seedelf.send.built");
      return (kept["seedelf.send.built"] as { txCbor: string }).txCbor;
    });

    let prompt = connectorWindow(context);
    let signing = cip30(dapp, "signTx", tx);
    let sign = await prompt;
    await expect(sign.getByRole("heading", { name: "Sign a transaction" })).toBeVisible();
    await expect(sign.getByTestId("dapp-paid").locator("[data-value]")).toHaveAttribute("data-value", vector(15).preprod.receive_0);
    // The account's rewards ride along (57.475311 ₳) and come back to it: it sends the 3 ₳ and the fee, and the stake key signs too.
    await expect(sign.getByTestId("dapp-tx-net")).toContainText("Total leaving your public account");
    await expect(sign.getByTestId("dapp-tx-net")).toContainText("Collected from staking");
    await expect(sign.getByTestId("dapp-tx-net")).toContainText("your staking");
    await expect(sign.getByTestId("dapp-staking")).toContainText("Withdraws your staking rewards, 57.475311 ₳, into your public account.");
    await snap(sign, "dapp-sign-tx");
    // Sign waits for the password, even though the wallet is unlocked; a wrong one is refused and the request stays.
    await expect(sign.getByRole("button", { name: "Sign", exact: true })).toBeDisabled();
    await sign.getByLabel("Your password, to sign").fill("not the password");
    await sign.getByRole("button", { name: "Sign", exact: true }).click();
    await expect(sign.getByRole("alert")).toHaveText("Wrong password.");
    await expect(sign.getByLabel("Your password, to sign")).toHaveValue("");
    await expect(sign.getByRole("heading", { name: "Sign a transaction" })).toBeVisible();
    // The wrong one started the unlock back-off: a second later, the right one signs.
    await sign.waitForTimeout(1_100);
    await sign.getByLabel("Your password, to sign").fill(PASSWORD);
    // With nothing left to answer, the window closes itself.
    let done = sign.waitForEvent("close");
    await sign.getByRole("button", { name: "Sign", exact: true }).click();
    expect((await signing).value).toMatch(/^a100/);
    await done;

    // Declined.
    prompt = connectorWindow(context);
    signing = cip30(dapp, "signTx", tx);
    sign = await prompt;
    done = sign.waitForEvent("close");
    await sign.getByRole("button", { name: "Decline" }).click();
    expect(await signing).toEqual({ error: { code: 2, info: "The user declined." } });
    await done;

    // A message.
    prompt = connectorWindow(context);
    const message = cip30(dapp, "signData", used[0], Buffer.from("Sign in to dapp.example").toString("hex"));
    sign = await prompt;
    await expect(sign.getByRole("heading", { name: "Sign a message" })).toBeVisible();
    await expect(sign.getByTestId("dapp-data-message")).toHaveText("Sign in to dapp.example");
    await snap(sign, "dapp-sign-data");
    done = sign.waitForEvent("close");
    // Enter in the password box signs.
    await sign.getByLabel("Your password, to sign").fill(PASSWORD);
    await sign.getByLabel("Your password, to sign").press("Enter");
    await done;
    const signed = (await message).value as { signature: string; key: string };
    expect(signed.signature).toMatch(/^84/);
    expect(signed.key).toMatch(/^a4/);

    // Sent through Koios.
    const submitted = (await cip30(dapp, "submitTx", tx)).value as string;
    expect(koios.submitted).toEqual([submitted]);

    // Settings lists it, and disconnecting it, once asked, means asking again.
    await page.getByRole("button", { name: "Connected sites" }).click();
    await expect(page.getByTestId("sites")).toContainText("dapp.example");
    await page.getByTestId("sites-disconnect").click();
    await expect(page.getByRole("dialog")).toContainText("dapp.example keeps what it saw, and must ask again to see more.");
    await page.getByTestId("sites-disconnect-confirm").click();
    await expect(page.getByTestId("sites-empty")).toBeVisible();
    // CIP-30 can't tell the open page: the wallet says it may still look connected (blind test E03).
    await expect(page.getByTestId("sites-disconnected")).toContainText("Its open pages may look connected until reloaded");
    expect(await dapp.evaluate(() => (window as any).cardano.seedelf.isEnabled())).toBe(false);

    // Off again: new pages get nothing.
    await page.getByRole("button", { name: "Back" }).click();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await dapp.reload();
    expect(await dapp.evaluate(() => typeof (window as any).cardano?.seedelf)).toBe("undefined");
  });

  test("a declined site: Decline says how long it waits, the window says what it did, and dApps lets it ask now (blind test §9.2)", async ({
    context,
  }) => {
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
    // Home's dApps row says sites can't see the wallet, where users look first (T15).
    await expect(page.getByTestId("home-dapps-sites")).toHaveText("Sites can't see Seedelf Wallet");
    await page.getByRole("button", { name: "dApps", exact: true }).click();
    // Turned on from the dApps page itself.
    await page.getByTestId("dapp-sites-off").getByRole("button", { name: "Let sites connect" }).click();
    await expect(page.getByTestId("dapp-sites-on")).toContainText("On: sites can ask to connect");
    const dapp = await openDapp(context);
    const enable = () =>
      dapp.evaluate(() =>
        (window as any).cardano.seedelf.enable().then(
          () => "connected",
          (e: { info?: string }) => e.info,
        ),
      );

    // Decline says what it does before it's pressed, and the window says what it did (T17, T17r).
    let opened = connectorWindow(context);
    let enabling = enable();
    let connect = await opened;
    await expect(connect.getByTestId("dapp-decline-note")).toHaveText(
      "Decline, or closing this window, turns dapp.example away: it can ask again in 10 s.",
    );
    const closed = connect.waitForEvent("close");
    await connect.getByRole("button", { name: "Decline" }).click();
    expect(await enabling).toBe("The user declined.");
    await expect(connect.getByTestId("dapp-declined")).toContainText("You declined dapp.example. It can ask again in 10 s");

    // The dApps page lists it with the wait left, and that it asked again, which the site alone used to say.
    const declined = page.getByTestId("sites-declined");
    await expect(declined).toContainText("You declined it: it can ask again in");
    expect(await enable()).toMatch(/^The user declined this site just now\. It can ask again in \d+ s\.$/);
    await expect(declined).toContainText("and it asked again");
    await snap(page, "dapp-sites-declined");
    await closed;

    // Let it ask now ends the wait: the next connect opens the window at once.
    await declined.getByRole("button", { name: "Let it ask now" }).click();
    await expect(page.getByTestId("sites-declined")).toHaveCount(0);
    opened = connectorWindow(context);
    enabling = enable();
    connect = await opened;
    const done = connect.waitForEvent("close");
    await connect.getByRole("radio", { name: "Your public account" }).click();
    await connect.getByRole("button", { name: "Connect", exact: true }).click();
    expect(await enabling).toBe("connected");
    await done;

    // Listed under Sites with its page's title and Disconnect, which says what the open page may still show (E03).
    const sites = page.getByTestId("dapp-sites");
    await expect(sites).toContainText("dapp.example");
    await expect(sites).toContainText("Your public account");
    await sites.getByRole("button", { name: "Disconnect" }).click();
    await page.getByTestId("sites-disconnect-confirm").click();
    await expect(page.getByTestId("sites-disconnected")).toContainText("dapp.example is disconnected");
    await expect(page.getByTestId("dapp-sites-hint")).toBeVisible();
    expect(await dapp.evaluate(() => (window as any).cardano.seedelf.isEnabled())).toBe(false);
  });

  test("a site connects to a private session instead: funded from the window, and listed under dApps' Sites", async ({
    context,
    koios,
  }) => {
    // One spend: the funding takes the 25 ₳ UTxO alone.
    koios.evaluation = { ...withdrawPreprod.amount.evaluation, result: withdrawPreprod.amount.evaluation.result.slice(0, 1) };
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
    await page.getByRole("button", { name: "Settings" }).click();
    // Sites has a page of its own (chunk 23's review, SET-1).
    await page.getByRole("button", { name: /^Sites/ }).click();
    const toggle = page.getByRole("switch", { name: "Let sites connect to Seedelf Wallet" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const dapp = await openDapp(context);

    // The connect window offers a private session: an amount from the private balance, and 5 ₳ of collateral.
    const opened = connectorWindow(context);
    const enabling = dapp.evaluate(() =>
      (window as any).cardano.seedelf.enable().then(
        () => "connected",
        (e: { info?: string }) => e.info,
      ),
    );
    const connect = await opened;
    await connect.getByRole("radio", { name: "A private session" }).click();
    // The amount comes into view and focus, and until there is one the button says so (chunk 23's second review, CW-2).
    await expect(connect.getByLabel("What to put in it")).toBeFocused();
    await expect(connect.getByRole("button", { name: "Enter an amount" })).toBeDisabled();
    await expect(connect.getByTestId("dapp-private-held")).toContainText("28 ₳ in your private balance");
    // The way back, in plain words, with what Lovejoin costs as Settings has it on (blind test §9.8, T16).
    await expect(connect.getByTestId("dapp-private-way-back")).toContainText(
      "Spare ADA is mixed through Lovejoin so it's harder to tie to this session: about 4.1 ₳ a 10 ₳ box",
    );
    await connect.getByLabel("What to put in it").fill("15");
    await snap(connect, "dapp-connect-private");
    await connect.getByRole("button", { name: "Review" }).click();
    const rows = connect.getByTestId("dapp-funding-rows");
    await expect(rows).toContainText("ToPrivate session 1");
    await expect(rows).toContainText("For the site15 ₳");
    await expect(rows).toContainText("Kept aside for contracts5 ₳, comes back");
    // What leaves the 28 ₳, 15 + 5 + the fee, and what it holds after, not the change of the UTxO it spends (T16); then
    // the way back's fee, about 0.25 ₳, and Lovejoin's, about 4.1 ₳ a box (blind test §9.8).
    await expect(rows).toContainText(/Total leaving your private balance20\.\d+\s₳/);
    await expect(rows).toContainText(/Private balance after7\.\d+\s₳/);
    const back = connect.getByTestId("dapp-funding-back");
    // Lovejoin's on, as Settings starts it: the way back is its deposit, the mixes and the return, two fees besides
    // the mixes'.
    await expect(back).toContainText("Its network fees, about0.5 ₳: Lovejoin's deposit and the return");
    await expect(back).toContainText("Through Lovejoin first, about4.1 ₳ a 10 ₳ box");
    await expect(back).toContainText(/Network fees both ways, about0\.7\d\s₳/);
    // Sending needs the password, as a signature does.
    await expect(connect.getByRole("button", { name: "Send" })).toBeDisabled();
    await connect.getByLabel("Your password, to send").fill(PASSWORD);
    await snap(connect, "dapp-funding-review");
    await connect.getByRole("button", { name: "Send" }).click();
    // giveme.my refuses (its recorded answer): nothing is sent, and the request still waits for the user. Send gives
    // way to building it again, as a swap's does, giveme.my's words under Details (chunk 23's second review, DX-1).
    await expect(connect.getByTestId("review-stale")).toContainText("refused this transaction");
    await expect(connect.getByRole("button", { name: "Send" })).toHaveCount(0);
    expect(koios.submitted).toHaveLength(0);
    // Its Decline says no to the site, and how long that turns it away, as the choice's does (the cross-area review).
    await expect(connect.getByTestId("dapp-decline-note")).toContainText("turns dapp.example away: it can ask again in 10 s");
    await connect.getByRole("button", { name: "Decline" }).click();
    expect(await enabling).toBe("The user declined.");
    // The window says so, then closes by itself a few seconds on: nothing here waits for that.
    await expect(connect.getByTestId("dapp-declined")).toContainText("You declined dapp.example.");
    // Asked again at once, it's refused unasked, in words that say when it can ask again (chunk 23's second review,
    // CW-3).
    expect(
      await dapp.evaluate(() => (window as any).cardano.seedelf.enable().then(() => "connected", (e: { info?: string }) => e.info)),
    ).toMatch(/^The user declined this site just now\. It can ask again in \d+ s\.$/);

    // The session it recorded never got its money: dApps lists it under Sites, and Disconnect closes it.
    // From Settings → Sites, back to Settings, then Home.
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "dApps", exact: true }).click();
    const sites = page.getByTestId("dapp-sites");
    await expect(sites).toContainText("dapp.example");
    await expect(sites).toContainText("Not funded");
    await snap(page, "dapp-sites");
    await sites.getByRole("button").click();
    await expect(page.getByTestId("site-session-failed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeEnabled();
    await snap(page, "site-session");
    await page.getByTestId("site-disconnect").click();
    await page.getByTestId("site-disconnect-confirm").click();
    await expect(page.getByTestId("dapp-sites")).toHaveCount(0);
    await expect(page.getByTestId("dapp-sites-hint")).toBeVisible();
  });

  /**
   * A site's private session whose funding the connector's window tried to
   * send (giveme.my refused it), said to hold 40 ₳ and its 5 ₳ collateral
   * anyway, open on its page with Bring it back pressed.
   */
  async function siteSessionHolding40(context: BrowserContext, koios: KoiosFake): Promise<Page> {
    // The funding is measured as recorded; the network agrees with the chain's first mix.
    const spend = { ...withdrawPreprod.amount.evaluation, result: withdrawPreprod.amount.evaluation.result.slice(0, 1) };
    koios.evaluation = (body: { params: { additionalUtxo?: unknown[] } }) =>
      body.params.additionalUtxo ? { jsonrpc: "2.0", method: "evaluateTransaction", result: [] } : spend;
    koios.addedToAccounts.push(...lovejoinPool);
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
    await page.getByRole("button", { name: "Settings" }).click();
    // Sites has a page of its own (chunk 23's review, SET-1).
    await page.getByRole("button", { name: /^Sites/ }).click();
    await page.getByRole("switch", { name: "Let sites connect to Seedelf Wallet" }).click();
    const dapp = await openDapp(context);
    const opened = connectorWindow(context);
    const enabling = dapp.evaluate(() => (window as any).cardano.seedelf.enable().then(() => "connected", (e: { info?: string }) => e.info));
    const connect = await opened;
    await connect.getByRole("radio", { name: "A private session" }).click();
    await connect.getByLabel("What to put in it").fill("15");
    await connect.getByRole("button", { name: "Review" }).click();
    await connect.getByLabel("Your password, to send").fill(PASSWORD);
    await connect.getByRole("button", { name: "Send" }).click();
    await expect(connect.getByTestId("review-stale")).toContainText("refused this transaction");
    // The window closes by itself a few seconds after the decline: nothing here waits for that.
    await connect.getByRole("button", { name: "Decline" }).click();
    expect(await enabling).toBe("The user declined.");

    // Say its account holds 40 ₳ and its 5 ₳ collateral anyway: its spare ADA pays for two boxes.
    const held = (tx: string, index: number, value: string) => ({
      ...sessionSwap.utxo,
      tx_hash: tx.repeat(32),
      tx_index: index,
      value,
      payment_cred: sessionSwap.keyHash,
      stake_address: null,
      epoch_no: 315,
      block_height: 5_000_000,
      block_time: 1_800_000_000,
      datum_hash: null,
      inline_datum: null,
      reference_script: null,
      asset_list: [],
      is_spent: false,
    });
    koios.addedToAccounts.push(held("c1", 0, "40000000"), held("c2", 1, "5000000"));
    // The chain has its funding after all; nothing the wallet sends from here has landed yet.
    koios.confirmations = (tx) => (koios.submitted.includes(tx) ? null : 1);
    // From Settings → Sites, back to Settings, then Home.
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "dApps", exact: true }).click();
    // Funded, but its site never connected to it (the connect was cancelled): dApps' Sites and its page say so,
    // and the page's note offers Bring it back.
    const sites = page.getByTestId("dapp-sites");
    await expect(sites).toContainText("Not connected");
    await sites.getByRole("button").click();
    const detached = page.getByTestId("site-session-detached");
    await expect(detached).toContainText("dapp.example isn't connected to this session");
    // Its tag says the same.
    await expect(page.getByRole("region", { name: "dapp.example" }).getByText("Not connected", { exact: true })).toBeVisible();
    await detached.getByRole("button", { name: "Bring it back" }).click();

    return page;
  }

  test("a site's private session comes back through Lovejoin, or directly: the review says which, and a switch rebuilds it", async ({
    context,
    koios,
  }) => {
    const page = await siteSessionHolding40(context, koios);

    // Through Lovejoin: two boxes, fanned out, back later; the rest now.
    const review = page.getByTestId("site-back-review");
    await expect(review).toContainText("Through Lovejoin2 boxes of 10 ₳");
    await expect(review).toContainText("Mixed2 waves deep, 8 mixes");
    // And what each box costs to bring back later, paid from it, which the chain's fees leave out (pass two of the
    // blind test's fix round).
    await expect(review).toContainText("Bringing them back, about0.6 ₳");
    await expect(review).toContainText("IntoNew private UTxOs");
    // The way back is a switch, first on the review and on as Settings has it, never a link under the costs (blind
    // test §9.8; Stop's, 5289dcf).
    const way = page.getByRole("switch", { name: "Bring it back through Lovejoin" });
    await expect(way).toHaveAttribute("aria-checked", "true");
    await snap(page, "site-back-lovejoin");
    // Directly instead: one transaction, everything now. The switch stays, off, to turn it back on.
    await way.click();
    await expect(review).not.toContainText("Through Lovejoin");
    await expect(review).toContainText("Into your private balance");
    await expect(way).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("lovejoin-way")).toContainText("anyone can tie it on chain to this session and its funding");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => koios.submitted.length).toBe(1);

    // While its return is on its way, Disconnect waits: nothing reads a session once it's disconnected. (The fake
    // Koios still lists what the return spent, so the page's reading waits out the wallet's stale-read tries first.)
    await expect(page.getByTestId("site-session-wait")).toContainText("Its return is on its way. Disconnect waits until it lands.", {
      timeout: 20_000,
    });
    const disconnect = page.getByTestId("site-disconnect");
    await expect(disconnect).toBeDisabled();
    await expect(disconnect).toHaveAttribute("title", "Its return is on its way: wait for it to land");
    await snap(page, "site-session-returning");
  });

  test("a site session's return through Lovejoin counts its chain as it's sent, four at a time", async ({ context, koios }) => {
    const page = await siteSessionHolding40(context, koios);
    await expect(page.getByTestId("site-back-review")).toContainText("Through Lovejoin2 boxes of 10 ₳");
    // Each Koios answer waits a while, so the count shows as they go in.
    koios.delayMs = 1500;
    const send = page.getByRole("button", { name: /^(Send|Sending)/ });
    await send.click();
    await expect(send).toHaveText(/^Sending \d of 10…$/);
    // Paced: Send sends the first four of the ten; the rest go as blocks take them.
    await expect.poll(() => koios.submitted.length, { timeout: 30_000 }).toBe(4);
    koios.delayMs = 0;
    // Back on the session's page, it says so. (The fake Koios still lists what the chain spent, so the
    // page's reading waits out the wallet's stale-read tries first.)
    const rows = page.getByTestId("site-session-rows");
    await expect(rows).toContainText("Through LovejoinSending 4 of 10 transactions", { timeout: 20_000 });
    expect(koios.submitted).toHaveLength(4);
  });

  test("a Pays row shows the whole address and its ADA, however long a token's name", async ({ context }) => {
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await page.getByRole("button", { name: "Settings" }).click();
    // Sites has a page of its own (chunk 23's review, SET-1).
    await page.getByRole("button", { name: /^Sites/ }).click();
    const toggle = page.getByRole("switch", { name: "Let sites connect to Seedelf Wallet" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const dapp = await openDapp(context);
    let opened = connectorWindow(context);
    const enabling = dapp.evaluate(() => (window as any).cardano.seedelf.enable().then(() => true));
    const connect = await opened;
    const closed = connect.waitForEvent("close");
    await connect.getByRole("radio", { name: "Your public account" }).click();
    await connect.getByRole("button", { name: "Connect", exact: true }).click();
    expect(await enabling).toBe(true);
    await closed;

    // A site's transaction, by hand: one of the account's UTxOs, and 1,234.567891 ₳ with a token named
    // with 32 W's to the account's payment key under another stake part.
    const [utxo] = (await cip30(dapp, "getUtxos")).value as string[];
    const index = Number.parseInt(utxo!.slice(72, 74), 16) < 24 ? utxo!.slice(72, 74) : utxo!.slice(72, 76);
    const input = `825820${utxo!.slice(8, 72)}${index}`;
    const change = (await cip30(dapp, "getChangeAddress")).value as string;
    const to = `${change.slice(0, 58)}${"ab".repeat(28)}`;
    const output = `825839${to}821a499602d3a1581c${"cd".repeat(28)}a15820${"57".repeat(32)}01`;
    const tx = `84a30081${input}0181${output}021a00029810a0f5f6`;

    opened = connectorWindow(context);
    const signing = cip30(dapp, "signTx", tx, false);
    const sign = await opened;
    await expect(sign.getByRole("heading", { name: "Sign a transaction" })).toBeVisible();
    const address = sign.getByTestId("dapp-paid").locator("[data-value]");
    const shown = await address.evaluate((el) => ({
      text: el.textContent,
      value: el.getAttribute("data-value"),
      clipped: el.scrollWidth > el.clientWidth,
    }));
    expect(shown.text).toBe(shown.value);
    expect(shown.clipped).toBe(false);
    const amount = sign.getByTestId("dapp-paid").locator(".dapp-amount");
    await expect(amount).toContainText("1,234.567891 ₳");
    expect(await amount.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    expect(await sign.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(sign.getByTestId("dapp-own-key")).toContainText("your payment key with a stake part that isn't yours");
    await snap(sign, "dapp-sign-tx-long-token");
    await sign.getByRole("button", { name: "Decline" }).click();
    expect((await signing).error?.code).toBe(2);
  });

  test("the transaction view opens a site's own transaction while it waits for a signature", async ({ context }) => {
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await page.getByRole("button", { name: "Settings" }).click();
    // Sites has a page of its own (chunk 23's review, SET-1).
    await page.getByRole("button", { name: /^Sites/ }).click();
    const toggle = page.getByRole("switch", { name: "Let sites connect to Seedelf Wallet" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const dapp = await openDapp(context);
    let opened = connectorWindow(context);
    const enabling = dapp.evaluate(() => (window as any).cardano.seedelf.enable().then(() => true));
    const connect = await opened;
    const closed = connect.waitForEvent("close");
    await connect.getByRole("radio", { name: "Your public account" }).click();
    await connect.getByRole("button", { name: "Connect", exact: true }).click();
    expect(await enabling).toBe(true);
    await closed;

    // Bytes the wallet didn't build: its own Send's, handed back by the site.
    await askWorker(page, { type: "send-build", payments: [{ to: vector(15).preprod.receive_0, lovelace: "3000000", tokens: [] }] });
    const tx = await page.evaluate(async () => {
      const kept = await chrome.storage.session.get("seedelf.send.built");
      return (kept["seedelf.send.built"] as { txCbor: string }).txCbor;
    });

    opened = connectorWindow(context);
    const signing = cip30(dapp, "signTx", tx, false);
    const sign = await opened;
    await expect(sign.getByRole("heading", { name: "Sign a transaction" })).toBeVisible();
    await sign.getByTestId("dapp-tx-open").click();
    const view = sign.getByTestId("dapp-tx");
    await expect(view).toContainText("Spends");
    await expect(view).toContainText("Pays");
    await expect(view.locator(`[data-value="${vector(15).preprod.receive_0}"]`)).toBeVisible();
    await view.getByRole("tab", { name: "Raw CBOR" }).click();
    await expect(view.getByTestId("dapp-tx-cbor")).toHaveAttribute("data-value", tx);
    await snap(sign, "dapp-tx-detail");

    // Closed, the request is still waiting, and declining it still answers the site.
    await sign.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
    await expect(sign.getByRole("heading", { name: "Sign a transaction" })).toBeVisible();
    await sign.getByRole("button", { name: "Decline" }).click();
    expect((await signing).error?.code).toBe(2);
  });

  test("a request that takes another's place in the window says so, and its buttons wait a moment", async ({ context }) => {
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await page.getByRole("button", { name: "Settings" }).click();
    // Sites has a page of its own (chunk 23's review, SET-1).
    await page.getByRole("button", { name: /^Sites/ }).click();
    const toggle = page.getByRole("switch", { name: "Let sites connect to Seedelf Wallet" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    // Without the password, Sign alone answers: what a click on the wrong request would do.
    const password = page.getByRole("switch", { name: "Ask for your password to sign for a site" });
    await password.click();
    await expect(password).toHaveAttribute("aria-checked", "false");
    const first = await openDapp(context);
    let opened = connectorWindow(context);
    const enabling = first.evaluate(() => (window as any).cardano.seedelf.enable().then(() => true));
    const connect = await opened;
    const closed = connect.waitForEvent("close");
    await connect.getByRole("radio", { name: "Your public account" }).click();
    await connect.getByRole("button", { name: "Connect", exact: true }).click();
    expect(await enabling).toBe(true);
    await closed;

    // Two of the site's pages ask; the window shows the first page's.
    const second = await context.newPage();
    await second.goto("https://dapp.example/");
    const used = ((await cip30(first, "getUsedAddresses")).value as string[])[0]!;
    const hex = (text: string) => Buffer.from(text).toString("hex");
    opened = connectorWindow(context);
    // Its page closes before it's answered.
    const gone = cip30(first, "signData", used, hex("Harmless")).catch(() => undefined);
    const window = await opened;
    await expect(window.getByTestId("dapp-data-message")).toHaveText("Harmless");
    const replacing = cip30(second, "signData", used, hex("The other one"));
    await expect(window.getByText("1 of 2")).toBeVisible();
    await expect(window.getByTestId("dapp-changed")).toHaveCount(0);

    // The first page goes away: the second's takes its place, says so, and Sign waits a moment.
    await first.close();
    await gone;
    await expect(window.getByTestId("dapp-data-message")).toHaveText("The other one");
    await expect(window.getByTestId("dapp-changed")).toContainText("The request you were reading is gone");
    const sign = window.getByRole("button", { name: "Sign", exact: true });
    await expect(sign).toBeDisabled();
    await expect(sign).toBeEnabled({ timeout: 3_000 });
    await sign.click();
    expect(((await replacing).value as { signature: string }).signature).toMatch(/^84/);
  });

  test("governance (CIP-95): a site asks for it, the window says what it gives, and the site gets the DRep key", async ({ context }) => {
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await page.getByRole("button", { name: "Settings" }).click();
    // Sites has a page of its own (chunk 23's review, SET-1).
    await page.getByRole("button", { name: /^Sites/ }).click();
    await page.getByRole("switch", { name: "Let sites connect to Seedelf Wallet" }).click();
    const dapp = await openDapp(context);
    expect(await dapp.evaluate(() => (window as any).cardano.seedelf.supportedExtensions)).toEqual([{ cip: 95 }]);

    // Asked for at connect: the public account's choice says what governance gives; a private session gets none.
    const opened = connectorWindow(context);
    const enabling = dapp.evaluate(async () => {
      const api = await (window as any).cardano.seedelf.enable({ extensions: [{ cip: 95 }] });
      return {
        extensions: await api.getExtensions(),
        drepKey: await api.cip95.getPubDRepKey(),
        registered: await api.cip95.getRegisteredPubStakeKeys(),
      };
    });
    const connect = await opened;
    await connect.getByRole("radio", { name: "A private session" }).click();
    await expect(connect.getByTestId("dapp-private-no-governance")).toContainText("a private session has no DRep");
    await connect.getByRole("radio", { name: "Your public account" }).click();
    await expect(connect.getByTestId("dapp-governance-privacy")).toContainText("The site learns your DRep's public key");
    // Off by default, as the most private choice is: the user switches it on.
    const governance = connect.getByRole("switch", { name: "Give it governance too (CIP-95)" });
    await expect(governance).toHaveAttribute("aria-checked", "false");
    await governance.click();
    await snap(connect, "dapp-connect-governance");
    await connect.getByRole("button", { name: "Connect", exact: true }).click();
    const given = await enabling;
    expect(given.extensions).toEqual([{ cip: 95 }]);
    expect(given.drepKey).toMatch(/^[0-9a-f]{64}$/);
    expect(given.registered).toHaveLength(1);

    // Enabled again without asking for it: CIP-30 gives the API without the cip95 namespace, though the grant stays.
    const plain = await dapp.evaluate(async () => {
      const api = await (window as any).cardano.seedelf.enable();
      return { cip95: typeof api.cip95, extensions: await api.getExtensions() };
    });
    expect(plain).toEqual({ cip95: "undefined", extensions: [{ cip: 95 }] });
  });

  test("a locked wallet asks for the password in the connector's window first", async ({ context }) => {
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await page.getByRole("button", { name: "Settings" }).click();
    // Sites has a page of its own (chunk 23's review, SET-1).
    await page.getByRole("button", { name: /^Sites/ }).click();
    const toggle = page.getByRole("switch", { name: "Let sites connect to Seedelf Wallet" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const dapp = await openDapp(context);
    let opened = connectorWindow(context);
    const enabling = dapp.evaluate(() => (window as any).cardano.seedelf.enable().then(() => true));
    const connect = await opened;
    const closed = connect.waitForEvent("close");
    await connect.getByRole("radio", { name: "Your public account" }).click();
    await connect.getByRole("button", { name: "Connect", exact: true }).click();
    expect(await enabling).toBe(true);
    await closed;
    // The API the site keeps, as dApps do.
    await dapp.evaluate(async () => {
      (window as any).kept = await (window as any).cardano.seedelf.enable();
    });
    await page.getByRole("button", { name: "Lock" }).click();

    // Locked, nothing the site hears says so: isEnabled holds, and a read is refused as a stranger's, with no window.
    expect(await dapp.evaluate(() => (window as any).cardano.seedelf.isEnabled())).toBe(true);
    const pages = context.pages().length;
    expect(
      await dapp.evaluate(() =>
        (window as any).kept.getNetworkId().catch((e: { code: number; info: string }) => ({ code: e.code, info: e.info })),
      ),
    ).toEqual({
      code: -3,
      info: "This site isn't connected to Seedelf Wallet. Call enable() first.",
    });
    expect(context.pages()).toHaveLength(pages);

    // enable() unlocks in the connector's window, which names the site.
    opened = connectorWindow(context);
    const reading = cip30(dapp, "getNetworkId");
    const unlock = await opened;
    await expect(unlock.getByTestId("unlock-site")).toHaveText("https://dapp.example is asking for Seedelf Wallet. Unlock to see what it asks.");
    // A way to say no, and no way from a site's window to the recovery phrase (chunk 23's second review, CW-4).
    await expect(unlock.getByRole("button", { name: "Decline" })).toBeVisible();
    await expect(unlock.getByRole("button", { name: /Forgot password/ })).toHaveCount(0);
    const unlocked = unlock.waitForEvent("close");
    await unlock.getByLabel("Password").fill(PASSWORD);
    await unlock.getByRole("button", { name: "Unlock" }).click();
    expect(await reading).toEqual({ value: 0 });
    await unlocked;

    // A signature asked for while locked: unlocking comes first, and Sign still asks, once the message is shown.
    const used = ((await cip30(dapp, "getUsedAddresses")).value as string[])[0]!;
    await page.getByRole("button", { name: "Lock" }).click();
    opened = connectorWindow(context);
    const message = cip30(dapp, "signData", used, Buffer.from("Sign in to dapp.example").toString("hex"));
    const window = await opened;
    await window.getByLabel("Password").fill(PASSWORD);
    await window.getByRole("button", { name: "Unlock" }).click();
    await expect(window.getByRole("heading", { name: "Sign a message" })).toBeVisible();
    await expect(window.getByRole("button", { name: "Sign", exact: true })).toBeDisabled();
    await window.getByLabel("Your password, to sign").fill(PASSWORD);
    const signed = window.waitForEvent("close");
    await window.getByRole("button", { name: "Sign", exact: true }).click();
    expect(((await message).value as { signature: string }).signature).toMatch(/^84/);
    // Gone before the lock: a window still open would show the next unlock itself, and no new one would open.
    await signed;

    // Decline, locked, says no to the site, as closing the window does (CW-4). Asked through the API the site
    // kept: cip30() would enable() first, and that's what the window would decline.
    await page.getByRole("button", { name: "Lock" }).click();
    opened = connectorWindow(context);
    const declined = dapp.evaluate(
      ([address, payload]) =>
        (window as any).kept.signData(address, payload).then(
          () => undefined,
          (e: { code: number; info: string }) => ({ code: e.code, info: e.info }),
        ),
      [used, Buffer.from("Sign in again").toString("hex")] as const,
    );
    const locked = await opened;
    const gone = locked.waitForEvent("close");
    await locked.getByRole("button", { name: "Decline" }).click();
    await gone;
    expect(await declined).toEqual({ code: -3, info: "The user declined." });
  });
});

// The store's build has mainnet and preprod (docs/architecture.md, Networks):
// Settings moves between them, saying first what the other network is, and
// preprod is marked on every screen. A preprod-only dev build has no switch.
test("a mainnet build switches networks in Settings, and marks preprod on every screen", async ({ context }) => {
  const { host_permissions: hosts } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8")) as { host_permissions: string[] };
  test.skip(!hosts.includes("https://api.koios.rest/*"), "a preprod-only build has no network switch");
  const page = await openApp(context);
  await restore(page, vector(12).phrase);
  // The harness chose preprod before the wallet started.
  await expect(page.getByTestId("network")).toHaveText("PREPROD");
  await expect(page.getByTestId("test-network")).toHaveText("Test network: ADA here has no value.");

  await page.getByRole("button", { name: "Settings" }).click();
  const choice = page.getByRole("group", { name: "Cardano network" });
  await choice.getByRole("button", { name: "Mainnet" }).click();
  await expect(page.getByTestId("network-confirm")).toContainText("Mainnet ADA is real money");
  // Asking isn't moving: Preprod stays pressed until the switch is confirmed (chunk 23's second review, SE-2).
  await expect(choice.getByRole("button", { name: "Preprod" })).toHaveAttribute("aria-pressed", "true");
  await expect(choice.getByRole("button", { name: "Mainnet" })).toHaveAttribute("aria-pressed", "false");
  await snap(page, "network-switch");
  // Staying changes nothing.
  await page.getByRole("button", { name: "Stay on Preprod" }).click();
  await expect(page.getByTestId("network")).toHaveText("PREPROD");

  await choice.getByRole("button", { name: "Mainnet" }).click();
  await page.getByRole("button", { name: "Switch to Mainnet" }).click();
  await expect(page.getByTestId("network")).toHaveText("MAINNET");
  await expect(page.getByTestId("test-network")).toHaveCount(0);
  expect((await askWorker(page, { type: "status" })).reply.value).toMatchObject({ network: "mainnet", networks: ["mainnet", "preprod"] });
  expect((await askWorker(page, { type: "account" })).reply.value.receiveAddress).toMatch(/^addr1/);
  // Send asks for mainnet's addresses.
  await page.getByRole("button", { name: "Settings" }).click();
  await cardanoTab(page);
  await page.getByRole("button", { name: "Send publicly" }).click();
  await expect(page.getByLabel("To", { exact: true })).toHaveAttribute("placeholder", "addr1…, $handle or a Seedelf name");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Settings" }).click();

  // Back to preprod: it says first that its ADA has no value.
  await page.getByRole("group", { name: "Cardano network" }).getByRole("button", { name: "Preprod" }).click();
  await expect(page.getByTestId("network-confirm")).toContainText("Preprod ADA has no value, and real ADA sent to a preprod address is lost");
  await page.getByRole("button", { name: "Switch to Preprod" }).click();
  await expect(page.getByTestId("network")).toHaveText("PREPROD");
  await expect(page.getByTestId("test-network")).toBeVisible();
  expect((await askWorker(page, { type: "account" })).reply.value.receiveAddress).toBe(vector(12).preprod.receive_0);
});

test.describe("a mainnet build's welcome", () => {
  // A fresh install of the store's build starts on mainnet.
  test.use({ network: "mainnet" });

  test("asks which network before a wallet is restored, so a preprod phrase goes straight to preprod", async ({ context }) => {
    const { host_permissions: hosts } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8")) as { host_permissions: string[] };
    test.skip(!hosts.includes("https://api.koios.rest/*"), "a preprod-only build has one network");
    const page = await openApp(context);
    await expect(page.getByTestId("network")).toHaveText("MAINNET");
    const picker = page.getByLabel("Cardano network");
    await expect(picker).toHaveValue("mainnet");

    // Preprod, before any phrase: nothing to confirm, since there's no wallet yet.
    await picker.selectOption("preprod");
    await expect(page.getByTestId("network")).toHaveText("PREPROD");
    await expect(page.getByTestId("test-network")).toBeVisible();
    await expect(page.getByLabel("Cardano network")).toHaveValue("preprod");

    // Restore says where it's restoring, and Change network goes back to the choice.
    await page.getByRole("button", { name: "Restore wallet" }).click();
    await expect(page.getByTestId("onboarding-on-network")).toContainText("Restoring a wallet on Preprod.");
    await page.getByRole("button", { name: "Change network" }).click();
    await expect(page.getByLabel("Cardano network")).toHaveValue("preprod");

    await restore(page, vector(12).phrase);
    await expect(page.getByTestId("network")).toHaveText("PREPROD");
    expect((await askWorker(page, { type: "status" })).reply.value).toMatchObject({ state: "unlocked", network: "preprod" });
    expect((await askWorker(page, { type: "account" })).reply.value.receiveAddress).toBe(vector(12).preprod.receive_0);
  });
});
