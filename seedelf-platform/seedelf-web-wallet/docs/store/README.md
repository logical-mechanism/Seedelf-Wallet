# Chrome Web Store listing

Everything the mainnet listing needs, laid out by the developer dashboard's tabs, so submitting is copy and paste. The owner of the developer account submits it by hand.

**Decided for launch (2026-09-26, the launch review):**

- **Mainnet, with preprod for testing.** The store's build (`npm run package`) opens on Cardano mainnet, where ADA is real money. The welcome screen, before a wallet exists, and Settings can switch it to preprod, Cardano's test network, and a strip on every screen says so while it's there.
- **Lovejoin is on,** on both networks, for private sessions' returns (a Settings switch turns it off), and says where it's chosen that it has had no third-party audit.
- **The privacy policy** is [privacy-policy.md](privacy-policy.md) on the `seedelf-web-wallet` branch.
- **The Privacy practices form** declares *Authentication information* and *Financial and payment information*, and, on this review's reading, *Location* and *Web history* too (see *Data usage* below).
- **Privacy review (2026-09-27):** the description, the justifications and the policy say that giveme.my is ours, and what Koios and giveme.my, sites and Minswap can still see ([plans/privacy-review.md](../plans/privacy-review.md), §2.4, §2.5, §2.12). Recheck the data usage answers below before submitting.

## Before you upload

