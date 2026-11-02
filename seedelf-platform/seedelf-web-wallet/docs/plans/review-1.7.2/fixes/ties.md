# ties

## patch
/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/fix-ties.patch (git diff --binary of worktree /home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-pr357 against dd22e2b2. No new files, so no add -N was needed. It reverse-applies cleanly and matches the worktree byte for byte. The worktree is left as it is, and its wasm/pkg was rebuilt from the final source: seedelf_wasm_bg.wasm sha256 493bb0d9…; the original was e31e13e8…, kept at scratchpad/review/work/ties-pkg-orig.)

## files
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-pr357/seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-pr357/seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-pr357/seedelf-platform/seedelf-web-wallet/extension/tests/dapp-ties.test.ts
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-pr357/seedelf-platform/seedelf-web-wallet/extension/tests/dapp-ties-accounts.test.ts
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-pr357/seedelf-platform/seedelf-web-wallet/extension/tests/dapp.test.ts
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-pr357/seedelf-platform/seedelf-web-wallet/extension/tests/dapp-prompt.test.ts
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-pr357/seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs
/home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-pr357/seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs

## pr358#0 + own#0 (same defect: an address paid to a stake or DRep key's hash)

**Change:** dapp.ts ties():
- byKeys(payment, stake, label = false): unless `label`, the payment hash (`spender`) is also looked up in accounts.stake and accounts.drep, inside the same `new Set([...])`, so the `holder || index !== view.account` filter still applies. `others.find((s) => s.stake === spender)` is added to `matched`.
- whose() passes `spends` as `label`, so paid[].yours (the Pays row) still goes by payment key alone, and the row stays "An address".
- ours() is also true for accounts.stake.has / accounts.drep.has / others.some(s.stake === payment). So 00‖H‖H moves from staked to all, and the fartherKeys search skips it.
- publicKeys() also returns `drep: Map<string, number>`, from each known account's drepOf().hash, one derivation per account. Its doc comment is updated (sessions have no DRep key).
- ties()' doc comment is updated as the design gives it, and so are the byKeys, whose and ours comments.

rpc.ts: one clause on paid[].yours saying it's never set for an address paid to a stake or DRep key's hash.

Fixture: dapp-ties-accounts.test.ts's existing stub of publicKeys (in "takes WebAssembly's word…") now carries drep.

**Tests:** tests/dapp-ties.test.ts:
- (a) "names the public account when it pays its stake key's own address, which that key spends, the row still \"An address\" (1.7.2's release review, pr358#0)"
- (b) "names the public account when it pays an address paid to and staked by its stake key, never as someone else's money (…pr358#0)"
- (c) "names the public account when it pays its DRep key's own address (…pr358#0)"
- (f) "names the public account when it spends from its stake key's own address, with partialSign (…pr358#0)"
- (d) and (e) together: "names a private session when it pays its stake key's own address, and never the site's own (…pr358#0)"

tests/dapp-ties-accounts.test.ts:
- "names another public account when it pays that account's stake key's own address, the row still \"An address\" (…pr358#0)": ties [{account:1}], and the page says "It moves money between Account 1 · Main and Account 2."

## pr357#0 (a treasury withdrawal's recipients)

**Change:** cip30.rs: Proposal gets `recipients: Vec<String>`, with a doc comment like its siblings'. It holds the key hashes (hex) of the reward accounts a TreasuryWithdrawals action pays: Address::from_bytes, Address::Stake, StakePayload::Stake only.
- A script's recipient is left out.
- An unreadable one, or one that isn't a reward address, is skipped.
- Any network is accepted.
- No new refusal. Every other kind of action gives [].

rpc.ts: `recipients: string[]` on the proposals type, with a doc comment.

dapp.ts: `recipients = summary.proposals.flatMap((p) => p.recipients.map((key) => byStake(key)))` goes into certified. A proposal's line and its `yours` stay about its deposit, and byKeys already leaves out the signing account's own key.

Fixtures updated so typecheck passes: tests/dapp.test.ts's proposal() helper and tests/dapp-prompt.test.ts's proposal both get `recipients: []`. No other hand-built DappTxSummary proposal exists in src, tests or e2e; TxDetail's proposals are a different type.

**Tests:** wasm/tests/cip30_test.rs:
- a_treasury_withdrawal_says_whose_stake_keys_it_pays. A treasury withdrawal pays the account's own key, a script's (0xf0), the other network's key (0xe1), unreadable bytes and an enterprise address. Its JSON recipients are [own hash, their_stake hash]. A second, Information proposal gives [].

