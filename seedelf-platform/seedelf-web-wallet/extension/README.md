# Seedelf Web Wallet: extension

The Chrome (MV3) extension: React + TypeScript + Vite, with the Rust core loaded as WebAssembly in the service worker.

It can create or restore a wallet, lock it with a password, and show what the wallet holds, on its two sides: the private balance (Seedelf's) and its Seedelfs, and the public account (the Cardano account). It runs every v1 flow: make private (move in), create a Seedelf, send privately (to Seedelfs), make public (withdraw), remove a Seedelf, and send publicly. Beside them: staking and voting, being your own DRep, the dApp connector (CIP-30, with CIP-95 for governance), private sessions for dApps (Minswap's swaps, and private CIP-30) and Lovejoin (its classic 10 ₳ pool, and pools of one token each, or of ADA at another amount, that anyone can start), payments too large for one transaction sent in parts, several public accounts, the transaction view, NFT images, and English, Spanish and Japanese. The look is Lace's dark mode in Seedelf's colours ([architecture.md](../docs/architecture.md#ui)).

## Screens

| Screen | When | What it does |
|---|---|---|
| Welcome | No wallet yet | **Create new wallet** or **Restore wallet**. From the side panel, both open a full tab. |
| Create | Onboarding | Shows a new 24-word phrase (hidden until **Reveal**), asks for 3 of its words, then a password |
| Restore | Onboarding | 12, 15 or 24 words, one box each with BIP39 autocomplete; pasting a phrase fills every box. Then a password. |
| Unlock | Locked | Password (with Show), the back-off countdown after wrong attempts, and "Forgot password? Restore from your phrase" |
| Restore from your phrase | From Unlock | Deletes the wallet after typing `delete wallet`, then goes to Restore |
| Home | Unlocked | Two tabs. **Private:** the private balance with round **Receive** (your Seedelfs' names), **Send** (to Seedelfs), **Make public** and **Create** (a Seedelf); the first five tokens and **View all**; **Swaps in progress** and what's **In Lovejoin**, when there are any; and **dApps**. **Public:** the public account with **Receive**, **Send** and **Make private**, tokens, the **Staking and governance** row (the pool, the rewards, and where the voting power goes), and **dApps**. Until the first reading arrives, a splash covers it. A new wallet gets *Get started* (fund, create, make private). Refresh sits under the tabs, and a sent transaction shows as a banner until it confirms. The eye beside each balance hides the amounts; on mainnet, each balance's value in the chosen currency sits under it. An ADA Handle in the private balance gets a warning. The lock button is in the top bar; with more than one public account, the Public tab's heading is the account picker ("Public account 2 ▾"). |
| UTxOs | The row under Activity on each Home tab | That balance's UTxOs from the last reading, kept ones first (locked, the collateral, a Seedelf's). A lock at the end of each row toggles it at once; the row opens its tokens, transaction, output and address, with **Lock** or **Unlock** too. A locked UTxO is left out of every payment, Max included. No requests, except **Refresh** (Home's). |
| Collateral | Settings | The public account's 5 ₳ collateral, after Lace's: who set it, **Reclaim collateral**, or **Set collateral** (from a 5 ₳ UTxO it holds, or a 5 ₳ payment to itself, reviewed first). A payment still waited for 10 minutes on offers **Pay it again anyway**. |
| Activity | The row near the bottom of each Home tab | Newest first, grouped by day; an entry opens its details (its tokens, and on the public side its staking and its note) and Cardanoscan. **Private:** from the device, encrypted, no requests. **Public:** 20 at a time from the data layer or Koios, with Load more, staking changes included, and Lovejoin's transactions and the payment that set the collateral named as such. **Refresh** reads again without going back to Home. **Save as CSV** saves what's listed to a file. |
| Settings | The gear in the top bar | The **Network** (in a build with mainnet; on mainnet, **Read Cardano through Koios only**, with a light and a line saying which server the wallet is using), **Public accounts**, **Contacts** (add, edit, delete; encrypted on the device), **Collateral** (see it, set it, reclaim it), the **Language**, where the wallet opens (a full tab or the side panel), ADA's value in a currency (mainnet), **Sites** (the dApp connector's switch, the account sites use, the password to sign, and **Connected sites**), **Lovejoin** (whether private sessions come back through it, and how, whether a session's 5 ₳ collateral is mixed there, *Four boxes a mix*, and **Bring every box back now**), spending the staking rewards, **Lock after**, **Show recovery phrase** (the password again first), **Check recovery phrase** (a written copy: yes or no), **Change password**, **Remove wallet** (typed confirmation), and About: the version, the network, links to the source and the privacy policy |
| Tokens | From **View all** | One balance's tokens and NFTs in two tabs, with a search and a sort. A token opens a modal with its amount, policy ID, asset name and fingerprint, each with Copy; an NFT's has **Show image**, which fetches that one image from IPFS through Blockfrost's gateway, and only when asked. Tickers and logos come from the wallet's own token list. |
| Receive | From the Public tab | The receive address as a QR code and text, with copy, the account's ADA Handles, and the stake address |
| Receive (private) | From the Private tab | Your Seedelfs: each by its tag, with the ADA locked with it, Copy and Remove, and its whole name on one line (cut in the middle when it doesn't fit). With none yet, a way to create one. |
| Make private | From the Public tab | An ADA amount or Max, and tokens to bring along, picked with **Add tokens** (a search), each in any amount or its Max. With tokens the amount can stay empty, and only the ADA they need moves; less than that is raised to it. Then a review of what moves, the fee and the change (and a note when the amount is that minimum); then Send |
| Send (public) | From the Public tab | Up to 20 recipients, each an address, `$handle` or Seedelf, or one of **Your accounts**, read as it's typed, with a note if it's your own. An ADA amount or Max, and tokens, with the minimum worked out as for a move-in, and an optional note (CIP-20, 64 characters, public). Then a review of where it goes, what's sent, the note, the fee and the change, then Send. The account's keys sign at review; no giveme.my. |
| Send (private) | From the Private tab | Up to 20 recipients. Paste each one's full Seedelf name: it's looked up in the wallet contract and shown ("Found: tag · 5eed0e1f…"), with a warning if it's your own. An ADA amount, and optionally part of any token (the minimum worked out as for a move-in), or Max to one Seedelf (every UTxO's ADA, 20 a transaction). Then a review of the recipient, what's sent, the fee and the change, then Send, when giveme.my is asked for the collateral. Too much for one transaction goes as several, one after another, and the review says how many. |
| Make public | From the Private tab | Up to 20 addresses or `$handle`s, or **Your accounts**, read as they're typed, with a warning if one is your own public account. An ADA amount and optional tokens (the minimum worked out as for a move-in), or Max (every UTxO, 20 a transaction, every token). Then a review of where it goes, what's sent, the fee and the change, then Send, when giveme.my is asked for the collateral. Too much for one transaction goes as several, as private Send's does. |
| Remove a Seedelf | From a Seedelf's card in Receive, under **Manage** | Where its freed ADA goes: the public account (the default) or the private balance, each with a note on what it links. Then a review of what comes back and the fee, then Send. |
| Create a Seedelf | From Home | An optional tag (printable ASCII, 15 at most) with a live preview, and what pays: the public account (the default: mint first, then make private) or the private balance (a stealth mint). Then a review of the token name, the ADA locked with it, the fee and the change, then Send. The account's keys sign at review; for a stealth mint, Send is when giveme.my is asked for the collateral. |
| Transaction details | **Transaction details** on every review, and in the connector's window | The transaction about to be signed, decoded from its own CBOR: inputs, outputs, datums, scripts, certificates, votes, redeemers and metadata, with a **Raw CBOR** tab. No requests. |
| Staking and governance | The **Staking and governance** row on the Public tab | The pool the public account stakes with, its rewards with **Withdraw rewards** and **Rewards history**, **Voting power**, **Change pool**, **Delegation history** and **Stop staking**, and the account's DRep card: **Be your own DRep** until it is one, then **Your DRep**. Every change is reviewed here before Send. Opening it reads the pool and the DRep fresh: two requests, or three. **Pool details** shows the pool's figures and its return on stake, read the first time it unfolds (one request). |
| Choose a pool | **Choose a pool** or **Change pool** on Staking | Every live pool, searched by ticker or pool ID and sorted by ticker, saturation, margin, cost or pledge, kept on the device for a day; a ticker other pools use too is flagged. A pool opens its details and its **Return on stake**, what each ADA staked with it earned over its last 18 epochs, with each epoch's under **Recent epochs** (two requests), and **Stake with** builds the delegation for review. |
| Voting power | **Delegate** or **Change** under Voting power on Staking | **Always abstain**, **Always no confidence**, **Your own DRep**, or **A DRep**: searched by name or ID in the wallet's own list, or pasted by ID, then looked up live (two requests). Conway pays no rewards until the vote is delegated, so Home and Staking send you here while rewards are locked. |
| Become a DRep | **Become a DRep** on Staking's DRep card | Registers the public account as a DRep, its voting power delegated to it by default, with a profile only if you want one: the wallet writes the file and its hash, you publish it, and the wallet never fetches it. Then **Profile** changes or removes it, and **Retire as a DRep** gives the deposit back. Each is reviewed on Staking. |
| Governance actions | **Governance actions** on Staking's DRep card | The live governance actions, newest proposed first, and a DRep's vote on each; one opens its details and, for a DRep, **Vote**: **Yes**, **No** or **Abstain**, reviewed on Staking. Two requests, or three for a DRep; the list itself is kept on the device for an hour. |
| Rewards history | **Rewards history** on Staking, under the rewards while the stake key is registered, or under *Not staking* when it isn't but was paid | Every reward the stake key was paid: what's been paid in all, **Next epoch**'s when they're listed and the key is registered, then each year with its total, newest first, 50 rows at a time with **Show more**. A row is its epoch's day and who paid it: the pool by its ticker when the device knows it, an operator's reward, a deposit back, the reserves or the treasury. Read fresh each time it opens (a request per 1,000 rewards) and kept nowhere; no pool is asked about. |
| Delegation history | **Delegation history** on Staking, above Stop staking while the stake key is registered, or alone when it isn't but was paid | Every change to the stake key, newest first, by year, 50 rows at a time: registered (the 2 ₳ deposit), staked with a pool, the voting power delegated, and stopped (the deposit back); withdrawals are in Public activity. A row opens its details, with the transaction on Cardanoscan. Read fresh each time it opens (two requests for nearly every account) and kept nowhere; no pool is asked about. |
| dApps | The **dApps** row on either Home tab | Tiles for the dApps the wallet uses privately, from one-time accounts funded from the private balance: **Minswap** and **Lovejoin**. Under them, **Sites**: whether sites can see the wallet (with **Let sites connect**), a declined site's wait (with **Let it ask now**), and every connected site: the public account's with **Disconnect**, a private session's opening its page. While sessions still hold something, **Bring everything back**. At the foot, **After a restore**: the sessions a restore's scan found, each opening its page, and **Find leftovers**, which scans again (it asks the server about the one-time accounts 20 at a time, and says so first), and which it points to while a restore hasn't finished looking on that network. |
| Swaps | The Minswap tile, or Home's **Swaps in progress** | **New swap**, in a private session: a one-time account is funded from the private balance, Minswap's aggregator builds the swap, and after one approval it runs by itself: the order, the fill, and everything back into the private balance, through Lovejoin by default. A swap can be stopped, and what it holds comes back. |
| Lovejoin | The Lovejoin tile, or Home's **In Lovejoin** | Lovejoin's pools, ADA's first: the classic one of 10 ₳ boxes, and pools of one token each, or of ADA at another amount, each with its crowd. A pool's page has the wallet's boxes in it, found by the Seedelf key, when each is due back, and **Bring one back now**. **Mix** puts ADA or the pool's token in, in its boxes, from the private balance or the public account, and **Mix my boxes again** mixes them further, each with its own **Four boxes a mix**. **Help start the pool** (a Bootstrap) puts boxes in for others to mix with, held until brought back by hand. **Bring every box back now** takes that pool's. On mainnet a pool mixes only once it holds 30 boxes that aren't yours. **Start a pool**: of a token on the wallet's list, or of ADA at any amount but 10 ₳, for about 23 ₳ that never comes back. |
| A site's private session | A site under the dApps page's **Sites** | What its one-time account holds, **Top up** (another payment from the private balance), **Bring it back** (everything at the account into the private balance; the site stays connected), and **Disconnect** once it's empty. |
| Bring everything back | The dApps page | Every private session that holds something, back into the private balance, each in its own transaction signed by its own key. |
| Public accounts | Settings | The public accounts the phrase has used: **Switch to it**, **Name it** or **Rename**, **Look for the next account** (one request), or an account number of your own with **Check it** (one request) or **Add it** (none). Past eight accounts, a search by number or name. |
| Connected sites | Settings → Sites | Each site connected to the public account or a private session, since when, and whether it has governance (CIP-95), with **Disconnect**. |
| The connector's window | A site that needs you, while the connector is on | One request at a time, oldest first: **Connect a site** (to the public account or a private session, and **Give it governance too (CIP-95)** when the site asks), **Sign a transaction** (what it does to the account, with **Transaction details**), or **Sign a message** (CIP-8). Nothing is signed until **Sign**, with the password unless Settings says otherwise; closing the window declines everything. |

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
3. Click the toolbar icon: the wallet opens in a tab, or in the side panel once Settings says so.

After a rebuild, press the reload arrow on the extension's card.

- **Stable ID:** the dev key in `src/manifest.ts` pins the ID to `jfekiogplaamnceifeehipmomhojngcb`, so the extension's storage survives moving the folder.
- **Web Store builds** set `VITE_STORE_BUILD=true` to leave that key out. `npm run package` makes one and zips it (see [the release checklist](../docs/development.md#releasing-to-the-web-store)).
- **Networks:** every build has mainnet and preprod, mainnet by default. The welcome screen asks which before a wallet is created or restored, and Settings switches between them. A wallet from before the switch stays on preprod. `VITE_ENABLE_MAINNET=false` makes a preprod-only build, for tests.

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | WASM plus the extension (`build:wasm`, then `build:ext`) |
| `npm run build:store` | The store's build: both networks and `VITE_STORE_BUILD=true`, so no dev key (Chrome or the store picks the ID) |
| `npm run build:store:preprod` | The same, preprod only (`VITE_ENABLE_MAINNET=false`), for tests |
| `npm run tokens` | Rebuilds the wallet's token list (`src/tokens/registry.<network>.json`) from `src/tokens/list.json` and the Cardano token registry, through Koios. Run at each release. |
| `npm run dreps` | Rebuilds the wallet's list of named DReps (`src/dreps/<network>.json`) from Koios, for the vote page's search. Run at each release. |
| `npm run lovejoin-pools` | Rebuilds the Lovejoin pools' head start (`src/lovejoin-pools.json`): every shown pool on each network, read from Lovejoin's holder through the real Koios under the token list, so a new install's first look for pools starts there (`tests/lovejoin-pools-head-start.test.ts`, writing). Run at each release, after `npm run tokens`. |
| `npm run package` | The store's build (mainnet, with preprod in Settings), plus `licenses/THIRD-PARTY.txt`, zipped reproducibly into `release/seedelf-wallet-<version>-mainnet.zip` for the Web Store (`scripts/package.mjs`, `scripts/third-party.mjs`). It refuses a build without mainnet's hosts. |
| `npm run package:preprod` | A preprod-only store build, zipped as `-preprod.zip`, for tests. Never uploaded. |
| `npm run dev` | Rebuilds the extension into `dist/` on change (development mode, with source maps) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: the manifest, SecretBox against independent vectors, the wallet state machine, the Koios and giveme.my clients, the balance scan over recorded preprod responses, move-in, mint, transfer and withdraw (measured in the wallet, against real preprod fees), staking and governance, several accounts, the dApp connector, private sessions and swaps, Lovejoin, the transaction view, NFT images, the handlers (all with the real WASM and the shared vectors), formatting, and the translations' gates (`i18n*.test.ts`, `words.test.ts`) |
| `LIVE_KOIOS=1 npx vitest run tests/live.test.ts` | Optional: the balance scan against the real preprod Koios. Skipped otherwise, so CI stays offline. |
| `npm run e2e` | Playwright: loads `dist/` into Chromium and drives onboarding, lock and unlock, the back-off, reset, a browser restart, balances, move-in, creating a Seedelf, sending to one, withdrawing, and removing one; and Tokens and an NFT's image, several accounts, contacts, Activity, UTxOs, collateral, sends from the public account, the transaction view, private swaps, Lovejoin, staking, governance, Settings, the dApp connector, and the mainnet build's network switch. Koios (and Ogmios through it), giveme.my, Minswap's preprod aggregator and the IPFS gateway answer from fakes over the recorded fixtures, a test dApp is served at `https://dapp.example/`, and every other host is blocked. Since only giveme.my's real key can sign, the Seedelf-spend tests (stealth mint, transfer, withdraw, remove) stop at Send: it checks that a forged witness is refused and nothing is submitted. Screenshots of every screen land in `test-results/`, the side panel's as `panel-*.png`. The tests read the extension's ID from its worker, so they run on a dev or a store build. Run `npm run build` first. The first time, run `npx playwright install chromium`. |
| `npm run e2e:data` | Mainnet through the data layer's fake (`e2e/data-layer.ts`), each part falling back to the Koios fake: a build with `VITE_DATA_ORIGIN=https://data.seedelf.test`, then `e2e/data-layer.spec.ts`, as CI runs it. It writes that build to `dist/`: run `npm run build` again for everyday use. |
| `npm run store:images` | The Web Store's screenshots, five in each language the wallet speaks (English's in `../docs/store/images/`, Spanish's and Japanese's in its `es/` and `ja/`), and the small promo tile and store icon. It uses the fixtures and the public 12-word test phrase (`e2e/store-images.spec.ts`). Run a build first. The Japanese ones need a Japanese font on the machine, or Chromium draws boxes. |
| `node e2e/live/run.mjs all` | Live preprod runs of the built extension with nothing intercepted. Every flow, in one browser session: mint (account), move in, a stealth mint, a transfer, a withdrawal, a removal. Each submits a real transaction from the test wallet in `.preprod-test-wallet.txt` (gitignored) and waits for it to confirm. It puts the wallet on preprod first, so `npm run build`'s build serves. Single flows work too: `run.mjs mint live-1 account + move-in 25.5`. See `e2e/live/flows.mjs`. |

## Layout

```text
src/
  manifest.ts           manifest.json, generated at build time (network flag, CSP, dev key, icons), and _locales (the store's summary)
  networks.ts           what each network reaches (the data layer, Koios, giveme.my, CoinGecko, Minswap, Lovejoin), the
                        IPFS gateway, epochs
  shared/rpc.ts         typed request/response messages between the UI and the worker
  shared/password.ts    the password rule and strength hint (UI and worker)
  shared/label.ts       the Seedelf tag rule and token-name preview (the worker's WASM enforces it too)
  shared/seedelf-name.ts  what a whole Seedelf name is (UI and worker)
  shared/histories.ts   where each private UTxO's money came from, so selection keeps histories apart where it
                        can, and a review says what a spend ties together
  shared/dapp.ts        the dApp connector (CIP-30), shared by the content scripts, the worker and the UI
  shared/preferences.ts, open-in.ts, handles.ts, recipients.ts, fingerprint.ts
                        the settings and what each may be; tab or side panel; ADA Handles; how many recipients;
                        a token's CIP-14 fingerprint
  content/              page.ts (`window.cardano.seedelf`, in the page's world) and bridge.ts (its way to the
                        worker), registered only while the connector is on
  i18n/                 core.ts (i18next, bundled; the worker's too), index.tsx (the screens' half), translations/
                        (en.json, es.json, ja.json, and index.ts, which registers them)
  background/
    sw.ts               service worker entry: listeners, the auto-lock alarm
    wallet.ts           wallet state, lock, auto-lock and unlock back-off
    accounts.ts         the phrase's public accounts, and which one the wallet is working on
    account.ts          reading a public account: every UTxO under its payment keys
    balances.ts         the balance reading: contract scan, account discovery, session cache
    contract-scan.ts    the wallet contract, read in full only when due, otherwise from the last block seen
    activity.ts         Activity on both sides, at as few Koios requests as it can
    coin-control.ts     locked UTxOs and the public account's collateral
    move-in.ts          build (in WASM), hold and submit a move-in
    script-spend.ts     the flow every Seedelf spend shares: build and measure in WebAssembly, keep until Send, giveme.my, sign, submit
    parts.ts            a payment in several transactions: a part with no ADA of its own sent once the one before lands
    mint.ts             create a Seedelf, paid by the account (signed at review) or stealth (giveme.my and sign at Send)
    minted-by.ts        who paid for each Seedelf, so Remove defaults to that side
    transfer.ts         find a Seedelf by its full name, then build and send a payment to it
    send.ts             Send from the public account: addresses, ADA Handles and Seedelfs, with an optional note
    withdraw.ts         withdraw to addresses or ADA Handles, and remove a Seedelf
    destination.ts      where a payment goes (an address or an ADA Handle), flagged when it's your own
    staking.ts          staking and vote delegation, and the DRep's certificates and votes
    governance.ts       the account as its own DRep: where it stands, the live governance actions, its votes
    pending.ts          the submitted transaction being watched, until it confirms
    spent.ts, sent-txs.ts  what this wallet has spent, and what it sent in the last few minutes, whole
    incoming.ts         what the wallet's own transactions on their way pay back to it, before the chain shows it
    short.ts            core's NotEnough (a payment its inputs can't pay for) in the user's words
    collateral.ts       the giveme.my client
    koios.ts, chain.ts  the Koios client; pure helpers (registers, gap limit, sums, Seedelf tags)
    data-layer.ts       mainnet's own data layer, read first, each part falling back to Koios on its own
    private-index.ts    the data layer's private index: the contract and Lovejoin's pool, the same for whoever asks
    feed.ts             private watches on that index's feed, in place of tx_status
    prices.ts           ADA's value in a currency, from CoinGecko (mainnet only)
    nft-image.ts        an NFT's image, when asked for: its metadata from Koios, the image from IPFS
    dapp.ts             the dApp connector (CIP-30, CIP-95) for the public account or a site's private session
    dapp-window.ts, connector.ts  the connector's window; its content scripts, registered only while it's on
    sessions.ts         private sessions: one-time accounts, Minswap's swaps, and bringing them back
    minswap.ts          Minswap's aggregator API
    lovejoin.ts         Lovejoin, the mixer
    lovejoin-pools.ts   the pools beside the classic one, found at Lovejoin's holder: the data layer's list, or Koios's
    lovejoin-launch.ts  starting a pool: one transaction makes the whole pool
    runs.ts             the worker's own runs: swaps, chains, Lovejoin's boxes, a payment that may have gone through
    tx-view.ts, cbor.ts the transaction view's bytes (decoded in WASM); just enough CBOR to read inputs and an id
    contacts.ts         Contacts, in the private store
    preferences.ts      the user's settings, in chrome.storage.local
    private-store.ts    records that say something about the user, sealed on the device
    vault.ts            the vault record in chrome.storage.local
    secret-box/         SBV1 encryption, adapted from Lace (Apache-2.0)
    handlers.ts         one handler per request
    ui-port.ts          the UI's requests, each on a port only the worker listens to
    storage.ts, wasm.ts chrome.storage wrapper, lazy WASM init
    storage-access.ts   storage closed to content scripts
  ui/
    App.tsx             shell: top bar, picks the screen from the worker's status
    main.tsx, background.ts  the page's entry; the UI's side of the RPC
    accounts.tsx        which public account the wallet is working on, for every screen
    preferences.tsx     the user's settings, for every screen (hidden balances among them)
    view.ts, network.ts a full tab, the side panel or the connector's window; the network, for the token list
    screens/            Onboarding, Create, Restore, Unlock (and reset), Home, Tokens, Receive, MoveIn,
                        CreateSeedelf, Transfer, CardanoSend, Withdraw, RemoveSeedelf, Utxos, Collateral, Settings,
                        Activity, Staking, Rewards, Delegations, Pools, Voting, Governance, Dapps, Swaps, Lovejoin,
                        LovejoinLaunch (Start a pool), SiteSessions, ClaimAll, ConnectedSites, DappApprovals (the
                        connector's window)
    components/         Screen (every flow's layout), Splash, Tabs, Modal, TokenList, ReviewRows, Callout,
                        ActionButton, Choice, PhraseInput (per-word autocomplete), PhraseGrid, SetPassword,
                        PasswordField, AdaInput, AmountField, TokenAmounts, CopyField, CopyButton, QrCode,
                        Icons (Lucide), TxDetail (the transaction view), PlutusTree, NftImage, Hint,
                        AccountPicker, AccountRecipients, Destination, Recipients, Contacts, Clearable,
                        HistoriesNote, HandleWarning, LeftOut, PaidRows, SessionLeft, LovejoinReturn,
                        BuildStage, PendingBanner, TxBanner, RefreshRow, LockCountdown, MiddleEllipsis,
                        ExplorerLink, NetworkBadge, NetworkPicker, GivemeNote, RadioCards, ReviewTotals,
                        SessionRefused, StaleReview, PoolAvatar, BringAllBack (Bring every box back now),
                        SendButton (a review's Send, "Building…" while it's built again)
    styles.css          the design tokens, then every style
    format.ts           ADA and token amounts, token names
    tokens.ts           tokens as the lists show them: the token list's ticker and logo, NFT or not, sort, search
    activity.ts         how Activity names what happened, and its CSV
    dreps.ts            the DReps the wallet knows by name, searched on the device
    dapp.ts             the connector window's words for a site's transaction
    lovejoin-pools.ts   Lovejoin's pools as the screens show them: what a box holds, the hub's order
    swap.ts             the swap form's arithmetic
    nft-images.ts       the NFT images shown, kept in this page's memory until the wallet locks
    history.ts          the browser's Back as the screen's own Back
    sites.ts            the sites switch, shared by Settings and the dApps page
    delete-phrase.ts, sentence.ts  the words typed to delete the wallet; a message's full stop in any language
  tokens/               list.json (the tokens the wallet knows by name) and registry.<network>.json (npm run tokens)
  dreps/                <network>.json: the registered DReps with a name, for the vote page's search (npm run dreps)
  lovejoin-pools.json   the Lovejoin pools' head start: every shown pool on each network (npm run lovejoin-pools)
public/                 icons and logos resized from ../brand; fonts/ (Inter); licenses/ (Inter's OFL, Lucide's ISC)
tests/                  Vitest (vectors/: independent SecretBox vectors; fixtures/: recorded preprod Koios responses
                        and synthetic owned UTxOs, remade by fixtures/record-koios.mjs; a stealth mint's real preprod
                        evaluation and giveme.my answer, remade by fixtures/record-mint.mjs; an account-paid mint's
                        real preprod evaluation, remade by fixtures/record-account-mint.mjs; a transfer's real
                        preprod evaluation and giveme.my answer, remade by fixtures/record-transfer.mjs; withdrawals
                        and a removal's real preprod evaluations, remade by fixtures/record-withdraw.mjs; the staking
                        answers (account_info, every live pool, pools and DReps), remade by fixtures/record-staking.mjs;
                        Activity's, governance's, NFT metadata's, the rewards history's and the delegation history's
                        answers, remade by record-activity.mjs, record-governance.mjs, record-nft-images.mjs,
                        record-rewards.mjs and record-delegations.mjs;
                        Lovejoin's preprod pool and a Minswap quote;
                        fixtures/probe-staking.mjs, probe-governance.mjs and probe-note.mjs check the staking, DRep
                        and noted transactions against preprod, keeping nothing)
e2e/                    Playwright: support.ts (launch, the fake Koios, shared steps), extension.spec.ts,
                        store-images.spec.ts, data-layer.spec.ts with its fake (data-layer.ts); live/ holds the live
                        preprod runs
scripts/                package.mjs (the store zip), third-party.mjs (the licence notices), tokens.mjs (the token list),
                        dreps.mjs (the DRep list), i18n-critical.mjs (which translation keys are accuracy-critical)
release/                the store zip (gitignored)
```

See [../docs/](../docs/) for the design, especially [architecture.md](../docs/architecture.md) and [development.md](../docs/development.md).
