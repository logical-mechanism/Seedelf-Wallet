# Chunk 48 · Seedelf in every transaction, in the kernel

Branch `web-wallet/seedelf-every-tx` from `main` (`14b24e59`), worktree `../Seedelf-Wallet-chunk48`. The work is in `seedelf-verification/Seedelf/Every/`. Its [README](../../../../seedelf-verification/Seedelf/Every/README.md) has the method's differences from chunk 45, the modules and the pitfalls.

**Status: ✅ built 2026-11-12, all three scripts. ❓ the PR and the calls below are the owner's.**

## The owner's call

- **2026-11-12.** After an upstream check, the first item offered was "kernel-check Seedelf the way chunk 45 did Lovejoin". It would remove the "Z3's word" and 128-signatory caveats from Seedelf's own claim, with nothing needed from IOG. The owner: "Lets start one 1 and see how far we can get on it".

## What was built

Chunk 45's method on Seedelf's three deployed scripts. Each spec is the compiled code read back as Lean over `Data`, one `Ev` theorem per region, induction for each loop. Then each is restated in its Aiken source's terms, for every typed V3 `ScriptContext`. Every headline theorem rests on `propext`, `Classical.choice` and `Quot.sound` alone, and `#guard_msgs` checks that in the build.

| Script | Theorem | What it says |
|---|---|---|
| wallet `94bca9c0…` | `wallet_accepts_iff` | The program returns `()` exactly when `walletAccepts` holds: a spend whose redeemer is a `Proof`, and then any non-Register datum, or a Register for which `schnorr.prove` holds and `vkh` is among the signatories, however many there are |
| policy `84967d91…` | `policy_accepts_iff` | Exactly when `policyAccepts` holds: a mint, a bytestring redeemer, exactly one line, an input, and the xor of the burn and mint blocks, over PlutusCoreBlaster's own slice |
| always_false `6777ba4d…` | `always_false_errors` | Never: any argument reaches `Error` |

`wallet_exec_iff` and `policy_exec_iff` say the same of any context `Data`. The `_error` theorems add that a run which doesn't accept reaches `Error` and never halts.

`./check.sh seedelf-every` builds the 14 modules after their 14 imports. A clean build of the 14 takes about four and a half minutes, with peaks of 9.5 GB (`Mint`) and 8.8 GB (`Root`), so they run at 16 GB and 30 minutes, like `lovejoin-every`.

**What it changes in the claims** ([CLAIMS.md](../../../../seedelf-verification/CLAIMS.md), the [README](../../../../seedelf-verification/README.md)):
- **Every Seedelf claim is now the kernel's.** The Blaster modules stay as a cross-check, by another route.
- **No 128-signatory bound,** and no ledger hypothesis for the policy.
- **The README's last *Not proved* row** (the policy's rule over the real slice) is proved in the kernel, without `BitVec`.
- **The burn-past-#255 finding** holds in the kernel too: `policyAccepts` fails an index past 255 for a burn as well.

## Open, the owner's calls

1. ❓ **The PR** into `main`. Docs PRs get a light pass, but this one is proofs: one reviewer for the statements against the sources, and the owner runs `./check.sh seedelf-every` on a clean tree.
2. ❓ **The Blaster Seedelf modules:** keep them as a cross-check (the default here), or retire the heaviest. `Signers/` is 125 modules and 250 theorems, which `wallet_accepts_iff` now covers.
3. ❓ **An outside read of `walletAccepts`, `schnorrProve` and `policyAccepts`** against `wallet.ak`, `schnorr.ak`, `seedelf.ak` and `token_name.ak`. That checks what no proof can: that they say what Seedelf means.
4. ⬜ **`schnorrProve` against `Seedelf.V1.schnorrAccepts`,** the Blaster modules' spec, isn't proved. The kernel can't unfold `schnorrAccepts`: its `match` starts on `scalarOf z`, which it reduces down to deciding `n < q`. Reordering `schnorrAccepts`' match, decompressions first, would make it provable, but every Blaster wallet module would then need re-running.
5. ⬜ **When we move to IOG's PlutusCoreBlaster `main`,** these proofs need `LinesAllCek`'s program lemmas to follow #78's `runSteps` (chunk 46). The statements stay the same.

## Next it opens

- **No locked Register UTxOs** (item 2 of the 2026-11-12 list). With `wallet_accepts_iff`, an honest owner's spend reduces to one algebraic fact about `schnorrProve`. Taking the group laws of the opaque BLS12-381 builtins as hypotheses, an honest proof makes g^z = g_r · u^c hold, and a re-randomized `(g^d, u^d)` stays spendable with the same key. A Rust proptest through the deployed bytes would tie seedelf-crypto's prover to it.
