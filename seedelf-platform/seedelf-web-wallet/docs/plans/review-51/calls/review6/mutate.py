#!/usr/bin/env python3
"""Mutation runs for the round-six box-rule tests, in the scratch copy only.

Usage: mutate.py NAME [NAME ...]   (or "all"). Each mutation is applied to the pristine files, the core tests (and the
web wallet's lib tests where asked) are rebuilt and run, and the files are restored.
"""
import json
import os
import re
import subprocess
import sys

R = os.path.dirname(os.path.abspath(__file__))
TREE = os.path.join(R, "ref", "seedelf-platform")
BUILD = os.path.join(TREE, "seedelf-core", "src", "build.rs")
LIB = os.path.join(TREE, "seedelf-web-wallet", "wasm", "src", "lib.rs")
PRISTINE = {BUILD: os.path.join(R, "pristine", "build.rs"), LIB: os.path.join(R, "pristine", "lib.rs")}
TARGET = os.path.join(os.environ["HOME"], ".cache", "seedelf-calls", "r6-target-ref")
WRAP = ["nice", "-n", "10", "systemd-run", "--user", "--scope", "-q", "-p", "MemoryMax=8G", "-p",
        "MemorySwapMax=0", "timeout", "30m"]

M = {}

M["token-boxes-not-boxes"] = ([(BUILD,
    "let is_box = |u: &UtxoResponse| tier(u) == 2 && !last(u);",
    "let is_box = |u: &UtxoResponse| tier(u) == 2 && !last(u) && !holds_tokens(u);")], False)

M["core-raw-weight"] = ([(BUILD,
    "let (weight, rank) = box_weight(params, &class(u), &[u]);",
    "let (_weight, rank) = box_weight(params, &class(u), &[u]); let weight = lovelace_in(u);")], False)

M["box-weight-raw"] = ([(BUILD,
    "        .map(|u| adds(params, u).map_or(0, |a| u128::try_from(a.max(0)).unwrap_or(0)))\n        .sum();\n    (weight, box_rank(class))",
    "        .map(|u| u128::from(lovelace_of(u)))\n        .sum();\n    (weight, box_rank(class))")], True)

M["no-same-count"] = ([(BUILD,
    "    more_mixed(weights, order, j)\n        .into_iter()\n        .find_map(|chosen| {",
    "    more_mixed(weights, order, j)\n        .into_iter()\n        .take(0)\n        .find_map(|chosen| {")], False)

M["uncapped-tail"] = ([(BUILD,
    "let tail: &[&UtxoResponse] = if follow { after } else { &[] };",
    "let _ = after; let tail: &[&UtxoResponse] = if follow { &order[at + most..] } else { &[] };")], False)

M["c-no-swap"] = ([(BUILD,
    "                let at = Known {\n                    at: u,\n                    most: k,\n                    follow: true,\n                };\n                match run(c, u + k, None) {",
    "XX")], False)  # placeholder, replaced below

M["no-step1-box-rank"] = ([(BUILD,
    "        (last(u), purpose.rank(&c), made)\n",
    "        (last(u), purpose.rank(&c), made * 0)\n")], False)

M["mint-own-order-dropped"] = ([(BUILD,
    "let made = if matches!(purpose, Purpose::Mint) || purpose.tier(&c) < 2 {",
    "let made = if purpose.tier(&c) < 2 {")], False)

M["shared-token-cap"] = ([(BUILD,
    """        let tries = &mut token_tries[usize::from(is_box(u))];
        if !ada_only && *tries == MAX_TOKEN_SINGLES {
            continue;
        }
        match try_with(&[u]) {
            Tried::Built(built) => return Some(built),
            Tried::Skipped => {}
            tried => {
                if !ada_only {
                    *tries += 1;
                } else if matches!(tried, Tried::Short) {
                    short_at = short_at.max(Some(lovelace_of(u)));
                }
            }
        }""",
    """        let _ = &is_box;
        let tries = &mut token_tries[0];
        if !ada_only {
            if *tries == MAX_TOKEN_SINGLES {
                continue;
            }
            *tries += 1;
        }
        match try_with(&[u]) {
            Tried::Built(built) => return Some(built),
            Tried::Short if ada_only => short_at = short_at.max(Some(lovelace_of(u))),
            _ => {}
        }""")], False)

M["unknown-as-known"] = ([(BUILD,
    "let mut order: Vec<usize> = (0..boxes.len()).filter(|&i| boxes[i].1 < 2).collect();",
    "let mut order: Vec<usize> = (0..boxes.len()).collect();"),
    (BUILD,
    "let mut order: Vec<usize> = (0..boxes.len()).filter(|&i| boxes[i].1 == 2).collect();",
    "let mut order: Vec<usize> = (0..boxes.len()).filter(|_| false).collect();")], True)

