# v-pr332-0-impact: the overflow line is the crate that compiles the code, not the crate line the docs draw; nothing reaches it today

**Verdict:** confirmed. **Severity:** low, as filed. It's a misleading doc about the store module's overflow behaviour, in the instructions file agents follow, with no reachable case on the shipped build. It isn't a release blocker. **Confidence:** high. I reproduced the mechanism independently on the pinned rustc 1.98.1 with `wasm-release`'s settings, and read every path the finding names on HEAD.

## Attribution and duplicates

- Every statement cited is #332's own (`8e878e9c`, per `git blame`): `Cargo.toml:44-50`, `CLAUDE.md:94`, `post-release-roadmap.md:387` and `lovejoin/mod.rs:1758-1760`. So is a fifth the finding doesn't cite: `post-release-roadmap.md:38`, item 4's "✅ The overflow half: core's, crypto's and koios's arithmetic is checked in the module".
- **Siblings on the same sentences:** x-overflow#2 (low) and x-docs#8 (nit). Both say `CLAUDE.md:94`'s "so its sums on amounts are checked by hand (`checked_add`)" isn't so. x-docs#8 also notes `architecture.md:99` and `wasm/README.md:115` describe the profile without its overrides. One edit of these places should close all three.
- **Not this finding:** pr332 F2 (= x-mut-rs F3), that nothing fails without the overrides. It's a separate fix: the `grep` in `build.sh`.

## Is it reachable with the shipped build?

**No.** Neither direction has a live case on HEAD. The mechanism is real.

### The mechanism, reproduced

I built a two-crate wasm32 workspace in scratch on rustc 1.98.1. Crate `a` stands in for core, with `overflow-checks = true`. Crate `c` stands in for seedelf-wasm, a cdylib with the checks off. The profile matches: `inherits = "release"`, `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `strip = true`. Each export was called from node with 2^64 − 1:

| Probe (a's code, called from c) | Result |
|---|---|
| `Locked::total`, `launch.rs:90-92`'s exact shape (`self.reference + self.mix_box + self.mix_logic + self.deposit`) | **0, wrapped** |
| plain leaf `x + y`; leaf `x * y` | wrapped |
| generic `generic_add::<u32>`, an instance only `c` makes | wrapped |
| `apply(impl Fn)` with `c`'s closure | wrapped |
| generic `generic_add::<u64>`, which `a` makes too | **trapped**: shared generics hand `c` the checked copy |
| `#[inline(never)]` leaf | trapped |
| a fn that calls a helper, even a tiny one (`small(x) + y`) | trapped |
| `slot_at`'s shape (`config(flag)`, `saturating_sub`, `u64::from`) | trapped |
| the same, with the config inline but `saturating_sub`/`u64::from` kept | trapped |
| `a::sum_slice` (`v.iter().sum()`) | trapped |
| `c`'s own `vec.iter().sum::<u64>()`, the instance `a` already makes | **trapped** |
| `c`'s own `.iter().map(\|n\| *n).sum()`, `.into_iter().sum()`, `x + 1` | wrapped |

So on this toolchain, the core code compiled in seedelf-wasm is:

- a body with **no call at all in its MIR**, operators and fields only. Any method call, even `saturating_sub` or `u64::from`, keeps it in core;
- an `#[inline]` function;
- a generic instance core doesn't make itself.

The reverse also holds: a generic instance core does make is shared with seedelf-wasm, checks included. Shared generics are on at opt-level `s`/`z`. All of this is rustc's heuristics, and it moves with the toolchain.

### Direction (a) on HEAD: core code that wraps in the module

- **`Locked::total`** (`launch.rs:91`) is operator-only and called from `lib.rs:2627` and `:2713`, so it wraps there. Its four fields are `reference_lovelace`, `mix_box_lovelace`, `mix_logic_lovelace` and `staking.deposit_at(params.key_deposit)` (`launch.rs:265-270`). They are minimum-UTxO figures and a key deposit from parameters `from_koios` caps: a few ADA.
- **`max_inputs_by`** (`build.rs:2890`) is generic and instantiated with seedelf-wasm's closures, so it's compiled there. Its only arithmetic is bounded:
  - `at_most - taken.len()` comes after the `bail!` when `taken.len() > at_most`;
  - `available.len() - taken.len()` holds because `taken` is drawn from `available`.
  - `holding` and `quantity_in` hold calls, so they stay in core.
- `mix_fee_estimate` adds constants. `build::even` isn't called from seedelf-wasm.
- **`slot_at`**, which the finding counts among the "leaf core helpers", is compiled in core on 1.98.1 and is checked. Its MIR calls `slot_config`, `saturating_sub` and `u64::from`, and my probe of its shape trapped. Its values are bounded either way, so this changes nothing.

### Direction (b) on HEAD: seedelf-wasm sums that trap

- Every `.sum()` in `wasm/src` maps through seedelf-wasm's own closure, so seedelf-wasm makes the instance and it wraps:
  - `lovejoin.rs:847-848` and `:2191`;
  - `lib.rs:3635`, `3649`, `3671`, `3766`, `3769`, `3980`, `3998` and `4635`.
- Two sums are over `&[usize]` box counts (`lovejoin.rs:1283`, `:1649`). Core makes no such instance, so they wrap too. They can't overflow anyway.
- Core's one shareable `Sum<&u64>` instance is `build.rs:1067`, `paid.iter().sum()`. No seedelf-wasm site matches it today.
- So the title's "some seedelf-wasm sums now trap" is what a *new* `.iter().sum::<u64>()` over `&[u64]` would do, not an existing site. And a trap there would be the behaviour every test build already has.

