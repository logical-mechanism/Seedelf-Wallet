// Seedelf Messaging's screens end to end (chunk 54f): the top bar's button
// and Home's row, the switch (off by default, and off sends nothing), and two
// wallets writing to each other through one relay in memory (relay.ts): a
// stranger's request, accepted by a reply, in a tab wide enough for the list
// and a conversation side by side, and in a narrow side panel's list-then-
// conversation. A first message's stamp is the protocol's 24 bits, solved by
// the worker, about 7 s and sometimes much more: the two-wallet test allows
// for it. Once answered, the wallet that wrote first shows the other its
// Seedelf (protocol.md §19), which the other checks on the chain at its
// press (the 1.10.0 gate's W2) and names. A Seedelf this browser didn't mint
// takes first messages only once it's turned on (W8): each wallet here holds
// one from the recorded contract, so each turns its own on first.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { relayFake, routeRelay } from "./relay";
import { askWorker, chooseNetwork, expect, fakeKoios, launch, openApp, ownedUtxos, restore, test, transferPreprod, vector } from "./support";

/** vector(12)'s Seedelf, tagged "web-wallet", in the recorded contract. */
const SEEDELF = ownedUtxos
  .flatMap((u: { asset_list?: Array<{ asset_name: string }> }) => u.asset_list ?? [])
  .map((a: { asset_name: string }) => a.asset_name)
  .find((name: string) => name.startsWith("5eed0e1f"))!;

const ENVELOPES = "/messaging/v1/preprod/envelopes";

/** vector(24)'s Seedelf, tagged "b-wallet": put in the contract for the reveal (`koios.addedToContract`). */
const B_SEEDELF = "5eed0e1f" + Buffer.from("b-wallet").toString("hex") + "00" + "cd".repeat(19);

/**
 * A Seedelf of `phrase`'s in the contract, as a mint would leave it: A's recorded UTxO, with this name, and a datum of
 * a fresh re-randomization of the phrase's register, made by the built module.
 */
function seedelfOf(phrase: string, name: string) {
  const pkg = new URL("../../wasm/pkg/", import.meta.url);
  const script = `
    import { readFileSync } from "node:fs";
    const wasm = await import(${JSON.stringify(new URL("seedelf_wasm.js", pkg).href)});
    wasm.initSync({ module: readFileSync(new URL(${JSON.stringify(new URL("seedelf_wasm_bg.wasm", pkg).href)})) });
    const key = wasm.SeedelfKey.fromEntropy(wasm.phraseToEntropy(process.argv[1]), 0);
    process.stdout.write(Buffer.from(wasm.registerToDatum(wasm.rerandomize(key.baseRegister()))).toString("hex"));
  `;
  const datum = execFileSync(process.execPath, ["--input-type=module", "-e", script, phrase], {
    env: { ...process.env, NODE_OPTIONS: "" },
    encoding: "utf8",
  });
  const recorded = ownedUtxos.find((u: { asset_list?: Array<{ asset_name: string }> }) =>
    u.asset_list?.some((a) => a.asset_name === SEEDELF),
  );
  return {
    ...recorded,
    tx_hash: "b2".repeat(32),
    tx_index: 0,
    inline_datum: { bytes: datum, value: {} },
    asset_list: recorded.asset_list.map((a: { asset_name: string }) =>
      a.asset_name === SEEDELF ? { ...a, asset_name: name, fingerprint: "asset1syntheticbseedelf" } : a,
    ),
  };
}

/**
 * Home shows its splash until its first reading of the balances, each time it opens (as from Settings): on a slow
 * runner that's past the default 5 s, so a row of Home's is waited for this long.
 */
const HOME_READ = { timeout: 30_000 };

