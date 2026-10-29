# v-pr325-0-trace: pr325#0, "Done that way" leaves out `status` and checklist item 9

**Verdict: partly. Severity: nit** (the finding says low). Confidence: high on every fact below; the severity is a judgement.

Every fact the finding states holds on HEAD (`6bca8bec`). The scenario's premise and its "next record" risk are narrower than it says, and the `status` half is a standing process question for the owner, not a lapse of #325.

## Traced: what holds

- **The plan and the record.** roadmap.md:62 reads "the API's deploy from the merge commit (Actions → *Data layer deploy*, `deploy`, then `status`) … then the package on the merge commit, e2e on it, checklist item 9, the upload (…), and the record PR." roadmap.md:63 opens "**Done that way:**" and records the merge (`babb8e76`), deploy run 40440233291, the four route checks (each `200 application/json`), `/health`, the package (its SHA-256, toolchain and reproducibility) and e2e 104. It says nothing about `status` or item 9. #325's diff is that one line (`git diff a5fc6576^1 a5fc6576`), and its PR body omits both as well.
- **The scratch test** `extension/tests/zz-review-v-pr325-0-trace-1.test.ts` (run alone, then deleted) has 4 tests:
  - 2 controls pass: the plan line contains "`deploy`, then `status`" and "checklist item 9", and the record contains the run id, "route checks", "SHA-256" and "e2e suite, 104 tests".
  - **2 fail on HEAD:** the record doesn't match `/item 9/`, and it doesn't match `/status|DEPLOYED/`. Result: "Tests 2 failed | 2 passed (4)".
- **No `status` run.** `gh run list --workflow data-layer-deploy.yml` returns 11 runs. `gh run view <id> --json jobs` shows exactly one `status` run ever: 37999933789 (2026-10-09, `b6144d10`), whose `build` job was skipped and whose vps step was named `status`. That was 26c's drill. Every other run is a `deploy`. The run after 1.6.0's deploy 40440233291 (`babb8e76`) is 40713719454 (2026-10-28, `641f751c`), which is also a deploy.
- **The deploy printed what `status` shows.** Job 121978929173 logged `2026-10-27T02:46:52Z DEPLOYED 942e3bbc21a18eb22d31e6efd7a6dc03ee0dea90ab63bd6ec4bb38e30fb1852f (3b03a0e98ac700db2911898f62929371c6c0f475646a3d99f0193c54aedcfa1c kept as .prev)`. `seedelf-data/deploy/README.md:146` says this is the same sha256 that `status` prints.
- **Item 9 was handed to the owner.** In the packaging session (`09bbfc44…jsonl`):
  - [183] gave the owner steps "## 1. The status run" and "## 3. Checklist item 9".
  - [187] the owner replied (03:14Z): "will publish tomorrow after I do the checklist locally".
  - [198] the memory note read "the `status` run not yet made … The owner does checklist item 9 locally".
