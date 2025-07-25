import { invoke } from "@tauri-apps/api/core";
import { Network } from "@/types/network";
import { TxResponseWithSide, UtxoResponse } from "@/types/wallet";

function castNetwork(network: Network): boolean {
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
  return await invoke<TxResponseWithSide[]>("get_wallet_history", {
    networkFlag: flag,
  });
}
