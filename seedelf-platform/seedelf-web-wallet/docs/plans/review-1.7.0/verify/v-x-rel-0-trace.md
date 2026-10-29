# v-x-rel-0-trace: x-rel#0, "1.7.0 isn't set"

**Verdict: partly. Severity: low, not high.**

The facts are right. HEAD is still at 1.6.0, and the proposed fix is right. But this is not a defect in #325–#338. It is the release branch's own part 1, which hasn't been run yet. The procedure puts it on this branch, and the plan says the version is cut once the items are in. The scenario needs part 1 skipped, and npm refuses that loudly. Even then the dashboard refuses the upload, so nothing reaches users. The only loss is a local, gitignored, reproducible zip, and development.md:251 already says a same-version `npm run package` overwrites it.

## What's true on HEAD (6bca8bec)

- `extension/package.json:3`, `package-lock.json:3` and `:9` all read `"version": "1.6.0"`.
- `git diff --stat babb8e76..6bca8bec -- extension/package.json extension/package-lock.json` is empty.
- `docs/development.md:181` reads `release_version=1.6.0`, and `:242` reads "With `package.json` at 1.6.0, that file is `extension/release/seedelf-wallet-1.6.0-mainnet.zip`". A grep of the docs finds no other line that carries the current version.
- `scripts/package.mjs:40-41` checks only that the manifest's version matches package.json's. `:118-120` then writes `release/seedelf-wallet-${pkg.version}-${network}.zip` with `writeFileSync`. Nothing checks whether that file already exists, or whether the version is above the last upload.
- `.gitignore:4` ignores `release/`. `sha256sum release/seedelf-wallet-1.6.0-mainnet.zip` gives `6d1219aaa0c463d02da3320f7e3657db34135336cd9ee0c7fe0d0da7c595938f`, the hash `roadmap.md:63` records.
- The bump isn't anywhere else either:
  - `web-wallet/release-1.7.0` is local only and equals `origin/main`. `git ls-remote` shows no remote branch of that name.
  - `gh pr list --state open` is empty.
- No test pins the version. `tests/lovejoin-1-5-0.test.ts:771` reads it only in RECORD mode, to refuse anything but 1.5.0. CI's store step (`web-wallet.yml:128-133`) runs `package.mjs` with no version comparison.

## Why it's narrower than "high, blocks the release"

1. **The procedure does this step on exactly this branch.**
   - `development.md:167`: "The version, the refreshed token and DRep lists and the Lovejoin pools' head start are committed on the release branch (`web-wallet/release-<x.y.z>`) … Change part 1's `release_version` to the new, higher version for each later release."
   - Part 1, `:171-186`, runs `npm version "$release_version" --no-git-tag-version` and then `git diff -- package.json package-lock.json …`.
   - *Releasing to the Web Store* step 1, `:272`, is "Bump the version", and step 6, `:279`, is "Commit and merge: the bump, both lists…".
   - The plan, `post-release-roadmap.md:33`, says "each item lands on `main` on its own branch and PR, and the version is cut once they're in."
   - x-rel's own summary agrees: "What's still missing is release work, not fixes."
2. **Reviewing before the bump has been done before, and the doc lines move on the release branch.**
   - 1.2.0's PR #282: the review's fixes (`4279db80`) come before `774de42a` "chore(web-wallet): 1.2.0", and `4279db80` also moved development.md's version lines.
   - 1.5.0's lines moved in `a01deb23` and 1.6.0's in `478174f9`, both on their release branches.
   - So :181 and :242 holding the last shipped version until the release branch edits them is the pattern, not drift.
3. **An unedited paste of part 1 fails loudly.** I simulated it in a scratch copy of package.json and the lock (npm 11.17.0, `--offline`):
   - `release_version=1.6.0`, then `npm version "$release_version" --no-git-tag-version`, prints `npm error Version not changed` and exits 1. Part 1's own `git diff` would then show no version line.
   - The block has no stop-on-error, so the refreshes still run after that refusal. The person running it has to read the error. This is the only real weak spot.
4. **If part 1 were skipped anyway, nobody is harmed.**
   - The dashboard refuses the upload, as the finding itself says. No money, privacy or wallet state is at stake.
   - The overwritten 1.6.0 zip is a gitignored local copy. The store keeps the real 1.6.0, and the hash is recorded at `roadmap.md:63`.
   - That zip is reproducible: "a second build of the same commit, made apart in a separate clone, gave the same bytes" (`roadmap.md:63`). Rebuilding it from `babb8e76` is optional, not required.
   - `development.md:251` already warns: "The next `npm run package` overwrites a zip of the same version."

## Scratch test (deleted)

`extension/tests/zz-review-v-x-rel-0-trace-1.test.ts` was run alone and gave 1 failed, 3 passed:

- **A failed on HEAD:** "package.json is 1.6.0, the last recorded upload 1.6.0". The upload's version is read from roadmap.md's zip names. This confirms the finding's fact.
- **B passed:** the lock's `version` and `packages[""].version` follow package.json.
- **C passed:** development.md has part 1's `npm version "$release_version" --no-git-tag-version`, the "Change part 1's `release_version`… for each later release" line, step 1 "Bump the version" and step 6 "Commit and merge: the bump". post-release-roadmap.md has "the version is cut once they're in".
- **D passed:** package.mjs has `writeFileSync(out, archive)` and no `existsSync`, and development.md documents the overwrite.

## Fix advice

- **The fix is part 1 itself.** I checked it in a scratch copy: `npm version 1.7.0 --no-git-tag-version` in `extension/` sets package.json:3 and package-lock.json:3 and :9 to 1.7.0 and changes nothing else in the lock. Run it with `npm run tokens`, `npm run dreps` and `npm run lovejoin-pools` as part 1 says, and read the diff.
- **A minor bump is right:** see `development.md:169` and `post-release-roadmap.md:33` ("A minor release rather than a 1.6.1").
- **Docs:** change `development.md:181` and `:242` to 1.7.0. They are the only two such lines. Either the bump commit or the release-prep docs commit works; 1.5.0 and 1.6.0 used the docs commit. No test needs a change.
- **Optional, the owner's call (my idea):**
  - `package.mjs` could refuse to overwrite an existing `release/` zip, or a version not above the last recorded one. That would make the scenario's local damage impossible, but it's a new tooling guard.
  - Part 1's block could chain `npm version … &&` into the refreshes, so an unedited paste stops at "Version not changed" without closing the terminal.
