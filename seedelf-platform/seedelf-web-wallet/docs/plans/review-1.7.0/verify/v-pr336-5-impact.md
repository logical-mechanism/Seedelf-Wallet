# v-pr336-5-impact: `pr336#5`, impact and the fix

**Verdict: confirmed. Severity: low, as filed.**

Every quoted line is stale on HEAD (`6bca8bec`), and the code and its own tests do the opposite of what they say. The harm is a misleading design doc and source comments. No user, site or attacker sees any of it, and the privacy policy and privacy.md are right. So it's low, not medium: the brief's scale puts "a misleading doc" at low, and 1.6.0's review rated the same kind of finding low (docs-small#1, the one whose fix wrote this text).

The proposed fix is right, and needs six corrections (below).

## Is it real on HEAD?

**The stale text:**
- `docs/architecture.md:732` says, of the data layer's list: "that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below). Whether a pool is on chain at all is the ledger's to judge, not the server's: … Koios's look works those out itself, from the launch's own transaction (`tx_info`) and … (`account_update_history`)."
- `lovejoin-pools.ts:34`: "so the ledger is the judge of that".
- `:436`: "That the pool is on chain at all, the ledger checks".
- `:400-402`: "every pool it shows, verified here again, kept".

**What the code does:**
- `refresh()` ends `await this.keep(network, await this.confirmed(network, found))` (`:454`).
- `confirmed()` (`:565-584`) runs `launched()` on every listed pool the device doesn't hold yet. It goes through `koiosAlone()`, and `launched()` asks:
  - `tx_info` (`koios.launches`, `:527`);
  - `account_update_history` (`koios.firstRegistrations`, `:551`) for an L its launch didn't register.
- So for a new pool, "on chain" and L's half of "finished" are now Koios's word. Its launch position, and the rows themselves, are still the server's: `confirmed()` returns the server's `found` entries (`:583`), which is F1, `pr336#0`, confirmed by its trace.

**Not deferred on purpose.** Each 1.7.0 code PR updated architecture.md for its own change: #330 `0154d55e`, #333 `fe900cea`, #335 `65a45719`, #337 `aa6f5fc2`. #336 didn't, so `git log babb8e76..HEAD -- docs/architecture.md` has no commit of its. The deferral #333's description records ("the 1.7.0 list's tick waits for the release-prep docs commit") covers the roadmap's ticks only.

**The existing tests contradict the doc too:**
- `lovejoin-discovery.test.ts:288-290` and `:357`: Koios is asked `["tx_info"]` for a new listed pool.
- `:365-400`: a listed pool is left out when Koios doesn't know its launch, or L was registered after it.

## Scratch test

`extension/tests/zz-review-v-pr336-5-impact-1.test.ts`, run alone: **3 passed on HEAD**, then deleted. Each case asserts what HEAD does, which the doc says it doesn't.

