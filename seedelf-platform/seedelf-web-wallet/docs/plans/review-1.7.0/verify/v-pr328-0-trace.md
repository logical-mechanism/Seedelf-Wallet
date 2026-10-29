# v-pr328-0-trace: verifying `pr328#0`

**Finding:** the data layer's lock carries ctutils 0.4.3 (RUSTSEC-2026-0385) and tokio 1.53.2 (RUSTSEC-2026-0386), and Dependabot never raises either.

**Verdict: partly.** **Severity: nit.** Not a 1.7.0 gate item.

## In short

The lock entries and the two advisories are real, and so is the missing GitHub advisory entry that keeps Dependabot quiet. `cargo deny` fails on `seedelf-data` for exactly these two, and a one-entry lock bump clears each.

The scenario's technical core is wrong, though. The finding says the ctutils compare is "reachable, through Postgres SCRAM" and that "on 0.4.3 that compare may branch". The SCRAM compare never runs any code RUSTSEC-2026-0385 is about, and its code is byte-identical in 0.4.4. Neither advisory's flagged code runs anywhere in the data layer, so the bump is report hygiene and changes nothing the binary does.

Scope: `seedelf-data/` didn't change in `babb8e76..6bca8bec`. Its lock last changed in `6e7e2d49` (2026-10-17), so this is pre-existing and not from PR #328, which edited `seedelf-platform/Cargo.lock` only. The data layer also isn't in the 1.7.0 package.

## What holds (confirmed on HEAD `6bca8bec`)

### The lock entries

- `seedelf-data/Cargo.lock:275-276`: `name = "ctutils"` / `version = "0.4.3"`.
- `seedelf-data/Cargo.lock:1250-1251`: `name = "tokio"` / `version = "1.53.2"`.
- The `0.4.4` at line 270 belongs to `cryptoxide`.

### The advisories

RustSec advisory-db was shallow-cloned on 2026-10-28 (`40f5be6f`). The machine's own DB stops at 2026-09-25 and holds neither advisory.

- **`crates/ctutils/RUSTSEC-2026-0385.md`:** dated 2026-10-23, `patched = [">= 0.4.4"]`, categories `crypto-failure`.
- **`crates/tokio/RUSTSEC-2026-0386.md`:**
  - dated 2026-10-13, `informational = "unsound"`;
  - `patched = [">= 1.51.6, < 1.52.0", ">= 1.53.3"]`;
  - affected functions: `AsyncFd::{new, with_interest, try_new, try_with_interest}`.

### cargo-deny

`cargo deny --frozen check --disable-fetch advisories` (0.19.4) ran on a `git archive HEAD` copy of `seedelf-data` against that DB. It reports exactly two errors and nothing else:

- `error[vulnerability]: Non-constant-time mask generation and u128 comparisons … ctutils 0.4.3 … RUSTSEC-2026-0385`
- `error[unsound]: AsyncFd::new and related constructors violate I/O safety … tokio 1.53.2 … RUSTSEC-2026-0386`

### The dependency chain

`cargo tree -i ctutils` gives: ctutils 0.4.3 ← digest 0.11.3 ← hmac 0.13.0 / md-5 0.11.0 / sha2 0.11.0 ← postgres-protocol 0.6.12 ← tokio-postgres 0.7.18 ← deadpool-postgres / seedelf-data-api. digest is the lock's only ctutils dependent.

### Why Dependabot stays quiet

- **No GitHub entry:** `gh api "/advisories?ecosystem=rust&affects=ctutils"` returns 0, for reviewed and for unreviewed advisories. tokio's newest advisory is `GHSA-5wjr-9356-4wc8` (2026-10-23, the `= 1.54.0` `Interval` race, patched in 1.54.1). It has no `AsyncFd` entry, reviewed or unreviewed.
- **The pieces that would alert are in place:**
  - Dependabot alerts are on: `GET repos/…/vulnerability-alerts` answers `204`.
  - The dependency graph does include the data layer's lock. Its SBOM lists ctutils 0.4.3, tokio 1.53.2, deadpool-postgres 0.14.2, tokio-postgres 0.7.18 and postgres-protocol 0.6.12.
  - So the missing GitHub entry is the only reason no alert shows.
