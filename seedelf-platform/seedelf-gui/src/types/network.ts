import { createContext, useContext } from "react";

// only support mainnet and pre-production
export type Network = "mainnet" | "preprod";

interface NetworkCtx {
  network: Network;
  // we need a way to switch networks
  setNetwork: (n: Network) => void;
}

export const NetworkContext = createContext<NetworkCtx | null>(null);

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used inside <WalletLayout>");
  return ctx;
}
