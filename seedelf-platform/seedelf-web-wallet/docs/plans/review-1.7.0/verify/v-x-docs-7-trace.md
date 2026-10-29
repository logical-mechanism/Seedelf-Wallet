# v-x-docs-7-trace: x-docs#7 (the WebAssembly profile's docs)

**Verdict: partly. Severity: nit.**

Both doc defects are real on HEAD `6bca8bec`. CLAUDE.md overstates which seedelf-wasm sums are checked, and neither the README nor architecture.md mentions #332's overflow checks. Three parts of the finding are off:

- **The scenario runs backwards.** Read as written, the sentence tells an agent to check a new sum by hand, so it pushes toward `checked_add`, not away from it. The real harm is to a reviewer:
  - They read that seedelf-wasm's amount sums are all checked, and they aren't.
  - Nothing tells them the actual rule.
- **"Only the datum-controlled ones are checked" is wrong.** Most of the crate's `checked_add`s are in cip30.rs, on a connected site's transaction.
- **The proposed CLAUDE.md wording would be inaccurate too.** It misses a site's transaction, and an unchecked product on a datum's amount exists (lovejoin.rs:2490), safe for another reason.

The finding also misses a second copy of the overstatement, in post-release-roadmap.md:387.

## The claim, on HEAD

- `seedelf-platform/CLAUDE.md:94`: "… but not in `seedelf-wasm`: on the module's own crate the checks double the module, so its sums on amounts are checked by hand (`checked_add`)."
- `seedelf-platform/Cargo.toml:44–58`: overrides for `seedelf-core`, `seedelf-crypto` and `seedelf-koios` only, with none for `seedelf-wasm`.
- `docs/post-release-roadmap.md:387` repeats it: "its sums on amounts stay checked by hand (`checked_add`), as 314-core#1's are."
- So does PR #332's description: "So `seedelf-wasm`'s sums on amounts stay checked by hand (`checked_add`)…"

## What seedelf-wasm actually does

**Plain u64 sums on amounts.** In the store build these wrap on overflow:

| Where | Code |
|---|---|
| lovejoin.rs:237 | `self.deposit.fee + self.mix.fee` |
| lovejoin.rs:506 | `fees: (mix.fee + back_fee)` |
| lovejoin.rs:847–848 | `spare()`: `….c.lovelace).sum::<u64>() + ….h.lovelace).sum::<u64>()` |
| lovejoin.rs:1278–1282 | `mix_fees: u64 = … .sum()` |
| lovejoin.rs:1866, 1871, 2272, 2413 | `fees += step.fee` / `t.fee()` |
| lovejoin.rs:2127 | `total += held.lovelace;` |
| lovejoin.rs:2178 | `total += lovelace(p);` |
| lovejoin.rs:2490 | `lovelace: (boxes.len() as u64 * protocol.denom)`: a datum's amount × a count |
| lib.rs:3632–3635 | `holding_enough`: `let held: u64 = … .sum();` |
| lib.rs:3766 | `let total: u64 = rows.iter().map(\|u\| Self::adds(chain, u)).sum();` |

**`checked_add`, five sites in all:**

- cip30.rs:140 (`add_token`) and :148 (`Amount::add`): a site's transaction. Its outputs are summed at :1211 (`returned.add(&amount)?`), its inputs at :1110 and :1129.
- cip30.rs:1257 (`add_staking`): the withdrawals and deposits in a site's transaction (:1419–1485, :1601).
- cip30.rs:649: a CBOR length, not an amount.
- lovejoin.rs:2160: the only one in lovejoin.rs, on `needed`, which comes from the datum.

**Also guarded, by other means:**

- `saturating_add`: lib.rs:1084, 1139–1140, 1268, 1276, 4123, 4153, 4672, and lovejoin.rs:2126.
- u128: lovejoin.rs:868–869 and 1207–1208, and lib.rs:3646–3649, 3769, 3980 and 3994–3998.

