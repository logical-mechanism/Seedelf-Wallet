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
// clear of it. On a short window a review's foot (`review`) follows its rows
// instead (styles.css), so its totals come before its button (blind test T04).
//
// Every screen opens at its top (blind test §9.10): the page is what scrolls,
// and screens swap inside it, so each one kept the last one's offset. A new
// title is a new screen, which is how a form's review counts as one. One that
// Back leads to opens where the reader left it instead: Back to a long list
// (Settings, governance actions, pools) landed at its top, and the reader
// looked for their place again (pass two of the blind test's fix round).

import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { currentLanguage, useT } from "../../i18n";

import { pressedBack, useBrowserBack, wentBack } from "../history";
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
   * The header, Back and the title, stays in view as the page scrolls: for a long page whose only way out is its
   * Back, which scrolled away with it (Settings, about 2,000 px: blind test E05).
   */
  headSticky?: boolean;
  /**
   * False: the foot follows the body instead of staying in view. For a screen
   * whose body must all be read before its button is pressed, which a foot
   * kept in view would cover, as it covered a new phrase's last words
   * (chunk 23's review, C-2).
   */
  footSticky?: boolean;
  /**
   * A review: its foot's button sends what the body shows. In a window 600 px
   * tall or less the foot follows the body, so the totals come before the
   * button rather than under one kept in view (blind test T04). Other screens
   * keep theirs in view, an error in it among them.
   */
  review?: boolean;
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
  headSticky,
  footSticky = true,
  review,
  onSubmit,
  hint,
  hintTestId,
  children,
}: ScreenProps) {
  const t = useT();
  const explained = useHint();
  // The browser's Back, Alt+← and a mouse's back button are this screen's Back (chunk 23's review, N-1).
  useBrowserBack(onBack, backDisabled);
  // At its top when it opens, and when it turns into another page: a form into its review, a list into an item's
  // details. The id alone isn't enough: a few flows keep one for several steps (Create's, a sign window's). Where it
  // was left, when Back leads to it.
  useOpensAtTop(`${titleId}\u0000${typeof title === "string" ? title : ""}`, { remember: true });
  // The element itself, not a ref object: a flow's form and its review are one Screen, a <form> then a <section>,
  // so the foot is a new element each switch, and an observer on the old one measured nothing (the cross-area review
  // of chunk 23's second fix round).
  const [footEl, setFootEl] = useState<HTMLDivElement | null>(null);
  useFootClearance(footEl, footSticky && !!(error || foot));
  const inner = (
    <>
      <header className={headSticky ? "screen__head screen__head--sticky" : "screen__head"}>
        {onBack ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              pressedBack();
              onBack();
            }}
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
  const kind = review ? "screen screen--review" : "screen";
  return onSubmit ? (
    <form className={kind} onSubmit={onSubmit} aria-labelledby={titleId}>
      {inner}
    </form>
  ) : (
    <section className={kind} aria-labelledby={titleId}>
      {inner}
    </section>
  );
}

/** What a view showed last: which page, and in which language. */
export interface Shown {
  page: string;
  language: string;
}

/**
 * Whether a view now shows a page of its own: on its first showing, or on another page in the same language. A
 * language switched in Settings renames the page under the reader, who stays where they were.
 */
export function arrived(was: Shown | undefined, now: Shown): boolean {
  return !was || (was.page !== now.page && was.language === now.language);
}

/**
 * Where a page opens: at its top, unless a Back led to it (`back`), when it opens where the reader left it, which
 * `kept` holds by page. Exported for its test.
 */
export function openAt(page: string, back: boolean, kept: ReadonlyMap<string, number>): number {
  return back ? (kept.get(page) ?? 0) : 0;
}

/**
 * Where each `Screen` page was read to, by its key, while the reader is away from Home: what Back opens it at. Home
 * and the app's own views start it afresh, so a page Back leads to that wasn't shown since (a flow opened part-way
 * in, as Home's "Delegate your vote" opens Voting with Staking behind it) opens at its top, not at an offset Home's
 * own scrolling, or an earlier visit, left under its key (the pass-two cross-area review). Exported for its test.
 */
export class Offsets {
  private readonly kept = new Map<string, number>();
  /** The `Screen` page showing, whose offset the document's is. None while Home or an app view shows. */
  private showing: string | undefined;

