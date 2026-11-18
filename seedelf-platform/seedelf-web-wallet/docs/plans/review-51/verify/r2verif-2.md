# r2verif#2: verification

From lane R2verif, graded low by its finder.

## Trace: confirmed, low

The finding holds as described, and every figure in it reproduces.

**The mechanism.** check.sh:240 decides SORRY with `grep -cE`, which reads one line at a time. Lean 4.24 renders a `#print axioms` message at 120 columns as one group. If the message doesn't fit, every axiom goes on its own line, indented one space. `Name.lt` puts `propext` first, ahead of `sorryAx` and every `Classical.*`, `Lean.*` or `Quot.*` name. So once a list wraps and starts with `propext`, a `Lean.ofReduceBool`, `Lean.trustCompiler` or `sorryAx` lands on a continuation line. That line lacks "depends on axioms: [", so the module reads ok. check.sh:7-9 and README.md:176 both say such a module is SORRY.

**Nothing reaches it today.**
- None of FIXTREE's 665 traces names sorryAx or the compiler axioms.
- It takes a later maintainer edit: a `native_decide`, which Lean doesn't warn about, or a sorry reached only through the one warning check.sh filters (CekMachine.lean:309), or one under `set_option warn.sorry false`.

**What it costs.** A wrong `ok` line in check.sh's summary for an unguarded print, nothing more.

**The ways out.**
- tally.py:117-118 and count.py:117-123 test whole messages, and they flag both cases (run below).
- Every theorem CLAIMS.md cites has its `#print axioms` under `#guard_msgs`, which fails the build. In the finder's own example the guard catches it one module later:
  - the chain runs `filter_quantities_ne_one` → `filter_quantities_slots` → `owner_shaped_proofs_errors` / `mix_raw_proofs_errors` → `owner_raw_proofs_errors` / `mix_all_proofs_errors` → `owner_typed_wrong_quantities_errors` / `mix_typed_wrong_quantities_errors`;
  - those last two are guarded at LogicWrongQuantity.lean:167 and :174;
  - so `./check.sh lovejoin-any-tx` would show LogicCarrierPredicate `ok` but LogicWrongQuantity `FAILED`.
- The gap is real only where no guarded theorem sits above the edit.

That makes it a missing check with no reachable harm today, which is low on the brief's scale. It isn't known: it appears in none of the settled lists, and v5-2's class fix (verify/v5-2.md fix note 2, implemented in 40883a55) was meant to cover every bare print.

**Evidence:**

FIXTREE is at f88560c4. check.sh is unmodified in the working copy, and HEAD and the working copy share sha256 760776a7….

**Code read, with the toolchain at ~/.elan/toolchains/leanprover--lean4---v4.24.0/src/lean:**
- **check.sh:240:** `unsound=$(grep -cE "^warning: .*declaration uses 'sorry'|depends on axioms: \[.*(sorryAx|Lean\.ofReduceBool|Lean\.trustCompiler)" "$outf")`. It came in with 40883a55 (`git show 40883a55 -- seedelf-verification/check.sh`). Line 233 filters only `Replayed|CekMachine.lean:309|Successfully decoded|^trace: \.> LEAN_PATH`.
- **Lean/Elab/Print.lean:229:** `logInfo m!"'{constName}' depends on axioms: {axioms.qsort Name.lt |>.toList}"`.
- **Lean/Message.lean:**
  - :342 `bracket l f r := group (nest l.length <| l ++ f ++ r)`;
  - :354-356 `ofList xs := sbracket <| joinSep xs (ofFormat "," ++ Format.line)`;
  - :317 `toString := toString (← msgData.format)`.
- **Width:**
  - Init/Data/ToString/Basic.lean:115: `toString f := f.pretty`;
  - Init/Data/Format/Basic.lean:381: `defWidth := 120`;
  - :103: group defaults to `allOrNone`.
- **Name order:** Lean/Data/Name.lean:62-78, `Name.cmp` compares prefixes first.
- **native_decide:**
  - Lean/Elab/Tactic/ElabTerm.lean:421 builds `Lean.ofReduceBool aux true rfl`, and that path has no logWarning;
  - Init/Core.lean:2361-2364: `reduceBool`'s opaque body uses `trustCompiler`;
  - Lean/Util/CollectAxioms.lean:38 walks opaque values.
