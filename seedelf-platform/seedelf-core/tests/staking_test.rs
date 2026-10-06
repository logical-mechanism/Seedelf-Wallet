//! Staking and voting delegation from a Cardano account: the certificates and
//! withdrawals patched into an account transaction. Every transaction is
//! decoded and checked: value conserved counting the deposit, the refund and
//! the withdrawal; the fee covering the size once every key, the stake key
//! too, has signed; and the signatures made over the patched body's hash.

use std::collections::BTreeSet;

use pallas_addresses::Address;
use pallas_crypto::hash::Hash;
use pallas_crypto::key::ed25519::{PublicKey, Signature};
use pallas_primitives::conway::{self, Anchor, Certificate, DRep, GovActionId, Vote, Voter};
use pallas_primitives::{Fragment, Nullable, StakeCredential};
use pallas_traverse::MultiEraTx;
use pallas_txbuilder::BuiltTransaction;
use seedelf_core::address::wallet_contract;
use seedelf_core::build::{self, AccountAmount, Chain, fake_signer, tx_id};
use seedelf_core::constants::get_config;
use seedelf_core::staking::{
    ALWAYS_ABSTAIN, ALWAYS_NO_CONFIDENCE, DrepAction, DrepKey, DrepState, MAX_ANCHOR_URL,
    RewardsLocked, StakeAction, StakeKey, StakeState, Staking, anchor, drep_id, gov_action_id,
    parse_drep, parse_pool_id, pool_id,
};
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset, ProtocolParameters, UtxoResponse};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
/// LOGIC on preprod, which the public 12-word phrase's account delegates to.
const LOGIC: &str = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";
const LOGIC_HEX: &str = "1e3105f23f2ac91b3fb4c35fa4fe301421028e356e114944e902005b";
/// Logical Mechanism's preprod DRep: a script, in CIP-129 form, as Koios gives it.
const LOGIC_DREP: &str = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";
const LOGIC_DREP_HEX: &str = "763ef75661f0cd8c8fa159a79d79bfe8f9a76878bdaaff700598ee0e";
const DEPOSIT: u64 = 2_000_000;
/// What registering a DRep locks up on preprod (`drep_deposit`).
const DREP_DEPOSIT: u64 = 500_000_000;

fn params() -> ProtocolParameters {
    let rows: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

struct World {
    params: ProtocolParameters,
    account: CardanoAccount,
    key: StakeKey,
    stake: Address,
    change: Address,
}

fn world() -> World {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let stake = account.stake_address(true).unwrap();
    World {
        params: params(),
        key: StakeKey::new(&stake).unwrap(),
        change: account.base_address(true, Role::Receive, 0).unwrap(),
        stake,
        account,
    }
}

fn logic() -> Hash<28> {
    parse_pool_id(LOGIC).unwrap()
}

/// A UTxO at the account's receive address `index`.
fn utxo(w: &World, n: u8, index: u32, lovelace: u64, assets: Vec<Asset>) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([n; 32]),
        tx_index: 0,
        address: w
            .account
            .base_address(true, Role::Receive, index)
            .unwrap()
            .to_bech32()
            .unwrap(),
        value: lovelace.to_string(),
        payment_cred: hex::encode(w.account.key_hash(Role::Receive, index).unwrap()),
        asset_list: Some(assets),
        ..Default::default()
    }
}

fn registered(rewards: u64, votes: bool) -> StakeState {
    StakeState {
        registered: true,
        deposit: DEPOSIT,
        rewards,
        votes,
    }
}

fn staking(w: &World, action: StakeAction, state: StakeState) -> Staking {
    Staking::of(&w.key, &action, &state, w.params.key_deposit).unwrap()
}

/// What a built transaction does with the stake key, and its value.
struct Decoded {
    certificates: Vec<Certificate>,
    withdrawals: Vec<(Vec<u8>, u64)>,
    /// Each vote: who, on which action, and the vote.
    votes: Vec<(Voter, GovActionId, Vote)>,
    inputs: Vec<String>,
    lovelace_out: u64,
    fee: u64,
}

fn decode(tx: &BuiltTransaction) -> Decoded {
    let decoded = conway::Tx::decode_fragment(&tx.tx_bytes.0).unwrap();
    let body = &decoded.transaction_body;
    let traversed = MultiEraTx::decode(&tx.tx_bytes.0).unwrap();
    Decoded {
        certificates: body
            .certificates
            .clone()
            .map(|c| c.to_vec())
            .unwrap_or_default(),
        withdrawals: body
            .withdrawals
            .clone()
            .map(|w| w.iter().map(|(a, l)| (a.to_vec(), *l)).collect())
            .unwrap_or_default(),
        votes: body
            .voting_procedures
            .iter()
            .flat_map(|v| v.iter())
            .flat_map(|(voter, procedures)| {
                procedures.iter().map(move |(action, procedure)| {
                    assert_eq!(procedure.anchor, Nullable::Null, "no rationale");
                    (voter.clone(), action.clone(), procedure.vote.clone())
                })
            })
            .collect(),
        inputs: traversed
            .inputs()
            .iter()
            .map(|i| hex::encode(*i.hash()))
            .collect(),
        lovelace_out: traversed.outputs().iter().map(|o| o.value().coin()).sum(),
        fee: traversed.fee().unwrap(),
    }
}

