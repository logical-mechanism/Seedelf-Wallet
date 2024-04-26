#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source .env

# rm tmp/tx.signed || True

# Addresses
sender_path="wallets/user-2-wallet/"
sender_address=$(cat ${sender_path}payment.addr)
# receiver_address=$(cat ${sender_path}payment.addr)
# receiver_address=$(cat wallets/user-1-wallet/payment.addr)
# receiver_address="addr_test1qrvnxkaylr4upwxfxctpxpcumj0fl6fdujdc72j8sgpraa9l4gu9er4t0w7udjvt2pqngddn6q4h8h3uv38p8p9cq82qav4lmp"
receiver_address="addr_test1vrew3fk26vrq3d25sanfl89r2ucrrp6dgk3tsntksm9pacgu662xn"

# ENTER ASSISTS HERE
assets="1 f97431da7b760ffda3f830734d44bea09d7238c801098304c1d2a59a.283232322900bc812bab23541dfb2ea4edbd35d0357ca1a04896b088cb5fbed7"

min_utxo=$(${cli} conway transaction calculate-min-required-utxo \
    --protocol-params-file tmp/protocol.json \
    --tx-out="${receiver_address} + 5000000 + ${assets}" | tr -dc '0-9')

# tokens_to_be_traded="${receiver_address} + ${min_utxo} + ${assets}"
tokens_to_be_traded="${receiver_address} + 500000000"

echo -e "\nTrading Tokens:\n" ${tokens_to_be_traded}
#
# exit
#
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
alltxin=""
TXIN=$(jq -r --arg alltxin "" 'keys[] | . + $alltxin + " --tx-in"' tmp/sender_utxo.json)
seller_tx_in=${TXIN::-8}

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file tmp/tx.draft \
    --change-address ${sender_address} \
    --tx-in ${seller_tx_in} \
    --tx-out="${tokens_to_be_traded}" \
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
    --signing-key-file ${sender_path}payment.skey \
    --tx-body-file tmp/tx.draft \
    --out-file tmp/tx.signed \
    ${network}
#
# exit
#
echo -e "\033[0;36m Submitting \033[0m"
${cli} conway transaction submit \
    ${network} \
    --tx-file tmp/tx.signed
