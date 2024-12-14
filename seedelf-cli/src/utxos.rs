use blstrs::Scalar;

use crate::assets::{string_to_u64, Asset, Assets};
use crate::constants::{MAXIMUM_WALLET_UTXOS, SEEDELF_POLICY_ID, WALLET_CONTRACT_HASH};
use crate::koios::{
    address_utxos, contains_policy_id, credential_utxos, extract_bytes_with_logging, UtxoResponse,
};
use crate::register::Register;
use crate::transaction::wallet_minimum_lovelace_with_assets;

pub async fn find_seedelf_and_wallet_utxos(sk: Scalar, seedelf: String, network_flag: bool) -> (Option<Register>, Vec<UtxoResponse>) {
    let mut usuable_utxos: Vec<UtxoResponse> = Vec::new();
    let mut number_of_utxos: u64 = 0;

    let mut seedelf_datum: Option<Register> = None;
    let mut found_seedelf: bool = false;
    match credential_utxos(WALLET_CONTRACT_HASH, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
                    if !found_seedelf && contains_policy_id(&utxo.asset_list, SEEDELF_POLICY_ID) {
                        let asset_name = utxo
                                .asset_list
                                .as_ref()
                                .and_then(|vec| {
                                    vec.iter()
                                        .find(|asset| asset.policy_id == SEEDELF_POLICY_ID)
                                        .map(|asset| &asset.asset_name)
                                })
                                .unwrap();
                            if asset_name == &seedelf {
                                found_seedelf = true;
                                seedelf_datum = Some(inline_datum.clone());
                            }
                    }
                    // utxo must be owned by this secret scaler
                    if inline_datum.is_owned(sk) {
                        // its owned but it can't hold a seedelf
                        if !contains_policy_id(&utxo.asset_list, SEEDELF_POLICY_ID) {
                            if number_of_utxos >= MAXIMUM_WALLET_UTXOS {
                                // we hit the max utxos allowed in a single tx
                                println!("Maximum UTxOs");
                                break;
                            }
                            usuable_utxos.push(utxo);
                            number_of_utxos += 1;
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!(
                "Failed to fetch UTxOs: {}\nWait a few moments and try again.",
                err
            );
        }
    }
    (seedelf_datum, usuable_utxos)
}

pub async fn find_seedelf_utxo(seedelf: String, network_flag: bool) -> Option<UtxoResponse> {
    match credential_utxos(WALLET_CONTRACT_HASH, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                if contains_policy_id(&utxo.asset_list, SEEDELF_POLICY_ID) {
                    let asset_name = utxo
                        .asset_list
                        .as_ref()
                        .and_then(|vec| {
                            vec.iter()
                                .find(|asset| asset.policy_id == SEEDELF_POLICY_ID)
                                .map(|asset| &asset.asset_name)
                        })
                        .unwrap();
                    if asset_name == &seedelf {
                        // we found it so stop searching
                        return Some(utxo);
                    }
                }
            }
        }
        Err(err) => {
            eprintln!(
                "Failed to fetch UTxOs: {}\nWait a few moments and try again.",
                err
            );
        }
    }
    None
}

pub async fn collect_wallet_utxos(sk: Scalar, network_flag: bool) -> Vec<UtxoResponse> {
    let mut number_of_utxos: u64 = 0;

    let mut usuable_utxos: Vec<UtxoResponse> = Vec::new();

    match credential_utxos(WALLET_CONTRACT_HASH, network_flag).await {
        Ok(utxos) => {
            for utxo in utxos {
                // Extract bytes
                if let Some(inline_datum) = extract_bytes_with_logging(&utxo.inline_datum) {
                    // utxo must be owned by this secret scaler
                    if inline_datum.is_owned(sk) {
                        // its owned but it can't hold a seedelf
                        if !contains_policy_id(&utxo.asset_list, SEEDELF_POLICY_ID) {
                            if number_of_utxos >= MAXIMUM_WALLET_UTXOS {
                                // we hit the max utxos allowed in a single tx
                                println!("Maximum UTxOs");
                                break;
                            }
                            usuable_utxos.push(utxo);
                            number_of_utxos += 1;
                        }
                    }
                }
            }
        }
        Err(err) => {
            eprintln!(
                "Failed to fetch UTxOs: {}\nWait a few moments and try again.",
                err
            );
        }
    }
    usuable_utxos
}