  /** The document scrolled to `offset`, or was pressed there: the showing page's. */
  note(offset: number) {
    if (this.showing !== undefined) this.kept.set(this.showing, offset);
  }

  /** A `Screen` page opens: where (`openAt`), and from now its offset is this page's. */
  screen(page: string, back: boolean): number {
    const to = openAt(page, back, this.kept);
    this.showing = page;
    this.kept.set(page, to);
    return to;
  }

  /**
   * Home or an app view opens: everything kept goes. Not when a `Screen` opened in the same draw (`withScreen`): the
   * app's view is drawn round Settings and its sign windows, and its effect runs after theirs.
   */
  view(withScreen: boolean) {
    if (withScreen) return;
    this.kept.clear();
    this.showing = undefined;
  }
}

const offsets = new Offsets();
/** A `Screen` page opened in the draw being made: React runs a draw's layout effects in one go, before any microtask. */
let screenDrawn = false;
let keeping = false;

const scroller = () => document.scrollingElement ?? document.documentElement;

function keep() {
  offsets.note(scroller().scrollTop);
}

/**
 * Follows the page's offset as it scrolls, and at a press: the scroll event for the last move comes with the next
 * frame, and a press can leave the page before then. Read before the press is handled, as the window's listeners in
 * the capture phase are.
 */
function startKeeping() {
  if (keeping) return;
  keeping = true;
  window.addEventListener("scroll", keep, { passive: true });
  window.addEventListener("click", keep, { capture: true });
}

/** What the reader does that ends a wait for a page to grow to where they left it: they've moved it themselves. */
const MOVES = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
/** Long enough for a list read again from the device to draw; Koios answers aren't waited for. */
const SETTLE_MS = 1_000;
/** Stops the wait in progress, if any. */
let settling: (() => void) | undefined;

/**
 * Scrolls to `to`, and if the page is still too short for it (a list drawing from what it reads again), follows it as
 * it grows, for a moment, until the reader moves it or another page opens.
 */
function scrollToKept(to: number) {
  settling?.();
  const page = scroller();
  page.scrollTop = to;
  if (to === 0 || page.scrollTop >= to - 1 || typeof ResizeObserver === "undefined") return;
  const watch = new ResizeObserver(() => {
    page.scrollTop = to;
    if (page.scrollTop >= to - 1) stop();
  });
  const timer = setTimeout(() => stop(), SETTLE_MS);
  const stop = () => {
    watch.disconnect();
    clearTimeout(timer);
    for (const move of MOVES) window.removeEventListener(move, stop, true);
    if (settling === stop) settling = undefined;
  };
  for (const move of MOVES) window.addEventListener(move, stop, true);
  watch.observe(document.body);
  settling = stop;
}

/**
 * Opens `page` at the top of the page that scrolls, the document (blind test §9.10). Screens swap inside it and
 * nothing reset it, so "Review: stop staking" opened at its red button with its title and "Nothing is sent until …"
 * above the view (T13), and Home came back from Create Seedelf with its "sent" banner out of sight (T03). Before the
 * paint, so the old offset never shows. Exported for the views that aren't a `Screen`: Home's own, the app's.
 *
 * `remember`, a `Screen`'s: where the reader leaves the page is kept, and a Back that leads to it opens it there
 * (`Offsets`). Home and the app's own views open at their top whichever way they're reached, so a sent
 * transaction's banner is seen (T03), and forget what was kept.
 */
export function useOpensAtTop(page: string, { remember = false }: { remember?: boolean } = {}) {
  const shown = useRef<Shown | undefined>(undefined);
  useLayoutEffect(() => {
    const now = { page, language: currentLanguage() };
    const was = shown.current;
    shown.current = now;
    if (!arrived(was, now)) return;
    if (!remember) {
      settling?.();
      offsets.view(screenDrawn);
      scroller().scrollTop = 0;
      return;
    }
    const to = offsets.screen(page, wentBack());
    if (!screenDrawn) {
      screenDrawn = true;
      queueMicrotask(() => {
        screenDrawn = false;
      });
    }
    startKeeping();
    scrollToKept(to);
  }, [page]);
}

/** `useOpensAtTop` as an element, for a view drawn inside a component whose hooks come before its other screens. */
export function OpensAtTop({ page }: { page: string }) {
  useOpensAtTop(page);
  return null;
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
