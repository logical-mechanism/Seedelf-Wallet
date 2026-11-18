# Lane gap G10

Returned by the workflow's agent `a348475ec673bbddb`, written here by the lead from its structured answer.

## Findings (4)

### gap-g10#1 · low · A name padded with wide spaces before one last letter passes the lookalike and shared-name checks, and the one-line lists cut it to the name it copies

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/tokens.ts:116`
- **Who:** stranger · **Since:** ead12610 (2026-09-27, tokenText's lookalike rule, launch review #18; the label's end cut is fb3e5187, 2026-09-24) and e788144e (2026-09-27, sharedNames, launch review #59). Both predate web-wallet/1.6.0. · **Confidence:** confirmed-by-run

**Scenario:**

Tokens: a stranger mints a token named "SNEK" + 9 × U+2003 EM SPACE + "x" (32 bytes, the asset-name limit) and sends the user 1,000,000 of it. tokenText finds the name readable and not posing as anything (skeleton "snekx", not "snek"), so every view names it by its own name. At 360 px the label box is 165 px and the name 172 px, so Home's token list and the Tokens page show "SNEK        …   1,000,000": the x is gone and the row reads as the listed SNEK. The Add tokens picker (Send, Send privately, Make private, Make public, a site session's top-up, the connector's funding) shows the same at 360 px. The swap card's token button shows "SNEK  …" at 360 px and "SNEK    …" at 400 px. What still tells it apart: initials "SN" instead of SNEK's logo, and a fingerprint sub line instead of "Snek". The token's details title and every review show the whole name, "1,000,000 SNEK         x", with a grey "Not on the wallet's list, asset1…". They don't show the amber "it calls itself SNEK, but it isn't the listed SNEK", because the token isn't held as a lookalike. An ideographic-space or no-break-space padding does the same.

DReps: a stranger registers a DRep whose metadata name is "8Ball" + 40 em spaces + "x" (46 characters; dreps.mjs keeps 64). sharedNames compares "8ballx" with "8ball", so the name isn't flagged. Voting's list shows "8Ball …" at both 360 and 400 px with no "Name used by another DRep" tag, beside the two real 8Balls that both carry it, so the impostor looks like the one unshared 8Ball. Its card shows "8Ball" with the x two lines down at the right, gives no shared-name warning, and shows the whole DRep ID.

Harm: a user who holds no real SNEK reads that 1,000,000 SNEK arrived and can accept it, or pay with it, as SNEK. Or a user delegates their vote to the impostor. No ADA moves by itself.

**Evidence:**

tokens.ts:113-117: `const readable = !!t.assetName && own !== shortHex(t.assetName) && !HIDDEN.test(own.replace(EMOJI, "")) && /\S/.test(own); ... const posesAs = lookalikeOf(network, own); return posesAs ? { label: id, ... } : { label: own, ... }`. tokens.ts:201-219 look names up only by whole skeleton, or after a leading run of digits/separators. The ADA-word rule (:216-218) covers ADA alone. format.ts:70-72 nameSkeleton keeps only letters and digits, so the spaces vanish but the x stays. format.ts:461-473 sharedNames uses the same skeleton. Voting.tsx:402/415 shows plainName(drep.name), and plainName (format.ts:86-88) strips Cf/DI characters but keeps spaces. The cut comes from styles.css:1811-1816 `.token-row__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }`, used at TokenList.tsx:55, TokenAmounts.tsx:267, Swaps.tsx:1911 and Voting.tsx:415, and from styles.css:2664-2699 (swap-token max-width 55%, swap-token__name ellipsis) at Swaps.tsx:644. CSS collapses only U+0020, tabs and line breaks under nowrap, so U+2003, U+3000 and U+00A0 keep their width.

Run 1: node /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/gap-G10/g10_lookalike.mjs on registry.mainnet.json and dreps/mainnet.json. It holds foldName, nameSkeleton, lookalikeOf and sharedNames copied verbatim. Output:
- `SNEK + 9 EM SPACE + x bytes=32 readable=true skeleton="snekx" posesAs=(none: goes by its own name)`; the ideographic and NBSP variants are the same.
- `HOSKY + 9 EM SPACE + .` → posesAs=HOSKY (punctuation drops), and `ADA + 9 EM SPACE + x` → posesAs=ADA (word rule).
- `8Ball rows flagged shared: true,true` and `padded "8Ball…x" ... flagged shared: false`.
SNEK is on the mainnet list (279c909f…, ticker SNEK).

Run 2: headless Chrome on a scratch copy of styles.css with the bundled Inter embedded, components' real nesting, fixed 360/400 px containers, every host unresolvable and a dead proxy, under systemd-run MemoryMax:
- Home row at 1,000,000 → 360 px: box 165, text 172, shows `SNEK        …`; 400 px: whole. At 100,000 → 360 px: whole.
- Add tokens picker at 360 px: `SNEK        …`.
- Swap button: `SNEK  …` at 360 px, `SNEK    …` at 400 px.
- DRep row: box 236/276 px, text 601 px, `8Ball             …`.
- Review row: whole.
The screenshots I viewed show the impostor rows exactly so.

**Fix:**

Fix the class: a shown name mustn't be widened past its box by characters that draw nothing.
- In tokenText's own name and in plainName, collapse every run of Unicode white space (\s, \p{Zs}) to one space, and treat other blank-drawing symbols such as U+2800 BRAILLE PATTERN BLANK (So, untested here) the same way, before display and before lookalikeOf and sharedNames. "SNEK x" then fits every list.
- Alternatively, cut names in the middle, keeping their last characters (as MiddleEllipsis does for IDs), in .token-row__label, .swap-token__name and .modal__title where they hold a name.
- Members: tokens.ts:105 tokenText, format.ts:86 plainName (DReps, stake pools), format.ts:461 sharedNames and Voting.tsx:444 drepSharing.
- A test: token-text.test.ts's "never lets one named like a listed token read as it", with "tUSDM" + " ".repeat(9) + "x" on preprod, plus a sharedNames case in ui-safety.test.ts:106.

**Known check:**

Searched backlog.md, docs/archive/plans/*.md, docs/plans/ and review-51's INDEX and data/*.json (findings, notes, checked_ok) for lookalike, whitespace, em space, ideographic, padded, ellipsis, truncat, shared name, sharedNames and 8Ball. The closest records are launch review #18 (the token-text helper), #59 (shared DRep names) and e9b#1 (Greek capitals the fold misses, a different gap). None weighs blank padding. token-text.test.ts covers tickers, names, lookalike letters, zero-width characters and digit leads, not padding.

### gap-g10#2 · low · Activity cuts a counterparty's address to its first 3 to 10 characters and its last 6, and the last 6 are a bech32 checksum anyone can solve for

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Activity.tsx:415`
- **Who:** stranger · **Since:** d423b79a (2026-10-05, AC-1's middle cut) and 8645072e (2026-10-05, the 9ch minimum), before web-wallet/1.6.0. · **Confidence:** confirmed-by-run

**Scenario:**

The user paid Bob at addr1qx2fxv2um…gse35a3x. A poisoner takes their own payment key, solves six symbols of the stake part so their address also ends in "e35a3x" (no grinding), funds it and sends the user 1 ₳ from it.

In Activity's list at 360 px the counterparty is cut in the middle, and with ordinary amounts and times the head keeps none to four characters of the payment part:
- "+1,234.5 ₳ · Today, 14:02 · add…e35a3x"
- "−250 ₳ · 23 Mar, 18:40 · addr1q…e35a3x"
- "addr1q9l…" with −12,345.678901 ₳; "addr1q9ld2…" with +1 ₳
- "addr1q…" at 400 px with +1,234.5 ₳ on "Yesterday"
So the dust's row and Bob's row read the same.

A user who takes "the address I paid" from Activity pays the poisoner. Its details show the address whole, with no copy button, so the user selects it. So does a user who checks a pasted address's tail against Activity's, as the row invites ("keeping the tail people compare"). Send's review shows the whole address, whose first characters differ. It's launch review #19's reasoning ("A ground address with the same checksum then reads as the real one"), fixed then for the sign window. Here the checksum doesn't even need grinding.

The same family:
- A Seedelf name cut by the same Who reads "5eed0e1f…" plus its last 6 hex, at 360 px. Those are 3 bytes of the minting input's transaction ID, about 2^24 tries.
- The 12+6 short form that Transfer's Found note, Destination's note and Contacts use is the fixed prefix, the minter's own tag, and those same 3 bytes.

**Evidence:**

Activity.tsx:415: `const shown = name.length > 24 && !/\s/.test(name) ? <MiddleEllipsis text={name} /> : <span>{name}</span>;`. MiddleEllipsis.tsx:68 keeps tail = 6 and cuts the head with text-overflow. styles.css:3626-3629: `/* Never less than a few first letters, the "…" and its tail */ flex: 1 1 9ch; min-width: 9ch; max-width: max-content;`. Activity.tsx:383-384 reads "An address is cut in the middle, keeping the tail people compare". The details row is at Activity.tsx:337, a plain Row, whole. Only the transaction ID gets a CopyButton (:371).

Run 1, headless Chrome on the real stylesheet: head boxes at 360 px were 33 px ("add…"), 53 ("addr1q…"), 61 ("addr1q9l…") and 77 ("addr1q9ld2…"). A "Yesterday" line wraps to its own line at 115 px ("addr1q9ld26hfxq0…"). At 400 px: 52 to 117 px. The screenshot I viewed matches.

Run 2: python3 -I /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/gap-G10/g10_tail_solve.py on CIP-19's base-address vector addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x. With a random payment hash, Gaussian elimination over GF(2) on 6 stake-part symbols gave addr1q8w9pjhjf40ysqum9knusa5c5dgmvdqn9cc8l2ny7tgem8uvtr5s4vwq832vl6dd67z8vjrcguchrvgq3h8tc6wv3dwqe35a3x. That is a valid bech32 base address with `same last six: True e35a3x | same payment part: False`, shown with 3 or 6 first characters as `add…e35a3x` / `addr1q…e35a3x` for both. Each further head character costs about 2^5 payment keys.

**Fix:**

Never let a checksum or a field the sender chooses be the kept part.
- For an address, keep a fixed run of the payment part, about 8 characters after "addr1q" (around 37 bits), plus the tail. Let Activity's sub line wrap rather than shrink the head below that: raise `.activity__sub .middle-ellipsis`'s min-width, or cut in JS with fixed parts (as Destination's shortHex(address, 14, 8) does) and let the line wrap.
- For a Seedelf name, skip the 5eed0e1f prefix and the tag, and show at least 8 hex of the transaction-ID part at each end.
- Members: Activity's Who for addresses and Seedelf names; Transfer.tsx:509, Destination.tsx:216 and Contacts.tsx:30, shortHex(name, 12, 6) on Seedelf names. Staking's pool-ID MiddleEllipsis keeps about 31 characters and is fine.

**Known check:**

Searched backlog.md and docs/archive/plans/*.md for checksum, poison, middle, cut in the middle, tail, AC-1 and V-6. The related records are launch review #19 (the sign window's Pays address shrunk to its checksum, fixed) and the usability review's AC-1 and V-6 (cut in the middle, keep the tail). Neither weighs that the kept tail is a checksum a stranger solves for. The review-51 index has no overlap.

### gap-g10#3 · low · The Add tokens picker cuts a lookalike token's warning to "Calls itself SNEK, not on the…" in grey; Home's list shows it whole in amber (H-9), and the swap's picker cuts its mark too

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TokenAmounts.tsx:269`
- **Who:** stranger · **Since:** 01c354ba (2026-09-24, the token picker) and e43cec9a (2026-09-24, the swap's picker). H-9's fix, d423b79a (2026-10-05), edited TokenAmounts.tsx:268 and left :269 as it was. · **Confidence:** confirmed-by-run

**Scenario:**

A stranger sends 1,000,000 of an unlisted token named "SNEK". It is a lookalike, so its label is its fingerprint.

On Home its row says "Calls itself SNEK, not on the wallet's list" in amber, wrapped whole. The Add tokens picker on Send, Send privately, Make private, Make public, a site session's top-up and the connector's funding shows the same line as an ordinary grey sub line:
- at 360 px, "Calls itself SNEK, not on the…"
- at 400 px, "Calls itself SNEK, not on the wallet'…"
The part that says it isn't listed is gone, and the row reads as a token that calls itself SNEK.

The swap's token picker greys and cuts the pay list's mark the same way: "Not on the wallet's list: it cal…" at 360 px and "…it calls itself…" at 400 px.

The stranger chooses the amount, and with that the cut: at 50 units the line fits. The review then says it all, in amber.

**Evidence:**

TokenAmounts.tsx:269: `<span className="token-row__sub">{v.sub}</span>`, against TokenList.tsx:57: `<span className={view.warn ? "token-row__sub wrap token-row__sub--warn" : "token-row__sub"}>`. tokens.ts:230-236 (TokenView.warn): "Shown whole, never cut: in the side panel it read 'not on the wallet's …', the part that matters lost (chunk 23's review, H-9)". Swaps.tsx:1913 `<span className="token-row__sub">{sub}</span>`, where an own pick's sub is the mark (Swaps.tsx:569-575). The usability review's V-6 rule is "warnings never truncate".

Measured with the harness, at 360 px with an amount of 1,000,000:
- picker sub: box 165 px, text 217 px.
- swap pay sub: box 165 px, text 376 px.
With an amount of 50 the picker sub's box is 218 px and the line fits.

**Fix:**

Give the picker's row the view's warn as TokenRow does (`wrap token-row__sub--warn`). Give Swaps' row a warn flag for an own pick whose TokenText has posesAs, with the same classes. Better, have both pickers render TokenRow's markup so H-9's rule lives in one place. A Vitest could render TokenPicker with a lookalike and expect `token-row__sub--warn`.

**Known check:**

H-9 is the rule (tokens.ts:230-235, d423b79a). I searched backlog.md and docs/archive/plans/*.md for token picker, Calls itself, H-9 and Add tokens. The blind test saw Home's amber line only (blind-task-usability-test.md:454, :491, :507), and nothing records the picker's line. The review-51 data has no overlap.

### gap-g10#4 · nit · Amount boxes on the forms clip their own figures at the side panel's width: a token's box after Max, the swap's two amounts, Send's "Max, up to …"

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/styles.css:3449`
- **Who:** user · **Since:** 0612e890 (2026-09-23) for the 9em token box; e43cec9a (2026-09-24) for the swap cards. · **Confidence:** confirmed-by-run

**Scenario:**

- A token's amount box (TokenAmounts) after Max on 1,234,567,890,123 units shows "1,234,567,8" with nothing marking the rest; the line under it says "of 1,234,567,890,123".
- The swap's "You receive" of 1,234,567.123456 beside a long-named token shows "1,234,56…" at 360 px and "1,234,567.…" at 400 px.
- Its "You pay" beside a long name shows "1,000,00" with no mark.
- Send with one recipient and Max on shows "Max, up to 10,408.0140…" at 360 px. That is the stylesheet's own example (styles.css:3366, "at a size the panel's box shows whole"; PY-12 "Max's placeholder fits"), 3 px over. A 1.2 million ₳ balance shows "Max, up to 1,234,567.1…".
Every review and the swap approval show these figures whole. The usability review's V-6 rule is "inputs never clip their own content".

**Evidence:**

styles.css:3449-3454 `.token-amount__row input { width: 9em; padding: 7px 10px; ... }` leaves a text box of 84 px against 133 px for the figure. styles.css:2605-2620: the swap cards' input has no text-overflow and the output is ellipsized; Swaps.tsx:599 shrinks the type only past 10 characters, and the token button takes up to 55% (styles.css:2669). styles.css:3368-3372 and AdaInput.tsx:54: the disabled input holds t("common.maxUpTo"); at 360 px with no recipient card its box is 178 px against 181 px. All measured in headless Chrome on the real stylesheet, and the "1,000,00" shows in the screenshot I viewed.

**Fix:**

Size these boxes by their content as Home's hero does (Amount's size classes), let the token box grow (flex 1, min-width 0) instead of a fixed 9em, and say "Max, up to X" on a line under the box rather than inside the disabled input. Members of the class: the UTxO list's ADA label beside a tag ("12,345,678.1234…" at 360 px, Utxos.tsx:243) and the Pools list's shortened ID (see notes).

**Known check:**

Searched the archive for PY-12, V-6, amount-box__shown, 9em and swap-card__amount. PY-12 is marked "Partly", with "Max's placeholder fits". Nothing records the token box or the swap cards. backlog.md has no such item.

## Guards (9)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/tokens.ts:116` | A token named like ADA or a listed token (case, lookalike letters, digit leads, ADA as a word) going by that name. It goes by its fingerprint with an amber mark instead, so a payment isn't made in the wrong token unseen. | tests/token-text.test.ts:64, :79, :107 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/tokens.ts:114` | A token name with bidi, zero-width or filler characters, or one that isn't text, reading as anything. It goes by its fingerprint. | tests/token-text.test.ts:134 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/tokens.ts:66` | A token's unit differing between form, review and list (launch review #55): the wallet's list's decimals over Koios's, then none. | tests/token-text.test.ts:164 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:292` | An amount above max (what's held, or 45 billion ₳) being taken: the field keeps the previous value. | tests/format.test.ts:182 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:170` | Mis-scaling: more decimal places than the token has isn't an amount, and extra decimals are dropped, never rounded up. | tests/format.test.ts:122, :148 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/ReviewRows.tsx:53` | A review shortening an address or a Seedelf name (whole rows are never review__row--id), which an address poisoner's lookalike would match. | tests/review-layout.test.ts:155 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/styles.css:3721` | The sign window's Pays row shrinking the payee's address to its checksum, or pushing the ADA off-screen (launch review #19). The address gets its own wrapped line and the amounts are capped at 55%. | tests/dapp-prompt.test.ts:243 pins signData's whole-address line; none found for the Pays row's own layout |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:461` | DReps and pools sharing a name or ticker without a flag (launch review #59). | tests/ui-safety.test.ts:106 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/Destination.tsx:156` | A destination passing for a saved contact: "Your contact" shows only when the whole value matches (Transfer.tsx:432 the same for Seedelf names). | none found |

## Checked and holds

- Every review's money rows wrap rather than cut: review__row dd is capped at 65% with overflow-wrap: break-word, and ₳ is held to its amount by no-break spaces. A token amount of 2^64−1 with a fingerprint label stays whole at 360 px (measured).
- Reviews show addresses and Seedelf names whole (review__row--whole, break-all). review__row--id values are 27 characters at most and fit beside a wrapping label: "addr1q9ld26hfxq0…2s0x5s2m" measured 211 px at 360.
- The sign window's Pays rows and Transaction details' outputs show the whole address on its own line and wrap amounts and token names (dapp-paid, dapp-address, dapp-amount; launch review #19's fix holds).
- The swap approval's You pay, You receive and minimum wrap (swap-summary__amount, overflow-wrap: anywhere), so the form's cut figures appear whole before Start swap.
- Home's hero fits the largest possible balance: "44,999,999,999.999999 ₳" at the longest size measured 238 px in 238 px.
- Token rows never cut the amount (nowrap, auto column): 2^64−1 (204 px) fits the row at 360. Only the row's own label and sub shrink, to "S…" and "ass…".
- Voting's DRep rows fit shortId (159 px in a 236 px sub at 360). The DRep card prints the whole ID.
- Staking's pool card keeps about 31 characters of a pool ID before its 6-character tail at 360 px. The pool page prints the whole ID.
- The Contacts picker's short value fits (133 px of 191).
- Lovejoin pools are kept only for listed tokens, so the pool grid's tiles and group titles carry short tickers. The mix reviews show a box's value in strong rows, whole.
- Every menu-row__sub use carries --wrap, so no menu-row sub line is cut. LovejoinReturn's way rows are mix-card rows and wrap.
- No TSX inline style truncates text, and styles.css has no width media queries (only max-height: 600px and reduced motion), so fixed-width containers reproduce the side panel.
- shortId (16+6) for pool and DRep IDs keeps at least 11 data characters plus the checksum, beyond cheap grinding (launch review #59). A token fingerprint's 10+6 form needs about 2^50 policy hashes to match.
- Activity's details row shows the counterparty whole, and Destination's and Transfer's "Your contact" compare whole values.
- tokenName rejects control characters, and tokenText sends names with Cf or Default_Ignorable characters to the fingerprint. plainName strips them for DRep and pool names.
- formatQuantity, parseQuantity and sanitizeAmount work in bigint with no rounding; extra decimals are dropped, and more than held or than the ADA supply is refused.

## Notes

- For the owner, gov actions: the sign window's own-ballot line names each governance action by 8+4 hex of its transaction ID (DappApprovals.tsx:1261). The Governance page names actions by CIP-129 gov_action1… with shortId (Governance.tsx:915), and Transaction details by 12+6 hex (TxDetail.tsx:544), so a user can't match the window's line to the action they meant. A lookalike action needs about 2^48 hashes plus the 100,000 ₳ deposit, so I don't report it as a finding.
- Nit, user: the DRep registration and update review shortens the profile URL with shortId (Staking.tsx:985, shortHex(url, 16, 6)), e.g. "https://example.…jsonld", hiding the end of the host. The user typed it one screen earlier, and its hover title is whole.
- Nit, stranger: in the Pools list a shortened pool ID loses its tail at 360 and 400 px. It shows "pool1pu5jlj4q9…" as a ticker-less pool's label and "pool1pu5jlj4q9w…" under a ticker. V-6 and #59's intent aren't met, but 45 to 50 bits remain, the pool page prints the whole ID, and shared tickers are tagged, so there is no harm.
- A stranger's token with 2^64−1 units shrinks its own row's name and fingerprint to "S…" and "ass…" at 360 px. Other rows are unaffected, and its details show everything.
- UTxO list: a UTxO's ADA label beside a tag is cut, e.g. "12,345,678.1234…" (Seedelf tag, 360 px). The details title shows it whole. It's coin control, not signing.
- Unverified family member of gap-g10#1: U+2800 BRAILLE PATTERN BLANK is category So, not white space and not Default_Ignorable, so it passes HIDDEN and the skeleton too. I didn't render it, because its glyph comes from a fallback font.
- Method, for verifiers. The harness lives in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/gap-G10/harness/: g10_make_page.py writes g10-page-<width>.html around g10-styles.css (styles.css with the bundled Inter woff2 embedded), and g10_show.py prints the measurements. Each run was `systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 timeout 90 google-chrome --headless=new ... --host-resolver-rules="MAP * ~NOTFOUND" --proxy-server=http://127.0.0.1:9 --dump-dom`, on a scratch file with no network. Ellipsis points are computed from per-character range rects and may differ from Chrome's own by a few px; the 3 px "Max, up to" case is within that. The logic checks are /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/gap-G10/g10_lookalike.mjs (verbatim copies of foldName, nameSkeleton, lookalikeOf and sharedNames) and /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/gap-G10/g10_tail_solve.py (BIP-173 bech32 and the GF(2) solve). The scratch folder is tmpfs.
- Vitest tests a verifier could write: gap-g10#1, tokenText("preprod", named("tUSDM" + " ".repeat(9) + "x")).posesAs is undefined today; gap-g10#3, renderToStaticMarkup of TokenPicker with a lookalike lacks token-row__sub--warn. gap-g10#2 is a layout question, best pinned once the cut moves into JS.

## Coverage

Read in full: ui/styles.css (all 4,179 lines; every text-overflow, overflow: hidden, white-space: nowrap or pre, max-width and max-height rule listed by script and checked; there is no line-clamp) and ui/format.ts (all 479 lines). Every place a truncating class sits in components/ and screens/ (found by grep) was read in context:
- token-row__label, __amount and __sub;
- list__name and list__value;
- middle-ellipsis;
- review__row--id;
- account-picker;
- amount and its size classes;
- menu-row__sub and menu-row__figure;
- modal__title;
- swap-card__amount, swap-token and swap-token__name;
- amount-box__shown;
- pool-name and pool-tile__name;
- activity__sub-lead and activity__more;
- note-part, chip, swap-tag and timeline__link.

Components read in full: ReviewRows, MiddleEllipsis, TokenAmounts (picker and box), TokenList (TokenRow, TokenDetails, TokenAmountText), RadioCards, AccountRecipients, Modal, AdaInput, ReviewTotals and PaidRows. Read in part: AmountField (head), Contacts (row and picker), Destination (resolution notes), TxDetail (Outpoints, Output, mint) and LovejoinReturn (way rows).

Screens, in the parts holding those classes:
- Swaps: amountOf, nameOf, pickOf, pairOf, ownPicks, TokenButton, the form's cards and quote, SwapApproval's summary and funding rows, TokenSelect.
- Activity: list, EntryLine, Who, details.
- Staking: PoolFacts, review rows.
- Pools: row and page.
- Voting: DrepRow, DrepCard.
- Lovejoin: PoolGrid, PoolGroupList, Chains, mix card, box-value rows.
- Utxos: list and details.
- DappApprovals: connect cards, ballot line.
- Home: Amount, other-side row.
- Transfer: SeedelfNameInput.
- CardanoSend: amount field.
- Recipients: RecipientCard.

Followed out: ui/tokens.ts in full; shared/seedelf-name.ts; background/activity.ts's counterparts; the deployed token_name.ak and seedelf.ak at 5b82530; dreps.mjs's name cleaning; the bundled mainnet token and DRep lists. Measured: 60-odd boxes at 360 and 400 px in headless Chrome, with screenshots viewed.

Not read line by line: the rest of the about 30,000 lines of screens and components, which hold none of these classes. Not measured: other languages (es/ja labels wrap differently; numbers stay en-US). Not reached: Activity's recorded detail for the wallet's own private payments to a Seedelf (whether it's the name or the tag). Not done: rendering U+2800.
