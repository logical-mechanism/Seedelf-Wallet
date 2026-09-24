// A round action with a short name under it, like Lace's action buttons.
// `name` is the full accessible name when the short one isn't enough ("Send"
// is "Send to a seedelf"); it starts with the short one, so what a screen
// reader says matches what's shown.

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function ActionButton({
  icon,
  label,
  name,
  primary,
  ...button
}: {
  icon: ReactNode;
  label: string;
  name?: string;
  primary?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className">) {
  return (
    <button type="button" className={primary ? "action action--primary" : "action"} aria-label={name} {...button}>
      <span className="action__icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
