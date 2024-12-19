#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source ../.env
source backend/venv/bin/activate
source ./query.sh

# get params
${cli} conway query protocol-parameters ${network} --out-file ../tmp/protocol.json

# user
user="user-1"
user_address=$(cat ../wallets/${user}-wallet/payment.addr)
user_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/${user}-wallet/payment.vkey)

# seedelf script
seedelf_script_path="../../contracts/seedelf_contract.plutus"
seedelf_script_address=$(${cli} conway address build --payment-script-file ${seedelf_script_path} ${network})

# wallet script
wallet_script_path="../../contracts/wallet_contract.plutus"
wallet_script_address=$(${cli} conway address build --payment-script-file ${wallet_script_path} ${network})

# the minting script policy
policy_id=$(cat ../../hashes/seedelf.hash)

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

seedelf=$(python3 -c "
from backend import find;
s = find.seedelf('${policy_id}', '${1}');
print(s)
")

wallet_tx_in=$(echo $seedelf | jq -r 'keys[0]')
echo Address UTxO: ${wallet_tx_in}

generator=$(echo $seedelf | jq -r '.[].a')
echo Generator: ${generator}

public=$(echo $seedelf | jq -r '.[].b')
echo Public: ${public}

python3 -c "
from backend import wallet;
wallet.create_proof(${secret_key}, '${generator}', '${public}', '${user_pkh}', '../data/wallet/wallet-redeemer.json')
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

echo FEE Payment UTxO: ${user_tx_in}

# script reference utxo
seedelf_ref_utxo=$(${cli} conway transaction txid --tx-file ../tmp/utxo-seedelf_contract.plutus.signed)
wallet_ref_utxo=$(${cli} conway transaction txid --tx-file ../tmp/utxo-wallet_contract.plutus.signed)

echo Reference UTxO: ${seedelf_ref_utxo}
echo Reference UTxO: ${wallet_ref_utxo}

mint_token="-1 ${policy_id}.${1}"
echo Burning: ${mint_token}

jq --arg variable "" '.bytes=$variable' ../data/pointer/pointer-redeemer.json | sponge ../data/pointer/pointer-redeemer.json

jq --arg variable ${user_pkh} '.fields[2].bytes=$variable' ../data/wallet/wallet-redeemer.json | sponge ../data/wallet/wallet-redeemer.json

collat_tx_in="1d388e615da2dca607e28f704130d04e39da6f251d551d66d054b75607e0393f#0"
collat_pkh="7c24c22d1dc252d31f6022ff22ccc838c2ab83a461172d7c2dae61f4"

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
    --mint-tx-in-reference="${seedelf_ref_utxo}#1" \
    --mint-plutus-script-v3 \
    --policy-id="${policy_id}" \
    --mint-reference-tx-in-redeemer-file ../data/pointer/pointer-redeemer.json \
    ${network})

echo -e "\033[1;32m ${FEE} \033[0m"
#
# exit
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

tx=$(${cli} conway transaction txid --tx-file ../tmp/tx.signed)
echo "TxId:" $tx

rm addrs/${token_file_name}