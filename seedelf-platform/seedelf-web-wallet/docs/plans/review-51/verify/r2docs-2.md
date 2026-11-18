# r2docs#2: verification

From lane R2docs, graded low by its finder.

## Trace: confirmed, low

flows.md:431 is new in fc6a0aa1 and unchanged since. It says "A message, and a transaction's note (CIP-20), shows as what's signed reads". Its escaping clauses hold for both a message and a note. Its opening clause holds for a message. For a note it holds only when the auxiliary data the site carries is the data the body commits to.

- **What's signed:** the wallet signs the body hash alone (core build.rs:1201-1209 `tx_id`, cip30.rs:1045 and :1898). It hands the site only vkey witnesses (cip30.rs:1918, dapp.ts:2274).
- **What's shown:** the window's note and both metadata lines come from the carried bytes (cip30.rs:1690-1693, dapp.ts:2162 and :2176, DappApprovals.tsx:1099/1102/1104). Nothing on that path compares them with `auxiliary_data_hash`. The only check is decode.rs:833-848, read only by TxDetail.tsx:363, behind the window's Transaction details button.
- **No guard the finder missed:** `txBytes` and `bodyOutpoints` check only size, hex and outpoints. cbor.ts has no metadata check. Pallas's decode checks no hash. The approval signs the same request again (dapp.ts:2268). Both the account and the session bindings call `cip30::inspect_tx` (lib.rs:6884, :7260).

So a site can show "Thanks", or no metadata at all, then attach the committed metadata B to the body and witnesses, and the ledger takes it.

**Known part:** the code gap is e3b#1's second gap (merged into e3a#3, which verify/e3a-3.md graded low) and is on owner-calls.md:55 (G5's notes, item 2). The new part is the doc sentence. G5 wrote it in the same round in which it left that gap to the owner, and it describes the window's guarantee as wider than the code.

**Severity, low:**
- Who: a connected site, on the public account or a private session.
- Cost: no money. Metadata the window didn't show, or a note other than the one committed, lands on chain under the user's signature. x1a#3's "It carries other metadata too" line can be suppressed.
- Way out: Transaction details, in the same window, warns on the mismatch.

It isn't the brief's high class ("signs something other than it shows"): no value, fee, output, key or validity changes, and the window's main lines never show metadata content beyond the note. The doc error costs nothing by itself, but someone reading flows.md, such as the owner weighing call (2), would take the gap as closed.

**Evidence:**

FIXTREE HEAD (`git status`: flows.md and every cited code file are clean; `git diff --stat HEAD` on them prints nothing).

**The doc.** flows.md:431: "A message, and a transaction's note (CIP-20), shows as what's signed reads: a character that doesn't show or that reorders the text, as a right-to-left override does, is written as its code, `\u{202E}`, as Transaction details writes the chain's, and a line under it says so (chunk 51, e3a#3)." Both `git log -S'shows as what'` and `-L431,431` give fc6a0aa1 only.

**Clause by clause:**

(1) A message "shows as what's signed reads": holds. DappApprovals.tsx:1387 `// As what's signed reads: …`, then :1388 `shownSiteText(text)`. The CIP-8 payload is what's signed.

(2) A note "shows as what's signed reads": holds only when the carried metadata is the committed one.
- **Signed:** build.rs:1201-1209 `Ok(Hasher::<256>::hash(&tx_cbor[body]))`, the body alone. cip30.rs:1045 `let tx_hash = build::tx_id(&bytes)?;`. :1898 `let signature = key.sign(tx_hash);`. :1918 returns `witness_set`, vkey witnesses only. dapp.ts:2268 runs `signSessionTx`/`signDappTx` on the same request, and :2274 `return signed.witnessSet;`.
- **Shown:** cip30.rs:1690-1693 `let (metadata, note) = match &tx.auxiliary_data { Nullable::Some(aux) => note_of(aux), _ => (false, None) };`. `note_of` (:912-946) reads 674/"msg" from those bytes. `git grep auxiliary_data_hash HEAD` finds only decode.rs, core note.rs and tests: nothing in cip30.rs, lib.rs or dapp.ts.
- dapp.ts:2162 `if (summary.metadata && summary.note && this.besideNote(...))`. :2176 `return moreThanNote((JSON.parse(wasm.decodeTx(net, txCbor)) as TxDetail).metadata);` reads `.metadata` and never `.metadataHashMatches`. `moreThanNote` (:2996-3003) is false for {674:{msg:[…]}} alone.
- DappApprovals.tsx:1099 `if (s.metadata && !s.note) notes.push(tr("dappUi.note.metadata"));`. :1102 `if (s.note && s.otherMetadata) …otherMetadata`. :1104 `const note = s.note && shownSiteText(...)`, shown at :1306-1318 under "Its note, which anyone can read" (en.json:414).
- **The only check:** decode.rs:833-848 `metadata_hash_matches` (`(Some(hash), Some(data)) => Some(hash == blake2b256(raw))`, `_ => Some(false)`). Its only reader is TxDetail.tsx:363-367, which shows `tx.warn.metadataHash` (en.json:2892): "Its metadata doesn't match the hash in its body: the network would refuse it, and the metadata below isn't what it commits to." In the sign window it sits behind DappApprovals.tsx:1358 `<TxDetailButton … site />`, which decodes the same waiting bytes (dapp.ts:2288 `waitingCbor` → tx-view.ts:173, :184).

