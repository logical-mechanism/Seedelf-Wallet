# gap-g8#6: verification

From lane gap-G8, graded low by its finder.

## Trace: partly, low

The scenario holds as given. An ADA pool start of 2 ₳ or 3 ₳ a box is refused by the form and by the worker ("Each box needs at least 3.45 ₳…"; S0d's least is 3.45 ₳ on preprod and on mainnet). one_shot_mint at 29573c5 takes it. Core builds it, and the wallet's own uplc runs one_shot_mint over the finished start and passes it. A pool of those values launched by another tool is shown, and the hub can mix into it.

Three things are narrower or wrong:
1. **The band is narrower.** Only the worker's check refuses from core's own floor upward, not from "the box's own minimum". An ADA box's minimum is 1.3361 ₳. From there to about 1.63 ₳, core's launch refuses by itself, because the box can't pay its own way back (CantComeBack). So only about 1.63 ₳ to 3.44 ₳ is refused by the worker alone. The finder's "the ledger's limit is the box's min-UTxO, about 1.63 ₳" mislabels core's floor. Its fix (b), "refuse only below the box's own minimum", would also need core's own launch check changed, which it doesn't name.
2. **"Picked by default" is true of token pools only.** For ADA, a return goes only to the 5 ₳ pool (adaPoolOf). A 2 to 3 ₳ ADA pool is reached only through the hub's Mix and Bootstrap.
3. **It's deliberate.** This is the owner's decision 14 (2026-10-17), built on the owner's own ask for S0d. It is struck through as settled in chunk 34's Still open 8 ("never below S0d's bound"), documented in flows.md:530, and pinned by lovejoin-flows.test.ts:847.

It isn't "known" by the brief's lists: there's no backlog line or Not-fixed entry, and the brief counts a refusal the contracts would accept as a finding. What's left is a conflict between decision 14 and the owner's later rule of 2026-10-19 (refuse only what the ledger or the contracts refuse). The owner applied that rule to decision 14's supply check (call 35) and left this bound in place. No record shows the bound was weighed then. So the fix is the owner's call, together with gap-g5#1.

The same gap exists for token pools. With the worker's check removed in a copy, core built a 2 ₳ start of 1000 MIN a box.

**Severity: low, at the bottom of the band.**
- **Who:** a user starting a pool.
- **Cost:** no money is lost. The form states the least and suggests 4 ₳ (4.5 ₳ for tokens), and a box's ADA comes back with it, so a higher value ties up capital, not fees.
- **Way out:** pick at least the least, or launch with another tool, whose pool the wallet then shows.

**Evidence:**

Trace on TREE (code identical to web-wallet/1.9.1 apart from manifest.ts and READMEs; `git diff --stat web-wallet/1.9.1 HEAD` over core, wasm and extension/src):

1. **Form.** `ui/screens/LovejoinLaunch.tsx:161-162` sets `why` to `tr("lj.launch.tooLittle", …)` when `BigInt(box) < BigInt(terms.least)`, and `:394` has `disabled={busy || !terms || !!why}`. `en.json:3181`: "Each box needs at least {{least}} ₳ under today's network fees: enough to pay its own way back, and then to pay out part of what came back without other money."

2. **Worker.** `background/lovejoin-launch.ts:257-258`: `const value = await this.boxValue(…)`, then `if (box < BigInt(value.least)) throw new Error(t("lj.launch.tooLittle", …))`.
   - `boxValue` (:187-196) calls `wasm.lovejoinBoxValue`: `wasm/src/lib.rs:6382-6385`, then `wasm/src/lovejoin.rs:2986-2999`, then core's `box_value.rs:363-396` `least_box_lovelace`.
   - That runs `way_back` (:265-358): the withdraw, then part to a Seedelf, part to an address, all to a Seedelf, all to an address, from what came back alone.
   - Blame: 84c2775f (2026-10-17), first in web-wallet/1.6.0.

3. **Without :258.**
   - `:260` sets maxFee = min(box−1, 1.5 ₳), so 1.5 ₳ at 2 or 3 ₳. Then `fromPublic` → `lib.rs:2581` `build_launch_from_account` → core `launch_from_account`.
   - Core's `made` (`launch.rs:180-184`) runs `shaped`:
     - `check_terms` (:163-174) refuses only a Seedelf token and an ADA pool of 10 ₳.
     - The datum round-trips through `ReferenceDatum::decode` (`pool.rs:174-183`: box > 0 and 0 < max_fee < box, as one_shot_mint).
   - Then `check_usable` (:189-193) calls `usable(params, pool, true)`, whose measure (`pool.rs:577-650`) fails only on BelowMinimum (:601-606) or CantComeBack.
   - `measure_locally` (`launch.rs:586-614`) runs `eval::evaluate` (uplc `eval_phase_two_raw`, `eval.rs:333`), and `Budgets::from_ogmios` (`build.rs:1239-1241`) bails on any script error. So one_shot_mint runs on every build.

4. **Contract.** `git -C ../lovejoin show 29573c5:contracts/validators/one_shot_mint.ak` :114-119: `datum_sane = and { parsed.box_lovelace > 0, parsed.max_fee_per_mix_lovelace > 0, parsed.max_fee_per_mix_lovelace < parsed.box_lovelace, token_sane(parsed) }`. Nothing more on the box.

5. **Found side.**
   - `lovejoin-pools.ts:530` and `:542-546`: `listedValue` keeps any ADA pool but 10 ₳.
   - Token pools are picked by default (gap-g5#1, verify/gap-g5-1.md).
   - ADA defaults only to `adaPoolOf` (`lovejoin.ts:700-701`, `p.lovelace === COLLATERAL_LOVELACE`, the 5 ₳ pool).

6. **Exploratory run** (same harness, `t.launch` as the worker runs, against a stand-in whose lovejoinBoxValue answers least "1"; preprod fakes):
   - preprod terms: least 3450000, suggested 4000000. Mainnet's least (core's `tests/fixtures/epoch_params_mainnet.json`): 3450000.
   - Stand-in at 1.2 and 1.3 ₳: "A box holds 1200000 lovelace, under the 1336100 the ledger asks of it now".
   - Stand-in at 1.4 to 1.6 ₳: "A box can't pay its own way back: 1304978 lovelace is left after the fee, and its Seedelf output needs 1336100" (at 1.6 ₳). The withdraw fee is 295,022, so core's floor is about 1.631 ₳.
   - Stand-in at 1.65, 1.7, 2, 3, 3.44 and 3.45 ₳: built, locked 23084520, fee 426872.
   - Real worker: refused at every value up to 3.44 ₳, built at 3.45 ₳.

7. **Final test on TREE:** fails as intended (output in test_result).

8. **Mutant**, in a copy at `$HOME/.cache/seedelf-review-51/verify-gap-g8_6-trace`, since removed:
   - With :258's throw removed, `r51-gap-g8-6.test.ts` passes (1 passed).
   - `tests/lovejoin-flows.test.ts -t "refuses what isn't a pool to start"` then fails at :847. Its 2 ₳ start of 1000 MIN a box was built: pool `bdb48a0f292a0c397d79c27689ad313137df407cd812fd7aa927d4e4`, locked total 23231060.
   - So the suite pins this refusal, and the gap covers token pools too.

9. **Records.**
   - `docs/archive/plans/chunk-34-token-pools.md`:
     - :80-86, decision 14: "The lower bound is S0d's".
     - :148-150, the owner's call 2 asking for S0d.
     - :373, §5: "It never goes below S0d's bound".
     - :1554, Still open 8, struck through: "never below S0d's bound (session 1, 14)".
     - :1238-1248, session 5's calls 34-36: joining, supply check, escape hatch. Not the launch's least.
   - `flows.md:530` and `wasm/README.md:84` describe the least as the form's bound.

**Known:** Not known by the brief's lists. backlog.md has no line for S0d, least, tooLittle, box value, the launch or a lower bound. No archived review lists it under Not fixed, Left open, Disputed or For the owner; I searched every archive/plans file for tooLittle, S0d, least_box, lovejoinBoxValue and boxValue, and review-1.6.0.md for least and box value. It isn't among COMMON's owner's rules, and isn't in SECURITY.md. The brief itself counts "a refusal of something the ledger and the contracts would accept" as a finding.

It is the owner's recorded design, though:
- docs/archive/plans/chunk-34-token-pools.md:
  - :80-86, decision 14 (2026-10-17): "The lower bound is S0d's".
  - :148-150, call 2 (2026-10-13): S0d asked as "what exactly it has to be for this flow".
  - :373, §5: "It never goes below S0d's bound".
  - :1554, Still open 8, struck through as settled.
- docs/flows.md:530 and wasm/README.md:84.
- Pinned by tests/lovejoin-flows.test.ts:847.

The rule of 2026-10-19 (memory no-paternalistic-guards; chunk-34 :1238-1248, calls 34-36) reversed the supply check in decision 14 and left this bound; no record shows the bound was weighed then.

Sister finding: gap-g5#1 (review-51 INDEX.md:379, verify/gap-g5-1.md), the found-pool side of the same bound.

**Fix notes:**

Decide it with gap-g5#1. It's the owner's call, because the bound is the owner's decision 14 and the 2026-10-19 rule came after it.

**If (b), such pools flagged and the bound a warning:**
- Drop the throw at lovejoin-launch.ts:258 and the form's tooLittle branch in `why` (LovejoinLaunch.tsx:161-162). Carry a flag on LovejoinLaunchSummary instead, said on the review as a `.warn.` key, back-translated as critical (`lj.launch.tooLittle`'s words are close).
- Keep the 9 ₳ token cap (:259, decision 27), the owner's own.
- Update lovejoin-flows.test.ts:847. Its comment "Too little to come back" is wrong today: a 2 ₳ box of 1000 MIN does come back (core built it in the mutant). It fails S0d's step of paying part of itself.
- Reword the docs that say "no launch goes below it": wasm/src/lovejoin.rs:2958-2960, wasm/README.md:84, flows.md:530.
- Core's own launch check (launch.rs:181-193, `check_usable` → `usable(params, pool, true)`) still refuses a box that can't pay its own way back, below about 1.63 ₳ for ADA here. The finder's "refuse only below the box's own minimum (1.34 ₳)" also needs that relaxed to a warning, in call 34's spirit. That's a separate refusal in core, and a separate owner call.
- Token pools have the same gap, from each shape's core floor up to its S0d least: the mutant built a 2 ₳ start of 1000 MIN a box.

