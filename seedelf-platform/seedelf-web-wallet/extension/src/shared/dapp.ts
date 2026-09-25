// The dApp connector (CIP-30), shared by the content scripts, the worker and
// the UI. Off until the user turns it on in Settings: then Chrome is asked
// for access to https sites (and localhost, for dApps in development), and
// two content scripts are registered for them. One puts
// `window.cardano.seedelf` on the page (the page's own world); the other
// relays its calls to the worker over a port (an isolated world). The
// worker answers with the public account only: nothing about the private
// balance ever reaches a site.

/** The port the bridge opens to the worker. */
export const DAPP_PORT = "seedelf.cip30";

/** Where the connector is offered: every https site, and localhost for dApps in development. */
export const DAPP_ORIGINS = ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"];

/** The two content scripts, as the worker registers them (built as self-contained files: vite.config.ts). */
export const CONTENT_SCRIPTS = [
  { id: "seedelf-cip30-page", file: "cip30-page.js", world: "MAIN" },
  { id: "seedelf-cip30-bridge", file: "cip30-bridge.js", world: "ISOLATED" },
] as const;

/** What `window.postMessage` carries between the page's script and the bridge. */
export const PAGE_CHANNEL = "seedelfCip30";

/** The name dApps show. */
export const WALLET_NAME = "Seedelf Wallet";

/** CIP-30's methods, as the page's script sends them. */
export const DAPP_METHODS = [
  "isEnabled",
  "enable",
  "getNetworkId",
  "getExtensions",
  "getUtxos",
  "getCollateral",
  "getBalance",
  "getUsedAddresses",
  "getUnusedAddresses",
  "getChangeAddress",
  "getRewardAddresses",
  "signTx",
  "signData",
  "submitTx",
] as const;
export type DappMethod = (typeof DAPP_METHODS)[number];

/** Methods that change nothing, so the bridge can ask again if the worker restarted mid-call. */
export const READ_METHODS: ReadonlySet<DappMethod> = new Set<DappMethod>([
  "isEnabled",
  "getNetworkId",
  "getExtensions",
  "getUtxos",
  "getCollateral",
  "getBalance",
  "getUsedAddresses",
  "getUnusedAddresses",
  "getChangeAddress",
  "getRewardAddresses",
]);

export const isDappMethod = (m: unknown): m is DappMethod => (DAPP_METHODS as readonly unknown[]).includes(m);

/** A call from the bridge to the worker. */
export interface DappCall {
  id: string;
  method: DappMethod;
  args: unknown[];
}

/**
 * CIP-30's errors, as the page's script throws them: `{ code, info }`, or a
 * paginate error's `{ maxSize }`.
 */
export type DappFailure = { code: number; info: string } | { maxSize: number };

/** The worker's answer to a call. */
export type DappAnswer = { id: string; value: unknown } | { id: string; error: DappFailure };

/** CIP-30's error codes. */
export const APIError = { InvalidRequest: -1, InternalError: -2, Refused: -3, AccountChange: -4 } as const;
export const TxSignError = { ProofGeneration: 1, UserDeclined: 2 } as const;
export const DataSignError = { ProofGeneration: 1, AddressNotPK: 2, UserDeclined: 3 } as const;
export const TxSendError = { Refused: 1, Failure: 2 } as const;