test("54f: Messages opens from the top bar and from Home, off by default, and off asks the relay nothing", async ({ context }) => {
  // A first message's stamp is solved while off too: about 7 s of the worker's, sometimes much more.
  test.setTimeout(120_000);
  const fake = relayFake();
  await routeRelay(context, fake, "A");
  const page = await openApp(context);
  await restore(page, vector(12).phrase);

  // Home's row says it's off; the top bar's round button is left of Settings.
  await expect(page.getByTestId("home-messages-state")).toHaveText("Off", HOME_READ);
  const buttons = page.locator("header.topbar button");
  const labels = await buttons.evaluateAll((all) => all.map((b) => b.getAttribute("aria-label")));
  expect(labels.indexOf("Messages")).toBe(labels.indexOf("Settings") - 1);

  // The bar's four buttons fit a side panel at Chrome's 360 px: nothing past its edge, no sideways scroll (the 1.10.0
  // gate's screens#5). The wordmark goes there; the mark stays, the way to Home.
  const panel = await openApp(context, "panel");
  await expect(panel.getByTestId("topbar-messages")).toBeVisible(HOME_READ);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  const edge = await panel.locator("header.topbar button").last().evaluate((b) => b.getBoundingClientRect().right);
  expect(edge).toBeLessThanOrEqual(360);
  await expect(panel.locator("header.topbar .wordmark")).toBeHidden();
  await panel.close();

  await page.getByTestId("home-messages").click();
  await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
  const toggle = page.getByTestId("messages-switch");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("messages-none")).toContainText("Turn Messages on");
  // Just the switch, with no line under it (the owner, 2026-11-22).
  await expect(page.getByRole("switch", { name: "Turn on Messages" })).toBeVisible();

  // Never to one's own Seedelf.
  await page.getByTestId("messages-new").click();
  await expect(page.getByTestId("messages-new")).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Seedelf name").fill(SEEDELF);
  await expect(page.getByText("That's your own Seedelf.")).toBeVisible();
  await expect(page.getByTestId("composer")).toBeVisible();
  // Written while off: kept, and waiting, never "sent". The worker, asked to read now, asks the relay nothing.
  await page.getByLabel("Seedelf name").fill(transferPreprod.to);
  await expect(page.getByText("Found:")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("composer-off")).toBeVisible();
  await page.getByTestId("composer").fill("waits for the switch");
  await page.getByTestId("composer").press("Enter");
  await expect(page.getByTestId("thread").getByTestId("bubble")).toHaveText(/waits for the switch/);
  await expect(page.getByTestId("bubble-state")).toHaveText(/preparing|waiting for Messages to be on/);
  // Off, nothing is being sent: the list says it waits, never "Sending…".
  await expect(page.getByTestId("messages-conversations")).toContainText("Waiting to send");
  await askWorker(page, { type: "messaging-sync" });
  expect(fake.calls).toEqual([]);

  // The top bar's button goes back to Home, and opens the same page again.
  await page.getByTestId("topbar-messages").click();
  await expect(page.getByTestId("home-messages")).toBeVisible(HOME_READ);
  await page.getByTestId("topbar-messages").click();
  await expect(page.getByTestId("messages-switch")).toBeVisible();

  // On: the worker reads the pool at once. Its stamp for the waiting message may still be solving, about 7 s of the
  // worker's and more on a busy runner, which the read shares the worker with.
  await page.getByTestId("messages-switch").click();
  await expect(page.getByTestId("messages-switch")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => fake.calls.includes(`A GET ${ENVELOPES}`), { timeout: 60_000 }).toBe(true);

  // A relay that doesn't answer is said; once it answers again, it isn't.
  fake.relay.up = false;
  await askWorker(page, { type: "messaging-sync" });
  await expect(page.getByTestId("messages-offline")).toBeVisible();
  fake.relay.up = true;
  await askWorker(page, { type: "messaging-sync" });
  await expect(page.getByTestId("messages-offline")).toBeHidden();

  // Off again: nothing more.
  await page.getByTestId("messages-switch").click();
  await expect(page.getByTestId("messages-switch")).toHaveAttribute("aria-checked", "false");
  const asked = fake.calls.length;
  await askWorker(page, { type: "messaging-sync" });
  expect(fake.calls).toHaveLength(asked);
  expect(fake.strays).toEqual([]);
});

