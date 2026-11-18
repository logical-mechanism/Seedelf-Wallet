# gap-g9#1: verification

From lane gap-G9, graded medium by its finder.

## Trace: confirmed, medium

The finding holds as described, and a run confirms it. Profile A's arrived() treats any new contract UTxO whose transaction isn't in A's own sealed history as a payment received. The only exception is the first reading (L38). So the change C from profile B's session funding F_B is recorded on A as kind "received", classed received:<F_B>, titled "Received" in Activity and the CSV, and tagged "Received" on the UTxOs screen.

A's next session funding (Purpose::Fund) ranks C at 1, ahead of A's own O at 4. It spends C alone, which ties the new session to B's on chain, and the review shows no note.

A control in the same test shows the contrast. One device that sent F_B itself classes C as public:0+session:7 (session money) and funds the new session from O instead.

I found no guard the finder missed:
- contract-scan drops the spender (`by`) that the index gives.
- noteLanded (the M7 fix) covers only this profile's own returns.
- Lovejoin writes box-backs only for this profile's own withdraws.
- The sessions scan runs only after a restore or on Find leftovers, and writes the sessions book, not the history.
- The coin filter applies only the user's locks.

The code is the same at web-wallet/1.9.1. Medium: it is a privacy link made by default by an ordinary action. Keeping the phrase in a second profile is a setup privacy.md:349-350 contemplates. The link is the one privacy.md:170-171 promises to avoid or name, and M7, its one-device form, was graded medium. Activity and the CSV also list the user's own change as a 394.6 ₳ receipt. No money is lost or misdirected, so it is not high.

**Evidence:**

TREE at b9f7e755. Its source equals cd764fba, and `git diff --stat web-wallet/1.9.1 HEAD` over extension/src, core/src and wasm/src shows only manifest.ts, so the code is the same at the tag.

**Trace, from where the input enters to the outcome**

1. **Profile B.** buildFunding (sessions.ts:3071) sends `funding: { session: sessionClass(index).id }`. B's summary gives the change the origin `merged([changeHistory(seen, inputs), sessionClass(index)])` (sessions.ts:3093). activity.sent (activity.ts:334-375) writes that into B's own sealed `history.<network>` (activity.ts:278, :627-642: the PrivateStore of that profile). A never sees the entry.
2. **Profile A reads the chain.**
   - BalanceService.read and readPrivate call `this.deps.activity?.arrived(network, view.owned)` (balances.ts:399, :278).
   - On mainnet the index's `since` answer carries each spent row's spender (private-index.ts:44 `spent?: IndexPoint & { by: string }`, :52 `by: string`). readIndexView keeps only the refs (contract-scan.ts:300 `const gone = new Set([...changes.spent.map((s) => s.ref), ...])`, and :305 the same). ContractView holds only `owned` and `seedelfs` (:63-72).
   - On Koios, a catch-up read keeps rows spent elsewhere until the next full read (contract-scan.ts:146-166).
3. **arrived()** (activity.ts:427-470):
   - `ours` holds the tx hashes of A's own non-received entries (:431). C is fresh (:432), F_B isn't in `ours`, and C holds no Seedelf token (:441), so the entry gets `kind: "received"` (:445).
   - `origin: UNKNOWN` is set only when `h.first && before(u)` (:449). `first` disappears after the first reading, because the update returns only `{entries, seen}` (:466-469).
4. **classes()** (activity.ts:389-419) calls classOf, which hits `case "received": return receivedIn(entry.txHash)` (:656-657). That gives origin "received" (shared/histories.ts:39). classesOf keeps it (script-spend.ts:267-273).
5. **Selection** (build.rs):
   - Fund ranks Received 1, Lovejoin 2, Unknown 3, Own 4, Session 5 (:2401-2411). Mint ranks Received 0 and Session 4 (:2394-2399). Tier: Lovejoin 2, another session's money 1 (:2419-2425).
   - apart's step 1 uses one_more, which sorts by `(rank(u), lovelace_of(u))` and returns the first choice that builds (:2603-2628, :2709-2712). So C is taken alone.
