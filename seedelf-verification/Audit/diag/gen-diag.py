"""Write one tiny Lean file per blaster-proved theorem. Each re-runs Blaster on the theorem's
statement with `(only-smt-lib: 1) (dump-smt-lib: 1)`: no Z3 is started, the optimizer's verdict is
logged ("✅ Valid" = closed by the optimizer alone, "⚠️ Undetermined" = it needed Z3) and the SMT
query Blaster would send is printed. Nothing in the repository is touched."""
import json, os, sys
D = os.path.dirname(os.path.abspath(__file__))
SV = os.path.dirname(os.path.dirname(D))  # run-diag.sh reads the lists from here
thms = json.load(open(os.path.join(D, '..', 'thms.json')))
thms = [t for t in thms if t['tactic'].startswith('blaster')]
os.makedirs(os.path.join(D, 'lean'), exist_ok=True)
quick_names = {
  'Seedelf.V1.wallet_register_spend_iff', 'Seedelf.V1.always_false_always_fails',
  'Seedelf.V1.other_amounts_fail', 'Lovejoin.Classic.owner_withdraws_iff_proof',
  'Lovejoin.V2.mix_passes_with_both_proofs', 'Lovejoin.V2.mix_needs_the_first_challenge',
  'Lovejoin.V2.mix_refuses_a_challenge_not_32_bytes', 'Lovejoin.V2.owner_withdraws_iff_proof',
  'Lovejoin.V2.mix_pays_its_boxes_to_mix_box',
}
lists = {'quick': [], 'modules': [], 'all': []}
seen_mod = set()
for i, t in enumerate(thms):
    base = f"D{i:03d}_{t['name'].split('.')[-1]}"[:80]
    path = os.path.join(D, 'lean', base + '.lean')
    with open(path, 'w') as f:
        f.write(f"import {t['module']}\nimport Blaster\n\n"
                f"-- {t['module']} line {t['line']}: {t['tactic']}\n"
                f"#blaster (only-smt-lib: 1) (dump-smt-lib: 1) [{t['name']}]\n")
    rel = os.path.relpath(path, SV)
    lists['all'].append(rel)
    if t['module'] not in seen_mod:
        seen_mod.add(t['module']); lists['modules'].append(rel)
    if t['name'] in quick_names: lists['quick'].append(rel)
for k, v in lists.items():
    open(os.path.join(D, f'list-{k}.txt'), 'w').write('\n'.join(v) + '\n')
    print(k, len(v))
missing = quick_names - {t['name'] for t in thms}
if missing: print('quick names not found:', sorted(missing))