M["too-many-off-by-one"] = ([(BUILD,
    "if too_many_at.is_some_and(|at| extra.len() >= at) {",
    "if too_many_at.is_some_and(|at| extra.len() + 1 >= at) {")], False)

M["unknown-first-u-loop"] = ([(BUILD,
    "    for u in 0..=unknown.len() {\n        let besides = &unknown_boxes[..u];",
    "    for u in (0..=unknown.len()).rev() {\n        let besides = &unknown_boxes[..u];")], False)

M["wasm-ada-alone"] = ([(LIB,
    "                .filter(|&i| tier(&classes[i].1) == 2)\n                .collect();",
    "                .filter(|&i| tier(&classes[i].1) == 2 && !classes[i].1.iter().any(|u| u.asset_list.as_ref().is_some_and(|a| !a.is_empty())))\n                .collect();")], True)

M["wasm-raw-weight"] = ([(LIB,
    "                    build::box_weight(&chain.params, c, rows)\n",
    "                    (rows.iter().map(|u| u.value.parse::<u128>().unwrap_or(0)).sum::<u128>(), build::box_rank(c))\n")], True)

M["merge-u-ignores-known"] = ([(BUILD,
    "let Some(u) = (0..=unknown.len()).find(|&u| all_known + unknown_held[u] > gap) else {",
    "let Some(u) = (0..=unknown.len()).find(|&u| unknown_held[u] > gap || u == unknown.len()) else {")], True)

# c's swap off: the same-count choice only in a and b.
M["c-no-swap"] = ([(BUILD,
    "                let at = Known {\n                    at: u,\n                    most: k,\n                    follow: true,\n                };\n                match run(c, u + k, Some(at)) {",
    "                let at = Known {\n                    at: u,\n                    most: k,\n                    follow: true,\n                };\n                let _ = at;\n                match run(c, u + k, None) {")], False)


M["known-fail-zero"] = ([(BUILD,
    "let most = known_fail.map_or(known.len(), |k| k.saturating_sub(1));",
    "let most = known_fail.map_or(known.len(), |_| 0usize);")], False)


# Round five's order (l5merge#2 reverted): a box of unknown making only after every box whose making is known.
M["unknown-after-all-known"] = ([(BUILD,
    "        if !ahead_fail && !unpaid(ahead_held + unknown_held[u] + known_held[known.len()]) {",
    "        if u == 0 && !ahead_fail && !unpaid(ahead_held + unknown_held[u] + known_held[known.len()]) {"),
    (BUILD,
    "        for k in 0..=most.min(known.len()) {",
    "        for k in (if u > 0 { known.len() } else { 0 })..=most.min(known.len()) {")], False)


# Tiers, which the reference's plain-build baseline shares with the pick: c's other money by size, whatever its tier.
M["c-largest-ignores-tier"] = ([(BUILD,
    "    largest.sort_by_key(|u| {\n        (\n            last(u),\n            tier(u),\n            !joins_base(u),",
    "    largest.sort_by_key(|u| {\n        (\n            last(u),\n            0u8,\n            !joins_base(u),")], False)

# Another session's money no last resort for a funding.
M["fund-session-tier-0"] = ([(BUILD,
    "            (Purpose::Fund { .. }, Origin::Session) if self.rank(class) > 0 => 1,",
    "            (Purpose::Fund { .. }, Origin::Session) if self.rank(class) > 0 => 0,")], False)


# Step 1's purpose rank for a payment: a plain box before a mixed one (the reference reads `rank_of` itself).
M["pay-rank-swap"] = ([(BUILD,
    "                Mixed => 4,\n                Lovejoin => 5,",
    "                Mixed => 5,\n                Lovejoin => 4,")], False)


# The parts' same-count choice off (boxes_to_merge only).
M["parts-no-swap"] = ([(BUILD,
    "    let first = more_mixed(boxes, &known, k)\n        .into_iter()\n        .find(",
    "    let first = more_mixed(boxes, &known, k)\n        .into_iter()\n        .take(0)\n        .find(")], True)


def restore():
    for live, saved in PRISTINE.items():
        with open(saved) as f, open(live, "w") as g:
            g.write(f.read())


def apply(edits):
    for path, old, new in edits:
        with open(path) as f:
            s = f.read()
        n = s.count(old)
        if n != 1:
            raise SystemExit(f"{path}: expected one match, found {n} for {old[:80]!r}")
        with open(path, "w") as f:
            f.write(s.replace(old, new))


