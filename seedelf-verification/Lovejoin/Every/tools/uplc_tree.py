"""Parse `aiken uplc decode` output into a tree and print it with Lean `subterm` paths.

Path convention (BoxSearch.subterm): Lam/Delay/Force take any digit (we print 0); Apply 0 is the
function, 1 the argument; Case 0 is the scrutinee, n+1 branch n; Constr n is field n.
Variables are printed as de Bruijn indices (0 = innermost), as Lean's `.Var i`.
"""
import re
import sys

TOK = re.compile(r"\(|\)|\[|\]|[^\s()\[\]]+")


def tokens(text):
    return TOK.findall(text)


class P:
    def __init__(self, toks):
        self.t = toks
        self.i = 0

    def peek(self):
        return self.t[self.i]

    def next(self):
        x = self.t[self.i]
        self.i += 1
        return x

    def expect(self, x):
        y = self.next()
        assert y == x, (x, y, self.i)

    def term(self, scope):
        x = self.next()
        if x == "[":
            parts = []
            while self.peek() != "]":
                parts.append(self.term(scope))
            self.next()
            t = parts[0]
            for a in parts[1:]:
                t = ("app", t, a)
            return t
        if x == "(":
            head = self.next()
            if head == "lam":
                name = self.next()
                body = self.term(scope + [name])
                self.expect(")")
                return ("lam", name, body)
            if head in ("delay", "force"):
                b = self.term(scope)
                self.expect(")")
                return (head, b)
            if head == "builtin":
                n = self.next()
                self.expect(")")
                return ("builtin", n)
            if head == "error":
                self.expect(")")
                return ("error",)
            if head == "con":
                depth = 1
                parts = []
                while True:
                    y = self.next()
                    if y in "([":
                        depth += 1
                    elif y in ")]":
                        depth -= 1
                        if depth == 0:
                            break
                    parts.append(y)
                return ("con", " ".join(parts))
            if head == "constr":
                tag = int(self.next())
                fs = []
                while self.peek() != ")":
                    fs.append(self.term(scope))
                self.next()
                return ("constr", tag, fs)
            if head == "case":
                sc = self.term(scope)
                bs = []
                while self.peek() != ")":
                    bs.append(self.term(scope))
                self.next()
                return ("case", sc, bs)
            if head == "program":
                self.next()
                b = self.term(scope)
                self.expect(")")
                return b
            raise ValueError(head)
        # variable
        return ("var", scope.index(x) if False else len(scope) - 1 - (len(scope) - 1 - scope[::-1].index(x)) , x, len(scope))


def fix_vars(t, scope):
    k = t[0]
    if k == "var":
        name = t[2]
        idx = scope[::-1].index(name)
        return ("var", idx, name)
    if k == "lam":
        return ("lam", t[1], fix_vars(t[2], scope + [t[1]]))
    if k in ("delay", "force"):
        return (k, fix_vars(t[1], scope))
    if k == "app":
        return ("app", fix_vars(t[1], scope), fix_vars(t[2], scope))
    if k == "constr":
        return ("constr", t[1], [fix_vars(f, scope) for f in t[2]])
    if k == "case":
        return ("case", fix_vars(t[1], scope), [fix_vars(b, scope) for b in t[2]])
    return t


def size(t):
    k = t[0]
    if k == "lam":
        return 1 + size(t[2])
    if k in ("delay", "force"):
        return 1 + size(t[1])
    if k == "app":
        return 1 + size(t[1]) + size(t[2])
    if k == "constr":
        return 1 + sum(size(f) for f in t[2])
    if k == "case":
        return 1 + size(t[1]) + sum(size(b) for b in t[2])
    return 1


def short(t, d=3):
    k = t[0]
    if k == "var":
        return f"v{t[1]}"
    if k == "builtin":
        return t[1]
    if k == "con":
        return f"«{t[1][:40]}»"
    if k == "error":
        return "ERROR"
    if d == 0:
        return f"…{size(t)}"
    if k == "lam":
        return f"λ.{short(t[2], d - 1)}"
    if k == "delay":
        return f"delay({short(t[1], d - 1)})"
    if k == "force":
        return f"!{short(t[1], d - 1)}"
    if k == "app":
        # flatten spine
        args = []
        f = t
        while f[0] == "app":
            args.append(f[2])
            f = f[1]
        args.reverse()
        return "[" + " ".join([short(f, d - 1)] + [short(a, d - 1) for a in args]) + "]"
    if k == "constr":
        return f"constr{t[1]}(" + ", ".join(short(f, d - 1) for f in t[2]) + ")"
    if k == "case":
        return f"case {short(t[1], d - 1)} of {len(t[2])}"
    return "?"


