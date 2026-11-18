# r2time#1: verification

From lane R2time, graded low by its finder.

## Trace: confirmed, low

It holds. The account for Bring one back paid from the public account is read twice. withdrawNowNow reads it at the press and writes it into the watch (lovejoin.ts:7155 → :7168). withdrawOne reads the active account again after a network wait, then builds and signs with it (:7641 → :7652 → :7656-7658).

Nothing closes that window:
- `withKeys` derives keys from the account active at each call (wallet.ts load, ~:650).
- UI requests run concurrently: each gets its own port, and nothing serialises them (ui-port.ts).
- account-use refuses a switch only for a maybe-sent payment, a public mix maybe sent, or public chains being sent (handlers.ts:378-380). A withdraw being built is none of these. My test sends the switch through that real handler, mid-build, and it goes through.
- In the UI, the pool page disables only its own Back (Lovejoin.tsx:3543). The top bar's Home and Settings buttons, and a second window, still reach both account pickers.

The result: the transaction spends account 1's UTxO, and the history ties it to `public:1`, but the watch says `paysAccounts: [0]`.

At landing, `paysActive` decides (pending.ts:202):
- Landing on account 1, the one that paid: only the private side is read again. 1.9.1's `toAccount: true` read both sides, so this part is new in fdd3b8b2.
- Back on account 0 by the landing: account 0 is read as account 1's transaction lands. That is e5#2's timing tie, which 1.9.1 made for every paid withdraw, so this round left it rather than made it.

One precondition the finder didn't state: the submit itself drops the whole reading (`stale(..., paid === true)`, :7803). The stale state therefore needs a full reading taken between the submit and the landing: any Home mount, a form, or a second window.

Not known: no backlog, archive, owner-calls or INDEX entry covers a switch during this build. The nearest are:
- chunk-34 review item 9: the original `toAccount` fix, which fdd3b8b2 narrowed;
- gap-g2#2: whose box the hatch takes, not who pays;
- t1g#14: Mix again's own account check.

Severity is low:
- Only the user can reach it, by switching inside a seconds-long window (longer under Koios's back-off).
- No money moves.
- The total Home shows stays right: the landed change shows as on its way, through the held sent record (2 h), until the next full reading.
- The tie case adds little to what privacy.md:235 already admits about IP. Per privacy.md:235, the timing rule only helps on a shared IP.
- The way out is automatic: any Home mount after 60 s, or Refresh.

Paying from the account switched to (and so the on-chain tie to it) predates this round.

**Evidence:**

All lines are from the committed code at HEAD (f88560c4). In committed code, lovejoin.ts last changed in fdd3b8b2. The other fixer's uncommitted lovejoin.ts edits (gap-g6#2's rejudge) don't touch this path.

**Trace**
1. **Press.**
   - lovejoin.ts:7154, the round's own comment: "The account that pays is the one the wallet is on as it's pressed."
   - :7155 `const payer = paid === true ? await this.deps.wallet.withKeys((keys) => keys.account) : undefined;`
   - :7156 calls `withdrawOne(...)` with no payer passed.
2. **First network wait.**
   - :7641 `rewardsField(await this.rewardsIn(network, [pool]))`.
   - That goes rewardsIn :4682 → readRewards → `koios.accountInfo(stake)` :4703. No `withKeys` turn is held over it.
3. **Switch.**
   - UI ports answer concurrently (ui-port.ts `answer(message, report).then`).
   - handlers.ts:378-380 refuse only `maybeSent || mixMaybeSent` (pending.ts:281 `unsettled` needs `w.maybeSent`) or `publicChainsSending` (lovejoin.ts:5986). `withdrawing` isn't checked.
   - accounts.ts:200-203 writes LOCAL_ACCOUNT inside a single `withKeys` turn.
   - wallet.ts:654-656: the next key use derives the new account.
   - In the UI: the pool page's `backDisabled={busy}` (Lovejoin.tsx:3543) disables only its own Back. App.tsx's top-bar brand (Home) and Settings buttons stay live, and so do the AccountPicker and Settings → Public accounts.
4. **Build.**
   - :7652 `readAccount(this.deps, network)`, with no account option (account.ts:173-193 → readAccountUtxos, `account` undefined → withKeys).
   - :7656-7658 `built = await wallet.withKeys((keys) => { payer = keys.account; ...buildLovejoinWithdrawPaid(keys.cardano, ...) })`: the new account signs. `ties` and the history follow it.
