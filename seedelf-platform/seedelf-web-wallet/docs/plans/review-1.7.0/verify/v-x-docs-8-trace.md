# v-x-docs-8-trace: x-docs#8, privacy.md's collateral-mix paragraph doesn't name *Bring the rest back now*

**Verdict: confirmed. Severity: nit** (as filed). Traced on HEAD `6bca8bec`. Confidence: high.

## What the code does

#337's control works as the finding says. It is an hour from the deposit landing, the user's choice, and leaves the box unmixed and tied to the session.

- `extension/src/background/lovejoin.ts:335`: `export const TAIL_OFFER_MS = 60 * 60_000;`.
- `lovejoin.ts:4127-4133` (`tailHeld`):
  - It answers only once the deposit is known in: `if (!c?.tail || c.tail.landed === undefined) return undefined;`.
  - It answers only while the mix waits for giveme.my or to be built again: `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`.
  - Then it returns `{ id: c.id, offerAt: c.tail.landed + TAIL_OFFER_MS }`.
- `extension/src/background/sessions.ts:5526-5538` (`skipCollateralMix`): from `offerAt` on, `tailOver(network, held.id)` sets `tail.over = true`. Its comment reads: "its 5 ₳ box waits in the pool not mixed yet, tied to the session, for Mix my boxes again, and a chain still being sent stops at it".
- `sessions.ts:5144` (`witnessTail`): `if (await lovejoin.tailIsOver(...)) throw new Error(t("lj.tail.skipped"));`. giveme.my isn't asked again.
- The screen, `extension/src/ui/components/LovejoinReturn.tsx:548-557` (`CollateralHeldWayOut`):
  - It shows nothing before `offerAt`.
  - From then it shows the privacy callout `lj.tail.privacy.wayOut`: "…Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."
  - Under it, the button `lj.tail.wayOut`: "Bring the rest back now".
  - The callout is in `critical-keys.json` and both `verified-critical` files.
- The existing test `tests/lovejoin-planner.test.ts:1791-1828` drives it end to end. Past the hour the tail is over and the chain stops with `lj.tail.skipped`. giveme.my is asked once, and the rest comes back with `collateralTail` undefined, the box left in the pool.

## What privacy.md says

- `docs/privacy.md:217` lists the paths to an unmixed box tied to the session: "…the rest held back meanwhile so nothing sweeps what pays for that mix, but for an hour at most where the deposit isn't on chain (most likely dropped); past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session as any deposit's box is, and Mix my boxes again takes it first."
  - The user's path, an hour after the deposit landed, is missing.
  - "the rest held back meanwhile" no longer holds once the user chooses.
- privacy.md mentions none of *Bring the rest back now*, `TAIL_OFFER_MS`, `session-skip-collateral-mix`, `skipCollateralMix` or "rest back without".
- This breaks the doc's own rule (privacy.md:7): "the wallet never forbids a link the user chooses …: it says what a payment or a connection reveals". The doc already names six such controls: *Stop and bring it back directly*, *Bring one back anyway*, *Bring one back now*, *Bring every box back now*, *Mix my boxes again* and *Put in 5 ₳ for Lovejoin*.
- `git diff --stat 11e249d2^1 11e249d2`: #337 edited `docs/flows.md` and `docs/architecture.md` (one line each), but not `privacy.md` or `store/privacy-policy.md`. The only commit in `babb8e76..HEAD` that touches privacy.md is f40ed2fc (#336). Its hunk is at @@ -197 and is about pool confirmation.
- `docs/flows.md:522` names it: "**Bring the rest back now**, with one line: the 5 ₳ box stays in the pool unmixed, tied to the session…".
- `docs/architecture.md:633` names it by its code: "Sooner on the user's word: `TAIL_OFFER_MS` (an hour) after the deposit landed … `session-skip-collateral-mix` (`skipCollateralMix`) makes it over then". It doesn't use the button's label. That is a minor looseness in the finding's "both name it".

## Repro

Scratch test `extension/tests/zz-review-v-x-docs-8-trace-1.test.ts`, run alone (`npx vitest run …`), then deleted. **2 passed, 2 failed.**

- **Passed:**
  - The control exists on HEAD: `en["lj.tail.wayOut"] === "Bring the rest back now"`, the privacy line contains "unmixed, tied to this session", and `TAIL_OFFER_MS = 60 * 60_000`.
  - flows.md has "Bring the rest back now", and architecture.md has `TAIL_OFFER_MS` and `session-skip-collateral-mix`.
- **Failed:**
  - privacy.md's collateral paragraph doesn't match `/Bring the rest back now|TAIL_OFFER_MS|session-skip-collateral-mix|skipCollateralMix|rest back without/`. The assertion just before it, that the paragraph contains "past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session", passed.
  - The same regex doesn't match anywhere in privacy.md.

## Why nit, not low

- Nothing in privacy.md is false: it never says "only".
- The outcome and what it ties are already in the same paragraph, as the day's-end path.
- The screen says it before the press, in a critical line back-translated blind.
- flows.md and architecture.md have it.
- Nothing new is sent to anyone, so no privacy-policy entry is due. The skip asks giveme.my less, not more.
- The gap is in the design doc's list of paths only.

## Checked and not affected

`docs/privacy.md:226` says *Bring every box back now* leaves the collateral's box to its mix "a day at most". After a skip, `tailBoxes` (`lovejoin.ts:1349-1354`, filtering on `!c.tail.over`) no longer holds that box. That is the same as the day's end, so "at most" still holds.

## Fix

The proposed sentence is right in substance. To match the code and the paragraph's own terms:

- "after the deposit landed": the code counts from `tail.landed`, and the paragraph already says "a day after the deposit landed".
- Say the line warns first.
- Say the rest comes back.

Put it right after "…and Mix my boxes again takes it first.":

> Sooner on the user's word: an hour after the deposit landed, while that mix still waits, the session's page offers *Bring the rest back now*, its line saying first that the box stays in the pool unmixed, tied to the session; it ends the wait as the day's end would, and the rest comes back (the owner, 2026-10-28; 1.7.0).

No change is needed to `store/privacy-policy.md` or to line 226.

## Scratch files

`extension/tests/zz-review-v-x-docs-8-trace-1.test.ts`: created, run, deleted. No tracked file was edited.