6. **Review.**
   - spentHistories returns `all.slice(0, 1)`, giving [received:F_B] (script-spend.ts:201-205).
   - historiesNote adds no "together" sentence for one class (histories.ts:193). The session sentence appears only when another session is named (:216-218). HistoriesNote renders nothing (HistoriesNote.tsx:24-25, used at Swaps.tsx:1415 with `session={summary.index}`).
   - activityTitle gives "Received" (ui/activity.ts:27-32). Its comment limits "another profile" to the first reading. activityCsv's type column is activityTitle (ui/activity.ts:213-240). historyTags gives "Received" (histories.ts:119-135).

**Guards looked for and not found**

- noteLanded (sessions.ts:5106-5114) writes only this profile's own returns. Its comment states the harm: "what it brought back would read as money received, which a funding or a mint takes first, tying the sessions together."
- lovejoin.ts:7740 and :7855 write box-backs only for this profile's own withdraws.
- coin-control.ts:259-262 filters only the user's locks.
- The sessions scan runs only after a restore or on Find leftovers (sessions.ts:2744-2762). It writes the sessions book, never the history that classes() reads.

**Promises it breaks**

- privacy.md:169: "A spend's change keeps its inputs' histories".
- privacy.md:170: "a session's funding takes ... another session's money last".
- privacy.md:171: "A funding also names money another session left".
- privacy.md:173 covers another browser's first reading only.
- flows.md:110: "the wallet's own change ... don't count".

**Ran:** from extension/, `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g9-1.test.ts`. Output is in test_result.
- The control passed: one device's C is public:0+session:7, and its funding spends O, a6…#0.
- Profile A failed on all four assertions: C is titled Received, classed received:fb…, tagged Received, and the funding spends fb…#2 with histories [received:fb…] and no note.

**Traced, not run**

- **Stealth mint.** Mint ranks Received 0, so on A it takes C ahead of A's own O (Own 3), when C is the smallest received money that pays alone.
- **B's box-backs.** On A they read as received. Pay tiers them 0, not 2. The note counts them as payments received and never adds en.json:756-757's Lovejoin clause, because historiesNote counts only `box:` parts (histories.ts:184-185, :210).

**Small imprecisions in the finding (none changes the verdict)**

- "Every private transaction" means every one that leaves a contract output holding no Seedelf token (activity.ts:441).
- The Lovejoin sentence in en.json reads "undoes some of what Lovejoin did for the boxes", not "largely undoes the mix".

**Known:** Not known; nothing in the brief's lists covers it.

