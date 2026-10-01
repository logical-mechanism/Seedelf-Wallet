# Chunk 17 plan: the transaction view

Open the transaction itself — inputs, outputs, datums, scripts, certificates,
metadata — decoded from the CBOR that is about to be signed, plus the raw bytes.
The owner's ask from the 2026-09-28 mainnet test, listed under *After v1* in
[roadmap.md](../roadmap.md#after-v1). Eternl is the model: a detail view with a
way to read the CBOR.

**Status: planned, not built.** Branch `web-wallet/transaction-view`, from `main`.

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
[`background/script-spend.ts:241`](../../extension/src/background/script-spend.ts),
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

- **`inspect_tx` already does the walk.** [`wasm/src/cip30.rs:1490`](../../wasm/src/cip30.rs)
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
