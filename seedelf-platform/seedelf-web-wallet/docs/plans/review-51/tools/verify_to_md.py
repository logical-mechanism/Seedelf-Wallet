#!/usr/bin/env python3
"""Write a verification workflow's results (a JSON list) as verify/<id>.md, one file a finding.

Usage: verify_to_md.py RESULTS.json OUTDIR"""
import json, os, sys

results, outdir = json.load(open(sys.argv[1])), sys.argv[2]
os.makedirs(outdir, exist_ok=True)
for r in results:
    fid = r["id"]
    lines = [f"# {fid}: verification", "", f"From lane {r['lane']}, graded {r['severity']} by its finder."]
    if r.get("dups"):
        lines.append(f"Also reported as {', '.join(r['dups'])}.")
    lines.append("")
    for who in ("trace", "impact", "tiebreak"):
        v = r.get(who)
        if not v:
            continue
        lines += [f"## {who.capitalize()}: {v['verdict']}, {v['severity']}", "", v["reason"].strip(), ""]
        if v.get("evidence", "").strip():
            lines += ["**Evidence:**", "", v["evidence"].strip(), ""]
        if v.get("known_ref", "").strip():
            lines += [f"**Known:** {v['known_ref'].strip()}", ""]
        if v.get("fix_notes", "").strip():
            lines += ["**Fix notes:**", "", v["fix_notes"].strip(), ""]
        if v.get("test_file", "").strip():
            lines += [f"**Test:** `{v['test_file'].strip()}`", "", f"Result: {v.get('test_result','').strip()}", "", "```", v.get("test_code", "").strip(), "```", ""]
    if not any(r.get(w) for w in ("trace", "impact", "tiebreak")):
        lines += ["Not verified: its verifier returned nothing.", ""]
    with open(os.path.join(outdir, fid.replace("#", "-") + ".md"), "w") as fh:
        fh.write("\n".join(lines))
print(len(results))
