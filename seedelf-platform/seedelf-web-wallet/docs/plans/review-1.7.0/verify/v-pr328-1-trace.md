# v-pr328-1-trace: pr328#1, Step 0's record of the lock's advisories is behind

**Verdict: partly. Severity: nit.** Confidence: high.

## What holds

Two current-state phrases on HEAD are behind. A scratch test fails on both.

- **`post-release-roadmap.md:93` says rustls is "now 0.23.45".** The lock holds 0.23.46 (`seedelf-platform/Cargo.lock:2270-2271`), since #328.
  - Line 93 was last written in `4279db80` (2026-10-06), when 1.2.0's branch bumped rustls.
  - #329 (`1cd8b06b`) records the new version only at `:35`: "`rustls` 0.23.46 in the lockfile (#328)", with no advisory IDs.
  - The four advisories #328 answers are RUSTSEC-2026-0346 to -0349 (GHSA-c8m5…, -vp88…, -h2v8…, -w44r…). All are patched at `>= 0.23.46` (upstream advisory-db, read today).
- **The doc's "what's still open" omits crypto-bigint 0.5.5, which reaches the shipped module.**
  - `:93` says: "What's still open is the CLI's `h2` and `spin` ([Kept in mind](#kept-in-mind)), which Dependabot doesn't raise."
  - `:419` says: "**The `h2` and `spin` items are still open** … RustSec's rather than Dependabot's … Neither reaches the WebAssembly."
  - Neither line names crypto-bigint, ctutils or tokio.
- **RUSTSEC-2026-0387** (crypto-bigint, 2026-10-23, `crypto-failure`, `patched = [">= 0.7.6"]`, no 0.5 range): "Several operations intended to be constant-time could execute secret-dependent branches … Applications using affected operations on secret integers may leak information".
  - `Cargo.lock:475-476` holds `crypto-bigint` `0.5.5`, which is inside that range.
- **It is in the WebAssembly.**
  - `cargo tree --locked --offline -p seedelf-wasm --target wasm32-unknown-unknown -e normal -i crypto-bigint` gives: crypto-bigint v0.5.5 ← elliptic-curve v0.13.8 ← ecdsa v0.16.9 / k256 v0.13.4 ← uplc v1.1.23 ← seedelf-core ← seedelf-wasm. For the host target the result is "nothing to print".
  - `wasm/pkg/seedelf_wasm_bg.wasm` (3,209,441 bytes) contains `crypto-bigint-0.5.5/src/uint/encoding.rs`, `k256-0.13.4/src/schnorr.rs`, `k256-0.13.4/src/arithmetic/mul.rs` and `ecdsa-0.16.9/src/hazmat.rs`.
- **It is harmless.**
  - `uplc-1.1.23/Cargo.toml:150-154` uses `secp256k1` when `not(target_family="wasm")` and `k256` when `target_family="wasm"`.
  - `src/machine/runtime.rs:1965-1989` is the wasm `verify_ecdsa` / `verify_schnorr`. Each takes `VerifyingKey::try_from(public_key)`, `Signature::try_from(signature)` and `verify_prehash(message, …)`. Every input is a script's public data, and no secret ever reaches the arithmetic.
  - `git grep -E 'k256|secp256k1'` over seedelf-platform's `.rs`, `.toml` and `.ts` files finds nothing.
- **It has no fix now.** elliptic-curve 0.13 needs crypto-bigint 0.5, so a fix waits for a uplc on k256 0.14 (and uplc must stay on the workspace's Pallas).
- **Dependabot hasn't raised any of these.**
  - `gh api "/advisories?ecosystem=rust&affects=crypto-bigint"` and `…ctutils` return nothing.
  - tokio's list has no entry for RUSTSEC-2026-0386.
  - The repo has no open Dependabot alerts.
- **The data layer's two (the source report's N1) are as stated.**
  - `seedelf-data/Cargo.lock:275-276` holds ctutils `0.4.3` (RUSTSEC-2026-0385, 2026-10-23, patched `>= 0.4.4`).
  - `:1250-1251` holds tokio `1.53.2` (RUSTSEC-2026-0386, 2026-10-13, `informational = "unsound"`, patched `>= 1.51.6, < 1.52.0` and `>= 1.53.3`, affecting only the `AsyncFd::{new,with_interest,try_new,try_with_interest}` constructors).
  - tokio's other new advisory, RUSTSEC-2026-0384, is `unaffected = ["< 1.54.0"]`, so it's irrelevant here.

## Narrower or different than stated

