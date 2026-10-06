// A review's details, as label and value rows (Lace's detail rows).

import type { ReactNode } from "react";

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
 */
export const isShortenedId = (value: string) => value.length <= 27 && /^[^\s…]+…[^\s…]+$/.test(value);

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
  const kind =
    "review__row" +
    (strong ? " review__row--strong" : "") +
    (whole ? " review__row--whole" : "") +
    (part ? " review__row--part" : "") +
    (stack ? " review__row--stack" : "") +
    (!whole && !stack && isShortenedId(value) ? " review__row--id" : "");
  return (
    <div className={kind} data-testid={testId}>
      <dt>{label}</dt>
      <dd title={title} data-value={whole ? value : undefined}>
        {value}
      </dd>
    </div>
  );
}
