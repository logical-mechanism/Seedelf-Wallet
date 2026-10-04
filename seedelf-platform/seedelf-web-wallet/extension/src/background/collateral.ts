// giveme.my lends every Seedelf spend its collateral, so no user UTxO ever
// tags a private spend (privacy rule 2). It checks a transaction against the
// chain, then answers `{ witness }`, whose last 64 bytes are the collateral
// key's signature. WebAssembly checks that signature before adding it, so
// this client only carries the request and explains failures.

import { t } from "../i18n";
import { SERVICE_FETCH, type FetchLike } from "./koios";

const TIMEOUT_MS = 20_000;

export class CollateralError extends Error {}

/**
 * giveme.my answered, and refused. It checks a transaction against the chain
 * first, so one reason is an input spent since the review.
 */
export class CollateralRefusedError extends CollateralError {}

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
        ...SERVICE_FETCH,
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ tx: txCborHex }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const cause = e instanceof Error ? e.message : String(e);
      throw new CollateralError(
        t("worker.collateral.unreachable", { cause }),
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
      // giveme.my's own words, as they come, or its status when it gave none: each sentence places them, so a
      // language sets its own brackets and colon around them.
      const detail = (answer as { detail?: unknown } | undefined)?.detail;
      throw new CollateralRefusedError(
        typeof detail === "string"
          ? t("worker.collateral.refused.detail", { detail })
          : t("worker.collateral.refused.status", { status: response.status }),
      );
    }
    if (answer === undefined) throw new CollateralError(t("worker.collateral.notJson"));
    return answer;
  }
}
