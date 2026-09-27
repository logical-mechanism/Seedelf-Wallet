//! Pins the deployed Seedelf contracts (variant 1) and giveme.my's collateral
//! on both networks, mainnet above all. Variant 1 is frozen: a new build of
//! the contracts is a new variant, never an edit to these values, and never a
//! copy of `seedelf-contracts/hashes/`, which holds a later, undeployed build.

use pallas_addresses::{Address, Network};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::conway::PseudoScript;
use pallas_traverse::{Era, MultiEraOutput};
use pallas_txbuilder::Input;
use seedelf_core::constants::{
    COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY, MAINNET_COLLATERAL_UTXO, VARIANT, get_config,
};
use seedelf_core::{eval, references, transaction};

/// The deployed wallet contract (5b82530, Aiken v1.1.9).
const WALLET_HASH: &str = "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469";
/// The deployed Seedelf policy.
const SEEDELF_POLICY: &str = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";
/// The deployed always-false script, which holds the reference UTxOs.
const ALWAYS_FALSE: &str = "6777ba4dc8c3043377201624502d92636381144700d49983258b75db";

const MAINNET_WALLET_REFERENCE: &str =
    "51f12c1a5c2b0558a284628d81b06dee50b27693242fe35618c5f921730c0527";
const MAINNET_SEEDELF_REFERENCE: &str =
    "f3955f42f660fae8b3e4dcf664011876cf769d87aa8450dc73171b4f6b5f520b";
const PREPROD_WALLET_REFERENCE: &str =
    "96fbddac63c55284fbbaa3c216ef1c0f460019e8643a889a189d5b5f7ddd71d6";
const PREPROD_SEEDELF_REFERENCE: &str =
    "f620a4e949bfbefbf2892d39d0777439f3acfbf850eae9b007c6558ba8ef4db4";

/// The Plutus V3 script a bundled reference output carries, and its address.
fn script_of(output_hex: &str) -> (Vec<u8>, Address) {
    let bytes = hex::decode(output_hex).unwrap();
    let output = MultiEraOutput::decode(Era::Conway, &bytes).unwrap();
    let Some(PseudoScript::PlutusV3Script(script)) = output.script_ref() else {
        panic!("a reference output carries a Plutus V3 script");
    };
    (script.as_ref().to_vec(), output.address().unwrap())
}

/// A Plutus V3 script's hash: blake2b-224 of 0x03 followed by the script.
fn v3_hash(script: &[u8]) -> String {
    hex::encode(Hasher::<224>::hash(&[&[3u8][..], script].concat()))
}

#[test]
fn variant_1_is_the_deployed_contracts() {
    assert_eq!(VARIANT, 1);
    for preprod in [true, false] {
        let contract = get_config(1, preprod).unwrap().contract;
        assert_eq!(hex::encode(contract.wallet_contract_hash), WALLET_HASH);
        assert_eq!(contract.seedelf_policy_id, SEEDELF_POLICY);
        assert_eq!(contract.wallet_contract_size, 629);
        assert_eq!(contract.seedelf_contract_size, 519);
    }
    assert!(get_config(2, false).is_err(), "no variant 2 yet");
}

#[test]
fn reference_utxos_are_pinned_per_network() {
    // `false` is mainnet: a swap would point every mainnet spend at UTxOs
    // that don't exist there
    for (preprod, wallet, seedelf) in [
        (false, MAINNET_WALLET_REFERENCE, MAINNET_SEEDELF_REFERENCE),
        (true, PREPROD_WALLET_REFERENCE, PREPROD_SEEDELF_REFERENCE),
    ] {
        let reference = get_config(1, preprod).unwrap().reference;
        assert_eq!(hex::encode(reference.wallet_reference_utxo), wallet);
        assert_eq!(hex::encode(reference.seedelf_reference_utxo), seedelf);

        // both are output #1
        let input = transaction::reference_utxo(reference.wallet_reference_utxo);
        assert_eq!(
            input,
            Input::new(Hash::new(reference.wallet_reference_utxo), 1)
        );
        let known: Vec<(String, u64)> = eval::seedelf_references(preprod)
            .unwrap()
            .into_iter()
            .map(|r| (hex::encode(r.tx_hash), r.index))
            .collect();
        assert_eq!(
            known,
            vec![(wallet.to_string(), 1), (seedelf.to_string(), 1)]
        );
    }
}

#[test]
fn bundled_reference_outputs_carry_the_deployed_scripts() {
    for (preprod, wallet, seedelf) in [
        (
            false,
            references::MAINNET_WALLET,
            references::MAINNET_SEEDELF,
        ),
        (
            true,
            references::PREPROD_WALLET,
            references::PREPROD_SEEDELF,
        ),
    ] {
        let contract = get_config(1, preprod).unwrap().contract;
        let network = if preprod {
            Network::Testnet
        } else {
            Network::Mainnet
        };

        let (script, address) = script_of(wallet);
        assert_eq!(v3_hash(&script), hex::encode(contract.wallet_contract_hash));
        assert_eq!(script.len() as u64, contract.wallet_contract_size);
        let (script, policy_address) = script_of(seedelf);
        assert_eq!(v3_hash(&script), contract.seedelf_policy_id);
        assert_eq!(script.len() as u64, contract.seedelf_contract_size);

        // held by the always-false script, on the network they're for
        for address in [address, policy_address] {
            let Address::Shelley(shelley) = address else {
                panic!("a Shelley address");
            };
            assert_eq!(shelley.network(), network);
            assert!(shelley.payment().is_script());
            assert_eq!(shelley.payment().as_hash().to_string(), ALWAYS_FALSE);
        }
    }
}

#[test]
fn mainnet_collateral_is_pinned() {
    assert_eq!(
        hex::encode(MAINNET_COLLATERAL_UTXO),
        "1c2fbce4e3974f721b27226645c7a35d648698c77f62bc337b40bc2cd294e9cd"
    );
    assert_eq!(
        transaction::collateral_input(false),
        Input::new(Hash::new(MAINNET_COLLATERAL_UTXO), 0)
    );
    // giveme.my signs for the collateral with the key it's locked by
    assert_eq!(
        Hasher::<224>::hash(&COLLATERAL_PUBLIC_KEY),
        Hash::new(COLLATERAL_HASH)
    );
    assert_eq!(
        hex::encode(COLLATERAL_HASH),
        "1108b97f2e199d58a0c0697d25412d0fb14d354dcd39654b9eb0dec8"
    );
}
