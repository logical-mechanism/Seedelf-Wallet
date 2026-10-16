# Chunk 34 · Lovejoin token pools

1.6.0's feature (the owner, 2026-10-13). [Lovejoin PR #163](https://github.com/logical-mechanism/Lovejoin/pull/163) adds a token-mixing variant of the contracts: a launch pools one native token, and every box in it holds exactly `box_lovelace` ADA plus `Q` of `(policy, name)`.

**We launch no pools.** Seedelf users launch them from their private balance: they choose the token and pay the ADA for the launch and the reference scripts. They also carry their own bootstrap and movement problems.

**Why it matters:** today a token in a one-time account, or one coming back into a Seedelf, is never mixed, so under some circumstances it can be tied to its owner. With token pools, someone buying NIGHT or a stable token can mix it and go back into the mixer, the way ADA already does.

**Status: 🚧 planned, nothing built.** One feature branch, `web-wallet/token-pools`, from `main` after #307. The plan went through two rounds of the owner's questions on 2026-10-13. Two of its designs, [D1](#d1--pool-spam-and-sync) and [D2](#d2--bootstrap-and-the-crowd-for-every-pool), are still under discussion, and the steps that depend on them say so.

**Read first:**
- PR #163's own write-up: `docs/generalize-lovejoin.md` and `docs/perf.md` on `feat/token-pools`.
- [chunk-16-lovejoin.md](../archive/plans/chunk-16-lovejoin.md), the original integration and its decisions.
- The Lovejoin sections of [architecture.md](../architecture.md), [flows.md](../flows.md) and [privacy.md](../privacy.md).
- [chunk-26b-data-layer-wallet.md](../archive/plans/chunk-26b-data-layer-wallet.md), on how the wallet reads the pool today.

## The owner's calls this builds on (2026-10-13)

1. **The contracts are more or less frozen:** "nothing is really wrong with them explicitly".
   - **The fee contract doesn't matter to the wallet.** Its private flow never uses fee shards, so the contract's N ≥ 3 junk-input issue needs no work here.
