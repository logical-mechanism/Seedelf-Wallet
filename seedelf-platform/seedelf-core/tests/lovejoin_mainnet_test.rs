//! Lovejoin on mainnet (`Protocol::of(false)`, live since 2026-09-26): the
//! bundled deployment checked against what the chain holds, and the wallet's
//! transactions measured offline (Aiken's uplc, `seedelf_core::eval`) against
//! mainnet's scripts, with mainnet's parameters. The pool was empty when this
//! was written, so its boxes here are fresh registers at mainnet's `mix_box`.

use blstrs::Scalar;
use pallas_addresses::Address;
use pallas_codec::minicbor;
use pallas_primitives::conway::{ScriptRef, TransactionOutput, Value as Assets};
use pallas_traverse::MultiEraTx;
use seedelf_core::build::fake_signer;
use seedelf_core::eval::{self, Resolved};
use seedelf_core::lovejoin::{self, Coin, Payer, PoolBox, Protocol};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, Ratio};
use serde_json::Value;

const MIX_BOX_ADDRESS: &str = "addr1w8q5tsg07j72aal45ndm8l9lmh9ykmrmpqv3kp5skyh3ltgw48lct";
/// `reference_holder`, the always-false script that holds all three references.
const REFERENCE_HOLDER: &str = "addr1wy5gl6nh5rm8f3sgp2ka3mfu5skdt2fqhu0spsxnucesdeqatlhxl";
/// The protocol's inline datum as Koios's `utxo_info` gives it for
/// f89c…175c#0: `{denom 10 ₳, max fee a mix 1 ₳, mix_box, mix_logic, fee}`.
const REFERENCE_DATUM: &str = concat!(
    "d8799f1a009896801a000f4240581cc145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad",
    "581c0dad3046f90d9cf8354eb8b743d50fb2c25d581269b94ffcdf59499e581ca072c7e839ab9ddf24344d0b",
    "2f70f56971f187fee8089f5f64212406ff",
);
/// The protocol NFT: its policy, and the name "lovejoin".
const PROTOCOL_NFT: ([u8; 28], &[u8]) = (
    hex_literal::hex!("f5592689c7ab35553a3234a54c0ee118090a5762c696819a53a5a826"),
    b"lovejoin",
);
/// `mix_box`'s and `mix_logic`'s reference scripts' sizes, as Koios's
/// `utxo_info` gives them for 7d21…416a#0 and 2452…c7b6#0.
const KOIOS_SCRIPT_SIZES: [usize; 2] = [629, 3_161];

