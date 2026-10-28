# seedelf-leios

Seedelf and Lovejoin on **Musashi**, the public Ouroboros Leios testnet: numbers only, for throughput and for what the wallet's transaction building would need to change under Leios and its era, Dijkstra. 1.7.0's item 8 ([post-release-roadmap.md](../seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md)).

It's a harness, not support: nothing here touches the web wallet, the CLI, mainnet or preprod. It drives core's own builders (`seedelf-core`, by path), and changes none of them. It's its own Cargo workspace, so `seedelf-platform`'s workspace, lockfile and CI never see it. Once Leios is on mainnet, what holds here moves into core and the folder goes. The branch it lives on, `web-wallet/leios-musashi`, is kept to learn from (the owner, 2026-10-28).

## Running it

```text
cargo run --release -- numbers     # the wallet's transactions, measured, and what a block of each kind takes
cargo run --release -- dijkstra    # what Dijkstra refuses in them, and the mend
cargo run --release -- model       # where a chain's transactions land, simulated (1,000 runs a line)
cargo run --release -- trace       # one simulated chain, block by block
cargo run --release -- live ...    # against Musashi, through a relay in Docker (src/live.rs)
```

The offline commands need nothing but this checkout. `live` needs the relay: IOG's `ghcr.io/input-output-hk/ouroboros-leios/cardano-node-testnet:rc-2026w43`, run as `leios-relay` on the dev box, outbound only, its chain in `~/leios-musashi/data` and its exchange folder `~/leios-musashi/work` mounted as `/work`. The harness's throwaway key, its pool and its runs' records live in `~/leios-musashi` too, never in the repo. Musashi is respun every couple of weeks: after a respin, `musashi/` takes the new genesis files and the pool is launched again.

## What Musashi is

- **Linear Leios (CIP-164).** A ranking block (RB) is Praos's block, one every 20 s on average. Each may announce an endorser block (EB) of what didn't fit it; the next RB certifies that EB if it comes at least 14 s later (3·L_hdr + L_vote + L_diff = 3·1 + 4 + 7) and its committee voted, and the EB's transactions join the ledger then. An RB that certifies carries no transactions of its own. An EB that isn't certified is dropped, and its transactions stay in the mempool for the next block of either kind. About 51% of EBs are certified (no RB in the 13 slots after the one that announced it).
- **Its limits** (`musashi/`, the genesis of the 2026-10-18 respin; KleioScan's parameters at epoch 43): an RB is mainnet's block (90,112 bytes, 20 billion steps, 72 million memory) and a transaction mainnet's (16,384 bytes, 10 billion steps). An EB takes 200 billion steps and 720 million memory, and 2,000,000 bytes of transactions since genesis's 260,000 were raised. Plutus V3's cost model is mainnet's, so a script costs there what it costs on mainnet.
- **Its era is Dijkstra**, protocol version 12. Plutus V1 to V3 still run, as long as a transaction uses none of Dijkstra's new features (sub-transactions, guards, direct deposits).
- **Its node's mempool** holds 4,178,176 bytes, about 16 EBs. A Praos node's holds two blocks, which is what the wallet's window of four in flight was sized for (`pumpChain`).

## What the numbers say so far

Full tables from `numbers`, `dijkstra` and `model`. The live runs' results go here once they're in.

**The wallet's transactions don't decode in Dijkstra as built.** Checked against the node's own decoder (`live decode`):
- Every script transaction (each Seedelf spend, each Lovejoin mix, a pool's launch, a withdraw) is refused: "List encoding of redeemers not supported starting with PV 12". Pallas 0.35's txbuilder writes redeemers as a list, and so does core's zero-withdrawal patch.
  - Written as a map, with the script data hash computed again, they decode. The map is a byte longer a redeemer, which is 44 lovelace a redeemer, and every script still passes within what it declared.
  - The harness mends them after the fact (`dijkstra.rs`). In core it would be a step of `Patches`, before `settle` prices the draft.
  - A Lovejoin withdraw can't be mended after the fact: its proofs bind every output, so only core building it as a map can do it.
- A pool's launch is refused for its certificate too: "Certificates without deposits are no longer supported". Core registers `mix_logic` with Shelley's certificate 0, which Dijkstra drops.
  - Conway's certificate 7 takes its place. It needs the credential's witness, so `mix_logic` runs under its publish purpose, which Lovejoin's script allows (`RegisterCredential` only).
  - The harness registers it on its own first (built by `cardano-cli`), then launches with nothing to register.
- A deposit runs no script and decodes as it is. The public account's staking certificates (7, 8, 11, 12) are all in Dijkstra.
- So the Pallas update, when it comes, is a CLI release and a web wallet release (the owner, 2026-10-28: much later).

**Throughput: Leios helps Lovejoin most, and steps are why.** A 3-wide mix is 5.79 billion steps and 2,657 bytes; a 4-wide one 9.87 billion and 4,072 bytes.
- An RB takes 3 or 2 of them. A Musashi EB takes 34 or 20, by steps, whatever its bytes. That's 6.3× and 5.6× mainnet's mixes a second: 0.95 and 0.56 a second against 0.15 and 0.10.
- A transaction's limits are mainnet's, so a mix is still at most four boxes wide.
- At CIP-164's own simulated parameters (2,000 billion steps an EB), a 3-wide mix is capped at 256 an EB by the 1 MiB of reference scripts a block may read, not by steps.

**A 4-mix chain across RBs and EBs** (`model`; the chain is a deposit and its box fanned out two waves deep, three wide: four mixes):
- On an idle chain it lands in 2 RBs on Praos and on Musashi alike. The first RB takes the deposit and three mixes, and the fourth goes in that RB's EB: certified or not, it reaches the ledger at the next RB.
- Four wide (five mixes), sent whole, Musashi takes 2.5 RBs on average to Praos's 3.
- Under load, the wallet's window of four is slower on Leios than on Praos. A certifying RB carries nothing new, so what's sent after an EB is announced waits for the next one. Sending the whole chain at once, which a Leios node's mempool can take, puts it back ahead.
- IO's own load, about 2× Praos's bytes, is close to Musashi's capacity at genesis's EB size: what a chain waits for there is the queue in front of it.
