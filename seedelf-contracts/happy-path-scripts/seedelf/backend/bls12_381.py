import secrets

from py_ecc.bls.g2_primitives import G1_to_pubkey, pubkey_to_G1
from py_ecc.optimized_bls12_381 import G1, add, curve_order, multiply


def rng() -> int:
    """
    Generates a random hex string of the specified length using the secrets module.

    Returns:
        int: A random number below the field order.
    """
    # Generate a random byte string of the specified length
    random_bits = secrets.randbits(255)
    while random_bits >= curve_order:
        random_bits = secrets.randbits(255)
    return random_bits


def g1_point(scalar: int) -> str:
    """
    Generates a BLS12-381 point from the G1 generator using scalar multiplication
    and returns it in compressed format.

    Args:
        scalar (int): The scalar value for multiplication.

    Returns:
        bytes: The resulting BLS12-381 G1 point in compressed format.
    """
    return G1_to_pubkey(multiply(G1, scalar)).hex()


def uncompress(element: str) -> tuple:
    """
    Uncompresses a hexadecimal string to a BLS12-381 point.

    Args:
        element (str): The compressed point as a hexadecimal string.

    Returns:
        tuple: The uncompressed point.
    """
    return pubkey_to_G1(bytes.fromhex(element))


def compress(element: tuple) -> str:
    """
    Compresses a BLS12-381 point to a hexadecimal string.

    Args:
        element (tuple): The point to be compressed.

    Returns:
        str: The compressed point as a hexadecimal string.
    """
    return G1_to_pubkey(element).hex()


def scale(element: str, scalar: int) -> str:
    """
    Scales a BLS12-381 point by a given scalar using scalar multiplication.

    Args:
        element (str): The compressed point to be scaled.
        scalar (int): The scalar value for multiplication.

    Returns:
        str: The resulting scaled point.
    """
    return compress(multiply(uncompress(element), scalar))


def combine(left_element: str, right_element: str) -> str:
    """
    Combines two BLS12-381 points using addition.

    Args:
        left_element (str): A compressed point.
        right_element (str): A compressed point.

    Returns:
        str: The resulting combined point.
    """
    return compress(add(uncompress(left_element), uncompress(right_element)))
