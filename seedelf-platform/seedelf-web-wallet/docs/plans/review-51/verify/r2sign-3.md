# r2sign#3: verification

From lane R2sign, graded low by its finder.

## Trace: confirmed, low

The finding holds. Remove's review shows a token that sat with the Seedelf in raw units, while the Seedelf's own UTxO carries Koios's decimals for it. The path from the stranger's UTxO to the rendered row has no guard that adds decimals: WebAssembly's RemoveResult.tokens is {policyId, assetName, quantity}, buildRemove spreads it as it is, the handler returns it unchanged, and PaidRows calls tokenQuantity, which falls back to 0 for a token off the list. My test, through the real worker and real WebAssembly, fails in both builds on exactly this: the reading's Seedelf card has FOO with decimals 6, and the UTxOs screen shows it as "1". The summary names FOO 1000000, and the review row reads "1,000,000 FOO".

One correction, which widens the finding rather than refuting it. "Off against every other screen" is too strong. Transaction details under the same review also shows "1,000,000 FOO" (I checked it in a copy). e9a#2's withDecimals reads only the reading's two side totals, and those leave out a Seedelf UTxO's tokens (spendableOwned). So the review and its Transaction details agree, and both are wrong. The screens that scale it are the UTxOs screen before the removal and Home after it (traced, not run).

Grade: low.
- Who: a stranger. They plant a Seedelf under a copy of the user's register beside a token that has registry decimals and is off the wallet's list. The user then makes an ordinary Remove of it. The wallet's own mints never make this shape (w1b#2's verify).
- Cost: no money moves wrongly. The transaction pays exactly what is built, and the tokens come back to the user. The figure overstates the user's own incoming tokens by 10^decimals. That costs trust, not funds, as with e9a#2. A stranger can show a big raw number more simply by sending a token with 0 decimals, so they gain nothing.
- Way out: the UTxOs screen shows the right units before the removal, and Home shows them after.
- Since 36fbb96f, on the fix branch only. Before it, the review showed no token rows at all (w1b#2). So it's not in web-wallet/1.9.1.

**Evidence:**

Traced in FIXTREE at HEAD f88560c4. It moved from 853d5779 during the run, but only tests changed (`git show --stat f88560c4`), and src is identical. None of the files traced is modified in the working copy.

1. **Entry.** A contract UTxO holds a Seedelf plus FOO. Koios gives FOO its decimals (koios.ts:13-19 `KoiosAsset.decimals: number`), and so does the private index (private-index.ts:401-405).

2. **The scan.**
   - contract-scan.ts:170-175 sets `seedelfs[name] = locatorOf(u)`.
   - viewOf (:422-428) hands Remove the whole owned row: `owned.get(...) ?? seedelfRow(...)`.

3. **The worker.**
   - withdraw.ts:174 `const utxo = view.seedelfs[seedelf]` becomes `request.utxo`.
   - :183 measureLocally (script-spend.ts:326-332) is a plain `JSON.parse(build(keys, JSON.stringify(request)))`.

4. **WebAssembly.**
   - lib.rs:5113-5124 remove_result, at :5120: `tokens: built.change_tokens.items.iter().map(token_amount).collect()`.
   - TokenAmount (lib.rs:120-127) is {policy_id, asset_name, quantity}. token_amount (:221-227) adds no decimals.

5. **The summary and the screen.**
   - withdraw.ts:188-189: `const { txCbor, seed, inputs: _inputs, to: _to, ...rest } = finished; const summary: RemoveSummary = { ...rest, network, label: seedelfLabel(seedelf), to };`
   - handlers.ts:229-230 returns it unchanged. RemoveSeedelf.tsx:221 does `setSummary(...)`, and :273 renders `<RemoveRows summary={summary} />`.
   - :177 passes it to `<PaidRows ... paid={summary} />`. PaidRows.tsx:19 calls `tokenQuantity(network, t)`.
   - tokens.ts:66-68 tokenDecimals is `tokenInfo(network, t)?.decimals ?? t.decimals ?? 0`, which is 0 for an unlisted token, so formatQuantity prints the raw integer.

6. **The decimals were in hand.**
   - balances.ts:441-458 seedelfSide fills SeedelfInfo.tokens through sumValue (chain.ts:173-198, `decimals: a.decimals ?? 0`). So the Remove screen's own `seedelf` prop has decimals 6.
   - coin-control.ts:340-347 lists the Seedelf's UTxO on the UTxOs screen with the same decimals. Utxos.tsx:452 viewToken scales it.

7. **Transaction details, same gap.**
   - tx-view.ts:202-218 withDecimals reads only `reading.seedelf.tokens` and `reading.cardano.tokens`.
   - The private side's tokens are `sumValue(spendableOwned(owned))` (balances.ts:461-463, :516-518), which leaves out Seedelf UTxOs.
   - Scratch run in a private copy: the private side's tokens were only tUSDM, and the page read `public account #0 · a key that stakes 2.755758 ₳ 1,000,000 FOO`.

8. **Home after the removal.** sumValue takes the new UTxO's asset_list decimals. While the removal is on its way, balances.ts:361 decimalsOf runs over the account rows and all kept owned rows, the Seedelf's included, and incoming.ts:191-194 summed then gives 1 FOO. Traced, not run.

9. **No test covers it.** remove-review.test.ts uses a token with no decimals ("100 junk"). No Remove test sets decimals.

**Test run** in FIXTREE, from extension/, under `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-r2sign-3.test.ts`. It fails at the last assertion in both builds, and every earlier assertion passes:
- the card's FOO is [FOO, "1000000", 6];
- the UTxOs screen's viewToken amount is "1";
- summary.tokens is [[FOO, "1000000"]].

**Mutant**, in ~/.cache/seedelf-review-51/verify-r2sign_3-trace, with every uncommitted file reset to HEAD. Before the mutant, the test failed the same way. buildRemove then attached decimals from `utxo.asset_list`. After that, r51-r2sign-3 passed in both builds, and remove-review.test.ts still passed (3/3 in all). The copy is removed. No other file in FIXTREE was touched.

**Known:** Not known.

Searched:
- docs/backlog.md for decimal, raw unit and Remove. The only hit is line 17's "two decimals", the usability review's ADA call, which is unrelated.
- docs/archive/plans/ for decimals, raw units, PaidRows and Remove's review. That turned up launch-review #55 (one tokenDecimals helper), the blind test's E01 (fixed for Activity only) and the chunk-26b data-layer decimals, none of them this.
- review-51's owner-calls.md for decimal, Remove and PaidRows. The only hits are e6#1 and e4a#1, about other things.
- review-51 INDEX.md: only r2sign#3's own line.
- SECURITY.md's out-of-scope list and the owner's rules: nothing applies. "Numbers stay en-US" is about locale, not units.

Related, not settled: e9a#2's verify (verify/e9a-2.md, "The rest of the family") already said PaidRows.tsx:19 formats a summary's TokenQuantity with no held fallback, and asked to check whether its summaries carry decimals. That was a fix note, before Remove used PaidRows. The e9a#2 fix touched only tx-view.ts.

**Fix notes:**

**What to change.** In withdraw.ts buildRemove (FIXTREE :188-189), give each summary token the decimals the Seedelf's UTxO carries, only where they're non-zero. This is the mutant that made the test pass:
```ts
const decimals = new Map((utxo.asset_list ?? []).filter((a) => a.decimals).map((a) => [`${a.policy_id}.${a.asset_name}`, a.decimals]));
const tokens = rest.tokens.map((x) => { const d = decimals.get(`${x.policyId}.${x.assetName}`); return d ? { ...x, decimals: d } : x; });
const summary: RemoveSummary = { ...rest, tokens, network, label: seedelfLabel(seedelf), to };
```
The wallet's list still comes first, through tokenDecimals. The kept SESSION_REMOVE summary then carries the decimals too.

The alternative is a UI-side fix. RemoveRows would merge the decimals from the screen's own `seedelf.tokens` (SeedelfInfo.tokens, which balances.ts seedelfSide already fills with Koios's decimals), as the other reviews do with `{ ...held, ...tk }`. The test pins the worker-side shape. A UI-side fix needs the seedelf passed in the test's RemoveRows render.

