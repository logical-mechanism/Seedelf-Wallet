# **seedelf-cli**

The `seedelf-cli` is a rust implementation of the stealth wallet. It uses [Cardano collateral provider](https://giveme.my/), [Koios](https://www.koios.rest/), and [Pallas](https://github.com/txpipe/pallas). The wallet is primarily terminal base but it does use a static HTML web interface for CIP30 funding when required.

## Installation

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
cargo build
```

Precompile binaries are available for Linux, Windows, and MacOS. These may be found in the latest release.

## Using The Seedelf CLI

```bash
A Cardano Stealth Wallet

Usage: seedelf-cli [OPTIONS] <COMMAND>

Commands:
  welcome         Displays the Seedelf welcome message
  wallet-info     Displays wallet information
  balance         Displays the current wallet balance
  fund            An address sends ADA to a Seedelf
  transfer        A Seedelf sends ADA to a Seedelf
  sweep           A Seedelf sends ADA to an address
  seedelf-new     Create a new Seedelf
  seedelf-all     Display all Seedelfs
  seedelf-remove  Remove a Seedelf
  help            Print this message or the help of the given subcommand(s)

Options:
      --preprod  Use this flag to interact with the pre-production environment
  -h, --help     Print help
  -V, --version  Print version

```

### Basic Usage

Create a Seedelf with the `seedelf-new` command. The Seedelf is funded with the `fund` command. Send funds to another Seedelf with the `transfer` command. Funds can be send to an address with the `sweep` command. Use the `--help` option to see more information.

**Some commands will prompt to open a localhost for cip30 wallet interaction.**

The wallet will create a secret key file on the local machine inside the home directory under the .seedelf folder. The wallet will prompt the user at first use to name the secrey key file. Keep this file safe!