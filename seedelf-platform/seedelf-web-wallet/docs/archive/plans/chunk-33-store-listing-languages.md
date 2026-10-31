# Chunk 33 · The store listing in Spanish and Japanese

The owner asked on 2026-10-12, as 1.5.0's last feature, from [post-release-roadmap.md](../post-release-roadmap.md)'s [Kept in mind](../post-release-roadmap.md#kept-in-mind): the listing in Spanish and Japanese, which the wallet has spoken since chunk 19. The store's analytics show users of both.

**Status: ✅ built 2026-10-12** on `web-wallet/store-listing-i18n`, from `main` after #304. One PR: the build and the docs together, so this file went straight to the archive. What still holds is in [store/README.md](../../store/README.md#in-spanish-and-japanese), with each language's text ready to paste. The privacy policy has no new entry: nothing is sent or kept.

## How the store does it

One item, one package. A listing in another language has two halves:

- **The title and the summary come from the package.** They're the manifest's `name` and `description`. With `_locales/<language>/messages.json` in the package and `default_locale` in the manifest, a `__MSG_…__` description is read in each language Chrome has a file for.
- **The description and the screenshots are entered on the dashboard.** Once the package has `_locales`, the Store listing tab gets a language list at its top, one entry for each `_locales` folder, and each language takes its own description and its own screenshots ([Google's page](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)). A language's own screenshots show before the global ones. The small promo tile can't be localized.

So the package must carry `_locales` before the dashboard offers anything: the summary ships in 1.5.0's zip, and the description and screenshots go in at its upload.

## What changed

- **The summary,** `SUMMARY` in `manifest.ts`, in English, Spanish and Japanese. The manifest's `description` is `__MSG_appDesc__` and its `default_locale` is `en`. The build's manifest plugin (`vite.config.ts`) writes `_locales/<language>/messages.json` beside `manifest.json`, from `buildLocales()`. `scripts/package.mjs` zips the whole of `dist/`, so they ship with nothing more.
- **The title** stays `Seedelf Wallet` in every language: it's a name ([glossary](../../i18n/glossary.md)).
- **The screenshots** (`e2e/store-images.spec.ts`): the flow is still driven in English, and each screen is shot in English, then Spanish, then Japanese, by setting `seedelf.language` (`LOCAL_LANGUAGE`) in local storage, which every open page follows as it does a choice in Settings. Each language has its captions (`CAPTIONS`). English's images stay at the top of `docs/store/images/`, byte for byte as they were; Spanish's and Japanese's are in `es/` and `ja/`. The Japanese captions set `lang="ja"` and break lines between phrases (`word-break: auto-phrase`), with no negative letter spacing.
- **The description,** each language's in [store/README.md](../../store/README.md#in-spanish-and-japanese), with the upload's steps. The release checklist ([development.md](../../development.md)) says to fill in all three languages at upload, and that the Japanese images need a Japanese font on the machine.

## How the text was made

1. **A draft per language,** by a Claude agent, from the glossary and from the wallet's own words in that language: each phrase the wallet already says (a private session, a return, Lovejoin's boxes, Settings' currency, the DRep options) was looked up in `en.json` and taken from `es.json` or `ja.json`, so the listing names things as the screens do.
2. **A blind back-translation of each,** by an agent that saw only that language's text, then compared with the English. The meaning held. They flagged sentences that could be read two ways, and those were rewritten:
   - **"Koios does it on preprod",** right after "our server logs neither your IP address nor what you ask", could read in both languages as *Koios logs them*. Now Koios "reads the chain and submits the transactions" there. The English could be read that way too, so it now says Koios "reads and submits" on preprod: the one change to the English listing.
   - **Japanese's "fewer while few people use it"** could read as fewer than 1 in 9, which sounds better. Now it's the 9 that gets smaller.
   - **Who asks before anything is signed** read as the site in Spanish and was left open in Japanese. Now it's the wallet.
   - Also: Japanese's summary said staking was done "publicly" as an event is; "in public" is the public account now. "Make money public to an address" isn't natural in either language, so the caption pays the address. "Directly" now says *without Lovejoin*. Spanish's *su* for the wallet's read as formal *usted*, and a few long sentences were split.
3. **The rewritten sentences, back-translated blind again,** out of context.

Flags left as they were, on purpose: the words the wallet itself uses (返却, 結び付く, 投票権, 資金提供, *devolución*, *pulsa*, *parte de staking*, *retirar tu DRep*), since the listing should match the screens; and what the English says the same way ("a fresh copy of their key", "Or remove a Seedelf", "the default depth"), since a translation shouldn't explain more than the original. No native speaker has read either language, as with the wallet's own (the owner accepted that on 2026-10-03).

## Checks

- `tests/manifest.test.ts`, "gives the store's summary in each language the wallet speaks, through Chrome's _locales": `default_locale` and the `__MSG_appDesc__` description, one `_locales` entry per bundled language, and each summary at most 132 characters and naming Seedelf. It failed until Spanish's and Japanese's were in.
- **Chrome reads them:** `dist/` loaded in Playwright's Chromium under English, Spanish and Japanese UI languages. `chrome.i18n.getMessage("appDesc")` and the manifest's description came back in each.
- **`SUMMARY`'s languages are written out, not imported:** `tests/import-boundaries.test.ts` keeps everything `vite.config.ts` loads clear of the i18n modules, and caught a type import of `LanguageCode`. The manifest test holds them to the bundled languages instead.
- **The suites:** Vitest 2,042 (2 skipped) on the default and the preprod-only build, and e2e 83 on the dev build, which carries the `_locales`.
- `npm run store:images` on the build: 15 screenshots. English's are unchanged, and the Spanish and Japanese ones were looked at, all ten, with nothing cut off or left in English.

## Not built

- **A translated title.** It's the wallet's name.
- **A promo tile per language.** The store can't localize it, and it has no words.
- **The listing in any other language.** The store offers a language only for a `_locales` folder, and the wallet ships these three.
