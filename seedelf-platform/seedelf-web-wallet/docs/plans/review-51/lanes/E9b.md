# Lane E9b

Returned by the workflow's agent `a9abd351fc15353f4`, written here by the lead from its structured answer.

## Findings (3)

### e9b#1 · low · Greek capitals Ν Μ Η Υ, and Cherokee or Lisu letters, slip past the check for tokens named like ADA or a listed token

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:80`
- **Who:** stranger · **Since:** web-wallet 1.0.0 (ead12610, launch review #18/#55's fix) · **Confidence:** confirmed-by-run

**Scenario:**

A stranger mints a token named "USDΜ" (Greek capital Mu, U+039C), "SΝΕΚ" (Greek Nu, Epsilon, Kappa), "ΜΙΝ" or "ΝΙGHT". Greek capitals look exactly like Latin ones in every font. The stranger sends it to the user's public address, which anyone can do. tokenText's lookalikeOf gets the skeletons "usdu", "svek", "ulv" and "vlght", which match no listed ticker, so the token keeps its own name as its label. Home's token list then shows "USDΜ 10,000" with only its fingerprint as the second line, without the designed "Calls itself USDΜ" warning line in warning colour. Every review, site sign window and Activity line reads "10,000 USDΜ (not on the wallet's list, asset1…)" instead of "10,000 asset1… (it calls itself USDΜ, but it isn't the listed USDM)". ADA itself slips through the same way: "ᎪᎠᎪ" (Cherokee GO, A, GO) and "ꓮꓓꓮ" (Lisu A, DA, A) both look like ADA, and "1,000 ᎪᎠᎪ" reads as an amount of ADA. Neither is caught. The same skeleton decides shared pool tickers and DRep names (sharedNames): a pool with the ticker "ΝUΝΑ" isn't flagged as sharing NUNA's. The first layer still holds: the token is marked "not on the wallet's list", has no logo, and shows its fingerprint. Only the second layer, which names a posing token by its fingerprint, is bypassed. Low: any further harm needs social engineering.

**Evidence:**

format.ts:55-61: the LOOKS_LIKE table holds lowercase letters only (μ: "u", ν: "v", η: "n", υ: "u"), which is right for those lowercase glyphs. format.ts:80 lowercases before it maps: `[...name.normalize("NFKD").replace(...).toLowerCase()].map((c) => LOOKS_LIKE[c] ?? c)`. So uppercase Ν, which looks like N, becomes ν and then "v"; Μ (M) becomes "u"; Η (H) becomes "n"; Υ (Y) becomes "u". Cherokee and Lisu letters aren't mapped at all. tokens.ts:184-220: lookalikeOf compares nameSkeleton(own) with the registry tickers' and names' skeletons and ADA_NAMES. tokens.ts:116-117: no match keeps `label: own`. tokens.ts:266: viewToken's sub line is then `text.id`, with no warn. format.ts:461-473: sharedNames uses the same nameSkeleton. Ran a verbatim copy of LOOKS_LIKE, foldName, nameSkeleton and lookalikeOf over src/tokens/registry.mainnet.json (scratch e9b_lookalike.mjs and e9b_lookalike2.mjs, `timeout 30 node …`): "SNEK" gives posesAs=SNEK and "АDА" (Cyrillic) gives ADA, but "SΝΕΚ" gives skeleton="svek" posesAs=-, "ΜΙΝ" "ulv" -, "ΝΙGHT" "vlght" -, "ΗOSKY" "nosky" -, "ΙΝDΥ" "lvdu" -, "ΜELD" "ueld" -, "USDΜ" "usdu" -, "ᎪᎠᎪ" "ꭺꭰꭺ" -, "ꓮꓓꓮ" "ꓮꓓꓮ" -, "1,000 ᎪᎠᎪ" -, and the pool tickers NUNA and ΝUΝΑ give [["nuna",1],["vuva",1]] (not shared). tests/token-text.test.ts covers Cyrillic (ЅNЕK), full-width and Greek Α only.

**Fix:**

Fold case-sensitively before lowercasing. Add an uppercase table for capitals that draw Latin letters (Greek Α Β Ε Ζ Η Ι Κ Μ Ν Ο Ρ Τ Υ Χ to a b e z h l k m n o p t y x, and Cyrillic capitals such as И and the ones whose lowercase maps differ), and keep the lowercase table for lowercase glyphs. Better, fold with Unicode's confusables data (the UTS #39 skeleton) for the scripts that can draw Latin letters: Greek, Cyrillic, Cherokee, Lisu, Coptic, Armenian. The fix covers the whole family through nameSkeleton and foldName: tokenText/lookalikeOf (tokens.ts), sharedNames/sharing (format.ts:461-473, used for pool tickers in Pools.tsx and DRep names in Voting/dreps). Add the names above to token-text.test.ts and to the sharedNames tests.

**Known check:**

Searched backlog.md and docs/archive/plans/*.md for lookalike, homoglyph, confusable, Greek, skeleton and UTS 39. The only hits are launch-review #18/#55 (the fix that brought this check) and chunk-12/privacy-review notes keeping it. No backlog line or Not-fixed entry. tests/token-text.test.ts and format.test.ts have no Greek-capital, Cherokee or Lisu case.

### e9b#2 · low · Anti-impersonation warnings in warning colour are left out of the accuracy-critical translation set

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/scripts/i18n-critical.mjs:84`
- **Who:** nobody · **Since:** unknown (the derived critical set since chunk 19; the token marks since ead12610) · **Confidence:** traced

