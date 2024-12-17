# Seedelf CLI

Seedelf is a stealth wallet that hides the receiver and spender.

- TODO -> Build github action workflow for tagged releases

## Installation

Installing on path

```bash
cargo install --path .
```

Building for release
```bash
cargo build --release
```

Locally running it
```bash
cargo build
cargo run -- help
```

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

Some commands will prompt to open a localhost for cip30 wallet interaction.