5. **Watch.** :7168 `watchSent(this.deps, pending, { ...(payer !== undefined ? { paysAccounts: [payer] } : {}) ... })`, using the outer `payer` from step 1.
6. **Landing.**
   - pending.ts:202 `if (w.paysAccounts) return w.paysAccounts.includes(active);`, inside forgetReading :215-220, called with `keys.account` (:823/:875/:958).
   - `lovejoin-withdraw` is in PRIVATE_SPENDS (:164).
   - main's pending.ts:175-182 used `w.toAccount`, set to true for every paid withdraw (main lovejoin.ts:7115), so a landing always dropped the whole reading.
7. **Display.**
   - balances.ts:227-230 keeps the cached account side when private-stale is set.
   - balances.ts withIncoming :335-375 subtracts the spent input and shows the change as incoming while heldSent (2 h) and SPENT_KEEP_MS (2 h) hold.
   - Home.tsx:124 and :387-389: a full refresh happens only on mount past 60 s, or on Refresh.
8. **Precondition.** :7803 `stale(session, network, paid === true)` removes SESSION_BALANCES at the submit. Step 5's stale side therefore needs a reading kept after the submit.
9. **Sibling guards already in the code:**
   - publicAgainBuild :5131 `if (keys.account !== account) throw new Error(NOT_READY());`
   - publicBuild :4951 records `account: keys.account` from the turn that signs.

**Run in FIXTREE, my test only**
Command: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m nice -n 10 npx vitest run tests/r51-r2time-1.test.ts`

```
× watches the account whose UTxO pays, and reads that account again as it lands, and no other 2436ms
AssertionError: landing on 1: the watch names the account that paid (1): expected [ +0 ] to deeply equal [ 1 ]
AssertionError: landing on 1, paid by 1: expected { kept: true, privateOnly: true } to deeply equal { kept: false, privateOnly: undefined }
AssertionError: landing on 0: the watch names the account that paid (1): expected [ +0 ] to deeply equal [ 1 ]
AssertionError: landing on 0, paid by 1: expected { kept: false, privateOnly: undefined } to deeply equal { kept: true, privateOnly: true }
Test Files  1 failed (1)  Tests  1 failed (1)
```

With `VITE_ENABLE_MAINNET=false`: the same four failures, 1 failed.

**In a copy** at ~/.cache/seedelf-review-51/verify-r2time_1-trace (rsync per the brief, node_modules symlinked, lovejoin.ts replaced by `git show HEAD:`; removed afterwards):
- **Committed code.** Same four failures. Log: `R2TIME 1 sent watch [ 0 ]` / `R2TIME 1 payer 1 kept true privateOnly true` / `R2TIME 0 sent watch [ 0 ]` / `R2TIME 0 payer 1 kept false privateOnly undefined`.
- **Mutant A** (the press-time account pays throughout: readAccount `{account}` plus withAccount): passed. `payer 0 / watch [0]`; landing on 1 → private side alone; landing on 0 → both sides.
- **Mutant B** (the watch uses the account withdrawOne signed with): passed. `payer 1 / watch [1]`.
- **Mutant C** (publicAgainBuild's check in the build's turn): passed. `refused ... watch undefined`, nothing submitted.

**Known check**
I searched for: paysAccounts, toAccount, escape hatch, Bring one back, hatch, switch near build/withdraw/during.
- Where: backlog.md, archive/plans/*.md, review-51 INDEX.md, owner-calls.md, verify/e5-2.md and fixes/G6.md.
- Found only: chunk-34-token-pools.md:718 item 9 (the original toAccount fix), gap-g2#2 (whose box), t1g#14 (Mix again's check coverage), and G6's e5#2 tests (switches after the send). None covers this.

**Known:** None. Related, but not this finding:
- docs/archive/plans/chunk-34-token-pools.md:718, item 9: the original "a paid withdraw left the public balance stale" fix through `toAccount`. fdd3b8b2 replaced it with a `paysAccounts` read taken at the press.
- review-51/owner-calls.md §3, gap-g2#2: whose box the escape hatch takes, not which account pays.
- review-51/INDEX.md:474, t1g#14: test coverage of publicAgainBuild's own account check, the guard this path lacks.
- verify/e5-2.md, and fixes/G6.md's e5#2 tests: these cover switches after the send, never during the paid build.

**Fix notes:**

**What to change** (lovejoin.ts withdrawNowNow/withdrawOne): one account pays from the press to the signature, and the watch names that same account.

- **Preferred, fix A:**
  - Read the account once, at the press (:7155). Use that same value for hatchOrder (:7125) and pass it into withdrawOne.
  - Give readAccount (account.ts:173) an `account` option. readAccountUtxos already takes one; the stake address then goes through `wallet.withAccount`.
  - Build and sign under `wallet.withAccount(payer, …)` instead of `withKeys` (:7656).
  - Pass the same value on the RewardsChangedError retry (:7782), which re-reads the active account today.
  - Watch with `paysAccounts: [payer]`.
  - Why: the account the user pressed on (which PayerNotes names) pays, and hatchOrder's R3-3 pick stays true. A switched-to account can't pay for the pressed account's own box (which would tie the two accounts on chain; that part predates this round).
- **Equal and smallest, fix C:** do what publicAgainBuild does at :5131. Inside the build's `withKeys` turn, check `keys.account === payer` and refuse with its existing NOT_READY words. No new string is needed. It's a race guard, not a refusal of anything the ledger takes, but the lead may want to check it against the 2026-10-19 rule. Fix A avoids that question.
- **Minimum, fix B:** withdrawOne hands back the account its keys signed with (the `payer` it already writes into Withdrawing `ties`), and withdrawNowNow watches with that. The watch and the landing come out right, but the switched-to account still pays.
- I checked all three in a copy: the test above passes under each.

**Class:** "which account" recorded in a different wallet turn from the one that signs.
- Already right: publicBuild records `account: keys.account` in its build turn (:4951); publicAgainBuild checks in its build turn (:5131); Send takes `built.account` from keep() at the build; mintedBy names the account the review was signed on (privacy.md:135).
- Still to check: hatchOrder's own read of the active account (:7125); any flow that builds in one turn and keeps or watches in a later one (X4's note on send.ts pay/keep).
- Grep `withKeys((keys) => keys.account)` in lovejoin.ts, sessions.ts, send.ts and staking.ts for reads made before a network wait, then a build under plain `withKeys`.

No owner call needed for A or B; C at the lead's discretion.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-web-wallet/extension/tests/r51-r2time-1.test.ts`

