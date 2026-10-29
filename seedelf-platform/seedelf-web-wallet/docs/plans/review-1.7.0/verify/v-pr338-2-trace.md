# v-pr338-2-trace: pr338#2

**Finding:** "The fix is a Pallas update, or patches in core" (`post-release-roadmap.md:406`). Core's patches are needed whatever Pallas does, and no Pallas writes redeemers as a map.

**Verdict: confirmed.** Severity **low** (a misleading doc; docs only, nothing shipped changes). Confidence high.

## What I traced on HEAD (6bca8bec)

The sentence's "or" offers a Pallas update as a fix that works alone. Under Dijkstra, three of the things it has to fix are in core's own code, which no Pallas version touches.

1. **Core writes the redeemer list itself and refuses a map.** `withdraw_zero.rs:102-117`:
   ```rust
   Some(Redeemers::List(list)) => list.to_vec(),
   Some(Redeemers::Map(_)) => {
       bail!("The transaction's redeemers are a map, which this patch doesn't write")
   }
   ...
   let redeemers = Redeemers::List(MaybeIndefArray::Def(redeemers));
   ```
   Both Lovejoin builders stage their box spends through Pallas (`add_spend_redeemer`), call `build_conway_raw()`, and then patch:
   - the mix at `lovejoin/mod.rs:1031-1033`, `withdraw.patch(built, ..)`, with both of `MixCollateral`'s arms (the collateral's giveme.my mix included);
   - the withdraw at `lovejoin/mod.rs:1471-1476`.

   So a Pallas whose builder wrote a map would hand this patch a map, and every mix and withdraw would stop building. `withdraw_zero_test.rs:103,127` also pins the list (`panic!("redeemers as a list")`).
2. **Certificate 7 for the launch has to come from core.**
   - `launch.rs:252` writes `Certificate::StakeRegistration(StakeCredential::ScriptHash(..))`, Shelley's certificate 0.
   - The launch goes through `ScriptSpend::new(..).with_staking(made.staking)?` (`launch.rs:330-341`).
   - `with_staking` (`build.rs:1759-1764`) refuses anything except certificate 0: "A Seedelf spend takes only a script's stake registration: any other certificate, a withdrawal or a vote needs a signature or a script the spend doesn't add". `staking_test.rs:489` pins that refusal for `Certificate::Reg(script, DEPOSIT)`, certificate 7.
   - Pallas can't stage a certificate or a `Cert` redeemer. In 0.35.1, `conway.rs:243-244` has `certificates: None, // TODO` and `withdrawals: None, // TODO`, and `RedeemerPurpose` (`transaction/model.rs:551-556`) is `Spend`/`Mint` with `// Reward TODO` and `// Cert TODO`.
3. **No Pallas writes a map.**
   - 0.35.1: `conway.rs:218` builds `Redeemers::List(`.
   - The latest release, `v1.4.0` (published 2026-09-17, from the GitHub API): its txbuilder's `conway.rs` (~224) has `Redeemers::List(redeemers.clone())`, certificates and withdrawals are `None // TODO` (~250-251), and `RedeemerPurpose` matches only `Spend` and `Mint`.
   - `main`: the same (~227, ~254-255).
   - Neither has a Dijkstra builder: `pallas-txbuilder/src` is `conway.rs`, `lib.rs` and `transaction/`.
   - The registry's newest `pallas-primitives` (1.1.1) has no `dijkstra` module either.

   (I read GitHub's raw files and API: read-only, not Koios.)
4. **uplc has to move with Pallas.** `uplc` 1.1.23's `Cargo.toml` pins `pallas-* = "0.35.0"`. Core's `Cargo.toml` says `uplc = "=1.1.23"`, with the comment "must be on the same Pallas". CLAUDE.md:100 says the same.

The entry contradicts itself as well. Its own earlier sentence says "Pallas 0.35 **and core's zero-withdrawal patch** write redeemers as a list". The leios write-up the entry summarises (unmerged branch, read for context only) says of the launch: "Pallas can't stage either, so it's a patch, as Lovejoin's zero withdrawal is". The roadmap's one-line summary loses that.

## Scratch test (deleted)

The test was `seedelf-core/tests/zz_review_v-pr338-2-trace_1.rs`, run with `cargo test --locked -p seedelf-core --test zz_review_v-pr338-2-trace_1`. Each test asserts something the "a Pallas update alone" reading would need, so each fails on HEAD if the finding is real. **4 of 4 failed:**

| Test | What it asserts | Result on HEAD |
|---|---|---|
| t1 | Pallas 0.35's `build_conway_raw` with one spend redeemer writes a map | `left: "list"`, `right: "map"` |
| t2 | the same transaction, re-encoded with a map (what a map-writing Pallas would hand over), goes through `WithdrawZero::patch` | `Err`: "The transaction's redeemers are a map, which this patch doesn't write" |
| t3 | `WithdrawZero::patch` writes a map | `left: "list"`, `right: "map"` |
| t4 | `ScriptSpend::with_staking` takes `Certificate::Reg(ScriptHash(mix_logic), 2 ₳)` | `Err`: "A Seedelf spend takes only a script's stake registration: …" |

The file was deleted after the run, and `git status` showed it gone.

## How far it goes

- The scenario's first step is hypothetical: no map-writing Pallas exists, as point 3 shows. If one did and a session bumped to it, core's own tests would fail on the spot (mix-building tests bail; `withdraw_zero_test.rs` pins the list). Nothing broken would ship. The harm is the plan: it suggests waiting for Pallas covers the Dijkstra hard fork, and per the entry's own write-up, without these changes "nothing private goes through".
- "Core's patches are needed in every case" means the fix as a whole. For Seedelf's own spends (transfer, sweep, mint, remove), the redeemers come only from Pallas's staging, so a map-writing Pallas could cover that part. It can't cover Lovejoin's zero withdrawal or the launch's certificate.
- The attribution: the session memory records the owner's words as "the Pallas update is much later, and means a CLI release and a web wallet release". "Or patches in core" was added in writing the entry. So a rewording should keep the owner's timing and releases, and only correct what a Pallas update can cover.

## Fix advice

The finding's text, "…as patches, unless a later Pallas writes the map itself", lets the "unless" cover everything. That reads as if a map-writing Pallas would make core's patches unnecessary, which is the very thing the finding refutes. Scope the "unless" to the builders' own redeemers. For example:

> The fix is in core whatever Pallas does: `withdraw_zero.rs` writes the redeemers' list itself and refuses a map, and a launch's certificate 7 with `mix_logic`'s `Cert` redeemer is core's patch, past `with_staking`'s refusal (no Pallas up to 1.4.0 or `main` stages a certificate or writes a map). The builders' own redeemers can come from a later Pallas that writes the map, with `uplc` moved to it, or from a patch in core. Then a CLI release and a web wallet release, much later (the owner, 2026-10-28).

The tests that pin today's shapes change with the fix: `withdraw_zero_test.rs:103,127`, `staking_test.rs:489`, `lovejoin_launch_test.rs:148,420`. PR #338's description says something stronger still, "The fix is a later Pallas update", but that isn't in the tree.
