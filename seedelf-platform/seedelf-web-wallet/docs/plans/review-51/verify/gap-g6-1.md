# gap-g6#1: verification

From lane gap-G6, graded low by its finder.

## Trace: confirmed, low

The finding holds as described. I couldn't refute it, and a test shows the main case. None of the four kept records carries a version of the rule that made its verdicts. Each serves an older release's verdict over the current build's rule:
- the sealed contract view (`contract.mainnet`);
- Lovejoin's `origins`;
- discovery's Koios height;
- the copies already read.

**Nothing is stale today.** No ownership rule has changed since these records began:
- registerOf last changed in aad95b12 (2026-09-27).
- ownedUtxos last changed in e69697b4, which is in 1.4.0.
- The WebAssembly's isOwned dates from 825a090f, and register.rs is unchanged since b5ad15a7.
- madeBy and accountKeys are byte-identical at every tag from 1.6.0 to 1.9.1.
- The pools member's past case (1.7.x to 1.8.0, Koios-only mainnet) was closed by 1.8.1's head start.

So nobody can reach it today. It becomes real the day a release changes one of those rules without invalidating the record, and chunk 51's fix round is about to: x2#2's kind check, r3a#1's spelling class, e1a#1's new Origin flag.

**Why low.** If such a fix ships unhandled:
- In x2#2's direction, a stale "ours" row overstates the private balance and makes spends that pick it fail. Nothing wrong can be signed, because WebAssembly's check_spendable (lib.rs:2316-2343) re-checks ownership at every Seedelf spend and refuses.
- In r3a#1's direction, a payment the old rule refused stays hidden on that device.
- The ways out are Remove wallet and a restore (which forces a snapshot), Koios-only (the contract view only, and only while it's on), a refused cursor or a deep rollback, and coin control's lock for a stale row.

That is "a missing check with no reachable harm today": low, who: nobody. I agree with the finder's grade.

Two members are conditional as the finder already says. x2#2's row reaches the sealed rows only if the data layer's index lists a key-address row, and seedelf-data is outside this chunk. The pools member's past case needed a Koios-only 1.7.x device that looked past block 14167059 before it updated.

**Evidence:**

Traced in TREE. The extension source is unchanged from cd764fba, and from web-wallet/1.9.1 except manifest.ts. I opened every line the finding cites.

**The contract view, the main case:**
1. contract-scan.ts:193-203: `Settled { v: 1; owner; cursor; got; rows; checked }`. The only version is the format's.
2. :264 `let settled = kept?.v === 1 && kept.owner === owner ? kept : undefined;`. Only a missing or unreadable record, another owner, a CursorRefused (:267-272) or a reset (:273) takes a snapshot.
3. :281: a snapshot keeps only the rows judged ours.
4. :294-297: only rows not already in `checked` are judged.
5. :301 `atTip = [...settled.rows, ...created.filter(checked)]`: settled rows are never judged again.
6. :315-318: only rows with `checked` true at or below the cursor are folded into `rows`, and `checked` keeps only rows above it. A false verdict leaves no trace once the cursor passes.
7. :331: `owned` is atTip with no ownership check. balances.ts:263, 386 (seedelfSide) and :317-319 (withIncoming) count it as it is.
8. The guards I looked for and didn't find:
   - sw.ts:326-333: onInstalled only re-applies openIn and the connector, so an update keeps chrome.storage.local.
   - private-store.ts's `Sealed.v` is the seal format's, not the rule's.
   - No timer re-snapshots the index path: FULL_EVERY_MS is Koios's alone.
   - The Koios scan (:129-186) judges every row but never writes the sealed record, so turning Koios-only off brings the stale view back.
   - No test covers a `v` mismatch: private-index.test.ts:222 tests only the owner.
9. The spend-side check that caps the harm: wasm lib.rs:2316-2343 check_spendable re-runs `is_owned` and bails with "isn't this wallet's".

**The other members:**
- **Origins.** lovejoin.ts:7926-7932 read() keeps any origin with a boolean `mixed` and a number `seen`. Then:
  - found:6140 skips kept origins;
  - lookUp:6187 skips `said`;
  - knownOf:1976-1979 counts them as known;
  - sortOut:6068-6070 refreshes `seen` while the box is listed.
  So an origin is never asked of again while its box stays listed. e1a#1's fix plan (verify/e1a-1.md:339-346, 363) adds a new Origin flag for a stranger's deposit. If that flag marks strangers, origins sealed before it read as the wallet's own.
- **Pools.**
  - lovejoin-pools.ts:205-207: listFingerprint covers the token list only.
  - :388: the stored height holds under the same list.
  - :570: the height moves to the highest holder row.
  - :583-584: refused candidates are looked past.
  - :592: only unknown launches lower the height.
  1.7.2 has the same holder scan (its :360, 494, 507-508), and its launch check's `if (!check ...) continue` also looks past a pool it refuses. Bundled head starts (git show of src/lovejoin-pools.json at each tag):
  - 1.8.0's mainnet head start is at height 14139313, with only dc6abe3b0b (8131b1d).
  - 1.8.1's is at 14167059, and adds fcb3f5ec5f (v2, launched at block 14167059).
  - `listed` 7cff1d91507cb596 and list.json's sha256 prefix 1a96804077c47618 are the same at every tag from 1.6.0 to 1.9.1.
- **Copies.** lovejoin-pools.ts:327-331: copiesUnread skips `checked`. :338-351: copiesRead adds to it for good.

**Test run on TREE** (`timeout 10m npx vitest run tests/r51-gap-g6-1.test.ts`): 2 failed, with 6 soft assertions. The row the record kept is counted (32,828,227 lovelace instead of 28,000,000). The payment the record kept as not ours is missing (28,000,000 instead of 53,000,000), still missing once the cursor passes, and absent from the record's rows.

**Stand-in fix in a copy** (`$HOME/.cache/seedelf-review-51/verify-gap-g6_1-trace`, since removed): Settled.v changed from 1 to 2 at contract-scan.ts:194, 264, 277 and 311. My test and private-index.test.ts gave 18 passed. TREE's src is untouched (git status is clean). tsc shows no errors in the new file.

**Known:** Not known. What I searched:
- backlog.md;
- every file in docs/archive/plans, above all chunk-26b's review and its "Left for later", chunk-34's STATE/MERGED/R2 items, chunk-44, and review-1.6.0 through review-1.9.1;
- docs/plans/chunk-46 and chunk-49;
- SECURITY.md, seedelf-platform/CLAUDE.md, architecture.md and privacy.md.

The terms: Settled, sealed record, for good, snapshot, cursor, re-check, checked again, rule version, x-upgrade, STATE-4, origins, copies read, listFingerprint.

Related but different:
- **chunk-26b's review (2026-10-09):** "A WebAssembly trap in the ownership check read as 'not ours', which the sealed record then kept for good". That is the same property with one cause, fixed by the trap guard at balances.ts:496-499.
- **STATE-4 (chunk 34):** resets the discovery height on a change of the token list only.
- **backlog.md:47:** a sealed cursor whose `since` keeps answering 503.
- **chunk-44:25:** "Wallets already installed drop v2 pools". It notes 1.7.x's refusal, not the height 1.8.0 inherited.
- **1.7.0's x-upgrade#0:** a kept pool row trapping under a new arithmetic rule, the opposite direction.

No owner's rule or frozen item covers it.

**Fix notes:**

**The contract view.** In the same release that changes registerOf, ownedUtxos, the WebAssembly's isOwned or a kind check on contract rows, bump Settled.v (the record's version, contract-scan.ts:194, 264, 277, 311). Better, name it the rule's version, e.g. a `RULE` constant written as `v`, so the next rule change can't miss it. The gate at :264 already turns a mismatch into one snapshot, the same request every wallet makes, so the bump costs no privacy. The test is that fix's regression test: both its cases pass on a copy with v at 2. It models 1.9.1's record by hand, because no rule in TREE differs from 1.9.1's yet. If the fix round changes no ownership rule, no bump is needed.

