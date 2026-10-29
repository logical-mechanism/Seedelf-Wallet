# v-x-priv-3-trace: x-priv#3, traced on HEAD (6bca8bec)

**Verdict: confirmed. Severity: low** (a small UX defect, as the finding rated it). Confidence: high. A scratch test reproduced it four ways, the finding's own scenario among them.

## The claim

#337's critical line `lj.tail.privacy.wayOut` says "The collateral's mix is still waiting for giveme.my." It shows whenever `tailHeld` holds the return. That includes `tailBuildable` states, where the mix's rebuild answers `fewBoxes` or `noPool` and the same page names the 5 ₳ pool as the wait. giveme.my may never have been asked.

## The path on HEAD

- `lovejoin.ts:4131`: `tailHeld` holds the return under either predicate. `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;` then `offerAt: c.tail.landed + TAIL_OFFER_MS`.
- `lovejoin.ts:1334-1341`: `tailBuildable` is the ended chain (a lock cut it, giveme.my refused it, a box it drew went) whose mix may be built again.
- `sessions.ts:4387-4390`: every return (the runner's `bringBack` and the by-hand `backBuild`) goes through `buildBack`, which calls `tailChain`. A `TailWait` string is thrown as its words: `if (typeof resumed === "string") throw new Error(tailWaiting(resumed));`.
- `lovejoin.ts:4041`: `if (!pool?.ref) return "noPool";`. This comes before `tailLanded`.
- `lovejoin.ts:4062` sets `tail.landed = await this.tailLanded(network, id)` before the build. Then `:4082`: `if (/pool has \d+ boxes/.test(...)) return "fewBoxes";`. That is core's `PoolShort`, `seedelf-core/src/lovejoin/mod.rs:2321`, raised by `fresh_for` in `collateral_mix`.
- The swap runner, `sessions.ts:3473-3478`: a plain Error becomes `auto.retry = { error, reason: "other", ... }`. `Swaps.tsx:3029`: `reason === "other" ? error` makes the Timeline's retry line (`Swaps.tsx:3196-3205`) the `lj.tail.fewBoxes` / `lj.tail.noPool` text.
- `sessions.ts:5617`: `...(stage !== "closed" && tail ? { collateralHeld: tail } : {})`. The same `s.auto` branch renders `<Timeline>` (2505) and `<CollateralHeldWayOut>` (`Swaps.tsx:2513`). By hand: `Swaps.tsx:2567`, `SiteSessions.tsx:412`, `Lovejoin.tsx:2588`, with the pool reason as the screen's error when Bring back is pressed.
- `LovejoinReturn.tsx:549-551`: from `offerAt`, the callout is `tr("lj.tail.privacy.wayOut")`, unconditionally.

## Scratch test (run, then deleted)

`extension/tests/zz-review-v-x-priv-3-trace-1.test.ts`: a copy of `lovejoin-planner.test.ts` for its helpers (`setUp`, `stoppedAtMix`). Four cases were added inside *its waits and its give-ups*, run alone with `-t "ZZ-"`. Each asserts the state first, then `expect(shown).not.toContain("giveme.my")`.

Result: **4 failed, each only at that last line**, so every state assertion before it held.

- **ZZ-1.** giveme.my refused past its wait, so the chain stopped at its mix. The pool's other boxes are spent, so `backBuild` rejects with `lj.tail.fewBoxes`. `landed` is moved back `TAIL_OFFER_MS`, as #337's own test does. `backBuild` still rejects with fewBoxes, `view.collateralHeld.offerAt <= now`, and the callout renders "The collateral's mix is still waiting for giveme.my. …".
- **ZZ-2 (the finding's scenario, by hand).** The return is sent and the wallet is locked and unlocked before the collateral's mix. The deposit lands and the pool has too few free boxes. The first `backBuild` gives fewBoxes, the cut chain has `ended`, and `tail.landed` is set by `tailChain`. An hour on it still gives fewBoxes and the giveme.my callout shows. `t.collateral.asked` is `[]`: **giveme.my was never asked.**
- **ZZ-3.** As ZZ-1, but the runner's Lovejoin sees no pools. It gives `lj.tail.noPool` both times, and the callout names giveme.my.
- **ZZ-4 (the finding's scenario as a swap that runs itself).** As ZZ-2, with session 0's record given `auto` (filled) and `swap`, then `sessions.advance("preprod", 0, true)`. `view.auto.retry.error` is `lj.tail.fewBoxes` and `retryReason()` returns it. An hour on, the same view has `collateralHeld` due and the callout says giveme.my. giveme.my was asked 0 times.
  - Caveat: a site session made to run as a swap is a test shortcut. The runner's path (`act`, then `kinds.has("deposit")`, `bringBack`, `buildBack`, `tailChain`) is the same for any running session.

Logged output (ZZ-4): the retry line is "Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free for its collateral's mix yet. The rest waits for that mix, a day at most." The way out is "The collateral's mix is still waiting for giveme.my. Bring the rest back without it, …".

## Narrower or broader than stated

- **noPool needs `landed` set already.** `tailChain` returns `"noPool"` before `tailLanded` (`:4041` vs `:4062`). In the pure lock-cut scenario, only `fewBoxes` (or a `noPool` after an earlier pass got past the pool read) brings the callout. `noPool` alone brings it where `witnessTail` ran first, that is, where giveme.my was asked before the stop.
- **The hour's start in the lock-cut case.** The hour runs from when the wallet first found the deposit in (at the unlock's first `tailChain`), not from when the deposit landed.
- **The docs already say both.** `docs/flows.md` reads "while the mix still waits (for giveme.my, or to be built again), … offers **Bring the rest back now**". The UI line is narrower than the docs.
- **The line is also untrue without a contradicting line.** In a by-hand session cut after `witnessTail` ran, nothing asks giveme.my until the user's own Bring back builds the mix again, yet the line still names giveme.my.
- **The privacy half is accurate:** the box is tied to the session's one-time account at its deposit. All three languages carry the wrong cause: es "sigue esperando a giveme.my", ja "まだ giveme.my を待っています".
- **Reach.** Dormant on mainnet today: `collateralPool` builds no tail without a shown 5 ₳ ADA pool at its floor of 30 others (`lovejoin.ts:3966-3976`, PR #337's "On mainnet it stays dormant"). Once such a pool exists, fewBoxes needs it to fall below 2 free others within the day. On preprod (`poolFloor: 0`) a thin 5 ₳ pool makes it easy. That is why the severity is low.

## Fix advice

- Agree with dropping the cause. The new value is true under both `tailWaits` and `tailBuildable`, and shorter (rule 4), for example: "The collateral's mix hasn't gone yet. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."
- Keep the privacy half word for word (rule 3).
- Redo es and ja to match. Blind back-translate both and note the round in `verified-critical-{es,ja}.json`. Those files list key names only, so nothing there changes by itself, and `critical-keys.json` stays as is while the key keeps its name.
- No test pins the giveme.my wording. `collateral-held.test.ts` checks `t("lj.tail.privacy.wayOut")` and "unmixed, tied to this session", which still hold.
- Add ZZ-2 as the regression test.
- Carrying a `why` in `collateralHeld` would mean a second critical key and more translation for little gain.
