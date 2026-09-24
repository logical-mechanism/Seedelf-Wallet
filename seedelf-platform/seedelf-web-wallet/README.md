# Seedelf Web Wallet

A Chrome extension for Seedelf, the Cardano stealth wallet.

> **Status:** early build, preprod only. The design lives in [docs/](docs/), and progress is in [docs/roadmap.md](docs/roadmap.md). To try it in Chrome, see [extension/README.md](extension/README.md).

## What it is

Seedelf is where money moves privately on Cardano. The web wallet is for people who will never use a terminal. It has one recovery phrase, one password, a balance screen and private transfers.

It sits **next to** your main wallet and doesn't replace it. Staking, governance, DeFi and long-term holdings stay in Lace, Eternl, and similar wallets. This is by design:

- **No staking.** Seedelf funds sit at a script address with no staking part, so they earn no rewards and carry no voting weight.
- **Why no staking key.** A per-user staking key would link all of a user's seedelfs together.

Money comes in, moves privately, and goes out. It isn't meant to sit here.

## Scope

**v1: the core wallet**

- Create or restore a wallet from a recovery phrase, then lock it with a password.
- See your balance: your seedelfs and the funds they hold.
- **Cardano account:** the wallet's normal, non-private side: a standard Cardano account that any wallet or exchange can pay. For a restored Lace or Yoroi phrase, it's that wallet's first account.
- **Move in:** move funds from the Cardano account into your Seedelf balance.
- **Send:** pay any address from the Cardano account, in the open, as any Cardano wallet does.
- **Create a seedelf:** mint your named seedelf so others can pay you. Minting links the seedelf to whatever paid for it, so by default the Cardano account pays for it, before any money is moved in (see [privacy.md](docs/privacy.md#known-links)).
- **Transfer:** send funds privately from your Seedelf balance to any seedelf, by its full name.
- **Withdraw:** send funds from your seedelfs to any Cardano address, or remove a seedelf.

**Next: the contract round trip**

1. Move funds out of Seedelf into a one-time account.
2. Use a dApp with that account.
3. Whatever comes back is swept into a seedelf automatically.

**Next: staking and voting delegation** (chunk 13). The wallet becomes a full Cardano wallet with private payments built in: stake the Cardano account with one pool, spend its rewards, and delegate its vote (Always abstain, No confidence, or a DRep). See [plans/chunk-13-staking.md](docs/plans/chunk-13-staking.md).

**Not planned:** voting on proposals or registering as a DRep, swaps, hardware wallets, other chains, mobile. We add features only if there's demand.

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
| [flows.md](docs/flows.md) | Onboarding, receive, move in, create, transfer, withdraw, contract round trip |
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
- **UI:** a popup, plus a full-tab view of the same app, like Eternl. No side panel. See [architecture.md](docs/architecture.md#ui).
- **Look:** the Seedelf logo set lives in [brand/](brand/). The UI's colours come from it.
- **Staying unlocked:** Chrome stops the extension's background worker after about 30 seconds idle, which clears its memory.
  - The unlocked key is kept in `chrome.storage.session` (memory-only, cleared when the browser closes).
  - So the wallet stays unlocked until auto-lock or browser close, instead of asking for the password after every restart.
  - See [architecture.md](docs/architecture.md#service-worker).
- **Cardano account:** CIP-1852 account `0'` for v1. Every function takes the account index, so more accounts can come later. See [keys-and-accounts.md](docs/keys-and-accounts.md#the-cardano-account).
- **One-time accounts:** a reserved account index that real wallets never reach, with base addresses using the shared Seedelf staking part like the CLI's External Wallet. See [privacy.md](docs/privacy.md#known-links).
- **Transaction building:** the CLI's Rust (Pallas) builders, separated from network calls and compiled to WebAssembly. See [architecture.md](docs/architecture.md#transaction-building).
- **UI stack:** React + TypeScript + Vite, with plain CSS.
