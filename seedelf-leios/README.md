# seedelf-leios

Seedelf and Lovejoin on **Musashi**, the public Ouroboros Leios testnet: numbers only, for throughput and for what the wallet's transaction building would need to change under Leios and its era, Dijkstra. 1.7.0's item 8 ([post-release-roadmap.md](../seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md)). Run 2026-10-28.

It's a harness, not support. Nothing here touches the web wallet, the CLI, mainnet or preprod.
- It drives core's own builders (`seedelf-core`, by path) and changes none of them.
- It's its own Cargo workspace, so `seedelf-platform`'s workspace, lockfile and CI never see it.
- Once Leios is on mainnet, what holds here moves into core and the folder goes.
- The branch it lives on, `web-wallet/leios-musashi`, is kept to learn from (the owner, 2026-10-28). It isn't meant to merge.

## The short answer

- **Leios takes the wallet's transactions in its era only once Pallas is updated.** As core builds them today, Dijkstra refuses every Seedelf spend, every Lovejoin mix and a pool's launch. Mended, every one of them ran on Musashi, scripts unchanged. That's a CLI release and a web wallet release, much later (the owner).
- **Chains work across both kinds of block.** A Lovejoin chain sent whole lands in one endorser block, or runs from one block into the next. A chain of 4 mixes went into one EB. A chain of 5 went 4 into an EB and the 5th into the next ranking block's own body. A chain of 21 went across two EBs.
- **Lovejoin gains most, because steps are what bind it.** An EB takes 10× a block's steps, so 20 four-box mixes went into one EB, where mainnet takes 10 blocks for them. Ideally that's 5.6× mainnet's mixes a second; as Musashi ran, 2.8×, because 61% of the EBs that could have been certified weren't.
- **Under load, what a transaction waits for is the queue.** Every run here went in under IO's own load: 1.4 to 9 minutes before a block took it, a single payment as much as a chain. Sending a whole chain at once spares it a second trip through that queue, which the wallet's window of four makes it take today.

## Running it

```text
cargo run --release -- numbers     # the wallet's transactions, measured, and what a block of each kind takes
cargo run --release -- dijkstra    # what Dijkstra refuses in them, and the mend
cargo run --release -- model       # where a chain's transactions land, simulated (1,000 runs a line)
cargo run --release -- trace       # one simulated chain, block by block
cargo run --release -- live ...    # against Musashi, through a relay in Docker (the steps are in src/live.rs)
cargo run --release -- live report # every live run recorded, in one table
```

The offline commands need nothing but this checkout. `live` needs the relay:
- IOG's `ghcr.io/input-output-hk/ouroboros-leios/cardano-node-testnet:rc-2026w43`, run as `leios-relay` on the dev box, outbound only.
- Its chain sits in `~/leios-musashi/data`, and its exchange folder `~/leios-musashi/work` is mounted as `/work`.
- The harness's throwaway key, its pool, its Seedelf references and its runs' records live in `~/leios-musashi` too, never in the repo.
- The faucet wants a person (a reCAPTCHA): the owner asks it.
- Musashi is respun every couple of weeks. After a respin, `musashi/` takes the new genesis files and `live params` the new parameters, and the setup steps run again: `split`, `launch`, `deposit`, `seedelf-deploy`, `seedelf-fund`.

## What Musashi is

- **Linear Leios (CIP-164).** A ranking block (RB) is Praos's block, one every 20 s on average.
  - Each RB may announce an endorser block (EB) of what didn't fit it.
  - The next RB certifies that EB if it comes at least 14 s later (3·L_hdr + L_vote + L_diff = 3·1 + 4 + 7) and the committee's votes reach their quorum. The EB's transactions join the ledger then.
  - An RB that certifies carries no transactions of its own.
  - An EB that isn't certified is dropped, and its transactions stay in the mempool for the next block of either kind.
- **Its limits** (`musashi/protocol-parameters.json`, from the node; the genesis of the 2026-10-18 respin beside it):
  - an RB is mainnet's block: 90,112 bytes, 20 billion steps, 72 million memory;
  - a transaction is mainnet's: 16,384 bytes, 10 billion steps;
  - an EB takes 2,000,000 bytes of transactions (genesis had 260,000, since raised), 200 billion steps and 720 million memory: 22× an RB's bytes, but only 10× its steps.
