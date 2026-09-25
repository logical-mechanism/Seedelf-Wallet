# Seedelf Web Wallet

A Cardano wallet for Chrome, with private payments built in: Seedelf, the Cardano stealth wallet.

> **Status:** early build, preprod only. The design lives in [docs/](docs/), and progress is in [docs/roadmap.md](docs/roadmap.md). To try it in Chrome, see [extension/README.md](extension/README.md).

## What it is

Seedelf is where money moves privately on Cardano. The web wallet is for people who will never use a terminal. It's one wallet on Cardano, with one recovery phrase and one password, and two sides, **Public** and **Private**:

- **The public account** (the Cardano account): a full Cardano wallet. Receive, send, stake with a pool, spend the rewards, and delegate your vote, as in Lace or Eternl. For a restored Lace or Yoroi phrase, it's the same account. You don't need a second wallet.
- **The private balance** (Seedelf's): make money private, pay anyone's Seedelf, and make it public again to any address, with no UTxO saying who owns it.

Private money can't be staked, by design:

- Seedelf funds sit at a script address with no staking part, so they earn no rewards and carry no voting weight.
- A per-user staking key would link all of a user's Seedelfs together.

So money that sits stays staked in the public account, and is made private when it should move privately.

## Scope

**v1: the core wallet**

- Create or restore a wallet from a recovery phrase, then lock it with a password.
- See your balance: your Seedelfs and the funds they hold.
- **Public account** (the Cardano account): the wallet's normal, non-private side: a standard Cardano account that any wallet or exchange can pay. For a restored Lace or Yoroi phrase, it's that wallet's first account.
- **Make private** (a move-in): move funds from the public account into your private balance.
- **Send** (public): pay any addresses or Seedelfs from the public account, in the open, as any Cardano wallet does.
- **Staking** (chunk 13): stake the public account with one pool, from a browser of every live pool. Rewards are spent along with anything the account pays, or withdrawn by hand. Stop staking returns the 2 ₳ deposit.
- **Voting delegation** (chunk 13): Always abstain, Always no confidence, or a DRep, searched by name in a list that ships with the wallet, or by its ID. Conway pays out no rewards until the vote is delegated, and the wallet says so.
- **Create a Seedelf:** mint your named Seedelf so others can pay you. Minting links the Seedelf to whatever paid for it, so by default the public account pays for it, before any money is made private (see [privacy.md](docs/privacy.md#known-links)).
- **Send** (private, a transfer): send funds privately from your private balance to any Seedelfs, by their full names.
- **Make public** (a withdrawal): send funds from your private balance to any Cardano addresses, or remove a Seedelf.

**Next: dApps, privately** ([plans/chunk-15-dapp-connector.md](docs/plans/chunk-15-dapp-connector.md))

1. **The connector** (chunk 15, built): sites connect over CIP-30, as with Lace. It's off until you turn it on in Settings, and nothing is added to any page until then.
2. **Private sessions** (chunks 15 and 15b, built): move funds out of Seedelf into a one-time account, use a dApp with that account, and bring what comes back into Seedelf. The first is a swap through Minswap's aggregator, which runs by itself after one approval.
3. **A dApp browser in the wallet** (chunk 15b, built): Home's **dApps**, where dApps run in private sessions. Minswap is the first.
4. **Private CIP-30** (chunk 15c, built): any site can connect to a private session instead of the public account, chosen in the connect window. Its session is managed under the dApps page's **Sites**.

**Also in v1** (chunk 14, from what Lace and Eternl have): the public account's staking changes in its Activity, a note on a public send, hiding the balances, the lock time, a check of the written recovery phrase, Activity saved as CSV, and ADA's value in a currency on mainnet. See [plans/chunk-14-style-flow-2.md](docs/plans/chunk-14-style-flow-2.md).

**Later, maybe:** NFT images, several accounts, and word of incoming payments without opening the wallet (it would need reading the chain in the background).

**Not planned:** voting on proposals or registering as a DRep, several pools per account, hardware wallets, other chains, mobile. We add features only if there's demand.

## Relationship to the CLI

The web wallet and [seedelf-cli](../seedelf-cli/) are separate products, much like cardano-cli wallets and browser wallets are:

- **Different secrets.** The web wallet is built from a recovery phrase. The CLI uses a random key stored in `$HOME/.seedelf`.
- **No import or migration** in either direction. CLI users stay CLI users.
- **What they share:**
  - the on-chain contracts ([seedelf-contracts](../../seedelf-contracts/))
  - the cryptography ([seedelf-crypto](../seedelf-crypto/)) and the transaction building ([seedelf-core](../seedelf-core/)), compiled to WebAssembly for the extension

## Design docs

| Doc | Covers |
|---|---|
| [architecture.md](docs/architecture.md) | How the extension is structured, crypto in WebAssembly, chain data, storage, and what we borrow from Lace |
| [keys-and-accounts.md](docs/keys-and-accounts.md) | One phrase and two key trees, the kinds of account, password encryption |
| [flows.md](docs/flows.md) | Onboarding, receive, move in, create, transfer, withdraw, staking, contract round trip |
| [privacy.md](docs/privacy.md) | What stays hidden, what doesn't, and the rules the wallet enforces |
| [development.md](docs/development.md) | The branching rule, running it in Chrome, test funds, the testing layers, the release checklist, sharing with testers |
| [store/](docs/store/README.md) | The Chrome Web Store listing: its text, images and privacy policy |
| [roadmap.md](docs/roadmap.md) | Build chunks, their status, and handoff notes between sessions |

## Reference: Lace

IOG's [Lace](https://github.com/input-output-hk/lace) wallet (Apache-2.0) is our reference for browser-extension and Cardano patterns. We take patterns and a few individual files. We don't take its framework, its UI stack or its branding.

Clone it locally for reading. `seedelf-platform/_reference/` is gitignored.

```bash
git clone --depth 1 --branch lace-extension@2.4.0 \
  https://github.com/input-output-hk/lace seedelf-platform/_reference/lace
```

Every Lace path in these docs is relative to that checkout.

## Decisions

- **Networks:** preprod first. Mainnet is a build flag. See [architecture.md](docs/architecture.md#networks).
- **Seedelf key derivation:** domain-tagged HKDF over the BIP39 seed. It is permanent once shipped. See [keys-and-accounts.md](docs/keys-and-accounts.md#seedelf-key-derivation).
- **UI:** the same app in a full tab (the default) or Chrome's side panel, the user's choice in Settings, as in Lace. No popup. See [architecture.md](docs/architecture.md#ui).
- **Look:** the Seedelf logo set lives in [brand/](brand/). The UI's colours come from it.
- **Staying unlocked:** Chrome stops the extension's background worker after about 30 seconds idle, which clears its memory.
  - The unlocked key is kept in `chrome.storage.session` (memory-only, cleared when the browser closes).
  - So the wallet stays unlocked until auto-lock or browser close, instead of asking for the password after every restart.
  - See [architecture.md](docs/architecture.md#service-worker).
- **Cardano account:** CIP-1852 account `0'` for v1. Every function takes the account index, so more accounts can come later. See [keys-and-accounts.md](docs/keys-and-accounts.md#the-cardano-account).
- **One-time accounts:** a reserved account index that real wallets never reach. Each session's base address has its own payment and stake keys, shared with no other session. See [privacy.md](docs/privacy.md#known-links).
- **Transaction building:** the CLI's Rust (Pallas) builders, separated from network calls and compiled to WebAssembly. See [architecture.md](docs/architecture.md#transaction-building).
- **UI stack:** React + TypeScript + Vite, with plain CSS.
