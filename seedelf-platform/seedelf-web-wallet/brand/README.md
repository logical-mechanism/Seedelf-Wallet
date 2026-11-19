# Seedelf brand assets

[Seedelf Wallet](../README.md) is a Cardano wallet for Chrome with private payments built in. This folder holds its logo set at full size: the emblem, the wordmark and the Chrome Web Store icon. The extension ships smaller copies made from these, in [`extension/public/`](../extension/public/).

| File | What it is | Used for |
|---|---|---|
| `mystical_seed_elf_emblem.png` | The emblem, transparent background, 1254 × 1254 px | Toolbar and extension icons (`extension/public/icons/icon-{16,32,48,128}.png`; the 48 is also the mark in the wallet's top bar and the icon a site sees when it connects), and the emblem on the unlock screen and the loading screen (`extension/public/brand/emblem.png`) |
| `seedelf_wallet_gradient_tech_logo.png` | The emblem and the "Seedelf Wallet" wordmark in colour, transparent background | The welcome screen (`extension/public/brand/wordmark-on-dark.png`, with the navy lettering made near-white for the dark theme) |
| `seedelf_wallet_logo.png` | The same emblem and wordmark in one colour (navy `#011833`) | Print, or single-colour use |
| `hooded_seed_elf_guardian_icon.png` | Rounded-square app icon with a background | The Chrome Web Store listing's icon ([docs/store/](../docs/store/README.md)) |

**[`cardano-org/`](cardano-org/)** holds the images for Seedelf Wallet's entry in cardano.org's apps directory ([its rules](https://cardano.org/docs/get-involved/add-app/)). cardano.org keeps its own copies: changing them there takes a pull request to `cardano-foundation/cardano-org`.

| File | What it is |
|---|---|
| `cardano-org/seedelf-wallet.webp` | The entry's screenshot, 2048 × 1440 px: the private balance, a payment to a Seedelf by name and the public account, side by side on a light background |
| `cardano-org/seedelf-wallet.png` | The entry's icon: the emblem, centred in 512 × 512 px, transparent background |

`npm run store:images` in `extension/` makes both, with the Chrome Web Store images (`e2e/store-images.spec.ts`).

**Colours taken from the logo:** navy `#011833`, deep navy `#000c2c`, bright teal `#00c4bc`, mid teal `#00a8a0`, deep green-teal `#01836e`. The wallet's colours come from them.

## For contributors

The copies in `extension/public/` were resized with Pillow: the emblem cropped to its alpha box and centred on a square canvas, and the wordmark cropped and scaled to 720 px wide. A new copy is made the same way.
