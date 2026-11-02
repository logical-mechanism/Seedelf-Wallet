# 1.7.2's release review: the last look

Two parts over round two's fix-ups (the code and tests; the docs and the translations), each finding traced. The code part found nothing. The docs part found four, two low and two nits, all wording, each fixed: architecture.md's and the backlog's *Not covered* sentence said more than the lines say (last-docs#0), privacy.md:192 left out a committee hot key (last-docs#1), flows.md's list of what the DRep key signs (last-docs#2), and the verified-critical entry's date and one verb's source (last-docs#3). Cited as "1.7.2's last look, <ID>".

## Part code

### What it checked

Last pass on round two's code and test fix-ups, in sandbox r172-pr358. No findings.

**Sandbox state.** It was dd22e2b2 plus final-tree.patch: the diff is cmp-identical to the patch. wasm/pkg is 493bb0d9. I compared merged-fixes.patch with final-tree.patch file by file: exactly fixups.diff's 12 files differ. cip30.rs isn't among them, so the pkg is current.

**Each fix-up against its finding, read against the code**
- **r2-critic#2:** dapp.ts:2237 now reads "Each output (by its payment key), certificate, withdrawal and proposal (by its deposit) is named…". This is true of the code:
  - `paid` is named by `whose(p.address, true)`, which calls `byKeys(payment, undefined, label)` and so looks up the wallet's payment keys alone (accounts.payment, the other sessions' payment keys).
  - Certificates, withdrawals and proposals are named by `byStake`.
  - rpc.ts:1057-1062's `paid[].yours` doc agrees.
- **r2-tests#1:** dapp-ties.test.ts:423 now pays a stranger first, then the public account's key. dapp-ties.test.ts:619 pays a stranger, session 0 and session 1; it expects certified [0,1] and a window line naming both.
- **r2-tests#0:**
  - dapp-ties-accounts.test.ts:228: a session pays Account 3's DRep key's own address, and the window is rendered with session: true.
  - dapp-ties-accounts.test.ts:375-379: the public prompt on Account 1 pays Account 2's DRep key's own address.
  - `shownNamed` (dapp-ties-accounts.test.ts:77) gains `session = false`. Its old callers are unchanged. SignTx's `tiedFrom` and total ignore the `account` prop for a session, so the session render matches the real window in everything asserted.
- **r2-tests#2:** the total assertion is at screens-wiring-review-fixes.test.ts:1250-1251.
- **r2-critic#1:** the fifth shape is at cip30_test.rs:982-985. With it, the doc at :961-967 lists all four CIP-19 key-payment types (0, 2, 4, 6) and is accurate.

**Baselines, each run twice:** dapp-ties 30/30, dapp-ties-accounts 15/15 (one new case), screens-wiring-review-fixes 48/48, cip30_test 48/48. Each of the five changed tests also passed twice on its own (-t).

**Named mutants.** The runner is review/work/r3-code/mutants.py; it restores every file and checks it by hash.
- First recipient only (T11): KILLED, 2 failed of 45, at dapp-ties.test.ts:435 and :629.
- Last recipient only: KILLED, 1 of 45, at :629 (certified [1]).
- First of the wallet's recipients (.find): KILLED, 1 of 45, at :629 (certified [0]).
- DRep key for account 0 only (T10): KILLED, 2 of 45, at dapp-ties-accounts.test.ts:235 and :378.
- DRep key for the active account only, set in withKeys (T10b): KILLED, 2 of 45, at :235 and :378.
- Leaving sum skipping staked payments (W1): KILLED, 1 of 82, at screens-wiring-review-fixes.test.ts:1251 ('0.55 ₳' against '600.55 ₳').
- `owner` skipping a script's staking part: KILLED, 3 of 48, at cip30_test.rs:1008, :1049 and :1953, each at the shape "base, a script's stake".

