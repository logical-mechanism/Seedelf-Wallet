#!/bin/bash
set -e

# SET UP VARS HERE
source ../.env

# get params
${cli} conway query protocol-parameters ${network} --out-file ../tmp/protocol.json

# user
user="user-1"
user_address=$(cat ../wallets/${user}-wallet/payment.addr)
user_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/${user}-wallet/payment.vkey)

# walletscript
wallet_script_path="../../contracts/wallet_contract.plutus"
wallet_script_address=$(${cli} conway address build --payment-script-file ${wallet_script_path} ${network})

# collat
collat_address=$(cat ../wallets/collat-wallet/payment.addr)
collat_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/collat-wallet/payment.vkey)

# pointer script
pointer_script_path="../../contracts/pointer_contract.plutus"

# the minting script policy
policy_id=$(cat ../../hashes/pointer.hash)

if [[ $# -eq 0 ]] ; then
    echo -e "\n \033[0;31m Please Supply A Token Name \033[0m \n";
    exit;
fi

token_file_name="${1}.json"
echo -e "\033[0;33m\nBurning Seed Elf: ${1}\n\033[0m"

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

secret_key=$(python -c "import json; print(json.load(open('addrs/${token_file_name}'))['secret'])")
echo -e "\033[0;33m\nSecret Key: ${secret_key}\n\033[0m"

generator=$(python3 -c "
import sys;
sys.path.append('../py/');
import find;
g = find.generator('${policy_id}', '${1}');
print(g)
")
echo Generator: ${generator}

public=$(python3 -c "
import sys;
sys.path.append('../py/');
import find;
g = find.public('${policy_id}', '${1}');
print(g)
")
echo Public: ${public}

python3 -c "
import sys;
sys.path.append('../py/');
import bls12_381;
bls12_381.create_dlog_zk(${secret_key}, '${generator}', '${public}');
"

wallet_tx_in=$(python3 -c "
import sys;
sys.path.append('../py/');
import find;
u = find.address_utxo('${policy_id}', '${1}');
print(u)
")
echo Address UTxO: ${wallet_tx_in}
#
exit
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

echo FEE Payment UTxO: ${user_tx_in}

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
wallet_ref_utxo=$(${cli} conway transaction txid --tx-file ../tmp/utxo-wallet_contract.plutus.signed)
pointer_ref_utxo=$(${cli} conway transaction txid --tx-file ../tmp/utxo-pointer_contract.plutus.signed)

echo Wallet Reference UTxO: ${wallet_ref_utxo}
echo Pointer Reference UTxO: ${pointer_ref_utxo}

mint_token="-1 ${policy_id}.${1}"
echo Burning: ${mint_token}

jq --arg variable "" '.bytes=$variable' ../data/pointer/pointer-redeemer.json | sponge ../data/pointer/pointer-redeemer.json

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ../tmp/tx.draft \
    --change-address ${user_address} \
    --tx-in-collateral ${collat_tx_in} \
    --tx-in ${user_tx_in} \
    --tx-in ${wallet_tx_in} \
    --spending-tx-in-reference="${wallet_ref_utxo}#1" \
    --spending-plutus-script-v3 \
    --spending-reference-tx-in-inline-datum-present \
    --spending-reference-tx-in-redeemer-file ../data/wallet/wallet-redeemer.json \
    --required-signer-hash ${user_pkh} \
    --required-signer-hash ${collat_pkh} \
    --mint="${mint_token}" \
    --mint-tx-in-reference="${pointer_ref_utxo}#1" \
    --mint-plutus-script-v3 \
    --policy-id="${policy_id}" \
    --mint-reference-tx-in-redeemer-file ../data/pointer/pointer-redeemer.json \
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

rm addrs/${token_file_name}