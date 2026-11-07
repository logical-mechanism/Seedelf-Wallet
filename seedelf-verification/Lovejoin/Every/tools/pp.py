# print the @path of pseudo lines (by number), relative to a base path, as Lean lists
import sys, re
lines = open(sys.argv[1]).read().split("\n")
base = sys.argv[2]
for a in sys.argv[3:]:
    n = int(a)
    m = re.search(r"@([0-9()]+)", lines[n-1])
    p = m.group(1)
    assert p.startswith(base), (n, p)
    rel = p[len(base):]
    print(n, lines[n-1].strip()[:60], "\n   [" + ",".join(rel) + "]")
