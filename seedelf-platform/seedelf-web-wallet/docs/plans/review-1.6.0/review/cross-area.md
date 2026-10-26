# 1.6.0's review of the fixes: cross-area (where fixes meet)

Reviewer `cross-area`. I read the whole diff since `499768f6` of `sessions.ts`, `lovejoin.ts`, `rpc.ts`, `Lovejoin.tsx`, `handlers.ts`, `script-spend.ts`, `parts.ts`, `pending.ts`, `runs.ts`, `wasm.ts`, `coin-control.ts`, `DappApprovals.tsx`, `Swaps.tsx`, `swap.ts`, `LovejoinReturn.tsx`, `BringAllBack.tsx`, `Collateral.tsx`, `Home.tsx` and `lovejoin-launch.ts`. I checked the locales for duplicate keys and for keys missing from one language: there are none.

I found three findings, all low, each proven by a throwaway test that fails on the tree. For each, a candidate fix in a scratch copy made the test pass, and the fixers' own tests in that area still passed. The tests and the copy are deleted.

Pairs I checked that agree, so no finding:
- **The Bootstrap reserve.** mixFunding keeps bootstrap's way-back reserve (`back`) out of `orWithoutReserve` and out of `tailReserved`. A Bootstrap asks for no tail reserve.
- **The form and the worker.** sc-lj-1's `tailReserveOf` uses the same floor, free-box and usable rule as the worker's `collateralPool`.
- **The collateral's mix figures.** `COLLATERAL_MIX_COST` (1.5 ₳) next to a site's direct reserve (2.8 ₳) is consistent: the reserve row says what isn't used comes back.
- **Counting boxes back.** countBack with `holder` (wlj-1) and `counted` (w-left) agree within one bring run: each withdraw drops its record at submit.
- **Parts and returns.** w-left's sendChain check of parts reservations and wss-1's `laterParts` mirror each other. A parts reservation holds only what still waits.
- **Who may switch accounts.** `publicChainsSending` (switching accounts), `chainsSending` (the lock countdown, Remove wallet) and `chainsMixing` (withdraws) are each used where their docs say.
- **The rebuilt tail.** A rebuilt tail inherits `Tail.landed`, so `tailWaits` holds from the start, which is right: it spends only reserved boxes.

## Findings

### 1. A return waiting at its collateral's mix can end Bring every box back now, and drop its boxes' due times, while the pool listing lags (low)

