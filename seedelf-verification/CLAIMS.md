# What we claim

**Short:** Seedelf's contracts, and the Lovejoin v2 contracts it uses, are formally verified: machine-checked proofs, on the deployed bytes, of exactly when each one accepts, in every transaction.

**In full:** for every transaction, Lean proofs state exactly when each Seedelf contract, and each Lovejoin v2 contract Seedelf uses, accepts, on its compiled bytes, with no limit on inputs, outputs or proofs. Lovejoin's are checked by Lean's kernel; Seedelf's core properties by Blaster (Z3), with kernel-checked covers. The proofs use IOG's model of the Plutus machine (our fork of it), treat the cryptography as opaque (they prove what the scripts check, not that the cryptography can't be broken), and assume the ledger's own rules only where stated. This is not an audit.

## What backs it

| Contract | Theorem | Checked by |
|---|---|---|
| Seedelf wallet | the `Wallet*AnyTx` modules and `Signers/` (none to 128 signatories), tied to every context by `AnyTxShapes` | Blaster (Z3); the cover by the kernel |
| Seedelf policy | `PolicyPurposeAnyTx`, `PolicyRedeemerAnyTx`, `PolicyLinesAll`, `LinesAllAnyMint` and `Slice/`'s `Rule`, tied to every context by `PolicyShapes` | Blaster (Z3) and the kernel |
| always_false | `AlwaysFalseAnyTx` | Blaster (Z3) |
| Lovejoin mix_box | `BoxPurposesAll.every_context_iff` | the kernel |
| Lovejoin mix_logic | `Lovejoin.Every.Readable.mix_logic_accepts_iff` | the kernel |
| Lovejoin one_shot_mint | `Lovejoin.Every.Readable.one_shot_mint_accepts_iff` | the kernel |
| Lovejoin reference_holder | `PurposesKernel.reference_holder_every_context_errors` | the kernel |

Seedelf's are on variant 1's bytes, hash-checked against the chain (`extract.sh`). Lovejoin's are on v2's templates, at any pool's parameters. Mainnet's live v2 pool (`fcb3f5ec…`) runs exactly those templates applied: a test in the wallet's WebAssembly crate (`seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_proven_bytes_test.rs`) holds the template files to the bytes the wallet derives pools from, and derives that pool's policy, mix_logic and mix_box from them, hash for hash. [README.md](README.md) has what each Seedelf result says; [Lovejoin/AnyTx/README.md](Lovejoin/AnyTx/README.md) has Lovejoin's, mix_logic's and one_shot_mint's in the Aiken source's own terms.

## Where it stops

- **Seedelf's Blaster results are Z3's word.** Blaster, on our fork with the fix for Lean-blaster #454 (README, *Running it*), translates a goal to SMT and, once Z3 finds no counterexample, closes it with an axiom (`blasterProven`): the translation isn't proof-checked. Each result holds for runs within its module's step limit, and each family's returns-unit-or-error theorem shows no run reaches it. Blaster's strings stop at character `0x2FFFF` where Lean's go on, and Lean-blaster #389 shows it proving `False` from that; a bytestring's characters are `0` to `255`, so the results cover every bytestring (README, *What a ✅ is worth*). Lovejoin's results, and Seedelf's covers and `LinesAll` theorems, are kernel-checked.
- **The machine is IOG's model, on our fork.** PlutusCoreBlaster's CEK machine is working toward conformance with the node, its README says: a conformance suite run apart from its CI, leaving out what it doesn't implement yet. It isn't proved equal to the node's. We pin our fork of it (README, *Running it*), with three changes upstream doesn't have yet (the BLS12-381 operands in order, an opaque `serialise_data` and an opaque xor), and `Slice/`'s pin a fourth (an opaque byte slice, for the policy's rule), none of which changes what a script evaluates to.
- **The bytes and the context, as read.** The theorems are about the term PlutusCoreBlaster's flat decoder reads from each script's bytes, and the typed ones about the `Data` CardanoLedgerApiBlaster's encodings make of a context. Neither is proved to match the node. The decoder's reading of all 13 scripts was checked once against Aiken's (the audit's `FlatDecodeCheck`), not in every build.
- **The crypto is opaque.** So are `serialise_data`, `bytearray_to_integer`, xor and, for the policy's rule, the byte slice. A result holds for any interpretation of them.
- **The ledger's rules, where they're used.** A value as the ledger forms it (ADA first, sorted, every quantity positive), a mint likewise (no ADA, no zero quantity), and an input in every transaction. Nothing else about the transaction is assumed.
- **The wallet up to 128 signatories.** A transaction's size limit allows 125. Everything else has no bound on its lists.
- **Eventual success, not execution budgets.** A transaction can still run out of budget.
- **Not covered:** Lovejoin's fee_contract (no Seedelf transaction uses it) and the older Lovejoin pools' scripts.
