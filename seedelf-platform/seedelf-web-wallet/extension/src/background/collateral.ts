// giveme.my lends every Seedelf spend its collateral, so no user UTxO ever
// tags a private spend (privacy rule 2). It checks a transaction against the
// chain, then answers `{ witness }`, whose last 64 bytes are the collateral
// key's signature. WebAssembly checks that signature before adding it, so
// this client only carries the request and explains failures.

import { t } from "../i18n";
import type { RefusedBy } from "../shared/rpc";
import { SERVICE_FETCH, type FetchLike } from "./koios";

const TIMEOUT_MS = 20_000;

export class CollateralError extends Error {}

/**
 * A reviewed transaction that can't go as it is, and that building it again
 * from the chain as it is now fixes: the UI swaps its Send for "Refresh and
 * review again" (chunk 23's review, P-3), since Send again only meets the same
 * refusal. It crosses the port as the reply's `code: "stale"` (ui-port.ts).
 */
export class StaleReviewError extends Error {}

/**
 * giveme.my answered, and refused. It checks a transaction against the chain
 * first, so one reason is an input spent since the review: a stale review.
 * Send asks the device first (script-spend.ts), and one it knows was spent
 * since never gets here, so the screen names giveme.my as who refused rather
 * than guessing at the user's own money (blind test §9.5, T09). `busy`: an
 * outage or a limit (5xx, 429), which waiting fixes and a new review alone
 * doesn't.
 */
export class CollateralRefusedError extends CollateralError {
  readonly stale = true;
  constructor(
    message: string,
    readonly busy = false,
  ) {
    super(message);
  }
}

/** Who turned a stale-coded refusal away, as its reply says it (shared/rpc.ts `RefusedBy`): giveme.my, or nobody named. */
export function refusedBy(error: unknown): RefusedBy | undefined {
  if (!(error instanceof CollateralRefusedError)) return undefined;
  return error.busy ? "givemeBusy" : "giveme";
}

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
      // language sets its own brackets and colon around them. An outage or a limit says so: the user waits, rather
      // than reading that something they own changed (blind test T09's verifier).
      const busy = response.status >= 500 || response.status === 429;
      const detail = (answer as { detail?: unknown } | undefined)?.detail;
      throw new CollateralRefusedError(
        busy
          ? t("worker.collateral.busy", { status: response.status })
          : typeof detail === "string"
            ? t("worker.collateral.refused.detail", { detail })
            : t("worker.collateral.refused.status", { status: response.status }),
        busy,
      );
    }
    if (answer === undefined) throw new CollateralError(t("worker.collateral.notJson"));
    return answer;
  }
}
