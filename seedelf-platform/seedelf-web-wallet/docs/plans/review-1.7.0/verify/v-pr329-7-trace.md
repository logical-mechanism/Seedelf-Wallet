# v-pr329-7-trace: pr329#7, the archive's ID table has no row for chunk 34's families

**Verdict: confirmed. Severity: nit** (docs only; nothing shipped behaves differently). The stated scenario is the weakest example of the problem. Two sharper ones are below.

## What I traced, on HEAD (`6bca8bec`)

1. **The table has no chunk 34 row.** `docs/archive/plans/README.md:11-18` has rows for crypto-review, launch-review, the launch review's second round, privacy-review, independent-review and review-1.6.0. Its history: `83880dd6` (chunk 22) wrote it, and `ef6af2bc` (2026-10-26) added 1.6.0's row when that review was archived ("as the archive README's table now says too"). No commit in `babb8e76..6bca8bec` touches it. #329 (`d67f8054`) moved `chunk-34-token-pools.md` into the archive and added no row.
2. **The plan holds the families, and #329 kept them as they were.** The plan's IDs are unchanged. #329 added only a *Done* note, a new status line and fixed relative links. The families are all there:
   - the rehearsal's findings (`chunk-34-token-pools.md:1312`, `**R0, high` at :1314);
   - the release review's MONEY, PRIV, DATA, UI and STATE ids (:1323);
   - fix round two's MERGED-1 to 5 (:1341), R2-1 to 4 and R3-1 to 3 (:1348: "**R3-1, medium, fixed:** a copy holding the wallet's boxes is read at every pool read");
   - the last review's WORKER, SCREENS, CROSS, PRIVACY and I18N-DOCS ids (:1351);
   - calls 34 to 36 (:291, :298, :79).
3. **The code cites them.** The finding's counts match. `MERGED-[0-9]` is on 50 lines (53 citations) in ts/tsx/rs files, and `\bR2-[0-9]` on 27. "call 34" appears 33 times and "call 36" 32 times.
4. **The R3 names clash.** 1.6.0's R3-1, R3-2 and R3-3 (`git show 7e2d89ed:.../review-1.6.0/review/CONFIRMED.md`, `## R3-1` at :5, `## R3-2` at :56, `## R3-3` at :105) are different findings: the collateral-mix wiring's missing test, the half-mixed box's payer note, and the escape hatch naming no account. Chunk 34's are a copy's read, a copy's own reason, and architecture.md's rows. The table lists only 1.6.0's (`README.md:18`: "the review of the fixes `R3-1`–`R3-31`").
5. **Both families are cited in code, some with no qualifier.** Of the 35 R3-1/2/3 citations:
   - **Chunk 34's:** `lovejoin.ts:2393`, `:5506`, `:5841`; `rpc.ts:2352`; `Lovejoin.tsx:1259` `(\`again\`; R2-2, R3-2)` (bare); `Lovejoin.tsx:1574` and two tests, as "the last review, R3-2". That phrase is ambiguous even inside the plan: its *The last review (session 4)* section holds WORKER-n and SCREENS-n, not R3-n.
   - **1.6.0's:** `SiteSessions.tsx:530` and `DappApprovals.tsx:450` `(R3-1)` (bare); `lovejoin.ts:6449` `(hatchOrder, R3-3)` (bare); `lovejoin-crediting-review-fixes.test.ts:603` `(R3-2)` and `:618/:630` `(R3-3)` (bare); and others that name 1.6.0.

## The scenario, weighed

The finding's own example is the weakest one. `lovejoin.ts:2393` reads "fix round two's last review, R3-1", which doesn't match the 1.6.0 row's citation form ("1.6.0's review of the fixes, R3-9"). A reader who greps "fix round two" lands on the right plan. Two sharper paths are real:

- **A bare `R3-2` has two meanings in Lovejoin's own code.** `Lovejoin.tsx:1259` means chunk 34's: a copy's own reason, `again`. `lovejoin-crediting-review-fixes.test.ts:603` means 1.6.0's: Bring one back anyway's payer note. The table can resolve a bare R3-2 only to 1.6.0's, and that answer looks plausible for the same page.
- **"1.6.0's rehearsal" sends readers to the wrong file.** The code cites chunk 34's rehearsal 19 times this way, for example `ReviewTotals.tsx:36` and `Lovejoin.tsx:3728/3932` "(1.6.0's preprod rehearsal, R3)". The table's only 1.6.0 row is `review-1.6.0.md`, which never mentions a rehearsal and holds an R3-n family.

**The premise is overstated, but the finding still holds.** The table doesn't list "every review whose IDs the code cites". Chunk 23's usability-review families (ST, DX, PY, HM, …, hundreds of citations) live in `docs/usability-review.md`, outside the archive, with no row. So the table indexes the archive only. Chunk 34's plan is now in the archive, so the finding stands.

**The clash itself predates this range.** Chunk 34's R3-n date from 2026-10-19 and 1.6.0's from 2026-10-25. #329 made it reachable through the archive's index.

## Repro

Scratch test `extension/tests/zz-review-v-pr329-7-trace-1.test.ts`, run alone with `npx vitest run`, then deleted. It has 4 tests: 3 passed and 1 failed.

- **Passed (the facts):**
  - the plan defines its own R3-1 to R3-3, MERGED-1, R2-1, R0, SCREENS-1 and CROSS-1;
  - the 1.6.0 row lists `R3-1`–`R3-31`, and `review-1.6.0.md` never mentions a rehearsal;
  - the code cites both families' R3-1 and R3-2 (four of them bare), and "(1.6.0's preprod rehearsal, R3)".
- **Failed (the gap):** "the archive's table has a row for chunk-34-token-pools.md" returned `expected false to be true`.

## Fix advice

Add a row for `chunk-34-token-pools.md` (2026-10-17/25). It should list the citation forms the code really uses, which vary:

- the rehearsal's R0–R12, cited as "1.6.0's (preprod) rehearsal, R10" and bare;
- the release review's MONEY, PRIV, DATA, UI and STATE ids, and its fixers FEED, RULES, DISCOVERY, SCREENS and RUST;
- fix round two's MERGED-1–5, then its reviews' R2-1–4 and R3-1–3, cited as "fix round two's last review, R3-1", "round two's review, R2-2", "the last review, R3-2" and bare;
- the last review's WORKER, SCREENS, CROSS, PRIVACY and I18N-DOCS ids, cited as "34g's last review, SCREENS-3";
- the steps' reviews, cited as "34e's review, 9" and "34d's review 4";
- D1–D3, §1–§10, session 1's numbered decisions, S0a–S0d, and the owner's calls (call 34–36).

The row should also say these are not `review-1.6.0.md`'s R3-n, and that "1.6.0's rehearsal" means this plan. The 1.6.0 row could say the reverse. Renumber nothing, since the README says these files never are. New citations should name the plan: "chunk 34's fix round two, R3-1".
