import hashlib
import os

import bip39


def generate_bip39_mnemonic():
    return bip39.encode_bytes(os.urandom(16))


def mnemonic_to_int(mnemonic_phrase_string):
    return int(hashlib.sha256(mnemonic_phrase_string.encode()).digest().hex(), 16)
