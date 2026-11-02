# 1.7.2's release review, round two: the merged fixes

Four lenses over the merged fixes, then a completeness critic, each finding traced; and the blind back-translation of the three new critical keys. Cited as "1.7.2's review of its fixes, <ID>". The brief is REVIEW2BRIEF.md.

| ID | Severity | Trace | Outcome | Title |
|---|---|---|---|---|
| r2-worker#0 | low | confirmed, low | documented | A reward account named by another account's payment or DRep key hash ties nothing: byStake checks stake keys alone, the new recipients included |
| r2-worker#1 | nit | – | fixed | architecture.md says a proposal is refused on the other network or for a non-reward address, right after the recipients sentence; a treasury withdrawal's recipients never are |
| r2-screens#0 | low | confirmed, low | documented | A payment or DRep key's hash in a stake credential (a proposal's return, a registration, an output's staking part) ties nothing: the window says "isn't yours" and "aren't in it" |
| r2-tests#0 | low | confirmed, low | fixed | Only the first public account's DRep key is ever tested: deriving it for that one alone passes every test |
| r2-tests#1 | low | confirmed, low | fixed | Every TypeScript treasury-withdrawal case pays a single recipient: tying only the first one passes every test |
| r2-tests#2 | nit | – | fixed | A screens-wiring test is named for Make public's total but asserts no total |
| r2-docs#0 | low | confirmed, low | fixed | A payment to a stake key's own address is called a move into the session or account, which never sees that money |
| r2-docs#1 | nit | – | fixed | keys-and-accounts.md says the farther look reaches index 500; it stops at 499 |
| r2-docs#2 | nit | – | fixed | keys-and-accounts.md's DRep key list leaves out collateral, which the stake key's list includes |
| r2-docs#3 | nit | – | fixed | privacy.md still lists the DRep key's signatures for a governance site as certificates, votes and messages |
| r2-docs#4 | nit | – | fixed | The backlog's pr358#3 line still says the stake key spends only at its own address |
| r2-docs#5 | nit | – | fixed | The Midnight plan's summary still has Generate DUST built beside staking |
| r2-critic#0 | low | – | documented | A committee update's members, and a committee hot key, are never matched against the wallet's keys: a session's prompt still says the public account isn't in it |
| r2-critic#1 | low | – | fixed | cip30_test.rs's paid_to says it has every kind of address paid to a key hash but leaves out a base address with a script's staking part: an owner that skips those passes all 48 tests |
| r2-critic#2 | nit | – | fixed | ties()'s doc still says every output that's another of the wallet's is named (`yours`), two paragraphs after saying one paid to a stake or DRep key's hash stays "An address" |

## Lens worker

### What it checked

Sandbox: /home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-cross. It was restored at the end with checkout, clean and apply of merged-fixes.patch, and `git diff --binary` matches the patch byte for byte. No zz- files are left, and the cargo target is warm on the merged source again.

**What I read in full:**
- dapp.ts: ties() (2241-2364), publicKeys() (2377-2402), keysOf, signTx's `.catch` (2133), readTx, resolve, paysHolder and remember.
- chain.ts: fartherKeys and FARTHER_KEYS.
- rpc.ts: DappTxSummary (paid, proposals) and DappAsk (ties, staked, certified).
- cip30.rs: Proposal, the proposals loop (1545-1590), `owner`, Keys::of_hash, own_address and the payment_signs block.
- lib.rs: drep_of; seedelf-crypto CardanoAccount; pallas-addresses 0.35.1 from_bytes, which can't panic.
- Readers of the new field and map: ui/dapp.ts proposalLine, DappApprovals' staking tone, sessions.ts siteSigned and refuseOddities (only `.length`), tx-view.ts markYours (decode's TxDetail, not DappTxSummary) and Lovejoin. Only ties() reads `recipients` or `publicKeys`.

**Every place in ties that reads a payment credential, against #358's rule:**
- **Outputs and found inputs (rows, collateral included):** `ours` and `whose` are right.
- **The fartherKeys look:** `ours` skips stake- and DRep-hash addresses, and the session's own stake key (holderStake).
- **The Pays row:** the label passes no spender, so `paid[].yours` stays payment-key only. The one address it can name that the balance may not read is X06/own#1's, which is on the left list.
- **The staked bucket:** the spender lookups mirror `ours`, so nothing is both "ours" and untied unless it's the signer's own.
- **The site's own account and the holder session**, in both directions:
  - Public prompt: the filter on `view.account` applies to the spender lookups.
  - Session prompt: `others` leaves the holder out, every public account is in, and holderStake counts in `ours`.
  - Recipients: the signing account's own key is left out, a session's key is tied, scripts are skipped, the other network is tied by its hash (the ledger refuses that transaction, so it only over-warns), and duplicates are deduped by listed().
- **Probes (scratch vitest, three accounts):** a public prompt paying 60‖DRep(Account 3) ties {account:2}; 00‖own stake‖Account 3's stake ties {account:2}; the account's own DRep address ties nothing; a session paying 00‖DRep(Account 2)‖stranger ties {account:1}; duplicate recipients plus the deposit give certified [{0},{1}].

**publicKeys' DRep derivation:**
- **Cost:** about 0.4 ms per account against about 8 ms for its 40 payment key hashes (17 ms to derive an account), so roughly +1.5% per signTx.
- **If drepOf throws:** it can't in practice, since CardanoAccount always holds the private key and index 0 is below 2^31. If it did, ties() rejects, the `.catch` returns undefined and the prompt promises nothing; a trap is rethrown.
- **Governance off:** it doesn't matter for ties. The DRep key's witness spends an address paid to its hash either way. WebAssembly's gated DRep signer agrees: with governance off, the site's own DRep input reads as a stranger's there and as the account's own (no tie) in the worker, and neither says anything false.

**Version skew (old pkg, new worker):** a stale pkg makes ties() throw a TypeError on `p.recipients` for any transaction with a proposal, and the prompt promises nothing (the safe side). It can't reach users:
- Vite bundles the pkg under a content-hashed URL (wasm.ts:14);
- CI builds the pkg fresh (web-wallet.yml:144);
- `npm run build` runs build:wasm first.

Only `npm run dev` skips it, and vitest fails visibly there.

**Tests:**
- Vitest: dapp-ties, dapp-ties-accounts, dapp, dapp-prompt, own-account-names and own-address pass (124), and so do 18 more signTx and i18n files.
- i18n.test.ts fails only the expected es/ja machine-draft checks, for exactly the three new keys.
- `npm run typecheck` is clean.
- cargo `-p seedelf-wasm --locked`: every suite passes, cip30_test 48/48.

**Mutants, each killed:**
- TS (scripts/review/work/r2-wasm-mutants.py): no holderStake; no DRep in publicKeys; others' stake left out of `ours`; no DRep in `ours`; no stake in `ours`; recipients only when the deposit isn't the account's own; the sessions' stake-as-payment lookup left out of byKeys.
- Rust (r2-wasm-rust-mutants2.py and an R1 run): scripts kept, this network only, the account's own key left out, an enterprise address's payment key kept. Each fails a_treasury_withdrawal_says_whose_stake_keys_it_pays.

**Docs:** I checked architecture.md:568, privacy.md:106/:192, keys-and-accounts.md and the rpc.ts and dapp.ts comments against the code. They're consistent, except the nit below.

Evidence copy: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-wasm-probe.test.ts.txt

### r2-worker#0

**r2-worker#0 · low** · `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2334`

**A reward account named by another account's payment or DRep key hash ties nothing: byStake checks stake keys alone, the new recipients included**

**Outcome: documented.** Not covered in architecture.md:568 and privacy.md:192, and a backlog line under *Signing and the connector*: tying it needs words of its own ("a key of …"), critical strings, for a crafted-only case.

*Claim:* The merged fixes apply #358's rule (a key's witness spends what's paid to its hash, whatever the key's role) to payment credentials only. `ours` and `byKeys` now also look a payment credential up in accounts.stake, accounts.drep and the sessions' stake keys.

The mirror isn't applied. `byStake` = `byKeys(undefined, stake)[0]` (2334) looks a reward credential up only in accounts.stake and the sessions' stake keys. It serves certificates (2335), withdrawals, a proposal's deposit (2337) and this round's treasury `recipients` (2341).

The ledger checks a reward account's witness by key hash, as it does an input's (witsVKeyNeeded against the witnesses' key hashes). So e0‖H, with H another account's payment key hash or a public account's DRep key hash (both already in the maps publicKeys builds), is that key's to withdraw from, and naming it on chain ties that account as its stake key would.

*Failure:* A site on private session 1 has seen the public account's addresses, which all carry its payment key hashes. It asks the session to sign one of these:
- an old-style registration (certificate kind 0: no witness, a 2 ₳ deposit) of credential = the public account's receive key 0/0's hash;
- a treasury withdrawal paying e0‖that hash;
- a proposal whose deposit goes back to e0‖that hash.

The window says "a stake key that isn't yours" and ends "Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it." Signed, the chain shows the session registering, or naming as a payee, a reward account that only the public account's payment key controls. The public account's DRep key hash gives the same result.

*Evidence:* **Read:** dapp.ts:2263-2283 (byKeys), 2298-2310 (ours), 2334-2341 (byStake and recipients), 2362 (certified).

**Ran:** a scratch vitest in the sandbox, three public accounts, a site on session 0 (copy at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-wasm-probe.test.ts.txt). Five cases each returned ties, staked and certified [[],[],[]], and the rendered window read "Your public account and your private balance aren't in it.":
- a treasury recipient e0‖paymentKeyHash(0,0);
- a treasury recipient e0‖drepOf().hash;
- a deposit back to e0‖paymentKeyHash(0,0);
- a registration of paymentKeyHash(0,0);
- a registration of the DRep hash.

**Mutant:** byStake → `byKeys(stake, stake)[0]` turns all five into certified [{account:0}]. dapp-ties, dapp-ties-accounts and dapp.test still pass (93/93).

**History and rating:** pre-existing for certificates since X05; the recipients path is new this round and has the same lookup. Rated low, as own#0 and X05 were: a crafted transaction only, and an observer must match a hash across roles to see the link.

*Suggested fix:* Look a reward credential up in every role for `certified`, e.g. a byAnyKey = `byKeys(key, key)[0]` for certificates, withdrawals, deposits and recipients.

Keep the line's `yours` to stake keys, or give a payment or DRep key hash words of its own. The full lookup also sets `yours`, and then the line read "comes back to the stake key of Account 1 · Main" for a reward account the wallet never reads or withdraws (critic#0's point).

Pin it in dapp-ties.test.ts with:
- a session registering the public account's payment key hash;
- a treasury recipient at its DRep key hash.

The docs (architecture.md:568, privacy.md:192) then say that any of the wallet's key hashes, named as a reward account, ties its account.

*Trace (confirmed, low):* I traced the code and reproduced the finding in the sandbox. The finding holds.

- `byStake` (dapp.ts:2334) is `byKeys(undefined, stake)[0]`. With `payment` undefined, `spender` is undefined too. So the only lookups are `accounts.stake.get(stake)` and the sessions' `s.stake`.
- That one lookup feeds the certificates (2335), withdrawals (2336), proposal deposits (2337) and this round's `recipients` (2341), and all of them go into `certified` (2362).
- WebAssembly passes any key hash through untouched. A certificate's `credential` is any key (cip30.rs:1465). A proposal's `credential` and `recipients` are any key (1567-1586). An old-style registration, a proposal's deposit and a treasury recipient each need no signature from the key they name, so the transaction is `complete`.
- The ledger's witness check ignores a key's role: it compares key hashes only, which is the same fact #358 rests on. So the public account's payment key 0/0 is the one key that can withdraw from or deregister e0‖H.
- H appears on chain in the public account's addresses. V0 shows its receive 0/0 is 00‖H‖stake.

So a session can name a reward account only the public account's key controls, and the window still says that account isn't in the transaction.

The rating stays low:
- Only a crafted transaction reaches it. A deposit or recipient also needs e0‖H registered first, which the site can do itself.
- Seeing the link means matching a hash across roles. Explorers don't list e0‖H under the account's stake key.
- A DRep key hash is on chain only after the account has acted as a DRep.
- own#0 (the same class, the other way round), X05 and L1 were all rated low.
- It isn't a regression. `byStake` is identical at f31758b0, 133d598b and dd22e2b2. Only the recipients path is new, and pr357#0 asked only for stake keys.

The public side has the same gap, which the finding doesn't mention (P1-P3 below).

*Trace's evidence:* **Read** in the r172-cross sandbox (merged state):
- dapp.ts: `byKeys` 2263, `whose` 2288, `ours` 2298, `byStake` 2334, its four uses 2335-2341, `yours` set through `named` 2353-2358, `certified` 2362.
- ui/dapp.ts: `signingTies` 119, `certificateLine` 164, `proposalLine` 220.
- cip30.rs: 1465-1478 and 1556-1586.
- en.json: 360, 454, 455, 471-472, 493.
- `git show f31758b0/133d598b/dd22e2b2:…/dapp.ts`: `byStake` is the same in all three.

