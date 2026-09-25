# Chrome Web Store listing

Everything the unlisted preprod listing needs, laid out by the developer dashboard's tabs, so submitting is copy and paste. The owner of the developer account submits it by hand.

**Decided for the first testers (chunk 11c):**

- **Preprod only.** Mainnet comes after v1 and needs its own listing review.
- **Unlisted:** anyone with the link can install it.
- **The privacy policy** is [privacy-policy.md](privacy-policy.md) on the `seedelf-web-wallet` branch.
- **The Privacy practices form** declares *Authentication information* and *Financial and payment information*.

## Before you upload

1. **Run the release checklist** in [development.md](../development.md#releasing-to-the-web-store). It ends with `npm run package`, which writes `extension/release/seedelf-wallet-<version>.zip`.
2. **Make sure the privacy policy's URL resolves.** It points at the `seedelf-web-wallet` branch, so the PR that added it must be merged first.

## Package

Upload `extension/release/seedelf-wallet-0.1.0.zip`.

- The store reads the name, version, summary and permissions from its manifest.
- Every later upload needs a higher `version` in `extension/package.json`.

## Store listing

**Title** (from the manifest): `Seedelf Wallet (preprod)`

**Summary** (from the manifest's `description`; the store allows 132 characters):

```text
A Cardano wallet with a private balance built in. Stake and send in public, or pay anyone privately through Seedelf.
```

**Description:**

```text
Seedelf Wallet is a Cardano wallet with a private balance built in: Seedelf, the stealth wallet on Cardano. It's one wallet with two sides: a public account for everyday Cardano, and a private balance where no UTxO says who owns the money.

This is a test build for early testers. It runs on Cardano's preprod test network, with test ADA only. Get test ADA from the Cardano testnet faucet.

Seedelf hides who owns money. Each payment to a Seedelf reaches its owner under a fresh copy of their key, so no UTxO says who owns it, and payments to the same Seedelf can't be linked to each other. Spending is proven with a zero-knowledge proof and a one-time key, so it doesn't reveal the spender either.

What you can do:
• Create a wallet, or restore one from a 12, 15 or 24-word recovery phrase, and lock it with a password.
• Use its public account: a normal Cardano account that any wallet or faucet can pay, and that pays any address, ADA Handle or Seedelf, several at once. A phrase from Lace or Eternl opens that wallet's first account.
• Stake the public account with a pool, from a list of every live pool, and spend or withdraw the rewards.
• Delegate its voting power: always abstain, always no confidence, or a DRep you find by name.
• Create a Seedelf: a name you give out so that anyone can pay you privately.
• Make ADA and tokens private: move them from the public account into your private balance.
• Send privately to any Seedelf by its name, several at once.
• Make money public: pay any Cardano address or ADA Handle from the private balance. Or remove a Seedelf.
• Connect Cardano sites (dApps) to the public account, as with any Cardano wallet. It's off until you turn it on in Settings, and sites never see the private balance.

What it doesn't hide:
• Amounts, tokens, timing and which transactions spend which outputs are public, as with any Cardano wallet.
• Making money private, and making it public again, link your public account to what you move. Each screen says what it links, and the wallet warns you before a step ties your accounts together.
• Privacy grows with the number of people who use Seedelf, and today there are few.

Private money earns no staking rewards: it has no staking part, which is what keeps your Seedelfs from being linked together. Money that sits can stay staked in the public account, and be made private when it should move privately.

How it works:
• Everything is built and signed inside the extension. The cryptography and the transaction building are Rust, compiled to WebAssembly and shipped in the package.
• Your recovery phrase never leaves your device. It's encrypted with your password (Argon2id and ChaCha20-Poly1305).
• The wallet talks to two services and nothing else. Koios reads the chain and submits your transactions. giveme.my adds shared collateral to private payments, so your own address stays out of them. Both see your IP address.
• It adds nothing to web pages unless you turn on connecting sites. Then it adds only the standard Cardano wallet entry (window.cardano) to https pages, and asks you before anything is signed.
• There are no accounts, analytics or tracking.

Open source (MIT): https://github.com/logical-mechanism/Seedelf-Wallet
```

**Category:** Tools. Lace is listed there too.

**Language:** English

**Graphic assets** ([images/](images/)):

| Field | File |
|---|---|
| Store icon (128×128) | `icon-128.png`: the guardian artwork in 96×96, with 16 px transparent padding |
| Screenshots (1280×800) | `screenshot-1.png` to `screenshot-5.png`, in that order |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile | None. It's optional, and the store doesn't feature crypto extensions. |
| Video | None |

**Additional fields:**

- **Homepage URL:** `https://github.com/logical-mechanism/Seedelf-Wallet/tree/seedelf-web-wallet/seedelf-platform/seedelf-web-wallet`
- **Support URL:** `https://github.com/logical-mechanism/Seedelf-Wallet/issues`
- **Mature content:** no

## Privacy practices

**Single purpose:**

```text
Seedelf Wallet is a Cardano wallet with the Seedelf stealth wallet contract built in. It keeps the user's recovery phrase encrypted on their device, and lets them send and stake from their public account, connect it to Cardano sites (dApps), create a Seedelf, make ADA private, send it to other Seedelfs, and make it public again, while keeping who owns each UTxO in the private balance hidden.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | `Keeps the wallet on the user's device: the recovery phrase, encrypted with the user's password, in chrome.storage.local, and the unlocked session in chrome.storage.session, which is memory-only and cleared when the wallet locks or the browser closes. Nothing is synced.` |
| `alarms` | `Locks the wallet automatically after a time without use that the user sets (15 minutes unless changed). A one-minute alarm checks the time since the user last did something.` |
| `sidePanel` | `Lets the user open the wallet in Chrome's side panel instead of a tab, a choice in its Settings. The side panel shows only the extension's own page.` |
| `scripting` | `Adds the standard Cardano wallet entry (window.cardano.seedelf, CIP-30) to https pages, only after the user turns on "Let sites connect to your public account" in Settings, and removes it when they turn it off. The scripts ship in the package; the page's own content is never read.` |
| Optional host `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | `Asked for only when the user turns on connecting sites in Settings. It lets the wallet offer itself to Cardano sites (dApps) as a CIP-30 wallet: a site can then ask to connect, and to have transactions or messages signed, each approved by the user in the wallet's own window. localhost is for sites in development.` |
| Host `https://preprod.koios.rest/*` | `Koios is the public Cardano API the wallet uses to read the user's balances, UTxOs and staking, and the stake pools and DReps, to evaluate scripts, and to submit the transactions the user approves.` |
| Host `https://www.giveme.my/*` | `giveme.my adds shared collateral to Seedelf script transactions. The wallet sends it each such transaction to witness, so that the user's own address never appears as collateral.` |

**Remote code:** No, I am not using remote code.

```text
All code ships in the package, including the WebAssembly module (Rust compiled to wasm). The page CSP's 'wasm-unsafe-eval' is only there to compile that bundled module. The extension fetches data (JSON and CBOR) from Koios and giveme.my, never code.
```

**Data usage.** Check these two, and leave the rest unchecked:

- **Authentication information:** the recovery phrase and the password. The phrase is kept encrypted on the device; the password is never stored.
- **Financial and payment information:** the wallet's addresses, balances, staking and transactions, sent to Koios and giveme.my to read the chain and to send transactions. When the user connects a site, it sees the public account's addresses, balance and UTxOs, and what the user signs for it.

**To decide at the next submission (chunk 15):** whether to check **Web history** as well. The wallet keeps the list of sites the user connected (their addresses and when), sealed on the device, and Google's FAQ counts data handled only on the device.

Then certify all three statements: no selling or transferring data outside the approved use cases, no use unrelated to the single purpose, and no creditworthiness or lending use.

**Privacy policy URL:**

```text
https://github.com/logical-mechanism/Seedelf-Wallet/blob/seedelf-web-wallet/seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md
```

When `seedelf-web-wallet` merges into `main`, change `seedelf-web-wallet` in this URL to `main` in the dashboard.

## Distribution

- **Visibility:** Unlisted
- **Regions:** all
- **Payment:** free

## Test instructions

Paste this if the dashboard asks for test instructions:

```text
The extension runs on Cardano's preprod test network, so nothing costs real money.

To see an empty wallet: click the toolbar icon, and the wallet opens in a tab. Choose "Create new wallet": reveal and write down the phrase, confirm three of its words, then set a password.

To see a wallet with test funds: choose "Restore wallet" instead and paste the standard public BIP39 test phrase:
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
Home then shows its preprod balances. It's public, so its funds are shared test ADA.

Every screen works without any account or server of ours. The wallet only contacts preprod.koios.rest and www.giveme.my.
```

## After approval

- **The listing's URL is the install link.** Share it with the testers.
- **Updating:** bump the version, run the release checklist, then upload the new zip on the Package tab. Chrome updates the testers' copies on its own.
- **When the UI changes,** regenerate the images: `npm run build && npm run store:images` in `extension/`.
  - `e2e/store-images.spec.ts` makes them from the test fixtures and the public test phrase, so no real wallet appears.
  - Upload the new ones.
