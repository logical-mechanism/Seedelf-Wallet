# v-pr329-3-trace: pr329#3, archiving chunk 34's plan dropped open items its sessions left

**Verdict: partly. Severity: low** (docs; the one behaviour gap it names is low too). Confidence: high. Checked on HEAD `6bca8bec` with three scratch tests, all deleted.

**What holds:** the core claim and the scenario.
- #329 says the plan's open items were carried. So do the plan's status line (:9, "its open items carried into … *Kept in mind*") and the roadmap's new entry (:391, "the plan's *For the owner* lists and its sessions' notes, moved here").
- `plans/README.md` makes that the rule ("anything still open goes into … *Owed* or *Kept in mind*"). The archive's README tells readers "Don't build from it", because "what's still open is in" the roadmap.
- Five of the eight items are still open on HEAD and appear nowhere live: 1, 3, 4, 5a and 5b.
- The scenario's own example happens exactly as described. A test shows it.

**What's narrower:** of the other items, 8 is reachable but mislabelled, 6 is a nit, 7 is a different defect, and 2 doesn't reproduce on HEAD.

The plan is byte-identical between #329's merge and HEAD (`git diff --stat d67f8054 6bca8bec` on it is empty). #338, as the user says, changed only item 8's line (:42) and the Leios entry (:405–409), none of this.

## Item by item, on HEAD

| # | Plan | Open on HEAD? | Carried? |
|---|---|---|---|
| 1 | :1105 BadInputsUTxO at a waiting part's submit | **Yes**, test below | No |
| 2 | :1106 two windows free each other's hold | **Not reproduced** | No |
| 3 | :1087 history-first refusal ≈2.5× (≈25 s), "the owner's call" | Yes: code unchanged, call never recorded | No |
| 4 | :1033 `CollateralTail` repeats core's `Tail` | **Yes** | No |
| 5a | :1348 below the floor, Mix again → "Try again later"; a copy may never fill | **Yes** | No (D2 is the design question, not this) |
| 5b | :1348 the hub's look races the status read into a Koios scan | **Yes**, by reading | No |
| 6 | :1373 "on a swap's page, step 4's corrected words" | Not open: "a correction, kept" (:1347) | Dropped from :397 (a nit) |
| 7 | :983 the owner's live db-sync tests | Unknown; #329 itself says it happened | No (different defect) |
| 8 | :1255, :1259–1265 Session 5's questions | Yes | Only through :403's pointer, mislabelled |

### 1. A lagging Koios's BadInputsUTxO stops the rest at once

**The path:**
1. `koios.ts:1219` turns a submit answer containing `BadInputsUTxO` into `SpentInputError`.
2. In `pending.ts:479-492`, `submitWatched` asks whether the part itself landed (`lookFor`). It didn't, so it takes the write-ahead back and rethrows.
3. In `parts.ts:470-471`, `step` waits only when `const behind = e instanceof CollateralError || (e instanceof KoiosBusyError && !e.maybeSent)`.
4. Otherwise, `parts.ts:473-474` checks `sentBefore` and then calls `stopWaiting(… "refused" …)`. That removes the waiting part's copy and frees its reservation.

**The test** (`zz-review-v-pr329-3-trace-2.test.ts`) uses `payment-parts-chain.test.ts`'s harness: 12 bundles, 2 parts. The first part went, then its parent showed.
- **Control, passed:** giveme.my refuses within `GIVEME_BEHIND_MS`. The result is `{sent:1,total:2}`, so the rest still wait.
- **Control, passed:** a 429 at the submit gives the same result.
- **Claim, failed:** the submit answers BadInputsUTxO in that same moment. The result is `{sent:1,total:2,stopped:"refused"}`, at once.
- **Claim, failed:** the backend catches up, and the next pump runs after `LOOK_EVERY_MS`. The part's copy is gone (`kept: false`), and part 2 was submitted once only, never again.

**Reach:**
- Mainly Koios's path: preprod, or mainnet with Koios-only on or the data layer's submit down. Koios's backends lag each other, which the roadmap itself allows for (:362).
- On mainnet, the parent shows through db-sync, which runs behind home's node, so a lag there is unlikely.
- No money is lost. What the rest would spend stays in the private balance, and Home says "only partly sent".