- **Where:** `extension/src/background/lovejoin.ts:1312` (`mayLand`), with `:1304` (`mixing`), `:6400`/`:6404` (the bring's end) and `:5968` (a box's own run's trim).
- **Concerns:** wlj-2's two fixes meet here. x-scenarios-lj#1 made `mixing` leave out a chain whose collateral's mix waits (`tailWaits`). 321-lj-worker#0's landing wait (`mayLand`) covers only a chain all sent (`done`). A chain at its tail fits neither rule.
- **Scenario:**
  - A session's return through Lovejoin has a collateral tail: preprod's 5 ₳ pool today, and mainnet once a 5 ₳ pool there holds 30 of other people's boxes.
  - The user presses Bring every box back now while that chain is still mixing. The run waits on `chain`.
  - Every transaction before the collateral's mix reaches a block, and pumpChain asks giveme.my. witnessTail sets `Tail.landed`, so `tailWaits` holds and `mixing` is false.
  - The pool listing comes from a Koios backend behind the one tx_status asked (C14), so it doesn't show the chain's leaf or the collateral's box yet.
  - The next run takes nothing and confirms nothing. `mayLand` is false, since the chain isn't `done`. So the run ends: it deletes `bringing` and trims the pool's due times to the boxes listed. The leaf's due time goes.
  - The page then says "Nothing of yours was left in Lovejoin." (`doneOf` is 0).
  - A minute later the leaf is listed. Nothing gives it a due time back, and `returning()` is false. So it doesn't come back until the next unlock, a Lovejoin page read, or the collateral box's own due time, hours later.
  - That is 321-lj-worker#0's own symptom: "says nothing was left, wipes their due times". A box's own run that reads the pool in the same window (an unlock, or another box falling due) trims the same due time.
- **Evidence:** test `zz-review-cross-area-2.test.ts` (deleted), built on wlj-2's `waitingTail` setup with the chain's boxes not listed yet. It had two cases:
  - **The bring:** `AssertionError: Bring every box back now ended before the chain's box was listed: expected undefined to be defined`. State after the run: `bringing undefined due [] doneOf 0`.
  - **A box's own run, with c1 due:** c1 is sent, then `AssertionError: d1#0's due time went in the run's trim: expected 0 to be greater than or equal to 1` (`due []`).
  - **With the candidate fix below in a copy:** both pass. The run waits on `landing`, keeps the due time, and takes `d1#0` once it's listed. `lovejoin-bring-review-fixes.test.ts` (16) and the planner's x-scenarios-lj#1 and "waits and its give-ups" tests (14) pass too.
- **Suggested fix:** take such a chain to be landing too, bounded as a done chain is. No new request is needed, and `landedBy`'s every-leaf rule marks the chain in once its leaves are listed:
  ```ts
  const mayLand = (c: ChainRecord, now: number) =>
    ((!!c.done && c.ended !== undefined && now - c.ended < LANDING_MS) || (tailWaits(c) && now - c.tail!.landed! < LANDING_MS)) &&
    !c.landed && makers(c).length > 0;
  ```

### 2. A stopped public mix's half-mixed box: Bring one back anyway says the private payer avoids another account's money, then the worker pays with it (low)

- **Where:** `extension/src/background/lovejoin.ts:6667` (withdrawOne's private-payer order). On the page: `extension/src/ui/screens/Lovejoin.tsx:1021` (AnywayQuestion's `account`) and `:983` (PayerNotes' `privateAccounts` line).
- **Concerns:** two halves of x-privacy#0. sc-lj-2's page half shows the line for any public account's box (`fromPublic`). wlj-1's worker half ranks by `depositAccountOf`, which names an account only for a box a deposit made.
- **Scenario:**
  - The wallet has 2+ public accounts, and a token pool whose boxes can't pay their own way back.
  - Account 0's mix there, two waves deep, stopped after its first wave (a lock or a refusal). Its box from the first mix is "not mixed yet" and is in `fromPublic`.
  - On Bring one back anyway, the question warns: "Its mix from your public account stopped before mixing it. Brought back now, anyone can tie your public account to your private balance." Then PayerNotes, with `box` set to the active account, adds: "It avoids one made private from another public account where it can: that would tie the two accounts."
  - The user chooses Pay from my private balance. `depositAccountOf` is undefined for a box a mix made, so the `another` rank never applies, and the smallest UTxO that pays goes. Here that is one made private from account 1.
  - The private UTxO it comes back into carries `box:…+public:1`. Account 1's money is now tied to a box the wallet itself says ties account 0. That is the tie the line had just said it avoids.
  - HeldQuestion doesn't have this problem: its held public boxes are always deposit boxes.
- **Evidence:** test `zz-review-cross-area-3.test.ts` (deleted), built on wlj-1's x-privacy#0 setup.
  - `status()` lists the box in `fromPublic` and in `notMixed`, with the pool stuck.
  - The withdraw spent `a1…#0` and `d2…#0`, which is account 1's 3 ₳, not account 0's 50 ₳ (`d1`). Its origin is `box:…+public:1`.
  - Failure: `AssertionError: paid with account 1's money beside account 0's box: expected [ …(2) ] to deeply equal [ …(2) ]`.
  - With the candidate fix in a copy, it passes, and so do `lovejoin-crediting-review-fixes.test.ts`'s 10 tests.
- **Suggested fix:** in withdrawOne's private-payer order only, rank by the notion the page uses: `depositAccountOf(s, box) ?? accountOf(originOf(box, s))`. The ties it records stay as they are. The alternative is for status to say which public boxes a deposit made, and for the page to show `privateAccounts` only for those. No refusal either way.

### 3. orWithoutReserve falls back only when the ADA is short: a top-up, or Mix my boxes again, that the reserve alone pushes past one transaction's UTxOs is refused (low)

- **Where:** `extension/src/background/sessions.ts:4502`, and its one-transaction callers: `topUpBuild` (`:2147`, `inParts: false`) and `againBuild` → `mixFunding` (`:2055`, `inParts: !mix.again`).
- **Concerns:** reserve, 323-worker#0. orWithoutReserve's own doc says the reserve is "never what refuses a funding".
- **Scenario:**
  - A site's session tops up with a new collateral where a 5 ₳ pool would take it, so the direct reserve applies (2.8 ₳ at today's parameters).
  - The private balance is many small UTxOs: 40 of 0.5 ₳ in the test.
  - Without the reserve, the top-up of 3 ₳ plus its 5 ₳ collateral takes about 17 of them, and builds. With the reserve it needs 23, past one transaction's computation (about 22).
  - A top-up is one transaction, so WebAssembly throws its too-many error. orWithoutReserve only catches `NotEnoughPrivate`, so the top-up is refused, though it goes without the reserve.
  - Mix my boxes again from the private balance is one transaction too, and meets the same edge with 1.5 ₳.
  - The error ("Spending 23 UTxOs at once needs more computation than a transaction may use") doesn't name the reserve. Turning Settings' collateral switch off is the only way out.
- **Evidence:** test `zz-review-cross-area-1.test.ts` (deleted).
  - With no 5 ₳ pool, the same top-up builds.
  - With the pool shown: `Error: Spending 23 UTxOs at once needs more computation than a transaction may use` (thrown from `buildWithdraw` via `sessions.ts:2839`).
  - With orWithoutReserve also falling back on that error, in a copy, the test passes.
- **Suggested fix:** in orWithoutReserve, also fall back when the error matches sessions.ts's own `TOO_MANY` pattern. "Too many UTxOs with the reserve" then gets the same quiet fallback as "too little ADA with the reserve" (reserve's call 4).

