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

echo -e "\033[1;33m\nBuilding Contract \033[0m"
aiken blueprint convert -v seedelf.wallet.spend > contracts/seedelf_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/seedelf_contract.plutus > hashes/seedelf.hash
echo -e "\033[1;33m Contract Hash: $(cat hashes/seedelf.hash) \033[0m"

# end of build
echo -e "\033[1;32m\nBuilding Complete! \033[0m"
