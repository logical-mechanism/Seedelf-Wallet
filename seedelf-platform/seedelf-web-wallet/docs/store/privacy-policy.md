# Seedelf Wallet privacy policy

**Effective 27 September 2026** (updated for mainnet, the network switch, Lovejoin, and a privacy review: see *Changes*). This policy covers the Seedelf Wallet browser extension, published by Logical Mechanism LLC.

**In short:** no accounts, analytics, crash reports or ads. One service the wallet uses, giveme.my, is ours: it receives your IP address and each private transaction you send, to add its collateral. Never your recovery phrase or your keys. To work, the extension also talks to Koios, a public Cardano API, and on mainnet to CoinGecko, for ADA's price. When you swap, it also talks to Minswap. Nothing else: Lovejoin, the mixer, is a contract on the Cardano blockchain, reached through Koios. Sites see your public account, or a private session's account, only if you turn on connecting sites and connect them.

The extension runs on Cardano mainnet, and can switch to preprod, Cardano's test network, on the welcome screen or in Settings. Everything below applies to both; each network has its own services' addresses, listed at the end.

## What the extension handles

| Data | Why | Where it stays or goes |
|---|---|---|
| Your recovery phrase | It holds your keys. | **On your device only.** It's encrypted with your password (Argon2id and ChaCha20-Poly1305) in the browser's storage for this extension. While the wallet is unlocked, the key material sits in memory-only session storage, which is cleared when you lock the wallet or close the browser. It is never sent anywhere. |
| Your password | It unlocks the wallet. | **Never stored or sent.** |
| Your addresses, balances and transactions | To show your balance, and to build, check and send your transactions. | **Sent to Koios**, to read the Cardano blockchain and to submit the transactions you approve, all from your IP address. **Seedelf spends also go to giveme.my**, which adds shared collateral. |
| Which Seedelf UTxOs are yours | To show your Seedelf balance. | **Worked out on your device.** It's kept in session storage and cleared when you lock. Nobody is told until you spend one: Koios and giveme.my see each one you spend. |
| Your contacts, your Seedelf history, who paid for each Seedelf you create, and the UTxOs you lock | To name who you pay, list what you sent and received, keep money with different histories apart, remove a Seedelf to the side that paid for it, and keep the UTxOs you chose out of your payments. | **On your device only**, encrypted with a key derived from your recovery phrase, so they can't be read while the wallet is locked. Removing the wallet deletes them. |
| An ADA Handle you withdraw to | To find the address it belongs to. | **Sent to Koios**, which looks up who holds the handle. Pasting an address instead asks Koios nothing. |
| Your staking: your pool, where your voting power goes, your rewards | To show them, and to build the staking changes you approve. | **Sent to Koios**, as your stake address. A pool or a DRep you look up is sent to Koios too. Like every transaction, a staking change is public once it's on the blockchain. |
| Your settings (whether payments spend your staking rewards, hiding the balances, how long the wallet stays unlocked, the currency, which is US dollars unless you change it, whether sites can connect and whether signing for one needs your password, whether private sessions come back through Lovejoin, how deep it mixes and how long its boxes wait, where the wallet opens, and which network it's on) and the list of stake pools | To remember your choices, and to browse pools without asking Koios each time. | **On your device only.** The pool list is the same for everyone. ADA's price is kept in memory-only session storage, for five minutes. Removing the wallet deletes your settings and the pool list, except where the wallet opens and which network it's on, which are the browser's. |
| A note you add to a payment | To say what the payment is for. | **Written on the transaction,** where anyone can read it once it's on the blockchain. |
| Your Activity, saved as a file | Only when you choose Save as CSV. | **A file on your device,** not encrypted. The extension doesn't send it anywhere. Each row has its transaction's ID, so whoever has the file can find every one on the blockchain: for your private side, that ties your private payments, your private sessions and your Lovejoin boxes to each other and to your public account. |
| The number of failed unlocks | To slow down password guessing. | **On your device only.** |
| A swap you make | Only when you swap: to quote it and build it. | **Sent to Minswap**: the tokens and amounts, a token you search for that isn't on the wallet's own list, and the one-time account the swap runs from, which is funded from your private balance: your public account isn't in the swap's transactions, though anyone can follow its funding back into your private balance. Your IP address lets Minswap group your swaps. Half and Max round down, but still tell it roughly how much your private balance holds. **The list of your swaps**, their one-time accounts and their transactions, stays on your device only, encrypted like your contacts. The one-time account's UTxOs are read from **Koios**. |
| Your Lovejoin boxes | Only when ADA goes through Lovejoin (a private session's return, which you can turn off in Settings, or a mix you start): to bring each box back later, into your private balance. | **On the blockchain,** as every transaction is: the deposit, the mixes and each box's way back. Lovejoin makes the way back harder to tie to where the box went in, for people reading the blockchain. It doesn't hide the trip from Koios or giveme.my, which see your device send both ends. **When each box is due back, and each mix the wallet sends,** stay on your device only, encrypted like your contacts. Lovejoin's pool is read from **Koios**; which boxes are yours is worked out on your device. |
| The sites you connect, and what they ask for | Only if you turn on **Let sites connect to Seedelf Wallet** in Settings: a site can then ask to connect, and to have transactions or messages signed. | **A site connected to your public account sees it**: its addresses, balance and UTxOs, and what you sign for it. **Or, if you choose a private session when it connects, it's given only that session's one-time account**, funded from your private balance with what you choose. It's never given your private balance or your Seedelfs; the funding itself is public, and anyone, the site included, can follow it back into your private balance. Like any website, a site also sees your IP address and this browser. **The list of connected sites** stays on your device only, encrypted like your contacts, and a private session forgets its site when you disconnect it. Signing a site's transaction that spends someone else's UTxOs asks **Koios** about those UTxOs. |

## The services the extension talks to

Every request goes without your browser's cookies or a referrer.

- **Koios** (`api.koios.rest` on mainnet, `preprod.koios.rest` on preprod), a public Cardano API run by the Koios community.
  - It sees your IP address and what the wallet asks: your Cardano account and its staking, the whole Seedelf contract, Lovejoin's pool when you use Lovejoin, the pools and DReps you look at, and the transactions you submit, with a check of each one's status.
  - From what the wallet reads, it can tell that your Cardano account uses Seedelf, and guess that you use Lovejoin, but not which Seedelf UTxOs or Lovejoin boxes are yours: that check runs on your device. But every transaction goes to Koios to be sent, from the same IP address that reads your public account. So it can see which private UTxOs and Lovejoin boxes you spend, and the new ones they pay into, and tie them to your public account. That includes both ends of Lovejoin.
  - Two reviews go to it before you press Send: creating a Seedelf paid by your public account, whose draft shows it the Seedelf's tag, and a Lovejoin mix or return, whose first mix it measures.
  - The wallet asks the network it's on. It asks the other only to finish what you started there: a payment on its way, a swap, or a Lovejoin mix or box.
- **giveme.my** (`www.giveme.my`, at `/mainnet/collateral/` or `/preprod/collateral/`), a collateral service for Seedelf transactions, **run by Logical Mechanism**, who publish this extension.
  - It sees your IP address and each Seedelf transaction it adds collateral to, before it's on the blockchain: each private payment, each private session's funding, and each Lovejoin box you bring back. From one IP address it can group them as one person's, including a session's funding with its Lovejoin boxes coming back.
  - Shared collateral keeps your own address out of those transactions.
  - Its own logs leave out raw IP addresses, and the transaction's hash whenever it adds collateral. The platform it runs on may keep its own request logs.
- **Minswap** (`agg-api.minswap.org` on mainnet, `aggr.monorepo-testnet-preprod.minswap.org` on preprod), only when you swap. Its aggregator quotes the swap, builds it for the swap's one-time account, and lists that account's orders.
  - It sees your IP address, a token you search for that isn't on the wallet's own list, and each swap: its tokens and amounts and the one-time account's address.
  - It isn't told your private balance or your public account, but your IP address lets it group your swaps, and tie them to anything else done at Minswap from that address.
- **CoinGecko** (`api.coingecko.com`), on mainnet only, for ADA's price in the currency you chose (US dollars unless you change it).
  - It sees your IP address, and a request for ADA's price when Home or the swap form opens, at most every five minutes. It's told nothing about your wallet.
  - Choosing no currency in Settings stops it. On preprod it's never contacted: test ADA has no price.
- **Cardanoscan** (`cardanoscan.io` on mainnet, `preprod.cardanoscan.io` on preprod), a blockchain explorer, only when you click a link to a transaction or an address. It opens in your browser, which then sends it your IP address and its own cookies, and keeps the page in your browser history. On a private transaction, the link says so.

Each service's own policy covers what it receives. giveme.my is ours; Koios, Minswap, CoinGecko and Cardanoscan aren't, and we don't control them. A VPN hides your IP address, not that your requests come from one wallet: the wallet reads your account and sends your private payments through the same connection.

**Lovejoin** isn't a service: it's a contract on the Cardano blockchain, and the wallet builds and signs its transactions itself, reading the chain through Koios. Lovejoin's makers also run giveme.my, which sees each box you bring back with your IP address. Lovejoin has had no third-party audit, only its makers' own review.

**Transactions are public.** Anything you submit is recorded on the Cardano blockchain, as with any wallet: amounts, tokens, timing, and which transactions spend which outputs. Seedelf hides who owns a UTxO from people reading the blockchain, and Lovejoin makes it harder for them to tell which box coming out was yours, not those. A box hides only among other people's boxes that come back into a Seedelf around the same time, one of up to 9 at the default depth and fewer while few people use Lovejoin, and not from Koios or giveme.my. Spending boxes that came back together narrows it, and so does bringing one back soon after its mixes.

**Preprod and mainnet share your keys.** The same recovery phrase has the same keys on both networks, so anyone comparing the two blockchains can tell your preprod account is your mainnet one. Test on preprod with a phrase you don't use on mainnet if that matters to you.

## What we don't do

- We don't collect, sell or share any data. The one service of ours, giveme.my, receives what's above to add its collateral, and nothing else.
- We don't track what you do in the extension or on other websites.
- The extension doesn't read web pages. Only if you turn on connecting sites does it add the standard Cardano wallet entry (`window.cardano.seedelf`) to https pages, and nothing else; turning it off removes it. While it's on, every https site you open, and the scripts on it, can see that you use Seedelf Wallet, even sites you never connect (not your addresses or balance until you connect).
- The extension runs no code from outside its package.

## Your control

- Everything the extension keeps is in your browser.
- Removing the extension deletes its storage, including the encrypted wallet. Keep your recovery phrase: it's the only way back in.
- The Chrome Web Store and Chrome itself know this extension is installed in your browser, and Chrome Sync, if it syncs your extensions, installs it in your other signed-in browsers. Only the extension is synced, never your wallet.
- While the wallet is unlocked, anyone using your browser can see your balances and history, and someone who knows Chrome's developer tools can read your keys. Lock the wallet (or close the browser) before leaving it.

## Changes

If the extension's data handling changes, we'll update this page and its date, and say so in the release notes before the new version ships.

- **27 September 2026:** says that giveme.my is ours, and what it and Koios can see of your private payments and Lovejoin boxes; what Lovejoin hides and from whom; what a connected site, Minswap and Cardanoscan can still learn; the Lovejoin switch and the records of who paid for a Seedelf; and what Chrome and your device know. The wallet also stopped sending cookies with its requests.

## Contact

Open an issue at <https://github.com/logical-mechanism/Seedelf-Wallet/issues>, or email support@logicalmechanism.io.
