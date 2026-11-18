#!/usr/bin/env python3
"""Save a verification workflow's output file as data/verify-<batch>.json, and print its verdicts.

Usage: save_verify.py WORKFLOW_OUTPUT FOLDER BATCH"""
import json, sys
src, folder, batch = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(src))
res = d.get("result")
if isinstance(res, str):
    res = json.loads(res)
json.dump(res, open(f"{folder}/data/verify-{batch}.json", "w"), indent=1, ensure_ascii=False)
v = lambda x: f"{x['verdict']}/{x['severity']}" if x else "-"
for r in res:
    t, i, tb = r.get("trace"), r.get("impact"), r.get("tiebreak")
    tf = (t or {}).get("test_file", "") if t else ""
    print(f"{r['id']:8} {r['severity']:6} trace={v(t):17} impact={v(i):17} tie={v(tb):17} {tf.split('/')[-1] if tf else ''}")
