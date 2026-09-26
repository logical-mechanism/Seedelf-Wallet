# Development

This is how we run and test the extension before it's in the Chrome Web Store. The extension lives in [../extension/](../extension/); its README lists every script.

## Branching

`seedelf-web-wallet` is the long-lived dev branch for the web wallet.

- **It merges into `main` only once the wallet works and looks the way we want.** Until then, `main` carries no web-wallet code, so shelving the effort never leaves dead code on `main`.

**Feature branches and PRs:**

- **Start every feature branch from `seedelf-web-wallet`** and name it `web-wallet/<topic>`. Git can't create `seedelf-web-wallet/<topic>` next to an existing branch with that name.
- **Open PRs into `seedelf-web-wallet`, never into `main`.**
  - CI runs on pull requests into any branch.
  - Direct pushes to the dev branch don't trigger CI.

**Keeping up with `main`:**

- **Merge `main` into `seedelf-web-wallet` regularly.** Merge rather than rebase, because the branch is shared.
- **Always merge `main` in right before the builder extraction** in `seedelf-core` / `seedelf-cli`. That refactor touches the same files `main` changes.

**Shared Rust code:**

- **Changes to shared Rust code that only the web wallet needs stay on the dev branch too.** The builder extraction is the main example.

**Progress** is tracked in [roadmap.md](roadmap.md). The work happens in chunks of about one session each, and each chunk updates the roadmap when it finishes.

## Running it in Chrome

Chrome runs an extension straight from a folder once developer mode is on. There is no store and no packaging.

1. Build it: `cd seedelf-web-wallet/extension && npm install && npm run build`. This builds the Rust core to WebAssembly and then the extension into `dist/`. The default build targets preprod.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist/` folder.
4. Pin the extension, then click its icon: the wallet opens in a tab, or in the side panel once Settings says so.

After a rebuild, click the reload arrow on the extension's card. `npm run dev` rebuilds `dist/` on every change, but you still reload the extension by hand.

- **If you forget:** Chrome keeps running the old service worker, which asks for the old WebAssembly file. Each build gives that file a new hashed name and deletes the previous one.
- The wallet then shows **"The wallet couldn't start"** with **Reload the extension**, which does the same as the reload arrow.
- The name is hashed on purpose. A stable name would let an old worker load a new module that its glue code doesn't match.

**Debugging:**

- **Service worker:** click the "service worker" link under *Inspect views* on the extension's card.
  - That DevTools window shows the worker's console and network calls.
  - It also shows its storage, under **Application → Extension storage**.
- **Side panel:** right-click inside the panel and choose **Inspect**.
- **Full tab:** use normal DevTools.

**Gotchas:**

- **The extension ID is pinned.** Chrome normally derives an unpacked extension's ID from its folder path, so moving the folder would give a new ID with empty storage. The dev `key` in `extension/src/manifest.ts` fixes the ID at `jfekiogplaamnceifeehipmomhojngcb`.
  - Web Store builds leave the key out (`VITE_STORE_BUILD=true`, which `npm run package` sets), because the store assigns its own ID.
  - The end-to-end tests read the ID from the service worker's URL, so they pass on either build.
- **Removing the extension deletes its storage,** including the vault. Keep the test wallet's phrase somewhere.
- **Startup warning:** Chrome may warn about developer-mode extensions at startup. That's expected.

## Test funds

- Get preprod test ADA from the [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet) and send it to the wallet's Cardano account (its receive address).
- The preprod contracts, reference scripts and collateral service are live (see [architecture.md](architecture.md#networks)).
- **The private test wallet** is `extension/.preprod-test-wallet.txt` (gitignored): one line, `phrase: ` and 24 words. The live runs restore it. It was funded with 10,000 tADA on 2026-09-24.

## Testing layers

| Layer | What | How |
|---|---|---|
| Rust | `seedelf-crypto`, `seedelf-core`, and the wasm crate | `cargo test`. The CLI's offline integration tests (`seedelf-cli/tests/cli/`) guard the builder extraction. |
| Key derivation | The frozen v1 Seedelf key vectors, and the Cardano account vectors (verified against `@cardano-sdk`, Lace's library) | Checked in Rust, and again from JS through WebAssembly, so both sides agree |
| TypeScript | The manifest, the vault and wallet state, the Koios and giveme.my clients, and the worker's services and handlers against the real WASM, over recorded preprod answers | Vitest (`npm test`) |
| End to end | The built extension in a real browser | Playwright (`npm run e2e`) launches Chromium with `dist/` loaded and drives the side panel's layout and the full tab. Branded Chrome no longer accepts `--load-extension`, so it uses Playwright's Chromium. The dApp connector's tests (chunk 15) load a copy of the build whose manifest grants the sites from install, because Chrome's own dialog for an optional permission can't be answered from automation (`withSiteAccess` in `e2e/support.ts`); their dApp is a page served at `https://dapp.example/`. |
| Live reads | The balance scan and the ADA Handle lookup against the real preprod Koios | `LIVE_KOIOS=1 npx vitest run tests/live.test.ts`; skipped otherwise |
| Probes | Transactions checked against preprod's node and scripts, submitting nothing | `node tests/fixtures/probe-staking.mjs`: every staking transaction through Ogmios's decoder, and an account-paid mint with the rewards through the real policy. The `record-*.mjs` scripts do the same for the Seedelf spends, and keep what they recorded as fixtures. |
| Live | Real preprod transactions from the built extension, by hand, never in CI | `node e2e/live/run.mjs all` runs every Seedelf flow in one browser session on the private test wallet, waiting for each to confirm, and prints the hashes. `node e2e/live/run.mjs staking` stakes, delegates the vote and changes pool; `withdraw-rewards` and `unstake` wait until rewards arrive. `run.mjs` also takes single flows: `mint live-1 account + move-in 25.5`. |
| Manual | What a script can't see, before each release | [The preprod checklist](#preprod-checklist-before-a-release) |

