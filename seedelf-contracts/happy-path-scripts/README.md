# Happy Path Scripts

The scipts are designed to be used in sequential order.

## Wallet Setup

We need a collateral, reference, and two user wallets.

```bash
./create_wallet.sh wallets/reference-wallet
./create_wallet.sh wallets/user-1-wallet
./create_wallet.sh wallets/user-2-wallet
```

## Data Setup

The path to the cli and the node socket must be defined in `path_to_cli.sh` and `path_to_socket.sh` inside the data folder.

## Using The Scripts

First, create the script reference UTxOs with `00_createScriptReferences.sh`.

Second, go to the seedelf folder and create a seed elf token with `01_createAddressUtxO.sh`. The script expects a string as the input variable.

```bash
./01_createAddressUtxO.sh Alice
```

This will produce an address file inside the addrs folder. The name of the file is the seedelf token name. It will be used inside the `02_burnAddress.sh` and `00_checkBalance.sh` files. If the seed elf is minted properly then the seedelf can be burned with the `02_burnAddress.sh` file.

```bash
./02_burnAddress.sh seedelf_name_here
```

The bash scripts should automatically calculate the bls12-381 curve points that are valid.