tests/dapp-ties.test.ts:
- (g) "names the public account a treasury withdrawal pays, which takes no signature of its key's, and never says it isn't in it (…pr357#0)": certified [{account:0}], recipients [hash], yours undefined, and no "in it."
- (h) "names a private session a treasury withdrawal pays, which takes no signature of its key's (…pr357#0)": certified [0]
- (i) "still says the other side isn't in it for a treasury withdrawal to a contract's reward account (…pr357#0)": recipients [], certified [], and the page has "aren't in it."

tests/dapp-ties-accounts.test.ts:
- "names another public account a treasury withdrawal pays, in the window's warning of what it names (…pr357#0)": certified [{account:2}]. The dapp-certified callout's body is exactly "A certificate, withdrawal or proposal in it names the stake key of Account 3 · Savings: signing ties Account 1 · Main to Account 3 · Savings on chain, where anyone can see it."

## pr357#2 (two unpinned branches)

**Change:** Tests only.
- (1) a_proposal_whose_deposit_goes_back_on_the_other_network_is_refused now loops over the account's mainnet key reward address and a mainnet script reward address (header 0xf1, since the test network is preprod).
- (2) A new it() asserts, in the raw markup before tags are stripped, that the dapp-staking callout is callout--warn when a proposal's deposit goes back to another of the wallet's keys: a public prompt, the deposit going back to session 1's key. The other fixer's chunk 39 case is untouched.

**Tests:** - wasm/tests/cip30_test.rs: a_proposal_whose_deposit_goes_back_on_the_other_network_is_refused.
- tests/dapp-ties.test.ts: (j) "warns of a proposal whose deposit goes back to another of the wallet's keys, as of anyone's (1.7.2's release review, pr357#2)".

## pr358#1 (base and pointer addresses unpinned)

**Change:** cip30_test.rs: a new helper, paid_to(hash), gives enterprise(hash), base(hash, the account's stake), base(hash, someone else's stake) and pointer(hash, 1/2/3), each named. Three tests now loop over it, keeping their existing assertions, each tagged with the shape:
- an_input_at_the_stake_keys_own_address_is_the_accounts
- an_input_at_the_drep_keys_own_address_is_the_accounts_only_with_governance (with and without governance)
- collateral_at_the_stake_keys_own_address_is_the_accounts (the optional one)

No change to owner.

**Tests:** wasm/tests/cip30_test.rs: those three tests. Under mutant M5 all three fail at their first non-enterprise shape ("base, the account's stake"): own_inputs left 0 right 1 for the stake and DRep inputs, and for the collateral sign_tx is not refused.

## pr358#2 (code comments and test comment only)

**Change:** Comments only.
- cip30.rs, the comment above `owner` (~1086): "a UTxO at any such address (the key's own enterprise address, or the hash under any staking part: 1.7.2's release review, pr358#2) is the account's".
- cip30.rs, the comment above payment_signs (~1641): the DRep key's witness spends "anything at an address paid to its hash: its own enterprise address, which `signData` names it by (CIP-95), or the hash under any staking part". The stake key's spends "what's at an address paid to its hash too, but no wallet hands one out or pays it" ("or pays" kept, as the verifier advised).
- cip30_test.rs, an_input_the_wallet_cant_find_is_unknown (~364): the false "only at the key's own enterprise address" now reads "only at an address paid to its hash, its own enterprise address or the hash under any staking part, which no wallet hands out or pays".

**Tests:** None needed; pr358#1's loops pin the rule.

## critic#1 (rpc.ts ~1510 and dapp-ties.test.ts ~11 only)

**Change:** - rpc.ts DappAsk.certified now reads: "Those whose stake key a certificate, a withdrawal or a proposal in it names (its deposit's, or a treasury withdrawal's recipient's): an old-style registration of one needs no signature of that key's, nor does a proposal … (1.5.0's release review, X05; chunk 39; 1.7.2's release review, pr357#0)".
- The dapp-ties.test.ts header now says the same of certified, and gains a sentence for pr358#0's rule.
- DappApprovals.tsx and ui/dapp.ts are not touched (not mine).

**Tests:** None (comments).

## evidence

