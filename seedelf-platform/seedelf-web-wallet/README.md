# Seedelf Wallet

Seedelf Wallet is a Cardano wallet for Chrome with private payments built in, made by Logical Mechanism. It's for anyone on Cardano who wants a full wallet, for staking, voting and dApps, with a private balance beside it, and no terminal.

**Get it** from the [Chrome Web Store](https://chromewebstore.google.com/detail/seedelf-wallet/dkefopeefhophfkjkkdebhoklagjdmcp), or build it from this repository and load it into Chrome yourself ([extension/README.md](extension/README.md#build-and-load-in-chrome)). It's free.

It runs on Cardano mainnet. Preprod, Cardano's test network, is on the welcome screen and in Settings, for trying the wallet with test ADA that has no value.

## What it is

One wallet on Cardano, with one recovery phrase and one password, and two sides, **Public** and **Private**:

- **The public account** (the Cardano account) is a full Cardano wallet. Receive, send, stake with a pool, spend the rewards, and delegate your vote, as in Lace or Eternl. Restore a Lace or Yoroi phrase and it's the same account, so you don't need a second wallet.
- **The private balance** is Seedelf's, a stealth wallet on Cardano. Make money private, pay anyone's Seedelf (the name a private balance is paid by), and make it public again to any address, with no UTxO saying who owns it.

**How the private side works.** Money in the private balance sits at the Seedelf wallet contract. Each UTxO there is locked to a fresh re-randomization of its owner's key, so the UTxO doesn't say whose it is, and it's spent with a Schnorr proof that only your recovery phrase can make. To be paid privately, you mint a **Seedelf**: a name token, starting `5eed0e1f`, that anyone can look up to pay you. The [root README](../../README.md) has the protocol and its maths.

**Private money can't be staked,** by design:

- Seedelf funds sit at a script address with no staking part, so they earn no rewards and carry no voting weight.
- A per-user staking key would link all of a user's Seedelfs together.

So money that sits stays staked in the public account, and is made private when it should move privately.

## What it does

Every screen, and what it does, is in [extension/README.md](extension/README.md#screens).

**The wallet**

- **Create** a wallet (a new 24-word phrase) or **restore** one from 12, 15 or 24 words, then lock it with a password.
- **See your balances,** on Home's two tabs: what the public account holds, and what the private balance holds with its Seedelfs. Tokens and NFTs are listed with a search; an NFT's image shows only when you ask for it.
- **Several public accounts:** the recovery phrase's Cardano accounts, one at a time, with a picker as Home's Public heading ("Public account 2 ▾") and names of your own. Each has its own addresses, staking and collateral. The private balance is one for the whole phrase, and each account's money made private keeps its own history: a private payment avoids spending two accounts' money together, and when it can't, or when you send everything (Max), its review names the accounts it ties together.
- **Transaction details:** every review, and the connector's sign window, opens the transaction itself, decoded from the bytes about to be signed: inputs, outputs, datums, scripts, certificates, votes, redeemers and metadata, with a tab for the raw bytes. It asks nobody anything: no lookup, no explorer link, a copy button instead.
- **Also:** Contacts, a UTxOs screen on each side where a UTxO can be locked out of every payment, Activity on each side (saved as CSV if you want), hiding the balances, the lock time, a check of a written copy of the recovery phrase, and ADA's value in a currency on mainnet.
- **Three languages:** English, Spanish and Japanese, every one bundled, so choosing one asks nobody anything.

**The public account**

- **Send:** pay up to 20 addresses, ADA Handles (`$name`s) or Seedelfs at once, in the open, as any Cardano wallet does, with an optional note on chain (CIP-20), which is public.
- **Make private:** move ADA and tokens from the public account into your private balance.
- **Staking:** stake with one pool, chosen from every live pool, each with its return on stake over its last 18 epochs. Rewards are spent along with anything the account pays, or withdrawn by hand. **Stop staking** returns the 2 ₳ deposit. **Rewards history** and **Delegation history** list what the stake key was paid and every change to it.
- **Voting delegation:** Always abstain, Always no confidence, or a DRep, searched by name in a list that ships with the wallet, or by its ID. Cardano keeps staking rewards locked until the vote is delegated, and the wallet says so.
- **Be your own DRep:** register the public account as a DRep, with its own vote behind it, and vote Yes, No or Abstain on the live governance actions, in the wallet's own screens. A profile only if you want one: the wallet writes the file, you publish it, and the wallet never fetches it. Retiring returns the 500 ₳ deposit. A DRep is public and tied to the account, and the screens say so. Governance sites such as GovTool work too, through CIP-95 in the dApp connector, once you allow it for that site.
- **Collateral:** the public account's 5 ₳ collateral, which Cardano asks of a transaction that runs a script, such as a dApp's, and takes only if the script fails. It's set in Settings, and reclaimed there.

**The private balance**

- **Create a Seedelf:** mint your Seedelf, with an optional tag of your own (public, and anyone can choose the same one), so others can pay you. Minting ties the Seedelf to whatever paid for it, so by default the public account pays for it, before any money is made private. Paying from the private balance instead is a stealth mint, which hides the payer only when that balance came from other people's payments.
- **Send:** pay up to 20 Seedelfs privately, by their full names.
- **Make public:** pay up to 20 Cardano addresses or ADA Handles from the private balance.
- **Remove a Seedelf:** burn it and free the ADA it held, into the public account or the private balance. By default the ADA goes back to the side that paid for the Seedelf; when the wallet doesn't know which did (after a restore, or in another browser), you choose.
- **Large payments:** a payment too large for one transaction goes as several, one after another, and the review says how many.

**dApps, privately**

1. **The connector:** sites connect over CIP-30, Cardano's standard for a site to talk to a wallet, as with Lace. It's off until you turn it on in Settings, and nothing is added to any page until then.
2. **Private sessions:** a new one-time account, funded from your private balance, uses a dApp, and what comes back goes into the private balance. A swap runs this way through Minswap's aggregator, which routes across Cardano's DEXes, and after one approval it runs by itself.
3. **dApps in the wallet:** Home's **dApps** page, with Minswap's swaps, which run in private sessions, and Lovejoin, the mixer (below).
4. **Private CIP-30:** any site can connect to a private session instead of the public account, chosen in the connect window. Its session is managed under the dApps page's **Sites**.

**Lovejoin, the mixer**

Lovejoin is a mixer on Cardano, also made by Logical Mechanism, with contracts of its own, apart from Seedelf's. Each of its pools holds boxes of one value: an amount of ADA alone, or a set amount of one token plus some ADA. A mix spends your boxes together with other people's, so what comes out is harder to tie to what went in.

- **A private session's return goes through it by default:** the spare ADA comes back through Lovejoin's pool of 5 ₳ boxes, so what comes back is harder to tie to the session, and its tokens through their own pool where one is shown. The session's 5 ₳ collateral is mixed once too, where a 5 ₳ pool holds enough other people's boxes and enough of the session's ADA is left to pay for it. Settings switches turn each off, and any box can be brought back directly.
- **The Lovejoin tile** mixes ADA or a pool's token from either side. **Help start the pool** puts boxes in for others to mix with, and they stay until you bring them back. **Four boxes a mix,** in place of three, is a Settings option. **Bring every box back now** brings every box back at once, which ties them together.
- **Anyone can start a pool** from the wallet (**Start a pool**), of a token on the wallet's list, or of ADA at any amount but 10 ₳. About 23 ₳ of what it costs never comes back.
- **On mainnet a pool mixes only once it holds 30 boxes that aren't yours.** While there's no such pool, a session's return comes back directly.
- **The Lovejoin v2 contracts the wallet mixes with are formally verified,** on the compiled templates every v2 pool applies. The older pools it only brings boxes back from aren't covered: [what's proved, and where it stops](../../seedelf-verification/CLAIMS.md).
- **Some older pools take no new boxes,** the classic pool of 10 ₳ boxes among them. If you have boxes in one, the wallet lists that pool and brings them back by itself, one right after another, which ties them together.
- **Lovejoin has had no third-party audit,** only its makers' own review, and the wallet says so wherever Lovejoin is chosen.

**Not planned**

- Several pools per account: one pool per account is the model, and several accounts spread stake across pools anyway.
- Folders or an account centre, or a Seedelf key per account: one private balance for the whole phrase.
- Reading several accounts at once, or a total across them: either would link them.
- A notification centre: a private payment can't be found while the wallet is locked, so it would mostly repeat Activity.
- `web+cardano` payment links (CIP-13), a phone feature.
- Other chains than Cardano, and mobile. Midnight, a privacy blockchain beside Cardano, is the one other chain whose support is being planned.
- **Hardware wallets can't be done at all:** the Seedelf key is derived from the recovery phrase's seed, and a hardware wallet's whole purpose is that the seed never leaves it. So a device could hold the public account and never the private balance.
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
- **Some links can't be avoided,** and the wallet says so where they happen. Making money private ties the public account to it. A Seedelf is tied to whatever paid for it. A private session's one-time account is public: anyone can follow its money, and money you made private leads back to your public account. [docs/privacy.md](docs/privacy.md) is the wallet's privacy model: what's hidden, what isn't, and [the known links](docs/privacy.md#known-links).
- **The services the wallet talks to see your IP address,** and can group what one address does, though the chain can't.
  - On mainnet it reads Cardano through Logical Mechanism's own server first, and through Koios, a public Cardano API, for any part that server can't answer. Settings → Network switches to Koios alone. Preprod always reads Koios.
  - Spends from the private balance also go to giveme.my, Logical Mechanism's collateral service. It puts up the collateral such a spend needs, the same for everyone, so your own collateral never tags your private spends.
  - CoinGecko is asked ADA's price on mainnet, unless the currency is set to none. Minswap sees a swap, and Blockfrost's IPFS gateway an NFT image you ask to see.
  - There's no analytics and no telemetry. The [privacy policy](docs/store/privacy-policy.md) says what the wallet handles and every service it talks to.
- **The protocol has known attacks,** such as watching whose collateral a transaction uses, or tracking IP addresses: the root README's [Wallet Limitations](../../README.md#wallet-limitations).
- **Lovejoin has had no third-party audit,** and hardware wallets can't hold the private balance (above).

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