/// Signs `tx` with `signers` throwaway keys, as WebAssembly signs with the
/// real ones, and checks every signature is over the transaction's own id.
fn signed_size(tx: &BuiltTransaction, signers: usize) -> u64 {
    let mut signed = tx.clone();
    for _ in 0..signers {
        signed = signed.sign(fake_signer()).unwrap();
    }
    let hash = tx_id(&signed.tx_bytes.0).unwrap();
    assert_eq!(
        hash.as_ref(),
        &tx.tx_hash.0,
        "signing kept the patched body"
    );
    let witnesses = conway::Tx::decode_fragment(&signed.tx_bytes.0)
        .unwrap()
        .transaction_witness_set
        .vkeywitness
        .unwrap()
        .to_vec();
    assert_eq!(witnesses.len(), signers);
    for w in witnesses {
        let key: [u8; 32] = w.vkey.to_vec().try_into().unwrap();
        let signature: [u8; 64] = w.signature.to_vec().try_into().unwrap();
        assert!(
            PublicKey::from(key).verify(hash, &Signature::from(signature)),
            "a signature over the patched body's hash"
        );
    }
    signed.tx_bytes.0.len() as u64
}

/// The checks every account transaction carrying `staking` must pass.
fn assert_sound(
    w: &World,
    available: &[UtxoResponse],
    staking: &Staking,
    built: &build::AccountPayment,
) -> Decoded {
    let tx = decode(&built.tx);
    let payment_keys = built
        .inputs
        .iter()
        .map(|u| u.payment_cred.as_str())
        .collect::<BTreeSet<_>>()
        .len();

    // What the transaction says it does with the stake key.
    assert_eq!(tx.certificates, staking.certificates);
    assert_eq!(
        tx.withdrawals,
        staking
            .withdrawal
            .iter()
            .map(|(a, l)| (a.clone(), *l))
            .collect::<Vec<_>>()
    );
    if let Some((account, _)) = &staking.withdrawal {
        assert_eq!(account, &w.stake.to_vec(), "keyed by the reward address");
    }
    assert_eq!(
        tx.votes,
        staking
            .votes
            .iter()
            .flat_map(|(drep, ballots)| {
                ballots
                    .iter()
                    .map(|(a, v)| (Voter::DRepKey(*drep), a.clone(), v.clone()))
            })
            .collect::<Vec<_>>()
    );

    // Value: inputs + withdrawal + refund = outputs + fee + deposit.
    let lovelace_in: u64 = tx
        .inputs
        .iter()
        .map(|h| {
            available
                .iter()
                .find(|u| &u.tx_hash == h)
                .expect("input is an available UTxO")
                .value
                .parse::<u64>()
                .unwrap()
        })
        .sum();
    assert_eq!(
        lovelace_in + staking.withdrawn() + staking.refund(),
        tx.lovelace_out + tx.fee + staking.deposit(),
        "lovelace conserved"
    );

    // The fee covers the transaction once every payment key and the stake key
    // have signed, and not wildly more.
    assert_eq!(tx.fee, built.fee);
    let size = signed_size(&built.tx, payment_keys + staking.signers());
    let minimum = w.params.min_fee_a * size + w.params.min_fee_b;
    assert!(tx.fee >= minimum, "fee {} < {minimum}", tx.fee);
    assert!(tx.fee < minimum + 1_000, "fee isn't wildly high");
    tx
}

#[test]
fn reads_pool_ids_in_bech32_and_hex() {
    let hash = logic();
    assert_eq!(hex::encode(hash), LOGIC_HEX);
    assert_eq!(parse_pool_id(LOGIC_HEX).unwrap(), hash);
    assert_eq!(parse_pool_id(&format!("  {LOGIC}\n")).unwrap(), hash);
    assert_eq!(pool_id(&hash), LOGIC);

    let err = |id: &str| parse_pool_id(id).unwrap_err().to_string();
    assert!(
        err("stake_test1urj40zgr2gy4788kl54h6x3gu0pukq5lfr8nflufpg5dzas324ywz").contains("pool1")
    );
    assert!(
        err("pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tx")
            .contains("isn't a stake pool ID")
    );
    assert!(err("1e3105f2").contains("isn't a stake pool ID"));
    assert!(err("").contains("isn't a stake pool ID"));
}

