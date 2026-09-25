# Chunk 15 plan: dApps, starting with the public connector

**Why:** on 2026-09-25 the user set the wallet's next goal: **use smart contracts on Cardano privately.** That's the hardest part of the roadmap, so it's done in steps. The first step is what Lace already does: a CIP-30 connector for the **public account**, behind a Settings switch. After that comes a dApp browser inside the wallet, where private interactions become possible, and Minswap is the first dApp. Branch `web-wallet/dapp-connector`, one PR into `seedelf-web-wallet`.

## Status (2026-09-25)

**Built:** the public connector, the whole of *This chunk* below. Rust, worker, content scripts, the connector's window and Settings, with Rust, Vitest and Playwright tests. **Not done:** a live run against a real dApp. On preprod, a site that lists wallets from `window.cardano` will offer Seedelf Wallet. Minswap won't (see *Minswap*).

## Start here

1. `git fetch origin && git checkout web-wallet/dapp-connector`
2. Read this plan and the newest roadmap handoff note.
3. Build and test (from `extension/`): `npm run build && npm test && npm run e2e`. The WebAssembly tests: `cargo test -p seedelf-wasm` from `seedelf-platform/`.

## The steps

| Step | What | Where |
|---|---|---|
| 1 | **The public connector.** CIP-30 for the public account, the way Lace does it, off until the user turns it on in Settings. | This chunk |
| 2 | **Private sessions.** A one-time account funded from the private balance, used by a dApp, and swept back into Seedelf. The user's first design, below. | Next chunk |
| 3 | **The dApp browser.** dApps listed in the wallet. Each opens either as a site or inside the wallet, as Eternl does, and runs in a private session. Minswap first. | Next chunk, or its own |
| 4 | **Private CIP-30.** Any site connects to a private session instead of the public account, chosen per site. | After 3 |

## This chunk: the public connector

### Decided (the user, 2026-09-25)

- **The default stays private.** Sites can't see the wallet until the user turns on **Let sites connect to your public account** in Settings, under *Sites*. When it's on, CIP-30 uses the public account.
- **Like Lace:** the usual CIP-30 calls, a window to approve connecting and signing, and a list of connected sites to disconnect.

### Decided in the build

- **Nothing is added to pages while it's off. Lace differs here.** Lace declares its content scripts in the manifest for every page and asks for `<all_urls>` at install.
  - Here, the sites are an **optional** host permission (`https://*/*`, and `http://localhost` and `127.0.0.1` for dApps in development).
  - Settings asks Chrome for them from the switch's click, the only moment Chrome lets an extension ask.
  - Only then does the worker register the two content scripts (`chrome.scripting.registerContentScripts`).
  - Turning it off unregisters them and gives the access back. So does taking the access away in Chrome's own settings (`permissions.onRemoved`).
  - The install-time permissions only gain `scripting`, which shows no warning, so an update doesn't disable the extension.
- **Two content scripts, built as self-contained IIFEs** (`src/content/`, the `seedelf-content-scripts` plugin in `vite.config.ts`):
  - `cip30-page.js` runs in the page's world and defines only `window.cardano.seedelf`.
  - `cip30-bridge.js` runs in an isolated world and relays each call to the worker over a port.
  - Both run on top frames only; iframes get nothing.
  - The worker takes the site's origin from Chrome (`port.sender.origin`), never from the page.
  - While a call waits, the bridge pings every 20 s, as Lace's does, so the worker stays up during a prompt. If the worker restarts, a read is asked again once; a signing call fails.
- **The connector's window** is a 400×640 popup (`?view=dapp`), one at a time, opened or brought back by the worker (`dapp-window.ts`).
  - It shows what's waiting, oldest first. Closing it declines everything.
  - A locked wallet shows Unlock there first.
  - It closes itself 800 ms after the last answer.
- **Locked:** `isEnabled()` answers false. Every other call opens the window to unlock first.
  - This differs from Lace, which answers reads while locked. Here the wallet's data isn't readable while locked.
  - Closing the window instead of unlocking refuses the calls, and that site's reads are refused without asking for a minute, so a dApp that polls doesn't keep reopening it.
