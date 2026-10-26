# docs-b: the release's records of the review and its fix rounds

My files were four docs: the plan's 34g record, the roadmap's handoff note, post-release-roadmap's 1.6.0 line with what the review left for later, and development.md's release procedure. Every figure and claim is taken from HANDOFF.md, FIXBRIEF.md, the fixers' reports, round 3's CONFIRMED.md and QUESTIONS.md, the last look's two files, OWNER-CALLS.md, the commit messages since `499768f6`, and the lead's logs in the scratchpad (`r2-e2e-*.log`, `r2-stress-*.log`, `r3b-vitest-*.log`). Where those didn't settle a fact, I checked the tree: the head start's pools, the DRep counts, which Rust lines rounds 2 and 3b touched, and where core's constants live.

No code, string keys or tests were touched. The owner's rule holds throughout: no release dates and no store status. The plan's session dates and the handoff note's own date are the only dates.

## Findings

### 34g's record of the release gate: fixed
`docs/plans/chunk-34-token-pools.md`. A new **Session 12: the release review and its fix rounds (2026-10-24/25)**, newest first, in the Session sections' style:
- **The branch and its commits.** It points to `review-1.6.0/` as the working record, and says HANDOFF wants that folder archived or removed before the release PR merges.
- **The review:** 33 slices and seven lenses, the critic's three probes, a skeptic per slice, and every high and medium reproduced on its own (83 agents). 136 findings: 8 high, 8 medium, 78 low, 22 nits, 16 owner's calls and 4 refuted.
- **The highs, as their three problems, and the mediums.**
- **The fix rounds:**
  - 1: 16 fixers, plus phase A's data fixer;
  - 2: the screens and the leftovers;
  - 3: the review of the fixes, 31 confirmed, none high or medium;
  - 3b: its fixes, and the last look;
  - 3c: fx-last, running now.
