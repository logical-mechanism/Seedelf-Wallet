# What we claim

Seedelf is a stealth wallet on Cardano. This page says what the proofs in this folder let us claim about its on-chain contracts, and where the claim stops. They also cover the contracts of Lovejoin v2, the mixer the Seedelf Wallet uses. [README.md](README.md) has the detail, and how to check it.

**Short:** Seedelf's contracts are formally verified, and so are the Lovejoin v2 contracts it uses: machine-checked proofs on the deployed bytes say exactly when each one accepts, for every transaction.

**In full:** Lean 4 proofs on the compiled bytes state exactly when each Seedelf contract accepts, for every transaction, with no limit on inputs, outputs or proofs. They do the same for each Lovejoin v2 contract Seedelf uses. All of them are checked by Lean's kernel. Seedelf's are also proved by Blaster, IOG's tactic that hands a goal to the Z3 solver, as a cross-check by another route. The proofs use IOG's model of the machine Cardano runs scripts on (PlutusCoreBlaster, on a fork), treat the cryptography as opaque (they prove what the scripts check, not that the cryptography can't be broken), and assume the ledger's own rules only where stated. This is not an audit of the contracts.

## What backs it

The README's *The scripts* says what each contract does.

| Contract | Theorem | Checked by |
|---|---|---|
| Seedelf wallet | `Seedelf.Every.wallet_accepts_iff` (`walletAccepts`, in the terms of its Aiken source, `wallet.ak`), any number of signatories | the kernel |
| Seedelf policy | `Seedelf.Every.policy_accepts_iff` (`policyAccepts`, in `seedelf.ak`'s terms), any mint and inputs | the kernel |
| always_false | `Seedelf.Every.always_false_errors` | the kernel |
| Lovejoin mix_box | `Lovejoin.AnyTx.BoxPurposesAll.every_context_iff` | the kernel |
| Lovejoin mix_logic | `Lovejoin.Every.Readable.mix_logic_accepts_iff` | the kernel |
| Lovejoin one_shot_mint | `Lovejoin.Every.Readable.one_shot_mint_accepts_iff` | the kernel |
| Lovejoin reference_holder | `Lovejoin.AnyTx.PurposesKernel.reference_holder_every_context_errors` | the kernel |

The Blaster cross-checks are the `Wallet*AnyTx` modules and `Signers/` (none to 128 signatories, tied to every context by `AnyTxShapes`), and the policy's `PolicyPurposeAnyTx`, `PolicyRedeemerAnyTx`, `PolicyLines*AnyTx` and `Slice/`'s `Rule` (by `PolicyShapes`). Seedelf's are on the bytes of variant 1, its deployed contracts, hash-checked against the chain (`extract.sh`; the README gives the hashes). Lovejoin's are on v2's templates, at any pool's parameters. Mainnet's live v2 pool (NFT policy `fcb3f5ec5f58d8fc31cf60408b77a1fe4f431880dc810bd12e8a9aa2`) runs exactly those templates applied: a test in the wallet's WebAssembly crate (`seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_proven_bytes_test.rs`) checks that the template files match the bytes the wallet derives pools from, and derives that pool's policy, mix_logic and mix_box from them, hash for hash. [README.md](README.md) has what each Seedelf result says; [Lovejoin/AnyTx/README.md](Lovejoin/AnyTx/README.md) has Lovejoin's, with mix_logic's and one_shot_mint's in the Aiken source's own terms.

## Where it stops

- **Every claim above is checked by Lean's kernel.** The Blaster cross-checks rest on Z3 instead. Blaster, run on a fork with one fix (README, *Running it*), translates a goal to SMT and, once Z3 finds no counterexample, closes it with an axiom (`blasterProven`). The translation isn't proof-checked. Each result holds for runs within its module's step limit. Each group also proves that every run returns unit or reaches an error, which shows no run reaches the limit. Blaster's strings stop at character `0x2FFFF` where Lean's go on, and Lean-blaster's issue [#389](https://github.com/input-output-hk/Lean-blaster/issues/389) shows it proving `False` from that; a bytestring's characters are `0` to `255`, so the results cover every bytestring (README, *What a ✅ is worth*). None of this touches the kernel theorems.
- **The machine is IOG's model, on a fork.** PlutusCoreBlaster's CEK machine is its evaluator for UPLC, the code Cardano scripts run as. Its README says the machine is working toward conformance with the node, tested by a conformance suite that runs apart from its CI and leaves out what it doesn't implement yet. It isn't proved equal to the node's. The proofs build on a fork of it whose changes don't change what a script evaluates to: `opaque` wrappers of builtins (a result holds for any interpretation of them), and three changes upstream has merged since (PlutusCoreBlaster's PRs [#71](https://github.com/input-output-hk/PlutusCoreBlaster/pull/71), [#72](https://github.com/input-output-hk/PlutusCoreBlaster/pull/72) and [#73](https://github.com/input-output-hk/PlutusCoreBlaster/pull/73)). The README's *Running it* lists each change. The kernel proofs of the policy use PlutusCoreBlaster's own slice.
- **The bytes and the context, as read.** The theorems are about the term PlutusCoreBlaster's flat decoder reads from each script's bytes. The typed ones are also about the `Data` (Plutus's data type) that CardanoLedgerApiBlaster's encodings make of a context. Neither is proved to match the node. The project's own review of the proofs (`Audit/`'s `FlatDecodeCheck`) compared the decoder's reading of the 13 scripts the proofs use, the seven above included, with Aiken's once, not in every build.
- **The crypto is opaque.** So are `serialise_data`, `bytearray_to_integer` and xor, and the byte slice in Blaster's proof of the policy's rule (the kernel's uses the real one). A result holds for any interpretation of them.
- **The ledger's rules, where they're used:** in Lovejoin's kernel theorems, never in Seedelf's. The rules assumed are a value as the ledger forms it (ADA first, sorted, every quantity positive), a mint likewise (no ADA, no zero quantity), and an input in every transaction. Nothing else about the transaction is assumed.
- **No bound on any list,** the wallet's signatories included. (Blaster's wallet cross-check stops at 128 signatories, where a transaction's size limit allows 125.)
- **Eventual success, not execution budgets.** The theorems say whether a run accepts in the end, not what it costs. A transaction can still run out of budget.
- **That the statements mean what the source means rests on reading them, not on a proof.** Each theorem states its script's rule in Lean, in the Aiken source's terms for the wallet, the policy, mix_logic and one_shot_mint, and proves it equal to what the bytes do. That the rule says what Seedelf or Lovejoin means is a reading (README, *Not proved, and why*).
- **Not covered:** that every Register the wallet makes (the datum on a Seedelf UTxO) can be spent; Lovejoin's fee_contract (no Seedelf transaction uses it); and the retired Lovejoin pools' scripts, which the wallet still runs to bring boxes back (the classic pool's scripts, and the first token pools' mix_logic, from Lovejoin `8131b1d`).
