"""Summarise run-diag.sh's outputs and replay each dumped SMT query through z3.

For every theorem it reports:
  verdict   OPT-ONLY (the optimizer reduced the goal to True; Z3 never saw it) or Z3 (a query
            was built) or FAILED (no verdict: see the .txt)
  inventory constructs whose encoding at our Blaster pin is known to be unsound or delicate:
              lam   lambda definitions (`@lambda…_def_cstr`, `@global_lambda…_def_cstr`): their
                    quantifiers carry no domain guard while extensionality does (Lean-blaster #194)
              rec   recursive functions (`…_LRec` bridges): their defining equation is asserted
                    for every carrier value, unguarded; a parameter of sort Nat is listed, since a
                    negative argument is off-domain there
              ext   function-sort extensionality axioms (`…_ext_fun`)
              coe   coercion functions (`@coerce…`)
              sorts uninterpreted sorts (`declare-sort`), i.e. abstract/polymorphic encodings
  replays   z3 on the files written beside the .txt:
              .full.smt2  the query as Blaster sends it          expect unsat (the ✅ replays)
              .bg.smt2    the same without the negated goal      expect sat; unsat = the
                                                                 background alone is
                                                                 contradictory: a VACUOUS ✅
              .prem.smt2  background + the goal's premises only  expect sat; unsat =
                                                                 contradictory premises
              .premc.smt2 .prem with the boxes in collapsed      written when .prem isn't sat:
                          onto box 1 (a_i, b_i to a1, b1; t0ij, t1ij, cij, zij to t01j, t11j,
                          c1j, z1j, by the theorem's binder names). Equalities only shrink the
                          models, so sat here makes .prem sat too. Four passes theorems' .prem
                          (D050, D116, D187, D221) timed out at 1800 s; their .premc came back
                          sat in seconds in a test run (2026-11-04).
              .alt.smt2   the full query without recfun-finder and the 5.x-only options, for
                          --alt Z3 (default /home/logic/tools/z3-4.15.2-x64-glibc-2.39/bin/z3):
                          a second solver build; sat there on a query 5.3.1 calls unsat = LOOK
  flags     LOOK for any of the above. INCONCLUSIVE when a replay neither confirms nor refutes:
            full or alt not unsat, bg not sat, or neither prem nor premc sat (a timeout, an
            unknown); also a Z3 verdict whose query can't be read, a goal premises() can't
            read (prem=shape?), and a --list theorem with no dump. Neither counts as clean.
            Without z3 on PATH (or the --alt one) the scan stops, unless --no-z3 is given.
Usage: python3 -I scan-diag.py <out dir> [--list FILE] [--no-z3] [--timeout SECONDS] [--alt [Z3 PATH]]
  --list    only the theorems a run-diag.sh list names (one diag/lean path per line)
"""
import os, re, subprocess, sys, shutil

def tokenize(s):
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c in ' \t\r\n':
            i += 1
        elif c == '(' or c == ')':
            yield c; i += 1
        elif c == '"':
            j = i + 1
            while True:
                k = s.index('"', j)
                if k + 1 < n and s[k + 1] == '"':
                    j = k + 2; continue
                break
            yield s[i:k + 1]; i = k + 1
        elif c == '|':
            k = s.index('|', i + 1)
            yield s[i:k + 1]; i = k + 1
        elif c == ';':
            k = s.find('\n', i); i = n if k < 0 else k
        else:
            j = i
            while j < n and s[j] not in ' \t\r\n()"|;':
                j += 1
            yield s[i:j]; i = j

def parse(s):
    stack, out = [[]], None
    for t in tokenize(s):
        if t == '(':
            stack.append([])
        elif t == ')':
            x = stack.pop(); stack[-1].append(x)
        else:
            stack[-1].append(t)
    if len(stack) != 1:
        raise ValueError('unbalanced parentheses in dump')
    return stack[0]

def show(x):
    # iterative: the CEK runs' ite trees nest far deeper than Python's recursion limit
    out, stack = [], [x]
    while stack:
        y = stack.pop()
        if isinstance(y, list):
            stack.append(')')
            for z in reversed(y):
                stack.append(z); stack.append(' ')
            if y: stack.pop()
            out.append('(')
        else:
            out.append(y)
    return ''.join(out)

def walk(x):
    stack = [x]
    while stack:
        y = stack.pop()
        yield y
        if isinstance(y, list):
            stack.extend(reversed(y))

def extract_dump(text):
    lines = text.split('\n')
    try:
        k = next(i for i, l in enumerate(lines) if l.strip() == 'Smt Query:')
    except StopIteration:
        return None
    body = []
    for l in lines[k + 1:]:
        if re.match(r'^\S+\.lean:\d+:\d+: ', l) or re.match(r'^rc=\d+$', l):
            break
        body.append(l)
    return '\n'.join(body)

def verdict(text):
    if re.search(r'✅ Valid', text): return 'OPT-ONLY'
    if re.search(r'Undetermined', text) and 'Smt Query:' in text: return 'Z3'
    return 'FAILED'