**Vacuity probes.** Nothing vacuous.
- Every recipient but the first: KILLED by dapp-ties-accounts.test.ts:389, whose single recipient is still the wallet's key, so moving the stranger first in dapp-ties lost no cover.
- Every DRep key filed under account 0: KILLED at :235 and :378.
- DRep keys of the non-active accounts only: KILLED at dapp-ties.test.ts:402.
- Each new page or total assertion alone, with the earlier assertions removed: KILLED (:239; :437; :633 under both last-only and .find).
- The DRep case's not.toContain("aren't in it") on its own:
  - with session: true, it kills T10;
  - with the window rendered session: false, as before the fix-up, it survives T10. The flag is what makes it bite.
  - Dropping the flag fails the positive "this private session" line, so the flag itself is pinned.
- T8 (a row named by a stake or DRep key): KILLED, 6 of 45, including the new case's `yours` check at :236.
- Round two's T9 and T12 are still KILLED (3 of 45 and 2 of 45) by the reshaped cases.
- :378's failure is the second prompt's own approval, not the first one lingering.

**Full runs (sandbox)**
- Vitest: tests/dapp*.test.ts (20 files), tests/own-*.test.ts (2), screens-wiring-review-fixes, tests/i18n*.test.ts (8) and words.test.ts. That is 32 files: 434 of 434 passed, 0 failed. i18n.test.ts is 24/24, so the three new keys' blind back-translations are recorded.
- `npm run typecheck`: exit 0. tsconfig includes tests/.
- `cargo test -p seedelf-wasm --locked --test cip30_test`: 48 passed, 0 failed (three runs).
- `cargo fmt --check -p seedelf-wasm`: exit 0.
- CI's own step, `cargo clippy --locked -p seedelf-wasm --all-targets -- -D warnings`: clean.

**Seen, not raised (outside these fix-ups):** every treasury case carries a single proposal. A worker reading only the first proposal's recipients (`summary.proposals[0]?.recipients`) survives dapp-ties, dapp-ties-accounts, dapp and dapp-prompt: 0 failed of 113. The code's flatMap is right, and no test claims to cover several proposals.

**Restored** with the task's checkout, clean and apply. The diff is cmp-identical to final-tree.patch, with no untracked files, wasm/pkg 493bb0d9 and node_modules intact. I didn't touch the main checkout. Logs and the mutant definitions are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r3-code/.

## Part docs

### What it checked

I checked the docs and i18n fix-ups in fixups.diff (lines 1–157, word-diffed paragraph by paragraph) against the code, the other docs and the round-two finding each one answers. Sandbox: /home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-release. It matched final-tree.patch byte for byte (cmp) at the start. At the end I restored it with checkout, clean and apply: `git diff --binary` is again byte-identical to final-tree.patch, there are no untracked or zz- files, and wasm/pkg and node_modules are intact.

