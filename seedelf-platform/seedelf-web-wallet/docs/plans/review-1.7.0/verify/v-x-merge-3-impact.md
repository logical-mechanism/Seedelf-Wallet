# v-x-merge-3-impact: x-merge#3, privacy.md misses the user-chosen way out that leaves the 5 ₳ box unmixed

**Verdict: confirmed. Severity: low** (the same as the finding). Confidence: high, on both the facts and the impact.

## What holds

- **privacy.md:217 (HEAD `6bca8bec`)** gives the times the session's collateral box is left unmixed: "Where it was built but can't go (giveme.my refusing past its wait, a box it drew gone, a lock), it's built once more with fresh boxes, the rest held back meanwhile so nothing sweeps what pays for that mix, but for an hour at most where the deposit isn't on chain (most likely dropped); past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session as any deposit's box is, and Mix my boxes again takes it first."
- **#337 adds a third way, chosen by the user:**
  - `tailHeld` (lovejoin.ts:4127) returns `offerAt: c.tail.landed + TAIL_OFFER_MS`. `TAIL_OFFER_MS` is an hour (lovejoin.ts:335). It does so while the mix waits for giveme.my (`tailWaits`, :1319) or waits to be built again (`tailBuildable`, :1334).
  - `skipCollateralMix` (sessions.ts:5526) calls `tailOver` from that time on (:5529).
  - `witnessTail` (sessions.ts:5144) then stops a chain that's still being sent, before giveme.my is asked again (`lj.tail.skipped`).
- **The end state is the same as the day's cap.** The day's cap runs `tailOf` (lovejoin.ts:4008) → `!tailBuildable` → `tailOver` (:4013-4015). Either way `tail.over` is set and the box waits in the pool, not mixed yet. #337's planner test pins this: `stopped.tail?.over` is true, `stopped.stopped` is `lj.tail.skipped`, `t.collateral.asked` stays at 1, and `back.collateralTail` is undefined.
- **#337 changed architecture.md and flows.md (one sentence each) but not privacy.md.** `git diff 11e249d2^1 11e249d2 --stat` shows this, and `git show 11e249d2^1:…/privacy.md | diff -q - …/privacy.md` finds no difference. #338 touched only post-release-roadmap.md. The only change to privacy.md in the range is #336's `f40ed2fc`.
- **The omission looks like an oversight, not a decision.** #337's description makes an explicit call on the store policy ("**No privacy policy entry.** Nothing new is sent to anyone. The outcome … is what the day's end already does") but says nothing about privacy.md.

## Impact

- **Who it reaches:** anyone who reads privacy.md.
  - Both READMEs link to it. The web wallet's README:82 says "What stays hidden, what doesn't, and the rules the wallet enforces".
  - The doc describes itself as "This doc says what the wallet does now" (privacy.md:7).
  - The behaviour it leaves out can be reached in the store build on preprod. On mainnet it can be reached only once a 5 ₳ ADA pool holds its floor of boxes; #337's own note says it lies dormant until then.
  - The gap in the doc exists whether or not the behaviour is reachable.
- **No user is misled when deciding.** The button sits under the critical privacy line `lj.tail.privacy.wayOut` (en.json:922): "…its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again." That line was back-translated blind into es and ja (`verified-critical-{es,ja}.json`:143). The choice is the user's, which rules 1 and 2 allow.
- **The store policy is still right, and no *Changes* entry is due.**
  - privacy-policy.md:28 says "If the mix can't go, the box waits there, and can be tied to the session until it's mixed", with no time limit.
  - Nothing new is sent. giveme.my is asked less, not more.
  - Nothing new is stored. `tail.over` existed before #337, and `offerAt` is computed from `landed`.
  - So the PR's call and the finding's line on this are both right.
- **Why low, not nit:**
  - privacy.md lists each control that turns privacy down by the user's choice, under its own rule at :7 ("a control turns a choice down where it costs fees, time or lookups"). An example is *Bring every box back now* at :226: "by the user's choice, behind a question that says what it costs".
  - Callout.tsx:2-3 says "The privacy notes carry the decisions in privacy.md, so a screen can move or shorten one but never drop it."
  - The new privacy note has no decision behind it in privacy.md. So rule 3's check ("every privacy note stays") has nothing to hold `lj.tail.privacy.wayOut` to.
  - :217 reads as the complete list of times the box is left unmixed, and it isn't anymore.
- **Why not medium:** nothing misleads a user about money or privacy when they choose, and the public policy is accurate.

## The fix

**It's right in substance, minimal and docs-only, and it keeps to the owner's rules.** It adds no guard or refusal, it adds to a privacy note rather than dropping one, and it needs no policy entry. Two refinements:

1. **Scope.** The clause would sit inside the sentence that opens "Where it was built but can't go". But the offer also appears during the first wait for giveme.my's signature (`tailWaits`, while the chain is still being sent), not only after a failed build. The clause should say "while that mix still waits (for giveme.my, or to be built again)", as flows.md does.
2. **Wording.** Inserted as written, the clause produces "past that, or a day after the deposit landed, or, from an hour after the deposit landed, when the user brings the rest back without it (…)". That is three "or"s and "after the deposit landed" twice. Either of these would read better:
   - **In place:** "…; past that, or a day after the deposit landed, or sooner on the user's word (*Bring the rest back now*, offered from an hour after it landed while that mix still waits, under a line that says so), the box waits not mixed yet, tied to the session as any deposit's box is, and Mix my boxes again takes it first."
   - **As a new sentence right after that one:** "From an hour after the deposit landed, while that mix still waits (for giveme.my, or to be built again), the session's page offers *Bring the rest back now*, under one line that says the box stays in the pool unmixed, tied to the session: it ends the wait as the day's end does (the owner, 2026-10-28)."
   - "(the owner, 2026-10-28)" dates a decision, as privacy.md does elsewhere, not a release (rule 7).

**Nothing else needs to change:**

- privacy.md:226's "a day at most" is still true, as the upper limit.
- :217's "Kept on the device…" needs nothing, since no new field is stored.
- privacy-policy.md needs nothing.

**Side effects: none.** No test reads privacy.md: `words.test.ts` scans only `extension/src`, and the i18n scripts read `src` and `docs/i18n`.

## Evidence

- privacy.md:7, :217, :226 on HEAD (quoted above). privacy-policy.md:28. Callout.tsx:1-3. Web wallet README:82.
- lovejoin.ts:335 (`TAIL_OFFER_MS = 60 * 60_000`), :1319 (`tailWaits`), :1334 (`tailBuildable`), :4008-4015 (`tailOf` → `tailOver`), :4127-4133 (`tailHeld`), :4141 (`tailOver`). sessions.ts:5144 (`if (await lovejoin.tailIsOver(…)) throw new Error(t("lj.tail.skipped"))`), :5526-5538 (`skipCollateralMix`).
- `git diff 11e249d2^1 11e249d2 --stat`: 20 files, docs = architecture.md, flows.md and the i18n JSONs, no privacy.md. `git diff 6bca8bec^1 6bca8bec --stat`: post-release-roadmap.md only. `git log babb8e76..HEAD -- docs/privacy.md`: `f40ed2fc` only.
- `gh pr view 337`: "**No privacy policy entry.**" Nothing about privacy.md.

No scratch test files were made. One scratch diff in my scratchpad folder was deleted.