- **Its Plutus V3 cost model is mainnet's** (350 entries; the node runs it, not the older one in its Conway genesis). So a script costs there what it costs on mainnet, to the step.
- **Its era is Dijkstra,** protocol version 12. Plutus V1 to V3 still run, as long as a transaction uses none of Dijkstra's new features (sub-transactions, guards, direct deposits). Dijkstra's new fees on reference inputs (`refInputsCostPerDatumByte`, `refInputsCostPerMultiAssetPolicy`) are 0 there.
- **Its node's mempool** holds 4,178,176 bytes: two RBs and two EBs. A Praos node's holds two blocks, which is what the wallet's window of four in flight was sized for (`pumpChain`).
- **How it ran** (KleioScan, blocks 41261 to 41760, under IO's load: `musashi/blocks-41261-41760.json`):
  - 99% of RBs announced an EB, and the next RB came late enough for 50% of them (the timing rule alone says 51%).
  - Of those, 38.7% were certified: 96 of 248. The rest failed on the vote, or the EB didn't get round in time. None was certified with less than 14 slots between.
  - So about a fifth of EBs became ledger. A certifying RB brought in 2,201 transactions on average.

## Dijkstra refuses the wallet's transactions as built

Checked against the node's own decoder (`live decode`), then sent.

**Redeemers written as a list.**
- The node refuses every script transaction the wallet builds: "List encoding of redeemers not supported starting with PV 12". That's each Seedelf spend, each Lovejoin mix and withdraw, and a pool's launch.
- Pallas 0.35's txbuilder writes redeemers as a list, and so does core's zero-withdrawal patch (`withdraw_zero.rs`). Dijkstra's CDDL drops the list form, and the ledger (cardano-ledger 9df9f98, `Alonzo/TxWits.hs`) decodes only the map from protocol version 12.
- Written as a map, with the script data hash computed again, they decode, and every script passes within what it declared.
  - The map is a byte longer a redeemer: 44 lovelace a redeemer, 176 for a 3-wide mix.
  - The harness mends each transaction after the fact (`dijkstra.rs`), taking the fee's rise from the payer's change, before it signs. Every live run here went out mended.
  - In core it would be a step of `Patches`, before `settle` prices the draft, as the staking and note patches are.
- A Lovejoin withdraw can't be mended after the fact: its proofs bind every output, so only core building it as a map from the start can. None was sent here.
- A deposit runs no script and goes as it is. So does any payment from the public account.

**A pool's launch, for its certificate too.**
- "Certificates without deposits are no longer supported". Core registers `mix_logic`'s stake credential with Shelley's certificate 0 (`launch.rs`), which Dijkstra drops.
- Conway's certificate 7 takes its place. It needs the credential's witness, so `mix_logic` runs under its publish purpose, which Lovejoin's script allows (`RegisterCredential` only).
- The harness registers it on its own first, with certificate 7 and a publish redeemer (built by `cardano-cli`), then launches with nothing to register. The pool went on chain that way: `3f1ca048…`, its `mix_box` at `f292017e…`.
- In core: the launch would write certificate 7 and a `Cert` redeemer for `mix_logic`, with its script in the witnesses. Pallas can't stage either, so it's a patch, as Lovejoin's zero withdrawal is.
- Pools already registered stay registered across a hard fork: only a new launch meets this.

**What else Dijkstra changes, and what it doesn't:**
- The wallet's transactions are `[body, witnesses, true, metadata]`, Conway's shape. Dijkstra still takes it for a transaction sent to a node, beside its own three-element shape (`[body, witnesses, metadata]`, which IO's load used).
- The public account's staking certificates (7, 8, 11, 12) are all still in Dijkstra.
- A token map is never empty in Dijkstra (`{+ ...}`), and a witness set takes no key twice. The wallet writes neither.
- Pallas 0.35 can't read a Dijkstra block, nor a Dijkstra transaction that uses Dijkstra's new fields. The wallet decodes its own transactions, so this only meets it where it reads others' from the chain.

## The live runs

Every transaction was built by core, mended for Dijkstra and signed by the harness, then sent through the relay. Where each landed is our node's look (a transaction that left its mempool, at the tip after it left; `Mempool.SwitchedToCertifyingView` names a certifying block), checked against KleioScan's db-sync for each one it had indexed (sampled for the bursts). The two agreed on every kind of block but one, a mix our node put in the RB before the certifying one; the watcher read the tip too early, and was mended after it. KleioScan's answer is the one here.

All under IO's load, which kept RBs at about 88 KB and EBs near 2 MB.

| Run | Txs | All on the ledger (s) | Blocks | In an RB | In a certified EB |
|---|---:|---:|---:|---:|---:|
| One payment | 1 | 85 | 1 | 1 | 0 |
| One mix, 3 wide | 1 | 225 | 1 | 0 | 1 |
| One mix, 4 wide | 1 | 221 | 1 | 0 | 1 |
| **Chain, 3 wide, sent whole** (a deposit and 4 mixes) | 5 | 462 | 1 | 0 | 5 |
| Chain, 3 wide, 4 at a time (the wallet today) | 5 | 434 | 2 | 0 | 5 |
| **Chain, 4 wide, sent whole** (a deposit and 5 mixes) | 6 | 388 | 2 | 1 | 5 |
| Chain, 4 wide, 4 at a time | 6 | 399 | 2 | 0 | 6 |
| 200 chained payments, then a 4-wide chain | 206 | 506 | 3 | 53 | 153 |
| 20 mixes, 4 wide, independent | 20 | 365 | 1 | 0 | 20 |
| 21 mixes, 4 wide, independent | 21 | 475 | 3 | 2 | 19 |
| 34 mixes, 3 wide, independent | 34 | 477 | 2 | 0 | 34 |
| Chain, 3 wide, three deep (a deposit and 13 mixes) | 14 | 272 | 3 | 1 | 13 |
| Chain, 4 wide, three deep (a deposit and 21 mixes) | 22 | 230 | 2 | 0 | 22 |
| One Seedelf spend | 1 | 140 | 1 | 0 | 1 |
| One Seedelf spend of 20 UTxOs | 1 | 134 | 1 | 0 | 1 |
| 10 Seedelf spends, chained | 10 | 335 | 1 | 0 | 10 |
| 10 Seedelf spends, independent | 10 | 353 | 1 | 0 | 10 |
| 25 Seedelf spends, chained | 25 | 527 | 2 | 18 | 7 |
| 200 payments, independent | 200 | 121 | 1 | 0 | 200 |
| 300 payments, chained | 300 | 484 | 1 | 0 | 300 |

Each run's record, with every transaction's id, block and place, is in [results/2026-10-28](results/2026-10-28) (copied from `~/leios-musashi/runs`, where `live` writes them).

**Four mixes chained, some in an RB and others in an EB:**
- Sent whole, the 3-wide chain (a deposit and 4 mixes, 23.2 billion steps) went into one certified EB, at places 860 to 1,102 among everyone else's. Mainnet takes it in two blocks at least: a block's 20 billion steps hold three mixes.
- The 4-wide chain (a deposit and 5 mixes, 49.3 billion steps) went 4 into a certified EB, at its very end (places 1,783 to 1,946), and the 5th, first in the queue after it, into the next RB's own body, at place 0. That's the chain running from an EB into an RB, valid because an RB builds on the ledger the EB made.
- Three deep, 3 wide: the deposit in an RB's body, mixes 1 and 2 at the end of a full EB (places 4,449 and 4,451), mixes 3 to 13 in the next EB, certified by the very next block. RB, then EB, then EB.
- Three deep, 4 wide: 207 billion steps, more than an EB takes, so it went across two EBs back to back, 10 and 12.
- 25 chained Seedelf spends: 7 in a certified EB, then 18 in the next RB's body.
- 300 chained payments: all in one EB, the whole chain 300 deep in one block.

**Sent four at a time, as the wallet sends a chain today,** the first four landed together in one EB, and the rest went out only then and waited for the queue again: 120 s more (3 wide), 245 s more (4 wide). Sent whole, nothing waits twice.

**An EB's room:** 20 four-box mixes went into one EB, 197.5 billion of its 200 billion steps, with 977 others' transactions beside them. Of 21, 19 went in and 2 went to the next two RBs. 34 three-box mixes (110 billion steps a batch) split 19 and 15: by then the EBs were full of IO's transactions by bytes, so how many of ours an EB takes depends on where they sit in the queue as much as on steps.

## Throughput

Measured with the wallet's evaluator against Musashi's parameters (`numbers`). Per second is with every block full of that one kind.

| Transaction | Size | Steps | Fee | Mainnet RB | Musashi EB | Mainnet /s | Musashi /s ideal | Musashi /s as observed |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Seedelf send, 1 UTxO | 917 B | 0.34 bn | 0.234 ₳ | 59 | 591 | 2.95 | 16.6 | 8.2 |
| Seedelf send, 20 UTxOs | 4,109 B | 6.76 bn | 0.921 ₳ | 2 | 29 | 0.10 | 0.79 | 0.37 |
| Lovejoin mix, 3 wide | 2,657 B | 5.79 bn | 0.823 ₳ | 3 | 34 | 0.15 | 0.95 | 0.46 |
| Lovejoin mix, 4 wide | 4,072 B | 9.87 bn | 1.214 ₳ | 2 | 20 | 0.10 | 0.56 | 0.28 |
| Lovejoin withdraw, 1 box | 733 B | 0.43 bn | 0.295 ₳ | 47 | 256 | 2.35 | 7.7 | 4.4 |
| Lovejoin deposit | 390 B | none | 0.173 ₳ | 231 | 5,128 | 11.6 | 137 | 60 |

- Steps bind every Seedelf spend and every mix in an EB, as they do in a mainnet block: an EB's 200 billion steps are 10× a block's, its bytes 22×. A Lovejoin withdraw is capped by the 1 MiB of reference scripts a block may read: 256 an EB.
- A transaction's limits are mainnet's, so a mix is still at most four boxes wide.
- At CIP-164's own simulated parameters (2,000 billion steps an EB), a 3-wide mix would be capped at 256 an EB by the reference scripts too, not by steps.
- "As observed" is with 38.7% of the EBs the timing allows certified, as Musashi ran: 2.8× to 3.7× mainnet where the ideal is 5.6× to 7.9×.

The model (`model`) runs the same rules on chains, with that 38.7%. Under load it gives a 5-transaction chain a mean of 2.5 to 3 minutes sent whole and 4.5 to 5 minutes four at a time, each transaction sitting in 3 or so EBs that are dropped before one is certified. Live, under IO's load, chains took longer still (4 to 8 minutes): the producers' mempools were full.

## What Leios would change for the wallet

- **Pallas, or core's own patches, writing Dijkstra's shapes:** redeemers as a map in every script transaction, and certificate 7 with a `Cert` redeemer in a launch. Without them nothing private goes through. The owner's plan: a later Pallas update, then a CLI release and a web wallet release.
- **The window of four in flight** (`pumpChain`) could become the whole chain. A Leios node's mempool takes two EBs. Sent whole, a chain of 5 to 22 transactions landed in one or two blocks; four at a time, it waited for the queue twice.
- **"On chain" is an RB's body or a certified EB, never an announced one.** An EB is dropped more often than not (about four in five, as Musashi ran), and its transactions wait for the next. The wallet already waits for the ledger, through the data layer and Koios, so nothing changes there, as long as they index certified EBs (KleioScan's db-sync does).
- **giveme.my witnesses only what's on the ledger,** so a chained Seedelf spend still waits for its parent. On Musashi, with the account's own collateral instead, 10 chained Seedelf spends went into one EB together. A Max in parts that could chain ahead would land in one or two blocks rather than one part a block.
- **Fees:** if Dijkstra's fees on reference inputs ever leave 0, every mix pays for the pool datum it reads, and core's fee doesn't count that yet. Watch `refInputsCostPerDatumByte` and `refInputsCostPerMultiAssetPolicy`.
- **Nothing in the scripts.** Seedelf's variant 1 and Lovejoin's pinned templates ran unchanged on Musashi, at mainnet's cost to the step.

## What wasn't tested

- A run with the network idle: IO's load ran the whole time. The model has idle runs (a 4-mix chain lands in two RBs on Praos and on Leios alike).
- A Lovejoin withdraw, which needs core to build it as a map, and giveme.my, which isn't on Musashi.
- Token pools: the pool here is ADA alone, 5 ₳ a box. A token pool's mix costs 5 to 10 million steps more ([lovejoin-mix-width.md](../seedelf-platform/seedelf-web-wallet/docs/lovejoin-mix-width.md)).
- Rollbacks of an RB that certified an EB.
