//! Seedelf script spends, through the mint builder: the draft Ogmios
//! evaluates, and the transaction finished with the budgets it measured. Each
//! transaction is decoded and checked: value conserved, no output below its
//! minimum, every register valid, owned and fresh, every proof bound to the
//! one-time key, and giveme.my's collateral returned minus 3/2 of an even fee.

use std::collections::BTreeMap;

use blstrs::Scalar;
use pallas_addresses::Address;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_primitives::alonzo::{Constr, MaybeIndefArray, PlutusData};
use pallas_primitives::conway::{DatumOption, RedeemerTag};
use pallas_traverse::MultiEraTx;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address::{collateral_address, wallet_contract};
use seedelf_core::build::{self, Budget, Budgets, Chain, DRAFT_BUDGET, SeedelfMint, fake_signer};
use seedelf_core::constants::{COLLATERAL_HASH, PREPROD_COLLATERAL_UTXO, get_config};
use seedelf_core::staking::Staking;
use seedelf_core::transaction::{
    computation_fee, seedelf_minimum_lovelace, wallet_minimum_lovelace_with_assets,
};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::{create_proof, prove, random_scalar};
use seedelf_koios::koios::{Asset, InlineDatum, ProtocolParameters, Ratio, UtxoResponse};
use serde_json::{Value, json};

const TOKEN_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";

/// What Ogmios measured on preprod for a mint (fixtures/ogmios/mint_two_inputs.json).
const SPEND: Budget = Budget {
    mem: 76_043,
    steps: 337_845_799,
};
const MINT: Budget = Budget {
    mem: 72_836,
    steps: 21_396_182,
};

fn chain() -> Chain {
    let rows: Value = serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    Chain {
        params: ProtocolParameters::from_koios(&rows[0]).unwrap(),
        network_flag: true,
        config: get_config(1, true).unwrap(),
    }
}