/// Mainnet's parameters at epoch 658, as Koios lists them.
fn params() -> ProtocolParameters {
    let rows: Value =
        serde_json::from_str(include_str!("fixtures/epoch_params_mainnet.json")).expect("fixture");
    assert_eq!(rows[0]["epoch_no"], 658);
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

fn mainnet() -> Protocol {
    Protocol::of(false).unwrap()
}

/// An enterprise key address on mainnet.
fn key_address(seed: u8) -> Address {
    let mut raw = vec![0x61];
    raw.extend([seed; 28]);
    Address::from_bytes(&raw).unwrap()
}

fn coin(seed: u8, lovelace: u64) -> Coin {
    let mut e = minicbor::Encoder::new(Vec::new());
    e.map(2)
        .unwrap()
        .u8(0)
        .unwrap()
        .bytes(&key_address(seed).to_vec())
        .unwrap();
    e.u8(1).unwrap().u64(lovelace).unwrap();
    Coin {
        utxo: Resolved {
            tx_hash: [seed; 32],
            index: 0,
            output: e.into_writer(),
        },
        lovelace,
    }
}

fn payer(fee: u64) -> Payer {
    Payer {
        fee: coin(0x11, fee),
        collateral: coin(0x22, 5_000_000),
        address: key_address(0x33),
        signers: 1,
    }
}

fn funding(coins: &[Coin]) -> lovejoin::Funding {
    lovejoin::Funding {
        coins: coins.to_vec(),
        collateral: coin(0x22, 5_000_000),
        address: key_address(0x33),
        deposit_signers: 1,
        mix_signers: 1,
    }
}

/// A box someone else deposited: 10 ₳ at `protocol`'s `mix_box`, a fresh
/// register's `{a, b}` its inline datum.
fn foreign_box(protocol: &Protocol, i: u8) -> PoolBox {
    let r = Register::create(Scalar::from(10_000u64 + i as u64))
        .unwrap()
        .rerandomize()
        .unwrap();
    let a: [u8; 48] = hex::decode(&r.generator).unwrap().try_into().unwrap();
    let b: [u8; 48] = hex::decode(&r.public_value).unwrap().try_into().unwrap();
    let mut e = minicbor::Encoder::new(Vec::new());
    e.map(3)
        .unwrap()
        .u8(0)
        .unwrap()
        .bytes(&protocol.mix_box_address().to_vec())
        .unwrap()
        .u8(1)
        .unwrap()
        .u64(protocol.denom)
        .unwrap()
        .u8(2)
        .unwrap()
        .array(2)
        .unwrap()
        .u8(1)
        .unwrap()
        .tag(minicbor::data::Tag::new(24))
        .unwrap()
        .bytes(&lovejoin::mix_datum(&a, &b))
        .unwrap();
    let utxo = Resolved {
        tx_hash: [0x70u8.wrapping_add(i); 32],
        index: i as u64 % 3,
        output: e.into_writer(),
    };
    PoolBox::from_resolved(utxo, protocol).expect("a box the wallet accepts")
}

fn pool(protocol: &Protocol, n: u8) -> Vec<PoolBox> {
    (0..n).map(|i| foreign_box(protocol, i)).collect()
}

/// Measures a built transaction against mainnet's references and `extra`.
fn evaluate(tx: &[u8], extra: &[Resolved]) -> Value {
    let mut known: Vec<Resolved> = extra.to_vec();
    known.extend(mainnet().references.iter().cloned());
    eval::evaluate(tx, &known, &params().cost_model_v3, false).unwrap()
}

/// Flips the last byte of the first proof scalar in `tx`: a mix's sigma-OR
/// branch (`t0`, `t1`, `c`, `z`) or an owner's Schnorr proof (`t`, `z`).
fn corrupt_last_scalar(tx: &[u8], mix: bool) -> Vec<u8> {
    let mut out = tx.to_vec();
    let span = if mix { 168 } else { 84 };
    for i in 0..=tx.len().saturating_sub(span) {
        let found = if mix {
            tx[i..i + 2] == [0x58, 0x30]
                && tx[i + 50..i + 52] == [0x58, 0x30]
                && tx[i + 100..i + 102] == [0x58, 0x20]
                && tx[i + 134..i + 136] == [0x58, 0x20]
        } else {
            tx[i..i + 2] == [0x58, 0x30] && tx[i + 50..i + 52] == [0x58, 0x20]
        };
        if found {
            out[i + span - 1] ^= 0x01;
            return out;
        }
    }
    panic!("no proof found in the transaction");
}

/// The ledger's minimum fee for `tx` once `signers` keys sign it: its size,
/// its declared budgets at the prices as exact rationals (one ceiling over the
/// total), and 15 lovelace a byte for the scripts it reads, as Koios sizes
/// them. The prices are mainnet's, 577/10⁴ a memory unit and 721/10⁷ a step.
fn ledger_minimum_fee(tx: &pallas_txbuilder::BuiltTransaction, signers: usize) -> u64 {
    let params = params();
    assert_eq!((params.min_fee_a, params.min_fee_b), (44, 155_381));
    assert_eq!((params.price_mem, params.price_step), (0.0577, 0.0000721));
    assert_eq!(params.min_fee_ref_script_cost_per_byte, Ratio::whole(15));
    let mut signed = tx.clone();
    for _ in 0..signers {
        signed = signed.sign(fake_signer()).unwrap();
    }
    let size = signed.tx_bytes.0.len() as u64;
    let decoded = MultiEraTx::decode(&tx.tx_bytes.0).unwrap();
    let (mem, steps) = decoded
        .redeemers()
        .iter()
        .fold((0u128, 0u128), |(m, s), r| {
            (m + r.ex_units().mem as u128, s + r.ex_units().steps as u128)
        });
    let units = (577 * mem * 1_000 + 721 * steps).div_ceil(10_000_000) as u64;
    let scripts: usize = KOIOS_SCRIPT_SIZES.iter().sum();
    44 * size + 155_381 + units + 15 * scripts as u64
}

#[test]
fn the_mainnet_protocol_is_the_deployment() {
    let p = mainnet();
    assert!(!p.network_flag);
    assert_eq!(p.denom, 10_000_000);
    assert_eq!(p.mix_box_address().to_bech32().unwrap(), MIX_BOX_ADDRESS);
    let refs: Vec<(String, u64)> = p
        .references
        .iter()
        .map(|r| (hex::encode(r.tx_hash), r.index))
        .collect();
    assert_eq!(
        refs,
        [
            "f89cb43a55eed378fe90fe954a9d86566280e6416d97f9008937ab492b37175c",
            "7d21335ffea6d3e8144ecb55f62f045f3fecd1414c932c62d7edd2886a57416a",
            "2452c3e6886e6d946837bfea730a76dad43aefff267b5bbffd0232a2af68c7b6",
        ]
        .map(|h| (h.to_string(), 0))
    );

    let mut scripts = Vec::new();
    for r in &p.references {
        let TransactionOutput::PostAlonzo(out) = minicbor::decode(&r.output).unwrap() else {
            panic!("a post-Alonzo output")
        };
        assert_eq!(
            Address::from_bytes(&out.address)
                .unwrap()
                .to_bech32()
                .unwrap(),
            REFERENCE_HOLDER
        );
        // The deployment locked each at its least: (160 + its size) × 4,310,
        // so these are the chain's bytes to the byte.
        let lovelace = match &out.value {
            Assets::Coin(c) => *c,
            Assets::Multiasset(c, _) => *c,
        };
        assert_eq!(lovelace, (160 + r.output.len() as u64) * 4_310);
        if let Some(script) = out.script_ref {
            let ScriptRef::PlutusV3Script(script) = script.0 else {
                panic!("a Plutus V3 script")
            };
            scripts.push(script.as_ref().to_vec());
        }
    }

    // The protocol's datum and NFT, as Koios gives them.
    let reference = hex::encode(&p.references[0].output);
    assert!(reference.contains(REFERENCE_DATUM));
    let TransactionOutput::PostAlonzo(out) = minicbor::decode(&p.references[0].output).unwrap()
    else {
        panic!()
    };
    let Assets::Multiasset(_, tokens) = out.value else {
        panic!("the protocol NFT")
    };
    let tokens: Vec<([u8; 28], Vec<u8>, u64)> = tokens
        .iter()
        .flat_map(|(policy, names)| {
            names
                .iter()
                .map(|(name, q)| (**policy, name.to_vec(), u64::from(q)))
        })
        .collect();
    assert_eq!(tokens, vec![(PROTOCOL_NFT.0, PROTOCOL_NFT.1.to_vec(), 1)]);

    // The scripts are the ones the protocol names, blake2b-224(0x03 ‖ script),
    // at the sizes Koios gives, and the fees are priced on those.
    let hash = |script: &[u8]| -> [u8; 28] {
        *pallas_crypto::hash::Hasher::<224>::hash(&[&[3u8][..], script].concat())
    };
    assert_eq!(scripts.len(), 2);
    assert_eq!(hash(&scripts[0]), p.mix_box_hash);
    assert_eq!(hash(&scripts[1]), p.mix_logic_hash);
    assert_eq!([scripts[0].len(), scripts[1].len()], KOIOS_SCRIPT_SIZES);
    assert_eq!(p.script_bytes, 629 + 3_161);
}

#[test]
fn mainnet_mixes_of_two_three_and_four_pass_mix_logic_and_mix_box() {
    let protocol = mainnet();
    for n in 2..=4u8 {
        let boxes = pool(&protocol, n);
        let mix = lovejoin::mix(&params(), &protocol, &boxes, &payer(20_000_000)).unwrap();
        assert_eq!(mix.outputs.len(), n as usize);
        let mut known: Vec<Resolved> = boxes.iter().map(|b| b.utxo.clone()).collect();
        known.push(coin(0x11, 20_000_000).utxo);
        known.push(coin(0x22, 5_000_000).utxo);
        let answer = evaluate(&mix.tx.tx_bytes.0, &known);
        assert!(answer.get("result").is_some(), "{answer}");
        // The outputs are boxes a later mix may take, at mainnet's mix_box.
        for out in &mix.outputs {
            assert!(PoolBox::from_resolved(out.utxo.clone(), &protocol).is_some());
        }
        // A corrupted proof fails mainnet's mix_logic.
        let bad = corrupt_last_scalar(&mix.tx.tx_bytes.0, true);
        let answer = evaluate(&bad, &known);
        assert!(
            answer.get("error").is_some(),
            "a corrupted mix passed: {answer}"
        );
    }
}

#[test]
fn a_mainnet_mix_and_withdraw_pay_the_ledgers_minimum() {
    let protocol = mainnet();
    let boxes = pool(&protocol, 3);
    let mix = lovejoin::mix(&params(), &protocol, &boxes, &payer(20_000_000)).unwrap();
    let needed = ledger_minimum_fee(&mix.tx, 1);
    assert!(mix.fee >= needed, "fee {} under {needed}", mix.fee);
    assert!(mix.fee - needed < 1_000, "fee {} over {needed}", mix.fee);
    // About what a 3-box mix costs on mainnet (0.82 ₳), under the plan.
    assert!((780_000..lovejoin::MIX_FEE_ESTIMATE).contains(&mix.fee));

    let sk = Scalar::from(42u64);
    let base = Register::create(sk).unwrap();
    let deposit = lovejoin::deposit(
        &params(),
        &protocol,
        &[coin(0x55, 30_000_000)],
        &[base.clone().rerandomize().unwrap()],
        &key_address(0x55),
        1,
    )
    .unwrap();
    let withdraw = lovejoin::withdraw(
        &params(),
        &protocol,
        &deposit.boxes,
        &sk,
        base.rerandomize().unwrap(),
    )
    .unwrap();
    // giveme.my's is the one signature.
    let needed = ledger_minimum_fee(&withdraw.tx, 1);
    assert!(
        withdraw.fee >= needed,
        "fee {} under {needed}",
        withdraw.fee
    );
    assert!(
        withdraw.fee - needed < 6_000,
        "fee {} over {needed}",
        withdraw.fee
    );

    // Priced on preprod's script sizes, the same mix falls short.
    let stale = Protocol {
        script_bytes: 629 + 3_156,
        ..protocol.clone()
    };
    let short = lovejoin::mix(&params(), &stale, &boxes, &payer(20_000_000)).unwrap();
    assert!(short.fee < ledger_minimum_fee(&short.tx, 1));
}

#[test]
fn mainnet_deposit_mix_mix_withdraw_chain_passes() {
    let protocol = mainnet();
    let params = params();
    let sk = Scalar::from(987_654_321u64);
    let owner = Register::create(sk).unwrap();
    let owners = vec![
        owner.clone().rerandomize().unwrap(),
        owner.clone().rerandomize().unwrap(),
    ];
    let deposit = lovejoin::deposit(
        &params,
        &protocol,
        &[coin(0x44, 40_000_000)],
        &owners,
        &key_address(0x33),
        1,
    )
    .unwrap();
    assert!(deposit.boxes.iter().all(|b| b.is_owned(&sk)));
    // The boxes sit at mainnet's mix_box.
    let dtx = MultiEraTx::decode(&deposit.tx.tx_bytes.0).unwrap();
    for o in dtx.outputs().iter().take(2) {
        assert_eq!(o.address().unwrap().to_bech32().unwrap(), MIX_BOX_ADDRESS);
    }

    let mut boxes = pool(&protocol, 3)[..2].to_vec();
    boxes.push(deposit.boxes[0].clone());
    let first = Payer {
        fee: deposit.change.clone(),
        ..payer(0)
    };
    let mix = lovejoin::mix(&params, &protocol, &boxes, &first).unwrap();
    assert_eq!(mix.outputs.iter().filter(|b| b.is_owned(&sk)).count(), 1);

    let second_payer = Payer {
        fee: mix.change.clone(),
        ..first
    };
    let mut again = mix.outputs.clone();
    again.push(pool(&protocol, 3)[2].clone());
    let second = lovejoin::mix(&params, &protocol, &again, &second_payer).unwrap();
    let ours = second
        .outputs
        .iter()
        .find(|b| b.is_owned(&sk))
        .unwrap()
        .clone();

    let withdraw = lovejoin::withdraw(
        &params,
        &protocol,
        std::slice::from_ref(&ours),
        &sk,
        owner.rerandomize().unwrap(),
    )
    .unwrap();
    assert_eq!(withdraw.lovelace, protocol.denom - withdraw.fee);
    let answer = evaluate(&withdraw.tx.tx_bytes.0, std::slice::from_ref(&ours.utxo));
    assert!(answer.get("result").is_some(), "{answer}");
    // Into mainnet's Seedelf wallet contract.
    let config =
        seedelf_core::constants::get_config(seedelf_core::constants::VARIANT, false).unwrap();
    let wtx = MultiEraTx::decode(&withdraw.tx.tx_bytes.0).unwrap();
    assert_eq!(
        wtx.outputs()[0].address().unwrap().to_vec(),
        seedelf_core::address::wallet_contract(false, config.contract.wallet_contract_hash)
            .to_vec()
    );

    // A corrupted owner proof fails mainnet's mix_logic.
    let bad = corrupt_last_scalar(&withdraw.tx.tx_bytes.0, false);
    let answer = evaluate(&bad, std::slice::from_ref(&ours.utxo));
    assert!(
        answer.get("error").is_some(),
        "a corrupted withdraw passed: {answer}"
    );
}

#[test]
fn mainnet_withdraw_of_four_boxes_passes() {
    let protocol = mainnet();
    let sk = Scalar::from(42u64);
    let base = Register::create(sk).unwrap();
    let owners: Vec<Register> = (0..4)
        .map(|_| base.clone().rerandomize().unwrap())
        .collect();
    let deposit = lovejoin::deposit(
        &params(),
        &protocol,
        &[coin(0x55, 60_000_000)],
        &owners,
        &key_address(0x55),
        1,
    )
    .unwrap();
    let withdraw = lovejoin::withdraw(
        &params(),
        &protocol,
        &deposit.boxes,
        &sk,
        base.rerandomize().unwrap(),
    )
    .unwrap();
    let known: Vec<Resolved> = deposit.boxes.iter().map(|b| b.utxo.clone()).collect();
    let answer = evaluate(&withdraw.tx.tx_bytes.0, &known);
    assert!(answer.get("result").is_some(), "{answer}");
    assert_eq!(withdraw.lovelace, 4 * protocol.denom - withdraw.fee);
}

#[test]
fn mainnet_chains_fan_out_and_mix_again() {
    let protocol = mainnet();
    let params = params();
    let sk = Scalar::from(42u64);
    let base = Register::create(sk).unwrap();
    let the_pool = pool(&protocol, 40);

    // One box, two waves deep, as the tile funds it.
    let funded = lovejoin::funding_for(1, 2, protocol.denom);
    let chain = lovejoin::chain(
        &params,
        &protocol,
        &funding(&[coin(0x44, funded)]),
        &[base.clone().rerandomize().unwrap()],
        2,
        &the_pool,
    )
    .unwrap();
    assert_eq!(chain.txs.len(), 1 + lovejoin::mixes_per_box(2));
    assert!(chain.leaves[0].is_owned(&sk));
    assert!(chain.change.lovelace > 1_000_000);

    // Three waves deep: 13 mixes, each within the plan.
    let funded = lovejoin::funding_for(1, 3, protocol.denom);
    let deep = lovejoin::chain(
        &params,
        &protocol,
        &funding(&[coin(0x46, funded)]),
        &[base.clone().rerandomize().unwrap()],
        3,
        &the_pool,
    )
    .unwrap();
    assert_eq!(deep.txs.len(), 1 + lovejoin::mixes_per_box(3));
    let largest = deep
        .txs
        .iter()
        .filter(|t| t.kind == "mix")
        .map(|t| t.fee)
        .max()
        .unwrap();
    assert!(
        largest <= lovejoin::MIX_FEE_ESTIMATE,
        "a mix cost {largest}"
    );

    // Our two leaves, mixed again with no deposit.
    let ours = vec![chain.leaves[0].clone(), deep.leaves[0].clone()];
    let mut pool_now = the_pool.clone();
    pool_now.extend(ours.iter().cloned());
    let paying = Payer {
        fee: coin(0x47, lovejoin::again_funding(2, 1)),
        ..payer(0)
    };
    let again = lovejoin::again(&params, &protocol, &paying, &ours, 1, &pool_now).unwrap();
    assert_eq!(again.txs.len(), 2);
    assert!(again.leaves.iter().all(|b| b.is_owned(&sk)));
}

#[test]
fn preprods_hashes_fail_against_the_mainnet_scripts() {
    // Preprod's mix_box hash in the mix's context and its outputs' address,
    // measured against mainnet's scripts: mix_logic refuses.
    let stale = Protocol {
        mix_box_hash: hex_literal::hex!("67ffe4ed7f0ccd0a3e3069fddc26d9bccde3fe63d3d58c5e84f7ecc5"),
        mix_logic_hash: hex_literal::hex!(
            "b7079c65f3b40b6da344bf68840eb0363af17787e8375004387348b8"
        ),
        ..mainnet()
    };
    let boxes = pool(&stale, 3);
    let err = lovejoin::mix(&params(), &stale, &boxes, &payer(20_000_000)).unwrap_err();
    assert!(err.to_string().contains("couldn't evaluate"), "{err}");
}
