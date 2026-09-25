# Chunk 15 plan: dApps, starting with the public connector

**Why:** on 2026-09-25 the user set the wallet's next goal: **use smart contracts on Cardano privately.** That's the hardest part of the roadmap, so it's done in steps. The first step is what Lace already does: a CIP-30 connector for the **public account**, behind a Settings switch. After that comes a dApp browser inside the wallet, where private interactions become possible, and Minswap is the first dApp. Branch `web-wallet/dapp-connector`, one PR into `seedelf-web-wallet`.

## Status (2026-09-25)

**Built:** the public connector, the whole of *This chunk* below. Rust, worker, content scripts, the connector's window and Settings, with Rust, Vitest and Playwright tests. Committed as fe8b774; the user chose to keep building on this branch and open one PR at the end. **Step 2 built:** a swap through Minswap in a private session (*Step 2*, *Built*). **Fixed after:** the connector's off state took the wallet's own Koios access with it, which Koios's CORS change on 2026-09-25 made fatal (*Koios and CORS*). **Not done:** a live run against a real dApp. On preprod, a site that lists wallets from `window.cardano` will offer Seedelf Wallet. Minswap won't (see *Minswap*).

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
- **The password at Sign (the user, after trying it on Minswap's preprod site):** a site's transaction or message needs the password typed in the window, even while the wallet is unlocked, as Lace and Eternl ask. It's on by default, with a switch under *Sites* to turn it off. It asks even right after an unlock: sites call `enable()` first, so the unlock can't be tied to the signature that follows.

### Decided in the build

- **Nothing is added to pages while it's off. Lace differs here.** Lace declares its content scripts in the manifest for every page and asks for `<all_urls>` at install.
  - Here, the sites are an **optional** host permission (`https://*/*`, and `http://localhost` and `127.0.0.1` for dApps in development).
  - Settings asks Chrome for them from the switch's click, the only moment Chrome lets an extension ask.
  - Only then does the worker register the two content scripts (`chrome.scripting.registerContentScripts`).
  - Turning it off unregisters them. So does taking the access away in Chrome's own settings (`permissions.onRemoved`).
  - **Changed on 2026-09-25: off keeps Chrome's access to sites.** The first build gave it back (`chrome.permissions.remove`), at every start while off. Chrome's remove of `https://*/*` also removes every https host under it, the required Koios and giveme.my grants included. Once Koios stopped sending CORS headers to its public tier the same day, every Koios POST failed with a CORS error. See *Koios and CORS* below.
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
- **A dApp that polls all day** would reach Koios's public-tier allowance: two requests every 30 s is 5,760 a day, and the tier gives each IP address 5,000. The reads are kept 30 s; a longer keep, or a pause while the site's tab is hidden, is the lever if that shows up.

### Koios and CORS (2026-09-25)

- **What broke:** every Koios POST from the extension failed with "No 'Access-Control-Allow-Origin' header is present". GETs worked.
- **Two causes together:**
  - **Koios changed its public tier** that day: its answers carry no `Access-Control-Allow-Origin` any more, only its preflights do. Its [tiers page](https://koios.rest/tiers.html) now lists CORS as "Restricted" without an API key and "Open" with one. Checked with curl from several origins; none got the header.
  - **The connector, off, removed `https://*/*`** at every start (`chrome.permissions.remove`), and **Chrome's remove takes every host under the pattern**, so the required Koios and giveme.my grants went with it. Checked with a two-line test extension: the grants are `[]` after the call. Without the grant, the extension's requests fall under CORS. Before Koios's change, Koios's own CORS header had hidden this.
- **Fixed:** off unregisters the scripts and keeps Chrome's access (`connector.ts`). A browser restart, or reloading the unpacked extension, gives an affected profile its grants back.
- **The case left, a user limiting the wallet's site access in Chrome,** takes the Koios grant too. The Koios client then says so instead of blaming the connection (`KOIOS_NOT_ALLOWED`, not retried), and the wallet's page shows **Ask Chrome again** (`ServiceAccess` in `App.tsx`). Chrome accepts `permissions.request` for a required host it no longer grants, and shows its dialog.
- **No API key (the user, 2026-09-25):** the wallet stays on the public tier, whose limits are per IP address, so each user is on their own. A key shipped in the extension would leak, and every user would share its one allowance; a server holding the key is the only way around that, which the user would rather not run. See [architecture.md](../architecture.md), *Koios's public tier*.

### Tests

- **Rust:** `wasm/tests/cip30_test.rs`, 18 tests.
  - The encodings, decoded back with Pallas.
  - A swap-like transaction's summary.
  - Signatures verified against the transaction id.
  - Partial signing, unknown inputs and script inputs.
  - Staking certificates, required signers and a legacy registration.
  - The collateral rules, the other network, and Seedelf payments.
  - COSE rebuilt and verified.
- **Vitest:** `tests/dapp.test.ts`, 10 tests, on the recorded preprod account with the real WebAssembly. `tests/koios.test.ts` gained one: Chrome withholding Koios's host gives `KOIOS_NOT_ALLOWED`, with no retries.
- **Playwright:** 3 tests in `e2e/extension.spec.ts`.
  - Two against a dApp page at `https://dapp.example/`:
    - Off, then on. Connect, read, sign, decline, sign a message, submit, disconnect, and off again.
    - A locked wallet unlocking in the window.
    - Chrome's own permission dialog can't be answered from automation, so these load a copy of the build whose manifest grants the sites from install (`withSiteAccess` in `e2e/support.ts`). Everything after the dialog is the real build.
  - One on the plain build, where the sites are optional as shipped: turning the connector off keeps the Koios and giveme.my grants, and with them gone, the notice and **Ask Chrome again** show. It fails on the first build's `connector.ts`.

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

- The one-time accounts are already specified: the reserved account `24301'`, a fresh index per session, and (since 15b) each session's own stake key `2/i` rather than the shared Seedelf staking part.
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

**Checked when working out (a)'s steps (2026-09-25):**

- **The aggregator's `build-tx` takes only a `sender`** (with `min_amount_out` and the estimate). It chooses the sender's UTxOs from its own view of the chain, and the proceeds and any refund go back to the sender: there's no receiver, datum, change address or input list ([docs](https://docs.minswap.org/developer/aggregator-api)). So a swap through it needs a key address to be the sender: a one-time account (design 1), funded and confirmed before `build-tx`. It can't spend from Seedelf, or pay into it.
- **Minswap V2's own orders can pay a contract** (`minswap-dex-v2`, `lib/amm_dex_v2/order_validation.ak`, `validate_order_receiver`): the success and refund receivers can be script addresses, with `EODInlineDatum { hash }`, and the batcher must pay them with exactly that inline datum. So an order built by the wallet could send its proceeds straight into Seedelf's contract under a fresh register, with no return step. Minswap's SDK (`dex-v2.ts`) puts the datum itself on chain in an extra output, for the batcher to look up by hash.
  - Cancelling: the order's `canceller` signs (`OAMSignature`), or, with an expiry set, anyone may cancel it after that for a tip (the SDK's default is 0.3 ₳) and the funds go to the refund receiver. The order deposit is 2 ₳.
  - This covers only Minswap V2's own pools, not the aggregator's routing.
  - **Not tried:** whether Minswap's batcher fills an order whose receiver is a contract. Only a preprod swap can show it.

**The choice for the next chunk (the user's):**

- **(a) In-wallet swaps.** The wallet builds and signs the swap itself: through the aggregator from a one-time account (**A1**), or as a Minswap V2 order it builds straight from Seedelf (**A2**, design 2). No framing, and no need to be on Minswap's list. **Chosen: A1** (see *Step 2* below).
- **(b) Minswap inside the wallet, in a frame, as Eternl does.** It needs Minswap to accept Seedelf Wallet in its bridge and list. Answering as "eternl" would be pretending to be another wallet, which this plan doesn't propose.
- **(c) Minswap in a normal tab with a private session.** It needs Minswap's wallet list too.
- Asking Minswap to add Seedelf Wallet helps (b) and (c), and the public connector (this chunk) too.

## Step 2: private sessions, and swaps through them

### Decided (the user, 2026-09-25)

- **Route (a) as A1:** swaps through Minswap's aggregator, from a one-time account.
- **The extra transactions are the price of privacy.** The same sessions let any dApp be used privately later (step 4, private CIP-30), because a dApp sees an ordinary key account.
- **Built on this branch,** with one PR at the end, connector included.
- **A2 waits** for one preprod swap showing that Minswap's batcher fills an order paying a contract.

### Built (2026-09-25)

A swap in a private session, end to end, as *A swap (A1), step by step* below says. The flow is in [flows.md](../flows.md#contract-round-trip), the design in [architecture.md](../architecture.md#private-sessions).

- **Rust:** `ONE_TIME_ACCOUNT` in `seedelf-crypto`; in `seedelf-wasm`, the `OneTimeAccounts` type, `buildSessionReturn` (`build::external_sweep`), `inspectSessionTx`/`signSessionTx` (the connector's code on a session's key), and `attachWitnesses`, which splices a signature into a transaction someone else built, byte for byte.
- **Worker:** `sessions.ts` (the sealed `sessions.<network>` record; out, swap, cancel, back; the stages) and `minswap.ts` (the aggregator: estimate, build-tx, pending-orders, cancel-tx, tokens). Minswap is only in the pages' `connect-src`: it answers with CORS headers, so no new permission.
- **UI:** `screens/Swaps.tsx`, from a **Swaps** row on Home's Private tab (since 15b, from the dApp browser's Minswap tile): the sessions, a new swap (from ADA or a private token, the token to buy searched on Minswap's list, the slippage), the quote, the funding to review, and a session's page with its next step.
- **Tests:** Rust `wasm/tests/session_test.rs` (5, and 1 ignored that writes the extension's fixture): the account derivation pinned against `cardano-address`, the return, and a real preprod swap from Minswap read, signed and assembled byte for byte. Vitest `tests/sessions.test.ts` (6). Playwright: the whole swap in the extension against fakes of Koios and Minswap.
- **Changed from the plan:**
  - **No auto-return:** each step is a button (Place the order, Cancel the order, Bring it back), and the wallet reads the chain only when the Swaps screen opens or is refreshed. Bring it back is refused while an order waits. **Since 15b a swap runs itself** after one approval, with Stop ([chunk-15b-swap-runner.md](chunk-15b-swap-runner.md)); these buttons stay for sessions from before.
  - **The connector's `scripts` flag is redeemers only.** Minswap's order carries a script data hash for the datum in its witness set, and nothing runs.
- **Next: a swap that runs itself,** after one approval, and picks up at any point: [chunk-15b-swap-runner.md](chunk-15b-swap-runner.md), in a new context on this branch.
- **Not done:**
  - **A live swap on preprod.** It needs the user's go-ahead: fund a session from the private test wallet, place a small order (10 ₳ to MIN, as recorded), bring it back.
  - **The restore scan** (*Recovery*, *On a new device*), and Find leftovers.
  - **A cancel against a real order:** Minswap's `cancel-tx` is wired and its review works like the swap's, but no test cancels a recorded order.
  - **Private CIP-30** (step 4): offering a session to a site instead of the public account.
  - A2, and asking Minswap to list Seedelf Wallet.

### A private session

- **Its account:** a one-time account, `24301'/0/i`, a base address with its own stake key `24301'/2/i` since 15b (the shared Seedelf staking part before; see [privacy.md](../privacy.md#known-links)).
- **Its stages:** funding, ready, in use (orders open, positions held), returning, closed.
- **It lasts as long as what the dApp holds for it.** A swap closes in minutes. A lending or liquidity position keeps its account open until the position closes, across restarts and devices. That's why recovery matters.

### A swap (A1), step by step

1. **Quote:** `/estimate`. Minswap sees the pair, the amount and the IP address.
2. **Out:** a Seedelf spend with giveme.my's collateral. It pays the one-time account:
   - the amount, plus what the swap costs (fees, and the deposits the orders pay back);
   - 5 ₳ as the account's own collateral.

   The change goes back into Seedelf.
3. **Wait for Out to confirm.** The aggregator builds from its own view of the chain.
4. **Swap:**
   - `/build-tx` with the one-time account as sender returns an unsigned transaction.
   - The connector's `inspectDappTx` reads it against that account. It may spend only that account's UTxOs; it pays order contracts; its change goes back to the account.
   - The user reviews it, the account's key signs, and it's submitted through Koios.
5. **Fill:** batchers pay the proceeds to the account.
   - The wallet watches only while it's open, never in the background.
   - It reads the account's UTxOs, and asks `/pending-orders` about the account while an order is open.
6. **No fill:** `/cancel-tx`, signed by the account, and the refund lands at the account. The account's collateral is what the cancel's script needs.
7. **Back:** a key-signed move-in of everything at the account into Seedelf, under fresh registers: proceeds, change, returned deposits and collateral. The session closes, and the account is never used again.

**What links:**
- The whole path is public: Seedelf → the account → the order → the account → Seedelf.
- Who it is isn't: the public account never appears.
- The amounts and the timing tie the two ends together, as the path does anyway.

### Recovery

- **The index is sequential, from 0, from the phrase.** It moves on only once a session's Out is sent (a failed Out reuses it), so the used accounts stay in a row.
- **On this device:** a sealed list of sessions, like Contacts: each one's index, stage and transactions.
  - When the wallet opens, it reads every open session's account in one Koios request. `credential_utxos` names each row's credential and takes up to 75.
  - It asks the aggregator only about sessions waiting on an order.
  - Home lists the open sessions with what's left to do: **Bring back**, or **Cancel the order**.
- **Every stall is recoverable from the phrase alone:**
  - Money sitting in the account: Bring back.
  - An order never filled: Cancel, then Bring back.
  - Proceeds that arrived while the wallet was closed: brought back at the next open (the auto-return in [flows.md](../flows.md#contract-round-trip)).
- **On a new device (restore),** the list is gone, so the wallet scans the one-time accounts:
  - **Which were used:** `credential_txs` over 20 indices a request, until a request finds none, and new sessions start from there.
    - Its rows don't name the credential, so it shows that a batch was used, not which account in it. Skipping the rest of a batch costs nothing.
    - The transactions it returns (`tx_info`) show which accounts they paid.
  - **Money left:** `credential_utxos` over the used accounts.
  - **Orders left open:** `/pending-orders` for the used accounts with no return after their order.
  - This is a few requests, once. Koios and Minswap see those accounts asked about together, from one IP address, so the scan runs only at restore or from **Find leftovers**, never on every open.
