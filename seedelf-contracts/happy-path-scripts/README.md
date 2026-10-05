# Happy Path Scripts

The scripts are designed to be used in sequential order.

They use this folder's `contracts/` and `hashes/` (`../../contracts/`, `../../hashes/`), the later revision that was never deployed, not version 1. So what they make on a testnet is invisible to the `seedelf-cli` and the Seedelf Wallet, which use version 1's hashes.

## Wallet Setup

We need a reference and two user wallets.

```bash
./create_wallet.sh wallets/reference-wallet
./create_wallet.sh wallets/user-1-wallet
./create_wallet.sh wallets/user-2-wallet
```

## Data Setup

The path to the cardano-cli and the cardano node socket must be defined in `path_to_cli.sh` and `path_to_socket.sh`, located inside the data folder.

## Using The Scripts

The scripts in `seedelf/` run the Python backend in `seedelf/backend/venv`: run `bash setup.sh` from inside `seedelf/backend` once first, since it makes the venv where it's run.

First, create the script reference UTxOs with `00_createScriptReferences.sh`.

Second, go to the seedelf folder and create a seed elf token with `01_createAddress.sh`. The script expects a string as the input variable.

```bash
./01_createAddress.sh Alice
```

This will produce an address file inside the addrs folder. The name of the file is the seedelf token name. It will be used inside the `02_burnAddress.sh` and `00_checkBalance.sh` files. If the seedelf is minted properly then the seedelf can be burned with the `02_burnAddress.sh` file.

```bash
./02_burnAddress.sh seedelf_name_here
```

To send lovelace to a seedelf, and to spend from one seedelf to another:

```bash
./03_sendToSeedElf.sh seedelf_name_here 5000000                      # the amount must be over 2,000,000
./04_spendFunds.sh your_seedelf_name amount their_seedelf_name
```

The bash scripts should automatically calculate the bls12-381 curve points that are valid.
