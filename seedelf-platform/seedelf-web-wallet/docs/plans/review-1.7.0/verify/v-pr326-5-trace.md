# v-pr326-5-trace: verifying pr326#5

**Verdict: partly, nit.** All three facts are true on HEAD, but only one part is a defect:

- **The links are the real part.** Two links name the old homes of tor-js and of the Ethereum Foundation's site, and they work only through redirects.
- **The branch pointer is how this doc records where work happened.** The branch's only commit is the spike's whole record, the same text that's on `main`. A reader who follows it loses nothing.
- **The `/tmp` clone isn't a doc defect.** The doc never points at it, and the `8977093` pin can be fetched from GitHub.

## Where the lines came from

- HEAD is `6bca8bec`. Lines 333, 334 and 345 of `docs/post-release-roadmap.md` are where the finding puts them.
- `git blame -L 333,347 HEAD` gives `a7abf961` for every line, which is PR #326. #338's diff changes 6 lines, all in item 8, and none in the Tor section.

## The checks

### 1. The links (read-only `curl -L` and `gh api`)

**tor-js's repository**
- `https://github.com/privacy-ethereum/tor-js` returns a 301 to `https://github.com/ethereum/tor-js`, which answers 200: one redirect.
- `gh api repos/privacy-ethereum/tor-js --jq .full_name` gives `ethereum/tor-js`, so the repository was transferred.

**tor-js names its new home, at the pin**
- `gh api repos/ethereum/tor-js/contents/package.json?ref=89770931…`:
  - line 3: `"version": "0.4.3"`
  - line 72: `"url": "git+https://github.com/ethereum/tor-js.git"`
  - `homepage` and `bugs` also name `github.com/ethereum/tor-js`
- The CHANGELOG at the same ref, under 0.4.2 (lines 78–79): "Repository, homepage and issue links now point at [ethereum/tor-js](https://github.com/ethereum/tor-js)."
- So 0.4.3, the version the doc says it read, already named the new home. The link text "privacy-ethereum/tor-js" was stale when it was written.

**The Ethereum Foundation's workstream page**
- `https://privreads.ethereum.foundation/workstreams/torjs` takes two redirects:
  1. a 301 to `https://reads.ethereum.foundation/workstreams/torjs`
  2. a 301 from GitHub Pages, adding the trailing slash, to `…/torjs/`, which answers 200
- `host privreads.ethereum.foundation` shows it is an alias for `redirects.ethquokkaops.io`, a host that only redirects.

**The section disagrees with itself.** Line 334 already links the new domain, `https://reads.ethereum.foundation/foundations/connectivity/`, which answers 200 with no redirect.

**The section's other links answer directly** (200, no redirect):
- DigitalOcean's acceptable use policy, line 339
- Nym's mixFetch, line 345

### 2. The branch, `web-wallet/tor-spike`

**The facts are as the finding says:**
- `origin/web-wallet/tor-spike` is `a7abf961`. The local branch and `gh api …/branches/web-wallet%2Ftor-spike` agree.
- `git log babb8e76..origin/web-wallet/tor-spike` lists `a7abf961` alone.
- `git rev-list --count origin/main..origin/web-wallet/tor-spike` is `0`. `a7abf961` is the second parent of `5abd5470`, the merge of #326, so everything on the branch is on `main`.

**It isn't a defect as the scenario describes it:**
- Naming the branch is how this doc records where work happened. *How this file works* (line 9) says each chunk takes "a branch `web-wallet/<topic>` from `main`".
- The roadmap names three branches with "on `…`":
  - `web-wallet/doc-review` (line 320) is no longer on origin.
  - `web-wallet/leios-musashi` is 2 commits ahead of `main`, and stays unmerged on purpose.
  - `web-wallet/tor-spike` is 0 commits ahead.
- The spike committed no code. #326's description says "No code, no tests touched", so the roadmap edit is the spike's whole record. The reader in the scenario "finds only the roadmap edit", and that edit is the notes they expected to find.

**What's left is wording.** "a look at tor-js's source on `web-wallet/tor-spike`" can be read as "the source is on the branch".

### 3. The clone

- The only copy is `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6b05df79-ccf4-4e6d-9648-1dad8d04a5d0/scratchpad/dl-torjs/tor-js`:
  - a shallow clone at `89770931a1029f2f7b47dc45632f1112b8b0e603`
  - its remote is `https://github.com/privacy-ethereum/tor-js`
- `seedelf-platform/_reference/` holds only Lovejoin and lace.
- `findmnt /tmp` shows tmpfs, so a reboot drops the clone.
- This isn't a doc defect. The doc never cites the clone, and the pin is public: `gh api repos/ethereum/tor-js/commits/89770931…` returns the commit (2026-10-23, "Merge pull request #21 from 0xmatthewb/feat/bootstrap-from-config"). Anyone can read the same source again.

## Scratch test

`extension/tests/zz-review-v-pr326-5-trace-1.test.ts`, run alone, then deleted.

1. **The cited lines are on HEAD as quoted.** Passed.
2. **The roadmap has no `github.com/privacy-ethereum/` or `privreads.ethereum.foundation`.** Failed on HEAD, with `["334: github.com/privacy-ethereum/", "345: privreads.ethereum.foundation"]`.

The redirects themselves were decided by the `curl` trace above, since a test shouldn't reach the network.

## Fix

- **Line 334:** `[ethereum/tor-js](https://github.com/ethereum/tor-js)`. Change the link text and the URL.
- **Line 345:** `https://reads.ethereum.foundation/workstreams/torjs/`.
- **Line 333:** the branch can stay, since naming it is how this doc records where work happened. A rewording is optional. Either of these avoids the misreading:
  - "a look at tor-js's source (2026-10-27, on `web-wallet/tor-spike`)"
  - name the record: "tor-js's source at `8977093`"
- **The clone:** nothing to do. The pin is the record, so the clone can be thrown away.
- **Outside the tree:** the auto-memory note `tor-spike.md` also says `github.com/privacy-ethereum/tor-js`.
