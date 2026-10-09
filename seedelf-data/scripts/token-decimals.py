#!/usr/bin/env python3
"""Tokens' decimals from a checkout of the Cardano token registry, built into
the API (api/data/token-decimals.json, api/src/decimals.rs).

Koios reads the same registry (koios-artifacts' asset-registry-update.sh):
each mapping's subject is the policy (56 hex characters) and the asset name,
and its decimals default to 0. Only tokens whose decimals aren't 0 are kept.

    git clone --depth 1 https://github.com/cardano-foundation/cardano-token-registry.git
    python3 scripts/token-decimals.py cardano-token-registry > api/data/token-decimals.json
"""

import json
import pathlib
import re
import sys

SUBJECT = re.compile(r"^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$")


def decimals(mapping: dict) -> int:
    value = (mapping.get("decimals") or {}).get("value", 0)
    # The registry holds some as numbers and some as strings of digits.
    number = int(value) if isinstance(value, int) or str(value).isdigit() else 0
    return number if 0 <= number <= 255 else 0


def main(registry: str) -> None:
    found = {}
    skipped = 0
    for path in sorted(pathlib.Path(registry, "mappings").glob("*.json")):
        try:
            mapping = json.loads(path.read_text())
            subject = str(mapping["subject"]).lower()
        except (ValueError, KeyError):
            skipped += 1
            continue
        if SUBJECT.match(subject) and decimals(mapping):
            found[subject] = decimals(mapping)
    json.dump(found, sys.stdout, sort_keys=True, separators=(",", ":"))
    print(f"{len(found)} tokens with decimals, {skipped} mappings unreadable", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
