# gap-g5#1: verification

From lane gap-G5, graded medium by its finder.

## Trace: confirmed, medium

The finding holds. I traced it from the launch through discovery, the worker, the swap and the screens, and nothing anywhere holds a found pool to S0d's bound. That bound lives only in the wallet's own start (lovejoin-launch.ts:258) and in its form. My test ran the whole path with the real WebAssembly and failed on TREE, as expected:
- A 3 ₳, 900-MIN pool was launched by the wallet's own builder with only the S0d check stood in for: reference UTxO and both scripts at the holder, L registered by the launch.
- Koios's holder scan kept it as a standard v2 pool.
- lovejoinUsable said usable both ways (box minimum 1.517 ₳, withdraw fee 0.297 ₳, back 2.703 ₳), so the pool is neither unusable nor stuck.
- The hub's status row and the recorded preprod swap's way into it (1 box) carry no flag at all.
- S0d's own measure for that token is 3.82 ₳ under the same parameters. A box comes back with 2.70 ₳ when a part-of-the-token payment needs about 3.52 ₳, so a later partial send must merge.

Not known: there is no backlog line or archived Not-fixed entry, and no owner call covers it. Decision 22's enumerated standard leaves the bound out. chunk-34:524 shows the case was seen: Lovejoin's own 2 ₳ pool was kept off the hub only because its scripts sit at a key address.

Severity is medium, at its low edge:
- **Why medium:** a pool-launcher can cause it for about 23 ₳, and the default route (most used pool, Bring it back through Lovejoin on) sends users' swap and return tokens there with no word. The user's first partial send then co-spends the box: with tokens sent, selection takes another class before a second box (build.rs:2531-2537). That ties the box to that money, e.g. money made private from the account.
- **What tempers it:**
  - The spend's own review states the tie (HistoriesNote).
  - No Seedelf Wallet start can make such a pool, and mainnet has no token pool today (the bundled list holds two 5 ₳ ADA pools).
  - On mainnet the pool must also clear the 30-box floor and lead its token's pools.
  - No money is lost.

**Evidence:**

Trace (TREE at e36b62c5; code identical to web-wallet/1.9.1 but manifest.ts):

1. **Input: the launcher's datum.** The decode's only box bound is the contract's: pool.rs:175-184 (`box_lovelace > 0`, `0 < max_fee < box_lovelace`). The wasm functions verify_pool, candidate, launch_check and usable (wasm/src/lovejoin.rs:692-881) carry no box-value check. Only wasm box_value (:2986) runs least_box_lovelace, and its only caller is lovejoin-launch.ts. rg over extension/src finds no other user.

2. **Discovery keeps it.**
   - lovejoin-pools.ts:530 `if (!view || view.scriptsInline !== 0 || !this.listedValue(network, view)) return undefined;`
   - listedValue (:542-546) checks only the listed token, or that an ADA pool isn't 10 ₳.
   - The Koios path (:582-587 candidates, :617-623 launch check, :632 L rule) is the same.
   - Since 1772c96f (2026-10-17), first in web-wallet/1.6.0 (git blame :530).

3. **The worker measures only the withdraw.**
   - pool.rs:553-575: usable and comes_back both call measured(), which builds one withdraw (:624-631). It fails only on BelowMinimum (:602) or CantPayBack.
   - box_value.rs:8-23's steps 2-3 (part of it, or all of it, from what came back alone) run only in way_back (:322-353), called from least_box_lovelace alone.
   - lovejoin.ts:4210 `if (!usable.usable && usable.why === "belowMinimum") why = usable.why;` is usableNow's only refusal.
   - cantComeBack asks backOnly (:3110). usable() filters by usableNow (:3180), and stuck() is cantComeBack (:3191).
   - status' row adds only `cantComeBack` and `unusable` (:6476-6477).

4. **Picked by default.**
   - sessions.ts:1721 sorts the token's usable pools by others' boxes, and :1723 takes `works[0]`.
   - The way's only warning is `...(stuck ? { stuck } : {})` (:1766).