2. **4 ₳ a box** in the pools the wallet launches, "but we may need to come back to this one with a provable test showing what exactly it has to be for this flow".
   - The owner chose 3 ₳ first. Then the review found that a 3 ₳ box comes back as about 2.70 ₳ plus Q, which can't pay for a partial token send on its own (about 3.39 ₳), so the send would co-spend another UTxO.
   - Step S0d is that test, and its answer pins the value.
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
2. **The classic pool is the only ADA pool.** An ADA pool on the new code is never shown, read or used, "at this moment". Wanting one later is a decision for then, not code for now.
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
4. **Not an ADA pool on the new code** ([backward compatibility](#backward-compatibility-with-the-classic-ada-pool), 2).

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

The answer waits on [D1](#d1--pool-spam-and-sync). Whatever it decides:
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

**One transaction, straight from the private balance.** It holds:
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
- **The token is in your private balance**, which already shows it's a plain native token that can sit at a script.
- **Refused:**
  - Seedelf identifier tokens;
  - a total supply (`asset_info`) below what the crowd rule needs;
  - a pool of the same token and Q that already exists and is usable (the form links to it).
- **Warned:** another Q of a token that already has a pool.
- **Q** is entered in display units, with the token's decimals.
- **Fixed values:** `box_lovelace` is 4 ₳ until S0d proves the figure; `max_fee` is 1.5 ₳.
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
- **The objective, in order:**
  1. pools that pass D2's crowd rule;
  2. the least of the amount left unmixed within that cost;
  3. the fewest boxes;
  4. then the bigger crowd, counted in distinct deposits rather than boxes, so stuffing a pool can't steer users into it.
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

**The pools page is discovery, and the spam filter** (the owner, 2026-10-13).
- **By default** it lists the classic ADA pool, then **one pool per listed token box value**, the earliest genuine one ([D1](#d1--pool-spam-and-sync)-i). That's everything the wallet reads, and it's the same for everyone.
- **Behind a filter:** other box values of listed tokens, pools of unlisted tokens, empty pools, and pools that aren't usable, each saying why.
- **Fakes and nonsense never reach it.** The checks run cheapest first:
  1. the holder scan;
  2. the shape and listed-token checks, offline;
  3. derivation, on the CPU, offline;
  4. the seed proof: offline when the bundled list or the data layer supplies the seed, otherwise one `tx_info`, and only for a pool the page is about to show.
- **Use this pool** adds a non-default pool to your reads. It says that from then on Koios, or our server, sees this browser reading a pool few others read. That's a link you choose, said where you choose it, never one made for you.
- **A pool's details** show:
  - the token and its mark;
  - the box value;
  - the crowd;
  - your boxes;
  - its launch transaction;
  - **Bootstrap**.

**The Lovejoin page**
- A pool picker, each pool showing:
  - its ticker or name, with `tokenMark`'s listed, unlisted and lookalike marks;
  - its box value ("100 NIGHT + 4 ₳");
  - the crowd as D2 measures it;
  - your boxes.
- A status per pool.
- **Start a pool**, as a button, not a link: a choice that costs money is never a link.
- The launch's form and its review.

**How a mix is shown needs a review as a whole** (the owner, 2026-10-14: "how to display a current lovejoin mix just in general needs a review … Mixing from public does not show on the mixes so there is no way to track it"). What the page does today:
- **A mix from the private balance** is a private session, so *Mixes* lists it with its stage: funding, mixing, waiting, coming back.
- **A mix from the public account** has no session. Its chain shows under *Its transactions* only while it's being sent, or if it stopped partway, and Home's Public tab says it's being sent. Once it's all sent, its row goes. After that, its boxes count only in *Your boxes in the pool*, and in when the next box comes back.
- **So a public mix can't be followed once it's sent.** Token pools make this wider: mixes in several pools, from either side.
- **The design is 34f's, before its strings**, and the owner's to approve. A starting point: one list of every mix, from either side and in any pool, each shown until its last box is back.

**Every other screen** — Home, Settings, UTxOs, Activity, ClaimAll, SiteSessions, the swap review — shows its figures per pool.

**Strings**
- The 21 "10 ₳" keys become parametrised.
- The new warnings and privacy notes go under `.warn.` and `.privacy.` keys, which makes them critical: translated to es and ja, and back-translated.
- The guard tests stay green.

**Docs**
- architecture, flows, privacy, and keys-and-accounts.
- A dated entry under the privacy policy's *Changes*, for the new reads: the holder, `account_info`, and `asset_info` at a launch.

### 10. The data layer (mainnet; deployed before the wallet's upload)

Its shape waits on D1. Either way:
- **A pool list and one combined box feed, the same for everyone.** Only pools on the server's own verified list are ever queried.
- **The 1.5.x routes and Kupo's patterns are untouched.**
- **Token pools come from db-sync only.** Health is per route, so a 503 on a token pool doesn't send the contract index to Koios (`private-index.ts:220-233`).
- **`mixed` is per pool** (`row.rs:128`, `kupo.rs:328`).
- **Verification lives in a small shared crate:** the templates, derive and verify, used by core and by the server. A path dependency on `seedelf-core` won't do: it wouldn't resolve, since `[patch.crates-io]` lives in the platform workspace, and it would pull blst, Pallas and uplc into the server.
- **Preprod has no data layer**, so 34c is checked by its own live mainnet tests.

## Open for discussion

### D1 · Pool spam and sync

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

**Still open:**
- **The gate for mixing.** Until it's settled, 34d keeps today's floor per pool as a placeholder, and states the crowd plainly. Ideas a, b and c stay on the table.
- **Today's seed** (a deposit alone, back by itself after the Settings delay; the owner, 2026-10-06): does it stay beside Bootstrap, or become it?

## The steps

One branch, and each step ends with its tests green.

| Step | What | Waits on |
|---|---|---|
| **S0** | Free spikes: **(a)** `uplc` 1.1.23 against the 1.1.24 artifacts, reproducing the hashes and running `last-run.json`'s token Mix and Owner (a failure means a coordinated Pallas/uplc bump); **(b)** a synthetic token Mix and Owner evaluated by mainnet's Ogmios; **(c)** a preprod launch probe (a foreign inline mint, cert 0, reference outputs at the holder, giveme.my signing); **(d)** the box ADA test below | — |
| **S1** | Asks of PR #163: commit the unapplied token blueprint; a bootstrap default of 4 ₳ (or S0d's figure); reference scripts at the holder, not at a key's base address | the owner (outward-facing) |
| **34a** | Core: `Pool`, `BoxValue`, the templates (from the PR head `791c59a`, behind one constant), derive, `verify_pool`, the generalized `ScriptSpend` and builders; the classic path byte-identical | S0a |
| **34a′** | Records: their shapes, migrating 1.5.0's, and reading every verified pool. **Gated on [backward compatibility](#backward-compatibility-with-the-classic-ada-pool) 3–5 and 8**: the plan-equality test and the mid-flight 1.5.0 vault | 34a |
| **34b** | The launch builder and its WebAssembly | S0c |
| **34c** | The pool registry and the data layer | D1 |
| **34d** | The tile's flows per pool (private, public, seed, again); **Bootstrap a pool**; the withdraw and its escape hatch; Activity | 34a′; the gate for mixing is a placeholder until D2 |
| **34e** | The planner, and returns through token pools | D2 |
| **34f** | Screens, strings, es and ja, the docs, and the policy's *Changes* | 34d, 34e |
| **Re-pin** | The merge commit's templates; S0a and S0b again | the merge |
| **34g** | The preprod rehearsal; the cross-area release review; `npm run tokens`, `dreps` and `lovejoin-pools`; deploy 34c; then package and upload; the handoff note | all |

**S0d, the box ADA test the owner asked for.** A Rust test that proves the figure rather than estimating it.
- **What it builds,** under given protocol parameters, for the worst-case token (a 32-byte name, Q = 2^64−1) and for a typical one:
  - the box-paid withdraw into a Seedelf, with reference scripts and inline;
  - the returned box's own partial token send: the recipient, the token change and the fee;
  - the full send.
- **What it checks:** that each one fits. It reports the least `box_lovelace` at which they all do, and the margin left against a rise in coinsPerUTxOByte.
- **Its fees** are checked against what preprod measured.
- **The result pins `box_lovelace`**, which is 4 ₳ until then.

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
- `verify_pool`'s negatives: a fake policy; a wrong M, L or F; a stake credential; an extra asset; a 5-field datum on `TokenV1`; an ADA pool on v2; a wrong seed.
- A token mix with a real proof, through the derived `mix_logic`.
- A large Q (2^53+1 and 2^64−1).
- The planner's units: coverage, the cost cap, the caps, the crowd, and ADA's share.

**Extension tests**
- Migrating a 1.5.0 sealed record.
- A `lovejoin-token-pool-preprod.json` fixture.
- A pool that stops being usable keeps its boxes in view.
- The screen harness, for states the fakes can't reach.

**Preprod, for real** (tADA, free):
1. Launch a pool at 4 ₳ (or S0d's figure) with a test token: one the owner mints with `cardano-cli`, or LJTEST.
2. Bootstrap it.
3. A private mix and a public one.
4. A box coming back by itself into a Seedelf.
5. A return holding the token.
6. A restore finding the token boxes.
7. Discovery of PR #163's own pool, `c5852bb7…`, expected to be **not usable**: 2 ₳, with its scripts at a key address.

**Mainnet:** only the free checks of [§5](#5-starting-a-pool). Launching on mainnet waits until every preprod step above has worked.

## Still open

1. **D1:** who sets each listed token's box value, and by what rule.
2. **D2:** what replaces the 30-box floor as the gate for mixing.
3. **Seed or Bootstrap:** keep today's seed beside Bootstrap, or let Bootstrap replace it.
4. **S1:** what to ask of PR #163 before it merges (the owner's repo, so the owner's call).
5. **Cert 0 or cert 7** for L's registration: S0c's probe decides, unless the owner prefers Lovejoin's tested cert 7.
6. **How a mix is shown** (the owner, 2026-10-14): a mix from the public account can't be followed once it's sent. See [*The Lovejoin page*](#9-screens).
