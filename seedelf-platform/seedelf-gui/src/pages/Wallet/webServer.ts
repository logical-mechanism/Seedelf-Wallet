import { invoke } from "@tauri-apps/api/core";
import { Network } from "@/types/network";
import { castNetwork } from "./api";

export async function runWebServer(tx_cbor: string, network: Network): Promise<void> {
  const flag = castNetwork(network);
  return await invoke<void>("open_web_server", {txCbor: tx_cbor, networkFlag: flag})
}

export async function stopWebServer() {
  await invoke<void>("close_web_server");
}