**Scenario:**

isCriticalElement counts only `<Callout tone="warn"|"privacy">` and `role="alert"`. Some warnings are shown through a `--warn` CSS class instead, so the guard never reaches them:
- tokens.mark.posesAs ("not on the wallet's list: it calls itself {{own}}, but it isn't {{real}}"), the impersonation warning in every review and site sign window, in TokenAmountText's `token-mark--warn` span (TokenList.tsx:227);
- tokens.callsItself, Home's warning line (`token-row__sub--warn`, TokenList.tsx:57);
- tokens.mark.unlisted/unlistedId and tokens.theListed;
- the warning tags pools.tag.keepsAll, pools.tag.oversaturated, pools.sharedTickerTag and vote.sharedNameTag (`utxo-tag--warn`, Pools.tsx:286-288, Voting.tsx:420).

None is in docs/i18n/critical-keys.json. es-provenance.json and ja-provenance.json record them as "machine", never back-translated, and i18n.test.ts's negation and verified-critical gates skip them. Today's values carry the meaning, so no money is at stake now. Two Japanese tags are weak: vote.sharedNameTag "共有された名前" reads as "a name that was shared (with you)", and pools.sharedTickerTag "共有ティッカー" as a neutral "common ticker", rather than "another DRep or pool uses this name". Any later edit to these keys ships without the back-translation the critical set requires.

**Evidence:**

scripts/i18n-critical.mjs:75-101: TONES = {privacy, warn} and ALERT = {alert}, and only a Callout's tone or a role attribute make an element critical. TokenList.tsx:222-231 renders `tokenMark(text)` inside `<span className={text.posesAs ? "token-mark token-mark--warn" : "token-mark"}>`. Checked with python over docs/i18n/critical-keys.json: tokens.mark.posesAs, tokens.mark.unlisted, tokens.mark.unlistedId, tokens.theListed, tokens.callsItself, pools.sharedTickerTag, pools.tag.keepsAll, pools.tag.oversaturated and vote.sharedNameTag all print False. es/ja provenance: ('machine', 'machine') for each token mark. Values read: es "no está en la lista de la billetera: dice llamarse {{own}}, pero no es {{real}}" and ja "ウォレットのリストに含まれていません。{{own}} と自称していますが、{{real}} ではありません" (both correct); ja vote.sharedNameTag "共有された名前" and pools.sharedTickerTag "共有ティッカー" (weak).

**Fix:**

