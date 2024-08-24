#!/usr/bin/env bash
set -e

# create directories if dont exist
mkdir -p contracts
mkdir -p hashes

# remove old files
rm contracts/* || true
rm hashes/* || true
rm -fr build/ || true

# build out the entire script
echo -e "\033[1;34m\nBuilding Contracts \033[0m"

# remove all traces
# aiken build --trace-level silent --filter-traces user-defined

# keep the traces for testing if required
aiken build --trace-level verbose --filter-traces all

ran="acab"
ran_cbor=$(python3 -c "import cbor2;hex_string='${ran}';data = bytes.fromhex(hex_string);encoded = cbor2.dumps(data);print(encoded.hex())")

echo -e "\033[1;33m\nBuilding Pointer Contract \033[0m"
aiken blueprint apply -o plutus.json -v pointer.params "${ran_cbor}"
aiken blueprint convert -v pointer.params > contracts/pointer_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/pointer_contract.plutus > hashes/pointer.hash
echo -e "\033[1;33m Pointer Contract Hash: $(cat hashes/pointer.hash) \033[0m"

echo -e "\033[1;33m\nBuilding Wallet Contract \033[0m"
aiken blueprint convert -v wallet.params > contracts/wallet_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/wallet_contract.plutus > hashes/wallet.hash
echo -e "\033[1;33m Wallet Contract Hash: $(cat hashes/wallet.hash) \033[0m"

# end of build
echo -e "\033[1;32m\nBuilding Complete! \033[0m"
