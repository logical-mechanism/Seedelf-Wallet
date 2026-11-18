# seedelf-verification

Machine-checked proofs of exactly when each of Seedelf's on-chain scripts accepts a transaction. Seedelf is a stealth wallet on Cardano. The proofs also cover the Lovejoin v2 scripts: Lovejoin is the mixer the Seedelf Wallet uses. This page is for anyone who reads "formally verified" and wants to know what it means: what's proved, about which bytes, in what model, what isn't covered, and how to check it.

[CLAIMS.md](CLAIMS.md) is the one-page version: what the proofs let us claim, and where the claim stops.

## The scripts

**Seedelf's three,** variant 1 of its contracts, the one deployed on Cardano:

- **wallet** (`94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469`): the address that holds Seedelf funds. Each UTxO there has a Register (g, u) as its datum: two BLS12-381 points, a generator g and a public value u = g^x, where x is its owner's secret key. A UTxO moves with a Schnorr proof of knowledge of x (z and g_r, `z_b` and `g_r_b` in the source), bound to `vkh`, the hash of a key that signs the transaction.
- **policy** (`84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255`): mints and burns Seedelfs, NFTs whose names start `5eed0e1f`.
- **always_false** (`6777ba4dc8c3043377201624502d92636381144700d49983258b75db`): never passes. It holds the scripts' reference UTxOs for good.

**Lovejoin v2's five.** All but reference_holder are templates, which each pool applies to its own parameters:

