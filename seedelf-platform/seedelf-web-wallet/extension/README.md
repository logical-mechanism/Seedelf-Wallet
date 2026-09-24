# Seedelf Web Wallet: extension

The Chrome (MV3) extension: React + TypeScript + Vite, with the Rust core loaded as WebAssembly in the service worker.

It's currently a scaffold. The popup shows a **Wallet core check** that derives a phrase's Cardano account and Seedelf key inside the service worker. Onboarding replaces it in roadmap chunk 5.

## Build and load in Chrome

From this folder:

```bash
npm install
npm run build          # builds ../wasm (Rust → WebAssembly), then the extension into dist/
```

Then:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick `dist/`.
3. Click the toolbar icon for the popup, or **Open in tab** for the full view.

After a rebuild, press the reload arrow on the extension's card.

- **Stable ID:** the dev key in `src/manifest.ts` pins the ID to `jfekiogplaamnceifeehipmomhojngcb`, so the extension's storage survives moving the folder.
- **Web Store builds** set `VITE_STORE_BUILD=true` to leave that key out.
- **Mainnet:** builds are preprod-only unless `VITE_ENABLE_MAINNET=true`.

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | WASM plus the extension (`build:wasm`, then `build:ext`) |
| `npm run dev` | Rebuilds the extension into `dist/` on change (development mode, with source maps) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: the manifest, and the service-worker handlers against the real WASM and the shared vectors |
| `npm run e2e` | Playwright: loads `dist/` into Chromium and drives the popup. Run `npm run build` first. The first time, run `npx playwright install chromium`. |

## Layout

```text
src/
  manifest.ts         manifest.json, generated at build time (network flag, CSP, dev key)
  networks.ts         Koios and collateral endpoints per network
  shared/rpc.ts       typed request/response messages between the UI and the worker
  background/         service worker: listeners, lazy WASM init, handlers
  ui/                 React popup / full-tab app
tests/                Vitest
e2e/                  Playwright
```

See [../docs/](../docs/) for the design, especially [architecture.md](../docs/architecture.md) and [development.md](../docs/development.md).
