import json
import os
import subprocess
import tempfile

import cbor2
import requests
from bech32 import bech32_decode, convertbits


def run_bech32(key: str) -> str:
    """Run bech 32 on some key and return the raw hash.

    Args:
        key (str): The key to decode.

    Returns:
        str: The decoded raw hash.
    """
    try:
        # Bech32 decode
        _, data5 = bech32_decode(key)

        # Convert 5-bit array back to 8-bit
        data8 = convertbits(data5, 5, 8, False)

        hex_string = ''.join(format(x, '02x') for x in data8)

        # remove the network tag
        if hex_string[:2] in ["e0", "00", "60", "10"]:
            return hex_string[2:], False
        else:
            return hex_string[2:], True
    except TypeError:
        raise TypeError(
            "non-standard format in run_bech32() arg at position 1")


def to_bytes(s: str) -> bytes:
    """ Convert the string to bytes and prepend with 'h' to indicate hexadecimal format.
    The bytes representation will be returned else a ValueError is raised.

    Args:
        s (str): The hexadecimal string used in byte conversion

    Returns:
        bytes: A bytestring in proper cbor format.
    """
    try:
        return bytes.fromhex(s)
    except ValueError:
        raise ValueError(
            "non-hexadecimal number found in fromhex() arg at position 1")


def tx_draft_to_resolved_cbor(draft: str) -> list[any]:
    """ Decodes a hexadecimal string representing CBOR data into a Python object.

    Args:
        draft (str): A hexadecimal string representing CBOR data.

    Returns:
        list: A Python object obtained by decoding the CBOR data.

    Raises:
        ValueError: If the input string is not a valid hexadecimal or if the
                    decoded bytes are not valid CBOR data.
    """
    try:
        decoded_data = cbor2.loads(bytes.fromhex(draft))
        return decoded_data
    except ValueError:
        raise ValueError(
            "non-hexadecimal number found in fromhex() arg at position 1")


def query_tx_with_koios(hashes: list[str], network: bool) -> list[dict]:
    """Uses Koios to query the transaction information from a list of
    transaction hashes. The return order may not match the input order.

    Args:
        hashes (list): The list of tx hashes.
        network (bool): The network flag, mainnet (True) or preprod (False).

    Returns:
        list: A list of transaction information.
    """
    # mainnet and preprod only
    subdomain = "api" if network is True else "preprod"

    json_data = {
        '_tx_hashes': hashes,
        '_inputs': True,
        "_metadata": True,
        "_assets": True,
        "_withdrawals": True,
        "_certs": True,
        "_scripts": True,
        "_bytecode": True
    }

    headers = {
        'accept': 'application/json',
        'content-type': 'application/json',
    }

    url = 'https://' + subdomain + '.koios.rest/api/v1/tx_info'
    # return the tx information for a list of transactions, (the inputs)
    return requests.post(url=url, headers=headers, json=json_data).json()


def resolve_inputs(tx_cbor: str) -> tuple[list[tuple[str, int]], list[dict]]:
    """Resolves the inputs and the inputs outputs for some given tx cbor. The returned values are not in
    any specific ordering.

    Args:
        tx_cbor (str): The transaction cbor

    Raises:
        KeyError: The inputs, collateral, and reference inputs must exist inside the tx.

    Returns:
        tuple[list[tuple[str, int]], list[dict]]: A tuple of the utxo inputs and the resolved input outputs.
    """
    # resolve the data from the cbor
    data = tx_draft_to_resolved_cbor(tx_cbor)

    try:
        # we just need the body here
        txBody = data[0]

        # all the types of inputs; tx inputs, collateral, and reference
        inputs = list(txBody[0]) + list(txBody[13]) + list(txBody[18])

        # convert into list of tuples
        inputs = [(utxo[0].hex(), int(utxo[1])) for utxo in inputs]
    except KeyError:
        raise KeyError("required tx body elements are missing")

    return inputs


