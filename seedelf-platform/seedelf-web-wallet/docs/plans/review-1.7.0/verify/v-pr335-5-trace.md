# v-pr335-5-trace: verifying pr335#5

**Finding:** during Send, and after a part fails, every part of a payment in parts reads "That transaction isn't one the wallet is holding. Review it again."

**Verdict: confirmed.** Severity **nit**, as filed. The window grows with the number of parts, up to 24 later parts' giveme.my and Koios round trips for a 25-part Max. That is the only argument for calling it low. Confidence: high. A scratch test reproduced it on HEAD.

## The trace on HEAD (6bca8bec)

1. **The review keeps the chip live while Send is busy.**
   - `Withdraw.tsx:210`: the Send button is `disabled={busy}`.
   - `:201`: Back is `backDisabled={busy}`.
   - `:223`: `<TxDetailButton txHash={summary.txHash} parts={summary.parts} testId="withdraw-tx" />` has nothing tied to `busy`.
   - `TxDetail.tsx:72`: the chip is a plain `<button type="button" className="chip" onClick=…>`. TxDetailButton has no `disabled` prop at all; the only `disabled` attributes in the file are the stepper's (`:152`, `:165`).
   - The other four reviews in parts pass `parts` the same way, with no busy state: `Transfer.tsx:236`, `Swaps.tsx:935`, `Lovejoin.tsx:3075`, `DappApprovals.tsx:772`.
2. **The first part's record goes when the watch takes it.**
   - `sendParts` (`parts.ts`) sends each part through `send(…, partKey(key, i), …)`, which calls `submitWatched`.
   - `submitWatched` (`pending.ts:522-525`) runs `await take(deps, watched, async () => { await rememberSpent(session, s.network, bytes); await session.remove(s.key); })`.
   - `take` runs `alongside` unconditionally (`pending.ts:379`), so `seedelf.withdraw.built`, the only record carrying `partHashes`, is removed once part 1's submit is answered.
3. **The view reaches a later part only through that record.**
   - `tx-view.ts:153-161` reads `session.get(key)` for each chain key and each `BUILT_KEYS` entry, then `partOf(record, wanted)`.
   - With the record gone, `partHashes` is undefined, `partOf` returns -1, and `<key>.<i>` is never read.
   - `cborOf` can't find a later part in the first's record either, because it holds only their hashes.
   - The view never reads `seedelf.waitingPart.<hash>` (`parts.ts:216`, `:353-354`), nor the pending watch.
   - With `inChain` false (`lovejoin.ts:6047` covers only Lovejoin chains), the view throws `NOT_HELD()` (`tx-view.ts:179`), whose text is en.json `worker.txView.notHeld`.
4. **A session's funding in parts is the same.** `sessions.ts` `sendFunding` sends through `send(…, partKey(key, i), …)` too, so a swap's, Lovejoin's and a site's fundings behave alike.

## Scratch test

`extension/tests/zz-review-v-pr335-5-trace-1.test.ts` (deleted).

**Setup:**
- 61 private UTxOs of 25 ₳, and a Make public of 1,100 ₳ to the phrase's own address.
- That builds 3 parts, none waiting.
- `txView` was asked for every part, with the handler's `inChain`, at each giveme.my request and each Koios submit.

| When | Part 1 | Part 2 | Part 3 | `<key>`, `<key>.1`, `<key>.2` |
|---|---|---|---|---|
| review, before Send | served | served | served | 1, 2, 3 |
| giveme.my for part 1 | served | served | served | 1, 2, 3 |
| Koios submit of part 1 | served | served | served | 1, 2, 3 |
| giveme.my for part 2 | NOT_HELD | NOT_HELD | NOT_HELD | –, 2, 3 |
| Koios submit of part 2 | NOT_HELD | NOT_HELD | NOT_HELD | –, 2, 3 |
| giveme.my / submit of part 3 | NOT_HELD | NOT_HELD | NOT_HELD | –, –, 3 |
| after Send returned | NOT_HELD | NOT_HELD | NOT_HELD | –, –, – |

**Results:**
- The assertion that the view serves the parts it still holds at "giveme.my for part 2" failed on HEAD: `expected [ 'NOT_HELD', 'NOT_HELD' ] to deeply equal [ 'served', 'served' ]`.
- The second case passed. With part 2's submit refused, Send threw "1 of 3 transactions went. The rest didn't: The network rejected the transaction: Transaction Fails Validation Review what's left again."
- After that failure, all three parts read NOT_HELD, while parts 2 and 3 were still kept under `seedelf.withdraw.built.1` and `.2`.

## Where it's narrower or more exact than filed

- **When the window opens.** It opens at part 1's take, not at Send. Through part 1's own giveme.my and submit, every part is served.
- **The words after a partial failure.** The first half, "isn't one the wallet is holding", is literally untrue there for the parts that didn't go: they're still in session storage. The advice is still right. It matches `worker.parts.partly`'s "Review what's left again", and Send pressed again finds no first record, so it can't send them.
- **holdWaiting.** The claim is true, but for parts that wait, Send returns right after `holdWaiting`, and Home's `sent()` replaces the review (`Home.tsx:552-559`). No screen offers the view then. PendingBanner has no TxDetailButton.
- **Before the PR.** Part 1 read the same: ae610284's lookup was `cborOf(await session.get<unknown>(key), …)` alone. Later parts were never viewable then. This is a gap in #335's new coverage, not a regression.

## Fix advice

**None for the release.**

**If it's wanted later, the UI route** removes the only misleading state, the one during Send:
- TxDetailButton needs a `disabled` prop, which doesn't exist yet.
- Each of the five reviews in parts passes it its `busy`.
- This also hides part 1's working view during its own send, which costs nothing.

**The worker route is the fuller one:**
- Find a part without its first's record: the stepper passes the part's index, and the view reads `partKey(key, i)` for each built key. `cborOf`'s hash check means a wrong index can't serve another transaction.
- Serve a part that already went from `seedelf.sent.<network>`, which `sent-txs.ts` keeps whole for 2 h (the newest 16), with words that say it went rather than "Review it again".
