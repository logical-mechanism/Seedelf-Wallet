# gap-g1#1: verification

From lane gap-G1, graded medium by its finder.

## Trace: confirmed, medium

The path goes through from start to finish on TREE, and a run shows it for the stealth mint and for a swap's funding.

**How it works.** A stranger copies the inline datum of the user's own Seedelf UTxO byte for byte (d = 1) and pays the contract under it.
- The wallet counts the new UTxO as its own: ownership is `g^x == u` and nothing else.
- The balance reading notes it as a payment received (`received:<tx>`).
- Nothing anywhere compares its register with another, though the kept view holds both.

**Why it's taken first.** `Purpose::Mint` ranks Received 0. `Purpose::Fund` ranks Received 1, after only a top-up's own session. Step 1 takes, by (rank, lovelace), the first UTxO that pays alone. So the copy goes first whenever it is the smallest received UTxO that pays alone.

**The run.** Beside Bob's 60 ₳, paid properly:
- The stealth mint spends Mallory's 40 ₳ alone. The new Seedelf is named after her outpoint (`5eed0e1f00e7e7…`), and the review has no note (one class).
- A swap's funding (16 ₳ + 5 ₳) spends her 40 ₳ alone too.

**What it ties.** On chain each spend's input carries A's datum, so anyone can see the spender holds A's key. A was paid for by the public account, which is the default and which privacy.md:106 says links the account and the name. So the new Seedelf, or the one-time account and everything it does, is tied publicly to that account.

**Pool start.** Shown by trace only: `Purpose::Mint`, then `launch_apart`, then `select_script_inputs`. The private balance is the screen's default.

**Would pass once fixed.** I put a stand-in fix in a copy, never in TREE: a spendable UTxO whose register matches a Seedelf in the kept view is classed Unknown by its transaction. With it, both spends take Bob's 60 ₳ and the test passes.

**Corrections, none material:**
- "Takes it first" needs the copy to be the smallest received UTxO that pays alone; for a top-up or Put in 5 ₳, the session's own money comes first. Mallory picks the amount, so a mint costs her about 4 ₳ and a funding at least its size, money the victim keeps.
- In the finder's "claims contradicted" list, README.md:193 and privacy.md:81 say "only if/only when", which stays literally true. privacy.md:170 describes the order rather than promising anything.

**Severity: medium.** It is a link privacy.md:107 says isn't made, made by default by an ordinary action, and a stranger causes it for a few ADA. No funds are at risk, so not high.

**Known:** no. It isn't in the backlog, the archived reviews, the chunk 46/49 plans, SECURITY.md or the owner's rules. The fix reorders a default and adds no refusal.

**Evidence:**

Trace on TREE (`e36b62c5`). Code is web-wallet/1.9.1's except `manifest.ts`. The last Rust-path commit, `1d41dfed`, is docs only, and `wasm/pkg` was built after it, on 2026-11-17 21:33.

1. **Entry.**
   - `chain.ts:84-114`: `registerOf` reads constructor 0 with two 48-byte fields, so a copied datum parses.
   - `balances.ts:489-506`: `ownedUtxos` asks only `keys.seedelf.isOwned(register)`.
   - `register.rs:176-197`: `is_owned` refuses an identity point, then returns `hex(g1*sk) == public_value`. A byte-for-byte copy of A's datum passes.
2. **Scan.**
   - `contract-scan.ts:150-170` (Koios) and `:300-330` (the index) keep every owned row in `owned`, so A's Seedelf row and the copy both.
   - `locatorOf` (`:400-403`) keeps every Seedelf's register.
   - Nothing compares registers. `grep -rn 'registerOf('` finds only the definition at `chain.ts:84`, `balances.ts:491` and `contract-scan.ts:401`. `tx-view.ts:233` `ownRegister` is an `is_owned` check, not a comparison.
3. **History.**
   - `balances.ts:278` and `:399` call `activity.arrived(view.owned)` after each reading.
   - `activity.ts:427-470` `arrived`: the transaction isn't in `ours` (`:431`) and holds no Seedelf token (`:441`), so its kind is "received" with no origin. Only the first reading marks rows Unknown.
   - `classes` (`:389-420`) then `classOf` (`:647-657`) give `receivedIn(tx)`, which `shared/histories.ts:39` defines as `{origin: "received"}`.