**Ran** a scratch vitest built on dapp-ties.test.ts's helpers, with one public account and a site on session 0. Every case below gave `complete` true and `[ties, staked, certified]` = [[],[],[]]. The window kept "A certificate for a stake key that isn't yours." or "…goes to a stake key that isn't yours, stake_test1…", and ended "Your public account and your private balance aren't in it.":
- V1, V1b: registration of paymentKeyHash 0/0 (0fdc78…) and of change 1/0.
- V2: registration of the DRep hash (b2a7f5…).
- V3, V4: treasury recipient e0‖pay and e0‖drep.
- V5, V5b: deposit back to e0‖pay and e0‖drep.
- C1 (control): registering the stake key gives certified [{account:0}].
- V0: receive 0/0 = 00‖0fdc78…‖e55789…, so H is on chain.

The public side, with a site on the public account and two sessions:
- P1-P3: e0‖session 1's payment key hash as a registration, a recipient or a deposit gives [[],[],[]] and "Your private balance isn't in it." That hash is the payment part of the session's own address.
- C2 (control): its stake key gives [0].

The same class through an address's stake part:
- S1, S1b: paying base(stranger, H_pay) or base(stranger, H_drep) gives [[],[],[]] and "aren't in it".
- Control: base(stranger, stake) gives staked.

**Mutants:**
- The finding's mutant, `byKeys(stake, stake)[0]`, turns V1-V5b into certified [{account:0}] and P1-P3 into [0]. dapp-ties, dapp-ties-accounts and dapp.test still pass, 91 of 91 (the finding's 93 includes its 2 probes); dapp-prompt and own-account-names pass 26 of 26. But the mutant also sets `yours`, and V5 then reads "Its 1,000 ₳ deposit comes back to the stake key of your public account when the action ends." That's false: the wallet never reads e0‖H.
- The split fix (below) gives certified on V1-V5b and P1-P3, leaves S1 unchanged, and passes 117 of 117 in those five files. tsc reports nothing in src.

Copies: scratchpad/review/work/r2-vmirror-1.test.ts.txt, r2-vmirror-2.test.ts.txt and r2-vmirror-split-fix.diff. The sandbox is restored: `git diff --binary` is byte-equal to merged-fixes.patch, with no untracked files.

*Trace's fix note:* **Smallest fix**, in dapp.ts `ties`, run in the sandbox (r2-vmirror-split-fix.diff):
- Add `const byAnyKey = (key) => (key ? byKeys(key, key)[0] : undefined)`.
- Feed `certified` from `byAnyKey` over the certificates' `credential`, the withdrawals' stake keys, the proposals' `credential` and their `recipients`.
- Keep `named(...)`, the lines' `yours`, on `byStake`.

Corrections to the suggested fix:
1. Never let the full lookup set `yours`. Under the finding's own mutant, a deposit line says "comes back to the stake key of your public account", which is false.
2. Even with `yours` kept to stake keys, the window still contradicts itself. "A certificate for a stake key that isn't yours." (or "goes to a stake key that isn't yours") sits beside the callout "names the stake key of your public account", and "the stake key of" is wrong for a payment or DRep key hash. Either:
   - reword `dappUi.ties.privacy.certified` to "names a key of {{list}}", which is a critical value: blind es/ja back-translation and the value-change greps; or
   - accept the wording, since the tie itself is then right.
3. The same lookup is missing from `byKeys`'s stake slot, which `whose` uses for `staked`. base(anyone, H_pay) and base(anyone, H_drep) still say "aren't in it" (S1). Extend that slot too, or list the case under "Not covered".
4. Tests. Besides the finding's two cases, pin:
   - a deposit back to e0‖paymentKeyHash(0,0): certified [{account:0}], and the line never says "comes back";
   - the public side: e0‖session 1's payment key hash as a registration, a recipient or a deposit gives certified [0] and no "isn't in it".
5. Docs. Update architecture.md:568 and privacy.md:192's exhaustive "unless" list. If the owner keeps the behaviour, list it under "Not covered" beside L3/L11 instead, with a backlog line, as own#2 went.

### r2-worker#1

**r2-worker#1 · nit** · `seedelf-platform/seedelf-web-wallet/docs/architecture.md:568`

**architecture.md says a proposal is refused on the other network or for a non-reward address, right after the recipients sentence; a treasury withdrawal's recipients never are**

**Outcome: fixed.** architecture.md says the refusal is about the deposit's reward account, and that a treasury withdrawal's recipients never are.

*Claim:* Right after "A treasury withdrawal's recipients take no signature of theirs either: WebAssembly gives each proposal their stake key hashes (`recipients` …)", architecture.md says "A proposal is refused only where the ledger refuses it: on the other network, or with a reward account that isn't a reward address."

That holds only for the deposit's reward account. cip30.rs:1563-1583 skips a recipient that isn't a reward address and keeps one on the other network. It never refuses either, though the ledger refuses both: TreasuryWithdrawalsNetworkIdMismatch, and the bytes don't decode as a RewardAccount.

*Failure:* A developer reading the paragraph expects WebAssembly to refuse a treasury withdrawal that pays the other network's reward address, and writes a test or a site-facing error on that basis.

