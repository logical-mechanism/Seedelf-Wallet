# gap-g2#2: verification

From lane gap-G2, graded low by its finder.

## Trace: partly, low

The main case holds, and a run shows it. A public Mix again review left with Back stays kept for Send, with the account's boxes reserved, for 10 minutes (BUILT_TTL_MS). In that window the page's status still lists those boxes as the wallet's. So hatchAccountOf names no account, and PaidQuestion shows the plain "your public account" note. The worker leaves reserved boxes out, though. hatchOrder's only candidate is then another account's mixed box, and withdrawOne pays for it from the account on screen. That ties the two accounts after a question that never named the other one, which privacy.md says it does ("its question then names that account").

The finding's second case doesn't hold: "up to two hours after a public Mix again stopped at a step that may have gone through". Before holdOnly keeps that step's inputs reserved, the worker marks them spent (rememberSpent, lovejoin.ts:5431). ours() drops spent boxes from both status's `boxes` and the worker's `owned` (lovejoin.ts:3338). So the page and the worker count the same boxes, and the question names the other account. The only gap is a moment after the 2-hour spent mark lapses and before publicLook settles the hold.

The private-payer part is narrower than stated. The privateNamed wording doesn't name the box's account either: it only adds "else one that ties no other account". The worker still applies that preference (owner = the box's account, at lovejoin.ts:7608-7611).

Not known: it is absent from backlog.md, from the archived reviews' Not fixed / Left open / Disputed lists and from the chunk 46 and 49 plans, and no other review-51 lane reports it.

Severity is low. Only the user can reach it, through ordinary actions, and only when all of these hold:
- a token pool whose boxes can't pay their own way back;
- several public accounts that each mixed into that pool from the public side;
- every mixed box the active account has there taken by a kept review;
- no free box there that no account put in;
- the paid hatch pressed within the 10 minutes.

The cost is an on-chain tie between two of the user's own public accounts, made after the user chose to pay and was told the account gets tied to the box. No funds go to the wrong place. It can't be undone once sent, but waiting 10 minutes or sending the review first avoids it.

**Evidence:**

Trace, each line opened in TREE (extension/src unchanged since cd764fba; code = web-wallet/1.9.1):
1. Build: publicAgainBuild takes the active account's own boxes (lovejoin.ts:5039 `free(fromAccount(split.owned, schedule, account), split.reserved)`) and calls checked() at :4978: `this.reserve(network, chainOwner(), built.txs, this.deps.now() + BUILT_TTL_MS)`. reservationOf (spent.ts:197-216) covers every input of every tx, so the account's boxes are included. cantComeBack refuses nothing here: takesNewBoxes/usableNow refuse only belowMinimum, superseded or retired (:4198-4243).
2. Back: Lovejoin.tsx:3057 leaveReview only clears page state. Nothing tells the worker, so the reservation stands until it lapses.
3. Page: status() lists `boxes: mine` (lovejoin.ts:6397), the PoolRead's `owned: listed.filter((b) => !spent.has(ref(b)))` (:3338). Spent boxes are left out, reserved ones are not. status reads `reserved` (:6382), but only for `free: free(others, reserved).length`.
4. The callout's button is on (Lovejoin.tsx:3547 `disabled={busy || mixingAgain}`; mixingAgain is the private sessions' alone, :856). The question is `<PaidQuestion account={hatchAccountOf(pool)}>` (:3665). hatchAccountOf (:1128-1134) returns an account only when every box it can take is in otherAccounts. The active account's reserved box counts as takeable, so it returns undefined. PayerNotes (:1170) then shows lovejoin.stuck.privacy.public and .private, which name no other account.
5. Worker: handlers.ts:565-572 calls withdrawNow(network, undefined, false, true, pool).
   - chainsMixing counts only recorded chains (:5926-5929), and a kept review isn't one, so nothing stops it.
   - `reserved = await this.reservedBoxes(network)` (:7019) includes kept-for-Send reservations (spent.ts reservations keeps until > now).
   - :7072 `backOrder(free(of(back), reserved)...)` drops the account's boxes.
   - :7075 hatchOrder (:2251-2257) ranks another account's box last but takes it when nothing else is left.
   - withdrawOne's `paid === true` path (:7580-7593) builds with the active account's UTxOs (`payer = keys.account`) and signs.
   - A named box would be refused (`lj.boxReserved`, :7034); the hatch sends none.