What I searched:
- backlog.md: every line with "received", plus every browser/profile/device line with history, class, selection or activity words. No hit.
- archive/plans/*.md: "another browser/profile", "two profiles/browsers", "same phrase", "other/second device", "as received", "read as received", "noted as received". I also read every Not fixed / Left open / Disputed / For the owner section for history, received, class, profile and browser words.

The nearest items, all fixed and all narrower:
- independent-review M7 and F3: one device's own return read as received, and fundings took it first. M7 was graded medium.
- independent-review L38: covers the first reading only.
- independent-review M13: freshIndex across profiles.
- privacy.md:173 speaks of the first reading only.

Partly acknowledged, but outside the lists:
- tests/history-classes.test.ts:127-129's comment says another profile's move-in is "noted arriving" on the private side. The test only checks that public Activity names it correctly.
- This review's G1 note (lanes/gap-G1.md:104, :156) raises the Make-private-in-another-browser case for the owner, as wording.

Same root: gap-g1#2.

**Fix notes:**

**The finder's sketch fixes the label, not the link.** It would class such an arrival as Unknown. But Purpose::Fund ranks Unknown 3, ahead of Own 4 (build.rs:2401-2411). And spentHistories returns nothing for a lone Unknown class (script-spend.ts:201-205). So A's funding would still spend C first and still say nothing, and this test's last assertion would keep failing.

**A fix that closes the link:**
- **Mainnet.** Keep the index's spenders: `since.spent[].by` and `created[].spent.by` (private-index.ts:44, :52), which contract-scan.ts:300/:305 now drops. Hand them to arrived(). An arrival whose transaction spent one of the wallet's own rows then takes those rows' merged history, as privacy.md:169 says a spend's change does. Add a part marking it as sent elsewhere, which Fund ranks last (tier 1, like another session's money, since such a spend may have funded a session) and the review names.
- **Box-backs.** An arrival whose transaction spent one of the wallet's pool boxes is boxFrom(tx).
- **Koios** gives no spender. A catch-up reading notes C before the next full read sees U go (contract-scan.ts:146-166). So a Koios-side fix must class a reading's arrivals when an owned row this device didn't spend vanishes, and also revisit the arrivals noted since the last full read.

**The same root, one fix:** arrived() takes everything not in this profile's history as received. That covers:
- gap-g1#2: site-signed own payments.
- G1's note: Make private in another browser.
- this finding: the other profile's fundings, returns, Send change and box-backs.

**Docs.** privacy.md:173 and :349-350 should say what another profile's later transactions read as here.

**For the owner.** It needs their call: it changes selection order (a privacy default), how Activity and the CSV name these rows, and privacy.md's wording.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g9-1.test.ts`

Result: Ran from extension/ with `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g9-1.test.ts`. The test FAILS on TREE, as expected. The control's hard expects passed; the four bug assertions failed.

```
[r51 gap-g9#1] one device: F_B in Activity {"kind":"session-out","title":"Into a private session","lovelace":"105000000"}; C classed {"id":"public:0+session:7","origin":"session"}, tagged ["Made private","Private session 8"]
[r51 gap-g9#1] one device: session 0's funding spends ["a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6#0"]; histories [{"id":"public:0","origin":"own"}], note undefined
[r51 gap-g9#1] profile A: F_B in Activity {"kind":"received","title":"Received","lovelace":"394600000"}; C classed {"id":"received:fbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfb","origin":"received"}, tagged ["Received"]
[r51 gap-g9#1] profile A: session 0's funding spends ["fbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfb#2"]; histories [{"id":"received:fbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfb","origin":"received"}], note undefined
 ❯ tests/r51-gap-g9-1.test.ts (1 test | 1 failed) 10665ms
 FAIL ... AssertionError: Activity doesn't call the other profile's change a payment received: expected 'Received' not to be 'Received' // Object.is equality
 FAIL ... AssertionError: C isn't classed as money someone else paid: expected 'received' not to be 'received' // Object.is equality
 FAIL ... AssertionError: the UTxOs screen doesn't tag it Received: expected [ 'Received' ] to not include 'Received'
 FAIL ... AssertionError: the funding doesn't spend the other profile's session change ahead of O with no note: expected true to be false // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

```
// Chunk 51, finding gap-g9#1 (its trace verifier's test). The phrase is open in two Chrome profiles, as privacy.md's
// "A separate Chrome profile keeps cookies apart" suggests for sites. Profile A (this one) made 500 ₳ (U) and 60 ₳
// (O) private from public account 0. Profile B, with no history of A's, funds a private session from U: its funding
// F_B pays the one-time account and returns its change C (394.6 ₳) to the contract under a fresh register. On B, C is
// that session's money. On A, the next reading finds U gone and C new; F_B isn't in A's sealed history, so `arrived`
// notes C as a payment received (activity.ts:441-450, no origin past the first reading) and `classes` gives it
// received:<F_B> (activity.ts:656-657), origin "received" ("Paid by someone else", build.rs Origin::Received). Activity
// titles it Received (and Save as CSV exports it so), the UTxOs screen tags it Received, and a new session's funding
// on A, Purpose::Fund, ranks it 1 ahead of A's own O at 4 (build.rs:2401-2411; one_more, smallest of the best rank
// first, build.rs:2603-2628): it spends C, tying the new session to B's on chain, and its review has no note
// (spentHistories gives one class, historiesNote says nothing for one). One device holding both, whose history has
// F_B as its own session's funding, classes C as that session's money (rank 5) and takes O: privacy.md's Co-spending
// says "a session's funding takes ... another session's money last". The control below shows that. This asserts the
// right behaviour, so it fails while the bug is there.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { registerOf } from "../src/background/chain";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_OUT } from "../src/background/sessions";
import { historiesNote, historyTags, madePrivate, merged, sessionClass } from "../src/shared/histories";
import type { PendingTx } from "../src/shared/rpc";
import { activityTitle } from "../src/ui/activity";
import { busyFor, minswapEstimate, ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;
const hexOf = (b: Uint8Array) => Buffer.from(b).toString("hex");
const [M1, M2, FB] = ["a5", "a6", "fb"].map((h) => h.repeat(32)) as [string, string, string];
/** The other profile's session, as its own book numbers it. */
const B_SESSION = 7;

