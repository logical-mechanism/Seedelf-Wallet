# **seedelf-cli**

`seedelf-cli` is a command-line wallet for Seedelf, a stealth wallet on Cardano. The ADA and tokens it holds sit at one smart contract, each UTxO under a register: a fresh, random-looking form of its owner's key. Anyone can pay you there, and only your secret key can prove which UTxOs are yours, so the chain doesn't show who received a payment or who spent it. It's for Cardano users who are at home in a terminal.

For a wallet in the browser, there's the [Seedelf Wallet](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/seedelf-platform/seedelf-web-wallet/README.md) is a Cardano wallet for Chrome with Seedelf built in. It's a separate product from the CLI, with its own keys: neither can open the other's wallet.

## How It Works

- **A Seedelf works like an ADA Handle for the contract.** It's an NFT whose name starts with `5eed0e1f`. You give a payer its name, the 64-character hex string `balance` prints, and their wallet finds your register from the UTxO that holds it.
- **Every payment gets a fresh register.** The payer's wallet reads your Seedelf's register and re-randomizes it. The new register is still yours to spend, and it looks random to everyone else, as long as the elliptic-curve Decisional Diffie-Hellman problem is hard.
- **Spending takes a proof, not your signature.** For each UTxO it spends, the CLI proves that it knows the secret key behind the register without revealing the key (a Schnorr proof), and the contract checks the proof. The transaction is signed by a one-time key made for it.
- **The collateral is shared.** Every Cardano script spend puts up collateral: a UTxO the network keeps if a script fails. Collateral sits at an address, so your own would show who spent. For spends from your Seedelf balance, the CLI uses the collateral that [giveme.my](https://giveme.my/) puts up and signs for each spend, the same for every user. `create` and `util extract` put up the browser wallet's own 5 ADA instead.
- **Your balance is every UTxO your key can spend.** The CLI finds them by testing each register at the contract against your key. It reads the chain through [Koios](https://www.koios.rest/), and submits its own spends there.

The root [README](https://github.com/logical-mechanism/Seedelf-Wallet#what-is-a-stealth-wallet) explains the protocol and its proofs.

## Installation

Precompiled x86-64 binaries for Linux, Windows and macOS are in the [latest release](https://github.com/logical-mechanism/Seedelf-Wallet/releases/latest): `seedelf-cli-linux.tar.gz`, `seedelf-cli-macos.tar.gz` and `seedelf-cli-windows.zip`. Each archive comes with a detached GPG signature (`.asc`). The release's `hashes.txt` lists the SHA-256 of each archive and each binary, and is signed the same way (`hashes.txt.asc`). Before running a binary, download the [release key](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/util/pubkeys/seedelfwallet.asc) (`util/pubkeys/seedelfwallet.asc` in this repository), check that its fingerprint is `759F 3952 BE14 AF01 AFEE 5861 A1A0 A20E 21B9 9053` (release@logicalmechanism.io), and verify the archive's signature:

```bash
gpg --show-keys seedelfwallet.asc   # check the fingerprint
gpg --import seedelfwallet.asc
gpg --verify seedelf-cli-linux.tar.gz.asc seedelf-cli-linux.tar.gz
gpg --verify hashes.txt.asc hashes.txt
```

If you have [rust installed](https://www.rust-lang.org/tools/install), then the `seedelf-cli` may be installed directly from [crates.io](https://crates.io/crates/seedelf-cli).

```bash
cargo install seedelf-cli
```

Run the same command again to update it.

### Building From Source

First, clone the repo and enter the Rust workspace's folder. Its `rust-toolchain.toml` pins the Rust version it builds with.
```bash
git clone https://github.com/logical-mechanism/Seedelf-Wallet
cd Seedelf-Wallet/seedelf-platform
```

Installing on the path:
```bash
cargo install --path seedelf-cli --bin seedelf-cli
seedelf-cli help
```

Building for release:
```bash
cargo build --release --bin seedelf-cli
./target/release/seedelf-cli help
```

Running it locally:
```bash
cargo run -- help
```

## Using The CLI

See all functions with the `help` command.

```bash
seedelf-cli help
```

```bash
A Cardano Stealth Wallet

Usage: seedelf-cli [OPTIONS] [COMMAND]

Commands:
  welcome   Displays the seedelf-cli welcome message
  create    Create a new seedelf in the wallet
  remove    Remove a seedelf from the wallet
  balance   Displays the current wallet information, seedelfs, and balance
  fund      An address sends funds to a seedelf
  transfer  A seedelf sends funds to a seedelf
  sweep     A seedelf sends funds to an address
  util      Utility functions for seedelf-cli
  external  External wallet functions for seedelf-cli
  help      Print this message or the help of the given subcommand(s)

Options:
      --preprod            Use this flag to interact with the pre-production environment
      --variant <VARIANT>  Use this for different variants of the contract, defaults to most recent variant [default: 1]
  -h, --help               Print help
  -V, --version            Print version
```

`--preprod` uses Cardano's pre-production test network instead of mainnet. `--variant` picks the version of the contracts. There's one, variant 1, which is the default.

### Basic Usage

The first command you run sets up the wallet. `welcome` is a good first one, since it only prints a short introduction.

```bash
seedelf-cli welcome
```

The CLI asks for a name for the wallet file, then a password: at least 14 characters, with an uppercase letter, a lowercase letter, a digit and a special character. It makes a random secret key and saves it as `$HOME/.seedelf/<name>.wallet`, encrypted with AES-256-GCM under a key that Argon2id derives from the password (`seedelf-cli/src/setup.rs`). Every command that needs the key asks for the password. **Back up this file and keep its password.** There's no recovery phrase: lose either and nobody can spend what the wallet holds, you included. The CLI uses the one wallet file in that folder, so the folder must hold exactly one. The root README's [Wallet File Storage](https://github.com/logical-mechanism/Seedelf-Wallet#wallet-file-storage) describes it.

The following action will create a Seedelf token with the `create` command.

```bash
seedelf-cli create [OPTIONS] --address <ADDRESS>
```

`<ADDRESS>` pays for the mint. It must belong to a browser wallet that supports CIP-30, the standard that lets a web page ask a Cardano browser wallet to sign. It must also hold a UTxO of exactly 5 ADA with no tokens, which the mint puts up as collateral; `create` refuses to build the transaction without one. To make one, send exactly 5 ADA from that wallet to that same address. The optional `--label` is a personal tag in plain text, which anyone can read: the token's name keeps its first 15 bytes, in hex.

`create` then serves a page on your machine and prints its address once it's serving: `http://127.0.0.1:44203/` and a path of its own for each run, so the address it prints shows this run's transaction and no other. Open it in the browser that has your wallet, and pick the wallet from the dropdown in the top right corner. The page asks the wallet to sign, and the wallet submits the transaction. The page shows the transaction's ID and CBOR before you sign, and the CLI prints the ID too. If the wallet doesn't confirm the submit, the transaction may still have gone through: look the ID up before you run the command again. Stop the server with Ctrl-C when it's done. One run's page serves at a time: while another is serving, `create` says so and stops. A page left open from an earlier run still holds that run's transaction, so close it.

Once the mint lands, `seedelf-cli balance` shows your Seedelf by its full name: the 64-character hex string you give to anyone who pays you. From then on it can be paid from any CIP-30 wallet with `fund`, or from another Seedelf balance with `transfer`. `fund` pays your own Seedelf or anyone's.

```bash
seedelf-cli fund [OPTIONS] --address <ADDRESS> --seedelf <SEEDELF>
```

The `<ADDRESS>` parameter used in the `fund` command is the address supplying the value and paying for the transaction. The `<SEEDELF>` parameter is the Seedelf receiving the funds, by its full token name in hex. `--lovelace` and `--asset` say what's sent; give at least one. The `fund` command is similar to the `create` command, as it serves a local page for the browser wallet to sign.

From your balance, `transfer` pays other Seedelfs, and `sweep` pays a key address or an ADA Handle's address (an ADA Handle is a `$name` that points to a Cardano address). These spend through the contract: the CLI proves, signs and submits them itself, with no browser wallet.

Use `seedelf-cli help` to view all available commands and the `--help` option to see more information about a specific command.

### Commands

| Command | What it does | Flags |
|---|---|---|
| `welcome` | Prints a short introduction. | |
| `balance` | Your Seedelfs and your balance. | |
| `create` | Mints a new Seedelf, paid by an address of a browser wallet, which signs it. | `-a, --address`, `-l, --label` |
| `fund` | An address pays a Seedelf, yours or anyone's. The browser wallet signs it. It never spends a UTxO of exactly 5 ADA with no tokens: that's the collateral `create` and `util extract` put up. | `-a, --address`, `-s, --seedelf`, `-l, --lovelace`, `--asset` |
| `transfer` | Your balance pays one or more Seedelfs. | `-s, --seedelfs`, `-l, --lovelaces`, `--asset`, `--utxo` |
| `sweep` | Your balance pays an address. | `-a, --address` or `--ada-handle`; `-l, --lovelace` and `--asset`, or `--all`; `--utxo` |
| `remove` | Burns one of your Seedelfs and sends the ADA it held to an address. | `-s, --seedelf`, `-a, --address` |
| `util expose-key` | Prints your secret key. Anyone who sees it can spend everything you hold. | |
| `util base` | Prints your base register, the one every register of yours is re-randomized from. | |
| `util find` | Lists every Seedelf, or, with `--label`, only those whose token name contains it. The label is matched in hex, as the token name holds it. | `-l, --label` |
| `util age` | How old a Seedelf is. | `-s, --seedelf` |
| `util statistics` | Statistics about the Seedelf protocol. | |
| `util history` | Your spends and receipts. | `--spend-only`, `--receive-only` |
| `util mint` | Mints a new Seedelf paid from your balance, with no browser wallet. With `--generator` and `--public-value`, it mints a Seedelf for someone else, under a fresh re-randomization of the register they give you (theirs from `util base`): still theirs, but no two Seedelfs minted for them share a datum. | `-l, --label`, `-g, --generator`, `-p, --public-value`, `--utxo` |
| `util extract` | Sends a UTxO at the contract that has no datum to an address. A payment sent to the contract without a datum has no register, so the contract lets anyone spend it. The address pays the fee and needs a 5 ADA collateral UTxO, and its browser wallet signs. | `-u, --utxo`, `-a, --address` |
| `util migrate` | For moving funds to a newer contract variant. Variant 1 is the only one, so it does nothing yet. | `--from-variant` |
| `external balance` | The external wallet's address and balance (see below). | |
| `external sweep` | Sends what the external wallet holds into your balance, as much as one transaction takes, and says what it left. | |

- **Amounts:** `--lovelace` (`--lovelaces` for `transfer`) is in lovelace: 1 ADA is 1,000,000. `--asset` is `<policy_id>.<token_name>=<amount>`, both in hex. For `fund` and `sweep`, repeat it, or comma-separate several tokens in one; `transfer` takes one per Seedelf, below.
- **Several Seedelfs at once:** `transfer` takes `-s` once for each Seedelf, `-l` once for each, in the same order, and `--asset` once for each if any has tokens, comma-separating that Seedelf's tokens (`--asset ""` for one that has none).
- **`--utxo`** for `transfer`, `sweep` and `util mint` is `<tx_hash>#<index>`, repeatable: the UTxOs to spend, in place of the CLI's own pick. It picks among all your UTxOs that hold no Seedelf, and silently skips any other; `sweep --all` ignores it. `util extract`'s `-u, --utxo` is the one UTxO it extracts.
- **Addresses:** `sweep` and `remove` pay any address on the network but a stake address. A script's address (a multisig's, a contract's) they pay too, as the ledger does, saying first that the payment carries no datum, which some scripts can never spend and some let anyone take. The browser wallet's address for `create`, `fund` and `util extract` needs a key's payment part, whatever its stake part.

### dApp Interactions: The Sweep-Fund Flow

The CLI doesn't connect to dApps. The suggested way to use one goes through a new CIP-30 wallet that the dApp accepts, completely disconnected from your existing wallets. Sweep funds from Seedelf into that new wallet, and use the dApp from it. The funds that come back may then fund your Seedelf, with the `fund` command. For simplicity, Seedelf also provides an external wallet that may receive funds without invoking the contract: a key address made from your Seedelf key. It's an ordinary address, so what it holds is public, and so is every payment to it. The `external sweep` command returns what it holds to the contract.

#### Example: Purchase Tokens with 25 ADA From A Dex On Mainnet

Using the `fund` command:
```bash
seedelf-cli sweep --address <NEW_WALLET_ADDRESS> --lovelace 25000000
# Purchase tokens from dex with 25 ADA
seedelf-cli fund [OPTIONS] --address <NEW_WALLET_ADDRESS> --seedelf <SEEDELF>
```

Using the external wallet:
```bash
seedelf-cli sweep --address <NEW_WALLET_ADDRESS> --lovelace 25000000
# Purchase tokens from dex with 25 ADA
# Send tokens and remaining ADA from the new wallet to the external wallet
seedelf-cli external sweep
```

The `external balance` command shows the external wallet's address.

```bash
seedelf-cli external balance
```

The benefit of the external wallet method is that it can be used to accumulate many UTxOs that can later be sent into the wallet.

Both flows keep the dApp apart from your Seedelf. The new wallet is funded from the contract, where a UTxO's owner can only be assumed, never proven, so the chain doesn't show which Seedelf funded it. Funding a Seedelf from the new wallet doesn't show which Seedelf it pays either: the payment goes to the contract under a fresh register, and the Seedelf's own UTxO isn't touched. The external wallet keeps this as long as nothing ever ties it to your original wallet. So in both flows, `Seedelf -> New Wallet -> dApp -> New Wallet -> Seedelf` and `Seedelf -> New Wallet -> dApp -> New Wallet -> External Wallet -> Seedelf`, the chain doesn't show whose Seedelf is at either end. What can still tie them together, such as your IP address and the amounts, is under Limits below.

## Limits

- **Amounts aren't hidden.** Seedelf hides who owns a UTxO, not what it holds, and it mixes nothing.
- **Your first Seedelf is tied to the wallet that paid for it.** `create` is paid by a browser wallet, in the open. `util mint` makes a new Seedelf from your balance, with no tie to that wallet as long as the balance it spends came from other people's payments: money you funded from that wallet yourself leads back to it. `remove` can then burn the first.
- **`fund` is public on the payer's side.** The chain shows the browser wallet paying into the contract, and how much, though not which Seedelf it pays.
- **The services see your IP address.** Koios reads the chain and submits your Seedelf spends, giveme.my puts up their collateral, and most commands ask `api.github.com` for the latest version (the update check). Koios and giveme.my can group your spends as one person's by that address.
- **Spends from your balance need giveme.my.** While it doesn't answer, none can go out.
- **Change can tie spends together.** A spend's change comes back to you, so the spend that later uses it can be assumed to be yours too.
- **A submit Koios doesn't confirm may still have gone through.** The CLI prints a transaction's id before it submits, and says so when Koios doesn't answer in time, answers with a server error, or answers with something other than the id. Look the id up before you run the command again: a second run builds and pays again.
- **The CLI trusts Koios.** It runs no node. Koios can't spend your funds, since a spend needs your key's proof, but a Koios that lied could hide UTxOs, or report a wrong register for a Seedelf or a wrong address for an ADA Handle, and so redirect a payment.
- **A spend draws on at most 20 of your UTxOs** that hold no Seedelf: any holding the tokens it sends, as few as hold them, then those that bring most, whatever they hold: each one's ADA beyond what its own tokens need. Anyone can pay your Seedelf, so a stranger's pile of tokens holding too little ADA comes last. `transfer`, `sweep` and `util mint` never pick a UTxO holding a reference script themselves, since spending one costs Conway's reference-script fee, but `--utxo` can name one. `sweep --all` sends the 20 that bring most that it can spend together, reference scripts included up to what one transaction may use, or as many of them as one transaction holds, and says what it left; run it again for the rest. When it sends nothing, it names the UTxOs whose tokens need more ADA than they hold. `external sweep` does the same, with no limit of 20.
- **A stranger's tokens can take your ADA with them.** Anyone can pay your Seedelf, or the external wallet, a pile of tokens holding too little ADA. `sweep --all` and `external sweep` send everything they can spend together, such a pile too, and its tokens go on with your own ADA: about 1.5 ADA for each 20 of them, the least an output holding them must carry.

The root README's [Wallet Limitations](https://github.com/logical-mechanism/Seedelf-Wallet#wallet-limitations) has the known attacks in full.

## Contact

For support and bugs, open a [GitHub issue](https://github.com/logical-mechanism/Seedelf-Wallet/issues) or a support ticket in the [Seedelf Discord](https://discord.gg/r8VwV2jGBy). For questions, suggestions, or concerns, please reach out to support@logicalmechanism.io. Security vulnerabilities go by email only: see [SECURITY.md](https://github.com/logical-mechanism/Seedelf-Wallet/blob/main/SECURITY.md).
