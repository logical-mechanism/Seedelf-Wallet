// Choose the vault password: typed twice, at least 12 characters, with a
// rough strength hint. The worker enforces the same rule.

import { useState, type FormEvent } from "react";

import { MIN_PASSWORD_LENGTH, passwordProblem, passwordStrength } from "../../shared/password";

interface SetPasswordProps {
  submitLabel: string;
  busy: boolean;
  onSubmit: (password: string) => void;
}

const HINTS = {
  weak: "Weak. Longer is stronger: a few random words work well.",
  fair: "Fair. A few more characters or words would help.",
  good: "Good.",
  strong: "Strong.",
} as const;

export function SetPassword({ submitLabel, busy, onSubmit }: SetPasswordProps) {
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
      <p className="note">
        The password unlocks the wallet in this browser. It encrypts your recovery phrase here; it can't
        recover your funds anywhere else. Use at least {MIN_PASSWORD_LENGTH} characters.
      </p>
      <div className="field-row">
        <label htmlFor="new-password">Password</label>
        <button type="button" className="link" onClick={() => setShow(!show)}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <input
        id="new-password"
        type={show ? "text" : "password"}
        autoComplete="new-password"
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
      <label htmlFor="confirm-password">Confirm password</label>
      <input
        id="confirm-password"
        type={show ? "text" : "password"}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        aria-invalid={mismatch || undefined}
      />
      {mismatch && <p className="error">The passwords don't match.</p>}
      <button type="submit" className="primary" disabled={!ready || busy}>
        {busy ? "Encrypting…" : submitLabel}
      </button>
    </form>
  );
}
