// One layout for every flow's screen, after Lace's navigation header: Back
// and the title at the top, a line under it (what's available, the step,
// "Nothing is sent…"), the body, then the error and the primary action at the
// foot, which stays in view while the body scrolls.

import type { FormEvent, ReactNode } from "react";
import { useT } from "../../i18n";

import { HintButton, HintText, useHint } from "./Hint";
import { BackIcon } from "./Icons";

interface ScreenProps {
  title: ReactNode;
  /** The heading's id; the screen is labelled by it. */
  titleId: string;
  onBack?: () => void;
  backDisabled?: boolean;
  aside?: ReactNode;
  /** A small button at the header's right, across from Back: a swap's settings. */
  action?: ReactNode;
  error?: string;
  /** The primary action, or actions. */
  foot?: ReactNode;
  /** Makes the screen a form, so Enter submits it. */
  onSubmit?: (e: FormEvent) => void;
  /**
   * What the screen is for, or how its transaction runs: behind an icon beside
   * the title, and at the top of the body once asked for (chunk 23). Never a
   * privacy note, a cost or a warning, which the body says for everyone.
   */
  hint?: string;
  /** The hint's text, once open; its icon is `${hintTestId}-hint`. */
  hintTestId?: string;
  children: ReactNode;
}

export function Screen({
  title,
  titleId,
  onBack,
  backDisabled,
  aside,
  action,
  error,
  foot,
  onSubmit,
  hint,
  hintTestId,
  children,
}: ScreenProps) {
  const t = useT();
  const explained = useHint();
  const inner = (
    <>
      <header className="screen__head">
        {onBack ? (
          <button
            type="button"
            className="icon-button"
            onClick={onBack}
            disabled={backDisabled}
            aria-label={t("common.back")}
            title={t("common.back")}
          >
            <BackIcon />
          </button>
        ) : (
          <span />
        )}
        {hint ? (
          <div className="screen__title-row">
            <h1 id={titleId} className="screen__title">
              {title}
            </h1>
            <HintButton
              text={hint}
              open={explained.open}
              onToggle={explained.toggle}
              controls={explained.id}
              testId={hintTestId && `${hintTestId}-hint`}
            />
          </div>
        ) : (
          <h1 id={titleId} className="screen__title">
            {title}
          </h1>
        )}
        {action ?? <span />}
      </header>
      {aside && <p className="screen__aside">{aside}</p>}
      <div className="screen__body">
        {hint && explained.open && <HintText text={hint} id={explained.id} testId={hintTestId} />}
        {children}
      </div>
      {(error || foot) && (
        <div className="screen__foot">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {foot}
        </div>
      )}
    </>
  );
  return onSubmit ? (
    <form className="screen" onSubmit={onSubmit} aria-labelledby={titleId}>
      {inner}
    </form>
  ) : (
    <section className="screen" aria-labelledby={titleId}>
      {inner}
    </section>
  );
}
