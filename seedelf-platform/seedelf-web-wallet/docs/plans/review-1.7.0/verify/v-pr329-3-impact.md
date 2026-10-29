# v-pr329-3-impact: pr329#3, impact and the fix

**Finding:** archiving chunk 34's plan dropped open items its sessions left, and *Kept in mind* doesn't carry them (pr329, rated low).

**Verdict: confirmed. Severity: low**, as rated. Confidence: high.

- **The carry gap is real.** Seven of the eight items are still open on HEAD `6bca8bec`. Item 1, the most consequential, still runs as a user path: a scratch test reproduced it.
- **Item 6 is not open work.** The plan had already decided it at :1347 ("a correction, kept").
- **The fix is right but should be trimmed:** five bullets and one reworded pointer, not eight bullets. The db-sync item needs the owner's answer, not an inference.

## What the docs promise

The docs promise completeness in three places:
- **The plan's status line** (`archive/plans/chunk-34-token-pools.md:9`): "its open items carried into post-release-roadmap.md's *Kept in mind* (*Left by 1.6.0's release review* and *Left by chunk 34's sessions*)".
- **`plans/README.md`:** "anything still open goes into post-release-roadmap.md's *Owed* or *Kept in mind*".
- **`archive/plans/README.md`:** "**Don't build from it.** … what's still open is in post-release-roadmap.md's *Owed* and *Kept in mind*".

#329's description says the same: "Before the move, the plan's open items went into *Kept in mind*".

Neither the plan nor that section has changed since #329:
- `git diff d67f8054 6bca8bec` of the plan is 0 lines.
- Since #329, the roadmap changed only the list's ticks and items 2, 3, 4 and 8's entries. Nothing under *Left by chunk 34's sessions* (:391–:403) changed.
- **#338** (the user's note: docs only, item 8's text) touched :42 and :405–:409 alone. It neither fixed nor worsened this finding, and it won't conflict with the fix.

## Item by item, on HEAD

