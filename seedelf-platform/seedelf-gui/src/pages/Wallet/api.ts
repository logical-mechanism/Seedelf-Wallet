import { invoke } from "@tauri-apps/api/core";
import { Network } from "@/types/network";
import { TxResponseWithSide } from "@/types/wallet";

export async function getLovelaceBalance(network: Network): Promise<number> {
    let flag;
    if (network == "mainnet") {
        flag = false
    } else {
        flag = true
    }
    const balance = await invoke<number>("get_lovelace_balance", { networkFlag: flag });
    const ada = balance ? balance / 1_000_000.0 : 0;
    return ada;
}

export async function getWalletHistory(network: Network): Promise<TxResponseWithSide[]> {
    let flag;
    if (network == "mainnet") {
        flag = false
    } else {
        flag = true
    }
    return await invoke<TxResponseWithSide[]>("get_wallet_history", { networkFlag: flag })
}