Extend isCriticalElement's source 1 to any element whose className holds a `--warn` modifier, or rename these keys under `.warn.` as chunk 19 did for its other blind spots. Then back-translate them blind into verified-critical-es.json and verified-critical-ja.json. Re-word the two Japanese tags, for example 同名あり / 同じティッカーあり.

**Known check:**

Read chunk-19-language.md's recorded blind spots (assembled consts, helpers, props, state, `.warning.` keys, worker reasons) and i18n-critical.mjs's "What it can't see" list. Neither names warn-classed elements. Searched backlog.md and archive/plans for critical set, token-mark, tokens.mark, sharedNameTag and sharedTickerTag: nothing.

### e9b#3 · nit · PlutusTree's Copy JSON isn't the detailed schema cardano-cli reads: ints are strings, and an unknown tag's constructor is null

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/PlutusTree.tsx:167`
- **Who:** nobody · **Since:** web-wallet 1.1.0 (653b7879) · **Confidence:** traced

**Scenario:**

A user copies a datum's or a redeemer's JSON from Transaction details or a sign window and feeds it to cardano-cli, as the comment promises ("the form cardano-cli, Blockfrost and Koios all speak, so it can go straight into another tool"). Every integer comes out as a JSON string ({"int": "42"}). cardano-api's detailed-schema parser wants a JSON number there, so the file is refused. For a constructor whose CBOR tag isn't 121-127, 1280-1400 or 102, constructorIndex is "tag N", and Number("tag N") becomes NaN, written as "constructor": null. A tag-102 constructor above 2^53 loses precision. No money is involved.

**Evidence:**

PlutusTree.tsx:161 `{ constructor: Number(value.constructorIndex), ... }`. PlutusTree.tsx:167 `{ int: value.value }`, where value.value is a string (rpc.ts TxPlutus int). decode.rs constructor_of returns `format!("tag {tag}")` for other tags. tests/tx-view-screen.test.ts:653 pins `{ int: "-18446744073709551617" }` under the title "as cardano-cli does".

**Fix:**

Write the JSON with integers as bare JSON numbers: a small serializer that emits the decimal string unquoted, so big ints keep full precision. Write a constructor index the same way. For a "tag N" constructor there is no detailed-schema form, so leave the JSON out or say so rather than writing null.

**Known check:**

Searched backlog.md and archive/plans for plutusJson, Copy JSON and detailed schema: nothing. The test pins today's string form.

## Guards (13)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:170` | parseQuantity refuses more decimal places than the unit has (no silent rounding of what is sent), and anything but ASCII digits, a point and well-placed commas | tests/format.test.ts (parseAda/parseQuantity cases near :132) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:168` | A decimal comma ("12,5", "0,5") read as a thousands separator, which would make 125 ₳ or 5 ₳ (launch review #54) | tests/format.test.ts:132 and :227 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:281` | A typed or pasted comma that doesn't group thousands is refused and the previous value kept: a comma never just disappears into a bigger number | tests/format.test.ts:207-223 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:279` | A Spanish paste of d,ddd (1,125), which reads both ways, changes nothing and shows both readings | tests/lovejoin-launch-review-fixes.test.ts:131 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:284` | Decimal places past the unit's are dropped, never rounded up, so the amount never grows | tests/format.test.ts:150-154, :268 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:292` | An amount over the ADA supply (45 billion ₳) or over a token's held quantity keeps the previous value | tests/format.test.ts:181-190 (sanitizeAda: supply), :262-277 (a token) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:376` | unlocked(): locked UTxOs' ADA and tokens are taken out of what a payment form can use | tests/review-totals-incoming.test.ts:72 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/format.ts:404` | spentRewards: rewards count as payable only when the user spends rewards and the stake key is registered with a DRep delegated, as the worker withdraws (background/account.ts:194) | none found by name (Home's forms may cover it) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/tokens.ts:66` | tokenDecimals: one unit for a token everywhere (the registry's over Koios's), so what's typed, sent and reviewed agree (launch review #55) | tests/token-text.test.ts (tokenDecimals) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/tokens.ts:105` | tokenText: an unlisted token is always marked with its fingerprint; one named like ADA or a listed token goes by its fingerprint (bypassable, e9b#1) | tests/token-text.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/activity.ts:166` | csvCell: a stranger's token name, note, pool ticker or DRep name never starts a spreadsheet formula in the exported CSV | tests/activity.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/PhraseInput.tsx:91` | A pasted recovery phrase is cleared from the clipboard | none found (e2e pastes it but doesn't check the clipboard) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/history.ts:65` | The browser's Back never fires a disabled screen Back (a transaction being sent) | none found by name |

## Checked and holds

- formatQuantity: exact bigint grouping, sign, fraction padding and trimming for any size and any non-negative integer decimals
- parseQuantity: refuses signs, letters, spaces, non-ASCII digits and malformed groups; "1.234,5" is refused, never misread
- sanitizeAmount: text it keeps as typed never parses (Review waits), and every value it builds parses back to exactly the amount shown
- A decimal comma only ever reads smaller than the thousands reading would: the only risk is an underpayment the field and the review show
- decimals = 0 fields drop the point and any fraction, with a note
- tokenDecimals is used by the token amount box (tokenChoices), the reviews ({...held, ...tk}) and the lists alike
- Bundled registry: 32 mainnet + 2 preprod entries, integer decimals (0, 6, 8), no duplicate tickers, case-insensitive; keys are policy.asset
- A stranger's token is 'listed' only by exact policy.asset key: no stranger token can borrow a listed one's ticker or logo
- t() wrapper: a value carrying '{' or U+FDD0 is stood in; i18next 26.4.2's skipOnVariables turns nesting off when a value adds $t(; no placeholder collides with an i18next option except count
- Rich: no call site passes untrusted values; labels arrive as React nodes, so a U+0000 in one can't shift the split
- No t() runs at module load, directly or through a helper (scanned every load-time call in src/ with vite's parseAst)
- The worker classifies only Rust's English messages (short.ts, sessions.ts TOO_*, lovejoin.ts NO_PRIVATE_PAYS/'pool has N boxes', destination.ts NOT_BECH32) or legacy English (entrySession, withMore, wasCut, retryReason); translation and the cut flag arrived in the same commit (f823fda3)
- Settings' account rename starts from the stored name, never the translated 'Account N'
- slotText/epochEnds: Shelley offsets right for mainnet (epoch 208, 1596059091000) and preprod (epoch 4, 1655769600000); an end rounds up, a start and an epoch end round down
- activityCsv: amounts unsigned for 'in', '-' for 'out', fee and rewards in their own columns, pending entries left out, BOM + CRLF
- PlutusTree recursion is bounded: decode.rs refuses a transaction's CBOR past 128 levels before decoding
- PhraseInput/PhraseGrid/SetPassword/PasswordField: autocomplete, spellcheck and autocorrect off; hidden words are not in the DOM
- ExplorerLink: rel=noreferrer, and private links carry their privacy note
- NftImage: nothing fetched before the click, the permission asked before any await, and an answer that arrives after a lock dropped
- useAmounts masks amounts until the preferences are read
- background.ts call(): one port per request, and no request payload has a 'type' field that would override the request name
- App/ScreenForAccount remount every screen on a network or account switch, so no review survives a switch
- All 485 critical keys (en/es/ja _other or base, plus every es _one) read: meaning, negations, figures and placeholders hold
- Mechanical scan of all 3,195 keys (digits, ₳, %, service names, placeholders): only expected differences (ja digits for English number words; ja 450 億 = 45 billion)

## Notes

- For the owner (settled C22: Chrome Translate stays on, but this is a new fact). The disclosure names balances, addresses and Seedelf names, not the recovery phrase. PhraseGrid (Create.tsx:144, Settings.tsx:1349) shows the 24 words as page text with no translate="no" anywhere. A user whose Chrome language the wallet doesn't speak (German, French, Portuguese) and who chose 'Always translate English' sends the phrase to Google's translation service. The words themselves are also shown translated ('abandon' becomes 'abandonar'). Create's confirm step would catch that, but Settings' Show recovery phrase has no confirm step, so a backup copied from it would be the wrong words. translate="no" on the grid alone would leave C22 standing for the rest of the page.
- Typed and pasted give different amounts (settled: 320-screens#1 and launch review #54, pinned by tests). In English, '1,125' typed key by key becomes 1.125 (lovejoin-launch-review-fixes.test.ts:115), while the same text pasted is 1,125 (format.test.ts:210), 1000x apart; a Spanish paste is refused both ways. An English user who types a thousands comma by hand underpays, and both the field and the review show it, so nothing is lost.
- The lookalike folding is a hand list, not a confusables table. Besides e9b#1's Greek capitals and Cherokee/Lisu, Cyrillic И (mirrored N) and other script letters pass. Cyrillic Г and П fold to r and n, which only adds false positives.
- tokenMoved (ui/activity.ts:155) wraps its mark in ASCII brackets rather than tokens.withMark's (full-width in Japanese). Cosmetic.
- LOCAL_LANGUAGE values are matched case-insensitively (isSupportedLanguage), but currentLanguage() can then return 'ES' as a LanguageCode: dateLocale would be undefined and the Spanish comma check would skip it. Only the wallet writes that key, always lower case, so this can't be reached today.
- Clearable.tsx's comment says a Seedelf's name has 68 characters; names are 64 hex (shared.seedelf.warn.nameRule). Comment only.
- For E9a and X1: Home's token list rows for unlisted tokens show only the fingerprint as their second line, with no 'not on the wallet's list' words (viewToken.sub). Words appear only in the details modal and in text views, which is why e9b#1's bypass shows most there.
- No React error boundary exists (no componentDidCatch anywhere), so any render throw blanks the page. Everything in this lane that could throw (BigInt of a quantity, 10n ** decimals) gets integers from trusted sources today.

## Coverage

Read in full: ui/format.ts, tokens.ts, App.tsx, view.ts, history.ts, activity.ts, background.ts, accounts.tsx, preferences.tsx, lovejoin-pools.ts, nft-images.ts, network.ts, sentence.ts and main.tsx; shared/open-in.ts; i18n/core.ts, index.tsx, i18next.d.ts and translations/index.ts. Also read in full every component not listed for E8a or E9a: MiddleEllipsis, PhraseGrid, PoolAvatar, ActionButton, CopyButton, Callout, NetworkBadge, CopyField, QrCode, GivemeNote, BuildStage, Choice, PasswordField, RefreshRow, Tabs, Clearable, Modal, AccountPicker, RadioCards, ExplorerLink, Splash, NetworkPicker, SetPassword, Hint, LockCountdown, NftImage, Contacts, PlutusTree, PhraseInput and Screen. Icons.tsx was skimmed (static SVG paths only).

Translations: read all 485 critical bases in en, es and ja (the _other or base form, plus every es _one). Mechanical scans with python over all 3,195 keys compared digits, symbols, service names and placeholder sets, and compared negation counts on the critical keys. Read samples of the non-critical keys: amounts, token marks, pool and vote tags, lock strings. I did not read the rest of the non-critical keys' meaning.

Followed out where values go: AdaInput, AmountField, TokenAmounts and TokenList (E9a's components) for the parse and display path; decode.rs plutus_tree and its depth bound; networks.ts slot and epoch math; account.ts's rewards-withdrawal condition; the worker's regex reads of messages; i18next 26.4.2's interpolate and nest code; scripts/i18n-critical.mjs's element rule; the i18n.test.ts and i18n-assembly.test.ts guards.

Ran, read-only, in scratch: a verbatim node replica of the lookalike code, a vite parseAst scan of every module-load call, and python translation scans.

Not reached: the screens that call these helpers (other lanes'), delete-phrase.ts (E4a), and the e2e flows.
