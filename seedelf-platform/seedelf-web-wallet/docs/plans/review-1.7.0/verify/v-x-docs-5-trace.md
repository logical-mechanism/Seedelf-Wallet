# v-x-docs-5-trace: x-docs#5, the way-out line names giveme.my where the mix waits to be built again

**Verdict: confirmed. Severity: low (ux).** The line's first sentence is false whenever `tailHeld` offers the way out from `tailBuildable`, and that state is reachable and lasts. A scratch test reproduced it in two states. Each test passed every state assertion and failed only on the finding's own assertion.

## The trace on HEAD (6bca8bec)

- **Offered in two states.** `lovejoin.ts:4127-4132` (`tailHeld`): `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined; return { id: c.id, offerAt: c.tail.landed + TAIL_OFFER_MS };`
  - `tailWaits` (`lovejoin.ts:1319`) needs `!c.ended`: the chain is still being sent and the mix is being asked of giveme.my.
  - `tailBuildable` (`lovejoin.ts:1334-1341`) needs `!!c.ended`: the chain stopped short of the mix (giveme.my refused, a drawn box went, a lock), `tries < TAIL_TRIES`, within the day.
- **Always one wording.** `sessions.ts:5617` passes `collateralHeld` to any view whose stage isn't `closed`. `LovejoinReturn.tsx:548-551` then shows `lj.tail.privacy.wayOut` without checking which state it is: "The collateral's mix is still waiting for giveme.my. …" (`en.json:922`). es (`969`, "sigue esperando a giveme.my") and ja (`875`, "まだ giveme.my を待っています") say the same.
- **By-hand sessions (a site's, a hand-run swap's, one brought back by hand): nothing asks giveme.my.**
  - After the stop, the alarm only pumps a chain that is still pending (`sessions.ts:3367-3368`), and `pump`'s catch dropped this one.
  - The mix is built again only through `buildBack`'s `tailChain` (`sessions.ts:4385-4390`), that is, when the user presses Bring it back.
  - The page's own row says "Stopped after {{sent}} of {{total}} transactions; the rest stays at the account until you bring it back" (`LovejoinReturn.tsx:117`, `en.json:986`). The way-out line beside it says the mix is still waiting for giveme.my.
- **Sessions that run themselves (a mix's card, a swap that runs itself).**
  - `step`'s catch sets `auto.retry` (`sessions.ts:3470-3478`, 30 s first), and the rebuild then asks giveme.my again. After a plain refusal, the line is wrong only until that retry.
  - It stays wrong when the rebuild waits on the pool. `tailChain` returns `fewBoxes` or `noPool`, and `buildBack` throws `tailWaiting(...)` (`sessions.ts:4390`; `lovejoin.ts:1302`) for up to a day. `s.chain` is replaced only when a chain starts (`sessions.ts:4926`), so the stop reason stays too.
  - A mix's card then shows, at once: "Why it stopped: giveme.my wouldn't back the collateral's mix…", then "It tries again at …. What went wrong: Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free…" (`Lovejoin.tsx:907-912`), then "The collateral's mix is still waiting for giveme.my." (`Lovejoin.tsx:2586-2588`).
  - A swap that runs itself shows the same retry error in its timeline (`Swaps.tsx:3196-3211`) above the way-out line (`Swaps.tsx:2513`).
- **The docs say it right.** `flows.md:522` says "while the mix still waits (for giveme.my, or to be built again)". `rpc.ts:1866`'s comment ("which waits for giveme.my (a day at most)") is wrong in the same way as the line.

## Repro (scratch test, deleted)

`extension/tests/zz-review-v-x-docs-5-trace-1.test.ts` copied lovejoin-planner's helpers, `setUp` (a site's session) and `stoppedAtMix()` (giveme.my refused past GIVEME_BEHIND_MS). It then moved the tail's `landed` back by TAIL_OFFER_MS, as the existing 1.7.0 test does, and rendered `CollateralHeldWayOut` with the view's `collateralHeld` at `t.clock.now`.

- **(a) Refused.** The Lovejoin record was `{ended: true, stopped: "giveme.my wouldn't back the collateral's mix, so the chain stopped there.", tail: {tries: 1, landed: 1800000000000}}`.
  - Over three alarm runs, 5 min apart with the page open (`touch`), `t.collateral.asked` didn't grow: giveme.my wasn't asked.
  - The view was `{stage: "open", chain: {sent: 5, total: 7, stopped: <refused text>}, collateralHeld: {offerAt: 1800000000000}}`.
  - The render held "The collateral's mix is still waiting for giveme.my." and the button.
  - It **failed only on** `expect(shown).not.toContain("still waiting for giveme.my")`.
- **(b) fewBoxes.** The other people's boxes were spent, as in the existing 323-worker#2 test. `backBuild` rejected with `lj.tail.fewBoxes`, and `collateralHeld` was still offered. It **failed only on** the same assertion.

Result: 2 run, 2 failed, both on the finding's assertion and nowhere else. The file has been removed.

## Narrower than it reads, but still real

- **The refusal's own words.** A by-hand session's page (site's or swap's) doesn't print the stop reason; the Lovejoin page's Chains list does. On those pages, the line clashes with "Stopped … the rest stays at the account until you bring it back".
- **Where the reason and the line meet.** On a mix's card they show together. The clash lasts through a `fewBoxes` or `noPool` wait, but only about 30 s after a plain refusal.
- **Mainnet exposure today.** `collateralPool` (`lovejoin.ts`) needs a shown 5 ₳ ADA pool with the floor of other people's boxes (30 on mainnet) and 2 free, so the feature is dormant on mainnet until such a pool exists (PR #337 says so). Preprod (floor 0) is live.
- **No money or privacy harm.** What the line says about the box (unmixed, tied to the session) is true in both states; only its status clause is wrong.

## Fix advice

- **The line.** The finding's fix holds: a first sentence true in both states, for example "The collateral's mix hasn't gone yet.", with the rest kept as it is.
  - All three languages carry the claim, so en, es and ja change. es and ja need a fresh blind back-translation, recorded in `verified-critical-{es,ja}.json`.
  - The key's name is unchanged, so `critical-keys.json` stays as it is.
- **The comments.** Fix `rpc.ts:1866`'s "which waits for giveme.my" too, and the "what's still waiting" wording in `LovejoinReturn.tsx`'s comment.
- **The test.**
  - Build it as the repro did: `stoppedAtMix()`, `landed` moved back an hour, then render the line from the view's `collateralHeld`.
  - Assert the key shown rather than English text, so a wording change can't make it pass by accident.
  - Name one of the by-hand states (a refusal), where nothing asks giveme.my.
