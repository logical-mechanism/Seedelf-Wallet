# v-pr338-2-impact: pr338#2, impact and the fix

**Verdict: partly. Severity: nit** (the finding said low).

The finding: the roadmap's "The fix is a Pallas update, or patches in core" (post-release-roadmap.md:406, PR #338) suggests a Pallas bump alone would do. In fact core's patches are needed in every case, and no Pallas writes redeemers as a map.

## The facts check out

- `seedelf-core/src/withdraw_zero.rs:102-107` takes a list and refuses a map: `Some(Redeemers::Map(_)) => { bail!("The transaction's redeemers are a map, which this patch doesn't write") }`. At :117 it writes the list itself: `let redeemers = Redeemers::List(MaybeIndefArray::Def(redeemers));`.
- `seedelf-core/src/lovejoin/launch.rs:250-256` writes Shelley's certificate 0 through core's `Staking` patch: `Certificate::StakeRegistration(StakeCredential::ScriptHash(`.
- pallas-txbuilder 0.35.1 (the lockfile's version), `src/conway.rs`:
  - :218 `Redeemers::List(`
  - :243-244 `certificates: None, // TODO` and `withdrawals: None, // TODO`
- The owner's own Pallas checkout (`~/Documents/LogicalMechanism/pallas`, origin logicalmechanism/pallas, v1.1.0+10) matches the lines the finding cites for main:
  - conway.rs:227 `Redeemers::List(redeemers.clone())`
  - :254-255 `None // TODO` for both
  - `pallas-primitives/src` has no Dijkstra era at all.
  - I didn't fetch 1.4 or upstream main. CLAUDE.md:95 already says 1.4 stages neither.
- `seedelf-platform/CLAUDE.md:100`: "`uplc` must be on the same Pallas". uplc 1.1.23 depends on pallas-primitives, -traverse, -codec and others.

So a Pallas bump alone wouldn't do, and core's code changes in every case.

## Why the impact is a nit, not a low

- **No user, site or attacker reaches it.** It's one line of a roadmap entry about a change "much later", after Leios's hard fork. The store zip doesn't carry `docs/`.
- **Step 3 of the finding's scenario can't get past CI.** In that step, a session bumps to a Pallas that writes maps, and every mix fails to build. Core's offline tests would fail on that bump:
  - `seedelf-core/tests/withdraw_zero_test.rs:101-103` asserts `let Some(Redeemers::List(list)) = ... else { panic!("redeemers as a list") }`.
  - `seedelf-core/tests/lovejoin_test.rs` has 22 tests, none ignored, that build `lovejoin::mix` (:232), `lovejoin::withdraw` (:353) and `lovejoin::mix_giveme` (:434), all through `WithdrawZero::patch` (lovejoin/mod.rs:1033, :1473). They'd hit the bail, and its message names the cause.
  - CLAUDE.md:100 already makes a Pallas bump "a coordinated change" with uplc.
- **Step 4 (the launch's certificate 0) is stated in the same bullet**, two sentences earlier: "A pool's launch is refused for Shelley's certificate 0 too; certificate 7, with `mix_logic`'s publish redeemer, takes its place". The write-up the entry points to says it's core's job:
  - `web-wallet/leios-musashi:seedelf-leios/README.md:73`: "In core: the launch would write certificate 7 and a `Cert` redeemer ... Pallas can't stage either, so it's a patch".
  - :65-66 on the redeemers: "In core it would be a step of `Patches`", and "only core building it as a map from the start can" for a withdraw.
  - Even if it were missed, the result would be a launch the node refuses, with no money moved. Mainnet has no token pools yet.
- What's left is a loose "or" in a summary whose own preceding sentence names core's zero-withdrawal patch as writing the list.

## What the finding overstates

- **"Core's patches are needed in every case."** What's certain is that core's code changes. Patches aren't certain:
  - The owner extends Pallas's txbuilder in their fork, for the very things core patches: a Conway txbuilder fix (`babbage-to-conway-txbuilder-fix-01`, 2024) and staging auxiliary data (`task/add-aux-data`, 2025, in `pallas-txbuilder/src/transaction/model.rs`).
  - Their plan, as PR #338's body records it, is "The fix is a later Pallas update, with a CLI release and a web wallet release". The branch README:147 says the same: "The owner's plan: a later Pallas update, then a CLI release and a web wallet release."
  - A Pallas that staged certificates, withdrawals and their redeemers, and wrote maps, would retire `withdraw_zero.rs`'s and `staking.rs`'s patches rather than need them.
- **"No Pallas writes a map."** True today, but the entry says "much later". No Pallas has a Dijkstra era yet, and one that does must write maps, since protocol version 12 decodes nothing else.

## The proposed fix is wrong; a better one

The proposal: "The fix is core's: ... as patches, unless a later Pallas writes the map itself ... (the owner, 2026-10-28)". It has two problems:

1. **It inverts the owner's recorded plan** (a later Pallas update) into core first, with Pallas as an "unless", and keeps "(the owner, 2026-10-28)" on it. That attributes to the owner a plan they didn't state.
2. **Its "unless" repeats the defect it targets.** A Pallas that writes the map still meets `withdraw_zero.rs:105-106`'s bail. The launch's certificate stays core's unless Pallas also learns to stage certificates.

It also mixes `Cert` with the bullet's "publish redeemer". Both names are right, but the bullet uses one.

**A minimal fix** keeps the owner's words and adds the dependency. After "or patches in core", add:

> "(core changes either way: `withdraw_zero.rs` writes the list itself and refuses a map, and a launch's certificate is core's patch)"

What this fix changes:
- It's docs only. No test reads the sentence: `activity.test.ts` cites the file in comments only.
- The text has no "seedelf" word, so `words.test.ts` is unaffected.
- No guard and no UI text, and none of the owner's rules are touched.

## Process

- No scratch files were written. Everything above came from reads, read-only git and `gh pr view 338`, with no network beyond that.
- Per the brief, the `leios-musashi` branch was only read (`git show`), to check the summary against its write-up. It isn't part of this review.
