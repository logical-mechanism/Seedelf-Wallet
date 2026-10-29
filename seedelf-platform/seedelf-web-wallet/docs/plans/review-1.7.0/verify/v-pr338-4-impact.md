# v-pr338-4-impact: pr338#4, the 1.7.0 list's ticks wait for release prep, and item 5's *Kept in mind* lines name requests #336 didn't build

**Verdict: partly. Severity: nit** (filed as low). Confidence is high on every fact. Everything was read at HEAD (`6bca8bec`) with read-only git and gh.

The finding is right about what HEAD says and what the code does, and its fix is right in substance. But the harm it describes depends on a future slip in a repo doc. It isn't a defect on HEAD:
- The open marks are the agreed interim state.
- Nothing in the store build reads the roadmap.
- #336's Koios cost is already stated right where rule 8 is served: privacy.md, the policy and the code.

What's left is a checklist item for the release-prep docs commit.

## The facts hold

- **The list on HEAD** (`post-release-roadmap.md`):
  - :38: item 4 is 🚧, with only "✅ The overflow half".
  - :39: "5. ⬜ **A listed pool confirmed on chain, …".
  - :40: "6. ⬜ … The owner's calls first: after how long it's offered, and its words."
  - :41: "7. ⬜ **Transaction details for every part**".
- ***Kept in mind*, still open:**
  - :373, the way out.
  - :374, the details for every part.
  - :378, the Bootstrap reserve.
  - :379: "one `utxo_info` per newly listed pool".
  - :380: "One batched `account_info` as a pool is first handed over would check it".
  - :387–388 show the house pattern for a done entry: "✅ **1.7.0:** …", then the old text struck through.
- **What #336 built:**
  - `confirmed()` (lovejoin-pools.ts:565) calls `launched()` (:516–561).
  - That asks `koios.launches()` (koios.ts:926): `tx_info` with `_certs: true`, 20 a request (`TXS_PER_REQUEST`, koios.ts:448).
  - Only for an L its launch didn't register, it also asks `koios.firstRegistrations()` (koios.ts:954): `account_update_history` with `action_type=eq.registration`, 75 a request (`CREDENTIALS_PER_REQUEST`, :442).
  - There's no `utxo_info` and no `account_info` on this path. The comment at :517–520 says the same.
- **The agreement.** #333's description: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."
  - `git log babb8e76..6bca8bec -- …/post-release-roadmap.md` shows no commit from #333, #335, #336 or #337.
  - #330, #331, #332 and #338 ticked their own items.
- **#338** changed only the roadmap, 6 lines (`git diff --stat 6bca8bec^1 6bca8bec`): item 8's tick and its *Kept in mind* entry. As the owner says, it's a pure docs PR. It didn't cause the open marks; it's only the last PR before the gate.
- **Item 2.** `main` requires no check yet: `gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection/required_status_checks` (a GET) answers `"contexts":[]`, `"checks":[]`. So item 2 stays 🚧, as the fix says.

## Impact: why nit

- **No user, site or attacker can reach it.**
  - The roadmap isn't shipped, and no test reads it: `words.test.ts` scans `src` only, and `i18n.test.ts` reads only `docs/i18n`.
  - The store build behaves the same whatever the list says.
- **On HEAD it's the agreed state, not a defect.**
  - The open marks are what #333 records as agreed.
  - :379–380 are 1.6.0's review recommendation, for an item still marked open. :380 even says "would check it".
  - They're stale against the build, but they don't claim the wallet makes those requests.
- **The scenario needs a future slip.** It holds only if the release-prep commit ticks :379–380 without saying what was built. Two things make that unlikely:
  - The house pattern gives a done entry a new "✅ **1.7.0:**" line in its own words, with the old text struck through (:387–388).
  - The same item is already in pr334 #3, x-docs #1, x-rel F8 and pr336 F8, which rated it nit.
