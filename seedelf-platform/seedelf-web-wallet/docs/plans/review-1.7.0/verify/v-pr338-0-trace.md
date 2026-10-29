# v-pr338-0-trace: pr338#0, the Leios entry's "window of four"

**Verdict: partly. Severity: low** (a nit would also be fair).

## What's real

The window half is right, and so is the 245 s figure's source.

- `post-release-roadmap.md:409` says "a chain's window of four in flight (`pumpChain`) could be the whole chain, since four at a time, the rest waited for the queue again (120 to 245 s more)".
- On HEAD, four applies only to three-box chains:
  - `lovejoin.ts:294`: `export const CHAIN_WINDOW = 4;`
  - `lovejoin.ts:300`: `export const CHAIN_WINDOW_FOUR = 2;`
  - `lovejoin.ts:302`: `export const chainWindow = (width: number) => (width >= 4 ? CHAIN_WINDOW_FOUR : CHAIN_WINDOW);`
- Only two places start a chain's progress (grep for `flying: []`), and both pass `chainWindow(4)` for four-box mixes:
  - a public mix, `lovejoin.ts:4635`: `...(built.width === 4 ? { window: chainWindow(4) } : {}),`
  - a session's return, `sessions.ts:4937`: `const window = summary.lovejoin?.width === 4 ? { window: chainWindow(4) } : {};`
- `pumpChain` uses `const window = chain.window ?? CHAIN_WINDOW;` (`lovejoin.ts:483`).
- `lovejoin-planner.test.ts:664` and `:770-786` already pin two for four-box chains.
- `lovejoin-mix-width.md:149` says this correctly, so HEAD's two docs disagree.
- The 245 s comes from `1793219148-chain-w4-k4.json` on the unmerged branch. That run was `"window": 4` with `"width": 4`. The wallet never sends a four-box chain that way.
- The harness never ran a window of two:
  - its model loops `for window in [4, usize::MAX]` (branch `src/main.rs:260`);
  - the live runs are only `k4` or whole (`"window": 4` / `null`).

## What's narrower

The timing half doesn't show a false statement.

- The doc's 120 s and 245 s are exactly what it says they are: how long "the rest waited for the queue again". The run records:
  - w3-k4: the first four landed at 314.04 s. Mix 4 was sent at 314.11 s and landed at 434.11 s.
  - w4-k4: the first four landed at 153.05 s. Mixes 4 and 5 were sent at about 153.1 s and landed at 397.92 s and 398.86 s.
- The doc never claims an end-to-end saving. The finding's totals are correct:
  - 3 wide: 462 s sent whole against 434 s four at a time.
  - 4 wide: 388 s against 399 s.
- One run each can't show a saving or rule one out. The first trip alone took anywhere from 153 s to 461 s across these four runs under IO's load. Within each four-at-a-time run, the second trip is a direct measure of what waiting twice cost.
- The expected gain is from the model. The branch README says "a 5-transaction chain a mean of 2.5 to 3 minutes sent whole and 4.5 to 5 minutes four at a time".
- So the real defect here is only where the 245 s comes from. The error points the safe way: the entry *understates* today's cost for four-box chains. Two at a time means three trips, not two. No decision would go the wrong way because of it.

## Scratch test

`extension/tests/zz-review-v-pr338-0-trace-1.test.ts` (now deleted) drove the real `pumpChain` with a fake queue modelled on Leios. Everything in the mempool lands together 60 s after the first of it goes in, and each chain's window is set the way both start sites set it.

| Case | Result on HEAD |
|---|---|
| A deposit and 4 three-box mixes, four at a time (control) | 2 trips, passed |
| Any chain sent whole (control) | 1 trip, passed |
| A deposit and 5 four-box mixes, expecting the roadmap's 2 trips | **failed: 3 trips** |
| `chainWindow(4)` expected to equal `CHAIN_WINDOW` | **failed: 2 vs 4** |

## Mutation check

Done in a copy under the scratchpad, now deleted. Raising `CHAIN_WINDOW` alone to 1000, as scenario step 1 does:

- the three-box chain went whole, in 1 trip;
- the four-box chain still went two at a time, in 3 trips;
- both expectations passed.

Steps 1 to 3 of the scenario hold. Step 1 is still a hypothetical misreading: `CHAIN_WINDOW_FOUR` and `chainWindow` sit right below `CHAIN_WINDOW` with their own comment, and the entry is about a Leios-era change that comes after a Pallas update.

## Fix

The proposed text is accurate, including "about two minutes", which is the model's figure for a 5-transaction chain. A shorter version in the house style:

> a chain's window in flight (`pumpChain`: four, or two for four-box mixes) could be the whole chain: sent four at a time, the rest went out once the first four landed and waited for the queue again (120 s more 3 wide, 245 s 4 wide, one run each; four-box mixes' two at a time, a third trip, wasn't run).

If you want the end-to-end caveat as well, add "the model puts the gain at about two minutes under load".

Out of scope, for the owner only: the unmerged branch's `seedelf-leios/README.md` (lines 16, 49, 121 and 148) and its model's report header (`main.rs`: "The wallet sends at most 4 of a chain at once today") make the same claim. They aren't part of this release.
