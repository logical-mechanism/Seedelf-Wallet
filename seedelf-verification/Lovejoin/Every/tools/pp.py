# print the @path of pseudo lines (by number), relative to a base path, as Lean lists
import sys, re
lines = open(sys.argv[1]).read().split("\n")
def steps(s):
    # a step is a digit, or (n) for n >= 10, as pseudo.py prints them (scope.py's P)
    return [x.strip("()") for x in re.findall(r"\(\d+\)|\d", s)]
base = steps(sys.argv[2])
for a in sys.argv[3:]:
    n = int(a)
    m = re.search(r"@([0-9()]+)", lines[n-1])
    p = steps(m.group(1))
    assert p[:len(base)] == base, (n, m.group(1))
    rel = p[len(base):]
    print(n, lines[n-1].strip()[:60], "\n   [" + ",".join(rel) + "]")
