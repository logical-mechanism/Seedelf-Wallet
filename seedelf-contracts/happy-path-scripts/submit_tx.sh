#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source .env

echo -e "\033[0;36m Submitting \033[0m"
${cli} conway transaction submit \
    ${network} \
    --tx-file ./tmp/test.tx


tx=$(${cli} conway transaction txid --tx-file ./tmp/test.tx)
echo "Tx Id:" $tx