In fact the wallet opens the window and signs. On preprod, a recipient e1‖(Account 1's stake key) is even tied in `certified` as another account's, in a transaction the ledger will refuse.

*Evidence:* **Read:** architecture.md:568, and cip30.rs:1563-1583 (the comment says "on either network … so none is refused here").

**Test:** wasm/tests/cip30_test.rs:1563-1603 asserts inspect_tx succeeds with these recipients on preprod:
- 0xe1‖their_stake (the other network);
- the three bytes e0 01 02;
- an enterprise address.

Its recipients come back [own hash, their_stake]. The test passes in the sandbox.

*Suggested fix:* Say which reward account the refusal is about, e.g. "A proposal is refused only where the ledger refuses its deposit's reward account: on the other network, or one that isn't a reward address. A treasury withdrawal's recipients never are, though the ledger refuses the other network's."

## Lens screens

### What it checked

Lens: the screens and the translations, in the sandbox /home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-i18n. I read ui/dapp.ts, DappApprovals.tsx (SignTx), StakedWarning.tsx, CardanoSend.tsx, Withdraw.tsx, accounts.tsx and App.tsx's ScreenForAccount in full. I also read the worker's ties/publicKeys diff, rpc.ts, cip30.rs's proposals, and the docs diff.

**proposalLine: every branch, rendered.** I rendered every branch in en, es and ja with a scratch Vitest, across all 7 proposalWords actions. The output is at review/work/r2-i18n-render.txt. Each line below is the window's text, then the staking callout's tone:
- Public, own: "comes back to your public account"; info.
- Session, own: "goes to the stake key of this private session … and the wallet never brings it back"; warn.
- Another session (`yours` is a number), public or session side: the same sentence, "your private session N"; warn.
- Another public account (`yours` is `{account}`), public or session side: "comes back to the stake key of Account N · Name" (or "your public account"); warn.
- A stranger's or a script's: "goes to a stake key that isn't yours, stake…"; warn (the script's wording is left on purpose).
- "Comes back" appears only for the public account's own key and for another public account's key. The wallet reads and withdraws both.

**The tone.** The `|| session` term is pinned by dapp-prompt's session-own case, and the branch order by dapp.test.ts. The privacy callout's signingTies gets the merged ties, staked and certified, so a session's or another account's key in a proposal or a treasury withdrawal suppresses "isn't in it". The comments now match the code.

**StakedWarning's choice by `active`:**
- **While loading:** the context is the single default account with active 0. When `active` changes, ScreenForAccount's key changes (App.tsx:281-282) and the screen remounts, so a transient wrong line is thrown away.
- **Switching accounts mid-form:** the same remount resets the form and the review. The worker re-reads the destination for the new account.
- **Form and review:** both use the same `active`, and the review's `staked` comes from the worker's active account at build time.
- **Make public:** the "withdraw" side never looks at `active`, so its text is unchanged.
- Only a failed accounts read (accounts.tsx:114-116) leaves a stale `active`. OtherAccountNote and Total leaving already rely on that same assumption, so I'm not reporting it.

**The new values.**
- Placeholders match what the code passes. dappUi.proposal.warn.session takes what, amount and name; send.warn.stakedOther takes whose, and the Nth form adds number.
- U+00A0 sits before ₳ in en, es and ja, checked by code point. dapp.test.ts pins it in en.
- Spanish agreement holds with every placeholder value: "Esta … tu Cuenta/cuenta pública", and "lo" refers to el depósito. The Japanese sentence frames match the verified sibling keys.
- en `_one` now reads "what it holds".
- The names rule holds, there's no module-level t(), and every key is a literal.
- critical-keys.json has the 3 new keys (473 in all, sorted, unique). There are no duplicate keys in en, es, ja or either provenance file.

**e2e, store-images.spec and scripts.** None of them reads a changed wording. The only e2e proposal test is chunk 39's, the stranger's line, which is unchanged. No e2e reads send-staked or dapp-unknown, and nothing checks the dapp-staking tone in a session.

**Docs.** flows.md:227 and :430, privacy.md:98, :106 and :192, and architecture.md:568 all match the code.

**Runs.**
- 15 Vitest files (dapp-prompt, dapp, dapp-ties, dapp-ties-accounts, own-account-names, screens-wiring-review-fixes, i18n*, words, shown-text): 305 passed, plus the 2 expected i18n.test.ts failures, which list exactly the 3 new keys.
- `npm run typecheck` is clean.

**Cleanup.** I deleted the scratch tests. The sandbox is restored, and `git diff --binary` is byte-identical (cmp) to merged-fixes.patch.

One finding, low: in the worker's matching, a wallet key's hash in a stake-credential position ties nothing, and the screen then states a false privacy line.

### r2-screens#0

**r2-screens#0 · low** · `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2334`

**A payment or DRep key's hash in a stake credential (a proposal's return, a registration, an output's staking part) ties nothing: the window says "isn't yours" and "aren't in it"**

**Outcome: documented.** As r2-worker#0, the same defect.

*Claim:* pr358#0 and own#0's fix now matches a payment credential against the wallet's stake keys and DRep keys. A stake credential is still matched against stake keys only:
- byKeys's stake slot (dapp.ts:2270, 2279);
- byStake (2334), which certificates, withdrawals, proposals (2337) and the new treasury recipients (2341) all go through.

So none of these ties anything when the stake credential is one of the wallet's other key hashes (a public account's payment key or DRep key, or a session's payment key):
- a proposal's return account;
- a treasury withdrawal's recipient;
- an old-style registration's credential;
- an output's staking part.

The window then shows false text. The proposal and certificate lines call the user's own key's hash "a stake key that isn't yours". signingTies (ui/dapp.ts:124) adds "Your public account and your private balance aren't in it." in a session, and "Your private balance isn't in it." on the public side. On chain, the key's hash is in the transaction for anyone to match.

*Failure:* 1. A site is connected to private session 1. It knows one of these (a site that saw the public account connected in this browser already knows its addresses):
   - the public account's DRep ID, which is on chain once the account registered as a DRep, or which it got from getPubDRepKey;
   - any of the account's addresses, which carry its payment key hash.
2. It asks the session to sign one of:
   - an old-style registration of stake credential = that hash (2 ₳; it needs no signature);
   - 4 ₳ to 00‖stranger‖publicPaymentKeyHash;
   - a registration plus a proposal returning to e0‖drepHash.
3. The window shows "A certificate for a stake key that isn't yours." or "Its … ₳ deposit goes to a stake key that isn't yours, stake_test1u…". It ends "Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it."
4. Once signed, the session's transaction carries the public account's key hash on chain.

The mirror case: the public account's prompt with a proposal returning to e0‖(session 0's payment key hash), which is the payment part of every address of that session, ends "Your private balance isn't in it.". For comparison, the same proposal to session 0's stake key is tied and named.

*Evidence:* **Ran:** a scratch Vitest on dapp-ties.test.ts's harness, with the real DappService and WebAssembly, in my sandbox. It is deleted from the sandbox; copies are in review/work/:
- the test: r2-i18n-reverse.test.ts;
- its output: r2-i18n-reverse.txt and r2-i18n-reverse-public.txt.

**Session side, 5 cases:**
- proposal→e0<drep hash>
- proposal→e0<paymentKeyHash(0,0)>
- output 00<ab…><pay 0/0>
- output 00<ab…><drep hash>
- registers(<drep hash>)

Each gave ties, staked and certified [[],[],[]]. Each page ended "Your public account and your private balance aren't in it." The proposal cases read "goes to a stake key that isn't yours"; the registration case read "A certificate for a stake key that isn't yours."

**Public side:**
- proposal→e0<oneTime.keyHash(0)> and output 00<ab…><oneTime.keyHash(0)> both gave [[],[],[]] and "Your private balance isn't in it."
- The control, proposal→session 0's reward address, gave [[],[],[0]], the certified tie line, and the new "never brings it back" line.

**Read:**
- dapp.ts:2263-2282 (byKeys) and 2334-2341 (byStake and its callers);
- ui/dapp.ts:119-127 (signingTies).

**Not already on record:**
- It isn't in architecture.md:568's "Not covered (L3, L11)" list.
- It isn't among the first round's 53 findings. own.md's inventory (items 21 and 25) checked stake credentials against stake keys only.

**Severity:** low, by own#0's precedent. Only a hostile site can reach it, and that site already knows the link. The harm is a false privacy sentence plus a credential match on chain. No money moves unseen.

*Suggested fix:* **In `ties`:** also look a stake credential up in accounts.payment and accounts.drep (publicKeys already derives drep), and in the sessions' payment keys, in byKeys's stake slot and in byStake.
- Count a match in `certified`, or in `staked` for an output.
- Leave `yours` unset. Otherwise the line would read "comes back to the stake key of …" for a reward account the wallet never reads or withdraws.
- A new critical string would be needed to stop calling it "a stake key that isn't yours".

**If the owner keeps the behaviour:** list it beside L3 and L11 under "Not covered" in architecture.md:568 and privacy.md:192.

**Tests:** pin the cases above in dapp-ties.test.ts. Each fails on today's tree.

*Trace (confirmed, low):* I traced the code path and reproduced every claim on the merged tree. I couldn't refute any of it.

**The code path**
- `byKeys` (dapp.ts:2263) looks a payment credential up in the stake and DRep keys too, through `spender` (2266-2268). That is the pr358#0/own#0 fix.
- Its stake slot still checks only `accounts.stake` (2270) and `others[].stake` (2279).
- `byStake` (2334) is `byKeys(undefined, stake)`. Certificates (2335), withdrawals (2336), proposals (2337) and the new treasury recipients (2341) all go through it.
- So a stake credential that is a public account's payment key or DRep key, or another session's payment key, matches nothing. It ties nothing in an output's staking part, a found input, a certificate, a pool's reward account, a proposal's return or a treasury recipient.
- With `ties`, `staked` and `certified` all empty, `signingTies` (ui/dapp.ts:119-128, called at DappApprovals.tsx:1231) prints "…aren't in it." / "…isn't in it.". `certificateLine` and `proposalLine` print "a stake key that isn't yours".

**Reachable**
- A session may sign any certificate that isn't its own. dapp.ts:2078 refuses only `c.own` with a kind other than unregister.
- An old-style registration needs no witness, so S5, S6 and S7 below come back `complete: true`.

**Reach is narrow, so low**
- Only a deliberately hostile site does this, and it already knows the link from its two connections in this browser.
- A third party can see the link only by matching the same hash across roles. That is the same as own#0, which was verified low.
- The cheap paths are an output's staking part (any amount) and an old-style registration (a 2 ₳ deposit). The proposal paths cost a governance deposit, 100,000 ₳ on mainnet. From memory, not checked: after Conway's bootstrap phase, a return account has to be registered, which a registration in the same transaction does (S10).
- A DRep hash can be matched on chain only once the account has registered as a DRep.
- No money moves unseen.

**Not on record and not a regression**
- It isn't in L3/L11's "Not covered" list (architecture.md:568), nor in privacy.md:192.
- No first-round finding raised it. own.md's items 21 and 25 checked stake credentials against stake keys only, and the ties fixer's report never considers this direction.
- The certificate and output paths date from 1.5.0. The proposal paths came with 1.7.2 (#357).
- It isn't a path of own#0's or pr358#0's own finding: both were about payment credentials.

**The suggested fix's tension**
- `byStake` returns `byKeys(...)[0]`, and that one value feeds both `yours` (`named`, 2356-2358) and `certified` (2364).
- So "change byKeys's stake slot and byStake" and "leave yours unset" can't both hold as written.
- The literal change (mutant M1) set `yours` on proposals. The line then read "Its 1,000 ₳ deposit comes back to the stake key of your public account when the action ends", for a reward account the wallet never reads. That's false.

*Trace's evidence:* **Ran.** A scratch Vitest of my own, `tests/zz-r172-r2-vrev-ties.test.ts`, on dapp-ties.test.ts's harness with the real DappService and WebAssembly, in sandbox r172-i18n at the merged state. Copies are in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/`:
- the test: `r2-verify-reverse-ties.test.ts`
- the baseline output: `r2-verify-reverse-out.txt`

**Baseline, session side.** Each of these gave ties/staked/certified `[[],[],[]]`, and each page ended "Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it.":
- S1: a proposal returning to e0‖drep
- S2: a proposal returning to e0‖pay0/0
- S3: an output to 00‖ab…‖pay0/0
- S4: an output to 00‖ab…‖drep
- S5: an old-style registration of drep
- S6: an old-style registration of pay0/0
- S7: an old-style registration of change key 1/5
- S8: a treasury withdrawal paying e0‖pay0/0
- S9: a pool registration with reward account e0‖pay0/0, with partialSign
- S10: a registration of drep plus a proposal returning to it

Further detail:
- All are `complete: true` except S9.
- S5, S6, S7 and S10 read "A certificate for a stake key that isn't yours."
- S1, S2 and S10 read "goes to a stake key that isn't yours, stake_test1u…".
- I checked that OWN's payment part equals pay0/0.

**Baseline, public side:**
- P1: a proposal returning to e0‖oneTime.keyHash(0)
- P2: an output to 00‖ab…‖keyHash(0)
- P3: an old-style registration of keyHash(0)

All three gave `[[],[],[]]` and "Your private balance isn't in it.". I checked that session 0's address has keyHash(0) as its payment part.

**Controls:**
- C1, a registration of the public stake key: certified `[{account:0}]`.
- C2, an output to 00‖ab…‖public stake key: staked `[{account:0}]`.
- C4, a proposal returning to session 0's stake key: certified `[0]`, with the "never brings it back" line.

**Mutant M1** (`r2-verify-reverse-naive.diff`, output in `r2-verify-reverse-naive.txt`). The suggested fix as written: byKeys's stake slot also looks in `accounts.payment`, `accounts.drep` and `others[].payment`.
- Every case was tied.
- But S1, S2 and S10 read "Its 1,000 ₳ deposit comes back to the stake key of your public account when the action ends", which is false.

**Mutant M2** (`r2-verify-reverse-split.diff`, output in `r2-verify-reverse-split.txt`). The same lookup with an `anyKey` flag, used only for the tie lists; `yours` stays by stake key.
- Every case was tied, and no "comes back".
- The page then says both "a stake key that isn't yours" and "names the stake key of your public account: signing ties…".
- M2 passes all 65 tests in dapp-ties, dapp-ties-accounts and dapp-prompt, so no existing test pins either behaviour.

**Read:**
- dapp.ts:2078, 2263-2282, 2286-2290, 2334-2364, 2378-2400 (`publicKeys` derives drep)
- ui/dapp.ts:119-128, 209-220
- DappApprovals.tsx:1227-1235
- cip30.rs:1466-1485, 1504-1585
- architecture.md:568, privacy.md:192
- review/findings/own.md, pr358.md, outcomes.json, fix-report-ties.md

**Sandbox:** restored with checkout, clean and apply. Its diff is byte-identical to `merged-fixes.patch`, and no untracked files are left.

*Trace's fix note:* **The smallest correct code fix, all in `ties` (dapp.ts).**

1. **byKeys:** give it a role-crossing lookup for the stake slot: `accounts.payment.get(stake)`, `accounts.drep.get(stake)`, and `others.find((s) => s.payment === stake)`. Keep the `holder || index !== view.account` filter. `others` already leaves out the holder.
2. **Use it for the tie lists only:**
   - `whose(address)` already sends outputs and found inputs to `staked`, or to `all` when `ours`.
   - Add a separate any-key `byStake` for the certificates', withdrawals', proposals' and recipients' entries in `certified`.
3. **Keep `yours`, the line's naming, by stake key alone.**

**Correction to the suggested fix:** byStake calls byKeys, and the one result sets both `yours` (via `named`) and `certified`. So the literal "in byKeys's stake slot and in byStake" sets `yours`, and the proposal line then says "comes back to the stake key of your public account" (mutant M1). The two uses have to be split, as in M2 (`r2-verify-reverse-split.diff` in the scratchpad's `review/work/`).

**Text:** even split, the page says both "a stake key that isn't yours" and "names the stake key of your public account". The `certified` and `staked` warnings also call a payment or DRep key's hash "the stake key of". A clean fix needs new critical strings (e.g. "a key of {{name}}"), back-translated in es and ja, as the finding says.

**Docs-only alternative, if the owner keeps the behaviour:** list it under "Not covered" in architecture.md:568, and say it in privacy.md:192, whose list of when a public account is "in" a session's transaction it contradicts.

**Tests for dapp-ties.test.ts.** Each of these fails on today's tree:
- S3 (00‖stranger‖pay0/0): staked `[{account:0}]`.
- S6 (registration of pay0/0): certified `[{account:0}]`.
- S5 (registration of the DRep hash): certified `[{account:0}]`.
- P1 and P2 (session 0's payment key): `[0]`, with no "isn't in it".
- A proposal returning to e0‖pay0/0 never says "comes back".

## Lens tests

### What it checked

I checked this in sandbox r172-pr358 at the merged state. Its wasm/pkg (sha 493bb0d9…) is the one built from the merged cip30.rs.

**Runs.** I ran each file twice, and every run passed:
- dapp-ties 30/30, dapp-ties-accounts 14/14, dapp 47/47, dapp-prompt 21/21
- own-account-names 5/5, screens-wiring-review-fixes 48/48, own-address 7/7
- cip30_test 48/48

I also ran all seven Vitest files with test order shuffled (seeds 7 and 1234): 172/172 both times. Under taskset on 2 CPUs the slowest new test, own-address's FARTHER_KEYS case, took about 1.5 s against the 5 s default timeout. The seeds and the async waits fail loudly when they miss, so I found no order, timing or seed risk.

`npm run typecheck` is clean. i18n.test.ts fails only on the three expected machine drafts.

**Mutants.** Logs are in scratchpad review/work/r2-tests/mut-*-log.txt; the runners are review/work/r2-tests-mutants*.
- **Killed:**
  - `ties`: T1–T9 and T12–T14. These cover the stake, DRep and session-stake lookups in `byKeys` and `ours`, `holderStake` (T6 and T14, killed by the lead's own session-own-stake case), `whose`'s label, the recipients, the deposit-own gate and the X06 site filter.
  - proposalLine P1–P5; the callout tone D1–D3; StakedWarning S1–S3.
  - en text E1–E3. E3 is killed only by own-account-names: the screens-wiring Nth case computes its expected text from the same key, so it pins the wiring, not the words.
  - FARTHER_KEYS set to 499, 501 or 1000, a loop that includes the limit, and receive-only: all killed by own-address.
  - Rust R1–R8: enterprise-only, no pointer, no stranger's stake part, scripts in recipients, this network only, any key address, network check for keys only, first recipient only. All killed by cip30_test.
- **D4 was an equivalent mutant**, so it doesn't count as a survivor.
- **Survived:** T10, T11 and W1, the three findings.

**Vacuous assertions.** Every `not.toContain` names text the page shows under some killed mutant. The send-own, withdraw-own and dapp-unknown test ids exist. The empty-tie controls in the "contract's reward account" case and the "session's own stake key" case are deliberate. The contract case's real assertion is WebAssembly's empty `recipients`.

**Fixtures.**
- The hand-built summaries carry `recipients: []` and pass typecheck.
- WebAssembly always emits `recipients`, pinned through its JSON.
- No e2e or JSON fixture carries a DappTxSummary proposal.
- The hand-built treasury CBOR decodes to the expected recipients.
- es `_many` matches `_other`, so the ICU version doesn't matter.

**Existing tests the merge touched** still assert what they did:
- the chunk 39 lines in dapp-ties and dapp.test;
- dapp-prompt's fixture;
- the `publicKeys` stub, which now carries drep;
- the four reshaped cip30 tests, whose first shape is the old enterprise case.

**Restored.** I ran checkout, clean and apply as the brief says. The sandbox diff is byte-identical to merged-fixes.patch, no zz- file is left, and the main checkout is untouched.

### r2-tests#0

**r2-tests#0 · low** · `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2390`

**Only the first public account's DRep key is ever tested: deriving it for that one alone passes every test**

**Outcome: fixed.** dapp-ties-accounts.test.ts pays Account 3's DRep key's own address from a session and Account 2's from Account 1; the first-account-only mutant fails both.

*Claim:* own#0's fix makes `publicKeys` derive the DRep key of every known public account (dapp.ts:2390), so an address paid to any of them ties that account. Only one test covers a DRep key: dapp-ties.test.ts:396, in a one-account wallet, paying account 0's own DRep key. dapp-ties-accounts.test.ts, the three-account harness, has stake-key cases only. Nothing pins the 'every account' part of the fix.

*Failure:* The mutant `if (index === 0) drep.set(...)` passes all 44 tests in dapp-ties and dapp-ties-accounts. A refactor that derives only the active account's key, as moving the line into the `withKeys` block would, behaves the same in these tests. Under it, take a wallet with three public accounts and a site on private session 1. The site asks for a signature on a payment to 60‖Account 3's DRep key hash. ties, staked and certified all come back [] and the window ends "Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it." That is the false line own#0 was fixed for, and every test stays green.

*Evidence:* - Mutant T10, run on tests/dapp-ties.test.ts and tests/dapp-ties-accounts.test.ts in sandbox r172-pr358: 0 failed / 44.
- A scratch case on dapp-ties-accounts' harness (tests/zz-r172-r2-tests-gaps.test.ts, since deleted; written up in scratchpad review/work/r2-tests-gaps-cases.md) paid `60${Account 3's drepOf().hash}` from session 0.
  - At the merged state: ties [{account:2}].
  - Under T10: ties [] and the sentence above.
- Mutants T2 and T5, which drop the DRep lookup from `byKeys` and from `ours`, are killed by dapp-ties.test.ts:396.

*Suggested fix:* Add a case to dapp-ties-accounts.test.ts: a session's prompt paying `60${(JSON.parse(cardano.drepOf()) as { hash: string }).hash}` for Account 3 (withAccount(2)) expects ties [{ account: 2 }], staked [], paid[0].yours undefined, and no "aren't in it". Optionally add a public prompt on Account 1 paying Account 2's DRep address, expecting [{ account: 1 }].

*Trace (confirmed, low):* I traced the code and ran the mutants myself. Nothing refutes the finding.

**The fix covers every account.** `publicKeys` (dapp.ts:2377-2402) calls `add` for the active account inside `withKeys`, then for each account in `[dappAccount, ...knownAccounts]` other than the active one. Line 2390, `drep.set(drepOf().hash, index)`, sits inside `add`, so every known account's DRep key goes into `accounts.drep`. `byKeys` (2269) and `ours` (2305) then look up an output's payment credential there. That every-account reach is part of the design:
- the fix report says "from each known account's drepOf().hash";
- the doc comment says "the DRep keys of every public account the wallet knows";
- the outcomes record own#0 as fixed in both directions.

It's live in production: sw.ts:209 passes `knownAccounts` in `spends`, and DappService receives `...spends` at sw.ts:265.

**Only account 0's DRep key is tested.** The only test that touches DRep ties is dapp-ties.test.ts:396. It runs in a one-account wallet (its `on()` adds no accounts) and pays the active account 0's own DRep hash. dapp-ties-accounts.test.ts only threads `drep` through a stub of `publicKeys` (380-384) and never pays a DRep address. Its other-account cases are stake keys only (`60${stake2}` at 342). No other test reaches it: `drepOf` appears in tests only at dapp-ties.test.ts:400 and in the governance tests, which cover the account's own certificates.

**Both mutants survive.**
- T10 (`if (index === 0) drep.set(...)`): 44/44 in the two ties files, and 395/395 across the 28 dApp-related test files.
- T10b, which moves the `drep.set` into the `withKeys` block so only the active account is derived (the refactor the finding names): it typechecks, and passes 44/44 and 395/395 the same way.
- Under either one, a session's prompt paying `60‖Account 3's DRep hash` gets ties, staked and certified all `[]`. The window then shows the false line the finding quotes.

The severity is right. It's an unpinned part of a fix, which the brief rates low. The scenario needs a hostile site that knows another account's DRep hash, as own#0 itself did.

**The suggested test kills both mutants, with one correction.** dapp-ties-accounts.test.ts's only render helper, `shownNamed`, hard-codes `session: false`. A public render with empty ties says "Your private balance isn't in it.", so a `not.toContain("aren't in it")` check on `shownNamed`'s output would pass even under the mutant. The page check needs a render with `session: true`, or a check for the positive line.

*Trace's evidence:* Sandbox `r172-pr358`. Before I started, `git diff --binary` matched `review/merged-fixes.patch` byte for byte. At that state the two ties files pass 44/44.

**Code read:**
- extension/src/background/dapp.ts:
  - 2386-2391: `add`, with `drep.set` at 2390.
  - 2392-2400: the `withKeys` block for the active account, then the loop over the dApp account and the known accounts.
  - 2265-2270: `byKeys` looks up `accounts.drep.get(spender)`.
  - 2305: `ours` checks `accounts.drep.has(payment)`.
- extension/src/background/sw.ts:209 and 265: `knownAccounts` is wired to the DappService.
- tests/fakes.ts:718: the test harness wires it the same way.
- en.json: `dappUi.privacy.notAccountNorPrivate` is "Your public account and your private balance aren't in it.", and `dappUi.privacy.notPrivate` is "Your private balance isn't in it."

**Mutants** (applied with my script, `review/work/r2-v-t10/mutate.py`):
- T10: tests/dapp-ties.test.ts + tests/dapp-ties-accounts.test.ts 44/44 passed. 28 dApp-related files (dapp*.test.ts, own-account-names, own-address, tx-view, session-site-outs, public-mix-stopped-runs, accounts, i18n-critical-helpers, screens) 395/395 passed.
- T10b (`drep.set(..., account)` inside `withKeys`, removed from `add`): `tsc` reported errors only for unused helpers in my scratch file, so the mutant itself typechecks. 44/44 and 395/395 passed.

**Scratch cases** (`tests/zz-r172-r2-v-t10-drep.test.ts`, built on dapp-ties-accounts' three-account harness; copy kept at `review/work/r2-v-t10/zz-r172-r2-v-t10-drep.test.ts.txt`):
- **V1**, session 0 paying `60${withAccount(2) drepOf().hash}`:
  - Merged: ties `[{account:2}]`, staked `[]`, certified `[]`, yours `[undefined]`, the row "An address". The window says "It moves money between this private session and Account 3 · Savings. Signing ties them together on chain, where anyone can see it. Signing ties this transaction to the session's one-time account."
  - Under T10 and T10b: `[[],[],[]]`, and the window says "Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it." The test fails with "expected [] to deeply equal [ { account: 2 } ]".
- **V2**, a public prompt on Account 1 paying `60${Account 2's DRep hash}`: merged `[{account:1}]`; under both mutants `[]`, so it fails.
- **V3** (control): a session paying Account 1's DRep gives `[{account:0}]` under both mutants. That's why dapp-ties.test.ts:396 can't tell them apart.
- **V4**: the three accounts' DRep hashes are distinct (b2a7f53b…, 6b1ecc8b…, 519c9192…).

The reviewer's T2 and T5 logs (`review/work/r2-tests/mut-T2*.json`, `mut-T5*.json`) each show 1/44 failing, at dapp-ties.test.ts:396. That matches the finding.

**Restored:** I ran `checkout`, `clean -fdq` and `apply --binary merged-fixes.patch`. The diff is byte-identical to the patch again, there are no untracked files, `wasm/pkg` and `node_modules` are intact, and the ties files pass 44/44.

*Trace's fix note:* The fix is tests only, in tests/dapp-ties-accounts.test.ts.

1. **In "a private session's signing prompt, with several public accounts":**
   - Get Account 3's DRep hash: `const drep3 = await t.wallet.withAccount(2, ({ cardano }) => (JSON.parse(cardano.drepOf()) as { hash: string }).hash);`
   - Call `prompt(dapp, s, paying([SESSION_INPUT], [`60${drep3}`]))`.
   - Expect ties `[{ account: 2 }]`, staked `[]`, certified `[]`, and `summary.paid.map((p) => p.yours)` `[undefined]`.

   The suggested fix needs one correction for its page check. `shownNamed` hard-codes `session: false`, and that render says "Your private balance isn't in it.", so `not.toContain("aren't in it")` on it passes even under the mutant. Give `shownNamed` a `session` flag, or render SignTx with `session: true` inside the AccountsContext provider. Then assert that it contains "It moves money between this private session and Account 3 · Savings." and doesn't contain "aren't in it".

2. **Recommended rather than optional:** in the public describe, use `connectedPublicly` and pay `60${Account 2's DRep hash}`. Expect ties `[{ account: 1 }]` and staked `[]`.

Both cases pass on the merged tree, and both fail under T10 (`index === 0` only) and under T10b (only the active account derived, in `withKeys`). No source change is needed.

### r2-tests#1

**r2-tests#1 · low** · `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2341`

**Every TypeScript treasury-withdrawal case pays a single recipient: tying only the first one passes every test**

**Outcome: fixed.** The treasury cases pay a stranger first, then one of the wallet's keys, and two sessions' keys behind a stranger's; the first-only, last-only and first-of-the-wallet's mutants each fail.

*Claim:* pr357#0's fix has the worker tie each of a treasury withdrawal's recipients (`summary.proposals.flatMap((p) => p.recipients.map(...))`, dapp.ts:2341). The three TypeScript cases each pay exactly one recipient, one of the wallet's keys: dapp-ties.test.ts:423 and :616, and dapp-ties-accounts.test.ts:360. Only cip30_test.rs has several recipients, and it stops at WebAssembly's summary. Nothing pins the worker reading past the first.

*Failure:* The mutant `summary.proposals.map((p) => byStake(p.recipients[0]))` passes all 44 tests in dapp-ties and dapp-ties-accounts. Under it, a site on private session 0 asks for a signature on a treasury withdrawal that pays 5 ₳ to a stranger's reward address and then 5 ₳ to the public account's. WebAssembly reports both recipients, but certified comes back [] and the window says "Your public account and your private balance aren't in it." That is the false line pr357#0 fixed, and every test stays green.

*Evidence:* - Mutant T11, run on tests/dapp-ties.test.ts and tests/dapp-ties-accounts.test.ts: 0 failed / 44.
- A scratch case (same file, review/work/r2-tests-gaps-cases.md) built a withdrawal paying [e0‖44…, the public account's reward address].
  - At the merged state: recipients ["4444…", "e557…"] and certified [{account:0}].
  - Under T11: certified [] and the sentence above.
- The WebAssembly half is pinned: Rust mutant R8 (`.take(1)` in cip30.rs) is killed by a_treasury_withdrawal_says_whose_stake_keys_it_pays.

*Suggested fix:* In one existing case, put the wallet's key after a stranger's. For example, change dapp-ties.test.ts:430 to `withdrawsTreasury(`e0${"44".repeat(28)}`, [`e0${"44".repeat(28)}`, reward])`. Keep certified [{ account: 0 }] and expect recipients ["44".repeat(28), reward.slice(2)].

*Trace (confirmed, low):* I traced the code path and could not refute the finding. The merged code is right, but no test pins it.

The code: at dapp.ts:2341 the worker ties every recipient (`summary.proposals.flatMap((p) => p.recipients.map((key) => byStake(key)))`). `byStake` is `byKeys(undefined, key)[0]`, and the result goes into `certified` at :2362. WebAssembly keeps the map's CBOR order: cip30.rs:1567 runs `payments.iter().filter_map(...)`.

The TypeScript coverage: every case that builds a treasury withdrawal pays exactly one recipient.
- dapp-ties.test.ts:423 pays the public account's key.
- dapp-ties.test.ts:616 pays session 0's key.
- dapp-ties-accounts.test.ts:360 pays Account 3's key.
- dapp-ties.test.ts:444 is a fourth case the finding doesn't count. It pays one script, which WebAssembly drops. That makes the claim's "three cases" slightly short, but the conclusion stands: every case is single-recipient.
- I grepped `8302` and `treasuryWithdrawals` across tests/ and e2e/. No other test builds one: dapp.test.ts:1638 and tx-view-screen.test.ts:326 are UI-only fixtures.
- cip30_test.rs:1563 has two key recipients, but it only asserts WebAssembly's JSON. Its expected array has two hashes, so a `.take(1)` mutant fails there, which matches the reviewer's R8 log.

The mutants:
- The finding's mutant T11 (`summary.proposals.map((p) => byStake(p.recipients[0]))`) survives 44 of 44 tests in dapp-ties and dapp-ties-accounts.
- It also survives 319 of 319 tests across all 24 test files that import background/dapp, plus dapp-prompt and tx-view-screen.
- Two other variants survive the same 44 tests: last recipient only, and first of the wallet's recipients only (`.find`).

The failure scenario, reproduced with a scratch case on dapp-ties.test.ts's harness (site on private session 0; the withdrawal's deposit goes back to e0‖44…; it pays a stranger first, then the public account):
- At the merged state: recipients are ["4444…", "e557…"], certified is [{account:0}], and the certified line is shown.
- Under T11: certified is [], and the window says "Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it." That is the false line pr357#0 fixed, and every test stays green.
- The same happens with a different stranger key (e0‖55…).

Severity: this is a test gap, not a code defect, so it is low under the brief ("an unpinned fix").

The suggested fix is correct: I ran it and it does what it says. It doesn't pin "each", though: the last-only and `.find` variants still pass it, because the withdrawal pays only one of the wallet's keys.

*Trace's evidence:* Code and tests (sandbox):
- `src/background/dapp.ts:2334` (`byStake`), `:2341` (recipients), `:2362` (certified).
- `wasm/src/cip30.rs:1567-1578`: recipients in CBOR order.
- `tests/dapp-ties.test.ts:430` pays `[reward]`, `:450` pays `[f0‖cd…]`, `:621` pays `[e0‖session 0's stake key]`.
- `tests/dapp-ties-accounts.test.ts:366` pays `[e0‖stake3]`.
- `wasm/tests/cip30_test.rs:1563-1602`: JSON only.

Mutants, run with `review/work/r2-v-t11/run.py` (each file backed up, mutated, then restored with a hash check):
- First recipient only (T11):
  - SURVIVED, 0 of 44 failed (two ties files).
  - SURVIVED, 0 of 319 failed (all 24 worker-driving files plus dapp-prompt and tx-view-screen).
- Last recipient only: SURVIVED, 0 of 44.
- First of the wallet's only (`.find((t) => t !== undefined)`): SURVIVED, 0 of 44.

Scratch case (`zz-r172-r2-v-t11-recipients.test.ts`, built on dapp-ties.test.ts's harness; the withdrawal pays [e0‖44… or e0‖55…, the public account's reward address]):
- At merged: recipients `[["4444…","e557890352095f1cf6fd2b7d1a28e3c3cb029f48cf34ff890a28d176"]]`, certified `[{"account":0}]`, and "A certificate, withdrawal or proposal in it names the stake key of your public account: …" is shown.
- Under T11: certified `[]`. The sentence is "Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it." and there is no certified line.

The finding's suggested fix (dapp-ties.test.ts:430/:434):
- Passes at merged: 1 of 1 filtered, and 44 of 44 across both files.
- Kills T11: expected `[[],[],[{account:0}]]`, got `[[],[],[]]` at :432.
- Last-only and `.find` both SURVIVE it.

A stronger pin (dapp-ties.test.ts:621-628, withdrawal paying [e0‖44…, session 0's, session 1's]):
- Passes at merged (44 of 44).
- Kills all three mutants: certified came back `[]`, `[1]` and `[0]` against the expected `[0, 1]`.

Scratch files: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-v-t11/` holds `log-ties.txt`, `log-worker.txt`, `log-fixes.txt`, `scratch-merged.jsonl`, `scratch-T11.jsonl`, `mutants.json`, `gen.py`, `run.py` and `zz-r172-r2-v-t11-recipients.test.ts.txt`.

Sandbox: I ran the brief's restore command. Afterwards `git diff --binary` is byte-identical to `merged-fixes.patch`, and there are no untracked files.

*Trace's fix note:* The suggested fix is correct as given (verified), and it is the smallest one. In `tests/dapp-ties.test.ts`:
- Line 430 becomes `withdrawsTreasury(`e0${"44".repeat(28)}`, [`e0${"44".repeat(28)}`, reward])`.
- Line 434 expects recipients `["44".repeat(28), reward.slice(2)]`.
- `certified` stays `[{ account: 0 }]`.

That pins the worker reading past the first recipient, which kills T11 and the false "aren't in it" line. It does not pin "each": a last-only or first-of-the-wallet's-only (`.find`) worker still passes it.

To pin "each", pay two of the wallet's keys behind a stranger's in one withdrawal, using the two-session case at `tests/dapp-ties.test.ts:621`:
- The withdrawal becomes `withdrawsTreasury(own, [`e0${"44".repeat(28)}`, `e0${sessions[0]!.stake}`, `e0${sessions[1]!.stake}`])`.
- Expect certified `[0, 1]` and recipients `["44".repeat(28), sessions[0]!.stake, sessions[1]!.stake]`.
- The window line becomes "…names the stake key of your private session 1 and your private session 2: signing ties your public account to your private session 1 and your private session 2 on chain, where anyone can see it."

I verified this one too: it passes at the merged state and kills all three variants. Doing both changes keeps the private-session false line pinned and also pins "each". No source change is needed.

### r2-tests#2

**r2-tests#2 · nit** · `seedelf-platform/seedelf-web-wallet/extension/tests/screens-wiring-review-fixes.test.ts:1232`

**A screens-wiring test is named for Make public's total but asserts no total**

**Outcome: fixed.** Make public's review test reads its Total leaving; the leaving-sum mutant fails it.

*Claim:* The test "Make public's review warns, its total counting every payment already" checks only that withdraw-staked shows and withdraw-own doesn't. Nothing reads the review's Total leaving row, though the name says the total counts the payment.

*Failure:* A mutant in Withdraw.tsx:161 leaves a staked payment out of `leaving`, the same shape as #359's bug on Send. It passes this test and all 82 tests across screens-wiring-review-fixes, withdraw, own-account-names, account-recipients-side and send. Make public's review would then show "Total leaving your private balance 0.55 ₳" for a 600 ₳ payment.

*Evidence:* - Mutant W1: 0 failed / 82.
- With the assertion below added, the test passes at the merged state (W2) and fails under W1 with "expected '0.55 ₳' to be '600.55 ₳'" (W3).
- Logs: scratchpad review/work/r2-tests/mut-withdraw-log.txt and mut-withdraw2-log.txt.

*Suggested fix:* Add `expect(row(page, "withdraw-review", t("review.total.private"))).toBe(ada("600550000"));` to the test, or drop "its total counting every payment already" from its name.

## Lens docs

### What it checked

Sandbox: /home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-release (paths below are relative to it). I made no edits. `git apply --check --reverse --binary review/merged-fixes.patch` passes and there are no untracked files, so the sandbox is still in the merged state. My scratch files are only in the scratchpad's review/work/r2-docs-*.

**development.md's second-build block.** I traced it as the owner would paste it right after part 2's block, in the same terminal, from extension/, in zsh or bash.
- `release_version` reaches the ( ) subshell as a copy of the shell's variables.
- `git worktree add --detach` at HEAD works from a subdirectory. The repo has no hooks, filters, submodules or .gitattributes.
- `npm ci` works in a fresh tree: package.json has no `@seedelf/wasm` dependency, because Vite aliases ../wasm/pkg, which the build makes.
- `env -u CARGO_TARGET_DIR npm run package` runs build:store, which runs ../wasm/build.sh from the worktree.
  - build.sh takes `here` and `workspace` from its own path, so `target=${CARGO_TARGET_DIR:-$workspace/target}` is the worktree's seedelf-platform/target. That is the same folder cargo picks by default for `--manifest-path wasm/Cargo.toml`.
  - Nothing redirects it: no .cargo/config.toml in the repo or ~/.cargo, and no CARGO_BUILD_TARGET_DIR.
- package.mjs builds the zip path from its own URL (`join(extension, "release", …)`), so it writes the worktree's release/ and never the main tree's.
- There are no .env files that a fresh tree would lack.
- /tmp is a 31 GB tmpfs. The wasm target is about 275 MB and node_modules about 104 MB, so it fits.
- `git worktree remove --force` runs from the main tree. It leaves only the empty mktemp folder, which is harmless.
- The block has no `set -e`, no `exit` and no placeholders.

**Other release steps.**
- The new `stat -c %s` line is in place, and `release_version=1.7.2` matches package.json.
- Part 3 step 7 and step 13 now point at releases.md's *Recording a release*.
- releases.md and development.md agree on the size, the second build and the token decimals.
- roadmap-v1.md does hold 1.0.0's and 1.1.0's full records.
- plans/README.md's tag line matches release.yml's `"*.*.*"`.

**Links.** I ran a link checker over 61 live .md files (479 links, anchors checked with GitHub's slug rules) and tested it on planted breaks first. Nothing is broken, and #send-and-make-public resolves.

**Old wordings.** Grepped the live docs, READMEs, the store policy and code comments for "comes back to your private session", "only for a certificate or a withdrawal", "own enterprise address" and "a certificate or a withdrawal". The only hits are the new wording, test names, and dapp.ts:2229, a comment that goes on to cover proposals.

**Docs against code (read):**
- **architecture.md:** `owner` uses `of_hash` under any staking part (cip30.rs:1095-1132). The DRep key is refused over inputs it can't find. The `ties` logic (`spender`, `ours`, `holderStake`) and `recipients` match. Proposal refusals are at cip30.rs:1549-1558, and the callout tone is right.
- **flows.md:** Send's `stakedOther` warning matches. The sign window's lines match en.json.
- **keys-and-accounts.md:** signData goes by the stake address (cip30.rs:2111). The balance walk goes 20 past the last used key (chain.ts:121-138). own#1 and own#2 are accurate.
- **privacy.md:** the Make public rule matches destination.ts and `withdraw.warn.staked`.
- **backlog.md:** each new line matches its source: chunk 39's As built, review-1.7.0's *Lessons*, roadmap.md:74 for pr327#0, roadmap.md:125 for L13, post-release-roadmap.md:397, and tx-view's `markYours`. Format, areas and IDs are consistent.
- **chunk-38's corrections:**
  - `wallet_contract` has used `ShelleyDelegationPart::Null` since 2c67e94c, so from CLI 0.5.0; CLI 0.4.10 used the staked form.
  - The contract is read by its payment credential (contract-scan.ts:148).
  - `account_mint` is Plutus V3 with the account's collateral.
  - `withdraw_zero.rs` is used by Lovejoin.
  - probe-governance.mjs uses additionalUtxo; probe-staking.mjs doesn't.
  - `https://*/*` is an optional host permission.
  - The db-sync options JSON, the 13.7.0.1 version and the 21 GB / lsm figures match chunk 26.
  - Lace at e431933 pins `@midnightntwrk/ledger-v9` 1.0.0-rc.3, and its builder refuses an account with no cNIGHT and puts every cNIGHT UTxO in as inputs.
  - "line 25's rule" does point at line 25.

**Tests run:**
- dapp-ties, dapp-prompt, own-address and dapp-ties-accounts: 72 passed.
- i18n, i18n-critical-helpers and words: only the expected es/ja failure, for the three new keys.

**Not filed:** the 1.7.2 review record isn't in the tree yet, but FINDINGS-draft.md names it as archive/plans/review-1.7.2.md, so it's planned.

### r2-docs#0

**r2-docs#0 · low** · `seedelf-platform/seedelf-web-wallet/docs/privacy.md:106`

**A payment to a stake key's own address is called a move into the session or account, which never sees that money**

**Outcome: fixed.** privacy.md:106 says what a session's stake key keeps (a treasury withdrawal's pay, an output paid to its hash), backlog L2's line too, and a backlog line for the window's moves line.

*Claim:* pr358#0 puts an output paid to a wallet key's hash into `all`: a session's stake key, a public account's stake key, or a public account's DRep key. The window's privacy callout then says "It moves money between your public account and your private session 1", or the reverse from a session.

Nothing in the wallet ever reads that UTxO:
- A session reads and disconnects by its payment key only.
- session_return refuses any UTxO that isn't under that key.
- The restore scan and the public balance read payment keys only.

So money said to move to a session goes where the wallet never brings it back. That is the untruth critic#0 removed from the proposal line, now on the output path, where these two fixes meet.

privacy.md:106 lists "an output paid to its hash" among what puts a session's stake key in another account's transaction. It then names only the two deposits as what stays under that key, and backlog.md:90 does the same, so the docs imply the output comes back with the session's UTxOs.

*Failure:* 1. A site that once had private session 1 got its reward address through getRewardAddresses. It is now on the public account.
2. It asks the wallet to sign a payment of 100 ₳ to enterprise(session 1's stake key hash).
3. The window shows the row as "An address", Total leaving 100 ₳ plus the fee, and "It moves money between your public account and your private session 1. Signing ties them together on chain…". The user takes it as a move into their own session and signs.
4. The 100 ₳ never shows anywhere in the wallet, and neither the session's return nor Disconnect brings it back. After Disconnect, only a hand-built transaction signed with 24301'/2/0's key can spend it.

The other direction is the same: a session's site paying enterprise(the public account's stake or DRep key hash) reads "It moves money between this private session and your public account", and the balance never shows the money.

*Evidence:* Read, plus a test run.
- **The tie:** dapp.ts:2298-2310: `ours` is true for a payment credential found in `accounts.stake`, `accounts.drep`, `holderStake` or the other sessions' stake keys. :2330 puts it in `all`, and :2263-2283 (`spender`) ties it. DappApprovals.tsx:1117 shows `tiesLine`.
- **Pinned wording:** dapp-ties.test.ts:598-608 ("It moves money between your public account and your private session 1.") and :345-359. Ran: 72 passed.
- **Never read:**
  - sessions.ts:5686-5691: `listing` uses `credentialUtxos([keyHash])`, the session's payment key; dapp.ts:1623, the connector's read of a session's account, uses it.
  - wasm/src/lib.rs:1404-1413: `session_return` refuses a UTxO that isn't at the session's account.
  - sessions.ts:2648: the restore scan reads payment keys.
  - account.ts:1-12: the balance reads payment keys only.
- **critic#0's own trace:** "your private session" means the session's UTxOs.

*Suggested fix:* Say it, as critic#0 did for the deposit.
- In privacy.md:106, add that an output paid to the session's stake key's hash stays there too, since the return, Disconnect and the restore scan read its payment key's UTxOs only.
- Give backlog.md:90 the same clause.
- Whether the window says it too is the owner's call on UI text: a line of its own for an output tied only by a stake or DRep key's hash ("…which the wallet never reads or brings back"), as a critical key.

*Trace (confirmed, low):* I traced every step, tried to refute each one and couldn't. The finding holds as a docs defect, at low.

**The window.** On a public prompt, `ours` (dapp.ts:2298-2310) is true for a payment credential that is another session's stake key, or a public account's stake or DRep key. dapp.ts:2330 puts it in `all`, so DappApprovals.tsx:1115-1118 shows a warn-toned callout: "It moves money between your public account and your private session 1. Signing ties them together on chain" (en.json:495). The row still reads "An address" (`whose(…, true)`), and WebAssembly counts the output as leaving. Two tests pin this wording, dapp-ties.test.ts:598-608 and its reverse at :345-359, and both pass.

**Step 1 is reachable.** `indices` (sessions.ts:2539-2541) covers every index below `book.next`, ended sessions included. So a site whose session was disconnected, and which then reconnects publicly, still gets session 1 named.

**Nothing in the wallet ever reads that UTxO.** Every `credentialUtxos` call in the worker asks only for payment keys, Seedelf's contract or Lovejoin's:
- the session listing, sessions.ts:5690 (which the connector uses through `accountUtxos`);
- Disconnect, :2390;
- the restore scan, :2648;
- the dApps page's refresh, :5376;
- the public balance, account.ts:115.

`session_return` (wasm/src/lib.rs:1404-1413) refuses any UTxO that isn't under the session's payment key. So that money is stranded under 24301'/2/i: still the user's by key, but out of the wallet's reach.

**The docs.**
- privacy.md:106 lists "an output paid to its hash" as a way a site ties the session's stake key. It then names only the two deposits as what stays there, and gives the reason "the session's return and Disconnect read its UTxOs only". An output paid to the session's stake key's hash is a UTxO that key spends, which is #358's own rule. So the sentence invites the wrong reading that the return takes it.
- Two other places already say the opposite: privacy.md:192 for the public accounts' keys, and architecture.md:568 for both sides ("since the wallet never reads it"). Only the session's own paragraph, the one place that lists what a session leaves behind, leaves it out.

**What the finding overstates.**
- The "untruth critic#0 removed" comparison goes too far. critic#0's line said the deposit "comes back". This line is about the tie on chain, and that tie is real. The output's row stays "An address", the label round one kept for exactly this reason. So the window misleads; it doesn't state something false. That, and the reach, keep this at low rather than medium. The reach: only a site crafting a payment to a stake or DRep key's hash on purpose, which no wallet hands out. Nothing is stolen, and the user's own key still spends it.
- backlog.md:90 says nothing false. Adding the clause there is for completeness, not a correction.

I changed nothing in the sandbox. I ran only the two Vitest files, and `git diff --binary` is byte-identical to merged-fixes.patch, with no untracked files.

*Trace's evidence:* Read in the sandbox, and one test run.
- **The tie:** dapp.ts:2263-2283 (`byKeys`, `spender`), 2288-2291 (`whose`, the label), 2297 (`holderStake`), 2298-2310 (`ours`: accounts.stake, accounts.drep, holderStake, others' stake keys), 2330 (into `all`).
- **The window:** DappApprovals.tsx:1115-1118 (warn-toned callout, testId dapp-ties); ui/dapp.ts:63-65 (`tiesLine`); en.json:495 (`dappUi.ties.privacy.moves`).
- **Pinned and run:** dapp-ties.test.ts:345-359 and :598-608 assert "An address" and the moves line. `npx vitest run tests/dapp-ties.test.ts tests/dapp-ties-accounts.test.ts`: 44 passed.
- **Reachability:** sessions.ts:2539-2541 (`indices` covers 0 to book.next, ended sessions too).
- **Never read** (each by payment key only):
  - sessions.ts:5686-5691 (`listing`), :2846-2852 (`accountUtxos`, which the connector's session view uses at dapp.ts:1623), :2390 (Disconnect), :2648 (restore scan), :5376 (refresh), :5905-5918 (keyHash = oneTime.keyHash);
  - account.ts:115 (public balance);
  - wasm/src/lib.rs:1404-1413 (`session_return` refuses any UTxO not under the session's payment key).
  - A grep of every `credentialUtxos(` call in src/background found no stake or DRep key hash asked for.
- **Docs:**
  - privacy.md:106 lists "an output paid to its hash" but names only the registration's and the proposal's deposits as what stays, behind "read its UTxOs only".
  - privacy.md:192 and architecture.md:568 both say "the wallet never reads it".
  - backlog.md:90 names the deposits only.
- **Sandbox:** unchanged. `git diff --binary` matches merged-fixes.patch byte for byte, with no untracked files. The scratch file I wrote in review/work is deleted.

*Trace's fix note:* The fix is docs only, and the suggested fix is right. I'd add one wording change: the loose "its UTxOs" is what invites the wrong reading.
- **privacy.md:106:**
  - Change "the session's return and Disconnect read its UTxOs only (L2)" to "the session's return and Disconnect read the UTxOs under its payment key only (L2)".
  - Then add: "So does an output paid to its hash, whose row still reads "An address": the return, Disconnect and the restore scan never read it (1.7.2's release review, pr358#0)."
  - The sentence before it already says the prompt names the session and warns of the tie, which is true.
- **backlog.md:90 (optional):** append "An output paid to its hash stays there too: the return, Disconnect and the restore scan read the payment key's UTxOs only (pr358#0)."
- **No code or string change.** A window line saying such an output is "never read or brought back" would need a new critical key in en, es and ja, back-translated. That's UI text for a crafted-only case and the owner's call. If it's recorded, use a backlog line under *Signing and the connector*, as own#2 was handled. Don't change the moves line or the "An address" label.
- **Optional, same sentence:** what a treasury withdrawal pays the session's key also lands in its reward account, which the wallet never withdraws, the same as a proposal's deposit.

### r2-docs#1

**r2-docs#1 · nit** · `seedelf-platform/seedelf-web-wallet/docs/keys-and-accounts.md:155`

**keys-and-accounts.md says the farther look reaches index 500; it stops at 499**

**Outcome: fixed.** "the 500th" in keys-and-accounts.md and architecture.md.

*Claim:* The edited sentence says "Under the account's stake key, its own payment keys are looked for up to index 500 on each chain". `is_own_address` loops `0..OWN_KEYS_STAKED` and `fartherKeys` runs while `i < FARTHER_KEYS`, so the last index looked at is 499. privacy.md:65 and :192 and backlog.md:102 say "the 500th", which is right. architecture.md:568 and :691, both unchanged, also say "index 500".

*Failure:* A developer checks key 1/500 under the account's stake key against the doc and expects Send to call it the account's. It reads as someone else's (`staked`), which is what own-address.test.ts's new case pins.

*Evidence:* Read. wasm/src/lib.rs:4918-4929; extension/src/background/chain.ts:164. tests/own-address.test.ts's new case expects `FARTHER_KEYS - 1` to be reached and `FARTHER_KEYS` not to be, and it passed when I ran it.

*Suggested fix:* Write "up to the 500th on each chain" in keys-and-accounts.md:155, and in architecture.md:568 and :691.

### r2-docs#2

**r2-docs#2 · nit** · `seedelf-platform/seedelf-web-wallet/docs/keys-and-accounts.md:139`

**keys-and-accounts.md's DRep key list leaves out collateral, which the stake key's list includes**

**Outcome: fixed.** keys-and-accounts.md's DRep key line names collateral.

*Claim:* The DRep line ends "and an input at an address paid to its hash (#358)". The stake key's line at :134 says "an input or collateral". In the code, collateral goes through the same `owner` closure as inputs, and `of_hash` returns `Drep` when governance is granted. So the DRep key also signs for collateral at such an address, and it's counted as the account's (`collateral.own`). The difference between the two lines reads as deliberate, and it isn't.

*Failure:* Someone bounding the DRep key's powers from this list concludes that a site granted CIP-95 can't put up a UTxO at the DRep key's address as collateral under the DRep key's witness. It can.

*Evidence:* Read. wasm/src/cip30.rs:474-483 (`of_hash`), :1095-1132 (`owner`), :1155-1163 (the collateral loop calls `owner` and `signers.insert`).

*Suggested fix:* Write "and an input or collateral at an address paid to its hash (#358)".

### r2-docs#3

**r2-docs#3 · nit** · `seedelf-platform/seedelf-web-wallet/docs/privacy.md:174`

**privacy.md still lists the DRep key's signatures for a governance site as certificates, votes and messages**

**Outcome: fixed.** privacy.md's CIP-95 paragraph lists what the DRep key signs for, pointing at keys-and-accounts.md.

*Claim:* The CIP-95 paragraph says the site "can ask the DRep key to sign: the account's own DRep certificates, its votes, and messages as the DRep". Since #358, a site with CIP-95 also gets the DRep key's witness to spend an input or collateral at an address paid to its hash. Since chunk 21 it also gets it for a required signer that names the key. keys-and-accounts.md:139, rewritten for pr358#2, lists these now, so the two docs disagree.

*Failure:* A reader of the privacy doc believes a site given governance can only get DRep certificates, votes and messages signed. In fact it can also have the DRep key witness a transaction that takes the money at the DRep key's own address.

*Evidence:* Read. wasm/src/cip30.rs:1095-1132 and :1209-1218 (required signers go through `of_hash`); docs/keys-and-accounts.md:139.

*Suggested fix:* List them as keys-and-accounts.md:139 does, or point to it.

### r2-docs#4

**r2-docs#4 · nit** · `seedelf-platform/seedelf-web-wallet/docs/backlog.md:107`

**The backlog's pr358#3 line still says the stake key spends only at its own address**

**Outcome: fixed.** The backlog's pr358#3 line says an address paid to the key's hash.

*Claim:* The title says "…when the stake key only spends a UTxO at its own address". pr358#2's rule, now in architecture.md:562 and keys-and-accounts.md:134, is any address paid to the key's hash, whatever its staking part, base and pointer addresses included. This is the narrower wording the fix replaced elsewhere.

*Failure:* Whoever picks the line up fixes the signer row's words for the enterprise address alone, so a base or pointer address paid to the stake key still reads "It signs for your staking".

*Evidence:* Read. wasm/src/cip30.rs:1115-1123; wasm/tests/cip30_test.rs `paid_to`, which loops over enterprise, both base forms and pointer.

*Suggested fix:* Write "…spends a UTxO at an address paid to its hash".

### r2-docs#5

**r2-docs#5 · nit** · `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-38-midnight.md:134`

**The Midnight plan's summary still has Generate DUST built beside staking**

**Outcome: fixed.** The Midnight plan's summary builds Generate DUST beside `build::account_mint`.

*Claim:* Line 134 says Generate DUST is "a Cardano transaction built in core beside staking". Line 187, pr354#3's correction, says it's built beside `build::account_mint`, because `account_staking` pays nobody and mints nothing. The plan's own summary contradicts its step.

*Failure:* A developer who starts from the plan's "Where it touches the wallet" list models Register on `build::account_staking`, which is what pr354#3 set out to prevent.

*Evidence:* Read. docs/plans/chunk-38-midnight.md:134 and :187; seedelf-core/src/build.rs:3866 (`account_mint`).

*Suggested fix:* Write "built in core beside `build::account_mint`".

## Lens critic

### What it checked

Completeness critic, round two, in the sandbox /home/logic/Documents/LogicalMechanism/Seedelf-Wallet/.claude/worktrees/r172-critic. I restored it at the end (checkout, clean, apply). `git diff --binary` is byte-identical (cmp) to merged-fixes.patch, no zz- file is left, wasm/pkg is still 493bb0d9…, and cip30.rs is back from its mutant. I didn't touch the main checkout.

**Seams between the fixes**
- I compared each fixer's patch with the merged patch file by file. The Rust is identical to the ties fixer's, so its clippy and fmt runs hold. ui/dapp.ts, DappApprovals.tsx, StakedWarning.tsx, destination.ts and rpc.ts are identical too.
- dapp.ts differs only by the lead's `holderStake` clause in `ours`.
- The hand merge of dapp.test.ts, dapp-prompt.test.ts and dapp-ties.test.ts lost none of either fixer's added lines. The one differing line is the window fixer's proposal fixture, which only gained `recipients: []`.
- `holderStake`:
  - `byKeys` and `others` never see the holder, and the farther-key look skips such an address.
  - Removing the clause fails the lead's test. Its "alone" control passes either way, as a control should.
  - It changes nothing for the session's own stake key under no stake part or a stranger's.
- The window fixer's comments match the merged worker: `certified` gets a treasury recipient only when it's another of the wallet's key-hash stake keys.
- `proposalLine` still gives the session's own key the session line when `ties` throws.
- The callout tone covers every proposal shape, and the window gets `session` from `current.session !== undefined` (DappApprovals.tsx:319).

**Outcomes against the tree.** Every "fixed" entry in outcomes.json matches the merged tree:
- the code and test entries (pr357#0 and #2, pr358#0–#2 and #4, pr359#0–#4, own#0 and #3–#5, i18n#0–#1, critic#0–#1);
- release#0–#6;
- pr356#0–#6, including the three owner's-call and section lines and the archive header;
- the twelve corrections in chunk 38's plan.

**Files checked in full:** destination.ts, and lib.rs `is_own_address`/`OWN_KEYS_STAKED` against chain.ts.

**Docs read:**
- architecture.md:534, :562, :566 and :568;
- privacy.md:65, :98, :106 and :192;
- flows.md:227, :399 and :430;
- keys-and-accounts.md, backlog.md, releases.md and plans/README.md.

**development.md's second build:**
- build.sh remaps the workspace and target paths.
- There's no cargo wrapper and no global target dir on this machine.
- 1.7.1's record says a separate-checkout build gave the same bytes.

**Runs (sandbox):**
- The CI steps no lens ran:
  - `node --test wasm/tests/*.test.mjs`: 59/59 pass.
  - The seven touched Vitest files as CI's preprod-only build (`VITE_ENABLE_MAINNET=false`): 172/172 pass.
- Twenty-two guard and nearby files (spell-check, privacy-notes, i18n-joins, i18n-screens, i18n-worker-reasons, release-record, worker-words, swap-page-words, approvals-review-fixes, dapp-site-english, words, shown-text, the i18n-* guards, send, withdraw, account-recipients-side, tx-view, tx-view-screen, i18n): 343 pass. The 2 failures are the expected machine-draft ones, for exactly the 3 new keys.
- The e2e specs read none of the changed wording, and none has a Send with a staked destination.

**Probes:**
- Scratch Vitest on dapp-ties.test.ts's harness, with the real worker and WebAssembly. Copy at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-critic-committee.test.ts.txt, output at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/a3c0a33c-0c56-4ff9-92fc-cdc18e0d6253/scratchpad/review/work/r2-critic-committee-out.txt.
- One Rust mutant run with cargo.

**Seen but not raised** (they predate 1.7.2 and are no path of a round-one finding; neither checked with a probe):
- The worker never reads a collateral return the site's own collateral backs.
- dapp-own-key says "its staking rewards aren't yours" for the account's payment key under another of the user's accounts' stake keys.

### r2-critic#0

**r2-critic#0 · low** · `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1567`

**A committee update's members, and a committee hot key, are never matched against the wallet's keys: a session's prompt still says the public account isn't in it**

**Outcome: documented.** Not covered in architecture.md:568 and privacy.md:192, and a backlog line; architecture.md no longer says the committee's certificate names no key.

*Claim:* pr357#0's fix reads only `GovAction::TreasuryWithdrawals`. Its recipients go to `recipients` (cip30.rs:1567-1579), which ties() puts in `certified` (dapp.ts:2341).

The same class of field goes unread elsewhere:
- **A committee update:** `GovAction::UpdateCommittee(_, remove, add, _)` names committee cold credentials, key hashes that take no signature of theirs. A site can make one the public account's stake key hash or DRep key hash, or a session's stake key hash. Nothing reads them, so `ties`, `staked` and `certified` stay empty and the privacy line says the other side isn't in it.
- **A committee hot-key authorisation (certificate 14):** its cold key can be the site's script and its hot credential one of the wallet's key hashes. WebAssembly reports it with `credential: null`, so it ties nothing either. This one predates 1.7.2.

The docs written this round say otherwise:
- architecture.md:568: "A certificate, a withdrawal or a proposal that names another of the wallet's stake keys ties it too"; "the committee's certificate name[s] no key"; and "The prompt says the other side isn't in it only when it checked and found none of these".
- privacy.md:192: "One is in a transaction too when a certificate, a withdrawal or a proposal in it names that account's stake key".

*Failure:* A site on private session 1 asks it to sign an UpdateCommittee proposal. It adds [0, the public account's stake key hash] as a member until epoch 1000, and its deposit goes back to someone's registered key. The window reads: "Proposes a change to the committee. Its 1,000 ₳ deposit goes to a stake key that isn't yours, stake_test1upzyg…, when the action ends. Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it." The signed proposal names the public account's stake key hash on chain, the 28 bytes in every base address the account hands out. A treasury withdrawal to the same key now warns (certified [{account:0}]).

Other shapes give the same result:
- The DRep key hash as the member.
- A public prompt adding or removing private session 1's stake key hash: "Your private balance isn't in it."
- A hot-key authorisation from a script cold key whose hot credential is the public stake key hash, with partialSign: "aren't in it".

*Evidence:* I ran a scratch Vitest in my sandbox (tests/zz-r172-r2-critic-committee.test.ts, now deleted). It uses dapp-ties.test.ts's helpers, the real DappService and wasm/pkg 493bb0d9. The copy and its output are in the scratchpad's review/work/r2-critic-committee.test.ts.txt and r2-critic-committee-out.txt.

The proposal was `841a3b9aca00 581d<e0‖44…> 8504f680a18200581c<H>1903e8d81e820102 <anchor>`. Results:
- summary.proposals: [{action:"updateCommittee", own:false, recipients:[]}]. ties, staked and certified: [[],[],[]]. The page text is as quoted.
- DRep hash as the member: [[],[],[]], same page.
- Control, `withdrawsTreasury(e0‖44…, [e0‖H])`: [[],[],[{"account":0}]].
- Public prompt with session 1's stake hash, added or in the remove set: [[],[],[]] and "Your private balance isn't in it."
- Certificate `830e8201581c<77…>8200581c<H>`: certificates [{kind:"committee", credential:null}], [[],[],[]], and "aren't in it".

I read cip30.rs:1567-1579 (recipients only from TreasuryWithdrawals), dapp.ts:2341, architecture.md:568 and privacy.md:192 and :106. None of the four lenses' findings covers it: theirs are a wallet key's hash in a stake-credential position. Severity is low, as pr357#0 and L1 were: the site crafts it, and on mainnet funds a 100,000 ₳ deposit it can have back. The hot key also needs the site's script to be a committee member already.

*Suggested fix:* No refusal, either way.

**Option 1, read them:**
- In WebAssembly, give an UpdateCommittee proposal its added and removed key-hash credentials, and a committee hot-key certificate its hot key hash. Use `recipients` or a field of its own, scripts left out.
- In ties(), look each one up as any of the wallet's key hashes: payment, stake or DRep, and the sessions' payment or stake. That is `byKeys(hash, hash)` filtered as for an address. Put the results in `certified`.
- Pin it in cip30_test.rs and dapp-ties.test.ts.

**Option 2, document it.** Name both under architecture.md:568's "Not covered" and in privacy.md:192, and correct "the committee's certificate name no key".

### r2-critic#1

**r2-critic#1 · low** · `seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:966`

**cip30_test.rs's paid_to says it has every kind of address paid to a key hash but leaves out a base address with a script's staking part: an owner that skips those passes all 48 tests**

**Outcome: fixed.** `paid_to` has a base address under a script's staking part; the mutant that skips those fails the three tests.

*Claim:* pr358#1's fix pins `owner` with `paid_to` (cip30_test.rs:961-985). Its doc says "Every kind of address paid to a key hash: its own enterprise address, and the hash under the account's stake key, someone else's or a pointer".

It covers CIP-19 types 0 (twice), 4 and 6. It leaves out type 2: a base address paid to a key hash under a script's staking part. pr358#1's finding was about base addresses, so that shape is still unpinned. No other test in cip30_test.rs has a key-paid input under a script stake part, the account's own payment key included.

*Failure:* A later change to `owner` treats a script-staked address as a contract's and returns no signer for it. A UTxO at base(stake key hash, script) is then a stranger's again. That is #358's bounty bug for that shape: the site adds a reason for the stake key to sign, such as a required signer, its witness spends the UTxO, and the prompt shows nothing leaving. The account's own payment key under a script's staking part is read as a stranger's too. Every test still passes.

*Evidence:* I applied a mutant at cip30.rs:1118 in my sandbox:
`let signer = if matches!(s.delegation(), ShelleyDelegationPart::Script(_)) { None } else { keys.of_hash(h) };`

`cargo test -p seedelf-wasm --locked --test cip30_test` gave "48 passed; 0 failed".

I restored cip30.rs from a copy, and the sandbox's diff is byte-identical to merged-fixes.patch.

*Suggested fix:* Add a fifth shape to `paid_to`: ("base, a script's stake", with(ShelleyDelegationPart::Script(Hash::new([7; 28])))). The three reshaped tests then fail under the mutant. Or have the doc list what it covers instead of "Every kind".

### r2-critic#2

**r2-critic#2 · nit** · `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2237`

**ties()'s doc still says every output that's another of the wallet's is named (`yours`), two paragraphs after saying one paid to a stake or DRep key's hash stays "An address"**

**Outcome: fixed.** ties()'s doc names an output by its payment key.

*Claim:* The ties fixer rewrote the doc's last sentence. It now reads: "Each output, certificate, withdrawal and proposal (by its deposit) is named in the summary this returns (`yours`), where it's another of the wallet's."

By #358's rule, which the same doc states above (dapp.ts:2221-2227), an output paid to another account's stake or DRep key hash is that account's, and the code leaves its `yours` unset on purpose: `whose(p.address, true)` passes `label`. The sentence qualifies proposals ("by its deposit") but not outputs.

*Failure:* A developer takes the last sentence as the contract and sets `paid[].yours` from `whose(address)` without `label`. The Pays row then reads "Your public account" for an address the wallet never reads, the mislabel pr358#0's fix note warned against. The doc's own earlier paragraph and rpc.ts's `paid[].yours` doc say otherwise, so the comment contradicts itself.

*Evidence:* I read dapp.ts:2221-2239 in the merged tree. The sentence is the ties fixer's edit: fix-ties.patch changed "Each output, certificate, withdrawal and proposal is named…" to add "(by its deposit)". I also read rpc.ts:1057-1061, whose `paid[].yours` doc does carry the exception.

*Suggested fix:* Make it "Each output (by its payment key), certificate, withdrawal and proposal (by its deposit) is named…", or end the sentence with "bar an output paid to a stake or DRep key's hash".

## The back-translations

Each language by a fresh agent, no English in view and no tools, the placeholders filled as the screens fill them. Compared with the English by the lead: every clause held, nothing drifted.

## es-session-own

**English:** It [no subject in the Spanish; most likely the transaction being approved] proposes information, which [the information] doesn't change anything. The proposal's 100,000 ₳ deposit goes to the stake key of this private session [this website's one-time account, the one this approval is for] when the governance action ends, and the wallet never brings it [the deposit] back.

**Ambiguities:** Words in brackets in the English explain what a word refers to. They are not in the Spanish.
1) 'Propone' has no subject. It is most likely the transaction, or the website sending it. Grammatically it could also be formal 'usted' ('You propose'), but that is unlikely because message 2 uses informal 'tu'.
2) 'información' has no article. It most likely names the Info type of governance action, a proposal with no on-chain effect. Read literally, 'proposes information' is odd in both languages, and nothing marks it as a kind of proposal. An English reader may take it as 'proposes some information or data'.
3) 'que' refers to 'información'. If it meant the whole clause, Spanish would need 'lo que'. English 'which' after a comma can refer to the whole clause, so the gloss is needed. 'no cambia nada' doesn't say what stays unchanged, most likely the chain or protocol. A reader could take 'doesn't change anything' as 'costs or affects you nothing', which the deposit sentence contradicts.
4) '100,000 ₳' uses the comma for thousands. In Spain and most of South America the comma is the decimal mark, so a reader there could read it as one hundred ₳ (100 with three decimals). It almost certainly means one hundred thousand, and English readers read it that way.
5) 'va a la clave de stake ... cuando termine' says the deposit 'goes to' that key when the action ends. It doesn't say the deposit is refunded or returned there, and it never says the deposit is taken from the user now. A reader could think it is sent to that key now, or miss that it is a refund.
6) 'la propuesta' and 'la acción de gobernanza' are most likely the same thing, the proposed action. A reader could take them as two different things.
7) 'termine' most likely means the action ends in any way (enacted, expired or dropped), not only that it succeeds. 'terminar' can also be transitive ('when [someone] finishes the governance action'). That reading is grammatical but unnatural here.
8) 'esta sesión privada' is the private session this approval window is for, which is clear in context. Out of context, 'private session' could suggest a private-browsing session.
9) 'lo' can only be 'el depósito', the only masculine singular noun ('clave', 'sesión', 'acción' and 'propuesta' are feminine). So 'it' is the deposit. English 'it' is looser, which is why the gloss is there. 'trae de vuelta' doesn't say back to where, presumably the user's own account. 'nunca' doesn't say whether the user could recover the deposit another way, so 'never brings it back' may read as 'the deposit is lost for good'.

