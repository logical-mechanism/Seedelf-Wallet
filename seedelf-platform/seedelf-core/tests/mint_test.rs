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

        // Only a normal address on this network.
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
        let stake = Address::from_bech32(
            "stake_test1urj40zgr2gy4788kl54h6x3gu0pukq5lfr8nflufpg5dzas324ywz",
        )
        .unwrap();
        for bad in [
            &w.wallet,
            &script,
            &script_stake,
            &stake,
            &key_address(Network::Mainnet),
        ] {
            assert!(!build::is_payable_address(bad, true));
            assert!(
                err(bad, 2_000_000, &none).contains("normal preprod address"),
                "{bad:?}"
            );
            assert!(build::sweep_all(&w.chain, &available, bad, &w.owner, w.signer).is_err());
        }
        let to = key_address(Network::Testnet);
        assert!(build::is_payable_address(&to, true));
        assert!(build::is_payable_address(&collateral_address(true), true));

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
