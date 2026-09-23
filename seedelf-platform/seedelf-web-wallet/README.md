# Seedelf Web Wallet

A Chrome extension for Seedelf, the Cardano stealth wallet.

> **Status:** design phase. There is no code yet. The design lives in [docs/](docs/).

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
- **Deposit:** a normal Cardano address that any wallet or exchange can pay.
- **Move in:** move funds from the deposit account into your Seedelf balance.
- **Create a seedelf:** mint your named seedelf so others can pay you. It is paid from your Seedelf balance, so it is never linked to your deposit account.
- **Transfer:** send funds privately from your seedelfs to any seedelf.
- **Withdraw:** send funds from your seedelfs to any Cardano address, or remove a seedelf.

**Next: the contract round trip**

1. Move funds out of Seedelf into a one-time account.
2. Use a dApp with that account.
3. Whatever comes back is swept into a seedelf automatically.

**Not planned:** staking, governance, swaps, hardware wallets, other chains, mobile. We add features only if there's demand.

## Relationship to the CLI

The web wallet and [seedelf-cli](../seedelf-cli/) are separate products, much like cardano-cli wallets and browser wallets are:

- **Different secrets.** The web wallet is built from a recovery phrase. The CLI uses a random key stored in `$HOME/.seedelf`.
- **No import or migration** in either direction. CLI users stay CLI users.
- **What they share:**
  - the on-chain contracts ([seedelf-contracts](../../seedelf-contracts/))
  - the cryptography: [seedelf-crypto](../seedelf-crypto/), compiled to WebAssembly for the extension

## Design docs

| Doc | Covers |
|---|---|
| [architecture.md](docs/architecture.md) | How the extension is structured, crypto in WebAssembly, chain data, storage, and what we borrow from Lace |
| [keys-and-accounts.md](docs/keys-and-accounts.md) | One phrase and two key trees, the kinds of account, password encryption |
| [flows.md](docs/flows.md) | Onboarding, deposit, create/fund, transfer, withdraw, contract round trip |
| [privacy.md](docs/privacy.md) | What stays hidden, what doesn't, and the rules the wallet enforces |

## Reference: Lace

IOG's [Lace](https://github.com/input-output-hk/lace) wallet (Apache-2.0) is our reference for browser-extension and Cardano patterns. We take patterns and a few individual files. We don't take its framework, its UI stack or its branding.

Clone it locally for reading. `seedelf-platform/_reference/` is gitignored.

```bash
git clone --depth 1 --branch lace-extension@2.4.0 \
  https://github.com/input-output-hk/lace seedelf-platform/_reference/lace
```

Every Lace path in these docs is relative to that checkout.

## Open decisions

- **Seedelf key derivation:** how the phrase becomes the Seedelf scalar. This is permanent once shipped. See [keys-and-accounts.md](docs/keys-and-accounts.md#seedelf-key-derivation).
- **Transaction building:** Rust (Pallas) compiled to WebAssembly, or a TypeScript Cardano library. See [architecture.md](docs/architecture.md#transaction-building).
- **UI:** framework (or none), and side panel vs popup.
- **Unlock across service-worker restarts:** keep the unlocked key in `chrome.storage.session`, or re-prompt for the password.
- **One-time account addresses:** shared Seedelf staking part, or no staking part. See [privacy.md](docs/privacy.md#known-links).
