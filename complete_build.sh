#!/usr/bin/env bash
set -e

# create directories if they dont exist
mkdir -p contracts
mkdir -p hashes

# remove old files
rm contracts/* || true
rm hashes/* || true

# delete the build folder
rm -fr build/ || true

# compile the scripts with aiken build
echo -e "\033[1;34m\nCompiling...\033[0m"

# remove all traces
aiken build --trace-level silent --trace-filter user-defined

# keep the traces for testing if required
# aiken build --trace-level verbose --trace-filter all

# some random string to make the contracts unique
rand=$(head /dev/urandom | tr -dc a-f0-9 | head -c 16)
rand_cbor=$(python3 -c "import cbor2; print(cbor2.dumps(bytes.fromhex('${rand}')).hex())")
echo "Random Seed:" ${rand}

# build and apply parameters to each contract
echo -e "\033[1;37m\nBuilding Wallet Contract\033[0m"
aiken blueprint apply -o plutus.json -m wallet "${rand_cbor}"
aiken blueprint convert -m wallet > contracts/wallet_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/wallet_contract.plutus > hashes/wallet.hash
echo -e "\033[1;33m Wallet Contract Hash: $(cat hashes/wallet.hash)\033[0m"

echo -e "\033[1;37m\nBuilding Seedelf Contract\033[0m"
aiken blueprint apply -o plutus.json -m seedelf "${rand_cbor}"
aiken blueprint convert -m seedelf > contracts/seedelf_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/seedelf_contract.plutus > hashes/seedelf.hash
echo -e "\033[1;33m Seedelf Contract Hash: $(cat hashes/seedelf.hash)\033[0m"

echo -e "\033[1;37m\nBuilding Always False Contract\033[0m"
aiken blueprint apply -o plutus.json -m always_false "${rand_cbor}"
aiken blueprint convert -m always_false > contracts/always_false_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/always_false_contract.plutus > hashes/always_false.hash
echo -e "\033[1;33m Always False Contract Hash: $(cat hashes/always_false.hash)\033[0m"

# end of build
echo -e "\033[1;32m\nComplete!\033[0m"
