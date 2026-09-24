# Seedelf Web Wallet: extension

The Chrome (MV3) extension: React + TypeScript + Vite, with the Rust core loaded as WebAssembly in the service worker.

It can create or restore a wallet, lock it with a password, and show what the wallet holds (the Seedelf balance and seedelfs, and the Cardano account). It runs every v1 flow: move in, create a seedelf, send to one, withdraw, remove a seedelf, and send from the Cardano account. The look is Lace's dark mode in Seedelf's colours ([architecture.md](../docs/architecture.md#ui)).

## Screens

| Screen | When | What it does |
|---|---|---|
| Welcome | No wallet yet | **Create new wallet** or **Restore wallet**. From the popup, both open a full tab. |
| Create | Onboarding | Shows a new 24-word phrase (hidden until **Reveal**), asks for 3 of its words, then a password |
| Restore | Onboarding | 12, 15 or 24 words, one box each with BIP39 autocomplete; pasting a phrase fills every box. Then a password. |
| Unlock | Locked | Password (with Show), the back-off countdown after wrong attempts, and "Forgot password? Restore from your phrase" |
| Restore from your phrase | From Unlock | Deletes the wallet after typing `delete wallet`, then goes to Restore |
| Home | Unlocked | Two tabs. **Seedelf:** the balance with round **Receive** (your seedelfs' names), **Send** (to a seedelf), **Withdraw** and **Create** (a seedelf); the first five tokens and **View all**. **Cardano account:** the balance with **Receive**, **Send** and **Move in**, and tokens. Until the first reading arrives, a splash covers it. A new wallet gets *Get started* (fund, create, move in). Refresh sits under the tabs, and a sent transaction shows as a banner until it confirms. The lock button is in the top bar. |
| UTxOs | The row under Activity on each Home tab | That balance's UTxOs from the last reading, kept ones first (locked, the collateral, a seedelf's). A UTxO opens its tokens, transaction, output and address, with **Lock** or **Unlock**: a locked UTxO is left out of every payment, Max included. No requests. |
| Collateral | Settings | The Cardano account's 5 ₳ collateral, after Lace's: who set it, **Reclaim collateral**, or **Set collateral** (from a 5 ₳ UTxO it holds, or a 5 ₳ payment to itself, reviewed first). |
| Activity | The row near the bottom of each Home tab | Newest first, grouped by day; an entry opens its details and Cardanoscan. **Seedelf:** from the device, encrypted, no requests. **Cardano account:** 20 at a time from Koios, with Load more. |
| Settings | The gear in the top bar | **Contacts** (add, edit, delete; encrypted on the device), **Collateral** (see it, set it, reclaim it), **Show recovery phrase** (the password again first), **Change password**, **Remove wallet** (typed confirmation), and About: the version, the network, links to the source and the privacy policy |
| Tokens | From **View all** | One balance's tokens and NFTs in two tabs, with a search and a sort. A token opens a modal with its amount, policy ID, asset name and fingerprint, each with Copy. Tickers and logos come from the wallet's own token list. |
| Receive | From the Cardano account tab | The receive address as a QR code and text, with copy, and the stake address |
| Receive (Seedelf) | From the Seedelf tab | Your seedelfs: each by its tag, with the ADA locked with it, Copy and Remove, and its whole name on one line (cut in the middle when it doesn't fit). With none yet, a way to create one. |
| Move in | From Home | An ADA amount or Max, and tokens to bring along, picked with **Add tokens** (a search), each in any amount or its Max. With tokens the amount can stay empty, and only the ADA they need moves; less than that is raised to it. Then a review of what moves, the fee and the change (and a note when the amount is that minimum); then Send |
| Send (Cardano) | From the Cardano account tab | An address or `$handle`, read as it's typed, with a note if it's your own. An ADA amount or Max, and tokens, with the minimum worked out as for a move-in. Then a review of where it goes, what's sent, the fee and the change, then Send. The account's keys sign at review; no giveme.my. |
| Send to a seedelf | From Home | Paste the recipient's full seedelf name: it's looked up in the wallet contract and shown ("Found: tag · 5eed0e1f…"), with a warning if it's your own. An ADA amount, and optionally part of any token (the minimum worked out as for a move-in). Then a review of the recipient, what's sent, the fee and the change, then Send, when giveme.my is asked for the collateral. |
| Withdraw | From Home | An address or `$handle`, read as it's typed, with a warning if it's your own Cardano account. An ADA amount and optional tokens (the minimum worked out as for a move-in), or Max (up to 20 UTxOs, every token). Then a review of where it goes, what's sent, the fee and the change, then Send, when giveme.my is asked for the collateral. |
| Remove a seedelf | From a seedelf's row in Receive | Where its freed ADA goes: the Cardano account (the default) or the Seedelf balance, each with a note on what it links. Then a review of what comes back and the fee, then Send. |
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
- **Web Store builds** set `VITE_STORE_BUILD=true` to leave that key out. `npm run package` makes one and zips it (see [the release checklist](../docs/development.md#releasing-to-the-web-store)).
- **Mainnet:** builds are preprod-only unless `VITE_ENABLE_MAINNET=true`.

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | WASM plus the extension (`build:wasm`, then `build:ext`) |
| `npm run build:store` | The same with `VITE_STORE_BUILD=true`: no dev key, so Chrome or the store picks the ID |
| `npm run tokens` | Rebuilds the wallet's token list (`src/tokens/registry.<network>.json`) from `src/tokens/list.json` and the Cardano token registry, through Koios. Run at each release. |
| `npm run package` | A store build, plus `licenses/THIRD-PARTY.txt`, zipped reproducibly into `release/seedelf-wallet-<version>.zip` for the Web Store (`scripts/package.mjs`, `scripts/third-party.mjs`) |
| `npm run dev` | Rebuilds the extension into `dist/` on change (development mode, with source maps) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: the manifest, SecretBox against independent vectors, the wallet state machine, the Koios and giveme.my clients, the balance scan over recorded preprod responses, move-in, mint, transfer and withdraw (on real preprod Ogmios evaluations), the handlers (all with the real WASM and the shared vectors), and formatting |
| `LIVE_KOIOS=1 npx vitest run tests/live.test.ts` | Optional: the balance scan against the real preprod Koios. Skipped otherwise, so CI stays offline. |
| `npm run e2e` | Playwright: loads `dist/` into Chromium and drives onboarding, lock and unlock, the back-off, reset, a browser restart, balances, move-in, creating a seedelf, sending to one, withdrawing, and removing one. Koios, Ogmios and giveme.my answer from the recorded fixtures and every other host is blocked. Since only giveme.my's real key can sign, the Seedelf-spend tests (stealth mint, transfer, withdraw, remove) stop at Send: it checks that a forged witness is refused and nothing is submitted. Screenshots of every screen land in `test-results/`, the popup's as `popup-*.png`. The tests read the extension's ID from its worker, so they run on a dev or a store build. Run `npm run build` first. The first time, run `npx playwright install chromium`. |
| `npm run store:images` | The Web Store's five screenshots, small promo tile and store icon, into `../docs/store/images/`. It uses the fixtures and the public 12-word test phrase (`e2e/store-images.spec.ts`). Run a build first. |
| `node e2e/live/run.mjs all` | Live preprod runs of the built extension with nothing intercepted. Every flow, in one browser session: mint (account), move in, a stealth mint, a transfer, a withdrawal, a removal. Each submits a real transaction from the test wallet in `.preprod-test-wallet.txt` (gitignored) and waits for it to confirm. Single flows work too: `run.mjs mint live-1 account + move-in 25.5`. See `e2e/live/flows.mjs`. |

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
    screens/            Onboarding, Create, Restore, Unlock (and reset), Home, Tokens, Receive, MoveIn,
                        CreateSeedelf, Transfer, Withdraw, RemoveSeedelf, Settings, Activity
    components/         Screen (every flow's layout), Splash, Tabs, Modal, TokenList, ReviewRows, Callout,
                        ActionButton, Choice, PhraseInput
                        (per-word autocomplete), SetPassword, AdaInput, TokenAmounts, TokenList, CopyField,
                        CopyButton, QrCode, Icons (Lucide)
    styles.css          the design tokens, then every style
    format.ts           ADA and token amounts, token names
    tokens.ts           tokens as the lists show them: the token list's ticker and logo, NFT or not, sort, search
  tokens/               list.json (the tokens the wallet knows by name) and registry.<network>.json (npm run tokens)
public/                 icons and logos resized from ../brand; fonts/ (Inter); licenses/ (Inter's OFL, Lucide's ISC)
tests/                  Vitest (vectors/: independent SecretBox vectors; fixtures/: recorded preprod Koios responses
                        and synthetic owned UTxOs, remade by fixtures/record-koios.mjs; a stealth mint's real preprod
                        evaluation and giveme.my answer, remade by fixtures/record-mint.mjs; an account-paid mint's
                        real preprod evaluation, remade by fixtures/record-account-mint.mjs; a transfer's real
                        preprod evaluation and giveme.my answer, remade by fixtures/record-transfer.mjs; withdrawals
                        and a removal's real preprod evaluations, remade by fixtures/record-withdraw.mjs)
e2e/                    Playwright: support.ts (launch, the fake Koios, shared steps), extension.spec.ts,
                        store-images.spec.ts; live/ holds the live preprod runs
scripts/                package.mjs (the store zip), third-party.mjs (the licence notices), tokens.mjs (the token list)
release/                the store zip (gitignored)
```

See [../docs/](../docs/) for the design, especially [architecture.md](../docs/architecture.md) and [development.md](../docs/development.md).
