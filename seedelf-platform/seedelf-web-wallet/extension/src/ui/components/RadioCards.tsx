// A choice with consequences, as cards that each say what they are (chunk 23's
// review, V-4): the connect window's public account or private session, what
// pays for a Seedelf, where a removed one's ADA goes. Voting power's chooser
// was the pattern. The pill switch (components/Tabs.tsx, Choice.tsx) stays for
// navigation and plain settings, where it doesn't look like a step to skip.
//
// With no `value`, none is checked until the user picks one (a site's connect
// window, or Remove when the wallet can't tell who paid).

import type { ReactNode } from "react";

import { CheckIcon } from "./Icons";

export interface RadioCard<T extends string> {
  value: T;
  label: string;
  /** What choosing it means, inside the card. */
  text?: ReactNode;
  icon: ReactNode;
  disabled?: boolean;
}

export function RadioCards<T extends string>({
  label,
  id,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  id: string;
  options: Array<RadioCard<T>>;
  value?: T;
  onChange: (value: T) => void;
  testId?: string;
}) {
  return (
    <div className="field">
      <span className="label" id={id}>
        {label}
      </span>
      <ul className="list radio-cards" role="radiogroup" aria-labelledby={id} data-testid={testId}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <li key={o.value}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                disabled={o.disabled}
                className={on ? "token-row radio-card token-row--on" : "token-row radio-card"}
                onClick={() => onChange(o.value)}
              >
                <span className="avatar avatar--contact" aria-hidden="true">
                  {on ? <CheckIcon size={16} /> : o.icon}
                </span>
                <span className="token-row__label">{o.label}</span>
                <span />
                {o.text && <span className="token-row__sub wrap">{o.text}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