6. privacy.md:421 promises "another account's only where nothing else is, the lowest first, and its question then names that account"; :423 says the note names both accounts.

Run (my test, real WebAssembly, v2 token pool fixture, coins_per_utxo_size 4800):
- Before the review: cantComeBack is set, otherAccounts = [a1@1], and hatchAccountOf is undefined, which is right.
- publicAgainBuild returns {again: true, boxes: 1, owned: 1}. Its kept chain spends c1#0 and not a1#0. The session's reservation 'public' holds c1#0 with until > now + 1 min.
- One minute later, status still lists c1#0 and hatchAccountOf is still undefined.
- withdrawNow(paid true) spent a1#0 (account 1's box) and e6#0 (account 0's 60 ₳). The assertion failed: "expected undefined to be 1".

Control (the same test with only the review step removed, run once, then the file restored): the paid hatch spent c1#0 and e6#0 with the question naming nobody, which is consistent. The kept review's reservation alone flips the pick.

The second case is refuted at lovejoin.ts:5428-5436. When a step may have gone through, `rememberSpent(session, network, hexBytes(step!.txCbor), maybe.at)` runs, then chainEnded, then holdOnly. spentSet keeps marks for SPENT_KEEP_MS (2 h, spent.ts:33, :127-130), the same window as publicUnsettledNow's `by = m.at + SPENT_KEEP_MS` (:5752). So the boxes held are hidden from status and from the worker's `owned` alike.

Private chains: their reservations exist only while sessions.mixingAgain is true (sessions.ts:1279-1288). During that time the worker refuses (lj.mixingAgain, :7005) and the page turns the button off, so the public kept review is the only reservation the page can't see.

Since 3ea05dc1 (1.6.0's R3-3: hatchAccountOf and hatchOrder), in web-wallet/1.6.0 through 1.9.1.

**Known:** none. Searched docs/backlog.md and docs/archive/plans/*.md for:
- hatchAccountOf, hatchOrder, hatchTakes, escape hatch, R3-3;
- reserv (in review-1.6.0.md and the backlog);
- "kept for Send" with bring/hatch/withdraw;
- otherAccounts, "another account's box".

None covers it. R3-3 appears only as fixed, and chunk-34's call 36 and leftovers cover the payers, not reservations. It isn't in chunk-46's or chunk-49's plans, and the owner's rules don't settle it. In review-51, only INDEX and E8a's coverage mention the helpers, with no such finding.

**Fix notes:**

Fix (b) is the better one and needs no new refusal:
- status already reads `reserved` (lovejoin.ts:6382). Have it also hand each pool the refs of the wallet's own boxes that a reservation holds.
- Re-read status after leaveReview (Lovejoin.tsx:3057).
- Have hatchAccountOf (:1128) and hatchTakes (:3167) skip those boxes, as the worker's free(…, reserved) does at lovejoin.ts:7072. The question then names account 1 (Account 2), as privacy.md:421/423 promise.

Fix (a), having the worker refuse when its pick is another account's box the question didn't name, adds a refusal of something the ledger takes. That needs the owner.

The same family, traced, not run:
- When every box the page counts in a stuck pool is reserved by the kept review, hatchTakes still offers Bring one back. The worker then finds nothing and says "None of your boxes is in Lovejoin's pool." (lj.noneInPool, lovejoin.ts:7077-7094). That's a wrong refusal in words, nit or low.
- NotMixed's and AgainActions' counts ignore reservations too, but they only affect the counts shown.
- Named-box requests (Bring one back anyway, a Bootstrap's held box) are refused as boxReserved (:7034), so they're fine.

Drop the finding's two-hour holdOnly case. The held step's inputs are marked spent first (:5431), so the page and the worker agree there.

A side note, not a finding: the paid withdraw spent e6#0, the 60 ₳ UTxO the kept review's chain also pays from. readAccount excludes only reservations being sent (account.ts:122, :199), and kept-for-Send ones hold pool boxes alone by design. So that review's Send would then be refused and built again.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g2-2.test.ts`

Result: Run from extension/ with `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g2-2.test.ts`. It FAILS on TREE:

 ❯ tests/r51-gap-g2-2.test.ts (1 test | 1 failed) 15281ms
     × never pays from the account on screen for another account's box unless its question named that account 15280ms
 FAIL  tests/r51-gap-g2-2.test.ts > the escape hatch while a kept public Mix again holds the account on screen's own boxes (chunk 51, gap-g2#2) > never pays from the account on screen for another account's box unless its question named that account
AssertionError: the withdraw spent a1a1…a1#0, e6e6…e6#0: account 1's box a1, paid from account 0, after a question naming undefined: expected undefined to be 1 // Object.is equality
- Expected: 1
+ Received: undefined
 ❯ tests/r51-gap-g2-2.test.ts:190:7
 Test Files  1 failed (1)
      Tests  1 failed (1)

Every setup assertion before that line passed: the pool is stuck, otherAccounts = [a1@1], the question names nobody before the review, the kept chain spends c1#0, the 'public' reservation holds c1#0 for the 10 minutes, and status still lists c1#0.

Control (the same file with only the review step removed, run once, then restored): it passed, logging "c1…#0, e6…#0 question: undefined". With nothing reserved, the worker takes account 0's own box.

The file typechecks: `tsc --noEmit -p .` reports nothing for it (errors listed belong to other r51 files). Under fix (b) the page's question would name account 1, and under fix (a) nothing would be submitted; either way the test passes.

```
// Chunk 51, gap-g2#2: the escape hatch's question and the worker's pick disagree while a kept review reserves the
// boxes of the account on screen. In a token pool whose boxes can't pay their own way back, Bring one back names
// another public account only where every box it can take is that account's (hatchAccountOf, 1.6.0's release review
// R3-3), and the worker takes the account on screen's own first (hatchOrder). A public Mix again's review, built and
// left with Back, keeps the account's boxes reserved for Send for ten minutes (checked, BUILT_TTL_MS). The worker
// leaves those boxes out (free(…, reserved)), but the page's status still lists them, so the question names nobody
// and the worker takes the other account's box, paid by the account on screen. privacy.md: "another account's only
// where nothing else is, the lowest first, and its question then names that account". With the real WebAssembly and
// PR #163's preprod token pool's v2 twin, as lovejoin-crediting-review-fixes.test.ts has them (its R3-3 case at :641
// is this one with no reservation).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, SESSION_LOVEJOIN_PUBLIC, type PoolRef } from "../src/background/lovejoin";
import { SESSION_RESERVED_PREFIX, type Reservation } from "../src/background/spent";
import { hatchAccountOf } from "../src/ui/screens/Lovejoin";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** A real public chain and a real withdraw, built and measured in WebAssembly. */
const SLOW = { timeout: 300_000 };

/** 20 boxes from Lovejoin's preprod pool, as Koios lists them (2026-09-25). */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

/** PR #163's token pool's launch with its scripts derived on v2, never on chain (chunk 44, wasm/tests/fixtures). */
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
const TOKEN_ADDRESS = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(VIEW.mixBoxHash, "hex")]));

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