## es-session-other

**English:** It [no subject in the Spanish; most likely the transaction being approved] proposes a protocol parameter change. The proposal's 100,000 ₳ deposit goes to the stake key of your private session 2 [the private session numbered 2] when the governance action ends, and the wallet never brings it [the deposit] back.

**Ambiguities:** Words in brackets in the English explain what a word refers to. They are not in the Spanish.
1) 'Propone' has no subject, as in message 1. It is most likely the transaction or the website. Formal 'usted' ('You propose') is grammatical but unlikely next to 'tu'.
2) In 'un cambio de parámetro del protocolo', 'parámetro' is singular with no article, so it reads as the action type (a protocol parameter change). A reader could take it as exactly one parameter changing, which the Spanish doesn't say.
3) In 'tu sesión privada 2', '2' is the session's number or label, not a count. It is lowercase, unlike 'Cuenta 2' in messages 3 and 4, so it may not read as the session's name. In English, 'your private session 2' could read as 'your second private session'. The text never says whether session 2 is the session this website uses or a different one. Next to message 1's 'esta sesión privada' it implies a different one, but there is no 'otra' (another), so a reader may not notice that the deposit goes to a session other than this website's.
4) '100,000 ₳' has the same decimal-comma problem as message 1: a reader in Spain or most of South America could read one hundred ₳. It almost certainly means one hundred thousand.
5) 'va a ... cuando termine' says 'goes to', not 'is refunded to' or 'is returned to', and it doesn't say the deposit leaves the user now.
6) 'la propuesta' and 'la acción de gobernanza' are most likely the same thing.
7) 'termine' most likely means the action ends in any way (enacted, expired or dropped). The transitive reading ('when [someone] finishes') is unnatural.
8) 'lo' can only be 'el depósito', the only masculine singular noun, so 'it' is the deposit. English 'it' is looser, which is why the gloss is there. 'trae de vuelta' doesn't say back to where. 'nunca' doesn't say whether the user could recover the deposit another way, so 'never brings it back' may read as 'lost for good'.

