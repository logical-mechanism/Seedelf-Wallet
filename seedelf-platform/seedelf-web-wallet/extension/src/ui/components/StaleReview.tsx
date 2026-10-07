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
//
// The headline says who refused when the worker can tell (blind test §9.5,
// T09): every giveme.my refusal used to open with a guess at the user's own
// money ("something it spends may have been spent"), giveme.my named only
// under Details, and nothing to try if it came again. Send now asks the device
// first, and one it knows was spent since is said as that; any other giveme.my
// refusal names giveme.my, says the money hasn't moved, and what to try.

import { useState } from "react";
import { useT } from "../../i18n";

import type { RefusedBy } from "../../shared/rpc";
import { refusedByOf } from "../background";
import { BuildStage } from "./BuildStage";

/**
 * A review's refusal, kept until a new review replaces it. `refused` takes
 * the refusal when Send is refused as stale: its words, and who refused
 * (`by`); `built` is called once a new review is in, and says whether it
 * replaced a refused one (`renewed`); `clear` is Back to the form.
 */
export function useStale() {
  const [detail, setDetail] = useState<string>();
  const [by, setBy] = useState<RefusedBy>();
  const [renewed, setRenewed] = useState(false);
  return {
    detail,
    by,
    renewed,
    refused: (error: unknown) => {
      setDetail(error instanceof Error ? error.message : String(error));
      setBy(refusedByOf(error));
      setRenewed(false);
    },
    built: () => {
      setRenewed(detail !== undefined);
      setDetail(undefined);
      setBy(undefined);
    },
    clear: () => {
      setDetail(undefined);
      setBy(undefined);
      setRenewed(false);
    },
  };
}

/**
 * The foot of a stale review: what happened, and who refused it when that's
 * giveme.my (`by`), the worker's words under Details, and the one way on.
 */
export function StaleFoot({
  detail,
  by,
  busy,
  onAgain,
}: {
  detail: string;
  by?: RefusedBy;
  busy: boolean;
  onAgain: () => void;
}) {
  const t = useT();
  return (
    <>
      <div className="stack-tight" data-testid="review-stale">
        {/* Each headline's key written out here, in the alert: the critical set is read from what an alert shows. */}
        <p className="error" role="alert">
          {t(
            by === "givemeBusy"
              ? "review.stale.warn.givemeBusy"
              : by === "giveme"
                ? "review.stale.warn.giveme"
                : "review.stale.warn",
          )}
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

/**
 * The stale foot's `onAgain` for a form's review: builds it again, or, when the form can't be built as it now
 * stands (Home has since read less than it asks for, or a token's amount is gone), goes back to the form, which
 * says why. The build returned at its guard there, so the press did nothing and said nothing; building past the
 * guard instead would quietly leave out a token the form can no longer send (TokenAmounts' tokenChoices).
 */
export function againOrForm(ready: boolean, build: () => Promise<void>, toForm: () => void): () => void {
  return () => (ready ? void build() : toForm());
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
