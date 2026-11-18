# r2sign#1: verification

From lane R2sign, graded medium by its finder.

## Trace: confirmed, medium

The finding holds. I found no guard the finder missed. This round's reader in 36fbb96f has two parts: cip30 `register_fields`/`spender`, which reads Pallas's data, and the lookup of a datum the witness set carries. Together they label two shapes "register", so the window shows only the privacy callout "It pays a Seedelf…" and no warning:
- an inline `102([_ 0, [g, u]])`, the general form with an indefinite pair;
- a datum kept by hash, carried in the witness set, which isn't signed.

On main, both shapes read "none" under the noRegister warning. No Seedelf Wallet finds or spends either output once it's on chain:
- chain.ts `registerOf` reads `inline_datum` only and refuses an indefinite pair.
- seedelf-koios `register_of_datum` refuses the indefinite pair too. It is behind `extract_bytes_with_logging`, which reads `inline_datum` only.
- The WebAssembly's spends, core's `ScriptSpend::new` and the CLI all go through that reader.

Transaction details has the same gap: decode.rs `register_detail` marks the indefinite pair `payable`, so tx-view `markYours` says "Yours, in your private balance" under the user's own register.

The node accepts the indefinite pair (cardano-cli 11.0.0.0, offline). The worker passes `paid[].seedelf` through unchanged.

My test fails at exactly those three readings, and every control passes. In a copy, it passes with a sketch fix.

