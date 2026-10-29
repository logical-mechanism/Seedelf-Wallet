# v-pr325-0-impact: pr325#0, "Done that way" leaves out `status` and checklist item 9

**Verdict: partly. Severity: nit** (the finding says low). Confidence: high on the facts, high on the impact.

## What holds

- **roadmap.md:62** says "the API's deploy from the merge commit (… `deploy`, then `status`) … then the package on the merge commit, e2e on it, checklist item 9, the upload …, and the record PR". **:63** opens "**Done that way:**". It records the deploy run, the four curls, the package and its hash, the reproducible build and e2e 104. It doesn't mention `status` or item 9.
- **No `status` run.** `gh run list --workflow data-layer-deploy.yml` has 11 runs. Only one of them is a `status` run: 37999933789, on 2026-10-09, while the workflow was being set up (26c). Its `build` job was skipped and its `vps` step was `status`. Every other run is a `deploy`: 1.4.0's b5ad15a7, 1.4.1's fd412c08, 1.5.0's 63f87b82, 1.6.0's babb8e76 (40440233291), and 40713719454 on 2026-10-28 from 641f751c. That last run printed `already running 942e3bbc…: nothing to do`.
- **Nothing was lost by skipping `status`.** The 1.6.0 deploy's own log (job 121978929173) printed `installed 942e3bbc… (was 3b03a0e9…)`, then `check: /health 200 (was 200), CORS answers the store's origin`, then `DEPLOYED 942e3bbc… (3b03a0e9… kept as .prev)`. `status` (`seedelf-data/deploy/edge/seedelf-data-deploy:55-61`) prints the running sha, `.prev`'s sha, `/health` and CORS. That is the same information.
- **Item 9's outcome isn't recorded anywhere in the repo.** In session 09bbfc44, the owner wrote at 03:14Z: "will publish tomorrow after I do the checklist locally". The record PR was opened at 16:10Z, and the session wrote then: "tomorrow's checklist and upload use the same files". So when it wrote "Done that way", item 9 was still pending to the session's knowledge.

## Why the impact is smaller than the finding says

1. **No user, site or attacker can reach it.** This is a historical handoff note about a build that has already shipped. It gates nothing. 1.7.0's checks come from `development.md` (part 2, :244 and steps 7 and 9, :280/:288), which name `status` and item 9 independently of any record.
2. **The scenario's premise doesn't hold.** It rests on "If item 9 was skipped". In session 6b05df79, at 2026-10-27T16:42Z, the owner wrote "Tested on mainnet pool creation and did a swap. Everything seems to be working as expected." That was before #325 merged at 17:36Z. So the shipped build was checked by hand on mainnet. What isn't on file is item 9's own bullets: the network switch, the review refused after a switch, a site asking again, the host list and Koios-only.
3. **The `status` gap was disclosed and accepted.** The packaging session told the owner twice before the merge (messages 204 and 259): "Not in it: the `status` run, because there still isn't one." The owner merged anyway.
4. **The record follows the template, and the omission isn't new.** The record template asks only for the version, the commit, the SHA-256, and the C compiler, Node and zlib lines (development.md step 12, :292, and part 3 step 6). #325 carries all of them. Item 9 "by hand on it" has been in the procedure since 2026-10-06 (`4279db80`, :244), and the 1.4.0, 1.4.1 and 1.5.0 records (#295, #297, #307) name neither item 9 nor `status`. 1.5.0's note even opens "Done that way" after a plan line that names `status` (roadmap.md:89), and it had no `status` run either. A later record that drops item 9 would follow that template. It wouldn't come from copying this one.
5. **Nothing for the 1.7.0 gate.** Neither `seedelf-data/` nor `extension/src/tokens/list.json` changed in `babb8e76..6bca8bec`, so 1.7.0 may not need a deploy at all.

What's left is a two-word lead-in that vouches by implication for one step that wasn't run (and that adds nothing after a deploy) and for one whose outcome isn't written down. That makes it wording on a past record: a nit.

## The fix

- **The roadmap.md:63 clause can't be applied as written.** "<outcome>" is the owner's to give, and a fixer must not leave a placeholder in the doc. The owner's chat report (a pool started and a swap on mainnet) is a mainnet smoke test, not item 9's bullets, so it mustn't be labelled "item 9". Rule 7 also applies: don't copy "submitted for publishing", and don't date anything.
- **A truthful change that needs no owner input:** "**Done that way, bar `status`** (the deploy's own `DEPLOYED 942e3bbc… (3b03a0e9… kept as .prev)` shows what it would); checklist item 9 was the owner's, by hand." Add the owner's own words only if the owner wants them there.
- **The `status` half is an owner's call, and it's broader than #325.** Practice and the docs have diverged at every release since the workflow's first day. One option is to drop "then a `status` run" from development.md:205 and :280. development.md:216 ("`status`'s `.prev` is what a `rollback` would put back") and the runbook's :146 ("after its `status` run") would then need to point at the `DEPLOYED` line instead; the runbook's *What `.prev` holds* already explains that equivalence. The other option is to keep `status` and have the record carry its output.
- **If the owner wants item 9's outcome on record,** the place for it is the template (development.md step 12, :292, and part 3 step 6), not this note. That is an owner's call too.
- **Side effects: none.** It's docs only. No test reads roadmap.md or development.md: `words.test.ts` scans `extension/src` only. No privacy note, UI text or guard is touched.

## Evidence

- roadmap.md:62-63 on HEAD (above). `git diff a5fc6576^1 a5fc6576` is the one added line.
- `gh run view 37999933789`: `build skipped`; `vps` steps "…, status, Forget the key". `gh run view 40440233291`: `build` and `vps` "deploy".
- Job 121978929173's log: `2026-10-27T02:46:52.5811413Z DEPLOYED 942e3bbc21a18eb22d31e6efd7a6dc03ee0dea90ab63bd6ec4bb38e30fb1852f (3b03a0e98ac700db2911898f62929371c6c0f475646a3d99f0193c54aedcfa1c kept as .prev)`.
- Job 122906664832 (2026-10-28): `already running 942e3bbc…: nothing to do`.
- `git blame`: development.md:244 is `4279db80` (2026-10-06), :288 is `a01deb23` (2026-10-12), :205 and :280 are `fc8561c7` (2026-10-25), and the runbook's :146 is `3ea05dc1` (2026-10-25).
- Transcripts: 09bbfc44 messages 187, 204 and 259; 6b05df79 message 5 (2026-10-27T16:42:44Z).

No scratch files were made.
