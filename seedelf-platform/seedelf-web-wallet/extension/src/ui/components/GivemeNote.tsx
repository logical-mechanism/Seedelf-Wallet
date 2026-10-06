// giveme.my on a review, in the user's terms (blind test §9.5, T04b, T06, T09,
// T16). Every review of a spend from the private balance said "Send asks
// giveme.my to lend the collateral, then submits", and testers stopped at it:
// who giveme.my is, whose money "the collateral" is, and whether it costs
// anything were said nowhere on the way, only in Settings → Collateral, which
// nothing pointed to. Now the note says all three where it's read, and what
// giveme.my sees, which is why it's on the page at all (chunk 23's second
// review, PY-7, kept it as a disclosure): giveme.my puts up 5 ₳ of its own
// (seedelf-core's `collateral_input`, its fixed UTxO, and `collateral_output`,
// which returns to its own address), nothing in the transaction pays it, and
// the network takes collateral only if a contract fails, which the wallet
// checks as it builds the review (seedelf-core's `eval` runs the scripts, and
// a failing one is no review). What collateral is waits behind the ⓘ, with
// where Settings says it.
//
// `funding`: the payment that funds a one-time account (a swap, a site's
// private session, a top-up, a mix), whose review also shows that account's
// own 5 ₳ kept aside for contracts: "the collateral" there named both
// (chunk 23's second review, CW-8; blind test T10), so this one says it isn't
// that.

import { useT } from "../../i18n";

import { HintButton, HintText, useHint } from "./Hint";

export function GivemeNote({ funding = false, testId = "giveme-note" }: { funding?: boolean; testId?: string }) {
  const t = useT();
  const { open, toggle, id } = useHint();
  const hint = t("review.privacy.collateralHint");
  return (
    <>
      <p className="note" data-testid={testId}>
        {t(funding ? "review.privacy.givemeFunding" : "review.privacy.giveme")}{" "}
        <HintButton text={hint} open={open} onToggle={toggle} controls={id} testId={`${testId}-hint`} />
      </p>
      {open && <HintText text={hint} id={id} testId={`${testId}-more`} />}
    </>
  );
}