test("54f: two wallets write to each other: a stranger's request, accepted by a reply, read in a tab and in a panel", async ({
  context,
  koios,
}) => {
  // A first message's stamp is 24 bits of the worker's work, a matter of luck: about 7 s on the owner's desktop, and
  // several times that on a slow runner beside the rest. Its wait is long enough that only a stuck stamp fails it, and
  // nothing is slower when the stamp is quick (the 1.10.0 gate's tests-ci#9).
  test.setTimeout(600_000);
  const fake = relayFake();
  await routeRelay(context, fake, "A");
  // B holds a Seedelf too, to show A once A has replied.
  koios.addedToContract.push(seedelfOf(vector(24).phrase, B_SEEDELF));

  // A holds vector(12)'s Seedelf, in a tab wide enough for the list and a conversation side by side.
  const a = await openApp(context);
  await a.setViewportSize({ width: 1100, height: 760 });
  await restore(a, vector(12).phrase);
  // Home's row comes with its first reading, the contract's among it: the reading Messages lists the Seedelfs from.
  await expect(a.getByTestId("home-messages-state")).toHaveText("Off", HOME_READ);
  await a.getByTestId("home-messages").click();
  await a.getByTestId("messages-switch").click();
  await expect(a.getByTestId("messages-pick")).toBeVisible();
  // A's Seedelf is the recorded contract's, not one this browser minted: off for first messages until A turns it on
  // (W8), with the line that says to turn on only one you made.
  const aSeedelf = a.getByTestId("messages-seedelf-switch");
  await expect(aSeedelf).toHaveCount(1, { timeout: 30_000 });
  await expect(aSeedelf).toHaveAttribute("aria-checked", "false");
  await expect(a.getByTestId("messages-seedelfs")).toContainText("Turn on only a Seedelf you made");
  await aSeedelf.click();
  await expect(aSeedelf).toHaveAttribute("aria-checked", "true");

  // B, another browser on the same chain and relay, writes first to A's Seedelf from a narrow side panel.
  const dir = mkdtempSync(join(tmpdir(), "seedelf-e2e-b-"));
  const other = await launch(dir);
  try {
    await chooseNetwork(other, "preprod");
    await fakeKoios(other, koios);
    await routeRelay(other, fake, "B");
    const restoring = await openApp(other);
    await restore(restoring, vector(24).phrase);
    const b = await openApp(other, "panel");
    await b.setViewportSize({ width: 400, height: 640 });
    await expect(b.getByTestId("home-messages-state")).toHaveText("Off", HOME_READ);
    await b.getByTestId("topbar-messages").click();
    await b.getByTestId("messages-switch").click();
    await expect(b.getByTestId("messages-switch")).toHaveAttribute("aria-checked", "true");
    // B's b-wallet came into the contract by another way than a mint here, so B turns it on too: only then can B's
    // thread show it to A (W8).
    const bSeedelf = b.getByTestId("messages-seedelf-switch");
    await expect(bSeedelf).toHaveCount(1, { timeout: 30_000 });
    await bSeedelf.click();
    await expect(bSeedelf).toHaveAttribute("aria-checked", "true");
    await b.getByTestId("messages-new").click();
    // Narrow: the new message takes the list's place.
    await expect(b.getByTestId("messages-switch")).toBeHidden();
    await b.getByLabel("Seedelf name").fill(SEEDELF);
    await expect(b.getByText("Found:")).toBeVisible({ timeout: 15_000 });
    await b.getByTestId("composer").fill("hello from B");
    await b.getByTestId("composer").press("Enter");

    // Its conversation, named by the Seedelf's tag: preparing (the stamp), then "sent, expires …", never "delivered".
    await expect(b.getByTestId("thread-name")).toHaveText("web-wallet");
    // B wrote to that Seedelf, so its header copies it and saves it to the contacts (the owner, 2026-11-22).
    await other.grantPermissions(["clipboard-read", "clipboard-write"]);
    await b.getByTestId("thread-copy").click();
    expect(await b.evaluate(() => navigator.clipboard.readText())).toBe(SEEDELF);
    await expect(b.getByTestId("thread-save")).toBeVisible();
    await expect(b.getByTestId("bubble")).toHaveText(/hello from B/);
    await expect(b.getByTestId("bubble-state")).toContainText("sent, expires", { timeout: 480_000 });

    // A: a stranger's request, counted on the top bar, until a reply accepts it.
    await expect(a.getByTestId("messages-requests")).toContainText("Unknown sender", { timeout: 30_000 });
    await expect(a.getByTestId("messages-requests")).toContainText("Wrote to your Seedelf web-wallet");
    await expect(a.getByTestId("topbar-messages-unread")).toHaveText("1");
    await a.getByTestId("messages-requests").getByRole("button").click();
    await expect(a.getByTestId("request").getByTestId("bubble")).toHaveText(/hello from B/);
    await expect(a.getByTestId("request")).toContainText("Until you reply, nothing tells them you've read it.");
    await expect(a.getByTestId("topbar-messages-unread")).toBeHidden();
    await a.getByTestId("composer").fill("hi B");
    await a.getByTestId("composer").press("Enter");
    await expect(a.getByTestId("thread")).toBeVisible();
    await expect(a.getByTestId("thread-name")).toHaveText("Unknown sender");
    await expect(a.getByTestId("thread-detail")).toContainText("Wrote to your Seedelf web-wallet");
    // A doesn't know B's Seedelf: nothing to copy or save.
    await expect(a.getByTestId("thread-copy")).toHaveCount(0);
    await expect(a.getByTestId("thread-save")).toHaveCount(0);
    await expect(a.getByTestId("thread").getByTestId("bubble")).toHaveCount(2);
    await expect(a.getByTestId("messages-requests")).toBeHidden();
    await expect(a.getByTestId("messages-conversations")).toContainText("You: hi B");

    // A names it: the name stands over the label, which is still said under it.
    await a.getByTestId("thread-rename").click();
    await a.getByTestId("messages-name").fill("B from the forum");
    await a.getByTestId("messages-name-save").click();
    await expect(a.getByTestId("thread-name")).toHaveText("B from the forum");
    await expect(a.getByTestId("thread-detail").first()).toHaveText("Unknown sender");
    await expect(a.getByTestId("messages-conversations")).toContainText("B from the forum");

    // B reads the reply in its conversation while it's open.
    await expect(b.getByTestId("thread").getByTestId("bubble").last()).toHaveText(/hi B/, { timeout: 30_000 });

    // Answered, B shows A its Seedelf (§19): A's wallet checks the proof as it takes it, the chain only at A's press
    // (W2), and only then names it, as the wallet's own notice, never a bubble of B's (screens#1).
    await b.getByTestId("thread-reveal").click();
    await expect(b.getByTestId("messages-reveal-pick")).toContainText("b-wallet");
    await expect(b.getByText("Only they can check it, so it proves nothing to anyone else.")).toBeVisible();
    await b.getByTestId("messages-reveal-show").click();
    await expect(b.getByTestId("bubble-reveal")).toHaveText(/You showed your Seedelf b-wallet/);
    await expect(a.getByTestId("bubble-reveal")).toHaveText("Showed you a Seedelf, not checked on the chain yet", { timeout: 30_000 });
    await expect(a.getByTestId("reveal-notice")).not.toHaveClass(/\bbubble\b/);
    await a.getByTestId("reveal-check").click();
    await expect(a.getByTestId("bubble-reveal")).toHaveText(/^Showed you their Seedelf tagged “b-wallet” \(5eed0e1f…[0-9a-f]{16}\), verified on the chain$/, {
      timeout: 30_000,
    });
    await expect(a.getByTestId("reveal-check")).toHaveCount(0);
    // A's own name for it stands; under it, §7's label is now the Seedelf, verified.
    await expect(a.getByTestId("thread-name")).toHaveText("B from the forum");
    await expect(a.getByTestId("thread-detail").first()).toHaveText("b-wallet");
    await expect(a.getByTestId("thread-detail").nth(1)).toContainText("Verified Seedelf");
    await expect(a.getByTestId("messages-conversations")).toContainText("Showed you a Seedelf");
    // Verified, the header copies B's Seedelf and saves it to A's contacts; the chat itself has no links (the owner,
    // 2026-11-22). Saved by A's own name for it, the bubble names it so, and the header asks no more.
    await expect(a.getByTestId("bubble-reveal").getByRole("button")).toHaveCount(0);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await a.getByTestId("thread-copy").click();
    expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(B_SEEDELF);
    await a.getByTestId("thread-save").click();
    await a.getByLabel("Name", { exact: true }).fill("Bea");
    await a.getByRole("button", { name: "Save", exact: true }).click();
    await expect(a.getByTestId("bubble-reveal")).toHaveText(/^Showed you their Seedelf, your contact Bea \(5eed0e1f…[0-9a-f]{16}\), verified on the chain$/);
    // Under A's name for it, the label says now that it's A's contact's.
    await expect(a.getByTestId("thread-detail").nth(1)).toContainText("your contact");
    await expect(a.getByTestId("thread-save")).toBeHidden();
    await expect(a.getByTestId("thread-copy")).toBeVisible();
    // B never sees a button to reveal on A's side of things, nor A on its own.
    await expect(a.getByTestId("thread-reveal")).toBeHidden();

    // A on Home: a message that comes is counted there, read within seconds by the page on screen, not the alarm's
    // minute (the owner, 2026-11-21).
    await a.getByTestId("topbar-messages").click();
    await expect(a.getByTestId("home-messages-state")).toHaveText("On", HOME_READ);
    await b.getByTestId("composer").fill("are you there?");
    await b.getByTestId("composer").press("Enter");
    await expect(a.getByTestId("topbar-messages-unread")).toHaveText("1", { timeout: 30_000 });
    await expect(a.getByTestId("home-messages-state")).toHaveText("1 unread");

    // B's list, behind Back, says the last message.
    await b.getByRole("button", { name: "Back" }).first().click();
    await expect(b.getByTestId("messages-conversations")).toContainText("You: are you there?");
  } finally {
    await other.close();
    rmSync(dir, { recursive: true, force: true });
  }

  // Envelopes the relay dropped before A read them: said, never as "expired".
  await a.getByTestId("topbar-messages").click();
  fake.relay.gapOnce = true;
  await askWorker(a, { type: "messaging-sync" });
  await expect(a.getByTestId("messages-gap")).toContainText("may be missing");

  // Only the worker asked the relay, both wallets.
  expect(fake.strays).toEqual([]);
  expect(fake.calls.some((c) => c.startsWith("B POST"))).toBe(true);
  expect(fake.calls.some((c) => c.startsWith("A POST"))).toBe(true);
});
