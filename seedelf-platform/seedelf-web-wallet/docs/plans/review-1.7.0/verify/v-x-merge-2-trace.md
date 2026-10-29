# v-x-merge-2-trace: x-merge#2

**Verdict: confirmed. Severity: low (ux and docs).** Every claim holds on HEAD (`6bca8bec`). A scratch test following #337's own setup, a site's session, shows it. One thing the finding leaves out lowers the harm without refuting it: the session's own page tells the truth right after the skip.

## The path, traced on HEAD

- **Where the button is offered.** In four places:
  - a swap that runs itself (`Swaps.tsx:2513`);
  - a session brought back by hand (`Swaps.tsx:2567`);
  - a site's session (`SiteSessions.tsx:410-418`, which calls `onRefresh()` after the skip);
  - a mix's card on the Lovejoin page (`Lovejoin.tsx:2586`). Its `mixes` are `all.filter((x) => x.mix)` (`Lovejoin.tsx:1706`), and every mix session has `auto` (`sessions.ts:2175`).
- **What the skip does** (`skipCollateralMix`, `sessions.ts:5526-5538`):
  1. It calls `tailOver`.
  2. If a chain is still being sent, it calls `pump`. There `witnessTail` throws `lj.tail.skipped` (`sessions.ts:5144`), and pump's catch writes `s.chain.stopped` and `chainEnded(network, id, why)`, which becomes the Lovejoin chain record's stop reason.
  3. It calls `advance(…, true)`, whose `step` starts with `if (!s || !running(s)) return;` (`sessions.ts:3445`).
- **Why nothing sends the return for these sessions.**
  - `running` is `!!s.auto && !s.closedAt && !s.auto.paused && !s.auto.failed` (`sessions.ts:1230-1232`).
  - A site's session is recorded with `site: { origin }` and no `auto` (`sessions.ts:1983-1990`). `byHand` is `!s.auto && !s.site && !s.mix` (`sessions.ts:1213-1215`).
  - `runAll`, for sessions that aren't running, only pumps a pending chain and settles returns (`sessions.ts:3367-3376`). Its own comment names these "a session nothing steps (a site's, a hand-run swap, a paused one)".
  - So nothing builds or sends the rest's return.
- **This is by design.** The skip's doc comment says "a swap's return goes by itself; one brought back by hand is offered on its page". The worker is right: a by-hand session sends only after a review. The words are what's wrong.
- **#337's own test** is a site's session ("A site's session holding `lovelace`…", `lovejoin-planner.test.ts:1331`). It builds the return by hand after the skip (`const back = await sessions.backBuild("preprod", 0);`, `:1825`).

## Scratch test (`tests/zz-review-v-x-merge-2-trace-1.test.ts`, run alone, deleted)

I used #337's setup. A site's session's chain is held at its collateral's mix with giveme.my answering 503, and the deposit's time is moved back by `TAIL_OFFER_MS`. I also listed the deposit's box and change, so a return could be built.

1. **FACTS: passed.**
   - Koios submissions: 3 before the skip, 3 after. The chain's own return was never sent.
   - The record's txs are `out,deposit,mix,deposit`, with no `back`.
   - The view's `stage` is `"open"`, and `collateralHeld` is gone.
   - The session's chain `stopped` is "You brought the rest back without waiting for the collateral's mix, so the chain stopped there."
   - The site page's *Through Lovejoin* row (`chainText(s.chain, !s.auto)`): "Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back".
   - The Lovejoin page's Chains row for session 0 has the same `stopped`. Its detail reads: "Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there. Mix my boxes again mixes the boxes it didn't."
   - Three alarm runs (`runAll`) later, still nothing was sent, and the Chains row still says it.
   - `backBuild` then gives a direct review (`collateralTail` and `lovejoin` both undefined).
2. **FAILS ON HEAD IF REAL: failed** with `expected 3 to be greater than 3`. A site's session's rest is not sent within the skip.
3. **AUTO, for contrast: passed.** I gave the same record an `auto`, standing in for a swap's or a mix's. The skip then sent exactly one new transaction, a `back`, within the RPC. giveme.my wasn't asked again, and `stage` was `"returning"`.

## What the finding leaves out

None of this refutes it, but it narrows the harm.

- **The page where the user pressed the button tells the truth.** Right after the skip, the site's page (after its `onRefresh`) and the by-hand page both show "Stopped after N of M transactions; the rest stays at the account until you bring it back" (`LovejoinReturn.tsx:115-117`, `SiteSessions.tsx:406-408`, `Swaps.tsx:2376-2377`). *Bring it back* is in the foot. So the scenario's "assumes the money is on its way" is contradicted on that same page.
- **flows.md already has the rule for a site's session.** `flows.md:494` (*Any site*) says: "When its chain through Lovejoin stopped partway, what's left stays at the account until Bring it back sends it, directly (independent review L23)". Line 522's "and the rest comes back directly" agrees with it only if "directly" means "not through Lovejoin". But 522 names "a site's" page among the places the button appears, and it doesn't say that a site's session waits for *Bring it back*. #337's PR description says the same, flatly: "The rest comes back directly".
- **No money is at risk.** The rest stays at the one-time account, and *Bring it back* builds a direct return for it.
- **The inaccurate stop reason shows in the by-hand case.** In the auto case the return goes within the RPC, `restBack` marks the chain carried (`carriedOf`, `lovejoin.ts:1987-1997`), and its Chains row goes. Where the reason still shows (the mix card's detail), it is accurate. For a site's or by-hand session, the Chains row keeps "You brought the rest back…" until the user sends *Bring it back*.
- **A paused auto session** also fails `running()`. But `Refused` and `PriceMoved` are thrown only on the order and cancel paths (`sessions.ts:3943-4026`), so I don't see a paused session that is held at its tail.
- **The test gap is real.** The skip's only worker test is the site's. Nothing tests the auto path, though in my stand-in it works.

## The words that mislead in the by-hand case

1. The button "Bring the rest back now" and its line ("Bring the rest back without it, and …"), on the site's page and the by-hand page. Pressing it brings nothing back there.
2. `lj.tail.skipped` (en, es and ja all say "you brought the rest back"), in the Lovejoin page's Chains row (`Lovejoin.tsx:963-966`).
3. `flows.md:522`'s "and the rest comes back directly", read on its own.

`lj.tail.skipped` and `lj.tail.wayOut` are machine drafts (not in `critical-keys.json`). `lj.tail.privacy.wayOut` is critical: changing it needs a blind back-translation.

## Fix advice (the words are the owner's call)

- **flows.md:522:** "…and the rest comes back directly: by itself for a swap or a mix; for a site's session or one brought back by hand, at Bring it back, as a chain stopped partway does (L23)."
- **`lj.tail.skipped`:** a neutral reason, for example "The collateral's mix was given up, so the chain stopped there." It's a machine draft, with es/ja provenance.
- **Or the owner's call** (my idea, not a defect fix): on by-hand pages, open *Bring it back*'s review right after the skip. The label becomes true, and the review-before-send rule still holds.
- **Tests:**
  - A by-hand skip sends nothing, and its page row says the rest waits.
  - An auto skip sends the return within the RPC, with no `collateralTail` and giveme.my not asked again.
