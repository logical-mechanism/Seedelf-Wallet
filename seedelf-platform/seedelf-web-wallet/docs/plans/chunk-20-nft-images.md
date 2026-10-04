# Chunk 20 plan: NFT images

An NFT's image, shown when the user asks for it. [post-release-roadmap.md](../post-release-roadmap.md#p3--nft-images)'s P3, the last item of feature parity. Lace is the reference for what the feature is, and not for how it's done: Lace loads every NFT's image the moment a wallet opens.

**Status: built (2026-10-04).** Branch `web-wallet/nft-images`, from `main`. What landed, and where it differs from this plan, is at the end under [*What was built*](#what-was-built).

## The owner's design (2026-10-02)

**Click to show, and the image downloads to that browser.** No image host or proxy of ours: serving image data for every asset needs serious hardware, and a proxy would be one more service that sees what a wallet holds.

- **Off until clicked**, per image, so nothing is fetched for a wallet merely opening Tokens.
- **The residual leak, stated where it's chosen:** the click tells whoever serves that image that this IP wants that asset. That's the trade-off accepted: user-initiated, one image at a time, instead of a page that quietly fetches everything a wallet holds.

## Found before building (2026-10-04)

**The obvious gateways no longer serve files.** `ipfs.io` and `dweb.link` answer 429 with "This IPFS gateway is switching to a service worker gateway only", and a browser's user agent gets a Cloudflare challenge. `nftstorage.link` and `w3s.link` redirect to those two. Cloudflare's gateway is gone, and Pinata's, Filebase's, `trustless-gateway.link` and a dozen others timed out, refused, or answered 402, 403, 500 or 520. **One of about twenty answered with the file: `ipfs.blockfrost.dev`**, Blockfrost's, in under a second, for CIDv0 and CIDv1 alike and for preprod's NFTs as well as mainnet's (IPFS doesn't know which network asked). It's the gateway Lace uses (`BASE_IPFS_GATEWAY_URL` in `_reference/lace`'s `image-format.ts`).

**Blockfrost's gateway sends no CORS headers**, not on a GET and not on a preflight (405). So, as with Koios since 2026-09-25, an extension can read it only with Chrome's grant for its host. An `<img src>` would load it without one.

**What Lace does** (`_reference/lace`, 2.4.2):

- It reads Blockfrost's parsed `onchain_metadata` for **every token the wallet holds, eagerly**, through Lace's own Blockfrost proxy, and keeps it.
- Every image then loads by itself, through `img-src * data:`, with no setting and no click. An `http` address is used as it is, from whatever server it names.
- `ipfs://` and `ipfs://ipfs/` become `https://ipfs.blockfrost.dev/ipfs/…`; another gateway's `/ipfs/<cid>` address is rewritten to Blockfrost's when it fails. `ar://` isn't handled.
- No `referrerPolicy`, no size limit, no type check. SVG data URIs are refused (an audit finding, M-301).
- **What this chunk takes:** the gateway, and reading `ipfs://` in the forms real metadata writes it. **What it doesn't:** anything eager, and images from any server.

**Koios carries both standards in one request.** `asset_info` gives `minting_tx_metadata` (CIP-25, label 721) and `cip68_metadata` (CIP-68: the reference token's datum, in detailed-schema JSON, keyed by the user token's label, `"222"` for an NFT), and PostgREST's `select` cuts it to those two columns. Checked live on the test account's NFTs, which cover every case worth having (`tests/fixtures/nft-images.json`, from `record-nft-images.mjs`):

| NFT | What its metadata has |
|---|---|
| `HANOI15102024` | CIP-25, `ipfs://Qm…`, `mediaType: "image/jpg"` (not a real type) |
| `HANOI002`, `HANOI009` | CIP-68: the image in the reference datum, as bytes |
| `HANOI001` | Nothing at all: a 222 label with no reference token |
| `Veil-Mesh-License` | CIP-25 with `image: "ipfs://"` and no CID |
| SpaceBud #0 (mainnet) | CIP-25, the asset keyed by its name as text |
| `$--0--` (mainnet, an ADA Handle) | CIP-68 and CIP-25 both, the CID a CIDv1 in base58 (`zb2rh…`) |

## Decided

