# Seedelf Wallet

Seedelf Wallet is a Cardano wallet for Chrome with private payments built in. It's for anyone on Cardano who wants a full wallet (staking, voting, dApps) with a private balance beside it, without using a terminal.

**Get it** from the [Chrome Web Store](https://chromewebstore.google.com/detail/seedelf-wallet/dkefopeefhophfkjkkdebhoklagjdmcp), or build it from this repository and load it into Chrome yourself ([extension/README.md](extension/README.md#build-and-load-in-chrome)). It's free.

It runs on Cardano mainnet. To try it with test ADA that has no value, switch to preprod, Cardano's test network, from the welcome screen or Settings.

## What it is

One wallet on Cardano, with one recovery phrase and one password, and two sides, **Public** and **Private**:

- **The public account** (the Cardano account) is a full Cardano wallet. Receive, send, stake with a pool, spend the rewards, and delegate your vote, as in Lace or Eternl. Restore a Lace or Yoroi phrase and it's the same account, so you don't need a second wallet.
- **The private balance** is Seedelf, a stealth wallet on Cardano, where no UTxO says who owns it. Make money private, pay anyone's Seedelf, and make money public again to any address.

**How the private side works.** To be paid privately, you mint a **Seedelf**, an NFT whose name starts `5eed0e1f`. It works like an ADA Handle for the private balance: anyone using Seedelf Wallet, or Seedelf's command-line wallet, can pay you by its name. The money itself sits at the Seedelf wallet contract. Each UTxO there is locked to a fresh re-randomization of its owner's key, so the UTxO doesn't say whose it is, and it's spent with a Schnorr proof that only the key from your recovery phrase can make. The [root README](../../README.md) has the protocol and its maths.

**Private money can't be staked,** by design:

- Seedelf funds sit at a script address with no staking part, so they earn no rewards and carry no voting weight.
- A per-user staking key would link all of a user's Seedelfs together.

So money you're just holding can stay staked in the public account, and you make it private when you're ready to move it.

## What it does

Every screen, and what it does, is in [extension/README.md](extension/README.md#screens).

**The wallet**

- **Create** a wallet (a new 24-word phrase) or **restore** one from 12, 15 or 24 words, then lock it with a password.
- **See your balances,** on Home's two tabs: what the public account holds, and what the private balance holds with its Seedelfs. Tokens and NFTs are listed with a search; an NFT's image shows only when you ask for it.
- **Several public accounts:** one recovery phrase holds many Cardano accounts. You use one at a time, switching with the picker in Home's Public heading ("Public account 2 ▾"), and you can name them. Each has its own addresses, staking and collateral. There's one private balance for the whole phrase, but the wallet remembers which account made each part of it private. A private payment avoids spending two accounts' money together; when it can't, or when you send everything (Max), its review names the accounts it ties together.
- **Transaction details:** every review, and the connector's sign window, opens the transaction itself, decoded from the bytes about to be signed: inputs, outputs, datums, scripts, certificates, votes, redeemers and metadata, with a tab for the raw bytes. Nothing is fetched to show it: no lookup, and a copy button instead of an explorer link.
- **Also:** Contacts; a UTxOs screen on each side, where you can lock a UTxO so no payment spends it; Activity on each side, which you can save as CSV; hiding the balances; how long the wallet waits before it locks itself; a check that your written copy of the recovery phrase restores this wallet; and ADA's value in a currency on mainnet.
- **Three languages:** English, Spanish and Japanese, all bundled with the wallet, so choosing one fetches nothing.

**The public account**

- **Send:** pay up to 20 addresses, ADA Handles (`$name`s) or Seedelfs at once, in the open, as any Cardano wallet does, with an optional note on chain (CIP-20), which is public.
- **Make private:** move ADA and tokens from the public account into your private balance.
- **Staking:** stake with one pool, chosen from every live pool, each with its return on stake over its last 18 epochs. Rewards are spent along with anything the account pays, or withdrawn by hand. **Stop staking** returns the 2 ₳ deposit. **Rewards history** and **Delegation history** list what the stake key was paid and every change to it.
- **Voting delegation:** Always abstain, Always no confidence, or a DRep, searched by name in a list that ships with the wallet, or by its ID. Cardano keeps staking rewards locked until the vote is delegated, and the wallet says so.
- **Be your own DRep:** register the public account as a DRep, with its own vote behind it, and vote Yes, No or Abstain on the live governance actions, in the wallet's own screens. A profile is optional: the wallet writes the file, you publish it, and the wallet never fetches it. Retiring returns the 500 ₳ deposit. A DRep is public and tied to the account, and the screens say so. Governance sites such as GovTool work too, through CIP-95 in the dApp connector, once you allow it for that site.
- **Collateral:** the public account's 5 ₳ collateral, which Cardano asks of a transaction that runs a script, such as a dApp's, and takes only if the script fails. You set it up in Settings, and reclaim it there.

**The private balance**

- **Create a Seedelf:** mint your Seedelf, with an optional tag of your own (public, and anyone can choose the same one), so others can pay you. Minting ties the Seedelf to whatever paid for it. So by default the public account pays, before you make any money private: that links the account to the Seedelf, but not to your private balance. Paying from the private balance instead is a stealth mint, which hides the payer only when that balance came from other people's payments.
- **Send:** pay up to 20 Seedelfs privately, by their full names.
- **Make public:** pay up to 20 Cardano addresses or ADA Handles from the private balance.
- **Remove a Seedelf:** burn it and free the ADA it held, into the public account or the private balance. By default the ADA goes back to the side that paid for the Seedelf; when the wallet doesn't know which did (after a restore, or in another browser), you choose.
- **Large payments:** a payment too large for one transaction goes as several, one after another, and the review says how many.

**dApps, privately**

1. **The connector:** sites connect over CIP-30, Cardano's standard for a site to talk to a wallet, as with Lace. It's off until you turn it on in Settings, and nothing is added to any page until then.
2. **Private sessions:** a dApp is used from a new one-time account, which the wallet funds from your private balance, and what comes back goes into the private balance. A swap runs this way through Minswap's aggregator, which routes across Cardano's DEXes, and after one approval it runs by itself.
3. **dApps in the wallet:** Home's **dApps** page, with Minswap's swaps, which run in private sessions, and Lovejoin, the mixer (below).
4. **Private CIP-30:** any site can connect to a private session instead of the public account, chosen in the connect window. Its session is managed under the dApps page's **Sites**.

**Lovejoin, the mixer**

Lovejoin is a mixer on Cardano, with its own contracts. A mix spends your boxes, UTxOs of one fixed value, together with other people's, so what comes out is harder to tie to what went in.

- **A private session's return goes through it by default,** once a pool holds enough other people's boxes (30 on mainnet); until then it comes back directly. Settings turns it off.
- **The Lovejoin tile** mixes ADA, or a token that has a pool, from either side, and anyone can start a new pool.
- **The v2 contracts it mixes with are [formally verified](../../seedelf-verification/CLAIMS.md):** proofs say exactly when each one accepts a transaction, not how well a mix hides you. Lovejoin has had no third-party audit, and the wallet says so wherever Lovejoin is chosen.

[extension/README.md](extension/README.md#screens) has the rest.

**Not right now**

- Several pools per account: one pool per account is the model, and several accounts spread stake across pools anyway.
- Folders or an account centre, or a Seedelf key per account: one private balance for the whole phrase.
- Reading several accounts at once, or a total across them: either would link them.
- A notification centre: a private payment can't be found while the wallet is locked, so it would mostly repeat Activity.
- `web+cardano` payment links (CIP-13), a phone feature.
- Other chains than Cardano, and mobile. Support for Midnight, a privacy blockchain beside Cardano, is being planned.
- Nothing that reports on you or ties you to an identity: no analytics, and no identity checks (AML/KYC), so no on-ramp, and no yield products or token claims that would need them.

New features come from what users ask for.

## What it costs

- **The wallet is free.**
- **Every transaction pays Cardano's network fee,** which its review shows before you send.
- **A Seedelf holds a little ADA** while it exists. Removing it frees that ADA.
- **Staking** takes Cardano's 2 ₳ deposit, back when you stop. **Being a DRep** takes a 500 ₳ deposit, back when you retire.
- **The public account's collateral** is 5 ₳ of your own, set aside until you reclaim it.
- **A swap** shows what it costs before you approve it: the network fees, the DEX's fee and Minswap's, and what comes back.
- **Lovejoin:** each mix and each box brought back pays its network fee. Starting a pool costs about 23 ₳ that never comes back.

## Limits

- **Amounts, tokens and timing are public.** Seedelf hides who owns a UTxO and who spends it, from people reading the chain. It doesn't hide how much moves, or when.
- **Paying a Seedelf takes Seedelf Wallet or the seedelf-cli,** Seedelf's command-line wallet. Someone using another wallet pays your public account's address instead, in the open.
- **Some links can't be avoided,** and the wallet says so where they happen. Making money private ties it to the public account it came from. A Seedelf is tied to whatever paid for it. A private session's one-time account is public: anyone can follow its money back into your private balance and, if you made that money private yourself, on to your public account. [docs/privacy.md](docs/privacy.md) is the wallet's privacy model: what's hidden, what isn't, and [the known links](docs/privacy.md#known-links).
- **The services the wallet talks to see your IP address,** and can group what one address does, though the chain can't. So the server that sends your transactions, and the collateral service that sees every private spend, can tie your private payments to your public account.
  - On mainnet it reads Cardano through its own server first, and through Koios, a public Cardano API, for any part that server can't answer. Settings → Network switches to Koios alone. Preprod always reads Koios.
  - Spends from the private balance also go to giveme.my, a collateral service. It puts up the collateral such a spend needs, the same for everyone, so no collateral of yours ties your private spends to you.
  - CoinGecko is asked ADA's price on mainnet, unless the currency is set to none. Minswap sees a swap, and Blockfrost's IPFS gateway an NFT image you ask to see.
  - There's no analytics and no telemetry. The [privacy policy](docs/store/privacy-policy.md) says what the wallet handles and every service it talks to.
- **The protocol has known attacks,** such as watching whose collateral a transaction uses, or tracking IP addresses: the root README's [Wallet Limitations](../../README.md#wallet-limitations).
- **Hardware wallets can't hold the private balance.** The Seedelf key is derived from the recovery phrase's seed, and a hardware wallet never lets its seed out. A device could hold the public account, but never the private balance.

## Relationship to the CLI

Seedelf Wallet and the [seedelf-cli](../README.md), Seedelf's command-line wallet, are separate products, much like cardano-cli wallets and browser wallets are:

- **Different secrets.** Seedelf Wallet is built from a recovery phrase. The CLI uses a random key stored in `$HOME/.seedelf`.
- **No import or migration** in either direction. CLI users stay CLI users.
- **What they share:**
  - the on-chain contracts ([seedelf-contracts](../../seedelf-contracts/))
  - the cryptography ([seedelf-crypto](../seedelf-crypto/)) and the transaction building ([seedelf-core](../seedelf-core/)), compiled to WebAssembly for the extension

## Releases

Seedelf Wallet's versions are their own line, from 1.0.0, apart from the CLI's 0.x.

[docs/releases.md](docs/releases.md) lists every version uploaded to the Chrome Web Store: what it changed, the commit its package was built from, the package's SHA-256, and its git tag (`web-wallet/<version>`) where it has one. The package builds reproducibly, so you can build that commit yourself, with the same clang and an official Node build, and compare ([docs/releases.md](docs/releases.md) says what's pinned and what isn't).

## Community

- **Support and bugs:** [GitHub issues](https://github.com/logical-mechanism/Seedelf-Wallet/issues), or a support ticket in the [Seedelf Discord](https://discord.gg/r8VwV2jGBy).
- **Questions and discussion:** the Seedelf Discord.
- **Security vulnerabilities:** by email only, never an issue or a ticket: see [SECURITY.md](../../SECURITY.md).
- **Anything else:** support@logicalmechanism.io.

## For contributors

- [extension/README.md](extension/README.md#build-and-load-in-chrome): building, loading and testing the extension, and where its code lives.
- [docs/development.md](docs/development.md): branching, running it in Chrome, test funds, the testing layers, the rules for a change to the screens, the release steps, and the decisions the wallet is built on.
- [docs/architecture.md](docs/architecture.md): how the extension is structured: the WebAssembly, chain data, storage, the service worker, the dApp connector and Lovejoin.
- [docs/keys-and-accounts.md](docs/keys-and-accounts.md): one phrase and two key trees, the kinds of account, and the password encryption.
- [docs/flows.md](docs/flows.md): each flow, step by step.
- [docs/lovejoin-mix-width.md](docs/lovejoin-mix-width.md): why a Lovejoin mix takes three boxes by default, and four is an option.
- [wasm/README.md](wasm/README.md): the WebAssembly bindings over the Rust crates.
- [docs/i18n/glossary.md](docs/i18n/glossary.md): the translations: the words fixed in every language, and how each string is recorded.
- [docs/store/](docs/store/README.md): the Chrome Web Store listing's text, images and privacy policy.
- [brand/](brand/README.md) and [media/](media/README.md): the logo set, and the images for posts about the wallet.
- [docs/backlog.md](docs/backlog.md): what the maintainers might build next, and what's declined and why.