**If (a), such pools hidden:** the refusal stands, this test is dropped rather than fixed, and the launch's refusal and discovery's filter should share one measure: S0d's least for the pool's own shape and epoch.

The finder's figure "the ledger's limit is the box's min-UTxO, about 1.63 ₳" should read: box minimum 1.3361 ₳; core's floor, the minimum plus its own way back, about 1.631 ₳. And "picked by default" holds for token pools only: ADA returns go only to the 5 ₳ pool (adaPoolOf, lovejoin.ts:700-701).

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g8-6.test.ts`

Result: It fails on TREE, as intended. Run from extension/ with `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g8-6.test.ts`:

```
❯ tests/r51-gap-g8-6.test.ts (1 test | 1 failed) 41833ms
  × starts an ADA pool of 2 ₳ or 3 ₳ a box, which one_shot_mint takes and core builds 41824ms
AssertionError: S0d's least: 3450000 on preprod, 3450000 on mainnet: expected { …(2) } to deeply equal { …(2) }
-   "2000000": "built, 2000000 a box",
-   "3000000": "built, 3000000 a box",
+   "2000000": "refused: Each box needs at least 3.45 ₳ under today's network fees: enough to pay its own way back, and then to pay out part of what came back without other money.",
+   "3000000": "refused: Each box needs at least 3.45 ₳ under today's network fees: enough to pay its own way back, and then to pay out part of what came back without other money.",
 ❯ tests/r51-gap-g8-6.test.ts:100:89