type T = ReturnType<typeof testBalances>;

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const at = (tx: string, i: number) => ({ txHash: tx, txIndex: i, pool: TOKEN });

/** Lovejoin reading the classic pool and the token pool, giveme.my's witness stood in for. */
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

/** A register datum: the wallet's, or a stranger's. */
async function datum(t: T, ours: boolean): Promise<string> {
  const wasm = loadTestWasm();
  if (ours) return t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
  const stranger = wasm.SeedelfKey.fromHex("01".repeat(32));
  const hex = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return hex;
}

/** A box in the token pool, the wallet's or a stranger's, made `hours` ago by a mix there, as Koios would say. */
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
    asset_list: [{ policy_id: VIEW.token.policyId, asset_name: VIEW.token.assetName, quantity: VIEW.token.quantity, decimals: 0, fingerprint: "asset1ljtest" } as never],
  } as KoiosUtxo;
}

/** Twelve strangers' boxes in the token pool: enough for one box two waves deep. */
const strangers = (t: T) => Promise.all(Array.from({ length: 12 }, (_, i) => tokenBox(t, (0x60 + i).toString(16), false)));

/** One of the recorded account's (account 0's) UTxOs, made again as `tx`'s with `value` and no token. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] } as KoiosUtxo;
}

/** A mix from public account `account` into the token pool, recorded and all sent: deposit, then `mixes`, its box at the last's output. */
async function publicMix(lj: LovejoinService, account: number, deposit: string, mixes: string[]): Promise<void> {
  const txs = [
    { kind: "deposit" as const, txCbor: "", txHash: deposit, fee: "0" },
    ...mixes.map((txHash) => ({ kind: "mix" as const, txCbor: "", txHash, fee: "0" })),
  ];
  const id = txs.at(-1)!.txHash;
  await lj.recordChain("preprod", { progress: `test.${id.slice(0, 4)}`, txs, leaves: [at(id, 0)], boxes: 1, pools: { [TOKEN]: 1 }, account });
  for (let i = 0; i < txs.length; i++) await lj.chainSent("preprod", id, i);
  await lj.chainEnded("preprod", id);
}