def cargo(args):
    env = dict(os.environ, CARGO_TARGET_DIR=TARGET)
    p = subprocess.run(WRAP + ["cargo"] + args, cwd=TREE, env=env, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def binaries(out):
    found = {}
    for m in re.finditer(r"Executable (?:tests/(\S+)\.rs|unittests src/lib\.rs) \(([^)]+)\)", out):
        found[m.group(1) or "lib"] = m.group(2)
    return found


def run(binary, filt=None):
    args = WRAP + [binary] + ([filt] if filt else []) + ["--test-threads=4"]
    p = subprocess.run(args, cwd=TREE, capture_output=True, text=True)
    out = p.stdout + p.stderr
    failed = sorted(set(re.findall(r"^test (\S+) \.\.\. FAILED", out, re.M)))
    summary = re.findall(r"^test result: .*$", out, re.M)
    return failed, summary, out


def one(name):
    edits, wasm = M[name]
    restore()
    apply(edits)
    try:
        code, out = cargo(["test", "--locked", "-j", "6", "-p", "seedelf-core", "--test", "box_rule_reference_test",
                           "--test", "mint_test", "--no-run"])
        if code != 0:
            return {"mutation": name, "build": "failed", "log": out[-3000:]}
        bins = binaries(out)
        result = {"mutation": name}
        for t in ["box_rule_reference_test", "mint_test"]:
            failed, summary, full = run(bins[t])
            result[t] = {"failed": failed, "summary": summary}
            with open(os.path.join(R, "runs", f"{name}.{t}.log"), "w") as f:
                f.write(full)
        if wasm:
            code, out = cargo(["test", "--locked", "-j", "6", "-p", "seedelf-wasm", "--lib", "--no-run"])
            if code != 0:
                result["wasm"] = {"build": "failed", "log": out[-3000:]}
            else:
                failed, summary, full = run(binaries(out)["lib"], "box_order_tests")
                result["wasm"] = {"failed": failed, "summary": summary}
                with open(os.path.join(R, "runs", f"{name}.wasm.log"), "w") as f:
                    f.write(full)
        return result
    finally:
        restore()


def probe(name):
    restore()
    if name != "none":
        apply(M[name][0])
    try:
        code, out = cargo(["test", "--locked", "-j", "6", "-p", "seedelf-core", "--test", "r6_probe_scenarios",
                           "--no-run"])
        if code != 0:
            return f"{name}: build failed\n{out[-3000:]}"
        binary = binaries(out)["r6_probe_scenarios"]
        p = subprocess.run(WRAP + [binary, "--nocapture", "--test-threads=1"], cwd=TREE, capture_output=True,
                           text=True)
        lines = [l for l in (p.stdout + p.stderr).splitlines() if "PROBE" in l or "panicked" in l]
        return f"== {name}\n" + "\n".join(lines)
    finally:
        restore()


def suite(name):
    """The whole seedelf-core test suite and the web wallet's lib tests, under one mutation (or none)."""
    restore()
    if name != "none":
        apply(M[name][0])
    try:
        result = {"mutation": name}
        code, out = cargo(["test", "--locked", "-j", "6", "-p", "seedelf-core", "--no-run"])
        if code != 0:
            return {"mutation": name, "build": "failed", "log": out[-3000:]}
        bins = binaries(out)
        code, out2 = cargo(["test", "--locked", "-j", "6", "-p", "seedelf-wasm", "--lib", "--no-run"])
        if code != 0:
            return {"mutation": name, "wasm build": "failed", "log": out2[-3000:]}
        bins.update(binaries(out2))
        for t, b in sorted(bins.items()):
            if t in ("box_rule_coverage_probe", "box_rule_other_session_probe", "r6_probe_scenarios"):
                continue
            failed, summary, full = run(b)
            if failed or not summary or "ok." not in summary[-1]:
                result[t] = {"failed": failed, "summary": summary[-1:] if summary else full[-800:]}
        return result
    finally:
        restore()


if __name__ == "__main__":
    if sys.argv[1] == "--suite":
        for name in sys.argv[2:]:
            print(json.dumps(suite(name)), flush=True)
        sys.exit(0)
    if sys.argv[1] == "--probe":
        for name in sys.argv[2:]:
            print(probe(name), flush=True)
        sys.exit(0)
    names = list(M) if sys.argv[1:] == ["all"] else sys.argv[1:]
    for name in names:
        r = one(name)
        print(json.dumps(r, indent=1), flush=True)
