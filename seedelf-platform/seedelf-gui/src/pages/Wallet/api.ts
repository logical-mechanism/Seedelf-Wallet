import { invoke } from "@tauri-apps/api/core";
import { Network } from "@/types/network";

export async function getLovelaceBalance(network: Network) {
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