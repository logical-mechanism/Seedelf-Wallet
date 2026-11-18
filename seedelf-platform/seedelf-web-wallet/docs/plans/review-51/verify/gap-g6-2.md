# gap-g6#2: verification

From lane gap-G6, graded low by its finder.

## Trace: confirmed, low

The finding holds as described, and a run shows it. When a pool read asks what made a box, accountKeys checks only the active account, the known accounts and accounts 0-23. lookUp then seals the answer by transaction, and nothing asks again: not found, not made, not lookUp, and no account handler. So suppose a restored wallet reads the pool (when Lovejoin's page opens) before the user adds custom account 30 back. Account 30's deposit is sealed as `{mixed:false}` with no `public`.

After `add(30)`:
- the sealed origin is unchanged;
- the page names no account;
- Mix my boxes again from the private balance counts both boxes (`{boxes: 2, owned: 2}`) and fanOut puts them first;
- a box brought back records no tie (depositAccountOf gives undefined).

The control shows the timing is the only cause: account 30 added before the first read is refused, as account 1 is. I found no guard the finder missed. Production wiring matches the fixture: sw.ts:209 and fakes.ts:722 wire knownAccounts the same way. It is not settled anywhere.

I grade it low, agreeing with the finder. The cost is medium in kind: a privacy link made by default, the same mechanism as e1a#1. But reaching it is an edge case of the user's own setup, with three conditions:
- a custom-numbered account of index 24 or more, reached only by add or check;
- that account's boxes still sitting in a pool at their deposit (a public Bootstrap's held boxes, or a chain cut after its deposit);
- a restore or a second browser where Lovejoin is opened before the account is added back.

No money is at risk. Once sealed, no screen offers a way out. Adding the account before opening Lovejoin avoids it, but nothing says so.

**Evidence:**

TREE is e4c013e8. Its code is identical to cd764fba's (`git diff cd764fba HEAD --stat` on extension, core and crypto is empty), and to web-wallet/1.9.1's except manifest.ts.

Trace, from where the input enters to the outcome:

1. A restore forgets account 30.
   - private-store.ts:27-46: PRIVATE_RECORDS includes "accounts" and "lovejoin.<net>".
   - :60-65: KEPT_ON_RESET keeps only maybeSent.* and lovejoinMaybe.*.
   - wallet.ts:473-480: reset() removes the rest.
   - handlers.ts:153 runs recordFirst(), so the wallet knows [0]. :166 runs only accounts.discover in the background.
   - accounts.ts:260-274: discover goes up from the first gap and stops at the first unused account. Custom accounts are reached only by check (:310) or add (:335), and neither calls Lovejoin (handlers.ts:392-397).
   - privacy.md:456 and :461: a restored wallet first reads the pool when Lovejoin's page opens, not at unlock.

2. The lookup can't see account 30.
   - lovejoin.ts:6323-6324: `const known = (await this.deps.knownAccounts?.()...) ?? []; const indexes = [...new Set([active, ...known, ...Array.from({ length: MAX_PROBE }, (_, i) => i)])];`, with MAX_PROBE = 24 (accounts.ts:46). So the set is 0-23.
   - madeBy 6237-6250: fartherKeys looks only under the listed accounts' own stake keys. Account 30's stake key differs from all of them.
   - 6251 `whose` finds no account. 6255-6260 gives told `{ mixed: false }` with no `public`.
   - inputsOf 6273-6304 gives the same (cred, stake) pairs from the private index or from Koios.

3. It is sealed and never asked again.
   - lookUp 6187: `.filter((tx) => !said[tx])`. 6199: `x.origins = { ...x.origins, ...fresh }`.
   - found 6140: `!kept[b.txHash]`.
   - made 6169 uses knownOf, which includes origins (1976-1979).
   - sortOut 6068-6070 refreshes `seen` while the box is listed, so the origin lasts as long as the box does.

4. The outcome.
   - originOf 2125-2126 reads `told?.public`, and fromPublic (2237) drops the box.
   - privately (3537-3540) keeps it, so againBoxes (3496-3506) neither refuses with lj.privacy.fromAccount nor names untold.
   - fanOut 3786-3789: `left` holds only fromPublic and untold. 3819-3820: depositsOf (2000-2007, mixed false) puts the box first.
   - status 6389-6393: no fromPublic and no otherAccounts.
   - depositAccountOf 2276-2277 gives undefined, so withdrawOne's `ties` at 7661-7663 hold only the payer, and tiedOrigin at 7738 records nothing.
   - The Bring one back anyway question (Lovejoin.tsx:1064-1090) then says en.json:984, "a deposit put it in … tie that deposit to your private balance", not :987, which names the account. Its next line, en.json:991, says "Mix my boxes again hides it first."
   - Traced, not run: on account 30, publicAgainBuild (5042-5048) finds fromAccount empty and refuses (lj.noneFromAccount). So no path mixes the boxes without the tie.
   - privacy.md:454 says Mix my boxes again "takes only the others".

5. Since 4279db80 (2026-10-06, "the 1.2.0 release review's fixes"), which wrote lines 6316-6336. 4498f935/56883cc (M14) made the lookup itself.