fn fixture(name: &str) -> Value {
    let path = format!(
        "{}/tests/fixtures/ogmios/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

struct World {
    chain: Chain,
    sk: Scalar,
    owner: Register,
    wallet: Address,
    key: SecretKey,
    signer: Hash<28>,
}

fn world() -> World {
    let chain = chain();
    let sk = random_scalar();
    let key = SecretKey::new(OsRng);
    World {
        wallet: wallet_contract(true, chain.config.contract.wallet_contract_hash),
        chain,
        sk,
        owner: Register::create(sk).unwrap(),
        signer: Hasher::<224>::hash(PrivateKey::from(key.clone()).public_key().as_ref()),
        key,
    }
}

/// A wallet-contract UTxO owned by `w`, as Koios returns it.
fn owned(w: &World, n: u8, index: u64, lovelace: u64, tokens: &[(&str, u64)]) -> UtxoResponse {
    let register = w.owner.clone().rerandomize().unwrap();
    UtxoResponse {
        tx_hash: hex::encode([n; 32]),
        tx_index: index,
        address: w.wallet.to_bech32().unwrap(),
        value: lovelace.to_string(),
        payment_cred: hex::encode(w.chain.config.contract.wallet_contract_hash),
        inline_datum: Some(InlineDatum {
            bytes: hex::encode(register.to_vec().unwrap()),
            value: json!({
                "constructor": 0,
                "fields": [{"bytes": register.generator}, {"bytes": register.public_value}]
            }),
        }),
        asset_list: Some(
            tokens
                .iter()
                .map(|(name, quantity)| Asset {
                    decimals: 0,
                    quantity: quantity.to_string(),
                    policy_id: TOKEN_POLICY.to_string(),
                    asset_name: hex::encode(name),
                    fingerprint: String::new(),
                })
                .collect(),
        ),
        ..Default::default()
    }
}

fn register_of(utxo: &UtxoResponse) -> Register {
    let fields = &utxo.inline_datum.as_ref().unwrap().value["fields"];
    Register::new(
        fields[0]["bytes"].as_str().unwrap().to_string(),
        fields[1]["bytes"].as_str().unwrap().to_string(),
    )
}

fn proven(w: &World, minted: SeedelfMint) -> build::ScriptSpend {
    minted
        .spend
        .proven(|register, vkh| create_proof(register.clone(), w.sk, vkh.to_string()))
        .unwrap()
}

/// An Ogmios v6 answer for `spends` inputs and a mint, in Ogmios's order.
fn measured(spends: usize) -> Value {
    let mut result: Vec<Value> = (0..spends)
        .map(|i| {
            json!({"validator": {"index": i, "purpose": "spend"},
                   "budget": {"memory": SPEND.mem, "cpu": SPEND.steps}})
        })
        .collect();
    result.push(json!({"validator": {"index": 0, "purpose": "mint"},
                       "budget": {"memory": MINT.mem, "cpu": MINT.steps}}));
    json!({"jsonrpc": "2.0", "method": "evaluateTransaction", "result": result, "id": null})
}

struct Out {
    address: Address,
    lovelace: u64,
    assets: BTreeMap<(String, String), u64>,
    register: Option<Register>,
}

struct Redeemer {
    tag: RedeemerTag,
    index: u32,
    data: PlutusData,
    budget: Budget,
}

struct Decoded {
    /// Sorted, as the ledger holds them.
    inputs: Vec<(String, u64)>,
    outputs: Vec<Out>,
    fee: u64,
    mint: BTreeMap<(String, String), i64>,
    redeemers: Vec<Redeemer>,
    signers: Vec<Hash<28>>,
    collateral: Vec<(String, u64)>,
    collateral_return: (Address, u64),
    collateral_return_assets: BTreeMap<(String, String), u64>,
    reference_inputs: Vec<(String, u64)>,
    /// The size once signed: by the one-time key and giveme.my for a script
    /// spend (see `decode_signed` for other counts).
    size_signed: u64,
}

fn decode(tx: &pallas_txbuilder::BuiltTransaction) -> Decoded {
    decode_signed(tx, 2)
}

fn assets_of_output(o: &pallas_traverse::MultiEraOutput) -> BTreeMap<(String, String), u64> {
    let mut assets = BTreeMap::new();
    for policy in o.value().assets() {
        for asset in policy.assets() {
            assets.insert(
                (hex::encode(policy.policy()), hex::encode(asset.name())),
                asset.output_coin().unwrap(),
            );
        }
    }
    assets
}

/// Decodes a built transaction; `size_signed` is its size with `signers` signatures.
fn decode_signed(tx: &pallas_txbuilder::BuiltTransaction, signers: usize) -> Decoded {
    let mut signed = tx.clone();
    for _ in 0..signers {
        signed = signed.sign(fake_signer()).unwrap();
    }
    let size_signed = signed.tx_bytes.0.len() as u64;
    let bytes = tx.tx_bytes.0.clone();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    let outpoint = |i: &pallas_traverse::MultiEraInput| (hex::encode(i.hash()), i.index());
    let outputs = tx
        .outputs()
        .iter()
        .map(|o| Out {
            address: o.address().unwrap(),
            lovelace: o.value().coin(),
            assets: assets_of_output(o),
            register: o.datum().and_then(|d| register_from(d.into())),
        })
        .collect();
    let mut mint = BTreeMap::new();
    for policy in tx.mints() {
        for asset in policy.assets() {
            mint.insert(
                (hex::encode(policy.policy()), hex::encode(asset.name())),
                asset.mint_coin().unwrap(),
            );
        }
    }
    let redeemers = tx
        .redeemers()
        .iter()
        .map(|r| Redeemer {
            tag: r.tag(),
            index: r.index(),
            data: r.data().clone(),
            budget: Budget {
                mem: r.ex_units().mem,
                steps: r.ex_units().steps,
            },
        })
        .collect();
    let collateral_return = tx.collateral_return().unwrap();
    Decoded {
        inputs: tx.inputs_sorted_set().iter().map(outpoint).collect(),
        outputs,
        fee: tx.fee().unwrap(),
        mint,
        redeemers,
        signers: tx
            .required_signers()
            .collect::<Vec<&Hash<28>>>()
            .into_iter()
            .copied()
            .collect(),
        collateral: tx.collateral().iter().map(outpoint).collect(),
        collateral_return: (
            collateral_return.address().unwrap(),
            collateral_return.value().coin(),
        ),
        collateral_return_assets: assets_of_output(&collateral_return),
        reference_inputs: tx.reference_inputs().iter().map(outpoint).collect(),
        size_signed,
    }
}

/// The Conway ledger's minimum fee, written out independently of the
/// builder: `min_fee_a × size + min_fee_b`, plus the execution units at the
/// protocol's prices as exact rationals (ceiling of the total), plus 15
/// lovelace per reference-script byte. The prices are the fixture's, 577/10⁴
/// per memory unit and 721/10⁷ per step.
fn ledger_minimum_fee(
    params: &ProtocolParameters,
    size: u64,
    mem: u64,
    steps: u64,
    script_bytes: u64,
) -> u64 {
    assert_eq!((params.min_fee_a, params.min_fee_b), (44, 155_381));
    assert_eq!((params.price_mem, params.price_step), (0.0577, 0.0000721));
    // Flat below the first 25,600-byte tier.
    assert_eq!(params.min_fee_ref_script_cost_per_byte, Ratio::whole(15));
    let units = (577 * mem as u128 * 1_000 + 721 * steps as u128).div_ceil(10_000_000) as u64;
    44 * size + 155_381 + units + 15 * script_bytes
}

/// The recorded Koios row's reference script: the Seedelf policy, 519 bytes.
fn recorded_script() -> Option<seedelf_koios::koios::ReferenceScript> {
    let rows: Vec<UtxoResponse> =
        serde_json::from_str(include_str!("fixtures/reference_script_utxo.json")).unwrap();
    rows[0].reference_script.clone()
}

/// The reference-script bytes on `utxos`, measured here from Koios's hex.
fn script_bytes_of(utxos: &[UtxoResponse]) -> u64 {
    utxos
        .iter()
        .filter_map(|u| u.reference_script.as_ref())
        .map(|s| s.bytes.as_ref().unwrap().len() as u64 / 2)
        .sum()
}

fn register_from(datum: DatumOption) -> Option<Register> {
    let DatumOption::Data(data) = datum else {
        return None;
    };
    let PlutusData::Constr(Constr { fields, .. }) = &data.0 else {
        return None;
    };
    let fields = match fields {
        MaybeIndefArray::Def(v) | MaybeIndefArray::Indef(v) => v,
    };
    let bytes = |d: &PlutusData| match d {
        PlutusData::BoundedBytes(b) => Some(hex::encode(b.as_slice())),
        _ => None,
    };
    Some(Register::new(
        bytes(fields.first()?)?,
        bytes(fields.get(1)?)?,
    ))
}

fn bytes_field(data: &PlutusData, i: usize) -> String {
    let PlutusData::Constr(Constr { fields, .. }) = data else {
        panic!("a spend redeemer is a constructor");
    };
    let fields = match fields {
        MaybeIndefArray::Def(v) | MaybeIndefArray::Indef(v) => v,
    };
    match &fields[i] {
        PlutusData::BoundedBytes(b) => hex::encode(b.as_slice()),
        _ => panic!("field {i} is bytes"),
    }
}

/// Checks everything a finished mint must satisfy. Returns the decoded tx.
fn assert_sound(w: &World, spent: &[UtxoResponse], built: &build::FinalSpend) -> Decoded {
    let tx = decode(&built.tx);
    let chain = &w.chain;
    let policy = chain.config.contract.seedelf_policy_id.clone();

    // Exactly the given UTxOs are spent, plus giveme.my's collateral.
    let mut expected: Vec<(String, u64)> = spent
        .iter()
        .map(|u| (u.tx_hash.clone(), u.tx_index))
        .collect();
    expected.sort();
    assert_eq!(tx.inputs, expected);
    assert_eq!(
        tx.collateral,
        vec![(hex::encode(PREPROD_COLLATERAL_UTXO), 0)]
    );

    // Value: inputs = outputs + fee; tokens in + minted = tokens out.
    let lovelace_in: u64 = spent.iter().map(|u| u.value.parse::<u64>().unwrap()).sum();
    let lovelace_out: u64 = tx.outputs.iter().map(|o| o.lovelace).sum();
    assert_eq!(lovelace_in, lovelace_out + tx.fee, "lovelace conserved");
    let mut tokens: BTreeMap<(String, String), i64> = BTreeMap::new();
    for u in spent {
        for a in u.asset_list.iter().flatten() {
            *tokens
                .entry((a.policy_id.clone(), a.asset_name.clone()))
                .or_default() += a.quantity.parse::<i64>().unwrap();
        }
    }
    for (k, v) in &tx.mint {
        *tokens.entry(k.clone()).or_default() += v;
    }
    let mut out: BTreeMap<(String, String), i64> = BTreeMap::new();
    for o in &tx.outputs {
        for (k, v) in &o.assets {
            *out.entry(k.clone()).or_default() += *v as i64;
        }
    }
    tokens.retain(|_, v| *v != 0);
    assert_eq!(tokens, out, "tokens conserved");

    // Exactly one seedelf minted, with the policy's own name for it.
    assert_eq!(tx.mint.len(), 1);
    let ((minted_policy, name), amount) = tx.mint.iter().next().unwrap();
    assert_eq!((minted_policy, *amount), (&policy, 1));

    // Every output sits in the contract, above its minimum, under a valid
    // register; each register a different re-randomization.
    let mut generators = std::collections::BTreeSet::new();
    for (i, o) in tx.outputs.iter().enumerate() {
        assert_eq!(o.address, w.wallet, "output {i} is in the wallet contract");
        let register = o.register.as_ref().expect("a register datum");
        assert!(register.is_valid().unwrap(), "output {i} register valid");
        assert!(
            generators.insert(register.generator.clone()),
            "fresh register"
        );
        let is_seedelf = o.assets.contains_key(&(policy.clone(), name.clone()));
        let minimum = if is_seedelf {
            seedelf_minimum_lovelace(&chain.params).unwrap()
        } else {
            assert!(register.is_owned(w.sk).unwrap(), "change is owned");
            let mut assets = seedelf_core::assets::Assets::new();
            for ((p, n), q) in &o.assets {
                assets = assets
                    .add(seedelf_core::assets::Asset::new(p.clone(), n.clone(), *q).unwrap())
                    .unwrap();
            }
            wallet_minimum_lovelace_with_assets(&chain.params, assets).unwrap()
        };
        assert!(o.lovelace >= minimum, "output {i} above its minimum");
    }

    // One-time key and giveme.my must sign; the scripts come by reference.
    assert_eq!(tx.signers, vec![w.signer, Hash::new(COLLATERAL_HASH)]);
    let mut refs = tx.reference_inputs.clone();
    refs.sort();
    let mut want = vec![
        (hex::encode(chain.config.reference.wallet_reference_utxo), 1),
        (
            hex::encode(chain.config.reference.seedelf_reference_utxo),
            1,
        ),
    ];
    want.sort();
    assert_eq!(refs, want);

    // Every spend redeemer proves the register of the input it points at
    // (inputs in ledger order), bound to the one-time key.
    let vkh = hex::encode(w.signer);
    let spends: Vec<&Redeemer> = tx
        .redeemers
        .iter()
        .filter(|r| r.tag == RedeemerTag::Spend)
        .collect();
    assert_eq!(spends.len(), spent.len());
    for r in spends {
        let (hash, index) = &tx.inputs[r.index as usize];
        let utxo = spent
            .iter()
            .find(|u| &u.tx_hash == hash && u.tx_index == *index)
            .unwrap();
        let register = register_of(utxo);
        assert_eq!(bytes_field(&r.data, 2), vkh, "bound to the one-time key");
        assert!(
            prove(
                &register.generator,
                &register.public_value,
                &bytes_field(&r.data, 0),
                &bytes_field(&r.data, 1),
                &vkh,
            )
            .unwrap(),
            "the proof for {hash}#{index} verifies"
        );
    }

    // The fee: even, and at least the ledger's minimum, with little to spare.
    let compute: u64 = tx
        .redeemers
        .iter()
        .map(|r| computation_fee(&chain.params, r.budget.mem, r.budget.steps))
        .sum();
    let scripts = (chain.config.contract.wallet_contract_size
        + chain.config.contract.seedelf_contract_size)
        * 15;
    let (mem, steps) = tx
        .redeemers
        .iter()
        .fold((0, 0), |(m, s), r| (m + r.budget.mem, s + r.budget.steps));
    let needed = ledger_minimum_fee(&chain.params, tx.size_signed, mem, steps, scripts / 15);
    assert_eq!(tx.fee % 2, 0, "the fee is even");
    assert!(tx.fee >= needed, "fee {} covers {needed}", tx.fee);
    assert!(
        tx.fee - needed < 1_000,
        "fee {} is close to {needed}",
        tx.fee
    );
    assert_eq!(built.fee.total, tx.fee);
    assert_eq!(built.fee.compute, compute);
    assert_eq!(built.fee.script_reference, scripts);

    // giveme.my gets back its 5 ADA less 3/2 of the fee.
    assert_eq!(
        tx.collateral_return,
        (collateral_address(true), 5_000_000 - tx.fee * 3 / 2)
    );
    tx
}

#[test]
fn mints_a_seedelf_named_after_the_smallest_input() {
    let w = world();
    let spent = [
        owned(&w, 0x20, 0, 25_000_000, &[]),
        owned(&w, 0x10, 3, 3_000_000, &[]),
    ];
    let seedelf = w.owner.clone().rerandomize().unwrap();
    let minted =
        build::mint_from(&w.chain, &spent, "web wallet", &seedelf, &w.owner, w.signer).unwrap();

    // 5eed0e1f ‖ label ‖ the smallest input's index ‖ its tx id, cut to 32 bytes.
    let expected =
        format!("5eed0e1f{}03{}", hex::encode("web wallet"), "10".repeat(32))[..64].to_string();
    assert_eq!(hex::encode(&minted.token_name), expected);
    assert_eq!(
        minted.lovelace,
        seedelf_minimum_lovelace(&w.chain.params).unwrap()
    );
    let minted_name = minted.token_name.clone();

    let built = proven(&w, minted)
        .finalize(&Budgets::from_ogmios(&measured(2)).unwrap())
        .unwrap();
    let tx = assert_sound(&w, &spent, &built);

    // The seedelf sits under exactly the register it was given, wherever the
    // shuffle put it.
    let policy = w.chain.config.contract.seedelf_policy_id.clone();
    let seedelf_out = tx
        .outputs
        .iter()
        .find(|o| {
            o.assets
                .contains_key(&(policy.clone(), hex::encode(&minted_name)))
        })
        .expect("the seedelf's output");
    assert_eq!(seedelf_out.register.as_ref(), Some(&seedelf));
    assert_eq!(
        seedelf_out.lovelace,
        seedelf_minimum_lovelace(&w.chain.params).unwrap()
    );
    // The mint redeemer is the label's bytes.
    let mint = tx
        .redeemers
        .iter()
        .find(|r| r.tag == RedeemerTag::Mint)
        .unwrap();
    assert_eq!(
        mint.data,
        PlutusData::BoundedBytes(b"web wallet".to_vec().into())
    );
    // The rest goes back as one change output.
    assert_eq!(built.change_outputs, 1);
    assert_eq!(
        built.change_lovelace,
        28_000_000 - seedelf_out.lovelace - built.fee.total
    );
}

#[test]
fn a_long_label_is_cut_to_fifteen_bytes() {
    let w = world();
    let spent = [owned(&w, 0x20, 0, 25_000_000, &[])];
    let minted = build::mint_from(
        &w.chain,
        &spent,
        "a label that is far too long",
        &w.owner.clone().rerandomize().unwrap(),
        &w.owner,
        w.signer,
    )
    .unwrap();
    assert_eq!(&minted.token_name[4..19], b"a label that is");
    let built = proven(&w, minted)
        .finalize(&Budgets::from_ogmios(&measured(1)).unwrap())
        .unwrap();
    let tx = assert_sound(&w, &spent, &built);
    let mint = tx
        .redeemers
        .iter()
        .find(|r| r.tag == RedeemerTag::Mint)
        .unwrap();
    assert_eq!(
        mint.data,
        PlutusData::BoundedBytes(b"a label that is".to_vec().into())
    );
}

#[test]
fn budgets_follow_purpose_and_index_not_answer_order() {
    let w = world();
    let spent = [
        owned(&w, 0x30, 0, 4_000_000, &[]),
        owned(&w, 0x10, 0, 4_000_000, &[]),
        owned(&w, 0x20, 0, 4_000_000, &[]),
    ];
    let minted = build::mint_from(
        &w.chain,
        &spent,
        "",
        &w.owner.clone().rerandomize().unwrap(),
        &w.owner,
        w.signer,
    )
    .unwrap();
    // A distinct budget for each redeemer, answered out of order.
    let answer = json!({"result": [
        {"validator": {"index": 0, "purpose": "mint"}, "budget": {"memory": 70_000, "cpu": 20_000_000}},
        {"validator": {"index": 2, "purpose": "spend"}, "budget": {"memory": 76_002, "cpu": 337_000_002}},
        {"validator": {"index": 0, "purpose": "spend"}, "budget": {"memory": 76_000, "cpu": 337_000_000}},
        {"validator": {"index": 1, "purpose": "spend"}, "budget": {"memory": 76_001, "cpu": 337_000_001}},
    ]});
    let built = proven(&w, minted)
        .finalize(&Budgets::from_ogmios(&answer).unwrap())
        .unwrap();
    let tx = assert_sound(&w, &spent, &built);
    for r in &tx.redeemers {
        let want = match r.tag {
            RedeemerTag::Mint => Budget {
                mem: 70_000,
                steps: 20_000_000,
            },
            _ => Budget {
                mem: 76_000 + r.index as u64,
                steps: 337_000_000 + r.index as u64,
            },
        };
        assert_eq!(r.budget, want, "{:?} {}", r.tag, r.index);
    }
}

#[test]
fn the_draft_carries_placeholder_budgets_and_real_proofs() {
    let w = world();
    let spent = [
        owned(&w, 0x20, 0, 25_000_000, &[]),
        owned(&w, 0x10, 1, 3_000_000, &[]),
    ];
    let minted = build::mint_from(
        &w.chain,
        &spent,
        "draft",
        &w.owner.clone().rerandomize().unwrap(),
        &w.owner,
        w.signer,
    )
    .unwrap();
    let spend = proven(&w, minted);
    let tx = decode(&spend.draft().unwrap());
    assert_eq!(tx.redeemers.len(), 3);
    assert!(tx.redeemers.iter().all(|r| r.budget == DRAFT_BUDGET));
    let vkh = hex::encode(w.signer);
    for r in tx.redeemers.iter().filter(|r| r.tag == RedeemerTag::Spend) {
        let (hash, index) = &tx.inputs[r.index as usize];
        let utxo = spent
            .iter()
            .find(|u| &u.tx_hash == hash && u.tx_index == *index)
            .unwrap();
        let register = register_of(utxo);
        assert!(
            prove(
                &register.generator,
                &register.public_value,
                &bytes_field(&r.data, 0),
                &bytes_field(&r.data, 1),
                &vkh
            )
            .unwrap()
        );
    }
    // Unproven, there's nothing to draft or finalize.
    let unproven = build::mint_from(
        &w.chain,
        &spent,
        "",
        &w.owner.clone().rerandomize().unwrap(),
        &w.owner,
        w.signer,
    )
    .unwrap()
    .spend;
    assert!(unproven.draft().is_err());
    assert!(
        unproven
            .finalize(&Budgets::from_ogmios(&measured(2)).unwrap())
            .is_err()
    );
}

#[test]
fn signed_by_the_one_time_key_and_giveme_my() {
    let w = world();
    let spent = [owned(&w, 0x20, 0, 25_000_000, &[])];
    let minted = build::mint_from(
        &w.chain,
        &spent,
        "",
        &w.owner.clone().rerandomize().unwrap(),
        &w.owner,
        w.signer,
    )
    .unwrap();
    let built = proven(&w, minted)
        .finalize(&Budgets::from_ogmios(&measured(1)).unwrap())
        .unwrap();
    // The real witnesses add exactly what the fee allowed for.
    let signed = built
        .tx
        .clone()
        .sign(PrivateKey::from(w.key.clone()))
        .unwrap()
        .sign(fake_signer())
        .unwrap();
    assert_eq!(
        signed.tx_bytes.0.len() as u64,
        decode(&built.tx).size_signed
    );

    // giveme.my's answer: a witness set whose last 64 bytes are the signature.
    let fake = [7u8; 64];
    let answer =
        json!({"witness": format!("a10081825820{}5840{}", "11".repeat(32), hex::encode(fake))});
    assert_eq!(build::collateral_signature(&answer).unwrap(), fake);
    assert!(!build::is_collateral_signature(&built.tx.tx_hash.0, &fake));
    assert!(build::collateral_signature(&json!({"witness": "abcd"})).is_err());
    assert!(build::collateral_signature(&json!({"error": "down"})).is_err());
}

#[test]
fn picks_pure_ada_first_and_as_few_inputs_as_it_can() {
    let w = world();
    let seedelf = w.owner.clone().rerandomize().unwrap();
    let pick = |available: &[UtxoResponse]| {
        let minted = build::mint(&w.chain, available, "", &seedelf, &w.owner, w.signer).unwrap();
        let mut picked: Vec<String> = minted
            .spend
            .inputs()
            .iter()
            .map(|u| u.value.clone())
            .collect();
        picked.sort();
        (picked, minted)
    };

    // One pure-ADA UTxO pays: the largest.
    let available = [
        owned(&w, 0x01, 0, 1_800_000, &[]),
        owned(&w, 0x02, 0, 10_000_000, &[("tok", 5)]),
        owned(&w, 0x03, 0, 4_000_000, &[]),
        owned(&w, 0x04, 0, 2_000_000, &[]),
    ];
    assert_eq!(pick(&available).0, vec!["4000000"]);

    // Pure ADA before a token UTxO, even when it takes two.
    let available = [
        owned(&w, 0x01, 0, 1_800_000, &[]),
        owned(&w, 0x02, 0, 10_000_000, &[("tok", 5)]),
        owned(&w, 0x04, 0, 2_000_000, &[]),
    ];
    let (picked, minted) = pick(&available);
    assert_eq!(picked, vec!["1800000", "2000000"]);
    let spent = minted.spend.inputs();
    let built = proven(&w, minted)
        .finalize(&Budgets::from_ogmios(&measured(2)).unwrap())
        .unwrap();
    assert_sound(&w, &spent, &built);

    // Tokens that come along go back as change, 20 to an output.
    let names: Vec<String> = (0..25).map(|i| format!("token{i:02}")).collect();
    let tokens: Vec<(&str, u64)> = names.iter().map(|n| (n.as_str(), 1)).collect();
    let available = [owned(&w, 0x02, 0, 12_000_000, &tokens)];
    let (_, minted) = pick(&available);
    let spent = minted.spend.inputs();
    let built = proven(&w, minted)
        .finalize(&Budgets::from_ogmios(&measured(1)).unwrap())
        .unwrap();
    let tx = assert_sound(&w, &spent, &built);
    assert_eq!(built.change_outputs, 2);
    assert_eq!(built.change_tokens.items.len(), 25);
    assert_eq!(tx.outputs.len(), 3);
}

#[test]
fn drafts_whatever_it_can_finish() {
    // Enough for the seedelf, the real fee and the change, with little to
    // spare: the draft must not assume a larger fee than the estimate.
    let w = world();
    let seedelf = w.owner.clone().rerandomize().unwrap();
    let minimum = seedelf_minimum_lovelace(&w.chain.params).unwrap()
        + wallet_minimum_lovelace_with_assets(&w.chain.params, Default::default()).unwrap();
    let available = [owned(&w, 0x05, 0, minimum + 300_000, &[])];
    let minted = build::mint(&w.chain, &available, "", &seedelf, &w.owner, w.signer).unwrap();
    let spend = proven(&w, minted);
    let draft = decode(&spend.draft().unwrap());
    assert!(
        draft.fee < 300_000,
        "the draft stages the estimated fee, {}",
        draft.fee
    );
    let built = spend
        .finalize(&Budgets::from_ogmios(&measured(1)).unwrap())
        .unwrap();
    assert_sound(&w, &available, &built);
}

#[test]
fn explains_what_is_wrong() {
    let w = world();
    let seedelf = w.owner.clone().rerandomize().unwrap();
    let err = |r: anyhow::Result<SeedelfMint>| r.err().expect("an error").to_string();

    // Too little: the seedelf's minimum, the fee and valid change don't fit.
    let available = [
        owned(&w, 0x01, 0, 2_000_000, &[]),
        owned(&w, 0x02, 0, 1_000_000, &[]),
    ];
    assert!(
        err(build::mint(
            &w.chain, &available, "", &seedelf, &w.owner, w.signer
        ))
        .contains("Not enough ADA in the Seedelf balance")
    );
    assert!(
        err(build::mint(&w.chain, &[], "", &seedelf, &w.owner, w.signer)).contains("Not enough")
    );

    // A register that isn't made of valid points would lock the seedelf.
    let bad = Register::new("00".repeat(48), "00".repeat(48));
    let spent = [owned(&w, 0x20, 0, 25_000_000, &[])];
    assert!(
        err(build::mint_from(
            &w.chain, &spent, "", &bad, &w.owner, w.signer
        ))
        .contains("register")
    );

    // A UTxO without a register can't be spent with a proof.
    let mut no_datum = owned(&w, 0x21, 0, 25_000_000, &[]);
    no_datum.inline_datum = None;
    assert!(
        err(build::mint_from(
            &w.chain,
            &[no_datum],
            "",
            &seedelf,
            &w.owner,
            w.signer
        ))
        .contains("holds no register")
    );

    // A budget Ogmios didn't report can't be guessed at.
    let minted = build::mint_from(&w.chain, &spent, "", &seedelf, &w.owner, w.signer).unwrap();
    let spend = proven(&w, minted);
    let no_mint = json!({"result": [{"validator": {"index": 0, "purpose": "spend"}, "budget": {"memory": 1, "cpu": 1}}]});
    let e = spend
        .finalize(&Budgets::from_ogmios(&no_mint).unwrap())
        .err()
        .unwrap();
    assert!(e.to_string().contains("Seedelf policy"), "{e}");
    let too_much = json!({"result": [
        {"validator": {"index": 0, "purpose": "spend"}, "budget": {"memory": 17_000_000, "cpu": 1}},
        {"validator": {"index": 0, "purpose": "mint"}, "budget": {"memory": 1, "cpu": 1}},
    ]});
    let e = spend
        .finalize(&Budgets::from_ogmios(&too_much).unwrap())
        .err()
        .unwrap();
    assert!(e.to_string().contains("more computation"), "{e}");
}

#[test]
fn reads_real_ogmios_answers() {
    // A two-input mint drafted by `mint_from`, evaluated on preprod.
    let budgets = Budgets::from_ogmios(&fixture("mint_two_inputs.json")).unwrap();
    assert_eq!(budgets.spend(0), Some(SPEND));
    assert_eq!(budgets.spend(1), Some(SPEND));
    assert_eq!(budgets.spend(2), None);
    assert_eq!(budgets.mint(0), Some(MINT));

    // The same draft with proofs by the wrong key.
    let e = Budgets::from_ogmios(&fixture("script_failure.json")).unwrap_err();
    assert_eq!(
        e.to_string(),
        "The Seedelf contract refused this transaction (spending input 0: Caused by: (error))"
    );

    // Inputs Ogmios can't find: the wallet's view of the chain is stale.
    let e = Budgets::from_ogmios(&fixture("unknown_inputs.json")).unwrap_err();
    assert!(e.to_string().contains("aren't on chain anymore"), "{e}");

    // Anything else says what Ogmios said.
    let e =
        Budgets::from_ogmios(&json!({"error": {"code": -32602, "message": "Invalid transaction"}}))
            .unwrap_err();
    assert_eq!(
        e.to_string(),
        "Ogmios couldn't evaluate the transaction: Invalid transaction"
    );
    assert!(Budgets::from_ogmios(&json!({"result": [{"validator": {}}]})).is_err());
    assert!(Budgets::from_ogmios(&json!({"jsonrpc": "2.0"})).is_err());
}

#[test]
fn prices_bytes_as_the_ledger_does() {
    // Pallas's `fees::PolicyParams::default()` is Byron's 43.946 lovelace a
    // byte; on a real preprod mint that came to 255,788 against the 255,801
    // the ledger wanted (FeeTooSmallUTxO).
    let params = chain().params;
    assert_eq!(build::linear_fee(&params, 1_114), 44 * 1_114 + 155_381);
    let rows: Value = serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    assert_eq!(rows[0]["min_fee_a"], 44);
    assert_eq!(rows[0]["min_fee_b"], 155_381);
}

#[test]
fn the_reference_scripts_are_priced_from_the_parameters() {
    let mint_at = |numerator: u64| {
        let mut w = world();
        w.chain.params.min_fee_ref_script_cost_per_byte = Ratio::whole(numerator);
        let spent = [owned(&w, 0x20, 0, 25_000_000, &[])];
        let seedelf = w.owner.clone().rerandomize().unwrap();
        let minted =
            build::mint_from(&w.chain, &spent, "priced", &seedelf, &w.owner, w.signer).unwrap();
        proven(&w, minted)
            .finalize(&Budgets::from_ogmios(&measured(1)).unwrap())
            .unwrap()
    };
    // The wallet script's 629 bytes and the policy's 519, both by reference.
    let today = mint_at(15);
    assert_eq!(today.fee.script_reference, (629 + 519) * 15);
    // A governance change moves the fee with it, not a constant.
    let dearer = mint_at(20);
    assert_eq!(dearer.fee.script_reference, (629 + 519) * 20);
    assert_eq!(dearer.fee.total - today.fee.total, (629 + 519) * 5);
}

#[test]
fn collateral_return_and_even_rounding() {
    assert_eq!(build::even(300_001), 300_002);
    assert_eq!(build::even(300_002), 300_002);
    let out = build::collateral_output(collateral_address(true), 400_000).unwrap();
    assert_eq!(out.lovelace, 5_000_000 - 600_000);
    assert!(build::collateral_output(collateral_address(true), 3_400_000).is_err());
}

// ---------------------------------------------------------------------------
// A seedelf mint paid by the Cardano account (mint first, then move in)
// ---------------------------------------------------------------------------

mod account {
    use super::*;
    use seedelf_core::transaction::address_minimum_lovelace_with_assets;
    use seedelf_crypto::cardano::{CardanoAccount, Role};

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    struct Payer {
        chain: Chain,
        account: CardanoAccount,
        wallet: Address,
        change: Address,
        seedelf: Register,
    }

    fn payer() -> Payer {
        let chain = chain();
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        Payer {
            wallet: wallet_contract(true, chain.config.contract.wallet_contract_hash),
            change: account.base_address(true, Role::Receive, 0).unwrap(),
            seedelf: Register::create(random_scalar())
                .unwrap()
                .rerandomize()
                .unwrap(),
            chain,
            account,
        }
    }

    /// A UTxO at the account's receive address `index`.
    fn at(p: &Payer, n: u8, index: u32, lovelace: u64, tokens: &[(&str, u64)]) -> UtxoResponse {
        UtxoResponse {
            tx_hash: hex::encode([n; 32]),
            tx_index: 0,
            address: p
                .account
                .base_address(true, Role::Receive, index)
                .unwrap()
                .to_bech32()
                .unwrap(),
            value: lovelace.to_string(),
            payment_cred: hex::encode(p.account.key_hash(Role::Receive, index).unwrap()),
            asset_list: Some(
                tokens
                    .iter()
                    .map(|(name, quantity)| Asset {
                        decimals: 0,
                        quantity: quantity.to_string(),
                        policy_id: TOKEN_POLICY.to_string(),
                        asset_name: hex::encode(name),
                        fingerprint: String::new(),
                    })
                    .collect(),
            ),
            ..Default::default()
        }
    }

    fn recorded() -> Budgets {
        Budgets::from_ogmios(&fixture("account_mint.json")).unwrap()
    }

    fn outpoints(utxos: &[UtxoResponse]) -> Vec<(String, u64)> {
        let mut o: Vec<(String, u64)> = utxos
            .iter()
            .map(|u| (u.tx_hash.clone(), u.tx_index))
            .collect();
        o.sort();
        o
    }

    fn tokens_of(utxos: &[&UtxoResponse]) -> BTreeMap<(String, String), i64> {
        let mut tokens = BTreeMap::new();
        for u in utxos {
            for a in u.asset_list.iter().flatten() {
                *tokens
                    .entry((a.policy_id.clone(), a.asset_name.clone()))
                    .or_default() += a.quantity.parse::<i64>().unwrap();
            }
        }
        tokens
    }

    /// Everything a finished account-paid mint must satisfy.
    fn assert_sound(
        p: &Payer,
        mint: &build::AccountMint,
        built: &build::FinalAccountMint,
    ) -> Decoded {
        let signers: std::collections::BTreeSet<&str> = mint
            .inputs()
            .iter()
            .chain(std::iter::once(mint.collateral()))
            .map(|u| u.payment_cred.as_str())
            .collect();
        let tx = decode_signed(&built.tx, signers.len());
        let params = &p.chain.params;
        let policy = p.chain.config.contract.seedelf_policy_id.clone();

        // Only the account's UTxOs are spent; one of them is the collateral.
        assert_eq!(tx.inputs, outpoints(mint.inputs()));
        assert_eq!(
            tx.collateral,
            outpoints(std::slice::from_ref(mint.collateral()))
        );

        // The seedelf, under the register given, then the change to 0/0.
        let seedelf = &tx.outputs[0];
        assert_eq!(seedelf.address, p.wallet);
        assert_eq!(seedelf.register.as_ref(), Some(&p.seedelf));
        assert_eq!(seedelf.lovelace, seedelf_minimum_lovelace(params).unwrap());
        assert_eq!(
            seedelf.assets.keys().collect::<Vec<_>>(),
            vec![&(policy.clone(), hex::encode(&mint.token_name))]
        );
        for (i, o) in tx.outputs.iter().enumerate().skip(1) {
            assert_eq!(o.address, p.change, "output {i} is change to 0/0");
            assert!(o.register.is_none());
            let mut assets = seedelf_core::assets::Assets::new();
            for ((pid, n), q) in &o.assets {
                assets = assets
                    .add(seedelf_core::assets::Asset::new(pid.clone(), n.clone(), *q).unwrap())
                    .unwrap();
            }
            let minimum = address_minimum_lovelace_with_assets(
                params,
                &p.change.to_bech32().unwrap(),
                assets,
            )
            .unwrap();
            assert!(o.lovelace >= minimum, "change {i} above its minimum");
        }
        assert_eq!(built.change_outputs, tx.outputs.len() - 1);

        // Value: inputs = outputs + fee; tokens in + the minted one = tokens out.
        let spent: Vec<&UtxoResponse> = mint.inputs().iter().collect();
        let lovelace_in: u64 = spent.iter().map(|u| u.value.parse::<u64>().unwrap()).sum();
        let lovelace_out: u64 = tx.outputs.iter().map(|o| o.lovelace).sum();
        assert_eq!(lovelace_in, lovelace_out + tx.fee, "lovelace conserved");
        let mut tokens_in = tokens_of(&spent);
        *tokens_in
            .entry((policy.clone(), hex::encode(&mint.token_name)))
            .or_default() += 1;
        let mut tokens_out: BTreeMap<(String, String), i64> = BTreeMap::new();
        for o in &tx.outputs {
            for (k, q) in &o.assets {
                *tokens_out.entry(k.clone()).or_default() += *q as i64;
            }
        }
        assert_eq!(tokens_in, tokens_out, "tokens conserved");

        // One seedelf, named after the smallest spent input; the label is the redeemer.
        assert_eq!(tx.mint.values().copied().collect::<Vec<_>>(), vec![1]);
        let (hash, index) = &tx.inputs[0];
        let expected = format!("5eed0e1f{}{index:02x}{hash}", hex::encode("account-mint"));
        assert_eq!(hex::encode(&mint.token_name), expected[..64]);
        assert_eq!(tx.redeemers.len(), 1);
        assert_eq!(tx.redeemers[0].tag, RedeemerTag::Mint);
        assert_eq!(
            tx.redeemers[0].data,
            PlutusData::BoundedBytes(b"account-mint".to_vec().into())
        );
        assert_eq!(tx.redeemers[0].budget, recorded().mint(0).unwrap());

        // Nothing but the seedelf script is referenced, and nobody else must sign.
        assert_eq!(
            tx.reference_inputs,
            vec![(
                hex::encode(p.chain.config.reference.seedelf_reference_utxo),
                1
            )]
        );
        assert!(tx.signers.is_empty());

        // The collateral comes back, less 3/2 of the fee, with its tokens.
        let collateral = mint.collateral();
        assert_eq!(
            tx.collateral_return,
            (
                Address::from_bech32(&collateral.address).unwrap(),
                collateral.value.parse::<u64>().unwrap() - tx.fee * 3 / 2
            )
        );
        let returned: BTreeMap<(String, String), i64> = tx
            .collateral_return_assets
            .iter()
            .map(|(k, q)| (k.clone(), *q as i64))
            .collect();
        assert_eq!(returned, tokens_of(&[collateral]));

        // The fee: even, at least the ledger's minimum for this many
        // signatures, with the policy's 519 bytes and any reference script on
        // an input (never the collateral's).
        let b = tx.redeemers[0].budget;
        let script_bytes = 519 + script_bytes_of(mint.inputs());
        let needed = ledger_minimum_fee(params, tx.size_signed, b.mem, b.steps, script_bytes);
        assert_eq!(tx.fee % 2, 0);
        assert!(tx.fee >= needed, "fee {} covers {needed}", tx.fee);
        assert!(tx.fee - needed < 1_000);
        assert_eq!(built.fee.total, tx.fee);
        tx
    }

    #[test]
    fn the_account_pays_and_a_5_ada_utxo_it_doesnt_spend_is_the_collateral() {
        let p = payer();
        let available = [
            at(&p, 0x30, 0, 10_000_000, &[]),
            at(&p, 0x31, 1, 5_000_000, &[]),
            at(&p, 0x32, 2, 3_000_000, &[("tok", 7)]),
        ];
        let mint = build::account_mint(
            &p.chain,
            &available,
            None,
            "account-mint",
            &p.seedelf,
            &p.change,
            &Staking::none(),
            None,
        )
        .unwrap();
        // The largest pure-ADA UTxO pays; the 5 ADA one isn't needed, so it's put up.
        assert_eq!(outpoints(mint.inputs()), outpoints(&available[..1]));
        assert_eq!(mint.collateral().tx_hash, available[1].tx_hash);
        assert!(
            decode(&mint.draft().unwrap())
                .redeemers
                .iter()
                .all(|r| r.budget == DRAFT_BUDGET)
        );
        let built = mint.finalize(&recorded()).unwrap();
        let tx = assert_sound(&p, &mint, &built);
        assert_eq!(tx.outputs.len(), 2);
        assert_eq!(built.change_lovelace, 10_000_000 - 1_749_860 - tx.fee);
    }

    #[test]
    fn an_input_with_a_reference_script_pays_for_it_and_is_spent_last() {
        let p = payer();
        let scripted = UtxoResponse {
            reference_script: recorded_script(),
            ..at(&p, 0x33, 0, 30_000_000, &[])
        };
        let plain = at(&p, 0x34, 1, 3_000_000, &[]);
        let collateral = at(&p, 0x35, 2, 5_000_000, &[]);
        let mint_from = |available: &[UtxoResponse]| {
            build::account_mint(
                &p.chain,
                available,
                Some(&collateral),
                "account-mint",
                &p.seedelf,
                &p.change,
                &Staking::none(),
                None,
            )
            .unwrap()
        };
        // Plain ADA pays first, even the smaller.
        let mint = mint_from(&[scripted.clone(), plain.clone()]);
        assert_eq!(
            outpoints(mint.inputs()),
            outpoints(std::slice::from_ref(&plain))
        );
        // Spent, its 519 bytes are paid for with the policy's.
        let mint = mint_from(std::slice::from_ref(&scripted));
        let built = mint.finalize(&recorded()).unwrap();
        assert_eq!(built.fee.script_reference, (519 + 519) * 15);
        assert_sound(&p, &mint, &built);
    }

    #[test]
    fn the_collateral_set_aside_is_put_up_and_never_spent() {
        let p = payer();
        let set_aside = at(&p, 0x35, 0, 5_000_000, &[]);
        // Listed or not, it's left out of the inputs; the rest pays.
        for available in [
            vec![at(&p, 0x36, 1, 3_500_000, &[]), set_aside.clone()],
            vec![at(&p, 0x36, 1, 3_500_000, &[])],
        ] {
            let mint = build::account_mint(
                &p.chain,
                &available,
                Some(&set_aside),
                "account-mint",
                &p.seedelf,
                &p.change,
                &Staking::none(),
                None,
            )
            .unwrap();
            assert_eq!(outpoints(mint.inputs()), outpoints(&available[..1]));
            assert_eq!(
                outpoints(std::slice::from_ref(mint.collateral())),
                outpoints(std::slice::from_ref(&set_aside))
            );
            let tx = assert_sound(&p, &mint, &mint.finalize(&recorded()).unwrap());
            assert_eq!(tx.collateral.len(), 1);
            assert!(!tx.inputs.contains(&tx.collateral[0]));
        }
    }

    #[test]
    fn a_token_utxo_can_be_the_collateral() {
        // Like the public phrase's preprod account after its move-in: every UTxO holds tokens.
        let p = payer();
        let names: Vec<String> = (0..25).map(|i| format!("token{i:02}")).collect();
        let many: Vec<(&str, u64)> = names.iter().map(|n| (n.as_str(), 1)).collect();
        let available = [
            at(&p, 0x40, 0, 12_000_000, &many),
            at(&p, 0x41, 1, 4_000_000, &[("tok", 1)]),
        ];
        let mint = build::account_mint(
            &p.chain,
            &available,
            None,
            "account-mint",
            &p.seedelf,
            &p.change,
            &Staking::none(),
            None,
        )
        .unwrap();
        assert_eq!(outpoints(mint.inputs()), outpoints(&available[..1]));
        assert_eq!(mint.collateral().tx_hash, available[1].tx_hash);
        let built = mint.finalize(&recorded()).unwrap();
        let tx = assert_sound(&p, &mint, &built);
        // The 25 tokens go back 20 to an output.
        assert_eq!(tx.outputs.len(), 3);
        assert_eq!(built.change_tokens.items.len(), 25);
    }

    #[test]
    fn spends_as_few_as_it_can_and_can_put_up_a_spent_utxo() {
        let p = payer();
        // 2 ADA alone leaves change below its minimum; 1.5 more is enough.
        // (The 5 ADA UTxO is the collateral set aside, so it doesn't pay.)
        let available = [
            at(&p, 0x50, 0, 1_500_000, &[]),
            at(&p, 0x51, 1, 2_000_000, &[]),
            at(&p, 0x52, 2, 5_000_000, &[]),
        ];
        let mint = build::account_mint(
            &p.chain,
            &available,
            Some(&available[2]),
            "account-mint",
            &p.seedelf,
            &p.change,
            &Staking::none(),
            None,
        )
        .unwrap();
        assert_eq!(outpoints(mint.inputs()), outpoints(&available[..2]));
        assert_eq!(mint.collateral().tx_hash, available[2].tx_hash);
        assert_sound(&p, &mint, &mint.finalize(&recorded()).unwrap());

        // With one UTxO, it's both an input and the collateral.
        let single = [at(&p, 0x60, 0, 4_000_000, &[])];
        let mint = build::account_mint(
            &p.chain,
            &single,
            None,
            "account-mint",
            &p.seedelf,
            &p.change,
            &Staking::none(),
            None,
        )
        .unwrap();
        assert_eq!(mint.collateral().tx_hash, single[0].tx_hash);
        let tx = assert_sound(&p, &mint, &mint.finalize(&recorded()).unwrap());
        assert_eq!(tx.inputs, tx.collateral);
    }

    #[test]
    fn explains_what_is_wrong() {
        let p = payer();
        let err = |available: &[UtxoResponse]| {
            build::account_mint(
                &p.chain,
                available,
                None,
                "",
                &p.seedelf,
                &p.change,
                &Staking::none(),
                None,
            )
            .err()
            .expect("an error")
            .to_string()
        };
        assert!(
            err(&[at(&p, 0x70, 0, 1_500_000, &[])])
                .contains("Not enough ADA in the Cardano account for the Seedelf")
        );
        assert!(err(&[]).contains("nothing in the Cardano account"));
        // The collateral set aside is never spent, so alone it pays for nothing.
        let five = at(&p, 0x71, 0, 5_000_000, &[]);
        let e = build::account_mint(
            &p.chain,
            std::slice::from_ref(&five),
            Some(&five),
            "",
            &p.seedelf,
            &p.change,
            &Staking::none(),
            None,
        )
        .err()
        .unwrap();
        assert!(
            e.to_string().contains("nothing in the Cardano account"),
            "{e}"
        );
        let bad = Register::new("00".repeat(48), "00".repeat(48));
        assert!(
            build::account_mint(
                &p.chain,
                &[at(&p, 0x72, 0, 9_000_000, &[])],
                None,
                "",
                &bad,
                &p.change,
                &Staking::none(),
                None
            )
            .err()
            .unwrap()
            .to_string()
            .contains("register")
        );
        let mint = build::account_mint(
            &p.chain,
            &[at(&p, 0x73, 0, 9_000_000, &[])],
            None,
            "",
            &p.seedelf,
            &p.change,
            &Staking::none(),
            None,
        )
        .unwrap();
        let no_mint = json!({"result": [{"validator": {"index": 0, "purpose": "spend"}, "budget": {"memory": 1, "cpu": 1}}]});
        assert!(
            mint.finalize(&Budgets::from_ogmios(&no_mint).unwrap())
                .err()
                .unwrap()
                .to_string()
                .contains("Seedelf policy")
        );
    }

    /// Chunk 51: an account-paid mint never puts a Seedelf under a register
    /// with an identity point, as no payment does (`is_payable`). An identity
    /// public value is `g^0`, so anyone could prove its key and take the
    /// Seedelf and its ADA; an identity generator locks them for good. Both
    /// are valid points, so a check of the points alone lets them through.
    #[test]
    fn a_register_with_an_identity_point_is_never_minted() {
        let p = payer();
        let identity = format!("c0{}", "00".repeat(47));
        let (g, u) = (p.seedelf.generator.clone(), p.seedelf.public_value.clone());
        let mint = |register: &Register| {
            build::account_mint(
                &p.chain,
                &[at(&p, 0x74, 0, 9_000_000, &[])],
                None,
                "",
                register,
                &p.change,
                &Staking::none(),
                None,
            )
        };
        for register in [
            Register::new(identity.clone(), u),
            Register::new(g, identity.clone()),
            Register::new(identity.clone(), identity),
        ] {
            assert!(register.is_valid().unwrap(), "{register:?}");
            let refused = mint(&register).err().unwrap_or_else(|| {
                panic!("minted under {register:?}");
            });
            assert!(refused.to_string().contains("register"), "{refused}");
        }
        // The same UTxO mints under a register of the user's own.
        assert!(mint(&p.seedelf).is_ok());
    }

    /// An account-paid mint of 9 ₳ putting up a collateral of `lovelace` of
    /// the account's own (chunk 51's collateral tests).
    fn mint_with(p: &Payer, lovelace: u64) -> anyhow::Result<build::AccountMint> {
        build::account_mint(
            &p.chain,
            &[at(p, 0x76, 0, 9_000_000, &[])],
            Some(&at(p, 0x75, 0, lovelace, &[])),
            "",
            &p.seedelf,
            &p.change,
            &Staking::none(),
            None,
        )
    }

    /// Chunk 51 (t1d#1's sibling, the account launch's): the collateral an
    /// account-paid mint puts up must come back as an output after 3/2 of
    /// the fee it pays, finished with the policy's budget as Ogmios measured
    /// it. One too small is refused in words, where the node would refuse the
    /// signed mint.
    #[test]
    fn a_collateral_too_small_to_come_back_is_never_put_up() {
        let p = payer();
        let finished = |lovelace: u64| {
            mint_with(&p, lovelace)
                .and_then(|mint| mint.finalize(&recorded()))
                .map(|built| built.fee.total)
        };
        assert!(finished(5_000_000).is_ok());
        for lovelace in [1_000_000, 1_200_000] {
            let refused = finished(lovelace);
            assert!(
                matches!(&refused, Err(e) if e.to_string().contains("too small to put up as collateral")
                    && build::is_collateral_short(e)),
                "{lovelace}: {refused:?}"
            );
        }
    }

    /// Chunk 51, r2money#2's sibling: that least is held at the fee the mint
    /// pays, never at the estimate's guess (MINT_BUDGET_GUESS, the fee its
    /// draft is staged at). Held to the guess, a collateral within 3/2 of its
    /// extra compute over what it needs was refused: a mint the ledger takes.
    /// With no 5 ₳ set aside, the wallet puts up its own pick, of any size.
    #[test]
    fn a_collateral_that_comes_back_with_its_least_at_the_fee_the_mint_pays_is_put_up() {
        let p = payer();
        let clear = mint_with(&p, 5_000_000).unwrap();
        let fee = clear.finalize(&recorded()).unwrap().fee.total;
        let guessed = MultiEraTx::decode(&clear.draft().unwrap().tx_bytes.0)
            .unwrap()
            .fee()
            .unwrap();
        let least = address_minimum_lovelace_with_assets(
            &p.chain.params,
            &at(&p, 0x75, 0, 0, &[]).address,
            seedelf_core::assets::Assets::new(),
        )
        .unwrap();
        // 1,000 lovelace over its least at the fee it pays, and under it at the guess's.
        let collateral = least + fee * 3 / 2 + 1_000;
        assert!(
            collateral < least + guessed * 3 / 2,
            "fee {fee}, guessed {guessed}"
        );
        let built = mint_with(&p, collateral)
            .and_then(|mint| mint.finalize(&recorded()))
            .unwrap_or_else(|e| {
                panic!("refused: {e} (least {least}, fee {fee}, collateral {collateral})")
            });
        assert_eq!(built.fee.total, fee);
        let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
        let back = tx.collateral_return().expect("a collateral return");
        assert_eq!(back.value().coin(), collateral - fee * 3 / 2);
        assert!(back.value().coin() >= least);
        // Under that least at the fee it pays, it's refused.
        let refused = mint_with(&p, least + fee * 3 / 2 - 1_000)
            .and_then(|mint| mint.finalize(&recorded()))
            .map(|built| built.fee.total);
        assert!(
            matches!(&refused, Err(e) if e.to_string().contains("too small to put up as collateral")
                && build::is_collateral_short(e)),
            "{refused:?}"
        );
    }

    /// Chunk 51, t1a#11: an account-paid mint leaves out a UTxO whose tokens
    /// would push a token's total past a u64 (anyone can send the account two
    /// of 2^63), as the other selections do, and pays from the rest: here the
    /// ADA alone and one of the two are short, and that one with a third pays.
    #[test]
    fn an_account_mint_leaves_out_a_utxo_whose_tokens_would_overflow_the_rest() {
        let p = payer();
        let available = [
            at(&p, 0x80, 0, 1_000_000, &[]),
            at(&p, 0x81, 0, 2_000_000, &[("big", 1 << 63)]),
            at(&p, 0x82, 0, 2_000_000, &[("big", 1 << 63)]),
            at(&p, 0x83, 0, 1_900_000, &[("small", 1)]),
        ];
        let collateral = at(&p, 0x84, 0, 5_000_000, &[]);
        let mint = build::account_mint(
            &p.chain,
            &available,
            Some(&collateral),
            "",
            &p.seedelf,
            &p.change,
            &Staking::none(),
            None,
        )
        .unwrap_or_else(|e| panic!("{e}"));
        let spent = outpoints(mint.inputs());
        let both = outpoints(&available[1..3]);
        assert!(
            both.iter().filter(|o| spent.contains(o)).count() <= 1,
            "{spent:?}"
        );
        assert!(spent.contains(&outpoints(&available[3..])[0]), "{spent:?}");
    }
}

// ---------------------------------------------------------------------------
// Transfer: paying someone's seedelf from the Seedelf balance
// ---------------------------------------------------------------------------

mod transfer {
    use super::*;
    use blstrs::G1Affine;
    use seedelf_core::assets::{Asset as Token, Assets};
    use seedelf_core::build::Payment;

    /// Someone else's seedelf: their scalar, and the register it sits under.
    struct Recipient {
        sk: Scalar,
        found: Register,
    }

    fn recipient() -> Recipient {
        let sk = random_scalar();
        Recipient {
            sk,
            found: Register::create(sk).unwrap().rerandomize().unwrap(),
        }
    }

    fn tokens(items: &[(&str, u64)]) -> Assets {
        items.iter().fold(Assets::new(), |all, (name, quantity)| {
            all.add(Token::new(TOKEN_POLICY.to_string(), hex::encode(name), *quantity).unwrap())
                .unwrap()
        })
    }

    fn pay(to: &Register, lovelace: u64, sent: &[(&str, u64)]) -> Payment {
        Payment {
            register: to.clone(),
            lovelace,
            tokens: tokens(sent),
        }
    }

    fn proven(w: &World, spend: build::ScriptSpend) -> build::ScriptSpend {
        spend
            .proven(|register, vkh| create_proof(register.clone(), w.sk, vkh.to_string()))
            .unwrap()
    }

    /// An Ogmios v6 answer for `spends` inputs and nothing else.
    fn measured_spends(spends: usize) -> Budgets {
        let result: Vec<Value> = (0..spends)
            .map(|i| {
                json!({"validator": {"index": i, "purpose": "spend"},
                       "budget": {"memory": SPEND.mem, "cpu": SPEND.steps}})
            })
            .collect();
        Budgets::from_ogmios(&json!({"jsonrpc": "2.0", "result": result})).unwrap()
    }

    fn finish(w: &World, spend: build::ScriptSpend) -> build::FinalSpend {
        let n = spend.inputs().len();
        proven(w, spend).finalize(&measured_spends(n)).unwrap()
    }

    fn values(utxos: &[UtxoResponse]) -> Vec<String> {
        let mut v: Vec<String> = utxos.iter().map(|u| u.value.clone()).collect();
        v.sort();
        v
    }

    /// Everything a finished transfer must satisfy: `paid[i]` is the
    /// scalar that must own output `i`, and what it must hold.
    fn assert_transfer(
        w: &World,
        spent: &[UtxoResponse],
        paid: &[(Scalar, &Payment)],
        built: &build::FinalSpend,
    ) -> Decoded {
        let tx = decode(&built.tx);
        let chain = &w.chain;

        // Exactly the given UTxOs, plus giveme.my's collateral.
        let mut expected: Vec<(String, u64)> = spent
            .iter()
            .map(|u| (u.tx_hash.clone(), u.tx_index))
            .collect();
        expected.sort();
        assert_eq!(tx.inputs, expected);
        assert_eq!(
            tx.collateral,
            vec![(hex::encode(PREPROD_COLLATERAL_UTXO), 0)]
        );
        assert!(tx.mint.is_empty(), "a transfer mints nothing");

        // Value: inputs = outputs + fee, token for token.
        let lovelace_in: u64 = spent.iter().map(|u| u.value.parse::<u64>().unwrap()).sum();
        let lovelace_out: u64 = tx.outputs.iter().map(|o| o.lovelace).sum();
        assert_eq!(lovelace_in, lovelace_out + tx.fee, "lovelace conserved");
        let mut tokens_in: BTreeMap<(String, String), u64> = BTreeMap::new();
        for a in spent.iter().flat_map(|u| u.asset_list.iter().flatten()) {
            *tokens_in
                .entry((a.policy_id.clone(), a.asset_name.clone()))
                .or_default() += a.quantity.parse::<u64>().unwrap();
        }
        let mut tokens_out: BTreeMap<(String, String), u64> = BTreeMap::new();
        for o in &tx.outputs {
            for (k, q) in &o.assets {
                *tokens_out.entry(k.clone()).or_default() += q;
            }
        }
        assert_eq!(tokens_in, tokens_out, "tokens conserved");

        // Every output in the contract, under a valid, fresh register, above its minimum.
        let mut generators = std::collections::BTreeSet::new();
        for (i, o) in tx.outputs.iter().enumerate() {
            assert_eq!(o.address, w.wallet, "output {i} is in the wallet contract");
            let register = o.register.as_ref().expect("a register datum");
            assert!(build::is_payable(register), "output {i} register valid");
            assert!(
                generators.insert(register.generator.clone()),
                "fresh register"
            );
            let mut assets = Assets::new();
            for ((p, n), q) in &o.assets {
                assets = assets
                    .add(Token::new(p.clone(), n.clone(), *q).unwrap())
                    .unwrap();
            }
            let minimum = wallet_minimum_lovelace_with_assets(&chain.params, assets).unwrap();
            assert!(o.lovelace >= minimum, "output {i} above its minimum");
        }

        // Each payment is an output, anywhere among them (they're shuffled):
        // a re-randomization of the register found, owned by the recipient,
        // never the register as found, holding exactly what was paid.
        let mut rest: Vec<&Out> = tx.outputs.iter().collect();
        for (i, (owner, payment)) in paid.iter().enumerate() {
            let sent: BTreeMap<(String, String), u64> = payment
                .tokens
                .items
                .iter()
                .map(|a| {
                    (
                        (hex::encode(a.policy_id), hex::encode(&a.token_name)),
                        a.amount,
                    )
                })
                .collect();
            let at = rest
                .iter()
                .position(|o| {
                    o.register.as_ref().unwrap().is_owned(*owner).unwrap()
                        && o.lovelace == payment.lovelace
                        && o.assets == sent
                })
                .unwrap_or_else(|| panic!("payment {i} reaches its Seedelf's owner"));
            let o = rest.remove(at);
            assert_ne!(
                o.register.as_ref().unwrap(),
                &payment.register,
                "payment {i} is re-randomized"
            );
        }
        // The rest is change, owned by the payer.
        for o in &rest {
            assert!(
                o.register.as_ref().unwrap().is_owned(w.sk).unwrap(),
                "change is owned"
            );
        }
        assert_eq!(built.change_outputs, rest.len());

        // Only the wallet script, by reference; the one-time key and giveme.my sign.
        assert_eq!(tx.signers, vec![w.signer, Hash::new(COLLATERAL_HASH)]);
        assert_eq!(
            tx.reference_inputs,
            vec![(hex::encode(chain.config.reference.wallet_reference_utxo), 1)]
        );

        // Every redeemer is a spend proving its input's register, bound to the one-time key.
        let vkh = hex::encode(w.signer);
        assert_eq!(tx.redeemers.len(), spent.len());
        for r in &tx.redeemers {
            assert_eq!(r.tag, RedeemerTag::Spend);
            let (hash, index) = &tx.inputs[r.index as usize];
            let utxo = spent
                .iter()
                .find(|u| &u.tx_hash == hash && u.tx_index == *index)
                .unwrap();
            let register = register_of(utxo);
            assert_eq!(bytes_field(&r.data, 2), vkh, "bound to the one-time key");
            assert!(
                prove(
                    &register.generator,
                    &register.public_value,
                    &bytes_field(&r.data, 0),
                    &bytes_field(&r.data, 1),
                    &vkh,
                )
                .unwrap(),
                "the proof for {hash}#{index} verifies"
            );
        }

        // The fee: even, at least the ledger's minimum with the wallet script's 629 bytes.
        let (mem, steps) = tx
            .redeemers
            .iter()
            .fold((0, 0), |(m, s), r| (m + r.budget.mem, s + r.budget.steps));
        let needed = ledger_minimum_fee(&chain.params, tx.size_signed, mem, steps, 629);
        assert_eq!(tx.fee % 2, 0, "the fee is even");
        assert!(tx.fee >= needed, "fee {} covers {needed}", tx.fee);
        assert!(
            tx.fee - needed < 1_000,
            "fee {} is close to {needed}",
            tx.fee
        );
        assert_eq!(built.fee.total, tx.fee);
        assert_eq!(built.fee.script_reference, 629 * 15);
        assert_eq!(
            tx.collateral_return,
            (collateral_address(true), 5_000_000 - tx.fee * 3 / 2)
        );
        tx
    }

    #[test]
    fn pays_a_seedelf_under_a_fresh_copy_of_its_register() {
        let w = world();
        let bob = recipient();
        let payment = pay(&bob.found, 3_000_000, &[]);
        let available = [
            owned(&w, 0x01, 0, 1_800_000, &[]),
            owned(&w, 0x02, 0, 10_000_000, &[]),
            owned(&w, 0x03, 0, 8_000_000, &[("tok", 5)]),
        ];
        let spend = build::transfer(
            &w.chain,
            &available,
            std::slice::from_ref(&payment),
            &w.owner,
            w.signer,
        )
        .unwrap();
        // One pure-ADA UTxO pays: the largest.
        assert_eq!(values(&spend.inputs()), vec!["10000000"]);
        let spent = spend.inputs();

        // The draft: only the wallet script runs, with placeholder budgets.
        let draft = decode(&proven(&w, spend.clone()).draft().unwrap());
        assert!(draft.mint.is_empty());
        assert!(draft.redeemers.iter().all(|r| r.budget == DRAFT_BUDGET));

        let built = finish(&w, spend);
        let tx = assert_transfer(&w, &spent, &[(bob.sk, &payment)], &built);
        assert_eq!(tx.outputs.len(), 2, "the payment and one change output");
        assert_eq!(
            built.change_lovelace,
            10_000_000 - 3_000_000 - built.fee.total
        );
        // About 0.24 ADA for one input.
        assert!(
            (200_000..300_000).contains(&built.fee.total),
            "{}",
            built.fee.total
        );
        // The payment isn't the sender's, and not the found register's owner by accident.
        let theirs = tx
            .outputs
            .iter()
            .filter(|o| !o.register.as_ref().unwrap().is_owned(w.sk).unwrap())
            .count();
        assert_eq!(theirs, 1);
    }

    #[test]
    fn budgets_follow_purpose_and_index_on_a_shuffled_answer() {
        let w = world();
        let bob = recipient();
        let payment = pay(&bob.found, 2_000_000, &[]);
        let spent = [
            owned(&w, 0x30, 0, 4_000_000, &[]),
            owned(&w, 0x10, 0, 4_000_000, &[]),
            owned(&w, 0x20, 0, 4_000_000, &[]),
        ];
        let spend = build::transfer_from(
            &w.chain,
            &spent,
            std::slice::from_ref(&payment),
            &w.owner,
            w.signer,
        )
        .unwrap();
        let answer = json!({"result": [
            {"validator": {"index": 2, "purpose": "spend"}, "budget": {"memory": 76_002, "cpu": 337_000_002}},
            {"validator": {"index": 0, "purpose": "spend"}, "budget": {"memory": 76_000, "cpu": 337_000_000}},
            {"validator": {"index": 1, "purpose": "spend"}, "budget": {"memory": 76_001, "cpu": 337_000_001}},
        ]});
        let built = proven(&w, spend)
            .finalize(&Budgets::from_ogmios(&answer).unwrap())
            .unwrap();
        let tx = assert_transfer(&w, &spent, &[(bob.sk, &payment)], &built);
        for r in &tx.redeemers {
            assert_eq!(
                r.budget,
                Budget {
                    mem: 76_000 + r.index as u64,
                    steps: 337_000_000 + r.index as u64,
                }
            );
        }
        // A budget Ogmios didn't report can't be guessed at.
        let short = json!({"result": [{"validator": {"index": 0, "purpose": "spend"}, "budget": {"memory": 1, "cpu": 1}}]});
        let spend = build::transfer_from(&w.chain, &spent, &[payment], &w.owner, w.signer).unwrap();
        let e = proven(&w, spend)
            .finalize(&Budgets::from_ogmios(&short).unwrap())
            .err()
            .unwrap();
        assert!(e.to_string().contains("spending input 1"), "{e}");
    }

    #[test]
    fn sends_part_of_a_token_from_the_utxos_holding_it() {
        let w = world();
        let bob = recipient();
        let available = [
            owned(&w, 0x01, 0, 20_000_000, &[]),
            owned(&w, 0x02, 0, 2_500_000, &[("other", 9)]),
            owned(&w, 0x03, 0, 3_000_000, &[("tok", 100)]),
            owned(&w, 0x04, 0, 1_500_000, &[]),
        ];
        let payment = pay(&bob.found, 2_000_000, &[("tok", 40)]);
        let spend = build::transfer(
            &w.chain,
            &available,
            std::slice::from_ref(&payment),
            &w.owner,
            w.signer,
        )
        .unwrap();
        // The token's UTxO first, then the largest pure-ADA one; never the other token's.
        assert_eq!(values(&spend.inputs()), vec!["20000000", "3000000"]);
        let spent = spend.inputs();
        let built = finish(&w, spend);
        let tx = assert_transfer(&w, &spent, &[(bob.sk, &payment)], &built);
        // The other 60 go back as change.
        assert_eq!(built.change_tokens, tokens(&[("tok", 60)]));
        let back: u64 = tx
            .outputs
            .iter()
            .filter(|o| o.register.as_ref().unwrap().is_owned(w.sk).unwrap())
            .filter_map(|o| {
                o.assets
                    .get(&(TOKEN_POLICY.to_string(), hex::encode("tok")))
            })
            .sum();
        assert_eq!(back, 60);

        // Split across UTxOs, it takes as many as hold enough: the biggest holdings first.
        let available = [
            owned(&w, 0x05, 0, 3_000_000, &[("tok", 30)]),
            owned(&w, 0x06, 0, 3_000_000, &[("tok", 10)]),
            owned(&w, 0x07, 0, 3_000_000, &[("tok", 25)]),
            owned(&w, 0x08, 0, 30_000_000, &[]),
        ];
        let payment = pay(&bob.found, 2_000_000, &[("tok", 50)]);
        let spend = build::transfer(
            &w.chain,
            &available,
            std::slice::from_ref(&payment),
            &w.owner,
            w.signer,
        )
        .unwrap();
        let picked: Vec<u8> = spend
            .inputs()
            .iter()
            .map(|u| hex::decode(&u.tx_hash).unwrap()[0])
            .collect();
        assert_eq!(
            picked,
            vec![0x05, 0x07],
            "30 and 25 cover 50; ADA wasn't needed"
        );
        let spent = spend.inputs();
        assert_transfer(&w, &spent, &[(bob.sk, &payment)], &finish(&w, spend));
    }

    #[test]
    fn pays_several_seedelfs_and_your_own() {
        let w = world();
        let bob = recipient();
        // Your own seedelf: allowed, and the payment comes back to you.
        let mine = w.owner.clone().rerandomize().unwrap();
        let payments = [
            pay(&bob.found, 2_000_000, &[]),
            pay(&mine, 2_000_000, &[("tok", 1)]),
        ];
        let available = [
            owned(&w, 0x01, 0, 10_000_000, &[]),
            owned(&w, 0x02, 0, 2_000_000, &[("tok", 3)]),
        ];
        let spend = build::transfer(&w.chain, &available, &payments, &w.owner, w.signer).unwrap();
        let spent = spend.inputs();
        let built = finish(&w, spend);
        assert_transfer(
            &w,
            &spent,
            &[(bob.sk, &payments[0]), (w.sk, &payments[1])],
            &built,
        );
    }

    #[test]
    fn max_pays_one_seedelf_everything_but_the_fee_and_what_kept_tokens_need() {
        // Blind test T05's private balance: 25 ₳, and 3 ₳ holding a token.
        let w = world();
        let bob = recipient();
        let available = [
            owned(&w, 0x01, 0, 25_000_000, &[]),
            owned(&w, 0x02, 0, 3_000_000, &[("tok", 5)]),
        ];
        let (inputs, left) = build::max_inputs(&available, &Assets::new(), 20).unwrap();
        assert_eq!((values(&inputs), left), (values(&available), 0));

        // The token stays, with the least ADA it needs, and every other lovelace goes.
        let spend = build::transfer_most(
            &w.chain,
            &inputs,
            &bob.found,
            &Assets::new(),
            &w.owner,
            w.signer,
        )
        .unwrap();
        let built = finish(&w, spend);
        let kept = build::minimum_deposit(&w.chain.params, &tokens(&[("tok", 5)])).unwrap();
        let paid = built.rest_lovelace.expect("Max says what it paid");
        assert_eq!(paid, 28_000_000 - built.fee.total - kept);
        assert_eq!(
            (built.change_lovelace, built.change_tokens.clone()),
            (kept, tokens(&[("tok", 5)]))
        );
        assert_eq!(built.change_outputs, 1);
        assert_transfer(
            &w,
            &inputs,
            &[(bob.sk, &pay(&bob.found, paid, &[]))],
            &built,
        );

        // Sent too, the token takes all of it: no change at all.
        let all = tokens(&[("tok", 5)]);
        let spend =
            build::transfer_most(&w.chain, &inputs, &bob.found, &all, &w.owner, w.signer).unwrap();
        let built = finish(&w, spend);
        let paid = built.rest_lovelace.unwrap();
        assert_eq!(paid, 28_000_000 - built.fee.total);
        assert_eq!((built.change_lovelace, built.change_outputs), (0, 0));
        assert!(built.change_tokens.is_empty());
        let tx = assert_transfer(
            &w,
            &inputs,
            &[(bob.sk, &pay(&bob.found, paid, &[("tok", 5)]))],
            &built,
        );
        assert_eq!(tx.outputs.len(), 1);

        // Part of it: the rest stays.
        let some = tokens(&[("tok", 2)]);
        let spend =
            build::transfer_most(&w.chain, &inputs, &bob.found, &some, &w.owner, w.signer).unwrap();
        let built = finish(&w, spend);
        assert_eq!(built.change_tokens, tokens(&[("tok", 3)]));
        let paid = built.rest_lovelace.unwrap();
        assert_transfer(
            &w,
            &inputs,
            &[(bob.sk, &pay(&bob.found, paid, &[("tok", 2)]))],
            &built,
        );

        // Too little to carry the token anywhere, a register that would lose it, or tokens it doesn't hold.
        let tiny = [owned(&w, 0x03, 0, 1_200_000, &[("tok", 5)])];
        let spend = build::transfer_most(
            &w.chain,
            &tiny,
            &bob.found,
            &Assets::new(),
            &w.owner,
            w.signer,
        )
        .unwrap();
        let e = proven(&w, spend)
            .finalize(&measured_spends(1))
            .err()
            .unwrap();
        assert!(build::is_short(&e), "{e}");
        let bad = Register::new("00".repeat(48), "00".repeat(48));
        let e = build::transfer_most(&w.chain, &inputs, &bad, &Assets::new(), &w.owner, w.signer)
            .err()
            .unwrap();
        assert!(e.to_string().contains("register isn't valid"), "{e}");
        let spend = build::transfer_most(
            &w.chain,
            &inputs,
            &bob.found,
            &tokens(&[("tok", 6)]),
            &w.owner,
            w.signer,
        )
        .unwrap();
        assert!(proven(&w, spend).finalize(&measured_spends(2)).is_err());
    }

    #[test]
    fn max_takes_the_tokens_sent_first_then_the_largest_as_many_as_fit() {
        let w = world();
        let mut available: Vec<UtxoResponse> = (0..22u8)
            .map(|n| owned(&w, n + 1, 0, 2_000_000 + u64::from(n) * 100_000, &[]))
            .collect();
        available.push(owned(&w, 0x40, 0, 1_500_000, &[("tok", 7)]));
        // The token's UTxO, then the 19 largest: the three smallest stay, and are counted.
        let (taken, left) = build::max_inputs(&available, &tokens(&[("tok", 1)]), 20).unwrap();
        assert_eq!(taken.len(), 20);
        assert_eq!(taken[0].value, "1500000");
        assert_eq!(taken[1].value, "4100000");
        assert!(
            !taken
                .iter()
                .any(|u| u.value == "2000000" || u.value == "2200000")
        );
        assert_eq!(left, 3);
        // With nothing sent, the largest 20, the token's UTxO among them only by size.
        let (taken, left) = build::max_inputs(&available, &Assets::new(), 20).unwrap();
        assert!(!taken.iter().any(|u| u.value == "1500000"));
        assert_eq!(left, 3);
    }

    /// A point on the curve outside the prime-order subgroup, compressed.
    fn torsion_point() -> String {
        (0u64..)
            .find_map(|x| {
                let mut bytes = [0u8; 48];
                bytes[40..].copy_from_slice(&x.to_be_bytes());
                bytes[0] |= 0x80;
                let point = Option::<G1Affine>::from(G1Affine::from_compressed_unchecked(&bytes))?;
                (bool::from(point.is_on_curve()) && !bool::from(point.is_torsion_free()))
                    .then(|| hex::encode(bytes))
            })
            .unwrap()
    }

    #[test]
    fn refuses_what_would_lose_money() {
        let w = world();
        let bob = recipient();
        let available = [owned(&w, 0x01, 0, 10_000_000, &[("tok", 5)])];
        let err = |payments: &[Payment]| {
            build::transfer(&w.chain, &available, payments, &w.owner, w.signer)
                .err()
                .expect("an error")
                .to_string()
        };

        // Registers a payment to would be locked for good, or open to anyone.
        let g = w.owner.generator.clone();
        let identity = format!("c0{}", "00".repeat(47));
        let bad = [
            Register::new("00".repeat(48), "00".repeat(48)),
            Register::new(g.clone(), torsion_point()),
            Register::new(torsion_point(), g.clone()),
            Register::new(g.clone(), identity.clone()),
            Register::new(identity.clone(), g.clone()),
            Register::new(identity.clone(), identity),
        ];
        for register in &bad {
            assert!(!build::is_payable(register));
            let e = err(&[pay(register, 2_000_000, &[])]);
            assert!(e.contains("register isn't valid"), "{e}");
        }
        assert!(build::is_payable(&bob.found));

        // Below the recipient output's minimum.
        let e = err(&[pay(&bob.found, 1_000_000, &[])]);
        assert!(e.contains("needs at least 1.") && e.contains("ADA"), "{e}");
        assert!(err(&[pay(&bob.found, 1_000_000, &[("tok", 1)])]).contains("with these tokens"));

        // Tokens the balance doesn't hold, or not enough of them.
        let e = err(&[pay(&bob.found, 2_000_000, &[("nope", 1)])]);
        assert!(e.contains("doesn't hold the token"), "{e}");
        let e = err(&[pay(&bob.found, 2_000_000, &[("tok", 6)])]);
        assert!(e.contains("holds only 5"), "{e}");
        let zero = Payment {
            tokens: Assets {
                items: vec![Token::new(TOKEN_POLICY.to_string(), hex::encode("tok"), 0).unwrap()],
            },
            ..pay(&bob.found, 2_000_000, &[])
        };
        assert!(err(&[zero]).contains("none of a token"));

        // Nothing to pay, or not enough ADA.
        assert!(err(&[]).contains("at least one Seedelf"));
        let e = err(&[pay(&bob.found, 9_000_000, &[])]);
        assert!(e.contains("Not enough ADA in the Seedelf balance"), "{e}");

        // Given UTxOs that don't hold the tokens being sent.
        let plain = [owned(&w, 0x02, 0, 10_000_000, &[])];
        let spend = build::transfer_from(
            &w.chain,
            &plain,
            &[pay(&bob.found, 2_000_000, &[("tok", 1)])],
            &w.owner,
            w.signer,
        )
        .unwrap();
        assert!(proven(&w, spend).draft().is_err());
    }
}

// ---------------------------------------------------------------------------
// Withdraw: paying an address from the Seedelf balance, or removing a seedelf
// ---------------------------------------------------------------------------

mod withdraw {
    use super::*;
    use pallas_addresses::{
        Network, PaymentKeyHash, ScriptHash, ShelleyAddress, ShelleyDelegationPart,
        ShelleyPaymentPart, StakeKeyHash,
    };
    use seedelf_core::assets::{Asset as Token, Assets};
    use seedelf_core::transaction::address_minimum_lovelace_with_assets;

    /// A base address on `network` from made-up key hashes.
    fn key_address(network: Network) -> Address {
        ShelleyAddress::new(
            network,
            ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
            ShelleyDelegationPart::Key(StakeKeyHash::new([8; 28])),
        )
        .into()
    }

    fn tokens(items: &[(&str, u64)]) -> Assets {
        items.iter().fold(Assets::new(), |all, (name, quantity)| {
            all.add(Token::new(TOKEN_POLICY.to_string(), hex::encode(name), *quantity).unwrap())
                .unwrap()
        })
    }

    /// An owned UTxO holding the seedelf `name` and nothing else.
    fn seedelf(w: &World, n: u8, name: &str) -> UtxoResponse {
        let mut utxo = owned(w, n, 0, 1_749_860, &[]);
        utxo.asset_list = Some(vec![Asset {
            decimals: 0,
            quantity: "1".into(),
            policy_id: w.chain.config.contract.seedelf_policy_id.clone(),
            asset_name: name.into(),
            fingerprint: String::new(),
        }]);
        utxo
    }

    fn spends_only(spends: usize) -> Budgets {
        let result: Vec<Value> = (0..spends)
            .map(|i| {
                json!({"validator": {"index": i, "purpose": "spend"},
                       "budget": {"memory": SPEND.mem, "cpu": SPEND.steps}})
            })
            .collect();
        Budgets::from_ogmios(&json!({"result": result})).unwrap()
    }

    fn finish(w: &World, spend: build::ScriptSpend, budgets: &Budgets) -> build::FinalSpend {
        spend
            .proven(|register, vkh| create_proof(register.clone(), w.sk, vkh.to_string()))
            .unwrap()
            .finalize(budgets)
            .unwrap()
    }

    fn assets_of(o: &Out) -> Assets {
        o.assets.iter().fold(Assets::new(), |all, ((p, n), q)| {
            all.add(Token::new(p.clone(), n.clone(), *q).unwrap())
                .unwrap()
        })
    }

    /// What every withdrawal must satisfy, whatever its outputs: value
    /// conserved (less anything burned), proofs bound to the one-time key,
    /// the fee against the ledger's formula for `script_bytes`, and
    /// giveme.my's collateral.
    fn assert_spend(
        w: &World,
        spent: &[UtxoResponse],
        built: &build::FinalSpend,
        script_bytes: u64,
    ) -> Decoded {
        let tx = decode(&built.tx);
        let mut expected: Vec<(String, u64)> = spent
            .iter()
            .map(|u| (u.tx_hash.clone(), u.tx_index))
            .collect();
        expected.sort();
        assert_eq!(tx.inputs, expected);
        assert_eq!(
            tx.collateral,
            vec![(hex::encode(PREPROD_COLLATERAL_UTXO), 0)]
        );

        let lovelace_in: u64 = spent.iter().map(|u| u.value.parse::<u64>().unwrap()).sum();
        let lovelace_out: u64 = tx.outputs.iter().map(|o| o.lovelace).sum();
        assert_eq!(lovelace_in, lovelace_out + tx.fee, "lovelace conserved");
        // In i128: a token can total up to a u64 across the inputs.
        let mut tokens: BTreeMap<(String, String), i128> = BTreeMap::new();
        for a in spent.iter().flat_map(|u| u.asset_list.iter().flatten()) {
            *tokens
                .entry((a.policy_id.clone(), a.asset_name.clone()))
                .or_default() += a.quantity.parse::<i128>().unwrap();
        }
        for (k, v) in &tx.mint {
            *tokens.entry(k.clone()).or_default() += i128::from(*v);
        }
        tokens.retain(|_, v| *v != 0);
        let mut out: BTreeMap<(String, String), i128> = BTreeMap::new();
        for o in &tx.outputs {
            for (k, v) in &o.assets {
                *out.entry(k.clone()).or_default() += i128::from(*v);
            }
        }
        assert_eq!(tokens, out, "tokens conserved");

        // Every output above its minimum, wherever it goes.
        for (i, o) in tx.outputs.iter().enumerate() {
            let minimum = if o.address == w.wallet {
                let register = o.register.as_ref().expect("a register datum");
                assert!(register.is_owned(w.sk).unwrap(), "change is owned");
                wallet_minimum_lovelace_with_assets(&w.chain.params, assets_of(o)).unwrap()
            } else {
                assert!(o.register.is_none(), "an address output carries no datum");
                address_minimum_lovelace_with_assets(
                    &w.chain.params,
                    &o.address.to_bech32().unwrap(),
                    assets_of(o),
                )
                .unwrap()
            };
            assert!(o.lovelace >= minimum, "output {i} above its minimum");
        }

        let vkh = hex::encode(w.signer);
        assert_eq!(tx.signers, vec![w.signer, Hash::new(COLLATERAL_HASH)]);
        for r in tx.redeemers.iter().filter(|r| r.tag == RedeemerTag::Spend) {
            let (hash, index) = &tx.inputs[r.index as usize];
            let utxo = spent
                .iter()
                .find(|u| &u.tx_hash == hash && u.tx_index == *index)
                .unwrap();
            let register = register_of(utxo);
            assert!(
                prove(
                    &register.generator,
                    &register.public_value,
                    &bytes_field(&r.data, 0),
                    &bytes_field(&r.data, 1),
                    &vkh,
                )
                .unwrap()
            );
        }

        let (mem, steps) = tx
            .redeemers
            .iter()
            .fold((0, 0), |(m, s), r| (m + r.budget.mem, s + r.budget.steps));
        let needed = ledger_minimum_fee(&w.chain.params, tx.size_signed, mem, steps, script_bytes);
        assert_eq!(tx.fee % 2, 0);
        assert!(tx.fee >= needed, "fee {} covers {needed}", tx.fee);
        assert!(
            tx.fee - needed < 1_000,
            "fee {} is close to {needed}",
            tx.fee
        );
        assert_eq!(built.fee.script_reference, script_bytes * 15);
        assert_eq!(
            tx.collateral_return,
            (collateral_address(true), 5_000_000 - tx.fee * 3 / 2)
        );
        tx
    }

    #[test]
    fn pays_an_address_exactly_and_keeps_the_change() {
        let w = world();
        let to = key_address(Network::Testnet);
        let available = [
            owned(&w, 0x01, 0, 20_000_000, &[]),
            owned(&w, 0x02, 0, 3_000_000, &[("tok", 100)]),
            owned(&w, 0x03, 0, 2_500_000, &[("other", 9)]),
        ];
        let sent = tokens(&[("tok", 40)]);
        let spend = build::sweep(
            &w.chain, &available, &to, 5_000_000, &sent, &w.owner, w.signer,
        )
        .unwrap();
        let spent = spend.inputs();
        // The token's UTxO, then the largest pure-ADA one; never the other token's.
        assert_eq!(spent.len(), 2);
        assert!(spent.iter().all(|u| u.value != "2500000"));
        let built = finish(&w, spend, &spends_only(2));
        let tx = assert_spend(&w, &spent, &built, 629);
        // The payment and the change in a random order.
        let (paid, change): (Vec<&Out>, Vec<&Out>) =
            tx.outputs.iter().partition(|o| o.address == to);
        assert_eq!(paid.len(), 1);
        assert_eq!(paid[0].lovelace, 5_000_000);
        assert_eq!(assets_of(paid[0]), sent);
        assert!(!change.is_empty() && change.iter().all(|o| o.address == w.wallet));
        assert_eq!(built.change_tokens, tokens(&[("tok", 60)]));
        assert!(tx.mint.is_empty());
    }

    #[test]
    fn pays_several_addresses_and_keeps_the_change() {
        let w = world();
        let first = key_address(Network::Testnet);
        let second: Address = ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new([9; 28])),
            ShelleyDelegationPart::Null,
        )
        .into();
        let available = [
            owned(&w, 0x01, 0, 20_000_000, &[]),
            owned(&w, 0x02, 0, 3_000_000, &[("tok", 100)]),
            owned(&w, 0x03, 0, 2_500_000, &[("other", 9)]),
        ];
        let payments = [
            build::AddressPayment {
                to: first.clone(),
                lovelace: 5_000_000,
                tokens: tokens(&[("tok", 40)]),
            },
            build::AddressPayment {
                to: second.clone(),
                lovelace: 2_000_000,
                tokens: tokens(&[("tok", 25)]),
            },
        ];
        let spend = build::sweep_many(&w.chain, &available, &payments, &w.owner, w.signer).unwrap();
        let spent = spend.inputs();
        assert_eq!(
            spent.len(),
            2,
            "the token's UTxO and the largest pure-ADA one"
        );
        let built = finish(&w, spend, &spends_only(2));
        let tx = assert_spend(&w, &spent, &built, 629);
        // Each address as asked, and the change back into the contract, in
        // a random order.
        let to = |addr: &Address| {
            let found: Vec<&Out> = tx.outputs.iter().filter(|o| &o.address == addr).collect();
            assert_eq!(found.len(), 1);
            (found[0].lovelace, assets_of(found[0]))
        };
        assert_eq!(to(&first), (5_000_000, tokens(&[("tok", 40)])));
        assert_eq!(to(&second), (2_000_000, tokens(&[("tok", 25)])));
        assert_eq!(
            tx.outputs.iter().filter(|o| o.address == w.wallet).count(),
            tx.outputs.len() - 2
        );
        assert_eq!(built.change_tokens, tokens(&[("tok", 35)]));

        // Together they can't take more of a token than there is.
        let mut greedy = payments.clone();
        greedy[1].tokens = tokens(&[("tok", 61)]);
        let e = build::sweep_many(&w.chain, &available, &greedy, &w.owner, w.signer)
            .err()
            .unwrap()
            .to_string();
        assert!(e.contains("holds only 100"), "{e}");
        let e = build::sweep_many(&w.chain, &available, &[], &w.owner, w.signer)
            .err()
            .unwrap()
            .to_string();
        assert!(e.contains("at least one address"), "{e}");
    }

    #[test]
    fn never_picks_a_utxo_whose_tokens_would_overflow_the_rest() {
        let w = world();
        let to = key_address(Network::Testnet);
        // Three UTxOs of 2^63 − 1 of one token, paid in by a stranger: all
        // three can't sit in one output.
        let junk = (1u64 << 63) - 1;
        let available = [
            owned(&w, 0x01, 0, 4_000_000, &[]),
            owned(&w, 0x07, 0, 3_000_000, &[("junk", junk)]),
            owned(&w, 0x08, 0, 3_000_000, &[("junk", junk)]),
            owned(&w, 0x09, 0, 3_000_000, &[("junk", junk)]),
        ];
        // More than the ADA-only UTxO holds, so selection reaches the token UTxOs.
        let spend = build::sweep(
            &w.chain,
            &available,
            &to,
            8_000_000,
            &Assets::new(),
            &w.owner,
            w.signer,
        )
        .unwrap();
        let spent = spend.inputs();
        assert_eq!(spent.len(), 3);
        assert!(spent.iter().all(|u| u.tx_hash != hex::encode([0x09; 32])));
        let built = finish(&w, spend, &spends_only(3));
        assert_spend(&w, &spent, &built, 629);
        // More than the two that fit hold: not enough, in words.
        let err = build::sweep(
            &w.chain,
            &available,
            &to,
            10_000_000,
            &Assets::new(),
            &w.owner,
            w.signer,
        )
        .err()
        .unwrap()
        .to_string();
        assert!(
            err.contains("Not enough ADA in the Seedelf balance"),
            "{err}"
        );
    }

    #[test]
    fn never_picks_a_utxo_the_wallets_evaluator_cant_take() {
        let w = world();
        let to = key_address(Network::Testnet);
        // The largest carries a reference script, which anyone can pay a Seedelf.
        let scripted = UtxoResponse {
            reference_script: recorded_script(),
            ..owned(&w, 0x01, 0, 30_000_000, &[])
        };
        let available = [
            scripted,
            owned(&w, 0x02, 0, 4_000_000, &[]),
            owned(&w, 0x03, 0, 3_000_000, &[]),
        ];
        let spend = build::sweep(
            &w.chain,
            &available,
            &to,
            5_000_000,
            &Assets::new(),
            &w.owner,
            w.signer,
        )
        .unwrap();
        let spent = spend.inputs();
        assert_eq!(outpoints(&spent), outpoints(&available[1..]));
        let built = finish(&w, spend, &spends_only(2));
        assert_spend(&w, &spent, &built, 629);
    }

    fn outpoints(utxos: &[UtxoResponse]) -> Vec<(String, u64)> {
        let mut o: Vec<(String, u64)> = utxos
            .iter()
            .map(|u| (u.tx_hash.clone(), u.tx_index))
            .collect();
        o.sort();
        o
    }

    #[test]
    fn a_spent_input_with_a_reference_script_is_paid_for() {
        let w = world();
        let to = key_address(Network::Testnet);
        let scripted = UtxoResponse {
            reference_script: recorded_script(),
            ..owned(&w, 0x01, 0, 8_000_000, &[])
        };
        // The CLI's sweep of exactly these, measured by Ogmios.
        let spend = build::sweep_all(
            &w.chain,
            std::slice::from_ref(&scripted),
            &to,
            &w.owner,
            w.signer,
        )
        .unwrap();
        let built = finish(&w, spend, &spends_only(1));
        // The wallet script's 629 bytes and the input's 519.
        assert_spend(&w, &[scripted], &built, 629 + 519);
    }

    #[test]
    fn sends_everything_less_the_fee() {
        let w = world();
        let to = key_address(Network::Testnet);
        let names: Vec<String> = (0..25).map(|i| format!("token{i:02}")).collect();
        let many: Vec<(&str, u64)> = names.iter().map(|n| (n.as_str(), 1)).collect();
        let inputs = [
            owned(&w, 0x01, 0, 8_000_000, &[]),
            owned(&w, 0x02, 0, 6_000_000, &many),
        ];
        let spend = build::sweep_all(&w.chain, &inputs, &to, &w.owner, w.signer).unwrap();
        let built = finish(&w, spend, &spends_only(2));
        let tx = assert_spend(&w, &inputs, &built, 629);
        // All of it to the address, the 25 tokens 20 to an output; nothing back.
        assert_eq!(tx.outputs.len(), 2);
        assert!(tx.outputs.iter().all(|o| o.address == to));
        assert_eq!(built.change_lovelace, 14_000_000 - built.fee.total);
        assert_eq!(built.change_tokens.items.len(), 25);
    }

    #[test]
    fn removes_a_seedelf_to_an_address_or_back_into_the_contract() {
        let w = world();
        let name = format!("5eed0e1f{}", "ab".repeat(28));
        let utxo = seedelf(&w, 0x40, &name);
        let policy = w.chain.config.contract.seedelf_policy_id.clone();
        let both_scripts = 629 + 519;

        // To an address: the token burned, the rest of its ADA there.
        let to = key_address(Network::Testnet);
        let spend = build::remove(&w.chain, &utxo, &w.owner, w.signer)
            .unwrap()
            .change_to(&to);
        let draft = decode(
            &spend
                .clone()
                .proven(|r, vkh| create_proof(r.clone(), w.sk, vkh.to_string()))
                .unwrap()
                .draft()
                .unwrap(),
        );
        assert!(draft.redeemers.iter().all(|r| r.budget == DRAFT_BUDGET));
        let built = finish(&w, spend, &Budgets::from_ogmios(&measured(1)).unwrap());
        let tx = assert_spend(&w, std::slice::from_ref(&utxo), &built, both_scripts);
        assert_eq!(
            tx.mint,
            BTreeMap::from([((policy.clone(), name.clone()), -1)])
        );
        let burn = tx
            .redeemers
            .iter()
            .find(|r| r.tag == RedeemerTag::Mint)
            .unwrap();
        assert_eq!(burn.data, PlutusData::BoundedBytes(Vec::new().into()));
        let mut refs = tx.reference_inputs.clone();
        refs.sort();
        let mut want = vec![
            (
                hex::encode(w.chain.config.reference.wallet_reference_utxo),
                1,
            ),
            (
                hex::encode(w.chain.config.reference.seedelf_reference_utxo),
                1,
            ),
        ];
        want.sort();
        assert_eq!(refs, want);
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(tx.outputs[0].address, to);
        assert_eq!(tx.outputs[0].lovelace, 1_749_860 - built.fee.total);
        // About 0.24 ADA, leaving more than either kind of output needs.
        assert!(
            (200_000..300_000).contains(&built.fee.total),
            "{}",
            built.fee.total
        );

        // Back into the Seedelf balance: one owned contract output.
        let spend = build::remove(&w.chain, &utxo, &w.owner, w.signer).unwrap();
        let built = finish(&w, spend, &Budgets::from_ogmios(&measured(1)).unwrap());
        let tx = assert_spend(&w, std::slice::from_ref(&utxo), &built, both_scripts);
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(tx.outputs[0].address, w.wallet);
        assert!(tx.outputs[0].assets.is_empty());
    }

    #[test]
    fn refuses_what_would_lose_money() {
        let w = world();
        let available = [owned(&w, 0x01, 0, 10_000_000, &[("tok", 5)])];
        let err = |to: &Address, lovelace: u64, sent: &Assets| {
            build::sweep(&w.chain, &available, to, lovelace, sent, &w.owner, w.signer)
                .err()
                .expect("an error")
                .to_string()
        };
        let none = Assets::new();

        // Only an address on this network that takes a payment: never a stake
        // address or another network's.
        let stake = Address::from_bech32(
            "stake_test1urj40zgr2gy4788kl54h6x3gu0pukq5lfr8nflufpg5dzas324ywz",
        )
        .unwrap();
        for bad in [&stake, &key_address(Network::Mainnet)] {
            assert!(!build::is_payable_address(bad, true));
            assert!(
                err(bad, 2_000_000, &none).contains("Payments go to an address on preprod"),
                "{bad:?}"
            );
            assert!(build::sweep_all(&w.chain, &available, bad, &w.owner, w.signer).is_err());
        }
        let to = key_address(Network::Testnet);
        assert!(build::is_payable_address(&to, true));
        assert!(build::is_payable_address(&collateral_address(true), true));
        // A key address staked by a script is a key address, and a script's
        // address takes a payment too, as the ledger has it: with no datum,
        // which the wallet warns of (chunk 51, r2a#1; the owner's call of
        // 2026-11-18). The contract's own address is a script's.
        let script: Address = ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Script(ScriptHash::new([9; 28])),
            ShelleyDelegationPart::Null,
        )
        .into();
        let script_stake: Address = ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
            ShelleyDelegationPart::Script(ScriptHash::new([9; 28])),
        )
        .into();
        for payee in [&script_stake, &script, &w.wallet] {
            assert!(build::is_payable_address(payee, true), "{payee:?}");
            build::sweep(
                &w.chain, &available, payee, 2_000_000, &none, &w.owner, w.signer,
            )
            .unwrap_or_else(|e| panic!("{payee:?}: {e}"));
            build::sweep_all(&w.chain, &available, payee, &w.owner, w.signer)
                .unwrap_or_else(|e| panic!("{payee:?}: {e}"));
        }

        // Amounts.
        assert!(err(&to, 500_000, &none).contains("needs at least"));
        assert!(err(&to, 2_000_000, &tokens(&[("tok", 6)])).contains("holds only 5"));
        assert!(err(&to, 2_000_000, &tokens(&[("nope", 1)])).contains("doesn't hold the token"));
        assert!(err(&to, 9_900_000, &none).contains("Not enough ADA"));

        // Removing needs exactly one seedelf.
        let plain = owned(&w, 0x02, 0, 5_000_000, &[]);
        let e = build::remove(&w.chain, &plain, &w.owner, w.signer)
            .err()
            .unwrap();
        assert!(e.to_string().contains("exactly one Seedelf"), "{e}");
        let mut two = seedelf(&w, 0x03, &format!("5eed0e1f{}", "01".repeat(28)));
        let second = two.asset_list.as_ref().unwrap()[0].clone();
        two.asset_list.as_mut().unwrap().push(Asset {
            asset_name: format!("5eed0e1f{}", "02".repeat(28)),
            ..second
        });
        assert!(build::remove(&w.chain, &two, &w.owner, w.signer).is_err());
        // A burn needs the policy's budget.
        let utxo = seedelf(&w, 0x04, &format!("5eed0e1f{}", "03".repeat(28)));
        let spend = build::remove(&w.chain, &utxo, &w.owner, w.signer)
            .unwrap()
            .proven(|r, vkh| create_proof(r.clone(), w.sk, vkh.to_string()))
            .unwrap();
        let e = spend.finalize(&spends_only(1)).err().unwrap();
        assert!(e.to_string().contains("Seedelf policy"), "{e}");
    }

    /// Chunk 51, t1a#10: Max's pick (`max_inputs`, which the web wallet's Max
    /// and payments in parts use) never takes a UTxO the wallet's evaluator
    /// can't take, as selection doesn't: one carrying a reference script,
    /// which anyone can pay a Seedelf, is left out, however large.
    #[test]
    fn max_never_takes_a_utxo_the_wallets_evaluator_cant_take() {
        let w = world();
        let scripted = UtxoResponse {
            reference_script: recorded_script(),
            ..owned(&w, 0x01, 0, 30_000_000, &[])
        };
        let available = [
            scripted,
            owned(&w, 0x02, 0, 4_000_000, &[]),
            owned(&w, 0x03, 0, 3_000_000, &[]),
        ];
        let (taken, left) = build::max_inputs(&available, &Assets::new(), 20).unwrap();
        assert_eq!(outpoints(&taken), outpoints(&available[1..]));
        assert_eq!(left, 1);
    }

    /// Chunk 51, t1a#14: Remove takes a UTxO holding one of one Seedelf, as its
    /// policy mints and burns exactly one: one listing two of a Seedelf (which
    /// no chain holds) is refused, never half burnt.
    #[test]
    fn remove_takes_only_one_of_one_seedelf() {
        let w = world();
        let name = format!("5eed0e1f{}", "05".repeat(28));
        let mut twice = seedelf(&w, 0x05, &name);
        twice.asset_list.as_mut().unwrap()[0].quantity = "2".into();
        let refused =
            build::remove(&w.chain, &twice, &w.owner, w.signer).map(|spend| spend.inputs().len());
        assert!(
            matches!(&refused, Err(e) if e.to_string().contains("exactly one Seedelf")),
            "{refused:?}"
        );
        assert!(build::remove(&w.chain, &seedelf(&w, 0x05, &name), &w.owner, w.signer).is_ok());
    }

    /// Chunk 51, t1a#15: a payment to an address of none of a token is
    /// refused in words: pallas would panic building its output, a trap in
    /// WebAssembly, as the payment to a Seedelf's twin check says.
    #[test]
    fn an_address_payment_of_none_of_a_token_is_refused_in_words() {
        let w = world();
        let available = [owned(&w, 0x01, 0, 10_000_000, &[("tok", 5)])];
        let to = key_address(Network::Testnet);
        let zero = Assets {
            items: vec![Token::new(TOKEN_POLICY.to_string(), hex::encode("tok"), 0).unwrap()],
        };
        let refused = build::sweep(
            &w.chain, &available, &to, 2_000_000, &zero, &w.owner, w.signer,
        )
        .map(|spend| spend.inputs().len());
        assert!(
            matches!(&refused, Err(e) if e.to_string().contains("none of a token")),
            "{refused:?}"
        );
    }

    /// Chunk 51, t1a#17: a burn takes its token from what the spend spends: a
    /// burn of a Seedelf none of its inputs holds is refused, where the node
    /// would refuse its value as unbalanced.
    #[test]
    fn a_burn_of_a_token_the_spend_doesnt_hold_is_refused() {
        let w = world();
        let plain = owned(&w, 0x06, 0, 5_000_000, &[]);
        let name = hex::decode(format!("5eed0e1f{}", "06".repeat(28))).unwrap();
        let refused =
            build::ScriptSpend::new(&w.chain, std::slice::from_ref(&plain), &w.owner, w.signer)
                .unwrap()
                .mint(name, -1, vec![0xd8, 0x79, 0x80])
                .unwrap()
                .estimate()
                .map(|built| built.fee.total);
        assert!(
            matches!(&refused, Err(e) if e.to_string().contains("don't hold the token to burn")),
            "{refused:?}"
        );
    }
}

