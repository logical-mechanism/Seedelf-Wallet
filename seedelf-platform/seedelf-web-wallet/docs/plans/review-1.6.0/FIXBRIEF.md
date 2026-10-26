# 1.6.0 review: the fix round's brief (read this first)

The release review of every PR since 1.5.0 (#308–#323) is done: [FINDINGS.md](FINDINGS.md) holds its 136 findings, [HANDOFF.md](HANDOFF.md) the plan. This round fixes them, and it is **the gate for launching 1.6.0**: get it right rather than fast.

You are one fixer among several, all in **one shared working tree**. Fixers edit tracked files. The lead builds, runs the whole suites, reviews, and commits. **You never commit, push, stash, reset, restore, check out or clean anything in git.**

- Repo: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`, branch `web-wallet/review-1.6.0`, baseline commit `9978654a`. `WW` = `seedelf-platform/seedelf-web-wallet`. This folder is `WW/docs/plans/review-1.6.0/`.
- **Your findings:** `grep -n '^## <id>$' FINDINGS.md`, then read the section to the next `## `. Each one has its file:line at review time (`499768f6`: lines may have moved), a scenario, a suggested fix, the skeptic's verdict and how it was reproduced. **The suggested fix is a lead, not an order.** If you find a better one, use it and say why. If a finding turns out to be already fixed or wrong, say so with evidence.
- **Scratch files** go in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/d6dd908d-847e-45c3-8df8-3d6083f5af0a/scratchpad/`, each name prefixed with your fixer id: others work beside you.

## How to fix

- **Test first.** For each fix: write the test, run it, see it fail on today's code **for the right reason**, fix, see it pass. Then **mutation-check**: undo just your fix's hunk with the Edit tool, rerun, see the test fail, and put the hunk back with Edit. **Never restore a whole file from a copy**, since another fixer may have edited it meanwhile. A wording-only or doc-only change needs no new test, but fix any existing test it breaks.
- Put tests in the existing file that covers the area, or in a new `tests/<area>-review-fixes.test.ts` (Vitest) or the crate's `tests/` (Rust). Name new tests so their 1.6.0 origin shows, as the code around does ("1.6.0's release review, <id>").
- **Run only what you need.** Run your area's test files, not the whole suite, which the lead runs:
  - Vitest: `cd WW/extension && npx vitest run tests/<file>`, and again with `VITE_ENABLE_MAINNET=false` (the preprod build) for anything that touches networks.
  - Typecheck: `cd WW/extension && npm run typecheck`.
  - Rust, Lane R only: `cargo test -p <crate> --test <file>` from `seedelf-platform/`, and `cargo fmt --all` for Rust you touched.
- **If a Vitest run fails somewhere outside your work,** another lane may be mid-edit. Rerun once. If it still fails and the failure isn't yours, leave it and name it in your report; the lead reconciles.

## The WebAssembly package

`WW/wasm/pkg/` is shared, and **nobody but the lead rebuilds it**. Never run `wasm/build.sh`, and never run `npm run build*`, which writes `dist/` for e2e. Every TypeScript test this round runs against the pkg built from `9978654a`.

So a Rust change isn't visible to Vitest until the lead rebuilds. A fixer whose TypeScript half needs its Rust half in the pkg writes the test anyway. Where it can, it makes the test pass on the TypeScript half alone (a stubbed `deps.wasm`, as many tests do), and it lists in its report each test that needs the rebuild.

One exception: Lane R may build a **private** package to run `node --test` against its own Rust:
```bash
cd seedelf-platform/seedelf-web-wallet/wasm
export CC_wasm32_unknown_unknown=clang AR_wasm32_unknown_unknown="$(command -v llvm-ar || compgen -c llvm-ar- | sort -V | tail -1)"
cargo build --locked --manifest-path Cargo.toml --target wasm32-unknown-unknown --profile wasm-release
wasm-bindgen --target web --experimental-reset-state-function --out-dir pkg-<id> ../../target/wasm32-unknown-unknown/wasm-release/seedelf_wasm.wasm
rm -rf tests-<id> && cp -r tests tests-<id> && sed -i 's#\.\./pkg/#../pkg-<id>/#g' tests-<id>/wasm.mjs
node --test "tests-<id>/<file>.test.mjs"
```
Copy any test you add in `tests-<id>/` back into `tests/`. Then delete `pkg-<id>/` and `tests-<id>/` before you finish: both are untracked.

## Shared files

Several lanes edit these at once. Keep each edit small and anchored with the Edit tool, and re-read the lines just before you edit. Never rewrite one with Write, and never round-trip one through a JSON or YAML parser: a `json.dump` reformats the file and wipes others' edits.
- `WW/extension/src/i18n/translations/{en,es,ja}.json`;
- `WW/docs/i18n/{es,ja}-provenance.json`;
- `WW/extension/src/shared/rpc.ts`;
- the big worker files, `WW/extension/src/background/lovejoin.ts` and `sessions.ts`, by the lanes the table below gives them to.

## Never run

- **never run a binary from `seedelf-data/target/` (or `cargo run` there):** the API server reads `seedelf-data/.env` and connects to home's mainnet db-sync, Kupo, Ogmios and submit API. Only `cargo test`, which runs the offline tests (round 3's review once started the server by mistake);
- a formatter for TypeScript, JSON or Markdown (there is no prettier; `cargo fmt` for Rust is fine);
- e2e or Playwright (the lead runs them);
- `wasm/build.sh`, or `npm run build*`, `package*`, `lovejoin-pools`, `tokens` or `dreps`;
- `node scripts/i18n-critical.mjs --write` (the lead runs it once);
- `cargo test -- --ignored` (it reaches home's db-sync and the network, and at a workspace root it rewrites a fixture);
- anything that sends a transaction or touches mainnet;
- any git command that writes. Reads are fine (`git diff`, `git log`, `git show`, `git blame`).

## Strings

- New keys go into en, es and ja together. Each new or changed es/ja value gets provenance `"machine"` in `WW/docs/i18n/{es,ja}-provenance.json`. A later lane reviews the Spanish and Japanese, and back-translates critical keys blind.
- A string that warns or speaks of privacy goes in a key named `.warn.` or `.privacy.`. List every critical key you add or change in your report.
- **Keep UI text short** (the owner): a button with at most one short line beside it; a question's body a few short sentences; a confirm button that fits one line. Detail belongs in the docs, not on screen. A privacy note may be compressed, but never drop what it ties.
- Never compare, parse or persist translated text. No module-level `t()` (bind it inside a function). Content scripts never import i18n.
- Write "Seedelf" (a Seedelf, Seedelfs) and "Seedelf Wallet", never lowercase in anything shown; `tests/words.test.ts` enforces it.
- Changing an existing value: grep the tests for the key, and for regex forms of the old words (`wasn.t`, `/locked/i`). A saved worker reason is shown later in a past-tense frame.

## The owner's rules

- **No paternalistic guards.** The wallet refuses only what the ledger or the contracts would refuse. If a finding suggests a refusal the chain wouldn't make, build a warning on the review instead and list it under the owner's calls in your report.
- **Private by default.** The most private option is the default, with a visible control to turn it down where it costs fees, time or lookups.
- **Choices, not links.** A costed alternative is a switch or a button, never a link under text.
- **Backward compatibility.** The classic 10 ₳ pool's transactions stay byte-identical to 1.5.0's, and `tests/lovejoin-1-5-0.test.ts` (the 1.5.0 gate) passes unedited. Classic-only screens stay as they are, but for known bends.
- **Scope: the web wallet only.** A CLI-only finding isn't fixed in this round: report it as skipped. Changes to shared crates are in scope when the wallet compiles them.
- **Docs: report, don't edit.** Unless you're a docs fixer, don't edit `WW/docs/` or the READMEs. List each doc change your fix calls for under "docs to update" (doc, section, what's now true). A docs lane applies them all at the end. Code comments are yours to fix.
- Match the code around you in naming, comment density and idiom. Comments say why, as the code's do.

## Your report

Write it to `fixes/<id>.md` in this folder (it must survive a crash), then return the same content as your structured output:
- for each finding: its status (`fixed`, `partly`, `not-fixed`, `already-fixed`, `skipped-scope`, `owner-call`), the change in a line or two, the test (file and name), the fail-before line you saw, and the mutation check;
- files you touched;
- critical keys added or changed, and every other key added or changed;
- docs to update;
- calls the owner might overturn (Claude-made choices, warnings in place of refusals, anything you didn't fix and why);
- notes for other fixers or the lead, including each test that needs the pkg rebuilt;
- the checks you ran, and their results.

## The lanes

Three lanes run at once in fix round 1. Within a lane, fixers go one after another.

| Lane | Fixers, in order | Owns (beyond its tests) |
|---|---|---|
| **L**: the Lovejoin worker | `bootstrap`, then `wlj-1`…`wlj-4` | `background/lovejoin.ts`, `lovejoin-launch.ts`, and for `bootstrap` also `sessions.ts`'s `mixFunding` and `ui/screens/Lovejoin.tsx`; their tests |
| **R**: the Rust, and the problems across layers | `deep-datum`, `pool-exists`, `max-left`, `reserve`, `rr-1`, `rr-2` | `seedelf-core`, `seedelf-crypto`, `seedelf-koios`, `WW/wasm`, `seedelf-data`; plus the TypeScript each one's prompt names. **Only Lane R runs cargo.** |
| **D**: docs and words, then the sessions worker | `docs-1`, `docs-2`, `i18n-existing`, then `wss-1`, `wss-2` | `WW/docs/**`, the READMEs, `seedelf-platform/CLAUDE.md`, `seedelf-data/deploy/README.md`, `.github/workflows/data-layer.yml`, the locales' existing values; then `background/sessions.ts`, `parts.ts`, `handlers.ts`, `activity.ts`, `coin-control.ts`, `send.ts`, `pending.ts` |

The lead holds `reserve` until `bootstrap` is done, and `wss-1` until `reserve` is done. All three edit `sessions.ts`.

**Behaviour Lane R changes, which shows only after the lead's rebuild:**
- `deep-datum`: a pool whose script row carries a datum nested past `cbor::MAX_DEPTH` is refused or skipped; RangeErrors from WebAssembly are handled.
- `pool-exists`: a deposit into a token pool (`Version::TokenV1`) gains the pool's reference UTxO as a reference input, about 1.6k lovelace more fee. The classic pool is unchanged.
- `max-left`: Max in parts says why it left UTxOs.
- `reserve`: the collateral's mix reserve is sized for returns that come back directly, and fundings fall back without it.

Screens fixes come in a later round, after this one's rebuild, with the worker fields this round adds.

## Round 2: the screens, and the worker's leftovers

Round 1 is committed (`fc8561c7`), and **`wasm/pkg` is rebuilt from it**. Every suite is green, bar the critical-key gate's two es/ja checks: they wait for round 3's blind back-translation, so ignore them. Round 1's reports in `fixes/` name the worker fields the screens now need. Read the ones your prompt points to.

- **No Rust this round.** If a fix needs Rust, report it and don't make it.
- **e2e asserts the wallet's English.** When you change or remove words a screen shows, grep `WW/extension/e2e/*.ts` for them and update those expectations too. Still never run Playwright: the lead builds and runs e2e after this round, and checks the changed screens visually.
- **Worker files:** Lane W owns `sessions.ts`, `lovejoin.ts` and `runs.ts` this round. A screens fixer that truly needs a worker field may add it with a small anchored edit, and says so in its report.
- **Screens** keep their text short (the owner), show every state a fix makes reachable with at least one button that still works, and never leave a switch showing a state the review isn't in.

| Lane | Fixers, in order | Owns |
|---|---|---|
| **S1**: the Lovejoin screens | `sc-lj-1`, `sc-lj-2` | `ui/screens/Lovejoin.tsx`, `LovejoinLaunch.tsx`, `ui/components/BringAllBack.tsx`, Settings' Lovejoin section, their tests |
| **S2**: the other screens | `sc-o-1`, `sc-o-2` | `ui/screens/Swaps.tsx`, `DappApprovals.tsx`, `SiteSessions.tsx`, `ui/swap.ts`, `Collateral.tsx`, `Home.tsx`, `ui/components/PendingBanner.tsx`, `e2e/extension.spec.ts`, their tests |
| **W**: the worker's leftovers | `w-left` | `background/sessions.ts`, `lovejoin.ts`, `runs.ts`, their tests |

## Round 3b: the review of the fixes, fixed

Round 3 reviewed both fix rounds: [review/CONFIRMED.md](review/CONFIRMED.md) holds its 31 confirmed findings (`R3-<n>`, no high or medium), each with the skeptics' fixes, and [review/QUESTIONS.md](review/QUESTIONS.md) the open questions and the known leftovers L1–L6 (from [REVIEWBRIEF.md](REVIEWBRIEF.md)). Everything is committed (`56dce2cd`): the list refresh and vitest 5.0.3 included. `wasm/pkg` is current, and no fixer this round changes WebAssembly behaviour, so nothing waits for a rebuild.

The same rules as before: test first, see it fail, fix, mutation-check with the Edit tool; your report in `fixes/<id>.md`; words in three languages; no new refusal the chain wouldn't make (an order, a warning, or a visible choice instead); short UI text.

| Lane | Fixers, in order | Owns |
|---|---|---|
| **X**: the collateral's mix reserve, worker and screens agreeing | `fx-reserve-1`, `fx-reserve-2` | `sessions.ts`'s fundings, quotes, Stop and returns; `ui/swap.ts`, `Swaps.tsx`, `DappApprovals.tsx`, `SiteSessions.tsx`; Lovejoin.tsx's Mix form |
| **Y**: Lovejoin's crediting and Bring every box back now | `fx-lj-1`, `fx-lj-2` | `lovejoin.ts`; Lovejoin.tsx's questions and notes; `BringAllBack.tsx`; `runs.ts`; `activity.ts`' Lovejoin catch |
| **Z**: the data layer, the nits, two small features; then the wiring tests | `fx-misc` (beside X and Y), then `fx-tests` (after X and Y) | `seedelf-data/`; the nits' lines; `PendingBanner.tsx`, `Collateral.tsx`, `coin-control.ts`; then tests only |

Lanes X and Y both edit `sessions.ts`, `lovejoin.ts` and `Lovejoin.tsx`. The owner of a file makes its big edits; the other lane makes small anchored ones and re-reads first.