5. **The screens say nothing more.**
   - TokenWays: LovejoinReturn.tsx:242 shows "Through Lovejoin: {{boxes}}, funded now", and adds a warn line only for `into && w.stuck` (:270).
   - Hub flag: Lovejoin.tsx:2300 shows only for `p.cantComeBack`; the pool page's callout (:3537) likewise.

6. **At the later spend.** shared/histories.ts and build.rs:2531-2537: selection merges only when no unmerged choice pays. With tokens sent, it takes the token's UTxO plus another class first, and boxes last. The review then says ", and undoes some of what Lovejoin did for the box" (en.json:756). privacy.md's Lovejoin section admits only that "a payment above one box's worth from money that's all boxes can't" be kept apart.

7. **Run** (`systemd-run ... timeout 10m npx vitest run tests/r51-gap-g5-1.test.ts`, on TREE), console output:
```
"box": "3000000", "least": "3820000",
"kept": {"id": "bbc4e4b6…7117", "boxLovelace": "3000000", "version": "v2"},
"usable": {"usable": true, "boxMinimum": "1517120", "withdrawFee": "297218", "back": "2702782"},
"backOnly": {"usable": true, …},
"row": {"boxLovelace": "3000000", "said": []},
"way": {"pool": "this pool", "boxes": 1, "said": []}
```
The test then fails with `expected { hubSays: false, swapSays: false } to deeply equal { hubSays: true, swapSays: true }`.

8. **The assertion is satisfiable by either fix.** I checked this in a copy at $HOME/.cache/seedelf-review-51/verify-gap-g5_1-trace (removed afterwards); TREE's src is untouched, per `git status`.
   - Stand-in (b): a `partAlone` key on the status row and on tokenAt's way. Result: 1 passed, said: ["partAlone"] on both.
   - Stand-in (a): verified() drops a token pool under 3.82 ₳. Result: 1 passed.

**Known:** None; it isn't settled anywhere.
- **Searched:**
  - backlog.md: its whole Lovejoin section and chunk 34's leftovers; no line for S0d, least, part of itself or launched elsewhere.
  - Every archive/plans file and every review's Not fixed, Disputed and For the owner lists, for: S0d, least box, least, key address, Lovejoin's own app/UI, launch elsewhere, outside the wallet, tooLittle, pays part, part of itself.
  - SECURITY.md's out-of-scope list (a launcher acts on chain, so no dishonest source is involved), and the owner's rules.
- **The closest records, neither of which settles a sub-S0d pool with its scripts at the holder:**
  - chunk-34-token-pools.md:524: "Lovejoin's own 2 ₳ pool is usable by §2's rules … What comes back can't pay alone for part of its token, though. Session 1 settled it: with its scripts at a key address, the pool isn't shown at all (22)."
  - Decision 22's enumerated standard (:113-115), which leaves S0d's bound out.
  - Call 34 / session 5 ("Treat it like any pool", with the review saying so) covers only CantComeBack pools.
- **Within chunk 51:** no other lane reports it (INDEX.md:370 is this finding).

**Fix notes:**

**How the test stays neutral.** It asserts the common ground of both of the finder's fixes, and passes under stand-ins for each:
- (a) Discovery doesn't keep such a pool. That is decision 22's direction, and the test then returns early.
- (b) The hub's status row and the swap's way into the pool carry some key beyond their numbers and facts. That is call 34's direction.

The check is key-based (ROW_FACTS and WAY_FACTS), so whatever name the fix gives its flag doesn't matter. Reusing `cantComeBack` or `stuck` also passes.

**Either fix needs a measure of the found pool's own value.** Both pools in the test share a token shape: S0d's least_box_lovelace for it, cached by shape and epoch as comeBack is, or a way_back over the pool's own Protocol. One caveat: the Probe always measures with scripts by reference, and a found pool's scriptsInline is 0, so that matches.