0. **Turn on 2-Step Verification for the developer account.** The Web Store refuses every upload without it, and says only "There was a problem uploading your file", which reads as a problem with the zip.
1. **Run the release checklist** in [development.md](../development.md#releasing-to-the-web-store). It ends with `npm run package`, which writes `extension/release/seedelf-wallet-<version>-mainnet.zip`, and refuses a build without mainnet's hosts.
2. **Make sure the privacy policy's URL resolves.** It points at `main`, so `seedelf-web-wallet` must be merged into `main` before the listing is submitted — open the URL and check it renders. The wallet's own Settings link points at `main` too, and is built into the package, so the merge comes before `npm run package`, not after.

## Package

Upload `extension/release/seedelf-wallet-1.1.0-mainnet.zip`.

- The store reads the name, version, summary and permissions from its manifest.
- Every later upload needs a higher `version` in `extension/package.json`.
- Never upload a `-preprod.zip` (`npm run package:preprod`): it's a preprod-only build, for tests.

## Store listing

**Title** (from the manifest): `Seedelf Wallet`

**Summary** (from the manifest's `description`; the store allows 132 characters):

```text
A Cardano wallet with a private balance built in. Stake and send in public, or pay anyone privately through Seedelf.
```

**Description:**

```text
Seedelf Wallet is a Cardano wallet with a private balance built in: Seedelf, the stealth wallet on Cardano. It's one wallet with two sides: a public account for everyday Cardano, and a private balance where no UTxO says who owns the money.

It runs on Cardano mainnet, with real ADA. To try it without real money, switch it to preprod, Cardano's test network, on the welcome screen or in Settings, with a recovery phrase you don't use on mainnet: the same phrase has the same keys on both networks, so anyone comparing them can tell they're one wallet's. ADA there is test ADA, from the Cardano testnet faucet, with no value. The wallet marks preprod on every screen.

Seedelf hides who owns money. Each payment to a Seedelf reaches its owner under a fresh copy of their key, so no UTxO says who owns it, and payments to the same Seedelf can't be linked to each other. Spending is proven with a zero-knowledge proof and a one-time key, so it doesn't reveal the spender either.

What you can do:
• Create a wallet, or restore one from a 12, 15 or 24-word recovery phrase, and lock it with a password.
• Use its public accounts: normal Cardano accounts that any wallet can pay, and that pay any address, ADA Handle or Seedelf, several at once. A phrase from Lace or Eternl opens that wallet's accounts, and the wallet finds the ones the phrase has used.
• Stake the public account with a pool, from a list of every live pool, and spend or withdraw the rewards.
• Delegate its voting power: always abstain, always no confidence, or a DRep you find by name.
• Be your own DRep: register the public account, vote on the open governance actions, and retire to get the deposit back. Governance sites such as GovTool can connect too, when you allow it.
• Create a Seedelf: a name you give out so that anyone can pay you privately.
• Make ADA and tokens private: move them from the public account into your private balance.
• Send privately to any Seedelf by its name, several at once.
• Make money public: pay any Cardano address or ADA Handle from the private balance. Or remove a Seedelf.
• Connect Cardano sites (dApps) to the public account, as with any Cardano wallet, or to a private session: a one-time account funded from your private balance, so the wallet gives the site only that account, not your public account. Its funding is public, though, and money you made private yourself leads back to your public account. It's off until you turn it on in Settings, and sites are never given the private balance.
• Swap privately through Minswap: each swap runs from a new one-time account, funded from your private balance, and everything comes back into it afterwards. Your public account isn't in the swap's transactions, though anyone can follow the money back through its funding. The wallet asks Minswap for an order with the least you'll accept, checks where the transaction Minswap builds pays, and shows what the swap will cost before you approve it.
• Mix through Lovejoin: the spare ADA a private session brings back goes through Lovejoin, a mixer of 10 ADA boxes on Cardano, so what comes back is harder to tie to the session on chain. You can turn that off in Settings, or bring any one back directly. You can also mix from the Lovejoin tile. Lovejoin has had no third-party audit, only its makers' own review, and the wallet says so where you choose it. On mainnet the wallet mixes only once Lovejoin's pool holds 30 boxes that aren't yours, so there are enough other boxes to mix with; until then a return comes back directly and says why.
• Read any transaction before it is signed, on every review and when a site asks for a signature: where the money goes, what contracts run and with what data, the certificates, the note and the metadata, and the raw bytes if you want to take them elsewhere. Nothing is looked up to show it, so reading a transaction tells nobody that you read it.

What it doesn't hide:
• Amounts, tokens, timing and which transactions spend which outputs are public, as with any Cardano wallet.
• Making money private, and making it public again, link your public account to what you move. Each screen says what it links, and the wallet warns you before a step ties your accounts together.
• Koios sends every transaction, and giveme.my, the collateral service we run, sees every private one, both from your IP address. So they can tie your private payments and Lovejoin boxes to your public account: Seedelf and Lovejoin hide them from people reading the chain, not from the services that carry them.
• A Lovejoin box hides only among other people's boxes that come back into a Seedelf around the same time, one of up to 9 at the default depth, and fewer while few people use it.
• Privacy grows with the number of people who use Seedelf and Lovejoin, and today there are few.

Private money earns no staking rewards: it has no staking part, which is what keeps your Seedelfs from being linked together. Money that sits can stay staked in the public account, and be made private when it should move privately.

How it works:
• Everything is built and signed inside the extension. The cryptography and the transaction building are Rust, compiled to WebAssembly and shipped in the package.
• Your recovery phrase never leaves your device. It's encrypted with your password (Argon2id and ChaCha20-Poly1305).
• The wallet talks to a few services, and each sees your IP address. Koios reads the chain and submits your transactions. giveme.my, which we run, adds shared collateral to private payments, so your own address stays out of them, and sees each one. CoinGecko gives ADA's price on mainnet, unless you choose no currency. Minswap quotes and builds your swaps, only when you swap. Lovejoin is a contract on the chain, reached through Koios.
• It adds nothing to web pages unless you turn on connecting sites. Then it adds only the standard Cardano wallet entry (window.cardano) to https pages, so any https site can see you use Seedelf Wallet, as with any Cardano wallet, and it asks you before anything is signed.
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

The screenshots show the wallet on **mainnet**, as the listing's build opens, with the MAINNET badge and no test-network strip. They're made by `e2e/store-images.spec.ts` from the recorded fixtures and the public BIP39 test phrase, never a real wallet: the fake Koios answers mainnet's requests from the same recordings, writing their addresses with mainnet's prefix and network tag, and each test token stands in for one on the wallet's mainnet list (USDM and DJED). So the balances, the Seedelf paid and the pool staked with are the fixtures', not anyone's holdings, and every screen is the real UI.

**Additional fields:**

- **Homepage URL:** `https://github.com/logical-mechanism/Seedelf-Wallet/tree/main/seedelf-platform/seedelf-web-wallet`
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
| `alarms` | `Locks the wallet automatically after a time without use that the user sets (15 minutes unless changed). A one-minute alarm checks the time since the user last did something, and, while the wallet is unlocked, carries on what the user started: a swap's next step, a Lovejoin mix being sent, a Lovejoin box due back, a payment Koios didn't answer, looked for and sent again until it's settled, and a Lovejoin mix from the public account that stopped at a transaction that may have gone through, looked for until it's settled.` |
| `sidePanel` | `Lets the user open the wallet in Chrome's side panel instead of a tab, a choice in its Settings. The side panel shows only the extension's own page.` |
| `scripting` | `Adds the standard Cardano wallet entry (window.cardano.seedelf, CIP-30) to https pages, only after the user turns on "Let sites connect to Seedelf Wallet" in Settings, and removes it when they turn it off. The scripts ship in the package; the page's own content is never read. While it's on, a page can see the wallet is installed, as with any CIP-30 wallet; the user is told so before turning it on.` |
| Optional host `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | `Asked for only when the user turns on connecting sites in Settings. It lets the wallet offer itself to Cardano sites (dApps) as a CIP-30 wallet: a site can then ask to connect, and to have transactions or messages signed, each approved by the user in the wallet's own window. localhost is for sites in development. One host under it, ipfs.blockfrost.dev, is asked for on its own the first time the user presses Show image on an NFT: Blockfrost's IPFS gateway, which the image is fetched from and which sends no CORS headers. Nothing is fetched from it otherwise.` |
| Host `https://api.koios.rest/*` | `Koios is the public Cardano API the wallet reads Cardano mainnet through: the user's balances, UTxOs and staking, the stake pools and DReps, and Lovejoin's pool. It also evaluates scripts (for two reviews: creating a Seedelf paid by the public account, and a Lovejoin chain's first mix) and submits the transactions the user approves. Koios's public tier doesn't answer web pages (no CORS headers), so the wallet can reach it only with this host permission.` |
| Host `https://preprod.koios.rest/*` | `The same Koios API for Cardano's preprod test network, which the user can switch to in Settings to try the wallet with test ADA. While the wallet is on mainnet, it asks preprod only to finish what the user started there (a payment on its way, a swap, a Lovejoin mix).` |
| Host `https://www.giveme.my/*` | `giveme.my, a collateral service run by the developer (Logical Mechanism), adds shared collateral to Seedelf script transactions, on mainnet (/mainnet/collateral/) and on preprod (/preprod/collateral/). The wallet sends it each such transaction to witness, so that the user's own address never appears as collateral. It sees the transaction and the user's IP address, as the privacy policy says.` |
| Host `https://api.coingecko.com/*` | `CoinGecko's public API gives ADA's price in the currency the user chooses in Settings, on mainnet only: one request for ADA alone, when Home or the swap form opens, at most every five minutes. Choosing no currency stops it. It's never told what the wallet holds.` |

**The dashboard has one host-permission box, not one per host** (submitting v1.0.0, 2026-09-28). The rows above come to 1,694 characters together, over its ~1,000 limit, so they go in merged. What was submitted, at 988 characters:

```text
api.koios.rest is the public Cardano API the wallet reads mainnet through (balances, UTxOs, staking, pools, DReps, Lovejoin's pool); it also evaluates scripts and submits the transactions the user approves. Koios's public tier sends no CORS headers, so a host permission is the only way to reach it. preprod.koios.rest is the same API for the preprod test network, which the user can switch to in Settings. www.giveme.my is a collateral service run by the developer; it adds shared collateral to Seedelf script transactions so the user's own address never appears as collateral, and sees each one and the user's IP, as the privacy policy says. api.coingecko.com is asked only for ADA's price in the currency chosen in Settings, and is told nothing about the wallet. The optional hosts (https://*/*, localhost, 127.0.0.1) are requested only if the user turns on "Let sites connect to Seedelf Wallet" in Settings, to add the standard CIP-30 entry to https pages; page content is never read.
```

**For the next upload (chunk 20, NFT images), the box needs the gateway too**, and the text above has 12 characters to spare. This version, at 991 characters, names it by trimming the other hosts' sentences:

```text
api.koios.rest is the public Cardano API the wallet reads mainnet through (balances, UTxOs, staking, pools, DReps, Lovejoin's pool); it also evaluates scripts and submits the transactions the user approves. Koios sends no CORS headers, so a host permission is the only way to reach it. preprod.koios.rest is the same API for the preprod test network, chosen in Settings. www.giveme.my is a collateral service run by the developer; it adds shared collateral to Seedelf script transactions so the user's address never appears as collateral, and sees each one and the user's IP, as the privacy policy says. api.coingecko.com gives ADA's price in the currency chosen in Settings, and is told nothing about the wallet. The optional hosts (https://*/*, localhost, 127.0.0.1) are requested only if the user turns on "Let sites connect" in Settings, to add the CIP-30 entry to https pages. ipfs.blockfrost.dev alone is requested when the user first presses Show image on an NFT, to fetch that image.
```

The per-host rows above stay: they're the fuller answer if a reviewer asks about one. `https://*/*` is the one they question; the answer is that it's `optional_host_permissions`, never granted at install, asked for only when the user turns site connections on, and dropped when they turn them off.

**Minswap's aggregators need no host permission.** They answer extension pages with CORS headers, so only the pages' CSP (`connect-src`) names them: `agg-api.minswap.org` for mainnet and `aggr.monorepo-testnet-preprod.minswap.org` for preprod. The wallet reaches them only when the user swaps. If a reviewer asks, the same words go in the description of data use below.

**Remote code:** No, I am not using remote code.

```text
All code ships in the package, including the WebAssembly module (Rust compiled to wasm). The page CSP's 'wasm-unsafe-eval' is only there to compile that bundled module. The extension fetches data (JSON and CBOR) from Koios, giveme.my, CoinGecko (ADA's price) and, for swaps, Minswap's aggregator, and an NFT's image file from Blockfrost's IPFS gateway when the user asks to see it, never code.
```

**Data usage.** Check these two, then the two under them, and leave the rest unchecked:

- **Authentication information:** the recovery phrase and the password. The phrase is kept encrypted on the device; the password is never stored.
- **Financial and payment information:** the wallet's addresses, balances, staking and transactions, sent to Koios and giveme.my to read the chain and to send transactions. An NFT whose image the user asks to see is named to Koios and, for its image, to Blockfrost's IPFS gateway. giveme.my is the developer's own service: it receives each private transaction, with the IP address. When the user connects a site, it sees the public account's addresses, balance and UTxOs, and what the user signs for it. For a swap, Minswap's aggregator gets the one-time account's address and the tokens and amounts, and builds the swap for it. CoinGecko is asked only for ADA's price, and gets nothing about the wallet.

**Two more to decide, both recommended checked.** Google's User Data FAQ answers "Do I have to disclose data handled locally?" with *"Yes. Extensions are required to disclose how they handle user data, even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties,"* and defines *handle* as "collecting, transmitting, using, or sharing". Over-declaring costs a fuller privacy label; under-declaring is what gets an extension pulled.

- **Location — check it** (privacy review §2.5). The dashboard lists the IP address under *Location* ("region, IP address, GPS coordinates, or information about things near the user's device"). The wallet doesn't read the IP itself, but every private transaction goes to **giveme.my, which the developer runs**, so the developer's own service receives it. That is the developer handling it, not a third party's incidental logging. giveme.my's app logs leave out raw IP addresses, which limits the retention, not the receipt. (Koios, CoinGecko, Minswap and, for an NFT's image, Blockfrost's gateway see it too, but those are third parties' servers.)
- **Web history — check it** (chunk 15). Once the user turns on connecting sites, the wallet keeps a `DappSite { origin, connectedAt }` for each one: the site's address and when it was connected. It's sealed on the device and never sent anywhere, but that's the shape Google's *Web history* covers ("the list of web pages a user has visited, as well as associated data such as page title and time of visit"), and the FAQ above says local-only doesn't exempt it. It's the user's own connection list, not browsing they didn't choose — say so in the policy rather than leaving the box clear.

If either is left unchecked, write the reason here before submitting, so the next release doesn't quietly reopen it.

Then certify all three statements: no selling or transferring data outside the approved use cases, no use unrelated to the single purpose, and no creditworthiness or lending use.

**Privacy policy URL:**

```text
https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md
```

It points at `main`, and was checked to render there (200) before the listing was submitted. The wallet's own Settings link is the same URL, so the two never drift. Use the rendered `blob` link, not `raw.githubusercontent.com`: the dashboard wants a page a person can read, and raw serves `text/plain` markdown source.

## Distribution

- **Visibility:** Public, for launch. Unlisted keeps it to people with the link, for a quieter start: the owner's call.
- **Regions:** all
- **Payment:** free

## Test instructions

Paste this if the dashboard asks for test instructions:

```text
The wallet opens on Cardano mainnet, where ADA is real money. Nothing needs an account or real funds to review: everything below works on preprod, Cardano's test network.

1. Click the toolbar icon: the wallet opens in a tab.
2. On the welcome screen, under Create and Restore, set Network to Preprod. Every screen then shows a PREPROD badge and a strip saying its ADA has no value.
3. To see a wallet with test funds: choose "Restore wallet" and paste the standard public BIP39 test phrase:
   abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
   Set any password.
4. Home now shows the phrase's preprod balances. The phrase is public, so its funds are shared test ADA: never send real funds to it on mainnet.

Settings (the gear) switches the network too, under Network: it says first what the other network is.

To see an empty wallet instead, choose "Create new wallet": reveal and write down the phrase, confirm three of its words, then set a password.

The wallet contacts only Koios (api.koios.rest on mainnet, preprod.koios.rest on preprod), www.giveme.my, CoinGecko (api.coingecko.com, on mainnet, for ADA's price), for a swap, Minswap's aggregator (agg-api.minswap.org on mainnet, aggr.monorepo-testnet-preprod.minswap.org on preprod), and for an NFT's image the user asks to see, Blockfrost's IPFS gateway (ipfs.blockfrost.dev).
```

## Submitting again

- **Each upload needs a version strictly higher than the last.** Bump it at submission time, in `extension/package.json`; the manifest takes its version from there.
- **Uploading:** run the release checklist, then upload the zip on the Package tab.
- **When the UI changes,** regenerate the images: `npm run build && npm run store:images` in `extension/`.
  - `e2e/store-images.spec.ts` makes them from the test fixtures and the public test phrase, so no real wallet appears.
  - Upload the new ones.
