// Everything network-specific lives here. Every build has both networks,
// mainnet first: the welcome screen asks which before a wallet exists, and
// Settings switches between them. VITE_ENABLE_MAINNET=false makes a
// preprod-only build, for tests. See docs/architecture.md#networks.

export type NetworkName = "preprod" | "mainnet";

/** Lovejoin, the mixer, where it's deployed (docs/architecture.md, Lovejoin). */
export interface LovejoinConfig {
  /** Lovejoin's `mix_box` script hash: where every box sits. */
  mixBox: string;
  /**
   * The fewest real boxes that aren't the wallet's that the pool must hold
   * before a chain draws from it: a box is hidden only among others, and a
   * pool of a few hides little. Mainnet's is the owner's to tune; preprod
   * takes any pool, for testing.
   */
  poolFloor: number;
  /** What a 3-box mix costs on this network's scripts, in lovelace, as measured: for the settings' words, never for a build. */
  mixCost: number;
}

export interface NetworkConfig {
  name: NetworkName;
  label: string;
  koios: string;
  collateral: string;
  /** Where ADA's price is read (CoinGecko's public API). Mainnet only, as in Lace: test ADA has no value. */
  prices?: string;
  /**
   * Minswap's aggregator API, for swaps in private sessions. It answers
   * browsers with CORS headers, so it needs no host permission (no new
   * warning at install): only the pages' connect-src lists it.
   */
  swaps: string;
  /** Lovejoin, where it's deployed. */
  lovejoin?: LovejoinConfig;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  preprod: {
    name: "preprod",
    label: "Preprod",
    koios: "https://preprod.koios.rest/api/v1",
    collateral: "https://www.giveme.my/preprod/collateral/",
    swaps: "https://aggr.monorepo-testnet-preprod.minswap.org/aggregator",
    lovejoin: {
      mixBox: "67ffe4ed7f0ccd0a3e3069fddc26d9bccde3fe63d3d58c5e84f7ecc5",
      poolFloor: 0,
      // 0.877 ₳, measured on preprod (chunk 16).
      mixCost: 877_000,
    },
  },
  mainnet: {
    name: "mainnet",
    label: "Mainnet",
    koios: "https://api.koios.rest/api/v1",
    collateral: "https://www.giveme.my/mainnet/collateral/",
    prices: "https://api.coingecko.com/api/v3",
    swaps: "https://agg-api.minswap.org/aggregator",
    // Live since 2026-09-26 (_reference/Lovejoin/artifacts/mainnet/addresses.json).
    lovejoin: {
      mixBox: "c145c10ff4bcaef7f5a4dbb3fcbfddca4b6c7b08191b0690b12f1fad",
      poolFloor: 30,
      // 0.822–0.828 ₳, measured against mainnet's scripts (the launch review).
      mixCost: 825_000,
    },
  },
};

/**
 * The IPFS gateway an NFT's image is fetched through, when the user asks to
 * see it (chunk 20): Blockfrost's, the one Lace uses, and the only one of
 * about twenty public gateways tried on 2026-10-04 that still served files
 * (ipfs.io and dweb.link have moved to a service-worker gateway, and answer
 * 429). IPFS is the same on both networks, so one gateway
 * serves both. It sends no CORS headers, so the worker reads it through
 * Chrome's grant for this one host, asked for at the first image shown: a
 * part of the optional access to https sites the manifest already declares
 * for the dApp connector (shared/dapp.ts), so installing asks for nothing new.
 */
export const IPFS_GATEWAY = "https://ipfs.blockfrost.dev";

/** Chrome's host pattern for the gateway: what the first image asks Chrome for. */
export const IPFS_GATEWAY_HOST = `${IPFS_GATEWAY}/*`;

/** An epoch's length since Shelley, on both networks: 432,000 one-second slots, five days. */
export const EPOCH_MS = 432_000_000;

/**
 * Shelley's first epoch and when it started: seedelf-core's `slot_config`
 * (eval.rs) gives the same moments as slots.
 */
const SHELLEY: Record<NetworkName, { epoch: number; startMs: number }> = {
  preprod: { epoch: 4, startMs: 1_655_769_600_000 },
  mainnet: { epoch: 208, startMs: 1_596_059_091_000 },
};

/** When `epoch` starts on `network` (ms since 1970), counted from Shelley's start: no request. */
export function epochStart(network: NetworkName, epoch: number): number {
  const shelley = SHELLEY[network];
  return shelley.startMs + (epoch - shelley.epoch) * EPOCH_MS;
}

/** The epoch `ms` (ms since 1970) falls in on `network`. */
export function epochAt(network: NetworkName, ms: number): number {
  const shelley = SHELLEY[network];
  return shelley.epoch + Math.floor((ms - shelley.startMs) / EPOCH_MS);
}

/** Whether Lovejoin is deployed on `network`: the worker's gate and the UI's, one source. */
export function lovejoinOn(network: NetworkName): boolean {
  return NETWORKS[network].lovejoin !== undefined;
}

/** Networks a build can use: preprod only unless mainnet is enabled, and then mainnet first. */
export function enabledNetworks(mainnetEnabled: boolean): NetworkName[] {
  return mainnetEnabled ? ["mainnet", "preprod"] : ["preprod"];
}

/** The network a fresh install starts on. */
export function defaultNetwork(mainnetEnabled: boolean): NetworkName {
  return enabledNetworks(mainnetEnabled)[0]!;
}

/** Whether `value` names a network. */
export function isNetworkName(value: unknown): value is NetworkName {
  return value === "preprod" || value === "mainnet";
}

/** Origins the extension may talk to, e.g. `https://preprod.koios.rest`. */
export function networkOrigins(networks: NetworkName[]): string[] {
  const origins = networks.flatMap((n) => [NETWORKS[n].koios, NETWORKS[n].collateral, NETWORKS[n].prices ?? []].flat());
  return [...new Set(origins.map((url) => new URL(url).origin))];
}

/** Origins the pages may reach without a host permission: services that answer with CORS headers. */
export function corsOrigins(networks: NetworkName[]): string[] {
  return [...new Set(networks.map((n) => new URL(NETWORKS[n].swaps).origin))];
}

/**
 * Origins the CSP lets the worker reach only once the user grants Chrome's
 * access to them: the IPFS gateway, for an NFT's image (chunk 20). Not a
 * host permission in the manifest, so installing the wallet asks for nothing
 * more.
 */
export function grantedOrigins(): string[] {
  return [IPFS_GATEWAY];
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
