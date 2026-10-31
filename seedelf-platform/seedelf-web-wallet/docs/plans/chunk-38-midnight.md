# Chunk 38 · Midnight

Branch `web-wallet/midnight`, from `main`.

**Status: ⬜ planning.** Nothing is built yet. This file says what Midnight is for this wallet, how it would fit, the steps, and the calls the owner has to make first. The work runs over several releases. Each step below gets its own branch, `web-wallet/midnight-<step>`, and its own PR from `main`, as chunk 26's three parts did, and ships in the next release after it lands.

**What the owner asked (2026-10-30):** "A potential big feature for 1.8.0 could be the basis for midnight support. Lace does it already. … This would be a fairly big feature that would probably spread multiple versions until feature ready. … when its done its private, public, and midnight or something. It would be the next big thing."

- **It adds; it doesn't rework.** The private balance and the public account stay as they are. Midnight is a third part beside them, with its own keys, chain data, transactions and screens. The few places where it meets them are listed in [Where it touches the wallet](#where-it-touches-the-wallet).
- **It reverses two settled lines, on the owner's own call.**
  - [post-release-roadmap.md](../archive/post-release-roadmap.md) listed Midnight as "Cardano only for now", in the parity table and under *Not planned*. Both now point here.
  - [architecture.md](../architecture.md#what-we-borrow-from-lace) takes "nothing for Bitcoin or Midnight" from Lace. That line changes once the owner decides what we read from Lace's Midnight code (call 7). Its licensing rule stays: Lace's repository is Apache-2.0, whatever its packages' `package.json` files say.
- **We won't be first.** Lace (since 2.0.0), 1AM, Gero and Ctrl already pair Cardano and Midnight in one extension. What we can offer that they don't is a privacy-first Cardano side next to Midnight's shielded one.

## What Midnight is, for this wallet

Checked on 2026-10-30 against Midnight's docs and release notes, the wallet SDK's source, Lace's source, and the chain. [Sources](#sources) lists them. Midnight changes fast, so 38a checks this section again before anything is built on it.

- **Mainnet is live, run by a fixed set of operators.** Its genesis block was 17 March 2026. Mainnet, Preprod and Preview all run ledger 8 on node 1.0.400. A ledger 9 hard fork is coming, with no published date. The SDK's 2.0 line, still in release candidates, carries both ledgers.
- **NIGHT** is 24 billion tokens, minted on Cardano: policy `0691b2fe…af1fa`, name `NIGHT`. On Midnight it is always **unshielded**: holding it at a shielded address doesn't hide it.
  - **The bridge from Cardano to Midnight isn't on yet.** The node's release notes call it "not enabled", and inert until a governance action switches it on. So a holder's NIGHT stays on Cardano for now.
  - Our bundled token list already carries mainnet NIGHT, so the public account shows a holder's NIGHT today.
- **DUST pays every Midnight fee.** It is shielded and can't be transferred. NIGHT generates it, up to about 5 DUST per NIGHT under the first parameters, refilling over about a week, and it decays once that NIGHT is spent.
  - **cNIGHT (NIGHT on Cardano) generates DUST once its stake credential is registered against a DUST public key.** That registration is a transaction on Cardano. Generation starts about 12 hours later, and the NIGHT never moves.
  - Midnight's node watches Cardano through db-sync (`pallet_cnight_observation`). It creates one DUST output for each cNIGHT UTxO at an address with that stake credential. It skips addresses with no stake part, and allows one registration per credential.
- **Shielded tokens:** tokens other than NIGHT can be shielded (Zswap). No token converts between shielded and unshielded.
- **Every transaction needs a zero-knowledge proof.** The fee is paid by a DUST spend, and a DUST spend carries a proof, so even an unshielded NIGHT transfer needs a prover. A shielded spend needs one as well. See [Proofs](#proofs).
- **So on mainnet today, a Cardano wallet can do one thing for Midnight on its own:** register its cNIGHT for DUST. That needs no Midnight service and no proof. Everything after it (reading DUST, using it with Midnight dApps, sending shielded tokens) needs Midnight's data and a prover.

## What Lace does

We have Lace 2.4.2 checked out (`_reference/lace` at `e431933`). 2.5.0 came out on 29 October 2026 with **Generate DUST from NIGHT**, and 38a pulls it. Lace's Midnight code lives in `packages/contract/midnight-context`, `packages/module/{blockchain-midnight,midnight-sync,dapp-connector-midnight,midnight-host-pull}`, `packages/lib/cnight-dust-designation` and, in 2.5.0, `packages/lib/midnight-prover`.

- **The SDK.** Lace uses `@midnightntwrk/wallet-sdk` 1.2.0: its `/facade`, `/shielded`, `/unshielded`, `/dust` and `/hd` entry points, with `-abstractions`, `-address-format` and `-hd` beside them. It also uses `@midnight-ntwrk/ledger-v8` and `@midnight-ntwrk/dapp-connector-api` 4.0.1.
  - Since 1.2.0, `@midnightntwrk` (no hyphen) is the wallet SDK's scope. `@midnight-ntwrk/wallet-*` is a deprecated alias that lags behind. The ledger and the connector keep the hyphen.
  - Some of Lace's pins are betas of the 2.0 line.
- **Keys come from the same phrase.** `HDWallet.fromSeed(bip39.mnemonicToSeed(phrase))`, then `selectAccount(i).selectRole(role).deriveKeyAt(0)` for three roles: `Zswap`, `NightExternal` and `Dust`. Each key is sealed under the password.
- **Its services.** The indexer and the node go through IOG's Blockfrost proxy for Lace (`blockfrost.lw.iog.io/midnight-{mainnet,preprod,preview}/`, and `…-rpc/` for the node).
  - The proxy adds Blockfrost's project key on the server: "no config carries a `projectId`" (`packages/lib/cardano-provider-core/src/blockfrost-config.ts`, citing an audit, LW-14499). Lace's Cardano reads use the same proxy.
  - The addresses are feature flags (`apps/lace-extension/src/feature-flags.ts`), so IOG can move them without a release.
  - **The proof server is `http://localhost:6300` on every network, mainnet included.** The user runs one on their own machine, and a banner tells them when it's missing.
  - 2.4.0 removed the remote proof server option. 2.5.0's source adds a WebAssembly prover that runs in an offscreen document, and a remote prover inside a trusted execution environment (TEE) behind a feature flag. We haven't checked which of these 2.5.0 turns on by default.
- **Generate DUST.** Lace builds the registration on Cardano, from the Cardano account, after Midnight's reference dApp (`midnightntwrk/midnight-cnight-to-dust-dapp`) and its validator (`cnight_generates_dust` in `midnightntwrk/midnight-reserve-contracts`). Lace's README for this code warns that Midnight's indexer only recognises a datum byte for byte as the reference dApp writes it. [38b](#steps) has the transaction.
- **The connector** is `dapp-connector-midnight`, on the connector API 4.0.1, with its own provider of a dApp's circuit keys (`dapp-zk-config-provider.ts`).

## How it would fit

```
Seedelf Wallet, one phrase
├─ Private   the Seedelf balance (Cardano)     unchanged
├─ Public    the CIP-1852 account (Cardano)    unchanged, plus Generate DUST for its NIGHT
└─ Midnight  unshielded, shielded, DUST        new: its own keys, sync, sends and connector
```

### Keys

- **A third key tree from the same phrase.** In [keys-and-accounts.md](../keys-and-accounts.md), "One phrase, two key trees" becomes three.
  - **The path:** `m/44'/2400'/account'/role/index`, standard BIP-32 over secp256k1, from the phrase's BIP-39 seed, exactly as Lace calls it. Account and the levels above it are hardened; role and index aren't.
  - **The roles:** 0 NightExternal, 1 NightInternal, 2 Dust, 3 Zswap. Role 4 is Metadata in SDK 1.2.0 but EcdsaUnshielded on the SDK's main branch.
  - **Each role's 32-byte key seeds that role's keys.**
    - NightExternal: BIP-340 Schnorr on secp256k1.
    - Dust: a BLS12-381 scalar, whose public key is its Poseidon hash.
    - Zswap: a coin key and a JubJub encryption key.
  - **Restoring elsewhere:** because we derive as Lace does, the phrase restores the Midnight side in Lace, as it already restores the public account there.
- **The trees stay independent.** Each comes from a different function of the phrase:
  - Cardano's starts from the BIP-39 entropy (Icarus, Ed25519-BIP32);
  - Seedelf's is HKDF-SHA-256 over the BIP-39 seed, with its own salt;
  - Midnight's is BIP-32 over the same seed, on another curve.
  - Knowing one tree's keys gives nothing about another's. 38a confirms this against the SDK's code, not its names.
- **Still one recovery phrase.** There's no second phrase, and no import of a Midnight-only seed (Lace allows one; we don't need it).
- **Once shipped, the Midnight derivation is frozen,** like `derivation.rs` v1, because users' Midnight money depends on it.
  - We pin vectors: one test phrase's keys and addresses, for each role and each network, checked equal to Lace's.
  - A later SDK that derives differently fails them.
- **Addresses** are bech32m: `mn_addr`, `mn_shield-addr` and `mn_dust` on mainnet, with `_preprod` or `_preview` appended on the test networks.
- **Accounts:** Midnight account *i* goes with the wallet's account *i*, one at a time, as the public account has since chunk 18. That's Lace's model too.

### Where the code runs

- **The SDK is TypeScript over wasm-bindgen WebAssembly.** It runs in a browser: it has no `node:` imports, but it needs `Buffer` and `assert` polyfills, and it uses no SharedArrayBuffer.
- **Sizes:**
  - ledger 8's WebAssembly is 10.4 MB, 4.7 MB gzipped;
  - the prover (`zkir-v2`) is 1.97 MB, 0.68 MB gzipped;
  - so the zip goes from 2.10 MB (1.7.1) to about 7.5 MB;
  - the SDK's 2.0 line ships ledger 9 as well (11.0 MB unpacked).
- **All of it ships in the zip,** because the Web Store allows no remote code. It goes in a chunk of its own, loaded only once Midnight is turned on, so a wallet that never turns it on runs as it does now.
- **Sync** is a long-running WebSocket stream plus trial decryption in WebAssembly.
  - The worker dies after about 30 s idle, so sync must resume from saved state on every wake.
  - Chrome keeps a worker alive while its WebSocket is active, and the SDK's notes say its node client opens its socket only when needed, "to prevent service worker timer leaks". 38a measures how it behaves.
- **Proving can't run in a Worker started from the service worker,** because a service worker can't start one. The SDK's WebAssembly prover needs a Worker, so it would run in an offscreen document (`chrome.offscreen`, reason `WORKERS`), as Lace 2.5.0's does.
  - **That would be the first place other than the worker to hold a secret.** [architecture.md](../architecture.md#shape) says the worker is "the only place secrets ever exist", and a proof needs the coin key or the DUST key.
  - The other way is to call the prover on the worker's own thread, which blocks the worker for as long as the proof takes. 38a tries both, and call 4 is the owner's.
- **CSP:** wasm-bindgen's glue code has a `new Function(...)` fallback. Our CSP allows `wasm-unsafe-eval` but not `unsafe-eval`, so 38a checks that this fallback never runs.

### Data

- **Midnight no longer hosts the mainnet and Preprod endpoints.** It retired its own on 30 September and 9 October 2026, and they now answer HTTP 410.
  - **Blockfrost serves both, and every request needs a project token**, issued for one network.
  - Only Preview stays Midnight-hosted, with no token.
  - A token shipped in the extension is public to anyone who unzips it, and Blockfrost doesn't publish its plans' rate limits.
- **What sync tells the indexer** (SDK 1.2.0, read at `7365f98`):
  - **Shielded and DUST sync send no key.** They subscribe to the whole event stream (`zswapLedgerEvents`, `dustLedgerEvents`) and decrypt in the wallet (`shielded-wallet/src/v1/Sync.ts`).
    - The indexer does offer `connect(viewingKey)`, which Midnight's docs warn hands over the user's whole shielded history for good. The SDK's wallet never calls it, and neither will we.
  - **The default history service gives the set away.** For each transaction that changed the wallet, it looks the transaction up by hash (`getTransactionDetails`, `shielded-wallet/src/v1/RunningV1Variant.ts`). That tells the indexer exactly which shielded transactions are the user's, tied to their IP address.
    - The SDK lets us replace the service (`withTransactionHistory`), and we will: ours reads what the events already hold and asks nothing.
  - **Unshielded sync asks by address,** as Koios is asked for the public account.
  - **A new wallet reads every event since genesis.** How much that is on mainnet hasn't been measured (38a).
- **Where the data comes from** is call 2: our own Midnight node and indexer, Blockfrost through our server, or the user's own token.

### Proofs

- **A prover sees everything.** For a shielded spend, its input includes the coin's secret key (`zswap/src/construct.rs`), and a fee's DUST spend includes the DUST secret key.
  - A remote prover is custody. Midnight recommends against one outside a TEE, the Midnight Foundation's hosted prover is gone, and Lace removed its remote option in 2.4.0.
  - **We never offer a prover of ours.**
- **Two ways keep the keys on the user's machine:**
  - **a local proof server** (Docker, `localhost:6300`, Lace's default). It has no auth and no TLS, and it answers any origin. Most users won't run Docker;
  - **the WebAssembly prover** (`makeWasmProvingService`, `zkir-v2`), run in a Worker.
- **What it costs, measured:** one Zswap output proof took 26 s and about 400 MB in Node 24 on an i5-12400F.
  - A transfer needs at least one spend, two outputs and a DUST spend, which is likely minutes in WebAssembly. 38a times a whole one in the browser.
  - Midnight's docs saw about 1.5 GiB for a large circuit in the proof server.
- **The proving keys are about 28 MB, fetched at the first proof:**
  - spend 11.0 MB, output 5.7 MB, sign 2.8 MB, DUST spend 2.2 MB, plus the parameters (3.1 MB and 6.3 MB);
  - SDK 1.2.0 fetches them from an S3 bucket with no integrity check;
  - the SDK's main fetches them from `srs.midnight.network` with SHA-256 checks. That host sends no CORS headers, so we would need a host permission for it;
  - every user fetches the same public data, so the fetch says only that this IP address proves on Midnight. It's still a new host, with its own entry in the privacy policy;
  - we pin the hashes ourselves either way.

## Where it touches the wallet

- **The phrase:** onboarding, restore and Remove wallet don't change. The Midnight keys come from what's already there, and restore asks nothing new.
- **Home:** a third tab, **Midnight**, beside Private and Public, in the owner's words "private, public, and midnight".
  - Chunk 14 named the tabs Private and Public because both are Cardano ([architecture.md](../architecture.md#ui)). Midnight is another chain, so the tab takes its name.
  - Inside it we use Midnight's own words: *unshielded*, *shielded*, *DUST*. They name Midnight's things, so they don't clash with the private balance.
- **Settings:** Midnight on or off, and where its indexer, node and proof server are.
- **The public account:** **Generate DUST** for the NIGHT it holds, a Cardano transaction built in core beside staking ([38b](#steps)).
- **The connector:** Midnight's own API beside CIP-30, under the same rule: off until turned on, nothing injected before that ([38f](#steps)).
  - A page can see `window.midnight`, so turning it on makes the wallet detectable, as CIP-30 already does.
- **Networks:** the wallet's switch picks Midnight's mainnet, or its Preprod when on Cardano preprod. Preview and Preprod share one testnet cNIGHT policy, so Generate DUST can be tested end to end on preprod (call 3).

## Privacy

The rules stand as written ([privacy.md](../privacy.md), [development.md](../development.md#rules-for-a-change-to-the-screens)):

- the most private option is the default, and a costlier or leakier one is a visible switch;
- nothing new phones home without its own decision;
- every new host gets a dated entry in the privacy policy, in the PR that adds it.

What Midnight adds:

- **Generate DUST links the public account's stake key to a DUST key, on Cardano, for good.** The registration's datum holds both in the clear, which we checked on chain.
  - Anyone can tie the public account's history to that DUST key.
  - Whether Midnight then links the DUST *spends* to it hasn't been checked (38a).
  - The Generate DUST review says so in one line.
- **The private balance's NIGHT generates no DUST.** A Seedelf UTxO sits at the contract's address, which has no stake part (`address.rs`'s `wallet_contract`: `ShelleyDelegationPart::Null`). Midnight's observer skips such an address, so no one else can claim DUST from it either.
  - To generate DUST, NIGHT has to be made public first, and Make public's link applies.
  - The wallet says so where it matters and adds no guard: the owner's rule is to refuse only what the ledger refuses.
- **One IP address reads both chains,** so whoever runs both sets of services sees them together. That's us if we run Midnight's (call 2), as we already do for the private side ([the backlog](../backlog.md#network-privacy)'s Tor entry), and Blockfrost if it does.
- **The indexer and the prover** are covered under [Data](#data) and [Proofs](#proofs): no viewing key, no lookups by hash, and no prover of ours.

## Steps

Each step is a PR from `main` and ships in the next release after it lands.

1. ⬜ **38a · The spike.** No screens. It produces numbers and calls, recorded here, on a branch that may stay unmerged, as the Tor spike's did.
   - **The SDK in our build:** Vite, the worker against an offscreen document, the CSP, the zip's size, the licences (the SDK is Apache-2.0, and the ledger repository's licence is Apache-2.0 too).
   - **Keys:** the vectors, equal to Lace's for the same phrase.
   - **Sync on Preview** (no token needed):
     - the requests, and what each one sends;
     - the time for a first sync and for a resume;
     - surviving a killed worker;
     - the history service replaced.
   - **A whole transfer proved in the browser,** timed, with its memory, against a local proof server doing the same.
   - **Generate DUST on Cardano preprod,** built in core and checked with Ogmios's `additionalUtxo`, spending nothing, as `tests/fixtures/probe-staking.mjs` does for staking.
     - Its datum is byte for byte the reference dApp's and Lace's.
     - It matches a live mainnet registration.
   - **The data question, priced:** what a Midnight node and indexer need at home (hardware, and the db-sync connection the node follows Cardano through) against Blockfrost's plans.
   - **Lace 2.5.0 pulled:** its prover and its Generate DUST, read.
2. ⬜ **38b · Generate DUST from the public account** (the 1.8.0 candidate: "the basis"). It is the one thing a Cardano wallet can do for Midnight on mainnet today, and it needs no Midnight service and no proof.
   - **The Midnight keys and the DUST address** come with it, from the phrase, with their frozen vectors. The DUST key may need the ledger's WebAssembly, or a Rust crate of Midnight's in ours (38a decides).
   - **Register:**
     - mint one token under the script's own policy, with an empty name and redeemer `Create` (`Constr 0 []`);
     - pay it to the script's address with at least 1.58608 ₳, which comes back on Stop, and the inline datum `Constr 0 [Constr 0 [stake key hash], DUST key ≤ 33 bytes]`;
     - spend at least one cNIGHT UTxO;
     - name the stake key as a required signer.
   - **Change the DUST address:** spend the registration and add a zero withdrawal from the script.
   - **Stop:** spend it and burn the token (`Burn`, `Constr 1 []`).
   - **Mainnet's script** is `73e4aea31b5b51d9b0ca386196fc6a4c422f74c5aea011e4b8bdf4e5` (`addr1w9e7ft4rrdd4rkdseguxr9hudfxyytm5ckh2qy0yhz7lfeg9lvhq7`, with 3,885 registrations there on 2026-10-30). It's a pinned Plutus V3 script, like Lovejoin's templates.
   - **Built in core** on `build::account_staking`'s machinery: Pallas can't stage the withdrawal or the mint's redeemer, and `staking.rs` and `withdraw_zero.rs` already patch both. No Seedelf contract changes and no variant is involved.
   - **Finding the registration again:** it sits among everyone's at the script's address. On mainnet, a data-layer route reads it by its datum; the Koios fallback pages through the address (4 pages today), and the wallet keeps the one it sent. This is the step's Koios cost.
   - **On screen:** the public account's NIGHT, whether it's generating and to which DUST address, Change and Stop, and the review's one privacy line.
   - **What it can't show yet is the DUST balance.** That needs Midnight's data (38c), so the screen says when generation starts (about 12 hours) instead.
3. ⬜ **38c · A Midnight tab that reads.** Turn Midnight on. Receive shows its three addresses, Home shows the unshielded, shielded and DUST balances and the sync state, from the data source call 2 picks.
4. ⬜ **38d · Send on Midnight:** shielded tokens, and unshielded NIGHT once the bridge puts any there, with the fee paid in DUST and the proofs where call 4 puts them.
5. ⬜ **38e · Activity and Transaction details for Midnight:** decoded by us, with the raw bytes beside them, as for Cardano.
6. ⬜ **38f · Midnight's connector:** connector API 4.x (`connect`, the reads, `makeTransfer`, `makeIntent`, balancing, `submitTransaction`, `signData`, and `getProvingProvider`, so a dApp's proofs go through our prover rather than a URL it names).
7. ⬜ **Each release's own review** covers whatever Midnight steps it carries: the zip's size, the privacy policy's entries, and the store listing's text.

## What doesn't change

- **The Seedelf derivation** (frozen, v1), the CIP-1852 tree, and every Cardano flow: Make private, Make public, Send, staking, governance, Lovejoin, private sessions, and both CIP-30 connectors.
- **The data layer's Cardano routes,** and Koios as their fallback.
- **No hardware wallets** ([the proof](../backlog.md#why-hardware-wallets-cant-cover-seedelf)).

## The owner's calls

Each has a recommendation, which the owner can overturn.

1. **On for everyone, or off until turned on?**
   - **Recommended: off until turned on**, from the Midnight tab or Settings, as the connector is.
   - Until then, nothing of Midnight's loads, derives or phones home. The zip carries it either way.
   - 38b's Generate DUST sits on the public account and needs no switch: it's a Cardano transaction.
2. **Where mainnet's Midnight data comes from.** The indexer sees the unshielded addresses and the IP address, and the event stream is heavy.
   - **Recommended first: Blockfrost through our server.** A route on the droplet adds the token, as Lace's proxy does, so no token ships and Blockfrost sees our server rather than the user.
   - **Later: our own Midnight node and indexer,** behind the droplet as [seedelf-data](../../../../seedelf-data/README.md) is, so the no-log promise covers it as it covers the private side. What that takes, as of 2026-10-30 (no mainnet figures are published):
     - **The node reads Cardano only from db-sync's Postgres.** It needs db-sync 13.7.1.0, replayed, with `tx_in` filled, the ledger state on and no address table. At its first start it adds three indexes of its own to db-sync's tables.
     - **CPU and memory:** about 8 vCPU and 32 GB for the node (Midnight's archived guidance), and 5–12 GiB for the indexer (seen on Preprod).
     - **Disk:** about 200 GB for the node and 300–350 GB for the indexer, both on Preprod and both growing.
     - **Sync:** a re-index takes 3–4 days, and the node's first sync puts at least 18 hours of load on db-sync.
     - **Network:** P2P on port 30333, which should be reachable from outside.
     - **So it needs about 40–45 GB of RAM more** than home's 64 GB box carries today with the relay, db-sync, Kupo and Ogmios: more memory, or a box of its own.
     - Midnight calls its indexer "a reference implementation … not designed to be public facing", so it stays behind the API, as Postgres does.
   - A user's own Blockfrost token in Settings is the fallback for someone who wants neither. **Never a token in the zip.**
3. **The test network.**
   - **Recommended:** Cardano preprod maps to Midnight Preprod, through the same Blockfrost-on-our-server route, since home's preprod server belongs to another project.
   - Development uses Preview, which needs no token. The wallet still has no Cardano preview ([Lace parity](../archive/post-release-roadmap.md#where-cardano-parity-stands)).
4. **Proofs.**
   - **Recommended: the WebAssembly prover by default,** so keys stay on the machine and nobody needs Docker. A local proof server is a visible switch for speed.
   - **Never a remote prover.**
   - **This depends on 38a's numbers,** and on accepting the offscreen document as the one place besides the worker that holds a Midnight key, and only for a proof.
5. **1.8.0's scope.**
   - **Recommended: 38a and 38b.** Generate DUST is the one mainnet action open to a Cardano wallet today, and it needs neither of the hard calls (2 and 4).
   - 38c follows once call 2 is made.
6. **Which SDK line.**
   - **Recommended: 1.2.0** on ledger 8 for the spike, since it's what all three networks run.
   - **Then the 2.0 line** once it's stable, and before the ledger 9 fork, whose date isn't out.
7. **Lace as the reference for Midnight.**
   - **Recommended:** read `cnight-dust-designation`, the sync's setup and 2.5.0's prover, as architecture.md's table already does for Cardano. Anything copied follows the Apache-2.0 rule, and architecture.md's "nothing for … Midnight" line changes to match.
8. **The words.**
   - **Recommended:** the tab is **Midnight**, and inside it Midnight's own *unshielded*, *shielded* and *DUST*.
   - The private balance and the public account keep their names.

## Sources

Read on 2026-10-30.

- **Midnight's docs:** [networks and environments](https://docs.midnight.network/guides/networks-and-environments) (the retired endpoints, Blockfrost, Preview), [local proving](https://docs.midnight.network/guides/local-proving) (what a prover sees, remote proving), [run a proof server](https://docs.midnight.network/guides/run-proof-server), [DUST architecture](https://docs.midnight.network/concepts/dust-architecture), [tokens](https://docs.midnight.network/tokens/overview), [the connector API](https://docs.midnight.network/api-reference/dapp-connector), [the support matrix](https://docs.midnight.network/relnotes/support-matrix), and the indexer's [`connect`](https://docs.midnight.network/api-reference/midnight-indexer/operations/mutations/connect.md).
- **Midnight's blog:** the [launch](https://midnight.network/blog/midnight-network-is-live), the [March state of the network](https://midnight.network/blog/state-of-the-network-march-2026), and the [roadmap](https://midnight.network/roadmap).
- **Source code:**
  - `midnightntwrk/midnight-wallet` at `@midnightntwrk/wallet-sdk@1.2.0` (`7365f98`): `packages/hd`, `shielded-wallet/src/v1/{Sync,RunningV1Variant}.ts`, `docs/spec/Specification.md`;
  - `midnightntwrk/midnight-ledger` (`2843a0a`): `zswap/src/construct.rs`;
  - `midnightntwrk/midnight-node`: release notes for node-1.0.0, node-1.0.400 and node-2.0.0-rc.4, and `primitives/mainchain-follower/src/data_source/cnight_observation.rs`;
  - `midnightntwrk/midnight-reserve-contracts`: `validators/cnight_generates_dust.ak` and `aiken.toml`.
- **npm:** `@midnightntwrk/wallet-sdk` 1.2.0 and its parts, `@midnight-ntwrk/ledger-v8` 8.1.3, `@midnight-ntwrk/zkir-v2`, and `@midnight-ntwrk/dapp-connector-api` 4.0.1. The proof timing is from a scratch run of `zkir-v2` in Node 24.
- **Lace:**
  - `_reference/lace` at `e431933` (2.4.2): `packages/contract/midnight-context/src/const.ts`, `packages/module/midnight-sync/src/exported-modules/in-memory-wallet-integration/in-memory-wallet-integration-factory.ts`, `packages/lib/cnight-dust-designation`, and `apps/lace-extension/webpack/webpack-utils.js`;
  - its [releases](https://github.com/input-output-hk/lace/releases): 2.0.0, 2.4.0 and 2.5.0.
- **The chain:** Koios's `asset_info` for NIGHT, and the registrations at the mainnet script's address.
- **Running a node:**
  - Midnight's docs: [full node](https://docs.midnight.network/nodes/full-node.md) and [Cardano db-sync for Midnight](https://docs.midnight.network/nodes/cardano-db-sync.md);
  - `midnight-node` at `node-1.0.400`: `node/src/main_chain_follower.rs`, and issues #1983 (disk) and #2343 (db-sync load);
  - `midnight-indexer` at v4.3.7, and its issues #1272, #1417 and #1479.
