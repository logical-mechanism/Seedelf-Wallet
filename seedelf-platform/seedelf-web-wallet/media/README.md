# Media

Images for posts about Seedelf Wallet, drawn in HTML so they can be edited, rendered again, reused and translated.

**Never in `extension/public/`:** Vite copies that folder into `dist/`, so anything there would ship in the store zip.

| What | |
|---|---|
| [shared.css](shared.css) | What every image shares: the wallet's dark theme, its colours and Inter, from the extension's own font files |
| [render.mjs](render.mjs) | Renders a folder's `src/*.html` into PNGs beside `src/`, at 1600×900 and 2× (3200×1800), with the extension's Playwright |
| `x/<thread>/` | One thread on X: `src/` holds each image's HTML, the PNGs sit beside it, and `thread.md` has the posts and each image's alt text |

**Threads:**
- [x/private-contracts/](x/private-contracts/thread.md): smart contracts used privately, through a one-time account and back through Lovejoin.

## Rendering

```bash
cd seedelf-platform/seedelf-web-wallet/extension
npm ci                                       # once, for Playwright
cd ..
node media/render.mjs x/private-contracts    # every image in the thread
node media/render.mjs x/private-contracts 01-the-loop
```

Open an image's HTML in Chrome to work on it, then render it. Commit the PNG with its HTML.

## For X

- **16:9, 1600×900:** X shows it whole in the timeline, uncropped, one image a post. Rendering at 2× keeps text sharp when it's opened.
- **Text 22px or larger** at 1600 wide: on a phone the image is about 360 px wide, and anything smaller can't be read until it's opened. A footnote for the curious can be smaller.
- **Every image gets its alt text** (up to 1,000 characters), from its thread's `thread.md`.
- **Made to sell, still true:** a thread is for someone who wants privacy, not the maths, and leaves the limits to the docs. Every claim on an image is still checked like one in the docs, against [flows.md](../docs/flows.md) and [privacy.md](../docs/privacy.md).

## Notes

- The images take the brand files and fonts from `extension/public/brand` and `extension/public/fonts` by relative path, so a move there means a change here.
- Lovejoin appears in its own amber with its own mark (from Lovejoin's `ui/public/favicon.svg`), not in the wallet's warning colour.
- CI's web wallet check skips this folder, since nothing builds or tests from it ([web-wallet.yml](../../../.github/workflows/web-wallet.yml)'s `changes` job).
