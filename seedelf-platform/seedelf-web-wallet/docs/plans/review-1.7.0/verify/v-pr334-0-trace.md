# v-pr334-0-trace: pr334#0, item 8's "window of four"

**Verdict: confirmed. Severity: low** (a misleading doc, no effect on money, privacy or the screens). The text came from #338, not #334.

## The claim

`docs/post-release-roadmap.md:409` (HEAD `6bca8bec`):

> **What Leios would change in the wallet:** a chain's window of four in flight (`pumpChain`) could be the whole chain, since four at a time, the rest waited for the queue again (120 to 245 s more).

That's true of three-wide chains, the default. It's wrong for four-box chains, which go two at a time. The 245 s figure was measured at a window of 4 for four-wide mixes, a setting the wallet never uses for them.

## Traced on HEAD

- `extension/src/background/lovejoin.ts:294` `export const CHAIN_WINDOW = 4;`, `:300` `export const CHAIN_WINDOW_FOUR = 2;`, `:302` `export const chainWindow = (width: number) => (width >= 4 ? CHAIN_WINDOW_FOUR : CHAIN_WINDOW);`
- `pumpChain` (`lovejoin.ts:437`) reads the chain's own window: `:483` `const window = chain.window ?? CHAIN_WINDOW;`. The send loop is `while (chain.next < chain.txs.length && chain.flying.length < window)`.
- Only two places start a chain's progress (`grep "flying: \[\]"`), and both give a four-wide chain window 2:
  - The public mix: `lovejoin.ts:4635` `...(built.width === 4 ? { window: chainWindow(4) } : {}),`. It's saved whole (`session.set(SESSION_LOVEJOIN_SENDING + network, sending)`), read back whole (`sendingOf`, `:4871`), and passed to `pumpChain(sending, …)` at `:4738`.
  - A session's return: `sessions.ts:4937` `const window = summary.lovejoin?.width === 4 ? { window: chainWindow(4) } : {};`, then `savePending(…, ...window)`. `pendingChain` (`:5176`) reads it back whole for `pumpChain(pending, …)` at `:5015`.
- Existing tests already pin this. Both pass on HEAD when run alone (`-t`):
  - `tests/lovejoin-planner.test.ts:652` "mixes four at a time where Settings has it, two of them in flight at once": `expect(sending?.window).toBe(CHAIN_WINDOW_FOUR)`, two submitted at Send.
  - `:770` "keeps a four-wide chain's sends two in the mempool at once".
- Other docs say it right: `docs/lovejoin-mix-width.md:149` names both windows, and so does `docs/archive/plans/chunk-34-token-pools.md:755`. Line 409 is the only doc on HEAD that gets it wrong.
- **Where it came from:** `git blame` puts line 409 in `62be5bc4` (PR #338, merge `6bca8bec`). PR #334 (`ae610284`) only added the planning entry. The windows came in `b9c35f06` (chunk 34e), an ancestor of 1.6.0's `babb8e76`, so the line was wrong when it was written.

## The run's records (read-only, `origin/web-wallet/leios-musashi`, not under review)

| Record | Width | Window | Transactions | Landed |
|---|---|---|---|---|
| `1793218263-chain-w3-k4.json` | 3 | 4 | deposit + 4 mixes | the first four at 314.0 s; mix 4 sent at 314.1 s, landed at 434.1 s (**120 s**) |
| `1793219148-chain-w4-k4.json` | 4 | 4 | deposit + 5 mixes | the first four at 153.0 s; mixes 4 and 5 at 397.9 and 398.9 s (**245 s**) |

No chain run used window 2. The other chain records have `"window": null` (sent whole), and the harness's model tries only `[4, usize::MAX]` (`src/main.rs:260`). So:

- **120 s** is the wallet's real three-wide behaviour.
- **245 s** is four wide at a window the wallet doesn't use for four wide.
- The wallet's actual four-wide window was never measured.

The branch's `README.md` has the same wording ("Sent four at a time, as the wallet sends a chain today … 245 s more (4 wide)", lines 121 and 16, 49, 148). Line 409 was copied from there.

## Scratch test (deleted)

I wrote `extension/tests/zz-review-v-pr334-0-trace-1.test.ts`. It drives `pumpChain` with the window each chain start writes, and every poll lands everything in flight, as Musashi's EB took four together.

- Test 1 is the roadmap's claim: a four-box chain (deposit + 5 mixes) has four in flight at once. **It fails on HEAD: `expected 2 to be 4`.**
- Test 2 is the finding's arithmetic, and it **passes**:
  - `chainWindow(4) === 2`.
  - Four wide at the wallet's window: at most 2 in flight, **3** trips through the queue.
  - Four wide at the run's window of 4: **2** trips.
  - Three wide (deposit + 4 mixes) at `CHAIN_WINDOW`: 2 trips.

Result: `Tests 1 failed | 1 passed (2)`. The file is deleted, and `git status` shows only the untracked review folder.

## Narrower than it reads

- Four wide is a Settings option, and three wide is the default. For the default, "window of four" and the 120 s figure are right. Only four wide is misstated.
- The scenario (someone changes `CHAIN_WINDOW` and leaves `CHAIN_WINDOW_FOUR` at 2) is possible but not likely. The two constants sit together at `lovejoin.ts:294-302`, and `lovejoin-mix-width.md:149` lists both. If it happened, the cost is only a slower four-wide chain (one more trip through the queue). No money, privacy or screen is affected. It's future-work text under *Kept in mind*.

## Fix

The proposed fix is accurate. A tighter version in the house style:

> **What Leios would change in the wallet:** a chain's window in flight (`pumpChain`: four, two for four-box mixes, `chainWindow`) could be the whole chain. Sent four at a time, the rest waited for the queue again: 120 s more three wide, 245 s four wide. The wallet sends four wide two at a time, a third trip for a deposit and 5 mixes, which wasn't run.

The unmerged branch's README says the same thing, but it's outside this review. Whether to correct it there is the owner's call.
