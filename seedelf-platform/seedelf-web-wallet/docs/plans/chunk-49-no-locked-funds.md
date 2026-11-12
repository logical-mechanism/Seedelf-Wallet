# Chunk 49 · No locked Register UTxOs, and the proofs' loose ends

**Status: ⬜ not started.** Written 2026-11-12 on chunk 48's branch (PR #381), so a new session can pick it up after that merges. The owner: "the remaining items you want to do, write them into a chunk that can be saved on this branch. That way after merger we can continue them in a new context window".

Chunk 48 ([its record](../archive/plans/chunk-48-seedelf-every-tx-kernel.md)) proved all three Seedelf scripts in the kernel, for every transaction: `wallet_accepts_iff`, `policy_accepts_iff` and `always_false_errors`. Those say what the scripts accept. This chunk adds that an honest owner can always meet that bar. It also closes the proof suite's last open audit finding and carries chunk 48's open calls.

## Start here

- **Read first:**
  - [`seedelf-verification/Seedelf/Every/README.md`](../../../../seedelf-verification/Seedelf/Every/README.md): its method, modules and pitfalls;
  - [`Lovejoin/Every/README.md`](../../../../seedelf-verification/Lovejoin/Every/README.md): chunk 45's method, which Seedelf/Every follows;
  - [`CLAIMS.md`](../../../../seedelf-verification/CLAIMS.md): what we claim today.
- **Branch `web-wallet/no-locked-funds` from `main`, in a worktree.** Copy the main tree's Lake cache across (about 700 MB) so nothing builds from scratch. On `logic`:
  ```bash
  cd ~/Documents/LogicalMechanism/Seedelf-Wallet && git worktree add ../Seedelf-Wallet-chunk49 -b web-wallet/no-locked-funds main && cp -a seedelf-verification/.lake ../Seedelf-Wallet-chunk49/seedelf-verification/
  ```
- **Builds:**
  - Claude ran `check.sh` itself all through chunk 48. Every build goes through it, or through the same capped scope; never `lake build` bare (one bare build took 52 GB).
  - To iterate on one scratch file, run `lake env lean <file>` inside that scope, from `seedelf-verification/`. The file's imports must be built first:
    ```bash
    systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 -p OOMPolicy=kill timeout 30m lake env lean <file>
    ```
- **Kernel proofs need no Z3.** Blaster's need 5.3.1 or later on `PATH` for the pinned forks, and Lean-blaster `main` needs 5.4.0.
- **The owner's standing rules:**
  - Each command block for the owner names its host, with no placeholders and no `set -e`.
  - Stage files by path.
  - Push or open a PR only when the owner asks.

## Steps

### 1. ⬜ Lake rebuilds a module when its `.hex` changes

This is the audit's last open finding, `script-hex-not-lake-inputs` (`Audit/review/findings.md`). `#import_uplc` reads `Seedelf/Scripts/*.hex` and the Lovejoin ones, but Lake doesn't track them. So after an extract run, `check.sh` replays the old ✅ as `ok` for bytes that are no longer there, and the README tells you to delete the Scripts modules' builds by hand.

- **The fix, as PlutusCoreBlaster's own lakefile does it** (`.lake/packages/PlutusCore/lakefile.lean`): an `input_file` per `.hex` (`text := true`), in the `needs` of the library whose `Scripts` module reads it. That covers `Seedelf`, `Lovejoin` (classic, `V2/`, `Template/`) and `Slice/`'s own lakefile.
- **Cost:** `needs` sits at the library level, so a changed `.hex` rebuilds the whole library once. The audit accepted that. If it's too heavy for `Lovejoin`, try a small `lean_lib` per `Scripts` module. First check that Lake doesn't claim the module for two libraries.
- **Done means:**
  - In a scratch copy, swap a `.hex` for another valid one (always_false's bytes in place of the wallet's).
  - `./check.sh Seedelf.Scripts Seedelf.Every.Root` must rebuild, not replay, and `Root` must fail.
  - Restore it, and the next run rebuilds once and passes.
  - Then mark the finding *Closed by*, and replace README *Running it*'s delete-by-hand paragraph.

