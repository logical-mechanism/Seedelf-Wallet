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

        # print('hex string', hex_string)
        if hex_string[:2] in ["e0", "00", "60", "10"]:
            # print("stake key is not contract")
            return hex_string[2:], False
        else:
            # print("stake key is contract")
            return hex_string[2:], True
    except TypeError:
        raise TypeError("non-standard format in run_bech32() arg at position 1")


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
        raise ValueError("non-hexadecimal number found in fromhex() arg at position 1")


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
    except ValueError:
        raise ValueError("non-hexadecimal number found in fromhex() arg at position 1")

    return decoded_data


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
        '_tx_hashes': hashes
    }

    headers = {
        'accept': 'application/json',
        'content-type': 'application/json',
    }

    url = 'https://' + subdomain + '.koios.rest/api/v0/tx_info'
    # return the tx information for a list of transactions, (the inputs)
    return requests.post(url=url, headers=headers, json=json_data).json()


def resolve_inputs_and_outputs(tx_cbor: str, network: bool) -> tuple[list[tuple[str, int]], list[dict]]:
    """Resolves the inputs and the inputs outputs for some given tx cbor. The returned values are not in
    any specific ordering.

    Args:
        tx_cbor (str): The transaction cbor
        network (bool): The network flag

    Raises:
        KeyError: The inputs, collateral, and reference inputs must exist inside the tx.

    Returns:
        tuple[list[tuple[str, int]], list[dict]]: A tuple of the utxo inputs and the resolved input outputs.
    """
    # resolve the data from the cbor
    data = tx_draft_to_resolved_cbor(tx_cbor)

    # we just need the body here
    try:
        txBody = data[0]

        # all the types of inputs; tx inputs, collateral, and reference
        inputs = txBody[0] + txBody[13] + txBody[18]
        # convert into list of tuples
        inputs = [(utxo[0].hex(), int(utxo[1])) for utxo in inputs]
    except KeyError:
        raise KeyError("required tx body elements are missing")

    # we now need to loop all the input hashes to resolve their outputs
    # utxo inputs have the form [tx_hash, index]
    tx_hashes = [utxo[0] for utxo in inputs]
    outputs = query_tx_with_koios(tx_hashes, network)
    return inputs, outputs


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
            for tkn in list(tokens[pid].keys()):  # Iterate over a copy of the keys

                # delete any token that has a zero amount
                if tokens[pid][tkn] == 0:
                    del tokens[pid][tkn]

            # If no tokens left under this pid, remove the pid entry
            if not tokens[pid]:
                del tokens[pid]

        # the form for assets is a list
        value = [int(lovelace), tokens]
    return value


def build_resolved_output(tx_id: str, tx_idx: int, outputs: list[dict], network: bool) -> dict:
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
    for txo in outputs['outputs']:
        output_tx_id = txo['tx_hash']
        output_tx_idx = txo['tx_index']

        # we found it
        if (tx_id, tx_idx) == (output_tx_id, output_tx_idx):
            # lets build out the resolved output

            # assume that anything with a datum is a contract
            # zero index must exist
            # one index must exist
            # 2 and 3 are optional
            if txo['inline_datum'] is not None:
                # smart contract
                if txo["stake_addr"] is None:
                    # no stake key
                    network_flag = "71" if network is True else "70"
                    pk = network_flag + txo['payment_addr']['cred']
                else:
                    stake_key, contract_flag = run_bech32(txo["stake_addr"])
                    # is it a smart contract stake key?
                    if contract_flag is True:
                        # contract
                        network_flag = "31" if network is True else "30"
                    else:
                        # not a contract
                        network_flag = "11" if network is True else "10"
                    pk = network_flag + txo['payment_addr']['cred'] + stake_key
                # correct format
                pk = to_bytes(pk)
                resolved[0] = pk

                # put the inline datum in the correct format
                cbor_datum = to_bytes(txo['inline_datum']['bytes'])
                resolved[2] = [1, cbor2.CBORTag(24, cbor_datum)]
            else:
                # no datum
                if txo["stake_addr"] is None:
                    # no stake key
                    network_flag = "61" if network is True else "60"
                    pk = network_flag + txo['payment_addr']['cred']
                else:
                    # is the stake key a contract?
                    stake_key, contract_flag = run_bech32(txo["stake_addr"])
                    # is it a smart contract stake key?
                    if contract_flag is True:
                        # contract
                        network_flag = "21" if network is True else "20"
                    else:
                        # not a contract
                        network_flag = "01" if network is True else "00"
                    pk = network_flag + txo['payment_addr']['cred'] + stake_key
                pk = network_flag + txo['payment_addr']['cred']
                pk = to_bytes(pk)
                resolved[0] = pk

            if txo['reference_script'] is not None:
                # assume plutus v2 reference scripts
                cbor_ref = to_bytes(txo['reference_script']['bytes'])
                cbor_ref = to_bytes(cbor2.dumps([2, cbor_ref]).hex())

                # put the reference script in the correct format
                resolved[3] = cbor2.CBORTag(24, cbor_ref)

            # now we need the value element
            lovelace = txo['value']
            assets = txo['asset_list']

            # lovelace only is int, else it has assets
            value = resolve_value_from_input_output(lovelace, assets)
            resolved[1] = value
            # we got all the information required for this tx id
            break
    return resolved


