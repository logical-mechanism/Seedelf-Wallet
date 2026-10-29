# Verify `x-ui#5` (label `v-x-ui-5-trace`)

**Verdict: confirmed. Severity: nit. Confidence: high.**

On HEAD, privacy.md never mentions *Bring the rest back now*. Yet the press leaves the collateral's 5 ₳ box unmixed and tied to the session, as the day's end does. A scratch test decided it: it fails on HEAD. This is the same defect as pr337's finding 5, whose privacy.md half `v-pr337-4-trace` also upheld. Merge the two.

I tried four ways to refute it. None held:
- Nothing after #337 touched privacy.md.
- privacy.md records user choices on this exact ground.
- No other privacy.md sentence covers the press.
- No docs convention defers privacy.md to the release PR. #336, in this same range, updated privacy.md in its own PR.

Traced on HEAD `6bca8bec`.

## The premise holds: the press leaves the box unmixed, tied to the session

- `lovejoin.ts:335`: `export const TAIL_OFFER_MS = 60 * 60_000;`
- `lovejoin.ts:4127-4133` (`tailHeld`): returns `{ id, offerAt: c.tail.landed + TAIL_OFFER_MS }` when two things hold:
  - the deposit has landed;
  - the mix waits for giveme.my (`tailWaits`) or to be built again (`tailBuildable`).
- `sessions.ts:5526-5537` (`skipCollateralMix`):
  - from `offerAt`, it calls `await this.deps.lovejoin!.tailOver(network, held.id);` (`:5529`);
  - it pumps a chain still being sent;
  - then `return this.advance(network, index, true);` (`:5537`).
- `lovejoin.ts:4141-4146` (`tailOver`) sets only `tail.over = true` (`:4144`). The day's end reaches the same state through `tailOf` (`:4008`), whose `tailBuildable` turns false and which calls `await this.tailOver(network, c.id);` (`:4014`). `tailOf`'s own comment says what follows: "past either it's over, and its box waits, not mixed yet, for Mix my boxes again".
- `sessions.ts:5144`: a chain still being sent stops before giveme.my is asked again: `if (await lovejoin.tailIsOver(...)) throw new Error(t("lj.tail.skipped"));`
- *Mix my boxes again* still takes the box first. It orders boxes by `notMixedYet` (`lovejoin.ts:1839`, `:3564-3567`), which reads the chain records, not how `over` was set.
- The screen says so before the press. `en.json:922` (`lj.tail.privacy.wayOut`, a critical key): "…its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."

## What the docs say on HEAD

- **#337 documented it twice.** `git diff --word-diff 11e249d2^1 11e249d2` shows one added sentence in each of:
  - `architecture.md:633`: "Sooner on the user's word: `TAIL_OFFER_MS` (an hour) after the deposit landed…";
  - `flows.md:522`: "An hour after its deposit went in … offers **Bring the rest back now** …".
- **#337 didn't touch privacy.md.** It isn't in the PR's file list, and nothing after #337 touched it either: `git diff 11e249d2 6bca8bec --stat` shows only `post-release-roadmap.md` (#338, docs, item 8's text).
- **The evidence line is quoted exactly.** `privacy.md:217`: "…but for an hour at most where the deposit isn't on chain (most likely dropped); past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session as any deposit's box is, and Mix my boxes again takes it first." The only "hour" there is `TAIL_UNLANDED_MS`, the wait for a deposit that hasn't landed, not the offer.
- **No privacy.md sentence names the press.** A grep of the whole file for `Bring the rest back now`, `TAIL_OFFER_MS`, `skipCollateralMix`, `session-skip-collateral-mix`, "on the user's word" or "an hour after the deposit landed" finds nothing.
- **privacy.md does record user choices on this ground,** so the omission isn't by design:
  - `:217` records the Settings switch, and "While that mix waits, boxes due, Bring one back now and Bring every box back now go as usual".
  - `:226` covers *Bring every box back now* and its handling of this box ("a day at most").
