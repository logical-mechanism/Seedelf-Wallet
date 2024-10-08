import binascii
import hashlib
import json

from backend import bls12_381


def generate_seedelf_name(tx_hash: str, index: int, prefix: str, personal: str) -> str:
    xx = hex(index)[-2:]
    if "x" in xx:
        xx = xx.replace("x", "0")
    personal = personal[0:30]
    name = prefix + personal + xx + tx_hash
    return name[0:64]


def int_to_str(n: int) -> str:
    """
    Converts an integer to a hexadecimal string.

    This function takes an integer input, converts it to a hexadecimal string,
    and ensures that the resulting string has an even length by prepending
    a '0' if necessary.

    Args:
        n (int): The integer to be converted.

    Returns:
        str: The hexadecimal string representation of the integer.
    """

    # Convert integer to hexadecimal and remove the '0x' prefix
    hex_n = hex(n)[2:]

    # If the length of the hexadecimal string is odd, prepend '0' to make it even
    if len(hex_n) % 2 != 0:
        hex_n = '0' + hex_n

    return hex_n


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


def verify_datum(g: str, u: str, x: int) -> bool:
    return bls12_381.scale(g, x) == u


def fiat_shamir_heuristic(gb: str, grb: str, ub: str, b: str) -> str:
    """
    Implements the Fiat-Shamir heuristic by concatenating input strings,
    converting them to bytes, and applying the BLAKE2b hash function.

    Args:
        gb (str): A hex-encoded string representing 'g'.
        grb (str): A hex-encoded string representing 'g^r'.
        ub (str): A hex-encoded string representing 'u'.
        b (str): A hex-encoded string representing some additional value.

    Returns:
        str: A 28-byte BLAKE2b hash of the concatenated input, represented as a hexadecimal string.
    """

    # Concatenate all input hex strings
    concatenated_bytes = gb + grb + ub + b

    # Convert the concatenated hex string to bytes
    unhexed_bytes = binascii.unhexlify(concatenated_bytes)

    # Apply the BLAKE2b hash function with a 28-byte digest size
    hash_result = hashlib.blake2b(unhexed_bytes, digest_size=28).digest().hex()

    # Return the resulting hash as a hex string
    return hash_result


def verify_proof(g: str, u: str, g_r: str, c: int, z: int) -> bool:
    """
    Verifies a non-interactive zero-knowledge proof for the discrete logarithm problem
    using the Fiat-Shamir heuristic.

    The verification checks the equation: g^z = g^r * u^c, where z = r + c * x and u = g^x.

    Args:
        g (str): The base point 'g' (hex-encoded string).
        u (str): The point 'u' which equals g^x (hex-encoded string).
        g_r (str): The point 'g^r' (hex-encoded string).
        c (int): The challenge value 'c'.
        z (int): The value 'z' which equals r + c * x.

    Returns:
        bool: True if the zero-knowledge proof is valid, False otherwise.
    """

    # Calculate g^z using the BLS12-381 scalar multiplication
    g_z = bls12_381.scale(g, z)

    # Calculate u^c using the BLS12-381 scalar multiplication
    u_c = bls12_381.scale(u, c)

    # Verify that g^z equals g^r * u^c
    return g_z == bls12_381.combine(g_r, u_c)


def create_proof(x: int, g: str, u: str, b: str, file_path: str) -> None:
    """
    Creates a zero-knowledge (ZK) proof for a given value and writes the proof to a file in JSON format.

    The function generates a random value `r`, computes `g^r`, calculates a challenge value `c` using
    the Fiat-Shamir heuristic, computes the proof value `z = r + c * x`, and finally saves the proof to
    a JSON file.

    Args:
        x (int): The secret discrete logarithm for which the proof is created.
        g (str): The base point 'g' (hex-encoded string).
        u (str): The point 'u = g^x' (hex-encoded string).
        b (str): Some additional data or nonce for the Fiat-Shamir heuristic (hex-encoded string).
        file_path (str): The file path where the proof will be saved in JSON format.

    Returns:
        None
    """

    # Ensure 'b' is of even length by prepending a '0' if necessary
    if len(b) % 2 == 1:
        b = '0' + b

    # Select a random value for 'r'
    r = bls12_381.rng()

    # Compute g^r using scalar multiplication
    g_r = bls12_381.scale(g, r)

    # Compute challenge 'c' using the Fiat-Shamir heuristic (change to non-interactive later if needed)
    cb = fiat_shamir_heuristic(g, g_r, u, b)
    ci = int(cb, 16)

    # Compute proof value 'z' as z = (r + c * x) % curve_order
    zi = (r + ci * x) % bls12_381.curve_order

    # Convert 'z' to a hexadecimal string
    zb = int_to_str(zi)

    # Verify the proof (for debugging purposes, this will print whether the proof is valid)
    print('Is ZK Proof Valid?', verify_proof(g, u, g_r, ci, zi))

    # Construct the redeemer structure (Plutus-compatible format, for example)
    redeemer = {
        "constructor": 0,
        "fields": [
            {
                "bytes": zb  # Proof value 'z'
            },
            {
                "bytes": g_r  # Value 'g^r'
            },
            {
                "bytes": ""  # Placeholder for additional data
            }
        ]
    }

    # Write the redeemer structure to a JSON file
    with open(file_path, 'w') as file:
        json.dump(redeemer, file, indent=2)


if __name__ == "__main__":
    print(create_token_data())
