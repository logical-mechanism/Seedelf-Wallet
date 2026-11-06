# 1.8.0's release review: the screens lane's fixes

- **Branch:** `review-1.8.0/fix-screens`, in `…/scratchpad/fix/screens`, from `1beba3fb`.
- **Head:** `b941a4d4`.
- **Commits:**
  - `737bdf11` fix(web-wallet): a swap's boxes are the 5 ₳ pool's, and the retired reason ends at its first sentence (W1, W3 with W4, and W10's comments in Swaps.tsx)
  - `b941a4d4` fix(web-wallet): Lovejoin's screens in 1.8.0's states: a retired chain, the hub's list, a page kept (W7, W8, W9, S1, S2, O6, S3's screens half, screens#9, the rest of W10)
- **New test file:** `extension/tests/lovejoin-screens-review-fixes-1-8-0.test.ts`, 25 tests. W7's tests are 3 new rows in `tests/i18n-worker-reasons.test.ts`; W1's are `tests/screens.test.ts`' four pins, updated.
- **Words:** one critical value changed, `lj.unusable.warn.retired`, in en, es and ja (*Awaiting blind back-translation*). Seven non-critical keys say 5 ₳ (W1). No key added.
- **Outside my lane:** one line of `tests/lovejoin-1-5-0.test.ts` (the e2e lane's), which W8's flag changes. Not applied on my branch: *For the lead*, item 1.

Every command ran from the worktree's `seedelf-platform/seedelf-web-wallet/extension`, with `--maxWorkers=2`. I ran no git command outside the worktree. Inside it I committed by path. For the base checks, a script put the base's sources back (`git show 1beba3fb:<path>`) and then restored mine. For the revert checks, a script applied one exact edit, ran its tests and put the file back. `git status` is clean at the head. The scripts and specs are in `…/scratchpad/screens-fix/scripts/` and `…/scratchpad/screens-fix/spec.json`.

**No DOM.** The tests render each screen once, statically, as the house's screen tests do, and no copy of `Lovejoin.tsx` is committed. The hub's read and a page open on it can only be reached by a read or a press, so the new file seeds them. It does this through a small `vi.mock("react")` seam, after `screens-wiring-review-fixes`' `seed` and the purpose-built seams of `swap-hidden-balances` and `lovejoin-launch-review-fixes`:
- A seed is the useState right after a run of states starting as `after`: the hub's read sits after `useT`'s `0`, and its view after `[false, undefined, false, undefined, false]`. Its setter is kept, so a test can change the state inside the render.
- `on` takes an element's props as the element is made, so a test can press what it's handed.
- No effect runs, and no request answers. A seed that meets a state not starting empty throws, so a state added before the hub's view fails loudly.

---

## The base, before any fix

Every reachable test file (70 files: every test importing these screens, every worker test reading `status` or `chains`, and the i18n and words files):
- `npx vitest run <70 files>`: **2 failed | 1299 passed**.
- `VITE_ENABLE_MAINNET=false`: the same, **2 failed | 1299 passed**.
- The 2 are `lovejoin-1-5-0`'s head-start case, failing by design.

**My final tests, run against the base's sources:** `npx vitest run tests/lovejoin-screens-review-fixes-1-8-0.test.ts tests/screens.test.ts` gives **19 failed | 78 passed**.
- The 19 are the 16 new tests below that fail at the base, and W1's 3 pins in `screens.test.ts`. Each fails for its finding's reason, quoted under it.
- The 9 that pass at the base are the untested-guard tests. Each fails under its mutant instead (S3, screens#9).

**The checks, how they ran.** Each **revert** below reverts that one fix alone in the final code, through `python3 -I …/screens-fix/scripts/mutate.py <ext> …/screens-fix/spec.json`. Each entry runs `npx vitest run <files> -t <pattern> --maxWorkers=2`. Every one of the 24 is caught; the full output is `…/screens-fix/mutants-final.log`.

---

## W1 · fixed (`737bdf11`)

**What changed:**
- `src/i18n/translations/en.json`, `es.json` and `ja.json`: `swaps.cost.boxesLabel`, `swaps.boxes.atMost_*` and `swaps.boxes.roomFor_*` say 5 ₳, with the no-break space kept:
  - en: 5 values;
  - es: 7, `_many` included;
  - ja: 3.
- **5 ₳, not `{{box}}`.**
  - A swap's ADA boxes are the 5 ₳ pool's by rule: `priced` counts only `adaPool`'s boxes, and `adaPoolOf` takes only a box of `COLLATERAL_LOVELACE`.
  - `SwapLovejoin` carries no value for the ADA pool, and both it and `priced` are other lanes'.
  - The other 44b strings name the pool the same way ("Lovejoin's pool of 5 ₳ boxes").
- `src/ui/screens/Swaps.tsx`: comments alone.
  - `boxesText`'s, which said 10 ₳.
  - Two that said the classic pool takes the spare ADA's boxes: `LovejoinChoice`'s and `lovejoinOf`'s.
  - Find's `any` is untouched.

**The test:**
- `tests/screens.test.ts` has the frames' pins in English: `:353` and `:366` "Boxes of 5 ₳ …", `:446` "at most 1 box of 5 ₳" on the approval, and `:570` in Stop's dialog.
- The new file's *W1* block checks every form of each key in each language: it says 5 ₳, never 10 ₳.

**Results:**
- At the base: the 3 pins fail (`expected 'On the way back, through Lovejoin Box…' to contain 'Boxes of 5 ₳ About 4, at most'`), and so do all 3 languages (`swaps.cost.boxesLabel: expected 'Boxes of 10 ₳' to contain '5 ₳'`, and `'Cajas de 10 ₳'`, `'10 ₳ のボックス'`).
- Fixed: they pass.
- Revert (R1, every edited value back to 10 ₳): **6 failed** (the 3 pins and 3 languages).

## W3 with W4 · fixed (`737bdf11`)

**What changed:**
- `lj.unusable.warn.retired` in en, es and ja loses its last sentence: "Your boxes in it come back by themselves." / "Tus cajas aquí vuelven solas." / "ここにあるあなたのボックスは自動で戻ります。".
- The first sentence stays word for word in each. In ja, that's the two sentences the English one became.
- `UNUSABLE`'s comment in `Lovejoin.tsx` now says the retired words say nothing of how a retired pool's boxes come back.

**The critical-value steps:**
- es and ja were already `machine` in `docs/i18n/es-provenance.json:3068` and `ja-provenance.json:2782`.
- The key was already in both verified lists' `keys`, at line 477. I left `reviewer` alone.
- `node scripts/i18n-critical.mjs --write` gives `critical-keys.json: 475 keys`, no change.

**The changed value grepped** in the tests, the saved worker reasons and the negation lists:
- **The tests:** they read it through `tr()`, apart from `lovejoin.test.ts:803`. That one pins the prefix "This pool runs Lovejoin's retired scripts", which holds.
- **Its words:** no test pins the dropped sentence.
- **The saved reasons:** the reason is saved as `mix.skipped` (the `t()` of the key). No released build saved the old text.
- **The negation lists:** each value keeps its negation (en no/none, es no/ni, ja ません), and `i18n.test.ts` passes.

**The test,** the new file's *W3 with W4* block:
- In each language, the value is its first sentence alone, pinned exactly.
- A stuck retired token pool's page and row show the stuck callout and the reason, never "Your boxes in it come back by themselves".

**Results:**
- At the base: **4 failed**. The three languages differ in the dropped sentence, and the page says `expected '100 LJTEST + 2 ₳ 3 boxes not yours Re…' not to contain 'Your boxes in it come back by themsel…'`.
- Fixed: they pass.
- Revert (R2, the sentence put back in all three): **4 failed**.

## W7 · fixed (`b941a4d4`)

**What changed:** `tests/i18n-worker-reasons.test.ts` puts `unusableReason` into `REASON_FUNCTIONS`, with a comment saying why. It also adds three rows to the routes' `it.each`: `lj.unusable.warn.retired`, `.superseded` and `.belowMinimum`, each "given as unusableReason's return, through -, in background/lovejoin.ts, and is critical".

**Results:**
- Without `unusableReason`, the base's set (R3): the 3 rows **fail**.
- With it: they pass, and so does the whole file.
- **The finding's mutant** (words#8's M8: the key renamed without `.warn.`, here `lj.unusable.retired` in `en.json` and in `unusableReason`'s literal), with `-t "is accuracy-critical"`:
  - with the fix, **1 failed** ("is accuracy-critical, or a word it borrows");
  - without it, **1 passed**, which is the finding.

## W8 · fixed (`b941a4d4`)

**What changed:**
- `src/shared/rpc.ts`: `LovejoinChainView.retired?: true`, with its comment.
- `src/background/lovejoin.ts`, the chains' view alone:
  - `rows(s, set)` is now async.
  - A chain **stopped partway** whose every pool is retired carries `retired`.
  - Retired means the classic pool, or a pool the read set has that isn't on v2 (`isRetired`). A pool the set lacks is left undecided, so its row is said as before.
- **Where the set comes from:**
  - `status()` passes the pools of its own read (`reads`), with no other read.
  - `chains()` passes the read set as discovery last kept it (`readSet(network, true)`, a trap handed on). It's asked only where a token pool's chain stopped partway is listed, since the page reads this every few seconds while a chain is sent.
- `src/ui/screens/Lovejoin.tsx`, `Chains`: a row with `retired` says the existing, non-critical `lovejoin.detail.whyStopped` ("Why it stopped: {{why}}."), and no new key. Its doc comment says so.

**Two choices, both from the full run:**
- **Only a stopped chain is flagged**, the one row whose words change. Flagging every row changed `chain-requests.test.ts`'s exact view of a chain being sent.
- **`status()` doesn't read the set again.** An earlier draft did, through `retiredIds`. A test's deps with no `known` answer a quiet read through `pools`, so the extra read met `run-traps-review-fixes`' trap one call early. Both files pass unchanged as built.
- `rows` doesn't use `retiredIds` either. Its rule, a pool missing from the set counted retired, is R3's to change, and so is its shape. Mine is R3's corrected rule, which lows-b said the flag should follow once it lands.

**The test,** the new file's *W8* block:
- The row's words with `retired`: why it stopped alone, never "Mix my boxes again". Without it: `lovejoin.chains.whyStopped`, as before.
- The worker, with the real WebAssembly and a 1.7.2-shaped record: a chain the update cut after its deposit, read through `chains()`.
  - In the classic pool: `[true]`, through `status()` too.
  - In PR #163's 8131b1d token pool: `[true]`.
  - In v2's 5 ₳ pool: `[undefined]`, through `status()` too.

**Results:**
- At the base: **2 failed** (`the classic pool: expected [ undefined ] to deeply equal [ true ]`, and `expected 'Chains Private session 1, 2 boxes Sto…' not to contain 'Mix my boxes again'`).
- Fixed: they pass.
- Reverts, each **1 failed**:
  - R4, the flag's line dropped;
  - R4b, the rule with no read set (the classic pool alone): the 8131b1d case;
  - R5, the row's words back to `chains.whyStopped`.

**Outside my lane:** `lovejoin-1-5-0`'s plain case (`:914`, passing at the base) now sees `"retired": true` on the 1.5.0 vault's cut chain at the unlock. That's this fix working: the chain is in the classic pool. The pin's update is *For the lead*, item 1.

## W9 · fixed (`b941a4d4`)

**What changed:** `Lovejoin.tsx`, `AgainActions` renders `{!why && <OtherAccounts …/>}`: an account is named to switch to only where mixing again isn't refused. That covers a pool below the network's minimum too, as lows-b noted.

**The test** (*W9*): Account 2's boxes are named nowhere in a retired pool, or in one below the minimum, and named in a v2 pool. The retired reason stays under the buttons, and Bring one back now stays on.

**Results:**
- At the base: **failed** (`expected true to be false`).
- Fixed: it passes.
- Revert (R6): **1 failed**.

## S1 · fixed (`b941a4d4`)

**What changed:** the hub searches with `searched = groups.length > SEARCH_FROM ? query.trim() : ""`. The empty line reads the same value. The query is kept, so it searches again if the box comes back.

**The test** (*S1*):
- "MIN", typed while retired groups showed the search, with one group left (v2's 5 ₳ pool's): there's no search box, the 5 ₳ pool's row is listed, and no "No pool's token matches “MIN”" shows.
- Six groups: the search works, and says "No pool's token matches “zzzz”".

**Results:**
- At the base: the first **fails** (the row isn't listed). The second passes, since it guards that search still works.
- Fixed: both pass.
- Revert (R7): **1 failed**.

## S2 · fixed (`b941a4d4`)

**What changed** (`Lovejoin.tsx`):
- **`keptPage(pools, view)`,** exported for its test. It gives the read's pool. Where that read lists the pool no more and the page's run of Bring every box back ended there (`view.ended`, the same pool), it gives the pool as the page last read it, with nothing of the wallet's left in it: no boxes, lovelace, due, notMixed or fromPublic, and no token, unsure, deposits, otherAccounts or bootstrap.
- **The hub's view** keeps `ended` with the pool's page, so leaving the page drops it.
- **`PoolPage`** takes an optional `onRunOver`. Its BringAllBack's `onOver` calls it before reading again.
- **The hub's handler** stores the page's current pool as `ended`.
- So a retired token pool's page, emptied by its run or by the retired pools' run, stays on its last read with "Your boxes in the pool: None". Its BringAllBack stays mounted with its Done, where the hub used to replace the page at the next read.

**The test** (*S2*):
- `keptPage`'s cases: the kept read, emptied; a pool still listed (the read's); no run ended; another pool's run.
- `PoolPage` calls `onRunOver` and `onRefresh` when its BringAllBack's run ends.
- The hub, its read seeded with the pool and its page open: the run's end is pressed, and the next read, without the pool, is set inside the render. It stays that pool's page (`id="lovejoin-pool-title"`, not the hub's), with "Your boxes in the pool None" and no Bring one back now, and its BringAllBack is still made for that pool.
- A static render can't hold BringAllBack's own Done (no effect runs), so the test stops at the element it holds it in.

**Results:**
- At the base: **3 failed** (`keptPage is not a function`; `expected "vi.fn()" to be called 1 times, but got 0 times`; `expected false to be true`, the page gone).
- Fixed: they pass.
- Reverts:
  - R10, `keptPage` ignoring `ended`: 2 failed;
  - R11, PoolPage not calling `onRunOver`: 1 failed;
  - R12, the hub on `poolNamed`: 1 failed;
  - R13, the handler storing nothing: 1 failed.

## O6 · fixed (`b941a4d4`)

**What changed** (the hub, o-design §3 step 7):
- `takes(p)` is `!isRetired(p) && !isCopy(p)`.
- The aside says "A mixer for ADA and tokens" only where a token pool takes boxes (`tokenTakes`).
- "No pool to mix in yet." shows where nothing is searched for and no pool listed takes boxes (`noneTakes`). So it shows under the retired pools' rows too, for the wallet's boxes there. `noneMatch` stays for a query.
- `tokenPools` stays the gate of the critical `lovejoin.start.warn.cost` note.

**The test** (*O6*):
- The aside: v2's 5 ₳ pool alone, and beside a retired token pool, say "in 5 ₳ boxes"; with a v2 token pool, "and tokens".
- The none-yet line: with only the classic pool's boxes listed, and with a retired token pool too, it says "No pool to mix in yet."; with the 5 ₳ pool listed, under its floor, it says none.
- screens#10's case, below.
- The cost note's gate: on with only the classic pool read, off with the 5 ₳ pool read, as before.

**Results:**
- At the base: **2 failed** (`expected 'A mixer for ADA and tokens' to be 'A mixer for ADA, in 5 ₳ boxes'`; `the classic pool's boxes: expected '' to be 'No pool to mix in yet.'`).
- Fixed: they pass.
- Reverts and the gate's mutant, each **1 failed**:
  - R8, the aside on `tokenPools`;
  - R9, the line only with nothing listed;
  - Mcost, the cost note on `tokenTakes`.

## S3's screens half · tests (`b941a4d4`)

**screens#8 and tests-e2e#2's unit half.** The block *a retired pool's page and row, withdraw-only*. These tests pass at the base: the guards are there. Each mutant below fails them.
- The classic pool's page, and a retired token pool's under its floor:
  - Bring one back now on;
  - Bring every box back there;
  - Mix's Review off, the retired reason under it;
  - Mix my boxes again off, the reason under it;
  - no Bootstrap lead, link, form or button.
- A box not mixed yet: Bring one back anyway in its callout, and Bring one back now for the rest.
- The launch link private, and the page's BringAllBack told `retired`; a v2 pool's page told `false`.
- The hub's row: the retired reason, no "Being started", no meter, and `unusableText({ why: "retired" })` the retired key's.

The mutants, each caught:

| Mutant | What it does | Caught |
|---|---|---|
| M4 | The meter for a retired pool (`:2245`'s `isRetired` dropped) | 1 failed |
| M5 | `closed = isCopy(pool)` | 2 failed |
| M6 | The launch link not private when retired | 1 failed |
| M7 | `retired={false}` | 1 failed |
| M9 | Retired worded as `superseded` | 2 failed |
| tests-e2e#2's mutant | `!isRetired(pool) &&` on Bring one back now | 2 failed |

**screens#10 and words#10:** with nothing listed and nothing typed, the hub says "No pool to mix in yet.", never 'No pool's token matches “”'. It passes at the base. M8, the line always `noneMatch`, makes it **fail**.

## screens#9 · tests (`b941a4d4`)

The block *a return's switch, its spare ADA through v2's 5 ₳ pool*. It passes at the base:
- `LovejoinSwitch` says the spare ADA is mixed (`swaps.lovejoin.privacy.on`) for the 5 ₳ pool named by its id and valued, alone or across pools, and for a 1.7 return named by none.
- It says the tokens go into their pools (`onTokens`) where only a token's pool takes boxes, with the 5 ₳ part at 0 boxes or absent.

The mutants:
- M22, `adaPool = (pool) => pool === undefined`: **1 failed**.
- adapool#5's third mutant, the same line's `!token` dropped: **1 failed**. It's the same guard; no lane had it, so I covered it here.

## W10, the rest · fixed (`737bdf11`, `b941a4d4`)

Comments alone, with no test:
- `Lovejoin.tsx`: the header at `:6` and `:45`.
- `Home.tsx:1468`.
- `preferences.tsx:6` and `:90`.
- `rpc.ts`: `SwapLovejoin`'s doc and `SessionBackSummary.lovejoin`'s.
- `Swaps.tsx`: three comments, under W1.

Each said every box is 10 ₳, or that the classic pool takes a swap's boxes. Not done here:
- `DappApprovals.tsx`' two, which are the connector lane's;
- `room()`'s default and critic#7, the find lane's;
- pr363#4's, the v44a lane's.

---

## Awaiting blind back-translation

- **`lj.unusable.warn.retired`** (critical), changed in en, es and ja: the last sentence is dropped, and the first kept word for word. ja's value was owed a fresh round anyway (W6: corrected after its first). es's is new to that round. The values:
  - en: "This pool runs Lovejoin's retired scripts: the wallet puts no new box in it, and mixes none again."
  - es: "Este pool usa los scripts retirados de Lovejoin: la billetera no pone cajas nuevas en él ni vuelve a mezclar ninguna."
  - ja: "このプールは Lovejoin の廃止済みのスクリプトで動いています。ウォレットは新しいボックスを入れず、ここにあるボックスを再ミックスもしません。"
- **Its frames:**
  1. A retired pool's page, under Mix's Review (`lovejoin-mix-why`) and under Mix again's buttons (`lovejoin-again-why`): `unusableText` in `Lovejoin.tsx`. Bootstrap's `lovejoin-bootstrap-why` takes it too, but no Bootstrap is offered in a retired pool.
  2. A retired pool's row on the hub (`lovejoin-pool-unusable`).
  3. A 1.7 mix session's card in Your mixes: "Lovejoin was left out: {{reason}}" (`lj.leftOut`, via `detailOf`). It's saved as `mix.skipped` when `chain()` turns `takesNewBoxes`' refusal into a `LovejoinSkipped`.
  4. The page's error line where the worker refuses a press in a retired pool: `takesNewBoxes`, then `unusableReason`, in a mix's review build, a Bootstrap, Mix my boxes again, and both public builds. Those buttons are off there, so only a page whose read is stale reaches it.
  5. A return's frames, which take any `LovejoinSkipped` reason: `lovejoin.warn.skippedThis` (the review), `lovejoin.warn.skippedIts` (the session's page) and `claim.warn.skippedItem` (Bring everything back). lows-b traced each as unreachable for this reason, since a mix session never saves `lovejoinSkipped` and is never claimed. They're listed for completeness.

The seven `swaps.*` box values (W1) aren't critical. They stay `machine` in both provenance files.

## For the lead

1. **`tests/lovejoin-1-5-0.test.ts`** (the e2e lane's file), in `finishesRetired` (`:789` at `1beba3fb`). W8 puts `retired: true` on the cut chain's row at the unlock (`at === MINUTE`). Replace

   ```ts
         return label === "chains" && at !== MINUTE ? [] : r;
   ```

   with

   ```ts
         // The cut chain's row, its pool retired, says why it stopped alone (1.8.0's release review, W8).
         if (label === "chains") return at !== MINUTE ? [] : (result as Array<Record<string, unknown>>).map((c) => ({ ...c, retired: true }));
         return r;
   ```

   - **Tried in my worktree and put back:** the file is then at its 2 by-design failures on both builds (`2 failed | 2 passed`).
   - **Without it:** the plain case (`:914`) fails on my branch.
   - The head-start case (`:929`) runs the same function, so the one edit covers it once the e2e lane reworks it.
2. **R3** (the retire lane) changes `retiredIds`. W8 doesn't call it; its rule is R3's corrected one. If R3 lands a different rule for "retired", align `rows`' `old` in `lovejoin.ts` with it.
3. **`rpc.ts`:** my edits are `LovejoinChainView.retired` (a new field) and one comment line each in `SwapLovejoin`'s and `SessionBackSummary.lovejoin`'s docs. The connector lane edits other shapes there. The `SwapLovejoin` line sits a few lines after `SessionOutSummary`'s end, so check that merge.
4. **`Lovejoin.tsx`:** I didn't touch the share lane's `mixOffer` and `tailReserveOf`, nor the Mix form's call to them. My edits are:
   - `Chains`;
   - `AgainActions`' first line;
   - the hub's view, page and list;
   - `keptPage`;
   - `PoolPage`'s `onRunOver` and its BringAllBack's `onOver`;
   - `UNUSABLE`'s comment;
   - the header comment.
5. **The new file's seam** finds the hub's view by the states before it. If a lane adds a `useState` to the hub between `reading` and `view`, the S2 hub test throws "a seed after … met a state starting …": move `BEFORE_VIEW` with it.
6. **S2's Done** is held only as far as a static render can: the page and its BringAllBack stay. An e2e of a retired token pool's page through Bring every box in this pool back now, its Done staying, would close it. It belongs beside the e2e lane's tests-e2e#2.
7. **W11**, the glossary row for "retired", is in no lane's list.
8. **W6's round:** `lj.unusable.warn.retired` (above) joins the values W6 already lists.

## Checks run

- **`npx tsc --noEmit -p .`:** clean, at the head.
- **Every reachable test file, at the head.** 71 files: the 70 at the base, and the new one.
  - `npx vitest run <71 files> --maxWorkers=2`: **3 failed | 1326 passed** (1329).
  - `VITE_ENABLE_MAINNET=false npx vitest run <71 files> --maxWorkers=2`: **3 failed | 1326 passed** (1329).
  - In both, the 3 are `lovejoin-1-5-0`'s: its 2 by-design head-start tests, and the plain case that *For the lead*'s item 1 updates.
  - The 71 include the i18n and words files: every `tests/i18n*.test.ts`, `tests/words.test.ts` and `tests/worker-words.test.ts`.
  - The list is `…/scratchpad/screens-fix/all-files.txt`.
- **The lane's files at the head:** `npx vitest run tests/lovejoin-screens-review-fixes-1-8-0.test.ts tests/screens.test.ts tests/i18n-worker-reasons.test.ts`: **132 passed**.
- **The first commit alone** (`737bdf11`): 14 files, the words, swap and i18n ones, **323 passed**.
- **The 24 revert checks and mutants:** each caught (`…/screens-fix/mutants-final.log`). W7's renamed key too: caught with the fix, passing without it (`…/screens-fix/mutants-w7.log`).
- No network, no build, no formatter, no Playwright, and no git command outside the worktree.
