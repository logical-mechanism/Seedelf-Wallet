// Builds manifest.json at build time (see vite.config.ts).

import { enabledNetworks, networkOrigins } from "./networks.ts";

/**
 * Public half of a throwaway RSA key. It pins the extension ID of unpacked
 * builds to `jfekiogplaamnceifeehipmomhojngcb`, so the test wallet in
 * chrome.storage survives moving the folder. No private key exists or is
 * needed. Web Store builds must omit it (VITE_STORE_BUILD=true).
 */
export const DEV_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqswlP9QH0iugVcCP5EqIZK/i6IRI29WwHe6R5ng2hQ8w1lSZvqAJ0aTNY8/CrCr79ROgPMfMubq2ErJQAJ0OlD2frXpbl7gj1KFV16z+HRpZkapcVtTCD2r+rEocPt+ryx0w+5Y+m+uWNXUgCNL6sdHXC8qidMpkXJ4Y2onvV7BJRAoptpiv8dgdsFb8pIgdjiNBdR/Uaow/QKHWOE5clcgiP0QOMRfmeGIv/8ChDnTneLiRw6I6rIOtAXbvi/Ay2SO00Yoje7N7KCHUhqQscekyHpBvjOANNAs4lv9+qgEFhVPaq51COoXfSmuIzuefXKA5v5zcTSvbS/Fzv+vz0QIDAQAB";

/** The emblem at Chrome's icon sizes (public/icons, from ../brand). */
const ICONS = Object.fromEntries([16, 32, 48, 128].map((n) => [String(n), `icons/icon-${n}.png`]));

export interface ManifestOptions {
  version: string;
  mainnetEnabled: boolean;
  storeBuild: boolean;
}

export function buildManifest({ version, mainnetEnabled, storeBuild }: ManifestOptions) {
  const origins = networkOrigins(enabledNetworks(mainnetEnabled));
  return {
    manifest_version: 3,
    name: mainnetEnabled ? "Seedelf Wallet" : "Seedelf Wallet (preprod)",
    short_name: "Seedelf",
    // Also the Web Store's summary line: at most 132 characters.
    description: "A Cardano wallet with a private balance built in. Stake and send in public, or pay anyone privately through Seedelf.",
    version,
    icons: ICONS,
    // No popup: the button opens the wallet in a full tab (the worker's
    // action.onClicked), or in the side panel when the user chooses it
    // (shared/open-in.ts).
    action: {
      default_title: "Seedelf Wallet",
      default_icon: ICONS,
    },
    side_panel: {
      default_path: "index.html?view=panel",
    },
    background: {
      service_worker: "sw.js",
      type: "module",
    },
    // storage: the vault and the unlocked session; alarms: auto-lock;
    // sidePanel: the wallet in Chrome's side panel, when the user chooses it.
    permissions: ["storage", "alarms", "sidePanel"],
    // runtime.getContexts, which finds the wallet's open tab.
    minimum_chrome_version: "116",
    host_permissions: origins.map((o) => `${o}/*`),
    // WebAssembly needs 'wasm-unsafe-eval'; connect-src limits network access
    // to the extension itself and the wallet's own services. Fonts and images
    // ship inside the extension.
    content_security_policy: {
      extension_pages: [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "object-src 'none'",
        `connect-src 'self' ${origins.join(" ")}`,
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
      ].join("; "),
    },
    ...(storeBuild ? {} : { key: DEV_KEY }),
  };
}
