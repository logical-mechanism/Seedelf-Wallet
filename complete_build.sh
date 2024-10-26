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
echo -e "\033[1;34m\nCompiling Contracts \033[0m"

# remove all traces
aiken build --trace-level silent --filter-traces user-defined

# keep the traces for testing if required
# aiken build --trace-level verbose --filter-traces all

ran="09"
ran_cbor=$(python3 -c "import cbor2;encoded = cbor2.dumps(bytes.fromhex('${ran}'));print(encoded.hex())")

echo -e "\033[1;37m\nBuilding Wallet Contract \033[0m"
aiken blueprint apply -o plutus.json -v wallet.contract.spend "${ran_cbor}"
aiken blueprint convert -v wallet.contract.spend > contracts/wallet_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/wallet_contract.plutus > hashes/wallet.hash
echo -e "\033[1;33m Wallet Contract Hash: $(cat hashes/wallet.hash) \033[0m"

echo -e "\033[1;37m\nBuilding Seedelf Contract \033[0m"
aiken blueprint apply -o plutus.json -v seedelf.contract.mint "${ran_cbor}"
aiken blueprint convert -v seedelf.contract.mint > contracts/seedelf_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/seedelf_contract.plutus > hashes/seedelf.hash
echo -e "\033[1;33m Seedelf Contract Hash: $(cat hashes/seedelf.hash) \033[0m"

echo -e "\033[1;37m\nBuilding Always False Contract \033[0m"
aiken blueprint apply -o plutus.json -v always_false.contract.else "${ran_cbor}"
aiken blueprint convert -v always_false.contract.else > contracts/always_false_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/always_false_contract.plutus > hashes/always_false.hash
echo -e "\033[1;33m Always False Contract Hash: $(cat hashes/always_false.hash) \033[0m"

# end of build
echo -e "\033[1;32m\nCompiling Complete! \033[0m"
