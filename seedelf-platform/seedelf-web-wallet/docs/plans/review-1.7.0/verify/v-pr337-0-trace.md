# v-pr337-0-trace: `pr337#0`, the way out shown where nothing waits for giveme.my

**Verdict: confirmed. Severity: low.** Traced on HEAD `6bca8bec` and reproduced with a scratch test that drives the real worker (since deleted). The scenario only arises when *Bring everything back* has another pick with boxes. The finding says so itself.

## The path, on HEAD

1. **A site's session whose chain stopped at its collateral's mix.** The setup is the planner test's `stoppedAtMix`: giveme.my refused past its wait. The record then has `tail` with `tries: 1`, `landed` set and not `over`, and `ended` set. `tailBuildable` holds, so `tailHeld` returns the hold (`lovejoin.ts:4131` `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`). Up to here the hold is real: the next return through Lovejoin builds that mix again (`sessions.ts:4386`).
2. **Bring everything back.** Its first build for this session is the tail chain (the mix and the return), with no `lovejoin` field, so it has no boxes. On its own, the session gets no switch:
   - `ClaimAll.tsx:286` shows it only for `(boxes > 0 || direct)`;
   - the session's own review hides `LovejoinSwitch` for it (`LovejoinReturn.tsx:375` `if (!back.lovejoin && through) return null;`).

   The switch appears when another pick's return has boxes. Turning it to *directly* calls `claimBuild(…, direct=true)`, which calls `buildBack(…, direct)`. `sessions.ts:4386` `if (started && !direct && lovejoin)` skips `tailChain`, so a plain return sweeps every row, including the deposit's change that pays for that mix.
3. **Sent.** `sendBack`'s plain branch calls `restBack`. That marks only `restBack`, and only for `restOnly` chains, which exclude a chain whose tail box is out (`lovejoin.ts:1972`). Nothing anywhere sets `tail.over`: the only writers are `tailOf`, `tailChain`, `skipCollateralMix` and `recordChain`.
4. **The view.** `sessions.ts:5617` `...(stage !== "closed" && tail ? { collateralHeld: tail } : {})`. A site's session never closes on its return (`sessions.ts:5431` `if (!s.site && last.kind === "back" …`), so the hold stays in the view until `landed + TAIL_KEEP_MS`. `SiteSessions.tsx:411` renders `CollateralHeldWayOut` unconditionally. From `offerAt`, the page shows:
   - the privacy callout "The collateral's mix is still waiting for giveme.my. Bring the rest back without it…";
   - the button **Bring the rest back now**.

   Next to them, *Bring it back* is disabled with "Nothing to bring back: the account is empty." (`SiteSessions.tsx:357`).

## Scratch test `zz-review-v-pr337-0-trace-1.test.ts` (deleted)

It reuses the planner's helpers: a site's session, the real WebAssembly, and the 5 ₳ pool launched in the test. Both cases passed on HEAD, which means the defect is present.

**R1, the finding's exact path, through `claimBuild` and `claimSubmit`:**
- **Before:** `{"stage":"open","chain":{"total":7,"sent":5,"cut":false,"stopped":"giveme.my wouldn't back…"},"collateralHeld":{"offerAt":1800003600000},"holding":1}`. The session is claimable.
- **The two builds:**
  - `claimBuild([0], false)` gives `lovejoin` undefined and `collateralTail` set, so with no other pick there is no switch.
  - `claimBuild([0], true)` gives no chain and no tail. Its inputs include `<deposit>#<change>`.
- **Sent:** one transaction is submitted, and `tail.over` stays undefined.
- **Returning:** `{"stage":"returning","chain":{…"cut":true…},"collateralHeld":{"offerAt":1800003600000},"holding":{"lovelace":"0","utxos":0}}`.
- **Landed:** `{"stage":"open","chain":{…"cut":true…},"collateralHeld":{"offerAt":1800003600000},"holding":{"lovelace":"0","utxos":0},"closed":false}`.
- **The rendered page:** `CollateralHeldWayOut` shows the giveme.my line and the button.
- **How long it lasts:** still held 10 min before the day from `landed`; gone 1 min after it.
- **The press:** `skipCollateralMix` sends nothing (the submit count is unchanged). It only sets `tail.over`, and `collateralHeld` goes.

**R2, the wording sub-claim:** after `stoppedAtMix`, the two other boxes are spent, and `backBuild` throws `lj.tail.fewBoxes`. `collateralHeld` is still defined. So past the hour the callout says the mix "is still waiting for giveme.my" while it is really waiting for the pool's boxes. `noPool` is the same, since `landed` was already set by `witnessTail`.

## Fix check (a scratchpad copy, never the tree)

I applied the finding's own fix in `view()`:

```ts
...(stage !== "closed" && tail && !(s.chain && chainView(s.chain, txs).cut) ? { collateralHeld: tail } : {})
```

- **R1:** the real hold before the direct return is kept (`cut` false). The stale hold is gone both while returning and after landing.
- **Existing tests:** `lovejoin-planner.test.ts` and `collateral-held.test.ts` pass, 81/81.

## Narrower than it reads

- **Reachability:** it needs two sessions brought back by hand that hold money at once, one of them held at its mix, and the switch turned to *directly*. A session's own page can't build a direct return for a tail chain.
- **A swap brought back by hand:** it closes once its return lands, so it shows the stale offer only while `returning`.
- **"Nothing can pay for that mix":** true only while the account stays empty. A site's session stays open, so if the site pays it again within the day, the next return through Lovejoin builds that mix again (`tries` 1 < `TAIL_TRIES`).
- **No money or privacy harm:** the callout's privacy clause (the box stays unmixed and tied to the session) is true. The press only gives up a rebuild that would need the session to be paid again, and the day ends the hold anyway.

## Fix advice

- **Take the view-level fix as written.** It is display only and verified above. Add R1 as its test: check `collateralHeld` before the direct return, and that it is gone at `returning` and after landing.
- **The alternative** (`tailOver` when a plain return of a started session is sent) ends the mix for good. A later return through Lovejoin, if the site pays the session again, would then skip it, which fits *Private by default* less well. Prefer the view-level fix.
- **The fix's limit:** if the site pays the session again, the offer stays hidden until a rebuilt mix is sent and waits. That is acceptable, since nothing waits before then.
- **Rewording `lj.tail.privacy.wayOut`** so it doesn't name giveme.my (it is wrong for `fewBoxes`/`noPool`) is the owner's call. It is a critical key, so a new value needs blind back-translations for es and ja.

**Not traced:** a site's own CIP-30 transaction spending the deposit's change may leave the same stale hold.