### 2. ⬜ An honest owner can always spend: completeness, in the kernel

`wallet_accepts_iff` says a Register moves exactly when `schnorrProve` holds and `vkh` signed. Nothing yet says an owner who knows x can make `schnorrProve` hold. That's the no-locked-funds property, and CLAUDE.md's first protocol invariant: the same scalar d on both points keeps a Register spendable.

- **New module `Seedelf/Every/Complete.lean`.** Take the BLS12-381 builtins' laws as **hypotheses**, never axioms, gathered in one structure (`G1Laws`), over an `InG` predicate for the prime-order subgroup:
  - `uncompress (compress P) = .ok P` for `InG P`;
  - `InG (scalarMul a P)` for `InG P`;
  - `scalarMul (a + b) P = add (scalarMul a P) (scalarMul b P)`;
  - `scalarMul (a * b) P = scalarMul a (scalarMul b P)`;
  - `scalarMul (Int.fmod a q) P = scalarMul a P` for `InG P`;
  - `equal P P = true`.
  
  Plus the opaque byte facts the proof needs:
  - `byteStringToIntegerOpaque true` reads `be32 n` (32 bytes, big-endian) back as `n`, for `0 ≤ n < q`;
  - `blake2b_224`'s output is 28 bytes, so its integer is below `q`. State this as two hypotheses: the length, and the integer's bound for that length.
- **The theorem:** fix G with `InG G`, x, r and vkh. Write g = compress G, u = compress (x·G), g_r = compress (r·G), c = `bigEndian (challenge g u g_r vkh)` and z = `be32 (fmod (r + c·x) q)`. Then `schnorrProve g u z g_r vkh = true`.
  - The algebra: z·G = (r + c·x)·G = r·G + c·(x·G).
  - **Re-randomization:** (d·G, d·(x·G)) = (G', x·G') with G' = d·G (by `scalarMul (a * b)` and `Int.mul_comm`), so the same theorem spends it with the same x.
  - **The corollary,** with `wallet_accepts_iff`: a spend of that Register, with that proof and vkh among the signatories, is accepted, in every transaction.
