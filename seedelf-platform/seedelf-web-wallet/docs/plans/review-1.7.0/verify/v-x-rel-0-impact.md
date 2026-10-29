# v-x-rel-0-impact: verifying x-rel#0

**Finding:** 1.7.0 isn't set. `package.json`, `package-lock.json` and the procedure's lines still say 1.6.0 (claimed high).

**Verdict: refuted as a defect. Severity: nit.** At most it's a to-do for part 1, and the procedure already schedules it there.

Every fact in the finding is accurate on HEAD (`6bca8bec`). But the version isn't meant to be set yet:

- The procedure bumps the version on the release branch, in part 1. That branch is still at its cut point.
- No user, site or attacker can reach the scenario.
- The shipped build can't carry the old version: a build without the bump can't get past the store.

The proposed fix is right, and it is exactly part 1's first step.

## The facts check out

- `package.json:3`, `package-lock.json:3` and `:9` say `"version": "1.6.0"`. `git diff --stat babb8e76..6bca8bec` on both files is empty.
- #338 touched only `post-release-roadmap.md` (6 lines), as the owner says.
- `development.md:181` is `release_version=1.6.0`, and `:242` says "With `package.json` at 1.6.0, that file is `extension/release/seedelf-wallet-1.6.0-mainnet.zip`."
- `scripts/package.mjs:40-42` checks only that `dist/`'s version matches `package.json`.
- `package.mjs:118-120` writes `release/seedelf-wallet-${pkg.version}-${network}.zip` with `writeFileSync`, over any zip already there.
- `extension/release/seedelf-wallet-1.6.0-mainnet.zip` hashes to `6d1219aaa0c463d02da3320f7e3657db34135336cd9ee0c7fe0d0da7c595938f`, the hash `roadmap.md:63` records for 1.6.0. `.gitignore:4` is `release/`.

## Why it isn't a defect

- **The bump belongs on the release branch, once the items are in.**
  - `development.md:167`: "The version, the refreshed token and DRep lists and the Lovejoin pools' head start are committed on the release branch (`web-wallet/release-<x.y.z>`), with the checks, and reach `main` through its PR … Change part 1's `release_version` to the new, higher version for each later release."
  - `development.md:270`: "Steps 1 to 6 happen on the release branch and are committed in its PR". Step 1 (`:272`) is "Bump the version".
  - `post-release-roadmap.md:33`: "each item lands on `main` on its own branch and PR, and the version is cut once they're in."
  - `web-wallet/release-1.7.0` is `origin/main` at `6bca8bec` and has no commit of its own, so part 1 hasn't started. No PR from #325 to #338 should have bumped the version.
- **Every past release bumped on its own release branch.**

  | Release | Version bump | `release_version` line | Merged through |
  |---|---|---|---|
  | 1.4.0 | `4db0d430` | `3b5aabd4` | |
  | 1.4.1 | `8530f09e` | | |
  | 1.5.0 | `19e30fbe` ("chore(web-wallet): 1.5.0, with the lists refreshed") | `a01deb23` | #306 (`web-wallet/release-1.5.0`) |
  | 1.6.0 | `8cc00445`, together with its review's fix rounds | `030fdcf0` | #321 (`web-wallet/release-1.6.0`) |

- **The doc lines aren't wrong.**
  - `:167` tells the reader to change `:181` for each later release.
  - `:242` states the file name for `package.json` at 1.6.0. That is true on HEAD.

## The scenario, stage by stage

The finding's outcome is the 1.6.0 zip overwritten and the upload refused. To get there, the release has to skip part 1's first step. Only the store hard-stops that, but each stage shows the slip:

1. **Part 1, pasted with the stale line.** `npm version 1.6.0 --no-git-tag-version` prints `npm error Version not changed` and exits 1. I ran it on a scratch copy of the two files.
   - The block has no `set -e`, so the rest of it runs.
   - Its own `git diff -- package.json package-lock.json …` (`:186`) then shows no version change.
