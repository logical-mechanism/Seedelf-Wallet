#!/usr/bin/env python3
"""Records lovejoin-box-spellings.json, beside this: a Lovejoin box's datum,
Constr 0 [B a, B b] (a = G1's generator, b = 2G, compressed), spelled the ways
below, each with what the node reads it as. seedelf-core's box reader
(parse_mix_datum, and PoolBox::from_row through it) and seedelf-data's
is_mix_datum are held to it.

The verdicts are cardano-cli's, whose decoder shares no code with either.
hash-script-data on each spelling; one it reads goes inline into a transaction
(build-raw, which keeps its bytes as written), and debug transaction view says
what data the ledger's decoder makes of it: the box (constr0_ab), or other
data. One it refuses goes into such a transaction by hand, and the ledger's
decoder must refuse it too. Offline: nothing is signed or sent. Needs
cardano-cli on PATH (11.0.0.0 recorded this). Only a deliberate change records
it again, from seedelf-platform:

    python3 -I seedelf-core/tests/fixtures/record-box-spellings.py
"""

import json
import os
import shutil
import subprocess
import tempfile

h = bytes.fromhex
A = h("97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb")
B = h("a572cbea904d67468808c8eb50a9450c9721db309128012543902d0ac358a62ae28f75bb8f1c7c42c39a8c5529bf0f4e")

# Heads, by width: tag 121, tag 102, a list of two, the index 0.
TAG121 = {"min": h("d879"), "w2": h("d90079"), "w4": h("da00000079"), "w8": h("db0000000000000079")}
TAG102 = {"min": h("d866"), "w2": h("d90066"), "w4": h("da00000066"), "w8": h("db0000000000000066")}
LEN2 = {"min": h("82"), "w1": h("9802"), "w2": h("990002"), "w4": h("9a00000002"), "w8": h("9b0000000000000002")}
IDX0 = {"min": h("00"), "w1": h("1800"), "w2": h("190000"), "w4": h("1a00000000"), "w8": h("1b0000000000000000")}


def whole(x, width="min"):
    """A byte string, its length's head as short as it goes or `width` wide."""
    n = len(x)
    head = {
        "min": bytes([0x58, n]) if n >= 24 else bytes([0x40 + n]),
        "w2": h("59") + n.to_bytes(2, "big"),
        "w4": h("5a") + n.to_bytes(4, "big"),
        "w8": h("5b") + n.to_bytes(8, "big"),
    }[width]
    return head + x


def chunks(x, sizes, empty_at=()):
    """5f <chunks> ff: `sizes` split x, with an empty chunk before each position in `empty_at`."""
    out, i = bytearray(h("5f")), 0
    for k, s in enumerate(sizes):
        out += h("40") if k in empty_at else b""
        out += whole(x[i : i + s])
        i += s
    out += h("40") if len(sizes) in empty_at else b""
    assert i == len(x)
    return bytes(out + h("ff"))


BYTES = {
    "bw2": lambda x: whole(x, "w2"),
    "bw4": lambda x: whole(x, "w4"),
    "bw8": lambda x: whole(x, "w8"),
    "ch24x2": lambda x: chunks(x, [24, 24]),
    "ch48x1": lambda x: chunks(x, [48]),
    "ch16x3": lambda x: chunks(x, [16, 16, 16]),
    "ch1x48": lambda x: chunks(x, [1] * 48),
    "ch0lead": lambda x: chunks(x, [48], empty_at=(0,)),
    "ch0trail": lambda x: chunks(x, [48], empty_at=(1,)),
    "ch0mid": lambda x: chunks(x, [24, 24], empty_at=(1,)),
    "chw2": lambda x: h("5f") + whole(x[:24], "w2") + whole(x[24:]) + h("ff"),
}
CHUNKED = ["ch24x2", "ch48x1", "ch16x3", "ch1x48", "ch0lead", "ch0trail", "ch0mid"]


def fields(kind, a, b, width="min"):
    return LEN2[width] + a + b if kind == "def" else h("9f") + a + b + h("ff")


def constr(form, pair, kind, a, b, tag="min", idx="min", pairw="min", listw="min"):
    body = fields(kind, a, b, listw)
    if form == 121:
        return TAG121[tag] + body
    if pair == "def":
        return TAG102[tag] + LEN2[pairw] + IDX0[idx] + body
    return TAG102[tag] + h("9f") + IDX0[idx] + body + h("ff")