Result: The test FAILS today in FIXTREE, in both builds (1 test, 1 failed, about 2.4 s).

**Default build:**
- Command: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m nice -n 10 npx vitest run tests/r51-r2time-1.test.ts`
- The four soft failures:
```
× watches the account whose UTxO pays, and reads that account again as it lands, and no other 2436ms
AssertionError: landing on 1: the watch names the account that paid (1): expected [ +0 ] to deeply equal [ 1 ]
AssertionError: landing on 1, paid by 1: expected { kept: true, privateOnly: true } to deeply equal { kept: false, privateOnly: undefined }
AssertionError: landing on 0: the watch names the account that paid (1): expected [ +0 ] to deeply equal [ 1 ]
AssertionError: landing on 0, paid by 1: expected { kept: false, privateOnly: undefined } to deeply equal { kept: true, privateOnly: true }
Test Files  1 failed (1)
     Tests  1 failed (1)
```

**`VITE_ENABLE_MAINNET=false`:** the same four AssertionErrors; Test Files 1 failed (1), Tests 1 failed (1).

**In a copy** (removed afterwards), with lovejoin.ts at `git show HEAD:`, so the other fixer's uncommitted edits are left out:
- **Unpatched:** the same four failures. Logs: `R2TIME 1 sent watch [ 0 ]`, `R2TIME 1 payer 1 kept true privateOnly true`, `R2TIME 0 sent watch [ 0 ]`, `R2TIME 0 payer 1 kept false privateOnly undefined`.
- **Fix A** (the press-time account pays and signs throughout): 1 passed.
- **Fix B** (the watch names the account withdrawOne signed with): 1 passed.
- **Fix C** (a check in the build's own turn, as publicAgainBuild does): 1 passed, through the refusal branch, with nothing submitted.

```
// Chunk 51, r2time#1 (the review of its own merged fixes): Bring one back paid from the public account reads which
// account pays twice. withdrawNow reads it as it's pressed, for the watch's paysAccounts (fdd3b8b2, e5#2's sibling);
// withdrawOne reads, builds and signs with whichever account is active after its pool's reward-account read. A switch
// in between, which handlers.ts lets through, has one account pay while the watch names the other. Whichever account a
// fix makes pay, the watch names the one whose UTxO the transaction spends, and its landing reads that account again
// and no other: the rule lovejoin-release-rules.test.ts pins with no switch. A fix that refuses the build once the
// account moved under it sends nothing, which holds too.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { handle, type Context } from "../src/background/handlers";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { pendingKey } from "../src/background/pending";
import { SESSION_BALANCES_PREFIX, SESSION_PRIVATE_STALE_PREFIX } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { bech32 } from "./fixtures/bech32";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;
const SLOW = { timeout: 240_000 };
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
  scripts: KoiosUtxo[];
};
const TOKEN_POOL: PoolRef = { reference: FOUND.reference, seed: FOUND.seed, scripts: FOUND.scripts };
const VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: TOKEN_POOL }))) as {
  id: string;
  mixBoxHash: string;
  token: { policyId: string; assetName: string; quantity: string };
};
const TOKEN = VIEW.id;
const Q = BigInt(VIEW.token.quantity);
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));
/** The token pool's mix_logic reward account: what withdrawOne's first request (rewardsIn) asks account_info about. */
const LOGIC = JSON.parse(loadTestWasm().lovejoinMixLogic(JSON.stringify({ network: "preprod", poolRef: TOKEN_POOL }))) as { stake: string };
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
/** A byte three times preprod's price: the 2 ₳ box can't pay its own way back, so the public account pays. */
const DEAR = { coins_per_utxo_size: "12930" };

