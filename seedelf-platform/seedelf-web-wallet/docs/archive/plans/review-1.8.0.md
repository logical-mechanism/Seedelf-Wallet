# 1.8.0's release review, its fixes and the gate (2026-11-06)

**Status: ✅ done, the gate for 1.8.0.** It's on branch `web-wallet/release-1.8.0`. The working folder (`docs/plans/review-1.8.0/`: the briefs, `FINDINGS.md` with every first-round finding, its verdicts and outcome, the verifiers' and fixers' reports, round two's reports, traces and fixes, the back-translations and the last look) was compressed into this file when the PR was ready. The full text is in git at `df8fa674`; [The IDs](#the-ids) says where each family is. What still holds is in the design docs, and what's left open is a line in [backlog.md](../../backlog.md).

## The review

**What it covered:** every PR since `web-wallet/1.7.2` (`6b70c1f8`, the commit 1.7.2's zip was built from) that ships in the extension or the data layer, as one tree at `a6c94743`: #361 (1.7.2's record), #363 (chunk 44a: Lovejoin v2's pools recognised, launches on v2 alone) and #364 (chunk 44b: the old pools withdraw-only, returns into v2's 5 ₳ pool, the first unlock's bring-back). Then the release prep, `1beba3fb`. #362, the formal verification, was out of scope.

**How:** nine finders (the release, the 5 ₳ pool's sharing, the retirement, the screens, the words, cross-cutting, the unit tests, the e2e, #363), then eight verifiers: a completeness critic, a trace and an impact verdict for each medium, a design pass over the owner's call, and a trace for each single-lens low.

**92 findings:** 6 medium, 72 low and 14 nits, none high: 44 clusters.
- **The mediums:**
  - **O1:** a pool launched after the head start was found only by Lovejoin's page, on preprod and wherever the data layer doesn't answer;
  - **O2:** a swap's Review said "no pool" beside a collateral's mix it reserved in that very pool, and the return later paid mix fees the approval never showed;
  - **O3:** the connector's approval and funding review promised spare ADA mixed (critical `.privacy.` lines) on Settings' switch alone, with no pool known, under its floor or with no room;
  - **P1:** a mix in the 5 ₳ pool could leave its collateral's mix too few boxes while its review said "mixed once";
  - **D1, D2:** what 44c and 44d still owed, and the privacy policy's dated entry.
- Every finding a verifier traced held (30); one member's half was refuted. Two lows rose to medium (words#1, cross#8, O3's critical lines).
- **The critic's findings** included two of weight: a swap approved on 1.7.2 coming back on 1.8.0 in twice the boxes and fees its approval priced (critic#4), and Home keeping 1.7's "not mixed yet" count for two hours after a Stop (critic#3).

## The owner's calls during the review

- **2026-11-06, the head start:** "We need it to work since that if no 5 ada pool exists, or really any pool, then no mix happens. Then when it exists it uses it." So no head-start gate and no floor gate: with no pool a return comes back directly and every screen says so, and a 5 ₳ pool launched later is found and used without Lovejoin's page. This replaced 44c's "1.8.0 can't ship without each network's v2 5 ₳ pool in the head start".
- **2026-11-06, four calls on round two, each as recommended:** no wider look for v2 token pools in 1.8.0 (on Koios paths a token pool launched later is found as Lovejoin's page opens, at a pool's start or at Settings' Bring every box back); D3's rule stays boxes-only at width 4's tie; Put in 5 ₳'s refusal under the floor stays; the swap's Plan step stays "directly" with no 5 ₳ pool known. Each is a backlog line.

## The fixes

Eight fixers by file ownership, each in a worktree of `1beba3fb`, each fix test-first and each new test checked against a revert of its fix:

| Lane | What | Findings |
|---|---|---|
| find | `adaPool`'s ask looks at Koios's holder where the data layer doesn't answer, throttled (`lookSoon`, a shared refresh); `priced` asks at Review and Stop, and says `of` at a 5 ₳ box's price; `collateralWanted` asks and says why Lovejoin is left out; `noAdaPool` and `floorShort` say what the wallet found when it read | O1, O2, O4, critic#0, critic#1, critic#7 |
| chain | With no 5 ₳ pool, a return's tokens still go into their pools; a 1.7.2 swap comes back in no more boxes than it was priced for (`AutoRecord.lovejoin.box` marks a 1.8.0 approval) | O5, critic#4 |
| share | A return's ADA and its collateral share the 5 ₳ pool: Mix my boxes again holds the collateral's two draws, the tile's Mix and Stop say "only if enough is left" where they're short, a direct return reserves its collateral's mix at build | P1, P2, P4 |
| retire | The first unlock's run widens to every retired pool, runs after the cuts, decides nothing on a read that fell back; Try again restarts the run that stopped; 1.7's counts dropped; `madeSince` pool-aware; R5–R8's tests | R1–R8, W2, critic#3, critic#5 |
| connector | The connect card adds the verified hedge where the 5 ₳ pool may not take a box; the funding review's note follows the pool's room; "the 5 ₳ kept aside" | O3, W5, W10 |
| screens | The swap's box words name 5 ₳; the retired reason ends at its first sentence; a retired chain's row, the hub's list, search and aside, a page kept with its Done | W1, W3, W4, W7–W10, S1–S3, O6 |
| e2e | The e2e's 5 ₳ pool is the head start's where one is bundled; the 1.5.0 gate holds the v2 pools apart; a retired pool's page, a token's list, and mainnet's 5 ₳ pool found later with no Lovejoin page | D6, tests-e2e#1–#3 |
| v44a | A start says only a start of its own set; both copies read a scenario pool's set one way; the data layer's `version` pinned; v2's fees held under the estimates; the v2 fixtures re-recorded | V1–V6 |

The lead merged them (one conflict, both sides kept), applied the lanes' pins in each other's files, and fixed four things at the merge: Settings' Bring every box back looks first, whatever is kept (critic#2); `room()` names its pool (adapool#6); Stop's dialog counts a 1.7.2 swap's boxes as its return does; and the retired run's Try again asks "Bring the retired pools' boxes back now?".

## Round two

Round two read the merged fixes where the lanes meet, in four lenses (the worker, the screens and words, the tests by mutants, a completeness critic): **22 findings, 12 low and 10 nits.** A skeptic traced each low but the live plan's, the lead's own (r2-critic#4): every one held, 5 as stated and 6 narrower or wider, and the traces settled every fix.

| Lane | What | Findings |
|---|---|---|
| sessions | Stop's dialog counts the 5 ₳ pool's room as the return's chain does, leaving the collateral's mix its two draws at each width (wrong at width 4 in width, note and "mixed"); each review lists the pools once (`collateralRoom` on the shared `rooms()` read), and `rooms()` hands a trap on, which closed an older gap where a broken WebAssembly instance was built on; the connect card's read is the kept one alone | r2-worker#0–#2, r2-tests#0, r2-tests#2, r2-critic#3's pin |
| retire | After the first unlock's run stops partway, the boxes it hadn't taken are read at the next run, not two hours on, the read re-armed while a withdraw is held as spent, and a released 1.7 Bootstrap owes that read too; the look's comments say Settings' press and the throttle's scope | r2-critic#0, r2-critic#1's and #2's comments, r2-worker#3 |
| screens | es `floorShort` lower-case after its colon frames, with "no eran tuyas"; `noteLovejoinMixed`'s "once" with the mix; the hub's `takes` and its aside; a v2 pool's line during the retired run; BringAllBack's question and W8's undecided pool pinned | r2-screens#1–#5, r2-critic#6, r2-tests#1, r2-tests#3 |
| e2e | The first unlock's retired run, end to end under the fakes: the run, Home, Settings, Stop and Try again's question | r2-critic#4 (G1's unit-reachable half) |

The lead merged them cleanly, re-pinned a swap Review's single listing, and fixed three doc comments.

## The last look

The last look read round two's fix-ups and the docs as they ship, in two parts, each low traced.
- **The code part:** 5 findings, 3 low and 2 nits, every one a test gap, a comment or a test's name: the merged code was right. `collateralRoom`'s floor, ask and `usableNow` were held by no test (last-code#0); so were the read times after a plain Stop and the run's own stop, which the privacy policy's entry is written from (last-code#1); and round two had left fx-may's "no" half vacuous (last-code#2). Each is pinned now, each pin failing under its mutant on both builds. The hub's comment and share's test name are fixed (last-code#3, #4). One mutant still survives: a re-arm for any box held as spent, not only the run's own withdraws (a backlog line).
- **The docs part:** 5 findings, 2 low and 3 nits, all wording, each fixed: the 64-box deposit cap in four places and the code's comments (last-docs#0); architecture.md's Storage table now has 1.8.0's sealed fields (last-docs#1); the escape hatch's lines name the retired pools, the glossary's es row matches the listing, and the archived plan's look names the data layer's list (last-docs#2–#4).

## Left open

In [backlog.md](../../backlog.md), each the owner's or for later:
- a v2 token pool launched later, on Koios paths, is found as Lovejoin's page opens, at a pool's start or at Settings' press, never at a Review or a return (the owner, 2026-11-06);
- D3 at width 4 leaves the collateral's mix one box at 4 or 16 free, so the 5 ₳ comes back unmixed (the owner's rule, kept);
- Put in 5 ₳ under the floor is offered by the quiet list and refused at the press; the swap's Plan says "directly" with no pool known (both kept, the owner);
- Home keeps "A mix stopped partway: open Lovejoin to see what to do." for a 1.7 chain cut in a retired pool until the next pool read, and shows each box's own due time while the retired run brings it back now (both old; seen live);
- a mix's review and Mix again list the pools twice (since 1.7.2);
- P2's `tailChain` sibling; P3's costs of 5 ₳ boxes (twice the fees per ₳ mixed, half the ADA a chain carries); critic#6; R8's `sessions.ts` half; a retired pool's page showing the whole Mix form;
- the look's, the list's and the public look's throttles live in a worker's memory, and the docs say so; one shared rule for the collateral's pool (`collateralRoom` and `collateralPool`);
- untested: S2's Done past a static render, and the re-arm held to the run's own withdraws.

Left as they are: `lj.bringOtherPool`'s words, reached only by a race; `lj.skip.warn.untoldAll`'s capital after a colon (1.7.2's, critical, a blind round for a nit); the dialog's over-count where mainnet's crowd count is under the floor and the live read over it (an upper bound, "at most").

## The release prep

`1beba3fb`:
- 1.8.0.
- `npm run tokens`: unchanged. The data layer's token decimals: 1,172 to 1,175 (three tokens added), so the API is deployed after the merge.
- `npm run dreps`: mainnet 466 named (ALDEA renamed AdaSouls, the same DRep), preprod 63.
- `npm run lovejoin-pools`: preprod's first v2 pool (`47bece42…`, a 5 ₳ ADA pool launched at block 5378705), 5 preprod pools; no new mainnet pool, so no Cardanoscan names to send. `npm run lovejoin-registry` takes a v2 pool now (D3): its names are "Mix Box v2 (… ADA)", version 3.

## The translations

Every critical key whose es or ja value changed since 1.7.2 was back-translated blind, a fresh agent a language with no English in view, each item inside the frames it's shown in with its placeholders filled as the screens fill them: `staysLovejoin`, `noteLovejoin`, `noteLovejoinMixed`, `noteLovejoinPoolShort`, `lj.unusable.warn.retired`, `noAdaPool` and `floorShort`, every plural form. Nothing drifted. Two notes were taken, and the new values back-translated again: es `floorShort` opened with a capital after its colon frames and tied "cuando … leyó" to the wrong verb (now "el pool de Lovejoin tenía … que no eran tuyas"), and `noteLovejoinMixed`'s "once" read as kept aside once (now with the mix, en and es). The store listing's changed sentence was back-translated in es and ja: ja held; es was reworded twice for two readings of where "con los contratos actuales" and "para cada valor de caja" attach, and held. Both verified-critical files say so.

## The checks

On the final tree:
- Rust (on `4b4628e9`; no Rust changed since): fmt, clippy `-D warnings`, the workspace's 713 tests, and the release's ignored `payment_parts_shapes_test` in a release build. The data layer: fmt, clippy `--all-targets`, its 128 offline tests.
- The WebAssembly rebuilt (`C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`), byte for byte the module every test ran against (`87a9a0c8…`), and `node --test` 59.
- `tsc` clean.
- Vitest: 3,196 on both builds.
- e2e: 109/109 on the dev build and on the store build, and the data layer's 3. The store build was packaged as CI packages it (`seedelf-wallet-1.8.0-mainnet.zip`, 24 files, 2,057 KB), without writing a zip in the main tree. The new first-unlock test passed 9 runs under a 2-CPU load on each build.
- The last look's fixes changed tests and comments alone: both builds rebuilt at the final tree are byte for byte the ones the e2e and the live run used (the store's licence notices aside, which its packaging adds).

## The live run

A dev build of the final tree on preprod, and its mainnet side read-only. Every transaction was read back from Koios.

| What | Transactions |
|---|---|
| **The update from 1.7.2 (G1).** Wallet C, on a real 1.7.2 build, mixed from its public account a 10 ₳ box in the classic pool and a 5 ₳ box in an 8131b1d pool, the second chain cut by a lock after three of its four mixes (1.7.2 counted it "not mixed yet"). The same profile on 1.8.0: the first unlock started the retired pools' run at once, both withdraws went one right after another within 18 seconds and landed in one block, Home never said "not mixed yet", and Settings showed the run. Settings' Bring every box back on C, then holding nothing, made one look at Koios's holder and one pool listing, and said "Nothing of yours was left in Lovejoin." | classic chain `7cd6db8b…`…`a97e0445…`; the cut chain `53a240cb…` and three mixes; the withdraws `e90648c0…`, `0cb3c27c…` |
| **The tile's Mix**, one 5 ₳ box in `47bece42` from wallet A: its review said "mixed" for the collateral (45 free), and its eight transactions (deposit, four mixes, the collateral's deposit and mix, the sweep) landed in three blocks. A's 60 held boxes stayed held | `92c3c50f…` (funding), `6d8e95fa…`…`92f48278…` |
| **A public mix**, one box (A's collateral set aside first) | `0a4cc17f…`, `18655e50…`…`023f5beb…` |
| **Bring one back now**, on the mixed box, named | `7fc17323…` |
| **A swap stopped at once** (30 ₳ → MIN, Minswap preprod): its Review listed the pools once (r2-worker#1); Stop's dialog, with no request of its own, said 3 boxes, 12 mixes and the collateral mixed; the return built exactly that, 16 transactions, all confirmed | `f7d2447c…` (funding), `5d470c19…` … `f53adae1…` |
| **Mainnet, read-only (G4)**, a fresh wallet: with Koios only, Settings' Bring every box back made one look at Koios's holder and no `tx_info` (no pool launched since the head start); with the data layer, the look was its list alone (`/seedelf/v1/mainnet/lovejoin/pools`). Both said "Nothing of yours was left in Lovejoin." | none |
| **The release harness:** `e2e/live/run.mjs all`, six transactions, all confirmed; only `preprod.koios.rest` and `www.giveme.my` were contacted. `LIVE_KOIOS=1 tests/live.test.ts`: 2 | `c81c629b…`, `f8fea077…`, `72ef0162…`, `85b9c062…`, `da5859f3…`, `5172c936…` |

The full hashes, in order:
- **G1:** the classic chain `7cd6db8b5f2c89405201913cb8cd0cce8cc061b22da470117e1f939cfa367170` … `a97e04454d541eaf0dec5aa6148abc67b072c1aaeceb795bc041d1a29d4fc21d`; the cut chain `53a240cb3a86a705f0410194da49b2f551cc0ee9ce0b9324eb27a1ab6a278a9e`; the withdraws `e90648c0f6631d713b5c914deb1bb7bb9914ccfb99902ba516cc5dd824159fe3`, `0cb3c27c8364a154822c336ad762d86c24499aa688d859b4c2e00a51e41055be`.
- **The tile's Mix:** `92c3c50f9a4255ee65269437289484a378eb37b2b1af3abb4e0aab7a253b040d`, `6d8e95faf609a74fe0e580b8038b75ed7124c9b27ef4fb5a2ea6e0f08a4f9e73`, `fa8e6d9c059c044e1f7b992dafa13b92a9d3f9b5df61b33e8645a644006fd78e`, `c43c19a39381c7fd3d165ddde3a879e543c73f8c83c9697c7ade036c53e11de2`, `400aa01ada838743b2356525eab955e0a910b64f552774087f3e67b0e2b9ba9c`, `b845733c4fc66ec5a794a515c2e323790f6738e5d15dad86efecb2e447518a41`, `6e3415d45e533268948b916638e0bc29d3e737f452e409d1bbdef4996647ab65`, `9fc97e354eea7ffb4ed052fb9ab852d9f5d80d06b1590e0929e85f2f26b2b214`, `92f482789e962d413b4e729ddb5c30a11996e69dea58341a80d87c171f3a7b21`.
- **The public mix:** `0a4cc17f945bb4a3cfbadfd85c3fb35b373b4c721a0fe8f7704781f458b93368`, `18655e503d9abc74cbaf5154f8077eab86e5470ca950b295f2607cb7b9f61850` … `023f5bebba3bd9cbf9103a84f9c2fbe8b3acfaa927e0555ec60ff93bb47782a0`.
- **Bring one back now:** `7fc17323d7e289976c02208bf6936f5ae1c9288e200337dee16301bcaafaaef6`.
- **The swap stopped:** `f7d2447c242039a572e9175605b44a80fa849293efa493c2789e4878bab17b12`, `5d470c19b11551a9da1a94fb96fadd714fad9d9bd4f496b9ad14999779f128d3`, `0825b502fd2f97c549ae86a7c79781dd541d6ee663f98d6d6a97ae73a4348306` (the collateral's deposit), `c65a786105a06438e52f54432ad906808bad2a6e82175848eebae19554b65a5b` (its mix), `f53adae1e939ab6e60e1313520b981f65f851de49e3a69be4443e8ccdaa329a1` (the sweep).
- **The harness:** `c81c629bc9c62d8e95c4c19147e9f3943ea81cd16180eb72a1fbba526556567b`, `f8fea07746f51234737e5321e431ec5557edc42f6dbb29c35470688c6c76b0ae`, `72ef01623151466d7cd74c7f4decf3c0d11c543819c3ef1ae2cd1dbd108fb158`, `85b9c0620d60a5f43e93c7b477598007f5d6711a7fb5c002a3659fafdda0b681`, `da5859f3017b512f4918e48dca0ad92cccc97a7ae964f203d8cd881156cdf871`, `5172c936aa86be4952760a53320c9c7767d812aa255d1cf9a7cb31fc22d43eaa`.

**What it found:** nothing new in the wallet. Two old lines of Home's, now in the backlog (the stopped-partway line until the next read, a box's own due time during the run). And one harness fact: the store build loaded unpacked has no key, so its id isn't one our server's CORS allows, and it reads Koios as a down server makes it; G4's data-layer half ran on the dev build's key.

## For the owner

After the merge, in order:
1. Deploy the data layer (`data-layer-deploy.yml`, `deploy`): it carries #363's `version` and the three new token decimals. Then `curl https://mainnet.seedelf.logicalmechanism.io/seedelf/v1/mainnet/lovejoin/pools` shows every pool with its `version`.
2. Package on `main`, upload, and paste the listing's Description in each language from `docs/store/README.md` (only the Lovejoin bullet changed). Tag `web-wallet/1.8.0` on the commit the zip was built from, and record its hash in `docs/releases.md`.
3. Launch mainnet's v2 5 ₳ pool whenever you choose, from a dev build. Until it holds 30 other people's boxes, mainnet returns come back directly and say why. Its Cardanoscan names come from `npm run lovejoin-registry` once it's launched.

## Lessons

- **A shared pool is a shared count.** P1, r2-worker#0 and the D3 aside are one lesson: once a return's ADA and its collateral share the 5 ₳ pool, every count of that pool's room has to leave the collateral its draws, the dialog's as much as the chain's.
- **A fallback read can decide forever.** R3 (a read that fell back retiring v2 pools for good) and r2-worker#1's trap (a broken instance built on through a swallowed catch) are the same shape: a path that says "nothing" where it should say "unknown" or "stop".
- **A live run on a real old profile finds what fakes can't.** The e2e couldn't hold a 1.7 count (its worlds start on 1.8.0); wallet C, made on a real 1.7.2 build, did, and showed the update end to end.

## The IDs

The code, the tests and the docs cite these by ID. Their full text is in git at `df8fa674`, under `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.8.0/`.

| IDs | What | File at `df8fa674` |
|---|---|---|
| `O`, `R`, `P`, `W`, `S`, `V`, `D` clusters (e.g. `O1`, `R3`), and their members `<lens>#<n>` (`release#`, `adapool#`, `cross#`, `retire#`, `screens#`, `words#`, `tests-unit#`, `tests-e2e#`, `pr363#`), cited as "1.8.0's release review, …" | the 92 first-round findings in 44 clusters, with their verdicts | `FINDINGS.md`, the finders' reports in `find/`, the brief `REVIEWBRIEF.md` |
| `critic#<n>`, and the verifiers' names (`o-design`, `o2-trace`, `o3-trace`, `p1-trace`, `p1-impact`, `lows-a`, `lows-b`) | round one's verification | `verify/` |
| the fixers' lanes (`find`, `chain`, `share`, `retire`, `connector`, `screens`, `e2e`, `v44a`) | each fixer's report | `fix/<lane>.md`, and `FIXBRIEF.md` |
| `r2-<lens>#<n>` (e.g. `r2-worker#0`), cited as "1.8.0's review of its fixes, …" | round two's 22 findings, their traces and fixes | `round2/` (`verify.md` the traces), `fix2/`, and `R2BRIEF.md`, `FIX2BRIEF.md` |
| `last-<part>#<n>` | the last look's findings | `LASTBRIEF.md`, and `last/` |
| the back-translations | both rounds | `round2/back-translation.md` |
