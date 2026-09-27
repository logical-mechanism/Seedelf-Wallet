// ADA's value in the user's currency, for Home, after Lace's token pricing:
// on mainnet only (test ADA has no value), from CoinGecko's public API, in
// one request that answers every currency the wallet offers, kept for five
// minutes in session storage, so no time of use is left on the disk (privacy
// review §3.13). It asks nothing about the wallet: CoinGecko learns
// only that someone at this IP address uses it, when Home opens or is
// refreshed. Nothing is read in the background, and the currency "off" asks
// nothing at all. Only ADA is priced: asking about the wallet's tokens would
// say what it holds.

import { NETWORKS, type NetworkName } from "../networks";
import { CURRENCIES, type Currency } from "../shared/preferences";
import type { AdaPrice } from "../shared/rpc";
import { SERVICE_FETCH } from "./koios";
import type { PreferencesService } from "./preferences";
import type { Area } from "./storage";

/** chrome.storage.session: the last prices read, in every currency. */
export const SESSION_PRICES = "seedelf.prices";
/** chrome.storage.local, where they were kept before: removed at the next read. */
export const LOCAL_PRICES = "seedelf.prices";
/** A price is read again once it's this old. */
export const PRICE_TTL_MS = 5 * 60_000;
/** A price this old isn't shown, when CoinGecko can't be read. */
const PRICE_SHOWN_MS = 60 * 60_000;
const TIMEOUT_MS = 10_000;

type Code = Exclude<Currency, "off">;

interface Kept {
  at: number;
  rates: Partial<Record<Code, number>>;
}

export interface PriceDeps {
  /** chrome.storage.session, where the prices are kept. */
  session: Area;
  /** chrome.storage.local, where they were kept before (LOCAL_PRICES). */
  local?: Area;
  preferences: PreferencesService;
  now: () => number;
  fetch?: typeof fetch;
}

export class PriceService {
  private reading: Promise<Kept | undefined> | undefined;

  constructor(private readonly deps: PriceDeps) {}

  /** ADA's price in the user's currency; null off mainnet, with the currency off, or with nothing to show. */
  async get(network: NetworkName): Promise<AdaPrice | null> {
    const base = NETWORKS[network].prices;
    if (!base) return null;
    const { currency } = await this.deps.preferences.get();
    if (currency === "off") return null;
    const now = this.deps.now();
    let kept = await this.deps.session.get<Kept>(SESSION_PRICES);
    if (!kept || now - kept.at >= PRICE_TTL_MS) kept = (await this.read(base)) ?? kept;
    const rate = kept?.rates[currency];
    if (!kept || rate === undefined || now - kept.at >= PRICE_SHOWN_MS) return null;
    return { currency, rate, updatedAt: kept.at };
  }

  /** One request for every currency; two pages asking at once share it. Undefined when it fails. */
  private read(base: string): Promise<Kept | undefined> {
    this.reading ??= this.fetchRates(base).finally(() => (this.reading = undefined));
    return this.reading;
  }

  private async fetchRates(base: string): Promise<Kept | undefined> {
    const get = this.deps.fetch ?? fetch;
    try {
      const url = `${base}/simple/price?ids=cardano&vs_currencies=${CURRENCIES.join(",")}`;
      const response = await get(url, {
        ...SERVICE_FETCH,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { cardano?: Record<string, unknown> };
      const rates: Kept["rates"] = {};
      for (const code of CURRENCIES) {
        const rate = body.cardano?.[code];
        if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[code] = rate;
      }
      if (!Object.keys(rates).length) return undefined;
      const kept = { at: this.deps.now(), rates };
      await this.deps.session.set(SESSION_PRICES, kept);
      await this.deps.local?.remove(LOCAL_PRICES);
      return kept;
    } catch {
      // Offline, blocked, or rate-limited: the value just isn't shown.
      return undefined;
    }
  }
}
