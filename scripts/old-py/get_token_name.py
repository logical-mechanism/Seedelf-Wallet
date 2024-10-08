import binascii
import hashlib


def token_name(txHash, index, prefix):
    txBytes = binascii.unhexlify(txHash)
    h = hashlib.new('sha3_256')
    h.update(txBytes)
    txHash = h.hexdigest()
    x = hex(index)[-2:]
    if "x" in x:
        x = x.replace("x", "0")
    txHash = prefix + x + txHash
    return txHash[0:64]


def personal(tx_hash, index, prefix, personal):
    xx = hex(index)[-2:]
    if "x" in xx:
        xx = xx.replace("x", "0")
    personal = personal[0:30]
    name = prefix + personal + xx + tx_hash
    return name[0:64]
