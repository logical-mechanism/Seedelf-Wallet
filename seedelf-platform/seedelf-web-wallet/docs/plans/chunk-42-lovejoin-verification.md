# Chunk 42 · Lovejoin, verified (local only)

Branch `lovejoin-verification`, from `verification` at `63cdb465`. **Local only:** it's never pushed, and its push remote points nowhere (`branch.lovejoin-verification.pushRemote = no-push-local-only`), so a plain `git push` fails. The owner, 2026-11-03: "A lot of the seedelf web wallet depends on lovejoin working as well. Trickier and if something is found wrong then it would be bad for us to push it into this branch so maybe a local only branch until we prove it good?"

The work goes in `seedelf-verification/Lovejoin/`, beside `Seedelf/`, on the same pinned forks (chunk 41). The README's rules for writing a property hold here.

| Step | Status |
|---|---|
| 1 · Setup, reference_holder and mix_box | 🚧 written; the bytes and the concrete cases checked; Lean not yet built |
| 2 · mix_logic's easy parts | ⬜ |
| 3 · `serialise_data` behind an `opaque` alias | ⬜ |
| 4 · mix_logic, Owner | ⬜ |
| 5 · mix_logic, Mix | ⬜ |
| 6 · fee_contract and one_shot_mint | ⬜ |
| 7 · The token-pool templates | ⬜ |

### Next session, in order

1. **The owner builds step 1** (dev box): `cd /home/logic/Documents/LogicalMechanism/Seedelf-Wallet/seedelf-verification && git branch --show-current && ./check.sh lovejoin`.
   - The first line must print `lovejoin-verification`: these files exist only on this branch.
   - Expected: seven `ok`, and 30 theorems ✅. ReferenceHolder has 1, MixBoxPurpose 5, MixBoxGate 5 and MixBoxNoLock 19.
   - Steps prints each scenario's concrete run, which should match `concrete/lovejoin_mix_box.sh`. If a run passes a module's limit (500 for the purposes, 1500 for the boxes), Claude raises the limit.
2. **Then step 2.**

## When a property comes back Falsified

- **First, run the counterexample concretely**, with Aiken's evaluator on the deployed bytes, as `concrete/` does.
- **If Aiken agrees, it may be a flaw in a live pool.**
  - Stop, and tell the owner only.
  - Nothing that hints at it gets pushed or posted: no fork branch, no upstream comment, no PR text.
  - The owner decides on disclosure; Lovejoin has its own `SECURITY.md`.
  - The pool's scripts are frozen, so a fix is a new pool beside it.
- **If Aiken disagrees, it's a gap in our spec or in the tools,** as WalletRegister's operand order was in chunk 41. Fix that, the same way.
- **Tool fixes that say nothing about Lovejoin can go public,** for example #27's `serialise_data` alias on our forks and upstream. A fix that a finding motivated waits with the finding.
- **This branch merges into `verification`** (public) only when the owner says the results are good to publish.

## Targets

1. **The classic mainnet pool, first.** It's the live ADA pool, 10 ₳ a box.
   - Its bytes are Lovejoin `c1239fb`'s `artifacts/mainnet/`, from the 2026-09-26 deployment (Aiken v1.1.24), fully applied.
   - `extract-lovejoin.sh` checks each against the hash seedelf-core pins (`lovejoin::Protocol::of`, mainnet). It checks mix_box and mix_logic against the reference scripts seedelf-core holds as they sit on chain (`references.rs`), the bytes the wallet spends against.
   - All five matched on 2026-11-03: mix_box `c145c10f…`, mix_logic `0dad3046…`, fee_contract `a072c7e8…`, one_shot_mint `f5592689…` (the NFT policy), reference_holder `288fea77…`.
2. **The token-pool templates later:** Lovejoin `8131b1d`, seedelf-core's `templates.rs`.
   - They differ from the classic pool's sources (2,226 lines across 12 files), so they're a second target, not a re-run.
   - They're templates, so the theorems take a launched pool's parameters: the 5 ₳ pool's, or the wallet's own launch.
   - Commit `8131b1d` was fetched into `../lovejoin` on 2026-11-03 to read it. That checkout stays on its own branch.
3. **The preprod pool isn't a target:** its scripts are recompiled and hash differently.

## Step 1 · Setup, reference_holder and mix_box 🚧

