# 1.8.1's release review: v-guard

Verifier `v-guard`. I traced guard#1, guard#10 and mutants#9's wiring claim against the tree at `2a8060d3`, each to its own verdict.

- The repros ran in a scratch copy of the extension whose tracked files match HEAD's, with everything outside it linked read-only.
- The main repro also ran once in the tree, by name, and was then deleted.

**The short of it:**

- **guard#1 is wider (low).** The gap is real at the signer, in sw.ts's wiring.
  - It's larger than reported. The guard's set holds the copies *sealed as holding the wallet's boxes*, so its answer tells a site whether the wallet has boxes in a copy, on a public site or a private session (v-guard#1, new).
  - The proposed fix, every pool discovery keeps, is small and closes both:
    - about 20 lines;
    - no request, and no new storage key;
    - about 4.5 ms of WebAssembly per kept pool, once in a worker's life.
  - No copy exists on either network today, so both are latent.
- **guard#10 is confirmed (nit).**
  - `lj.rewardsMovedReview` reaches Bring everything back's warn callout as a worker error's own words.
  - The derived set doesn't hold it. The rule's text wants such a warning's words named `.warn.`, but the route predates the rule and was never listed.
  - No back-translation of it is recorded. Its values are accurate. Not for 1.8.1.
- **mutants#9 is confirmed (low).** sw.ts:273 does wire `lovejoin`, and deleting that line passes both the typecheck and the tests.
  - Making `lovejoin` required on its own breaks `npm run typecheck` at 17 test sites.
  - Given `lovejoin: t.lovejoin` at each, the typecheck is clean and 218 of 218 tests pass. The deletion then fails the typecheck at sw.ts and nowhere else.

## The repro

**What it is.** `EXT/tests/zz-r181-v-guard-1.test.ts`: five tests, real WebAssembly, in sw.ts's wiring (`PoolDiscovery` and `serviceDeps`, with the connector given that service). A copy is at `SCRATCH/review/v-guard/zz-r181-v-guard-1.test.ts`.

**The setup.** The device's record `seedelf.lovejoinPools.preprod` holds `{ pools: [EARLIER, REAL] }`:

- REAL is the v2 token pool fixture, which WebAssembly verifies;
- EARLIER is an earlier launch of REAL's values, which makes REAL a copy (guard's own setup).

**How it ran:**

- in the tree, by name: 5 of 5 passed (`SCRATCH/review/v-guard/repro-1-tree.log`), and the file was deleted;
- with `VGUARD_FIXED=1`, which flips the assertions to the fix's behaviour, on the scratch copy with the fix applied (`guard1-fix.patch`): 5 of 5 passed (`repro-fixed-5.log`).

**What it shows on HEAD:**

