# Seedelf Web Wallet

A Cardano wallet for Chrome, with private payments built in: Seedelf, the Cardano stealth wallet.

> **Status:** released. v1.0.0 reached the Chrome Web Store on 2026-09-28 and 1.1.0 followed on 2026-10-01. Every build, the dev build included, runs on Cardano mainnet by default, with preprod on the welcome screen and in Settings for testing. The design lives in [docs/](docs/), what was built is in [docs/roadmap.md](docs/roadmap.md), and what comes next is in [docs/post-release-roadmap.md](docs/post-release-roadmap.md). To try it in Chrome, see [extension/README.md](extension/README.md).

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
- **Several public accounts** (chunk 18): the recovery phrase's Cardano accounts, one at a time, with a picker in the top bar and names of your own. Each has its own addresses, staking and collateral; the private balance is one for the whole phrase, and money made private from different accounts is kept apart so a private payment doesn't tie them together.
- **Staking** (chunk 13): stake the public account with one pool, from a browser of every live pool. Rewards are spent along with anything the account pays, or withdrawn by hand. Stop staking returns the 2 ₳ deposit.
- **Voting delegation** (chunk 13): Always abstain, Always no confidence, or a DRep, searched by name in a list that ships with the wallet, or by its ID. Conway pays out no rewards until the vote is delegated, and the wallet says so.
- **Be your own DRep** (chunk 21): register the public account as a DRep, with its own vote behind it, and vote Yes, No or Abstain on the live governance actions, in the wallet's own screens. A profile only if you want one: the wallet writes the file, you publish it, and the wallet never fetches it. Retiring returns the 500 ₳ deposit. A DRep is public and tied to the account, and the screens say so. Governance sites such as GovTool work too, through CIP-95 in the dApp connector, once you allow it for that site.
- **Create a Seedelf:** mint your named Seedelf so others can pay you. Minting links the Seedelf to whatever paid for it, so by default the public account pays for it, before any money is made private (see [privacy.md](docs/privacy.md#known-links)).
- **Send** (private, a transfer): send funds privately from your private balance to any Seedelfs, by their full names.
- **Make public** (a withdrawal): send funds from your private balance to any Cardano addresses, or remove a Seedelf.

**Also in v1: dApps, privately** ([plans/chunk-15-dapp-connector.md](docs/plans/chunk-15-dapp-connector.md)). All four are built:

1. **The connector** (chunk 15): sites connect over CIP-30, as with Lace. It's off until you turn it on in Settings, and nothing is added to any page until then.
2. **Private sessions** (chunks 15 and 15b): move funds out of Seedelf into a one-time account, use a dApp with that account, and bring what comes back into Seedelf. The first is a swap through Minswap's aggregator, which runs by itself after one approval.
3. **A dApp browser in the wallet** (chunk 15b): Home's **dApps**, where dApps run in private sessions. Minswap is the first.
4. **Private CIP-30** (chunk 15c): any site can connect to a private session instead of the public account, chosen in the connect window. Its session is managed under the dApps page's **Sites**.

**Also in v1: Lovejoin** ([plans/chunk-16-lovejoin.md](docs/plans/chunk-16-lovejoin.md)). The mixer in the wallet: the spare ADA a private session brings back goes through Lovejoin, 10 ₳ boxes on chain, so what comes back is harder to tie to the session. A Settings switch turns it off, any box can be brought back directly, and the Lovejoin tile mixes from either side. It has had no third-party audit, only its makers' own review, and the wallet says so wherever Lovejoin is chosen. On mainnet it mixes only once Lovejoin's pool holds 30 boxes that aren't yours.

**Also in v1** (chunk 14, from what Lace and Eternl have): the public account's staking changes in its Activity, a note on a public send, hiding the balances, the lock time, a check of the written recovery phrase, Activity saved as CSV, and ADA's value in a currency on mainnet. See [plans/chunk-14-style-flow-2.md](docs/plans/chunk-14-style-flow-2.md).

**After v1: the transaction view** ([plans/chunk-17-transaction-view.md](docs/plans/chunk-17-transaction-view.md)). Every review, and the connector's sign window, opens **Transaction details**: the transaction itself — inputs, outputs, datums, scripts, certificates, votes, redeemers and metadata — decoded from the CBOR that is about to be signed, with a tab for the raw bytes. It asks nobody anything: no lookup, no explorer link, a copy button instead.

**After v1: several public accounts, three languages, and NFT images.** Several accounts are above (chunk 18). The wallet reads in English, Spanish and Japanese, every language bundled, so choosing one asks nobody anything ([plans/chunk-19-language.md](docs/plans/chunk-19-language.md)). And an NFT's image shows when you ask for it in its details, one NFT at a time: your browser fetches it from IPFS through Blockfrost's gateway, nothing of ours in between, and the details say first who sees what, more strongly for an NFT in your private balance ([plans/chunk-20-nft-images.md](docs/plans/chunk-20-nft-images.md)).

**Next** ([docs/post-release-roadmap.md](docs/post-release-roadmap.md) has the whole picture, and the reasoning): a pass over how all of it looks and reads.

**Later, maybe:** word of an incoming payment without opening the wallet. It needs the chain read in the background, which the public Koios tier can't carry, so it waits on a data layer built for the wallet.

**Not planned:** several pools per account (one pool per account is the model, and several accounts spread stake across pools anyway), folders or an account centre, other chains, mobile. **Hardware wallets can't be done at all:** the Seedelf key is derived from the recovery phrase's seed, and a hardware wallet's whole purpose is that the seed never leaves it — so a device could hold the public account and never the private balance. And nothing that reports on you or ties you to an identity: no analytics, no AML/KYC, no on-ramp. We add features only if there's demand.

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
| [flows.md](docs/flows.md) | Onboarding, receive, move in, create, transfer, withdraw, staking, being your own DRep, contract round trip |
| [privacy.md](docs/privacy.md) | What stays hidden, what doesn't, and the rules the wallet enforces |
| [development.md](docs/development.md) | The branching rule, running it in Chrome, test funds, the testing layers, the release checklist, sharing with testers |
| [store/](docs/store/README.md) | The Chrome Web Store listing: its text, images and privacy policy |
| [roadmap.md](docs/roadmap.md) | How v1 was built: the 17 chunks and a one-line handoff note each ([archive/](docs/archive/roadmap-v1.md) keeps every note in full) |
| [post-release-roadmap.md](docs/post-release-roadmap.md) | What comes after v1: the order (parity, then the look and feel), where Cardano parity stands against Lace, and what's declined and why |

## Reference: Lace

IOG's [Lace](https://github.com/input-output-hk/lace) wallet (Apache-2.0) is our reference for browser-extension and Cardano patterns. We take patterns and a few individual files. We don't take its framework, its UI stack or its branding.

Clone it locally for reading. `seedelf-platform/_reference/` is gitignored.

```bash
git clone --depth 1 --branch lace-extension@2.4.0 \
  https://github.com/input-output-hk/lace seedelf-platform/_reference/lace
```

Every Lace path in these docs is relative to that checkout.

## Decisions

- **Networks:** mainnet and preprod in every build, mainnet by default; `VITE_ENABLE_MAINNET=false` makes a preprod-only build for tests. See [architecture.md](docs/architecture.md#networks).
- **Seedelf key derivation:** domain-tagged HKDF over the BIP39 seed. It is permanent once shipped. See [keys-and-accounts.md](docs/keys-and-accounts.md#seedelf-key-derivation).
- **UI:** the same app in a full tab (the default) or Chrome's side panel, the user's choice in Settings, as in Lace. No popup. See [architecture.md](docs/architecture.md#ui).
- **Look:** the Seedelf logo set lives in [brand/](brand/). The UI's colours come from it.
- **Staying unlocked:** Chrome stops the extension's background worker after about 30 seconds idle, which clears its memory.
  - The unlocked key is kept in `chrome.storage.session` (memory-only, cleared when the browser closes).
  - So the wallet stays unlocked until auto-lock or browser close, instead of asking for the password after every restart.
  - See [architecture.md](docs/architecture.md#service-worker).
- **Cardano accounts:** CIP-1852 accounts, one at a time (chunk 18). The wallet finds the ones the phrase has used, in order, stopping at the first never used, and asks about one at a time on purpose. The Seedelf key stays on account 0, so there is one private balance for the whole phrase. See [keys-and-accounts.md](docs/keys-and-accounts.md#the-cardano-account).
- **One-time accounts:** a reserved account index that real wallets never reach. Each session's base address has its own payment and stake keys, shared with no other session. See [privacy.md](docs/privacy.md#known-links).
- **Transaction building:** the CLI's Rust (Pallas) builders, separated from network calls and compiled to WebAssembly. See [architecture.md](docs/architecture.md#transaction-building).
- **UI stack:** React + TypeScript + Vite, with plain CSS.