**Class.** This is e9a#2's class: a token list made from WebAssembly's TokenAmount, which has no decimals, shown with no held fallback. Siblings:
1. **Remove's Transaction details.** tx-view.ts withDecimals (:202-218) reads only `reading.seedelf.tokens` and `reading.cardano.tokens`. Those leave out a Seedelf UTxO's tokens (spendableOwned), so the same FOO reads "1,000,000 FOO" there too (checked in a copy). Build its map as balances.ts decimalsOf does, over the kept account rows and the kept contract view's owned rows, Seedelf UTxOs included, or add `reading.seedelf.seedelfs[].tokens`.
2. **PaidRows's other callers.** These are SiteSessions.tsx:644 (the top-up review) and DappApprovals.tsx:806 (the dApp funding's forSite). Their tokens come from WebAssembly summaries with no held fallback. Check whether they carry decimals; I didn't trace them to the end.

One worker helper that gives a summary's tokens their decimals from one decimalsOf map would cover the whole class.

**Test:** tests/r51-r2sign-3.test.ts.

**Needs the owner:** no. It only shows the right units on an existing review: no refusal, no privacy default, no change to what a screen offers.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-web-wallet/extension/tests/r51-r2sign-3.test.ts`

Result: FAILS in FIXTREE, as intended, in both builds, at the last assertion. All earlier assertions pass.

Default build (`npx vitest run tests/r51-r2sign-3.test.ts`):
```
 ❯ tests/r51-r2sign-3.test.ts (1 test | 1 failed) 937ms
     × scales an unlisted token by the decimals the Seedelf's UTxO carries 936ms
AssertionError: expected '1,000,000 FOONot on the wallet&#x27;s…' to match /^1 FOONot on the wallet&#x27;s list, …/
- Expected:
/^1 FOONot on the wallet&#x27;s list, asset1/
+ Received:
"1,000,000 FOONot on the wallet&#x27;s list, asset1ywnj…xtpty9."
 ❯ tests/r51-r2sign-3.test.ts:77:19
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

