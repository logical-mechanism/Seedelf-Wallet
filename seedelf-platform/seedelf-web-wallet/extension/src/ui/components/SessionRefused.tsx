// A private session's funding refused at Send (chunk 23's second review,
// DX-1): a swap's, a mix's, a site's. Its session is recorded before Send,
// and whatever happens next its one-time account is never used again
// (sessions.ts), so Send can't go a second time: pressing it said "That
// session was started already". Private Send's way out holds here too
// (StaleReview.tsx): Send gives way to one action that builds a new review,
// on the next unused account, and the worker's own words wait under Details.
// One that may have gone out all the same isn't built again, since both would
// run: its page watches for it instead. The record says so, whatever the
// worker called the refusal: one it found gone from Send's keeping was sent,
// and a stale review built again would fund a second session (chunk 23's
// second review, fix round).
//
// The connector's private-session funding can use the same: refusalOf with
// its review's index, then SessionRefusedFoot (no `onWatch` there: its words
// say where to look).

import { type I18nKey, t, useT } from "../../i18n";

import type { UnsentWhy } from "../../shared/rpc";
import { call, isStale } from "../background";

/** What a refused funding leaves its review. */
export interface Refusal {
  /**
   * `again`: nothing went out, so a new review is the way on (`changed`: the
   * worker said something it spends may have changed); `watch`: it may have
   * gone out, so its page watches for it.
   */
  kind: "again" | "watch";
  changed?: boolean;
  /** The worker's own words, for Details. */
  detail: string;
}

/**
 * What a Send that threw `err` left of session `index`, from the device's
 * record alone (no Koios request), read first: a funding turned away once its
 * session was recorded is built again, and a recorded one that may be on its
 * way is watched, stale or not. With no record, a stale review is built
 * again. Undefined otherwise: Send can go again, and the error says why it
 * didn't. `txHash`, the funding reviewed: a record of another page's funding
 * on the same account isn't this one's.
 */
export async function refusalOf(err: unknown, index: number, txHash?: string): Promise<Refusal | undefined> {
  const detail = err instanceof Error ? err.message : String(err);
  const s = await call("sessions", {}).then(
    (all) =>
      all.find((x) => x.index === index && (txHash === undefined || x.txs.some((tx) => tx.kind === "out" && tx.txHash === txHash))),
    () => undefined,
  );
  if (s?.stage === "failed" && s.unsent) return { kind: "again", changed: s.unsentWhy === "changed", detail };
  if (s) return { kind: "watch", detail };
  if (isStale(err)) return { kind: "again", changed: true, detail };
  return undefined;
}

/**
 * The foot of a refused funding's review: what happened, without naming a
 * service (the worker's words, which do, under Details), and the one way on.
 * `onWatch`, for one that may have gone out: opens where it's watched.
 */
export function SessionRefusedFoot({
  refusal,
  busy,
  onAgain,
  onWatch,
}: {
  refusal: Refusal;
  busy: boolean;
  onAgain: () => void;
  onWatch?: () => void;
}) {
  const tr = useT();
  const watch = refusal.kind === "watch";
  return (
    <>
      <div className="stack-tight" data-testid={watch ? "review-maybe-sent" : "review-stale"}>
        <p className="error" role="alert">
          {tr(watch ? "review.session.warn.maybe" : refusal.changed ? "review.session.warn.changed" : "review.session.warn.again")}
        </p>
        <details className="disclosure">
          <summary>{tr("common.details")}</summary>
          <p className="note">{refusal.detail}</p>
        </details>
      </div>
      {watch ? (
        onWatch && (
          <button type="button" className="primary" onClick={onWatch}>
            {tr("review.session.open")}
          </button>
        )
      ) : (
        <button type="button" className="primary" onClick={onAgain} disabled={busy}>
          {busy ? tr("review.stale.building") : tr("review.session.again")}
        </button>
      )}
    </>
  );
}

const UNSENT_WHY: Record<UnsentWhy, I18nKey> = {
  changed: "review.session.why.changed",
  unreachable: "review.session.why.unreachable",
  busy: "review.session.why.busy",
  network: "review.session.why.network",
};

/** Why a funding was turned away, in a sentence, when the worker knew (sessions.ts unsentWhyOf). */
export function unsentWhyText(why?: UnsentWhy): string | undefined {
  return why ? t(UNSENT_WHY[why]) : undefined;
}
