# Development

This is how we'll run and test the extension before it's in the Chrome Web Store. There's no code yet, so exact commands get filled in when the project is scaffolded.

## Running it in Chrome

Chrome runs an extension straight from a folder once developer mode is on. There is no store and no packaging.

1. Build the extension. The default build targets preprod, and the output folder is `dist/`.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist/` folder.
4. Pin the extension, then click its icon to open the popup.

After a rebuild, click the reload arrow on the extension's card. During `dev`, a Vite extension plugin can reload it automatically; we'll pick one when scaffolding.

**Debugging:**

- **Service worker:** click the "service worker" link under *Inspect views* on the extension's card.
  - That DevTools window shows the worker's console and network calls.
  - It also shows its storage, under **Application → Extension storage**.
- **Popup:** right-click inside the popup and choose **Inspect**.
- **Full tab:** use normal DevTools.

**Gotchas:**

- **Pin the extension ID.** Chrome derives an unpacked extension's ID from its folder path. Move the folder and you get a new ID with empty storage, so your test wallet disappears. A dev-only `key` in the manifest keeps the ID fixed.
- **Removing the extension deletes its storage,** including the vault. Keep the test wallet's phrase somewhere.
- **Startup warning:** Chrome may warn about developer-mode extensions at startup. That's expected.

## Test funds

- Get preprod test ADA from the [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet) and send it to the wallet's deposit address.
- The preprod contracts, reference scripts and collateral service are live (see [architecture.md](architecture.md#networks)).

## Testing layers

| Layer | What | How |
|---|---|---|
| Rust | `seedelf-crypto`, `seedelf-core`, and the wasm crate | `cargo test`. The CLI's offline integration tests (`seedelf-cli/tests/cli/`) guard the builder extraction. |
| Key derivation | The frozen v1 test vectors | Checked in Rust, and again from TypeScript through WebAssembly, so both sides agree |
| TypeScript | Vault, messaging, wallet state | Vitest |
| End to end | Real flows on preprod | Playwright launches Chromium with the unpacked extension loaded and drives the popup |
| Manual | A preprod checklist before each release | Onboarding, move in, create, transfer, withdraw, lock/unlock, restore |

## Sharing with testers before launch

- **Zip of `dist/`:** testers load it unpacked the same way we do. It works, but it's clunky and gets no automatic updates.
- **Chrome Web Store, unlisted or private (recommended for the first testers):**
  - **Unlisted:** anyone with the link can install it.
  - **Private:** only named trusted testers can.
  - Either way it needs a developer account (a one-time fee) and passes normal review, and updates arrive automatically.
  - This is the best way to put it in front of the first group, such as the repo's stargazers.
- **Self-hosted `.crx` files:** these don't work for normal users. Chrome generally only allows installs from outside the store through enterprise policy.