- **No other route:** no Dependabot alert has ever touched `seedelf-data`. There's no `.github/dependabot.yml` (so no version-update PRs), and no workflow runs `cargo audit` or `cargo deny`.
- **The owner relies on these alerts:** PR #328 is literally "for Dependabot #100-#103".

### tokio's constructors have no caller

- `AsyncFd` appears in none of the 176 registry crates in the data layer's lock outside tokio, and nowhere in `seedelf-data/api/`. The search was for any use at all, not only the four names.
- tokio 1.53.2 doesn't call the four constructors itself either.

### The fix is a one-entry bump

`cargo update --dry-run` ran in the scratch copy, which stayed byte-identical to the tree's lock:

- `-p ctutils`: `Updating ctutils v0.4.3 -> v0.4.7`.
- `-p tokio --precise 1.53.3`: `Updating tokio v1.53.2 -> v1.53.3`.
- Plain `-p tokio`: `v1.53.2 -> v1.54.1`.

The crates.io index has ctutils 0.4.4, 0.4.5 and 0.4.6 (`cmov ^0.5.3`) and 0.4.7 (`cmov ^0.5.4`; the lock already has cmov 0.5.4). For tokio, 1.53.3 is fine, 1.54.0 is yanked and 1.54.1 is fine.

## What doesn't hold

### 1. The SCRAM compare never reaches the code RUSTSEC-2026-0385 is about

What 0.4.4 changed (a diff of the published 0.4.3 and 0.4.4 crates; 0.4.4 was downloaded to scratch and only diffed):

- **The mask builders:** `Choice::to_u{8,16,32,64,128}_mask` went from `self.0` to `self.to_u8()` (black_box). They're used only by `select_u*`.
- **32-bit targets only:** `from_u128_{lt,le}`, and `CtLt`/`CtGt` for `u128`.
- **The changelog says the same:** "Fix and verify `Choice::to_*_mask` constant-time codegen (#1567)" and "Fix constant-time `u128` comparisons on 32-bit targets (#1568)".
- **Not touched:** `src/traits/ct_eq.rs` is byte-identical between the two releases.

The path the finding names never touches that code:

1. `postgres-protocol-0.6.12/src/authentication/sasl.rs:300`: `hmac.verify_slice(&verifier)`.
2. `digest-0.11.3/src/mac.rs:144`: `self.finalize_fixed().as_slice().ct_eq(tag)`, which is `CtEq for [u8]`.
3. `ctutils-0.4.3/src/traits/ct_eq.rs:65-67` dispatches to `T::ct_eq_slice`. For `u8` that is overridden at `:97-102` as `a.cmoveq(b, 1, &mut ret.0)`: cmov, not `Choice`'s mask builders.
4. `cmov-0.5.4/src/slice.rs:208-228`, `CmovEq for [u8]`, compares 8-byte words with `u64::cmovne`. On x86_64 that is inline asm (`backends/x86.rs`: `xor` + `cmovnz`). The 32-byte HMAC-SHA-256 tag is four words with no remainder.
5. digest's `if choice.into()` is `From<Choice> for bool`, which calls `to_bool`, then `to_u8`'s `core::hint::black_box` (`choice.rs:387-397`). That is unchanged in 0.4.4.

Two further limits on the claim:

- The deploy builds on `ubuntu-24.04` x86_64 (`data-layer-deploy.yml:28,48`), so the 32-bit `u128` half can't apply.
- No other code path reaches ctutils. hybrid-array's ctutils impls are behind its `ctutils` feature, which is off. hmac, sha2, md-5, tokio-postgres, crypto-common and block-buffer don't reference it. `sasl.rs:300` is the graph's only MAC-verify call.

**The scratch test decided it:** 4/4 pass, debug and release. Details are under *The scratch test* below.

So "reachable, through Postgres SCRAM, but not exploitable" should read "not reached". Bumping ctutils changes no compiled path in the data layer.

### 2. "Never" is a prediction

"No Dependabot alert will ever appear" is true today. But GitHub has imported informational RustSec advisories for tokio before, for example `GHSA-4q83-7cq4-p6wg` ("`tokio::io::ReadHalf<T>::unsplit` is Unsound"). "Hasn't, as of 2026-10-28" is the accurate form.