- **Rule 8 is met where it's served.** Three places already state the requests right:
  - privacy.md:200 (changed by #336) names both: "the transaction that started it (`tx_info`, …) and, where that didn't register L, L's registration (`account_update_history`) … only as each is new".
  - The policy's pools paragraph (privacy-policy.md:46) and its 28 October entry (:93) say the same in words.
  - So does the code comment.

  Even a careless tick would leave one stale roadmap line beside those three.
- **Where rule 8 does fall short is architecture.md**, and that's x-docs #4 and pr336 F6, not this finding:
  - :732 still calls a listed pool's finish "the server's word" and its existence "the ledger's to judge".
  - Its *What each costs* line for Lovejoin (:737) has no entry for the check.

On the brief's scale, a misleading doc is low. This doc is right for its agreed state. Only a careless future edit would make it mislead, in a planning file whose design doc is right. So nit. Low is the ceiling, if the owner wants release-prep items tracked at low.

## The fix

It's right, minimal and docs-only. Three corrections:

1. **Keep the house pattern.** "Rewrite :379–380" should mean a new ✅ line saying what was built, with the old text struck through, as :387–388 keep theirs. The struck text still names `utxo_info` and `account_info`. That's fine once it's struck.
2. **State the cost as built.** "one `tx_info` per new launch" isn't quite right, since `launches()` batches them. Suggested line:
   > ✅ **1.7.0:** a pool on the data layer's list that the device hasn't kept is taken only once Koios confirms it, as the holder's look does (`confirmed()`, `launched()`): its launch's `tx_info`, 20 a request, and, where the launch didn't register L, L's `account_update_history`. It's asked again at each list while Koios can't confirm it. Checked once, as first seen: it closes a lying server's list, not a rollback after that. ~~(old :379)~~ ~~(old :380)~~

   **Why the last sentence:** the old :379 text says it closes "a deep rollback". It doesn't do that fully:
   - `confirmed()` asks only about pools not yet kept (`fresh`, :567–568).
   - `keep` never drops a pool.
   - Unlike the holder's 10-minute `SETTLE_MS` (:492), this path waits for nothing.

   x-docs #1 notes the same, at medium confidence.
3. **Item 6's calls.** Only the hour is recorded as the owner's: aa6f5fc2 says "TAIL_OFFER_MS, the owner's hour", and #337 says "your hour". The words (`lj.tail.wayOut`, "Bring the rest back now") were merged by the owner, but nothing records them as the owner's choice. Write "an hour (`TAIL_OFFER_MS`, the owner's), *Bring the rest back now*", without calling the words the owner's call.

**Also:** item 4's tick should name #333's `bootstrap_back_reserve(params)`, not the old constant `BOOTSTRAP_BACK_RESERVE` that :38 names. x-docs #2 covers #333's other stale statements.

**What the fix changes or breaks:** nothing outside the doc.
- No test reads post-release-roadmap.md.
- It adds no guard, UI text, privacy note, release date or store status. "✅ **1.7.0:**" names a version, as :387–388 already do.

## Repro

All read-only; no scratch test was needed and none was written.
- **The roadmap:** `sed -n` of :38–41, :373–380 and :387–388.
- **The code:**
  - lovejoin-pools.ts: :404–454 (`refresh`), :483–513 (`holder`, its `settled` at :492), :516–561 (`launched`) and :565–582 (`confirmed`).
  - koios.ts: :442, :448 and :926–962.
  - `en.json`: :921–922.
- **The docs:** privacy.md:200; privacy-policy.md:46 and :93; architecture.md:732 and :737.
- **Git and gh:**
  - `git diff --stat 6bca8bec^1 6bca8bec`.
  - `git log babb8e76..6bca8bec -- docs/post-release-roadmap.md`.
  - `gh pr view` for 333, 335, 336, 337 and 338.
  - aa6f5fc2's message.
  - The required-checks GET above.