- **Connected sites are a sealed private record** (`dapps`, per network): which sites you use says something about you. Settings → *Connected sites* lists them, each with Disconnect.
- **The reads** (`getBalance`, `getUtxos`, `getCollateral`, the addresses) come from one reading of the account (`readAccountUtxos`: two Koios requests), kept 30 s.
  - They leave out what the user locked and the collateral. `getCollateral` offers only the set-aside 5 ₳ UTxO, or null, as Lace does.
  - They include what the account gets back from dApp transactions it sent that aren't on chain yet, and leave out what those spent.
  - `getUsedAddresses` puts `0/0` first: it's the address the wallet shows, and where every change goes. `getChangeAddress` is `0/0`.
  - `getUtxos(amount)` answers null when the amount can't be met, as CIP-30 says. Lace returns everything instead.
- **Signing a transaction** (`cip30.rs`, WebAssembly):
  - It reads what the transaction does to the public account: the net change, who's paid (a contract, Seedelf Wallet's contract with or without a register), the fee, the collateral at risk, minting, staking certificates and withdrawals, a CIP-20 note, and which keys sign.
  - Inputs the account doesn't hold are looked up with one Koios `utxo_info` request. Script inputs need no key, so a dApp's contract inputs don't count as someone else's.
  - Without `partialSign`, a transaction that needs anyone else's signature is refused before the user is asked (`ProofGeneration`), as is one with nothing to sign.
  - **Refused like Lace:** a collateral return to someone else, which would hand them the account's collateral.
  - **Refused, added here:** a transaction marked to fail its scripts, which would take the collateral.
  - The witness set matches the transaction's set encoding (tag 258 or not).
  - Every signed transaction's outputs to the account are kept (the last 32), so a dApp can **chain** its next transaction on them before they're on chain.
- **Signing data** is CIP-8: a COSE_Sign1 with the address in the protected header, over the payload as given, with the address's payment key or, for the reward address, the stake key. It's checked against the Cardano Foundation's `cardano-verify-datasignature` 1.0.11.
- **`submitTx`** goes through Koios like the wallet's own sends. It remembers what it spent (`spent.ts`) and drops Home's cached reading. If Koios says the inputs are spent and the transaction is on chain, that counts as a success, as in Lace.
- **Not offered:** CIP-95 (the wallet has no DRep key), and `experimental.on`/`off` events. `apiVersion` is `0.1.0`, as Lace, Eternl and Nami say.

### Koios cost

- Reads: two requests at most every 30 s while a site is connected and asking.
- `signTx`: none when the account holds every input; one `utxo_info` for inputs it doesn't hold. An input it can't find makes it read the account again first.
- `submitTx`: one; two if Koios refuses it and the wallet checks whether it's already on chain.

### Tests

- **Rust:** `wasm/tests/cip30_test.rs`, 18 tests.
  - The encodings, decoded back with Pallas.
  - A swap-like transaction's summary.
  - Signatures verified against the transaction id.
  - Partial signing, unknown inputs and script inputs.
  - Staking certificates, required signers and a legacy registration.
  - The collateral rules, the other network, and Seedelf payments.
  - COSE rebuilt and verified.
- **Vitest:** `tests/dapp.test.ts`, 10 tests, on the recorded preprod account with the real WebAssembly.
- **Playwright:** 2 tests in `e2e/extension.spec.ts`, against a dApp page at `https://dapp.example/`.
  - Off, then on. Connect, read, sign, decline, sign a message, submit, disconnect, and off again.
  - A locked wallet unlocking in the window.
  - Chrome's own permission dialog can't be answered from automation, so those tests load a copy of the build whose manifest grants the sites from install (`withSiteAccess` in `e2e/support.ts`). Everything after the dialog is the real build.

### For the user

- **Resubmit the store listing:** the new `scripting` permission, the optional host permissions, and the updated privacy policy and description in [store/README.md](../store/README.md).
  - The Privacy practices form may now need **Web history**: the list of connected sites is kept, sealed, on the device.
- Try it on preprod with a dApp that lists every CIP-30 wallet.

