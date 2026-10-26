# fx-cut's fix, reviewed (lens `last-5`)

Scope: fx-cut's changes in `git diff 22acd30e` (LIVE-1), and the code they read:
- `lovejoin.ts`: `ownTxs`, `tailBoxOut`, `restOnly`, `carriedOf`, `shown(c, carried)`, held()'s `stopped`, `rows(s)`, mixes()' chain view, `ChainRecord.restBack` and `LovejoinService.restBack`;
- `sessions.ts`: sendBack's one call to `restBack`;
- its tests: P1–P5 (`lovejoin-planner.test.ts`) and R1–R4 (`lovejoin-stopped-shown.test.ts`).

The live run's files in the tree (the roadmap, the chunk-34 plan, `e2e/live/`, `live-runs-copy.test.ts`) aren't fx-cut's, and are left out.

**Verdict:** no high or medium. Two lows. In both, the Done reading the fix gives doesn't last, or never comes, and LIVE-1's "a mix stopped partway" shows again:
1. **The later chain's record goes first.** A cut chain is carried by the chain built in its place. It reads Stopped again once that chain's record goes, 3 h after it ended, while its own record is still kept by Settings' 6–24 h delay.
   - Who: mix sessions and site sessions.
   - Where: preprod. It's dormant on mainnet until a 5 ₳ pool is shown.
2. **No answer to the direct return.** Koios takes the return but doesn't answer, or a lock cuts its send off, and it lands. `restBack` is never written, so the chain stays Stopped for the rest of its record. On mainnet, the direct return is the only way such a rest comes back.

The lead's five checks hold otherwise (*Checked, and holding*). One difference is fx-cut's own call 2: a remainder all sent but never landed does make the chain read Done.

**How the findings were tested:**
- Each was made concrete against the real WebAssembly: `zz-review-5-1` on records in the tree, and `-2` and `-3` on P1's and P3's real flows, in a scratch copy of the planner file.
- A fix for each was tried in the copy. All 89 tests in the four files pass.
- The copy and the tests are deleted. Their output is in the scratchpad, in `last5-throwaways.log`.
- Nothing tracked was edited.

## Findings

### 1. low: carried by the chain built in its place, a cut chain reads "Stopped" again once that chain's record goes before its own (Settings' 6–24 h delay)

