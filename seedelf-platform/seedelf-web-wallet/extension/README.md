# Seedelf Web Wallet: extension

The Chrome (MV3) extension: React + TypeScript + Vite, with the Rust core loaded as WebAssembly in the service worker.

It can create or restore a wallet, lock it with a password, show what the wallet holds (the Seedelf balance and seedelfs, and the Cardano account), and move funds from the Cardano account into Seedelf. Creating a seedelf comes next (roadmap chunk 8).

## Screens

| Screen | When | What it does |
|---|---|---|
| Welcome | No wallet yet | **Create new wallet** or **Restore wallet**. From the popup, both open a full tab. |
| Create | Onboarding | Shows a new 24-word phrase (hidden until **Reveal**), asks for 3 of its words, then a password |
| Restore | Onboarding | 12, 15 or 24 words, one box each with BIP39 autocomplete; pasting a phrase fills every box. Then a password. |
| Unlock | Locked | Password, the back-off countdown after wrong attempts, and "Forgot password? Restore from your phrase" |
| Restore from your phrase | From Unlock | Deletes the wallet after typing `delete wallet`, then goes to Restore |
| Home | Unlocked | The Seedelf balance (ADA, tokens, your seedelfs), the Cardano account (ADA, tokens, receive address with copy and QR, stake address, **Move in**), the Seedelf identity, and Refresh. A sent move-in shows as a banner until it confirms. The lock button is in the top bar. |
| Move in | From Home | An ADA amount or Max, and tokens to bring along; then a review of what moves, the fee and the change; then Send |

The flows are described in [../docs/flows.md](../docs/flows.md#onboarding).

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
| `npm test` | Vitest: the manifest, SecretBox against independent vectors, the wallet state machine, the Koios client, the balance scan over recorded preprod responses, the handlers (all with the real WASM and the shared vectors), and formatting |
| `LIVE_KOIOS=1 npx vitest run tests/live.test.ts` | Optional: the balance scan against the real preprod Koios. Skipped otherwise, so CI stays offline. |
| `npm run e2e` | Playwright: loads `dist/` into Chromium and drives onboarding, lock and unlock, the back-off, reset, a browser restart, and balances. Koios answers from the recorded fixtures and every other host is blocked. Screenshots land in `test-results/`. Run `npm run build` first. The first time, run `npx playwright install chromium`. |

## Layout

```text
src/
  manifest.ts           manifest.json, generated at build time (network flag, CSP, dev key, icons)
  networks.ts           Koios and collateral endpoints per network
  shared/rpc.ts         typed request/response messages between the UI and the worker
  shared/password.ts    the password rule and strength hint (UI and worker)
  background/
    sw.ts               service worker entry: listeners, the auto-lock alarm
    wallet.ts           wallet state, lock, auto-lock and unlock back-off
    balances.ts         the balance reading: contract scan, account discovery, session cache
    move-in.ts          build (in WASM), hold, submit and watch a move-in
    koios.ts, chain.ts  the Koios client; pure helpers (registers, gap limit, sums, seedelf tags)
    vault.ts            the vault record in chrome.storage.local
    secret-box/         SBV1 encryption, adapted from Lace (Apache-2.0)
    handlers.ts         one handler per request
    storage.ts, wasm.ts chrome.storage wrapper, lazy WASM init
  ui/
    App.tsx             shell: top bar, picks the screen from the worker's status
    screens/            Onboarding, Create, Restore, Unlock (and reset), Home, MoveIn
    components/         PhraseInput (per-word autocomplete), SetPassword, CopyField, QrCode, TokenList, icons
    format.ts           ADA and token amounts, token names
public/                 icons and logos, resized from ../brand
tests/                  Vitest (vectors/: independent SecretBox vectors; fixtures/: recorded preprod Koios responses
                        and synthetic owned UTxOs, remade by fixtures/record-koios.mjs)
e2e/                    Playwright
```

See [../docs/](../docs/) for the design, especially [architecture.md](../docs/architecture.md) and [development.md](../docs/development.md).
