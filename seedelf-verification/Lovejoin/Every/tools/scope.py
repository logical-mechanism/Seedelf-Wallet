import sys, re
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from freevars import scope_at, walk_to, free
from uplc_tree import load
def P(s): return [int(x.strip('()')) for x in re.findall(r'\(\d+\)|\d', s.lstrip('@'))]
t = load(sys.argv[1])
sys.argv = sys.argv[1:]
for s in sys.argv[1:]:
    p = P(s)
    scope, sub = walk_to(t, p)
    sc = list(reversed(scope))
    acc = set(); free(sub, 0, acc)
    print("path", p)
    print("  scope", len(sc), " ".join(f"{i}:{n}" for i, n in enumerate(sc[:20])), "...")
    print("  free ", " ".join(f"{i}:{sc[i]}" for i in sorted(acc)))