pub async fn collect_address_utxos(address: &str, network_flag: bool) -> Vec<UtxoResponse> {
    let mut usuable_utxos: Vec<UtxoResponse> = Vec::new();
    // This should probably be some generalized function later
    match address_utxos(address, network_flag).await {
        Ok(utxos) => {
            // loop all the utxos found from the address
            for utxo in utxos {
                // get the lovelace on this utxo
                let lovelace: u64 = utxo.value.parse::<u64>().expect("Invalid Lovelace");
                if let Some(assets) = &utxo.asset_list {
                    if assets.is_empty() && lovelace == 5_000_000 {
                        // its probably a collateral utxo
                    } else {
                        // its probably not a collateral utxo
                        usuable_utxos.push(utxo);
                    }
                }
            }
        }
        Err(err) => {
            eprintln!(
                "Failed to fetch UTxOs: {}\nWait a few moments and try again.",
                err
            );
        }
    }
    usuable_utxos
}

// lets assume that the lovelace here initially accounts for the estimated fee, like 1 ada or something
// use largest first algo but account for change
pub fn select(mut utxos: Vec<UtxoResponse>, lovelace: u64, tokens: Assets) -> Vec<UtxoResponse> {
    let mut selected_utxos: Vec<UtxoResponse> = Vec::new();

    let mut current_lovelace_sum: u64 = 0;
    let mut found_enough: bool = false;

    // all the found assets
    let mut found_assets: Assets = Assets::new();

    // sort by largest ada first
    // (empty asset lists first)
    utxos.sort_by(|a, b| {
        let a_group_key = a.asset_list.as_ref().map_or(false, |list| list.is_empty());
        let b_group_key = b.asset_list.as_ref().map_or(false, |list| list.is_empty());

        b_group_key
            .cmp(&a_group_key)
            .then_with(|| string_to_u64(b.value.clone()).cmp(&string_to_u64(a.value.clone())))
    });

    for utxo in utxos.clone() {
        // the value from koios is the lovelace
        let value: u64 = string_to_u64(utxo.value.clone()).unwrap();

        let mut utxo_assets: Assets = Assets::new();
        let mut added: bool = false;

        // lets keep track if we found any assets while searching
        if let Some(assets) = utxo.clone().asset_list {
            if !assets.is_empty() {
                for token in assets.clone() {
                    utxo_assets = utxo_assets.add(Asset::new(
                        token.policy_id,
                        token.asset_name,
                        string_to_u64(token.quantity).unwrap(),
                    ));
                }
                // if this utxo has the assets we need but we haven't found it all yet then add it
                if utxo_assets.any(tokens.clone()) && !found_assets.contains(tokens.clone()) {
                    selected_utxos.push(utxo.clone());
                    current_lovelace_sum += value;
                    found_assets = found_assets.merge(utxo_assets.clone());
                    added = true;
                }
            } else {
                // no tokens here just lovelace so add it
                if current_lovelace_sum < lovelace {
                    selected_utxos.push(utxo.clone());
                    current_lovelace_sum += value;
                    added = true;
                }
            }
        }

        // the utxo is not pure ada and doesnt contain what you need but you need ada because you already found the tokens so add it
        if !added && current_lovelace_sum < lovelace && found_assets.contains(tokens.clone()) {
            selected_utxos.push(utxo.clone());
            current_lovelace_sum += value;
            found_assets = found_assets.merge(utxo_assets);
        }

        // we know we found enough lovelace and assets
        if current_lovelace_sum >= lovelace && found_assets.contains(tokens.clone()) {
            // but is it enough to account for the min ada for the token change as we will assume there will always be a change utxo
            let change_assets: Assets = found_assets.separate(tokens.clone());
            let minimum: u64 = wallet_minimum_lovelace_with_assets(change_assets);
            if current_lovelace_sum - minimum >= lovelace {
                // it is!
                found_enough = true;
                break;
            } else {
                // its not, try again but increase the lovelace by the minimum we would need
                select(utxos.clone(), lovelace + minimum, tokens.clone());
            }
        }
    }
    if found_enough {
        // we found enough utxos to pay for it
        selected_utxos
    } else {
        // not enough utxos to pay for what you are trying to do so return the empty utxo set
        Vec::new()
    }
}

pub fn assets_of(utxos: Vec<UtxoResponse>) -> (u64, Assets) {
    let mut found_assets: Assets = Assets::new();
    let mut current_lovelace_sum: u64 = 0;

    for utxo in utxos.clone() {
        let value: u64 = string_to_u64(utxo.value.clone()).unwrap();
        current_lovelace_sum += value;

        if let Some(assets) = utxo.clone().asset_list {
            if !assets.is_empty() {
                let mut utxo_assets: Assets = Assets::new();

                for token in assets.clone() {
                    utxo_assets = utxo_assets.add(Asset::new(
                        token.policy_id,
                        token.asset_name,
                        string_to_u64(token.quantity).unwrap(),
                    ));
                }

                found_assets = found_assets.merge(utxo_assets.clone());
            }
        }
    }
    (current_lovelace_sum, found_assets)
}
