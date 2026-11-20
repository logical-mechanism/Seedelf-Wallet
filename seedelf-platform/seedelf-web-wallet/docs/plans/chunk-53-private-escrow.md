# Chunk 53 · Private escrow

**Status: ⬜ planning.** Nothing is built yet. Written 2026-11-20 on its own branch from `main`. This file is the research and the plan together: what an escrow can and can't be on Seedelf, the design, its privacy, its threats, its proofs, and the steps. Each step gets its own branch, `web-wallet/escrow-<step>`, and its own PR from `main`, as chunk 38's steps do.

**What the owner asked (2026-11-20),** passing on a research brief written with ChatGPT: "Basically we should be able to use the existing machinery of seedelf to do this and should be able to get some lean proofs in. If this comes together then we can write a chunk about it and merge it into main for a future release. Basically we are looking for other things to add to seedelf that would benefit from how Seedelf works and gives users for privacy for various use cases." On the findings: "actually sounds really doable and would probably fit very well." The web wallet comes first. The CLI can follow later, since the builders live in core, but this chunk doesn't schedule it.

**The marks:**

- **[code]:** read in this repository.
- **[assumed]:** nothing here proves it.
- **[choice]:** a call this plan makes, which the owner can overturn.
- **[measure]:** a figure only a prototype gives.

**The brief's deliverables A to M map to the sections here:**