#[test]
fn reads_drep_ids_in_both_cips_and_the_pinned_two() {
    let script = Hash::new(hex::decode(LOGIC_DREP_HEX).unwrap().try_into().unwrap());
    assert_eq!(parse_drep(LOGIC_DREP).unwrap(), DRep::Script(script));
    assert_eq!(drep_id(&DRep::Script(script)), LOGIC_DREP);
    assert_eq!(parse_drep(ALWAYS_ABSTAIN).unwrap(), DRep::Abstain);
    assert_eq!(
        parse_drep(ALWAYS_NO_CONFIDENCE).unwrap(),
        DRep::NoConfidence
    );
    assert_eq!(drep_id(&DRep::Abstain), ALWAYS_ABSTAIN);
    assert_eq!(drep_id(&DRep::NoConfidence), ALWAYS_NO_CONFIDENCE);

    // A key DRep: CIP-129 (header 0x22) and CIP-105 (bare hash) read the same.
    let key = Hash::new([7u8; 28]);
    let cip129 = drep_id(&DRep::Key(key));
    assert!(cip129.starts_with("drep1y"));
    assert_eq!(parse_drep(&cip129).unwrap(), DRep::Key(key));
    use bech32::{ToBase32, Variant};
    let cip105 = bech32::encode("drep", [7u8; 28].to_base32(), Variant::Bech32).unwrap();
    assert_eq!(parse_drep(&cip105).unwrap(), DRep::Key(key));
    let cip105_script =
        bech32::encode("drep_script", [7u8; 28].to_base32(), Variant::Bech32).unwrap();
    assert_eq!(parse_drep(&cip105_script).unwrap(), DRep::Script(key));

    let err = |id: &str| parse_drep(id).unwrap_err().to_string();
    assert!(err(LOGIC).contains("drep1"));
    assert!(err("drep1").contains("isn't a DRep ID"));
    let wrong_header = bech32::encode(
        "drep",
        std::iter::once(0x12u8)
            .chain([7u8; 28])
            .collect::<Vec<_>>()
            .to_base32(),
        Variant::Bech32,
    )
    .unwrap();
    assert!(err(&wrong_header).contains("header"));
}

#[test]
fn a_stake_key_is_named_by_its_reward_address() {
    let w = world();
    let script_stake =
        Address::from_bech32("stake_test17rphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcljw6kf")
            .unwrap();
    assert!(
        StakeKey::new(&script_stake)
            .unwrap_err()
            .to_string()
            .contains("script")
    );
    assert!(StakeKey::new(&w.change).is_err(), "a base address isn't");
}

#[test]
fn each_action_is_the_certificate_the_state_needs() {
    let w = world();
    let cred = StakeCredential::AddrKeyhash(w.account.key_hash(Role::Staking, 0).unwrap());
    let unregistered = StakeState::default();

    // The first delegation registers the key in the same certificate.
    let first = staking(&w, StakeAction::Delegate(logic()), unregistered);
    assert_eq!(
        first.certificates,
        vec![Certificate::StakeRegDeleg(cred.clone(), logic(), DEPOSIT)]
    );
    assert_eq!(
        (first.deposit(), first.refund(), first.withdrawn()),
        (DEPOSIT, 0, 0)
    );

    // A change of pool is only the delegation, with nothing withdrawn.
    let change = staking(
        &w,
        StakeAction::Delegate(logic()),
        registered(57_475_311, true),
    );
    assert_eq!(
        change.certificates,
        vec![Certificate::StakeDelegation(cred.clone(), logic())]
    );
    assert_eq!((change.deposit(), change.withdrawn()), (0, 0));

    // The vote: on its own, or registering first.
    let vote = staking(&w, StakeAction::Vote(DRep::Abstain), registered(0, false));
    assert_eq!(
        vote.certificates,
        vec![Certificate::VoteDeleg(cred.clone(), DRep::Abstain)]
    );
    let vote_first = staking(&w, StakeAction::Vote(DRep::NoConfidence), unregistered);
    assert_eq!(
        vote_first.certificates,
        vec![Certificate::VoteRegDeleg(
            cred.clone(),
            DRep::NoConfidence,
            DEPOSIT
        )]
    );

    // Withdrawing takes the whole balance, keyed by the reward address.
    let withdraw = staking(&w, StakeAction::Withdraw, registered(57_475_311, true));
    assert!(withdraw.certificates.is_empty());
    assert_eq!(withdraw.withdrawal, Some((w.stake.to_vec(), 57_475_311)));

    // Stopping withdraws everything and gets back the deposit that was paid.
    let paid_more = StakeState {
        deposit: 3_000_000,
        ..registered(1_000, true)
    };
    let stop = staking(&w, StakeAction::Stop, paid_more);
    assert_eq!(
        stop.certificates,
        vec![Certificate::UnReg(cred.clone(), 3_000_000)]
    );
    assert_eq!((stop.refund(), stop.withdrawn()), (3_000_000, 1_000));
    let stop_empty = staking(&w, StakeAction::Stop, registered(0, false));
    assert_eq!(stop_empty.withdrawal, None, "no rewards, no withdrawal");
    assert_eq!(stop_empty.refund(), DEPOSIT);
}

