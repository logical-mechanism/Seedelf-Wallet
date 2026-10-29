# v-x-rel-3-impact: x-rel#3, the refreshes and the e2e's "mainnet bundles none"

**Verdict: partly. Severity: low.** It affects only the release's tests, not users. The finding's mechanism is right. Its first half is a release step that hasn't come up yet, not a defect. Its proposed e2e edit is wrong in the likeliest case. It also misses a second test that assumes mainnet's head start is empty.

## What holds

- **The refreshes last ran in `8cd8ce08`, 1.6.0's commit.** `git log -1 -- src/tokens src/dreps src/lovejoin-pools.json` shows it. `seedelf-data/api/data/token-decimals.json` last changed in `c2396d45`.
- **The range touches none of what the refreshes write, nor their scripts.** `git diff --stat babb8e76..6bca8bec` over `src/tokens`, `src/dreps`, `src/lovejoin-pools.json`, `scripts/` and `seedelf-data/` is empty.
- **#336 doesn't change what the writer finds.** It moved the launch check out of `holder()` into `launched()` unchanged. `upTo` is now computed from `unknown` the same way as before.
- **A bundled mainnet token pool turns the hub into a grid.**
  - `known()` hands every head-start pool over with no request (`lovejoin-pools.ts:278`), so the pool is in every status.
  - The hub is a grid once `groups.length > 1` (`Lovejoin.tsx:1995`).
  - `PoolGrid` renders tiles only (`lovejoin-token-…`). The classic row's id, `lovejoin-pool-classic`, is rendered only by `PoolGroupList` (`Lovejoin.tsx:2255`).
  - So `e2e/extension.spec.ts:3389` fails: `await expect(page.getByTestId("lovejoin-pool-classic")).toContainText("Being started: 0 of 30 boxes")`.
- **Only that e2e case depends on mainnet's head start.** It's the only case that chooses mainnet (`:3380`). `data-layer.spec.ts` and `store-images.spec.ts` never open Lovejoin. A restore reads no pool either: e2e:data's second case expects exactly 2 `credential_utxos` with the index down.

## What's wrong or missing

1. **The first half describes the release steps, not a defect.**
   - `development.md` part 1 already runs the refreshes on the release branch (`:181–187`), with steps 2–3 (`:273–276`) saying what to read and record. Right after, it runs `npm test`, `VITE_ENABLE_MAINNET=false npm test` and `npm run e2e` (`:193–195`).
   - So either test break below shows locally before the PR opens, then again in its CI.
   - Nothing reaches a user: the grid is the intended UI ("the owner's test of 1.6.0").
2. **The proposed edit, "open ADA's tile first", fails in the likeliest case.**
   - `tileOpens` (`Lovejoin.tsx:2165`) is `g.pools.length === 1 ? { pool: g.pools[0]!.id } : { token: g.key }`.
   - If mainnet gains a token pool but no second ADA pool, ADA's tile opens the classic pool's page directly. The classic row and the "Being started" line then appear nowhere, so `:3389` and its `.click()` at `:3390` still fail after that edit.
   - Opening ADA's tile reaches the row only when ADA also has a second pool. That's how preprod works today (`classicRow`, `:3201`: "ADA's two pools open ADA's own list").
3. **A second test assumes mainnet's head start is empty.**
   - `tests/lovejoin-1-5-0.test.ts:804`: `expect(f.funding.collateralPool, …).toBe(f.network === "preprod" && f.depth > 0 ? fivePool.id : undefined)`. Its comments at `:666` and `:802` say "none on mainnet".
   - `funding()` names the first ADA pool at 5 ₳ that isn't a copy (`lovejoin.ts:3403`).
   - So a 5 ₳ ADA pool in mainnet's head start fails this test on both Vitest builds. That's exactly the kind of pool #337's *Bring the rest back now* waits for on mainnet.
   - A token pool doesn't affect this test, and a 5 ₳ ADA pool doesn't affect the e2e.

## Can it happen?