- A: [The verdict](#the-verdict)
- B: [What Seedelf gives](#what-seedelf-gives)
- C: [The designs](#the-designs)
- D: [Privacy](#privacy)
- E and F: [The design](#the-design)
- G: [Threats](#threats)
- H: [Cost](#cost)
- I: [Prior art](#prior-art)
- J: [The wallet](#the-wallet)
- K: [Proofs and tests](#proofs-and-tests)
- L: [Steps](#steps)
- M: [The owner's calls](#the-owners-calls) and [Unknowns](#unknowns)

## The verdict

- **Doable and small, and it needs no change to any deployed contract.** It is a new standalone spending validator with its own hash and reference UTxO. Variant 1 stays frozen.
- **It uses what Seedelf already has:**
  - registers anyone can re-randomize for anyone;
  - a Schnorr proof bound to a one-time key;
  - finding your own UTxOs by trial;
  - giveme.my's collateral.

  So Alice can open an escrow knowing only Bob's Seedelf, and Bob's wallet finds it with no new key or state. The payout arrives as an ordinary UTxO of his private balance.
- **Its privacy is a Seedelf send's, no more.** Who the parties are stays hidden, under the same assumption that hides who a Seedelf payment goes to. Anyone can see:
  - that an escrow exists, its amount and its deadline;
  - how it ended;
  - that the funding, the escrow and the payout are linked.

  Lovejoin, before funding and after a payout, breaks the money trail, as it does today.
- **No contract can tell whether the work was delivered.** Fair exchange with no trusted third party is impossible ([Prior art](#prior-art)). The contract only decides who carries the risk when someone goes quiet: an arbiter both sides chose, or a timeout that favours the side the agreement names.

## What Seedelf gives

- **The register and its proof** [code].
  - `Register {generator, public_value}` and `schnorr.verify` are in [lib/schnorr.ak](../../../../seedelf-contracts/lib/schnorr.ak).
  - The challenge is `blake2b_224(g ‖ g^r ‖ u ‖ bound)`. It commits to the statement (g, u).
  - [wallet.ak](../../../../seedelf-contracts/validators/wallet.ak) passes `bound = vkh` and requires `vkh ∈ extra_signatories`.
  - The proof's only tie to a transaction is the one-time key's signature over the body. It carries no domain tag and no output reference.
  - So a proof is safe to reuse in a new contract only while every proof's vkh is fresh and held by the prover alone. The web wallet derives a fresh one for every transaction ([keys-and-accounts.md](../keys-and-accounts.md)). The escrow adds its own binding anyway ([The rule](#the-rule)).
- **Re-randomization** [code]. `(g, u) → (g^d, u^d)` keeps the secret x: `Register::rerandomize`, [register.rs](../../../seedelf-crypto/src/register.rs).
  - A payer makes a fresh register for anyone from the register on the UTxO holding their Seedelf. The owner finds it by testing `g^x == u` (`ownedUtxos`, [balances.ts](../../extension/src/background/balances.ts)).
  - One x per phrase holds every Seedelf ([keys-and-accounts.md](../keys-and-accounts.md)), so the buyer's, seller's and arbiter's registers need no key of their own.
  - **This is the reason to use registers over fresh ed25519 key hashes.** With key hashes, Bob would have to send Alice one before she could fund, his wallet would have to keep an index per agreement, and the payout would need a register anyway.
- **The prover** [code]. `create_proof` in [schnorr.rs](../../../seedelf-crypto/src/schnorr.rs) hedges its nonce with HMAC over the statement, and accepts only a 28-byte vkh. A longer bound needs a new entry point beside it.
- **The builders** [code], in [build.rs](../../../seedelf-core/src/build.rs):
  - `is_payable`: both points torsion-free and neither the identity;
  - `ScriptSpend`: proofs, giveme.my's collateral, reference scripts, `measure_locally`;
  - `pay_rest`.
- **The closest precedent is `lovejoin::withdraw`** [code], in [lovejoin/mod.rs](../../../seedelf-core/src/lovejoin/mod.rs). It spends a script that isn't Seedelf's, pays `address::wallet_contract` an inline fresh register, and puts up giveme.my's collateral. That is a settlement's shape.
- **How z is read** [code]. The deployed verifier (5b82530) reads z with `expect scalar.from_bytearray_big_endian` and rejects z ≥ q. The current source's `scalar.from_bytes` reduces mod q, so it accepts z and z+q.
  - Either is harmless. A redeemer sits under the body's `script_data_hash`, which the one-time key signs.
  - The escrow reads z canonically anyway: exactly 32 bytes, below q, checked by hand, since stdlib v4's `scalar` has no Option parser.
- **The wallet's address** [code]. New wallet outputs go to the enterprise address `Script(94bca9c0…)` with no stake part (`address::wallet_contract`, [address.rs](../../../seedelf-core/src/address.rs)).

## The problem, bounded

- **What the contract can guarantee:**
  - The escrowed value moves only by the agreement's rules:
    - to the seller, on the buyer's proof;
    - to the buyer, on the seller's proof;
    - to either, on the arbiter's proof;
    - to the named side, after the deadline.
  - It never goes anywhere else, never arrives short by more than a capped fee, and never pays two escrows with one output.
- **What it can't:**
  - whether delivery happened;
  - that anyone acts at all;
  - that an arbiter is honest or available;
  - hiding amounts or timing.
- **Who carries the risk when someone goes quiet:**
  - **A timeout to the buyer.** The seller risks a buyer who stalls past the deadline after delivery.
  - **A timeout to the seller** (auto-release). The buyer risks paying for nothing, unless the seller refunds or an arbiter rules first.
  - **An arbiter.** Both sides trust the arbiter to rule honestly and in time.
- **It never locks while someone who can act will:** the buyer can always release, and the seller can always refund. It locks for good only when every key that could still act is lost or unwilling, and no timeout is set.

## The designs

| Design | Who acts | Where the money goes | Proofs per settlement | Verdict |
|---|---|---|---|---|
| **A · Pay the other side** | one party | to the other's register only | 1 | the core [choice] |
| **B · Timeout** | the side the datum names, from T | anywhere | 1 | optional, in v1 |
| **C · Arbiter** | the arbiter | the buyer's or the seller's register only | 1 | optional, in v1 |
| **D · 2-of-3 proofs** (Bitcoin's moderated escrow) | any two | anywhere | 2 | later |
| Joint key `x_a + x_b` | both | anywhere | 1 | rejected |
| Fresh ed25519 key hashes | one party | to the other's key | 0 | rejected |
| Dual-deposit ("MAD") | the buyer | fixed | 1 | later |

- **D's two-party transactions.**
  - Each settlement needs a message between the parties: a proof one side makes for the other's key.
  - An arbiter and either side together can pay anyone, the arbiter included.
  - What it buys:
    - splits by agreement;
    - a payee who picks the destination. That helps less than it seems, because the payer watches the escrow and sees the claim either way.
- **The joint key.**
  - It needs an interactive setup, and proofs of possession against rogue keys.
  - It has no directed outcome, and either side can stall forever.
- **Fresh key hashes** are cheaper on chain. They lose the non-interactive start and the payout into the private balance ([What Seedelf gives](#what-seedelf-gives)).
- **Dual deposits.** They work with no arbiter, because a stall costs both sides. But the seller must fund too, so the funding transaction needs both sides at once.

## The design

### The states

```
Fund (the buyer: a Seedelf spend to the escrow address)
            │
            ▼
       [ Locked ]  ─ one UTxO, spent once, never recreated
  Release          buyer's proof   ─► the seller's register  (a UTxO of their private balance)
  Refund           seller's proof  ─► the buyer's register
  Resolve(side)    arbiter's proof ─► that side's register    (only with an arbiter)
  Expire           timeout.to's proof, valid only from T ─► anywhere (only with a timeout)
```

- **No continuation output, so no state token and no minting policy** [choice]. Each path is one transaction.
- **Milestones need nothing new:** one escrow per milestone, each with its own deadline.

### Datum and redeemer

A shape, not code to copy:

```aiken
type Side { Buyer  Seller }
type Timeout { after: Int, to: Side }   // POSIX ms
type Escrow {
  buyer: Register,
  seller: Register,
  arbiter: Option<Register>,
  timeout: Option<Timeout>,
  max_fee: Int,        // the most a settlement's fee may take from the escrow
  terms: ByteArray,    // H(salt ‖ agreement); the script never reads it
}
type Action { Release  Refund  Resolve(Side)  Expire }
type Settle { action: Action, proof: Proof }   // Proof as in lib/schnorr.ak
```

The script takes one parameter, the wallet contract's hash `94bca9c0…` [choice]. A later wallet variant means a later escrow beside this one.

### The rule

The escrow accepts a spend of its UTxO `ref`, holding value `v` with an `Escrow` datum `D`, if and only if:

1. **E1. The only script input.** Exactly one transaction input has a script payment credential, and it is this escrow. This is Marlowe's fix after its audit: no other escrow, no later escrow version, and no wallet UTxO in the same transaction ([Prior art](#prior-art)).
2. **E2. The key signed.** `proof.vkh ∈ extra_signatories`.
3. **E3. The role proved.** `schnorr.verify(R.g, R.u, z, g_r, "seedelf/escrow/v1" ‖ ref.tx_id ‖ ref.index as 8 bytes ‖ vkh)`, with z read canonically. Every part has a fixed length, so the bound reads one way only. R is:
   - for Release, the buyer;
   - for Refund, the seller;
   - for Resolve, the arbiter, which must be set;
   - for Expire, `timeout.to`'s register, which must be set.
4. **E4. Expire waits.** The validity range's lower bound is finite and at or after `timeout.after`.
5. **E5. The payout,** for Release, Refund and Resolve. `fee ≤ D.max_fee`, and some output o satisfies all of:
   - its address is the wallet's enterprise address;
   - its datum is `InlineDatum(P)`, where P is the payee's register: the seller for Release, the buyer for Refund, the side named for Resolve;
   - it carries no reference script;
   - `assets.match(o.value, v, fn(out, in) { out + fee >= in })`. This means the non-ADA assets are equal, and the lovelace plus the fee covers the escrow's. The comparison is Data equality of the token maps, read in stdlib v4's `expect_match`, and it is exact on the ledger's canonical values.
6. **E6.** Expire has no output rule. Its side takes the money wherever it likes, Lovejoin included.
7. **E7. A malformed datum.** A datum that isn't an `Escrow`, or no datum at all, is spendable by anyone, as in wallet.ak (call 3).

### Why each part is there

- **E1 stops double satisfaction:** two escrows that pay one register can't share a payout.
  - That includes two escrows of different versions, the case that Cardano's vulnerability guide and Marlowe's audit both name.
  - Counting only this script's inputs would leave a later version's input free to share the payout.
  - A settlement needs no other input, since its fee comes from the escrow.
- **No continuation and no top-ups,** so no one can reset a timer. OpenBazaar's escrow audit rated a buyer resetting its timeout by topping up High.
- **E3's tag and output reference aren't needed for v1's safety,** which rests on fresh keys.
  - With them, a proof is good for one UTxO in one contract, whoever holds the key.
  - Approvals passed between the parties (design D) can come later without a new proof format.
- **E5:**
  - **The full address with no stake part** stops a settler from attaching a stake key of their own.
  - **The inline datum** keeps the payout a register UTxO that only its owner can spend. A wrong datum would leave it spendable by anyone (wallet.ak's `else`).
  - **No reference script** stops a settler from making the payee pay a reference-script fee every time they spend it.
  - **Exact tokens** stops a token being withheld or swapped, and junk being pushed onto the payee. It also keeps the value proof close to Lovejoin's.
  - **`fee` rather than `v − max_fee`** means a settler can burn up to the cap but can't keep any of it. Masumi's V2 leaves an "uncapped settler residual" to whoever submits a ruling. Here there is none.
- **The fee comes out of the escrow,** so no settler adds a UTxO of their own, which would tie it to the escrow.
- **The payout carries the escrow's own copy of the register,** already public in the datum.
  - privacy.md's rule against paying a register as found guards a link that this transaction makes anyway, since it spends the escrow.
  - A fresh copy would need a DLEQ proof on chain to hide only which side was paid, and the redeemer shows that already. Not worth it.

### The transactions

| | Inputs | Reference inputs | Outputs | Signers | Collateral | Fee from |
|---|---|---|---|---|---|---|
| **Fund** | the buyer's Seedelf UTxOs | the wallet's reference script | the escrow (inline `Escrow`), change under fresh registers | the one-time key, giveme.my | giveme.my | the inputs |
| **Release, Refund, Resolve** | the escrow | the escrow's reference script | the payout | the one-time key, giveme.my | giveme.my | the escrow |
| **Expire** | the escrow | the escrow's reference script | anything the side wants | the one-time key, giveme.my | giveme.my | the escrow |

Expire also sets its validity start at or after T.

### Fees and the minimum

- **The funder adds `max_fee` on top of the price** [choice], so the payee gets at least the price.
- **`max_fee` is one constant for every escrow,** set from 53a's measured settlement fee with a margin [measure]. One value keeps escrows alike.
- **The escrow's own minimum ADA** is larger than its payout's, since its datum is bigger. Funding checks that `price + max_fee` covers the payout's minimum [measure].
- **At most 20 kinds of token** (`MAXIMUM_TOKENS_PER_UTXO`) [choice]. The payout is one output, and the wallet puts no more than that in one.

### What the wallet checks before it shows an escrow

- **The datum's shape is read exactly as the script reads it.** It is held to the node by a spellings fixture, as Lovejoin's box datums are.
- **Every register passes `is_payable`.**
- **The role is found by trial.**
- **The arbiter is checked through the invite.** The invite carries a salt. The arbiter's register must equal the arbiter's Seedelf register re-randomized by `d_arb = H(salt ‖ "arbiter")`. So no d is kept as loose toxic waste: it's derived from what both sides hold.
- **The agreement is checked through the same salt:** `terms = H(salt ‖ agreement)`.
- **The UTxO is at the escrow's address,** and its value and deadline are as agreed.
- **None of it is taken from the invite's word.** Bisq's and RetoSwap's thefts were both checks a client skipped on what a counterparty sent ([Prior art](#prior-art)).

### Later, without breaking v1

- **Approvals:** a proof one side hands the other, bound to the output reference and an action, so the claimant builds the transaction. That is design D, with splits by agreement.
- **An arbiter's fee and a ruled split:** Resolve with two outputs at indexes it names.
- **Dual deposits.**

Each is a new script beside v1, as variants are. Escrows funded under v1 keep v1's rules.

## Privacy

- **Identity is hidden.** Every role is a fresh register, which nothing on chain ties to the party's Seedelf. This rests on XDH, DDH in BLS12-381's G1 [assumed]. privacy.md calls it ECDDH.
- **Credentials are hidden.** A proof shows only that the prover knows the register's key. Schnorr with Fiat–Shamir is zero-knowledge in the random-oracle model [assumed]. The one-time key is fresh, and the collateral is shared.
- **Amounts are public.** They're on chain, as in any Seedelf payment.
- **Destinations are partly hidden.** A payout goes to a fresh register, so who receives it is hidden. That it came from this escrow is public.
- **Relationships are public:** funding to escrow to payout, the timing, and how it ended (the redeemer's action). Lovejoin before funding and after a payout breaks the trail beyond them.
- **The agreement stays off chain.** On chain there is only a salted hash, which reveals nothing.

**The brief's ten questions, briefly:**

1. **Fresh registers for each agreement?** Yes, by re-randomization, with no message needed.
2. **Proofs without a recognizable credential?** Yes.
3. **Funded from the private balance?** Yes, as a Seedelf spend. Its inputs are tied to one another and to the escrow, as in any send.
4. **Released into Bob's private balance?** Yes. His wallet finds it as it finds any payment.
5. **Refunds to Alice privately?** Yes, the same way.
6. **A stable identifier in the datum?** None. The fingerprints are the arbiter's presence, the deadline, `max_fee` and the length of `terms`, which the defaults below make uniform.
7. **Can observers name the buyer, seller or arbiter?** No. They see a role's register, never a Seedelf, unless a party's other history gives them away.
8. **Can observers tie funding to settlement?** Yes, always, since it's one UTxO.
9. **Amounts, fees, timing?** All public. A round price and its timing can be matched by anyone who knows the deal.
10. **Links to other Seedelf transactions?** Only through the funding inputs and the payout's next spend, which Lovejoin breaks.

- **What each party learns.**
  - Alice knows Bob's payout register and can watch it. Bob knows Alice's refund register. That's the same as a send.
  - The arbiter learns both registers from the chain, and the terms only if a party sends them.
  - An invite that leaks says who the arbiter is and what was agreed. It never gives anyone a key or a way to spend.
- **The wallet's defaults keep escrows alike** [choice], by the rule that the most private option is the default:
  - one `max_fee`;
  - deadlines rounded to the UTC day;
  - `terms` always 32 bytes (random when there's no agreement text);
  - funded from the private balance;
  - and an offer to mix before funding and after a payout.
- **In the terms Goldfeder et al. use, v1 is none of the three:** not externally hiding, not dispute hiding, and not internally hiding ([Prior art](#prior-art)). What it hides is something their designs don't aim at: who each role is.
- **What simple eUTxO escrow can't hide:** amounts, the outcome, and the link between funding and payout. Hiding the outcome would take a DLEQ proof and an OR-proof on chain, which costs more than it saves. Hiding amounts isn't possible on Cardano's ledger today.

## Threats

The attacker can build any transaction, redeemer, datum and witness.

Each row's **stopped by** is one of three kinds: an on-chain rule (E1–E7) that 53f's kernel claim covers; a wallet rule, held by the wallet's own tests; or an assumption.

| Threat | Attacker, prerequisite | Exploit | Stopped by | Test |
|---|---|---|---|---|
| Release without the buyer | anyone; the datum is public | a Release with a made-up proof | E3 under DL [assumed] | bad z, bad g_r, another's register fail (Aiken, fuzz) |
| Refund or ruling without the key | anyone | the same for Refund or Resolve | E3 | the same |
| Replay after a rollback | anyone seeing a dropped settlement | its proof in a new body | E2: the vkh must sign, and only the prover holds it | a proof with another vkh, or with the vkh not signing, fails |
| Reuse across contracts | a holder of a wallet.ak proof | that proof in the escrow, or back | E3's tag | a wallet-bound proof fails (Aiken and Rust vectors) |
| Reuse across escrows | one register in two escrows | one proof for both | E3's output reference, E1 | a proof for ref A fails at ref B |
| Malleated proof | anyone | z+q, or a padded z | canonical z | z+q and a 33-byte z fail |
| Payout swapped | the settler | another register, address, stake part, or a datum by hash | E5 | one test for each field |
| Double satisfaction | a settler with two escrows to one register, of the same version or of two | one payout for both | E1 | two escrow inputs fail, even with two payouts; an escrow plus any other script input fails |
| Value taken through other inputs | the settler | adds their own inputs, then underpays | E5 counts only the payout | a short payout fails; an own input with a full payout passes |
| Assets withheld or swapped | the settler | keeps a token, swaps a name, changes a quantity, adds junk | E5's exact tokens | one test each |
| Fee skimmed or burnt | the settler | fee over the cap, or pays `v − max_fee` and keeps the rest | E5 | fee = cap+1 fails; a payout + fee one short fails |
| Deadline early | the timeout's side | Expire before T | E4 | lower bound T−1 fails, T passes, an unbounded start fails, an exclusive bound at T−1 passes |
| Validity range bent | the timeout's side | a range the ledger wouldn't hold | the ledger checks the range against the slot [assumed] | live preprod run |
| Datum changed | anyone | — | an output's datum can't change; a new UTxO is a new escrow | — |
| Spoofed or malformed escrow | anyone | a UTxO at the address naming you, with a bad datum, an unknown arbiter or the wrong value | the wallet's checks; E7 | parser against the script on the spellings fixture |
| Tagging | anyone | funds an escrow naming you, then watches what you do with it | no money at risk (you only pay out theirs). The wallet lists such escrows apart, and offers Lovejoin after | e2e |
| Stall | a silent counterparty | never acts | a timeout or an arbiter; never a lock while someone able acts | each path's live run |
| Arbiter bought | the arbiter, with one side | rules for the wrong side | trust (inherent); E5 still pays only buyer or seller | a Resolve paying the arbiter's register fails |
| Arbiter gone | — | never rules | the timeout as a backstop | — |
| Race after T | the timeout's side against the arbiter | Expire before a ruling lands | the wallet sets T after the dispute window (a wallet rule) | flows note |
| Front-running a settlement | anyone | resubmits a pending settlement with other outputs | the vkh signs the body | — |
| Payout below the minimum | the funder | too little ADA | the ledger refuses the transaction, so no money is lost; funding adds `max_fee` and checks the minimum | builder test |
| Reference-script griefing | the settler | a large script on the payout | E5 | a payout with a reference script fails |

**What holds and what's assumed:**

- **Once 53f lands,** each E rule holds exactly, by the kernel claim.
- **Assumed:** DL, XDH, the random-oracle model, and that the ledger enforces signatures, the validity range and `fee` as declared.
- **Plausible only, which no test or proof here settles:** that a bought arbiter is the only way to lose a fair ruling, and that the defaults make escrows look alike enough.

## Cost

- **Measured** [code]:
  - a Seedelf spend's script runs 76,043 memory and 337,845,799 steps (`SPEND_BUDGET_GUESS`'s doc, [build.rs](../../../seedelf-core/src/build.rs));
  - a one-input, ADA-only spend's fee was 233,912 lovelace for 916 bytes ([roadmap-v1.md](../archive/roadmap-v1.md));
  - a transaction's limit (`MAX_TX_BUDGET`) is 16.5M memory and 10B steps;
  - a transaction fits 22 Seedelf spends.
- **A settlement's crypto is one Seedelf spend's** [code]: three decompressions, two scalar multiplications, one addition, one comparison, one blake2b-224.
- **On top of that, unmeasured:**
  - the datum's decoding;
  - E1's walk over the inputs;
  - E5's search of the outputs and its value comparison.

  Expect one Seedelf spend plus a little, comfortably inside one transaction. Every path settles in one transaction.
- **53a measures:** the script's size, each path's units and fee, the escrow output's minimum ADA, and the datum's size [measure].
- **Collateral** is giveme.my's, as for every private spend, if giveme.my takes these transactions (call 10).
- **Requests:**
  - **Discovery** reads the escrow's payment credential with `credential_utxos`: Koios on preprod, and the data layer's public route on mainnet. That route serves any credential (capped at 20,000 rows, uncached; [seedelf-data/README.md](../../../../seedelf-data/README.md)), so no Kupo pattern changes. Adding one means a resync.
  - **Each refresh is one paged read,** the same for every user, so it never says whose escrows they are.

## The wallet

- **An Escrow tile** in [Dapps.tsx](../../extension/src/ui/screens/Dapps.tsx) ("The next contract gets a tile of its own"). It works from the private balance, never the public account, unless call 8 says otherwise.
- **The screens, in UI text short enough for one line each:**
  - **New escrow:** the seller's Seedelf, the amount and tokens, an optional arbiter's Seedelf, an optional deadline with the side it favours, and optional agreement text → Review → Send → the invite to copy.
  - **Open an invite:** paste it. The wallet fetches the UTxO, runs [its checks](#what-the-wallet-checks-before-it-shows-an-escrow), and shows what it found.
  - **Escrows:**
    - each with your role and its actions: Release (buyer), Refund (seller), Pay the buyer / Pay the seller (arbiter), and Take it after the deadline (the timeout's side);
    - escrows that name you but came with no invite are listed apart, with the tagging line.
  - **Activity:** each settlement, decoded.
- **The invite carries nothing secret.** It holds the output reference, the salt, the agreement text, and the arbiter's Seedelf. It is a code to copy, not a link ([CIP-13 was declined](../backlog.md)). No server is involved.
- **What you sign is what was built.** Every review is read back from the transaction about to be signed, decoded in WebAssembly, never from the form. So no one signs a payout the screen didn't show.
- **The plumbing:**
  - new `PendingTx.kind`s in [rpc.ts](../../extension/src/shared/rpc.ts), and the in-flight banner;
  - a TS copy of the escrow's hash;
  - the reference output bundled in [references.rs](../../../seedelf-core/src/references.rs) for `measure_locally`.
- **Chrome Web Store:** no policy names escrow ([Prior art](#prior-art)). The listing describes it as payment for work or goods between two people, never as a bet on an outcome.

## Proofs and tests

**Properties:**

- **On chain, which the kernel claim decides:**
  - **S1:** only the role's key moves the money, by the action's rule.
  - **S2:** an arbiter's ruling pays only the buyer's or the seller's register.
  - **S3:** a payout's tokens equal the escrow's, and its lovelace is at least the escrow's less a fee of at most `max_fee`.
  - **S4:** the escrow is the transaction's only script input.
  - **S5:** a proof is good for one escrow UTxO in this contract only.
  - **S6:** Expire waits for T.
  - **S7:** the converse of each: whenever its conditions hold, the script accepts.
- **The halves the claim can't cover:**
  - **L1, completeness:** an honest party's proof always meets E3. It waits on chunk 49 step 2's G1 laws.
  - **L2:** the wallet's builders always meet E1–E6.
  - **L3:** the timeout path can be reached. The kernel shows its rule. That the ledger reaches T is assumed.

**The claim:**

- It is `escrow_accepts_iff`, kernel-checked over every typed V3 context, as [`wallet_accepts_iff`](../../../../seedelf-verification/Seedelf/Every/Typed.lean) is, with the crypto opaque. It follows chunk 45's method ([Lovejoin/Every](../../../../seedelf-verification/Lovejoin/Every/README.md)).
- **Easy, by copying:**
  - the purpose dispatch;
  - the datum and redeemer decoding;
  - the Schnorr check (`schnorrProve`, with the same pitfalls around q);
  - the signers (`signer_loop`).
- **Moderate:**
  - E1's count of script inputs, an induction like Lovejoin's `collect`;
  - E5's search;
  - decoding the validity range. Nothing in this repo has done that yet. Only CardanoLedgerApiBlaster's Auction test has deadline properties, and those are bounded.
- **The hardest part is E5's value check,** and it is contained. Because it is "tokens equal, lovelace at least", it is close to Lovejoin's exact-equality proofs. It needs value-shape hypotheses (sorted, positive) like `mix_logic`'s `hv`.
- **Kernel only, no Blaster families for the lists or the value.** Symbolic Lovejoin mixes already timed out there.
- **Root fan-out:** four actions times an optional arbiter and an optional timeout. Cut the regions where they branch, as `datum_ev` does, so a module stays inside check.sh's 16 GB.
- **What justifies "formally verified":** the iff on the deployed bytes, its axiom guards, a CLAIMS.md entry, and a fresh reviewer reading the spec against the source.
- **Never claimed:** the crypto's strength, completeness (until L1), that the payee's register can be spent, budgets, or the ledger's time.

**Tests:**

- **Aiken:**
  - a unit test for every row of [Threats](#threats);
  - `aiken fuzz` properties over the datum, the action, and payouts' values and fees;
  - mutants of the validator (each E rule dropped or loosened), every one of which some test must kill, as seedelf-verification's Audit mutants do.
- **Rust:**
  - prover vectors shared with the Aiken tests;
  - the parser against the script on the spellings fixture;
  - builder tests for every path, each run through `measure_locally`'s script evaluation;
  - adversarial transactions: each builder's output with one field changed must fail.
- **Extension:** Vitest for the screens' logic, and e2e on the fakes for every path, stressed under load as the e2e rule says.
- **Preprod:**
  - every path live on the dev test wallet;
  - Ogmios's `additionalUtxo` probe for the failing cases, which spends nothing.

## Other uses of the same machinery

All five follow the same pattern: a register that can do only one thing.

1. **A scheduled private payment.** v1 already does it: no arbiter, the timeout to the seller, and the buyer can release early. A cancellable one needs a buyer path before T, which is a sibling.
2. **Inheritance or recovery:** the owner spends freely, and an heir can take it after a period of inactivity. The owner resets that period by spending to a fresh copy. A small sibling contract, and one a privacy wallet needs: losing the phrase loses everything.
3. **HTLCs for swaps across chains.** The shared hash ties the two chains together. An adaptor-signature version, Schnorr on G1 against the other chain's curve, is research.
4. **Payment requests,** off chain and with no contract: a Seedelf, an amount and a note. It's the natural way to start an escrow.
5. **A k-of-n private treasury,** spent by k proofs over fresh registers, with no member named on chain.

## Steps

### 53a ⬜ The contract

- `escrow.ak` in an Aiken project of its own (call 6), pinned to Aiken v1.1.24 and stdlib v4.0.0. It shares `schnorr.verify` with [lib/schnorr.ak](../../../../seedelf-contracts/lib/schnorr.ak) and copies nothing else.
- The tests in [Proofs and tests](#proofs-and-tests).
- Each path's units and fee, measured. `max_fee` is set from them.

**Done means:**

- every threat row has a passing test;
- every mutant is killed;
- the bytes and hash are recorded;
- the extract script checks the hash.

### 53b ⬜ Crypto and core

- **In seedelf-crypto:** a bound prover beside `create_proof`, with the escrow's tag, output reference and vkh, and the nonce hedged over the whole bound, with its vectors.
- **In seedelf-core:**
  - the `Escrow` types and parser;
  - an escrow output with an inline datum (a new `Payee`);
  - the fund builder on `ScriptSpend`;
  - the settle builders for the four actions on `ScriptSpend`, following `lovejoin::withdraw`;
  - discovery by trial, giving the role.
- **In seedelf-wasm:** the exports.

**Done means:** offline tests for every path, with value conservation, the minimum, and fresh registers checked.

### 53c ⬜ Preprod

- The reference script under always-false (call 9), bundled in `references.rs` and pinned by a constants test.
- Every path live; the probes.

**Done means:** a recorded transaction for each path, and each failing case refused.

### 53d ⬜ The web wallet

- The tile, the screens, invites, pending kinds and Activity, as in [The wallet](#the-wallet).
- flows.md and privacy.md's lines, and a dated entry under the privacy policy's *Changes* if anything new is sent anywhere.

**Done means:** unit and e2e tests pass, under load and on the store build.

### 53e ⬜ A private data-layer route (only if wanted)

- A `Watched` variant and routes, as Lovejoin's are, with a Kupo resync. Deployed through CI.

### 53f ⬜ Verification

- An Escrow family in seedelf-verification: extract, `Ev` lemmas, `escrow_accepts_iff`, guards, check.sh at 16G/30m, and `concrete/` vectors.
- A CLAIMS.md entry.

**Done means:** check.sh is clean, and a fresh-context reviewer has read the spec against the source.

### 53g ⬜ The gate

- A release's gate review.
- The mainnet reference script (the owner).
- `npm run tokens`, `npm run dreps`, store images, release.

## Not in this chunk

- CLI commands.
- Approvals passed between the parties and 2-of-3 (design D).
- Splits, an arbiter's fee, dual deposits.
- Hiding the outcome or the amount.
- Any change to wallet.ak, the policy, Lovejoin or the derivation.

## What doesn't change

- Variant 1 and every Seedelf flow.
- Lovejoin and private sessions.
- The data layer's routes, unless 53e is wanted.
- giveme.my's terms, unless call 10 says otherwise.

## The owner's calls

Each has a recommendation, which the owner can overturn.

1. ❓ **The design.**
   - **Recommended: pay the other side** (A + B + C), one proof for each settlement.
   - The alternative is 2-of-3 approvals (D).
2. ❓ **The timeout.**
   - **Recommended:** one optional timeout, with the side it favours named in the datum.
   - The alternative is the buyer only.
3. ❓ **A malformed datum.**
   - **Recommended: spendable by anyone,** as wallet.ak's is, so a foreign tool's mistake isn't locked for good.
   - The alternative is locked.
4. ❓ **Assets.**
   - **Recommended: any tokens,** with exact equality and at most 20 kinds. Stablecoins are what people pay for work with.
   - The alternative is ADA only.
5. ❓ **An arbiter's fee.**
   - **Recommended: not on chain in v1.** It's paid outside, or comes with a later script.
   - Whenever it comes, it is paid whichever way the ruling goes (wimsio's lesson).
6. ❓ **Where the source lives.**
   - **Recommended: an Aiken project of its own beside seedelf-contracts,** its bytes pinned in core as Lovejoin's templates are. Then compile.sh's seed and the wallet's undeployed revision never touch it.
7. ❓ **Mainnet data.**
   - **Recommended: the public `credential_utxos` route first,** and 53e only if a private route is wanted.
8. ❓ **Funding from the public account too?**
   - **Recommended: no** for the default, since it ties the account to the escrow.
   - It could be a visible choice, as Lovejoin's direct path is.
9. ❓ **The reference scripts.**
   - **Recommended:** the owner deploys them on preprod and mainnet, under always-false `6777ba4d…`, as the wallet's and the policy's are ([seedelf-contracts/README.md](../../../../seedelf-contracts/README.md)).
10. ❓ **Collateral.** Whether giveme.my lends collateral for escrow settlements, as it does for Lovejoin's withdraws.

## Unknowns

- Every [measure] figure, until 53a.
- Whether giveme.my takes these transactions (call 10).
- The kernel's memory for the value region and the validity-range decoding.
- Whether `assets.match`'s ordered walk needs more value-shape hypotheses than `mix_logic`'s.

## Prior art

**The marks:** [read] means read on the fetched page or paper; [snippet] means seen only in a search result. Gathered 2026-11-20.

- **Fair exchange.** It needs a trusted third party to be fair.
  - Even and Yacobi, "Relations among public key signature systems", Technion tech. report, 1980.
  - Pagnia and Gärtner, "On the impossibility of fair exchange without a trusted third party", TU Darmstadt TUD-BS-1999-02, 1999.
  - Survey: Pagnia, Vogt and Gärtner, "Fair exchange", *The Computer Journal* 46(1), 2003.
  - The citations were read as [arXiv 2203.05925](https://arxiv.org/abs/2203.05925)'s references.
- **Masumi's payment contract** (Cardano, Aiken, deployed) [read]. It is the closest live design ([masumi-payment-service](https://github.com/masumi-network/masumi-payment-service), `smart-contracts/payment-v2/`).
  - **How it works:**
    - six states, from FundsLocked through Disputed to Withdraw/RefundAuthorized;
    - five deadlines and cooldowns;
    - a weighted admin multisig rules on disputes, with signatures bound to `own_ref`.
  - **Its TxPipe audit (April 2025, v1)** found three things v1 here builds in:
    - **MAS-101, Major:** junk tokens bloated a UTxO under an output ≥ input check. Fixed by exact equality of every asset but ADA.
    - **MAS-201:** reference scripts on outputs raise the next party's fee. Fixed by forbidding them.
    - **MAS-308, acknowledged:** anyone can create an escrow with an invalid datum, and a validity token was declined.
  - **Its V2 README** warns that equal buyer and seller payout addresses allow double satisfaction, and that the settler keeps an uncapped residual.
  - **What Masumi needs that escrow v1 doesn't:** many states, and admins who can approve.
- **Marlowe's escrow** (Cardano) [read]: [the escrow guide](https://docs.marlowe.iohk.io/tutorials/guides/escrow-rest).
  - **The flow:**
    - Seller, Buyer and Mediator role tokens;
    - the buyer approves or complains, the seller confirms or disputes, the mediator rules;
    - four deadlines, each closing to whoever holds the account. A silent buyer pays the seller.
  - **"Escrow with collateral"** burns both deposits if the two sides disagree [snippet]; a [community gist](https://gist.github.com/ysfdev/1b08012698765840d3802f8c67ee42e5) implements it [read].
  - **Tweag's audit** (March 2023) [read]: [the outcomes](https://marlowe.iohk.io/blog/a-comprehensive-guide-to-marlowe-s-security-audit-outcomes-built-in-functional-restrictions-and). It found double satisfaction with *other* scripts. The fix made Marlowe the only script that runs in a transaction that pays parties, which is this chunk's E1.
- **Other Cardano escrows:**
  - plutus-apps' `Escrow` (reference only) [read]: pay every target, or refund after the deadline.
  - [wimsio/escrow](https://github.com/wimsio/escrow) (preprod, unaudited) [read]. It pays the arbitrator's fee on a ruling for the freelancer but not for the client, which gives the arbiter a reason to favour one side. A fee, if one comes later, is paid whichever way the ruling goes.
  - [Anastasia Labs' design patterns](https://anastasia-labs.github.io/aiken-design-patterns/) [read]: their UTxO indexers don't stop double satisfaction alone.
  - My searches found no audited P2P escrow on Cardano besides Masumi and Marlowe [snippet].
- **Bitcoin and Monero:**
  - **Bitrated and OpenBazaar** use 2-of-3 multisig, with the moderator paid only when there's a dispute [snippet].
  - **OpenZeppelin's audit of OpenBazaar's Ethereum escrow** [read] ([the audit](https://www.openzeppelin.com/news/openbazaars-escrow-audit)):
    - **High:** a buyer reset the timeout forever by topping up;
    - a timeout of 0 meant none;
    - pull payments are safer than push.
  - **[Bisq](https://bisq.network/blog/trade-protocols/)** [read].
    - It dropped 2-of-3 with an arbitrator key after collusion with traders and hacked arbitrators.
    - Today it uses 2-of-2, deposits, and a delayed payout to the DAO, with a mediator who never holds funds.
    - Its two thefts were both checks the client skipped:
      - a payout address never verified ([April 2020](https://bisq.network/statement-security-vulnerability-april-2020)) [snippet];
      - a negative fee taken from the counterparty ([May 2026](https://bisq.network/blog/security-incident-post-mortem/)) [read].
  - **Haveno and RetoSwap** (Monero, 2-of-3) [read]. An unchecked message made the attacker the arbitrator, holding two of three keys, for about $2.7M ([Halborn](https://halborn.com/blog/post/explained-the-retoswap-hack-may-2026)).
  - **The lesson for this wallet:** every check before it shows an escrow is load-bearing. The invite proves nothing; each check comes from the chain and the agreed Seedelfs.
- **Dual-deposit escrow:**
  - [BitHalo](https://www.gwern.net/doc/bitcoin/nashx/2014-zimbeck.pdf) [read]: 2-of-2 plus deposits, with a timeout that burns nearly all of it.
  - Particl's MAD escrow [snippet].
  - Burning works only as a credible threat, and an honest side with bad luck loses too.
- **Kleros Escrow** (Ethereum) [read] ([`MultipleArbitrableTransaction.sol`](https://github.com/kleros/kleros-interaction/blob/master/contracts/standard/arbitration/MultipleArbitrableTransaction.sol)).
  - The sender pays, the receiver reimburses, and after a timeout anyone may pay the **receiver**. That is the seller-side timeout that call 2 keeps possible.
  - Both sides must deposit the arbitration fee, and the loser pays it.
- **Privacy:** Goldfeder, Bonneau, Gennaro and Narayanan, ["Escrow protocols for cryptocurrencies: How to buy physical goods using Bitcoin"](https://www.cs.princeton.edu/~arvindn/publications/cryptocurrency-escrow.pdf), Financial Cryptography 2017, not USENIX Security as the brief said [read for its content; snippet for the venue].
  - **Its terms:**
    - *externally hiding:* no one can tell escrow was used;
    - *dispute hiding:* no one can tell there was a dispute;
    - *internally hiding:* the mediator can't tell it was chosen.
  - **It also shows** that a mediator colluding with one side can't be stopped, and that a mediator can refuse to rule.
  - **By those terms, escrow v1 is none of the three.**
    - Not externally hiding: the address says "escrow".
    - Not dispute hiding: Resolve is visible.
    - Not internally hiding: an arbiter's wallet finds escrows naming it by trial.
  - **What it does keep** is something their designs don't aim at: no one can tie a role to a Seedelf.
  - Their encrypt-and-swap construction hides all three, but needs threshold keys off chain. It's research for a later version.
- **Cardano's own guidance** [read]: [developers.cardano.org's vulnerabilities](https://developers.cardano.org/docs/developers/curriculum/smart-contracts/security/vulnerabilities/overview/), from the [MLabs catalogue](https://www.mlabs.city/blog/common-plutus-security-vulnerabilities).
  - Double satisfaction, including across script versions: E1.
  - The validity range's lower bound for "after": E4.
  - The full payout address, not just its payment part: E5.
  - Token dust: E5's exact tokens.
  - Unauthenticated UTxOs: the wallet's checks, and E7.
  - Binding a signature to its UTxO: E3.
- **The Chrome Web Store** [read] ([the policies](https://developer.chrome.com/docs/webstore/program-policies/policies), [the 2026 update](https://developer.chrome.com/blog/cws-policy-updates-2026)).
  - No rule names wallets, escrow or payments.
  - The relevant lines are about real-money gambling and prediction markets ("Extensions that facilitate or enable real money transactions on predictive outcomes are not allowed"), the single purpose, and no remotely run logic.
  - An escrow between two people for work or goods is none of these. The listing's text should describe it that way, and never as a bet on an outcome.

## Sources

**In this repository:**

- [lib/schnorr.ak](../../../../seedelf-contracts/lib/schnorr.ak)
- [wallet.ak](../../../../seedelf-contracts/validators/wallet.ak)
- [schnorr.rs](../../../seedelf-crypto/src/schnorr.rs)
- [register.rs](../../../seedelf-crypto/src/register.rs)
- [build.rs](../../../seedelf-core/src/build.rs)
- [address.rs](../../../seedelf-core/src/address.rs)
- [lovejoin/mod.rs](../../../seedelf-core/src/lovejoin/mod.rs)
- [constants.rs](../../../seedelf-core/src/constants.rs)
- [balances.ts](../../extension/src/background/balances.ts)
- [Dapps.tsx](../../extension/src/ui/screens/Dapps.tsx)
- [privacy.md](../privacy.md)
- [keys-and-accounts.md](../keys-and-accounts.md)
- [CLAIMS.md](../../../../seedelf-verification/CLAIMS.md)
- [chunk 49](chunk-49-no-locked-funds.md)
- [seedelf-data/README.md](../../../../seedelf-data/README.md)

**Outside it:** the links in [Prior art](#prior-art), each marked as read on the page or seen only in a search snippet.
