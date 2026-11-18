#!/usr/bin/env python3
"""Write FINDINGS.md: every finding's outcome, the owner's calls, and what's left.

Usage: findings.py FOLDER

Reads FOLDER/data/<lane>.json (the findings), data/verify-*.json and
data/severity-tiebreaks.json (the verdicts), merges.json, data/fixed-in.json
(the commits whose messages name a finding, and each T1 lane's test commits),
data/status.json (the lead's overrides) and owner-calls.md (the owner's list,
written by hand). Prints any finding it can't place, which should be none."""
import glob, json, os, sys

folder = sys.argv[1]
data = os.path.join(folder, "data")
ORDER = ["nit", "low", "medium", "high", "critical"]

lanes = {}
for f in sorted(glob.glob(os.path.join(data, "*.json"))):
    name = os.path.basename(f)[:-5]
    if name.startswith(("verify", "severity", "fixed-in", "status")):
        continue
    lanes[name] = json.load(open(f))
verdicts = {}
for f in sorted(glob.glob(os.path.join(data, "verify-*.json"))):
    for r in json.load(open(f)):
        vs = [r.get(k) for k in ("trace", "impact") if r.get(k)]
        if r.get("tiebreak"):
            v = dict(r["tiebreak"])
        elif vs:
            v = dict(vs[0])
            v["severity"] = min((x["severity"] for x in vs), key=ORDER.index)
            if all(x["verdict"] == "refuted" for x in vs):
                v["verdict"] = "refuted"
        else:
            v = None
        verdicts[r["id"]] = v
for t in json.load(open(os.path.join(data, "severity-tiebreaks.json"))):
    if verdicts.get(t["id"]):
        verdicts[t["id"]]["severity"] = t["severity"]
merges = json.load(open(os.path.join(folder, "merges.json")))
dup_of = {d: k for k, ds in merges.items() for d in ds}
fixed_in = json.load(open(os.path.join(data, "fixed-in.json")))
status = json.load(open(os.path.join(data, "status.json")))
owner_md = open(os.path.join(folder, "owner-calls.md")).read()

AREAS = [
    ("seedelf-platform/seedelf-core/", "Core"),
    ("seedelf-platform/seedelf-cli/", "The CLI"),
    ("seedelf-platform/seedelf-koios/", "The CLI"),
    ("seedelf-platform/seedelf-crypto/", "Crypto"),
    ("seedelf-platform/seedelf-display/", "The CLI"),
    ("seedelf-platform/seedelf-web-wallet/wasm/", "The WebAssembly"),
    ("seedelf-platform/seedelf-web-wallet/extension/src/background/", "The worker"),
    ("seedelf-platform/seedelf-web-wallet/extension/src/ui/", "The screens"),
    ("seedelf-platform/seedelf-web-wallet/extension/src/", "The worker"),
    ("seedelf-verification/", "The proofs"),
]


def area(path):
    for prefix, name in AREAS:
        if path.startswith(prefix):
            return name
    return "Docs, build and CI"


def short(path):
    return path.split("/")[-1]


rows = []
for lane, d in lanes.items():
    for x in d.get("findings", []):
        i = x["id"]
        v = verdicts.get(i)
        sev = v["severity"] if v else x["severity"]
        verdict = v["verdict"] if v else None
        s = status.get(i, {})
        named = fixed_in["by_finding"].get(i, {})
        commits = sorted({h for hs in named.values() for h in hs})
        if i in dup_of:
            out = "merged"
        elif s.get("status"):
            out = s["status"]
            commits = s.get("commits", commits)
        elif verdict == "refuted":
            out = "refuted"
        elif commits:
            out = "fixed"
        elif x.get("needs_owner") and f"**{i}**" in owner_md:
            out = "owner"
        elif lane in fixed_in["by_t1_lane"]:
            out = "fixed"
            commits = fixed_in["by_t1_lane"][lane]
        else:
            out = "unplaced"
        rows.append(dict(id=i, lane=lane, sev=sev, found=x["severity"], verdict=verdict, out=out,
                         commits=commits, title=x["title"], file=x["file"], line=x["line"],
                         note=s.get("note", ""), area=area(x["file"]), t1=lane.startswith("T1")))

unplaced = [r["id"] for r in rows if r["out"] == "unplaced"]
for i in unplaced:
    print("unplaced:", i)
owner_missing = [r["id"] for r in rows if r["out"] == "owner" and f"**{r['id']}**" not in owner_md]
for i in owner_missing:
    print("owner, not in owner-calls.md:", i)

