# v-pr334-6-trace: verifying pr334#6

**Verdict: partly. Severity: nit. Confidence: high.**

One thing is real, and it's narrower than the finding says. The 1.7.0 header calls the list "what 1.6.0 left". #329 wrote it for items 1 to 7, and item 8, which #334 added later, is a new request rather than a leftover.

The rest doesn't hold:
- Item 8 did land on `main` through its own branch and PR.
- Its *Kept in mind* entry is where the list says it is.
- Its own line is ticked and says it ships nothing, which heads off the scenario.

## The lines, on HEAD (6bca8bec)

All four are in `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md`.

- **:33** (blame `1cd8b06b`, written by #329): "**Then 1.7.0: what 1.6.0 left, in small PRs** (the owner, 2026-10-28). … each item lands on `main` on its own branch and PR, and the version is cut once they're in; … Each item's detail is under [Kept in mind](#kept-in-mind), marked **(1.7.0)**."
- **:42** (blame `62be5bc4`, #338): "8. ✅ **A headless run of Lovejoin through Seedelf on Musashi, the Leios testnet** (the owner, 2026-10-28): numbers only … Nothing in the wallet, nothing that changes mainnet or preprod. Run on its own branch, `web-wallet/leios-musashi`, which stays unmerged to learn from; what it found is under *Kept in mind*."
- **:356** (blame `83880dd6`, 2026-10-04): "**Left by the chunks and the reviews, moved here when [plans/](plans/) was archived (2026-10-04)** … None is a promise; each is a candidate".
- **:405** (blame `62be5bc4`, #338): "- ✅ **A headless run of Lovejoin through Seedelf on Musashi, the Leios testnet (1.7.0)** …"

#334 (`ae610284`) added item 8 unticked, with its *Kept in mind* plan, and didn't touch :33. #338 ticked it and wrote down what the run found. So the header was written before item 8 existed.

## Each claim, traced

1. **"Item 8 isn't something 1.6.0 left": true.**
   - Item 8 is "(the owner, 2026-10-28)", a new request.
   - Items 2 to 7 each go back to something 1.6.0 left: Session 12's call 6, the docs check's finding 1, bootstrap's call 1 and x-release#7, pool-exists and docs-small#1, 323-worker#3, and 321-parts-worker#5.
   - #334 added item 8 under #329's header without changing the header.
2. **"Each item lands on `main` … it is neither": false for item 8.**
   - Item 8's deliverable is "numbers only" (:42), and those numbers are on `main` at :405 to :409.
   - They landed through the item's own branches and PRs: #334 from `web-wallet/1.7.0-leios-item` and #338 from `web-wallet/1.7.0-leios-done`. Each PR touches only this file (`gh pr view`).
   - The unmerged `web-wallet/leios-musashi` holds the run's harness. `git merge-base --is-ancestor` confirms it isn't in HEAD, and :42 says it "stays unmerged".
   - Item 1 also landed partly as a docs PR (#329).
   - "The version is cut once they're in": item 8 is ticked, so it holds nothing up.
3. **"Its Kept in mind entry sits in the group 'Left by the chunks and the reviews'": true of the layout only.**
   - That group is a catch-all. It already holds entries added after its 2026-10-04 header:
     - :358, the data layer's leftovers, moved in at 1.4.1;
     - :372, 1.6.0's release review;
     - :391, chunk 34's sessions;
     - :425, measured 2026-10-16.
   - It also holds ticked entries (:414, :420, :421, :433).
   - :405 is exactly where :33 ("Each item's detail is under Kept in mind, marked (1.7.0)") and :42 point. It sits right after the other (1.7.0) entries (:372 to :389).
   - What it records is left for later: ":406 … The fix is a Pallas update, or patches in core, then a CLI release and a web wallet release, much later".
   - One trivial inconsistency: the Tor spike is the other exploration kept on its own unmerged branch, and it sits at the top of *Kept in mind* (:333), outside this group.
4. **The scenario ("takes item 8 as something the release ships or waits on, until they read its line") can't happen as described.**
   - A reader meets item 8 only through its line.
   - That line is ticked, so nothing waits on it.
   - It says "Nothing in the wallet, nothing that changes mainnet or preprod", so nothing ships.
   - No release step reads this list: `development.md`'s release steps (:268 to :290) never mention it.
   - Leios and Musashi appear nowhere else in the tracked tree (`git grep -i` finds only :42 and :405 to :409).

## Repro

There's no scratch test, because a test can't decide a question of wording. I created no files apart from this report. The trace:
- `git blame` of :33, :42, :356 and :405;
- `git diff` of #334 and #338;
- `gh pr view 334` and `gh pr view 338`, for their head branches and files;
- an `awk` listing of the group's entries with their dates and ticks;
- `git merge-base --is-ancestor` on `origin/web-wallet/leios-musashi`;
- `git grep -i "leios|musashi"`.

## Fix advice

Leave it, as the finding itself allows: :42 already says what item 8 is, in the same list.

If :33 is touched anyway, change the label rather than add a clause about branches, which would only repeat :42. For example: "**Then 1.7.0: what 1.6.0 left, and a Leios run, in small PRs**". Moving :405 up beside the Tor spike would be churn.
