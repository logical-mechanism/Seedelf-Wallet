"""Writes Slice/Slice/Index0.lean to Index3.lean, the policy's one-line rule at each first-input
index that is a byte (64 a module, the index concrete and everything else symbolic), and
Slice/Slice/Rule.lean, which puts them together with Run's two off-byte theorems into the rule in
every transaction. A symbolic index can't be: consByteString's byte is a `BitVec` (Slice/Run).

    python3 -I gen-seedelf-slice.py
"""
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Slice", "Slice")

PER = 64
MODS = 256 // PER

def index_module(m):
    lo, hi = m * PER, m * PER + PER - 1
    lines = [
        "import Slice.Run",
        "import Blaster",
        "",
        f"/-! The policy's rule for one mint line at each first-input index from {lo} to {hi}, in every",
        "transaction: `Run`'s `RuleAt`, one theorem an index, the index concrete and everything else",
        "symbolic. A symbolic index can't be: its byte is a `BitVec` (Run). `Rule` puts the 256 together",
        "with `Run`'s two off-byte theorems. -/",
        "",
        "namespace Seedelf.V1",
        "",
    ]
    for k in range(lo, hi + 1):
        lines.append(f"theorem policy_one_line_at_{k} : RuleAt {k} := by blaster")
    lines += ["", "end Seedelf.V1", ""]
    return "\n".join(lines)

