# Review of the fixes: privacy and words

Lens: every new or changed string in `en.json` since `499768f6`, the privacy policy's changed lines, and the privacy effects of the fixes. All four findings that could be tested were proven with a throwaway test (`tests/zz-review-privacy-words-<n>.test.ts`), each deleted afterwards. No tracked file was edited.

**Verdict:** no high or medium. Four lows, each confirmed by a failing test, and five nits.
- Two lows come from the same gap: a fix keyed on one record where the worker decides by another (findings 1 and 2).
- Two lows are words or flows the fixes didn't reach (findings 3 and 4).
- The privacy policy's two changed lines are true. Every warning and privacy note sits in a `.warn.` or `.privacy.` key. No code binds `t()` at module level or compares translated text, and nothing shown writes "seedelf" in lowercase.

## Findings

### 1. low: the private payer's new note says it avoids another account's money, but the worker doesn't for a box an intermediate mix wave made

- **Where:** `extension/src/background/lovejoin.ts:6667`, against `extension/src/ui/screens/Lovejoin.tsx:1021` and `:980–983`.
- **Concerns:** wlj-1 (x-privacy#0, the worker half) and sc-lj-2 (x-privacy#0, the page half).
- **Scenario:**
  - A wallet has two public accounts.
  - A public mix from account 0 into a token pool goes at the default depth, 2. A lock cuts it after its first wave.
  - The first wave's box is not mixed yet (`unmixedOf`). It's in status's `fromPublic`, because `originOf` gives the chain's owner.
  - The fees rise, so the pool can't pay its own way back.
  - On the pool's page, Bring one back anyway shows `PayerNotes` with `box` set to the account. With several accounts, that adds "It avoids one made private from another public account where it can: that would tie the two accounts."
  - The user keeps the default, Pay from my private balance. The worker's `deposited = depositAccountOf(...)` is undefined: `depositAccountOf` matches only `c.deposit === b.txHash`, and this box's hash is the first wave's mix. So `another` ranks every UTxO 0, and the smallest pays: money made private from account 1.
  - Result: the withdraw spends account 0's box beside account 1's money, which is the tie the note says it avoids. Its history names account 1 alone (`ties` is empty).
- **Evidence:** throwaway test 1.
  - Setup: `recordChain` for account 0 with a deposit `b1…`, a mix `c1…` and a mix `c2…`. Two of the three were sent, then the chain ended cut.
  - status lists `c1…#0` in both `notMixed` and `fromPublic`.
  - Then `withdrawNow(c1#0, anyway, "private")`, with private UTxOs `d1` (50 ₳, `madePrivate(0)`) and `d2` (3 ₳, `madePrivate(1)`).
  - Expected `[c1#0, d1#0]`. Received `[c1#0, d2#0]`.
- **Suggested fix:**
  - Rank the payers by the account the page names. In `withdrawOne`, use `depositAccountOf(s, box) ?? (unmixedOf(s.chains, [box]).length ? accountOf(originOf(box, s)) : undefined)` for the payer order.
  - Arguably use the same for `ties` too, since the anyway warning already says the box ties that account.
  - The alternative: show `privateAccounts` only where the worker ranks. No refusal either way.

### 2. low: a swap funded without the collateral's reserve still mixes its collateral through giveme.my at its return, and its approval says nothing of it

- **Where:** `extension/src/ui/screens/Swaps.tsx:1285`, which gates `:1362`, `:1380` and `:1390`. The same gating sits in `DappApprovals.tsx:481` and `SiteSessions.tsx:633`, against `sessions.ts:4241`.
- **Concerns:** sc-o-1 (x-privacy#1, 323-worker#6, gap-3#2), with reserve (323-worker#0's fallback).
- **Scenario:**
  - Preprod: the 5 ₳ pool is shown with two boxes free, and the settings are at their defaults.
  - The private balance pays the swap and its 5 ₳, but not 1.5 ₳ more. For example, the user types an amount between Max and the balance: `adaShort` doesn't count the reserve.
  - `orWithoutReserve` builds the funding without the reserve, so `summary.collateralReserve` is unset. The approval then shows:
    - the Plan line without "Mixed": "The proceeds and everything left, directly";
    - or `swaps.review.noBox`: "…so it all comes back at once";
    - and no `swaps.review.privacy.collateralMix` line.
  - The return that runs by itself still deposits the 5 ₳ and mixes it under giveme.my's collateral. That's after a refund, a Stop through Lovejoin, or a fill that's ADA.
  - Why: `buildBack`'s `intoPool` never reads `record.collateralReserve`, and WebAssembly builds the tail "when what the chain leaves pays for it" (lovejoin.ts:691).
  - So giveme.my sees a mix no screen named, and the approval said the 5 ₳ comes back directly.
  - Stop's dialog says nothing of it either.
  - A site's funding review in the same state says "The rest and the 5 ₳ come back at once". Its return review does show `CollateralTailNote` before anything is sent.
- **Evidence:** throwaway test 2.
  - `outBuild` with a balance of the fund plus 7.5 ₳ gave `collateralReserve` undefined.
  - `outSubmit` recorded no `collateralReserve` and `auto.direct: false`.
  - With the funding's outputs at the account, `backBuild` returned:
    - `collateralTail` `{ box, leaf, fee: "1005095", pool: 18c4df77…, txs: 2 }`;
    - `lovejoin` `{ boxes: 1, depth: 1 }`.
  - reserve's own test comment says as much: "the reserve only the 5 ₳ collateral, which may still be mixed with what's left".
  - reserve's call 4 and sc-o-1's call 1 put the fallback to the owner as "funded without the collateral's mix". The code doesn't do that.
- **Suggested fix:**
  - Key the collateral words on whether the return will mix it, not on the reserve. The worker keeps on the summary that `tailReserve` found a pool (say `collateralPool`), even when `orWithoutReserve` dropped the reserve.
  - Show `swaps.review.privacy.collateralMix` and the "Mixed" Plan and no-box lines on that, and keep the cost row on the reserve.
  - Do the same in `FundingWayBack` and `TopUpCollateralNote`.
  - Add one short line in Stop's dialog where its return goes through Lovejoin.
  - Correct reserve's call 4 and sc-o-1's call 1 in the owner's list. No refusal.

### 3. low: Max's note says the aside pays for the collateral's mix wherever a 5 ₳ pool is shown, though the funding pays none while that pool can't take it

- **Where:** `extension/src/background/lovejoin.ts:3823`, through `sessions.ts:1541`, to `Swaps.tsx:1087`.
- **Concerns:** sc-o-1 (323-worker#0, the form half).
- **Scenario:**
  - The state arises on mainnet as soon as anyone starts a 5 ₳ ADA pool: discovery shows it while it's under its 30-box floor. It arises on preprod while that pool has fewer than two boxes free.
  - `collateralPoolShown` checks only that the pool is shown. So the quote names `collateralReserve`, and Max keeps 1.5 ₳ aside.
  - The note then says "The other X ₳ pays the swap's costs and network fee, its collateral's mix, and what's kept aside for contracts".
  - But `collateralPool` checks the floor and the free boxes, so the funding adds no reserve and the return mixes nothing.
  - So the note tells the user their collateral will be mixed, and the 1.5 ₳ in fact stays in the private balance.
  - sc-o-1's call 2 covers the money (Max 1.5 ₳ short), not these words.
- **Evidence:** throwaway test 3. With the 5 ₳ pool holding one stranger's box and a balance of 1,000 ₳, `quote.collateralReserve` was "1500000", and `outBuild`'s `summary.collateralReserve` was undefined.
- **Suggested fix:** keep Max's aside, which is the private default. Change only the words:
  - say it as a possibility ("…what its collateral's mix may take");
  - or name the mix only where the quote knows the pool takes it, as the Mix form's `tailReserveOf` does.

### 4. low: the escape hatch can take another account's mixed box and pay with this account's money, naming neither

- **Where:** `extension/src/ui/screens/Lovejoin.tsx:1062`, against `lovejoin.ts:6198` and `:6667`.
- **Concerns:** sc-lj-2 and wlj-1 (x-privacy#0). The fix covers Bring one back and Bring one back anyway, not the escape hatch. The flow is pre-existing.
- **Scenario:**
  - Two public accounts each made a public mix into a token pool. The fees rise, so its boxes can't pay their own way back.
  - On account 0, the escape hatch (`hatchRequest`, `PaidQuestion`) names no box. The worker picks by `backOrder` among the wallet's mixed boxes, and can pick account 1's box.
  - status lists that box in `otherAccounts`. rpc.ts:2210–2214 says of such boxes: "Paid from this one, they'd tie the two accounts together".
  - The private payer doesn't rank account 0's money last, because `depositAccountOf` is undefined for a mixed box. The public payer is account 0 itself.
  - `PaidQuestion` renders `<PayerNotes />` with no box, so no account is named. The history it keeps names account 0 only.
- **Evidence:** throwaway test 4.
  - `recordChain` for account 1 with a deposit `b1…` and a mix `c1…`; its box is `c1#0`, all sent.
  - `status.otherAccounts` contains `c1#0:1`.
  - `withdrawNow(undefined, false, "private", TOKEN)`, with `d1` (50 ₳, `madePrivate(1)`) and `d2` (3 ₳, `madePrivate(0)`), spent `[c1#0, d2#0]`.
- **Suggested fix:** an order, not a refusal.
  - The escape hatch takes the active account's own boxes, or the private balance's, first.
  - Where it takes another account's box, the worker ranks that account's money first.
  - `PaidQuestion` then names the account, as `PayerNotes` does.

### 5. nit: x-privacy#0 made the stuck pool's questions longer, where the owner's rule asks to compress them

- **Where:** `extension/src/ui/screens/Lovejoin.tsx:977`. Concerns sc-lj-2.
- **Scenario:** a stuck pool, Bring one back anyway of account 2's box, from account 1. The question's body runs to 8 sentences, about 140 words:
  - the named warning, two sentences, and `hidesNamed`;
  - the private payer's note, two sentences, plus `privateAccounts`;
  - the public payer's note plus `publicNamed`.
- The fix appended two sentences rather than folding the names in.
- **Suggested fix:** fold the names into the sentences already there. Every tie stays.
  - The private note's last sentence: "Where it can, the wallet takes one that came back from Lovejoin, else one that ties no other account."
  - The public note: "Paid from {{active}}, one of its UTxOs goes into the box's own transaction, so anyone can tie {{active}} to the box, {{account}}'s, and to the private UTxO it comes back into."

### 6. nit: `lovejoin.mix.cantAffordPublic` says "a mix can spend" over Home's figure

- **Where:** `extension/src/ui/screens/Lovejoin.tsx:2950`, with `:2554`. Concerns sc-lj-1 (321-lj-screens#1).
- **Scenario:** in two cases, `publicSide` falls back to Home's figure: before the `utxos` answer, and for "a reading too large to keep". Home's figure counts the rewards, ADA held with tokens, and the collateral. The line still says "Your public account has X ₳ a mix can spend."
- **Suggested fix:** keep the old "holds" wording when `accountUtxos` is undefined.

### 7. nit: Max's note puts the change's least under "network fee"

- **Where:** `extension/src/ui/swap.ts:114`. Concerns sc-o-1 (323-worker#0).
- **Scenario:** `FEE_ROOM` is now 2 ₳: the funding's fee plus its change's least. `swaps.maxNote` and `swaps.maxNoteMixed` still say the aside "pays the swap's costs and network fee". About 1.46 ₳ of it is change that stays in the private balance.
- **Suggested fix:** name the room for the change, or count it with what's kept aside.

### 8. nit: a private Bootstrap's review hint still says "The deposit goes in now, in one transaction"

- **Where:** `extension/src/ui/screens/Lovejoin.tsx:172`. Concerns bootstrap's call 5, which sc-lj-1 left untouched.
- **Scenario:** a private Bootstrap is now three transactions: the funding, the deposit once the funding lands, and the sweep that brings the rest back.
- **Suggested fix:** give a private Bootstrap its own variant of the hint.

### 9. nit: the collateral switch's note is still a three-sentence paragraph

- **Where:** `extension/src/ui/screens/Settings.tsx:841`. Concerns i18n-existing (x-i18n-es#1).
- **Scenario:** `settings.lovejoin.collateralOn` was reordered but not shortened: about 70 words under one switch.
- **Suggested fix:** one short line, with the detail in the docs.

## Checks

**Every new or changed en key (since 499768f6):**

| Key | Verdict |
|---|---|
| `dappUi.back.privacy.noteLovejoinMixed` | True where the funding pays the reserve, and gated on it. |
| `lj.tail.fewBoxes`, `lj.tail.noPool`, `lj.tail.waiting` | True: `tailChain`'s codes, and the day (`TAIL_KEEP_MS`) and the hour (`TAIL_UNLANDED_MS` and `LANDING_MS`) are upper bounds from now. Saved reasons, never compared. |
| `lock.warn.partsWaiting`, `settings.remove.warn.partsWaiting` | True (parts.ts `waiting`). Parts are only ever private payments, so "stays in your private balance" holds. |
| `lovejoin.anyway.privacy.*Named`, `lovejoin.bootstrap.privacy.accountNamed`, `lovejoin.stuck.privacy.publicNamed` | Name the right account (`otherAccounts` ⊆ `fromPublic`; the public payer is the active account). `privateAccounts` is false in finding 1's case. |
| `lovejoin.collateralMix.label` | True (`COLLATERAL_MIX_COST`). |
| `lovejoin.mix.cantAfford` | True. |
| `lovejoin.mix.cantAffordPublic` | Finding 6. |
| `lovejoin.review.privateNoteMixed`, `againNoteMixed`, `returnRest` | True. |
| `lovejoin.bootstrap.cantAfford` | True. |
| `lovejoin.pools.startedMissing`, `lovejoin.pools.warn.startedCopy`, `lovejoin.launch.warn.startedBefore` | True; `.warn.` keys; no date in the warnings. |
| `lovejoin.mixes.held/released` plurals | True, with the plural shown while balances are hidden. |
| `pending.*.lovejoin_bootstrap` | True: only a public Bootstrap's watch carries the mark. |
| `settings.lovejoin.bringWait.*`, `bringLate`, `bringNonePool` | True, one line each, Stop shown. |
| `settings.lovejoin.collateralOn` | True; finding 9. |
| `sites.topUp.collateralMixed` and the four `swaps.plan.*Mixed` | True where the reserve is paid; finding 2 otherwise. |
| `swaps.maxNoteMixed` | Finding 3. |
| `swaps.retry.privacy.cbor` | True, short, `.privacy.`, between Copy and the hex. The unsigned transaction names the one-time account, and anyone can follow its funding. |
| `swaps.review.noBoxMixed`, `swaps.review.privacy.collateralMix` | True where the reserve is paid; finding 2. |
| `withdraw.leftFee`, `withdraw.leftLimit` | True (max-left's `leftWhy`). |
| `worker.spend.partsConflict.return` | True. |
| `worker.parts.partlyMaybe`, `worker.parts.fundingPartlyMaybe` | Say "the server", and "the rest didn't go" is true (`letGo`). |
| `lj.bring.warn.privatePayNone` | True, and only Bring every box back now uses it. |

**Other en sweeps:**
- No en value says "Koios didn't answer" where either server may answer.
- Nothing shown writes "seedelf" in lowercase (`words.test.ts` passes).

**The privacy policy:**
- "Once a private session's return is sent, it also measures the one mix…" is true: `tailWitness` evaluates through the Cardano server, then asks giveme.my.
- "…which names the session's one-time account" is true: the mix spends the session's change.
- "Seedelf and Lovejoin transactions" and the grouping sentence are true.
- The store listing's matching rows are true too.

**Code rules:**
- No module-level `t()` in any added line.
- No translated text compared or parsed. The `/pool has \d+ boxes/` test is pre-existing and reads core's untranslated Rust error.
- Persisted reasons follow the established saved-reason pattern.

**Guard tests:**
- i18n, words, the critical helpers, the worker reasons, the worker's words, i18n-review-fixes, privacy-notes, import-boundaries and ui-safety: 171 of 173 pass. The 2 failures are L5's es/ja checks.
- lovejoin-accounts-, approvals-, lovejoin-crediting- and collateral-reserve-review-fixes: 41 of 41 pass.

**The privacy effects of the fixes:**
- **x-privacy#0's naming:** no new exposure. It's on the wallet's own screens, about the same phrase's accounts, and the pool page already named other accounts (`OtherAccounts`). The cases it misses are findings 1 and 4.
- **withdrawOne's payer order:** box-back is first and "pure": a merged class's origin isn't "lovejoin". The order then ties no other account, where the box is at a public deposit. It's narrower than the page says (finding 1), and the escape hatch has none of it (finding 4).
- **322#0:** true, as in the table above.
- **The collateral's mix:**
  - giveme.my is named wherever the reserve is paid, on the swap approval and the Mix and Mix again reviews. Hand-reviewed returns (`CollateralTailNote`) and Bring everything back are keyed on the built tail.
  - The gap is finding 2.
- **pool-exists:** links nothing new. The reference UTxO is the pool's, the same for everyone, and the deposit's `mix_box` output names the pool already. Lovejoin's own deposit builder always reads it (`_reference/Lovejoin` cb5a5a3, `offchain/src/tx/deposit.ts:563-569`), so token deposits now look more like Lovejoin's. The classic pool is unchanged, and no request is added.
- **reserve's fallback:** see the questions below.

**New requests the fixes added:**
- **wss-2's restore scan** asks `utxo_info` for the first contract input of each other payment into a one-time account, in the same request as the order outputs. See the questions.
- **w-left** adds one pool read 2 hours after Stop: the same read every wallet makes.
- **wlj-4** moves the generic `epoch_params` read earlier.
- None names a new party.

## Questions

1. **The restore scan (wss-2, x-scenarios-sessions#0)** now also asks the Cardano server about the first private UTxO each other payment into a one-time account spent.
   - It's asked of every such payment, a stranger's too, and the chain already shows those inputs. So I see no new knowledge for the server.
   - But the policy's rule is a dated Changes entry for each data-handling change. Should the 18 October entry's Find leftovers line name it?
2. **Does a funding without the reserve mark itself by its shape?** A little.
   - A swap's first output is the fund or the fund plus 1.5 ₳ (2.8 ₳ for a site). Read against the order's amount, the leftover is about 1.6 ₳ against about 3.1 ₳.
   - On its own, it's shared with Settings' switch off, with returns off, and with every wallet while no pool qualifies.
   - Paired with a collateral tail at the return, which the fallback still builds (finding 2), it says the private balance couldn't pay 1.5 ₳ more at funding time.
   - Is that acceptable? Refusing would be a guard the chain doesn't make.
3. **The wallet's own model disagrees.**
   - `otherAccounts` and C01 say a public mix's box is that account's: another paying ties the two.
   - PRIV-3's `ties` and the new payer order treat only a box at a deposit as tied.
   - Which does the owner want? Findings 1 and 4 assume the first.

## Leftovers met

- **L5 confirmed.** `tests/i18n.test.ts`'s es/ja checks list 14 unchecked critical drafts:
  - `dappUi.back.privacy.noteLovejoinMixed`
  - `lj.bring.warn.privatePayNone`
  - `lock.warn.partsWaiting`
  - `lovejoin.anyway.privacy.hidesNamed`, `.publicDepositNamed` and `.publicStoppedNamed`
  - `lovejoin.bootstrap.privacy.accountNamed_other`
  - `lovejoin.launch.warn.startedBefore`
  - `lovejoin.pools.warn.startedCopy`
  - `lovejoin.stuck.privacy.privateAccounts` and `.publicNamed`
  - `settings.remove.warn.partsWaiting_other`
  - `swaps.retry.privacy.cbor`
  - `swaps.review.privacy.collateralMix`

  The derived-set check passes.
- **L1 sharpened.** Besides its pricing, Stop's dialog never says its return through Lovejoin mixes the collateral under giveme.my (finding 2).
