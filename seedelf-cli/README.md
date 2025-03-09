# **seedelf-cli**

The `seedelf-cli` is a Rust implementation of the Seedelf stealth wallet protocol. It uses [Cardano collateral provider](https://giveme.my/), [Koios](https://www.koios.rest/), and [Pallas](https://github.com/txpipe/pallas). The wallet is primarily terminal-based but uses a static HTML web interface for CIP30 interactions when required.

**Note: Wallet Is Currently In Beta**

## Installation

Precompile binaries are available for Linux, Windows, and MacOS. These may be found in the [latest release](https://github.com/logical-mechanism/Seedelf-Wallet/releases/latest).

If you are running Linux, MacOS, or Unix-like OS, run the following command on your terminal and follow the instructions.
```bash
curl -fsSL https://raw.githubusercontent.com/logical-mechanism/Seedelf-Wallet/refs/heads/main/util/seedelf-init.sh | bash
```

If you have [rust/cargo installed](https://www.rust-lang.org/tools/install), the seedelf-cli can be installed directly from [crates.io](https://crates.io/).

```bash
cargo install seedelf-cli
```

### Building From Source

First, clone the repo and enter the cli subfolder.
```bash
git clone https://github.com/logical-mechanism/Seedelf-Wallet
cd Seedelf-Wallet/seedelf-cli
```

Installing on the path:
```bash
cargo install --path .
```

Building for release:
```bash
cargo build --release
```

Running it locally:
```bash
cargo run -- help
```

## Using The Seedelf CLI

```bash
seedelf-cli help
```

```bash
A Cardano Stealth Wallet

Usage: seedelf-cli [OPTIONS] [COMMAND]

Commands:
 welcome   Displays the seedelf-cli welcome message
 create    Create a new Seedelf in the wallet
 remove    Remove a Seedelf from the wallet
 balance   Displays the current wallet information, seedelfs, and balance
 fund      An address sends funds to a Seedelf
 transfer  A Seedelf sends funds to a Seedelf
 sweep     A Seedelf sends funds to an address
 util      Utility functions for seedelf-cli
 dapp      dApp functions for seedelf-cli
 help      Print this message or the help of the given subcommand(s)

Options:
 --preprod            Use this flag to interact with the pre-production environment
 --variant <VARIANT>  Use this for different variants of the contract, default to the most recent variant [default: 1]
 -h, --help               Print help
 -V, --version            Print version
```

### Basic Usage

Get started with the wallet using the `welcome` command.

```bash
seedelf-cli welcome
```

This command will generate an encrypted secret key for the wallet. The `welcome` command will prompt the user for a password and a name for the secret key file. The wallet will use this secret key for all spending-related actions. The user must keep the secret key safe and secure. **Keep this file safe!** The wallet stores the encrypted secret key file on the local machine inside the home directory under the `$HOME/.seedelf` folder. 

The following action will create a Seedelf token with the `create` command.

```bash
seedelf-cli create [OPTIONS] --address <ADDRESS>
```

The available `[OPTIONS]` may be viewed with the `--help` parameter. The `<ADDRESS>` parameter in the `create` command is the address paying for the Seedelf token mint transaction. This address must come from a CIP30-enabled wallet. The `create` command will use a local web server to generate a website at `http://127.0.0.1:44203/`. The website will ask the user to select a wallet from the dropdown in the top right corner. The website will prompt the user to enable the wallet and sign the transaction. The `Transaction CBOR` section shows the CBOR of the signed transaction.

At this point, the wallet may receive funds from other CIP30 wallets or Seedelfs. Users may fund their own Seedelf and others by using the `fund` command.

```bash
seedelf-cli fund [OPTIONS] --address <ADDRESS> --seedelf <SEEDELF>
```

The available `[OPTIONS]` may be viewed with the `--help` parameter. The `<ADDRESS>` parameter used in the `fund` command is the address supplying the value and paying for the transaction. The `<SEEDELF>` is the Seedelf receiving the funds. The `fund` command is similar to the `create` command as it generates a local website for dapp interactions.

The user may send funds to another Seedelf address using the `transfer` command and back to a CIP30 wallet using the `sweep` command.

Use `seedelf-cli help` to view all available commands and the `--help` option to see more information about a specific command.

## Contact

For questions, suggestions, or concerns, please reach out to support@logicalmechanism.io.
