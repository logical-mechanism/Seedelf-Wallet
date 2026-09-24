// Every v1 flow, driven through the built extension's UI on Home, each
// ending when the network confirms it (see lib.mjs). Each takes the
// wallet from openWallet() and the flow's arguments, and returns the
// transaction hash.
import { balances, confirmed, log, reviewAndSend, seedelfName, sendReviewed, yourSeedelfs } from "./lib.mjs";

const home = (page) => page.getByRole("tab", { name: "Seedelf" }).click();

/** The Cardano tab's staking row, into Staking. */
async function staking(page) {
  await page.getByRole("tab", { name: "Cardano", exact: true }).click();
  await page.getByTestId("staking-row").click();
  await page.getByRole("heading", { name: "Voting power" }).waitFor();
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const FLOWS = {
  /** `mint [tag] [account|seedelf]`: create a seedelf, paid by the Cardano account (mint first) or the Seedelf balance (a stealth mint). */
  async mint({ page }, tag = "live-mint", from = "account") {
    if (from !== "account" && from !== "seedelf") throw new Error("mint: pay with account or seedelf");
    await home(page);
    await page.getByRole("button", { name: "Create a seedelf" }).click();
    await page.getByLabel("Personal tag (optional)").fill(tag);
    await page.getByRole("button", { name: from === "account" ? "Cardano account" : "Seedelf balance" }).click();
    await reviewAndSend(page, "mint-review", `mint-${from}`);
    const txHash = await confirmed(page, "Seedelf created");
    await yourSeedelfs(page, (list) => list.getByText(tag, { exact: true }).waitFor({ timeout: 60_000 }));
    return txHash;
  },

  /** `move-in [ada]`: ADA and every token the Cardano account holds, into the Seedelf balance. */
  async "move-in"({ page }, ada = "10") {
    await page.getByRole("tab", { name: "Cardano", exact: true }).click();
    await page.getByRole("button", { name: "Move in" }).click();
    await page.getByLabel("Amount", { exact: true }).fill(ada);
    const add = page.getByRole("button", { name: "Add tokens" });
    if (await add.count()) {
      await add.click();
      const picker = page.getByRole("dialog", { name: "Add tokens" });
      await picker.getByRole("button", { name: /^Select all/ }).click();
      await picker.getByRole("button", { name: /^Add \d+ tokens?$/ }).click();
    }
    for (const all of await page.getByRole("button", { name: /^All of / }).all()) await all.click();
    await reviewAndSend(page, "move-in-review", "move-in");
    return confirmed(page, "Move-in confirmed");
  },

  /** `transfer [ada] [to]`: pay a seedelf, by its full name or the tag of one of the wallet's own (flagged, allowed). */
  async transfer({ page }, ada = "3.3", to = "live-mint") {
    await home(page);
    const name = /^5eed0e1f[0-9a-f]{56}$/i.test(to) ? to : await seedelfName(page, to);
    await page.getByRole("button", { name: "Send to a seedelf" }).click();
    await page.getByLabel("Seedelf name").fill(name);
    const note = page.getByTestId("transfer-to-note");
    await note.filter({ hasText: "Found:" }).waitFor({ timeout: 60_000 }).catch(async () => {
      throw new Error(`transfer: not found: ${await note.innerText()}`);
    });
    log("recipient:", await note.innerText());
    await page.getByLabel("Amount", { exact: true }).fill(ada);
    await reviewAndSend(page, "transfer-review", "transfer");
    return confirmed(page, "Transfer confirmed");
  },

  /** `withdraw [ada|max] [address|$handle]`: by default to the wallet's own receive address (flagged, allowed). */
  async withdraw({ page }, amount = "5.5", to) {
    if (!to) {
      await page.getByRole("tab", { name: "Cardano", exact: true }).click();
      await page.getByRole("button", { name: "Receive" }).click();
      to = await page.getByTestId("receive-address").getAttribute("data-value");
      await page.getByRole("button", { name: "Back", exact: true }).click();
    }
    await home(page);
    await page.getByRole("button", { name: "Withdraw" }).click();
    await page.getByLabel("To", { exact: true }).fill(to);
    const note = page.getByTestId("withdraw-to-note");
    await note.filter({ hasText: /^(Sends to|\$\S+ is) / }).waitFor({ timeout: 60_000 }).catch(async () => {
      throw new Error(`withdraw: can't pay ${to}: ${await note.innerText()}`);
    });
    log("destination:", await note.innerText());
    if (amount === "max") await page.getByRole("button", { name: "Max" }).click();
    else await page.getByLabel("Amount", { exact: true }).fill(amount);
    await reviewAndSend(page, "withdraw-review", "withdraw");
    return confirmed(page, "Withdrawal confirmed");
  },

  /** `stake [ticker|pool1…]`: stake the Cardano account with a pool, found in the pool browser; a first delegation pays the 2 ₳ deposit. */
  async stake({ page }, pool = "LOGIC") {
    await staking(page);
    await page.getByRole("button", { name: /^(Change pool|Choose a pool)$/ }).click();
    await page.getByLabel("Search pools").fill(pool);
    const results = page.getByTestId("pool-results");
    const row = pool.startsWith("pool1")
      ? results.getByRole("button").first()
      : results.getByRole("button", { name: new RegExp(`^${escaped(pool)},`, "i") });
    await row.click();
    await page.getByTestId("pool-details-facts").waitFor({ timeout: 60_000 });
    log("pool:", (await page.getByTestId("pool-details").innerText()).replace(/\n/g, " | "));
    await page.getByRole("button", { name: /^Stake with / }).click();
    await sendReviewed(page, "stake");
    return confirmed(page, "Now staking");
  },

  /** `vote [abstain|no-confidence|drep1…]`: delegate the voting power; a DRep is looked up first. */
  async vote({ page }, to = "abstain") {
    await staking(page);
    await page.getByRole("button", { name: /^(Change|Delegate)$/ }).click();
    if (to === "abstain") await page.getByRole("radio", { name: /^Always abstain/ }).click();
    else if (to === "no-confidence") await page.getByRole("radio", { name: /^Always no confidence/ }).click();
    else {
      await page.getByRole("radio", { name: /^A DRep/ }).click();
      await page.getByLabel("DRep ID").fill(to);
      await page.getByRole("button", { name: "Look up" }).click();
      await page.getByTestId("drep-facts").waitFor({ timeout: 60_000 });
      log("DRep:", (await page.getByTestId("drep-facts").innerText()).replace(/\n/g, " | "));
    }
    await page.getByRole("button", { name: "Review" }).click();
    await sendReviewed(page, `vote-${to.startsWith("drep1") ? "drep" : to}`);
    return confirmed(page, "Voting power delegated");
  },

  /** `withdraw-rewards`: the whole reward balance, back to the Cardano account. Needs rewards, and the vote delegated. */
  async "withdraw-rewards"({ page }) {
    await staking(page);
    await page.getByRole("button", { name: "Withdraw rewards" }).click();
    await sendReviewed(page, "withdraw-rewards");
    return confirmed(page, "Rewards withdrawn");
  },

  /** `unstake`: withdraw the rewards, unregister the stake key, and get the 2 ₳ deposit back. */
  async unstake({ page }) {
    await staking(page);
    await page.getByRole("button", { name: "Stop staking" }).click();
    await sendReviewed(page, "unstake");
    return confirmed(page, "Staking stopped");
  },

  /** `remove [tag] [account|seedelf]`: burn a seedelf of the wallet's; its ADA goes to the Cardano account or the Seedelf balance. */
  async remove({ page }, tag = "live-mint", to = "account") {
    if (to !== "account" && to !== "seedelf") throw new Error("remove: send the freed ADA to account or seedelf");
    await home(page);
    await page.getByRole("button", { name: "Receive into Seedelf" }).click();
    await page.getByRole("button", { name: `Remove ${tag}`, exact: true }).click();
    await page.getByRole("button", { name: to === "account" ? "Cardano account" : "Seedelf balance" }).click();
    await reviewAndSend(page, "remove-review", `remove-${to}`);
    return confirmed(page, "Seedelf removed");
  },
};

/** Runs one flow and logs the balances before and after. */
export async function run(wallet, name, args) {
  const flow = FLOWS[name];
  if (!flow) throw new Error(`no flow "${name}": ${Object.keys(FLOWS).join(", ")}`);
  log(`── ${[name, ...args].join(" ")}`);
  // The last flow's banner, so this flow's is the only one.
  const dismiss = wallet.page.getByTestId("pending-tx").getByRole("button", { name: "Dismiss" });
  if (await dismiss.count()) await dismiss.click();
  log("before:", await balances(wallet.page));
  const txHash = await flow(wallet, ...args);
  await wallet.page.screenshot({ path: `test-results/live-${name}-after.png`, fullPage: true });
  log("after:", await balances(wallet.page));
  return txHash;
}