### 3. The fix text is slightly stale

- `cargo update -p ctutils` lands on 0.4.7 today, not 0.4.6. It's still one entry.
- "never the yanked 1.54.0" needs no warning: cargo skips yanked versions by itself, and a plain `cargo update -p tokio` picks 1.54.1.

## Beyond this finding (pointers, not verified as findings)

### For `cli_notes`

The same RUSTSEC-2026-0386 hits `seedelf-platform/Cargo.lock`'s tokio **1.52.3**, the lock PR #328 actually edited (`:2944-2945`). The 1.52 line has no patched release; the patched ranges are `>= 1.51.6, < 1.52.0` and `>= 1.53.3`. It's still CLI-only:

- `cargo tree -p seedelf-wasm --target wasm32-unknown-unknown -i tokio` prints nothing.
- No crate among the platform lock's 374 registry crates, and nothing in its sources, uses `AsyncFd`.

### The platform lock's other hits

`cargo deny` on the platform also reports these. None has a Dependabot alert open; there are no open Rust alerts at all.

- **crypto-bigint 0.5.5, RUSTSEC-2026-0387** ("timing variability in constant-time operations"). It *is* in `seedelf-wasm`'s wasm32 graph, through elliptic-curve 0.13.8, ecdsa and k256. I didn't trace whether any secret reaches it; a separate look may be worth it.
- **h2 0.3.26 and 0.4.11, RUSTSEC-2026-0258.** Not in the wasm32 graph.
- **paste 1.0.15** (unmaintained). A proc-macro, so compile time only.
- **spin 0.9.8** (yanked). Not in the wasm32 graph.

## The scratch test

It lived outside the tree, under `scratchpad/review/v-pr328-0-trace/`: a standalone crate, `tests/zz_review_v_pr328_0_trace_1.rs`.

**Its dependencies match the data layer's lock exactly** (checked entry by entry): postgres-protocol 0.6.12, hmac 0.13.0, digest 0.11.3, sha2 0.11.0, md-5 0.11.0, cmov 0.5.4, hybrid-array 0.4.15, crypto-common 0.2.2 and block-buffer 0.12.1.

**ctutils was swapped for a copy of 0.4.3** where every function 0.4.4 changed panics with "RUSTSEC-2026-0385 flagged code reached": the five `to_*_mask`, `from_u128_{lt,le}`, and `CtLt`/`CtGt` for `u128`.

**What the tests do:**

- **A control** proves that copy is the one linked: `to_u8_mask`, `select_u64` and `u128::ct_lt` all panic.
- **A full SCRAM-SHA-256 login** goes through `ScramSha256::new(…, ChannelBinding::unsupported())`, `update` and `finish`, the way tokio-postgres runs it under `NoTls` (`connect_raw.rs:285,295,330`; the API uses `NoTls` at `api/src/chain.rs:16,167`).
  - The test plays Postgres's side: RFC 5802 `Hi`, then `ServerKey`, then `ServerSignature` over the client's own `AuthMessage`.
  - The true signature is accepted, 20 times.
  - Nine forged signatures, with bit flips at bytes 0, 1, 7, 8, 15, 16, 23, 24 and 31, are each refused with "SCRAM verification error".
- **Every digest MAC compare** (`verify_slice`, `verify`, `verify_truncated_left`/`_right`, `CtOutput ==`) is checked for a match, a mismatch and a short tag.

**Result:** `test result: ok. 4 passed; 0 failed`, in debug and in release. If the finding's reachability claim were right, the login tests would have panicked. All scratch files are deleted.

## Fix advice

1. **Next data-layer change:** bump both entries, through the deploy workflow:
   ```
   cargo update -p ctutils
   cargo update -p tokio --precise 1.53.3
   ```
   The first lands on 0.4.7. For the second, a plain `-p tokio` would land on 1.54.1, and cargo never picks the yanked 1.54.0.
2. **Describe it as hygiene:** clearing `cargo deny`/RustSec. It's no security fix, since neither advisory's flagged code runs in the data layer.
3. **Owner's call (my idea):** if the owner wants RustSec coverage beyond Dependabot, a scheduled `cargo deny check advisories` job over both locks would surface these. Today nothing does.
