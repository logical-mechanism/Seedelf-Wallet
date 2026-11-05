"""What each module's last build proved, read from Lake's traces and held against its source,
as Audit/count.py does for the audit's families:

    python3 -I tally.py Seedelf          every module under Seedelf/
    python3 -I tally.py Slice/Slice      Slice/'s, from its own package's traces

A module is ok when its trace is newer than its source, holds no error, no "❌", no
"Undetermined" and no `sorry`, and holds exactly as many "✅ Valid" as its source has `blaster`
proofs and plain `#blaster` checks, and "✅ Expected Falsified" as `#blaster (solve-result: 1)`
checks (comments and strings stripped). check.sh's `ok` can't tell Valid from Undetermined, since
Blaster logs Undetermined as a warning only; this can. Lake writes no trace for a failed build. A
module with nothing to prove and no trace, such as an aggregator check.sh never builds, is
skipped and listed."""
import glob, json, os, re, sys


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


lib = sys.argv[1].rstrip("/")
root = os.path.dirname(lib) or "."
srcs = sorted(glob.glob(os.path.join(lib, "**", "*.lean"), recursive=True))
total_v = total_f = 0
bad, skipped = [], []
for src in srcs:
    rel = os.path.relpath(src, root)[:-len(".lean")]
    mod = rel.replace(os.sep, ".")
    ev, ef = expected(strip(open(src, encoding="utf-8").read()))
    trace = os.path.join(root, ".lake", "build", "lib", "lean", rel + ".trace")
    if not os.path.exists(trace):
        (skipped if (ev, ef) == (0, 0) else bad).append(f"{mod}: no trace (failed, or never built)")
        continue
    msgs = [(e.get("level"), e.get("message", "")) for e in json.load(open(trace, encoding="utf-8")).get("log", [])]
    v = sum(m.count("✅ Valid") for _, m in msgs)
    f = sum(m.count("✅ Expected Falsified") for _, m in msgs)
    total_v += v; total_f += f
    problems = [p for p, hit in [
        ("built before its source changed", os.path.getmtime(trace) < os.path.getmtime(src)),
        ("an error", any(l == "error" for l, _ in msgs)),
        ("a ❌", any("❌" in m for _, m in msgs)),
        ("Undetermined", any("Undetermined" in m for _, m in msgs)),
        ("a sorry", any("sorry" in m for _, m in msgs)),
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