def simulate_cbor(tx_cbor: str, input_cbor: str, output_cbor: str, aiken_path: str = 'aiken', debug: bool = False) -> list[dict]:
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
        if debug is False:
            output = subprocess.run(
                [
                    aiken_path, 'tx', 'simulate',
                    temp_tx_file_path,
                    temp_input_file_path,
                    temp_output_file_path
                ],
                check=True,
                capture_output=True,
                text=True
            )
        else:
            output = subprocess.run(
                [
                    aiken_path, 'tx', 'simulate',
                    temp_tx_file_path,
                    temp_input_file_path,
                    temp_output_file_path
                ],
                check=True,
                text=True
            )

        # this should remove the temp files
        os.remove(temp_tx_file_path)
        os.remove(temp_input_file_path)
        os.remove(temp_output_file_path)

        return json.loads(output.stdout)
    except subprocess.CalledProcessError:
        # the simulation failed in some way
        return [{}]


def from_cbor(tx_cbor: str, network: bool, debug: bool = False, aiken_path: str = 'aiken') -> list[dict]:
    """Simulate a tx from tx cbor for some network.

    Args:
        tx_cbor (str): The transaction cbor.
        network (bool): The network flag, mainnet (True) or preprod (False).
        debug (bool, optional): Debug prints to console. Defaults to False.
        aiken_path (str, optional): The path to aiken. Defaults to 'aiken'.

    Returns:
        dict: Either an empty dictionary or a dictionary of the cpu and mem units.
    """
    # # resolve the input and output from the cbor
    inputs, resolved_inputs_outputs = resolve_inputs_and_outputs(tx_cbor, network)
    prepare_inputs = [(to_bytes(utxo[0]), utxo[1]) for utxo in inputs]
    input_cbor = cbor2.dumps(prepare_inputs).hex()

    # build out the list of outputs
    outputs = []

    # the order of the resolved outputs matter so we match to the inputs
    for utxo in inputs:
        input_tx_hash = utxo[0]
        input_tx_idx = utxo[1]

        # now find the input output for that hash
        for tx_input_output in resolved_inputs_outputs:
            that_tx_hash = tx_input_output['tx_hash']
            if input_tx_hash != that_tx_hash:
                # have to match the hashes so the we can resolve a specific tx input
                continue

            # now we have a tx input output for a given input
            resolved = build_resolved_output(input_tx_hash, input_tx_idx, tx_input_output, network)
            # append it and go to the next one
            outputs.append(resolved)
            # we break here since we built out the resolve output for a specific input
            break

    # get the resolved output cbor
    output_cbor = cbor2.dumps(outputs).hex()

    # attempt to debug if required
    if debug is True:
        print(tx_cbor, '\n')
        print(input_cbor, '\n')
        print(output_cbor, '\n')

    # try to simulate the tx and return the results else return an empty dict
    return simulate_cbor(tx_cbor, input_cbor, output_cbor, aiken_path, debug)


def from_file(tx_draft_path: str, network: bool, debug: bool = False, aiken_path: str = 'aiken') -> dict:
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
    cborHex = data['cborHex']
    return from_cbor(cborHex, network, debug, aiken_path)
