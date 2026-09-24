# Seedelf Web Wallet: extension

The Chrome (MV3) extension: React + TypeScript + Vite, with the Rust core loaded as WebAssembly in the service worker.

It can create or restore a wallet, lock it with a password, show what the wallet holds (the Seedelf balance and seedelfs, and the Cardano account), move funds from the Cardano account into Seedelf, and create a seedelf. Transfer comes next (roadmap chunk 9).

## Screens

| Screen | When | What it does |
|---|---|---|
| Welcome | No wallet yet | **Create new wallet** or **Restore wallet**. From the popup, both open a full tab. |
| Create | Onboarding | Shows a new 24-word phrase (hidden until **Reveal**), asks for 3 of its words, then a password |
| Restore | Onboarding | 12, 15 or 24 words, one box each with BIP39 autocomplete; pasting a phrase fills every box. Then a password. |
| Unlock | Locked | Password, the back-off countdown after wrong attempts, and "Forgot password? Restore from your phrase" |
| Restore from your phrase | From Unlock | Deletes the wallet after typing `delete wallet`, then goes to Restore |
| Home | Unlocked | The Seedelf balance (ADA, tokens, **Send to a seedelf**, **Withdraw**, your seedelfs with Copy and Remove on each, **Create a seedelf**), the Cardano account (ADA, tokens, receive address with copy and QR, stake address, **Move in**), the Seedelf identity, and Refresh. A sent transaction shows as a banner until it confirms. The lock button is in the top bar. |
| Move in | From Home | An ADA amount or Max, and tokens to bring along; then a review of what moves, the fee and the change; then Send |
| Send to a seedelf | From Home | Paste the recipient's full seedelf name: it's looked up in the wallet contract and shown ("Found: tag · 5eed0e1f…"), with a warning if it's your own. An ADA amount, and optionally part of any token. Then a review of the recipient, what's sent, the fee and the change, then Send, when giveme.my is asked for the collateral. |
| Withdraw | From Home | An address or `$handle`, read as it's typed, with a warning if it's your own Cardano account. An ADA amount and optional tokens, or Max (up to 20 UTxOs, every token). Then a review of where it goes, what's sent, the fee and the change, then Send, when giveme.my is asked for the collateral. |
| Remove a seedelf | From a seedelf's row | Where its freed ADA goes: the Cardano account (the default) or the Seedelf balance, each with a note on what it links. Then a review of what comes back and the fee, then Send. |
| Create a seedelf | From Home | An optional tag (printable ASCII, 15 at most) with a live preview, and what pays: the Cardano account (the default: mint first, then move in) or the Seedelf balance (a stealth mint). Then a review of the token name, the ADA locked with it, the fee and the change, then Send. The account's keys sign at review; for a stealth mint, Send is when giveme.my is asked for the collateral. |

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
| `npm test` | Vitest: the manifest, SecretBox against independent vectors, the wallet state machine, the Koios and giveme.my clients, the balance scan over recorded preprod responses, move-in, mint, transfer and withdraw (on real preprod Ogmios evaluations), the handlers (all with the real WASM and the shared vectors), and formatting |
| `LIVE_KOIOS=1 npx vitest run tests/live.test.ts` | Optional: the balance scan against the real preprod Koios. Skipped otherwise, so CI stays offline. |
| `npm run e2e` | Playwright: loads `dist/` into Chromium and drives onboarding, lock and unlock, the back-off, reset, a browser restart, balances, move-in, creating a seedelf, sending to one, withdrawing, and removing one. Koios, Ogmios and giveme.my answer from the recorded fixtures and every other host is blocked. Since only giveme.my's real key can sign, the Seedelf-spend tests (stealth mint, transfer, withdraw, remove) stop at Send: it checks that a forged witness is refused and nothing is submitted. Screenshots land in `test-results/`. Run `npm run build` first. The first time, run `npx playwright install chromium`. |
| `node e2e/live/move-in.mjs [ada]`, `node e2e/live/mint.mjs [tag]` | Live preprod runs of the built extension with nothing intercepted: they submit real transactions from the test wallet in `.preprod-test-wallet.txt` (gitignored). Move in first; the mint is paid from Seedelf. |

## Layout

```text
src/
  manifest.ts           manifest.json, generated at build time (network flag, CSP, dev key, icons)
  networks.ts           Koios and collateral endpoints per network
  shared/rpc.ts         typed request/response messages between the UI and the worker
  shared/password.ts    the password rule and strength hint (UI and worker)
  shared/label.ts       the seedelf tag rule and token-name preview (the worker's WASM enforces it too)
  shared/seedelf-name.ts  what a whole seedelf name is (UI and worker)
  background/
    sw.ts               service worker entry: listeners, the auto-lock alarm
    wallet.ts           wallet state, lock, auto-lock and unlock back-off
    balances.ts         the balance reading: contract scan, account discovery, session cache
    move-in.ts          build (in WASM), hold and submit a move-in
    script-spend.ts     the flow every Seedelf spend shares: draft → Ogmios → finish, keep until Send, giveme.my, sign, submit
    mint.ts             create a seedelf, paid by the account (signed at review) or stealth (giveme.my and sign at Send)
    transfer.ts         find a seedelf by its full name, then build and send a payment to it
    withdraw.ts         read a destination (address or ADA Handle), withdraw, and remove a seedelf
    pending.ts          the submitted transaction being watched, until it confirms
    collateral.ts       the giveme.my client
    koios.ts, chain.ts  the Koios client; pure helpers (registers, gap limit, sums, seedelf tags)
    vault.ts            the vault record in chrome.storage.local
    secret-box/         SBV1 encryption, adapted from Lace (Apache-2.0)
    handlers.ts         one handler per request
    storage.ts, wasm.ts chrome.storage wrapper, lazy WASM init
  ui/
    App.tsx             shell: top bar, picks the screen from the worker's status
    screens/            Onboarding, Create, Restore, Unlock (and reset), Home, MoveIn, CreateSeedelf, Transfer,
                        Withdraw, RemoveSeedelf
    components/         PhraseInput (per-word autocomplete), SetPassword, CopyField, CopyButton, QrCode, TokenList,
                        TokenAmounts, icons
    format.ts           ADA and token amounts, token names
public/                 icons and logos, resized from ../brand
tests/                  Vitest (vectors/: independent SecretBox vectors; fixtures/: recorded preprod Koios responses
                        and synthetic owned UTxOs, remade by fixtures/record-koios.mjs; a stealth mint's real preprod
                        evaluation and giveme.my answer, remade by fixtures/record-mint.mjs; an account-paid mint's
                        real preprod evaluation, remade by fixtures/record-account-mint.mjs; a transfer's real
                        preprod evaluation and giveme.my answer, remade by fixtures/record-transfer.mjs; withdrawals
                        and a removal's real preprod evaluations, remade by fixtures/record-withdraw.mjs)
e2e/                    Playwright; live/ holds the live preprod runs
```

See [../docs/](../docs/) for the design, especially [architecture.md](../docs/architecture.md) and [development.md](../docs/development.md).
