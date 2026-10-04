// One layout for every flow's screen, after Lace's navigation header: Back
// and the title at the top, a line under it (what's available, the step,
// "Nothing is sent…"), the body, then the error and the primary action at the
// foot, which stays in view while the body scrolls.

import type { FormEvent, ReactNode } from "react";
import { useT } from "../../i18n";

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
  children: ReactNode;
}

export function Screen({ title, titleId, onBack, backDisabled, aside, action, error, foot, onSubmit, children }: ScreenProps) {
  const t = useT();
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
        <h1 id={titleId} className="screen__title">
          {title}
        </h1>
        {action ?? <span />}
      </header>
      {aside && <p className="screen__aside">{aside}</p>}
      <div className="screen__body">{children}</div>
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
