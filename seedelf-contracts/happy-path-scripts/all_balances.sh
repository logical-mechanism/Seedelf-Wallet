#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source .env

# wallet contract
wallet_script_path="../contracts/wallet_contract.plutus"
wallet_script_address=$(${cli} address build --payment-script-file ${wallet_script_path} ${network})

# always false to hold script utxo
always_false_script_path="../contracts/always_false_contract.plutus"
script_reference_address=$(${cli} conway address build --payment-script-file ${always_false_script_path} ${network})

# get current parameters
mkdir -p ./tmp
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json
${cli} conway query tip ${network} | jq

# wallet
echo -e "\033[1;35m Wallet Contract Address: \033[0m" 
echo -e "\n \033[1;35m ${wallet_script_address} \033[0m \n";
${cli} conway query utxo --address ${wallet_script_address} ${network}
${cli} conway query utxo --address ${wallet_script_address} ${network} --out-file ./tmp/script_utxo.json

# wallet
echo -e "\033[1;35m Script Reference UTxOs: \033[0m" 
echo -e "\n \033[1;35m ${script_reference_address} \033[0m \n";
${cli} conway query utxo --address ${script_reference_address} ${network}

# Loop through each -wallet folder
for wallet_folder in wallets/*-wallet; do
    # Check if payment.addr file exists in the folder
    if [ -f "${wallet_folder}/payment.addr" ]; then
        addr=$(cat ${wallet_folder}/payment.addr)
        echo
        
        echo -e "\033[1;37m --------------------------------------------------------------------------------\033[0m"
        echo -e "\033[1;34m $wallet_folder\033[0m\n\n\033[1;32m $addr\033[0m"
        

        echo -e "\033[1;33m"
        # Run the cardano-cli command with the reference address and testnet magic
        ${cli} conway query utxo --address ${addr} ${network}
        ${cli} conway query utxo --address ${addr} ${network} --out-file ./tmp/"${addr}.json"

        baseLovelace=$(jq '[.. | objects | .lovelace] | add' ./tmp/"${addr}.json")
        echo -e "\033[0m"

        echo -e "\033[1;36m"
        ada=$(echo "scale = 6;${baseLovelace} / 1000000" | bc -l)
        echo -e "TOTAL ADA:" ${ada}
        echo -e "\033[0m"
    fi
done


${cli} conway query ref-script-size \
    --tx-in "f620a4e949bfbefbf2892d39d0777439f3acfbf850eae9b007c6558ba8ef4db4#1" \
    ${network} \
    --output-json


${cli} conway query ref-script-size \
    --tx-in "96fbddac63c55284fbbaa3c216ef1c0f460019e8643a889a189d5b5f7ddd71d6#1" \
    ${network} \
    --output-json