**For the owner:**
- The wallet's own suite treats a sub-S0d pool as standard. Every token-pool flow test uses PR #163's v2 twin at 2 ₳ LJTEST, with its scripts at the holder, as "any token pool": lovejoin-flows, planner and crediting tests among them. lovejoin-discovery.test.ts:157 keeps the v1 2 ₳ LJTEST pool "as its launch would have been had it put its scripts at the holder". A fix in LovejoinService (b), or a check in readSet, will touch those fixtures. A fix in discovery only (a) won't, since they hand pools in directly.
- On mainnet with the data layer up, "finished" and the pool list are the server's word (architecture.md:741). Its copy of the rule (seedelf-data's standard.rs) wasn't read; it's outside the chunk. A fix of kind (a) should go into both copies and the shared vectors (tests/fixtures/lovejoin-shown.json), or the Koios-path and data-layer-path devices will differ.
- privacy.md's Lovejoin section says "a payment above one box's worth from money that's all boxes can't" be kept apart. For such a pool, a payment of part of one box can't be kept apart either. The doc needs a line, whichever fix is chosen.
- A small correction to the finder's figures, measured under preprod's 4,310 lovelace a byte for a 900-MIN box: a box comes back with 2.70 ₳, and the binding step (part of the token to a Seedelf) needs about 3.52 ₳ from what came back. The finder quotes call 2's older 3.39 ₳. S0d's least is 3.82 ₳.
- The ADA-pool half (ADA pools at 1.63 to 3.44 ₳) is reachable only through the hub's own Mix and Bootstrap. A return's ADA goes only into the earliest v2 5 ₳ pool (adaPoolOf), so nothing picks such an ADA pool by default.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g5-1.test.ts`

Result: The test fails on TREE, as intended. Run from extension/ with `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g5-1.test.ts`:

```
❯ tests/r51-gap-g5-1.test.ts (1 test | 1 failed) 7456ms
  × is never offered as any other: not shown, or the hub and the swap's approval say so 7454ms
AssertionError: a 3000000 lovelace box, S0d's least 3820000: {"box":"3000000","least":"3820000","kept":{"id":"bbc4e4b66c60e2d12939b6322356a448d401d0ba5a55d722f5187117","boxLovelace":"3000000","version":"v2"},"usable":{"usable":true,"boxMinimum":"1517120","withdrawFee":"297218","back":"2702782"},"backOnly":{"usable":true,"boxMinimum":"1517120","withdrawFee":"297218","back":"2702782"},"row":{"boxLovelace":"3000000","said":[]},"way":{"pool":"this pool","boxes":1,"said":[]}}: expected { hubSays: false, swapSays: false } to deeply equal { hubSays: true, swapSays: true }
- "hubSays": true, "swapSays": true
+ "hubSays": false, "swapSays": false
Test Files  1 failed (1)   Tests  1 failed (1)   Duration 11.56s
```

The precondition passes: the 3 ₳ box is below S0d's least of 3.82 ₳.

I also ran it in a throwaway copy (removed afterwards) to check that either fix would satisfy it:
- Stand-in fix (b), a `partAlone` key on the status row and on tokenAt's way: 1 passed, and both report said: ["partAlone"].
- Stand-in fix (a), discovery's verified() dropping a token pool under 3.82 ₳: 1 passed.

```
// Chunk 51, gap-g5#1: a standard pool someone else launched with its box under S0d's least. The wallet's own start
// never goes below that least (lovejoin-launch.ts's lj.launch.tooLittle, from WebAssembly's lovejoinBoxValue: "the
// least at which a box comes back and pays part of itself on its own: no launch goes below it"). A found pool is held
// to no such bound: discovery keeps a genuine, finished pool of a listed token whatever its box holds
// (lovejoin-pools.ts verified/listedValue), usableNow refuses only a box below the ledger's minimum, and cantComeBack
// measures the withdraw alone. So the hub lists it with no flag, and a swap's token goes into it with nothing beside
// it, while what comes back from each box can't pay part of itself without other money, which ties the two.
//
// The right behaviour, whichever way the owner fixes it: such a pool isn't shown at all (decision 22: "A user not
// following this standard should not be shown"), or what offers it says so (call 34's way: "Treat it like any pool",
// with the review saying so). This test passes either way, and fails while it's offered as any other pool.
//
// With the real WebAssembly: a 3 ₳ MIN pool (900 MIN a box) made by the wallet's own launch builder, its one S0d check
// stood in for, as a launcher's own tool would make it: the reference UTxO and both scripts at the holder, L
// registered by the launch. Found by Koios's holder, as preprod reads it; then the 5 ₳ pool beside it, as the planner's
// tests have them, and the recorded preprod swap that gets 902.08 MIN.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios, type KoiosLaunch, type KoiosUtxo } from "../src/background/koios";
import { LovejoinService, type PoolRef } from "../src/background/lovejoin";
import { LovejoinLaunchService } from "../src/background/lovejoin-launch";
import { HOLDER, LOVEJOIN_NFT, PoolDiscovery } from "../src/background/lovejoin-pools";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import tokenList from "../src/tokens/list.json";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, memoryArea, minswapEstimate, ownedUtxos, testBalances, vectors } from "./fakes";
import { ADA_POOL, ADA_ROWS } from "./v2-pools";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** A launch, a pool read and a swap's review, built and measured in WebAssembly. */
const SLOW = { timeout: 300_000 };

