#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source ../.env

source ./query.sh

# get params
${cli} conway query protocol-parameters ${network} --out-file ../tmp/protocol.json

# user
user="user-1"
user_address=$(cat ../wallets/${user}-wallet/payment.addr)
user_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/${user}-wallet/payment.vkey)

# wallet script
wallet_script_path="../../contracts/wallet_contract.plutus"
wallet_script_address=$(${cli} conway address build --payment-script-file ${wallet_script_path} ${network})

# the minting script policy
policy_id=$(cat ../../hashes/seedelf.hash)

if [[ $# -ne 3 ]] ; then
    echo -e "\n \033[0;31m Please Supply A Source Seedelf Amount, And Destination Seedelf\033[0m \n"
    echo -e "\n \033[0;31m ./04_spendFunds.sh your_seed_elf amount their_seed_elf  \033[0m \n"
    exit 1;
fi

source_token_file_name="${1}.json"
sending_amount=${2}
destination_token_file_name="${3}.json"

# get script utxo
echo -e "\033[0;36m Gathering wallet UTxO Information  \033[0m"
${cli} conway query utxo \
    --address ${wallet_script_address} \
    ${network} \
    --out-file ../tmp/script_utxo.json
TXNS=$(jq length ../tmp/script_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${wallet_script_address} \033[0m \n";
.   exit;
fi

x=$(python -c "import json; print(json.load(open('addrs/${source_token_file_name}'))['secret'])")

wallet_utxo_data=$(python3 -c "
import sys, json;
sys.path.append('../py/');
import find;
us = find.utxos(${x}, '${policy_id}', '${1}');
print(json.dumps(us))
")
echo $wallet_utxo_data

wallet_tx_in=$(echo ${wallet_utxo_data} | jq -r 'keys[0]')
current_amount=$(echo ${wallet_utxo_data} | jq -r '.[].lovelace')


change_amount=$((${current_amount} - ${sending_amount}))

# we need the change output
change_output="${wallet_script_address} + ${change_amount}"
echo "Change Output: "${change_output}
# we need the receiver output
receiver_output="${wallet_script_address} + ${sending_amount}"
echo "Receiver Output: "${receiver_output}

#
exit
#

# collat info
collat_tx_in="1d388e615da2dca607e28f704130d04e39da6f251d551d66d054b75607e0393f#0"
collat_pkh="7c24c22d1dc252d31f6022ff22ccc838c2ab83a461172d7c2dae61f4"

# script reference utxo
wallet_ref_utxo=$(${cli} conway transaction txid --tx-file ../tmp/utxo-wallet_contract.plutus.signed)
echo Reference UTxO: ${wallet_ref_utxo}

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ../tmp/tx.draft \
    --change-address ${user_address} \
    --tx-in-collateral ${collat_tx_in} \
    --tx-in ${wallet_tx_in} \
    --spending-tx-in-reference="${wallet_ref_utxo}#1" \
    --spending-plutus-script-v3 \
    --spending-reference-tx-in-inline-datum-present \
    --spending-reference-tx-in-redeemer-file ../data/wallet/wallet-redeemer.json \
    --required-signer-hash ${collat_pkh} \
    --required-signer-hash ${user_pkh} \
    ${network})

IFS=':' read -ra VALUE <<< "${FEE}"
IFS=' ' read -ra FEE <<< "${VALUE[1]}"
FEE=${FEE[1]}
echo -e "\033[1;32m Fee: \033[0m" $FEE
#
exit
#
echo -e "\033[0;36m Collat Witness \033[0m"
tx_cbor=$(cat ../tmp/tx.draft | jq -r '.cborHex')
collat_witness=$(query_witness "$tx_cbor" "preprod")
echo Witness: $collat_witness
echo '{
    "type": "TxWitness ConwayEra",
    "description": "Key Witness ShelleyEra",
    "cborHex": "'"${collat_witness}"'"
}' > ../tmp/collat.witness
#
# exit
#
echo -e "\033[0;36m User Witness \033[0m"
${cli} conway transaction witness \
    --tx-body-file ../tmp/tx.draft \
    --signing-key-file ../wallets/${user}-wallet/payment.skey \
    --out-file ../tmp/tx.witness \
    ${network}
#
# exit
#
echo -e "\033[0;36m Assembling \033[0m"
${cli} conway transaction assemble \
    --tx-body-file ../tmp/tx.draft \
    --witness-file ../tmp/tx.witness \
    --witness-file ../tmp/collat.witness \
    --out-file ../tmp/tx.signed
#
# exit
#
echo -e "\033[0;36m Submitting \033[0m"
${cli} conway transaction submit \
    ${network} \
    --tx-file ../tmp/tx.signed

tx=$(cardano-cli transaction txid --tx-file ../tmp/tx.signed)
echo "Tx Hash:" $tx