Grade: medium.
- Who: a site.
- Harm: an ordinary signature strands the user's money, and the window, which used to warn, now reassures.
- In the hash shape the site can strip the datum before submitting, since the body has no script_data_hash and the witness set isn't signed. Then only the site holds the preimage, and the money is locked for good.
- Not high: the site gains nothing, and nothing the window says about the chain is false. The gap is that the receiving wallet can't read the payment.
- Narrower than it reads: an indefinite pair is hand-made. A datum kept by hash is what embed-style tooling writes (cardano-cli's `--tx-out-datum-embed-*`). That tooling also writes a script_data_hash, which publishes the datum, so the money is stranded rather than locked.

One aside in the finding is wording only: "anyone can take" for an uncarried hash is a cautious warning, not a money harm.

**Evidence:**

Fix tree at f88560c4. None of the Rust or TS files traced here are modified in the working copy.

**The window's reading:**
- wasm/src/cip30.rs:863-876 `register_fields`: `matches!((c.tag, c.any_constructor), (121, _) | (102, Some(0)))`, then two BoundedBytes. It reads Pallas's data, not the bytes.
- Pallas 0.35.1 plutus_data.rs:332-339, tag 102: `d.array()?` at any length, and the closing break is never consumed.
- pallas-codec utils.rs:532-537: CborWrap decodes the inner bytes with `minicbor::decode_with`, which ignores trailing bytes. So `d866 9f 00 82 g u ff` reads as Constr{102, Some(0), [g, u]}.
- cip30.rs:1131-1146 `carried`: the witness set's plutus_data, keyed by blake2b of each datum's raw bytes.
- cip30.rs:1288-1307: `let datum = inline_data(out).or(carried_datum.as_ref()); match spender(datum) { Owner => "register", Anyone => "none", Nobody => "dead" }`.
- Worker dapp.ts:2448-2456: `named` only adds `yours` to paid outputs, so `seedelf` passes through unchanged.
- DappApprovals.tsx:1206 shows the dapp-seedelf-unsafe warning (en.json:520, "It pays Seedelf Wallet's contract without a register: whatever goes there, anyone can take.") only for "none". Line 1217 shows the privacy callout paysSeedelfAccount (en.json:468) for "register".
- The fixer pins the hash case: wasm/tests/cip30_test.rs:1940, 'a register the witness set carries' → "register".

**Before this round (main's cip30.rs):**
- `register_datum` accepted tag 121 only.
- The seedelf label read `inline.as_deref().is_some_and(is_register_datum)`: inline datums only, re-encoded by Pallas, which writes the 102 pair definite.
- So both shapes read "none".
- `git log -S` puts `carried_datum` and `fn register_fields` in 36fbb96f.

**The receiving side:**
- chain.ts:85 reads `utxo.inline_datum?.bytes`, and chain.ts:94 has `if (!pair || pair.major !== 4 || pair.arg !== 2) return undefined;`, where `arg` is null for 9f.
- `registerOf` is the only register reader for balances.ts:546 `ownedUtxos` (the private balance) and contract-scan.ts:418.
- private-index.ts:399 hands `row.datum` over as `inline_datum` too.
- seedelf-koios koios.rs:369 has `if d.array().ok()? != Some(2) || d.u64().ok()? != 0 { return None; }`. `extract_bytes_with_logging` (koios.rs:343-355) reads `inline_datum` only.
- That reader is used by wasm lib.rs:2351 `check_spendable` and :5064 `remove_spend`, and by core build.rs:1549 `ScriptSpend::new` ("holds no register").
- build.rs has no witness-datum path: only `set_inline_datum` (341, 3078, 3916).
- No test pins the indefinite pair either way. rows_test.rs lists the 102 definite pair only, and the reader's doc says "however the CBOR spells them".

**Transaction details:**
- decode.rs:1246-1255 `register_detail` uses `register_fields` and sets `payable: who == Spender::Owner`. It applies to inline datums at the contract (:1304-1306).
- tx-view.ts:325: `o.address.seedelf && o.register?.payable && ownRegister(...)` gives `kind: "private"`, which is en.json:2903 "Yours, in your private balance".
- On main, decode.rs read the register through the tag-121-only `register_datum`, so this half is new too.

**Ledger, run offline with cardano-cli 11.0.0.0 in my scratch folder:**
- `hash-script-data` on `d8669f0082…ff` (106 bytes) gives 535d57bb…9d76, the blake2b-256 of the bytes as written. A three-element indefinite pair is refused: "Expected exactly two elements".
- `build-raw` with that inline datum at addr_test1wz2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g6g7mzn9f (script hash 94bca9c0…a469), then `debug transaction view`, shows `"datum": {"constructor": 0, "fields": [g, u]}`.
- The body holds the indefinite pair as written (True), not the definite re-encoding (False).
- `--tx-out-datum-embed-cbor-file` refuses without protocol parameters, "required to compute the script integrity hash". So embed-style tooling writes a script_data_hash.

**Run:**
- My test (below) fails on the fix tree with exactly three entries. Every control passes: Pallas equality of the three spellings, and the 121 and 102-definite rows found, spent and read "register".
- In an rsync copy (~/.cache/seedelf-review-51/r2sign_1-trace, its own CARGO_TARGET_DIR, since removed) I applied a sketch fix:
  - register_of_datum's tag-102 branch takes an indefinite pair, closed by a break after the fields;
  - cip30 gives a datum kept by hash the value "hash" and stops reading carried datums for the label.
- With it the test passes, and rows_test's two reader tests still pass.
- In the same copy, cip30_test's `a_payment_into_seedelf_says_who_can_take_it` failed only at its three hashed rows (register, dead, none, all now "hash"). That's what the fix must update.

**Known:** none. Searched:
- docs/backlog.md for 'datum hash', 'kept by hash', 'by hash', 'indefinite pair', '102([_', 'witness set carries', 'carried datum' and 'datum_hash'. Only hit: :145, contract inputs kept by hash for the release warning, a different shape (inputs, not payments into the Seedelf contract).
- docs/archive/plans/ for the same terms plus 'datum kept'. Hits are unrelated: chunk-27 (order datums via datum_info), review-1.9.0.md:76 (a carried datum hashed as written, a test list) and chunk-24 (Minswap's adapter datum hash).
- review-51/owner-calls.md: x1a#2 is about the "Nothing on chain says whose" claim, and gap-g8#5 about cbor.ts's indefinite outer arrays. Neither is this.
- fixes/G3.md, d1#3's fix record: it names neither split.
- SECURITY.md's out-of-scope list: nothing applies. A site writes the bytes, no data source lies, and it isn't social engineering, since the wallet's own words mislead.
- Frozen code: none of it is involved.
- x3-1's verify predicted the indefinite-pair split as a class note ("Even after this fix it would read register while the scan can't find it"). That is chunk 51's own unfixed note, not a settled item. The carried-hash reading is new in 36fbb96f.

**Fix notes:**

Class: a payment is a "Seedelf payment" only where the receiving wallet reads it. The sign window, Transaction details and the scan must share one reader, and that reader must take every spelling the ledger takes.

1. Widen both scan readers to the indefinite pair. This needs no owner: it drops a refusal the ledger doesn't make.
   - seedelf-koios koios.rs:366-373: for tag 102, accept `d.array()` = Some(2) or None. For None, require a break after the fields (sketch run in a copy: it passes this test and rows_test).
   - chain.ts:92-98 the same way: accept `pair.arg === null`, then require 0xff after the fields' end.
   - The spelling then lands in the private balance, and the window's "register" becomes true for it.
   - The alternative, x3-1's recommendation: make the window's Owner need register_of_datum over the output's bytes as written. That needs MintedTx/KeepRaw to get the inline raw bytes.
2. A datum kept by hash: never "register". No Seedelf Wallet lists a row without an inline datum, and core's ScriptSpend has no witness-datum path.
   - Give it a value of its own with a warning. A carried register no one can spend can keep "dead".
   - The uncarried "none" ("anyone can take") folds into the same value, as d1#3's lane fix asked.
   - Update cip30_test.rs:1938-1950's three hashed rows, and Paid's doc comment (cip30.rs:593-597).
   - This adds a critical `.warn.` string (es/ja drafts, back-translated), so the words are the owner's.
3. decode.rs:1246-1255 `register_detail`: its `payable` must follow the same reader, so tx-view.ts:325 `markYours` never says "Yours, in your private balance" for what the balance can't show.
4. Docs: privacy.md:336, and architecture.md:201 ("A datum kept by hash is read from the witness set when the transaction carries it").
5. One shared vector list read by both chain.ts registerOf and register_of_datum, plus the window's reading of each spelling: 121 with definite and indefinite fields, 102 with a definite and an indefinite pair, chunked points, inline and by hash. That stops the readers drifting again.

Family:
- Lovejoin's parse_mix_datum (fixed in 0c965ff8 over Pallas's data) already takes the indefinite pair, so the box reader and the register readers now disagree on it too.
- seedelf-data's copies are outside the chunk.

needs_owner: yes for 2 and 4 (a new warning and the privacy words). No for 1 and 3.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-web-wallet/wasm/tests/r51_r2sign_1.rs`

Result: Run on the fix tree from seedelf-platform with `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m nice -n 10 cargo test -j 4 --locked -p seedelf-wasm --test r51_r2sign_1`:

running 1 test
test a_payment_the_window_calls_a_seedelfs_is_one_a_seedelf_wallet_finds_and_spends ... FAILED
---- a_payment_the_window_calls_a_seedelfs_is_one_a_seedelf_wallet_finds_and_spends stdout ----
The inline datum isn't a register.
Inline datum is None.
thread '...' panicked at seedelf-web-wallet/wasm/tests/r51_r2sign_1.rs:210:5:
[
    "sign window: output 2, 102([_ 0, [g, u]]) inline, an indefinite pair, reads Some(\"register\") (\"It pays a Seedelf…\", no warning), while a Seedelf Wallet never finds or spends it",
    "Transaction details: output 2, 102([_ 0, [g, u]]) inline, an indefinite pair, reads payable under the user's key: true (\"Yours, in your private balance\"), while a Seedelf Wallet never finds or spends it",
    "sign window: output 3, kept by hash, the datum carried in the witness set, reads Some(\"register\") (\"It pays a Seedelf…\", no warning), while a Seedelf Wallet never finds or spends it",
]
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.66s

The two stderr lines come from `extract_bytes_with_logging`: the indefinite-pair row and the hash row. Every assert before the last one passed: Pallas equality of the three spellings, the four datum kinds, and the controls (121 and 102-definite rows found, spent and read "register").

I also ran the test in an rsync copy with a sketch fix: register_of_datum takes the indefinite pair, and a datum kept by hash gets its own value "hash". The copy had its own CARGO_TARGET_DIR under ~/.cache and was removed afterwards. Result: `test a_payment_the_window_calls_a_seedelfs_is_one_a_seedelf_wallet_finds_and_spends ... ok`, 1 passed. In the same copy, rows_test's `register` tests passed (2 of 2), and cip30_test's `a_payment_into_seedelf_says_who_can_take_it` failed only at its three hashed rows (now "hash").

VITE_ENABLE_MAINNET doesn't apply: this is a Rust test.

```
//! Chunk 51, r2sign#1: the sign window calls a payment into Seedelf Wallet's
//! contract a Seedelf payment ("register": "It pays a Seedelf. Nothing on
//! chain says whose…", and no warning) only where a Seedelf Wallet will find
//! it and can spend it. This round's reader (cip30 `spender`, over Pallas's
//! data, and over the datum the witness set carries for an output's hash)
//! calls two shapes "register" that no Seedelf Wallet reads:
//! - constructor 0's general form with an indefinite pair, `102([_ 0, [g, u]])`,
//!   which the node decodes as `Constr 0 [g, u]` and keeps as written
//!   (cardano-cli 11.0.0.0, offline);
//! - a datum kept by hash, carried in the witness set, which isn't signed.
//!
//! A Seedelf Wallet reads a contract row's register from its inline datum's
//! bytes with seedelf-koios `register_of_datum` (the WebAssembly's
//! `check_spendable` and `remove_spend`, core's `ScriptSpend`, the CLI; the
//! worker's chain.ts `registerOf` is its twin), and a Koios row has no inline
//! datum for an output that keeps its datum by hash. Transaction details'
//! `payable` (decode.rs `register_detail`) has the same gap for the indefinite
//! pair: under the user's own register, tx-view.ts `markYours` says "Yours, in
//! your private balance". This asserts the right behaviour, so it fails while
//! the bug is there.

use pallas_addresses::Address;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::{Fragment, PlutusData};
use seedelf_core::build::{self, Chain, ScriptSpend};
use seedelf_core::constants::get_config;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse, extract_bytes_with_logging};
use seedelf_wasm::cip30::{self, KeyPath, KoiosRow, TxRequest};
use seedelf_wasm::decode::decode_tx;
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TX_A: &str = "1111111111111111111111111111111111111111111111111111111111111111";

fn account() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, 0).unwrap()
}

