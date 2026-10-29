# v-pr329-6-trace: pr329#6, the archived plan's live markers and item 2's missing (1.7.0) entry

**Verdict: confirmed. Severity: nit.** Confidence: high. A scratch test checked the text on HEAD `6bca8bec`. #338 changed only item 8's line (roadmap :42) and its *Kept in mind* entry (:405–409), and none of the lines this finding cites.

Two parts of the claim are narrower than stated (see *Narrower than stated*), but every cited line reads on HEAD exactly as quoted.

## What holds

### The archived plan still carries live markers (`docs/archive/plans/chunk-34-token-pools.md`)

- **:910:** `## 34g · The preprod rehearsal and the release (2026-10-18, in progress)`.
  - :9 (the status line, "Every step below happened, [34g](#34g--…-in-progress) last") and :1497 (34g's row, `([done](#34g--the-preprod-rehearsal-and-the-release-2026-10-18-in-progress))`) both link to it. A link whose text is "done" lands on a heading that says "in progress".
  - `git grep` finds that anchor nowhere but :9 and :1497, so a rename is a three-line change inside the file.
- **:1153:** `#### Session 6: the owner's test by hand (2026-10-19, in progress; items 1–5 pushed)`. Session 6 went on to items 6–9, and :1181 says item 9 was pushed (`1cd50db` code, `b5104a9` docs).
- **The strongest point:**
  - **:1487** (S0's row) reads "**(c)** a preprod launch probe (…): its evaluation ✅, the submit still to send".
  - **:1491** (34b's row) reads "✅ The launch builder and its WebAssembly (cert 0; S0c's submit still to confirm it)".
  - **:1284** (the rehearsal's first row) reads "**S0c is settled:** cert 0 registers `mix_logic` with no script witness, and giveme.my signs a launch" (`5ef63891…`).
  - These rows are in *The steps* (:1481), outside 34g's section, so no *Done* line frames them. They also contradict :9's "Every step below happened".
- **Older than #329, inherited by it:**
  - `e6753d22` (2026-10-17, the groundwork) wrote both S0c rows.
  - `030fdcf0` (2026-10-18) wrote the rehearsal's "S0c is settled" and the 34g heading.
  - `ad03ff78` (2026-10-20) wrote Session 6's heading.
  - #329 archived them under its new "✅ done" status, and its description says "Its status lines say it's done". Only the status line (:9) and 34g's row (:1497) were changed, plus the *Done* line (:916). Since the review is of HEAD, the age of the markers changes nothing.

### Item 2 has no (1.7.0) entry (`docs/post-release-roadmap.md`)

- **:33:** "Each item's detail is under [Kept in mind](#kept-in-mind), marked **(1.7.0)**."
- **The marked entries:** `grep -F "(1.7.0)"` finds them at :373 (item 6), :374 (item 7), :378 and :387 (item 4), :379 and :380 (item 5), :388 (item 3) and :405 (item 8). None is for item 2 (:36, "The Web Wallet check required on `main`" (Session 12's call 6)).
- **#329's diff** added "(1.7.0)" to the existing entries for items 3–7. The required check never had a *Kept in mind* entry: before the PR it lived only in the plan's Session 12 call 6, now archive :972.
- **Item 1 has none either.** It's housekeeping, done and described in its own line, so this is a technicality, but the header says "each item".

## Narrower than stated

- **The *Next* paragraph (:918) doesn't read as live.**
  - #329 put this at :916, between the heading and *Next*: "**Done:** every step this section names happened, and 1.6.0 shipped from `babb8e76` (#324). What it left is in … *Kept in mind*; what follows is the record."
  - Only the heading `### Start here (the next session)` (:914) still reads as live, in an outline.
  - Sessions 12 to 5 are `####` under that heading, so the same *Done* line frames Session 6's body as record. Its heading still shows "in progress" in any outline or table of contents.
  - The scenario's "sees … its *Next* list of the owner's steps" therefore doesn't happen to someone reading in order. The finding's own fix allows for this ("or leave it, with the *Done* line explaining").
- **Item 2's reader isn't stranded.**
  - Item 2's own line links `development.md#branching`.
  - That section's :13 holds the detail (the *Web Wallet required* job that always reports) and ends "(1.7.0)".
  - So the finding's "its detail is Session 12's call 6, now in the archive" is incomplete: since #331 the detail is also in development.md. The header's promise is still broken for item 2.

## Other markers of the same kind, not named (all under :916's framing)

- :1176 "**Uncommitted.**" (Session 6, item 9, pushed per :1181).
- :1179 `#### Session 7 starts here: …`, :1181 "Item 10 waits for that test", :1185 "Still to confirm with the owner before building that branch".
- :1142 `#### Session 8's handoff: …`.

## Aside, outside this finding: development.md:13 says the check is already required

- **development.md:13:** "That job is the one `main`'s branch protection requires".
- **Checked read-only on 2026-10-28:** `gh api repos/logical-mechanism/Seedelf-Wallet/branches/main` returned `{"protected":true,"checks":{"checks":[],"contexts":[],"enforcement_level":"non_admins"}}`. No status check is required yet.
- **So item 2's line is the accurate one:** :36 says "left, the owner's: requiring it". development.md states the intended state as fact.
- This is #331's area, which another reviewer may hold. It bears on this finding's fix: an entry pointing at development.md should say that requiring the check is still the owner's.

## Repro

- **The test:** `extension/tests/zz-review-v-pr329-6-trace-1.test.ts` read both docs from the tree, run alone with `npx vitest run`.
- **Controls (must pass):**
  - the status line is "✅ done, in 1.6.0";
  - "Every step below happened", "**S0c is settled:**" and the *Done* line are present;
  - the header promises a (1.7.0) entry for each of eight items, numbered 1 to 8.
- **Claims (fail if the finding is real):**
  - no heading says "in progress";
  - no step row says "still to send/confirm";
  - 34g's "done" link doesn't land on an `-in-progress` anchor;
  - each item has a (1.7.0) line under *Kept in mind* naming it.
- **Result on HEAD: 5 failed, 8 passed, as expected if the finding is real.**
  - **Headings:** :910 "(2026-10-18, in progress)" and :1153 "(2026-10-19, in progress; items 1–5 pushed)".
  - **Step rows:** :1487 "… its evaluation ✅, the submit still to send" and :1491 "S0c's submit still to confirm it".
  - **The 34g link's anchor:** `34g--the-preprod-rehearsal-and-the-release-2026-10-18-in-progress`.
  - **Items 1 and 2:** no entry.
  - **Items 3–8:** each matched an entry, so the matching works.
- **A false pass I caught:** the first run cut each line to 110 characters before filtering, which hid :1487's "still to send" deep in the row. I fixed it to filter on the whole line and ran again.
- **Deleted afterwards.** The tree shows only the untracked review folder, plus another agent's `zz-review-x-scen-1.test.ts`.

## Fix advice

- **S0 and 34b rows:**
  - "its evaluation ✅, the submit still to send" becomes "✅ evaluated, then submitted in the rehearsal (`5ef63891…`)".
  - 34b's "(cert 0; S0c's submit still to confirm it)" becomes "(cert 0, confirmed by S0c in the rehearsal)".
  - These are the only markers outside the *Done* line's framing, so they matter most.
- **Headings:**
  - :910 becomes `(2026-10-18)`, with the anchor updated at :9 and :1497 only.
  - Don't add an end date: the owner's rule 7 is that docs never date a release.
  - :1153 drops "in progress; items 1–5 pushed".
  - :914 "Start here (the next session)" can become "The handoff, as left" (no file links to its anchor), or stay, given :916.
- **Item 2:**
  - Add a one-line entry under *Left by 1.6.0's release review*, where Session 12's other calls went. For example: "**The Web Wallet check required on `main` (1.7.0)** (Session 12's call 6): the job is in ([development.md](development.md#branching)); requiring it is the owner's."
  - Or reword :33 to "Each item's detail is in its line or under Kept in mind, marked (1.7.0)", which also covers item 1.
  - If development.md:13 keeps its present wording, don't point the entry at it as proof that the check is required.
