# Chunk 19 plan: language

The wallet speaks English, Spanish and Japanese. Every locale is bundled, so
nothing is fetched and no new host is asked for; a picker in Settings chooses,
and the system's language is used when it is one we ship.

[P2](../post-release-roadmap.md#p2--language), the owner's pick after chunk 18.
Branch `web-wallet/language`, from `main`.

**The owner's call (2026-10-02):** copy what Lace does, including its
languages — English, Spanish and Japanese, "probably a very large chunk of the
Cardano user base".

## What this costs, measured

**2,471 strings a person can read, across 113 of the 145 source files.** Not an
estimate: counted with the same AST walk `tests/words.test.ts` already uses to
find "everything a person reads", with SVG path data, class names, URLs and
bare identifiers filtered out. Of them 256 are one word, 1,289 are two to five,
and 926 are a sentence or more. The heaviest files are `Swaps.tsx` (319),
`Lovejoin.tsx` (222), `Settings.tsx` (182), `TxDetail.tsx` (130) and
`DappApprovals.tsx` (108).

For scale: Lace's shared translation set is 2,920 keys. This is a job of the
same size as Lace's, done once, and it is the reason this chunk is staged rather
than landed in one commit.

**Strings in `background/` count too.** 107 in `sessions.ts`, 72 in
`lovejoin.ts`, 60 in `dapp.ts`, 25 in `koios.ts`: the worker's error messages
are shown by the UI, so they are read by a person and must be translated. The
house rule already says this of core's messages, "since it shows them"
([seedelf-platform/CLAUDE.md](../../CLAUDE.md)).

**What is out of reach, and has to be said plainly:** error text that comes
from Rust — `seedelf-core` through the WebAssembly — cannot be translated by a
bundled JSON in the extension. Those messages stay English. The wallet should
not pretend otherwise, and [What stays English](#what-stays-english) records
where that shows.

## Found before building (2026-10-02)

Five things about the code as it stands decide most of this plan's shape.

1. **The tests assert on *rendered* text, not on source.** About 120 vitest
   files render components with `renderToStaticMarkup` and check the words that
   come out (`privacy-notes.test.ts`, `screens.test.ts`, `ui-safety.test.ts`,
   `token-text.test.ts`, and the e2e suite). So if i18next is initialised
   **synchronously** with the English bundle and English is the default, their
   rendered output does not change and **they pass unchanged**. That is the
   whole reason this chunk is tractable, and it is promoted to this plan's
   acceptance test: see [How we know it didn't break](#how-we-know-it-didnt-break).
2. **The language cannot live in `Preferences`.** `PreferencesProvider` reads
   them through the worker and only once unlocked (`if (!unlocked) return`), but
   onboarding, Unlock and Reset all render before that — in a language the user
   has already chosen. So the language goes beside `LOCAL_NETWORK` and
   `LOCAL_ACCOUNT` in `chrome.storage.local`, for exactly the reason those two
   are there: read before anything is unlocked, and kept when the wallet is
   removed.
3. **`main.tsx` is where it is read, and there is no flash.** The entry point
   can await the stored language before `createRoot(...).render(...)`, so the
   first paint is already in the right language and every component's render
   stays synchronous. Nothing needs Suspense, and no provider is required for a
   component rendered bare in a test.
4. **English grammar is composed in about thirty places, and that composition
   has to go.** `format.ts`'s `plural(n, one, many)` appends an `s`;
   `Withdraw.tsx` writes `{plural(summary.left, "private UTxO")} {summary.left
   === 1 ? "stays" : "stay"}`; `useAmounts().count(n, one, many)` takes an
   English singular and plural. None of that survives translation — Spanish
   agrees differently and Japanese has one form — so these become
   whole-sentence keys with i18next's `_one`/`_other`, never a sentence
   assembled from translated words. See [One sentence, one key](#one-sentence-one-key).
5. **The safety-critical strings are already marked in the source.** 55
   `<Callout tone="warn">` and 35 `<Callout tone="privacy">`. The roadmap asks
   for "an identifiable key prefix" so the critical set is a short list rather
   than a hunt; the components give us something better than a prefix — a
   *derivable* set, checked by a test rather than kept by hand. See
   [The critical set](#the-critical-set-derived-not-remembered).

Also found, and worth a line because it is a release step rather than code:
`scripts/third-party.mjs` builds `licenses/THIRD-PARTY.txt` from every bundled
npm package and **fails on one that ships no licence**. i18next is MIT and
ships its `LICENSE`, so the file gains one line and the store zip's notice
changes with it. (The 19 `@typescript/*` platform binaries that file reports as
licence-less are pre-existing, Apache-2.0, and already handled by its
fallback.)

## Decided

### i18next alone, bundled, and behind one module

i18next 26, as the roadmap asks and Lace does (Lace is on 23). Two reasons it
is the right answer here and not just the familiar one: the plural categories
come from `Intl.PluralRules`, so Japanese's single form and Spanish's three are
correct without us writing CLDR rules; and `fallbackLng: "en"` gives the
roadmap's "a missing translation must fall back to English, never vanish" in
one line of config.

**react-i18next is deliberately not installed.** It was, and it came out again.
It buys two things — a `useTranslation` hook and `<Trans>` for markup
mid-sentence — and charges for both: a provider at the root (which every one of
the ~120 bare-rendered components would then need), and four more packages in a
wallet (`react-i18next`, `html-parse-stringify`, `void-elements`,
`@babel/runtime`). **i18next on its own has no dependencies at all**, so the
whole of this chunk's supply-chain cost is one MIT package.

In its place, fifteen lines of ours: `useT()` subscribes to `languageChanged`
and redraws, needing no provider, and `<Rich>` puts React nodes into a
sentence's `{{placeholders}}`. `<Rich>` is the better trade and not just the
cheaper one — `<Trans>` numbers its tags (`<0>`, `<1>`), while placeholders are
*named*, and the interpolation-parity test below already holds every locale to
English's `{{tokens}}`. A translation that drops a bolded phrase therefore fails
a test we were writing anyway, with no second mechanism to keep.

**No backend plugin, no language detector that touches the network, no async
load.** `resources` are passed to `init` from imported JSON, `initImmediate:
false`. Nothing new phones home, which is the rule, and the picker's list is
derived from the bundled files.

**Everything goes through `src/i18n/`.** Screens import `useT` from there, not
`useTranslation` from react-i18next. The call sites read the same either way, so
if the engine ever wants replacing — this is a wallet, and two dependencies is
a real cost — it is one module's worth of work and not 2,471 call sites'. That
is the whole reason for the indirection, and it is worth stating because the
indirection otherwise looks like ceremony.

### The language is stored beside the network

`LOCAL_LANGUAGE = "seedelf.language"` in `chrome.storage.local`, for the reason
in *Found* 2. It gets the same note the account's key has: **anyone reading the
profile's local storage sees which language the wallet is in**, as they already
see the network, the active account and that a vault exists. That is a small
thing to disclose and it is disclosed, in `privacy.md`'s own words rather than
silently.

Unset, the language is the system's when we ship it, English otherwise —
`getSystemLanguage()`, Lace's name for it, reading `navigator.languages`. The
*first* choice therefore asks nobody anything and still lands in Spanish for a
Spanish browser.

### One sentence, one key

A key holds a whole sentence. Fragments are not translated and then assembled,
because assembly encodes English word order and English agreement.

Concretely, `Withdraw.tsx`'s "3 private UTxOs stay for another payment:"
becomes one key with `_one`/`_other` forms, not `plural()` plus a ternary for
the verb. `plural()` and `useAmounts().count` keep existing for *counts* a
person reads as a number, but they stop carrying English words: the ~30 call
sites that pass `"UTxO"`, `"box"`, `"token"` move to keys.

This is the part of the chunk most likely to be done sloppily and it is where
sloppiness shows up as a wrong sentence in Spanish rather than as a failing
test, so it is called out here and checked in review file by file.

### The critical set, derived not remembered

The roadmap wants the accuracy-critical strings identifiable as a short list,
so a later correction is cheap. Lace keeps that list by hand, as
`docs/i18n/critical-key-patterns.json`, and its own file records what that
costs: ten cNIGHT keys and the whole of Earn Rewards shipped
machine-translated "to keep main green at merge time", with a note saying they
*are* accuracy-critical and were declassified anyway. A hand-kept list drifts
towards whatever makes CI pass.

**So ours is derived from the components that already mark these strings.** A
string rendered inside `<Callout tone="privacy">`, `<Callout tone="warn">` or
`role="alert"` is accuracy-critical by construction. The build-time extractor
records that, `docs/i18n/critical-keys.json` is a checked-in artifact, and a
test regenerates it and fails if it drifts. Adding a new warning to a screen
therefore adds it to the critical set without anyone remembering to, which is
the failure mode Lace's file documents.

Around that, Lace's three files, kept because their shape is proven:

- **`{lang}-provenance.json`** — technique per key: `human`, `mtpe`,
  `exact-reuse` (the English is a proper noun or a number and is reused
  deliberately), `verbatim`, or `machine` for a raw draft.
- **`verified-critical-{lang}.json`** — the keys that have had the roadmap's
  back-translation: translated back to English without the original in view,
  and compared for meaning. This is where "a dropped clause or an inverted
  negation" gets caught, which is what a confident wrong translation looks
  like.
- **A gate**: a critical key whose provenance is `machine` and which is not
  listed as verified **fails the test**. There is no tolerance flag to turn it
  off, because the tolerance flag is how Lace's list drifted.

### What stays English

Three things, said here so no one has to discover them:

1. **Rust's error messages**, through the WebAssembly, as above.
2. **The recovery phrase**, always: BIP39 English wordlist, frozen, and a
   translated word list would be a different wallet. The screens *about* the
   phrase translate; the 24 words do not.
3. **Seedelf**, in every language — it is the name, and
   `words.test.ts` will check it in all three locale files rather than only in
   English.

## The tests

Lace's `translationKeyParity.test.ts` is the template and its reasoning is
sound: it guards against *merge mangling* — a dropped key, a renamed
placeholder, an emptied value — and leaves semantic quality to human review
rather than pretending CI can judge it. Ours takes its three checks and adds
four, the last three straight from the roadmap:

1. **Key parity, by base key** — every locale carries the same keys, compared
   with the plural suffix stripped. Not Lace's identical-key-set check, because
   an identical set is the wrong requirement: `Intl.PluralRules` gives English
   `one, other`, **Spanish `one, many, other`** and Japanese `other` alone, so
   a Spanish bundle that carried exactly English's keys would be missing the
   form it needs for a million and a Japanese one would carry a form its
   language has no use for. The test compares base keys, and then requires each
   locale to carry **exactly the categories its own language has**. Failures
   name the exact asymmetric keys.
2. **Non-empty** — no value is empty or a non-string.
3. **Interpolation parity** — every value carries English's `{{tokens}}`;
   a plural form may drop only `{{count}}`.
4. **Seedelf is Seedelf** — `words.test.ts`'s rules, over every locale's
   values, not only English's.
5. **A negation where English has one** — English `not`/`never`/`n't` against
   Spanish `no`/`nunca`/`ni`, Japanese `ない`/`ません`/`せず`. This is the
   inverted-negation catch, and it is a warning list rather than a hard failure
   where a language legitimately recasts the sentence: a critical key may not
   be on that list.
6. **Not silently equal to English** — a translated value identical to the
   English one is either a deliberate `exact-reuse`/`verbatim` in the
   provenance file, or a failure.
7. **The critical gate** — as above.

And `words.test.ts` keeps scanning source, because strings that are not
translated (a test id, a storage key) still must not say "seedelf" where a
person reads it.

## How we know it didn't break

**The acceptance test is that English does not move.** The ~120 vitest files
and the Playwright e2e suite assert on rendered English, and they must pass
**unchanged**. A diff in one of them is a bug in the extraction, not a test to
update — and that rule is what makes a 2,471-string mechanical change safe to
do in bulk. The only test that changes on purpose is `words.test.ts`, which
follows the strings into the locale files.

Then, per stage: `npm run typecheck`, `npm test`, `npm run e2e`, and a build
whose size is recorded, because three locale bundles plus two dependencies is a
real addition to a zip the store has to accept.

## Stages, as built

Each is a commit. English stayed byte-identical throughout, so the wallet was
shippable at every one.

**The plan's order changed, on purpose.** Stages 5 and 6 said "`es.json`" and
"`ja.json`" as if the locales came after the whole extraction. They did not:
once the gate was in place, every area's keys went out of source **with their
Spanish and Japanese in the same commit**, because the parity test refuses a
locale that lags `en.json`. That makes each commit shippable in three languages
rather than one, and it means no locale was ever translated from a list of keys
without the screen in front of it.

| # | What | Done |
|---|---|---|
| 1 | `src/i18n/` — i18next, sync init, `useT`, `Rich`, `getSystemLanguage`, the storage key, `main.tsx` reading it | yes |
| 2 | The seven tests, and the provenance/critical machinery | yes |
| 3 | The picker in Settings, the `lang` attribute, and the note on who checked the translations | yes |
| 4– | Every area out of source, en + es + ja + provenance together: components, screens, the worker, Lovejoin's page, the swap screens, the connector's window, the remainder | yes |
| last | Back-translation of the critical set, `verified-critical-*.json`, these docs | yes |

## What it cost, built

**2,471 of 2,471 strings are out of source.** `en.json` holds 2,128 keys (fewer
than the string count, because repeated sentences share one key and a
`plural()` call became one key with two forms); `es.json` 2,128, `ja.json`
1,940 — Japanese has one plural form where English has two.

**195 keys are accuracy-critical**, derived from the source by
`scripts/i18n-critical.mjs`, and every one is back-translated and recorded in
`verified-critical-{es,ja}.json`.

**Size, `npm run build:ext`, against `c72bb99`:**

| | before | after |
|---|---|---|
| `sw.js` | 304.1 kB (gzip 89.1) | 289.8 kB (gzip 83.9) |
| `shared-*.js` | 20.9 kB (gzip 8.4) | 643.6 kB (gzip 167.0) |
| `index-*.js` | 793.0 kB (gzip 289.1) | 708.1 kB (gzip 256.8) |
| **all JS** | **1,118 kB (gzip 387)** | **1,642 kB (gzip 508)** |

**+524 kB raw, +121 kB gzip**, which is the three locale files (594 kB raw, 142
kB gzip on disk) plus i18next, less what left `sw.js` and `index` as literals.
The worker and the UI both import the bundles, so they moved into the shared
chunk, which is why the other two shrank. The WebAssembly is unchanged at
2,639 kB, so the whole extension is still dominated by it.

**1,186 tests pass, and the English they assert did not move.** That was the
acceptance test and it held: no behavioural test was edited for wording. The
test files that changed did so because a constant they import became a function.

## What this turned up

Four things the extraction found that were wrong before it:

- **Fourteen module-level `t()` constants were eager**, so they bound English at
  import and never heard a language change. All of them are functions now. The
  first audit found ten; four more had their `t()` on the following line and
  needed a second pass with a multi-line pattern.
- **`tokenText` compared a token's name against `"(no name)"`** — against what
  `tokenName` returns, which is `t("format.noName")`. In Spanish that is "(sin
  nombre)", the comparison would have passed, and a token with an empty asset
  name would have been labelled "(sin nombre)" rather than by its fingerprint.
  It tests the empty asset name itself now.
- **The derived critical set cannot see a warning assembled above its JSX.**
  `NotMixed` builds its sentences into `const` bindings and renders the joined
  string, so the deriver — which walks `<Callout tone="warn">` subtrees — marked
  none of them critical. Rather than teach it to follow local variables, those
  keys moved under `lovejoin.warn.notMixed.*`, where the name rule catches them.
  The lesson generalises: **a key whose sentence is built outside its callout
  must carry `.warn.` or `.privacy.` in its name.**
- **English word order was load-bearing in about twenty places** —
  `many ? "They" : "It"`, `plural(n, "box", "boxes")`, `${what} isn't ready`.
  Each became whole-sentence keys, with a pronoun count passed as `count` where
  agreement was the only variable, so Spanish picks its form and Japanese needs
  none.

## What stays English on purpose

Besides the Rust messages named above:

- **`content/bridge.ts`**, injected into every page the user visits. Two strings
  (a stale bridge, an unknown method) go to the site, not to a wallet surface,
  and are not worth i18next in the content script.
- **The two prefixes `dapp.ts` matches** to classify a WebAssembly failure
  (`"The wallet can't read"`, `"bad request"`). They read Rust's words, not
  keys, and the source now says so.
- **`manifest.json`'s name and description**, which Chrome localises through
  `_locales/`, not i18next. Translating the store listing is its own job (below).
- **`secret-box/format.ts`'s `RangeError`s**, which fire only on a programming
  mistake (a salt or nonce of the wrong length) and are never shown.

## Still open

- **Who reads the Spanish and Japanese critical strings** (the roadmap's open
  question 2). The machinery is built and green: 195 keys derived from the
  source, each back-translated and compared for meaning, with a gate that fails
  the build on an unchecked draft. **No native speaker has read any of it**, and
  `verified-critical-{es,ja}.json` says so in the reviewer line rather than in a
  footnote. That is the accepted risk, and a user who reports an error is the
  feedback loop working — Settings says where to report one.
- **Whether the store listing is translated too.** Separate from the extension:
  a listing per locale in the dashboard, through `_locales/` for the manifest's
  own name and description. It publishes nothing new about the owner. Worth a
  look now that the extension itself speaks three languages.
- **Whether the quality of a whole locale gets a pass of its own.** Each area
  was translated with its screen in view, and the critical set was
  back-translated, but nobody has read `es.json` or `ja.json` end to end looking
  for a term that drifted between areas. `docs/i18n/glossary.md` is what such a
  pass would check against.