## Questions

1. **A dropped collateral payment blocks a new one for up to 2 h.** wss-2's 309#1 keeps the collateral "waiting" for up to 2 h while the payment is held as sent. wss-2 suggested the screens round add a "set it again anyway" control, and sc-o-2 didn't. So a collateral payment a mempool dropped stops Set collateral on Home, on Lovejoin's form and on the page for up to 2 h, and with it public mixes and anything else that needs collateral. Is that the owner's call, or should the control come in?
2. **The late line promises a resend that Stop cancels.** sc-lj-2's late line, "If a node dropped it, it's sent again within 2 hours.", sits beside Stop. After Stop, w-left's `recheck` gives the box a fresh due time, drawn 2 h on, and it comes back hours later. Should the line promise only what holds if the run goes on?
3. **A cut chain's collateral box comes back unmixed.** Before a lock, Bring every box back now waits for a session's collateral's mix (`collateral`). After a lock has cut that chain (no reservation, tail still rebuildable by tailOf), the same run takes the 5 ₳ box back unmixed, tying the session's tail deposit to the private balance. The bring's question does warn that an unmixed box ties its deposit. Is that intended, or should it wait for a rebuildable tail as it does while the tail waits?

## Leftovers (sharpening the known ones)

- **L3:** `sessions.ts:4485`, tailReserve's `collateralPool(...).catch(() => undefined)`, and `lovejoin.ts:3812`, collateralPool's `split(...).catch(() => undefined)`, also swallow a trap. That includes the one `usableNow` rethrows. The funding then goes on to the next WebAssembly call on the broken instance. Neither catch is in L3's list.
- **L4:** `lovejoin.ts:3883`, wlj-3's tailChain `ours` check, reads spent marks with `spentSet(session)`, which is `Date.now()`, as `listing()` does.

## Checks

- **Throwaway tests:** `npx vitest run` on `zz-review-cross-area-{1,2,3}`. All 4 tests fail on the tree, with the output quoted above.
- **Scratch copy:** each candidate fix was applied alone and the test rerun:
  - finding 1's test and `lovejoin-bring-review-fixes.test.ts`: 17 of 17;
  - with the planner's x-scenarios-lj#1 and tail tests: 14 of 14;
  - finding 2's test and `lovejoin-crediting-review-fixes.test.ts`: 11 of 11;
  - finding 3's test: 1 of 1.
  - The copy's source was restored after each, and checked identical to the tree with `diff -rq`.
- **Typecheck:** `npx tsc --noEmit -p .` shows errors only in throwaway test files (other reviewers' and mine). The source is clean.
- **Locales:** no duplicate keys, and every key base is in en, es and ja.
- **Cleanup:** the throwaway tests and the copy are deleted.
