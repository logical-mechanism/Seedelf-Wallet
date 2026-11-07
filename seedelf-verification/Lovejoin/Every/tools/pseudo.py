"""Pseudo-code view of a decoded UPLC program (uplc_tree's tree), with Lean subterm paths.

Lets (`case (constr 0 es) [λxs. body]`, `[λx. body] e`), if/else (forced ifThenElse of delays),
calls; binders keep aiken's names (i_N = level N). `@...` is the Lean subterm path of the term
that follows it (BoxSearch.subterm convention), digits run together, (n) for n >= 10.
"""
import sys
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from uplc_tree import load, at, size  # noqa: E402

NAMES = {}
SMALL = 14


def nm(x):
    return NAMES.get(x, x)


def spine(t):
    args = []
    while t[0] == "app":
        args.append(t[2])
        t = t[1]
    args.reverse()
    return t, args


def is_ite(f):
    return (f[0] == "force" and f[1] == ("builtin", "ifThenElse")) or (f[0] == "var" and nm(f[2]) == "ifThenElse")


def unforce(t):
    n = 0
    while t[0] == "force":
        t = t[1]
        n += 1
    return n, t


def P(path):
    return "@" + "".join(str(p) if p < 10 else f"({p})" for p in path)


def inline(t, path):
    """A one-line rendering, or None if the term needs a block."""
    k = t[0]
    if k == "var":
        return nm(t[2])
    if k == "builtin":
        return t[1]
    if k == "con":
        return "«" + t[1][:70] + "»"
    if k == "error":
        return "ERROR"
    if size(t) > SMALL:
        return None
    if k == "force":
        n, inner = unforce(t)
        s = inline(inner, path + [0] * n)
        return None if s is None else "!" * n + s
    if k == "delay":
        s = inline(t[1], path + [0])
        return None if s is None else f"delay({s})"
    if k == "lam":
        return None
    if k == "app":
        f, args = spine(t)
        if f[0] == "lam":
            return None
        fs = inline(f, path + [0] * len(args))
        ss = [inline(a, path + [0] * (len(args) - 1 - i) + [1]) for i, a in enumerate(args)]
        if fs is None or any(s is None for s in ss):
            return None
        return fs + "(" + ", ".join(ss) + ")"
    if k == "constr":
        ss = [inline(f, path + [i]) for i, f in enumerate(t[2])]
        if any(s is None for s in ss):
            return None
        return f"C{t[1]}(" + ", ".join(ss) + ")"
    return None


def block(t, path, ind):
    """Lines for t at indentation ind; the last line is its value."""
    pad = "  " * ind
    s = inline(t, path)
    if s is not None:
        return [pad + s]
    k = t[0]
    if k == "case" and t[1][0] == "constr" and len(t[2]) == 1 and t[2][0][0] == "lam":
        fs = t[1][2]
        br = t[2][0]
        p = path + [1]
        lines = []
        names = []
        for _ in fs:
            if br[0] != "lam":
                break
            names.append(br[1])
            br = br[2]
            p.append(0)
        for i, (x, f) in enumerate(zip(names, fs)):
            lines += bind(nm(x), f, path + [0, i], ind)
        if len(names) < len(fs):
            lines.append(pad + f"-- {len(fs) - len(names)} more args applied to a non-lambda")
        return lines + block(br, p, ind)
    if k == "app" and t[1][0] == "lam":
        x = t[1][1]
        return bind(nm(x), t[2], path + [1], ind) + block(t[1][2], path + [0, 0], ind)
    if k == "force":
        n, inner = unforce(t)
        f, args = spine(inner)
        if n == 1 and is_ite(f) and len(args) == 3 and args[1][0] == "delay" and args[2][0] == "delay":
            return ite(args[0], path + [0, 0, 0, 1], args[1][1], path + [0, 0, 1, 0], args[2][1], path + [0, 1, 0], ind)
        if n == 1 and inner[0] == "case" and inner[1][0] == "constr" and len(inner[2]) == 1 and is_ite(inner[2][0]):
            fs = inner[1][2]
            if len(fs) == 3 and fs[1][0] == "delay" and fs[2][0] == "delay":
                return ite(fs[0], path + [0, 0, 0], fs[1][1], path + [0, 0, 1, 0], fs[2][1], path + [0, 0, 2, 0], ind)
        return [pad + "!" * n + " " + P(path + [0] * n)] + block(inner, path + [0] * n, ind + 1)
    if k == "delay":
        return [pad + "delay " + P(path + [0])] + block(t[1], path + [0], ind + 1)
    if k == "lam":
        names = []
        p = list(path)
        while t[0] == "lam":
            names.append(nm(t[1]))
            t = t[2]
            p.append(0)
        return [pad + "λ " + " ".join(names) + " ->  " + P(p)] + block(t, p, ind + 1)
    if k == "app":
        f, args = spine(t)
        fp = path + [0] * len(args)
        fi = inline(f, fp)
        if fi is not None:
            lines = [pad + "CALL " + fi + "  " + P(fp)]
        else:
            lines = [pad + "CALL " + P(fp)] + block(f, fp, ind + 2)
        for i, a in enumerate(args):
            ap = path + [0] * (len(args) - 1 - i) + [1]
            ai = inline(a, ap)
            if ai is not None:
                lines.append(pad + f"  arg{i} = {ai}  " + P(ap))
            else:
                lines.append(pad + f"  arg{i} " + P(ap))
                lines += block(a, ap, ind + 2)
        return lines
    if k == "case":
        sc, bs = t[1], t[2]
        if sc[0] == "constr" and len(bs) == 1:
            fi = inline(bs[0], path + [1])
            lines = [pad + "APPLY " + (fi or "") + " " + P(path + [1])]
            if fi is None:
                lines += block(bs[0], path + [1], ind + 2)
            for i, f in enumerate(sc[2]):
                lines.append(pad + f"  arg{i} " + P(path + [0, i]))
                lines += block(f, path + [0, i], ind + 2)
            return lines
        lines = [pad + "CASE " + P(path + [0])] + block(sc, path + [0], ind + 2)
        for i, b in enumerate(bs):
            lines.append(pad + f"  of {i} " + P(path + [i + 1]))
            lines += block(b, path + [i + 1], ind + 2)
        return lines
    if k == "constr":
        lines = [pad + f"C{t[1]}"]
        for i, f in enumerate(t[2]):
            lines.append(pad + f"  .{i} " + P(path + [i]))
            lines += block(f, path + [i], ind + 2)
        return lines
    return [pad + "?"]


def bind(x, f, path, ind):
    pad = "  " * ind
    s = inline(f, path)
    if s is not None:
        return [pad + f"let {x} = {s}   {P(path)}"]
    return [pad + f"let {x} =   {P(path)}"] + block(f, path, ind + 2)


def ite(c, cp, a, ap, b, bp, ind):
    pad = "  " * ind
    cs = inline(c, cp)
    if cs is not None:
        lines = [pad + f"if {cs}   {P(cp)}"]
    else:
        lines = [pad + f"if   {P(cp)}"] + block(c, cp, ind + 2)
    lines.append(pad + "then " + P(ap))
    lines += block(a, ap, ind + 1)
    lines.append(pad + "else " + P(bp))
    lines += block(b, bp, ind + 1)
    return lines


if __name__ == "__main__":
    t = load(sys.argv[1])
    path = eval(sys.argv[2]) if len(sys.argv) > 2 else []
    if len(sys.argv) > 3 and sys.argv[3]:
        for kv in sys.argv[3].split(","):
            a, b = kv.split("=")
            NAMES[a] = b
    print("\n".join(block(at(t, path), path, 0)))