type T = ReturnType<typeof testBalances>;

function pooled(t: T): LovejoinService {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new LovejoinService({
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
    pools: async () => [TOKEN_POOL],
    random: () => 0.5,
  });
}

/** The worker's handlers over `t` and `lj`: the switch goes through account-use's own gate. */
const contextOf = (t: T, lj: LovejoinService) =>
  ({
    ...(t as unknown as Context),
    lovejoin: lj,
    wasm: loadTestWasm(),
    connector: async (on: boolean) => on,
    version: "1.0.0",
    network: "preprod",
    networks: ["preprod"],
  }) as Context;

/** Account 0's: one of the recorded account's UTxOs, made again as `tx`'s with `value`. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] as never };
}

/** Account `index`'s: a UTxO of ADA alone at its receive address 0/0. */
async function atAccountIndex(t: T, index: number, tx: string, value: string): Promise<KoiosUtxo> {
  const [address, key] = await t.wallet.withAccount(index, ({ cardano }) => [cardano.receiveAddress(t.deps.wasm.Network.Preprod, 0), cardano.paymentKeyHash(0, 0)]);
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return {
    ...first!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address,
    value,
    stake_address: null,
    payment_cred: key,
    inline_datum: null,
    datum_hash: null,
    asset_list: [],
    reference_script: null,
  } as unknown as KoiosUtxo;
}

