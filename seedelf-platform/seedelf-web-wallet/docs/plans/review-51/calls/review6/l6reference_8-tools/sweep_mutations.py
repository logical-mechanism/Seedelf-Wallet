#!/usr/bin/env python3
"""l6reference#8's check: which default-surviving mutations does the ignored sweep catch? Copy only."""
import os, re, subprocess, sys

COPY = sys.argv[1]
ORIG = sys.argv[2]
OUT = sys.argv[3]
BUILD = os.path.join(COPY, "seedelf-core", "src", "build.rs")
PRISTINE = open(ORIG, encoding="utf-8").read()
TARGET = os.path.join(os.environ["HOME"], ".cache", "seedelf-calls", "r6-target-l6reference_8")
WRAP = ["nice", "-n", "10", "systemd-run", "--user", "--scope", "-q", "-p", "MemoryMax=8G", "-p",
        "MemorySwapMax=0", "timeout", "30m"]

M = {
    "core-raw-weight": [("let (weight, rank) = box_weight(params, &class(u), &[u]);",
                         "let (_weight, rank) = box_weight(params, &class(u), &[u]); let weight = lovelace_in(u);")],
    "known-fail-zero": [("let most = known_fail.map_or(known.len(), |k| k.saturating_sub(1));",
                         "let most = known_fail.map_or(known.len(), |_| 0usize);")],
    "c-no-swap": [("                let at = Known {\n                    at: u,\n                    most: k,\n                    follow: true,\n                };\n                match run(c, u + k, Some(at)) {",
                   "                let at = Known {\n                    at: u,\n                    most: k,\n                    follow: true,\n                };\n                let _ = at;\n                match run(c, u + k, None) {")],
    "c-largest-ignores-tier": [("    largest.sort_by_key(|u| {\n        (\n            last(u),\n            tier(u),\n            !joins_base(u),",
                                "    largest.sort_by_key(|u| {\n        (\n            last(u),\n            0u8,\n            !joins_base(u),")],
    "fund-session-tier-0": [("            (Purpose::Fund { .. }, Origin::Session) if self.rank(class) > 0 => 1,",
                             "            (Purpose::Fund { .. }, Origin::Session) if self.rank(class) > 0 => 0,")],
}

names = sys.argv[4:] or list(M)
env = dict(os.environ, CARGO_TARGET_DIR=TARGET)
for name in names:
    s = PRISTINE
    for old, new in M[name]:
        assert s.count(old) == 1, (name, old[:60])
        s = s.replace(old, new)
    open(BUILD, "w", encoding="utf-8").write(s)
    log = os.path.join(OUT, f"sweep-{name}.log")
    with open(log, "w") as f:
        r = subprocess.run(WRAP + ["cargo", "test", "--release", "--locked", "-p", "seedelf-core", "--test",
                                   "box_rule_reference_test", "--", "--ignored"],
                           cwd=COPY, env=env, stdout=f, stderr=subprocess.STDOUT)
    text = open(log, encoding="utf-8").read()
    result = [l for l in text.splitlines() if l.startswith("test result")]
    seeds = re.findall(r"^seed (\d+): (\w+)", text, re.M)
    print(f"{name}: exit {r.returncode}; {result[-1] if result else 'no result'}; failing: {seeds}", flush=True)
open(BUILD, "w", encoding="utf-8").write(PRISTINE)
print("restored", flush=True)
