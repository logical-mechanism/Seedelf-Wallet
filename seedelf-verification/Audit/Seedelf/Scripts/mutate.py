"""Writes the three wallet mutants (negative controls for the Lean suite), from the
deployed wallet's decoded UPLC, each one term replaced. Never deploy them."""
import sys
src = open('wallet.compact.uplc').read()

def term_end(s, i):
    """End (exclusive) of the balanced term that starts at s[i] ('(' or '[')."""
    assert s[i] in '(['
    depth = 0
    for j in range(i, len(s)):
        c = s[j]
        if c in '([':
            depth += 1
        elif c in ')]':
            depth -= 1
            if depth == 0:
                return j + 1
    raise ValueError('unbalanced')

def replace_term(s, start, new):
    end = term_end(s, start)
    return s[:start] + new + s[end:], s[start:end]

out = {}
# SM1: list.has(extra_signatories, vkh) -> True, i.e. the `and`'s second operand.
i = src.find('(delay [[(lam i_49')
assert src.count('(delay [[(lam i_49') == 1
m1, old1 = replace_term(src, i, '(delay (con bool True))')
out['wallet_no_signer'] = (m1, old1)
# SM2: schnorr.prove(...) -> True, the `and`'s first operand (the ifThenElse condition).
i = src.find('[(lam i_34 [(lam i_35 ')
assert src.count('[(lam i_34 [(lam i_35 ') == 1
m2, old2 = replace_term(src, i, '(con bool True)')
out['wallet_no_schnorr'] = (m2, old2)
# SM3: the challenge without vkh: blake2b_224(g ++ g_r ++ u).
ch = '[(builtin blake2b_224) [[(builtin appendByteString) [[(builtin appendByteString) [[(builtin appendByteString) i_37] i_40]] i_38]] i_41]]'
assert src.count(ch) == 1
new = '[(builtin blake2b_224) [[(builtin appendByteString) [[(builtin appendByteString) i_37] i_40]] i_38]]'
m3 = src.replace(ch, new)
out['wallet_no_vkh_in_challenge'] = (m3, ch)
for name, (m, old) in out.items():
    open(name + '.uplc', 'w').write(m)
    print(name, 'replaced', len(old), 'chars:', old[:160] + ('...' if len(old) > 160 else ''))