- **The convention is to update privacy.md in the same PR.**
  - #336 (`f40ed2fc`, merge `473b7f1a`) added its privacy change to privacy.md itself, tagged "1.7.0".
  - privacy.md's header calls it the doc for "what the web wallet has to do on top of" the protocol.
  - The brief's rule 3 names it the design doc for this ground.
- **#337 gave no reason for leaving privacy.md out.** Its description argues only against a privacy policy entry ("Nothing new is sent to anyone. The outcome … is what the day's end already does"). The roadmap's item 6 (`post-release-roadmap.md:373`) says nothing about docs.
- **The privacy policy needs nothing.** `privacy-policy.md:28` says it in general terms, whatever the cause: "If the mix can't go, the box waits there, and can be tied to the session until it's mixed, as any box at its deposit can." The finding claims no policy gap, and there is none.

## Scratch test (deleted)

The file was `extension/tests/zz-review-v-x-ui-5-trace-1.test.ts`, run alone: **2 failed, 2 passed**, the result if the finding is real.

**The two controls passed:**
- flows.md and architecture.md match the way-out pattern.
- `skipCollateralMix` calls `tailOver(network, held.id)` as `tailOf`'s day's end calls `tailOver(network, c.id)`, and `en.json`'s `lj.tail.privacy.wayOut` matches /unmixed, tied to this session/.

**Two assertions failed on HEAD.**
1. privacy.md's collateral paragraph, the line holding "The session's 5 ₳ collateral is mixed once", should match `/Bring the rest back now|TAIL_OFFER_MS|skipCollateralMix|session-skip-collateral-mix|on the user's word|an hour after (the|its) deposit (landed|went in)/`. It fails. Its `toContain` on the quoted "past that, or a day after the deposit landed, the box waits not mixed yet" passed first, so the evidence quote is exact.
2. The whole of privacy.md should match the same pattern. It fails.

**I also ran #337's own worker test alone,** `lovejoin-planner.test.ts:1791` ("offers the rest back without its collateral's mix an hour after its deposit went in…"). It passes on HEAD (1 passed, 78 skipped). After the hour:
- the tail is `over`;
- the chain stopped with `lj.tail.skipped`;
- giveme.my is still asked only once;
- `backBuild` returns no `collateralTail`, so the box stays in the pool.

The JSON results are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-x-ui-5-trace/` (`result.json`, `planner.json`). The tree holds no file of mine.

## Severity

**nit**, as filed:
- The doc leaves the press out; it doesn't state anything false. "A day at most" in `:226` is still an upper bound.
- Users are told before they press, in a back-translated critical line.
- The policy's general sentence covers the outcome.
- Only a reader of the design doc is misled, by omission. A case for **low** ("a misleading doc") exists but is weak.

## Fix advice

Add the clause the finding proposes to `privacy.md:217`, but key it to the press rather than to the rest coming back:
- For a session brought back by hand (a site's, or a swap brought back by hand), the press ends the wait and sends nothing. `advance` → `step` returns at `sessions.ts:3446` (`if (!s || !running(s)) return;`), because `running` needs `s.auto`. That is x-ui's F2 and pr337's finding 2.
- So "if the user brings the rest back without it" describes something that may not happen.

Suggested wording, after "past that, or a day after the deposit landed":

> "…or sooner, from an hour after it landed, when the user chooses *Bring the rest back now* on the session's page, a swap's, a site's or the mix's card (`TAIL_OFFER_MS`; a chain still being sent stops there, before giveme.my is asked again; 1.7.0),…"

If F2's fix lands (the press opens the return's review), the finding's own wording is accurate enough.

Optional:
- `:226`'s "a day at most" for *Bring every box back now* could add "or until the user brings the rest back without it". After the press, `tailBoxes` no longer reserves the box, so *Bring every box back now* takes it.
- No privacy policy entry is needed.
