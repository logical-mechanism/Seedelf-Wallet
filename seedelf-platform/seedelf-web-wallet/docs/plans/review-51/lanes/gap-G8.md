# Lane gap G8

Returned by the workflow's agent `a71cae5d536ae334a`, written here by the lead from its structured answer.

## Findings (9)

### gap-g8#1 · low · Create Seedelf refuses any tag with a character outside printable ASCII (an accent, kana), though the deployed policy takes any bytes and keeps the first 15

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/shared/label.ts:10`
- **Who:** user · **Since:** 58aff03b (chunk 8, 2026-09-23), in 1.0.0 · **Confidence:** traced
- **Needs the owner:** It changes what Create Seedelf accepts. Chunk 8 chose "printable ASCII, at most 15" (chunk-08-create-seedelf.md:56, noting "On chain it's any bytes, cut to 15"), before the owner's 2026-10-19 rule.

**Scenario:**

A user on the Spanish or Japanese wallet types the tag "José" (5 bytes of UTF-8) or "さくら" (9 bytes) on Create a Seedelf. The field says "A tag can't use “é”. Use plain letters (no accents)…" and Review stays off. WebAssembly's check_label refuses the same tag if the worker is asked. The policy at 5b82530 takes the tag as a redeemer ByteArray and keeps its first 15 bytes. Core's builders already write the tag's UTF-8 bytes cut at 15 into both the redeemer and the token name. So the mint the user asked for is one the chain and the contract accept. No money is at stake: the user just can't have the tag they want.

**Evidence:**

- extension/src/shared/label.ts:9-13: `const bad = [...label].find((c) => c < " " || c > "~"); if (bad !== undefined) return t("shared.label.warn.badCharacter", …)`.
- ui/screens/CreateSeedelf.tsx:75 `const problem = labelProblem(label)`, :179 `disabled={!!problem || busy || !!blocked}`, :203 `maxLength={LABEL_MAX}`.
- wasm/src/lib.rs:2097-2104 check_label: `if let Some(c) = label.chars().find(|c| !(' '..='~').contains(c)) { bail!("A label can use letters, digits, spaces and ASCII punctuation, not {c:?}") }`. It is called at :2402 (stealth mint) and :2800 (account_mint_plan).
- en.json: shared.label.warn.badCharacter = "A tag can't use “{{character}}”. Use plain letters (no accents), digits, spaces and punctuation."; mint.tagRules = ". Up to {{max}} plain characters, no accents."
- The deployed policy, from `git show 5b82530:seedelf-contracts/...`:
  - validators/seedelf.ak:19 `mint(personal_tag: ByteArray, …)`, and :60 `generate(id, idx, seedelf, personal_tag)`.
  - lib/token_name.ak:27 `let trimmed_personal: ByteArray = bytearray.slice(personal, 0, 14)`.
  - No rule on the bytes.
- Core already handles any UTF-8:
  - seedelf-core/src/transaction.rs:115-116 `let mut label_hex = hex::encode(label); label_hex.truncate(30)`.
  - data_structures.rs:27-29 is the same for the redeemer.
  - So the token name and the redeemer match the policy's 15-byte slice.
- Read-back: background/chain.ts:214-223 seedelfLabel takes only the printable ASCII run, so this wallet would show a UTF-8 tag as none. The whole name is always shown beside it.
- Pinned by e2e/extension.spec.ts:2508-2509 (`tag.fill("héllo")` expects "A tag can't use “é”") and wasm/tests/mint.test.mjs:56.

**Fix:**

The owner's call: drop the rule, or warn.

**Accepting any text:**
- Count UTF-8 bytes, at most 15, so the policy's cut never splits a character. The field's maxLength and `label.length` count UTF-16 units, so they would change too.
- Refuse nothing else, or only control characters.
- Say under the field that some wallets show a tag outside plain ASCII differently.
- Encode the tag as UTF-8 in tokenNamePrefix's preview. It uses charCodeAt today.
- Widen chain.ts seedelfLabel to decode the window as UTF-8. Stop at the first control or invalid byte, and clean the result as format.ts plainName does (bidi and invisible characters, e9b#1/e3a#3's class).
- Change wasm check_label the same way.

**Keeping it:** reword the note so it says that the wallet reads tags back as plain characters, not that a tag can't be anything else.

**Known check:**

Searched docs/backlog.md (Declined, ❓, ⬜), docs/archive/plans/*.md and the review-51 lanes for printable, check_label, labelProblem, personal tag, ASCII, accents and badCharacter.
- Hits: chunk-08-create-seedelf.md:56 and :108 (the decision, pre-rule), flows.md:336 (describes it), roadmap-v1.md:503/589.
- Lane checked-lists only: W1b.md:95, E5.md:104, X1b.md:112/120.
- The critic listed it as unswept.
- No Not fixed, Left open or open-call entry, and nothing in INDEX.md.

### gap-g8#2 · low · Public Send refuses the user's own Seedelf, alone or among other recipients, though the ledger takes it and core and WebAssembly build it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/send.ts:179`
- **Who:** user · **Since:** c3bc3930 (chunk 14, 2026-09-24), in 1.0.0 · **Confidence:** traced
- **Needs the owner:** It changes what Send accepts, against chunk 14's built rule. The owner's chunk 9 call and the 2026-10-19 rule point the other way. The history fix goes with it (gap-g1#2).

**Scenario:**

On Send from the public account, a user adds two recipients in one payment: a friend's address for 10 ₳ and their own Seedelf's name for 50 ₳. The To field turns red with "That Seedelf is yours. To put money into your private balance, use Make private.", and the worker refuses the build the same way. The transaction is valid: core pays a Seedelf under a fresh re-randomization of its register, and WebAssembly has no rule against the wallet's own. So the user must make two transactions, paying a second fee (about 0.17 ₳) and leaving two sends close in time. A single payment to the own Seedelf is pointed at Make private, which does about the same. The owner's chunk 9 call allowed paying one's own Seedelf from the private side, with a warning.

**Evidence:**

- background/send.ts:176-182: `function seedelf(view, network, name) { const recipient = seedelfUtxo(view, name, network); if (holdsOwn(view, recipient)) throw new Error(OWN_SEEDELF_FROM_ACCOUNT()); … }`.
- ui/components/Destination.tsx:72: `s.own ? { state: "error", message: OWN_SEEDELF_FROM_ACCOUNT() } : { state: "seedelf", seedelf: s }`.
- The builders accept it:
  - wasm/src/lib.rs:1640-1656: SendTo::read takes any payable Seedelf via recipient_register.
  - core build.rs:785-791: account_send_many checks only `check_register(owner)` (is_payable).
- chunk-14-style-flow-2.md:30: "Your own Seedelf is refused, pointing to Move in, which does the same thing (and a payment to yourself would show as "received" in the Seedelf history)".
- chunk-09-transfer.md:53/:60, the owner on 2026-09-24: "Paying your own Seedelf | Allowed, with a warning (the plan suggested refusing) | … it's the user's call". That is the private Send's to_self.
- The stated reason is the wallet's own bookkeeping. gap-g1#2 shows why it matters: a received-classed payment from one's own account is taken first by stealth mints and fundings.
- Pinned by extension/tests/send.test.ts:188-195.

**Fix:**

- Accept it, as Transfer does: mark the payment to_self, and say on the review that it comes back into the private balance, as Make private does.
- Record those outputs' history as made private from the account (shared/histories madePrivate), as move-in.ts does, so gap-g1#2's misreading can't follow.
- The class: Destination.tsx:72 and send.ts:179 are the only two places.

**Known check:**

Searched backlog.md, archive/plans and the lanes for "own Seedelf", ownFromAccount, OWN_SEEDELF and "your own Seedelf".
- Hits: chunk-14-style-flow-2.md:30 (the rule and its reason), chunk-09-transfer.md:53/60 (the owner's opposite call for the private Send), flows.md:231.
- E5.md:113 raised it for the owner as a note, not a finding.
- Not in the backlog, any Not fixed list or INDEX.md.

### gap-g8#3 · low · Send's note is cut to 64 characters and core refuses more, though CIP-20's message holds as many 64-byte lines as fit, which core already splits into

- **Where:** `seedelf-platform/seedelf-core/src/note.rs:49`
- **Who:** user · **Since:** 2185c4b3 (chunk 14, 2026-09-24), in 1.0.0 · **Confidence:** traced
- **Needs the owner:** It changes what Send's note box accepts. Chunk 14 chose Lace's 64, before the 2026-10-19 rule.

**Scenario:**

A user pastes a 120-character payment reference into Send's note. The box keeps the first 64 characters and says "Cut to 64 characters, the most a note can hold." Core's Note::new refuses anything longer, and tabs or line breaks too. The ledger takes label 674's msg as a list of strings, each at most 64 bytes, with no limit on how many but the transaction's 16 KiB. Core's own split() already cuts a note into such lines, and the fee already pays for its bytes: about 0.0053 ₳ for 120 bytes. So the recipient sees half the reference. The words also claim a limit the chain doesn't have.

**Evidence:**

- seedelf-core/src/note.rs:23 `pub const MAX_NOTE_CHARS: usize = 64;` ("one of CIP-20's lines, as Lace allows").
- note.rs:45-50: `if text.chars().any(char::is_control) { bail!("A note is one line of text, with no tabs or line breaks") } … if chars > MAX_NOTE_CHARS { bail!(…) }`.
- note.rs:106-127 `split`: lines of at most MAX_LINE_BYTES (64), cut at a space.
- ui/screens/CardanoSend.tsx:52 `const NOTE_MAX = 64;`, and :366-367 `setNoteCut(chars.length > NOTE_MAX); setNote(chars.slice(0, NOTE_MAX).join(""))`.
- en.json send.note.cut = "Cut to {{max}} characters, the most a note can hold.", pinned by e2e/extension.spec.ts:4919-4920.
- chunk-14-style-flow-2.md:36: "one line of at most 64 characters (Lace's limit)".
- The ledger's only bound on the metadata is the transaction size. Core's settle checks MAX_TX_SIZE (build.rs:272-275).

**Fix:**

- Raise MAX_NOTE_CHARS and NOTE_MAX to a few hundred characters, or drop the count and let settle's 16 KiB refuse in words.
- Keep the counter and the "anyone can read it" line.
- Line breaks could become CIP-20's lines, rather than being refused.
- If the owner keeps 64, reword send.note.cut so it doesn't say that's all a note can hold ("as Lace does"). Back-translate it.

**Known check:**

Searched backlog.md, archive/plans and the lanes for CIP-20, MAX_NOTE, "64 characters", "Add a note" and note.cut.
- chunk-14-style-flow-2.md:36/50: the design (Lace's limit) and a UTF-16 fix.
- usability-review.md:428 and PY-12: only the cut's notice.
- Nothing in the backlog, Not fixed lists or INDEX.md.

### gap-g8#4 · low · A payment pays at most 20 recipients, on either side, though the ledger takes as many outputs as fit 16 KiB, which core already checks

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/shared/recipients.ts:7`
- **Who:** user · **Since:** c3bc3930 (chunk 14, 2026-09-24), in 1.0.0 · **Confidence:** traced
- **Needs the owner:** It changes how many recipients Send, private Send and Make public offer. Chunk 14 built "up to 20", before the 2026-10-19 rule.

**Scenario:**

A user pays 25 people from the public account, or 25 Seedelfs privately. After the 20th card, Add recipient becomes "A payment pays at most 20 recipients.", and the worker and WebAssembly refuse a 21st. Twenty-five ADA-only base-address outputs are about 25 × 65 ≈ 1.6 KB. Twenty-five Seedelf outputs (about 160 bytes each with the register) are about 4 KB. Both are far under 16 KiB, and core's settle refuses anything over it in words. So the user must send two transactions: a second fee (about 0.17 ₳ public, or a second giveme.my-witnessed spend privately). On the private side, the two spends are then tied by timing.

**Evidence:**

- shared/recipients.ts:7 `export const MAX_RECIPIENTS = 20;`, and :10-13 checkRecipients throws shared.recipients.tooMany. It is called by background/send.ts:66, transfer.ts:86 and withdraw.ts:84.
- wasm/src/lib.rs:1535-1546: `pub const MAX_RECIPIENTS: usize = 20; … if n > MAX_RECIPIENTS { bail!("A payment pays at most {MAX_RECIPIENTS} recipients at once, not {n}") }`. It is called at :1678 (account_send), :3038 (transfer_plan) and :3384 (withdrawal_of).
- ui/components/Recipients.tsx:44 (add stops at the cap) and :114-117 (the note in place of Add recipient).
- Core has no count rule: account_send_many (build.rs:772-801), payment_outputs (3216-3253) and address_outputs (3454-3463). Its size rule is settle's `if size > MAX_TX_SIZE { return Err(TooLarge::Transaction(size).into()) }` (build.rs:272-275).
- The comment at recipients.ts:1-3 says so too: "core refuses a transaction over the network's 16 KiB whatever the count".
- Several recipients never go in parts (one transaction), so that check is the one that applies.

**Fix:**

- Drop the count, or raise it well past use (say 100), so the form keeps a sane card list.
- Let core's TooLarge refuse what doesn't fit, in its words ("Send fewer tokens, or pay fewer recipients, at once").
- Change the TS and WebAssembly copies together.

**Known check:**

Searched backlog.md, archive/plans and the lanes for MAX_RECIPIENTS, "20 recipients", "up to 20" and recipients.atMost.
- chunk-14-style-flow-2.md:30-31 (item 3, built) and flows.md describe it.
- No decision of the owner on the number, and no Not fixed entry or INDEX.md entry.

### gap-g8#5 · low · signTx and submitTx refuse a site's transaction whose outer array or body map is written indefinite-length, which the ledger and the WebAssembly decoder both take

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/cbor.ts:123`
- **Who:** site · **Since:** fe8b7748 / 3e7b5665 (chunk 15, 2026-09-24), in 1.0.0 · **Confidence:** traced
- **Needs the owner:** It changes which site transactions the connector reads, signs and submits.

**Scenario:**

A dApp's library writes the transaction as 9f <body> <witnesses> f5 f6 ff (an indefinite-length outer array), or the body as an indefinite-length map (bf … ff). It calls signTx, or submitTx with a signed copy. bodyField throws "not a 4-item transaction array" or "the transaction body isn't a map", and the site hears InvalidRequest "The wallet can't read this transaction." The ledger decodes both forms and hashes the body as written. Pallas's derived decoders and core's tx_id read both too. So the user can't sign or send a valid transaction from that site through this wallet.

**Evidence:**

- background/cbor.ts:122-125: `if (tx[0] !== 0x84) throw new Error(t("worker.cbor.notFourItems")); const body = head(tx, 1); if (body.major !== 5 || body.indefinite) throw new Error(t("worker.cbor.bodyNotMap"))`.
- cbor.ts:208-210 txId has the same 0x84 check.
- background/dapp.ts:2141-2148: signTx's `bodyOutpoints(bytes, 0)` in a try that throws `invalid("dapp.cannotReadTx")`. dapp.ts:2556-2563: submitTx's `txId(bytes)` does the same.
- The ledger, read with grep in the local cardano-ledger conway-1.19 copy (review-1.8.1-scratch/.../ledger-conway-1.19):
  - eras/alonzo/impl/src/Cardano/Ledger/Alonzo/Tx.hs:438-450: Conway's Tx is AlonzoTx, decoded with `Ann (RecD AlonzoTx)`.
  - libs/cardano-ledger-binary/.../Decoding/Coders.hs:454: `decodeCount (RecD cn) n = decodeRecordNamed "RecD" …`.
  - Decoding/Decoder.hs:661-670: decodeListLikeT `lenOrIndef <- decodeListLenOrIndef … Nothing -> … decodeBreakOr`.
  - The Conway body is SparseKeyed (Conway/TxBody/Internal.hs:179). Coders.hs:524-528: decodeSparse `lenOrIndef <- decodeMapLenOrIndef … Nothing -> getSparseBlockIndef`.
- Pallas: ~/.cargo/registry/.../minicbor-derive-0.15.3/src/decode.rs:338-375 reads `None` lengths until a break, for arrays and maps.
- Core: build.rs:1201-1210 tx_id uses `decoder.array()` then skip, so both forms work.
- The wallet's own CIP-30 amount reader already says "Lenient about encodings: definite or indefinite lengths" (cip30.rs:376).
- tests/cbor.test.ts:15 `"84bf", // an indefinite map with no break: looped forever before` is why the body check exists. That case is malformed and must still throw.

**Fix:**

In cbor.ts:
- Accept 0x9f as the outer array: four items, then 0xff.
- Read an indefinite body map entry by entry until 0xff. head() already throws at the buffer's end, as skip() does for indefinite items, so the old loop can't come back. Keep '84bf' (no break) throwing.
- Do the same in txId.

The class, lower priority (used only for a session's Minswap transaction, which Minswap writes definite):
- cip30.rs attach_witnesses' `d.array() != Some(4)` (cip30.rs:2062-2067).
- raw_map and raw_vkeys refuse indefinite witness sets and lists (cip30.rs:2010-2045).

A Vitest case: a 9f…ff transaction and a bf…ff body, each with one input, read by txInputs and txId with the same id as the definite form's hash of its own body bytes.

**Known check:**

Searched backlog.md, archive/plans and the lanes for indefinite, notFourItems, bodyNotMap, "4-item" and 0x84.
- backlog's Leios line covers only Dijkstra's three-element transaction.
- E5.md:109 raised this shape as a note for E3a. It hadn't traced Pallas, done here.
- E3a.md:130 covers keptApart only.
- No Not fixed entry or INDEX.md entry.

### gap-g8#6 · low · A pool's start refuses a box value between the box's own minimum and S0d's least (3.45 ₳ for ADA), though one_shot_mint takes any box over its fee cap, and the wallet shows and mixes into such pools others launch

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:258`
- **Who:** user · **Since:** 84c2775f (chunk 34d, 2026-10-17), in 1.6.0 · **Confidence:** traced
- **Needs the owner:** It changes what the launch form accepts. The bound is recorded under the owner's session 1 decision 14 (2026-10-17), before the 2026-10-19 rule and call 34. gap-g5#1's open choice decides which way it should go.

**Scenario:**

A user starts an ADA pool of 3 ₳ boxes on mainnet, or 2 ₳ (Lovejoin's own default). The form says "Each box needs at least 3.45 ₳ under today's network fees: enough to pay its own way back, and then to pay out part of what came back without other money." Review stays off, and the worker refuses the same build. one_shot_mint (Lovejoin 29573c5) checks only `box_lovelace > 0`, `max_fee > 0` and `max_fee < box_lovelace`, and the wallet's own max_fee would be 1.5 ₳, under 3 ₳. The ledger's limit is the box's min-UTxO, about 1.63 ₳ by gap-g5#1's figures. Since call 34, a pool whose boxes can't come back by themselves takes new boxes with a warning. Per gap-g5#1, the same pool launched elsewhere is shown, picked by default and mixed into by this wallet. So the wallet refuses to start a pool that it would show and use.

**Evidence:**

- background/lovejoin-launch.ts:257-258: `const value = await this.boxValue(…); if (box < BigInt(value.least)) throw new Error(t("lj.launch.tooLittle", { least: adaWords(value.least) }))`.
- ui/screens/LovejoinLaunch.tsx:161-162: `BigInt(box) < BigInt(terms.least) ? tr("lj.launch.tooLittle", …)` in `why`, and :394 `disabled={busy || !terms || !!why}`.
- wasm/src/lovejoin.rs:2958-2960: "The least at which a box comes back and pays part of itself on its own (`lovejoin::least_box_lovelace`): no launch goes below it."
- seedelf-core/src/lovejoin/box_value.rs:8-23: step 2 is a wallet policy, "from what came back alone, a payment of part of it". tests/lovejoin_box_value_test.rs:77 `ADA_MEASURED: u64 = 3_450_000`.
- Lovejoin 29573c5 contracts/validators/one_shot_mint.ak: `let datum_sane = and { parsed.box_lovelace > 0, parsed.max_fee_per_mix_lovelace > 0, parsed.max_fee_per_mix_lovelace < parsed.box_lovelace, token_sane(parsed) }`.
- lovejoin-launch.ts:260: maxFee = min(box − 1, 1.5 ₳).
- chunk-34-token-pools.md:
  - :80-86, session 1 decision 14 (2026-10-17): "The creator may change it ('there is a lowerbound to the ada because of the token and datum'). The lower bound is S0d's". The owner's quote is about the token and datum, which is the min-UTxO.
  - :1244, call 34 (2026-10-19): "A mix that passes the logic is allowed … a pool whose boxes can't come back … takes new boxes from every flow". It covered joining, not the launch.
- gap-g5#1 (INDEX.md): such pools launched elsewhere are shown with no word. Its fix offers (a) hide them or (b) flag them.

**Fix:**

Decide it together with gap-g5#1.
- **(b), such pools shown with a flag:** make the launch's S0d bound the same warning on the review ("what comes back can't pay part of itself without other money"). Refuse only below the box's own minimum, as usable's BelowMinimum does (pool.rs:602), and one_shot_mint's own ranges.
- **(a), such pools not standard:** the refusal stands, said as the copy rule is: no wallet would show the pool, and what it locks would be gone.
- The 9 ₳ token-box cap (decision 27) is the owner's own and isn't part of this.

**Known check:**

Searched backlog.md, archive/plans and the lanes for S0d, least, tooLittle, "box value", "call 34" and "lower bound".
- chunk-34's decision 14, the S0d groundwork table, call 34 (joining only) and line 1554 ("never below S0d's bound"): design records, not leftovers.
- gap-g5#1 is the found-pool side of the same bound, not the launch's refusal.
- No Not fixed or open-call entry.

### gap-g8#7 · low · Swaps refuse a slippage outside 0.1% to 20%, though the order is valid at any minimum and the form already warns from 5%

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:836`
- **Who:** user · **Since:** b858d22e (chunk 15 step 2, 2026-09-24), in 1.0.0 · **Confidence:** traced
- **Needs the owner:** It changes what the swap form accepts. The 2026-10-19 rule allows a warning at most for a risky but valid choice.

**Scenario:**

A user swapping a thin-liquidity token sets their own slippage to 25%, or 0.05% for a stablecoin pair. The field reads nothing (parseSlippage gives undefined), and checkAsk refuses any ask outside the range: "Slippage is between 0.1% and 20%." The DEX order's minimum out is amountOut / (1 + slippage%), and the order contracts take any minimum. A high slippage is the textbook risky but valid choice: the wallet already warns from 5% on the form and the review. Whether Minswap's estimate and build-tx take a value past 20% wasn't checked (no network): look it up with an estimate at 25% and at 0.05%.

**Evidence:**

- background/sessions.ts:836: `if (!(ask.slippage >= 0.1 && ask.slippage <= 20)) throw new Error(t("sess.slippageRange"))`. en.json sess.slippageRange = "Slippage is between 0.1% and 20%."
- ui/swap.ts:209-211 `SLIPPAGE_MIN = 0.1; SLIPPAGE_MAX = 20`, and :264-270 parseSlippage `return n >= SLIPPAGE_MIN && n <= SLIPPAGE_MAX ? n : undefined`.
- swap.ts:216 SLIPPAGE_HIGH = 5, the warning (Swaps.tsx:1223, :1355, :2064).
- background/minswap.ts:379-383 (Minswap puts its own minimum in the order, amount_out / (1 + slippage%)) and :470-475 (slippage passed as asked).
- flows.md:467 describes the range. No decision of the owner on it.

**Fix:**

- Take whatever Minswap's API takes (look it up), or any 0 < s < 100.
- Keep the ≥5% warning and add a stronger line past 20%: most of the expected output can then go to price moves and front-running.
- Change parseSlippage and checkAsk together.

**Known check:**

Searched backlog.md, archive/plans and the lanes for slippage, SLIPPAGE_MAX, slippageRange and 20%.
- flows.md:467, usability DX-4 (fixed: the chip) and chunk 15b: the design only.
- Nothing settled, and nothing in INDEX.md.

### gap-g8#8 · low · A swap into a token that's neither on the wallet's list nor verified by Minswap is refused outright, though the DEX's contracts and the order take any token: a warning would do

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1919`
- **Who:** user · **Since:** c703ee2c (launch review #20, 2026-09-27), in 1.0.0 · **Confidence:** traced
- **Needs the owner:** It changes what the swap form offers, against launch review #20's fix as built. The 2026-10-19 rule allows a warning at most.

**Scenario:**

A user wants more of a newly launched token they already hold. Minswap pools it but hasn't verified it, and it isn't on the wallet's list. In the picker's "Also held" list it's offered. After the quote, the form shows "Not verified by Minswap … so the wallet won't swap into it" and Review stays off. outBuild refuses the funding the same way. The order Minswap would build is valid on chain, and the DEX takes any token it has a pool for. The callout already names the token by its fingerprint, which is what tells a lookalike apart. Launch review #20 asked to "list unverified tokens apart". The build went further and refused.

**Evidence:**

- background/sessions.ts:827-828: `const UNVERIFIED = () => t("sess.unverified")`.
- sessions.ts:1899-1905: verified() is true only for ADA, a LISTED token, or one Minswap's search marks is_verified.
- sessions.ts:1919: `if (!(await this.verified(network, ask.tokenOut))) throw new Error(UNVERIFIED())`.
- ui/screens/Swaps.tsx:760-761: `const unverified = current?.verified === false; const ready = !!current && !tooMuch && !short && !unverified && !quoteError`.
- Swaps.tsx:1711-1728: the Unverified callout, "Review stays off: the worker refuses to fund it".
- en.json swaps.warn.unverified = "{{token}} isn't on the wallet's list, and Minswap doesn't verify its ID, so the wallet won't swap into it. Anyone can copy a known token's name."
- sessions.ts:1577-1589: the picker's search lists verified tokens only. So an unverified token not held can't be picked at all, the same refusal one step earlier.
- launch-review.md:240 (#20): "Check `tokenOut` in the worker, and list unverified tokens apart."

**Fix:**

- Keep the callout with the fingerprint and the full id.
- Put Review behind a switch ("Swap into it anyway"), as the sign window's release warning does.
- Have the worker take the approval's switch, so it still refuses one the user didn't confirm.
- Optionally, let the search show unverified matches apart, with the same mark.

**Known check:**

Searched backlog.md, archive/plans and the lanes for unverified, "verified by Minswap", sess.unverified and #20.
- launch-review.md:240 (the finding, whose fix said "list apart"), usability-review.md:351 (the Unverified badge).
- No decision of the owner to refuse, no Not fixed entry, and nothing in INDEX.md.

### gap-g8#9 · low · A Seedelf mint from the public account fails outright when its largest ADA-only UTxO is past output #255, though a mint whose first input has a smaller index is one the policy takes

- **Where:** `seedelf-platform/seedelf-core/src/build.rs:3898`
- **Who:** user · **Since:** 97be888f (the index check) and 719b1538 (account_mint, chunk 8b), both 2026-09-23, in 1.0.0 · **Confidence:** traced
- **Needs the owner:** It changes which UTxOs a mint spends and stops refusing a mint the policy takes. No product question: a selection fix the owner can wave through.

**Scenario:**

The user's largest ADA-only UTxO is output #300 of an airdrop or exchange batch, with hundreds of small enterprise outputs before it. They press Create a Seedelf, paid from the public account. account_mint tries inputs largest first, so k = 1 is that UTxO alone. seedelf_token_name bails ("A Seedelf can't be named after output #300 of a transaction (the contract takes a one-byte index)"), and the `?` returns at once. No other set is tried, though the account holds other UTxOs, and a mint whose first input in ledger order has an index ≤ 255 is one the policy takes. That could be another UTxO alone, or this one with an input whose transaction id sorts first. The words don't say the way out, which is to lock that UTxO on the UTxOs screen or spend it first. A stealth mint in the CLI's order (select_script_inputs' blind path, as in a restored wallet) stops the same way. The history-aware path goes on past it.

**Evidence:**

- build.rs:3797-3816 account_inputs: pure ADA first, largest first.
- build.rs:3891-3898: `for k in 1..=spendable.len() { let inputs = &spendable[..k]; … let token_name = seedelf_token_name(label.to_string(), Some(&owned))?;`. It returns before `match mint.estimate()`, the only place NotEnough lets the loop go on (3915-3919).
- transaction.rs:128-135: `if smallest_input.txo_index > 255 { anyhow::bail!("A Seedelf can't be named after output #{} …") }`. This is right for that set: 5b82530 lib/token_name.ak:24 `bytearray.push(txid, idx)` is consByteString, which fails outside 0..255 under V3 (V1.md:18).
- The policy names the token after the first input in ledger order (seedelf.ak:57-60 `expect [input, ..] = inputs`). So another set with a smaller first input passes.
- Stealth mint: build.rs:2569-2578 (blind path), `Err(e) if … NotEnough … => last_error = Some(e), Err(e) => return Err(e)`. apart's try_with marks it Failed and one_more tries the next single (2688-2700, 2603-2629).
- Pinned: seedelf-core/tests/transaction_test.rs:145 token_name_refuses_an_index_past_one_byte (the naming refusal itself, which stays right).
- Reach: a base-address output at index ≥ 256 needs a transaction of ≥ 257 outputs, possible only when most of them are small enterprise outputs (16 KiB). Rare.

**Fix:**

- In account_mint, order spendable so a UTxO past #255 never comes first alone. Put such UTxOs last, or skip them while any set without them pays.
- Or treat the naming refusal as a reason to try the next set, as a shortfall is.
- Do the same in select_script_inputs' blind path: treat it as a failed attempt and go on, as apart does.
- A core test: two ADA-only UTxOs, the larger at index 300. account_mint should build with the other as its first input.

**Known check:**

Searched backlog.md, archive/plans and the lanes for "one-byte index", 255, "output #256" and txo_index.
- chunk-40 and V1.md:18 prove the policy's 0..255 rule.
- transaction_test.rs:145 pins the naming refusal.
- Nothing on selection stopping at it. r2a#2 is apart's early stop for payments, a different path.

## Guards (15)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-core/src/build.rs:3107` | is_payable: paying (or minting under) a register with a non-decoding, torsion or identity point, which locks the payment or lets anyone take it | seedelf-core/tests/mint_test.rs:1935 and :2466 refuses_what_would_lose_money; build_test.rs:983 send_refuses_what_would_lose_money |
| `seedelf-platform/seedelf-core/src/build.rs:3290` | check_payable: an output to a script, stake or other-network address (a datum-less script output can be locked or taken) | seedelf-core/tests/mint_test.rs:2484-2501 (script_stake pinned refused: r2a#1) |
| `seedelf-platform/seedelf-core/src/transaction.rs:130` | A Seedelf named after an input past #255, a mint the policy's consByteString would fail | seedelf-core/tests/transaction_test.rs:145 token_name_refuses_an_index_past_one_byte |
| `seedelf-platform/seedelf-core/src/build.rs:103` | check_fee: a fee over 10 ₳ from wrong protocol parameters (unreachable on today's: ~9.3 ₳ is the ledger's most) | seedelf-core/tests/build_test.rs:599 a_fee_over_the_limit_is_refused_in_words |
| `seedelf-platform/seedelf-core/src/build.rs:269` | settle: an output over 5,000 value bytes or a signed transaction over 16 KiB, which the node refuses after signing | not looked up |
| `seedelf-platform/seedelf-core/src/build.rs:860` | A zero quantity of a token in a payment (Conway's outputs refuse a zero quantity); also pay_rest :1672, payment_outputs :3232, pay_address :3337 | not looked up |
| `seedelf-platform/seedelf-core/src/staking.rs:212` | A reward withdrawal while the vote isn't delegated, which Conway refuses (ConwayWdrlNotDelegatedToDRep) | not looked up |
| `seedelf-platform/seedelf-core/src/staking.rs:310` | A DRep retirement with a guessed refund: the ledger refunds exactly the deposit paid | not looked up |
| `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1313` | Signing a site's transaction whose collateral return goes to someone else while the account puts up collateral (a failing script would hand it over) | seedelf-web-wallet/wasm/tests/cip30_test.rs:915 a_collateral_return_to_someone_else_is_refused |
| `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1331` | Signing a site's transaction marked is_valid=false with the account's collateral in it | not looked up |
| `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1507` | A pool registration making the account's stake key an owner (its rewards would go to the pool's reward account): launch review #16 | seedelf-web-wallet/wasm/tests/cip30_test.rs:870 a_pool_that_makes_the_accounts_stake_key_its_owner_is_refused |
| `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1793` | A payment or DRep key signing over an input the wallet can't find (its own pending output could be taken): launch review #13 | seedelf-web-wallet/wasm/tests/cip30_test.rs:363 an_input_the_wallet_cant_find_is_unknown |
| `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1816` | The stake key signing a transaction nothing ties to this network (replayable on the other) | seedelf-web-wallet/wasm/tests/cip30_test.rs:1204 the_stake_key_never_signs_what_could_be_the_other_networks |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:2093` | A session's stake key registered or delegated by a site, whose deposit and rewards Bring it back and Disconnect would strand (launch review #15) | not looked up |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:235` | A token pool's quantity of 0 or past 2^64−1 (one_shot_mint's token_sane and the ledger's per-asset ceiling); :253 a copy of a shown pool's values, which no wallet would show | not looked up |

## Checked and holds

- Address kinds: a stake address (it can't be an output's address), another network's (the ledger's WrongNetwork) and an unreadable string are refused as the ledger would. Pointer and enterprise key addresses are accepted. The script-part and Byron refusals are r2a#1's and its merges.
- Amounts are parsed as BigInt, at most 45 billion ₳. In the web wallet, an amount under the minimum is raised to it, never refused (lib.rs account_amount 257-275, transfer_plan 3045-3051, amounts_of 3428). Core refuses one only when a caller passes it explicitly (the CLI's fund).
- Token quantities: any whole number from 1 to u64 (lib.rs assets_of 203-219). A UTxO whose tokens would push a total past one output is left out by fitting, with Max saying so, not refused.
- A Seedelf's name must be 64 hex characters starting 5eed0e1f. The policy always makes a 32-byte name (token_name.ak slice 0..31), so nothing valid is refused.
- Staking: a delegation to a retired pool (Pools.tsx:356, ledger DelegateeNotRegistered) and a vote delegation to an unregistered or retired DRep (Voting.tsx:135-144, refused since PV10) are both refused as the ledger does. So are registering a DRep twice and updating or retiring one that isn't registered. Staking's noFundsReason blocks only when no spendable UTxO exists, which the ledger needs.
- A DRep vote on a closed action is disabled, as the ledger refuses (VotingOnExpiredGovAction). Two votes on one action in one transaction are refused, as the voting map refuses duplicate keys.
- The DRep profile's CIP-119 limits (lib.rs:455-481: a name, ≤80, texts ≤1000) apply to a file the ledger never sees. Registering without a profile is offered ("Go without a profile"), so nothing the ledger takes is refused there. Anchor URLs: the 128-byte rule is the ledger's; the scheme and whitespace rules are e7b#2's class.
- Collateral: exactly 5 ₳ of ADA alone is the wallet's own convention for its account. The ledger has no account collateral. getCollateral answers null past 5 ₳ or past the UTxO, as CIP-30 says. ScriptSpend::with_account's ADA-alone rule only binds callers, and the wallet never passes it a token UTxO.
- A public mix needs the set-aside collateral (lj.needCollateral). That's a structural need of a chain that reuses it, with a way out (Set collateral).
- Lovejoin's 30-box floor, retired pools taking no box, the listed-token rule (round three 20), the 9 ₳ token-box cap (27), no 10 ₳ or copy pool (session 1, 11/14/17), and the mix_logic reward-account refusal (2026-11-06) are each the owner's own decision.
- Swap routes through DEXes the runner can't check or cancel (routesThrough, routesOutOfPlace) are refused because the runner signs its steps by itself. That's a capability need, not a user's choice.
- CIP-30's read_value takes both definite and indefinite encodings. The CBOR depth cap of 128 is the launch review's #17 guard against a stack trap.
- Restore takes 12-, 15- and 24-word phrases. "Max pays a single recipient" is a mode, not a refusal: each recipient can be given an amount.
- MAX_FEE (10 ₳) can't bite on today's parameters. The most a 16 KiB transaction can pay is 0.876 ₳ for size, 0.952 + 0.721 ₳ for the maximum execution units and about 6.72 ₳ for 200 KiB of reference scripts at 15 lovelace a byte, tiered: about 9.3 ₳ in all.

## Notes

- A third member of e7b#1's class (the same choice again is refused), for e7b#1's fix and not reported on its own:
- Governance.tsx:947 disables a DRep's vote button for the vote it already cast (`v === mine`).
- A DRep with no profile can't send an update without an anchor: Review needs one (Governance.tsx:521 and :540), and "Remove the profile" shows only when there is one (:545).
- The ledger takes both. Certs.hs:243-258 (local conway-1.19 copy) refreshes every voting DRep's expiry. GovCert.hs:260-275 refreshes it on a ConwayUpdateDRep with any anchor, SNothing included. Gov.hs has no failure for a repeated vote.
- drep.warn.inactive tells the user to "Vote or update its profile". A profile-less DRep whose live actions are all voted would be left only changing a vote or publishing a profile.
- On mainnet's parameters (gov_action_lifetime 6 < drep_activity 20) that state can't coincide with inactivity, so a note. Check preprod's two figures.
- Sign-window and connector refusals of transactions the ledger accepts that I kept out of findings. Each guards against a site, and the 2026-10-19 rule reads as being about the user's own choices:
- the collateral return to someone else (cip30.rs:1313);
- is_valid=false with own collateral (:1331);
- a pool registration naming the stake key an owner (:1507, launch review #16);
- a payment key over an input the wallet can't find (:1793, #13);
- nothing tying the network (:1816);
- nesting past 128 (#17);
- a session's stake key certificates (dapp.ts:2093, #15);
- UTxOs a Lovejoin chain holds (dapp.ts:1898);
- a mix_logic reward account (the owner, 2026-11-06).

A new fact for the owner on the settled #14 (backlog: "#14 and #15's refusals reach only the site"): dapp.ts:1855-1869 refuses a site's spend of a locked UTxO or of the set-aside collateral. The lock is the user's own choice. The collateral is only the wallet's convention, so a warning plus "set another" would meet the rule there.
- R2b's note on the Seedelf minimum (sized at a base address, 0.12 ₳ over the ledger's) stands under the owner's call 28 (chunk-34 round three, 2026-10-17: "The Seedelf minimum stays as it is").
- In the web wallet it overpays (amounts are raised), it doesn't refuse.
- Core refuses only explicit lower amounts (build.rs:3235-3241, 377-384), which the CLI's fund reaches.
- The CLI fund's exact-5 ₳ exclusion (seedelf-core/src/utxos.rs:153, used only by seedelf-cli fund.rs:128) is outside my paths. R2b's note stands, with a concrete case: a CIP-30 address holding two ADA-only 5 ₳ UTxOs (10 ₳) gets "Not Enough Lovelace/Tokens" for `fund --lovelace 3000000`, though fund runs no script and needs no collateral. For the owner with R2b's.
- A UTxO holding two Seedelf tokens under the user's register can't be Removed (build.rs:3558-3567 seedelf_in wants exactly one) or spent (lib.rs:2329-2335). contract-scan lists only its first token (chain.ts:202-205 seedelfTokenOf). The policy takes a burn of one with the other in the change. Only a stranger's planted UTxO reaches it, and its ADA is the stranger's: no loss to the user, a nit at most.
- Engineering limits that refuse a valid but bigger request, each with a way through (split it), not reported:
- MAX_MIX_BOXES 10 and depth ≤3 (lovejoin.ts:1803, wasm lovejoin.rs:2052);
- a Bootstrap of 64 boxes (71 fit with two inputs, lovejoin.ts:1823-1836);
- MAX_PARTS and MAX_WITHDRAW_UTXOS 20;
- the connector's 64 KiB signData, 8 KiB amount and per-minute limits.
- Account mint, contrived and not reported: with every account UTxO under about 1.6 ₳, its collateral-return check (build.rs:3747-3755) refuses. The ledger would take an ADA-only collateral with no return.
- The ledger facts above were read with grep only in the local cardano-ledger conway-1.19 copy under ~/.claude/projects/…/cfcbd3c7-…/review-1.8.1-scratch/review/v-pv11-impact/src/ledger-conway-1.19. Pallas's minicbor-derive 0.15.3 was read from ~/.cargo/registry. No command was run beyond reading.

## Coverage

**Read in full, line by line:**
- extension: background/destination.ts, contacts.ts, send.ts, mint.ts, cbor.ts; shared/label.ts, handles.ts, recipients.ts; ui/screens/CreateSeedelf.tsx.
- seedelf-core/src/note.rs.
- build.rs, around its refusals: 1-1300, 1500-2340, 2530-2980 and 3040-3922. Not read there: 1300-1500 (budgets and Chain) and 2340-2530 (Histories' ranks).

**Read by refusal, every one found by grep, each with its context read:**
- wasm: every bail! in lib.rs (49), cip30.rs (~35) and lovejoin.rs (~20). Read in full around them: lib.rs 170-510, 600-720, 790-830, 1520-1700, 1870-2010, 2060-2145, 2300-2345, 2790-2830, 2965-3075, 3255-3440 and 5010-5030; cip30.rs 280-395, 672-700, 1136-1380, 1490-1525, 1600-1720, 1780-1830, 1940-2110 and 2284-2345; lovejoin.rs 2040-2060, 2190-2310 and 2953-2965.
- extension background: every `throw` line listed by grep across the folder (477), with the contexts that refuse an input read. That covers staking.ts 340-574, lovejoin-launch.ts 1-300, coin-control.ts 150-420, dapp.ts (1719-1760, 1840-1930, 1991-2003, 2060-2165, 2548-2580), sessions.ts (815-870, 1570-1590, 1888-1925, 2031-2080, 2525-2565), lovejoin.ts (1795-1845, 2585-2601, 4840-4880), transfer.ts 160-190, withdraw.ts 155-198, chain.ts 205-223 and minswap.ts (25-45, 375-390, 465-480).
- ui: every `disabled=` condition in the screens. The Review and why conditions read in CardanoSend.tsx (55-195, 359-383), MoveIn.tsx, Collateral.tsx, Staking.tsx (105-120, 222), Pools.tsx, Voting.tsx, Governance.tsx (225-262, 500-560, 905-965), LovejoinLaunch.tsx (120-200), Swaps.tsx (759-761, 1705-1730, 1975-1995), swap.ts (200-275), Settings.tsx (520-560, 1610-1665), Recipients.tsx and PhraseInput.tsx. Also format.ts's amount parsing (150-330).
- en.json: the 479 refusal-like strings, by key family.

**Followed out:** the deployed seedelf.ak and token_name.ak at 5b82530; Lovejoin 29573c5's one_shot_mint.ak; the local cardano-ledger's Tx, Coders and Decoder, Certs, GovCert and Gov; minicbor-derive's decode; core transaction.rs, data_structures.rs, staking.rs, box_value.rs and utxos.rs's collect_address_utxos; and the tests that pin each refusal.

**Not reached:** wasm decode.rs, which only displays; most of lovejoin.ts's and sessions.ts's bodies beyond their refusals; Lovejoin.tsx's mix form internals beyond its why lines; the CLI; ui/styles.css.

**Checked against:** INDEX.md, the backlog, the archive plans and the lanes for every candidate. The ones the owner settled (chunk 34's decisions, calls 28 and 34-36, the 2026-11-06 mix_logic call, launch review #13-#17) are in notes, not findings.
