# r2time#2: verification

From lane R2time, graded low by its finder.

## Trace: confirmed, low

The finding holds. I couldn't find a guard the finder missed, and a test drives three of the four writers it names.

- **withdrawOne, after its submit (lovejoin.ts:7814).** A's "box back" entry goes into B's private history. Remove wallet listed nothing during the submit, so it asked for no second yes.
- **settleWithdrawing's landing (lovejoin.ts:7929).** Same result: A's entry in B's history, and no second yes.
- **submitWatched's take and history write (pending.ts:570, :581).** After Remove's second yes, A's payment sits in B's Home watch and in B's history.
- **Sessions' noteLanded (sessions.ts:5287).** No pin here either, but it reaches less than "the same way". Its callers mostly re-read the book by index under B's key first, and `update` throws "no such session" unless B has a session at that index. So it writes A's return only in two cases: A's in-memory record already held a confirmed return whose history write had failed, or B has a session at the same index. An open session is listed by Remove, so this path needs the second yes.

**No missed guard.**
- `phrasePin`/`phraseOf` appear only in balances, account, accounts, dapp and pending.ts:811 (settleNow). None is in lovejoin.ts, sessions.ts, activity.ts or submitWatched.
- `ActivityService.update` seals under whichever phrase is unlocked.
- `atStake` never lists Lovejoin's `withdrawing`.
- `reset` deletes `history.*` and `lovejoin.*`, so B's history starts fresh and takes A's entry.

**Why low.**
- Only the user can cause it, and only in a narrow race. A background withdraw's submit or look must still be waiting on Koios (about a second normally, up to about 90 s behind a 429 hold and a slow node). In that time the user must finish Remove wallet and restore a different phrase.
- No funds move and nothing signed changes. Balances and coin selection are untouched, because the entry's tx hash names no UTxO of B's.
- The cost is a false entry, sealed for good, in B's private Activity on this device. It shows A's amount and tx hash, for example "Lovejoin +4.704978 ₳, fee 0.295022 ₳". After a forced Remove during a Send, A's payment banner also shows on B's Home.
- Remove wallet and a restore again clears it.

It isn't known: the owner-calls item "e4a#1's residue" covers receipts the old race already sealed, not these writers, which still write today.

**Evidence:**

I traced the committed code. lovejoin.ts is modified in FIXTREE's working copy, but the uncommitted edits are gap-g6#2's rejudge and accountKeys work, outside withdrawOne and settleWithdrawing. pending.ts, sessions.ts, activity.ts, handlers.ts and wallet.ts are unchanged against HEAD.

**1. withdrawOne (lovejoin.ts, HEAD)**
- The last checks come before the submit: the unlock at :7713 (`unlocked !== undefined && (await wallet.unlockedAt()) !== unlocked`) and quiet at :7718.
- :7764 `submitted = await koios.submitTx(bytes)`. The network wait is `RateLimit.take`, which honours a 429 hold of up to `MAX_BACK_OFF_MS` = 60 s (koios.ts:498, :574), then a fetch of up to `SUBMIT_TIMEOUT_MS` = 30 s (koios.ts:436), or 35 s on the data layer.
- After the answer, with no check of whose keys are in:
  - :7803 `await wallet.withKeys(() => stale(session, network, paid === true))`
  - :7814 `await this.deps.activity?.sent(network, pending, back).catch(bestEffort)`
  - :7815 `dropWithdrawing`

**2. settleWithdrawing**
- :7901 reads `w` from A's record.
- :7914 `const seen = await this.onChain(...)` (tx_status on preprod).
- :7929 `await this.deps.activity?.sent(network, pending, back)`, with no check.

**3. submitWatched (pending.ts)**
- :516 writeAhead seals the payment as maybe sent, so Remove lists it.
- :522 `submitted = await koios.submitTx(bytes)`.
- :570 `await take(deps, watched, …)`: restoreNow finds nothing in B's session, and `adoptKept` has deleted A's sealed copy, so `session.set(key, record)` puts A's payment in B's watch.
- :581 `await deps.activity?.sent(s.network, pending, s.summary)`.