count = lambda f: sum(1 for r in rows if f(r))
outs = ["fixed", "owner", "covered", "moot", "unreachable", "open", "refuted", "unverified", "merged"]
sevs = ["critical", "high", "medium", "low", "nit"]
out = [
    "# Chunk 51 · Findings",
    "",
    "Made by `tools/findings.py` from `data/` and [owner-calls.md](owner-calls.md). Every finding of the review, by what became of it. Severity is the verifiers' where they ran (the lower of trace and impact, or the tiebreak's), else the finder's; nits and D1's findings had no verifiers, by the plan. Each finding's text is in `lanes/<lane>.md`, its verdict in `verify/<id>.md`, one line each in [INDEX.md](INDEX.md).",
    "",
    "T1's findings are guards that no test pinned: a T1 agent reverted each in a copy and every test still passed. Fixing one means adding the test that fails without it.",
    "",
    "## Counts",
    "",
    "| Severity | " + " | ".join(outs) + " | All |",
    "|---|" + "---|" * (len(outs) + 1),
]
for s in sevs:
    out.append(f"| {s} | " + " | ".join(str(count(lambda r: r['sev'] == s and r['out'] == o) or "") for o in outs)
               + f" | {count(lambda r: r['sev'] == s)} |")
out.append("| **All** | " + " | ".join(f"**{count(lambda r: r['out'] == o)}**" for o in outs) + f" | **{len(rows)}** |")
out += ["", "*fixed*: on the fix branch, or on its own branch for `main`, with a test that failed before. *owner*: below, not fixed. *covered*: another finding's test already pins it. *moot*, *unreachable*: no test can fail without the guard. *open*: for the second fix round. *merged*: the same as another finding, which carries it.", ""]
out += [owner_md.strip(), ""]

open_rows = [r for r in rows if r["out"] == "open"]
if open_rows:
    out += ["## Still open: the second fix round", ""]
    for r in open_rows:
        out.append(f"- `{r['id']}` {r['sev']}: {r['title']} `{short(r['file'])}:{r['line']}`")
    out.append("")

out += ["## Fixed", "",
        "Each with a test that failed before its fix. The commits are on `web-wallet/whole-review-fixes`; the two highs and the CLI's fixes are also on their own branches for `main` (`web-wallet/lovejoin-box-datum-spelling`, `cli/stranger-rows`).", ""]
for name in ["Core", "The CLI", "Crypto", "The WebAssembly", "The worker", "The screens", "The proofs", "Docs, build and CI"]:
    group = [r for r in rows if r["out"] == "fixed" and r["area"] == name and not r["t1"]]
    group.sort(key=lambda r: (-ORDER.index(r["sev"]), r["id"]))
    t1 = [r for r in rows if r["out"] == "fixed" and r["area"] == name and r["t1"]]
    if not group and not t1:
        continue
    out += [f"### {name}", ""]
    for r in group:
        part = " (in part, as verified)" if r["verdict"] == "partly" else ""
        out.append(f"- `{r['id']}` **{r['sev']}**{part}: {r['title']} `{short(r['file'])}:{r['line']}` · {', '.join(r['commits'])}")
    if t1:
        by = {}
        for r in t1:
            by.setdefault(tuple(r["commits"]), []).append(r["id"])
        for commits, ids in by.items():
            out.append(f"- Guards now pinned by a test (T1): {', '.join(f'`{i}`' for i in sorted(ids, key=lambda s: (s.split('#')[0], int(s.split('#')[1]))))} · {', '.join(commits)}")
    out.append("")

for o, head, words in [
    ("covered", "Pinned by another finding's test", ""),
    ("moot", "Moot: no test can fail without the guard", ""),
    ("unreachable", "Unreachable today", ""),
    ("refuted", "Refuted", ""),
    ("unverified", "Not verified", ""),
]:
    group = [r for r in rows if r["out"] == o]
    if not group:
        continue
    out += [f"## {head}", ""]
    for r in group:
        why = f": {r['note']}" if r["note"] else ""
        out.append(f"- `{r['id']}` {r['found']}→{r['sev']}: {r['title']} `{short(r['file'])}:{r['line']}`{why}")
    out.append("")

merged = [r for r in rows if r["out"] == "merged"]
out += ["## Merged into another finding", "", ", ".join(f"`{r['id']}` → `{dup_of[r['id']]}`" for r in merged), ""]
open(os.path.join(folder, "FINDINGS.md"), "w").write("\n".join(out))
print(len(rows), "findings;", {o: count(lambda r, o=o: r["out"] == o) for o in outs + ["unplaced"]})
