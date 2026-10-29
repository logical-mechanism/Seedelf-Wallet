# v-x-merge-4-impact: x-merge#4, the 1.7.0 list and *Kept in mind* stale after #333, #335, #336 and #337

**Verdict: confirmed. Severity: low.** It's a misleading planning doc, and fixing it in the release-prep docs commit was agreed. No user, site or attacker can reach it through the shipped build, and it doesn't block the release. Confidence: high.

## Can it happen in practice?

**Not through the shipped build.**
- The roadmap isn't in the store zip. `package.mjs` builds `dist/` from `extension/src`, and nothing there reads `docs/`.
- The only repo doc the UI links to is the privacy policy (`Settings.tsx:83`), and #336 updated it correctly.

**Who does read it:** the owner, the next session (the release-prep author), and anyone on GitHub, since the repo is public. On HEAD (`6bca8bec`):
- **The list:** item 4 is still 🚧, and items 5, 6 and 7 are ⬜. They're at `:38`–`:41`, not the evidence's `:42`–`:45` (the `:41` anchor is item 7).
- **Kept in mind:** the entries at `:373`, `:374`, `:378`, `:379` and `:380` describe five gaps the code has closed, in the present tense:
  - "a review opens only the first part's";
  - "`BOOTSTRAP_BACK_RESERVE` is a fixed 1.5 ₳";
  - "the wallet takes its word that L is registered";
  - "Without it a lying server … can show a pool that isn't on chain, kept for good".
- **Item 6** still says "The owner's calls first", though #337's body records both calls ("`TAIL_OFFER_MS`, your hour", and the line's words).

**The deferral was agreed.** #333's body says: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."
- #333, #335, #336 and #337 left the roadmap alone (`git diff --stat <merge>^1 <merge>` is empty for each). They were built in parallel and merged between 17:14 and 18:30Z.
- #330, #331, #332 and #338 ticked their own items in the same PR.
- No commit on any branch after `6bca8bec` touches the roadmap, so the release-prep commit hasn't been written yet.
- `development.md`'s release path (§1, and *Releasing to the Web Store* steps 1 to 12) has no step for this list's ticks, so the reminder is worth having.
- The owner's note that #338 is docs only and changed item 8's text fits this. Its diff touches `:42` and the Musashi entry (`:405`–`:409`), and nothing in items 4 to 7.

**The one real trap is `:379` and `:380`.** A mechanical tick, a ✅ put in front with the text kept, would claim `utxo_info` and a batched `account_info`. The code asks for neither. `confirmed()` → `launched()` (`lovejoin-pools.ts:522-584`), on `koiosAlone()` and only for pools new to the device, asks:
- `tx_info` (`koios.launches`, `koios.ts:926-947`, 20 a request, `TXS_PER_REQUEST`);
- then `account_update_history` (`firstRegistrations`, `:954-965`, 75 a request), only for an L its launch didn't register.

`privacy.md:200` names both, and the policy (`:46`, and the *Changes* entry at `:93`) describes them in words. So no privacy statement a user reads is wrong today. Only the roadmap would be, and so would the 1.7.0 handoff note if the wording were copied into it. Handoff notes do describe requests: 1.5.0's (`roadmap.md:74`) says what its Settings light asks.

## Severity

**Low**, by the brief's scale: "a misleading doc".
- **Not medium:** no money or privacy statement a user reads is wrong, since privacy.md and the policy match the code.
- **Not a nit:** the deferred ticks alone would be trivia. But the present-tense claims about the wallet's behaviour, on a public `main`, are more than wording, and so are the wrong names of Koios requests.

## The fix

The fix is right and minimal. It's docs only, in the release-prep docs commit as agreed, and within the owner's rules: no guard, nothing new phones home, no date and no store status.

**It can't break anything:**
- `words.test.ts` scans only `extension/src`.
- No test reads the roadmap's text (`activity.test.ts` cites it only in comments).
- The *Kept in mind* bullets carry no anchors.

**Refinements:**
1. **Lines:** items 4 to 7 are at `:38`–`:41`.
2. **Item 2 stays 🚧.** `main`'s required checks are still empty: `gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection/required_status_checks` gives `"contexts":[]`, `"checks":[]`. Tick it only once the owner requires *Web Wallet required*.
3. **Item 4:** one ✅ for both halves. The "✅ The overflow half: …" clause folds into it.
4. **Item 6:** replace "The owner's calls first: …" with the calls as #337 made them: offered an hour after the mix's deposit (`TAIL_OFFER_MS`), with the line `lj.tail.privacy.wayOut`.
5. ***Kept in mind*:** use #330's and #332's form: `- ✅ **1.7.0:** <what was built>`, with the planned text kept but struck through.
   - **`:378`:** names `bootstrap_back_reserve(params)`, with 1.5 ₳ (`BOOTSTRAP_BACK_RESERVE`) as its floor (`seedelf-core/src/lovejoin/mod.rs:1733-1750`).
   - **`:379` and `:380`** can share one line, since one method does both. Name:
     - `tx_info`: the launch is on chain and spends the pool's seed;
     - `account_update_history`: only where the launch didn't register L;
     - asked of Koios alone, never the data layer, and only for pools new to the device. A pool Koios can't confirm yet, or a Koios that's down, waits for the next list.

     The planned `utxo_info` and `account_info` wording then survives only as struck-through history.
6. **No release date and no store state** (rule 7). The existing "✅ **1.7.0:**" form is fine.
7. **The last bullet is right but narrow.** Whatever this review leaves unfixed should go into *Kept in mind* in the same commit, in a group of its own ("Left by 1.7.0's release review"). That's how 1.6.0's review carried its own, in round 3c (`677715db`).
   - Finding 2's gap is a fair candidate. 1.6.0's `fixes/fx-cut-2.md:157` (in `7e2d89ed`) says "runAll swallows a trap on the alarm's path", and the roadmap never carried it: it has no `runAll`, `settleReturns` or `watchFunding`.
   - Whether finding 2 gets fixed is decided by its own verification, not here.
8. **The same docs pass can carry `architecture.md:732`.** It still calls a listed pool's being finished "the server's word". pr329#5, x-docs#4, pr336 and x-priv already report it, so it isn't part of this finding.

## Checked

- **The roadmap:** `sed -n '33,42p;331,400p' docs/post-release-roadmap.md` on HEAD. `git show 11e249d2:…` gives the same line numbers, since #338 replaced lines one for one.
- **Who touched the roadmap:** `git diff` of each merge's roadmap change. #330, #331 and #332 ticked their items, #338 only item 8, and #333, #335, #336 and #337 nothing. `git log --all 6bca8bec.. -- <roadmap>` is empty.
- **The PR bodies:** `gh pr view` for #333, #335, #336, #337 and #338.
- **The code:** `lovejoin-pools.ts:515-584`, `koios.ts:442`, `:448`, `:926-965`; `TAIL_OFFER_MS` and `TAIL_KEEP_MS` in `lovejoin.ts:327-335`; `mod.rs:1733-1750`.
- **The privacy docs:** `privacy.md:200`; `store/privacy-policy.md:46` and `:93`.
- **The required check:** a read-only `gh api` GET of `main`'s required status checks, which are empty.
- **Reach:** a grep shows nothing in `extension/src` or `scripts/` reads or links the roadmap. The UI links only `privacy-policy.md`.

No scratch files were written, and nothing tracked was edited.