#[test]
fn refuses_what_the_ledger_would() {
    let w = world();
    let err = |action: StakeAction, state: StakeState| {
        Staking::of(&w.key, &action, &state, DEPOSIT)
            .unwrap_err()
            .to_string()
    };
    assert!(err(StakeAction::Withdraw, registered(0, true)).contains("no rewards"));
    assert!(err(StakeAction::Withdraw, StakeState::default()).contains("no rewards"));
    assert!(err(StakeAction::Stop, StakeState::default()).contains("isn't staking"));

    // Conway refuses a withdrawal from a key whose vote isn't delegated.
    let locked = Staking::of(
        &w.key,
        &StakeAction::Withdraw,
        &registered(5, false),
        DEPOSIT,
    );
    assert!(
        locked
            .unwrap_err()
            .downcast_ref::<RewardsLocked>()
            .is_some()
    );
    assert!(err(StakeAction::Stop, registered(5, false)).contains("voting power"));

    // Riding along: nothing to withdraw is no withdrawal, and locked is refused.
    assert!(
        Staking::withdraw(&w.key, &registered(0, false))
            .unwrap()
            .is_empty()
    );
    assert!(
        Staking::withdraw(&w.key, &StakeState::default())
            .unwrap()
            .is_empty()
    );
    assert!(Staking::withdraw(&w.key, &registered(5, false)).is_err());
}

#[test]
fn the_first_delegation_pays_the_deposit_and_signs_with_the_stake_key() {
    let w = world();
    let available = vec![
        utxo(&w, 1, 0, 3_000_000, vec![]),
        utxo(&w, 2, 1, 50_000_000, vec![]),
    ];
    let first = staking(&w, StakeAction::Delegate(logic()), StakeState::default());
    let built = build::account_staking(&w.params, &available, &first, &w.change, None).unwrap();
    let tx = assert_sound(&w, &available, &first, &built);

    assert_eq!(tx.inputs, vec![hex::encode([2u8; 32])], "one UTxO pays");
    assert_eq!(built.lovelace, 0, "nobody is paid");
    assert_eq!(built.outputs, 0);
    assert_eq!(built.change_lovelace, 50_000_000 - DEPOSIT - built.fee);
}

#[test]
fn withdrawing_and_stopping_bring_the_rewards_and_the_deposit_back() {
    let w = world();
    let available = vec![utxo(&w, 1, 0, 1_500_000, vec![])];
    let state = registered(57_475_311, true);

    let withdraw = staking(&w, StakeAction::Withdraw, state);
    let built = build::account_staking(&w.params, &available, &withdraw, &w.change, None).unwrap();
    assert_sound(&w, &available, &withdraw, &built);
    assert_eq!(built.change_lovelace, 1_500_000 + 57_475_311 - built.fee);

    let stop = staking(&w, StakeAction::Stop, state);
    let built = build::account_staking(&w.params, &available, &stop, &w.change, None).unwrap();
    let tx = assert_sound(&w, &available, &stop, &built);
    assert_eq!(tx.certificates.len(), 1);
    assert_eq!(
        built.change_lovelace,
        1_500_000 + 57_475_311 + DEPOSIT - built.fee
    );
}

#[test]
fn a_staking_transaction_still_spends_a_utxo_and_explains_a_shortfall() {
    let w = world();
    let first = staking(&w, StakeAction::Delegate(logic()), StakeState::default());

    // The deposit and fee need more than a small UTxO holds.
    let small = vec![utxo(&w, 1, 0, 2_100_000, vec![])];
    let err = build::account_staking(&w.params, &small, &first, &w.change, None)
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    assert!(
        err.contains("Not enough ADA in the Cardano account"),
        "{err}"
    );

    // Rewards alone could pay the fee, but a transaction spends a UTxO.
    let withdraw = staking(&w, StakeAction::Withdraw, registered(10_000_000, true));
    assert!(build::account_staking(&w.params, &[], &withdraw, &w.change, None).is_err());
    assert!(
        build::account_staking(&w.params, &small, &Staking::none(), &w.change, None)
            .err()
            .is_some_and(|e| e
                .to_string()
                .contains("a certificate, a withdrawal or a vote"))
    );
}

