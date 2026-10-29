# v-x-overflow-1-trace: x-overflow#1

**Verdict: confirmed. Severity: low** (a misleading doc on a safety property; no ledger value wraps today).

The finding: seedelf-platform's CLAUDE.md:94 and post-release-roadmap.md:387 say `seedelf-wasm`'s sums on amounts are checked by hand (`checked_add`). On HEAD (`6bca8bec`), most of them are plain `+`, `+=` or `.sum()`, and the store's module wraps them.

## What the docs say (both from #332, `4610555a`, so in this range)

- `seedelf-platform/CLAUDE.md:94`: "...but not in `seedelf-wasm`: on the module's own crate the checks double the module, so its sums on amounts are checked by hand (`checked_add`)."
- `docs/post-release-roadmap.md:387`: "**Not seedelf-wasm's own** ...: its sums on amounts stay checked by hand (`checked_add`), as 314-core#1's are." The same line marks x-release#7 ✅.
- #332's description makes the same claim: "So `seedelf-wasm`'s sums on amounts stay checked by hand (`checked_add`), as 314-core#1's are".

## Why seedelf-wasm wraps in the store build

- `Cargo.toml:37-58`: `[profile.wasm-release]` inherits `release`, and there is no `[profile.release]` override. Only `seedelf-core`, `-crypto` and `-koios` get `overflow-checks = true`.
- `wasm/build.sh:61` builds `--profile wasm-release`.
- So `seedelf-wasm`'s own `+` wraps. Its `.sum::<u64>()` wraps too: core's `Sum` impl inherits the calling crate's setting.

## Inventory of seedelf-wasm's arithmetic on amounts at HEAD

| Kind | Sites |
|---|---|
| **Checked by hand** (`checked_add`) | `cip30.rs:139-141` and `146-149` (`Amount::add_token` / `add`); `cip30.rs:1255-1259` (`add_staking`, **which the finding missed**); `lovejoin.rs:2159-2161` (`needed`) |
| **Saturating** | `lib.rs` 1083-1084, 1114, 1139-1140, 4123, 4153, 4158, 4169, 4278, 4672; `lovejoin.rs:2126` (`have`, a token quantity, in u64) |
| **u128** (token quantities) | `lib.rs` 3648, 3671, 3769, 3980, 3998; `lovejoin.rs` 869, 1208 |
| **Plain** (wraps in the store build) | the finding's list: `lovejoin.rs` 847-848, 1866, 1871, 2127, 2178, 2272, 2413, 2490; `lib.rs` 3632-3635, 3766. **Also:** `lovejoin.rs:237` (`deposit.fee + mix.fee`), `506` (`mix.fee + back_fee`), `1147`/`1150` (`boxes * mixes_each`, then `mixes as u64 * estimate`), `1278-1282` (`mix_fees`) |

`cip30.rs:649`'s `checked_add` is a CBOR offset, not an amount. `decode.rs` does no amount arithmetic.

## Decided by test (both scratch files deleted)

**1. Rust, test profile:** `wasm/tests/zz_review_v_x_overflow_1_trace_1.rs`.
- **Input:** `lovejoin::plan_at` on the classic pool, with session 0's UTxOs `u64::MAX` and `1` (ADA only) and a 5 ₳ collateral.
- **What it expects:** a refusal in words (an `Err`), which a hand-checked sum would give.
- **On HEAD it fails:** "attempt to add with overflow" at `core/src/iter/traits/accum.rs:206`, from `Holdings::spare`'s `.sum::<u64>()` (`lovejoin.rs:847`). The panic is caught and reported as "UNCHECKED: Holdings::spare's sum panicked in the test build".

**2. Vitest, on the store's own module** (`wasm/pkg`, built with wasm-release): `extension/tests/zz-review-v-x-overflow-1-trace-1.test.ts`. It sends `planLovejoin` the same request.
- **On HEAD it fails:** the call returned `{"boxes":0,"spare":"0","mixes":0,"mixFees":"0"}`. The sum wrapped to 0 silently, with no error.
- **Control** (the `u64::MAX` UTxO alone): `{"boxes":4294967295,"spare":"18446744073709551615","mixes":4294967292,...}`.

## Where the finding is right, and its small inaccuracies

**Right:**
- **No ledger value wraps today.** The u64 lovelace sums are bounded by the ADA supply: 4.5e16 against 1.8e19, about 410×. Fee sums are tiny.
- **`owned_in`'s product is bounded by real boxes.** `denom` is the pool datum's box lovelace (`pool.rs:467`), and `PoolBox::from_row` takes only a row whose value is exactly the box value (`mod.rs:397-398`).
- **No datum-sourced amount reaches a plain sum.** `mix_fee_estimate` is a constant, not datum-sourced (`mod.rs:1654-1665`). So "as 314-core#1's" isn't true of datum sums either: `denom` is checked at 2160 and bounded in `owned_in`.

**Inaccurate:**
- "Only cip30.rs's Amount and lovejoin.rs:2160 are checked": `cip30.rs`'s `add_staking` (1255-1259) is checked too.
- Its list of plain sums leaves out `lovejoin.rs` 237, 506, 1150 and 1278-1282.
- Its fix says "token sums are u128 or checked". They are u128, saturating (`lovejoin.rs:2126`) or checked (`cip30`'s Amount).

**Aside, not part of the verdict.** The control shows that counts are `usize`, which is 32-bit in the module. `boxes * mixes_each` (`lovejoin.rs:1147`) wrapped there: 4294967295 × 4 gave 4294967292. With real ADA that needs about 4 billion ₳ in one session, so it can't be reached. The 2^32 headroom on counts is about 11× the supply, not 410×.

## Refutation attempts that failed

1. **"The docs mean only datum-sourced sums, as 314-core#1's."** Neither doc says that. Both say "its sums on amounts", and CLAUDE.md states it without qualification.
2. **"It's a rule, not a description."** Read as a rule, the code doesn't follow it. The roadmap's "stay checked" is descriptive in any case, and it is what the ✅ on x-release#7 rests on.

## Fix advice

Reword CLAUDE.md:94 and roadmap:387 to say what the code does:

> `seedelf-wasm` checks by hand (`checked_add`) only where a sum can pass a u64: cip30's `Amount` and staking, and a public chain's funding (`needed`). Its other lovelace and fee sums are plain, bounded by the ADA supply. Its token sums are u128 or saturating. A new u64 sum that the supply doesn't bound, such as token quantities or a datum's amount, must be checked.

Optionally add that the store module wraps these silently. A lying row then shows a false figure: in the test above, a plan of no boxes from `spare: 0`.

No code change is needed: nothing reachable wraps.
