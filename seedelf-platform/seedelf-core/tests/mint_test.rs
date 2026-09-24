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
use seedelf_core::transaction::{
    computation_fee, seedelf_minimum_lovelace, wallet_minimum_lovelace_with_assets,
};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::{create_proof, prove, random_scalar};
use seedelf_koios::koios::{Asset, InlineDatum, ProtocolParameters, UtxoResponse};
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
    let units = (577 * mem as u128 * 1_000 + 721 * steps as u128).div_ceil(10_000_000) as u64;
    44 * size + 155_381 + units + 15 * script_bytes
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

    let built = proven(&w, minted)
        .finalize(&Budgets::from_ogmios(&measured(2)).unwrap())
        .unwrap();
    let tx = assert_sound(&w, &spent, &built);

    // The seedelf sits under exactly the register it was given.
    let seedelf_out = &tx.outputs[0];
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
    assert!(e.to_string().contains("seedelf policy"), "{e}");
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

        // The fee: even, at least the ledger's minimum for this many signatures.
        let b = tx.redeemers[0].budget;
        let needed = ledger_minimum_fee(params, tx.size_signed, b.mem, b.steps, 519);
        assert_eq!(tx.fee % 2, 0);
        assert!(tx.fee >= needed, "fee {} covers {needed}", tx.fee);
        assert!(tx.fee - needed < 1_000);
        assert_eq!(built.fee.total, tx.fee);
        tx
    }

    #[test]
    fn the_account_pays_and_its_5_ada_utxo_is_the_collateral() {
        let p = payer();
        let available = [
            at(&p, 0x30, 0, 10_000_000, &[]),
            at(&p, 0x31, 1, 5_000_000, &[]),
            at(&p, 0x32, 2, 3_000_000, &[("tok", 7)]),
        ];
        let mint = build::account_mint(&p.chain, &available, "account-mint", &p.seedelf, &p.change)
            .unwrap();
        // The largest pure-ADA UTxO pays; the 5 ADA one is never spent, only put up.
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
    fn a_token_utxo_can_be_the_collateral() {
        // Like the public phrase's preprod account after its move-in: every UTxO holds tokens.
        let p = payer();
        let names: Vec<String> = (0..25).map(|i| format!("token{i:02}")).collect();
        let many: Vec<(&str, u64)> = names.iter().map(|n| (n.as_str(), 1)).collect();
        let available = [
            at(&p, 0x40, 0, 12_000_000, &many),
            at(&p, 0x41, 1, 4_000_000, &[("tok", 1)]),
        ];
        let mint = build::account_mint(&p.chain, &available, "account-mint", &p.seedelf, &p.change)
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
        let available = [
            at(&p, 0x50, 0, 1_500_000, &[]),
            at(&p, 0x51, 1, 2_000_000, &[]),
            at(&p, 0x52, 2, 5_000_000, &[]),
        ];
        let mint = build::account_mint(&p.chain, &available, "account-mint", &p.seedelf, &p.change)
            .unwrap();
        assert_eq!(outpoints(mint.inputs()), outpoints(&available[..2]));
        assert_eq!(mint.collateral().tx_hash, available[2].tx_hash);
        assert_sound(&p, &mint, &mint.finalize(&recorded()).unwrap());

        // With one UTxO, it's both an input and the collateral.
        let single = [at(&p, 0x60, 0, 4_000_000, &[])];
        let mint =
            build::account_mint(&p.chain, &single, "account-mint", &p.seedelf, &p.change).unwrap();
        assert_eq!(mint.collateral().tx_hash, single[0].tx_hash);
        let tx = assert_sound(&p, &mint, &mint.finalize(&recorded()).unwrap());
        assert_eq!(tx.inputs, tx.collateral);
    }

    #[test]
    fn explains_what_is_wrong() {
        let p = payer();
        let err = |available: &[UtxoResponse]| {
            build::account_mint(&p.chain, available, "", &p.seedelf, &p.change)
                .err()
                .expect("an error")
                .to_string()
        };
        assert!(
            err(&[at(&p, 0x70, 0, 1_500_000, &[])])
                .contains("Not enough ADA in the Cardano account for the seedelf")
        );
        assert!(err(&[]).contains("nothing in the Cardano account"));
        // A 5 ADA pure UTxO alone is never spent.
        assert!(err(&[at(&p, 0x71, 0, 5_000_000, &[])]).contains("Not enough ADA"));
        let bad = Register::new("00".repeat(48), "00".repeat(48));
        assert!(
            build::account_mint(
                &p.chain,
                &[at(&p, 0x72, 0, 9_000_000, &[])],
                "",
                &bad,
                &p.change
            )
            .err()
            .unwrap()
            .to_string()
            .contains("register")
        );
        let mint = build::account_mint(
            &p.chain,
            &[at(&p, 0x73, 0, 9_000_000, &[])],
            "",
            &p.seedelf,
            &p.change,
        )
        .unwrap();
        let no_mint = json!({"result": [{"validator": {"index": 0, "purpose": "spend"}, "budget": {"memory": 1, "cpu": 1}}]});
        assert!(
            mint.finalize(&Budgets::from_ogmios(&no_mint).unwrap())
                .err()
                .unwrap()
                .to_string()
                .contains("seedelf policy")
        );
    }
}
