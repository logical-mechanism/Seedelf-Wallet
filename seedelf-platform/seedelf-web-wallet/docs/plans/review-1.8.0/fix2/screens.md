# 1.8.0's release review, round two's fixes: screens

The screens lane (FIX2BRIEF.md), on `review-1.8.0/fix2-screens` from `4b4628e9`, in `scratchpad/fix/screens`. Head: `d1a04c73` (three commits: `418ab02e`, `026f1564`, `d1a04c73`).

Every command runs from the worktree's `seedelf-platform/seedelf-web-wallet/extension`, with `--maxWorkers=2`. The mutation and revert runs use `scratchpad/fix2-screens/mutate.py`: it applies each edit by exact replacement (the string must occur once), runs the tests, restores the file and checks the restore by sha256. Its specs are `test-only.json` and `reverts.json`, and its logs `test-only-base.log`, `test-only-fixed.log` and `reverts.log`, all in `scratchpad/fix2-screens/`. Every JSON value was set by `scratchpad/fix2-screens/setvalue.py`, a line edit that parses the file before and after and checks nothing else changed. Where a value holds ₳, it copies the U+00A0 before it from the key's own current value.

The tests came first, run on the base code: `npx vitest run tests/lovejoin-screens-review-fixes-1-8-0.test.ts tests/approvals-review-fixes.test.ts tests/connector-lovejoin-review-fixes.test.ts` gave 3 files failed, 9 failed, 70 passed (79). Each failed for its finding's reason, as below. Found-later's es pin failed too. The test-only findings' tests passed there, and failed under their mutants.

## The findings

### r2-screens#1 with r2-critic#6: es `lj.skip.warn.floorShort`. Fixed (`418ab02e`)

