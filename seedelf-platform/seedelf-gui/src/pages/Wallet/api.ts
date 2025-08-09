import { invoke } from "@tauri-apps/api/core";
import { Network } from "@/types/network";
import { TxResponseWithSide, UtxoResponse } from "@/types/wallet";

export function castNetwork(network: Network): boolean {
  if (network == "mainnet") {
    return false;
  } else {
    return true;
  }
}

export async function getEveryUtxo(network: Network): Promise<UtxoResponse[]> {
  const flag = castNetwork(network);
  return await invoke<UtxoResponse[]>("get_every_utxo", { networkFlag: flag });
}

export async function getEverySeedelf(
  network: Network,
  allUtxos: UtxoResponse[],
): Promise<string[]> {
  const flag = castNetwork(network);
  return invoke<string[]>("get_every_seedelf", {
    networkFlag: flag,
    allUtxos: allUtxos,
  });
}

export function getOwnedUtxo(
  network: Network,
  everyUtxo: UtxoResponse[],
): Promise<UtxoResponse[]> {
  const flag = castNetwork(network);
  return invoke<UtxoResponse[]>("get_owned_utxo", {
    networkFlag: flag,
    everyUtxo: everyUtxo,
  });
}

export async function getOwnedSeedelfs(
  network: Network,
  everyUtxo: UtxoResponse[],
): Promise<string[]> {
  const flag = castNetwork(network);
  return await invoke<string[]>("get_owned_seedelfs", {
    networkFlag: flag,
    everyUtxo: everyUtxo,
  });
}

export async function getLovelaceBalance(
  ownedUtxos: UtxoResponse[],
): Promise<number> {
  const balance = await invoke<number>("get_lovelace_balance", {
    ownedUtxos: ownedUtxos,
  });
  const ada = balance ? balance / 1_000_000.0 : 0;
  return ada;
}

export async function getWalletHistory(
  network: Network,
): Promise<TxResponseWithSide[]> {
  const flag = castNetwork(network);
  const history = await invoke<TxResponseWithSide[]>("get_wallet_history", {
    networkFlag: flag,
  });
  // force newest first
  const sortedHistory = history
    .slice()
    .sort((a, b) => b.tx.block_height - a.tx.block_height);
  return sortedHistory;
}

export async function isNotAScript(addr: string): Promise<boolean> {
  return await invoke<boolean>("is_not_a_script", { addr: addr });
}

export async function seedelfPolicyId(network: Network): Promise<string> {
  const flag = castNetwork(network);
  return await invoke<string>("get_seedelf_policy_id", {
    networkFlag: flag,
  });
}