def resolve_value_from_input_output(lovelace: int, assets: list[dict]) -> int | list:
    """
    Resolves the value from the input or output of a transaction.

    Args:
        lovelace (int): The amount in Lovelace.
        assets (List[Dict[str, Any]]): A list of additional assets involved in the transaction.
            Each asset is represented as a dictionary with keys for 'policy_id', 'asset_name', and 'quantity'.

    Returns:
        Union[int, List[Any]]: The resolved value. Returns an integer if only Lovelace is involved.
            Returns a list containing the Lovelace amount and a dictionary of assets if additional assets are involved.
    """
    # its just an int when its lovelace only
    if len(assets) == 0:
        value = int(lovelace)
    else:
        # build out the token dictionary
        tokens = {}

        # an asset has the form
        # {"policy_id": "acab", "asset_name": "cafe", "quantity": 1}
        for asset in assets:
            pid = to_bytes(asset['policy_id'])
            tkn = to_bytes(asset['asset_name'])
            amt = int(asset['quantity'])
            # initialize the dict
            if pid not in tokens:
                tokens[pid] = {}

            # its already a dict
            if tkn in tokens[pid]:
                # add to the value
                tokens[pid][tkn] += amt
            else:
                # initialize the value
                tokens[pid][tkn] = amt

        # Remove tokens with a net amount of zero
        for pid in list(tokens.keys()):  # Iterate over a copy of the keys
            # Iterate over a copy of the keys
            for tkn in list(tokens[pid].keys()):

                # delete any token that has a zero amount
                if tokens[pid][tkn] == 0:
                    del tokens[pid][tkn]

            # If no tokens left under this pid, remove the pid entry
            if not tokens[pid]:
                del tokens[pid]

        # the form for assets is a list
        value = [int(lovelace), tokens]
    return value


def build_resolved_output(tx_id: str, tx_idx: int, outputs: list[dict], network: bool, plutus_version: int = 3) -> dict:
    """
    Build a resolved output dictionary for given transaction outputs.

    Args:
        tx_id (str): The transaction id to resolve outputs for.
        tx_idx (int): The transaction id index to resolve outputs for.
        outputs (list[dict]): A list of dictionaries, each representing a transaction output.
        network (bool): Flag indicating the network type (True for mainnet, False pre-preproduction).

    Returns:
        Dict: A dictionary representing the resolved output.
    """
    resolved = {}
    for utxo in outputs['outputs']:
        output_tx_id = utxo['tx_hash']
        output_tx_idx = utxo['tx_index']

        # we found it
        if (tx_id, tx_idx) == (output_tx_id, output_tx_idx):
            # lets build out the resolved output

            # assume that anything with a datum is a contract
            # zero index must exist
            # one index must exist
            # 2 and 3 are optional
            if utxo['inline_datum'] is not None:
                # assumed to be a smart contract
                if utxo["stake_addr"] is None:

                    # no stake key
                    network_flag = "71" if network is True else "70"

                    # create public key hash
                    pkh = network_flag + utxo['payment_addr']['cred']
                else:
                    stake_key, contract_flag = run_bech32(utxo["stake_addr"])

                    # is it a smart contract?
                    if contract_flag is True:
                        # it is a contract
                        network_flag = "31" if network is True else "30"
                    else:
                        # it is not a contract
                        network_flag = "11" if network is True else "10"

                    # create public key hash
                    pkh = network_flag + utxo['payment_addr']['cred'] + stake_key

                # correct format for the pkh
                pkh = to_bytes(pkh)
                resolved[0] = pkh

                # put the inline datum in the correct format
                cbor_datum = to_bytes(utxo['inline_datum']['bytes'])
                resolved[2] = [1, cbor2.CBORTag(24, cbor_datum)]
            else:
                # no inline datum is present
                if utxo["stake_addr"] is None:

                    # no stake key
                    network_flag = "61" if network is True else "60"

                    # create public key hash
                    pkh = network_flag + utxo['payment_addr']['cred']
                else:
                    stake_key, contract_flag = run_bech32(utxo["stake_addr"])

                    # is it a smart contract?
                    if contract_flag is True:
                        # it is a contract
                        network_flag = "21" if network is True else "20"
                    else:
                        # it is not a contract
                        network_flag = "01" if network is True else "00"

                    # create public key hash
                    pkh = network_flag + utxo['payment_addr']['cred'] + stake_key

                pkh = to_bytes(pkh)
                resolved[0] = pkh

            if utxo['reference_script'] is not None:
                # assume plutus v3 reference scripts
                cbor_ref = to_bytes(utxo['reference_script']['bytes'])
                cbor_ref = to_bytes(cbor2.dumps([plutus_version, cbor_ref]).hex())

                # put the reference script in the correct format
                resolved[3] = cbor2.CBORTag(24, cbor_ref)

            # now we need the value element
            lovelace = utxo['value']
            assets = utxo['asset_list']

            # lovelace only is int, else it has assets
            value = resolve_value_from_input_output(lovelace, assets)
            resolved[1] = value

            # we got all the information required for this tx id
            break
        # this isnt the input we are looking for so continue
    return resolved


