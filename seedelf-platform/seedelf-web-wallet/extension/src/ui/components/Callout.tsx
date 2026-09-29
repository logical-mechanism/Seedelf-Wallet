// A boxed note: what an action links or keeps apart (privacy), a warning, or
// plain information. The privacy notes carry the decisions in privacy.md, so
// a screen can move or shorten one but never drop it.

import type { AriaRole, ReactNode } from "react";

import { InfoIcon, ShieldIcon, WarnIcon } from "./Icons";

const ICONS = { privacy: ShieldIcon, warn: WarnIcon, info: InfoIcon };

export function Callout({
  tone = "info",
  testId,
  role,
  children,
}: {
  tone?: keyof typeof ICONS;
  testId?: string;
  role?: AriaRole;
  children: ReactNode;
}) {
  const Icon = ICONS[tone];
  return (
    <div className={`callout callout--${tone}`} data-testid={testId} role={role}>
      <span className="callout__icon">
        <Icon size={16} />
      </span>
      <div className="callout__body">{children}</div>
    </div>
  );
}