## Private interactions (step 2 on)

The user's two designs (2026-09-25):

1. **Round trip through a new account:** private UTxO → a paying UTxO and a collateral UTxO on a random, never-used public account → the dApp uses that account → the contract pays back to it → back into the private balance, spending both the return and the collateral.
2. **Straight from Seedelf:** private UTxO plus giveme.my's collateral → the contract → a random account → back into the private balance.

**Which one fits depends on the dApp.** giveme.my can't witness a chained transaction: it checks every input against the chain first, as found in chunk 8. So a dApp whose flow chains transactions needs design 1, and design 2 works only for a dApp that doesn't.

**What design 1 needs** (docs: [flows.md](../flows.md#contract-round-trip), [keys-and-accounts.md](../keys-and-accounts.md)):

- The one-time accounts are already specified: the reserved account `24301'`, a fresh index per session, and the shared Seedelf staking part.
- It's funded by a Make public (`sweep_many`) that pays two outputs to that account: the amount, and 5 ₳ as its own collateral. The collateral is its own because the dApp's script transactions spend that account's key UTxOs, and giveme.my can't back them.
- The dApp sees an ordinary wallet. Because it's a normal key account, chaining works: the connector's signed-output memory from this chunk carries over.
- The return is a move-in from the one-time account (key-signed, no giveme.my): the proceeds, the change and the collateral, all at once.
- **What links:** the funding spend's inputs and change link to that one account; the account links to the dApp; the return links to new Seedelf UTxOs in one transaction. Amounts and timing link too. Each screen has to say so, as for Make private and Make public.
- Wait about a block before the dApp sees the account: dApps' backends can't see unconfirmed outputs.

**What design 2 needs:**

- The wallet builds the dApp's transaction itself, from what the dApp wants paid (an address, a datum, an amount): Seedelf inputs proven under a one-time key, giveme.my's collateral, the change back into Seedelf, and the dApp's proceeds to a fresh one-time account.
- A dApp's own transaction can't simply be re-signed: swapping its inputs for Seedelf's changes the body, so any signature the dApp or its backend added breaks, and its scripts see a Seedelf input where they expect the user's.
- It fits "pay a contract with a datum" dApps with nothing to run at submission, for example a Minswap order. It doesn't fit dApps that chain, or that sign on their side.

## Minswap

Checked on 2026-09-25 against the preprod site (`testnet-preprod.minswap.org`) and its JavaScript:

- **Its wallet list is fixed:** a `WalletProvider` enum (Eternl, Lace, Typhon, Gero, NuFi, Vespr, Begin, Tokeo, OKX and a few more). It doesn't list every `window.cardano` entry, so it won't show Seedelf Wallet on its own.
- **Inside a frame, it offers only Eternl,** through Eternl's `cardano-dapp-connector-bridge` (a `postMessage` handshake with the parent page). That's how Eternl runs Minswap inside its wallet, and it connects only when the bridge says `name === "eternl"`.
- **It can be framed by an extension:** its CSP's `frame-ancestors` includes `chrome-extension:` (next to Eternl's sites and localhost).
- **It has an aggregator API,** on preprod too: `https://aggr.monorepo-testnet-preprod.minswap.org` (mainnet: `agg-api.minswap.org/aggregator`). `estimate`, `build-tx` (an unsigned transaction for a sender's address), `pending-orders` and `cancel-tx`. This is how wallets build swaps into themselves.

**The choice for the next chunk (the user's):**

- **(a) In-wallet swaps through the aggregator.** The wallet builds and signs the swap itself. It works with a one-time account, and with design 2 for a plain order. No framing, and no need to be on Minswap's list.
- **(b) Minswap inside the wallet, in a frame, as Eternl does.** It needs Minswap to accept Seedelf Wallet in its bridge and list. Answering as "eternl" would be pretending to be another wallet, which this plan doesn't propose.
- **(c) Minswap in a normal tab with a private session.** It needs Minswap's wallet list too.
- Asking Minswap to add Seedelf Wallet helps (b) and (c), and the public connector (this chunk) too.