**Origins.** Give e1a#1's new class a positive flag: an own deposit is marked, and an absent flag means "not known as own", which only leaves a box out of Mix my boxes again. Alternatively, drop or re-derive the origins written before the release. A negative "a stranger's" flag leaves every origin sealed under 1.9.1 reading as the wallet's own while its box stays listed. Keeping each origin's input credentials sealed, and deriving `public`/`account` when it's read, also mends gap-g6#2.

**Pools.** Fold the template sets the build recognises into listFingerprint (lovejoin-pools.ts:205-207, read at :384-388). Then an update that recognises a new set looks again from the head start. Until then, the release's head start (`npm run lovejoin-pools`) and the data layer's list are what cover a new set.

**Copies.** Clear the copies-read `checked` set (lovejoin-pools.ts:338-351) in the release that changes the box reader. r3a#1's spelling fix (web-wallet/lovejoin-box-datum-spelling) and x2#1's both change it.

**For the lead.** RESUME.md says G6's "keys and chain reads" are committed on web-wallet/whole-review-fixes, and G4's Lovejoin work is uncommitted there. Check that:
- x2#2's fix, if it touches ownedUtxos or registerOf, also bumps Settled.v;
- e1a#1's Origin flag fails safe for old origins;
- the box-datum branch clears copies-read.

