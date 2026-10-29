# v-x-rel-3-trace: x-rel#3 (x-rel's F4), traced on HEAD 6bca8bec

**Verdict: partly. Severity: low.** The e2e's assumption is real and breaks exactly as the finding describes. The rest is narrower than the finding says, and its e2e fix is wrong for mainnet's likely case.

## What holds

**The refreshes haven't run since 1.6.0.** `git log -1` shows `8cd8ce08` for `src/dreps/*` and `src/lovejoin-pools.json`. `registry.*.json` and `list.json` last changed at `d5bb3c21`, and 1.6.0's refresh left them unchanged. `token-decimals.json` last changed at `c2396d45`. Nothing in `babb8e76..6bca8bec` touches any of them.

**What each script writes is as stated:**
- `scripts/tokens.mjs:102` writes `registry.<network>.json` from Koios `asset_info`.
- `scripts/dreps.mjs:34,38` makes up to 3 passes and refuses a loss over 5%.
- `tests/lovejoin-pools-head-start.test.ts` writes the head start with `PoolDiscovery({… headStart: () => ({ height: 0, pools: [] }) })`, then `scan`, then `known`.
- #336 moved the launch check into `launched()` with the same logic (`git diff 473b7f1a^1 473b7f1a`). Only the bookkeeping for `upTo` and `unknown` changed shape.
- All of #336's new tests go through the `discovery()` helper, which injects `head`.

**The e2e break:**
1. A pool in the head start reaches the hub with no request. `background/lovejoin-pools.ts:352` merges `head.pools` into what's kept. `known()` (278) hands them over. `serviceDeps.pools` (597-601) swallows the data layer's `IndexDown` (`refresh`, 426-428) and returns them anyway. The ordinary e2e builds carry the live data layer's origin, which the harness doesn't answer (`web-wallet.yml` comment at 116-118).
2. `readSet` (`lovejoin.ts` ~2697) keeps every pool that verifies, and the head-start test verifies every bundled pool on its own network. `status()` lists every non-copy token pool (`lovejoin.ts:5869`).
3. `groups.length > 1` puts the hub into `PoolGrid` (`Lovejoin.tsx:1995`). The grid renders only `lovejoin-token-*` tiles (2194). `lovejoin-pool-*` exists only in `PoolGroupList` (2255).
4. So `e2e/extension.spec.ts:3389`'s `getByTestId("lovejoin-pool-classic")` finds nothing, and so does the click at 3390.
5. The test runs in both CI e2e runs, with retries 0. The dev build enables mainnet by default (`vite.config.ts:94`), the store build sets it, and `playwright.config.ts:9,14` runs `extension.spec.ts` in both.

## What's narrower

1. **"Haven't run" isn't a defect.** The refreshes are steps 2 and 3 of the release path, done on the release branch after this review (`development.md:167, 183-186, 271-276`). This tree is `origin/main` before release prep.
2. **The break depends on chain state I didn't check.** It needs a mainnet token pool of a listed token, launched after block 14110720 and standard. Mainnet bundles 0 pools today. I made no mainnet read, per the brief. The release prep's `git diff -- src/lovejoin-pools.json` will show whether mainnet's `pools` gained a token pool.
3. **It can't ship broken.** The release PR's own CI fails both e2e runs before the merge, and step 6 (`development.md:279`) merges only once that check is green on every step. "Main goes red" needs a bypass merge, which is F3's own finding. Even then, step 9 runs `npm run e2e` on the store build before the upload. The cost is one red CI run and a test edit.
4. **The fix's step is wrong for mainnet's likely case.** ADA's group there would hold the classic pool alone. `tileOpens` (`Lovejoin.tsx:2165-2166`) opens a one-pool tile's pool page directly (`poolNamed(pools, undefined)`, 1889). So after clicking ADA's tile, there is no ADA list, no `lovejoin-pool-classic` row and no "Being started" line. Going through ADA's list works only if a mainnet ADA pool at another amount is bundled too.
5. **Not affected:** `data-layer.spec.ts`'s exact `credential_utxos` counts. That spec never opens Lovejoin, and Home's `lovejoin-held` asks nobody (`lovejoin.ts:6096-6097`).

## Repro

`extension/tests/zz-review-v-x-rel-3-trace-1.test.ts`: 3 passed, 1 failed. The file is deleted.
- **Passed:** a PoolDiscovery whose mainnet head start bundles a token pool, with an index that throws `IndexDown`, hands the pool over through `serviceDeps(...).pools("mainnet")` with zero Koios requests.
- **Passed (control):** HEAD's empty mainnet head start renders the hub section as `Lovejoin.tsx:1995` does: 1 group, and the classic row reads "Being started: 0 of 30 boxes".
- **Failed:** the e2e's own assumption. With a mainnet DJED pool in the status there is no `lovejoin-pool-classic` element (`undefined`).
- **Passed:** what shows instead. Groups are `["ada", DJED]`, `lovejoin-pool-grid` and `lovejoin-token-ada` are present, no "Being started" appears, and `tileOpens(ada)` is `{ pool: undefined }`.

## Fix advice

- Run the refreshes in the order the finding gives, and read each diff.
- For the e2e, make `classicRow` decide by what's on screen, not by network:
  - If `lovejoin-pool-grid` shows, click `lovejoin-token-ada`.
  - If the title is then "ADA", return the row. Otherwise the classic pool's page is already open, so skip the row click.
  - `poolToHub` already reads the title this way.
- Make the mainnet test's hub assertion at 3389 hold only for the rows layout. In the grid, the tile says "1 pool", and the page's `lovejoin-bootstrap-progress` ("0 of 30 boxes not yours so far") already covers the progress.
- This can land before the refresh, so the e2e no longer depends on what the head start bundles.
- Fix `classicRow`'s comment ("Mainnet bundles none") in the same change.
