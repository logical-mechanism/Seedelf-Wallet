# Chunk 34 · Lovejoin token pools

1.6.0's feature (the owner, 2026-10-13). [Lovejoin PR #163](https://github.com/logical-mechanism/Lovejoin/pull/163) adds a token-mixing variant of the contracts: a launch pools one native token, and every box in it holds exactly `box_lovelace` ADA plus `Q` of `(policy, name)`.

**We launch no pools.** Seedelf users launch them from their private balance: they choose the token and pay the ADA for the launch and the reference scripts. They also carry their own bootstrap and movement problems.

**Why it matters:** today a token in a one-time account, or one coming back into a Seedelf, is never mixed, so under some circumstances it can be tied to its owner. With token pools, someone buying NIGHT or a stable token can mix it and go back into the mixer, the way ADA already does.

**Status: 🚧 the groundwork, design session 1, 34a′, 34c, 34d, 34e and 34f are done; [34g](#34g--the-preprod-rehearsal-and-the-release-2026-10-18-in-progress), the preprod rehearsal and the release, is under way (its *Start here*).** The plan went through two rounds of the owner's questions on 2026-10-13.
- **The groundwork** (`web-wallet/token-pools-groundwork`, 2026-10-17) did every step that needs no more design: S0a, S0b, S0d, S0c's evaluation, 34a and 34b, core and WebAssembly. Nothing in the worker uses them yet. What it built and found is under [The groundwork](#the-groundwork-2026-10-17).
- **The design sessions** (the owner, 2026-10-17: "the biggest back n forth we will have will be how this all looks for the ux ui and how we handle the pool discovery part") run on `web-wallet/token-pools-design`. **[Session 1](#design-session-1-2026-10-17)'s calls override the sections below** wherever they differ, until a later session folds them in. Still to settle: its *Still open after session 1*, each small and owned by a step. The design is otherwise ready for the steps: 34a′ and 34c first.
- **[34a′, the records](#34a--the-records-2026-10-17)** (`web-wallet/token-pools-records`, 2026-10-17): every pool's records beside the classic pool's, every mix followed until its boxes are back, Bootstrap's boxes held, gated on 1.5.0's own record of how it planned and ran.
- **[34c, discovery and the data layer](#34c--discovery-and-the-data-layer-2026-10-17)** (`web-wallet/token-pools-discovery`, 2026-10-17): which pools are shown and how the wallet finds them, the data layer's copy of the rules, its pool list, crowds and combined box feed. The server's queries wait on one live run against home's db-sync, which the owner starts.
- **[34d, the flows](#34d--the-flows-2026-10-18)** (`web-wallet/token-pools-flows`, 2026-10-18): the tile's mixes into a token pool from either side, Bootstrap in place of the seed, a pool's start from either side and every check before it, the escape hatch, and Activity's names. Worker, core and WebAssembly; the screens are 34f's.
- **[34e, the planner](#34e--the-planner-returns-through-token-pools-and-four-boxes-a-mix-2026-10-18)** (`web-wallet/token-pools-planner`, 2026-10-18): each pool's costs, a return's tokens through their own pools beside its ADA's in one chain, Change, a swap that funds its token's boxes (33), and four boxes a mix with its fallback to three. Worker, core and WebAssembly; the screens are 34f's.
- **[34f, the screens](#34f--the-screens-2026-10-18)** (`web-wallet/token-pools-screens`, 2026-10-18): Lovejoin's page as a hub with a page per pool, Your mixes, the pools grouped by token, Start a pool, the escape hatch, Bootstrap leading below the floor, Change on reviews, the swap approval's funded token boxes (34e's release blocker), Settings' four boxes a mix, Home's row per pool, the strings in es and ja, and the docs.

**Read first:**
- PR #163's own write-up: `docs/generalize-lovejoin.md` and `docs/perf.md`, on Lovejoin's `main` since the merge (8131b1d).
- [chunk-16-lovejoin.md](../archive/plans/chunk-16-lovejoin.md), the original integration and its decisions.
- The Lovejoin sections of [architecture.md](../architecture.md), [flows.md](../flows.md) and [privacy.md](../privacy.md).
- [chunk-26b-data-layer-wallet.md](../archive/plans/chunk-26b-data-layer-wallet.md), on how the wallet reads the pool today.

## Design session 1 (2026-10-17)

The owner's answers to Claude's first proposal. Where they differ from the sections below, these win.

### Decided

1. **Pools are permissionless.** Anyone may launch a pool of any token, at any amount: "it's not me determining what token deserves a pool".
   - This replaces 2026-10-13's direction of listed tokens only: [D1](#d1--pool-spam-and-sync)'s A, and i's one amount per token.
   - A token may have several pools, one per amount: a 10 $ and a 100 $ stable pool, say.
   - **The pool's creator sets Q.** The wallet offers bounds, never a choice of its own.
   - Round three narrows the tokens to the wallet's token list (20).
2. **Discovery is live.** A pool launched after a release must show up without one.
   - Releases are rare. Waiting on the owner to list a pool would also make the owner the judge of what's real: "not that decentralized".
   - A list bundled at packaging is only a head start, and never decides what's real.
3. **Verifying a pool needs no contract change.** The owner asked whether the datum should carry the seed, so that the hashes could be reproduced locally. They already are:
   - M, L and F come from P through the pinned templates, and P comes from its seed ([§2](#2-trusting-a-pool-verify_pool)).
   - The seed is the launch transaction's spent input. It's read once per pool and checked by a hash, so whoever supplies it needn't be trusted.
   - A seed in the datum would save that one read, at the cost of a new contract version.
4. **The Lovejoin page becomes a hub:** your mixes, then the pools, with the most used first.
5. **Your mixes: one list, followed to the end.** It shows every mix, from either side and in any pool, from its funding until its last box is back.
   - Each card says enough to tell which mix it is.
   - Within a pool, a box that comes back counts against the pool's oldest open mix, since mixed boxes are interchangeable.
   - 34a′'s records follow from this: a public mix's record stays until its boxes are counted back.
6. **Bootstrap** is a button that sends a number of boxes, at the pool's value, into the pool with no fan-out.
   - The boxes never come back by themselves. The user brings them back by hand, one at a time.
   - "The bootstrap is very important and must be done."
7. **The gate stays a floor of 30 boxes not yours, for now**, with the crowd stated plainly. The owner's thought, still to explore: "the floor exists after some bootstrap event".
8. **Four boxes a mix ([D3](#d3--four-boxes-a-mix-as-an-option)) is a Settings option.** Three stays the default. D3's fallback to three comes with it.
9. **Cert 0** registers L ([Still open](#still-open) 5), and the first real preprod launch confirms it.
10. **A launch is paid from the private balance by default.** The public account may pay instead, as the user's choice to show that link, the way the wallet allows it elsewhere.

### Decided in round two

Claude's second proposal, with the owner's answers.

11. **A pool is shown when it's genuine and finished, and the earliest for its values.**
    - **Genuine proves it's a real Lovejoin pool:** the derived hashes and the seed proof ([§2](#2-trusting-a-pool-verify_pool)).
    - **Finished is the price of being shown:** its `mix_box` and `mix_logic` reference scripts sit at the holder, and L is registered.
      - That's about 21.4 ₳ burned for good, beyond a bare pool's 2.1 ₳. The scripts differ for every pool, and `mix_logic` refuses deregistration (it allows `RegisterCredential` and nothing else).
      - So a junk pool costs about 23 ₳, gone for good.
      - Every pool the wallet launches is finished.
    - **Earliest for its values,** `(token, Q, box ADA)`. A copy is never shown.
      - The fee cap doesn't count: only `fee_contract` reads it (`self.fee <= max_fee_per_mix_lovelace`, line 171 at 8131b1d), and the wallet never uses it.
      - Someone who launches a pool's values first does no harm. Same values mean the same scripts, and finished means it's ready.
    - **None of this can be undone,** so a shown pool stays shown. The read set only grows, and no one's boxes drop out of view.
12. **The holder is the index.** Every launch puts its reference UTxO at `288fea77…`, which takes no parameters, so discovery watches that one address.
    - The data layer reads it from db-sync. Koios reads it bit by bit: the address's transactions after a block height.
    - Everything at the holder is locked for good, so spam there is burned, not parked.
    - The list bundled at packaging (`npm run lovejoin-pools`) is a head start: the shown pools' seeds and references, so a first sync skips their lookups.
13. **The hub groups pools by token.**
    - The tokens you hold come first, known without a read. Then come the most used, counted as boxes not yours.
    - Each pool shows its numbers, never a "top" badge, since parked boxes can buy rank.
    - Search by ticker or policy. Only the token list's tokens have pools (20).
14. **The creator sets Q, and may change the box's ADA within limits.**
    - **Q** is entered in display units.
    - ~~**Thirty boxes' worth (30 × Q)** must fit within the token's total supply.~~ Dropped by the owner's call 35 (2026-10-19): a typo guard nothing on chain needs, which cost a request naming the token. Q's only bound is the ledger's.
    - **The form lists the token's existing pools** with their crowds, so a creator can join one rather than split it.
    - **A copy of a shown pool's values is refused.**
    - **Mixing's cost per box is said plainly.** The wallet prices only ADA (`prices.ts`), so no bound is in money.
    - **The box's ADA:** the wallet suggests the optimum, the least for the token's shape plus a margin, rounded up to 0.5 ₳. That's 4.5 ₳ for every token S0d measured.
      - The creator may change it ("there is a lowerbound to the ada because of the token and datum").
      - The lower bound is S0d's: a box must come back and then pay part of its token on its own, under the live parameters.
      - The upper limit is 9 ₳ (27).
15. **Returns default to the token's most used pool that can take a box.**
    - **Change** picks any other pool of the token that works, or skips it, as reviews already allow.
    - "There are going to be a single pool for most tokens so this will probably be a none issue."
16. **Bootstrap at its best is many users each putting in many boxes:** "N users depositing k boxes, where N and k are as large as possible".
    - A creator doing 30 alone is fine, and "a group getting together" can do a proper bootstrap.
    - The gate stays 30 boxes not yours.
    - **The crowd line counts deposits as well as boxes,** for example "30 boxes, from 1 deposit, none mixed yet".
    - Claude's addition: a pool below the floor shows how its bootstrap is going, with Bootstrap as its main button, so a group can see it fill.
17. **ADA pools on the new contracts are allowed, at any amount but 10 ₳.** `one_shot_mint` accepts an ADA-only datum (an empty policy and name, `Q = 0`).
    - The classic pool keeps 10 ₳, bundled and still an option.
    - The wallet never launches a 10 ₳ ADA pool. One made elsewhere is a copy of the classic's value and is never shown (Claude's reading of "prevents making another 10 ada pool").
    - This replaces [backward compatibility](#backward-compatibility-with-the-classic-ada-pool) 2's old rule.
18. **Bootstrap replaces the seed** ("Help start the pool"). Seed boxes already in a pool still come back by themselves. It's to be tried and iterated: "this may just need some testing to figure out the best strat".

### Decided in round three

The owner's answers to Claude's remaining questions.

19. **It all ships as 1.6.0.** The steps can land as parts, but 1.6.0 is the release that carries token pools: the owner has said so publicly. Nothing ships until it's all done.
    - Claude's note: main serves the privacy policy live, so the policy's *Changes* entry for the new reads goes in with the PR that releases 1.6.0, not with an earlier part.
20. **Only tokens in the wallet's token list can have pools,** for launching and for showing. A token pool's token must be in the bundled `tokens/list.json` for its network. ADA pools need no token.
    - "Then fake tokens are not there", and the list already holds the high-volume tokens. A new token waits for a release that lists it.
    - Otherwise pools stay permissionless: any amount, several a token, and anyone may launch one.
    - Lookalike marks become moot for pools.
    - The preprod rehearsal's test token goes into preprod's list, as an `unregistered` entry, which test networks allow.
21. **A creator needn't hold the token:** "a creator can just be a creator if they want to be". The list gives its decimals.
22. **Only standard pools are shown:** "A user not following this standard should not be shown." A standard pool is genuine, has its scripts at the holder and L registered (11), and its token is listed (20). The extension is the guardrail for how pools are made.
    - The standard holds on every network. The owner leaned that way and Claude agrees: preprod rehearses mainnet's exact rule.
    - So PR #163's dev pool on preprod (`c5852bb7…`, its scripts at a key address) isn't shown. Preprod's first standard pool is the one the rehearsal launches.
23. **Launching and bootstrapping stay separate.** A creator may only create, a bootstrapper only bootstrap, or someone may do both. The launch's review offers Bootstrap next, and never forces it.
24. **Bring them all back** sits beside bringing one back. The wallet spaces the boxes out as normal returns are spaced: one box a run, at random delays, never in one transaction. It's to be tried for its UX.
25. **Four boxes a mix on every pool,** the classic too.
26. **Looking for new pools:** Koios is asked when the hub opens; the data layer, at every refresh.
27. **The box's ADA tops out at 9 ₳ in a token pool. An ADA pool has no upper limit:** its box ADA is its amount, and "a user could create large pools".
28. **The Seedelf minimum stays as it is** ([Still open](#still-open) 9): the suggested 4.5 ₳ already allows for it.
29. **The preprod tests are dual.** Claude runs them in dev mode, the launch included, from the private test wallet. Then the owner tries them by hand, perhaps bootstrapping Claude's pool: Claude's automatic run, then the owner's manual one.

### Decided at 34c (the owner, 2026-10-17)

30. **"Finished" is finished by its launch.** The launch transaction itself puts `mix_box` and `mix_logic` at the holder and registers L, unless L was registered in an earlier block. "Earliest for its values" is then the earliest launch: by block, place in the block, then id.
    - So a pool's standing is final the moment it's found: never checked again, never displaced. A shown pool stays shown.
    - Every launch the wallet makes qualifies. A pool finished later, in another transaction, is never shown.
    - Claude's reason: "first to finish" needs every event's place on chain and re-checks unfinished pools forever, and "earliest launch, shown once finished" lets a bare 2.1 ₳ launch hold a value.
31. **Deposits are counted as possible origins.** A pool's crowd is every deposit some box in it now could have come from: a mix's boxes could be any of its inputs. A deposit whose boxes have all left, mixed or not, no longer counts. The data layer works it out (mainnet); on Koios the crowd line shows boxes alone.
32. **Core keeps its own copy of the rules.** The data layer's copy is its own (`seedelf-data/api/src/lovejoin/`), and nothing new is published for the CLI. The two are held to shared vectors and scenarios. This replaces [§10](#10-the-data-layer-mainnet-deployed-before-the-wallets-upload)'s small shared crate.
    - The owner asked for an explanation first. The trade: one copy would need `seedelf-lovejoin` published before core at the next CLI release; two copies can disagree where the vectors don't reach.

### Decided at 34e (the owner, 2026-10-18)

33. **A swap that buys a token a pool takes funds its boxes,** on by default. Without it, a swap's return holds only its 2 ₳ margin beside the token, so no swap's proceeds would ever go through a token pool. Its review adds the ADA the proceeds' boxes take (each box's own ADA, which comes back with it, and its mixes' fees, which don't), apart from the swap's own funding; Change picks another pool of the token, or none. Claude asked; the owner chose it.

### Still open after session 1

Each is small, and the step named settles it.
- ~~Whether a chain's view says which width it went at~~: it does (34e, `width`). The words for four boxes' fallback to three are drafted (`lj.width.warn.*`); where the screens show them is 34f's.
- ~~The screens in detail (34f)~~: built ([34f](#34f--the-screens-2026-10-18)); the owner's look at them, with the style pass after parity, may move them.

## The owner's calls this builds on (2026-10-13)

1. **The contracts are more or less frozen:** "nothing is really wrong with them explicitly".
   - **The fee contract doesn't matter to the wallet.** Its private flow never uses fee shards, so the contract's N ≥ 3 junk-input issue needs no work here.
2. **4 ₳ a box** in the pools the wallet launches, "but we may need to come back to this one with a provable test showing what exactly it has to be for this flow".
   - The owner chose 3 ₳ first. Then the review found that a 3 ₳ box comes back as about 2.70 ₳ plus Q, which can't pay for a partial token send on its own (about 3.39 ₳), so the send would co-spend another UTxO.
   - Step S0d is that test. Its answer (2026-10-17): 4 ₳ covers a typical token with 1.7% to spare, and not the worst a launch can name. The table is under [The groundwork](#the-groundwork-2026-10-17); the figure is the owner's to choose.
3. **Reference scripts at the holder, `mix_box` and `mix_logic` only.** About 23.3 ₳ that never comes back, plus the fee:
   - `mix_logic`'s reference, 15.82 ₳;
   - `mix_box`'s, 3.63 ₳;
   - the reference UTxO, about 1.84 ₳;
   - the stake deposit, 2.00 ₳.

   `fee_contract` is not published.
4. **Pool spam needs careful discussion:** "a rich bad actor … creating an overwhelming amount of bs pools just to slow down the sync".
   - The direction: **listed tokens only**, "as we can do it by volume of trading".
   - Also: "the pool discovery page might be an easy way to filter nonsense or spam pools". The earliest pool per listed box value "will probably work here".
   - Still open: "how many pools can exist for that single token". And "pool creation will be on the user and not the wallet this time". See [D1](#d1--pool-spam-and-sync).
5. **Bootstrap needs a review for every pool, ADA too:** "even 30 does not really cut it".
   - The direction: **Bootstrap a pool, at any time.** "A user can just bootstrap a pool on their own knowing they won't come back automatically unlike just using the pool." See [D2](#d2--bootstrap-and-the-crowd-for-every-pool).
6. **Mainnet's check is preprod's:** "test on preprod as that is free, then make sure it works. That way mainnet would be good to go." No real-money test; the full preprod rehearsal gates launching on mainnet.
7. **Backward compatibility with the existing ADA pool comes first.** "New ada pools will probably not be created at this moment."

## Backward compatibility with the classic ADA pool

Nothing a 1.5.x user has, or relies on, moves. Each point is a test or a gate, not a hope.

1. **The classic pool stays as it is.** Mainnet's `c145c10f…` and preprod's `67ffe4ed…` stay bundled, as `Pool::classic`, which is today's `Protocol::of`. They keep the same hashes, reference UTxOs and 10 ₳. Every builder's output for them stays byte-identical. `lovejoin_mainnet_test.rs`, `withdraw_zero_test.rs`, `lovejoin_test.rs` and the WebAssembly mainnet tests pass **unedited**.
2. **The classic pool keeps 10 ₳.** ADA pools on the new code are allowed at any other amount ([session 1](#design-session-1-2026-10-17), 17). The wallet never launches a 10 ₳ ADA pool, and one made elsewhere is a copy of the classic's value, never shown. (Until session 1: "an ADA pool on the new code is never shown, read or used".)
3. **A return or a mix with no tokens plans exactly as 1.5.0 does.** A regression test runs 1.5.0's planner cases through the new planner and compares the plans byte for byte: the deposits, the fan-outs, the costs on the review. Token boxes only ever add to a plan.
4. **Every record written before still reads, and means the same.** A record without a `pool` is the classic pool's. That covers:
   - the sealed `lovejoin.<network>` Schedule (due times, `notMixed`, `unsure`, `Withdrawing`), and chain records;
   - `lovejoinMaybe`, `SESSION_LOVEJOIN_PUBLIC` and `…SENDING`;
   - `spent.ts`'s reservations, and the session and auto records.

   The upgrade test takes a 1.5.0 vault mid-flight (a chain in flight, a withdraw in its write-ahead slot, boxes due) and checks that it all finishes after the update as it would have before.
5. **Classic boxes keep coming back on time across the update:** the same delays, one box a run, the same quiet times. Nothing redraws a due time already drawn.
6. **The data layer keeps 1.5.x working.**
   - `lovejoin/pool` and `/since` keep their shape and data, and Kupo's patterns stay.
   - New routes go beside them.
   - The API is deployed before the wallet that reads them is uploaded.
7. **The classic pool's screens read as today.** A user who never touches a token pool sees the same words and numbers. The "10 ₳" strings take the pool's value, and English stays byte-identical for the classic pool, chunk 19's rule. The Settings switch keeps its meaning, and Activity's **Into Lovejoin** and **Lovejoin mix** stay.
8. **A restore finds classic boxes exactly as before.** Token pools add to the scan, never replace any of it.

## What PR #163 changes

**The datum and the box value**
- `ReferenceDatum` goes from 5 fields to 8: `box_lovelace, token_policy, token_name, token_quantity, max_fee_per_mix_lovelace, mix_script_hash, mix_logic_script_hash, fee_script_hash`.
- Each Mix output must equal `box_value` exactly, and `serialise_data(box_value)` goes into the Fiat-Shamir context.
- **One prover serves both.** The context layout, `MixDatum`, the redeemers and the sigma and Schnorr code are unchanged. Only the value bytes differ:
  - an ADA box is `A1 40 A1 40 <lovelace>`, byte-identical to today;
  - a token box is `A2 40 A1 40 <lovelace> 58 1C <policy> A1 <name> <Q>`.

**The one-shot mint and the parameter chain**
- `one_shot_mint(seed_tx_id, seed_idx, holder_hash)` checks that the seed is spent, and that one `"lovejoin"` NFT goes to the holder with no stake credential and no reference script.
- It checks the datum: `box_lovelace > 0`, `0 < max_fee < box_lovelace`, a 28-byte policy, a name of at most 32 bytes, and `0 < Q ≤ 2^64−1`.
- It **never checks the datum's three script hashes**.
- It finds its output with `list.find`, so other outputs at the holder in the same transaction are fine.
- The parameter chain:
  - `mix_logic(P, "lovejoin")` gives L;
  - `mix_box(L)` gives M;
  - `fee_contract(P, "lovejoin")` gives F.
- `reference_holder` (`288fea77…`) takes no parameters, so every launch shares it.

**What it doesn't check, and what it costs**
- **Mix inputs aren't value-checked.** An over-funded box can be mixed by anyone, and the excess goes to whoever builds the mix.
- **CPU:** a token pool costs about 11–12M more than an ADA pool. A wallet-paid mix uses 58% of the budget at N=3 and 98.8% at N=4. Confirmed in the wallet's own mix, by the network too, in [lovejoin-mix-width.md](../lovejoin-mix-width.md): 5–10M more than the classic pool, and N=4 fits by 111M steps, so token pools stay three wide like the classic one. A box-paid withdraw to a key address cost 349,586 lovelace on preprod.
- **Not yet run on a token pool:** fee shards, and a chained mix on a deposit still in flight.

**The bytecode**
- **No unapplied blueprint is committed.** `plutus.opt.json` is a stale classic 1.1.21 build.
- The token artifacts are applied scripts, built with Aiken v1.1.24. Templates come from peeling off their trailing `Apply` nodes, or from `aiken build` at the pinned commit.
- `mix_box` is byte-identical to mainnet's apart from its parameter.
- `uplc` 1.1.23, already a dependency, applies parameters (`Program::apply_data`). A script's hash is `blake2b_224(0x03 ‖ cbor(flat))`.

## How it fits together today

**The owner scalar**
- **There's no HKDF owner index here.** That scheme is Lovejoin's own app.
- The wallet owns every box with the Seedelf scalar, re-randomized per box, and finds its boxes by scanning a pool. **Token pools need no new key derivation:** one scalar across pools leaves boxes unlinkable under DDH, as it does across ADA boxes today.

**One pool, hardcoded, at:**
- `Protocol::of(network)` (`denom = 10 ₳`, M, L, the bundled reference outputs), in `seedelf-core/src/lovejoin.rs:66-184` and `references.rs`. The datum is never decoded.
- `denom_value_bytes` (173-184).
- `PoolBox::from_row` and `from_resolved` (254-289).
- `Coin::from_row`, which refuses tokens (318-331).
- `NETWORKS[n].lovejoin.{mixBox, poolFloor = 30, mixCost}` (`networks.ts:9-74`).
- `LOVEJOIN_DENOM`, `BOX` and `LOVEJOIN_BOX`.

**The flows**
- A deposit, then a fan-out: always N=3, depth 0–3, default 2.
- Each box comes back on its own after 1–6 h. The fee comes from the box, the collateral from giveme.my, and the box goes into a fresh register.
- The session pays every mix and is the chain's collateral.
- Returns go through Lovejoin by default.
- **Tokens are left out everywhere:** they're `kept` and come back directly.

**The data layer**
- One `MIXBOX_HASH`, `Watched {Contract, Lovejoin}`, the `lovejoin/pool` and `/since` routes, and fixed Kupo patterns.
- Adding a Kupo pattern rolls Kupo back.
- The rows carry assets already.
- **A route per pool would tell our server which token's pool an IP uses.**

## Choices made here (the owner can overturn any)

### 1. Pools as data, in two contract versions (`seedelf-core/src/lovejoin/`)

**A `Pool` holds:**
- `id`, the NFT policy P;
- `version`, `Classic | TokenV1`;
- `box: BoxValue { lovelace, token: Option<(policy, name, Q: u64)> }`;
- `max_fee`;
- the derived M, L and F;
- `seed` and `reference`;
- the reference outputs needed to measure locally;
- `script_refs`, at the holder or `Inline`.

**The classic pool stays bundled**, as its own trust anchor.

**`BoxValue::cbor()`** ports Lovejoin's `crypto/ref/src/value.rs`, replaces `denom_value_bytes`, and is tested on Lovejoin's 64 `box_value` parity vectors.

**Templates**
- The unapplied token `one_shot_mint`, `mix_logic`, `mix_box` and `fee_contract` go in as flat bytes in `lovejoin_templates.rs`, pinned to the merge commit.
- The tests:
  - all five preprod-token hashes are reproduced;
  - the peeled and the built bytes agree;
  - `templates_are_frozen`.
- A later Lovejoin version would be `TokenV2` beside it, never an edit, the way Seedelf's variants work.
- `derive(seed) -> (P, L, M, F)` applies them.

### 2. Trusting a pool: `verify_pool`

Cheap checks first, offline before network:

1. **Shape.**
   - The output is at `288fea77…`, with no stake credential and no reference script.
   - It holds exactly one `P.lovejoin` and nothing but ADA besides.
   - Its inline datum decodes strictly as 8 fields within range.
2. **Derived hashes.** M, L and F are derived from P, and must equal the datum's. Every address and reward account is built from the derived hashes, never from the datum.
3. **A genuine one-shot:** `hash(apply(one_shot_mint, seed)) == P`. The script makes the NFT one of a kind, so the seed alone proves it, whoever supplied the seed:
   - the bundled list;
   - the data layer;
   - or the inputs of the transaction that made the UTxO, which takes one `tx_info`, on the Koios path only.
4. **Not a 10 ₳ ADA pool on the new code** ([backward compatibility](#backward-compatibility-with-the-classic-ada-pool), 2).
5. **Shown only when finished, the earliest for its values, and of a listed token or ADA** ([session 1](#design-session-1-2026-10-17), 11, 20, 22). Run the cheap checks first, so a fake costs no lookup: are the derived scripts' references at the holder (from the same scan), and is L registered (one batched `account_info`)? Only then the seed proof.

**Verified and usable aren't the same thing.**
- **Verified pools are always read**, for ownership, a restore and boxes coming back. A pool's boxes must never vanish from view because the parameters changed.
- **Usable gates only new mixes**, checked at each read (since the owner's call 34, 2026-10-19, only the first check gates: a box below the minimum, or a copy; a pool whose boxes can't come back takes new boxes, with a warning first):
  - L's credential is registered (one `account_info` for all pools);
  - a mix box meets min-UTxO under the live parameters;
  - `box_lovelace − withdraw fee` covers the **real** destination: an enterprise Seedelf output with a register datum and Q.
- `minimum_seedelf_payment` sizes that destination against `dummy_base_address`, which is 120k too high, so add an exact enterprise sizing.
- At Lovejoin's 2 ₳ bootstrap default, a box fails for long names and large Q. At 4310 a byte the destination needs 1.66 ₳, and the fee is 0.30 with reference scripts or 0.42 inline. Such pools show as **not usable**, and say why. Since call 34 they take new boxes all the same, and the page says why the boxes wait.

**An escape hatch** for a pool that turns unreturnable: bring a box back with the fee paid from the public account, saying that it ties the box to the account. The withdraw builder has no fee input today (`lovejoin.rs:795-833`). Since the owner's call 36 (2026-10-19), the private balance pays by default (`lovejoin::withdraw_private`: a Seedelf UTxO of ADA alone beside the box, tied to it on chain), and the public account is the user's visible choice.

### 3. Finding pools and reading them

[Session 1](#design-session-1-2026-10-17) settled it (11, 12):
- **Discovery watches the holder,** the one address every launch uses. It reads from db-sync through the data layer, or from Koios bit by bit.
- **The read set is every shown pool:** genuine, finished, and the earliest for its values. It only grows.
- **The bundled list is a head start,** never a gate.
- **When:** Koios is asked for new pools when the hub opens; the data layer, at every refresh (round three, 26).
- **No read names your pool.** The read set is the same for everyone.
- **Verification is cached per network:** verified pools as public data, rejected candidates by UTxO ref.
- **A pool joins the read set only once discovery finds it.** Never sooner from the launcher's own record, which would single out the launcher's IP.
- **The launcher's own-launch fact lives in the existing sealed `lovejoin.<network>` record.** A new record's name would show (`private-store.ts:14`).
- **Ownership** is one scalar multiply per box across every pool, and `PoolBox` carries its pool.

### 4. Builders generalized (core + WebAssembly)

**`ScriptSpend`**
- A `PolicyMint { policy, script: SeedelfRef | Inline }` replaces the Seedelf-only mint (`build.rs:1316-1321, 1540-1548, 2001, 1787-1790, 1223`).
- `Patches` are threaded through `settle`, `draft`, `measuring_draft` and the final build (1577-1813).
- Deposits are counted in `remainder()`.
- `Staking::deposit()` learns cert 0's deposit from `params.key_deposit` (`staking.rs:364-376`), with no fake stake signature (348-350).

**Deposit**
- Inputs are your own token UTxOs only: never a stranger's, and none with a reference script or a deep datum (H1 and H2).
- Outputs are `box.lovelace + Q`, with a token-change output beside the ADA payer line.
- `MAX_DEPOSIT_BOXES` is sized by bytes: a token box is about 226 B, against about 150 B for an ADA box.

**Mix**
- Multi-asset outputs. Every input holds exactly the box value, the wallet's own hardening.
- The fee is ADA from the payer line, and N stays at 3.
- A chain may span pools, so records carry **a pool per leaf**.
- `MIX_FEE_ESTIMATE` is per pool: about 0.96 ₳ inline.
- `per_box`, `boxes_affordable`, `funding_for`, `again_*`, `fan_out` and `fresh_for` take a `Pool`.

**Withdraw**
- Box-paid, and its output carries the token. Today `lovejoin.rs:811` writes `Output::new(to, lovelace)`.

**Script refs**
- The holder's reference UTxOs, found by script hash, where they exist. Otherwise inline, about +0.12 ₳ a transaction.

**Large integers**
- `crossCheck` sends Ogmios's UTxOs through `JSON.parse` and `stringify` (`lovejoin.ts:1832`, `koios.ts:1111`, `data-layer.ts:355`), which rounds any Q above 2^53. Pass the raw JSON through, and test 2^53+1 and 2^64−1.
- Sums such as k × Q go in u128 or BigInt, and core refuses a k × Q that doesn't fit a u64 (`assets.rs:62-69`), in words ("bring them back fewer at a time"). The wallet's own 30 × Q cap went with call 35.

### 5. Starting a pool

**One transaction, straight from the private balance**, or from the public account if the user chooses ([session 1](#design-session-1-2026-10-17), 10): an account-paid builder beside this one, for 34d. The private one holds:
- a `ScriptSpend` of ADA-only Seedelf UTxOs, kept apart by history as `mint_apart` does, one of them the seed;
- giveme.my's collateral;
- the mint, with `one_shot_mint` inline;
- the reference UTxO, with the 8-field datum;
- the `mix_box` and `mix_logic` reference scripts, at the holder;
- L's stake registration;
- the change, into a fresh register under a history class of its own.

It's about 6.6 KB, and atomic: no half-launched pool, no stranded deposit.

**How it's put together**
- **The token UTxO isn't spent.** The datum only names the token.
- **Cert 0 or cert 7.** Shelley's cert 0 needs no script witness, and Aiken's `uplc` agrees. But Lovejoin's own launch used cert 7 with a Publish redeemer.
  - The S0 probe decides between them.
  - The fallback is cert 7 with `mix_logic` inline: about +3.5 KB, a Cert redeemer patch, and `"publish"` accepted in `Budgets::from_ogmios` (`build.rs:1117-1123`).
- **No cert if L is already registered**, which a griefer could arrange.
- **giveme.my.** Its validator (`Collateral-Provider/rs/src/validators/transaction.rs:173-270`) has no rule against a foreign mint or a certificate, and the probe confirms that against what's deployed.
- **The fallback** is a one-time account, funded as a mix session's is: about +0.5 ₳ and three transactions.

**Checks before the review**
- **The token is in the wallet's token list** for this network ([session 1](#design-session-1-2026-10-17), 20), which already vets it. The creator needn't hold it (21). An ADA pool names no token.
- **Refused:**
  - a token outside the token list, and Seedelf identifier tokens;
  - ~~a total supply (`asset_info`) below 30 × Q;~~ (dropped, call 35)
  - a copy of a shown pool's values (the form links to it), and a 10 ₳ ADA pool.
- **Shown:** the token's pools, with their crowds, so a creator can join one rather than split it.
- **Q** is entered in display units, with the token's decimals. The creator sets it ([session 1](#design-session-1-2026-10-17), 14).
- **`box_lovelace`** is suggested and can be changed: S0d's least for the token's shape, plus a margin, rounded up to 0.5 ₳ (4.5 ₳ for every token S0d measured). It never goes below S0d's bound, nor above 9 ₳ (27). For an ADA pool, it is the amount, with no upper limit.
- **`max_fee`** is 1.5 ₳, and below `box_lovelace` as `one_shot_mint` requires.
- **Live parameters:** a mix box and its return fit with margin.
- **Self-verification:** before signing, `verify_pool` runs over the draft's own outputs, the same check a stranger's pool gets. The draft is also measured locally and through Ogmios.

**The review**
- What never comes back, apart from the fee.
- The no-audit note.
- What's public: a pool for this token was started by a spend from the Seedelf contract, not whose.
- What D2 says about bootstrapping.

**Mainnet**
- The preprod rehearsal ([34g](#the-steps)) is the gate: launch, bootstrap, mix, return and restore, all for real on preprod, and launching ships for mainnet only once it all works there.
- On mainnet itself, two free checks: a launch built and evaluated through Ogmios but not sent, and a synthetic token Mix and Owner against the derived scripts under mainnet's protocol version.

### 6. Choosing pools

Weighed against the review's traps.

- **Cost against value.** At depth 2 a box costs about 3.8 ₳ in mixes, whatever its Q is worth. The planner never adds boxes beyond a cost the review shows, and any pool can be left out.
- **Which pool, per token** ([session 1](#design-session-1-2026-10-17), 15): the most used of its pools that can take a box and is open to mixing. **Change** on the review picks any other that works, or skips it. What's less than a box comes back directly, and the review names it.
- **Shared across pools:** `MAX_CHAIN_MIXES` and the free-box accounting.
- **ADA's share.** Token boxes are planned first. Each takes `box_lovelace + mixes × fee` (the withdraw fee is inside the box, so it isn't counted twice), plus the minimum for the token remainder's change. ADA boxes come from what's left. The review says it took spare ADA away from ADA boxes.
- **The tile's picker** is grouped by token.

### 7. Returns through token pools (`sessions.ts`, `wasm/src/lovejoin.rs`)

- **`holdings`** splits your own token UTxOs into the deposit; a stranger's stays `kept`.
- **The token change** becomes a synthesized row carrying its `asset_list`. Today `rows[0]` is `..Default` (353-359).
  - Its making transaction goes into `own` (367-368).
  - Its change goes into `known` for `merged_return` (392).
- **The planning functions:**
  - `plan_return` gains token boxes;
  - `lovejoinCost` and `priced` price them per pool (1316-1364), and "tokens never go in" goes;
  - `mixFunding` sends tokens (1526).
- **The approved plan, per pool,** is held in `SessionRecord.mix` and `AutoRecord.lovejoin`, so the build can't choose other pools than the review showed.
- **These read pools:** `spareOf`, `collateralWanted`, `poolShort`, and C53's *Put in 5 ₳*.
- **The default:** through the token's pool when one is usable, under the existing *Bring private sessions back through Lovejoin* switch. Private by default, with the cost shown.

### 8. Records

A record with no `pool` is the classic pool's. Each of these gains a pool:
- `Schedule.due`'s entries. Today `held()` is `due.length × 10 ₳` (3085-3097); it becomes per pool, and so does `withdrawDueNow`'s trim (3159-3163).
- `notMixed` and `unsure`, kept per pool.
- `Withdrawing`, which stays one slot but carries its pool and tokens.
- `ChainRecord`'s boxes and leaves.
- In `lovejoin.ts`: `Split`, `rooms`, `listing`, `poolRows`, `utxoOf(r, mixBox)` (1381-1411), `fits`, `room`, `againBoxes`, `floor*` and `funding`.
- `status()`, `LovejoinStatus`, `LovejoinHeld`, `KeptPublic`, `SendingPublic`, `lovejoinMaybe`, and `spent.ts`'s reservations.

**These stay network-wide:** one box a run, the spread, the quiet times, and the `inTurn` names.

**Elsewhere, every place learns every pool:**
- `madeBy`'s `mixed` means an input at **this box's pool's** M (`lovejoin.ts:2839-2870`; `row.rs:128`).
- `feed.ts` (34, 162, 214, 241), `activity.ts` (482, 781) and `pending.ts`.
- The restore scan; the Remove wallet and Forgot password counts; Home's banner; the UTxOs screen's tag.
- `crossCheck` runs once for each script version in a chain.

**Two new Activity kinds:** **Started a Lovejoin pool**, and **Into Lovejoin · NIGHT**.

### 9. Screens

**The Lovejoin page is a hub** ([session 1](#design-session-1-2026-10-17), 4, 5, 13):
- **Your mixes:** every mix, from either side and in any pool, followed until its last box is back. Bootstrap's rows sit apart and stay until brought back by hand.
- **The pools,** grouped by token:
  - the tokens you hold first, then the most used (boxes not yours);
  - each pool with its box value ("100 NIGHT + 4.5 ₳"), its crowd (boxes and deposits) and your boxes;
  - search by ticker or policy. Only the token list's tokens have pools (20).
- **Every pool shown is genuine and finished.** That's everything the wallet reads, and it's the same for everyone. Fakes, unfinished pools and copies never reach the page. The checks run cheapest first: the holder scan, then the shape, derivation, the references and the registration, and the seed proof last.
- **Start a pool**, as a button, not a link: a choice that costs money is never a link. It opens the launch's form and its review.

**A pool's own page** shows:
- the token and its mark, and the box value;
- the crowd, counting deposits as well as boxes;
- your boxes, and when the next comes back;
- its launch transaction;
- **Mix** and **Bootstrap**. Below the floor, Bootstrap is the main button, and the page shows how the bootstrap is going.

**How a mix is shown** was settled in session 1 (5). The owner asked for it on 2026-10-14: "how to display a current lovejoin mix just in general needs a review … Mixing from public does not show on the mixes so there is no way to track it". What the page did before:
- **A mix from the private balance** is a private session, so *Mixes* lists it with its stage: funding, mixing, waiting, coming back.
- **A mix from the public account** has no session. Its chain shows under *Its transactions* only while it's being sent, or if it stopped partway, and Home's Public tab says it's being sent. Once it's all sent, its row goes. After that, its boxes count only in *Your boxes in the pool*, and in when the next box comes back.
- **So a public mix can't be followed once it's sent.** Token pools make this wider: mixes in several pools, from either side.
- **The design:** one list of every mix, from either side and in any pool, each shown until its last box is back (session 1, 5). Its screens are 34f's.

**Every other screen** — Home, Settings, UTxOs, Activity, ClaimAll, SiteSessions, the swap review — shows its figures per pool.

**Strings**
- The 21 "10 ₳" keys become parametrised.
- The new warnings and privacy notes go under `.warn.` and `.privacy.` keys, which makes them critical: translated to es and ja, and back-translated.
- The guard tests stay green.

**Docs**
- architecture, flows, privacy, and keys-and-accounts.
- A dated entry under the privacy policy's *Changes*, for the new reads: the holder and `account_info` at a launch (`asset_info` went with call 35).

### 10. The data layer (mainnet; deployed before the wallet's upload)

[Session 1](#design-session-1-2026-10-17) set its shape (11, 12):
- **A pool list and one combined box feed, the same for everyone.**
  - The pool list is every shown pool, with its seed and references, found from the holder in db-sync and verified with the shared crate.
  - The box feed covers every shown pool. Only pools on the server's own verified list are ever queried.
  - The wallet re-verifies every pool. The server can leave a pool out, but it can't make one look real.
- **The 1.5.x routes and Kupo's patterns are untouched.**
- **Token pools come from db-sync only.** Health is per route, so a 503 on a token pool doesn't send the contract index to Koios (`private-index.ts:220-233`).
- **`mixed` is per pool** (`row.rs:128`, `kupo.rs:328`).
- **Verification lives in a small shared crate:** the templates, derive and verify, used by core and by the server. A path dependency on `seedelf-core` won't do: it wouldn't resolve, since `[patch.crates-io]` lives in the platform workspace, and it would pull blst, Pallas and uplc into the server.
- **Preprod has no data layer**, so 34c is checked by its own live mainnet tests.

## The groundwork (2026-10-17)

One branch, `web-wallet/token-pools-groundwork`, of what needs no more design, so the design session starts from what's proven. The classic pool doesn't move: a classic deposit is pinned byte for byte to 1.5.0's (`lovejoin_pools_test.rs`), and the classic Lovejoin, withdraw-zero, width and WebAssembly tests pass unedited.

**Built, in core** (`seedelf-core/src/lovejoin/`, now a directory):
- `templates.rs`: the four unapplied scripts, built with `aiken build` (v1.1.24) at Lovejoin 8131b1d, the merge, and pinned by their own hashes; `derive(seed)` applies them (P, L, M, F).
- `value.rs`: `BoxValue`, checked on Lovejoin's 64 `box_value` vectors.
- `pool.rs`: the eight-field datum, decoded as strictly as `one_shot_mint` checks it; `verify_pool`; `find_seed`; and `usable`, whose way back is a real withdraw, built and measured.
- **`Protocol` is the pool.** It gained `version`, `id`, `token`, `max_fee`, `fee_hash`, `inline_scripts` and `seed`, and keeps its name: the classic tests build it by struct update, and run unedited. The classic pool's id, fee cap and fee script are checked against its bundled reference outputs.
- **The builders:** `deposit_from` and `chain_from` take token UTxOs, and the tokens the boxes don't take come back apart from the ADA payer line (`token_change`). Mixes and withdraws carry the token. A withdraw that can't pay its own way back says so (`CantPayBack`), and `withdraw_paid` is §2's escape hatch: the fee from an account, which also makes up what the output needs.
- `launch.rs`: §5's launch as one Seedelf spend, with cert 0 for `mix_logic`, and its pool checked from its own bytes (`launched_pool`). `launch_apart` picks its inputs with `Purpose::Mint`'s order. The Seedelf spend learnt a mint under a carried script (`mint_inline`) and certificates patched in (`with_staking`), and `Staking` counts cert 0's deposit (`deposit_at`) and asks no key of a script's credential.

**Built, in WebAssembly** (none of it called by the worker yet):
- A pool is named as data, a `PoolRef`: its reference row, its seed, and the holder's rows that may carry its scripts. It's verified on every call.
- `lovejoinVerifyPool`, `lovejoinUsable`, `buildLovejoinLaunch`, and `poolRef` beside a `lovejoinOwned` or `buildLovejoinWithdraw` request.
- The classic requests and their JSON are unchanged. `poolRef` is read on its own: serde's `flatten` would have buffered a stranger's deep datum past serde_json's limit (`deep.test.mjs` caught it).

**Built, in the worker:** only §4's large-integer fix. The network's check now hands Ogmios a chain's unsent UTxOs as the JSON text WebAssembly wrote (`RawJson`), tested with 2^53 + 1 and 2^64 − 1.

**What S0 found**
- **S0a ✅** The wallet's `uplc` 1.1.23 reproduces every hash of Lovejoin's preprod token launch, and the very bytes of its two published scripts. It measures the launch's seven recorded mixes (N = 2 to 4) and withdraws (box-paid and wallet-paid) as the chain charged them, to the step. No Pallas or `uplc` bump. S1 is moot: PR #163 merged as it was, and the templates come from `aiken build` at the merge.
- **S0b ✅** Preprod's and mainnet's Ogmios measure a token mix and a token withdraw (a 32-byte name, `Q = 2^64 − 1`) exactly as the wallet does (`lovejoin_live_test.rs`, `--ignored`).
- **S0c, half done.** Both networks measure a launch exactly as the wallet does, and Ogmios takes cert 0 with no script witness. Ogmios can't show what the ledger checks before scripts run (cert 0 registering a script's credential with no witness), nor whether giveme.my signs a launch: that takes a real launch on preprod, in tADA, which is the owner's to send, or 34g's.
- **S0d, measured; the figure is the owner's** (`lovejoin_box_value_test.rs`). Each case is a box's whole way back: its withdraw into a Seedelf, then part of the token or all of it to a Seedelf or an address, from what came back alone. The least box value, the same on both networks:

  | token | scripts | least box value | withdraw fee |
  |---|---|---|---|
  | worst (32-byte name, `Q = 2^64 − 1`) | by reference | 4.11 ₳ | 0.298 ₳ |
  | worst | inline | 4.23 ₳ | 0.412 ₳ |
  | typical (5-byte name, 100 of a 6-decimal token) | by reference | 3.83 ₳ | 0.297 ₳ |
  | typical | inline | 3.95 ₳ | 0.410 ₳ |

  The step that binds is always part of the token paid to a Seedelf. How far the price of a byte (today 4,310 lovelace) can rise before a value stops covering a shape, inline:

  | box value | worst token | typical token |
  |---|---|---|
  | 4.00 ₳ | doesn't cover it today (−6.3%) | +1.7% |
  | 4.25 ₳ | +0.7% | +9.3% |
  | 4.50 ₳ | +7.7% | +17.0% |
  | 5.00 ₳ | +21.7% | +32.0% |

  A box's ADA comes back with it: a bigger value costs capital while the box is out, not fees.

**Other findings**
- **Lovejoin's own 2 ₳ pool is usable** by §2's rules, against what [Verification](#verification)'s preprod step 7 expected. A box's minimum is 1.55 ₳, and one comes back with 1.59 ₳: LJTEST's name is short. What comes back can't pay alone for part of its token, though. Session 1 settled it: with its scripts at a key address, the pool isn't shown at all (22).
- **A launch locks 23.12 ₳ for good:** the reference UTxO 1.70, `mix_box` 3.62, `mix_logic` 15.81, and the deposit 2.00. It costs about 0.52 ₳ in fees and is 6,330 bytes.
- **What a transaction costs** on Lovejoin's preprod pool, the classic's 0.88 ₳ mix beside them:

  | | scripts by reference | inline |
  |---|---|---|
  | a mix | 0.833 ₳ | 0.947 ₳ |
  | a withdraw | 0.297 ₳ | 0.411 ₳ |
- **The wallet's Seedelf minimum runs high.** It's sized against a base address, about 0.12 ₳ an output over the contract's enterprise address. S0d's figures include it; sized exactly, each would drop about 0.24 ₳. Changing it moves every Seedelf payment's minimum, the CLI's too, so it isn't changed here.

**Left for the design, and why**
- **34a′, the records:** a pool on each record, and migrating 1.5.0's. Their shapes follow the flows: a Bootstrap kind (D2), seed or Bootstrap, and a record that lets a public mix be followed (*How a mix is shown*).
- **34c, the data layer and the shared verification crate:** D1.
- **34d to 34f:** the flows, the planner (D2, D3), and the screens.
- **The planner's per-pool costs** (`MIX_FEE_ESTIMATE`, `per_box` and the funding sums still take the classic pool's): 34e.
- **The chain builders through WebAssembly** (a session's or the account's chain into a token pool): 34d, with the flows that call them.

## 34a′ · The records (2026-10-17)

Branch `web-wallet/token-pools-records`. The step that [§8](#8-records) and session 1 (5, 6, 18) set, as built, in the worker (`lovejoin.ts`, `rpc.ts`). Nothing in core or WebAssembly changed. Claude's choices, the owner's to overturn.

**The gate comes first: 1.5.0's own record** (`tests/lovejoin-1-5-0.test.ts`, backward compatibility 3, 4, 5 and 8).
- The fixture `tests/fixtures/lovejoin-1.5.0.json` was written by that test file run in a worktree at 1.5.0's release (63f87b8), on that commit's WebAssembly. This tree must meet it.
- **The plans:** what Lovejoin funds, plans and reviews for a grid of returns and mixes on both networks, and every transaction of each chain built: its kind, its outputs and each box's value, exactly. Fees are measured, not planned (a mix's random draw of pool boxes moves its budgets by a few hundred lovelace), so they're met within 0.5%.
- **A vault mid-flight:** a 1.5.0 wallet's local storage with six boxes due, a public mix all sent and its record still kept, a withdraw in its write-ahead slot that Koios didn't answer, and a return's chain four transactions in.
- **After the update** (session storage gone, the wallet locked), nine hours of the worker's runs a minute apart: each run's sends, every Koios and giveme.my request, and the sealed schedule, compared whole but for the new `mixes`. The due times sit where the runs meet each rule: the unlock's waits, one box a run, the spread, the quiet after the user's own send and its pushes, a cut chain's boxes held, a public mix's record and leaves going. Every draw is seeded.
- **A restore** of the same phrase on the chain that's left.
- Five one-line changes to those rules each fail it (the spread, the quiet, its pushes, the unlock's wait, how long a record is kept).

**What stays as 1.5.0 wrote it.** The sealed `lovejoin.<network>` schedule keeps the classic pool's fields where they are, with their meanings: `due`, `notMixed`, `unsure`, `withdrawing`, `chains`, `marks`, `leaves`, `origins`, `asking` and `unlock`. A wallet that never touches a token pool keeps the same record, and chain records keep their 1.5.0 lifetime. Token pools add beside them, never inside:
- **A pool is named by its id,** the NFT's policy P. A record with no pool is the classic pool's; `classic` is never written.
- **`pools`:** each token pool's own `due`, `notMixed` and `unsure`, by id. `marks` stay keyed by time across every pool.
- **On a chain record:** `pools` (how many of its boxes went to each token pool; the rest are the classic pool's), and a pool on each leaf. A chain may span pools: one deposit, mixes in each, one return.
- **On the withdraw in its slot:** its box's pool and token, and `bootstrap` when a Bootstrap held its box.
- **On an origin:** `mixedIn`, the token pools whose `mix_box` an input sat at. `mixed` keeps meaning the classic pool's.

**One rule set, run per pool.** Every rule that counted the classic pool's boxes now counts each pool's: due times against the boxes that can come back, boxes not mixed yet, a restore's lookups. Given the classic pool, each gives 1.5.0's answer, which the gate checks. What's network-wide stays network-wide: one box a run, the spread, the quiet, the unlock's draws, and the turns.

**Every shown pool is read** (session 1, 11 and 12). The read set is the classic pool and what discovery hands the worker (`LovejoinDeps.pools`, 34c's). Until 34c, discovery hands it nothing, so the classic pool is all a wallet reads.
- Each pool is verified from the bundled templates before its rows are read. One that doesn't verify is left out.
- **The rows come in one Koios request for every pool,** the same for everyone. The data layer serves the classic pool's as before. Token pools come from Koios until 34c's combined box feed.
- **A pool that isn't read this time never loses its boxes' due times.** Only a read counts a pool's due times against its boxes.

**Your mixes: `mixes`, one entry a mix** (session 1, 5). The list the hub shows, followed until the mix's last box is back. Chain records keep their own lifetime, and no rule reads `mixes`, Bootstrap's hold aside, so it can't change how boxes come back.
- An entry is made with its chain's record. It holds the mix's kind (a return, a mix, mixing again, a seed, Bootstrap), its session or account, when it began, and its boxes in each pool with how many have come back.
- **A box that comes back counts against its pool's oldest open mix** with a mixed box out, since mixed boxes are interchangeable (session 1, 5). A box a recorded chain made, not mixed yet, counts against that chain's own; a box a Bootstrap held, against the pool's oldest Bootstrap. It's counted once the withdraw is known gone: sent, or seen on chain after Koios didn't answer.
- **Mixing again** takes its boxes from the oldest open mixes of their pool as its first mix goes, the moment it takes their due times.
- **An entry goes** once all its boxes are back or mixed again.
- **Each pool read squares them up:** with no chain being sent and no withdraw in its slot, a pool with fewer of the wallet's boxes than its open mixes say closes the oldest, Bootstraps last. That covers a box brought back from another device, and a 1.5.0 chain's entry made after some of its boxes came back.
  - **Only a mix whose chain's record went, or ended `RECORD_KEEP_MS` ago,** is squared up, and boxes a recent chain made don't count against older mixes. A listing that's behind (a Koios backend lagging) can miss a box that just landed, which is why chain records are kept that long. Without this rule, such a read closed a just-landed Bootstrap's entry, and its boxes then came back by themselves; a test holds it.
- **1.5.0's chains get entries** at the first change after the update, from their records, and the first pool read squares them up.

**Bootstrap, a kind of its own** (session 1, 6 and 18). Its chain record is a deposit with no mixes, as a seed's is, marked `bootstrap`.
- **Its boxes never come back by themselves.** A pool's open Bootstrap entries hold that many of the wallet's boxes in the pool: those still at the deposit first, then others, since a box someone else's mix moved can't be told from the wallet's other boxes there.
- A held box gets no due time, isn't "not mixed yet", and isn't taken to mix again. It comes back by hand, one at a time, and counts against its Bootstrap's entry.
- **Bring them all back** marks the entries `released`: the boxes are no longer held, and come back by themselves, one a run, as any box does (round three, 24).
- **Seeds keep coming back by themselves** (session 1, 18): a seed's record reads as it did.

**Status and Home.** `status` and `held` keep the classic pool's figures where they are, so the classic screens read as today. Each token pool read adds an entry under `pools`, and Bootstrap's held boxes are listed apart (`bootstrap`). Two methods are new, for 34d and 34f: `mixes()`, the list with each mix's chain while its record is kept, and `releaseBootstrap()`, Bring them all back.

**Also changed:**
- **A token pool's box brought back** is built against its own pool (`poolRef`), carries its token into the Seedelf, and its history entry has the token coming in.
- **A token pool's withdraw that Koios didn't answer** is looked for on the contract's feed: the data layer's pool feed lists the classic pool alone, and the box goes into a Seedelf.
- **What made a token pool's box** is asked of Koios even while the data layer is up, since the data layer's listing carries who made each box for the classic pool alone.
- **WebAssembly traps on mixing again at depth 0** (`planLovejoin` with `again` and no depth). Nothing asks for it, since mixing again always takes Settings' depth, 1 to 3; the gate's grid leaves it out. Not changed here.

**An independent review** of the diff, adversarial, found three that the tests had missed. Each is fixed, with a test that fails without the fix:
- **A box with no mix of its own was counted against a Bootstrap still holding its boxes:** a restore's box, a box from before the list, or another device's. The Bootstrap then held one fewer, and that box came back by itself, unmixed, the next one after it too. Such a box now counts against a mix, a Bootstrap brought back all at once, or nothing.
- **A chain that stopped before anything of it was known sent closed its mix at once.** But a deposit Koios didn't answer may have gone in (a session's chain marks no `maybe`), and a Bootstrap's mix closing let its boxes go. It now closes only as its record goes, with none of its boxes listed.
- **Discovery failing between a pool read and the look at what made its boxes** had the look see no token pool, and seal a token pool's mixed box as a deposit's. The wallet now reads what discovery last handed over.
- **Left, low, two devices only:** a Bootstrap's boxes brought back on another device leave its entry here open, squared up last, so it may hold boxes no record accounts for (someone else's mix moved them) until it's closed by hand. 34d's Bootstrap flow decides how its entries close.

**Tests:** the gate, and `tests/lovejoin-pools.test.ts` (18), with PR #163's preprod token pool read beside the classic pool. A token pool read in the same request as the classic pool's; a pool that doesn't verify left out; its own due times, and Home's figures; a token box back through its own pool, its token with it; one box a run across pools; due times kept through a read that didn't cover the pool; a chain spanning pools; squaring up, and the lag; mixing again taking boxes over; 1.5.0's entries made once; Bootstrap's hold, by hand, and Bring them all back, and against a box with no mix and a deposit Koios didn't answer; a chain that never went; a restore's lookup per pool, through discovery failing. Thirteen one-line changes to the new rules each fail them.

**For later steps:**
- **34c:**
  - The data layer's combined box feed takes the token pools' rows off Koios.
  - It must carry who made each box (`made_by`), as the classic pool's listing does. Until then, a restore of token pool boxes asks Koios even while our server is up, which tells Koios which boxes are the wallet's.
- **34d:**
  - The flows that build chains into token pools, passing `pools` and each leaf's pool to `recordChain`.
  - Bootstrap's button and its review. Bring one back now takes a Bootstrap's box by hand with no `anyway`, as a seed's always could; its review says what bringing back a box nobody has mixed yet shows.
  - Activity's two new kinds, and naming a token pool's deposit and mixes from the public account (`activity.ts`'s `describe` knows the classic `mix_box` alone).
- **34g:** the policy's *Changes* entry names the new reads: every shown pool's rows in one Koios request, and whatever 34c leaves of the Koios lookup above.

**Left to later steps:** building chains into token pools, Bootstrap's button and the launch's record (34d); the planner per pool (34e); discovery and the read set's source (34c); every screen (34f).

## 34c · Discovery and the data layer (2026-10-17)

Branch `web-wallet/token-pools-discovery`, from main 88e5be7. [Session 1](#design-session-1-2026-10-17)'s 11, 12 and 26, and 30 to 32, as built. Claude's choices, the owner's to overturn.

**The rule, three times over.** A pool is shown when it's **standard** and the **earliest launched of its values**.
- Standard: the reference UTxO's shape (the holder's enterprise address, no reference script, one `lovejoin` NFT and ADA alone, a datum that decodes); a token in `tokens/list.json`, or ADA at any amount but 10 ₳; a seed among the launch's inputs that makes the NFT's policy, and a datum naming exactly the scripts that seed makes; and finished by its launch (30).
- Core: `candidate` now takes ADA pools at any amount but the classic pool's 10 ₳ (17); WebAssembly's `lovejoinCandidate` (the cheap offline checks) and `lovejoinLaunchCheck` (the seed among the inputs, the derivation, which scripts the launch put at the holder, and L's reward account).
- The wallet: `background/lovejoin-pools.ts` (`shown`, `PoolDiscovery`).
- The data layer: `seedelf-data/api/src/lovejoin/` (32), its own copy written without Pallas, uplc or blst:
  - `flat.rs` applies a template's parameters by hand. A term moved along isn't its bits shifted: every byte string in it is padded to a byte boundary, so moving it moves its pads. The term is read and written again, item by item.
  - `templates.rs` (the four templates, copied from core and pinned by their hashes), `datum.rs` (as strict as core's `ReferenceDatum::decode`: any integer width, chunked bytes, either list form; no bignum, no tag 102), `standard.rs`, `crowd.rs`, `db.rs`, `discovery.rs`, `routes.rs`.
- **Held together:** `seedelf-core/tests/fixtures/lovejoin-pool-vectors.json`, which core's `lovejoin_vectors_test.rs` writes from its own derive and decoder (ten seeds' four hashes; 32 datum encodings and what each reads as), and `extension/tests/fixtures/lovejoin-shown.json` (ten scenarios of the earliest of each value), read by both sides' tests. The data layer's CI runs when either changes, or the token list.

**The data layer** (mainnet, db-sync alone; Kupo indexes neither the holder nor the token pools):
- `lovejoin/pools`: every shown pool as of the stable cursor (its reference UTxO, seed, two scripts at the holder named by their hashes, its launch's place and its crowd), and the classic pool's crowd.
- `lovejoin/tokens` and `/since/{cursor}`: every shown pool's boxes, read as the classic pool's routes are, each with `made_by` (`mixed` per its own pool), and the pools covered: those shown as of the cursor, or of `from`'s.
- Each candidate at the holder is checked once and its verdict kept in memory (at most 200,000, past which it's checked at each request), the derivations off the request threads; the holder is read on by output id, all of it hourly.
- `lovejoin/pools` is worked out once per cursor, off any request, and kept an hour; a request waits up to its 5 s, then gets the last list.
- While db-sync can't answer, the three routes say 503 with a wait, and the classic pool's go on from Kupo (per route, as §10 asked). The wallet takes any refusal of theirs but a 429 as theirs alone (`TokensDown`).
- **The crowd** (31): its boxes (exactly the box value, a box's datum), the deposits they could have come from, worked backwards from the boxes through each mix, and how many a mix made.

**The wallet:**
- **Found** (`PoolDiscovery`): the data layer's list at each pool read, at most every 5 minutes, each pool verified again in WebAssembly; or, when the Lovejoin page opens (`lovejoin-look-for-pools`) and the data layer hasn't answered within those 5 minutes, Koios's holder from the last height looked to, less 20 blocks:
  - the cheap checks first, offline: the shape, the datum, a listed token, and both scripts its datum names at the holder in the same transaction. Only a candidate that passes costs a request;
  - its launch's `tx_info` (inputs and certificates, 20 a request); for a launch that didn't register L, L's `account_update_history`;
  - a launch under 10 minutes old, or one Koios doesn't know yet, holds the height back to before its block, and a look that fails keeps nothing.
- **Kept** in `seedelf.lovejoinPools.<network>`, unsealed (the same for everyone; the height dates the last look; deleted with the wallet): every standard pool, its scripts named by their hashes alone, which WebAssembly fills in from its own derivation. Rejected candidates aren't kept: the next look starts past them.
- **The bundled head start** (`src/lovejoin-pools.json`): written by `npm run lovejoin-pools` with the wallet's own look against the real Koios, and checked on every test run (each pool verifies, none is a copy). Today: no standard pool on either network; preprod looked to block 5,299,707, mainnet to 14,080,490.
- **Read** (`LovejoinService`): `pools` is `discovery.known`, after the data layer's refresh. A token pool's rows come from `lovejoin/tokens` for the pools it covers, each box's making with it, so nobody is asked what made a token pool's box while the data layer answers (34a′'s *For later steps*, done). A pool it doesn't cover, or all of them while it says 503 (`TokensDown`, which leaves the part up), comes from Koios, in the classic pool's request when that goes to Koios too.
- **Provenance per pool:** what the index listed says who made the boxes of the pools it covered (`classic`, `fed`); a box of a pool read from Koios is Koios's to say, and so is a transaction that made boxes in both.

**Tests:** core's vectors (2), the ADA pool case in `lovejoin_pools_test.rs`; the data layer's rule, settling and assembly tests, 5 crowd tests and the 503 route test (`scripted_kupo.rs`); WebAssembly's candidate, launch check and hash-named scripts (`lovejoin-pools.test.mjs`); the extension's `lovejoin-discovery.test.ts` (13), three feed tests in `lovejoin-pools.test.ts`, the head start's check, and Remove wallet's caches. The classic pool's tests and 1.5.0's gate pass unedited. Against the real preprod Koios (`LIVE_KOIOS=1`): the holder, a launch's `tx_info` with `tx_block_index`, and registrations read as discovery reads them.

**An independent review** of the diff, adversarial, found these. Each is fixed, with a test where one can run offline:
- **The discovery tests read the bundled head start**, so writing it (`npm run lovejoin-pools`, at block 5,299,707 on preprod) moved their look past the fixture's launch: five failed. A test now gives its own head start (`headStart`), and one checks the bundled one is where a look starts.
- **The server's verdict cap dropped what it had just checked:** past 200,000 kept, a new standard pool's verdict was thrown away and the pool never shown, so a holder filled with junk would have hidden every later launch from every mainnet wallet. A request's own verdicts now count whether kept or not.
- **A token route's 404 marked the whole private index down** for every wallet, every 5 minutes (a server deployed back to 1.5.x, or the upload ahead of the deploy). Any refusal of the token routes but a 429, and any answer of theirs the wallet can't read, is now `TokensDown`.
- **The token routes' cost grew with the holder and every pool's history** under a request's 5 s, on the private index's two connections. The holder is now read on by output id (all of it hourly), refused candidates aren't kept, a launch's inputs are tried once, and the pool list (with its crowds) is worked out once per cursor off the request, the last list answering meanwhile.
- **Koios's look took launches at the tip**, so one rolled back stayed kept for good, and one made again elsewhere kept its old place. A launch is now taken only once its block is 10 minutes old (`SETTLE_MS`), the height held short of it until then.
- **A spread over a long holder answer would overflow** (`Math.max(...)` past about 125,000 rows): a fold now.
- **The live check of first registrations passed vacuously:** it now asks about a key the recorded delegation history registered too.
- Left as they are: the fake index's `tokens/since` covers the snapshot's pools (the server's newer-cursor case is checked server-side); `privacy.md`'s wording of the fallback request, corrected.

**Waiting on the owner:** the server's queries against home's db-sync (Production Reads are the owner's to run), from `seedelf-data/`:
`cargo test --test live_lovejoin -- --ignored --test-threads=1 --nocapture`. It checks that the combined feed's queries give the classic route's rows field for field when given the classic pool's mix box, that the classic pool's crowd counts the route's boxes, and that every candidate at the holder is read and checked; with `--nocapture` it prints each one's verdict and the classic pool's crowd.

**For later steps:**
- **34d:** the launch's review can say a pool of the same values exists (the form's list of pools, 14) from `discovery.known`; a launch whose L an earlier block registered needs no cert and is still standard, but one registered in the same block isn't.
- **34f:** the hub's crowd line from `PoolDiscovery.crowdsOf` (the data layer's; none on Koios, which shows boxes alone), through an RPC of its own; the pools grouped by token from `known`.
- **34g:** deploy the API before the upload, as ever; `npm run lovejoin-pools` with the other lists; the policy's *Changes* entry names the new reads: the data layer's `lovejoin/pools` and `lovejoin/tokens`, and on Koios the holder's outputs, launches' `tx_info` and L's registrations.

## 34d · The flows (2026-10-18)

Branch `web-wallet/token-pools-flows`, from main 87e83cb. The step's row as built: the tile's flows per pool, Bootstrap in place of the seed, a pool's start from either side, the withdraw's escape hatch, and Activity. Core, WebAssembly and the worker; the screens are 34f's, and today's page changed only where the worker's change would have made it untrue. Claude's choices, the owner's to overturn.

**Core** (`seedelf-core/src/lovejoin/`)
- **ADA pools launch** (session 1, 17): `Terms.token` is optional. A 10 ₳ ADA pool is refused before anything is built, as a copy of the classic pool's value.
- **The account-paid launch** (`launch_from_account`, `AccountLaunch`): the public account's UTxOs, picked as an account-paid mint picks them (pure ADA first, the largest first), the first of them the seed; its own collateral; the change to its `0/0`; valid until a slot, as the account's transactions are. It's measured in the wallet, never as a draft through Ogmios. One step makes what a launch makes for both payers (`made`): the same outputs in the same order, the same certificate, the same checks.
- **S0d's search is core's** (`box_value.rs`): `way_back`, `least_box_lovelace` (about a dozen ways back, about 20 ms each natively) and `suggested_box_lovelace`, the least plus 0.25 ₳ rounded up to 0.5 ₳. Every token S0d measured comes to 4.5 ₳, as session 1 (14) said. S0d's test now holds core's search to its table, and to an ADA pool's least, 3.45 ₳.
- **`comes_back`** beside `usable`: whether a box already in a pool comes back, whatever a new box's minimum is now. It's the escape hatch's question; `usable` stops at the minimum first.
- **A token deposit holds 64 boxes** at most (the worker's `MAX_TOKEN_DEPOSIT_BOXES`): 71 boxes of the worst token fit with two inputs, and 64 with 31, the same room the classic pool's 96 leaves.

**WebAssembly**
- **Every chain names its pool** beside its request (`poolRef`). The classic functions keep their signatures, the pool-aware forms are `*_in` beside them, so the classic tests run unedited.
- **A session's chain into a token pool:** its deposit spends the session's own UTxOs holding the pool's token, its funding's, and never a stranger's. The tokens its boxes don't take come back with the return, read from the deposit's own outputs. A mix session funded for a token pool holds one UTxO: the boxes' ADA and their token together.
- **The public account's chain:** its UTxOs holding the token first, the most first, their ADA counted; then ADA alone. The token change's least ADA counts in what the account pays. The worker's test found it short without that: an account holding two boxes' worth in one UTxO ran out at the first mix.
- **What a funding names:** the token, Q × boxes.
- **New:** `buildLovejoinLaunchFromAccount`; `lovejoinBoxValue` (least, suggested, a token pool's most); `buildLovejoinWithdrawPaid`, signed by the paying UTxO's key and the collateral's. Both launches report L's reward account, for the worker's `account_info`.

**The worker**
- **A pool is named by its id** (`poolNamed`): the classic pool, or one discovery found and WebAssembly verified. Any other is refused, so a mix only goes into a pool every wallet is shown.
- **The tile's flows** take a pool: `mixOutBuild`, `againBuild`, `publicBuild`, `publicAgainBuild`, `funding` and `fits`. Each chain records its pool (`pools`) and each leaf's, so its boxes get that pool's due times. A swap's or a site's return still goes to the classic pool (34e).
- **Bootstrap replaces the seed** on both builds (`bootstrap`): a chain record and a mix entry marked so, held by 34a′'s rules until brought back by hand. At most 96 boxes in the classic pool, 64 in a token pool; from the private balance, as many as its funding's reserve pays the deposit for (`privateBootstrapMost`, review 3 below). `funding` keeps 1.5.0's shape (`seed` at depth 0), since 1.5.0's gate holds it; a mix session renames it. A seed record from before reads as it did, and its boxes still come back by themselves.
- **A pool's start** (`lovejoin-launch.ts`):
  - `terms`: what a box may hold (least, suggested, a token pool's most) and the token's shown pools, to join instead (14). Worked out in WebAssembly once an epoch per token and Q.
  - `build` checks first: the token in the list (20); Q a whole number; not a copy of a shown pool's values (11), once discovery has looked; an ADA pool not 10 ₳ (17); the box at least its least and, for a token, at most 9 ₳ (27). The fee cap is 1.5 ₳, under the box's ADA.
  - It's built twice, registering L and without the certificate, and the review shows the first. Send asks `account_info` whether something registered L already (it checked 30 boxes' worth in the token's supply too, `asset_info`, until call 35): then the build without the certificate goes, still standard (34c), if it makes the same pool or its own L is registered too (review 4 and 7 below).
  - Sent as any spend from its side: the private balance's with giveme.my's collateral (the default, session 1, 10); the public account's signed at review.
  - Kept, sealed, in the schedule (`launches`): no rule reads it, and the pool is read from once discovery finds it, as every wallet's is (§3).
- **The escape hatch** (§2):
  - Whether a token pool's boxes come back is measured once an epoch (`comes_back`, a withdraw built in WebAssembly).
  - A due box of a pool that can't is put off `STUCK_WAIT_MS` (6 h) and a spread, rather than built and refused every minute, each try costing a pool read.
  - `status` says so per pool (`cantComeBack`), for the page's offer.
  - `withdrawNow`'s `paid` brings a box back with the public account paying. The withdraw it keeps names its box and that it was paid; the private history's entry has no fee of its own.
- **Activity:**
  - Every pool's mix box names the account's deposits and mixes; a deposit of a token reads "Into Lovejoin · NIGHT".
  - "Started a Lovejoin pool" on either side: the private history from the send, the account's from its NFT left at the holder.
  - "Paid for a box back from Lovejoin" for the escape hatch.
  - A new pending kind, `lovejoin-launch`, told apart as a stealth mint is: the account's carries a slot.
- **New RPCs:** `lovejoin-mixes`, `lovejoin-bootstrap-release`, `lovejoin-launch-terms`, `-build` and `-submit`. The tile's builds take `pool` and `bootstrap`, and `lovejoin-withdraw-now` takes `paid`.

**The page**, only where the worker's change made it untrue:
- **The seed's offer is Bootstrap's**, behind *Help start the pool* as before. It's offered whatever the pool holds (D2's "any time"), with the floor's warning only while the pool is short. Its copy and reviews say the boxes stay until brought back.
- **Held boxes:** a callout with *Bring one back*, which asks first (a box nobody has mixed since shows its way in and out; one someone else's mix has moved comes back first), and *Bring them all back*.
- **Strings:** the seed's keys became `lovejoin.bootstrap.*`, beside the worker's and Activity's new ones, in es and ja. The critical ones, and eight more, were back-translated by an independent agent that saw only the Spanish and the Japanese. Its findings were applied, two of them the English's own (the note under *Bring them all back* read as a contradiction, and the box value's minimum as ambiguous).

**Tests:** core's launch (7), box value and pools tests; WebAssembly's `lovejoin_flows_test.rs` (7); the worker's `lovejoin-flows.test.ts` (14): a mix into the token pool from either side, end to end; Bootstrap from either side; a pool's start and every refusal; the escape hatch; Activity's names. Also the screens' `BootstrapHeld`, the seed's tests made Bootstrap's, and the e2e offer. The classic pool's tests and 1.5.0's gate pass unedited.

**The review's findings, fixed (2026-10-18).** An independent adversarial review of 84c2775 found nine; each is fixed, with a test.
1. **Privacy, high: every mix flow named its pool to Koios.** `split` read one pool, so `fits`, `againBoxes`, a session's chain, `publicBuild` and `publicAgainBuild` sent `credential_utxos` for that pool's `mix_box` alone. It lists the whole read set now, as a status read does, and takes the pool's rows. Test: every read naming a `mix_box` names both pools, through `fits` (either pool), `room` and a token mix's `publicBuild`.
2. **Privacy: a private launch landing read the public account again.** `lovejoin-launch` is in `PRIVATE_SPENDS`; the account's launch carries a slot, as an account-paid mint does. Tests: `private-refresh.test.ts`, either side.
3. **Money: a large private Bootstrap was funded, then couldn't deposit.** Capped: core's `bootstrap_most` builds the deposit from one UTxO of `funding_for(n, 0, box)` and the boxes' token, its change at a base address, and finds the most it pays for by halving. The worker's `privateBootstrapMost` asks WebAssembly (`lovejoinBootstrapMost`) once an epoch per pool, and `mixOutBuild` refuses more with "Bootstrap 1 to N boxes at a time." On preprod's parameters that's 53 classic boxes, 40 of LJTEST and 35 of the worst token. Growing the reserve instead would have changed 1.5.0's funding at depth 0, which its gate holds. Tests: core's `a_private_bootstrap_is_held_to_what_its_reserve_pays_for` (N builds, N + 1 doesn't); the worker's refusal before giveme.my is asked, with the public account's cap unchanged.
4. **Money: a launch rebuilt without the certificate could be another pool.** Both builds are made at review. Send sends the one without the certificate only if it makes the same pool, or `account_info` says its own L is registered too; otherwise it refuses (`lj.launch.otherPool`) and nothing is sent. Test: a build without the certificate made to name another pool is refused, then sent once that pool's L is registered.
5. **Money, low: the copy check read a stale list.** `build` calls `discovery.look` first, the request every wallet makes. Test: a pool the look finds refuses the start as a copy.
6. **Tests:** a 1.5.0 seed record (its chain a seed's, no `mixes`) still brings its box back by itself once someone else's mix moved it, as a Bootstrap's never does; a private Bootstrap's chain is recorded `bootstrap`, with its session and no due time, once its funding lands and the session runs.
7. **Privacy: a launch's `asset_info` and `account_info` went out at review.** Both wait for Send now (see 4), before anything is sent; the review asks only what any spend asks. Test: neither at build, both at Send before `submittx`.
8. **Privacy default, low: `from` missing or malformed launched from the public account.** Refused (`lj.launch.from`) before anything is read. Test: undefined, "", "account" and "Public".
9. **Display, low: a paid withdraw left the public balance stale.** One the account paid for drops the whole reading as it's sent and as it lands (`watchSent`'s `toAccount`, and `settleWithdrawing`). Tests: the escape hatch's, at both moments; `private-refresh.test.ts` for the watch.

The two new strings (`lj.launch.from`, `lj.launch.otherPool`) are machine drafts in es and ja; neither is in the critical set.

**For later steps:**
- **34e:** returns through token pools, the planner per pool (`MIX_FEE_ESTIMATE`, `per_box`), and D3.
- **34f:** the screens over these RPCs:
  - the hub, a pool's page and the mix cards (`lovejoin-mixes`);
  - the launch form (`lovejoin-launch-terms`, `-build`, `-submit`);
  - the tile's pool picker;
  - the escape hatch's offer (`status.pools[].cantComeBack`, then `lovejoin-withdraw-now` with `paid`);
  - Bootstrap per pool, with its progress below the floor.
- **34g:** the policy's *Changes* entry names a launch's `account_info` (and named `asset_info` until call 35), the account-paid launch and the escape hatch; and the launch's first real submit on preprod (S0c).

## 34e · The planner, returns through token pools, and four boxes a mix (2026-10-18)

Branch `web-wallet/token-pools-planner`, from main 9cb97a3. The step's row as built: each pool's costs, a return's tokens through their own pools (§6, §7), Change, a swap that funds its token's boxes (33), and D3. Core, WebAssembly and the worker; the screens are 34f's. Claude's choices, the owner's to overturn, but 33, the owner's.

**Core** (`seedelf-core/src/lovejoin/mod.rs`)
- **Each pool plans on its own mix** (`mix_fee_estimate`): 0.95 ₳ three wide, as ever; 1.35 ₳ four wide (1.214 ₳ measured on mainnet's classic pool and 1.227 ₳ on a token pool, and about a tenth); and 0.15 ₳ more a mix for a pool whose scripts no reference carries (0.114 ₳ measured). `per_box_in`, `boxes_affordable_in`, `funding_for_in` and `again_*_in` take the pool and the width. The classic pool three wide is the old functions exactly, at every depth and count (a test holds it).
- **A chain across pools.** `deposit_across` is one deposit: each leg's boxes at its own `mix_box` and value, then the token change, then the ADA change. `chain_across` fans each leg out in its own pool, a leg at a time, every mix paid from the one before's change. One leg three wide is `deposit_from` and `chain_from` byte for byte (a test compares the transactions); both are now that one leg.
- **`plan_across`:** the token pools first, each taking as many boxes as its token makes (Q each), its `most` and the ADA allow; then the ADA's from what they leave. It keeps back the least the tokens left need in their own change output, and nothing when the boxes take them all.
- **The width:** `mixes_per_box_at` ((width^depth − 1)/(width − 1): 1, 5 and 21 four wide), `fresh_for`'s `width − 1` others a mix, `fan_out`, `again_at`, `check_width` (3 or 4).

**WebAssembly**
- **A request's width** (`Wide`) **and a return's pools** (`Across`: `legs`, `fills`, `params`) are read on their own, as `poolRef` is. The classic native tests build their request structs field by field, so a new field would have edited them; `*_at` sits beside every `*_in`, three wide.
- **`plan_across_pools`, `chain_across_pools`:** a session's own UTxOs holding a leg's token, or `fills`', go into its deposit, and never a stranger's. `PlanResult.legs` and `ChainResult.legs` give each leg's boxes, a leg's leaves in that order among `leaves`. One pool named twice, or a token into two pools, is refused.

**The worker**
- **Four boxes a mix** (D3): Settings' `lovejoinWidth`, 3 by default (its switch is 34f's). `widthFor`: four goes when it takes every box it pays for, or as many as three would. Otherwise it goes three, and says why (`fellBack`):
  - the pool is short for four (`lj.width.warn.short`);
  - the chain would be longer than one goes, MAX_CHAIN_MIXES (`long`);
  - four costs more than the spare ADA pays a box at, where three pays for one (`cost`);
  - four didn't build, or the network's check of its first mix refused it (`refused`), so it's built again at three.

  Never fewer boxes for the width, nor a box back unmixed. It applies to the tile's mix from either side (`fits`, `publicBuild`), mixing again from either side (`againBoxes`, `publicAgainBuild`), and every session's chain (`fanOut`, `acrossOf`).
  - A mix session is funded at its width and keeps it (`mix.width`), whatever Settings says since: a session funded for three, sent four wide, would come up short. A swap's approval keeps its own (`auto.lovejoin.width`). Either without one is three, as 1.5.0 went.
  - A four-wide chain has two in the mempool at once (`CHAIN_WINDOW_FOUR`, carried as the progress's own `window`).
  - Its record and its views say `width: 4` (ChainRecord, LovejoinChainView, LovejoinMixView's chain): a chain's view says which width it went at (session 1's open question). How to word it is 34f's.
- **Returns through token pools** (`acrossOf`, §7):
  - Each token the session's own UTxOs hold a box's worth of goes into a pool of it, its ADA into the classic pool with what they leave: one deposit, one chain, the first mix in each pool checked by the network (`crossCheck`, its deposit and the change it spends as `additionalUtxo`).
  - A swap's fill counts as its own: the runner records the transactions it took for the fill or refund (`auto.fills`, outcomeOf). None from before.
  - **Which pool:** the review's (`session-back-build`'s `pools`, Change: by the token's unit, a null for back directly) or the approval's. Otherwise, the token's most used pool that takes a box now: not under its floor, with room for a box, and usable (a new box's minimum and its way back, measured once an epoch). Among equals, the earliest shown.
  - An approved swap takes no token into a pool its review didn't show (`only`): one it didn't name comes back directly, and so does one whose approved pool can't take a box now.
  - `SessionBackSummary.lovejoin` gains `parts` (each pool's boxes, `pool` none) and `ways`. Each way is a token: its pool, its boxes, the pools Change can offer, and why it came back directly, if it did (`lj.tokens.skip.warn.*`, or `sess.skip.warn.noBox` when the ADA left pays for no box of it). The chain's record has the token pools' shares (`pools`) and each leaf in its pool.
  - When no token goes in, the classic pool's chain is built from the same pool read.
- **A swap that buys a token a pool takes funds its boxes** (33):
  - `SwapLovejoin.ways` and `fund`: floor(minAmountOut / Q) boxes, at most what a chain, a deposit and the pool's room take, at the review's depth and width.
  - The funding's first payment carries that ADA beside `quote.fund`, which stays the approval's: `withinFunding` checks what leaves the account against the swap's own alone.
  - `session-out-build`'s `pools` is Change. As the user types, the quote names the token's first shown pool with no request; the review reads every pool's room once, and the parameters once for whether each is usable.
  - Stopped, the funding's ADA comes back with its boxes' share (`ifStopped`).
- **Every pool's room in one read** (`rooms`, `room(network, pool)`): one listing, as any read is, kept POOL_ROOM_MS. `poolsOf` and `usable` serve the review.

**Strings:** six new accuracy-critical keys, `lj.width.warn.*` (4) and `lj.tokens.skip.warn.*` (2), the worker's reasons, in es and ja. An independent agent that saw only the Spanish and the Japanese back-translated them. It found the Spanish "mezcla" with no subject (in `cost`, readable as the ADA doing the mixing), "sus" and "para él" loose for a token, and "alcanza a pagar". In the Japanese, 件 with no noun read as transactions, 空きボックス as empty boxes, and トークンに選ばれた as chosen by the token. Each was rewritten. The round is "Chunk 34's 34e round" in verified-critical-*.json.

**Tests:** core's `lovejoin_planner_test.rs` (9): the classic pool three wide as before, each pool's estimate, `plan_across`, a deposit and a chain across pools, four wide and short for four. WebAssembly's `lovejoin_across_test.rs` (4): a return's plan and chain across pools, a fill's token in and a stranger's out, four wide, the width read on its own. The worker's `lovejoin-planner.test.ts` (13):
- a return's token in its pool beside the ADA's, each mix in its own pool, its record;
- Change none, and a stranger's token out;
- `wayOf` for each kind of session, and `poolChoice`;
- a swap funding its MIN box (a MIN pool the wallet's own start makes), and its fill's MIN into the approved pool while a token its review didn't name comes back;
- four wide from the public account, two in flight; three when the pool is short or four doesn't build;
- a mix funded four wide staying four wide;
- `fits`, and the funding at four;
- the window;
- every pool's room in one read.

The classic pool's tests and the 1.5.0 gate pass unedited. The two preference tests that list every setting gained the width.

**Claude's calls, the owner's to overturn:**
- 1.35 ₳ planned for a four-box mix; 0.15 ₳ more for scripts carried inline.
- Four's rule: it goes when it takes all it pays for, or as many as three would. Four-wide mixes cost more, so a return's spare ADA makes fewer boxes four wide. That's four's price, not a fallback.
- A swap's token boxes are floor(minAmountOut / Q): what the least it asks for makes, never a box that may not fill.
- A fill is every transaction that arrived as the runner read the outcome: a stranger's gift in that reading would go in with it, into the approved pool only.
- One deposit holds MAX_TOKEN_DEPOSIT_BOXES (64) when a token pool is in it, all its boxes counted. Past it, or past one chain, the ADA's boxes go first, then the last token's.
- A token whose approved or chosen pool can't take a box comes back directly, never into another pool.

**Where it stands (2026-10-18).** Built on `web-wallet/token-pools-planner`. The review's ten findings below are fixed, each with a test that failed without its fix. Every check passed on the final tree: `cargo fmt --check`, clippy `-D warnings` (crypto, core, wasm), `cargo test --workspace --locked` (618), `wasm/build.sh` then `node --test` (53), `npm run typecheck`, Vitest 2,258 both builds (`VITE_ENABLE_MAINNET=false` too), `npm run build:ext` and e2e 100/100. Not run: the store build's e2e (CI's last step: never `package.mjs` in the main tree), and nothing on preprod. Next: commit (code, then docs), push and open the PR into main, as 34d's #318 went; then 34f.

**The review's findings (2026-10-18, each fixed with a test).** An independent adversarial review read the diff (no code run) and found ten. Line numbers are the tree's before the fixes. The tests are in `lovejoin-planner.test.ts`'s *34e's review findings* (3's in `swap-runner.test.ts`, 8's in core's `lovejoin_planner_test.rs`).
1. **Medium-high, privacy and backward compatibility 3: a token leg that fails sends the whole return back directly, ADA included.** `chain` returns `acrossOf`'s chain or its throw (lovejoin.ts ~2434). `buildBack`'s `leftOut` (sessions.ts ~3726) then returns it all directly when only the token leg failed: its pool's first mix refused by the network, a `PoolShort` for that leg, or a deposit over 16 KiB or short of ADA. 1.5.0 would have mixed that ADA. **Fixed:** a Lovejoin failure across pools (`narrower`) builds the classic pool's chain alone, from the same read; each token that was to go in comes back directly, `skipped` with `lj.tokens.skip.warn.failed`.
2. **Medium-high: a swap 1.5.0 allowed is now refused at review, with no `ways` to Change from.** `tokenWay` (sessions.ts ~1383) caps a swap's token boxes by the chain, the deposit and the room, never by what the private balance pays beside the swap. With a box worth about 10 ₳ that's about 9 boxes, about 76 ₳ more, and `buildFunding` refuses (`sess.notEnoughPrivate`). The pool read also comes before a funding that then fails. **Fixed:** a funding refused for the private balance (`NotEnoughPrivate`, by its type) is built again with the token's boxes at none, the token back directly and `skipped` with `lj.tokens.skip.warn.balance`. A swap the balance can't pay at all is refused as before. The pool read before it stays: it's the one listing every read is, kept POOL_ROOM_MS.
3. **Medium, privacy griefing (around final review F4): `auto.fills` takes every arrival as the fill** (sessions.ts ~3018). A stranger's UTxO holding 1 of the approved token and hundreds of junk assets goes into the deposit. Its junk's least ADA comes from the user's spare, and the junk comes back as the session's own token change; enough of it pushes the deposit past 16 KiB, which through 1 sends it all back directly. **Fixed:** a fill is a transaction whose every UTxO at the account holds ADA and the swap's `tokenIn`/`tokenOut` alone (`fillsOf`).
4. **Medium, over-funding: `againBuild` funds at Settings' width after `againBoxes` fell back to three.** `againBoxes` names its width only when it's four (lovejoin.ts ~2305), so `funding(..., undefined)` reads Settings' four, records `mix.width: 4` beside a `fellBack` saying three, and over-funds (about 16 ₳ a box at depth 3; it comes back with the return). `mixOutBuild` reads Settings twice the same way (sessions.ts ~1614). **Fixed:** both callers pass on the width chosen, three when none is named. `fits` and `againBoxes` return what they did, so the classic tests run unedited.
5. **Low-medium: the swap review prices only at the width asked.** `priced`'s `poolShort` and `fits`, `tokenWay`'s room and `stopCost` use four's need: a pool with room for three but not four reads "comes back directly" while the return falls back to three and mixes. **Fixed:** one rule for every chain's width, `wayOver` (fanOut, acrossOf, the review). The review weighs the token's boxes and the ADA's together, as one chain goes, and shows three with `fellBack` (new on `SwapLovejoin`) where four can't take what three would. Its approval keeps that width. `ifStopped` and Stop's dialog go from that width down, as the return does, each with its own `width`/`fellBack`. `skipped` is three's.
6. **Low: `collateralWanted` uses Settings' width** (sessions.ts ~3831): at four, a session whose spare pays a three-wide box isn't offered *Put in 5 ₳*, and reads `noBox`. **Fixed:** priced at three.
7. **Low: with both widths short, four is chosen,** so the refusal quotes four's need (`fanOut`'s and `acrossOf`'s rule; `againBoxes`, `publicAgainBuild`'s `count(4) >= count(3)` at 0). **Fixed:** four only when it takes a box (`wayOver`, `againWay`).
8. **Low: `plan_across` keeps the reserved plan as soon as it leaves tokens** (mod.rs ~1516), one token box short at a boundary. **Fixed:** the unreserved plan is tried first and kept when it leaves no token.
9. **Low, reads: `readSet` now runs where it didn't, and can ask the data layer for its pool list** (`discovery.refresh`, throttled by REFRESH_MS): a swap's quote as the user types (`tokenWay` → `poolsOf`), and a return whose spare pays for nothing (`acrossOf` before `countAt`'s gate). `usable` adds an `epoch_params` read at review. **Fixed:** a new dep, `known` (discovery's kept pools, asking nobody), serves the quote and `acrossOf`'s first look (`readSet(network, true)`). `funding` takes the pool as read, so the quote asks nothing at all. The review reads the parameters once, for `usable` and the funding alike (`readContract`'s `known`).
10. **Low, the plan and the code disagree:** `wayOf` gives `{}` for a swap with no `auto.lovejoin`, which then goes at Settings' width (maybe four) where the plan says three; and a swap's token leg at return isn't capped at the approved boxes, so a fill above `minAmountOut` can take more token boxes, and the classic leg's ADA, than the review showed. **Fixed:** such a swap goes three wide (its Stop dialog too). The approval keeps each token's boxes (`auto.lovejoin.tokenBoxes`), and its return takes no more (`ChainWay.returns.most`). Change at a return's review isn't capped: that review shows what it builds.

**Found while fixing:** core's `one_leg_deposits_exactly_as_deposit_from` passed about half the time. pallas-txbuilder keeps an output's tokens in a `HashMap`, so a token change holding two policies is written in either order, by chance, and so is the deposit's id. That's harmless on chain and true of every builder in the workspace. The test now compares byte for byte with one policy, and with two compares the transaction as the ledger reads it, its tokens sorted (`read_tx`).

**The strings:** two new accuracy-critical keys, `lj.tokens.skip.warn.balance` and `.failed`, in es and ja, back-translated twice by independent agents that saw only the Spanish and the Japanese ("Chunk 34's 34e review round" in verified-critical-*.json). The first pass found the balance reason readable as the swap itself being short, in the English too. All three languages were rewritten.

**Claude's calls in the fixes, the owner's to overturn:**
- A swap's balance short for its token's boxes brings the token back directly, rather than fund fewer boxes: finding the most it pays would take a build for each count.
- The review's width is its approval's: three where four falls back at review, so the token's boxes are funded at the width they go at. Where nothing pays at either width, it keeps the width asked, for its return to decide.
- A swap's token boxes that can't be funded beside it, for any reason but what another try may mend (a lock, Koios, giveme.my, a stale review, a trap), bring the token back directly with the balance's reason: too little ADA, or more of the private balance's UTxOs than one transaction spends, both mean the balance doesn't cover the boxes as well.

**The fixes' review (2026-10-18).** An independent read-only review of the fixes found no money bug in the worker's arithmetic, confirmed each test above fails without its fix for the reason it states, and found three wide unchanged, the reservations sound and the reads within the listing rule. What it found is fixed, each with a test that fails without it (`lovejoin-planner.test.ts`' *34e's fixes' review*; 7's public side in `lovejoin.test.ts`), but where said:
1. The retry was on `NotEnoughPrivate` alone. A funding whose token boxes took more of the private balance's UTxOs than one transaction spends (a balance of returned 10 ₳ boxes) still refused the swap. Now any failure but what another try may mend builds the swap's own funding again; the swap's own failing too is refused as before (tested).
3. The fallback marked every token with a pool `.failed`, over the `noBox` a leg had this time. Each try now starts each way afresh, and the fallback marks only those with no reason yet. No test of its own: a token leg with no box beside a classic box can't arise, as the token legs are paid first; the path is the first round's 1.
4. The width's counts and the guess were outside the fallback, so a failure there sent the ADA back directly. Both are inside it now: a guess that fails is the classic pool alone. `mixOutBuild`'s half of the first round's 4 has a test now too: Settings changed between the pool check and the funding.
5. Stop's dialog left out the token boxes' ADA when it hadn't read the account yet. The approval keeps it (`auto.lovejoin.fund`).
6. `funding` threw on a `pool: null` from a page (`typeof null` is "object"), which the old code read as the classic pool. Fixed there, and the handler passes a string or nothing.
7. The guess before any pool read took a token's first shown pool, where the build takes its most used: now its cheapest box.

Left open:
- **2, a release blocker until 34f:** the screens misstate a swap whose token boxes are funded. `fundParts` (`ui/swap.ts`) counts `lovejoin.fund` as room for network fees. With the ADA's boxes at none (a typical ADA→token swap) the review says it all comes back at once, though the token goes into its pool. There's no Lovejoin switch when `quote.fund` is under about 15 ₳. The `ifStopped` line quotes `quote.fund` while counting `fund` too. And `skipped` (the classic pool short) hides the cost while the token still goes. 34f's review takes these; no build from main ships before it (a 1.5.x hotfix would branch from 1.5.0's commit).
- **8, the owner's call:** four's price applies to a token too. Token legs are paid first, so at four an earlier token can take the ADA a later token needed for its box (four pays it none where three makes one). That token comes back directly, tied to the session, where three would have mixed it. Asked, the rule could hold every token leg to what three would make.
- 4's other half: a token pool whose boxes keep reading stale fails the whole return after STALE_POOL_TRIES (tried again later), as a stale classic pool does, where the classic leg alone might go.
- 3's other half: when the classic pool's chain after the fallback pays for no box, the return is plain and says `noBox`, not why its token came back (`chain` carries no ways without a chain).

Found sound: one leg three wide byte for byte as before; the fan-out at a width; indexing of legs, leaves and each leg's first mix, and `crossCheck`'s additional UTxOs; the records' `pools`, leaves, width and window; strangers' tokens kept out; `protocols_of`, `poolChoice`, `namedFor`; `narrower`'s exclusions; one listing for the rooms; the i18n keys.

**For later steps:**
- **34f:**
  - The swap review's words for a token's funded boxes (*The fixes' review*, 2): before any build from main.
  - Settings' four-wide switch. The review's Change over `ways[].pools`, with `session-back-build`'s and `session-out-build`'s `pools`. `fellBack`'s words on reviews, and a chain's width on its view.
  - The swap review's Lovejoin switch: the funding carries its token boxes' ADA when built through Lovejoin. Switched off at Send, that ADA comes back directly with the return. The page should build the funding again when the switch moves (a parameter for that is 34f's).
  - What still says three wide: the screens' `3 ** depth` (Settings, the Lovejoin page, LovejoinReturn), their costs, `lovejoin.mix.privacy.waves_*` ("two others, and three boxes come out"), and lovejoin-mix-width.md's "So the width stays three".
  - `collateralWanted` counts the classic pool's box alone, so a session whose only box would be a token's isn't offered *Put in 5 ₳ for Lovejoin*.
- **34g:** the live width test again (`lovejoin_width_test -- --ignored`), then four wide and a return across pools on preprod (Verification's step 8). No new reads for the policy's *Changes*: a review's pool read is the one every read is, and its parameters the ones every build reads.

## 34f · The screens (2026-10-18)

Branch `web-wallet/token-pools-screens`, from main 6ca8016 (after #319 merged). The screens over 34d's and 34e's RPCs, drawn from [session 1](#design-session-1-2026-10-17) (4, 5, 13, 14, 16), and 34e's release blocker. Mostly the extension's UI; the worker gained only what the screens had to read. Claude's choices, the owner's to overturn: none was asked this time, and every one is listed under *Claude's calls* below.

**Lovejoin's page is a hub** (`Lovejoin.tsx`; session 1, 4, 5, 13):
- **Your boxes:** where they're all in the classic pool, its rows word for word ("Your boxes in the pool", not mixed yet, the next one back: backward compatibility 7). Across pools, "Your boxes in Lovejoin" in all, each pool's set in under it, a token pool's token beside its ADA ("2 boxes, 200 NIGHT + 9 ₳"). Hidden with the balances.
- **Chains** and a public mix's progress, as before.
- **Your mixes:** `lovejoin-mixes`' entries, each joined with its private mix session where it has one (`mixItems`), and the mix sessions with no entry (a funding on its way, never sent, or over with its boxes back, the last few). Each card says what went in and where ("2 boxes of 10 ₳, 1 box of 100 NIGHT + 4.5 ₳"), who paid (a private session; a swap's or a site's return; the public account, by name with several), how many are back (and mixed again), four boxes a mix where it went four, and a Bootstrap's hold (*Held*; *Coming back* once released). A private mix keeps its stage, Stop and Try now. A chain stopped is said under Chains while it's listed there, and on its card once it's gone from there.
- **Pools**, grouped by token (`ui/lovejoin-pools.ts`): ADA's first, then the tokens held in either balance, then the most used (boxes not the wallet's, all its pools together); in a group, the busiest pool first. Each row: what a box holds (`boxText`: "10 ₳", "25 ₳", "100 NIGHT + 4.5 ₳"), its crowd (`crowdText`), the wallet's boxes in it, and its page's news (not mixed yet, held by a Bootstrap, can't pay its way back, *Being started: 12 of 30 boxes* with a bar, *You started it*). Search shows past four token groups. A start the wallet sent that no look has found yet is said under the pools.
- **Start a pool**, a button.

**A pool's page** (`PoolPage`, the classic pool's too): its box value as the title, its crowd as the aside (the classic pool's "The classic pool · …"), the wallet's boxes, where the data layer counted them the deposits its boxes could have come from (an ⓘ), its launch on Cardanoscan (the explorer's warning when this wallet started it), the escape hatch, the box actions, Mix and Bootstrap, each scoped to this pool (Bring one back now names it: `lovejoin-withdraw-now`'s `pool`). The hub owns the reads and every poll (sessions running, a public mix being sent), so they go on while a pool's page is open, and a Send comes back to the hub, where the mix is followed.
- **Mix in a token pool:** the stepper's value and every row carry the token; the stepper stops at the boxes of the token the paying side holds, and says so; the cost is said in ₳ alone, no share, since the wallet prices no token (session 1, 14).
- **Four boxes a mix on the form** (D3): priced four wide; where the pool has room for three and not four, the form says it mixes three at a time (`lj.width.warn.short`) and three's room decides.
- **Below the floor, Bootstrap leads** (session 1, 16): *Help start this pool*, a bar and "12 of 30 boxes not yours so far", the side that pays (its tabs move here), the offer; Mix says in a line why nothing can be mixed yet, with no Review. Above the floor, Bootstrap stays behind its link under Mix.
- **The escape hatch** (§2): a token pool whose boxes can't pay their own way back under the fees now says so, with what's left and what's needed; **Bring one back, paid by my public account** asks first, saying what it ties. A held box brought back from such a pool asks the same.

**Start a pool** (`LovejoinLaunch.tsx`; session 1, 10, 14, 17, 20, 21, 23): the token from the wallet's list (held first) or ADA; Q in the token's units; each box's ADA, suggested, with its least and, in a token pool, 9 ₳ as bounds (`lovejoin-launch-terms`, asked once typing pauses); the token's pools already shown, with their crowds, each opening its page (a copy highlighted, and Review off with why); Pay from, two tabs, private by default. The review: each box, who pays, what never comes back (the reference UTxO, the two scripts, the stake deposit) and its total, the fee, the total leaving and the balance after, "at most" for the deposit, what's public, the floor, and the no-audit note. Sent: the pool shows once a look finds it, and Bootstrap is offered from its page, never forced.

**Reviews:**
- **The swap approval** (34e's fixes' review, 2, the release blocker): *The swap and its costs* is the swap's own funding, its parts adding up to it, and *For NIGHT's Lovejoin boxes* is apart, the boxes' ADA (comes back) and their mixes; the costs count the token's mixes and their way back; the plan's last step says the proceeds come back in boxes (`swaps.plan.backTokenPool`); the switch shows wherever a token's boxes go or a pool could; *What you get, on the way back* names the pool with Change; the stop line quotes the whole funding; and the token's costs stay shown while the classic pool is short. **Moving the switch or Change builds the funding again** (`session-out-build`'s new `through`, and `pools`): off, no token's boxes are funded. Four's fallback is said, on the approval and in Stop's dialog.
- **A return's review** (Swaps and a site's session): each pool's boxes named (`partsText`), its tokens under *Its tokens* with Change (`TokenWays`), the width. Bring everything back names each pool's boxes, no Change.
- **A mix's reviews** name the pool's box value and its token, four wide, and why four went three.

**Elsewhere:** Settings' *Four boxes a mix* switch, each depth priced at the width (`depthCost`), and a line that a token comes back through its own pool. Home's In Lovejoin, a row per pool with something there. A site's way back priced at the width. The chain rows say four boxes a mix where they went four.

**The worker, for the screens:**
- `LovejoinStatus.crowd`, `.started`; `LovejoinPoolStatus.crowd`, `.launch`, `.mine`: a new `LovejoinDeps.facts` (discovery's launches and the data layer's crowds, from the device), wired in `sw.ts`.
- `lovejoin-withdraw-now`'s `pool`: with no box, one of that pool's boxes ("classic" for the classic pool), never another's that waited longer.
- `session-out-build`'s `through`: the approval's switch over Settings'.
- Summaries carry each token pool's box value by id (`values`: SessionBackSummary's lovejoin, SwapLovejoin; LovejoinChain inside); `LovejoinHeld.pools[].box`.
- `collateralWanted` counts a box of a token the session's own UTxOs hold, in a shown pool its spare ADA pays for (34e's *For later steps*): *Put in 5 ₳ for Lovejoin* is offered for a session whose only box would be a token's.

**Strings:** about 130 new keys in en, es and ja; the "10 ₳" keys became the pool's value (`lovejoin.boxesOf`, `lovejoin.mixes.boxesOf`, `claim.andBoxesOf`, …), English byte-identical for the classic pool. Seventeen are accuracy-critical, back-translated by independent agents that saw only the Spanish and the Japanese, thirteen of them twice ("Chunk 34's 34f round" in verified-critical-*.json). The first pass found the English itself ambiguous in three ("not whose" with no noun, "the rest" readable as the other UTxOs, an unnamed fee), and all three languages were rewritten for them.

**Docs:** flows.md (the hub, a pool's page, a token pool's mix, four wide, Bootstrap below the floor, the escape hatch, Start a pool, a return's tokens and the swap approval), architecture.md (the screens), privacy.md (the hub reads nothing new; why a crowd counts boxes not yours), lovejoin-mix-width.md (four is a choice since 1.6.0).

**Tests:** `tests/lovejoin-hub.test.ts` (30): a box's value in words, the groups' order and search, the crowd line, the pool rows and their news, the hub's first rows (classic-only word for word, across pools, hidden), Your mixes (order, cards, hidden counts, a stopped chain), Change, the swap approval's (all but the switch-off case fail on main's screen), a mix's reviews in a token pool and four wide, Home's rows and gate, Settings' switch. `lovejoin-pools.test.ts` (7 new): the facts, none on Koios, Bring one back scoped to a token pool and to the classic pool, a pool page's own errors, a start aged out, the held pool's box. `lovejoin-planner.test.ts` (4 new): the switch-off build, a return's values, the token collateral offer, and a swap's fill for it in its approved pool. Each worker test fails without its fix. The e2e's Lovejoin tests take the hub's extra tap, and the floor's test Bootstrap leading. A screen harness (the scratchpad Vite harness over the real components) rendered the hub, each kind of pool page, the launch form and review, and the swap approval, for the visual check.

**Checks (2026-10-18):** `npm run typecheck`; Vitest 2,299 on both builds (`VITE_ENABLE_MAINNET=false` too); `npm run build:ext`; e2e 100/100. No Rust changed. The Lovejoin e2e under `taskset -c 0,1 … --repeat-each=4 --workers=4`: two steps fail under that load, and fail the same on main's build (checked in a worktree): the first pool read after a restore (its assertion now waits 15 s, sized to the read) and Home's banner once a public mix lands (20 s already). Not run: the store build's e2e (CI's), nothing on preprod (34g).

**The review's findings (2026-10-18, each fixed with a test that fails without its fix, but where said).** An independent adversarial review read the diff and ran the suites; it found the approval's totals, the pool scoping, the hidden balances, the classic pool's words and the hub's effects sound, and twelve issues:
1. **Home hid In Lovejoin when every box was in token pools:** its gate read the classic pool's figures alone. `inLovejoinShown` counts every pool.
2. **A refused swap's switch or Change built it again**, and Watch then opened the new, unsent build's index. The switch and Change wait while a refusal shows. (No test: a refusal's foot over a review, which the screens' renders can't reach; the e2e's refusal paths pass.)
3. **The approval said all of the token is mixed:** what's less than a box comes back directly. It says so, about how much (`swaps.lovejoin.privacy.tokenRest`), and `onToken` says whole boxes.
4. **The switch showed where nothing would go in** (a token too short for a box, and, with the first fix, every swap with Settings' Lovejoin off). It shows when something goes, or when it was turned off on this review; a token that makes no box is said under the switch's place.
5. **The Mix form's four-wide fallback capped the stepper at four's room**, and priced four while it said three. The stepper offers what either width takes, as `widthFor` goes; falling back, the funding is asked at three (`lovejoin-funding`'s new `width`). Checked in the harness.
6. **Bring one back on a pool's page gave the other pools' errors.** They're scoped to the pool too.
7. **`collateralWanted` didn't count a swap's fill, counted a token its approval sent back, and strangers' with no session:** it follows `wayOf` now.
8. **A token→token swap's stop line quoted ₳ its boxes weren't priced on:** the funding's ADA counts only for an ADA swap, as the worker prices it.
9. **Home could say "2 boxes of 0 ₳"** for a pool not read this time: it names the pool by its id.
10. **A failed Refresh on a pool's page threw the user to the hub** (and back later): the page stays, saying the read failed, Review off. A return review's Change no longer outlives the review. (No test of its own; the e2e's refresh paths pass.)
11. **A start no look ever finds was said to be on its way for good:** a day on, it isn't said.
12. **Money statements were unchecked machine drafts:** *About 23 ₳ never comes back* (the form's and the hub's) and the deposit's *at most* are `.warn.` keys now, back-translated; `lovejoin.boxesOfTen`, removed, left the verified lists.

**Claude's calls, the owner's to overturn:**
- **The hub always**, even with the classic pool alone: Mix is one tap further than in 1.5.0, and the hub has Your mixes, the pools and Start a pool. The classic pool's page reads as Lovejoin's page did.
- **The crowd line counts boxes not yours,** with the server's deposits beside it, never its count of all a pool's boxes: the two side by side would give the wallet's boxes away while balances are hidden.
- **Search shows past four token groups;** the hub's aside becomes "A mixer for ADA and tokens" once a token pool is read; Settings gains a sentence that a token comes back through its own pool (true of every return now).
- **Below the floor, Mix collapses to its reason** and Bootstrap leads, with the tabs.
- **A Send goes back to the hub**, where Your mixes and the chain show it.
- **A token pool's mix cost has no share**, as the wallet prices no token.

**For 34g:**
- The policy's *Changes* entry, with the release PR (19): 34c's and 34d's reads, as their sections list them; 34f adds none.
- The preprod rehearsal over these screens, Claude's in dev mode, then the owner's by hand (29).
- The style pass waits for feature parity (the owner, 2026-10-02); the owner's look at these screens comes first.

## 34g · The preprod rehearsal and the release (2026-10-18, in progress)

Branch `web-wallet/release-1.6.0`, from main e6b5dae (after #320 merged); sessions 1 to 3 committed as 8cc0044 (code) and 030fdcf (docs), the last review's fixes on top (*The last review* below), and session 5's three owner calls on top of those (the owner: "start 34g", then "get a handoff going right now so we can continue this into a new context window"). The step's row: Claude's preprod rehearsal in dev mode, the release review across everything since 1.5.0, its fixes, the policy's *Changes* entry, the lists and the version; then the owner's rehearsal by hand, the PR, the deploy and the upload.

### Start here (the next session)

**Next:** the owner's items (item 4 under *Before session 5*, as it now reads), then item 5: PR, CI, the API deployed first, then the package. Session 5 is committed and pushed (*Session 5* below).

#### Session 6: the owner's test by hand (2026-10-19, in progress; items 1–5 pushed)

The owner tests chunk 34 by hand on the dev build and hands over items, mostly the screens'. Each is fixed with a test that fails without it, looked at in the screens harness, and `dist` rebuilt.

1. **The Mix form never said how much could go in.** Testing the MIN pool: "I just keep clicking the up button … but dont really see how much I can put in nor does it limit my box count by that amount". Found: from the public account the stepper went to ten whatever its ADA (only its token held it back), at ten it stopped with no reason, it never showed a balance, and a side holding none of the token kept "4 boxes" beside "too little MIN for one box". Fixed: what the paying side holds beside the boxes' label ("180 ₳ · 450 MIN", Bootstrap's too; `HeldOnSide`); the public account's ADA holds the stepper (`mixMost`, nothing kept aside: its collateral is apart and the deposit's fee is in the reserve), with `capBalancePublic`, `noneAffordPublic`, `cantAffordPublic`; at ten, `capMix` ("At most 10 boxes go in at a time"); the count drops to one where none fits (`boxesShown`). The owner asked for ADA pools too, so the classic pool's form gains the balance line and the ten line: two lines added to backward compatibility 7's byte-identical form, nothing reworded. Test `lovejoin-held-balance.test.ts`.
2. **A mix's card dropped its transactions for "0 of 4 back".** 34f's card took the entry's view as soon as a private mix had one: *Coming back* and "x of N back", nothing of a chain still landing or retrying. Asked: tx state, then the count; tx state only; or both. **The owner: "Tx state only, no count."** The card keeps a private mix's session tag and line throughout as 1.5.0's list did (`tagOf`, `subOf`, `detailOf`); any other mix says "3 of 9 transactions sent" or where it stopped while its chain's record is kept, *Done* after. `lovejoin.mixes.back` and `.backMoved` are gone. Tests in `lovejoin-hub.test.ts`.
3. **Your mixes would grow without end, and so would Pools on mainnet** (the owner, after item 2: "a clear button … or clear all that clears all not in flight mixes", pagination, and "a grid where the token gets the token image"; the three calls asked, each the recommended one). **Clear** on each card not in flight and **Clear all** for them: a `cleared` mark on the list's entry (sealed schedule, `MixEntry`) and on the mix session (`mix.cleared`), set by `lovejoin-mixes-clear`, which skips a chain being sent and a session not over (`clearable` in the page). A cleared entry's session stays named as listed, and the last few over are picked before the cleared go, so clearing brings no older ones in. Ten at a time, `tokens.showMore`. **Pools as a grid** (`PoolGrid`) once there's more than ADA's group: logo, ticker, the wallet's boxes or how many pools; a token with one pool opens its page (`tileOpens`), one with more its own screen (`PoolGroupList` untitled); a pool's Back returns there, a sent mix to the hub (`onHub`). ADA's alone keeps its rows, so a classic-only hub reads as before. Tests in `lovejoin-hub.test.ts`, `lovejoin-release-rules.test.ts`. Found by the full e2e run: on preprod the hub's first read lists the classic pool alone, and the grid comes with the read after the look finds the head start's MIN and 5 ₳ ADA pools (R10's read again), so a test that clicked fast saw rows and a slow one the grid; the e2e now opens the classic pool through ADA's tile on preprod (`classicRow`) and comes back through ADA's list (`poolToHub`). A fresh preprod device sees the rows turn into the grid a moment after opening; mainnet bundles no token pool, so its hub keeps rows.
4. **Mix my boxes again went three with four set, and nothing let a mix choose** ("it will default to 3 instead of attempting … 4 as possible. And I dont have an option for that"). `againWay` went four only where four took as many boxes as three. **The owner: "Four now, rest next press"** (the review already said "Mix the rest once this is done"), **and a per-mix switch, default from Settings.** `againWay` goes four wherever four takes a box; `atThree` says what three would take, on both sides' again reviews (public's gained `owned`). The *Four boxes a mix* switch (`FourSwitch`, Settings' keys reused) is on the Mix form and Mix my boxes again's review, one width a page; every build takes `width` (`lovejoin-mix-private-build`, `-public-build`, `-again-build`, `-again-public-build`, `lovejoin-funding`, which no longer caps at Settings'). The form's `formWidth` (four going three behind the setting) became `formRoom`: at four the stepper stops at four's room or one chain's length, with `capFour`/`noneFitFour` naming three's. Tests in `lovejoin-planner.test.ts` (the old fallback test rewritten to the new rule, mutation-proven), `lovejoin-screens-review.test.ts`, and the mix-again e2e turning the switch both ways.
5. **No way to get everything out of Lovejoin at once** (the owner, after Bring them all back on a Bootstrap: "a user has no way to do an emergency like get everything out of lovejoin oh crap button"; then "it could be in the settings … you have to confirm it … then it just does a proper chain and removes it all"). Asked: one at a time or many in flight; and whether nothing new goes in meanwhile. **The owner: one at a time ("just more things to break"), and only what's there now.** One at a time without the hour: `withdrawOne` frees its slot once a submit is taken, so the next goes at once, and only a box's waits held them apart. **Bring every box back now** in Settings → *Lovejoin* (not "Bring everything back", a session's), behind its question (`BringAllBackQuestion`, `settings.lovejoin.privacy.bring` and `.bringCost`): `lovejoin-bring-all-back` seals `bringing` in `lovejoin.<network>`, and every run from then (`bringAllBackNow`, from `withdrawDueNow`, the unlock's too) takes every box, mixed or not, a Bootstrap's held ones too (`bootstrap`, so its entry counts them), the classic pool's first, a stuck pool's paid from the private balance (call 36), for `BRING_RUN_MS` (2 min) a run; it waits as Bring one back now does (a chain being sent or mixing again, a withdraw that may have gone through, a payment that may), and leaves reserved boxes to their chain. Over when a run finds no box it can take: due times and counts cleared for Home. `BRING_FAILED_RUNS` (3) runs that sent nothing (a pool read that failed counts) stop it with the latest reason (`settings.lovejoin.warn.bringStopped`) and *Try again*; **Stop** forgets it. Settings reads `lovejoin-held`'s `bringing` every 4 s (`BringAllBackView`). Tests: `lovejoin-bring-all-back.test.ts` (real WebAssembly: four boxes in two pools and a Bootstrap's in one run, then over; waits for a chain being sent, mutation-proven; three failing runs stop it, asked again it goes; a failed pool read; Stop), `settings.test.ts`, and an e2e (asked with nothing in Lovejoin: kept, then over). The three critical keys back-translated blind over three rounds (`verified-critical-*.json`); most fixes were the English's own. The boxes come back as that many private UTxOs, which also tests spending many of them at once (the owner).

#### Session 5: the owner's three calls of 2026-10-19, built

After the last review (below) the owner went through its open calls and made three, each reversing a rule Claude had added on top of the contracts (memory *no-paternalistic-guards*: the wallet refuses only what the ledger or the contracts refuse, a user's mistake is the user's, and the private balance pays by default wherever the public account could). Session 4 started them (core's `withdraw_private`) and stopped for a new context; session 5 (2026-10-19) built the rest, with agents by area in the one tree (supply, WebAssembly, screens, docs), then two read-only reviewers by lens, a blind back-translation round, and mutation proofs.

**Asked and decided this session:** where the wallet picks a pool itself (a return's tokens, `acrossOf`; a swap's token pool, `tokenPool`; Change's list), Claude proposed it keep avoiding a pool whose boxes can't come back. The owner: **"Treat it like any pool"**, with the review saying so. Built as `LovejoinTokenWay.stuck` (`lovejoin.ways.warn.stuck` under the token's row).

**Call 34 · A mix that passes the logic is allowed.** `usableNow` (`lovejoin.ts`) refuses only a box below the network's minimum (`belowMinimum`) and a copy (`superseded`, not for mixing again); a pool whose boxes can't come back (`cantComeBack`), or where the check couldn't be made, takes new boxes from every flow, either side. `LovejoinUnusable` is narrowed to those two; `lj.unusable.warn.cantComeBack` and `.unchecked` are gone. The status measures `cantComeBack` for every token pool, the wallet's boxes there or not, and the pool page shows the stuck callout (`lovejoin.stuck.warn.lead`) before Review whenever it's set; its *Bring one back* only where the wallet has a box the hatch takes. The hub's row flags every stuck pool. `stuck()` and `acrossOf`/`tokenAt` flag a token's way. The due-time withdraws are unchanged: a stuck pool's due box waits `STUCK_WAIT_MS`, and nothing pays for it by itself. The anyway question's "Mix my boxes again hides it first" is its own key now (`lovejoin.anyway.privacy.hides`, `.hidesPublic`), said only where that button works.

**Call 35 · No supply check at a pool's start.** Gone from the wallet (`lovejoin-launch.ts`' `choose()`, `LAUNCH_SUPPLY_BOXES`, `assetSupply` in `koios.ts` and `data-layer.ts`, `lj.launch.supply`, `lj.launch.unknownToken`, the 30 × Q cap at build: Q's only bound is the ledger's, and core refuses a k × Q past a u64 in words) and from the server (`assets.rs`, its tests and README: byte-identical to e6b5dae, `asset_info` takes the one `select` again). A start asks only `account_info`. Docs: the policy, privacy.md, the listing's per-host Koios row; this plan's decision 14 and §5 struck through.

**Call 36 · Bring one back paid from the private balance, by default.** Core `lovejoin::withdraw_private` (one Seedelf UTxO of ADA alone beside the box, its own proof bound to a one-time key, giveme.my's collateral, the wallet contract's reference script; `PrivateTooSmall`). WebAssembly `buildLovejoinWithdrawPrivate(key, { network, params, pool, boxRef?, utxos, poolRef? })` tries the UTxOs in the worker's order, skipping a token's, another wallet's, one with a reference script, or one too small, and answers the transaction **unsigned** with the one-time key's `seed`, as every Seedelf spend (`{ txCbor, txHash, seed, fee, lovelace, spent, spentLovelace, boxRef, token? }`); none pays: `NO_PRIVATE_PAYS`'s fixed words. The worker (`withdrawOne`, `paid: true | "private"`): `readContract`'s UTxOs (nothing locked or reserved), one a box back from Lovejoin made first, then the smallest; giveme.my's witness, then `signScriptSpend`; `Withdrawing` names its `box` and keeps the history's `origin` (the box's way back merged with the paying UTxO's class and any account ties), and `lovelace` is what came in, net of the UTxO that was private already; `settleWithdrawing` writes the same history. None pays: `lj.privatePayNone`. The handler passes `"private"` or `true`, nothing else. Screens: the escape hatch's question (`PaidQuestion`), a held box's (`HeldQuestion`) and a not-mixed box's (`AnywayQuestion`) in a stuck pool each offer *Pay from my private balance* (primary, first) and *Pay from my public account* (a button), each with what it ties (`lovejoin.stuck.privacy.private`, `.public`); the callout's link says *Bring one back*.

**The cross-area review** (two read-only reviewers by lens, MONEY/WORKER/RUST and SCREENS/I18N/DOCS, over the uncommitted diff): nothing high. Fixed, each with a test that fails without it:
- **Screens M1:** in a stuck pool, now reachable, the pool page's own reviews and form still promised each box back after its wait. The reviews open with the stuck callout and drop the "Back later" rows and the mix's hint (`reviewHint`); the form's each-box-back row goes (`EachBoxBackRow`). The classic pool's markup is byte-identical, captured before and after.
- **Screens M2:** Bring everything back (`ClaimAll`) never said a token's pool was stuck: a warn callout names each such token (`claim.warn.skippedItem` with `lovejoin.ways.warn.stuck`). The other return reviews show `TokenWays` already.
- **Worker M1:** nothing tested that a return's or a swap's way carries `stuck`: `lovejoin-planner.test.ts`, a return through LJTEST at 4,800 a byte and a swap's MIN box at 12,300 (a 4.5 ₳ box is stuck only in a narrow band, about 11,950–12,780).
- **Lows fixed:** a box worth less than the withdraw fee itself was a plain error, read as a check that couldn't be made (no warning, no payer, the due run building it every minute): core now calls it `CantPayBack` (`PrivateTooSmall` paid from the private balance, so the next UTxO is tried), test `a_box_worth_less_than_the_fee_cant_pay_its_way_back`; `lj.privatePayNone` said "make some ADA private" when every UTxO was locked or waiting for a return (now `nothingToSpend`'s words); a pool read measured each token pool twice an epoch (usable's measure now answers whether a box comes back too); the payer buttons lost the `danger` the questions had (the private payer is `danger`, still first); "Next one back" and the Bootstrap's "come back by themselves from then on" hidden in a stuck pool; the shared `isHistoryClass`; the private Bootstrap's gate tested in a stuck pool; flows.md's "beside it"; the listing's character count (2,538).
- **Left, for the owner** (below): L5, a return reviewed before its pool turned stuck goes in anyway, with the warning only on the session page after (follows the owner's call); the policy's date; Change's list doesn't mark a stuck pool until it's chosen; the stuck callout doesn't tell a user with no boxes there that Bring one back comes with a box.

**Checks on the final tree** (after the review's fixes): Rust fmt and clippy `-D warnings` clean, 626 + 115 tests over both workspaces; WebAssembly 205 native and `node --test` 55 of 55; `tsc` clean; Vitest 2,430 passed + 4 skipped on both builds; e2e 100 of 100 on the dev build and on the store build (`build:store`, not `package`, so no release zip was written), and the data layer's 3 of 3. Every worker fix's test fails with that fix reverted in a copy of the extension (thirteen mutations), and the core and screens fixes' tests failed before their fixes. The paid question and a stuck pool's page, with and without the wallet's boxes, looked at in the screens harness. The blind round: three rounds each language (`verified-critical-*.json`'s note); most fixes were the English's own.

**For the owner, from session 5:**
- **giveme.my sees a private-paid withdraw as any Seedelf spend** (unsigned, then the one-time key signs), but nobody has sent one: preprod has no stuck pool, and giveme.my won't sign a synthetic transaction (memory *preprod-ogmios-probe*). The core test runs both scripts with real proofs, and the WebAssembly test signs with a stand-in for giveme.my's key. A preprod pool launched with too little ADA a box would make one reachable, if wanted.
- **Two "Bring one back" links** show on a stuck pool's page where the wallet has both a mixed box and a Bootstrap's held box, each in its own callout (the hatch's and the hold's). Left as they are.
- **Older than this session, not changed:** for a box another account's public mix put in, the anyway question still says "Mix again from my public account hides it first", which the active account's button doesn't take (the page's other-account note says to switch).
- **The privacy policy's date:** its 18 October entry (not shipped) now carries calls 35 and 36, made on the 19th. Keep "Effective 18 October 2026", or re-date it?
- **A return reviewed before its pool turned stuck** (a new epoch's fees between the review and the chain's build) goes into it all the same, as call 34 has it; the warning then shows on the session's page, after. Say so at review, or accept?
- **In a stuck pool, a mix's review drops its whole hint**, since the sentence promising each box back shares one key with the rest ("Once funded … what isn't used comes back with the 5 ₳ kept aside"); its rows say the rest. Bring everything back's total row still says "back after {{delay}}" under the new warning, as it sums every pool's boxes.

#### Before session 5

Session 3 (2026-10-18/19, a new context; same branch; committed at its end as 8cc0044 and 030fdcf) did steps 1 to 3 of the first handoff, and fix round two with its two reviews (*Fix round two* below). Session 4 (2026-10-19) ran a last review of all of 34g and fixed what it found (*The last review* below), committed on top and pushed. Where it stands:

1. **Done:** fix round two and its last review's fixes; the rehearsal's *Still to see* (below); `npm run lovejoin-pools` (preprod: the MIN pool `dfa1f845…` and the 5 ₳ ADA pool `18c4df77…`; mainnet: none); the data layer's decimals (byte-identical, registry `a7f2aed`, nothing to commit); the store listing's Lovejoin text (the owner: "Draft it now").
2. **Checks on the final tree** (session 4, after the last review's fixes): `tsc` clean; Vitest 2,400 passed + 4 skipped on both builds (`npm test`, `VITE_ENABLE_MAINNET=false npm test`); e2e 100 of 100 on the dev build and on the store build, and the data layer's 3 of 3 (`npm run e2e:data`); Rust on 030fdcf, which the last round didn't touch: 736 tests over both workspaces, fmt and clippy `-D warnings` clean.
3. **The rehearsal's wallets** (A, B, C on 47001–47003) run on, so B's last boxes come back by themselves; A holds 39 Bootstrap boxes in the MIN pool for the owner's run.

4. **The owner's** (ask, don't do): the live db-sync tests (`cd seedelf-data && cargo test --test live_lovejoin -- --ignored --test-threads=1 --nocapture`; `live_public`'s `total_supply` part and the `SUPPLY` timing went with call 35); their own rehearsal by hand (decision 29), perhaps on Claude's MIN pool, which holds 39 of A's Bootstrap boxes; a look at the store listing's new Lovejoin text (below); the calls under *For the owner*.
5. **Then:** (committed and pushed) PR into main (`gh api -X PATCH` for body edits, memory *gh-pr-edit-workaround*), CI; after the merge, **deploy the API first** (34c's token routes, DATA-3/4; PRIV-2's `asset_info` route went with call 35, so the wallet asks `asset_info` only as 1.5.0 did), check `lovejoin/pools` and `lovejoin/tokens` answer 200 by hand (the deploy's `/health` says nothing of them), then package from the merge commit, upload, and the record PR with the zip's hash (memory *web-wallet-branching*).

### The rehearsal (Claude's, dev mode)

Three wallets in headless Chromium, each kept unlocked and steered through the worker's own RPCs and the screens (the harness below). **A** is the funded test wallet (`extension/.preprod-test-wallet.txt`), **B** a fresh phrase, **C** a fresh phrase started on 1.5.0's build. Every transaction is on preprod.

| What | Transaction | What it showed |
|---|---|---|
| A starts a MIN pool from its private balance, 100 MIN + 4.5 ₳ a box (the suggested ADA) | `5ef638917a4f3ad7c6300ef18153fff77dccf97a7c5a51a639e0b42e48cb5cf2`, pool `dfa1f845…` | **S0c is settled:** cert 0 registers `mix_logic` with no script witness, and giveme.my signs a launch. Locked 23.11 ₳, fee 0.48 ₳, as the review said. Discovery found it about 10 minutes after its block (the `tx_info` look), as designed. |
| A swaps 150 tADA for MIN privately | out `736bc965…`, swap `d9490cf4…`, back `6548b64d…` | 13,507 MIN back in about 3 minutes. |
| A Bootstraps 40 boxes from its private balance | funding `cca5bdf5…2b76dd`, deposit `ccf7f1d8…`, back `ab624108…` | **Found the release's worst bug** (R0 below): the boxes got due times. Fixed, then held: 40, no due time; Home shows them (MONEY-4's fix). |
| B (fresh) gets 1,500 tADA and 5,000 MIN from A, moves 900 tADA and 2,000 MIN in, sets collateral from the pool's page | `1b947f26…`, `b39ff373…`, `19e6eb09…`, `1c32eccf…`, `03859d16…d7ea57` | The pool page's *Set collateral* comes back to the pool (R6 below). |
| B mixes 2 MIN boxes from its public account, depth 2, three wide | first `d20d4fb6…853880`, 9 of 9 | |
| B mixes 2 MIN boxes from its private balance, **four wide** | funding `e6028c8e…9df97f`, 12 of 12 | The review says "four boxes a mix" and "one of up to 16"; two in flight at once. |
| B swaps 5 tADA for MIN privately, Settings at four wide | out `5a665d42…`, swap `627d8f9a…`, deposit `0204cded…`, back `92dbe4e3…`, 18 of 18 | **A swap that funds its token's boxes, and a return holding the token, through its pool** (Verification 5): 4 boxes funded (18 ₳ + 16.7 ₳), and **four's fallback to three** said on the approval ("hasn't enough boxes free to mix four at a time"), "one of up to 9" (Verification 8). 52.75 MIN, less than a box, came back directly. |
| B starts a 5 ₳ ADA pool from its public account | `2a8029dc6469a7b9f99b0a14640b2695c2f265015ac32fd076d5d737c765b393`, pool `18c4df77…` | **The account-paid launch, and an ADA pool on the new contracts** (decisions 10, 17): found by B, then by A. |
| C, on 1.5.0's build (63f87b8, a worktree), moves 200 in and mixes 2 classic boxes privately; at 4 of 10 sent, the browser restarts on 1.6.0 | `144bb495…`, `55c94e84…`, `d2a53410…` | **The upgrade, live:** 1.6.0 reads the 1.5.0 record mid-chain and lists the mix; the restart cut the chain, as any restart or lock does (1.5.0 the same, the gate's case); its 2 boxes read "not mixed yet". |
| C mixes them again on 1.6.0 | `c6210cd1…`, 9 of 9 | The cut mix's entry closes as its boxes move; 2 boxes due. |
| A brings one Bootstrap box back by hand, on the fixed build | `eda62e40…71c952` | It asks first ("Bring back a Bootstrap's box?", PRIV-5's fix); 39 held, the entry counts 1 back. |

Also: the live width test again (`lovejoin_width_test -- --ignored`): unchanged on both networks, four fits at 98.8–98.9% of the step limit. PR #163's dev pool (`c5852bb7…`) isn't in either wallet's read set (Verification 7). The token list didn't change; the DReps did (mainnet +3 named: Adalion, CryptoDossier, Endubis Hub; QuocTuan no longer registered).

**Session 3's part** (2026-10-18/19), on the same three wallets and three restores of them:

| What | Transaction | What it showed |
|---|---|---|
| B's MIN boxes, and C's 2 classic boxes, come back by themselves | B's first at 22:23:33, a minute after its due time, then 22:44, 23:34, 00:46, 01:45; C's at 00:05:33 and 01:30:33 | **Verification 4, in a token pool:** B's private MIN went from 1,852.745746 to 1,952.745746, one box's 100 MIN; C's came back on time after the 1.5.0 → 1.6.0 upgrade. |
| B2: B's phrase restored on a fresh profile | none | **Verification 6:** the hub's look found both new pools and B's 8 MIN boxes, each a fresh due time. Found **R10** and **R12** (below). |
| A2: A's phrase restored on a fresh profile | none | Of A's 39 held Bootstrap boxes, the 37 B's mixes had moved got due times; the 2 still at the deposit read "not mixed yet" (**R11**). Home: "In Lovejoin 37 boxes … 2 not mixed yet: open Lovejoin to see what to do." Stopped before its first due time, so A's crowd stays for the owner's run. |
| B mixes 2 MIN boxes privately, **three wide** | funding `1654998a47…b22bf7`, 10 of 10 | The review: 8 mixes, "one of up to 9 boxes at 2 waves deep" (four wide said 16). |
| B3: B's phrase restored again, on the fixed build | none | **R10 and R12 fixed, live:** the hub read "None", then with no Refresh "3 boxes, 300 MIN + 13.5 ₳"; `seedelf.sessions` armed after that read. |

What preprod can't reach stays as it was: the floor (preprod's is 0, R2), the escape hatch (needs a pool whose boxes can't pay their way back), and the data layer (FEED's fix of the mainnet stall is tested offline only).

**The harness** (all in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/2c01f20b-bc3b-453d-8ae9-c6a3d6e0af08/scratchpad/rehearsal/`, gone after a reboot): `driver.mjs <name> <phrase file|new> <port>` runs one wallet on a persistent profile (`profile-<name>`), restoring or unlocking it, keeping it unlocked, logging every request to `net-<name>.log`; A on 47001, B on 47002, C on 47003, running (nohup). `rpc.sh <port> '<json>'` asks the worker; `pw.sh <port> '<js>'` runs Playwright with `page`, `ask`, `context`; `state.sh <port>` prints sessions, pools and mixes in a line; `unseal.mjs <port> <record>` opens a sealed record with the test wallet's own store key; `NOTES.md` has every transaction; `wallet-B.txt`, `wallet-C.txt` the phrases; `shots/` the screens. To move a wallet to a new build: `curl -X POST http://127.0.0.1:<port>/quit`, then `DIST_TAG=<new tag> FRESH_DIST=1 node driver.mjs …`. **FRESH_DIST deletes the profile's `Service Worker` folder: Chrome otherwise goes on running the old worker script for an unpacked build of the same version, even from a new path** (it cost an hour here). `DIST_FROM=<dist>` loads another build (1.5.0's is `scratchpad/wt-150/…/extension/dist`, a git worktree: `git worktree remove` it when done).

### The rehearsal's findings

- **R0, high, fixed (the lead):** a private Bootstrap's boxes weren't held. `bootstrapOf` looked for them at the mix entry's `id`, its chain's last transaction, which for a private session is the return, not the deposit; every box got a due time at the next pool read and would have come back by itself, unmixed. The entry now keeps its chain's deposit (`MixEntry.deposit`, from its record where an older entry lacks it). Test: `lovejoin-flows.test.ts`' private Bootstrap, through a pool read and past the record's life; it fails without the fix. The release review found it too (STATE-1, MONEY-1).
- **R1–R7, low, fixed by SCREENS:** the banner's "Starts a Lovejoin pool sent."; a review's total saying "and 1 token" for a named token; "their mixes" on a Bootstrap's review; the pool page still saying the collateral was on its way after it landed; the launch's review without the floor's note.
- **R2, a limit:** preprod's floor is 0, so the owner's rehearsal won't see Bootstrap leading below the floor either.
- **R5, fixed:** `e2e/live/lib.mjs` pressed "Send", which no review says now; it reads the review's own "Nothing is sent until you press …".
- **R9, R10, R12 and the open lows, fixed in fix round two** (below): the public reviews' "Public account after" (the launch's and the new pools'; the classic pool's review stays byte-identical, backward compatibility 7), step 4's words on a swap's session page, Mix my boxes again over held boxes (MERGED-4); the mixes view's `deposit` was stripped in round one.
- **R10, medium, fixed:** a wallet restored on a fresh profile opened the hub to the classic pool alone and "None" of its boxes: the pool read answered while the look was still finding the token pools, and nothing read again until Refresh. The look now answers `{ grew }` and the hub reads again on it.
- **R11, a limit:** a restore can't know a Bootstrap's hold (mixing hides which deposit a box came from), so on a restored device a Bootstrap's boxes that others' mixes moved come back by themselves; those still at the deposit wait for Mix again, as any deposit's do.
- **R12, high for restores, fixed:** on a restored wallet, token-pool boxes never came back by themselves until the next unlock. The unlock's run found nothing on its way back (the token pools were unknown until the hub's look) and stopped the alarm; the hub's read then gave the boxes their due times (`scheduleFound`) and nothing armed it again: B2 sat four hours with 8 boxes due and made no request. `scheduleFound` now starts the alarm. 1.5.0's was the same, but a classic restore's first read could fall inside the unlock's run. Test: `lovejoin-merged-review.test.ts`' R12 block (a token pool, the classic pool, nothing found), the first two failing without the fix.

### The release review and its fixes

Five independent reviewers, each a lens over `git diff 63f87b8..e6b5dae` (#308–#320): money, privacy, data layer, screens, state. Then five fixers in the shared tree by file ownership (FEED, RULES, DISCOVERY, SCREENS, RUST), each test first: every new test failed before its fix. The reports, with file:line, are in the scratchpad's `review/` (`money.md`, `privacy.md`, `data.md`, `screens.md`, `state.md`; `FIXES.md` the fixers' brief; `fixed-*.md` what each did).

- **High, fixed (FEED): on mainnet, chains into token pools would stall** (DATA-1 = PRIV-1). Every chain watched its steps on the data layer's classic `lovejoin/since`, which lists the classic pool alone, so a token pool's deposit and mixes were never seen and a chain past its window never moved on; preprod reads Koios, so no rehearsal could show it. Now each step is watched on its pool's feed (`"tokens"`, over `lovejoin/tokens/since`; `watchOf`), `tx_status` only for a pool the feed doesn't cover, so no hash goes to the server while a feed can say. Tests: `feed.test.ts` (3), `lovejoin-token-feed.test.ts`.
- **Medium, fixed:** a token quantity of 1 trapped WebAssembly (half of Q is 0) and locked the wallet (MONEY-2, RUST); no usability check before a new box went into a token pool from the tile, either side (MONEY-3 = UI-1, RULES: refused in words before anything is built, `status().pools[].unusable` for the page); Home never showed a Bootstrap's boxes (MONEY-4, RULES); a launch's `asset_info` went to Koios on mainnet (PRIV-2, RUST: the API answers `select=total_supply`, the wallet asks it first); a box back with the public account paying, or from a public deposit, wasn't kept apart in coin selection (PRIV-3, RULES: `box:<tx>+public:N`); a pool once read could leave the read set, stranding the wallet's boxes in it (STATE-2, DISCOVERY: handed-over pools stay, `shown`); a pool of a token a later release lists was never found on the Koios path (STATE-4, DISCOVERY: the look restarts from the head start when the list's hash changes, `listed`); the API's token list only moves with a deploy (DATA-2: development.md's deploy step now names `list.json`).
- **Low, fixed:** UI-3 to UI-12 (SCREENS), PRIV-4/STATE-6/UI-8 (FEED: Home's poll and Activity ask nobody; `epoch_params` whenever a token pool is read, not only for a holder of its boxes), PRIV-5, STATE-5, UI-5, MONEY-6/UI-10 (RULES), MONEY-5, DATA-3, DATA-4's first half (RUST), the discovery throttle across Remove wallet and a restore, `keep()` serialized (DISCOVERY).
- **Left open (low, or the owner's):** DATA-4's second half (the crowds read every pool's history once per cursor); a private Bootstrap's unmixed box isn't tagged with its session's class; `LaunchRecord.account` is never written; the swap approval's total still counts tokens; STATE-2's cost, a device that once read a pool reads it beside an earlier one of its values found later, so its read set can differ from other devices' (rare: the data layer leaving the earliest out, or a Koios backend behind).
- **Strings:** 7 critical keys back-translated blind (only the Spanish and the Japanese shown): meaning held; six fixes made (es: "Inténtalo de nuevo", "por sí sola", "Los tokens de esta sesión … el pool de cada token"; ja: "入らない", "あなたが", "このプールに"). Recorded as "1.6.0's release round" in `verified-critical-*.json`.

**Checks at the handoff:** Rust 736 tests (both workspaces), fmt and clippy `-D warnings` clean; WebAssembly rebuilt by RUST, `node --test` 54; `tsc` clean; Vitest 2,349 on the preprod build, 2,348 + the one load timeout on the default build; i18n guards 88. **Not run:** e2e (either build), a full Vitest after the merged review's fixes.

**Also done:** the version is 1.6.0 (`package.json`); `npm run tokens` (no change) and `npm run dreps`; the privacy policy's *Changes* entry (18 October 2026) and its body, privacy.md (the start and the escape hatch as known links, the pools' reads, STATE-2/4's kept fields), architecture.md, flows.md, development.md (`npm run lovejoin-pools` in the release steps; the deploy when `list.json` changes).

### Fix round two (session 3)

The merged-fix review (`review/merged.md` in session 2's scratchpad) found one medium and four lows, nothing high; MERGED-3 was done already. Two fixers in the shared tree by file ownership, WORKER and SCREENS, each test first, against a contract the lead put in `rpc.ts` first (`LovejoinUnusable.why` gains `"superseded"`; the look answers `{ grew }`). Briefs and reports are in session 3's scratchpad, `fix2/` (`BRIEF.md`, `WORKER.md`, `SCREENS.md`, `fixed-*.md`). New tests: `lovejoin-merged-review.test.ts` (WORKER's, and the lead's R12 block), `lovejoin-merged-screens.test.ts`.

- **MERGED-1, medium, fixed (WORKER):** a copy pool that STATE-2's fix keeps reading was still offered for new boxes, which a restore then never read. Now a handed copy is read-only: `usableNow` answers `superseded` first, so Mix, Bootstrap and mixing again refuse it in words (`lj.unusable.warn.superseded`), a return's or a swap's token never picks it (`poolsOf`, `acrossOf`), Start a pool never offers it to join, and status and the hub list it only while the wallet has something there. Every copy a device keeps is read once at the next pool read, and handed over (read-only) where the wallet's boxes are (`Stored.checked`), so a restore finds them. **Its limit, left open:** on mainnet with our server up, a restored device keeps no copy (the server's list and the head start name shown pools only), so this finds only copies a Koios look keeps: Settings' Koios-only and opening the hub reaches them. Closing it needs the server's `lovejoin/pools` to list copies, marked. Mainnet has no token pools yet.
- **MERGED-2, low, fixed (SCREENS):** Bring them all back's question in a pool whose boxes can't pay their way back now says they wait there until the fees drop enough (`lovejoin.bootstrap.warn.allStuck`), rather than promising they come back; the button stays, since the worker does bring them back once fees allow.
- **MERGED-4, low, fixed (SCREENS):** the Mix again buttons count only boxes no Bootstrap holds, and are off where the pool takes no new box, saying why; the hub's row flags such a pool.
- **MERGED-5, low, fixed (WORKER):** a Bootstrap whose deposit a watch saw land (Home's, for a public one; the session's, for a private one) keeps its hold even if no pool read listed a box at it (`landedDeposit`). A Bootstrap no watch saw is still judged by reads alone.
- **R9 (SCREENS, the lead's narrowing):** "Public account after" on the public launch's review and on the new pools' public reviews, from Home's own figure (SCREENS' call: `homeBalance + rewards` would count spent rewards twice). Not on the classic pool's: backward compatibility 7 keeps its screens byte-identical (an e2e checks the row isn't there).
- **R10 (both), R12 (the lead):** above, under the rehearsal's findings.
- **Step 4's words (SCREENS):** a swap's session page said "Everything at the account, under fresh registers" when Lovejoin took the spare ADA or the proceeds' boxes. It now says what goes into Lovejoin comes back later (`swaps.step.throughLovejoin`). This changes words a classic-only user sees on a swap's page: a correction, kept.
- **Its merged review** (`fix2/review.md`): nothing high. **R2-1, medium, left open:** MERGED-1's limit above, confirmed by test (and, aside, the hub's look can race the status read's `lovejoin/pools` call into a Koios scan on mainnet: pre-existing). **R2-2, low, fixed (both):** a copy refused mixing again too, leaving a not-mixed box there no private way out while the page pointed to one; now a copy refuses only what puts a new box in it (`usableNow(…, again)`), the page keeps Mix again on there and hides Bootstrap in a copy, and `superseded` no longer claims what's false after a restore. **R2-3, low, documented:** after a restore, what made the wallet's boxes in a copy is asked of Koios by transaction (privacy.md). **R2-4, low, fixed (WORKER):** which copy held the wallet's boxes was written unsealed (`shown ∩ checked`); now it's sealed (`Schedule.copies`), the unsealed record keeps `checked` alone, and this round's earlier record shape migrates at the next read. A last review of these fixes followed (`fix2/review2.md`): nothing high. **R3-1, medium, fixed:** a copy holding the wallet's boxes is read at every pool read, which names it to the Cardano server (ours on mainnet), while the policy and privacy.md said no read names anything of yours. The read now ends once a read finds nothing of the wallet's left there (`stillIn`, WORKER), and both docs say what remains. **R3-2, low, fixed (both):** status sends a copy's own reason mixing again is refused there (`LovejoinUnusable.again`), and the page turns Mix again off in its words. **R3-3, low, fixed:** architecture.md's storage rows and discovery paragraph. Left open: below the floor, Mix again is refused with "Try again later" in any pool, and a copy may never fill; the page doesn't check the floor first (it would change the classic pool's page).
- **Strings:** `lj.unusable.warn.superseded` and `lovejoin.bootstrap.warn.allStuck` (critical) were back-translated blind, five rounds each, with the store listing's new text; each round's fixes were English ambiguities as often as translation ones ("an earlier pool … turned up after", "once the fees allow" read as a promise, "its tokens" as Lovejoin's).

### The last review (session 4)

The owner, 2026-10-19: "review chunk 34g … fix any findings and commit and push". Six independent reviewers over `git diff e6b5dae..030fdcf`, read-only, each a lens: WORKER (money and state), PRIVACY (what goes where, and the docs that say so), RUST (core, WebAssembly, the data layer), SCREENS, I18N-DOCS, CROSS (scenarios across areas, and whether each fix's test fails without it). Their reports, with file:line and their throwaway tests, are in session 4's scratchpad, `review/` (`WORKER.md`, `PRIVACY.md`, `RUST.md`, `SCREENS.md`, `I18N-DOCS.md`, `CROSS.md`). **Nothing high.** Every earlier fix held on the final tree; CROSS reverted R0's, R12's, FEED's, MERGED-1's and MERGED-5's in a copy and each one's tests failed. The findings, all fixed by the lead, each code fix with a test that fails without it:

- **SCREENS-1, medium:** in a token pool whose boxes can't pay their own way back, a box not mixed yet had no way out the page offered. The escape hatch leaves such a box out, mixing again is refused there (MONEY-3, which closed what worked at e6b5dae in the pure `cantComeBack` band), Bring one back now is hidden, and Bring one back anyway built a withdraw the box pays, which core refuses (`CantPayBack`, in core's English). Now Bring one back anyway asks the public account to pay there (`anywayRequest`), and its question says so in the escape hatch's words (`AnywayQuestion`); the hatch's link shows only where it has a box to take. Tests: `lovejoin-merged-screens.test.ts` (the page) and `lovejoin-merged-review.test.ts` (the page's request, through the worker, lands).
- **WORKER-1, low:** a Bootstrap whose deposit a watch saw land (MERGED-5's `found`) still lost its hold when its chain's record said `sent: 0` (every send retry gave up, or a lock before `chainSent`): the older rule for a chain that sent nothing closed the entry, `found` or not, and without waiting for its pools to be read. Bootstraps are STATE-5's rule's alone now.
- **CROSS-1, low:** a mix or a Bootstrap from the private balance was checked for its pool at review only; its chain, built once the funding lands, maybe at the next unlock, went into a pool that had turned into a copy meanwhile (or, plausibly, couldn't pay its way back under a new epoch). `chain()` checks again (`takesNewBoxes`) and the session comes back directly, saying why. A public mix's Send refuses a pool that turned into a copy since its review (asking nobody; the epoch's other reasons wait for the next review, 10 minutes at most).
- **SCREENS-2, low:** boxes another account's public Bootstrap holds made the page say to switch to that account to mix them again, where no button can. **SCREENS-3, low:** where mixing again is refused, NotMixed still said "Mix my boxes again takes them first", and Bring one back now was offered only to be refused with "Mix them again first"; both follow `againRefused` now.
- **PRIVACY-1, low:** starting a pool for a token whose supply isn't known said "Koios doesn't know…", where on mainnet our server answered (PRIV-2): now "The server", in all three languages, as every such string says. **PRIVACY-3, low:** a copy's launch link (a copy is listed only while the wallet holds something there) now warns as a started pool's does.
- **Docs:** the policy's *Your Lovejoin boxes* row and the 18 October entry now say a later pool is read apart, and that a pool a device read before an earlier one turned up stays read there (PRIVACY-2); "at most every five minutes" for `lovejoin/pools` is per running worker, as the throttle is in memory (PRIVACY-4; policy, privacy.md, architecture.md); the policy's anonymity sentence says "that pool", as the listing does (I18N-DOCS-8); the listing's Koios justification names the pools' discovery reads, the copies' and a pool's supply (PRIVACY-4, I18N-DOCS-9; the merged dashboard text is unchanged); the listing's deploy step names `list.json` (I18N-DOCS-4); development.md's part 2 read 1.5.0 and would have hashed 1.5.0's zip (I18N-DOCS-1: it reads the version from `package.json` now), and `npm run lovejoin-pools` is among the refreshes never run on `main` (I18N-DOCS-2); architecture.md's *Seeding the pool* was the seed's, now Bootstrap's (I18N-DOCS-6); flows.md's swap return, Mix again and Bring them all back (I18N-DOCS-7); this section said "all uncommitted" (I18N-DOCS-5).
- **I18N-DOCS-3, low:** `npm run lovejoin-pools` failed on the run that fixes a stale head start (the `listed` check ran before the writer): skipped while writing.
- **RUST:** no findings. A cost note for the owner's live run (below).

**Checks:** Rust both workspaces, fmt, clippy `-D warnings` and tests clean on 030fdcf (736; the round touched no Rust); after the fixes, `tsc` clean, Vitest 2,400 + 4 skipped on both builds (the 9 new tests each failed before its fix), e2e 100 of 100 on the dev and the store build, and the data layer's 3.

### For the owner

- **The store listing's Lovejoin text, drafted** (the owner, 2026-10-18: "Draft it now"): `docs/store/README.md`'s Lovejoin bullet and its "What it doesn't hide" bullet, in all three languages, for token pools, starting a pool and putting boxes in for others; back-translated blind three rounds. Read it before the upload; the dashboard takes it by copy and paste. None of the five screenshots shows Lovejoin, so they needn't be made again.
- **R11:** a restore can't know a Bootstrap's hold, so on a restored device its mixed boxes come back by themselves (the crowd shrinks; nothing of the user's is exposed). Accept, or say it where Bootstrap is offered?
- **MERGED-1's mainnet limit** (above): a server change to list copies, later, or accept.
- **STATE-2's trade**, now narrower: a copy stays read on a device that once read it, but takes no new box.
- **R2:** preprod's floor stays 0, so Bootstrap leading below the floor shows on mainnet only. A dev-only override to rehearse it on preprod is possible, if wanted.
- **What a classic-only user now sees differently:** nothing on the Lovejoin screens; on a swap's page, step 4's corrected words.
- **The dApps tile still says "Mix ADA in 10 ₳ boxes"** (`dapps.lovejoin.what`), where the hub now says "A mixer for ADA and tokens" once a token pool is read. The tile reads no pools, so it can't switch as the hub does without a read of its own. Rewording it ("Mix ADA and tokens") changes a classic-only user's screen (backward compatibility 7), and mainnet has no token pool yet. Leave, reword, or switch it on what discovery has kept (no request)?
- **From the last review:** (1) whether mixing again should be allowed in a pool whose boxes can't pay their own way back: settled by call 34 (*Session 5* above), and the anyway question's "Mix my boxes again hides it first" is said only where that button works. (2) `SUPPLY`'s timing: gone with call 35. (3) The listing's per-host Koios row is one item shorter again (call 35).
- The calls the first round's fixers made, each in their `fixed-*.md`: RULES refuses a new box in a pool that can't take one, with the reason on the page (since call 34, only below the minimum or a copy); Bring them all back asks first; a held box's Bring one back in a stuck pool named the public account on its button (since call 36, both payers, the private balance first).

## Open for discussion

### D1 · Pool spam and sync

**Superseded in part by [design session 1](#design-session-1-2026-10-17):** pools are permissionless and found live, so A, i and D below no longer hold. The costs and the threat still stand.

**What spam costs an attacker**
- A fake candidate (an output at the holder with a fake NFT and an 8-field datum) burns about 1.8 ₳.
- A genuine, verifiable pool burns about 2.1 ₳. It needs no registration, no reference scripts, and none of the token held.
- So 10,000 pools cost 20–40k ₳, which a rich actor can pay.

**What it does, with no defence**
- The holder scan runs to 10+ pages.
- 10,000 verifications, once per device.
- If every verified pool is read, about 134 Koios requests a refresh, against 5,000 a day.

**The defences**, every one the same for everyone:

| | Defence | What it costs |
|---|---|---|
| A | **Listed tokens only**: the vetted `tokens/list.json` decides whose pools exist by default | An unlisted token's pool stays invisible unless you ask for it, and asking shows interest |
| B | **One pool per denomination**: the earliest genuine pool for each `(token, Q, box_lovelace)`. A squat is harmless: a pool has no owner or admin | Still spammable across many Qs |
| C | **Rank and cap**: at most k pools per token, ranked by distinct deposits, and 75 credentials in all (one request) | An attacker buys activity, at about 0.18 ₳ a deposit transaction |
| D | **A curated list each release** (`npm run lovejoin-pools`; the owner reviews the diff, as for tokens and DReps) | A new pool waits for a release |
| E | **The data layer ranks**; the wallet re-verifies; on Koios, the bundled list | Server work |

**The owner's direction (2026-10-13): A, listing by trading volume, with the pools page as the filter.**
- Only the pools of listed tokens are read by default, so junk tokens' pools cost nothing.
- A launch stays open to any token you hold. For a token that isn't listed, the review says other wallets won't see the pool.

**Still open: how many pools a listed token may have.** A launch needs no token in hand, so anyone can launch any number of genuine NIGHT pools, each with a different Q.

- **i. One denomination per listed token, the earliest pool winning.** The owner thinks it "will probably work".
  - The list carries each token's box value, `(Q, 4 ₳)`, as ADA's is 10 ₳.
  - The earliest genuine pool of exactly that value is the pool, and every other is ignored.
  - A squat is harmless: anyone can register L, and the wallet can go inline.
  - The launch form offers that Q.
  - **Still to settle:** who sets each Q, and by what rule. Mine: an entry in `tokens/list.json`, set when the token is listed, about 10 ₳ worth on a 1-2-5 series, never changed. Or the first launch for a listed token sets it.
- **ii. Rank and cap (C).** Users choose Q freely, but bought activity can push a real pool out of the top k.

**Either way:** `npm run lovejoin-pools` writes the bundled list at release. It's the Koios baseline, and the data layer can serve the same list faster.

### D2 · Bootstrap and the crowd, for every pool

**The review's point: the floor counts boxes, not owners.**
- Whoever seeds a fresh pool can test `b′ = x·a′` on every mix output, find their own, and so trace everyone else's. That might be its launcher, or a token issuer minting freely.
- With N=3, where the seeder holds a share f of the others' boxes, a mix is traced with probability f², and a depth-2 chain with f⁴.
- That's as true of ADA, and it's why 30 isn't enough.

**The ideas:**
- **a. Count origins, not boxes:** distinct deposit transactions, from `made_by` or `tx_info`.
- **b. A box's own crowd:** the deposits it could descend from. It comes back only once that's enough, and until then it mixes again later.
- **c. Wait in a thin pool, rather than be refused:** deposit now, mix later. This needs deferred mixes and a fee reserve.
- **d. Help a pool, at any time.**
- **e. State the crowd plainly:** for example "boxes from 41 deposits, 12 this week, most from 3".

**The owner's direction (2026-10-13): d, as Bootstrap a pool.**
- **When:** any pool, any time, a new thin one or one that has emptied.
- **Paid from:** the private balance (a session), or the public account.
- **No due time.** The boxes stay until you bring them back by hand: one at a time, or a pool's all at once.
- **They get mixed for free.** Whoever else mixes picks them at random, so a bootstrap box is mixed at someone else's expense, and one that has sat a long time is well mixed.
- **What it can't fix, said plainly.** A bootstrapper knows their own boxes, so a mix whose other inputs were all theirs is traceable by them. The pool's crowd line says how many deposits its boxes came from (e).
- **Home and the Lovejoin page** show bootstrap boxes apart: "Bootstrapping · stays until you bring it back".

**Session 1's answer** ([7, 16 and 18](#design-session-1-2026-10-17)):
- **The gate:** 30 boxes not yours, for every pool, for now. The crowd line counts deposits as well as boxes (e). Ideas a, b and c stay on the table.
- **Bootstrap replaces today's seed,** to be tried and iterated. Seed boxes already in a pool still come back by themselves.
- **The best bootstrap** is many users each putting in many boxes. A group can coordinate one.

### D3 · Four boxes a mix, as an option

**The proposal (the owner, 2026-10-16):** Settings → *Lovejoin* offers four boxes a mix beside three, with three the default. If four fails, the wallet goes back to three. It's part of the upgrade path, decided here at the integration, not before.

**What the measurements say** ([lovejoin-mix-width.md](../lovejoin-mix-width.md)):
- **Four fits today,** on the classic pool and on token pools, by 111 to 118 million steps of 10 billion (1.1–1.2%). A token pool's is the thinnest: 9,889 million.
- **The margin doesn't wander.** The network measures the wallet's mix to the step, and only where the fee input sorts moves it (10 million). So a four-box mix is refused when it's built, or it works. It never fails on chain.
- **But it has no room:** whatever made a mix 1.2% dearer, a cost model that re-costs the BLS12-381 builtins say, would make every four-box mix refuse to build. A block holds two.
- **Five can't be an option:** about 15,050 million steps in every case.

**What it buys**
- **Against someone holding a pool's boxes.** Holding a share f of the others, they trace a depth-2 chain with probability f⁴ at three wide and f⁶ at four (D2's measure). At f = ½ that's 1 in 16 against 1 in 64. That matters most in a thin token pool.
- **A middle step between depths 2 and 3.** Four wide at depth 2 gives 16 leaves in 5 mixes, 6.07 ₳ a box. Three wide gives 9 leaves for 3.29 ₳ at depth 2, and 27 in 13 mixes for 10.70 ₳ at depth 3.

**What it needs, if taken** (Claude's list, 2026-10-16):
1. **The wallet falls back to three by itself,** and the review says so. That covers a four-wide chain that doesn't build, one whose first mix the network's check refuses, and one whose pool is short for four. Never a direct return because of the width: today a return whose chain can't be built or checked comes back directly, unmixed, and choosing three afterwards can't undo that. Building again at three is cheap, since it's all local.
2. **Fewer in flight.** `CHAIN_WINDOW` keeps 4 mixes in the mempool on the assumption of three a block. Four four-box mixes are about 39.5 billion steps, all of what its comment says a node's mempool holds: the limit behind chunk 16's preprod submit timeouts. A four-wide chain wants 2.
3. **More of the pool's others.** A box takes 15 others at depth 2 against 8, never one twice in a chain, so a pool covers about half as many boxes. A pool short for four falls back to three (1), never to fewer boxes. Ties into D2's gate.
4. **Costs by width:**
   - `mixCost` and `MIX_FEE_ESTIMATE`;
   - the figures in Settings and on every review;
   - the `3^depth` leaves lines, which are critical strings, in es and ja too.
5. **The width wherever three is built in:** `mixes_per_box`, `fresh_for`, `fan_out` and the funding sums in core; `mixesPerBox` in the worker; the screens' `3 ** depth`. `lovejoin::mix` already takes four. No record assumes three (34a′): a chain's record keeps its mixes and leaves as built.
6. **A free check before shipping.** The live width test again at the integration (`cargo test -p seedelf-core --test lovejoin_width_test -- --ignored --nocapture`), in case the limits or the cost model moved. Then four-wide on preprod in 34g. No four-box mix has landed on mainnet; mainnet's evaluator agrees with the wallet's to the step.

**Where it lands:** 34e (the planner and the fallback), 34f (Settings, strings, `privacy.md`), 34g (the preprod rehearsal).

**Session 1's answer** ([8](#design-session-1-2026-10-17)): offered, as a Settings option, with three the default.

**On which pools:** every one, the classic too (session 1, 25).

**Still to decide** (34e, 34f):
- The fallback's words, and whether a chain's view says which width it went at.

## The steps

Each step ends with its tests green. The steps can land as parts, but they ship together as 1.6.0 ([session 1](#design-session-1-2026-10-17), 19).

| Step | What | Waits on |
|---|---|---|
| **S0** | Free spikes: **(a)** ✅ `uplc` 1.1.23 against the 1.1.24 artifacts, reproducing the hashes and running `last-run.json`'s token Mix and Owner (a failure means a coordinated Pallas/uplc bump); **(b)** ✅ a synthetic token Mix and Owner evaluated by mainnet's Ogmios; **(c)** a preprod launch probe (a foreign inline mint, cert 0, reference outputs at the holder, giveme.my signing): its evaluation ✅, the submit still to send; **(d)** ✅ the box ADA test below, measured, the figure the owner's | — |
| **S1** | ~~Asks of PR #163~~: moot, PR #163 merged as it was (8131b1d) | — |
| **34a** | ✅ Core: `Pool`, `BoxValue`, the templates (at the merge, 8131b1d), derive, `verify_pool`, the generalized `ScriptSpend` and builders; the classic path byte-identical | S0a |
| **34a′** | ✅ Records: their shapes, migrating 1.5.0's, and reading every shown pool. Each mix's record lasts until its boxes are counted back, and Bootstrap is a kind of its own. **Gated on [backward compatibility](#backward-compatibility-with-the-classic-ada-pool) 3–5 and 8**: the plan-equality test and the mid-flight 1.5.0 vault ([as built](#34a--the-records-2026-10-17)) | 34a; session 1 |
| **34b** | ✅ The launch builder and its WebAssembly (cert 0; S0c's submit still to confirm it) | S0c |
| **34c** | ✅ Discovery and the data layer: the holder index, the shown-pool rule (standard, finished by its launch, earliest for its values), the bundled head start, the data layer's own copy of the rules (32), the pool list and the combined box feed, and deposit counts as possible origins ([as built](#34c--discovery-and-the-data-layer-2026-10-17); its live db-sync run is the owner's) | session 1 (11, 12) |
| **34d** | ✅ The tile's flows per pool (private, public, again); **Bootstrap a pool**, which replaces the seed; the launch from either side (an account-paid builder); the withdraw and its escape hatch; Activity ([as built](#34d--the-flows-2026-10-18)) | 34a′, 34c |
| **34e** | ✅ The planner, and returns through each token's most used pool, with Change; D3's four-wide option and its fallback; a swap's token boxes funded (33) ([as built](#34e--the-planner-returns-through-token-pools-and-four-boxes-a-mix-2026-10-18)) | 34a′ |
| **34f** | ✅ Screens, strings, es and ja, and the docs ([as built](#34f--the-screens-2026-10-18)); the policy's *Changes* entry is 34g's, with the release PR (19) | 34d, 34e |
| **Re-pin** | ✅ Folded into 34a: the templates were pinned to the merge from the start | the merge |
| **34g** | 🚧 The preprod rehearsal, dual: Claude's in dev mode, then the owner's by hand (session 1, 29); the cross-area release review; the policy's *Changes* entry; `npm run tokens`, `dreps` and `lovejoin-pools`; deploy 34c; then package and upload; the handoff note ([under way](#34g--the-preprod-rehearsal-and-the-release-2026-10-18-in-progress)) | all |

**S0d, the box ADA test the owner asked for** (✅ `seedelf-core/tests/lovejoin_box_value_test.rs`, results under [The groundwork](#the-groundwork-2026-10-17)). A Rust test that proves the figure rather than estimating it.
- **What it builds,** under given protocol parameters, for the worst-case token (a 32-byte name, Q = 2^64−1) and for a typical one:
  - the box-paid withdraw into a Seedelf, with reference scripts and inline;
  - the returned box's own partial token send: the recipient, the token change and the fee;
  - the full send.
- **What it checks:** that each one fits. It reports the least `box_lovelace` at which they all do, and the margin left against a rise in coinsPerUTxOByte.
- **Its fees** are checked against what preprod measured.
- **The result sets the suggested `box_lovelace`** ([session 1](#design-session-1-2026-10-17), 14).

**The highest risks, taken first:** S0a, the evaluator; then 34a′, about 9k lines of TypeScript state that live ADA users depend on.

## Verification

**Every step**
- `cargo test --workspace --locked`, and `cargo clippy -p seedelf-core -p seedelf-wasm`.
- `wasm/build.sh`, then `wasm/tests`.
- `npm run typecheck && npm test && npm run e2e`, with new specs stressed under taskset 2-CPU load.
- `cd seedelf-data && cargo test`.

**The classic pool's regression tests pass unedited**, every step. On preprod, one vault runs a classic mix and return before the update and after it.

**Rust tests**
- The parity vectors, and the templates' reproduction.
- `verify_pool`'s negatives: a fake policy; a wrong M, L or F; a stake credential; an extra asset; a 5-field datum on `TokenV1`; a 10 ₳ ADA pool on v2; a wrong seed; an unfinished pool (no references at the holder, or L unregistered); a later copy of a shown pool's values.
- A token mix with a real proof, through the derived `mix_logic`.
- A large Q (2^53+1 and 2^64−1).
- The planner's units: coverage, the cost cap, the caps, the crowd, and ADA's share.

**Extension tests**
- Migrating a 1.5.0 sealed record.
- A `lovejoin-token-pool-preprod.json` fixture.
- A pool that stops being usable keeps its boxes in view.
- The screen harness, for states the fakes can't reach.

**Preprod, for real** (tADA, free):
1. Launch a pool at the suggested box value (4.5 ₳) with a test token: one the owner mints with `cardano-cli`, or LJTEST. A second wallet, on Koios alone, finds it live, though the bundled list predates it.
2. Bootstrap it.
3. A private mix and a public one.
4. A box coming back by itself into a Seedelf.
5. A return holding the token.
6. A restore finding the token boxes.
7. PR #163's own pool, `c5852bb7…`, is **not shown**: its scripts sit at a key address, not the holder ([session 1](#design-session-1-2026-10-17), 22). It's a negative test of the standard.
8. If D3 is taken: a four-wide return and a four-wide mix, and the fallback to three, through a pool short for four.

**Mainnet:** only the free checks of [§5](#5-starting-a-pool). Launching on mainnet waits until every preprod step above has worked.

## Still open

1. ~~**D1:** who sets each listed token's box value~~: the pool's creator sets Q ([session 1](#design-session-1-2026-10-17), 1). Discovery has no curator (session 1, 11 and 12).
2. **D2:** what replaces the 30-box floor as the gate for mixing. For now, the floor stays (session 1, 7).
3. ~~**Seed or Bootstrap**~~: Bootstrap replaces the seed (session 1, 18), to be tried and iterated.
4. ~~**S1:** what to ask of PR #163 before it merges~~: moot, it merged as it was.
5. ~~**Cert 0 or cert 7**~~: cert 0 (session 1, 9), which a real preprod launch confirms.
6. ~~**How a mix is shown**~~: one list of every mix, followed to the end (session 1, 5).
7. ~~**D3:** whether to offer four boxes a mix~~: a Settings option, three by default (session 1, 8). On every pool (25). Still to settle: the words for its fallback to three.
8. ~~**The box value**~~: the wallet suggests S0d's least plus a margin (4.5 ₳ in practice), and the creator may change it, never below S0d's bound (session 1, 14). Its upper limit is 9 ₳ in a token pool, none in an ADA pool (27).
9. ~~**The Seedelf minimum's sizing**~~: it stays as it is (session 1, 28). It's about 0.12 ₳ an output too high; fixing it would be a wallet-wide and CLI change of its own.
