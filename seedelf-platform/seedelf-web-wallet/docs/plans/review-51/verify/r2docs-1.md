# r2docs#1: verification

From lane R2docs, graded low by its finder.

## Trace: confirmed, low

flows.md:478, added this round in fc6a0aa1, says a stranger's later return "never changes what the page says of how the swap's own came back". The fix (fdd3b8b2, G4) protects only the skip reason, `lovejoinSkipped`. Two readers of the finished swap's page still follow the latest return, and the fixer's G4.md lists both as "Named, not changed".

1. **The step's link.** The last step, "Back in your private balance", links `tx("back")`, which is `findLast` over the view's txs (Swaps.tsx:3121, :3208).
   - The view keeps every return that went (sessions.ts:6009). No record or view field marks a strangers-only return.
   - So once a stranger's payment comes back, the step's Cardanoscan link opens the stranger's return, not the swap's. The fix's own test reaches exactly that state: swap-page.test.ts:252 has txs [out, swap, back, back], and :258 has the swap closed.
2. **The step's words.** When the stranger's return goes as a Lovejoin chain, sendChain writes `s.chain` (sessions.ts:5359) before its `if (strangers) return;` (:5361).
   - backStepText reads `s.chain` (Swaps.tsx:3103), and a stopped chain's `stopped` is written on whatever `s.chain` is by then (sessions.ts:5499).
   - So a swap whose own chain finished can read "Stopped after 1 of 3 transactions; the rest comes back directly".

**Narrowing:**
- In the common case, a stranger's direct return (roughly 1.6 ₳ or more, per verify/e2b-2.md), only the link changes. The words, the skip callout and the Received label hold.
- The words change only through a strangers' chain, which needs three things:
  - the stranger's rows include a UTxO of exactly 5 ₳ in ADA alone, with no datum and no script (`collateralFits`; sessions.ts:4786-4803, :4727-4735);
  - the swap's return goes through Lovejoin (`!auto.direct`, :5064);
  - the swap's own return left no skip reason, because backStepText reads that first (:3101).
- Extra reader the finder didn't name: the Received row's label (Swaps.tsx:2424) also reads `s.chain`. After a direct return of the swap's own, a strangers' chain turns it into "Received, besides its boxes in Lovejoin".

