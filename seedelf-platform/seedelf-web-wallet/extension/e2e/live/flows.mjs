// Every v1 flow, driven through the built extension's UI on Home, each
// ending when the network confirms it (see lib.mjs). Each takes the
// wallet from openWallet() and the flow's arguments, and returns the
// transaction hash.
import { balances, confirmed, log, reviewAndSend, seedelfName } from "./lib.mjs";

const home = (page) => page.getByRole("tab", { name: "Seedelf" }).click();

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
    await page.getByTestId("seedelfs").getByText(tag, { exact: true }).waitFor({ timeout: 60_000 });
    return txHash;
  },

  /** `move-in [ada]`: ADA and every token the Cardano account holds, into the Seedelf balance. */
  async "move-in"({ page }, ada = "10") {
    await page.getByRole("tab", { name: "Cardano account" }).click();
    await page.getByRole("button", { name: "Move in" }).click();
    await page.getByLabel("Amount").fill(ada);
    for (const box of await page.getByRole("checkbox").all()) await box.check();
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
      await page.getByRole("tab", { name: "Cardano account" }).click();
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

  /** `remove [tag] [account|seedelf]`: burn a seedelf of the wallet's; its ADA goes to the Cardano account or the Seedelf balance. */
  async remove({ page }, tag = "live-mint", to = "account") {
    if (to !== "account" && to !== "seedelf") throw new Error("remove: send the freed ADA to account or seedelf");
    await home(page);
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