- **Done:**
  - `extract-lovejoin.sh`: all five scripts `ok`, as above.
  - `concrete/lovejoin_mix_box.sh`: ten one-input spends through Aiken's evaluator, all as the source says:
    - a well-formed inline box moves only with mix_logic's withdrawal; another credential's doesn't count;
    - `a = b`, a 47-byte `a`, the wrong constructor, three fields, `I 7`, no datum, and a well-formed datum stored by hash (audit finding F-2) all move with no withdrawal.
  - `Lovejoin/`: `Scripts` (the imports), `Box` (the scenario: one box, the transaction's only input), `Steps` (the concrete runs), and four property modules:
    - **ReferenceHolder** (1): reference_holder fails for any purpose and redeemer.
    - **MixBoxPurpose** (5): mix_box is spend only.
    - **MixBoxGate** (5): with no withdrawal, a box moves iff its datum isn't a well-formed `MixDatum` (`Constr 0 [B a, B b]`, both 48 bytes, `a ≠ b`). A well-formed box moves with mix_logic's withdrawal of any amount, and not with another script's or a key's.
    - **MixBoxNoLock** (19): every other datum shape moves with no withdrawal, as `Seedelf.WalletNoLock`'s shapes cover. That includes a box stored by hash whatever its witness says (F-2), and holds for any redeemer.
- **Not covered:** a transaction with more inputs than the box, or more withdrawals than one. Both are lists the script walks (`list.find`, `pairs.has_key`). One box and one withdrawal, symbolic everywhere else, is the scenario.

## Step 2 · mix_logic's easy parts ⬜

- Its purposes: spend, mint, vote and propose fail. Publish succeeds only for a `RegisterCredential` certificate, for any credential, and fails for every other certificate.
- The scenario reads the reference input: `read_reference_datum` looks for the pool's NFT among the reference inputs. Fix one reference input holding it, with the deployed `ReferenceDatum`: denomination 10 ₳, 1 ₳ maximum fee per mix, and the three hashes.

## Step 3 · `serialise_data` behind an `opaque` alias ⬜

- **mix_logic hashes `serialise_data`** of the outputs and the input refs (Owner), and of the box value (Mix). PlutusCoreBlaster's encoder can't be translated (Lean-blaster #152, #153).
- **PlutusCoreBlaster #27 (Luivatra, a draft since July) is the fix:** `encodeDataOpaque` at the builtin's dispatch.
  - Take it onto our fork's `seedelf` branch, credited, as #72 took #29's part.
  - It says nothing about Lovejoin, so it can go on the public fork. #27 itself is the PR, so no new one.
- **A spec that hashes the same serialisation** calls the same alias, as `scalarOf` does (README rule 7).

## Step 4 · mix_logic, Owner ⬜

- **The property, with n = 1:** a withdrawal under `Owner` succeeds iff the box's Schnorr proof verifies against `ctx = blake2b_256(serialise(outputs) ‖ serialise(input refs) ‖ mix_script_hash)`. So an owner's proof is bound to the transaction's outputs and inputs, and can't be replayed to redirect them.
- **Measure first:** a real Owner spend from Lovejoin's own vectors (`schnorr_kat.test.ak`, `mix_kat.test.ak`), through Aiken and then `Steps`.
- **Read `schnorr.ak` and `bls.ak` before writing the spec.** `point_from_bytes` uses `bytearray_to_integer` (our alias) and the G1 operations, whose operand order the spec must follow (README rule 7).

## Step 5 · mix_logic, Mix ⬜

- **(a) No value leaves the pool in a mix,** for n = 2:
  - if a Mix succeeds, its first n outputs are each at mix_box, with no stake credential or reference script, exactly the box value, and a well-formed inline `MixDatum`.
  - That's one direction, so the sigma-OR proofs can stay symbolic and unread.
- **(b) The iff:** success iff (a) holds and every input's sigma-OR proof verifies over the n statements.
- **Expect cost.** That's n² DH-tuple checks over opaque builtins. If (b) is `KILLED`, split it by input, as chunk 40's stop rules say.
- **Possible blocker:** `hash.ak`'s Fiat-Shamir header calls `from_int_big_endian` on n. With n fixed it may evaluate away. If it reaches `BitVec`, it needs an `IntegerToByteString` alias, which chunk 41 deferred.

## Step 6 · fee_contract and one_shot_mint ⬜

- **fee_contract:** what `PayMixFee` and `Replenish` allow. Read it first.
- **one_shot_mint:** the NFT mints once, only with the seed spent, and lands at reference_holder with a well-formed `ReferenceDatum`. On mainnet the seed (`ba815aa5…#2`) is spent, so the policy can never mint again, a ledger fact beside the theorem.

## Step 7 · The token-pool templates ⬜

- The same properties, over `8131b1d`'s scripts, applied to a launched pool's parameters.
- First list what changed from `c1239fb`, and which theorems carry over.

## The owner's decisions

- **2026-11-03, the start:** "is it possible to do it for lovejoin … maybe a local only branch until we prove it good?"
