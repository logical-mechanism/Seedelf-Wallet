# 1.8.1's fix round: refusals

**Lane:** refusals. **Worktree:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-refusals`, on `2a8060d3`. Everything is uncommitted. Paths below are under `EXT` (`seedelf-platform/seedelf-web-wallet/extension`) unless they say otherwise.

**In short:** all five findings are fixed, each test first. Every new test failed on the code as it was, or on a mutant of the line it holds, and passes now.

- **One change from the brief.** Its DELEG regex has `DepositIncorrect|RefundIncorrect`, and that matches GOV's `ProposalDepositIncorrect`. That's a live refusal: a site's proposal whose deposit is wrong. The brief's own condition says no live body may gain a match, so the match is `(Deposit|Refund)IncorrectDELEG`.
- **One effect the verifiers didn't show.** Ogmios's real answer also cost a chain's first mix its rebuild without the box that's gone (`crossCheck` → `unstale`'s `avoid`), not only a collateral's mix its wait. See v-pv11-impact#2.
- **No user-visible string is new or changed.** Words that exist reach new places (below).

| id | outcome | where |
|---|---|---|
| readers#4 | fixed | `src/background/koios.ts:627-641`, `:717`, `:720-723`, `:1248` |
| worker#1 | fixed (with readers#4) | `src/background/lovejoin.ts:5424-5427`, `src/background/sessions.ts:5319-5321` |
| v-pv11-trace#1, v-pv11-impact#1 | fixed (match narrowed) | `src/background/koios.ts:733-737` |
| v-pv11-impact#2 | fixed | `src/background/lovejoin.ts:595-625` |

## Files

- M `src/background/koios.ts`
- M `src/background/lovejoin.ts`
- M `src/background/sessions.ts`
- M `tests/koios.test.ts`
- M `tests/staking.test.ts`
- M `tests/lovejoin-reward-balance.test.ts`: the `NOT_IN_REWARDS` bodies and their three refusal cases only.
- M `tests/lovejoin-planner.test.ts`
- A `tests/lovejoin-refusals.test.ts`

A scratch test, `tests/zz-r181-refusals-1.test.ts`, sat in the worktree for one check (v-pv11-impact#2's second path) and is deleted. The fixed sources' copies and the mutant runner are in `SCRATCH/fix-refusals/`.

## The words

- **No key is added, and no value changes.** So there's nothing new for the back-translation round.
- **Keys that now show in new places:**
  - `lj.warn.rewardsMoved`: a public mix's Send, a reviewed return's Send, Bring everything back's line for a return that didn't go, and a mix's retry line when it runs itself (worker#1).
  - `koios.staking.rewardsChanged`: PV11's `ConwayIncompleteWithdrawals`.
  - `koios.staking.changed`: PV11's `ConwayWithdrawalsMissingAccounts` and DELEG's new names.
- **The worker stays English.** It still compares only the node's and Ogmios's own text, never translated words.

## readers#4 · fixed

**What changed, in `koios.ts`:**

- **`:627-633`:** `RewardsChangedError`'s comment now covers an account that isn't registered too.
- **`:635-641`:** a new constant, `WITHDRAWAL_REFUSED = /WithdrawalsNotInRewards|IncompleteWithdrawals|WithdrawalsMissingAccounts/`. Its comment gives each name by protocol version.
- **`:717`:** staking's rewards words for `/WithdrawalsNotInRewards|IncompleteWithdrawals/`.
- **`:720-723`:** `WithdrawalsMissingAccounts` gets `koios.staking.changed`.
  - It's checked before `NotDelegatedToDRep`.
  - At protocol version 11, LEDGER refuses a missing key's account under both names, the DRep one first. `validateWithdrawalsDelegated` runs before `testIncompleteAndMissingWithdrawals` (conway 1.23, `Rules/Ledger.hs:379-386`). A key with no account fails `isNotDRepDelegated`.
  - In the other order, an unregistered key would read "The network won't pay out rewards until your voting power is delegated…".
- **`:1248`:** `RewardsChangedError` is decided by all three names.

**The bodies.** Each is cardano-submit-api's envelope (v-pv11-trace part c, and the golden), with each failure as conway 1.23 `show`s it.

- **v-pv11-trace's rendering isn't 1.23's.** It writes `aaAccountId` and `Mismatch {mismatchSupplied = …}`.
- **What 1.23 writes** (the source at `f649f975`):
  - `AccountAddress {aaNetworkId = …, aaId = AccountId {…}}`: derived Show (`Address.hs:183-187`);
  - `Mismatch ('RelEQ) {supplied: …, expected: …}`: a custom Show (`BaseTypes.hs:839-844`).
- **The tests use 1.23's**, as v-pv11-impact's bodies and cardano-wallet #5351's quote do.
- Only constructor names are matched, so the record fields don't matter to the fix.

**Tests, each failing before the fix:**

- **`tests/koios.test.ts:393`**, "explains them in the names of protocol version 11, which both networks run, as cardano-submit-api hands them on":
  - `ConwayIncompleteWithdrawals` for a key's account, for a script's account (Lovejoin's), and beside `ConwayWdrlNotDelegatedToDRep`: each is a `RewardsChangedError` in staking's rewards words.
  - `ConwayWithdrawalsMissingAccounts` beside `ConwayWdrlNotDelegatedToDRep`: "staking changed since you reviewed", and a `RewardsChangedError`.
  - Before: `expected … to throw error including 'rewards changed since you reviewed' but got 'The network rejected the transaction:…'`.
- **`tests/staking.test.ts:779-783`:** the same Withdraw, refused in LEDGER's name. Before: the same raw text.
- **`tests/lovejoin-reward-balance.test.ts`:** its three refusal cases now run at protocol version 10 and at 11 (`:142`, `:260`, `:277`; `NOT_IN_REWARDS` at `:210-235`, `refusing` at `:238`). The three PV11 runs failed before:
  - **The chain stops in Lovejoin's words:** `stopped` was the raw JSON, not `REWARDS_MOVED()`.
  - **Built again once:** `expected [ …(1) ] to have a length of 2 but got 1`.
  - **Refused again:** 1 submit where 2 are expected.
- **Mutants:**
  - **M2**, the missing account checked after `NotDelegatedToDRep`: `:393` fails with "The network won't pay out rewards until your voting power is delegated…".
  - **M4**, the type decided by the balance names alone: `:393` fails `toBeInstanceOf(RewardsChangedError)` for the missing account.

## worker#1 · fixed, landing with readers#4

**What changed:** both rethrows keep the type and drop staking's words. Every other error is thrown exactly as before.

- **`lovejoin.ts:5424-5427`** (`pumpPublicNow`): `if (unsure !== undefined) throw new Error(sending.stopped);`, then `throw e instanceof RewardsChangedError ? new RewardsChangedError(REWARDS_MOVED(), e.trouble, e.failure) : e;`.
- **`sessions.ts:5319-5321`** (`pump`): the same rethrow, in place of `throw e;`.

**Tests, in `tests/lovejoin-refusals.test.ts`.** Each one is given the PV11 body:

- `:71`: a public mix's Send rejects with a `RewardsChangedError` reading `REWARDS_MOVED()`, and its progress says it too.
- `:83`: a reviewed return's Send (`backSubmit`) does the same, and so does the session's chain.
- `:96`: Bring everything back's `failed` is `[{ index: 0, error: REWARDS_MOVED() }]`.
- `:106`: a mix that runs itself has `REWARDS_MOVED()` on both its retry line (`auto.retry.error`) and its stop.

**What each failed on:**

- **Before either fix:** the raw JSON, and no `RewardsChangedError`.
- **With readers#4's match alone:** all four failed in staking's words: "Your staking rewards changed since you reviewed this. Review it again." That's worker#1's failure made live, as v-pv11-trace and critic said it would be.

**Mutants:**

- **M5a and M5b:** the rethrow as a plain `KoiosError(REWARDS_MOVED())`. `:71` and `:83` fail `toBeInstanceOf(RewardsChangedError)`.
- **M5c:** sessions.ts's `throw e;` put back. `:96` and `:106` fail in staking's words.

**A known effect:** the runner's detail now says the same sentence for "Why it stopped" and "What went wrong". It does that for every other stop already (v-worker).

## v-pv11-trace#1 and v-pv11-impact#1 · fixed, the match narrowed

**What changed:** `koios.ts:733-737`, the DELEG match, is now `/StakeKey(Not)?Registered|AccountAlreadyRegistered|IncorrectDeposit|(Deposit|Refund)IncorrectDELEG|NonZero(Reward)?AccountBalance/`.

**Why it's narrower than the brief's.**

- GOV's `ProposalDepositIncorrect (Mismatch RelEQ Coin)` is live in conway 1.22.1, 1.23 and 1.24 (`Rules/Gov.hs:182`, raised at `:526`). It refuses a proposal whose deposit isn't `govActionDeposit`.
- A site's proposal reaches it: the dApp signer submits through `Koios.submitTx` too.
- **Today** it's the node's own words. **With the brief's `DepositIncorrect`** it would say "Your account's staking changed since you reviewed this. Refresh, and review it again.", which is a live body gaining a match.

**The other new substrings, checked in all three ledger checkouts** (`226b002d`, `f649f975`, `54e24ba4`):

- `AccountAlreadyRegistered` reaches LEDGER only through DELEG. At 1.24, `Rules/Ledger.hs:137` injects it as `ConwayCertsFailure . CertFailure . DelegFailure`.
- `NonZero…AccountBalance` is only DELEG's: Conway's `StakeKeyHasNonZeroAccountBalanceDELEG`, and Shelley's `StakeKeyNonZeroAccountBalanceDELEG`, which has the same meaning.
- `RefundIncorrect` occurs only in `RefundIncorrectDELEG`. GOVCERT's is `ConwayDRepIncorrectRefund`, which doesn't match.

**Tests:**

- **`tests/koios.test.ts:393`, DELEG's four names**: the 1.21 NonZero name, `DepositIncorrectDELEG`, `RefundIncorrectDELEG` and 1.24's `DelegAccountAlreadyRegistered`.
  - Each now gives "staking changed since you reviewed", and none is a `RewardsChangedError`.
  - Before: raw.
- **`tests/koios.test.ts:393`, the bodies that must not match:** `ConwayGovFailure (ProposalDepositIncorrect …)` and GOVCERT's `ConwayDRepIncorrectRefund` stay "The network rejected the transaction: {".
  - This passes before the fix and after it.
  - **M1**, the brief's regex, fails it: `got 'Your account's staking changed since…'`.
- **`tests/staking.test.ts:784-789`:** a Stop staking reviewed at 0 rewards stages no withdrawal. Refused as `StakeKeyHasNonZeroAccountBalanceDELEG`, it says "staking changed since you reviewed".
  - Before: raw.
  - **M3**, the old `NonZeroRewardAccountBalance`, fails it on its own.

## v-pv11-impact#2 · fixed

**What changed:**

- **`lovejoin.ts:595-596`:** a new constant, `MISSING_INPUT = /missing from UTxO set\): ([0-9a-f]{64})#(\d+)/`. That's Ogmios's 3004 reason, `"Unknown transaction input (missing from UTxO set): " <> stringifyTxIn i`, in 6.14's and 7.0's `Json/Conway.hs`, with lowercase hex and `show ix`.
- **`lovejoin.ts:598-625`, `unknownInputs`:**
  - It also takes the names in each item's `error.data.reason`.
  - It does so only past the stale gate, which is unchanged (3117, or an item's 3110 or 3117). So which answers count as stale never changes.
  - Names are deduplicated with the `unknownOutputReferences` ones.
  - Its comment says why: the ledger's evaluator only defines `UnknownTxIn` (`Alonzo/Plutus/Evaluate.hs:236`) and never builds it. Ogmios maps it to 3117, so an evaluation never gets one.
- **What it feeds is unchanged code:**
  - `tailWitness` (`:4535-4537`): every named input is the wallet's own, so it's `sess.notCaughtUp` and it's asked again.
  - `crossCheck` (`:4807-4808`): `StalePool(names)`, then `unstale`'s `avoid`.

**Tests:**

- **`tests/lovejoin-refusals.test.ts:151`:**
  - The recorded `CORE/tests/fixtures/ogmios/unknown_inputs.json` gives `["a1…#0"]`.
  - Its 3004 given twice is named once.
  - A 3117's `unknownOutputReferences` is named as before.
  - Before: `expected [] to deeply equal [ Array(1) ]`.
  - **M6**, no deduplication, fails it.
- **`tests/lovejoin-refusals.test.ts:162`:**
  - A 3004 alone, whatever its reason, is `undefined`. So is `AGREES`.
  - A stale answer with a reason that names nothing is `[]`.
  - This passes before and after, and holds the gate. **M7**, no gate, fails it.
- **`tests/lovejoin-planner.test.ts:1557`** ("asks again, rather than stop…") and **`:1581`** ("lets a box of any pool come back while its mix waits…") now use the recorded shape.
  - They go through `unknownTo` (`:90-98`), which reads core's fixture with its input renamed to the collateral's box.
  - Before: both failed `expect(waiting.ended).toBeUndefined()` (received `1800000000000`). The chain stopped at its collateral's mix.

**The second path, checked.** `lovejoin.test.ts:681`, "builds the chain again from a fresh read when the network doesn't know a pool box it drew", is `crossCheck`'s rebuild, and it isn't my file. I ran it with the recorded shape in the scratch copy (`zz-r181-refusals-1`, deleted).

- **On 2a8060d3's `unknownInputs`** it fails: `expected [ …(40) ] to not include '5a5e0003…'`. The rebuild drew the gone box again, since Koios still lists it.
- **With the fix** it passes.
- **So before this fix**, a chain's first mix met on a stale pool read had nothing in `avoid`. While the backend still listed the gone box, each try could draw it again, and the build ended in `lj.poolDrifted`.
- v-pv11-impact named this in passing ("a rebuild relies on a fresh read alone"). This run shows it.

## For the lead

1. **The docs lane's `architecture.md:377`** lists "`IncorrectDeposit`; from 11, `DepositIncorrect` and `RefundIncorrect`". The match is anchored on DELEG: `DepositIncorrectDELEG` and `RefundIncorrectDELEG`, so GOV's `ProposalDepositIncorrect` (a site's proposal) stays the node's own words. The rest of its list matches the code:
   - `ConwayWithdrawalsMissingAccounts` under "an account whose staking changed";
   - the type taken by all three withdrawal names;
   - the NonZero rename's wording.
2. **`seedelf-core/src/withdraw_zero.rs:8`'s comment** names only `WithdrawalsNotInRewards`. That's a nit, in no lane's files; the docs lane has it as a note too.
3. **`tests/lovejoin.test.ts`** still hands the wallet the invented top-level 3117: `unknownBox` at `:666-679` (used by `:681`), and `:2255`. They pass, because 3117 is still read. Moving `unknownBox` to the recorded shape makes `:681` a before/after test of `crossCheck`'s path, as above.
4. **worker#3's backlog line:** its proposed fix keys on `RewardsChangedError`, which nothing raised at protocol version 11 until this round. With readers#4's match it fires, so the line can say the fix works as written. Its safety argument is unchanged: spent is checked before staking (`koios.ts:1242`).
5. **The balance lane:** readers#4's match makes `withdrawOne`'s rebuild-once run on both networks for the first time (critic). mutants#7's paid and private ways back (T12d, T26b, T26c) hold a path that's now live.
6. **Merging `tests/lovejoin-reward-balance.test.ts`:** I changed only these lines:
   - `NOT_IN_REWARDS`, now a table of two bodies (`:210-235`);
   - `refusing`, which takes the body as its second argument (`:237-248`);
   - the three refusal cases' `it` lines, now `it.each`, and their uses (`:142`, `:150`, `:260`, `:264`, `:277`, `:280`).
   - A balance-lane block that calls `refusing(t, count, …)` needs the body as its second argument.
7. **A site's submit:** a site's transaction refused for a withdrawal is in staking's words again, as PV10's `WithdrawalsNotInRewardsCERTS` was:
   - `rewardsChanged` for `ConwayIncompleteWithdrawals`;
   - `changed` for `ConwayWithdrawalsMissingAccounts`.
   - This restores what PV10 did, not a new rule.
8. **Left as records:** chunk 43's archived plan (`:8`, `:171`) names PV10's name, which v-pv11-trace leaves as a record. The docs lane gave its *Not covered* the PV11 note.

## Ran

- **The five files I touched**, in full: `npx vitest run tests/koios.test.ts tests/staking.test.ts tests/lovejoin-reward-balance.test.ts tests/lovejoin-refusals.test.ts tests/lovejoin-planner.test.ts`.
  - 5 files, 178 tests passed.
  - The baseline on 2a8060d3 was 168 (80 + 88). 10 cases are new: koios +1, reward-balance +3, refusals +6.
- **Neighbours, by name, all passing:**
  - 25 files of Lovejoin chains, public mixes, stops and ways back: 215 tests. That's `lovejoin.test.ts`, `chain-*` (10), `public-mix-*` (11), `lovejoin-stopped-before`, `lovejoin-stopped-shown`, `lovejoin-withdraw-submit` and `lovejoin-share-review-fixes`.
  - 21 files of sessions, submits, the dApp and the words: 353 tests. That's `sessions*` (4), `session-*` (5), `data-layer`, `dapp-governance`, `dapp-site-english`, `dapp-account-change`, `maybe-sent`, `mempool-watch`, `write-ahead`, `submit-inputs-spent`, `lovejoin-1-5-0`, `words`, `i18n-worker-reasons` and `i18n-critical-helpers`.
- **`npm run typecheck`:** clean, exit 0.
- **Mutants M1 to M7** as above. Each was restored, and `cmp` checked it against the saved fixed copy.
- **Nothing else:** no build, no e2e, no network beyond the saved ledger and Ogmios checkouts in `SCRATCH/review/v-pv11-impact/src/`.