- **What:** `es.json`, all three forms, exactly as the brief gives them. `_one`: "el pool de Lovejoin tenía {{count}} caja que no era tuya cuando la billetera lo leyó, y la billetera solo mezcla a partir de {{floor}}". `_many` and `_other`: "…{{count}} cajas que no eran tuyas…". Provenance stays `machine`, and the key is already in `verified-critical-es.json`'s `keys`.
- **Test:** `tests/lovejoin-found-later.test.ts`, the O4 describe's "says each in Spanish and Japanese as English does", the es pin alone. Its `_other` (count 20) changes, and two lines follow the loop: `_one` (count 1) and `_many` (count 1,000,000, a regex).
- **Base:** `npx vitest run tests/lovejoin-found-later.test.ts -t "says each in Spanish and Japanese"` gives 1 failed: `es: expected 'El pool de Lovejoin tenía 20 cajas que no son tuyas cuando la billetera lo leyó, …' to be 'el pool de Lovejoin tenía 20 cajas que no eran tuyas cuando …'`.
- **Pass:** 1 passed, 36 skipped.
- **Revert** (R1, the three forms back): 1 failed, the same message.
- **Where it's shown.** I ran r2-screens' reasons scan as a scratch copy in the worktree, writing `scratchpad/fix2-screens/reasons.json`, then removed it. It finds 127 routes, seven of them floorShort's:
  - `lovejoin.ts:3468`, floorShort's return;
  - `:3704` and `:3955`, `new LovejoinSkipped`;
  - `sessions.ts:4601`, `skipped =`;
  - `:4650` and `:4700`, a mix's `.skipped =`;
  - `:4762`, `lovejoinSkipped:`.

  Each one is shown after a colon:
  - in `lovejoin.warn.skippedThis` (SessionBackSummary);
  - in `lovejoin.warn.skippedIts` (SessionView);
  - in `claim.warn.skippedItem` (Bring everything back);
  - in `lj.leftOut`, on a mix's card (`Lovejoin.tsx:913`) and as a LovejoinSkipped's own message.

  **It never opens a sentence.** Only two frames open a sentence with a reason: `swaps.lovejoin.warn.pool` and `swaps.stop.poolShort` (Swaps.tsx's `opening`). They take priced's `skipped`, which is only noAdaPool or poolShort's poolFloor/poolFree (`sessions.ts:1845`). A swap's token way gives noPool, poolCant or `lj.tokens.skip.warn.balance`, and they show in `lovejoin.ways.warn.direct`, which is a colon frame. ClaimAll's left-out list shows a build's error alone, but no floorShort gets there: leftOut catches the LovejoinSkipped, and collateralWanted's reason is saved, never thrown.
- **r2-screens' openings check** (also a scratch copy, removed):
  - now: es finds only `lj.skip.warn.untoldAll` ("El servidor no ha dicho…"), and en only untoldAll ("The server hasn't said…");
  - with es floorShort reverted: es finds 4, its three forms and untoldAll.

### r2-screens#2: `dappUi.back.privacy.noteLovejoinMixed`. Fixed (`418ab02e`)

- **What:**
  - en and es get the brief's values exactly, with 2 U+00A0 each, copied from the old values;
  - ja is unchanged, since it already kept the count with its verb.
- **Tests:** the pins were updated:
  - `tests/approvals-review-fixes.test.ts:163`, `:329` (MIXED_ONCE) and `:575`;
  - `tests/connector-lovejoin-review-fixes.test.ts:74` (NOTE_MIXED).

  One new `it` was added there, beside W5: "says the 5 ₳ kept aside is mixed once, never that it's kept aside once, in any language". In en the note holds "kept aside in a box of its own, mixed once" and never "kept aside once". In es it holds "mezcla una vez los 5 ₳ apartados" and never "apartados una vez". In ja it holds "専用のボックスで 1 回ミックスします".
- **Base:** in the run above, 6 of the 9 failures are this finding's (approvals 3, connector 3). For example: `expected 'Later, to bring it back …' to contain 'Lovejoin mixes the spare ADA in 5 ₳ boxes, and the 5 ₳ kept aside in a box of its own, mixed once, only if enough is left'`.
- **Pass:** all pass.
- **Revert R2** (en and es back): `tests/approvals-review-fixes.test.ts tests/connector-lovejoin-review-fixes.test.ts` gives 2 files failed, 6 failed, 43 passed (49).
- **Revert R2b** (es alone back): 1 failed, 48 passed: `es: expected 'Desde la página de dApps. …' to contain 'mezcla una vez los 5 ₳ apartados'`.

### r2-screens#3: the hub's `takes`. Fixed (`026f1564`)

- **What:** `Lovejoin.tsx`, `takes = (p: ShownPool) => !p.unusable`. Its comment says why.
- **Test:** the O6 describe, "counts a pool below the network's minimum as taking no box, as a retired pool or a copy (r2-screens#3)". A v2 token pool with `unusable: { why: "belowMinimum" }`, alone and beside the classic pool's 2 boxes: its row is listed, the aside is `lovejoin.aside`, and the none-line is `lovejoin.pools.noneYet`.
- **Base:** `alone: expected 'A mixer for ADA and tokens' to be 'A mixer for ADA, in 5 ₳ boxes'`.
- **Revert R3** (`!isRetired(p) && !isCopy(p)`, `-t O6`): 2 failed, 4 passed. This case fails, and so does #4's below-minimum case: `expected 'A mixer for ADA' to be 'A mixer for ADA, in 5 ₳ boxes'`.

### r2-screens#4: the hub's aside. Fixed (`026f1564`)

- **What:** `Lovejoin.tsx` gets `fiveOnly = pools.every((p) => !!p.box.token || !takes(p) || BigInt(p.box.lovelace) === COLLATERAL)`. The aside is then `tokenTakes ? asideTokens : fiveOnly ? aside : asideAda`. A new key, `lovejoin.asideAda`:
  - en "A mixer for ADA";
  - es "Un mezclador de ADA";
  - ja "ADA をミックスするサービス";
  - `machine` in both provenance files;
  - not critical.
- **Test:** O6, "says its ADA is mixed in 5 ₳ boxes only where every ADA pool that takes boxes holds 5 ₳, or none does (r2-screens#4)". Each case is pinned:

  | Pools | Aside |
  |---|---|
  | 20 ₳ alone | asideAda |
  | 5 ₳ and 20 ₳ | asideAda |
  | 5 ₳ and 20 ₳ below the minimum | aside |
  | 5 ₳ and a 20 ₳ copy | aside |
  | the classic pool's boxes alone | aside |
  | nothing | aside |
  | 20 ₳ and a v2 token pool | asideTokens |

  The existing case keeps 5 ₳ alone, 5 ₳ with a retired token pool, and 5 ₳ with a v2 token pool.
- **Base:** `expected 'A mixer for ADA, in 5 ₳ boxes' to be 'lovejoin.asideAda'`.
- **Revert R4** (the aside back to `tokenTakes` alone): 1 failed: `expected 'A mixer for ADA, in 5 ₳ boxes' to be 'A mixer for ADA'`.

### r2-screens#5: a v2 pool's page while the retired pools' run goes. Fixed (`d1a04c73`)

- **What:** in `BringAllBack.tsx`, BringAllBack hands its view `otherRetired={other && !!going?.retired}`. BringAllBackView then says `lovejoin.bring.otherRetired` where it said `lovejoin.bring.other`. The test id (`lovejoin-bring-other`) is the same, and the link stays off. The new key:
  - en: the brief's;
  - es: "Las cajas de los pools retirados están volviendo ahora. Las de este pool pueden volver cuando eso termine, o usa Configuración para todos los pools.";
  - ja: "廃止されたプールのボックスを戻している最中です。このプールのボックスはそれが終わってから戻せます。設定からすべてのプールを戻すこともできます。";
  - `machine` in es and ja.

  `node scripts/i18n-critical.mjs --write` leaves `critical-keys.json` at 476 keys, unchanged, so the key is not critical.
- **Test:** a new describe, "a v2 pool's page while the retired pools' run goes (… r2-screens#5)", renders BringAllBack on v2's 5 ₳ pool's page with the retired run `{ back: 1, left: 2, retired: true }` seeded.
  - It says `otherRetired`, never `lovejoin.bring.other`, and the link is off.
  - Another pool's run says `lovejoin.bring.other`, as before, with the link off.
  - A retired pool's page follows the retired run: it has no such line, and shows `lovejoin-bringing`.
- **Base:** `expected "Another pool's boxes are coming back now. Stop that first, or use Settings for every pool." to be 'lovejoin.bring.otherRetired'`.
- **Revert R5** (the view's line back): 1 failed, `expected "Another pool's…" to be "The retired pools' boxes are coming back now. …"`. **R5b** (the wiring dropped) fails the same way.

### r2-tests#1 with r2-screens#0: BringAllBack's question wiring. Pinned (`d1a04c73`)

- **Test:** a new describe in `tests/lovejoin-screens-review-fixes-1-8-0.test.ts`, "Bring every box back's question, which names what its press asks". Its `question()` helper calls `seam.reset()`, `seed([], bringing)` and `seedInitial(false, true)`, then renders BringAllBack and reads the h2. It carries r2-screens' five states, with each title read by its key. The runs are seeded as the worker writes them, with no `at`:
  - the retired run stopped: `bringRetiredTitle`;
  - every pool's run stopped: `bringTitle`;
  - no run: `bringTitle`;
  - the retired run going, where the press widens it: `bringTitle`;
  - a retired pool's page: `lovejoin.bring.title`.
- **Base:** it passes, since the merged wiring is right.
- **Mutants**, each run with `-t "Bring every box back's question"`, at the base and again on the fixed tree; each gives 1 failed, 29 skipped:
  - C1 `retired={false}`: `expected 'Bring every box back now?' to be "Bring the retired pools' boxes back now?"`;
  - C2, the title ignoring `retired`: the same message;
  - C3 `retired={!!bringing?.retired}`: the reverse;
  - C4 `bringAsk(pool, undefined)`: the same as C1.

### r2-tests#3: W8's undecided pool. Pinned (`d1a04c73`)

- **Test:** the W8 describe, "leaves a chain in a pool the read set lacks undecided, said as before, where discovery's record can't be read (r2-tests#3)". `pools` and `known` both throw, as sw.ts's serviceDeps would. A chain stopped partway in v2's 5 ₳ pool then gives:
  - chains(): `retired` is `[undefined]`;
  - status(): no v2 pool listed, and its row is `[undefined]`;
  - `againBoxes(ADA)`: rejects with `lj.poolUnknown`.

  So it pins rows() to R3's rule, not a working action.
- **Base:** it passes.
- **I1** (a pool the set lacks counted retired), with `-t undecided`: 1 failed, 29 skipped, `expected [ true ] to deeply equal [ undefined ]`. That holds at the base and on the fixed tree.

## Awaiting blind back-translation

- **`lj.skip.warn.floorShort`, es, all three forms** (`_one`, `_many`, `_other`). Its frames:
  - `lovejoin.warn.skippedThis`, in a return's review;
  - `lovejoin.warn.skippedIts`, on a site session's page and a swap session's page;
  - `claim.warn.skippedItem`, in Bring everything back;
  - `lj.leftOut`, on a mix's card on Lovejoin's page, and as a LovejoinSkipped's own message on a page's error line.

  Fill it with a count of 20 and of 1, and a floor of 30. ja is unchanged.
- **`dappUi.back.privacy.noteLovejoinMixed`, es.** Its frame is the connect window's private-session funding review: the note under `dappUi.back.title` ("Later, to bring it back"), shown where Review read v2's 5 ₳ pool taking a box (`lovejoinRoom`) and the collateral's mix may go (`collateralMix`). en is reordered the same way; ja is unchanged.
- **Not critical:** `lovejoin.asideAda` and `lovejoin.bring.otherRetired`. The critical set is unchanged at 476 keys. No `verified-critical` edit was needed: both critical keys above were already listed.

## For the lead

1. **The e2e lane's pin.** `e2e/extension.spec.ts:5328`'s comment and `:5333`'s assertion take the new en value, with plain spaces as the spec's strings have them: "From the dApps page. Lovejoin mixes the spare ADA in 5 ₳ boxes, and the 5 ₳ kept aside in a box of its own, mixed once, only if enough is left, so they're harder to tie to this session; they come back hours later. The rest comes back at once. Settings → Lovejoin turns that off."
2. **The worker's refusal, outside my lane.** `lj.bringOtherPool` (`lovejoin.ts:6886`, bringAllBack) still says "Another pool's boxes are coming back now. Stop that first…" where a v2 pool's run is asked while the retired run goes. Now only a race reaches it: the page's link is off while that run goes. If you want it in the same words, a worker-side retired variant, non-critical. `lovejoin-retired.test.ts:303` pins that refusal.
3. **`lj.skip.warn.untoldAll`.** This is 1.7.2's critical reason, and it still opens with a capital after a colon in en and es. It's r2-screens#1's older sibling, and the brief leaves it. Fixing it means a blind round in es.
4. **The docs.** No live doc quotes the words I changed. `docs/flows.md:490` describes noteLovejoinMixed's meaning ("mixed once, in a box of its own, only if enough is left"), which still holds.
5. **At the merge:**
   - My found-later hunk is the O4 describe's es pin alone, `:761-777`.
   - My JSON hunks are four keys' lines and two new keys, each beside its sibling.
   - The e2e lane asserts none of my new words: `lovejoin-bring-other` keeps its test id, and its words become `lovejoin.bring.otherRetired` during the retired run.
6. **Not checked:**
   - Static renders only, in three languages (the scratch printout is in this session). There was no visual harness and no Playwright, which this lane doesn't run. Every change is words, or a rule over what the page has read; none touches the layout.
   - r2-critic#5 ("the refusal says why"): no words changed, as the lead accepted it.

**Requests:** none changed. The changes are words, and a render rule over what the page has already read.

## Checks run

- `npx tsc --noEmit -p .`: clean, on the final tree.
- The 49 test files my change can reach:
  - every file that renders BringAllBack, the Lovejoin screen or the connect window's funding;
  - every file that names floorShort or the aside;
  - `tests/i18n*.test.ts`, `tests/words.test.ts` and `tests/worker-words.test.ts`.

  The list is in `scratchpad/fix2-screens/files.txt`, with logs `suite-default.log` and `suite-preprod.log`.
  - default build: 49 files, 988 passed;
  - `VITE_ENABLE_MAINNET=false`: 49 files, 988 passed.
- The i18n and words files alone, on the default build: 10 files, 194 passed.
- `node scripts/i18n-critical.mjs --write`: 476 keys, no change.
- `git diff --check`: clean. The worktree is clean at `d1a04c73`. The scratch scans were removed before the commits, and none was committed.
