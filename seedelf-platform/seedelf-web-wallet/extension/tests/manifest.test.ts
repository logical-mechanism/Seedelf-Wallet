import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildManifest, DEV_KEY } from "../src/manifest";

describe("manifest", () => {
  it("defaults to a preprod-only build", () => {
    const m = buildManifest({ version: "0.1.0", mainnetEnabled: false, storeBuild: false });
    expect(m.manifest_version).toBe(3);
    expect(m.name).toBe("Seedelf Wallet (preprod)");
    expect(m.background).toEqual({ service_worker: "sw.js", type: "module" });
    // No popup: a click opens a tab, or the side panel the user chose.
    expect(m.action).not.toHaveProperty("default_popup");
    expect(m.side_panel).toEqual({ default_path: "index.html?view=panel" });
    expect(m.minimum_chrome_version).toBe("116");
    expect(m.host_permissions).toEqual(["https://preprod.koios.rest/*", "https://www.giveme.my/*"]);
    expect(m.content_security_policy.extension_pages).toContain("script-src 'self' 'wasm-unsafe-eval'");
    // Minswap's aggregator answers with CORS headers: the page may reach it, with no host permission.
    expect(m.content_security_policy.extension_pages).toContain(
      "connect-src 'self' https://preprod.koios.rest https://www.giveme.my https://aggr.monorepo-testnet-preprod.minswap.org",
    );
    expect(m.content_security_policy.extension_pages).not.toContain("api.koios.rest");
    expect(m.content_security_policy.extension_pages).not.toContain("coingecko");
    expect(m.content_security_policy.extension_pages).toContain("font-src 'self'");
    expect(m.permissions).toEqual(["storage", "alarms", "sidePanel", "scripting"]);
    // Sites only when the user turns the dApp connector on: optional, asked for then.
    expect(m.optional_host_permissions).toEqual(["https://*/*", "http://localhost/*", "http://127.0.0.1/*"]);
    expect(m).not.toHaveProperty("content_scripts");
    expect(m.icons).toEqual({
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    });
    expect(m.action.default_icon).toBe(m.icons);
  });

  it("adds mainnet hosts only behind the flag", () => {
    const m = buildManifest({ version: "0.1.0", mainnetEnabled: true, storeBuild: false });
    expect(m.name).toBe("Seedelf Wallet");
    // CoinGecko for ADA's price: mainnet only.
    expect(m.host_permissions).toEqual([
      "https://api.koios.rest/*",
      "https://www.giveme.my/*",
      "https://api.coingecko.com/*",
      "https://preprod.koios.rest/*",
    ]);
    expect(m.content_security_policy.extension_pages).toContain("https://api.coingecko.com");
    expect(m.content_security_policy.extension_pages).toContain("https://agg-api.minswap.org");
    expect(m.host_permissions.join(" ")).not.toContain("minswap");
  });

  it("pins the dev extension ID unless building for the Web Store", () => {
    expect(buildManifest({ version: "0.1.0", mainnetEnabled: false, storeBuild: false }).key).toBe(DEV_KEY);
    expect(buildManifest({ version: "0.1.0", mainnetEnabled: false, storeBuild: true })).not.toHaveProperty("key");
  });

  it("a store build: no key, the preprod hosts only, and the strict page CSP", () => {
    const m = buildManifest({ version: "0.1.0", mainnetEnabled: false, storeBuild: true });
    expect(m).not.toHaveProperty("key");
    expect(m.name).toBe("Seedelf Wallet (preprod)");
    expect(m.permissions).toEqual(["storage", "alarms", "sidePanel", "scripting"]);
    expect(m.host_permissions).toEqual(["https://preprod.koios.rest/*", "https://www.giveme.my/*"]);
    expect(m.content_security_policy.extension_pages).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "object-src 'none'",
        "connect-src 'self' https://preprod.koios.rest https://www.giveme.my https://aggr.monorepo-testnet-preprod.minswap.org",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
      ].join("; "),
    );
    // The description is the store's summary line.
    expect(m.description.length).toBeLessThanOrEqual(132);
  });

  it("dev key maps to the documented extension ID", async () => {
    const { createHash } = await import("node:crypto");
    const hex = createHash("sha256").update(Buffer.from(DEV_KEY, "base64")).digest("hex").slice(0, 32);
    const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
    expect(id).toBe("jfekiogplaamnceifeehipmomhojngcb");
  });

  it("ships every icon the manifest names", () => {
    const m = buildManifest({ version: "0.1.0", mainnetEnabled: false, storeBuild: false });
    for (const path of Object.values(m.icons)) {
      expect(existsSync(new URL(`../public/${path}`, import.meta.url)), path).toBe(true);
    }
  });
});