#[test]
fn a_send_spends_the_rewards_too() {
    let w = world();
    let to = CardanoAccount::from_phrase(PHRASE, 1)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap();
    // 3 ADA in UTxOs, 10 in rewards: 8 can go.
    let available = vec![utxo(&w, 1, 0, 3_000_000, vec![])];
    let rewards = Staking::withdraw(&w.key, &registered(10_000_000, true)).unwrap();
    let built = build::account_send(
        &w.params,
        &available,
        AccountAmount::Lovelace(8_000_000),
        &[],
        &to,
        true,
        &w.change,
        &rewards,
        None,
    )
    .unwrap();
    assert_sound(&w, &available, &rewards, &built);
    assert_eq!(built.lovelace, 8_000_000);
    assert_eq!(built.change_lovelace, 13_000_000 - 8_000_000 - built.fee);

    // Without the rewards, it's more than the account holds.
    assert!(
        build::account_send(
            &w.params,
            &available,
            AccountAmount::Lovelace(8_000_000),
            &[],
            &to,
            true,
            &w.change,
            &Staking::none(),
            None,
        )
        .is_err()
    );

    // Max sends the rewards along with everything else.
    let max = build::account_send(
        &w.params,
        &available,
        AccountAmount::Max,
        &[],
        &to,
        true,
        &w.change,
        &rewards,
        None,
    )
    .unwrap();
    assert_sound(&w, &available, &rewards, &max);
    assert_eq!(max.lovelace, 13_000_000 - max.fee);
    assert_eq!(max.change_lovelace, 0);
}

#[test]
fn a_move_in_spends_the_rewards_too() {
    let w = world();
    let config = get_config(1, true).unwrap();
    let wallet = wallet_contract(true, config.contract.wallet_contract_hash);
    let owner = Register::create(random_scalar()).unwrap();
    let available = vec![
        utxo(&w, 1, 0, 4_000_000, vec![]),
        utxo(&w, 2, 3, 6_000_000, vec![]),
    ];
    let rewards = Staking::withdraw(&w.key, &registered(2_500_000, true)).unwrap();
    let built = build::move_in(
        &w.params,
        &available,
        AccountAmount::Max,
        &[],
        &owner,
        &wallet,
        &w.change,
        &rewards,
        None,
    )
    .unwrap();
    let tx = assert_sound(&w, &available, &rewards, &built);
    assert_eq!(tx.inputs.len(), 2);
    assert_eq!(built.lovelace, 12_500_000 - built.fee);
}

#[test]
fn an_account_mint_spends_the_rewards_too() {
    let w = world();
    let chain = Chain {
        params: w.params.clone(),
        network_flag: true,
        config: get_config(1, true).unwrap(),
    };
    let available = vec![
        utxo(&w, 1, 0, 2_000_000, vec![]),
        utxo(&w, 2, 1, 5_000_000, vec![]),
    ];
    let rewards = Staking::withdraw(&w.key, &registered(3_000_000, true)).unwrap();
    let seedelf = Register::create(random_scalar())
        .unwrap()
        .rerandomize()
        .unwrap();
    let mint = build::account_mint(
        &chain,
        &available,
        Some(&available[1]),
        "rewards",
        &seedelf,
        &w.change,
        &rewards,
        None,
    )
    .unwrap();
    // The 2 ADA UTxO and the rewards pay; without them it wouldn't.
    assert_eq!(mint.inputs().len(), 1);
    assert_eq!(mint.inputs()[0].tx_hash, available[0].tx_hash);
    assert!(
        build::account_mint(
            &chain,
            &available,
            Some(&available[1]),
            "rewards",
            &seedelf,
            &w.change,
            &Staking::none(),
            None,
        )
        .is_err()
    );

    // Ogmios evaluates the draft with the withdrawal in it.
    assert_eq!(decode(&mint.draft().unwrap()).withdrawals.len(), 1);
    let measured = build::Budgets::from_ogmios(&serde_json::json!({
        "result": [{ "validator": { "purpose": "mint", "index": 0 },
                     "budget": { "memory": 72_836, "cpu": 21_396_182 } }]
    }))
    .unwrap();
    let built = mint.finalize(&measured).unwrap();
    let tx = decode(&built.tx);
    assert_eq!(tx.withdrawals, vec![(w.stake.to_vec(), 3_000_000)]);
    assert_eq!(
        2_000_000 + 3_000_000,
        tx.lovelace_out + tx.fee,
        "lovelace conserved, the rewards counted"
    );
    // The input's key, the collateral's, and the stake key sign.
    signed_size(&built.tx, 3);
}

