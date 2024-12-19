#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source ../.env
source backend/venv/bin/activate


# wallet script
wallet_script_path="../../contracts/wallet_contract.plutus"
wallet_script_address=$(${cli} conway address build --payment-script-file ${wallet_script_path} ${network})

# the minting script policy
policy_id=$(cat ../../hashes/seedelf.hash)

if [[ $# -eq 0 ]] ; then
    echo -e "\n \033[0;31m Please Supply A Token Name \033[0m \n";
    exit
fi

address_file_name="${1}.json"
address_file_path="addrs/${address_file_name}"
echo -e "\033[0;32m\nFinding Balance For ${1}\n\033[0m"

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

secret_key=$(python -c "import json; print(json.load(open('${address_file_path}'))['secret'])")
echo -e "\033[0;33m\nSecret Key: ${secret_key}\n\033[0m"

python3 -c "
from backend import find, value;
import json;
u = json.loads(find.all_utxos_but_seedelf(${secret_key}, '${policy_id}', '${1}'));
print('UTxO Information:\n');
values = {}
for utxo in u:
    print(utxo, u[utxo]['value'])
    values[utxo] = u[utxo]['value']
m = value.combine(values)
print(f'\nTotal Value: {m}\n')
"