import hashlib
import json
import os
import secrets

from py_ecc.bls import G2ProofOfPossession as bls
from py_ecc.bls.g2_primitives import G1_to_pubkey, pubkey_to_G1
from py_ecc.optimized_bls12_381 import multiply

# security parameter; how many bits are used in x, r, c, etc
sec_param = 254


def data_hash(data: dict) -> str:
    data_str = json.dumps(data, sort_keys=True)
    return hashlib.sha256(data_str.encode()).hexdigest()


def hexify(n: int) -> str:
    hex_n = hex(n)[2:]  # Remove the '0x' prefix
    if len(hex_n) % 2 != 0:
        hex_n = '0' + hex_n  # Prepend '0' if length is odd
    return hex_n


def hex_to_g1(hex_str):
    # Convert hex to bytes
    pk_bytes = bytes.fromhex(hex_str)
    # Assuming this is a valid G1 element representation, convert to G1
    # This function does not exist in py_ecc and is for illustrative purposes
    g1_element = pubkey_to_G1(pk_bytes)
    return g1_element


def multiply_g1_element(g1_element, scalar):
    # Multiply G1 element by scalar
    result = multiply(g1_element, scalar)
    return result


def new_g1(g, x):
    return G1_to_pubkey(multiply_g1_element(hex_to_g1(g), x)).hex()


def check(g, x, u):
    return G1_to_pubkey(multiply_g1_element(hex_to_g1(g), x)).hex() == u


def rng(length: int = sec_param) -> int:
    return secrets.randbits(length)


def pk(sk):
    pk = bls.SkToPk(sk)
    pk_bytes = pk
    pk_hex = pk_bytes.hex()
    return pk_hex


def create_token(length: int = sec_param) -> dict:
    # Assuming rng is a function that generates a random number.
    x = rng(length)
    # force correct size for plutus integers
    data = {
        "secret": x,
        "a": pk(1),
        "b": pk(x),
    }
    return data


def write_token_to_file(data: dict, file_path: str, token_name: str):
    # Convert the data to a JSON string with sorted keys to ensure consistent ordering
    data_str = json.dumps(data, sort_keys=True)
    # Use the hash as the filename
    filename = f"{file_path}/{token_name}.json"
    # Write the data to the file
    with open(filename, 'w+') as file:
        file.write(data_str)


def z(r: int, c: int, x: int) -> int:
    return r + c * x


def fiat_shamir_heuristic(gb, grb, ub):
    concatenated_bytes = gb + grb + ub
    hash_result = hashlib.sha3_256(concatenated_bytes.encode()).digest().hex()
    return hash_result


def create_dlog_zk(x: int, g: str) -> None:
    # random r
    gb = g.hex()
    ri = rng()
    grb = new_g1(g, ri)
    ub = new_g1(g, x)
    cb = fiat_shamir_heuristic(gb, grb, ub)
    # random c, change to fiat shamir later
    ci = int(cb, 16)
    # compute z
    # hex the result
    zi = z(ri, ci, x)
    zb = hexify(zi)
    redeemer = {
        "constructor": 0,
        "fields": [
            {
                "bytes": zb
            },
            {
                "bytes": grb
            }
        ]
    }

    script_dir = os.path.dirname(__file__)
    # Construct the path to the file relative to the script location
    # Correcting the path and filename typo
    file_path = os.path.join(script_dir, '../data/wallet/wallet-redeemer.json')
    with open(file_path, 'w') as file:
        json.dump(redeemer, file, indent=2)


if __name__ == "__main__":
    # g = pk(1)
    # gx = pk(44203)

    # gxx = G1_to_pubkey(multiply_g1_element(hex_to_g1(g), 44203)).hex()
    # # print(hex_to_g1(pk(2)))
    # # print(g1_point_to_hex(hex_to_g1(pk(1))))
    # print('g', g)
    # print('gx', gx)
    # print('gxx', gxx)
    # print(create_token())
    outcome = fiat_shamir_heuristic("", "", "") == "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
    print(outcome)
