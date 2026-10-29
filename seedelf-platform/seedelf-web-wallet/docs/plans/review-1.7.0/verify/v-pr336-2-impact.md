# v-pr336-2-impact: pr336#2 (F3), judged for impact and the fix

**Verdict: confirmed. Severity: low** (as filed). Confidence: high.

- **The mechanism is as filed.** On a device with no record, a non-quiet pool read made while the first read's Koios check runs asks `lovejoin/pools` again and starts its own `tx_info`, with its own retries. That read also waits for its own check. Reproduced on HEAD (`6bca8bec`): 3 and 3.
- **It's reachable, but in a narrower state than written:**
  - It needs a mainnet pool launched after the running release's head start. None exists today.
  - It needs a slow Koios, so the window is long enough to hit.
  - Of the scenario's three triggers, only Refresh happens in the states it names. The real ones are Refresh, opening the hub again, and a swap's review.
- **The fix:** the finding's second option, one line. It changes nothing on a device that has a record, and every discovery test passes with it. The first option's "awaits" form would hold every concurrent read.
- **The proposed test passes on HEAD as worded.** It needs a change, below.

## Is it reachable in the shipped build?

**The preconditions,** each checked on HEAD:

1. **Mainnet, with the data layer up and Koios-only off (the default).**
   - On preprod, with Koios-only on, or with the data layer down, `index` is undefined, so `refresh()` returns at `lovejoin-pools.ts:420` before `confirmed()`.
2. **A shown pool that's new to the device.**
   - `confirmed()` asks Koios only about pools that are in neither the head start nor the record (`:566-569`, `if (!fresh.length) return found;`).
   - The bundled mainnet head start holds **0 pools** (`src/lovejoin-pools.json`: height 14110720).
   - The release runs `npm run lovejoin-pools` again (`docs/development.md:276`), so 1.7.0 bundles every pool that exists when it's packaged.
   - So the window opens only for a pool launched **after 1.7.0's head start** is written. It's latent today. Anyone can start a pool from the shipped build, so it isn't impossible.
3. **A record without `listed`.**
   - That's a fresh install, a device that never read pools, or one right after Remove wallet.
   - `keep()` is the only writer of `listed` (`:381`). `known()` and `copiesRead()` only carry it over (`:289`, `:322`).
   - Once the first check ends, its `keep()` writes `listed` and the window closes for good on that device. My scratch test shows it: the next read sends nothing.
4. **Koios slow.**
   - A healthy `tx_info` for one hash takes about a second, which is too short to hit.
   - A Koios that times out holds the check for about 91 s: `koios.ts:429` (`TIMEOUT_MS = 45_000`), then `:1373` (one retry after a timeout).

**The triggers, run through the worker's own `handle()`** in the order `Lovejoin.tsx:1743-1744` sends them (`lovejoin-status`, then `lovejoin-look-for-pools`):

- **Opening the hub doesn't trigger it by itself.**
  - The look's refresh reaches `refresh()` first, because the status path reads the sealed schedule in `cuts()` first. The look then holds the check.
  - The status's refresh lands during the data layer's ask and returns at `!this.answered.has(network)`. So the status answers at once, with the classic pool, and the page's Refresh is enabled.
  - Result: `OPEN1 {"statusDone":true,"lookDone":false,"data":1,"koios":["tx_info"]}`.
- **Opening the hub again in the window** (leaving Lovejoin and coming back): +1 `lovejoin/pools`, +1 `tx_info`. The look's refresh takes the exception.
  - Result: `OPEN2 … "data":2,"koios":["tx_info","tx_info"]`.
- **Refresh in the window:** +1 of each, and the status read itself is held. The page shows its spinner until a check ends.
  - Result: `REFRESH3 {"statusDone":false,"data":3,…}`.
  - On a device whose record has `listed`, the same three steps send nothing more and answer at once (`REC-OPEN2`, `REC-REFRESH3`).
- **A swap's or a return's review** (`rooms()` → `splitAll`) is a non-quiet read too.
- **Not reachable in the states the scenario names:**
  - **A running mix's `session-advance`.** A fresh install has no mix, and Remove wallet deletes the records. Advances also run one at a time (`sessions.ts:3219-3220`, `this.serial`), so they never stack anyway.
  - **"A pool's page":**
    - The classic pool's page reads quietly: `funding()` calls `poolNamed` only for a token pool's id (`lovejoin.ts:3390`).
    - During the window, the new pool isn't shown yet.
    - Only a token pool already in the head start has a page that triggers it, and mainnet bundles none.
  - **Refresh while the status read is the held one:** `RefreshRow.tsx:42` has `disabled={reading}`. That would happen if Chrome's storage timings ever reversed the open's order.

**What each trigger costs:**
- One `lovejoin/pools` to our server, and one Koios `tx_info`. On a failure, add one retry after a timeout or two after a 5xx or 429, plus an `account_update_history` for an L that its launch didn't register.
- It's all under `KOIOS_LIMIT`, and it names the same launch hash from the same IP, so nothing new is learnt about the user.
- No correctness harm: writes go one at a time (`serially`), and a duplicate check keeps nothing more.
- **One extra, not in the finding:**
  - While a re-asking read waits on the data layer, `answered` is deleted (`:416`). A `look()` in that gap returns from its refresh, finds no answer, and reads Koios's holder (`:393-396`).
  - Result: `SPREAD … "koiosDuringReask":["tx_info","credential_utxos"]`.
  - It's the same class as the pre-existing look-and-scan race that v-pr336-2-trace notes in its aside.

## Severity

