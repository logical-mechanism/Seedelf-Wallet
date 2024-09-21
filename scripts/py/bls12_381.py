import binascii
import hashlib
import json
import os
import secrets

from py_ecc.bls import G2ProofOfPossession as bls
# from py_ecc.bls12_381.bls12_381_curve import multiply
from py_ecc.bls.g2_primitives import G1_to_pubkey, pubkey_to_G1
from py_ecc.optimized_bls12_381 import add, multiply

# security parameter; how many bits are used in x, r, c, etc
sec_param = 254
field_order = 52435875175126190479447740508185965837690552500527637822603658699938581184513


def data_hash(data: dict) -> str:
    data_str = json.dumps(data, sort_keys=True)
    return hashlib.blake2b(data_str.encode(), digest_size=32).hexdigest()


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
    g1 = hex_to_g1(g)
    sg1 = multiply_g1_element(g1, x)
    return G1_to_pubkey(sg1).hex()


def check(g, x, u):
    g1 = hex_to_g1(g)
    sg1 = multiply_g1_element(g1, x)
    return G1_to_pubkey(sg1).hex() == u


def rng(length: int = sec_param) -> int:
    n = secrets.randbits(length)
    if n > field_order:
        return rng()
    return n


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


def fiat_shamir_heuristic(gb, grb, ub, b):
    concatenated_bytes = gb + grb + ub + b
    print(concatenated_bytes)
    unhexed_bytes = binascii.unhexlify(concatenated_bytes)
    hash_result = hashlib.blake2b(unhexed_bytes, digest_size=28).digest().hex()
    return hash_result


def create_dlog_zk(x: int, g: str, u: str, b: str, file_name: str = 'wallet-redeemer.json') -> None:
    if len(b) % 2 == 1:
        b = '0' + b
    # random r
    ri = rng()
    grb = new_g1(g, ri)
    #
    cb = fiat_shamir_heuristic(g, grb, u, b)
    # print('cb', cb)
    # random c, change to fiat shamir later
    ci = int(cb, 16)
    # compute z
    # hex the result
    zi = z(ri, ci, x) % field_order
    zb = hexify(zi)
    print('Is ZK Proof Valid?', verify_dlog_zk(g, u, grb, ci, zi))
    redeemer = {
        "constructor": 0,
        "fields": [
            {
                "bytes": zb
            },
            {
                "bytes": grb
            },
            {
                "bytes": ""
            }
        ]
    }
    script_dir = os.path.dirname(__file__)
    # Construct the path to the file relative to the script location
    # Correcting the path and filename typo
    file_path = os.path.join(script_dir, '../data/wallet/' + file_name)
    with open(file_path, 'w') as file:
        json.dump(redeemer, file, indent=2)


def verify_dlog_zk(g, u, grb, c, z) -> bool:
    g1 = hex_to_g1(g)
    u1 = hex_to_g1(u)
    g_z = multiply_g1_element(g1, z)
    g_r = hex_to_g1(grb)
    u_c = multiply_g1_element(u1, c)
    rhs = add(g_r, u_c)
    return G1_to_pubkey(g_z).hex() == G1_to_pubkey(rhs).hex()


if __name__ == "__main__":
    outcome = fiat_shamir_heuristic("", "", "", "") == "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07"
    print(outcome)

    # outcome = fiat_shamir_heuristic(
    #     "86f0c64bd433568dd92751f0bee97feaaeee6f3c2144b210be68d2bc85253b1994703caf7f8361ccf246fef52c0ad859",
    #     "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
    #     "a2cbc5c3c72a7bc9047971345df392a67279d2f32082891976d913c699885c3ff9a90a8ea942bef4729cf93f526521e4") == "446cc50b0fb56f2b4ad46319e628566838622640baddd9b7df31f690b38c1410"
    # print(outcome)