**4. The writer and the store**
- activity.ts:627-639 update: `store.get(history.<network>) ?? {entries:[], first:true, …}`, then `store.set`.
- private-store.ts get/set use `wallet.withStoreKey`, which is the key of whichever phrase is unlocked.
- wallet.ts:500 reset deletes every record except `KEPT_ON_RESET` (maybeSent.*, lovejoinMaybe.*).

**5. Remove wallet's list**
- handlers.ts:624-657 `atStake` lists `maybeSentOn`, `sessions.atStake`, `chainsSending`, `publicMaybe` and parts.
- `chainsSending` and `publicMaybe` read `chains` and `keptMaybe` only (lovejoin.ts:5893, :5965). `withdrawing` is never listed.
- handlers.ts:259: without one of those, reset-wallet goes at the first yes.

**6. The pin is absent from these files.** `git show HEAD:` grep for phrasePin/phraseOf: balances.ts, account.ts, accounts.ts, dapp.ts, and pending.ts:811 only. None in lovejoin.ts, sessions.ts or activity.ts.

**7. Sessions**
- `sessions.reset()` (:1550) only clears its in-memory maps.
- noteLanded (:5281-5306) has no pin. Its callers settleReturns (:3646), act (:3816) and disconnect (:2583) call `this.update(network, index, …)` (:6427, which re-reads B's book and throws `sess.noNoSuchSession` without that index) before reaching it with a new landing. Without a new landing they pass A's in-memory record as it was.
- Sibling the finding doesn't name, traced only: listNow reads the book at :5799 and saves it at :5922 (`if (changed) await this.save(network, book)`) after Koios reads at :5808 and :5816.

**8. Run**
- With temporary logging (since removed), B's private Activity held:
  - Cases 1 and 2: `{"txHash":"c0d24b46…","lovelace":"4704978","tokens":0,"fee":"295022","kind":"lovejoin-withdraw","direction":"in","detail":"Lovejoin"}`
  - Case 3: `{"txHash":"2a21f45c…","lovelace":"2000000","fee":"233912","kind":"transfer","direction":"out","detail":"This is a test."}`
- In cases 1 and 2, `reset-check` during the wait returned `[]` and reset-wallet went with no `force`. In case 3, it listed the payment as `maybeSent` (second yes).
- In every case B is the wallet afterwards: the receive address is B's.

**Known:** None. It isn't settled or known.

- **docs/backlog.md:** no line on writes made after a submit or look across Remove wallet. Searched for "another phrase", "next phrase", "phrase restored", "restored meanwhile", "Remove wallet" with withdraw or history, "phrase pin" and C16.
- **docs/archive/plans/:** only chunk-27's C16, which pins the restore scan, and independent-review M2, which keeps a maybe-sent payment through Remove. Neither covers these writers.
- **review-51/owner-calls.md §4, "e4a#1's residue":** this is about receipts the old race already sealed, and recommends leaving them. It is not about the writers still unpinned.
- **fixes/G6.md:** the e4a#1 fix covers settleNow only and names no other writer.
- **lanes/X4.md:87:** X4 named withdrawOne, settleWithdrawing and sessions' noteLanded/settleReturns, but as a note only. It was never filed, fixed or settled (FIX.md, RESUME.md, FINDINGS.md and INDEX.md have no entry).
- **SECURITY.md:** doesn't apply. Koios is honest here, only slow.
- **Earlier verdicts:** none for r2time#2 in verify/ or data/verify-batch*.json.

**Fix notes:**

**Class.** e4a#1's: a write made under whichever phrase is unlocked when a network call returns, rather than the phrase the work began under. 2b3dfd80 pinned the readings, the account looks and settleNow only.

**Change.** No new string, no screen change, so no owner call. Take `phrasePin()` (wallet.ts:234) before each network wait. Check it with `wallet.withKeys(pin)` after the wait and before every write that follows. On a mismatch, skip those writes (the old phrase's records went with Remove) and end as a lock does (WalletLocked).

1. **lovejoin.ts withdrawOne:** pin before `koios.submitTx` (:7764). Check after the `submitted !== built.txHash` test (:7789), before stale (:7803), activity.sent (:7814) and dropWithdrawing (:7815).
2. **lovejoin.ts settleWithdrawing:** pin before `onChain` (:7914). Check before activity.sent (:7929), stale and drop (:7931-7932).
3. **pending.ts submitWatched:** pin before `koios.submitTx` (:522). Check before take (:570) and activity.sent (:581). Returning or throwing then leaves nothing in B's watch, which is right: `adoptKept` already deleted A's sealed copy.
4. **sessions.ts, the same family (traced, not run):**
   - sendBack's activity.sent (:5254), after sendRecorded's submit.
   - sendChain's last write (:5520).
   - noteLanded (:5287), reached from settleReturns (:3651), act (:3847), disconnect (:2583, :2591) and listNow (:5923).
   - listNow's `save(network, book)` (:5922), of a book read at :5799 before its Koios reads. Across a forced Remove and a restore, this seals A's whole sessions book under B's key. B's `markUnscanned` and restore scan wait behind it in sessions' serial queue and then read that book as theirs: the scan's `have` drops B's own found sessions at the same indexes.

**Better, close it at the writers.** Have `ActivityService.sent`/`arrived`, `SessionService.save`/`update` and `LovejoinService.update` take the pin, or an epoch that `Wallet.reset()` bumps, and check it inside their own store turn. Then grep for `activity?.sent(`, `activity?.arrived(`, `this.update(` and `this.save(` after an awaited Koios or giveme.my call in pending.ts, lovejoin.ts and sessions.ts.

**The mutant already shows 1–3 work.** In a HEAD copy, it made all three cases of tests/r51-r2time-2.test.ts pass and kept 34 neighbouring tests green. A plain lock between the submit and the check then ends the run with `withdrawing` kept, and settleWithdrawing writes its history after the unlock, as today.

**Optional, the owner's call.** `atStake` (handlers.ts:624) could list a Lovejoin withdraw in flight or maybe sent (`withdrawing`), so that Remove wallet takes the second yes. That needs a new line on Remove's screen.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-web-wallet/extension/tests/r51-r2time-2.test.ts`

Result: **FIXTREE, default build** (`npx vitest run tests/r51-r2time-2.test.ts`):
```
 ❯ tests/r51-r2time-2.test.ts (3 tests | 3 failed)
     × a due box's withdraw Koios takes meanwhile: none of it in B's history 2654ms
     × one Koios didn't answer, seen on chain by the next run's look: none of it in B's history 2475ms
     × a payment Koios takes meanwhile, Remove wallet's second yes given: neither B's watch nor B's history 1112ms
 FAIL … > a due box's withdraw Koios takes meanwhile: none of it in B's history
AssertionError: B's private Activity: expected [ Array(1) ] to not include '1ab732bd8d5b8d4608448793fb7f63616d407…'
 ❯ tests/r51-r2time-2.test.ts:116:59
 FAIL … > one Koios didn't answer, seen on chain by the next run's look: none of it in B's history
AssertionError: B's private Activity: expected [ Array(1) ] to not include '38d3ca3ef759f87f8c58409c2ef9343f2ec12…'
 ❯ tests/r51-r2time-2.test.ts:144:59
 FAIL … > a payment Koios takes meanwhile, Remove wallet's second yes given: neither B's watch nor B's history
AssertionError: B's watch: expected { kind: 'transfer', …(6) } to be undefined
+ Received: { "confirmations": null, "contract": true, "kind": "transfer", "network": "preprod", "submittedAt": 1800000000000, "triedAt": 1800000000000, "txHash": "549e5e66800b1c6258e1fea075417b3d4e27a4ca10aab2a0c26266f210b43287" }
 ❯ tests/r51-r2time-2.test.ts:171:99
AssertionError: B's private Activity: expected [ Array(1) ] to not include '549e5e66800b1c6258e1fea075417b3d4e27a…'
 ❯ tests/r51-r2time-2.test.ts:172:64
 Test Files  1 failed (1)
      Tests  3 failed (3)
```
In each case the setup expectations passed: Remove's list was `[]` in cases 1 and 2 and the maybe-sent payment in case 3, and the receive address is B's afterwards. Each case fails only at its final expectations.

**FIXTREE, `VITE_ENABLE_MAINNET=false`:** the same three cases fail, with the same four assertion errors. `Tests 3 failed (3)`.

**Control on committed code:** a copy of seedelf-platform with every modified file put back to HEAD; I compared 236 src and helper files against `git show HEAD`, 0 differ. The same 3 failures.

**Mutant in that copy:** `phrasePin`/`phraseOf` taken before the submit or look in withdrawOne, settleWithdrawing and submitWatched, and checked after it. Result: `Tests 3 passed (3)`. In the same copy, lovejoin-withdraw-submit.test.ts, remove-wallet.test.ts and remove-wallet-reading.test.ts gave `Tests 34 passed (34)`. The copy is removed. In FIXTREE I added only this test file.

```
// Chunk 51, finding r2time#2 (e4a#1's class, after its phrase-pin fix): what the worker writes once a submit or a
// look has answered goes to whichever phrase is in by then. A due box's withdraw, the alarm's own, goes to Koios under
// phrase A; while Koios answers, the user removes the wallet, which lists nothing open (a withdraw on its way isn't
// among what Remove wallet lists), and restores phrase B. When Koios answers, A's box-back entry is sealed into B's
// private history: withdrawOne's write after its submit, and settleWithdrawing's for one Koios didn't answer, seen
// later. A payment's submit the same, after Remove wallet's second yes: its watch goes into B's session, and its entry
// into B's history (pending.ts submitWatched). Each expectation is the right behaviour, and fails on the tree as it is.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { handle, type Context } from "../src/background/handlers";
import { LovejoinService } from "../src/background/lovejoin";
import { pendingKey, submitWatched } from "../src/background/pending";
import { NetworkChoice } from "../src/background/preferences";
import { SESSION_TRANSFER } from "../src/background/transfer";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import type { NetworkName } from "../src/networks";
import type { AtStake, Message } from "../src/shared/rpc";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, testBalances, transferPreprod, vectors } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const vector = (words: number) => vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** Phrase A: the wallet the withdraw or the payment goes from (owned-utxos.json's owner). */
const A = vector(12).phrase as string;
/** Phrase B: restored once A is removed, while Koios answers A's. */
const B = vector(24).phrase as string;
/** B's first receiving address: which phrase is in. */
const B_RECEIVE = vector(24).preprod.receive_0 as string;
/** Each withdraw is built and measured in WebAssembly. */
const SLOW = { timeout: 120_000 };

type T = ReturnType<typeof testBalances>;

function context(t: T, lovejoin = t.lovejoin): Context {
  const networks: NetworkName[] = ["preprod", "mainnet"];
  return {
    ...(t as unknown as Context),
    lovejoin,
    wasm: loadTestWasm(),
    connector: async (on) => on,
    version: "1.0.0",
    network: "preprod",
    networks,
    networkChoice: new NetworkChoice(t.local, networks),
  };
}

const ask = (message: Message, ctx: Context) => handle(message, ctx);

/** Settings' Remove wallet, its screen reading first what's open (returned), then B restored by its phrase. */
async function removeAndRestoreB(ctx: Context, force = false): Promise<AtStake[]> {
  const listed = (await ask({ type: "reset-check" }, ctx)) as AtStake[];
  await ask({ type: "reset-wallet", ...(force ? { force: true } : {}) }, ctx);
  await ask({ type: "restore-wallet", phrase: B, password: PASSWORD }, ctx);
  return listed;
}

/**
 * As lovejoin-withdraw-submit.test.ts has it: A unlocked an hour ago, its unlock's draws made, one box of its own in
 * v2's 5 ₳ pool, due; giveme.my's witness stood in for, so the withdraw that goes is submitted.
 */
async function due() {
  const t = testBalances({ pools: [ADA_POOL] });
  await t.wallet.create(A, PASSWORD);
  madeByAdaMix(t.koios, "e1".repeat(32));
  const owned = adaBox("e1", await ownDatum(t.wallet), t.clock.now);
  t.koios.addedToAccounts.push(...ADA_ROWS, owned);
  const unlocked = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, unlocked));
  await t.store.set("lovejoin.preprod", { due: [], pools: { [ADA]: { due: [t.clock.now - HOUR] } }, unlock: unlocked });
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const lovejoin = new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [ADA_POOL],
  });
  return { t, lovejoin, ctx: context(t, lovejoin) };
}

