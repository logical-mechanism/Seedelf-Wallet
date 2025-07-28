import { invoke } from "@tauri-apps/api/core";
import { Network } from "@/types/network";
import { castNetwork } from "./api";


export async function createSeedelf(
  network: Network,
  addr: string,
  label: string,
): Promise<string> {
  const flag = castNetwork(network);
  return await invoke<string>("create_seedelf", {
    networkFlag: flag,
    addr: addr,
    label: label
  });
}