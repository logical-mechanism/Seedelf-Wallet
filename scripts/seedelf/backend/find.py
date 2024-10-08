import json

from backend.wallet import verify_datum


def seedelf(pid: str, tkn: str) -> str | None:
    # Example usage
    filename = '../tmp/script_utxo.json'
    # Open the file and read the JSON data
    with open(filename, 'r') as file:
        data_str = file.read()
    # Convert the JSON string back to a dictionary
    data = json.loads(data_str)
    # search the data until we find the seedelf
    for d in data:
        try:
            token_amt = data[d]['value'][pid][tkn]
            a = data[d]['inlineDatum']['fields'][0]['bytes']
            b = data[d]['inlineDatum']['fields'][1]['bytes']
            if token_amt == 1:
                return json.dumps({d: {"a": a, "b": b, "value": data[d]['value']}})
        except (KeyError, IndexError):
            continue

    return None


def all_utxos_but_seedelf(x: int, pid: str, tkn) -> str:
    # Example usage
    filename = '../tmp/script_utxo.json'
    # Open the file and read the JSON data
    with open(filename, 'r') as file:
        data_str = file.read()
    # Convert the JSON string back to a dictionary
    data = json.loads(data_str)

    all_utxos = {}
    # find all utxos whose secret is x
    for d in data:
        # just in case the datum is messed up on one of them
        try:
            g = data[d]['inlineDatum']['fields'][0]['bytes']
            u = data[d]['inlineDatum']['fields'][1]['bytes']
        except (KeyError, IndexError):
            continue

        if verify_datum(g, u, x) is True:
            # store the utxo but not the seedelf
            try:
                # if it exists then go to the next one
                data[d]['value'][pid][tkn]
                continue
            except KeyError:
                # it will key error so that means its not theres so save it
                all_utxos[d] = {
                    "a": g,
                    "b": u,
                    "value": data[d]['value'],
                }
    return json.dumps(all_utxos)


if __name__ == "__main__":
    print(seedelf("ec0023109dc706d4f894e7b2a908fb715e3599dac3b51e3baa781876",
          "5eed0e1f7465737401fc560864ef07b72c41852cd8f78cb95ea26e6ac042eb66"))