4. **What a spend may take.**
   - `script-spend.ts:235-245` `readContract` calls `spendable` (`:299-302`), which drops only Seedelf-holding and reference-script rows.
   - `coins.seedelf` (`coin-control.ts:259-262`) drops only rows the user locked.
   - Then `classesOf` (`:267-274`).
5. **Mint.**
   - `mint.ts:106-133` `buildStealth` calls `wasm.buildMint`.
   - `lib.rs:2316-2341` `check_spendable` checks only `is_owned`, no Seedelf token, and the evaluator's refusal.
   - `lib.rs:2396-2417` `mint_spend` calls `build::mint_apart(…, histories(Purpose::Mint, …))`.
   - `build.rs:2391-2398` Mint ranks: Received 0, Lovejoin 1, Unknown 2, Own 3, Session 4.
   - `build.rs:2564`: not blind, so `apart` runs. `:2700-2703` step 1 calls `one_more`, which (`:2603-2630`) sorts by `(rank, lovelace)` and takes the first that builds.
6. **Fundings.**
   - `sessions.ts:3050-3075` `buildFunding` sends `funding: {session: sessionClass(index).id}`.
   - `lib.rs:3506-3511` and `:4808-4813` turn that into `Purpose::Fund`.
   - `build.rs:2399-2412` Fund ranks: the session's own 0, Received 1, Lovejoin 2, Unknown 3, Own 4, Session 5.
   - Callers: `outBuild` `:1933`, `siteOutBuild` `:2048`, `mixFunding` `:2262`, `topUpBuild` `:2381`, `collateralTopUp` `:2505`.
7. **Pool start.**
   - `LovejoinLaunch.tsx:101` defaults to "private". `lovejoin-launch.ts:320-352` `fromPrivate` follows.
   - `lib.rs:2680-2697` `build_launch` uses `histories(Purpose::Mint)`.
   - Core `lovejoin/launch.rs:369-400` `launch_apart` calls `select_script_inputs`.
8. **Review.**
   - `script-spend.ts:201-205` `spentHistories` gives one class.
   - `histories.ts:193` writes a note only when `classes.length > 1`, so `HistoriesNote` (`CreateSeedelf.tsx:156`) shows nothing.
   - The form's note (`CreateSeedelf.tsx:240-241`) is en.json:1442: "Only money others paid you keeps the Seedelf apart from your public account."
   - `CreateSeedelf.tsx:64` picks "seedelf" when the public account has no UTxOs.
9. **Name.** `transaction.rs:114-141` names the Seedelf after the smallest input: index, then transaction hash.

**Since.** `366cd5c6` (Purpose ranks) and `d5710a24` (classes), both 2026-09-27. They are in every web-wallet tag from 1.6.0 to 1.9.1.

