import json

import requests


def get_protocol_params(network: str, file_path: str) -> dict:
    prefix = "preprod" if "testnet" in network else "api"
    url = f"https://{prefix}.koios.rest/api/v1/cli_protocol_params"

    headers = {
        "accept": "application/json"
    }

    response = requests.get(url, headers=headers)

    if response.status_code == 200:
        # Write the JSON response to the specified file path
        with open(file_path, 'w') as f:
            # indent for pretty formatting
            json.dump(response.json(), f, indent=4)
        return response.json()  # return the JSON data if the request was successful
    else:
        # return the error details if request fails
        return f"Error: {response.status_code}, {response.text}"


def get_tip(network: str) -> list[dict]:
    prefix = "preprod" if "testnet" in network else "api"
    url = f"https://{prefix}.koios.rest/api/v1/tip"

    headers = {
        "accept": "application/json"
    }

    response = requests.get(url, headers=headers)

    if response.status_code == 200:
        return response.json()  # return the json data if the request was successful
    else:
        # return the error details if request fails
        return f"error: {response.status_code}, {response.text}"


def get_latest_block_number(network: str) -> int:
    try:
        block_number = int(get_tip(network)[0]['block_no'])
    except (IndexError, KeyError):
        block_number = 0
    return block_number


def get_credential_utxos(network: str, payment_credentials: list[str]) -> list[dict]:
    prefix = "preprod" if "testnet" in network else "api"
    url = f"https://{prefix}.koios.rest/api/v1/credential_utxos"

    headers = {
        "accept": "application/json",
        "content-type": "application/json"
    }

    # Prepare the request payload
    data = {
        "_payment_credentials": payment_credentials,
        "_extended": True  # _extended is always set to True
    }

    response = requests.post(url, headers=headers, data=json.dumps(data))

    if response.status_code == 200:
        return response.json()  # return the response as JSON
    else:
        # return error details
        return f"Error: {response.status_code}, {response.text}"


def submit_transaction(network: str, file_path: str) -> str:
    # xxd -p -r <<< $(jq .cborHex tmp/tx.signed) > data.file
    prefix = "preprod" if "testnet" in network else "api"
    url = f"https://{prefix}.koios.rest/api/v1/submittx"
    headers = {
        "Content-Type": "application/cbor"
    }

    # Open the file in binary mode
    with open(file_path, 'rb') as tx_file:
        response = requests.post(url, headers=headers, data=tx_file)

    if response.status_code == 200:
        return "Transaction submitted successfully"
    else:
        return f"Error: {response.status_code}, {response.text}"


def get_tx_info(network: str, tx_hashes: list[str]) -> dict:
    prefix = "preprod" if "testnet" in network else "api"
    url = f"https://{prefix}.koios.rest/api/v1/tx_info"
    headers = {
        "accept": "application/json",
        "content-type": "application/json"
    }
    data = {
        "_tx_hashes": tx_hashes,
        "_inputs": True,
        "_metadata": False,
        "_assets": True,
        "_withdrawals": False,
        "_certs": False,
        "_scripts": False,
        "_bytecode": False
    }

    response = requests.post(url, headers=headers, json=data)
    if response.status_code == 200:
        return response.json()
    else:
        return f"Error: {response.status_code}, {response.text}"


def evaluate_transaction(network: str, tx_cbor: str):
    prefix = "preprod" if "testnet" in network else "api"
    url = f"https://{prefix}.koios.rest/api/v1/ogmios"
    headers = {
        "accept": "application/json",
        "content-type": "application/json"
    }
    data = {
        "jsonrpc": "2.0",
        "method": "evaluateTransaction",
        "params": {"transaction": {tx_cbor}},
    }

    response = requests.post(url, headers=headers, json=data)
    return response.json()
