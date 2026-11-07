# Replace PATH(line[, +suffix digits]) in a Lean template with the pseudo line's @path as a Lean list.
import re, sys
pseudo, src, dst = sys.argv[1:4]
lines = open(pseudo).read().split("\n")
def lean(p):
    xs = list(p); out=[]; cur=""
    for i,x in enumerate(xs):
        tok = x + ("," if i < len(xs)-1 else "")
        if len(cur)+len(tok) > 90: out.append(cur); cur=tok
        else: cur += tok
    out.append(cur)
    return "[" + "\n    ".join(out) + "]"
def rep(m):
    n = int(m.group(1)); suf = m.group(2) or ""
    p = re.search(r"@([0-9]+)", lines[n-1]).group(1)
    if suf.startswith("-"):
        k = int(suf[1:]); p = p[:-k]; suf = ""
    return lean(p + suf.lstrip("+"))
s = open(src).read()
s = re.sub(r"PATH\((\d+)(?:,\s*([+-]\d+))?\)", rep, s)
open(dst, "w").write(s)
