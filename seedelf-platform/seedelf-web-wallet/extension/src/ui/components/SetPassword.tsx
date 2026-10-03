// Choose the vault password: typed twice, at least 12 characters, with a
// rough strength hint. The worker enforces the same rule.

import { useState, type FormEvent } from "react";
import { useT, type I18nKey } from "../../i18n";

import { MIN_PASSWORD_LENGTH, passwordProblem, passwordStrength } from "../../shared/password";

interface SetPasswordProps {
  submitLabel: string;
  busy: boolean;
  onSubmit: (password: string) => void;
  /** The first box's label: "New password" when there's an old one. */
  label?: string;
}

const HINTS = {
  weak: "setPassword.hint.weak",
  fair: "setPassword.hint.fair",
  good: "setPassword.hint.good",
  strong: "setPassword.hint.strong",
} as const satisfies Record<string, I18nKey>;

export function SetPassword({ submitLabel, busy, onSubmit, label = "Password" }: SetPasswordProps) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);

  const problem = passwordProblem(password);
  const strength = passwordStrength(password);
  const mismatch = confirm !== "" && confirm !== password;
  const ready = !problem && confirm === password;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    onSubmit(password);
  }

  return (
    <form className="stack" onSubmit={submit}>
      <p className="note">{t("setPassword.note", { min: MIN_PASSWORD_LENGTH })}</p>
      <div className="field">
        <div className="field-row">
          <label htmlFor="new-password">{label}</label>
          <button type="button" className="link" onClick={() => setShow(!show)}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
        <input
          id="new-password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          autoCapitalize="off"
          spellCheck={false}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {password && (
          <div className="strength" data-strength={problem ? "weak" : strength}>
            <div className="strength__bar" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <p className="note" data-testid="password-hint">
              {problem ?? HINTS[strength]}
            </p>
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="confirm-password">{t("setPassword.confirm")}</label>
        <input
          id="confirm-password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          autoCapitalize="off"
          spellCheck={false}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch || undefined}
        />
        {mismatch && <p className="error">{t("setPassword.mismatch")}</p>}
      </div>
      <button type="submit" className="primary" disabled={!ready || busy}>
        {busy ? t("setPassword.encrypting") : submitLabel}
      </button>
    </form>
  );
}