**Run** (real WebAssembly, the worker's services over the fakes):
- classes: `b0…#0` and `e7…#0` both `{origin: "received"}`
- stealth mint: spends ["Mallory's 40 ₳ under A's datum"], named `5eed0e1f00e7e7e7…`, histories `[received:e7…]`, note null
- swap funding: pays 16000000 + 5000000, spends ["Mallory's 40 ₳ under A's datum"]

**Stand-in fix in a copy** (`$HOME/.cache/seedelf-review-51/verify-gap-g1_1-trace`, now removed). `readContract` gives a UTxO whose register matches a Seedelf in `view.seedelfs` the class `unknownIn(tx)`. Same test: the mint spends ["Bob's 60 ₳"] (named `5eed0e1f00b0b0…`), the funding spends ["Bob's 60 ₳"]. 1 passed.

**Typecheck.** `npx tsc --noEmit -p .` reports 10 errors, all in r51-b1-3, r51-b1-5 and r51-e8b-3; none in mine. `git status` shows TREE gained only this test file.

**Known:** none

**Fix notes:**

**Settled or known: no.** Searched:
- backlog.md, for: received, takes received, money others paid, payer, as found, copied, d = 1, bad d, tracer, dusting, duplicate, same register. No hits.
- docs/archive/plans/*.md, for the same words plus stealth mint, written as found, byte for byte. The hits don't cover it:
  - privacy-review.md §2.3:189/198 designs received-first and never weighs a payer who reveals d.
  - independent-review.md:189 D1 is a different call: one made-private UTxO against merging two received payments.
  - chunk-09-transfer.md:70 is the wallet's own rule to re-randomize.
- The chunk-46 and chunk-49 plans, seedelf-verification/README.md and SECURITY.md: nothing.

The root README.md:167 lists "a bad d value" as a protocol attack. That isn't a settled wallet item. Inside chunk 51 the shape was noted twice but never reported: X1a's note (lanes/X1a.md:114, handed to X2) and verify/e1a-1.md's fix note (c), which names the funding half.

**(a) The finder's fix is sound.** Do it in `readContract`, which has the view, or in `activity.classes`:
- Key each spendable UTxO by `registerOf`'s hex.
- Compare that key with every Seedelf's `Locator.register` in `view.seedelfs` (the user's and others').
- Give a match the matched Seedelf's history (minted-by's record), or a class ranked last.

The test pins only the outcome: neither spend takes the copy while Bob's payment pays alone. So it passes wherever the fix lands, as my stand-in in `readContract` showed. The real fix also needs:
- A tag on the UTxOs screen.
- A short `.privacy.` or `.warn.` line on the reviews when such a UTxO is spent anyway, for when it is all that pays.
- Care with the other owned rows. Matching them catches a copied Make private output, but two owned rows under one register can also be a restore's or another device's.

**(b) The words.** These promise more than holds against a hostile payer:
- privacy.md:107, :356, :378, :454
- en.json:1442 `mint.privacy.fromPrivate`, :1385 `lovejoin.launch.privacy.fromPrivate`, :1403 `lovejoin.launch.privacy.private`, :2445 `swaps.privacy.oneTime`, :551 `dapps.privacy.oneTime`
- flows.md:356

Any payer knows its own UTxO and can make it public: d = 1, a small d, or publishing its d. Only an exact copy can be caught on the device, so the words carry the rest. README.md:193 and privacy.md:81 say "only if/only when" and stay literally true. privacy.md:170 describes the order. Any new key needs a `.privacy.` or `.warn.` name.

**Needs the owner.** It changes a privacy default (what the stealth mint, the fundings and the private pool start take first) and the privacy words. Also the owner's call: whether the stealth mint should rank a box back from Lovejoin ahead of received money, since no payer knows a box.

**If the owner picks a words-only fix**, this test won't pass. Replace it with one that pins the new words.

**Same class:** e1a#1 (confirmed: a stranger's Lovejoin box under the wallet's register, taken first by Mix my boxes again), x1a#2 (confirmed: a site's payment under a register as found) and gap-g1#2.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g1-1.test.ts`

Result: It fails on TREE, as it should while the bug is there. It fails at exactly the two soft assertions, after every precondition passed.

Command, run from extension/:
`nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g1-1.test.ts`

```
[r51 gap-g1#1] classes: {"b0b0…b0#0":{"id":"received:b0b0…b0","origin":"received"},"e7e7…e7#0":{"id":"received:e7e7…e7","origin":"received"}}
[r51 gap-g1#1] stealth mint spends ["Mallory's 40 ₳ under A's datum"] named 5eed0e1f00e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7 histories [{"id":"received:e7e7…e7","origin":"received"}] note null
[r51 gap-g1#1] swap funding pays 16000000 + 5000000 and spends ["Mallory's 40 ₳ under A's datum"]
 ❯ tests/r51-gap-g1-1.test.ts (1 test | 1 failed) 5217ms
   × is never what a stealth mint or a swap's funding takes first while a payment made properly pays alone 5215ms
 FAIL … AssertionError: the stealth mint's inputs: expected [ Array(1) ] to not include 'e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e…'
 ❯ tests/r51-gap-g1-1.test.ts:105:62
 FAIL … AssertionError: the swap funding's inputs: expected [ Array(1) ] to not include 'e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e…'
 ❯ tests/r51-gap-g1-1.test.ts:106:61
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

**Checked that it passes once fixed.** I ran it in a copy at `$HOME/.cache/seedelf-review-51/verify-gap-g1_1-trace`, never TREE, with a stand-in fix in `script-spend.ts` `readContract`: a spendable UTxO whose `registerOf` matches a register in `view.seedelfs` is classed `unknownIn(tx)`. The output:

```
stealth mint spends ["Bob's 60 ₳"] named 5eed0e1f00b0b0…
swap funding pays 16000000 + 5000000 and spends ["Bob's 60 ₳"]
Test Files 1 passed (1); Tests 1 passed (1)
```

The copy and its `node_modules` symlink were removed afterwards.

```
// Chunk 51, gap-g1#1 (the trace verifier's test). The wallet's own Seedelf A
// sits in the contract under its register D, an inline datum anyone can read.
// Mallory, a stranger, pays the contract 40 ₳ under D byte for byte (d = 1):
// she needs nothing secret, only A's UTxO. The wallet's ownership check is
// g^x == u alone (balances.ts ownedUtxos, register.rs is_owned), so it counts
// her UTxO as its own, and the Seedelf history notes it as a payment received
// (activity.ts arrived and classOf: received:<tx>), as it notes Bob's 60 ₳,
// paid properly under a fresh re-randomization. Nothing compares her register
// with A's, though the kept view holds both.
//
// A stealth mint ranks Received first (core build.rs Purpose::Mint) and a
// session's funding does too (Purpose::Fund), each taking the smallest UTxO
// that pays alone. So both take Mallory's 40 ₳ ahead of Bob's 60 ₳. On chain
// each then spends an input whose datum is A's: anyone can see its spender
// holds A's key, so the new Seedelf (named after that input, too) and the
// swap's one-time account are tied to A, and through A's own mint to the
// public account that paid for it. The mint form says "Only money others paid
// you keeps the Seedelf apart from your public account", and the review has
// no note (one class).
//
// What's right (the finding's fix (a); the owner decides how): a UTxO under a
// register the chain already ties to one of the wallet's own Seedelfs is never
// what these spends take ahead of a payment made properly that pays alone.
// Driven through the worker's services with the real WebAssembly, as
// mint.test.ts and history-classes.test.ts are.

import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_MINT } from "../src/background/mint";
import { SESSION_OUT } from "../src/background/sessions";
import { historiesNote } from "../src/shared/histories";
import { loadTestWasm, minswapEstimate, ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const inputsOf = (cbor: string) => txInputs(Uint8Array.from(Buffer.from(cbor, "hex")));

describe("r51 gap-g1#1: a stranger's payment under one of the wallet's Seedelfs' datum, as found", () => {
  it("is never what a stealth mint or a swap's funding takes first while a payment made properly pays alone", { timeout: 60_000 }, async () => {
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    const t = testBalances();
    await t.wallet.create(v.phrase, PASSWORD);
    // One spend: a funding that takes one UTxO alone (history-classes.test.ts, L41).
    const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
    t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
    // The history's first reading: the 25 ₳ and the 3 ₳ with tokens are already there (Unknown); a3 is Seedelf A.
    await t.balances.get("preprod");

    const seedelfA = ownedUtxos.find((u) => (u.asset_list ?? []).some((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId))!;
    const wasm = loadTestWasm();
    const fresh = await t.wallet.withKeys((keys) => Buffer.from(wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister()))).toString("hex"));
    const paid = (txHash: string, lovelace: string, inline_datum: KoiosUtxo["inline_datum"]): KoiosUtxo => ({
      ...ownedUtxos[0]!,
      tx_hash: txHash,
      tx_index: 0,
      value: lovelace,
      asset_list: [],
      inline_datum,
      block_height: 9_000_001,
    });
    // Bob pays A as any wallet does, under a fresh re-randomization; Mallory under A's datum as found.
    const bob = paid("b0".repeat(32), "60000000", { bytes: fresh, value: null });
    const mallory = paid("e7".repeat(32), "40000000", seedelfA.inline_datum);
    const M = `${mallory.tx_hash}#0`;
    const B = `${bob.tx_hash}#0`;
    t.koios.added.push(bob, mallory);
    t.clock.now += 60_000;
    await t.balances.get("preprod", true);

    // What holds today, and still would once fixed: anyone can read that her datum is A's, and both are the wallet's.
    expect(mallory.inline_datum!.bytes).toBe(seedelfA.inline_datum!.bytes);
    expect((seedelfA.asset_list ?? []).map((a) => a.asset_name)[0]).toMatch(/^5eed0e1f/);
    const classes = await t.activity.classes("preprod", [bob, mallory]);
    console.log("[r51 gap-g1#1] classes:", JSON.stringify(Object.fromEntries(classes)));
    expect(classes.get(B)).toEqual({ id: `received:${bob.tx_hash}`, origin: "received" });

    // 1. A stealth mint from the private balance.
    const minted = await t.mint.build("preprod", "", "seedelf");
    const mintInputs = inputsOf((await t.session.get<{ txCbor: string }>(SESSION_MINT))!.txCbor);
    console.log(
      "[r51 gap-g1#1] stealth mint spends",
      JSON.stringify(mintInputs.map((i) => (i === M ? "Mallory's 40 ₳ under A's datum" : i === B ? "Bob's 60 ₳" : i))),
      "named",
      minted.tokenName,
      "histories",
      JSON.stringify(minted.histories),
      "note",
      JSON.stringify(historiesNote(minted.histories) ?? null),
    );

    // 2. A private swap's funding, paying a new one-time account.
    const quote = await t.sessions.quote("preprod", minswapEstimate.ask);
    const out = await t.sessions.outBuild("preprod", quote);
    const outInputs = inputsOf((await t.session.get<{ txCbor: string }>(SESSION_OUT))!.txCbor);
    console.log(
      "[r51 gap-g1#1] swap funding pays",
      out.payments.map((p) => p.lovelace).join(" + "),
      "and spends",
      JSON.stringify(outInputs.map((i) => (i === M ? "Mallory's 40 ₳ under A's datum" : i === B ? "Bob's 60 ₳" : i))),
    );

    // Neither takes Mallory's copy of A's datum ahead of Bob's payment, which pays each alone.
    expect.soft(mintInputs, "the stealth mint's inputs").not.toContain(M);
    expect.soft(outInputs, "the swap funding's inputs").not.toContain(M);
  });
});
```

## Impact: partly, low

The mechanism holds, but the harm the wallet can prevent is narrower than the finding claims, and the grade should be low. I was unsure between medium and low, so I took the lower, as the brief says.

**What holds.** A stranger copies a register already on chain:
- the datum of the UTxO holding A's token (d = 1);
- or the datum of a Make private output in ω's own transaction.

She pays about 4 ₳ under it, and the user keeps that money. The wallet treats it as its own and classes it received:<tx>. A stealth mint paid from the private balance then takes it in step 1, ahead of honest payments and even ahead of a box back from Lovejoin (Mint ranks Received 0, Lovejoin 1). The review shows no note, since there's only one class. On chain, B's minter then visibly holds A's key, and A's default account mint ties B to ω. In that case privacy.md:107 ("hides the payer") is false, and so are the launch review's words ("but not whose spend it was"). The worker already keeps the data an exact-copy check needs, and nothing compares registers.

**Why it's narrower and lower:**
1. **The attack itself is known, and its general form is inherent.** The root README already lists it as a de-anonymizing attack (README.md:166-171: a bad d, and a d that isn't destroyed, "losing all privacy"). The critic's gap prompt set it as settled. Any payer knows the outpoint it paid. It can make whatever that UTxO pays for public with any d it reveals: d = 2, or a d derived from public data. The device can spot only the exact copy, and a deliberate attacker avoids that at no cost. No ordering that spends received money escapes this. The fallback ordering (money made private yourself) always ties B to ω. What the wallet can fix is the words, plus a cheap check that catches only the laziest form.
2. **The words on the screens are true as written.**
   - mint.privacy.fromPrivate (en.json:1442) states a necessary condition: "Only money others paid you keeps…".
   - swaps.privacy.oneTime (en.json:2445) and dapps.privacy.oneTime (en.json:551) say only that money you made private leads back, and promise nothing for received money.
   - The overclaims are privacy.md:81 and :107, and the launch's two strings (en.json:1385 and :1403). A launch is a rare action, and the tracer would have to pay about 25 ₳ alone.
3. **The preconditions narrow who gets hurt.**
   - Paying the mint from the private balance is opt-in while the public account holds UTxOs (CreateSeedelf.tsx:64).
   - Harm exists only if the user holds clean money (an honest payment or a box) that would have paid alone. A user with only money they made private themselves is tied to ω either way, and the form says so.
   - One tracer is spent by one flow only. For a funding, it has to pay that whole funding alone and be the smallest received UTxO that does. When inputs are merged, received money goes largest first (build.rs:2773-2781). So the attacker has to give the user roughly each funding's size, and "every session funding" overstates it.
4. **No money is lost:** the user keeps the tracer. There's a manual way out (lock UTxOs by hand on the UTxOs screen, or mix through Lovejoin first), but nothing tells the user to.
5. **Calibration against this review's siblings.**
   - x1a#2 (a site's payment under a register as found, with the sign window's words false) was confirmed low.
   - e1a#1 and e6#1 were confirmed medium. In both, the wallet mislabels planted evidence and a complete fix exists. Here the class "received" is correct, and only the exact copy can be detected.

**The part that would be medium.** The stealth-mint case would be medium if the owner counts a hostile payer as in scope for the ordering. That is the owner's design call: rank a box back from Lovejoin ahead of received money for a stealth mint, since no payer knows a box.

The funding half (2) is already noted in this review as e1a#1's family (c).

**Evidence:**

I traced this on TREE at e36b62c5 (code as at cd764fba). I ran nothing but reads and greps.

**The mechanism (confirmed):**
- register.rs:176-197: is_owned checks only b = [x]·a, and is false for identity points. A d = 1 copy of R_A = (g^d, (g^x)^d) passes.
- activity.ts:427-470 `arrived`: Mallory's transaction isn't in `ours` and holds no Seedelf token, so it gets kind "received" with no origin. classes (:389-420) then gives received:<tx> once anything is known.
- wasm lib.rs:
  - :2316-2341 check_spendable checks only ownership, the Seedelf token and the evaluator's refusal.
  - :2396-2417 mint_spend uses histories(Purpose::Mint).
  - :2694 the launch uses Purpose::Mint.
  - :3506-3511 a funding uses Purpose::Fund.
- build.rs:
  - :2394-2400 Mint ranks Received 0, Lovejoin 1, Unknown 2, Own 3, Session 4.
  - :2401-2412 Fund ranks the session's own 0 and Received 1.
  - :2608 one_more sorts by (rank, lovelace), and :2708 step 1 takes the first single UTxO that pays.
  - :2773-2781 by_history: when merging, inputs go by tier, then rank, then largest lovelace first.
- contract-scan.ts:78-84 and :400-403: every Seedelf's register is kept in the locator, and no code compares two registers. The locator is keyed by token name, so a duplicate register confuses nothing else.

**Defaults and words:**
- CreateSeedelf.tsx:64: `from` is "account" unless the public account has no UTxOs and the private balance does.
- en.json:1442 mint.privacy.fromPrivate: "Only money others paid you keeps the Seedelf apart from your public account. Money you made private yourself leads back to it." This is a necessary condition.
- en.json:2445 and :551: "money you made private leads back to your public account". True as written.
- en.json:1385 and :1403 (launch): "…but not whose spend it was". False with a tracer.
- privacy.md:81 and :107: "hides the payer". A sufficiency claim, false against a hostile payer. privacy.md:129 admits what the counterparty knows only for public sends.
- README.md:166-171 lists the bad d and the undestroyed d as known de-anonymizing attacks, "avoided if d is large and destroyed". README.md:193 says σ' has no link to ω "only if" others paid for it, again a necessary condition.
- privacy-review.md:189 and :198 (§2.3) chose "a stealth mint prefers received money" without considering a hostile payer.

**Way out:** Utxos.tsx:2-10 and :54 let the user lock any spendable UTxO by hand. The tag only says "Received", so a tagged payment can't be told from an honest one.

**Tests:** mint_test.rs:2671 a_stealth_mint_takes_received_money_before_money_moved_in pins received-first as designed.

**Siblings:**
- verify/x1a-2.md: confirmed low. A register written as found, the window's words false, the "site always knows its own d" argument.
- verify/e1a-1.md:85, family (c): the funding half of this finding, recorded "for the owner".
- verify/e6-1.md: medium, because there the wallet mislabels planted evidence.

**Known:** Partly known; the verdict stays partly, not known.

- **The protocol attack:** the root README's De-Anonymizing Attacks (README.md:166-171: a bad d, and a d that isn't destroyed). The critic's G1 prompt set it as settled (data/critic.json).
- **The funding half (2):** already in this review as e1a#1's family (c), verify/e1a-1.md:85 ("Not Lovejoin, for the owner… a stranger's tracer payment to the name, large enough to pay alone, is spent into the next session's one-time account").
- **The same class on the sign window:** x1a#2 (verify/x1a-2.md, confirmed low).
- **Not recorded anywhere:** the stealth mint and launch halves, privacy.md:81 and :107's words, and the order in which Mint ranks received money against boxes.
  - backlog.md has one hit only, line 70, on another subject.
  - archive/plans/privacy-review.md §2.3 (:189, :198) builds received-first without a hostile payer.
  - I found no other archive hit for payer, tracer, bad d, small d, "as found" or "copy of".

**Fix notes:**

1. **The class fix is the words.** Say that whoever paid you knows which UTxO it is, and can tie whatever it pays for to the Seedelf they paid, in public.
   - privacy.md:81 and :107; :170 says received money goes first for a stealth mint and fundings, so it may want the same caveat.
   - A bullet in Known links, under Creating a Seedelf or Co-spending.
   - flows.md:356 and README.md:193.
   - en.json lovejoin.launch.privacy.fromPrivate (:1385) and .private (:1403).

   mint.privacy.fromPrivate, swaps.privacy.oneTime and dapps.privacy.oneTime are true as written; at most add a short .privacy. clause. New keys need .privacy. names, plus es and ja.

2. **The finder's exact-copy check (a) is optional and has small reach.** It needs no request:
   - key each owned UTxO by its register hex (registerOf);
   - match it against the user's own Seedelfs (Locator.register) and the other rows in view.owned;
   - rank a match last for Mint and Fund, and give it its own tag.

   It catches only d = 1 copies. An attacker who reveals any other d can't be detected, so never word it as protection. It reorders and tags, and refuses nothing, so the owner's refusal rule isn't touched. It does change a selection order and the UTxOs screen, so it needs the owner.

3. **The owner's design call:** should Purpose::Mint (and perhaps Fund, where a single box pays) rank a box back from Lovejoin ahead of received money, since no payer knows a box? This is the only change that narrows what a hostile payer can reach. mint_test.rs:2671 stays valid either way, since it's about money moved in.

4. **Group it.** Deduplicate the funding half with e1a#1's family (c). Fix the words together with x1a#2 (the same register-as-found class, cip30.rs:1386) and e1a#1's NotMixed words.

The trace verifier's tests are as the finder sketched:
- a Vitest test where activity.classes gives received:<tx> for a copy of the Seedelf's datum;
- a mint_test.rs-style test where mint_apart takes the 4 ₳ copy ahead of 30 ₳ received.

## Severity tiebreak: medium

Both verifiers agree on how it works, and I checked the steps that decide the grade in TREE.
- Ownership is is_owned alone. No code compares two registers: `registerOf(` is called only at contract-scan.ts:401 and balances.ts:491.
- Purpose::Mint ranks Received 0, ahead of a box back from Lovejoin at 1 (build.rs:2394-2400). Step 1's one_more sorts by (rank, lovelace) and takes the first single UTxO that builds (build.rs:2606, :2708-2711).
- The histories note speaks only when classes.length > 1 (histories.ts:193). The UTxOs screen tags the copy "Received", like an honest payment.
- The launch defaults to "private" (LovejoinLaunch.tsx:101). Every swap is funded from the private balance (Swaps.tsx:1-4).

**Who and at what cost.** A stranger pays about 4.2 ₳ (4 ₳ under A's datum byte for byte plus the fee), and the user keeps the 4 ₳. That UTxO is then the input of the user's next stealth mint ahead of an honest 30 ₳ payment, and ahead of any box.

**What the user loses.** The link the stealth mint exists to avoid. Every chain reader sees that B's minter holds A's key, and A's default account mint ties A to ω.
- privacy.md:107 says this case "hides the payer".
- privacy.md:13 and :50 promise chain readers can't see who owns a UTxO "because registers are re-randomized". A d = 1 copy isn't re-randomized.
- The launch's words (en.json:1385, :1403), "not whose spend it was", are false.
- Known links (privacy.md:94) admits nothing about a payer tracing what its UTxO pays for.

**Default.** No unusual step is needed. Paying the mint from the private balance turns privacy up, not down, and it is the default once the public account is empty (CreateSeedelf.tsx:64). After the recommended steps (create a Seedelf, then make money private) the account is often empty. The order is the wallet's own, with no control.

**Way out.** There is none the user can find. A hand lock works only if the user can tell the copy from an honest payment, and neither the tag nor the review tells them.

**Precedent.** This is e6#1's shape: a stranger's plant turns a setup chosen for privacy into the very link that setup avoids, by the wallet's default, under a false assurance. That tiebreak went medium, and so did e1a#1, where "a payer knows theirs" didn't lower the grade. x1a#2 (low) is a smaller harm: it shows which Seedelf a public-account payment went to, a payment already public.

**Where the impact verifier is right.**
- The general form (any d, then published) is the README's settled attack, and an exact-copy check catches only d = 1.
- The mint, swap and site notes are literally true.
- The funding half is costlier: the copy must pay the whole funding alone and be the smallest received UTxO that does, since merges take received money largest first.
- The launch needs about 25 ₳.

None of these lowers the mint half. The critic scoped this finding to the wallet's ordering and words, and those are what make a settled protocol attack cheap and near-certain. Not high: no funds are at risk, and the wallet signs what it shows.

**Decisive point:** The impact verifier's own conditional settles it. It says the stealth-mint case "would be medium if the owner counts a hostile payer as in scope for the ordering", and the brief already counts it: a stranger "can send any UTxO … any datum". With that, the mint half meets medium's privacy test on its own.
- It is a link privacy.md:107 says isn't made ("hides the payer").
- The wallet's default order makes it: Received first, ahead of boxes, smallest first. That puts a 4 ₳ copy ahead of every honest payment and every box.
- The user made a choice that turns privacy up, not down.
- The review shows no note, and the tag can't tell the copy from an honest payment.

That is the same grade e6#1 and e1a#1 got.

**Fix notes:**

1. **The words carry the class**, since any d that is later published works and the device can't see it.
   - Rewrite privacy.md:107.
   - Add a Known links bullet under Creating a Seedelf or Co-spending: whoever paid you knows which UTxO it is, can tie whatever it later pays for to the Seedelf they paid, and can make that public (d = 1, a small d, or by publishing d).
   - Fix en.json:1385 `lovejoin.launch.privacy.fromPrivate` and :1403 `lovejoin.launch.privacy.private`. "Not whose spend it was" is false with a copy, and loose already for money made private yourself.
   - `mint.privacy.fromPrivate`, `swaps.privacy.oneTime` and `dapps.privacy.oneTime` are true as written: a short `.privacy.` clause at most.
   - privacy.md:81, :356, :378, :454, README.md:193 and flows.md:356 are literally true; a caveat is optional.
   - Mention the restore case: after a restore every older UTxO is Unknown, so a copy arriving later is the only received UTxO and goes first.
   - New keys need `.privacy.` or `.warn.` names, and es and ja.

2. **Owner's design call, the only change that narrows what any d can reach:** rank a box back from Lovejoin ahead of received money for Purpose::Mint, and perhaps for Fund where one box pays, since no payer knows a box. mint_test.rs:2671 stays valid either way.

3. **The exact-copy check is optional and small in reach.**
   - Key each spendable UTxO by registerOf's hex, in readContract or activity.classes, and match it against view.seedelfs' Locator.register and the other rows of view.owned.
   - Rank a match last for Mint and Fund, give it its own UTxOs tag, and add a `.privacy.` or `.warn.` line on a review that spends one anyway.
   - Never word it as protection: it catches d = 1 only.
   - The wallet's own outputs never repeat a register (build.rs:336, pinned by api_test.rs:1941). The CLI's `util mint -g -p` (r4#8) can, so mind matches between owned rows.

4. **Group it.**
   - The funding half duplicates e1a#1's family (c).
   - Fix the words together with x1a#2 (the same register-as-found class, cip30.rs:1386) and gap-g1#2 (site-signed payments of the wallet's own classed as received).
   - Correct the finder's "every session funding": the copy must pay the whole funding alone and be the smallest received UTxO that does.

5. **Test.** The trace verifier's tests/r51-gap-g1-1.test.ts has two received UTxOs and no box, so it passes only with the exact-copy check. Under words only, or a box-first rank, replace it with tests that pin the new words and the new rank.

All of this changes a privacy default, a screen's tags and privacy words, so it needs the owner.
