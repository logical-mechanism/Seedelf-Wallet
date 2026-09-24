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
4. Pin the extension, then click its icon to open the popup.

After a rebuild, click the reload arrow on the extension's card. `npm run dev` rebuilds `dist/` on every change, but you still reload the extension by hand.

- **If you forget:** Chrome keeps running the old service worker, which asks for the old WebAssembly file. Each build gives that file a new hashed name and deletes the previous one.
- The wallet then shows **"The wallet couldn't start"** with **Reload the extension**, which does the same as the reload arrow.
- The name is hashed on purpose. A stable name would let an old worker load a new module that its glue code doesn't match.

**Debugging:**

- **Service worker:** click the "service worker" link under *Inspect views* on the extension's card.
  - That DevTools window shows the worker's console and network calls.
  - It also shows its storage, under **Application → Extension storage**.
- **Popup:** right-click inside the popup and choose **Inspect**.
- **Full tab:** use normal DevTools.

**Gotchas:**

- **The extension ID is pinned.** Chrome normally derives an unpacked extension's ID from its folder path, so moving the folder would give a new ID with empty storage. The dev `key` in `extension/src/manifest.ts` fixes the ID at `jfekiogplaamnceifeehipmomhojngcb`. Web Store builds leave it out (`VITE_STORE_BUILD=true`).
- **Removing the extension deletes its storage,** including the vault. Keep the test wallet's phrase somewhere.
- **Startup warning:** Chrome may warn about developer-mode extensions at startup. That's expected.

## Test funds

- Get preprod test ADA from the [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet) and send it to the wallet's Cardano account (its receive address).
- The preprod contracts, reference scripts and collateral service are live (see [architecture.md](architecture.md#networks)).

## Testing layers

| Layer | What | How |
|---|---|---|
| Rust | `seedelf-crypto`, `seedelf-core`, and the wasm crate | `cargo test`. The CLI's offline integration tests (`seedelf-cli/tests/cli/`) guard the builder extraction. |
| Key derivation | The frozen v1 Seedelf key vectors, and the Cardano account vectors (verified against `@cardano-sdk`, Lace's library) | Checked in Rust, and again from JS through WebAssembly, so both sides agree |
| TypeScript | The manifest, and the service-worker handlers against the real WASM (later: the vault and wallet state) | Vitest (`npm test`) |
| End to end | The built extension in a real browser | Playwright (`npm run e2e`) launches Chromium with `dist/` loaded and drives the popup and the full tab. Branded Chrome no longer accepts `--load-extension`, so it uses Playwright's Chromium. |
| Manual | A preprod checklist before each release | Onboarding, move in, create, transfer, withdraw, lock/unlock, restore |

## Sharing with testers before launch

- **Zip of `dist/`:** testers load it unpacked the same way we do. It works, but it's clunky and gets no automatic updates.
- **Chrome Web Store, unlisted or private (recommended for the first testers):**
  - **Unlisted:** anyone with the link can install it.
  - **Private:** only named trusted testers can.
  - Either way it needs a developer account (a one-time fee) and passes normal review, and updates arrive automatically.
  - This is the best way to put it in front of the first group, such as the repo's stargazers.
- **Self-hosted `.crx` files:** these don't work for normal users. Chrome generally only allows installs from outside the store through enterprise policy.
