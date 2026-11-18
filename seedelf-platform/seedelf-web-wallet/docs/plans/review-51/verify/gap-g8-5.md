# gap-g8#5: verification

From lane gap-G8, graded low by its finder.

## Trace: partly, low

Most of the finding holds, and a run confirms it. A site's signTx is refused before WebAssembly reads it when the transaction's outer array is indefinite-length (9f … ff) or its body map is (bf … ff). The site hears InvalidRequest, "The wallet can't read this transaction." A site's submitTx is refused the same way for the indefinite outer array.

One part of the claim is wrong. submitTx does not refuse an indefinite body map. Its only reader, txId, checks tx[0] === 0x84 and then hashes through skip(), which reads indefinite items. So the transaction goes to Koios and the site hears its id. The real defect on that path is narrower: keepSent keeps nothing of the transaction. Its first step, rememberSiteSpent, reads the inputs with txInputs, which throws "the transaction body isn't a map". keepSent swallows that, so the wallet holds neither the inputs as spent nor the record that a resend or the site's next chained transaction reads.

The ledger decodes both forms and hashes the body as written. I read this in Conway 1.19 and confirmed it in the 1.22, 1.23 and 1.24 copies. WebAssembly reads both forms too, which the run shows. I found no earlier guard: txBytes only checks size and hex. No other caller avoids it either: every signTx goes through bodyOutpoints first.

A minimal fix (cbor.ts: accept 0x9f, read an indefinite body until 0xff) in a copy outside TREE makes both test cases pass, and the existing cbor.test.ts still passes. So nothing past cbor.ts refuses these forms: the prompt appears with WebAssembly's id.

Severity is low. Only a site whose encoder writes these forms is affected, and it only gets its own request refused. No money is lost, nothing gets stuck, and the way out is definite lengths, which the mainstream builders write by default (from memory, not checked here).

**Evidence:**

The trace, from where a site's bytes enter to the outcome. All files are at TREE, and identical at web-wallet/1.9.1 (git diff web-wallet/1.9.1 HEAD on these files: empty). The checks came in with 3e7b5665 (written for the wallet's own Pallas-built transactions) and were put in front of site transactions by fe8b7748 (chunk 15); both are in 1.9.1.

**Where the bytes enter**
- dapp.ts:2873-2878 `txBytes`: a size cap and hex parsing only. Nothing earlier reads the CBOR.
- dapp.ts:2141-2149 signTx: `inputs = bodyOutpoints(bytes, 0) ?? []; collateral = bodyOutpoints(bytes, 13) ?? []`, inside a try whose catch throws `invalid("dapp.cannotReadTx")`. This runs before heldForLovejoin, readTx and WebAssembly.
- dapp.ts:2556-2563 submitTx: `id = txId(bytes)` in the same kind of try.

**The worker's reader**
- cbor.ts:123 `if (tx[0] !== 0x84) throw … notFourItems`.
- cbor.ts:125 `if (body.major !== 5 || body.indefinite) throw … bodyNotMap`.
- cbor.ts:209 txId has the same 0x84 check.
- cbor.ts:210 hashes `tx.subarray(1, skip(tx, 1, 1))`, and skip reads indefinite items (cbor.ts:62-66). So txId refuses only the outer 9f form.

**The body-map form on submitTx: sent, then nothing kept**
- dapp.ts:2586 sends the transaction; keepSent runs after.
- dapp.ts:2648 `await rememberSiteSpent(session, bytes)` is keepSent's first step.
- spent.ts:81 `for (const o of txInputs(tx))` throws bodyNotMap.
- dapp.ts:2675 `wallet.withKeys(keep).catch(() => undefined)` swallows it. No spent inputs and no SESSION_DAPP_SIGNED record are kept, and Home's balance isn't marked stale.

