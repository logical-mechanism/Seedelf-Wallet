# v-x-merge-4-trace: x-merge#4, the 1.7.0 list and *Kept in mind* stale after #333, #335, #336 and #337

**Verdict: confirmed. Severity: low** (a misleading doc on HEAD, by agreement a release-prep checklist item, not a code defect). Confidence: high.

I tried to refute it on HEAD (`6bca8bec`) and couldn't. Every claim holds. Two nuances:

- **The line numbers are off for the list.** Items 4 to 7 are at `:38` to `:41` on HEAD, not `:41-45` or `:42-45`. The *Kept in mind* lines (`:373`, `:374`, `:378`, `:379`, `:380`) are right.
- **The deferral was agreed.** #333's body says: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit." So this is that commit's checklist, as the finding itself says. No PR got it wrong.

## The claims, traced on HEAD

**1. The 1.7.0 list (`docs/post-release-roadmap.md`).**
- `:38`: `4. 🚧 **Two in core and WebAssembly:** …`. Only the overflow half is ticked ("✅ The overflow half: …"), but #333 (`b2c3940f`) built the other half.
- `:39`: `5. ⬜ **A listed pool confirmed on chain, and L's registration checked on the data layer's path**`. #336 (`473b7f1a`) built it.
- `:40`: `6. ⬜ **An "unmixed, now" way out** … The owner's calls first: after how long it's offered, and its words.` #337 (`11e249d2`) built it. Its body records both of the owner's calls: `TAIL_OFFER_MS` ("your hour") and the line's words.
- `:41`: `7. ⬜ **Transaction details for every part**`. #335 (`0bad0d52`) built it, and its body says "the design you picked".

**2. *Kept in mind* is still written as open.**
- `:373` (way out), `:374` (details for every part), `:378` (Bootstrap reserve), `:379` (pool-exists) and `:380` (docs-small#1) carry no ✅ and no strikethrough.
- #330's and #332's own entries do (`:387`, `:388`: `- ✅ **1.7.0:** … ~~old text~~`).
- `:378` also says "`BOOTSTRAP_BACK_RESERVE` is a fixed 1.5 ₳". On HEAD that constant is only the floor of `bootstrap_back_reserve(params)` (`seedelf-core/src/lovejoin/mod.rs:1733-1750`: `Ok((need.div_ceil(100_000) * 100_000).max(BOOTSTRAP_BACK_RESERVE))`).

**3. `:379` and `:380` name requests that weren't built.**
- `:379`: "one `utxo_info` per newly listed pool".
- `:380`: "One batched `account_info` as a pool is first handed over".
- What was built: `confirmed()` (`lovejoin-pools.ts:565-584`) runs for pools new to the device. It calls `launched()` (`:522-554`) on `koios(network).koiosAlone()`. That asks:
  - `koios.launches` → `tx_info` (`koios.ts:926-947`), `TXS_PER_REQUEST = 20` (`koios.ts:448`);
  - then `koios.firstRegistrations` → `account_update_history` with `action_type=eq.registration` (`koios.ts:954-965`, 75 a request), only for an L whose launch's certificates didn't register it (`lovejoin-pools.ts:550-551`).
- Nothing on this path asks `utxo_info` or `account_info`.

**4. privacy.md and the policy say it right.**
- `privacy.md:200`: "the transaction that started it (`tx_info`, …) and, where that didn't register L, L's registration (`account_update_history`)".
- `store/privacy-policy.md`: the 28 October 2026 *Changes* entry, and the pools paragraph ("asking for the transaction that started it and, where that didn't register the pool's script, when it was registered").

**5. The PRs and the ticks.**
- #330, #331, #332 and #338 edited the roadmap. #333, #335, #336 and #337 didn't (`git diff --stat <merge>^1 <merge>`).
- #338, as the owner said, is docs only: its diff touches item 8 (`:42`) and the Musashi entry (`:405-409`), nothing in items 4 to 7.
- No branch, local or remote, holds a roadmap commit that isn't on HEAD. So the release-prep commit doesn't exist yet.
- No other doc records items 4 to 7 as done. `docs/roadmap.md` has no 1.7.0 record yet, as expected.

## The scratch test

`extension/tests/zz-review-v-x-merge-4-trace-1.test.ts`, run alone, then deleted. Each "doc" case asserts what the roadmap would say if it were current.

```
❯ tests/zz-review-v-x-merge-4-trace-1.test.ts (6 tests | 4 failed)
  × doc: ticks 1.7.0's items 4 to 7
      expected [ '🚧', '⬜', '⬜', '⬜' ] to deeply equal [ '✅', '✅', '✅', '✅' ]   (:38-:41)
  × doc: marks the five Kept in mind (1.7.0) entries done, as #330 and #332 did theirs
      expected [ false, false, false, false, false ] …                         (:373 :374 :378 :379 :380)
  ✓ sanity: the matcher reads #330's and #332's own entries as done           (:387 :388)
  × doc: one utxo_info per newly listed pool, as :379 says
      expected [ 'tx_info' ] to include 'utxo_info'
  × doc: one batched account_info for L, as :380 says
      expected [ 'tx_info', 'account_update_history' ] to include 'account_info'
  ✓ built: tx_info, then account_update_history only where the launch didn't register L
```

The last case drives the real data layer path (`PoolDiscovery.refresh`, fake index, real WebAssembly), set up as `lovejoin-discovery.test.ts` does. A new pool whose launch registers L asks Koios `["tx_info"]`. One whose L an earlier block registered asks `["tx_info", "account_update_history"]`. Both are kept, and the server sees only `lovejoin/pools`.

## Scenario

The scenario holds, mildly.
- The owner knows the four items are done: they made #335's and #337's calls.
- Anyone else reading the roadmap at HEAD sees items 5 to 7 as not started and item 4 half done.
- The one trap beyond a pending tick is `:379-380`. A mechanical ✅ added in front of them, without the #330/#332 rewrite and strikethrough, would claim `utxo_info` and `account_info`. That wording could reach the 1.7.0 package record too. Those are privacy-relevant Koios requests, so naming them wrongly matters a little. privacy.md, the design doc, is right.

## Fix advice

The finding's fix is right. Refinements:
- **Lines.** Tick items 4 to 7 at `:38-41`, not `:42-45`. Item 4 becomes ✅ as a whole. Item 6 drops "The owner's calls first…", now settled (an hour after the mix's deposit, `TAIL_OFFER_MS`). Item 2 stays 🚧: requiring the check is the owner's.
- **Form.** Use #330's and #332's form: a `- ✅ **1.7.0:** <what was built>` lead, with the planned text kept but struck through (`~~…~~`). The old `utxo_info`/`account_info` wording then stays only as struck-through history.
- **`:379` and `:380`.** #336 did both through one method, so they can share one ✅ line. Name:
  - `tx_info`, 20 a request: the launch is on chain and spends the pool's seed;
  - `account_update_history`: L's first registration at the launch's block or earlier, asked only where the launch didn't register L itself;
  - both asked of Koios alone (`koiosAlone()`), never the data layer, only for pools new to the device. A pool Koios can't confirm, or a Koios that's down, waits for the next list.
- **`:378`.** Its ✅ should say `bootstrap_back_reserve(params)`, with 1.5 ₳ (`BOOTSTRAP_BACK_RESERVE`) as its floor: 1.8 ₳ at 6,465 lovelace a byte, caps back to 96 and 64.
- **Finding 2's trap gap.** The last bullet (carry it into *Kept in mind* if it isn't fixed) depends on that finding's own verification. This one doesn't decide it.

Scratch files: the one test above, deleted. Nothing tracked was edited.