def simulate_cbor(tx_cbor: str, input_cbor: str, output_cbor: str, aiken_path: str = 'aiken', debug: bool = False, network: bool = False) -> list[dict]:
    # try to simulate the tx and return the results else return an empty dict
    try:
        # use some temp files that get deleted later
        with tempfile.NamedTemporaryFile(mode='w+', delete=False) as temp_tx_file:
            temp_tx_file.write(tx_cbor)
            temp_tx_file_path = temp_tx_file.name
        with tempfile.NamedTemporaryFile(mode='w+', delete=False) as temp_input_file:
            temp_input_file.write(input_cbor)
            temp_input_file_path = temp_input_file.name
        with tempfile.NamedTemporaryFile(mode='w+', delete=False) as temp_output_file:
            temp_output_file.write(output_cbor)
            temp_output_file_path = temp_output_file.name

        # the default value assumes aiken to be on path
        # or it uses the aiken path
        func = [
            aiken_path, 'tx', 'simulate',
            temp_tx_file_path,
            temp_input_file_path,
            temp_output_file_path
        ]
        # this is calculated from the block after the hf
        if network is False:
            func += [
                '--zero-time', '1655769600000',
                '--zero-slot', '86400',
            ]
        output = subprocess.run(
            func,
            check=True,
            capture_output=False if debug is True else True,
            text=True
        )

        # this should remove the temp files
        os.remove(temp_tx_file_path)
        os.remove(temp_input_file_path)
        os.remove(temp_output_file_path)
        # if debug is on then dont json decode
        if debug is False:
            return json.loads(output.stdout)
        else:
            return [{}]
    except subprocess.CalledProcessError:
        # the simulation failed in some way
        return [{}]


