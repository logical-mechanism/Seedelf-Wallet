# v-x-docs-9-trace: x-docs#9, the archived chunk 34 plan's 34g heading "in progress" under a ✅ status

**Verdict: partly. Severity: nit.** Confidence: high. Checked on HEAD `6bca8bec` with a scratch test, since deleted.

- **What's true:** the heading's word is stale.
- **What isn't:** the misreading scenario. The plan itself, the archive's README and the current docs already prevent it.
- **Narrower than stated:**
  - The pattern isn't specific to 34g.
  - This finding is a subset of pr329#6, which `verify/v-pr329-6-trace.md` already confirmed as a nit.

## What holds (the literal claim)

- **The cited lines read exactly as quoted on HEAD:**
  - **:910:** `## 34g · The preprod rehearsal and the release (2026-10-18, in progress)`
  - **:914:** `### Start here (the next session)`
  - **:1497:** `the handoff note ([done](#34g--the-preprod-rehearsal-and-the-release-2026-10-18-in-progress))`
  - **:9:** links the same anchor.
- **What #329 did** (`git diff -M d67f8054^1 d67f8054`):
  - It rewrote the status line from "🚧 … under way" to "✅ done, in 1.6.0".
  - It relabelled the table's 34g link text from `under way` to `done`.
  - It added the **Done:** line at :916.
  - It left the heading as `030fdcf0` (2026-10-18) wrote it.
- **The links:**
  - Only :9 and :1497 link to the heading's anchor. `git grep` finds no other tracked file that does.
  - All 59 of the plan's in-file anchor links resolve on HEAD.
- **Nothing later in the range changed this file:**
  - `git log babb8e76..HEAD` on the file shows only #329's commit.
  - HEAD's blob is #329's (`dee39268…`).
  - #338 touched only `post-release-roadmap.md`.

## Why the scenario doesn't hold

The scenario: an agent skims the outline, sees "in progress" and "Start here (the next session)", and treats 1.6.0's gate as unfinished "before reading #329's *Done:* line". It is handled at four levels:

1. **The section.** The first paragraph under :914 is :916: "**Done:** every step this section names happened, and 1.6.0 shipped from `babb8e76` (#324). … what follows is the record." The scenario itself concedes that the agent reads it.
2. **The file.** :9 says "**Status: ✅ done, in 1.6.0** … Every step below happened, [34g](#34g--…-in-progress) last". The one link that names the heading sits inside a sentence saying it's done.
3. **The folder.**
   - `archive/plans/README.md:3`: "**A record, not maintained.** Every file here describes a chunk or a review as it was built, and much of it has been superseded since — a design replaced, an API renamed, a step done. **Don't build from it.**"
   - `plans/README.md:5` names this exact risk: "A stale plan read as current is the one failure mode that costs real work, so none stays here once it's done." The house remedy is the move to `archive/`, and #329 made it.
4. **The entry points.**
   - `post-release-roadmap.md:31`: "the gate's PR, #324, which shipped as 1.6.0".
   - `roadmap.md:49`: "The plan's *34g* is the release's record".
   - No current doc links the 34g anchor. They link Session 12, Session 11 or 34a′.

## Narrower than stated

- **The pattern isn't specific to 34g.**
  - **The same file** keeps two more such headings:
    - :1153 `#### Session 6: the owner's test by hand (2026-10-19, in progress; items 1–5 pushed)` (`ad03ff78`)
    - :1179 `#### Session 7 starts here: …`
  - **Other archived plans:** 14 keep a `## Start here` heading (chunk 05, 07, 08, 09, 10, 11, 12, 13, 14, 15, 15b, 16, 17 and 24).
  - **#329's own scope:** its description says "Its status lines say it's done … every relative link in the changed files resolves". It did what it said, and keeping the headings is the archive's practice.
  - **The fix's "retitle" option** would fix :910 alone and leave :1153's "in progress".
- **It's a duplicate.**
  - pr329#6 (`verify/v-pr329-6-trace.md`, confirmed nit) already holds :910, :1153 and the 34g link's `-in-progress` anchor.
  - pr329#6 also holds a stronger case outside the *Done* line's framing: the S0c step rows at :1487 and :1491 ("the submit still to send" and "still to confirm it").
  - x-docs#9 should be folded into pr329#6, not listed on its own.

## Fix advice

- **Preferred:** leave it. This is the finding's own first option, and the archive README's rule.
- **If the owner wants it tidied,** do it as part of pr329#6:
  - Retitle :910 to `## 34g · The preprod rehearsal and the release (2026-10-18)`.
  - Point :9 and :1497 at `#34g--the-preprod-rehearsal-and-the-release-2026-10-18`. No other tracked file links to the heading.
  - Drop ", in progress; items 1–5 pushed" from :1153. Nothing links to Session 6's heading.
  - Leave `Start here` (:914) as the other archived plans do. Nothing links to it.

## Repro

- **The test:** `extension/tests/zz-review-v-x-docs-9-trace-1.test.ts`, run alone (`npx vitest run tests/zz-review-v-x-docs-9-trace-1.test.ts`).
- **Result on HEAD: 1 failed, 4 passed,** as expected if the literal claim is real and the scenario is handled.
- **Fails (the claim is real):**
  - The case: "a plan marked done no longer heads 34g 'in progress'".
  - The status line matched `✅ done, in 1.6.0`.
  - The heading received was `34g · The preprod rehearsal and the release (2026-10-18, in progress)`.
- **Passes (the scenario is handled):**
  - The first non-blank line after :914 is the `**Done:** … shipped from \`babb8e76\` (#324)` line.
  - :9 holds "Every step below happened, [34g](…) last".
  - The archive README holds "A record, not maintained." and "Don't build from it."
  - There are 59 in-file anchor links, 0 broken, and only :9 and :1497 point at 34g.
  - The stale-looking headings are exactly :910, :914, :1153 and :1179.
- **Cleanup:** the file was deleted after the run. `git status` shows no file of this label.
