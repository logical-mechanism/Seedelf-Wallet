# v-pr332-1-impact: nothing fails if the `wasm-release` overflow overrides are removed

**Verdict:** confirmed. **Severity:** low, as filed. **Confidence:** high: every claim below was measured on HEAD's code, with the pinned toolchain and the shipped profile.

**The fix needs a correction.** The proposed grep works only when all three overrides are gone. It passes a module whose core is unchecked, and core is the crate #332 is for. A per-crate check of what Cargo actually built catches that case, and I tested it (below).

**Duplicates:** `reports/x-mut-rs.md` F3 is the same finding, and says so. Merge the two. pr332's F1 (`pr332#0`, the codegen-boundary drift) is separate: neither check here catches it.

## The claim, checked

- **No test fails without the overrides.**
  - **Rust tests:** CI's `cargo test --workspace --locked` (`web-wallet.yml:71`) builds the test profile, which checks overflow either way.
  - **WebAssembly node tests:** x-mut-rs built HEAD with the three sections removed (`pkg-NOOVF`). All 57 node tests pass on it (`scratchpad/review/x-mut-rs/x-mut-rs-node-NOOVF.log`).
  - **Vitest:** no test in `wasm/tests/` or `extension/tests/` asserts a panic message ("attempt to", "panicked at", "with overflow"). Every `RuntimeError("unreachable")` in the tests is thrown by a fake.
  - **Nothing reads the config:** no test reads `Cargo.toml` or names `wasm-release`.
  - **No panic hook:** `seedelf-wasm` installs none, so nothing logs a panic's text for a test to see.
- **The strings, on HEAD's module** (`wasm/pkg/seedelf_wasm_bg.wasm`, 3,209,441 bytes): "attempt to add/subtract/multiply with overflow" appear 1, 1 and 1 times. On NOOVF they appear 0, 0 and 0.
- **The proposed line, verbatim** (`v-pr332-1-impact-check.sh`): it exits 1 on NOOVF and 0 on HEAD's module, as the finding says.
- **Where the line would run:**
  - CI's *Build WebAssembly* step is `build.sh` (`web-wallet.yml:79-80`). Its path filter (`:28`, `^(seedelf-platform/|…)`) takes a PR that touches only `Cargo.toml`.
  - `npm run package` is `build:store` → `build` → `build:wasm` → `../wasm/build.sh` (`package.json:12-17`).
  - CI's store step runs only `build:ext` (`:131`), on the module `:80` built.
  - So the line would guard both CI and the store's zip.

## Impact

- **No user, site or attacker can reach this.** It's a regression guard for a later change. 1.7.0's own module has the checks:
  - the tree's module carries the strings;
  - Cargo reports `"overflow_checks":true` for core, crypto and koios on HEAD's `Cargo.toml` (below);
  - nothing after #332 touched `Cargo.toml` or `build.sh` (`git log 4610555a..6bca8bec`: only #331's `web-wallet.yml`, and #338 is the roadmap alone).
- **It doesn't block the release.**
- **Low, not medium.** The overrides aren't a "critical guard" by the brief's scale:
  - pr332's audit of 176 sites and x-overflow's audit both find no value the ledger allows that reaches an unchecked core sum;
  - the one reachable trap the overrides add is a harm they create, not one they prevent: x-overflow F1, a lying data layer's doubled NFT at `eval.rs:148`.
  - Losing the overrides would change no known case today. It would bring back the x-release#7 class for the next sum written. That makes it "a missing test on a minor path": **low**.

## The fix: right for all three gone, blind to core alone

I copied `seedelf-platform/` to scratch (no `target/`, its own `CARGO_TARGET_DIR`), kept only the overrides named in each row, and built with `cargo build --locked … --target wasm32-unknown-unknown --profile wasm-release`. Each module went through `wasm-bindgen` as `build.sh` does, and the proposed line ran on it:

