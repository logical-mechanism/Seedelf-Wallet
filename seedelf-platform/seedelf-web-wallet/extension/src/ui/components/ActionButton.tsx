// A round action with its name under it, like Lace's action buttons. The name
// may take two short lines ("Send" over "privately"): Home's actions name
// their side since the blind test (the owner's call, 2026-10-05), where it was
// in the accessible names alone. `name` is a fuller accessible name, for a
// label that can't say it all; it starts with the label, so what a screen
// reader says matches what's shown. Home's labels say it all, so they pass none.

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
      <span className="action__label">{label}</span>
    </button>
  );
}
