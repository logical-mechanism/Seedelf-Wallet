import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildManifest, DEV_KEY } from "../src/manifest";

describe("manifest", () => {
  it("defaults to a preprod-only build", () => {
    const m = buildManifest({ version: "0.1.0", mainnetEnabled: false, storeBuild: false });
    expect(m.manifest_version).toBe(3);
    expect(m.name).toBe("Seedelf Wallet (preprod)");
    expect(m.background).toEqual({ service_worker: "sw.js", type: "module" });
    expect(m.action.default_popup).toBe("index.html");
    expect(m.host_permissions).toEqual(["https://preprod.koios.rest/*", "https://www.giveme.my/*"]);
    expect(m.content_security_policy.extension_pages).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(m.content_security_policy.extension_pages).toContain(
      "connect-src 'self' https://preprod.koios.rest https://www.giveme.my",
    );
    expect(m.content_security_policy.extension_pages).not.toContain("api.koios.rest");
    expect(m.permissions).toEqual(["storage", "alarms"]);
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
    expect(m.host_permissions).toEqual([
      "https://api.koios.rest/*",
      "https://www.giveme.my/*",
      "https://preprod.koios.rest/*",
    ]);
  });

  it("pins the dev extension ID unless building for the Web Store", () => {
    expect(buildManifest({ version: "0.1.0", mainnetEnabled: false, storeBuild: false }).key).toBe(DEV_KEY);
    expect(buildManifest({ version: "0.1.0", mainnetEnabled: false, storeBuild: true })).not.toHaveProperty("key");
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
