# v-pr338-3-impact: pr338#3, impact and the fix

**Verdict: partly. Severity I'd assign: low** (as filed). Docs only. It doesn't block the release.

## What holds

- **The omission is real.** The roadmap's entry for the Leios run (`post-release-roadmap.md:405-409`) never mentions reading a third party's transaction. The run's README did make a decoding point, and #338 dropped it. Its line 409, "What Leios would change in the wallet", is the list a Dijkstra release would be scoped from.
- **The code claim holds, and I ran it** (scratch test, since deleted). A three-element transaction, `[body, witnesses, null]` or `[body, witnesses, {metadata}]`, is refused in three places, each with "unexpected type null/map at position 192: expected bool":
  - signing: `cip30::inspect_tx` → `cip30.rs:1029` `conway::Tx::decode_fragment`;
  - Transaction details: `decode.rs:633` `conway::MintedTx`;
  - the swap's cancel check: `orders.rs:1175` `MultiEraTx::decode`.

  Each of Pallas 0.35.1's Conway, Babbage and Alonzo transaction types has `#[n(2)] pub success: bool` (`conway/model.rs:1597-1598`, `alonzo/model.rs:960-961`). Pallas 1.0.0 and 1.1.1 (in the registry) have no Dijkstra model. Since the readers name `conway::` types, updating Pallas alone wouldn't change this.
- **The reach is wider than the finding says.** Every transaction a third party builds goes through `cip30::inspect_tx`:
  - a public site's (`inspectDappTx`, `dapp.ts:2043`);
  - a private session's site (`inspectSessionTx`);
  - a swap from Minswap's aggregator (`sessions.ts:4199`, then `checkOrderCancels` → `orders.rs:1175`).

  The wallet's own transactions are Conway's four-element shape, which Dijkstra still takes (the run's README). The extension reads no transaction CBOR from the chain at all (no `tx_cbor` in `background/` or `shared/`). So the README's "only meets it where it reads others' from the chain" describes paths the wallet doesn't have. The gap is on exactly the third-party paths. The README is on the unmerged branch and outside this review.

## What doesn't

- **No 1.7.0 user can reach it today.** Neither network the wallet offers runs Dijkstra:
  - mainnet is Conway;
  - preprod still took list-form redeemers in the 1.6.0 gate's live run (2026-10-25/26), and PV12 refuses those.

  Once Dijkstra reaches either network, the shipped build fails every private spend anyway, as line 406 already says, so a Dijkstra release is needed regardless. Even then, this needs a site's or aggregator's library to emit the three-element shape rather than Conway's. The run saw only IO's load generator do that.
- **The finding's "can't read Dijkstra's new fields", and the fix's "refuses ... its new fields", are wrong.** minicbor-derive skips unknown map keys (minicbor-derive 0.15.3, `_ => __d777.skip()?`). With body key 23 added to Conway's shape:
  - `inspect_tx` reads the transaction, and nothing in `TxSummary` names the key, so the signing prompt passes over it without a word;
  - `decode_tx` lists it as unknown (`[("body","23")]`), which `TxDetail.tsx:337` shows as `tx.warn.unknownFields`. The existing `an_unknown_field_is_reported_rather_than_dropped` test pins this.

  Harmless under Conway, whose ledger refuses unknown keys. It's worth recording for the Dijkstra release.

## The fix

Add one clause to line 409, corrected. For example:

> A site's transaction, or a swap's from Minswap, is read as Conway's (CIP-30's `inspect`, Transaction details, the swap's cancel check): Dijkstra's own three-element shape is refused, and a body field new in Dijkstra goes unshown in the prompt (Transaction details lists it as unknown). A Pallas update alone doesn't change it.

- **It stays within the owner's rules:** no guard or refusal, no UI text, no privacy note touched, no release date.
- **It breaks nothing:** no test reads the roadmap, and `words.test.ts` scans `extension/src` only.
- **Skip the proposed test.** It would pin a refusal the Dijkstra ledger doesn't make, and it changes nothing for 1.7.0. The Dijkstra release should add the positive test: a three-element transaction inspects.
- **Don't add a refusal of unknown body keys to signing.** That would be a new guard (rule 1), so it's the owner's call. The real fix is reading Dijkstra's fields.

## Repro

`seedelf-web-wallet/wasm/tests/zz_review_v_pr338_3_impact_1.rs` (deleted), run with `cargo test --locked -p seedelf-wasm --test zz_review_v_pr338_3_impact_1 -- --nocapture`. It passed, printing:

```
4-element, signing: net -3200000 signs ["0/0"]
3-element (null), signing: The wallet can't read this transaction: unexpected type null at position 192: expected bool
3-element (null), Transaction details: The wallet can't read this transaction: unexpected type null at position 192: expected bool
3-element (null), MultiEraTx::decode (swap check): ok=false
3-element (metadata), signing: ... unexpected type map at position 192: expected bool
3-element (metadata), Transaction details: ... unexpected type map at position 192: expected bool
3-element (metadata), MultiEraTx::decode (swap check): ok=false
4-element + key 23, signing: read, net -3200000 signs ["0/0"], nothing in the summary names key 23
4-element + key 23, Transaction details: unknown [("body", "23")]
```
