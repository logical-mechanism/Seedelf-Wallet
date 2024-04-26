#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source .env

mkdir -p ./tmp
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json

# Addresses
reference_address=$(cat ./wallets/reference-wallet/payment.addr)
script_reference_address=$(cat ./wallets/reference-wallet/payment.addr)

echo -e "\033[0;35m\nGathering UTxO Information  \033[0m"
${cli} conway query utxo \
    ${network} \
    --address ${reference_address} \
    --out-file ./tmp/reference_utxo.json

TXNS=$(jq length ./tmp/reference_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${reference_address} \033[0m \n";
   exit;
fi
alltxin=""
TXIN=$(jq -r --arg alltxin "" 'to_entries[] | select(.value.value | length < 2) | .key | . + $alltxin + " --tx-in"' ./tmp/reference_utxo.json)
ref_tx_in=${TXIN::-8}
changeAmount=$(jq '[.. | objects | .lovelace] | add' ./tmp/reference_utxo.json)

counter=0
# Loop through each file in the directory
echo -e "\033[0;33m\nStart Building Tx Chain \033[0m"
for contract in $(ls "../contracts"/* | sort -V)
do
    echo -e "\033[1;37m --------------------------------------------------------------------------------\033[0m"
    echo -e "\033[1;35m\n${contract}\033[0m" 
    file_name=$(basename "$contract")
    # Increment the counter
    ((counter++)) || true


    
    # get the required lovelace
    min_utxo=$(${cli} conway transaction calculate-min-required-utxo \
    --protocol-params-file ./tmp/protocol.json \
    --tx-out-reference-script-file ${contract} \
    --tx-out="${script_reference_address} + 1000000" | tr -dc '0-9')
    # build the utxo
    script_reference_utxo="${script_reference_address} + ${min_utxo}"
    echo -e "\033[0;32m\nCreating ${file_name} Script:\n" ${script_reference_utxo} " \033[0m"


    ${cli} conway transaction build-raw \
    --protocol-params-file ./tmp/protocol.json \
    --out-file ./tmp/tx.draft \
    --tx-in ${ref_tx_in} \
    --tx-out="${reference_address} + ${changeAmount}" \
    --tx-out="${script_reference_utxo}" \
    --tx-out-reference-script-file ${contract} \
    --fee 900000

    SIZE=$(${cli} conway query ref-script-size \
        --tx-in ${ref_tx_in} \
        ${network} \
        --output-json | jq .refInputScriptSize
        )
    echo SIZE ${SIZE}
    echo $(stat -c %s ${contract})

    # this is broke
    FEE=$(${cli} conway transaction calculate-min-fee \
        --tx-body-file ./tmp/tx.draft \
        --protocol-params-file ./tmp/protocol.json \
        --reference-script-size 2500 \
        --witness-count 20)
    echo -e "\033[0;35mFEE: ${FEE} \033[0m"
    fee=$(echo $FEE | rev | cut -c 9- | rev)

    changeAmount=$((${changeAmount} - ${min_utxo} - ${fee}))

    ${cli} conway transaction build-raw \
        --protocol-params-file ./tmp/protocol.json \
        --out-file ./tmp/tx.draft \
        --tx-in ${ref_tx_in} \
        --tx-out="${reference_address} + ${changeAmount}" \
        --tx-out="${script_reference_utxo}" \
        --tx-out-reference-script-file ${contract} \
        --fee ${fee}

    ${cli} conway transaction sign \
        --signing-key-file ./wallets/reference-wallet/payment.skey \
        --tx-body-file ./tmp/tx.draft \
        --out-file ./tmp/utxo-${file_name}.signed \
        ${network}

    ref_tx_in=$(${cli} conway transaction txid --tx-body-file ./tmp/tx.draft)#0
    echo 
    echo -e "\033[0;36mNext UTxO: $ref_tx_in \033[0m"

done

echo -e "\033[1;37m --------------------------------------------------------------------------------\033[0m"
# now submit them in that order
for contract in $(ls "../contracts"/* | sort -V)
do
    file_name=$(basename "${contract}")
    echo -e "\nSubmitting ${file_name}"
    # Perform operations on each file
    ${cli} conway transaction submit \
        ${network} \
        --tx-file ./tmp/utxo-${file_name}.signed
done

echo -e "\033[0;32m\nDone!\033[0m"