1. **Click per image** (the owner). **Show image** is in an NFT's details, and nowhere else. Nothing is asked for holding NFTs, opening Tokens or opening an NFT's details.
2. **Blockfrost's gateway, one for both networks.** It's the only one that answered, and it's Lace's, so Cardano users' wallets already ask it. It's named where it's chosen, in the details and in Settings' list of the services the wallet talks to. Not a setting: a gateway picker is a choice of who sees the request, which the [data layer](../post-release-roadmap.md#the-data-layer) can revisit.
3. **Chrome's grant for that one host, asked at the first click; not an `<img src>`.** An `<img>` from the gateway needs no grant, but two things rule it out:
   - **It writes to the disk.** Chrome's HTTP cache would keep the image and its address, which names the NFT, and the gateway sends `max-age` of a year. [privacy.md](../privacy.md) holds that which contract UTxOs are the user's is never on the disk unencrypted; a cached image of an NFT in the private balance is exactly that. `fetch` with `cache: "no-store"` writes nothing.
   - **It sends cookies.** An `<img>` without CORS goes in credentials mode, so it carries whatever cookies the browser holds for that host. Every service request goes with `credentials: "omit"` (privacy review §2.14).

   `https://ipfs.blockfrost.dev/*` is a part of the optional `https://*/*` the dApp connector already declares, so **the manifest's permissions don't change** and installing asks for nothing new. Only the CSP's `connect-src` gains the origin. `img-src` stays `'self' data:`: the page shows what the worker fetched, as data. Chrome's dialog names the host, which makes the grant a second, browser-level consent to the same thing the details explain.
4. **Only IPFS is fetched.** An image on any other server is handed back as its address, to copy, never opened. Anyone can send a wallet an NFT. One whose image sits on its sender's server would tell that server the IP address of whoever looks at it, and on the private side, that the Seedelf it was sent to is theirs. Through IPFS, the gateway fetches from the network and the sender's node sees the gateway, not the user. **A gateway's address in the metadata** (`https://ipfs.io/ipfs/<cid>`, `https://<cid>.ipfs.dweb.link/…`) is the same file under its CID, so it comes from Blockfrost's instead: one party, the one named. An image written on chain (`data:image/…`) needs no fetch at all.
5. **Kept in the page's memory, until the wallet locks.** Not on the disk (point 3), not in session storage (10 MB for the whole extension, which the balance reading already needs), not in the worker (which Chrome stops after 30 s idle). An image shown once is shown again without asking, in the details and as the NFT's avatar in the lists, until the lock.
6. **Never for a Seedelf.** A Seedelf's token has no image, and asking Koios about it would tie this IP address to that Seedelf. The details don't offer it, and the worker refuses it before asking anyone.
7. **The private side says more.** For an NFT in the private balance the chain shows which contract UTxO holds it, so Koios or the gateway, either alone, could tie this IP address to that part of the private balance. The details say so before the click, in a privacy callout; the public side's says who sees what. Both are critical keys (`nftImage.privacy.*`).

## What a click costs

- **Koios:** one `asset_info` request, two columns, one token. Under the shared limit like every other.
- **The gateway:** one GET, for an image on IPFS. None for an image written on chain, none for one elsewhere, none when Koios has no metadata.
- **Chrome:** one dialog, the first time. Turned down, the worker is never asked, and the worker checks the grant itself before it asks Koios, so a user who said no has asked no one. Without the grant a request to the gateway would still go out and only its answer would be blocked, which is why the check comes before the fetch, not after.
- **Nothing in the background**, nothing for opening anything, and nothing again until the wallet locks.

## Not in it

- **Arweave** (`ar://`) and plain `https` images: shown as an address, not fetched (point 4). `ar://` would be one more host to name and grant; Lace doesn't handle it either.
- **Video and `files[]`:** only `image`, which CIP-25 and CIP-68 both define as the thumbnail.
- **A grid view, a "show all" or an "always show" setting.** A grid is the [UX pass](../post-release-roadmap.md#the-ux-and-ui-pass)'s to decide. "Show all" would be the page that quietly fetches everything a wallet holds, which the owner's design rules out.
- **Keeping images past the lock**, or across windows.

## What was built

**The worker** (`background/nft-image.ts`, `Koios.assetInfo`):

- `imageOf` reads the metadata. A CIP-68 NFT reads its datum first, because its minter can update it, and CIP-25's after; anything else reads CIP-25's alone. CIP-25's asset is found under its name as text (v1) or hex, with or without `0x` (v2), and a string split into 64-byte pieces is joined.
- `sourceOf` sorts the address: `ipfs://<cid>`, `ipfs:<cid>`, `ipfs://ipfs/<cid>`, a bare CID, `/ipfs/<cid>`, another gateway's address. The CID must be one (v0, or v1 in a multibase of letters and digits only), and each part of the path is decoded and encoded again, refusing `.` and `..`. A query or a fragment is dropped. `ipfs://` with no CID reads as no image.
- **The fetch:** `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `cache: "no-store"`, 30 s, **10 MB at most**. A `content-length` over the limit stops it before a byte is read; with none, it's counted as it comes and cut off there. **Its type** is the gateway's when that says image; else its first bytes' (PNG, JPEG, GIF, WebP, AVIF, SVG); else, only when the gateway didn't know what it was (`application/octet-stream` and the like), the metadata's `mediaType`. A gateway that calls it a web page isn't overruled. Whatever the type, the page shows it in an `<img>`, which runs no script and loads nothing, so a wrong one only fails to draw. **SVG is shown**, where Lace refuses it (its code cites an audit finding, M-301, whose text isn't in the checkout): an SVG inside an `<img>` runs no script and loads nothing, so it's as static as a PNG.
- The result is a typed `NftImage`: the image as a data URI, `none` (no metadata, no readable image, a Seedelf), `elsewhere` with the address, `tooLarge`, or `notImage`. A gateway that answers 404, 429 or 5xx, or doesn't answer, is an error in words.
- **The request is refused while the wallet is locked**: a locked wallet shows no tokens to ask about.

**The page** (`components/NftImage.tsx`, `ui/nft-images.ts`):

- **`NftImageShow`**, under an NFT's details' top: before the click, the privacy callout for its side and **Show image**. The click asks Chrome first, before anything is awaited, since Chrome asks only straight from a click. After it: where the image came from and that it isn't kept, or why there's none. Off IPFS, the address in a copy field with what opening it would tell that server.
- **`NftPicture`** puts the image where the avatar was. One the browser can't draw becomes "not an image this browser can show", and the avatar comes back.
- **`TokenAvatar`** shows an NFT's image once it's been asked for, so the lists show it too.
- **`App` forgets them all when the wallet locks.**
- `TokenList` and `TokenDetails` take `of` (whose tokens they are), which decides the callout.

**Words:** 27 keys in each language (25 new, the two Settings lists of services changed). Five are critical (`nftImage.privacy.*`, `nftImage.warn.notGranted`), 303 in all. Those five and the two changed Settings keys were back-translated by a separate agent given the Spanish and Japanese alone. That review found no inverted negation or dropped clause. It found three Spanish ambiguities and one Japanese one, all fixed, the oldest being the Settings line's "No tiene cuentas", which read as "the wallet has no accounts" beside the "cuenta pública". The record is in `docs/i18n/verified-critical-{es,ja}.json`'s round six. **A second blind read, of the other 20 keys, followed (round seven).** Its one real finding was the impersonal Spanish "no se preguntó nada", which can read as "you weren't asked anything": beside Chrome's own question that's the wrong way round. It is the house's "no se le pregunta nada a nadie" now, in four keys, three of them critical. Ten smaller corrections were made across both languages, among them a formal "Su" against the product's tú, and Japanese that made the gateway sound as if it chose not to send. **`tests/nft-image-screen.test.ts` renders the details in Spanish and Japanese** and checks that no English is left, that the callout's sentences are joined as each language joins them, and that the worker's messages follow the language.

**Tests:** `tests/nft-image.test.ts` reads the recorded metadata and checks every address shape, the type rules, the cap, the request count and what each request goes out with, that a Seedelf and a turned-down grant ask no one, and the gateway's failures in words. `tests/nft-image-screen.test.ts` covers each side's callout, no offer for a fungible token or a Seedelf, the image as the avatar, an address to copy and never to open, and the lock forgetting. The manifest, Settings and service-fetch tests follow, and the handler refuses a locked wallet. **The e2e test** opens the 24-word account's NFTs on the real build: nothing asked for opening Tokens or the details, then one `asset_info`, one fetch to `/ipfs/<cid>` with no cookie and no referrer, and an image that decodes at its size. Opened again it's there with nothing asked, and it's the avatar in the list. An NFT with no metadata asks Koios and not the gateway. After a lock and unlock it's gone. Chrome's dialog can't be answered from automation, so that test runs on the build with access to sites from install (`siteAccess`), which is the grant the dialog gives.

**Cost:** no new dependency. The fixture is 18 KB.

## Still open

- **The store dashboard's texts**, at the next upload: the host-permission box (a 991-character version that names the gateway is in [store/README.md](../store/README.md)), the remote-code answer and the test instructions, which that file now has. No new permission is declared, so nothing new needs a justification of its own.
- **The privacy policy** says it (4 October 2026). It's served from `main`, so it goes live with the merge, ahead of the release, as the policy promises.
- **If Blockfrost's gateway stops serving**, every image fails in words and nothing else breaks. The fix is one constant (`IPFS_GATEWAY`) and the CSP that reads it. A verified fetch from trustless gateways (Helia's `verified-fetch`) would take the trust out of any one gateway, at the cost of a large dependency.