def from_cbor(tx_cbor: str, network: bool, debug: bool = False, aiken_path: str = 'aiken', plutus_version: int = 3) -> list[dict]:
    """Simulate a tx from tx cbor for some network.

    Args:
        tx_cbor (str): The transaction cbor.
        network (bool): The network flag, mainnet (True) or preprod (False).
        debug (bool, optional): Debug prints to console. Defaults to False.
        aiken_path (str, optional): The path to aiken. Defaults to 'aiken'.

    Returns:
        dict: Either an empty dictionary or a dictionary of the cpu and mem units.
    """
    # resolve the input and prepare the cbor
    inputs = resolve_inputs(tx_cbor)
    prepare_inputs = [(to_bytes(txin[0]), txin[1]) for txin in inputs]
    # print(f"Prepared Inputs: {prepare_inputs}")
    input_cbor = cbor2.dumps(prepare_inputs).hex()
    # print(f"CBOR Input: {input_cbor}")

    # resolve the input's output using koios
    tx_hashes = [txin[0] for txin in inputs]
    resolved_inputs_outputs = query_tx_with_koios(tx_hashes, network)

    # build out the list of outputs
    outputs = []

    # the order of the resolved outputs matter so we match to the inputs
    for txin in inputs:
        in_txid = txin[0]
        in_txidx = txin[1]

        # now find the input output for that hash
        for txin_out in resolved_inputs_outputs:
            txin_out_txid = txin_out['tx_hash']
            if in_txid != txin_out_txid:
                # have to match the hashes so the we can resolve a specific tx input
                continue

            # now we have a tx input output for a given input
            resolved = build_resolved_output(in_txid, in_txidx, txin_out, network, plutus_version)
            # append it and go to the next one
            outputs.append(resolved)
            # we break here since we built out the resolve output for a specific input
            break
    # print(f"Prepared Outputs: {outputs}")
    # get the resolved output cbor
    output_cbor = cbor2.dumps(outputs).hex()
    # print(f"CBOR Output: {output_cbor}")

    # try to simulate the tx and return the results else return an empty dict
    return simulate_cbor(tx_cbor, input_cbor, output_cbor, aiken_path, debug, network)


def from_file(tx_draft_path: str, network: bool, debug: bool = False, aiken_path: str = 'aiken', plutus_version: int = 3) -> list[dict]:
    """Simulate a tx from a tx draft file for some network.

    Args:
        tx_draft_path (str): The path to the tx.draft file.
        network (bool): The network flag, mainnet (True) or preprod (False).
        debug (bool, optional): Debug prints to console. Defaults to False.
        aiken_path (str, optional): The path to aiken. Defaults to 'aiken'.

    Returns:
        dict: Either an empty dictionary or a dictionary of the cpu and mem units.
    """
    # get cborHex from tx draft
    with open(tx_draft_path, 'r') as file:
        data = json.load(file)

    try:
        # get cbor hex from the file and proceed
        cborHex = data['cborHex']
        return from_cbor(cborHex, network, debug, aiken_path, plutus_version)
    except KeyError:
        return [{}]


def inputs_from_file(tx_draft_path: str, debug: bool = False) -> tuple[str, str] | None:
    """Given a tx draft file return the inputs in lexicographical order and the tx cbor required
    for tx simulation.

    Args:
        tx_draft_path (str): The path to the tx.draft file
        debug (bool, optional): Debug prints to console. Defaults to False.

    Returns:
        tuple[str, str] | None: Returns the inputs and inputs cbor or None
    """
    # get cborHex from tx draft
    with open(tx_draft_path, 'r') as file:
        data = json.load(file)

    try:
        # get cbor hex from the file and proceed
        cborHex = data['cborHex']
        # resolve the inputs
        inputs = resolve_inputs(cborHex)
        # prepare inputs for cbor dumping
        prepare_inputs = [(to_bytes(txin[0]), txin[1]) for txin in inputs]
        # we need the cbor hex here of the inputs
        inputs_cbor = cbor2.dumps(prepare_inputs).hex()
        if debug is True:
            print(f"Prepared Inputs: {prepare_inputs}")
            print(f"CBOR Input: {inputs_cbor}")
        return inputs, inputs_cbor
    except KeyError:
        return None


def sort_lexicographically(*args):
    """
    Sorts the function inputs in lexicographical order.

    Args:
    *args: Strings to be sorted.

    Returns:
    A list of strings sorted in lexicographical order.
    """
    return sorted(args)


def get_index_in_order(ordered_list, item):
    """
    Returns the index of the given item in the ordered list.

    Args:
    ordered_list: A list of strings sorted in lexicographical order.
    item: The string whose index is to be found.

    Returns:
    The index of the item in the ordered list.
    """
    try:
        return ordered_list.index(item)
    except ValueError:
        return -1  # Return -1 if the item is not found