**In the docs:** `architecture.md:172` describes only the giveme.my and 429 grace, and names no gap.

### 2. Doesn't reproduce: the two-window trigger can't hold one review

- Each window builds its own review under the same key (`SESSION_TRANSFER = "seedelf.transfer.built"`, `transfer.ts:53`), and the newer build overwrites the kept copies.
- So the older window's `sendParts` sees `first.txHash !== txHash`, which leaves `hashes = [txHash]`.
- `splitParts` then returns at once for one part, `send` throws stale, and `unsplit` returns at once too. The hold is never touched.
- 1.6.0's review found the same. x-scenarios-sessions#2's skeptic, in `FINDINGS.md` at `7e2d89ed`: "A review isn't shared between the popup and the side panel. Each builds its own."
- No screen re-shows a kept review. `NO_ANSWER` (`ui/background.ts:68-73`) comes only from a port disconnect, when the worker is gone, so one page can't overlap two Sends either.

**The test** (`zz-review-v-pr329-3-trace-3.test.ts`) passed both cases:
- **Two windows' reviews sent at once:** the older is refused ("That payment isn't ready to send. Review it again."). The newer goes, and its hold stays: 6 inputs reserved, the record and the copy kept, `{sent:1,total:2}`.
- **One review sent twice at once,** which no screen reaches: the same, with the hold intact.

The plan's line is a stale record, not an open item.

### 3. The history-first refusal's cost

- `by_history_first` (`wasm/src/lib.rs:3839`) last changed in `565c464a`, Session 9's own round.
- Since then, only fix round 1's Max `leftWhy` lines touched that area.
- "narrowing history's own chain search is the owner's call" appears only in the archived plan (`git grep` on HEAD). Nothing in the 1.6.0 review's folder decides it.
- I didn't re-measure the 25 s.

### 4. `CollateralTail` repeats `Tail`

- `wasm/src/lovejoin.rs:185-190` is `pub(crate) struct CollateralTail { deposit, mix, leaf }`, the same fields as core's `pub struct Tail` (`seedelf-core/src/lovejoin/mod.rs:2233-2238`).
- `build` copies them one by one (`:228-232`: `Ok(CollateralTail { deposit: tail.deposit, mix: tail.mix, leaf: tail.leaf })`).
- It's a refactor note "for the builder extraction". Low value, but open.

### 5a. Mix again below the floor

- Both Mix again paths call `this.floor(network, split.others.length)` with no `seedable`: `againBoxes` at `lovejoin.ts:3306`, and the public one at `:4491`.
- `floor()` throws `… t("lj.tryLater")` (`:3352`).
- The page turns Mix again off only through `againRefused` (`Lovejoin.tsx:1262`, `:1575`), never on the floor. Its own comment (:1571) says the worker takes it "under the floor … as anywhere".
- A copy takes no new box, so it can't fill, and "later" never comes. That case is dormant on mainnet, which has no token pools.
- D2 (:402, carried) is what replaces the floor as the gate. It isn't this UX consequence.

### 5b. The hub's look racing into a Koios scan

- While the pool read's `refresh` (`serviceDeps.pools`, `lovejoin-pools.ts:598`) waits on `lovejoin/pools`, `asked` is set and `answered` isn't.
- The hub's `look` (`lookForPools` → `discovery.look`, `sw.ts:247`) runs `refresh`, which returns early at `:415` (`if (!this.answered.has(network) || …) return;`). `look` then finds no `answered` and calls `scan` (`:396`), Koios's holder, on mainnet.
- It asks only about Lovejoin's public holder, so it's a cost to Koios's budget, not a privacy leak.

### 6. A nit

- Plan :1373 lists step 4's words among what a classic-only user sees differently.
- :1347 had already decided them: "This changes words a classic-only user sees on a swap's page: a correction, kept."
- The carried bullet (:397) is incomplete as a list, but nothing is open unless the owner wants to overturn it.