#[test]
fn a_patch_happens_before_signing_and_nothing_to_patch_changes_nothing() {
    let w = world();
    let available = vec![utxo(&w, 1, 0, 10_000_000, vec![])];
    let to = CardanoAccount::from_phrase(PHRASE, 1)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap();
    let plain = build::account_send(
        &w.params,
        &available,
        AccountAmount::Lovelace(2_000_000),
        &[],
        &to,
        true,
        &w.change,
        &Staking::none(),
        None,
    )
    .unwrap();
    let same = Staking::none().patch(plain.tx.clone()).unwrap();
    assert_eq!(same.tx_bytes.0, plain.tx.tx_bytes.0);

    let withdraw = staking(&w, StakeAction::Withdraw, registered(1, true));
    let patched = withdraw.patch(plain.tx.clone()).unwrap();
    assert_ne!(
        patched.tx_hash.0, plain.tx.tx_hash.0,
        "a new body, a new hash"
    );
    assert_eq!(
        tx_id(&patched.tx_bytes.0).unwrap().as_ref(),
        &patched.tx_hash.0
    );
    assert!(withdraw.patch(patched.clone()).is_err(), "only once");
    let signed = plain.tx.sign(fake_signer()).unwrap();
    assert!(withdraw.patch(signed).is_err(), "never after signing");
}

// ---- The account's own DRep (chunk 21) ----

/// Two of preprod's live governance actions on 2026-10-04.
const TREASURY: &str = "322066e8333d3338858a2d9fd4fdfa04d4ab5d79ef002b2296635143fac3ca79";
const INFO: &str = "139444b23543a9a836b2b01c0057ff4300f2d25b3d94812f138b89b22d2b780d";

fn drep_key(w: &World) -> DrepKey {
    DrepKey::new(w.account.key_hash(Role::Drep, 0).unwrap())
}

fn a_drep(own_vote: bool) -> DrepState {
    DrepState {
        registered: true,
        deposit: DREP_DEPOSIT,
        own_vote,
    }
}

fn as_drep(w: &World, action: DrepAction, stake: StakeState, drep: DrepState) -> Staking {
    Staking::drep(&w.key, &stake, &drep_key(w), &drep, &action, &w.params).unwrap()
}

fn profile() -> Anchor {
    anchor(
        "ipfs://bafkreigzvg5nbyngh2hfxrptxmh2jturifcsq5v2gbaz7hfg6ccvhlzgxu",
        &"ab".repeat(32),
    )
    .unwrap()
}

#[test]
fn the_drep_is_named_as_lace_names_it() {
    // CIP-105's test vector 1: its key hash, as a CIP-129 ID.
    let hash: [u8; 28] = hex::decode("a5b45515a3ff8cb7c02ce351834da324eb6dfc41b5779cb5e6b832aa")
        .unwrap()
        .try_into()
        .unwrap();
    let drep = DrepKey::new(Hash::new(hash));
    assert_eq!(
        drep.id(),
        "drep1y2jmg4g450lced7q9n34rq6d5vjwkm0ugx6h0894u6ur92s9txn3a"
    );
    assert_eq!(parse_drep(&drep.id()).unwrap(), drep.drep());
}

#[test]
fn reads_cip_105s_current_key_form_too() {
    // CIP-105's test vector 1 three ways: its drep_vkh1…, its deprecated bare
    // drep1…, and CIP-129's. Pasted drep_vkh1… was "not a DRep ID".
    let hash: [u8; 28] = hex::decode("a5b45515a3ff8cb7c02ce351834da324eb6dfc41b5779cb5e6b832aa")
        .unwrap()
        .try_into()
        .unwrap();
    let cip129 = "drep1y2jmg4g450lced7q9n34rq6d5vjwkm0ugx6h0894u6ur92s9txn3a";
    for id in [
        "drep_vkh15k6929drl7xt0spvudgcxndryn4kmlzpk4meed0xhqe254czjh2",
        "drep15k6929drl7xt0spvudgcxndryn4kmlzpk4meed0xhqe25nle07s",
        cip129,
    ] {
        let read = parse_drep(id).unwrap();
        assert_eq!(read, DRep::Key(Hash::new(hash)), "{id}");
        // Named as Koios names it, whichever form was given (WebAssembly's `drepId`).
        assert_eq!(drep_id(&read), cip129, "{id}");
    }
    use bech32::{ToBase32, Variant};
    let short = bech32::encode("drep_vkh", (&hash[..27]).to_base32(), Variant::Bech32).unwrap();
    let err = parse_drep(&short).unwrap_err().to_string();
    assert!(err.contains("wrong length"), "{err}");
}

