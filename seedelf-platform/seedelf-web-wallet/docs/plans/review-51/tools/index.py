#!/usr/bin/env python3
"""Write INDEX.md: every lane finding on one line, the merges, and each lane's coverage.

Usage: index.py FOLDER   (reads FOLDER/data/<lane>.json, FOLDER/data/verify-*.json, FOLDER/merges.json)"""
import glob, json, os, sys

folder = sys.argv[1]
data = os.path.join(folder, "data")
lanes = {}
for f in sorted(glob.glob(os.path.join(data, "*.json"))):
    name = os.path.basename(f)[:-5]
    if name.startswith("verify") or name.startswith("severity"):
        continue
    lanes[name] = json.load(open(f))
verdicts = {}
for f in sorted(glob.glob(os.path.join(data, "verify-*.json"))):
    for r in json.load(open(f)):
        vs = [r.get(k) for k in ("tiebreak", "trace", "impact") if r.get(k)]
        if r.get("tiebreak"):
            v = r["tiebreak"]
        elif vs:
            # the lower of two verdicts' severities, the trace's verdict
            order = ["nit", "low", "medium", "high", "critical"]
            v = dict(vs[0])
            v["severity"] = min((x["severity"] for x in vs), key=order.index)
        else:
            v = None
        verdicts[r["id"]] = v
ties = os.path.join(data, "severity-tiebreaks.json")
if os.path.exists(ties):
    for t in json.load(open(ties)):
        if verdicts.get(t["id"]):
            verdicts[t["id"]] = dict(verdicts[t["id"]], severity=t["severity"])
merges = json.load(open(os.path.join(folder, "merges.json"))) if os.path.exists(os.path.join(folder, "merges.json")) else {}
dup_of = {d: k for k, ds in merges.items() for d in ds}

order = "R1 R2a R2b R3a R3b R4 W1a W1b W2 W3 E1a E1b E2a E2b E3a E3b E4a E4b E5 E6 E7a E7b E8a E8b E9a E9b B1 D1 V1 V2 V3 V4a V4b V5".split()
names = [n for n in order if n in lanes] + sorted(n for n in lanes if n not in order)
out = ["# Chunk 51 · Every lane finding, one line each", "",
       "Made by `tools/index.py` from `data/`. Severity is the finder's; *verified* gives the verifiers' (the lower of trace and impact, or the tiebreak's). A finding merged into another names it. Full text: `lanes/<lane>.md`; verdicts: `verify/<id>.md`.", ""]
for n in names:
    d = lanes[n]
    out.append(f"## {n} ({len(d.get('findings', []))} findings, {len(d.get('guards', []))} guards)")
    out.append("")
    for x in d.get("findings", []):
        v = verdicts.get(x["id"])
        vs = f" · verified **{v['verdict']}, {v['severity']}**" if v else ""
        m = f" · merged into {dup_of[x['id']]}" if x["id"] in dup_of else ""
        out.append(f"- `{x['id']}` {x['severity']} ({x['who']}): {x['title']} `{x['file'].split('/')[-1]}:{x['line']}`{vs}{m}")
    if not d.get("findings"):
        out.append("- none")
    cov = str(d.get("coverage", "")).strip().replace("\n", " ")
    out += ["", f"*Coverage:* {cov[:900]}{'…' if len(cov) > 900 else ''}", ""]
open(os.path.join(folder, "INDEX.md"), "w").write("\n".join(out))
print(sum(len(d.get("findings", [])) for d in lanes.values()), "findings in", len(lanes), "lanes")
