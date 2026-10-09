// Mainnet through Seedelf Wallet's own data layer (chunk 26b), on a build made
// with VITE_DATA_ORIGIN (`npm run e2e:data`). Preprod reads Koios alone,
// whatever the build, and a store build has no data layer until the VPS
// chunk gives it one: extension.spec.ts covers both as before.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_ORIGIN, fakeDataLayer } from "./data-layer";
import { dist, expect, koiosPreprod, openApp, ownedUtxos, restore, test, vector } from "./support";

const csp = () =>
  (JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8")) as { content_security_policy: { extension_pages: string } })
    .content_security_policy.extension_pages;

test.describe("the data layer", () => {
  test.use({ network: "mainnet" });
  test.beforeEach(() => {
    test.skip(!csp().includes(DATA_ORIGIN), `built without VITE_DATA_ORIGIN=${DATA_ORIGIN}`);
  });

  test("reads the private balance from the private index, and the public side from Koios while that part is down", async ({ context, koios }) => {
    const data = await fakeDataLayer(context, [...koiosPreprod.contract_utxos, ...ownedUtxos]);
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await expect(page.getByTestId("network")).toHaveText("MAINNET");
    await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
    // A restore: a snapshot, what changed since, and every name.
    const asked = data.calls.map((p) => p.replace(/^\/seedelf\/v1\/mainnet\//, ""));
    expect(asked).toContain("contract/snapshot");
    expect(asked).toContain("names");
    expect(asked.some((p) => p.startsWith("contract/since/"))).toBe(true);
    // The public part's first request answered 503: it and every public read after it went to Koios, the part held
    // down for 5 minutes, without asking the data layer again. The contract never went to Koios.
    expect(data.calls.filter((p) => p.startsWith("/api/v1/"))).toHaveLength(1);
    expect(koios.calls).toContain("account_info");
    expect(koios.calls.filter((c) => c === "credential_utxos")).toHaveLength(1);
  });

  test("reads Koios's scan of the contract while the private index is down", async ({ context, koios }) => {
    const data = await fakeDataLayer(context, [...koiosPreprod.contract_utxos, ...ownedUtxos]);
    data.index.fail = new Response(JSON.stringify({ error: "behind" }), { status: 503, headers: { "retry-after": "30" } });
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
    // The account and the contract, both from Koios.
    expect(koios.calls.filter((c) => c === "credential_utxos")).toHaveLength(2);
  });

  test("a Koios-only switch in Settings, on mainnet alone, read at the next request", async ({ context, koios }) => {
    const data = await fakeDataLayer(context, [...koiosPreprod.contract_utxos, ...ownedUtxos]);
    const page = await openApp(context);
    await restore(page, vector(12).phrase);
    await expect(page.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
    await page.getByRole("button", { name: "Settings" }).click();
    const only = page.getByRole("switch", { name: "Read Cardano through Koios only" });
    await expect(only).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#koios-only-note")).toContainText("Seedelf Wallet's own server answers first");
    await only.click();
    await expect(only).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#koios-only-note")).toContainText("Everything goes through Koios");

    // Refreshed, nothing goes to the data layer: the contract is Koios's scan again.
    const before = data.calls.length;
    const scans = koios.calls.filter((c) => c === "credential_utxos").length;
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => koios.calls.filter((c) => c === "credential_utxos").length).toBeGreaterThan(scans + 1);
    expect(data.calls).toHaveLength(before);

    // Preprod has no data layer, so no switch.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("group", { name: "Cardano network" }).getByRole("button", { name: "Preprod" }).click();
    await page.getByRole("button", { name: "Switch to Preprod" }).click();
    await expect(page.getByTestId("network")).toHaveText("PREPROD");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("switch", { name: "Read Cardano through Koios only" })).toHaveCount(0);
  });
});