RUST (cd <worktree>/seedelf-platform; `cargo test -p seedelf-wasm --locked --test cip30_test`):
- Baseline at dd22e2b2: 47 passed.
- New tests, Rust fix not yet in: 47 passed, 1 failed. The failure is a_treasury_withdrawal_says_whose_stake_keys_it_pays (recipients left: Null, right: [e5578903…, 162cbfd9…]). The reshaped tests pass, since owner was already right.
- Mutant M5 (`git apply …/v-pr358-1-mutant-M5.diff`): 44 passed, 4 failed. The three reshaped tests fail, each at "base, the account's stake" (own_inputs 0 vs 1, or sign_tx not refused), plus the recipients test. Reverted.
- pr357#2(1) mutant (the network check only when the payload is a key), run with `-- proposal`: 2 passed, 1 failed. a_proposal_whose_deposit_goes_back_on_the_other_network_is_refused fails because unwrap_err got Ok: the mainnet script's return stake17yrq… reached the window. Reverted.
- Both mutants on the ORIGINAL test file: 47/47 pass. They survive the old tests, so the new cases are what pins them.
- After the fix: 48 passed. Undoing the Rust fix is the "before" run above, which fails.
- Whole crate at the end (`cargo test -p seedelf-wasm --locked`): 253 passed, 0 failed, 2 ignored (252 at baseline, plus the new test).

TYPESCRIPT (cd extension; `npx vitest run tests/dapp-ties.test.ts tests/dapp-ties-accounts.test.ts`):
- Baseline: 32 passed.
- New tests with the original dapp.ts and the original pkg: 10 failed, 33 passed (43). Each fails on the defect: ties or certified come back [] where [{account:0}], [0], [{account:1}] or [{account:2}] is expected, and recipients is undefined where [] is expected. The 33rd pass is (j), which pins today's tone.
- After (fixed dapp.ts, pkg rebuilt with wasm/build.sh): 43 passed.
- Revert A, dapp.ts checked out (tests and new pkg kept): 9 failed, 34 passed. Every case dapp.ts pins fails. (i) is pinned by WebAssembly and (j) by DappApprovals, so both pass.
- Revert B, the fixed dapp.ts with the ORIGINAL pkg (Rust half undone): 6 failed, 37 passed.
  - The four treasury cases fail.
  - So do the existing chunk 39 case and (j): the fixed worker reads p.recipients, which a stale module lacks, so ties() throws and the prompt promises nothing.
- pr357#2(2) mutant (DappApprovals.tsx:1146 `!p.own && p.yours === undefined`), run on dapp-ties, dapp-ties-accounts, dapp-prompt and dapp.test: 1 failed, 108 passed. Only the new (j) catches it. Reverted.
- Partial mutants of the dapp.ts fix (script: scratchpad/review/work/ties-mutants.py), re-run on the final code. Each one is killed:
  - whose passing no label: 5 fail;
  - ours unchanged: 6;
  - byKeys unchanged: 5;
  - no DRep lookup: 1, (c);
  - the spender's account pushed past the site's-own filter: 1, (e);
  - recipients left out of certified: 3.
- The wasm/pkg was rebuilt twice with wasm/build.sh (39 s, then 11 s after a last comment edit to cip30.rs). Only the .wasm differs from the original pkg; the JS and d.ts are unchanged.

## checks

All runs are on the final code and the final pkg.
- `npm run typecheck`: clean. The tsconfig includes src, tests and e2e.
- Listed Vitest files (dapp-ties, dapp-ties-accounts, dapp, dapp-prompt, tx-view, tx-view-screen): 6 files, 161 passed.
- Extra guards: 16 files, 160 passed.
  - The 13 other files that drive signTx and so ties(): cbor, dapp-account-change, dapp-account-coins, dapp-caps, dapp-chain-collateral, dapp-declined, dapp-gone, dapp-governance, dapp-maybe-sent, dapp-sign-data-race, dapp-site-english, public-mix-stopped-runs, session-site-outs.
  - Plus words, i18n and i18n-critical-helpers.
- No translation keys added, so i18n-critical.mjs wasn't run and there is no unchecked machine draft. tests/i18n.test.ts passes in full.
- `cargo clippy -p seedelf-crypto -p seedelf-wasm --all-targets -- -D warnings`: clean.
- `cargo fmt --check -p seedelf-wasm`: clean. One `cargo fmt -p seedelf-wasm` run reflowed only my cip30_test.rs lines.
- `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"`: 59 pass, 0 fail.
- `cargo test -p seedelf-wasm --locked --test cip30_test`: 48 passed. The whole crate: 253 passed, 2 ignored.
- No failures to explain.

