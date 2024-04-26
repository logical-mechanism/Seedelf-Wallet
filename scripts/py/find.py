import json
import os

from bls12_381 import check, new_g1, rng


def create_updated_datums(file_name, register):
    data = {
        "constructor": 0,
        "fields": [
            {
                "bytes": register['a']
            },
            {
                "bytes": register['b']
            }
        ]
    }

    script_dir = os.path.dirname(__file__)
    # Construct the path to the file relative to the script location
    # Correcting the path and filename typo
    # updated-alice-datum.json
    file_path = os.path.join(script_dir, f'../data/lock/{file_name}')
    with open(file_path, 'w') as file:
        json.dump(data, file, indent=2)


def read_data_from_file(filename: str) -> dict:
    # Open the file and read the JSON data
    with open(filename, 'r') as file:
        data_str = file.read()
    # Convert the JSON string back to a dictionary
    data = json.loads(data_str)
    return data


def utxos(x: int, pid: str, tkn) -> str:
    # Example usage
    filename = '../tmp/script_utxo.json'
    data = read_data_from_file(filename)
    owned_utxos = []
    # find all utxos whose secret is x
    for d in data:
        g = data[d]['inlineDatum']['fields'][0]['bytes']
        u = data[d]['inlineDatum']['fields'][1]['bytes']
        if check(g, x, u):
            # but not the address ones
            try:
                data[d]['value'][pid][tkn]
                continue
            except KeyError:
                owned_utxos.append(d)
    return owned_utxos


def address_utxo(pid: str, tkn: str) -> str:
    # Example usage
    filename = '../tmp/script_utxo.json'
    data = read_data_from_file(filename)
    # find all utxos whose secret is x
    for d in data:
        try:
            token_amt = data[d]['value'][pid][tkn]
            if token_amt == 1:
                return d
        except KeyError:
            continue

    return None


def address_generator(pid: str, tkn: str) -> str:
    # Example usage
    filename = '../tmp/script_utxo.json'
    data = read_data_from_file(filename)
    # find all utxos whose secret is x
    for d in data:
        try:
            token_amt = data[d]['value'][pid][tkn]
            if token_amt == 1:
                g = data[d]['inlineDatum']['fields'][0]['bytes']
                return g
        except KeyError:
            continue
    return None


def address(pid: str, tkn: str) -> str:
    # Example usage
    filename = '../tmp/script_utxo.json'
    data = read_data_from_file(filename)
    # find all utxos whose secret is x
    for d in data:
        try:
            token_amt = data[d]['value'][pid][tkn]
            if token_amt == 1:
                g = data[d]['inlineDatum']['fields'][0]['bytes']
                u = data[d]['inlineDatum']['fields'][1]['bytes']
                #
                d = rng()
                new_g = new_g1(g, d)
                new_u = new_g1(u, d)
                data = {
                    "constructor": 0,
                    "fields": [
                        {
                            "bytes": new_g
                        },
                        {
                            "bytes": new_u
                        }
                    ]
                }
                #
                script_dir = os.path.dirname(__file__)
                # Construct the path to the file relative to the script location
                # Correcting the path and filename typo
                # updated-alice-datum.json
                file_path = os.path.join(script_dir, '../data/wallet/wallet-datum.json')
                with open(file_path, 'w') as file:
                    json.dump(data, file, indent=2)
                    return
        except KeyError:
            continue
    return


if __name__ == "__main__":
    pass
