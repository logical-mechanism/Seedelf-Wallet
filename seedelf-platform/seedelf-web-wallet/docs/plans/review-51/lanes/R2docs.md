# Lane R2docs

Returned by the workflow's agent `a6c6fed146023d830`, written here by the lead from its structured answer.

## Findings (6)

### r2docs#1 · low · flows.md says a stranger's later swap return never changes what the page says of the swap's own, but the timeline's last step still follows the latest return

- **Where:** `seedelf-platform/seedelf-web-wallet/docs/flows.md:478`
- **Who:** stranger · **Since:** fc6a0aa1 (the sentence); the step's link dates from the timeline itself · **Confidence:** traced

**Scenario:**

A private swap's own return lands, say 133.4 ₳ and 906,594,100 MIN through Lovejoin, as in verify/e2b-2.md's test. Before the session closes, a stranger pays its one-time address 2 ₳ (the address is public once funded). The runner's next return brings that 2 ₳ back on its own (KeptBack `strangers`). On the finished swap's page, Received is the sum, as designed. But the timeline's last step, "Back in your private balance", links `tx("back")`, which is `s.txs.findLast(kind back)`. That is the stranger's 2 ₳ return, not the swap's. If the stranger's return goes as a Lovejoin chain, sendChain overwrites `s.chain` before its `strangers` early return, so the step's words (`backStepText`) come from the stranger's chain: if that chain stops, the swap's own return reads as stopped. Yet flows.md:478, new this round, says that later return "never changes what the page says of how the swap's own came back". No money moves; the link and the words describe the wrong transaction.

**Evidence:**

FIXTREE. flows.md:478: "…and every later return's beside it, such as what a stranger paid the account before it closed; that one never changes what the page says of how the swap's own came back (chunk 51, e2b#2)."
- ui/screens/Swaps.tsx:3121: `const tx = (kind: SessionTx["kind"]) => s.txs.findLast((t) => t.kind === kind);`
- Swaps.tsx:3206-3208: `{ title: tr("swaps.plan.back"), sub: backStepText(s), tx: tx("back") }`
- Swaps.tsx:3103: `if (s.chain) return s.chain.cut || s.chain.stopped ? chainText(s.chain) : t("swaps.step.throughLovejoin");`
- background/sessions.ts:5359: `s.chain = { total: txs!.length, last: …, at: … }` runs before :5360-5361 `// A return of strangers' alone … leaves the word … as it is (e2b#2). if (strangers) return;`. Only `lovejoinSkipped` is protected.
- sessions.ts:5241: the direct path protects only `skipped`.
- fixes/G4.md: "Named, not changed: the swap page's timeline links its return step to the latest return, which can be a stranger's; … a later chain of strangers' UTxOs alone replaces `SessionRecord.chain`".

**Fix:**