- **Where:** `extension/src/background/lovejoin.ts:1984`. carriedOf's chain clause needs the later chain's record. sortOut's `keep` (`:5371`, applied at `:5420`) drops a record RECORD_KEEP_MS (3 h) after it ended. A record is kept longer only for its own delay's least (`ownWaitAt`, `:2006`).
- **Concerns:** fx-cut, LIVE-1.
- **Why the two records part ways:**
  - **The cut chain records a delay.** A mix's or a site's return takes `chainDelay = delay ?? Settings'` (`sessions.ts:4494`). Under "6-24", its record is kept until `at` + 6 h.
  - **The chain built in its place records none.** buildBack passes `tailOf: { delay }` (`:4587`, and tailChain's `:4415`) only where `record.auto.lovejoin.delay` is set (`:4383`). Only a swap's approval sets it. sendChain records that, or nothing (`:4948`).
    - A mix session's `auto` has no `lovejoin` (`:2175`).
    - A site's session has no `auto`.
  - **So the later record goes first.** The chain built in its place goes at its end + 3 h. The cut chain goes at the later of its end + 3 h and its `at` + 6 h.
- **Scenario:** a private mix, LIVE-1's own shape, on preprod with Settings' delay at 6–24 h.
  - A lock cuts it after its deposit and mixes. It's unlocked minutes later. Its rest comes back as the chain built in its place, all sent about 10 minutes after the cut chain began.
  - Home, Chains and its card read Done (the fix).
  - From about 3 h 10 min after it began, the first pool read drops the later chain's record. That read is the Lovejoin page's, or the alarm's run.
  - Until 6 h after it began:
    - Home says "a mix stopped partway";
    - Chains says "Stopped after 5 of 8 transactions" and "Why it stopped: The wallet locked, or the browser closed, while its chain was being sent. Mix my boxes again mixes the boxes it didn't.";
    - the card says "Stopped".
  - **The same through tailChain** (P2's path).
  - **Not with the other delays:** with 1–6 h (the default) or 2–12 h, the cut chain's record goes first.
  - **Not a swap's:** both records carry its approved delay, and the later chain's is later.
  - **Not on mainnet:** no 5 ₳ pool is shown there, so the rest comes back directly. That marks the cut chain's own record (`restBack`).
- **Evidence:**
  - `zz-review-5-2`: P1's flow as fx-cut's test runs it (a site's session, a real lock and unlock, the real WebAssembly), with `lovejoinDelay: "6-24"`.
    ```
    records once the rest went [{"id":"0b3eb8","delay":"6-24",…,"stopped":true},{"id":"83d968",…,"done":true,"stopped":false}]
    (Home stopped 0, Chains [] — the fix)
    — busyFor 3 h 1 min, then status() —
    records after a pool read [{"id":"0b3eb8","delay":"6-24",…,"stopped":true}]
    Chains [{"session":0,"sent":5,"total":8,"stopped":"The wallet locked, or the browser closed, while its chain was being sent."}]
    Home stopped 1 card {"total":8,"sent":5,"stopped":"The wallet locked, or the browser closed, while its chain was being sent."}
    AssertionError: expected 1 to be +0
    ```
  - `zz-review-5-1`: the same on records, as R1 builds them. The cut chain is 30 min old with "6-24". The chain in its place ended 15 min ago, with no delay. Before: `{"total":8,"sent":5,"done":true}`. After 3 h and a read: `records after the read ["c8c8"]`, `held.stopped 1`, and the card is stopped.
- **Why low:** it's LIVE-1's symptom, but only with the longest delay, and for up to about 3 h. It's preprod only today, and the pages alone are wrong. It's still the one to fix first: it's cheap, and the fix is tested below.
- **Suggested fix:** no new words, no refusal, and no other rule reads differently. Keep the carried reading on the cut chain's own record before the other record goes. In sortOut's update, just before `s.chains = s.chains.filter(keep)`:
  ```ts
  const carried = carriedOf(s);
  for (const c of s.chains) if (keep(c) && !c.restBack && carried(c)) c.restBack = true;
  ```
  - **No rule changes:** `restBack` is read only by carriedOf and by restBack()'s own predicate.
  - **Records already on a device:** it covers them too. sortOut is the only place that drops a record.
  - **Tried in the copy:** `zz-review-5-1` and `-2` pass. So do the planner file, stopped-shown and the 1.5.0 gate, 89 of 89 (with finding 2's change).
  - **R1 still holds:** held, chains and mixes don't read the pool, so its "nothing written" stays true.
  - **An alternative:** the mark could be written in chainEnded's done branch instead, on each earlier chain of the session that carriedOf then carries. It passes the same tests, but leaves records kept before this build to the gap.
  - **The field's doc:** "A chain built in its place says so by its own record" changes with either fix.

### 2. low: a direct return Koios took but didn't answer, which lands, never marks the cut chain, which stays "Stopped" for its record's life

- **Where:** `extension/src/background/sessions.ts:4816`. `restBack` runs only once `sendRecorded` (`:4808`) has returned.
  - **A submit with no answer:** sendRecorded throws on it (maybe sent, `:5266`), and sendBack throws with it. The causes:
    - Koios's timeout or 5xx (`koios.ts:1175–1193`);
    - the data layer giving no answer (`data-layer.ts:405`, `:418`).
  - **A lock right after the submit:** it does the same, since the update after the submit needs the keys.
  - **What follows:** the return is followed as maybe sent, and its history is written once it's seen on chain (`noteLanded`, `:4844`). Nothing calls `restBack` there.
- **Concerns:** fx-cut, LIVE-1: its direct-return case, which goes beyond the lead's direction.
- **Scenario:**
  - A site's session's chain is cut after its mixes, with Settings' collateral switch off (P3's setup). On mainnet, every such rest comes back this way.
  - Its direct return's submit gets no answer, and the return lands. The session's record has it confirmed.
  - The cut chain has no mark. Home says "a mix stopped partway", and Chains says "Stopped after 5 of 8 transactions…". This lasts until its record goes: 3 h after the stop, or its delay's least.
- **Evidence:** `zz-review-5-3`, P3's flow. Koios takes the return's submit, which then fails with a TimeoutError (maybe-sent.test.ts's `unanswered`). Two runner passes follow:
  ```
  backSubmit threw: KoiosBusyError: The server the wallet reads Cardano through didn't answer in time. Press Refresh to try again.
  the return as the session keeps it {"kind":"back","txHash":"491f326a…","inputs":[…],"confirmed":true}
  records [{"id":"e0783f","stopped":true}]          (no restBack)
  Home stopped 1 Chains ["The wallet locked, or the browser closed, while its chain was being sent."]
  AssertionError: expected 1 to be +0
  ```
- **Why low:** it's an edge case: a lost answer, or a lock in the second a send takes. What it shows is what `22acd30e` showed.
- **Suggested fix:** in noteLanded, which handles a return whose send went unanswered once it's on chain, do what sendBack does. Before its `if (!written.size) return s;`:
  ```ts
  if (s.txs.some((t) => t.kind === "back" && t.confirmed && t.summary)) await this.deps.lovejoin?.restBack(network, s.index).catch(() => undefined);
  ```
  - **A clean send isn't marked twice:** sendBack deletes its summary.
  - **A chain's own return reaching here marks nothing new:** its chain's `done` already carries it.
  - **Tried in the copy** with finding 1's change: `zz-review-5-3` passes, 89 of 89 as above.

## Checked, and holding

**1. A chain cut before all its mixes went still shows Stopped, with Mix my boxes again.**
- **Never carried:** carriedOf returns false at `c.sent < ownTxs(c)`, before it reads `restBack` or any later chain.
- **Never marked:** restBack() marks only `restOnly` chains, which have `sent >= ownTxs`.
- **Mix my boxes again is unchanged:**
  - the pool page offers it from the boxes (`privately > 0`), not from the rows;
  - the Chains row still names it ("…mixes the boxes it didn't").
- **Pinned:** P5, and R3's first assert.

**2. A cut chain whose return isn't rebuilt yet still shows as it did.**
- With no mark and no later done chain of its session, it's shown as on `22acd30e` (R2's first assert).
- Neither another session's chain nor one recorded before it counts (R2).
- **No other session shares its index:** session indices only grow (`freshIndex` starts at `book.next`).
- **"Recorded after it" holds:** chains keep their insertion order. recordChain appends, and everything else only filters.

**3. A rebuilt remainder that failed or never landed.**
- **Failed:** one that stopped isn't `done`. That covers a cut, giveme.my's refusal and TAIL_KEEP_MS. One whose start failed has no record. Neither carries (R2, R4).
- **Never landed:** it does carry, as fx-cut's call 2 says: "went" means sent.
  - `done` means all sent, and `restBack` is written at the send.
  - The session stays open until its return is confirmed (`sessions.ts:3600`, `:5415`), and its own view says so.
  - A swap's or a site's card says Done beside "5 of 8 transactions sent" (call 5).
  - The lead's direction said "sent and landed". That difference is call 2's, for the lead or the owner (below).

**4. Bring every box back now, the due times and the bookkeeping are untouched in meaning.**
- **No rule changed:** the diff changes none of `mayLand`, `tailBoxes`, `tailBuildable`, `unschedule`, `countBack`, `counted`, `landed`, `squareUp` or `bringing`. `tailBoxOut` only reads `makers`.
- **What's written:** restBack() writes `restBack` alone, read by carriedOf alone. Its `cuts()` is the one every read path runs.
- **Who reads the changed views:** only `handlers.ts` (held, chains, mixes), for the pages. The UI reads `chain.done` in MixCard and `clearable` alone. A carried chain is clearable, as a stopped one was.
- **The 1.5.0 gate:** passes, unedited. No transaction is built differently.

**5. Records already on a device.**
- **The live run's records (R1):** they read as done at the next read, with nothing written.
- **Rest back directly, before this build:** no mark, so Stopped until the record goes (call 4). That's R2's first state.
- **1.5.0's records:** they have no tail, and their rest came back directly, so they read as call 4 says.
- **Caveat:** finding 1 reaches these records too, where the chain built in its place has already gone. Only its sortOut variant clears the ones still paired.

**Also checked:**
- **The cards:**
  - for a mix session, the tag is the session's own until it's over, then Done, or Held for a Bootstrap (R4);
  - a swap's or a site's return says Done beside its own count (call 5).
- **The takeover rule** (`tailBoxOut` and the same tail deposit), read from the code and not tested:
  - it holds through two cut tailChains in a row;
  - it holds for a tail gone `over`, whose box stays the wallet's not mixed yet.

## Questions (not made concrete)

1. **Call 2 against the direction.** A chain carried by a remainder that was sent but never landed reads Done. Is that what the lead wants, given the direction said "sent and landed"? The session's own view does say its return isn't on chain.
2. **Call 1's rarity argument.** It says the chain in its place "spends what the cut chain's last transaction left". That may not hold for a chain stopped, not cut, at its collateral's deposit because its last mix went missing (the next send refused, `sent = ownTxs`). buildBack builds the chain in its place from the account as listed, which then holds the mix before's change.
   - By the code, that chain is carried once its rest goes, though a box of it is one mix short.
   - Home still counts that box not mixed yet, once its spent mark goes (SPENT_KEEP_MS). That's call 1's stated outcome.
   - Not tested.

## Checks run

- **Baseline** on the tree:
  - stopped-shown and the 1.5.0 gate, 12 of 12;
  - planner `-t LIVE-1`, 5 of 5.
- **A wider set** on the tree: 69 files (lovejoin\*, chain\*, session\*, home\*, bring\*, return\*, collateral\*), 923 passed and 2 skipped.
- **The full unit suite** on the tree: 248 files passed and 1 skipped; 2889 tests passed and 4 skipped; exit 0. The log is `last5-full.log` in the scratchpad.
- **`tsc --noEmit -p .`:** clean.
- **Throwaways:**
  - `zz-review-5-1` was in the tree's `tests/`, and is deleted;
  - `-2` and `-3` were in the copy's planner file;
  - before and after logs are in `last5-throwaways.log`.
- **Both suggested fixes:** made in the copy only. With them, 89 of 89 in the four files.
- **Not run:** builds, Playwright, cargo, a formatter, mainnet.