def premises(neg):
    # neg = ['assert', ['not', phi]]; peel phi = (=> A (=> B ... C)) into [A, B, ...]
    if not (isinstance(neg, list) and len(neg) == 2 and neg[0] == 'assert'): return None
    phi = neg[1]
    if not (isinstance(phi, list) and len(phi) == 2 and phi[0] == 'not'): return None
    phi, prem = phi[1], []
    while isinstance(phi, list) and len(phi) == 3 and phi[0] == '=>':
        prem.append(phi[1]); phi = phi[2]
    return prem

def inventory(cmds):
    inv = {'lam': 0, 'rec': [], 'ext': 0, 'coe': 0, 'sorts': 0}
    for c in cmds:
        if not isinstance(c, list) or not c: continue
        head = c[0]
        if head == 'declare-sort': inv['sorts'] += 1
        if head == 'declare-fun' and len(c) > 1 and isinstance(c[1], str) and c[1].startswith('@coerce'):
            inv['coe'] += 1
        if head in ('define-fun', 'define-fun-rec') and len(c) > 3 and isinstance(c[1], str) \
                and c[1].strip('|').endswith('_LRec'):
            sorts = [show(p[1]) for p in c[2] if isinstance(p, list) and len(p) == 2]
            inv['rec'].append((c[1], sorts))
        if head == 'assert':
            for x in walk(c):
                if isinstance(x, list) and len(x) >= 2 and x[0] == ':qid':
                    pass
                if isinstance(x, str) and x.endswith('_def_cstr') and 'lambda' in x:
                    inv['lam'] += 1
                if isinstance(x, str) and x.endswith('_ext_fun'):
                    inv['ext'] += 1
    return inv

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
COLLAPSE = [(r'^([ab])(\d)$', r'\g<1>1'), (r'^(t0|t1|c|z)(\d)(\d)$', r'\g<1>1\3')]

def binders(thm):
    # the ∀ binders of the theorem diag/lean/<thm>.lean names, in order. They're the dump's $0,
    # $1, … only when the counts match (Blaster drops some), which collapse_eqs checks.
    try:
        dtext = open(os.path.join(HERE, 'lean', thm + '.lean'), encoding='utf-8').read()
    except OSError:
        return None
    m = re.search(r'^-- (\S+?)(?: line \d+)?:', dtext, re.M)
    n = re.search(r'\[([\w.]+)\]\s*$', dtext, re.M)
    if not (m and n): return None
    try:
        src = open(os.path.join(ROOT, *m.group(1).split('.')) + '.lean', encoding='utf-8').read()
    except OSError:
        return None
    k = src.find(f'theorem {n.group(1).split(".")[-1]} :')
    if k < 0: return None
    rest = src[k:].split(':', 1)[1].lstrip()
    if not rest.startswith('∀'): return None
    names = []
    for grp in re.findall(r'\(([^():]+):[^()]*\)', rest[1:].split(',', 1)[0]):
        names += grp.split()
    return names

def collapse_eqs(names, cmds):
    # box in i's fields equal box 1's; none unless the binders match the dump's constants
    consts = [c[1] for c in cmds if isinstance(c, list) and c[:1] == ['declare-const']
              and isinstance(c[1], str) and c[1].startswith('$')]
    if not names or len(names) != len(consts): return []
    idx = {nm: k for k, nm in enumerate(names)}
    eqs = []
    for k, nm in enumerate(names):
        for pat, rep in COLLAPSE:
            to = re.sub(pat, rep, nm) if re.match(pat, nm) else nm
            if to != nm and to in idx:
                eqs.append(f'(assert (= ${k} ${idx[to]}))')
    return eqs

def z3run(path, timeout, exe='z3'):
    try:
        r = subprocess.run([exe, f'-T:{timeout}', path], capture_output=True, text=True,
                           timeout=timeout + 30)
        lines = [l for l in r.stdout.split('\n') if l.strip() and l.strip() != 'success']
        return lines[-1].strip() if lines else f'(no output, rc={r.returncode})'
    except subprocess.TimeoutExpired:
        return 'timeout'
    except OSError:
        return 'missing'