2. **Part 2, on a merge without the bump.** `package.mjs:122` prints `seedelf-wallet 1.6.0 (mainnet)`, and `:124` prints the 1.6.0 path.
3. **The upload.** The dashboard refuses a version that isn't higher than the last (`development.md:169`, `:272`). Nothing ships, and no user of any build sees it.

The only cost is the local 1.6.0 zip, overwritten by 1.7.0's code under 1.6.0's name. Little is lost:

- Its SHA-256 is recorded (`roadmap.md:63`).
- The build is reproducible from `babb8e76`. The same line says "a second build of the same commit, made apart in a separate clone, gave the same bytes", and this machine runs the same Node, 24.19.0.
- The store can't take a 1.6.0 upload again anyway.
- `development.md:251` documents the overwrite on purpose.

"Has to be rebuilt" overstates it: only if someone wants the local copy back.

By the brief's scale this is a reminder, not a defect. It doesn't block the release, because the release's own first step does the bump.

## The fix

**It is right and minimal, as part 1's first step rather than a fix round's.**

- I ran `npm version 1.7.0 --no-git-tag-version` on a scratch copy. It changes exactly `package.json:3`, `package-lock.json:3` and `:9`, and nothing else.
- `package.json` has no `preversion`, `version` or `postversion` script, so nothing else runs.
- **1.7.0 is the right number.** `post-release-roadmap.md:33`: "A minor release rather than a 1.6.1: its way out of the collateral's mix is a new control, and its pool check a new request with its own entry in the privacy policy."
  - The finding's "two new controls" isn't what the list says: it names one control and one request.
  - #335's stepper could count as a second control. The number stands either way (`development.md:169`).
- Change `development.md:181` to `release_version=1.7.0`, and `:242` to 1.7.0. They need to land in the same PR as the bump, not necessarily the same commit: 1.6.0 had them in separate commits of #321.
- Do it with the rest of part 1:
  - `npm run tokens`;
  - `npm run dreps`;
  - `npm run lovejoin-pools`, after `tokens` (`:276`);
  - the data layer's decimals (`:274`).

**Nothing else changes with it.**

- The manifest and the About line take the version from `package.json` (`vite.config.ts:106` and `:112`, into `sw.ts:302`).
- The e2e reads the version from `package.json` (`e2e/extension.spec.ts:1238`), so the bump can't break it. Its comment says that when the version was written out, it "broke this test at every release" (found bumping to 1.1.0).
- `tests/lovejoin-1-5-0.test.ts:771` reads the version only under `RECORD`.
- `tests/third-party.test.ts` uses its own made-up versions.
- Nothing reads `development.md`'s `release_version`.
- `chrome.runtime.onInstalled` calls `applyKept` (`sw.ts:328`) on any update, whatever the number.

**Not part of the fix:** a `package.mjs` check that the version is higher than the last upload, or a refusal to overwrite an existing zip. Either would be a new guard. That makes it an owner's call, and the idea is mine, not the finding's. I wouldn't recommend either:

- The overwrite is documented (`:251`).
- Packaging the same version again is part 2's normal path, after a failed e2e or for a rebuild.
- The store already refuses a version that isn't higher.

**Why bump early on the branch anyway:** until the bump, any `npm run package` in this tree writes over the shipped 1.6.0 zip. The session notes say this happened to 1.4.1's zip once, through CI's store step run in the main tree, and it was restored from `fd412c0`. The stakes are low, as above.

## Aside, not judged here

The list's marks for items 4 to 7 (`post-release-roadmap.md:38-41`) still read 🚧 or ⬜. #333, #335, #336 and #337 never touched `post-release-roadmap.md`. If no other finding covers this, it belongs in the same release-branch docs pass.

## Scratch work

- I ran `npm version` (`--offline`) on copies of `package.json` and `package-lock.json` in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-x-rel-0-impact/`.
  - `1.6.0` gave `npm error Version not changed`, exit 1.
  - `1.7.0` gave `v1.7.0` and a three-line diff.
- The scratch copies were deleted before I returned.
- This report is the only file I wrote in the tree.
