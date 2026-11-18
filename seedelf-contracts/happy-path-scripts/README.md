# Happy Path Scripts

Bash scripts that walk Seedelf's contracts through their happy path on preprod, Cardano's test network, with `cardano-cli`: create two Seedelfs, pay one, spend from one to the other, and burn them. Seedelf is a stealth wallet for Cardano, and a Seedelf is an NFT whose name works like an ADA Handle for its contract (see the root [README](../../README.md)). The scripts are for testing the contracts, and as a reference for the shape of each contract's transactions. To use Seedelf, use the [Seedelf Wallet](../../seedelf-platform/seedelf-web-wallet/README.md) for Chrome or the [seedelf-cli](../../seedelf-platform/README.md).

What the scripts make is invisible to the `seedelf-cli` and the Seedelf Wallet. The scripts use the contracts in `seedelf-contracts/contracts/` and `seedelf-contracts/hashes/` (`../../contracts/` and `../../hashes/` from `seedelf/`), which aren't the version deployed on mainnet and preprod, and the CLI and the Seedelf Wallet use the deployed version's hashes (see [the contracts' README](../README.md#deployed-contracts-version-1)).

## What they need

- `cardano-cli` and a synced preprod node's socket.
- `jq`, `xxd`, `bc`, `sponge` (from moreutils) and `curl`.
- `python3`, for the backend in `seedelf/backend/`, which computes the BLS12-381 points and proofs.
- A connection to `giveme.my`: the minting, burning and spending scripts ask its preprod collateral service to witness their collateral.

## Wallet Setup

The scripts need four wallets, made from inside this folder. The reference wallet pays for the reference scripts. User 1 pays to create and burn Seedelfs, and signs spends. User 2 pays funds into a Seedelf. The collat wallet's key only adds a signature to `03_sendToSeedElf.sh`'s transaction, and needs no funds.

```bash
./create_wallet.sh wallets/reference-wallet
./create_wallet.sh wallets/user-1-wallet
./create_wallet.sh wallets/user-2-wallet
./create_wallet.sh wallets/collat-wallet
```

Send test ADA to the first three wallets' `payment.addr`.

## Data Setup

The path to the cardano-cli and the cardano node socket must be defined in `path_to_cli.sh` and `path_to_socket.sh`, located inside the `data/` folder.

## Using The Scripts

Before the first run, create the Python environment that the scripts in `seedelf/` use, `seedelf/backend/venv`:

```bash
cd seedelf/backend && bash setup.sh
```

Run the steps in this order.

1. **Reference scripts.** From this folder, put the contracts' scripts on chain, held by the always-false script, with `00_createScriptReferences.sh`.
2. **Two Seedelfs.** Go to the `seedelf/` folder and create two Seedelfs, Alice's and Bob's, with `01_createAddress.sh` (a Seedelf acts as an address people pay); user 1's wallet pays for both. The script takes a personal tag as its input, a string cut to 15 bytes; with none, the tag is empty.

   ```bash
   ./01_createAddress.sh Alice
   ./01_createAddress.sh Bob
   ```

   Each run writes a file inside the `addrs/` folder, named by the Seedelf's token name. The file holds the Seedelf's secret in plain text: whoever has it can spend from that Seedelf. The other scripts take that token name.
3. **Pay a Seedelf.** Send lovelace to Alice's Seedelf. The script reads her register (the datum a Seedelf's funds sit under: a generator and a public value, two BLS12-381 points) from her file in `addrs/` and re-randomizes it for the payment. It refuses less than 2,000,000 lovelace, about the least ADA such a UTxO can hold.

   ```bash
   ./03_sendToSeedElf.sh alice_seedelf_name 5000000
   ```

4. **Spend from one Seedelf to another.** Send part of Alice's payment on to Bob's Seedelf. It needs Alice's file in `addrs/`, and the payment from step 3, which must hold more than the amount, in lovelace: the change and the fee come out of it too. It finds Bob's register on chain, by his Seedelf token.

   ```bash
   ./04_spendFunds.sh alice_seedelf_name amount bob_seedelf_name
   ```

5. **Burn a Seedelf.** Burn a Seedelf token and take back the UTxO that holds it, with `02_burnAddress.sh`. Burn last: the other scripts need the Seedelf.

   ```bash
   ./02_burnAddress.sh seedelf_name_here
   ```

From `seedelf/`, at any step, `00_checkBalance.sh seedelf_name_here` shows what a Seedelf holds, leaving out the UTxO that holds its token. It prints the Seedelf's secret too.