**Ran:**
- tests/i18n.test.ts, i18n-critical-helpers.test.ts and words.test.ts: 3 files, 95/95 pass, so the machine-draft failure is gone.
- dapp-ties, dapp-ties-accounts, dapp-prompt, i18n-worker-reasons, accounts and payment-parts-review-fixes: 124/124 pass.
- An adapted copy of round two's reverse-ties probe (real worker and WebAssembly) on the final tree. I added cases for a withdrawal (W1), a committee hot-key authorisation (K1), a committee update (K2), a cold-key resignation (K3) and a public-side committee update (K4). Copy and output: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-final-docs/probe.test.ts.txt and /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-final-docs/probe-out.txt.
- Round two's link checker over the 5 changed docs: 143 links, 0 broken. I also read each changed or new link's target: backlog.md:105 (#signing-and-the-connector), :86, :100; keys-and-accounts.md; flows.md:277 and :305; chunk-38:159 (#steps).

**Each fix-up checked against the code:**
- "the 500th" (keys-and-accounts:155, architecture:568 and :691) is right: FARTHER_KEYS=500 with `i < 500` (chain.ts:149, :164), lovejoin.ts:5664 uses the same fartherKeys, and lib.rs:4887 sets OWN_KEYS_STAKED=500.
- r2-worker#1's sentence is right: cip30.rs:1549-1558 refuses the deposit's reward account (not a reward address, or the other network), and :1563-1579 never refuses a recipient.
- "a pool's retirement or a DRep's certificate name no stake key" is right (cip30.rs:782-790, 1408-1462).
- The Not covered "isn't matched" claims match the code: byKeys's stake slot (dapp.ts:2270, :2279), byStake and its callers (:2334-2341), committee certificates carrying no credential (cip30.rs:1417-1419), and recipients read from TreasuryWithdrawals alone (:1567-1579).
- privacy.md:106 holds:
  - Disconnect reads by the payment key (sessions.ts:2390), and so do the listing the return builds on (:5690) and the restore scan's held UTxOs (:2648).
  - session_return refuses any UTxO not under the Role::Receive key (lib.rs:1404-1408).
  - No accountInfo call reads a session's stake address.
  - The row reads "An address" (dapp.ts:2355 whose(label); ui/dapp.ts:32-47; cip30.rs:1243 own_address, :1280 has_payment_key).
- privacy.md:174 and keys-and-accounts.md:139 hold: of_hash returns Drep (cip30.rs:475-483) for inputs and collateral through owner (:1095-1163) and for required signers (:1209-1218).
- chunk-38:134 matches build.rs:3866 and the plan's own :187. backlog:107 matches owner's of_hash under any staking part.
- The backlog's new lines are one each, carry their IDs and sit in the right areas (Signing and the connector; Sessions and restore for :90).

**verified-critical-{es,ja}.json:**
- The three keys appear once each, appended at the end like earlier rounds and sorted within the round. 473 keys, the same as critical-keys.json. JSON round-trips identically (indent 2, UTF-8, trailing newline).
- Only the entry was appended to each reviewer string.
- Compared with r2-back.md, every reading the notes quote is in it. Every r2-back note they leave out holds of the English or of the verified siblings.
- "Every clause held" agrees with my own comparison of each back-translation to the en values.
- The placeholders match what the screens show: thisSession, tiedName's "tu sesión privada N", and StakedWarning's accountPicker.numbered.
- r2-result.json shows one fresh agent per language (back:es, back:ja).

**Seen but not raised:**
- flows.md:430 lists L11's exception inline but not the new ones. It says nothing false ("checked and found nothing").
- backlog.md:110 names only a session's prompt, though K4 shows a public prompt's "Your private balance isn't in it." for a committee update naming a session's stake key. It's a one-line summary, and the detail goes in the review record.

### last-docs#0 [low] The new Not covered sentence says the lines call every listed position "a stake key that isn't yours"; only a stake certificate and a proposal's deposit do

`seedelf-platform/seedelf-web-wallet/docs/architecture.md:568`

*Claim:* The r2-worker#0 sentence lists a certificate's credential, a reward account (a withdrawal's, a proposal's deposit's, a treasury withdrawal's recipient's) and an address's staking part, "which the lines call "a stake key that isn't yours"". That holds only for a stake certificate's credential (dappUi.cert.warn.otherStakeKey) and a proposal's deposit (dappUi.proposal.warn.notYours). The other positions read differently:
- A withdrawal's line says "Withdraws … from a reward account that isn't yours".
- A pool registration's reward account, which WebAssembly gives as the certificate's credential, keeps "Registers stake pool …, or updates its terms."
- No line names a treasury withdrawal's recipients; flows.md:430 says so itself ("its own line names only its deposit's").
- An address's staking part shows only as "An address".
backlog.md:109 repeats the claim ("… or an address's staking part reads "a stake key that isn't yours""). So the sentence says more than what isn't matched, and the extra claim is false for three of the five positions and inexact for the withdrawal.

*Failure:* A developer picks up backlog.md:109 ("Tying it needs words of its own … critical strings") and, going by these two sentences, rewords only the two "a stake key that isn't yours" strings. A session's prompt would then still read:
- "Withdraws 0 ₳ from a reward account that isn't yours." for a withdrawal from e0‖(public 0/0's hash);
- only the pool's own line for a pool registration whose reward account is that hash;
- "An address" for a payment to 00‖stranger‖that hash;
each followed by "Your public account and your private balance aren't in it." A reader checking architecture.md against the window finds it describing lines that don't exist.

*Evidence:* **Ran** an adapted copy of round two's probe (dapp-ties harness, the real DappService and WebAssembly) in the sandbox on the final tree. Copy and output are in scratchpad review/work/r2-final-docs/ (probe.test.ts.txt, probe-out.txt).
- W1 (zero withdrawal from e0‖pay0/0, partialSign): "Withdraws 0 ₳ from a reward account that isn't yours."
- S9 (pool registration, reward account e0‖pay0/0): "Registers stake pool pool1wamh…, or updates its terms."
- S8 (treasury withdrawal paying e0‖pay0/0, recipients [0fdc78…]): the page's only "isn't yours" is the deposit's, "goes to a stake key that isn't yours, stake_test1upzyg…", the probe's stranger return key 44…. The recipient isn't named.
- S3/S4 (00‖ab…‖pay0/0 and ‖drep): "An address 4 ₳", then "aren't in it".
- S1/S2 and S5–S7 do read "a stake key that isn't yours".

**Read:**
- ui/dapp.ts:138-147 (withdrawalLine → dappUi.withdrawal.warn.notYours at :142), :164-179 (certificateLine returns the pool lines at :169-173 before otherStakeKey at :178), :220-231 (proposalLine names only p.address, the deposit's), :32-49 (paidTo → dappUi.paid.address)
- en.json dappUi.withdrawal.warn.notYours
- flows.md:430
- backlog.md:109

*Suggested fix:* architecture.md:568: say which line says what, e.g. "… or an address's staking part: a stake certificate's line and a proposal's deposit call it "a stake key that isn't yours", a withdrawal's "a reward account that isn't yours", and no line names the rest (… r2-worker#0)". Make the same correction in backlog.md:109, so the follow-up's words cover dappUi.cert.warn.otherStakeKey, dappUi.proposal.warn.notYours and dappUi.withdrawal.warn.notYours as well as the prompt's "isn't in it".

*Trace (confirmed, low):* The finding holds. architecture.md:568 says the lines call each listed position "a stake key that isn't yours", and backlog.md:109 says each one "reads" that way. I traced the line builders and ran my own probe on the final tree with the real DappService and WebAssembly. Only two lines use that phrase: a stake certificate's (dappUi.cert.warn.otherStakeKey) and a proposal's deposit (dappUi.proposal.warn.notYours). The rest read differently:
- **A withdrawal** reads "a reward account that isn't yours", which is inexact.
- **A pool registration's reward account** keeps the pool's own line. This is true even though WebAssembly gives it as `credential`, because certificateLine returns the pool line before otherStakeKey.
- **A treasury withdrawal's recipients** are named by no line. They are used only for `certified`.
- **A stranger's address's staking part** shows only as "An address".

In every one of these cases ties, staked and certified are all empty, and the prompt ends "aren't in it" (or "isn't in it" on the public side).

One sub-case the finding misses: when the output's payment part is the signer's own key and its staking part is another of the wallet's key hashes, the window reads "Your payment key, with a stake part that isn't yours" plus the ownKey warning. So the finding's bullet "shows only as 'An address'" is overstated. Its suggested wording "no line names the rest" would also be inexact for that output. The core claim stands.

Other docs:
- privacy.md:192's new sentence doesn't say what the lines call these positions, so it is fine.
- Transaction details only tags items as "yours" (tx-view.ts markYours) and never says "isn't yours".

This doesn't re-argue the triage, which settled not coding r2-worker#0. It checks whether the doc text for it is true. Rated low under the brief because it is a false statement about the code in the developer reference and in the backlog spec a follow-up will be built from.

*Trace's evidence:* **Read** (sandbox, final tree):
- ui/dapp.ts:142 → dappUi.withdrawal.warn.notYours: "Withdraws {{amount}} ₳ from a reward account that isn't yours."
- ui/dapp.ts:169-173: c.kind === "pool" returns the pool lines before :178 otherStakeKey ("A certificate for a stake key that isn't yours.")
- ui/dapp.ts:220-231: proposalLine names only p.address, the deposit's ("goes to a stake key that isn't yours, {{address}}")
- ui/dapp.ts:32-47: paidTo gives dappUi.paid.ownPaymentKey "Your payment key, with a stake part that isn't yours" when the payment key is the signer's own, otherwise dappUi.paid.address "An address". The matching warning is DappApprovals.tsx:1100-1102 dappUi.warn.ownKey.
- wasm/src/cip30.rs:506-509, 1280: own_payment_key is set whatever the staking part.
- background/dapp.ts:2341, 2362: `recipients` feeds only `certified`. A grep finds no UI use.
- flows.md:430 itself says the treasury withdrawal's own line "names only its deposit's".
- backlog.md:109 repeats the claim.

**Ran:** my own probe on the final tree, `tests/zz-r172-r2-v568-probe.test.ts`, built on the dapp-ties harness with the real DappService and WebAssembly; 2/2 tests passed. Copy: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-v568-probe.test.ts.txt. Output: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-v568-probe-out.txt. Every case gave ties/staked/certified [[],[],[]] and "aren't in it" ("isn't in it" on the public side):
- V1/V2, zero withdrawal from e0‖public pay 0/0 and from e0‖public DRep (partialSign): "Withdraws 0 ₳ from a reward account that isn't yours."
- V3, pool registration with reward account e0‖DRep hash: "Registers stake pool pool1wamh…, or updates its terms." No "isn't yours" anywhere on the page.
- V4, treasury withdrawal paying e0‖public pay 0/0, deposit back to the session's own reward account: no "isn't yours" anywhere on the page; the recipient is unnamed.
- V5, output 00‖stranger‖public pay 0/0: "An address 4 ₳" only.
- V6, output 00‖session's own key‖public pay 0/0: "Your payment key, with a stake part that isn't yours" plus "It pays your payment key with a stake part that isn't yours…". This is the sub-case the finding missed.
- V7/V8 controls, registration of public pay 0/0 and proposal deposit to e0‖public pay 0/0: "a stake key that isn't yours".
- PV1/PV2 public side, withdrawal from e0‖session 0's payment key and output 00‖public pay 0/0‖session 0's payment key: same pattern, ending "Your private balance isn't in it."

The sandbox was restored afterwards and matches final-tree.patch byte for byte.

*Trace's fix note:* Only docs change; no code.

**architecture.md:568.** Replace `, which the lines call "a stake key that isn't yours" (1.7.2's review of its fixes, r2-worker#0)` with:

`: a stake certificate's or a proposal's line calls it "a stake key that isn't yours", a withdrawal's "a reward account that isn't yours", an output to the signing account's own payment key "a stake part that isn't yours", and a pool's registration, a treasury withdrawal's recipients and anyone else's address don't name it (1.7.2's review of its fixes, r2-worker#0)`

**backlog.md:109.** Replace `reads "a stake key that isn't yours"` with:

`is called someone else's ("a stake key that isn't yours", "a reward account that isn't yours", "a stake part that isn't yours") or not named at all`

That way the follow-up's critical strings cover dappUi.cert.warn.otherStakeKey, dappUi.proposal.warn.notYours, dappUi.withdrawal.warn.notYours and dappUi.paid.ownPaymentKey / dappUi.warn.ownKey, as well as the prompt's "isn't in it".

Two cautions for whoever edits:
- Don't use the finding's "no line names the rest" without excepting the own-payment-key output.
- Say "stake certificate", not "certificate": a pool registration's reward account is `credential` too, but it keeps the pool's line.

### last-docs#1 [low] privacy.md:192 names a committee update's member but not a committee hot key's authorisation, which r2-critic#0 asked to be named there

`seedelf-platform/seedelf-web-wallet/docs/privacy.md:192`

*Claim:* r2-critic#0's option 2 asked for both cases, a committee update's members and a committee hot-key authorisation, to be named "under architecture.md:568's "Not covered" and in privacy.md:192". architecture.md:568 and backlog.md:110 name both. privacy.md:192's new sentence names only "a committee update's member".

privacy.md:192 is the list of when a public account is in a session's transaction, and of when the prompt can still say it isn't. So it now reads as if a hot-key authorisation naming the public account's key were caught.

*Failure:* A site on private session 1 controls a script that is a committee member's cold credential (sitting or proposed, so the reach is narrow). It asks the session, with partialSign, to sign an authorisation that makes the public account's stake key hash its hot key.

The window reads: "A constitutional committee certificate. You sign your part only. Others sign too before it's sent. Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it." The site adds its script's witness and submits, and the public account's stake key hash is on chain in the session's transaction.

A reader of privacy.md:192 is told only committee updates slip through.

*Evidence:* **Probe** K1 (same run on the final tree; output in review/work/r2-final-docs/probe-out.txt): certificate 830e8201581c<77…>8200581c<public stake hash>, partialSign. Result: certificates [["committee",false,null,null]], ties/staked/certified [[],[],[]], complete false, and the page as quoted. K2 (UpdateCommittee adding the public stake hash) also ends "aren't in it", which the new sentence does cover.

**Read:**
- cip30.rs:1417-1419: AuthCommitteeHot and ResignCommitteeCold get no credential.
- dapp.ts:2335: byStake(null) ties nothing.
- architecture.md:568: "nor a committee update's members, or a committee hot key's authorisation (r2-critic#0)".
- backlog.md:110.
- r2-findings.md, r2-critic#0's fix, option 2.

*Suggested fix:* privacy.md:192: "…, nor a committee update's member or a committee hot key's authorisation, so the prompt can say your public account isn't in it then too (1.7.2's review of its fixes, r2-worker#0, r2-critic#0)."

*Trace (confirmed, low):* The finding is right on all three counts.

1. **What was asked.** r2-critic#0's option 2 says to "Name both under architecture.md:568's 'Not covered' and in privacy.md:192". The triage chose option 2, and the lead's record draft (record-draft.md:37) says both cases, "a committee update's members or a committee hot key", went into the Not covered lists. Two of the three docs name both: architecture.md:568 ("nor a committee update's members, or a committee hot key's authorisation (r2-critic#0)") and backlog.md:110. privacy.md:192's new sentence names only "a committee update's member". That is the only place privacy.md mentions the committee. Nothing else in the line covers the hot key: "where a stake key goes" doesn't fit a committee hot-credential slot, and the examples in its parenthesis are a payment or DRep key, never the stake key.

2. **True of the code.** The window does say "aren't in it" for a hot-key authorisation:
   - cip30.rs:1417-1418 maps AuthCommitteeHot and ResignCommitteeCold to `(None, cert_kind("committee"), true)`, so `credential` stays None.
   - dapp.ts:2334-2335 then calls `byStake(null)`, which returns undefined, so nothing reaches `certified`.

3. **Reproduced.** My own probe on the final tree gives the same results as the finding (Evidence has the output).

So privacy.md:192 still says "One is in a transaction too when a certificate … names that account's stake key", lists exceptions that leave out the hot key, and ends "it says the other side isn't in it only when it checked and found none of these". Read together, a hot-key authorisation naming the public account's stake key looks caught. It isn't.

**Severity: low.** It's an edge-case inaccuracy in a design doc, and the reach is narrow:
- The cold credential must be a sitting or proposed committee member's, or the ledger refuses the certificate (ConwayCommitteeIsUnknown, from protocol version 10).
- The site must use partialSign: without it the wallet refuses.
- The gap predates 1.7.2, the triage chose to document it rather than code it, and architecture.md and the backlog already describe it correctly.

The UpdateCommittee half is covered by the new sentence, as the finding says.

*Trace's evidence:* **Read in the sandbox (final tree; its diff was byte-identical to final-tree.patch before and after):**
- privacy.md:192: "…Nor is one of your keys' hashes matched where a stake key goes (a public account's payment or DRep key named as a reward account, a certificate's credential or an address's staking part), nor a committee update's member, so the prompt can say your public account isn't in it then too (…r2-worker#0, r2-critic#0)". The same line says "One is in a transaction too when a certificate, a withdrawal or a proposal in it names that account's stake key" and "it says the other side isn't in it only when it checked and found none of these". A search of privacy.md finds no other mention of the committee or a hot key.
- architecture.md:568: "nor a committee update's members, or a committee hot key's authorisation (r2-critic#0)".
- backlog.md:110: "A committee update's members and a committee hot key aren't matched".
- r2-findings.md, r2-critic#0's Fix, option 2: "Name both under architecture.md:568's 'Not covered' and in privacy.md:192".
- cip30.rs:1417-1418: `C::AuthCommitteeHot(..) | C::ResignCommitteeCold(..) => (None, cert_kind("committee"), true)`.
- dapp.ts:2334-2335: `byStake(c.credential)` gives undefined for null.
- No test reads privacy.md (only comments cite it).

**Ran:** my own Vitest probe, tests/zz-r172-r2-hotkey-probe.test.ts, built on dapp-ties.test.ts's harness (the real DappService and wasm/pkg). It's now deleted from the sandbox; a copy is at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-final-docs-hotkey-probe.test.ts.txt, and its output is at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-final-docs-hotkey-probe-out.txt. The site was on private session 0.

| Case | Transaction | Result |
|---|---|---|
| K0 (control) | old-style registration of the public stake hash | certified [{account:0}]; the page warns and has no "in it." |
| K1 | certificate `830e8201581c<77×28>8200581c<public stake hash>`, partialSign | certificates [["committee",false,null,null]]; ties/staked/certified [[],[],[]]; complete false; othersSign 1 |
| K1, no partialSign | same certificate | refused: "This transaction needs signatures the wallet can't give…" |
| K1b | hot credential = the public DRep key hash | [[],[],[]], and the page says "aren't in it" |
| K2 | UpdateCommittee adding the public stake hash | [[],[],[]], and the page says "aren't in it" (covered by the new sentence) |

K1's page reads: "A constitutional committee certificate. You sign your part only. Others sign too before it's sent. Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it."

**Restored:** checkout, clean, then apply --binary final-tree.patch. A cmp against final-tree.patch is identical; no zz- file is left, and wasm/pkg and node_modules are kept.

*Trace's fix note:* Docs only, one phrase, in seedelf-platform/seedelf-web-wallet/docs/privacy.md:192. Change "…, nor a committee update's member, so the prompt can say your public account isn't in it then too (1.7.2's review of its fixes, r2-worker#0, r2-critic#0)." to "…, nor a committee update's member or a committee hot key's authorisation, so the prompt can say your public account isn't in it then too (1.7.2's review of its fixes, r2-worker#0, r2-critic#0)."

This uses architecture.md:568's own words, so the two docs read alike. "The hot key a committee certificate authorises" would be slightly more exact. No code or test change is needed: no test reads privacy.md.

### last-docs#2 [nit] flows.md:433 still lists the DRep key's signatures for a governance site as certificates, votes and messages

`seedelf-platform/seedelf-web-wallet/docs/flows.md:433`

*Claim:* The r2-docs#3 fix extended privacy.md:174's list to match keys-and-accounts.md:139: "…messages as the DRep, a required signer that names it, and an input or collateral at an address paid to its hash".

flows.md:433, the connector's CIP-95 flow, still says the DRep key "signs the account's own DRep certificates and votes … and messages for the DRep by its ID or its key's enterprise address". So the disagreement r2-docs#3 raised now sits between flows.md and the other two docs.

*Failure:* This is r2-docs#3's failure for a reader of flows.md. Someone working out what a site granted CIP-95 can have the DRep key sign concludes it can't get the DRep witness over a UTxO at an address paid to the DRep key's hash, nor for a required signer naming it. It can get both.

*Evidence:* **Read:**
- flows.md:433, privacy.md:174 and keys-and-accounts.md:139.
- cip30.rs:475-483: of_hash returns Signer::Drep when governance put the key in keys.drep.
- cip30.rs:1095-1132: owner, for inputs.
- cip30.rs:1155-1163: collateral goes through owner.
- cip30.rs:1209-1218: required signers go through of_hash.

*Suggested fix:* flows.md:433: "…and messages for the DRep by its ID or its key's enterprise address, a required signer that names it, and an input or collateral at an address paid to its hash (#358)", or point to keys-and-accounts.md as privacy.md:174 now does.

### last-docs#3 [nit] The new verified-critical entry has no date, and calls the session line's frame .own's and .wallet's word for word though its verb is .notYours's

`seedelf-platform/seedelf-web-wallet/docs/i18n/verified-critical-es.json:2`

*Claim:* The entry appended to both files' reviewer string (verified-critical-es.json:2 and verified-critical-ja.json:2) has two inexact points.

**No date.** It opens "1.7.2's release review: …". Every earlier top-level entry dates itself, for example "1.7.2 (the 2026-11-02 bounty report on Send and Make public):", "1.7.1's release review (2026-10-30):" and "1.6.0's branch review (Claude, 2026-10-22)".

**"Word for word".** It says the new keys' "first sentences and frames are the verified dappUi.proposal.warn.own and .wallet … word for word". dappUi.proposal.warn.session's deposit verb is .notYours's (es "va a", ja "へ渡り"), not .own's and .wallet's ("vuelve a", "へ戻ります"), which is the "comes back" wording critic#0 removed.

r2-back.md does support the verb ("goes to", "passes to"), so nothing unverified ships. The record is inexact, and the rest of both notes matches r2-back.md.

*Failure:* Someone auditing the record, say ahead of a native speaker's pass:
- can't place this entry in time against the others;
- reads "frames … word for word" and takes the session line's deposit clause for .wallet's verified "vuelve a la clave de stake de …" / "のステーク鍵へ戻ります", so doesn't look at "va a" / "へ渡り" as wording of the line's own.

*Evidence:* **Read** both reviewer strings. A python diff of old and new shows only this entry was appended. A regex over the entry headers finds every other top-level entry dated.

Values in es.json and ja.json:
- session: "…va a la clave de stake de {{name}} cuando termine…" / "…{{name}}のステーク鍵へ渡り、ウォレットが取り戻すことはありません。"
- .wallet: "…vuelve a la clave de stake de {{name}}…" / "…のステーク鍵へ戻ります。"
- .notYours: "…va a una clave de stake que no es tuya…" / "…へ渡ります。"

r2-back.md: es-session-own and es-session-other say "goes to"; ja-session-own and ja-session-other say "passes to".

*Suggested fix:* In both files, head the entry "1.7.2's release review (2026-11-02): …". Then write "Their first sentences and frames are the verified dappUi.proposal.warn.own, .wallet and .notYours (its "va a" / "へ渡り"), and send.warn.staked and .stakedNth, word for word".

