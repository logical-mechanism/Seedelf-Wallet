// The browser's Back as the screen's own Back (chunk 23's review, N-1).
// Navigation is plain state switching (App.tsx), so the page's URL never
// changed and Back, Alt+← and a mouse's back button did nothing in a tab.
//
// While a screen with a Back of its own is showing, the page keeps one entry
// of its own in the history, in the same document and at the same URL. The
// browser's Back pops it: the screen showing goes back as its button would,
// and if the screen it goes back to has a Back too, the entry is put back.
// Leaving to Home by the screen's own button takes the entry away again, so
// Back on Home isn't a press that does nothing. A screen whose Back is
// disabled (a transaction being sent) stays, and keeps its entry.
//
// Nothing is kept in the URL: a reload still starts at Home, and no form's
// contents go into the history. Nor does the browser keep the scroll offset:
// a screen opens at its top (blind test §9.10), and one that Back leads to
// opens where it was read to, which `Screen` keeps for itself (`pressedBack`).

import { useEffect, useRef } from "react";

/** A Back was pressed, the screen's own or the browser's, and what it leads to hasn't drawn yet. */
let back = false;

/**
 * Says a Back was pressed: the screen it leads to opens where the reader left it rather than at its top (`Screen`'s
 * `useOpensAtTop`). Back to a long list landed at its top, so the reader looked for their place again (pass two of
 * the blind test's fix round). Until the next task: React draws what a Back leads to before then, in the same click
 * or popstate.
 */
export function pressedBack() {
  back = true;
  setTimeout(() => {
    back = false;
  }, 0);
}

/** Whether the screen drawing now is one a Back led to. */
export const wentBack = () => back;

interface Entry {
  back: () => void;
  disabled: () => boolean;
}

/** The screens with a Back of their own, the one showing last. */
const stack: Entry[] = [];
const MARK = "seedelfBack";
/** The next popstate is the page taking its own entry away: not a Back press. */
let ignoring = 0;
let listening = false;

const ours = () => (history.state as Record<string, unknown> | null)?.[MARK] === true;

function keepEntry() {
  if (stack.length && !ours()) history.pushState({ [MARK]: true }, "");
}

function onPop() {
  if (ignoring > 0) {
    ignoring--;
    // A screen opened before this arrived wants its entry back.
    setTimeout(keepEntry, 0);
    return;
  }
  const top = stack[stack.length - 1];
  if (top && !top.disabled()) {
    pressedBack();
    top.back();
  }
  // After React has drawn what Back led to: if that has a Back too, or this one stayed, an entry to come back to.
  setTimeout(keepEntry, 0);
}

function dropEntry() {
  // Once the screen that left has gone and nothing replaced it: in StrictMode, React mounts a screen twice in a row.
  setTimeout(() => {
    if (stack.length || !ours()) return;
    ignoring++;
    history.back();
  }, 0);
}

/** Makes the browser's Back press `onBack`, while the calling screen shows. */
export function useBrowserBack(onBack: (() => void) | undefined, disabled = false) {
  const current = useRef({ onBack, disabled });
  current.current = { onBack, disabled };
  const has = !!onBack;
  useEffect(() => {
    if (!has) return;
    if (!listening) {
      window.addEventListener("popstate", onPop);
      // The screens say where they open (Screen's `useOpensAtTop`): the browser's own restore, which comes after the
      // popstate, would put back over the screen Back drew the offset its entry was left at (blind test §9.10).
      history.scrollRestoration = "manual";
      listening = true;
    }
    const entry: Entry = {
      back: () => current.current.onBack?.(),
      disabled: () => current.current.disabled,
    };
    stack.push(entry);
    keepEntry();
    return () => {
      const at = stack.lastIndexOf(entry);
      if (at >= 0) stack.splice(at, 1);
      if (!stack.length) dropEntry();
    };
  }, [has]);
}
