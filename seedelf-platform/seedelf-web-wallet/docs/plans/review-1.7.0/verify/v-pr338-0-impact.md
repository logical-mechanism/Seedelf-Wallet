# v-pr338-0-impact: pr338#0, the roadmap's Leios note says the chain window is four, and "120 to 245 s more" reads as a saving

**Verdict: partly. Severity: nit** (filed as low). Confidence is high on every fact: the code was read at HEAD (`6bca8bec`) and the run records on `origin/web-wallet/leios-musashi` were read with `git show`. The severity is a judgement. This is docs only. It's an internal planning note about a change that comes after Leios reaches mainnet and Pallas is updated ("much later", the owner), so nothing a user, site or attacker can reach in the 1.7.0 store build depends on it. It doesn't block the release. The proposed fix is accurate, but it needs one correction and could be shorter.

## The facts hold

- **The text.** post-release-roadmap.md:409: "a chain's window of four in flight (`pumpChain`) could be the whole chain, since four at a time, the rest waited for the queue again (120 to 245 s more)". #338 wrote it, and no later PR changed it.
- **Two windows in the code.**
  - lovejoin.ts:294 has `export const CHAIN_WINDOW = 4;`, :300 has `export const CHAIN_WINDOW_FOUR = 2;`, and :302 has `chainWindow = (width) => (width >= 4 ? CHAIN_WINDOW_FOUR : CHAIN_WINDOW)`.
  - `pumpChain` uses `chain.window ?? CHAIN_WINDOW` (:483).
  - Both places that create a chain set the window for four-box mixes. The public mix does it at lovejoin.ts:4635: `...(built.width === 4 ? { window: chainWindow(4) } : {})`. A session's return does it at sessions.ts:4937: `summary.lovejoin?.width === 4 ? { window: chainWindow(4) } : {}`.
  - The default width is three (preferences.ts:176 `lovejoinWidth: 3`). So "four" is right for the default, and four-box mixes go two at a time.
- **The run records.** The four chain runs, read from `seedelf-leios/results/2026-10-28/*.json` with each transaction's own `sent` and `landed` times:

  | Run | Window | Txs | All landed | First wave landed | Second wave's own wait |
  |---|---|---:|---:|---:|---:|
  | chain-w3-all | whole | 5 | 462.2 s | 462.2 s | none |
  | chain-w3-k4 | 4 | 5 | 434.1 s | 314.0 s | 120.0 s (mix 4) |
  | chain-w4-all | whole | 6 | 388.2 s | 388.2 s | none |
  | chain-w4-k4 | 4 | 6 | 398.9 s | 153.0 s | 245.7 s (mixes 4 and 5) |

  So the "120 to 245 s" is the second wave's own wait. The 245 s comes from a window of four on a four-wide chain, which the wallet never uses. End to end, sending the whole chain was 28 s slower three wide and 11 s faster four wide.
- **Two at a time was never tried.** The harness models only a window of four and the whole chain (branch `src/main.rs:260`: `for window in [4, usize::MAX]`), and the live runs used the same two.

## Impact: why nit, not low

- **Nobody using the shipped build can reach it.** The roadmap isn't shipped: nothing in `extension/src` or `extension/public` references it. Today a user with *Four boxes a mix* sends two at a time on mainnet and preprod, which is the Praos sizing the code means (lovejoin.ts:295–299). The scenario needs a future developer to:
  - act on this note instead of the code;
  - miss `CHAIN_WINDOW_FOUR`, two lines under `CHAIN_WINDOW`;
  - miss `chainWindow(4)` at both places a chain is created;
  - miss lovejoin-mix-width.md:149, which lists both windows ("`CHAIN_WINDOW_FOUR`, two for four-box mixes").

  Even then the result is one more trip through the queue for a four-box chain under Leios: it costs time, never money or privacy.
- **The omission errs in the safe direction.** With the wallet's real two at a time, a deposit and 5 four-box mixes take three trips, not two. Sending the whole chain therefore saves more for four-box mixes, not less, and the note's recommendation holds even more strongly there. No decision taken from the note would go wrong.
- **The numbers are literally true.** The note says "the rest waited for the queue again (120 to 245 s more)", and the second wave did wait 120.0 s and 245.7 s. A reader may infer a saving of that size. One run of each can't show or refute it, because the first wait varied more than the saving does: 153 s to 462 s across these four runs. The README's model puts the expected gain at about two minutes ("a 5-transaction chain a mean of 2.5 to 3 minutes sent whole and 4.5 to 5 minutes four at a time"), which is the low end of the note's range. Only the 245 s top end is overstated, and the wallet never runs that window. That's a wording point.

On the brief's scale, "a misleading doc" is low. This note is right for the default, its numbers are true as stated, and its one omission doesn't change what anyone would decide. So it's a wording precision in a planning note: nit.

## The fix

The proposed text is accurate, but it needs one correction:

1. "the wallet's own two at a time wasn't run" should read "**wasn't run or modelled**". The model never ran a window of two either (main.rs:260). "Run" alone could be read as the live runs only.

It is also three sentences where the note had one clause, and the owner keeps docs compact. A tighter version that keeps every fact:

> a chain's window in flight (`pumpChain`: four, two for four-box mixes) could be the whole chain: four at a time, the rest went out once the first four landed and waited for the queue again (120 s three wide, 245 s four wide). One run each wasn't faster end to end; the model puts the gain at about two minutes. Two at a time wasn't run or modelled.

**What the fix changes or breaks:** nothing outside the doc.
- No test reads post-release-roadmap.md. Of the tests, only `i18n.test.ts` reads `docs/`, and only `docs/i18n`. `words.test.ts` doesn't scan the docs.
- It touches no owner rule: no guard, no UI text, no privacy note and no release date. The note's "Run 2026-10-28" dates a run, not a release, and the fix adds no date.
- It stays off the unmerged `web-wallet/leios-musashi` branch. That branch's README ("the wallet's window of four") and its model's header line ("The wallet sends at most 4 of a chain at once today") have the same omission, but the branch is outside this release and this review.

**Next to it, outside #338 and this range:** architecture.md:319 says "**A chain is sent a window at a time** (`pumpChain`): at most 4 of its transactions wait in the mempool". That doc describes the code and is where an implementer would actually look. It was last changed 2026-10-12 (`a01deb23c`), before `CHAIN_WINDOW_FOUR` arrived (`b9c35f06`, 2026-10-18, chunk 34's 34e, shipped in 1.6.0), so it has been stale since 1.6.0. If the lead touches the window wording, adding "(2 for four-box mixes, `chainWindow`)" there would close the gap in the doc that matters more. It's older than this range, so whether it goes in a 1.7.0 docs touch is the lead's call.

## Repro

- Read the code at HEAD: lovejoin.ts:294–302, :483 and :4628–4635; sessions.ts:4936–4937; preferences.ts:176.
- Read the four run records with `git show origin/web-wallet/leios-musashi:seedelf-leios/results/2026-10-28/<run>.json` and computed each one's totals and wave waits with `python3 -I` (the table above).
- Read the harness's model loop, `src/main.rs:260`, on the same branch.
- No scratch files were written in the tree.