def rule_module():
    imports = [f"import Slice.Index{m}" for m in range(MODS)]
    arms = [f"  | {k}, _ => policy_one_line_at_{k}" for k in range(256)]
    return "\n".join(imports + [
        "",
        "/-! The Seedelf policy's rule for one mint line, in every transaction, put together.",
        "",
        "`Index0` to `Index3` prove `RuleAt k` for each first-input index `k` from 0 to 255, and `Run`",
        "proves it below 0 and above 255, so it holds at every index: `policy_one_line_any_index`,",
        "kernel-checked from those 258 Blaster theorems, no Blaster here. Every other value is symbolic",
        "in each, and every field the bytes don't read any `Data` (Run). So, for every mint of one line,",
        "in every transaction whose redeemer is a bytestring:",
        "",
        "- `policy_one_line_iff_every_tx`: the deployed bytes, run on it, succeed iff `policyAccepts`",
        "  holds: the first input's index is a byte, the line is the policy's own, and it burns one",
        "  token whose first four bytes are 5eed0e1f or mints one of the name `generate` gives the",
        "  first input and the tag;",
        "- `policy_one_line_unit_or_error_every_tx`: every run returns unit, which the ledger",
        "  accepts, or reaches `Error`, inside the step limit.",
        "",
        "Together: what `policyAccepts` allows returns unit, and nothing else does. Both hold for any",
        "interpretation of the slice (Run), and are stated over `ByteString` names; `…_any_tx` are the",
        "same over the name's `String`, as the per-index theorems have it. -/",
        "",
        "namespace Seedelf.V1",
        "open PlutusCore.ByteString (ByteString)",
        "open PlutusCore.Integer (Integer)",
        "open PlutusCore.Data (Data)",
        "open PlutusCore.UPLC.CekMachine (cekExecuteProgram)",
        "open PlutusCore.UPLC.Utils",
        "",
        "/-- Every index that is a byte, from its own theorem. -/",
        "theorem policy_one_line_at_a_byte : ∀ (k : Nat), k < 256 → RuleAt k",
    ] + arms + [
        "  | _ + 256, h => absurd h (by omega)",
        "",
        "/-- Every index: a byte, or below or above one. -/",
        "theorem policy_one_line_any_index : ∀ (idx : Int), RuleAt idx := by",
        "  intro idx",
        "  by_cases h0 : (0 : Int) ≤ idx",
        "  · by_cases h1 : idx ≤ (255 : Int)",
        "    · have e : (idx.toNat : Int) = idx := Int.toNat_of_nonneg h0",
        "      have hk : idx.toNat < 256 := by omega",
        "      have h := policy_one_line_at_a_byte idx.toNat hk",
        "      rwa [e] at h",
        "    · exact policy_one_line_above_a_byte idx h1",
        "  · exact policy_one_line_below_a_byte idx h0",
        "",
        "/-- In every transaction, one mint line passes iff `policyAccepts` holds. The token name is",
        "given by its bytes, as the per-index theorems have it. -/",
        "theorem policy_one_line_iff_any_tx :",
        "  ∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)",
        "    (tag txid : ByteString) (amt idx : Integer),",
        "    isSuccessful (sliceRuleRun r sigs out rest own pid tkn tag txid amt idx) ↔",
        "      policyAccepts own pid ⟨tkn⟩ tag txid amt idx = true :=",
        "  fun r sigs out rest own pid tkn tag txid amt idx =>",
        "    (policy_one_line_any_index idx r sigs out rest own pid tkn tag txid amt).1",
        "",
        "/-- Every run returns unit, which the ledger accepts, or reaches `Error`: none is cut off by",
        "the step limit, and none halts with another value. -/",
        "theorem policy_one_line_unit_or_error_any_tx :",
        "  ∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)",
        "    (tag txid : ByteString) (amt idx : Integer),",
        "    returnsUnit (sliceRuleRun r sigs out rest own pid tkn tag txid amt idx) ∨",
        "      isUnsuccessful (sliceRuleRun r sigs out rest own pid tkn tag txid amt idx) :=",
        "  fun r sigs out rest own pid tkn tag txid amt idx =>",
        "    (policy_one_line_any_index idx r sigs out rest own pid tkn tag txid amt).2",
        "",
        "/-- The rule over every `ByteString` name, a `⟨s⟩` of its bytes: the deployed bytes, run on",
        "`sliceRuleArgs` for 1500 steps, succeed iff `policyAccepts` holds. -/",
        "theorem policy_one_line_iff_every_tx :",
        "  ∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid tkn tag txid : ByteString)",
        "    (amt idx : Integer),",
        "    isSuccessful (cekExecuteProgram seedelfSlicePolicy.script",
        "        (sliceRuleArgs r sigs out rest own pid tkn tag txid amt idx) 1500) ↔",
        "      policyAccepts own pid tkn tag txid amt idx = true :=",
        "  fun r sigs out rest own pid tkn tag txid amt idx =>",
        "    policy_one_line_iff_any_tx r sigs out rest own pid tkn.data tag txid amt idx",
        "",
        "/-- And every such run returns unit or reaches `Error`. -/",
        "theorem policy_one_line_unit_or_error_every_tx :",
        "  ∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid tkn tag txid : ByteString)",
        "    (amt idx : Integer),",
        "    returnsUnit (cekExecuteProgram seedelfSlicePolicy.script",
        "        (sliceRuleArgs r sigs out rest own pid tkn tag txid amt idx) 1500) ∨",
        "      isUnsuccessful (cekExecuteProgram seedelfSlicePolicy.script",
        "        (sliceRuleArgs r sigs out rest own pid tkn tag txid amt idx) 1500) :=",
        "  fun r sigs out rest own pid tkn tag txid amt idx =>",
        "    policy_one_line_unit_or_error_any_tx r sigs out rest own pid tkn.data tag txid amt idx",
        "",
        "-- What the rule rests on: Blaster's `blasterProven` and Lean's own axioms, no `sorryAx`.",
        "#print axioms policy_one_line_iff_every_tx",
        "#print axioms policy_one_line_unit_or_error_every_tx",
        "",
        "end Seedelf.V1",
        "",
    ])

for m in range(MODS):
    with open(os.path.join(OUT, f"Index{m}.lean"), "w", encoding="utf-8") as f:
        f.write(index_module(m))
with open(os.path.join(OUT, "Rule.lean"), "w", encoding="utf-8") as f:
    f.write(rule_module())
print(f"wrote Index0.lean to Index{MODS - 1}.lean and Rule.lean in {OUT}")