#[test]
fn registering_pays_the_deposit_and_delegates_the_accounts_own_vote() {
    let w = world();
    let me = drep_key(&w);
    let stake = StakeCredential::AddrKeyhash(w.account.key_hash(Role::Staking, 0).unwrap());
    let drep = StakeCredential::AddrKeyhash(me.hash());
    let register = |delegate, stake_state, drep_state| {
        as_drep(
            &w,
            DrepAction::Register {
                anchor: None,
                delegate,
            },
            stake_state,
            drep_state,
        )
    };

    // The stake key is registered: the registration, then the delegation.
    let both = register(true, registered(0, true), DrepState::default());
    assert_eq!(
        both.certificates,
        vec![
            Certificate::RegDRepCert(drep.clone(), DREP_DEPOSIT, Nullable::Null),
            Certificate::VoteDeleg(stake.clone(), me.drep()),
        ]
    );
    assert_eq!((both.deposit(), both.refund()), (DREP_DEPOSIT, 0));
    assert_eq!(both.drep_deposit(), DREP_DEPOSIT);
    assert!(both.stake_signs() && both.drep_signs());
    assert_eq!(both.signers(), 2);

    // It isn't: the delegation registers it too, and pays its deposit.
    let first = register(true, StakeState::default(), DrepState::default());
    assert_eq!(
        first.certificates[1],
        Certificate::VoteRegDeleg(stake.clone(), me.drep(), DEPOSIT)
    );
    assert_eq!(first.deposit(), DREP_DEPOSIT + DEPOSIT);
    assert_eq!(
        first.drep_deposit(),
        DREP_DEPOSIT,
        "the stake key's is apart"
    );

    // Kept apart: the registration alone, the DRep key alone.
    let alone = register(false, registered(0, true), DrepState::default());
    assert_eq!(alone.certificates.len(), 1);
    assert!(!alone.stake_signs() && alone.drep_signs());
    assert_eq!(alone.signers(), 1);

    // Koios saying the vote is on it already is stale, as it isn't registered:
    // the delegation goes all the same, as the review says. It was left out.
    let stale = register(
        true,
        registered(0, true),
        DrepState {
            own_vote: true,
            ..DrepState::default()
        },
    );
    assert_eq!(stale.certificates, both.certificates);
    assert_eq!(stale.signers(), 2);

    // A profile rides in the registration.
    let named = as_drep(
        &w,
        DrepAction::Register {
            anchor: Some(profile()),
            delegate: false,
        },
        registered(0, true),
        DrepState::default(),
    );
    assert_eq!(
        named.certificates,
        vec![Certificate::RegDRepCert(
            drep,
            DREP_DEPOSIT,
            Nullable::Some(profile())
        )]
    );
}

#[test]
fn updating_retiring_and_voting_are_the_drep_keys() {
    let w = world();
    let me = drep_key(&w);
    let stake = StakeCredential::AddrKeyhash(w.account.key_hash(Role::Staking, 0).unwrap());
    let drep = StakeCredential::AddrKeyhash(me.hash());

    let update = as_drep(
        &w,
        DrepAction::Update { anchor: None },
        registered(0, true),
        a_drep(true),
    );
    assert_eq!(
        update.certificates,
        vec![Certificate::UpdateDRepCert(drep.clone(), Nullable::Null)]
    );
    assert_eq!((update.deposit(), update.signers()), (0, 1));

    // Retiring gets back what was paid, whatever it was.
    let paid_more = DrepState {
        deposit: 600_000_000,
        ..a_drep(false)
    };
    let retire = as_drep(&w, DrepAction::Retire, registered(0, true), paid_more);
    assert_eq!(
        retire.certificates,
        vec![Certificate::UnRegDRepCert(drep.clone(), 600_000_000)]
    );
    assert_eq!((retire.refund(), retire.signers()), (600_000_000, 1));

    // Its own vote moves to always abstain, so the rewards stay withdrawable.
    let retire_own = as_drep(&w, DrepAction::Retire, registered(0, true), a_drep(true));
    assert_eq!(
        retire_own.certificates,
        vec![
            Certificate::UnRegDRepCert(drep, DREP_DEPOSIT),
            Certificate::VoteDeleg(stake, DRep::Abstain),
        ]
    );
    assert_eq!(retire_own.signers(), 2);

    // Votes, in a fixed order whatever order they were chosen in.
    let treasury = gov_action_id(TREASURY, 0).unwrap();
    let info = gov_action_id(INFO, 0).unwrap();
    let vote = as_drep(
        &w,
        DrepAction::Vote(vec![
            (treasury.clone(), Vote::No),
            (info.clone(), Vote::Yes),
        ]),
        StakeState::default(),
        a_drep(false),
    );
    assert!(vote.certificates.is_empty() && vote.withdrawal.is_none());
    assert_eq!(
        vote.votes,
        Some((me.hash(), vec![(info, Vote::Yes), (treasury, Vote::No)]))
    );
    assert_eq!((vote.deposit(), vote.signers()), (0, 1));
    assert!(!vote.stake_signs());
}

