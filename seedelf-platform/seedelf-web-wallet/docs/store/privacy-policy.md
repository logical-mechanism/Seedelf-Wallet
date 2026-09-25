# Seedelf Wallet privacy policy

**Effective 25 September 2026** (updated for connecting sites and private swaps, chunk 15). This policy covers the Seedelf Wallet browser extension, published by Logical Mechanism LLC.

**In short:** we collect nothing. The extension has no accounts, analytics, crash reports or ads, and nothing it handles is ever sent to us. To work, it talks to two public services, Koios and giveme.my, and on mainnet to a third, CoinGecko, for ADA's price. When you swap, it also talks to Minswap. Nothing else. Sites see your public account only if you turn on connecting sites and connect them.

## What the extension handles

| Data | Why | Where it stays or goes |
|---|---|---|
| Your recovery phrase | It holds your keys. | **On your device only.** It's encrypted with your password (Argon2id and ChaCha20-Poly1305) in the browser's storage for this extension. While the wallet is unlocked, the key material sits in memory-only session storage, which is cleared when you lock the wallet or close the browser. It is never sent anywhere. |
| Your password | It unlocks the wallet. | **Never stored or sent.** |
| Your addresses, balances and transactions | To show your balance, and to build, check and send your transactions. | **Sent to Koios**, to read the Cardano blockchain and to submit the transactions you approve. **Seedelf spends also go to giveme.my**, which adds shared collateral. |
| Which Seedelf UTxOs are yours | To show your Seedelf balance. | **Worked out on your device.** It's kept in session storage and cleared when you lock. Nobody is told. |
| Your contacts, your Seedelf history, and the UTxOs you lock | To name who you pay, list what you sent and received, and keep the UTxOs you chose out of your payments. | **On your device only**, encrypted with a key derived from your recovery phrase, so they can't be read while the wallet is locked. Removing the wallet deletes them. |
| An ADA Handle you withdraw to | To find the address it belongs to. | **Sent to Koios**, which looks up who holds the handle. Pasting an address instead asks Koios nothing. |
| Your staking: your pool, where your voting power goes, your rewards | To show them, and to build the staking changes you approve. | **Sent to Koios**, as your stake address. A pool or a DRep you look up is sent to Koios too. Like every transaction, a staking change is public once it's on the blockchain. |
| Your settings (whether payments spend your staking rewards, hiding the balances, how long the wallet stays unlocked, the currency, whether sites can connect and whether signing for one needs your password, and where the wallet opens) and the list of stake pools | To remember your choices, and to browse pools without asking Koios each time. | **On your device only.** The pool list is the same for everyone. Removing the wallet deletes your settings, except where the wallet opens, which is the browser's. |
| A note you add to a payment | To say what the payment is for. | **Written on the transaction,** where anyone can read it once it's on the blockchain. |
| Your Activity, saved as a file | Only when you choose Save as CSV. | **A file on your device,** not encrypted. The extension doesn't send it anywhere. |
| The number of failed unlocks | To slow down password guessing. | **On your device only.** |
| A swap you make | Only when you swap: to quote it and build it. | **Sent to Minswap**: the tokens and amounts, the tokens you search for, and the one-time account the swap runs from, which is funded from your private balance and never your public account. **The list of your swaps** and their one-time accounts stays on your device only, encrypted like your contacts. The one-time account's UTxOs are read from **Koios**. |
| The sites you connect, and what they ask for | Only if you turn on **Let sites connect to your public account** in Settings: a site can then ask to connect, and to have transactions or messages signed. | **A connected site sees your public account**: its addresses, balance and UTxOs, and what you sign for it. **Or, if you choose a private session when it connects, it sees only that session's one-time account**, funded from your private balance with what you choose. It never sees your private balance or your Seedelfs. **The list of connected sites** stays on your device only, encrypted like your contacts. Signing a site's transaction that spends someone else's UTxOs asks **Koios** about those UTxOs. |

## The services the extension talks to

- **Koios** (`preprod.koios.rest`), a public Cardano API run by the Koios community.
  - It sees your IP address and what the wallet asks: your Cardano account and its staking, the whole Seedelf contract, the pools and DReps you look at, and the transactions you submit.
  - From that it can tell that your Cardano account uses Seedelf. It can't tell which Seedelf UTxOs are yours, because that check runs on your device.
- **giveme.my** (`www.giveme.my`), a collateral service for Seedelf transactions.
  - It sees your IP address and each Seedelf transaction it adds collateral to.
  - Shared collateral keeps your own address out of those transactions.
- **Minswap** (`aggr.monorepo-testnet-preprod.minswap.org` on preprod), only when you swap. Its aggregator quotes the swap, builds it for the swap's one-time account, and lists that account's orders.
  - It sees your IP address, the tokens you search for, and each swap: its tokens and amounts and the one-time account's address.
  - It never sees your private balance or your public account.
- **CoinGecko** (`api.coingecko.com`), on mainnet only, for ADA's price in the currency you chose.
  - It sees your IP address, and a request for ADA's price when Home opens, at most every five minutes. It's told nothing about your wallet.
  - Choosing no currency in Settings stops it. The preprod version never contacts it.

Each service's own policy covers what it receives, and we don't control any of them. A VPN hides your IP address from them.

**Transactions are public.** Anything you submit is recorded on the Cardano blockchain, as with any wallet: amounts, tokens, timing, and which transactions spend which outputs. Seedelf hides who owns a UTxO, not those.

## What we don't do

- We don't collect, sell or share any data. We never receive any.
- We don't track what you do in the extension or on other websites.
- The extension doesn't read web pages. Only if you turn on connecting sites does it add the standard Cardano wallet entry (`window.cardano.seedelf`) to https pages, and nothing else; turning it off removes it.
- The extension runs no code from outside its package.

## Your control

- Everything the extension keeps is in your browser.
- Removing the extension deletes its storage, including the encrypted wallet. Keep your recovery phrase: it's the only way back in.

## Changes

If the extension's data handling changes, we'll update this page and its date, and say so in the release notes before the new version ships.

## Contact

Open an issue at <https://github.com/logical-mechanism/Seedelf-Wallet/issues>, or email support@logicalmechanism.io.