1. **A site's pool registration into REAL's `mix_logic` is asked, not refused:**
   - while REAL is unread;
   - and again once it's been read and found empty (`copiesRead`).

   The classic pool's is refused, and so is REAL's when REAL is alone in the record (the rule's pool).
2. **A public site sees where the wallet's boxes are:**
   - with REAL read once and empty, it gets a prompt, then `{ code: 2, info: "The user declined." }`;
   - with REAL sealed as holding the wallet's boxes (what `ours` writes, `lovejoin.ts:3335`), it gets no prompt and `{ code: 1, info: "The wallet won't sign this: it pays into a Lovejoin pool's reward account, which anyone may take from." }`.
3. **A site on a private session sees the same,** in both cases.
4. **What `mixLogicHashes` reads:**
   - no Koios;
   - the device's `seedelf.lovejoinPools.preprod`, three reads over two calls;
   - the sealed `seedelf.private.lovejoin.preprod`, with `seedelf.account`;
   - from the session, `seedelf.entropy` and `seedelf.lastActivity`.

   A cold call takes 3.7 ms and a warm one 3.3 ms. Each `lovejoinVerifyPool` or `lovejoinMixLogic` of a v2 pool takes about 2.2 ms.
5. **The data layer isn't asked.** With discovery given an `index`, as sw.ts gives it the data layer, the asks are counted: 0.

## guard#1 · wider · low

**Traced.** `mixLogicHashes` (`lovejoin.ts:4599`) is `readSet(network, true)`, which holds three things:

- the classic pool;
- `known` (`lovejoin-pools.ts:300`): the rule's pools, and those handed over before;
- the sealed schedule's `copies` (`lovejoin.ts:2888`): the copies a one-time read found the wallet's boxes in (`ours`, `:3330`–`3336`), pruned once the boxes are gone (`:6062`–`6068`).

A copy that's kept but was never handed over is either unread (`copiesUnread`) or read and empty (`checked`). Neither is one of readSet's sources, so it's not in the set. Repro test 1 shows it asked, not refused, at the signer, in sw.ts's wiring.

**The record.**

- The archived plan's `:47` says "every pool `readSet` keeps, the classic and retired pools and copies included".
- Its Step 5 (`:120`) planned "every found pool's (`PoolView.mixLogicHash`, kept under `seedelf.lovejoinPools.<network>`)".
- #367's body claims only "a known Lovejoin pool's `mix_logic`, retired pools included".
- The code's comment ("every pool the wallet reads") is accurate.

**Wider: the set says where the wallet's boxes are.**

- The set holds the sealed copies. So the same transaction is refused unasked when the wallet's boxes are in the copy, and put to the user when they aren't (repro 2 and 3).
- That's the fact round two's R2-4 sealed, so that discovery's unsealed record would never say it.
- See v-guard#1.

**The consequence, under the owner's lucky-winner call.** A user who approves such a transaction puts the deposit in the copy's account:

- the next 1.8.1 build in that pool takes it, into its own output;
- until then, older wallets' mixes and ways back in that pool are refused.

**Reachable today? No copy exists on either network.** I made two Koios `credential_utxos` reads of the launch holder `288fea77…`, one per network, and ran each row through the wallet's own `lovejoinCandidate` (`SCRATCH/review/v-guard/scripts/candidates.mjs`, results in `koios/`):

- **Mainnet** has three NFT rows:
  - one isn't a token pool;
  - `dc6abe3b…` is a 5 ₳ pool on 8131b1d;
  - `fcb3f5ec…` is a 5 ₳ pool on v2.

  The two 5 ₳ pools are on different sets, so neither is a copy (`valuesOf` keys values by set).
- **Preprod's** candidates are the head start's five. Its two 5 ₳ pools are again one v1 and one v2.

A copy needs a second launch of the same values on the same set, which anyone can make, the wallet's own Start a pool included.

**Is the fix small? Yes.** The prototype is `SCRATCH/review/v-guard/guard1-fix.patch`, 19 lines added:

- `PoolDiscovery.everyKept(network)`, which is `(await this.kept(network)).pools.map((p) => p.ref)` and makes no request;
- an `everyKept` dependency on `LovejoinDeps`, given in `serviceDeps`;
- in `mixLogicHashes`, each kept pool added through `verifiedPool`. A trap is thrown on, and a read that fails falls back to readSet's set, as now.

**Does it read anything new during a signature? No.**

- **Network:** nothing. No Koios call (test 4), and the data layer is asked 0 times (test 5).
- **Storage:** no new key. It reads `seedelf.lovejoinPools.<network>`, which `known` already reads in the same call: three reads over two calls become five. The sealed schedule's read is unchanged.
- **Timing:** each kept pool the worker hasn't verified yet costs one `lovejoinVerifyPool` and one `lovejoinMixLogic`, about 2.2 ms each. That's once in the worker's life, since both are cached after.
  - In the repro, a cold call goes from 3.8 to 15.6 ms, and a warm one from 3.5 to 6.3 ms.
  - The warm cost is the repro's stand-in EARLIER, which doesn't verify, so it's tried again at each call. A pool discovery keeps always verifies: discovery verified it with the same WebAssembly.
- **What the refusal depends on:** discovery's unsealed record alone, the same for every device with the same history.
  - The set is the classic plus every kept pool, and the sealed copies are always among the kept ones.
  - Remove wallet deletes both together: discovery's record is in `LOCAL_CACHES` (`wallet.ts:477`), and `lovejoin.<network>` is a private record that `KEPT_ON_RESET` doesn't keep.
  - The guard already reveals that history today, through `known`.

**Risk.** The change is additive: only `mixLogicHashes` reads the new dependency. With the fix, 14 files pass, as on HEAD: 278 passed and 2 skipped (`vitest-guard1-fix-regress.log`, `vitest-head-regress.log`). They're:

- the 13 test files that reach discovery or the guard;
- `lovejoin-reward-balance.test.ts`.

**The test that must fail without it:** repro tests 1 to 3 with the fixed expectations. On HEAD these three are prompted:

- the unread copy;
- the checked copy;
- the copy holding none of the wallet's boxes.

**If not in 1.8.1:** correcting the record's `:47` alone would leave v-guard#1 as it is.

## guard#10 · confirmed · nit

**Traced:**

1. `claimSubmit` (`sessions.ts:3352`) runs `balancesHeld` (`:5049`), which throws `new StaleReviewError(REWARDS_MOVED_REVIEW())`, that is `t("lj.rewardsMovedReview")` (`lovejoin.ts:179`).
2. The catch pushes `{ index, error: e.message }` (`:3361`).
3. ClaimAll shows each one as `{name}: {x.error}` inside `<Callout tone="warn" testId="claim-failed">` (`ClaimAll.tsx:161`–`165`).

The same key also shows in a screen's error line (`role="alert"`) after Send, through `backSubmit` and `publicStart`.

**What the rule says.** It's stated in `scripts/i18n-critical.mjs`'s header, architecture.md:509 and development.md:101. `docs/i18n/critical-keys.json` is its output, which `tests/i18n.test.ts` regenerates and compares.

- The set is the keys inside a privacy or warn callout, or inside `role="alert"`, as the JSX writes them, plus any key named `.warn.` or `.privacy.`.
- The deriver's carve-out: "The worker's own messages are outside the set: an error an alert shows from `e.message`, a refusal's detail, a skip's reason … One that fills a warning's placeholder is named `.warn.` or `.privacy.` where the worker writes it".
- architecture.md:509: "A warning whose words come from a helper, a const, a prop or the worker has to carry that name".
- `tests/i18n-worker-reasons.test.ts`: "What it can't see is a reason that arrives as an error's own words, so those routes are listed below by hand (RUNTIME)".

**Is it critical by that rule?**

- **By the set as derived: no.** It isn't in critical-keys.json, it isn't named `.warn.`, and no test asks it to be.
- **By the rule's text: yes.** ClaimAll's failed list is a warn callout made of a worker error's own words, with no key of its own. That's the case architecture.md's sentence and RUNTIME's comment cover. The carve-out names an alert, not a callout.
- **The same holds for every other error that can reach the list,** and none of them is critical: the 18 `StaleReviewError` throw sites, `sess.spentSince`, and Koios's and the node's words.
- **The route is old.** It dates from `5cc61e55` (chunk 15c, 2026-09-25), before the rule's round of 2026-10-04. RUNTIME's three entries don't name it. #367 adds one more machine draft to it.

**Has it been back-translated? Not on record.**

- It's in neither verified file, and both provenance files say `machine`.
- The verified files' reviewer notes stop at 1.8.0.
- Chunk 43's record (`:48`) claims a blind back-translation for `lj.warn.rewardsMoved` alone.
- It's newer than the whole-locale review of 2026-10-03, which read the other worker messages.

My own reading, which isn't blind:

- es "El pool de Lovejoin cambió desde que revisaste esto. Revísalo otra vez.": "Lovejoin's pool changed since you reviewed this. Review it again."
- ja "確認した後に Lovejoin のプールが変わりました。もう一度確認してください。": "After you reviewed it, Lovejoin's pool changed. Please review it again."

Both hold. Each matches the house's wording of the same route's `sess.spentSince` in its language.

**Fix: not for 1.8.1.** RUNTIME as written can't hold this key:

- each entry requires the error class's own constructor to hand the key to `super`;
- `StaleReviewError` is a bare subclass (`collateral.ts:21`), thrown from 18 sites.

Listing the route would take a new RUNTIME shape, `.warn.` names for every key that can reach it, and a blind round. For the owner: that, or a backlog line saying the failed list shows the worker's errors unchecked.

## mutants#9 · confirmed · low

**Traced.**

- sw.ts:268–277 builds `DappService` with `lovejoin,` at `:273`: the service built at `:241` on `serviceDeps(discovery)`. It's wired today.
- `DappDeps.lovejoin` is optional (`dapp.ts:294`), and the guard runs only `if (summary.paidScripts?.length && this.deps.lovejoin)` (`dapp.ts:2096`).
- **T13g** deletes `:273`.
  - It passes `tsc --noEmit -p .` (exit 0 in the scratch copy) as well as the finder's sweep.
  - The only test that imports sw.ts is `worker-language.test.ts`, and it signs nothing.

**Is making it required safe for every construction site? Not as one line.** With `lovejoin` required:

- sw.ts and fakes.ts:793 compile.
- 17 test sites fail with TS2741, "Property 'lovejoin' is missing … but required in type 'DappDeps'":
  - `dapp.test.ts`: `:533`, `:784`, `:1068`, `:1153`;
  - `dapp-caps.test.ts`: `:62`, `:118`, `:153`;
  - one each in `dapp-enable.test.ts:268`, `dapp-gone.test.ts:101`, `dapp-ties.test.ts:144`, `dapp-ties-accounts.test.ts:129`, `session-site-outs.test.ts:62`, `site-funding-parts.test.ts:57`, `site-funding-seen.test.ts:66`, `sessions-review-fixes.test.ts:76`, `parts-send-review-fixes.test.ts:613` and `connector-lovejoin-review-fixes.test.ts:310`.
- CI's *Extension typecheck* step would go red. `npm test` would stay green, since Vitest strips types.
- `t.deps` can't carry it for them. `SessionService` and the other services spread `t.deps`, and fakes.ts keeps Lovejoin out of the default sessions on purpose ("the default sessions above come back plainly, as their tests expect").

**With each site given `lovejoin: t.lovejoin`** (`SCRATCH/review/v-guard/mutants9-optionA.patch`):

- tsc is clean;
- the 12 files pass 218 of 218 (`vitest-optionA.log`), with the guard on in each, the private sessions' connectors included, since testBalances' service knows the classic pool alone and asks nobody;
- T13g then fails the typecheck with one error, TS2741 at `sw.ts(268,28)`.

A type-only alternative is `lovejoin: Pick<…> | undefined`, with `lovejoin: undefined` at the 17 sites. It holds sw.ts the same way, and changes no test's behaviour.

**T13c and T13d (the same finding).** My repro kills both:

- tests 1 to 3 fail under T13d;
- test 5 fails under T13c, where the data layer is asked twice.

Adopting them gives guard#3 its tests of the pools the guard knows.

**A nit in the same tests.** `sessions-review-fixes.test.ts:60` says "As sw.ts wires them", yet gives neither its sessions nor its connector `lovejoin`.

**The test that must fail without it:** `npm run typecheck`, with sw.ts:273 deleted.

## v-guard#1 (new) · low · `extension/src/background/lovejoin.ts:4600`: the dApp guard's answer says whether the wallet's boxes are in a copy pool

**What's wrong.**

- `mixLogicHashes` is `readSet(network, true)`.
- readSet adds each copy the sealed schedule keeps (`:2888`): the copies a one-time read found the wallet's boxes in (`ours`, `:3335`), dropped once the boxes are gone (`:6062`).
- So whether a site's transaction paying into a copy's `mix_logic` is refused unasked, or put to the user, turns on whether the wallet's boxes are in that copy.

That's exactly the fact R2-4 sealed: "Which held the wallet's boxes isn't said: the service keeps those sealed" (`lovejoin.ts:1626`). #367's guard reads it out to any connected site.

**Evidence.** Repro tests 2 and 3, on HEAD, in sw.ts's wiring, for a public site and a private session alike:

- read once and empty: `{ prompted: true, failure: { code: 2, info: "The user declined." } }`;
- sealed as holding the wallet's boxes: `{ prompted: false, failure: { code: 1, info: "The wallet won't sign this: it pays into a Lovejoin pool's reward account, which anyone may take from." } }`.

**The failure.** A connected site sends `signTx` with a pool registration, or a proposal's return, naming copy X's `mix_logic` account.

- An immediate refusal, with no window, means the wallet has boxes in X.
- A signing window means it doesn't. The user sees the window and declines.
- Several copies in one transaction test a whole set at once.

Each probe gives a site one bit about the wallet's Lovejoin boxes. On a private session, which is meant to tell a site nothing of the wallet, it ties the session to a holder of boxes in X.

**Why low, not high.** By what it leaks, this is the wallet's own data, which is the brief's high row. Its preconditions make it latent:

- no copy exists on either network today (the chain reads under guard#1);
- a copy takes no new box (`usableNow`, MERGED-1). The wallet's boxes reach one only when a pool turns into a copy after the wallet used it, through discovery's edge cases, and only on a device that never handed it over, such as a restore;
- each "no" shows the user a signing window.

The lead may re-grade it if it weighs the data over the preconditions.

**The fix.** guard#1's: every pool discovery keeps. The set becomes the classic pool plus every kept pool, independent of where the boxes are. Repro tests 2 and 3 then pass with the fixed expectations, and fail without them.

Dropping the sealed copies from the set would also stop the leak, but it would guard less.

## Checked, and held

- sw.ts wires the connector's `lovejoin`, and on a private session the guard sits before the user is asked too (repro 3).
- A copy's `mix_logic` hash is its own, derived from its own seed. `mixLogicOf`'s cache is keyed by pool id, which differs for each launch.
- `lovejoinMixLogic` with a `poolRef` derives the pool's scripts itself (`protocol_of`, `wasm/src/lovejoin.rs:158`), so the set never holds a hash that a pool's seed doesn't make.
- Remove wallet deletes discovery's record and the sealed schedule together.
- The fix's `verifiedPool` caches views, not pools, so a copy's flag never leaks into another read. A slimmed stored reference verifies (repro test 1, fixed).
- No tracked file was touched. Only my report is in the tree. The repro was there for its run alone.