Either reword flows.md:478 to say what the fix keeps (the skip reason, not the step's link or chain words), or finish the class. Mark a strangers-only return on its RecordedTx. Have the Timeline's step and backStepText take the session's own last return. Keep a strangers-only chain apart from `SessionRecord.chain`, which describes the session's own. The siblings are verify/e2b-2.md's "same class" list, which also names `mix.skipped`.

**Known check:**

fixes/G4.md names both behaviours as "not changed", and verify/e2b-2.md lists the timeline link under "Same class". INDEX.md has no finding for it. backlog.md and archive/plans have no hits for 'timeline', "stranger's return" or 'Received row'. What's new is the doc sentence claiming the opposite.

### r2docs#2 · low · flows.md says a site's transaction note shows "as what's signed reads", but the sign window reads the metadata the site carries, never what the body's auxiliary_data_hash commits to

- **Where:** `seedelf-platform/seedelf-web-wallet/docs/flows.md:431`
- **Who:** site · **Since:** fc6a0aa1 (the sentence); d9e015fb (x1a#3's line reads the same carried bytes); the window has never checked the hash · **Confidence:** traced
- **Needs the owner:** The real fix is a new warning line in the sign window, which G5 left as the owner's words. Rewording the doc alone leaves a site able to land metadata the window never showed.

**Scenario:**

A site calls signTx with a transaction whose body's auxiliary_data_hash is the hash of metadata B: {674: {msg: ["Thanks"]}, 1337: <a label naming the user>}. The CBOR it hands over carries metadata A instead: {674: {msg: ["Thanks"]}}, or no metadata at all. The window shows the note "Thanks", or nothing. It shows no "It carries other metadata too" line (x1a#3's new line) and no "It carries metadata", then signs the body. The site submits the body, the wallet's witness set and B. The ledger takes it, since B matches the body's hash, so B lands on chain under the account's signature. flows.md:431, new this round, says "A message, and a transaction's note (CIP-20), shows as what's signed reads". That holds for a message, but for a note only when the carried metadata is the committed one. Only Transaction details compares the hash.

**Evidence:**

FIXTREE. wasm/src/cip30.rs:1690-1693: `let (metadata, note) = match &tx.auxiliary_data { Nullable::Some(aux) => note_of(aux), _ => (false, None) };`. cip30.rs:913-946 `note_of` reads label 674 from that auxiliary data, and cip30.rs never mentions `auxiliary_data_hash` (grep).
- extension/src/background/dapp.ts:2162: `if (summary.metadata && summary.note && this.besideNote(...))`. dapp.ts:2172-2181: `besideNote` returns `moreThanNote(JSON.parse(wasm.decodeTx(net, txCbor)).metadata)`, and the decoder's `metadataHashMatches` is never read.
- ui/screens/DappApprovals.tsx:1099 and :1102 add the metadata lines from those flags.
- Only ui/components/TxDetail.tsx:363 reads `metadataHashMatches` (decode.rs:796, :833).
- fixes/G5.md names it: "cip30.rs reads a note without checking the body's `auxiliary_data_hash` (a mismatch line would be new words: the owner's)".

**Fix:**

Words only: flows.md:431 should say the window shows the note the transaction carries, and that Transaction details says when the body doesn't commit to it. Or the class: have inspectDappTx return whether the carried metadata is the committed one. If it isn't, or if the body names a hash with nothing carried, the window gives one short line, and it doesn't take the note or the other-metadata flag from the carried bytes then. The flag's other reader is x1a#3's `besideNote`.

**Known check:**

fixes/G5.md names the hash gap as left for the owner. INDEX.md has x1a#3 (other metadata) and e3a#3/e3b#1 (hidden characters), nothing on the hash. Of backlog.md and archive/plans, only chunk-17-transaction-view.md:238 mentions it, and that is Transaction details' own check, not the window's. What's new: the doc claims the window keeps it, and x1a#3's fix reads the same unchecked bytes.

### r2docs#3 · nit · The Lovejoin AnyTx README gives LogicLedgerUniqueness a weaker hypothesis than it has, and counts four of LogicBoxComposition's five theorems

- **Where:** `seedelf-verification/Lovejoin/AnyTx/README.md:203`
- **Who:** nobody · **Since:** 40883a55 · **Confidence:** traced

**Scenario:**

v4b#2's fix adds that LogicBoxComposition's "four theorems" assume `validScriptContext`, and that "`LogicLedgerUniqueness` states the NFT condition under the reference inputs' value rule alone". But LogicLedgerUniqueness's four theorems take `validReferenceInputs`, which also requires the reference inputs sorted by TxOutRef. That is the same class of understated hypothesis v4b#2 corrected. LogicBoxComposition has five theorems, and only four take `validScriptContext`. Nothing reachable changes, since the ledger always sorts reference inputs, so this is wording.

**Evidence:**

FIXTREE seedelf-verification.
- LogicLedgerUniqueness.lean:181-235: each of owner/mix_requires_unique_nft_reference and _value_one takes `(hValid : CardanoLedgerApi.V3.Contexts.validReferenceInputs (⟨tx, …, .RewardingScript acct⟩ : ScriptContext) = true)`.
- .lake/packages/CardanoLedgerApi/CardanoLedgerApi/V3/Contexts.lean:1122-1131 defines it as `prevTxOutRef < x.txInInfoOutRef && V2.validTxOutValue x.txInInfoResolved.txOutValue && visit …`, i.e. sorted and valued.
- LogicBoxComposition.lean:24 `wellformed_box_requires_withdrawal` has no validity premise; :44, :73, :102, :130 have `hValid : … validScriptContext …`.

**Fix:**

Say "under the reference inputs' rules alone (sorted, each value as the ledger forms it)", and "its four NFT theorems".

**Known check:**

v4b#2 (INDEX.md:268) is the original. This is its fix's new sentence. Searched CLAIMS.md and the Audit findings for LogicLedgerUniqueness: no other statement of its hypothesis.

### r2docs#4 · nit · architecture.md calls core's check_nesting "the one walk for every transaction from outside the wallet", but the worker's cbor.ts walk is the one guarding ogmiosUtxos on a site's transaction

- **Where:** `seedelf-platform/seedelf-web-wallet/docs/architecture.md:195`
- **Who:** nobody · **Since:** 36fbb96f (the walk merged), fc6a0aa1 (the doc) · **Confidence:** traced

**Scenario:**

Inside WebAssembly, the merged walk is now core's alone (decode.rs, cip30.rs, orders.rs). But a site's transaction also goes through `wasm.ogmiosUtxos` (dapp.ts outputsOf), and core's `eval::ogmios_utxos` decodes with `MultiEraTx::decode` and never calls check_nesting. Those calls are guarded only by the worker's own TypeScript walk, `nestsWithin`, which also caps at 128, or by inspectDappTx having run first. A maintainer who trusts "the one walk" could drop the TypeScript walk, and a site's deep datum would then reach Pallas's recursion in ogmios_utxos. The comments left behind still cite the old copy: cbor.ts says "cip30.rs refuses past 128 too", and decode_test.rs:1411 names `MAX_NESTING`. The doc is wrong today; nothing breaks today.

**Evidence:**

FIXTREE.
- architecture.md:195: "(core's `cbor::check_nesting`, `MAX_DEPTH` 128 levels, the one walk for every transaction from outside the wallet — …)". The same page, :187, says `background/cbor.ts` has depth checks.
- extension/src/background/cbor.ts:44-50: "as the WebAssembly counts them (cip30.rs refuses past 128 too)"; `MAX_DEPTH = 128`. cbor.ts:104 is `nestsWithin`.
- dapp.ts:1996 and :2738: `nestsWithin(…) ? outputsOf(wasm, …)`. dapp.ts:2897 calls `wasm.ogmiosUtxos`. seedelf-core/src/eval.rs:397-399 `ogmios_utxos` calls `MultiEraTx::decode(tx_cbor)` with no check_nesting.
- wasm/tests/decode_test.rs:1411 still says `MAX_NESTING`.

**Fix:**

Say "the one walk in WebAssembly", and name cbor.ts's `nestsWithin` as the worker's pre-check before `ogmiosUtxos`. Update cbor.ts's comment and the test comment. Or have `eval::ogmios_utxos` call check_nesting itself.

**Known check:**

G1 named "cip30.rs keeps its own copy" and G3 merged it. INDEX r3b#1 covers the cancel check. Nothing covers the worker's walk or ogmios_utxos. backlog: no hit for nestsWithin.

### r2docs#5 · nit · privacy.md and architecture.md don't say that this release re-reads the private index from a snapshot and every pool copy once more, or that a reader version is now stored

- **Where:** `seedelf-platform/seedelf-web-wallet/docs/privacy.md:230`
- **Who:** user · **Since:** 4cbac01e (SETTLED_RULE), 506e4ed2 (BOX_READER) · **Confidence:** traced

**Scenario:**

After updating, every wallet with a sealed private-index record of v1 drops it at its first private read. It asks the data layer for a snapshot, the request a restore makes, and judges every contract row again on the device. Every device that found Lovejoin pool copies reads each copy once more (BOX_READER 2) and stores `reader: 2`. privacy.md still says "a snapshot at a restore, then only what changed" (:230), "so an unlock asks only what changed" (:263) and "Every copy a device has found is read once" (:416). architecture.md:287 says "a restore takes the index's snapshot", and its storage table (:425) lists `checked` but not `reader`. Every updated device makes the same requests, so nothing new is linked. But privacy.md's contributor rule (:488) says a change to what the wallet sends or keeps updates this page in the same PR.

**Evidence:**

FIXTREE.
- extension/src/background/contract-scan.ts:190-200: "a record sealed under another is read again from a snapshot, the request every wallet makes at a restore … 2 since chunk 51's x2#2"; `const SETTLED_RULE = 2;`. Then :279 `let settled = kept?.v === SETTLED_RULE && …` and :289 `const snapshot = await index.snapshot();`.
- lovejoin-pools.ts:157 `export const BOX_READER = 2;`, :408 `const read = (stored?.reader ?? 1) === BOX_READER ? (stored?.checked ?? []) : [];`, :232 and :358 write `reader: BOX_READER`.
- privacy.md:230, :263, :416 and architecture.md:287, :425 as quoted.

**Fix:**

Say once, in privacy.md :230 and :416: after an update that changes how rows or boxes are read, the first read asks a snapshot and reads each copy once more, the same for every updated device. Add `reader` (and the record's `v`) to architecture.md's storage row. Whether the privacy policy's Changes needs an entry is the owner's call.

**Known check:**

The gap-g6#1 entries in INDEX are the code fixes and say nothing of the docs. backlog.md has nothing on a snapshot after an update or on re-reading copies. privacy.md was edited this round for other lines only (d1#3, d1#5, e8a#3).

### r2docs#6 · nit · flows.md's Collateral page still describes the automatic pick as any 5 ₳ of ADA, and two code comments cite a collateralFits in sessions.ts that no longer exists

- **Where:** `seedelf-platform/seedelf-web-wallet/docs/flows.md:142`
- **Who:** stranger · **Since:** 2b3dfd80, fdd3b8b2 · **Confidence:** traced

**Scenario:**

e8b#1 made the automatic collateral, and the one the Collateral page's Set offers, the oldest 5 ₳ of ADA with no reference script and no datum. architecture.md:370 and keys-and-accounts.md:128 say so. flows.md:142 still says "the wallet takes the oldest UTxO of exactly 5 ₳ and nothing else that the account holds", and :143 "Set collateral: from such a UTxO, nothing is sent". A stranger's 5 ₳ with a datum still matches those words, but the wallet now passes it over, and Set pays 5 ₳ instead. The rule itself moved to coin-control.ts: sessions.ts imports it and dapp.ts keeps its own copy. Yet coin-control.ts:194 and dapp.ts:2852 still point to "sessions.ts `collateralFits`".

**Evidence:**

FIXTREE.
- coin-control.ts:198: `export const collateralFits = (u) => isCollateralShaped(u) && !u.reference_script && !u.inline_datum && !u.datum_hash;`. coin-control.ts:219 (collateralOf) and :419 (Set) use it.
- sessions.ts:100 imports it, and its own comment at :1076-1078 says "coin-control.ts's `collateralFits` … one copy, not two". coin-control.ts:194 still says "(sessions.ts `collateralFits`, independent review L20)", and dapp.ts:2852 "(sessions.ts `collateralFits`)".
- flows.md:142-143 as quoted.

**Fix:**

flows.md:142: "the oldest UTxO of exactly 5 ₳ of ADA alone, with no reference script and no datum". Point the two comments at coin-control.ts.

**Known check:**

e8b#1 is the code finding, and its fixer updated architecture.md and keys-and-accounts.md, not flows.md. backlog: no hit for the collateral pick's words.

## Guards (13)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/background/coin-control.ts:198` | A stranger's 5 ₳ of ADA with a datum or reference script becoming the account's collateral, which made every public Lovejoin mix fail to build (e8b#1); the Collateral page's Set uses it too (:419) | extension/tests/coin-control.test.ts (G6's 6 cases) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/balances.ts:538` | A stranger's row at the KEY address carrying the contract's 28 bytes being counted in the private balance, as a Seedelf's place, or as a spendable input (x2#2); applied in ownedUtxos, in contract-scan's Koios view (:151) and in its names (:350) | extension/tests/contract-scan.test.ts, own-address.test.ts, private-index.test.ts (6aea4fb8) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/contract-scan.ts:279` | A row 1.9.1 sealed as the wallet's under the old rule staying counted for good: a v1 record is dropped for a snapshot (SETTLED_RULE 2, :200) | extension/tests/private-index.test.ts (the v1 record test, 4cbac01e) |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:2319` | A private spend, a Seedelf payment, a Remove, or the private payer of a box's way back taking a row at the key address carrying the contract's hash (check_spendable :2344, recipient_register :3034, remove_spend :5061; also checks the network) | wasm/tests/api_test.rs, lovejoin_flows_test.rs (514c6579) |
| `seedelf-platform/seedelf-core/src/utxos.rs:41` | The CLI counting or spending a stranger's row at the key address carrying the contract's hash (used by every collect_* and find_* reader) | the CLI's tests in 03cf290e (not read) |
| `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:296` | A key address carrying mix_box's hash being read as holding a Lovejoin box (x2#1) | none found (d2a7278d's tests not read) |
| `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:881` | A site's payment into the contract under a register no one can spend shown as a Seedelf payment or as "anyone can take" (d1#3): register_fields (:863) reads constructor 0 in both spellings, and spender returns Owner, Anyone or Nobody as wallet.ak at 5b82530 does | wasm/tests/cip30_test.rs a_payment_into_seedelf_says_who_can_take_it; decode_test a_register_says_who_could_spend_what_is_under_it |
| `seedelf-platform/seedelf-core/src/utxos.rs:192` | The CLI's fund spending the 5 ADA token-free collateral that create and util extract put up | none found |
| `seedelf-platform/seedelf-koios/src/koios.rs:626` | A CLI submit Koios didn't confirm (a timeout, a lost connection, a 5xx, a 2xx that isn't a JSON string) being read as not sent, so a rerun pays twice; seedelf-cli/src/commands/submit.rs:23-41 prints the id first | seedelf-cli tests/cli/submit.rs (both named tests, G2) |
| `seedelf-platform/seedelf-cli/src/web_server.rs:132` | A page from an earlier run, or another run's server, standing in for this run's transaction: binds before printing, uses a 128-bit path per run, Host check, no-store and frame-deny | seedelf-cli tests/signing_page.rs (a_second_run_never_announces_an_earlier_runs_page, each_run_serves_its_page_at_an_address_of_its_own, the_page_answers_only_its_own_host) |
| `seedelf-platform/seedelf-core/src/build.rs:2193` | An account collateral return under an output's least (a session's 2 ₳ fallback collateral with a fee over about 0.69 ₳): signed, then refused at submit | seedelf-core/tests/merge_test.rs (21caa3b8) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2858` | A stranger's 5 ₳ with a datum or script standing in as a private session's collateral for getCollateral, while getUtxos served the real one (e3a#2) | extension/tests/dapp.test.ts (it.each over the three shapes) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/destination.ts:154` | Send or Make public to the user's payment key under someone else's stake part (or none) reading only "it comes back" with no word that its staking goes elsewhere (x1a#1) | extension/tests/own-address.test.ts |

## Checked and holds

- README.md:187 (troll): the web wallet leaves reference-script UTxOs out of the private balance (balances.ts:516-518) and out of payments (script-spend.ts:312/318), and marks them on UTxOs (coin-control.ts:342). The CLI can still spend them through sweep --all (rows.rs sweepable, capped by MAX_REFERENCE_SCRIPT_BYTES).
- README.md:276 (collateral): the two exceptions hold. The session's collateral mix runs under giveme.my (mix_giveme). A Danogo route carries Minswap's collateral (privacy.md:364). A Bootstrap now puts up none (lovejoin.ts `collateral: bootstrap ? null`; wasm AccountChainRequest.collateral is an Option), matching privacy.md:429.
- seedelf-platform/README.md create page: binds before printing the address, 128-bit path per run, Host check, the id shown on the page and printed, the page's may-have-gone text, and 'says so and stops' on a held port (web_server.rs:132-262, static/index.js:21-80).
- seedelf-platform/README.md: fund skips token-free 5 ADA UTxOs (utxos.rs:184-199, fund.rs:126-128). external sweep takes as much as one transaction holds and prints what it left (external/sweep.rs:43-56). sweep --all takes the first 20 that fit, then the most one transaction holds (sweep.rs:154-178). The id is printed before every Koios submit (submit.rs; spend.rs:91, external/sweep.rs:72). MaybeSent covers a timeout, a lost connection, a 5xx and a non-string 2xx; a node-down 4xx is NotSent (koios.rs:626-680).
- architecture.md:195/198: core's check_nesting is the WebAssembly's only walk. decode.rs:648, cip30.rs:1042 and :1979-1980, and orders.rs:1254 call it before decoding. MAX_NESTING is gone from wasm/src.
- architecture.md:201 against wallet.ak at 5b82530: `if register is Register` is a soft cast, so anything else is spendable by anyone. schnorr.prove decompresses both points, so a non-G1 point is locked. An identity public value is anyone's. An identity generator with a non-identity public value is no one's. Both identities is anyone's (spender returns Anyone). The decode.rs register_detail fields `payable`/`anyone` exist (:1246-1255). The witness-set datum is read in cip30 only, consistent with :200.
- architecture.md:205: MOST_DECIMAL_BYTES = 128, hex past it, leading zeros ignored, and a negative written with its own sign (decode.rs:492-518). PlutusTree withholds Copy JSON for a hex number (plutusJson).
- architecture.md:267 and lovejoin-mix-width.md: networks.ts's lovejoin holds only mixBox and poolFloor; mixCost is gone from src and the docs (screens' mixCosts is a different function).
- architecture.md:335/338: atContract (balances.ts:538), api::at_wallet_contract (lib.rs:2319, which also checks the network), utxos::at_wallet_contract (utxos.rs:41) and Protocol::spends_as_mix_box (mod.rs:296) all exist and all read the script payment part. Private-index rows keep the data layer's own address (private-index.ts:393), so the rule applies to them. registerOf accepts both spellings (chain.ts:84-114).
- architecture.md:370 and keys-and-accounts.md:128: collateralOf's automatic pick (coin-control.ts:219) and the Collateral page's Set (:417-419) use collateralFits; a reclaim (null) takes none.
- architecture.md:511: i18n-critical.mjs canWarn treats a class with a --warn modifier as critical (literals, templates, const bindings, branches).
- architecture.md:564: decode.rs address_detail also needs the script part (:1390), the sibling of w2#2. Script-credential certificates and Byron rows are as G3 reports.
- architecture.md:645/650/670/718/719: SessionRecord.mix.depth and delay (sessions.ts:544-551, 2375-2376, 4739, 4830), partsUnlisted (sessions.ts:1171, 3928-3930), stillUnder (4279, 4303), SentMeanwhile (lovejoin.ts:1312, 7718) and ChainRecord.delay (lovejoin.ts:1315+, 5611) exist as described.
- flows.md:227: stakeElsewhere in destination.ts ownAccount (none of the accounts' stake keys), the StakeElsewhereNote on Send's and Make public's forms and reviews, tx.yours.warn.stakeElsewhere in Transaction details, and the UTxOs screen's otherStake (the active account's stake key). The strings match.
- flows.md:414 and wasm/README.md:55: RemoveResult.tokens (lib.rs:5034-5048), Remove's review via PaidRows, and remove_spend's contract check.
- flows.md:431: shownSiteText (ui/dapp.ts:273) escapes as \u{XXXX} for signData's message and the note, with dappUi.warn.hiddenChars. The escaping itself holds; the note's integrity is r2docs#2.
- flows.md:517 and privacy.md:455: privateTies (Lovejoin.tsx:1547) names the other accounts, and its strings say they're tied to each other.
- flows.md:529: refusesEvery (lovejoin.ts:1724). giveme.my's 429 or unreachability and Koios trouble end the run; a giveme.my 5xx ends it at the second in a row.
- privacy.md:276: PhraseInput.tsx:91 clears the clipboard on a whole-phrase paste in Restore and in Settings' check (no positions); there's no Copy button.
- privacy.md:336: the window has three callouts (DappApprovals.tsx:1206-1220), and the #reading-a-transaction anchor exists.
- privacy.md:184 and :334 are kept better than before: e5#2 re-reads only the account on screen, and e3a#1 means a site hears only its own account's chain.
- CLAIMS.md and the verification READMEs: PolicyLines*AnyTx cover 0, 2-3, 4 and 5 lines. Hypotheses checked against the Lean statements: mix_logic_accepts_iff takes the reference inputs' validTxOutValue, one_shot_mint_accepts_iff the outputs' plus validMintValue, and BoxPurposesAll.every_context_iff, reference_holder_every_context_errors and the Seedelf headline theorems take none. isBalanced (CardanoLedgerApi V3 Contexts.lean:1209) has no deposit, refund, withdrawal or donation term. FalsifiedBox/FalsifiedOwner cover exactly the families named; Mix, Owner3/4 and Fee* have no control. Signers4..128 is 125 lengths with controls at 4/64/127/128. Rule 8's "❌ Unexpected Valid" is logErrorAt (Blaster Smt/Env.lean:60), so it fails the build. check.sh's forget() and SORRY verdicts, tally.py's and count.py's NO TRACE/STALE, and run-all.sh's nonzero exit with the failed families all hold. The cited theorems' #print axioms are under #guard_msgs. No current .lake trace holds a sorry, so the new SORRY rule doesn't newly fail the standard suites.

## Notes

- r2docs#2's gap is wider than the doc line. A site can hand signTx a transaction carrying no metadata while the body's auxiliary_data_hash commits to some. The window then shows neither 'It carries metadata' nor a note, and the site lands the committed metadata under the account's signature. By COMMON's 'signs something other than what it shows', the owner may grade that above low, though no funds move. G5 left the window line as the owner's words. x1a#3's new line has the same input, so the fix is bypassed this way.
- The sign window's dappUi.warn.noRegister says 'without a register' for a register whose public value is the identity, which spender calls Anyone. The UI wording lags d1#3's three-way split; Transaction details says tx.out.warn.anyoneCanSpend for the same case. privacy.md:336's 'the window warns' still holds, so this is UI words, not a doc finding.
- seedelf-platform/README.md says the CLI says 'may have gone through' when Koios 'answers with something other than the id'. koios.rs:676 accepts any JSON string on a 2xx without comparing it to the transaction's id (the signing page does compare). That matters only if Koios is dishonest, which is out of scope, but the code is looser than the words.
- receivedOf (sessions.ts:6575-6590) counts every new return's `brought` but only the latest older return, through `received`: a session from before this release with two older returns under-counts. flows.md:478's 'every later return's' holds for new sessions only.
- Operational, for the owner: once the store release rolls out, every mainnet wallet with a sealed record asks the data layer for a full snapshot at its first private read, and re-checks every contract row on the device (wasm/README's restore cost). Expect a burst on the API and a one-off delay on large contracts.
- Whether r2docs#5's one-time re-reads need a dated privacy-policy Changes entry is the owner's call; they reveal nothing new.
- I made no copies or mutants, so there is nothing to remove under ~/.cache/seedelf-review-51/R2docs. My only file is a small diff helper in the scratch folder (tmpfs).

## Coverage

Read in full: COMMON.md, FIX.md, fix-branches.md, RESUME.md and fixes/G1-G6.md. G7-G10 have no report in fixes/, so I worked from their commit messages (8fd738ff, c8003eda, 10a06db6, c4b7a906, 40883a55). I read every changed .md line of the round, sentence by sentence, from `git diff main..HEAD` over all 13 files: architecture.md, flows.md, privacy.md, keys-and-accounts.md, lovejoin-mix-width.md, wasm/README.md, README.md, seedelf-platform/README.md, CLAIMS.md, the seedelf-verification README, Audit/README.md, and Lovejoin/AnyTx and Lovejoin/Every READMEs. For each line I read the code it names.\n- Web wallet: balances.ts (atContract, spendableOwned, seedelfSide), contract-scan.ts's diff and utxoOf, private-index.ts utxoOf, coin-control.ts (collateralFits, collateralOf, listed), destination.ts's diff, chain.ts registerOf, cip30.rs (spender, register_fields, the paid loop, note_of), decode.rs (register_detail, MOST_DECIMAL_BYTES, address_detail), PlutusTree.tsx's Copy JSON, DappApprovals.tsx's callouts and notes, ui/dapp.ts (shownSiteText, paidTo), dapp.ts (sessionCollateral, besideNote, outputsOf callers), cbor.ts, the parts of lovejoin.ts and sessions.ts each doc line names (refusesEvery, SentMeanwhile, stillUnder, partsUnlisted, mix fields, receivedOf, sendBack and sendChain's strangers handling), Swaps.tsx Timeline and backStepText, lovejoin-pools.ts's diff, PhraseInput.tsx, i18n-critical.mjs's diff, App.tsx's diff and the en.json strings named.\n- Core and the CLI: build.rs is_payable, eval.rs's decoders, cbor.rs, utxos.rs (at_wallet_contract, collect_address_utxos), the CLI's web_server.rs, static/index.js, submit.rs, sweep.rs, external/sweep.rs, rows.rs and fund.rs, and seedelf-koios submit_tx.\n- The deployed wallet.ak and schnorr.ak at 5b82530.\n- Verification: check.sh, tally.py, Audit/count.py, Audit/run-all.sh, the new control files' headers, the PolicyLines*AnyTx headers, the Lean statements of every theorem CLAIMS.md cites plus LogicBoxComposition and LogicLedgerUniqueness, CardanoLedgerApi's isBalanced, validReferenceInputs, validTxOutValue and validMintValue, Blaster's logResult, and a scan of every .lake trace for sorry and Undetermined.\n\nSkimmed, by section or grep: privacy.md (lines 176-190, 225-276, 326-350, 405-455, 485-501), architecture.md (179-206, 335-370, 425, 521-601, 640-720), flows.md (137-146, 225-229, 414, 430-431, 473-478, 506-529), keys-and-accounts.md (120-132), and the backlog and archive greps for known_check.\n\nNot reached: the rest of the three large design docs line by line, extension/README.md, INDEX.md beyond greps, and the code of G7's screen changes beyond what a doc line names. I ran nothing and built nothing: these findings come from reading the code, not from runs.