Run of the test file, final version, run alone: 1 failed, 1 passed (2).
- The control passes: account 30 added before the read is named twice in otherAccounts, and againBoxes rejects with "…would tie the two".
- The bug case fails on all three soft expectations:
  - `expected [] to deeply equal [ …(2) ]` (fromPublic, :71);
  - `expected undefined to deeply equal [ 30, 30 ]` (otherAccounts, :72);
  - `promise resolved "{ boxes: 2, owned: 2 }" instead of rejecting` (againBoxes, :73).

One run with a temporary print in my own file, since removed, showed the sealed origin after add(30): `{"dddd…dd":{"mixed":false,"seen":1800000000000}}`, with both boxes in `deposits`.

Corrections:
- The tie on chain is an inference, as in e1a#1: anyone's mix can draw a box. The wallet's own rule (privacy review §2.10) treats it as a tie, as it does for account 1.
- The same class needs no restore: a second browser with the same phrase whose Lovejoin page opened before it added account 30 (chunk 51's gap-G9 note).
- The boxes that stay for long are a Bootstrap's held boxes and deposit boxes. A mix's leaves miss `public` too, but come back by themselves within hours.

**Known:** None: not settled or known.

Searched backlog.md for 'MAX_PROBE', 'accountKeys', 'first 24', 'custom account', 'custom-numbered', '1337', 'added later', 'origin', 'restore', 'M14', 'what made', 'madeBy', 'lookUp' and 're-derive'. The only hits are:
- :14, the restore scan;
- :47, the 503 cursor;
- :101 R11 (chunk 34), a restored device's Bootstrap hold: a different cause;
- :153, Transaction details' words;
- :213, M14's decoy requests (declined).

Searched archive/plans for the same words plus 'fartherKeys', 'otherAccounts', 'knownAccounts', 'C01', 'Origin', 'PRIV-3', 'R3-2', 'R3-3' and '316#1':
- chunk-18:361-373 is about reaching custom accounts, not origins.
- independent-review M14 (:41-47, :133) is the lookup design.
- chunk-34 R11 (:1320, :1369) is the hold.
- review-1.6.0's PRIV-3 and 316#1 are other causes.

None covers an account added after its deposit's answer was kept.

The owner's rules don't settle it. The fix restores the documented private default ("takes only the others"), with Pay from my private balance anyway still the control. It adds no refusal of anything the ledger takes. SECURITY.md isn't involved: the data sources answer truthfully.

privacy.md says part of it:
- :452 scopes the check to "every account the wallet knows, the active one and the first 24";
- :463 says "each transaction is asked about once and the answer kept".

Neither says a later-added account stays out, and :452 read literally is false once 30 is known.

Inside chunk 51 (not a settled list): gap-G9's lane note (lanes/gap-G9.md:91) names the same symptom for a second profile. D1's checked_ok (lanes/D1.md:213) checks the scope at lookup time only.

**Fix notes:**

Fix the class: verdicts kept on the device must be re-derived when the rule's input changes, as gap-g6#1 says.

**Preferred fix.** Keep each origin's input keys (the payment and stake key hashes from inputsOf, whether they came from the private index's provenance or from Koios's tx_info) sealed in the Origin. Derive `public`/`account` at read time against accountKeys over the accounts known then. That means originOf (2122), depositAccountOf (2267), fromPublic and fromAccount (2237, 2243) read through one helper. This asks nobody, so it adds no M14 cost. accountKeys derives up to 24 + known accounts × 40 keys, so it should be computed once per read, not per box.

**Smaller alternative.** When AccountsService adds an account (add, check, discover's merge), drop the origins that name no account, so the next pool read asks again. That costs a Koios tx_info request, which tells Koios again which boxes are this wallet's (M14's accepted cost). Prefer the first.

**Migration.** Origins sealed before the fix have no kept keys. Treat one with no `public` and no keys as to-be-asked-once, the made/found path.

**Others in the family.** tx-view.ts:270, destination.ts:128 and dapp.ts:2406 compute knownAccounts per call and keep nothing, so they pick up a new account. Lovejoin's origins are the only kept member here; gap-g6#1 lists the others.

**Test.** tests/r51-gap-g6-2.test.ts can become the regression test as it stands. Its second case passes once the origin is re-derived.

**Owner.** needs_owner is false. The fix restores documented behaviour, and adding no refusal or new default.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g6-2.test.ts`

Result: Run from extension/:

`nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g6-2.test.ts` (Vitest 5.0.3, real WebAssembly over the fakes).

```
❯ tests/r51-gap-g6-2.test.ts (2 tests | 1 failed) 14981ms
  × account 30 added after the first pool read is that account's too, and the private balance leaves its boxes out
FAIL … AssertionError: expected [] to deeply equal [ …(2) ]
  - "dddd…dd#0", - "dddd…dd#1"  + []        ❯ tests/r51-gap-g6-2.test.ts:71:51
FAIL … AssertionError: expected undefined to deeply equal [ 30, 30 ]   ❯ :72:61
FAIL … AssertionError: promise resolved "{ boxes: 2, owned: 2 }" instead of rejecting   ❯ :73:68
Test Files  1 failed (1)
     Tests  1 failed | 1 passed (2)
```

The control (account 30 added before the first pool read) passes. A second run of the same file gave the same result (1 failed | 1 passed).

One diagnostic run with a temporary console.info in my own file, removed afterwards (the file's sha256 is a851f8a6…), printed:

`DIAG sealed origin after add(30): {"dddd…dd":{"mixed":false,"seen":1800000000000}} deposits: ["dddd…dd#0","dddd…dd#1"]`

The test fails on TREE because the kept origin names no account after account 30 is known. Under either fix the finder proposes, the second case would reach the control's state and pass. Its assertions are behavioural: they don't depend on the sealed record's shape.

```
// Chunk 51, gap-g6#2 (the trace verifier's test). After a restore, what made a box is kept with the accounts known
// when the first pool read asked (lovejoin.ts accountKeys: the active one, the known ones and 0-23) and is never asked
// again (lookUp's `!said[tx]`, found's `!kept[b.txHash]`, made's knownOf). A deposit from public account 30, which
// only `add` or `check` reaches, read before the user adds 30 is kept as no account's. So once 30 is known, the 5 ₳
// pool's page still says nothing of account 30, and Mix my boxes again from the private balance takes those boxes,
// which privacy.md's "Mixing the boxes again" says it never does ("takes only the others").
// The control: account 30 added before that read is that account's, and the private balance refuses its boxes, as
// account 1's are (lovejoin-accounts.test.ts:190).
import { describe, expect, it } from "vitest";

import { publicFunded, type Tested } from "./chain-fixtures";
import { ADA, adaBox, ownDatum } from "./v2-pools";

/** Past MAX_PROBE's 0-23: never derived by accountKeys unless the wallet knows it. */
const CUSTOM = 30;
const TIES = "mixing them from your private balance would tie the two";

const ref = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;

/** The page's view of the 5 ₳ pool: a pool read. */
const inAda = async (t: Tested) => (await t.lovejoin.status("preprod")).pools!.find((p) => p.id === ADA)!;

/**
 * A restore's two boxes in the 5 ₳ pool, made by deposit `D`, which Koios says spent public account 30's first
 * receive address (a public Bootstrap or a mix cut after its deposit). The Seedelf key is account 0's, so the boxes are
 * the wallet's whichever account paid. A fresh wallet that knows only account 0 is what a restore leaves: Remove
 * wallet deletes the `accounts` and `lovejoin.<net>` records, and the restore's sequential look never reaches 30.
 */
async function restored(t: Tested, D: string): Promise<string[]> {
  const input = await t.wallet.withAccount(CUSTOM, (k) => ({
    bech32: k.cardano.receiveAddress(t.deps.wasm.Network.Preprod, 0),
    cred: k.cardano.paymentKeyHash(0, 0),
  }));
  t.koios.txSpends.set(D, [{ payment_addr: input }]);
  const datum = await ownDatum(t.wallet);
  t.koios.addedToAccounts.push(adaBox(D, datum, undefined, undefined, 0), adaBox(D, datum, undefined, undefined, 1));
  return [`${D}#0`, `${D}#1`];
}

describe("r51 gap-g6#2: a custom account's deposit boxes after a restore", { timeout: 180_000 }, () => {
  it("control: account 30 added before the first pool read is that account's, and the private balance leaves its boxes out", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    await t.accounts.add(CUSTOM);
    const boxes = await restored(t, "dc".repeat(32));

    const status = await inAda(t);
    expect(status.fromPublic.map(ref).sort()).toEqual([...boxes].sort());
    expect(status.otherAccounts?.map((b) => b.account)).toEqual([CUSTOM, CUSTOM]);
    await expect(t.lovejoin.againBoxes("preprod", false, ADA)).rejects.toThrow(TIES);
  });

  it("account 30 added after the first pool read is that account's too, and the private balance leaves its boxes out", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    const boxes = await restored(t, "dd".repeat(32));

    // The restore's first pool read (Lovejoin's page opened) before the user adds account 30: as privacy.md scopes
    // the check, 30 is neither known nor among the first 24, so nothing names it yet.
    const before = await inAda(t);
    expect(before.fromPublic).toEqual([]);
    expect(before.notMixed.map(ref).sort()).toEqual([...boxes].sort());

    // The user adds account 30 by its number (accounts.ts add: no request). The wallet knows it now.
    await t.accounts.add(CUSTOM);
    expect((await t.accounts.known()).map((a) => a.index)).toEqual([0, CUSTOM]);

    // Every account the wallet knows: account 30's deposit boxes are its, named on the page, and never mixed again
    // from the private balance unless asked.
    const after = await inAda(t);
    expect.soft(after.fromPublic.map(ref).sort()).toEqual([...boxes].sort());
    expect.soft(after.otherAccounts?.map((b) => b.account)).toEqual([CUSTOM, CUSTOM]);
    await expect.soft(t.lovejoin.againBoxes("preprod", false, ADA)).rejects.toThrow(TIES);
  });
});
```