/**
 * Profile A's view after the other profile's funding F_B: U (M1#0) spent by it, its change C (FB#2) new, O (M2#0)
 * untouched; then a private swap's funding built here. `sentHere`: F_B is in this profile's history, as on one device.
 */
async function profileA(sentHere: boolean) {
  const t = testBalances({ owned: false });
  await t.wallet.create(PHRASE, PASSWORD);
  const { wasm } = t.deps;
  // Every output of the wallet goes under a fresh re-randomization of its register, in either profile.
  const base = registerOf(ownedUtxos[0]!)!;
  const fresh = () => hexOf(wasm.registerToDatum(wasm.rerandomize(new wasm.Register(base.generator, base.publicValue))));
  const row = (txHash: string, txIndex: number, lovelace: string, height: number, time: number): KoiosUtxo => ({
    ...ownedUtxos[0]!,
    tx_hash: txHash,
    tx_index: txIndex,
    value: lovelace,
    asset_list: [],
    inline_datum: { bytes: fresh(), value: null },
    block_height: height,
    block_time: time,
  });
  const sent = (kind: PendingTx["kind"], txHash: string): PendingTx => ({ kind, network: "preprod", txHash, submittedAt: t.clock.now, confirmations: null });

  // 500 ₳ and 60 ₳ made private from public account 0: this profile's history has both move-ins.
  await t.activity.sent("preprod", sent("move-in", M1), { lovelace: "500000000", origin: madePrivate(0) });
  await t.activity.sent("preprod", sent("move-in", M2), { lovelace: "60000000", origin: madePrivate(0) });
  const began = Math.floor(t.clock.now / 1000);
  const U = row(M1, 0, "500000000", 9_000_001, began + 20);
  const O = row(M2, 0, "60000000", 9_000_002, began + 40);
  t.koios.added.push(U, O);
  await t.balances.get("preprod");
  const own = await t.activity.classes("preprod", [U, O]);
  expect([...own.values()]).toEqual([madePrivate(0), madePrivate(0)]);

  // F_B funds a site's private session from U and returns its change C to the contract. One device that sent it
  // wrote it down as that session's funding (sessions.ts buildFunding's summary: its change carries U's history).
  if (sentHere) {
    await t.activity.sent("preprod", sent("session-out", FB), {
      index: B_SESSION,
      lovelace: "105000000",
      origin: merged([madePrivate(0), sessionClass(B_SESSION)]),
    });
  }
  // The next reading, a full one (a Koios catch-up shows a spend made elsewhere only at the next full read): U is
  // gone and C is new.
  t.koios.spent.add(`${M1}#0`);
  const C = row(FB, 2, "394600000", 9_000_010, began + 900);
  t.koios.added.push(C);
  await busyFor(t, 31 * 60_000);
  await t.balances.get("preprod", true);
  const { seedelf: rows } = await t.coins.lists("preprod");
  expect(rows.some((u) => u.txHash === M1)).toBe(false);
  expect(rows.some((u) => u.txHash === M2 && u.index === 0)).toBe(true);
  const cRow = rows.find((u) => u.txHash === FB && u.index === 2);
  expect(cRow).toBeDefined();
  const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === FB);
  const cClass = (await t.activity.classes("preprod", [O, C])).get(`${FB}#2`);

  // A private swap here: a new session's funding (Purpose::Fund), which one UTxO pays alone.
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  const quote = await t.sessions.quote("preprod", minswapEstimate.ask);
  const out = await t.sessions.outBuild("preprod", quote);
  const kept = (await t.session.get<{ txCbor: string }>(SESSION_OUT))!;
  const inputs = txInputs(Uint8Array.from(Buffer.from(kept.txCbor, "hex")));
  // As the swap's review shows it (Swaps.tsx HistoriesNote).
  const note = historiesNote(out.histories, { session: out.index });
  const label = sentHere ? "one device" : "profile A";
  console.log(
    `[r51 gap-g9#1] ${label}: F_B in Activity ${JSON.stringify(entry && { kind: entry.kind, title: activityTitle(entry), lovelace: entry.lovelace })}; ` +
      `C classed ${JSON.stringify(cClass)}, tagged ${JSON.stringify(cRow?.history && historyTags(cRow.history))}`,
  );
  console.log(`[r51 gap-g9#1] ${label}: session ${out.index}'s funding spends ${JSON.stringify(inputs)}; histories ${JSON.stringify(out.histories)}, note ${JSON.stringify(note)}`);
  return { entry, cClass, cRow, inputs, note };
}