/// Coin selection keeping histories apart (privacy review §2.3): the cases
/// the privacy review's probe found, and what happens when nothing else pays.
mod apart {
    use super::*;
    use pallas_addresses::{
        Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
    };
    use seedelf_core::assets::Assets;
    use seedelf_core::build::{AddressPayment, Class, Histories, Origin, Payment, Purpose};

    /// About what a box back from Lovejoin brings: 10 ₳ less the withdraw's fee.
    const BOX: u64 = 9_710_000;

    fn class(id: &str, origin: Origin) -> Class {
        Class {
            id: id.into(),
            origin,
        }
    }

    /// `utxos`, each of the class given, for `purpose`.
    fn histories(purpose: Purpose, utxos: &[(&UtxoResponse, Class)]) -> Histories {
        utxos.iter().fold(Histories::new(purpose), |h, (u, c)| {
            h.with(&u.tx_hash, u.tx_index, c.clone())
        })
    }

    /// Each box its own class, as the extension gives them.
    fn boxes(w: &World, first: u8, n: u8) -> Vec<(UtxoResponse, Class)> {
        (0..n)
            .map(|i| {
                let u = owned(w, first + i, 0, BOX, &[]);
                let c = class(&format!("box:{}#0", u.tx_hash), Origin::Lovejoin);
                (u, c)
            })
            .collect()
    }

    /// `boxes`, each one the extension knows is mixed (chunk 51, the owner's answer 4 to B15).
    fn mixed_boxes(w: &World, first: u8, n: u8) -> Vec<(UtxoResponse, Class)> {
        boxes(w, first, n)
            .into_iter()
            .map(|(u, c)| {
                (
                    u,
                    Class {
                        origin: Origin::Mixed,
                        ..c
                    },
                )
            })
            .collect()
    }