- **Nothing on file records item 9's outcome.** `git grep -iE "item 9|checklist item"` at HEAD finds only the plan lines (roadmap.md:62, chunk-34 plan :986, development.md :205/:244/:288). #325's body, the memory files and every other release record (#295, #297, #307) are silent too.

## Where it's narrower or different

1. **A mainnet test by hand did happen; only item 9's own bullets are unknown.**
   - In session `6b05df79…jsonl` [5], at 2026-10-27T16:42:44Z, the owner wrote: "Alright, 1.6.0 is submitted for publishing. Tested on mainnet pool creation and did a swap. Everything seems to be working as expected."
   - That was 53 minutes before #325 merged (17:36:00Z). It was written in a session that never touched the record, and the session that wrote the record never saw it.
   - The owner doesn't say which build was tested. `dist/` had held the store build since the packaging run ([183]).
   - So the scenario's "a mainnet-only fault in the shipped build went unchecked" is overstated. A Lovejoin pool start and a swap on mainnet go through the data layer and Minswap.
   - What isn't known is item 9's own list: the network switch and its refusals, a site asking again, the mainnet network panel's host list, and Koios-only both ways.
2. **The owner was told about `status`, and skipping it is standing practice.**
   - The record-writing session told the owner before the merge, at [204], and again when it opened #325 ([259], 16:10Z): "**Not in it:** the `status` run, because there still isn't one. Run it before you publish if you want the record to have it too." The owner merged it.
   - No release deploy since the workflow's first day has been followed by `status`: 1.4.0 (`b5ad15a`, 38016094296), 1.4.1 (`fd412c0`, 38155254641), 1.5.0 (`63f87b8`, 38419150936) and 1.6.0.
   - 1.4.1's note (roadmap.md:115) and 1.5.0's (:89) have the same shape: a plan that names `status`, then "Done that way" without it.
   - So the docs and the practice disagree, and that is the owner's call to settle. It isn't something #325 got wrong.
3. **The record follows its template, and every record has left item 9 out.**
   - The template asks for the version, the commit, the zip's SHA-256, and the C compiler, Node and zlib lines (development.md:262, part 3 step 6; :291, step 12). #325 carries every one of them.
   - The by-hand check of the store build has been in the package step since 2026-09-27 (`ea209f6a`: "Then do checklist item 8 by hand on it"). `c6799dfa` renumbered it to item 9 on 2026-10-02. No record since has carried its outcome.
   - So "the next record, copied from this one, can drop item 9 silently" describes what every record already does; #325 didn't start it.
4. **It doesn't touch the 1.7.0 gate.** The change is docs only. No test reads roadmap.md or development.md:
   - `words.test.ts` scans `.ts`/`.tsx` under `src` only.
   - `live-runs-copy.test.ts` and `activity.test.ts` name the docs only in comments.

What's left is a lead-in, "Done that way", that by implication vouches for a `status` run that didn't happen (and would have shown nothing the `DEPLOYED` line didn't) and for an item 9 whose outcome isn't on file. That is wording on a past record: a nit.

(The relayed note about #338 concerns the 1.7.0 list's item 8, the Leios run. That item is unrelated to the preprod checklist's item 9.)

## Fix advice

- **Don't apply the proposed clause as written.**
  - "<outcome>" is the owner's to give.
  - The owner's chat report (a pool started and a swap on mainnet) isn't item 9's list, so it mustn't be labelled "item 9".
  - Never copy "submitted for publishing", which would state the store's status (rule 7).
- **A truthful edit that needs no input from the owner,** at roadmap.md:63:
  - Change "**Done that way:**" to "**Done that way, bar the `status` run** (the deploy's own `DEPLOYED 942e3bbc… (3b03a0e9… kept as .prev)` says what it would show):".
  - At the end add: "Checklist item 9 was the owner's, by hand, and its outcome isn't recorded here."
  - Or leave the line alone: it's a nit.
- **Owner's call A, the `status` step.** It has never been run after a release deploy. The options:
  - Drop "then a `status` run" from development.md:205 and :280, and "after its `status` run" from the runbook (`seedelf-data/deploy/README.md:142`). Then point development.md:217's "`status`'s `.prev`" at the deploy's `DEPLOYED … kept as .prev` line; the runbook's :146 already explains that the two are equivalent.
  - Or keep the step, and have each record carry its output.
- **Owner's call B, item 9 on the record.** If the owner wants item 9's outcome on record, add it to the template (development.md:262 and :291), so that 1.7.0's record carries it. Adding it only to 1.6.0's note isn't enough.

## Evidence (commands, read-only)

- `sed -n '62p;63p' docs/roadmap.md`, and `git diff a5fc6576^1 a5fc6576` (one added line, :63).
- `gh run list --workflow data-layer-deploy.yml` and `gh run view <id> --json jobs`: `status` appears only in 37999933789; every other run has a `deploy` step.
- `gh api repos/logical-mechanism/Seedelf-Wallet/actions/jobs/121978929173/logs`: the `DEPLOYED 942e3bbc… (3b03a0e9… kept as .prev)` line.
- `gh pr view 325|295|297|307`: no record names item 9 or `status`.
- Transcripts: `09bbfc44-…jsonl` [183], [187], [198], [204], [259]; `6b05df79-…jsonl` [5].
- `git log -S "by hand on it"` → `ea209f6a` (2026-09-27, item 8); `git log -S "checklist item 9"` → `c6799dfa` (2026-10-02).
- Scratch test: run, 2 failed and 2 passed as predicted, then deleted. No other file in the tree was touched.