- **Mirror the Rust prover exactly** (`seedelf-crypto/src/schnorr.rs`, `create_proof`): `z = r + c * sk` as a `Scalar`, encoded `to_bytes_be` (32 bytes). c is the 28-byte Fiat-Shamir hash, left-padded to 32 and read big-endian, which is the integer the script decodes. The nonce derivation (`proof_nonce`) doesn't matter here: any r works.
- **Compare with IOG's draft axiomatization,** PlutusCoreBlaster #29 (mpetruska's). Where its names and shapes fit, use them, so that its laws can replace our hypotheses if it ever merges. Never PR anything to #29.
- **Pitfalls:** keep `Int.fmod … q` and `bigEndian` free, generalized or behind hypotheses. Never ask the kernel to decide a comparison against `q` (Seedelf/Every's README, first pitfall).
- **Done means:** the theorem and corollary, axioms guarded to Lean's three. A CLAIMS.md line says what it adds and what it assumes: "if PlutusCoreBlaster's BLS12-381 builtins obey the group laws, as BLS12-381 does, an owner who knows x can always spend". The README gets a row.

### 3. ⬜ The Rust prover through the deployed bytes: a proptest

This was chunk 40's offer, carried by chunk 46 as ❓, and now it's the empirical half of step 2. Today seedelf-crypto's proptests check proofs only against Rust's own `prove`, and `eval_test.rs` replays fixed chain transactions. Nothing runs a fresh proof through the wallet's deployed bytes.

- **A new test in `seedelf-platform/seedelf-core/tests/`.** Take variant 1's wallet bytes from the repo, either `seedelf-core/src/references.rs`' reference output or `seedelf-verification/Seedelf/Scripts/wallet.hex`, and assert their hash is `constants.rs`' variant 1 `wallet_contract_hash`.
- **Build the V3 context as `PlutusData`** the way CardanoLedgerApiBlaster encodes it (`seedelf-verification/Seedelf/AnyTx.lean` spells it out):
  - `Constr 0 [txInfo, redeemer, Constr 1 [outRef, Constr 0 [Constr 0 [B g, B u]]]]`;
  - txInfo is `Constr 0` of 16 fields, with the signatories at index 8.
  
  Then apply it with `uplc` (`=1.1.23`; `seedelf-core/src/lovejoin/templates.rs` shows `Program::<DeBruijn>::from_cbor` and `apply_data`) and evaluate.
- **The properties,** over random keys (`Register::create`) and random vkh, keeping the cases near 32 since the BLS ops are slow:
  - a valid `create_proof` is accepted;
  - z or g_r off by one bit is refused;
  - vkh missing from the signatories is refused;
  - vkh at a random place among k other signatories is accepted;
  - `rerandomize()` then a proof with the same sk is accepted.
- **Done means:** it runs offline, under `cargo test -p seedelf-core --test <name>`. CI's `rust` job runs `cargo test --workspace --locked` and `cargo fmt --all -- --check` (`.github/workflows/web-wallet.yml`), so run `cargo fmt` on the new file. It never touches a network.

### 4. ⬜ An outside read of the readable statements

The proofs show that the bytes equal `walletAccepts`, `schnorrProve` and `policyAccepts`. They can't show that those say what Seedelf means.

- **Run a reviewer agent** with a fresh context. Give it only `wallet.ak`, `schnorr.ak`, `seedelf.ak` and `token_name.ak` at `5b82530`, and the definitions in `Typed.lean` and `PolicyTyped.lean`: never the proofs, nor what we expect it to find. Ask, for each clause, whether it accepts exactly what the source does.
- Chunk 45 did this for Lovejoin, and found wording issues only.
- Record the findings here. A person's read stays the owner's call.

### 5. ❓ `schnorrProve` against `Seedelf.V1.schnorrAccepts`

The two Schnorr specs, the kernel's and the Blaster modules', aren't proved equal. The kernel can't unfold `schnorrAccepts`: its `match` starts on `scalarOf z`, which it reduces down to deciding `n < q`. Three options:

- **(a)** Prove them equal by Blaster. That's Z3's word, and it only ties the two specs together.
- **(b)** Reorder `schnorrAccepts`' `match` (decompressions first), re-run the Blaster wallet modules, and prove equality in the kernel. The re-run includes `Signers/`' 125 modules, unless step 6 retires them.
- **(c)** Leave them apart, and say so (CLAIMS.md does now).

The owner picks.

### 6. ❓ The Blaster Seedelf modules: keep or retire

Since chunk 48 they're a cross-check. `wallet_accepts_iff` covers what `Signers/` (125 modules, 250 theorems) and `WalletAnyTx*` prove, and `policy_accepts_iff` covers what `Slice/` and `PolicyLines*AnyTx` prove.

- **Keeping them** costs build time and the upkeep of the Blaster pins (chunk 46).
- **Retiring some** shortens every re-pin. Keep at least `WalletRegister` and `Slice/`'s `Rule` as an independent check.

The owner picks. Chunk 48 kept them all.

## Not in this chunk

- **IOG's tools:** the move off our forks, PlutusCoreBlaster #78's `isUnsuccessful` (`isErrorState` across 342 files, and `LinesAllCek`'s program lemmas onto `runSteps`), #77, #455 and Z3 5.4.0. All of that is chunk 46, in [its plan](chunk-46-verification-on-upstream.md) and its 2026-11-12 section.
- **Lovejoin's further passes:** the owner's, after their own Lovejoin work.

## The owner's decisions

- **2026-11-12:** "Lets start one 1 and see how far we can get on it". That was chunk 48, all three scripts in the kernel.
- **2026-11-12:** "commit push and open pr". That was #381.
- **2026-11-12:** this chunk, quoted at the top.