    fn key_address() -> Address {
        ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
            ShelleyDelegationPart::Null,
        )
        .into()
    }

    /// A session's funding: `lovelace` and its 5 ₳ collateral, to its one-time account.
    fn funding(lovelace: u64) -> Vec<AddressPayment> {
        [lovelace, 5_000_000]
            .into_iter()
            .map(|lovelace| AddressPayment {
                to: key_address(),
                lovelace,
                tokens: Assets::new(),
            })
            .collect()
    }

    fn someone() -> Payment {
        Payment {
            register: Register::create(random_scalar())
                .unwrap()
                .rerandomize()
                .unwrap(),
            lovelace: 20_000_000,
            tokens: Assets::new(),
        }
    }

    fn outpoints(utxos: &[UtxoResponse]) -> Vec<String> {
        let mut v: Vec<String> = utxos
            .iter()
            .map(|u| format!("{}#{}", u.tx_hash, u.tx_index))
            .collect();
        v.sort();
        v
    }

    fn one(utxo: &UtxoResponse) -> Vec<String> {
        outpoints(std::slice::from_ref(utxo))
    }

    #[test]
    fn two_boxes_are_never_spent_together_while_a_token_bearing_main_utxo_pays() {
        let w = world();
        // After a private token buy: the main UTxO holds the token, and the
        // boxes back from Lovejoin are all ADA.
        let main = owned(&w, 0x01, 0, 894_000_000, &[("tok", 5)]);
        let back = boxes(&w, 0x10, 3);
        let available: Vec<UtxoResponse> = std::iter::once(main.clone())
            .chain(back.iter().map(|(u, _)| u.clone()))
            .collect();
        let pay = [someone()];

        // What the wallet did: three boxes spent together.
        let blind = build::transfer(&w.chain, &available, &pay, &w.owner, w.signer).unwrap();
        assert_eq!(blind.inputs().len(), 3);
        assert!(blind.inputs().iter().all(|u| u.value == BOX.to_string()));

        let mut known = vec![(&main, class("session:0", Origin::Session))];
        known.extend(back.iter().map(|(u, c)| (u, c.clone())));
        let h = histories(Purpose::Pay, &known);
        let spend =
            build::transfer_apart(&w.chain, &available, &h, &pay, &w.owner, w.signer).unwrap();
        assert_eq!(outpoints(&spend.inputs()), one(&main));
        assert!(h.merged(&spend.inputs()).is_empty());

        // A session's funding of 105 ₳ against 12 boxes: the main UTxO alone.
        let back = boxes(&w, 0x20, 12);
        let available: Vec<UtxoResponse> = std::iter::once(main.clone())
            .chain(back.iter().map(|(u, _)| u.clone()))
            .collect();
        let mut known = vec![(&main, class("session:0", Origin::Session))];
        known.extend(back.iter().map(|(u, c)| (u, c.clone())));
        let h = histories(Purpose::Fund { session: None }, &known);
        let spend = build::sweep_many_apart(
            &w.chain,
            &available,
            &h,
            &funding(100_000_000),
            &w.owner,
            w.signer,
        )
        .unwrap();
        assert_eq!(outpoints(&spend.inputs()), outpoints(&[main]));
    }

    #[test]
    fn a_stealth_mint_takes_received_money_before_money_moved_in() {
        let w = world();
        let moved_in = owned(&w, 0x01, 0, 1_000_000_000, &[]);
        let received = owned(&w, 0x02, 0, 20_000_000, &[]);
        let available = [moved_in.clone(), received.clone()];
        let seedelf = w.owner.clone().rerandomize().unwrap();

        // What the wallet did: the largest, the user's own money.
        let blind = build::mint(&w.chain, &available, "", &seedelf, &w.owner, w.signer).unwrap();
        assert_eq!(outpoints(&blind.spend.inputs()), one(&moved_in));

        let h = histories(
            Purpose::Mint,
            &[
                (&moved_in, class("public", Origin::Own)),
                (
                    &received,
                    class(&format!("received:{}", received.tx_hash), Origin::Received),
                ),
            ],
        );
        let minted =
            build::mint_apart(&w.chain, &available, &h, "", &seedelf, &w.owner, w.signer).unwrap();
        assert_eq!(outpoints(&minted.spend.inputs()), outpoints(&[received]));
    }

    /// Chunk 51, gap-g1#1 (b), the owner's B15: a stealth mint takes a box back
    /// from Lovejoin that pays alone before received money, where the wallet
    /// knows it's mixed (the owner's answer 4; any other box goes after
    /// received money). Whoever paid you knows their payment, and a copy of a
    /// Seedelf's datum paid in (about 4 ₳) shows it to everyone; no payer
    /// knows a mixed box, but one who put it in under the wallet's key and
    /// mixed it themselves: nothing tells that box from the wallet's own
    /// (chunk 51, own#3). Received money still comes before money moved in.
    #[test]
    fn a_stealth_mint_takes_a_box_that_pays_alone_before_received_money() {
        let w = world();
        let received = owned(&w, 0x02, 0, 4_000_000, &[]);
        let moved_in = owned(&w, 0x01, 0, 1_000_000_000, &[]);
        let back = mixed_boxes(&w, 0x10, 2);
        let available: Vec<UtxoResponse> = [received.clone(), moved_in.clone()]
            .into_iter()
            .chain(back.iter().map(|(u, _)| u.clone()))
            .collect();
        let mut known = vec![
            (&moved_in, class("public", Origin::Own)),
            (
                &received,
                class(&format!("received:{}", received.tx_hash), Origin::Received),
            ),
        ];
        known.extend(back.iter().map(|(u, c)| (u, c.clone())));
        let seedelf = w.owner.clone().rerandomize().unwrap();
        let h = histories(Purpose::Mint, &known);
        let minted =
            build::mint_apart(&w.chain, &available, &h, "", &seedelf, &w.owner, w.signer).unwrap();
        let spent = minted.spend.inputs();
        assert!(
            back.iter().any(|(b, _)| outpoints(&spent) == one(b)),
            "a stealth mint spent {:?}, not a box alone",
            outpoints(&spent)
        );

        // With no box, received money, as before.
        let without = [received.clone(), moved_in.clone()];
        let minted =
            build::mint_apart(&w.chain, &without, &h, "", &seedelf, &w.owner, w.signer).unwrap();
        assert_eq!(outpoints(&minted.spend.inputs()), one(&received));
    }

    /// What a stealth mint over `known` spends.
    fn minted(w: &World, known: &[(&UtxoResponse, Class)]) -> Vec<String> {
        let available: Vec<UtxoResponse> = known.iter().map(|(u, _)| (*u).clone()).collect();
        let h = histories(Purpose::Mint, known);
        let seedelf = w.owner.clone().rerandomize().unwrap();
        let minted =
            build::mint_apart(&w.chain, &available, &h, "", &seedelf, &w.owner, w.signer).unwrap();
        outpoints(&minted.spend.inputs())
    }

    fn received_class(u: &UtxoResponse) -> Class {
        class(&format!("received:{}", u.tx_hash), Origin::Received)
    }

    /// Chunk 51, the owner's answer 4 to B15 (time#1, still#1): a box back from Lovejoin the wallet doesn't know is
    /// mixed, as every one brought back before that answer, goes after received money for a stealth mint, as before
    /// B15. It may be a box its deposit still ties to whatever paid for it.
    #[test]
    fn a_box_not_recorded_as_mixed_goes_after_received_money() {
        let w = world();
        let received = owned(&w, 0x02, 0, 20_000_000, &[]);
        let moved_in = owned(&w, 0x01, 0, 1_000_000_000, &[]);
        let old = boxes(&w, 0x10, 1).remove(0);
        let known = [
            (&moved_in, class("public:0", Origin::Own)),
            (&received, received_class(&received)),
            (&old.0, old.1.clone()),
        ];
        assert_eq!(minted(&w, &known), one(&received));
        // A box it knows is mixed goes first, though larger than the payment.
        let mixed = owned(&w, 0x20, 0, 30_000_000, &[]);
        let mut known = known.to_vec();
        known.push((
            &mixed,
            class(&format!("box:{}", mixed.tx_hash), Origin::Mixed),
        ));
        assert_eq!(minted(&w, &known), one(&mixed));
    }

    /// Chunk 51, still#1, own#4, money#3: a box the wallet's own private session deposited, brought back before a mix
    /// moved it, is that session's money (`box:<tx>+session:<n>`): anyone can follow it from the deposit to the session
    /// and its funding. A stealth mint takes received money that pays alone before it.
    #[test]
    fn a_box_its_own_session_deposited_goes_after_received_money() {
        let w = world();
        let received = owned(&w, 0x02, 0, 20_000_000, &[]);
        let moved_in = owned(&w, 0x01, 0, 1_000_000_000, &[]);
        let unmixed = owned(&w, 0x10, 0, BOX, &[]);
        let known = [
            (&moved_in, class("public:0", Origin::Own)),
            (&received, received_class(&received)),
            (
                &unmixed,
                class(
                    &format!("box:{}+session:0", unmixed.tx_hash),
                    Origin::Session,
                ),
            ),
        ];
        assert_eq!(minted(&w, &known), one(&received));
    }

    /// Chunk 51, money#2, own#1, the owner's answer 2 to B15: what a stealth mint left is tied in public to that mint,
    /// so the next stealth mint takes received money that pays alone before it. The worker seals that change with its
    /// inputs' history and a part naming the mint (`change:<tx>`, a session's money to selection). Sealed with its
    /// inputs' history alone, as before that answer, a box-paid mint's change ranked as a box.
    #[test]
    fn a_second_stealth_mint_takes_received_money_before_the_first_ones_change() {
        let w = world();
        let change = owned(&w, 0x0c, 1, 7_600_000, &[]);
        let received = owned(&w, 0x02, 0, 50_000_000, &[]);
        let first = hex::encode([0x0c; 32]);
        // As the worker reads it since chunk 51's round three: an earlier spend's change (l2rank#6).
        let tied = class(
            &format!("box:{}+change:{first}", hex::encode([0x0b; 32])),
            Origin::Change,
        );
        let mixed = owned(&w, 0x20, 0, 30_000_000, &[]);
        assert_eq!(
            minted(
                &w,
                &[
                    (&change, tied.clone()),
                    (
                        &mixed,
                        class(&format!("box:{}", mixed.tx_hash), Origin::Mixed)
                    )
                ]
            ),
            one(&mixed),
            "a box a mix moved goes before an earlier spend's change, however larger"
        );
        assert_eq!(
            minted(
                &w,
                &[(&change, tied), (&received, received_class(&received))]
            ),
            one(&received)
        );
        // Sealed as a box-paid mint's change was before: a box's history alone.
        let untied = class(
            &format!("box:{}", hex::encode([0x0b; 32])),
            Origin::Lovejoin,
        );
        assert_eq!(
            minted(
                &w,
                &[(&change, untied), (&received, received_class(&received))]
            ),
            one(&received)
        );
    }

    /// Chunk 51, money#1, own#2, l2rank#4: a stranger's copy (d = 1) of a Seedelf minted from a box back from Lovejoin
    /// takes that Seedelf's history less the box, its own Unknown in the box's place, or Unknown alone where that
    /// history is a box's. Either way the next stealth mint takes the boxes before it, however small the copy.
    #[test]
    fn a_copy_of_a_box_paid_seedelfs_register_goes_after_the_boxes() {
        let w = world();
        let copy = owned(&w, 0xc0, 0, 4_000_000, &[]);
        let genuine = mixed_boxes(&w, 0x10, 2);
        let seedelf_tx = hex::encode([0x5e; 32]);
        for copied in [
            class(&format!("unknown:{}", copy.tx_hash), Origin::Unknown),
            class(
                &format!("change:{seedelf_tx}+unknown:{}", copy.tx_hash),
                Origin::Change,
            ),
            // As round two read it, the box kept.
            class(
                &format!("box:{}+change:{seedelf_tx}", hex::encode([0xb1; 32])),
                Origin::Session,
            ),
            // As a Seedelf minted before the answer reads: its box's history alone.
            class(
                &format!("box:{}", hex::encode([0xb1; 32])),
                Origin::Lovejoin,
            ),
        ] {
            let mut known = vec![(&copy, copied.clone())];
            known.extend(genuine.iter().map(|(u, c)| (u, c.clone())));
            let spent = minted(&w, &known);
            assert!(
                genuine.iter().any(|(b, _)| spent == one(b)),
                "a stealth mint spent {spent:?} with the copy classed {copied:?}"
            );
        }
    }

    /// Chunk 51, the owner's answer 2 to B15: a Make public to one of the user's own public accounts ties its change to
    /// that account in the open, so its change is money made private from it, which a funding takes after received
    /// money.
    #[test]
    fn a_funding_takes_received_money_before_a_make_publics_change() {
        let w = world();
        let change = owned(&w, 0x0d, 1, 40_000_000, &[]);
        let received = owned(&w, 0x02, 0, 50_000_000, &[]);
        let available = [change.clone(), received.clone()];
        let h = histories(
            Purpose::Fund {
                session: Some("session:3".into()),
            },
            &[
                (
                    &change,
                    class(
                        &format!("public:0+received:{}", hex::encode([0x0e; 32])),
                        Origin::Own,
                    ),
                ),
                (&received, received_class(&received)),
            ],
        );
        let spend = build::sweep_many_apart(
            &w.chain,
            &available,
            &h,
            &funding(30_000_000),
            &w.owner,
            w.signer,
        )
        .unwrap();
        assert_eq!(outpoints(&spend.inputs()), one(&received));
    }

    #[test]
    fn a_funding_takes_received_money_and_leaves_another_sessions_change() {
        let w = world();
        let moved_in = owned(&w, 0x01, 0, 1_000_000_000, &[]);
        let change = owned(&w, 0x02, 0, 300_000_000, &[]);
        let received = owned(&w, 0x03, 0, 120_000_000, &[]);
        let available = [moved_in.clone(), change.clone(), received.clone()];
        let of = [
            (&moved_in, class("public", Origin::Own)),
            (&change, class("public+session:1", Origin::Session)),
            (
                &received,
                class(&format!("received:{}", received.tx_hash), Origin::Received),
            ),
        ];
        let fund = |h: &Histories, available: &[UtxoResponse]| {
            let spend = build::sweep_many_apart(
                &w.chain,
                available,
                h,
                &funding(100_000_000),
                &w.owner,
                w.signer,
            )
            .unwrap();
            outpoints(&spend.inputs())
        };

        // What the wallet did: the largest, the move-in, one hop from the public account.
        assert_eq!(fund(&Histories::default(), &available), one(&moved_in));
        // Now the received payment, which pays alone.
        let new_session = Purpose::Fund {
            session: Some("session:2".into()),
        };
        assert_eq!(
            fund(&histories(new_session.clone(), &of), &available),
            one(&received)
        );
        // Without it: the user's own money, never session 1's change.
        let without = [moved_in.clone(), change.clone()];
        assert_eq!(fund(&histories(new_session, &of), &without), one(&moved_in));
        // Session 1's own top-up takes what its funding left first: that ties nothing new.
        let top_up = Purpose::Fund {
            session: Some("session:1".into()),
        };
        assert_eq!(
            fund(&histories(top_up, &of), &available),
            outpoints(&[change])
        );
    }

    /// What a new private session's funding of `lovelace` and its 5 ₳ collateral over `known` spends.
    fn funded(w: &World, known: &[(&UtxoResponse, Class)], lovelace: u64) -> Vec<String> {
        let available: Vec<UtxoResponse> = known.iter().map(|(u, _)| (*u).clone()).collect();
        let h = histories(
            Purpose::Fund {
                session: Some("session:7".into()),
            },
            known,
        );
        let spend = build::sweep_many_apart(
            &w.chain,
            &available,
            &h,
            &funding(lovelace),
            &w.owner,
            w.signer,
        )
        .unwrap();
        outpoints(&spend.inputs())
    }

    /// Chunk 51, l2rank#6, the owner's answer of 2026-11-18 ("earlier change first"): nothing fresher paying (no box a
    /// mix moved, no money others paid), a stealth mint, a pool's start and a funding take an earlier private spend's
    /// change, which ties the new Seedelf or session to that spend, before money made private, which ties it to the
    /// public account. The worker reads such change `change` (Origin::Change). Change whose history names a public
    /// account or a session reads as a session's, and stays after that money: never the smaller one taken first, its
    /// spend's tie on top of the account's.
    #[test]
    fn an_earlier_spends_change_goes_before_money_made_private() {
        let w = world();
        let moved_in = owned(&w, 0x01, 0, 50_000_000, &[]);
        let change = owned(&w, 0x0c, 1, 40_000_000, &[]);
        let first = hex::encode([0x0c; 32]);
        let made_private = class("public:0", Origin::Own);
        for (paid_by, tied) in [
            (
                "a box a mix moved",
                class(
                    &format!("box:{}+change:{first}", hex::encode([0x0b; 32])),
                    Origin::Change,
                ),
            ),
            (
                "Bob's payment",
                class(
                    &format!("change:{first}+received:{}", hex::encode([0xb0; 32])),
                    Origin::Change,
                ),
            ),
            (
                "money of no history",
                class(&format!("change:{first}+unknown"), Origin::Change),
            ),
        ] {
            let known = [(&moved_in, made_private.clone()), (&change, tied)];
            assert_eq!(
                minted(&w, &known),
                one(&change),
                "a stealth mint, the first spend paid by {paid_by}"
            );
            assert_eq!(
                funded(&w, &known, 30_000_000),
                one(&change),
                "a funding, the first spend paid by {paid_by}"
            );
        }
        for named in [
            class(&format!("change:{first}+public:0"), Origin::Session),
            class(&format!("change:{first}+session:1"), Origin::Session),
        ] {
            let known = [(&moved_in, made_private.clone()), (&change, named.clone())];
            assert_eq!(
                minted(&w, &known),
                one(&moved_in),
                "a stealth mint, {named:?}"
            );
            assert_eq!(
                funded(&w, &known, 30_000_000),
                one(&moved_in),
                "a funding, {named:?}"
            );
        }
    }

    /// Chunk 51, l2rank#6: merging for a funding too, an earlier spend's change comes before money made private: it
    /// takes the change and one account's money, never two accounts' together.
    #[test]
    fn a_funding_merges_an_earlier_spends_change_before_money_made_private() {
        let w = world();
        let change = owned(&w, 0x0c, 1, 30_000_000, &[]);
        let first_account = owned(&w, 0x01, 0, 30_000_000, &[]);
        let second_account = owned(&w, 0x02, 0, 30_000_000, &[]);
        let tied = class(
            &format!(
                "change:{}+received:{}",
                hex::encode([0x0c; 32]),
                hex::encode([0xb0; 32])
            ),
            Origin::Change,
        );
        let known = [
            (&change, tied),
            (&first_account, class("public:0", Origin::Own)),
            (&second_account, class("public:1", Origin::Own)),
        ];
        let spent = funded(&w, &known, 45_000_000);
        assert_eq!(spent.len(), 2, "{spent:?}");
        assert!(
            spent.contains(&format!("{}#1", change.tx_hash)),
            "the funding spent {spent:?}, two accounts' money, not the change"
        );
    }

    /// Chunk 51, round three's rule 1 (l2rank#1, l2time#1, l2time#3, l2still#1): the web wallet's way back of a box
    /// whose making it can't place, `box:<w>+unknown:<w>`, reads as a box it doesn't know is mixed: a stealth mint and
    /// a funding take money others paid before it, and selection still takes it last, one at a time.
    #[test]
    fn a_box_of_unknown_making_goes_after_money_others_paid_and_stays_a_box() {
        let w = world();
        let received = owned(&w, 0x02, 0, 40_000_000, &[]);
        let unplaced: Vec<(UtxoResponse, Class)> = (0..2u8)
            .map(|i| {
                let u = owned(&w, 0x30 + i, 0, BOX, &[]);
                let c = class(&format!("box:{0}+unknown:{0}", u.tx_hash), Origin::Lovejoin);
                (u, c)
            })
            .collect();
        let mut known = vec![(&received, received_class(&received))];
        known.extend(unplaced.iter().map(|(u, c)| (u, c.clone())));
        assert_eq!(minted(&w, &known), one(&received));
        assert_eq!(funded(&w, &known, 30_000_000), one(&received));
        // With money of the user's own that a box tops up: one box, not two.
        let mine = owned(&w, 0x01, 0, 8_000_000, &[]);
        let mut known: Vec<(&UtxoResponse, Class)> =
            unplaced.iter().map(|(u, c)| (u, c.clone())).collect();
        known.push((&mine, class("public:0", Origin::Own)));
        let available: Vec<UtxoResponse> = known.iter().map(|(u, _)| (*u).clone()).collect();
        let h = histories(Purpose::Pay, &known);
        let pay = [AddressPayment {
            to: key_address(),
            lovelace: 15_000_000,
            tokens: Assets::new(),
        }];
        let spent = build::sweep_many_apart(&w.chain, &available, &h, &pay, &w.owner, w.signer)
            .unwrap()
            .inputs();
        assert_eq!(spent.len(), 2);
        assert!(outpoints(&spent).contains(&format!("{}#0", mine.tx_hash)));
    }

    #[test]
    fn inputs_of_one_history_go_together_before_two_histories_do() {
        let w = world();
        let own = [
            owned(&w, 0x01, 0, 30_000_000, &[]),
            owned(&w, 0x02, 0, 30_000_000, &[]),
        ];
        let received = owned(&w, 0x03, 0, 40_000_000, &[]);
        let available = [own[0].clone(), own[1].clone(), received.clone()];
        let to = key_address();
        let pay = [AddressPayment {
            to,
            lovelace: 50_000_000,
            tokens: Assets::new(),
        }];
        // What the wallet did: the two largest, merging the two histories.
        let blind = build::sweep_many(&w.chain, &available, &pay, &w.owner, w.signer).unwrap();
        assert!(outpoints(&blind.inputs()).contains(&format!("{}#0", received.tx_hash)));

        let h = histories(
            Purpose::Pay,
            &[
                (&own[0], class("public", Origin::Own)),
                (&own[1], class("public", Origin::Own)),
                (&received, class("received:x", Origin::Received)),
            ],
        );
        let spend =
            build::sweep_many_apart(&w.chain, &available, &h, &pay, &w.owner, w.signer).unwrap();
        assert_eq!(outpoints(&spend.inputs()), outpoints(&own));
        assert!(h.merged(&spend.inputs()).is_empty());
    }

    #[test]
    fn when_nothing_else_pays_it_merges_and_says_what() {
        let w = world();
        let back = boxes(&w, 0x10, 4);
        let available: Vec<UtxoResponse> = back.iter().map(|(u, _)| u.clone()).collect();
        let known: Vec<(&UtxoResponse, Class)> = back.iter().map(|(u, c)| (u, c.clone())).collect();
        let h = histories(Purpose::Pay, &known);
        // 15 ₳ from boxes alone: two of them, never refused, and no more than two.
        let pay = [AddressPayment {
            to: key_address(),
            lovelace: 15_000_000,
            tokens: Assets::new(),
        }];
        let spend =
            build::sweep_many_apart(&w.chain, &available, &h, &pay, &w.owner, w.signer).unwrap();
        assert_eq!(spend.inputs().len(), 2);
        let merged = h.merged(&spend.inputs());
        assert_eq!(merged.len(), 2);
        assert!(merged.iter().all(|c| c.origin == Origin::Lovejoin));

        // With some money of the user's own, a box joins it: one box, not two.
        let mine = owned(&w, 0x01, 0, 8_000_000, &[]);
        let mut known = known.clone();
        known.push((&mine, class("public", Origin::Own)));
        let h = histories(Purpose::Pay, &known);
        let available: Vec<UtxoResponse> = std::iter::once(mine.clone()).chain(available).collect();
        let spend =
            build::sweep_many_apart(&w.chain, &available, &h, &pay, &w.owner, w.signer).unwrap();
        let spent = spend.inputs();
        assert_eq!(spent.len(), 2);
        assert!(outpoints(&spent).contains(&format!("{}#0", mine.tx_hash)));
        assert_eq!(h.merged(&spent).len(), 2);

        // More than everything can pay is still "not enough".
        let pay = [AddressPayment {
            to: key_address(),
            lovelace: 100_000_000,
            tokens: Assets::new(),
        }];
        let e = build::sweep_many_apart(&w.chain, &available, &h, &pay, &w.owner, w.signer)
            .err()
            .unwrap();
        assert!(e.to_string().contains("Not enough ADA"), "{e}");
    }

    /// The two ways back of chunk 51's l3rank#3: W, a box's whose making the wallet can't place (`box:<w>+unknown:<w>`,
    /// origin lovejoin, what the extension seals for a box someone else put in under Seedelf S1's register as found,
    /// d = 1, brought back by Bring every box back now), and X, a box's it knows is mixed (`box:<x>`, origin mixed).
    /// One of them is `less` lovelace smaller than the other: what two withdraws' fees differ by.
    fn unplaced_and_mixed(
        w: &World,
        unplaced_smaller: bool,
        less: u64,
    ) -> [(UtxoResponse, Class); 2] {
        let (unplaced_lovelace, mixed_lovelace) = if unplaced_smaller {
            (BOX - less, BOX)
        } else {
            (BOX, BOX - less)
        };
        let unplaced = owned(w, 0x30, 0, unplaced_lovelace, &[]);
        let mixed = owned(w, 0x40, 0, mixed_lovelace, &[]);
        let unplaced_class = class(
            &format!("box:{0}+unknown:{0}", unplaced.tx_hash),
            Origin::Lovejoin,
        );
        let mixed_class = class(&format!("box:{}", mixed.tx_hash), Origin::Mixed);
        [(unplaced, unplaced_class), (mixed, mixed_class)]
    }

    /// Chunk 51, round three's last look, l3rank#3: a funding, a top-up, a Send and a Make public that one box pays
    /// ranked a box a mix moved level with a box of unknown making, and took the smaller, so a few hundred lovelace of
    /// withdraw fee decided whether they spent a planted box's way back, which ties the spend to S1 for anyone who
    /// reads its name, or the mixed one, which ties it to nothing. They take the mixed one first, whatever the sizes.
    #[test]
    fn one_box_paying_takes_a_mixed_box_before_one_of_unknown_making_whatever_the_sizes() {
        let w = world();
        let seedelf = Payment {
            register: Register::create(random_scalar())
                .unwrap()
                .rerandomize()
                .unwrap(),
            lovelace: 3_000_000,
            tokens: Assets::new(),
        };
        let to_address = |lovelace: u64| {
            vec![AddressPayment {
                to: key_address(),
                lovelace,
                tokens: Assets::new(),
            }]
        };
        let spends = [
            (
                "a new session's funding of 2 ₳ and its 5 ₳ collateral",
                Purpose::Fund {
                    session: Some("session:7".into()),
                },
                funding(2_000_000),
            ),
            (
                "a site's top-up of 2 ₳",
                Purpose::Fund {
                    session: Some("session:3".into()),
                },
                to_address(2_000_000),
            ),
            ("a Make public of 3 ₳", Purpose::Pay, to_address(3_000_000)),
            ("a Send of 3 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
        ];
        for (name, purpose, pay) in spends {
            for unplaced_smaller in [true, false] {
                let [(unplaced, unplaced_class), (mixed, mixed_class)] =
                    unplaced_and_mixed(&w, unplaced_smaller, 300);
                let known = [(&unplaced, unplaced_class), (&mixed, mixed_class)];
                let available = [unplaced.clone(), mixed.clone()];
                let h = histories(purpose.clone(), &known);
                let inputs = if pay.is_empty() {
                    build::transfer_apart(
                        &w.chain,
                        &available,
                        &h,
                        std::slice::from_ref(&seedelf),
                        &w.owner,
                        w.signer,
                    )
                    .unwrap()
                    .inputs()
                } else {
                    build::sweep_many_apart(&w.chain, &available, &h, &pay, &w.owner, w.signer)
                        .unwrap()
                        .inputs()
                };
                assert_eq!(
                    outpoints(&inputs),
                    one(&mixed),
                    "{name}, the box of unknown making smaller: {unplaced_smaller}; ranks: unknown making {}, mixed {}",
                    h.rank_of(&unplaced),
                    h.rank_of(&mixed),
                );
            }
        }
    }

    /// A pin beside l3rank#3: a stealth mint took the box a mix moved first already, whatever the sizes.
    #[test]
    fn a_stealth_mint_takes_a_mixed_box_before_one_of_unknown_making_whatever_the_sizes() {
        let w = world();
        for unplaced_smaller in [true, false] {
            let [(unplaced, unplaced_class), (mixed, mixed_class)] =
                unplaced_and_mixed(&w, unplaced_smaller, 300);
            let known = [(&unplaced, unplaced_class), (&mixed, mixed_class)];
            assert_eq!(
                minted(&w, &known),
                one(&mixed),
                "the box of unknown making smaller: {unplaced_smaller}"
            );
        }
    }

    /// What a Send of `seedelf` (`pay` empty) or a payment of `pay` over `known` spends, for `purpose`.
    fn spent_by(
        w: &World,
        purpose: Purpose,
        known: &[(&UtxoResponse, Class)],
        seedelf: &Payment,
        pay: &[AddressPayment],
    ) -> Vec<UtxoResponse> {
        let available: Vec<UtxoResponse> = known.iter().map(|(u, _)| (*u).clone()).collect();
        let h = histories(purpose, known);
        if pay.is_empty() {
            build::transfer_apart(
                &w.chain,
                &available,
                &h,
                std::slice::from_ref(seedelf),
                &w.owner,
                w.signer,
            )
            .unwrap()
            .inputs()
        } else {
            build::sweep_many_apart(&w.chain, &available, &h, pay, &w.owner, w.signer)
                .unwrap()
                .inputs()
        }
    }

    fn paying(lovelace: u64) -> Payment {
        Payment {
            register: Register::create(random_scalar())
                .unwrap()
                .rerandomize()
                .unwrap(),
            lovelace,
            tokens: Assets::new(),
        }
    }

    fn to_address(lovelace: u64) -> Vec<AddressPayment> {
        vec![AddressPayment {
            to: key_address(),
            lovelace,
            tokens: Assets::new(),
        }]
    }

    /// Chunk 51, l4code#1: round four ranked a box a mix moved before any other box when merging too, so a funding or a
    /// Send that had to merge boxes took every mixed one before a larger box of another kind: four boxes where two pay,
    /// each one more history merged and more fee. Merging spends as few boxes as pay, the largest first, and among
    /// choices of as many, one with a box a mix moved. Four mixed ways back of 4.71 ₳ and two plain ones of 9.71 ₳
    /// (1.9.1's, of the classic pool's 10 ₳ boxes): 15 ₳ out spends the two plain ones, the only two that pay; 12 ₳
    /// out a plain one and a mixed one.
    #[test]
    fn a_merge_spends_as_few_boxes_as_pay_a_mixed_one_first_among_as_many() {
        const SMALL: u64 = 4_710_000;
        let w = world();
        let mixed: Vec<(UtxoResponse, Class)> = (0..4u8)
            .map(|i| {
                let u = owned(&w, 0x50 + i, 0, SMALL, &[]);
                let c = class(&format!("box:{}", u.tx_hash), Origin::Mixed);
                (u, c)
            })
            .collect();
        let plain: Vec<(UtxoResponse, Class)> = (0..2u8)
            .map(|i| {
                let u = owned(&w, 0x60 + i, 0, BOX, &[]);
                let c = class(&format!("box:{}", u.tx_hash), Origin::Lovejoin);
                (u, c)
            })
            .collect();
        let known: Vec<(&UtxoResponse, Class)> = mixed
            .iter()
            .chain(&plain)
            .map(|(u, c)| (u, c.clone()))
            .collect();
        let seedelf = paying(12_000_000);
        // Each spend, and how many of the two boxes it spends are mixed.
        let spends = [
            (
                "a new session's funding of 10 ₳ and its 5 ₳ collateral",
                Purpose::Fund {
                    session: Some("session:7".into()),
                },
                funding(10_000_000),
                0,
            ),
            (
                "a site's top-up of 15 ₳",
                Purpose::Fund {
                    session: Some("session:3".into()),
                },
                to_address(15_000_000),
                0,
            ),
            (
                "a Make public of 12 ₳",
                Purpose::Pay,
                to_address(12_000_000),
                1,
            ),
            ("a Send of 12 ₳ to a Seedelf", Purpose::Pay, Vec::new(), 1),
        ];
        let mut wrong = Vec::new();
        for (name, purpose, pay, of_mixed) in spends {
            let spent = spent_by(&w, purpose, &known, &seedelf, &pay);
            let mixed_in = spent
                .iter()
                .filter(|u| u.value == SMALL.to_string())
                .count();
            let line = format!("{name}: {} boxes, {mixed_in} of them mixed", spent.len());
            println!("{line}");
            if (spent.len(), mixed_in) != (2, of_mixed) {
                wrong.push(line);
            }
        }
        assert!(
            wrong.is_empty(),
            "not as few boxes as pay, a mixed one among them where it pays:\n{}",
            wrong.join("\n")
        );
    }

    /// Beside l4code#1, a pin: at the same count, a merge takes the boxes a mix moved, never two plain ones a few
    /// hundred lovelace larger. Chunk 51, l5still#6: it pitted the mixed boxes against two of unknown making, which go
    /// after them by that alone, so it passed with the same-count choice taken out; plain ones (1.9.1's ways back,
    /// `box:<tx>`, origin lovejoin) come first by size, so only that choice puts the mixed ones first.
    #[test]
    fn at_the_same_count_a_merge_takes_mixed_boxes_first() {
        let w = world();
        let mixed: Vec<(UtxoResponse, Class)> = (0..2u8)
            .map(|i| {
                let u = owned(&w, 0x50 + i, 0, 4_709_700, &[]);
                let c = class(&format!("box:{}", u.tx_hash), Origin::Mixed);
                (u, c)
            })
            .collect();
        let plain: Vec<(UtxoResponse, Class)> = (0..2u8)
            .map(|i| {
                let u = owned(&w, 0x60 + i, 0, 4_710_000, &[]);
                let c = class(&format!("box:{}", u.tx_hash), Origin::Lovejoin);
                (u, c)
            })
            .collect();
        let known: Vec<(&UtxoResponse, Class)> = mixed
            .iter()
            .chain(&plain)
            .map(|(u, c)| (u, c.clone()))
            .collect();
        let both_mixed = outpoints(&[mixed[0].0.clone(), mixed[1].0.clone()]);
        let seedelf = paying(6_000_000);
        for (name, purpose, pay) in [
            (
                "a new session's funding of 1 ₳ and its 5 ₳ collateral",
                Purpose::Fund {
                    session: Some("session:7".into()),
                },
                funding(1_000_000),
            ),
            ("a Make public of 6 ₳", Purpose::Pay, to_address(6_000_000)),
            ("a Send of 6 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
        ] {
            let spent = spent_by(&w, purpose, &known, &seedelf, &pay);
            assert_eq!(outpoints(&spent), both_mixed, "{name}");
        }
    }

    /// Chunk 51, the lead's call on l4code#1, as round six's box rule has it (l7words#9): a box of unknown making
    /// (`box:<w>+unknown:<w>`, a planted box's way back among them) is merged only where the other boxes can't pay
    /// without it, and then with as few others as pay, one a mix moved first (l5still#4's choice: round five took every
    /// other box too, though W went either way). Two boxes whose making the wallet knows, of 4.71 ₳ (mixed or plain),
    /// and W of 9.71 ₳: 12 ₳ out takes W and one other, the mixed one where there is one; 7 ₳ out, which the two pay,
    /// never takes W.
    #[test]
    fn a_box_of_unknown_making_is_merged_only_where_the_others_cant_pay_and_then_beside_as_few_as_pay()
     {
        let w = world();
        let unplaced = owned(&w, 0x30, 0, BOX, &[]);
        let unplaced_class = class(
            &format!("box:{0}+unknown:{0}", unplaced.tx_hash),
            Origin::Lovejoin,
        );
        let mut wrong = Vec::new();
        for others_mixed in [[false, false], [true, false], [true, true]] {
            let others: Vec<(UtxoResponse, Class)> = others_mixed
                .iter()
                .zip(0u8..)
                .map(|(&mixed, i)| {
                    let u = owned(&w, 0x40 + i, 0, 4_710_000, &[]);
                    let origin = if mixed {
                        Origin::Mixed
                    } else {
                        Origin::Lovejoin
                    };
                    (u.clone(), class(&format!("box:{}", u.tx_hash), origin))
                })
                .collect();
            // Beside W, one other, a mixed one where there is one.
            let beside_w = |spent: &[String]| {
                spent.len() == 2
                    && spent.contains(&one(&unplaced)[0])
                    && (!others_mixed.contains(&true)
                        || others
                            .iter()
                            .zip(others_mixed)
                            .any(|((u, _), mixed)| mixed && spent.contains(&one(u)[0])))
            };
            let both = outpoints(&[others[0].0.clone(), others[1].0.clone()]);
            // W2, of unknown making too but smaller (4 ₳), where the two pay 6 ₳ out without it: never merged.
            let smaller = owned(&w, 0x31, 0, 4_000_000, &[]);
            let smaller_class = class(
                &format!("box:{0}+unknown:{0}", smaller.tx_hash),
                Origin::Lovejoin,
            );
            for (name, purpose, pay, seedelf, with_w) in [
                (
                    "a new session's funding of 7 ₳ and its 5 ₳ collateral",
                    Purpose::Fund {
                        session: Some("session:7".into()),
                    },
                    funding(7_000_000),
                    paying(12_000_000),
                    true,
                ),
                (
                    "a Make public of 12 ₳",
                    Purpose::Pay,
                    to_address(12_000_000),
                    paying(12_000_000),
                    true,
                ),
                (
                    "a Send of 12 ₳ to a Seedelf",
                    Purpose::Pay,
                    Vec::new(),
                    paying(12_000_000),
                    true,
                ),
                (
                    "a new session's funding of 1 ₳ and its 5 ₳ collateral",
                    Purpose::Fund {
                        session: Some("session:7".into()),
                    },
                    funding(1_000_000),
                    paying(6_000_000),
                    false,
                ),
                (
                    "a Make public of 6 ₳",
                    Purpose::Pay,
                    to_address(6_000_000),
                    paying(6_000_000),
                    false,
                ),
                (
                    "a Send of 6 ₳ to a Seedelf",
                    Purpose::Pay,
                    Vec::new(),
                    paying(6_000_000),
                    false,
                ),
            ] {
                let mut known: Vec<(&UtxoResponse, Class)> =
                    others.iter().map(|(u, c)| (u, c.clone())).collect();
                if with_w {
                    known.push((&unplaced, unplaced_class.clone()));
                } else {
                    known.push((&smaller, smaller_class.clone()));
                }
                let spent = outpoints(&spent_by(&w, purpose, &known, &seedelf, &pay));
                let line = format!("{name}, the others mixed: {others_mixed:?}: spent {spent:?}");
                println!("{line}");
                if !(if with_w {
                    beside_w(&spent)
                } else {
                    spent == both
                }) {
                    wrong.push(line);
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a box of unknown making merged where the others pay without it, or beside more boxes than pay:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l4docs#3: past what one transaction spends of the small UTxOs, merge order c (as few boxes as pay)
    /// brought forward the largest box, whatever made it. It takes a box a mix moved before one of unknown making there
    /// too. 25 UTxOs of 1.5 ₳ made private, and X (mixed) and W (unknown making) 300 lovelace apart, each way round.
    #[test]
    fn past_one_transactions_small_utxos_a_payment_takes_a_mixed_box_before_one_of_unknown_making()
    {
        let w = world();
        const SMALL: u64 = 1_500_000;
        let least = wallet_minimum_lovelace_with_assets(&w.chain.params, Assets::new()).unwrap();
        assert!(
            SMALL >= least,
            "a small UTxO holds at least a Seedelf UTxO's least, {least}"
        );
        let small: Vec<UtxoResponse> = (0..25u64).map(|i| owned(&w, 0x50, i, SMALL, &[])).collect();
        let seedelf = paying(34_000_000);
        let send_from = |inputs: &[UtxoResponse]| {
            build::transfer_from(
                &w.chain,
                inputs,
                std::slice::from_ref(&seedelf),
                &w.owner,
                w.signer,
            )
            .and_then(|s| s.estimate())
            .map(|_| ())
        };
        // Why orders a and b fail: 22 small can't pay 34 ₳, and 23 are more than one transaction spends.
        assert!(build::is_short(&send_from(&small[..22]).unwrap_err()));
        assert!(build::is_too_many(&send_from(&small[..23]).unwrap_err()));
        let mut wrong = Vec::new();
        for unplaced_smaller in [true, false] {
            let [(unplaced, unplaced_class), (mixed, mixed_class)] =
                unplaced_and_mixed(&w, unplaced_smaller, 300);
            let mut known: Vec<(&UtxoResponse, Class)> = small
                .iter()
                .map(|u| (u, class("public:0", Origin::Own)))
                .collect();
            known.push((&unplaced, unplaced_class));
            known.push((&mixed, mixed_class));
            for (name, purpose, pay) in [
                ("a Send of 34 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
                (
                    "a Make public of 34 ₳",
                    Purpose::Pay,
                    to_address(34_000_000),
                ),
                (
                    "a new session's funding of 29 ₳ and its 5 ₳ collateral",
                    Purpose::Fund {
                        session: Some("session:7".into()),
                    },
                    funding(29_000_000),
                ),
            ] {
                let spent = outpoints(&spent_by(&w, purpose, &known, &seedelf, &pay));
                let (u, x) = (&one(&unplaced)[0], &one(&mixed)[0]);
                let line = format!(
                    "{name}, W smaller: {unplaced_smaller}: {} inputs, spent W: {}, spent X: {}",
                    spent.len(),
                    spent.contains(u),
                    spent.contains(x)
                );
                println!("{line}");
                if spent.contains(u) || !spent.contains(x) {
                    wrong.push(line);
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a box of unknown making went before a mixed one:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l4still#2: the same where the money others paid is many small UTxOs, so orders a and b run into what
    /// one transaction spends: 25 received payments of 2 ₳, and X and W 300 lovelace apart, each way round.
    #[test]
    fn past_the_input_limit_a_mixed_box_still_goes_before_one_of_unknown_making() {
        let w = world();
        let received: Vec<(UtxoResponse, Class)> = (0..25u8)
            .map(|i| {
                let u = owned(&w, 0x50 + i, 0, 2_000_000, &[]);
                let c = received_class(&u);
                (u, c)
            })
            .collect();
        let seedelf = paying(43_000_000);
        let spends = [
            ("a Send of 43 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
            (
                "a Make public of 43 ₳",
                Purpose::Pay,
                to_address(43_000_000),
            ),
            (
                "a new session's funding of 38 ₳ and its 5 ₳ collateral",
                Purpose::Fund {
                    session: Some("session:7".into()),
                },
                funding(38_000_000),
            ),
        ];
        let mut wrong = Vec::new();
        for (name, purpose, pay) in &spends {
            // The premise: the money others paid, alone, can't pay within one transaction's limit.
            let only: Vec<(&UtxoResponse, Class)> =
                received.iter().map(|(u, c)| (u, c.clone())).collect();
            let available: Vec<UtxoResponse> = only.iter().map(|(u, _)| (*u).clone()).collect();
            let h = histories(purpose.clone(), &only);
            let e = if pay.is_empty() {
                build::transfer_apart(
                    &w.chain,
                    &available,
                    &h,
                    std::slice::from_ref(&seedelf),
                    &w.owner,
                    w.signer,
                )
                .err()
            } else {
                build::sweep_many_apart(&w.chain, &available, &h, pay, &w.owner, w.signer).err()
            }
            .unwrap_or_else(|| panic!("{name}: the received money alone pays"));
            assert!(build::is_too_many(&e), "{name}: {e}");
            for unplaced_smaller in [true, false] {
                let [(unplaced, unplaced_class), (mixed, mixed_class)] =
                    unplaced_and_mixed(&w, unplaced_smaller, 300);
                let mut known: Vec<(&UtxoResponse, Class)> =
                    vec![(&unplaced, unplaced_class), (&mixed, mixed_class)];
                known.extend(received.iter().map(|(u, c)| (u, c.clone())));
                let spent = outpoints(&spent_by(&w, purpose.clone(), &known, &seedelf, pay));
                let (u, x) = (&one(&unplaced)[0], &one(&mixed)[0]);
                let line = format!(
                    "{name}, W smaller: {unplaced_smaller}: {} inputs, spent W: {}, spent X: {}",
                    spent.len(),
                    spent.contains(u),
                    spent.contains(x)
                );
                println!("{line}");
                if spent.contains(u) || !spent.contains(x) {
                    wrong.push(line);
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a box of unknown making went before a mixed one:\n{}",
            wrong.join("\n")
        );
    }

    /// Beside l4still#2, the fewest boxes still come first there: X (mixed, 4.7 ₳) can't pay 47 ₳ beside the 21
    /// payments of 2 ₳ one transaction still takes, and L (a plain way back, 9.71 ₳) can alone: L is spent alone, no
    /// second box merged in.
    #[test]
    fn past_the_input_limit_one_box_still_pays_where_the_mixed_one_falls_short() {
        let w = world();
        let received: Vec<(UtxoResponse, Class)> = (0..25u8)
            .map(|i| {
                let u = owned(&w, 0x50 + i, 0, 2_000_000, &[]);
                let c = received_class(&u);
                (u, c)
            })
            .collect();
        let plain = owned(&w, 0x30, 0, BOX, &[]);
        let mixed = owned(&w, 0x40, 0, 4_700_000, &[]);
        let mut known: Vec<(&UtxoResponse, Class)> = vec![
            (
                &plain,
                class(&format!("box:{}", plain.tx_hash), Origin::Lovejoin),
            ),
            (
                &mixed,
                class(&format!("box:{}", mixed.tx_hash), Origin::Mixed),
            ),
        ];
        known.extend(received.iter().map(|(u, c)| (u, c.clone())));
        let seedelf = paying(47_000_000);
        for purpose in [
            Purpose::Pay,
            Purpose::Fund {
                session: Some("session:7".into()),
            },
        ] {
            let spent = outpoints(&spent_by(
                &w,
                purpose.clone(),
                &known,
                &seedelf,
                &to_address(47_000_000),
            ));
            assert!(spent.contains(&one(&plain)[0]), "{purpose:?}: {spent:?}");
            assert!(
                !spent.contains(&one(&mixed)[0]),
                "{purpose:?}: two boxes merged"
            );
        }
    }

    /// Whether exactly `inputs` pay a Send of `seedelf` (`pay` empty) or a payment of `pay`, as selection's attempt
    /// asks it: built, and its computation estimated.
    fn pays_with(
        w: &World,
        inputs: &[UtxoResponse],
        seedelf: &Payment,
        pay: &[AddressPayment],
    ) -> anyhow::Result<()> {
        if pay.is_empty() {
            build::transfer_from(
                &w.chain,
                inputs,
                std::slice::from_ref(seedelf),
                &w.owner,
                w.signer,
            )
        } else {
            build::sweep_many_from(&w.chain, inputs, pay, &w.owner, w.signer)
        }
        .and_then(|s| s.estimate())
        .map(|_| ())
    }

    /// Chunk 51, l5merge#1: a token pool's way back (`box:<t>`, holding its pool's token, here one a mix moved) was no
    /// box to merging, so it went after every box of ADA alone, one of unknown making included: a funding, a Send or a
    /// Make public merged W (unknown making) ahead of T, or two plain boxes where T alone paid beside the money made
    /// private. It's a box, weighed in one transaction by what it pays beside the change a spend makes anyway
    /// (`Weighed::InOne`; l7words#9, l7still#3).
    #[test]
    fn a_token_pools_way_back_is_merged_as_a_box() {
        let w = world();
        let mut wrong = Vec::new();
        // A. O 5 ₳ made private; K a plain way back of 9.71 ₳; W one of unknown making of 9.71 ₳; T a token pool's way
        // back, mixed, 4.15 ₳ and its token. 16 ₳ out: O, K and T pay, as O, K and W do.
        let o = owned(&w, 0x01, 0, 5_000_000, &[]);
        let k = owned(&w, 0x61, 0, BOX, &[]);
        let unplaced = owned(&w, 0x30, 0, BOX, &[]);
        let t = owned(&w, 0x70, 0, 4_150_000, &[("pooltoken", 1)]);
        assert!(
            build::adds(&w.chain.params, &t).unwrap() > 0,
            "T adds something"
        );
        let known: Vec<(&UtxoResponse, Class)> = vec![
            (&o, class("public:0", Origin::Own)),
            (&k, class(&format!("box:{}", k.tx_hash), Origin::Lovejoin)),
            (
                &unplaced,
                class(
                    &format!("box:{0}+unknown:{0}", unplaced.tx_hash),
                    Origin::Lovejoin,
                ),
            ),
            (&t, class(&format!("box:{}", t.tx_hash), Origin::Mixed)),
        ];
        let seedelf = paying(16_000_000);
        let expected = outpoints(&[o.clone(), k.clone(), t.clone()]);
        for (name, purpose, pay) in [
            ("A: a Send of 16 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
            (
                "A: a Make public of 16 ₳",
                Purpose::Pay,
                to_address(16_000_000),
            ),
            (
                "A: a new session's funding of 11 ₳ and its 5 ₳ collateral",
                Purpose::Fund {
                    session: Some("session:7".into()),
                },
                funding(11_000_000),
            ),
        ] {
            pays_with(&w, &[o.clone(), k.clone(), t.clone()], &seedelf, &pay)
                .unwrap_or_else(|e| panic!("{name}: O, K and T pay: {e}"));
            let spent = outpoints(&spent_by(&w, purpose, &known, &seedelf, &pay));
            println!("{name}: spent {spent:?}");
            if spent != expected {
                wrong.push(format!("{name}: spent {spent:?}, not O, K and T"));
            }
        }
        // B. O 5 ₳; K1, K2 plain ways back of 4.71 ₳; T a 9 ₳ token pool box's way back, mixed, 8.65 ₳ and its token.
        // 11 ₳ out: O and T pay with one box.
        let k1 = owned(&w, 0x62, 0, 4_710_000, &[]);
        let k2 = owned(&w, 0x63, 0, 4_710_000, &[]);
        let t = owned(&w, 0x71, 0, 8_650_000, &[("pooltoken", 1)]);
        let known: Vec<(&UtxoResponse, Class)> = vec![
            (&o, class("public:0", Origin::Own)),
            (&k1, class(&format!("box:{}", k1.tx_hash), Origin::Lovejoin)),
            (&k2, class(&format!("box:{}", k2.tx_hash), Origin::Lovejoin)),
            (&t, class(&format!("box:{}", t.tx_hash), Origin::Mixed)),
        ];
        let seedelf = paying(11_000_000);
        let one_box = outpoints(&[o.clone(), t.clone()]);
        for (name, purpose, pay) in [
            ("B: a Send of 11 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
            (
                "B: a Make public of 11 ₳",
                Purpose::Pay,
                to_address(11_000_000),
            ),
            (
                "B: a new session's funding of 6 ₳ and its 5 ₳ collateral",
                Purpose::Fund {
                    session: Some("session:7".into()),
                },
                funding(6_000_000),
            ),
        ] {
            pays_with(&w, &[o.clone(), t.clone()], &seedelf, &pay)
                .unwrap_or_else(|e| panic!("{name}: O and T pay: {e}"));
            let spent = outpoints(&spent_by(&w, purpose, &known, &seedelf, &pay));
            println!("{name}: spent {spent:?}");
            if spent != one_box {
                wrong.push(format!(
                    "{name}: spent {spent:?}, two boxes where O and T, one, pay"
                ));
            }
        }
        assert!(
            wrong.is_empty(),
            "a token pool's way back left out of the box rule's boxes:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l5merge#2: with every box whose making the wallet knows before one of unknown making, a balance of U
    /// (150 ₳ made private, with a token), W (199.7 ₳, a big box of unknown making) and 25 plain or mixed ways back of
    /// 4.71 ₳ couldn't pay 300 ₳ in one transaction: U and the 25 fell short, and with W too were more inputs than one
    /// transaction spends, so the Send went in parts merging 19 boxes, and two payments at once were refused, where
    /// 1e1b0647 spent U and W. As few boxes of unknown making as pay, then as few boxes: U and W.
    #[test]
    fn a_spend_one_transaction_of_u_and_w_paid_still_goes_in_one() {
        let w = world();
        let u = owned(&w, 0x01, 0, 150_000_000, &[("tok", 5)]);
        let big = owned(&w, 0x02, 0, 199_700_000, &[]);
        let small: Vec<UtxoResponse> = (0..25u8)
            .map(|i| owned(&w, 0x10 + i, 0, 4_710_000, &[]))
            .collect();
        let with = |first: &UtxoResponse, k: usize| -> Vec<UtxoResponse> {
            std::iter::once(first.clone())
                .chain(small[..k].iter().cloned())
                .collect()
        };
        let one = paying(300_000_000);
        let two = [paying(150_000_000), paying(150_000_000)];
        let send_from = |inputs: &[UtxoResponse], payments: &[Payment]| {
            build::transfer_from(&w.chain, inputs, payments, &w.owner, w.signer)
                .and_then(|s| s.estimate())
                .map(|_| ())
        };
        // The premises: U and W pay; U beside 21 of the small boxes is short, beside 22 more than one transaction
        // spends.
        for payments in [std::slice::from_ref(&one), &two[..]] {
            send_from(&[u.clone(), big.clone()], payments).expect("U and W pay");
            assert!(build::is_short(
                &send_from(&with(&u, 21), payments).unwrap_err()
            ));
            assert!(build::is_too_many(
                &send_from(&with(&u, 22), payments).unwrap_err()
            ));
        }
        let mut wrong = Vec::new();
        for small_origin in [Origin::Mixed, Origin::Lovejoin] {
            let mut known: Vec<(&UtxoResponse, Class)> = vec![
                (&u, class("public:0", Origin::Own)),
                (
                    &big,
                    class(
                        &format!("box:{0}+unknown:{0}", big.tx_hash),
                        Origin::Lovejoin,
                    ),
                ),
            ];
            known.extend(
                small
                    .iter()
                    .map(|k| (k, class(&format!("box:{}", k.tx_hash), small_origin))),
            );
            let available: Vec<UtxoResponse> = known.iter().map(|(u, _)| (*u).clone()).collect();
            let h = histories(Purpose::Pay, &known);
            let spends: [(&str, Vec<Payment>, Vec<AddressPayment>); 3] = [
                (
                    "a Send to one Seedelf, 300 ₳",
                    vec![one.clone()],
                    Vec::new(),
                ),
                (
                    "a Send to two Seedelfs, 150 ₳ each",
                    two.to_vec(),
                    Vec::new(),
                ),
                (
                    "a Make public of 300 ₳",
                    Vec::new(),
                    to_address(300_000_000),
                ),
            ];
            for (name, payments, to) in spends {
                let built = if to.is_empty() {
                    build::transfer_apart(&w.chain, &available, &h, &payments, &w.owner, w.signer)
                } else {
                    build::sweep_many_apart(&w.chain, &available, &h, &to, &w.owner, w.signer)
                };
                let line = match built {
                    Ok(spend)
                        if outpoints(&spend.inputs()) == outpoints(&[u.clone(), big.clone()]) =>
                    {
                        continue;
                    }
                    Ok(spend) => format!(
                        "{name}, the small boxes {small_origin:?}: built with {} inputs",
                        spend.inputs().len()
                    ),
                    Err(e) => format!("{name}, the small boxes {small_origin:?}: refused: {e}"),
                };
                println!("{line}");
                wrong.push(line);
            }
            let fund = histories(
                Purpose::Fund {
                    session: Some("session:7".into()),
                },
                &known,
            );
            let name = "a new session's funding of 295 ₳ and its 5 ₳ collateral";
            match build::sweep_many_apart(
                &w.chain,
                &available,
                &fund,
                &funding(295_000_000),
                &w.owner,
                w.signer,
            ) {
                Ok(spend) if outpoints(&spend.inputs()) == outpoints(&[u.clone(), big.clone()]) => {
                }
                Ok(spend) => wrong.push(format!(
                    "{name}, the small boxes {small_origin:?}: built with {} inputs",
                    spend.inputs().len()
                )),
                Err(e) => wrong.push(format!(
                    "{name}, the small boxes {small_origin:?}: refused: {e}"
                )),
            }
        }
        assert!(
            wrong.is_empty(),
            "a spend U and W paid in one transaction no longer builds as one:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l5merge#3 and l5still#2: where merge order c built with a plain box, its choice of as many boxes with
    /// a mixed one regrew c's other inputs, so a mixed box smaller than the plain one took more of them: more payments
    /// received merged (more payers tied, more fee), or, for a funding, another session's money the plain box's build
    /// left alone. A mixed box goes first among as many only with no more of the other inputs. 25 payments received of
    /// 2 ₳; L, a plain way back of 9.71 ₳, or P, a merged one of two boxes (`box:<a>+box:<b>`) of 19.42 ₳; X, mixed,
    /// 4.71 ₳: 43 ₳ out takes L (or P) and as few payments as pay beside it, never X and more.
    #[test]
    fn at_the_same_box_count_a_mixed_box_takes_no_more_of_the_other_inputs() {
        let w = world();
        let received: Vec<(UtxoResponse, Class)> = (0..25u8)
            .map(|i| {
                let u = owned(&w, 0x50 + i, 0, 2_000_000, &[]);
                let c = received_class(&u);
                (u, c)
            })
            .collect();
        let payments: Vec<UtxoResponse> = received.iter().map(|(u, _)| u.clone()).collect();
        let mixed = owned(&w, 0x40, 0, 4_710_000, &[]);
        let mixed_class = class(&format!("box:{}", mixed.tx_hash), Origin::Mixed);
        let l = owned(&w, 0x30, 0, BOX, &[]);
        let l_class = class(&format!("box:{}", l.tx_hash), Origin::Lovejoin);
        let p = owned(&w, 0x31, 0, 2 * BOX, &[]);
        let p_class = class(
            &format!("box:{}+box:{}", p.tx_hash, hex::encode([0x32u8; 32])),
            Origin::Lovejoin,
        );
        let with = |b: &UtxoResponse, others: &[UtxoResponse]| -> Vec<UtxoResponse> {
            std::iter::once(b.clone())
                .chain(others.iter().cloned())
                .collect()
        };
        let mut wrong = Vec::new();
        let seedelf = paying(43_000_000);
        for (box_name, plain, plain_class) in [("L", &l, l_class), ("P", &p, p_class)] {
            for (name, purpose, pay) in [
                ("a Send of 43 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
                (
                    "a Make public of 43 ₳",
                    Purpose::Pay,
                    to_address(43_000_000),
                ),
                (
                    "a new session's funding of 38 ₳ and its 5 ₳ collateral",
                    Purpose::Fund {
                        session: Some("session:7".into()),
                    },
                    funding(38_000_000),
                ),
            ] {
                // The premises: the payments alone run into the input limit, and X pays beside more of them than the
                // plain box needs.
                assert!(build::is_too_many(
                    &pays_with(&w, &payments[..23], &seedelf, &pay).unwrap_err()
                ));
                let fewest = |b: &UtxoResponse| {
                    (0..=21)
                        .find(|&n| pays_with(&w, &with(b, &payments[..n]), &seedelf, &pay).is_ok())
                };
                let beside_plain = fewest(plain).expect("the plain box pays beside some");
                assert!(fewest(&mixed).is_none_or(|n| n > beside_plain), "{name}");
                let mut known: Vec<(&UtxoResponse, Class)> =
                    vec![(plain, plain_class.clone()), (&mixed, mixed_class.clone())];
                known.extend(received.iter().map(|(u, c)| (u, c.clone())));
                let spent = outpoints(&spent_by(&w, purpose, &known, &seedelf, &pay));
                let line = format!(
                    "{name}, beside {box_name}: {box_name} pays beside {beside_plain} payments; spent {} inputs, \
                     {box_name}: {}, X: {}",
                    spent.len(),
                    spent.contains(&one(plain)[0]),
                    spent.contains(&one(&mixed)[0]),
                );
                println!("{line}");
                if spent.len() > beside_plain + 1 || !spent.contains(&one(plain)[0]) {
                    wrong.push(line);
                }
            }
        }
        // A new session's funding of 36 ₳ and its 5 ₳ collateral, beside 17 payments received of 2 ₳ and 6 UTxOs of
        // another session's money of 1.5 ₳ (taken only where nothing else pays): L and the 17 pay, with none of it.
        let others_session: Vec<(UtxoResponse, Class)> = (0..6u64)
            .map(|i| {
                let u = owned(&w, 0x90, i, 1_500_000, &[]);
                (u, class("session:3", Origin::Session))
            })
            .collect();
        let pay = funding(36_000_000);
        let seventeen: Vec<UtxoResponse> = payments[..17].to_vec();
        let mut by_count = seventeen.clone();
        by_count.extend(others_session.iter().map(|(u, _)| u.clone()));
        assert!(build::is_short(
            &pays_with(&w, &by_count[..22], &seedelf, &pay).unwrap_err()
        ));
        assert!(build::is_too_many(
            &pays_with(&w, &by_count[..23], &seedelf, &pay).unwrap_err()
        ));
        pays_with(&w, &with(&l, &seventeen), &seedelf, &pay).expect("L and the 17 pay");
        assert!(build::is_short(
            &pays_with(&w, &with(&mixed, &seventeen), &seedelf, &pay).unwrap_err()
        ));
        let mut known: Vec<(&UtxoResponse, Class)> = vec![
            (&l, class(&format!("box:{}", l.tx_hash), Origin::Lovejoin)),
            (&mixed, mixed_class.clone()),
        ];
        known.extend(received[..17].iter().map(|(u, c)| (u, c.clone())));
        known.extend(others_session.iter().map(|(u, c)| (u, c.clone())));
        let spent = spent_by(
            &w,
            Purpose::Fund {
                session: Some("session:7".into()),
            },
            &known,
            &seedelf,
            &pay,
        );
        let sessions = spent
            .iter()
            .filter(|u| u.tx_hash == hex::encode([0x90u8; 32]))
            .count();
        let line = format!(
            "a new session's funding of 36 ₳ and its 5 ₳ collateral: spent {} inputs, L: {}, X: {}, {sessions} of \
             another session's money",
            spent.len(),
            outpoints(&spent).contains(&one(&l)[0]),
            outpoints(&spent).contains(&one(&mixed)[0]),
        );
        println!("{line}");
        if sessions > 0 {
            wrong.push(line);
        }
        assert!(
            wrong.is_empty(),
            "a mixed box's choice took more of the other inputs than the plain box's build:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l5still#3: one box that pays alone ranked P, a plain way back (`box:<p>`, origin lovejoin), level with
    /// W, one of unknown making (`box:<w>+unknown:<w>`, origin lovejoin), and took the smaller, where merging and the
    /// escape hatch take P first. A funding, a top-up, a Send and a Make public take P, whatever the sizes; a stealth
    /// mint keeps its own order, which puts them level (l3rank#3, as decided).
    #[test]
    fn one_box_paying_takes_a_plain_box_before_one_of_unknown_making_whatever_the_sizes() {
        let w = world();
        let seedelf = paying(3_000_000);
        let spends: Vec<(&str, Purpose, Vec<AddressPayment>)> = vec![
            (
                "a new session's funding of 2 ₳ and its 5 ₳ collateral",
                Purpose::Fund {
                    session: Some("session:7".into()),
                },
                funding(2_000_000),
            ),
            (
                "a site's top-up of 2 ₳",
                Purpose::Fund {
                    session: Some("session:3".into()),
                },
                to_address(2_000_000),
            ),
            ("a Make public of 3 ₳", Purpose::Pay, to_address(3_000_000)),
            ("a Send of 3 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
        ];
        let mut wrong: Vec<String> = Vec::new();
        for unplaced_smaller in [true, false] {
            let (unplaced_lovelace, plain_lovelace) = if unplaced_smaller {
                (BOX - 300, BOX)
            } else {
                (BOX, BOX - 300)
            };
            let unplaced = owned(&w, 0x30, 0, unplaced_lovelace, &[]);
            let plain = owned(&w, 0x41, 0, plain_lovelace, &[]);
            let unplaced_class = class(
                &format!("box:{0}+unknown:{0}", unplaced.tx_hash),
                Origin::Lovejoin,
            );
            let plain_class = class(&format!("box:{}", plain.tx_hash), Origin::Lovejoin);
            let known = [(&unplaced, unplaced_class), (&plain, plain_class)];
            for (name, purpose, pay) in &spends {
                let spent = outpoints(&spent_by(&w, purpose.clone(), &known, &seedelf, pay));
                println!(
                    "{name}, W smaller: {unplaced_smaller}: spent W: {}, spent P: {}",
                    spent == one(&unplaced),
                    spent == one(&plain)
                );
                if spent != one(&plain) {
                    wrong.push(format!(
                        "{name}, W smaller: {unplaced_smaller}: spent {spent:?}"
                    ));
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "spent W where P pays alone:\n{}",
            wrong.join("\n")
        );
    }

    #[test]
    fn with_nothing_known_it_picks_as_the_cli_always_has() {
        let w = world();
        let available: Vec<UtxoResponse> = (0..6u8)
            .map(|i| owned(&w, 0x40 + i, 0, 3_000_000 + u64::from(i) * 1_000_000, &[]))
            .collect();
        let pay = [AddressPayment {
            to: key_address(),
            lovelace: 12_000_000,
            tokens: Assets::new(),
        }];
        let blind = build::sweep_many(&w.chain, &available, &pay, &w.owner, w.signer).unwrap();
        // Every UTxO Unknown, given or not: the same inputs, and the same fee.
        let unknown = available
            .iter()
            .fold(Histories::new(Purpose::Fund { session: None }), |h, u| {
                h.with(&u.tx_hash, u.tx_index, Class::default())
            });
        let apart =
            build::sweep_many_apart(&w.chain, &available, &unknown, &pay, &w.owner, w.signer)
                .unwrap();
        assert_eq!(outpoints(&apart.inputs()), outpoints(&blind.inputs()));
        assert_eq!(
            apart.estimate().unwrap().fee.total,
            blind.estimate().unwrap().fee.total
        );
    }

    // Chunk 51, round seven: the parts of the box rule round six's last look found broken or held by no test, each
    // pinned here so that taking it out fails a test.

    /// What a spend pays out in these pins, `lovelace` in all: a Send to one Seedelf, a Make public, or a new session's
    /// funding and its 5 ₳ collateral.
    #[derive(Debug, Clone, Copy)]
    enum Out {
        Send,
        Public,
        Fund,
    }

    impl Out {
        fn purpose(self) -> Purpose {
            match self {
                Out::Fund => Purpose::Fund {
                    session: Some("session:7".into()),
                },
                _ => Purpose::Pay,
            }
        }

        fn outputs(self, lovelace: u64) -> (Vec<Payment>, Vec<AddressPayment>) {
            match self {
                Out::Send => (vec![paying(lovelace)], Vec::new()),
                Out::Public => (Vec::new(), to_address(lovelace)),
                Out::Fund => (Vec::new(), funding(lovelace - 5_000_000)),
            }
        }
    }

    /// Whether exactly `inputs` pay `seedelfs` (a Send, `pay` empty) or `pay`, as selection's attempt asks it.
    fn pays_many(
        w: &World,
        inputs: &[UtxoResponse],
        seedelfs: &[Payment],
        pay: &[AddressPayment],
    ) -> anyhow::Result<()> {
        if pay.is_empty() {
            build::transfer_from(&w.chain, inputs, seedelfs, &w.owner, w.signer)
        } else {
            build::sweep_many_from(&w.chain, inputs, pay, &w.owner, w.signer)
        }
        .and_then(|s| s.estimate())
        .map(|_| ())
    }

    fn pays_out(w: &World, inputs: &[UtxoResponse], out: Out, lovelace: u64) -> anyhow::Result<()> {
        let (seedelfs, pay) = out.outputs(lovelace);
        pays_many(w, inputs, &seedelfs, &pay)
    }

    /// What selection spends of `known` for `purpose`, paying `seedelfs` (a Send, `pay` empty) or `pay`, or why it
    /// refuses.
    fn picked_by(
        w: &World,
        purpose: Purpose,
        known: &[(&UtxoResponse, Class)],
        seedelfs: &[Payment],
        pay: &[AddressPayment],
    ) -> anyhow::Result<Vec<UtxoResponse>> {
        let available: Vec<UtxoResponse> = known.iter().map(|(u, _)| (*u).clone()).collect();
        let h = histories(purpose, known);
        if pay.is_empty() {
            build::transfer_apart(&w.chain, &available, &h, seedelfs, &w.owner, w.signer)
        } else {
            build::sweep_many_apart(&w.chain, &available, &h, pay, &w.owner, w.signer)
        }
        .map(|s| s.inputs())
    }

    fn picked_out(
        w: &World,
        known: &[(&UtxoResponse, Class)],
        out: Out,
        lovelace: u64,
    ) -> anyhow::Result<Vec<UtxoResponse>> {
        let (seedelfs, pay) = out.outputs(lovelace);
        picked_by(w, out.purpose(), known, &seedelfs, &pay)
    }

    /// The most `pays` pays, between `lo`, which it pays, and `hi`, which it doesn't.
    fn most_paid(mut lo: u64, mut hi: u64, pays: impl Fn(u64) -> bool) -> u64 {
        assert!(pays(lo) && !pays(hi), "{lo} pays, {hi} doesn't");
        while hi - lo > 1 {
            let mid = lo + (hi - lo) / 2;
            if pays(mid) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        lo
    }

    fn box_class(u: &UtxoResponse, origin: Origin) -> Class {
        class(&format!("box:{}", u.tx_hash), origin)
    }

    fn unknown_class(u: &UtxoResponse) -> Class {
        class(&format!("box:{0}+unknown:{0}", u.tx_hash), Origin::Lovejoin)
    }

    /// `first`, then the first `n` of `rest`.
    fn with_first(first: &[&UtxoResponse], rest: &[UtxoResponse], n: usize) -> Vec<UtxoResponse> {
        first
            .iter()
            .map(|u| (*u).clone())
            .chain(rest[..n].iter().cloned())
            .collect()
    }

    /// Chunk 51, round seven (l6still#1 B, l6words#3, l5merge#2's own fix): rule 1 by construction. 1e1b0647's orders
    /// took a token pool's way back among the other money; the box rule weighs it as a box, by what it pays beside the
    /// change a spend makes anyway, which counts its token's share of that change again where another box beside it
    /// holds the same token. T1 and T2, two ways back of one token pool, 6 ₳ and the pool's token each; A, a plain way
    /// back of 5.9 ₳, which weighs more than either; 20 payments received of 10 ₳. Just under the most T1, T2 and the
    /// 20 pay in 22 inputs, the most one transaction spends, A, T1 and the 20 are short and every choice of the rule's
    /// orders that holds T1 and T2 holds A too, 23 inputs. Where the rule's orders build nothing, 1e1b0647's own do:
    /// T1, T2 and the 20, in one transaction, never refused or sent in parts.
    #[test]
    fn where_the_box_rules_orders_build_nothing_1e1b0647s_own_still_send_it_in_one() {
        let w = world();
        let a = owned(&w, 0x31, 0, 5_900_000, &[]);
        let t1 = owned(&w, 0x70, 0, 6_000_000, &[("pooltoken", 1)]);
        let t2 = owned(&w, 0x71, 0, 6_000_000, &[("pooltoken", 1)]);
        let payments: Vec<UtxoResponse> = (0..20u8)
            .map(|i| owned(&w, 0x50 + i, 0, 10_000_000, &[]))
            .collect();
        let mut known: Vec<(&UtxoResponse, Class)> = vec![
            (&a, box_class(&a, Origin::Lovejoin)),
            (&t1, box_class(&t1, Origin::Lovejoin)),
            (&t2, box_class(&t2, Origin::Lovejoin)),
        ];
        known.extend(payments.iter().map(|u| (u, received_class(u))));
        let both = with_first(&[&t1, &t2], &payments, 20);
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(150_000_000, 230_000_000, |l| {
                pays_out(&w, &both, out, l).is_ok()
            });
            let lovelace = most - 50_000;
            // The premises: T1, T2 and the 20 pay; A beside T1 and the 20 is short, beside both and 19 too, and with all
            // 23 too many inputs.
            pays_out(&w, &both, out, lovelace).expect("T1, T2 and the 20 pay");
            for (what, inputs) in [
                ("A, T1 and the 20", with_first(&[&a, &t1], &payments, 20)),
                (
                    "A, T1, T2 and 19",
                    with_first(&[&a, &t1, &t2], &payments, 19),
                ),
            ] {
                let e = pays_out(&w, &inputs, out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "{out:?}: {what}: {e}");
            }
            let all = with_first(&[&a, &t1, &t2], &payments, 20);
            let e = pays_out(&w, &all, out, lovelace).unwrap_err();
            assert!(build::is_too_many(&e), "{out:?}: all 23: {e}");
            let line = match picked_out(&w, &known, out, lovelace) {
                Ok(spent) if outpoints(&spent) == outpoints(&both) => continue,
                Ok(spent) => format!(
                    "{out:?} of {lovelace}: spent {} inputs, A: {}",
                    spent.len(),
                    outpoints(&spent).contains(&one(&a)[0])
                ),
                Err(e) => format!(
                    "{out:?} of {lovelace} (T1, T2 and the 20 pay up to {most}): refused: {e}"
                ),
            };
            println!("{line}");
            wrong.push(line);
        }
        assert!(
            wrong.is_empty(),
            "refused, or another set, where 1e1b0647 sent T1, T2 and the 20 as one transaction:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, round seven (l6still#1 B, l6words#3): round six weighed a token pool's way back by its ADA less its
    /// token's whole least, below a box of ADA alone it out-pays, and no order tried it without that box: at the input
    /// limit a Send 1e1b0647 sent whole went in parts, or, to two Seedelfs, was refused. K, a plain way back of 4.71 ₳;
    /// T, a token pool's way back of 6 ₳ and its token, mixed or plain; 21 payments received of 5 ₳: 108 ₳ to one
    /// Seedelf, or 54 ₳ to each of two, spends T and the 21 in one transaction. And 21 UTxOs made private of 50 ₳
    /// beside A, a plain way back of 6 ₳, and T of 7 ₳ and its token, just under the most T and the 21 pay: T and the
    /// 21; with two of them, below the limit, T alone beside them (as few boxes as pay).
    #[test]
    fn a_token_pools_way_back_beside_payments_at_the_input_limit_still_goes_in_one_transaction() {
        let w = world();
        let mut wrong = Vec::new();
        let k = owned(&w, 0x61, 0, 4_710_000, &[]);
        let t = owned(&w, 0x70, 0, 6_000_000, &[("pooltoken", 1)]);
        let received: Vec<UtxoResponse> = (0..21u8)
            .map(|i| owned(&w, 0x10 + i, 0, 5_000_000, &[]))
            .collect();
        for (name, seedelfs) in [
            ("a Send of 108 ₳ to one Seedelf", vec![paying(108_000_000)]),
            (
                "a Send of 54 ₳ to each of two Seedelfs",
                vec![paying(54_000_000), paying(54_000_000)],
            ),
        ] {
            pays_many(&w, &with_first(&[&t], &received, 21), &seedelfs, &[])
                .unwrap_or_else(|e| panic!("{name}: T and the 21 pay: {e}"));
            for (what, inputs) in [
                ("K and the 21", with_first(&[&k], &received, 21)),
                ("K, T and 20", with_first(&[&k, &t], &received, 20)),
            ] {
                let e = pays_many(&w, &inputs, &seedelfs, &[]).unwrap_err();
                assert!(build::is_short(&e), "{name}: {what}: {e}");
            }
            for t_origin in [Origin::Mixed, Origin::Lovejoin] {
                let mut known = vec![
                    (&k, box_class(&k, Origin::Lovejoin)),
                    (&t, box_class(&t, t_origin)),
                ];
                known.extend(received.iter().map(|u| (u, received_class(u))));
                match picked_by(&w, Purpose::Pay, &known, &seedelfs, &[]) {
                    Ok(s) if outpoints(&s) == outpoints(&with_first(&[&t], &received, 21)) => {}
                    Ok(s) => {
                        wrong.push(format!("{name}, T {t_origin:?}: spent {} inputs", s.len()))
                    }
                    Err(e) => wrong.push(format!("{name}, T {t_origin:?}: refused: {e}")),
                }
            }
        }
        // l6words#3: 21 UTxOs made private of 50 ₳ (one history), A of 6 ₳, T of 7 ₳ and its token.
        let money: Vec<UtxoResponse> = (0..21u8)
            .map(|i| owned(&w, 0x80 + i, 0, 50_000_000, &[]))
            .collect();
        let a = owned(&w, 0x31, 0, 6_000_000, &[]);
        let t = owned(&w, 0x72, 0, 7_000_000, &[("poolA", 1)]);
        for out in [Out::Send, Out::Public, Out::Fund] {
            for (count, low, high) in [
                (21, 1_000_000_000, 1_060_000_000),
                (2, 60_000_000, 110_000_000),
            ] {
                let beside_t = with_first(&[&t], &money, count);
                let most = most_paid(low, high, |l| pays_out(&w, &beside_t, out, l).is_ok());
                let lovelace = most - 100_000;
                let e = pays_out(&w, &with_first(&[&a], &money, count), out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "{out:?}, {count}: A beside them: {e}");
                for (a_origin, t_origin) in [
                    (Origin::Lovejoin, Origin::Lovejoin),
                    (Origin::Lovejoin, Origin::Mixed),
                    (Origin::Mixed, Origin::Lovejoin),
                ] {
                    let mut known: Vec<(&UtxoResponse, Class)> = money[..count]
                        .iter()
                        .map(|u| (u, class("public:0", Origin::Own)))
                        .collect();
                    known.push((&a, box_class(&a, a_origin)));
                    known.push((&t, box_class(&t, t_origin)));
                    let line = format!(
                        "{out:?} of {lovelace} beside {count} of 50 ₳, A {a_origin:?}, T {t_origin:?}"
                    );
                    match picked_out(&w, &known, out, lovelace) {
                        Ok(s) if outpoints(&s) == outpoints(&beside_t) => {}
                        Ok(s) => wrong.push(format!(
                            "{line}: spent {} inputs, A: {}",
                            s.len(),
                            outpoints(&s).contains(&one(&a)[0])
                        )),
                        Err(e) => wrong.push(format!("{line}: refused: {e}")),
                    }
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a token pool's way back that pays beside the other money wasn't the one box spent:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, round seven (l6reference#2, l6still#1 A and C): round six weighed a token pool's way back by its ADA
    /// less its token's whole least, though beside the change a spend makes anyway its token adds only that change's
    /// extra least; so a box of ADA alone weighing more on paper, and paying less, went first, and a merge took two
    /// boxes where the token box alone paid beside the money made private, two of unknown making where one paid. One
    /// transaction weighs a box holding tokens by what it pays beside the change its order keeps (`Kept`, here one of
    /// ADA alone), its ADA less what its tokens add to that change's least, and a box of ADA alone by its ADA: not by
    /// the ADA a box holds either (the last case; chunk 51, l8still#4).
    #[test]
    fn one_transaction_weighs_a_box_by_what_it_pays_beside_the_change() {
        let w = world();
        let mut wrong = Vec::new();
        let mut check = |name: String,
                         known: &[(&UtxoResponse, Class)],
                         out: Out,
                         lovelace: u64,
                         pays: &[UtxoResponse],
                         short: &[UtxoResponse]| {
            pays_out(&w, pays, out, lovelace).unwrap_or_else(|e| panic!("{name}: {e}"));
            let e = pays_out(&w, short, out, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{name}: the other is short: {e}");
            match picked_out(&w, known, out, lovelace) {
                Ok(s) if outpoints(&s) == outpoints(pays) => {}
                Ok(s) => wrong.push(format!(
                    "{name}: spent {} inputs, where {} pay",
                    s.len(),
                    pays.len()
                )),
                Err(e) => wrong.push(format!("{name}: refused: {e}")),
            }
        };
        // l6reference#2: O 3 ₳ made private; T a mixed token pool's way back of 7.5 ₳ and its token; B a plain way back of
        // 6.6 ₳; C 4.71 ₳. 8 ₳ out: O and T pay, O and B are short.
        let o = owned(&w, 0x01, 0, 3_000_000, &[]);
        let t = owned(&w, 0x70, 0, 7_500_000, &[("poolA", 1)]);
        let b = owned(&w, 0x61, 0, 6_600_000, &[]);
        let c = owned(&w, 0x62, 0, 4_710_000, &[]);
        let known = vec![
            (&o, class("public:0", Origin::Own)),
            (&t, box_class(&t, Origin::Mixed)),
            (&b, box_class(&b, Origin::Lovejoin)),
            (&c, box_class(&c, Origin::Lovejoin)),
        ];
        for (out, lovelace) in [
            (Out::Send, 8_000_000),
            (Out::Send, 8_500_000),
            (Out::Public, 8_000_000),
            (Out::Fund, 8_000_000),
        ] {
            check(
                format!("O, T, B, C: {out:?} of {lovelace}"),
                &known,
                out,
                lovelace,
                &[o.clone(), t.clone()],
                &[o.clone(), b.clone()],
            );
        }
        // l6still#1 A: O 5 ₳; K a plain way back of 4.71 ₳; T a token pool's way back of 6 ₳ and its token, mixed or
        // plain. 8 and 8.2 ₳ out: O and T pay, O and K are short.
        let o5 = owned(&w, 0x02, 0, 5_000_000, &[]);
        let k = owned(&w, 0x63, 0, 4_710_000, &[]);
        let t6 = owned(&w, 0x71, 0, 6_000_000, &[("pooltoken", 1)]);
        for t_origin in [Origin::Mixed, Origin::Lovejoin] {
            let known = vec![
                (&o5, class("public:0", Origin::Own)),
                (&k, box_class(&k, Origin::Lovejoin)),
                (&t6, box_class(&t6, t_origin)),
            ];
            for (out, lovelace) in [
                (Out::Send, 8_000_000),
                (Out::Send, 8_200_000),
                (Out::Public, 8_000_000),
                (Out::Fund, 8_000_000),
            ] {
                check(
                    format!("O, K, T {t_origin:?}: {out:?} of {lovelace}"),
                    &known,
                    out,
                    lovelace,
                    &[o5.clone(), t6.clone()],
                    &[o5.clone(), k.clone()],
                );
            }
        }
        // l6still#1 C: O 5 ₳; UA of unknown making of 4.71 ₳; UT of unknown making, 6 ₳ and its token. 8 ₳ out: O and
        // UT pay, O and UA are short: one of unknown making.
        let ua = owned(&w, 0x30, 0, 4_710_000, &[]);
        let ut = owned(&w, 0x72, 0, 6_000_000, &[("pooltoken", 1)]);
        let known = vec![
            (&o5, class("public:0", Origin::Own)),
            (&ua, unknown_class(&ua)),
            (&ut, unknown_class(&ut)),
        ];
        for out in [Out::Send, Out::Public, Out::Fund] {
            check(
                format!("O, UA, UT: {out:?} of 8 ₳"),
                &known,
                out,
                8_000_000,
                &[o5.clone(), ut.clone()],
                &[o5.clone(), ua.clone()],
            );
        }
        // The other way: T of 7.5 ₳ and its token, B of 7.4 ₳ of ADA alone, which pays more beside the change. Just
        // under the most O and B pay: O and T are short.
        let b74 = owned(&w, 0x64, 0, 7_400_000, &[]);
        let known = vec![
            (&o, class("public:0", Origin::Own)),
            (&t, box_class(&t, Origin::Lovejoin)),
            (&b74, box_class(&b74, Origin::Lovejoin)),
        ];
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(6_000_000, 12_000_000, |l| {
                pays_out(&w, &[o.clone(), b74.clone()], out, l).is_ok()
            });
            check(
                format!("O, T, B of 7.4 ₳: {out:?} of {}", most - 20_000),
                &known,
                out,
                most - 20_000,
                &[o.clone(), b74.clone()],
                &[o.clone(), t.clone()],
            );
        }
        assert!(
            wrong.is_empty(),
            "a box went first by a weight other than what it pays beside the change:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, round seven (l6reference#1, l6words#2): past what one transaction spends, order c took a funding's last
    /// resort, another session's money, only after every small payment received, which ran into the input limit
    /// first; so a funding merged a box, one of unknown making among them, where that money and a few payments pay
    /// without one. Order c tries the other money by size too, tiers 0 and 1 together, so the last resort goes in
    /// before a box where it pays, as order a takes it within the limit; once it must go in, as few boxes as pay is
    /// none.
    #[test]
    fn past_the_input_limit_a_funding_takes_another_sessions_money_before_a_box() {
        let w = world();
        let mut wrong = Vec::new();
        let payments: Vec<UtxoResponse> = (0..25u8)
            .map(|i| owned(&w, 0x50 + i, 0, 2_000_000, &[]))
            .collect();
        let session = class("session:3", Origin::Session);
        let mut spend = |name: String,
                         known: &[(&UtxoResponse, Class)],
                         lovelace: u64,
                         boxes: &[&UtxoResponse]| {
            match picked_out(&w, known, Out::Fund, lovelace) {
                Ok(s) => {
                    let merged: Vec<&&UtxoResponse> = boxes
                        .iter()
                        .filter(|b| outpoints(&s).contains(&one(b)[0]))
                        .collect();
                    let line = format!(
                        "{name}: spent {} inputs, {} of its boxes",
                        s.len(),
                        merged.len()
                    );
                    println!("{line}");
                    if !merged.is_empty() {
                        wrong.push(line);
                    }
                }
                Err(e) => wrong.push(format!("{name}: refused: {e}")),
            }
        };
        // A. L, a plain way back of 9.71 ₳; S1 and S2, another session's 8 ₳ each; the 25 payments. A new session's
        // funding of 49.5, 49 or 48 ₳ in all: both of S and 19 or 18 payments pay; L and 21 are short at 49.5 ₳.
        let l = owned(&w, 0x30, 0, BOX, &[]);
        let s1 = owned(&w, 0x90, 0, 8_000_000, &[]);
        let s2 = owned(&w, 0x90, 1, 8_000_000, &[]);
        let mut known = vec![
            (&l, box_class(&l, Origin::Lovejoin)),
            (&s1, session.clone()),
            (&s2, session.clone()),
        ];
        known.extend(payments.iter().map(|u| (u, received_class(u))));
        let e = pays_out(&w, &with_first(&[&l], &payments, 21), Out::Fund, 49_500_000).unwrap_err();
        assert!(build::is_short(&e), "L and 21: {e}");
        for (lovelace, beside) in [(49_500_000u64, 19usize), (49_000_000, 18), (48_000_000, 18)] {
            pays_out(
                &w,
                &with_first(&[&s1, &s2], &payments, beside),
                Out::Fund,
                lovelace,
            )
            .unwrap_or_else(|e| panic!("both of S and {beside} pay {lovelace}: {e}"));
            spend(
                format!("A: a funding of {lovelace} in all"),
                &known,
                lovelace,
                &[&l],
            );
        }
        // B. Within the limit, as order a takes the tiers: L, both of S and 15 payments, 37 ₳ in all. L and the 15 pay,
        // and both of S and the 15: it takes both of S, no box.
        let mut known = vec![
            (&l, box_class(&l, Origin::Lovejoin)),
            (&s1, session.clone()),
            (&s2, session.clone()),
        ];
        known.extend(payments[..15].iter().map(|u| (u, received_class(u))));
        pays_out(&w, &with_first(&[&l], &payments, 15), Out::Fund, 37_000_000)
            .expect("L and the 15 pay");
        spend(
            "B: within the limit, a funding of 37 ₳ in all".into(),
            &known,
            37_000_000,
            &[&l],
        );
        // C. l6words#2: S, another session's 40 ₳; a box of 4.71 ₳ of unknown making, or of 40 ₳, or a plain one of
        // 4.71 ₳; the 25 payments. A funding of 50 ₳ in all: S and 6 payments pay, with no box.
        let s = owned(&w, 0x91, 0, 40_000_000, &[]);
        pays_out(&w, &with_first(&[&s], &payments, 6), Out::Fund, 50_000_000).expect("S and 6 pay");
        for (what, lovelace, unplaced) in [
            ("of unknown making, 4.71 ₳", 4_710_000, true),
            ("of unknown making, 40 ₳", 40_000_000, true),
            ("plain, 4.71 ₳", 4_710_000, false),
        ] {
            let b = owned(&w, 0x32, 0, lovelace, &[]);
            let b_class = if unplaced {
                unknown_class(&b)
            } else {
                box_class(&b, Origin::Lovejoin)
            };
            let mut known = vec![(&b, b_class), (&s, session.clone())];
            known.extend(payments.iter().map(|u| (u, received_class(u))));
            spend(
                format!("C: beside a box {what}, a funding of 50 ₳ in all"),
                &known,
                50_000_000,
                &[&b],
            );
        }
        // D. Round six's sweep, seed 1245: plain 24.71 ₳, mixed 9.71 ₳, one of unknown making of 4.71 ₳, a mixed token
        // pool's way back of 14.5 ₳ and its token, plain 4.71 ₳, mixed 4.71 ₳; another session's 5 ₳; a payment of 5 ₳
        // and 23 of 2 ₳. A funding of 95.1 ₳ in all: the five other boxes, the session's 5 ₳, the 5 ₳ payment and 15
        // of 2 ₳ (22 inputs) pay, without the box of unknown making.
        let boxes = [
            (owned(&w, 0xa0, 0, 24_710_000, &[]), Origin::Lovejoin, false),
            (owned(&w, 0xa1, 0, 9_710_000, &[]), Origin::Mixed, false),
            (owned(&w, 0xa2, 0, 4_710_000, &[]), Origin::Lovejoin, true),
            (
                owned(&w, 0xa3, 0, 14_500_000, &[("poolA", 1)]),
                Origin::Mixed,
                false,
            ),
            (owned(&w, 0xa4, 0, 4_710_000, &[]), Origin::Lovejoin, false),
            (owned(&w, 0xa5, 0, 4_710_000, &[]), Origin::Mixed, false),
        ];
        let s5 = owned(&w, 0x92, 0, 5_000_000, &[]);
        let r5 = owned(&w, 0x93, 0, 5_000_000, &[]);
        let others: Vec<&UtxoResponse> = boxes
            .iter()
            .filter(|(_, _, u)| !u)
            .map(|(b, ..)| b)
            .chain([&s5, &r5])
            .collect();
        pays_out(
            &w,
            &with_first(&others, &payments, 15),
            Out::Fund,
            95_100_000,
        )
        .expect("the 22 without the box of unknown making pay");
        let mut known: Vec<(&UtxoResponse, Class)> = boxes
            .iter()
            .map(|(b, origin, unplaced)| {
                (
                    b,
                    if *unplaced {
                        unknown_class(b)
                    } else {
                        box_class(b, *origin)
                    },
                )
            })
            .collect();
        known.push((&s5, session.clone()));
        known.push((&r5, received_class(&r5)));
        known.extend(payments[..23].iter().map(|u| (u, received_class(u))));
        spend(
            "D: seed 1245's balance, a funding of 95.1 ₳ in all".into(),
            &known,
            95_100_000,
            &[&boxes[2].0],
        );
        assert!(
            wrong.is_empty(),
            "a funding merged a box where another session's money and the payments pay without it:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, round seven (l6reference#4): past what one transaction spends, order c's choice of as many boxes with
    /// more of them mixed (rule 4) had no test: with it taken out, every test passed, the reference's sweep included,
    /// whose box sizes pay further apart than a payment received. 25 payments received of 2 ₳; P, a plain way back of
    /// 9.71 ₳; X, a mixed one of 9.41 ₳, within one payment of P. 22 payments hold no more than is paid out and 23 are
    /// more inputs than one transaction spends, so a fails and c builds with one box and 19 payments: X pays beside the
    /// same 19 as P does, so X goes, never P.
    #[test]
    fn past_the_input_limit_a_mixed_box_paying_beside_as_many_goes_before_a_plain_one() {
        let w = world();
        let payments: Vec<UtxoResponse> = (0..25u8)
            .map(|i| owned(&w, 0x50 + i, 0, 2_000_000, &[]))
            .collect();
        let plain = owned(&w, 0x30, 0, BOX, &[]);
        let mixed = owned(&w, 0x40, 0, BOX - 300_000, &[]);
        let mut known: Vec<(&UtxoResponse, Class)> = vec![
            (&plain, box_class(&plain, Origin::Lovejoin)),
            (&mixed, box_class(&mixed, Origin::Mixed)),
        ];
        known.extend(payments.iter().map(|u| (u, received_class(u))));
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let lovelace = 44_500_000;
            // The premises: 23 payments are more inputs than one transaction spends, and P and X each pay beside 19 of
            // them, neither beside 18.
            let e = pays_out(&w, &payments[..23], out, lovelace).unwrap_err();
            assert!(build::is_too_many(&e), "{out:?}: {e}");
            for b in [&plain, &mixed] {
                let e = pays_out(&w, &with_first(&[b], &payments, 18), out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "{out:?}: {e}");
                pays_out(&w, &with_first(&[b], &payments, 19), out, lovelace)
                    .unwrap_or_else(|e| panic!("{out:?}: a box and 19 payments pay: {e}"));
            }
            let spent = outpoints(&picked_out(&w, &known, out, lovelace).unwrap());
            let line = format!(
                "{out:?} of 44.5 ₳: spent {} inputs, P: {}, X: {}",
                spent.len(),
                spent.contains(&one(&plain)[0]),
                spent.contains(&one(&mixed)[0]),
            );
            println!("{line}");
            if spent != outpoints(&with_first(&[&mixed], &payments, 19)) {
                wrong.push(line);
            }
        }
        assert!(
            wrong.is_empty(),
            "past the input limit, a plain box where a mixed one pays beside as many payments:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, round seven (l6reference#5): round six's step-1 sibling of l5merge#1 had no test. The cap of 12
    /// UTxOs holding tokens asked alone counted every one it passed by unasked (holding no more than the spend pays out)
    /// and shared one count between boxes and the other money, so payments received each holding a token of its own
    /// kept a token pool's way back that pays alone from being asked, and the merge tied as many payers together as
    /// paid. T, a mixed token pool's way back of 14.5 ₳ and its token, pays a 10 ₳ Send, Make public or funding alone,
    /// beside two plain ways back of 9.71 ₳ and, ranked ahead of T in step 1:
    ///
    /// - 13 payments received of 2 ₳, each its own class with a token of its own: none asked (both halves at once);
    /// - 12 payments received of 10.5 ₳, the same: each asked and short, its change can't carry its token (the shared
    ///   count on its own);
    /// - 13 mixed token pool ways back of 4.15 ₳, none asked, beside two payments received of 6 ₳ of ADA alone that
    ///   together pay (counting the unasked on its own).
    #[test]
    fn a_token_pools_way_back_that_pays_alone_is_asked_past_twelve_token_utxos() {
        let w = world();
        let t = owned(&w, 0x70, 0, 14_500_000, &[("pooltoken", 1)]);
        let k1 = owned(&w, 0x61, 0, BOX, &[]);
        let k2 = owned(&w, 0x62, 0, BOX, &[]);
        let names: Vec<String> = (0..13).map(|i| format!("gift{i:02}")).collect();
        let payments = |count: usize, lovelace: u64| -> Vec<(UtxoResponse, Class)> {
            (0..count)
                .map(|i| {
                    let u = owned(&w, 0x80 + i as u8, 0, lovelace, &[(names[i].as_str(), 1)]);
                    let c = received_class(&u);
                    (u, c)
                })
                .collect()
        };
        let shapes: Vec<(&str, Vec<(UtxoResponse, Class)>)> = vec![
            (
                "13 payments of 2 ₳, each with a token",
                payments(13, 2_000_000),
            ),
            (
                "12 payments of 10.5 ₳, each with a token",
                payments(12, 10_500_000),
            ),
            (
                "13 mixed token ways back of 4.15 ₳ and two payments of 6 ₳",
                (0..13u8)
                    .map(|i| {
                        let u = owned(&w, 0xa0 + i, 0, 4_150_000, &[("poolA", 1)]);
                        let c = box_class(&u, Origin::Mixed);
                        (u, c)
                    })
                    .chain((0..2u8).map(|i| {
                        let u = owned(&w, 0x90 + i, 0, 6_000_000, &[]);
                        let c = received_class(&u);
                        (u, c)
                    }))
                    .collect(),
            ),
        ];
        let mut wrong = Vec::new();
        for (shape, ahead) in &shapes {
            for (u, _) in ahead {
                assert!(
                    build::adds(&w.chain.params, u).unwrap() > 0,
                    "{shape}: each adds something"
                );
            }
            let mut known: Vec<(&UtxoResponse, Class)> =
                ahead.iter().map(|(u, c)| (u, c.clone())).collect();
            known.push((&t, box_class(&t, Origin::Mixed)));
            known.push((&k1, box_class(&k1, Origin::Lovejoin)));
            known.push((&k2, box_class(&k2, Origin::Lovejoin)));
            for out in [Out::Send, Out::Public, Out::Fund] {
                pays_out(&w, std::slice::from_ref(&t), out, 10_000_000)
                    .unwrap_or_else(|e| panic!("{shape}, {out:?}: T pays alone: {e}"));
                let spent = picked_out(&w, &known, out, 10_000_000).unwrap();
                let tied = spent
                    .iter()
                    .filter(|u| {
                        ahead
                            .iter()
                            .any(|(a, c)| a.tx_hash == u.tx_hash && c.origin == Origin::Received)
                    })
                    .count();
                println!(
                    "{shape}, {out:?}: spent {} inputs, {tied} of them payments received",
                    spent.len()
                );
                if outpoints(&spent) != one(&t) {
                    wrong.push(format!(
                        "{shape}, {out:?}: spent {} inputs, {tied} of them payments received, where T pays alone",
                        spent.len()
                    ));
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a token pool's way back that pays alone left unasked:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, round seven (l6reference#7): the u loop's prune (`known_fail`, the fewest boxes whose making the wallet
    /// knows that failed alone) had no test: made too eager, a Send merged a second box of unknown making where one
    /// paid, and every test passed. 30 plain ways back of 4.71 ₳, W1 and W2 of unknown making of 50 ₳ each, 25 payments
    /// received of 2 ₳: no set without a box of unknown making pays 120 ₳ out in one transaction (22 plain ones are
    /// short, 23 too many), and W1 beside some plain ones and payments does. One of unknown making, never both, beside
    /// as few plain ones as pay.
    #[test]
    fn past_the_input_limit_one_box_of_unknown_making_is_merged_where_one_pays() {
        let w = world();
        let plain: Vec<UtxoResponse> = (0..30u8)
            .map(|i| owned(&w, 0x10 + i, 0, 4_710_000, &[]))
            .collect();
        let w1 = owned(&w, 0x30, 0, 50_000_000, &[]);
        let w2 = owned(&w, 0x31, 0, 50_000_000, &[]);
        let payments: Vec<UtxoResponse> = (0..25u8)
            .map(|i| owned(&w, 0x50 + i, 0, 2_000_000, &[]))
            .collect();
        let mut known: Vec<(&UtxoResponse, Class)> = plain
            .iter()
            .map(|u| (u, box_class(u, Origin::Lovejoin)))
            .collect();
        known.push((&w1, unknown_class(&w1)));
        known.push((&w2, unknown_class(&w2)));
        known.extend(payments.iter().map(|u| (u, received_class(u))));
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let lovelace = 120_000_000;
            let e = pays_out(&w, &plain[..22], out, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{out:?}: 22 plain: {e}");
            let e = pays_out(&w, &plain[..23], out, lovelace).unwrap_err();
            assert!(build::is_too_many(&e), "{out:?}: 23 plain: {e}");
            // The fewest plain ones beside W1 that pay, beside as many payments as one transaction then holds.
            let fewest = (0..=21)
                .find(|&k| {
                    let inputs: Vec<UtxoResponse> = std::iter::once(w1.clone())
                        .chain(plain[..k].iter().cloned())
                        .chain(payments[..21 - k].iter().cloned())
                        .collect();
                    pays_out(&w, &inputs, out, lovelace).is_ok()
                })
                .expect("W1 pays beside some");
            let spent = outpoints(&picked_out(&w, &known, out, lovelace).unwrap());
            let unknown = [&w1, &w2]
                .iter()
                .filter(|u| spent.contains(&one(u)[0]))
                .count();
            let plain_spent = plain.iter().filter(|u| spent.contains(&one(u)[0])).count();
            let line = format!(
                "{out:?} of 120 ₳: {} inputs, {unknown} of unknown making, {plain_spent} plain; W1 pays beside {fewest} plain",
                spent.len()
            );
            println!("{line}");
            if (unknown, plain_spent) != (1, fewest) {
                wrong.push(line);
            }
        }
        assert!(
            wrong.is_empty(),
            "not one box of unknown making beside as few others as pay:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, round seven (l6reference#9, l6still#3): a stealth mint and a pool's start keep their own one-box order,
    /// which ranks a plain way back level with one of unknown making (both lovejoin) and takes the smaller, as decided
    /// (l3rank#3); a funding and a Send take the plain one first (l5still#3). Nothing held it: dropping the mint's own
    /// order passed every test. P plain and W of unknown making, 300 lovelace apart each way round: a stealth mint over
    /// 9.71 ₳ boxes, and a pool's start over 40 ₳ ones, spend the smaller.
    #[test]
    fn a_stealth_mint_and_a_pools_start_take_the_smaller_of_a_plain_box_and_one_of_unknown_making()
    {
        let w = world();
        let mut wrong = Vec::new();
        let terms = seedelf_core::lovejoin::Terms {
            token: None,
            box_lovelace: 2_000_000,
            max_fee: 1_500_000,
        };
        for size in [BOX, 40_000_000] {
            for unplaced_smaller in [true, false] {
                let (unplaced_lovelace, plain_lovelace) = if unplaced_smaller {
                    (size - 300, size)
                } else {
                    (size, size - 300)
                };
                let unplaced = owned(&w, 0x30, 0, unplaced_lovelace, &[]);
                let plain = owned(&w, 0x41, 0, plain_lovelace, &[]);
                let known = [
                    (&unplaced, unknown_class(&unplaced)),
                    (&plain, box_class(&plain, Origin::Lovejoin)),
                ];
                let smaller = if unplaced_smaller {
                    one(&unplaced)
                } else {
                    one(&plain)
                };
                let spent = if size == BOX {
                    minted(&w, &known)
                } else {
                    let launch = seedelf_core::lovejoin::launch_apart(
                        &w.chain,
                        &[unplaced.clone(), plain.clone()],
                        &histories(Purpose::Mint, &known),
                        &terms,
                        true,
                        &w.owner,
                        w.signer,
                    )
                    .unwrap();
                    outpoints(&launch.spend.inputs())
                };
                let what = if size == BOX {
                    "a stealth mint"
                } else {
                    "a pool's start"
                };
                println!(
                    "{what}, W smaller: {unplaced_smaller}: spent the smaller: {}",
                    spent == smaller
                );
                if spent != smaller {
                    wrong.push(format!(
                        "{what}, W smaller: {unplaced_smaller}: spent {spent:?}"
                    ));
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a stealth mint or a pool's start didn't keep its own order:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, round seven (l6reference#3 (a)): a box of unknown making larger than those whose making the wallet
    /// knows, but not needed, is left out, where the boxes by size alone take it first; round six's pin of rule 2 held
    /// only a smaller one, which size alone leaves out anyway. K1 and K2 of 4.71 ₳ (plain or mixed) and W2 of unknown
    /// making of 5.5 ₳: 7 ₳ out spends K1 and K2; by size alone, W2 and K1. (extension/tests/mixed-box-before-unplaced
    /// holds a Send of this shape end to end.)
    #[test]
    fn a_larger_box_of_unknown_making_stays_out_where_the_others_pay() {
        let w = world();
        let w2 = owned(&w, 0x32, 0, 5_500_000, &[]);
        let mut wrong = Vec::new();
        // With both mixed, the most-mixed choice takes K1 and K2 by size alone too, so that case can't tell them apart.
        for others_mixed in [[false, false], [true, false]] {
            let others: Vec<(UtxoResponse, Class)> = others_mixed
                .iter()
                .zip(0u8..)
                .map(|(&mixed, i)| {
                    let u = owned(&w, 0x42 + i, 0, 4_710_000, &[]);
                    let origin = if mixed {
                        Origin::Mixed
                    } else {
                        Origin::Lovejoin
                    };
                    let c = box_class(&u, origin);
                    (u, c)
                })
                .collect();
            let (k1, k2) = (others[0].0.clone(), others[1].0.clone());
            for out in [Out::Fund, Out::Public, Out::Send] {
                let lovelace = 7_000_000;
                // What tells the rule from size alone: W2 is short alone, and W2 and K1, size alone's first two, pay.
                let e = pays_out(&w, std::slice::from_ref(&w2), out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "{out:?}: W2 alone: {e}");
                pays_out(&w, &[w2.clone(), k1.clone()], out, lovelace)
                    .unwrap_or_else(|e| panic!("{out:?}: W2 and K1 pay: {e}"));
                pays_out(&w, &[k1.clone(), k2.clone()], out, lovelace)
                    .unwrap_or_else(|e| panic!("{out:?}: K1 and K2 pay: {e}"));
                let mut known: Vec<(&UtxoResponse, Class)> =
                    others.iter().map(|(u, c)| (u, c.clone())).collect();
                known.push((&w2, unknown_class(&w2)));
                let spent = outpoints(&picked_out(&w, &known, out, lovelace).unwrap());
                let line =
                    format!("{out:?} of 7 ₳, the others mixed: {others_mixed:?}: spent {spent:?}");
                println!("{line}");
                if spent != outpoints(&[k1.clone(), k2.clone()]) {
                    wrong.push(line);
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a box of unknown making merged where the others pay without it:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, round seven (l6reference#3 (b)): a token pool's way back is a box, so a merge leaves it out where
    /// another box pays beside the other money, as it would a box of ADA alone; taken as other money, it goes before
    /// every box. Round six's pin wanted T in both its cases, so it held nothing. O 5 ₳ made private; K a plain way
    /// back of 9.71 ₳; T a mixed token pool's way back of 7.5 ₳ and its token. 12 ₳ out: O and K pay, O and T are
    /// short; as other money, O, T and K.
    #[test]
    fn a_token_pools_way_back_stays_out_of_a_merge_another_box_pays() {
        let w = world();
        let o = owned(&w, 0x01, 0, 5_000_000, &[]);
        let k = owned(&w, 0x61, 0, BOX, &[]);
        let t = owned(&w, 0x72, 0, 7_500_000, &[("pooltoken", 1)]);
        let known: Vec<(&UtxoResponse, Class)> = vec![
            (&o, class("public:0", Origin::Own)),
            (&k, box_class(&k, Origin::Lovejoin)),
            (&t, box_class(&t, Origin::Mixed)),
        ];
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let lovelace = 12_000_000;
            pays_out(&w, &[o.clone(), k.clone()], out, lovelace)
                .unwrap_or_else(|e| panic!("{out:?}: O and K pay: {e}"));
            let e = pays_out(&w, &[o.clone(), t.clone()], out, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{out:?}: O and T: {e}");
            let spent = outpoints(&picked_out(&w, &known, out, lovelace).unwrap());
            println!("{out:?} of 12 ₳: spent {spent:?}");
            if spent != outpoints(&[o.clone(), k.clone()]) {
                wrong.push(format!("{out:?} of 12 ₳: spent {spent:?}, not O and K"));
            }
        }
        assert!(
            wrong.is_empty(),
            "a token pool's way back merged as other money, ahead of the box that pays:\n{}",
            wrong.join("\n")
        );
    }

    // Chunk 51, round eight: the pins of round seven's last look (review7.json), each failing without its part of the
    // rule.

    /// What `spent` holds of `names`, by name, and how many others, for a failure's line.
    fn named(spent: &[UtxoResponse], names: &[(&UtxoResponse, &str)]) -> String {
        let mut seen: Vec<&str> = Vec::new();
        let mut others = 0;
        for s in spent {
            match names
                .iter()
                .find(|(n, _)| n.tx_hash == s.tx_hash && n.tx_index == s.tx_index)
            {
                Some((_, name)) => seen.push(name),
                None => others += 1,
            }
        }
        seen.sort_unstable();
        format!("{} and {others} others", seen.join(", "))
    }

    /// `items` of the file's policy, by name.
    fn tokens_of(items: &[(&str, u64)]) -> Assets {
        use seedelf_core::assets::Asset as Token;
        items.iter().fold(Assets::new(), |all, (name, q)| {
            all.add(Token::new(TOKEN_POLICY.to_string(), hex::encode(name), *q).unwrap())
                .unwrap()
        })
    }

    /// Chunk 51, l7merge#2, l7reference#2: the one-transaction weight, from the ledger's own least. A box of ADA alone
    /// weighs its ADA; one holding tokens, its ADA less what its tokens add to the least of the change it's weighed
    /// beside, 20 kinds of token to an output: beside a change of ADA alone, its tokens' least less that change's; beside
    /// one keeping its token, all but what the larger amount adds; beside one keeping 20 kinds, all but a second output's
    /// whole least. A payment's parts weigh what it adds.
    #[test]
    fn one_transaction_weighs_a_box_beside_what_its_change_keeps() {
        let w = world();
        let p = &w.chain.params;
        let least = |t: &Assets| u128::from(build::minimum_deposit(p, t).unwrap());
        let names: Vec<String> = (0..20).map(|i| format!("m{i:02}")).collect();
        let twenty: Vec<(&str, u64)> = names.iter().map(|n| (n.as_str(), 1)).collect();
        let nothing = build::Kept::nothing(p);
        let same = build::Kept::new(p, tokens_of(&[("pooltoken", 9)]));
        let full = build::Kept::new(p, tokens_of(&twenty));
        let weight = |u: &UtxoResponse, kept: &build::Kept| {
            let c = box_class(u, Origin::Lovejoin);
            build::box_weight(p, &c, &[u], build::Weighed::InOne(kept)).0
        };
        let a = owned(&w, 0x31, 0, 6_000_000, &[]);
        for kept in [&nothing, &same, &full] {
            assert_eq!(weight(&a, kept), 6_000_000, "a box of ADA alone");
        }
        let t = owned(&w, 0x70, 0, 6_500_000, &[("pooltoken", 1)]);
        let none = Assets::new();
        let one = tokens_of(&[("pooltoken", 1)]);
        assert_eq!(
            weight(&t, &nothing),
            6_500_000 - (least(&one) - least(&none))
        );
        let nine = tokens_of(&[("pooltoken", 9)]);
        let ten = tokens_of(&[("pooltoken", 10)]);
        assert_eq!(weight(&t, &same), 6_500_000 - (least(&ten) - least(&nine)));
        let mut with: Vec<(&str, u64)> = twenty.clone();
        with.push(("pooltoken", 1));
        let (more, kinds) = (tokens_of(&with), tokens_of(&twenty));
        assert_eq!(
            weight(&t, &full),
            6_500_000 - (least(&more) - least(&kinds))
        );
        assert_eq!(
            least(&more) - least(&kinds),
            least(&one),
            "the 21st kind opens a second output"
        );
        let two = tokens_of(&[("poolA", 1), ("poolB", 1)]);
        let t2 = owned(&w, 0x71, 0, 7_500_000, &[("poolA", 1), ("poolB", 1)]);
        assert_eq!(
            weight(&t2, &nothing),
            7_500_000 - (least(&two) - least(&none))
        );
        let parts = build::box_weight(
            p,
            &box_class(&t, Origin::Lovejoin),
            &[&t],
            build::Weighed::InParts,
        )
        .0;
        assert_eq!(parts, u128::try_from(build::adds(p, &t).unwrap()).unwrap());
    }

    /// A Send of `lovelace` and `tokens` to someone's Seedelf, or with `public` a Make public of them.
    fn sending(
        public: bool,
        lovelace: u64,
        tokens: &Assets,
    ) -> (Vec<Payment>, Vec<AddressPayment>) {
        if public {
            let to = AddressPayment {
                to: key_address(),
                lovelace,
                tokens: tokens.clone(),
            };
            (Vec::new(), vec![to])
        } else {
            let to = Payment {
                register: Register::create(random_scalar())
                    .unwrap()
                    .rerandomize()
                    .unwrap(),
                lovelace,
                tokens: tokens.clone(),
            };
            (vec![to], Vec::new())
        }
    }

    /// Chunk 51, l7merge#1: rule 2 at the input limit beside two ways back of one pool, where an order the search tries
    /// pays without the box of unknown making. A: T1 and T2, two plain ways back of one token pool, 6 ₳ and its token
    /// each, weigh less than A, a plain way back of 5.9 ₳, though together they pay more than A beside either (their
    /// change carries the token once); U, a way back of unknown making of 6.5 ₳; 20 payments received of 10 ₳. Just
    /// under the most T1, T2 and the 20 pay in 22 inputs, A and one of them beside the 20 are short and all 23 too
    /// many: the rule's own orders build nothing without U, and U, A and the 20 pay. Before the first box of unknown
    /// making, 1e1b0647's orders over everything else send T1, T2 and the 20. B: a Send or Make public of one pool
    /// token, B (2 ₳, ten of it) its holder, so the change carries it anyway; T, a way back holding one more, 6 ₳: B, T
    /// and the 20, never U. Add a small payment received to A's balance and those orders try no such set, so U goes in:
    /// the rule's margin (l8merge#1).
    #[test]
    fn a_box_of_unknown_making_stays_out_where_the_orders_tried_pay_without_it_beside_one_pools_ways_back()
     {
        let w = world();
        let a = owned(&w, 0x31, 0, 5_900_000, &[]);
        let t1 = owned(&w, 0x70, 0, 6_000_000, &[("pooltoken", 1)]);
        let t2 = owned(&w, 0x71, 0, 6_000_000, &[("pooltoken", 1)]);
        let u = owned(&w, 0x90, 0, 6_500_000, &[]);
        let payments: Vec<UtxoResponse> = (0..20u8)
            .map(|i| owned(&w, 0x50 + i, 0, 10_000_000, &[]))
            .collect();
        let mut wrong = Vec::new();
        let mut check = |name: String,
                         spent: anyhow::Result<Vec<UtxoResponse>>,
                         want: &[UtxoResponse],
                         names: &[(&UtxoResponse, &str)]| {
            let line = match &spent {
                Ok(spent) if outpoints(spent) == outpoints(want) => return,
                Ok(spent) => format!("{name}: spent {}", named(spent, names)),
                Err(e) => format!("{name}: refused: {e}"),
            };
            println!("{line}");
            wrong.push(line);
        };
        // A.
        let names = [(&a, "A"), (&t1, "T1"), (&t2, "T2"), (&u, "U")];
        let both = with_first(&[&t1, &t2], &payments, 20);
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(150_000_000, 230_000_000, |l| {
                pays_out(&w, &both, out, l).is_ok()
            });
            let lovelace = most - 50_000;
            pays_out(&w, &both, out, lovelace).expect("T1, T2 and the 20 pay");
            for (what, inputs) in [
                ("A, T1 and the 20", with_first(&[&a, &t1], &payments, 20)),
                ("A, T2 and the 20", with_first(&[&a, &t2], &payments, 20)),
                (
                    "A, T1, T2 and 19",
                    with_first(&[&a, &t1, &t2], &payments, 19),
                ),
                ("U and the 20", with_first(&[&u], &payments, 20)),
            ] {
                let e = pays_out(&w, &inputs, out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "A, {out:?}: {what}: {e}");
            }
            let all = with_first(&[&a, &t1, &t2], &payments, 20);
            let e = pays_out(&w, &all, out, lovelace).unwrap_err();
            assert!(build::is_too_many(&e), "A, {out:?}: all 23: {e}");
            pays_out(&w, &with_first(&[&u, &a], &payments, 20), out, lovelace)
                .expect("U, A and the 20 pay");
            let mut known: Vec<(&UtxoResponse, Class)> = vec![
                (&a, box_class(&a, Origin::Lovejoin)),
                (&t1, box_class(&t1, Origin::Lovejoin)),
                (&t2, box_class(&t2, Origin::Lovejoin)),
                (&u, unknown_class(&u)),
            ];
            known.extend(payments.iter().map(|p| (p, received_class(p))));
            check(
                format!("A: {out:?} of {lovelace} (T1, T2 and the 20 pay up to {most})"),
                picked_out(&w, &known, out, lovelace),
                &both,
                &names,
            );
        }
        // B.
        let b = owned(&w, 0x21, 0, 2_000_000, &[("pooltoken", 10)]);
        let t = owned(&w, 0x72, 0, 6_000_000, &[("pooltoken", 1)]);
        let names = [(&a, "A"), (&b, "B"), (&t, "T"), (&u, "U")];
        let token = tokens_of(&[("pooltoken", 1)]);
        let bt = with_first(&[&b, &t], &payments, 20);
        for public in [false, true] {
            let pays = |inputs: &[UtxoResponse], lovelace: u64| {
                let (seedelfs, pay) = sending(public, lovelace, &token);
                pays_many(&w, inputs, &seedelfs, &pay)
            };
            let most = most_paid(150_000_000, 230_000_000, |l| pays(&bt, l).is_ok());
            let lovelace = most - 50_000;
            pays(&bt, lovelace).expect("B, T and the 20 pay");
            for (what, inputs) in [
                ("B, A and the 20", with_first(&[&b, &a], &payments, 20)),
                ("B, A, T and 19", with_first(&[&b, &a, &t], &payments, 19)),
                ("B and the 20", with_first(&[&b], &payments, 20)),
            ] {
                let e = pays(&inputs, lovelace).unwrap_err();
                assert!(build::is_short(&e), "B, public {public}: {what}: {e}");
            }
            let e = pays(&with_first(&[&b, &a, &t], &payments, 20), lovelace).unwrap_err();
            assert!(build::is_too_many(&e), "B, public {public}: all 23: {e}");
            pays(&with_first(&[&b, &u], &payments, 20), lovelace).expect("B, U and the 20 pay");
            let mut known: Vec<(&UtxoResponse, Class)> = vec![
                (&b, received_class(&b)),
                (&a, box_class(&a, Origin::Lovejoin)),
                (&t, box_class(&t, Origin::Lovejoin)),
                (&u, unknown_class(&u)),
            ];
            known.extend(payments.iter().map(|p| (p, received_class(p))));
            let (seedelfs, pay) = sending(public, lovelace, &token);
            check(
                format!("B: public {public}, of {lovelace} (B, T and the 20 pay up to {most})"),
                picked_by(&w, Purpose::Pay, &known, &seedelfs, &pay),
                &bt,
                &names,
            );
        }
        assert!(
            wrong.is_empty(),
            "a box of unknown making merged where the other boxes pay without one:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l7still#1: rule 2 beside two ways back of one token pool at the input limit, whatever a mix moved,
    /// where 1e1b0647's orders over everything but the box of unknown making find the set without it. T1 and T2, 6 ₳
    /// and the pool's token each; A, a way back of 5.9 ₳, which weighs more than either; U, one of unknown making of
    /// 10 ₳; 20 payments received of 10 ₳. Just under the most T1, T2 and the 20 pay, A and T1 beside the 20 are short,
    /// and U, A and the 20 pay: T1, T2 and the 20, never U, with T and A plain (1e1b0647's c builds it), T mixed beside
    /// a plain A (its a) and both mixed (its c). Beside a third token box a little larger than T1, those orders try no
    /// such set and U goes in: the rule's margin (l8still#2).
    #[test]
    fn beside_two_ways_back_of_one_token_pool_1e1b0647s_orders_keep_a_box_of_unknown_making_out_at_the_input_limit()
     {
        let w = world();
        let a = owned(&w, 0x31, 0, 5_900_000, &[]);
        let t1 = owned(&w, 0x70, 0, 6_000_000, &[("pooltoken", 1)]);
        let t2 = owned(&w, 0x71, 0, 6_000_000, &[("pooltoken", 1)]);
        let u = owned(&w, 0x32, 0, 10_000_000, &[]);
        let payments: Vec<UtxoResponse> = (0..20u8)
            .map(|i| owned(&w, 0x50 + i, 0, 10_000_000, &[]))
            .collect();
        let names = [(&a, "A"), (&t1, "T1"), (&t2, "T2"), (&u, "U")];
        let both = with_first(&[&t1, &t2], &payments, 20);
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(150_000_000, 230_000_000, |l| {
                pays_out(&w, &both, out, l).is_ok()
            });
            let lovelace = most - 50_000;
            pays_out(&w, &both, out, lovelace).expect("T1, T2 and the 20 pay");
            let e =
                pays_out(&w, &with_first(&[&a, &t1], &payments, 20), out, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{out:?}: A, T1 and the 20: {e}");
            let e = pays_out(
                &w,
                &with_first(&[&a, &t1, &t2], &payments, 20),
                out,
                lovelace,
            )
            .unwrap_err();
            assert!(build::is_too_many(&e), "{out:?}: all 23: {e}");
            pays_out(&w, &with_first(&[&u, &a], &payments, 20), out, lovelace)
                .expect("U, A and the 20 pay");
            for (t_origin, a_origin) in [
                (Origin::Lovejoin, Origin::Lovejoin),
                (Origin::Mixed, Origin::Lovejoin),
                (Origin::Mixed, Origin::Mixed),
            ] {
                let mut known: Vec<(&UtxoResponse, Class)> = vec![
                    (&a, box_class(&a, a_origin)),
                    (&t1, box_class(&t1, t_origin)),
                    (&t2, box_class(&t2, t_origin)),
                    (&u, unknown_class(&u)),
                ];
                known.extend(payments.iter().map(|p| (p, received_class(p))));
                let line = format!(
                    "{out:?} of {lovelace} (T1, T2 and the 20 pay up to {most}), T {t_origin:?}, A {a_origin:?}"
                );
                match picked_out(&w, &known, out, lovelace) {
                    Ok(spent) if outpoints(&spent) == outpoints(&both) => {}
                    Ok(spent) => wrong.push(format!("{line}: spent {}", named(&spent, &names))),
                    Err(e) => wrong.push(format!("{line}: refused: {e}")),
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a box of unknown making merged where T1, T2 and the 20 pay without one:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l7merge#2: one transaction weighs a box beside the change its order makes anyway. Change goes 20 kinds of
    /// token to an output, so where the change already holds 20 a box's token opens a second output, about 1.6 ₳ of least
    /// where an ADA change's weight counts 0.19 ₳. D, no token sent: M, money made private holding 20 kinds of token, at
    /// its least and 0.5 ₳ or at its least alone (as a move-in leaves every output but its last); T, a token pool's way
    /// back, 6.5 ₳ and its token; A, a way back of 6 ₳ of ADA alone (and 7.5 ₳ beside 6.6 ₳, the reference's sizes). Just
    /// under the most M and A pay, M and T are short: M and A, whatever a mix moved. C: a Send or Make public of one of a
    /// token B holds (10 ₳, 20 kinds, ten of that one), so the change keeps B's 20 kinds: B and A, not T.
    #[test]
    fn a_token_box_whose_token_opens_a_second_change_output_stays_out_where_a_box_of_ada_alone_pays()
     {
        let w = world();
        let least20 = {
            let names: Vec<String> = (0..20).map(|i| format!("m{i:02}")).collect();
            let bundle: Vec<(&str, u64)> = names.iter().map(|n| (n.as_str(), 1)).collect();
            build::minimum_deposit(&w.chain.params, &tokens_of(&bundle)).unwrap()
        };
        let bundle_names: Vec<String> = (0..20).map(|i| format!("m{i:02}")).collect();
        let bundle: Vec<(&str, u64)> = bundle_names.iter().map(|n| (n.as_str(), 1)).collect();
        let origins = [
            (Origin::Lovejoin, Origin::Lovejoin),
            (Origin::Lovejoin, Origin::Mixed),
            (Origin::Mixed, Origin::Lovejoin),
        ];
        let mut wrong = Vec::new();
        // D.
        for (n, m_ada, t_ada, a_ada) in [
            (0u8, least20 + 500_000, 6_500_000, 6_000_000),
            (1, least20 + 500_000, 7_500_000, 6_600_000),
            (2, least20, 6_500_000, 6_000_000),
        ] {
            let m = owned(&w, 0x23 + n, 0, m_ada, &bundle);
            let t = owned(&w, 0x74 + n, 0, t_ada, &[("pooltoken", 1)]);
            let a = owned(&w, 0x33 + n, 0, a_ada, &[]);
            let names = [(&m, "M"), (&t, "T"), (&a, "A")];
            let (ma, mt) = (vec![m.clone(), a.clone()], vec![m.clone(), t.clone()]);
            // With M at its least, M and A pay less than a funding's collateral and the least it pays out.
            let outs: &[Out] = if m_ada == least20 {
                &[Out::Send, Out::Public]
            } else {
                &[Out::Send, Out::Public, Out::Fund]
            };
            for &out in outs {
                let lo = if matches!(out, Out::Fund) {
                    6_100_000
                } else {
                    2_000_000
                };
                let lovelace =
                    most_paid(lo, 30_000_000, |l| pays_out(&w, &ma, out, l).is_ok()) - 20_000;
                let e = pays_out(&w, &mt, out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "D {out:?}: M and T: {e}");
                for (a_origin, t_origin) in origins {
                    let known: Vec<(&UtxoResponse, Class)> = vec![
                        (&m, class("public:0", Origin::Own)),
                        (&t, box_class(&t, t_origin)),
                        (&a, box_class(&a, a_origin)),
                    ];
                    let line = format!(
                        "D (M {m_ada}, T {t_ada}, A {a_ada}): {out:?} of {lovelace}, A {a_origin:?}, T {t_origin:?}"
                    );
                    match picked_out(&w, &known, out, lovelace) {
                        Ok(s) if outpoints(&s) == outpoints(&ma) => {}
                        Ok(s) => wrong.push(format!(
                            "{line}: spent {}, where M and A pay",
                            named(&s, &names)
                        )),
                        Err(e) => wrong.push(format!("{line}: refused: {e}")),
                    }
                }
            }
        }
        // C.
        let mut held: Vec<(&str, u64)> = bundle[..19].to_vec();
        held.push(("sendme", 10));
        let b = owned(&w, 0x22, 0, 10_000_000, &held);
        let t = owned(&w, 0x73, 0, 6_500_000, &[("pooltoken", 1)]);
        let a = owned(&w, 0x32, 0, 6_000_000, &[]);
        let sendme = tokens_of(&[("sendme", 1)]);
        let names = [(&b, "B"), (&t, "T"), (&a, "A")];
        let (ba, bt) = (vec![b.clone(), a.clone()], vec![b.clone(), t.clone()]);
        for public in [false, true] {
            let pays = |inputs: &[UtxoResponse], lovelace: u64| {
                let (seedelfs, pay) = sending(public, lovelace, &sendme);
                pays_many(&w, inputs, &seedelfs, &pay)
            };
            let lovelace = most_paid(2_000_000, 30_000_000, |l| pays(&ba, l).is_ok()) - 20_000;
            let e = pays(&bt, lovelace).unwrap_err();
            assert!(build::is_short(&e), "C, public {public}: B and T: {e}");
            for (a_origin, t_origin) in origins {
                let known: Vec<(&UtxoResponse, Class)> = vec![
                    (&b, received_class(&b)),
                    (&t, box_class(&t, t_origin)),
                    (&a, box_class(&a, a_origin)),
                ];
                let (seedelfs, pay) = sending(public, lovelace, &sendme);
                let line = format!(
                    "C: public {public}, 1 sendme and {lovelace}, A {a_origin:?}, T {t_origin:?}"
                );
                match picked_by(&w, Purpose::Pay, &known, &seedelfs, &pay) {
                    Ok(s) if outpoints(&s) == outpoints(&ba) => {}
                    Ok(s) => wrong.push(format!(
                        "{line}: spent {}, where B and A pay",
                        named(&s, &names)
                    )),
                    Err(e) => wrong.push(format!("{line}: refused: {e}")),
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "two boxes merged where one box of ADA alone pays beside the other money:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l7merge#2, past what orders a and b take: order c takes the fewest of the other money after its boxes,
    /// so its change isn't known up front, and it tries its boxes weighed both ways, beside a change of ADA alone and
    /// beside the change a and b make, which keeps all the other money's tokens. M, 10 ₳ made private holding a pool's
    /// token; T, a way back of that pool, 9 ₳ and its token, which pays all its ADA beside M; A, a way back of 8.9 ₳ of
    /// ADA alone; 25 payments received of 5 ₳, more than one transaction spends beside M. Just under the most T, M and
    /// 20 of them pay, A, M and 20 are short: T, M and 20, one box, where the first weight alone sends A, T, M and 19.
    #[test]
    fn past_the_input_limit_order_c_weighs_a_token_box_beside_the_other_moneys_tokens_too() {
        let w = world();
        let m = owned(&w, 0x01, 0, 10_000_000, &[("pooltoken", 1)]);
        let t = owned(&w, 0x70, 0, 9_000_000, &[("pooltoken", 1)]);
        let a = owned(&w, 0x31, 0, 8_900_000, &[]);
        let payments: Vec<UtxoResponse> = (0..25u8)
            .map(|i| owned(&w, 0x50 + i, 0, 5_000_000, &[]))
            .collect();
        let names = [(&m, "M"), (&t, "T"), (&a, "A")];
        let target = with_first(&[&t, &m], &payments, 20);
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(60_000_000, 160_000_000, |l| {
                pays_out(&w, &target, out, l).is_ok()
            });
            let lovelace = most - 50_000;
            // The premises: A beside M and 20 is short; A and T beside M and 19 pay; M and every payment that gets past
            // the amount, the other money a and b take before any box, are too many inputs.
            let e = pays_out(&w, &with_first(&[&a, &m], &payments, 20), out, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{out:?}: A, M and 20: {e}");
            pays_out(&w, &with_first(&[&a, &t, &m], &payments, 19), out, lovelace)
                .expect("A, T, M and 19 pay");
            let e = pays_out(&w, &with_first(&[&m], &payments, 21), out, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{out:?}: M and 21: {e}");
            let e = pays_out(&w, &with_first(&[&m], &payments, 22), out, lovelace).unwrap_err();
            assert!(build::is_too_many(&e), "{out:?}: M and 22: {e}");
            for (a_origin, t_origin) in [
                (Origin::Lovejoin, Origin::Lovejoin),
                (Origin::Lovejoin, Origin::Mixed),
                (Origin::Mixed, Origin::Lovejoin),
            ] {
                let mut known: Vec<(&UtxoResponse, Class)> = vec![
                    (&m, class("public:0", Origin::Own)),
                    (&t, box_class(&t, t_origin)),
                    (&a, box_class(&a, a_origin)),
                ];
                known.extend(payments.iter().map(|p| (p, received_class(p))));
                let line = format!(
                    "{out:?} of {lovelace} (T, M and 20 pay up to {most}), A {a_origin:?}, T {t_origin:?}"
                );
                match picked_out(&w, &known, out, lovelace) {
                    Ok(s) if outpoints(&s) == outpoints(&target) => {}
                    Ok(s) => wrong.push(format!("{line}: spent {}", named(&s, &names))),
                    Err(e) => wrong.push(format!("{line}: refused: {e}")),
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "two boxes merged where a token box beside the other money's token pays alone:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l8merge#2, l8still#1: beside a change whose last output is full, orders a and b weigh each token box
    /// as opening another output, at its whole least, about 1.6 ₳; two whose tokens share that output pay it once, so a
    /// box of ADA alone weighing more than either went in beside them or in one's place, three boxes where two pay.
    /// Where a or b builds with more than one box whose making the wallet knows, fewer, the largest by the weight
    /// beside a change of ADA alone, now go instead where they build beside the same other money. M, money made private
    /// holding 20 kinds of token, at its least and 0.5 ₳ or at its least; T1 and T2, ways back of token pools, a token
    /// each (one token, two names of one policy, or two policies); A and B, plain ways back of ADA alone. Just under
    /// the most M, T1 and T2 pay, M beside A and B, or beside A or B and one T, is short: M, T1 and T2. E: A alone,
    /// 6.5 ₳, beside T1 and T2 of 7.5 ₳ and the pool's token each, M's 20 kinds of their policy or another. H: a Send
    /// or Make public of one of a token H holds (2.5 ₳, 19 kinds and ten of it), which leaves its change 20 kinds: H,
    /// T1 and T2.
    #[test]
    fn beside_a_full_change_two_token_boxes_sharing_the_output_they_open_go_before_a_box_more() {
        const OTHER_POLICY: &str = "d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";
        let w = world();
        let of_other_policy = |mut u: UtxoResponse| {
            for asset in u.asset_list.iter_mut().flatten() {
                asset.policy_id = OTHER_POLICY.to_string();
            }
            u
        };
        let bundle_names: Vec<String> = (0..20).map(|i| format!("m{i:02}")).collect();
        let bundle: Vec<(&str, u64)> = bundle_names.iter().map(|n| (n.as_str(), 1)).collect();
        let least20 = build::minimum_deposit(&w.chain.params, &tokens_of(&bundle)).unwrap();
        let set = |us: &[&UtxoResponse]| -> Vec<UtxoResponse> {
            us.iter().map(|u| (*u).clone()).collect()
        };
        let mut wrong = Vec::new();
        // The shape the last look found (l8merge#2).
        for (m_ada, t_ada, a_ada) in [
            (least20 + 500_000, 6_500_000, 5_500_000),
            (least20, 6_500_000, 5_500_000),
            (least20 + 500_000, 11_000_000, BOX),
            (least20, 11_000_000, BOX),
        ] {
            for (tokens, t1_name, t2_name, other) in [
                ("one token", "pooltoken", "pooltoken", false),
                ("two names of one policy", "poolA", "poolB", false),
                ("two policies", "poolA", "poolB", true),
            ] {
                let m = owned(&w, 0x23, 0, m_ada, &bundle);
                let t1 = owned(&w, 0x70, 0, t_ada, &[(t1_name, 1)]);
                let t2 = owned(&w, 0x71, 0, t_ada, &[(t2_name, 1)]);
                let t2 = if other { of_other_policy(t2) } else { t2 };
                let a = owned(&w, 0x31, 0, a_ada, &[]);
                let b = owned(&w, 0x32, 0, a_ada, &[]);
                let names = [(&m, "M"), (&t1, "T1"), (&t2, "T2"), (&a, "A"), (&b, "B")];
                let target = set(&[&m, &t1, &t2]);
                for out in [Out::Send, Out::Public, Out::Fund] {
                    let most = most_paid(6_100_000, 40_000_000, |l| {
                        pays_out(&w, &target, out, l).is_ok()
                    });
                    let lovelace = most - 20_000;
                    for (what, inputs) in [
                        ("M, A and B", set(&[&m, &a, &b])),
                        ("M, A and T1", set(&[&m, &a, &t1])),
                        ("M, B and T1", set(&[&m, &b, &t1])),
                        ("M, A and T2", set(&[&m, &a, &t2])),
                        ("M, B and T2", set(&[&m, &b, &t2])),
                    ] {
                        let e = pays_out(&w, &inputs, out, lovelace).unwrap_err();
                        assert!(
                            build::is_short(&e),
                            "{tokens}, M {m_ada}, {out:?}: {what}: {e}"
                        );
                    }
                    let known: Vec<(&UtxoResponse, Class)> = vec![
                        (&m, class("public:0", Origin::Own)),
                        (&t1, box_class(&t1, Origin::Lovejoin)),
                        (&t2, box_class(&t2, Origin::Lovejoin)),
                        (&a, box_class(&a, Origin::Lovejoin)),
                        (&b, box_class(&b, Origin::Lovejoin)),
                    ];
                    let line = format!(
                        "{tokens}, M {m_ada}, T {t_ada}, A = B {a_ada}: {out:?} of {lovelace} (M, T1 and T2 pay up \
                         to {most})"
                    );
                    match picked_out(&w, &known, out, lovelace) {
                        Ok(s) if outpoints(&s) == outpoints(&target) => {}
                        Ok(s) => wrong.push(format!("{line}: spent {}", named(&s, &names))),
                        Err(e) => wrong.push(format!("{line}: refused: {e}")),
                    }
                }
            }
        }
        // E (l8still#1).
        for other in [false, true] {
            let m = owned(&w, 0x24, 0, least20 + 500_000, &bundle);
            let m = if other { of_other_policy(m) } else { m };
            let t1 = owned(&w, 0x72, 0, 7_500_000, &[("pooltoken", 1)]);
            let t2 = owned(&w, 0x73, 0, 7_500_000, &[("pooltoken", 1)]);
            let a = owned(&w, 0x33, 0, 6_500_000, &[]);
            let names = [(&m, "M"), (&t1, "T1"), (&t2, "T2"), (&a, "A")];
            let target = set(&[&m, &t1, &t2]);
            for out in [Out::Send, Out::Public, Out::Fund] {
                let most = most_paid(6_100_000, 40_000_000, |l| {
                    pays_out(&w, &target, out, l).is_ok()
                });
                let lovelace = most - 20_000;
                for (what, inputs) in [
                    ("M, A and T1", set(&[&m, &a, &t1])),
                    ("M, A and T2", set(&[&m, &a, &t2])),
                ] {
                    let e = pays_out(&w, &inputs, out, lovelace).unwrap_err();
                    assert!(
                        build::is_short(&e),
                        "E, other policy {other}, {out:?}: {what}: {e}"
                    );
                }
                let known: Vec<(&UtxoResponse, Class)> = vec![
                    (&m, class("public:0", Origin::Own)),
                    (&t1, box_class(&t1, Origin::Lovejoin)),
                    (&t2, box_class(&t2, Origin::Lovejoin)),
                    (&a, box_class(&a, Origin::Lovejoin)),
                ];
                let line = format!(
                    "E, M's kinds of another policy {other}: {out:?} of {lovelace} (M, T1 and T2 pay up to {most})"
                );
                match picked_out(&w, &known, out, lovelace) {
                    Ok(s) if outpoints(&s) == outpoints(&target) => {}
                    Ok(s) => wrong.push(format!("{line}: spent {}", named(&s, &names))),
                    Err(e) => wrong.push(format!("{line}: refused: {e}")),
                }
            }
        }
        // H (l8still#1): the 20 kinds the holder of a token sent keeps.
        let mut held: Vec<(&str, u64)> = bundle[..19].to_vec();
        held.push(("sendme", 10));
        let h = owned(&w, 0x25, 0, 2_500_000, &held);
        let t1 = owned(&w, 0x74, 0, 7_500_000, &[("pooltoken", 1)]);
        let t2 = owned(&w, 0x75, 0, 7_500_000, &[("pooltoken", 1)]);
        let a = owned(&w, 0x34, 0, 6_500_000, &[]);
        let sendme = tokens_of(&[("sendme", 1)]);
        let names = [(&h, "H"), (&t1, "T1"), (&t2, "T2"), (&a, "A")];
        let target = set(&[&h, &t1, &t2]);
        for public in [false, true] {
            let pays = |inputs: &[UtxoResponse], lovelace: u64| {
                let (seedelfs, pay) = sending(public, lovelace, &sendme);
                pays_many(&w, inputs, &seedelfs, &pay)
            };
            let lovelace = most_paid(2_000_000, 40_000_000, |l| pays(&target, l).is_ok()) - 20_000;
            for (what, inputs) in [
                ("H, A and T1", set(&[&h, &a, &t1])),
                ("H, A and T2", set(&[&h, &a, &t2])),
            ] {
                let e = pays(&inputs, lovelace).unwrap_err();
                assert!(build::is_short(&e), "H, public {public}: {what}: {e}");
            }
            let known: Vec<(&UtxoResponse, Class)> = vec![
                (&h, received_class(&h)),
                (&t1, box_class(&t1, Origin::Lovejoin)),
                (&t2, box_class(&t2, Origin::Lovejoin)),
                (&a, box_class(&a, Origin::Lovejoin)),
            ];
            let (seedelfs, pay) = sending(public, lovelace, &sendme);
            let line = format!("H: public {public}, 1 sendme and {lovelace}");
            match picked_by(&w, Purpose::Pay, &known, &seedelfs, &pay) {
                Ok(s) if outpoints(&s) == outpoints(&target) => {}
                Ok(s) => wrong.push(format!("{line}: spent {}", named(&s, &names))),
                Err(e) => wrong.push(format!("{line}: refused: {e}")),
            }
        }
        assert!(
            wrong.is_empty(),
            "three boxes merged where two token boxes that share the change output they open pay:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l8reference#1: an order hands `more_mixed_built` the weights it took its boxes by (`Known.kept`): read
    /// by the other weight, a box it took can count as one it didn't. A: M, money made private, 10 ₳ and a pool's
    /// token, which a's change keeps; T, a plain way back of that pool, 6.5 ₳ and its token, which beside that change
    /// pays all its ADA and beside one of ADA alone weighs less than X, a mixed way back of 6.4 ₳ of ADA alone. Just
    /// under the most M and X pay, M and T pay too and each alone is short: M and X (rule 4), where by the other weight
    /// X counts as taken and M and T go.
    #[test]
    fn of_as_many_boxes_order_a_swaps_in_a_mixed_one_by_the_weight_it_took_its_boxes_by() {
        let w = world();
        let p = &w.chain.params;
        let m = owned(&w, 0x25, 0, 10_000_000, &[("pooltoken", 1)]);
        let t = owned(&w, 0x76, 0, 6_500_000, &[("pooltoken", 1)]);
        let x = owned(&w, 0x35, 0, 6_400_000, &[]);
        let weight = |kept: &build::Kept| {
            build::box_weight(
                p,
                &box_class(&t, Origin::Lovejoin),
                &[&t],
                build::Weighed::InOne(kept),
            )
            .0
        };
        let (by_ada, by_kept) = (
            weight(&build::Kept::nothing(p)),
            weight(&build::Kept::new(p, tokens_of(&[("pooltoken", 1)]))),
        );
        assert!(
            by_ada < 6_400_000 && 6_400_000 < by_kept,
            "X's ADA between T's two weights: {by_ada}, {by_kept}"
        );
        let names = [(&m, "M"), (&t, "T"), (&x, "X")];
        let (mx, mt) = (vec![m.clone(), x.clone()], vec![m.clone(), t.clone()]);
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let lo = if matches!(out, Out::Fund) {
                6_100_000
            } else {
                2_000_000
            };
            let most = most_paid(lo, 30_000_000, |l| pays_out(&w, &mx, out, l).is_ok());
            let lovelace = most - 50_000;
            pays_out(&w, &mt, out, lovelace)
                .unwrap_or_else(|e| panic!("{out:?}: M and T pay: {e}"));
            for (alone, name) in names {
                let e = pays_out(&w, std::slice::from_ref(alone), out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "{out:?}: {name} alone: {e}");
            }
            let known: Vec<(&UtxoResponse, Class)> = vec![
                (&m, class("public:0", Origin::Own)),
                (&t, box_class(&t, Origin::Lovejoin)),
                (&x, box_class(&x, Origin::Mixed)),
            ];
            match picked_out(&w, &known, out, lovelace) {
                Ok(s) if outpoints(&s) == outpoints(&mx) => {}
                Ok(s) => wrong.push(format!(
                    "{out:?} of {lovelace} (M and X pay up to {most}): spent {}",
                    named(&s, &names)
                )),
                Err(e) => wrong.push(format!("{out:?} of {lovelace}: refused: {e}")),
            }
        }
        assert!(
            wrong.is_empty(),
            "of as many boxes beside a's change, a plain one where a mixed one pays:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l8reference#1: the same past the input limit, in c's first order, which weighs its boxes beside a
    /// change of ADA alone. M, money made private, 10 ₳ and 20 kinds of token; T, a plain way back of 6.5 ₳ and a
    /// pool's token, which opens a second output beside M's 20 kinds; X, a mixed way back of 6 ₳ of ADA alone; 25
    /// payments received of 4.5 ₳. Just under the most T, M and 20 of them pay, X, M and 20 pay, X, M and 19 and M and
    /// 21 are short, and M and 22 are too many: X, M and 20, where by the other weight X counts as taken and T goes.
    #[test]
    fn past_the_input_limit_order_c_swaps_in_a_mixed_one_by_the_weight_it_took_its_boxes_by() {
        let w = world();
        let p = &w.chain.params;
        let kinds: Vec<String> = (0..20).map(|i| format!("m{i:02}")).collect();
        let twenty: Vec<(&str, u64)> = kinds.iter().map(|n| (n.as_str(), 1)).collect();
        let m = owned(&w, 0x26, 0, 10_000_000, &twenty);
        let t = owned(&w, 0x77, 0, 6_500_000, &[("pooltoken", 1)]);
        let x = owned(&w, 0x36, 0, 6_000_000, &[]);
        let payments: Vec<UtxoResponse> = (0..25u8)
            .map(|i| owned(&w, 0x90 + i, 0, 4_500_000, &[]))
            .collect();
        let weight = |kept: &build::Kept| {
            build::box_weight(
                p,
                &box_class(&t, Origin::Lovejoin),
                &[&t],
                build::Weighed::InOne(kept),
            )
            .0
        };
        let (by_ada, by_kept) = (
            weight(&build::Kept::nothing(p)),
            weight(&build::Kept::new(p, tokens_of(&twenty))),
        );
        assert!(
            by_kept < 6_000_000 && 6_000_000 < by_ada,
            "X's ADA between T's two weights: {by_kept}, {by_ada}"
        );
        let names = [(&m, "M"), (&t, "T"), (&x, "X")];
        let plain = with_first(&[&t, &m], &payments, 20);
        let target = with_first(&[&x, &m], &payments, 20);
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(60_000_000, 160_000_000, |l| {
                pays_out(&w, &plain, out, l).is_ok()
            });
            let lovelace = most - 50_000;
            pays_out(&w, &target, out, lovelace)
                .unwrap_or_else(|e| panic!("{out:?}: X, M and 20 pay: {e}"));
            let e = pays_out(&w, &with_first(&[&x, &m], &payments, 19), out, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{out:?}: X, M and 19: {e}");
            let e = pays_out(&w, &with_first(&[&m], &payments, 21), out, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{out:?}: M and 21: {e}");
            let e = pays_out(&w, &with_first(&[&m], &payments, 22), out, lovelace).unwrap_err();
            assert!(build::is_too_many(&e), "{out:?}: M and 22: {e}");
            let mut known: Vec<(&UtxoResponse, Class)> = vec![
                (&m, class("public:0", Origin::Own)),
                (&t, box_class(&t, Origin::Lovejoin)),
                (&x, box_class(&x, Origin::Mixed)),
            ];
            known.extend(payments.iter().map(|p| (p, received_class(p))));
            match picked_out(&w, &known, out, lovelace) {
                Ok(s) if outpoints(&s) == outpoints(&target) => {}
                Ok(s) => wrong.push(format!(
                    "{out:?} of {lovelace} (T, M and 20 pay up to {most}): spent {}",
                    named(&s, &names)
                )),
                Err(e) => wrong.push(format!("{out:?} of {lovelace}: refused: {e}")),
            }
        }
        assert!(
            wrong.is_empty(),
            "past the input limit, of as many boxes beside as many others, a plain one where a mixed one pays:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l7still#2: 1e1b0647's own a (pass d), which takes the boxes by the purpose's rank before tokens and
    /// size, still builds what only it sends in one transaction. 20 payments received of 10 ₳; TM1 and TM2, two mixed
    /// ways back of one token pool, 5.1 ₳ and its token each; P, a plain way back of 5.02 ₳, which weighs more than
    /// either, though they pay more together (their change carries the token once); TP, a plain way back of 7 ₳ and 19
    /// tokens. Just under the most the 20, TM1 and TM2 pay: the 20 beside P and TM1, P and TP, or TP and TM1 are short,
    /// and 23 inputs too many. The rule's orders, by either weight, and 1e1b0647's b and c (the token boxes by size,
    /// TP first) try none of the 20, TM1 and TM2; its a, the mixed boxes first, sends it.
    #[test]
    fn where_only_1e1b0647s_a_takes_mixed_boxes_first_it_still_goes_in_one() {
        let w = world();
        let money: Vec<UtxoResponse> = (0..20u8)
            .map(|i| owned(&w, 0x10 + i, 0, 10_000_000, &[]))
            .collect();
        let tm1 = owned(&w, 0x40, 0, 5_100_000, &[("Y", 1)]);
        let tm2 = owned(&w, 0x41, 0, 5_100_000, &[("Y", 1)]);
        let p = owned(&w, 0x42, 0, 5_020_000, &[]);
        let many_names: Vec<String> = (0..19)
            .map(|i| format!("{i:02}{}", "n".repeat(30)))
            .collect();
        let many: Vec<(&str, u64)> = many_names.iter().map(|n| (n.as_str(), 1)).collect();
        let tp = owned(&w, 0x43, 0, 7_000_000, &many);
        let with = |extra: &[&UtxoResponse]| -> Vec<UtxoResponse> {
            money
                .iter()
                .cloned()
                .chain(extra.iter().map(|u| (*u).clone()))
                .collect()
        };
        let target = with(&[&tm1, &tm2]);
        let mut known: Vec<(&UtxoResponse, Class)> =
            money.iter().map(|u| (u, received_class(u))).collect();
        known.push((&tm1, box_class(&tm1, Origin::Mixed)));
        known.push((&tm2, box_class(&tm2, Origin::Mixed)));
        known.push((&p, box_class(&p, Origin::Lovejoin)));
        known.push((&tp, box_class(&tp, Origin::Lovejoin)));
        let names = [(&tm1, "TM1"), (&tm2, "TM2"), (&p, "P"), (&tp, "TP")];
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(150_000_000, 230_000_000, |l| {
                pays_out(&w, &target, out, l).is_ok()
            });
            let lovelace = most - 10_000;
            for (what, inputs) in [
                ("the 20, P and TM1", with(&[&p, &tm1])),
                ("the 20, P and TP", with(&[&p, &tp])),
                ("the 20, TP and TM1", with(&[&tp, &tm1])),
            ] {
                let e = pays_out(&w, &inputs, out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "{out:?}: {what}: {e}");
            }
            let e = pays_out(&w, &with(&[&tm1, &tm2, &p]), out, lovelace).unwrap_err();
            assert!(build::is_too_many(&e), "{out:?}: 23 inputs: {e}");
            match picked_out(&w, &known, out, lovelace) {
                Ok(spent) if outpoints(&spent) == outpoints(&target) => {}
                Ok(spent) => wrong.push(format!(
                    "{out:?} of {lovelace}: spent {}, not the 20, TM1 and TM2",
                    named(&spent, &names)
                )),
                Err(e) => wrong.push(format!(
                    "{out:?} of {lovelace} (the 20, TM1 and TM2 pay up to {most}): refused: {e}"
                )),
            }
        }
        assert!(
            wrong.is_empty(),
            "refused, or another set, where 1e1b0647's a sent the 20, TM1 and TM2 as one transaction:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 51, l7still#2: 1e1b0647's own step 1 (pass d's singles) still builds what only it sends in one transaction.
    /// A Send of 21 Q and about 49 ₳ beside the 21 UTxOs holding them, 2 ₳ and a Q each, the first also an R (of the
    /// file's policy). X, of the first holder's class (of unknown making), 10 ₳ and an R, which its change keeps anyway,
    /// so X pays all its ADA: the holders and X pay. H, a plain way back of 10.05 ₳ and a Z of another policy, which ZH
    /// (3 ₳ received) holds too: beside the change a and b make H weighs more than X, and alone it pays less. P1 to P12,
    /// plain ways back of 11 ₳ and 19 tokens each, of the second holder's class, short beside the holders. Step 1 here
    /// asks H and eleven of them and passes X by for its cap; 1e1b0647's asked X first, by size alone.
    #[test]
    fn where_only_1e1b0647s_step_1_asks_a_box_it_still_goes_in_one() {
        let w = world();
        const OTHER_POLICY: &str = "d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";
        let of_other_policy = |mut u: UtxoResponse| {
            for asset in u.asset_list.iter_mut().flatten() {
                asset.policy_id = OTHER_POLICY.to_string();
            }
            u
        };
        let holders: Vec<UtxoResponse> = (0..21u8)
            .map(|i| {
                let tokens: &[(&str, u64)] = if i == 0 {
                    &[("Q", 1), ("R", 1)]
                } else {
                    &[("Q", 1)]
                };
                owned(&w, 0x10 + i, 0, 2_000_000, tokens)
            })
            .collect();
        let x = owned(&w, 0x40, 0, 10_000_000, &[("R", 1)]);
        let h = of_other_policy(owned(&w, 0x41, 0, 10_050_000, &[("Z", 1)]));
        let zh = of_other_policy(owned(&w, 0x42, 0, 3_000_000, &[("Z", 1)]));
        let many_names: Vec<String> = (0..19)
            .map(|i| format!("{i:02}{}", "n".repeat(30)))
            .collect();
        let many: Vec<(&str, u64)> = many_names.iter().map(|n| (n.as_str(), 1)).collect();
        let ps: Vec<UtxoResponse> = (0..12u8)
            .map(|i| owned(&w, 0x50 + i, 0, 11_000_000, &many))
            .collect();
        let unknown = class("box:kk+unknown:kk", Origin::Lovejoin);
        let plain = class("box:ll", Origin::Lovejoin);
        let mut known: Vec<(&UtxoResponse, Class)> = holders
            .iter()
            .enumerate()
            .map(|(i, u)| {
                let c = match i {
                    0 => unknown.clone(),
                    1 => plain.clone(),
                    _ => received_class(u),
                };
                (u, c)
            })
            .collect();
        known.push((&x, unknown.clone()));
        known.push((&h, plain.clone()));
        known.push((&zh, received_class(&zh)));
        known.extend(ps.iter().map(|u| (u, plain.clone())));
        let q21 = tokens_of(&[("Q", 21)]);
        let with = |extra: &[&UtxoResponse]| -> Vec<UtxoResponse> {
            holders
                .iter()
                .cloned()
                .chain(extra.iter().map(|u| (*u).clone()))
                .collect()
        };
        let pays = |inputs: &[UtxoResponse], lovelace: u64| {
            let (seedelfs, pay) = sending(false, lovelace, &q21);
            pays_many(&w, inputs, &seedelfs, &pay)
        };
        let target = with(&[&x]);
        let most = most_paid(40_000_000, 60_000_000, |l| pays(&target, l).is_ok());
        let lovelace = most - 10_000;
        for (what, inputs) in [
            ("the 21 alone", with(&[])),
            ("the 21 and H", with(&[&h])),
            ("the 21 and ZH", with(&[&zh])),
            ("the 21 and P1", with(&[&ps[0]])),
        ] {
            let e = pays(&inputs, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{what}: {e}");
        }
        let e = pays(&with(&[&x, &h]), lovelace).unwrap_err();
        assert!(build::is_too_many(&e), "23 inputs: {e}");
        let (seedelfs, pay) = sending(false, lovelace, &q21);
        let names = [(&x, "X"), (&h, "H"), (&zh, "ZH")];
        match picked_by(&w, Purpose::Pay, &known, &seedelfs, &pay) {
            Ok(spent) if outpoints(&spent) == outpoints(&target) => {}
            Ok(spent) => panic!(
                "a Send of 21 Q and {lovelace}: spent {}, not the 21 and X",
                named(&spent, &names)
            ),
            Err(e) => panic!(
                "a Send of 21 Q and {lovelace} (the 21 and X pay up to {most}), which 1e1b0647's step 1 sent as one \
                 transaction: refused: {e}"
            ),
        }
    }

    // Chunk 52: the shapes chunk 51's last looks found the weighed orders missing (review8.json), where the box rule's
    // merge now searches every set of a balance's few boxes. Each picks the rule's best, and each fails on 1.9.2's
    // build.rs.

    /// `u` with each of its tokens of `policy` instead of the file's.
    fn of_policy(mut u: UtxoResponse, policy: &str) -> UtxoResponse {
        for asset in u.asset_list.iter_mut().flatten() {
            asset.policy_id = policy.to_string();
        }
        u
    }

    /// Chunk 52, l8merge#1: l7merge#1's A beside small money. T1 and T2, two plain ways back of one token pool, 6 ₳ and
    /// its token each; A, a plain way back of 5.9 ₳; U, one of unknown making of 6.5 ₳; 20 payments received of 10 ₳;
    /// and 1 to 5 more received of 2 or 3 ₳. Just under the most T1, T2 and the 20 pay in 22 inputs, A and either one
    /// beside the 20 are short, and U, A and the 20 pay: T1, T2 and the 20, never U. 1.9.2 spent U, A and the 20: with
    /// the small money at its start, neither its orders nor 1e1b0647's held T1 and T2 without A.
    #[test]
    fn beside_small_payments_a_box_of_unknown_making_stays_out_where_one_pools_ways_back_pay() {
        let w = world();
        let a = owned(&w, 0x31, 0, 5_900_000, &[]);
        let t1 = owned(&w, 0x70, 0, 6_000_000, &[("pooltoken", 1)]);
        let t2 = owned(&w, 0x71, 0, 6_000_000, &[("pooltoken", 1)]);
        let u = owned(&w, 0x90, 0, 6_500_000, &[]);
        let payments: Vec<UtxoResponse> = (0..20u8)
            .map(|i| owned(&w, 0x50 + i, 0, 10_000_000, &[]))
            .collect();
        let names = [(&a, "A"), (&t1, "T1"), (&t2, "T2"), (&u, "U")];
        let both = with_first(&[&t1, &t2], &payments, 20);
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(150_000_000, 230_000_000, |l| {
                pays_out(&w, &both, out, l).is_ok()
            });
            let lovelace = most - 20_000;
            for (what, inputs) in [
                ("A, T1 and the 20", with_first(&[&a, &t1], &payments, 20)),
                ("A, T2 and the 20", with_first(&[&a, &t2], &payments, 20)),
                ("U and the 20", with_first(&[&u], &payments, 20)),
            ] {
                let e = pays_out(&w, &inputs, out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "{out:?}: {what}: {e}");
            }
            pays_out(&w, &with_first(&[&u, &a], &payments, 20), out, lovelace)
                .expect("U, A and the 20 pay");
            for (count, small) in [
                (1u8, 3_000_000),
                (2, 2_000_000),
                (3, 3_000_000),
                (5, 2_000_000),
            ] {
                let smalls: Vec<UtxoResponse> = (0..count)
                    .map(|i| owned(&w, 0xa0 + i, 0, small, &[]))
                    .collect();
                let e = pays_out(
                    &w,
                    &[with_first(&[&t1], &payments, 20), smalls[..1].to_vec()].concat(),
                    out,
                    lovelace,
                )
                .unwrap_err();
                assert!(
                    build::is_short(&e),
                    "{out:?}: T1, the 20 and a small one: {e}"
                );
                let mut known: Vec<(&UtxoResponse, Class)> = vec![
                    (&a, box_class(&a, Origin::Lovejoin)),
                    (&t1, box_class(&t1, Origin::Lovejoin)),
                    (&t2, box_class(&t2, Origin::Lovejoin)),
                    (&u, unknown_class(&u)),
                ];
                known.extend(
                    payments
                        .iter()
                        .chain(&smalls)
                        .map(|p| (p, received_class(p))),
                );
                let line = format!(
                    "{out:?} of {lovelace} beside {count} more of {small} (T1, T2 and the 20 pay up to {most})"
                );
                match picked_out(&w, &known, out, lovelace) {
                    Ok(spent) if outpoints(&spent) == outpoints(&both) => {}
                    Ok(spent) => wrong.push(format!("{line}: spent {}", named(&spent, &names))),
                    Err(e) => wrong.push(format!("{line}: refused: {e}")),
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a box of unknown making merged where T1, T2 and the 20 pay without one:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 52, l8still#2: l7still#1's balance beside a third token box. T1 and T2, plain ways back of one token pool, 6
    /// ₳ and its token each; T3, a plain way back a little larger, holding another policy's token or another of the
    /// pool policy's; A, a plain way back of 5.9 ₳, or none; U, one of unknown making of 10 ₳; 20 payments received of
    /// 10 ₳. Just under the most T1, T2 and the 20 pay, every other two of the boxes beside the 20 are short, all of them
    /// too many, and U beside one of them pays: T1, T2 and the 20, never U. 1.9.2 spent U: T3 weighed more than T1 or
    /// T2 alone, so neither its orders nor 1e1b0647's held T1 and T2 without T3 or A.
    #[test]
    fn beside_a_third_token_box_a_box_of_unknown_making_stays_out_where_one_pools_ways_back_pay() {
        const OTHER_POLICY: &str = "d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";
        let w = world();
        let t1 = owned(&w, 0x70, 0, 6_000_000, &[("pooltoken", 1)]);
        let t2 = owned(&w, 0x71, 0, 6_000_000, &[("pooltoken", 1)]);
        let a = owned(&w, 0x31, 0, 5_900_000, &[]);
        let u = owned(&w, 0x32, 0, 10_000_000, &[]);
        let payments: Vec<UtxoResponse> = (0..20u8)
            .map(|i| owned(&w, 0x50 + i, 0, 10_000_000, &[]))
            .collect();
        let both = with_first(&[&t1, &t2], &payments, 20);
        let mut wrong = Vec::new();
        for (what, t3) in [
            (
                "another policy, 6.01 ₳",
                of_policy(owned(&w, 0x72, 0, 6_010_000, &[("X", 1)]), OTHER_POLICY),
            ),
            (
                "another policy, 6.05 ₳",
                of_policy(owned(&w, 0x73, 0, 6_050_000, &[("X", 1)]), OTHER_POLICY),
            ),
            (
                "the pool's policy, 6.02 ₳",
                owned(&w, 0x74, 0, 6_020_000, &[("pooltokeB", 1)]),
            ),
        ] {
            for with_a in [true, false] {
                let mut boxes: Vec<(&UtxoResponse, &str)> =
                    vec![(&t1, "T1"), (&t2, "T2"), (&t3, "T3")];
                if with_a {
                    boxes.push((&a, "A"));
                }
                let mut names = boxes.clone();
                names.push((&u, "U"));
                for out in [Out::Send, Out::Public, Out::Fund] {
                    let most = most_paid(150_000_000, 230_000_000, |l| {
                        pays_out(&w, &both, out, l).is_ok()
                    });
                    // T1 and T3 of the pool's policy pay 0.01 ₳ less.
                    let lovelace = most - 2_000;
                    for (i, (x, xn)) in boxes.iter().enumerate() {
                        for (y, yn) in &boxes[i + 1..] {
                            if [*xn, *yn] == ["T1", "T2"] {
                                continue;
                            }
                            let e =
                                pays_out(&w, &with_first(&[x, y], &payments, 20), out, lovelace)
                                    .unwrap_err();
                            assert!(
                                build::is_short(&e),
                                "{what}, {out:?}: {xn}, {yn} and the 20: {e}"
                            );
                        }
                    }
                    pays_out(&w, &with_first(&[&u, &t3], &payments, 20), out, lovelace)
                        .expect("U, T3 and the 20 pay");
                    let mut known: Vec<(&UtxoResponse, Class)> = boxes
                        .iter()
                        .map(|(b, _)| (*b, box_class(b, Origin::Lovejoin)))
                        .collect();
                    known.push((&u, unknown_class(&u)));
                    known.extend(payments.iter().map(|p| (p, received_class(p))));
                    let line = format!(
                        "T3 of {what}, A {with_a}: {out:?} of {lovelace} (T1, T2 and the 20 pay up to {most})"
                    );
                    match picked_out(&w, &known, out, lovelace) {
                        Ok(spent) if outpoints(&spent) == outpoints(&both) => {}
                        Ok(spent) => wrong.push(format!("{line}: spent {}", named(&spent, &names))),
                        Err(e) => wrong.push(format!("{line}: refused: {e}")),
                    }
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a box of unknown making merged where T1, T2 and the 20 pay without one:\n{}",
            wrong.join("\n")
        );
    }

    /// Chunk 52, l8still#1's F (rule 4): M, money made private holding 20 kinds of token at their least and 3 ₳; R, 3
    /// ₳ received; T, a plain way back of 7.5 ₳ and a pool's token; X, a mixed way back of 5.9 ₳ and that token; A, a
    /// plain way back of 6 ₳; maybe U1 and U2, of unknown making. Just under the most T, X, M and R pay, T, A, M and R
    /// pay too, and one box beside M and R is short: T and X, one a mix moved. 1.9.2 spent T and A: beside a change of
    /// 20 kinds it weighed X as opening an output of its own, which it shares with T.
    #[test]
    fn of_as_many_boxes_a_mixed_one_goes_where_its_token_shares_the_output_another_opens() {
        const BUNDLE_POLICY: &str = "e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0";
        const X_POLICY: &str = "d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";
        let w = world();
        let bundle_names: Vec<String> = (0..20).map(|i| format!("m{i:02}")).collect();
        let bundle: Vec<(&str, u64)> = bundle_names.iter().map(|n| (n.as_str(), 1)).collect();
        let least20 = {
            let probe = of_policy(owned(&w, 0x28, 0, 0, &bundle), BUNDLE_POLICY);
            let (_, kinds) = seedelf_core::utxos::assets_of(vec![probe]).unwrap();
            build::minimum_deposit(&w.chain.params, &kinds).unwrap()
        };
        let m = of_policy(
            owned(&w, 0x28, 0, least20 + 3_000_000, &bundle),
            BUNDLE_POLICY,
        );
        let r = owned(&w, 0x29, 0, 3_000_000, &[]);
        let t = owned(&w, 0x78, 0, 7_500_000, &[("poolB", 1)]);
        let x = owned(&w, 0x79, 0, 5_900_000, &[("poolB", 1)]);
        let a = owned(&w, 0x38, 0, 6_000_000, &[]);
        let u1 = of_policy(owned(&w, 0x91, 0, 6_000_000, &[("X", 1)]), X_POLICY);
        let u2 = owned(&w, 0x92, 0, BOX, &[("poolB", 1)]);
        let names = [
            (&m, "M"),
            (&r, "R"),
            (&t, "T"),
            (&x, "X"),
            (&a, "A"),
            (&u1, "U1"),
            (&u2, "U2"),
        ];
        let set = |us: &[&UtxoResponse]| -> Vec<UtxoResponse> {
            us.iter().map(|u| (*u).clone()).collect()
        };
        let target = set(&[&m, &r, &t, &x]);
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(6_100_000, 40_000_000, |l| {
                pays_out(&w, &target, out, l).is_ok()
            });
            let lovelace = most - 20_000;
            pays_out(&w, &set(&[&m, &r, &t, &a]), out, lovelace).expect("T, A, M and R pay");
            for (what, inputs) in [
                ("X, A, M and R", set(&[&m, &r, &x, &a])),
                ("T, M and R", set(&[&m, &r, &t])),
                ("A, M and R", set(&[&m, &r, &a])),
            ] {
                let e = pays_out(&w, &inputs, out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "{out:?}: {what}: {e}");
            }
            for with_unknown in [false, true] {
                let mut known: Vec<(&UtxoResponse, Class)> = vec![
                    (&m, class("public:0", Origin::Own)),
                    (&r, received_class(&r)),
                    (&t, box_class(&t, Origin::Lovejoin)),
                    (&x, box_class(&x, Origin::Mixed)),
                    (&a, box_class(&a, Origin::Lovejoin)),
                ];
                if with_unknown {
                    known.push((&u1, unknown_class(&u1)));
                    known.push((&u2, unknown_class(&u2)));
                }
                let line = format!(
                    "{out:?} of {lovelace}, U1 and U2 {with_unknown} (T, X, M and R pay up to {most})"
                );
                match picked_out(&w, &known, out, lovelace) {
                    Ok(spent) if outpoints(&spent) == outpoints(&target) => {}
                    Ok(spent) => wrong.push(format!("{line}: spent {}", named(&spent, &names))),
                    Err(e) => wrong.push(format!("{line}: refused: {e}")),
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "of two boxes, a plain one merged where a mixed one pays beside the same other money:\n{}",
            wrong.join("\n")
        );
    }

    // 1.9.3's release review: the exact search's shapes its reviewers found and one beside them, each picking the rule's
    // best, which 1.9.2 picked too but for r1#1's and r2#3's, and each failing on the reviewed build.rs.

    /// `u` holding one of each (policy, name) token in `tokens` instead of its own.
    fn holding_kinds(mut u: UtxoResponse, tokens: &[(String, Vec<u8>)]) -> UtxoResponse {
        u.asset_list = Some(
            tokens
                .iter()
                .map(|(policy, name)| Asset {
                    decimals: 0,
                    quantity: "1".into(),
                    policy_id: policy.clone(),
                    asset_name: hex::encode(name),
                    fingerprint: String::new(),
                })
                .collect(),
        );
        u
    }

    /// `u` holding `lovelace`.
    fn with_lovelace(mut u: UtxoResponse, lovelace: u64) -> UtxoResponse {
        u.value = lovelace.to_string();
        u
    }

    /// The least the wallet's change needs for `u`'s tokens ([`build::minimum_deposit`]).
    fn wallet_least(w: &World, u: &UtxoResponse) -> u64 {
        let (_, tokens) = seedelf_core::utxos::assets_of(vec![u.clone()]).unwrap();
        build::minimum_deposit(&w.chain.params, &tokens).unwrap()
    }

    /// The least the ledger takes for an output of the wallet contract holding `u`'s tokens under a register, as a
    /// stranger can pay one: under what the wallet's change needs for them, which it sizes at a base address, so it adds
    /// less than nothing by its tokens' whole least.
    fn least_on_chain(w: &World, u: &UtxoResponse) -> u64 {
        let register = w.owner.clone().rerandomize().unwrap();
        let mut output = pallas_txbuilder::Output::new(w.wallet.clone(), 5_000_000)
            .set_inline_datum(register.to_vec().unwrap());
        for a in u.asset_list.iter().flatten() {
            let policy: [u8; 28] = hex::decode(&a.policy_id).unwrap().try_into().unwrap();
            output = output
                .add_asset(
                    Hash::new(policy),
                    hex::decode(&a.asset_name).unwrap(),
                    a.quantity.parse().unwrap(),
                )
                .unwrap();
        }
        seedelf_core::transaction::calculate_min_required_utxo(output, &w.chain.params).unwrap()
    }

    /// The most a Send pays from exactly `inputs`.
    fn most_sent(w: &World, inputs: &[UtxoResponse]) -> u64 {
        let all: u64 = inputs.iter().map(|u| u.value.parse::<u64>().unwrap()).sum();
        most_paid(2_000_000, all, |l| {
            pays_out(w, inputs, Out::Send, l).is_ok()
        })
    }

    /// 1.9.3's release review, r2#1: c's orders take a UTxO that adds less than nothing after the rest of the other
    /// money, and a's leave it out, so beside such a UTxO c runs at a level where all the rest is short beside every set.
    /// K1, a plain way back of 10 ₳ and pool A's token; K2, a plain way back of pool B's at its least; O, 3 ₳ made
    /// private; a stranger's payment of pool A's token at the least the ledger takes for it, which adds less than nothing
    /// by its whole least and most of its ADA beside K1's token. The most K1, O and the stranger's pay, which O and both
    /// boxes can't: K1, O and the stranger's, one box, as 1.9.2's c took them. The reviewed search skipped c there and
    /// spent both boxes and the stranger's.
    #[test]
    fn beside_a_strangers_token_at_its_least_one_box_goes_where_c_takes_it_after_the_rest() {
        let w = world();
        let (pool_a, pool_b) = (hex::encode([0x51u8; 28]), hex::encode([0x52u8; 28]));
        let k1 = of_policy(owned(&w, 0xc1, 0, 10_000_000, &[("poolA", 1)]), &pool_a);
        let k2 = of_policy(owned(&w, 0xc2, 0, 0, &[("poolB", 1)]), &pool_b);
        let k2 = with_lovelace(k2.clone(), wallet_least(&w, &k2));
        let o = owned(&w, 0xc3, 0, 3_000_000, &[]);
        let pile = of_policy(owned(&w, 0xc4, 0, 0, &[("poolA", 1)]), &pool_a);
        let pile = with_lovelace(pile.clone(), least_on_chain(&w, &pile));
        assert!(build::adds(&w.chain.params, &pile).unwrap() < 0);
        let target = [k1.clone(), o.clone(), pile.clone()];
        let lovelace = most_sent(&w, &target);
        for (what, inputs) in [
            (
                "O and both boxes",
                [o.clone(), k1.clone(), k2.clone()].to_vec(),
            ),
            ("O and K1", [o.clone(), k1.clone()].to_vec()),
            ("O and the stranger's", [o.clone(), pile.clone()].to_vec()),
        ] {
            let e = pays_out(&w, &inputs, Out::Send, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{what}: {e}");
        }
        let known = [
            (&k1, box_class(&k1, Origin::Lovejoin)),
            (&k2, box_class(&k2, Origin::Lovejoin)),
            (&o, class("public:0", Origin::Own)),
            (&pile, received_class(&pile)),
        ];
        let names = [
            (&k1, "K1"),
            (&k2, "K2"),
            (&o, "O"),
            (&pile, "the stranger's"),
        ];
        let spent = picked_out(&w, &known, Out::Send, lovelace).expect("it pays");
        assert_eq!(
            outpoints(&spent),
            outpoints(&target),
            "a Send of {lovelace}: spent {}",
            named(&spent, &names)
        );
    }

    /// r2#1 at a level of one box of unknown making: U2, of unknown making, 10 ₳; U1, of unknown making, pool B's way back
    /// at its least; K1, O and the stranger's as above. U2, K1, O and the stranger's pay, and so do O, U2, K1 and U1;
    /// without the stranger's or U1, those don't. U2, K1, O and the stranger's, one of unknown making, as 1.9.2's c took
    /// them; the reviewed search spent two.
    #[test]
    fn beside_a_strangers_token_at_its_least_one_box_of_unknown_making_goes_where_c_takes_it_after_the_rest()
     {
        let w = world();
        let (pool_a, pool_b) = (hex::encode([0x51u8; 28]), hex::encode([0x52u8; 28]));
        let k1 = of_policy(owned(&w, 0xd1, 0, 10_000_000, &[("poolA", 1)]), &pool_a);
        let u2 = owned(&w, 0xd2, 0, 10_000_000, &[]);
        let u1 = of_policy(owned(&w, 0xd3, 0, 0, &[("poolB", 1)]), &pool_b);
        let u1 = with_lovelace(u1.clone(), wallet_least(&w, &u1));
        let o = owned(&w, 0xd4, 0, 3_000_000, &[]);
        let pile = of_policy(owned(&w, 0xd5, 0, 0, &[("poolA", 1)]), &pool_a);
        let pile = with_lovelace(pile.clone(), least_on_chain(&w, &pile));
        let one = [u2.clone(), k1.clone(), o.clone(), pile.clone()];
        let two = [o.clone(), u2.clone(), k1.clone(), u1.clone()];
        let lovelace = most_sent(&w, &one).min(most_sent(&w, &two));
        pays_out(&w, &two, Out::Send, lovelace).expect("two of unknown making pay");
        let e = pays_out(&w, &two[..3], Out::Send, lovelace).unwrap_err();
        assert!(build::is_short(&e), "O, U2 and K1: {e}");
        let known = [
            (&k1, box_class(&k1, Origin::Lovejoin)),
            (&u2, unknown_class(&u2)),
            (&u1, unknown_class(&u1)),
            (&o, class("public:0", Origin::Own)),
            (&pile, received_class(&pile)),
        ];
        let names = [
            (&k1, "K1"),
            (&u2, "U2"),
            (&u1, "U1"),
            (&o, "O"),
            (&pile, "the stranger's"),
        ];
        let spent = picked_out(&w, &known, Out::Send, lovelace).expect("it pays");
        assert_eq!(
            outpoints(&spent),
            outpoints(&one),
            "a Send of {lovelace}: spent {}",
            named(&spent, &names)
        );
    }

    /// r2#1 where all the other money beside every set of a level is too large for one transaction rather than short:
    /// fewer of it can fit, though it holds no token. P, a plain way back, and M, one a mix moved, 30 ₳ each, listed in
    /// that order; R, 120 ₳ received; 15 payments received of 1.5 ₳; a Send of 1.5 ₳ to each of 91 Seedelfs, which
    /// leaves room for 13 inputs. The other money alone pays only in more inputs than fit, and a box beside all of it is
    /// too large: M and R, one box, the one a mix moved, as 1.9.2's c took them. The reviewed search skipped c there,
    /// and its pass of 1e1b0647's own orders spent P and R.
    #[test]
    fn where_all_the_other_money_is_too_large_beside_every_box_one_a_mix_moved_goes_beside_less() {
        let w = world();
        let p = owned(&w, 0x61, 0, 30_000_000, &[]);
        let m = owned(&w, 0x62, 0, 30_000_000, &[]);
        let r = owned(&w, 0x63, 0, 120_000_000, &[]);
        let smalls: Vec<UtxoResponse> = (0..15u8)
            .map(|i| owned(&w, 0x70 + i, 0, 1_500_000, &[]))
            .collect();
        let seedelfs: Vec<Payment> = (0..91).map(|_| paying(1_500_000)).collect();
        let pays = |inputs: &[UtxoResponse]| pays_many(&w, inputs, &seedelfs, &[]);
        pays(&[m.clone(), r.clone()]).expect("M and R pay");
        let all = [vec![r.clone()], smalls.clone()].concat();
        let money_alone = (1..=all.len())
            .find(|&k| !pays(&all[..k]).as_ref().is_err_and(build::is_short))
            .expect("all the other money is short or too large");
        let e = pays(&all[..money_alone]).unwrap_err();
        assert!(
            build::is_too_large(&e),
            "the other money alone, the fewest not short: {e}"
        );
        let e = pays(&[all.clone(), vec![m.clone()]].concat()).unwrap_err();
        assert!(build::is_too_large(&e), "M beside all of it: {e}");
        let mut known: Vec<(&UtxoResponse, Class)> = vec![
            (&p, box_class(&p, Origin::Lovejoin)),
            (&m, box_class(&m, Origin::Mixed)),
            (&r, received_class(&r)),
        ];
        known.extend(smalls.iter().map(|s| (s, received_class(s))));
        let names = [(&p, "P"), (&m, "M"), (&r, "R")];
        let spent = picked_by(&w, Purpose::Pay, &known, &seedelfs, &[]).expect("it pays");
        assert_eq!(
            outpoints(&spent),
            outpoints(&[m.clone(), r.clone()]),
            "spent {}",
            named(&spent, &names)
        );
    }

    /// 1.9.3's release review, r2#2: the exact search builds a set's boxes in a's weighed order, as 1.9.2's a took them.
    /// H, money made private holding 19 kinds of one policy at their least and 5 ₳; A and B, plain ways back of 6 ₳, A
    /// holding a token of another policy and B one of H's, listed in that order. A change takes its tokens 20 kinds to an
    /// output in the order the inputs bring them: B first fills H's output with no new policy, where A first takes one
    /// there and B opens another output. The most H, B and A pay, which H, A and B can't: built, from all three, as 1.9.2
    /// built it (its a weighed B over A beside H's change). The reviewed search built the boxes in the balance's order,
    /// and refused.
    #[test]
    fn two_token_boxes_that_pay_in_the_weighed_order_are_never_refused() {
        let w = world();
        let policy = hex::encode([0x71u8; 28]);
        let names: Vec<String> = (0..19).map(|i| format!("h{i:02}")).collect();
        let bundle: Vec<(&str, u64)> = names.iter().map(|n| (n.as_str(), 1)).collect();
        let h = of_policy(owned(&w, 0xe1, 0, 0, &bundle), &policy);
        let h = with_lovelace(h.clone(), wallet_least(&w, &h) + 5_000_000);
        let a = of_policy(
            owned(&w, 0xe2, 0, 6_000_000, &[("a", 1)]),
            &hex::encode([0x72u8; 28]),
        );
        let b = of_policy(owned(&w, 0xe3, 0, 6_000_000, &[("b", 1)]), &policy);
        let weighed = most_sent(&w, &[h.clone(), b.clone(), a.clone()]);
        let listed = most_sent(&w, &[h.clone(), a.clone(), b.clone()]);
        assert!(weighed > listed, "{weighed} against {listed}");
        let known = [
            (&a, box_class(&a, Origin::Lovejoin)),
            (&b, box_class(&b, Origin::Lovejoin)),
            (&h, class("public:0", Origin::Own)),
        ];
        let spent = picked_out(&w, &known, Out::Send, weighed)
            .expect("H, B and A pay as one transaction, as 1.9.2 built them");
        assert_eq!(outpoints(&spent), outpoints(&[h, a, b]));
    }

    /// 1.9.3's release review, r2#3 (rules 4 and 5): where the plain choice goes beside all the other money, a set a mix
    /// moved more of goes beside less of it where that pays. T, money made private holding 19 kinds of one policy at
    /// their least; O, 5 ₳ received; P, a plain way back of 10 ₳; M1 and M2, ways back a mix moved, 6 ₳ and a token of
    /// another policy each. Beside T, M1 and M2's tokens take a second output of change; beside O alone they pay, and P
    /// and M1 pay beside T and O. M1 and M2 beside O: two a mix moved, beside one other input fewer. The reviewed
    /// search, as 1.9.2, spent T, O, P and M1.
    #[test]
    fn of_as_many_boxes_the_most_mixed_go_where_they_pay_beside_less_of_the_other_money() {
        let w = world();
        let names: Vec<String> = (0..19).map(|i| format!("h{i:02}")).collect();
        let bundle: Vec<(&str, u64)> = names.iter().map(|n| (n.as_str(), 1)).collect();
        let t = of_policy(owned(&w, 0xf1, 0, 0, &bundle), &hex::encode([0x71u8; 28]));
        let t = with_lovelace(t.clone(), wallet_least(&w, &t));
        let o = owned(&w, 0xf2, 0, 5_000_000, &[]);
        let p = owned(&w, 0xf3, 0, 10_000_000, &[]);
        let m1 = of_policy(
            owned(&w, 0xf4, 0, 6_000_000, &[("b", 1)]),
            &hex::encode([0x73u8; 28]),
        );
        let m2 = of_policy(
            owned(&w, 0xf5, 0, 6_000_000, &[("c", 1)]),
            &hex::encode([0x74u8; 28]),
        );
        let target = [m1.clone(), m2.clone(), o.clone()];
        let plain = [o.clone(), t.clone(), p.clone(), m1.clone()];
        let lovelace = most_sent(&w, &target).min(most_sent(&w, &plain));
        for (what, inputs) in [
            (
                "M1 and M2 beside O and T",
                vec![o.clone(), t.clone(), m1.clone(), m2.clone()],
            ),
            ("P beside O and T", vec![o.clone(), t.clone(), p.clone()]),
            ("M1 beside O and T", vec![o.clone(), t.clone(), m1.clone()]),
        ] {
            let e = pays_out(&w, &inputs, Out::Send, lovelace).unwrap_err();
            assert!(build::is_short(&e), "{what}: {e}");
        }
        let known = [
            (&p, box_class(&p, Origin::Lovejoin)),
            (&m1, box_class(&m1, Origin::Mixed)),
            (&m2, box_class(&m2, Origin::Mixed)),
            (&t, class("public:0", Origin::Own)),
            (&o, received_class(&o)),
        ];
        let names = [(&t, "T"), (&o, "O"), (&p, "P"), (&m1, "M1"), (&m2, "M2")];
        let spent = picked_out(&w, &known, Out::Send, lovelace).expect("it pays");
        assert_eq!(
            outpoints(&spent),
            outpoints(&target),
            "a Send of {lovelace}: spent {}",
            named(&spent, &names)
        );
    }

    /// 1.9.3's release review, r2#4: a UTxO that adds less than nothing goes after the boxes (r2a#3), so the other money
    /// alone goes without it, and it never goes in with no box where a box pays beside the other money. K, a way back
    /// a mix moved of 4 ₳; O, 4 ₳ made private; a stranger's NFT at the least the ledger takes for it. The most O and
    /// the stranger's pay, which K alone can't and O and K can: O and K, as 1.9.2 spent them. The reviewed search spent
    /// O and the stranger's, and its change kept the stranger's token.
    #[test]
    fn a_strangers_token_at_its_least_stays_out_where_a_box_beside_the_other_money_pays() {
        let w = world();
        let k = owned(&w, 0xa1, 0, 4_000_000, &[]);
        let o = owned(&w, 0xa2, 0, 4_000_000, &[]);
        let nft = of_policy(
            owned(&w, 0xa3, 0, 0, &[("nft", 1)]),
            &hex::encode([0x60u8; 28]),
        );
        let nft = with_lovelace(nft.clone(), least_on_chain(&w, &nft));
        let lovelace = most_sent(&w, &[o.clone(), nft.clone()]);
        assert!(lovelace > most_sent(&w, std::slice::from_ref(&o)));
        pays_out(&w, &[o.clone(), k.clone()], Out::Send, lovelace).expect("O and K pay");
        let e = pays_out(&w, std::slice::from_ref(&k), Out::Send, lovelace).unwrap_err();
        assert!(build::is_short(&e), "K alone: {e}");
        let known = [
            (&k, box_class(&k, Origin::Mixed)),
            (&o, class("public:0", Origin::Own)),
            (&nft, received_class(&nft)),
        ];
        let names = [(&k, "K"), (&o, "O"), (&nft, "the stranger's")];
        let spent = picked_out(&w, &known, Out::Send, lovelace).expect("it pays");
        assert_eq!(
            outpoints(&spent),
            outpoints(&[o.clone(), k.clone()]),
            "a Send of {lovelace}: spent {}",
            named(&spent, &names)
        );
    }

    /// 1.9.3's release review, r1#1: a build too large for one transaction rules out only sets as large. A, a plain way
    /// back of 10.5 ₳ and a token of its own, a 32-byte name; B1, a plain way back of 10 ₳; B2, one a mix moved of 9.9 ₳;
    /// the other money, 14 UTxOs made private of 20 kinds of 32-byte names, each of its own policy, and one of 14, each
    /// at their least and 1 ₳. Beside all of it A makes the transaction too large, where B1 and B2, of as many inputs
    /// and change outputs, fit. 0.3 ₳ under the most B2 and all of it pay: B2 beside all of it, as few boxes as pay and
    /// of as many the one a mix moved. The reviewed search ruled out every set of A's inputs and change outputs, and
    /// spent B1 and B2 beside four of the other money.
    #[test]
    fn a_box_too_large_beside_all_the_other_money_rules_out_no_smaller_set_of_as_many_inputs() {
        let w = world();
        let a = of_policy(
            owned(&w, 0xb0, 0, 10_500_000, &[(&"c".repeat(32), 1)]),
            &hex::encode([0xeeu8; 28]),
        );
        let b1 = owned(&w, 0xb1, 0, 10_000_000, &[]);
        let b2 = owned(&w, 0xb2, 0, 9_900_000, &[]);
        let kinds = |policy: u8, count: u8, fill: u8| -> Vec<(String, Vec<u8>)> {
            (0..count)
                .map(|i| {
                    (
                        hex::encode([policy; 28]),
                        [vec![i], vec![fill; 31]].concat(),
                    )
                })
                .collect()
        };
        let money: Vec<UtxoResponse> = (0..14u8)
            .map(|k| holding_kinds(owned(&w, 0x80 + k, 0, 0, &[]), &kinds(0x10 + k, 20, 0x61)))
            .chain(std::iter::once(holding_kinds(
                owned(&w, 0x9f, 0, 0, &[]),
                &kinds(0x0f, 14, 0x62),
            )))
            .map(|u| {
                let least = wallet_least(&w, &u);
                with_lovelace(u, least + 1_000_000)
            })
            .collect();
        let with = |b: &UtxoResponse| [money.clone(), vec![b.clone()]].concat();
        let lovelace = most_sent(&w, &with(&b2)) - 300_000;
        pays_out(&w, &with(&b1), Out::Send, lovelace).expect("B1 beside all of it pays too");
        let e = pays_out(&w, &with(&a), Out::Send, lovelace).unwrap_err();
        assert!(build::is_too_large(&e), "A beside all of it: {e}");
        let fewer = [money[..14].to_vec(), vec![b1.clone()]].concat();
        let e = pays_out(&w, &fewer, Out::Send, lovelace).unwrap_err();
        assert!(build::is_short(&e), "B1 beside less of it: {e}");
        let mut known: Vec<(&UtxoResponse, Class)> = vec![
            (&a, box_class(&a, Origin::Lovejoin)),
            (&b1, box_class(&b1, Origin::Lovejoin)),
            (&b2, box_class(&b2, Origin::Mixed)),
        ];
        known.extend(money.iter().map(|u| (u, class("public:0", Origin::Own))));
        let names = [(&a, "A"), (&b1, "B1"), (&b2, "B2")];
        let spent = picked_out(&w, &known, Out::Send, lovelace).expect("it pays");
        assert_eq!(
            outpoints(&spent),
            outpoints(&with(&b2)),
            "a Send of {lovelace}: spent {}",
            named(&spent, &names)
        );
    }
}

/// Where a Seedelf spend puts its change (privacy review §3.7).
#[test]
fn the_change_goes_anywhere_among_a_transfers_outputs() {
    let w = world();
    let payment = seedelf_core::build::Payment {
        register: Register::create(random_scalar())
            .unwrap()
            .rerandomize()
            .unwrap(),
        lovelace: 7_000_000,
        tokens: Default::default(),
    };
    let spent = [owned(&w, 0x01, 0, 50_000_000, &[])];
    let spend = build::transfer_from(
        &w.chain,
        &spent,
        std::slice::from_ref(&payment),
        &w.owner,
        w.signer,
    )
    .unwrap();
    // Two outputs; the change is the one the payer owns. In 64 builds it
    // comes first at least once, but for a chance of 2^-64.
    let firsts = (0..64)
        .filter(|_| {
            let tx = decode(&spend.estimate().unwrap().tx);
            assert_eq!(tx.outputs.len(), 2);
            tx.outputs[0]
                .register
                .as_ref()
                .unwrap()
                .is_owned(w.sk)
                .unwrap()
        })
        .count();
    assert!(firsts > 0 && firsts < 64, "{firsts} of 64");
}