Test Files  1 failed (1)   Tests  1 failed (1)   Duration 50.86s
```

Every precondition passed:
- Both boxes are under S0d's least on both networks.
- The stand-in built both starts: core's checks passed, and the wallet's uplc passed one_shot_mint.

In a throwaway copy with lovejoin-launch.ts:258's throw removed, the same test passed: 1 passed, 36.55 s. That copy was removed afterwards. TREE's tracked files are untouched, and this test file is the only file I added.

```
// Chunk 51, gap-g8#6: a pool's start refuses a box value that one_shot_mint takes and the wallet's own builder makes.
//
// The worker's start (lovejoin-launch.ts:257-258) refuses any box under S0d's least (WebAssembly's lovejoinBoxValue,
// core's least_box_lovelace: a box comes back, then pays part of what came back on its own), 3.45 ₳ for an ADA pool on
// both networks, and the form keeps Review off below it (LovejoinLaunch.tsx:161-162, :394). one_shot_mint (Lovejoin
// 29573c5) checks only box_lovelace > 0 and 0 < max_fee < box_lovelace, as core's datum decode does (pool.rs:174-183).
// Core's own launch (launch.rs: check_terms, then check_usable) refuses only a box under its minimum or one that can't
// pay its own way back: about 1.63 ₳ for an ADA box under these parameters (its minimum 1.3361 ₳ plus a 0.295 ₳
// withdraw). So from about 1.63 ₳ to 3.44 ₳ only the worker refuses a start that the chain takes, and that start's
// pool, launched by another tool, is one the wallet shows and lets the hub mix into (lovejoin-pools.ts listedValue
// keeps any ADA pool but 10 ₳; gap-g5#1).
//
// The right behaviour under the owner's rule of 2026-10-19 (refuse only what the ledger or the contracts refuse; a
// risky but valid choice gets a warning at most): the start is built, and its review says what S0d says. This test
// passes then, and fails while the worker refuses. The bound is the owner's own decision 14 (chunk 34, 2026-10-17),
// made before that rule: if the owner keeps the refusal (gap-g5#1's fix (a)), this test is dropped, not fixed.
//
// With the real WebAssembly, from the public account (40 ₳ and 5 ₳ of ADA), as lovejoin-flows' launch tests do. First
// with only the worker's S0d check stood in for, which shows that core builds the start and that the wallet's own
// uplc runs one_shot_mint over it and passes it (launch_from_account's measure_locally fails on any script error).
// Then as the worker runs.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinLaunchService } from "../src/background/lovejoin-launch";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = (vectors("cardano_account.json") as Array<{ account: number; phrase: string }>).find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
)!.phrase;

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

