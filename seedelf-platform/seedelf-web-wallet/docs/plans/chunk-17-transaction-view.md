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

A `TxView` — decoded sections through `ReviewRows`, and a **Raw CBOR** tab with
the hex and a copy button, so the bytes can be taken to another decoder. Ways in:
the connector's sign window, the wallet's own reviews, and Activity rows (see
*Open* below).

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

## Open — your call before I build

1. **Do inputs get resolved?** Decode-only can show `txhash#index`, because what
   an input *holds* is not in the transaction. Showing it needs a Koios lookup
   per input — a privacy cost on a transaction you are merely reading. Three
   options: never; only on the connector path, where the extension already
   fetched those rows and it is free; or behind a button that says it will cost a
   lookup. Private-by-default argues for the last.
2. **Which ways in**, and is Activity in scope this chunk? Activity means
   fetching a transaction's CBOR by hash, which is a Koios call and a different
   privacy question from inspecting what you are about to sign.
3. **What of Eternl's you want matched** — its grouping, what it puts behind a
   tab, how it shows the raw bytes. Take the idea, not its brand or assets, as
   chunk 11a did with Lace.

## Not this chunk

- Disassembling Plutus scripts to UPLC. A hash, kind and size, not a decompiler.
- Guessing a datum's schema. Inline datums show as hex (and as the `Register` it
  is when the address is the wallet contract).
- Changing `inspect_tx`, `sign_tx` or the approval decision in any way.
