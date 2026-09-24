import { defineConfig } from "@playwright/test";

// End-to-end tests load the built extension (dist/) into Chromium.
// Run `npm run build` first. Branded Chrome no longer allows --load-extension,
// so these use Playwright's Chromium.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [
    // npm run e2e
    { name: "extension", testMatch: "extension.spec.ts" },
    // npm run store:images: the Web Store's screenshots, promo tile and icon (docs/store/images/)
    { name: "store", testMatch: "store-images.spec.ts", timeout: 90_000 },
  ],
});