- **mix_box:** the address a pool's boxes sit at. A well-formed box moves only in a transaction that also withdraws from mix_logic.
- **mix_logic:** a staking script. Its withdrawal checks an Owner (each box's owner takes it out, with a proof of its key) or a Mix (two or more boxes in, as many new boxes out, with a proof for each).
- **one_shot_mint:** mints the pool's one NFT, once, at its launch.
- **reference_holder:** holds the pool's NFT and its settings (the reference datum), and never passes.
- **fee_contract:** holds fee shards that pay Mixes' fees. No Seedelf transaction uses it, and it's out of every claim.

## How it's proved

- **The bytes.** The proofs are about the compiled scripts, not their Aiken source. Seedelf's are the bytes this repository's commit `5b82530` holds in `seedelf-contracts/contracts/`, which `extract.sh` checks against the hashes above. Lovejoin's are v2's templates, from Lovejoin's `main` at commit `29573c5`, and the proofs hold at any pool's parameters.
- **The model.** Cardano runs a script as UPLC (Untyped Plutus Core) on a CEK machine, the evaluator the node uses. The proofs use IOG's model of both, in Lean 4: [PlutusCoreBlaster](https://github.com/input-output-hk/PlutusCoreBlaster) for UPLC and the machine, and [CardanoLedgerApiBlaster](https://github.com/input-output-hk/CardanoLedgerApiBlaster) for the ledger's types. The model isn't proved equal to the node, and its crypto builtins are `opaque`: a theorem holds for any interpretation of them, so it says what a script checks, not that the cryptography is hard to break (*What a ✅ is worth*).
- **The checker.** Every theorem CLAIMS.md cites is checked by Lean's kernel, on Lean's own axioms alone. A second set is proved by [Blaster](https://github.com/input-output-hk/Lean-blaster), IOG's tactic that hands a goal to the Z3 solver, as a cross-check: Z3's word, not the kernel's (*What a ✅ is worth*, below).

**All three Seedelf scripts are proved in Lean's kernel, with no Blaster** ([`Seedelf/Every/`](Seedelf/Every/README.md)). For every transaction, with no step limit, any number of signatories and any mint, each accepts exactly when a statement written in its Aiken source's terms holds (`walletAccepts`, `policyAccepts`); always_false never accepts. That those statements say what the source says rests on reading them, not on a proof (*Not proved, and why*). The Blaster modules below are a cross-check, by another route, of the same properties.

Lovejoin's proofs are here too, in `Lovejoin/`: v2's, and scenario proofs of its older classic mainnet pool, which the claim leaves out. [CLAIMS.md](CLAIMS.md) and [Lovejoin/AnyTx/README.md](Lovejoin/AnyTx/README.md) say what they cover and what they leave out. `Audit/` holds the project's own review of the proofs ([its README](Audit/README.md)). It covers the scenario proofs, not the kernel proofs the claim rests on.

## What's proved

### In Lean's kernel

On the same bytes, for every V3 script context (any value of CardanoLedgerApiBlaster's type for the transaction, redeemer and purpose the ledger hands a Plutus V3 script), and for any context `Data` at all. Each theorem is about the deployed program's own run (`cekExecuteProgram`). When the condition holds, the run returns `()` after some number of steps, which the ledger accepts if the transaction's execution budget covers it; otherwise it reaches `Error`, and at no step count does it return a value (`Halt`). No step limit, no layout, no ledger hypothesis, Lean's own axioms alone. [Seedelf/Every/README.md](Seedelf/Every/README.md) has the modules.

| Script | Theorem | Accepts exactly when |
|---|---|---|
| wallet | `Seedelf.Every.wallet_accepts_iff` | `walletAccepts`, `wallet.ak`: a spend, the redeemer a `Proof { z_b, g_r_b, vkh }`, and then no datum, any datum that isn't a `Register`, or a `Register` for which `schnorr.prove` holds (`schnorrProve`) and `vkh` is among the signatories, however many there are |
| policy | `Seedelf.Every.policy_accepts_iff` | `policyAccepts`, `seedelf.ak`: a mint, the redeemer a bytestring, a mint of exactly one line (policy, name, amount), an input; then exactly one of the burn (own policy, `take(tkn, 4) = 5eed0e1f`, -1) and the mint (own policy, `token_name.generate` of the first input and the tag, 1). An index past 255 fails, for a burn too. The byte slice is PlutusCoreBlaster's own |
| always_false | `Seedelf.Every.always_false_errors` | never: any argument reaches `Error` |

`wallet_exec_iff` and `policy_exec_iff` state the same of any context `Data` (`walletBool`, `policyBool`, the compiled code read back).

### By Blaster

On the same bytes, **in every transaction**. Every field a script doesn't read is any `Data`, values the ledger never produces included (`AnyTx.lean`). Only what a script walks or takes apart is fixed, one scenario per shape. `AnyTxShapes` and `PolicyShapes` prove, kernel-checked, that the scenarios are every V3 context there is. The last column counts each row's theorems.

| Module | Property | Theorems |
|---|---|---|
| `AlwaysFalseAnyTx` | always_false reaches `Error` whatever its argument: every V3 context, and any other `Data` | 1 |
| `WalletPurposeAnyTx` | The wallet is spend-only, with any TxInfo, redeemer and purpose payload | 5 |
| `WalletRedeemerAnyTx` | A redeemer that isn't a proof, `Constr 0 [B _, B _, B _]`, reaches `Error`, with any TxInfo, output reference and datum. 22 shapes | 22 |
| `WalletNoLockAnyTx` | A datum that isn't a Register locks nothing: a UTxO whose datum isn't a Register returns unit, which the ledger accepts, with any well-formed proof, TxInfo and output reference. 18 shapes | 18 |
| `WalletAnyTx`, `…Two`, `…Three`, `Signers/Signers4` to `Signers128` | **The wallet's core property:** a Register UTxO moves iff the Schnorr check holds and `vkh` is among the signatories, for every count of them from none to 128, every other field any `Data`. Every run returns unit or reaches `Error` | 13 + 250 |
| `AnyTxShapes` | Every V3 context is one of the wallet's scenarios: another purpose, a redeemer that isn't a proof, a datum that isn't a Register, or a Register with k signatories. Kernel-checked | 10 |
| `PolicyPurposeAnyTx` | The policy is mint-only, with any TxInfo, redeemer and purpose payload | 5 |
| `PolicyRedeemerAnyTx` | A redeemer that isn't a `B` (the personal tag) reaches `Error`, with any TxInfo and policy id | 4 |
| `PolicyLinesAll`, `LinesAllAnyMint` | A mint of two lines or more fails, at **every length**. So does any mint `Data` that doesn't flatten to exactly one line, and any redeemer that isn't a `B`. Any other field, inputs, signatories and policy id. Kernel-checked, by induction over the mint (`LinesAllLoops`, on `LinesAllCek`'s evaluator), with no step limit | 15 |
| `PolicyLinesAnyTx`, `…FourAnyTx`, `…FiveAnyTx` | The same by Blaster, as a cross-check: no lines, and 2 to 5 lines in every arrangement over policies | 31 |
| `Slice/`'s `Rule` | **The policy's rule** for one line: it passes iff the first input's index is a byte, the line is the policy's own, and it burns one token whose first four bytes are 5eed0e1f, or mints one token named as `token_name.generate` names the first input and the tag. Every run returns unit or reaches `Error`. Every value symbolic, every unread field any `Data` | 258, combined into 2 |
| `PolicyShapes` | Every V3 context with an input and a mint the ledger accepts is one of the policy's scenarios. Kernel-checked | 15 |

So, for every transaction:
- always_false never passes.
- The wallet passes only a spend, and a redeemer that isn't a proof fails. A UTxO with no datum, or a datum that isn't a Register, moves for anyone whose redeemer has a proof's shape (three bytestrings, checked no further). A Register UTxO moves exactly when the Schnorr check holds and `vkh` is among the signatories, however many (Blaster's cross-check stops at 128, and a 16,384-byte transaction holds at most 125: each needs its 30-byte hash and a 101-byte witness).
- The policy passes only a mint whose redeemer is a bytestring and whose mint is exactly one line, by its rule above.
- **A burn fails, as a mint does, when the transaction's first input is output #256 or later:** the policy builds the token name from that index as one byte, for a burn too (`policy_accepts_iff`; `PolicyBurn` and `concrete/policy_burns.sh` cross-check it). Seedelf's software refuses such an input for a mint. A burn with one fails evaluation before it's sent, so nothing is lost, and the same Seedelf burns with other inputs.

**The scenario modules** are narrower: each fixes the fields its script never reads (an empty transaction from `Scenario.lean`), and the modules above restate each of them in every transaction. The success theorems in `PolicyBurn` and `PolicyMint` don't build, since Blaster can't decide `Char`'s `BitVec` (*Not proved, and why*); `PolicyBurn`'s two failure theorems, below, do. `Slice/` proves the success directions over an opaque slice instead (*What a ✅ is worth*).

| Module | Property | Theorems |
|---|---|---|
| `AlwaysFalse` | always_false reaches `Error`, for any purpose and redeemer | 1 |
| `WalletPurpose` | The wallet is spend-only: minting, rewarding, certifying, voting and proposing reach `Error` | 5 |
| `WalletNoLock` | A datum that isn't a Register locks nothing: a UTxO whose datum isn't exactly `Some(Constr 0 [B _, B _])` is spendable with any well-formed proof. 18 datum shapes, which together cover every datum but a Register (listed in the module) | 18 |
| `WalletRegister` | **The wallet's core property:** a Register UTxO moves iff the Schnorr check holds and `vkh` signed. The check is the Aiken source's `prove`, in its order: z and c = blake2b_224(g ‖ g_r ‖ u ‖ vkh) decode into the scalar field, and g^z = g_r · u^c. One input and one signer; g, u, z, g_r, `vkh` and the signer all symbolic | 1 |
| `PolicyAmount` | Any amount other than ±1 fails | 1 |
| `PolicyForeign` | A mint or burn whose one line is another policy's fails | 2 |
| `PolicyBurn` | No 5eed0e1f token burns when the first input's output index is 256 or -1 | 2 |

What a ✅ is worth:

- **Z3's word, or Lean's kernel.** Blaster closes a goal with `axiom blasterProven : ∀ {α}, α` once Z3 finds no counterexample (it doesn't yet rebuild a Lean proof from Z3's answer), hence the `declaration uses 'blasterProven'` warnings. The kernel-checked modules use no Z3: `Seedelf/Every/` (every Seedelf script, every transaction), `AnyTxCover`, `PolicyAnyTx`'s `rfl`s, `AnyTxShapes`, `PolicyShapes` and the `LinesAll` ones. The theorems they're cited for list Lean's own axioms alone, each `#print axioms` under a `#guard_msgs` that fails the build otherwise, and so does every lemma such a theorem uses. `AnyTxCover`'s and `PolicyAnyTx`'s `rfl`s print none, and a `sorry` in one fails `check.sh` (`SORRY`). The `LinesAll` theorems hold with no step limit and over every Lean string.
- **IOG's model of the machine.** PlutusCoreBlaster's README says its CEK machine and builtins are working toward conformance with the node's, tested by a conformance suite that runs apart from its CI and leaves out what it doesn't implement yet. They aren't proved equal to the node's, and that suite never runs the flat decoder that reads each script's bytes. The project's own review of the proofs compared, once, the decoder's reading of the 13 scripts the proofs use with Aiken's (`Audit.Checks.FlatDecodeCheck`). The proofs run on a fork of PlutusCoreBlaster (*Running it*), whose changes don't change what any script evaluates to: its `opaque` builtins wrap the builtins' own functions, and its other changes are merged upstream. It runs the post-Conway V3 builtin semantics (`defaultFunSemanticsVariantE`). The crypto builtins (BLS12-381, the hashes) are `opaque`, and so is `ByteStringToInteger`, and `SliceByteString` in `Slice/`. A property holds for any interpretation of them, so it says what the bytes check, not that the check is hard to fool. Where a spec decodes a scalar (`scalarOf`) or slices (`Slice/`'s `policyAccepts`), it calls the same alias the builtin runs; the kernel's `policyAccepts` (`Seedelf/Every/`) runs the real slice.
- **Strings over the solver's alphabet.** Blaster gives a `String` the SMT string sort, whose characters are `0x0`–`0x2FFFF` where Lean's are scalar values up to `0x10FFFF` (Lean-blaster's issue [#389](https://github.com/input-output-hk/Lean-blaster/issues/389) shows it proving `False` from that). A `ByteString` is a `String` of characters `0`–`255`, inside both, so a theorem over bytestrings covers every bytestring; it says nothing about strings with characters above `0x2FFFF`, which no script sees.
- **Every transaction, by layout.** Each Blaster module fixes only what its script walks or takes apart:
  - the wallet's signatories (one module a count, none to 128) and the shapes of its redeemer and datum;
  - the policy's purpose, its redeemer, its mint (one line, or one arrangement of up to five) and its first input.
- **The covers tie those layouts to every context.** The wallet's needs no ledger hypothesis. The policy's assumes CardanoLedgerApiBlaster's model of two ledger rules: a transaction has an input, and its mint is well formed (`validMintValue`). `policy_ledger_hypotheses` derives both from its `validTxInfo`. The kernel theorems need neither a cover nor a hypothesis: they're stated over every typed context.
- **More than 128 signatories:** for the Blaster modules, the transaction size limit (`maxTxSize`, 16,384) rules them out, not a theorem. If the parameter rises past what 128 covers, they must grow with it. `wallet_accepts_iff` has no bound.
- **Bounded runs.** A Blaster property holds for runs within its module's step limit. Each limit sits above the longest concrete run that `Steps.lean`, `AnyTxSteps.lean` and the generators measure. Each family's returns-unit-or-error theorem shows that no symbolic run reaches it either.
- **Controls.** A contradictory background in the solver (Lean-blaster [#194](https://github.com/input-output-hk/Lean-blaster/issues/194)) would make every ✅ over it say nothing. A negative control, a statement Blaster must falsify, would fail the build instead (rule 8), but it probes only the builder it names: each Blaster goal is its own query, over its own `#prep_uplc` builder. These builders have one:
  - the wallet's, 8 of 50: always_false's one, one each of the purpose's 5, NoLock's 18 datum shapes and the redeemer's 22, and the 4 Register builders (`AnyTxControls`, `WalletAnyTxControls`);
  - `Signers/`, 3 of its 125 lengths (`Control4`, `Control64`, `Control127`); `Control128` prepares 128's builder again;
  - Lovejoin's, 11 of the 32 builders of its box, reference, launch and one- and two-box Owner families (`AnyTx/FalsifiedBox`, `FalsifiedOwner`);
  - `Slice/`'s rule, at first-input index #0 and #256 (`Controls`).

  The policy modules' controls, and two of `Slice/`'s, are runs cut a step short, builders of their own: they show the runs end inside the limit, not that a theorem's background holds. Lovejoin's Mix families, its three- and four-box Owners and `Template.AnyTxPurposes` (16 builders) have none yet. Posed the same way, the Owners' came back Undetermined in the solver's 540 seconds, and the Mixes' runs are longer still; `AnyTxPurposes`' statements are kernel-checked again (`PurposesKernel`, `LogicPublishKernel`). The scenario modules' controls are the audit's (`Audit/`).
- **The slice package.** `Slice/` runs the same hex, `../Seedelf/Scripts/seedelf.hex`. Its builders are word-for-word copies of `PolicyAnyTx`'s, so `PolicyShapes` covers its layout too. Two workarounds shape it:
  - each first-input index from 0 to 255 is a theorem of its own (`gen-seedelf-slice.py`), with two more off a byte, put together in the kernel;
  - the token name is quantified over its `String`, then restated over `ByteString` by structure eta.

### Lovejoin v2

Kernel-checked in every transaction ([`Lovejoin/AnyTx/README.md`](Lovejoin/AnyTx/README.md)): mix_box (`Lovejoin.AnyTx.BoxPurposesAll.every_context_iff`), reference_holder (`Lovejoin.AnyTx.PurposesKernel.reference_holder_every_context_errors`), mix_logic (`Lovejoin.Every.Readable.mix_logic_accepts_iff`: both withdrawals, the Owner and the Mix, and its publish) and one_shot_mint (`Lovejoin.Every.Readable.one_shot_mint_accepts_iff`: the launch). Each characterizes its script in every V3 context, at any list length, with no step limit and on Lean's own axioms alone. reference_holder errors in every context. mix_box's theorem is an iff with no hypothesis. mix_logic's and one_shot_mint's are iffs under the ledger's value rules: mix_logic's on the values of the reference inputs, one_shot_mint's on the mint and the outputs' values (CLAIMS.md, *Where it stops*). mix_logic's and one_shot_mint's are stated in the Aiken source's terms (`validate_owner`, `walk_outputs`, `verify_pre`, `datum_sane`, …), each proved equal to what the bytes do. fee_contract is out of scope: no Seedelf transaction uses it.

## Not proved, and why

What the proofs leave out. The model's own limits (the machine, the decoder, the opaque crypto) are under *What a ✅ is worth* above; [CLAIMS.md](CLAIMS.md)'s *Where it stops* adds the ledger rules assumed and execution budgets.

### Out of the claim

- **Lovejoin's fee_contract.** No Seedelf transaction uses it. It has only its rejected purposes and some fixed layouts here ([Lovejoin/AnyTx/README.md](Lovejoin/AnyTx/README.md)), no characterization.
- **The retired Lovejoin pools' scripts,** which the Seedelf Wallet still uses to bring boxes back from those pools. The classic mainnet pool's scripts have scenario proofs here (`./check.sh lovejoin`), outside the claim. The first token pools (Lovejoin `8131b1d`) run a mix_logic other than v2's, and nothing here proves it.
- **How the wallet reads the chain.** The proofs start from the context the ledger hands a script, where every datum is already decoded `Data`. A datum's bytes never reach a script, so no theorem here tells two spellings of one datum apart. Which UTxOs and boxes the wallet counts as its own, read from those bytes, rests on its own code and tests (chunk 51, r3a#1).

### Not proved yet

- **That the statements say what the source means.** `walletAccepts`, `policyAccepts`, `mixLogicAccepts` and `oneShotMintAccepts` are written in their Aiken sources' terms, and each is proved equal to what the bytes do. That they say what Seedelf and Lovejoin mean is a reading, which no proof can check. No outside reader has checked them yet against `wallet.ak`, `schnorr.ak`, `seedelf.ak`, `token_name.ak` and Lovejoin's sources.
- **That an honest owner can always spend.** The theorems say exactly what the wallet accepts. They don't prove that every Register the wallet makes, with a proof from its own key, meets that bar: that no Register UTxO is ever locked. `concrete/wallet_register.sh` checks one real proof, through Aiken's evaluator.
- **A Register the wallet didn't make.** By `wallet_accepts_iff`, a Register whose points don't decompress never moves. One whose public value is the identity point moves for anyone: the theorem reduces a spend to g^z = g_r · u^c, and BLS12-381's group law, which the proofs leave opaque, makes that hold for any z when u is the identity and g_r = g^z. Seedelf's software checks both before it pays a Register (seedelf-core's `build::is_payable`). A Register built another way can be locked for good, or spendable by anyone.

### Proved in the kernel, not yet by Blaster

Blaster fixes the length of every list a script walks (rule 4), so its cross-checks stop at five mint lines and 128 signatories, where the kernel's theorems have no bound (*Every transaction, by layout*). Past those lengths, only the kernel's theorems hold. One property more is proved in the kernel but not by Blaster, and closing that gap needs Blaster or PlutusCoreBlaster to change, not the scripts. `Seedelf/Every/` proves it over PlutusCoreBlaster's own slice, since the kernel never has to decide anything about a slice, only carry it. `Upstream/` holds a minimal reproduction of its blocker, with controls (`./check.sh upstream`).

| Property | Blocked by |
|---|---|
| By Blaster, the policy's rule over PlutusCoreBlaster's own slice rather than the alias (`PolicyBurn`'s and `PolicyMint`'s success directions). Proved in the kernel: `policy_accepts_iff` | `sliceByteString` is `take`/`drop` on the `List Char`, so any slice of a symbolic bytestring reaches `Char`'s `BitVec`, even `lengthOfByteString (sliceByteString 0 4 bs) ≤ 4` (`Upstream/ByteStrings`). `Slice/` proves the rule over the `opaque` alias instead, which says what the bytes check for any interpretation of the slice |

## Running it

You can re-run every proof yourself. It takes Linux with systemd, since `check.sh` caps each module's memory with `systemd-run --user`, and up to 16 GB of memory and 30 minutes a module.

**What it needs.** [elan](https://github.com/leanprover/elan), which installs the Lean that `lean-toolchain` pins, 4.24.0. **Z3 5.3.1 or later** on `PATH`, for everything Blaster proves; `seedelf-every` needs no Z3. The pinned Blaster commit sends Z3 a simplifier (`recfun-finder`) that 5.3.0 introduced; PlutusCoreBlaster's README still says 4.15.2, which fails every proof that reaches Z3. python3, with which `check.sh` reads each module's build log (without it every module reads `NO TRACE`), and which runs the generators and readers. Aiken, for the `concrete/` cross-checks; v2's extract needs Aiken v1.1.24.

**The pins.** The proofs build on forks of Lean-blaster and PlutusCoreBlaster, at pinned commits, because fixes they need aren't all upstream yet. `lakefile.lean` pins all three tools, and `lake-manifest.json` holds the full hashes:

- **Lean-blaster:** the fork [logicalmechanism/Lean-blaster](https://github.com/logicalmechanism/Lean-blaster) at `25c0ee0`, which is Lean-blaster's beta `46c8479` plus one fix, for a bug that declared a datatype with another type's parameter names, so that any goal with both `Except` and `Prod` failed (upstream [issue #454](https://github.com/input-output-hk/Lean-blaster/issues/454); the fix is offered upstream as [PR #455](https://github.com/input-output-hk/Lean-blaster/pull/455); both are open).
- **PlutusCoreBlaster:** the fork [logicalmechanism/PlutusCoreBlaster](https://github.com/logicalmechanism/PlutusCoreBlaster) at `68c5399`, which is PlutusCoreBlaster's `main` at `1c23de8` plus five changes.
  - Three are merged upstream: an `opaque` `ByteStringToInteger` ([PR #71](https://github.com/input-output-hk/PlutusCoreBlaster/pull/71)), `Fq1.t` as a `Nat` ([PR #72](https://github.com/input-output-hk/PlutusCoreBlaster/pull/72)), and the BLS12-381 builtins' operands in order ([PR #73](https://github.com/input-output-hk/PlutusCoreBlaster/pull/73)).
  - Two aren't: an `opaque` `serialise_data`, as upstream's [PR #27](https://github.com/input-output-hk/PlutusCoreBlaster/pull/27) proposes, and an `opaque` `XorByteString`. Only Lovejoin's proofs use them.
- **CardanoLedgerApiBlaster:** upstream's own, at `9938562`.

**`Slice/` is a package of its own,** with the same pins but one: PlutusCoreBlaster at `96261cc`, which is the main package's pin plus an `opaque` `SliceByteString` (see *What a ✅ is worth*). So the alias changes no other proof.

The scripts' bytes are committed, as `.hex` files. The extract scripts rebuild them and check each against its hash:

```bash
./extract.sh            # the deployed scripts, hash-checked, into Seedelf/Scripts/ and concrete/build/
./extract-lovejoin-v2.sh      # v2's templates, from a Lovejoin clone at 29573c5 (LOVEJOIN_V2=), with Aiken v1.1.24
./extract-lovejoin.sh         # the classic pool, from Lovejoin's c1239fb (LOVEJOIN=)
./check.sh              # standard Seedelf modules, cheapest first; or ./check.sh Seedelf.PolicyBurn
./check.sh seedelf-any-tx     # the every-transaction modules alone
./check.sh seedelf-signers    # the wallet with 4 to 128 signatories (python3 -I gen-seedelf-signers.py writes them)
./check.sh seedelf-policy-any-tx   # the policy in every transaction, where it needs no slice
./check.sh seedelf-slice      # the policy's one-line rule, in its own package (python3 -I gen-seedelf-slice.py)
./check.sh seedelf-every      # all three scripts in every transaction, kernel-checked: no Z3 (16 GB, 30 min a module)
./concrete/wallet_datums.sh   # cross-checks with Aiken's evaluator
./concrete/policy_burns.sh
./concrete/wallet_register.sh
```

**After an extract run, delete the Scripts modules' builds.** Lake, Lean's build tool, doesn't track the `.hex` files the Scripts modules read, so a changed script rebuilds nothing and `check.sh` replays the old results as `ok`:

```bash
rm -f .lake/build/lib/lean/{Seedelf,Lovejoin,Lovejoin/V2,Lovejoin/Template}/Scripts.{olean,trace} Slice/.lake/build/lib/lean/Slice/Scripts.{olean,trace}
```

**Never build bare** (`lake build`). `check.sh` builds each module in its own memory-capped scope (8 GB and 10 minutes; `lovejoin-every`, `seedelf-every` and their modules 16 GB and 30 minutes; `CAP=` and `LIMIT=` to change), which Linux kills past the cap. An uncapped build has used over 50 GB. The first build fetches and compiles the dependencies and takes a while.

To check the standard Lovejoin and Seedelf proof suites, including the separate Slice package, from this directory:

```bash
./check.sh lovejoin && ./check.sh lovejoin-v2 && ./check.sh lovejoin-any-tx && ./check.sh lovejoin-every && ./check.sh seedelf-every && ./check.sh seedelf-slice && ./check.sh
```

`lovejoin-every` builds the 51 modules its theorems import from elsewhere first, then its own 25, at 16 GB and 30 minutes a module. `./check.sh` goes last because it always ends nonzero, and nothing after it would run: `PolicyBurn` and `PolicyMint` report `FAILED`, since their success theorems fail on `BitVec` (*Not proved, and why*). Any other failure needs a look.

The runner returns a nonzero status if any module fails. It checks Lake builds, and a module that builds but logs a Blaster check as Undetermined fails too (`UNDETERM`), as does one whose log shows a `sorry` or a `native_decide` (`SORRY`), both read from the module's own build log, its trace. A run's status covers the modules it lists and every module of this package they import: an import the run doesn't list is read from its own trace and reported under its own name (`UNDETERM  Lovejoin.V2.MixAnySpec (an import of …)`), and the summary's last line counts them. A dependency's module counts only when its build fails. A module that fails to build, times out or is killed loses its old build files, and so does a dependency's module that fails, since Lake keeps the last good trace and the readers would take it for this run's; one that never started, because an import failed, keeps its build. Once a build passes, each trace the runner read is dated to the build's start, since Lake replays a log only for the source it was built from: a source written again with the same bytes (a checkout, a stash) reads as checked once a run has read it. `python3 -I tally.py Seedelf` (or `Lovejoin`, `Slice/Slice`) reads what the builds left, each module's ✅ against its source; a module with no build, resting on one that has none, here or in a dependency, or whose trace is older than its source, isn't ok, and `./check.sh <module>` settles the last (`./check.sh seedelf-slice <module>` for one of Slice/'s). `bash test-tools.sh` checks these rules in `check.sh`, `tally.py`, `Audit/count.py`, `Audit/run-all.sh` and the diag scan, on fake packages: no Lean, about ten seconds. This command excludes the separate audit and upstream reproductions. For the longer audit and its warning counts, see [`Audit/README.md`](Audit/README.md).

**That mainnet's v2 pool runs these bytes** is checked by a test in the wallet's WebAssembly crate, which needs no Lean: from `seedelf-platform/`, `cargo test -p seedelf-wasm --test lovejoin_proven_bytes_test`. It checks that the template files here match the bytes the wallet derives pools from, and derives the live v2 pool's NFT policy (`fcb3f5ec5f58d8fc31cf60408b77a1fe4f431880dc810bd12e8a9aa2`), mix_logic and mix_box from them, hash for hash.

## Questions and reports

- **A question about the proofs:** open an [issue on GitHub](https://github.com/logical-mechanism/Seedelf-Wallet/issues).
- **A flaw in a deployed Seedelf script** is a vulnerability: report it privately, as [SECURITY.md](../SECURITY.md) says, never in an issue.
- **A flaw in a Lovejoin script** goes to [Lovejoin](https://github.com/logical-mechanism/Lovejoin)'s own security policy.

## For contributors

How each family is built and changed, the plans and the records: [Seedelf/Every/README.md](Seedelf/Every/README.md), [Lovejoin/Every/README.md](Lovejoin/Every/README.md) and [Lovejoin/AnyTx/README.md](Lovejoin/AnyTx/README.md). The last also says what to do when a Lovejoin property comes back Falsified. The two sections below stay here, since the proofs' comments cite them.

### Found along the way

- **PlutusCoreBlaster applied six BLS12-381 builtins' operands swapped** at the `main` the fork started from: G1 and G2 `add` and `equal`, `mulMlResult` and `finalVerify`. The CEK machine hands a builtin its arguments last-first, and these six didn't undo it.
  - All six are commutative or symmetric on real points, so no evaluation shows it.
  - Over the `opaque` builtins, though, it makes the script's `equal(g^z, add(g_r, u^c))` the model's `equal(add(u^c, g_r), g^z)`, and WalletRegister is Falsified on it.
  - The fork fixes it (`BuiltinOperandOrder` test), and so does upstream's [PR #73](https://github.com/input-output-hk/PlutusCoreBlaster/pull/73).
- **A symbolic first-input index breaks `#prep_uplc`.** `consByteString idx txid` makes the index's byte a `Char` from a `UInt8`, which is a `BitVec`.
  - Blaster rejects it over a symbolic index.
  - The prepared prop comes back holding 18 `sorryAx` in the `Char`'s proofs (`declaration uses 'sorry'`). A prop like that must never be used. `check.sh` fails a module whose own build log, its trace, has a `declaration uses 'sorry'` warning (`SORRY`); PlutusCoreBlaster's own, in `CekMachine.lean`, is in that package's log, never one of ours. The theorems [CLAIMS.md](CLAIMS.md) cites are guarded anyway: each carries a `#guard_msgs` check that its axioms are Lean's own (`propext`, `Classical.choice`, `Quot.sound`), so a `sorry` anywhere beneath one fails its build.
  - `Slice/` proves each index apart instead.
  - On its own, `consByteString`'s byte is no blocker: `Upstream/ByteStrings.lean`'s control `cons_front` proves by Blaster for a symbolic index. It breaks only in `#prep_uplc`'s preparation of a whole script.
- **A symbolic `ByteString` token name blows the policy's run past 8 GB,** even with every other value concrete. The same name as its `String`, or as `a ++ b`, takes 280 MB in two seconds, and it branches no more either way. The cause isn't isolated; `Slice/` quantifies over the `String`. Neither this nor the index has a minimal upstream reproduction yet.
- **A burn fails when the transaction's first input is output #256 or later.** `xor(burn, mint)` takes both blocks, so a burn builds the mint's token name too, and `consByteString` refuses an index past a byte (`PolicyBurn`, `concrete/policy_burns.sh`). seedelf-core refuses such an input for a mint (`seedelf_token_name`), not for Remove's burn; local evaluation fails before submit, so nothing is lost, and the same Seedelf burns with other inputs. The contracts' [AUDIT.md](../seedelf-contracts/AUDIT.md) §3.4 (on a later revision of the source) covers mints only, and a 16 KB transaction fits about 400 small outputs, so #256 is reachable.
- **The upstream issues behind *Proved in the kernel, not yet by Blaster*:** Lean-blaster [#153](https://github.com/input-output-hk/Lean-blaster/issues/153), [#69](https://github.com/input-output-hk/Lean-blaster/issues/69) and [#67](https://github.com/input-output-hk/Lean-blaster/issues/67) (`BitVec`, `Char`), [#138](https://github.com/input-output-hk/Lean-blaster/issues/138) and [#233](https://github.com/input-output-hk/Lean-blaster/issues/233) (`#prep_uplc` cost, symbolic list tails), and PlutusCoreBlaster [#27](https://github.com/input-output-hk/PlutusCoreBlaster/pull/27) (an `opaque` builtin as the stopgap).

### Writing a property

Rules for a new Blaster property, numbered as the modules' comments cite them.

1. **Measure steps first.** Blaster's machine counts return steps too, so it takes about twice what the chain's cost model charges (wallet: 409 steps against a cost-model 233). Add the scenario's concrete run to `Steps.lean` and set the limit above it.
2. **Failure is `isUnsuccessful`, never `¬ isSuccessful`.** A run cut off by the step limit is neither (`isExhausted`), so with too small a limit `¬ isSuccessful` holds of every run, and proves nothing.
3. **Pair a failure property with a run that passes.** A malformed scenario fails for its own reasons; `Steps.lean` shows the same context halting when it's valid.
4. **Symbolic only what the property needs.** Every symbolic value the script branches on splits the symbolic run, and the splits multiply. Never symbolic: a list the script walks, or a bytestring it slices (keep the branch out of the scenario: a hypothesis excluding it still leaves it in the run). An opaque call doesn't split: WalletRegister's six symbolic bytestrings, through the scalar decode and the crypto builtins, take about a second.
5. **Small modules.** A module killed at the cap loses all its messages, including the ✅ before it.
6. **Read a result through a match, never a whole `State`.** `prop … = State.Halt (…)` makes Blaster declare the CEK datatype, constants and all. Match on the halted value, as `isSuccessful` does.
7. **A spec over opaque builtins must call them exactly as the script does:** the same function, the same arguments, in the same order. Commutativity is lost on the solver. `Steps.lean`'s concrete check of the spec (`schnorrAccepts` on a real proof) catches a wrong spec, but not a wrong order.
8. **Give each builder a control Blaster must falsify:** one of the theorems over it with a condition left out, or its outcome turned around, as `#blaster (gen-cex: 0) (solve-result: 1)`. Each Blaster goal is its own query over its own prepared builder, so a control probes that builder alone. Were the solver's background over it contradictory (Lean-blaster [#194](https://github.com/input-output-hk/Lean-blaster/issues/194)), every statement over that builder would come back Valid, the control too, which then prints "❌ Unexpected Valid" and fails the build.