| # | Item | Open on HEAD? | Evidence |
|---|---|---|---|
| 1 | `BadInputsUTxO` at a waiting part's submit stops the rest, with no grace | **Yes, reproduced** | `koios.ts:1219` turns it into `SpentInputError`. `parts.ts:470` `const behind = e instanceof CollateralError \|\| (e instanceof KoiosBusyError && !e.maybeSent);` doesn't count it, so `:474` `stopWaiting(… "refused" …)`. `parts.ts` is untouched in the range. Session 9's commit `565c464a` lists it: "Not fixed, for the owner: … a lagging Koios node's BadInputsUTxO at a waiting part's submit." |
| 2 | Two windows pressing Send on one review free each other's hold | Yes, structurally (not reproduced) | `handlers.ts:221` → `transfer.ts:167` → `sendParts`, with no per-review serialization. Both `splitParts` write one `parts.<first>` reservation (`parts.ts:165–172`, `:218`). The one turned away runs `unsplit`/`letGo`, whose `reserve(…, [])` deletes it (`:252–253`). |
| 3 | The history-first refusal at about 2.5× (about 25 s); "narrowing history's own chain search is the owner's call" | An owner's call, not measured | The shapes harness is release-only and takes a minute, so it wasn't run. |
| 4 | `CollateralTail` repeats core's `Tail` | Yes (trivia) | `wasm/src/lovejoin.rs:185` `{ deposit, mix, leaf }` against `seedelf-core/src/lovejoin/mod.rs:2233` `{ deposit, mix, leaf }`. It's a refactor note "for the builder extraction". |
| 5 | Below the floor, Mix again refused with "Try again later"; a copy may never fill. Also R2-1's aside | Yes, both | `lovejoin.ts:3352` `seedable ? POOL_BOOTSTRAP() : t("lj.tryLater")`. Copies refuse new boxes (`:3912` `"superseded"`). The range's diff of `lovejoin.ts` touches neither. The aside still holds after #336: a second `refresh()` returns early on a recent `asked` while the first's `index.pools()` is in flight (`lovejoin-pools.ts:415`), `answered` is set only after it returns (`:432`), and `look()` then scans Koios's holder (`:395–396`). The cost: a holder read on Koios, which is public data, so only Koios's budget is spent. |
| 6 | The classic-only list lost "on a swap's page, step 4's corrected words" | **No: not open** | Plan :1347 says: "This changes words a classic-only user sees on a swap's page: a correction, kept." Only the record of what changed is incomplete. |
| 7 | The owner's live db-sync tests (`live_lovejoin`) | Unknown: the owner's answer | Not dropped from every live doc. `roadmap.md:61` keeps "**Before the merge:** the owner's live db-sync tests", and its "Done that way" (`:63`, #325) names the merge, the deploy, the curls and the package, but not the tests. Nothing in the tree, and nothing in the owner's notes, says they ran. |
| 8 | Session 5's open questions | Reachable, but labelled wrong | `:403` names "Session 5's", but as "calls Claude made … 'yours to overturn'". Sessions 9, 10, 10b and 11 label their lists that way; Session 5's (:1259) is "For the owner, from session 5", mostly questions. **One has been settled since:** the policy's date (Session 12's call 1, 26 October 2026). **Still open:** L5's "Say so at review, or accept?"; a private-paid withdraw never signed by the real giveme.my; and :1255's Change's list and the stuck callout. |

**"Dropped" overstates items 1–4 a little.**
- Items 1–3 are in Session 9's section; item 1 and item 2 sit in its *Not fixed*, right after its calls. Item 4 is in Session 11's section. `:403` names both sessions.
- So each is one hop away, but behind a label that says "calls". A session looking for open work has no reason to follow it: the archive's README says not to build from the plan, and the plan says its open items were carried.

## Reachable in practice?

**The docs scenario: yes.** A session choosing 1.8.0's work follows the archive README to *Kept in mind*, and these items aren't there. Nobody planned this carry either: unlike pr329#0's ticks, without the finding the release-prep commit wouldn't do it.

**The code scenario (item 1): yes, as an edge case.**
- **Where it happens:**
  - on preprod, which reads Koios alone;
  - on mainnet with Settings' Koios-only on;
  - on mainnet when the data layer's submit part is down, so the submit goes to Koios's gateway, whose backends trail one another.
- **Where it's unlikely:** mainnet's default path. The feed that shows the parent and the node that takes the submit are both the data layer's (home's), and db-sync trails the node.
- **What the user sees:** nothing is lost. What didn't go stays in the private balance with its hold freed. Home says the payment went "only partly", and a funding goes short with *Bring it back*.

## Severity: low

- **Why low:** on the brief's scale this is "a misleading doc". The docs claim three times that the carry is complete, and that's false for five live items. One of them (1) was reproduced as a user path on HEAD.
- **Why not higher:** nothing shipped changes. No user, site or attacker reaches it through the docs. Each item is an edge case, an owner's call or an owner's step, and none blocks 1.7.0.
- **Why not nit:** this is lost backlog, not wording.

## The fix: right, trimmed

**Where.** In the release-prep docs commit on `web-wallet/release-1.7.0`, together with pr329#0's ticks. That follows the owner's rule that ticks go in one docs commit, after #330–#332's adjacent lines conflicted. Edit the roadmap only, never the archived plan: once the carry is complete, the plan's :9 becomes true.

**Five bullets under *Left by chunk 34's sessions*** (drafts, short, each with where it came from):
1. **A waiting part that a Koios backend behind turns away** (Session 9's *Not fixed*): a `BadInputsUTxO` at its submit stops the rest at once, while giveme.my's lag is waited out for `GIVEME_BEHIND_MS`. What didn't go stays private, and Home says only part was sent. It happens on preprod and with Koios-only, since on mainnet the feed and the submit are both the data layer's.
2. **Two windows pressing Send on one review at the same moment can free each other's hold** (Session 9; older than 1.6.0). Both hold the payment's one reservation, and the one turned away lets it go.
3. **The history-first planner's slowest refusal takes about 2.5× (about 25 s)** where histories reorder the UTxOs (Session 9's cross-area review). Narrowing history's own chain search is the owner's call.
4. **Mix again below the floor says "Try again later" only once it's pressed**, in any pool, and a copy below the floor may never fill (fix round two's *Left open*; with D2). Aside: the hub's look can race the status read into a Koios read of the holder on mainnet (R2-1). The data is public, but it spends Koios's budget.
5. **The live db-sync tests** (`live_lovejoin`, the owner's; 34c, Session 12): nothing records that they ran before 1.6.0's merge. **Ask the owner, never infer it.**
   - If they ran, the answer goes into 1.6.0's handoff note (`roadmap.md`'s *Done that way*), which is the record of what happened.
   - If they didn't, the bullet stays. They are the only check of the server's Lovejoin queries against real db-sync, including 321-lj-rust-data#0's resume.

