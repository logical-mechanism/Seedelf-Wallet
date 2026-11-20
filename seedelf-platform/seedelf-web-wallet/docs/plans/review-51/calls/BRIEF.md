# Chunk 51 · the owner's calls round: the fixers' brief

Chunk 51 was a whole-code review of the Seedelf platform (a Cardano privacy wallet: a Chrome extension, Rust core crates, a CLI, WebAssembly) and its proofs. Its fixes are done. What it left for the owner, 55 calls, the owner has now decided (2026-11-18), and you build them, by file ownership, in a shared tree, test first. The owner wants everything merged into `main` and a patch release out as soon as possible, so be thorough but don't gold-plate.

## Paths

- **FIXTREE** = `.`, branch `web-wallet/whole-review-fixes`. **Edit only there.** Other fixers work in the same tree at the same time, each on files of their own.
- **Your decisions:** `calls/DECISIONS.md`, your group's section (`## G…`). Each item holds the record's bullet's decision as the owner made it (**OWNER**), and a re-check made today on this code: where the code is now, what was traced, and the recommendation as amended. Where OWNER says otherwise, OWNER wins. An item marked "Leave it. No change." needs nothing from you.
- **The record:** `../Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/docs/archive/plans/review-51.md`, section `### ❓ Your calls` (lines 152 to 241). Read-only.
- **Each finding's verdict and its verifiers' failing test**, at commit `009c4ab4`: `git -C ../Seedelf-Wallet-chunk51 show 009c4ab4:seedelf-platform/seedelf-web-wallet/docs/plans/review-51/verify/<id>.md`, with `#` written `-` (`gap-g8#3` is `verify/gap-g8-3.md`). The same folder holds `lanes/<LANE>.md`, `FIX.md` and `FINDINGS.md`. A verifier's test there is a good start for yours: it failed on this code's ancestor.
- **Never touch** the main checkout `../Seedelf-Wallet` (the owner's Chrome loads its `dist/`), any other worktree, `../lovejoin` or `../lovejoin-v2`, or `seedelf-data/` (done this round already).

## Orient yourself

`seedelf-platform/CLAUDE.md` (above all *Things that bite*), and the design docs under `seedelf-platform/seedelf-web-wallet/docs/`: `architecture.md`, `flows.md`, `privacy.md` (*Known links* is what the wallet admits to), `keys-and-accounts.md`. Read only what your items need.

## How you fix

- **Test first.** Each item a test can show gets one that fails before your fix and passes after: run it both ways and quote both in your answer. Where no test can show it (words on a screen), say how you checked it.
- **Fix the class, not the shape.** If the item has siblings in your files, fix them too and say so. A sibling in another group's files: name it in your answer, don't edit it.
- **Your files only.** Shared files get small anchored edits only (the Edit tool with a unique old string), never a rewrite, since others edit them too: the translations `extension/src/i18n/translations/{en,es,ja}.json`, the design docs (`architecture.md`, `flows.md`, `privacy.md`, `keys-and-accounts.md`), `seedelf-platform/CLAUDE.md`, and the files the decisions say two groups share (below). The privacy policy (`docs/store/privacy-policy.md`) is G8's alone: if your item changes what the wallet sends, keeps or reveals, say exactly what in your answer and G8 words it.
- **Never** add a refusal of something the ledger and the contracts accept, change a privacy default, or change something frozen (variant 1's constants and references, the v1 key derivation, Lovejoin's templates, the contracts, the verification pins), unless your decision says so.
- **Words the wallet shows:** short (a button and at most one short line), the house style, always *Seedelf* and *Seedelf Wallet*. A new or changed string goes in `en.json` with your best `es.json` and `ja.json`. A string that warns or makes a privacy statement goes under a key containing `.warn.` or `.privacy.`. The i18n tests' verified-critical gate will then fail for that key until the lead has it back-translated blind: that failure is expected, so say which keys. Never compare, parse or persist translated text. List every string you added or changed, with its key, in your answer.
- **Docs** say what the code does, in the docs' own voice: short, plain, outcomes in privacy.md, mechanics in architecture.md and flows.md. Update the lines your items name.
- **Cite the finding** in each test's comment: `chunk 51, <id>`.
- **Don't commit.** List every file you changed; the lead commits each group's files by path.

## Files two groups share

- `extension/src/background/dapp.ts`: G5a (getUtxos `remember`, `balance`), G5b (`gone`, the sign window's notes), G6a (signTx's note of payments into the user's own register).
- `seedelf-web-wallet/wasm/src/cip30.rs`: G5a (`KoiosRow`, `utxo_cbor`, `output_parts`, `OwnOutput`, the inspect sums), G5b (the register readings, `register_fields`, `spender`).
- `extension/src/background/send.ts`: G1b (a script or Byron payee, r2a#1), G6b (paying the user's own Seedelf, gap-g8#2).
- `seedelf-core/src/build.rs`: G1a (selection, `apart`, `max_inputs`, `Purpose::Mint`'s ranking for B15), G1b (`is_payable_address`).
- `extension/src/ui/screens/Lovejoin.tsx` and the Lovejoin hub: G4a2 (the can't-come-back flag), G4a1 (e1a#1's callout).
- `extension/src/ui/screens/Swaps.tsx` and `sessions.ts`: G4b alone.
Anything else you find you must change outside your items' files: a small anchored edit, and name it in your answer.

## Commands

From `FIXTREE/seedelf-platform`, each under a cap: `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m <command>`.
- Rust: `cargo test -j 4 --locked -p <package> --test <file>` or `--lib`, then the crate's whole suite; `cargo fmt` only on the Rust files you changed (`rustfmt --edition 2024 <file>`, or check with `cargo fmt --all -- --check`); `cargo clippy -p <package> --all-targets --locked -- -D warnings` before you finish. The target is shared, so cargo may wait on its lock.
- The extension, from `seedelf-web-wallet/extension`: `npx vitest run <files>`, then the files your change could touch; `npx tsc --noEmit -p .` before you finish. New Vitest tests: run them both ways round in the default build and with `VITE_ENABLE_MAINNET=false` (nine of chunk 51's tests once assumed mainnet).
- **Never** run `wasm/build.sh`, `npm run build`, `npm run package`, `npm ci` or Playwright, and never rebuild any `dist/`: the lead rebuilds the WebAssembly and runs the end-to-end tests between stages. If a TypeScript test of yours needs your Rust change inside the WebAssembly, write it, say so, and the lead runs it after the rebuild.
- **Never** build `seedelf-verification/` (Lean). Never run anything in `seedelf-data/`.
- Never pipe `yes` or an endless loop into anything; give everything finite input. Never put the string `.env` in a shell command (a guard refuses it). No network calls unless your decision names one (a free, read-only check), and never a transaction anywhere.
- A scratch file of yours: `calls/work/<your group>/`, with unique names.

## The owner's standing rules

- The wallet refuses only what the ledger or the contracts refuse (2026-10-19). A risky but valid choice gets a short warning at most.
- The most private option is the default, with a visible control to turn it down where it costs the user; "default" never means "only". A link the user chooses is disclosed and let through; a link the wallet would make for them is prevented.
- A costed alternative is a visible switch or button, never a link under text.
- UI text short; detail in the docs. Numbers stay en-US. Chrome Translate stays on (except the 24 words, this round's B9).
- A change to what the wallet sends, keeps or reveals gets a dated Changes entry in the privacy policy (G8 writes it) and privacy.md, in the same PR. No release notes, ever.
- Koios is the public tier (100 requests per 10 s per IP): any new request is counted, and kept views and bundled data beat per-user queries.
- Max spends every UTxO (the owner's 1.6.0 call).
- The data sources are trusted to report the chain truthfully.

## Your answer

For each item: what you changed (file:line), the test (its name, its failing run, its passing run), the siblings you fixed or named, and anything you couldn't do. Then the strings you added or changed, with their keys and their en, es and ja values, the privacy-policy facts for G8 (if any), and every file you changed.