**WebAssembly reads both forms**
- cip30.rs:1149-1152: check_nesting (whose walk closes an indefinite level at its break, :635-640), then `conway::Tx::decode_fragment`, then `build::tx_id(&bytes)`.
- Pallas 0.35.1, conway/model.rs: the transaction is a derived array struct (:1584-1604) and the body is derived `#[cbor(map)]` (:648-650).
- minicbor-derive 0.15.3, decode.rs: arrays at :341-358 and maps at :363-378, each `if let Some(len) = d.array()/map()? {…} else { while Type::Break != d.datatype()? {…} d.skip()? }`.
- seedelf-core build.rs:1201-1210 tx_id: `decoder.array()` in any form, then `skip()` over the body, hashed as written.
- The prompt's summary.txHash (cip30.rs:1844) is the tx_hash that sign_tx signs (:1953, :1978). uses_set_tags (:2139-2153) reads any array form.
- decode.rs:627-634 and map_fields (:1514-1531) read indefinite maps on purpose.

**The ledger takes both**
- In the local conway-1.19 copy:
  - Conway's Tx is AlonzoTx (Conway/Tx.hs:49), decoded with `Ann (RecD AlonzoTx)` (Alonzo/Tx.hs:442).
  - Coders.hs:454 `decodeCount (RecD cn) n = decodeRecordNamed …`.
  - Decoder.hs:661-669 decodeListLikeT: `lenOrIndef <- decodeListLenOrIndef … Nothing -> decodeBreakOr; unless isBreak "Excess terms"`.
  - The body is SparseKeyed (Conway/TxBody/Internal.hs:179). Coders.hs:524-528 decodeSparse uses `decodeMapLenOrIndef … Nothing -> getSparseBlockIndef` (:557-563).
- The copies at 1.22.1, 1.23 and 1.24 are the same. In 1.24, Alonzo/Tx.hs:592 is `decodeRecordNamed "AlonzoTx"`, and Decoder.hs:691-697 still has the same indefinite handling.

**The run on TREE** (`systemd-run … timeout 10m npx vitest run tests/r51-gap-g8-5.test.ts`): 2 tests, 2 failed.

Case 1: WebAssembly's decodeTx gave the expected ids for all three forms (that assertion passed). Then:
```
-   "arrayId": "bf388fae…",   +   "arrayId": "throws: not a 4-item transaction array",
-   "arrayInputs": ["abab…#0"],  +   "arrayInputs": "throws: not a 4-item transaction array",
    "mapId": "7e0536d8…"  (matches today)
-   "mapInputs": ["abab…#0"],    +   "mapInputs": "throws: the transaction body isn't a map",
```

Case 2:
```
signArray:   expected { txHash: "32c1fb54…" }, received { heard: { code: -1, info: "The wallet can't read this transaction." } }
signMap:     expected { txHash: "0bd00ad8…" }, received { heard: { code: -1, info: "The wallet can't read this transaction." } }
submitMap:   matches today (reachedKoios true, heard "0bd00ad8…")
keptMap:     expected { record: true, spent: true }, received { record: false, spent: false }
submitArray: expected { reachedKoios: true, refusedUnread: false }, received { reachedKoios: false, refusedUnread: { code: -1, info: "The wallet can't read this transaction." } }
```

**With the fix in a copy**: a 4-line change in a copy under ~/.cache/seedelf-review-51/ (now removed). bodyField and txId accept 0x84 or 0x9f, the `|| body.indefinite` refusal goes, and the loop reads `body.indefinite ? tx[p] !== 0xff : i < body.n`. Result: Test Files 2 passed, Tests 7 passed (this test's 2 and cbor.test.ts's 5, including "84bf" and the other malformed cuts).

No new parse difference: the fixed reader takes the first key 0 while Pallas keeps the last. That is already so for definite maps today, the ledger refuses duplicate keys (Coders.hs:538-541), and E3a.md:130's argument covers it.

**Known:** None, so not known. I searched backlog.md for indefinite, notFourItems, bodyNotMap, 4-item, 0x84, definite and canonical, and searched every file under archive/plans for indefinite, notFourItems, bodyNotMap, 4-item and 0x84.

