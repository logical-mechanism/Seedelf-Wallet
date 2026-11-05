"""Alpha-normalises textual UPLC (renames each binder v0, v1, ... in binding order),
then reports how a mutant differs from the deployed wallet."""
import re, sys, difflib
def norm(s):
    s = re.sub(r'\s+', ' ', s).strip()
    return s.replace('( ', '(').replace(' )', ')').replace('[ ', '[').replace(' ]', ']')
def alpha(s):
    toks = re.findall(r'\(|\)|\[|\]|[^\s()\[\]]+', s)
    out, stack, n = [], [], 0
    # scope: map name -> list of fresh names; lam binds the next token
    env = {}
    depth_binds = []  # (paren depth at lam, name)
    depth = 0
    i = 0
    pending = []
    while i < len(toks):
        t = toks[i]
        if t in '([':
            depth += 1; out.append(t)
        elif t in ')]':
            # close scopes opened at this depth
            while depth_binds and depth_binds[-1][0] == depth:
                _, name = depth_binds.pop(); env[name].pop()
            depth -= 1; out.append(t)
        elif t == 'lam' and out and out[-1] == '(':
            name = toks[i + 1]
            fresh = 'v%d' % n; n += 1
            env.setdefault(name, []).append(fresh)
            depth_binds.append((depth, name))
            out.append('lam'); out.append(fresh); i += 1
        elif t in env and env[t]:
            out.append(env[t][-1])
        else:
            out.append(t)
        i += 1
    return ' '.join(out)
deployed = alpha(norm(open('wallet.compact.uplc').read()))
for n in ['wallet_no_signer', 'wallet_no_schnorr', 'wallet_no_vkh_in_challenge']:
    a = alpha(norm(open(n + '.uplc').read()))          # the mutant as written by mutate.py
    b = alpha(norm(open(n + '.fromhex.txt').read()))   # the mutant decoded back from its hex
    print(n, '| hex decodes to the written mutant (up to names):', a == b)
    sm = difflib.SequenceMatcher(None, deployed.split(), a.split(), autojunk=False)
    ops = [o for o in sm.get_opcodes() if o[0] != 'equal']
    for o in ops:
        old = ' '.join(deployed.split()[o[1]:o[2]]); new = ' '.join(a.split()[o[3]:o[4]])
        print('   ', o[0], '| deployed:', (old[:110] + '...') if len(old) > 110 else old, '| mutant:', new[:110])
