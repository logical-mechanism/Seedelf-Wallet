# Chunk 34 · Lovejoin token pools

1.6.0's feature (the owner, 2026-10-13). [Lovejoin PR #163](https://github.com/logical-mechanism/Lovejoin/pull/163) adds a token-mixing variant of the contracts: a launch pools one native token, and every box in it holds exactly `box_lovelace` ADA plus `Q` of `(policy, name)`.

**We launch no pools.** Seedelf users launch them from their private balance: they choose the token and pay the ADA for the launch and the reference scripts. They also carry their own bootstrap and movement problems.

**Why it matters:** today a token in a one-time account, or one coming back into a Seedelf, is never mixed, so under some circumstances it can be tied to its owner. With token pools, someone buying NIGHT or a stable token can mix it and go back into the mixer, the way ADA already does.

**Status: 🚧 the groundwork, design session 1 and 34a′ are done; 34c is next.** The plan went through two rounds of the owner's questions on 2026-10-13.
- **The groundwork** (`web-wallet/token-pools-groundwork`, 2026-10-17) did every step that needs no more design: S0a, S0b, S0d, S0c's evaluation, 34a and 34b, core and WebAssembly. Nothing in the worker uses them yet. What it built and found is under [The groundwork](#the-groundwork-2026-10-17).
- **The design sessions** (the owner, 2026-10-17: "the biggest back n forth we will have will be how this all looks for the ux ui and how we handle the pool discovery part") run on `web-wallet/token-pools-design`. **[Session 1](#design-session-1-2026-10-17)'s calls override the sections below** wherever they differ, until a later session folds them in. Still to settle: its *Still open after session 1*, each small and owned by a step. The design is otherwise ready for the steps: 34a′ and 34c first.
- **[34a′, the records](#34a--the-records-2026-10-17)** (`web-wallet/token-pools-records`, 2026-10-17): every pool's records beside the classic pool's, every mix followed until its boxes are back, Bootstrap's boxes held, gated on 1.5.0's own record of how it planned and ran.

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
    - **Thirty boxes' worth (30 × Q)** must fit within the token's total supply.
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

### Still open after session 1

Each is small, and the step named settles it.
- How deposits are counted once a pool's boxes have been mixed (34c). Before any mix, each unmixed box's making transaction is a deposit.
- The words for four boxes' fallback to three, and whether a chain's view says which width it went at (34e, 34f).
- The screens in detail (34f), drawn from session 1: the hub, a pool's page, the launch form, Bootstrap, and the mix cards.

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
- **Usable gates only new mixes**, checked at each read:
  - L's credential is registered (one `account_info` for all pools);
  - a mix box meets min-UTxO under the live parameters;
  - `box_lovelace − withdraw fee` covers the **real** destination: an enterprise Seedelf output with a register datum and Q.
- `minimum_seedelf_payment` sizes that destination against `dummy_base_address`, which is 120k too high, so add an exact enterprise sizing.
- At Lovejoin's 2 ₳ bootstrap default, a box fails for long names and large Q. At 4310 a byte the destination needs 1.66 ₳, and the fee is 0.30 with reference scripts or 0.42 inline. Such pools show as **not usable**, and say why.

**An escape hatch** for a pool that turns unreturnable: bring a box back with the fee paid from the public account, saying that it ties the box to the account. The withdraw builder has no fee input today (`lovejoin.rs:795-833`).

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
- Sums such as 30 × Q go in u128 or BigInt, and Q is capped so that k × Q fits a u64 (`assets.rs:62-69`).

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
  - a total supply (`asset_info`) below 30 × Q;
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
- A dated entry under the privacy policy's *Changes*, for the new reads: the holder, `account_info`, and `asset_info` at a launch.

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
| **34c** | Discovery and the data layer: the holder index, the shown-pool rule (genuine, finished, earliest for its values), the bundled head start, the shared verification crate, the pool list and the combined box feed, and deposit counts | session 1 (11, 12) |
| **34d** | The tile's flows per pool (private, public, again); **Bootstrap a pool**, which replaces the seed; the launch from either side (an account-paid builder); the withdraw and its escape hatch; Activity | 34a′, 34c |
| **34e** | The planner, and returns through each token's most used pool, with Change; D3's four-wide option and its fallback | 34a′ |
| **34f** | Screens, strings, es and ja, the docs, and the policy's *Changes* | 34d, 34e |
| **Re-pin** | ✅ Folded into 34a: the templates were pinned to the merge from the start | the merge |
| **34g** | The preprod rehearsal, dual: Claude's in dev mode, then the owner's by hand (session 1, 29); the cross-area release review; the policy's *Changes* entry; `npm run tokens`, `dreps` and `lovejoin-pools`; deploy 34c; then package and upload; the handoff note | all |

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
