// One layout for every flow's screen, after Lace's navigation header: Back
// and the title at the top, a line under it (what's available, the step,
// "Nothing is sent…"), the body, then the error and the primary action at the
// foot, which stays in view while the body scrolls.

import type { FormEvent, ReactNode } from "react";

import { BackIcon } from "./Icons";

interface ScreenProps {
  title: ReactNode;
  /** The heading's id; the screen is labelled by it. */
  titleId: string;
  onBack?: () => void;
  backDisabled?: boolean;
  aside?: ReactNode;
  error?: string;
  /** The primary action, or actions. */
  foot?: ReactNode;
  /** Makes the screen a form, so Enter submits it. */
  onSubmit?: (e: FormEvent) => void;
  children: ReactNode;
}

export function Screen({ title, titleId, onBack, backDisabled, aside, error, foot, onSubmit, children }: ScreenProps) {
  const inner = (
    <>
      <header className="screen__head">
        {onBack ? (
          <button
            type="button"
            className="icon-button"
            onClick={onBack}
            disabled={backDisabled}
            aria-label="Back"
            title="Back"
          >
            <BackIcon />
          </button>
        ) : (
          <span />
        )}
        <h1 id={titleId} className="screen__title">
          {title}
        </h1>
        <span />
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
