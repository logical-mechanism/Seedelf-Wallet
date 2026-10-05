# Chunk 17 plan: the transaction view

Open the transaction itself — inputs, outputs, datums, scripts, certificates,
metadata — decoded from the CBOR that is about to be signed, plus the raw bytes.
The owner's ask from the 2026-09-28 mainnet test, listed under *After v1* in
[roadmap.md](../../roadmap.md#after-v1). Eternl is the model: a detail view with a
way to read the CBOR.

**Status: built (2026-10-01).** Branch `web-wallet/transaction-view`, from `main`. What
landed, and where it differs from this plan, is at the end under
[*What was built*](#what-was-built).

## Why this one first

It is the only open *After v1* item that is fully unblocked — the contract round
trip still waits on a batcher test — and it is testable on one machine against
checked-in fixtures, with no listing, no testers and no mainnet money. That
matters while the Chrome Web Store listing is down.

## Found before building (2026-10-01)

**Every wallet-built transaction already keeps its CBOR before the review.**
Each flow parks the built transaction in session storage under its own key —
`seedelf.send.built`, `.transfer.built`, `.mint.built`, `.stake.built`,
`.withdraw.built`, `.remove.built`, `.collateral.built`, and the session ones in
`sessions.ts` — all through `keep()` in
[`background/script-spend.ts:241`](../../../extension/src/background/script-spend.ts),
and all of them hold `txCbor` (`transfer.ts:117`, `send.ts:144`,
`withdraw.ts:115`, `mint.ts:133`, `staking.ts:270`). So "available any time the
wallet is building a transaction" needs **no new plumbing**: the view reads the
same `txCbor` the review is already about.

**And the modal cannot lose a signed transaction.** Submit reads the built
transaction back out of its session key — `send(this.deps, network, txHash,
SESSION_SEND, ...)` — not out of the review screen's state. Opening or closing a
modal therefore cannot strand a signed transaction, because the signed bytes
never lived in the component. That is the guarantee the owner asked for, and it
already holds; the chunk only has to not break it. A test pins it: open the view
on a signed transaction, close it, submit, and the submit still goes.

## Start here

- **`inspect_tx` already does the walk.** [`wasm/src/cip30.rs:1490`](../../../wasm/src/cip30.rs)
  returns `TxSummary`: fee, net movement, `paid`, `own_outputs`, `mint`,
  `certificates`, `withdrawals`, `collateral`, validity, signers. It reads the
  whole body in Pallas — but **reduces most of it to tallies**
  (`reference_inputs: usize`, `votes: usize`, `proposals: usize`,
  `metadata: bool`, `scripts: bool`). Nothing new has to be parsed; the detail
  view emits structure where the summary emits counts.
- **`inspect_tx` stays exactly as it is.** It answers "what does this do to my
  account", which is a different question and is load-bearing for the approval
  decision. The new function answers "what is in these bytes".
- **`background/cbor.ts` stays as it is too.** Its own header sets the boundary:
  just enough CBOR to find an item's end, list inputs and compute the id, with
  bounds and depth checks because a dApp hands the worker bytes of its choosing.
  It is the hardened pre-check, not a decoder. Conway's types live in Pallas
  (0.35, already a dependency of the wasm crate) — do not reimplement them in
  TypeScript.
- **The render target exists.** `DappApprovals.tsx` lays `DappTxSummary` out
  through `ReviewRows`/`Row` (label-and-value `<dl>` rows, 21 lines).

## Decided (the owner, 2026-10-01)

1. **No input resolution.** What an input holds is not in the transaction, and
   fetching it would cost a Koios lookup per input on a transaction you are only
   reading. Inputs show as `txhash#index`.
2. **No Cardanoscan link either — a copy button instead.** This is my call
   against the owner's "if anything, a link ... but even that may be too much",
   and their instinct is right. A click-through tells Cardanoscan, from the
   user's own IP, exactly which transaction they are examining — a third party
   that is not otherwise in the wallet's trust set at all, which makes it a worse
   leak than the Koios one and an odd thing to put in a privacy wallet. Copying
   the hash costs nothing, goes nowhere, and lets the user paste it into whatever
   they like. Overrule me if you want the link.
3. **A modal, on every transaction the wallet builds** — see *UI* below.

## The shape that makes it local-testable

A new entry point beside `inspect_tx`:

```rust
pub fn decode_tx(network: &str, tx_cbor: &str) -> Result<TxDetail>
```

No `CardanoAccount`, no `keys`, no `inputs: Vec<KoiosRow>` — **CBOR in, structure
out**. Three consequences worth stating plainly:

1. It makes no network call, so there is nothing to leak by opening it.
2. It is a pure function of its bytes, so a fixture file is a complete test.
3. It cannot be wrong about the account, because it never sees one.

## Scope

### 1. WebAssembly (`wasm/src/` — new `decode.rs`)

`TxDetail`, every field in full rather than counted:

- **Identity:** tx hash, body size, network id, whether the witness set is present.
- **Inputs** and **reference inputs**: `txhash#index`, in body order.
- **Outputs:** address (bech32 and the raw bytes' kind), lovelace, every asset by
  policy and name (hex and UTF-8 when it decodes), inline datum (hex) or datum
  hash, script reference.
- **Mint:** policy, name, signed quantity.
- **Certificates:** each kind in full — stake registration and deregistration
  with deposit, delegation with pool id, DRep delegation, pool registration and
  retirement, committee and DRep certificates.
- **Withdrawals:** reward address and amount. **Votes** and **proposals** in full.
- **Fee**, validity interval (both ends), total collateral, collateral return,
  treasury donation, current treasury value.
- **Required signers**, script data hash.
- **Redeemers:** tag, index, the datum as hex, and the ex-units.
- **Scripts** in the witness set: hash, kind (native, PlutusV1/V2/V3), size.
- **Metadata:** the `Metadatum` tree decoded, not a boolean — labels with their
  values, CIP-20's 674 message read as text where it is one.
- **Anything unrecognised:** reported as a field number and raw hex rather than
  dropped. A view that silently omits what it doesn't understand is worse than no
  view, because it reads as "there is nothing else here".

### 2. Worker (`extension/src/background/`)

One handler that calls `decode_tx` and returns `TxDetail`. No Koios, no storage
write, no session state. It is the cheapest handler in the worker.

### 3. UI (`extension/src/ui/`)

**A modal, Eternl's way:** its own thing, for that one transaction, closed easily
so a transaction that is already signed can still be submitted. Reached from an
**expand / more info** control on the review, on **every** screen that builds a
transaction — so it is one shared component taking a `txCbor`, not an
integration per screen.

**What it leads with is where the value goes.** The owner's framing: "a lot of
the tx viewer is about seeing what is going where." So inputs and outputs come
first and get the room — each output's address, its ADA and its tokens — and
fee, validity, certificates, redeemers, scripts and metadata follow under it.
This is not a flat dump of body fields in CBOR order.

**A Raw CBOR tab** with the hex and a copy button, so the bytes can be taken to
any other decoder.

**The connector's sign window gets it too.** The owner's "any time the wallet is
building a transaction" is read as including it: a site's bytes are the ones the
wallet did *not* build, which is where reading them matters most, and
`TxRequest` already carries `tx_cbor`. Say if that is wrong.

### 4. Tests

- **Fixtures**, checked in, shared by the Rust and WASM tests as chunks 1–3 do:
  a plain payment, a script spend with redeemers and collateral, a certificate
  transaction, one with metadata, one with mint and burn, and a hostile one
  (truncated, over-deep, a count longer than the bytes) that must error rather
  than panic or hang.
- `cargo test -p seedelf-wasm`, the Node tests, vitest for the screen, and
  Playwright for each way in.
- **Cross-check** the decode against `cardano-cli transaction view` or Koios for
  the same transaction, so the fixtures' expected values aren't just our own
  output frozen.

### 5. Docs

`flows.md` (how it is reached), `architecture.md` (why the decoder is in WASM and
`cbor.ts` is not it), the roadmap's table and a handoff note.

## Not this chunk

- Disassembling Plutus scripts to UPLC. A hash, kind and size, not a decompiler.
- Guessing a datum's schema. Inline datums show as hex (and as the `Register` it
  is when the address is the wallet contract).
- Changing `inspect_tx`, `sign_tx` or the approval decision in any way.
- **Activity.** The owner scoped this to transactions the wallet is building, so
  a past transaction is out: it would mean fetching CBOR by hash from Koios,
  which is the privacy question decision 1 just declined. The decoder would work
  on it unchanged if that is ever wanted.

## What was built

Everything above, with the shape as planned: `decode_tx(network, tx_cbor)` in a new
`wasm/src/decode.rs`, one worker handler in `background/tx-view.ts`, one shared
modal in `ui/components/TxDetail.tsx`, and the control on every review plus the
connector's sign window. `inspect_tx`, `sign_tx` and `background/cbor.ts` are
untouched. The owner's three decisions stand as written.

Where it went further than the plan said, and why:

- **The bytes as written, not re-encoded.** The decoder reads with Pallas's
  `MintedTx`, which keeps each item's original CBOR, so a datum's hash is the hash
  of the bytes as written, an inline datum's hex is what sits in the output, and a
  redeemer's argument is a verbatim slice of the transaction (a test asserts that
  slice). Re-encoding would have been simpler and could have shown a hash nothing
  on chain has.
- **The unknown-field scan catches what Pallas drops, too.** Pallas hands a
  *Conway* transaction *alonzo's* auxiliary data, whose typed form knows only keys
  0–2 and reads key 2 as Plutus V1. A V2 or V3 script in the metadata would have
  vanished without a word — exactly what this chunk's rule forbids — so every
  auxiliary script is read from the raw bytes instead of the typed value.
- **Trailing bytes are refused.** One transaction and nothing after it, so the hex
  the Raw CBOR tab shows is the transaction.
- **The cross-check is the whole fixture set, not a sample.**
  `wasm/tests/fixtures/record-decode.mjs` records nine transactions with
  `cardano-cli debug transaction view`'s reading of each, and
  `wasm/tests/decode_test.rs` compares field by field in one loop, so another
  transaction in the fixture is checked without touching the test.
  `cardano-cli transaction build-raw` needs no node, so the certificate, metadata,
  mint-and-burn and governance cases are built offline by cardano-cli itself
  rather than by us.
- **A proposal's parameter change is listed by parameter number and raw CBOR**
  rather than in words: the ledger numbers them, and names here would go stale.

Two things the plan assumed that turned out otherwise, neither load-bearing:

- **Redeemers aren't in index order.** The wallet's own recorded preprod transfer
  writes its redeemer map 1 then 0. The view reports the bytes' order and gives
  each redeemer its own index, rather than renumbering them.
- **Minswap's swap carries CIP-20's `msg` beside its own `extraData` under label
  674**, so the note is read from it and the metadata still shows both keys.

## The CBOR review (2026-10-01, after the push)

A second pass over the decoder against
[Conway's CDDL](https://github.com/IntersectMBO/cardano-ledger/blob/master/eras/conway/impl/cddl/data/conway.cddl),
asking only one question: can it show the bytes wrongly? Four ways it could,
all fixed, each with a test built from what the CDDL allows:

1. **A number too big for JavaScript.** `coin`, `slot`, `epoch` and
   `metadatum_label` are `uint` up to 2^64-1 and `ex_units` is `0 .. 2^63-1`,
   while `JSON.parse` rounds past 2^53. A ttl of 2^60+1 showed as
   1152921504606846800 — wrong by 177. Every number the bytes decide is a
   decimal string now; only counts the decoder works out itself are numbers.
2. **Bytes that are no address hid the whole transaction.** The CDDL types an
   output's `address` and a withdrawal's `reward_account` as plain `bytes`, so
   three stray bytes there were a hard error over everything else in the
   transaction. They show as hex, said to be unreadable, and the rest reads.
3. **Text that reads as something else.** A right-to-left override in a note or
   a token name turns "drowssap" into "password" on the screen; a zero-width
   joiner hides a word break. Each is written out as `\u{...}`, and
   `unicode-bidi: isolate` keeps a right-to-left script inside its own element.
4. **Metadata the body doesn't commit to.** Nothing checked the
   `auxiliary_data_hash` against the metadata, so the view could show a note
   that could never reach the chain. It's checked, warned about, and still
   shown.

And three things the decoder found that the page left out: a collateral return
or total with no collateral inputs (hidden entirely), a stake pool
certificate's parameters and a proposal's own fields (shown as words only), and
Byron witnesses (counted, never said). The page now walks a certificate's and a
proposal's own fields rather than naming the ones it knows, so a field the
decoder gains can't be dropped here either.

**Deliberately not shown:** which of the two output forms was written. The CDDL
calls them "equally valid and interchangeable", cardano-cli writes the list form
for any output needing neither an inline datum nor a script (two of three in the
recorded payment), and they mean the same to the ledger — a label on each row
would read as a warning about nothing. The Raw CBOR tab has the bytes.

A tenth fixture went in with it: a stake pool's own registration, with every
parameter, and its retirement, cross-checked against cardano-cli's reading.

## Less prose on the page (the owner, 2026-10-01)

> Lets cut the paragraph amount of text below inputs … like this could be an icon
> that when hovering it shows that. Honestly probably a lot of the paragraphs we
> have could be like that.

The view's six explanations are behind icons now (`components/Hint.tsx`, new and
shared): an ⓘ in the section's heading, the text on hover through `title`, and on
the page under the heading when it's clicked. Hover alone would leave out anyone
on a keyboard, a screen reader or a touch screen, so the icon does all three at
once, and the text takes room in the flow when it opens rather than floating —
a scrolling panel can never clip it.

**Where it stops.** A privacy `Callout` is a decision from
[privacy.md](../../privacy.md), not an explanation to ask for, and
`tests/screens.test.ts` pins the wording of several; a warning (a transaction
marked to fail, a field the wallet can't name) is the same. Those stay where
everyone reads them, and a test says so.

**The rest of the wallet is the owner's to pick.** There are about 150 plain
`<p className="note">` paragraphs across the screens — Swaps 22, Settings 20,
Lovejoin 17, the connector's window 13, Staking 11 — and each was argued over in
chunks 12 and 14 or in the privacy review, so sweeping them without the owner
would undo decisions rather than tidy them. The component is there for whichever
they name.

## Datums, for any contract (the owner, 2026-10-01)

> so smart contract transactions do not have any datum representation. Its
> literally just says seedelf which is not a solution in general for arbitrary
> datum

Right, and it was the view's biggest hole: a datum was hex, with one special
case for Seedelf's own register. Plutus data is read as the tree it is now
(`DetailPlutus`), in all three places data appears — a datum written into an
output, a datum in the witness set, and **a redeemer's argument**, which was
hex too:

- **constructors by their number**, from whichever tag carries it: 121–127 are
  0–6, 1280–1400 are 7–127, and tag 102 holds any number beside its fields. A
  tag no era defines isn't Plutus data at all, and Pallas refuses it before the
  view sees it, so the view says it can't read the transaction rather than making
  a number up.
- **lists and maps**, each item and each pair;
- **byte strings**, shortened with the whole value on the element, and as text
  where they read as text (escaped, as all text from the chain is);
- **integers however they were written**: a CBOR integer, or the big forms under
  tag 2 and tag 3, where tag 3 holds `-1 - n`. `-18446744073709551617` is read
  exactly, from bytes no `i64` holds.

There is no schema to read a datum against — a contract's datum means whatever
that contract says it means — so the shape is what can honestly be shown. The
Seedelf register stays as the one thing added on top, because it says something
the shape can't: whether a payment under it could be spent.

**`MAX_DATUM_NODES` (512)** bounds one tree: a site could otherwise hand the
wallet a datum that takes minutes to draw. Past it the tree says how many items
are left, and the hex beside it has them all.

**One name worth knowing:** the constructor's number is `constructorIndex`, not
`constructor`. Every object in JavaScript has a `constructor` already
(`Object.prototype.constructor`), so had the field been called that and ever gone
missing, the page would have shown `function Object() { … }` instead of failing.

## All of a datum, and nothing assumed (the owner, 2026-10-01)

> yeah that is not going to work. What if someone needs to read out the whole
> thing. We should follow what etrnl does … its like collaspable json. So you
> expand it out to show everything but also infinity deep without making any
> assumptions.

> also, why does it make assumptions about what contract it came from at all

Both right, and the second one was a plain bug.

**The 512-node cap is gone.** A datum that stopped partway is a worse answer than
no datum: a reader may need every node. The whole tree comes through — five
thousand items come through as five thousand — and the screen is what keeps a big
one readable (`components/PlutusTree.tsx`):

- a branch is a control that opens, and **a closed branch isn't drawn at all**, so
  the size of the data costs nothing until someone opens that part of it. That is
  what makes "no cap" safe;
- the first two levels start open where the branch is small (≤ 24 children), so a
  small datum reads at a glance and a wide one doesn't flood the page;
- **Expand all** opens everything at once, and closes it again;
- **CBOR** and **JSON** take the datum away — the JSON in Plutus data's detailed
  schema (`{"constructor": n, "fields": […]}`, `{"bytes": …}`, `{"int": …}`,
  `{"list": […]}`, `{"map": [{"k": …, "v": …}]}`), the form cardano-cli, Blockfrost
  and Koios all speak;
- each child carries its position, so a field can be matched against a contract's
  schema by eye.

**Depth isn't the view's to limit**, and it doesn't: the only limit is the CBOR
guard that was already there for a site's transaction — `MAX_NESTING`, 128 levels,
because Pallas reads plutus data by recursion and a few thousand levels end the
WebAssembly instance for good. A constructor is two of those levels, so a datum
nests about sixty constructors deep; tests hold both sides of that line. A datum
the view can't reach is one no part of the wallet can read, the connector
included.

**And the assumption, which was a bug.** `register_detail` ran on every datum, so
another contract's `constructor 0` with two 48-byte fields was labelled "a
register" — a false claim about someone else's data. It now runs only for an
output at Seedelf Wallet's own contract, because the address is the only thing
that says which contract will read the datum, and **not at all for a datum in the
witness set**, which belongs to whichever output names its hash and could be any
contract's. A test reads the same transaction as preprod's and as mainnet's: the
datum is the same shape either way, and only the one at our own contract is a
register.