#[test]
fn a_drep_refuses_what_the_ledger_would() {
    let w = world();
    let err = |action: DrepAction, drep: DrepState| {
        Staking::drep(
            &w.key,
            &registered(0, true),
            &drep_key(&w),
            &drep,
            &action,
            &w.params,
        )
        .unwrap_err()
        .to_string()
    };
    let register = DrepAction::Register {
        anchor: None,
        delegate: true,
    };
    let treasury = gov_action_id(TREASURY, 0).unwrap();
    assert!(err(register.clone(), a_drep(true)).contains("a DRep already"));
    for action in [
        DrepAction::Update { anchor: None },
        DrepAction::Retire,
        DrepAction::Vote(vec![(treasury.clone(), Vote::Yes)]),
    ] {
        assert!(err(action, DrepState::default()).contains("isn't a DRep"));
    }
    assert!(err(DrepAction::Vote(vec![]), a_drep(false)).contains("at least one"));
    // A registered DRep whose deposit Koios didn't give: its refund isn't guessed as none.
    let unknown_deposit = DrepState {
        deposit: 0,
        ..a_drep(false)
    };
    assert!(err(DrepAction::Retire, unknown_deposit).contains("didn't say what deposit"));
    assert!(
        err(
            DrepAction::Vote(vec![(treasury.clone(), Vote::Yes), (treasury, Vote::No)]),
            a_drep(false)
        )
        .contains("only one vote")
    );

    // Without Koios's figure for the deposit, nothing is guessed.
    let unknown = ProtocolParameters {
        drep_deposit: None,
        ..params()
    };
    let refused = Staking::drep(
        &w.key,
        &registered(0, true),
        &drep_key(&w),
        &DrepState::default(),
        &register,
        &unknown,
    );
    let refused = refused.unwrap_err().to_string();
    assert!(refused.contains("registering a DRep locks up"), "{refused}");
}

#[test]
fn an_anchor_is_an_address_and_a_hash() {
    let a = profile();
    assert_eq!(a.content_hash.as_ref(), &[0xab; 32]);
    let err = |url: &str, hash: &str| anchor(url, hash).unwrap_err().to_string();
    let hash = "ab".repeat(32);
    assert!(err("", &hash).contains("address"));
    assert!(err("https://example.com/a b.json", &hash).contains("spaces"));
    let long = format!("https://example.com/{}", "a".repeat(MAX_ANCHOR_URL));
    assert!(err(&long, &hash).contains("limit of 128"));
    let most = format!("https://example.com/{}", "a".repeat(MAX_ANCHOR_URL - 20));
    assert_eq!(anchor(&most, &hash).unwrap().url.len(), MAX_ANCHOR_URL);
    assert!(err("https://example.com/d.json", "abcd").contains("64 hex"));
    assert!(gov_action_id("abcd", 0).is_err());
}

#[test]
fn every_drep_transaction_builds_soundly() {
    let w = world();
    let available = vec![
        utxo(&w, 1, 0, 3_000_000, vec![]),
        utxo(&w, 2, 1, 520_000_000, vec![]),
    ];
    let treasury = gov_action_id(TREASURY, 0).unwrap();
    let info = gov_action_id(INFO, 0).unwrap();
    for (action, stake, drep) in [
        (
            DrepAction::Register {
                anchor: Some(profile()),
                delegate: true,
            },
            StakeState::default(),
            DrepState::default(),
        ),
        (
            DrepAction::Update {
                anchor: Some(profile()),
            },
            registered(0, true),
            a_drep(true),
        ),
        (DrepAction::Retire, registered(0, true), a_drep(true)),
        (
            DrepAction::Vote(vec![
                (treasury.clone(), Vote::Abstain),
                (info.clone(), Vote::No),
            ]),
            registered(0, true),
            a_drep(true),
        ),
    ] {
        let staking = as_drep(&w, action.clone(), stake, drep);
        let built =
            build::account_staking(&w.params, &available, &staking, &w.change, None).unwrap();
        let tx = assert_sound(&w, &available, &staking, &built);
        assert_eq!(built.outputs, 0, "{action:?} pays nobody");
        if let DrepAction::Retire = action {
            assert_eq!(tx.inputs.len(), 1);
            assert!(
                built.change_lovelace > DREP_DEPOSIT,
                "the deposit comes back"
            );
        }
    }

    // Not enough for the deposit: said in words, before the node would.
    let small = vec![utxo(&w, 1, 0, 400_000_000, vec![])];
    let register = as_drep(
        &w,
        DrepAction::Register {
            anchor: None,
            delegate: false,
        },
        registered(0, true),
        DrepState::default(),
    );
    let err = build::account_staking(&w.params, &small, &register, &w.change, None)
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    assert!(err.contains("Not enough ADA"), "{err}");
}
