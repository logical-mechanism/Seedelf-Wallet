// An explanation behind an icon, where a paragraph would crowd the screen (the
// owner, 2026-10-01, on the transaction view): the text on hover, and in the
// flow once it's asked for.
//
// Hover alone would leave out anyone on a keyboard, a screen reader or a touch
// screen, so the icon does three things at once: `title` shows the text on
// hover, it's the button's accessible description either way, and a click or
// Enter puts the text on the page under it. The text takes room in the flow when
// it's open rather than floating, so a scrolling panel can never clip it.
//
// **It is for explanations, not for what a screen must say.** A privacy note
// (components/Callout.tsx) carries a decision from privacy.md and stays where
// everyone reads it without asking.

import { useId, useState } from "react";

import { InfoIcon } from "./Icons";

/**
 * The icon alone, for a caller that places the text itself (a section puts the
 * icon in its heading and the text under it). `controls` is the id of that text.
 */
export function HintButton({
  text,
  open,
  onToggle,
  controls,
  testId,
}: {
  text: string;
  open: boolean;
  onToggle: () => void;
  controls: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className="hint"
      title={text}
      aria-label={open ? "Hide what this means" : "What this means"}
      aria-expanded={open}
      // Only while the text is there to point at: an `aria-controls` naming
      // nothing is worse than none.
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
      data-testid={testId}
    >
      <InfoIcon size={14} />
    </button>
  );
}

/** The text of a hint, once it's open. */
export function HintText({ text, id, testId }: { text: string; id: string; testId?: string }) {
  return (
    <p className="note hint__text" id={id} data-testid={testId}>
      {text}
    </p>
  );
}

/** A hint on its own: the icon, and the text under it once it's asked for. */
export function Hint({ text, testId }: { text: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <HintButton
        text={text}
        open={open}
        onToggle={() => setOpen(!open)}
        controls={id}
        testId={testId && `${testId}-hint`}
      />
      {open && <HintText text={text} id={id} testId={testId} />}
    </>
  );
}

/** A hint's state, for a caller that lays the icon and the text out itself. */
export function useHint(): { open: boolean; toggle: () => void; id: string } {
  const [open, setOpen] = useState(false);
  const id = useId();
  return { open, toggle: () => setOpen(!open), id };
}