I read TREE only, never those branches.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g6-1.test.ts`

Result: **On TREE, it fails.** Run from extension/ with `timeout 10m systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 nice -n 10 npx vitest run tests/r51-gap-g6-1.test.ts`, exit 1:

```
 ❯ tests/r51-gap-g6-1.test.ts (2 tests | 2 failed) 6153ms
     × never counts a row the record kept as ours that this build's rule refuses (x2#2's direction) 3914ms
     × counts a payment the record kept as not ours that this build's rule takes, before and after the cursor passes it (r3a#1's class) 2237ms
AssertionError: expected [ …(4) ] to not include '6908fe85bcacc06b766a207baf4f854701819…'   (tests/r51-gap-g6-1.test.ts:98)
AssertionError: expected 32828227n to be 28000000n // Object.is equality                   (:99)
AssertionError: expected [ …(3) ] to include 'b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b…'     (:115)
AssertionError: expected 28000000n to be 53000000n // Object.is equality                   (:116)
AssertionError: expected [ …(3) ] to include 'b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b…'     (:121, after index.advance(400))
AssertionError: expected [ …(3) ] to include 'b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b…'     (:122, the record's rows)
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

Every setup check passed:
- The first read gives the 28 ₳ private balance.
- This build's rule refuses the other wallet's row and accepts the 25 ₳ payment.

So the failures come only from the record's kept verdicts.

**Once fixed, it passes.** In a copy (`$HOME/.cache/seedelf-review-51/verify-gap-g6_1-trace`, removed afterwards), I made one stand-in change: Settled.v from 1 to 2 in contract-scan.ts at :194, :264, :277 and :311. `npx vitest run tests/r51-gap-g6-1.test.ts tests/private-index.test.ts` then gave 2 files passed, 18 tests passed, exit 0. A 1.9.1 record now takes one snapshot, and this build's rule judges every row.

```
// Chunk 51, gap-g6#1 (the trace verifier's test). On mainnet the private index's sealed record (`contract.mainnet`,
// contract-scan.ts `Settled`) keeps the wallet's verdict on each contract row: `rows`, those judged ours as of the
// stable cursor, never checked again, and `checked`, those above it, each judged once by ref. A row judged not ours
// is never kept: once the cursor passes it, nothing says it was there (contract-scan.ts:281, 294-297, 301, 315-318).
// The record's only version is its format's, `v: 1`, the gate at contract-scan.ts:264, and nothing ties a verdict to
// the rule that made it (chain.ts registerOf, balances.ts ownedUtxos, the WebAssembly's isOwned). An update leaves
// chrome.storage.local as it was (sw.ts's onInstalled only re-applies two preferences), so the next release reads
// 1.9.1's record and serves its verdicts as its own.
//
// Chunk 51's fix round changes that rule in both directions: x2#2's fix refuses a row at a KEY address with the
// contract's hash, which 1.9.1 seals into `rows` as ours; and r3a#1's class, if chain.ts's registerOf learns the
// indefinite pair 102([_ 0, [g, u]]), takes a payment 1.9.1 sealed as not ours. Neither rule is in this tree, so this
// build's own rule plays the new one, and the record is written as 1.9.1 (`v: 1`) seals it under a rule that
// disagreed with it:
// - another wallet's row, which this build refuses, kept in `rows` as ours: x2#2's direction;
// - a payment to this wallet above the cursor, which this build takes, kept as `checked: false`: r3a#1's.
//
// What's right (the finding's fix): a record sealed under another rule is never served, e.g. `Settled.v` bumped in
// the release that changes the rule, so 264 reads one snapshot and this build's rule judges every row. Today the
// first row is counted in the private balance, the second never is, and once the cursor passes the second the
// record keeps no trace of it: only a snapshot (Remove wallet and a restore, a rollback, a refused cursor) finds it.
import type * as Wasm from "@seedelf/wasm";
import { describe, expect, it } from "vitest";

import { CONTRACT_V1, ownedUtxos as ownedByRule } from "../src/background/balances";
import { seedelfTokenOf, sumValue } from "../src/background/chain";
import { readContractView, type ContractView } from "../src/background/contract-scan";
import { DataParts } from "../src/background/data-layer";
import { privateIndexClient, utxoOf, type IndexRow } from "../src/background/private-index";
import { outpoint } from "../src/background/spent";
import { fakeIndex, indexRowOf } from "./fake-index";
import { koiosPreprod, loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const OURS = ownedUtxos.map(outpoint).sort();

/** The record as contract-scan.ts seals it (its `Settled`, not exported). */
interface SealedView {
  v: number;
  owner: string;
  cursor: string;
  got: number;
  rows: IndexRow[];
  checked: Record<string, boolean>;
}

/** What the private balance counts of a view (balances.ts spendableOwned, then sumValue): lovelace. */
const privateLovelace = (view: ContractView) =>
  sumValue(view.owned.filter((u) => !seedelfTokenOf(u, CONTRACT_V1.seedelfPolicyId) && !u.reference_script)).lovelace;

/** The 12-word wallet unlocked on mainnet's private index, as private-index.test.ts's onIndex sets it up. */
async function onIndex() {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances();
  await t.wallet.create(v.phrase, PASSWORD);
  const index = fakeIndex();
  const base = index.tip - 100_000;
  index.contract = [...koiosPreprod.contract_utxos, ...ownedUtxos].map((u) => ({ row: indexRowOf(u, base) }));
  const parts = new DataParts(t.session, () => t.clock.now);
  const deps = {
    ...t.deps,
    wasm: loadTestWasm() as typeof Wasm,
    index: privateIndexClient(
      { koiosOnly: async () => false, parts, fetch: index.fetch, limits: {} },
      (n) => (n === "mainnet" ? "https://data.test" : undefined),
    ),
  };
  const record = () => t.deps.store.get<SealedView>("contract.mainnet");
  /** Seals the record as 1.9.1 would have, under a rule that judged these rows otherwise than this build does. */
  const sealAs191 = async (change: Partial<SealedView>) => {
    const kept = (await record())!;
    await t.deps.store.set("contract.mainnet", { ...kept, ...change, v: 1 });
  };
  /** This build's verdict on one index row, outside the record. */
  const ruleSays = (row: IndexRow) =>
    t.wallet.withKeys((keys) => ownedByRule(deps.wasm, keys, [utxoOf(row, CONTRACT_V1.walletContractHash)]).length === 1);
  return { t, index, deps, record, sealAs191, ruleSays };
}

describe("r51 gap-g6#1: the sealed contract view's verdicts after the rule that made them changed", { timeout: 120_000 }, () => {
  it("never counts a row the record kept as ours that this build's rule refuses (x2#2's direction)", async () => {
    const { index, deps, record, sealAs191, ruleSays } = await onIndex();
    // A restore: the snapshot, every row judged by this build, sealed. 28 ₳ private (25 + 3; the Seedelf's 1.5 ₳ is
    // listed, not counted).
    const first = await readContractView(deps, "mainnet");
    expect(first.owned.map(outpoint).sort()).toEqual(OURS);
    expect(privateLovelace(first)).toBe(28_000_000n);

    // Another wallet's 4.83 ₳ row with no Seedelf, still unspent at the contract: this build's rule refuses it.
    const theirs = index.contract.map((r) => r.row).find((r) => !OURS.includes(r.ref) && r.datum && !r.assets)!;
    expect(theirs.lovelace).toBe("4828227");
    expect(await ruleSays(theirs)).toBe(false);
    // The record 1.9.1 left, under a rule that took that row.
    await sealAs191({ rows: [...(await record())!.rows, theirs] });

    // The update: this build reads that record.
    const after = await readContractView(deps, "mainnet");
    expect.soft(after.owned.map(outpoint)).not.toContain(theirs.ref);
    expect.soft(privateLovelace(after)).toBe(28_000_000n);
  });

  it("counts a payment the record kept as not ours that this build's rule takes, before and after the cursor passes it (r3a#1's class)", async () => {
    const { index, deps, record, sealAs191, ruleSays } = await onIndex();
    await readContractView(deps, "mainnet");
    // 25 ₳ paid to this wallet's register in the last few blocks: above any stable cursor. This build's rule takes it.
    const paid = { ...indexRowOf(ownedUtxos[0]!, index.tip - 50), ref: `${"b3".repeat(32)}#0` };
    index.contract.push({ row: paid });
    expect(await ruleSays(paid)).toBe(true);
    // 1.9.1 saw it once and judged it not ours, as it judges a payment spelled 102([_ 0, [g, u]]).
    await readContractView(deps, "mainnet");
    await sealAs191({ checked: { [paid.ref]: false } });

    // The update, before the cursor passes it.
    const after = await readContractView(deps, "mainnet");
    expect.soft(after.owned.map(outpoint)).toContain(paid.ref);
    expect.soft(privateLovelace(after)).toBe(53_000_000n);

    // The cursor passes it: it should be settled as ours, as any payment of ours is (private-index.test.ts:87).
    index.advance(400);
    const later = await readContractView(deps, "mainnet");
    expect.soft(later.owned.map(outpoint)).toContain(paid.ref);
    expect.soft((await record())!.rows.map((r) => r.ref)).toContain(paid.ref);
  });
});
```
