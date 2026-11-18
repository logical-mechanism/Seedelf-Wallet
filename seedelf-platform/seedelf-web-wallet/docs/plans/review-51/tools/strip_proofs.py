#!/usr/bin/env python3
"""Keep a Lean file's definitions and theorem statements, drop every proof.

Usage: strip_proofs.py FILE [NAME ...]
With names, keep only the declarations with those names (and their docstrings).
A declaration starts at column 0; a theorem's statement ends at its first ':='."""
import re, sys

DECL = re.compile(r"^(?:@\[[^\]]*\]\s*)?(?:(?:noncomputable|private|protected|partial|unsafe)\s+)*"
                  r"(theorem|lemma|def|abbrev|structure|inductive|instance|class|example|opaque|axiom)\b\s*([^\s:({\[]*)")

def blocks(lines):
    """Split into top-level blocks: (kind, name, lines)."""
    out, cur, doc = [], None, []
    i = 0
    while i < len(lines):
        l = lines[i]
        if l.startswith("/--") or l.startswith("/-!") or l.startswith("/-"):
            j = i
            buf = [l]
            while "-/" not in lines[j][2 if j == i else 0:]:
                j += 1
                buf.append(lines[j])
            if l.startswith("/--"):
                if cur: out.append(cur); cur = None
                doc = buf
            else:
                if cur: out.append(cur); cur = None
                out.append(("comment", "", buf))
            i = j + 1
            continue
        m = DECL.match(l)
        if m:
            if cur: out.append(cur)
            cur = (m.group(1), m.group(2), doc + [l])
            doc = []
        elif l and not l[0].isspace():
            if cur: out.append(cur); cur = None
            out.append(("other", "", doc + [l])); doc = []
        else:
            if cur: cur[2].append(l)
            elif l.strip(): out.append(("other", "", [l]))
        i += 1
    if cur: out.append(cur)
    return out

def statement(kind, ls):
    if kind not in ("theorem", "lemma", "example", "instance"):
        return ls
    text = "\n".join(ls)
    k = text.find(":=")
    if k < 0:
        return ls
    return (text[:k].rstrip() + " := (proof omitted)").split("\n")

def main():
    f, names = sys.argv[1], set(sys.argv[2:])
    lines = open(f).read().split("\n")
    print(f"-- extracted from {f}: definitions in full, theorems as statements only")
    for kind, name, ls in blocks(lines):
        short = name.split(".")[-1]
        if names:
            if kind in ("comment", "other") or (name not in names and short not in names):
                continue
        else:
            if kind == "other" and ls and (ls[0].startswith("#") or ls[0].startswith("set_option") or ls[0].startswith("attribute")):
                continue
        while ls and not ls[-1].strip():
            ls = ls[:-1]
        print("\n".join(statement(kind, ls)))
        print()

main()