- **Lake:**
  - Lake/Util/Log.lean:158 builds the entry with `mkErrorStringWithPos … msg.data.trim`, and :143 prints it as `{level}: {message}`;
  - Lake/Build/Run.lean:123-143 replays every job's log at outLv;
  - Lake/Build/Context.lean:35 sets `outLv := verbosity.minLogLv`, which is info.
- **A real wrapped message** in FIXTREE's LogicCarrierPredicate.trace: `"Lovejoin/AnyTx/LogicCarrierPredicate.lean:147:0: 'Lovejoin.AnyTx.LogicCarrierPredicate.filter_quantities_ne_one' depends on axioms: [propext,\n Classical.choice,\n Quot.sound]"`.

**Scan (r2v2_scan.py) over FIXTREE's traces:**
- 443 bare prints in 59 modules; 223 already wrapped.
- The longest one-line message is 120 columns; the shortest wrapped one is 121.
- My model of Lean's layout reproduces all 443 messages exactly.
- check.sh's regex matches none of them today.
- With native_decide's two axioms added, it misses 323 of 443: Audit/Checks 187 of 307, Audit/Gaps 2 of 2, Lovejoin/AnyTx 134 of 134.
- With sorryAx added, it misses 274 of 443.
- The 120 caught are the `[Blaster.Tactic.blasterProven]`-only prints, where `Lean.ofReduceBool` sorts first.
- The finder's five-axiom message is 161 columns.

**Run (r2v2_run.sh):** check.sh and Audit/count.py were copied byte for byte (sha256 printed). A stand-in lake printed Lake-format console text, including the filtered CekMachine.lean:309 warning. FIXTREE's tally.py ran unmodified.

**Settled lists searched**, for 'one per line', 'wrap', 'format.width', '120 col', 'depends on axioms', 'ofReduceBool', 'trustCompiler', 'native_decide', 'SORRY' and 'continuation line': backlog.md, archive/plans, the chunk-46 and chunk-49 plans, Audit/review/findings.json and reviews.json, the verification READMEs, CLAIMS.md, SECURITY.md, and review-51's owner-calls.md, lanes, verify and fixes.
- Hits outside this finding's own records were unrelated: chunk-41's rfl note, review-1.8.1's "no native_decide", the audit's print-axioms-check proposal (closed by PrintAxioms) and chunk-46:46's blasterProven rename.
- v5-2's demo used names too short to wrap.

**Known:** Not known. Searched the brief's lists and found no entry for the wrap: backlog.md, archive/plans (the reviews' Not fixed lists), the chunk-46 and chunk-49 plans, Audit/review/findings.json and reviews.json, the verification READMEs' Not proved, CLAIMS.md, SECURITY.md, and review-51's owner-calls.md, lanes, verify and fixes. The nearest record is verify/v5-2.md fix note 2. It asked check.sh to fail on a "depends on axioms" line naming the forbidden axioms, to cover "every bare print in every family". 40883a55 implemented that one line at a time, and v5-2's demo names were too short to wrap.

**Fix notes:**