**The pointer (:403).** Add "and Session 5's open questions: whether to say so at review when a return's pool turns stuck after it (L5); a private-paid withdraw never yet signed by giveme.my; Change's list and the stuck callout."

**Items 4 and 6.** Don't make bullets of them.
- Item 6 is optional: put "and, on a swap's page, step 4's corrected words (kept)" back into :397, so the list is complete as a record.
- Item 4 can be skipped. The builder extraction is tracked in CLAUDE.md, not the roadmap.

**Within the owner's rules:**
- docs only, with no guard and no refusal;
- no privacy note touched;
- no release date or store status: "before 1.6.0's merge" names a commit, not a date;
- "Seedelf" written by hand, since `words.test.ts` scans only `src/`.

**Code fixes the bullets may name** (the owner's to pick, none of them a refusal):
- **Item 1:** read a `SpentInputError` within `GIVEME_BEHIND_MS` of the parent showing as "behind", as a `CollateralError` is. `sentBefore` already covers "went already", so the worst case is a 3-minute wait before the same stop. Each pump in that window costs one more submit, and giveme.my is asked again, as a `CollateralError` retry asks it today.
- **Item 2:** don't free a hold that another Send of the same payment owns.

**What else the fix changes:** nothing shipped, and no test. No test reads these docs: `activity.test.ts` mentions the roadmap only in comments, and `words.test.ts` scans `src/`. It doesn't touch #338's lines.

## Repro

**The test:** `extension/tests/zz-review-v-pr329-3-impact-1.test.ts`, run alone (`npx vitest run …`). It mirrors `payment-parts-chain.test.ts`: test wallet A's shape on preprod, 12 bundles at exactly their least plus one big UTxO of ADA, which gives a chained payment. The first part went, then the parent shows (`confirmations = 1`, the later parts `missing`).

**3 passed of 3:**
1. **Control: giveme.my behind** (400 "input not found"). The rest keep waiting: `{ sent: 1, total }`, with the waiting copy kept.
2. **Control: no refusal.** The same pump submits part 2, and nothing is stopped.
3. **Claim:** the fake Koios answers part 2's submit with a `BadInputsUTxO` body (`rejectSubmit`).
   - At once, with no time passed: `{ sent: 1, total, stopped: "refused" }`.
   - The waiting copy is removed and the reservation freed, so 0 inputs are held.
   - The next pump returns false and submits nothing more.

Item 1 is therefore live on HEAD, and only the refusal decides it.

The file was deleted afterwards. `git status` shows only the untracked review folder and another agent's `zz-review-v-pr329-3-trace-*.test.ts`.

## Trace

- **Reads:** the plan :9, :654–655, :910–918, :983, :1033, :1087, :1102–1106, :1238–1265, :1337–1376; the roadmap :331–:410; `roadmap.md:61–63`; both READMEs; #329's description (`gh pr view 329`).
- **Code:** `parts.ts` 160–260, 404–480 and 615–660; `koios.ts` 1150–1260; `transfer.ts` 150–170; `handlers.ts` 215–232; `lovejoin.ts` 3330–3360; `lovejoin-pools.ts` 384–520, and #336's diff of it; `wasm/src/lovejoin.rs` 178–200; core `lovejoin/mod.rs` 2225–2245.
- **Git:** `git diff`, `git log` and `git show` of the range, read-only. The owner's memory notes were read for any record of the db-sync run, and none was found.
- **Not done:** no network, no Rust build, no db-sync.