- **I couldn't tell whether a mainnet pool exists.** I made one Koios GET, `script_utxos?_script_hash=288fea77…` (the holder). Mainnet answered `[]`. Preprod answered 1 row with no assets, none of its 3 bundled pools' reference UTxOs. So that endpoint doesn't list the holder's outputs, and the mainnet answer proves nothing. I made no further request.
- `post-release-roadmap.md:394`, written in #329, says "Mainnet has no token pools yet".
- Any 1.6.0 user can start a pool. So this can happen at this release's refresh, and at every later one.

## Severity

**Low.** It's an edge case in the release process:
- the refresh can make one or two tests fail in the release PR, which costs a fix round;
- if the PR is merged through the bypass (x-rel F3), `main` goes red before packaging, and part 2's store-build `npm run e2e` catches the e2e case there.

Nothing ships wrong, so "blocks the release" doesn't apply. The first half alone would be a nit.

## Fix advice

- **Run the refreshes as `development.md` part 1 has them.** The only ordering constraint is `lovejoin-pools` after any edit to `list.json`. `tokens.mjs` writes `registry.*.json` alone, so the finding's order and the doc's order both work.
- **The decimals, the deploy and the handoff note:** as documented (steps 2, 7 and 12). Nothing to change.
- **Better than editing the tests after a break:** have both tests read the bundled `src/lovejoin-pools.json` instead of assuming mainnet's part is empty. `8cd8ce08` already did this for the head-start case. Then no refresh needs a test edit.
  - **e2e, the Bootstrap case (`:3389–3390`):**
    ```ts
    const bundled = headStart.mainnet.pools; // src/lovejoin-pools.json
    const grid = bundled.some((p) => p.token);
    if (grid) await page.getByTestId("lovejoin-token-ada").click();
    if (!grid || bundled.some((p) => !p.token)) {
      await expect(page.getByTestId("lovejoin-pool-classic")).toContainText("Being started: 0 of 30 boxes");
      await page.getByTestId("lovejoin-pool-classic").click();
    } // else ADA's tile opened the classic pool's page itself (tileOpens)
    ```
    Then reword the comment at `:3201`.
  - **Vitest, `lovejoin-1-5-0.test.ts:804`:** expect `f.depth > 0 ? fiveOn(f.network) : undefined`, where `fiveOn(n)` is the id of the bundled pool on `n` with no token and `boxLovelace` of `"5000000"`. Reword `:666` and `:802`.
- **Within the owner's rules:** this touches tests only. No guard, UI text or privacy note changes.
- **Side effect:** the e2e then reads the source JSON while it tests `dist/`. The two match whenever `dist/` is built from the same tree, as in CI and in both parts.

## Repro

- **Mutation check, in a scratch copy outside the tree:**
  - I put preprod's bundled 5 ₳ pool into mainnet's head start, re-tagged for mainnet. Its holder addresses' header went from `0x70` to `0x71` and the prefix from `addr_test` to `addr`. The script is `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-x-rel-3-impact/retag_v-x-rel-3-impact.py`.
  - `tests/lovejoin-pools-head-start.test.ts` passes on it: it's a valid mainnet head start.
  - `tests/lovejoin-1-5-0.test.ts -t "but what a shown pool adds of its own"` fails: `AssertionError: mainnet 1: expected '18c4df7733af269d…' to be undefined` at `:804`. It fails the same way under `VITE_ENABLE_MAINNET=false`.
  - The control, with the head start unchanged, passes.
  - With preprod's MIN pool re-tagged instead (a token pool), both of the gate's head-start cases pass.
- **Scratch hub test** (`tests/zz-review-v-x-rel-3-impact-1.test.ts`, deleted): 4 of 4 pass.
  - No pool bundled: rows, with the classic row saying "Being started: 0 of 30 boxes".
  - One token pool: a grid, with no `lovejoin-pool-classic` and no "Being started" anywhere. `tileOpens(ADA)` is `{ pool: undefined }`.
  - A token pool and a 5 ₳ pool: `tileOpens(ADA)` is `{ token: "ada" }`.
  - A 5 ₳ pool alone: still rows, with the classic row.