**What to change.** Make check.sh:240 read each message whole. Join every line that starts with a space (Lean's one-space nest for a wrapped list) onto the line before it, then match. Keep the same regex:

`unsound=$(awk 'NR > 1 && !/^ / { print buf; buf = "" } { buf = buf $0 } END { print buf }' "$outf" | grep -cE "^warning: .*declaration uses 'sorry'|depends on axioms: \[.*(sorryAx|Lean\.ofReduceBool|Lean\.trustCompiler)")`

In the run, this turns both wrapped cases into SORRY and keeps today's LogicCarrierPredicate text ok. The finder's other option is to decide SORRY from each module's own trace JSON, as tally.py does. That also covers it, but check.sh would then have to walk the imports' logs, which the console already carries.

**Do it with r2verif#1.** That fix also changes how check.sh decides SORRY (line 233's CekMachine.lean:309 pin). Once the check is true, check.sh:7-9 and README.md:176 can stay as they are.

**A regression fixture.** The run's R51.WrappedNative and R51.WrappedSorry consoles, fed to check.sh through a stand-in lake, need no Lean.

**The class:** a Lean or Lake message read one line at a time, where Lean's formatter can break it (any group past 120 columns). check.sh:240 is the only member:
- tally.py:117-118 and count.py:117-123 test whole messages;
- check.sh:239 matches Blaster's one-line "⚠️ Undetermined" (Blaster/Smt/Env.lean:70), and :249 matches Lake's one-line ✖ caption;
- the `#guard_msgs` expectations already spell the wrapped form (e.g. LogicWrongQuantity.lean:163-173).

No refusal, privacy default or screen is involved, so no owner call is needed.

**Test:** `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2verif_2-trace/r2v2_run.sh (plus r2v2_scan.py beside it)`

Result: r2v2_scan.py over FIXTREE's traces:
  bare #print axioms messages in traces: 443 (in 59 modules)
  already wrapped today: 223
  longest one-line data: 120 cols
  shortest wrapped data (as one line): 121 cols
  layout model reproduces Lean's text exactly: 443 of 443
  check.sh regex hits today: 0
  with native_decide added: check.sh's regex misses 323 of 443
     Audit/Checks 187 of 307 · Audit/Gaps 2 of 2 · Lovejoin/AnyTx 134 of 134
  with sorryAx added: check.sh's regex misses 274 of 443

r2v2_run.sh:
== the copies are FIXTREE's files, byte for byte
  760776a7…01442d  FIXTREE check.sh = r2v2pkg/check.sh; 56dcfc7b…363e61  FIXTREE count.py = copy
== the finder's case, as the stand-in lake prints it:
  info: R51/WrappedNative.lean:147:0: 'Lovejoin.AnyTx.LogicCarrierPredicate.filter_quantities_ne_one' depends on axioms: [propext,
   Classical.choice,
   Lean.ofReduceBool,
   Lean.trustCompiler,
   Quot.sound]
== FIXTREE's check.sh (the copy): exit 1
  SORRY     R51.ShortNative (1 sorry or native_decide, …)
  ok        R51.TodayClean
  ok        R51.WrappedNative        <- native_decide missed
  ok        R51.WrappedSorry         <- sorryAx after propext missed
  SORRY     R51.WrappedLeadNative (1 …)
  SORRY     R51.OneLineNative (1 …)
  SORRY     R51.SorryWarning (2 …)
== FIXTREE's tally.py:
  NOT OK R51.WrappedNative: a compiler-trusting axiom (native_decide)
  NOT OK R51.WrappedSorry: a sorry   (and the other four forbidden cases; 6 not ok, TodayClean ok)
== count.py (copy): WRONG R51.WrappedNative: axiom Lean.ofReduceBool …; axiom Lean.trustCompiler …
  WRONG R51.WrappedSorry: axiom sorryAx …   (== 1 ok, 6 WRONG)
== candidate fix (scratch copy, line 240 joined first):
  SORRY for WrappedNative and WrappedSorry too; TodayClean stays ok.
git status of FIXTREE's seedelf-verification is clean afterwards.

```
===== r2v2_run.sh =====
#!/usr/bin/env bash
# r2verif#2 verifier's run. No Lean is built and no lake runs.
# - FIXTREE's check.sh, copied byte for byte into a scratch package, runs with a stand-in `lake`
#   that prints, for each case, the console text Lake 4.24 prints piped (Build/Run.lean:112-143:
#   a caption, then each log entry as "<level>: <file>:<line>:<col>: <data>", Util/Log.lean:143,158).
# - FIXTREE's tally.py, and a byte-for-byte copy of its Audit/count.py, read trace fixtures that
#   hold the same messages, as Lake's .trace files do ({"log": [{"message", "level"}]}).
# - Every "depends on axioms" message is laid out by Lean 4.24's rule (Elab/Print.lean:229,
#   Message.lean:342-356, Format/Basic.lean:381: one line up to 120 columns, else one axiom a
#   line, indented one space; axioms sorted by Name.lt, Data/Name.lean:62-78). r2v2_scan.py shows
#   the rule reproduces all 443 bare prints in FIXTREE's traces character for character.
# Last: the same run through a copy of check.sh whose line 240 joins continuation lines first.
FIX=/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-verification
W=$(cd "$(dirname "$0")" && pwd)
P=$W/r2v2pkg
B=$W/r2v2bin
rm -rf "$P" "$B"
mkdir -p "$P/fixtures" "$P/Seedelf/Signers" "$P/Audit" "$P/R51" "$P/.lake/build/lib/lean/R51" "$B"
: > "$P/Seedelf/Signers/modules.txt"   # check.sh reads it at start; empty here
cp "$FIX/check.sh" "$P/check.sh"
cp "$FIX/Audit/count.py" "$P/Audit/count.py"
echo "== the copies are FIXTREE's files, byte for byte"
sha256sum "$FIX/check.sh" "$P/check.sh" "$FIX/Audit/count.py" "$P/Audit/count.py" | sed "s|$W/||"
cat > "$B/lake" <<'EOF'
#!/usr/bin/env bash
# Stand-in for `lake build M`: print M's console fixture and succeed, as a build that passed.
[ "$1" = build ] || { echo "stand-in lake: unexpected $*" >&2; exit 2; }
cat "$R2V2_FIXTURES/$2.out"
EOF
chmod +x "$B/lake"

python3 -I - "$P" <<'EOF'
import functools, json, os, sys, time
P = sys.argv[1]
WIDTH = 120  # Format.defWidth; MessageData.toString is f.pretty at column 0

def name_cmp(a, b):  # Name.cmp: prefixes first, then the last component, by code point
    def cmp(x, y):
        if not x and not y: return 0
        if not x: return -1
        if not y: return 1
        c = cmp(x[:-1], y[:-1])
        return c if c else (x[-1] > y[-1]) - (x[-1] < y[-1])
    return cmp(a.split("."), b.split("."))

def data(thm, axioms):  # printAxiomsOf's text, as Lean lays it out
    axs = sorted(set(axioms), key=functools.cmp_to_key(name_cmp))
    one = f"'{thm}' depends on axioms: [" + ", ".join(axs) + "]"
    return one if len(one) <= WIDTH else f"'{thm}' depends on axioms: [" + ",\n ".join(axs) + "]"

STD = ["propext", "Classical.choice", "Quot.sound"]
NATIVE = ["Lean.ofReduceBool", "Lean.trustCompiler"]
LCP = "Lovejoin.AnyTx.LogicCarrierPredicate."
cases = {
    # v5-2's demo: short, so one line, the compiler axioms first
    "R51.ShortNative": [("info", 4, data("R51V52Demo.nativeThm", NATIVE))],
    # today's LogicCarrierPredicate, as its trace logs it (the control: nothing forbidden)
    "R51.TodayClean": [("info", 145, data(LCP + "quantity_checked", STD)),
                       ("info", 147, data(LCP + "filter_quantities_ne_one", STD))],
    # the finder's case: a native_decide closes a lemma under filter_quantities_ne_one
    "R51.WrappedNative": [("info", 145, data(LCP + "quantity_checked", STD)),
                          ("info", 147, data(LCP + "filter_quantities_ne_one", STD + NATIVE))],
    # a sorryAx that reaches the theorem only through #print axioms (its warning filtered)
    "R51.WrappedSorry": [("info", 147, data(LCP + "filter_quantities_ne_one", STD + ["sorryAx"]))],
    # wrapped, but a Blaster-only theorem: the compiler axioms sort first, onto line 1
    "R51.WrappedLeadNative": [("info", 335, data("Lovejoin.V2.Any3.mixany3_second_box_holds_no_other_token",
                                                 ["Blaster.Tactic.blasterProven"] + NATIVE))],
    # a short name with propext: still one line, so it is caught
    "R51.OneLineNative": [("info", 4, data("R51.t", STD + NATIVE))],
    # an in-package sorry: its own warning (the path check.sh's first alternative covers)
    "R51.SorryWarning": [("warning", 3, "declaration uses 'sorry'"),
                         ("info", 5, data("R51.s", ["sorryAx"]))],
}
fx = os.path.join(P, "fixtures")
for mod, entries in cases.items():
    rel = mod.replace(".", "/") + ".lean"
    msgs = [(lvl, f"{rel}:{ln}:0: {d}") for lvl, ln, d in entries]
    top = "⚠" if any(l == "warning" for l, _ in msgs) else "ℹ"
    out = ["⚠ [57/130] Replayed PlutusCore.UPLC.CekMachine",
           "warning: PlutusCore/UPLC/CekMachine.lean:309:4: declaration uses 'sorry'",
           "✔ [128/130] Replayed Lovejoin.AnyTx.LogicNameLookup",
           f"{top} [129/130] Built {mod} (12s)"]
    out += [f"{lvl}: {m}" for lvl, m in msgs]
    out += ["Build completed successfully (130 jobs)."]
    open(os.path.join(fx, mod + ".out"), "w", encoding="utf-8").write("\n".join(out) + "\n")
    # the source tally.py and count.py hold the trace against: no Blaster checks, no #guard
    src = os.path.join(P, rel)
    open(src, "w", encoding="utf-8").write(
        "-- r2verif#2 fixture source\ntheorem fixture_thm : True := trivial\n#print axioms fixture_thm\n")
    tr = os.path.join(P, ".lake", "build", "lib", "lean", mod.replace(".", "/") + ".trace")
    json.dump({"synthetic": False, "outputs": {}, "inputs": [], "depHash": "0",
               "log": [{"message": m, "level": lvl} for lvl, m in msgs]}, open(tr, "w", encoding="utf-8"))
    t = time.time() + 5
    os.utime(tr, (t, t))  # the trace is newer than its source, as after a build
open(os.path.join(P, "Audit", "audit-r51.txt"), "w").write("\n".join(cases) + "\n")
EOF

echo
echo "== the finder's case, as the stand-in lake prints it (R51.WrappedNative.out)"
cat "$P/fixtures/R51.WrappedNative.out"
echo
mods=(R51.ShortNative R51.TodayClean R51.WrappedNative R51.WrappedSorry R51.WrappedLeadNative
  R51.OneLineNative R51.SorryWarning)
echo "== FIXTREE's check.sh (the copy), over the seven cases"
( cd "$P" && R2V2_FIXTURES="$P/fixtures" PATH="$B:$PATH" TMPDIR="$W" CAP=1G LIMIT=1m ./check.sh "${mods[@]}" ) \
  > "$W/r2v2_check.out" 2>&1
echo "exit $?"
sed -n '/^== summary/,$p' "$W/r2v2_check.out"
echo
echo "== FIXTREE's tally.py over the same messages, read from the traces"
python3 -I "$FIX/tally.py" "$P/R51"
echo
echo "== FIXTREE's Audit/count.py (the copy), the same"
python3 -I "$P/Audit/count.py" audit-r51
echo
echo "== a candidate fix, in a scratch copy: line 240 reads each message whole"
sed 's|unsound=$(grep -cE "\(.*\)" "$outf")|unsound=$(awk '"'"'NR > 1 \&\& !/^ / { print buf; buf = "" } { buf = buf $0 } END { print buf }'"'"' "$outf" \| grep -cE "\1")|' \
  "$P/check.sh" > "$P/check-joined.sh"
chmod +x "$P/check-joined.sh"
diff "$P/check.sh" "$P/check-joined.sh"
( cd "$P" && R2V2_FIXTURES="$P/fixtures" PATH="$B:$PATH" TMPDIR="$W" CAP=1G LIMIT=1m ./check-joined.sh "${mods[@]}" ) \
  > "$W/r2v2_joined.out" 2>&1
echo "exit $?"
sed -n '/^== summary/,$p' "$W/r2v2_joined.out"

===== r2v2_scan.py (run: python3 -I r2v2_scan.py FIXTREE/seedelf-verification/.lake/build/lib/lean) =====
#!/usr/bin/env python3
# r2verif#2 verifier: read FIXTREE's module traces (read-only), find every bare
# `#print axioms` message, and check how Lean laid it out. Then re-lay each one
# with native_decide's two axioms (or sorryAx) added, as Lean 4.24 would, and run
# check.sh:240's regex over it one line at a time, as grep does.
import json, os, re, sys
root = sys.argv[1]
WIDTH = 120
CHECK_RE = re.compile(r"depends on axioms: \[.*(sorryAx|Lean\.ofReduceBool|Lean\.trustCompiler)")
MSG_RE = re.compile(r"^(?P<pos>[^:]+:\d+:\d+): '(?P<name>.+)' depends on axioms: \[(?P<list>.*)\]$", re.S)
def name_cmp(a, b):
    pa, pb = a.split("."), b.split(".")
    def cmp(x, y):
        if not x and not y: return 0
        if not x: return -1
        if not y: return 1
        c = cmp(x[:-1], y[:-1])
        if c: return c
        return (x[-1] > y[-1]) - (x[-1] < y[-1])
    return cmp(pa, pb)
def lay_out(name, axioms):
    import functools
    axs = sorted(set(axioms), key=functools.cmp_to_key(name_cmp))
    one = f"'{name}' depends on axioms: [" + ", ".join(axs) + "]"
    if len(one) <= WIDTH:
        return one
    return f"'{name}' depends on axioms: [" + ",\n ".join(axs) + "]"
def check_sh_hits(console_text):
    return sum(1 for ln in console_text.split("\n") if CHECK_RE.search(ln))
prints = []
for dp, _, fs in os.walk(root):
    for f in fs:
        if not f.endswith(".trace"):
            continue
        p = os.path.join(dp, f)
        try:
            d = json.load(open(p))
        except Exception:
            continue
        mod = os.path.relpath(p, root)[:-len(".trace")].replace(os.sep, ".")
        for e in d.get("log", []):
            m = e.get("message", "")
            if "depends on axioms" not in m:
                continue
            mm = MSG_RE.match(m)
            if not mm:
                print("UNPARSED", mod, repr(m[:200])); continue
            data = m[len(mm.group("pos")) + 2:]
            axioms = [a.strip() for a in mm.group("list").split(",")]
            prints.append((mod, mm.group("name"), data, axioms))
def family(mod):
    if mod.startswith("Lovejoin.AnyTx."): return "Lovejoin/AnyTx"
    if mod.startswith("Audit.Checks."): return "Audit/Checks"
    if mod.startswith("Audit.Gaps."): return "Audit/Gaps"
    return mod.rsplit(".", 1)[0]
print(f"bare #print axioms messages in traces: {len(prints)} (in {len(set(p[0] for p in prints))} modules)")
wrapped = [p for p in prints if "\n" in p[2]]
oneline = [p for p in prints if "\n" not in p[2]]
print(f"already wrapped today: {len(wrapped)}")
print(f"longest one-line data: {max(len(p[2]) for p in oneline)} cols")
print(f"shortest wrapped data (as one line): {min(len(p[2].replace(chr(10)+' ', ' ')) for p in wrapped)} cols")
mismatch = [p for p in prints if lay_out(p[1], p[3]) != p[2]]
print(f"layout model reproduces Lean's text exactly: {len(prints) - len(mismatch)} of {len(prints)}")
print(f"check.sh regex hits today: {sum(check_sh_hits(p[2]) for p in prints)}")
from collections import Counter
for label, extra in (("native_decide", ["Lean.ofReduceBool", "Lean.trustCompiler"]), ("sorryAx", ["sorryAx"])):
    missed = Counter(); total = Counter()
    for mod, name, data, axioms in prints:
        txt = lay_out(name, axioms + extra)
        fam = family(mod)
        total[fam] += 1
        if check_sh_hits("info: X.lean:1:0: " + txt) == 0:
            missed[fam] += 1
    print(f"with {label} added: check.sh's regex misses {sum(missed.values())} of {sum(total.values())}")
    for fam in sorted(total):
        print(f"   {fam:28s} {missed[fam]:4d} of {total[fam]:4d}")
```
