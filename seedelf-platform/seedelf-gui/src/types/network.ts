import { createContext, useContext } from "react";

export type Network = "mainnet" | "preprod";

interface NetworkCtx {
  network: Network;
  setNetwork: (n: Network) => void;
}

export const NetworkContext = createContext<NetworkCtx | null>(null);

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used inside <WalletLayout>");
  return ctx;
}