## es-staked-other

**English:** This [address] is not your Account 2: it [the address] has that account's [Account 2's] stake key, but someone else's payment key, so only that person [whoever holds that payment key] can spend this [what is paid to the address]. Even so, paying to this address [the address being paid] links your two accounts [most likely the account paying and Account 2] to each other on the chain, where anyone can see it [the link].

**Ambiguities:** Words in brackets in the English explain what a word refers to. They are not in the Spanish.
1) 'Esta' is feminine and has no noun. It is most likely 'this [address]', agreeing with 'dirección' later in the message. 'cuenta' is also feminine, though, so 'this [account] isn't your Account 2' is a possible reading. English 'This' loses the gender cue. Taken literally, an address isn't an account: the sense is 'this address isn't your Account 2's', which is how message 4 puts it ('no es de').
2) 'tiene' has no subject. It is the address ('it').
3) 'esa cuenta' is your Account 2. 'otra persona' is someone else, whoever holds that payment key, and 'esa persona' is that same someone else. These are clear.
4) 'esto' is a neuter 'this' with no noun. It most likely means what you pay to this address (message 4 says 'ese pago', that payment). It could also be read as the address itself or as what is already at it. In English both 'Esta' and 'esto' become 'this', so 'spend this' could look like 'spend this address'.
5) 'Aun así' has no accent, so it means 'even so', not 'aún' (still or yet). The contrast it marks is implicit: although the address isn't yours and only someone else can spend the money, paying it still links your accounts.
6) 'tus dos cuentas' doesn't name the first account. It is most likely the account you're paying from, plus Account 2. 'your two accounts' could read as 'both your accounts', as if the user had exactly two.
7) 'lo' in 'verlo' most likely means the link between your accounts. It could also mean the payment ('pagar a esta dirección'), and both are visible on chain. In English 'it' could even be read as the chain, which Spanish rules out because 'cadena' is feminine. 'donde' refers to the chain.

