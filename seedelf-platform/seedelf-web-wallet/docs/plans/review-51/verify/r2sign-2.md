# r2sign#2: verification

From lane R2sign, graded low by its finder.
Also reported as r2still#1.

## Trace: confirmed, low

The finding holds as described. A site's 674 map with "msg" twice is something the ledger's own decoder accepts, and it keeps both pairs (I checked this offline with cardano-cli 11.0.0.0). The body's auxiliary data hash commits to both, so signing publishes both. In the sign window, the note box shows only the first msg (cip30.rs note_of). x1a#3's check (dapp.ts moreThanNote) counts every "msg" that holds text lines as part of that note, so otherMetadata stays unset. The window then says nothing about the second message.

I found no guard the finder missed. readTx, ties() and SignTx all pass the summary through unchanged. The only way to see the second msg is the window's own Transaction details, which lists label 674's whole map.

My test, run through the real worker, WebAssembly and SignTx, fails today on its last assertion only, on both builds. In a private copy I added a one-line fix to moreThanNote, and the test then passed on both builds while x1a#3's four cases still passed.

Two corrections to the reports. First, R2still's variant (a second top-level 674 label) is refused by the ledger's decoder, so only the repeated key inside the map can reach the chain. Second, the claim that explorers show the second msg (Aeson's last-wins) is still reasoned and wasn't run. cardano-cli's view lists both pairs, so it can't show this either way.

Grade: low.
- **Who:** any connected site whose signTx the user opens.
- **Cost:** no money moves. A message the window hid is published under the user's signature for good.
- **Way out:** Transaction details shows both entries, and Decline is there.
- **Privacy:** no link that privacy.md denies is made, since the site already knows whatever it writes.

It isn't known. G5's named owner gap (the note isn't checked against the body's auxiliary_data_hash) is wider, but this one holds with a matching hash, so fixing G5's gap won't close it.

**Evidence:**

All paths below are in FIXTREE (/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes, HEAD 853d5779). `git diff HEAD` shows no change to any of the cited source files, so the working copy equals HEAD for them. Only lovejoin.ts and some tests are being edited by others.

**1. Entry.** A site calls signTx.
- dapp.ts:627 calls signTx (:2207).
- That calls readTx (:2084).
- readTx calls wasm.inspectDappTx, or inspectSessionTx for a session (:2124-2130).

**2. The note in WebAssembly.**
- cip30.rs:1690-1693: `let (metadata, note) = match &tx.auxiliary_data { Nullable::Some(aux) => note_of(aux), ... }`.
- note_of (cip30.rs:913-946) takes `.find(|(label, _)| *label == 674)` and then `fields.iter().find_map(...)`. Only the first "msg" whose value is a list or a text becomes `note`.
- Pallas 0.35.1's `Metadatum::Map(KeyValuePairs<..>)` decodes into a Vec (pallas-codec utils.rs:138-157), so duplicates are kept.
- decode.rs's note_of (:1678-1699) behaves the same way. decode.rs's metadatum() (:1651-1673) lists every entry.

**3. x1a#3's check.**
- dapp.ts:2162: `if (summary.metadata && summary.note && this.besideNote(...)) summary = {...summary, otherMetadata: true}`.
- besideNote (:2172) calls `moreThanNote(decodeTx(...).metadata)`.
- moreThanNote (:2996-3004) is `label !== "674" || value.type !== "map" || value.entries.some(({key, value: v}) => !(key.type==="text" && key.text==="msg" && lines(v)))`. Two msg entries holding text lines both pass, so it returns false.

**4. Worker to window.**
- ties() (dapp.ts:2454-2459) spreads `...summary`, and ask carries `summary: ties?.summary ?? summary` (:2243).
- DappApprovals.tsx:348 renders `<SignTx summary={current.summary}>`.
- In SignTx: :1099 `if (s.metadata && !s.note)` is false, :1102 `if (s.note && s.otherMetadata)` is false, and :1104 with :1306-1311 shows `s.note.join("\n")`, which is the first msg only.
- The way out is TxDetailButton (:1358). Its TxDetail.tsx:686-700 lists every label's tree.

**5. The ledger, offline.** I built Conway transactions with `python3 -I mk_txs.py` (in SCRATCH/r51/work/verify-r2sign_2-trace/) and read each with `cardano-cli 11.0.0.0 (rev 97036a66) debug transaction view` under systemd-run MemoryMax=4G:
- `{674:{"msg":[A],"msg":[B]}}` decodes, as `"674": [["msg",["Thanks for order 77"]],["msg",["I agree to pay 500 ADA"]]]`.
- The one-text form `{"msg":A,"msg":B}` decodes too.
- `{674:{msg:[A]}, 674:{msg:[B]}}` is refused: `DeserialiseFailure 186 "Final number of elements: 1 does not match the total count that was decoded: 2"`.

**6. The test.** tests/r51-r2sign-2.test.ts goes through the real worker (testBalances, DappService), the real WebAssembly and SignTx. Every precondition passes:
- decodeTx shows metadataHashMatches true, labels ["674"], keys ["msg","msg"], and the second entry holds SECOND.
- The summary is {metadata:true, complete:true}.
- The page holds "Its note, which anyone can read Thanks for order 77".

The last assertion fails on both builds. The page reads: "Total leaving your public account 10 ₳ Network fee 0.17 ₳, counted in the total Expires Never It signs for 1 of your addresses Pays addr_test1qzus… An address 4 ₳ Its note, which anyone can read Thanks for order 77 Signing ties this transaction to your public account. Transaction details".

**7. Fix shown, in a copy.** The copy was $HOME/.cache/seedelf-review-51/verify-r2sign_2-trace, rsync'd with HEAD's lovejoin.ts restored and node_modules symlinked. It has since been removed.
- Unfixed, the test failed there too.
- With `|| value.entries.filter(({ key }) => key.type === "text" && key.text === "msg").length > 1` added to moreThanNote, the test passed: "Tests 1 passed (1)" on the default build and under VITE_ENABLE_MAINNET=false.
- dapp-prompt.test.ts -t "x1a#3" gave "Tests 4 passed | 36 skipped".

**8. Since.** `git log -S moreThanNote` gives d9e015fb. note_of's first-msg read is fe8b7748 (chunk 15), which is in web-wallet/1.9.1.

**9. Known check.**
- docs/backlog.md has no hit for duplicate, repeated, msg or 674.
- In archive/plans/, the 674 hits are unrelated. chunk-17:215 is Minswap's extraData beside msg.
- owner-calls.md has only G5's hash-mismatch note (:55).
- fixes/G5.md:21 describes x1a#3's rule without the repeated key.
- verify/x1a-3.md has no duplicate case.
- verify/lead/weak-claims.md checked duplicate keys in value maps and body keys, not metadatum maps.
- INDEX.md:316 and :323 list this finding, merged with r2still#1, with no verdict yet.
- SECURITY.md doesn't apply: the site is in scope, and no data source has to lie.

**Known:** Not known. The searches:
- docs/backlog.md: duplicate, repeated, second msg, msg, 674. Nothing.
- docs/archive/plans/: duplicate key, repeated key, second/two msg, msg twice, 674. Only unrelated hits; chunk-17-transaction-view.md:215 is Minswap's extraData beside msg.
- review-51/owner-calls.md: only G5's separate note (2), that the window doesn't check the note against the body's metadata hash. That gap is wider, but this one holds with a matching hash.
- fixes/G5.md:21: x1a#3's rule is described without the repeated key.
- verify/x1a-3.md: no duplicate case.
- verify/lead/weak-claims.md: it checked duplicate keys only in value maps and body keys.
- INDEX.md:316 and :323 list r2sign#2 with r2still#1 merged into it, unverified.
- SECURITY.md: no out-of-scope item applies.
- Owner's rules: the fix adds no refusal and changes no default.

**Fix notes:**

**The fix (tested in a copy).** In moreThanNote (extension/src/background/dapp.ts:2996), count as the note only what the window shows: the first "msg" under 674. Any further "msg" entry counts as more. Append to the 674 clause:

`|| value.entries.filter(({ key }) => key.type === "text" && key.text === "msg").length > 1`

This also covers an empty first `"msg": []` placed in front of a real one. The window then shows its existing line, "It carries other metadata too, which anyone can read." There are no new words, so it doesn't need the owner. Put this test's case into dapp-prompt.test.ts's x1a#3 block.

**The fuller fix.** Have note_of collect every "msg" entry's lines in order, under the first 674, in both readers: wasm/src/cip30.rs:913 and wasm/src/decode.rs:1678. The sign window's note box, Transaction details' "Its note" and the swap's "Minswap's note on it" (Swaps.tsx:2725-2726, first msg only) would then agree, and moreThanNote's rule would hold as written. That changes what a screen shows, so give the owner a look.

**A repeated top-level 674 label needs no handling.** The ledger's decoder refuses it ("Final number of elements: 1 does not match the total count that was decoded: 2", cardano-cli 11.0.0.0), so it can never land.

**The class.** Two readers of the same bytes disagree on what is "shown". moreThanNote's model of the note (every msg) differs from note_of's (the first msg). This is x1a#3's family. The one other member is the Minswap swap review's note line, which also reads note_of's first msg, but there Minswap builds the transaction, not a site.

**Separate, and left alone.** G5's owner call: the window reads the note without checking it against the body's auxiliary_data_hash.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-web-wallet/extension/tests/r51-r2sign-2.test.ts`

Result: **In FIXTREE, the default build.** Run from extension/ as `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-r2sign-2.test.ts`. It fails as it should:

```
 ❯ tests/r51-r2sign-2.test.ts (1 test | 1 failed) 375ms
     × shows the second msg's lines, or says there's more metadata, which signing publishes as well 374ms
 FAIL  tests/r51-r2sign-2.test.ts > a site's note with a second msg (chunk 51, r2sign#2) > shows the second msg's lines, or says there's more metadata, which signing publishes as well
AssertionError: the window shows neither "I agree to pay 500 ADA" nor a line that there's more metadata. It shows: Total leaving your public account 10 ₳ Network fee 0.17 ₳, counted in the total Expires Never It signs for 1 of your addresses Pays addr_test1qzusjxwp8efe5hrwv47exayz69hl6hmceq08m4qy7zsh4ursn8tuec5rn73hspp8jhpz778rzqc20wksf8guk3z23asqwgfs5k An address 4 ₳ Its note, which anyone can read Thanks for order 77 Signing ties this transaction to your public account. Transaction details : expected false to be true
 ❯ tests/r51-r2sign-2.test.ts:105:7
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

**In FIXTREE, with VITE_ENABLE_MAINNET=false in front.** It fails the same way, with the same assertion and the same page text: "Test Files 1 failed (1) / Tests 1 failed (1)".

Every precondition before the last assertion passes in both runs: the metadata hash matches, the labels are ["674"], the keys are ["msg","msg"], the second entry holds SECOND, the summary has metadata:true and complete:true, and the page holds the note "Thanks for order 77".

**In a private copy, since removed.** With the one-line fix in moreThanNote:
- this test passed on both builds: "Test Files 1 passed (1) / Tests 1 passed (1)" twice;
- `dapp-prompt.test.ts -t "x1a#3"` gave "Tests 4 passed | 36 skipped (40)";
- without the fix, the copy failed the same way as FIXTREE.

```
// Chunk 51, r2sign#2 (r2still#1 is the same): a site's CIP-20 map under label 674 that holds "msg" twice. A metadatum
// map is a list of pairs on chain, so the ledger's decoder keeps both (cardano-cli 11.0.0.0 `debug transaction view`
// decodes it, both pairs listed), and the body's auxiliary data hash commits to both: signing publishes both, under the
// account's signature, for good. The sign window shows the first "msg" alone as the note (cip30.rs note_of), and
// x1a#3's check (dapp.ts moreThanNote) counts every "msg" of text lines as part of that note, so no line says there's
// more. Through the real worker and WebAssembly, as the window gets the request, and rendered as the window renders it.
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { i18n } from "../src/i18n/core";
import type { DappTxSummary, TxDetail } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { SignTx } from "../src/ui/screens/DappApprovals";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
/** The page's text, without its tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const render = (s: DappTxSummary) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(SignTx, { summary: s, partial: false, session: false, collateralSpent: false }),
    ),
  );

describe("a site's note with a second msg (chunk 51, r2sign#2)", () => {
  const signer = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const OWN = signer.preprod.receive_0 as string;
  const SITE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod
    .receive_0 as string;
  const INPUT = "11".repeat(32);
  /** A CBOR text string of fewer than 24 bytes. */
  const cborText = (s: string) => {
    const n = Buffer.byteLength(s, "utf8");
    if (n >= 24) throw new Error("a short text only");
    return `${(0x60 + n).toString(16)}${hex(s)}`;
  };
  const FIRST = "Thanks for order 77";
  const SECOND = "I agree to pay 500 ADA";
  /** {674: {"msg": [FIRST], "msg": [SECOND]}}. */
  const metadata = `a11902a2a2${cborText("msg")}81${cborText(FIRST)}${cborText("msg")}81${cborText(SECOND)}`;
  const LINE = () => i18n.t("dappUi.note.privacy.otherMetadata");
  const METADATA = () => i18n.t("dappUi.note.metadata");

  /** A site's transaction: the account's 10 ₳ pays it 4 ₳, with `metadata` and its hash in the body (key 7). */
  const withMetadata = (aux: string) => {
    const wasm = loadTestWasm();
    const digest = bytesToHex(blake2b(Buffer.from(aux, "hex"), { dkLen: 32 }));
    const body = `a40081825820${INPUT}00018182${`5839${wasm.cip30Address(SITE)}`}1a003d0900021a00029810075820${digest}`;
    return `84${body}a0f5${aux}`;
  };

  async function until(check: () => boolean) {
    for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
    expect(check()).toBe(true);
  }

  /** The worker's request for a site's `txCbor`, spending the account's 10 ₳, and the window's words for it. */
  async function signWindow(txCbor: string) {
    const t = testBalances();
    await t.wallet.create(signer.phrase, "correct horse battery");
    await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
    const template = Object.values(koiosPreprod.accounts)
      .flatMap((a) => a.account_utxos)
      .find((u) => u.address === OWN)!;
    t.koios.addedToAccounts.push({ ...template, tx_hash: INPUT, tx_index: 0, value: "10000000", asset_list: [], block_height: 1 });
    const s = { id: "r2sign2", origin: "https://app.example", title: "App" };
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    const signing = t.dapp.call(s, "signTx", [txCbor, false]).catch(() => undefined);
    await until(() => t.dapp.approvals().length === 1);
    const asked = t.dapp.approvals()[0]!;
    if (asked.kind !== "sign-tx") throw new Error(`a sign-tx approval, not ${asked.kind}`);
    await t.dapp.answer(asked.id, false);
    await signing;
    return { summary: asked.summary, page: text(render(asked.summary)) };
  }

  it("shows the second msg's lines, or says there's more metadata, which signing publishes as well", async () => {
    const wasm = loadTestWasm();
    const tx = withMetadata(metadata);
    // What the account signs: the body commits to the metadata, and the metadata holds both msgs (Transaction details'
    // own reading of the bytes).
    const detail = JSON.parse(wasm.decodeTx(wasm.Network.Preprod, tx)) as TxDetail;
    expect(detail.metadataHashMatches).toBe(true);
    expect(detail.metadata.map((m) => m.label)).toEqual(["674"]);
    const entries = detail.metadata[0]!.value.type === "map" ? detail.metadata[0]!.value.entries : [];
    expect(entries.map((e) => (e.key.type === "text" ? e.key.text : e.key.type))).toEqual(["msg", "msg"]);
    expect(JSON.stringify(entries[1]!.value)).toContain(SECOND);

    const { summary, page } = await signWindow(tx);
    expect(summary).toMatchObject({ metadata: true, complete: true });
    expect(page).toContain(`Its note, which anyone can read ${FIRST}`);
    // The window names what signing publishes: the second msg's lines, or a line that there's more than the note.
    expect(
      page.includes(SECOND) || page.includes(LINE()) || page.includes(METADATA()),
      `the window shows neither "${SECOND}" nor a line that there's more metadata. It shows:${page}`,
    ).toBe(true);
  }, 60_000);
});
```
