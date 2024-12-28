# **seedelf-cli**

The `seedelf-cli` is a rust implementation of the Seedelf stealth wallet protocol. It uses [Cardano collateral provider](https://giveme.my/), [Koios](https://www.koios.rest/), and [Pallas](https://github.com/txpipe/pallas). The wallet is primarily terminal base but it does use a static HTML web interface for CIP30 interactions when required.

**Note: Wallet Is Currently In Alpha**

## Installation

Precompile binaries are available for Linux, Windows, and MacOS. These may be found in the latest release. 

The seedelf-cli will eventually be on crates.io.

### Building From Source

First, clone the repo and enter the cli subfolder.
```bash
git clone https://github.com/logical-mechanism/Seedelf-Wallet
cd Seedelf-Wallet/seedelf-cli
```

Installing on path:
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

```
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
  help      Print this message or the help of the given subcommand(s)

Options:
      --preprod  Use this flag to interact with the pre-production environment
  -h, --help     Print help
  -V, --version  Print version
```

### Basic Usage

Get started with the wallet using the `welcome` command.

```bash
seedelf-cli welcome
```

Create a Seedelf with the `create` command. The Seedelf is funded with the `fund` command. Send funds to another Seedelf with the `transfer` command. Funds can be send to an address with the `sweep` command. Use the `--help` option to see more information.

The wallet will create an encrypted secret key file on the local machine inside the home directory under the `$HOME/.seedelf` folder. The wallet will prompt the user for a password and a name for the secrey key file. Keep this file safe!

## Contact

For questions, suggestions, or concerns, please reach out to support@logicalmechanism.io.