# Constructor 0 as tag 121 or as the general form 102([0, fields]), its pair and its fields definite or not.
SHAPES = [
    ("S1", 121, None, "indef"),  # the wallet's own (mix_datum)
    ("S2", 121, None, "def"),
    ("S3", 102, "def", "indef"),
    ("S4", 102, "def", "def"),
    ("S5", 102, "indef", "indef"),
    ("S6", 102, "indef", "def"),
]

spellings = []


def add(name, data):
    spellings.append({"name": name, "hex": data.hex()})


a, b = whole(A), whole(B)
for name, form, pair, kind in SHAPES:
    add(name, constr(form, pair, kind, a, b))
# S7: a, b or both in chunks.
for name, form, pair, kind in SHAPES:
    for c in CHUNKED:
        add(f"S7-{name}-a-{c}", constr(form, pair, kind, BYTES[c](A), b))
        add(f"S7-{name}-b-{c}", constr(form, pair, kind, a, BYTES[c](B)))
        add(f"S7-{name}-ab-{c}", constr(form, pair, kind, BYTES[c](A), BYTES[c](B)))
    add(f"S7-{name}-ab-chw2", constr(form, pair, kind, BYTES["chw2"](A), BYTES["chw2"](B)))
# S8: heads wider than they need be.
for name, form, pair, kind in SHAPES:
    for w in ["w2", "w4", "w8"]:
        add(f"S8-{name}-tag{w}", constr(form, pair, kind, a, b, tag=w))
    for w in ["bw2", "bw4", "bw8"]:
        add(f"S8-{name}-ab-{w}", constr(form, pair, kind, BYTES[w](A), BYTES[w](B)))
    if kind == "def":
        for w in ["w1", "w2", "w4", "w8"]:
            add(f"S8-{name}-list{w}", constr(form, pair, kind, a, b, listw=w))
    if form == 102:
        for w in ["w1", "w2", "w4", "w8"]:
            add(f"S8-{name}-idx{w}", constr(form, pair, kind, a, b, idx=w))
        if pair == "def":
            for w in ["w1", "w2", "w4", "w8"]:
                add(f"S8-{name}-pair{w}", constr(form, pair, kind, a, b, pairw=w))
    add(
        f"S8-{name}-allwide",
        constr(form, pair, kind, BYTES["bw2"](A), BYTES["bw8"](B), tag="w2", idx="w1", pairw="w1", listw="w1"),
    )
# S9: something after the datum.
for name, form, pair, kind in SHAPES:
    for t in ["00", "ff", "80", "d87980"]:
        add(f"S9-{name}-trail{t}", constr(form, pair, kind, a, b) + h(t))
# X: near misses.
indef = fields("indef", a, b)
add("X-102-idx-bignum0", TAG102["min"] + LEN2["min"] + h("c240") + indef)
add("X-102-pair3", TAG102["min"] + h("83") + IDX0["min"] + indef + h("00"))
add("X-102-pair1", TAG102["min"] + h("81") + IDX0["min"])
add("X-tag103", h("d867") + indef)
add("X-102-idx1", TAG102["min"] + LEN2["min"] + h("01") + indef)
add("X-nested-indef-chunk", TAG121["min"] + h("9f") + h("5f5f") + whole(A) + h("ffff") + b + h("ff"))
add("X-text-chunk", TAG121["min"] + h("9f") + h("5f") + h("7830") + A + h("ff") + b + h("ff"))
add("X-102-pair-indef-3", TAG102["min"] + h("9f") + IDX0["min"] + indef + h("00ff"))
add("X-tag-bignum-wrap", h("d879") + h("9f") + h("c2") + a + b + h("ff"))
add("X-chunk65", TAG121["min"] + h("9f") + h("5f") + whole(A + A[:17]) + h("ff") + b + h("ff"))
# The general form's index is an unsigned integer: -1 and an empty byte string each have a head of argument 0.
add("X-102-idx-neg1", TAG102["min"] + LEN2["min"] + h("20") + indef)
add("X-102-idx-bytes0", TAG102["min"] + LEN2["min"] + h("40") + indef)