(3) "Written as its code, as Transaction details writes the chain's": holds. ui/dapp.ts:273-281 writes `\\u{…toUpperCase().padStart(4,"0")}` and decode.rs:899-907 writes `format!("\\u{{{:04X}}}")`.

(4) "A line under it says so": holds. DappApprovals.tsx:1312-1316 (the note) and :1406-1410 (the message) show `dappUi.warn.hiddenChars`.

**No missed guard.** signTx (dapp.ts:2215-2223) reads only `bodyOutpoints` 0 and 13. `txBytes` (:2959-2964) checks size and hex. cbor.ts has no metadata function. `readTx` (:2084-2136) passes the CBOR as given to `inspect_tx` (lib.rs:6884, :7260). cip30.rs:1043 `conway::Tx::decode_fragment` checks no hash. cip30.rs:1749-1754 already says of the witness set: "the body is what's signed. The witness set isn't, so a site can leave a native script out … and add it after". The same holds for the auxiliary data.

**Scenario run through.** The body's hash is H(B), with B = {674:{msg:["Thanks"]}, 1337:…}.
- Carried A = {674:{msg:["Thanks"]}}: metadata=true, note=["Thanks"], `besideNote` false. The window shows the note and no other-metadata line.
- Nothing carried: metadata=false, note=None. The window shows no metadata line at all.
- Either way, Transaction details warns. The site then submits body + witnesses + B. B hashes to the body's hash, so the ledger's metadata check passes.

**Since.** `besideNote` came in d9e015fb (`git log -S`), the sentence in fc6a0aa1, as the finder says.

**Known:** **Code half known.**
- owner-calls.md:55, §5 The connector, "G5's notes" (2): "The window reads a transaction's note without checking it against the body's metadata hash: a mismatch line would need words. Recommend: (2) yes, a short warning when the note isn't the transaction's".
- fixes/G5.md:16: "Named: cip30.rs reads a note without checking the body's `auxiliary_data_hash`".
- e3b#1's second gap (lanes/E3b.md:14), merged into e3a#3 (INDEX.md:124). verify/e3a-3.md:14 and :63 graded it low, as mitigated by Transaction details.

**Doc half not known.** flows.md:431's sentence is new in fc6a0aa1 (G5's "docs/flows.md (one sentence)").

**Searched:** auxiliary_data_hash, metadataHashMatches, metadata_hash_matches, "metadata hash", "hash of the metadata", mismatch, CIP-20 and 674, in backlog.md, archive/plans/, owner-calls.md, INDEX.md, fixes/ and verify/. The only hit beyond those above is chunk-17-transaction-view.md:236-240, which is Transaction details' own check. No Declined line and no owner rule covers it.

**Fix notes:**

**Words now (no owner needed).** In flows.md:431, keep the escaping clauses: they hold (ui/dapp.ts:273-281 and decode.rs:899-907 both write `\u{202E}`, and DappApprovals.tsx:1312-1316 and :1406-1410 give the line under). Change only the opening clause, to say:
- a message shows as its signed bytes read;
- a transaction's note shows as the metadata the site's transaction carries;
- the window doesn't check that metadata against the hash the body signs, and Transaction details, in the same window, warns when they differ.

Look at architecture.md:209 with it: "metadata the chain will never hold" is true of the carried bytes, not of the metadata the body commits to.

**Class: the owner's call (2), owner-calls.md:55.** Answer it there; don't open a new item.
- Move decode.rs `metadata_hash_matches` (:833) into a shared helper and use it in cip30.rs `inspect` (:1690). Return the result in TxSummary.
- When it's false (a hash with nothing carried, carried data with no hash, or a different hash), the window gives one short line. It then takes none of these from the carried bytes: the note (DappApprovals.tsx:1104, :1306), "It carries metadata" (:1099), or x1a#3's otherMetadata (dapp.ts:2162 `besideNote` → :1102).
- Same class: `tx.warn.metadataHash` (en.json:2892, TxDetail.tsx:363, a critical string) says "the network would refuse it". That's true of the bytes as given. In the site window (TxDetail's `site`), though, the signature covers the body, which the site can complete with the metadata it commits to, so the site's variant should say signing lets that other metadata land.
- Family: anything a site's transaction carries outside the body is unsigned. cip30.rs:1749-1754 already names the other member, the witness set's native scripts.

Class of the finding: a design doc's claim wider than the code, about the sign window reading a site's unsigned parts as if they were signed.

**Test:** `none`

Result: Not run, as the task says. The finding is a doc claim. On the code side there's no branch to exercise: cip30.rs takes the note from tx.auxiliary_data and has no auxiliary_data_hash anywhere (git grep shows the absence), and the signature covers the body alone (build.rs tx_id). e3a#3's verifier has already traced that gap (verify/e3a-3.md:14, :36-38, :63), and it's on the owner's list. A test would pin behaviour the owner may change, and the fix this finding needs is words.

```

```
