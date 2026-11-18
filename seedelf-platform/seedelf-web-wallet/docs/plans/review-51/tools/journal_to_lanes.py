#!/usr/bin/env python3
"""Write each finished agent's structured answer from a workflow journal into the working folder.

Usage: journal_to_lanes.py JOURNAL OUTDIR [PREFIX]
Writes OUTDIR/<label>.md for every agent with a result, and OUTDIR/../data/<PREFIX><label>.json.
Labels come from the journal's 'started' entries (agentId -> label)."""
import json, os, sys

journal, outdir = sys.argv[1], sys.argv[2]
prefix = sys.argv[3] if len(sys.argv) > 3 else ""
datadir = os.path.join(os.path.dirname(os.path.abspath(outdir.rstrip("/"))), "data")
os.makedirs(outdir, exist_ok=True)
os.makedirs(datadir, exist_ok=True)

label_of, results = {}, {}
for line in open(journal):
    try:
        e = json.loads(line)
    except Exception:
        continue
    if e.get("type") == "started":
        label_of[e.get("agentId")] = e.get("label")
    elif e.get("type") == "result":
        results[e.get("agentId")] = e.get("result")

def md_finding(f):
    out = [f"### {f.get('id','?')} · {f.get('severity','?')} · {f.get('title','')}", ""]
    out.append(f"- **Where:** `{f.get('file','')}:{f.get('line','')}`")
    out.append(f"- **Who:** {f.get('who','')} · **Since:** {f.get('since','')} · **Confidence:** {f.get('confidence','')}")
    if f.get("needs_owner"):
        out.append(f"- **Needs the owner:** {f.get('owner_why','yes')}")
    for key, name in (("scenario", "Scenario"), ("evidence", "Evidence"), ("fix", "Fix"), ("known_check", "Known check")):
        out += ["", f"**{name}:**", "", str(f.get(key, "")).strip()]
    for key, name in (("verdict", "Verdict"),):
        if key in f:
            out += ["", f"**{name}:** {f[key]}"]
    return "\n".join(out)

done = []
for agent, res in results.items():
    label = label_of.get(agent)
    if not label or not isinstance(res, dict):
        continue
    done.append(label)
    with open(os.path.join(datadir, f"{prefix}{label}.json"), "w") as fh:
        json.dump(res, fh, indent=1, ensure_ascii=False)
    lines = [f"# Lane {label}", "", f"Returned by the workflow's agent `{agent}`, written here by the lead from its structured answer.", ""]
    fs = res.get("findings", [])
    lines += [f"## Findings ({len(fs)})", ""]
    for f in fs:
        lines += [md_finding(f), ""]
    if not fs:
        lines += ["None.", ""]
    g = res.get("guards", [])
    if g:
        lines += [f"## Guards ({len(g)})", "", "| Where | What it stops | Test |", "|---|---|---|"]
        for x in g:
            esc = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
            lines.append(f"| `{esc(x.get('file',''))}:{x.get('line','')}` | {esc(x.get('stops',''))} | {esc(x.get('test',''))} |")
        lines.append("")
    for key, name in (("checked_ok", "Checked and holds"), ("notes", "Notes")):
        items = res.get(key, [])
        if items:
            lines += [f"## {name}", ""] + [f"- {str(i).strip()}" for i in items] + [""]
    if res.get("coverage"):
        lines += ["## Coverage", "", str(res["coverage"]).strip(), ""]
    # Extra keys (lens or verifier schemas) as JSON.
    extra = {k: v for k, v in res.items() if k not in ("findings", "guards", "checked_ok", "notes", "coverage")}
    if extra:
        lines += ["## Other fields", "", "```json", json.dumps(extra, indent=1, ensure_ascii=False), "```", ""]
    with open(os.path.join(outdir, f"{label}.md"), "w") as fh:
        fh.write("\n".join(lines))
print(" ".join(sorted(done)))
