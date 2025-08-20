#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source .env

# Addresses
sender_path="wallets/user-1-wallet/"
sender_address=$(cat ${sender_path}payment.addr)
receiver_address=$(cat ${sender_path}payment.addr)

echo -e "\033[0;36m Gathering UTxO Information  \033[0m"
${cli} conway query utxo \
    ${network} \
    --address ${sender_address} \
    --out-file tmp/sender_utxo.json

TXNS=$(jq length tmp/sender_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${sender_address} \033[0m \n";
   exit;
fi
TXIN=$(jq -r --arg alltxin "" 'keys[] | . + $alltxin + " --tx-in"' tmp/sender_utxo.json)
seller_tx_in=${TXIN::-8}

metadata_path="./data/wallet/metadata.json"

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file tmp/tx.draft \
    --change-address ${receiver_address} \
    --tx-in ${seller_tx_in} \
    --json-metadata-no-schema \
    --metadata-json-file ${metadata_path} \
    ${network})

IFS=':' read -ra VALUE <<< "${FEE}"
IFS=' ' read -ra FEE <<< "${VALUE[1]}"
echo -e "\033[1;32m Fee: \033[0m" $FEE
#
# exit
#
echo -e "\033[0;36m Signing Tx \033[0m"
${cli} conway transaction sign \
    --signing-key-file ${sender_path}payment.skey \
    --tx-body-file tmp/tx.draft \
    --out-file tmp/tx.signed \
    ${network}
#
# exit
#
echo -e "\033[0;36m Submitting Tx \033[0m"
${cli} conway transaction submit \
    ${network} \
    --tx-file tmp/tx.signed