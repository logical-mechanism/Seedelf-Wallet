"""Reads each audit module's last build log (Lake's .trace) and compares its results with what
its source expects. Run after ./check.sh, from seedelf-verification/:

    python3 -I Audit/count.py audit-quick      the modules of one family (Audit/<family>.txt)
    python3 -I Audit/count.py                  every family

What a module expects comes from its own source, comments and strings stripped:
- a `#blaster … (solve-result: 1)` command must log "✅ Expected Falsified";
- every other `#blaster` command, and every `blaster` tactic, must log "✅ Valid";
- a `#guard` logs nothing when it holds and fails the build when it doesn't.

A module is ok only when its trace is newer than its source, has no error, no "❌" and no
"Undetermined" line, and holds exactly the expected counts. Blaster logs Undetermined as a
warning only (Blaster/Smt/Env.lean:70), so check.sh's "ok" can't tell it from Falsified; this
can. Lake writes no trace for a failed build: read check.sh's console output for those."""
import json, os, re, sys

SV = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT = os.path.join(SV, "Audit")
TRACES = os.path.join(SV, ".lake", "build", "lib", "lean")
FORBIDDEN_AXIOMS = ("sorryAx", "Lean.ofReduceBool", "Lean.trustCompiler")


def strip_comments(src):
    out, i, depth, n = [], 0, 0, len(src)
    while i < n:
        if src.startswith("/-", i):
            depth += 1
            i += 2
        elif depth and src.startswith("-/", i):
            depth -= 1
            i += 2
        elif depth:
            i += 1
        elif src.startswith("--", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
        elif src[i] == '"':
            j = i + 1
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            out.append('""')
            i = j + 1
        else:
            out.append(src[i])
            i += 1
    return "".join(out)


def expected(path):
    code = strip_comments(open(path, encoding="utf-8").read())
    falsified = valid = undetermined = 0
    for m in re.finditer(r"#blaster((?:\s*\([^()]*\))*)", code):
        opts = m.group(1)
        r = re.search(r"solve-result:\s*(\d)", opts)
        kind = int(r.group(1)) if r else 0
        if kind == 1:
            falsified += 1
        elif kind == 2:
            undetermined += 1
        else:
            valid += 1
    valid += len(re.findall(r"(?<![#\w.])blaster\b(?!\s*\[)", code))
    guards = len(re.findall(r"(?m)^\s*#guard\b", code))
    return {"valid": valid, "falsified": falsified, "undetermined": undetermined, "guards": guards}


def family(name):
    path = os.path.join(AUDIT, name + ".txt")
    return [l.strip() for l in open(path) if l.strip() and not l.startswith("#")]


def check(mod):
    src = os.path.join(SV, *mod.split(".")) + ".lean"
    trace = os.path.join(TRACES, *mod.split(".")) + ".trace"
    if not os.path.exists(src):
        return "MISSING", "no source " + os.path.relpath(src, SV), None
    exp = expected(src)
    if not os.path.exists(trace):
        return "NO TRACE", "never built, or its build failed: see check.sh's output", exp
    if os.path.getmtime(trace) < os.path.getmtime(src):
        return "STALE", "trace older than the source: rebuild it", exp
    log = json.load(open(trace)).get("log", [])
    msgs = [(e.get("level", ""), e.get("message", "")) for e in log]
    got = {
        "valid": sum("✅ Valid" in m for _, m in msgs),
        "falsified": sum("✅ Expected Falsified" in m for _, m in msgs),
        "undetermined": sum("✅ Expected Undetermined" in m for _, m in msgs),
    }
    problems = [m.splitlines()[0][:160] for lvl, m in msgs
                if lvl == "error" or "❌" in m or "⚠️ Undetermined" in m]
    # `#print axioms` output (audit-last): a proof may rest on blasterProven and Lean's three
    # standard axioms, never on these.
    problems += [f"axiom {a}: {m.splitlines()[0][:120]}" for _, m in msgs
                 for a in FORBIDDEN_AXIOMS if a in m]
    diffs = [f"{k} {got[k]}/{exp[k]}" for k in ("valid", "falsified", "undetermined") if got[k] != exp[k]]
    if problems or diffs:
        return "WRONG", "; ".join(diffs + problems[:4]), exp
    return "ok", f"{got['valid']} Valid, {got['falsified']} Expected Falsified, {exp['guards']} #guard", exp


def main():
    names = sys.argv[1:] or sorted(f[:-4] for f in os.listdir(AUDIT) if f.startswith("audit") and f.endswith(".txt"))
    totals = {"ok": 0}
    for name in names:
        mods = family(name)
        print(f"== {name} ({len(mods)} modules)")
        for mod in mods:
            status, note, _ = check(mod)
            totals[status] = totals.get(status, 0) + 1
            print(f"  {status:9} {mod}: {note}")
    print("\n== " + ", ".join(f"{v} {k}" for k, v in totals.items()))


if __name__ == "__main__":
    main()
