# 1.7.2's release review, round two: the merged fixes

You review the fixes the 1.7.2 gate made, merged into one tree, before they're committed. The first round reviewed #353–#359 and found 53 findings (`review/findings/*.md` in the scratchpad below; `review/outcomes.json` says what became of each). Three fixers then fixed them in separate worktrees, and the lead merged their patches, fixed the seams between them and wrote the docs. Fix rounds break where areas meet: read the merged diff across areas, not one fixer's patch at a time.

The scratchpad: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad`.

## What changed

The whole diff is `review/merged-fixes.patch` in the scratchpad (against `dd22e2b2`, the head of `web-wallet/release-1.7.2`; `dd22e2b2` itself is only the version bump and the bundled lists on top of `main` at `133d598b`). In short:

- **The sign window's ties** (`extension/src/background/dapp.ts` `ties`, `publicKeys`): an address paid to one of the wallet's stake keys' or public accounts' DRep keys' hashes is that key's to spend (#358's rule), so it ties that account or session (`ours`, `byKeys`), while its output still reads "An address" (`whose(…, true)`, the label, is unchanged). The signing session's own stake key counts too. `publicKeys` derives each account's DRep key. A treasury withdrawal's recipients that are another of the wallet's stake keys go in `certified` (pr358#0, own#0, pr357#0).
- **WebAssembly** (`wasm/src/cip30.rs`): each proposal gets `recipients`, the key hashes a TreasuryWithdrawals action pays (scripts, unreadable bytes and non-reward addresses skipped; any network); `shared/rpc.ts` types it. Comments on what the stake and DRep keys spend (pr357#0, pr358#2).
- **The proposal line** (`ui/dapp.ts` `proposalLine`, `ui/screens/DappApprovals.tsx`): a deposit back to a private session's stake key, the signing session's own or another session's, says "goes to the stake key of {{name}} when the action ends, and the wallet never brings it back" (new critical key `dappUi.proposal.warn.session`), and the staking callout warns for any proposal in a session (critic#0).
- **Send's warning** (`ui/components/StakedWarning.tsx`): on Send, an address under another account's stake key (not the active one's) adds "Paying it still ties your two accounts together on chain, where anyone can see it." (new critical keys `send.warn.stakedOther`, `send.warn.stakedOtherNth`; pr359#0).
- **Text:** en `dappUi.warn.unknownInputs_one` says "what it holds" (i18n#1).
- **Tests:** cip30_test.rs (recipients; base and pointer addresses paid to the stake and DRep keys; the other network's script reward address), dapp-ties*.test.ts, dapp.test.ts, dapp-prompt.test.ts (the session's proposal line; the dapp-unknown callout's exact text in en, es, ja), own-account-names.test.ts, screens-wiring-review-fixes.test.ts (Send's and Make public's forms and reviews with a staked destination), own-address.test.ts (`FARTHER_KEYS` held to WebAssembly's `OWN_KEYS_STAKED`).
- **Docs:** privacy.md, architecture.md, flows.md, keys-and-accounts.md, backlog.md, releases.md, development.md (1.7.2; the zip's size; a second build made apart), plans/README.md, archive/post-release-roadmap.md's header, plans/chunk-38-midnight.md (twelve corrections).
- **Comments:** destination.ts's header, chain.ts's `FARTHER_KEYS`, the `certified` docs.

Left on purpose (don't re-raise): pr357#1/i18n#2 (a script's reward account called "a stake key", as the certificate line does); pr358#3, own#1, own#2 (backlog lines now); pr355#1, pr355#2 (the archive is a record); Transaction details not tagging a treasury withdrawal's recipients (a backlog line).

## Your tree

- **Your sandbox** is a worktree your prompt names, detached at `dd22e2b2` with the merged fixes applied (uncommitted) and the rebuilt `wasm/pkg`, `node_modules` and a warm cargo target.
- **Restore it before you finish**, to the merged state, not to `dd22e2b2`: `git -C <sandbox> checkout -q -- . && git -C <sandbox> clean -fdq && git -C <sandbox> apply --binary /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/merged-fixes.patch`. If you edited Rust, run `wasm/build.sh` in it again only if you changed `wasm/pkg` (don't: test Rust with cargo).
- **The main checkout is read-only for you:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet`. Never edit, build or run tests there.

## Running tests (in your sandbox only)

- Vitest: `cd <sandbox>/seedelf-platform/seedelf-web-wallet/extension && npx vitest run tests/<file>.test.ts`. Run files, not the whole suite. Typecheck: `npm run typecheck`.
- Rust: `cd <sandbox>/seedelf-platform && cargo test -p seedelf-wasm --locked --test cip30_test`.
- Expected today: `tests/i18n.test.ts` fails "es.json/ja.json has no unchecked machine draft among them" for the three new keys only, until their blind back-translation is recorded. Anything else failing is a finding.
- Not allowed: Playwright/e2e, `npm run build`, `npm run package`, anything from `seedelf-data/target` or `cargo run` under `seedelf-data/`, live runs, prettier or any formatter, GitHub writes, commits.
- Scratch files: `tests/zz-r172-r2-<label>-*.test.ts` in your sandbox (deleted before you finish), or the scratchpad's `review/work/r2-<label>-*`.

## What a finding is

- A real defect in the merged fixes or in what they left: a fix that misses a reachable path of its finding, a regression where two fixes or features meet, a test that doesn't pin what it claims (show it with a mutant), text (en/es/ja) that's wrong or misleading, a doc that states something false about the code, a release step the docs get wrong.
- Not a finding: style, a formatter's opinion, re-arguing the owner's calls (no new refusals; private by default; UI text short, one line; the names rule; numbers stay en-US; the data source is trusted), or the "left on purpose" list above.
- Severity: **high** money lost or a key or privacy promise broken on a reachable path; **medium** a security-relevant screen telling the user something false on a reachable path, or a fix missing a path of its own finding, or a regression; **low** an edge-case inaccuracy, an unpinned fix, a doc that misleads a developer; **nit** wording, comments, test names.
- Evidence: `file:line` in your sandbox, and how you verified it (read, ran, mutant). Unverified claims are low at most. One finding per defect, each with a concrete failure scenario. Nothing found: return an empty list and say what you checked.
