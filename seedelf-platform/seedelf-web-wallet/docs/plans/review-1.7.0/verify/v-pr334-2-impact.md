# v-pr334-2-impact: pr334#2, the 1.7.0 list shows items 4–7 as not done

**Verdict: partly. Severity: nit** (the finding says low). Confidence: high on the facts, high on the impact.

## What holds

- **The list on HEAD** (`docs/post-release-roadmap.md`):
  - :38: item 4 is still 🚧, with only "✅ The overflow half".
  - :39–41: items 5, 6 and 7 are ⬜.
  - :40 still reads "The owner's calls first: after how long it's offered, and its words."
- **Kept in mind:** the entries at :373, :374, :378, :379 and :380 are unticked.
- **Which PRs touched the file.** `git log babb8e76..6bca8bec` on the file shows a7abf961 (#326), 1cd8b06b (#329), 0154d55e (#330), c5d19d3f (#331), 8e878e9c (#332), c8e25c1d (#334) and 62be5bc4 (#338). No commit is from #333, #335, #336 or #337.
- **:379–380 name the plan's requests,** not the ones built:
  - The plan: "one `utxo_info` per newly listed pool" and "One batched `account_info`".
  - What #336 built (`launched()` and `confirmed()`, `lovejoin-pools.ts:516-584`):
    - A `tx_info` for the launches, batched 20 to a request (`koios.launches`, `koios.ts:926-944`, `TXS_PER_REQUEST = 20` at :448).
    - An `account_update_history` only for an L its launch didn't register, batched 75 to a request (`firstRegistrations`, :954-965, `CREDENTIALS_PER_REQUEST = 75` at :442; `lovejoin-pools.ts:550`).
    - Both go to `koiosAlone()` (:570), and only for pools the device doesn't hold yet (:565-583).
- **Item 6's calls were made:**
  - `TAIL_OFFER_MS = 60 * 60_000` (`lovejoin.ts:335`). #337 calls it "your hour".
  - The button is `lj.tail.wayOut`, "Bring the rest back now" (`en.json:921`).

## Why the impact is smaller than the finding says

1. **No user, site or attacker can reach it.**
   - The roadmap isn't in the store zip: `package.mjs:116` zips `dist/` alone.
   - No test or CI step reads it. `words.test.ts:12` scans `../src` only, `activity.test.ts` names the file only in two comments, and `web-wallet.yml` has no step that reads docs.
2. **The deferral is the owner's own process, not an omission.**
   - The owner's memory: "Item PRs don't tick the list (adjacent lines conflicted across #330–#332, owner hit it 2026-10-28): ticks go in one docs commit at release prep."
   - #333's description: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."
   - #338 ticked item 8 because it was item 8's own docs record. The owner's note on this run says the same: a pure docs PR that updated item 8's text.
   - So whoever reads the list at the gate (the owner, or a session with that memory) isn't misled about what's built.
3. **The Koios-cost half is overstated.**
   - #336 states its real requests where a feature states its cost:
     - `privacy.md:200`: "`tx_info`, so it's on chain and makes that pool … L's registration (`account_update_history`) … only as each is new".
     - The privacy policy: its pools paragraph (`privacy-policy.md:46`) and its dated entry (:93).
   - :379–380 are the 1.6.0 review's recommendations before anything was built, in a list the file calls candidates.
   - The house style for a finished entry (:387–388) strikes the old text, which takes `utxo_info` and `account_info` out of the live text.
   - So the scenario needs a release-prep commit that adds ✅ and ignores that style.
4. **It's a duplicate.** pr326, pr329, pr335, pr336, pr337, pr338, x-docs and x-merge all flag the same lines. It's one item for the release-prep commit, not nine.

What's left is a checklist for a commit that's already planned. Two parts of it need more than a tick: item 6's text and the requests at :379–380. That makes it a nit.

## The fix

The fix is right in substance. Refinements:

- **One commit.** Make it the release-prep docs commit, as the owner decided, and put every other roadmap edit from this review in the same commit: pr334's and pr338's on :405–409, and x-docs' point on item 5. The deferral exists because adjacent lines conflicted.
- **Item 4 (:38).** Tick the whole item.
  - The Bootstrap half is core's `bootstrap_back_reserve(params)`. `BOOTSTRAP_BACK_RESERVE` (1.5 ₳) is still there as its floor (`seedelf-core/src/lovejoin/mod.rs:1733`, `:1744-1750`).
  - Neither the item nor :378 should say the constant is gone.
- **Item 6 (:40).** Replace "The owner's calls first…" with what was built: *Bring the rest back now*, offered an hour after the collateral mix's deposit (`TAIL_OFFER_MS`, the owner's hour). The hour is the owner's call. The PR drafted the words and the owner merged them, so don't credit the owner with the wording.
- **:373, :374 and :378.** Make each a "✅ **1.7.0:** …" entry with the old text struck, as :387–388 are.
- **:379–380.** One entry is fine, since `launched()` does both checks.
  - The proposed "tx_info per new launch" overstates the count: one request covers up to 20 launches.
  - Suggested text: "✅ **1.7.0:** a pool on the data layer's list that the device doesn't hold yet is kept only once Koios, never the data layer, confirms it as the holder's look does (`launched()`, `confirmed()` in `lovejoin-pools.ts`): one `tx_info` for the new pools' launches, 20 a request, and `account_update_history` only for an L its launch didn't register. A pool Koios can't confirm yet waits for the next list."
  - Add x-docs' point: a pool is checked once, when the device first sees it, and a pool already kept isn't asked again. So a launch rolled back after its check stays kept, and a deposit into it is still refused at submit as a spent UTxO.
  - Keep that leftover as live text. Don't strike it with the rest of the old :379, which would mark it closed.
- **Optional (my idea, the owner's call).** Add one clause to *How this file works* or to :33: item PRs don't tick the list, and the release-prep docs commit does. Then the next list's review won't raise this again.
- **Side effects: none.**
  - It's docs only, and no test, CI step or zip reads the file.
  - A tick changes no heading, so no anchor breaks.
  - Struck text stays visible, so no note is lost.
  - Nothing dates a release. "(the owner, 2026-10-28)" dates a decision, which is the house style.

## Evidence

- `git log --oneline babb8e76..6bca8bec -- seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md` gives the seven commits above.
- Per-merge `git diff --stat <m>^1 <m> -- docs`:
  - #333 touched architecture.md and flows.md.
  - #335 touched architecture.md, flows.md and the provenance files.
  - #336 touched privacy.md and privacy-policy.md.
  - #337 touched architecture.md, flows.md and the i18n files.
- `gh api repos/logical-mechanism/Seedelf-Wallet/pulls/{333,335,336,337}`: only #333 says anything about the list.
- The owner's memory, `versioning-lines.md`: the "Item PRs don't tick the list" line quoted above.
- Code: `lovejoin-pools.ts:520`, `:522`, `:550`, `:565`, `:570`, `:583`; `koios.ts:442`, `:448`, `:926-965`; `lovejoin.ts:335`; `en.json:921`; `seedelf-core/src/lovejoin/mod.rs:1733-1750`.

No scratch files were made. Docs only, so there was nothing to run.
