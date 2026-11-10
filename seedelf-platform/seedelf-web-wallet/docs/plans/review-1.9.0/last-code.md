# 1.9.0's release review: the last look, code

On the merged fixes and round two's fix-ups, at `b40c53b4`. Verbatim from its structured report. The lead fixed every finding before the commit.

## Coverage

Read R2BRIEF, COMMON, FINDINGS, FIXBRIEF, fix-full.txt (all five lanes) and r2-full.txt (all 16 round-two findings), then `git show b40c53b4` and the whole code-and-tests diff `git diff 8d7c4b0c b40c53b4` (src 374 lines, TS tests 935, Rust tests 464; written to R/last/code/diff-*.txt). I also traced DappApprovals.tsx's hold, guard and form (55-330, 1060-1080, 1301-1307), Screen.tsx's form, routeOf's three callers (sessions.ts:1602, 3200, 4141), SessionTxReview's kinds, the swap test helpers (swap-session.ts, fakes.ts fakeMinswap) and Playwright 1.63's expect polling (coreBundle.js: one-shot, then 0, 20, 50, 100, 100, 500 ms).

Runs were in my own worktree, R/last/code/tree, detached at b40c53b4, with node_modules symlinked, the main tree's wasm/pkg copied in, and every run under MemoryMax=8G. Afterwards I unlinked the symlink and removed the worktree with `git worktree remove --force`. The main tree is clean at 8d7c4b0c, and I never touched R/integrate/tree. Scripts and logs are in R/last/code/.
- Dev build: `npx vite build`, then the brief's e2e command with --repeat-each=2: 2 passed.
- A temporary hold-margin probe: 12 runs at 4 workers on CPUs 0,1, then the spec restored and sha256 OK.
- Mutants h1, e1 and d1 (the window lane's mutate.py) on the dev build, 2 runs each.
- Store build: 4 runs at 4 workers.
- Vitest: 6 touched files, plus 18 guard and swap files.
- The tests lane's reverts nb-plural-forms, nb-en-other, nb-es-other-many and l8-reason-silent, re-pointed at my worktree.
- `npx tsc --noEmit -p .` and `cargo fmt --check -p seedelf-wasm -p seedelf-core`.

Not done:
- No cargo test or clippy. b40c53b4's only Rust change is a `///` doc comment on a struct field, which no default lint reads that way. Round two's tests lens ran the merged Rust tests and all 12 mutants.
- No full Vitest or e2e suite, and no store-build mutants.
- The docs fix-ups are read only where code comments must agree with them.
- No network. I never opened e2e/support.ts or the vectors JSON.

## Findings

### last-code#1 (nit, traced): DappApprovals.tsx's L3 comment says "Never" where b40c53b4's own architecture.md:568 now documents that the line stays

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx, seedelf-platform/seedelf-web-wallet/docs/architecture.md

**Claim.** The comment over the unfound-input line says the window never says "only your stake key signs here" where that key is what a contract may ask for. Round two's r2-window#3 showed a case that breaks this, and the lead documented it in b40c53b4: a release proved by a withdrawal or a certificate of the stake key sets no keyReleases, so the sentence stays. The comment is also too narrow the other way: keyReleases is set by any of the account's keys (a datum naming the payment key, say), not only by "that key". The docs fix-up reached architecture.md but not the code comment.

**Evidence.** DappApprovals.tsx:1303-1305 (merged tree):
```
{/* Never "only your stake key signs here" where that key is what a contract may ask for (1.9.0's release
    review, L3). */}
{tr(s.keyReleases ? "dappUi.warn.unknownInputsKeyReleases" : "dappUi.warn.unknownInputs", {
```

architecture.md:568, added by b40c53b4 (`git show b40c53b4 --word-diff=plain -- seedelf-platform/seedelf-web-wallet/docs/architecture.md`):
> "A release proved by a withdrawal or a certificate of the stake key sets no `keyReleases`, so beside an unfound input the line stays: the window can't tell it from chunk 29's honest delegation (1.9.0's review of its fixes, r2-window#3)."

rpc.ts:1166 defines keyReleases as "One of the account's keys is what a contract here can be asking for: a required signer, named by a datum, or a native script's input".

r2-window#3 rendered chunk 29's shape (keyReleases false, signs [stake], one unfound input): "…can't be shown. Only your stake key signs here."

Command: `awk 'NR>=1301&&NR<=1307' src/ui/screens/DappApprovals.tsx`.

**Fix.** Reword the comment to what the code checks, for example: `{/* Not "only your stake key signs here" where keyReleases says one of the account's keys may be what a contract asks for (1.9.0's release review, L3). A withdrawal's or a certificate's proof sets none, so the line stays there (1.9.0's review of its fixes, r2-window#3). */}`.

### last-code#2 (nit, traced): tx-view.ts's DRep comment says the sign window names the key "your DRep" whatever a site was granted; it does only with governance

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts, seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs, seedelf-platform/seedelf-web-wallet/docs/flows.md

**Claim.** The views lane's L6 comment gives the sign window as its reason: the key is the user's whatever a site was granted, because the window names it "your DRep". Without governance the window doesn't name it at all. It counts the DRep key as a stranger's, among othersSign. r2-docs#1 raised this difference, and b40c53b4 wrote it into flows.md, so the code comment now contradicts the docs and cip30.rs.

**Evidence.** tx-view.ts:292-294:
```
// The DRep key is the user's too, whatever a site was granted: the sign window names it "your DRep" (1.9.0's
// release review, dapp-ui#3). A session has none.
const drep = d.requiredSigners.length ? drepKey(keys.cardano) : undefined;
```

cip30.rs:437-441: "…and the DRep key (`3/0`) when the site was given governance (CIP-95, chunk 21). Without that grant the DRep key is a stranger's, as any key is". keys_of at 466-470: `drep: if governance { Some(account.key_hash(Role::Drep, 0)?) } else { None }`.

flows.md, added by b40c53b4: "…its stake key and its DRep key, whatever a site was given (the sign window counts the DRep key as the user's only with governance)…".

Commands: `sed -n 430,475p wasm/src/cip30.rs`, `sed -n 286,300p extension/src/background/tx-view.ts`, `git show b40c53b4 --word-diff=plain -- docs/flows.md`.

**Fix.** Keep the reason to ownership, for example: `// The DRep key is the user's too, whatever a site was granted, though the sign window counts it as the user's only with governance (1.9.0's release review, dapp-ui#3; 1.9.0's review of its fixes, r2-docs#1). A session has none.`

### last-code#3 (nit, confirmed-by-run): tx-view-screen.test.ts's fixed-up comment keeps a false premise, cites r2-views#1 without its review, and runs to 124 columns

**Files:** seedelf-platform/seedelf-web-wallet/extension/tests/tx-view-screen.test.ts

**Claim.** The b40c53b4 fix-up added the Koios case, but three things are still off.
- **The premise:** it still says "Its own builds spend what it holds", bar three cases. That's false for every Lovejoin mix, which spends other people's pool boxes. r2-views#1 said so itself ("Every mix also spends strangers' boxes"). The hint's real rule is about asking a data source for specific inputs, not about holding them.
- **The citation:** "(r2-views#1, in the backlog)" sits after a cite of "1.9.0's release review", so it reads as a round-one ID. backlog.md cites it as "(1.9.0's review of its fixes, r2-views#1)". The house names the review wherever the context doesn't.
- **The width:** line 125 is 124 columns.

**Evidence.** tx-view-screen.test.ts:123-125:
```
// The wallet asked a data source about a site's inputs to read its request. Its own builds spend what it holds, bar
// a session's cancel and its swap against a DEX's pools (`lookedUp`, below: 1.9.0's release review, cross#1), and a
// Lovejoin mix spending a box whose making it asked Koios about, which doesn't say so yet (r2-views#1, in the backlog).
```

- r2-views#1's probe: the mix entry's inputs `["5a5e0005#0","5a5e000b#0","d9d9d9d9#1","e7e7e7e7#0"]`, with only one box from the user's deposit.
- `awk 'NR>=123&&NR<=125 {print length($0)}' tests/tx-view-screen.test.ts` gives 120, 120, 124.
- At 8d7c4b0c the file had 14 lines over 120 and no comment line among them: `git show 8d7c4b0c:…/tests/tx-view-screen.test.ts | awk 'length($0)>120 && $0 ~ /^ *(\/\/|\*)/' | wc -l` gives 0.
- The house's form for a round-two ID: `grep -rn "review of its fixes" src` gives "(1.8.0's review of its fixes, r2-screens#5)" and others. Bare IDs appear only right after a line naming that review (Lovejoin.tsx:1942 and 1946).

**Fix.** Reword and rewrap within 120 columns, for example: "The wallet asked a data source about a site's inputs to read its request. Its own builds ask nobody about an input they spend, bar a session's cancel and its swap against a DEX's pools (`lookedUp`, below: 1.9.0's release review, cross#1), and a Lovejoin mix spending a box whose making it asked Koios about, which doesn't say so yet (1.9.0's review of its fixes, r2-views#1)."

## What holds

- The three new e2e lines (extension.spec.ts:5882-5883, 5894-5895, 5904-5906) match round two's tested probe, R/r2/window/scripts/e2e-probes.diff, byte for byte, and fit within 120 columns.
- The #373 e2e passes on my dev build with the brief's command: 2 passed (10.6 s, 11.1 s).
- The new hold check (5883) has wide margin. A temporary probe found the switch still held 814-974 ms (median about 955 ms) of its 1 s after `toBeDisabled()` passed, over 12 runs at 4 workers on CPUs 0,1. All 12 passed, and the spec was restored (sha256 OK).
- Mutant h1 (the switch `disabled={busy}`) fails 2 of 2 at the new hold check, extension.spec.ts:5883.
- Mutant e1 (answer()'s mustAck term dropped) fails 2 of 2: requestSubmit() signs the second request, and the window closes during the 1 s wait (5896).
- Mutant d1 (Decline waits for the yes) fails 2 of 2 on the 30 s timeout. DappApprovals.tsx was restored after each mutant (sha256 OK) and the dist rebuilt clean.
- requestSubmit() reaches the guard the way its comment says. Screen's onSubmit calls `e.preventDefault()` before `answer(true)` (DappApprovals.tsx:277-284), so the form never navigates. At that point Decline is enabled (no hold) and the box is filled, so `approve && mustAck && !ack` is the only thing that blocks it.
- The Decline step now runs with the switch off. The second click sets ackFor to undefined (DappApprovals.tsx:299) and Sign disables. Decline then answers code 2, which is the path the bounty's victim takes.
- On the store build (VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true; the manifest has no key), the #373 e2e passes 4 of 4 at 4 workers on 2 CPUs (19.6 s).
- The first request's Enter check (5873) still rests on the browser's rule alone. answer()'s guard is now pinned by the second request's requestSubmit(), as r2-window#2 asked.
- The plural-form check in dapp-prompt.test.ts can't pass on an empty or nested file: it pins the form count (en 4, es 6, ja 2) and needs `{{ada}} ₳` in each value. The tests lane's reverts nb-plural-forms, nb-en-other and nb-es-other-many each now fail it (1 failed, 30 passed); round two had them all passing, 182 of 182.
- The two new first-ask runner tests (swap-routes.test.ts:466-489) kill l8-reason-silent: both fail, where round two had 304 of 304 passing. Each takes about 265 ms.
- The first-ask tests check what they should: no pause, a retry with reason "other" in Minswap's words, exactly one estimate after `before`, no build-tx, and only the funding submitted. `started()` runs before the fetch override, and the fake's own fetch logs every other call, so `paths()` stays consistent.
- The `}, 20_000);` timeout is the house's form (restore-scan.test.ts:1035), and that test took 685 ms on a quiet machine. Only the new test got it. The five older tests r2-swaps#1 named keep 5 s, but they time out on the base under the same oversubscription, so they aren't this round's.
- The new namesKey docs agree with each other and with M1 ("in whatever role"): cip30.rs:944-945, at 120 columns, and rpc.ts:1168. rpc.ts's one-line, 151-column JSDoc follows that file's habit (50 such comment lines over 120 at base). `cargo fmt --check -p seedelf-wasm -p seedelf-core` exits 0.
- No code or test keeps the retired words ("own order or listing", "Leaves a contract", "likely the user's own") or the old note keys `dappUi.note.contractInputs*` (grep).
- The whole code diff adds no files and carries no debug or scratch code: no console.log, `.only`, skip, dbg!, println!, PROBE or zz- (grep).
- Long added lines follow each file's habit (test titles and string literals). The one comment over 120 is in last-code#3.
- Where L8 meets its callers: quote (sessions.ts:1602), swapBuild (3200) and order() (4141) each re-run `uncheckedProtocols(network, est)` and `outOfPlace(est)` with routeOf's network before building. So a kept first answer always ends in a refusal or a pause, never a build.
- Swaps.tsx:2696's `lookedUp={review.kind === "cancel" || pools}` covers every SessionTxReview kind ("swap" or "cancel", rpc.ts), with `pools` defined at 2633 in the same component.
- tx-view-screen.test.ts's vi.mock("react") stays in its own file. vite.config.ts's test section sets no `isolate`, so Vitest's default isolation holds, and seven other test files already use the same mock.
- Vitest on the merged tree: the 6 touched files (dapp-prompt, swap-routes, tx-view-screen, tx-view, order-cancel-check, i18n) pass 174 of 174.
- Vitest on the merged tree: the i18n guards, the swap set, screens-wiring and the swap pages, 18 files, pass 461 of 461, and `npx tsc --noEmit -p .` exits 0.