# ---- What the node reads each as ----

WANT = {"constructor": 0, "fields": [{"bytes": A.hex()}, {"bytes": B.hex()}]}
MIX_BOX = "addr_test1wpnlle8d0uxv6z37xp5lmhpxmx7vmcl7v0fatrz7snm7e3gcegwyp"  # preprod's; any address does
work = tempfile.mkdtemp(prefix="seedelf-box-spellings-")


def cli(*args):
    return subprocess.run(["cardano-cli", *args], capture_output=True, text=True)


def inline(datum):
    """The datum as an output holds it inline: tag 24 of its bytes."""
    n = len(datum)
    head = bytes([0x40 + n]) if n < 24 else bytes([0x58, n]) if n < 256 else h("59") + n.to_bytes(2, "big")
    return (h("d818") + head + datum).hex()


def built(datum):
    """A transaction build-raw makes with `datum` inline at an output, as its JSON envelope."""
    path, tx = os.path.join(work, "datum.cbor"), os.path.join(work, "built.tx")
    open(path, "wb").write(datum)
    r = cli(
        "conway", "transaction", "build-raw", "--tx-in", "51" * 32 + "#0", "--tx-out", f"{MIX_BOX}+10000000",
        "--tx-out-inline-datum-cbor-file", path, "--fee", "200000", "--out-file", tx,
    )
    assert r.returncode == 0, r.stderr
    envelope = json.load(open(tx))
    assert inline(datum) in envelope["cborHex"], "build-raw rewrote the datum"
    return envelope


def viewed(envelope):
    """The datum of the transaction's first output, as the ledger's decoder reads it, or None if it refuses."""
    tx = os.path.join(work, "view.tx")
    json.dump(envelope, open(tx, "w"))
    r = cli("debug", "transaction", "view", "--output-json", "--tx-file", tx)
    return json.loads(r.stdout)["outputs"][0]["datum"] if r.returncode == 0 else None


version = cli("--version").stdout.split(" - ")[0]  # "cardano-cli 11.0.0.0"
try:
    s1 = h(spellings[0]["hex"])
    s1_tx = built(s1)
    for s in spellings:
        datum = h(s["hex"])
        path = os.path.join(work, "datum.cbor")
        open(path, "wb").write(datum)
        hashed = cli("conway", "transaction", "hash-script-data", "--script-data-cbor-file", path).returncode == 0
        if hashed:
            read = viewed(built(datum))
            assert read is not None, f"{s['name']}: hashed, but the ledger's decoder refuses it"
            s["node"] = "constr0_ab" if read == WANT else "other"
        else:
            patched = dict(s1_tx, cborHex=s1_tx["cborHex"].replace(inline(s1), inline(datum)))
            assert viewed(patched) is None, f"{s['name']}: not hashed, but the ledger's decoder reads it"
            s["node"] = "refused"
        print(f"{s['node']:<11} {s['name']}")
finally:
    shutil.rmtree(work)

about = (
    "A Lovejoin box's datum, Constr 0 [B a, B b] (a = G1's generator, b = 2G, compressed), spelled "
    f"{len(spellings)} ways, each with what the node reads it as: constr0_ab (that box), other (other data) or "
    f"refused. Made by record-box-spellings.py, beside this, with {version}, offline: hash-script-data on each, "
    "then build-raw with it inline and debug transaction view (one hash-script-data refuses, patched into such a "
    "transaction, the ledger's decoder refuses too). seedelf-core's box reader (parse_mix_datum, so "
    "PoolBox::from_row) and seedelf-data's is_mix_datum each read exactly the constr0_ab spellings as a box. "
    "Never edited by hand; recorded again, by hand, only for a deliberate change."
)
# One spelling a line, so a new recording's diff reads spelling by spelling.
lines = [f' "about": {json.dumps(about)},', f' "a": "{A.hex()}",', f' "b": "{B.hex()}",', ' "spellings": [']
lines += [f"  {json.dumps(s)}," for s in spellings]
lines[-1] = lines[-1].rstrip(",")
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "lovejoin-box-spellings.json"), "w") as f:
    f.write("{\n" + "\n".join(lines) + "\n ]\n}\n")
print(len(spellings), "spellings,", sum(s["node"] == "constr0_ab" for s in spellings), "of them the box")