## deviations

1. (e) is folded into (d)'s it(). On its own it passes before the fix, since it's a control. It is what kills the site's-own-filter mutant.
2. (j) is a mutation pin: it passes before and after. Its evidence is the tone mutant.
3. The Rust recipients test asserts through the JSON the extension reads, so it compiled and failed at run time before the fix. It also pins:
   - an unreadable recipient and an enterprise address: skipped;
   - the other network's key: kept;
   - the account's own key: kept;
   - a non-treasury proposal: [].
   It has no struct-field assertion.
4. The optional collateral loop for pr358#1 is done too.
5. Not in the design: a doc clause on rpc.ts paid[].yours, since ties now covers addresses that yours deliberately never names.
6. A fixture the design didn't list: dapp-ties-accounts.test.ts "takes WebAssembly's word…" stubs publicKeys. It now carries drep. Without it, ties() throws on accounts.drep and that existing test fails.
7. New test helpers instead of extending `carrying`, to keep clear of the other fixer's edit to the chunk 39 case:
   - withdrawsTreasury and proposing in dapp-ties.test.ts;
   - withdrawingTreasury and shownNamed in dapp-ties-accounts.test.ts.
   The chunk 39 case is untouched, and my public-side cases sit after the X07 case. The lead may fold them into `carrying` later.
8. Recipients keep the transaction's map order with no dedup in Rust. listed() dedups on the TS side.

## outOfScope

1. A session's OWN stake key hash used as the payment credential is still not matched.
   - On a session's prompt, `00‖(session's own stake hash)‖(public stake hash)` lands in `staked`. It reads "Someone else's address … that money isn't yours", yet the session's own stake key spends it.
   - Cause: ours() checks holder.keyHash, the payment key, but not the holder's stake key (holder.reward).
   - Impact: the tie is still warned; only "isn't yours" is wrong, the same nit as 00‖H‖H was.
   - Outside the design. The fix would be one clause in ours: `payment === keysOf(wasm, holder.reward).stake`.
2. Transaction details (tx-view.ts markYours) doesn't tag a treasury withdrawal's recipients (d.proposals[].withdrawals[]) as Yours by stake key, as #357 does for the deposit's return. The pr357 verifier offered this as optional parity.
3. Version skew: the fixed worker needs the rebuilt module. Against an old pkg, any transaction with a proposal makes ties() throw, and the prompt promises nothing (the safe side). `npm run build` always pairs the two.
4. pr358#3 (the signer row says "your staking" when the stake key signs only to spend) and pr358#4 are untouched.

## docSentences

1. architecture.md:568, the `ties` paragraph. After "…the prompt warns that signing ties them on chain (\"It moves money between …\")." add:
   "An address paid to the hash of one of those accounts' or sessions' stake keys, or of a public account's DRep key, is that key's to spend, as the ledger has it (#358), so it ties them too, while its row stays \"An address\": the wallet never reads it (1.7.2's release review, pr358#0)."

2. architecture.md:568, the proposal part.
   - After "WebAssembly gives each proposal its action, deposit, reward address and stake key (`credential`, none for a script's)" add: "and, for a treasury withdrawal, the stake keys it pays (`recipients`, a script's left out)".
   - Then add: "A treasury withdrawal's recipients take no signature of theirs either, so one that's another of the wallet's stake keys ties it (`certified`), while the proposal's line stays about its deposit (1.7.2's release review, pr357#0)."

3. privacy.md:192, "What links".
   - "Your public accounts aren't in these transactions unless the site builds one that pays one of them or spends from one (an address paid to one of its stake or DRep keys' hashes among them, which that key spends, though the wallet never reads it: 1.7.2's release review, pr358#0), …"
   - "One is in a transaction too when a certificate, a withdrawal or a proposal in it names that account's stake key (a proposal's deposit's return, chunk 39, or a treasury withdrawal's recipient, 1.7.2's release review, pr357#0): …"

4. pr358#2 wording, if the lead's docs pass doesn't already cover it:
   - architecture.md:562: "…the stake key's or (with governance) the DRep key's at any address paid to that key's hash: its own enterprise address, or the hash under any staking part…"
   - architecture.md:566: "no wallet hands out or pays an address paid to its hash".
   - architecture.md:534: the DRep key "spends whatever sits at an address paid to its key's hash".
   - keys-and-accounts.md:134/:139: as in pr358#2's fix note.

