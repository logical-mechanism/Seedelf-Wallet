# Chunk 11 plan: polish and testers

Chunks 1–10 built every v1 flow, and each one works end to end on preprod. Chunk 11 gets the wallet ready for its first testers. It's too big for one session, so it runs as three, each with its own branch and PR into `seedelf-web-wallet`:

| Part | Branch | What | Size |
|---|---|---|---|
| **11a** | `web-wallet/polish` (this plan's branch) | The Lace style and flow pass: the whole UI | The biggest |
| **11b** | `web-wallet/size-and-live` | A smaller WebAssembly module, live preprod runs of every flow, and loose ends | Medium |
| **11c** | `web-wallet/store` | The unlisted Chrome Web Store listing for the first testers | Small, and the user submits it |

Do them in order: 11c's screenshots should show 11a's look, and its build should carry 11b's smaller module.

## Start here (every part)

1. **Sync.** For 11a, start from this branch; for 11b and 11c, branch from `seedelf-web-wallet` once the previous part has merged:
   ```bash
   git fetch origin
   git checkout web-wallet/polish && git merge origin/seedelf-web-wallet        # 11a
   git checkout -b web-wallet/size-and-live origin/seedelf-web-wallet           # 11b
   git checkout -b web-wallet/store origin/seedelf-web-wallet                   # 11c
   git log --oneline origin/seedelf-web-wallet..origin/main                      # merge main first if this lists anything
   ```
2. **Read:**
   - this plan
   - the newest entries in [roadmap.md](../roadmap.md#handoff-notes)
   - the part's reading list below
   - The memory notes load on their own. The ones that matter here are *Style polish later*, *Chrome web wallet direction* and *Web wallet branching*.
3. **Build and check that everything passes before changing anything** (from `seedelf-platform/`):
   ```bash
   cargo test --workspace                                   # about 209 tests
   ./seedelf-web-wallet/wasm/build.sh && node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"
   cd seedelf-web-wallet/extension
   npm ci && npm run build && npm test && npx playwright install chromium && npm run e2e
   ```
   Expect Vitest 109 (+1 live, skipped) and Playwright 18. CI (`.github/workflows/web-wallet.yml`) runs all of it on the PR.
4. **Confirm the part's decisions with the user** before building what they affect. Each part has a table below; the suggestions are only suggestions.
5. At the end: tick the part in the roadmap, add a handoff note, open the PR, watch CI, and update the *Web wallet branching* memory note.

## Rules that hold throughout

- **Lace is inspiration for look and flow, not a brand to copy** (see [architecture.md](../architecture.md#ui)).
  - Don't take its name, logo or brand assets.
  - Don't take its purple brand palette (`#8B2BEC` and friends). Seedelf keeps its own navy `#011833` and teal `#00c4bc` (see [brand/](../../brand/)).
  - Don't take its commercial fonts: Brandon Grotesque and Proxima Nova are in its repo but not licensed to us.
  - A file copied or adapted from Lace stays Apache-2.0. Keep its notices, mark our changes, and ship the license next to it, as `extension/src/background/secret-box/` does.
- **Keep it light.** Plain CSS with design tokens, React, no component library, and nothing that phones home.
- **The page CSP is strict:** `default-src 'self'`. Fonts, images and icons must ship inside the extension. There are no web fonts from a CDN.
- **The tests find things by role, label and `data-testid`, not by class.** Restyling is safe; renaming a button or a label means updating `e2e/extension.spec.ts` in the same commit.
- **Every privacy note on the screens stays.** They carry the decisions in [privacy.md](../privacy.md): what move-in links, mint first, the transfer lookup, the own-account warning, and the rest. A restyle can move them and shorten them, but never drop one.

---

## 11a: the Lace style and flow pass

**Start by asking the user for their list of CSS and UX fixes.** In chunk 7 they said those belong in this pass (memory: *Style polish later*). Then confirm the decisions.

**Done (2026-09-24).** The user chose **dark only** (no light theme), **Inter** bundled, **Lucide** icons, and the **switch with round actions** for Home. The palette and form layout follow the suggestions below, and there was no fix list. See the roadmap's handoff note.

### Reading list

- **Our UI** (about 3,300 lines): `extension/src/ui/styles.css` (the tokens are at the top), `ui/App.tsx`, `ui/screens/*.tsx` and `ui/components/*.tsx`.
- **Screenshots of today's UI:** `npm run e2e` writes `extension/test-results/*.png`, for every screen in the tab (1280 px) and the popup (360 px). Use them to compare before and after.
- **Lace** (`seedelf-platform/_reference/lace`, gitignored; `_reference/README.md` is the reading map). Paths are under `packages/lib/ui-toolkit/src/`:
  - `design-tokens/theme/dark.ts` and `light.ts`: the colours.
    - Dark page `#1E1E1E`; surfaces are white at 5% and 8% (`#FFFFFF0D`, `#FFFFFF14`); text `#FFFFFF`, `#EFEFEF` and `#CCCCCC`.
    - Borders are faint whites; positive `#008080`, negative `#E01E5A`.
  - `design-tokens/tokens/radius.ts`, `spacing.ts` and `shadows.ts`.
    - A 4 px base; radii 8, 16, 24 and 32; `rounded` 100 for pills.
    - A card shadow of `0 2px 14px` in a faint drop colour.
  - `design-system/atoms/{button,card,text,input,iconButton,actionButton,pill,toggle}`, `molecules/{navigationHeader,detailRows,buttonGroup,modal}`, `organisms/tabBar` and `templates/{lock,onboarding,pageContainerTemplate}`.
  - Whole flows, for the order of screens: `packages/module/{send-flow,onboarding,app-lock}`.
  - Lace's UI is React Native Web. Read it for values and structure; don't port its components.

### Decisions to confirm

| Decision | Suggestion | Notes |
|---|---|---|
| Theme | **Dark by default**, Lace's dark structure in Seedelf's colours. Light stays for `prefers-color-scheme: light`, built the same way from Lace's `light.ts` | Today it follows the system and light is the default. The roadmap asks for "much more Lace's dark mode". |
| Accent and palette | **Teal `#00c4bc` is the accent** (buttons, links, focus); navy for the light theme's text. Lace's neutrals, radii, spacing and shadows | "The look but not the brand". |
| Font | **The system font stack, as today** | The alternative is to bundle one OFL font (for example Inter or Montserrat, a variable `woff2` of about 100–300 KB) with its licence, and add `font-src 'self'` to the CSP. |
| Icons | **Lucide (ISC), copied as inline SVG, only the icons used** | The icons are hand-drawn today (`components/Icons.tsx`). Lace's own icons are Apache-2.0, but they sit close to its brand. |
| Home's structure | **A header with the Seedelf balance; tabs or a segmented switch for Seedelf and Cardano account; round action buttons** (Send, Withdraw, Move in, Receive) like Lace's action buttons; *Your seedelfs* as a list | Today Home is one long scroll of three cards. Confirm with a sketch, or a screenshot of a first cut, before restyling every screen. |
| Forms and review screens | **One shared layout:** a step header, a title, fields, notes as callouts, and a sticky primary button. The review uses Lace's detail-row style | Today every screen repeats this markup, and a `Row` component is copied in five files. Pull it into `components/`. |

### Work items

1. **Tokens first.** Rewrite the top of `styles.css`: colours, surfaces, borders, radii, spacing and shadows for dark and light, named after what they're for. Check the contrast of text on surfaces (WCAG AA) in both themes.
2. **Shared components:**
   - `Button` (primary, secondary, link, icon, round action), `Card`, `StepHeader`, `ReviewRows` (the five copies of `Row`), `Callout`, `Field` (label, input and note).
   - `AdaInput`, `TokenAmounts`, `CopyButton` and `TokenList` restyled.
3. **Home:** the new structure, the pending banner, the empty states, and *Your seedelfs* rows with Copy and Remove.
   - Fix found in chunk 10: "Send to a seedelf" wraps onto two lines in the popup next to Withdraw.
4. **Every other screen,** one at a time, checked against its screenshot in the popup and the tab:
   - Welcome, Create (reveal, confirm, password), Restore, Unlock (and reset), Move in, Create a seedelf, Send to a seedelf, Withdraw, Remove, and the start-up error.
5. **Flow fixes the user lists,** and any found on the way. Keep the privacy notes (see the rules above).
6. **Tests:**
   - Keep all 18 Playwright tests green, and add screenshots of the popup for each new layout.
   - If any tests stay light-theme only, add a dark-theme screenshot run (`colorScheme: "dark"` in Playwright's context) so both themes are seen.
7. **Docs:** architecture.md *UI* (tokens, components, the icon source and its licence), and the extension README's screen table.

**Done when** every screen follows the new tokens and components in both themes and both sizes, the user has seen the screenshots, and the tests pass.

---

## 11b: a smaller module, live runs, and loose ends

### Reading list

- `wasm/build.sh` and the workspace `Cargo.toml`, which has no `[profile.*]` yet.
- `extension/e2e/live/{move-in,mint}.mjs` and [development.md](../development.md) *Testing layers*.
- The *Not done* items in the handoff notes for chunks 8b, 9 and 10.

### Decisions to confirm

| Decision | Suggestion | Notes |
|---|---|---|
| How to shrink the module | **A `wasm-release` cargo profile** (`inherits = "release"`, `lto = true`, `codegen-units = 1`, `opt-level = "s"` or `"z"`, `strip = true`), used only by `build.sh`, **then `wasm-opt -Oz`** if it pays | The CLI's release build stays as it is. `wasm-opt` isn't installed here: binaryen comes from apt, GitHub releases, or npm's `binaryen`. CI needs it too, or `build.sh` must skip it cleanly. |
| What "small enough" means | **Measure each step, and keep only what pays.** Proofs and builds must not get noticeably slower | Today it's 2.3 MB (582 KB gzipped). Time a proof (about 10 ms now) and a whole mint draft, before and after. `opt-level = "z"` can slow the BLS arithmetic. |
| Live runs | **One script per flow, run by hand, never in CI:** move in → mint (account) → transfer → withdraw → remove, on the private test wallet | The user funds `extension/.preprod-test-wallet.txt` (gitignored) from the faucet. Each run records its tx hash in the roadmap. |

### Work items

1. **Size:** add the profile and optional `wasm-opt` step to `build.sh` and to CI's WASM build, keeping the output's name and path.
   - Record each step's size, gzipped size and the proof time in the handoff note.
   - Correct the stale numbers in architecture.md: "about 590 KB, before `wasm-opt`" in *Crypto*, and the 2.3 MB in *Transaction building*.
2. **Live scripts:** add `e2e/live/{transfer,withdraw,remove}.mjs` in the shape of `mint.mjs` (restore, act, wait for the banner to confirm, print the hash and every host contacted), or one `e2e/live/all.mjs` running the whole lifecycle.
   - An account-paid mint needs no giveme.my. The Seedelf spends need a real giveme.my signature, which only happens live.
3. **Loose ends from chunks 8b to 10:**
   - Live withdraw and remove runs; chunk 10's note suggests the public 12-word phrase's balance.
   - An ADA Handle lookup against a real preprod handle.
   - Funding the private test wallet.
   - The manual preprod checklist in development.md: bring it up to date with every flow.
4. **Docs:** development.md *Testing layers* (the live scripts), and the WASM README (the build profile).

**Done when** the module is as small as it usefully gets without slowing proofs, every flow has a recorded live preprod transaction from the built extension, and the loose ends are closed or written down.

---

## 11c: the unlisted Web Store listing

The user owns the Chrome Web Store developer account and submits the listing. This part prepares everything, so that submitting is copy and paste.

### Reading list

- `extension/src/manifest.ts` (`VITE_STORE_BUILD=true` drops the dev `key`; `VITE_ENABLE_MAINNET` adds mainnet).
- [development.md](../development.md) *Sharing with testers*, [privacy.md](../privacy.md) and [README](../../README.md).
- The Chrome Web Store's current developer program policies and listing requirements. **Check them live;** they change. The things to look for:
  - a single purpose
  - a justification for each permission and host
  - the privacy practices form and a privacy-policy URL
  - the rules on crypto wallets, and on remote code (none here: the WebAssembly ships in the package)
  - the image sizes for the icon, screenshots and promo tile

### Decisions to confirm

| Decision | Suggestion | Notes |
|---|---|---|
| Network | **Preprod only** for the first testers | Mainnet is "after v1" in the roadmap and needs its own review (the fees are real, and so are the risks). |
| Visibility | **Unlisted:** anyone with the link | The alternative is private (named testers only). development.md recommends either. |
| Where the privacy policy lives | **A page in the repo** (`seedelf-web-wallet/docs/store/privacy-policy.md`), linked by its GitHub URL | It says nothing is collected, and that the wallet talks to Koios and giveme.my, each of which sees the user's IP (privacy.md *Network*). |
| Version | **0.1.0**, as `package.json` says today | Every new upload needs a higher version. |
| Who submits | **The user, by hand** | This is outward-facing: prepare it, never submit it. |

### Work items

1. **The store build:**
   - `VITE_STORE_BUILD=true npm run build`, then a zip of `dist/` (an `npm run package` script).
   - A test that the store manifest has no `key`, only the preprod hosts, and the strict CSP.
2. **The listing's text** in `seedelf-web-wallet/docs/store/`:
   - the name, the short and long descriptions (preprod, testers, what it does and doesn't hide)
   - the single-purpose statement
   - one line per permission: `storage`, `alarms`, and the Koios and giveme.my hosts
   - the privacy policy
3. **Screenshots at the store's size,** made by a Playwright script against the fixtures, not live data. The popup and the tab, dark theme, and no real phrase on screen: use the public 12-word test phrase.
4. **A release checklist** in development.md:
   - bump the version, build, run every test, the manual preprod checklist, zip, upload
   - where the listing's text lives
5. **Handoff:** the zip, the text and the screenshots, ready for the user to submit. Then, with the user, the first message to testers (the repo's stargazers; memory: *Chrome web wallet direction*).

**Done when** the user has everything needed to submit, and a store build passes the same tests as the dev build.

---

## Out of scope for chunk 11

- Mainnet (after v1).
- The contract round trip: one-time accounts, CIP-30 and auto-return (after v1).
- New flows or settings beyond what the style pass needs. Auto-lock timing, for example, stays 15 minutes.
