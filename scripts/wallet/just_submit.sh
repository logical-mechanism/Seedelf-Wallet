#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source ../.env

mkdir -p ./addrs

# get params
${cli} conway query protocol-parameters ${network} --out-file ../tmp/protocol.json
# user
user="user-1"
user_address=$(cat ../wallets/${user}-wallet/payment.addr)
user_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/${user}-wallet/payment.vkey)
#
# 8200825820f4cf5018246b657d4d156aed8c8eea44302971408d3f72391905682452933464584044d0bf4e490cdb606dea8299c2949140d6b60fd102962395831a6a5c885129fe755517ff124224326a023222346292d37eba6eb671f127e2966752bb775b1307

# ${cli} conway transaction txid --tx-file ../tmp/tx.draft
echo -e "\033[0;36m Witness \033[0m"
${cli} conway transaction witness \
    --tx-body-file ../tmp/tx.draft \
    --signing-key-file ../wallets/${user}-wallet/payment.skey \
    --out-file ../tmp/tx.witness \
    ${network}

${cli} conway transaction assemble \
    --tx-body-file ../tmp/tx.draft \
    --witness-file ../tmp/tx.witness \
    --witness-file ../tmp/collat.witness \
    --out-file ../tmp/tx.signed

echo -e "\033[0;36m Submitting \033[0m"
${cli} conway transaction submit \
    ${network} \
    --tx-file ../tmp/tx.signed

tx=$(${cli} conway transaction txid --tx-file ../tmp/tx.signed)
echo "TxId:" $tx
