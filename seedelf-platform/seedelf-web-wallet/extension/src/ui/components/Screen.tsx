// One layout for every flow's screen, after Lace's navigation header: Back
// (the browser's too: ../history.ts) and the title at the top, a line under it (what's available, the step,
// "Nothing is sent…"), the body, then the error and the primary action at the
// foot, which stays in view while the body scrolls.
//
// The foot is sticky, not fixed: it keeps its place in the flow, so the body's
// last block always scrolls clear of it at the end (measured at 360×640 and in
// a tab), and no padding under the body is needed for that. What it did cover
// was a field the keyboard moved into: Tab to Send's note, under the foot,
// left it there, out of sight (chunk 23's second review, PY-8). The page's
// scroll padding now matches the foot, so the browser scrolls a focused field
// clear of it.

import { useLayoutEffect, useState, type FormEvent, type ReactNode } from "react";
import { useT } from "../../i18n";

import { useBrowserBack } from "../history";
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
  /**
   * False: the foot follows the body instead of staying in view. For a screen
   * whose body must all be read before its button is pressed, which a foot
   * kept in view would cover, as it covered a new phrase's last words
   * (chunk 23's review, C-2).
   */
  footSticky?: boolean;
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
  footSticky = true,
  onSubmit,
  hint,
  hintTestId,
  children,
}: ScreenProps) {
  const t = useT();
  const explained = useHint();
  // The browser's Back, Alt+← and a mouse's back button are this screen's Back (chunk 23's review, N-1).
  useBrowserBack(onBack, backDisabled);
  // The element itself, not a ref object: a flow's form and its review are one Screen, a <form> then a <section>,
  // so the foot is a new element each switch, and an observer on the old one measured nothing (the cross-area review
  // of chunk 23's second fix round).
  const [footEl, setFootEl] = useState<HTMLDivElement | null>(null);
  useFootClearance(footEl, footSticky && !!(error || foot));
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
        <div ref={setFootEl} className={footSticky ? "screen__foot" : "screen__foot screen__foot--static"}>
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

/** Room the page keeps under a focused field: the sticky foot's height, and a little more for its fade. */
const FADE_PX = 8;

/**
 * The page's scroll padding at the bottom, kept at the foot's height while it's in view and sticky (PY-8): the
 * page is what scrolls, so that's where the browser reads it when it brings a focused field into view.
 */
function useFootClearance(el: HTMLDivElement | null, sticky: boolean) {
  useLayoutEffect(() => {
    if (!sticky || !el || typeof ResizeObserver === "undefined") return;
    const page = document.documentElement;
    const fit = () => page.style.setProperty("scroll-padding-bottom", `${el.offsetHeight + FADE_PX}px`);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => {
      watch.disconnect();
      page.style.removeProperty("scroll-padding-bottom");
    };
  }, [el, sticky]);
}
