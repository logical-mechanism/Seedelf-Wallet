"""Writes the wallet's core property with 4 to 128 signatories, one module a length, into
Seedelf/Signers/: Keys.lean (the other signatories the guards use), Signers4.lean to
Signers128.lean, and modules.txt, which `./check.sh seedelf-signers` builds in order; and
Seedelf/Signers.lean, which imports them all for Seedelf.lean. The wallet walks the signatories
(`list.has`), so each length is a run of its own (README rule 4). Control128.lean, the negative
controls, is written by hand and listed last.

    python3 -I gen-seedelf-signers.py

Steps (Blaster's machine, AnyTxSteps' busy transaction, measured for every k from 4 to 128):
the key last among k halts with unit after 1211 + 70k, missed among k, the longest run, it
reaches Error after 1236 + 70k. The limit is WalletAnyTx's 2500 plus 70 a signatory."""
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Seedelf", "Signers")
KS = range(4, 129)
WIDTH = 100


def limit(k):
    return 2500 + 70 * k


def fill(first, words, indent):
    """`first`, then `words` a space apart, broken where a line would pass WIDTH."""
    lines, line = [], first
    for w in words:
        if len(line) + 1 + len(w) > WIDTH:
            lines.append(line)
            line = " " * indent + w
        else:
            line += " " + w
    return "\n".join(lines + [line])


KEYS = """import Seedelf.AnyTxSteps

/-! The other signatories in the `Signers…` modules' `#guard`s (gen-seedelf-signers.py writes
this file): `signerKey i` is 28 bytes, each `i`, for `i` from 1 to 128. No two are equal and
none is AnyTxSteps' `vkh0`, as the guards below check. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Data (Data)

/-- 28 bytes, each `i`. -/
def signerKey (i : Nat) : ByteString := ⟨String.mk (List.replicate 28 (Char.ofNat i))⟩

/-- `signerKey 1` to `signerKey n`, as signatories. -/
def otherSigners (n : Nat) : List Data := (List.range n).map fun i => .B (signerKey (i + 1))

#guard (List.range 128).all fun i => (signerKey (i + 1)).data.length == 28
#guard (List.range 128).all fun i => signerKey (i + 1) != vkh0
#guard ((List.range 128).map fun i => signerKey (i + 1)).eraseDups.length == 128

end Seedelf.V1
"""

DOC_FIRST = """/-! `WalletAnyTx` with 4 signatories, every other field still any `Data`: a Register UTxO moves
iff the proof checks and the one-time key is one of them, and every run returns unit or reaches
`Error`. The wallet looks for the key among all of them (`list.has`), so each length is a run of
its own (README rule 4): gen-seedelf-signers.py writes one module a length, 4 to 128, beside
`WalletAnyTx`, `WalletAnyTxTwo` and `WalletAnyTxThree`'s none to three.

Up to 128 is every length the chain allows, and a few more. The ledger bounds the signatories
only by the transaction's size: each needs its 28-byte key hash in the body (30 bytes as CBOR)
and a vkey witness (101 bytes: an array of a 32-byte key and a 64-byte signature), so a
16,384-byte transaction (mainnet's maxTxSize) carries at most 125 of them (125 × 131 = 16,375
bytes), before counting anything else in it.

Each signatory adds 70 steps: the key last among k passes after 1211 + 70k, and missed among k,
the longest run, it reaches `Error` after 1236 + 70k. The limit is 2500 + 70k. -/"""

DOC = """/-! `WalletAnyTx` with {k} signatories, every other field still any `Data`: a Register UTxO moves
iff the proof checks and the one-time key is one of them, and every run returns unit or reaches
`Error`. One of gen-seedelf-signers.py's lengths, 4 to 128 (`Signers4` says why 128). -/"""


