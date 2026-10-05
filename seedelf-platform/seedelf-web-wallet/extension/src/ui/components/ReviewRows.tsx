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
 * One row. `title` shows the whole value on hover when `value` is shortened.
 * `whole`: an address or a Seedelf's name, shown entire under its label, in
 * monospace, never shortened, since a shortened one is what an address
 * poisoner's lookalike matches (chunk 23's review, S-4).
 */
export function Row({
  label,
  value,
  strong,
  title,
  whole,
  testId,
}: {
  label: string;
  value: string;
  strong?: boolean;
  title?: string;
  whole?: boolean;
  testId?: string;
}) {
  const kind = `review__row${strong ? " review__row--strong" : ""}${whole ? " review__row--whole" : ""}`;
  return (
    <div className={kind} data-testid={testId}>
      <dt>{label}</dt>
      <dd title={title} data-value={whole ? value : undefined}>
        {value}
      </dd>
    </div>
  );
}