The only nearby record is backlog.md:183, the Leios ⬜ line: "cbor.ts refuses Dijkstra's three-element transaction from a site". That is the same check (cbor.ts:123/209) but a different shape, 0x83, not an indefinite 0x9f array or bf body.

Nothing in SECURITY.md's out-of-scope list covers it, and the owner's rule of 2026-10-19 (refuse only what the ledger refuses) puts it in scope. Within chunk 51:
- E5.md:109 raised it as an untraced note.
- E3a.md:130 covers only that the gap can't bypass a guard.
- critic.md:118 lists it among the refusals.
- INDEX.md:405 is this finding.

**Fix notes:**

**cbor.ts.** The finder's sketch works; I checked it in a copy:
- bodyField (cbor.ts:123) and txId (:209) accept `tx[0] === 0x84 || tx[0] === 0x9f`.
- :125 drops `|| body.indefinite`.
- :127 loops `for (let i = 0; body.indefinite ? tx[p] !== 0xff : i < body.n; i++)`.

head() throws at the buffer's end, so a body with no break ("84bf", "84bf00", "9fbf00") still throws, and cbor.test.ts passes unchanged. The same change fixes keepSent: rememberSiteSpent's txInputs then reads an indefinite body, so a site's submitted transaction has its inputs held as spent and its record kept.

