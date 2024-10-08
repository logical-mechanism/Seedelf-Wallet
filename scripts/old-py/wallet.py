import json

import bls12_381


def wallet_datum(a: str, b: str) -> dict:
    return {
        "constructor": 0,
        "fields": [
            {
                "bytes": a
            },
            {
                "bytes": b
            }
        ]
    }


def convert_address_file_to_wallet_datum(address_path: str, wallet_path: str, randomize: bool = False) -> None:
    # Open the JSON file and load its contents
    with open(address_path, 'r') as file:
        data = json.load(file)

    if randomize is False:
        # Convert the data to a JSON string with sorted keys for consistent ordering
        json_data = json.dumps(wallet_datum(
            data['a'], data['b']), sort_keys=True, indent=2)
    else:
        r = bls12_381.rng()
        # Convert the data to a JSON string with sorted keys for consistent ordering
        json_data = json.dumps(wallet_datum(bls12_381.scale(
            data['a'], r), bls12_381.scale(data['b'], r)), sort_keys=True, indent=2)

    # Write the JSON data to the specified file path
    with open(wallet_path, 'w+') as file:
        file.write(json_data)


def write_address_file(file_path: str) -> None:
    """
    Generates cryptographic token data and writes it to a file in JSON format.

    This function creates token data using the `create_token_data()` function,
    converts it to a JSON string with sorted keys to ensure consistent ordering,
    and writes the result to a file at the specified path.

    Args:
        file_path (str): The path to the file where the data will be written.

    Returns:
        None
    """

    # Generate the token data
    data = create_token_data()

    # Convert the data to a JSON string with sorted keys for consistent ordering
    json_data = json.dumps(data, sort_keys=True, indent=2)

    # Write the JSON data to the specified file path
    with open(file_path, 'w+') as file:
        file.write(json_data)


def create_token_data() -> dict:
    """
    Creates a dictionary containing cryptographic token data.

    This function generates a random number using the `rng()` function from
    the `bls12_381` module and uses it to create points on the BLS12-381 curve.
    The resulting dictionary contains the secret value `x` and the points `a` and `b`.

    Returns:
        dict: A dictionary containing the token data with the following keys:
            - "secret": The randomly generated secret number.
            - "a": A G1 point initialized with the value 1.
            - "b": A G1 point initialized with the value `x`.
    """

    # Generate a random secret number using the BLS12-381 rng function
    x = bls12_381.rng()

    # Create a dictionary with the secret and G1 points
    data = {
        "secret": x,                 # The randomly generated secret
        "a": bls12_381.g1_point(1),  # G1 point initialized with value 1
        "b": bls12_381.g1_point(x),  # G1 point initialized with value `x`
    }

    return data


def create_token_name(tx_hash: str, index: int, prefix: str, personal: str) -> str:
    """
    Creates a token name by combining a transaction hash, an index, a prefix, and a personalized string.

    Args:
        tx_hash (str): The transaction hash to be included in the token name.
        index (int): An integer index, converted to its hexadecimal representation and used in the name.
        prefix (str): A string prefix to be prepended to the token name.
        personal (str): A personal string to be included in the name (trimmed to 30 characters).

    Returns:
        str: A token name string, truncated to 64 characters.
    """

    # Convert the index to hexadecimal and take the last two characters
    xx = hex(index)[-2:]

    # Replace 'x' (if present in the hex string) with '0' to ensure correct format
    if "x" in xx:
        xx = xx.replace("x", "0")

    # Trim the personal string to 30 characters
    personal = personal[0:30]

    # Combine the prefix, personal string, processed index, and transaction hash
    name = prefix + personal + xx + tx_hash

    # Return the token name, truncated to 64 characters
    return name[0:64]


if __name__ == "__main__":
    print(create_token_data())