## es-staked-other-nth

**English:** Recipient 2's address is not your Account 3's: it [recipient 2's address] has that account's [Account 3's] stake key, but someone else's payment key, so only that person [whoever holds that payment key] can spend that payment [the payment to recipient 2]. Even so, paying to that address [recipient 2's address] links your two accounts [most likely the account paying and Account 3] to each other on the chain, where anyone can see it [the link].

**Ambiguities:** Words in brackets in the English explain what a word refers to. They are not in the Spanish.
1) 'destinatario 2' is the second recipient, a position on the Send screen, while 'Cuenta 3' is an account's name. Two different numbers side by side could confuse a reader, though neither is ambiguous.
2) In 'no es de tu Cuenta 3', 'ser de' means 'belong to' ('isn't your Account 3's'). 'Isn't from your Account 3' would misread it as saying where the address came from.
3) 'tiene' has no subject. It is most likely the address, which is the subject of the main clause. Grammatically it could be 'el destinatario 2' ('recipient 2 has that account's stake key'). English 'it' settles it as the address.
4) 'esa cuenta' is Account 3, 'esa persona' is whoever holds that payment key, 'ese pago' is the payment you're making to recipient 2, and 'esa dirección' is recipient 2's address. Each 'esa' or 'ese' is fixed by its noun.
5) 'Aun así' means 'even so', with the same implicit contrast as message 3.
6) 'tus dos cuentas' doesn't name the first account. It is most likely the account you're paying from, plus Account 3. It may read as 'both your accounts'.
7) 'lo' in 'verlo' most likely means the link, though it could mean the payment. English 'it' could also be read as the chain, which Spanish 'lo' rules out. 'donde' refers to the chain.