- **The release prep:** vitest 5.0.3; the lists refreshed (GNP1_DRep, 465; preprod's third head-start pool); the data layer's decimals unchanged.
- **The checks:** Rust 684, the data layer 126, node 57 (round 1's rebuild), tsc, and Vitest 2,849 on both builds bar the gate's two es/ja checks. e2e was 104/104 on the dev and store builds, with the data layer's 3/3 and the 4×4 stress runs, on round 2's tree; round 3b changed one e2e expectation.
- **For the owner:** seven items, each with a recommendation (below), pointing to `review/OWNER-CALLS.md` for the rest.
- **Left, in order:** Claude's steps before the PR, then the owner's; and a pointer to post-release-roadmap for the rest.

Also in the plan:
- *Start here* is rewritten from Session 12's *Left*. It keeps the owner's older items: their test of item 11, what's left of item 4, and the earlier sessions' calls.
- The status line and the 34g header (#321, #323, this branch) are updated, and so is the steps table's 34g row.
- Pointers where earlier text is now false or incomplete (DOCS-TODO's plan items):
  - `:473`: the server could name a pool that isn't on chain; 317-wallet#0;
  - the 1.5.0 gate's bullets: x-compat#2, R3-17, R3-18 and the record guard;
  - `:569`: crediting the Bootstrap that held the box; 316#0;
  - `:711`: the cap, now 96, or 64 in a token pool; 318-rust#0;
  - Session 11's call 4: it broke every private Bootstrap;
  - a *Since the release review* line after Session 11's *Left*: the 2.8 ₳ reserve and its fallback, withdraws while the mix waits, the waits' words, and the entry for a chain with no box of its own.
- The other plan lines DOCS-TODO names (`:490` with_staking, `:737` deposit_across, `:926`/`:953`'s details, 10b's call 1) are additive rather than false. Session 12 records them, and the earlier sections stay as their sessions wrote them.

### The handoff note: fixed
`docs/roadmap.md`: **2026-10-25: 1.6.0's release gate**, newest first, shaped like 1.5.0's note:
- the release's PRs;
- the review and its rounds;
- the surprise (Session 11's own fix broke every private Bootstrap, and `main`'s CI hid it);
- the other highs, the mediums, and the smaller fixes;
- the data layer's changes, so the deploy goes before the upload (`.prev` becomes `68150b39`'s build);
- the lists, the translations and the checks;
- the owner's calls with their recommendations;
- what's left before the PR, and after the merge, in order.

The heading says "release gate", not "prepared for the Web Store": the live run and the back-translation are still to do. The record PR appends *Done that way*, as before.

### post-release-roadmap: 1.6.0's line and what the review left: fixed
`docs/post-release-roadmap.md`:
- **1.6.0's line:** 34g's progress (the rehearsal, the owner's test by hand and its items, the branch review, and this review with a link to Session 12), what's left, and a pointer to *Kept in mind*.
- **A new *Kept in mind* group, "Left by 1.6.0's release review"**, sixteen candidates, each with its finding ids:
  - an "unmixed, now" way out (recommended soon after 1.6.0);
  - Transaction details for every part;
  - waiting parts across a lock;
  - the collateral's mix paid from a token UTxO's ADA (R3-10 (a));
  - R3-14's Rust half;
  - the Bootstrap's way back priced from the parameters;
  - a listed pool confirmed on chain before hand-over;
  - L's registration checked on the data layer's path;
  - 316#1's case (a);
  - which boxes tie a public account;
  - four wide and a later token;
  - a box's own dropped withdraw counted twice;
  - Home's two-window watch untested;
  - the five-minute room cache;
  - the u64 wrap in the store's WebAssembly;
  - the CLI's `sweep` of 21+ tokens (CLI-only, for the CLI's next change, as `h2`/`spin` are recorded).
- **Also fixed:** `:366`'s stale path for `MIX_FEE_ESTIMATE`, now `seedelf-core/src/lovejoin/mod.rs` (DOCS-TODO, rr-1's).

### development.md: fx-misc's cold-start line: fixed
Part 2's paragraph after the curl block: right after a deploy, the token routes can print `503` for up to a minute while the restarted server works out its first pool list, so ask again before taking it for a failed deploy (the runbook says the same).

### development.md: a 1.6.0 flow in the preprod checklist: already-fixed
docs-2 added item 6's 1.6.0 flows: the newer pools from each side, Four boxes a mix, Bootstrap, Start a pool's review, a token swap with the collateral's mix waiting on giveme.my, Bring every box back now, and Max in parts. It also added the live runs' Bootstrap caveat to item 1. Nothing to add. The lock-and-resume of the collateral's mix is 34g's live run, recorded in the plan, not a per-release check.

### development.md: the live harness as docs-2 repaired it: fixed
- **Testing layers, *Live* row:**
  - the harness puts the wallet on preprod before the first page opens, so it runs on `npm run build`'s build;
  - `all` tags its Seedelfs afresh each run (`live1-…`, `live2-…`), and leaves the first, about 1.5 tADA, in the test wallet;
  - CI never runs it, so `tests/live-runs-copy.test.ts` holds its English.
- ***Rules for a change to the screens*:** a renamed control updates `e2e/live/` too, held by that test.

### development.md: beyond the three asked, in this file only: fixed
- ***Branching*: merge only once the PR's check is green on every step.** Nothing runs on `main` after a merge, and #323 merged a minute after its run failed. Step 6 of *Releasing to the Web Store* points to it.
- ***Testing layers*, TypeScript row (fx-tests' DOCS-TODO item):** the screens are rendered to markup, and their wiring is tested over `tests/screens-wiring-review-fixes.test.ts`'s `vi.mock("react")` seam. What a press does after an `await` is its rule's own test's.

## The owner's calls, distilled (in Session 12's *For the owner*)
1. **The privacy policy's date:** re-date it to the merge day, and name the collateral's mix in the header's list. One edit, in the PR.
2. **A return held at its collateral's mix for up to a day:** an "unmixed, now" way out after a few hours, soon after 1.6.0, or in it if the live run finds giveme.my slow.
3. **What a funding adds for that mix:** 2.8 ₳ for site sessions and top-ups, and 1.5 ₳ for swaps and mixes. Keep.
4. **The private Bootstrap's way back:** its boxes plus 3 ₳, and a cap of 96, or 64 in a token pool. Keep; pricing the 1.5 ₳ from the parameters can come after 1.6.0.
5. **R3-13, the collateral's mix on a swap's approval with no box, which has no switch:** one line naming Settings → Lovejoin. A switch only if the owner would rather have one.
6. **Making the Web Wallet check required:** yes. A path-filtered workflow's check stays pending on PRs that don't touch `seedelf-platform/`, though, so it needs a job that always reports.
7. **HANDOFF's leave and accept set**, and the two items it marks *later* and *answered with warnings*.

## Files touched
- `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-34-token-pools.md`
- `seedelf-platform/seedelf-web-wallet/docs/roadmap.md`
- `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md`
- `seedelf-platform/seedelf-web-wallet/docs/development.md`
- this report

## Keys
None added or changed, critical or otherwise.

## Docs to update
None of mine is left. Each needs a touch once its event happens:
- **After fx-last commits:** Session 12's *Round 3c* line, and the handoff note's "was running as this was written".
- **Once e2e runs on the final tree:** the checks' e2e line, in the plan and the note.
- **After the back-translation and the live run:** each record's *Left*.
- **The record PR:** *Done that way* in the handoff note: the merge commit, the deploy, the zip's hash, and the C compiler, Node and zlib lines.

## Calls the owner might overturn (mine)
- **The handoff note's heading** is "1.6.0's release gate", not the usual "prepared for the Web Store", because the live run and the back-translation are still open. Rename it at the record PR if wanted.
- **Item 6's recommendation is mine.** HANDOFF named the required check as the owner's call but gave no recommendation; I added one, with GitHub's path-filter caveat.
- **Pointers in the earlier plan sections:** short parentheticals where the old text is now false, not rewrites. The additive changes are recorded only in Session 12.
- **The CLI-only finding (321-parts-rust#0)** is recorded in post-release-roadmap for the CLI's next change, as `h2`/`spin` are. The wallet pass skipped it.
- **The *Branching* "merge only on green" rule and the TypeScript row** go beyond the three development.md items asked. Both are in my file, and the TypeScript row was fx-tests' DOCS-TODO item for development.md.

## Notes for the lead
- `review/DOCS-TODO.md` and `review/OWNER-CALLS.md` are untracked. The plan links to `review-1.6.0/review/OWNER-CALLS.md`, so commit it with this round. If the folder is archived, fix that link and the one to `review-1.6.0/`; if it's removed, they go, and Session 12 stands on its own.
- I didn't touch flows.md, privacy.md, the policy, or the code another fixer is editing now (Swaps.tsx, swap.ts, two tests). My four files had no other writer while I worked: I checked `git status` before editing development.md.
- The checks line names e2e on round 2's tree, since no e2e log for round 3b's tree is in the scratchpad. If you run e2e before committing, update the two lines named above.

## Checks
- Every relative link and anchor in the four files resolves: a Python check against GitHub's slug rule over each target's headings, 0 bad. It also matches the plan's existing anchors.
- `git diff --check` on the four files: clean.
- A grep of my added lines for release-date and store-status words, and for the name's style: no hits but "Seedelf" written correctly.
- No test reads these four docs (`words.test.ts`, `i18n.test.ts` and `store-images-copy.test.ts` read other paths), so nothing else was run. No formatter was run.