describe("the phrase open in a second profile (chunk 51, gap-g9#1)", () => {
  it("never reads that profile's own session change as a payment received, nor funds a new session from it silently", { timeout: 180_000 }, async () => {
    // The control: one device holding the same UTxOs, which sent F_B itself, funds the new session from O.
    const oneDevice = await profileA(true);
    expect(oneDevice.cClass).toEqual({ id: `public:0+session:${B_SESSION}`, origin: "session" });
    expect(oneDevice.inputs).toEqual([`${M2}#0`]);

    const here = await profileA(false);
    // C is no one else's payment: the phrase's own change, sent from the other profile.
    expect.soft(here.entry && activityTitle(here.entry), "Activity doesn't call the other profile's change a payment received").not.toBe("Received");
    expect.soft(here.cClass?.origin, "C isn't classed as money someone else paid").not.toBe("received");
    expect.soft(here.cRow?.history && historyTags(here.cRow.history), "the UTxOs screen doesn't tag it Received").not.toContain("Received");
    // So the funding doesn't silently tie this session to the other profile's: it takes the money made private here,
    // as the one device does, or its review says what spending C ties.
    const tiesSilently = here.inputs.includes(`${FB}#2`) && here.note === undefined;
    expect.soft(tiesSilently, "the funding doesn't spend the other profile's session change ahead of O with no note").toBe(false);
  });
});
```

## Impact: partly, low

The mechanism is real. With the phrase in two profiles, each profile reads the other's private transactions (funding change, returns, box-backs, a Send's change) as payments received. Its fundings and the stealth mint then rank that money first, and its reviews say nothing. But the harm is narrower than claimed:
- Only the user can cause it, and only with a setup that isn't the default: the same phrase in two profiles, with private transactions on both.
- No ADA moves wrongly.
- The finder's own example makes no new link. U and O were both made private from account 0, so S_B reaches account 0 through U. On one device, S_A would reach account 0 through O. The site that saw S_B can follow account 0's other made-private output O to S_A either way.
- A link that one device wouldn't make appears only in one case: the profile that spends holds unlinked money (others' payments that pay alone, or a box big enough to pay alone, which mainnet's 5 ₳ ADA boxes rarely are), and the misread UTxO undercuts or outranks it. The same applies to a private-balance mint, which isn't the default.
- Box-backs that A merges still get a merge warning. Only the "undoes Lovejoin" clause is missing.
- The Activity and CSV labels are wrong in this device's own records, but the balance is right.
- The sibling gap-g1#2 has the same root, the same actor and the same "lands only when an unlinked UTxO would otherwise pay" condition. It was verified low.

Not known, and no owner rule settles it.

**Evidence:**

TREE is at b9f7e755. The commits since cd764fba are docs only, so the code is 1.9.1's.

**The mechanism holds (traced):**
- **Arrival read as received.** activity.ts:431 `ours` holds only this device's non-received entries. :445 makes every other fresh owned UTxO `kind: "received"`. :449 gives origin Unknown only on the history's first reading.
- **Class.** classOf (:656) gives `receivedIn(tx)`.
- **Ranks.** build.rs:2401 Fund: Received 1, Lovejoin 2, Unknown 3, Own 4, Session 5. :2394 Mint: Received 0, Lovejoin 1, Unknown 2, Own 3, Session 4.
- **Pick.** :2608 one_more sorts by `(rank, lovelace)`, smallest first.
- **No note.** histories.ts:193 notes a merge only for more than one class. :216 names a session only when a spent class has a `session:` part. So A's funding review is silent, where one device would say en.json:760's "It spends money that Private session N left…".
- **Pinned by design.** tests/history-classes.test.ts:46-57 pins later arrivals as received. That's right for a stranger's payment on one device.

**The finder's example makes no new link:**
- In the example, U and O are both public:0 on A.
- On one device, F_A takes O (Own 4 before Session 5), so S_A traces to account 0's Make private. S_B traces there through U.
- privacy.md treats both as links: :98 (Make private links the account to what it creates), :174's last sentence (a session funded from money you made private traces back to your public account), :356 and :378. So does the connect window, en.json:469 ("money you made private leads back to your public account").
- So both sessions are account 0's whichever UTxO F_A spends. The site that saw S_B reaches account 0 through U, and can follow account 0's other made-private output O forward to F_A and S_A. The direct chain F_B to C to F_A tells nobody anything new.
- The mint in the example is the same: O (Own 3) or C (misread, Received 0) both lead to account 0. On one device, a mint from a single own class gets no note either (classes.length is 1).

**Where a new link does appear (narrow):**
- **Others' payments.** The misread C ties with them at Fund rank 1 and is taken only when it's the smallest that pays alone. Then S_A ties to S_B and to whatever F_B spent, where one device would have used the stranger's money.
- **Boxes.** These are always outranked (2 against 1). But mainnet's ADA pool is 5 ₳ a box (architecture.md:748), so a single ADA box rarely funds a session alone. One device would then fall back to own money (Own 4), which leads to account 0 anyway.
- **Private-balance mint.** It's the default only when the public account is empty (privacy.md:80). There C can tie the new Seedelf to S_B, under mint.privacy.fromPrivate.

**Box-backs:**
- On A, Send ranks received money 2, after Own 0 and Session 1 (build.rs:2387).
- A merge still shows en.json:762: "Anyone can see they're one owner's, which ties them to each other". Only the ", and undoes some of what Lovejoin did" clause (:756-757) is missing. So there is a warning, just a less specific one.

**Activity and CSV:** these are per-device records (flows.md:110: "what this wallet sent… and what arrived"). The private balance is right. The wrong "Received" label is a records error, not money.

**Actor and cost:**
- Only the user can cause it. The setup is endorsed: privacy.md:349-350, en.json:469, and privacy review §5.7 ("restoring the phrase there is safe, because freshIndex keeps session indexes apart"). But it's still a two-profile setup with private transactions on both.
- No stranger or site can cause it, and no ADA moves wrongly.
- Ways out:
  - Lock the UTxO by hand (privacy.md:172), though the "Received" tag hides why it should be locked.
  - Keep private spends to one profile.
  - Mix first.
- A link once made is permanent.

**Precedent:**
- gap-g1#2 has the same root (arrived() takes anything this device didn't record as received). It's user-caused, with a setup that isn't the default, and harm only when an unlinked UTxO would otherwise pay. It was verified "confirmed, low" (verify/gap-g1-2.md).
- Independent review M7 was medium, but it was the same symptom on one device with no setup at all.
- chunk-34-token-pools.md:595 grades a two-device leftover "Left, low, two devices only".

**Owner's rules:** none settles it. A fix adds no refusal and makes the default more private.

**What holds in the docs:** privacy.md:171 ("A funding also names money another session left") and :173 (the other browser's caveat covers only the first reading) don't say what the other profile's later transactions read as here.

Read only. No command run but cat, sed, grep and git log.

**Known:** Not known; no reference. What I searched:
- **backlog.md** for another browser, profile, device and received. Its only other-browser lines are :122 (C18, a session another browser brought back stays open) and :153 (lookUp's wording). Neither is this.
- **docs/archive/plans/*.md.** independent-review M7 and F3 are an own return read as received on one device, fixed. L38 is the first reading after a restore. M13 is the two-profile index race. privacy-review §5.7 covers two profiles for indexes only. chunk-26b/26 cover another device's spends in the view. chunk-34:595 is two devices, Bootstrap entries.
- **SECURITY.md.**
- **This chunk's lanes.** gap-G1's Notes raise only the narrower case of money made private in another browser, as a wording item for the owner. The critic's line 119 names two-profile timing rules (G9#2's subject), not history classes.

**Fix notes:**

The finder's direction is right, and it's one root with gap-g1#2 and G1's note: arrived() takes as received anything this device didn't record. Fix it once for the whole family.

**Mainnet:**
- Keep the private index's spenders: `since.spent[].by`, which contract-scan.ts:300 drops today.
- An arrival whose transaction spent one of the wallet's own rows is the phrase's own spend made elsewhere. Note it as never received, and give it its own Unknown class (unknownIn), titled so in Activity and left out of the CSV's receipts.
- An arrival whose transaction spent one of the wallet's pool boxes is boxFrom(tx).

**One caveat on "Unknown":**
- Fund ranks Unknown 3, before Own 4, and Mint ranks Unknown 2, before Own 3. So the finder's own example would still take C. That's harmless there, since both choices lead to account 0.
- It does fix the harmful case: Unknown comes after others' payments (1) and boxes (2).
- Matching one device exactly would need such arrivals ranked with another session's money (Fund 5, tier 1).

**Koios:** only the finder's heuristic is open. In a reading where an owned UTxO vanished that this device didn't spend, class that reading's arrivals Unknown.

**Docs, whatever the code does:** privacy.md:173 and :349-350 should say it in one short line. With the phrase in two profiles, each reads the other's private transactions as payments received. So its selection order and its notes can't keep them apart.

It needs the owner: the fix changes a selection default, the Activity and UTxOs labels, and privacy.md's wording. Write it from a reproduction, not the finder's text: a Vitest with two services on one phrase, where one's funding change arrives at the other, and the other's next funding takes it alone with spentHistories [received:<tx>] and historiesNote undefined.

## Severity tiebreak: low

The bug is real, but on the brief's scale it is a small cost in an edge case, not a privacy link made by default. I checked in TREE:
- arrived() records anything this profile didn't record itself as received; the Unknown origin applies only to the first reading (activity.ts:431-450).
- Fund ranks Received 1 ahead of Own 4 and Session 5 (build.rs:2401-2411).
- one_more takes the smallest UTxO of the best rank that pays alone (build.rs:2608).
- With one class, spentHistories and historiesNote show no note.
- privacy.md:173 covers only another browser's first reading.

Why low:
- Who and what's lost: only the user can cause it, by keeping the phrase in two Chrome profiles with private transactions on both. No stranger or site can trigger it, no ADA moves wrongly, and the balance stays right.
- The setup is the wallet's own advice (privacy.md:349-350; the connect window, en.json:469, says "Another Chrome profile and a VPN avoid that"). That puts this at the top of low, but the setup is still not the default.
- No new link in the finding's own scenario. U and O were both made private from account 0, and privacy.md:98 and :174, and en.json:469, already admit that a session funded from such money leads back to the public account. So S_A and S_B are known to be one owner's whichever UTxO F_A spends. One device would spend O and leave the same trace to account 0, also with no note (one own class).
- A new link appears only when this profile also holds unlinked money that the misread UTxO beats:
  - another person's payment, when the misread UTxO is smaller and pays alone (both rank 1 for a funding);
  - Unknown money, or money made private from another account the user keeps apart, which it outranks;
  - for the stealth mint, another person's payment it undercuts. Paying the mint from the private balance isn't the default unless the public account is empty (CreateSeedelf.tsx:64).
- Lovejoin boxes: mainnet's 5 ₳ boxes can't pay a funding alone, so one device would also spend the other session's money alone there. What's lost is the note naming that session.
- The "Received" rows in Activity and the CSV are this profile's own records with the right amounts. The label is wrong, not the figure.
- Ways out: keep private spends to one profile, mix first, or lock the UTxO by hand. The "Received" tag does hide why it should be locked.
- This matches gap-g1#2: same root, harm only when an unlinked UTxO would otherwise pay, verified low. M7 was medium because it hit one device with no setup at all.

**Decisive point:** In the finding's own scenario, F_B → C → F_A tells an observer nothing new. Both sessions are funded from money made private from account 0, and privacy.md:98 and :174 (and the connect window, en.json:469) already admit that each one leads back to that account. One device would spend O and leave the same trace. A link one device wouldn't make, and that goes unwarned, needs this profile to also hold unlinked money that the misread UTxO beats on rank or size (another person's payment it undercuts, or another account's money it outranks). That is an edge case on top of a two-profile setup that isn't the default, the same condition gap-g1#2 was graded low on.

**Fix notes:**

Fix the root once for gap-g1#2, G1's note and this finding: arrived() (activity.ts:431-450) records anything this profile didn't send itself as "received".

Mainnet:
- contract-scan.ts:300 and :305 drop the index's spenders (`since.spent[].by`, `created[].spent.by`, private-index.ts:44 and :52). Keep them and hand them to arrived().
- An arrival whose transaction spent one of the wallet's own rows is the phrase's own spend made in the other profile. Give it the merged history of the rows it spent, as privacy.md:169 says a spend's change does, plus a part marking it as spent elsewhere. Rank that part like another session's money (Fund rank 5, tier 1) so the review names it.
- Plain Unknown is not enough. Fund ranks Unknown 3, ahead of Own 4, and spentHistories (script-spend.ts:201-205) returns nothing for a lone Unknown class, so the trace test's last assertion would still fail.
- An arrival whose transaction spent one of the wallet's pool boxes is boxFrom(tx).

Koios gives no spender. A catch-up reading keeps rows spent elsewhere until the next full read (contract-scan.ts:146-166). So a fix there must class a reading's arrivals as not received when an owned row this profile didn't spend vanishes, and revisit the arrivals noted since the last full read.

Activity and the CSV should stop titling these rows Received and counting them as receipts.

Whatever the code does, privacy.md:173 and :349-350, and flows.md:110 ("the wallet's own change … don't count"), should say in one short line what the other profile's later transactions read as here.

Needs the owner: the fix changes a selection default, the Activity, CSV and UTxOs labels, and privacy.md's wording.

Tests:
- Keep the trace verifier's test, extension/tests/r51-gap-g9-1.test.ts, as the regression base.
- Add the case where the harm is real: this profile also holds another person's payment R that is larger than C and pays alone. Assert that the funding takes R, and that a private-balance mint does too.
- Write the fix from the reproduction, not from the finder's sketch.