## ja-session-own

**English:** [This transaction] proposes Info [taken as the Info governance action] (it [the Info action] changes nothing). Its [the proposal's] 100,000 ₳ deposit, when the governance action ends, passes to this private session's stake key, and the wallet never takes [the deposit] back.

**Ambiguities:** 1. 提案します ('proposes') has no subject. I took it to be this transaction, meaning the website's request being approved. It could also be 'you' (by signing) or 'the website'. 提案します is also everyday interface wording for 'we suggest' or 'we recommend', so the sentence can read as the wallet recommending something: 'We suggest Info (nothing will change)'. The non-past form also allows 'will propose'.
2. 情報 on its own is the ordinary noun 'information'. I took it as the Info governance action type. Without アクション ('action'), though, the sentence can read as 'proposes information', and a reader may not see that it names an action type.
3. （何も変更しません） is a full polite sentence with no subject. I took it as 'the Info action changes nothing'. It can also read as 'this transaction changes nothing', 'nothing will be changed [for you]', or the proposer saying 'I/we won't change anything'. Read those ways, it says the whole request is harmless. That clashes with the next sentence, where a 100,000 ₳ deposit leaves and the wallet never takes it back.
4. その: I took it as 'its', the deposit this proposal pays. It could also be read as 'that', pointing to a deposit shown somewhere else. Low risk.
5. ガバナンスアクションが終わると: 'governance action' has no 'this'. I took it as the action being proposed, but it could read as a general rule ('when a governance action ends'). 終わる doesn't say how the action ends (enacted, expired or dropped). A reader may take 'ends' to mean 'passes', or 'when' to mean 'if'.
6. ステーク鍵へ ('to the stake key') literally sends the deposit to a key. What it means is the reward account of that stake key. Low risk.
7. ウォレットが取り戻すことはありません: the object is dropped, and I took it to be the deposit. Literally it says 'there is no [case of] the wallet taking [it] back'. That is a flat 'never' about what the wallet does. It is not 'cannot', which would be 取り戻せません. 取り戻す means both 'take back' (something the wallet won't do) and 'get back / recover' (a result). So a reader may take it as 'the deposit is lost for good', or as 'the wallet won't do it automatically, but you can'. The Japanese says neither. Most likely it means the wallet never brings the deposit back out of the session's stake key. In English, 'the wallet never takes it back' can even sound reassuring, as in 'the wallet won't take it away from you'. 取り戻す means regaining something that left, so that reading is wrong. ウォレット has no possessive: it could be the wallet app or 'your wallet' (your funds).
8. プライベートセッション is explained only by the window it appears in. Out of context it can suggest a private browsing session. I took このプライベートセッション to be the one-time account the wallet made for this website.

## ja-session-other

**English:** [This transaction] proposes a change to the protocol parameters. Its [the proposal's] 100,000 ₳ deposit, when the governance action ends, passes to the stake key of your Private session 2 [taken as another of your private sessions, not the one making this request], and the wallet never takes [the deposit] back.

**Ambiguities:** 1. 提案します has no subject. As in message 1, I took it to be this transaction, and the same 'we suggest' reading is possible. Here that reading is stronger: プロトコルパラメータの変更を提案します can read as 'We suggest changing the protocol parameters'. The non-past form also allows 'will propose'.
2. その: I took it as 'its', this proposal's deposit. Low risk.
3. あなたのプライベートセッション 2: I took it to be the user's private session labelled 'Private session 2', a different session from the one making this request. The text never says 'another' or 'not this one', so the reader has to work that out from the label alone. The '2' is a label, but a reader may take it as 'your second private session'.
4. ウォレットが取り戻すことはありません: the same points as message 1 apply. It means 'never', not 'cannot'; 取り戻す can mean 'take back' or 'recover'; and the object is dropped (I took it to be the deposit). Here 'from where' and 'to where' are dropped too. I took it to mean the wallet never moves the deposit back out of Private session 2's stake key [to you]. The destination is called *your* session, so a reader may wonder why the wallet won't take the money back. They might also read it as 'not back to this session' or 'not back to the account that paid'. The English 'never takes it back' can also sound reassuring here ('the wallet won't take it away from you').
5. ガバナンスアクションが終わると and ステーク鍵へ: same as message 1. The text doesn't say how the action ends, and 'stake key' means that key's reward account.
6. プライベートセッション: same as message 1; it is understood only from context.

## ja-staked-other

**English:** This [the address you are paying] is not your Account 2. [This address] contains that account's [Account 2's] stake key, but the payment key [taken as this address's payment key] is someone else's, so only that person [the owner of that payment key] can use this [taken as: spend what is at, or paid to, this address]. If [you] still [= even so] pay this address, your two accounts [taken as: the account you pay from and Account 2] become linked on the chain, and [that link] becomes visible to anyone.

**Ambiguities:** 1. これ in the first sentence: I took it to be the address being paid. 'This is not your Account 2' treats an address as an account. What it means is 'this address doesn't belong to your Account 2'. アカウント 2 is a label, but a reader may take it as 'your second account'.
2. 含んでいます ('contains') has no subject; I took it to be this address. I took そのアカウント ('that account') to be Account 2, the only account named.
3. 支払鍵 ('payment key') has no owner attached. I took it to be this address's payment key. The contrastive は (stake key vs payment key) supports that reading. But it comes right after そのアカウントの ('that account's'), so it can be read as 'that account's payment key is someone else's'. That would mean the user's own Account 2 is controlled by someone else, an alarming misreading.
4. 他人のもの ('someone else's') says outright that the key belongs to another person. It doesn't just say the key isn't one of this wallet's.
5. これを使えるのはその人だけです: I took これ ('this') to mean what is at, or paid to, this address, matching the first sentence's これ. It could also mean the payment about to be made. It could even mean the payment key just mentioned, which would make the sentence say nothing new. 使える literally means 'can use', and here it means 'can spend'. In English, 'only that person can use this' may sound like 'use this address', for example to receive money. その人 ('that person') is the owner of the payment key.
6. それでも means 'even so' or 'anyway'. In English, 'if you still pay' could be read as 'if you keep paying' or 'if you pay again'.
7. 支払う ('pay') has no subject; it is you, the user.
8. あなたの二つのアカウント ('your two accounts') doesn't say which two. I took them to be the account being paid from and Account 2. It can also read as 'both of your accounts', as if the user had only two.
9. 誰にでも見えるようになります ('becomes visible to anyone') has no subject. I took it to be the link between the accounts. Grammatically, though, あなたの二つのアカウントが can be the subject of both verbs: 'your two accounts become linked and become visible to anyone'. That makes it sound as if the accounts themselves had been hidden until now.

## ja-staked-other-nth

**English:** Recipient 2 is not your Account 3. [Recipient 2's address] contains that account's [Account 3's] stake key, but the payment key [taken as that address's payment key] is someone else's, so only that person [the owner of that payment key] can use that payment [taken as: spend the money you send to Recipient 2]. If [you] still [= even so] pay Recipient 2's address, your two accounts [taken as: the account you pay from and Account 3] become linked on the chain, and [that link] becomes visible to anyone.

**Ambiguities:** 1. 宛先 2: I took it as 'Recipient 2', the second recipient on the Send screen. 宛先 can also read as 'Destination 2' or 'Address 2'. 'Recipient 2 is not your Account 3' treats a recipient as an account. What it means is that Recipient 2's address doesn't belong to your Account 3. アカウント 3 is a label, but a reader may take it as 'your third account'.
2. 含んでいます ('contains') has no subject; I took it to be Recipient 2's address. I took そのアカウント to be Account 3.
3. 支払鍵 has no owner attached; I took it to be that address's payment key. As in message 3, it can be misread as 'Account 3's payment key is someone else's'.
4. その支払い ('that payment'): I took it to be the payment the user would make to Recipient 2, meaning the money sent. That payment hasn't happened yet, so 'that payment' refers to something hypothetical. It comes right after 支払鍵 ('payment key'), so it might be read as 'that payment [part / key]'. Message 3 says これ ('this') at this point instead, so the two messages differ here. 使える means 'can spend'. その人 is the owner of the payment key.
5. 他人のもの, それでも, and the missing 'you' before 支払う: same as message 3. 'Still' here means 'even so', not 'keep paying'.
6. あなたの二つのアカウント: I took them to be the account being paid from and Account 3, but the text doesn't name them. In a Send with several recipients, other rows could link more accounts, and 'two' covers only this pair. It can also read as 'both of your accounts'.
7. 誰にでも見えるようになります has no subject; I took it to be the link. It can also read as 'your two accounts ... become visible to anyone', same as message 3.