### 7. Different: not a dropped item, but a "done" with no record

**Nothing records the run:**
- #324's *Before* (body :90) asks for `cargo test --test live_lovejoin`.
- `roadmap.md:61` still lists them under "**Before the merge:**".
- #325's "Done that way" (`roadmap.md:63`) names the merge, the deploy, the four curls, the package and e2e, not these tests.

**But #329 says they happened.** Its own *Done* line (plan :916) reads "every step this section names happened", and the *Next* it frames (:918) names "The owner's: the live db-sync tests".

So either they ran and nothing is open, or #329's line is wrong. That's the owner's to say. The fix is to record the outcome in 1.6.0's handoff note, not necessarily to carry an item.

### 8. Reachable, but mislabelled

**The pointer (:403):** "The calls Claude made along the way (Session 5's, …), each 'yours to overturn', are in the plan under each session."
- Session 5's calls 34–36 were the owner's (:1240).
- Its *Left, for the owner* (:1255) and *For the owner, from session 5* (:1259–1265) are open questions:
  - L5's "Say so at review, or accept?";
  - Change's list not marking a stuck pool until it's chosen;
  - the callout not saying Bring one back comes with a box;
  - a mix's review dropping its whole hint;
  - a private-paid withdraw never sent live.
- Nothing later settles them. The plan and 1.6.0's `FINDINGS.md` have no later mention.
- The roadmap tracks the same kind of "never run live" item elsewhere (:430, :439).

## Repro

**Test 1, `zz-review-v-pr329-3-trace-1.test.ts`** (the docs): it searched the whole roadmap plus architecture, flows, privacy, development and keys-and-accounts, not only *Kept in mind*. **4 passed, 9 failed.**
- **Controls (passed):**
  - the rule in `plans/README.md` and the archive README;
  - the two "carried" claims;
  - six carried items found (R11, MERGED-1, D2, *parts-details-first-only*, *four-switch-classic-bend*, the stopped-parts banner);
  - each quoted plan line present word for word.
- **Claims (each failed, one per item 1–8, 5 split in two):** nine specific patterns found nowhere. For example, `/lagging Koios|BadInputsUTxO…waiting part/` and `/repeats core's \`Tail\`/`.

**Test 2, `zz-review-v-pr329-3-trace-2.test.ts`** (item 1): **2 passed (controls), 2 failed (claims)**, as above.

**Test 3, `zz-review-v-pr329-3-trace-3.test.ts`** (item 2): **2 passed**, so the finding's item 2 doesn't hold.

All three were run alone and then deleted. `git status` shows only the review folder and other agents' `zz-review-v-pr330-*`.

## Fix advice

**Under *Left by chunk 34's sessions*, add:**
- **1:** "A waiting part refused at submit as an input already spent (BadInputsUTxO), seconds after its parent shows, stops the rest at once: only giveme.my's refusal and a 429 get `GIVEME_BEHIND_MS`. A lagging Koios backend does this; what the rest would spend stays private. Treating `SpentInputError` as behind within that window would close it" (Session 9).
- **3, as an owner's call:** the history-first refusal costing about 2.5× (≈25 s); narrowing its chain search.
- **5a:** Mix again below the floor says "Try again later", forever in a copy.
- **5b:** the hub's look and the pool read racing into a Koios holder scan on mainnet.
- **4, optional:** in the builder extraction's own list, since it's a code note.

**Don't carry:**
- **Item 2:** it doesn't reproduce on HEAD, and the plan's line stays as the record.
- **Item 6:** a nit. Add "and, on a swap's page, step 4's corrected words (a correction, kept)" to :397 if the list is meant to be whole.

**Item 7:** ask the owner, then record the outcome in 1.6.0's handoff note (`roadmap.md:61`'s "Before the merge"). If they didn't run, carry the run, and narrow plan :916's "every step … happened".

**Item 8:** split :403. Keep "the calls Claude made" for Sessions 9, 10b, 10 and 11, and name Session 5's as open questions, or carry the four above with "a private-paid withdraw never sent live (no stuck pool on preprod)".
