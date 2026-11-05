#!/usr/bin/env bash
# Rebuilds and checks the Audit.Seedelf control scripts from the deployed bytes (read-only on the
# repo). Never deploy any of them.
#  1. decode the deployed wallet (concrete/build/wallet.flat), compact it, and check that
#     re-encoding it gives Seedelf/Scripts/wallet.hex byte for byte;
#  2. mutate.py: the three one-term mutants; encode each (one CBOR layer, hex, as #import_uplc reads);
#  3. alpha.py: each hex decodes back to its mutant, up to variable names;
#  4. wallet_mutants.sh and policy_scenarios.sh: Aiken's evaluator on the honest vectors.
cd "$(dirname "$0")" || exit 1
SV=/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/seedelf-verification
A=~/.aiken/bin/aiken
$A uplc decode "$SV/concrete/build/wallet.flat" | python3 -I -c "
import re,sys
s=re.sub(r'\s+',' ',sys.stdin.read()).strip()
print(s.replace('( ','(').replace(' )',')').replace('[ ','[').replace(' ]',']'))" > wallet.compact.uplc
[ "$($A uplc encode --cbor --hex wallet.compact.uplc)" = "$(tr -d '\n' < "$SV/Seedelf/Scripts/wallet.hex")" ] \
  && echo "deployed wallet round-trips: ok" || echo "deployed wallet round-trip: MISMATCH"
python3 -I mutate.py
for n in wallet_no_signer wallet_no_schnorr wallet_no_vkh_in_challenge always_true; do
  $A uplc encode --cbor --hex $n.uplc > $n.hex && $A uplc encode $n.uplc > $n.flat
  $A uplc decode --cbor --hex $n.hex > $n.fromhex.txt
done
python3 -I alpha.py
./wallet_mutants.sh
./policy_scenarios.sh
