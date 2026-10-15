#!/usr/bin/env python3
"""Mainnet Koios's pool_history for three pools, as the web wallet asks for it,
for live_public.rs's pool history test (pool-history.json, beside this).
Read-only. Each pool is asked ten times and the answers merged, since Koios's
servers disagree (see the file's "merged"). Re-record once the test says its
window no longer meets the recording's, about 18 epochs on:

    python3 -I api/tests/fixtures/record-pool-history.py
"""

import pathlib
import json
import re
import sys
import time
import urllib.request

POOLS = [
    "pool1gaztx97t53k47fr7282d70tje8323vvzx8pshgts30t9krw62tm",  # most delegators (35,041 on 2026-10-15)
    "pool1z5uqdk7dzdxaae5633fqfcu2eqzy3a3rgtuvy087fdld7yws0xt",  # OctasPool
    "pool155x3l57d4xu52t93f9r55cqaysej4pc2dl3jkc9d6w5ckyu6u7n",  # about 100 delegators
]
Q = "select=epoch_no,active_stake,block_cnt,deleg_rewards&order=epoch_no.desc&limit=18"
out = []
for pool in POOLS:
    merged = {}
    for _ in range(10):
        req = urllib.request.Request(f"https://api.koios.rest/api/v1/pool_history?_pool_bech32={pool}&{Q}", headers={"accept": "application/json"})
        rows = json.load(urllib.request.urlopen(req, timeout=30))
        for r in rows:
            m = merged.setdefault(r["epoch_no"], {**r, "deleg_rewards": []})
            assert m["active_stake"] == r["active_stake"] and m["block_cnt"] == r["block_cnt"], (pool, r, m)
            if r["deleg_rewards"] is not None and r["deleg_rewards"] not in m["deleg_rewards"]:
                m["deleg_rewards"].append(r["deleg_rewards"])
        time.sleep(1)
    rows = [merged[e] for e in sorted(merged, reverse=True)]
    print(pool[:14], len(rows), "".join(str(len(r["deleg_rewards"])) for r in rows), file=sys.stderr)
    out.append({"pool": pool, "answer": rows})
doc = {
    "recorded": time.strftime("%Y-%m-%d", time.gmtime()),
    "request": f"GET https://api.koios.rest/api/v1/pool_history?_pool_bech32=<pool>&{Q}",
    "merged": "ten answers each, merged: every deleg_rewards a Koios server gave for the epoch (they leave out different epochs, null, and some hold a value cached while db-sync was still inserting the epoch's rewards, low, or before it took back those owed to keys deregistered before payday, high); active_stake and block_cnt agreed in all",
    "mainnet": out,
}
text = json.dumps(doc, indent=2)
text = re.sub(r"\{\s+(\"epoch_no\"[^}]*?)\s+\}", lambda m: "{" + re.sub(r"\s*\n\s*", " ", m.group(1)) + "}", text)
pathlib.Path(__file__).with_name("pool-history.json").write_text(text + "\n")