1. **"Finished" is Koios's, not the server's word.** The data layer lists the fixture pool, and Koios says L was registered 60 s after the launch. The data layer is asked `lovejoin/pools` once, and Koios `["tx_info", "account_update_history"]`. Nothing is kept.
2. **"On chain" is asked of Koios before the pool is kept.** Koios doesn't know the launch. It's asked `["tx_info"]`, the holder is never read, and nothing is kept.
3. **The cost.** The head start is empty, as mainnet's bundled one is today:

   | Step | `tx_info`s |
   |---|---|
   | first list | 1 |
   | again within `REFRESH_MS` (throttled) | 1 |
   | next list, still unconfirmed | 2 |
   | next list, confirmed and kept | 3 |
   | next list | 3 (a kept pool isn't asked again) |
   | after `local.clear()` (Remove wallet) | 4, at once (the throttle's exception) |

## Who it reaches

- **No user or site.** It's a design doc and source comments. The store build minifies with no sourcemap (`vite.config.ts:125-126`), so the comments don't ship.
- **The readers are developers and reviewers.** architecture.md is where 1.6.0's review put the trust model (docs-small#1's suggested fix: "In architecture.md's *Which pools are shown*, say that on mainnet 'finished' and 'earliest' are the server's word"). Next release's reviewer will read it to judge how far the wallet trusts the data layer. Two misreadings follow:
  - **Trust.** They'd believe mainnet takes "finished" and "on chain" on the server's word. That's conservative (the doc says the wallet checks less than it does), so it could only prompt a duplicate finding or a check added twice.
  - **Koios.** They'd believe mainnet discovery asks Koios nothing while the data layer is up. That under-reports a request on the shared public tier (rule 8). privacy.md:200 and the policy (`:46`, `:93`) do name the request, so nothing reaches users.
- So it's low. Not medium: nothing behaves wrongly, and no money or privacy statement a user reads is wrong.

## The fix: right, with corrections

The fix itself is right and minimal: docs and comments only. It adds no guard and no refusal, and changes no UI text, key or privacy note.

1. **Write it after F1's call** (`pr336#0`). "Its row and position stay the server's" is true only while F1 is open.
   - If F1 is fixed with Koios's row and place, the sentence says Koios's instead.
   - The cost then gains `utxo_info`, 60 a request.
2. **Say exactly what stays the server's.** "Finished" means two things at `:732`, and only one moved to Koios:
   - L's registration is now Koios's.
   - The scripts' places at the holder are still the server's. `tx_info` is asked with no outputs.
   - "Row" should say the reference datum (box ADA, token, max fee) and the scripts' places.
3. **Keep the ledger sentence; don't replace it.**
   - A pool the device already held is never asked again (`:568`), including one a 1.6.0 device took on the server's word.
   - Nothing asks again after a deep rollback.
   - So the ledger stays the last judge: `deposit_across` reads the reference UTxO.
   - "Koios's look works those out itself" becomes "both paths, through `launched`".
4. **The cost's wording** (the numbers hold: `TXS_PER_REQUEST = 20`, `koios.ts:448`, launch transactions deduplicated at `:527`; `CREDENTIALS_PER_REQUEST = 75`, `:442`). "Once per pool per device" is too strong:
   - It's mainnet only. `privateIndexClient` gives nothing on preprod, with Koios-only on or with the private part down (`private-index.ts:368`).
   - It's asked again at each list while unconfirmed: at most every 5 minutes, and at a restarted worker's first pool read.
   - Remove wallet deletes the record, so a restore asks again about every listed pool (case 3). So does a fresh install, for every pool the head start doesn't hold. Say "every pool the head start doesn't hold", not "none", since the head start is rewritten at each release.
   - Describe the intended behaviour. F3's per-read repeats while a slow check runs are a separate bug.
5. **Where the cost goes.** `:737` lists none of discovery's requests, the holder look's included. `:732` already names them. Either:
   - put the check's cost in `:732`'s discovery sentence (minimal);
   - or give `:737` one sentence for both paths.
6. **The comments.** Change `:34` and `:436` ("the ledger", alone) and `:400-402` ("kept"). `confirmed()`'s own comment (`:556-563`) is right and can be the model. data-layer.ts:287 is still true and can stay.

**Suggested text for `:732`, with F1 open:**

> A pool new to the device is then kept only once Koios confirms it, through the holder look's own check (`confirmed`, `launched`): its launch's transaction (`tx_info`: on chain, and spending the seed) and, for a launch that didn't register L, L's earlier registration (`account_update_history`). Neither is the server's word (1.6.0's release review, pool-exists, docs-small#1; 1.7.0). Its rows (the reference datum, the scripts' places) and where its launch sits, which the earliest is worked out from, are still the server's (below). A pool already held is never asked again, and nothing asks after a deep rollback, so the ledger stays the last judge: every deposit into a token pool reads its reference UTxO (core's `deposit_across`) …

**Its cost:**

> On mainnet only: one `tx_info` per 20 new pools and one `account_update_history` per 75 L's their launches didn't register. Once a pool, again at each list while Koios can't confirm it, and for every listed pool the head start doesn't hold after a fresh install or Remove wallet.

**What else it changes:**
- **Nothing at runtime.** The comments are stripped from the store build. No test reads architecture.md or a comment: `words.test.ts` reads string literals and JSX only, and the i18n tests read `docs/i18n` only.
- **Do it in the same docs commit as F8** (`pr336#7`). The roadmap's `:379-380` describe `utxo_info` and `account_info`, which the wallet never sends, so the two docs should agree.
- **F7** (`pr336#6`, the policy's summary) is separate.

## Cleanup

`extension/tests/zz-review-v-pr336-5-impact-1.test.ts` is deleted. No tracked file was edited.
