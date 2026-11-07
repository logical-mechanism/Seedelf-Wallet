import sys
def lean(s):
    s = s.lstrip('@')
    xs = [c for c in s]
    out, line = [], []
    for i, c in enumerate(xs):
        line.append(c)
    body = ",".join(xs)
    # wrap at ~95 chars
    parts, cur = [], ""
    for tok in body.split(","):
        if len(cur) + len(tok) + 1 > 92:
            parts.append(cur + ",")
            cur = tok
        else:
            cur = tok if not cur else cur + "," + tok
    parts.append(cur)
    return "[" + "\n   ".join(parts) + "]"
if __name__ == "__main__":
    print(lean(sys.argv[1]))