def main():
    args = sys.argv[1:]
    outdir = args[0]
    use_z3 = '--no-z3' not in args
    if use_z3 and shutil.which('z3') is None:
        sys.exit('scan-diag.py: no z3 on PATH; pass --no-z3 to parse without replaying')
    timeout = int(args[args.index('--timeout') + 1]) if '--timeout' in args else 600
    only = None
    if '--list' in args:
        only = {os.path.basename(l.strip())[:-len('.lean')]
                for l in open(args[args.index('--list') + 1]) if l.strip().endswith('.lean')}
    alt = None
    if '--alt' in args:
        k = args.index('--alt')
        alt = args[k + 1] if k + 1 < len(args) and not args[k + 1].startswith('--') \
              else '/home/logic/tools/z3-4.15.2-x64-glibc-2.39/bin/z3'
        if use_z3 and not os.access(alt, os.X_OK):
            sys.exit(f'scan-diag.py: no --alt z3 at {alt}')
    rows, seen = [], set()
    for f in sorted(os.listdir(outdir)):
        if not f.endswith('.txt'): continue
        if only is not None and f[:-4] not in only: continue
        seen.add(f[:-4])
        p = os.path.join(outdir, f)
        text = open(p, encoding='utf-8', errors='replace').read()
        v = verdict(text)
        row = {'thm': f[:-4], 'verdict': v}
        dump = extract_dump(text) if v == 'Z3' else None
        if dump is not None:
            cmds = [c for c in parse(dump) if not (isinstance(c, list) and c[:2] == ['set-option', ':print-success'])]
            row['inv'] = inventory(cmds)
            last = max(i for i, c in enumerate(cmds) if isinstance(c, list) and c and c[0] == 'assert')
            base = p[:-4]
            full = '\n'.join(show(c) for c in cmds) + '\n(check-sat)\n'
            bg = '\n'.join(show(c) for i, c in enumerate(cmds) if i != last) + '\n(check-sat)\n'
            open(base + '.full.smt2', 'w').write(full)
            open(base + '.bg.smt2', 'w').write(bg)
            prem = premises(cmds[last])
            if prem:
                pr = '\n'.join(show(c) for i, c in enumerate(cmds) if i != last)
                pr += '\n' + '\n'.join(f'(assert {show(a)})' for a in prem) + '\n(check-sat)\n'
                open(base + '.prem.smt2', 'w').write(pr)
            if alt:
                # drop what 4.15.2 lacks: the recfun-finder simplifier and the 5.x-only options
                keep = [c for c in cmds if not (isinstance(c, list) and c and (c[0] == 'set-simplifier'
                        or (c[0] == 'set-option' and len(c) > 1 and isinstance(c[1], str)
                            and (c[1] == ':smt.qi.persist_instances' or c[1].startswith(':smt.arith.nl.grobner')
                                 or c[1] == ':smt.arith.nl.reduce_pseudo_linear'))))]
                open(base + '.alt.smt2', 'w').write('\n'.join(show(c) for c in keep) + '\n(check-sat)\n')
                if use_z3:
                    row['alt'] = z3run(base + '.alt.smt2', timeout, alt)
            if use_z3:
                row['full'] = z3run(base + '.full.smt2', timeout)
                row['bg'] = z3run(base + '.bg.smt2', timeout)
                # '-': a goal with no premises; 'shape?': one premises() can't read
                row['prem'] = z3run(base + '.prem.smt2', timeout) if prem else ('-' if prem == [] else 'shape?')
                if prem and row['prem'] != 'sat':
                    eqs = collapse_eqs(binders(f[:-4]), cmds)
                    if eqs:
                        open(base + '.premc.smt2', 'w').write(
                            pr[:-len('(check-sat)\n')] + '\n'.join(eqs) + '\n(check-sat)\n')
                        row['premc'] = z3run(base + '.premc.smt2', timeout)
        rows.append(row)
    flags = incon = 0
    for r in rows:
        line = f"{r['verdict']:8} {r['thm']}"
        if 'inv' in r:
            i = r['inv']
            nat = [n for n, s in i['rec'] if any(re.search(r'\bNat\b', x) for x in s)]
            line += f"  lam={i['lam']} rec={len(i['rec'])} recNat={len(nat)} ext={i['ext']} coe={i['coe']} sorts={i['sorts']}"
            if 'full' in r:
                line += f"  full={r['full']} bg={r['bg']} prem={r['prem']}"
            if 'premc' in r:
                line += f" premc={r['premc']}"
            if 'alt' in r:
                line += f" alt={r['alt']}"
            bad = (i['lam'] > 0 or nat or r.get('full') == 'sat' or r.get('bg') == 'unsat'
                   or r.get('prem') == 'unsat' or r.get('alt') == 'sat')
            unsettled = (r.get('full', 'unsat') != 'unsat' or r.get('bg', 'sat') != 'sat'
                         or (r.get('prem', 'sat') not in ('sat', '-') and r.get('premc') != 'sat')
                         or r.get('alt', 'unsat') != 'unsat')
            if bad:
                flags += 1; line += '  <-- LOOK'
                for n, s in i['rec']:
                    if n in nat: line += f"\n           rec over Nat: {n} {s}"
            elif unsettled:
                incon += 1; line += '  <-- INCONCLUSIVE'
        elif r['verdict'] == 'Z3':
            incon += 1; line += '  no query in the dump  <-- INCONCLUSIVE'
        print(line)
    for m in sorted(only - seen) if only is not None else []:
        incon += 1; print(f"MISSING  {m}  listed, but no dump  <-- INCONCLUSIVE")
    print(f"\n{len(rows)} theorems; {sum(r['verdict']=='OPT-ONLY' for r in rows)} closed by the optimizer alone; "
          f"{sum(r['verdict']=='Z3' for r in rows)} needed Z3; {sum(r['verdict']=='FAILED' for r in rows)} failed; "
          f"{flags} flagged; {incon} inconclusive" + ('' if use_z3 else '; no replays run (--no-z3)'))

main()