/** The transactions B's private Activity lists. */
const bHistory = async (t: T) => (await t.activity.seedelf("preprod")).map((e) => e.txHash);

describe("what a submit or a look writes once it answers, after Remove wallet and a restore of another phrase (r51 r2time#2)", () => {
  it("a due box's withdraw Koios takes meanwhile: none of it in B's history", SLOW, async () => {
    const { t, lovejoin, ctx } = await due();
    let listed: AtStake[] | undefined;
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx")) return real(url, init);
      // Koios takes it and answers slowly (a 429's hold before it, a node slow to say): the user removes the wallet
      // and restores B meanwhile.
      const taken = await real(url, init);
      listed = await removeAndRestoreB(ctx);
      return taken;
    };
    await lovejoin.withdrawDue("preprod", false, t.clock.now).catch(() => undefined);
    t.koios.fetch = real;
    const sent = txIdOf(t.koios.submitted.at(-1)!);

    // Remove wallet listed nothing open, so it took no second yes; and B is the wallet now.
    expect(listed, "Remove wallet's list").toEqual([]);
    expect((await t.wallet.account("preprod")).receiveAddress).toBe(B_RECEIVE);
    // A's box came back to A: B's private Activity never lists it as a box of B's back from Lovejoin.
    expect(await bHistory(t), "B's private Activity").not.toContain(sent);
  });

  it("one Koios didn't answer, seen on chain by the next run's look: none of it in B's history", SLOW, async () => {
    const { t, lovejoin, ctx } = await due();
    const real = t.koios.fetch;
    // Koios takes it, and its answer never comes (a 504): it may have gone through, so it's kept and looked for.
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx")) return real(url, init);
      await real(url, init);
      return new Response("", { status: 504 });
    };
    await lovejoin.withdrawDue("preprod", false, t.clock.now).catch(() => undefined);
    const sent = txIdOf(t.koios.submitted.at(-1)!);

    // The alarm's next run looks for it (tx_status): the user removes the wallet and restores B while Koios answers,
    // and it's on chain.
    t.koios.confirmations = 1;
    let listed: AtStake[] | undefined;
    t.koios.fetch = async (url, init) => {
      if (listed === undefined && url.endsWith("/tx_status") && String(init?.body).includes(sent)) listed = await removeAndRestoreB(ctx);
      return real(url, init);
    };
    await lovejoin.withdrawDue("preprod", false, t.clock.now).catch(() => undefined);
    t.koios.fetch = real;

    expect(listed, "Remove wallet's list").toEqual([]);
    expect((await t.wallet.account("preprod")).receiveAddress).toBe(B_RECEIVE);
    expect(await bHistory(t), "B's private Activity").not.toContain(sent);
  });

  it("a payment Koios takes meanwhile, Remove wallet's second yes given: neither B's watch nor B's history", SLOW, async () => {
    const t = testBalances();
    const ctx = context(t);
    await ask({ type: "restore-wallet", phrase: A, password: PASSWORD }, ctx);
    // A private payment, reviewed and kept for Send.
    t.koios.evaluation = transferPreprod.evaluation;
    const built = await t.transfer.build("preprod", [{ to: transferPreprod.to, lovelace: "2000000", tokens: [] }]);
    const kept = (await t.wallet.withKeys(() => t.session.get<{ txCbor: string }>(SESSION_TRANSFER)))!;
    let listed: AtStake[] | undefined;
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx")) return real(url, init);
      const taken = await real(url, init);
      // Remove wallet lists it, maybe sent (written ahead), and the user says yes twice; then B is restored.
      listed = await removeAndRestoreB(ctx, true);
      return taken;
    };
    const sending = { network: "preprod", txHash: built.txHash, kind: "transfer", txCbor: kept.txCbor, key: SESSION_TRANSFER, kept } as const;
    await submitWatched(t.deps, { ...sending, summary: built, contract: true, again: false }).catch(() => undefined);
    t.koios.fetch = real;

    expect(listed?.find((a) => a.network === "preprod")?.maybeSent?.txHash, "Remove wallet's list").toBe(built.txHash);
    expect((await t.wallet.account("preprod")).receiveAddress).toBe(B_RECEIVE);
    // B's Home watches nothing of A's, and B's private Activity lists none of A's payments.
    expect.soft(await t.wallet.withKeys(() => t.session.get(pendingKey("preprod"))), "B's watch").toBeUndefined();
    expect.soft(await bHistory(t), "B's private Activity").not.toContain(built.txHash);
  });
});
```
