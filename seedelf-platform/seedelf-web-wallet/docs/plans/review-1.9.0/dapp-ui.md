# 1.9.0's release review: the dapp-ui lane's report

Round one, a finder. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read at 8d7c4b0c: #373's TypeScript diff (DappApprovals.tsx whole file: mustAck/ackFor, answer(), the foot, SignTx's rows, notes, callout and lookalikes; ui/dapp.ts releasesContractFunds; shared/rpc.ts DappTxSummary, DappAsk, TxDetail; background/tx-view.ts whole file; TxDetail.tsx's inputs section and signer rows), the docs diff (flows.md, architecture.md), PR #373's body, the Rust inspect diff (to know when the fields are set), and around them: background/dapp.ts answer(), ask(), signTx(), readTx(), resolve(), ties(); ui-port.ts, sw.ts routing, handlers.ts, manifest.ts; balances.ts and accounts.ts (where found keys come from, and the switch wipe); sessions.ts inspect/directSpends; Screen.tsx and Modal.tsx (form and Enter); privacy.md:177.
Ran in the main tree: Vitest dapp-prompt, tx-view and tx-view-screen (3 files, 82 passed), plus approvals-review-fixes, dapp-ties, dapp-ties-accounts, screens-wiring-review-fixes, i18n, i18n-critical-helpers, i18n-values-in-place, i18n-screens and words (9 files, 236 passed). Also a script listing button tags with no type (none found).
Ran in my own worktree at 8d7c4b0c (now removed; the main tree is untouched and clean):
- a Vitest probe of markYours, and a mutation of two of its branches;
- `npx vite build` (with the main tree's wasm/pkg copied in), then Playwright under xvfb with an 8 GB cap: #373's e2e test plus three probe tests, 4 of 4 passed.
Probe code and logs are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/dapp-ui/ (zz-dapp-ui-probe.test.ts, probe-e2e.ts.txt, e2e-run1.kept.log).
Not covered:
- A private session's sign window by run: traced only. Its path is the same code, and neither mustAck nor SignTx's release rows depend on `session`.
- The 400×605 layout in es and ja.
- Whether the es and ja back-translations are good: only the guard tests ran.
- The correctness of the Rust side's released/keyReleases figures (another lane), and any live preprod contract UTxO.

## Findings

### dapp-ui#2 (low, #373, traced): "Leaves a contract" and "I expect this to leave the contract" are false for the honest repricing the PR names, where the money stays at the same contract

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:511, seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:513, seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:1106, seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:290, seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:2236

**Claim.** inspect counts money paid back to the same contract as released, on purpose: a listing can stay there under a new owner's datum. So an honest listing reprice gets the row and the switch, as PR #373 lists. But the words say the money leaves the contract: the row reads "Leaves a contract, not to you" and the switch "I expect this to leave the contract". In a reprice it doesn't leave; it goes back into the same contract, which the window's own Pays list shows as "A contract".

**Evidence.** - en.json:511: "dappUi.warn.contractAck": "I expect this to leave the contract".
- en.json:513: "dappUi.warn.contractRow": "Leaves a contract, not to you".
- DappApprovals.tsx:1106-1122 puts that label on the released ADA row and on each released token. The switch at :290-303 carries the other label.
- cip30_test.rs:2236-2244, `paying_the_same_contract_still_counts_as_released`: "A listing kept at its contract under a new owner's datum: the money stays there, and is no longer the user's." It asserts released_lovelace == "49800000" and one released token.
- PR #373's body, under "Honest requests that also get the warning and the switch": "Repricing a listing, which pays back to the same contract."

**Scenario.** 1. A user reprices their own jpg.store listing through the site. The old ask UTxO is spent, and the NFT goes back to the same ask contract under a new datum naming them.
2. The window shows "Leaves a contract, not to you: 1 asset1…", then "Your signature releases your own order or listing…".
3. Sign waits for "I expect this to leave the contract", something the user doesn't expect, because it isn't happening.
4. The honest user may decline the reprice, or learn to flip the switch unread. That would weaken it for the attack case.
In the attack case where an attacker relists the NFT under their own datum at the same contract, "leaves" is false as well; only "not to you" holds.

**Fix.** Use words that are true in both cases and just as short, for example "Released, not to you" for the row and "I expect this to be released" for the switch. Back-translate es and ja again.

### dapp-ui#3 (low, #373, confirmed-by-run): markYours never marks a DRep key, or another account's payment keys past its first 20, so Transaction details omits "you" where the window says "your DRep key"

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:267, seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:299, seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:635

**Claim.** These required signers are marked "yours":
- the active account's payment keys: the first 20 of each chain, plus the last reading's discovered keys;
- every session's payment and stake keys;
- the active account's stake key;
- each other known account's first 20 payment keys and its stake key.
Never marked: any account's DRep key 3/0, other accounts' payment keys past index 20, and the one-time key the wallet signs its own private spends with. The Rust side does count the DRep key (with governance) for keyReleases and for "Signs with … your DRep key", so the window and Transaction details disagree. It never marks a stranger's key: every set is derived on the device. This is a missing label, never a false one.

**Evidence.** - tx-view.ts:269-289 builds `account` (accountKeys: payment hashes only, plus found?.keys), `sessions`, `stake` and `sessionStakes`.
- tx-view.ts:299-303 checks other accounts against `accountKeys(keys.cardano)` (the first GAP_LIMIT only) and their stake key.
- No drepOf() appears in tx-view.ts. background/dapp.ts publicKeys does add `drep.set((JSON.parse(cardano.drepOf()) as { hash: string }).hash, index)`.
- wasm/src/cip30.rs keys_of (448-472) puts the DRep key into Keys when governance was granted, so `keyReleases` and SignTx's signers (DappApprovals.tsx:1044-1053) count it.

Probe, run in my worktree (`tests/zz-dapp-ui-probe.test.ts`):
```ts
const [drep, past20, sessionStake] = await t.wallet.withKeys((k) => [
  (JSON.parse(k.cardano.drepOf()) as { hash: string }).hash,
  k.cardano.paymentKeyHash(0, 25),
  stakeHash(k.oneTime.rewardAddress(net, 0)),
]);
const [secondStake, secondDrep] = await t.wallet.withAccount(1, (k) => [
  stakeHash(k.cardano.stakeAddress(net)), (JSON.parse(k.cardano.drepOf()) as { hash: string }).hash]);
const signers = [drep, past20, sessionStake, secondStake, secondDrep].map((h) => `581c${h}`).join("");
const cbor = `84a4` + `0081825820${"11".repeat(32)}00` + `0180` + `021a00029810` + `0e85${signers}` + `a0f5f6`;
const { detail } = await txView({ ...deps(t), knownAccounts: async () => [0, 1], sessionIndices: async () => [0] }, "preprod", "ab".repeat(32), () => cbor);
```
It printed `probe {"drep":false,"past20":false,"sessionStake":true,"secondStake":true,"secondDrep":false}`.

The same probe on the wallet's own private transfer, `t.transfer.build(...)` then txView, printed `{"requiredSigners":["2c7a35ea…bc9f","1108b97f…dec8"],"yourSigners":[]}`. Here 1108… is giveme.my's COLLATERAL_HASH (seedelf-core/src/constants.rs:80-81), rightly unmarked. 2c7a… is the spend's one-time key, which the wallet signs with itself.

**Scenario.** 1. A site given governance (CIP-95) sends a transaction with the account's DRep key hash as a required signer, for example a governance contract's action.
2. The window says it signs with "your DRep key", and Rust's keyReleases counts that key.
3. Transaction details lists the row as "Must be signed by 3f…" with no "you". Next to rows that do say "Must be signed by you", it reads as someone else's key.
The same happens for Account 3's payment key 0/25 when Account 1 is on screen.

**Fix.** In markYours, add each account's DRep hash: `JSON.parse(keys.cardano.drepOf()).hash` for the active account and for each known account in the loop, as background/dapp.ts publicKeys does. Optionally, also pass the dApp account's discovered keys.

### dapp-ui#1 (nit, #373, confirmed-by-run): The Sign switch is enforced only in the window: the worker's dapp-answer signs a releasing transaction without it

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:646, seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:154, seedelf-platform/seedelf-web-wallet/extension/src/background/ui-port.ts:28

**Claim.** answer() in the worker checks the password for a signature, but nothing about the switch. The only gate is the window's own `(approve && mustAck && !ack)`. No site can reach dapp-answer, so this is defence in depth only. Any future extension page that answers requests would bypass the switch, though not the password.

**Evidence.** - background/dapp.ts:646-701, answer(), checks in turn: the request is waiting; the connector is on; it isn't a funding; the network; the dApp account; the password (`guarded`, :673). Then it signs: `w!.resolve(await w!.approve(...))` (:701).
- DappApprovals.tsx:154 holds the only check of the switch.
- Who can call it: ui-port.ts:28 `if (sender?.id !== chrome.runtime.id || !sender.url?.startsWith(extensionOrigin)) { port.disconnect(); ...}`. A content script's port carries the page's URL. manifest.ts has no externally_connectable, and nothing listens to onConnectExternal or onMessageExternal. dapp-answer is sent only from DappApprovals.tsx:159 and :199 (the second with approve:false).

Probe e2e, run in my worktree's build:
```ts
await expect(sign.getByRole("switch", probeYes)).toHaveAttribute("aria-checked", "false");
const { reply: listed } = await askWorker(sign, { type: "dapp-approvals" });
const { reply } = await askWorker(sign, { type: "dapp-answer", id: listed.value[0].id, approve: true, password: PASSWORD });
```
Output: `probe-direct-answer {"ok":true,"value":{}}`, and the site's signTx resolved to `{"value":"a1008182582063c5d6…` (a witness set).

**Scenario.** From any extension page, `dapp-answer {id, approve:true, password}` for a sign-tx whose summary releases contract funds signs it, with the switch never turned on. Today only the window sends dapp-answer, and it gates. A web page or a content script can't open the UI port.

**Fix.** Optional. Send `ack: true` with an approval, and have answer() refuse a sign-tx where `releasesContractFunds(approval.summary)` holds and `ack` is missing, beside the password check. This mirrors the window's rule in the worker.

### dapp-ui#4 (nit, #373, confirmed-by-run): No test covers yourSigners' session-stake or other-account-stake branches

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:288, seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:303, seedelf-platform/seedelf-web-wallet/extension/tests/tx-view.test.ts:151

**Claim.** The PR's tx-view test covers the active payment key, the active stake key, a session's payment key, Account 2's payment key and a stranger. With the `sessionStakes.has(hash)` and `h === theirs.stake` branches removed, every test of the PR still passes.

**Evidence.** Mutation, in my worktree:
- tx-view.ts:288 `|| hash === stake || sessionStakes.has(hash)) yourSigners.push(hash);` became `|| hash === stake) yourSigners.push(hash);`
- tx-view.ts:303 `|| h === theirs.stake` was removed.

`npx vitest run tests/tx-view.test.ts tests/tx-view-screen.test.ts tests/zz-dapp-ui-probe.test.ts` gave "Test Files 1 failed | 2 passed (3); Tests 1 failed | 54 passed (55)". The only failure was the probe from dapp-ui#3, at `expect(marked(sessionStake)).toBe(true)`. The file was restored after.

**Scenario.** A later edit drops the session or other-account stake key from the check. A contract's cancel asking for a session's stake key then reads "Must be signed by" with no "you", and no test fails.

**Fix.** Add a session's stake key and Account 2's stake key to the PR's required signers in tx-view.test.ts. The probe in dapp-ui#3 does this.

## What holds

- Q1: Every UI way to approve goes through answer(), which refuses `approve && mustAck && !ack` (DappApprovals.tsx:154). Sign's `disabled` carries the same condition (:318). Confirmed by run: the Sign button, Enter in the password box, and a forced click in no-password mode all leave the window open with nothing signed.
- Q1: The password form has one submit button, Sign. No component or DappApprovals has a button without a type (script check). The TxDetail modal swallows Enter and stops submit (Modal.tsx:42-45). Decline all and ConnectRequest never approve a sign-tx.
- Q1: dapp-answer is reachable only from the extension's own pages (ui-port.ts:28 checks the sender's id and URL; no externally_connectable; no external listeners). A site can't call it. The worker doesn't check the switch (dapp-ui#1, nit).
- Q2: Approval ids are crypto.randomUUID() (background/dapp.ts:1570), so they don't repeat, after a worker restart either. Approvals live only in worker memory.
- Q2: `ack` is worked out during render (`ackFor === currentId`), not in an effect. A request that replaces an acked one starts with the switch off even in its first frame, before `held` takes effect; the e2e's second request and a queued next one start off too.
- Q2: The approve callback signs the same `request` (txCbor and rows) the summary was read from (background/dapp.ts signTx), so one id always carries one transaction.
- Q2: After a wrong password the request stays and the switch stays on. Run: alert "Wrong password.", aria-checked=true, Sign enabled once the password is retyped. Same request, same bytes. An error after the request was taken off the list ends it, and the next request starts off.
- Q3: `summary` is required for sign-tx (rpc.ts DappAsk). Rust's TxSummary always writes the seven new fields (non-Option, camelCase), and ties() keeps them with `...summary`. Run: the waiting approval carried all seven.
- Q3: A summary without the new fields reads as no release (dapp-prompt test), but no path produces one.
- Q3: An incomplete inspection still counts every contract input found. An input that isn't found isn't counted. With a payment-key signer, Rust refuses it outright; with the stake key alone, it shows "couldn't find" instead.
- Q3: With keyReleases and nothing released (an honest cancel), the window shows only "It spends 1 contract UTxO holding X ₳ [and tokens]." The note's condition, `contractInputs && !releases`, matches flows.md and architecture.md.
- Q4: A site on a private session signs in the same window. inspectSessionTx reads through the same inspect_tx with the session's key paths, and neither mustAck nor SignTx's release rows depend on `session`.
- Q4: SignTx renders only in DappApprovals, and App.tsx:156 is the window's only mount. A swap's own review (SessionTxReviewScreen) shows no release rows and isn't a site's transaction. A Minswap-built swap that spends any input other than the session's own or a Danogo pool is refused in the worker (sessions.ts directSpends).
- Q5: Every hash markYours compares against is derived on the device. found.keys is the account reading's derived `paths` (balances.ts:394) and is wiped on an account switch (accounts.ts WIPED_ON_SWITCH). A stranger's key is never marked (the PR's test and my probe).
- Q5: The loop's early return fires only once every output, reward and signer is marked. `index === active` is skipped because the active account was already checked in withKeys. A lock part-way through leaves a partial list, never a wrong one.
- Q6: `site` is set only by SignTx's TxDetailButton (DappApprovals.tsx:1321). The window opens only after resolve() has looked up whatever the view, the signed outputs and the sends don't hold, via koios(network).utxoInfo(missing). So "The wallet looked up the ones it doesn't hold" is true wherever it shows, and privacy.md:177 says the same.
- Q7: The switch has role=switch, aria-checked and aria-labelledby (found by its name with getByRole). Space and Enter toggle it, it comes before the password in tab order, and it's disabled while busy or held. All confirmed by run.
- Q7: Placement at 400×605, run: released row y=284, warning y=532, Pays y=644, privacy note y=755, switch y=868, password y=927, Sign y=979, of a 1080 px page, with no sideways scroll. Sign and the switch come only after every warning (CW-1).
- Q7: UI text is short: a one-line row label and switch label, and one-sentence callouts and notes. The released row's ₳ uses U+00A0 like the other rows.
- i18n: the new critical keys are named .warn. or .privacy. and listed in critical-keys.json (contractAck/Maybe/Row/Yours and tx.privacy.inputsHintSite). The es plural forms (_one/_many/_other) and ja (_other) are present, and the i18n guard tests pass.
- Q8: Vitest dapp-prompt, tx-view and tx-view-screen: 82 passed. Nine related dApp and i18n files: 236 passed.
- e2e in my worktree's build of 8d7c4b0c: #373's test passed. Probes passed: placement, keyboard and wrong password; the no-password Sign waiting for the switch.
