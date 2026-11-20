import re, glob, sys, collections
D = sys.argv[1]
pat = re.compile(r"kinds\s+(\d+) \(tokens (yes|no )\) token boxes (\d+) boxes (\d+) received (\d+): (\w+)\s+(\d+): ([^;]+); min ([\d.]+) ms, median ([\d.]+) ms; leasts (\d+)")
data = collections.defaultdict(lambda: collections.defaultdict(list))
leasts = collections.defaultdict(dict)
picks = collections.defaultdict(dict)
for f in glob.glob(D + "/logs/rep*-*.log"):
    v = re.search(r"rep\d+-(.+)\.log", f).group(1)
    for line in open(f):
        m = pat.search(line)
        if not m:
            continue
        key = (int(m[1]), m[2].strip(), m[6], int(m[7]))
        data[key][v].append(float(m[9]))
        leasts[key][v] = int(m[11])
        picks[key][v] = m[8]
vs = ["r7", "head", "addsonce", "oncelock", "both", "r7-oncelock"]
print("min over reps of each rep's min, ms (leasts per selection)")
print("%-34s" % "case" + "".join("%20s" % v for v in vs) + "   head/r7")
for key in sorted(data):
    row = "%-34s" % ("%d kinds %s %s %d" % key)
    mins = {}
    for v in vs:
        if data[key][v]:
            mins[v] = min(data[key][v])
            row += "%20s" % ("%.1f (%d)" % (mins[v], leasts[key][v]))
        else:
            row += "%20s" % "-"
    if "r7" in mins and "head" in mins:
        row += "   %.2f" % (mins["head"] / mins["r7"])
    print(row)
diff = [(k, picks[k]) for k in picks if len(set(picks[k].values())) > 1]
print("picks differ between versions:", diff if diff else "none")
print("reps per version:", {v: max(len(data[k][v]) for k in data) for v in vs})
