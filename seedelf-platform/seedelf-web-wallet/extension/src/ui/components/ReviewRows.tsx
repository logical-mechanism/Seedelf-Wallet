// A review's details, as label and value rows (Lace's detail rows).

import type { ReactNode } from "react";

export function ReviewRows({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <dl className="review" data-testid={testId}>
      {children}
    </dl>
  );
}

/** One row. `title` shows the whole value on hover when `value` is shortened. */
export function Row({ label, value, strong, title }: { label: string; value: string; strong?: boolean; title?: string }) {
  return (
    <div className={strong ? "review__row review__row--strong" : "review__row"}>
      <dt>{label}</dt>
      <dd title={title}>{value}</dd>
    </div>
  );
}