## Preprod checklist before a release

On the built extension (`npm run build`, then load `dist/` unpacked), in the side panel and in a tab.

1. **The automated layers:** `cargo test --workspace`, the WASM tests, `npm test` and `npm run e2e`. Then `LIVE_KOIOS=1 npx vitest run tests/live.test.ts`, and `node e2e/live/run.mjs all` on the funded test wallet. Keep the six hashes.
2. **Onboarding:** create a wallet from the toolbar button (it opens a tab), and once from the side panel (it opens one too): reveal, confirm three words, set a password. Restore that phrase in another Chrome profile and check the addresses match. Restore a 12- or 15-word phrase from Lace or Eternl, and check its account.
3. **Locking:**
   - the lock button;
   - auto-lock after 15 minutes, and after 1 minute once Settings says so;
   - a wrong password's back-off;
   - Forgot password, then delete, then restore;
   - a browser restart comes back locked.
4. **Home:**
   - both tabs, and *Get started* on a new wallet;
   - Receive: scan the QR code from a phone wallet;
   - Refresh, and a sent transaction's banner through to confirmed, then Dismiss.
5. **Each flow once by hand:**
   - create a Seedelf, paid by the account;
   - move in;
   - send to a Seedelf, pasting a name someone else gave you;
   - withdraw to an address and to a `$handle`;
   - remove a Seedelf;
   - stake with a pool from the browser, change pool, delegate the vote to a DRep by its ID, withdraw rewards, and stop staking;
   - send with *Use staking rewards when spending* on, then off.

   Read every review and every privacy note as you go.
6. **Mistakes and failures:**
   - Koios blocked (offline, or an ad blocker) says why, and recovers on Refresh;
   - amounts: more than the balance, seven decimals, letters;
   - a mistyped Seedelf name, and a `$handle` that doesn't exist.
7. **Nothing else is contacted:** in DevTools, the worker's network panel shows only `preprod.koios.rest` and `www.giveme.my`.

## Web Store release: copy/paste procedure

This is the repeatable release path for a new Web Store version. Run it from the release commit on the `seedelf-web-wallet` branch. Change `release_version` to the new, higher version for each later release.

### 1. Set the version and run the checks

From the repository root:

```bash
cd seedelf-platform
cargo test --workspace
cd seedelf-web-wallet/extension
npm install
release_version=1.0.0
npm version "$release_version" --no-git-tag-version
npm run tokens
npm run dreps
npm run build
npm test
npm run e2e
LIVE_KOIOS=1 npx vitest run tests/live.test.ts
node e2e/live/run.mjs all
node e2e/live/run.mjs staking
```

