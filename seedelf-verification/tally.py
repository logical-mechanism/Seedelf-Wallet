"""What each module's last build proved, read from Lake's traces and held against its source,
as Audit/count.py does for the audit's families:

    python3 -I tally.py Seedelf          every module under Seedelf/
    python3 -I tally.py Slice/Slice      Slice/'s, from its own package's traces

A module is ok when its trace is newer than its source, every module it imports, directly or not,
in this package or a dependency's (.lake/packages/), has a trace, and its log holds no error, no
"❌", no "Undetermined", no `sorry` and no compiler-trusting axiom (`native_decide`), and exactly
as many "✅ Valid" as its source has `blaster` proofs and plain `#blaster` checks, and "✅
Expected Falsified" as `#blaster (solve-result: 1)` checks (comments and strings stripped). What
this adds to check.sh's summary of one run: each module's ✅ held against its own source,
whichever runs built it. check.sh dates each trace it reads to its run, a log Lake replayed too
(Lake replays one only for the source it was built from), so a trace older than its source is one
no run has read since the source was written: `./check.sh <module>` rebuilds it or reads it again.

Lake writes a trace when a build ends and keeps the last good one when a rebuild fails, so
check.sh removes a failed module's build, here or in the dependency that holds it: here it reads
as not built, and every module resting on it as not ok. This reads the last builds only: an
import or a pin changed since one shows only once check.sh rebuilds, so run check.sh on what you
count. A module that is only imports, an aggregator check.sh never builds, is skipped and
listed; a lakefile.lean is no module."""
import glob, json, os, re, sys

# The axioms of a proof the compiler checked, not the kernel (`native_decide`).
COMPILER = ("Lean.ofReduceBool", "Lean.trustCompiler")


def strip(src):
    out, i, depth, n = [], 0, 0, len(src)
    while i < n:
        if src.startswith("/-", i):
            depth += 1; i += 2
        elif depth and src.startswith("-/", i):
            depth -= 1; i += 2
        elif depth:
            i += 1
        elif src.startswith("--", i):
            j = src.find("\n", i); i = n if j < 0 else j
        elif src[i] == '"':
            j = i + 1
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            out.append('""'); i = j + 1
        else:
            out.append(src[i]); i += 1
    return "".join(out)


def expected(code):
    checks = r"#blaster((?:\s*\([^()]*\))*)"
    valid = falsified = 0
    for m in re.finditer(checks, code):
        r = re.search(r"solve-result:\s*(\d)", m.group(1))
        k = int(r.group(1)) if r else 0
        falsified += k == 1
        valid += k == 0
    valid += len(re.findall(r"\bblaster\b", re.sub(checks, "", code)))
    return valid, falsified


IMPORT = r"(?<![\w.])import\s+([A-Za-z_][\w.]*)"
lib = sys.argv[1].rstrip("/")
root = os.path.dirname(lib) or "."
traces = os.path.join(root, ".lake", "build", "lib", "lean")
# This package, then each dependency Lake keeps under .lake/packages/ (each its own root, with its
# own .lake/build): where a module's source and trace are.
roots = [root] + sorted(glob.glob(os.path.join(root, ".lake", "packages", "*")))
codes, holes, homes = {}, {}, {}


def path(base, mod, ext):
    return os.path.join(base, *mod.split(".")) + ext


def home(mod):
    """The root of the package that holds `mod`'s source, this one or a dependency's, or None."""
    if mod not in homes:
        homes[mod] = next((r for r in roots if os.path.exists(path(r, mod, ".lean"))), None)
    return homes[mod]


def code(mod):
    if mod not in codes:
        codes[mod] = strip(open(path(home(mod), mod, ".lean"), encoding="utf-8").read())
    return codes[mod]


def hole(mod):
    """A module `mod` imports, directly or not, here or in a dependency, with no trace, or None."""
    if mod not in holes:
        holes[mod] = None  # an import cycle, which Lean refuses, ends here
        for imp in re.findall(IMPORT, code(mod)):
            r = home(imp)
            if imp != mod and r is not None:
                found = (imp if not os.path.exists(path(os.path.join(r, ".lake", "build", "lib", "lean"), imp, ".trace"))
                         else hole(imp))
                if found:
                    holes[mod] = found
                    break
    return holes[mod]


srcs = sorted(s for s in glob.glob(os.path.join(lib, "**", "*.lean"), recursive=True)
              if os.path.basename(s) != "lakefile.lean")
total_v = total_f = 0
bad, skipped = [], []
for src in srcs:
    mod = os.path.relpath(src, root)[:-len(".lean")].replace(os.sep, ".")
    ev, ef = expected(code(mod))
    trace = path(traces, mod, ".trace")
    if not os.path.exists(trace):
        if re.sub(IMPORT, "", code(mod)).strip():
            bad.append(f"{mod}: no trace (failed, or never built)")
        else:
            skipped.append(f"{mod}: no trace, and only imports")
        continue
    try:
        msgs = [(e.get("level"), e.get("message", ""))
                for e in json.load(open(trace, encoding="utf-8")).get("log", [])]
    except (OSError, ValueError) as e:
        bad.append(f"{mod}: its trace doesn't read ({type(e).__name__}): run ./check.sh on it")
        continue
    v = sum(m.count("✅ Valid") for _, m in msgs)
    f = sum(m.count("✅ Expected Falsified") for _, m in msgs)
    total_v += v; total_f += f
    under = hole(mod)
    problems = [p for p, hit in [
        ("a trace older than its source (run ./check.sh on it)", os.path.getmtime(trace) < os.path.getmtime(src)),
        (f"rests on {under}, which has no trace", under is not None),
        ("an error", any(l == "error" for l, _ in msgs)),
        ("a ❌", any("❌" in m for _, m in msgs)),
        ("Undetermined", any("Undetermined" in m for _, m in msgs)),
        ("a sorry", any("sorry" in m for _, m in msgs)),
        ("a compiler-trusting axiom (native_decide)", any(a in m for _, m in msgs for a in COMPILER)),
        (f"{v} Valid where it expects {ev}", v != ev),
        (f"{f} Expected Falsified where it expects {ef}", f != ef),
    ] if hit]
    if problems:
        bad.append(f"{mod}: " + ", ".join(problems))
for line in bad:
    print("NOT OK  ", line)
for line in skipped:
    print("skipped ", line)
print(f"== {lib}: {len(srcs) - len(skipped)} modules, {total_v} Valid, {total_f} Expected Falsified, "
      f"{len(bad)} not ok")
