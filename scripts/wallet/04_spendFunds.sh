#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source ../.env

# get params
${cli} conway query protocol-parameters ${network} --out-file ../tmp/protocol.json

# seedelf script
seedelf_script_path="../../contracts/seedelf_contract.plutus"
seedelf_script_address=$(${cli} conway address build --payment-script-file ${seedelf_script_path} ${network})

# collat
collat_address=$(cat ../wallets/collat-wallet/payment.addr)
collat_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/collat-wallet/payment.vkey)

# the minting script policy
policy_id=$(cat ../../hashes/seedelf.hash)

if [[ $# -ne 3 ]] ; then
    echo -e "\n \033[0;31m Please Supply A Source Token Name, Destination Token Name/Address, And Amount \033[0m \n"
    echo -e "\n \033[0;31m ./04_spendFunds.sh your_seed_elf their_seed_elf/address amount \033[0m \n"
    exit
fi

prefix="addr_"
if [[ ${2} == $prefix* ]]; then
    echo -e "\033[0;33m\nSending ${3} Lovelace To Address: ${2}\n\033[0m"

else
    echo -e "\033[0;33m\nSending ${3} Lovelace To Seed Elf: ${2}\n\033[0m"
fi

token_file_name="${1}.json"

# get script utxo
echo -e "\033[0;36m Gathering wallet UTxO Information  \033[0m"
${cli} conway query utxo \
    --address ${seedelf_script_address} \
    ${network} \
    --out-file ../tmp/script_utxo.json
TXNS=$(jq length ../tmp/script_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${seedelf_script_address} \033[0m \n";
.   exit;
fi

x=$(python -c "import json; print(json.load(open('addrs/${token_file_name}'))['secret'])")

wallet_tx_in=$(python3 -c "
import sys;
sys.path.append('../py/');
import find;
us = find.utxos(${x}, '${policy_id}', '${1}');
print(us)
")
echo $wallet_tx_in
#
exit
#
# collat info
echo -e "\033[0;36m Gathering Collateral UTxO Information  \033[0m"
${cli} conway query utxo \
    ${network} \
    --address ${collat_address} \
    --out-file ../tmp/collat_utxo.json

TXNS=$(jq length ../tmp/collat_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${collat_address} \033[0m \n";
   exit;
fi
collat_tx_in=$(jq -r 'keys[0]' ../tmp/collat_utxo.json)

# script reference utxo
script_ref_utxo=$(${cli} conway transaction txid --tx-file ../tmp/utxo-wallet_contract.plutus.signed)

# --tx-out="${seedelf_script_out}" \
# --tx-out-inline-datum-file ../data/wallet/wallet-datum.json \

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ../tmp/tx.draft \
    --change-address ${user_address} \
    --tx-in-collateral ${collat_tx_in} \
    --tx-in ${wallet_tx_in} \
    --spending-tx-in-reference="${script_ref_utxo}#1" \
    --spending-plutus-script-v3 \
    --spending-reference-tx-in-inline-datum-present \
    --spending-reference-tx-in-redeemer-file ../data/wallet/wallet-redeemer.json \
    --required-signer-hash ${collat_pkh} \
    ${network})

IFS=':' read -ra VALUE <<< "${FEE}"
IFS=' ' read -ra FEE <<< "${VALUE[1]}"
FEE=${FEE[1]}
echo -e "\033[1;32m Fee: \033[0m" $FEE
#
# exit
#
echo -e "\033[0;36m Signing \033[0m"
${cli} conway transaction sign \
    --signing-key-file ../wallets/${user}-wallet/payment.skey \
    --signing-key-file ../wallets/collat-wallet/payment.skey \
    --tx-body-file ../tmp/tx.draft \
    --out-file ../tmp/tx.signed \
    ${network}
#
# exit
#
echo -e "\033[0;36m Submitting \033[0m"
${cli} conway transaction submit \
    ${network} \
    --tx-file ../tmp/tx.signed

tx=$(cardano-cli transaction txid --tx-file ../tmp/tx.signed)
echo "Tx Hash:" $tx