**Test fixtures.** Update the fixture tests/fixtures/cbor.ts too. Its txIdOf (the fake Koios's submittx answer) and ttlOf have the same 0x84 check, so a fake submit of a 9f transaction errors there. The new test doesn't depend on this.

**When the line is touched.** The backlog's Leios item (a Dijkstra 0x83 three-element transaction) is the same check. The owner may want to decide it at the same time; it's a later call, not part of this fix.

**The same class, lower priority.** These are reached only by a session's Minswap transaction, which the trace didn't check for its encoding:
- cip30.rs attach_witnesses, `d.array() != Some(4)` (:2063-2067).
- raw_map (:2012-2016) and raw_vkeys (:2037-2040) refuse indefinite witness sets and lists.

**Owner.** The finder marks it needs_owner because it widens which site transactions the connector reads and signs. It adds no refusal, and it is what the owner's 2026-10-19 rule asks for.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g8-5.test.ts`

Result: **On TREE**: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g8-5.test.ts`, run from extension/.
```
 ❯ tests/r51-gap-g8-5.test.ts (2 tests | 2 failed) 748ms
   × is read as WebAssembly reads it: the same inputs, and the id of its body as written 53ms
   × reaches the user from a site's signTx, with the id WebAssembly signs, and goes out from its submitTx, kept 694ms
```

Case 1 (WebAssembly's decodeTx already agreed on all three ids):
```
-   "arrayId": "bf388fae41d380e9a382fe0354ec9571f7f52061a84529c656f6e947f6e71631",
-   "arrayInputs": [ "abab…ab#0" ],
+   "arrayId": "throws: not a 4-item transaction array",
+   "arrayInputs": "throws: not a 4-item transaction array",
    "mapId": "7e0536d807006ab1fac3f0d44f44bccbb0767369eac70516ee245f9bf60c5ef0",
-   "mapInputs": [ "abab…ab#0" ],
+   "mapInputs": "throws: the transaction body isn't a map",
```

Case 2:
```
    "keptMap": { -"record": true, -"spent": true, +"record": false, +"spent": false },
    "signArray": { -"txHash": "32c1fb54…", +"heard": { "code": -1, "info": "The wallet can't read this transaction." } },
    "signMap":   { -"txHash": "0bd00ad8…", +"heard": { "code": -1, "info": "The wallet can't read this transaction." } },
    "submitArray": { -"reachedKoios": true, -"refusedUnread": false,
                     +"reachedKoios": false, +"refusedUnread": { "code": -1, "info": "The wallet can't read this transaction." } },
    "submitMap": { "heard": "0bd00ad8…", "reachedKoios": true, "refusedUnread": false }   (matches today)
 Test Files  1 failed (1)   Tests  2 failed (2)
```

**In a copy outside TREE with the minimal fix** (cbor.ts:123 and :209 accept 0x84 or 0x9f; :125 drops `|| body.indefinite`; :127 loops `body.indefinite ? tx[p] !== 0xff : i < body.n`), running `npx vitest run tests/r51-gap-g8-5.test.ts tests/cbor.test.ts`:
```
 Test Files  2 passed (2)
      Tests  7 passed (7)
```
The copy has been removed, and TREE holds only the new test file.

```
// Chunk 51, gap-g8#5. The worker's CBOR reader (src/background/cbor.ts) takes a transaction only as a definite
// four-item array (`tx[0] !== 0x84`, in bodyField and txId) with a definite body map (bodyField's `body.indefinite`).
// One written 9f … ff, or with its body bf … ff, is well-formed CBOR that the ledger decodes (decodeRecordNamed and
// decodeSparse take either length) and hashes as written, and WebAssembly reads it too (Pallas's derived decoders,
// core's tx_id, decode.rs). So a site's signTx of either is refused unread ("The wallet can't read this
// transaction."), and so is its submitTx of the first. Its submitTx of the second goes out, but nothing of it is
// kept: keepSent's rememberSiteSpent reads its inputs with txInputs, which throws, and keepSent swallows that.
// Each case asserts what the ledger and WebAssembly do: they fail today and pass once cbor.ts reads both forms.

import { blake2b } from "@noble/hashes/blake2.js";
import { describe, expect, it } from "vitest";

import { skip, txId, txInputs } from "../src/background/cbor";
import { SESSION_DAPP_SIGNED, type DappError, type DappSession } from "../src/background/dapp";
import { SESSION_SEND } from "../src/background/send";
import { SESSION_SPENT_SITES } from "../src/background/spent";
import { APIError, TxSignError } from "../src/shared/dapp";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const hash = (hex: string) => toHex(blake2b(bytes(hex), { dkLen: 32 }));
/** What a read gives, or what it throws, so that one comparison shows every case. */
const read = (f: () => unknown) => {
  try {
    return f();
  } catch (e) {
    return `throws: ${(e as Error).message}`;
  }
};
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("gap-g8#5: a transaction written with indefinite lengths", { timeout: 30_000 }, () => {
  it("is read as WebAssembly reads it: the same inputs, and the id of its body as written", () => {
    const input = "ab".repeat(32);
    // A body of three fields: one input, no outputs, no fee.
    const fields = `0081825820${input}00` + "0180" + "0200";
    const definiteBody = `a3${fields}`;
    const indefiniteBody = `bf${fields}ff`;
    const definite = `84${definiteBody}a0f5f6`;
    const indefiniteArray = `9f${definiteBody}a0f5f6ff`;
    const indefiniteMap = `84${indefiniteBody}a0f5f6`;

    // WebAssembly reads all three today, each with the hash of its body as written.
    const wasm = loadTestWasm();
    const idOf = (tx: string) => (JSON.parse(wasm.decodeTx(wasm.Network.Preprod, tx)) as { txHash: string }).txHash;
    expect([definite, indefiniteArray, indefiniteMap].map(idOf)).toEqual([
      hash(definiteBody),
      hash(definiteBody),
      hash(indefiniteBody),
    ]);

    // The worker's reader, which a site's signTx (bodyOutpoints) and submitTx (txId) go through first.
    expect(read(() => txInputs(bytes(definite)))).toEqual([`${input}#0`]);
    expect({
      arrayInputs: read(() => txInputs(bytes(indefiniteArray))),
      arrayId: read(() => txId(bytes(indefiniteArray))),
      mapInputs: read(() => txInputs(bytes(indefiniteMap))),
      mapId: read(() => txId(bytes(indefiniteMap))),
    }).toEqual({
      arrayInputs: [`${input}#0`],
      arrayId: hash(definiteBody),
      mapInputs: [`${input}#0`],
      mapId: hash(indefiniteBody),
    });

    // What isn't whole still throws, rather than read past the end or loop (cbor.test.ts's "84bf").
    for (const cut of ["9f", "9fbf", "9fbf00", "84bf", "84bf00"]) {
      expect(() => txId(bytes(cut)), cut).toThrow();
      expect(() => txInputs(bytes(cut)), cut).toThrow();
    }
  });

  it("reaches the user from a site's signTx, with the id WebAssembly signs, and goes out from its submitTx, kept", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    await t.preferences.set({ dappConnector: true, spendRewards: false });
    const s: DappSession = { id: "gap-g8-5", origin: "https://app.example.com", title: "Example" };
    const enabling = t.dapp.call(s, "enable", []);
    for (let i = 0; i < 200 && t.dapp.approvals().length === 0; i++) await tick();
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);

    // A payment from the account as the wallet's own Send builds it, definite throughout, then written both ways.
    const sent = await t.send.build("preprod", [{ to: account(15).preprod.receive_0 as string, lovelace: "3000000", tokens: [] }]);
    const tx = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
    const b = bytes(tx);
    expect([b[0], b[1]! >> 5, (b[1]! & 0x1f) < 24]).toEqual([0x84, 5, true]);
    const end = 2 * skip(b, 1);
    const asArray = `9f${tx.slice(2)}ff`;
    const asMapBody = `bf${tx.slice(4, end)}ff`;
    const asMap = `84${asMapBody}${tx.slice(end)}`;

    /** A site's signTx: the prompt's transaction id (then declined), or what the site heard instead. */
    const asked = async (cbor: string) => {
      let heard: unknown;
      const signing = t.dapp.call(s, "signTx", [cbor, false]).then(
        () => undefined,
        (e: DappError) => void (heard = e.failure),
      );
      for (let i = 0; i < 2000 && t.dapp.approvals().length === 0 && heard === undefined; i++) await tick();
      const approval = t.dapp.approvals()[0];
      if (!approval) return { heard };
      if (approval.kind !== "sign-tx") throw new Error(approval.kind);
      await t.dapp.answer(approval.id, false);
      await signing;
      expect(heard).toMatchObject({ code: TxSignError.UserDeclined });
      return { txHash: approval.summary.txHash };
    };
    /** A site's submitTx: whether it reached Koios, and what the site heard. */
    const submitted = async (cbor: string) => {
      const before = t.koios.submitted.length;
      const heard = await t.dapp.call(s, "submitTx", [cbor]).then(
        (id) => id,
        (e: DappError) => e.failure,
      );
      const unread = typeof heard === "object" && (heard as { code?: number }).code === APIError.InvalidRequest;
      return { reachedKoios: t.koios.submitted.slice(before).map(toHex).includes(cbor), refusedUnread: unread ? heard : false, heard };
    };
    /** Whether the wallet keeps what a site's transaction spends (spent.ts), and its record (keepSent). */
    const keptOf = async (id: string) => {
      const spent = (await t.session.get<Record<string, number>>(SESSION_SPENT_SITES)) ?? {};
      const records = (await t.session.get<Array<{ txHash: string }>>(SESSION_DAPP_SIGNED + "preprod")) ?? [];
      return { spent: txInputs(b).every((o) => o in spent), record: records.some((r) => r.txHash === id) };
    };

    const results = {
      signArray: await asked(asArray),
      signMap: await asked(asMap),
      submitMap: await submitted(asMap),
      keptMap: await keptOf(hash(asMapBody)),
      submitArray: await submitted(asArray),
    };
    expect(results).toMatchObject({
      // The same body as the definite form's: the same id.
      signArray: { txHash: sent.txHash },
      // The body as written.
      signMap: { txHash: hash(asMapBody) },
      // Sent, and its id heard (it is today)...
      submitMap: { reachedKoios: true, refusedUnread: false, heard: hash(asMapBody) },
      // ...and what it spends, and its record, kept.
      keptMap: { spent: true, record: true },
      // Sent, rather than refused unread.
      submitArray: { reachedKoios: true, refusedUnread: false },
    });
  });
});
```