describe("the escape hatch while a kept public Mix again holds the account on screen's own boxes (chunk 51, gap-g2#2)", SLOW, () => {
  it("never pays from the account on screen for another account's box unless its question named that account", async () => {
    const t = testBalances({ owned: false });
    await t.wallet.create(PHRASE, PASSWORD);
    t.koios.evaluation = AGREES;
    t.koios.tip = 110_000_000;
    // The token pool's boxes can't pay their own way back (lovejoin-crediting-review-fixes.test.ts's stuckPool).
    t.koios.params = { coins_per_utxo_size: "4800" };
    const [a0, a1, c0, c1] = ["a0", "a1", "c0", "c1"].map((x) => x.repeat(32)) as [string, string, string, string];
    // Account 0, on screen: a 5 ₳ collateral and 60 ₳ of ADA alone beside the fixture's own UTxOs. Account 1's mix
    // left its box a1 in the pool, account 0's its box c1.
    t.koios.addedToAccounts.push(
      atAccount("e5", "5000000"),
      atAccount("e6", "60000000"),
      ...POOL,
      await tokenBox(t, "a1", true, 9),
      await tokenBox(t, "c1", true, 5),
      ...(await strangers(t)),
    );
    const lj = pooled(t);
    await publicMix(lj, 1, a0, [a1]);
    await publicMix(lj, 0, c0, [c1]);

    // Before any review: the pool is stuck, a1 is account 1's, and the question rightly names nobody, since the worker
    // takes c1, account 0's own (the :641 case).
    const before = (await lj.status("preprod")).pools!.find((p) => p.id === TOKEN)!;
    expect(before.cantComeBack).toBeDefined();
    expect(before.otherAccounts).toEqual([{ ...at(a1, 0), account: 1 }]);
    expect(hatchAccountOf(before)).toBeUndefined();

    // Mix again from my public account, reviewed, then Back (the page tells the worker nothing): kept for Send, and
    // its reservation holds c1 for ten minutes.
    expect(await lj.publicAgainBuild("preprod", TOKEN)).toMatchObject({ again: true, boxes: 1, owned: 1, pool: TOKEN });
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const reviewSpends = kept!.chain.flatMap((c) => txInputs(bytes(c.txCbor)));
    expect(reviewSpends).toContain(`${c1}#0`);
    expect(reviewSpends).not.toContain(`${a1}#0`);
    const reserved = await t.wallet.withKeys(() => t.session.get<Record<string, Reservation>>(`${SESSION_RESERVED_PREFIX}preprod`));
    expect(reserved?.public?.inputs).toContain(`${c1}#0`);
    expect(reserved!.public!.until).toBeGreaterThan(t.clock.now + 60_000);

    // A minute on, still within the ten: the stuck callout's Bring one back, and its question, from the page's status.
    t.clock.now += 60_000;
    const page = (await lj.status("preprod")).pools!.find((p) => p.id === TOKEN)!;
    expect(page.boxes.map((b) => `${b.txHash}#${b.txIndex}`)).toContain(`${c1}#0`);
    const question = hatchAccountOf(page);

    // Pay from my public account: hatchRequest(pool, true), as handlers.ts hands it to the worker.
    const sent = t.koios.submitted.length;
    const outcome = await lj.withdrawNow("preprod", undefined, false, true, TOKEN).then(
      () => txInputs(t.koios.submitted.at(-1)!),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
    );
    if (outcome instanceof Error) {
      // Refused, to be asked again: nothing went, so nothing was tied.
      expect(t.koios.submitted.length, `refused: ${outcome.message}`).toBe(sent);
      return;
    }
    // Another account's box, paid by the account on screen, ties the two accounts: only after a question naming it.
    const tookOthers = outcome.includes(`${a1}#0`);
    expect(
      tookOthers ? question : 1,
      `the withdraw spent ${outcome.join(", ")}: account 1's box a1, paid from account 0, after a question naming ${String(question)}`,
    ).toBe(1);
  });
});
```
