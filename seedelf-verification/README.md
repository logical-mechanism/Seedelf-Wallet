# seedelf-verification

Formal verification of the deployed contracts' bytes, with IOG's [Blaster](https://github.com/input-output-hk/Lean-blaster): Lean 4 with Z3 behind it, over [PlutusCoreBlaster](https://github.com/input-output-hk/PlutusCoreBlaster)'s model of UPLC and the CEK machine, and [CardanoLedgerApiBlaster](https://github.com/input-output-hk/CardanoLedgerApiBlaster)'s ledger types. The proofs are about the scripts on chain, not their Aiken source: variant 1, the bytes commit `5b82530`'s `seedelf-contracts/contracts/` holds, which `extract.sh` checks against the on-chain hashes.

Lovejoin goes here too, beside `Seedelf/` (see [Next](#next)).

## Running it

Needs [elan](https://github.com/leanprover/elan) (it installs the Lean that `lean-toolchain` pins, 4.24.0) and **Z3 5.3.1 or later** on `PATH`. The Blaster commit `lake-manifest.json` pins sends Z3 a simplifier (`recfun-finder`) that 5.3.0 introduced; PlutusCoreBlaster's README still says 4.15.2, which fails every proof that reaches Z3.

```bash
./extract.sh            # the deployed scripts, hash-checked, into Seedelf/Scripts/ and concrete/build/
./check.sh              # every module, cheapest first; or ./check.sh Seedelf.PolicyBurn
./concrete/wallet_datums.sh   # cross-checks with Aiken's evaluator
./concrete/policy_burns.sh
```

**Never build bare** (`lake build`). `check.sh` builds each module in its own memory-capped scope (8 GB, `CAP=` to change), which the kernel kills past the cap. One preparation step over a fully symbolic transaction took 52 GB before it was killed by hand. The first build fetches and compiles the dependencies and takes a while.

## What's proved

On the bytes of `94bca9c0…` (wallet), `84967d91…` (policy) and `6777ba4d…` (always_false):

| Module | Property | Theorems |
|---|---|---|
| `AlwaysFalse` | always_false reaches `Error`, for any purpose and redeemer | 1 |
| `WalletPurpose` | The wallet is spend-only: minting, rewarding, certifying, voting and proposing reach `Error` | 5 |
| `WalletNoLock` | No accidental locks: a UTxO whose datum isn't exactly `Some(Constr 0 [B _, B _])` is spendable with any well-formed proof. 18 datum shapes, which together cover every datum but a Register (listed in the module) | 18 |
| `PolicyAmount` | Any amount other than ±1 fails | 1 |
| `PolicyForeign` | A mint or burn whose one line is another policy's fails | 2 |
| `PolicyBurn` | No 5eed0e1f token burns off a first input at #256 or -1 | 2 |

What a ✅ is worth:

- **Z3's word, not Lean's kernel.** Blaster closes a goal with `axiom blasterProven : ∀ {α}, α` once Z3 finds no counterexample (proof reconstruction is a TODO upstream), hence the `declaration uses 'blasterProven'` warnings.
- **IOG's model of the machine.** PlutusCoreBlaster's CEK machine and builtins are tested against the Plutus conformance suite, not proved equal to the node's. It runs the post-Conway V3 builtin semantics (`defaultFunSemanticsVariantE`). The crypto builtins (BLS12-381, the hashes) are `opaque`: a property holds for any interpretation of them, so it says what the bytes check, not that the check is hard to fool.
- **Scenarios, not every transaction.** Each module fixes the fields its script never reads (an empty transaction from `Scenario.lean`) and leaves symbolic only what the property is about. Some properties fix more than that: see the module docs.
- **Bounded runs.** A property holds for runs within the module's step limit, above the longest concrete run `Steps.lean` measures.
- The 18 shapes covering every non-Register datum is checked by reading them, not by a Lean theorem tying them together.

## Not proved, and why

These need Blaster or PlutusCoreBlaster to change, not our scripts:

| Property | Blocked by |
|---|---|
| **A Register UTxO moves iff the Schnorr check holds and `vkh` signed** (`WalletRegister`, left out of `check.sh`): the wallet's core property | Blaster declares Lean's `Except ε α` (what `bls12_381_G1_uncompress` returns) as `(par (@α @β) …)` with fields over `@ε`, which Z3 rejects; and `byteStringToInteger` (z and the challenge) is a plain definition built on `BitVec`, which Blaster can't translate over a symbolic input |
| Mints name the token after the first input, for any input; burns of 5eed0e1f tokens succeed | `sliceByteString` is `take`/`drop` on the `List Char`: slicing a symbolic string branches on its length, and each branch carries the rest of a ~1300-step run (8 GB). Comparing a partly symbolic name reaches `Char`, a `UInt32`, so `BitVec` again |
| Any first-input index | `consByteString`'s `UInt8` is a `BitVec` |

Until the first is fixed, the wallet's Schnorr path rests on the Aiken tests, `seedelf-crypto`'s proptests and seedelf-core's recorded-transaction evaluations.

## Found along the way

- **A burn fails when the transaction's first input is output #256 or later.** `xor(burn, mint)` takes both blocks, so a burn builds the mint's token name too, and `consByteString` refuses an index past a byte (`PolicyBurn`, `concrete/policy_burns.sh`). seedelf-core refuses such an input for a mint (`seedelf_token_name`), not for Remove's burn; local evaluation fails before submit, so nothing is lost, and the same Seedelf burns with other inputs. AUDIT.md §3.4 (on the later revision) covers mints only, and a 16 KB transaction fits about 400 small outputs, so #256 is reachable.

## Writing a property

What a run teaches the hard way:

1. **Measure steps first.** Blaster's machine counts return steps too, so it takes about twice what the chain's cost model charges (wallet: 409 steps against a cost-model 233). Add the scenario's concrete run to `Steps.lean` and set the limit above it.
2. **Failure is `isUnsuccessful`, never `¬ isSuccessful`.** A run cut off by the step limit is neither (`isExhausted`), so `¬ isSuccessful` holds for nothing when the limit is too small. Two of the first "proofs" here did.
3. **Pair a failure property with a run that passes.** A malformed scenario fails for its own reasons; `Steps.lean` shows the same context halting when it's valid.
4. **Symbolic only what the property needs.** Every symbolic value the script compares splits the symbolic run, and the splits multiply. Never symbolic: a list the script walks, a bytestring it slices, an integer it turns into a byte, a path into the crypto builtins (keep the branch out of the scenario: a hypothesis excluding it still leaves it in the run).
5. **Small modules.** A module killed at the cap loses all its messages, including the ✅ before it.

## Next

- **Lovejoin.** Its scripts' bytes are in seedelf-core: the generalized pool scripts, before their parameters, in `src/lovejoin/templates.rs`, and the classic pool bundled whole. A `Lovejoin/` beside `Seedelf/`, with its own `Scripts.lean` and an `extract.sh` step that checks its hashes.
- Raise the blockers upstream: the `Except` declaration (Lean-blaster), `BitVec` through `byteStringToInteger`, `consByteString` and `Char` (PlutusCoreBlaster), slicing on SMT strings, and the Z3 version in PlutusCoreBlaster's README.