def at(t, path):
    for p in path:
        k = t[0]
        if k in ("lam",):
            t = t[2]
        elif k in ("delay", "force"):
            t = t[1]
        elif k == "app":
            t = t[1] if p == 0 else t[2]
        elif k == "case":
            t = t[1] if p == 0 else t[2][p - 1]
        elif k == "constr":
            t = t[2][p]
        else:
            return t
    return t


def children(t):
    k = t[0]
    if k == "lam":
        return [(0, t[2])]
    if k in ("delay", "force"):
        return [(0, t[1])]
    if k == "app":
        return [(0, t[1]), (1, t[2])]
    if k == "case":
        return [(0, t[1])] + [(i + 1, b) for i, b in enumerate(t[2])]
    if k == "constr":
        return list(enumerate(t[2]))
    return []


def outline(t, path, depth, maxdepth, minsize, out, env=0):
    s = size(t)
    tag = {"lam": "lam", "delay": "delay", "force": "force", "app": "app", "case": "case", "constr": "constr"}.get(t[0], t[0])
    out.append(f"{'  ' * depth}{path} {tag} size={s} env={env}  {short(t, 2)}")
    if depth >= maxdepth:
        return
    for i, c in children(t):
        if size(c) >= minsize:
            outline(c, path + [i], depth + 1, maxdepth, minsize, out, env + (1 if t[0] == "lam" else 0))


def load(fn):
    text = open(fn).read()
    p = P(tokens(text))
    t = p.term([])
    return fix_vars(t, [])


if __name__ == "__main__":
    t = load(sys.argv[1])
    cmd = sys.argv[2] if len(sys.argv) > 2 else "outline"
    if cmd == "outline":
        path = eval(sys.argv[3]) if len(sys.argv) > 3 else []
        maxd = int(sys.argv[4]) if len(sys.argv) > 4 else 6
        mins = int(sys.argv[5]) if len(sys.argv) > 5 else 30
        out = []
        outline(at(t, path), path, 0, maxd, mins, out)
        print("\n".join(out))
    elif cmd == "show":
        path = eval(sys.argv[3])
        d = int(sys.argv[4]) if len(sys.argv) > 4 else 6
        print(short(at(t, path), d))


def lams(t):
    """Strip a lambda spine: (n, body, path-suffix)."""
    n = 0
    suf = []
    while t[0] == "lam":
        n += 1
        t = t[2]
        suf.append(0)
    return n, t, suf


def letview(t, path, depth, maxdepth, out, d=2):
    """Print `case (constr 0 fs) [λ… body]` blocks as lets, and app-of-lambda as lets."""
    ind = "  " * depth
    if depth > maxdepth:
        out.append(f"{ind}{path} …{size(t)}")
        return
    k = t[0]
    if k in ("force", "delay"):
        out.append(f"{ind}{path} {k}")
        letview(t[1], path + [0], depth, maxdepth, out, d)
        return
    if k == "case" and t[1][0] == "constr" and len(t[2]) == 1 and t[2][0][0] != "lam":
        fs = t[1][2]
        out.append(f"{ind}{path} CALL {short(t[2][0], d)} with {len(fs)} args")
        for i, f in enumerate(fs):
            out.append(f"{ind}  arg[{i}] size={size(f)} {short(f, d)}   @ {path + [0, i]}")
        big = max(range(len(fs)), key=lambda i: size(fs[i]))
        if size(fs[big]) > 40:
            letview(fs[big], path + [0, big], depth + 1, maxdepth, out, d)
        return
    if k == "case" and t[1][0] == "constr" and len(t[2]) == 1:
        fs = t[1][2]
        n, body, suf = lams(t[2][0])
        out.append(f"{ind}{path} LET{len(fs)} (branch lams={n})")
        for i, f in enumerate(fs):
            out.append(f"{ind}  [{i}] size={size(f)} {short(f, d)}   @ {path + [0, i]}")
        letview(body, path + [1] + suf, depth + 1, maxdepth, out, d)
        return
    if k == "app" and t[1][0] == "lam":
        out.append(f"{ind}{path} LET1 = size={size(t[2])} {short(t[2], d)}   @ {path + [1]}")
        letview(t[1][2], path + [0, 0], depth + 1, maxdepth, out, d)
        return
    out.append(f"{ind}{path} {short(t, d)} size={size(t)}")


if __name__ == "__main__" and len(sys.argv) > 2 and sys.argv[2] == "lets":
    t = load(sys.argv[1])
    path = eval(sys.argv[3]) if len(sys.argv) > 3 else []
    maxd = int(sys.argv[4]) if len(sys.argv) > 4 else 30
    d = int(sys.argv[5]) if len(sys.argv) > 5 else 2
    out = []
    letview(at(t, path), path, 0, maxd, out, d)
    print("\n".join(out))
