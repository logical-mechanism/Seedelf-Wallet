// `window.cardano.seedelf`: CIP-30 on the page, in the page's own world.
// Registered only while the dApp connector is on (shared/dapp.ts). Every
// call goes to the bridge (bridge.ts) by `window.postMessage`, and from there
// to the worker, which decides what the site may see and asks the user
// before anything is signed. Built as one self-contained file: nothing here
// leaks into the page's globals except `window.cardano.seedelf`.

import icon from "../../public/icons/icon-48.png?inline";
import { PAGE_CHANNEL, WALLET_NAME, type DappFailure, type DappMethod } from "../shared/dapp";

type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void };

const page = window as unknown as { cardano?: Record<string, unknown> };

// Another copy (a second injection) or another wallet of the same name keeps its own.
if (!page.cardano?.seedelf) {
  // Ids are unique to this page, so replies meant for another script are ignored.
  const session = Math.random().toString(36).slice(2);
  let next = 0;
  const pending = new Map<string, Pending>();

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as { [PAGE_CHANNEL]?: unknown; id?: unknown; value?: unknown; error?: DappFailure } | null;
    if (data?.[PAGE_CHANNEL] !== "reply" || typeof data.id !== "string") return;
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(failure(data.error));
    else call.resolve(data.value);
  });

  /** CIP-30's error as dApps expect it (`code` and `info`), and an Error for the console. */
  const failure = (error: DappFailure) =>
    "maxSize" in error
      ? Object.assign(new Error(`Seedelf Wallet: page out of range (${error.maxSize} items)`), error)
      : Object.assign(new Error(error.info), error);

  const call = (method: DappMethod, ...args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const id = `${session}-${++next}`;
      pending.set(id, { resolve, reject });
      window.postMessage({ [PAGE_CHANNEL]: "request", id, method, args }, location.origin);
    });

  const api = Object.freeze({
    getNetworkId: () => call("getNetworkId"),
    getExtensions: () => call("getExtensions"),
    getUtxos: (amount?: string, paginate?: unknown) => call("getUtxos", amount, paginate),
    getCollateral: (params?: unknown) => call("getCollateral", params),
    getBalance: () => call("getBalance"),
    getUsedAddresses: (paginate?: unknown) => call("getUsedAddresses", paginate),
    getUnusedAddresses: () => call("getUnusedAddresses"),
    getChangeAddress: () => call("getChangeAddress"),
    getRewardAddresses: () => call("getRewardAddresses"),
    signTx: (tx: string, partialSign?: boolean) => call("signTx", tx, partialSign ?? false),
    signData: (address: string, payload: string) => call("signData", address, payload),
    submitTx: (tx: string) => call("submitTx", tx),
    experimental: Object.freeze({
      // Nami's name for it, which many dApps still ask for.
      getCollateral: (params?: unknown) => call("getCollateral", params),
    }),
  });

  const wallet = Object.freeze({
    name: WALLET_NAME,
    icon,
    apiVersion: "0.1.0",
    supportedExtensions: Object.freeze([]),
    isEnabled: () => call("isEnabled"),
    enable: async () => {
      await call("enable");
      return api;
    },
  });

  page.cardano ??= {};
  Object.defineProperty(page.cardano, "seedelf", { value: wallet, enumerable: true });
}