1. **`:89` (rand, "the only flagged crate that reaches what users install") is accurate history, not stale.**
   - It is a row of the table at `:81`, "What was triaged, and what each one turned out to be": the 25 Dependabot alerts of 2026-10-02. Among those, rand was the only one in the module.
   - crypto-bigint is a RustSec-only advisory from three weeks later. Leave `:89` as it is.
2. **Step 0 isn't where the doc tracks RustSec-only advisories. *Kept in mind* `:419` is.**
   - Step 0 is titled "a clean dependabot report".
   - `:419` says the h2 and spin items are "RustSec's rather than Dependabot's, so [step 0] never saw them". `:93` only summarises them and links there.
   - The fix belongs mainly at `:419`, with `:93`'s summary sentence updated. The finding's fix appends RustSec items to Step 0 instead, which would split the RustSec record across two sections.
3. **Step 0 isn't kept as a ledger of every bump, so only the current-state wording is a defect.**
   - vite 8.3.3 for launch-editor (Dependabot #93–#95, `1eb5267e`, before 1.6.0) and #327's certifi appear nowhere in the roadmap. Each bump's record is its own PR, and #328's is also on the 1.7.0 list (`:35`).
   - What's wrong is `:93`'s "now 0.23.45" and its "What's still open …". The rest of the paragraph reads as 1.2.0's history, and its other "now" (`source-map-js` 1.2.2) still holds (`extension/package-lock.json:1450-1451`).
4. **The range's code caused only one stale value.**
   - #328 made "now 0.23.45" stale.
   - The crypto-bigint and ctutils advisories (2026-10-23) and tokio's (2026-10-13) came after both lines were written (`:93` on 2026-10-06, `:419` on 2026-10-10). No PR in `babb8e76..6bca8bec` added or moved crypto-bigint: #328 is the range's only lockfile change.
5. **"Dependabot will never alert" overclaims.** It hasn't alerted today, and GitHub's database has no entry for any of the three. GitHub usually skips informational or unsound advisories like tokio's, but it may yet import the crypto-failure ones for crypto-bigint and ctutils.
6. **The data layer's two are N1's.** `seedelf-data/` didn't change in this range. Whether the web wallet's roadmap tracks the data layer's RustSec items is the owner's call. This finding stands without them.
7. **CLI note.** The CLI's tokio `1.52.3` (`Cargo.lock:2944-2945`, native only) is also inside RUSTSEC-2026-0386, and `:419`'s CLI list doesn't name it. Nothing calls the constructors.

## Repro

I wrote a scratch test, `extension/tests/zz-review-v-pr328-1-trace-1.test.ts`, which read `docs/post-release-roadmap.md` and `seedelf-platform/Cargo.lock`. I ran it alone (`npx vitest run …`) and then deleted it.

**Result: 2 failed, 2 passed.**

- Passed: the doc holds both "still open" lines (`:93` and `:419`).
- **Failed:** Step 0's "now" rustls doesn't match the lock (`expected '0.23.45' to be '0.23.46'`).
- Passed: the lock's crypto-bigint is `0.5.5`, which is below 0.7.6.
- **Failed:** neither "still open" line contains `crypto-bigint`.

## Fix advice

No dates and no store status:

- **`:93`:**
  - Change "now 0.23.45" to "now 0.23.45, and 0.23.46 since #328 (RUSTSEC-2026-0346 to -0349, Dependabot #100–#103), still never built".
  - Change "What's still open is the CLI's `h2` and `spin` ([Kept in mind](#kept-in-mind)), which Dependabot doesn't raise." to "What's still open is RustSec's alone, which Dependabot doesn't raise ([Kept in mind](#kept-in-mind))."
- **`:419`:**
  - After "Neither reaches the WebAssembly.", add: "`crypto-bigint` 0.5.5 does (RUSTSEC-2026-0387, patched only in 0.7.6): it comes through `uplc`'s `k256`, which in the WebAssembly only verifies a script's secp256k1 signatures, from public data, so no secret reaches its arithmetic. It waits for a `uplc` on `k256` 0.14, on the workspace's Pallas."
  - Widen the bold lead, "The `h2` and `spin` items are still open", to match.
  - Optional, a CLI note: add the CLI's tokio 1.52.3 (RUSTSEC-2026-0386) to the same list, fixed by `cargo update -p tokio --precise 1.53.3`.
- **The data layer's ctutils and tokio:** record them as N1 decides. That could be beside its runbook or here, at the owner's choice.
- **`:89`:** no change.
