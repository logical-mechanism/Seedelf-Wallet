# Chunk 51 · The counts at the start

On the untouched worktree, 2026-11-18, before any fix: `35b339f6` (`main` at `cd764fba` plus this folder's first commit, docs only). Each check ran under a 20 GB memory cap.

| Check | Result |
|---|---|
| `cargo test --workspace --locked` | 790 passed, 0 failed, 12 ignored |
| The parts suite (`payment_parts_shapes_test --ignored`, release) | 0 with problems, 108 refused, 0 of them Max |
| `npm run build` (dev) | built; `C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)` |
| `npm test` (Vitest, default build) | 3,306 passed, 4 skipped (264 files, 1 skipped) |
| `VITE_ENABLE_MAINNET=false npm test` | 3,306 passed, 4 skipped |
| `npm run e2e` on the dev build | 109 passed, 1 skipped |
| `npm run e2e` on the store build (`npm run build:store`) | 109 passed, 1 skipped |
| `npm run e2e:data` | 3 passed |

The same as 1.9.1's record on its final tree, which had 790 Rust tests (12 ignored), 3,306 Vitest tests on both builds and 109 e2e tests on each build.

## The lead's B1 checks

- **`npm audit`:**
  - nothing in the shipped dependencies (`--omit=dev`: 0 vulnerabilities);
  - six "high" advisories in the dev tools, all one advisory: picomatch's ReDoS through single-branch repeated extglobs (GHSA-fc5q-39xc-vjpf, `<=4.0.7`), reached through `tinyglobby` and `fdir` under `vite`, `vitest` and `@vitejs/plugin-react`. It's a build-time glob matcher over the project's own patterns, so nothing a stranger or a site reaches. npm's suggested "fix" downgrades vite and vitest a major version. A note, not a finding.
- **`cargo audit`:** not installed on this machine, so not run. The backlog's *Security and dependencies* lists the RustSec advisories Dependabot doesn't raise.
