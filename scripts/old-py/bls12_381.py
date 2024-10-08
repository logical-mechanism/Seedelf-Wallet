import secrets

from py_ecc.bls.g2_primitives import (G1_to_pubkey, G2_to_signature,
                                      pubkey_to_G1, signature_to_G2)
from py_ecc.fields import optimized_bls12_381_FQ as FQ
from py_ecc.fields import optimized_bls12_381_FQ2 as FQ2
from py_ecc.fields import optimized_bls12_381_FQ12 as FQ12
from py_ecc.optimized_bls12_381 import (G1, G2, Z1, Z2, add, curve_order,
                                        multiply, neg, pairing)


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


def g2_point(scalar: int) -> str:
    """
    Generates a BLS12-381 point from the G2 generator using scalar multiplication
    and returns it in compressed format.

    Args:
        scalar (int): The scalar value for multiplication.

    Returns:
        bytes: The resulting BLS12-381 G2 point in compressed format.
    """
    return G2_to_signature(multiply(G2, scalar)).hex()


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
    if len(element) == 96:
        return pubkey_to_G1(bytes.fromhex(element))
    else:
        return signature_to_G2(bytes.fromhex(element))


def compress(element: tuple) -> str:
    """
    Compresses a BLS12-381 point to a hexadecimal string.

    Args:
        element (tuple): The point to be compressed.

    Returns:
        str: The compressed point as a hexadecimal string.
    """
    if isinstance(element[2], FQ):
        return G1_to_pubkey(element).hex()
    if isinstance(element[2], FQ2):
        return G2_to_signature(element).hex()


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


def invert(element: str) -> str:
    """
    Calculates the inverse of a BLS12-381 point.

    Args:
        element (str): A compressed point.

    Returns:
        str: The resulting combined point.
    """
    return compress(neg(uncompress(element)))


def pair(g2_element: str, g1_element: str, final_exponentiate: bool = True) -> FQ12:
    """
    Compute the pairing operation on elliptic curve points represented as strings.

    Args:
        g2_element (str): A string representation of a point on G2 elliptic curve.
        g1_element (str): A string representation of a point on G1 elliptic curve.
        final_exponentiate (bool, optional): Whether to perform final exponentiation in the pairing computation. Defaults to True.

    Returns:
        FQ12: Result of the pairing operation as an element of the FQ12 field.
    """
    return pairing(uncompress(g2_element), uncompress(g1_element), final_exponentiate)


# identity elements
g1_identity = compress(Z1)
g2_identity = compress(Z2)
gt_identity = FQ12.one()

# field order
field_order = curve_order
