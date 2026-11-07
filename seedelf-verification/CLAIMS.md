# What we claim

**Short:** Seedelf's contracts, and the Lovejoin v2 contracts it uses, are formally verified: machine-checked proofs, on the deployed bytes, of exactly when each one accepts, in every transaction.

**In full:** for every transaction, Lean proofs state exactly when each Seedelf contract, and each Lovejoin v2 contract Seedelf uses, accepts, on its compiled bytes, with no limit on inputs, outputs or proofs. Lovejoin's are checked by Lean's kernel; Seedelf's core properties by Blaster (Z3), with kernel-checked covers. The proofs use IOG's model of the Plutus machine, treat the cryptography as opaque (they prove what the scripts check, not that the cryptography can't be broken), and assume the ledger's own rules only where stated. This is not an audit.

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

Seedelf's are on variant 1's bytes, hash-checked against the chain (`extract.sh`). Lovejoin's are on v2's templates, at any pool's parameters. [README.md](README.md) has what each Seedelf result says; [Lovejoin/AnyTx/README.md](Lovejoin/AnyTx/README.md) has Lovejoin's, mix_logic's and one_shot_mint's in the Aiken source's own terms.

## Where it stops

- **The machine is IOG's model.** PlutusCoreBlaster's CEK machine is tested against the Plutus conformance suite, not proved equal to the node's.
- **The crypto is opaque.** So are `serialise_data`, `bytearray_to_integer`, xor and, for the policy's rule, the byte slice. A result holds for any interpretation of them.
- **The ledger's rules, where they're used.** Sorted values and maps, a well-formed mint, an input in every transaction. Nothing else about the transaction is assumed.
- **The wallet up to 128 signatories.** A transaction's size limit allows 125. Everything else has no bound on its lists.
- **Eventual success, not execution budgets.** A transaction can still run out of budget.
- **Not covered:** Lovejoin's fee_contract (no Seedelf transaction uses it) and the older Lovejoin pools' scripts.
