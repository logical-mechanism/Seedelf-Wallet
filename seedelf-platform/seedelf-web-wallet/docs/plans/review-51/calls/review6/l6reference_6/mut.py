#!/usr/bin/env python3
"""Apply one named mutation to the scratch copy's build.rs (from the pristine one), or restore it ("none")."""
import os
import sys

R = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(R, "seedelf-platform", "seedelf-core", "src", "build.rs")
PRISTINE = os.path.join(R, "pristine", "build.rs")

M = {
    # (a) Step 1's purpose rank for a payment: a plain box before a mixed one.
    "pay-rank-swap": [(
        "                Mixed => 4,\n                Lovejoin => 5,",
        "                Mixed => 5,\n                Lovejoin => 4,",
    )],
    # (b1) Another session's money no last resort for a funding (build.rs:2552).
    "fund-session-tier-0": [(
        "            (Purpose::Fund { .. }, Origin::Session) if self.rank(class) > 0 => 1,",
        "            (Purpose::Fund { .. }, Origin::Session) if self.rank(class) > 0 => 0,",
    )],
    # (b2) Order c's other money by size whatever its tier (build.rs:3208-3215).
    "c-largest-ignores-tier": [(
        "    largest.sort_by_key(|u| {\n        (\n            last(u),\n            tier(u),\n            !joins_base(u),",
        "    largest.sort_by_key(|u| {\n        (\n            last(u),\n            0u8,\n            !joins_base(u),",
    )],
}


def main():
    name = sys.argv[1]
    with open(PRISTINE) as f:
        s = f.read()
    if name != "none":
        for old, new in M[name]:
            n = s.count(old)
            if n != 1:
                raise SystemExit(f"expected one match, found {n}: {old[:80]!r}")
            s = s.replace(old, new)
    with open(BUILD, "w") as f:
        f.write(s)
    print(f"applied {name}")


main()