### What the mechanism doesn't touch

x-overflow#1, `eval::resolve`'s `+=` at `eval.rs:148`, holds calls, so it's compiled in core and is checked. x-overflow proved its trap through Vitest on `wasm/pkg`. This finding neither causes it nor moves it.

That finding is, however, the live case against the docs' framing. `CLAUDE.md:94` presents the trap as the better outcome: "a trap that locks the wallet, not a wrapped sum". On a value from outside the wallet, a trap is itself the defect, a lock in a loop. The fix should say so.

## Is low right?

Yes. The brief puts "a misleading doc" at low.

- **Not medium:** no state a user, site or attacker reaches gives a wrong figure or a new trap through this mechanism. It's not a money or privacy statement shown to anyone.
- **Not nit:** the four statements are measurably false about the store module. The false part is the property 1.6.0's x-release#7 was about, and it sits in `CLAUDE.md`, which agents follow literally.
- **The real hazard** is a later core helper, operator-only or generic for seedelf-wasm's types, on a datum or token value, written without `checked_*` on the docs' word. It would wrap in the store module while every test build panics. That's x-release#7 again, on a narrower set of functions. No test today leans on a native overflow panic (no `should_panic`, no `catch_unwind` in core, crypto, koios or the WebAssembly crate).

## The fix

**Right in kind: docs only.** No stable change makes the crate line true:

- `overflow-checks` on seedelf-wasm doubles the module, by #332's own measurement;
- `-Zcross-crate-inline-threshold` and `-Zshare-generics` are nightly-only;
- `#[inline(never)]` scattered over core misses generics and is fragile.

Don't propose any of these, and add no guard.

**Two corrections to its wording:**

1. "A small call-free core function, **or a generic one**, that seedelf-wasm calls is compiled there and wraps" is wrong for a generic instance core also makes. That one is shared and checked: `generic_add::<u64>` trapped, `::<u32>` wrapped. The finding's own claim says it right: "instantiated with seedelf-wasm's types or closures".
2. "Small call-free" is rustc's MIR heuristic: no call at all, under a size threshold, and it moves with the toolchain. A developer can't check it from the source, where `saturating_sub` is "a call" but `+` isn't. Don't write it as a rule. Give the principle and the practice, which hold on any toolchain:
   - a check goes with the crate that compiles the code;
   - the overrides are a backstop;
   - values from outside the wallet are summed with `checked_*` in every crate.

**The places, with short text** (no dates; "Since 1.7.0" is a version):

- **`Cargo.toml:44-50`.** "Core, crypto and koios check integer overflow in the module" becomes "Core, crypto and koios are built with overflow checks". Then add: "A check goes with the crate that compiles the code: core code inlined into seedelf-wasm, or a generic made for its types, wraps there, and a generic sum seedelf-wasm shares with core can trap. So a sum on a value from outside the wallet is checked by hand in every crate."
- **`CLAUDE.md:94`**, rewritten once for this finding, x-overflow#2 and x-docs#8: "Its per-package overrides build `seedelf-core`, `-crypto` and `-koios` with overflow checks, not `seedelf-wasm`, where they double the module. A check goes with the crate that compiles the code, not the one that defines it: core code inlined into seedelf-wasm, or a generic made for its types, wraps there, and a generic sum seedelf-wasm shares with core can trap. The trap is a backstop, never the handling (it locks the wallet): a sum on a value from outside the wallet is checked by hand (`checked_*`) in every crate; lovelace sums are bounded by the supply."
- **`lovejoin/mod.rs:1758-1760`.** "Since 1.7.0 the module checks core's (…), so one missed would trap and lock the wallet" becomes "Since 1.7.0 the module checks most of core's (…): one missed would trap and lock the wallet, or still wrap where seedelf-wasm compiles it".
- **`post-release-roadmap.md:387`.** "so a sum past its type traps" becomes "so a sum past its type in code core compiles traps … (core code compiled into seedelf-wasm, inlined or generic for its types, still wraps)". Then "its sums on amounts stay checked by hand" becomes x-overflow#2's "where a sum can pass a u64".
- **`post-release-roadmap.md:38`**, the same overclaim in one clause: "core's, crypto's and koios's arithmetic is checked in the module" becomes "… is checked where their own code is compiled".
- **Optional:** `architecture.md:99` and `wasm/README.md:115`, x-docs#8's half, one clause each naming the overrides. Leave `wasm/src/lovejoin.rs:2156-2158`'s comment as it is: its `checked_add` is right whichever way the line falls.

**What else it changes:** nothing in behaviour.

- No profile value changes, and neither a `///` doc nor a `Cargo.toml` comment reaches codegen, so the module's bytes don't change.
- No test reads these files. `words.test.ts` reads only `extension/src`, and the crate names stay in backticks or hyphenated as now.
- No owner's rule is touched: no guard, no privacy note, no UI text, no release date.
- It can ride the 1.7.0 docs round, or follow it. Nothing gates the upload on it.

## Scratch

Nothing was written in the tree. The reproduction is outside it, at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr332-0-impact/repro/`. Build it with `CARGO_TARGET_DIR=<that>/target cargo build --target wasm32-unknown-unknown --profile wasm-release`, and run it with `node <scratch>/run-repro.mjs <that>/target/wasm32-unknown-unknown/wasm-release/c.wasm`. The runner labels any result under 2^64 − 1 as wrapped, so `p_slot_at`'s first probe, which can't overflow, reads "WRAPPED" falsely; `p_slot_at2`/`3` are the real cases. I didn't rebuild HEAD's module: the pr332 reviewer measured `Locked::total` → 0 on it, and the reproduction gives the same on the same shape.
