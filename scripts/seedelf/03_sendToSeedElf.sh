#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source ../.env

# get params
${cli} conway query protocol-parameters ${network} --out-file ../tmp/protocol.json

# user
user="user-2"
user_address=$(cat ../wallets/${user}-wallet/payment.addr)
user_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/${user}-wallet/payment.vkey)

# wallet script
wallet_script_path="../../contracts/wallet_contract.plutus"
wallet_script_address=$(${cli} conway address build --payment-script-file ${wallet_script_path} ${network})

if [[ $# -ne 2 ]] ; then
    echo -e "\n \033[0;31m Please Supply A Token Name and Amount \033[0m \n"
    echo -e "\n \033[0;31m ./03_sendAmt.sh token_name amount \033[0m \n"
    exit
fi

# Check if the second argument is a number (to prevent errors in comparison)
if ! [[ $2 =~ ^[0-9]+$ ]] ; then
    echo -e "\n \033[0;31m The amount must be a number \033[0m \n";
    exit 1
fi

# Check if the second argument is greater than 2,000,000, min ada here is like 1.9 or so
if [[ $2 -lt 2000000 ]] ; then
    echo -e "\n \033[0;31m The amount must be greater than 2,000,000 \033[0m \n";
    exit 1
fi

echo -e "\033[0;33m\nSending ${2} Lovelace To Seed Elf: ${1}\n\033[0m"

# the minting script policy
policy_id=$(cat ../../hashes/seedelf.hash)

wallet_script_out="${wallet_script_address} + ${2}"
echo "wallet Output: "${wallet_script_out}

# get script utxo
echo -e "\033[0;36m Gathering wallet UTxO Information  \033[0m"
${cli} conway query utxo \
    --address ${wallet_script_address} \
    ${network} \
    --out-file ../tmp/script_utxo.json
TXNS=$(jq length ../tmp/script_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${wallet_script_address} \033[0m \n";
   exit;
fi

python3 -c "
import sys;
sys.path.append('../py/');
import find;
find.address('${policy_id}', '${1}');
"
#
# exit
#
# get user utxo
echo -e "\033[0;36m Gathering UTxO Information  \033[0m"
${cli} conway query utxo \
    ${network} \
    --address ${user_address} \
    --out-file ../tmp/user_utxo.json

TXNS=$(jq length ../tmp/user_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${user_address} \033[0m \n";
   exit;
fi
alltxin=""
TXIN=$(jq -r --arg alltxin "" 'keys[] | . + $alltxin + " --tx-in"' ../tmp/user_utxo.json)
user_tx_in=${TXIN::-8}

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ../tmp/tx.draft \
    --change-address ${user_address} \
    --tx-in ${user_tx_in} \
    --tx-out="${wallet_script_out}" \
    --tx-out-inline-datum-file ../data/wallet/wallet-datum.json \
    --required-signer-hash ${user_pkh} \
    ${network})

IFS=':' read -ra VALUE <<< "${FEE}"
IFS=' ' read -ra FEE <<< "${VALUE[1]}"
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