def module(k):
    ss = [f"s{i}" for i in range(1, k + 1)]
    others = [f"(signerKey {i})" for i in range(1, k)]
    binders = fill("  ∀ (r : TxRest) (ref : Data) (g u z gr vkh", ss[:-1] + [f"{ss[-1]} : ByteString),"], 6)
    prop = f"appliedSig{k}.prop r ref g u z gr vkh"
    disj = [f"vkh = {s} ∨" for s in ss[:-1]] + [f"vkh = {ss[-1]}))", ":= by blaster"]
    return "\n".join([
        "import Seedelf.WalletAnyTx",
        "import Seedelf.Signers.Keys",
        "import Blaster",
        "",
        DOC_FIRST if k == 4 else DOC.format(k=k),
        "",
        "namespace Seedelf.V1",
        "open CardanoLedgerApi.IsData.Class (toTerm)",
        "open PlutusCore.ByteString (ByteString)",
        "open PlutusCore.Data (Data)",
        "open PlutusCore.UPLC.Term (Term)",
        "open PlutusCore.UPLC.Utils",
        "",
        fill(f"def anyTxRegister{k}Args (r : TxRest) (ref : Data) (g u z gr vkh",
             ss[:-1] + [f"{ss[-1]} : ByteString)", ": List Term :="], 4),
        fill("  [toTerm (anyTxRegisterSpend r ref g u z gr vkh",
             [f"[.B {s}," for s in ss[:1]] + [f".B {s}," for s in ss[1:-1]] + [f".B {ss[-1]}])]"], 4),
        "",
        f"#prep_uplc appliedSig{k} wallet anyTxRegister{k}Args {limit(k)}",
        "",
        f"-- The builder's own run at its own limit: the key last of {k} passes (after {1211 + 70 * k} steps);",
        f"-- missed among {k}, the longest run, it reaches Error (after {1236 + 70 * k}).",
        fill(f"#guard endsWithUnit (appliedSig{k}.exec busyTx spentRef g1 u0 z0 gr0 vkh0", others + ["vkh0)"], 4),
        fill(f"#guard endsInError (appliedSig{k}.exec busyTx spentRef g1 u0 z0 gr0 vkh0",
             others + [f"(signerKey {k}))"], 4),
        "",
        f"/-- With {k} signatories, a Register UTxO moves iff the proof checks and the one-time key is",
        "one of them. -/",
        f"theorem wallet_register_spend_iff_any_tx_{k}_signers :",
        binders,
        fill(f"    isSuccessful ({prop}", ss[:-1] + [f"{ss[-1]}) ↔"], 6),
        fill("      (schnorrAccepts g u z gr vkh = true ∧ (vkh = s1 ∨", disj[1:], 8),
        "",
        "/-- Every run returns unit, which the ledger accepts, or reaches `Error`. -/",
        f"theorem wallet_any_tx_{k}_signers_unit_or_error :",
        binders,
        fill(f"    returnsUnit ({prop}", ss[:-1] + [f"{ss[-1]}) ∨"], 6),
        fill(f"      isUnsuccessful ({prop}", ss[:-1] + [f"{ss[-1]})", ":= by blaster"], 8),
        "",
        "end Seedelf.V1",
        "",
    ])


os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "Keys.lean"), "w", encoding="utf-8") as f:
    f.write(KEYS)
for k in KS:
    with open(os.path.join(OUT, f"Signers{k}.lean"), "w", encoding="utf-8") as f:
        f.write(module(k))
with open(os.path.join(OUT, "modules.txt"), "w", encoding="utf-8") as f:
    f.write("# gen-seedelf-signers.py writes this list; ./check.sh seedelf-signers builds it in order.\n")
    f.write("".join(f"Seedelf.Signers.Signers{k}\n" for k in KS) + "Seedelf.Signers.Control128\n")
with open(os.path.join(os.path.dirname(OUT), "Signers.lean"), "w", encoding="utf-8") as f:
    f.write("".join(f"import Seedelf.Signers.Signers{k}\n" for k in KS) + "import Seedelf.Signers.Control128\n\n"
            "/-! The wallet's core property with 4 to 128 signatories, one module a length, and its\n"
            "controls (gen-seedelf-signers.py writes this file). -/\n")
print(f"wrote Keys.lean, Signers{KS[0]}.lean to Signers{KS[-1]}.lean, modules.txt and ../Signers.lean in {OUT}")
