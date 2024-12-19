#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source ../.env
source ./query.sh
source backend/venv/bin/activate

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

secret_key=$(python -c "import json; print(json.load(open('addrs/${source_token_file_name}'))['secret'])")

wallet_utxo_data=$(python3 -c "
from backend import find;
us = find.all_utxos_but_seedelf(${secret_key}, '${policy_id}', '${1}');
print(us)
")
echo -e "\033[0;37m\nSender\033[0m"
generator=$(echo $wallet_utxo_data | jq -r '.[].a')
echo Generator: ${generator}

public=$(echo $wallet_utxo_data | jq -r '.[].b')
echo Public: ${public}

wallet_tx_in=$(echo ${wallet_utxo_data} | jq -r 'keys[0]')
echo UTxO: ${wallet_tx_in}

current_amount=$(echo ${wallet_utxo_data} | jq -r '.[].value.lovelace')
change_amount=$((${current_amount} - ${sending_amount}))

address_file_path="addrs/${source_token_file_name}"
change_datum_file_path="../data/wallet/change-wallet-datum.json"
receiver_datum_file_path="../data/wallet/receiver-wallet-datum.json"

python3 -c "
from backend import wallet;
wallet.convert_address_file_to_wallet_datum('${address_file_path}', '${change_datum_file_path}', randomize=True);
"

echo -e "\033[0;37m\nReceiver\033[0m"

seedelf=$(python3 -c "
from backend import find;
s = find.seedelf('${policy_id}', '${3}');
print(s)
")

receiver_generator=$(echo $seedelf | jq -r '.[].a')
echo Generator: ${receiver_generator}

receiver_public=$(echo $seedelf | jq -r '.[].b')
echo Public: ${receiver_public}

python3 -c "
from backend import wallet;
wallet.randomized_datum('${receiver_generator}', '${receiver_public}', '${receiver_datum_file_path}');
"

echo -e "\033[0;37m\nOutputs\033[0m"
# we need the change output
tmp_fee=300000
change_output="${wallet_script_address} + $((${change_amount} - ${tmp_fee}))"
echo "Change Output: "${change_output}

# we need the receiver output
receiver_output="${wallet_script_address} + ${sending_amount}"
echo "Receiver Output: "${receiver_output}

python3 -c "
from backend import wallet;
wallet.create_proof(${secret_key}, '${generator}', '${public}', '${user_pkh}', '../data/wallet/wallet-redeemer.json')
"

jq --arg variable ${user_pkh} '.fields[2].bytes=$variable' ../data/wallet/wallet-redeemer.json | sponge ../data/wallet/wallet-redeemer.json

#
# exit
#

# collat info
collat_tx_in="1d388e615da2dca607e28f704130d04e39da6f251d551d66d054b75607e0393f#0"
collat_pkh="7c24c22d1dc252d31f6022ff22ccc838c2ab83a461172d7c2dae61f4"

# script reference utxo
wallet_ref_utxo=$(${cli} conway transaction txid --tx-file ../tmp/utxo-wallet_contract.plutus.signed)
echo Reference UTxO: ${wallet_ref_utxo}

execution_units="(0, 0)"

echo -e "\033[0;36m Building Tx \033[0m"
${cli} conway transaction build-raw \
    --protocol-params-file ../tmp/protocol.json \
    --out-file ../tmp/tx.draft \
    --tx-in-collateral ${collat_tx_in} \
    --tx-in ${wallet_tx_in} \
    --spending-tx-in-reference="${wallet_ref_utxo}#1" \
    --spending-plutus-script-v3 \
    --spending-reference-tx-in-inline-datum-present \
    --spending-reference-tx-in-redeemer-file ../data/wallet/wallet-redeemer.json \
    --spending-reference-tx-in-execution-units="${execution_units}" \
    --tx-out="${change_output}" \
    --tx-out-inline-datum-file ${change_datum_file_path} \
    --tx-out="${receiver_output}" \
    --tx-out-inline-datum-file ${receiver_datum_file_path} \
    --required-signer-hash ${collat_pkh} \
    --required-signer-hash ${user_pkh} \
    --fee ${tmp_fee}


python3 -c "
from backend import tx_simulation;
import json;
exe_units=tx_simulation.from_file('../tmp/tx.draft', False, debug=False);
print(json.dumps(exe_units))" > ../data/exe_units.json

cat ../data/exe_units.json
if [ "$(cat ../data/exe_units.json)" = '[{}]' ]; then
    echo "Validation Failed."
    exit 1
else
    echo "Validation Success."
fi

cpu=$(jq -r '.[].cpu' ../data/exe_units.json)
mem=$(jq -r '.[].mem' ../data/exe_units.json)

execution_units="(${cpu}, ${mem})"
computation_fee=$(echo "0.0000721*${cpu} + 0.0577*${mem}" | bc)
computation_fee_int=$(printf "%.0f" "$computation_fee")
echo ${execution_units} ${computation_fee_int}

size=$(jq -r '.cborHex' ${wallet_script_path} | awk '{print length($0)}')

FEE=$(${cli} conway transaction calculate-min-fee \
    --tx-body-file ../tmp/tx.draft \
    --protocol-params-file ../tmp/protocol.json \
    --reference-script-size ${size} \
    --witness-count 2)
echo -e "\033[0;35mFEE: ${FEE} \033[0m"
fee=$(echo $FEE | rev | cut -c 9- | rev)

total_fee=$((${fee} + ${computation_fee_int}))
echo Total Fee: $total_fee

change_output="${wallet_script_address} + $((${change_amount} - ${total_fee}))"
echo "NEW Change Output:" ${change_output}

${cli} conway transaction build-raw \
    --protocol-params-file ../tmp/protocol.json \
    --out-file ../tmp/tx.draft \
    --tx-in-collateral ${collat_tx_in} \
    --tx-in ${wallet_tx_in} \
    --spending-tx-in-reference="${wallet_ref_utxo}#1" \
    --spending-plutus-script-v3 \
    --spending-reference-tx-in-inline-datum-present \
    --spending-reference-tx-in-redeemer-file ../data/wallet/wallet-redeemer.json \
    --spending-reference-tx-in-execution-units="${execution_units}" \
    --tx-out="${change_output}" \
    --tx-out-inline-datum-file ${change_datum_file_path} \
    --tx-out="${receiver_output}" \
    --tx-out-inline-datum-file ${receiver_datum_file_path} \
    --required-signer-hash ${collat_pkh} \
    --required-signer-hash ${user_pkh} \
    --fee ${total_fee}

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
echo "Tx Hash:" $tx