| Overrides kept | add | subtract | multiply | Proposed line |
|---|---|---|---|---|
| none | 0 | 0 | 0 | exit 1 |
| crypto only | 1 | 1 | 1 | passes |
| koios only | 1 | 0 | 0 | passes |
| **crypto + koios (core's dropped)** | **1** | **1** | **1** | **passes** |
| all three (HEAD) | 1 | 1 | 1 | passes |

**Why the line misses it:**

- **One message for every site.** The message lives once in libcore (`panic_const_add_overflow`), whichever crate's checked code calls it, so the string can't tell crates apart. Koios alone carries the "add" one.
- **Dropping core's section alone ships an unchecked core with the line green.** That happens with a merge that loses those two lines, a tidy-up of "only core's", or a rename that stops the package spec matching (Cargo only warns).
- **`strict_add` satisfies the line with no overrides at all.** In 1.98.1's libcore, `strict_add` (stable since 1.91.0, `num/uint_macros.rs:926-935`) panics through `imp::overflow_panic::add()`, which is `panic!("attempt to add with overflow")` (`num/imp/overflow_panic.rs:7-8`), whatever the profile. A dependency, or seedelf-wasm itself, using it would put the string in an unchecked module. Today nothing does: the "none" row is 0.

**A per-crate check, tested.** Cargo's own JSON artifact messages carry each unit's effective profile (`"profile":{…"overflow_checks":true…}`), and they appear for fresh units too. In `build.sh`, the build at line 61 becomes:

```bash
# wasm-release (the workspace Cargo.toml) is release built for size. Its
# overrides check core's, crypto's and koios's overflow (x-release#7): Cargo's
# own messages say what each was built with.
units="$(cargo build --locked --manifest-path "$here/Cargo.toml" --target wasm32-unknown-unknown --profile wasm-release --message-format=json-render-diagnostics)"
for crate in seedelf_core seedelf_crypto seedelf_koios; do
  grep -F "\"name\":\"$crate\"" <<<"$units" | grep -qF '"overflow_checks":true' \
    || { echo "$crate was built without overflow checks: Cargo.toml's wasm-release overrides are gone" >&2; exit 1; }
done
```

**What the check did in scratch** (`v-pr332-1-impact-unitcheck.sh`; the build-line form was run too):

- With core's section dropped it exits 1: "seedelf_core is built without overflow checks".
- With all three it exits 0.
- With nothing to rebuild it takes 0.15 s, and every unit stays `fresh`, so the message format doesn't touch the fingerprints or the module's bytes.
- `json-render-diagnostics` keeps the Compiling and Finished lines, and any warnings, readable on stderr. Only the JSON goes to stdout (220 lines).

**What it catches.** It reads the same build, so it also catches `build.sh` moving to `--release` (every unit false). It doesn't depend on panic text or on what the dependencies call.

**Where it goes.** Right after the build, before `wasm-bindgen`, so a refused build leaves `pkg/` as it was. The local-path check, by contrast, runs on the finished module.

**If the owner prefers the one-line grep:**

- Put it right after the local-path check's `fi` (`build.sh:73`), before the "Built …" echo, not at the very end.
- Its comment must say what it proves: that some of the workspace's code is overflow-checked, not which crate's. Otherwise it repeats the overclaim pr332 F1 is about.
- A plain-string test of `Cargo.toml`'s three sections beside `wasm/tests/readme_test.rs` would cover core. Cargo.lock has no `toml` crate, so it would have to be a string check.

**Docs, same PR:**

- `architecture.md:81` ("…and it refuses a module that still carries one"): add that it also refuses a build without core's, crypto's or koios's overflow checks.
- Optionally, a clause in `seedelf-platform/CLAUDE.md:94`.

**What neither check catches:** pr332 F1's drift. A small call-free or generic core function that seedelf-wasm calls is compiled in seedelf-wasm and wraps whatever the override says. Don't claim otherwise in the comment.

**Within the owner's rules.** It's a build check, not a refusal of anything a user does (rule 1). There's no UI text, no privacy change and no Koios cost.

## Scratch

Everything is under `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr332-1-impact/`:

- **Kept:** the scripts (`v-pr332-1-impact-check.sh`, `-variant.sh`, `-unitcheck.sh`), the build logs, and the five modules (`pkg-none`, `pkg-crypto`, `pkg-koios`, `pkg-nocore`, `pkg-all`).
- **Removed:** the copy and its 437 MB target dir.
- **Untouched:** I created no file in the tree other than this report.
