// A password box for the password you already have (Unlock, Settings), with
// Show/Hide beside its label as the new-password form has. It starts hidden,
// and hides again whenever the screen is left.

import { useState } from "react";

export function PasswordField({
  id,
  label = "Password",
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <button type="button" className="link" aria-controls={id} onClick={() => setShow(!show)}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <input
        id={id}
        type={show ? "text" : "password"}
        autoComplete="current-password"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
    </div>
  );
}
