// A row of tabs as a segmented switch: Home's Seedelf and Cardano account, and
// the Tokens screen's tokens and NFTs. The arrow keys move between them. Each
// tab controls the panel with id `<prefix>panel-<value>`.

import type { ReactNode } from "react";

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  prefix = "",
}: {
  tabs: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Keeps ids apart when two sets of tabs share a page. */
  prefix?: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {tabs.map((t, i) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`${prefix}tab-${t.value}`}
            aria-selected={on}
            aria-controls={on ? `${prefix}panel-${t.value}` : undefined}
            tabIndex={on ? 0 : -1}
            className={on ? "segmented__item segmented__item--on" : "segmented__item"}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              const step = e.key === "ArrowRight" ? 1 : tabs.length - 1;
              const next = tabs[(i + step) % tabs.length]!.value;
              onChange(next);
              document.getElementById(`${prefix}tab-${next}`)?.focus();
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
