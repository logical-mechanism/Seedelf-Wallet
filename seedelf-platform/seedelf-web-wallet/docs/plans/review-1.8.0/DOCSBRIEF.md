# 1.8.0's release review: the docs writer's brief

You write 1.8.0's docs: what chunk 44's 44d still owes, and what the review and its fixes changed. You work on the merged tree, after the fixes landed: the worktree `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/merged`, branch `review-1.8.0/merged` at `4b4628e9`. Edit there, and only there; run no git command that changes state (the lead commits). Round two's reviewers are reading the same code as you write: if their fixes change behaviour, the lead hands you a touch-up later. Read before you write:
- the reviewers' brief, [REVIEWBRIEF.md](REVIEWBRIEF.md): the owner's calls, the rules, the never-do list;
- [FINDINGS.md](FINDINGS.md), its round-two section too;
- the fixers' reports, [fix/*.md](fix/), which say what each fix changed;
- the plan, `docs/plans/chunk-44-lovejoin-v2.md`;
- [R2BRIEF.md](R2BRIEF.md)'s *What the lead did at the merge*: critic#2's look is in (Settings' Bring every box back, with no pool named, looks first), Stop's dialog counts a 1.7.2 swap's boxes as its return does, and the retired pools' Try again asks its own question.

**Every sentence you write about the wallet's behaviour is checked against the merged code,** not against a plan or a report. A doc that says what a plan meant, when the code does otherwise, is the failure this pass exists to stop. Where code and report disagree, the code wins; say so in your report.

## The house style

- **Plain, short sentences.** Say what the wallet does, then why, citing the owner's call or the review's ID where one decided it (e.g. "(the owner, 2026-11-06)", "(1.8.0's release review, R1)").
- **Always *Seedelf*,** and *Seedelf Wallet* for the app. The screens' names are *private balance*, *public account*, *Make private*, *Make public*, *Send*.
- **No dates for releases, and nothing about what the store is doing** (the owner, 2026-10-04). The privacy policy's *Changes* entries are dated: that's the one place.
- **Match each doc's own voice and density.** Don't reflow paragraphs you don't change. No formatter.
- **docs/plans/** holds live plans only. A finished plan moves to `docs/archive/plans/`, ending with a record of what its PRs did (`docs/plans/README.md`).

## What's owed

1. **The privacy policy** (`docs/store/privacy-policy.md`) owes a dated entry under *Changes* (D2), written as of **6 November 2026**, and the *Effective* line moved to that date with what it adds.
   - The entry covers each change to what the wallet sends or keeps, each checked in the code:
     - **The older pools are retired.** The classic pool, and every pool on Lovejoin's earlier contracts, take no new box, and the wallet mixes none there again.
     - **The first unlock after the update.** It brings back every box of the user's in those pools, one right after another, without the waits, mixed or not. Each withdraw goes to giveme.my and the Cardano server. On chain, back-to-back withdraws are easier to tie together, and a box not mixed since its deposit is tied to that deposit, and through it to the account that paid.
     - **The 5 ₳ pool.** A private session's spare ADA and its 5 ₳ collateral now go into a pool of 5 ₳ boxes on Lovejoin's current contracts. They come back directly while there's none, or while it holds fewer than its floor of other people's boxes (30 on mainnet).
     - **The new look** (O1, and critic#2's if the lead made it). While the wallet knows of no such pool, it now also looks for one at times the policy doesn't name today: say exactly which (a return's build, a swap's review, a funding, Settings' Bring every box back), how often at most, and what each asks of whom. On mainnet, our server's list, as every pool read. On preprod, with Koios only, or when ours can't answer, Koios's read of Lovejoin's reference holder, as opening Lovejoin's page does.
     - **What's kept.** Encrypted like the contacts: when the wallet retired the older pools on this device, and whether a stopped Bring every box back was the retired pools' run. Check what `Schedule` and `bringStopped` really keep after the fixes.
   - The body's lines that the entry makes stale:
     - *Lovejoin's pools* (`:46`): the look's times;
     - *Your Lovejoin boxes* (`:28`): the retired pools, what's kept;
     - and any other line that names the classic pool as where returns go.
2. **`docs/privacy.md`, its Lovejoin parts** (`:195` to `:234` at `a6c94743`; release#8): the retired pools, nothing held there, and the first unlock's bring-back with its timing cost (44d's note). Also:
   - the 5 ₳ pool taking returns and the collateral, and returns direct until its floor;
   - the look at an ask (`:201`);
   - what a return in 5 ₳ boxes costs: about twice the fees for each ₳ mixed, and one chain carrying 160 ₳ two waves deep, the rest back at once (P3, adapool#3's figures; check them).
3. **`docs/architecture.md`, its Lovejoin section** (`:669` on; release#6, its list):
   - retirement (`isRetired`, `takesNewBoxes`, `usableNow`) and `adaPool`, with its ask and its look;
   - `retireOnce`, as the fixes left it;
   - the hub's retired rows, and the copy rule per set;
   - the 5 ₳ pool's sharing: `roomIn`, Mix my boxes again's hold (P1), and Stop's `ifLeft`;
   - a return's tokens with no 5 ₳ pool (O5), and a 1.7.2 swap's cap (critic#4);
   - nothing held in a retired pool, and the restore's design (a restored wallet finds its boxes when Lovejoin's tile opens; Settings' Bring every box back looks first, if the lead's critic#2 fix is in).
4. **`docs/flows.md`, its Lovejoin flows** (`:73`, and `:499` on; release#7, its list):
   - the hub with retired pools and "No pool to mix in yet";
   - a retired pool's page, withdraw-only;
   - Settings' retired pools' run, and Try again (R4);
   - the connector's hedged lines (O3), and the swap's box words (W1);
   - every figure at 5 ₳.
5. **`docs/lovejoin-mix-width.md`** (release#9, tests-e2e#4): lead with v2's figures, which the doc's own v2 table gives. Call the classic and 8131b1d tables what the wallet mixed on before 1.8.0. Recompute the worst-case table and *What four would cost a user* on v2's rows, or say plainly which pool each row is.
6. **The web wallet's `README.md`** (`:47`, `:57`; release#10): 10 ₳ boxes to v2's 5 ₳, the shown rule per set, and a short paragraph for 1.8.0 (Lovejoin v2; the older pools withdraw-only; the first unlock brings their boxes back), in the README's own manner.
7. **`docs/development.md`:**
   - `release_version=1.8.0`, and the zip's name (`:181`, `:278`; release#14);
   - the head start (`:330`): "never a gate: a pool launched after it is found live" is true again with O1. Say how: the data layer's list on mainnet; Koios's holder at an ask on preprod and with Koios only;
   - the preprod checklist (`:143`, `:144`; release#11):
     - item 6 on v2's 5 ₳ pool, with a second wallet's boxes in it to mix with (a pool holding the tester's own boxes alone has nobody to mix with);
     - a restore with boxes in retired pools;
     - and say that the token-pool items wait for a v2 token pool on preprod;
   - the Cardanoscan step (`:331`), as D3's fix leaves `lovejoin-registry`.
8. **`docs/backlog.md`** (release#13):
   - delete what 1.8.0 settled: line 71's "four-switch-classic-bend" and its "Mix ADA in 10 ₳ boxes";
   - add a line, in its area, for each thing the review leaves open: every finding a fixer didn't fix (their reports say), critic#6 (Settings' Lovejoin row), P3 for the owner to weigh, a preprod v2 token pool for the checklist, and anything else the fixers' *For the lead* name as open.
9. **The store listing** (`docs/store/README.md`, `:59`, `:147`, `:211`; release#12):
   - in en, es and ja: new boxes go only into the first pool started for each box value on Lovejoin's current contracts, and pools on its older ones take none;
   - keep the rest of that bullet;
   - es and ja follow the listing's own register and the glossary;
   - say in your report what the upload must paste.
10. **The glossary** (`docs/i18n/glossary.md`; W11): a row for *retired*, a Lovejoin pool and its scripts: es "los scripts retirados de Lovejoin", "los pools retirados"; ja 廃止済みのスクリプト, 廃止されたプール; bound to the scripts, never to Lovejoin. Mind es's "retiro", a withdrawal.
11. **`extension/scripts/lovejoin-registry.mjs`** (D3, a tool):
    - accept a v2 pool;
    - name its set in its entries, so a v2 pool's never collide with the 8131b1d 5 ₳ pool's (e.g. "Mix Box v2 (5 ADA)", within the registry's 45 characters);
    - link `COMMIT_V2`'s tree for v2's `mix_logic`;
    - a test that reads the script as the release reviewer's scratch test did (`wt/release/…/tests/release-registry-scratch.test.ts`): never run the script, and never touch the owner's fork.
12. **The plan:** `docs/plans/chunk-44-lovejoin-v2.md`.
    - Mark 44c and 44d: the owner's call of 2026-11-06 (in their words) replaces 44c's head-start gate. Then record what's done, and what stays the owner's: the mainnet pool's launch, the data layer's deploy, and the Cardanoscan names.
    - End it with a record of what its PRs did (#363, #364, and this release's PR, by its branch).
    - Then move it to `docs/archive/plans/`, and fix every link to it.
    - Don't open or edit the chunk 40–43 plans.

## Don't

- Don't edit `docs/releases.md`: its 1.8.0 row and section come with the record PR, after the upload.
- Don't edit `docs/i18n/verified-critical-*.json`: the lead's translation round does.
- Don't touch the code, but for item 11.
- Never run `npm run lovejoin-registry`, `tokens`, `dreps`, `lovejoin-pools`, `package` or `store:images`.

## Your report

Write `docs/plans/review-1.8.0/docs.md`, with:
- each item: what you changed, and the code you checked each claim against (`path:line`);
- what you found false in a fixer's report, or in the plan;
- what you left, and why.
