// giveme.my lends every Seedelf spend its collateral, so no user UTxO ever
// tags a private spend (privacy rule 2). It checks a transaction against the
// chain, then answers `{ witness }`, whose last 64 bytes are the collateral
// key's signature. WebAssembly checks that signature before adding it, so
// this client only carries the request and explains failures.

import type { FetchLike } from "./koios";

const TIMEOUT_MS = 20_000;

export class CollateralError extends Error {}

export class Collateral {
  constructor(
    private readonly url: string,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
  ) {}

  /** giveme.my's answer for an unsigned transaction. Asked once per Send. */
  async witness(txCborHex: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(this.url, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ tx: txCborHex }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const cause = e instanceof Error ? e.message : String(e);
      throw new CollateralError(
        `Couldn't reach giveme.my, the service that lends Seedelf spends their collateral (${cause}). ` +
          "Check your internet connection, and any VPN or ad blocker that might block giveme.my.",
      );
    }
    const text = await response.text();
    let answer: unknown;
    try {
      answer = JSON.parse(text);
    } catch {
      answer = undefined;
    }
    if (!response.ok) {
      const detail = (answer as { detail?: unknown } | undefined)?.detail;
      const why = typeof detail === "string" ? `: ${detail}` : ` (${response.status})`;
      throw new CollateralError(
        `giveme.my, which lends the collateral, refused this transaction${why}. ` +
          "Its UTxOs may have been spent since the review: refresh, then review it again.",
      );
    }
    if (answer === undefined) throw new CollateralError("giveme.my answered with something that isn't JSON.");
    return answer;
  }
}
