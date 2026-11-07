"""Free variables of the subterm at a path: `python3 freevars.py prog.uplc '[path]'`.
Prints each free de Bruijn index (relative to the subterm's own environment) with the
binder name it refers to (aiken's i_N), innermost first."""
import sys
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from uplc_tree import load


def walk_to(t, path):
    """Binder names (outermost first) in scope at path, and the subterm."""
    scope = []
    for p in path:
        k = t[0]
        if k == "lam":
            scope.append(t[1]); t = t[2]
        elif k in ("delay", "force"):
            t = t[1]
        elif k == "app":
            t = t[1] if p == 0 else t[2]
        elif k == "case":
            t = t[1] if p == 0 else t[2][p - 1]
        elif k == "constr":
            t = t[2][p]
        else:
            break
    return scope, t


def free(t, depth, acc):
    k = t[0]
    if k == "var":
        if t[1] >= depth:
            acc.add(t[1] - depth)
    elif k == "lam":
        free(t[2], depth + 1, acc)
    elif k in ("delay", "force"):
        free(t[1], depth, acc)
    elif k == "app":
        free(t[1], depth, acc); free(t[2], depth, acc)
    elif k == "case":
        free(t[1], depth, acc)
        for b in t[2]:
            free(b, depth, acc)
    elif k == "constr":
        for f in t[2]:
            free(f, depth, acc)


if __name__ == "__main__":
    t = load(sys.argv[1])
    path = eval(sys.argv[2])
    scope, sub = walk_to(t, path)
    acc = set()
    free(sub, 0, acc)
    names = {}
    if len(sys.argv) > 3:
        for kv in sys.argv[3].split(","):
            a, b = kv.split("="); names[a] = b
    for i in sorted(acc):
        n = scope[len(scope) - 1 - i]
        print(f"  {i:3d}  {n}  {names.get(n, '')}")
    print(f"scope depth {len(scope)}")


def scope_at(fn, path):
    t = load(fn)
    scope, _ = walk_to(t, path)
    return list(reversed(scope))