/** 20 boxes from Lovejoin's classic preprod pool, as Koios lists them (2026-09-25): rows below are made from one. */
const POOL = (JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }).pool;

/** MIN, on preprod's token list, which the recorded swap gets. */
const MIN = tokenList.preprod.find((x) => x.ticker === "MIN")!;
const MIN_UNIT = MIN.policy + MIN.name;
/** 900 MIN a box, so the recorded swap's least (902.08 MIN) makes one, as the planner's MIN pool has it. */
const MIN_Q = 900_000_000n;
/** The launcher's box: 3 ₳, the figure chunk 34's call 2 records as one that can't pay part of its token back alone. */
const BOX = "3000000";

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

type T = ReturnType<typeof testBalances>;

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era, for what the account signs (lovejoin-flows.test.ts).
  t.koios.tip = 110_000_000;
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return t;
}

/** Lovejoin reading the classic pool and `pools`, giveme.my's witness stood in for. */
function pooled(t: T, pools: PoolRef[]): LovejoinService {
  const wasm = loadTestWasm();
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
    pools: async () => pools,
    random: () => 0.5,
  });
}

/** The sessions over `lj`, the one-time key's signatures stood in for. */
function runner(t: T, lj: LovejoinService): SessionService {
  const wasm = loadTestWasm();
  return new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: lj,
    sleep: async () => undefined,
  });
}

const asset = (unit: string, quantity: bigint) => ({ policy_id: unit.slice(0, 56), asset_name: unit.slice(56), quantity: quantity.toString() });

/** One of the recorded public account's UTxOs, made again as `tx`'s with `value`. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] };
}

/** A stranger's register datum. */
function strangerDatum(n: number): string {
  const wasm = loadTestWasm();
  const stranger = wasm.SeedelfKey.fromHex(`01${n.toString(16).padStart(2, "0")}${"01".repeat(30)}`);
  const bytes = Buffer.from(wasm.registerToDatum(wasm.rerandomize(stranger.baseRegister()))).toString("hex");
  stranger.free();
  return bytes;
}

/** `n` strangers' boxes at `mixBox`, each holding `lovelace` and `token`. */
function strangers(t: T, mixBox: string, n: number, first: number, lovelace: string, token: ReturnType<typeof asset>): KoiosUtxo[] {
  const address = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(mixBox, "hex")]));
  return Array.from({ length: n }, (_, i) => {
    const tx = (first + i).toString(16).padStart(2, "0").repeat(32);
    t.koios.txSpends.set(tx, [{ payment_addr: { bech32: address, cred: mixBox } }]);
    return {
      ...POOL[0]!,
      tx_hash: tx,
      tx_index: 0,
      address,
      payment_cred: mixBox,
      value: lovelace,
      datum_hash: null,
      inline_datum: { bytes: strangerDatum(first + i), value: {} },
      asset_list: [{ ...token, decimals: 0, fingerprint: "asset1test" } as never],
    } as KoiosUtxo;
  });
}

type Made = {
  txCbor: string;
  pool: { id: string; mixBoxHash: string; mixLogicHash: string; seed: { txHash: string; txIndex: number } };
  locked: { mixBox: string };
};

