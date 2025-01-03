# **seedelf-cli**

The `seedelf-cli` is a Rust implementation of the Seedelf stealth wallet protocol. It uses [Cardano collateral provider](https://giveme.my/), [Koios](https://www.koios.rest/), and [Pallas](https://github.com/txpipe/pallas). The wallet is primarily terminal-base but it does use a static HTML web interface for CIP30 interactions when required.

**Note: Wallet Is Currently In Alpha**

## Installation

Precompile binaries are available for Linux, Windows, and MacOS. These may be found in the [latest release](https://github.com/logical-mechanism/Seedelf-Wallet/releases/latest).

If you are running Linux, MacOS, or Unix-like OS then run the following command in your terminal and follow the instructions.
```bash
curl -fsSL https://raw.githubusercontent.com/logical-mechanism/Seedelf-Wallet/refs/heads/main/util/seedelf-init.sh | bash
```

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
  update    Update the seedelf-cli with the newest tagged release
  util      Utility functions for seedelf-cli
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

Create a Seedelf with the `create` command. A CIP30 wallet may fund a Seedelf address with the `fund` command. Funds may be sent to another Seedelf address using the `transfer` command. The' sweep' command can send funds to a CIP30 wallet. Use the `--help` option to see more information.

The wallet will create an encrypted secret key file on the local machine inside the home directory under the `$HOME/.seedelf` folder. The wallet will prompt the user for a password and a name for the secret key file. Keep this file safe!

## Contact

For questions, suggestions, or concerns, please reach out to support@logicalmechanism.io.