`VITE_ENABLE_MAINNET=false npx vitest run tests/r51-r2sign-3.test.ts`: the same failure at :77:19, with the same received text. 1 failed (1).

Mutant, in a private copy with HEAD's files: buildRemove gives each summary token the non-zero decimals from `utxo.asset_list`. r51-r2sign-3 then passes in both builds, and remove-review.test.ts still passes (Test Files 2 passed, Tests 3 passed). The copy is removed.

```
// Chunk 51, finding r2sign#3: Remove's review now lists each token that sat with the Seedelf (w1b#2's fix), but a
// token off the wallet's list shows in raw units. WebAssembly's RemoveResult.tokens is {policyId, assetName,
// quantity}, withdraw.ts buildRemove spreads it into the summary as it is, and PaidRows scales by the wallet's list,
// then the token's own decimals, then 0. The Seedelf's UTxO the removal spends carries Koios's decimals for it, and
// the UTxOs screen (and Home, once it's back) scale it by them.
//
// Real worker, real WebAssembly, over the fake Koios: a stranger puts a Seedelf under a copy of the user's register
// beside 1,000,000 raw units of a token of theirs, FOO, which Koios reports with 6 decimals (w1b#2's shape). The
// UTxOs screen shows that UTxO's FOO as 1. Remove's review must show the same 1 FOO coming back, not 1,000,000.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { assetFingerprint } from "../src/shared/fingerprint";
import type { RemoveSummary } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { RemoveRows } from "../src/ui/screens/RemoveSeedelf";
import { viewToken } from "../src/ui/tokens";
import { ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const hex = (s: string) => Buffer.from(s).toString("hex");
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;

/** A token off the wallet's list (2 preprod, 32 mainnet), whose decimals Koios knows from the token registry: 6. */
const FOO = { policyId: "f0".repeat(28), assetName: hex("FOO") };
const key = (x: { policyId: string; assetName: string }) => `${x.policyId}.${x.assetName}`;

/** The fixture's own Seedelf UTxO: its register, under the 12-word phrase's key, is on chain for anyone to copy. */
const template = ownedUtxos[2]!;
const SEEDELF_POLICY = template.asset_list![0]!.policy_id;
/** The stranger's Seedelf: seedelf.ak at 5b82530 burns any name with the prefix. */
const PLANTED = `5eed0e1f${hex("stranger")}00${"cd".repeat(19)}`;

/** The review's rows as text, each row's label and value in order (remove-review.test.ts's). */
const rows = (summary: RemoveSummary) =>
  [
    ...renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, createElement(RemoveRows, { summary }))).matchAll(
      /<dt>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g,
    ),
  ].map(([, label, value]) => [label, value!.replace(/<[^>]+>/g, "")]);

describe("r51 r2sign#3: Remove's review shows a token that sat with the Seedelf in the units the other screens do", () => {
  it("scales an unlisted token by the decimals the Seedelf's UTxO carries", async () => {
    const t = testBalances();
    await t.wallet.create(phrase, PASSWORD);
    t.koios.added.push({
      ...template,
      tx_hash: "e1".repeat(32),
      tx_index: 0,
      value: "3000000",
      asset_list: [
        { policy_id: SEEDELF_POLICY, asset_name: PLANTED, quantity: "1", decimals: 0, fingerprint: "" },
        { policy_id: FOO.policyId, asset_name: FOO.assetName, quantity: "1000000", decimals: 6, fingerprint: assetFingerprint(FOO) },
      ],
    });

    // The reading: the planted Seedelf is listed as the user's, its card carrying FOO with Koios's 6 decimals.
    const reading = await t.balances.get("preprod");
    const card = reading.seedelf.seedelfs.find((s) => s.assetName === PLANTED)!;
    expect(card.tokens?.map((x) => [key(x), x.quantity, x.decimals])).toEqual([[key(FOO), "1000000", 6]]);
    // The UTxOs screen's private list shows that UTxO's FOO as 1 (Utxos.tsx UtxoTokens, viewToken).
    const lists = await t.coins.lists("preprod");
    const held = lists.seedelf.find((u) => u.seedelf?.name === PLANTED)!.tokens.find((x) => key(x) === key(FOO))!;
    expect(viewToken("preprod", held).amount).toBe("1");

    // Remove it, its ADA and FOO back to the public account: the summary names FOO (w1b#2's fix) ...
    const summary = await t.withdraw.buildRemove("preprod", PLANTED, "account");
    expect(summary.tokens.map((x) => [key(x), x.quantity])).toEqual([[key(FOO), "1000000"]]);

    // ... and the review shows the same 1 FOO coming back, not its 1,000,000 raw units.
    const shown = rows(summary);
    const back = shown.findIndex(([label]) => label === "Comes back to your public account");
    expect(back).toBeGreaterThan(-1);
    const [label, token] = shown[back + 1]!;
    expect(label).toBe("");
    expect(token).toMatch(/^1 FOONot on the wallet&#x27;s list, asset1/);
  });
});
```