async function datum(t: T, ours: boolean): Promise<string> {
  const wasm = loadTestWasm();
  if (ours) return t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/** A box in the token pool, the wallet's or a stranger's, a mix having moved it `hours` ago. */
async function tokenBox(t: T, tx: string, ours = true, hours = 5): Promise<KoiosUtxo> {
  t.koios.txSpends.set(tx.repeat(32), [{ payment_addr: { bech32: TOKEN_ADDRESS, cred: VIEW.mixBoxHash } }]);
  return {
    ...POOL[0]!,
    tx_hash: tx.repeat(32),
    tx_index: 0,
    address: TOKEN_ADDRESS,
    payment_cred: VIEW.mixBoxHash,
    value: "2000000",
    block_time: Math.floor(t.clock.now / 1000) - hours * 3600,
    datum_hash: null,
    inline_datum: { bytes: await datum(t, ours), value: {} },
    asset_list: [{ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: Q.toString(), decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

const strangers = (t: T) => Promise.all(Array.from({ length: 12 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));

/** Holds the first account_info request about `stake` until released; `hit` once it's asked. */
function holdAccountInfo(t: T, stake: string) {
  const real = t.koios.fetch;
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const hit = new Promise<void>((r) => (reached = r));
  let once = true;
  t.koios.fetch = async (url, init) => {
    if (once && new URL(url).pathname.endsWith("/account_info") && String(init?.body ?? "").includes(stake)) {
      once = false;
      reached();
      await gate;
    }
    return real(url, init);
  };
  return { hit, release };
}

/** The private history's entry for `txHash`. */
const historyOf = async (t: T, txHash: string) =>
  (await t.store.get<{ entries: Array<{ txHash: string; origin?: { id: string; origin: string } }> }>("history.preprod"))!.entries.find(
    (e) => e.txHash === txHash,
  );

describe("chunk 51, r2time#1: Bring one back paid from the public account, the account switched while it builds", SLOW, () => {
  it("watches the account whose UTxO pays, and reads that account again as it lands, and no other", async () => {
    // `landOn`: the account the wallet is on as it lands: the one switched to, or back on the one it was pressed on.
    for (const landOn of [1, 0]) {
      const t = testBalances();
      await t.wallet.create(PHRASE, PASSWORD);
      t.koios.evaluation = AGREES;
      t.koios.tip = 110_000_000;
      const lj = pooled(t);
      const ctx = contextOf(t, lj);
      const mine = await tokenBox(t, "f1", true, 7);
      await t.accounts.add(1);
      // Each account can pay: 20 ₳, and 5 ₳ for its collateral.
      const zero = [atAccount("e1", "20000000"), atAccount("e5", "5000000")];
      const one = [await atAccountIndex(t, 1, "d1", "20000000"), await atAccountIndex(t, 1, "d5", "5000000")];
      t.koios.addedToAccounts.push(...zero, ...one, ...POOL, mine, ...(await strangers(t)));
      t.koios.params = DEAR;
      await t.balances.get("preprod");
      const sent = t.koios.submitted.length;

      // Pressed on account 0. While Koios answers withdrawOne's first request, the user picks account 1 (Account 2):
      // account-use's gate lets it through, as nothing of account 0's is maybe sent and no public mix is being sent.
      const hold = holdAccountInfo(t, LOGIC.stake);
      const going = lj.withdrawNow("preprod", { txHash: mine.tx_hash, txIndex: 0, pool: TOKEN }, false, true);
      await hold.hit;
      await handle({ type: "account-use", index: 1 }, ctx);
      expect(await t.accounts.active()).toBe(1);
      hold.release();
      const outcome = await going.then(
        (pending) => ({ pending }),
        (error: unknown) => ({ error }),
      );
      const watch = await t.wallet.withKeys(() => t.session.get<{ txHash: string; paysAccounts?: number[]; toAccount?: true }>(pendingKey("preprod")));
      if ("error" in outcome) {
        // Refused once the account moved under it: nothing sent, nothing watched.
        expect(t.koios.submitted.length, `landing on ${landOn}`).toBe(sent);
        expect(watch, `landing on ${landOn}`).toBeUndefined();
        continue;
      }
      const { pending } = outcome;
      expect(t.koios.submitted.length).toBe(sent + 1);
      // Which account paid, by the UTxO its transaction spends.
      const inputs = txInputs(t.koios.submitted.at(-1)!);
      const spends = (us: KoiosUtxo[]) => us.some((u) => inputs.includes(`${u.tx_hash}#${u.tx_index}`));
      const payer = spends(one) ? 1 : spends(zero) ? 0 : undefined;
      expect(payer, `inputs ${inputs.join(", ")}`).toBeDefined();
      expect(spends(one) && spends(zero)).toBe(false);
      // The history of what comes back ties the account whose keys signed it (Withdrawing `ties`, PRIV-3).
      expect((await historyOf(t, pending.txHash))?.origin?.id).toBe(`box:${pending.txHash}+public:${payer}`);

      // The watch names that account, as the history does.
      expect(watch?.txHash).toBe(pending.txHash);
      expect.soft(watch?.paysAccounts, `landing on ${landOn}: the watch names the account that paid (${payer})`).toEqual([payer]);

      // On account `landOn` as it lands (back on account 0 through the same gate: nothing maybe sent), Home's reading
      // of it kept.
      if (landOn !== (await t.accounts.active())) await handle({ type: "account-use", index: landOn }, ctx);
      expect(await t.accounts.active()).toBe(landOn);
      await t.balances.get("preprod");
      expect(await t.wallet.withKeys(() => t.session.get(SESSION_BALANCES_PREFIX + "preprod"))).toBeDefined();
      t.koios.confirmations = 1;
      expect(await t.pending.pending("preprod")).toMatchObject({ kind: "lovejoin-withdraw", txHash: pending.txHash, confirmations: 1 });
      // On the account that paid, both sides are read again; on another, the private side alone (e5#2, 34d's review 9).
      const kept = (await t.wallet.withKeys(() => t.session.get(SESSION_BALANCES_PREFIX + "preprod"))) !== undefined;
      const privateOnly = await t.wallet.withKeys(() => t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod"));
      const paidHere = payer === landOn;
      expect
        .soft({ kept, privateOnly }, `landing on ${landOn}, paid by ${payer}`)
        .toEqual(paidHere ? { kept: false, privateOnly: undefined } : { kept: true, privateOnly: true });
    }
  });
});
```