**Grade: low, as the finder had it.**
- Who: a stranger, who must pay the user real ADA inside the window before the session closes.
- Cost: no money moves. The Received total and Activity are right, and the error is in a finished page's account of the swap.
- The wrong doc sentence alone would be a nit. It's low because it hides a page error a stranger can cause, the unfinished part of e2b#2's class (e2b#2 was itself low).

**Evidence:**

FIXTREE = /home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes at HEAD 853d5779. `git status --short` shows only lovejoin.ts and test files modified. flows.md, Swaps.tsx, sessions.ts, LovejoinReturn.tsx and en.json have no working-copy diff. Everything below is read from HEAD (lovejoin.ts through `git show HEAD:`).

**The doc**
- flows.md:478 (git blame: fc6a0aa1; the round's diff adds the clause): "…with a **Received** row: what its return brought back at once, as that return's review said (a chain's boxes come later), and every later return's beside it, such as what a stranger paid the account before it closed; that one never changes what the page says of how the swap's own came back (chunk 51, e2b#2)."
- flows.md:479: "Each step's transaction is on Cardanoscan…"

**What the fix keeps**
- sessions.ts:5241: `const skipped = built.strangers ? undefined : built.lovejoinSkipped;`
- sessions.ts:5243-5245: `after: (s) => { if (skipped && !s.mix) s.lovejoinSkipped = skipped; }`
- sendChain's update, in order:
  - :5359 `s.chain = { total: txs!.length, last: txs!.at(-1)!.txHash, at: this.deps.now(), ... };`
  - :5360-5361 `// A return of strangers' alone, after the session's own, leaves the word on how that came back as it is (e2b#2). if (strangers) return;`
  - :5362 `delete s.lovejoinSkipped;`
- So `s.chain` is replaced and only `lovejoinSkipped` is kept.

**The link**
- sessions.ts:6009: `const txs = s.txs.filter((t) => (t.kind === "out" || !t.unsent) && !t.replaced);`
- RecordedTx (sessions.ts:307) has no strangers field. `grep -c strangers` gives 0 in both Swaps.tsx and rpc.ts.
- Swaps.tsx:3121: `const tx = (kind: SessionTx["kind"]) => s.txs.findLast((t) => t.kind === kind);`
- Swaps.tsx:3205-3209: `{ title: tr("swaps.plan.back"), sub: backStepText(s), tx: tx("back") }`
- Swaps.tsx:3237-3238: `{step.tx && st === "done" && (<ExplorerLink network={network} tx={step.tx.txHash} ...`
- When closed, autoView gives step "done" (sessions.ts:6688), so `at` is 4 and step 3's state is "done": the link shows.
- tests/swap-page.test.ts:230-260 (the fix's own test) drives the real runner. At :252, `view.txs.map(kind)` equals `["out","swap","back","back"]`, the last being the stranger's 2 ₳. At :258 the stage is "closed".

**The words**
- Swaps.tsx:3101-3103:
  - `if (s.lovejoinSkipped) return t("swaps.step.directLeftOut");`
  - `if (auto.direct) return t("swaps.step.directChosen");`
  - `if (s.chain) return s.chain.cut || s.chain.stopped ? chainText(s.chain) : t("swaps.step.throughLovejoin");`
- sessions.ts:5498-5499, when a chain stops: `if (s.chain) s.chain.stopped = why;`
- chainView (sessions.ts:6664-6675) works out `cut` from that chain's own `at` and `last`.
- LovejoinReturn.tsx:117-119 and en.json:
  - lovejoin.chain.stopped: "Stopped after {{sent}} of {{total}} transactions; the rest comes back directly"
  - lovejoin.chain.cut: "…; what was left came back directly"

**A strangers' chain is reachable**
- sessions.ts:4706-4711: `apart` is `{ strangers: true }` when the session isn't a site's, one of its own returns went, and no row is `own` or a fill.
- It is spread into all three chain results: :4774 (tailChain), :4895 (lovejoin.chain) and :4983 (collateral tail).
- throughLovejoin for a swap returns `!s.auto.direct` (:5062-5065).
- chainSoFar (:1339-1347) counts a finished chain of a non-mix session as not started, so the Lovejoin branch at :4779 runs again.
- It needs a collateral: `rows.find(collateralFits)` (:4786-4788). collateralFits (coin-control.ts:189, :198) is exactly 5 ₳ of ADA alone, with no script and no datum. Without one, :4792-4803 sets a reason and the return goes back directly.

**Also reads s.chain**
- Swaps.tsx:2424: `label={tr(s.chain && !s.chain.cut ? "swaps.rows.receivedBesides" : "swaps.rows.received")}`
- sessions.ts:6074 (collateralHeld).

**Named, not fixed**
- fixes/G4.md: "Named, not changed: the swap page's timeline links its return step to the latest return, which can be a stranger's; … a later chain of strangers' UTxOs alone replaces `SessionRecord.chain`".
- verify/e2b-2.md, Same class: "The Timeline's return step links `tx("back")` = findLast (Swaps.tsx:3093), which points at the stranger's return."
- swap-page.test.ts:196-335 pins only the Received sum and a direct return's skip reason. Nothing pins the link or a strangers' chain.

**Known:** None settles it.

- **backlog.md:** nothing for timeline, Received row, swap page, finished swap, backStepText, lovejoinSkipped, "paid the/its account" or a stranger's payment to a session.
- **archive/plans/:**
  - "timeline" turns up only unrelated items: chunk-15b, chunk-16:379/471, usability-review:630/908, chunk-24:256/273, independent-review L24, chunk-34:1222.
  - Nothing for backStepText, SessionRecord.chain, a stranger's chain, a finished swap's page, or a later/latest/second return.
- **owner-calls.md:** no e2b#2 entry. Its "G4's note" (:39) is about collateralIntoPool only, and e2b#1 (:31) is the mix sibling.
- **INDEX.md:** e2b#2 is the parent. r2still#2 is a different member: a late fill read as a stranger's.
- **Other lanes:** R2money:107 and R2still:172 only note the skip reason's handling.
- **SECURITY.md's out-of-scope list:** nothing applies.
- **fixes/G4.md:** names the code behaviour "Named, not changed". That's a fixer's note from this round, not one of the brief's settled lists, and the doc sentence written after it says the opposite.

**Fix notes:**

**Smallest fix (doc only).** In flows.md:478, keep the Received clause and replace "never changes what the page says of how the swap's own came back" with what the fix actually keeps. Suggested wording: "that one never changes why the page says Lovejoin was left out of the swap's own return". Optionally add: "though the last step's Cardanoscan link opens the latest return, and a chain of the stranger's alone takes the place of the swap's own in that step's words".

**The class.** These are session-level fields the finished page reads as "the swap's own" but which hold the latest return (e2b#2's class). `received` and `lovejoinSkipped` are fixed. Still open:
1. **The Timeline's `tx("back")`** (Swaps.tsx:3121, :3208). Keep a `strangers` mark on that return's RecordedTx, held past `summary`, and pass it through SessionView. Link the last return without the mark, and fall back to `findLast` when every return has it.
2. **`SessionRecord.chain`** (sessions.ts:5359). Give the page the session's own chain in a separate field, for backStepText (Swaps.tsx:3103) and the Received label (Swaps.tsx:2424). Don't simply stop writing `s.chain`: chainSoFar, the stop at :5499, tailChain's `from` (:5358) and collateralHeld (:6074) have to follow the chain actually being sent.
3. **A strangers' chain's continuation** (traced, not run). Once its deposit lands, what's left at the account is that chain's own recorded outputs. `apart` (:4706-4711) then reads them as the session's, so a resumed collateral tail goes through sendChain without the mark, and `delete s.lovejoinSkipped` (:5362) clears the swap's own reason. The mark should be carried through.

The other sibling, e2b#1's `mix.skipped`, is with the owner (owner-calls.md:31).

**Tests.** Extend swap-page.test.ts's e2b#2 tests:
- In the first test (it already reaches [out, swap, back, back]), assert that the Back step's Cardanoscan link carries the swap's own return hash.
- Add a strangers' collateral-tail chain that stops, on a swap whose own chain finished.

**Doc class.** fc6a0aa1's docs pass described G4's fix as wider than G4 made it. Check this round's other "(chunk 51, …)" doc sentences against each fixer's "Named, not changed" list.

**needs_owner:** no. No refusal, no privacy default, no new choice.