Then complete the manual [preprod checklist](#preprod-checklist-before-a-release), including the dApp, private-session, swap, and Lovejoin flows.

### 2. Build and test the store package

```bash
npm run package
npm run e2e
sha256sum "release/seedelf-wallet-$release_version.zip"
```

The package to upload is:

```text
seedelf-platform/seedelf-web-wallet/extension/release/seedelf-wallet-$release_version.zip
```

For the current release, that file is `extension/release/seedelf-wallet-1.0.0.zip`.

The second `npm run e2e` runs against the store build created by `npm run package`. Keep the SHA-256 output for the release record.

### 3. Upload and submit

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Choose **Add new item** for the first release, or open the existing item for an update. Upload `extension/release/seedelf-wallet-$release_version.zip`.
3. Complete the **Store Listing**, **Privacy**, **Distribution**, and **Test instructions** tabs using [store/README.md](store/README.md).
4. Set visibility to **Unlisted**, keep the listing **preprod-only**, and verify the privacy-policy URL resolves.
5. Submit for review.
6. After approval, record the version, ZIP SHA-256, submission date, and approval date in the roadmap, then share the store link with the intended users.

The official Chrome upload flow is also described in [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/).

## Releasing to the Web Store

The listing's text, its images and the privacy policy are in [store/](store/README.md), laid out by the dashboard's tabs. The owner of the developer account uploads the package by hand.

1. **Bump the version:** `npm version <x.y.z> --no-git-tag-version` in `extension/`. It updates `package.json` and `package-lock.json`, and the manifest takes its version from there. Every upload needs a higher version than the last.
2. **Refresh the token list:** `npm run tokens` in `extension/`. Read the diff of `src/tokens/registry.*.json`, and any "also claimed by" warning, before committing it. To add a token, vet its unit and put it in `src/tokens/list.json` first; `node scripts/tokens.mjs find <network> <TICKER>` shows the registry's entries for a ticker.
3. **Refresh the DRep list:** `npm run dreps` in `extension/`. It rewrites `src/dreps/<network>.json` with every registered DRep that has a name; skim the diff for anything odd before committing it.
4. **Run [the preprod checklist](#preprod-checklist-before-a-release)** on a dev build (`npm run build`). The live runs expect the dev build's pinned ID.
5. **Build the package:** `npm run package` in `extension/`.
   - It builds with `VITE_STORE_BUILD=true`, so there's no dev key.
   - It refuses a `dist/` with a key, or one whose version doesn't match `package.json`.
   - It adds `licenses/THIRD-PARTY.txt`: every Rust crate compiled into the WebAssembly, every bundled npm package, and SecretBox, each with its licence text. It fails if one of them ships no licence and has no known fallback (`scripts/third-party.mjs`).
   - It writes `release/seedelf-wallet-<version>.zip` and prints its SHA-256. The zip is reproducible: the same sources and toolchain give the same bytes.
6. **Test the store build:** `npm run e2e` runs every end-to-end test on it. Load `dist/` unpacked in a fresh Chrome profile once, and click through onboarding and Home.
7. **The images:** if the UI changed, run `npm run store:images` and look at `docs/store/images/`.
8. **Upload** the zip on the dashboard's Package tab. If the listing's text changed, copy it from [store/README.md](store/README.md). Then submit for review.
9. **Record it** in the roadmap's handoff notes: the version, the zip's SHA-256, and the date it was submitted and approved.

## Sharing with testers before launch

**Decided (chunk 11c): an unlisted, preprod-only Web Store listing.** See [store/README.md](store/README.md).

- **Zip of `dist/`:** testers load it unpacked the same way we do. It works, but it's clunky and gets no automatic updates.
- **Chrome Web Store, unlisted or private (recommended for the first testers):**
  - **Unlisted:** anyone with the link can install it.
  - **Private:** only named trusted testers can.
  - Either way it needs a developer account (a one-time fee) and passes normal review, and updates arrive automatically.
  - This is the best way to put it in front of the first group, such as the repo's stargazers.
- **Self-hosted `.crx` files:** these don't work for normal users. Chrome generally only allows installs from outside the store through enterprise policy.