**Low.** It's an edge case with a small cost:
- a few duplicate requests, once per device, inside one check;
- a Refresh spinner that can last up to about 91 s, where a device with a record answers at once.

No money, privacy, or lock is involved. It isn't medium: there's no stuck state, and nothing misleading is said. It isn't refuted either: once any mainnet pool exists that the release didn't bundle, every new install and every Remove wallet opens this window.

## The fix

**Take the second option.** Add one line in `refresh()`, after `this.crowds.set(…)` (`:453`) and before `:454`:

```ts
    await this.keep(network, []);
    await this.keep(network, await this.confirmed(network, found));
```

- **It makes the comment at `:412` true again:** "An answer is always kept with the list it was read under (keep's first write)".
- **On a device whose record has `listed`,** `keep()` returns at `:380` without writing. The only cost is one storage read per refresh, at most every 5 minutes.
- **What it writes is what the confirmed keep writes anyway** when nothing new is confirmed: `height` is the head start's under a new list. So STATE-4's reset is unchanged, as is `known()`'s carry-over.
- **In my copy:**
  - The fresh-device cases give 1 and 1, and the later reads answer before Koios does.
  - Opening the hub again, and Refresh, in the window send nothing more and answer at once.
  - After Remove wallet, the first read still asks again at once.
  - `lovejoin-discovery`, `-merged-review`, `-discovery-review-fixes`, `lovejoin-pools` and `-pools-head-start` pass: 98, plus 2 skipped. That's the baseline's 101 less my three HEAD-asserting cases.
- **A residual window remains,** of two storage operations between `:432` and that write. It's the same as before #336.

**Not the first option's "awaits it" form.**
- I ran it in the copy. Every existing test passes, but two things change:
  - The hub's first status read now waits behind the look's refresh, through both the data layer's ask and the Koios check (`OPEN1 {"statusDone":false,…}`).
  - On a device with a record, every later read waits too, where HEAD answers it at once (`CONTROL quick [false,false]`).
- That spreads F2's wait (pr336#1) to every concurrent read.
- Its "returns" form behaves like the line above, but it adds a map, and the read that returns skips the crowds line at `:408` (UI-9).

**What the line changes besides F3.**
- If the hub is opened again during the first check, its look no longer runs a check of its own. So it answers `grew: false`, and that page shows the new pool after Refresh or at the next open.
- HEAD already does the same on any device whose record has `listed`: `REC-END grew [true, false]`.
- The first page open keeps R10's reload either way: `grew: true`.
- **Optional, and separate:** `look()` could await a refresh already under way. That would give every device its `grew`, and it would also end the look-and-scan race in the aside above. It isn't needed for F3.

**How it fits with the other #336 fixes.**
- F2's no-retry, short-timeout client for `confirmed()` (v-pr336-1-impact) shortens the window to the timeout, but doesn't close it.
- F1's `utxo_info` read would lengthen the check, and the window with it. The line above is needed either way.

**Within the owner's rules:** no guard or refusal, no text, no privacy note touched. Koios cost goes down (rule 8), and the policy entry stays accurate.

## The test

- **As worded, the proposed test passes on HEAD.** Three `pools()` calls started in the same tick give 1 and 1 (`SAMETICK {"data":1,"koios":["tx_info"]}`): the later two return at `!this.answered.has` before any answer.
- **Write it this way instead:**
  - Use a device with no record, and hold `tx_info`.
  - Start the first read, and wait until it has asked for `tx_info`, so its list has answered.
  - Then make two more reads.
  - Assert 1 `lovejoin/pools`, 1 `tx_info`, and that the later two settle before `tx_info` answers. That last assertion also catches the "awaits" form.
  - Repeat it after `local.remove(KEY)` (Remove wallet): one more of each, not two.
- On HEAD, my version of it fails with 3 and 3, both later reads held. It passes with the fix.

## Repro

Two scratch files in the tree, run alone and deleted before returning. The fix trials ran in a copy under `scratchpad/review/v-pr336-2-impact/` (logs `baseline.log`, `fix-b.log`, `fix-a-returns.log`, `fix-a-awaits.log`, and `fix-b-rerun.log` for the Refresh case under the fix: `REFRESH3 {"statusDone":true,"data":1,…}`; sources in `variants/`; the copied tree deleted).

**`tests/zz-review-v-pr336-2-impact-1.test.ts`:** `PoolDiscovery` with the real WebAssembly, `fake-index`'s data layer, a Koios whose `tx_info` waits on a gate, and the head start `{ height: 0, pools: [] }`. All 5 cases passed on HEAD:

| Case | HEAD | With the fix |
|---|---|---|
| `SAMETICK`: 3 reads in one tick | 1 / 1 | 1 / 1 |
| `FRESH`: 2 reads after the first asked `tx_info` | 3 / 3, both held | 1 / 1, both at once |
| `SPREAD`: a read in the re-ask's data-layer wait, then a `look()` | the read at once; the look reads the holder (`credential_utxos`) | no re-ask, no holder read |
| `CONTROL`: a record with `listed` | 1 more / 1, at once | the same |
| `REMOVED`: after Remove wallet, a second read in the check | 3 / 3 in all, held | 2 / 2, at once |

(data layer / Koios `tx_info`)

**`tests/zz-review-v-pr336-2-impact-2.test.ts`:** `LovejoinService` wired as `sw.ts:246-247` wires it, with the messages through `handle()`. Results are the `OPEN1`, `OPEN2`, `REFRESH3` and `END` lines quoted above. Both cases passed on HEAD: a fresh device, and one whose record has `listed`.

No CLI matters.