**Why the plain ones are fine on chain data:**

- They sum UTxOs' lovelace or fees. All the ADA there is comes to 4.5 × 10^16 lovelace, against a u64's 1.8 × 10^19.
- At :2490, `PoolBox::from_row` takes a row only if `BoxValue::is_row` holds (`seedelf-core/src/lovejoin/value.rs:67`: `if row.value != self.lovelace.to_string() { return false; }`). So every counted box holds exactly `denom` on chain.
- These sums would wrap silently only if an index reported a false UTxO value. The CLAUDE.md wording hides that, which is the reviewer's harm.

## The omission

- `wasm/README.md:115`: "**It's built for size** with the workspace's `wasm-release` profile (`opt-level = "z"`, LTO, one codegen unit, stripped)."
- `docs/architecture.md:99`: "`build.sh` uses the workspace's `wasm-release` profile: `opt-level = "z"`, LTO, one codegen unit, stripped. Against the plain `release` profile it cuts the module…"
- Neither file mentions integer overflow checks. architecture.md's only "overflow" hits are about something else:
  - :52 is a stack overflow;
  - :332 is JSON;
  - :732 is a datum's stack.
- The trap bullet (:52, "A call that traps … locks the wallet") doesn't say that a u64 overflow in core, crypto or koios now traps.
- Both of the cited lines are size paragraphs. The checks cost +7 KB raw and +4 KB gzipped, so leaving them out doesn't misstate a size. The missing piece is the behaviour.

## Repro

I wrote a scratch Vitest test at `extension/tests/zz-review-v-x-docs-7-trace-1.test.ts`, ran it alone, then deleted it. **Result: 7 tests, 2 failed, 5 passed.**

- **Failed: "seedelf-wasm has no plain u64 sum on lovelace".** It found 7:
  - lovejoin.rs: `spare()`, `total += held.lovelace`, `total += lovelace(p)`, `fees += step.fee`, `deposit.fee + mix.fee`;
  - lib.rs: `holding_enough`, `apart total`.
- **Failed: "README and architecture mention the overflow checks"**: the README has none.
- **Passed, preconditions:** the CLAUDE.md text is there, and so are the profile's three overrides with no seedelf-wasm one.
- **Passed, counter-checks:**
  - cip30.rs's `checked_add` guards a site's transaction (`returned.add`, `add_staking`).
  - lovejoin.rs has exactly one `checked_add`.
  - The datum product at :2490 is there, and so is `is_row`'s exact-value check.
  - The roadmap repeats the overstatement.

## Fix advice

- **CLAUDE.md:94.** Replace the last clause with: "Its sums there that could pass a u64, on amounts a pool's datum or a site's transaction sets, are checked by hand (`checked_add`). Sums of UTxOs' lovelace and of fees stay plain, since all the ADA there is (4.5 × 10^16 lovelace) is far below one." Make the same change at post-release-roadmap.md:387.
- **Not the finding's "(one on a datum's amount)".** It is too narrow: it leaves out cip30.rs's site-transaction class. It is also contradicted by lovejoin.rs:2490.
- **architecture.md.** Add one line to the trap bullet (:52) or to *Build settings* (:70):
  - the store build checks integer overflow in core, crypto and koios (`wasm-release`'s per-package overrides);
  - so a sum past its type traps and locks the wallet, rather than wrapping;
  - seedelf-wasm's own crate isn't checked.
- **README:115 and architecture.md:99.** Adding "and overflow checks in core, crypto and koios" there is optional.

## An aside, outside this range

architecture.md:68's undated "about 2.6 MB, 797 KB gzipped" is stale; it is unchanged since `babb8e76`. `wasm/pkg/seedelf_wasm_bg.wasm` on HEAD is 3,209,441 bytes raw, and PR #332 measured 3,208,311 raw and 986,536 gzipped. Lines :97, :99 and the README's table give the 2026-10-04 figures as measured that day, so they aren't false as written.

Confidence: high.
