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
  /**
   * Seedelf Wallet's own data layer (seedelf-data/, chunk 26): its origin,
   * where the network has one. Only mainnet does; preprod reads everything
   * through Koios. A dev or e2e build can name another with
   * VITE_DATA_ORIGIN (`dataOrigin`); a store build never does.
   */
  data?: string;
  /**
   * Seedelf Messaging's relay (chunk 54): its origin, and the pool this
   * network's envelopes go to, named in the path. Both pools are on the data
   * layer's server (calls 1 and 4): preprod's too, though preprod reads
   * nothing else there. The wallet reaches it only while the network's
   * Messages switch is on (messaging.ts). A dev or e2e build names another
   * origin with VITE_DATA_ORIGIN (`relayOrigin`), as for the data layer.
   */
  relay: { origin: string; pool: NetworkName };
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
    },
    // The preprod pool on the data layer's server (chunk 54's call 4).
    relay: { origin: "https://mainnet.seedelf.logicalmechanism.io", pool: "preprod" },
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
    },
    // The API on its DigitalOcean droplet (chunk 26c, seedelf-data/deploy/README.md).
    // It answers CORS for the store's and the dev build's IDs (DATA_ORIGINS).
    data: "https://mainnet.seedelf.logicalmechanism.io",
    relay: { origin: "https://mainnet.seedelf.logicalmechanism.io", pool: "mainnet" },
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

/** A Byron epoch: 21,600 slots of 20 s, on both networks, before Shelley's one-second slots. */
const BYRON_EPOCH_SLOTS = 21_600;
const BYRON_SLOT_MS = 20_000;

/**
 * When `slot` starts on `network` (ms since 1970), the slots a transaction's validity interval is counted in:
 * seedelf-core's `slot_config` from Shelley's start, Byron's before it. No request.
 */
export function slotStart(network: NetworkName, slot: number): number {
  const shelley = SHELLEY[network];
  const first = shelley.epoch * BYRON_EPOCH_SLOTS;
  return shelley.startMs + (slot - first) * (slot < first ? BYRON_SLOT_MS : 1000);
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

/**
 * The data layer's origin on `network`, if this build reads one there: the
 * network's own, or `override` (VITE_DATA_ORIGIN, a dev or e2e build's), on a
 * network that has a data layer at all. A store build never passes an
 * override (vite.config.ts).
 */
export function dataOrigin(network: NetworkName, override = ""): string | undefined {
  const own = NETWORKS[network].data;
  if (own === undefined) return undefined;
  const origin = override || own;
  return origin ? new URL(origin).origin : undefined;
}

/**
 * Seedelf Messaging's relay on `network` (chunk 54): the network's own, or
 * `override` (VITE_DATA_ORIGIN, a dev or e2e build's, where the relay lives
 * as it does on the data layer's server). A store build never passes one.
 */
export function relayOrigin(network: NetworkName, override = ""): string {
  return new URL(override || NETWORKS[network].relay.origin).origin;
}

/**
 * Origins the pages may reach without a host permission: services that
 * answer with CORS headers. The data layer is one: it answers the wallet's
 * own origin (seedelf-data's DATA_ORIGINS), so it adds nothing asked for at
 * install. So is Seedelf Messaging's relay, on the same server: a
 * preprod-only build lists it for preprod's pool.
 */
export function corsOrigins(networks: NetworkName[], dataOverride = ""): string[] {
  const data = networks.flatMap((n) => dataOrigin(n, dataOverride) ?? []);
  const relays = networks.map((n) => relayOrigin(n, dataOverride));
  return [...new Set([...networks.map((n) => new URL(NETWORKS[n].swaps).origin), ...data, ...relays])];
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