/// A CBOR byte string: its head, then the bytes.
fn bstr(b: &[u8]) -> String {
    let head = match b.len() {
        n if n < 24 => format!("{:02x}", 0x40 + n),
        n if n < 0x100 => format!("58{n:02x}"),
        n => format!("59{n:04x}"),
    };
    format!("{head}{}", hex::encode(b))
}

/// A post-Alonzo output, written by hand: Pallas would write a tag-102 pair
/// back definite, and the site's bytes are what's signed and put on chain.
fn output(address: &Address, lovelace: u32, datum_option: Option<String>) -> String {
    let address = bstr(&address.to_vec());
    match datum_option {
        Some(option) => format!("a300{address}011a{lovelace:08x}02{option}"),
        None => format!("a200{address}011a{lovelace:08x}"),
    }
}

#[test]
fn a_payment_the_window_calls_a_seedelfs_is_one_a_seedelf_wallet_finds_and_spends() {
    // The receiving Seedelf's register, re-randomized as a payment's is: u = g^sk.
    let sk = random_scalar();
    let owner = Register::create(sk).unwrap().rerandomize().unwrap();
    assert!(build::is_payable(&owner));
    // 121([_ g, u]), as the wallet writes it, and the general form both ways.
    let canonical = owner.to_vec().unwrap();
    assert_eq!(hex::encode(&canonical[..3]), "d8799f");
    let fields = &canonical[3..canonical.len() - 1];
    let definite_pair = [&[0xd8, 0x66, 0x82, 0x00, 0x82][..], fields].concat();
    let indefinite_pair = [&[0xd8, 0x66, 0x9f, 0x00, 0x82][..], fields, &[0xff]].concat();
    // All three are the same Plutus data, Constr 0 [g, u], to Pallas as to the
    // node: the contract reads them alike, and only sk's holder can spend.
    let data = |b: &[u8]| PlutusData::decode_fragment(b).unwrap();
    assert_eq!(data(&definite_pair), data(&canonical));
    assert_eq!(data(&indefinite_pair), data(&canonical));
    let kept = Hasher::<256>::hash(&canonical);

    // A site's transaction: the account's 10 ₳ pays 2 ₳ into the contract four
    // ways, under the same register, and the rest back to its change address.
    let config = get_config(1, true).unwrap();
    let contract_hash = config.contract.wallet_contract_hash;
    let contract = seedelf_core::address::wallet_contract(true, contract_hash);
    let change = account().base_address(true, Role::Change, 0).unwrap();
    let inline = |d: &[u8]| format!("8201d818{}", bstr(d));
    let outputs = [
        output(&contract, 2_000_000, Some(inline(&canonical))),
        output(&contract, 2_000_000, Some(inline(&definite_pair))),
        output(&contract, 2_000_000, Some(inline(&indefinite_pair))),
        output(&contract, 2_000_000, Some(format!("8200{}", bstr(kept.as_ref())))),
        output(&change, 1_800_000, None),
    ];
    let body = format!(
        "a30081825820{TX_A}0001{:02x}{}021a{:08x}",
        0x80 + outputs.len(),
        outputs.concat(),
        200_000
    );
    // The witness set carries the datum the fourth output keeps by hash.
    let tx = format!("84{body}a10481{}f5f6", hex::encode(&canonical));
    assert!(tx.contains(&format!("d818{}", bstr(&indefinite_pair))), "the pair as written");

    let input: KoiosRow = serde_json::from_value(json!({
        "tx_hash": TX_A, "tx_index": 0,
        "address": account().base_address(true, Role::Receive, 0).unwrap().to_bech32().unwrap(),
        "value": "10000000", "asset_list": [],
    }))
    .unwrap();
    let request = TxRequest {
        network: "preprod".into(),
        tx_cbor: tx.clone(),
        keys: (0..3)
            .flat_map(|index| [KeyPath { role: 0, index }, KeyPath { role: 1, index }])
            .collect(),
        inputs: vec![input],
        partial_sign: false,
        stake_index: 0,
        stake_deposit: None,
        governance: false,
    };
    let summary = cip30::inspect_tx(&account(), &request).unwrap();
    assert_eq!(summary.paid.len(), 4, "the change is the account's own");
    let datums: Vec<_> = summary.paid.iter().map(|p| p.datum.as_deref()).collect();
    assert_eq!(datums, [Some("inline"), Some("inline"), Some("inline"), Some("hash")]);
    let detail = decode_tx("preprod", &tx).unwrap();

    // Each output as Koios lists it once it's on chain.
    let rows: Vec<UtxoResponse> = (0..4u64)
        .map(|index| {
            let written: Option<&[u8]> = match index {
                0 => Some(&canonical),
                1 => Some(&definite_pair),
                2 => Some(&indefinite_pair),
                _ => None,
            };
            let hash = written.map_or(kept, Hasher::<256>::hash);
            serde_json::from_value(json!({
                "tx_hash": summary.tx_hash, "tx_index": index,
                "address": contract.to_bech32().unwrap(), "value": "2000000",
                "stake_address": null, "payment_cred": hex::encode(contract_hash),
                "epoch_no": 0, "block_height": 0, "block_time": 0,
                "datum_hash": hex::encode(hash.as_ref()),
                "inline_datum": written.map(|b| json!({ "bytes": hex::encode(b), "value": null })),
                "reference_script": null, "asset_list": [], "is_spent": false,
            }))
            .unwrap()
        })
        .collect();

    // What a Seedelf Wallet does with such a row: reads its register from the
    // inline datum, owns it by sk, and spends it (core's `ScriptSpend`).
    let epoch: Value = serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/epoch_params.json"
    ))
    .unwrap();
    let chain = Chain {
        params: ProtocolParameters::from_koios(&epoch[0]).unwrap(),
        network_flag: true,
        config: get_config(1, true).unwrap(),
    };
    let signer = Hash::<28>::new([7; 28]);
    let finds = |row: &UtxoResponse| {
        extract_bytes_with_logging(&row.inline_datum)
            .is_some_and(|r| build::is_payable(&r) && r.is_owned(sk).unwrap_or(false))
            && ScriptSpend::new(&chain, std::slice::from_ref(row), &owner, signer).is_ok()
    };

    // Controls, which hold today: the two spellings the wallet reads are found,
    // spent and called a Seedelf payment, in the window and in the details.
    for i in 0..2 {
        assert!(finds(&rows[i]), "output {i} is found and spent");
        assert_eq!(summary.paid[i].seedelf.as_deref(), Some("register"));
    }

    let names = [
        "121([_ g, u]) inline, as the wallet writes it",
        "102([0, [g, u]]) inline",
        "102([_ 0, [g, u]]) inline, an indefinite pair",
        "kept by hash, the datum carried in the witness set",
    ];
    let mut wrong = Vec::new();
    for (i, name) in names.iter().enumerate() {
        let found = finds(&rows[i]);
        let wallet = if found { "finds and spends it" } else { "never finds or spends it" };
        let window = summary.paid[i].seedelf.as_deref();
        if (window == Some("register")) != found {
            wrong.push(format!(
                "sign window: output {i}, {name}, reads {window:?} (\"It pays a Seedelf…\", no warning), \
                 while a Seedelf Wallet {wallet}"
            ));
        }
        // tx-view.ts markYours: the contract, `register.payable`, and the user's key.
        let yours = detail.outputs[i].address.seedelf
            && detail.outputs[i].register.as_ref().is_some_and(|r| {
                r.payable
                    && Register::new(r.generator.clone(), r.public_value.clone())
                        .is_owned(sk)
                        .unwrap_or(false)
            });
        if yours != found {
            wrong.push(format!(
                "Transaction details: output {i}, {name}, reads payable under the user's key: {yours} \
                 (\"Yours, in your private balance\"), while a Seedelf Wallet {wallet}"
            ));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}
```

## Impact: partly, low

What the finding says holds. Since 36fbb96f the sign window marks two kinds of payment into the contract "register". It shows the privacy callout "It pays a Seedelf…" and no warning. (a) is a datum kept by hash whose payable register the unsigned witness set carries. (b) is an inline 102([_ 0, [g, u]]). At 1.9.1 both read "none" and showed the "anyone can take" warning. Today no reader in the web wallet or the CLI takes either shape. For (b) under the user's own register, Transaction details also says "Yours, in your private balance".

The harm is low, not medium:
- **Who:** only a site writes these bytes. No standard encoder writes (b): Plutus writes constructor 0 as tag 121, and a 102 pair as a fixed-length list. Neither Seedelf tool ever makes a datum-hash payment.
- **No gain:** the site gets nothing. A hostile site gains more by paying its own canonical register under the identical callout.
- **What shows is true:** the amount and the full address are right. The lock the window reads is the real one, because the signed body's hash binds the carried datum.
- **The money stays the owner's:** in (b), and in (a) whenever the datum goes on chain, only the register's key can spend it. A wallet release brings it back. For (b) that release is the two-reader widening that r3a-1's and x3-1's verify records already recommend.
- **The one lock for good** is (a) with the datum stripped after signing. That is deliberate griefing with no gain, no worse than paying a keyless address, which any site can already get signed.
- **Precedent:** w2#2, a burn shown as a Seedelf payment, was verified low on these same grounds.

Way out: Decline.

**Evidence:**

FIXTREE HEAD f88560c4. The working copy changes none of the files traced, and I read them with git show HEAD: anyway.

The window:
- cip30.rs:1131-1146 builds `carried` from MintedTx witness-set plutus_data, keyed by blake2b-256(raw_cbor). The map existed at 1.9.1 (web-wallet/1.9.1 cip30.rs:1232) but only for datum_names_key.
- cip30.rs:1288-1307 is new in 36fbb96f: `let datum = inline_data(out).or(carried_datum.as_ref()); match spender(datum) { Owner => "register", Anyone => "none", Nobody => "dead" }`.
- register_fields (cip30.rs:863-876) reads Pallas data `(121, _) | (102, Some(0))`.
- Pallas 0.35.1 plutus_data.rs Constr::decode's 102 branch calls `d.array()?`. It never checks for a fixed-length list or consumes the closing break. CborWrap::decode (pallas-codec 0.35.1 utils.rs:532-537) calls minicbor::decode_with, which ignores trailing bytes. So (b) reads as a payable register.
- build::tx_id (build.rs:1201-1210) hashes the raw body item, so the site's bytes go on chain as written.
- At 1.9.1 (TREE cip30.rs:1385-1395) the code was `if inline.as_deref().is_some_and(is_register_datum) {"register"} else {"none"}`, which gives "none" for both shapes.

What the user sees:
- DappApprovals.tsx:1206-1221: "none" shows the noRegister warning (en.json:520). "register" shows the privacy callout paysSeedelfAccount (en.json:468).
- The label is read only in the UI: DappApprovals.tsx:1206/1212/1217/1351 and ui/dapp.ts:53 paidTo. The worker records nothing from it.
- paidTo says "Seedelf Wallet's contract, with data", with the full bech32 and the amount, both true.

The receiving side:
- chain.ts:85 reads `utxo.inline_datum?.bytes` only, and :94 has `pair.arg !== 2`.
- koios.rs:364-390 register_of_datum has `d.array().ok()? != Some(2)`. extract_bytes_with_logging (koios.rs:343) reads inline_datum only.
- wasm lib.rs reads only inline datums at :2351, :3052 and :5064. build.rs writes only inline datums (341, 3078, 3916) and adds no witness datum.
- Neither reader changed on the fix branch: git log main..HEAD shows nothing for chain.ts, and the koios.rs diff doesn't touch register_of_datum.

Transaction details:
- decode.rs:1303-1306 reads registers from inline datums only, so (a) shows none.
- For (b) under the user's register, tx-view.ts:325 marks it private, which reads "Yours, in your private balance" (en.json:2903).

Ledger side (reasoned):
- A transaction whose witness set carries a datum needs a script_data_hash in the body. The finder's case (a) body had none, so to submit it the site must drop D. That is the only path to a lock for good, and only when D is written in a way the key's holder can't rebuild.
- When D is carried validly, it is on chain, and only the register's key can spend the output.

Impact:
- Only a site writes these bytes, and it gains nothing.
- A hostile site can already pay its own canonical register under the identical callout and keep the money, or burn money to any keyless address.
- verify/w2-2.md graded the closer case low: a burn labelled a Seedelf payment, with "no one profits" and "Way out: Decline".
- For (b), a release that widens both readers returns the money. 4cbac01e's rule version on sealed verdicts lets such a release re-judge rows the private index already sealed.
- The finding's last case, a hash with no D still reading "anyone can take", is d1#3's old wording. It errs on the cautious side.

**Known:** Not settled; part (a), reading the carried datum, is new in 36fbb96f.

Part (b) comes from both readers refusing 102([_ 0, fields]). This review records that only as notes:
- review-51/verify/r3a-1.md:45-47 ("A payer can hide a payment to a Seedelf in 102([_ 0, fields]): the payer's own money, low") and :237;
- verify/x3-1.md:62-64, which predicted "Even after this fix it would read 'register' while the scan can't find it";
- lanes/X2.md:103, lanes/X3.md:75, lanes/critic.md:134 and lanes/gap-G6.md's scenario.

None of it is in docs/backlog.md, docs/archive/plans/ or review-51/owner-calls.md. I found no "indefinite pair" or "102([_" outside review-51.

Nearest backlog item: backlog.md:145 (❓, the release warning's limits; check the body's script data hash against the witness set). That is a different shape: contract inputs.

Grade precedent: verify/w2-2.md (a burn shown as a Seedelf payment, low).

**Fix notes:**

Split the fix. Only the datum-hash half needs the owner.

1. **No owner call.** Widen chain.ts registerOf (:94) and seedelf-koios register_of_datum (:369) to take tag 102 with an indefinite pair, closed by its break. This removes a refusal the ledger doesn't make.
   - Pin it with one shared vector set run through both readers and cip30::register_fields, so the three can't drift again. The set: 121 with fixed and indefinite fields; 102 with a fixed and an indefinite pair; chunked points.
   - In the same release, bump the private index's sealed-verdict version (4cbac01e's rule version), so rows already sealed as not ours are judged again.
   - This makes (b)'s window label and Transaction details' "Yours, in your private balance" true. decode.rs register_detail needs no change of its own.
2. **Owner call: new words.** A datum kept by hash should never read "register" while no Seedelf tool reads such a payment. Give it a value and warning of its own, a new .warn. string to back-translate.
   - 1.9.1's "none" is the cautious fallback, but its "anyone can take" is false for a carried register.
   - Optionally, count a carried datum only when the body's script_data_hash commits to the witness datums. With no redeemers that can be computed without cost models, so a datum the site can strip after signing isn't read as carried.
3. **Docs.** architecture.md:201 ("A datum kept by hash is read from the witness set…") and privacy.md:336 follow from 1 and 2. privacy.md is being edited in the working copy, so work from HEAD.


## Severity tiebreak (trace medium, impact low)

**Severity: low.**

The finding holds on FIXTREE HEAD e66a6a16, which changes none of the traced files after f88560c4.
- cip30.rs:1292-1304 reads the datum a transaction carries for an output's hash and never looks at the body's script_data_hash.
- register_fields (:863-876) takes tag 102 with an indefinite pair.
- Both scan readers still refuse that pair (chain.ts:94 `pair.arg !== 2`, koios.rs:369 `d.array() != Some(2)`) and read inline datums only.

On the brief's scale it is low, not medium:
- **Who causes it:** a site. It has to write bytes no standard encoder writes: Plutus, Aiken and CSL write constructor 0 as tag 121, and use tag 102 only with a definite pair. Or it uses a datum-by-hash style that no Seedelf tool or known dApp uses for a Seedelf payment. The site pays nothing and gains nothing.
- **What the window shows is true:** the amount, the full contract address, and the register. The window uses a carried datum only when its blake2b hash equals the output's hash, so the lock it describes is the one the signed body commits to. This is not "signs something other than what it shows".
- **What the user loses:** in shape (b), and in shape (a) whenever the body carries a script_data_hash, the money sits under a register only its key's holder can spend, and the datum is public. Every standard builder writes that hash, and cardano-cli won't embed a datum without one. The money is stranded until a release, not lost. For (b), that release is the reader widening that three verify records already recommend. Transaction details' "Yours, in your private balance" (behind DappApprovals.tsx:1358's button) is right about who owns it and early about the balance.
- **The one lock for good:** shape (a) with no script_data_hash and the datum stripped. That is griefing with nothing to gain, and it is already reachable. A hostile site gets the same "It pays a Seedelf…" callout over a canonical tag-121 register whose key it throws away. w2#2, a burn shown under these same words, was verified low on exactly these grounds.
- **Privacy:** no link is made. privacy.md:336 at HEAD promises only that the owner stays hidden, and says that which datum is a register "is the contract's to say". Both shapes keep that.
- **Way out:** decline. The window no longer gives a reason to; 1.9.1 warned, though with the wrong words.

**The disputed ledger point:** yes, the site can submit without the datum, and with the finder's body it has to. I read this in cardano-ledger's own source, kept locally at `/home/logic/.claude/projects/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/cfcbd3c7-4fba-46f9-8be7-526fb876c645/review-1.8.1-scratch/review/v-pv11-impact/src/`. The snapshot `ledger-226b002d` is cardano-ledger-conway 1.22.1.0, the version node 11.1.3's cabal requires.
- Conway's UTXOW runs babbageUtxowTransition (Conway/Rules/Utxow.hs:221). That runs checkScriptIntegrityHash against mkScriptIntegrity (Alonzo/Tx.hs:320-342), which is SNothing only when the redeemers, the language views and the witness datums are all empty. One carried datum makes it SJust. So a body with no script_data_hash is rejected as signed: PPViewHashesDontMatch, called ScriptIntegrityHashMismatch from PV11.
- With the datum stripped, the same body passes. missingRequiredDatums (Alonzo/Rules/Utxow.hs:234-250) requires only the datums of spent script inputs. An output's hash only allows its preimage as a supplemental datum (Babbage/UTxO.hs:65-75); it never requires it.
- validateVerifiedWits checks signatures over the body hash alone. The wallet returns vkey witnesses only (cip30.rs:1852-1853), so the site writes the final witness set.
- When the body does carry a script_data_hash over the datum, stripping it fails the match, and editing the body breaks the user's signature. Then the datum goes on chain.

So the trace verifier is right that the strip works. The impact verifier is right that the output's hash fixes which register locks the money, and that the strip is the only way it is lost for good.

**Decisive point:** The only outcome worse than "stranded until a release" is a site stripping the carried datum from a body that has no script_data_hash. The ledger accepts that transaction. But it is griefing with nothing to gain, and a hostile site can already get it signed under the same "It pays a Seedelf…" callout by using a canonical register whose key it throws away. w2#2 was graded low for exactly that harm under those words. On every honest path the script_data_hash keeps the datum on chain and the money stays under its owner's register, so a release brings it back. Nothing a site or user can reach fits a medium line.

**Fix notes:** This is the fix round's own regression (36fbb96f); at 1.9.1 both shapes read "none". Fix it before the round merges, whatever the grade.

1. **Widen both scan readers (no owner call needed).** chain.ts registerOf (:92-95) and seedelf-koios register_of_datum (:366-371) should take tag 102 with an indefinite pair, closed by its own break after the fields. Both verifiers ran this sketch.
   - With it, (b)'s "register" and Transaction details' "Yours, in your private balance" become true.
   - In the same release, bump the private index's sealed-verdict rule version (4cbac01e), so rows already sealed as not the user's are judged again.
   - Pin it with one vector list that register_fields, register_of_datum and registerOf all read: 121 with definite and indefinite fields, 102 with a definite and an indefinite pair, chunked points.
2. **A datum kept by hash (the owner's words).** Stop reading carried datums for the Pays label (cip30.rs:1292-1298).
   - No Seedelf tool lists or spends a row kept by hash, whether or not its datum reached the chain. Give such an output, carried or not, its own value and warning, never "register" and never "anyone can take". That also answers d1#3's request to say it can't be judged.
   - It is a new critical `.warn.` key, with es/ja drafts back-translated.
   - The label needs no script_data_hash check. If one is ever wanted to tell locked from stranded: in Conway, with no redeemers, the integrity preimage is A0, then the datums' original bytes, then A0 (conway.cddl:519-521). It needs no cost models.
3. **Keep `carried` for datum_names_key**, which reads contract inputs. The ledger requires a spent input's datum in the witness set (missingRequiredDatums), and the script_data_hash commits to it there, so it can't be stripped. Only an output's datum is optional.
4. **Words and tests.** Update:
   - cip30_test.rs:1938-1950's three hashed rows;
   - the Paid doc comment (cip30.rs:593-597) and spender's doc comment (:878-880);
   - architecture.md:201 ("A datum kept by hash is read from the witness set…");
   - privacy.md:336 ("Which a register is, is the contract's to say").
   The doc words need the owner. privacy.md changed in e66a6a16, so edit from HEAD.
5. **Regression test.** Keep `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-web-wallet/wasm/tests/r51_r2sign_1.rs` (untracked). It fails at exactly the three readings.
