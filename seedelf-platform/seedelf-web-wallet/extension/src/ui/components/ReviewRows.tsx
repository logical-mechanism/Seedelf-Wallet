// A review's details, as label and value rows (Lace's detail rows).

import type { ReactNode } from "react";

import { isSeedelfShort } from "../../shared/seedelf-name";

export function ReviewRows({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <dl className="review" data-testid={testId}>
      {children}
    </dl>
  );
}

/**
 * A shortened ID, one word with "…" in it ("drep1y2e20afmrjh…2egjc8", format.ts `shortHex`), and short enough to sit
 * beside any label: kept on one line (`review__row--id`), since the line broke at its "…" and left its tail alone
 * (the visual review of pass two). A sentence that ends in "…" isn't one.
 *
 * A Seedelf's short form is one too (seedelf-name.ts `seedelfShort`, as Activity's entries save a Seedelf with no
 * tag): with its index it's up to 30 characters and holds a no-break space, so the rule above let it go, and its row
 * broke after the "…" and inside its index (the 1.10.0 gate's second review). It has no room beside a label in the
 * side panel, though (`Row`).
 */
export const isShortenedId = (value: string) =>
  (value.length <= 27 && /^[^\s…]+…[^\s…]+$/.test(value)) || isSeedelfShort(value);

/**
 * One row. `title` shows the whole value on hover when `value` is shortened.
 * `whole`: an address or a Seedelf's name, shown entire under its label, in
 * monospace, never shortened, since a shortened one is what an address
 * poisoner's lookalike matches (chunk 23's review, S-4). `part`: one of
 * what the row above it is made of, set in under it, so the parts don't read
 * as more charges. `stack`: a value that's a sentence, under its label.
 */
export function Row({
  label,
  value,
  strong,
  title,
  whole,
  part,
  stack,
  testId,
}: {
  label: string;
  value: string;
  strong?: boolean;
  title?: string;
  whole?: boolean;
  part?: boolean;
  stack?: boolean;
  testId?: string;
}) {
  const id = !whole && !stack && isShortenedId(value);
  // A Seedelf's short form stays on one line as any shortened ID does, but under its label, in monospace, as a whole
  // name is: in the value's own type it takes some 257 px of the 260 a row has in the side panel at 360 px, so it
  // fits beside no label, "To" included.
  const under = id && isSeedelfShort(value);
  const kind =
    "review__row" +
    (strong ? " review__row--strong" : "") +
    (whole || under ? " review__row--whole" : "") +
    (part ? " review__row--part" : "") +
    (stack ? " review__row--stack" : "") +
    (id ? " review__row--id" : "");
  return (
    <div className={kind} data-testid={testId}>
      <dt>{label}</dt>
      <dd title={title} data-value={whole ? value : undefined}>
        {value}
      </dd>
    </div>
  );
}
