// Everything network-specific lives here. Preprod is the default; mainnet is
// a build flag (VITE_ENABLE_MAINNET=true). See docs/architecture.md#networks.

export type NetworkName = "preprod" | "mainnet";

export interface NetworkConfig {
  name: NetworkName;
  label: string;
  koios: string;
  collateral: string;
  /** Where ADA's price is read (CoinGecko's public API). Mainnet only, as in Lace: test ADA has no value. */
  prices?: string;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  preprod: {
    name: "preprod",
    label: "Preprod",
    koios: "https://preprod.koios.rest/api/v1",
    collateral: "https://www.giveme.my/preprod/collateral/",
  },
  mainnet: {
    name: "mainnet",
    label: "Mainnet",
    koios: "https://api.koios.rest/api/v1",
    collateral: "https://www.giveme.my/mainnet/collateral/",
    prices: "https://api.coingecko.com/api/v3",
  },
};

/** Networks a build can use: preprod-only unless mainnet is enabled. */
export function enabledNetworks(mainnetEnabled: boolean): NetworkName[] {
  return mainnetEnabled ? ["mainnet", "preprod"] : ["preprod"];
}

/** The network a fresh install starts on. */
export function defaultNetwork(mainnetEnabled: boolean): NetworkName {
  return mainnetEnabled ? "mainnet" : "preprod";
}

/** Origins the extension may talk to, e.g. `https://preprod.koios.rest`. */
export function networkOrigins(networks: NetworkName[]): string[] {
  const origins = networks.flatMap((n) => [NETWORKS[n].koios, NETWORKS[n].collateral, NETWORKS[n].prices ?? []].flat());
  return [...new Set(origins.map((url) => new URL(url).origin))];
}

/**
 * The manifest's host permissions: the wallet's own services. Chrome's grant
 * is what lets the wallet read Koios at all: its public tier sends browsers
 * no CORS headers (since 2026-09-25), and an extension's requests to a host
 * it holds skip CORS.
 */
export function serviceHosts(networks: NetworkName[]): string[] {
  return networkOrigins(networks).map((o) => `${o}/*`);
}