/**
 * A MIN pool of `boxLovelace` boxes as a launcher's own tool makes it: the wallet's start from the public account, with
 * the one check a launch elsewhere needn't make, S0d's least (lovejoinBoxValue), stood in for. Everything else is the
 * wallet's own builder: the NFT, the reference UTxO and both scripts at the holder, and L registered, in one
 * transaction. Its rows at the holder as Koios lists them, and its launch as tx_info gives it.
 */
async function launchedElsewhere(t: T, boxLovelace: string): Promise<{ id: string; mixBox: string; holder: KoiosUtxo[]; launch: KoiosLaunch }> {
  const wasm = loadTestWasm();
  t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
  let made: Made | undefined;
  const launch = new LovejoinLaunchService({
    ...t.deps,
    wasm: {
      ...wasm,
      lovejoinBoxValue: () => JSON.stringify({ least: "1000000", suggested: "1000000", most: "9000000" }),
      buildLovejoinLaunchFromAccount: (key: Parameters<typeof wasm.buildLovejoinLaunchFromAccount>[0], request: string) => {
        const out = wasm.buildLovejoinLaunchFromAccount(key, request);
        if ((JSON.parse(request) as { register: boolean }).register) made = JSON.parse(out) as Made;
        return out;
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    lovejoin: t.lovejoin,
    discovery: { known: async () => [], look: async () => undefined },
  });
  await launch.build("preprod", { from: "public", token: { policyId: MIN.policy, assetName: MIN.name }, quantity: MIN_Q.toString(), boxLovelace });
  const outs = JSON.parse(wasm.ogmiosUtxos(made!.txCbor)) as Array<{
    transaction: { id: string };
    index: number;
    address: string;
    value: { ada: { lovelace: number } } & Record<string, Record<string, number>>;
    datum?: string;
  }>;
  const row = (o: (typeof outs)[number], extra: Partial<KoiosUtxo>): KoiosUtxo =>
    ({
      ...POOL[0]!,
      tx_hash: o.transaction.id,
      tx_index: o.index,
      address: o.address,
      payment_cred: HOLDER,
      value: String(o.value.ada.lovelace),
      datum_hash: null,
      inline_datum: null,
      reference_script: null,
      asset_list: [],
      ...extra,
    }) as KoiosUtxo;
  const atHolder = outs.filter((o) => o.address === outs.find((x) => x.value[made!.pool.id])!.address);
  const reference = atHolder.find((o) => o.value[made!.pool.id])!;
  const scripts = atHolder
    .filter((o) => o !== reference)
    .map((o) =>
      row(o, {
        reference_script: { hash: String(o.value.ada.lovelace) === made!.locked.mixBox ? made!.pool.mixBoxHash : made!.pool.mixLogicHash, type: "plutusV3" } as never,
      }),
    );
  const referenceRow = row(reference, {
    inline_datum: { bytes: reference.datum!, value: {} } as never,
    asset_list: [{ policy_id: made!.pool.id, asset_name: LOVEJOIN_NFT, quantity: "1", decimals: 0, fingerprint: "" } as never],
  });
  // L's reward account, which the launch registered (its certificate 0).
  const { mixLogicStake } = JSON.parse(
    wasm.lovejoinLaunchCheck(JSON.stringify({ network: "preprod", reference: referenceRow, inputs: [made!.pool.seed], scripts })),
  ) as { mixLogicStake: string };
  return {
    id: made!.pool.id,
    mixBox: made!.pool.mixBoxHash,
    holder: [referenceRow, ...scripts],
    launch: {
      tx_hash: referenceRow.tx_hash,
      block_height: referenceRow.block_height!,
      tx_block_index: 0,
      tx_timestamp: referenceRow.block_time!,
      inputs: [
        { tx_hash: "e1".repeat(32), tx_index: 0 },
        { tx_hash: made!.pool.seed.txHash, tx_index: made!.pool.seed.txIndex },
      ],
      certificates: [{ type: "stake_registration", info: { stake_address: mixLogicStake } }],
    },
  };
}

/** Koios answering a look at the holder: `holder`'s rows, and `launches` as tx_info. */
function holderKoios(holder: KoiosUtxo[], launches: KoiosLaunch[]): Koios {
  const fetch = async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.split("/").pop()!;
    const body = JSON.parse(String(init.body)) as { _payment_credentials?: string[]; _tx_hashes?: string[] };
    if (path === "credential_utxos") return Response.json(holder.filter((r) => body._payment_credentials?.includes(r.payment_cred ?? "")));
    if (path === "tx_info") return Response.json(launches.filter((l) => body._tx_hashes?.includes(l.tx_hash)));
    return Response.json([]);
  };
  return new Koios("https://preprod.koios.rest/api/v1", fetch, async () => undefined);
}

/** What a hub row holds of a pool's numbers and facts: anything else it carries is something said of the pool. */
const ROW_FACTS = new Set(["id", "version", "box", "boxes", "others", "free", "floor", "lovelace", "due", "notMixed", "unsure", "deposits", "fromPublic", "otherAccounts", "bootstrap", "token", "crowd", "launch", "mine"]);
/** The same of a swap's way for its token (sessions.ts tokenAt). */
const WAY_FACTS = new Set(["policyId", "assetName", "pool", "quantity", "boxes", "pools", "mixes", "mixFees", "withdrawFees"]);
const saidOf = (o: object, facts: ReadonlySet<string>) => Object.keys(o).filter((k) => !facts.has(k));

describe("a standard pool launched elsewhere with its box under S0d's least (chunk 51, gap-g5#1)", SLOW, () => {
  it("is never offered as any other: not shown, or the hub and the swap's approval say so", async () => {
    const t = await wallet();
    const wasm = loadTestWasm();
    const params = (await t.deps.koios("preprod").epochParams()) as Record<string, unknown>;
    // S0d's least for 900 MIN a box under preprod's parameters: no start of the wallet's goes below it.
    const { least } = JSON.parse(
      wasm.lovejoinBoxValue(JSON.stringify({ network: "preprod", params, token: { policyId: MIN.policy, assetName: MIN.name, quantity: MIN_Q.toString() } })),
    ) as { least: string };
    expect(BigInt(BOX), `S0d's least is ${least}`).toBeLessThan(BigInt(least));

    const made = await launchedElsewhere(t, BOX);
    const found = new PoolDiscovery({
      local: memoryArea(),
      wasm,
      koios: () => holderKoios(made.holder, [made.launch]),
      now: () => t.clock.now,
      headStart: () => ({ height: 0, pools: [] }),
    });
    await found.scan("preprod");
    const kept = (await found.known("preprod")).find((p) => p.id === made.id);
    // Decision 22's way: not shown, so nothing offers it.
    if (!kept) return;

    // Shown: what the wallet measures of it, for the record.
    const usable = JSON.parse(wasm.lovejoinUsable(JSON.stringify({ network: "preprod", params, poolRef: kept.ref, registered: true }))) as {
      usable: boolean;
      why?: string;
      withdrawFee?: string;
      back?: string;
    };
    const backOnly = JSON.parse(wasm.lovejoinUsable(JSON.stringify({ network: "preprod", params, poolRef: kept.ref, registered: true, backOnly: true }))) as {
      usable: boolean;
      why?: string;
    };

    // The hub's row for it, with strangers' boxes there.
    const lj = pooled(t, [ADA_POOL, kept.ref]);
    t.koios.addedToAccounts.push(...ADA_ROWS, ...strangers(t, made.mixBox, 8, 0x80, BOX, asset(MIN_UNIT, MIN_Q)));
    const row = (await lj.status("preprod")).pools?.find((p) => p.id === made.id);

    // The swap that buys MIN, Bring it back through Lovejoin on as by default, paid from the private balance.
    const sessions = runner(t, lj);
    const datum = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d1".repeat(32), tx_index: 0, value: "100000000", inline_datum: { bytes: datum, value: {} } } as KoiosUtxo);
    const quote = await sessions.quote("preprod", minswapEstimate.ask);
    const out = await sessions.outBuild("preprod", quote);
    const way = out.lovejoin?.ways?.find((w) => w.policyId === MIN.policy && w.assetName === MIN.name);

    const facts = {
      box: BOX,
      least,
      kept: { id: kept.id, boxLovelace: kept.boxLovelace, version: kept.version },
      usable,
      backOnly,
      row: row ? { boxLovelace: row.box.lovelace, said: saidOf(row, ROW_FACTS) } : "not listed",
      way: way ? { pool: way.pool === made.id ? "this pool" : way.pool, boxes: way.boxes, said: saidOf(way, WAY_FACTS) } : "no way",
    };
    console.log(JSON.stringify(facts, null, 2));

    // Shown, so whatever offers it says what its boxes can't do: the hub's row, and the swap's way into it.
    const hubSays = !row || saidOf(row, ROW_FACTS).length > 0;
    const swapSays = !way || way.pool !== made.id || way.boxes === 0 || saidOf(way, WAY_FACTS).length > 0;
    expect({ hubSays, swapSays }, `a ${BOX} lovelace box, S0d's least ${least}: ${JSON.stringify(facts)}`).toEqual({ hubSays: true, swapSays: true });
  });
});
```

## Impact: partly, low

The mechanics hold. Discovery shows a standard pool whose box is below S0d's least. At a swap's Review and at a return, the wallet picks it by default if it's the token's most used pool. Nothing says, when it's chosen, that a box back from it can't pay part of its token without other money. The impact doesn't reach medium, for five reasons.

1. No privacy link is made by default. The merge happens only at a later partial private send that the user starts. Transfer's review then shows the HistoriesNote before Send ("…ties them to each other, and undoes some of what Lovejoin did for the box"). That is privacy.md's documented Co-spending design for every merge: "it merges, and the review says what's spent together in a plain note". So privacy.md never says this link isn't made.
2. No money is lost. The box's ADA comes back (about 2.70 ₳ plus Q), and a box's mixing fees are the same in any pool.
3. No existing tool makes such a pool standard. The wallet's launch refuses a box below the least. Lovejoin's own launch puts the scripts at a key address, in transactions before the mint. A pool only counts as standard if its launch transaction itself puts both scripts at the holder (decision 30). So the actor must hand-build the wallet's one-transaction launch with a smaller box. That costs about 23.6 ₳ lost for good, plus 30 bootstrapped boxes parked, each brought back by hand at about 0.3 ₳. They must also outrank any other pool of the token. They gain nothing, and as the sole bootstrapper they already see through the mix, which privacy.md admits.
4. There are ways out. A whole box can be sent on its own. Change, always offered on the approval, lists the other pools with their box values, or Bring it back directly. Locking UTxOs steers selection. The approval also shows the box's ADA. Coming back directly is no more private: its UTxO holds the 2 ₳ margin beside the token, so a partial send from it merges too, tied to the session. Going through the pool stays the more private default.
5. The ADA-pool half is never on a default path. Returns put their ADA only in the 5 ₳ pool, so a 2 to 3.44 ₳ ADA pool is used only when the user opens its page, which shows its value.

The owner's call 34 settles fix (a), hiding such a pool: "Treat it like any pool", given for the worse case of boxes that can't come back at all. What's left is fix (b), a missing heads-up in an edge case: low. Mainnet has no token pool today (the bundled head start lists only two 5 ₳ ADA pools).

**Evidence:**

Holds as the finder traced it:
- lovejoin-pools.ts:528-546: `verified` and `listedValue` apply no box-value bound.
- lovejoin.ts:4198-4220: `usableNow` refuses only retired, superseded and belowMinimum. Its comment (:4190-4192) cites call 34: "every flow picks such a pool as any other".
- sessions.ts:1719-1725 and lovejoin.ts:3964-3986 pick the most used pool by `others`.
- LovejoinReturn.tsx:270 warns only on `stuck`.
- The S0d least (seedelf-core/tests/lovejoin_box_value_test.rs:25-31, 77): 3.83 ₳ for a typical token by reference, 3.45 ₳ for ADA.

Against the impact:
1. The owner's rules.
   - chunk-34-token-pools.md:113 (decision 22) defines standard as genuine + scripts at the holder + L registered + listed, with no box-value term.
   - :289-296 (section 2) holds found pools to min-UTxO and the way back only. The S0d bound is the launch form's (decision 14, :85).
   - :1242: "where the wallet picks a pool itself (acrossOf; tokenPool; Change's list) ... The owner: 'Treat it like any pool', with the review saying so."
2. The actor.
   - `git -C ../lovejoin show 29573c5:infra/bootstrap/koios-token-launch.py`, header: "publishes the three reference scripts to a base address of the launch key", BOX_LOVELACE = 2_000_000.
   - 01a-publish.sh:107-108: `--tx-out "$BOOTSTRAP_ADDR + ..." --tx-out-reference-script-file`, which is a key address, in its own transactions.
   - The standard needs both scripts at the holder in the launch transaction (lovejoin-pools.ts:12-14; decision 30).
   - lovejoin-launch.ts:258 refuses below the least.
   - Cost: chunk-34 :525, "A launch locks 23.12 ₳ for good ... about 0.52 ₳ in fees".
   - privacy.md:405: "boxes seeded by the pool's operator alone would hide nothing from the operator".
3. The link is disclosed when it's made.
   - shared/histories.ts:193-211 builds `histories.privacy.together` with `lovejoinUndone` (en.json:756-760).
   - Transfer.tsx renders HistoriesNote.
   - privacy.md:171: "When nothing it tried without merging pays (the change must exist, or the payment is large), it merges, and the review says what's spent together in a plain note".
4. No money is lost: privacy.md:412, "A box's mixes cost the same whatever it holds". The box's ADA comes back with it.
5. Ways out.
   - LovejoinReturn.tsx:251: Change is offered whenever a pool is chosen and not direct.
   - The options list each pool's boxText and 'Bring it back directly'.
   - The approval reads "N boxes of Q TOKEN + X ₳" (en.json:1284; ui/lovejoin-pools.ts:45-49).
   - A direct swap return holds only its 2 ₳ margin beside the token (chunk-34 :135, decision 33), so its partial send merges too.
6. ADA pools: a return's ADA goes only into the earliest v2 5 ₳ pool (lovejoin.ts `adaPool`, :4245; chunk-44 :51).
7. Today: src/lovejoin-pools.json has mainnet pools = [5 ₳ ADA (v1), 5 ₳ ADA (v2)] and no token pool.

No command beyond reads and git show was run.

**Known:** Not recorded as such, so not 'known'. The nearest records are all in docs/archive/plans/chunk-34-token-pools.md:
- :524: Lovejoin's own 2 ₳ pool's boxes "can't pay alone for part of its token". This was settled only because its scripts sit at a key address.
- :1242: the owner's "Treat it like any pool", with the review saying so, for pools whose boxes can't come back.
- Decision 22 (:113) and section 2 (:289-296): the standard and usable rules, which deliberately leave out S0d's bound for found pools.

Searched backlog.md (whole Lovejoin section and chunk 34's leftovers), post-release-roadmap.md, review-*.md and the chunk 43, 44 and 45 plans for 'S0d', 'least box', 'box value', 'pay alone', 'part of its token', 'made elsewhere' and 'Lovejoin's own': no entry about a standard pool below the least being shown without a word.

**Fix notes:**

Fix (a), not showing such a pool or making the bound part of 'standard', runs against call 34 ("Treat it like any pool") and no-paternalistic-guards. Don't build it.

Fix (b) is the owner's call. Add one short line beside the token in TokenWays, modelled on `lovejoin.ways.warn.stuck`: "A box back from this pool can't pay part of its token on its own: a payment of part of it is spent with other money." Set it from the planner's way (a `short`-style flag beside `stuck`). Measure it once an epoch per pool, cached beside `comeBack`, with core's `way_back` or `least_box_lovelace` for the pool's actual box and token shape. Reuse the same flag for the pool page's callout and the hub row.

Also widen privacy.md:439. It now says only "a payment above one box's worth from money that's all boxes can't". It should add that in a pool whose box is below the least a launch would need, a payment of part of one box is spent with other money too.

A Vitest status read of a 3 ₳ token pool, showing neither cantComeBack nor unusable, would pin the current behaviour if the owner wants the line. Back-translate any new strings.
