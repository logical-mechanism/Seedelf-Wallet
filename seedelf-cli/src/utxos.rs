use crate::assets::{string_to_u64, Asset, Assets};
use crate::koios::{address_utxos, UtxoResponse};
use crate::transaction::wallet_minimum_lovelace_with_assets;

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
pub fn select(mut utxos: Vec<UtxoResponse>, lovelace: u64, tokens: Assets) -> Vec<UtxoResponse> {
    // no tokens just lovelace case
    // use largest first algo but account for change
    let mut selected_utxos = Vec::new();
    let mut current_lovelace_sum = 0;
    let mut found_enough = false;

    // all the found assets
    let mut found_assets: Assets = Assets::new();

    // sort by largest ada first
    if tokens.items.clone().is_empty() {
        // (empty asset lists first)
        utxos.sort_by(|a, b| {
            let a_group_key = a.asset_list.as_ref().map_or(false, |list| list.is_empty());
            let b_group_key = b.asset_list.as_ref().map_or(false, |list| list.is_empty());
        
            b_group_key.cmp(&a_group_key).then_with(|| string_to_u64(b.value.clone()).cmp(&string_to_u64(a.value.clone())))
        });
    } else {
        // (empty asset lists go last)
        utxos.sort_by(|a, b| {
            let a_group_key = a.asset_list.as_ref().map_or(false, |list| list.is_empty());
            let b_group_key = b.asset_list.as_ref().map_or(false, |list| list.is_empty());
        
            a_group_key.cmp(&b_group_key).then_with(|| string_to_u64(b.value.clone()).cmp(&string_to_u64(a.value.clone())))
        });
    }

    for utxo in utxos.clone() {
        let value = string_to_u64(utxo.value.clone()).unwrap();
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

        // the utxo is not pure ada and doesnt contain what you need but you need ada because you found the tokens so add it
        if !added && current_lovelace_sum < lovelace && found_assets.contains(tokens.clone()) {
            selected_utxos.push(utxo.clone());
            current_lovelace_sum += value;
            found_assets = found_assets.merge(utxo_assets);

        }

        // we know we found enough lovealced
        if current_lovelace_sum >= lovelace && found_assets.contains(tokens.clone()) {
            // but is it enough to account for hte min ada for the token change
            let minimum = wallet_minimum_lovelace_with_assets(found_assets.clone());
            if current_lovelace_sum - minimum >= lovelace {
                // it is!
                found_enough = true;
                break;
            } else {
                // its not, try again but increase the lovelace
                select(utxos.clone(), lovelace + minimum, tokens.clone());
            }
        }
    }
    if found_enough {
        // there are pure ada utxos and we found it
        selected_utxos
    } else {
        // not enough utxos to pay for what you are trying to do so return the empty utxo set
        Vec::new()
    }
}
