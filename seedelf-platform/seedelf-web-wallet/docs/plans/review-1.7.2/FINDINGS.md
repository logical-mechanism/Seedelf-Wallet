# 1.7.2's release review: the findings

Every finding of the review of #353–#359 (at `133d598b`), with its verifiers' verdicts and what became of it. Cited as "1.7.2's release review, <ID>". The record is [archive/plans/review-1.7.2.md](../../archive/plans/review-1.7.2.md).

| ID | Severity | Trace | Impact | Outcome | Title |
|---|---|---|---|---|---|
| [pr357#0](#pr3570) | low | confirmed, low | – | fixed | A treasury withdrawal's recipients are never matched to the wallet's stake keys: a private session's window says the public account isn't in it when the proposal pays it |
| [pr357#1](#pr3571) | nit | – | – | left | A script's reward account as a proposal's return reads "a stake key that isn't yours" |
| [pr357#2](#pr3572) | nit | – | – | fixed | Two branches of the fix no test pins: the network check for a script's return, and the tone for another of the wallet's keys |
| [pr358#0](#pr3580) | medium | partly, medium | partly, low | fixed | A site's prompt doesn't see a payment to another of the wallet's stake keys' own addresses, and says the other side isn't in it |
| [pr358#1](#pr3581) | low | confirmed, low | – | fixed | No test pins a base or pointer address paid to the stake key: an enterprise-only `owner` passes every test |
| [pr358#2](#pr3582) | low | partly, low | – | fixed | Docs still say the stake key signs only for staking, and state the rule for enterprise addresses alone |
| [pr358#3](#pr3583) | nit | – | – | backlog | The 'It signs for' row says 'your staking' when the stake key signs only to spend a UTxO at its own address |
| [pr358#4](#pr3584) | nit | – | – | fixed | dappUi.warn.unknownInputs_one says 'what they hold' of one UTxO |
| [pr359#0](#pr3590) | medium | partly, low | confirmed, low | fixed | Send to someone's address under another account's stake key no longer says it ties the two accounts |
| [pr359#1](#pr3591) | low | partly, low | – | fixed | No test pins the screens' half of the fix: the new warnings and Total leaving |
| [pr359#2](#pr3592) | low | confirmed, low | – | fixed | privacy.md still says Make public's own-account warning covers any address carrying an account's staking key |
| [pr359#3](#pr3593) | nit | – | – | fixed | destination.ts's header comment still states the stake-key rule #359 removed |
| [pr359#4](#pr3594) | nit | – | – | fixed | OWN_KEYS_STAKED and chain.ts's FARTHER_KEYS agree only by a comment |
| [own#0](#own0) | medium | partly, low | confirmed, low | fixed | A site's ties miss an address paid to one of the wallet's stake or DRep keys: a private session's prompt says the public account isn't in it |
| [own#1](#own1) | low | confirmed, low | – | backlog | Send says the account's own key past the balance's range "comes back", but the balance never reads it |
| [own#2](#own2) | low | partly, low | – | backlog | Send and Make public read an address paid to the account's own stake key hash as a stranger's, and base(stake hash, stake hash) gets "someone else's payment key" |
| [own#3](#own3) | low | confirmed, low | – | fixed | No test shows #359's warning on Send's or Make public's form or review |
| [own#4](#own4) | low | confirmed, low | – | fixed | privacy.md still lists only a certificate or a withdrawal as naming a public account's stake key, not a proposal's deposit |
| [own#5](#own5) | nit | – | – | fixed | destination.ts's header still states the stake-key rule #359 removed |
| [i18n#0](#i18n0) | low | confirmed, low | – | fixed | #358's callout wording fix is pinned by no test, in any language |
| [i18n#1](#i18n1) | nit | – | – | fixed | en unknownInputs_one says "what they hold" of a single UTxO |
| [i18n#2](#i18n2) | nit | – | – | left | A proposal's deposit sent to a script's reward account is called "a stake key" |
| [release#0](#release0) | low | confirmed, low | – | fixed | privacy.md still says Make public treats an address carrying the account's stake key as the account's own |
| [release#1](#release1) | low | confirmed, low | – | fixed | privacy.md's lists of what can name a stake key without its signature leave out a proposal's deposit (#357) |
| [release#2](#release2) | low | partly, low | – | fixed | backlog.md doesn't carry the open calls #357 and #358 left |
| [release#3](#release3) | nit | – | – | fixed | development.md's release example still says 1.7.1 |
| [release#4](#release4) | low | partly, low | – | fixed | releases.md's record asks for the zip's size and a second build, which development.md's steps never produce |
| [release#5](#release5) | nit | – | – | fixed | keys-and-accounts.md still says the stake and DRep keys sign only for certificates, withdrawals and votes |
| [release#6](#release6) | nit | – | – | fixed | architecture.md says a proposal is refused only when it's on the other network |
| [pr356#0](#pr3560) | low | – | – | fixed | backlog.md leaves out open items that only roadmap.md's handoff notes held |
| [pr356#1](#pr3561) | nit | – | – | fixed | The backlog says Home's two-window watch is covered by one e2e case; the source says one would cover it |
| [pr356#2](#pr3562) | nit | – | – | fixed | The archived post-release roadmap's new header says everything in it was done |
| [pr356#3](#pr3563) | nit | – | – | fixed | releases.md says only 1.0.0's full record is in roadmap-v1.md; 1.1.0's is there too |
| [pr356#4](#pr3564) | nit | – | – | fixed | The backlog's Leios line drops the signing prompt's unnamed Dijkstra field |
| [pr356#5](#pr3565) | nit | – | – | fixed | releases.md's list of what a record names leaves out the data layer's token decimals |
| [pr356#6](#pr3566) | nit | – | – | fixed | plans/README.md says release.yml ships CLI binaries off any tag without a slash |
| [pr354#0](#pr3540) | low | – | – | fixed | Plan says the private balance's NIGHT can't generate DUST, but the contract's staked-form UTxOs can |
| [pr354#1](#pr3541) | low | – | – | fixed | 38b's "whether it's generating" would count NIGHT the registration can't credit |
| [pr354#2](#pr3542) | low | – | – | fixed | Call 2's 40–45 GB assumes home's db-sync can feed a Midnight node; by the plan's own list it can't |
| [pr354#3](#pr3543) | low | – | – | fixed | 38b says Pallas can't stage a mint redeemer; core already does it, through Pallas |
| [pr354#4](#pr3544) | low | – | – | fixed | Call 1's "nothing of Midnight's loads or derives until turned on" contradicts 38b needing no switch |
| [pr354#5](#pr3545) | low | – | – | fixed | Unverified: 38b's cNIGHT input rules differ from Lace's builder, the plan's own source |
| [pr354#6](#pr3546) | nit | – | – | fixed | 38a's precedent is wrong: the Tor spike's branch was merged |
| [pr354#7](#pr3547) | nit | – | – | fixed | probe-staking.mjs doesn't use additionalUtxo; probe-governance.mjs does |
| [pr354#8](#pr3548) | nit | – | – | fixed | "No Cardano preview" cites a section that never says it |
| [pr354#9](#pr3549) | nit | – | – | fixed | Call 4's "Never a remote prover" reads as a guard, while Settings already lets a user name the prover |
| [pr354#10](#pr35410) | nit | – | – | fixed | "The ledger keeps the hyphen" doesn't fit ledger 9's package in Lace's own pins |
| [pr354#11](#pr35411) | nit | – | – | fixed | Line 123's new host permission must be optional, or line 85's promise breaks at the update |
| [pr355#0](#pr3550) | low | – | – | fixed | Chunk 39's open call for the owner has no line in backlog.md |
| [pr355#1](#pr3551) | nit | – | – | left | The plan puts inspect_dapp_tx in cip30.rs, but it is lib.rs's export |
| [pr355#2](#pr3552) | nit | – | – | left | The archived roadmap still marks the built chunk 39 as not started |
| [critic#0](#critic0) | low | confirmed, low | – | fixed | A proposal's deposit back to a private session's stake key is said to come back, but nothing in the wallet ever reads or withdraws a session's rewards |
| [critic#1](#critic1) | nit | – | – | fixed | Three code comments still say `certified` holds a certificate's or a withdrawal's ties, but not a proposal's |

## Reviewer pr357 (code)

### What it checked

Read the shared brief, PR #357's body (via gh api), the archived plan with its As built record, and the whole diff 6beb3cde..366da793: Rust, TS, tests, e2e, docs and i18n. All citations are at 133d598b.

1. Proposal shapes. Traced cip30.rs:1538-1560 (one Proposal per procedure: action_kind, deposit, bech32 address, own = key==keys.stake, credential = key hash or None for a script), dapp.ts ties() :2303/:2324, ui/dapp.ts proposalLine :213-219 and DappApprovals.tsx :1143-1160.
- The account's own key reads "comes back to your public account" (or "your private session").
- Another of the wallet's keys reads "comes back to the stake key of Account 3 · Savings" (or "your private session N"), with the certified tie.
- A stranger's key gets its whole address and a warn tone. A script's reads "a stake key that isn't yours" (nit below).
- Several proposals get one line each. All 7 action kinds are covered: action_kind is exhaustive, and proposalWords has all 7.
- Deposits go through formatAda with en-US numbers (100,000 / 100,000.5). I rendered all cases in en/es/ja with a scratch test and the wording is fine.
- Other network: WebAssembly's inspect refuses it (cip30.rs:1545-1549, "This transaction's proposal returns its deposit on {mainnet|a test network}, and the wallet is on …"). readTx hands that to the site as TxSignError.ProofGeneration, no window opens, and it counts as unprompted. An unreadable reward address, or one that isn't a reward address, is refused too, and the ledger can't decode those either.

2. Tone. The callout warns when any proposal isn't the account's own, which includes another of the wallet's keys. The tie warning's new wording reads right in all three languages.

3. Transaction details. For an OUTPUT, Yours is decided by payment key only:
- tx-view.ts:269 checks paymentKey against the account's payment hashes, its found keys, the session keyHash, then its own register;
- :295 checks other known accounts by their payment keys.
The stake part is never read. So an address carrying only the account's stake key, with someone else's payment key, is NOT tagged Yours: Transaction details doesn't have #359's bug. Reward addresses go through stakeKey (headers e0/e1, keys only), which is correct, since only that stake key withdraws from it.

4. Treasury withdrawals. The window says only "Proposes withdrawals from the treasury". The recipients appear only in Transaction details' Fields ("Withdraws addr amount"), never tagged and never tied (finding 1). The wallet doesn't check their network, but the ledger refuses a mismatch.

5. Where these files meet other features:
- sessions.ts refuseOddities now uses .length; grep finds no other numeric use of proposals.
- siteSigned and remember never read proposals.
- inspectSessionTx sends governance:false, and proposals stay allowed on the private connector. signData is untouched.
- ties() leaves out view.account for a public site. The governance flag doesn't matter, since a proposal needs no signer.
- proposalWords binds no t() at load.
- I read cardano-ledger's Conway Gov.hs. Past the bootstrap phase, ProposalReturnAccountDoesNotExist and TreasuryWithdrawalReturnAccountsDoNotExist apply. So a deposit back to an unregistered key, the account's or a session's (the wallet never registers a session's), is refused at submit rather than sent to the treasury. A session's own line only matters in L2's state (another account's site registered the session's key), where the deposit would sit in a reward account the session's return never reads. That is backlog L2's class, so I didn't raise it.

6. Tests.
- Reverting the Rust fix (reverse-applied the PR's src diff): cip30_test doesn't compile (3 errors).
- Reverting the TS fix: 19 tests fail across 7 files.
- Mutants caught:
  - network check dropped;
  - own = any key;
  - tone .every;
  - markYours' session branch dropped;
  - markYours returning when no outputs are left;
  - certified without proposals;
  - proposalLine treating any credential as own.
- Two mutants survived (finding 3).

7. The e2e test (read, not run) asserts what the PR says:
- the warn class;
- the full line with the whole bech32 address;
- no "governance proposal";
- no dapp-certified;
- Sign visible;
- Transaction details: "Deposit back to", the address and no tx-proposal-yours.
Its CBOR is well-formed.

Sandbox restored: checkout + clean, scratch tests deleted, cargo cache rebuilt at baseline.

### pr3570

**pr357#0 · low · correctness** · `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2303`

**A treasury withdrawal's recipients are never matched to the wallet's stake keys: a private session's window says the public account isn't in it when the proposal pays it**

**Outcome: fixed.** WebAssembly gives each proposal its treasury withdrawal's recipients' stake key hashes (`recipients`, a script's left out), and `ties` puts another of the wallet's among them in `certified`. Transaction details still lists them untagged: a backlog line.

*Claim:* #357 ties a proposal to the wallet's other accounts (X05) only by where its deposit goes back to: byStake(p.credential), dapp.ts:2303, put in certified at :2324. A TreasuryWithdrawals action also names reward accounts, its recipients. They take no signature, and the ledger only requires them to be registered (TreasuryWithdrawalReturnAccountsDoNotExist), so a staking public account's key qualifies.

Nothing reads them:
- WebAssembly's Proposal (cip30.rs:817-829) carries no recipients;
- ties() never sees them;
- the sign window says only "Proposes withdrawals from the treasury" (ui/dapp.ts:213).

So a proposal naming another of the wallet's stake keys as a recipient ties the two on chain with no certified warning, and a session's privacy note still says the public account isn't in it.

The docs overstate it:
- architecture.md:568: "A certificate, a withdrawal or a proposal that names another of the wallet's stake keys ties it too (`certified` …)" and "says the other side isn't in it only when it checked and found none of these";
- privacy.md:192 was never updated for proposals at all.

*Failure:* (a) A site on private session 0 asks it to sign a TreasuryWithdrawals proposal paying 5 ₳ to the public account's (staking, so registered) reward address, its 1,000 ₳ deposit going back to a stake key of the site's. The window reads "Proposes withdrawals from the treasury. Its 1,000 ₳ deposit goes to a stake key that isn't yours, stake_test1upzyg…, when the action ends. Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it." The last sentence is false: the signed proposal names the public account's stake key on chain. ties/staked/certified are [[],[],[]].

(b) Three public accounts, a site on Account 1 · Main: a treasury withdrawal to Account 3 · Savings's reward address, its deposit back to Account 1's own key. The staking callout is info-toned ("…comes back to your public account…"), there's no dapp-certified warning, and nothing names Account 3 · Savings.

Why low: 1.5.0's last review rated L1, the same false "isn't in it" through a pool registration's reward account, low. A proposal from a private session is exotic, and in (a) a warn-toned deposit line comes with it, unless another account's site had registered the session's own key first (L2).

*Evidence:* I traced dapp.ts:2296-2324, cip30.rs:817-829 and :1538-1560, ui/dapp.ts:117-127 (signingTies) and DappApprovals.tsx:1224-1228.

I reproduced both cases with scratch Vitest tests in the sandbox, against wasm/pkg as built at 133d598b, and deleted them after:
- (a) printed the window text quoted above, with certified [];
- (b) gave certified [] and an info-toned dapp-staking callout.

The ledger rule comes from cardano-ledger's Conway Rules/Gov.hs: both return-account checks run unless hardforkConwayBootstrapPhase.

*Suggested fix:* Give each proposal its treasury recipients' stake key hashes, keys only, either:
- in WebAssembly (e.g. Proposal.withdrawals: Vec<String> beside credential), or
- worker-side, by passing the CBOR to ties() and reading wasm.decodeTx(net, cbor).proposals[].withdrawals[].address.

In ties(), push byStake(keysOf(wasm, address).stake) for each into certified. The proposal's own line stays about its deposit, and certifiedLine's "A certificate, withdrawal or proposal in it names the stake key of …" already reads right.

Tests to pin it:
- cip30_test.rs: recipients in the summary, a script's left out;
- dapp-ties.test.ts: a private session's treasury withdrawal to the public account gives certified [{account:0}] and never "isn't in it"; a public one to session 0 gives [0].

If the owner would rather not build it for a patch, list it under architecture.md:568's "Not covered" and in privacy.md:192 instead.

*Trace (confirmed, low):* I traced it from the code and tried to refute it. It holds.

**The code path**
- WebAssembly's `Proposal` (cip30.rs:817-829) has only `action`, `deposit`, `address`, `own` and `credential`. The loop that fills it reads `proposal.reward_account` and `action_kind(&proposal.gov_action)`, and never the `TreasuryWithdrawals` recipients map.
- ties() keys proposals by `p.credential` alone (dapp.ts:2303). `certified` (dapp.ts:2324) is built only from certificates, withdrawals and those deposit keys.
- DappApprovals.tsx:1224-1228 passes `ties`, `staked` and `certified` together to signingTies (ui/dapp.ts:117). When all three are empty, it says "Your public account and your private balance aren't in it."
- proposalLine (ui/dapp.ts:213) prints only "Proposes withdrawals from the treasury" plus the deposit line.
- Transaction details is no help either. tx-view.ts markYours tags `d.withdrawals` and `d.proposals[].rewardAccount` as Yours, but never `d.proposals[].withdrawals[]`. TxDetail shows the recipients under "Withdraws" with no tag.

**What I reproduced** (scratch Vitest in the sandbox, against wasm/pkg as built at 133d598b)
- **(a)** A site on private session 0 asks to sign a TreasuryWithdrawals proposal: 5 ₳ to the public account's reward address, the deposit back to a stranger's key.
  - ties, staked and certified come back `[[],[],[]]`, with `complete` true.
  - The window reads, word for word as the finding quotes: "…Its 1,000 ₳ deposit goes to a stake key that isn't yours, stake_test1upzyg…, when the action ends. Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it."
  - The control, the same proposal with its deposit back to the public account, gives `certified [{account:0}]`. So the harness works, and the gap is the recipients alone.
- **(b)** Three accounts, a public site on Account 1 · Main, a treasury withdrawal to Account 3's reward key, the deposit back to Account 1's own key.
  - certified is `[]`, the dapp-staking callout is info-toned, there is no dapp-certified callout, and nothing names Account 3 · Savings.
- **(c)** A public site, the recipient private session 1's key: certified `[]`, info-toned, and "Your private balance isn't in it."
  - #357's own test holds that a tie to a session means the private balance is in it, so this is false too.
  - It's ledger-valid only if the session's key was already registered (L2).

**The docs**
- architecture.md:568 opens with "A certificate, a withdrawal or a proposal that names another of the wallet's stake keys ties it too", which a treasury recipient isn't. Its later "says the other side isn't in it only when it checked and found none of these" is untrue for recipients.
- privacy.md:192 ("What links, on chain") still lists only certificates and withdrawals. It wasn't updated even for #357's deposit-back tie.

**Ledger facts**
- Recipients take no witness. A staking public account's key is registered, so it passes the post-bootstrap registration check.
- If that check didn't exist, more accounts would qualify, not fewer.

**Reach and severity: low**
- It needs a governance proposal from a private session: a 100,000 ₳ deposit on mainnet, paid by the session or by the site through partialSign, plus the guardrail script.
- Either a user names their own public stake address as the recipient while a privacy note says it isn't in the transaction, or a site that already knows that key pays to make the link public. Both are exotic.
- No money moves wrongly. This is the same false "isn't in it" class as 1.5.0's L1 (a pool registration's reward account), which was rated low.
- It isn't a path of #357's own report, which was the deposit's return address, so the medium rule for "misses a path of its own report" doesn't apply.
- It asks for a disclosure, not a refusal, so it's in scope under the owner's rules.

*Trace's evidence:* Read at 133d598b:
- **wasm/src/cip30.rs:817-829:** the `Proposal` struct, with no recipients.
- **cip30.rs ~1538-1560:** the proposals loop, which reads only `reward_account` and `action_kind`.
- **extension/src/background/dapp.ts:2296-2324:**
  - `byStake`;
  - `const proposals = summary.proposals.map((p) => (p.own ? undefined : byStake(p.credential)))` at :2303;
  - `certified: listed([...certificates, ...withdrawals, ...proposals]...)` at :2324.
- **dapp.ts:2133:** ties() is called inside a `.catch`, so an error there means "promises nothing".
- **dapp.ts:2781-2793:** `keysOf` returns `stake` only for key reward addresses (header e), never a script's (f).
- **ui/dapp.ts:117-127 and :213:** `signingTies` and `proposalLine`.
- **ui/screens/DappApprovals.tsx:**
  - :1122-1126, the dapp-certified callout;
  - :1142-1160, the staking callout's tone (warn only if a certificate is the account's own, staking money doesn't come back, or a proposal's deposit isn't the account's own);
  - :1224-1228, the privacy note.
- **background/tx-view.ts:** the markYours diff from #357 covers `d.withdrawals` and `d.proposals[].rewardAccount` only. `wasm.decodeTx(net, cbor)` is at :184.
- **ui/components/TxDetail.tsx:535-539:** Yours is shown only on the proposal's reward account. Its withdrawals render through the generic field list.
- **en.json:** :2793 `tx.proposal.treasuryWithdrawals`, :492 `dappUi.ties.privacy.certified`.
- **docs:** architecture.md:568 and privacy.md:192. privacy.md has no "proposal" or "treasury" in that bullet, per grep.

Ran, in the sandbox `.claude/worktrees/r172-pr357`:
- Two scratch Vitest files: `tests/zz-r172-pr357v0-treasury.test.ts` (dapp-ties.test.ts's helpers) and `tests/zz-r172-pr357v0-accounts.test.ts` (dapp-ties-accounts.test.ts's helpers, three accounts).
- Both use a hand-built TreasuryWithdrawals proposal: `841a3b9aca00<back>8302a1<to>1a004c4b40f6826b<url>5820<hash>`.
- Output went to `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/pr357v0-out.txt` and `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/pr357v0-out-b.txt`.

Results:
- **(a):** `[[],[],[]]`; the page ends "Your public account and your private balance aren't in it."
- **Control** (deposit back to the public account): `[[],[],[{"account":0}]]`.
- **(a2)** (deposit back to the session's own key): `callout--info`, "aren't in it".
- **(b):** `[[],[],[]]`, `callout--info`, no dapp-certified callout.
- **(c):** `[[],[],[]]`, `callout--info`, "Your private balance isn't in it."

I deleted both files and ran `git checkout -- . && git clean -fd`. `git status` is clean, and node_modules and wasm/pkg are intact.

*Trace's fix note:* The suggested fix is correct. Give ties() each proposal's treasury recipients that are key hashes (skip script recipients) and push `byStake(key)` for each into `certified`.

**Why it's small**
- byKeys already drops the signing side's own key: for a public site with `index !== view.account`, and for a session because its index is filtered out of `others`. So no `own` flag is needed.
- No new strings: certifiedLine already reads "A certificate, withdrawal or proposal in it names the stake key of …". That means no new translation keys and no back-translation round for a patch.

**Two ways to build it**
1. **WebAssembly:** add `Proposal.withdrawals: Vec<String>` beside `credential`. It's the cleaner source of truth, but Vitest won't see it until wasm/pkg is rebuilt.
2. **Worker:** pass the CBOR into ties() and read `wasm.decodeTx(net, cbor).proposals[].withdrawals[].address` (tx-view.ts:184 already uses it) through keysOf. A decode failure lands in the existing `.catch` at dapp.ts:2133, so the prompt then promises nothing, which is safe.

**Optional:** for parity with #357's own Transaction details change, tx-view.ts markYours could also tag `d.proposals[].withdrawals[].address` as Yours by stake key.

**Tests that pin it**
- **dapp-ties.test.ts:**
  - a private session's treasury withdrawal to the public account gives `certified [{account:0}]`, and the page has no "in it.";
  - a public site's withdrawal to private session 1's key gives `[0]`;
  - a script recipient (`f0…`) ties nothing.
- **dapp-ties-accounts.test.ts:** Account 3 · Savings is named in the dapp-certified callout.
- **cip30_test.rs**, on the Rust route: the recipients are in the summary, and a script's is left out.

**Docs, whichever way it goes**
- privacy.md:192 needs the proposal sentence: its deposit-back tie has been missing since #357.
- architecture.md:568 should name recipients, or, if the owner defers the code, list them under its "Not covered" and in privacy.md.

### pr3571

**pr357#1 · nit · ux-text** · `seedelf-platform/seedelf-web-wallet/extension/src/ui/dapp.ts:218`

**A script's reward account as a proposal's return reads "a stake key that isn't yours"**

**Outcome: left.** It matches the certificate line's own "a stake key that isn't yours" for a script's reward account (`dappUi.cert.warn.otherStakeKey`); changing one alone would split the family. The whole address and the warning are right.

*Claim:* proposalLine uses dappUi.proposal.warn.notYours for every return that is neither the account's own nor another of the wallet's. That includes a script's reward account (credential null, cip30.rs:1553-1556), which is no stake key. The withdrawal line says "a reward account that isn't yours" for the same kind of address. The certificate line has the same imprecision (dappUi.cert.warn.otherStakeKey), so this matches what already ships.

*Failure:* A proposal whose deposit goes back to a contract's reward account (stake_test17…) reads "Proposes a protocol parameter change. Its 100,000 ₳ deposit goes to a stake key that isn't yours, stake_test17…, when the action ends." The whole address and the warn tone are right; only "stake key" is wrong. es and ja say the same.

*Evidence:* ui/dapp.ts:216-218 and cip30.rs:1553-1556. I rendered it in en, es and ja with a scratch test in the sandbox (since deleted).

*Suggested fix:* Either leave it, as consistent with the certificate line, or have notYours say "a reward account that isn't yours, {{address}}". That's a critical key, so es and ja would need a fresh blind back-translation.

*Verification:* nit: not verified

### pr3572

**pr357#2 · nit · test-gap** · `seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:1497`

**Two branches of the fix no test pins: the network check for a script's return, and the tone for another of the wallet's keys**

**Outcome: fixed.** Tests: a script reward address on the other network is refused, and a deposit back to another of the wallet's keys warns.

*Claim:* (1) The other-network refusal is tested only with a key's reward address. A mutant that checks the network only when the payload is a key (cip30.rs:1545) passes all three proposal tests.

(2) The staking callout warns for a deposit back to another of the wallet's keys, as the plan and architecture.md:568 say ("a warning when any proposal's isn't the account's own"). No test pins it: changing DappApprovals.tsx:1146 to s.proposals.some((p) => !p.own && p.yours === undefined) passes dapp-prompt, dapp-ties, dapp-ties-accounts and dapp.test.ts.

*Failure:* (1) Under the mutant, a proposal on preprod whose deposit goes back to a mainnet script's reward account reaches the window as "a stake key that isn't yours, stake17…" instead of being refused. The ledger refuses it on submit (ProposalProcedureNetworkIdMismatch), so nothing is lost.

(2) Under the mutant, a deposit back to Account 3's key shows an info-toned staking callout. The separate dapp-certified warning still shows.

*Evidence:* I ran both mutants in the sandbox:
- (1) cargo test -p seedelf-wasm --test cip30_test proposal: 3 passed;
- (2) npx vitest run on the four files: 98 passed.

Every other mutant I tried was caught; they're listed under checked.

*Suggested fix:* (1) Add a script reward address on the other network (header 0xf1 on preprod) to a_proposal_whose_deposit_goes_back_on_the_other_network_is_refused.

(2) In dapp-ties.test.ts's chunk 39 case, assert the raw markup has callout--warn on dapp-staking. shown() strips the tags, so check before it does.

*Verification:* nit: not verified

## Reviewer pr358 (code)

### What it checked

PR #358 (7354f656 = 70dcd81c at 133d598b). Sandbox restored clean at 133d598b. Scratch evidence is in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/ (r172-pr358-mutants.py, r172-pr358-ties.test.ts.txt, r172-pr358-base-pointer-test.diff).

**Is the fix right?** Yes. `owner` (cip30.rs:1086-1123) now asks `Keys::of_hash` about the payment part of any Shelley address. That covers base, pointer and enterprise addresses paid to the stake key's hash, or to the DRep key's hash when governance is granted. The other-network bail still runs first.
- **Collateral refusals:** both now fire for collateral at the stake key's address, a return to someone else and a transaction marked to fail. The report's exact transaction trips the return check first.
- **Others sign too:** the line no longer shows for such an input. The stake hash never reaches `foreign_keys`.
- **Required signers:** a required signer naming the stake hash was already `of_hash`.

**Every place that decides whose something is (item 1):**
- In cip30.rs: inputs and collateral go through `owner`; required signers through `of_hash`; certificates, withdrawals, proposals and votes through `keys.stake` or `keys.drep`. Reference inputs are only counted. Outputs and the collateral return go through `own_address`.
- decode.rs takes no account and decides nothing.
- signData doesn't sign for an address paid to the stake hash. That is consistent, since it's no address the wallet hands out.

**Outputs to the stake key's own address (item 2):** I rendered the real window through the worker and WebAssembly.
- Change paid there counts as leaving, under "An address", with no tie to anything. That is true for the user: account.ts reads payment-key credentials only, so that money never shows again in this wallet.
- A collateral return there, with the account's collateral, is refused as "someone else". Only the site sees that wording.
- A transaction that spends from that address and pays back to it overstates what leaves. It errs in the safe direction, so I didn't raise it.

**What `of_hash` knows (item 3):**
- The payment keys in `view.keys` (discovery's gap-limit walk, both chains). No farther keys.
- The stake key 2/stake_index.
- The DRep key 3/0, only with governance. No committee keys.
- Everything it counts, the wallet also signs with, and the reverse. Nothing is counted that the account can't spend.

**Governance, sessions, callout (items 5 and 6):**
- Revoking governance means disconnecting, which declines what's waiting. Sessions force governance off. stake_index is the session's i on the one-time account root.
- The unknownInputs callout shows only after readTx has refused zero signers and WebAssembly has refused a payment or DRep signer. Every time it shows, signs is exactly ["stake"], so "Only your stake key signs here" is true. The es and ja values and the verified-critical notes match.

**Revert and mutants (item 7):**
- With the fix reverted and the tests kept, all three new tests fail (44 pass, 3 fail).
- Caught: dropping the DRep arm from `of_hash`; `owner` filtering out the DRep; ignoring governance everywhere, and in `owner` only; `of_hash` on collateral only; `of_hash` on inputs only; still counting the stake hash as a stranger's key.
- Survived: `of_hash` only for enterprise addresses (finding 2).
- Baseline: cip30_test passes 47 of 47.

**Considered and not raised:**
- Native-script inputs that the account's own key satisfies. This predates #358, and the wallet can't see such a script reliably: a site can attach it after signing, and an unused script isn't on chain.
- The site-facing wording of the collateral-return refusal.
- destination.ts's `ownAccount` (#359) has the same blind spot as finding 1 for Make public. There the user types the address, so it belongs to the #359 reviewer.

### pr3580

**pr358#0 · medium · correctness** · `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2271`

**A site's prompt doesn't see a payment to another of the wallet's stake keys' own addresses, and says the other side isn't in it**

**Outcome: fixed.** `ties` matches a payment credential against the wallet's stake keys and the public accounts' DRep keys too, as `ours` and for the tie only: its output still reads "An address". With own#0.

*Claim:* The worker's cross-account `ties` check compares an address's payment credential with the wallet's payment keys only (`accounts.payment`, `holder.keyHash`, `others[].payment`), never with its stake keys (`accounts.stake`, `others[].stake`). #358's own rule, which the ledger shares, is that a stake key spends what's at an address paid to its hash, so such an address is that account's or session's. `ties` reads it as a stranger's. Two results: an output paid to the public account's stake key ties nothing, and the session's prompt says the public account isn't in it; and a base address paid to and staked by that key gets C01's 'Someone else's address … that money isn't yours'. The comment on `ours` says it should match 'one of the wallet's keys'. The same gap holds for found inputs, and the other way round (a public prompt paying a session's stake key's address).

*Failure:* A site the user once connected publicly (getRewardAddresses gave it the public stake key) is now on private session 1. It asks the session to sign a transaction paying 4 ₳ to addr_test1vrj40… = 0x60 ‖ the public account's stake key hash. The window shows 'Pays addr_test1vrj40… An address 4 ₳' and 'Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it.' On chain, that output's payment credential is the public account's stake credential, which every base address of the account carries, and only the public stake key can spend it (this wallet never reads it). Paying 0x00 ‖ stakeHash ‖ stakeHash instead shows 'Someone else's address in it carries the stake key of your public account: that money isn't yours.' The public account's prompt paying session 0's stake key's enterprise address says 'Your private balance isn't in it.'

*Evidence:* dapp.ts:2250-2262 (`byKeys`), 2265-2268 (`whose`), 2271-2276 (`ours`), 2296 at 133d598b. Reproduced with a scratch Vitest on dapp-ties.test.ts's harness, running the real DappService and WebAssembly. For `60${publicStakeHash}`, ties, staked and certified were all [], and the rendered page contained 'Your public account and your private balance aren't in it.' For `00${h}${h}`, staked was [{account:0}], with 'that money isn't yours'. For a public prompt paying `60${session0StakeHash}`, ties was [], with 'Your private balance isn't in it.' The gap predates #358 (`ours` is from aaf2e068, 1.5.0's fixes). #358's rule is what makes the address the account's.

*Suggested fix:* In `ties`, have `ours` also return true for `accounts.stake.has(payment) || others.some((s) => s.stake === payment)`. Have `byKeys` also look `payment` up in `accounts.stake` and in `others[].stake`. The DRep key is optional: it's derived nowhere here. Leave the output's own label as it is, because the wallet never reads that address. `ours` returning true also skips a pointless 960-key `fartherKeys` search for it. Tests to add to dapp-ties.test.ts: a session's prompt paying `60${publicStakeHash}` gives ties [{ account: 0 }] and no 'aren't in it'; a public prompt paying `60${session stake hash}` gives ties [0].

*Trace (partly, medium):* The fault is real. I traced it myself and reproduced it with the real DappService and WebAssembly. Three parts of the finding are wrong or overstated: its suggested fix, the reach it claims for found inputs, and how much weight the base-address case carries.

What the code does at 133d598b. `ties` checks only an address's payment credential, and checks it only against payment keys: `byKeys` looks `payment` up in `accounts.payment` and `others[].payment`, and `stake` in the stake maps; `ours` looks only at `accounts.payment`, `holder.keyHash` and `others[].payment`. So when the payment credential of an output (or of a found input) is another account's stake key hash, nothing matches. The ledger takes that stake key's witness for such an address, and #358 already applies that rule to the signing account's own inputs (`of_hash` in cip30.rs). This is the same mistake #358 fixed ("decided who owns an input by the account's payment keys alone"), left in a sibling path in the same sign window. It predates #358: `ties` is from 1.5.0, and only #357 touched it, to add proposals.

What I reproduced:
1. A session's prompt paying `60‖publicStakeHash` gives ties, staked and certified all `[]`. The page says "Pays addr_test1vrj40… An address 4 ₳" and "Your public account and your private balance aren't in it."
2. A session's prompt paying `00‖H‖H` gives staked `[{account:0}]`, with "Someone else's address … that money isn't yours." The tie warning is still shown and is correct. Only the ownership words are false, so on its own this case is low.
3. A public prompt paying `60‖session0StakeHash` gives ties `[]`, with "Your private balance isn't in it." Session addresses are base addresses carrying their own stake key (`00‖key‖stake`), so this is a real on-chain link.

Any connected site that knows the stake key can reach this. It gets the key from getRewardAddresses or from any of the account's base addresses. privacy.md:192 says the public accounts aren't in these transactions "unless the site builds one that pays one of them", and lists the gaps it doesn't cover (L11's out-of-range keys); this one isn't listed. The owner fixed this exact class before (C01, X05, L1: a site's transaction names another of the wallet's stake keys and the prompt said the other side isn't in it). So this is a security-relevant screen saying something false on a reachable path: medium.

I'm not rating it high, for three reasons:
- Only a deliberately hostile site would do this, and that site already knows the link from its two connections.
- No money is at risk: the output is spendable by the user's own stake key.
- The same site can put the link in a datum or in metadata, and the prompt only discloses those as "with data" or "carries metadata".

What's wrong in the finding:
(a) The suggested fix contradicts itself. If `byKeys` looks `payment` up in the stake maps, `whose(p.address, true)` (dapp.ts:2317, the Pays label) changes too. I ran the literal version: `yours` became `{account:0}` ("Your public account") and `0` ("Your private session 1"). That breaks its own "leave the output's own label as it is", and the label would then be misleading, because the wallet never reads that address.
(b) "The same gap holds for found inputs" is true of the session's prompt, but such a spend can't reach the chain unannounced. It needs the public stake key's witness, and at baseline the public prompt for that same transaction says "It moves money between your public account and your private session 1", because it matches the session's input by payment key.

*Trace's evidence:* Code read at 133d598b:
- seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2250-2263 (`byKeys`), 2265-2268 (`whose`), 2271-2276 (`ours`), 2296 (sorting into all/staked), 2317 (the Pays label uses `whose(p.address, true)`), 2781-2793 (`keysOf`).
- src/ui/dapp.ts:118 (`checked`, which decides when the "isn't in it" lines show).
- src/ui/screens/DappApprovals.tsx:1224-1228 (signingTies over ties+staked+certified).
- wasm/src/cip30.rs:475 (`of_hash`), 1271 (`ownPaymentKey` uses payment keys only).
- docs/privacy.md:192.
- #358's diff and PR body.

What I ran:
- A scratch Vitest (tests/zz-r172-v-pr358-0.test.ts) built on dapp-ties.test.ts's harness, first in sandbox r172-pr358, then in my own worktree r172-v-pr358-0 at 133d598b.
- Baseline results: ENT `60‖H` gave ties/staked/certified [] and "Your public account and your private balance aren't in it." BASE `00‖H‖H` gave staked [{account:0}] and "that money isn't yours". A found input at `60‖H` with partialSign gave ties [] and "aren't in it". The public prompt paying `60‖session0Stake` gave ties [] and "Your private balance isn't in it." The public prompt for the found-input spend (SESSION_INPUT plus the `60‖H` UTxO) gave ties [0], "It moves money between your public account and your private session 1", signs ["stake"].
- With my fix applied: ENT, BASE and INPUT gave ties [{account:0}] and staked [], with the label still "An address"; PUB gave ties [0]; the site's own `60‖ownStake` gave ties []. All 32 tests in dapp-ties.test.ts and dapp-ties-accounts.test.ts passed.
- The finding's literal fix (no label flag) set yours to {account:0} and 0.
- Mutant with only the `byKeys` change: every case lands in `staked` ("that money isn't yours").
- Mutant with only the `ours` change: ENT, INPUT and PUB still give ties [].
- My worktree is removed. The sandbox and the main tree are clean.

*Trace's fix note:* The smallest correct fix, in `ties` (dapp.ts). Both parts are needed: each mutant above survives with only one of them.

1. `byKeys(payment, stake, label = false)`: when `!label`, also look `payment` up in `accounts.stake` (inside the same `new Set([...])`, so the `holder || index !== view.account` filter still applies) and add `others.find((s) => s.stake === payment)` to `matched`. `whose` passes `spends` as `label`, so the Pays label at :2317 keeps naming outputs by payment key and still reads "An address".
2. `ours`: also return true for `accounts.stake.has(payment) || others.some((s) => s.stake === payment)`. This moves `00‖H‖H` from `staked` to `ties`, and skips the pointless `fartherKeys` search.

Don't take the suggested `byKeys` change as written: it relabels the output "Your public account" / "Your private session N" for an address the wallet never reads. No new strings and no policy entry are needed. privacy.md's "What links" paragraph and architecture.md's `ties` paragraph should say that an address paid to one of the wallet's stake keys is that account's.

Tests to add to dapp-ties.test.ts:
- A session's prompt paying `60${publicStakeHash}`: ties [{account:0}], staked [], paid[0].yours undefined, and the page has no "aren't in it".
- The same prompt paying `00${h}${h}`: ties [{account:0}], staked [].
- A public prompt paying `60${sessions[0].stake}`: ties [0], yours undefined, no "isn't in it".
- A public prompt paying `60${ownStake}`: ties [] (X06).

*Impact (partly, low):* The fault is real. Every fact in the finding holds, and I reproduced each one. `ours` and `byKeys` only ever compare an address's payment credential with the wallet's payment keys, never with its stake keys. So a payment to `60 ‖ another account's or session's stake key hash` ties nothing, and the prompt says the other side isn't in it. That stays true after #358, whose rule (now in architecture.md) says such an address is spent by one of the wallet's keys. "Partly" is about the reach and the fix, not about whether the fault is real.

Who can reach it: only a site that builds the address on purpose. No wallet hands out a stake key's enterprise address or pays it (#358's own PR body says so), so no honest site does it. A dApp prompt's outputs are built by the site, so no paste, contact or handle gets there. It needs no data-source lie. The site also needs the other side's stake key, and it has that only from its own connection to that side in this browser (getRewardAddresses, or any of the account's addresses). privacy.md already says such a site "can tell the session is yours". So the site learns nothing new. The only extra harm is a weak on-chain hint for third parties: a payment to a key hash, which this wallet never spends on its own. The site could give that hint off chain anyway, or write it into metadata or a datum, which `ties` never reads either.

What the user sees or loses: no money is hidden or taken. The output shows "An address 4 ₳" and counts in Total leaving. It lands at an address only the user's own stake key spends. What's false is the privacy line: "Your public account and your private balance aren't in it" (or "Your private balance isn't in it" on the public side). In the `00‖h‖h` variant the tie is already warned of ("Signing still ties … on chain"). Only "that money isn't yours" is off there, which is a nit.

Disclosure: the screen doesn't show it. The address is truncated and labelled "An address". The docs' lists of exceptions don't include it: architecture.md's "Not covered (L3, L11)" and privacy.md's sentence saying when the prompt can still say "isn't in it".

Owner's calls: none apply. The fix would be a disclosure, not a refusal.

Why low, not medium:
1. **Same class as an accepted low.** 1.5.0's last review (13 findings, all low) left this same false line coming from a site-built enterprise address of the user's own key: a payment key past range with no staking part, "so a session's prompt can still say the public account isn't in it" (L11). It was documented as Not covered. That path is easier to reach than this one, because another wallet of the same phrase can hand out such an address.
2. **Not caused by 1.7.2.** The code is unchanged since aaf2e068 (1.5.0). #358 and #359 never touched `ties`, so it isn't a regression.
3. **Not a path of #358's report.** That report's harm was value leaving unseen, plus the collateral checks. `ties` decides neither value nor signing.
4. **Not medium by the "fix misses its report" test either.** For the same reason as 3, it isn't a missed path of #358's own report.

The suggested fix is partly wrong, and I checked it with a mutant (below).

*Impact's evidence:* All references are at 133d598b, in `extension/src/background/dapp.ts` unless named otherwise.

**The code:**
- `byKeys` (2250–2262) looks a payment credential up in `accounts.payment` and `others[].payment` only.
- `whose` (2265–2268) and `ours` (2271–2276) never compare a payment credential with `accounts.stake` or `others[].stake`.
- `read` (2277) includes the found input rows.
- 2296 splits `all` from `staked`.
- 2317: `paid`'s `yours` comes from `whose(p.address, true)`, which goes through `byKeys`.
- `ours` and `byKeys` are unchanged since aaf2e068 (I ran `git log -L`). The diff f31758b0..133d598b of dapp.ts is only #357's proposal lines.
- WebAssembly's `has_payment_key` and `own_address` (`wasm/src/cip30.rs` around 497–515 and 1271) still list `60‖own stake hash` as a paid output, counted as leaving.
- The docs' known gaps: architecture.md:568 ("Not covered (L3, L11)") and privacy.md:192 ("Such a key with no staking part … can say your public account isn't in it").
- aaf2e068's message says the last review's 13 findings were all low.

**Reproduced:** I ran the pr358 reviewer's scratch Vitest, renamed, in the r172-pr358 sandbox, with the real DappService and WebAssembly.
- A session paying `60${publicStakeHash}`: ties, staked and certified are all [], and the page reads "Pays addr_test1vrj40… An address 4 ₳ … Your public account and your private balance aren't in it."
- `00${h}${h}`: staked is [{account:0}], and the page reads "Someone else's address … that money isn't yours. Signing still ties this private session to your public account on chain".
- The public account paying `60${session0Stake}`: ties is [], and the page reads "Your private balance isn't in it."
- The public account spending a found UTxO at its own stake key's address: signs ["stake"], own 1, net -5 ₳. That is #358's fix working.

**The suggested fix, tried as a mutant:** I patched `byKeys` to also check `accounts.stake.get(payment)` and `s.stake === payment`, and `ours` as suggested. The page then read "Pays addr_test1vrj40… Your public account 4 ₳ … It moves money between this private session and your public account". The public prompt read "Your private session 1 4 ₳". The output's label changes because `yours` comes from `byKeys`.

The sandbox was restored afterwards: dapp.ts checked out, the scratch file removed, status clean at 133d598b.

*Impact's fix note:* The suggested fix is half wrong. Changing `byKeys` relabels the output itself as "Your public account" or "Your private session 1", because `paid[].yours` at line 2317 comes from `whose(p.address, true)` and so goes through `byKeys`. That contradicts the finding's own "leave the output's own label as it is", and it would tell the user the money comes back to a side whose balance never shows it.

The smallest correct fix:
1. Leave `byKeys`, `whose` and the `yours` labels as they are.
2. In `ours`, also return true for `accounts.stake.has(payment) || others.some((s) => s.stake === payment)`.
3. In the `all` push only (line 2296), add the owner of the stake key the payment credential is: `accounts.stake.get(payment)` as `{ account }` (except the site's own account when the prompt is public), and an `others` entry with `s.stake === payment` as its index.

That gives the "It moves money between … and …" warning, and also skips the pointless `fartherKeys` search for `00‖h‖h`.

Tests to add to dapp-ties.test.ts (each fails at 133d598b, as reproduced):
- A session paying `60${publicStakeHash}` gives ties [{account:0}], the row still reads "An address", and the page doesn't say "aren't in it".
- A public prompt paying `60${session0StakeHash}` gives ties [0], the row still reads "An address", and the page doesn't say "isn't in it".
- A session paying `00${h}${h}` gives ties [{account:0}] and staked [].

Also add a clause to architecture.md:568 and privacy.md:192 saying that an address paid to one of the wallet's stake keys ties that side. A docs-only alternative is to add this case to their Not covered and exception lists, as L11 was. The DRep key can stay out, since it's derived nowhere here.

### pr3581

**pr358#1 · low · test-gap** · `seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:946`

**No test pins a base or pointer address paid to the stake key: an enterprise-only `owner` passes every test**

**Outcome: fixed.** The stake and DRep input tests loop over enterprise, base (own and a stranger's stake) and pointer addresses paid to the hash; mutant M5 fails them.

*Claim:* `owner` reads any Shelley address by its payment part, so a base or pointer address paid to the stake key's hash is the account's too, which is correct. But all three new tests build only enterprise addresses (the `enterprise()` helper). architecture.md:562 and the code comments describe the rule as 'at that key's own enterprise address', which invites narrowing the code to match. Nothing would catch that.

*Failure:* A refactor narrows `owner` to `ShelleyDelegationPart::Null` to match the docs. A UTxO at base(stake hash, any stake part), or at a pointer address paid to the stake hash, reads as a stranger's again, the report's bug. All 47 cip30 tests still pass.

*Evidence:* Mutant M5 (`of_hash` only when the delegation part is Null, payment keys otherwise) survived: 47 passed. I added a scratch test: base(stake_hash, account 1's stake key) and pointer(stake_hash, 1/2/3), each expecting own_inputs 1, net -5000000 and signs ["stake"]. It passes at 133d598b and fails under M5. The diff is in scratchpad/review/work/r172-pr358-base-pointer-test.diff.

*Suggested fix:* Add base and pointer cases to `an_input_at_the_stake_keys_own_address_is_the_accounts` (the scratch test above). Reword the rule (see the docs finding) to 'an address paid to its hash, its own enterprise address among them'.

*Trace (confirmed, low):* I traced it from the code and every claim holds.

The code at 133d598b is correct. The `owner` closure (cip30.rs:1106-1114) takes `s.payment()` and calls `keys.of_hash(h)` without looking at the delegation part. So any Shelley address paid to the stake key's hash is the account's: enterprise, base with any stake part, or pointer. The same goes for the DRep key's hash when governance is granted. The ledger agrees: a vkey witness for a key-hash payment credential spends that input whatever the delegation part is. My scratch tests passed at the baseline for inputs, for collateral, and for the DRep key with and without governance. In each case `sign_tx` signs with "stake".

The tests and docs are narrower than the code:
- All three new tests use only the `enterprise()` helper (cip30_test.rs:946-953, called at 968, 994 and 1842).
- No other Rust test puts a found input or collateral at a base or pointer address paid to the stake or DRep hash. I grepped every wasm test file. `ours()` is only called with Receive or Change.
- The only Vitest file that calls inspectDappTx or signDappTx is dapp.test.ts, and it builds no such input. So CI wouldn't catch a narrowing either, even after rebuilding pkg.
- architecture.md:562 states the rule as "at that key's own enterprise address".
- The comments at cip30.rs:1082 and 1618-1620 say the same.
- cip30_test.rs:364-366 is plainly false: "Its witness would spend the input only at the key's own enterprise address".

I ran mutant M5: `of_hash` only when the delegation part is Null, payment keys otherwise. All 252 seedelf-wasm tests still passed (lib 6, api 86, cip30 47, decode 37, the lovejoin tests 55, session 13, others 8). My scratch tests failed under it:
- base(stake_hash, a stranger's stake): own_inputs 0 where 1 was expected.
- Collateral there with its return paid to someone else was not refused (collateral own 0). That is the report's exact failure.
- base(drep_hash, ...) with governance: own_inputs 0.

So the narrowing a reader of the docs might make brings back the bounty bug for base and pointer addresses, and nothing catches it.

Why it's only low:
- No user-facing fault exists today; this is a fix path no test pins, which the brief's scale rates low.
- Even if the regression shipped, its reach equals the report's: no wallet hands out or pays these addresses, and the user must still approve.

The suggested fix is right, and adding base and pointer cases to the input test is enough to kill M5. `owner` is one closure for inputs and collateral, so that test pins both.

*Trace's evidence:* Read at 133d598b:
- seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1086-1123: `owner` uses `s.payment()` and `keys.of_hash(h)`, never `s.delegation()`.
- cip30.rs:475-483: `of_hash` covers stake, DRep and payment keys.
- cip30.rs:1082 and 1618-1620: comments say "enterprise address".
- wasm/tests/cip30_test.rs:946-953: the `enterprise()` helper (Null delegation), the only address used by the new tests at 968, 994 and 1842.
- cip30_test.rs:364-366: "only at the key's own enterprise address" (false).
- docs/architecture.md:562: "the stake key's or (with governance) the DRep key's at that key's own enterprise address".
- `git grep` over wasm/tests/*.rs and *.mjs, extension/tests and e2e: no found input or collateral at a base or pointer address paid to the stake or DRep hash. dapp.test.ts is the only TypeScript caller of inspectDappTx.

Ran in my own worktree, r172-v-pr358-1 (detached at 133d598b, warm target copied in, since removed), with the scratch file wasm/tests/zz_r172_v_pr358_1.rs. It has three tests over base(hash, a stranger's stake), base(hash, own stake) and pointer(hash, 1/2/3), for a stake input, stake collateral, and a DRep input with and without governance.
- Baseline: `cargo test -p seedelf-wasm --locked --test zz_r172_v_pr358_1 --test cip30_test` gave 47/47 and 3/3 passed.
- Mutant M5, applied to cip30.rs: full `cargo test -p seedelf-wasm --locked` gave 252 passed and 2 ignored across every target. The 3 scratch tests failed:
  - zz:187: "base, a stranger's stake: own_inputs left 0 right 1".
  - zz:217: "return to someone else not refused (collateral own Some(0))".
  - zz:243: the DRep input, own_inputs 0.

Copies of the scratch test and the mutant diff:
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/v-pr358-1-scratch-test.rs
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/v-pr358-1-mutant-M5.diff

The worktree is removed and the r172-pr358 sandbox is untouched (git status clean).

*Trace's fix note:* The suggested fix is right.

Smallest fix: in `an_input_at_the_stake_keys_own_address_is_the_accounts` (cip30_test.rs:966), loop over three addresses with the existing assertions (own_inputs 1, net "-5000000", signs ["stake"], others_sign 0, complete):
- `enterprise(stake_hash())`
- `ShelleyAddress::new(Network::Testnet, ShelleyPaymentPart::Key(stake_hash()), ShelleyDelegationPart::Key(<account 1's stake hash>))`
- the same with `ShelleyDelegationPart::Pointer(Pointer::new(1, 2, 3))`

That alone kills M5, since inputs and collateral share the one `owner` closure.

Optional, as a direct pin of the report's collateral half: the same loop in `collateral_at_the_stake_keys_own_address_is_the_accounts`. Under M5 its return to someone else is not refused.

Reword the narrow rule in the same PR, together with the docs finding:
- architecture.md:562: "at an address paid to that key's hash, its own enterprise address among them".
- The comments at cip30.rs:1082-1083 and 1618-1620.
- cip30_test.rs:364-366, which is false as written: the stake key's witness spends at any address paid to its hash, not "only at the key's own enterprise address".

No code change to `owner` is needed.

### pr3582

**pr358#2 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/keys-and-accounts.md:134`

**Docs still say the stake key signs only for staking, and state the rule for enterprise addresses alone**

**Outcome: fixed.** keys-and-accounts.md lists what each key signs for; architecture.md, the cip30.rs comments and cip30_test.rs say any address paid to the hash.

*Claim:* keys-and-accounts.md:134 says 'The stake key signs inside WebAssembly, only for a certificate or a withdrawal', and :139 that the DRep key signs 'only for a DRep certificate or a vote'. Since #358, either key also signs a site's transaction to spend an input or collateral at an address paid to its hash. Other docs and comments say 'enterprise address' where the code takes any address paid to the hash: architecture.md:562 and :566, the cip30.rs comments at 1082 and 1620, and cip30_test.rs:365 ('only at the key's own enterprise address'). architecture.md:566 also says 'no wallet hands out or pays its enterprise address', yet this wallet signs a site's transaction that pays it (the window shows 'An address').

*Failure:* A developer reads keys-and-accounts.md and concludes the stake key can never move money. Or they narrow `owner` to enterprise addresses, as the architecture doc words the rule, and the bug comes back for base and pointer addresses.

*Evidence:* Read at 133d598b. The code path is cip30.rs:1107-1114, which matches on `s.payment()` whatever the delegation part. My base and pointer scratch test confirms it.

*Suggested fix:* keys-and-accounts.md:134 and :139: add 'and, for a site's transaction, what's at an address paid to its hash (#358)'. architecture.md:562 and :566, cip30.rs:1082 and :1620, cip30_test.rs:365: say 'an address paid to its hash (its own enterprise address, or any other)'. On :566, say no wallet hands that address out (drop 'or pays').

*Trace (partly, low):* The main fault is real. Since #358, `owner` (cip30.rs:1106-1116) gives `keys.of_hash(h)` for any Shelley address whose payment part is a key hash, and it ignores the staking part. So the stake key, and the DRep key with governance, now sign a site's transaction because of an input or collateral paid to their hash. That covers base and pointer addresses as well as enterprise ones. Before #358 they never signed because of an input. My scratch test shows all four address shapes count as the account's.

So keys-and-accounts.md:134 ("only for a certificate or a withdrawal") and :139 ("only for a DRep certificate or a vote") now say something false. The worst part is that they suggest the stake key's signature never moves money. That is the misconception behind the bounty report, and #358 fixed the same idea in the callout text ("it spends none of them") but left it in this doc.

Where the finding is wrong or short:
1. **The "only" was already stale before #358.** At f31758b0, required signers already went through `of_hash` (cip30.rs:1176-1185 there), so either key signed when a site named it. Both keys also signed `signData` (stake address at :2026, DRep at :2000/:2019). The suggested fix only adds #358's case, so the sentence would still be false. Drop "only", or list every case.
2. **Most of the "enterprise address" spots are incomplete, not false.** architecture.md:562 states the general rule correctly ("by the key hash its address is paid to") and then names only the enterprise case. The cip30.rs comments at :1082 and :1620 don't say "only" either; they are nits. The one false statement is cip30_test.rs:365: "Its witness would spend the input only at the key's own enterprise address". The ledger takes that key's witness for a base or pointer address paid to the hash too.
3. **Dropping "or pays" at architecture.md:566 is wrong.** The doc means that no wallet's own flows put money there, as change or a receive address. That is true, and the wallet itself treats a site's output there as someone else's: `own_address` (:1234) needs the account's stake key in the staking part, and `has_payment_key` (:1271) checks payment keys only, so the window shows "An address", counted as leaving. The argument also holds for base and pointer shapes, since no wallet hands those out either.
4. **The second failure scenario is guarded by tests, not docs.** Every #358 test builds its stake- or DRep-hash input with `enterprise(...)` (cip30_test.rs:946-1001 and :1842). Narrowing `owner` to addresses with no staking part would pass all of them.

Reach is a developer reading the docs; nothing a user sees is wrong. That makes it low, as the reviewer rated it, with the comment-only parts at nit.

*Trace's evidence:* All reads at 133d598b, via git show.
- keys-and-accounts.md:134 and :139 are unchanged since f31758b0.
- cip30.rs:475-483 is `of_hash` (stake, then DRep, then payment keys). :1106-1116 is `owner`, which matches `s.payment()` and ignores `s.delegation()`. It is called for inputs at :1132 and for collateral at :1151.
- Required signers go through `of_hash` at :1200-1209, and did already at f31758b0:1176-1185, before #358.
- signData: the stake key at :2083-2085, the DRep key at :2057-2078 (enterprise address with no staking part only).
- How outputs read: `own_address` at :490-500, its use at :1234, and `has_payment_key` at :506-509 and :1271.
- Lines #358 wrote (git diff 7354f656^1 7354f656): architecture.md:562 and :566, the cip30.rs comments at :1079-1085 and :1615-1624, and cip30_test.rs:364-366.
- The #358 tests at cip30_test.rs:946-1001 and :1841-1861 use only `enterprise(stake_hash())` and `enterprise(drep_hash())`. `git grep ShelleyPaymentPart::Key(` finds no other test with these hashes as the payment part.
- I ran a scratch test, wasm/tests/zz_r172_v_pr358_2.rs, in the r172-pr358 sandbox with `cargo test -p seedelf-wasm --locked --test zz_r172_v_pr358_2`: 3 passed.
  - Each of enterprise, base (own stake), base (their stake) and pointer(1,2,3) paid to the stake key's hash gave own_inputs=1, spent=5000000, net=-5000000, signs=["stake"], others_sign=0 and complete=true, and sign_tx signed ["stake"].
  - The same four shapes paid to the DRep hash, with governance, gave own_inputs=1 and signs=["drep"].
  - An unknown input with a zero withdrawal still signs ["stake"] (the chunk 29 path).
- I deleted the scratch test and restored the sandbox with `git checkout -- . && git clean -fd`; it is clean.
- Side effect: that clean also deleted an untracked file another verifier left there, extension/tests/zz-r172-v-pr358-0.test.ts. There is no copy in the scratchpad. If that verifier is still running, it has to write the file again.

*Trace's fix note:* Smallest correct fix, wording kept short:
- **keys-and-accounts.md:134:** drop "only" and list every case: "The stake key signs inside WebAssembly and never leaves it: the account's certificates and withdrawals and, for a site, a required signer naming it, a message for the stake address, and an input or collateral at an address paid to its hash (#358)."
- **keys-and-accounts.md:139:** the same for the DRep key, with governance: DRep certificates, votes, a required signer, a message by its ID or its enterprise address, and an input at an address paid to its hash. flows.md:433 gives the DRep key the same short list; one clause covers it.
- **architecture.md:562:** "...or the DRep key's (with governance), at any address paid to that key's hash: its own enterprise address, or the hash under any staking part."
- **architecture.md:566:** say "an address paid to its hash" instead of "its enterprise address". Keep "or pays". It's true in the doc's sense, and the wallet shows a site's output there as "An address".
- **cip30.rs:1082 and :1620:** the same wording, in the comments only.
- **cip30_test.rs:365:** remove the false "only at the key's own enterprise address".

What actually stops the narrowing in the failure scenario is a test. In `an_input_at_the_stake_keys_own_address_is_the_accounts` and `an_input_at_the_drep_keys_own_address_is_the_accounts_only_with_governance`, loop over enterprise, base (own stake), base (someone else's stake) and pointer addresses paid to the hash. Each must give own_inputs=1 and signs ["stake"] or ["drep"]. All four pass at 133d598b; adding a "no staking part" condition to `owner` would fail them.

### pr3583

**pr358#3 · nit · ux-text** · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:1004`

**The 'It signs for' row says 'your staking' when the stake key signs only to spend a UTxO at its own address**

**Outcome: backlog.** "It signs for your staking" names the stake key by its role; saying what it signs for needs WebAssembly. A line under *Signing and the connector*.

*Claim:* Since #358, the stake key signs to spend a found input or collateral at its own address, which the window counts as the account's. The signer row still names that signature only as 'your staking', though nothing in the transaction may be about staking. The total is right, so the amount isn't misstated. The row only names the wrong reason for the signature.

*Failure:* A public site's transaction spends a 5 ₳ UTxO at the stake key's enterprise address and pays 4 ₳ to the site. There's no certificate, withdrawal or required signer. The window reads 'Total leaving your public account 5 ₳ … It signs for your staking … Pays addr_test1qzus… An address 4 ₳'.

*Evidence:* A scratch Vitest over the real worker gave summary signs ["stake"], ownInputs 1, netLovelace -5000000, and that rendered text. DappApprovals.tsx:1000-1013 at 133d598b maps "stake" to dappUi.yourStakeKey ('your staking') whatever the stake key signs for.

*Suggested fix:* Only if worth it for a patch, since it needs WebAssembly and a pkg rebuild. Have the summary say how many inputs or collateral the stake or DRep key spends, and count them in the row's existing 'N of your addresses' (no new string). Keep 'your staking' for a certificate, a withdrawal or a required signer. Pin it with a SignTx render test.

*Verification:* nit: not verified

### pr3584

**pr358#4 · nit · ux-text** · `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:509`

**dappUi.warn.unknownInputs_one says 'what they hold' of one UTxO**

**Outcome: fixed.** With i18n#1: en `dappUi.warn.unknownInputs_one` says "what it holds".

*Claim:* The English singular reads 'It spends {{count}} UTxO the wallet couldn't find, so what they hold can't be shown.' #358 edited this string. The Spanish singular already has 'lo que contiene', and Japanese has no singular.

*Failure:* A site's transaction with one input the wallet couldn't find shows 'It spends 1 UTxO the wallet couldn't find, so what they hold can't be shown. Only your stake key signs here.'

*Evidence:* en.json:509 at 133d598b. The plural pronoun was there before #358 too ('none of them').

*Suggested fix:* 'so what it holds can't be shown.' The meaning is unchanged, so no new back-translation is needed.

*Verification:* nit: not verified

## Reviewer pr359 (code)

### What it checked

PR #359 (d2a8bcc0, merged as 133d598b). I read the PR body and diff, and traced the fix through Rust and TypeScript.

Callers: only destination.ts calls isOwnAddress and carriesStakeKey (ownAccount, then resolveDestination). Send and Make public reach it through withdraw.resolve and destinationResolver, and pasted text, $handles, Contacts and Your accounts all go through it. Readers of `own`/`staked`:
- CardanoSend: leaving and tokenKinds (lines 164-171), the form and review notes.
- Withdraw: the warnings.
- Destination.tsx: the save link.
- pending.ts paysAccount: a Make public to such an address now re-reads only the private side.

These already decide by payment key and are unchanged and consistent: activity.ts accountMatcher, incoming.ts toAccount, tx-view markYours, Lovejoin madeBy, dApp ties. dapp.ts paysHolder (sentOutputs) still counts the stake key alone, but only to answer a site's input lookups locally, and makes no claim to the user. Not reported.

Search depth:
- Runs only in the worker: once per settled read (400 ms debounce; partial text fails checkPayable before any derivation) and once per review build (destinationResolver caches within one build; Back reuses KnownRead). Nothing caches across reads.
- Measured with the 133d598b pkg under Vitest/Node: about 204 ms per stranger's key under the account's stake key (1,000 key_hash calls, each 3 Ed25519 base-point multiplications), about 8 ms for other addresses. The UI thread isn't blocked; the worker delays other messages by about 0.2 s. Acceptable.
- Rust 0..500 matches FARTHER_KEYS (index < 500).

Edge addresses:
- Enterprise address with an own key: own, through the first 20 plus found keys.
- Pointer: never `staked` (unchanged).
- Byron, script payment, other network: refused by checkPayable before ownAccount.
- Another account's key under this account's stake key: that account's (tested).
- This account's key under another account's stake key: own, and OwnNote's "comes back" is true. The tie to the other account isn't said, as before #359.
- Own keys at 500 or past, or a key crossed between accounts, read as "someone else's". Contrived, and the dApp side accepts the same limit.

Tests:
- Rust: reverting the fix (tests kept) fails the new test at !own(franken); dropping the 500 search fails it at own(far).
- TypeScript: pre-fix destination.ts fails 3 tests, and the old rule simulated in ownAccount fails 3.
- Mutant (no StakedWarning on either screen, and Send's Total leaving skips staked-on-active): own-address, send, own-account-names, spell-check, account-recipients-side and withdraw stay 42/42 green.
- A scratch test on the screens-wiring seam passes at baseline ("Total leaving your public account 5.2 ₳ and 1 token") and fails 3 of 3 under that mutant. Copy: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r172-pr359-screens.test.ts
- The i18n, critical-helpers, words and values-in-place tests pass. es/ja placeholders and grammatical gender checked.
- Docs: flows.md, keys-and-accounts.md, wasm/README.md, rpc.ts and the lib.rs docs are true to the code.

Sandbox restored (`checkout` plus `clean`), and cargo re-warmed at the baseline.

### pr3590

**pr359#0 · medium · regression** · `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/StakedWarning.tsx:28`

**Send to someone's address under another account's stake key no longer says it ties the two accounts**

**Outcome: fixed.** Send's warning for another account's stake key adds that paying it still ties the two accounts on chain (`send.warn.stakedOther`, `.stakedOtherNth`), back-translated blind.

*Claim:* Before #359, the stake-key rule made the worker call this address Account 2's. Send from Account 1 then showed OtherAccountNote: "Anyone can see your two accounts pay each other and tell they're one wallet's. Sending from your private balance avoids that." #359 rightly drops "This is your own Account 2". Its Send StakedWarning now says only "This isn't your Account 2: it has that account's stake key but someone else's payment key, so only they can spend this." That is shown on the form (CardanoSend.tsx:298-300) and the review (233-237). Gone are the on-chain tie (Account 1 paying an address that carries Account 2's stake key, which an observer can't tell from paying Account 2) and the private alternative. The wallet treats the same shape as a tie everywhere else: the dApp prompt's staked warning says "Signing still ties Account 1 to Account 3 on chain" (en.json:496), Make public's StakedWarning keeps its link sentence, and privacy.md:98 says a payment between accounts is a known link that the Send form states.

*Failure:* A wallet has Account 1 (active) and Account 2. The user pastes an address, or a $handle resolves to one, that pairs a stranger's payment key with Account 2's stake key. destination.ts:125-136 returns {own:false, staked:1}. Send's form and review say only that it isn't Account 2's and only they can spend it. Nothing says that anyone can now see Account 1 paying Account 2's stake key and tie the two accounts, or that paying from the private balance avoids it. The same address at 7354f656 showed that warning.

*Evidence:* At 133d598b: StakedWarning.tsx:26-29, CardanoSend.tsx:233-237 and 298-300, destination.ts:125-136. I rendered Send's review with the house seam (screens-wiring-review-fixes.test.ts), active 0, with several accounts. After the fix, {own:false, staked:1} shows: "This isn't your Account 2: it has that account's stake key but someone else's payment key, so only they can spend this." The pre-fix shape, {own:true, ownAccount:1}, showed: "This is your own Account 2. Anyone can see your two accounts pay each other and tell they're one wallet's. Sending from your private balance avoids that." Also cited: en.json:1776 and 496, privacy.md:98, tests/dapp-ties-accounts.test.ts:375.

*Suggested fix:* In StakedWarning, side "send", when `account !== active` (useAccounts), say the tie in one short clause. For example, new .warn. keys (send.warn.stakedOther and its Nth form) that end: "…so only they can spend this. Anyone can still see your two accounts pay each other; sending from your private balance avoids that." Back-translate es and ja and add the keys to the critical set. Pin it in a screens-wiring test: Send's review with {own:false, staked:1} and active 0 states the tie; with staked:0 it doesn't. No refusal.

*Trace (partly, low):* The fault is real, and it sits on the path the finding describes. I'd rate it low, not medium.

What holds, traced from the code:
- **Worker.** At 133d598b, `ownAccount` (destination.ts:114-136) returns `{own:false, staked:1}` for a stranger's payment key under Account 2's stake key while Account 1 is active. own-address.test.ts:90-94 pins exactly that, and I ran it: it passes.
- **Screens.** `StakedWarning` side "send" (StakedWarning.tsx:25-29) only ever picks `send.warn.staked` or `send.warn.stakedNth`. Neither key says anything about a tie, and the component never compares `account` with `active`. CardanoSend shows it on the form (295-300) and on the review (233-243).
- **Rendered.** I rendered the real CardanoSend over a copy of the house seam, with active 0 and two accounts:
  - The form says "This isn't your Account 2: it has that account's stake key but someone else's payment key, so only they can spend this." Its only other privacy text is the generic callout, "Anyone can see this came from your public account. To avoid that, send from your private balance."
  - The review shows the same warning and no privacy line at all.
  - The pre-#359 shape, `{own:true, ownAccount:1}`, gave "This is your own Account 2. Anyone can see your two accounts pay each other and tell they're one wallet's. Sending from your private balance avoids that." on both.
- **What 1.7.1 did.** At 7354f656 and f31758b0, `is_own_address` called any address carrying an account's stake key that account's own (the lib.rs diff removes that). So the loop returned `{own:true, account:1}` and showed that note.
- **The wallet's own rule.** The wallet already counts this shape as a tie:
  - dapp.ts:2214-2216 (1.5.0's C01): "An address none of the wallet's keys spends … still ties the account whose stake key it carries". The prompt says so (en.json:496, dapp-ties-accounts.test.ts:375).
  - privacy.md:192 says the same for sites.
  - privacy.md:92 promises that every screen that could link two accounts says what it would reveal.
  - #359's own doc for `staked` (rpc.ts:798-803) says "while anyone sees it tied to that account".
  - The omission isn't an owner's call. StakedWarning's header shows Send's text was copied from OwnNote, the active-account note, which links nothing. The other-account case was missed.

Where the finding overstates:
- **Severity.**
  - Nothing on the screen is false, and the screen states every fact behind the tie: the form says the address carries Account 2's stake key, and its generic callout says anyone sees the payment came from the public account.
  - The path is narrow and looks like an attack: a hand-made address that puts someone's payment key under another known account's stake key, or a contract's under it. By then the user has been told only a stranger can spend it, so the tie only matters to a user who pays anyway.
  - The tie line it lost was half of the bug's false note "This is your own Account 2", so this is a gap in the fix more than a feature that regressed.
  - Precedent: 1.5.0's cross-area X05 was the same kind of gap, a site's prompt missing the tie to another account's stake key in a certificate (it even said "isn't in it"). It was a low: that review's one medium was X01.
- **Minor details.**
  - The private-balance alternative isn't gone from the form: the generic callout keeps it. It is missing on the review.
  - privacy.md:98 is about paying your own accounts. Lines 92 and 192 are the better citations.
  - The suggested wording "your two accounts pay each other" is wrong in a small way: Account 2 isn't paid, it only reads that way on chain. The dApp's "ties … on chain, where anyone can see it" is accurate.

*Trace's evidence:* **Code read at 133d598b:**
- StakedWarning.tsx:19-37: the send side has no check of the active account and no tie text.
- CardanoSend.tsx:233-243 (review), 295-300 (form) and 387-397 (the form's generic privacy callout; the review has none).
- destination.ts:114-136.
- en.json:1783-1784 (`send.warn.staked`/`send.warn.stakedNth`), 1776 (`send.privacy.otherAccount`), 496 (`dappUi.ties.privacy.staked`), 2994-2995 (`withdraw.warn.staked`).
- dapp.ts:2209-2216 and 2294-2296, rpc.ts:798-803, privacy.md:92, 98 and 192.

**Before #359:**
- `git show 7354f656:…/destination.ts`: the loop returns own for any `isOwnAddress` match.
- `git diff 7354f656 133d598b -- wasm/src/lib.rs`: it removes the stake-key-match return from `is_own_address`.
- f31758b0's en.json:1775 has the same OtherAccountNote text.

**Ran, in the r172-pr359 sandbox:**
- `npx vitest run tests/own-address.test.ts -t "says whose stake key it carries"`: passes, so `{own:false, staked:1}` is what the worker returns.
- A scratch test, `tests/zz-r172-v-pr359-0-staked-tie.test.ts`. It copied the seam from screens-wiring-review-fixes.test.ts, seeded `reads` (form) and `summary` (review), and rendered CardanoSend under AccountsContext with active 0 and accounts [0,1]:
  - **Form, staked:1:** "This isn't your Account 2: it has that account's stake key but someone else's payment key, so only they can spend this." The only other privacy text is "Anyone can see this came from your public account. To avoid that, send from your private balance."
  - **Review, staked:1:** the same warning, then "Confirms in about a minute.", with no tie and no private alternative.
  - **The `{own:true, ownAccount:1}` shape (pre-#359):** "This is your own Account 2. Anyone can see your two accounts pay each other and tell they're one wallet's. Sending from your private balance avoids that."
  - I deleted the scratch file afterwards; `git status` in the sandbox is clean.

**Severity precedent:** the 1.5.0 fix commit aaf2e068 and archive/roadmap.md:104-106 count X01 among the mediums, so X05 (a missing tie disclosure for another account's stake key) was a low.

*Trace's fix note:* **The fix.** Change StakedWarning.tsx, side "send" only:
- Read `active` from `useAccounts()`.
- When `account !== active`, use new keys with one added sentence, for example `send.warn.stakedOther` and `send.warn.stakedOtherNth`. Name the active account with `accountPicker.numbered` and `ownAccountNumber`, as `whose` does.
- Follow the site prompt's wording, which is accurate. For example, "…so only they can spend this. Paying it still ties {{from}} to {{whose}} on chain, where anyone can see it." Don't say "your two accounts pay each other": Account 2 isn't paid.
- The private-balance clause is optional. The form's generic callout already carries it, and only the review lacks it.
- Leave Make public's warning alone. Add no refusal.

**Translations.**
- Translate es and ja.
- Back-translate both blind.
- Add the keys to docs/i18n/critical-keys.json, verified-critical-{es,ja}.json and the provenance files, as #359 did.

**The test.** In own-account-names.test.ts, whose `shown` helper is already active 0 with three accounts:
- StakedWarning side "send" with account 1, alone and with nth, states the tie and names Account 1 · Main and Account 2 · Savings.
- With account 0 and one account, it reads exactly as now.
- Revert the change and watch the first assertion fail.
- Optionally, add a CardanoSend review render over the screens-wiring seam with `{own:false, staked:1}`.

*Impact (confirmed, low):* The defect is real. Before #359, `is_own_address` matched on the stake key alone. An address pairing a stranger's payment key with Account 2's stake key came back from `ownAccount` as {own:true, account:1}. Send from Account 1 then showed OtherAccountNote, en.json:1776. Its first sentence, "This is your own Account 2", was the bug. Its second and third were true: anyone can see the payment and tie the accounts, and the private balance avoids it. #359 removed the false sentence and the true ones went with it. An observer can't tell this address from Account 2's own, so paying it from Account 1 still shows Account 1 paying Account 2's stake key on chain.

The wallet says this tie everywhere else for the same shape:
- The dApp prompt (1.5.0's C01) says "Signing still ties … on chain" (en.json:496).
- #359's own Make public warning keeps its link sentence (en.json:2994-2995).
- privacy.md:92 promises that every screen that could make a link between accounts says what it would reveal.
- The owner's text rule says a privacy note may be shortened but must never drop what it ties.
- private-by-default says to disclose a link the user chooses.

So the fix restores a disclosure. It doesn't re-argue an owner's call: it adds no refusal (#359's call), and one clause stays within the short-text rule, since Make public's version is already two sentences.

Reach: a pasted address, a Contact, or a $handle whose owner points it at such an address. No lying data source is needed, and a site can't push it into Send. Someone has to build the address on purpose from one of the user's other accounts' stake keys. The wallet must have several accounts, the stake key must be another account's (not the active one), and the user must pay after a warn-tone callout saying the address isn't theirs.

What the user loses: no money. The screen says nothing false. A user who keeps accounts apart for privacy may tie them for third-party chain analysis without being told. The payee already learns both accounts either way.

What the same screen already shows:
- The warning itself says the address "has that account's stake key", which is where the tie comes from.
- The form's privacy callout is always shown (CardanoSend.tsx:387-397, `send.privacy.open`): "Anyone can see this came from your public account. To avoid that, send from your private balance."
- So the finding's claim that the private alternative is gone is wrong for the form. It is true for the review, which shows only the StakedWarning (CardanoSend.tsx:233-243).

What's missing is the explicit consequence. The only display it regresses from carried the false sentence. Nothing false is shown, no money is at risk, and only a deliberately built address in a several-account wallet reaches it. So I rate it low rather than medium. It's still worth a one-clause fix for 1.7.2, given C01's precedent and the owner's never-drop-the-tie rule.

*Impact's evidence:* I read the code paths at 133d598b in the read-only checkout. I ran no tests: the sandboxes are other agents'.
- StakedWarning.tsx:25-32: the send side uses `send.warn.staked`/`stakedNth` with no tie clause. en.json:1783-1784 is that text. Compare en.json:2994-2995 (Make public keeps "Anyone can still link the address…") and en.json:496 (the dApp prompt's `dappUi.ties.privacy.staked`: "Signing still ties {{from}} to {{list}} on chain").
- destination.ts:110-136: `ownAccount` returns {own:false, staked:index} via `carriesStakeKey`.
- CardanoSend.tsx:233-243 (review) and 295-300 (form): with `!p.own`, only StakedWarning shows. OtherAccountNote (CardanoSend.tsx:447-454, `send.privacy.otherAccount`, en.json:1776) now shows only for a real own-account match.
- CardanoSend.tsx:387-397: the form's privacy callout is unconditional and already names the private-balance alternative. The review (197-251) has no such callout.
- `git diff 7354f656 133d598b -- wasm/src/lib.rs`: the stake-key match came out of `is_own_address`. At 7354f656 (destination.ts, pre-#359), the known-account loop returned {own:true, account:1} for this shape, so OtherAccountNote showed. That confirms the before/after the finding describes.
- dapp.ts:67-77 (`stakedLine`'s comment: "Signing ties them all the same").
- privacy.md:92 and :98.
- flows.md:227: the docs describe Send's staked warning without the tie, so they match the code and promise nothing more.
- Owner memories: ui-text-short.md ("never drop what it ties") and private-by-default.md ("say what it reveals, name what it links").

*Impact's fix note:* The smallest correct fix:
- **Where:** StakedWarning, send side, only when `account !== useAccounts().active`. The active account's own stake key under a stranger's key ties nothing, and with one account `account` is always the active one.
- **Text:** append one short clause, from new `.warn.` keys `send.warn.stakedOther` and `send.warn.stakedOtherNth`.
- **Wording:** don't use the suggested "Anyone can still see your two accounts pay each other". It's literally false: Account 2 receives nothing, a stranger does. Mirror en.json:496 instead: "…so only they can spend this. Paying it still ties {{from}} to {{whose}} on chain, where anyone can see it." Take `from` from `useAccounts().name`, computed at render and never persisted.
- **Private-balance clause:** optional. The form already says it (`send.privacy.open`). Leave it out to keep the note short, or add it only if the owner wants it on the review.
- **i18n:** add the keys to docs/i18n/critical-keys.json and back-translate es and ja blind into verified-critical-es/ja.json. Then confirm `tests/i18n-critical-helpers.test.ts` and `words.test.ts` pass.
- **Test:** add a screens-wiring test on Send's review and form with several accounts, active 0:
  - {own:false, staked:1} contains the tie clause naming Account 2.
  - {own:false, staked:0} doesn't.
  - Account 2's real address still shows OtherAccountNote.
- No refusal.

### pr3591

**pr359#1 · low · test-gap** · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:164`

**No test pins the screens' half of the fix: the new warnings and Total leaving**

**Outcome: fixed.** With own#3: screens-wiring tests render Send's and Make public's forms and reviews with a staked destination, and Send's Total leaving.

*Claim:* The new tests stop at the worker: own-address.test.ts and send.test.ts check {own:false, staked}, and own-account-names.test.ts renders StakedWarning alone. Nothing renders Send's or Make public's form or review with a `staked` destination. So the part of the bug users saw can come back unseen: Send's review counting the payment and its tokens as leaving, and the warning in place of "it comes back".

*Failure:* Mutant: delete the four StakedWarning renders (CardanoSend.tsx:233-237 and 298-300, Withdraw.tsx:249-256 and 318-320), and make Send's `leaving` skip `p.staked === active`. Send's review would again show only the fee as leaving, with no warning, and every related test stays green.

*Evidence:* I ran that mutant in the sandbox: own-address, send, own-account-names, spell-check, account-recipients-side and withdraw tests, 6 files, 42/42 pass. A scratch test on the house seam passes at 133d598b. It sees "Total leaving your public account 5.2 ₳ and 1 token", "Public account after 94.8 ₳", the Send warning, "Recipient 2 isn't your Account 2" with several accounts, and Make public's text. It fails 3 of 3 under the mutant. Copy: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r172-pr359-screens.test.ts

*Suggested fix:* Add these cases to tests/screens-wiring-review-fixes.test.ts.
- Send's review: seed([{}, false, "", false], summary) with {own:false, staked:0, one token}. Expect the warning, no "comes back, less the fee", and Total leaving equal to amount plus fee "and 1 token".
- The Nth form with several accounts.
- Make public's review: seed([{}, false], …) with staked, expecting its text.

*Trace (partly, low):* Real, for the warnings. The only screen code #359 added is the four StakedWarning renders: Send's review at CardanoSend.tsx:233-243 (the warning at 234-237), Send's form at 298-300, Make public's review at Withdraw.tsx:248-256 and its form at 318-320. No test pins any of them. I reverted exactly those renders and their imports in my own worktree, and the typecheck stayed clean. The full unit suite stayed green: 249 files passed and 1 was skipped, 2970 tests. Only the scratch cases failed. Nothing in e2e mentions send-staked, withdraw-staked or the warnings' words, and the PR says it added no e2e test. own-account-names.test.ts renders StakedWarning only on its own.

Overstated, for "Total leaving". #359 didn't change the screens' leaving code: CardanoSend.tsx:164-171 is the same as before. Counting the payment as leaving, and dropping "it comes back", both follow from the worker now returning own:false, and that is pinned. A TS mutant that makes a stake-key-only address own again (destination.ts:124 `active.own || active.staked`) fails 3 tests in own-address.test.ts and send.test.ts. In Rust, api_test.rs:2968 pins is_own_address. The finding's leaving mutant (`|| p.staked === active`) does survive the house tests: 15 related files stay green. But it is new code that brings the bug back on purpose, not a revert of #359. Under the exact revert of the screens' half, Send's review still counts the payment and says nothing false. The scratch output was "Total leaving Public account 1 5.2 ₳ … Public account 1 after 94.8 ₳" with no note at all. So the scenario's "only the fee as leaving" happens only with the inserted mutant. Losing the renders drops a disclosure but leaves no false text, so this is low ("a fix no test pins"), not medium.

The suggested fix is incomplete. Its cases seed only the reviews' summary, so the two form-side renders would stay unpinned. I deleted only those two (CardanoSend.tsx:298-300, Withdraw.tsx:318-320). All 5 of the reviewer's scratch cases still passed, and my two form cases failed. The form can be reached on the house seam.

*Trace's evidence:* Read at 133d598b: CardanoSend.tsx:164-171 (leaving and tokenKinds, untouched by #359; `git diff 7354f656 133d598b` shows only the StakedWarning hunks), 233-243 and 298-300; Withdraw.tsx:248-256 and 318-320; destination.ts:63-69 and 110-136; handlers.ts:223-224 (the form's resolve-destination goes through withdraw.resolve and carries `staked`); send.ts spreads the destination into payments. Tests that touch #359: own-address.test.ts, send.test.ts, own-account-names.test.ts:62-76 (the component only), api_test.rs:2968. `git grep` of tests/ and e2e/ for send-staked, withdraw-staked, "stake key but" and "isn't your" finds own-account-names alone (plus dapp-staked, which is unrelated).

What I ran, in my own worktree at 133d598b (since removed):
(1) Mutant A: the four renders and both imports removed, typecheck clean. Full `npx vitest run`: 3 failed | 2970 passed | 4 skipped. All 3 failures were the scratch review cases; 249 house files passed.
(2) Form-only mutant: the reviewer's r172-pr359-screens cases passed 5/5. My "Send's form warns" and "Make public's form warns" failed.
(3) Mutant B (`|| p.staked === active` in leaving and tokenKinds): `vitest related CardanoSend.tsx` gave 13 house files green. Only the scratch Total-leaving assertions failed.
(4) Worker mutant (destination.ts:124 `if (active.own || active.staked)`): own-address.test.ts and send.test.ts, 3 failed.

At baseline both scratch files passed, 9/9. The sandbox r172-pr359 was never edited and is clean. My test is kept at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/v-pr359-1/zz-r172-v-pr359-1-mine.test.ts. The full-suite log is mutA-full.txt beside it.

*Trace's fix note:* Add these cases to tests/screens-wiring-review-fixes.test.ts. CardanoSend needs importing there: `const { CardanoSend } = await import("../src/ui/screens/CardanoSend")`. Use a one-account AccountsContext and A = any address.

The two forms, which the suggested fix leaves out:
- Send's form: `seedInitial({}, { 0: { to: A, read: { state: "read", destination: { address: A, own: false, staked: 0 } } } })`, then render CardanoSend with `to: A`. Expect `data-testid="send-staked"` and no "comes back, less the fee".
- Make public's form: the same seed, Withdraw with `to: A`. Expect `withdraw-staked` and no `withdraw-own`.
- Draft 0 is the first draft's id. DestinationInput reuses `known` without asking the worker, so no effect needs to run.

The reviews:
- Send: `seed([{}, false, "", false], summary)`, with the payment {own:false, staked:0, 5 ₳, one token} and a 0.2 ₳ fee. Expect `send-staked` and no "comes back". Keep the row "Total leaving your public account" = "5.2 ₳ and 1 token" as cheap extra cover; the worker tests already pin its root.
- Send with two recipients and several accounts: "Recipient 2 isn't your Account 2".
- Make public: `seed([{}, false], …)` with staked. Expect `withdraw-staked`.

Check each against a mutant:
- All four renders deleted: every case fails.
- Only the forms' renders deleted: the two form cases fail.
- Only the reviews' renders deleted: the three review cases fail.

My working copy of the form and review cases passes 4/4 at 133d598b.

### pr3592

**pr359#2 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/privacy.md:65`

**privacy.md still says Make public's own-account warning covers any address carrying an account's staking key**

**Outcome: fixed.** privacy.md's Make public paragraph states #359's rule.

*Claim:* The Exit section reads: "It warns when the destination is any of this wallet's own Cardano accounts (chunk 18): an address carrying one's staking key, or whose payment key is one of its own (the first 20 of each chain, and, for the account the wallet is on, any the last balance reading found…)". Since #359 the payment key alone decides (lib.rs:4900-4931, destination.ts:110-137). An address that only carries the stake key gets StakedWarning instead ("This isn't your public account … Anyone can still link the address…"). The account's keys are now looked for up to the 500th under its stake key, which the sentence leaves out. #359 updated flows.md, keys-and-accounts.md and wasm/README.md, but not this.

*Failure:* A developer reading privacy.md's Exit section concludes that an address with the account's stake key and a stranger's payment key is "one of this wallet's own Cardano accounts". That is the rule the 2026-11-02 bounty report overturned, and the doc also misses the 500-deep search.

*Evidence:* privacy.md:65 at 133d598b, against wasm/src/lib.rs:4900-4931 and destination.ts:110-137. `git diff 7354f656 133d598b --stat` doesn't list privacy.md.

*Suggested fix:* Reword: "…an address under one of its payment keys (the first 20 of each chain; for the account the wallet is on, any the last balance reading found; up to the 500th under that account's stake key). One that only carries its stake key, under someone else's payment key, isn't the account's. It gets a warning of its own: only that key's holder can spend it, and anyone can still link it to this money (the 2026-11-02 bounty report)."

*Trace (confirmed, low):* I traced the rule in the code and couldn't refute the finding. privacy.md:65 at 133d598b still describes the rule from before #359. It says "this wallet's own Cardano accounts" include "an address carrying one's staking key", and its list of payment keys leaves out the search up to the 500th key. Since #359 the code decides by payment key alone:

- `is_own_address` has no stake-key shortcut any more. The payment key must match `known` or indexes 0..20 of either chain. Only when `carries_stake_key` is true does the search widen to 0..500.
- `ownAccount` returns `own` only from `isOwnAddress`. When only the stake key matches, it returns `{own:false, staked:n}` instead, for the active account and for every other known account.
- Make public shows OwnWarning only when `own` is true. When `!own && staked` it shows StakedWarning instead, which says "This isn't your public account … only they can spend this. Anyone can still link the address to this money and to whoever made it private."

So the doc gets wrong what counts as one of the wallet's own accounts, which is the rule the 2026-11-02 bounty report overturned. It also leaves out the 500-key search. That search applies to every known account under its own stake key, not just the active one, because destination.ts:129-131 calls `isOwnAddress(address, [])` for each one and lib.rs widens the search for each.

The damage stays in the docs. No screen text is wrong, and the user is still warned about the link, so no privacy promise is broken. That rules out medium. A developer reading privacy.md (which keys-and-accounts.md points to as the known-links record) would believe the stake key alone makes an address the account's own, and could write code or a test to that rule. That matches the brief's "low: a doc that misleads a developer".

#359 updated flows.md:227/399, keys-and-accounts.md:155 and wasm/README.md:30-31, but not privacy.md. The same pre-#359 rule also survives in the header comment of the file #359 changed: destination.ts:4-9 says "That's one carrying the account's staking key, or under one of its payment keys … the first 20 of each chain, and those the last balance reading found." That's a nit on its own, but it belongs in the same fix.

*Trace's evidence:* All read at 133d598b:
- seedelf-platform/seedelf-web-wallet/docs/privacy.md:65 (git show): "an address carrying one's staking key, or whose payment key is one of its own (the first 20 of each chain, and, for the account the wallet is on, any the last balance reading found…)".
- `git diff 7354f656 133d598b --stat` (#359) doesn't list privacy.md. `git diff f31758b0 133d598b -- docs/privacy.md` shows only #356's two backlog link changes.
- wasm/src/lib.rs:4900-4931 `is_own_address`: the payment key must match `known` or indexes 0..OWN_KEYS_ALWAYS (20), widened to OWN_KEYS_STAKED (500, both chains) when `carries_stake_key`. lib.rs:4936-4942 is `carries_stake_key`.
- extension/src/background/destination.ts:110-137 `ownAccount`: `own` comes only from `isOwnAddress`, and `staked` from `carriesStakeKey`, for the active account and each known account (line 130 passes `[]`, so the 500-key search still applies).
- withdraw.ts:139 passes `own`/`staked` on to the review's payments.
- Withdraw.tsx:247-256 (review) and 317-320 (form): OwnWarning only when `p.own`, StakedWarning otherwise when `staked` is set.
- en.json:2994 is the `withdraw.warn.staked` text.
- chain.ts:146 sets FARTHER_KEYS = 500.

I ran `npx vitest run tests/own-address.test.ts` in the sandbox r172-pr359: 6/6 passed. That includes own-address.test.ts:77-81 (a stranger's key 15 under account 0's stake key resolves to `{own:false, staked:0}`), :84-88 (receive key 300 under its own stake key resolves to own:true) and :90-98 (another account's stake key gives staked:1; its payment key gives ownAccount:1).

I grepped the live docs: flows.md:399, keys-and-accounts.md:155 and wasm/README.md:30-31 state the new rule. destination.ts:4-9 header comment still states the old one.

I edited nothing in the sandbox, and `git status --short` there is empty.

*Trace's fix note:* The fix is right in substance: reword privacy.md:65 as suggested. Three wording changes to the suggested text:
1. "up to the 500th under that account's stake key" comes right after "for the account the wallet is on", so it reads as the active account only. The search runs for every known account under its own stake key (destination.ts:129-131 into lib.rs:4918-4922), and on both chains.
2. "only that key's holder can spend it" should say "only that payment key's holder". The stake key's holder is the user.
3. Keep "and to whoever made it private", as the warning says (en.json:2994).

Suggested text: "…It warns when the destination is **any of this wallet's own Cardano accounts** (chunk 18): an address under one of its payment keys, whatever its staking part (the first 20 of each chain; for the account the wallet is on, any the last balance reading found; and up to the 500th of each chain when the address carries that account's own stake key, as another wallet of the phrase may hand out; privacy review §2.17). The stake key alone isn't the account's: anyone can pair their own payment key with it, so such an address gets a warning of its own, that it isn't yours and only that payment key's holder can spend this, while anyone can still link it to this money and to whoever made it private (the 2026-11-02 bounty report). Every account the wallet knows is checked…"

In the same edit, fix the header comment at extension/src/background/destination.ts:4-9, which still states the pre-#359 rule. Something like: "under one of its payment keys, whatever its staking part … the first 20 of each chain, those the last balance reading found, and up to 500 under the account's own stake key; the stake key alone makes it `staked`, not the account's."

This is docs and a comment only, so it needs no new test and no rebuild. own-address.test.ts:76-98 and api_test.rs already pin the behaviour.

### pr3593

**pr359#3 · nit · docs** · `seedelf-platform/seedelf-web-wallet/extension/src/background/destination.ts:5`

**destination.ts's header comment still states the stake-key rule #359 removed**

**Outcome: fixed.** destination.ts's header states #359's rule.

*Claim:* Lines 4-9 say: "A destination that's this account's own is flagged … That's one carrying the account's staking key, or under one of its payment keys, whatever its staking part…". That is the old rule. The function doc in the same file (lines 104-108) says the payment key decides, never the stake key alone.

*Failure:* A developer reading the module header takes the stake key as enough to call an address the account's, and could put the shortcut back.

*Evidence:* Read at 133d598b: destination.ts:3-9 against 99-137.

*Suggested fix:* Reword: "That's one under one of its payment keys, whatever its staking part (an enterprise address, say) … never one that only carries its stake key, which anyone can pair with their own payment key (`staked`, the 2026-11-02 bounty report)."

*Verification:* nit: not verified

### pr3594

**pr359#4 · nit · test-gap** · `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4887`

**OWN_KEYS_STAKED and chain.ts's FARTHER_KEYS agree only by a comment**

**Outcome: fixed.** own-address.test.ts holds `FARTHER_KEYS` and `OWN_KEYS_STAKED` together (one changed alone, either way, fails it), and chain.ts names the Rust copy.

*Claim:* Rust's OWN_KEYS_STAKED (500), used by Send and Make public, mirrors chain.ts:146 FARTHER_KEYS (500), used by the dApp ties and Lovejoin madeBy, through a doc comment only. FARTHER_KEYS's own doc doesn't mention the Rust copy. No test compares them: api_test uses OWN_KEYS_STAKED - 1, and own-address.test.ts uses index 300.

*Failure:* Raise FARTHER_KEYS to 1000. A key at 700 under Account 1's stake key then reads "Your public account" in a site's prompt but "This isn't your public account … someone else's payment key" on Send, and every test stays green.

*Evidence:* grep: no test under extension/tests or wasm/tests references FARTHER_KEYS. chain.ts:140-158 and lib.rs:4885-4887 at 133d598b.

*Suggested fix:* Add a Vitest that reads lib.rs for `OWN_KEYS_STAKED: u32 = N` and expects N === FARTHER_KEYS; the suite already reads sources (account-recipients-side.test.ts). Name the Rust copy in FARTHER_KEYS's doc.

*Verification:* nit: not verified

## Reviewer own (cross)

### What it checked

Inventory at 133d598b of every place that decides whose an address, payment credential, stake credential or reward account is. Each entry gives the place, what it compares, and the verdict.

RUST (wasm/src; seedelf-core where the wallet calls it)
1. cip30.rs Keys::of_hash (475), via `owner` (1106-1115) for inputs and collateral, and for required signers (1201). It compares the payment credential with the view's payment keys, the stake key and, with governance, the DRep key. RIGHT (#358). It matches any address paid to that hash, base and pointer included. architecture.md says "at that key's own enterprise address", which is narrower than the code (nit, not reported).
2. cip30.rs own_address (490), for outputs and the collateral return. It needs a payment key in the view AND the account's stake key as the staking part. This is stricter than the balance, by design: base(own payment, stranger stake) is listed as paid with the ownPaymentKey line. An output at enterprise(stake key hash) is paid away as "An address" and counted as leaving (scratch test E). So the brief's example, change that "comes back" and never shows up, does NOT happen in the sign window, which matches the balance here. Collateral taken from enterprise(stake hash) and returned there is refused with "your collateral would go to someone else", a false reason (test E). It's contrived (no wallet hands that address out), so it's not reported.
3. cip30.rs has_payment_key sets Paid.ownPaymentKey. RIGHT.
4. cip30.rs certificates (1458): own when the stake credential is keys.stake. A pool naming the stake key as an owner is refused. A pool's reward account is passed on as `credential`. DRep certificates go by keys.drep. RIGHT. A pool reward account that is the account's own stake key gets no line; that predates 1.7.2 and is out of scope.
5. cip30.rs withdrawals (1507): by stake key. RIGHT.
6. cip30.rs proposals (1530-1561): by stake key; another network is refused; a script has no credential. RIGHT (#357).
7. cip30.rs votes: DRepKey compared with keys.drep. RIGHT.
8. cip30.rs data_key (signData, 2047-2090): DRep by ID or by enterprise(DRep hash); a payment key in the view at any staking part; a reward address by stake key. enterprise(stake hash) is refused as not ours. That's consistent with the payment-key rule and harmless.
9. lib.rs is_own_address (4900): the payment key against the first 20 keys, the found keys, and up to 500 when the address carries the stake key. RIGHT by the rule, but see findings D (the 500 reaches past what the balance reads) and C (the stake or DRep hash as a payment credential).
10. lib.rs carries_stake_key (4936): the staking part against the 2/0 key. RIGHT. base(stakeHash, stakeHash) lands in `staked` (C).
11. lib.rs read_dex_order goes to seedelf-core orders.rs Session::owns (294): the signer key, and every paid address equal to the session's full address. Strict and RIGHT. lovejoin.rs payment_key and the Holdings change address are payment-key based and fine. decode.rs only reads address kinds. build::is_payable_address takes no view of ownership.

TYPESCRIPT (background)
12. destination.ts ownAccount (110-136): isOwnAddress and carriesStakeKey for the active account and every known account. RIGHT (#359) except C and D. Its module header (4-9) is stale (finding).
13. send.ts and withdraw.ts go through resolveDestination. Send's collateral payment to 0/0 is marked {own:true}. RIGHT.
14. pending.ts paysAccount (162): any payment marked own reads the account again. RIGHT after #359.
15. incoming.ts incomingOf (142) and pendingEntries (336): the payment key against the discovered keys; withdrawals by reward address; certificates by stake key hash. RIGHT; this is the balance's rule.
16. account.ts readAccountUtxos and discoverAccount (78, 121), with chain.ts discoverChain (129): payment credentials of the keys found by a gap-20 walk over account_addresses(stake). RIGHT; this is the range D compares against.
17. accounts.ts used(): account discovery by account_addresses of the stake key. That is the stake-key-only rule, but it only adds an account to the list and needs a stake key nobody has seen. Harmless.
18. activity.ts accountMatcher (126) goes by payment key; stakingOf (706) by stake address and withdrawal stake_addr. RIGHT.
19. tx-view.ts markYours (247-299): outputs by payment key (the first 20, the found keys, the sessions' keys, the user's own register); reward addresses (withdrawals, a proposal's rewardAccount) by stake key for the active account, the sessions and the known accounts (#357). RIGHT. I checked it case by case against proposalLine and withdrawalLine for the account's own key, another account's, a session's, a stranger's and a script's: consistent. It misses D's far keys and A's stake-hash addresses.
20. dapp.ts paysHolder (1935-1947): a payment key in the view OR the stake key. This is still the stake-key rule. It decides which unconfirmed outputs of the wallet's own recent sends are given back to a site's input lookup. Harmless: WebAssembly re-decides by payment credential (a stranger's key shows as "Others sign too", which is better than "can't find"), and an address carrying the account's stake key is tied to it on chain anyway. Not reported.
21. dapp.ts ties (2232-2326): ours, whose and byKeys. Outputs and inputs go by payment key, `staked` by stake key, X06 looks up to 500 keys further, and `certified` by stake key now includes proposals (#357). RIGHT except A.
22. dapp.ts publicKeys (2337): payment keys 0-19 (plus the found keys for the account on screen) and stake keys, but no DRep keys (A). remember() keeps only ownOutputs. readTx: stakeIndex is the holder's, and governance is for the public account only. RIGHT.
23. sessions.ts paysAccount (920): the session's payment key at any staking part. checkOrder and checkDirect: the exact session address, and its own key under another stake key is refused. refuseOddities uses proposals.length. Restore, freshIndex and stillUnused: a used reward address is skipped, which is conservative. RIGHT.
24. lovejoin.ts madeBy, accountKeys and keysOf (5644-5772): payment key, looking up to 500 further under the stake key (M14). RIGHT. staking.ts readStake and governance.ts ownDrepId: stake address and DRep key. RIGHT.

UI
25. ui/dapp.ts: paidTo uses the payment-key tie; stakedLine, certifiedLine and proposalLine go by stake key; signingTies (117-123) is where A's false sentence comes from. CardanoSend.tsx (164-171, 234, 297-299) and Withdraw.tsx (249-252, 317-319): OwnNote, OwnWarning and StakedWarning. Destination.tsx's save link shows when the address isn't own. TxDetail's YoursTag. Recipient rows, contacts and handles do no classification of their own.

TESTS RUN (sandbox at 133d598b, wasm/pkg as built there). A scratch vitest file of 7 cases, all passing; each asserts the gap it shows:
- A: the public account's inspectDappTx counts a UTxO at 60<stake hash> as its own input (ownInputs 1, signs ["stake"]). A session paying that same address gets ties, staked and certified all empty, and the page says "Your public account and your private balance aren't in it."
- A2: the same with 60<DRep hash>.
- B: the public account paying 60<Account 2's stake hash> ties nothing.
- C: resolve of 60<stake hash> gives {own:false}; resolve of 00<stake hash><stake hash> gives staked 0.
- D and D2: change/300 under the stake key resolves own:true. The reading doesn't change with a 77 ₳ UTxO there, and discoverAccount doesn't reach it even with the address in `used`. txView tags change/0 as Yours and change/300 as nothing.
- E: paying 60<stake hash> from the account is paid away; collateral taken from there and returned there is refused.

Mutant: deleting all four <StakedWarning/> from Send and Make public still passes 88 tests in 7 files.

The scratch file is kept at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r172-cross-whose.test.ts. The sandbox is restored clean (git checkout and clean; status empty).

Left to #357's reviewers, not raised here:
- A script's reward account reads "a stake key that isn't yours" (wording).
- "Comes back to the stake key of your private session N" names a reward account the wallet never withdraws from. A session's stake key is never registered, which I believe the Conway ledger refuses as a return account after bootstrap, but I didn't verify that.

### own0

**own#0 · medium · correctness** · `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2250`

**A site's ties miss an address paid to one of the wallet's stake or DRep keys: a private session's prompt says the public account isn't in it**

**Outcome: fixed.** With pr358#0, the DRep key included and both directions (a session paying a public account's key, a public prompt paying a session's).

*Claim:* #358 made an address whose payment credential is the signing account's stake key hash (or, with governance, its DRep key hash) the account's in WebAssembly (cip30.rs:1109, `keys.of_hash`), because that key's witness spends it. The prompt's `ties`, which names the wallet's other accounts and sessions, still matches a payment credential only against payment keys: `byKeys` uses accounts.payment and the sessions' `payment` (2250-2262), and `ours` does the same (2271-2275). A stake key is matched only in the staking part, and `publicKeys` (2337) collects no DRep key at all. So an output (or a found input) at enterprise(public account's stake key hash), or at enterprise(its DRep key hash), ties nothing. A private session's prompt then ends "Your public account and your private balance aren't in it." (ui/dapp.ts:122 via DappApprovals.tsx:1224). Those 28 bytes are the staking part of every address the public account hands out, so anyone can see the link on chain. On the public account, paying enterprise(Account 2's stake hash) leaves out "It moves money between…". architecture.md:568 says an address one of the wallet's keys spends ties its account, and its accepted gaps (L3, L11) don't cover this case.

*Failure:* A site connected to private session 1 knows the user's public stake key: the public account was connected to it before (the privacy note already says that lets it know the session is the user's), or it read the user's address or handle elsewhere. It asks to sign a transaction that pays 1 ₳ to 60<public stake key hash> beside its real payment. The prompt shows "An address" and "Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it." Once signed, the chain shows the session paying an address only the public account's stake key can spend. The C01 variant (someone's key under the public stake key) gets the dappUi.ties.privacy.staked warning; this one gets nothing. The same holds for 60<DRep key hash>, which is public once the account registers as a DRep or signs CIP-95 data.

*Evidence:* dapp.ts:2250-2275 and 2337-2357 and ui/dapp.ts:117-123 at 133d598b, read. Scratch vitest (copy kept at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r172-cross-whose.test.ts), passing on 133d598b's wasm/pkg. Case A: the public account's inspectDappTx counts a UTxO at 60<stakeHash> as its own (ownInputs 1, signs ["stake"]), while the session's prompt paying the same address returns ties, staked and certified all [] and renders "Your public account and your private balance aren't in it." Case A2: the same for 60<drepOf().hash>. Case B: the public account paying 60<Account 2's stake hash> ties nothing, while 00<stranger><Account 2's stake hash> gives staked [{account:1}].

*Suggested fix:* In `ties`, also match a payment credential against the known accounts' and the other sessions' stake key hashes, and against the accounts' DRep key hashes (collect `drepOf().hash` in publicKeys). Count such an address in `ours` (one of the wallet's keys spends it) and in byKeys's payment lookup, so the prompt names the account ("It moves money between…") and never says it isn't in it. Pin it with cases A, A2 and B. If the owner would rather keep the behaviour, add it to the "Not covered" lists in architecture.md:568 and privacy.md:192, beside L11.

*Trace (partly, low):* The fault is real, and the code does what the finding says. The reach is narrower and the severity lower than it claims.

How the code gets there:
- keysOf (dapp.ts:2781) gives an enterprise address a `payment` and no `stake`.
- `byKeys` (2250) looks a payment credential up only in accounts.payment and the sessions' `payment`. `ours` (2271-2275) does the same. publicKeys (2337-2357) collects payment keys and the stake key, and no DRep key.
- So for 60<public stake hash>: `ours` is false, the address goes to the staked bucket, and `whose` (byKeys(stakeHash, undefined)) returns []. all, staked and certified all come back empty.
- signingTies([], session) (ui/dapp.ts:117-123) then adds "Your public account and your private balance aren't in it."

I ran a scratch test on 133d598b's pkg:
- **A:** the session's window shows "Pays addr_test1v… An address 4 ₳ … Your public account and your private balance aren't in it." The control, 60<payment key 0/0>, ties [{account:0}] with "It moves money between this private session and your public account". So the gap is specific to the stake and DRep key hashes.
- **A2 (60<DRep hash>):** ties nothing either.
- **A4 (a found input at 60<public stake hash>, partialSign):** ties nothing either.
- Nothing refuses the transaction. The stake hash is the staking part of every base address the account uses, so the link shows on chain.

Where the finding is off:

1. **Case B only lacks a warning; B2 is the real public-side fault.** Case B (the public account paying 60<Account 2's stake hash>) gets no "It moves money between…", but the public line it does show, "Your private balance isn't in it.", is true there. The public side's actual false line is B2, which the finding doesn't test: the public account paying 60<session 0's stake hash>. That renders "Your private balance isn't in it." A session's address is base(0/i, 2/i), so its stake hash is on chain too (I asserted that in the test). The suggested fix's "other sessions' stake key hashes" covers B2.

2. **It isn't a path of #358's own report, and it isn't a regression.**
   - The ties address-matching is unchanged since 1.7.1: `git diff f31758b0 133d598b` on dapp.ts only adds proposals (#357). 1.7.1 shows the same false line.
   - #358's report was the signing account's own inspection, which signed for a UTxO it showed as not leaving. Here the session holds no key of the public account's and signs for nothing it can't see. #358 only made WASM's model of "whose address" differ from the worker's.

3. **Why low rather than medium:**
   - **Adversarial-only reach.** No wallet hands out or pays enterprise(stake hash) (#358's PR body), so no honest dApp flow reaches it. A site has to craft it, knowing the key hash. In practice it has that from the public account's earlier connection, and privacy.md already says the site can then tell the session is the user's.
   - **Limited extra harm.** It puts on chain a link the site already holds. An explorer's stake-key view doesn't list an enterprise address under that key, so finding the link takes a credential match. A site set on publishing the link can also do it with a note or datum, which the ties check never reads.
   - **Precedent.** It's the same class as 1.5.0's X05 and L1: a site-crafted transaction named another account's stake key where `ties` didn't look, and the prompt said "isn't in it". Both were rated low and fixed (aaf2e068: 1 high, 2 medium, the rest low; X05 and L1 among the lows). The owner rated #358's own report Low.
   - So it's an edge-case inaccuracy in the sign window's privacy line. It's cheap and worth fixing, but not medium.

4. **The suggested fix is right, with one nuance.** Putting the stake or DRep hash into byKeys's payment lookup also sets paid[].yours (2317). The Pays row would then read "Your public account" for an address the balance never reads. That's consistent with C01's rule (an output is named by who can spend it) and with X06 (far keys named though unread). The owner may still prefer the tie warning alone.

*Trace's evidence:* All references are to 133d598b:
- extension/src/background/dapp.ts:
  - 2250-2262: byKeys looks up accounts.payment and others[].payment, and a stake key only in the stake slot.
  - 2265: whose.
  - 2271-2275: ours checks accounts.payment, holder.keyHash and others[].payment only.
  - 2296: the all/staked split.
  - 2317: paid[].yours.
  - 2337-2357: publicKeys, with no DRep key.
  - 2781-2793: keysOf; an enterprise address has payment only.
- ui/dapp.ts:117-125: signingTies.
- ui/screens/DappApprovals.tsx:1224: where signingTies is shown.
- wasm/src/cip30.rs:475-483 (Keys::of_hash) and 1109 (owner via of_hash, #358).
- en.json: notAccountNorPrivate is "Your public account and your private balance aren't in it.", and notPrivate is "Your private balance isn't in it."
- `git diff f31758b0 133d598b` on dapp.ts: only proposals are added to ties, so this is pre-existing.
- tests/dapp-ties.test.ts:181 pins only 60<payment key>.

I ran a scratch vitest, tests/zz-r172-v-own0.test.ts, in the r172-cross sandbox with `npx vitest run --silent=false`. All 5 cases passed on 133d598b's wasm/pkg:
- A3 control: 60<paymentKeyHash(0,0)> gives ties [{account:0}] and the "It moves money between this private session and your public account" text.
- A: 60<public stake hash> gives ties, staked and certified all [], and the page reads "…Pays addr_test1vrj40…ztueg An address 4 ₳ Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it."
- A2: 60<drepOf().hash> gives the same.
- A4: a found input at 60<stake hash> with partialSign gives [[],[],[]].
- B: public account 0 paying 60<Account 1's stake hash> gives [[],[],[]], and the page ends "Your private balance isn't in it." (true there).
- B2: the public account paying 60<session 0's stake hash> gives [[],[],[]] and "Your private balance isn't in it." (false). The control, paying the session's own base address, ties [0], and that base address's staking part equals the session's stake hash.

The scratch test is deleted from the sandbox and its git status is clean. A copy is kept at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r172-v-own0-ties.test.ts.

Severity precedent: aaf2e068's message (1.5.0's review) puts X05 and L1 among the lows.

*Trace's fix note:* The smallest fix is all in extension/src/background/dapp.ts:

1. **publicKeys:** in `add`, also collect each known account's DRep key hash (`JSON.parse(cardano.drepOf()).hash`) into a `drep: Map<string, number>`. That's one derivation per account. Return it beside payment and stake.
2. **byKeys (ties):** add `payment && accounts.stake.get(payment)` and `payment && accounts.drep.get(payment)` to the Set of public indices. Add `payment !== undefined && others.find((s) => s.stake === payment)` to `matched`. Keep the `view.account` exclusion as it is, so the public account's own stake-key enterprise output still ties nothing.
3. **ours:** also return true for `accounts.stake.has(payment) || accounts.drep.has(payment) || others.some((s) => s.stake === payment)`.

The output's Pays row would then read "Your public account" (paid[].yours), which matches C01's rule. If the owner prefers the tie warning alone, keep that lookup out of the `whose(p.address, true)` used for `yours`.

Pin it in tests/dapp-ties.test.ts and dapp-ties-accounts.test.ts:
- **A:** a session paying 60<public stake hash> gives ties [{account:0}]. The page has "It moves money between this private session and your public account" and never "aren't in it".
- **A2:** a session paying 60<public DRep hash>, the same.
- **B:** public account 0 paying 60<Account 1's stake hash> gives ties [{account:1}].
- **B2 (the case the finding misses):** the public account paying 60<session 0's stake hash> gives ties [0], and the page never says "Your private balance isn't in it.".
- **Control:** the public account paying 60<its own stake hash> ties nothing.
- Each must fail on 133d598b. They do: my scratch test asserts the empty lists there.

Docs: architecture.md:568 and privacy.md:192 should say that an address paid to a stake or DRep key's hash ties its account. If the owner keeps the behaviour, list it under "Not covered" beside L3 and L11 in both files instead.

*Impact (confirmed, low):* The facts are right. I traced the path at 133d598b. For an enterprise address `60<X>`, keysOf gives payment = X and no stake. byKeys looks X up only in accounts.payment and the sessions' `payment`, and ours does the same. publicKeys builds a payment map and a stake map and nothing for DRep keys. So the address lands in neither `all` nor `staked`. With ties, staked and certified all empty, signingTies(…, session=true) prints "Your public account and your private balance aren't in it." Since #358, WebAssembly's `owner` (of_hash) counts that same address as the account's.

Who can reach it: only a hostile site. It has to build an output to an address no wallet hands out or pays (#358's own body says so), and it has to know the public stake key hash. No paste, contact, handle or data source gets there. In practice the site learned the key because the public account was connected to it in this browser. The connect screen already says such a site knows the session is the user's (dappUi.privacy.privateSession). If the site is only guessing, signing confirms nothing to it: the prompt never refuses, and the user would sign the same for a stranger's key.

What the user sees and loses: the output shows as "An address", with the whole bech32, and its ADA counts in the session's total leaving. So no money is lost unseen. It lands at the user's own stake key, which the wallet never reads. The real harm is the false privacy sentence, plus a weak on-chain link. An enterprise address has no stake part, so explorers don't list it under the public stake address. That makes it harder to see than C01's `00<stranger><our stake>`, which does get the `staked` warning. Nothing on the same screen discloses it.

Owner's calls: none covers it. #359's call is about refusing in Send. #358's is about unknown inputs. The fix is a disclosure, not a guard. L3 and L11 cover payment keys past index 19, not a stake or DRep hash used as the payment credential.

Why low and not medium:
- It isn't a regression. byKeys, whose and ours are unchanged since f31758b0; #357 only added proposals. 1.7.1 said exactly this.
- It isn't a path of #358's own report, which was about the signing account's inputs and money, not cross-account ties.
- The project's own precedent puts this class at low. 1.5.0's last review rated "13, all low" and included L1 (fixed) and L11 (accepted gap). Both were hostile-site-built transactions that tied a session to the public account while the prompt said the public account isn't in it.

Secondary parts are milder than stated:
- Case B on the public account prints no false sentence ("Your private balance isn't in it" is true). It only lacks the "It moves money between…" line.
- A2's DRep hash is on chain only once the account registers as a DRep or votes. A CIP-95 signData reveals it to that site alone, not on chain.
- architecture.md:568's "one of the wallet's keys spends" is qualified there as WebAssembly's `ownPaymentKey`, which is payment keys only. So it's ambiguous, not false.

It's still worth fixing in 1.7.2. Unlike L11 it costs nothing, because the stake hashes are already in `accounts.stake` and `others[].stake`.

*Impact's evidence:* All read at 133d598b, no tests run. No sandbox was free (r172-cross and r172-v-own3 had other agents' files, r172-critic is someone else's). The finding's scratch test, work/r172-cross-whose.test.ts, was read and matches the traced path.
- extension/src/background/dapp.ts:2250-2262: byKeys matches the payment credential against accounts.payment and others[].payment only.
- dapp.ts:2271-2275: ours does the same.
- dapp.ts:2296: an address is routed to all or staked.
- dapp.ts:2317: outputs are named via whose(p.address, true).
- dapp.ts:2337-2357: publicKeys collects payment and stake keys only, no DRep.
- dapp.ts:2781-2793: keysOf gives an enterprise address its payment only.
- dapp.ts:2133-2147: ties.all, staked and certified feed the approval.
- ui/dapp.ts:117-123 and DappApprovals.tsx:1224: empty lists render "notAccountNorPrivate".
- DappApprovals.tsx:884/946: the "site saw that account in this browser" note is on the connect screen only.
- wasm/src/cip30.rs:1109: `owner` uses of_hash.
- cip30.rs:490 and 506: own_address and has_payment_key stay payment-key only.
- `git diff f31758b0 133d598b -- dapp.ts`: ties' matching is unchanged, only proposals were added.
- Commit aaf2e068 and docs/archive/roadmap.md:103: the 1.5.0 last-review items were all low.
- The L3/L11 text is in architecture.md:568 and privacy.md:192.

*Impact's fix note:* Smallest fix, in `ties` (dapp.ts ~2250-2296):
- For each read address (paid outputs and found inputs), also look its payment credential up in the stake keys the function already has: `accounts.stake` (skipping the signing account's own on the public side, as byKeys does) and `others[].stake`.
- Look it up in the public accounts' DRep key hashes too. Add a `drep` map in publicKeys from `cardano.drepOf().hash`, one derivation per account.
- Push a match into `all`, the "It moves money between…" line, never `staked`: one of the wallet's keys spends that address, so "that money isn't yours" would be false.

The suggested fix is partly wrong. Routing this through byKeys's payment lookup also changes `whose(p.address, true)` at 2317, which would name the output "Your public account". The wallet never reads that address (#358's body), so the money would never show in the balance. That's a C01-style mislabel in the money direction. Tie it, but leave the output's label as "An address", or give it its own label (a new critical string).

Tests to pin it:
- the reviewer's case A: session pays 60<public stake hash>; expect ties [{account:0}] and no "aren't in it";
- A2, with 60<drepOf().hash>;
- B: Account 1 pays 60<Account 2 stake hash>; expect ties [{account:1}];
- a session paying 60<another session's stake hash>.

Each fails on 133d598b. If the owner would rather not fix it, add it to the "Not covered" lists in architecture.md:568 and privacy.md:192, beside L11.

### own1

**own#1 · low · correctness** · `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4918`

**Send says the account's own key past the balance's range "comes back", but the balance never reads it**

**Outcome: backlog.** Before 1.7.2 too, and rare (a key past the balance's walk, from a wider-gap wallet or by hand). A line under *Send and Make public*, and keys-and-accounts.md says it.

*Claim:* When an address carries the account's stake key, is_own_address matches the account's payment keys up to index 500 (OWN_KEYS_STAKED, lib.rs:4887 and 4918), and ownAccount returns own:true. Send then shows "This is your own public account: it comes back, less the fee." and leaves the payment out of Total leaving (CardanoSend.tsx:164-171, 297). The balance reads only the keys its gap-20 walk found (account.ts:78-83 and 121; chain.ts:129). Home's incoming (incoming.ts:142), the pending Activity row (incoming.ts:336), the confirmed Activity entry (activity.ts:126) and Transaction details (tx-view.ts:218) all use those same keys. So the payment never shows up again. This predates 1.7.2: 1.7.1 called any address carrying the stake key own. #359 kept the outcome on purpose, for addresses "another wallet of the same phrase may hand out", but those addresses are exactly the ones the walk doesn't reach.

*Failure:* Another wallet of the same phrase, one with a wider gap or addresses added by hand, hands out the change or receive address at index 60, while Seedelf Wallet's walk stops at 40. The user sends 50 ₳ there. The review says it comes back and Total leaving shows only the fee. Once it lands, the public balance is 50 ₳ lower, Activity lists "Sent 50 ₳" to that address, and Transaction details doesn't tag the output Yours.

*Evidence:* lib.rs:4887 and 4918, account.ts:78-83 and 121, chain.ts:129, read. Scratch vitest, passing. Case D: resolve of base(change/300, stake) gives {own:true, ownAccount:0}; adding a 77 ₳ UTxO there leaves the reading at 10350538725 lovelace before and after, and credential_utxos is never asked about that key. Case D2: discoverAccount with change/300 in `used` doesn't reach the key, and txView tags change/0 as {account:0} and change/300 as nothing.

*Suggested fix:* Make the balance read what Send calls own. In readAccountUtxos, look further (chain.ts fartherKeys, up to FARTHER_KEYS) for the payment keys of used addresses under the stake key that discovery didn't reach, and add them to `paths` with their role and index, as ties (X06) and Lovejoin's madeBy already do. A smaller fix: have ownAccount say when the key was found only past the balance's range, and have Send count that payment as leaving. Test: a reading whose account_addresses lists change/300 counts its UTxO, or Send's review counts that payment in Total leaving.

*Trace (confirmed, low):* I traced every step in the code and it holds. When an address carries the account's stake key, `is_own_address` (lib.rs:4918-4927) matches indices 0 to 499 on both chains. `ownAccount` (destination.ts:116-124) then returns `{own: true, account: active}`. Send leaves that payment out of Total leaving (CardanoSend.tsx:164-171) and shows "This is your own public account: it comes back, less the fee." on the review (:241) and on the form (:297).

The balance never extends its keys. `readAccountUtxos` (account.ts:113-123) walks with gap 20 (chain.ts:129) over `account_addresses` and asks `credential_utxos` only about `found.paths`. `fartherKeys` is used only by the dApp's ties (dapp.ts:2290) and by Lovejoin's madeBy (lovejoin.ts:5664). Four places use the same keys:
- Home's incoming (incoming.ts:142)
- the pending Activity row (incoming.ts:336)
- the confirmed Activity entry (activity.ts:126-131)
- Transaction details (tx-view.ts:218-225), including the button on Send's own review, so that view doesn't tag the output Yours while the note on the same screen calls it the user's own account.

I ran scratch tests and they confirm it end to end. Right after Send, Home's public total drops by 50 ₳ plus the fee, while Total leaving showed the fee alone. Activity lists it as "sent", 50 ₳ out.

Not a regression. 1.7.1 called any address carrying the stake key the account's own (`git diff f31758b0 133d598b`). #359 decided this exact case on purpose and pins it (own-address.test.ts:84-88, api_test.rs:2985-2993).

Reach is narrow, and no money is lost. The address needs the user's payment key past the gap-20 walk. A gap-20 wallet of the same phrase can't hand one out, because it uses the same used set and the same gap. It takes a wallet with a wider gap (for example cardano-wallet's address_pool_gap) or an address derived by hand. The key is the user's, and the wallet that handed out the address shows the money. So this is an edge-case inaccuracy on a security-relevant screen: low.

One point is overstated: "those addresses are exactly the ones the walk doesn't reach." The 500 check runs against the session's kept keys (destination.ts:117-120), resolved before Send's own fresh read (send.ts:70-76). With a stale kept reading, where the other wallet has used addresses in order since, the next walk does reach the key, and "comes back" is right. That matters for the smaller fix.

Make public has the same root. Its warning (`withdraw.warn.ownAccount`) claims nothing about coming back and its total is right, but the public side never shows the payment.

Two nits I noticed on the side, separate from this finding:
- destination.ts:4-9's header still says an address carrying the staking key is the account's own.
- In keys-and-accounts.md:155, "Send and Make public say such an address isn't the user's" comes right after the 500 sentence, so it can be read as being about the user's own far key.

*Trace's evidence:* Code read at 133d598b:
- lib.rs:4887 (`OWN_KEYS_STAKED = 500`) and 4918-4927 (the loop up to `farthest`)
- destination.ts:110-136 (ownAccount, with the session's kept keys)
- send.ts:70-76 (destinations resolved before `pay` reads the account)
- CardanoSend.tsx:164-171, 233-243, 295-297, 431-437 (OwnNote, `send.warn.ownAccount` at en.json:1781)
- account.ts:78-86, 110-123
- chain.ts:121-138 and 158-168 (`fartherKeys` returns key hashes only)
- balances.ts:394 (stored keys = `paths`)
- incoming.ts:142, 336
- activity.ts:126-131
- tx-view.ts:186, 218-225, 264-271
- koios.ts:836-841 (`_empty: true`)
- docs: flows.md:227 and 399, keys-and-accounts.md:116 and 155
- `gh pr view 359` (keeps this case on purpose)
- `git diff f31758b0 133d598b` of lib.rs (1.7.1 called any address with the stake key own)

Ran scratch vitest files in r172-cross (`tests/zz-r172-v-own1*.test.ts`, deleted after; the sandbox is clean):
- A: `send.build` to `preprodAddress(keyHash(1,300), stakeHash())` returns `{own:true, ownAccount:0}`. The UI's leaving formula gives the fee alone (174609). After `send.submit`, Home's public total fell by 50174609. The pending Activity entry is `{kind:"sent", direction:"out", lovelace:"50000000"}` to that address.
- B: a 77 ₳ UTxO at that address, with the address added to `account_addresses`. The reading is 10350538725 before and after, and `credential_utxos` is never asked about key 1/300.
- C: `discoverAccount` with only that address used gives 40 paths, without 1/300.
- D: for the recorded account (its walk reaches 1/20), base(1/21, stake) already resolves `{own:true, ownAccount:0}` through the 500 range, though the balance doesn't read 1/21.

*Trace's fix note:* Smallest correct fix, TypeScript only, no pkg rebuild:
- In SendService, after `pay`'s fresh `readAccountUtxos`, flag a payment if its own verdict is for the active account but its payment key isn't in that read's `found.paths`. The key is `cip30Address` hex `.slice(2,58)`. Flag it as e.g. `unread: true`.
- Count a flagged payment in Total leaving and its token count, and show a one-line note instead of OwnNote (e.g. "This is your own key, but past the addresses Seedelf Wallet reads: it won't show in this balance."). That's new en/es/ja text, critical, so it needs a blind back-translation.
- Decide against Send's own fresh walk, not the session's kept keys. Otherwise a stale reading's case, which the next walk reaches, gets counted as leaving.
- Pin it in send.test.ts: a build to `preprodAddress(keyHash(1,300), stakeHash())` carries the flag, and a UI or own-account-names test shows Total leaving counting it.

The finding's larger fix (the balance reads farther keys) points the right way but is too heavy for a patch, and as written it's incomplete:
- `fartherKeys` returns hashes, not role/index, so it needs a variant that returns paths before Seedelf Wallet can sign for those keys.
- It changes what coin selection spends and what a connected site's `getUtxos` and `getUsedAddresses` see.
- A stranger's address under the stake key (anyone can make one with dust, the bounty report's own case) stays in `account_addresses` and is never found. So every reading would pay the full look of about 960 derivations.

Since the behaviour predates 1.7.2 and loses no money, a one-line entry in backlog.md, plus a line in keys-and-accounts.md:155 and flows.md:227 ("such a payment shows in the wallet that handed out the address, not here"), is also a defensible outcome for the patch.

### own2

**own#2 · low · correctness** · `seedelf-platform/seedelf-web-wallet/extension/src/background/destination.ts:110`

**Send and Make public read an address paid to the account's own stake key hash as a stranger's, and base(stake hash, stake hash) gets "someone else's payment key"**

**Outcome: backlog.** Crafted only, and saying it needs a critical string of its own. A line under *Send and Make public*, and keys-and-accounts.md says it.

*Claim:* #358's rule, that the stake key's (or DRep key's) hash as a payment credential is the account's, isn't in is_own_address or carries_stake_key (lib.rs:4900-4942). enterprise(stake hash), and likewise enterprise(DRep hash), resolves to {own:false} with no note. base(stake hash, stake hash) resolves to {own:false, staked:0}, so StakedWarning says "someone else's payment key, so only they can spend this". That is false: the user's own stake key spends it, and nobody else can. Make public to enterprise(stake hash) shows no own-account warning, though anyone can link the address to the account (it is the same 28 bytes as every address's staking part). Either way the money lands where the wallet never reads.

*Failure:* A handle, a contact or a pasted address resolves to addr_test1v…<user's stake key hash>. Make public pays it with no warning and re-links the private money publicly. Send shows no note. In both cases the payment vanishes from the wallet's view, stuck for anyone without tools that sign with the stake key. With 00<stake hash><stake hash>, both screens say someone else can spend it. No wallet hands these addresses out, so only a crafted one gets here.

*Evidence:* lib.rs:4900-4942 and destination.ts:110-136, read. Scratch vitest case C, passing: resolve(preprodAddress(stakeHash)) gives {own:false}, and resolve(preprodAddress(stakeHash, stakeHash)) gives {own:false, staked:0}.

*Suggested fix:* In ownAccount, recognise a payment credential equal to one of the accounts' stake (or DRep) key hashes and say so in words that don't claim someone else's key: the account's own key's address, which the wallet doesn't read, plus the link warning for Make public. At the least, keep it out of StakedWarning's "someone else's payment key". Test: resolving 60<stakeHash> and 00<stakeHash><stakeHash>.

*Trace (partly, low):* **What holds.** I traced the code and ran a scratch Vitest against the 133d598b wasm/pkg. The resolutions are as claimed:
- enterprise(stake hash) and enterprise(DRep hash) give `{own:false}`.
- base(stake hash, stake hash) gives `{own:false, staked:0}`. With a second account known, base(acct1 stake, acct1 stake) gives `staked:1`.
- So StakedWarning says "someone else's payment key, so only they can spend this". That is false here. The payment credential is the account's own stake key hash, and the ledger accepts that key's witness for it (#358's `of_hash` rests on exactly this).
- The wallet never reads either address: `readAccountUtxos` asks `credential_utxos` for payment key hashes only.

**Where the finding overreaches:**
1. **Send to enterprise(stake hash) is not a defect.** No text claims anything, and the payment counts as leaving, which is right for an address the wallet never reads. The dApp prompt treats an output there the same way: `has_payment_key` is false, so it's listed as paid away.
2. **"#358's rule isn't in is_own_address" is not the defect.** #358's rule decides which key signs an input, so the prompt shows what the stake key's witness spends. For outputs, the dApp prompt and now Send and Make public all go by payment key, consistently.
3. **Make public to enterprise(stake hash) with no link warning is real but older than 1.7.2.**
   - 1.7.1's `is_own_address` gave the same `{own:false}`: no staking part, and the payment key isn't one of the payment keys.
   - privacy.md:65's promise covers an address carrying an account's staking key or one of its payment keys, not this one.
   - It isn't a path of either report: #358's was the dApp prompt's inputs, #359's the stake key in the delegation part.
   - Whoever crafts the address can't spend the payment, so they give it up for a heuristic link.
4. **base(s, s)'s false clause is new #359 text, but the outcome isn't a regression.**
   - 1.7.1 called it "your own public account: it comes back, less the fee". It left the payment out of Total leaving, and Make public's pending record counted it as arriving.
   - 1.7.2 counts it as leaving, correctly, and keeps Make public's true "Anyone can still link" sentence. Only the "someone else's / only they" clause is wrong.
   - It errs toward caution: it discourages a payment that would land where the wallet can't read it.
   - The dApp prompt's `dappUi.ties.privacy.staked` has read base(acct3 stake, acct3 stake) as "Someone else's address … that money isn't yours" since 1.5.0's C01 (the string is already at f31758b0). #359 extended an existing class to two more screens.
5. **Reach is a crafted address only,** as the finding admits. No wallet derives it. A handle resolves there only if its holder sends the handle NFT to an address only the user's stake key can spend.

**The suggested fix is partly wrong.** The "at the least" option drops `staked` when the payment credential equals the stake hash. On Make public that removes the true link sentence and leaves no disclosure at all, a step backwards under private-by-default. Any correct fix needs new or reworded text, which means a critical-key change with blind es/ja back-translation. For a crafted-only address that nobody else gains from, that fits a backlog line better than a 1.7.2 gate item.

**Sandbox note for the lead.** The brief's restore step, `git clean -fd` in r172-cross, also deleted an untracked `tests/zz-r172-v-own1.test.ts` that wasn't mine; it's probably own#1's verifier's. No vitest process was running at the time. That verifier may need to recreate it.

*Trace's evidence:* **Code read at 133d598b:**
- `extension/src/background/destination.ts:110-136` (`ownAccount`: `own` from `isOwnAddress`, `staked` from `carriesStakeKey`).
- `wasm/src/lib.rs:4900-4942`: `is_own_address` checks only payment keys (20, known, 500 under the stake key); `carries_stake_key` checks only the delegation part.
- `extension/src/background/account.ts:95-124`: `readAccountUtxos` reads `credential_utxos` over `found.paths`, payment key hashes only, so neither address is ever read.
- `wasm/src/cip30.rs:475-509`: `of_hash` for inputs; `own_address` and `has_payment_key` for outputs, by payment key. `:1109` is #358's `owner`.
- `extension/src/background/dapp.ts:2269-2296`: `ties`' `ours()` goes by payment key, else the address is `staked`.
- en.json `dappUi.ties.privacy.staked` (line 496 at 133d598b, line 495 at f31758b0) and #359's `send.warn.staked` / `withdraw.warn.staked`.
- `docs/privacy.md:65`: the warning promise.

**Code read at f31758b0:** `lib.rs:4892-4922`. 1.7.1 returned own:true for any address whose delegation part is the stake key, so base(s, s) was "your own"; enterprise(s) was already false.

**Run:** a scratch `tests/zz-r172-v-own2.test.ts` in r172-cross (deleted afterwards, sandbox restored to 133d598b and clean). All 6 cases passed:
- A: `preprodAddress(stakeHash)` gives `{own:false}`.
- B: `preprodAddress(stakeHash, stakeHash)` gives `{own:false, staked:0}`, and the rendered en text is "This isn't your {{whose}}: it has that account's stake key but someone else's payment key, so only they can spend this."
- C: base(stakeHash, a stranger's stake) gives `{own:false}`.
- D: enterprise(DRep hash b2a7f53b…) gives `{own:false}`.
- E: base(acct1 stake, acct1 stake), with account 1 added, gives `{own:false, staked:1}`.

**Also read:** Send (`send.ts:70`) and Withdraw (`withdraw.ts:78,85`) both resolve through `destination.ts`.

*Trace's fix note:* Don't take the "at the least" option, which drops `staked` when the payment credential equals a stake hash. It removes Make public's true link sentence and leaves no warning.

Rewording the four existing `*.warn.staked*` strings so they don't say whose payment key it is would weaken #359's main warning ("only they can spend this") in the bounty's real case.

If the lead fixes it for 1.7.2, the correct shape is a separate branch:
- In `ownAccount`, when the address's payment credential equals one of the known accounts' stake key hashes (or DRep key hash), return a distinct flag rather than `staked`. The payment part is available from wasm (`keysOf`, or a small `carriesStakeKey` sibling).
- Give it one short line of its own: the account's own stake key's address, which the wallet doesn't read. On Make public, add the existing link sentence.
- Add the new keys to critical-keys.json, with blind es/ja back-translation.

Tests:
- `own-address.test.ts`: resolve `preprodAddress(stakeHash())` and `preprodAddress(stakeHash(), stakeHash())`, and assert the new flag, with no `staked`.
- `own-account-names.test.ts`: the words.

A backlog line is a defensible alternative for a patch release, given that it's crafted-only and nobody else gains from it.

### own3

**own#3 · low · test-gap** · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/CardanoSend.tsx:235`

**No test shows #359's warning on Send's or Make public's form or review**

**Outcome: fixed.** With pr359#1.

*Claim:* The fix's screen wiring (CardanoSend.tsx:234-237 and 298-300, Withdraw.tsx:249-255 and 318-320) isn't pinned by any test. own-account-names.test.ts renders StakedWarning on its own, and send.test.ts checks only the worker's {own:false, staked:0}. The PR says it added no e2e test for the warning.

*Failure:* A change that drops `p.staked !== undefined && <StakedWarning …/>` from either screen, or counts a staked payment out of Total leaving again, passes the suite. The report's own path (Send saying such a payment comes back) could then return unnoticed.

*Evidence:* Mutant: replacing all four <StakedWarning …/> in CardanoSend.tsx and Withdraw.tsx with null still passes own-account-names, max-left-review-fixes, screens-wiring-review-fixes, account-recipients-side, send, own-address and withdraw: 88 of 88 tests. Reverted afterwards.

*Suggested fix:* Add a screen test that renders CardanoSend's review with a payment {own:false, staked:0}, asserting the send-staked callout and that Total leaving counts the payment. Do the same for Withdraw's review and both forms.

*Trace (confirmed, low):* The finding holds. #359's screen wiring isn't pinned by any test. The worker side of the fix is.

The worker side: `destination.ts` gives `{own:false, staked:n}`. `own-address.test.ts` and `send.test.ts` pin that. I tried a worker mutant that sets `own ||= carriesStakeKey` and it failed 3 tests. So the realistic revert, where Send calls the address the user's and says it comes back (OwnNote, which needs own:true), would be caught.

The screen side has no test:
- Only `own-account-names.test.ts` imports StakedWarning, and it renders the component alone.
- No file in tests/ or e2e/ mentions `send-staked`, `withdraw-staked` or the warning's English text.
- The PR body says it added no e2e test for the warning.
- Only two tests render these screens. `spell-check.test.ts` renders CardanoSend's form with no destination read. `screens-wiring-review-fixes.test.ts` renders Make public's review with own:false and no `staked`.
- No Vitest test renders CardanoSend's review at all. That means the "Total leaving" sum at CardanoSend.tsx:164-167 has never been exercised. That gap was there before #359.

Mutant A matches the finding's: all four `<StakedWarning/>` replaced with null, and the import removed so typecheck passes. It passed tsc and every test file that can reach these screens: 44 files, 649 tests. Those are the files that import CardanoSend, Withdraw, Transfer, Home or App, plus every test that reads src/ui source.

Mutant B makes Send's leaving sum treat `p.staked === active` as coming back. It also passed tsc and 23 of those files.

So both halves of the failure scenario hold for changes made on the screen side. One sentence overstates it: "Send saying such a payment comes back" needs own:true again, and that is pinned. What can regress unnoticed is the new warning in its four places, and Send's Total-leaving sum.

Severity: low, which is the brief's own label for "a fix no test pins". The wiring itself is correct: my positive test passes at 133d598b.

The suggested fix works with the house harness, and I tested it. My scratch test passes 5/5 on the fixed code. Under mutant A, 4 of its tests fail; under mutant B, 1 fails. One correction to the suggestion: Make public's total counts every payment (Withdraw.tsx:161), so only Send's review needs the Total-leaving assertion.

*Trace's evidence:* **Code at 133d598b:**
- CardanoSend.tsx:233-237: the review's StakedWarning.
- CardanoSend.tsx:298-300: the form's StakedWarning.
- CardanoSend.tsx:164-167: the leaving sum. It is keyed on `p.own && p.ownAccount === active` and #359 didn't change it.
- Withdraw.tsx:248-256: the review's StakedWarning.
- Withdraw.tsx:318-320: the form's StakedWarning.
- Withdraw.tsx:161: the leaving sum counts every payment.

**Existing tests:**
- own-account-names.test.ts:62-76 renders StakedWarning on its own only.
- spell-check.test.ts:39 renders CardanoSend's form only.
- screens-wiring-review-fixes.test.ts:226 and the "Make public" test near line 998 render the review with `{own:false}` only.
- `git grep` for send-staked, withdraw-staked, StakedWarning and the warning text finds nothing in tests/ (apart from own-account-names) or e2e/.
- The src import graph is CardanoSend ← Home ← App ← main, and Withdraw ← Home and Transfer.
- `gh pr view 359` says: "I didn't add an e2e test for the new warning."

**What I ran,** in my own worktree `.claude/worktrees/r172-v-own3` at 133d598b (removed afterwards; r172-cross untouched and clean):
1. **Mutant A** (four StakedWarning usages → null, import removed): `tsc` exit 0.
   - It passed `vitest run` on 32 files (421 tests): own-account-names, max-left-review-fixes, screens-wiring-review-fixes, spell-check, home-review-fixes, home-says, i18n-assembly, other-side, review-totals-incoming, screens, address-routes, lock-screens, account-recipients-side, hide-balances-forms, i18n-critical-helpers, i18n-review-fixes, i18n-screens, import-boundaries, opens-at-top, paid-rows, review-layout, review-stale-form, shown-text, i18n, words, send, own-address, withdraw, date-locale, i18n-values-in-place, ui-safety, privacy-notes.
   - It passed 12 more files (228 tests): lovejoin-hub, lovejoin-release-rules, lovejoin-restore, restore-scan, dapp-prompt, dreps, i18n-worker-reasons, lovejoin-1-5-0, lovejoin-advance, nft-image-screen, store-images-copy, tokens.
   - Everything was green.
2. **Mutant B** (CardanoSend.tsx:165 changed to `(p.own ? p.ownAccount : p.staked) === active ? sum : …`): tsc exit 0, and 23 existing files passed (449 tests).
3. **Worker mutant** (destination.ts: `own: isOwnAddress(...) || carriesStakeKey(address)`): 3 tests failed in own-address.test.ts and send.test.ts. That part is pinned.
4. **Positive scratch test:** the screens-wiring seam (lines 13-208) plus 5 tests. It passed 5/5 on the fixed code; under A, 4 tests failed; under B, 1 failed. A copy is kept at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/v-own3-staked-wiring.test.ts.

*Trace's fix note:* The suggested fix is right, with one correction. Add a describe block to tests/screens-wiring-review-fixes.test.ts. It already has the seam, `render`, `has`, `words`, `ada`, `seed` and `seedInitial`. Add `const { CardanoSend } = await import("../src/ui/screens/CardanoSend")` beside Withdraw's import at line 226. Then:

1. **Send's review:** `seed([{}, false, "", false], { network:"preprod", txHash:TX, max:false, fee:"170000", changeLovelace:"0", changeTokens:0, inputs:1, payments:[{ address, own:false, staked:0, lovelace:"2000000", minimum:null, tokens:[] }] })`, then render `CardanoSend {cardano, onCancel, onSent}`.
   - Assert `has(markup, "send-staked")`.
   - Assert the words contain `Total leaving your public account ${ada("2170000")}`.
   - Add a contrast case, `{own:true, ownAccount:0}`: no `send-staked`, and the total is the fee alone.
2. **Send's form:** `seedInitial({}, { 0: { to: address, read: { state:"read", destination:{ address, own:false, staked:0 } } } })`, rendered with `to: address`. Assert `has(markup, "send-staked")`.
3. **Make public's review:** `seed([{}, false], { ...figures, payments:[{ address, own:false, staked:0, lovelace:"600000000", minimum:null, tokens:[] }] })`. Assert `withdraw-staked`.
4. **Make public's form:** the same `seedInitial` with `to`. Assert `withdraw-staked`.

The correction: don't add a Total-leaving assertion to Make public's review. Withdraw.tsx:161 counts every payment as leaving, whoever it goes to.

All four were checked in a scratch copy:
- They pass at 133d598b.
- They kill the finding's mutant (4 of 4 fail).
- The Send total assertion also kills the leaving-sum mutant.

No e2e test is needed.

### own4

**own#4 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/privacy.md:192`

**privacy.md still lists only a certificate or a withdrawal as naming a public account's stake key, not a proposal's deposit**

**Outcome: fixed.** privacy.md's two lists name a proposal's deposit, and a treasury withdrawal's recipients.

*Claim:* privacy.md:192 lists what puts a public account into a private session's transaction: "One is in a transaction too when a certificate or a withdrawal in it names that account's stake key", and "a certificate's or a withdrawal's line says whose stake key it is". Since #357, a proposal whose deposit goes back to that stake key is counted in `certified` too, and the prompt says "A certificate, withdrawal or proposal in it names the stake key of your public account". flows.md:430 and architecture.md:568 were updated; privacy.md wasn't (#357 touched only two links in it).

*Failure:* A reader of the privacy doc concludes that a session transaction carrying a proposal whose deposit returns to the public account's stake key leaves the public account out. In fact it ties them on chain, and the prompt now says so.

*Evidence:* privacy.md:192 at 133d598b, read. The diff from f31758b0 to 133d598b on privacy.md changes only two backlog links.

*Suggested fix:* Change it to "a certificate, a withdrawal or a proposal's deposit return", in both sentences of line 192.

*Trace (confirmed, low):* I traced the code myself and ran the case. The fault is real. A site connected to a private session can put a governance proposal in its transaction. The deposit goes back to the public account's reward address, and the session's signature alone completes the transaction, because a proposal's reward account takes no witness. Nothing refuses this on the session path:
- readTx refuses only a certificate of the session's own stake key.
- inspectSessionTx goes through cip30::inspect_tx, which lists every proposal and refuses only one for the other network.
- refuseOddities applies only to the wallet's own swap and cancel transactions.

Since #357, ties() puts such a proposal in `certified`. The prompt then shows the certified warning ("A certificate, withdrawal or proposal in it names the stake key of your public account: signing ties this private session to your public account on chain") and the proposal's own line ("deposit comes back to the stake key of your public account"). It never says "Your public account isn't in it".

privacy.md:192 at 133d598b still lists what puts a public account into a session's transaction as an exhaustive "unless …" list. That list names payments, spends, stake-key addresses, and a certificate or a withdrawal, but no proposal. It says "a certificate's or a withdrawal's line says whose stake key it is", and it says the other side is said to be out of it only when the wallet "found none of these". For a proposal whose deposit goes back to a public account, the list is false about the chain, and it is now behind the code too.

#357 updated flows.md:430 and architecture.md:568 with "a certificate, a withdrawal or a proposal". Chunk 39's plan (archive/plans/chunk-39-proposal-deposit.md:5) names only those two docs and the privacy policy (unchanged, which is correct), so privacy.md was missed.

Reach is narrow. It needs a session transaction carrying a proposal, and the mainnet deposit is 100,000 ₳, paid by the session or, with partialSign, by someone else's inputs. The signing prompt itself is right, so only a reader of the doc is misled. That fits the brief's "low": an edge-case inaccuracy in a doc. It is more than a nit, because the doc states something false about what ties on chain.

One detail in the finding's evidence is wrong, but the conclusion stands. #357 didn't touch privacy.md at all. The two backlog-link edits came from #356 (6beb3cde); per-merge diff stats show 366da793 changed nothing in privacy.md.

The suggested fix points the right way but is incomplete:
- Its wording, "a proposal's deposit return … names", reads awkwardly.
- Sentence 1 should also give the reason, as it does for certificates: the session's signature alone completes it.
- privacy.md:106 has the same omission in the other direction. It lists the old-style registration and the pool registration as the ways a site on another account puts a session's stake key into a transaction the wallet signs, and a proposal is a third way. #357's own test covers that direction. Line 106 isn't phrased as exhaustive, so it is an omission rather than a false statement.

*Trace's evidence:* Everything below is at 133d598b.

**What privacy.md says:**
- privacy.md:192 (read): "One is in a transaction too when a certificate or a withdrawal in it names that account's stake key…" and "a certificate's or a withdrawal's line says whose stake key it is". The word "proposal" appears nowhere in privacy.md's dApp sections. Its only hits are at :7 and :158, both unrelated.
- privacy.md:106 lists only the registration and the pool registration for a session's stake key named by another account's transaction.

**What the code does:**
- dapp.ts:2303: `const proposals = summary.proposals.map((p) => (p.own ? undefined : byStake(p.credential)))`.
- dapp.ts:2324: `certified: listed([...certificates, ...withdrawals, ...proposals]…)`.
- dapp.ts:2133-2147: signTx passes `certified` for a session too (holder set).
- dapp.ts:2015-2081 (readTx): the only refusal for a session is a certificate of its own stake key (2076-2078). Proposals are not refused.
- wasm/src/lib.rs:6074-6085: inspectSessionTx calls cip30::inspect_tx.
- cip30.rs:1533-1561: proposals are listed; only the other network's is refused.
- sessions.ts:6567 (refuseOddities) is called only from the swap path (:4223).

**What the prompt shows:**
- en.json:492: dappUi.ties.privacy.certified reads "A certificate, withdrawal or proposal in it names the stake key of {{list}}…".
- en.json:470-472: the proposal lines.
- DappApprovals.tsx:1122-1125: the certified callout.
- DappApprovals.tsx:1224-1225: signingTies includes `certified`, so the window doesn't say the other side is out of it.

**The other docs and the plan:**
- flows.md:430 and architecture.md:568 say "a certificate, a withdrawal or a proposal" (word-diff from f31758b0).
- In the per-merge `git diff --stat`, only 6beb3cde (#356) touched privacy.md (2 links). 366da793 (#357) didn't touch it.
- archive/plans/chunk-39-proposal-deposit.md:5 names architecture.md, flows.md and the privacy policy, never privacy.md.

**Test run:** I added a scratch Vitest in the r172-cross sandbox, tests/zz-r172-v-own4.test.ts, built on dapp-ties.test.ts's helpers, and deleted it afterwards; the sandbox is clean. A site on private session 0 signs an Info proposal whose reward account is account 0's stake address. Results:
- `complete: true`, `signs: ["0/0"]`.
- `[ties, staked, certified]` = `[[],[],[{account:0}]]`; `proposals[0].yours` = `{account:0}`.
- The window text includes "A certificate, withdrawal or proposal in it names the stake key of your public account: signing ties this private session to your public account on chain…" and "Its 1,000 ₳ deposit comes back to the stake key of your public account when the action ends."
- It contains no "isn't in it".

*Trace's fix note:* The fix is a doc edit in privacy.md. No code changes.

1. **:192, sentence 1.** Replace "One is in a transaction too when a certificate or a withdrawal in it names that account's stake key: an old-style registration needs no signature of that key's, so the session's alone completes it (1.5.0's cross-area review, X05), and a stake pool's registration…" with "One is in a transaction too when a certificate or a withdrawal in it names that account's stake key, or a proposal's deposit goes back to it: an old-style registration needs no signature of that key's, so the session's alone completes it (1.5.0's cross-area review, X05), nor does a proposal, whose deposit goes back to the reward account it names when the action ends (chunk 39), and a stake pool's registration…".
2. **:192, sentence 2.** Replace "a certificate's or a withdrawal's line says whose stake key it is ("A certificate for the stake key of your public account")" with "a certificate's, a withdrawal's or a proposal's line says whose stake key it is ("A certificate for the stake key of your public account"; "Its … ₳ deposit comes back to the stake key of your public account when the action ends")". The rest of the line ("found none of these", and the unchecked "isn't yours") then holds as written.
3. **:106 (optional).** Add the reverse direction: "…nor does a stake pool's registration that makes it the pool's reward account, or a proposal whose deposit goes back to it (chunk 39), so a site on another account can put one in a transaction it asks the wallet to sign…".

The suggested fix's wording, "a proposal's deposit return … names", is clumsy, and it leaves out both the reason clause and :106. No test pins privacy.md text, and Markdown skips CI.

Optional:
- Add a test for the session → public direction to dapp-ties.test.ts's "a private session's signing prompt" block: a proposal back to account 0's reward address should give `certified` `[{account:0}]` and no "isn't in it". The existing proposal test covers only public → session. The `certified` computation is shared, so a mutant that drops proposals already fails that test.
- These comments still say only "a certificate or a withdrawal" for `certified` (nits): rpc.ts:1510, ui/dapp.ts:80, DappApprovals.tsx:974 and :1222. architecture.md:568's "When the check can't run … a certificate's or a withdrawal's line says "isn't yours"" applies to a proposal's line too.

### own5

**own#5 · nit · docs** · `seedelf-platform/seedelf-web-wallet/extension/src/background/destination.ts:6`

**destination.ts's header still states the stake-key rule #359 removed**

**Outcome: fixed.** With pr359#3.

*Claim:* The module header (destination.ts:4-9) still says a destination is the account's own when it is "one carrying the account's staking key, or under one of its payment keys". That is the exact rule the bounty fix removed. #359 updated ownAccount's own doc comment but not this header.

*Failure:* A developer reading the header takes an address carrying the account's stake key to be its own, which is the Medium bug #359 fixed.

*Evidence:* destination.ts:1-9 at 133d598b, read. The #359 diff of this file touches only ownAccount and resolveDestination.

*Suggested fix:* Have the header state #359's rule: own by payment key, whatever the staking part (the first 20 keys, the found keys, up to 500 under its stake key); an address that only carries the stake key is `staked`, not own.

*Verification:* nit: not verified

## Reviewer i18n (cross)

### What it checked

Scope: every translation key #357, #358 and #359 added, changed or removed (`git diff f31758b0 133d598b`). That is 11 live keys: dappUi.proposal.warn.own, .wallet and .notYours; dappUi.ties.privacy.certified; dappUi.warn.unknownInputs (_one, _many, _other); send.warn.staked and stakedNth; withdraw.warn.staked and stakedNth. It also covers dappUi.note.proposals_*, which was removed.

1. **Meaning (es and ja).** I back-translated each value myself and compared it to the English clause by clause, checking whose key, address and deposit each sentence names, and every "only", "still", "not" and "isn't". All carry the English.
   - I also rendered the assembled sentences in en, es and ja with a scratch Vitest file in the sandbox (since deleted). It covered every proposal kind, own, session, named account, one account, session N, a stranger's address, the certified line with one and two names, unknownInputs at counts 1, 2 and 5 inside SignTx, and StakedWarning for Send and Make public with one account, several, and as recipient N.
   - Every sentence reads right. es keeps its gender agreement ("Esta … cuenta", "tuya" for clave).
   - Vocabulary matches the glossary and the existing keys: clave de stake, retiro, acción de gobernanza; ステーク鍵, 支払鍵, ガバナンスアクション, 宛先.
   - No English word is left, and proposalWords' seven keys match decode.rs action_kind exactly.
2. **Tokens and format.** Placeholders, plural sets (en one/other, es one/many/other, ja other) and the U+00A0 before ₳ are all right. Amounts come out en-US ("100,000") in every language.
3. **Critical set.** All 7 new keys are in critical-keys.json (470 keys, 463 before). The verified-critical lists cover every critical key, with no duplicates.
   - Each PR's values equal the merged tree's.
   - Line 2 of each verified file equals the 1.7.1 notes plus #358's addition plus #359's, in that order. The merge kept both rounds.
   - Each note describes the current value: "El depósito … de la propuesta", ガバナンスアクションが終わると with its comma, "Solo tu clave de stake firma aquí.", "La dirección del destinatario", and the address named in Make public.
   - Two small looseness points, not findings: the ja chunk-39 note says the bare 公開アカウント "holds of the English", but it's really the glossary's rule; the es #359 "Round three kept every clause of both" is ambiguous, though all four values were verified at their current text.
4. **Provenance.** Both files have "machine" entries for all 7 new keys, which matches 1.6.0's practice (59 of 67). The removed keys' entries are gone, and no file has stray or duplicate keys.
5. **Code.**
   - There's no module-level t(): the AST guard in i18n-assembly passes, and a grep of the 10 touched files is clean.
   - No translated text is compared, parsed or persisted: tone and ownership go by p.own, staked and yours.
   - No English literals remain in StakedWarning, DappApprovals, TxDetail, CardanoSend, Withdraw, format.ts or ui/dapp.ts.
   - Every `.proposals` use reads it as an array.
   - tx.proposal.* and accountPicker.numbered are deliberately listed in SHARED_WORDS.
   - No test, unit or e2e, reads the old unknownInputs wording or regex forms of it. In fact no test reads that callout at all (finding 1).
   - The certified wording change was carried through dapp-ties, dapp-ties-accounts and e2e.
6. **Test runs in the sandbox.**
   - The i18n guard tests passed: i18n, i18n-critical-helpers, i18n-worker-reasons, i18n-assembly, i18n-joins, i18n-review-fixes, i18n-screens, i18n-values-in-place, words, worker-words and worker-language. That's 11 files and 194 tests.
   - The rendering tests passed too: dapp-prompt, dapp-ties, dapp-ties-accounts, own-account-names, tx-view-screen and swap-page-words. That's 6 files and 121 tests.

No mutant was run, because the sandbox forbids edits to tracked files. I removed the scratch file, and `git status` in the sandbox is clean.

### i18n0

**i18n#0 · low · test-gap** · `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:1215`

**#358's callout wording fix is pinned by no test, in any language**

**Outcome: fixed.** dapp-prompt.test.ts pins the dapp-unknown callout's exact text in en, es and ja, plural forms included; both of the verifier's mutants fail it.

*Claim:* #358 removed the false clause "and it spends none of them" from dappUi.warn.unknownInputs in en, es and ja. No unit or e2e test renders the dapp-unknown callout or reads its text, so nothing guards against the old wording coming back.

*Failure:* A later edit or a merge-conflict resolution in the three locale files brings back the 1.7.1 value: en "…Only your stake key signs here, and it spends none of them.", es "…que no gasta ninguno de ellos" / "que no lo gasta", or ja "…ステーク鍵はそれらの UTxO をどれも使用しません". Every test still passes. The sign window then tells the user again that the stake key spends none of the UTxOs it couldn't find, which is false for any at its own enterprise address (the cip30.rs comment at 133d598b:1615-1624).

*Evidence:* Traced. I ran git grep -c at 133d598b over extension/tests and extension/e2e for dapp-unknown, dappUi.warn.unknownInputs and the callout's words in each language (couldn.t find, so / no se puede mostrar lo que / その内容は表示できません / stake key signs here / firma aquí / ステーク鍵だけです). There was no match (exit 1); the testId exists only at DappApprovals.tsx:1215-1218. #358's PR body also says no e2e test reads it. A scratch SignTx render in the sandbox (unknownInputs at counts 1, 2 and 5, signs ["stake"]) showed the callout renders the key's text, so a unit test is cheap. No mutant was run because tracked files can't be edited in the sandbox.

*Suggested fix:* In tests/dapp-prompt.test.ts, render SignTx with summary({ signs: ["stake"], ownInputs: 0, unknownInputs: [`${"cd".repeat(32)}#0`] }). Assert that the dapp-unknown callout's text equals the current en value and doesn't match /none of them/. Then, after i18n.changeLanguage("es") and ("ja"), assert it doesn't match /ninguno|no lo gasta/ and /どれも/, and set the language back to en afterwards.

*Trace (confirmed, low):* I traced this myself and every part of the claim holds.

1. **The fix is real.** `git diff f31758b0 133d598b` on the locales shows #358 took the clause out of dappUi.warn.unknownInputs:
   - en, both forms: ", and it spends none of them";
   - es, all three forms: "que no gasta ninguno de ellos" and "que no lo gasta". Back-translation round one also reordered the Spanish to "Solo tu clave de stake firma aquí", because "Aquí solo firma tu clave de stake" read as an order to sign. The reviewer note in verified-critical-es.json records this;
   - ja `_other`: "ステーク鍵はそれらの UTxO をどれも使用しません".

2. **The callout is reachable.** It renders only at DappApprovals.tsx:1215-1218. The callout shows only when the site's transaction spends inputs the wallet couldn't find and the account's stake key is its only signer:
   - inputs the wallet couldn't find, with a payment or DRep key signing, are refused (cip30.rs:1625-1640);
   - a request with no key of the account's signing is refused (dapp.ts:2069);
   - an incomplete request without partialSign is refused (dapp.ts:2072; `complete` is false whenever an input wasn't found, cip30.rs:1664).

3. **No test reads it.**
   - `git grep` over tests/ and e2e/ for the testId, the key and the callout's words in all three languages finds nothing. The only hits are `unknownInputs: []` fixtures.
   - There are no snapshot tests.
   - i18n.test.ts checks structure only: key parity, tokens, provenance and negation. The negation check passes the old values, which still carry negations (couldn't / can't / no pudo / ません).

4. **Mutant A: the old wording survives.** In my own worktree at 133d598b I put back the six 1.7.1 lines (en 2, es 3, ja 1). I ran the 35 related test files: every dapp-*, i18n-*, words, shown-text, worker-words, live-runs-copy, store-images-copy, swap-page-words and approvals-review-fixes. All 437 tests passed; only my scratch pin failed. No other test file names the key, the testId or the words, and 1.7.1's suite passed with these exact values.

5. **The suggested fix works, but only in part.** I wrote it as a scratch test. It passed on the clean tree and failed on mutant A in all three languages. But it renders a single UTxO and checks es and ja by regex, so it leaves en `_other`, es `_other`/`_many` and the es reorder unpinned. Mutant B put back en `_other`'s clause alone, and gave es the old word order without the clause. It passed the suggested test and failed a fuller one that checks exact values.

6. **Severity is low, not medium.** The brief rates "a fix no test pins" as low. If the old text came back, it would be false only for a missing input at the stake key's own enterprise address. Such an input is either an output not yet on chain at an address no wallet pays, or a row the data source left out, which is out of scope (cip30.rs:1615-1624).

Aside (a nit that predates #358): en `_one` says "what they hold" for one UTxO, where es `_one` is singular ("lo que contiene"). An exact-value pin would freeze that phrase, so fix the wording first if wanted.

*Trace's evidence:* **Code at 133d598b (read):**
- extension/src/ui/screens/DappApprovals.tsx:1215-1218 (the callout)
- wasm/src/cip30.rs:1615-1640 (the comment, then the refusal when a payment or DRep key signs), cip30.rs:1664 (`complete`)
- extension/src/background/dapp.ts:2069 and :2072
- Locale lines: en.json:509-510, es.json:531-533, ja.json:487
- tests/i18n.test.ts: structure checks only; the negation regexes are at :138-145
- tests/dapp-prompt.test.ts: its `summary`/`render`/`text` helpers fit the pin

**Commands:**
- `git diff f31758b0 133d598b -- .../translations/` confirmed the wording change.
- `git grep` at 133d598b over extension/tests and extension/e2e found no match for dapp-unknown, the key, or the callout's words in any language. Searching for `toMatchSnapshot` and `__snapshots__` found none.
- `gh pr view 358`: its body says "no e2e test reads it".

**Mutants**, in my own worktree `.claude/worktrees/r172-v-i18n0` (since removed; the r172-i18n sandbox and the main checkout are clean):
- **Mutant A:** script /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/i18n0-mutant.mjs puts back the six 1.7.1 lines. Running `npx vitest run` on 35 related files: 35 files and 437 tests passed; only the scratch pin failed (3 of 3).
- **Clean tree:** the scratch pin passed. The callout reads "...Only your stake key signs here." / "...Solo tu clave de stake firma aquí." / "...ここで署名するのはあなたのステーク鍵だけです。"
- **Mutant B:** script /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/i18n0-mutant-b.mjs gives en `_other` its clause back and gives es the old order without the clause. The suggested test passed; the exact-value pin failed, listing en 2, es 1, es 2 and es 1000000.

*Trace's fix note:* The suggested fix is right but incomplete. It renders one UTxO and checks es and ja by regex, so mutant B passed it.

Pin it in tests/dapp-prompt.test.ts, which already renders SignTx:
- Add `import { i18n } from "../src/i18n/core"` and an `afterEach` that calls `i18n.changeLanguage("en")`.
- Render SignTx with `summary({ signs: ["stake"], ownInputs: 0, unknownInputs: new Array(n).fill(`${"cd".repeat(32)}#0`) })`. Only `.length` is read. `partial: true` is the real state.
- Take the dapp-unknown callout's body with `/data-testid="dapp-unknown"[^>]*>.*?<div class="callout__body">(.*?)<\/div>/` and replace `&#x27;` with `'`.
- Assert it `toBe` the exact current value for:
  - en: n=1 and n=2;
  - es: n=1, n=2 and n=1_000_000 (`Intl.PluralRules("es")` selects "many" there, and i18next prints 1000000);
  - ja: n=2.
- Also assert there's no dapp-unknown callout when `unknownInputs: []`.

Exact values pin both the dropped clause and Spanish round one's reorder, as i18n-critical-helpers.test.ts's "what the back-translation of these warnings corrected" tests do. Check the pin against mutant A (a full revert) and mutant B (en `_other` alone, and the old es order): it must fail on both. My scratch version of this test passed on the clean tree and failed on both mutants.

### i18n1

**i18n#1 · nit · ux-text** · `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:509`

**en unknownInputs_one says "what they hold" of a single UTxO**

**Outcome: fixed.** en `_one` says "what it holds"; es and ja were singular or neutral already.

*Claim:* #358 rewrote dappUi.warn.unknownInputs_one but kept the plural pronoun copied from _other. The es _one is already singular ("lo que contiene") and ja is neutral.

*Failure:* A site's transaction spends one UTxO the wallet can't find and only the stake key signs (partialSign). The sign window reads "It spends 1 UTxO the wallet couldn't find, so what they hold can't be shown. Only your stake key signs here."

*Evidence:* Read the value at en.json:509 (133d598b). The scratch render showed the exact sentence for count 1, and es rendered "lo que contiene".

*Suggested fix:* en _one: "…so what it holds can't be shown. Only your stake key signs here." es and ja need no change and no new back-translation round, since they already say it in the singular or neutrally.

*Verification:* nit: not verified

### i18n2

**i18n#2 · nit · ux-text** · `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:472`

**A proposal's deposit sent to a script's reward account is called "a stake key"**

**Outcome: left.** As pr357#1.

*Claim:* dappUi.proposal.warn.notYours (and its es/ja: "una clave de stake que no es tuya", "あなたのものではないステーク鍵") also covers a return address that is a script's reward account, where no key is involved. The withdrawal line says "a reward account that isn't yours" (en.json:517). The certificate line (en.json:360) has the same imprecision, so this matches an existing pattern.

*Failure:* A site's proposal names a script reward address (stake17… / stake_test17…) as its deposit return. WebAssembly gives credential null (cip30.rs:1552), the worker names no account, and proposalLine (ui/dapp.ts:218) shows "Proposes … Its 100,000 ₳ deposit goes to a stake key that isn't yours, stake17…, when the action ends." Only the word "key" is wrong: "isn't yours" is still true, and the whole address is shown.

*Evidence:* Traced from cip30.rs:1550-1560 (StakePayload::Script → credential None) through background/dapp.ts:2303 (byStake(null) → undefined) to ui/dapp.ts:216-218.

*Suggested fix:* Optional. Say "goes to a reward account that isn't yours, {{address}}," as the withdrawal line does (es "una cuenta de recompensas que no es tuya", ja "あなたのものではない報酬アカウント"), with a blind back-translation round and a note in both verified files. Or leave it as is, consistent with dappUi.cert.warn.otherStakeKey.

*Verification:* nit: not verified

## Reviewer release (cross)

### What it checked

Baseline 133d598b against f31758b0, read-only, plus a few Vitest files in the r172-release sandbox. The sandbox is left clean and my scratch files are deleted.

1. Privacy policy (docs/store/privacy-policy.md, the published one, and docs/privacy.md). No policy entry is owed.
   - #357 decodes the proposals already in the transaction's bytes (cip30.rs inspect, decode.rs action_kind). It matches their reward accounts against stake keys derived on the device (tx-view.ts markYours, dapp.ts ties).
   - #358 only reclassifies rows the worker already fetched. dapp.ts resolve still asks utxoInfo by outpoint, and #358 didn't touch it.
   - #359's farther key search is local derivation. lib.rs is_own_address loops account.key_hash up to OWN_KEYS_STAKED=500 with no I/O, and destination.ts ownAccount "asks no one".
   - Nothing new is stored and no new host is contacted. Transaction details still makes no request. The policy's existing lines (sites, the UTxO lookup, the transaction view) still hold.

2. Store listing. Nothing in the en, es or ja description is made false by 1.7.2: "Nothing is looked up to show it" and "warns you before a step ties your accounts together" still hold.
   - None of the five screenshots shows a changed screen. Shot 4 pays receive_0, which is still the account's own by payment key 0/0, so it shows OwnWarning, not StakedWarning.
   - No CSS or store-images spec changed, and store-images-copy passes. No new images are needed.

3. Data layer. Nothing under seedelf-data/ or src/tokens/ changed since f31758b0 (git diff --quiet). The lead's dd22e2b2 reports the tokens and the decimals unchanged, so no API deploy is owed.

4. Design docs. These are correct:
   - flows.md:227 and :399, keys-and-accounts.md:153, and wasm/README's isOwnAddress and carriesStakeKey rows match lib.rs and destination.ts: indices 0 to 499 on each chain, and other accounts checked with no known keys.
   - architecture.md:562 and :566 match cip30.rs (owner via of_hash, and the Payment-or-DRep refusal over unknown inputs).
   - architecture.md's transaction-view paragraph and flows.md:258 match markYours.
   - The strings flows.md:430 and architecture.md:568 quote match en.json. The callout's tone matches DappApprovals.tsx:1146.
   - No stale "It makes 1 governance proposal" or "spends none of them" remains outside the archive and tests.
   - Every relative link and anchor in the live docs resolves: a scripted check, itself sanity-tested, found 0 broken.
   - The new critical keys are in critical-keys.json and in both verified-critical files.
   - The rest (privacy.md, keys-and-accounts.md rules 4 and 5, architecture.md's refusal sentence) is in the findings. wasm/README's inspectDappTx row is a summary that already left out several fields, so I didn't file it.

5. backlog.md: see the findings.

6. development.md:
   - All three places #356 changed now point at releases.md.
   - releases.md's tags match git: 1.6.0 babb8e76, 1.7.0 f375af62, 1.7.1 f31758b0.

7. SECURITY.md:23 (scope is the latest web-wallet/ tag, with "such as" examples), the root README's Data Layer Reliance, and the web wallet README: nothing is stale for 1.7.2.

8. CI and build. These are all unchanged since f31758b0 (git diff --quiet): .github, src/manifest.ts, package.json and its lock at 133d598b, scripts/, public/, vite and playwright configs, Cargo.toml and Cargo.lock, rust-toolchain.toml, wasm Cargo.toml and build.sh, and seedelf-core, -crypto and -koios.
   - The only new things are the carriesStakeKey export (readme_test names it) and the e2e suite at 105 tests (one added by #357).
   - The new wasm fixture is read with include_str!, so it stays offline.
   - No CLI or crate release is owed: only seedelf-wasm changed, and it has publish = false.

Tests run in the sandbox:
- vitest i18n, i18n-critical-helpers, words, store-images-copy, live-runs-copy, manifest and privacy-notes: 122 passed.
- own-address and own-account-names: 10 passed.
- In a scratch folder, `npm version 1.7.1` on a package.json at 1.7.2 sets 1.7.1 without complaint.

### release0

**release#0 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/privacy.md:65`

**privacy.md still says Make public treats an address carrying the account's stake key as the account's own**

**Outcome: fixed.** As pr359#2.

*Claim:* privacy.md:65 reads: "It warns when the destination is **any of this wallet's own Cardano accounts** (chunk 18): an address carrying one's staking key, or whose payment key is one of its own (the first 20 of each chain, and, for the account the wallet is on, any the last balance reading found; privacy review §2.17)." Since #359, an address is the account's by its payment key alone, and the wallet looks up to index 500 when the address carries the account's stake key. An address that only carries the stake key now gets its own warning (StakedWarning, withdraw.warn.staked: "This isn't your public account…"). flows.md:399 and keys-and-accounts.md:153 state the new rule, so privacy.md now contradicts them.

*Failure:* Someone checks Make public's own-account rule against the privacy design doc. It tells them that an address with account 0's stake key under a stranger's payment key is one of the wallet's own accounts. That is the rule the 2026-11-02 Medium bounty report showed to be unsafe, and "bringing the code in line with privacy.md" would undo #359. The doc also omits the 500-key search and the new warning.

*Evidence:* docs/privacy.md:65 at 133d598b. Code: wasm/src/lib.rs:4887 (OWN_KEYS_STAKED), :4900 (is_own_address, stake-key match removed), :4936 (carries_stake_key); extension/src/background/destination.ts:110-136 (ownAccount returns { own: false, staked }); ui/screens/Withdraw.tsx:253, :319 (StakedWarning). Ran tests/own-address.test.ts in the sandbox: resolve returns { own: false, staked: 0 } for a stranger's key under account 0's stake key (its line 80).

*Suggested fix:* Word it as flows.md:399 does. It warns when the destination is under one of the wallet's accounts' payment keys: the first 20 of each chain, those the last reading found for the account on screen, and up to 500 when the address carries that account's stake key, an enterprise address among them. An address that only carries one's stake key isn't the account's, and gets a warning of its own: only its payment key's holder can spend it, and anyone can still link it to this money and to whoever made it private (the 2026-11-02 bounty report). Docs only, no test.

*Trace (confirmed, low):* I traced this from the code and found nothing that refutes it.

1. **The doc.** At 133d598b, privacy.md:65 still names "an address carrying one's staking key" as one of "this wallet's own Cardano accounts". Its list of keys checked stops at the first 20 of each chain plus the keys the last reading found.

2. **The code.** #359 removed the stake-key match from `api::is_own_address` (wasm/src/lib.rs:4900-4931). The stake key now only widens the payment-key search, from 20 to `OWN_KEYS_STAKED` = 500 (lib.rs:4887, :4918). The new `carries_stake_key` (lib.rs:4936) feeds `ownAccount` (destination.ts:114-136). For the active account and every other known one, `ownAccount` returns `{ own: false, staked }`.

3. **The screens.** That `staked` reaches Make public's form (Withdraw.tsx:318-320) and its review: withdraw.ts:137 spreads the destination into each payment, and Withdraw.tsx:247-256 reads it. Both show `StakedWarning` with `withdraw.warn.staked` ("This isn't your {{whose}}: … only they can spend this. Anyone can still link the address …"), never `OwnWarning`.

4. **The PR.** #359's description lists the docs it updated: flows.md, keys-and-accounts.md and wasm/README.md. privacy.md isn't among them. `git diff f31758b0 133d598b` shows #356's two-line edit as the only change to privacy.md since 1.7.1, and neither line is line 65.

So the privacy design doc now contradicts the code and flows.md:399 / keys-and-accounts.md:155. It describes the rule the Medium bounty report showed to be unsafe, and it leaves out the 500-key search and the new warning.

One possible refutation is that the form "still warns" for such an address. It doesn't hold: the doc calls the address the account's own, which is exactly what #359 made untrue.

On severity: privacy.md is a developer design doc (the store's policy is docs/store/privacy-policy.md), and no user-facing screen is wrong. That fits "a doc that misleads a developer", so low.

The suggested fix is right in substance. One wording slip: it tacks "an enterprise address among them" onto the stake-key clause, which reads as if an enterprise address could carry the stake key. It can't, because an enterprise address has no staking part.

*Trace's evidence:* - **Text at 133d598b:** read `git show 133d598b:seedelf-platform/seedelf-web-wallet/docs/privacy.md`, line 65 (old rule).
- **Docs history:** `git diff f31758b0 133d598b -- docs/privacy.md` shows #356's two changed lines, neither of them line 65. `git diff 7354f656 133d598b` (#359) touches flows.md:399, keys-and-accounts.md:155 (the finding cites :153; the bullet is at 155) and wasm/README.md:30-31, but not privacy.md. `gh pr view 359`'s "Docs:" line names only those three files.
- **Code:**
  - wasm/src/lib.rs: :4887 `OWN_KEYS_STAKED = 500`; :4900 `is_own_address` without the stake-key match; :4918 `farthest`; :4936 `carries_stake_key`.
  - extension/src/background/destination.ts:114-136 (`ownAccount` returns `staked`, every known account checked); withdraw.ts:137 spreads the destination into the review's payments.
  - extension/src/ui/screens/Withdraw.tsx: :253 and :319 (`StakedWarning`); ui/components/StakedWarning.tsx; en.json `withdraw.warn.staked`.
- **Test run:** in the sandbox r172-release, `npx vitest run tests/own-address.test.ts` passed 6/6, including line 80's `{ address, own: false, staked: 0 }` for a stranger's payment key under account 0's stake key, and line 87's `own: true` for key 1/300 under that stake key. The sandbox was left clean (`git status` empty).
- **Other stale copies:** `git grep` finds none in the live docs. The only other one is docs/archive/plans/chunk-10-withdraw.md:66, an archived plan and so a historical record, not a finding. privacy.md:192 (the CIP-30 prompt, X06) and :229 (Lovejoin, "never by its stake key alone") already match the code.

*Trace's fix note:* Docs only, no test. In privacy.md:65, replace "an address carrying one's staking key, or whose payment key is one of its own (the first 20 of each chain, and, for the account the wallet is on, any the last balance reading found; privacy review §2.17)" with the payment-key rule as flows.md:399 states it:
- the destination is under one of an account's payment keys, whatever its staking part, an enterprise address among them;
- the keys are the first 20 of each chain, any the last balance reading found (for the account the wallet is on), and up to the 500th on each chain when the address carries that account's stake key (privacy review §2.17);
- an address that only carries one of the accounts' stake keys isn't the account's, and gets a warning of its own: only its payment key's holder can spend it, and anyone can still link it to this money and to whoever made it private (the 2026-11-02 bounty report).

Keep "an enterprise address among them" next to the payment-key rule. The suggested wording attaches it to the stake-key clause, which an enterprise address can never meet. Keep the rest of line 65 ("Every account the wallet knows is checked…"): it is still true, since `ownAccount` checks every known account for `staked` too.

### release1

**release#1 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/privacy.md:192`

**privacy.md's lists of what can name a stake key without its signature leave out a proposal's deposit (#357)**

**Outcome: fixed.** As own#4, and privacy.md:106's list of what puts a session's stake key in another account's transaction.

*Claim:* privacy.md:106 says "An old-style registration needs no signature of the key's, though, nor does a stake pool's registration that makes it the pool's reward account, so a site on another account can put one in a transaction…; the prompt then names the session, and warns". privacy.md:192 says "One is in a transaction too when a certificate or a withdrawal in it names that account's stake key" and "a certificate's or a withdrawal's line says whose stake key it is". Since #357, a proposal's reward account, which also takes no signature, is matched the same way: dapp.ts ties puts it in `certified`, the proposal's line names the account or session, and the warning reads "A certificate, withdrawal or proposal in it names the stake key of …". architecture.md:568 and flows.md:430 were updated for this; privacy.md wasn't.

*Failure:* A site on the public account sends a proposal whose deposit goes back to private session 1's stake key, or a session's site sends one that names a public account's key. The prompt now names the session or account and warns that signing ties the two on chain. privacy.md, the doc of what links, still says only a registration or a pool's reward account can do that.

*Evidence:* docs/privacy.md:106 and :192 at 133d598b; extension/src/background/dapp.ts:2303 (proposals matched by stake key) and :2324 (certified includes them); en.json dappUi.ties.privacy.certified; tests/dapp-ties.test.ts, chunk 39's case "names a private session a proposal's deposit goes back to" (certified [0], the widened warning). Checked by reading.

*Suggested fix:* At :106, add "or a governance proposal whose deposit goes back to it" to the list. At :192, write "a certificate, a withdrawal or a proposal" in both places (chunk 39). Docs only.

*Trace (confirmed, low):* The finding holds. I traced it from the code and tried three ways to refute it.

1. **Is privacy.md's list meant to be complete?** At :106 the list isn't worded as exhaustive. At :192 it is: "Your public accounts aren't in these transactions unless …", and then "One is in a transaction too when a certificate or a withdrawal in it names that account's stake key". Both places also say what the prompt names, and since #357 the prompt names proposals too:
   - dapp.ts:2303 matches each proposal that isn't the account's own by its stake key (`byStake(p.credential)`).
   - :2320 puts the match into the summary as `yours`.
   - :2324 adds proposals to `certified`.
   - The window then shows `dappUi.ties.privacy.certified`, the warning "A certificate, withdrawal or proposal in it names …" (DappApprovals.tsx:1122-1124).
   - It stops saying "isn't in it" (:1224-1225).
   - `proposalLine` (ui/dapp.ts:217) says "comes back to the stake key of your private session 1".

   So privacy.md:192's closed list, and its "a certificate's or a withdrawal's line says whose stake key it is", now say less than the code does.

2. **Was the gap already there before #357?** On the chain side, yes: a proposal could always name any reward account. But #357 changed the code and updated architecture.md:568 and flows.md:430 to match. Since 1.7.1, privacy.md has only had #356's link edits (3a06b355). So it's the one doc of the three that describes `certified` and is now stale.

3. **Can a real site reach this?** Yes, though it's rare.
   - From memory, and not checked here: from protocol version 10 the ledger refuses a proposal whose return account isn't registered (Conway GOV, `ProposalReturnAccountDoesNotExist`).
   - The wallet never registers a session's stake key. So for the :106 direction (a site on the public account naming a session's key), that key has to be registered first. Anyone can do that with an old-style registration, which needs no signature, either in the same transaction or earlier. If it's earlier, the proposal is the only thing in the transaction that ties the two.
   - The :192 direction (a session's site naming a public account's stake key, already registered when that account stakes) needs nothing more.
   - The deposit on mainnet is 100,000 ₳, which keeps this uncommon.

**Severity: low.** No screen says anything false; the prompt itself is right. What's wrong is that the doc whose job is to list what links leaves out a path the code now handles, which misleads a developer.

*Trace's evidence:* - **The doc, at 133d598b (read):** privacy.md:106 lists only an old-style registration and a stake pool's registration. privacy.md:192 says "a certificate or a withdrawal" twice, inside a closed "unless" list.
- **privacy.md's history:** `git log f31758b0..133d598b -- docs/privacy.md` shows only 3a06b355 (#356, links). `git diff 133d598b HEAD` shows the release branch hasn't touched it either.
- **The code (read):**
  - background/dapp.ts:2303 `const proposals = summary.proposals.map((p) => (p.own ? undefined : byStake(p.credential)));`
  - :2320 `proposals: named(...)`
  - :2324 `certified: listed([...certificates, ...withdrawals, ...proposals]...)`
  - ui/dapp.ts:213-217 `proposalLine`, which uses `dappUi.proposal.warn.wallet` with `tiedName`
  - DappApprovals.tsx:1122-1124 shows the certified callout; :1224-1225 passes `certified` into `signingTies`
  - en.json:471 (`dappUi.proposal.warn.wallet`) and :492 (`dappUi.ties.privacy.certified`)
- **#357's other docs (read the diff of 366da793):** architecture.md:568 and flows.md:430 were updated to "a certificate, a withdrawal or a proposal".
- **Test I ran:** in the sandbox r172-release, `npx vitest run tests/dapp-ties.test.ts -t proposal`. It passed (1 passed, 19 skipped). That is chunk 39's case at dapp-ties.test.ts:404: a site on the public account names session 1's reward account, `certified` is [0], the warning is the widened one, and "isn't in it" doesn't appear. This is exactly the behaviour privacy.md leaves out.
- **Cleanup:** the sandbox's git status is clean; I made no edits there.
- **Unverified:** the ledger rule on the return account's registration is from memory.

*Trace's fix note:* The suggested fix is right. Docs only; no test needed.

**At :106**, extend the list: "…nor does a stake pool's registration that makes it the pool's reward account, or a governance proposal whose deposit goes back to it (chunk 39)…". Optionally extend L2's next sentence too: that deposit, once the action ends, also stays in the session's reward account, because the return and Disconnect read its UTxOs only. dapp.ts:2075's own comment already says "a deposit or rewards under it would be left behind for good".

**At :192**, make three changes:
- "when a certificate, a withdrawal or a proposal in it names that account's stake key", and add the reason: a proposal's deposit goes back to whatever reward account it names, with no signature of that key's.
- "a certificate's, a withdrawal's or a proposal's line says whose stake key it is".
- Bring proposals into L3's sentence: when the accounts can't be read, a proposal's line also says "isn't yours", through `dappUi.proposal.warn.notYours`.

**Optional, same pass (nits):** the same stale "a certificate or a withdrawal" wording is in comments at shared/rpc.ts:1510, DappApprovals.tsx:974 and :1222, ui/dapp.ts:80, and tests/dapp-ties.test.ts:11.

### release2

**release#2 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/backlog.md:9`

**backlog.md doesn't carry the open calls #357 and #358 left**

**Outcome: fixed.** #357's open call is a line under the owner's calls; #358's is settled in architecture.md; #359's untested warning has tests now (pr359#1).

*Claim:* plans/README.md:22 says: "What it leaves open goes into backlog.md, a line in its area with the ID it's cited by." Three items have no line in backlog.md:
- #357's "Your call", recorded in chunk 39's As built as "a stranger's certificate alone leaves the callout informational, as it did before. Unchanged here; the owner's call".
- #358's "Your call": no refusal for inputs the wallet can't find when only the stake key signs. It belongs under Declined if the owner has settled it.
- #359's "I didn't add an e2e test for the new warning". The backlog lists such gaps, for example R3-20.

*Failure:* Once 1.7.2 ships and the PR bodies scroll away, the owner's open call on the staking callout's tone exists only in the last section of an archived plan. backlog.md, which says it holds "the calls still open for the owner", lists none of it, so nobody picks it up or settles it.

*Evidence:* docs/backlog.md at 133d598b: a grep for callout, certificate, proposal, stake key and #357 to #359 finds nothing related. docs/plans/README.md:22; docs/archive/plans/chunk-39-proposal-deposit.md:65; the "Your call" sections of PRs #357 and #358, and the Tests section of #359 (gh pr view).

*Suggested fix:* Under The owner's open calls: "❓ A stranger's certificate alone leaves a site's staking callout informational (chunk 39's As built, #357): a proposal's deposit that isn't the account's makes it a warning, and the plan had said a certificate's did too." Optionally, under Declined, #358's "no refusal of inputs the wallet can't find when only the stake key signs (chunk 29's delegation path)". Under Signing and the connector: "⬜ Send's and Make public's staked warning has no e2e test (#359)."

*Trace (partly, low):* The finding has three parts. One holds, one doesn't, and one is a real gap with a weaker fix than the one suggested.

1. #357: confirmed. Chunk 39 had a plan, so plans/README.md:22 applies to it when it lands: "What it leaves open goes into backlog.md, a line in its area with the ID it's cited by". Chunk 39 left a call open. The As built section (archive/plans/chunk-39-proposal-deposit.md:65) says "a stranger's certificate alone leaves the callout informational ... Unchanged here; the owner's call." The PR body has the same call under "Your call", and the brief says "The PR body leaves it to the owner". So it is still open, not settled. backlog.md at 133d598b has no line for it. Its header (line 3) says the file holds "the calls still open for the owner". #357 changed no line of backlog.md, and the release branch (dd22e2b2) doesn't touch the docs either. The code bears out the call: at DappApprovals.tsx:1145-1146 the callout warns only for one of the account's own certificates, staking money that doesn't all come back, or a proposal that isn't the account's own. A stranger's certificate alone gets tone "info", the same rule 1.7.1 had (f31758b0, line 1144) before proposals were added. The finding asks for the open call to be recorded. It doesn't argue the tone itself, so it doesn't re-raise the standing call.

2. #358: refuted. Nothing is left open. #358 itself wrote the decision into the design doc. architecture.md:566 says: "The stake key's still signs over those (chunk 29): no wallet hands out or pays its enterprise address, so a UTxO there the wallet can't find is one its data source left out." The brief lists it as a standing call, and the owner's no-guards rule settles it anyway. backlog.md:7 only obliges "a chunk or a review", and #358 is a fix PR. A Declined line would be optional at most.

3. #359: the gap is real, but a backlog line is the weaker fix. No test, unit or e2e, renders Send or Make public with a `staked` destination or payment. The worker's field is pinned (own-address.test.ts:80,94; send.test.ts:113). own-account-names.test.ts renders StakedWarning only on its own. So deleting the StakedWarning JSX on either screen (CardanoSend.tsx form and review, Withdraw.tsx form and review) would pass every test. I established this by grep, not by running a mutant. The cheap fix is a screen-level unit test. screens-wiring-review-fixes.test.ts:997 already seeds Make public's review with payments. A backlog line is only needed if the gate leaves the gap open. The #359 reviewer probably raises this as its own finding: one defect, one finding.

Reach is narrower than the failure scenario says. releases.md's "Recording a release" ends with "What it left open goes into backlog.md as a line", so the 1.7.2 record PR is a second, documented step that would catch the #357 call. Nothing reaches users. It's low: a doc that leaves the owner or a developer unaware of an open call, at the bottom of that tier.

*Trace's evidence:* - **Reading, all at 133d598b:**
  - `git show 133d598b:docs/backlog.md`: lines 3, 7 and 9, and its Signing and the connector section (96-103). A grep for callout, certificate, proposal, stake key, staked, e2e, #357/#358/#359, chunk 39, enterprise, tone and informational found nothing related.
  - plans/README.md:22.
  - archive/plans/chunk-39-proposal-deposit.md:37 (the plan's "as it is for a stranger's certificate") and :65 (As built: "the owner's call").
  - releases.md: Recording a release, last bullet.
  - architecture.md:566, which records #358's decision.
  - extension/src/ui/screens/DappApprovals.tsx:1143-1161: the tone expression, compared with f31758b0's :1144.
  - ui/dapp.ts:162-177, certificateLine's line for a stranger's key.
- **GitHub and git:**
  - `gh pr view 357/358/359`: the "Your call" sections and #359's Tests section ("I didn't add an e2e test for the new warning").
  - `gh pr view --json files` for each PR: none touches backlog.md. `git diff 133d598b HEAD` changes no docs.
  - `gh pr diff 359`: StakedWarning is wired into CardanoSend.tsx and Withdraw.tsx.
- **Tests, by grep:** `git grep` over extension/tests and e2e for `send-staked`, `withdraw-staked` and `staked:`: only the worker-level asserts at own-address.test.ts:80,94 and send.test.ts:113. No screen test renders Send or Make public with `staked` (screens-wiring-review-fixes.test.ts:997 seeds Make public's review with `own: false` only).
- **Memory:** proposal-return-address-report.md says "Open for the owner: a stranger's certificate alone leaves the staking callout info-toned".
- **Nothing run:** no tests and no sandbox edits. The sandbox is clean.

*Trace's fix note:* - **#357:** add one ❓ line to backlog.md. plans/README.md:22 asks for "a line in its area", so it goes under Signing and the connector; the open-calls section would also do, since the backlog uses both. Suggested wording: "❓ **A stranger's certificate alone leaves a site's staking callout informational** (chunk 39, #357): a proposal whose deposit goes back to a key that isn't the account's makes it a warning; the plan said a stranger's certificate did too, and it never has."
- **#358:** no line. architecture.md:566 already records the decision, and the brief treats it as settled.
- **#359:** don't add a backlog line. Add a screen-level Vitest case instead, for example in screens-wiring-review-fixes.test.ts: seed Make public's review with a payment carrying `staked: 0` and assert testId `withdraw-staked`, and do the same for Send's review and form with `send-staked`. Check that it fails with the StakedWarning JSX removed. Write a backlog line only if the gate leaves that test unwritten.
- No test can pin a docs line.

### release3

**release#3 · nit · release** · `seedelf-platform/seedelf-web-wallet/docs/development.md:181`

**development.md's release example still says 1.7.1**

**Outcome: fixed.** development.md's release block and zip name say 1.7.2.

*Claim:* development.md:181 reads `release_version=1.7.1`, and :277 reads "With `package.json` at 1.7.1, that file is `extension/release/seedelf-wallet-1.7.1-mainnet.zip`." Every release's docs commit has bumped both lines (78642cb4 for 1.7.1, c36844ec for 1.7.0, and earlier ones). The release branch's dd22e2b2 bumped package.json to 1.7.2 but not these.

*Failure:* Part 1 pasted as written on the 1.7.2 branch, for example to rerun the refreshes, runs `npm version 1.7.1`. npm accepts the lower version, so package.json silently goes back from 1.7.2 to 1.7.1. Part 2's line also names 1.7.1's zip as the file to upload.

*Evidence:* docs/development.md:181 and :277 at 133d598b (git grep 1.7.1). git log -L on line 181 shows a bump at every release. In a scratch folder, `npm version 1.7.1 --no-git-tag-version` on a package.json at 1.7.2 printed v1.7.1 and wrote it.

*Suggested fix:* Change both lines to 1.7.2 in the release branch's docs commit, as earlier releases did.

*Verification:* nit: not verified

### release4

**release#4 · low · release** · `seedelf-platform/seedelf-web-wallet/docs/development.md:281`

**releases.md's record asks for the zip's size and a second build, which development.md's steps never produce**

**Outcome: fixed.** Part 2 prints the zip's size, and builds it a second time in a worktree of its own; part 3's steps point at releases.md's list.

*Claim:* releases.md:30 asks the record for "the commit it was built from, the zip's SHA-256, its size, and the C compiler, Node and zlib lines the build printed; and that a second build of the same commit gave the same bytes." development.md's procedure only keeps the commit, the SHA-256 and the three toolchain lines: part 2's "Keep for the release record" (:281-284), part 3 step 7 (:304) and step 13 (:335). It never says to measure the size or make a second build. It also warns (:286) that the next `npm run package` overwrites a zip of the same version, without saying that the second build goes in a separate checkout. The records for 1.4.1 through 1.7.1 all made it that way: "in a separate checkout with its own target folder".

*Failure:* The 1.7.2 packager follows development.md, then writes the section releases.md asks for, and has no size or reproducibility check to put in it. Or they make the second build in the main tree, where `npm run package` overwrites release/seedelf-wallet-1.7.2-mainnet.zip, the zip they upload, as happened to 1.4.1's.

*Evidence:* docs/releases.md:24-32; docs/development.md:281-286, :304, :330 ("The zip is reproducible", with no step to show it) and :335, at 133d598b. docs/archive/roadmap.md:64, :76, :91, :118, :143 record the second builds as made apart. Checked by reading.

*Suggested fix:* In part 2, after the hash, add the size (`stat -c %s` on the zip). Add a second build of the same commit in a separate clone, with its own target and node_modules, compared by sha256. Then name the size and the second build's match in part 3 step 7 and step 13, or have both steps point at releases.md's list alone.

*Trace (partly, low):* The gap is real for the second build. It is overstated for the size, and the overwrite part of the failure scenario is wrong.

What holds:
- releases.md:30 (new in #356) asks each record for "its size" and "that a second build of the same commit gave the same bytes".
- development.md, which #356 edited to point at releases.md, never says to make that second build.
  - Part 2's block (:256-267) builds once, hashes and prints HEAD.
  - "Keep for the release record" (:281-284) lists only the C compiler line, the sha256 line and the Node/zlib line.
  - Step 8 (:330) says the zip "is reproducible" but has no step that shows it.
  - Part 3 step 7 (:304) and step 13 (:335) list the same subset. Step 13 even writes it as a gloss of releases.md's list ("a section that says what its *Recording a release* lists: the version, the commit…, the SHA-256, and the C compiler, Node and zlib lines"), so the three lists already disagree.
- Every packaged record from 1.4.0 to 1.7.1 says the second build was made apart. The procedure never had that step: development.md at f31758b0 lacks it too. #356 then made it something the record must state. So this is a missing release step, and a doc that misleads a developer: low.

What doesn't hold:
1. The size: "development.md's steps never produce" it is wrong. Part 2 runs `npm run package`, and package.mjs:124 prints `release/seedelf-wallet-<v>-mainnet.zip: N files, X KB` just before the sha256 line. The size is printed, rounded to KB. development.md just doesn't say to keep it, and past records gave exact bytes, which `stat` gives in one command. This half is a nit.
2. The overwrite scenario is mis-drawn. A second build of the same commit in the main tree writes the same bytes, because it reuses everything. wasm/build.sh:18 defaults the target to the workspace's `target/`, and :61's cargo build is incremental against it. So the zip being uploaded isn't damaged. 1.4.1's zip was overwritten by a feature branch's build (CI's store step run in the main tree), not by a rebuild of the same commit.

The real harm of a second build in the same tree is that the check is hollow. It re-zips cached WASM and the same node_modules, so a record saying "a second build gave the same bytes" would be true but prove nothing. That's why past records stress "its own target folder", and it's the reason the fix's "separate clone" wording matters.

Reach: the packager isn't entirely blind. Step 13 sends them to releases.md's list, and the record PR comes after the upload, so the second build can still be made then. But nothing says how to make it, or that it must not be made in the main tree.

*Trace's evidence:* Checked by reading, at 133d598b:
- docs/releases.md:3 points to development.md step 8 for reproducibility; :24-32 is *Recording a release*; :30 asks for the size and the second build.
- docs/development.md:
  - :256-267, part 2's block: one `npm run package`, then sha256sum and rev-parse.
  - :281-284, the "Keep for the release record" list: no size, no second build.
  - :286, the overwrite warning.
  - :304, part 3 step 7.
  - :329-330, step 8: "reproducible", with no step that checks it.
  - :335, step 13: a partial gloss of releases.md's list.
- `git diff f31758b0 133d598b -- docs/development.md`: #356 changed only the "roadmap's handoff notes" to releases.md references. The second-build step was never in the procedure.
- extension/scripts/package.mjs:124 prints `<zip>: N files, X KB`, then :125 sha256 and :126 Node/zlib. So a size is printed.
- wasm/build.sh:18 (`target="${CARGO_TARGET_DIR:-$workspace/target}"`) and :61 (an incremental `cargo build --locked`): a rebuild in the same tree reuses the cached WASM.
- extension/package.json: `package` = build:store, then package.mjs. It writes the same file name, `release/seedelf-wallet-<version>-mainnet.zip`.
- docs/archive/roadmap.md:
  - :64 (1.7.1) and :76 (1.7.0): "in a separate checkout with its own target folder".
  - :91 (1.6.0): "made apart in a separate clone".
  - :118 (1.5.0), :143 (1.4.1) and :144 (1.4.0): "made apart".
  - Exact byte sizes in each.
- `git grep` of the tree outside docs/archive for "second build|made apart|separate clone|separate checkout|same bytes": no procedure step anywhere, store/README.md included.
- Memory note package-overwrites-release-zips.md: 1.4.1's zip was overwritten by a feature branch's store step in the main tree, not by a rebuild of the same commit.
- Branch HEAD dd22e2b2 doesn't touch these docs.

No tests run: docs only, and the brief bars `npm run package`. Sandbox left clean.

*Trace's fix note:* The suggested fix is right in substance. The smallest correct form:

1. In development.md part 2, after `sha256sum`, add `stat -c %s "release/seedelf-wallet-$release_version-mainnet.zip"`. Name the size in "Keep for the release record".
2. Add a short block for the second build. It goes in a separate clone or worktree, never the main tree (:286). The block:
   - `git worktree add --detach <dir> "$(git rev-parse HEAD)"`;
   - `npm ci` in its `extension/`;
   - `CARGO_TARGET_DIR` unset. wasm/build.sh:18 would otherwise reuse the main tree's target, and the check would be hollow;
   - `npm run package`, then `sha256sum` compared with the first hash;
   - then `git worktree remove`.
3. Make part 3 step 7 and step 13 point at releases.md's *Recording a release* list alone, not restate a subset of it. The three lists already drift.

Drop the overwrite rationale from the finding: a same-commit rebuild in the main tree writes identical bytes. The real reason the second build must be made apart is that a rebuild in the same tree reuses cached artifacts. No test can pin a docs step; check the edit by reading part 2, step 7 and step 13 against releases.md:30.

### release5

**release#5 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/keys-and-accounts.md:134`

**keys-and-accounts.md still says the stake and DRep keys sign only for certificates, withdrawals and votes**

**Outcome: fixed.** As pr358#2.

*Claim:* keys-and-accounts.md:134 says "The stake key signs inside WebAssembly, only for a certificate or a withdrawal", and :139 says "The DRep key signs inside WebAssembly, only for a DRep certificate or a vote". Since #358, a site's transaction that spends a UTxO at the stake key's own address, or with governance the DRep key's, is signed by that key as the account's. architecture.md:562 now says so, which contradicts these lines. They were already incomplete before: signData (CIP-8 and CIP-95) and a site's required signers.

*Failure:* Someone uses keys-and-accounts.md to bound what the stake key can authorise and concludes it never spends a UTxO. Since #358, the wallet signs with it to spend a UTxO at enterprise(stake key hash) whenever a site's transaction includes one.

*Evidence:* docs/keys-and-accounts.md:134 and :139 at 133d598b. wasm/src/cip30.rs:475-483 (of_hash returns Stake or Drep), :1086 (owner, which uses of_hash since #358), :1133 (signers.insert), :1774-1789 (sign_tx signs with every signer, Role::Staking or Role::Drep). Checked by reading.

*Suggested fix:* Stake key: "for a certificate, a withdrawal, a site's required signer or message, and a site's spend of a UTxO at its own enterprise address (#358)". DRep key: "for a DRep certificate, a vote, a CIP-95 message, and, with governance, a UTxO at its own enterprise address".

*Verification:* nit: not verified

### release6

**release#6 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/architecture.md:568`

**architecture.md says a proposal is refused only when it's on the other network**

**Outcome: fixed.** architecture.md: a proposal is refused only where the ledger refuses it, the other network or a reward account that isn't a reward address.

*Claim:* architecture.md:568 says of a site's proposal: "It's never refused, only one on the other network, as the ledger refuses it." cip30.rs also refuses a proposal whose reward account is unreadable or isn't a reward address, which chunk 39's As built records: "Refused, besides the other network: a reward account that's no address, or no reward address, which the ledger can't decode either".

*Failure:* A site sends a proposal whose reward_account bytes are an enterprise address. inspectDappTx throws "A proposal's deposit doesn't go back to a reward address.", although architecture.md says only the other network is refused.

*Evidence:* docs/architecture.md:568 at 133d598b; wasm/src/cip30.rs:1539-1545 (unreadable reward account, and non-reward address refused) and :1546-1549 (other network); docs/archive/plans/chunk-39-proposal-deposit.md:63. Checked by reading.

*Suggested fix:* "It's refused only where the ledger refuses it: on the other network, or with a reward account that isn't a reward address."

*Verification:* nit: not verified

## Reviewer pr356 (docs)

### What it checked

Scripts are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/ (pr356-linkcheck.py, pr356-rewrites.py, pr356-codementions.py, pr356-ctx.py). I deleted the extracted trees afterwards. The main checkout was not touched.

1. Links: no breaks from #356. I wrote a link checker covering relative links, images, reference definitions, HTML href/src, and #anchors using GitHub's slug rules (Ruby \p{Word}, a -N suffix for repeated headings, setext headings, explicit ids). It also checks github.com/logical-mechanism/Seedelf-Wallet/{blob,tree,raw}/main and raw URLs against the tree. I tested it on a synthetic tree with seven planted breaks and it caught all seven. I ran it over every tracked .md file at four commits: f31758b0 (105 files, 1,256 links), 33959cfc = 6beb3cde^1 (107, 1,280), 6beb3cde (109, 1,330) and 133d598b (109, 1,332 links, 688 of them with anchors). It found 0 problems at all four, so the PR's claim of no new break holds.
   - Rewritten links: I lined up each touched file's links before and after #356, mapping the moved files back to their old paths. 1,147 links still reach the same target; 222 of those had their text rewritten for the moves. The 30 blocks whose target changed are deliberate redirects (O2, O9, L2, L7, X08, C07, C28, the Tor entry, the hardware proof, Declined). Each one lands on a backlog section that holds its item.
   - Absolute URLs: every one resolves at 133d598b. These are the privacy policy URL (Settings.tsx:83 and store/README.md:305), the store Homepage URL (store/README.md:100), SECURITY.md from the crate READMEs, and the release key URL in release.yml:286. There are no raw URLs. #356 touched nothing under src/, store/ or the policy.
   - Mentions of .md files in code (src, tests, scripts, Rust, CI): the same 9 are unresolved at f31758b0 and 133d598b, and none of them is from #356. The two activity.test.ts comments that name post-release-roadmap.md still resolve, in the archive.
   - No test or script reads a moved doc, so skipping the CI suite on a Markdown-only PR was safe.
2. Nothing lost: I checked every item in 6beb3cde^1's post-release-roadmap.md against backlog.md: the order, all of Owed O1–O10, Step 0, parity, the data layer, the UX pass, dApp additions, every line of Kept in mind, Not planned and open questions 1–5. Each one is in the backlog or recorded as done or dropped; a few sub-points are only in the archive (finding 5). The hardware proof matches word for word. The CIP-13 and notification-centre declines match the owner's dates. I then scanned roadmap.md's handoff notes with a script for open items and review IDs that appear in neither file. 23 IDs came up; all are fixed items except the three in finding 1.
3. releases.md: every row matches the archived notes and git. That covers the commit and SHA-256 for 1.0.0, 1.2.0–1.7.1, and the tags web-wallet/1.6.0, 1.7.0 and 1.7.1, which are lightweight tags on babb8e76, f375af62 and f31758b0. The PR ranges match the merge log. 52c15492..f375af62 leaves the wallet source unchanged. 'Step 8' points at the reproducibility step.
4. Both CLAUDE.md files, the web wallet README, development.md (lines 27, 167, 304, 335) and plans/README.md agree on where things go: plans in docs/plans/, finished plans in archive/plans/, open items in backlog.md, the record in releases.md, and the tag at upload.
5. The archives match the old files word for word except link targets and the new header. Spot-checks against the code at 133d598b all hold: MIX_FEE_ESTIMATE is 950_000; Cargo.lock has h2 0.4.11/0.3.26, spin 0.9.8 and crypto-bigint 0.5.5; seedelf-data has ctutils 0.4.3 and tokio 1.53.2; the token registry is 158 KB for 32 tokens; FEE_ROOM is 2 ₳; allow_multi_hops is false; Home does not poll balances; the leios-musashi branch exists. Read-only GitHub check: StricaHQ's projects/lovejoin.json still has only the five v1 entries and there has been no PR since #70. So 1.7.0's 5 ₳ pool entries were never sent. Part 1's registry block will propose them again at 1.7.2, so nothing is lost. But 1.7.1's record line 'No registry PR: no new pool' (#353's text, not #356's) gave the wrong reason: the 5 ₳ pool's entries were still unsent.

### pr3560

**pr356#0 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/backlog.md:9`

**backlog.md leaves out open items that only roadmap.md's handoff notes held**

**Outcome: fixed.** Three backlog lines: the critical-words gate (an owner's call), Node's CA store for the refreshes (pr327#0, an owner's call), and L13's Put in 5 ₳ to cancel.

*Claim:* backlog.md was built from the post-release roadmap alone. It says it lists 'the calls still open for the owner' and that a review that leaves something open adds a line (line 7). Three open items that only roadmap.md (and the 1.7.0 review record) carried are now in no live doc. (a) 1.7.0's owner's call that the critical-words gate checks key names, not values: 'a value hash beside each verified key would make the gate catch the next (an owner's call, after 1.7.0)' (archive/plans/review-1.7.0.md:101, and archive/roadmap.md:74: 'the critical-words gate reading values (*a hash beside each verified key, after 1.7.0*)'). (b) pr327#0, 'the release scripts under Node's own CA store' (archive/roadmap.md:74): npm run tokens, dreps and lovejoin-pools fetch Koios through Node's bundled roots, which still trust emSign ECC Root CA - G3. (c) L13: 'Put in 5 ₳ to cancel, which needs an order, is still unrun end to end: 1.5.0's last review, L13.' (archive/roadmap.md:125). (a) and (b) were open in 6beb3cde^1's roadmap.md 1.7.0 note. (c) was already missing from the post-release roadmap, so it predates #356.

*Failure:* In 1.7.2, #357–#359 changed critical-keys.json and verified-critical-{es,ja}.json. If a critical value is edited without being back-translated, i18n.test.ts still passes: verified-critical-es.json holds only {reviewer, keys[]}, and i18n.test.ts:197 reads key names. The only live reminder of that gap is gone. Likewise nothing in the live docs says the release refreshes run under Node v24.19.0's bundled roots. And whoever picks up the backlog won't learn that a found session's 'Put in 5 ₳ to cancel' (Swaps.tsx:3398, swaps.foot.putCollateral) has no e2e test: extension.spec.ts:779 covers only 'Put in 5 ₳ for Lovejoin'.

*Evidence:* Traced at 133d598b. I compared every open line of 6beb3cde^1's post-release-roadmap.md with backlog.md: all present. I then scripted a search for review IDs in roadmap.md's handoff notes that appear in neither file: 23 found, all fixed items except these. Each is still open: the verified-critical-*.json files have no value hash; nothing in the tree mentions use-openssl-ca, NODE_USE_SYSTEM_CA, emSign or a minimum Node; no e2e or Vitest test presses swaps.foot.putCollateral. Full text of pr327#0: git show e8b007f8:seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.0/FINDINGS.md (its outcome: owner-call).

*Suggested fix:* Under '## The owner's open calls' (after line 21) add: '- ❓ **The critical-words gate reads key names, not values** (1.7.0's release review, *Lessons*): a changed critical value passes CI with no back-translation. A value hash beside each verified key would catch it.' and '- ❓ **The release refreshes trust Node's bundled roots** (1.7.0's release review, pr327#0): `npm run tokens`, `dreps` and `lovejoin-pools` fetch Koios through a Node whose store still trusts emSign ECC Root CA - G3. Node 24.22.1 or later, or `NODE_OPTIONS=--use-openssl-ca`; whether development.md names a minimum Node is the owner's call.' Under '## Sessions and restore' add: '- ⬜ **Put in 5 ₳ to cancel has never run end to end** (1.5.0's last review, L13): the e2e fakes plant a found session with no order.' Docs only, no test.

*Verification:* docs PR: straight to the lead

### pr3561

**pr356#1 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/backlog.md:59`

**The backlog says Home's two-window watch is covered by one e2e case; the source says one would cover it**

**Outcome: fixed.** R3-20's line says one e2e case would cover it.

*Claim:* '⬜ **Home's two-window watch has no test** (R3-20): one e2e case covers it.' The source says 'One e2e case would cover it: the Collateral page open in a second window as its payment lands, then Home reading the balances again' (archive/post-release-roadmap.md:397). As written, the line reads as if a test already exists.

*Failure:* Someone choosing a test gap from the backlog reads 'one e2e case covers it', assumes R3-20 is covered, and skips it.

*Evidence:* Compared backlog.md:59 with archive/post-release-roadmap.md:397 at 133d598b.

*Suggested fix:* '- ⬜ **Home's two-window watch has no test** (R3-20): one e2e case would cover it, the Collateral page open in a second window as its payment lands.'

*Verification:* docs PR: straight to the lead

### pr3562

**pr356#2 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/archive/post-release-roadmap.md:3`

**The archived post-release roadmap's new header says everything in it was done**

**Outcome: fixed.** The archived post-release roadmap's header says most of it was done, and the rest went to the backlog.

*Claim:* The header #356 added says '**Archived on 2026-10-31, as it stood that day.** Everything it set out after v1 was done'. The same file's open rows contradict it: O2 🚧 (line 130), O4 ⛔ (132), O6 ⬜ (134), O9 ⬜ (137), and item 4 of The order, '🚧 The UX and UI pass' (line 26). backlog.md carries all five as open. The PR body's narrower wording ('parity, the public side, the data layer, the reviews') is accurate.

*Failure:* A reader of the archive takes O2, O4, O6 and O9 as finished, though the same sentence goes on to point at backlog.md.

*Evidence:* Read archive/post-release-roadmap.md:3, 26 and 130–137 at 133d598b.

*Suggested fix:* '**Archived on 2026-10-31, as it stood that day.** Its sequence was done (parity, the public side, the data layer, the reviews), and it had become three things at once: …', leaving the rest of the line as it is.

*Verification:* docs PR: straight to the lead

### pr3563

**pr356#3 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/releases.md:20`

**releases.md says only 1.0.0's full record is in roadmap-v1.md; 1.1.0's is there too**

**Outcome: fixed.** releases.md: 1.0.0's and 1.1.0's full records are in roadmap-v1.md.

*Claim:* 'The full record of each release up to 1.7.1 … is its handoff note in archive/roadmap.md, and 1.0.0's is in archive/roadmap-v1.md.' archive/roadmap.md:172 has only 1.1.0's one-line note ('Up to 2026-10-01 each is one line, with the full note in archive/roadmap-v1.md', line 49). 1.1.0's full note is at roadmap-v1.md:85.

*Failure:* Someone looking for 1.1.0's full record goes to archive/roadmap.md and finds only one line.

*Evidence:* Read archive/roadmap.md:49 and :172, and archive/roadmap-v1.md:85 and :91, at 133d598b.

*Suggested fix:* '…is its handoff note in [archive/roadmap.md](archive/roadmap.md#handoff-notes), and 1.0.0's and 1.1.0's are in full in [archive/roadmap-v1.md](archive/roadmap-v1.md).'

*Verification:* docs PR: straight to the lead

### pr3564

**pr356#4 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/backlog.md:122`

**The backlog's Leios line drops the signing prompt's unnamed Dijkstra field**

**Outcome: fixed.** The backlog's Leios line has the signing prompt's unnamed Dijkstra field.

*Claim:* 'What Leios would change in the wallet:' lists three of the four findings under that heading in archive/post-release-roadmap.md:424–430. It leaves out the only one about signing: 'a body field Dijkstra adds goes unnamed in the signing prompt, where Transaction details lists it as a field it can't name' (line 430).

*Failure:* When the Dijkstra work is picked up from the backlog, a sign window that silently skips a new body field isn't on the list.

*Evidence:* Compared backlog.md:122 with archive/post-release-roadmap.md:424–430 at 133d598b.

*Suggested fix:* End the line with: '; and a body field Dijkstra adds goes unnamed in the signing prompt.'

*Verification:* docs PR: straight to the lead

### pr3565

**pr356#5 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/releases.md:27`

**releases.md's list of what a record names leaves out the data layer's token decimals**

**Outcome: fixed.** releases.md's list names the data layer's token decimals.

*Claim:* '**The lists** each release refreshes: the tokens, the DReps, the Lovejoin pools' head start and their Cardanoscan names'. development.md step 2 also refreshes the data layer's decimals (seedelf-data/api/data/token-decimals.json), and that decides whether the API is deployed. Every handoff note up to 1.7.1 recorded it ('the API's token decimals unchanged').

*Failure:* 1.7.2's record, the first written from this list, doesn't say whether token-decimals.json changed, so the reason for deploying the API or not goes unrecorded.

*Evidence:* Read releases.md:27, development.md step 2's decimals sub-bullet, and archive/roadmap.md's 1.7.1 and 1.7.0 'Lists' lines (53, 69) at 133d598b.

*Suggested fix:* '- **The lists** each release refreshes: the tokens, the DReps, the Lovejoin pools' head start and their Cardanoscan names, and the data layer's token decimals; what changed, or that nothing did.'

*Verification:* docs PR: straight to the lead

### pr3566

**pr356#6 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/README.md:29`

**plans/README.md says release.yml ships CLI binaries off any tag without a slash**

**Outcome: fixed.** plans/README.md states release.yml's `*.*.*` glob.

*Claim:* 'The slash matters: release.yml ships signed CLI binaries off any tag without one.' release.yml:3-6 fires only on tags matching "*.*.*". The root CLAUDE.md states the rule precisely.

*Failure:* A reader assumes a slashless tag such as `v1` would publish CLI binaries, or takes the rule to be broader than the glob.

*Evidence:* Read .github/workflows/release.yml:1-6 and CLAUDE.md:100 at 133d598b.

*Suggested fix:* '…ships signed CLI binaries off any `x.y.z` tag without one.'

*Verification:* docs PR: straight to the lead

## Reviewer pr354 (docs)

### What it checked

Read PR #354 (both commits and the body), the plan at 133d598b, #356's edits to it (git diff d9fe9db8 133d598b), #354's lines in docs/archive/post-release-roadmap.md (50, 81-82, 478), backlog.md, plans/README.md, and README.md:59-61.

Links: a script resolved all 19 relative links and anchors in the plan, plus the archive's two links to it. All resolve (script: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/pr354-scripts/links.py). I sent HEAD requests to the external source links: 4 answered 200 and the rest 429 (rate-limited), so that check is inconclusive and I didn't retry.

True at 133d598b:
- architecture.md's quotes and anchors (#shape:23, #ui:499, #what-we-borrow-from-lace:756-758);
- the CSP has 'wasm-unsafe-eval' and no 'unsafe-eval' (manifest.ts:101), and our wasm glue has no Function( fallback;
- keys-and-accounts.md's "One phrase, two key trees";
- derivation.rs is HKDF over the BIP-39 seed with its own salt, and cardano.rs is Icarus from the entropy;
- mainnet NIGHT is in the bundled list (tokens/list.json:42) with the plan's policy;
- 1.7.1's zip is 2,097,426 bytes;
- the screen names (Remove wallet, Private/Public, Make private/public, Receive);
- the connector is off until turned on;
- chunk 26's parts each had their own branch and a PR into main (#289-#293);
- Lovejoin's templates are pinned Plutus V3;
- web-wallet/midnight exists;
- the mainnet DUST script's bech32 decodes (header 0x71) to the plan's hash.

Lace claims, checked against seedelf-platform/_reference/lace at e431933 (manifest 2.4.2) and the local lace-extension@2.5.0 tag, all match:
- the package paths, the SDK pins and entry points;
- HDWallet.fromSeed, then selectAccount/selectRole/deriveKeyAt for Zswap, Dust and NightExternal, each key sealed under the password;
- the Blockfrost proxy URLs as feature flags, and blockfrost-config.ts's LW-14499 note;
- localhost:6300 on every network, and the missing-proof-server banner;
- 2.5.0's offscreen WORKERS prover and its TEE flag;
- the byte-equivalence README;
- the datum, the redeemers, the 1,586,080 floor, the enterprise address and the empty NFT name;
- the connector's API names, the mn_ prefixes, and the shared testnet cNIGHT policy.

Owner's calls: the plan proposes no guard (line 155), keeps private defaults and one-line notes, follows the names rule, dates none of our releases, and puts no real-money test on the owner (38a uses Ogmios evaluation).

No Midnight fact is asserted from memory. Midnight items are flagged only where Lace's code on disk or this repository differs.

Everything was read-only (git show/grep/log/diff, gh pr view). No sandbox, no tests: docs only.

### pr3540

**pr354#0 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:153`

**Plan says the private balance's NIGHT can't generate DUST, but the contract's staked-form UTxOs can**

**Outcome: fixed.** The plan says older Seedelf UTxOs can sit at a staked form, and 38a counts the NIGHT there.

*Claim:* Line 153 says a Seedelf UTxO sits at the contract's address with no stake part (citing wallet_contract), so its NIGHT generates no DUST and no one else can claim DUST from it. That holds only for outputs made since CLI 0.5.0.

- wallet_contract builds the enterprise form for new outputs, but its own doc comment says existing UTxOs sit at the older staked base form.
- Before 2c67e94c (2026-05-19; CLI 0.4.10 and earlier), it paid script + MAINNET_STAKE_HASH, the [LOGIC] pool's stake key.
- The validator never reads the stake part, so any payer can attach one.
- The wallet reads the private side by payment credential, so all of these count in the private balance.

By the plan's own line 25 (the observer credits each cNIGHT UTxO at an address with the registered stake credential), NIGHT in such a UTxO generates DUST for whoever registers that stake key. That is never the Seedelf's owner. The plan would also put this false line on screen ("The wallet says so where it matters"). It is load-bearing for 38b's privacy line.

*Failure:* A private balance holds NIGHT in a Seedelf UTxO at addr(wallet script, stake fcfc7701…ebf1), made by a CLI 0.4.x fund. It shows in the private balance, because credential_utxos is read by the script's payment credential. The holder of stake key fcfc7701… registers it under the cNIGHT script, and that NIGHT generates DUST for them. A 38b screen written from line 153 tells the user their private NIGHT generates DUST for no one.

*Evidence:* - seedelf-core/src/address.rs:67-72: "existing UTxOs at the older staked base form remain spendable".
- Commit 2c67e94c removed ShelleyDelegationPart::Key(MAINNET_STAKE_HASH); `git tag --no-contains` lists 0.4.10 and earlier.
- constants.rs:73-77: "support the [LOGIC] stakepool".
- seedelf-data/README.md:334 ("The contract has outputs in both enterprise and staked form") and :340 (every query starts from the credential's outputs).
- extension/src/background/koios.ts:789-790: credential_utxos by _payment_credentials.

Traced by reading. I didn't query chain data for NIGHT held at the staked form today.

*Suggested fix:* Reword line 153:
- New Seedelf outputs (enterprise: CLI 0.5.0 on, and every web wallet build) generate no DUST for anyone.
- Outputs at a staked form generate DUST for that stake key's holder, never the Seedelf's owner. CLI 0.4.10 and earlier paid MAINNET_STAKE_HASH's, and any payer can pick one.

Add to 38a: count the mainnet NIGHT held at staked-form contract UTxOs before 38b's screen line is written. That line is a disclosure, not a guard. Docs only; no test.

*Verification:* docs PR: straight to the lead

### pr3541

**pr354#1 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:189`

**38b's "whether it's generating" would count NIGHT the registration can't credit**

**Outcome: fixed.** 38b's screen counts each UTxO by its stake part.

*Claim:* Line 134 offers Generate DUST "for the NIGHT it holds", and 38b's screen (line 189) shows the public account's NIGHT and "whether it's generating". But the public account holds every UTxO under its payment keys, whatever the stake part (account.ts:1-4): its enterprise address, or its key paired with someone else's stake key.

By the plan's own line 25:
- NIGHT at an address with no stake part generates nothing;
- NIGHT under a stranger's stake key generates for that stranger's registration.

The plan doesn't say the screen must count per UTxO by stake part. Built as written, it would show NIGHT as generating when it isn't: the payment-key/stake-key confusion that #358 and #359 just fixed elsewhere.

*Failure:* The account holds 1,000 NIGHT at base(own pay, own stake), and 500 NIGHT at its enterprise address or at base(own pay, stranger stake). After Register, a screen built from lines 134 and 189 says 1,500 NIGHT is generating. Only 1,000 is, and a stranger's registration may be collecting from the other 500.

*Evidence:* extension/src/background/account.ts:1-4 at 133d598b ("whatever the address's staking part … our key paired with someone else's stake key"), and plan lines 25, 134, 182 and 189. Traced by reading. That the observer credits by stake credential is the plan's own sourced claim; I didn't check it.

*Suggested fix:* Say in 38b that only NIGHT at an address carrying the registered stake key generates DUST. The screen counts per UTxO and says what doesn't generate. Register could also spend every cNIGHT UTxO back to the account's own base address, as Lace's builder does (see the rotation finding). Docs only; no test.

*Verification:* docs PR: straight to the lead

### pr3542

**pr354#2 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:219`

**Call 2's 40–45 GB assumes home's db-sync can feed a Midnight node; by the plan's own list it can't**

**Outcome: fixed.** Call 2 says the node needs a db-sync of its own, and prices it.

*Claim:* Line 214 lists what the Midnight node needs from db-sync: 13.7.1.0, tx_in filled, the ledger state on, and no address table. Line 219 then costs only the node and the indexer (about 40–45 GB) beside home's existing db-sync, and line 217 has the node's first sync load "db-sync". So the plan assumes home's db-sync.

Home's db-sync doesn't meet that list:
- It runs tx_out.value "consumed" with use_address_table: true.
- Its options file says the API's SQL relies on both, and that they "can only be set on an empty database".
- It ran 13.7.0.1 when chunk 26 checked it.

So the "Later" option needs a second mainnet db-sync and Postgres, replayed from empty. By chunk 26's measure that's up to about 21 GB more RAM (2–3 GB with ledger_backend "lsm"), plus its disk and days of replay. None of it is counted.

*Failure:* The owner weighs call 2 against "about 40–45 GB more RAM". Built that way, the Midnight node can't follow home's db-sync: the address table is on, and it's 13.7.0.1. Switching home's options means a replay from empty, which breaks the API's SQL (public/account.rs:535 reads `from address a`).

*Evidence:* - seedelf-data/deploy/home/db-sync-insert-options.json:2-7.
- seedelf-data/api/src/public/account.rs:535-537 reads the address table; chain.rs:110-148 reads consumed_by_tx_id.
- docs/archive/plans/chunk-26-data-layer.md:330 (13.7.0.1, checked 2026-10-08) and :340 (about 21 GB for db-sync).

Traced by reading. Whether "consumed" leaves tx_in empty is unverified. The address-table mismatch alone rules out reuse, by the plan's own list.

*Suggested fix:* Line 219: the node needs a db-sync of its own, because home's runs the address table and "consumed", which the API relies on and only an empty database can change. That's about 40–45 GB for the node and indexer, plus up to about 21 GB, a Postgres and a replay for that db-sync. 38a prices it. The Blockfrost-first recommendation only gets stronger. Docs only; no test.

*Verification:* docs PR: straight to the lead

### pr3543

**pr354#3 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:187`

**38b says Pallas can't stage a mint redeemer; core already does it, through Pallas**

**Outcome: fixed.** 38b builds Register beside `build::account_mint`; only Change's zero withdrawal needs `withdraw_zero.rs`.

*Claim:* Line 187 says "Pallas can't stage the withdrawal or the mint's redeemer, and staking.rs and withdraw_zero.rs already patch both." The mint half is false:
- pallas-txbuilder 0.35.1 (the lockfile's) has RedeemerPurpose::Mint, and core uses it today: the Seedelf mint, account_mint, and Lovejoin's launch.
- Neither file patches a mint redeemer. withdraw_zero.rs patches a withdrawal and its Reward redeemer; staking.rs patches certificates and key withdrawals.
- build::account_staking pays nobody and mints nothing.

The nearer precedent for Register is build::account_mint: an account-paid Plutus V3 mint with the account's collateral, with the staking patch riding along.

*Failure:* A developer building 38b looks for, or writes, a mint-redeemer patch that isn't needed, and models Register on a builder that has no outputs and no mint.

*Evidence:* - ~/.cargo/registry/src/index.crates.io-*/pallas-txbuilder-0.35.1/src/transaction/model.rs:551-556: Spend(Input) and Mint(PolicyId), with Reward and Cert left as TODO.
- seedelf-core/src/build.rs:2236-2240 and 3780-3781 (add_mint_redeemer), and 3866 (account_mint).
- lovejoin/launch.rs:534.
- withdraw_zero.rs:6-11 and staking.rs:4-5.
- build.rs:813: account_staking is "nothing paid to anyone".

Read.

*Suggested fix:* Line 187: Register is built in core beside build::account_mint, where Pallas stages the mint and its redeemer. Change's zero withdrawal and its Reward redeemer, which Pallas can't stage, are withdraw_zero.rs's patch, as Lovejoin's mixes use it. The stake key signs as it does in staking. Docs only; no test.

*Verification:* docs PR: straight to the lead

### pr3544

**pr354#4 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:210`

**Call 1's "nothing of Midnight's loads or derives until turned on" contradicts 38b needing no switch**

**Outcome: fixed.** Call 1 and line 85 make Generate DUST the one exception to "nothing loads until turned on".

*Claim:* Call 1 recommends that until Midnight is turned on, "nothing of Midnight's loads, derives or phones home" (line 209), and line 85 says its code loads "only once Midnight is turned on". But:
- line 210 says Generate DUST "needs no switch", and call 5 puts it in 1.8.0;
- 38b derives the Midnight keys and the DUST address from the phrase, and "the DUST key may need the ledger's WebAssembly" (line 178).

So the recommended 1.8.0 breaks call 1's recommendation in its first release, and the owner is asked to decide call 1 on a promise 38b can't keep.

*Failure:* A user who never turns Midnight on presses Generate DUST in 1.8.0. The worker derives the DUST key, and perhaps loads the roughly 10 MB ledger chunk: what call 1 and line 85 say never happens before the switch.

*Evidence:* Plan lines 85, 178, 209-210 and 229-231. Read; the contradiction is internal to the plan.

*Suggested fix:* Call 1: off until turned on, except Generate DUST, which derives the DUST key (and loads whatever computes it, as 38a decides) when it's pressed. Or Generate DUST turns Midnight on. Make line 85 match. Docs only; no test.

*Verification:* docs PR: straight to the lead

### pr3545

**pr354#5 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:182`

**Unverified: 38b's cNIGHT input rules differ from Lace's builder, the plan's own source**

**Outcome: fixed.** 38b's cNIGHT input rule is marked unverified, against Lace's builder, for 38a to read the validator.

*Claim:* 38b says Register spends "at least one cNIGHT UTxO" (line 182), and that Change and Stop spend only the registration (lines 184-185).

Lace's designation builder, which the plan follows, does otherwise:
- it refuses with no cNIGHT before it even picks the action;
- it forces every cNIGHT UTxO the account holds as an input on register, update and deregister alike;
- it calls this the validator's list.any(inputs, …) "rotation" scan.

Which of the validator's purposes scan the inputs, and whether all cNIGHT UTxOs must be spent, is a Midnight contract fact this review can't check. The plan states its own rule as settled.

*Failure:* If the scan applies to the spend and the burn, Change and Stop built to the plan fail. A user who has since sold or moved all their NIGHT then can't Stop, so the 1.58608 ₳ "comes back on Stop" (line 181) only while they still hold some.

*Evidence:* _reference/lace at e431933:
- packages/lib/cnight-dust-designation/src/builders/build-night-designation-tx.ts:88-92, 138-143, 169, 209 and 243;
- src/builders/types.ts:42;
- packages/module/blockchain-cardano/src/store/night-designation/build-night-designation-tx.ts:42 and 130.

Read. I didn't read the validator itself, so this is unverified.

*Suggested fix:* Mark lines 180-185's input rules unverified. Add to 38a: read cnight_generates_dust.ak for which purposes scan the inputs and whether every cNIGHT UTxO must go in. Say on Stop's line whether NIGHT must still be held. Docs only; no test.

*Verification:* docs PR: straight to the lead

### pr3546

**pr354#6 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:163`

**38a's precedent is wrong: the Tor spike's branch was merged**

**Outcome: fixed.** The unmerged branch precedent is the Leios run's.

*Claim:* Line 163 says 38a runs "on a branch that may stay unmerged, as the Tor spike's did". web-wallet/tor-spike was merged as #326 (2026-10-27, 5abd5470), carrying only its write-up. The branch that stays unmerged is the Leios run's, web-wallet/leios-musashi (backlog.md:119).

*Failure:* A reader looks for an unmerged tor-spike branch holding the spike's work, and there isn't one.

*Evidence:* - `gh pr view 326`: headRefName web-wallet/tor-spike, MERGED.
- docs/archive/post-release-roadmap.md:342: the spike "committed only this entry".
- backlog.md:119.
- `git branch -a` lists web-wallet/leios-musashi.

Read.

*Suggested fix:* "…as the Leios run's (web-wallet/leios-musashi) does." Docs only.

*Verification:* docs PR: straight to the lead

### pr3547

**pr354#7 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:172`

**probe-staking.mjs doesn't use additionalUtxo; probe-governance.mjs does**

**Outcome: fixed.** probe-governance.mjs is the additionalUtxo precedent.

*Claim:* Line 172 says Generate DUST is "checked with Ogmios's additionalUtxo, spending nothing, as tests/fixtures/probe-staking.mjs does for staking". probe-staking.mjs evaluates against the test account's live UTxOs and has no additionalUtxo at all. The made-up-input precedent is probe-governance.mjs, which hands Ogmios a 600 tADA input the account doesn't hold. That's what 38a needs if the test account holds no testnet cNIGHT.

*Failure:* 38a's author copies probe-staking.mjs and finds no way to supply a cNIGHT input the account doesn't have.

*Evidence:* - extension/tests/fixtures/probe-staking.mjs:1-10: live UTxOs, and `git grep -c additionalUtxo` finds none.
- probe-governance.mjs:11-13 and 53-57.

Read.

*Suggested fix:* "…as tests/fixtures/probe-governance.mjs does for a DRep's deposit." Docs only.

*Verification:* docs PR: straight to the lead

### pr3548

**pr354#8 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:224`

**"No Cardano preview" cites a section that never says it**

**Outcome: fixed.** The no-preview line links the backlog's Declined.

*Claim:* Line 224 says "The wallet still has no Cardano preview" and links to the archived roadmap's parity section. That file never mentions preview, and neither did the live roadmap when #354 wrote the link (#356 only moved its target). The only doc that says it is backlog.md's Declined (line 132: "there's no preview network here"). architecture.md#networks lists only mainnet and preprod.

*Failure:* A reader follows the link to check the claim and finds nothing about it.

*Evidence:* - No "preview" in docs/archive/post-release-roadmap.md at 133d598b, nor in docs/post-release-roadmap.md at d9fe9db8 (grep).
- backlog.md:132.
- architecture.md:216-220.
- The link checker shows the anchor itself resolves.

*Suggested fix:* Link [backlog.md's Declined](../backlog.md#declined) or [architecture.md](../architecture.md#networks). Docs only.

*Verification:* docs PR: straight to the lead

### pr3549

**pr354#9 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:227`

**Call 4's "Never a remote prover" reads as a guard, while Settings already lets a user name the prover**

**Outcome: fixed.** Call 4: never a prover of ours, never a remote one by default; one the user names is theirs.

*Claim:* Line 227 recommends "Never a remote prover", while line 133 puts in Settings "where its indexer, node and proof server are". A proof server the user names on another machine is a remote prover. Read as a refusal, "never" is a guard the ledger doesn't impose, which goes against the owner's standing rule: refuse only what the ledger refuses, and default never means only (privacy.md:7). What the plan supports is "never ours, never the default" (line 113: "We never offer a prover of ours").

*Failure:* 38d validates the Settings field as localhost only, and refuses a user's own proof server on their LAN.

*Evidence:* Plan lines 113, 133 and 226-228; the brief's standing calls; docs/privacy.md:7. Read.

*Suggested fix:* Line 227: "Never ours, never the default. A proof server the user names elsewhere gets a one-line note that it sees the keys." Docs only.

*Verification:* docs PR: straight to the lead

### pr35410

**pr354#10 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:35`

**"The ledger keeps the hyphen" doesn't fit ledger 9's package in Lace's own pins**

**Outcome: fixed.** Ledger 9's scope in Lace's pins, for 38a to check.

*Claim:* Line 35 says the wallet SDK moved to @midnightntwrk, while "the ledger and the connector keep the hyphen". Lace pins ledger 8 as @midnight-ntwrk/ledger-v8, but ledger 9 as @midnightntwrk/ledger-v9 (1.0.0-rc.3 at e431933, rc.5 at 2.5.0). Call 6 moves to the SDK line that carries ledger 9.

*Failure:* Whoever adds ledger 9 for call 6 looks for @midnight-ntwrk/ledger-v9. Which scope its release takes is unverified.

*Evidence:* _reference/lace at e431933: packages/module/passport-account/package.json:25 and package.json:136; `git grep` at lace-extension@2.5.0. Read; npm not checked.

*Suggested fix:* "Ledger 8 and the connector keep the hyphen. Lace pins ledger 9's release candidate as @midnightntwrk/ledger-v9." Mark it for 38a. Docs only.

*Verification:* docs PR: straight to the lead

### pr35411

**pr354#11 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:123`

**Line 123's new host permission must be optional, or line 85's promise breaks at the update**

**Outcome: fixed.** The proving keys' host permission is optional, asked when Midnight is turned on.

*Claim:* Line 123 says fetching the proving keys from srs.midnight.network needs a host permission. Line 85 promises that a wallet that never turns Midnight on "runs as it does now".

Today the manifest's install-time host permissions are only the build's own services (serviceHosts). Sites are optional (DAPP_ORIGINS, including https://*/*), asked for when the connector is turned on. If the 38d step that adds the first proof puts srs.midnight.network in host_permissions, Chrome disables the updated extension for every user until they accept the new warning. The permission needs to be optional, asked for when Midnight is turned on.

*Failure:* A 1.8.x release ships with https://srs.midnight.network/* in host_permissions. Every user, Midnight on or not, finds the wallet disabled after the update until they accept "Read and change your data on srs.midnight.network".

*Evidence:* extension/src/manifest.ts:87 and 91; extension/src/shared/dapp.ts:15; plan lines 85 and 123. Chrome's update behaviour is from its documentation and wasn't tested here (unverified).

*Suggested fix:* Line 123: "an optional host permission (inside the declared https://*/*), asked for when Midnight is turned on, never an install-time one". Docs only.

*Verification:* docs PR: straight to the lead

## Reviewer pr355 (docs)

### What it checked

Scope: #355's plan (now docs/archive/plans/chunk-39-proposal-deposit.md) and its roadmap line (now docs/archive/post-release-roadmap.md:48), at 133d598b. Read-only, with no sandbox. The main checkout was not touched.

1. As built against #357 (ce53ba62) and the code: every claim matches.
- WebAssembly: `Proposal` is at cip30.rs:817. It is filled in `fn inspect` at cip30.rs:1538, which also refuses the other network, an account that is no address, and one that is no reward address. It adds no signer and no staking money, and `tied` (cip30.rs:1648) is unchanged. `action_kind` at decode.rs:1170 is the one match for the names.
- Sign window: `proposalLine` is at ui/dapp.ts:213, its keys are `.warn.`, and the count keys are gone. `proposalWords` is at format.ts:442, and its seven names are in SHARED_WORDS. The tone is set at DappApprovals.tsx:1146.
- Worker and Transaction details: the ties and `certified` are at background/dapp.ts:2303/2324. `markYours` and `stakeKey` are at tx-view.ts:206/247. TxDetail has its own "Deposit back to" line, and rpc.ts has `yours`.
- Translations: es and ja match `verified-critical-*.json`.
- Tests: every one named exists and asserts what the plan says.
- Every promise in the plan was built, or recorded as changed: the "stake key of" wording, the extra refusals, the tone, and three proposals in one transaction instead of two.

2. Facts.
- Hash: I computed blake2b-256 of the fixture's body CBOR offline, and it equals its `tx_hash`. A Koios GET (`account_txs`) puts 8751ca96…f1c846…99a8 in preprod block 5354141, epoch 322. The typo is one character (index 34, b→c). At 133d598b it appears only in the plan's own note. The fixture, cip30_test (which asserts the summary's hash equals the fixture's), the dapp tests, #357's body and memory are all right.
- The fixture's Koios reading matches its CBOR: the return address encodes e04415d4…, the payer's stake address is the input's stake part, the action is InfoAction (6), the deposit is 1e9, and the value balances.
- Deposit: Koios gives mainnet 100,000 ₳ (epoch 665), as the plan says, and preprod 1,000 ₳ (epoch 323), as the fixture and tests use.
- The plan has no file:line references. I checked every identifier against f31758b0 and 133d598b; only one is misplaced (finding 2).

3. Links. A script checked every relative link and #anchor in all 109 .md files at 133d598b, and all resolve. I sanity-tested the script on broken cases. Nothing still links the old path docs/plans/chunk-39.

Set aside, not raised:
- #357's body says nothing new is refused but the other network. The code also refuses an unreadable account and a non-reward account; As built records both.
- "Straight to the archive, as chunks 36 and 37's did": 37's plan moved inside its own build PR, #311.
- The plan's release cycle leaves out the list refreshes. The lead is doing those.
- "Comes back when the action ends" assumes the stake key is still registered then. Unverified, and it would only happen through the user's own later deregistration.

Outside my scope, for #357's reviewer: no test pins the warn tone for a proposal back to another of the wallet's keys. By reading, the mutant `!p.own && p.yours === undefined` would survive. Unverified: I had no sandbox to run it.

Scratch files are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r172-pr355-scripts/ (txhash.py, links.py, bech.py).

### pr3550

**pr355#0 · low · docs** · `seedelf-platform/seedelf-web-wallet/docs/backlog.md:9`

**Chunk 39's open call for the owner has no line in backlog.md**

**Outcome: fixed.** As release#2.

*Claim:* This doesn't question the owner's call. The question is where the call is written down. Chunk 39 left one call open for the owner. The archived plan's As built (archive/plans/chunk-39-proposal-deposit.md:65) says "Unchanged here; the owner's call", #357's body has a "Your call" section for it, and memory has it as open. The call: a stranger's certificate on its own still leaves the staking callout informational (DappApprovals.tsx:1146). backlog.md's "The owner's open calls" (lines 9-20) has no line for it. plans/README.md:22 says what a chunk leaves open goes into backlog.md, and backlog.md:7 says the same.

*Failure:* The owner or a later session reads backlog.md for the calls still waiting on the owner, which is its stated job (line 3), and doesn't find this one. Once #357's thread is closed, the call survives only in an archived plan, which the archive README calls "a record, not maintained". So the call is never made.

*Evidence:* At 133d598b, reading only: no line in backlog.md mentions a certificate, a tone or the callout for this; checked against plans/README.md:22, backlog.md:7 and the plan's line 65. #357 changed nothing in backlog.md (git diff 6beb3cde 133d598b is empty).

*Suggested fix:* Add one line under "The owner's open calls": "❓ **A stranger's certificate alone leaves a site's staking callout informational** (chunk 39's As built): a proposal whose deposit isn't the account's own makes it a warning, and the plan had said a stranger's certificate did too." If the owner settles it at this gate instead, nothing is needed; the As built could say what was decided. No test applies.

*Verification:* docs PR: straight to the lead

### pr3551

**pr355#1 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-39-proposal-deposit.md:19`

**The plan puts inspect_dapp_tx in cip30.rs, but it is lib.rs's export**

**Outcome: left.** The archive is a record, not maintained; its As built names `TxSummary.proposals` rightly.

*Claim:* Line 19 reads "`wasm/src/cip30.rs` `inspect_dapp_tx`: `proposals: usize` becomes a `Vec<Proposal>`". cip30.rs has no `inspect_dapp_tx`. That function is lib.rs's wasm-bindgen export (`inspectDappTx`, lib.rs:6470, and 6441 at f31758b0), a two-line wrapper over cip30.rs's `inspect_tx` (cip30.rs:1739). The field that changed is `TxSummary.proposals` (cip30.rs:895), filled in `fn inspect` (cip30.rs:1538). The As built (line 63) names `TxSummary.proposals` correctly.

*Failure:* A developer following the plan searches cip30.rs for `inspect_dapp_tx` and finds nothing.

*Evidence:* git grep of inspect_dapp_tx, inspect_tx and 'proposals: usize' at f31758b0 and 133d598b; read.

*Suggested fix:* Optional, since the archive is a record and isn't maintained: change it to "`wasm/src/cip30.rs` `TxSummary` (what `lib.rs`'s `inspect_dapp_tx` returns)".

*Verification:* docs PR: straight to the lead

### pr3552

**pr355#2 · nit · docs** · `seedelf-platform/seedelf-web-wallet/docs/archive/post-release-roadmap.md:48`

**The archived roadmap still marks the built chunk 39 as not started**

**Outcome: left.** The archive stands as it was on 2026-10-31, and its link says where the plan is.

*Claim:* The 1.7.2 line still reads "⬜ Chunk 39" (not started). It links to the archived plan, whose status is "✅ built 2026-10-31". #357 rewrote this line's link after the build but left the mark, while the file's own rule (line 11) is "Tick it here and link its plan". The rest of the line is true: the count, the address shown only in Transaction details, out of the bounty's scope, and what the patch does.

*Failure:* Someone reading the archived order sees chunk 39 as not started, while its link text, "archive/plans/…", says it is done.

*Evidence:* Lines 3, 11 and 48 at 133d598b; #357's diff of line 48 changes only the link.

*Suggested fix:* Change it to "✅ Chunk 39". Or leave it as it is under the banner "Archived on 2026-10-31, as it stood that day".

*Verification:* docs PR: straight to the lead

## Reviewer pr353 (docs)

### What it checked

I found nothing wrong in PR #353's line (in docs/archive/roadmap.md since #356) or in the 1.7.1 row of releases.md. Every fact I could check holds. This was read-only work: I used no sandbox and wrote no scratch files.

**Line and row**
- **The commit:** f31758b0 is "Merge pull request #352 from web-wallet/review-1.7.1", with parents 4c06171a and 78642cb4.
- **The tag:** `git rev-parse 'web-wallet/1.7.1^{commit}'` gives f31758b0. It is a lightweight tag, and `git ls-remote` shows it on origin at the same commit.
- **The zip:** `extension/release/seedelf-wallet-1.7.1-mainnet.zip` is on disk.
  - `sha256sum` gives 38006fda7ecde3939cae4fe7d92cda1b6fda9ac3ebdfc2163d064853c6c3989a.
  - It is 2,097,426 bytes and holds 24 files; the manifest version is 1.7.1.
  - It contains #352's ja fix, `dappUi.validFrom` = 有効開始日時. At 4c06171a that key was 有効開始, and the 1.7.0 zip doesn't have it. So the zip was built after #352's fixes.
  - Its mtime is 11:33 -0700 on Oct 30: after f31758b0 was committed (11:26:21) and before #353 merged (11:54:23).
  - For reference, the 1.7.0 and 1.6.0 zips on disk also hash to their rows (7a860ca5…, 6d1219aa…).
- **Toolchain:** Node 24.19.0, zlib 1.3.2.1-motley-3246f1b and "Ubuntu clang version 21.1.8 (6ubuntu1)". These match 1.7.0's archived note and the host today.
  - Between f375af62 and f31758b0, rust-toolchain.toml did not change. Cargo.lock's only change is the four workspace crates going from 0.6.0 to 0.6.1 (#346).
- **No API deploy:** nothing under seedelf-data/ or src/tokens/list.json changed from f375af62 to f31758b0, nor from f31758b0 to 133d598b. The newest data-layer deploy run is 2026-10-29T16:41Z on f375af62.
- **e2e:** e2e/extension.spec.ts has 104 tests at f31758b0, matching "(104)". data-layer.spec.ts has 3.
- **Head start:** 3 preprod pools and 1 mainnet, unchanged; only preprod's height moved. That supports "no new pool, no registry PR".
- **"Not in it: checklist item 9":** step 9 of development.md at f31758b0 sends the store build through the preprod checklist's item 9, a hand check that it opens on mainnet and the network switch works both ways. Only the owner can do that, so the claim fits.
- **PRs carried:** #350 removed the Koios check of a listed pool, #351 added the sign window's expiry, and #352 is the review. #345 to #349 came before the release branch.
  - They are docs, media and the CLI. #346 only bumped the workspace version: no shared crate or wasm code changed, and the wallet never shows that version.
  - That matches what the review record says.
- **Review record:** `docs/archive/plans/review-1.7.1.md` agrees with the 1.7.1 note on every point checked: six reviewers over #345–#351, 33 findings coming down to 25 issues, the one medium in `media/` left as posted, and the fixes listed.
  - Its links to `../post-release-roadmap.md` and `../roadmap.md` resolve at 133d598b.
- **The move:** #353's line came through #356's move to the archive byte for byte.

**Not verifiable**
- **The second build:** I couldn't confirm that a second build gave the same bytes, because no second checkout is left on disk.
- **The tag's push time:** the GitHub events API shows no tag-creation event, so I can't confirm the tag was pushed before #353 merged. The tag is on origin now, so this doesn't matter. Neither point is a finding.

**Outside #353's scope, for the lead**
- Two data-layer deploy runs are recorded nowhere in the docs: 40713719454 (2026-10-28, 641f751c = #328) and 40914111080 (2026-10-29T16:41Z, f375af62).
- The second one ran its build and VPS deploy steps successfully, about five minutes after the 1.7.0 zip was built. Yet 1.7.0's archived note (from #345) says "Done that way: … and no API deploy".
- This doesn't touch 1.7.1's or 1.7.2's records. The production API runs f375af62's seedelf-data, which is the same as at 133d598b, so by development.md step 7, 1.7.2 needs no deploy either.

## Reviewer critic (cross)

### What it checked

Gaps I looked into. Everything below came out clean unless it's one of the two findings.

Files no review named:
- sessions.ts: refuseOddities' `s.proposals.length` is right; the old `|| s.proposals` would now be always true.
- swap-page-words.test.ts, dapp-ties-accounts.test.ts and i18n-critical-helpers.test.ts.
- The root and seedelf-platform CLAUDE.md, the wallet README, archive/plans/README.md, plans/README.md, development.md's diff, RELEASE.md and SECURITY.md.
- backlog.md's hardware-wallet proof, checked against derivation.rs's salt, info string and mod r.
- releases.md: I hashed every zip on disk. 1.0.0 and 1.2.0 through 1.7.1 match their rows. 1.1.0's "the owner has it" matches roadmap-v1.md's note, which records no hash. Every commit in the table is the merge it names.
- Live docs, scripts and code: no stale mention of roadmap.md, post-release-roadmap.md or "handoff note" except history citations.

The proposals type change (a number, now an array):
- Nothing persisted reads it. `remember` and `siteSigned` keep outpoints only, and session storage is cleared on update.
- No wasm Node test or e2e reads it, and no TypeScript fixture still sets it to a number.

The PR bodies' test counts:
- #358's 251 holds: 253 #[test] at 70dcd81c, less 2 ignored.
- #359's 59 Node tests holds, and its 2,963 → 2,968 Vitest is its 5 new cases.
- #357's 105 e2e holds: 104 at f31758b0, plus one.

Interactions:
- #357 × #358: `owner` against the proposals loop and `tied`.
- #357 × #359: markYours goes by stake key for reward addresses only, and by payment key for outputs.
- #357 × sessions: refuseOddities, sessionStakeKey, and the ties leaving the holder out.
- #359's callers: only Send and Make public render DestinationInput, and Remove pays "account" or the balance, never an address. `staked` reaches the review through send.ts's and withdraw.ts's summaries. pending.ts paysAccount is consistent.

States the fixes make reachable:
- #359: Send's save link, Max and Total leaving.
- #358: the sign window's fee, "It signs for" and collateral rows.
- #357: Transaction details while locked (nothing marked, as documented), and the callout's tone in a session. That led to finding 1.

markYours (tx-view.ts):
- I reasoned through mutants on its loop exit, the session marking and stakeKey's header check. tx-view.test.ts would catch each.
- stakeKey ignores the network nibble, but a withdrawal or proposal on the other network is refused before any window, so that isn't reachable.

Evidence and cleanup:
- Finding 1 is confirmed by a scratch render of SignTx with session: true and a proposal own: true, in the r172-critic sandbox. The callout is info-toned and reads "Its 1,000 ₳ deposit comes back to your private session when the action ends."
- The scratch test and my scratch copy of sessions.ts are deleted, and the sandbox is restored (checkout plus clean -fd, status clean).

### critic0

**critic#0 · low · ux-text** · `seedelf-platform/seedelf-web-wallet/extension/src/ui/dapp.ts:216`

**A proposal's deposit back to a private session's stake key is said to come back, but nothing in the wallet ever reads or withdraws a session's rewards**

**Outcome: fixed.** A deposit back to a session's stake key, its own or another's, "goes to the stake key of … and the wallet never brings it back" (`dappUi.proposal.warn.session`, back-translated blind), and the staking callout warns for any proposal in a session.

*Claim:* #357 words a deposit that goes back to a session's own stake key as "comes back to your private session". That's proposalLine's `own` branch with `whose` = dappUi.whose.warn.session (DappApprovals.tsx:1009), and the callout stays info-toned, since it warns only when !p.own (DappApprovals.tsx:1146). A deposit back to another session's key reads "comes back to the stake key of your private session N" (dappUi.proposal.warn.wallet). Transaction details tags it "Yours, in private session N" (tx-view.ts:279-282).

Yet nothing in the wallet reads or withdraws a session's reward account:
- its return and Disconnect read UTxOs only (dapp.ts:2031-2035 and 2075-2077; privacy.md:106, L2);
- sessions.ts builds no withdrawal from a session's stake key;
- the restore scan reads that key's transactions, not its rewards.

The worker already refuses a session's own registration or delegation for exactly this reason (dapp.ts:2078-2079, dapp.sessionStakeKey: "leaving its deposit and rewards behind"). A proposal's deposit, 100,000 ₳ on mainnet, lands in the same reward account, while the window says it comes back.

*Failure:* 1. A site on private session 1 reads the session's reward address with getRewardAddresses (dapp.ts:609).
2. It registers that stake key itself, with an old-style registration that needs no signature of the key's (X05). The ledger takes a proposal only once its return account is registered (Conway's ProposalReturnAccountDoesNotExist; from memory, not checked against the ledger source).
3. It asks the session to sign an Info proposal whose return is that address. The window shows an info callout: "Proposes information, which changes nothing. Its 100,000 ₳ deposit comes back to your private session when the action ends."
4. When the action ends, the deposit sits in the session's reward account. No screen shows it and no flow withdraws it, and the key is Seedelf's own path (24301'/2/i), so another wallet won't find it either. A later "Stops your staking" on that session, which the wallet allows, would send it to the treasury at refund (Conway's rule for an unregistered return account; not checked here).

The same happens when a site on the public account names a session's reward address. That reads "comes back to the stake key of your private session 1", the wording dapp-ties.test.ts:416 pins.

*Evidence:* I traced it at 133d598b: ui/dapp.ts:216-217, DappApprovals.tsx:1009 and 1146, dapp.ts:609, 2031-2035 and 2075-2080, tx-view.ts:279-282, sessions.ts (no reward withdrawal anywhere; recoveredRecords at 2715-2720 reads accountTxs only), and privacy.md:106. A scratch render of SignTx with session: true and a proposal own: true in the r172-critic sandbox gave an info callout reading "Its 1,000 ₳ deposit comes back to your private session when the action ends." (the test is deleted). The ledger's registration rule is from memory.

*Suggested fix:* No refusal: say it. When the return is a session's stake key (`own` in a session, or `yours` a session number), give it a line of its own, a .warn. key in en, es and ja, back-translated, with the callout warn-toned. For example: "Its {{amount}} ₳ deposit goes to this session's stake key when the action ends, where the wallet never brings it back", and the same for "the stake key of your private session N". Extending dapp.sessionStakeKey's existing refusal to such proposals is the owner's call, not this fix. Pin the session's own case in dapp-prompt.test.ts with session: true, and the other-session case in dapp-ties.test.ts's existing proposal test.

*Trace (confirmed, low):* I traced it from the code and couldn't refute it. The reach is narrow, so low is right.

**What the window says.** In a session, `whose` is "your private session" (DappApprovals.tsx:1009). `proposalLine`'s `own` branch (ui/dapp.ts:216) then says the deposit "comes back to your private session". The callout warns only for `!p.own`, an own certificate, or staking money that doesn't come back (DappApprovals.tsx:1146), so it stays info-toned. A scratch render confirmed this: SignTx with session: true and an own proposal of 100,000 ₳ gives an info callout reading "Its 100,000 ₳ deposit comes back to your private session when the action ends." A deposit back to another session's key reads "comes back to the stake key of your private session 1" (dapp-ties.test.ts pins it).

**Why that misleads.** In the wallet's own words, "your private session" means the session's UTxOs. A withdrawal "into your private session" lands in its outputs, and so does a Conway stop's refund. A proposal's deposit doesn't: the ledger credits it to the reward account's balance when the action ends. Nothing in the wallet ever reads or withdraws a session's reward account:
- Rewards are read only for public accounts' stake addresses (balances.ts:363-371 → staking.ts:110; account.ts:181). The worker's `stakeDeposit` runs only without a session (dapp.ts:2035).
- A session's return sweeps UTxOs under the session's payment key only, with no withdrawal (lib.rs:1394-1418).
- The restore scan reads the key's transactions, not its rewards (sessions.ts:2715-2720).
- The worker's own comment says rewards under a session's key "would be left behind for good" (dapp.ts:2075-2077), and it refuses a session's own registration or delegation for that reason (dapp.ts:2078-2079).

Chunk 39's plan took `whose` "as for a withdrawal" (plan line 33). That's the oversight: no owner's call covers it. The L2 analogue (a 2 ₳ registration deposit left under a session's key) is still open in backlog.md:87. There the prompt only says nothing; #357's line goes further and says the money comes back.

**The ledger rules.** I checked these in cardano-ledger's source, where the finding went from memory:
- In Conway's `Rules/Gov.hs`, from the end of the bootstrap phase on: `unless (hardforkConwayBootstrapPhase …) … isAccountRegistered … ?! ProposalReturnAccountDoesNotExist`. So a proposal goes through only if its return account is registered.
- In `Rules/Epoch.hs`, `returnProposalDeposits` adds the deposit to that account's balance, or, if the account is unregistered, sends it to the treasury.

**Why only low:**
- On the common path the session's key is unregistered, as the wallet always leaves it. The ledger then refuses the transaction at submit, and nothing is lost.
- Harm needs someone to register the session's key first with an old-style certificate, which needs no signature of that key's. That could be the site, paying the 2 ₳ itself, or the public account on the L2 path. It can also happen in the same transaction as the proposal when it's signed from the public account. The session also needs 100,000 ₳ or more on mainnet.
- The money is stranded, not lost. It sits under the user's own key, 24301'/2/i. A site still connected to that session could withdraw it, since the wallet signs a session's own withdrawal. Otherwise it's recoverable only outside the wallet, because each index is used for one session and never again.
- It's lost only if the key is deregistered before the deposit comes back, which takes a further signature.

The tag in Transaction details, "Yours, in private session N", only says whose key it is. It's accurate and needs no change. The suggested fix is right: a warning that says where the deposit goes, with no new refusal, which fits the owner's rules.

*Trace's evidence:* All at 133d598b, read with `git show`:
- **Window:** ui/dapp.ts:212-219 (proposalLine; `own` branch at 216, `yours` at 217). DappApprovals.tsx:1009 (`whose` = dappUi.whose.warn.session), 1144-1146 (tone) and 1158.
- **Strings:** en.json:470-471 and 513; es and ja say the same thing.
- **Worker:** background/dapp.ts:608-609 (getRewardAddresses gives the session's reward address), 2031-2035 (stake deposit read only without a session), 2075-2080 (session refusal and its "left behind for good" comment).
- **Rust:** cip30.rs (proposal `own` = key == keys.stake, where stake_index is the session's index); lib.rs:1394-1418 (session_return checks and sweeps only UTxOs under the session's payment key).
- **Reward reads:** sessions.ts:2462-2469 and 2715-2720; balances.ts:363-371; staking.ts:109-110; account.ts:181 (public accounts' stake addresses only).
- **Docs:** privacy.md:106 (L2); archive/post-release-roadmap.md:455 and backlog.md:87 (the L2 analogue, still open); archive/plans/chunk-39-proposal-deposit.md:33.
- **Pinned wording:** tests/dapp-ties.test.ts:416.
- **Ledger:** fetched cardano-ledger master. Conway Rules/Gov.hs gates `ProposalReturnAccountDoesNotExist` with `unless (hardforkConwayBootstrapPhase …)`. Rules/Epoch.hs `returnProposalDeposits` credits a registered account's balance and sends an unregistered one's deposit to the treasury (`casTreasuryL <>~ … fold unclaimed`). pallas's localtxsubmission enum also lists ProposalReturnAccountDoesNotExist as GOV failure 16.
- **Ran:** a scratch test, tests/zz-r172-v-critic0.test.ts, in the r172-critic sandbox. It rendered SignTx with session: true and an own Info proposal of 100,000 ₳, and asserted the info tone and the text "Its 100,000 ₳ deposit comes back to your private session when the action ends." It passed. I deleted it, and `git status` in the sandbox is clean.

*Trace's fix note:* The fix is a warning, not a refusal (as the finding says).
- **`proposalLine` (ui/dapp.ts:212):** add a `session` flag. It can't tell from `whose`, which is translated text the code mustn't compare. DappApprovals.tsx:1158 already has `session`.
  - For `p.own && session`, use a new key such as `dappUi.proposal.warn.sessionOwn`: "Proposes {{what}}. Its {{amount}} ₳ deposit goes to this session's stake key when the action ends, and the wallet never brings it back."
  - For `typeof p.yours === "number"` (a session; `DappTie` is `{account} | number`), use `dappUi.proposal.warn.sessionKey`, the same sentence with the session's name.
- **Tone:** make the staking callout warn when `session && s.proposals.length > 0` (DappApprovals.tsx:1146). The other-session case already warns, because `own` is false.
- **Translations:** add both keys in en, es and ja, list them in docs/i18n/critical-keys.json, and record blind back-translations in verified-critical-{es,ja}.json. Keep each to one line.
- **Tests:**
  - dapp-prompt.test.ts: session: true with an own proposal gives the warn tone and the new words; session: false keeps "comes back to your public account".
  - dapp-ties.test.ts:416's other-session line gets the new words.
  - dapp.test.ts: add the new proposalLine cases.
  - Reverting the change should fail each of these.
- **Docs:** optionally extend privacy.md:106 (L2) and backlog.md:87 to say a proposal's deposit back to a session's key stays there too.
- Leave Transaction details' "Yours" tag alone. Extending dapp.sessionStakeKey's refusal to these proposals stays the owner's call.

### critic1

**critic#1 · nit · docs** · `seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts:1510`

**Three code comments still say `certified` holds a certificate's or a withdrawal's ties, but not a proposal's**

**Outcome: fixed.** The comments on `certified` name a proposal's deposit and a treasury withdrawal's recipients.

*Claim:* #357 puts a proposal's stake key in `certified` (dapp.ts:2303 and 2324), and updated the worker's comment and the warning's text to match. Three comments still describe it as a certificate's or a withdrawal's alone:
- rpc.ts:1510, the DappAsk.certified doc;
- DappApprovals.tsx:974, the prop doc, and :1222, the privacy callout's comment;
- ui/dapp.ts:80, certifiedLine's doc.

The docs' instance, privacy.md:192, is already reported. These are the code's own comments.

*Failure:* A developer reading DappApprovals' prop doc or rpc.ts's type concludes a proposal's tie isn't in `certified`. They then add a second warning for it, or filter proposals out of it, and the prompt says the other side isn't in it again (X05's bug).

*Evidence:* I read the four places at 133d598b and grepped for "a certificate or a withdrawal" across src. The worker's own comment (dapp.ts:2297-2299) and dappUi.ties.privacy.certified both include proposals.

*Suggested fix:* Add "or a proposal's deposit back" to the four comments. No test needed.

*Verification:* nit: not verified