/** Mainnet's parameters as core's tests bundle them, for S0d's least there. */
const MAINNET_PARAMS = (
  JSON.parse(readFileSync(new URL("../../../seedelf-core/tests/fixtures/epoch_params_mainnet.json", import.meta.url), "utf8")) as unknown[]
)[0];

type T = ReturnType<typeof testBalances>;

async function wallet(): Promise<T> {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.evaluation = AGREES;
  // A slot in preprod's Shelley era, as lovejoin-flows' launch tests set it.
  t.koios.tip = 110_000_000;
  return t;
}

/** One of the recorded account's UTxOs, made again as `tx`'s, holding `value` of ADA alone. */
function atAccount(tx: string, value: string): KoiosUtxo {
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  return { ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, asset_list: [] };
}

describe("gap-g8#6: a pool's start between core's floor and S0d's least", { timeout: 300_000 }, () => {
  it("starts an ADA pool of 2 ₳ or 3 ₳ a box, which one_shot_mint takes and core builds", async () => {
    const t = await wallet();
    t.koios.addedToAccounts.push(atAccount("e1", "40000000"), atAccount("e5", "5000000"));
    const wasm = loadTestWasm();

    // S0d's least for an ADA pool: the form's terms on preprod, and under mainnet's parameters.
    const terms = await t.launch.terms("preprod");
    const mainnet = JSON.parse(wasm.lovejoinBoxValue(JSON.stringify({ network: "mainnet", params: MAINNET_PARAMS }))) as { least: string };

    // Only the worker's S0d check stood in for: core's checks all run (check_terms, the datum as one_shot_mint decodes
    // it, usable: the box's minimum and its own way back), one_shot_mint is run over the finished start, and the pool
    // is checked from the finished bytes.
    const standIn = new LovejoinLaunchService({
      ...t.deps,
      wasm: {
        ...wasm,
        lovejoinBoxValue: (request: string) => JSON.stringify({ ...JSON.parse(wasm.lovejoinBoxValue(request)), least: "1" }),
      } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      lovejoin: t.lovejoin,
      discovery: { known: async () => [], look: async () => undefined },
    });

    const boxes = ["2000000", "3000000"];
    const seen: Record<string, string> = {};
    for (const box of boxes) {
      // Under S0d's least on both networks.
      expect(BigInt(box)).toBeLessThan(BigInt(terms.least));
      expect(BigInt(box)).toBeLessThan(BigInt(mainnet.least));
      // The chain and the wallet's own builder take it.
      const made = await standIn.build("preprod", { from: "public", boxLovelace: box });
      expect(made.pool.boxLovelace).toBe(box);
      // The worker, as it runs.
      seen[box] = await t.launch.build("preprod", { from: "public", boxLovelace: box }).then(
        (r) => `built, ${r.pool.boxLovelace} a box`,
        (e: Error) => `refused: ${e.message}`,
      );
    }
    expect(seen, `S0d's least: ${terms.least} on preprod, ${mainnet.least} on mainnet`).toEqual({
      "2000000": "built, 2000000 a box",
      "3000000": "built, 3000000 a box",
    });
  });
});
```
