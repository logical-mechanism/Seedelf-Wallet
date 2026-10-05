// A review whose transaction can't go as it is (chunk 23's review, P-3):
// giveme.my refused it, most often because something it spends changed since
// the review, or it waited too long. The message used to be giveme.my's own,
// ending "refresh, then review it again" on a screen with no Refresh, and Send
// stayed live, so pressing it again met the same refusal. Now Send gives way
// to one button that builds it again from the chain as it is, and the
// worker's own words wait under Details.
//
// The foot stays until the new review is in, saying it's building one, and
// the new review says it's new (chunk 23's second review, PY-1). The rebuild
// used to clear the refusal first, so the foot became Send, greyed out and
// reading "Sending…" while nothing was being sent; and the review it came
// back to looked exactly like the one before.

import { useState } from "react";
import { useT } from "../../i18n";

import { BuildStage } from "./BuildStage";

/**
 * A review's refusal, kept until a new review replaces it. `refused` takes
 * the worker's words when Send is refused as stale; `built` is called once a
 * new review is in, and says whether it replaced a refused one (`renewed`);
 * `clear` is Back to the form.
 */
export function useStale() {
  const [detail, setDetail] = useState<string>();
  const [renewed, setRenewed] = useState(false);
  return {
    detail,
    renewed,
    refused: (message: string) => {
      setDetail(message);
      setRenewed(false);
    },
    built: () => {
      setRenewed(detail !== undefined);
      setDetail(undefined);
    },
    clear: () => {
      setDetail(undefined);
      setRenewed(false);
    },
  };
}

/** The foot of a stale review: what happened, the worker's words under Details, and the one way on. */
export function StaleFoot({ detail, busy, onAgain }: { detail: string; busy: boolean; onAgain: () => void }) {
  const t = useT();
  return (
    <>
      <div className="stack-tight" data-testid="review-stale">
        <p className="error" role="alert">
          {t("review.stale.warn")}
        </p>
        <details className="disclosure">
          <summary>{t("common.details")}</summary>
          <p className="note">{detail}</p>
        </details>
      </div>
      <BuildStage busy={busy} />
      {/* What it does while it does it: never "Sending…", since nothing is sent (PY-1). */}
      <button type="button" className="primary" onClick={onAgain} disabled={busy}>
        {busy ? t("review.stale.building") : t("review.stale.again")}
      </button>
    </>
  );
}

/** Over Send, once a refused review was built again: what's on screen is new, and wants reading again. */
export function RenewedNote({ renewed }: { renewed: boolean }) {
  const t = useT();
  if (!renewed) return null;
  return (
    <p className="note foot-note" role="status" data-testid="review-renewed">
      {t("review.stale.renewed")}
    </p>
  );
}
